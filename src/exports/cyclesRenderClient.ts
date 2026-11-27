import type { ProjectDocument } from '@/types';
import { getSceneRegistry } from '@/components/viewport3d/sceneRegistry';
import { PROPS_CATALOG_BY_TYPE } from '@/data/propsCatalog';
import { getModuleAxes2D, resolveCeilingLighting } from '@/engine/geometry';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore, type LightingPreset } from '@/store/useUIStore';
import { shareOrDownloadBlob, triggerBlobDownload } from '@/utils/download';
import { getDeviceQualityProfile } from '@/utils/deviceProfile';
import { exportSceneGlbBlob } from './glbExport';

export type CyclesAaMode = 'aa4' | 'aa16' | 'aa16_ultra';
export type CyclesDeviceMode = 'AUTO' | 'CPU';
export type CyclesEngineMode = 'cycles' | 'eevee';

export interface CyclesCameraPose {
  positionMm: [number, number, number];
  targetMm: [number, number, number];
  fovDeg: number;
}

export interface CyclesRenderConfigPayload {
  width: number;
  height: number;
  engine: CyclesEngineMode;
  aaMode: CyclesAaMode;
  device: CyclesDeviceMode;
  exposure: number;
  ceilingHeightMm: number;
  camera: CyclesCameraPose;
  lighting: {
    preset: LightingPreset;
    sunIntensity: number;
    sunAngleDeg: number;
    spotsEnabled: boolean;
    spotIntensity: number;
    ledEnabled: boolean;
    spots: Array<{
      xMm: number;
      zMm: number;
      intensity: number;
      enabled: boolean;
    }>;
    ledStrips: Array<{
      xMm: number;
      yMm: number;
      zMm: number;
      lengthMm: number;
      heightMm?: number;
      rotationYRad: number;
      interior: boolean;
      wrap?: boolean;
      colorHex?: string;
      intensity?: number;
    }>;
    propLights: Array<{
      xMm: number;
      yMm: number;
      zMm: number;
      intensity: number;
    }>;
  };
}

export interface CyclesHealthResult {
  ok: boolean;
  blenderFound: boolean;
  blenderVersion?: string;
  workerReady?: boolean;
  workerDevice?: string;
  cachedSceneHash?: string | null;
  engines?: CyclesEngineMode[];
  aaModes?: CyclesAaMode[];
  errorFr?: string;
}

export interface CyclesProgressUpdate {
  status: 'uploading' | 'queued' | 'rendering' | 'done' | 'error';
  progressPct: number;
  phaseFr: string;
  elapsedSec?: number;
  remainingStr?: string;
  device?: string;
  cacheHit?: boolean;
}

let lastUploadedSceneKey: { serverUrl: string; hash: string } | null = null;

/**
 * Deterministic fast hash of 3D geometry & material choices (intentionally ignores
 * camera angle & light intensities so moving camera or changing spots gets a 0-MB cache hit).
 */
export function computeSceneGeometryHash(doc: ProjectDocument): string {
  const sig = JSON.stringify({
    h: doc.ceilingHeightMm,
    fm: doc.floorMaterialId,
    fc: doc.floorColorOverride,
    fg: doc.floorGroutColor,
    wc: doc.wallColor,
    dc: doc.defaultCarpentry,
    w: doc.walls,
    o: doc.openings,
    u: doc.utilities,
    m: doc.modules,
    p: doc.props ?? [],
  });
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < sig.length; i++) {
    const ch = sig.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

const STORAGE_URL_KEY = 'atelier3d_cycles_server_url';
const STORAGE_KEY_KEY = 'atelier3d_cycles_api_key';

export function getDefaultCyclesServerUrl(): string {
  const envUrl =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_RENDER_SERVER_URL as string | undefined)
      : undefined;
  return (envUrl?.trim() || 'http://localhost:8787').replace(/\/+$/, '');
}

export function getCyclesServerUrl(): string {
  if (typeof window === 'undefined') return getDefaultCyclesServerUrl();
  try {
    const saved = window.localStorage.getItem(STORAGE_URL_KEY);
    if (saved && saved.trim()) return saved.trim().replace(/\/+$/, '');
  } catch {
    // Ignore storage errors
  }
  return getDefaultCyclesServerUrl();
}

