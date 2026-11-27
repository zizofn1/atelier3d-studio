"""
Atelier3D Studio — Home-Server Photorealistic Render API (FastAPI + Warm Blender Worker)
========================================================================================
Run locally or on a 24/7 home server:
    uvicorn server:app --host 0.0.0.0 --port 8787

Architecture:
  - Keeps ONE persistent headless Blender worker (blender_worker.py) warm in memory
    so Blender startup & GPU oneAPI/OIDN kernels load ONCE (0s overhead per render!).
  - Caches uploaded scene geometry by `sceneHash` so camera/lighting tweaks skip
    GLB upload, glTF import, and BVH rebuild completely.
  - Supports both Cycles Studio (16x MSAA equiv.) and Blender 5.3 EEVEE Express (~3-5s).
"""

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

APP_DIR = Path(__file__).resolve().parent
WORKER_SCRIPT = APP_DIR / "blender_worker.py"
WORK_ROOT = Path(os.environ.get("ATELIER3D_WORK_DIR", tempfile.gettempdir())) / "atelier3d_renders"
WORK_ROOT.mkdir(parents=True, exist_ok=True)

API_KEY = os.environ.get("RENDER_API_KEY", "").strip()
JOB_TTL_SECONDS = 1800  # Auto-clean old render files after 30 minutes
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
EVENT_PREFIX = "[WORKER_EVENT] "


def find_blender_executable() -> Optional[str]:
    env_bin = os.environ.get("BLENDER_PATH", "").strip()
    if env_bin and Path(env_bin).exists():
        return env_bin

    in_path = shutil.which("blender")
    if in_path:
        return in_path

    win_base = Path(r"C:\Program Files\Blender Foundation")
    if win_base.exists():
        candidates = sorted(win_base.glob("Blender*/blender.exe"), reverse=True)
        if candidates:
            return str(candidates[0])

    for p in (
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "/usr/bin/blender",
        "/usr/local/bin/blender",
    ):
        if Path(p).exists():
            return p
    return None


def detect_blender_version(blender_bin: Optional[str]) -> Optional[str]:
    if not blender_bin:
        return None
    try:
        out = subprocess.check_output([blender_bin, "--version"], text=True, timeout=8)
        first = out.strip().splitlines()[0] if out.strip() else None
        return first
    except Exception:
        return None


BLENDER_BIN = find_blender_executable()
BLENDER_VERSION = detect_blender_version(BLENDER_BIN)


@dataclass
class RenderJob:
    id: str
    work_dir: Path
    output_png: Path
    scene_hash: Optional[str] = None
    glb_path: Optional[Path] = None
    config: dict = field(default_factory=dict)
    status: str = "queued"  # queued | rendering | done | error
    progress_pct: int = 0
    phase_fr: str = "En file d'attente…"
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    error: Optional[str] = None
    device: str = "AUTO"
    remaining_str: Optional[str] = None
    cache_hit: bool = False
    cancelled: bool = False


