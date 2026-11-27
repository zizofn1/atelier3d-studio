import type {
  ModuleCatalogEntry,
  ModuleInstance,
  ModuleType,
  ProjectDocument,
  SceneProp,
  SnapGuide,
  SnapResult,
  WallSegment,
} from '@/types';
import {
  analyzeWalls,
  computeRoomBounds,
  extractPrimaryRoomPolygon,
  getModuleAxes2D,
  getModuleCorners2D,
  getWallInteriorSpanMm,
  normalToRotationYRad,
  normalizeZero,
  projectModuleToWall,
  projectPointToWall,
  type Point2D,
  type WallMetrics,
} from './wallMath';
import { findSafeRoomInteriorPoint, isPointInPolygonXZ } from './cameraZones';
import { moduleToOBB2D, testOBBOverlap2D, testYOverlap } from './collision';

export interface SnapOptions {
  wallSnapThresholdMm?: number;
  cabinetSnapThresholdMm?: number;
  verticalSnapThresholdMm?: number;
  enableWallSnap?: boolean;
  enableCabinetSnap?: boolean;
  enableVerticalSnap?: boolean;
  plinthRecessMm?: number;
  ceilingHeightMm?: number;
  /** Keep candidate's current rotationYRad while snapping its rotated footprint to walls/corners */
  preserveRotation?: boolean;
}

const FLOOR_STANDING_TYPES = new Set<ModuleType>([
  'caisson_bas',
  'caisson_casserolier',
  'caisson_sous_evier',
  'caisson_bas_tiroir_porte',
  'caisson_bas_2tiroirs_porte',
  'colonne',
  'colonne_garde_manger',
  'colonne_mixte_tiroirs_portes',
  'meuble_vitrine',
  'caisson_angle',
  'caisson_angle_l',
  'caisson_angle_aveugle',
  'caisson_angle_pan_coupe',
  'ilot_central',
  'plinthe',
  'meuble_buanderie',
  'dressing_penderie',
  'dressing_etagere',
  'dressing_tiroirs',
  'portes_battantes',
  'portes_coulissantes',
  'meuble_tv',
  'bibliotheque',
  'bureau',
  'banc_entree',
]);

const BASE_CABINET_TYPES = new Set<ModuleType>([
  'caisson_bas',
  'caisson_casserolier',
  'caisson_sous_evier',
  'caisson_bas_tiroir_porte',
  'caisson_bas_2tiroirs_porte',
  'colonne',
  'colonne_garde_manger',
  'colonne_mixte_tiroirs_portes',
  'meuble_vitrine',
  'caisson_angle',
  'caisson_angle_l',
  'caisson_angle_aveugle',
  'caisson_angle_pan_coupe',
  'meuble_buanderie',
  'dressing_penderie',
  'dressing_etagere',
  'dressing_tiroirs',
  'portes_battantes',
  'portes_coulissantes',
  'banc_entree',
]);

const COUNTERTOP_SUPPORT_TYPES = new Set<ModuleType>([
  'caisson_bas',
  'caisson_casserolier',
  'caisson_sous_evier',
  'caisson_bas_tiroir_porte',
  'caisson_bas_2tiroirs_porte',
  'caisson_angle',
  'caisson_angle_l',
  'caisson_angle_aveugle',
  'caisson_angle_pan_coupe',
  'ilot_central',
]);

const WALL_HUNG_UPPER_TYPES = new Set<ModuleType>([
  'caisson_haut',
  'meuble_haut_vitre',
  'caisson_haut_angle',
  'caisson_haut_angle_aveugle',
  'caisson_sur_frigo',
  'caisson_haut_relevant',
  'armoire_miroir_led',
]);

function findCornerWallAtEndpoint(
  wm: WallMetrics,
  endpoint: Point2D,
  allMetrics: WallMetrics[]
): WallMetrics | null {
  let bestWall: WallMetrics | null = null;
  let bestPerpScore = -1;
  for (const other of allMetrics) {
    if (other.wall.id === wm.wall.id) continue;
    const nearStart =
      Math.hypot(other.start.x - endpoint.x, other.start.z - endpoint.z) <= 4;
    const nearEnd =
      Math.hypot(other.end.x - endpoint.x, other.end.z - endpoint.z) <= 4;
    let touches = nearStart || nearEnd;
    if (!touches) {
      // Also match T-junction interior hits along other wall segment
      const proj = projectPointToWall(other, endpoint);
      touches =
        proj.uRawMm >= -4 &&
        proj.uRawMm <= other.lengthMm + 4 &&
        Math.abs(proj.signedInwardDistanceMm) <= other.wall.thicknessMm / 2 + 6;
    }
    if (!touches) continue;
    const dot = Math.abs(
      wm.tangent.x * other.tangent.x + wm.tangent.z * other.tangent.z
    );
    if (dot < 0.72) {
      const score = 1 - dot;
      if (score > bestPerpScore) {
        bestPerpScore = score;
        bestWall = other;
      }
    }
  }
  return bestWall;
}

const CORNER_CABINET_TYPES = new Set<ModuleType>([
  'caisson_angle',
  'caisson_angle_l',
  'caisson_angle_pan_coupe',
  'caisson_haut_angle',
]);

/**
 * Computes the unique rotationYRad that places both (-Z) and (+X) backs of a corner cabinet
 * flush against the intersecting corner walls wallA & wallB.
 */
function computeCornerUnitRotationRad(wallA: WallMetrics, wallB: WallMetrics): number {
  const rotA = normalToRotationYRad(wallA.inwardNormal);
  const rotB = normalToRotationYRad(wallB.inwardNormal);
  const axesA = getModuleAxes2D(rotA);
  const axesB = getModuleAxes2D(rotB);
  const dotA = axesA.axisX.x * -wallB.inwardNormal.x + axesA.axisX.z * -wallB.inwardNormal.z;
  const dotB = axesB.axisX.x * -wallA.inwardNormal.x + axesB.axisX.z * -wallA.inwardNormal.z;
  return dotB > dotA ? rotB : rotA;
}

function computeRotatedFootprintOnWall(
  widthMm: number,
  depthMm: number,
  rotationYRad: number,
  tangent: Point2D,
  normal: Point2D
): { halfSpanU: number; halfSpanD: number } {
  const { axisX, axisZ } = getModuleAxes2D(rotationYRad);
  const hw = widthMm / 2;
  const hd = depthMm / 2;
  const halfSpanU =
    hw * Math.abs(axisX.x * tangent.x + axisX.z * tangent.z) +
    hd * Math.abs(axisZ.x * tangent.x + axisZ.z * tangent.z);
  const halfSpanD =
    hw * Math.abs(axisX.x * normal.x + axisX.z * normal.z) +
    hd * Math.abs(axisZ.x * normal.x + axisZ.z * normal.z);
  return { halfSpanU, halfSpanD };
}

