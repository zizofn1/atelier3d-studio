import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Server,
  Share2,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  checkCyclesServerHealth,
  getCyclesApiKey,
  getCyclesServerUrl,
  renderWithCyclesServer,
  saveOrShareCyclesBlob,
  setCyclesApiKey,
  setCyclesServerUrl,
  type CyclesAaMode,
  type CyclesDeviceMode,
  type CyclesEngineMode,
  type CyclesHealthResult,
  type CyclesProgressUpdate,
} from '@/exports/cyclesRenderClient';

interface CyclesRenderModalProps {
  open: boolean;
  onClose: () => void;
}

const RES_PRESETS = [
  { id: 'hd', label: 'HD Rapide (1280×720)', width: 1280, height: 720 },
  { id: 'fhd', label: 'Full HD (1920×1080)', width: 1920, height: 1080 },
  { id: '2k', label: '2K Studio (2560×1440)', width: 2560, height: 1440 },
  { id: '4k', label: '4K Ultra (3840×2160)', width: 3840, height: 2160 },
] as const;

const AA_PRESETS: Array<{ id: CyclesAaMode; label: string; desc: string }> = [
  { id: 'aa4', label: 'Rapide (32 SPP)', desc: 'Aperçu rapide (~25-40s) · OpenImageDenoise' },
  {
    id: 'aa16',
    label: '16× MSAA Équiv. (80 SPP)',
    desc: 'Supersampling 1.25× + Blackman-Harris + Lanczos (125 rays/px)',
  },
  {
    id: 'aa16_ultra',
    label: 'Ultra Studio (160 SPP)',
    desc: 'Supersampling 1.5× (360 rays/px) · Arêtes ultra nettes',
  },
];