class WarmBlenderWorker:
    """Supervises one persistent warm Blender headless process for near-instant renders."""

    def __init__(self):
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.reader_task: Optional[asyncio.Task] = None
        self.ready_event = asyncio.Event()
        self.ready = False
        self.device = "AUTO"
        self.cached_scene_hash: Optional[str] = None
        self.active_job_id: Optional[str] = None
        self._active_done_future: Optional[asyncio.Future] = None
        self._lock = asyncio.Lock()
        self._boot_lock = asyncio.Lock()

    async def start(self):
        async with self._boot_lock:
            if self.proc and self.proc.returncode is None:
                return
            if not BLENDER_BIN:
                print("[WarmWorker] Blender introuvable — démarrage différé.", flush=True)
                return

            self.ready = False
            self.ready_event.clear()
            self.cached_scene_hash = None

            cmd = [
                BLENDER_BIN,
                "--background",
                "--factory-startup",
                "--python",
                str(WORKER_SCRIPT),
            ]
            print(f"[WarmWorker] Lancement du worker persistant ({BLENDER_VERSION})…", flush=True)
            self.proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                limit=1024 * 1024,
            )
            self.reader_task = asyncio.create_task(self._read_loop(self.proc))

    async def stop(self):
        proc = self.proc
        self.proc = None
        self.ready = False
        self.ready_event.clear()
        self.cached_scene_hash = None
        if proc and proc.returncode is None:
            try:
                if proc.stdin:
                    proc.stdin.write(b'{"cmd":"quit"}\n')
                    await proc.stdin.drain()
                await asyncio.wait_for(proc.wait(), timeout=2.0)
            except Exception:
                try:
                    proc.terminate()
                    await asyncio.sleep(0.25)
                    if proc.returncode is None:
                        proc.kill()
                except Exception:
                    pass

    async def kill_and_respawn(self):
        proc = self.proc
        self.proc = None
        self.ready = False
        self.ready_event.clear()
        self.cached_scene_hash = None
        if proc and proc.returncode is None:
            try:
                proc.terminate()
                await asyncio.sleep(0.25)
                if proc.returncode is None:
                    proc.kill()
            except Exception:
                pass
        if self._active_done_future and not self._active_done_future.done():
            self._active_done_future.set_result({"type": "cancelled"})
        asyncio.create_task(self.start())

    async def _read_loop(self, proc: asyncio.subprocess.Process):
        assert proc.stdout is not None
        tail: list[str] = []
        try:
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode("utf-8", errors="replace").strip()
                if not line:
                    continue

                if line.startswith(EVENT_PREFIX):
                    try:
                        ev = json.loads(line[len(EVENT_PREFIX) :])
                    except Exception:
                        continue
                    self._handle_event(ev)
                    continue

                tail.append(line)
                if len(tail) > 25:
                    tail.pop(0)

                if line.startswith("[Atelier3D") or "Saved:" in line or "Error" in line:
                    print(f"[WarmWorker] {line}", flush=True)
        finally:
            rc = await proc.wait()
            if self.proc is proc:
                self.proc = None
                self.ready = False
                self.ready_event.clear()
                self.cached_scene_hash = None
                if self._active_done_future and not self._active_done_future.done():
                    self._active_done_future.set_result({
                        "type": "error",
                        "error": f"Worker Blender arrêté (code {rc}). {' | '.join(tail[-3:])}",
                    })

    def _handle_event(self, ev: dict):
        ev_type = ev.get("type")
        if ev_type == "ready":
            self.device = str(ev.get("device", "AUTO"))
            self.ready = True
            self.ready_event.set()
            print(f"[WarmWorker] Prêt & chaud en mémoire (device={self.device}) !", flush=True)
            return

        jid = ev.get("jobId")
        job = jobs.get(jid) if jid else None

        if ev_type == "progress" and job:
            job.progress_pct = max(job.progress_pct, int(ev.get("pct", job.progress_pct)))
            job.phase_fr = str(ev.get("phase", job.phase_fr))
            if ev.get("device"):
                job.device = str(ev["device"])
            if ev.get("remaining"):
                job.remaining_str = str(ev["remaining"])
            if ev.get("cacheHit") is not None:
                job.cache_hit = bool(ev["cacheHit"])
            print(f"[Job {job.id}] {job.progress_pct}% — {job.phase_fr}", flush=True)
            return

        if ev_type in ("done", "error"):
            if ev_type == "done" and ev.get("cachedSceneHash"):
                self.cached_scene_hash = str(ev["cachedSceneHash"])
            if self._active_done_future and not self._active_done_future.done():
                self._active_done_future.set_result(ev)

    async def execute(self, job: RenderJob):
        async with self._lock:
            if job.cancelled:
                job.status = "error"
                job.error = "Rendu annulé."
                job.finished_at = time.time()
                return

            if not BLENDER_BIN:
                job.status = "error"
                job.error = "Blender introuvable sur le serveur. Installez Blender 4.x/5.x."
                job.finished_at = time.time()
                return

            job.status = "rendering"
            job.started_at = time.time()
            job.progress_pct = 5
            job.phase_fr = "Connexion au worker Blender chaud…"

            await self.start()
            if not self.ready:
                job.phase_fr = "Préchauffage de Blender & du moteur GPU (1re fois)…"
                try:
                    await asyncio.wait_for(self.ready_event.wait(), timeout=60.0)
                except asyncio.TimeoutError:
                    job.status = "error"
                    job.error = "Le worker Blender a mis trop de temps à démarrer."
                    job.finished_at = time.time()
                    await self.kill_and_respawn()
                    return

            if not self.proc or not self.proc.stdin:
                job.status = "error"
                job.error = "Worker Blender indisponible."
                job.finished_at = time.time()
                return

            loop = asyncio.get_running_loop()
            self._active_done_future = loop.create_future()
            self.active_job_id = job.id

            payload = {
                "cmd": "render",
                "jobId": job.id,
                "sceneHash": job.scene_hash or "",
                "glbPath": str(job.glb_path) if job.glb_path else None,
                "config": job.config,
                "outPng": str(job.output_png),
            }

            try:
                self.proc.stdin.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
                await self.proc.stdin.drain()

                result = await self._active_done_future
                if job.cancelled or result.get("type") == "cancelled":
                    job.status = "error"
                    job.error = "Rendu annulé par l'utilisateur."
                elif result.get("type") == "done" and job.output_png.exists():
                    job.status = "done"
                    job.progress_pct = 100
                    job.remaining_str = None
                    job.device = str(result.get("device", job.device))
                    job.cache_hit = bool(result.get("cacheHit", job.cache_hit))
                    job.phase_fr = "Rendu photoréaliste terminé !"
                    print(
                        f"[Job {job.id}] Terminé en {result.get('elapsedSec')}s "
                        f"(device={job.device}, cacheHit={job.cache_hit})",
                        flush=True,
                    )
                else:
                    job.status = "error"
                    job.error = str(result.get("error") or "Échec du rendu Blender.")
                    print(f"[Job {job.id}] Erreur : {job.error}", flush=True)
            except Exception as exc:
                job.status = "error"
                job.error = str(exc)
            finally:
                self.active_job_id = None
                self._active_done_future = None
                job.finished_at = time.time()