function projectToAxes2D(
  center: Point2D,
  mod: Pick<ModuleInstance, 'xMm' | 'zMm' | 'widthMm' | 'depthMm' | 'rotationYRad'>,
  axisX: Point2D,
  axisZ: Point2D
): { xMin: number; xMax: number; zMin: number; zMax: number } {
  const { axisX: mX, axisZ: mZ } = getModuleAxes2D(mod.rotationYRad);
  const hw = mod.widthMm / 2;
  const hd = mod.depthMm / 2;
  const dx = mod.xMm - center.x;
  const dz = mod.zMm - center.z;
  const cx = dx * axisX.x + dz * axisX.z;
  const cz = dx * axisZ.x + dz * axisZ.z;
  const rx =
    hw * Math.abs(mX.x * axisX.x + mX.z * axisX.z) +
    hd * Math.abs(mZ.x * axisX.x + mZ.z * axisX.z);
  const rz =
    hw * Math.abs(mX.x * axisZ.x + mX.z * axisZ.z) +
    hd * Math.abs(mZ.x * axisZ.x + mZ.z * axisZ.z);
  return {
    xMin: cx - rx,
    xMax: cx + rx,
    zMin: cz - rz,
    zMax: cz + rz,
  };
}

export function snapModulePosition(
  candidate: ModuleInstance,
  walls: WallSegment[],
  otherModules: ModuleInstance[],
  options: SnapOptions = {}
): SnapResult {
  const wallSnapThresholdMm = options.wallSnapThresholdMm ?? 260;
  const cabinetSnapThresholdMm = options.cabinetSnapThresholdMm ?? 80;
  const verticalSnapThresholdMm = options.verticalSnapThresholdMm ?? 60;
  const enableWallSnap = options.enableWallSnap ?? true;
  const enableCabinetSnap = options.enableCabinetSnap ?? true;
  const enableVerticalSnap = options.enableVerticalSnap ?? true;
  const plinthRecessMm = options.plinthRecessMm ?? 45;
  const ceilingHeightMm = options.ceilingHeightMm ?? 2500;

  const peers = otherModules.filter((m) => m.id !== candidate.id);
  const guides: SnapGuide[] = [];

  let xMm = candidate.xMm;
  let yMm = candidate.yMm;
  let zMm = candidate.zMm;
  let rotationYRad = candidate.rotationYRad;
  let attachedWallId: string | undefined;

  const wallMetrics = analyzeWalls(walls);
  let matchedWm: WallMetrics | null = null;
  let matchedNormal: Point2D | null = null;
  let matchedTargetOffset = 0;
  let matchedU = 0;
  let matchedHalfSpanU = candidate.widthMm / 2;

  // Stage 1 — Wall-to-Cabinet Snap
  if (enableWallSnap && candidate.type !== 'ilot_central' && wallMetrics.length > 0) {
    let bestGap = Infinity;

    for (const wm of wallMetrics) {
      const proj = projectPointToWall(wm, { x: xMm, z: zMm });
      if (
        proj.uRawMm < -candidate.widthMm * 0.25 ||
        proj.uRawMm > wm.lengthMm + candidate.widthMm * 0.25
      ) {
        continue;
      }

      const activeNormal: Point2D = wm.hasPolygonOrientation
        ? wm.inwardNormal
        : proj.signedInwardDistanceMm >= 0
          ? wm.inwardNormal
          : {
              x: normalizeZero(-wm.inwardNormal.x),
              z: normalizeZero(-wm.inwardNormal.z),
            };

      const vx = xMm - wm.start.x;
      const vz = zMm - wm.start.z;
      const signedDist = vx * activeNormal.x + vz * activeNormal.z;

      const candidateRot = options.preserveRotation
        ? candidate.rotationYRad
        : normalToRotationYRad(activeNormal);
      const { halfSpanD } = computeRotatedFootprintOnWall(
        candidate.widthMm,
        candidate.depthMm,
        candidateRot,
        wm.tangent,
        activeNormal
      );
      let targetOffset = wm.wall.thicknessMm / 2 + halfSpanD;

      if (candidate.type === 'plinthe' && !options.preserveRotation) {
        const overlappingBase = peers.find((other) => {
          if (!BASE_CABINET_TYPES.has(other.type)) return false;
          const otherProj = projectModuleToWall(wm, other);
          const uOverlap =
            Math.min(otherProj.uMaxMm, proj.uRawMm + candidate.widthMm / 2) -
            Math.max(otherProj.uMinMm, proj.uRawMm - candidate.widthMm / 2);
          return (
            uOverlap > 20 &&
            Math.abs(otherProj.dMinMm - wm.wall.thicknessMm / 2) < 120
          );
        });
        if (overlappingBase) {
          targetOffset =
            wm.wall.thicknessMm / 2 +
            overlappingBase.depthMm -
            plinthRecessMm -
            candidate.depthMm / 2;
        }
      }

      const gap = Math.abs(signedDist - targetOffset);
      if (gap <= wallSnapThresholdMm && gap < bestGap) {
        bestGap = gap;
        matchedWm = wm;
        matchedNormal = activeNormal;
        matchedTargetOffset = targetOffset;
        matchedU = proj.uRawMm;
      }
    }

    if (matchedWm && matchedNormal) {
      let effRot = options.preserveRotation
        ? candidate.rotationYRad
        : normalToRotationYRad(matchedNormal);
      attachedWallId = matchedWm.wall.id;

      // Dual-wall corner snap at start & end (using signed interior span for L/U/obtuse angles)
      const wallSpan = getWallInteriorSpanMm(matchedWm, wallMetrics);
      const startCornerWall = findCornerWallAtEndpoint(
        matchedWm,
        matchedWm.start,
        wallMetrics
      );
      const endCornerWall = findCornerWallAtEndpoint(
        matchedWm,
        matchedWm.end,
        wallMetrics
      );

      // Compute tentative spans before corner orientation adjustment
      const tentativeSpan = computeRotatedFootprintOnWall(
        candidate.widthMm,
        candidate.depthMm,
        effRot,
        matchedWm.tangent,
        matchedNormal
      );
      const cornerThresholdMm = Math.max(cabinetSnapThresholdMm, 160);
      const cornerUStart = wallSpan.startInsetMm + tentativeSpan.halfSpanU;
      const cornerUEnd =
        matchedWm.lengthMm - wallSpan.endInsetMm - tentativeSpan.halfSpanU;

      let activeCornerWall: WallMetrics | null = null;
      let snapCornerSide: 'start' | 'end' | null = null;
      if (startCornerWall && Math.abs(matchedU - cornerUStart) <= cornerThresholdMm) {
        activeCornerWall = startCornerWall;
        snapCornerSide = 'start';
      } else if (endCornerWall && Math.abs(matchedU - cornerUEnd) <= cornerThresholdMm) {
        activeCornerWall = endCornerWall;
        snapCornerSide = 'end';
      }

      // Auto-orient corner cabinets so both backs (-Z and +X) sit flush into the intersecting corner
      if (activeCornerWall && !options.preserveRotation && CORNER_CABINET_TYPES.has(candidate.type)) {
        effRot = computeCornerUnitRotationRad(matchedWm, activeCornerWall);
      }

      rotationYRad = effRot;
      const finalFootprint = computeRotatedFootprintOnWall(
        candidate.widthMm,
        candidate.depthMm,
        rotationYRad,
        matchedWm.tangent,
        matchedNormal
      );
      matchedHalfSpanU = finalFootprint.halfSpanU;
      if (candidate.type !== 'plinthe' || options.preserveRotation) {
        matchedTargetOffset = matchedWm.wall.thicknessMm / 2 + finalFootprint.halfSpanD;
      }

      if (activeCornerWall && snapCornerSide === 'start') {
        matchedU = wallSpan.startInsetMm + finalFootprint.halfSpanU;
        const otherHalfT = activeCornerWall.wall.thicknessMm / 2;
        guides.push({
          kind: 'wall',
          x1Mm: activeCornerWall.start.x + activeCornerWall.inwardNormal.x * otherHalfT,
          z1Mm: activeCornerWall.start.z + activeCornerWall.inwardNormal.z * otherHalfT,
          x2Mm: activeCornerWall.end.x + activeCornerWall.inwardNormal.x * otherHalfT,
          z2Mm: activeCornerWall.end.z + activeCornerWall.inwardNormal.z * otherHalfT,
          labelFr: `Angle ${activeCornerWall.wall.labelFr ?? 'Mur'}`,
        });
      } else if (activeCornerWall && snapCornerSide === 'end') {
        matchedU = matchedWm.lengthMm - wallSpan.endInsetMm - finalFootprint.halfSpanU;
        const otherHalfT = activeCornerWall.wall.thicknessMm / 2;
        guides.push({
          kind: 'wall',
          x1Mm: activeCornerWall.start.x + activeCornerWall.inwardNormal.x * otherHalfT,
          z1Mm: activeCornerWall.start.z + activeCornerWall.inwardNormal.z * otherHalfT,
          x2Mm: activeCornerWall.end.x + activeCornerWall.inwardNormal.x * otherHalfT,
          z2Mm: activeCornerWall.end.z + activeCornerWall.inwardNormal.z * otherHalfT,
          labelFr: `Angle ${activeCornerWall.wall.labelFr ?? 'Mur'}`,
        });
      }

      xMm =
        matchedWm.start.x +
        matchedWm.tangent.x * matchedU +
        matchedNormal.x * matchedTargetOffset;
      zMm =
        matchedWm.start.z +
        matchedWm.tangent.z * matchedU +
        matchedNormal.z * matchedTargetOffset;

      const faceHalfT = matchedWm.wall.thicknessMm / 2;
      guides.push({
        kind: 'wall',
        x1Mm: matchedWm.start.x + matchedNormal.x * faceHalfT,
        z1Mm: matchedWm.start.z + matchedNormal.z * faceHalfT,
        x2Mm: matchedWm.end.x + matchedNormal.x * faceHalfT,
        z2Mm: matchedWm.end.z + matchedNormal.z * faceHalfT,
        labelFr: matchedWm.wall.labelFr ?? 'Mur',
      });
    }
  }

  // Stage 2 — Cabinet-to-Cabinet Snap
  if (enableCabinetSnap && peers.length > 0) {
    if (matchedWm && matchedNormal) {
      const candYMin = yMm;
      const candYMax = yMm + candidate.heightMm;
      let bestDelta = Infinity;
      let bestUTarget: number | null = null;
      let bestContactU = 0;

      for (const other of peers) {
        const { axisZ: otherZ } = getModuleAxes2D(other.rotationYRad);
        const dotN = Math.abs(
          otherZ.x * matchedNormal.x + otherZ.z * matchedNormal.z
        );
        const otherProj = projectModuleToWall(matchedWm, other);
        // Allow snapping side-to-side against perpendicular corner peers standing close to matchedWm's wall face
        const nearMatchedWallFace =
          Math.abs(otherProj.dMinMm - matchedWm.wall.thicknessMm / 2) < 200;
        if (!nearMatchedWallFace && dotN < 0.95 && other.attachedWallId !== matchedWm.wall.id) {
          continue;
        }
        if (
          other.attachedWallId !== matchedWm.wall.id &&
          !nearMatchedWallFace
        ) {
          continue;
        }

        const yOverlap =
          Math.min(candYMax, otherProj.yMaxMm) -
          Math.max(candYMin, otherProj.yMinMm);
        const hasYOverlap = yOverlap > 0.5;

        const targets: Array<{ uCenter: number; contactU: number }> = [
          {
            uCenter: otherProj.uMaxMm + matchedHalfSpanU,
            contactU: otherProj.uMaxMm,
          },
          {
            uCenter: otherProj.uMinMm - matchedHalfSpanU,
            contactU: otherProj.uMinMm,
          },
        ];

        if (!hasYOverlap) {
          targets.push(
            {
              uCenter: otherProj.uMinMm + matchedHalfSpanU,
              contactU: otherProj.uMinMm,
            },
            {
              uCenter: otherProj.uMaxMm - matchedHalfSpanU,
              contactU: otherProj.uMaxMm,
            }
          );
        }

        for (const t of targets) {
          const delta = Math.abs(t.uCenter - matchedU);
          if (delta <= cabinetSnapThresholdMm && delta < bestDelta) {
            bestDelta = delta;
            bestUTarget = t.uCenter;
            bestContactU = t.contactU;
          }
        }
      }

      if (bestUTarget !== null && !guides.some((g) => g.labelFr?.startsWith('Angle '))) {
        matchedU = bestUTarget;
        xMm =
          matchedWm.start.x +
          matchedWm.tangent.x * matchedU +
          matchedNormal.x * matchedTargetOffset;
        zMm =
          matchedWm.start.z +
          matchedWm.tangent.z * matchedU +
          matchedNormal.z * matchedTargetOffset;

        const faceHalfT = matchedWm.wall.thicknessMm / 2;
        const gx1 =
          matchedWm.start.x +
          matchedWm.tangent.x * bestContactU +
          matchedNormal.x * faceHalfT;
        const gz1 =
          matchedWm.start.z +
          matchedWm.tangent.z * bestContactU +
          matchedNormal.z * faceHalfT;
        const gx2 = gx1 + matchedNormal.x * candidate.depthMm;
        const gz2 = gz1 + matchedNormal.z * candidate.depthMm;
        guides.push({
          kind: 'cabinet_flush',
          x1Mm: gx1,
          z1Mm: gz1,
          x2Mm: gx2,
          z2Mm: gz2,
          labelFr: 'Alignement caisson',
        });
      }
    } else {
      // Free-standing snap along candidate's local axes
      const { axisX, axisZ } = getModuleAxes2D(rotationYRad);
      const origin: Point2D = { x: xMm, z: zMm };
      const candHW = candidate.widthMm / 2;
      const candHD = candidate.depthMm / 2;

      let bestDeltaX = Infinity;
      let shiftX = 0;
      let flushContactX = 0;

      let bestDeltaZ = Infinity;
      let shiftZ = 0;
      let frontContactZ = 0;

      for (const other of peers) {
        const { axisZ: otherAxisZ } = getModuleAxes2D(other.rotationYRad);
        const parallel = Math.abs(
          axisZ.x * otherAxisZ.x + axisZ.z * otherAxisZ.z
        );
        if (parallel < 0.99) continue;

        const box = projectToAxes2D(origin, other, axisX, axisZ);
        const zClose =
          Math.min(candHD, box.zMax) - Math.max(-candHD, box.zMin) > -150;
        const xClose =
          Math.min(candHW, box.xMax) - Math.max(-candHW, box.xMin) > -150;

        if (zClose) {
          const xTargets = [
            { shift: box.xMax + candHW, contact: box.xMax },
            { shift: box.xMin - candHW, contact: box.xMin },
          ];
          for (const t of xTargets) {
            const d = Math.abs(t.shift);
            if (d <= cabinetSnapThresholdMm && d < bestDeltaX) {
              bestDeltaX = d;
              shiftX = t.shift;
              flushContactX = t.contact;
            }
          }
        }

        if (xClose) {
          const zTargets = [
            { shift: box.zMax - candHD, contact: box.zMax }, // Front-to-front align
            { shift: box.zMin - candHD, contact: box.zMin }, // Back-to-back flush
            { shift: box.zMax + candHD, contact: box.zMax }, // Back-to-front flush
          ];
          for (const t of zTargets) {
            const d = Math.abs(t.shift);
            if (d <= cabinetSnapThresholdMm && d < bestDeltaZ) {
              bestDeltaZ = d;
              shiftZ = t.shift;
              frontContactZ = t.contact;
            }
          }
        }
      }

      if (bestDeltaX <= cabinetSnapThresholdMm) {
        xMm += axisX.x * shiftX;
        zMm += axisX.z * shiftX;
        const cx = origin.x + axisX.x * flushContactX;
        const cz = origin.z + axisX.z * flushContactX;
        guides.push({
          kind: 'cabinet_flush',
          x1Mm: cx - axisZ.x * candHD,
          z1Mm: cz - axisZ.z * candHD,
          x2Mm: cx + axisZ.x * candHD,
          z2Mm: cz + axisZ.z * candHD,
          labelFr: 'Alignement caisson',
        });
      }

      if (bestDeltaZ <= cabinetSnapThresholdMm) {
        xMm += axisZ.x * shiftZ;
        zMm += axisZ.z * shiftZ;
        const cx = origin.x + axisZ.x * frontContactZ;
        const cz = origin.z + axisZ.z * frontContactZ;
        guides.push({
          kind: 'cabinet_front',
          x1Mm: cx - axisX.x * candHW,
          z1Mm: cz - axisX.z * candHW,
          x2Mm: cx + axisX.x * candHW,
          z2Mm: cz + axisX.z * candHW,
          labelFr: 'Alignement façade',
        });
      }
    }
  }

  // Stage 3 — Vertical Alignment Snap
  if (enableVerticalSnap) {
    let snappedY: number | null = null;
    let verticalLabel = 'Alignement vertical';

    if (FLOOR_STANDING_TYPES.has(candidate.type)) {
      if (Math.abs(yMm) <= verticalSnapThresholdMm) {
        snappedY = 0;
        verticalLabel = 'Sol (0 mm)';
      }
    } else if (WALL_HUNG_UPPER_TYPES.has(candidate.type)) {
      const targets: Array<{ y: number; label: string }> = [
        { y: candidate.type === 'armoire_miroir_led' ? 1280 : 1470, label: 'Hauteur standard' },
        {
          y: Math.max(0, ceilingHeightMm - candidate.heightMm),
          label: 'Plafond',
        },
      ];
      for (const other of peers) {
        if (WALL_HUNG_UPPER_TYPES.has(other.type)) {
          targets.push({ y: other.yMm, label: 'Alignement caisson haut' });
          targets.push({
            y: other.yMm + other.heightMm - candidate.heightMm,
            label: 'Alignement haut caisson',
          });
        } else if (
          other.type === 'colonne' ||
          other.type === 'colonne_garde_manger' ||
          other.type === 'colonne_mixte_tiroirs_portes' ||
          other.type === 'meuble_vitrine'
        ) {
          targets.push({
            y: Math.max(0, other.yMm + other.heightMm - candidate.heightMm),
            label: 'Alignement sommet colonne',
          });
        }
      }
      let bestDy = Infinity;
      for (const t of targets) {
        const dy = Math.abs(t.y - yMm);
        if (dy <= verticalSnapThresholdMm && dy < bestDy) {
          bestDy = dy;
          snappedY = t.y;
          verticalLabel = t.label;
        }
      }
    } else if (candidate.type === 'plan_de_travail') {
      const { axisX, axisZ } = getModuleAxes2D(rotationYRad);
      const origin: Point2D = { x: xMm, z: zMm };
      const candHW = candidate.widthMm / 2;
      const candHD = candidate.depthMm / 2;

      let bestDy = Infinity;
      for (const other of peers) {
        if (!COUNTERTOP_SUPPORT_TYPES.has(other.type)) continue;
        const box = projectToAxes2D(origin, other, axisX, axisZ);
        const xOv = Math.min(candHW, box.xMax) - Math.max(-candHW, box.xMin);
        const zOv = Math.min(candHD, box.zMax) - Math.max(-candHD, box.zMin);
        if (xOv <= 10 || zOv <= 10) continue;
        const targetY = other.yMm + other.heightMm;
        const dy = Math.abs(targetY - yMm);
        if (dy <= verticalSnapThresholdMm && dy < bestDy) {
          bestDy = dy;
          snappedY = targetY;
          verticalLabel = 'Pose sur caisson bas';
        }
      }
      if (snappedY === null && Math.abs(yMm - 860) <= verticalSnapThresholdMm) {
        snappedY = 860;
        verticalLabel = 'Hauteur plan (860 mm)';
      }
    } else if (candidate.type === 'credence') {
      const { axisX, axisZ } = getModuleAxes2D(rotationYRad);
      const origin: Point2D = { x: xMm, z: zMm };
      const candHW = candidate.widthMm / 2;
      const candHD = candidate.depthMm / 2;

      let bestDy = Infinity;
      for (const other of peers) {
        if (other.type !== 'plan_de_travail') continue;
        const box = projectToAxes2D(origin, other, axisX, axisZ);
        const xOv = Math.min(candHW, box.xMax) - Math.max(-candHW, box.xMin);
        const zOv = Math.min(candHD, box.zMax) - Math.max(-candHD, box.zMin);
        if (xOv <= 10 || zOv <= 10) continue;
        const targetY = other.yMm + other.heightMm;
        const dy = Math.abs(targetY - yMm);
        if (dy <= verticalSnapThresholdMm && dy < bestDy) {
          bestDy = dy;
          snappedY = targetY;
          verticalLabel = 'Pose sur plan de travail';
        }
      }
      if (snappedY === null && Math.abs(yMm - 898) <= verticalSnapThresholdMm) {
        snappedY = 898;
        verticalLabel = 'Hauteur crédence (898 mm)';
      }
    }

    // Tall ceiling alignment fallback
    if (
      snappedY === null &&
      yMm > verticalSnapThresholdMm &&
      Math.abs(yMm + candidate.heightMm - ceilingHeightMm) <=
        verticalSnapThresholdMm
    ) {
      snappedY = Math.max(0, ceilingHeightMm - candidate.heightMm);
      verticalLabel = 'Alignement plafond';
    }

    if (snappedY !== null) {
      yMm = snappedY;
      guides.push({
        kind: 'vertical',
        x1Mm: xMm - candidate.widthMm / 2,
        z1Mm: zMm,
        x2Mm: xMm + candidate.widthMm / 2,
        z2Mm: zMm,
        yMm,
        labelFr: verticalLabel,
      });
    }
  }

  return {
    xMm: normalizeZero(xMm),
    yMm: normalizeZero(yMm),
    zMm: normalizeZero(zMm),
    rotationYRad: normalizeZero(rotationYRad),
    attachedWallId,
    guides,
  };
}

