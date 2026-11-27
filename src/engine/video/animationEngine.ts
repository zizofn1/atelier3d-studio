import type {
  ModuleInstance,
  ModuleType,
  ProjectDocument,
  VideoAssemblyEvent,
  VideoCameraKeyframe,
  VideoDoorEvent,
  VideoEasing,
  VideoLightingEvent,
  VideoStudioConfig,
} from '@/types';
import {
  analyzeWalls,
  clampCameraInsideRoom,
  computeRoomBounds,
  findSafeRoomInteriorPoint,
} from '@/engine/geometry';

export interface EvaluatedCameraPose {
  positionMm: [number, number, number];
  targetMm: [number, number, number];
  fovDeg: number;
}

export interface EvaluatedAssemblyState {
  progress: number;
  scale: number;
  yOffsetMm: number;
  visible: boolean;
}

export interface EvaluatedVideoFrame {
  timeSec: number;
  camera: EvaluatedCameraPose;
  /** Deterministic per-module door/drawer open ratio [0..1] */
  moduleDoorProgress: Record<string, number>;
  /** Smooth [0..1] interpolation between Day (0) and Night (1) */
  lightingNightFactor: number;
  /** Smooth [0..1] sun elevation factor (1 = day, 0.25 = golden hour, 0 = night) */
  sunElevationFactor: number;
  /** Smooth [0..1] LED & warm accent light multiplier */
  ledIntensityFactor: number;
  /** Per-module staggered entrance state for assembly_mode */
  moduleAssembly: Record<string, EvaluatedAssemblyState>;
  /** Per-prop staggered entrance state for assembly_mode */
  propAssembly: Record<string, EvaluatedAssemblyState>;
}

const UPPER_MODULE_TYPES = new Set<ModuleType>([
  'caisson_haut',
  'meuble_haut_vitre',
  'caisson_haut_angle',
  'caisson_haut_angle_aveugle',
  'caisson_sur_frigo',
  'caisson_haut_relevant',
  'armoire_miroir_led',
]);

const SURFACE_MODULE_TYPES = new Set<ModuleType>(['plan_de_travail', 'credence']);

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function applyEasing(t: number, easing: VideoEasing): number {
  const u = clamp01(t);
  if (easing === 'linear') return u;
  if (easing === 'easeOut') {
    return 1 - Math.pow(1 - u, 3);
  }
  // Smooth cubic easeInOut
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

function catmullRomScalar(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

export function catmullRom3D(
  p0: readonly [number, number, number],
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  p3: readonly [number, number, number],
  u: number
): [number, number, number] {
  const t = clamp01(u);
  return [
    catmullRomScalar(p0[0], p1[0], p2[0], p3[0], t),
    catmullRomScalar(p0[1], p1[1], p2[1], p3[1], t),
    catmullRomScalar(p0[2], p1[2], p2[2], p3[2], t),
  ];
}

function sortKeyframes(keyframes: readonly VideoCameraKeyframe[]): VideoCameraKeyframe[] {
  return [...keyframes].sort((a, b) => a.timeSec - b.timeSec);
}

function defaultFallbackCamera(doc: ProjectDocument): EvaluatedCameraPose {
  const bounds = computeRoomBounds(doc.walls, false);
  const metrics = analyzeWalls(doc.walls);
  const safePt = findSafeRoomInteriorPoint(doc.walls, metrics);
  const eyeY = Math.min(1500, Math.max(1150, doc.ceilingHeightMm - 420));
  return {
    positionMm: [safePt.x + 600, eyeY, safePt.z + 900],
    targetMm: [bounds.center.x, Math.round(doc.ceilingHeightMm * 0.45), bounds.center.z],
    fovDeg: 64,
  };
}

/**
 * Evaluates smooth Catmull-Rom 3D camera pose (positionMm, targetMm, fovDeg) at timestamp `timeSec`.
 * Passes strictly through every keyframe at its timestamp and optionally clamps inside closed walls.
 */
export function evaluateCameraAt(
  timeSec: number,
  config: VideoStudioConfig,
  doc: ProjectDocument
): EvaluatedCameraPose {
  const t = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  const sorted = sortKeyframes(config.keyframes);

  let rawPose: EvaluatedCameraPose;

  if (sorted.length === 0) {
    rawPose = defaultFallbackCamera(doc);
  } else if (sorted.length === 1 || t <= sorted[0].timeSec) {
    const k = sorted[0];
    rawPose = {
      positionMm: [...k.positionMm] as [number, number, number],
      targetMm: [...k.targetMm] as [number, number, number],
      fovDeg: k.fovDeg,
    };
  } else if (t >= sorted[sorted.length - 1].timeSec) {
    const k = sorted[sorted.length - 1];
    rawPose = {
      positionMm: [...k.positionMm] as [number, number, number],
      targetMm: [...k.targetMm] as [number, number, number],
      fovDeg: k.fovDeg,
    };
  } else {
    // Locate active segment [k1, k2]
    let segIdx = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i].timeSec && t <= sorted[i + 1].timeSec) {
        segIdx = i;
        break;
      }
    }
    const k0 = sorted[Math.max(0, segIdx - 1)];
    const k1 = sorted[segIdx];
    const k2 = sorted[segIdx + 1];
    const k3 = sorted[Math.min(sorted.length - 1, segIdx + 2)];

    const span = Math.max(1e-6, k2.timeSec - k1.timeSec);
    const localU = clamp01((t - k1.timeSec) / span);
    const easedU = applyEasing(localU, k1.easing);

    rawPose = {
      positionMm: catmullRom3D(k0.positionMm, k1.positionMm, k2.positionMm, k3.positionMm, easedU),
      targetMm: catmullRom3D(k0.targetMm, k1.targetMm, k2.targetMm, k3.targetMm, easedU),
      fovDeg: k1.fovDeg + (k2.fovDeg - k1.fovDeg) * easedU,
    };
  }

  if (config.constrainInsideRoom && doc.walls.length >= 3) {
    const clampedM = clampCameraInsideRoom(
      [rawPose.positionMm[0] * 0.001, rawPose.positionMm[1] * 0.001, rawPose.positionMm[2] * 0.001],
      doc.walls,
      doc.ceilingHeightMm,
      220
    );
    return {
      positionMm: [clampedM[0] * 1000, clampedM[1] * 1000, clampedM[2] * 1000],
      targetMm: rawPose.targetMm,
      fovDeg: Math.max(40, Math.min(88, rawPose.fovDeg)),
    };
  }

  return {
    positionMm: rawPose.positionMm,
    targetMm: rawPose.targetMm,
    fovDeg: Math.max(40, Math.min(88, rawPose.fovDeg)),
  };
}

