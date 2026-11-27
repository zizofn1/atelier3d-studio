import type { ModuleInstance, ProjectDocument, WallSegment } from '@/types';
import { snapModulePosition } from '@/engine/geometry';
import { generateId } from '@/utils/id';

/**
 * Non-destructive project clone + CAD repair:
 * - Never mutates or overwrites the source ProjectDocument
 * - Snaps near-coincident wall endpoints (<= 15 mm) and drops degenerate walls
 * - Removes orphan wall references and clamps openings inside their host wall
 * - Re-snaps all cabinets cleanly to their walls and corners (including dual-wall corner snap)
 */
export function cloneAndRepairProjectDocument(source: ProjectDocument): ProjectDocument {
  const now = new Date().toISOString();
  const baseCopy: ProjectDocument = structuredClone(source);

  // 1. Canonicalize nearly-coincident wall endpoints (<= 15 mm) and filter degenerate walls
  const canonicalNodes: Array<[number, number]> = [];
  const snapEndpoint = (pt: [number, number]): [number, number] => {
    const rx = Math.round(pt[0]);
    const rz = Math.round(pt[1]);
    for (const node of canonicalNodes) {
      if (Math.hypot(node[0] - rx, node[1] - rz) <= 15) {
        return [node[0], node[1]];
      }
    }
    const fresh: [number, number] = [rx, rz];
    canonicalNodes.push(fresh);
    return fresh;
  };

  const repairedWalls: WallSegment[] = [];
  for (const w of baseCopy.walls) {
    const startMm = snapEndpoint(w.startMm);
    const endMm = snapEndpoint(w.endMm);
    if (Math.hypot(endMm[0] - startMm[0], endMm[1] - startMm[1]) >= 50) {
      repairedWalls.push({ ...w, startMm, endMm });
    }
  }

  const wallById = new Map(repairedWalls.map((w) => [w.id, w]));

  // 2. Clean orphan openings & clamp offsets inside host wall length
  const repairedOpenings = baseCopy.openings
    .filter((op) => wallById.has(op.wallId))
    .map((op) => {
      const w = wallById.get(op.wallId)!;
      const wallLen = Math.hypot(w.endMm[0] - w.startMm[0], w.endMm[1] - w.startMm[1]);
      const maxOffset = Math.max(0, Math.round(wallLen - op.widthMm));
      return {
        ...op,
        offsetFromStartMm: Math.max(0, Math.min(maxOffset, Math.round(op.offsetFromStartMm))),
      };
    });

  // 3. Clean orphan wall references on utilities & props
  const repairedUtilities = baseCopy.utilities.map((u) =>
    u.wallId && !wallById.has(u.wallId) ? { ...u, wallId: undefined } : u
  );
  const repairedProps = (baseCopy.props ?? []).map((p) =>
    p.attachedWallId && !wallById.has(p.attachedWallId) ? { ...p, attachedWallId: undefined } : p
  );

  // 4. Re-snap modules sequentially using dual-wall corner & wall snapping
  const repairedModules: ModuleInstance[] = [];
  for (const rawMod of baseCopy.modules) {
    const mod: ModuleInstance =
      rawMod.attachedWallId && !wallById.has(rawMod.attachedWallId)
        ? { ...rawMod, attachedWallId: undefined }
        : { ...rawMod };

    if (mod.type === 'ilot_central' || repairedWalls.length === 0) {
      repairedModules.push(mod);
      continue;
    }

    const snapped = snapModulePosition(mod, repairedWalls, repairedModules, {
      wallSnapThresholdMm: 320,
      cabinetSnapThresholdMm: 120,
      ceilingHeightMm: baseCopy.ceilingHeightMm,
      plinthRecessMm: baseCopy.defaultCarpentry?.plinthRecessMm ?? 45,
    });

    repairedModules.push({
      ...mod,
      xMm: snapped.xMm,
      yMm: snapped.yMm,
      zMm: snapped.zMm,
      rotationYRad: snapped.rotationYRad,
      attachedWallId: snapped.attachedWallId,
    });
  }

  return {
    ...baseCopy,
    id: generateId('proj'),
    name: `${source.name} (Copie)`,
    createdAt: now,
    updatedAt: now,
    walls: repairedWalls,
    openings: repairedOpenings,
    utilities: repairedUtilities,
    modules: repairedModules,
    props: repairedProps,
  };
}