export interface InteriorSpawnResult {
  xMm: number;
  yMm: number;
  zMm: number;
  rotationYRad: number;
  attachedWallId?: string;
}

/**
 * Finds a guaranteed interior spawn position inside the room polygon, snapped
 * cleanly against an interior wall (or room center for freestanding islands),
 * avoiding existing modules and wall openings whenever space permits.
 */
export function findInteriorSpawnPosition(
  doc: ProjectDocument,
  spec: Pick<
    ModuleCatalogEntry,
    'type' | 'defaultWidthMm' | 'defaultHeightMm' | 'defaultDepthMm' | 'defaultYMm'
  >,
  preferredWallId?: string | null
): InteriorSpawnResult {
  const widthMm = spec.defaultWidthMm;
  const heightMm = spec.defaultHeightMm;
  const depthMm = spec.defaultDepthMm;
  const yMm = spec.defaultYMm;

  if (doc.walls.length === 0) {
    const count = doc.modules.length;
    return {
      xMm: 600 + (count % 4) * 850,
      yMm,
      zMm: 600 + Math.floor(count / 4) * 700,
      rotationYRad: 0,
    };
  }

  const wallMetrics = analyzeWalls(doc.walls);
  const poly = extractPrimaryRoomPolygon(doc.walls);
  const closedPoly = poly && poly.isClosed && poly.points.length >= 3 ? poly.points : null;
  const safeInterior = findSafeRoomInteriorPoint(doc.walls, wallMetrics);

  const isInsideRoom = (cand: {
    xMm: number;
    zMm: number;
    widthMm: number;
    depthMm: number;
    rotationYRad: number;
  }): boolean => {
    if (!closedPoly) return true;
    // Inset corners slightly by 10 mm so flush wall-touching corners count as strictly inside
    const insetCand = {
      ...cand,
      widthMm: Math.max(20, cand.widthMm - 20),
      depthMm: Math.max(20, cand.depthMm - 20),
    };
    const corners = getModuleCorners2D(insetCand);
    return corners.every((c) => isPointInPolygonXZ(c, closedPoly));
  };

  const hasModuleOverlap = (cand: {
    xMm: number;
    yMm: number;
    zMm: number;
    widthMm: number;
    heightMm: number;
    depthMm: number;
    rotationYRad: number;
  }): boolean => {
    const candObb = moduleToOBB2D(cand);
    for (const existing of doc.modules) {
      if (!testYOverlap(cand.yMm, cand.heightMm, existing.yMm, existing.heightMm, 2)) {
        continue;
      }
      const res = testOBBOverlap2D(candObb, moduleToOBB2D(existing));
      if (res.overlaps && res.penetrationMm > 2) return true;
    }
    return false;
  };

  const overlapsOpeningOnWall = (wm: WallMetrics, uMin: number, uMax: number): boolean => {
    for (const op of doc.openings) {
      if (op.wallId !== wm.wall.id) continue;
      if (!testYOverlap(yMm, heightMm, op.sillHeightMm, op.heightMm, 2)) continue;
      const opStart = op.offsetFromStartMm;
      const opEnd = opStart + op.widthMm;
      if (Math.min(uMax, opEnd) - Math.max(uMin, opStart) > 10) {
        return true;
      }
    }
    return false;
  };

  // Freestanding island: place near room interior center, nudging inside polygon if occupied
  if (spec.type === 'ilot_central') {
    const offsets: Array<[number, number]> = [
      [0, 0],
      [0, 350],
      [0, -350],
      [450, 0],
      [-450, 0],
      [450, 350],
      [-450, 350],
    ];
    for (const [ox, oz] of offsets) {
      const cand = {
        xMm: Math.round(safeInterior.x + ox),
        yMm,
        zMm: Math.round(safeInterior.z + oz),
        widthMm,
        heightMm,
        depthMm,
        rotationYRad: 0,
      };
      if (isInsideRoom(cand) && !hasModuleOverlap(cand)) {
        return { xMm: cand.xMm, yMm, zMm: cand.zMm, rotationYRad: 0 };
      }
    }
    return {
      xMm: Math.round(safeInterior.x),
      yMm,
      zMm: Math.round(safeInterior.z),
      rotationYRad: 0,
    };
  }

  // Wall-attached modules: scan walls starting with preferredWallId (if set) then natural wall order
  const orderedWalls: WallMetrics[] = [...wallMetrics];
  if (preferredWallId) {
    orderedWalls.sort((a, b) =>
      a.wall.id === preferredWallId ? -1 : b.wall.id === preferredWallId ? 1 : 0
    );
  }

  let bestInsideFallback: InteriorSpawnResult | null = null;

  for (const wm of orderedWalls) {
    if (wm.lengthMm < 200) continue;
    const startCorner = findCornerWallAtEndpoint(wm, wm.start, wallMetrics);
    const endCorner = findCornerWallAtEndpoint(wm, wm.end, wallMetrics);
    const startPad = (startCorner ? startCorner.wall.thicknessMm / 2 : 0) + 10;
    const endPad = (endCorner ? endCorner.wall.thicknessMm / 2 : 0) + 10;

    const uMinAllowed = startPad + widthMm / 2;
    const uMaxAllowed = wm.lengthMm - endPad - widthMm / 2;
    const rotY = normalToRotationYRad(wm.inwardNormal);
    const offset = wm.wall.thicknessMm / 2 + depthMm / 2;

    // Generate candidate u coordinates along the wall
    const uCandidates: number[] = [];
    if (uMinAllowed <= uMaxAllowed) {
      const step = 100;
      for (let u = uMinAllowed; u <= uMaxAllowed; u += step) {
        uCandidates.push(u);
      }
      if (uCandidates[uCandidates.length - 1] !== uMaxAllowed) {
        uCandidates.push(uMaxAllowed);
      }
    } else {
      uCandidates.push(wm.lengthMm / 2);
    }

    for (const u of uCandidates) {
      const xMm = Math.round(wm.start.x + wm.tangent.x * u + wm.inwardNormal.x * offset);
      const zMm = Math.round(wm.start.z + wm.tangent.z * u + wm.inwardNormal.z * offset);
      const cand = { xMm, yMm, zMm, widthMm, heightMm, depthMm, rotationYRad: rotY };

      if (!isInsideRoom(cand)) continue;
      if (!bestInsideFallback) {
        bestInsideFallback = {
          xMm,
          yMm,
          zMm,
          rotationYRad: rotY,
          attachedWallId: wm.wall.id,
        };
      }
      if (overlapsOpeningOnWall(wm, u - widthMm / 2, u + widthMm / 2)) continue;
      if (!hasModuleOverlap(cand)) {
        return {
          xMm,
          yMm,
          zMm,
          rotationYRad: rotY,
          attachedWallId: wm.wall.id,
        };
      }
    }
  }

  if (bestInsideFallback) {
    return bestInsideFallback;
  }

  // Final guaranteed interior fallback (never outside room bounds)
  const bounds = computeRoomBounds(doc.walls, false);
  const firstWm = orderedWalls[0];
  const rotY = firstWm ? normalToRotationYRad(firstWm.inwardNormal) : 0;
  return {
    xMm: Math.round(
      Math.max(bounds.minX + 200, Math.min(bounds.maxX - 200, safeInterior.x))
    ),
    yMm,
    zMm: Math.round(
      Math.max(bounds.minZ + 200, Math.min(bounds.maxZ - 200, safeInterior.z))
    ),
    rotationYRad: rotY,
    attachedWallId: firstWm?.wall.id,
  };
}

