import type { CeilingLightingConfig, CeilingSpotLight, WallSegment } from '@/types';
import { computeRoomBounds, extractPrimaryRoomPolygon } from './wallMath';
import { findSafeRoomInteriorPoint, isPointInPolygonXZ } from './cameraZones';
import { analyzeWalls } from './wallMath';

export const DEFAULT_SPOT_INTENSITY = 0.6;
export const MIN_SPOT_INTENSITY = 0;
export const MAX_SPOT_INTENSITY = 1.5;

export type CeilingSpotPreset = 'grid_2x2' | 'center_1' | 'line_x' | 'line_z';

export function buildCeilingSpotPreset(
  walls: WallSegment[],
  preset: CeilingSpotPreset
): CeilingSpotLight[] {
  const bounds = computeRoomBounds(walls, true);
  const wallMetrics = analyzeWalls(walls);
  const safePt = findSafeRoomInteriorPoint(walls, wallMetrics);
  const poly = extractPrimaryRoomPolygon(walls);
  const closedPoly = poly && poly.isClosed && poly.points.length >= 3 ? poly.points : null;

  const clampInside = (x: number, z: number): [number, number] => {
    const rx = Math.round(x);
    const rz = Math.round(z);
    if (!closedPoly || isPointInPolygonXZ({ x: rx, z: rz }, closedPoly)) {
      return [rx, rz];
    }
    // Pull halfway toward guaranteed safe interior point if an L/U room corner falls outside
    const mx = Math.round((rx + safePt.x) / 2);
    const mz = Math.round((rz + safePt.z) / 2);
    if (isPointInPolygonXZ({ x: mx, z: mz }, closedPoly)) {
      return [mx, mz];
    }
    return [Math.round(safePt.x), Math.round(safePt.z)];
  };

  const cx = bounds.center.x;
  const cz = bounds.center.z;
  const dx = Math.min(1100, Math.max(550, bounds.widthMm * 0.24));
  const dz = Math.min(1000, Math.max(550, bounds.depthMm * 0.24));

  if (preset === 'center_1') {
    const [sx, sz] = clampInside(cx, cz);
    return [{ id: 'spot-1', labelFr: 'Spot 1', xMm: sx, zMm: sz, intensity: 1, enabled: true }];
  }

  if (preset === 'line_x') {
    const step = Math.min(1100, Math.max(550, bounds.widthMm * 0.28));
    const coords: Array<[number, number]> = [
      clampInside(cx - step, cz),
      clampInside(cx, cz),
      clampInside(cx + step, cz),
    ];
    return coords.map(([sx, sz], i) => ({
      id: `spot-${i + 1}`,
      labelFr: `Spot ${i + 1}`,
      xMm: sx,
      zMm: sz,
      intensity: 1,
      enabled: true,
    }));
  }

  if (preset === 'line_z') {
    const step = Math.min(1100, Math.max(550, bounds.depthMm * 0.28));
    const coords: Array<[number, number]> = [
      clampInside(cx, cz - step),
      clampInside(cx, cz),
      clampInside(cx, cz + step),
    ];
    return coords.map(([sx, sz], i) => ({
      id: `spot-${i + 1}`,
      labelFr: `Spot ${i + 1}`,
      xMm: sx,
      zMm: sz,
      intensity: 1,
      enabled: true,
    }));
  }

  // Default 2x2 grid
  const coords: Array<[number, number]> = [
    clampInside(cx - dx, cz - dz),
    clampInside(cx + dx, cz - dz),
    clampInside(cx - dx, cz + dz),
    clampInside(cx + dx, cz + dz),
  ];
  return coords.map(([sx, sz], i) => ({
    id: `spot-${i + 1}`,
    labelFr: `Spot ${i + 1}`,
    xMm: sx,
    zMm: sz,
    intensity: 1,
    enabled: true,
  }));
}

export function resolveCeilingLighting(
  walls: WallSegment[],
  cfg?: CeilingLightingConfig
): {
  spotIntensity: number;
  spotsEnabled: boolean;
  spots: CeilingSpotLight[];
  isCustomSpots: boolean;
} {
  const rawIntensity = cfg?.spotIntensity ?? DEFAULT_SPOT_INTENSITY;
  const spotIntensity = Math.max(
    MIN_SPOT_INTENSITY,
    Math.min(MAX_SPOT_INTENSITY, Number.isFinite(rawIntensity) ? rawIntensity : DEFAULT_SPOT_INTENSITY)
  );
  const spotsEnabled = cfg?.spotsEnabled ?? true;
  const hasCustom = Array.isArray(cfg?.spots) && cfg.spots.length > 0;
  const spots = hasCustom ? cfg!.spots! : buildCeilingSpotPreset(walls, 'grid_2x2');
  return {
    spotIntensity,
    spotsEnabled,
    spots,
    isCustomSpots: hasCustom,
  };
}
