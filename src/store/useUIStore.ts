import { create } from 'zustand';
import type { DisplayUnit, RoomUtilityKind, WallOpeningKind } from '@/types';
import {
  getDefaultStyleSettings,
  getRenderStylePreset,
  type RenderStyleId,
  type RenderStyleSettings,
} from '@/materials/renderStyles';
import {
  applyThemeToDom,
  loadStoredThemePreference,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from '@/styles/themeTokens';

export type ViewMode = 'plan2d' | 'elevation2d' | 'view3d' | 'split';
export type WorkspaceTab = 'conception' | 'cutlist' | 'nesting' | 'devis';
export type SelectedEntityKind = 'wall' | 'opening' | 'utility' | 'module' | 'prop' | 'floor' | 'spot' | null;
export type CameraMode = 'orbit' | 'walkthrough';
export type PresentationMode = 'conception' | 'client';
export type LightingPreset = 'jour' | 'nuit';
export type RenderQuality = 'standard' | 'fort' | 'ultra';
export interface Plan2dFilters {
  base: boolean;
  upper: boolean;
  surfaces: boolean;
  props: boolean;
}
export type ActiveTool =
  | 'select'
  | 'draw_wall'
  | `add_${WallOpeningKind}`
  | `add_${RoomUtilityKind}`;
export type LeftPanelTab = 'catalogue' | 'electro' | 'materiaux' | 'atelier';

export interface UIStoreState {
  viewMode: ViewMode;
  activeWorkspaceTab: WorkspaceTab;
  displayUnit: DisplayUnit;
  selectedId: string | null;
  selectedIds: string[];
  selectedKind: SelectedEntityKind;
  activeWallId: string | null;
  cameraMode: CameraMode;
  presentationMode: PresentationMode;
  wallCutaway: boolean;
  cabinetCutaway: boolean;
  activeCameraZoneId: string | null;
  cameraTransitionNonce: number;
  interiorFov: number;
  exteriorFov: number;
  renderQuality: RenderQuality;
  renderStyle: RenderStyleSettings;
  isDragging3D: boolean;
  lightingPreset: LightingPreset;
  ledEnabled: boolean;
  openAll: boolean;
  openModuleIds: Record<string, boolean>;
  isCapturingRender: boolean;
  sceneReady: boolean;
  videoStudioMode: boolean;
  videoPlayheadSec: number;
  videoIsPlaying: boolean;
  videoExportState: {
    active: boolean;
    currentFrame: number;
    totalFrames: number;
    phaseFr: string;
  } | null;

  activeTool: ActiveTool;
  leftPanelTab: LeftPanelTab;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  freePlacementMode: boolean;
  autoUtilitiesEnabled: boolean;
  plan2dFilters: Plan2dFilters;
  showCeilingSpots2D: boolean;
  userOrientedIds: Record<string, boolean>;
  isProjectLibraryOpen: boolean;
  isExportModalOpen: boolean;
  themePreference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  isCommandPaletteOpen: boolean;
  isShortcutsHelpOpen: boolean;

  setViewMode: (mode: ViewMode) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  setDisplayUnit: (unit: DisplayUnit) => void;
  toggleDisplayUnit: () => void;
  selectEntity: (id: string | null, kind: SelectedEntityKind) => void;
  toggleSelectEntity: (id: string, kind: Exclude<SelectedEntityKind, null>) => void;
  setSelectedIds: (ids: string[], kind: SelectedEntityKind) => void;
  clearSelection: () => void;
  setActiveWallId: (id: string | null) => void;
  setCameraMode: (mode: CameraMode) => void;
  toggleCameraMode: () => void;
  setPresentationMode: (mode: PresentationMode) => void;
  togglePresentationMode: () => void;
  setWallCutaway: (enabled: boolean) => void;
  toggleWallCutaway: () => void;
  setCabinetCutaway: (enabled: boolean) => void;
  toggleCabinetCutaway: () => void;
  selectCameraZone: (zoneId: string) => void;
  setInteriorFov: (fov: number) => void;
  setExteriorFov: (fov: number) => void;
  setRenderQuality: (quality: RenderQuality) => void;
  toggleRenderQuality: () => void;
  selectRenderStyle: (styleId: RenderStyleId) => void;
  updateRenderStyleSetting: (patch: Partial<Omit<RenderStyleSettings, 'styleId'>>) => void;
  resetRenderStyle: () => void;
  setIsDragging3D: (dragging: boolean) => void;
  setLightingPreset: (preset: LightingPreset) => void;
  toggleLightingPreset: () => void;
  setLedEnabled: (enabled: boolean) => void;
  toggleLed: () => void;
  setOpenAll: (open: boolean) => void;
  toggleOpenAll: () => void;
  toggleModuleOpen: (moduleId: string) => void;
  setIsCapturingRender: (capturing: boolean) => void;
  setSceneReady: (ready: boolean) => void;
  setVideoStudioMode: (enabled: boolean) => void;
  setVideoPlayheadSec: (sec: number) => void;
  setVideoIsPlaying: (playing: boolean) => void;
  setVideoExportState: (
    state: {
      active: boolean;
      currentFrame: number;
      totalFrames: number;
      phaseFr: string;
    } | null
  ) => void;
  setActiveTool: (tool: ActiveTool) => void;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setLeftPanelOpen: (open: boolean) => void;
  toggleLeftPanel: () => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setFreePlacementMode: (enabled: boolean) => void;
  toggleFreePlacementMode: () => void;
  setAutoUtilitiesEnabled: (enabled: boolean) => void;
  toggleAutoUtilitiesEnabled: () => void;
  togglePlan2dFilter: (key: keyof Plan2dFilters) => void;
  resetPlan2dFilters: () => void;
  toggleShowCeilingSpots2D: () => void;
  markUserOriented: (id: string, oriented?: boolean) => void;
  setProjectLibraryOpen: (open: boolean) => void;
  setExportModalOpen: (open: boolean) => void;
  setThemePreference: (pref: ThemePreference) => void;
  cycleThemePreference: () => void;
  syncSystemTheme: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setShortcutsHelpOpen: (open: boolean) => void;
}

const isInitialWideScreen =
  typeof window === 'undefined' ? true : window.innerWidth >= 1024;
const initialThemePref = loadStoredThemePreference();
const initialResolvedTheme = applyThemeToDom(initialThemePref);

export const useUIStore = create<UIStoreState>()((set) => ({
  viewMode: 'split',
  activeWorkspaceTab: 'conception',
  displayUnit: 'mm',
  selectedId: null,
  selectedIds: [],
  selectedKind: null,
  activeWallId: null,
  cameraMode: 'orbit',
  presentationMode: 'conception',
  wallCutaway: true,
  cabinetCutaway: true,
  activeCameraZoneId: 'global',
  cameraTransitionNonce: 0,
  interiorFov: 50,
  exteriorFov: 50,
  renderQuality: 'fort',
  renderStyle: getDefaultStyleSettings('showroom_luxe'),
  isDragging3D: false,
  lightingPreset: 'nuit',
  ledEnabled: true,
  openAll: false,
  openModuleIds: {},
  isCapturingRender: false,
  sceneReady: false,
  videoStudioMode: false,
  videoPlayheadSec: 0,
  videoIsPlaying: false,
  videoExportState: null,

  activeTool: 'select',
  leftPanelTab: 'catalogue',
  leftPanelOpen: isInitialWideScreen,
  rightPanelOpen: isInitialWideScreen,
  freePlacementMode: false,
  autoUtilitiesEnabled: true,
  plan2dFilters: { base: true, upper: true, surfaces: true, props: true },
  showCeilingSpots2D: true,
  userOrientedIds: {},
  isProjectLibraryOpen: false,
  isExportModalOpen: false,
  themePreference: initialThemePref,
  resolvedTheme: initialResolvedTheme,
  isCommandPaletteOpen: false,
  isShortcutsHelpOpen: false,

  setViewMode: (viewMode) => set({ viewMode }),
  setActiveWorkspaceTab: (activeWorkspaceTab) => set({ activeWorkspaceTab }),
  setDisplayUnit: (displayUnit) => set({ displayUnit }),
  toggleDisplayUnit: () =>
    set((s) => ({ displayUnit: s.displayUnit === 'mm' ? 'cm' : 'mm' })),

  selectEntity: (selectedId, selectedKind) =>
    set({
      selectedId,
      selectedIds: selectedId ? [selectedId] : [],
      selectedKind,
    }),

  toggleSelectEntity: (id, kind) =>
    set((s) => {
      // Multi-select is focused on homogeneous entities (modules or props); switching kind resets cleanly
      if (s.selectedKind !== kind) {
        return {
          selectedId: id,
          selectedIds: [id],
          selectedKind: kind,
        };
      }
      const exists = s.selectedIds.includes(id);
      const nextIds = exists
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id];
      return {
        selectedId: nextIds[nextIds.length - 1] ?? null,
        selectedIds: nextIds,
        selectedKind: nextIds.length > 0 ? kind : null,
      };
    }),

  setSelectedIds: (ids, kind) => {
    const unique = Array.from(new Set(ids));
    set({
      selectedId: unique[unique.length - 1] ?? null,
      selectedIds: unique,
      selectedKind: unique.length > 0 ? kind : null,
    });
  },

  clearSelection: () => set({ selectedId: null, selectedIds: [], selectedKind: null }),
  setActiveWallId: (activeWallId) => set({ activeWallId }),

  setCameraMode: (cameraMode) => set({ cameraMode }),
  toggleCameraMode: () =>
    set((s) => ({ cameraMode: s.cameraMode === 'orbit' ? 'walkthrough' : 'orbit' })),

  setPresentationMode: (presentationMode) =>
    set((s) => ({
      presentationMode,
      ...(presentationMode === 'client'
        ? {
            selectedId: null,
            selectedIds: [],
            selectedKind: null,
            activeWorkspaceTab: 'conception' as WorkspaceTab,
            viewMode: s.viewMode === 'plan2d' || s.viewMode === 'elevation2d' ? 'view3d' : s.viewMode,
          }
        : {}),
    })),
  togglePresentationMode: () =>
    set((s) => {
      const next: PresentationMode = s.presentationMode === 'conception' ? 'client' : 'conception';
      return {
        presentationMode: next,
        ...(next === 'client'
          ? {
              selectedId: null,
              selectedIds: [],
              selectedKind: null,
              activeWorkspaceTab: 'conception' as WorkspaceTab,
              viewMode: s.viewMode === 'plan2d' || s.viewMode === 'elevation2d' ? 'view3d' : s.viewMode,
            }
          : {}),
      };
    }),

  setWallCutaway: (wallCutaway) => set({ wallCutaway }),
  toggleWallCutaway: () => set((s) => ({ wallCutaway: !s.wallCutaway })),
  setCabinetCutaway: (cabinetCutaway) => set({ cabinetCutaway }),
  toggleCabinetCutaway: () => set((s) => ({ cabinetCutaway: !s.cabinetCutaway })),

  selectCameraZone: (activeCameraZoneId) =>
    set((s) => ({
      activeCameraZoneId,
      cameraTransitionNonce: s.cameraTransitionNonce + 1,
    })),

  setInteriorFov: (fov) =>
    set({ interiorFov: Math.max(50, Math.min(85, Math.round(fov))) }),
  setExteriorFov: (fov) =>
    set({ exteriorFov: Math.max(50, Math.min(85, Math.round(fov))) }),
  setRenderQuality: (renderQuality) => set({ renderQuality }),
  toggleRenderQuality: () =>
    set((s) => ({
      renderQuality:
        s.renderQuality === 'standard'
          ? 'fort'
          : s.renderQuality === 'fort'
            ? 'ultra'
            : 'standard',
    })),

  selectRenderStyle: (styleId) => {
    const preset = getRenderStylePreset(styleId);
    set({
      renderStyle: getDefaultStyleSettings(styleId),
      lightingPreset: preset.isNightMood ? 'nuit' : 'jour',
      ledEnabled: preset.defaultLedEnabled,
    });
  },
  updateRenderStyleSetting: (patch) =>
    set((s) => ({
      renderStyle: {
        ...s.renderStyle,
        ...patch,
      },
    })),
  resetRenderStyle: () =>
    set((s) => ({
      renderStyle: getDefaultStyleSettings(s.renderStyle.styleId),
    })),

  setIsDragging3D: (isDragging3D) => set({ isDragging3D }),

  setLightingPreset: (lightingPreset) => set({ lightingPreset }),
  toggleLightingPreset: () =>
    set((s) => ({ lightingPreset: s.lightingPreset === 'jour' ? 'nuit' : 'jour' })),

  setLedEnabled: (ledEnabled) => set({ ledEnabled }),
  toggleLed: () => set((s) => ({ ledEnabled: !s.ledEnabled })),

  setOpenAll: (openAll) => set({ openAll, openModuleIds: {} }),
  toggleOpenAll: () =>
    set((s) => ({
      openAll: !s.openAll,
      openModuleIds: {},
    })),

  toggleModuleOpen: (moduleId) =>
    set((s) => {
      const current = s.openModuleIds[moduleId] ?? s.openAll;
      return {
        openModuleIds: {
          ...s.openModuleIds,
          [moduleId]: !current,
        },
      };
    }),

  setIsCapturingRender: (isCapturingRender) => set({ isCapturingRender }),
  setSceneReady: (sceneReady) => set({ sceneReady }),
  setVideoStudioMode: (videoStudioMode) =>
    set(() => ({
      videoStudioMode,
      videoIsPlaying: false,
      ...(videoStudioMode
        ? {
            selectedId: null,
            selectedIds: [],
            selectedKind: null,
            presentationMode: 'conception' as PresentationMode,
            activeWorkspaceTab: 'conception' as WorkspaceTab,
            viewMode: 'view3d' as ViewMode,
          }
        : {
            videoExportState: null,
          }),
    })),
  setVideoPlayheadSec: (videoPlayheadSec) =>
    set({ videoPlayheadSec: Math.max(0, Number.isFinite(videoPlayheadSec) ? videoPlayheadSec : 0) }),
  setVideoIsPlaying: (videoIsPlaying) => set({ videoIsPlaying }),
  setVideoExportState: (videoExportState) => set({ videoExportState }),
  setActiveTool: (activeTool) => set({ activeTool }),
  setLeftPanelTab: (leftPanelTab) => set({ leftPanelTab }),
  setLeftPanelOpen: (leftPanelOpen) => set({ leftPanelOpen }),
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  setRightPanelOpen: (rightPanelOpen) => set({ rightPanelOpen }),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  setFreePlacementMode: (freePlacementMode) => set({ freePlacementMode }),
  toggleFreePlacementMode: () => set((s) => ({ freePlacementMode: !s.freePlacementMode })),
  setAutoUtilitiesEnabled: (autoUtilitiesEnabled) => set({ autoUtilitiesEnabled }),
  toggleAutoUtilitiesEnabled: () =>
    set((s) => ({ autoUtilitiesEnabled: !s.autoUtilitiesEnabled })),
  togglePlan2dFilter: (key) =>
    set((s) => ({
      plan2dFilters: {
        ...s.plan2dFilters,
        [key]: !s.plan2dFilters[key],
      },
    })),
  resetPlan2dFilters: () =>
    set({ plan2dFilters: { base: true, upper: true, surfaces: true, props: true } }),
  toggleShowCeilingSpots2D: () =>
    set((s) => ({ showCeilingSpots2D: !s.showCeilingSpots2D })),
  markUserOriented: (id, oriented = true) =>
    set((s) => ({
      userOrientedIds: oriented
        ? { ...s.userOrientedIds, [id]: true }
        : Object.fromEntries(Object.entries(s.userOrientedIds).filter(([k]) => k !== id)),
    })),
  setProjectLibraryOpen: (isProjectLibraryOpen) => set({ isProjectLibraryOpen }),
  setExportModalOpen: (isExportModalOpen) => set({ isExportModalOpen }),
  setThemePreference: (themePreference) => {
    saveThemePreference(themePreference);
    const resolvedTheme = applyThemeToDom(themePreference);
    set({ themePreference, resolvedTheme });
  },
  cycleThemePreference: () =>
    set((s) => {
      const order: ThemePreference[] = ['sombre', 'clair', 'auto'];
      const next = order[(order.indexOf(s.themePreference) + 1) % order.length];
      saveThemePreference(next);
      const resolvedTheme = applyThemeToDom(next);
      return { themePreference: next, resolvedTheme };
    }),
  syncSystemTheme: () =>
    set((s) => {
      if (s.themePreference !== 'auto') return s;
      const resolvedTheme = applyThemeToDom('auto');
      return resolvedTheme === s.resolvedTheme ? s : { resolvedTheme };
    }),
  setCommandPaletteOpen: (isCommandPaletteOpen) => set({ isCommandPaletteOpen }),
  toggleCommandPalette: () => set((s) => ({ isCommandPaletteOpen: !s.isCommandPaletteOpen })),
  setShortcutsHelpOpen: (isShortcutsHelpOpen) => set({ isShortcutsHelpOpen }),
}));
