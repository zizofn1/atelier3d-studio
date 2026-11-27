import type {
  CeilingSpotLight,
  CollisionWarning,
  CutlistItem,
  DevisSummary,
  HardwareKind,
  HardwareRequirement,
  ModuleInstance,
  ModuleOutput,
  NestingRunResult,
  PanelSpec,
  ProjectDocument,
  RoomUtility,
  SceneProp,
  WallOpening,
  WallSegment,
} from '@/types';
import { DEFAULT_NESTING_CONFIG } from '@/data/defaultPricing';
import { generateModuleOutput } from '@/engine/carpentry';
import { buildCutlist, computeDevisSummary, cutlistToNestingPieces } from '@/engine/devis';
import { detectProjectCollisions, resolveCeilingLighting } from '@/engine/geometry';
import { runGuillotineNesting } from '@/engine/nesting';
import { roundMm } from '@/utils/units';
import type { SelectedEntityKind } from './useUIStore';

export type SelectedEntity =
  | { kind: 'wall'; entity: WallSegment }
  | { kind: 'opening'; entity: WallOpening }
  | { kind: 'utility'; entity: RoomUtility }
  | { kind: 'module'; entity: ModuleInstance }
  | { kind: 'prop'; entity: SceneProp }
  | { kind: 'floor'; entity: { id: 'sol' } }
  | { kind: 'spot'; entity: CeilingSpotLight }
  | null;

export function selectActiveWall(
  doc: ProjectDocument,
  activeWallId: string | null
): WallSegment | null {
  if (activeWallId) {
    const found = doc.walls.find((w) => w.id === activeWallId);
    if (found) return found;
  }
  return doc.walls[0] ?? null;
}

export function selectSelectedEntity(
  doc: ProjectDocument,
  selectedId: string | null,
  selectedKind: SelectedEntityKind
): SelectedEntity {
  if (!selectedId || !selectedKind) return null;

  switch (selectedKind) {
    case 'wall': {
      const entity = doc.walls.find((w) => w.id === selectedId);
      return entity ? { kind: 'wall', entity } : null;
    }
    case 'opening': {
      const entity = doc.openings.find((o) => o.id === selectedId);
      return entity ? { kind: 'opening', entity } : null;
    }
    case 'utility': {
      const entity = doc.utilities.find((u) => u.id === selectedId);
      return entity ? { kind: 'utility', entity } : null;
    }
    case 'module': {
      const entity = doc.modules.find((m) => m.id === selectedId);
      return entity ? { kind: 'module', entity } : null;
    }
    case 'prop': {
      const entity = (doc.props ?? []).find((p) => p.id === selectedId);
      return entity ? { kind: 'prop', entity } : null;
    }
    case 'floor': {
      return { kind: 'floor', entity: { id: 'sol' } };
    }
    case 'spot': {
      const { spots } = resolveCeilingLighting(doc.walls, doc.ceilingLighting);
      const entity = spots.find((s) => s.id === selectedId);
      return entity ? { kind: 'spot', entity } : null;
    }
    default:
      return null;
  }
}

export function selectProjectCounts(doc: ProjectDocument): {
  moduleCount: number;
  wallCount: number;
  openingCount: number;
  utilityCount: number;
} {
  return {
    moduleCount: doc.modules.length,
    wallCount: doc.walls.length,
    openingCount: doc.openings.length,
    utilityCount: doc.utilities.length,
  };
}

export interface ProjectPanelEntry {
  moduleId: string;
  moduleRef: string;
  moduleNameFr: string;
  panel: PanelSpec;
}

const moduleOutputsCache = new WeakMap<ProjectDocument, Map<string, ModuleOutput>>();
const panelsCache = new WeakMap<ProjectDocument, ProjectPanelEntry[]>();
const hardwareCache = new WeakMap<ProjectDocument, HardwareRequirement[]>();
const collisionsCache = new WeakMap<ProjectDocument, CollisionWarning[]>();
const collisionModuleIdsCache = new WeakMap<ProjectDocument, Set<string>>();
const cutlistCache = new WeakMap<ProjectDocument, CutlistItem[]>();
const nestingCache = new WeakMap<ProjectDocument, NestingRunResult>();
const devisCache = new WeakMap<ProjectDocument, DevisSummary>();