function classifyModuleAssemblyPhase(mod: ModuleInstance): 0 | 1 | 2 {
  if (SURFACE_MODULE_TYPES.has(mod.type)) return 1;
  if (UPPER_MODULE_TYPES.has(mod.type)) return 2;
  return 0;
}

function computeStaggerItemProgress(
  normEventT: number,
  phaseStart: number,
  phaseEnd: number,
  itemIndex: number,
  itemCount: number
): EvaluatedAssemblyState {
  if (normEventT <= 0) {
    return { progress: 0, scale: 0.001, yOffsetMm: 260, visible: false };
  }
  if (normEventT >= 1) {
    return { progress: 1, scale: 1, yOffsetMm: 0, visible: true };
  }

  const phaseSpan = Math.max(0.05, phaseEnd - phaseStart);
  const count = Math.max(1, itemCount);
  const itemDur = count === 1 ? phaseSpan : Math.max(phaseSpan * 0.42, phaseSpan / (count * 0.65));
  const staggerSpan = Math.max(0, phaseSpan - itemDur);
  const itemStart = phaseStart + (count > 1 ? (itemIndex / (count - 1)) * staggerSpan : 0);

  const raw = clamp01((normEventT - itemStart) / Math.max(0.01, itemDur));
  const eased = applyEasing(raw, 'easeOut');
  return {
    progress: raw,
    scale: 0.01 + 0.99 * eased,
    yOffsetMm: (1 - eased) * 260,
    visible: raw > 0.005,
  };
}

function evaluateAssembly(
  timeSec: number,
  assemblyEvent: VideoAssemblyEvent | undefined,
  doc: ProjectDocument
): {
  moduleAssembly: Record<string, EvaluatedAssemblyState>;
  propAssembly: Record<string, EvaluatedAssemblyState>;
} {
  const moduleAssembly: Record<string, EvaluatedAssemblyState> = {};
  const propAssembly: Record<string, EvaluatedAssemblyState> = {};
  const fullState: EvaluatedAssemblyState = {
    progress: 1,
    scale: 1,
    yOffsetMm: 0,
    visible: true,
  };

  if (!assemblyEvent) {
    for (const m of doc.modules) moduleAssembly[m.id] = fullState;
    for (const p of doc.props ?? []) propAssembly[p.id] = fullState;
    return { moduleAssembly, propAssembly };
  }

  const normT = clamp01((timeSec - assemblyEvent.startSec) / Math.max(0.1, assemblyEvent.durationSec));
  const baseMods: ModuleInstance[] = [];
  const surfaceMods: ModuleInstance[] = [];
  const upperMods: ModuleInstance[] = [];

  for (const m of doc.modules) {
    const phase = classifyModuleAssemblyPhase(m);
    if (phase === 0) baseMods.push(m);
    else if (phase === 1) surfaceMods.push(m);
    else upperMods.push(m);
  }

  baseMods.forEach((m, i) => {
    moduleAssembly[m.id] = computeStaggerItemProgress(normT, 0.0, 0.36, i, baseMods.length);
  });
  surfaceMods.forEach((m, i) => {
    moduleAssembly[m.id] = computeStaggerItemProgress(normT, 0.30, 0.56, i, surfaceMods.length);
  });
  upperMods.forEach((m, i) => {
    moduleAssembly[m.id] = computeStaggerItemProgress(normT, 0.50, 0.78, i, upperMods.length);
  });

  const props = doc.props ?? [];
  props.forEach((p, i) => {
    propAssembly[p.id] = computeStaggerItemProgress(normT, 0.72, 1.0, i, props.length);
  });

  return { moduleAssembly, propAssembly };
}

