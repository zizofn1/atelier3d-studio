import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  DoorOpen,
  Download,
  ImagePlus,
  Layers,
  Pause,
  Play,
  Plus,
  SkipBack,
  Sparkles,
  SunMoon,
  Trash2,
  X,
} from 'lucide-react';
import {
  DEFAULT_VIDEO_STUDIO_CONFIG,
  type VideoAspectRatio,
  type VideoCameraKeyframe,
  type VideoEasing,
  type VideoPresetId,
  type VideoQualityMode,
  type VideoStudioConfig,
} from '@/types';
import { createVideoPresetById } from '@/engine/video';
import { FR } from '@/i18n/fr';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { generateId } from '@/utils/id';
import { getSceneRegistry } from './sceneRegistry';

export function VideoStudioOverlay() {
  const doc = useProjectStore((s) => s.document);
  const updateVideoStudio = useProjectStore((s) => s.updateVideoStudio);
  const setVideoStudio = useProjectStore((s) => s.setVideoStudio);

  const videoPlayheadSec = useUIStore((s) => s.videoPlayheadSec);
  const setVideoPlayheadSec = useUIStore((s) => s.setVideoPlayheadSec);
  const videoIsPlaying = useUIStore((s) => s.videoIsPlaying);
  const setVideoIsPlaying = useUIStore((s) => s.setVideoIsPlaying);
  const setVideoStudioMode = useUIStore((s) => s.setVideoStudioMode);
  const videoExportState = useUIStore((s) => s.videoExportState);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [containerSize, setContainerSize] = useState({ width: 1280, height: 720 });
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [selectedKfId, setSelectedKfId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const config: VideoStudioConfig = doc.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;

  // Auto-seed a clean Tour Client preset on first open if no keyframes exist yet
  useEffect(() => {
    if (!doc.videoStudio) {
      setVideoStudio(createVideoPresetById('tour_client', doc));
      setVideoPlayheadSec(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track viewport size to render an exact centered 16:9 or 9:16 crop mask
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cropRect = useMemo(() => {
    const targetRatio = config.aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
    const padX = 24;
    const padTop = 64;
    const padBottom = timelineCollapsed ? 76 : 196;
    const availW = Math.max(160, containerSize.width - padX * 2);
    const availH = Math.max(140, containerSize.height - padTop - padBottom);
    let w = availW;
    let h = w / targetRatio;
    if (h > availH) {
      h = availH;
      w = h * targetRatio;
    }
    const left = Math.round((containerSize.width - w) / 2);
    const top = Math.round(padTop + (availH - h) / 2);
    return { left, top, width: Math.round(w), height: Math.round(h) };
  }, [containerSize, config.aspectRatio, timelineCollapsed]);

  const sortedKeyframes = useMemo(
    () => [...config.keyframes].sort((a, b) => a.timeSec - b.timeSec),
    [config.keyframes]
  );

  const hasDoorEvent = config.events.some((e) => e.kind === 'open_doors');
  const hasLightEvent = config.events.some((e) => e.kind === 'lighting_transition');
  const hasAssemblyEvent = config.events.some((e) => e.kind === 'assembly_mode');

  const showToast = (msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  const handleApplyPreset = (presetId: Exclude<VideoPresetId, 'custom'>) => {
    const nextCfg = createVideoPresetById(presetId, doc, config.branding);
    setVideoIsPlaying(false);
    setVideoStudio(nextCfg);
    setVideoPlayheadSec(0);
    setPresetsOpen(false);
    showToast(
      presetId === 'tour_client'
        ? 'Modèle « Tour Client » appliqué.'
        : presetId === 'reels_montage'
          ? 'Modèle « Reels Montage 9:16 » appliqué.'
          : 'Modèle « Jour → Nuit & LEDs » appliqué.'
    );
  };

  const handleCaptureKeyframe = () => {
    const pose = getSceneRegistry()?.getCurrentCameraPose?.();
    if (!pose) {
      showToast('Caméra 3D non disponible pour capturer un point clé.');
      return;
    }
    const t = Number(Math.max(0, Math.min(config.durationSec, videoPlayheadSec)).toFixed(2));
    const existingIdx = config.keyframes.findIndex((k) => Math.abs(k.timeSec - t) <= 0.15);
    let nextKeyframes: VideoCameraKeyframe[];
    let createdId: string;

    if (existingIdx >= 0) {
      createdId = config.keyframes[existingIdx].id;
      nextKeyframes = config.keyframes.map((k, idx) =>
        idx === existingIdx
          ? {
              ...k,
              timeSec: t,
              positionMm: pose.positionMm,
              targetMm: pose.targetMm,
              fovDeg: pose.fovDeg,
            }
          : k
      );
    } else {
      createdId = generateId('kf');
      nextKeyframes = [
        ...config.keyframes,
        {
          id: createdId,
          timeSec: t,
          positionMm: pose.positionMm,
          targetMm: pose.targetMm,
          fovDeg: pose.fovDeg,
          easing: 'easeInOut' as VideoEasing,
          labelFr: `Point ${config.keyframes.length + 1}`,
        },
      ].sort((a, b) => a.timeSec - b.timeSec);
    }

    updateVideoStudio({ keyframes: nextKeyframes, presetId: 'custom' });
    setSelectedKfId(createdId);
    showToast(`Point clé enregistré à ${t.toFixed(1)} s.`);
  };

  const handleDeleteKeyframe = (kfId: string) => {
    const next = config.keyframes.filter((k) => k.id !== kfId);
    updateVideoStudio({ keyframes: next, presetId: 'custom' });
    if (selectedKfId === kfId) setSelectedKfId(null);
  };

  const handleUpdateKeyframeEasing = (kfId: string, easing: VideoEasing) => {
    updateVideoStudio({
      keyframes: config.keyframes.map((k) => (k.id === kfId ? { ...k, easing } : k)),
      presetId: 'custom',
    });
  };

  const handleToggleDoorEvent = () => {
    if (hasDoorEvent) {
      updateVideoStudio({
        events: config.events.filter((e) => e.kind !== 'open_doors' && e.kind !== 'close_doors'),
        presetId: 'custom',
      });
    } else {
      const startSec = Number(
        Math.min(Math.max(0, videoPlayheadSec), Math.max(0, config.durationSec - 2.5)).toFixed(1)
      );
      updateVideoStudio({
        events: [
          ...config.events,
          {
            id: generateId('ev'),
            kind: 'open_doors',
            startSec,
            durationSec: 2.2,
            target: 'all',
          },
        ],
        presetId: 'custom',
      });
      showToast(`Ouverture des façades ajoutée à ${startSec.toFixed(1)} s.`);
    }
  };

  const handleToggleLightEvent = () => {
    if (hasLightEvent) {
      updateVideoStudio({
        events: config.events.filter((e) => e.kind !== 'lighting_transition'),
        presetId: 'custom',
      });
    } else {
      updateVideoStudio({
        events: [
          ...config.events,
          {
            id: generateId('ev'),
            kind: 'lighting_transition',
            startSec: Number((config.durationSec * 0.2).toFixed(1)),
            durationSec: Number((config.durationSec * 0.55).toFixed(1)),
            fromPreset: 'jour',
            toPreset: 'nuit',
            enableLedsAtEnd: true,
          },
        ],
        presetId: 'custom',
      });
    }
  };

  const handleToggleAssemblyEvent = () => {
    if (hasAssemblyEvent) {
      updateVideoStudio({
        events: config.events.filter((e) => e.kind !== 'assembly_mode'),
        presetId: 'custom',
      });
    } else {
      updateVideoStudio({
        events: [
          ...config.events,
          {
            id: generateId('ev'),
            kind: 'assembly_mode',
            startSec: 0.2,
            durationSec: Number(Math.max(3, config.durationSec * 0.72).toFixed(1)),
          },
        ],
        presetId: 'custom',
      });
    }
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_500_000) {
      showToast('Logo trop volumineux (max 1,5 Mo).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : undefined;
      if (dataUrl) {
        updateVideoStudio({
          branding: { ...config.branding, enabled: true, logoDataUrl: dataUrl },
        });
        showToast('Logo importé dans le filigrane.');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleTogglePlay = () => {
    if (videoIsPlaying) {
      setVideoIsPlaying(false);
      return;
    }
    if (videoPlayheadSec >= config.durationSec - 0.05) {
      setVideoPlayheadSec(0);
    }
    setVideoIsPlaying(true);
  };

  const handleExportVideo = async () => {
    if (videoExportState?.active) return;
    const ac = new AbortController();
    exportAbortRef.current = ac;
    setVideoIsPlaying(false);

    try {
      const mod = await import('@/exports/videoExport');
      const res = await mod.exportStudioVideo({
        signal: ac.signal,
      });
      if (res.status === 'cancelled') {
        showToast('Export vidéo annulé.');
      } else {
        showToast(
          res.status === 'shared'
            ? `Vidéo partagée (${res.filename ?? 'MP4/WebM'}).`
            : `Vidéo téléchargée (${res.filename ?? 'MP4/WebM'}).`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Échec de l’export vidéo.';
      showToast(msg);
    } finally {
      exportAbortRef.current = null;
    }
  };

  const selectedKeyframe = sortedKeyframes.find((k) => k.id === selectedKfId) ?? null;
  const exportPct =
    videoExportState && videoExportState.totalFrames > 0
      ? Math.min(100, Math.round((videoExportState.currentFrame / videoExportState.totalFrames) * 100))
      : 0;

  return (
    <div
      ref={containerRef}
      data-testid="video-studio-overlay"
      className="pointer-events-none absolute inset-0 z-30 select-none overflow-hidden"
    >
      {/* Live 16:9 / 9:16 Framing Crop Mask */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top matte */}
        <div
          className="absolute left-0 right-0 top-0 bg-black/55"
          style={{ height: Math.max(0, cropRect.top) }}
        />
        {/* Bottom matte */}
        <div
          className="absolute bottom-0 left-0 right-0 bg-black/55"
          style={{ top: cropRect.top + cropRect.height }}
        />
        {/* Left matte */}
        <div
          className="absolute bg-black/55"
          style={{
            left: 0,
            top: cropRect.top,
            width: Math.max(0, cropRect.left),
            height: cropRect.height,
          }}
        />
        {/* Right matte */}
        <div
          className="absolute bg-black/55"
          style={{
            left: cropRect.left + cropRect.width,
            right: 0,
            top: cropRect.top,
            height: cropRect.height,
          }}
        />

        {/* Crisp golden crop border + live format tag + live branding preview */}
        <div
          data-testid="video-framing-mask"
          data-aspect-ratio={config.aspectRatio}
          className="absolute rounded border border-atelier-accent/80 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{
            left: cropRect.left,
            top: cropRect.top,
            width: cropRect.width,
            height: cropRect.height,
          }}
        >
          <div className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-atelier-accent-text tabular-nums">
            {config.aspectRatio === '9:16' ? '1080×1920 · 9:16 Reels' : '1920×1080 · 16:9 HD'}
          </div>

          {config.branding.enabled && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-atelier-accent/50 bg-black/70 px-2.5 py-1.5 backdrop-blur-sm">
              <div className="h-6 w-1 rounded-full bg-atelier-accent" />
              {config.branding.logoDataUrl && (
                <img
                  src={config.branding.logoDataUrl}
                  alt="Logo"
                  className="h-7 w-7 rounded object-contain"
                />
              )}
              <div className="leading-tight">
                {config.branding.showCompanyName && (
                  <div className="text-xs font-bold text-white">{doc.pricing.company.name}</div>
                )}
                {config.branding.showProjectTitle && (
                  <div className="text-xs text-white/80">{doc.name}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Floating Studio Header */}
      <div className="pointer-events-auto absolute left-3 right-3 top-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="btn-exit-video-studio"
            onClick={() => {
              setVideoIsPlaying(false);
              setVideoStudioMode(false);
            }}
            className="atelier-glass inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-atelier-fg shadow-lg hover:border-atelier-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-atelier-accent-text" />
            <span>{FR.videoStudio.exit}</span>
          </button>

          {/* 1-Click Automatic Presets Dropdown */}
          <div className="relative">
            <button
              type="button"
              data-testid="btn-video-presets"
              onClick={() => setPresetsOpen((v) => !v)}
              className="atelier-glass inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-atelier-accent-text shadow-lg hover:border-atelier-accent"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>{FR.videoStudio.presetsTitle}</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {presetsOpen && (
              <div className="absolute left-0 top-full z-40 mt-1.5 w-72 rounded-xl border border-atelier-border bg-atelier-panel p-1.5 shadow-2xl space-y-1 text-xs">
                <button
                  type="button"
                  data-testid="video-preset-tour-client"
                  onClick={() => handleApplyPreset('tour_client')}
                  className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-atelier-surface"
                >
                  <span className="font-semibold text-atelier-fg">
                    {FR.videoStudio.presetTourClient}
                  </span>
                  <span className="text-xs text-atelier-muted">
                    Glissé intérieur 16:9 · 14 s · Ouverture des façades
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="video-preset-reels-montage"
                  onClick={() => handleApplyPreset('reels_montage')}
                  className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-atelier-surface"
                >
                  <span className="font-semibold text-atelier-fg">
                    {FR.videoStudio.presetReelsMontage}
                  </span>
                  <span className="text-xs text-atelier-muted">
                    Format vertical 9:16 · 10 s · Apparition progressive
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="video-preset-jour-nuit"
                  onClick={() => handleApplyPreset('jour_nuit')}
                  className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-atelier-surface"
                >
                  <span className="font-semibold text-atelier-fg">
                    {FR.videoStudio.presetJourNuit}
                  </span>
                  <span className="text-xs text-atelier-muted">
                    Coucher de soleil → Nuit 16:9 · 12 s · Allumage LEDs
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Controls: Aspect Ratio, Quality Mode, Export CTA */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="atelier-glass inline-flex h-9 items-center gap-0.5 rounded-full border p-1 text-xs shadow-lg">
            {(
              [
                { id: '16:9', label: '16:9' },
                { id: '9:16', label: '9:16 Reels' },
              ] as Array<{ id: VideoAspectRatio; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`video-aspect-${opt.id}`}
                onClick={() => updateVideoStudio({ aspectRatio: opt.id })}
                className={`inline-flex h-7 items-center rounded-full px-2.5 font-semibold transition-colors ${
                  config.aspectRatio === opt.id
                    ? 'bg-atelier-accent text-atelier-accent-fg'
                    : 'text-atelier-muted hover:text-atelier-fg'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="atelier-glass inline-flex h-9 items-center gap-0.5 rounded-full border p-1 text-xs shadow-lg">
            {(
              [
                { id: 'fast', label: 'Rapide' },
                { id: 'studio', label: 'Studio HD' },
              ] as Array<{ id: VideoQualityMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                data-testid={`video-quality-${opt.id}`}
                onClick={() => updateVideoStudio({ qualityMode: opt.id })}
                className={`inline-flex h-7 items-center rounded-full px-2.5 font-semibold transition-colors ${
                  config.qualityMode === opt.id
                    ? 'bg-atelier-accent text-atelier-accent-fg'
                    : 'text-atelier-muted hover:text-atelier-fg'
                }`}
                title={
                  opt.id === 'fast' ? FR.videoStudio.qualityFast : FR.videoStudio.qualityStudio
                }
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            data-testid="btn-export-video"
            disabled={Boolean(videoExportState?.active)}
            onClick={() => void handleExportVideo()}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-atelier-accent px-4 text-xs font-semibold text-atelier-accent-fg shadow-lg transition-colors hover:bg-atelier-accent-hover disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{FR.videoStudio.exportVideo}</span>
          </button>
        </div>
      </div>

      {/* Status Toast */}
      {statusNotice && (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full border border-atelier-accent/60 bg-atelier-panel px-4 py-1.5 text-xs font-medium text-atelier-fg shadow-xl"
        >
          {statusNotice}
        </div>
      )}

      {/* Live Video Export Progress Overlay */}
      {videoExportState?.active && (
        <div
          role="status"
          data-testid="video-export-progress"
          className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-atelier-border bg-atelier-panel p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-atelier-fg">
                <Clapperboard className="h-4 w-4 text-atelier-accent-text" />
                <span>{videoExportState.phaseFr}</span>
              </div>
              <span className="font-mono text-xs font-semibold text-atelier-accent-text tabular-nums">
                {exportPct} %
              </span>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-atelier-surface-2">
              <div
                className="h-full rounded-full bg-atelier-accent transition-all duration-150"
                style={{ width: `${exportPct}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-atelier-muted tabular-nums">
              <span>
                Image {videoExportState.currentFrame} / {videoExportState.totalFrames} — {exportPct} %
              </span>
              <button
                type="button"
                data-testid="btn-cancel-video-export"
                onClick={() => exportAbortRef.current?.abort()}
                className="inline-flex items-center gap-1 rounded-md border border-atelier-border bg-atelier-surface px-2.5 py-1 text-xs font-semibold text-atelier-danger hover:border-atelier-danger"
              >
                <X className="h-3.5 w-3.5" />
                <span>{FR.videoStudio.cancelExport}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact Collapsible Bottom Timeline Dock */}
      <div className="pointer-events-auto absolute bottom-3 left-3 right-3 mx-auto max-w-5xl rounded-2xl border border-atelier-border bg-atelier-panel/95 shadow-2xl backdrop-blur-md">
        {/* Top Row: Play/Pause, Scrubber Timecode, + Point clé, Duration & Collapse */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setVideoIsPlaying(false);
                setVideoPlayheadSec(0);
              }}
              title="Revenir au début (0 s)"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-testid="btn-video-play-pause"
              onClick={handleTogglePlay}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
            >
              {videoIsPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{videoIsPlaying ? FR.videoStudio.pause : FR.videoStudio.play}</span>
            </button>

            <span className="ml-1 font-mono text-xs font-semibold text-atelier-fg tabular-nums">
              {videoPlayheadSec.toFixed(1)} s / {config.durationSec} s
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              data-testid="btn-add-keyframe"
              onClick={handleCaptureKeyframe}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-atelier-accent/70 bg-atelier-accent/15 px-2.5 text-xs font-semibold text-atelier-accent-text hover:bg-atelier-accent/25"
              title="Capturer la position actuelle de la caméra à l’instant du curseur"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{FR.videoStudio.addKeyframe}</span>
            </button>

            <label className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-2 text-xs text-atelier-muted">
              <span>Durée</span>
              <input
                type="number"
                min={5}
                max={60}
                step={1}
                value={config.durationSec}
                onChange={(e) => {
                  const next = Math.max(5, Math.min(60, Math.round(Number(e.target.value) || 12)));
                  updateVideoStudio({ durationSec: next });
                }}
                className="w-12 rounded bg-atelier-surface-2 px-1.5 py-0.5 text-right font-mono text-xs text-atelier-fg tabular-nums focus:outline-none"
              />
              <span>s</span>
            </label>

            <button
              type="button"
              onClick={() => setTimelineCollapsed((v) => !v)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg"
              title={timelineCollapsed ? 'Déplier la timeline' : 'Réduire la timeline'}
            >
              {timelineCollapsed ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Collapsible Timeline Scrubber, Keyframe Markers & Event Toggles */}
        {!timelineCollapsed && (
          <div className="space-y-2.5 border-t border-atelier-border px-3 py-2.5">
            {/* Scrubber Track + Keyframe Diamonds */}
            <div className="relative pt-3">
              <div className="pointer-events-none absolute left-0 right-0 top-0 flex h-3 items-center">
                {sortedKeyframes.map((kf) => {
                  const leftPct = Math.max(
                    0,
                    Math.min(100, (kf.timeSec / Math.max(1, config.durationSec)) * 100)
                  );
                  const isSel = kf.id === selectedKfId;
                  return (
                    <button
                      key={kf.id}
                      type="button"
                      onClick={() => {
                        setVideoIsPlaying(false);
                        setVideoPlayheadSec(kf.timeSec);
                        setSelectedKfId(kf.id);
                      }}
                      title={`${kf.labelFr ?? 'Point clé'} (${kf.timeSec.toFixed(1)} s)`}
                      style={{ left: `${leftPct}%` }}
                      className={`pointer-events-auto absolute h-3 w-3 -translate-x-1/2 rotate-45 border transition-transform hover:scale-125 ${
                        isSel
                          ? 'border-white bg-atelier-accent'
                          : 'border-atelier-border bg-atelier-info'
                      }`}
                    />
                  );
                })}
              </div>

              <input
                type="range"
                data-testid="video-timeline-scrubber"
                aria-label="Position temporelle vidéo"
                min={0}
                max={config.durationSec}
                step={0.05}
                value={Math.min(config.durationSec, videoPlayheadSec)}
                onChange={(e) => {
                  setVideoIsPlaying(false);
                  setVideoPlayheadSec(Number(e.target.value));
                }}
                className="h-2 w-full cursor-pointer accent-atelier-accent"
              />
            </div>

            {/* Selected Keyframe Bar + Quick Event & Branding Toggles */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              {/* Quick Event Toggles */}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  data-testid="toggle-video-doors"
                  onClick={handleToggleDoorEvent}
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                    hasDoorEvent
                      ? 'border-atelier-accent bg-atelier-accent/15 text-atelier-accent-text'
                      : 'border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  <DoorOpen className="h-3.5 w-3.5" />
                  <span>{FR.videoStudio.eventOpenDoors}</span>
                </button>

                <button
                  type="button"
                  data-testid="toggle-video-daynight"
                  onClick={handleToggleLightEvent}
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                    hasLightEvent
                      ? 'border-atelier-info bg-atelier-info/15 text-atelier-info'
                      : 'border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  <SunMoon className="h-3.5 w-3.5" />
                  <span>{FR.videoStudio.eventDayNight}</span>
                </button>

                <button
                  type="button"
                  data-testid="toggle-video-assembly"
                  onClick={handleToggleAssemblyEvent}
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                    hasAssemblyEvent
                      ? 'border-emerald-500/70 bg-emerald-500/15 text-atelier-success'
                      : 'border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{FR.videoStudio.eventAssembly}</span>
                </button>

                <button
                  type="button"
                  data-testid="toggle-video-branding"
                  onClick={() =>
                    updateVideoStudio({
                      branding: { ...config.branding, enabled: !config.branding.enabled },
                    })
                  }
                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ${
                    config.branding.enabled
                      ? 'border-atelier-accent bg-atelier-accent/15 text-atelier-accent-text'
                      : 'border-atelier-border bg-atelier-surface text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  <span>{FR.videoStudio.brandingLabel}</span>
                </button>

                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleLogoFileChange}
                />
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-atelier-border bg-atelier-surface px-2 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                  title="Importer un logo local (stocké hors-ligne dans le projet)"
                >
                  <ImagePlus className="h-3.5 w-3.5" />
                  <span>{config.branding.logoDataUrl ? 'Changer logo' : FR.videoStudio.logoUpload}</span>
                </button>
              </div>

              {/* Selected Keyframe Inspector / Count */}
              <div className="flex items-center gap-1.5">
                {selectedKeyframe ? (
                  <>
                    <span className="text-xs text-atelier-muted tabular-nums">
                      {selectedKeyframe.labelFr ?? 'Point clé'} ({selectedKeyframe.timeSec.toFixed(1)} s)
                    </span>
                    <select
                      aria-label="Lissage du point clé"
                      value={selectedKeyframe.easing}
                      onChange={(e) =>
                        handleUpdateKeyframeEasing(
                          selectedKeyframe.id,
                          e.target.value as VideoEasing
                        )
                      }
                      className="h-7 rounded border border-atelier-border bg-atelier-surface px-1.5 text-xs text-atelier-fg"
                    >
                      <option value="easeInOut">Fluide</option>
                      <option value="easeOut">Décéléré</option>
                      <option value="linear">Linéaire</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleDeleteKeyframe(selectedKeyframe.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-atelier-border bg-atelier-surface text-atelier-danger hover:border-atelier-danger"
                      title="Supprimer ce point clé"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-atelier-muted tabular-nums">
                    {sortedKeyframes.length} point(s) clé(s) · {config.fps} IPS
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
