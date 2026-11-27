import type {
  CollisionWarning,
  ModuleInstance,
  ProjectDocument,
  RoomUtility,
} from '@/types';
import { FR } from '@/i18n/fr';
import { roundMm } from '@/utils/units';
import {
  analyzeWalls,
  getModuleAxes2D,
  projectModuleToWall,
  type Point2D,
} from './wallMath';

export interface OBB2D {
  cx: number;
  cz: number;
  halfW: number;
  halfD: number;
  axisX: Point2D;
  axisZ: Point2D;
}

export function moduleToOBB2D(
  mod: Pick<ModuleInstance, 'xMm' | 'zMm' | 'widthMm' | 'depthMm' | 'rotationYRad'>
): OBB2D {
  const { axisX, axisZ } = getModuleAxes2D(mod.rotationYRad);
  return {
    cx: mod.xMm,
    cz: mod.zMm,
    halfW: mod.widthMm / 2,
    halfD: mod.depthMm / 2,
    axisX,
    axisZ,
  };
}

/**
 * Returns 1 OBB for standard rectangular cabinets, or 2 dual-wing OBBs for L-shaped corner units
 * (`caisson_angle_l`, `caisson_angle`) so their empty front-left recess does not cause false collisions.
 */
export function moduleToFootprints2D(
  mod: Pick<ModuleInstance, 'type' | 'xMm' | 'zMm' | 'widthMm' | 'depthMm' | 'rotationYRad' | 'doorCount'>
): OBB2D[] {
  if (mod.type !== 'caisson_angle_l') {
    return [moduleToOBB2D(mod)];
  }
  const { axisX, axisZ } = getModuleAxes2D(mod.rotationYRad);
  const W = mod.widthMm;
  const D = mod.depthMm;
  const W_wing = Math.min(Math.round(Math.min(W, D) * 0.62), 600);
  const recessX = -W / 2 + (W - W_wing);
  const recessZ = -D / 2 + W_wing;
  const northDepth = Math.max(80, recessZ - (-D / 2));
  const eastWidth = Math.max(80, W / 2 - recessX);

  const localBox = (xMin: number, xMax: number, zMin: number, zMax: number): OBB2D => {
    const lx = (xMin + xMax) / 2;
    const lz = (zMin + zMax) / 2;
    return {
      cx: mod.xMm + lx * axisX.x + lz * axisZ.x,
      cz: mod.zMm + lx * axisX.z + lz * axisZ.z,
      halfW: (xMax - xMin) / 2,
      halfD: (zMax - zMin) / 2,
      axisX,
      axisZ,
    };
  };

  return [
    localBox(-W / 2, W / 2, -D / 2, -D / 2 + northDepth),
    localBox(W / 2 - eastWidth, W / 2, -D / 2 + northDepth, D / 2),
  ];
}

export function utilityToOBB2D(
  util: Pick<RoomUtility, 'xMm' | 'zMm' | 'widthMm' | 'depthMm'>
): OBB2D {
  return {
    cx: util.xMm,
    cz: util.zMm,
    halfW: util.widthMm / 2,
    halfD: util.depthMm / 2,
    axisX: { x: 1, z: 0 },
    axisZ: { x: 0, z: 1 },
  };
}

export function testOBBOverlap2D(
  a: OBB2D,
  b: OBB2D,
  epsMm = 0.5
): { overlaps: boolean; penetrationMm: number } {
  const axes: Point2D[] = [a.axisX, a.axisZ, b.axisX, b.axisZ];
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  let minOverlap = Infinity;

  for (const axis of axes) {
    const centerDist = Math.abs(dx * axis.x + dz * axis.z);
    const projA =
      a.halfW * Math.abs(a.axisX.x * axis.x + a.axisX.z * axis.z) +
      a.halfD * Math.abs(a.axisZ.x * axis.x + a.axisZ.z * axis.z);
    const projB =
      b.halfW * Math.abs(b.axisX.x * axis.x + b.axisX.z * axis.z) +
      b.halfD * Math.abs(b.axisZ.x * axis.x + b.axisZ.z * axis.z);
    const overlap = projA + projB - centerDist;
    if (overlap <= epsMm) {
      return { overlaps: false, penetrationMm: 0 };
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
    }
  }

  return { overlaps: true, penetrationMm: roundMm(minOverlap, 2) };
}

export function testYOverlap(
  aMinMm: number,
  aMaxMm: number,
  bMinMm: number,
  bMaxMm: number,
  epsMm = 0.5
): { overlaps: boolean; overlapMm: number } {
  const overlap = Math.min(aMaxMm, bMaxMm) - Math.max(aMinMm, bMinMm);
  if (overlap <= epsMm) {
    return { overlaps: false, overlapMm: 0 };
  }
  return { overlaps: true, overlapMm: roundMm(overlap, 2) };
}