/**
 * Pure deterministic animation frame evaluator used identically by live 3D playback
 * AND offline frame-by-frame Studio video export.
 */
export function evaluateFrameAt(
  timeSec: number,
  config: VideoStudioConfig,
  doc: ProjectDocument,
  baseLightingPreset: 'jour' | 'nuit' = 'jour',
  baseLedEnabled = true
): EvaluatedVideoFrame {
  const safeDuration = Math.max(1, config.durationSec);
  const clampedT = Math.max(0, Math.min(safeDuration, Number.isFinite(timeSec) ? timeSec : 0));

  const camera = evaluateCameraAt(clampedT, config, doc);

  // 1. Evaluate door / drawer open progress per module
  const moduleDoorProgress: Record<string, number> = {};
  for (const m of doc.modules) {
    moduleDoorProgress[m.id] = 0;
  }

  const doorEvents = config.events
    .filter((e): e is VideoDoorEvent => e.kind === 'open_doors' || e.kind === 'close_doors')
    .sort((a, b) => a.startSec - b.startSec);

  for (const ev of doorEvents) {
    if (clampedT < ev.startSec) continue;
    const rawU = clamp01((clampedT - ev.startSec) / Math.max(0.05, ev.durationSec));
    const eased = applyEasing(rawU, 'easeInOut');
    const goal = ev.kind === 'open_doors' ? 1 : 0;

    for (const m of doc.modules) {
      if (ev.target !== 'all' && ev.target !== m.id) continue;
      const startVal = moduleDoorProgress[m.id] ?? 0;
      moduleDoorProgress[m.id] = startVal + (goal - startVal) * eased;
    }
  }

  // 2. Evaluate Day <-> Night lighting & LED interpolation
  let lightingNightFactor = baseLightingPreset === 'nuit' ? 1 : 0;
  let ledIntensityFactor = baseLedEnabled ? 1 : 0;

  const lightEvents = config.events
    .filter((e): e is VideoLightingEvent => e.kind === 'lighting_transition')
    .sort((a, b) => a.startSec - b.startSec);

  if (lightEvents.length > 0) {
    // Before first lighting event, honor its starting preset
    const firstLight = lightEvents[0];
    lightingNightFactor = firstLight.fromPreset === 'nuit' ? 1 : 0;
    ledIntensityFactor = firstLight.fromPreset === 'nuit' ? 1 : baseLedEnabled ? 0.35 : 0;

    for (const ev of lightEvents) {
      if (clampedT < ev.startSec) continue;
      const rawU = clamp01((clampedT - ev.startSec) / Math.max(0.05, ev.durationSec));
      const eased = applyEasing(rawU, 'easeInOut');
      const fromVal = ev.fromPreset === 'nuit' ? 1 : 0;
      const toVal = ev.toPreset === 'nuit' ? 1 : 0;
      lightingNightFactor = fromVal + (toVal - fromVal) * eased;

      const ledStart = ev.fromPreset === 'nuit' ? 1 : 0.25;
      const ledTarget = ev.enableLedsAtEnd === false ? 0 : ev.toPreset === 'nuit' ? 1 : 0.45;
      ledIntensityFactor = ledStart + (ledTarget - ledStart) * eased;
    }
  }

  // Sun dips naturally toward golden hour as night factor crosses 0.5
  const sunElevationFactor = clamp01(1 - lightingNightFactor * 0.92);

  // 3. Evaluate staggered cabinet/prop assembly entrance
  const assemblyEvent = config.events.find(
    (e): e is VideoAssemblyEvent => e.kind === 'assembly_mode'
  );
  const { moduleAssembly, propAssembly } = evaluateAssembly(clampedT, assemblyEvent, doc);

  return {
    timeSec: clampedT,
    camera,
    moduleDoorProgress,
    lightingNightFactor,
    sunElevationFactor,
    ledIntensityFactor,
    moduleAssembly,
    propAssembly,
  };
}