export function setCyclesServerUrl(url: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = url.trim().replace(/\/+$/, '');
    if (clean) window.localStorage.setItem(STORAGE_URL_KEY, clean);
    else window.localStorage.removeItem(STORAGE_URL_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function getCyclesApiKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setCyclesApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = key.trim();
    if (clean) window.localStorage.setItem(STORAGE_KEY_KEY, clean);
    else window.localStorage.removeItem(STORAGE_KEY_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function buildCyclesSceneConfig(
  doc: ProjectDocument,
  camera: CyclesCameraPose,
  ui: {
    lightingPreset: LightingPreset;
    ledEnabled: boolean;
    exposure: number;
    sunIntensity: number;
    sunAngleDeg: number;
  },
  options: {
    width?: number;
    height?: number;
    engine?: CyclesEngineMode;
    aaMode?: CyclesAaMode;
    device?: CyclesDeviceMode;
  } = {}
): CyclesRenderConfigPayload {
  const ceiling = resolveCeilingLighting(doc.walls, doc.ceilingLighting);

  const ledStrips: CyclesRenderConfigPayload['lighting']['ledStrips'] = [];
  for (const mod of doc.modules) {
    const { axisZ } = getModuleAxes2D(mod.rotationYRad);
    const wantsUnder =
      Boolean(mod.ledUnder) ||
      mod.type === 'caisson_haut' ||
      mod.type === 'meuble_haut_vitre' ||
      mod.type === 'caisson_haut_angle_aveugle' ||
      mod.type === 'caisson_haut_relevant';
    const ledColorHex = mod.ledColorHex ?? '#ffcf87';
    const ledIntensity = mod.ledIntensity ?? 1.0;
    if (wantsUnder && mod.yMm > 200) {
      const zOff = mod.depthMm * 0.15;
      ledStrips.push({
        xMm: Math.round(mod.xMm + axisZ.x * zOff),
        yMm: Math.round(mod.yMm - 15),
        zMm: Math.round(mod.zMm + axisZ.z * zOff),
        lengthMm: Math.max(120, Math.round(mod.widthMm - 60)),
        rotationYRad: mod.rotationYRad,
        interior: false,
        colorHex: ledColorHex,
        intensity: ledIntensity,
      });
    }
    if (mod.ledInterior || mod.type === 'meuble_vitrine') {
      ledStrips.push({
        xMm: Math.round(mod.xMm),
        yMm: Math.round(mod.yMm + mod.heightMm - 35),
        zMm: Math.round(mod.zMm),
        lengthMm: Math.max(120, Math.round(mod.widthMm - 80)),
        heightMm: Math.max(180, Math.round(mod.heightMm - 80)),
        rotationYRad: mod.rotationYRad,
        interior: true,
        wrap: mod.ledInteriorWrap !== false,
        colorHex: ledColorHex,
        intensity: ledIntensity,
      });
    }
  }

  const propLights: CyclesRenderConfigPayload['lighting']['propLights'] = [];
  for (const prop of doc.props ?? []) {
    const spec = PROPS_CATALOG_BY_TYPE[prop.type];
    if (!spec?.supportsLight || prop.lightOn === false) continue;
    propLights.push({
      xMm: Math.round(prop.xMm),
      yMm: Math.round(prop.yMm + prop.heightMm * 0.6),
      zMm: Math.round(prop.zMm),
      intensity: prop.lightIntensity ?? 1,
    });
  }

  return {
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    engine: options.engine ?? 'cycles',
    aaMode: options.aaMode ?? 'aa16',
    device: options.device ?? 'AUTO',
    exposure: ui.exposure,
    ceilingHeightMm: doc.ceilingHeightMm,
    camera,
    lighting: {
      preset: ui.lightingPreset,
      sunIntensity: ui.sunIntensity,
      sunAngleDeg: ui.sunAngleDeg,
      spotsEnabled: ceiling.spotsEnabled,
      spotIntensity: ceiling.spotIntensity,
      ledEnabled: ui.ledEnabled,
      spots: ceiling.spots.map((s) => ({
        xMm: Math.round(s.xMm),
        zMm: Math.round(s.zMm),
        intensity: s.intensity ?? 1,
        enabled: s.enabled !== false,
      })),
      ledStrips,
      propLights,
    },
  };
}

export async function checkCyclesServerHealth(serverUrl: string): Promise<CyclesHealthResult> {
  const cleanUrl = serverUrl.trim().replace(/\/+$/, '');
  if (!cleanUrl) {
    return { ok: false, blenderFound: false, errorFr: 'URL serveur vide.' };
  }
  try {
    const res = await fetch(`${cleanUrl}/api/health`, { method: 'GET' });
    if (!res.ok) {
      return {
        ok: false,
        blenderFound: false,
        errorFr: `Le serveur a répondu HTTP ${res.status}.`,
      };
    }
    const data = (await res.json()) as {
      status?: string;
      blenderFound?: boolean;
      blenderVersion?: string;
      workerReady?: boolean;
      workerDevice?: string;
      cachedSceneHash?: string | null;
      engines?: CyclesEngineMode[];
      aaModes?: CyclesAaMode[];
    };
    if (data.cachedSceneHash) {
      lastUploadedSceneKey = { serverUrl: cleanUrl, hash: data.cachedSceneHash };
    }
    return {
      ok: data.status === 'ok',
      blenderFound: Boolean(data.blenderFound),
      blenderVersion: data.blenderVersion,
      workerReady: data.workerReady,
      workerDevice: data.workerDevice,
      cachedSceneHash: data.cachedSceneHash,
      engines: data.engines,
      aaModes: data.aaModes,
      errorFr: data.blenderFound
        ? undefined
        : 'Serveur joignable, mais Blender n’est pas encore détecté sur la machine.',
    };
  } catch {
    return {
      ok: false,
      blenderFound: false,
      errorFr: `Impossible de joindre ${cleanUrl}. Vérifiez que le serveur Python est démarré.`,
    };
  }
}

function slug(str: string): string {
  return (
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'projet'
  );
}

export async function renderWithCyclesServer(
  options: {
    serverUrl: string;
    apiKey?: string;
    width: number;
    height: number;
    engine?: CyclesEngineMode;
    aaMode: CyclesAaMode;
    device?: CyclesDeviceMode;
    signal?: AbortSignal;
  },
  onProgress?: (update: CyclesProgressUpdate) => void
): Promise<{ blob: Blob; filename: string; cacheHit?: boolean }> {
  const cleanUrl = options.serverUrl.trim().replace(/\/+$/, '');
  const doc = useProjectStore.getState().document;
  const ui = useUIStore.getState();
  const engine: CyclesEngineMode = options.engine ?? 'cycles';
  const sceneHash = computeSceneGeometryHash(doc);

  const entry = getSceneRegistry();
  const cameraPose: CyclesCameraPose = entry?.getCurrentCameraPose?.() ?? {
    positionMm: [4200, 1800, 4800],
    targetMm: [1800, 900, 1500],
    fovDeg: ui.exteriorFov,
  };

  const payload = buildCyclesSceneConfig(
    doc,
    cameraPose,
    {
      lightingPreset: ui.lightingPreset,
      ledEnabled: ui.ledEnabled,
      exposure: ui.renderStyle.exposure,
      sunIntensity: ui.renderStyle.sunIntensity,
      sunAngleDeg: ui.renderStyle.sunAngleDeg,
    },
    {
      width: options.width,
      height: options.height,
      engine,
      aaMode: options.aaMode,
      device: options.device ?? 'AUTO',
    }
  );

  const headers: Record<string, string> = {};
  if (options.apiKey?.trim()) {
    headers['X-API-Key'] = options.apiKey.trim();
  }

  let startRes: Response | null = null;
  const canTryCacheOnly =
    lastUploadedSceneKey?.serverUrl === cleanUrl && lastUploadedSceneKey.hash === sceneHash;

  if (canTryCacheOnly) {
    onProgress?.({
      status: 'uploading',
      progressPct: 6,
      phaseFr: 'Scène en cache serveur (0 Mo) — envoi caméra & lumières…',
      cacheHit: true,
    });
    const cacheForm = new FormData();
    cacheForm.append('scene_hash', sceneHash);
    cacheForm.append('config', JSON.stringify(payload));
    const res = await fetch(`${cleanUrl}/api/render`, {
      method: 'POST',
      headers,
      body: cacheForm,
      signal: options.signal,
    });
    if (res.status !== 409) {
      startRes = res;
    }
  }

  if (!startRes) {
    onProgress?.({
      status: 'uploading',
      progressPct: 3,
      phaseFr: 'Exportation de la scène 3D (.glb) vers le serveur Blender…',
      cacheHit: false,
    });

    const glbBlob = await exportSceneGlbBlob();
    const form = new FormData();
    form.append('scene', glbBlob, 'scene.glb');
    form.append('scene_hash', sceneHash);
    form.append('config', JSON.stringify(payload));

    startRes = await fetch(`${cleanUrl}/api/render`, {
      method: 'POST',
      headers,
      body: form,
      signal: options.signal,
    });
  }

  if (!startRes.ok) {
    const errText = await startRes.text().catch(() => '');
    throw new Error(errText || `Erreur serveur Blender (HTTP ${startRes.status})`);
  }

  const { jobId, cacheHit: initialCacheHit } = (await startRes.json()) as {
    jobId: string;
    cacheHit?: boolean;
  };
  let finalCacheHit = Boolean(initialCacheHit);

  const notifyCancel = () => {
    void fetch(`${cleanUrl}/api/render/${jobId}/cancel`, {
      method: 'POST',
      headers,
    }).catch(() => {
      // Best-effort cancellation on server
    });
  };

  if (options.signal) {
    options.signal.addEventListener('abort', notifyCancel, { once: true });
  }

  try {
    // Poll job status until done or error
    while (true) {
      if (options.signal?.aborted) {
        throw new Error('Rendu annulé.');
      }
      await new Promise((r) => setTimeout(r, engine === 'eevee' ? 450 : 800));

      const stRes = await fetch(`${cleanUrl}/api/render/${jobId}`, {
        headers,
        signal: options.signal,
      });
      if (!stRes.ok) {
        throw new Error(`Suivi rendu interrompu (HTTP ${stRes.status}).`);
      }
      const st = (await stRes.json()) as {
        status: 'queued' | 'rendering' | 'done' | 'error';
        progressPct: number;
        phaseFr: string;
        elapsedSec?: number;
        remainingStr?: string;
        device?: string;
        cacheHit?: boolean;
        error?: string;
      };

      if (st.cacheHit) finalCacheHit = true;

      onProgress?.({
        status: st.status,
        progressPct: st.progressPct,
        phaseFr: st.phaseFr,
        elapsedSec: st.elapsedSec,
        remainingStr: st.remainingStr,
        device: st.device,
        cacheHit: finalCacheHit,
      });

      if (st.status === 'error') {
        throw new Error(st.error || 'Échec du rendu Blender.');
      }
      if (st.status === 'done') {
        lastUploadedSceneKey = { serverUrl: cleanUrl, hash: sceneHash };
        break;
      }
    }
  } finally {
    if (options.signal) {
      options.signal.removeEventListener('abort', notifyCancel);
    }
  }

  const imgRes = await fetch(`${cleanUrl}/api/render/${jobId}/image`, {
    headers,
    signal: options.signal,
  });
  if (!imgRes.ok) {
    throw new Error(`Téléchargement de l’image échoué (HTTP ${imgRes.status}).`);
  }
  const blob = await imgRes.blob();
  const tag = engine === 'eevee' ? 'eevee-express' : `cycles-${options.aaMode}`;
  const filename = `rendu-${tag}-${slug(doc.name)}.png`;
  return { blob, filename, cacheHit: finalCacheHit };
}

export async function saveOrShareCyclesBlob(
  blob: Blob,
  filename: string,
  share = false
): Promise<void> {
  const profile = getDeviceQualityProfile();
  if (share || profile.isMobileOrTablet) {
    await shareOrDownloadBlob(blob, filename, {
      title: 'Rendu Photoréaliste Atelier3D (Cycles)',
      text: 'Rendu photoréaliste généré via Blender Cycles',
    });
    return;
  }
  triggerBlobDownload(blob, filename);
}
