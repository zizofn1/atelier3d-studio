import type {
  ProjectDocument,
  VideoBrandingConfig,
  VideoCameraKeyframe,
  VideoPresetId,
  VideoStudioConfig,
} from '@/types';
import { DEFAULT_VIDEO_BRANDING } from '@/types';
import {
  analyzeWalls,
  clampCameraInsideRoom,
  computeCameraZones,
  computeRoomBounds,
  findSafeRoomInteriorPoint,
} from '@/engine/geometry';

const MM = 1000;

function toMmVec(v: readonly [number, number, number]): [number, number, number] {
  return [Math.round(v[0] * MM), Math.round(v[1] * MM), Math.round(v[2] * MM)];
}

function getCabinetLookCenterMm(doc: ProjectDocument): [number, number, number] {
  if (doc.modules.length > 0) {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const m of doc.modules) {
      sx += m.xMm;
      sy += m.yMm + m.heightMm * 0.52;
      sz += m.zMm;
    }
    const n = doc.modules.length;
    return [Math.round(sx / n), Math.round(sy / n), Math.round(sz / n)];
  }
  const bounds = computeRoomBounds(doc.walls, false);
  return [
    Math.round(bounds.center.x),
    Math.round(Math.min(1350, doc.ceilingHeightMm * 0.46)),
    Math.round(bounds.center.z),
  ];
}

function buildInteriorGlideWaypoints(
  doc: ProjectDocument,
  durationSec: number,
  fovDeg: number
): VideoCameraKeyframe[] {
  const zones = computeCameraZones(doc).filter((z) => z.kind !== 'global');
  const eyeY = Math.min(1520, Math.max(1200, doc.ceilingHeightMm - 420));
  const lookCenter = getCabinetLookCenterMm(doc);

  // Pick up to 4 well-spaced interior camera zones (corners first for sweeping architectural perspectives)
  const corners = zones.filter((z) => z.kind === 'corner');
  const walls = zones.filter((z) => z.kind === 'wall');
  const ordered = [...corners, ...walls].slice(0, 4);

  if (ordered.length >= 2) {
    return ordered.map((z, idx) => {
      const timeSec = Number(((idx / (ordered.length - 1)) * durationSec).toFixed(2));
      const posMm = toMmVec(z.positionM);
      posMm[1] = eyeY;
      // Blend preset target toward cabinetry center so the camera glides organically over the joinery
      const presetTarget = toMmVec(z.targetM);
      const tgtMm: [number, number, number] = [
        Math.round(presetTarget[0] * 0.45 + lookCenter[0] * 0.55),
        Math.round(presetTarget[1] * 0.45 + lookCenter[1] * 0.55),
        Math.round(presetTarget[2] * 0.45 + lookCenter[2] * 0.55),
      ];
      return {
        id: `kf-auto-${idx + 1}`,
        timeSec,
        positionMm: posMm,
        targetMm: tgtMm,
        fovDeg,
        easing: idx === 0 ? 'easeInOut' : idx === ordered.length - 2 ? 'easeOut' : 'easeInOut',
        labelFr: z.labelFr,
      };
    });
  }

  // Fallback for open / small scenes without closed room corners
  const bounds = computeRoomBounds(doc.walls, false);
  const metrics = analyzeWalls(doc.walls);
  const safePt = findSafeRoomInteriorPoint(doc.walls, metrics);
  const radius = Math.max(1100, Math.min(2600, Math.max(bounds.widthMm, bounds.depthMm) * 0.4));
  const angles = [-0.65, 0.0, 0.65];

  return angles.map((ang, idx) => {
    const rawM: [number, number, number] = [
      (safePt.x + Math.sin(ang) * radius) * 0.001,
      eyeY * 0.001,
      (safePt.z + Math.cos(ang) * radius) * 0.001,
    ];
    const clamped =
      doc.walls.length >= 3
        ? clampCameraInsideRoom(rawM, doc.walls, doc.ceilingHeightMm, 260)
        : rawM;
    return {
      id: `kf-auto-${idx + 1}`,
      timeSec: Number(((idx / (angles.length - 1)) * durationSec).toFixed(2)),
      positionMm: toMmVec(clamped),
      targetMm: lookCenter,
      fovDeg,
      easing: 'easeInOut',
      labelFr: `Point ${idx + 1}`,
    };
  });
}