export interface PropSnapOptions {
  freePlacement?: boolean;
  ceilingHeightMm?: number;
  /** Keep candidate's current rotationYRad while aligning rotated footprint to walls/corners */
  preserveRotation?: boolean;
}

export interface PropSnapResult {
  xMm: number;
  yMm: number;
  zMm: number;
  rotationYRad: number;
  attachedWallId?: string;
  snappedConstraint?: 'niche' | 'countertop' | 'wall' | 'ceiling' | 'floor' | 'free';
  guides?: SnapGuide[];
}

const PROP_COUNTERTOP_HOST_TYPES = new Set<ModuleType>([
  'plan_de_travail',
  'caisson_bas',
  'caisson_casserolier',
  'caisson_sous_evier',
  'caisson_angle',
  'ilot_central',
]);

/**
 * Smart placement constraints for Électroménager, Éclairage & Déco.
 * When `options.freePlacement` is true (or Alt is held while dragging), all constraints are bypassed.
 * Props placed near a wall or 2-wall corner automatically align cleanly with both intersecting walls;
 * passing `preserveRotation: true` preserves the user's chosen orientation while keeping flush contact.
 */
export function snapPropPosition(
  candidate: SceneProp,
  walls: WallSegment[],
  modules: ModuleInstance[],
  options: PropSnapOptions = {}
): PropSnapResult {
  const ceilingHeightMm = options.ceilingHeightMm ?? 2500;
  let xMm = Math.round(candidate.xMm);
  let yMm = Math.round(candidate.yMm);
  let zMm = Math.round(candidate.zMm);
  let rotationYRad = candidate.rotationYRad;
  let attachedWallId = candidate.attachedWallId;
  const guides: SnapGuide[] = [];

  if (options.freePlacement) {
    return {
      xMm,
      yMm: Math.max(0, Math.min(ceilingHeightMm, yMm)),
      zMm,
      rotationYRad,
      attachedWallId,
      snappedConstraint: 'free',
      guides,
    };
  }

  // 1. Built-in Oven / Microwave: snap into a colonne (four) niche or base cabinet opening
  if (candidate.type === 'four_encastrable' || candidate.type === 'micro_ondes') {
    let bestHost: ModuleInstance | null = null;
    let bestDist = 480;
    for (const m of modules) {
      const isColonneFour = m.type === 'colonne' && (m.colonneVariant === 'four' || m.drawerCount > 0);
      const isBase = m.type === 'caisson_bas' || m.type === 'caisson_casserolier';
      if (!isColonneFour && !isBase) continue;
      const dist = Math.hypot(m.xMm - xMm, m.zMm - zMm);
      if (dist < bestDist) {
        bestDist = dist;
        bestHost = m;
      }
    }
    if (bestHost) {
      const nicheY =
        bestHost.type === 'colonne'
          ? candidate.type === 'micro_ondes'
            ? Math.min(ceilingHeightMm - candidate.heightMm, 1465)
            : 840
          : Math.max(100, bestHost.yMm + bestHost.heightMm - candidate.heightMm - 18);
      return {
        xMm: Math.round(bestHost.xMm),
        yMm: Math.round(nicheY),
        zMm: Math.round(bestHost.zMm),
        rotationYRad: options.preserveRotation ? rotationYRad : bestHost.rotationYRad,
        attachedWallId: bestHost.attachedWallId,
        snappedConstraint: 'niche',
        guides,
      };
    }
  }

  // 2. Sink & Cooktop: snap onto countertop surface height of base cabinets / worktops / islands
  if (candidate.type === 'evier_mitigeur' || candidate.type === 'plaque_cuisson') {
    let bestWorktop: ModuleInstance | null = null;
    let bestDist = 520;
    for (const m of modules) {
      if (!PROP_COUNTERTOP_HOST_TYPES.has(m.type)) continue;
      const dist = Math.hypot(m.xMm - xMm, m.zMm - zMm);
      const radius = Math.max(m.widthMm, m.depthMm) * 0.55 + 140;
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        bestWorktop = m;
      }
    }
    if (bestWorktop) {
      // If a plan_de_travail overlaps the base cabinet, snap to its top (898 mm) rather than cabinet top (860 mm)
      const topWorktop = modules.find(
        (p) =>
          p.type === 'plan_de_travail' &&
          Math.abs(p.xMm - xMm) <= p.widthMm / 2 + 60 &&
          Math.abs(p.zMm - zMm) <= p.depthMm / 2 + 60
      );
      const surfaceY = topWorktop
        ? topWorktop.yMm + topWorktop.heightMm
        : bestWorktop.yMm + bestWorktop.heightMm;
      return {
        xMm,
        yMm: Math.round(surfaceY),
        zMm,
        rotationYRad: options.preserveRotation ? rotationYRad : bestWorktop.rotationYRad,
        attachedWallId: bestWorktop.attachedWallId,
        snappedConstraint: 'countertop',
        guides,
      };
    }
    // Default countertop height fallback
    return {
      xMm,
      yMm: 898,
      zMm,
      rotationYRad,
      attachedWallId,
      snappedConstraint: 'countertop',
      guides,
    };
  }

  // 3. Ceiling pendant / chandelier: snap cleanly to ceiling height
  if (candidate.type === 'suspension_lustre') {
    return {
      xMm,
      yMm: Math.max(1500, Math.round(ceilingHeightMm - candidate.heightMm)),
      zMm,
      rotationYRad,
      attachedWallId: undefined,
      snappedConstraint: 'ceiling',
      guides,
    };
  }

  // 4. Wall-mounted props, floor appliances, and floor decor/furniture near walls & 2-wall corners
  const isWallMounted =
    candidate.type === 'applique_murale' ||
    (candidate.type === 'tele_ecran_plat' && candidate.tvMountMode !== 'sur_pied') ||
    (candidate.type === 'hotte_aspirante' && candidate.hoodMountMode !== 'ilot');
  const isFloorAppliance =
    candidate.type === 'refrigerateur' ||
    candidate.type === 'refrigerateur_americain' ||
    candidate.type === 'lave_vaisselle';

  const wallMetrics = analyzeWalls(walls);
  if (wallMetrics.length > 0) {
    const snapDistThreshold = isWallMounted ? 420 : isFloorAppliance ? 280 : 220;
    const clearanceMm = isFloorAppliance || isWallMounted ? 6 : 0;
    let bestWm: WallMetrics | null = null;
    let bestU = 0;
    let bestHalfSpanU = candidate.widthMm / 2;
    let bestTargetOffset = 0;
    let bestEffRot = rotationYRad;
    let bestGap = snapDistThreshold;

    for (const wm of wallMetrics) {
      const proj = projectPointToWall(wm, { x: xMm, z: zMm });
      if (proj.uRawMm < -140 || proj.uRawMm > wm.lengthMm + 140) continue;

      const effRot = options.preserveRotation
        ? candidate.rotationYRad
        : normalToRotationYRad(wm.inwardNormal);
      const { halfSpanU, halfSpanD } = computeRotatedFootprintOnWall(
        candidate.widthMm,
        candidate.depthMm,
        effRot,
        wm.tangent,
        wm.inwardNormal
      );
      const targetOffset = wm.wall.thicknessMm / 2 + halfSpanD + clearanceMm;
      const gap = Math.abs(proj.signedInwardDistanceMm - targetOffset);
      if (gap < bestGap) {
        bestGap = gap;
        bestWm = wm;
        bestU = proj.uClampedMm;
        bestHalfSpanU = halfSpanU;
        bestTargetOffset = targetOffset;
        bestEffRot = effRot;
      }
    }

    if (bestWm) {
      rotationYRad = bestEffRot;
      attachedWallId = bestWm.wall.id;

      // Dual-wall corner alignment (start or end corner of bestWm)
      const wallSpan = getWallInteriorSpanMm(bestWm, wallMetrics);
      const cornerThreshold = 180;
      let snappedU = bestU;
      const startCorner = findCornerWallAtEndpoint(bestWm, bestWm.start, wallMetrics);
      const cornerUStart = wallSpan.startInsetMm + bestHalfSpanU + clearanceMm;
      const endCorner = findCornerWallAtEndpoint(bestWm, bestWm.end, wallMetrics);
      const cornerUEnd = bestWm.lengthMm - wallSpan.endInsetMm - bestHalfSpanU - clearanceMm;

      if (startCorner && Math.abs(bestU - cornerUStart) <= cornerThreshold) {
        snappedU = cornerUStart;
        const otherHalfT = startCorner.wall.thicknessMm / 2;
        guides.push({
          kind: 'wall',
          x1Mm: startCorner.start.x + startCorner.inwardNormal.x * otherHalfT,
          z1Mm: startCorner.start.z + startCorner.inwardNormal.z * otherHalfT,
          x2Mm: startCorner.end.x + startCorner.inwardNormal.x * otherHalfT,
          z2Mm: startCorner.end.z + startCorner.inwardNormal.z * otherHalfT,
          labelFr: `Angle ${startCorner.wall.labelFr ?? 'Mur'}`,
        });
      } else if (endCorner && Math.abs(bestU - cornerUEnd) <= cornerThreshold) {
        snappedU = cornerUEnd;
        const otherHalfT = endCorner.wall.thicknessMm / 2;
        guides.push({
          kind: 'wall',
          x1Mm: endCorner.start.x + endCorner.inwardNormal.x * otherHalfT,
          z1Mm: endCorner.start.z + endCorner.inwardNormal.z * otherHalfT,
          x2Mm: endCorner.end.x + endCorner.inwardNormal.x * otherHalfT,
          z2Mm: endCorner.end.z + endCorner.inwardNormal.z * otherHalfT,
          labelFr: `Angle ${endCorner.wall.labelFr ?? 'Mur'}`,
        });
      }

      xMm = Math.round(
        bestWm.start.x +
          bestWm.tangent.x * snappedU +
          bestWm.inwardNormal.x * bestTargetOffset
      );
      zMm = Math.round(
        bestWm.start.z +
          bestWm.tangent.z * snappedU +
          bestWm.inwardNormal.z * bestTargetOffset
      );

      const faceHalfT = bestWm.wall.thicknessMm / 2;
      guides.push({
        kind: 'wall',
        x1Mm: bestWm.start.x + bestWm.inwardNormal.x * faceHalfT,
        z1Mm: bestWm.start.z + bestWm.inwardNormal.z * faceHalfT,
        x2Mm: bestWm.end.x + bestWm.inwardNormal.x * faceHalfT,
        z2Mm: bestWm.end.z + bestWm.inwardNormal.z * faceHalfT,
        labelFr: bestWm.wall.labelFr ?? 'Mur',
      });

      if (isFloorAppliance) {
        yMm = 0;
      } else if (candidate.type === 'hotte_aspirante') {
        yMm = Math.max(1450, Math.min(ceilingHeightMm - candidate.heightMm, yMm || 1580));
      } else if (candidate.type === 'applique_murale') {
        yMm = Math.max(1200, Math.min(ceilingHeightMm - candidate.heightMm - 80, yMm || 1680));
      } else if (candidate.type === 'tele_ecran_plat' && isWallMounted) {
        yMm = Math.max(600, Math.min(ceilingHeightMm - candidate.heightMm - 100, yMm || 1050));
      }

      return {
        xMm,
        yMm: Math.round(yMm),
        zMm,
        rotationYRad,
        attachedWallId,
        snappedConstraint: isFloorAppliance || !isWallMounted ? 'floor' : 'wall',
        guides,
      };
    }
  }

  // Floor-standing furniture / decor stays cleanly on the floor (attachedWallId cleared when pulled away)
  return {
    xMm,
    yMm: candidate.type === 'hotte_aspirante' ? Math.max(1550, yMm) : yMm,
    zMm,
    rotationYRad,
    attachedWallId: undefined,
    snappedConstraint: 'floor',
    guides,
  };
}

