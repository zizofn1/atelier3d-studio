import type { ModuleInstance, ProjectDocument } from '@/types';
import { roundMm } from '@/utils/units';
import {
  moduleToFootprints2D,
  moduleToOBB2D,
  testOBBOverlap2D,
  testYOverlap,
  type OBB2D,
} from './collision';
import {
  analyzeWalls,
  getModuleAxes2D,
  getModuleCorners2D,
  normalizeZero,
} from './wallMath';

export interface ModuleAutoFitSolution {
  moduleId: string;
  moduleRef: string;
  /** Patch to pass directly to updateModule(moduleId, patch). */
  patch: Pick<ModuleInstance, 'widthMm' | 'heightMm' | 'depthMm' | 'xMm' | 'zMm'>;
  changedDimensions: Array<'width' | 'depth' | 'height'>;
  summaryFr: string;
  reasonFr: string;
}

const MIN_FIT_WIDTH_MM = 120;
const MIN_FIT_DEPTH_MM = 80;
const MIN_FIT_HEIGHT_MM = 80;

/**
 * Computes an automatic resize + anchor-preserving recenter solution for a cabinet
 * that clips into a solid wall, exceeds ceiling height, or overlaps an aligned adjacent cabinet.
 *
 * The non-colliding edge stays flush where it was snapped (e.g. against a neighboring cabinet),
 * while only the overflowing edge is trimmed flush to the wall/obstacle face.
 */
