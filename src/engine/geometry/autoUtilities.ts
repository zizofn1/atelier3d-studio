import type {
  ModuleInstance,
  ModuleType,
  ProjectDocument,
  RoomUtility,
  SceneProp,
  ScenePropType,
} from '@/types';
import { analyzeWalls, projectPointToWall, type WallMetrics } from './wallMath';

const WATER_MODULE_TYPES = new Set<ModuleType>([
  'caisson_sous_evier',
  'meuble_vasque',
  'meuble_double_vasque',
  'meuble_buanderie',
]);

const ELEC_MODULE_TYPES = new Set<ModuleType>([
  'meuble_buanderie',
  'armoire_miroir_led',
]);

const WATER_PROP_TYPES = new Set<ScenePropType>([
  'evier_mitigeur',
  'lave_vaisselle',
  'machine_laver',
  'chauffe_eau',
]);

const ELEC_PROP_TYPES = new Set<ScenePropType>([
  'four_encastrable',
  'micro_ondes',
  'plaque_cuisson',
  'refrigerateur',
  'refrigerateur_americain',
  'hotte_aspirante',
  'lave_vaisselle',
  'machine_laver',
  'seche_linge',
  'chauffe_eau',
  'tele_ecran_plat',
]);

export interface AutoUtilityTarget {
  entityId?: string;
  kind: 'module' | 'prop';
  type: ModuleType | ScenePropType;
  nameFr: string;
  xMm: number;
  yMm: number;
  zMm: number;
  attachedWallId?: string;
  colonneVariant?: ModuleInstance['colonneVariant'];
}

function resolveUtilityNeeds(target: AutoUtilityTarget): {
  needsWater: boolean;
  needsElec: boolean;
} {
  const needsWater =
    target.kind === 'module'
      ? WATER_MODULE_TYPES.has(target.type as ModuleType)
      : WATER_PROP_TYPES.has(target.type as ScenePropType);

  const needsElec =
    target.kind === 'module'
      ? ELEC_MODULE_TYPES.has(target.type as ModuleType) ||
        (target.type === 'colonne' &&
          (target.colonneVariant === 'four' || target.colonneVariant === 'refrigerateur'))
      : ELEC_PROP_TYPES.has(target.type as ScenePropType);

  return { needsWater, needsElec };
}

function chooseHostWall(
  wallMetrics: WallMetrics[],
  target: AutoUtilityTarget
): { wm: WallMetrics; proj: ReturnType<typeof projectPointToWall> } | null {
  if (wallMetrics.length === 0) return null;

  let chosenWm = target.attachedWallId
    ? wallMetrics.find((w) => w.wall.id === target.attachedWallId)
    : undefined;
  let chosenProj = chosenWm
    ? projectPointToWall(chosenWm, { x: target.xMm, z: target.zMm })
    : null;

  // If the entity was moved far away from its previously attached wall (e.g. via X/Z input),
  // prefer a strictly closer wall within 1800 mm.
  let bestNearestWm: WallMetrics | undefined;
  let bestNearestProj: ReturnType<typeof projectPointToWall> | null = null;
  let bestDist = 1800;
  for (const wm of wallMetrics) {
    const p = projectPointToWall(wm, { x: target.xMm, z: target.zMm });
    if (p.distanceToSegmentMm < bestDist) {
      bestDist = p.distanceToSegmentMm;
      bestNearestWm = wm;
      bestNearestProj = p;
    }
  }

  if (
    !chosenWm ||
    !chosenProj ||
    chosenProj.distanceToSegmentMm > 1800 ||
    (bestNearestWm &&
      bestNearestProj &&
      chosenProj.distanceToSegmentMm > 900 &&
      bestNearestProj.distanceToSegmentMm + 150 < chosenProj.distanceToSegmentMm)
  ) {
    chosenWm = bestNearestWm;
    chosenProj = bestNearestProj;
  }

  if (!chosenWm || !chosenProj) return null;
  return { wm: chosenWm, proj: chosenProj };
}

/**
 * Computes exact desired positions for water & electrical utilities for a target
 * without deduplication filtering (used both on initial placement and live resync).
 */