jobs: dict[str, RenderJob] = {}
worker = WarmBlenderWorker()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pre-warm Blender immediately on server launch so first render has 0s cold start!
    asyncio.create_task(worker.start())
    yield
    await worker.stop()


app = FastAPI(
    title="Atelier3D Studio — Warm Render Server (Cycles + EEVEE)",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def check_auth(x_api_key: Optional[str]):
    if API_KEY and (x_api_key or "").strip() != API_KEY:
        raise HTTPException(status_code=401, detail="Clé API invalide (X-API-Key).")


def cleanup_old_jobs():
    now = time.time()
    expired = [
        jid
        for jid, j in jobs.items()
        if j.status in ("done", "error")
        and now - j.created_at > JOB_TTL_SECONDS
    ]
    for jid in expired:
        j = jobs.pop(jid, None)
        if j and j.work_dir.exists():
            shutil.rmtree(j.work_dir, ignore_errors=True)


@app.get("/api/health")
async def health():
    global BLENDER_BIN, BLENDER_VERSION
    if not BLENDER_BIN:
        BLENDER_BIN = find_blender_executable()
        BLENDER_VERSION = detect_blender_version(BLENDER_BIN)
        if BLENDER_BIN:
            asyncio.create_task(worker.start())
    return {
        "status": "ok",
        "blenderFound": bool(BLENDER_BIN),
        "blenderVersion": BLENDER_VERSION,
        "workerReady": worker.ready,
        "workerDevice": worker.device,
        "cachedSceneHash": worker.cached_scene_hash,
        "engines": ["cycles", "eevee"],
        "aaModes": ["aa4", "aa16", "aa16_ultra"],
    }


@app.post("/api/render")
async def start_render(
    scene: Optional[UploadFile] = File(default=None),
    scene_hash: str = Form(""),
    config: str = Form("{}"),
    x_api_key: Optional[str] = Header(default=None),
):
    check_auth(x_api_key)
    cleanup_old_jobs()

    try:
        parsed_cfg = json.loads(config)
        if not isinstance(parsed_cfg, dict):
            raise ValueError("config doit être un objet JSON")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Configuration JSON invalide : {exc}")

    parsed_cfg["width"] = max(640, min(3840, int(parsed_cfg.get("width", 1920))))
    parsed_cfg["height"] = max(480, min(2160, int(parsed_cfg.get("height", 1080))))

    clean_hash = scene_hash.strip() or None
    job_id = uuid.uuid4().hex[:12]
    job_dir = WORK_ROOT / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    out_png = job_dir / "render.png"
    glb_path: Optional[Path] = None

    if scene is not None:
        content = await scene.read(MAX_UPLOAD_BYTES + 1)
        if not content:
            raise HTTPException(status_code=400, detail="Fichier GLB vide.")
        if len(content) > MAX_UPLOAD_BYTES:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=413, detail="Fichier GLB trop volumineux (100 Mo maximum).")
        if len(content) < 12 or content[:4] != b"glTF":
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Format GLB invalide.")
        glb_path = job_dir / "scene.glb"
        glb_path.write_bytes(content)
    else:
        # Cache-only request: verify the warm worker actually holds this geometry
        if not clean_hash or clean_hash != worker.cached_scene_hash:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=409, detail="SCENE_CACHE_MISS")

    (job_dir / "config.json").write_text(json.dumps(parsed_cfg, ensure_ascii=False), encoding="utf-8")

    job = RenderJob(
        id=job_id,
        work_dir=job_dir,
        output_png=out_png,
        scene_hash=clean_hash,
        glb_path=glb_path,
        config=parsed_cfg,
        cache_hit=glb_path is None,
    )
    jobs[job_id] = job
    asyncio.create_task(worker.execute(job))

    return {"jobId": job_id, "status": job.status, "cacheHit": job.cache_hit}