export function CyclesRenderModal({ open, onClose }: CyclesRenderModalProps) {
  const [serverUrl, setServerUrl] = useState(getCyclesServerUrl);
  const [apiKey, setApiKey] = useState(getCyclesApiKey);
  const [resId, setResId] = useState<(typeof RES_PRESETS)[number]['id']>('fhd');
  const [engineMode, setEngineMode] = useState<CyclesEngineMode>('cycles');
  const [aaMode, setAaMode] = useState<CyclesAaMode>('aa16');
  const [deviceMode, setDeviceMode] = useState<CyclesDeviceMode>('AUTO');
  const [health, setHealth] = useState<CyclesHealthResult | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState<CyclesProgressUpdate | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<{ blob: Blob; url: string; filename: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const runHealthCheck = async (targetUrl: string) => {
    setCheckingHealth(true);
    setCyclesServerUrl(targetUrl);
    const res = await checkCyclesServerHealth(targetUrl);
    setHealth(res);
    setCheckingHealth(false);
  };

  useEffect(() => {
    if (!open) return;
    void runHealthCheck(serverUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (result?.url) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  if (!open) return null;

  const chosenRes = RES_PRESETS.find((r) => r.id === resId) ?? RES_PRESETS[0];

  const handleStartRender = async () => {
    setCyclesServerUrl(serverUrl);
    setCyclesApiKey(apiKey);
    setErrorMsg(null);
    setIsRendering(true);
    setProgress({
      status: 'uploading',
      progressPct: 2,
      phaseFr: 'Préparation de la scène 3D…',
    });

    if (result?.url) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const out = await renderWithCyclesServer(
        {
          serverUrl,
          apiKey,
          width: chosenRes.width,
          height: chosenRes.height,
          engine: engineMode,
          aaMode,
          device: deviceMode,
          signal: ac.signal,
        },
        (upd) => setProgress(upd)
      );
      const url = URL.createObjectURL(out.blob);
      setResult({ blob: out.blob, url, filename: out.filename });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur inconnue pendant le rendu Cycles.');
    } finally {
      setIsRendering(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      data-testid="cycles-render-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Rendu Photoréaliste Serveur (Blender Cycles)"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-atelier-border bg-atelier-panel text-xs text-atelier-fg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-atelier-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-atelier-accent-text" />
            <div>
              <h2 className="text-sm font-semibold text-atelier-fg">
                Rendu Photoréaliste Pro (Blender Cycles)
              </h2>
              <p className="text-xs text-atelier-muted">
                Vrai Path-Tracing · Global Illumination · Anti-aliasing 16× MSAA équiv.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
            className="rounded-lg p-1.5 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
          {/* Server Connection */}
          <div className="space-y-2 rounded-xl border border-atelier-border bg-atelier-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-semibold text-atelier-fg">
                <Server className="h-3.5 w-3.5 text-atelier-accent-text" />
                <span>Serveur Maison (Python + Blender Cycles)</span>
              </span>
              <button
                type="button"
                data-testid="btn-cycles-test-conn"
                onClick={() => void runHealthCheck(serverUrl)}
                disabled={checkingHealth}
                className="inline-flex items-center gap-1 rounded border border-atelier-border bg-atelier-panel px-2 py-1 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
              >
                <RefreshCw className={`h-3 w-3 ${checkingHealth ? 'animate-spin' : ''}`} />
                <span>Tester</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-atelier-muted">URL du serveur (Wi-Fi ou Tunnel HTTPS)</span>
                <input
                  type="url"
                  data-testid="cycles-server-url-input"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="http://192.168.1.50:8787"
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2.5 text-atelier-fg focus:border-atelier-accent focus:outline-none"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-atelier-muted">Clé API (optionnelle)</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Optionnel"
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2.5 text-atelier-fg focus:border-atelier-accent focus:outline-none"
                />
              </label>
            </div>

            {health && (
              <div
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                  health.ok && health.blenderFound
                    ? 'border-emerald-500/40 bg-emerald-500/12 text-atelier-success'
                    : 'border-amber-500/40 bg-amber-500/12 text-atelier-accent-text'
                }`}
              >
                {health.ok && health.blenderFound ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Connecté · {health.blenderVersion ?? 'Blender prêt'}
                      {health.workerReady ? ` · Worker chaud (${health.workerDevice ?? 'GPU'})` : ''}
                      {health.cachedSceneHash ? ' · Scène en cache' : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 shrink-0" />
                    <span>{health.errorFr}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Engine Mode Selector: Express EEVEE vs Studio Cycles */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="cycles-engine-eevee"
              onClick={() => setEngineMode('eevee')}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                engineMode === 'eevee'
                  ? 'border-atelier-accent bg-atelier-accent/18 text-atelier-accent-text'
                  : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
              }`}
            >
              <div className="font-semibold">Aperçu Express (EEVEE)</div>
              <div className="text-xs opacity-80">Ray-tracing rapide (~3–6s) · Idéal pour tester</div>
            </button>
            <button
              type="button"
              data-testid="cycles-engine-cycles"
              onClick={() => setEngineMode('cycles')}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                engineMode === 'cycles'
                  ? 'border-atelier-accent bg-atelier-accent/18 text-atelier-accent-text'
                  : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
              }`}
            >
              <div className="font-semibold">Studio Photoréaliste (Cycles)</div>
              <div className="text-xs opacity-80">Vrai Path-Tracing · AO joints · 16× AA</div>
            </button>
          </div>

          {/* Quality & Anti-Aliasing Controls */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="font-medium text-atelier-muted">Résolution de sortie</span>
                <select
                  data-testid="cycles-resolution-select"
                  value={resId}
                  onChange={(e) => setResId(e.target.value as (typeof RES_PRESETS)[number]['id'])}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                >
                  {RES_PRESETS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>

              {engineMode === 'cycles' && (
                <label className="block space-y-1">
                  <span className="font-medium text-atelier-muted">Accélération matériel</span>
                  <select
                    data-testid="cycles-device-select"
                    value={deviceMode}
                    onChange={(e) => setDeviceMode(e.target.value as CyclesDeviceMode)}
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                  >
                    <option value="AUTO">GPU (oneAPI / RTX / AMD — défaut)</option>
                    <option value="CPU">CPU (Intel Embree)</option>
                  </select>
                </label>
              )}
            </div>

            <div className="space-y-1">
              <span className="font-medium text-atelier-muted">Anti-Aliasing & Qualité Cycles</span>
              <div className="space-y-1">
                {AA_PRESETS.map((p) => {
                  const active = aaMode === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`cycles-aa-${p.id}`}
                      onClick={() => setAaMode(p.id)}
                      className={`w-full rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                        active
                          ? 'border-atelier-accent bg-atelier-accent/18 text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      <div className="font-semibold">{p.label}</div>
                      <div className="text-xs opacity-80">{p.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Live Render Progress */}
          {isRendering && progress && (
            <div className="space-y-2 rounded-xl border border-atelier-accent/50 bg-atelier-accent/10 p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 font-semibold text-atelier-accent-text">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{progress.phaseFr}</span>
                </span>
                <span className="font-mono text-atelier-accent-text tabular-nums">
                  {progress.progressPct} %
                  {progress.elapsedSec !== undefined ? ` · ${progress.elapsedSec}s` : ''}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-atelier-surface">
                <div
                  className="h-full bg-atelier-accent transition-all duration-300"
                  style={{ width: `${Math.max(4, progress.progressPct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Notice */}
          {errorMsg && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/50 bg-red-500/12 px-3 py-2 text-xs text-atelier-danger"
            >
              {errorMsg}
            </div>
          )}

          {/* Result Preview */}
          {result && (
            <div className="space-y-2 rounded-xl border border-emerald-500/40 bg-atelier-surface-2 p-2.5">
              <img
                src={result.url}
                alt="Rendu photoréaliste Blender Cycles"
                className="max-h-72 w-full rounded-lg object-contain bg-black"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void saveOrShareCyclesBlob(result.blob, result.filename, false)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Télécharger PNG</span>
                </button>
                <button
                  type="button"
                  onClick={() => void saveOrShareCyclesBlob(result.blob, result.filename, true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-panel px-3 text-xs font-medium text-atelier-info hover:border-atelier-accent"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>Partager</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-atelier-border bg-atelier-surface-2 px-4 py-3">
          <span className="text-xs text-atelier-subtle">
            Utilise la caméra, les spots et les LEDs actuels de la vue 3D.
          </span>
          <div className="flex items-center gap-2">
            {isRendering && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="h-9 rounded-lg border border-red-500/40 bg-red-500/12 px-3 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              data-testid="btn-start-cycles-render"
              disabled={isRendering}
              onClick={() => void handleStartRender()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-atelier-accent px-4 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>
                {isRendering
                  ? 'Rendu en cours…'
                  : engineMode === 'eevee'
                    ? 'Lancer Aperçu Express (EEVEE)'
                    : 'Lancer Rendu Studio (Cycles)'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
