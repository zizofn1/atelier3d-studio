import { create, useStore } from 'zustand';
import { temporal, type TemporalState } from 'zundo';
import {
  DEFAULT_VIDEO_STUDIO_CONFIG,
  type CarpentryParams,
  type CeilingLightingConfig,
  type CeilingSpotLight,
  type DevisPricingConfig,
  type ModuleInstance,
  type NestingConfig,
  type ProjectDocument,
  type RoomUtility,
  type SceneProp,
  type VideoStudioConfig,
  type WallOpening,
  type WallSegment,
} from '@/types';
import { DEFAULT_NESTING_CONFIG } from '@/data/defaultPricing';
import { nextPropRef } from '@/data/propsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import {
  DEFAULT_SPOT_INTENSITY,
  analyzeWalls,
  buildCeilingSpotPreset,
  computeRoomBounds,
  getWallInteriorSpanMm,
  syncLinkedUtilitiesForEntity,
  type CeilingSpotPreset,
} from '@/engine/geometry';
import { generateId, nextModuleRef } from '@/utils/id';

export type ProjectTemplateKey = 'cuisine_en_l' | 'dressing_sur_mesure';

export interface ModuleMoveUpdate {
  id: string;
  xMm: number;
  yMm?: number;
  zMm: number;
  rotationYRad?: number;
  attachedWallId?: string;
}

export interface ProjectStoreState {
  document: ProjectDocument;
  setDocument: (doc: ProjectDocument) => void;
  replaceDocument: (doc: ProjectDocument, options?: { clearHistory?: boolean }) => void;
  loadTemplate: (templateKey: ProjectTemplateKey) => void;
  addWall: (wall: Omit<WallSegment, 'id'> & { id?: string }) => string;
  updateWall: (id: string, patch: Partial<Omit<WallSegment, 'id'>>) => void;
  resizeWallNetLength: (wallId: string, nextNetLenMm: number) => void;
  removeWall: (id: string) => void;
  applyRoomPresetWalls: (walls: WallSegment[]) => void;
  addOpening: (opening: Omit<WallOpening, 'id'> & { id?: string }) => string;
  updateOpening: (id: string, patch: Partial<Omit<WallOpening, 'id'>>) => void;
  removeOpening: (id: string) => void;
  addUtility: (utility: Omit<RoomUtility, 'id'> & { id?: string }) => string;
  updateUtility: (id: string, patch: Partial<Omit<RoomUtility, 'id'>>) => void;
  removeUtility: (id: string) => void;
  addModule: (mod: Omit<ModuleInstance, 'id' | 'ref'> & { id?: string; ref?: string }) => string;
  addModuleWithUtilities: (
    mod: Omit<ModuleInstance, 'id' | 'ref'> & { id?: string; ref?: string },
    utilities?: Array<Omit<RoomUtility, 'id'> & { id?: string }>
  ) => string;
  updateModule: (id: string, patch: Partial<Omit<ModuleInstance, 'id'>>) => void;
  updateModulesBatch: (
    ids: string[],
    patch: Partial<Omit<ModuleInstance, 'id' | 'overrides'>> & {
      overrides?: Partial<CarpentryParams>;
    }
  ) => void;
  moveModulesBatch: (moves: ModuleMoveUpdate[]) => void;
  removeModule: (id: string) => void;
  removeModulesBatch: (ids: string[]) => void;
  addProp: (prop: Omit<SceneProp, 'id' | 'ref'> & { id?: string; ref?: string }) => string;
  addPropWithUtilities: (
    prop: Omit<SceneProp, 'id' | 'ref'> & { id?: string; ref?: string },
    utilities?: Array<Omit<RoomUtility, 'id'> & { id?: string }>
  ) => string;
  updateProp: (id: string, patch: Partial<Omit<SceneProp, 'id'>>) => void;
  removeProp: (id: string) => void;
  removePropsBatch: (ids: string[]) => void;
  updateRoomSurfaces: (patch: {
    floorMaterialId?: string;
    floorColorOverride?: string | undefined;
    floorGroutColor?: string | undefined;
    wallColor?: string | undefined;
    allWallsMaterialId?: string;
    clearWallColorOverrides?: boolean;
  }) => void;
  updateGlobalCarpentry: (patch: Partial<CarpentryParams>) => void;
  updateCeilingLighting: (patch: Partial<CeilingLightingConfig>) => void;
  applyCeilingSpotPreset: (preset: CeilingSpotPreset) => void;
  addCeilingSpot: (spot?: Partial<Omit<CeilingSpotLight, 'id'>>) => string;
  updateCeilingSpot: (spotId: string, patch: Partial<Omit<CeilingSpotLight, 'id'>>) => void;
  updateCeilingSpotsBatch: (
    spotIds: string[],
    patch: Partial<Omit<CeilingSpotLight, 'id'>>
  ) => void;
  moveCeilingSpotsBatch: (moves: Array<{ id: string; xMm: number; zMm: number }>) => void;
  alignCeilingSpots: (
    spotIds: string[],
    mode: 'align_x' | 'align_z' | 'distribute_x' | 'distribute_z'
  ) => void;
  removeCeilingSpot: (spotId: string) => void;
  removeCeilingSpotsBatch: (spotIds: string[]) => void;
  updatePricing: (patch: Partial<DevisPricingConfig>) => void;
  updateNestingConfig: (patch: Partial<NestingConfig>) => void;
  updateVideoStudio: (patch: Partial<VideoStudioConfig>) => void;
  setVideoStudio: (config: VideoStudioConfig) => void;
}