export interface MultiModuleSpacingMove {
  id: string;
  xMm: number;
  zMm: number;
}

/**
 * Distributes 2+ selected modules with an exact gap (e.g., 0 mm flush, 50 mm filler, 600 mm appliance gap)
 * along their primary wall tangent or dominant world alignment axis, keeping the first module anchored.
 */
export function computeMultiModuleSpacingMoves(
  modules: readonly ModuleInstance[],
  walls: WallSegment[],
  gapMm: number
): MultiModuleSpacingMove[] {
  if (modules.length < 2) return [];
  const safeGap = Number.isFinite(gapMm) ? Math.max(0, Math.round(gapMm)) : 0;

  // Find dominant attachedWallId among selected modules
  const wallCounts = new Map<string, number>();
  for (const m of modules) {
    if (m.attachedWallId) {
      wallCounts.set(m.attachedWallId, (wallCounts.get(m.attachedWallId) ?? 0) + 1);
    }
  }
  let bestWallId: string | null = null;
  let bestCount = 0;
  for (const [wid, cnt] of wallCounts.entries()) {
    if (cnt > bestCount) {
      bestCount = cnt;
      bestWallId = wid;
    }
  }

  const wallMetrics = analyzeWalls(walls);
  const primaryWm = bestWallId ? wallMetrics.find((w) => w.wall.id === bestWallId) ?? null : null;

  if (primaryWm) {
    const projected = modules
      .map((m) => {
        const vx = m.xMm - primaryWm.start.x;
        const vz = m.zMm - primaryWm.start.z;
        const uCenter = vx * primaryWm.tangent.x + vz * primaryWm.tangent.z;
        const dCenter = vx * primaryWm.inwardNormal.x + vz * primaryWm.inwardNormal.z;
        return { m, uCenter, dCenter };
      })
      .sort((a, b) => a.uCenter - b.uCenter);

    let cursor = projected[0].uCenter - projected[0].m.widthMm / 2;
    return projected.map(({ m, dCenter }) => {
      const targetU = cursor + m.widthMm / 2;
      cursor += m.widthMm + safeGap;
      return {
        id: m.id,
        xMm: Math.round(
          primaryWm.start.x + primaryWm.tangent.x * targetU + primaryWm.inwardNormal.x * dCenter
        ),
        zMm: Math.round(
          primaryWm.start.z + primaryWm.tangent.z * targetU + primaryWm.inwardNormal.z * dCenter
        ),
      };
    });
  }

  // Fallback: dominant world axis (X vs Z)
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const m of modules) {
    minX = Math.min(minX, m.xMm);
    maxX = Math.max(maxX, m.xMm);
    minZ = Math.min(minZ, m.zMm);
    maxZ = Math.max(maxZ, m.zMm);
  }
  const useX = maxX - minX >= maxZ - minZ;

  if (useX) {
    const sorted = [...modules].sort((a, b) => a.xMm - b.xMm);
    let cursor = sorted[0].xMm - sorted[0].widthMm / 2;
    return sorted.map((m) => {
      const nextX = Math.round(cursor + m.widthMm / 2);
      cursor += m.widthMm + safeGap;
      return { id: m.id, xMm: nextX, zMm: m.zMm };
    });
  }

  const sorted = [...modules].sort((a, b) => a.zMm - b.zMm);
  let cursor = sorted[0].zMm - sorted[0].widthMm / 2;
  return sorted.map((m) => {
    const nextZ = Math.round(cursor + m.widthMm / 2);
    cursor += m.widthMm + safeGap;
    return { id: m.id, xMm: m.xMm, zMm: nextZ };
  });
}