export function selectProjectModuleOutputs(
  doc: ProjectDocument
): Map<string, ModuleOutput> {
  const cached = moduleOutputsCache.get(doc);
  if (cached) return cached;

  const map = new Map<string, ModuleOutput>();
  for (const mod of doc.modules) {
    map.set(mod.id, generateModuleOutput(mod, doc.defaultCarpentry));
  }
  moduleOutputsCache.set(doc, map);
  return map;
}

export function selectProjectPanels(doc: ProjectDocument): ProjectPanelEntry[] {
  const cached = panelsCache.get(doc);
  if (cached) return cached;

  const outputs = selectProjectModuleOutputs(doc);
  const entries: ProjectPanelEntry[] = [];
  for (const mod of doc.modules) {
    const out = outputs.get(mod.id);
    if (!out) continue;
    for (const panel of out.panels) {
      entries.push({
        moduleId: mod.id,
        moduleRef: mod.ref,
        moduleNameFr: mod.nameFr,
        panel,
      });
    }
  }
  panelsCache.set(doc, entries);
  return entries;
}

export function selectProjectHardware(doc: ProjectDocument): HardwareRequirement[] {
  const cached = hardwareCache.get(doc);
  if (cached) return cached;

  const outputs = selectProjectModuleOutputs(doc);
  const totals = new Map<HardwareKind, number>();
  for (const mod of doc.modules) {
    const out = outputs.get(mod.id);
    if (!out) continue;
    for (const req of out.hardware) {
      totals.set(req.kind, roundMm((totals.get(req.kind) ?? 0) + req.quantity, 2));
    }
  }

  const list: HardwareRequirement[] = [];
  for (const [kind, quantity] of totals.entries()) {
    if (quantity > 0) {
      list.push({ kind, quantity });
    }
  }
  hardwareCache.set(doc, list);
  return list;
}

export function selectProjectCollisions(doc: ProjectDocument): CollisionWarning[] {
  const cached = collisionsCache.get(doc);
  if (cached) return cached;

  const warnings = detectProjectCollisions(doc);
  collisionsCache.set(doc, warnings);
  return warnings;
}

export function selectCollisionModuleIds(doc: ProjectDocument): Set<string> {
  const cached = collisionModuleIdsCache.get(doc);
  if (cached) return cached;

  const warnings = selectProjectCollisions(doc);
  const ids = new Set<string>();
  for (const w of warnings) {
    ids.add(w.moduleId);
    if (w.kind === 'module') {
      ids.add(w.targetId);
    }
  }
  collisionModuleIdsCache.set(doc, ids);
  return ids;
}

export function selectCutlist(doc: ProjectDocument): CutlistItem[] {
  const cached = cutlistCache.get(doc);
  if (cached) return cached;

  const list = buildCutlist(doc);
  cutlistCache.set(doc, list);
  return list;
}

export function selectNesting(doc: ProjectDocument): NestingRunResult {
  const cached = nestingCache.get(doc);
  if (cached) return cached;

  const cutlist = selectCutlist(doc);
  const pieces = cutlistToNestingPieces(cutlist);
  const config = doc.nestingConfig ?? DEFAULT_NESTING_CONFIG;
  const result = runGuillotineNesting(pieces, config);
  nestingCache.set(doc, result);
  return result;
}

export function selectDevis(doc: ProjectDocument): DevisSummary {
  const cached = devisCache.get(doc);
  if (cached) return cached;

  const cutlist = selectCutlist(doc);
  const nesting = selectNesting(doc);
  const summary = computeDevisSummary(doc, nesting, cutlist);
  devisCache.set(doc, summary);
  return summary;
}
