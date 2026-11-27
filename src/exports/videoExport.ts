import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  DEFAULT_VIDEO_STUDIO_CONFIG,
  type VideoAspectRatio,
  type VideoBrandingConfig,
  type VideoStudioConfig,
} from '@/types';
import { evaluateFrameAt } from '@/engine/video';
import { withMountedScene3D } from '@/exports/render3dExport';
import {
  applyVideoFrameSync,
  getOrbitTargetBridge,
} from '@/components/viewport3d/videoRuntimeRef';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { getDeviceQualityProfile } from '@/utils/deviceProfile';
import { shareOrDownloadBlob, triggerBlobDownload } from '@/utils/download';

export interface VideoExportDimensions {
  width: number;
  height: number;
  shadowMapSize: 2048 | 4096;
  msaaSamples: number;
}

export interface VideoMimeSelection {
  mimeType: string;
  extension: 'mp4' | 'webm';
}

export interface VideoExportOptions {
  onProgress?: (currentFrame: number, totalFrames: number, phaseFr: string) => void;
  signal?: AbortSignal;
  share?: boolean;
}

export interface VideoExportResult {
  status: 'shared' | 'downloaded' | 'cancelled';
  filename?: string;
  mimeType?: string;
  frameCount?: number;
}

/**
 * Pure resolution/VRAM helper:
 * - Desktop: 1920x1080 (16:9) or 1080x1920 (9:16), 4096px shadows
 * - Mobile/iPad: safely capped at 1280x720 / 720x1280 + 2048px shadows to avoid Safari WebGL OOM
 */
export function resolveVideoExportDimensions(
  aspectRatio: VideoAspectRatio,
  isMobileOrTablet: boolean,
  maxSamples = 4
): VideoExportDimensions {
  const safeSamples = Number.isFinite(maxSamples) ? Math.max(0, Math.min(8, Math.floor(maxSamples))) : 4;
  if (aspectRatio === '9:16') {
    return {
      width: isMobileOrTablet ? 720 : 1080,
      height: isMobileOrTablet ? 1280 : 1920,
      shadowMapSize: isMobileOrTablet ? 2048 : 4096,
      msaaSamples: safeSamples,
    };
  }
  return {
    width: isMobileOrTablet ? 1280 : 1920,
    height: isMobileOrTablet ? 720 : 1080,
    shadowMapSize: isMobileOrTablet ? 2048 : 4096,
    msaaSamples: safeSamples,
  };
}

/**
 * Selects the best 100% offline browser-supported video MIME type:
 * Priority: native MP4 (H.264 / AVC1) -> seamless WebM (VP9 -> VP8).
 */