@app.get("/api/render/{job_id}")
async def get_render_status(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    check_auth(x_api_key)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Tâche de rendu introuvable ou expirée.")
    elapsed = (job.finished_at or time.time()) - job.created_at
    return {
        "jobId": job.id,
        "status": job.status,
        "progressPct": job.progress_pct,
        "phaseFr": job.phase_fr,
        "device": job.device,
        "remainingStr": job.remaining_str,
        "cacheHit": job.cache_hit,
        "elapsedSec": round(elapsed, 1),
        "error": job.error,
    }


@app.post("/api/render/{job_id}/cancel")
async def cancel_render(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    check_auth(x_api_key)
    job = jobs.get(job_id)
    if not job:
        return {"jobId": job_id, "cancelled": False}
    job.cancelled = True
    if worker.active_job_id == job_id:
        await worker.kill_and_respawn()
    if job.status in ("queued", "rendering"):
        job.status = "error"
        job.error = "Rendu annulé par l'utilisateur."
        job.finished_at = time.time()
    return {"jobId": job_id, "cancelled": True}


@app.get("/api/render/{job_id}/image")
async def get_render_image(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    check_auth(x_api_key)
    job = jobs.get(job_id)
    if not job or job.status != "done" or not job.output_png.exists():
        raise HTTPException(status_code=404, detail="Image non prête.")
    return FileResponse(
        path=str(job.output_png),
        media_type="image/png",
        filename=f"rendu-studio-{job_id}.png",
    )
