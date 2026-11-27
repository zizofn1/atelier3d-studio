"""
Atelier3D Studio — Persistent Warm Blender Worker Daemon
========================================================
Launched ONCE by server.py as:
    blender --background --factory-startup --python blender_worker.py

Why this makes renders 2x-5x faster:
  - Eliminates ~8-10s Blender cold startup on every render
  - Eliminates ~30-45s oneAPI / GPU kernel & OpenImageDenoise reload on every render
  - Keeps BVH, textures & upgraded PBR shaders warm in memory (use_persistent_data = True)
  - Caches geometry by sceneHash so changing camera angle or lights skips GLB import (0s!)
  - Supports both Cycles Studio (16x MSAA equiv.) and EEVEE Express (~3-5s preview)

Protocol:
  - Reads JSON line commands from stdin:
      {"cmd": "render", "jobId": "...", "sceneHash": "...", "glbPath": "...", "config": {...}, "outPng": "..."}
      {"cmd": "ping"}
      {"cmd": "quit"}
  - Writes JSON line events to stdout prefixed with "[WORKER_EVENT] "
"""

import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

# Allow importing render_cycles from the same directory
WORKER_DIR = str(Path(__file__).resolve().parent)
if WORKER_DIR not in sys.path:
    sys.path.insert(0, WORKER_DIR)

import bpy  # noqa: E402
import render_cycles as rc  # noqa: E402

SAMPLE_RE = re.compile(r"Sample\s+(\d+)\s*/\s*(\d+)")
REMAINING_RE = re.compile(r"Remaining:\s*([0-9:.]+)")


def emit(event: dict):
    print("[WORKER_EVENT] " + json.dumps(event, ensure_ascii=False), flush=True)


def main():
    loaded_scene_hash: str | None = None
    active_job = {
        "id": None,
        "device": "AUTO",
        "pct": 0,
        "remaining": None,
    }

    def on_stat(stat_text: str):
        jid = active_job["id"]
        if not jid:
            return
        m_rem = REMAINING_RE.search(stat_text)
        if m_rem:
            active_job["remaining"] = m_rem.group(1)

        m_s = SAMPLE_RE.search(stat_text)
        if m_s:
            cur = int(m_s.group(1))
            tot = max(1, int(m_s.group(2)))
            pct = max(active_job["pct"], min(94, 18 + int((cur / tot) * 76)))
            active_job["pct"] = pct
            eta = f" · reste ~{active_job['remaining']}" if active_job["remaining"] and cur < tot else ""
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": f"Path-Tracing Cycles ({cur}/{tot} samples · {active_job['device']}{eta})",
                "remaining": active_job["remaining"],
                "device": active_job["device"],
            })
        elif "Building BVH" in stat_text or "Initializing" in stat_text:
            pct = max(active_job["pct"], 14)
            active_job["pct"] = pct
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": f"Construction BVH & géométrie ({active_job['device']})…",
                "device": active_job["device"],
            })
        elif "Loading render kernels" in stat_text:
            pct = max(active_job["pct"], 15)
            active_job["pct"] = pct
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": f"Chargement noyaux GPU ({active_job['device']}, 1re fois uniquement)…",
                "device": active_job["device"],
            })
        elif "Loading denoising kernels" in stat_text:
            pct = max(active_job["pct"], 16)
            active_job["pct"] = pct
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": "Chargement OpenImageDenoise…",
                "device": active_job["device"],
            })
        elif "Denois" in stat_text and "Loading denoising" not in stat_text:
            pct = max(active_job["pct"], 95)
            active_job["pct"] = pct
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": "Débruitage OpenImageDenoise…",
                "device": active_job["device"],
            })
        elif "Compositing" in stat_text:
            pct = max(active_job["pct"], 97)
            active_job["pct"] = pct
            emit({
                "type": "progress",
                "jobId": jid,
                "pct": pct,
                "phase": "Post-traitement Couleurs & Halo lumineux…",
                "device": active_job["device"],
            })

    # Pre-warm Blender empty scene & detect Cycles device once at worker boot
    rc.clear_scene()
    rc.register_progress_handler(on_stat)
    warm_device = rc.configure_cycles_device(bpy.context.scene, "AUTO")
    emit({"type": "ready", "device": warm_device})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception as exc:
            emit({"type": "error", "jobId": None, "error": f"Invalid JSON command: {exc}"})
            continue

        cmd = msg.get("cmd")
        if cmd == "quit":
            break
        if cmd == "ping":
            emit({"type": "pong", "cachedSceneHash": loaded_scene_hash, "device": warm_device})
            continue

        if cmd == "render":
            job_id = str(msg.get("jobId", ""))
            scene_hash = str(msg.get("sceneHash") or "").strip() or None
            glb_path = msg.get("glbPath")
            out_png = str(msg.get("outPng", ""))
            cfg = msg.get("config") or {}
            engine = str(cfg.get("engine", "cycles")).lower()
            prefer_dev = str(cfg.get("device", "AUTO")).upper()

            t0 = time.time()
            active_job["id"] = job_id
            active_job["pct"] = 5
            active_job["remaining"] = None
            active_job["device"] = "EEVEE" if engine == "eevee" else (warm_device if prefer_dev == "AUTO" else prefer_dev)

            try:
                cache_hit = bool(scene_hash and scene_hash == loaded_scene_hash)
                if cache_hit:
                    active_job["pct"] = 14
                    emit({
                        "type": "progress",
                        "jobId": job_id,
                        "pct": 14,
                        "phase": "Scène déjà en mémoire (cache GPU chaud) — rendu immédiat…",
                        "device": active_job["device"],
                        "cacheHit": True,
                    })
                else:
                    if not glb_path or not os.path.exists(glb_path):
                        raise RuntimeError("Fichier GLB manquant pour un cache-miss.")
                    active_job["pct"] = 8
                    emit({
                        "type": "progress",
                        "jobId": job_id,
                        "pct": 8,
                        "phase": "Importation géométrie 3D & calibration shaders AO…",
                        "device": active_job["device"],
                        "cacheHit": False,
                    })
                    rc.load_and_upgrade_scene(glb_path)
                    # Re-attach handler because clear_scene() resets bpy.app.handlers!
                    rc.register_progress_handler(on_stat)
                    loaded_scene_hash = scene_hash

                if engine == "eevee":
                    active_job["pct"] = 45
                    emit({
                        "type": "progress",
                        "jobId": job_id,
                        "pct": 45,
                        "phase": "Rendu Express EEVEE Ray-Tracing (GPU)…",
                        "device": "EEVEE",
                    })
                else:
                    active_job["pct"] = max(active_job["pct"], 16)
                    emit({
                        "type": "progress",
                        "jobId": job_id,
                        "pct": active_job["pct"],
                        "phase": f"Lancement Path-Tracing Cycles ({active_job['device']})…",
                        "device": active_job["device"],
                    })

                used_dev = rc.render_loaded_scene(cfg, out_png)
                active_job["device"] = used_dev

                if not os.path.exists(out_png):
                    raise RuntimeError("Le fichier PNG n'a pas été généré par Blender.")

                emit({
                    "type": "done",
                    "jobId": job_id,
                    "device": used_dev,
                    "cacheHit": cache_hit,
                    "cachedSceneHash": loaded_scene_hash,
                    "elapsedSec": round(time.time() - t0, 2),
                })
            except Exception as exc:
                tb_short = traceback.format_exc().splitlines()[-1]
                emit({
                    "type": "error",
                    "jobId": job_id,
                    "error": f"{exc} ({tb_short})",
                })
            finally:
                active_job["id"] = None


if __name__ == "__main__":
    main()