export function selectSupportedVideoMimeType(
  isTypeSupportedFn?: (mime: string) => boolean
): VideoMimeSelection | null {
  const checker =
    isTypeSupportedFn ??
    (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (m: string) => MediaRecorder.isTypeSupported(m)
      : null);
  if (!checker) return null;

  const candidates: VideoMimeSelection[] = [
    { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=avc1', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs=h264', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const cand of candidates) {
    try {
      if (checker(cand.mimeType)) {
        return cand;
      }
    } catch {
      // Continue trying fallback codecs
    }
  }
  return null;
}

/**
 * Computes exact aspect-preserving center crop rectangle on source canvas for target ratio.
 */
export function computeCenterCropRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { sx: number; sy: number; sw: number; sh: number } {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const srcRatio = safeSrcW / safeSrcH;
  const dstRatio = Math.max(0.1, dstW) / Math.max(0.1, dstH);

  if (Math.abs(srcRatio - dstRatio) < 0.002) {
    return { sx: 0, sy: 0, sw: safeSrcW, sh: safeSrcH };
  }
  if (srcRatio > dstRatio) {
    // Source is wider than target (e.g. 9:16 crop on 16:9 viewport) -> pillarbox crop horizontally
    const sw = safeSrcH * dstRatio;
    return { sx: (safeSrcW - sw) / 2, sy: 0, sw, sh: safeSrcH };
  }
  // Source is taller -> crop vertically
  const sh = safeSrcW / dstRatio;
  return { sx: 0, sy: (safeSrcH - sh) / 2, sw: safeSrcW, sh };
}

function loadImageOptional(dataUrl?: string): Promise<HTMLImageElement | null> {
  if (!dataUrl || typeof Image === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 2000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = dataUrl;
  });
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function drawCompositeFrame(
  ctx: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  dstW: number,
  dstH: number,
  branding: VideoBrandingConfig,
  logoImg: HTMLImageElement | null,
  companyName: string,
  projectName: string
): void {
  const crop = computeCenterCropRect(sourceCanvas.width, sourceCanvas.height, dstW, dstH);
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.drawImage(sourceCanvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, dstW, dstH);

  if (!branding.enabled) return;

  const lines: string[] = [];
  if (branding.showCompanyName && companyName.trim()) {
    lines.push(companyName.trim());
  }
  if (branding.showProjectTitle && projectName.trim()) {
    lines.push(projectName.trim());
  }
  if (branding.customTagline?.trim()) {
    lines.push(branding.customTagline.trim());
  }
  if (lines.length === 0 && !logoImg) return;

  const scale = Math.max(0.75, Math.min(1.25, Math.min(dstW, dstH) / 1080));
  const padX = Math.round(20 * scale);
  const padY = Math.round(14 * scale);
  const logoSize = logoImg ? Math.round(44 * scale) : 0;
  const gapLogo = logoImg ? Math.round(14 * scale) : 0;

  const titleFontSize = Math.round(22 * scale);
  const subFontSize = Math.round(16 * scale);
  ctx.save();
  ctx.font = `700 ${titleFontSize}px system-ui, -apple-system, sans-serif`;
  let textW = 0;
  lines.forEach((line, idx) => {
    ctx.font =
      idx === 0
        ? `700 ${titleFontSize}px system-ui, -apple-system, sans-serif`
        : `500 ${subFontSize}px system-ui, -apple-system, sans-serif`;
    textW = Math.max(textW, ctx.measureText(line).width);
  });

  const lineH = Math.round(24 * scale);
  const textH = lines.length > 0 ? titleFontSize + Math.max(0, lines.length - 1) * lineH : 0;
  const contentH = Math.max(logoSize, textH);
  const boxW = padX * 2 + logoSize + gapLogo + Math.ceil(textW) + Math.round(12 * scale);
  const boxH = padY * 2 + contentH;
  const margin = Math.round(28 * scale);
  const bx = margin;
  const by = dstH - boxH - margin;

  // Frosted architectural badge
  drawRoundedRectPath(ctx, bx, by, boxW, boxH, Math.round(14 * scale));
  ctx.fillStyle = 'rgba(11, 17, 32, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
  ctx.lineWidth = Math.max(1.5, 2 * scale);
  ctx.stroke();

  // Subtle gold left accent stripe
  drawRoundedRectPath(ctx, bx + Math.round(8 * scale), by + padY, Math.round(4 * scale), contentH, 2);
  ctx.fillStyle = '#f59e0b';
  ctx.fill();

  let cursorX = bx + padX + Math.round(6 * scale);
  if (logoImg) {
    const imgY = by + (boxH - logoSize) / 2;
    ctx.drawImage(logoImg, cursorX, imgY, logoSize, logoSize);
    cursorX += logoSize + gapLogo;
  }

  let textY = by + (boxH - textH) / 2 + titleFontSize * 0.82;
  lines.forEach((line, idx) => {
    ctx.font =
      idx === 0
        ? `700 ${titleFontSize}px system-ui, -apple-system, sans-serif`
        : `500 ${subFontSize}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = idx === 0 ? '#f8fafc' : '#cbd5e1';
    ctx.fillText(line, cursorX, textY);
    textY += lineH;
  });
  ctx.restore();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * 100% Offline Video Exporter for Atelier3D Studio Vidéo:
 * - Mode 'fast': Real-time 30 FPS recording at target aspect ratio
 * - Mode 'studio': Deterministic frame-by-frame (0 dropped frames) render at HD/Full-HD with GTAO/Bloom & HD shadows
 * - Priority: native MP4 (H.264) -> automatic WebM (VP9/VP8) fallback
 */
export async function exportStudioVideo(
  options: VideoExportOptions = {}
): Promise<VideoExportResult> {
  const mime = selectSupportedVideoMimeType();
  if (!mime) {
    throw new Error(
      'Votre navigateur ne supporte pas l’enregistrement vidéo hors-ligne (MediaRecorder indisponible).'
    );
  }

  const doc = useProjectStore.getState().document;
  const config: VideoStudioConfig = doc.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;
  const fps = Math.max(15, Math.min(60, Math.round(config.fps || 30)));
  const durationSec = Math.max(3, Math.min(60, config.durationSec || 12));
  const totalFrames = Math.max(1, Math.round(durationSec * fps));

  const ui = useUIStore.getState();
  const baseLighting = ui.lightingPreset;
  const baseLed = ui.ledEnabled;

  const logoImg = await loadImageOptional(config.branding.logoDataUrl);
  const companyName = doc.pricing.company.name;

  return withMountedScene3D(async ({ gl, scene, camera, keyLight }) => {
    const profile = getDeviceQualityProfile();
    const isStudio = config.qualityMode === 'studio';
    const fullDims = resolveVideoExportDimensions(
      config.aspectRatio,
      profile.isMobileOrTablet,
      gl.capabilities.maxSamples ?? 4
    );
    // In Fast real-time mode, keep crisp 720p/1280px cap so mid-range laptops sustain smooth 30 FPS
    const dims = isStudio
      ? fullDims
      : config.aspectRatio === '9:16'
        ? { ...fullDims, width: 720, height: 1280 }
        : { ...fullDims, width: 1280, height: 720 };

    const prevSize = new THREE.Vector2();
    gl.getSize(prevSize);
    const prevPixelRatio = gl.getPixelRatio();
    const prevShadowW = keyLight?.shadow.mapSize.width ?? 1024;
    const prevShadowH = keyLight?.shadow.mapSize.height ?? 1024;
    const prevCamPos = camera.position.clone();
    const prevCamQuat = camera.quaternion.clone();
    const prevCamFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
    const prevCamAspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 16 / 9;
    const prevOrbitTarget = getOrbitTargetBridge()?.getTargetM() ?? null;

    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = dims.width;
    compositeCanvas.height = dims.height;
    const ctx = compositeCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Contexte 2D indisponible pour la composition vidéo.');
    }

    let renderTarget: THREE.WebGLRenderTarget | null = null;
    let composer: EffectComposer | null = null;
    let gtaoPass: GTAOPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let outputPass: OutputPass | null = null;
    let recorder: MediaRecorder | null = null;
    let stream: MediaStream | null = null;

    const report = (frameIdx: number, phaseFr: string) => {
      useUIStore.getState().setVideoExportState({
        active: true,
        currentFrame: frameIdx,
        totalFrames,
        phaseFr,
      });
      options.onProgress?.(frameIdx, totalFrames, phaseFr);
    };

    try {
      useUIStore.getState().setVideoIsPlaying(false);
      useUIStore.getState().setIsCapturingRender(true);
      report(0, isStudio ? 'Préparation du rendu Studio…' : 'Démarrage de la capture rapide…');

      // Configure WebGL canvas to exact target aspect ratio for zero crop loss
      if (isStudio && keyLight && (prevShadowW < dims.shadowMapSize || prevShadowH < dims.shadowMapSize)) {
        keyLight.shadow.mapSize.set(dims.shadowMapSize, dims.shadowMapSize);
        if (keyLight.shadow.map) {
          keyLight.shadow.map.dispose();
          keyLight.shadow.map = null;
        }
        keyLight.shadow.needsUpdate = true;
      }

      gl.setPixelRatio(1);
      gl.setSize(dims.width, dims.height, false);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = dims.width / dims.height;
        camera.updateProjectionMatrix();
      }

      // Optional GTAO + Bloom post-processing in Qualité Studio mode
      if (isStudio) {
        try {
          renderTarget = new THREE.WebGLRenderTarget(dims.width, dims.height, {
            type: THREE.HalfFloatType,
            samples: dims.msaaSamples,
          });
          composer = new EffectComposer(gl, renderTarget);
          composer.setPixelRatio(1);
          composer.setSize(dims.width, dims.height);
          composer.addPass(new RenderPass(scene, camera));

          gtaoPass = new GTAOPass(scene, camera, dims.width, dims.height);
          gtaoPass.output = GTAOPass.OUTPUT.Default;
          gtaoPass.updateGtaoMaterial({
            radius: 0.28,
            distanceExponent: 1.8,
            thickness: 0.85,
            scale: 1.08,
            samples: profile.isMobileOrTablet ? 8 : 12,
          });
          composer.addPass(gtaoPass);

          bloomPass = new UnrealBloomPass(new THREE.Vector2(dims.width, dims.height), 0.14, 0.4, 1.05);
          composer.addPass(bloomPass);

          outputPass = new OutputPass();
          composer.addPass(outputPass);
        } catch {
          // Graceful direct WebGL fallback if HalfFloat/GTAO is unsupported
          gtaoPass?.dispose();
          bloomPass?.dispose();
          outputPass?.dispose();
          composer?.dispose();
          renderTarget?.dispose();
          composer = null;
          renderTarget = null;
        }
      }

      // Initialize offline MediaRecorder on offscreen composite canvas
      stream = compositeCanvas.captureStream(isStudio ? 0 : fps);
      const chunks: BlobPart[] = [];
      recorder = new MediaRecorder(stream, {
        mimeType: mime.mimeType,
        videoBitsPerSecond: isStudio ? 10_000_000 : 6_000_000,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };

      const stoppedPromise = new Promise<Blob>((resolve, reject) => {
        if (!recorder) return reject(new Error('Enregistreur non initialisé.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mime.mimeType }));
        recorder.onerror = () => reject(new Error('Erreur lors de l’encodage vidéo hors-ligne.'));
      });

      recorder.start(250);
      const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & {
        requestFrame?: () => void;
      };

      let aborted = false;

      if (isStudio) {
        // MODE 2 — Qualité Studio (Deterministic Image par image — 0 saccade)
        const framePaceMs = Math.max(16, Math.round(1000 / fps));
        for (let i = 0; i < totalFrames; i++) {
          if (options.signal?.aborted) {
            aborted = true;
            break;
          }
          const t = i / fps;
          const frame = evaluateFrameAt(t, config, doc, baseLighting, baseLed);
          applyVideoFrameSync(frame);

          if (camera instanceof THREE.PerspectiveCamera) {
            camera.aspect = dims.width / dims.height;
            camera.updateProjectionMatrix();
          }

          if (composer) {
            composer.render();
          } else {
            gl.render(scene, camera);
          }

          drawCompositeFrame(
            ctx,
            gl.domElement,
            dims.width,
            dims.height,
            config.branding,
            logoImg,
            companyName,
            doc.name
          );
          videoTrack?.requestFrame?.();
          report(i + 1, 'Rendu Qualité Studio…');
          await sleep(framePaceMs);
        }
      } else {
        // MODE 1 — Rapide (Temps réel)
        const startPerf = performance.now();
        let lastFrameReported = -1;
        while (true) {
          if (options.signal?.aborted) {
            aborted = true;
            break;
          }
          const elapsedSec = (performance.now() - startPerf) / 1000;
          const clampedT = Math.min(durationSec, elapsedSec);
          const frame = evaluateFrameAt(clampedT, config, doc, baseLighting, baseLed);
          applyVideoFrameSync(frame);

          if (camera instanceof THREE.PerspectiveCamera) {
            camera.aspect = dims.width / dims.height;
            camera.updateProjectionMatrix();
          }
          gl.render(scene, camera);

          drawCompositeFrame(
            ctx,
            gl.domElement,
            dims.width,
            dims.height,
            config.branding,
            logoImg,
            companyName,
            doc.name
          );

          const curIdx = Math.min(totalFrames, Math.max(1, Math.round(clampedT * fps)));
          if (curIdx !== lastFrameReported) {
            lastFrameReported = curIdx;
            report(curIdx, 'Capture Rapide en cours…');
          }

          if (elapsedSec >= durationSec) break;
          await nextAnimationFrame();
        }
      }

      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      const blob = await stoppedPromise;

      if (aborted) {
        return { status: 'cancelled' };
      }

      const ratioTag = config.aspectRatio === '9:16' ? '9x16' : '16x9';
      const filename = `video-${slug(doc.name)}-${ratioTag}.${mime.extension}`;

      if (options.share || profile.isMobileOrTablet) {
        const res = await shareOrDownloadBlob(blob, filename, {
          title: `Vidéo 3D — ${doc.name}`,
          text: `Visite vidéo 3D Atelier3D Studio pour ${doc.name}`,
        });
        return { status: res, filename, mimeType: mime.mimeType, frameCount: totalFrames };
      }

      triggerBlobDownload(blob, filename);
      return { status: 'downloaded', filename, mimeType: mime.mimeType, frameCount: totalFrames };
    } finally {
      try {
        stream?.getTracks().forEach((tr) => tr.stop());
        gtaoPass?.dispose();
        bloomPass?.dispose();
        outputPass?.dispose();
        composer?.dispose();
        renderTarget?.dispose();
      } catch {
        // Ignore cleanup errors on lost contexts
      }

      if (isStudio && keyLight && (prevShadowW < dims.shadowMapSize || prevShadowH < dims.shadowMapSize)) {
        keyLight.shadow.mapSize.set(prevShadowW, prevShadowH);
        if (keyLight.shadow.map) {
          keyLight.shadow.map.dispose();
          keyLight.shadow.map = null;
        }
        keyLight.shadow.needsUpdate = true;
      }

      gl.setPixelRatio(prevPixelRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      camera.position.copy(prevCamPos);
      camera.quaternion.copy(prevCamQuat);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = prevCamFov;
        camera.aspect = prevCamAspect;
        camera.updateProjectionMatrix();
      }
      if (prevOrbitTarget) {
        getOrbitTargetBridge()?.setTargetM(prevOrbitTarget[0], prevOrbitTarget[1], prevOrbitTarget[2]);
      }

      // Restore scrubbed playhead preview cleanly
      const currentPlayhead = useUIStore.getState().videoPlayheadSec;
      const latestDoc = useProjectStore.getState().document;
      const latestCfg = latestDoc.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;
      if (useUIStore.getState().videoStudioMode && (latestCfg.keyframes.length > 0 || latestCfg.events.length > 0)) {
        applyVideoFrameSync(
          evaluateFrameAt(currentPlayhead, latestCfg, latestDoc, baseLighting, baseLed)
        );
      } else {
        applyVideoFrameSync(null);
      }
      gl.render(scene, camera);

      useUIStore.getState().setIsCapturingRender(false);
      useUIStore.getState().setVideoExportState(null);
    }
  });
}