export function computeAutoUtilitySpecsForTarget(
  doc: ProjectDocument,
  target: AutoUtilityTarget
): Array<Omit<RoomUtility, 'id'>> {
  const { needsWater, needsElec } = resolveUtilityNeeds(target);
  if (!needsWater && !needsElec) return [];

  const wallMetrics = analyzeWalls(doc.walls);
  const host = chooseHostWall(wallMetrics, target);
  if (!host) return [];

  const { wm: chosenWm, proj: chosenProj } = host;
  const wallFaceOffset = chosenWm.wall.thicknessMm / 2 + 15;
  const baseX = Math.round(
    chosenProj.closestPoint.x + chosenWm.inwardNormal.x * wallFaceOffset
  );
  const baseZ = Math.round(
    chosenProj.closestPoint.z + chosenWm.inwardNormal.z * wallFaceOffset
  );

  const linkFields = target.entityId
    ? { linkedEntityId: target.entityId, linkedEntityKind: target.kind }
    : {};

  const specs: Array<Omit<RoomUtility, 'id'>> = [];

  if (needsWater) {
    specs.push({
      wallId: chosenWm.wall.id,
      kind: 'arrivee_eau',
      labelFr: `Arrivée d'eau (${target.nameFr})`,
      ...linkFields,
      xMm: baseX,
      yMm: 520,
      zMm: baseZ,
      widthMm: 80,
      depthMm: 40,
      heightMm: 120,
    });
  }

  if (needsElec) {
    const shiftU = needsWater ? 140 : 0;
    const ex = Math.round(baseX + chosenWm.tangent.x * shiftU);
    const ez = Math.round(baseZ + chosenWm.tangent.z * shiftU);
    const elecY =
      target.type === 'hotte_aspirante'
        ? Math.min(doc.ceilingHeightMm - 250, 1950)
        : target.type === 'armoire_miroir_led'
          ? Math.min(doc.ceilingHeightMm - 250, 1650)
          : target.type === 'tele_ecran_plat'
            ? Math.max(450, Math.round(target.yMm + 200))
            : target.type === 'plaque_cuisson'
              ? 550
              : 450;

    specs.push({
      wallId: chosenWm.wall.id,
      kind: 'prise',
      labelFr: `Prise électrique (${target.nameFr})`,
      ...linkFields,
      xMm: ex,
      yMm: elecY,
      zMm: ez,
      widthMm: 80,
      depthMm: 20,
      heightMm: 80,
    });
  }

  return specs;
}

/**
 * Computes technical utilities (Arrivée d'eau / Prise électrique) automatically linked
 * behind a newly placed module or appliance on the nearest wall, skipping duplicates
 * if a utility of the same kind already exists within 450 mm.
 */
export function computeAutoUtilitiesForPlacement(
  doc: ProjectDocument,
  target: AutoUtilityTarget
): Array<Omit<RoomUtility, 'id'>> {
  const specs = computeAutoUtilitySpecsForTarget(doc, target);
  if (specs.length === 0) return [];

  const hasNearbyUtility = (kind: 'prise' | 'arrivee_eau', x: number, z: number) =>
    doc.utilities.some(
      (u) => u.kind === kind && Math.hypot(u.xMm - x, u.zMm - z) <= 450
    );

  return specs.filter(
    (s) =>
      (s.kind !== 'prise' && s.kind !== 'arrivee_eau') ||
      !hasNearbyUtility(s.kind, s.xMm, s.zMm)
  );
}

/**
 * Synchronizes auto-generated utilities linked to a module or prop whenever it moves,
 * rotates, resizes, or is renamed. Also adopts matching unlinked legacy auto-utilities
 * (created before linkedEntityId existed) so older saved projects stay automatically in sync.
 */