export function computeModuleFitSolution(
  doc: ProjectDocument,
  moduleId: string
): ModuleAutoFitSolution | null {
  const mod = doc.modules.find((m) => m.id === moduleId);
  if (!mod) return null;

  const { axisX, axisZ } = getModuleAxes2D(mod.rotationYRad);
  let xMin = -mod.widthMm / 2;
  let xMax = mod.widthMm / 2;
  let zMin = -mod.depthMm / 2;
  let zMax = mod.depthMm / 2;
  let nextHeightMm = mod.heightMm;

  const reasons: string[] = [];
  const wallMetrics = analyzeWalls(doc.walls);
  const modFootprints = moduleToFootprints2D(mod);
  const wallEpsMm = 2.5;

  // 1. Resolve solid wall penetrations (width & depth)
  for (const wm of wallMetrics) {
    const yOv = testYOverlap(mod.yMm, mod.yMm + mod.heightMm, 0, wm.wall.heightMm, wallEpsMm);
    if (!yOv.overlaps) continue;

    const wallOBB: OBB2D = {
      cx: wm.midpoint.x,
      cz: wm.midpoint.z,
      halfW: Math.max(10, wm.lengthMm / 2 - wallEpsMm),
      halfD: wm.wall.thicknessMm / 2,
      axisX: wm.tangent,
      axisZ: wm.inwardNormal,
    };

    let overlapsWall = false;
    for (const box of modFootprints) {
      if (testOBBOverlap2D(box, wallOBB, wallEpsMm).overlaps) {
        overlapsWall = true;
        break;
      }
    }
    if (!overlapsWall) continue;

    const faceX = wm.midpoint.x + wm.inwardNormal.x * (wm.wall.thicknessMm / 2);
    const faceZ = wm.midpoint.z + wm.inwardNormal.z * (wm.wall.thicknessMm / 2);
    const relFaceX = faceX - mod.xMm;
    const relFaceZ = faceZ - mod.zMm;

    const dotX = wm.inwardNormal.x * axisX.x + wm.inwardNormal.z * axisX.z;
    const dotZ = wm.inwardNormal.x * axisZ.x + wm.inwardNormal.z * axisZ.z;

    if (Math.abs(dotX) >= Math.abs(dotZ) && Math.abs(dotX) > 0.35) {
      // Wall is perpendicular (or angled) across cabinet width (local X)
      if (Math.abs(dotX) > 0.92) {
        const wallLocalX = relFaceX * axisX.x + relFaceZ * axisX.z;
        if (dotX < 0 && wallLocalX < xMax - 1) {
          xMax = Math.min(xMax, wallLocalX);
          reasons.push(wm.wall.labelFr ?? 'mur');
        } else if (dotX > 0 && wallLocalX > xMin + 1) {
          xMin = Math.max(xMin, wallLocalX);
          reasons.push(wm.wall.labelFr ?? 'mur');
        }
      } else {
        // Non-90° angled wall: trim the offending X end so all 4 corners lie inside the wall face
        const corners = getModuleCorners2D(mod);
        let maxPen = 0;
        for (const c of corners) {
          const signed =
            (c.x - faceX) * wm.inwardNormal.x + (c.z - faceZ) * wm.inwardNormal.z;
          if (signed < 0) {
            maxPen = Math.max(maxPen, -signed);
          }
        }
        const trimX = maxPen / Math.abs(dotX);
        if (trimX > 1) {
          if (dotX < 0) {
            xMax = Math.min(xMax, mod.widthMm / 2 - trimX);
          } else {
            xMin = Math.max(xMin, -mod.widthMm / 2 + trimX);
          }
          reasons.push(wm.wall.labelFr ?? 'mur');
        }
      }
    } else if (Math.abs(dotZ) > 0.35) {
      // Wall is parallel across cabinet depth (local Z)
      if (Math.abs(dotZ) > 0.92) {
        const wallLocalZ = relFaceX * axisZ.x + relFaceZ * axisZ.z;
        if (dotZ < 0 && wallLocalZ < zMax - 1) {
          zMax = Math.min(zMax, wallLocalZ);
          reasons.push(wm.wall.labelFr ?? 'mur');
        } else if (dotZ > 0 && wallLocalZ > zMin + 1) {
          zMin = Math.max(zMin, wallLocalZ);
          reasons.push(wm.wall.labelFr ?? 'mur');
        }
      } else {
        const corners = getModuleCorners2D(mod);
        let maxPen = 0;
        for (const c of corners) {
          const signed =
            (c.x - faceX) * wm.inwardNormal.x + (c.z - faceZ) * wm.inwardNormal.z;
          if (signed < 0) {
            maxPen = Math.max(maxPen, -signed);
          }
        }
        const trimZ = maxPen / Math.abs(dotZ);
        if (trimZ > 1) {
          if (dotZ < 0) {
            zMax = Math.min(zMax, mod.depthMm / 2 - trimZ);
          } else {
            zMin = Math.max(zMin, -mod.depthMm / 2 + trimZ);
          }
          reasons.push(wm.wall.labelFr ?? 'mur');
        }
      }
    }
  }

  // 2. Resolve overlaps with aligned adjacent modules along local X (e.g. sandwiched between cabinet & wall/cabinet)
  const modBox = moduleToOBB2D(mod);
  for (const other of doc.modules) {
    if (other.id === mod.id) continue;
    const yOv = testYOverlap(
      mod.yMm,
      mod.yMm + mod.heightMm,
      other.yMm,
      other.yMm + other.heightMm,
      0.5
    );
    if (!yOv.overlaps) continue;

    const otherFootprints = moduleToFootprints2D(other);
    let overlapsOther = false;
    for (const oBox of otherFootprints) {
      if (testOBBOverlap2D(modBox, oBox, 1).overlaps) {
        overlapsOther = true;
        break;
      }
    }
    if (!overlapsOther) continue;

    // Project other module corners into our local frame
    const otherCorners = getModuleCorners2D(other);
    let oXMin = Infinity;
    let oXMax = -Infinity;
    let oZMin = Infinity;
    let oZMax = -Infinity;
    for (const c of otherCorners) {
      const lx = (c.x - mod.xMm) * axisX.x + (c.z - mod.zMm) * axisX.z;
      const lz = (c.x - mod.xMm) * axisZ.x + (c.z - mod.zMm) * axisZ.z;
      if (lx < oXMin) oXMin = lx;
      if (lx > oXMax) oXMax = lx;
      if (lz < oZMin) oZMin = lz;
      if (lz > oZMax) oZMax = lz;
    }

    const zOv = Math.min(zMax, oZMax) - Math.max(zMin, oZMin);
    if (zOv <= 2) continue;

    const leftPen = oXMax - xMin;
    const rightPen = xMax - oXMin;
    const xOv = Math.min(xMax, oXMax) - Math.max(xMin, oXMin);
    if (xOv <= 1) continue;

    // Only trim along X if other module clearly sits on one side (left or right) rather than completely swallowing us
    if (oXMin < xMin && leftPen > 1 && leftPen < mod.widthMm - MIN_FIT_WIDTH_MM) {
      xMin = Math.max(xMin, oXMax);
      reasons.push(other.ref);
    } else if (oXMax > xMax && rightPen > 1 && rightPen < mod.widthMm - MIN_FIT_WIDTH_MM) {
      xMax = Math.min(xMax, oXMin);
      reasons.push(other.ref);
    }
  }

  // 3. Resolve ceiling height overflow
  if (mod.yMm + mod.heightMm > doc.ceilingHeightMm + 1) {
    const availH = Math.floor(doc.ceilingHeightMm - mod.yMm);
    if (availH >= MIN_FIT_HEIGHT_MM) {
      nextHeightMm = availH;
      reasons.push('plafond');
    }
  }

  const rawWidth = Math.floor(xMax - xMin);
  const rawDepth = Math.floor(zMax - zMin);

  if (rawWidth < MIN_FIT_WIDTH_MM || rawDepth < MIN_FIT_DEPTH_MM) {
    return null;
  }

  const nextWidthMm = Math.min(mod.widthMm, rawWidth);
  const nextDepthMm = Math.min(mod.depthMm, rawDepth);

  const changedDimensions: Array<'width' | 'depth' | 'height'> = [];
  if (nextWidthMm < mod.widthMm - 0.5) changedDimensions.push('width');
  if (nextDepthMm < mod.depthMm - 0.5) changedDimensions.push('depth');
  if (nextHeightMm < mod.heightMm - 0.5) changedDimensions.push('height');

  if (changedDimensions.length === 0) return null;

  // Preserve the untouched edge exact coordinate when recentering after integer rounding
  let finalXMin = xMin;
  let finalXMax = xMax;
  if (changedDimensions.includes('width')) {
    const leftTrimmed = xMin > -mod.widthMm / 2 + 0.5;
    const rightTrimmed = xMax < mod.widthMm / 2 - 0.5;
    if (rightTrimmed && !leftTrimmed) {
      finalXMin = -mod.widthMm / 2;
      finalXMax = finalXMin + nextWidthMm;
    } else if (leftTrimmed && !rightTrimmed) {
      finalXMax = mod.widthMm / 2;
      finalXMin = finalXMax - nextWidthMm;
    }
  }

  let finalZMin = zMin;
  let finalZMax = zMax;
  if (changedDimensions.includes('depth')) {
    const backTrimmed = zMin > -mod.depthMm / 2 + 0.5;
    const frontTrimmed = zMax < mod.depthMm / 2 - 0.5;
    if (frontTrimmed && !backTrimmed) {
      finalZMin = -mod.depthMm / 2;
      finalZMax = finalZMin + nextDepthMm;
    } else if (backTrimmed && !frontTrimmed) {
      finalZMax = mod.depthMm / 2;
      finalZMin = finalZMax - nextDepthMm;
    }
  }

  const shiftX = (finalXMin + finalXMax) / 2;
  const shiftZ = (finalZMin + finalZMax) / 2;

  const nextXMm = normalizeZero(roundMm(mod.xMm + shiftX * axisX.x + shiftZ * axisZ.x, 1));
  const nextZMm = normalizeZero(roundMm(mod.zMm + shiftX * axisX.z + shiftZ * axisZ.z, 1));

  const parts: string[] = [];
  if (changedDimensions.includes('width')) {
    parts.push(`Largeur ${Math.round(mod.widthMm)} → ${nextWidthMm} mm`);
  }
  if (changedDimensions.includes('depth')) {
    parts.push(`Profondeur ${Math.round(mod.depthMm)} → ${nextDepthMm} mm`);
  }
  if (changedDimensions.includes('height')) {
    parts.push(`Hauteur ${Math.round(mod.heightMm)} → ${nextHeightMm} mm`);
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    moduleId: mod.id,
    moduleRef: mod.ref,
    patch: {
      widthMm: nextWidthMm,
      heightMm: nextHeightMm,
      depthMm: nextDepthMm,
      xMm: nextXMm,
      zMm: nextZMm,
    },
    changedDimensions,
    summaryFr: parts.join(' · '),
    reasonFr: uniqueReasons.join(', '),
  };
}