export function detectProjectCollisions(
  doc: ProjectDocument,
  epsMm = 0.5
): CollisionWarning[] {
  const warnings: CollisionWarning[] = [];
  const modules = doc.modules;
  const footprints = modules.map(moduleToFootprints2D);

  // 1. Module vs Module (using dual-arm OBBs for L-shaped corner units)
  for (let i = 0; i < modules.length; i++) {
    const a = modules[i];
    const fpA = footprints[i];
    for (let j = i + 1; j < modules.length; j++) {
      const b = modules[j];
      const yOv = testYOverlap(
        a.yMm,
        a.yMm + a.heightMm,
        b.yMm,
        b.yMm + b.heightMm,
        epsMm
      );
      if (!yOv.overlaps) continue;

      let maxXZPen = 0;
      for (const boxA of fpA) {
        for (const boxB of footprints[j]) {
          const xzOv = testOBBOverlap2D(boxA, boxB, epsMm);
          if (xzOv.overlaps && xzOv.penetrationMm > maxXZPen) {
            maxXZPen = xzOv.penetrationMm;
          }
        }
      }
      if (maxXZPen <= 0) continue;

      const penetrationMm = roundMm(Math.min(maxXZPen, yOv.overlapMm), 1);
      warnings.push({
        id: `col-mod-${a.id}-${b.id}`,
        kind: 'module',
        moduleId: a.id,
        moduleRef: a.ref,
        targetId: b.id,
        targetLabelFr: `${b.ref} (${b.nameFr})`,
        messageFr: `Collision entre ${a.ref} (${a.nameFr}) et ${b.ref} (${b.nameFr}).`,
        penetrationMm,
      });
    }
  }

  // 2. Module vs Structural Utilities (poteau / poutre only)
  const structuralUtils = doc.utilities.filter(
    (u) => u.kind === 'poteau' || u.kind === 'poutre'
  );
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const fpM = footprints[i];
    for (const util of structuralUtils) {
      const yOv = testYOverlap(
        mod.yMm,
        mod.yMm + mod.heightMm,
        util.yMm,
        util.yMm + util.heightMm,
        epsMm
      );
      if (!yOv.overlaps) continue;

      const uBox = utilityToOBB2D(util);
      let maxXZPen = 0;
      for (const boxM of fpM) {
        const xzOv = testOBBOverlap2D(boxM, uBox, epsMm);
        if (xzOv.overlaps && xzOv.penetrationMm > maxXZPen) {
          maxXZPen = xzOv.penetrationMm;
        }
      }
      if (maxXZPen <= 0) continue;

      const label = util.labelFr ?? FR.utilities[util.kind];
      const penetrationMm = roundMm(Math.min(maxXZPen, yOv.overlapMm), 1);
      warnings.push({
        id: `col-struct-${mod.id}-${util.id}`,
        kind: 'structure',
        moduleId: mod.id,
        moduleRef: mod.ref,
        targetId: util.id,
        targetLabelFr: label,
        messageFr: `${mod.ref} (${mod.nameFr}) entre en collision avec ${label}.`,
        penetrationMm,
      });
    }
  }

  // 3. Module vs Wall Openings (porte / fenetre — interior side only)
  const wallMetrics = analyzeWalls(doc.walls);
  const wallMetricsMap = new Map(wallMetrics.map((wm) => [wm.wall.id, wm]));

  for (const opening of doc.openings) {
    const wm = wallMetricsMap.get(opening.wallId);
    if (!wm) continue;

    const opUMin = opening.offsetFromStartMm;
    const opUMax = opUMin + opening.widthMm;
    const opYMin = opening.sillHeightMm;
    const opYMax = opYMin + opening.heightMm;
    const dFace = wm.wall.thicknessMm / 2;
    const frontClearance = opening.kind === 'porte' ? 400 : 150;

    for (const mod of modules) {
      const yOv = Math.min(mod.yMm + mod.heightMm, opYMax) - Math.max(mod.yMm, opYMin);
      if (yOv <= epsMm) continue;

      const proj = projectModuleToWall(wm, mod);
      const uOv = Math.min(proj.uMaxMm, opUMax) - Math.max(proj.uMinMm, opUMin);
      if (uOv <= epsMm) continue;

      // Only check from interior core (-dFace + 2) out into interior clearance (dFace + frontClearance)
      const dOv =
        Math.min(proj.dMaxMm, dFace + frontClearance) -
        Math.max(proj.dMinMm, -dFace + 2);
      if (dOv <= epsMm) continue;

      const label = opening.labelFr ?? FR.openings[opening.kind];
      const penetrationMm = roundMm(Math.min(uOv, yOv, dOv), 1);
      warnings.push({
        id: `col-ouv-${mod.id}-${opening.id}`,
        kind: 'ouverture',
        moduleId: mod.id,
        moduleRef: mod.ref,
        targetId: opening.id,
        targetLabelFr: label,
        messageFr: `${mod.ref} (${mod.nameFr}) obstrue ${label}.`,
        penetrationMm,
      });
    }
  }

  // 4. Module vs Solid Walls (catches cabinets intersecting a wall by > 2.5 mm)
  const wallEpsMm = 2.5;
  for (let i = 0; i < modules.length; i++) {
    const mod = modules[i];
    const fpM = footprints[i];
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
      let maxXZPen = 0;
      for (const boxM of fpM) {
        const xzOv = testOBBOverlap2D(boxM, wallOBB, wallEpsMm);
        if (xzOv.overlaps && xzOv.penetrationMm > maxXZPen) {
          maxXZPen = xzOv.penetrationMm;
        }
      }
      if (maxXZPen <= 0) continue;

      const label = wm.wall.labelFr ?? 'Mur';
      const penetrationMm = roundMm(Math.min(maxXZPen, yOv.overlapMm), 1);
      warnings.push({
        id: `col-wall-${mod.id}-${wm.wall.id}`,
        kind: 'structure',
        moduleId: mod.id,
        moduleRef: mod.ref,
        targetId: wm.wall.id,
        targetLabelFr: label,
        messageFr: `${mod.ref} (${mod.nameFr}) traverse ${label}.`,
        penetrationMm,
      });
    }
  }

  return warnings;
}