export function syncLinkedUtilitiesForEntity(
  doc: ProjectDocument,
  kind: 'module' | 'prop',
  entity: ModuleInstance | SceneProp,
  prevEntity?: ModuleInstance | SceneProp
): RoomUtility[] {
  if (doc.utilities.length === 0) return doc.utilities;

  const target: AutoUtilityTarget =
    kind === 'module'
      ? buildAutoUtilityTargetFromModule(entity as ModuleInstance)
      : buildAutoUtilityTargetFromProp(entity as SceneProp);

  const desiredSpecs = computeAutoUtilitySpecsForTarget(doc, target);
  const desiredByKind = new Map<'arrivee_eau' | 'prise', Omit<RoomUtility, 'id'>>();
  for (const s of desiredSpecs) {
    if (s.kind === 'arrivee_eau' || s.kind === 'prise') {
      desiredByKind.set(s.kind, s);
    }
  }

  // 1. Identify explicitly linked utilities
  const matchedIds = new Set<string>();
  const matchedKinds = new Set<string>();
  for (const u of doc.utilities) {
    if (
      u.linkedEntityId === entity.id &&
      (u.linkedEntityKind === kind || u.linkedEntityKind === undefined)
    ) {
      matchedIds.add(u.id);
      matchedKinds.add(u.kind);
    }
  }

  // 2. Legacy adoption fallback (for older projects where auto-utilities only had "(Name)" in labelFr)
  if (matchedIds.size === 0 && desiredByKind.size > 0) {
    const prevName = prevEntity?.nameFr ?? entity.nameFr;
    const prevX = prevEntity?.xMm ?? entity.xMm;
    const prevZ = prevEntity?.zMm ?? entity.zMm;
    const siblings =
      kind === 'module'
        ? doc.modules.filter((m) => m.id !== entity.id && m.nameFr === prevName)
        : (doc.props ?? []).filter((p) => p.id !== entity.id && p.nameFr === prevName);

    for (const utilKind of desiredByKind.keys()) {
      const expectedLabel =
        utilKind === 'arrivee_eau'
          ? `Arrivée d'eau (${prevName})`
          : `Prise électrique (${prevName})`;

      // Find nearest unlinked legacy utility with exact auto-generated label that isn't closer to another sibling
      let bestUtil: RoomUtility | null = null;
      let bestDist = Infinity;
      for (const u of doc.utilities) {
        if (u.linkedEntityId || u.kind !== utilKind || u.labelFr !== expectedLabel) continue;
        const distToSelf = Math.hypot(u.xMm - prevX, u.zMm - prevZ);
        const closerToSibling = siblings.some(
          (sib) => Math.hypot(u.xMm - sib.xMm, u.zMm - sib.zMm) + 20 < distToSelf
        );
        if (closerToSibling) continue;
        if (distToSelf < bestDist) {
          bestDist = distToSelf;
          bestUtil = u;
        }
      }
      if (bestUtil) {
        matchedIds.add(bestUtil.id);
        matchedKinds.add(bestUtil.kind);
      }
    }
  }

  if (matchedIds.size === 0) return doc.utilities;

  let changed = false;
  const nextUtilities: RoomUtility[] = [];

  for (const u of doc.utilities) {
    if (!matchedIds.has(u.id)) {
      nextUtilities.push(u);
      continue;
    }
    if (u.kind !== 'arrivee_eau' && u.kind !== 'prise') {
      nextUtilities.push(u);
      continue;
    }

    const spec = desiredByKind.get(u.kind);
    if (!spec) {
      // Entity no longer needs this utility kind (e.g. colonne switched from 'four' to 'rangement')
      // or walls were removed; keep if walls exist & entity simply moved far away, drop if variant no longer needs it
      const { needsWater, needsElec } = resolveUtilityNeeds(target);
      const stillNeeds = u.kind === 'arrivee_eau' ? needsWater : needsElec;
      if (!stillNeeds) {
        changed = true;
        continue;
      }
      nextUtilities.push(u);
      continue;
    }

    if (
      u.wallId !== spec.wallId ||
      u.xMm !== spec.xMm ||
      u.yMm !== spec.yMm ||
      u.zMm !== spec.zMm ||
      u.labelFr !== spec.labelFr ||
      u.linkedEntityId !== entity.id ||
      u.linkedEntityKind !== kind
    ) {
      changed = true;
      nextUtilities.push({
        ...u,
        wallId: spec.wallId,
        labelFr: spec.labelFr,
        linkedEntityId: entity.id,
        linkedEntityKind: kind,
        xMm: spec.xMm,
        yMm: spec.yMm,
        zMm: spec.zMm,
      });
    } else {
      nextUtilities.push(u);
    }
  }

  return changed ? nextUtilities : doc.utilities;
}

export function buildAutoUtilityTargetFromModule(mod: ModuleInstance): AutoUtilityTarget {
  return {
    entityId: mod.id,
    kind: 'module',
    type: mod.type,
    nameFr: mod.nameFr,
    xMm: mod.xMm,
    yMm: mod.yMm,
    zMm: mod.zMm,
    attachedWallId: mod.attachedWallId,
    colonneVariant: mod.colonneVariant,
  };
}

export function buildAutoUtilityTargetFromProp(prop: SceneProp): AutoUtilityTarget {
  return {
    entityId: prop.id,
    kind: 'prop',
    type: prop.type,
    nameFr: prop.nameFr,
    xMm: prop.xMm,
    yMm: prop.yMm,
    zMm: prop.zMm,
    attachedWallId: prop.attachedWallId,
  };
}