export type TemporalProjectSlice = Pick<ProjectStoreState, 'document'>;

function touchDocument(doc: ProjectDocument): ProjectDocument {
  return {
    ...doc,
    updatedAt: new Date().toISOString(),
  };
}

export const useProjectStore = create<ProjectStoreState>()(
  temporal(
    (set, get) => ({
      document: createCuisineEnLTemplate(),

      setDocument: (doc) => {
        set({ document: touchDocument(doc) });
      },

      replaceDocument: (doc, options) => {
        set({ document: doc });
        if (options?.clearHistory) {
          useProjectStore.temporal.getState().clear();
        }
      },

      loadTemplate: (templateKey) => {
        const doc =
          templateKey === 'dressing_sur_mesure'
            ? createDressingSurMesureTemplate()
            : createCuisineEnLTemplate();
        set({ document: doc });
      },

      addWall: (wall) => {
        const id = wall.id ?? generateId('mur');
        set((state) => ({
          document: touchDocument({
            ...state.document,
            walls: [...state.document.walls, { ...wall, id }],
          }),
        }));
        return id;
      },

      updateWall: (id, patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            walls: state.document.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)),
          }),
        }));
      },

      resizeWallNetLength: (wallId, nextNetLenMm) => {
        set((state) => {
          const walls = state.document.walls;
          const target = walls.find((w) => w.id === wallId);
          if (!target) return state;

          const allMetrics = analyzeWalls(walls);
          const wm = allMetrics.find((m) => m.wall.id === wallId);
          if (!wm) return state;

          const span = getWallInteriorSpanMm(wm, allMetrics);
          const nextCenterLen = Math.max(
            200,
            Math.round(nextNetLenMm + span.startInsetMm + span.endInsetMm)
          );
          const deltaLen = nextCenterLen - wm.lengthMm;
          if (Math.abs(deltaLen) < 0.5) return state;

          const deltaX = Math.round(wm.tangent.x * deltaLen);
          const deltaZ = Math.round(wm.tangent.z * deltaLen);
          const oldEnd: [number, number] = [target.endMm[0], target.endMm[1]];
          const newEnd: [number, number] = [oldEnd[0] + deltaX, oldEnd[1] + deltaZ];

          const nearPt = (a: [number, number], b: [number, number]) =>
            Math.hypot(a[0] - b[0], a[1] - b[1]) <= 4;

          // Collect endpoints connected to oldEnd through orthogonal walls so 90° corners stay closed
          const farAnchors: Array<[number, number]> = [];
          const shiftWholeWallIds = new Set<string>();
          for (const other of walls) {
            if (other.id === wallId) continue;
            const touchesStart = nearPt(other.startMm, oldEnd);
            const touchesEnd = nearPt(other.endMm, oldEnd);
            if (!touchesStart && !touchesEnd) continue;

            const odx = other.endMm[0] - other.startMm[0];
            const odz = other.endMm[1] - other.startMm[1];
            const olen = Math.hypot(odx, odz) || 1;
            const dot = Math.abs((odx / olen) * wm.tangent.x + (odz / olen) * wm.tangent.z);
            if (dot < 0.35) {
              shiftWholeWallIds.add(other.id);
              farAnchors.push(touchesStart ? other.endMm : other.startMm);
            }
          }

          const updatedWalls = walls.map((w) => {
            if (w.id === wallId) {
              return { ...w, endMm: newEnd };
            }
            if (shiftWholeWallIds.has(w.id)) {
              return {
                ...w,
                startMm: [w.startMm[0] + deltaX, w.startMm[1] + deltaZ] as [number, number],
                endMm: [w.endMm[0] + deltaX, w.endMm[1] + deltaZ] as [number, number],
              };
            }
            // Adjust endpoints meeting shifted farAnchors (or oldEnd on non-orthogonal walls)
            let nextStart = w.startMm;
            let nextWEnd = w.endMm;
            if (nearPt(w.startMm, oldEnd) || farAnchors.some((fa) => nearPt(w.startMm, fa))) {
              nextStart = [w.startMm[0] + deltaX, w.startMm[1] + deltaZ];
            }
            if (nearPt(w.endMm, oldEnd) || farAnchors.some((fa) => nearPt(w.endMm, fa))) {
              nextWEnd = [w.endMm[0] + deltaX, w.endMm[1] + deltaZ];
            }
            if (nextStart !== w.startMm || nextWEnd !== w.endMm) {
              return { ...w, startMm: nextStart, endMm: nextWEnd };
            }
            return w;
          });

          return {
            document: touchDocument({
              ...state.document,
              walls: updatedWalls,
            }),
          };
        });
      },

      removeWall: (id) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            walls: state.document.walls.filter((w) => w.id !== id),
            openings: state.document.openings.filter((o) => o.wallId !== id),
            utilities: state.document.utilities.map((u) =>
              u.wallId === id ? { ...u, wallId: undefined } : u
            ),
            modules: state.document.modules.map((m) =>
              m.attachedWallId === id ? { ...m, attachedWallId: undefined } : m
            ),
            props: (state.document.props ?? []).map((p) =>
              p.attachedWallId === id ? { ...p, attachedWallId: undefined } : p
            ),
          }),
        }));
      },

      applyRoomPresetWalls: (walls) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            walls,
            openings: [],
            utilities: state.document.utilities.map((u) =>
              u.wallId !== undefined ? { ...u, wallId: undefined } : u
            ),
            modules: state.document.modules.map((m) =>
              m.attachedWallId !== undefined ? { ...m, attachedWallId: undefined } : m
            ),
            props: (state.document.props ?? []).map((p) =>
              p.attachedWallId !== undefined ? { ...p, attachedWallId: undefined } : p
            ),
          }),
        }));
      },

      addOpening: (opening) => {
        const id = opening.id ?? generateId('ouv');
        set((state) => ({
          document: touchDocument({
            ...state.document,
            openings: [...state.document.openings, { ...opening, id }],
          }),
        }));
        return id;
      },

      updateOpening: (id, patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            openings: state.document.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)),
          }),
        }));
      },

      removeOpening: (id) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            openings: state.document.openings.filter((o) => o.id !== id),
          }),
        }));
      },

      addUtility: (utility) => {
        const id = utility.id ?? generateId('util');
        set((state) => ({
          document: touchDocument({
            ...state.document,
            utilities: [...state.document.utilities, { ...utility, id }],
          }),
        }));
        return id;
      },

      updateUtility: (id, patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            utilities: state.document.utilities.map((u) => (u.id === id ? { ...u, ...patch } : u)),
          }),
        }));
      },

      removeUtility: (id) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            utilities: state.document.utilities.filter((u) => u.id !== id),
          }),
        }));
      },

      addModule: (mod) => {
        const id = mod.id ?? generateId('mod');
        const currentModules = get().document.modules;
        const ref = mod.ref ?? nextModuleRef(currentModules);
        set((state) => ({
          document: touchDocument({
            ...state.document,
            modules: [...state.document.modules, { ...mod, id, ref }],
          }),
        }));
        return id;
      },

      addModuleWithUtilities: (mod, utilities = []) => {
        const id = mod.id ?? generateId('mod');
        const currentModules = get().document.modules;
        const ref = mod.ref ?? nextModuleRef(currentModules);
        const newUtilities: RoomUtility[] = utilities.map((u) => ({
          ...u,
          id: u.id ?? generateId('util'),
          linkedEntityId: u.linkedEntityId ?? id,
          linkedEntityKind: u.linkedEntityKind ?? 'module',
        }));
        set((state) => ({
          document: touchDocument({
            ...state.document,
            modules: [...state.document.modules, { ...mod, id, ref }],
            utilities:
              newUtilities.length > 0
                ? [...state.document.utilities, ...newUtilities]
                : state.document.utilities,
          }),
        }));
        return id;
      },

      updateModule: (id, patch) => {
        set((state) => {
          const prevMod = state.document.modules.find((m) => m.id === id);
          if (!prevMod) return state;
          const updatedMod: ModuleInstance = { ...prevMod, ...patch };
          const nextModules = state.document.modules.map((m) => (m.id === id ? updatedMod : m));
          const shouldSyncUtils =
            'xMm' in patch ||
            'yMm' in patch ||
            'zMm' in patch ||
            'widthMm' in patch ||
            'depthMm' in patch ||
            'heightMm' in patch ||
            'rotationYRad' in patch ||
            'attachedWallId' in patch ||
            'nameFr' in patch ||
            'colonneVariant' in patch;
          const nextDoc: ProjectDocument = {
            ...state.document,
            modules: nextModules,
          };
          const nextUtilities = shouldSyncUtils
            ? syncLinkedUtilitiesForEntity(nextDoc, 'module', updatedMod, prevMod)
            : state.document.utilities;
          return {
            document: touchDocument({
              ...nextDoc,
              utilities: nextUtilities,
            }),
          };
        });
      },

      updateModulesBatch: (ids, patch) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        const { overrides: overridePatch, ...restPatch } = patch;
        set((state) => ({
          document: touchDocument({
            ...state.document,
            modules: state.document.modules.map((m) => {
              if (!idSet.has(m.id)) return m;
              return {
                ...m,
                ...restPatch,
                ...(overridePatch !== undefined
                  ? { overrides: { ...m.overrides, ...overridePatch } }
                  : {}),
              };
            }),
          }),
        }));
      },

      moveModulesBatch: (moves) => {
        if (moves.length === 0) return;
        const moveMap = new Map(moves.map((m) => [m.id, m]));
        const currentModules = get().document.modules;
        let changed = false;
        const nextModules = currentModules.map((mod) => {
          const update = moveMap.get(mod.id);
          if (!update) return mod;
          const nextX = update.xMm;
          const nextY = update.yMm ?? mod.yMm;
          const nextZ = update.zMm;
          const nextRot = update.rotationYRad ?? mod.rotationYRad;
          const nextWallId =
            'attachedWallId' in update ? update.attachedWallId : mod.attachedWallId;
          if (
            nextX === mod.xMm &&
            nextY === mod.yMm &&
            nextZ === mod.zMm &&
            nextRot === mod.rotationYRad &&
            nextWallId === mod.attachedWallId
          ) {
            return mod;
          }
          changed = true;
          return {
            ...mod,
            xMm: nextX,
            yMm: nextY,
            zMm: nextZ,
            rotationYRad: nextRot,
            attachedWallId: nextWallId,
          };
        });
        if (!changed) return;
        set((state) => {
          let nextUtilities = state.document.utilities;
          let workingDoc: ProjectDocument = {
            ...state.document,
            modules: nextModules,
          };
          for (const mod of nextModules) {
            if (!moveMap.has(mod.id)) continue;
            const prevMod = currentModules.find((m) => m.id === mod.id);
            nextUtilities = syncLinkedUtilitiesForEntity(workingDoc, 'module', mod, prevMod);
            workingDoc = { ...workingDoc, utilities: nextUtilities };
          }
          return {
            document: touchDocument({
              ...state.document,
              modules: nextModules,
              utilities: nextUtilities,
            }),
          };
        });
      },

      removeModule: (id) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            modules: state.document.modules.filter((m) => m.id !== id),
            utilities: state.document.utilities.filter(
              (u) => !(u.linkedEntityId === id && u.linkedEntityKind !== 'prop')
            ),
          }),
        }));
      },

      removeModulesBatch: (ids) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => ({
          document: touchDocument({
            ...state.document,
            modules: state.document.modules.filter((m) => !idSet.has(m.id)),
            utilities: state.document.utilities.filter(
              (u) => !(u.linkedEntityId && idSet.has(u.linkedEntityId) && u.linkedEntityKind !== 'prop')
            ),
          }),
        }));
      },

      addProp: (prop) => {
        const id = prop.id ?? generateId('prop');
        const currentProps = get().document.props ?? [];
        const ref = prop.ref ?? nextPropRef(currentProps);
        set((state) => ({
          document: touchDocument({
            ...state.document,
            props: [...(state.document.props ?? []), { ...prop, id, ref }],
          }),
        }));
        return id;
      },

      addPropWithUtilities: (prop, utilities = []) => {
        const id = prop.id ?? generateId('prop');
        const currentProps = get().document.props ?? [];
        const ref = prop.ref ?? nextPropRef(currentProps);
        const newUtilities: RoomUtility[] = utilities.map((u) => ({
          ...u,
          id: u.id ?? generateId('util'),
          linkedEntityId: u.linkedEntityId ?? id,
          linkedEntityKind: u.linkedEntityKind ?? 'prop',
        }));
        set((state) => ({
          document: touchDocument({
            ...state.document,
            props: [...(state.document.props ?? []), { ...prop, id, ref }],
            utilities:
              newUtilities.length > 0
                ? [...state.document.utilities, ...newUtilities]
                : state.document.utilities,
          }),
        }));
        return id;
      },

      updateProp: (id, patch) => {
        set((state) => {
          const prevProps = state.document.props ?? [];
          const prevProp = prevProps.find((p) => p.id === id);
          if (!prevProp) return state;
          const updatedProp: SceneProp = { ...prevProp, ...patch };
          const nextProps = prevProps.map((p) => (p.id === id ? updatedProp : p));
          const shouldSyncUtils =
            'xMm' in patch ||
            'yMm' in patch ||
            'zMm' in patch ||
            'widthMm' in patch ||
            'depthMm' in patch ||
            'heightMm' in patch ||
            'rotationYRad' in patch ||
            'attachedWallId' in patch ||
            'nameFr' in patch;
          const nextDoc: ProjectDocument = {
            ...state.document,
            props: nextProps,
          };
          const nextUtilities = shouldSyncUtils
            ? syncLinkedUtilitiesForEntity(nextDoc, 'prop', updatedProp, prevProp)
            : state.document.utilities;
          return {
            document: touchDocument({
              ...nextDoc,
              utilities: nextUtilities,
            }),
          };
        });
      },

      removeProp: (id) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            props: (state.document.props ?? []).filter((p) => p.id !== id),
            utilities: state.document.utilities.filter(
              (u) => !(u.linkedEntityId === id && u.linkedEntityKind !== 'module')
            ),
          }),
        }));
      },

      removePropsBatch: (ids) => {
        if (ids.length === 0) return;
        const idSet = new Set(ids);
        set((state) => ({
          document: touchDocument({
            ...state.document,
            props: (state.document.props ?? []).filter((p) => !idSet.has(p.id)),
            utilities: state.document.utilities.filter(
              (u) => !(u.linkedEntityId && idSet.has(u.linkedEntityId) && u.linkedEntityKind !== 'module')
            ),
          }),
        }));
      },

      updateRoomSurfaces: (patch) => {
        set((state) => {
          const doc = state.document;
          const nextWalls =
            patch.allWallsMaterialId || patch.clearWallColorOverrides
              ? doc.walls.map((w) => ({
                  ...w,
                  ...(patch.allWallsMaterialId ? { materialId: patch.allWallsMaterialId } : {}),
                  ...(patch.clearWallColorOverrides ? { colorOverride: undefined } : {}),
                }))
              : doc.walls;

          return {
            document: touchDocument({
              ...doc,
              ...('floorMaterialId' in patch && patch.floorMaterialId !== undefined
                ? { floorMaterialId: patch.floorMaterialId }
                : {}),
              ...('floorColorOverride' in patch
                ? { floorColorOverride: patch.floorColorOverride }
                : {}),
              ...('floorGroutColor' in patch ? { floorGroutColor: patch.floorGroutColor } : {}),
              ...('wallColor' in patch ? { wallColor: patch.wallColor } : {}),
              walls: nextWalls,
            }),
          };
        });
      },

      updateGlobalCarpentry: (patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            defaultCarpentry: {
              ...state.document.defaultCarpentry,
              ...patch,
            },
          }),
        }));
      },

      updateCeilingLighting: (patch) => {
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                ...patch,
              },
            }),
          };
        });
      },

      applyCeilingSpotPreset: (preset) => {
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const spots = buildCeilingSpotPreset(state.document.walls, preset);
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spotsEnabled: true,
                spots,
              },
            }),
          };
        });
      },

      addCeilingSpot: (spot) => {
        const id = generateId('spot');
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const bounds = computeRoomBounds(state.document.walls, true);
          let spawnX = Math.round(spot?.xMm ?? bounds.center.x);
          let spawnZ = Math.round(spot?.zMm ?? bounds.center.z);
          if (spot?.xMm === undefined && spot?.zMm === undefined) {
            // Offset cleanly so adding multiple spots never stacks directly on top of an existing spot
            const offsets: Array<[number, number]> = [
              [0, 0],
              [350, 0],
              [-350, 0],
              [0, 350],
              [0, -350],
              [350, 350],
              [-350, -350],
              [350, -350],
              [-350, 350],
            ];
            for (const [ox, oz] of offsets) {
              const cx = Math.round(bounds.center.x + ox);
              const cz = Math.round(bounds.center.z + oz);
              const crowded = baseSpots.some((s) => Math.hypot(s.xMm - cx, s.zMm - cz) < 220);
              if (!crowded) {
                spawnX = cx;
                spawnZ = cz;
                break;
              }
            }
          }
          const nextSpot: CeilingSpotLight = {
            id,
            labelFr: spot?.labelFr ?? `Spot ${baseSpots.length + 1}`,
            xMm: spawnX,
            zMm: spawnZ,
            intensity: spot?.intensity ?? 1,
            enabled: spot?.enabled ?? true,
          };
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spotsEnabled: true,
                spots: [...baseSpots, nextSpot],
              },
            }),
          };
        });
        return id;
      },

      updateCeilingSpot: (spotId, patch) => {
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const nextSpots = baseSpots.map((s) => (s.id === spotId ? { ...s, ...patch } : s));
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
              },
            }),
          };
        });
      },

      updateCeilingSpotsBatch: (spotIds, patch) => {
        if (spotIds.length === 0) return;
        const idSet = new Set(spotIds);
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const nextSpots = baseSpots.map((s) => (idSet.has(s.id) ? { ...s, ...patch } : s));
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
              },
            }),
          };
        });
      },

      moveCeilingSpotsBatch: (moves) => {
        if (moves.length === 0) return;
        const byId = new Map(moves.map((m) => [m.id, m]));
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const nextSpots = baseSpots.map((s) => {
            const mv = byId.get(s.id);
            return mv ? { ...s, xMm: Math.round(mv.xMm), zMm: Math.round(mv.zMm) } : s;
          });
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
              },
            }),
          };
        });
      },

      alignCeilingSpots: (spotIds, mode) => {
        if (spotIds.length < 2) return;
        const idSet = new Set(spotIds);
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const targets = baseSpots.filter((s) => idSet.has(s.id));
          if (targets.length < 2) return state;

          const updates = new Map<string, Partial<CeilingSpotLight>>();
          if (mode === 'align_x') {
            const avgX = Math.round(targets.reduce((acc, s) => acc + s.xMm, 0) / targets.length);
            for (const s of targets) updates.set(s.id, { xMm: avgX });
          } else if (mode === 'align_z') {
            const avgZ = Math.round(targets.reduce((acc, s) => acc + s.zMm, 0) / targets.length);
            for (const s of targets) updates.set(s.id, { zMm: avgZ });
          } else if (mode === 'distribute_x') {
            const sorted = [...targets].sort((a, b) => a.xMm - b.xMm);
            const minX = sorted[0].xMm;
            const maxX = sorted[sorted.length - 1].xMm;
            const step = (maxX - minX) / (sorted.length - 1);
            sorted.forEach((s, idx) => updates.set(s.id, { xMm: Math.round(minX + step * idx) }));
          } else if (mode === 'distribute_z') {
            const sorted = [...targets].sort((a, b) => a.zMm - b.zMm);
            const minZ = sorted[0].zMm;
            const maxZ = sorted[sorted.length - 1].zMm;
            const step = (maxZ - minZ) / (sorted.length - 1);
            sorted.forEach((s, idx) => updates.set(s.id, { zMm: Math.round(minZ + step * idx) }));
          }

          const nextSpots = baseSpots.map((s) => {
            const u = updates.get(s.id);
            return u ? { ...s, ...u } : s;
          });
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
              },
            }),
          };
        });
      },

      removeCeilingSpot: (spotId) => {
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const nextSpots = baseSpots.filter((s) => s.id !== spotId);
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
                ...(nextSpots.length === 0 ? { spotsEnabled: false } : {}),
              },
            }),
          };
        });
      },

      removeCeilingSpotsBatch: (spotIds) => {
        if (spotIds.length === 0) return;
        const idSet = new Set(spotIds);
        set((state) => {
          const prev = state.document.ceilingLighting ?? {
            spotIntensity: DEFAULT_SPOT_INTENSITY,
            spotsEnabled: true,
          };
          const baseSpots =
            prev.spots && prev.spots.length > 0
              ? prev.spots
              : buildCeilingSpotPreset(state.document.walls, 'grid_2x2');
          const nextSpots = baseSpots.filter((s) => !idSet.has(s.id));
          return {
            document: touchDocument({
              ...state.document,
              ceilingLighting: {
                ...prev,
                spots: nextSpots,
                ...(nextSpots.length === 0 ? { spotsEnabled: false } : {}),
              },
            }),
          };
        });
      },

      updatePricing: (patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            pricing: {
              ...state.document.pricing,
              ...patch,
            },
          }),
        }));
      },

      updateNestingConfig: (patch) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            nestingConfig: {
              ...(state.document.nestingConfig ?? DEFAULT_NESTING_CONFIG),
              ...patch,
            },
          }),
        }));
      },

      updateVideoStudio: (patch) => {
        set((state) => {
          const prev = state.document.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;
          return {
            document: touchDocument({
              ...state.document,
              videoStudio: {
                ...prev,
                ...patch,
                branding: patch.branding
                  ? { ...prev.branding, ...patch.branding }
                  : prev.branding,
              },
            }),
          };
        });
      },

      setVideoStudio: (config) => {
        set((state) => ({
          document: touchDocument({
            ...state.document,
            videoStudio: config,
          }),
        }));
      },
    }),
    {
      limit: 50,
      partialize: (state): TemporalProjectSlice => ({ document: state.document }),
      equality: (pastState, currentState) => pastState.document === currentState.document,
    }
  )
);

export function useProjectTemporal<T>(
  selector: (state: TemporalState<TemporalProjectSlice>) => T
): T {
  return useStore(useProjectStore.temporal, selector);
}

export function pauseHistory(): void {
  useProjectStore.temporal.getState().pause();
}

export function resumeHistory(): void {
  useProjectStore.temporal.getState().resume();
}