/**
 * Preset 1 — Tour Client (Intérieur fluide, 16:9):
 * Glides smoothly through room interior at eye level (~1500 mm) while opening doors mid-tour.
 */
export function createTourClientPreset(
  doc: ProjectDocument,
  prevBranding?: VideoBrandingConfig
): VideoStudioConfig {
  const durationSec = 14;
  return {
    durationSec,
    fps: 30,
    aspectRatio: '16:9',
    qualityMode: 'fast',
    constrainInsideRoom: true,
    presetId: 'tour_client',
    keyframes: buildInteriorGlideWaypoints(doc, durationSec, 66),
    events: [
      {
        id: 'ev-doors-open',
        kind: 'open_doors',
        startSec: 4.5,
        durationSec: 2.2,
        target: 'all',
      },
      {
        id: 'ev-doors-close',
        kind: 'close_doors',
        startSec: 10.2,
        durationSec: 2.0,
        target: 'all',
      },
    ],
    branding: prevBranding ? { ...prevBranding } : { ...DEFAULT_VIDEO_BRANDING },
  };
}

/**
 * Preset 2 — Reels Montage (Apparition 9:16):
 * Vertical 9:16 Reels framing with staggered cabinet assembly entrance + smooth glide.
 */
export function createReelsMontagePreset(
  doc: ProjectDocument,
  prevBranding?: VideoBrandingConfig
): VideoStudioConfig {
  const durationSec = 10;
  return {
    durationSec,
    fps: 30,
    aspectRatio: '9:16',
    qualityMode: 'fast',
    constrainInsideRoom: true,
    presetId: 'reels_montage',
    keyframes: buildInteriorGlideWaypoints(doc, durationSec, 72),
    events: [
      {
        id: 'ev-assembly-reels',
        kind: 'assembly_mode',
        startSec: 0.2,
        durationSec: 7.2,
      },
      {
        id: 'ev-doors-reels',
        kind: 'open_doors',
        startSec: 7.5,
        durationSec: 1.8,
        target: 'all',
      },
    ],
    branding: prevBranding ? { ...prevBranding } : { ...DEFAULT_VIDEO_BRANDING },
  };
}

/**
 * Preset 3 — Transition Jour → Nuit & LEDs:
 * Smooth golden-hour-to-night lighting shift turning on under-cabinet/interior LEDs & spots.
 */
export function createJourNuitPreset(
  doc: ProjectDocument,
  prevBranding?: VideoBrandingConfig
): VideoStudioConfig {
  const durationSec = 12;
  return {
    durationSec,
    fps: 30,
    aspectRatio: '16:9',
    qualityMode: 'fast',
    constrainInsideRoom: true,
    presetId: 'jour_nuit',
    keyframes: buildInteriorGlideWaypoints(doc, durationSec, 65),
    events: [
      {
        id: 'ev-day-night',
        kind: 'lighting_transition',
        startSec: 2.2,
        durationSec: 6.4,
        fromPreset: 'jour',
        toPreset: 'nuit',
        enableLedsAtEnd: true,
      },
      {
        id: 'ev-doors-night',
        kind: 'open_doors',
        startSec: 7.5,
        durationSec: 2.2,
        target: 'all',
      },
    ],
    branding: prevBranding ? { ...prevBranding } : { ...DEFAULT_VIDEO_BRANDING },
  };
}

export function createVideoPresetById(
  presetId: Exclude<VideoPresetId, 'custom'>,
  doc: ProjectDocument,
  prevBranding?: VideoBrandingConfig
): VideoStudioConfig {
  if (presetId === 'reels_montage') return createReelsMontagePreset(doc, prevBranding);
  if (presetId === 'jour_nuit') return createJourNuitPreset(doc, prevBranding);
  return createTourClientPreset(doc, prevBranding);
}
