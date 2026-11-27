import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Calculator,
  ChevronDown,
  Columns2,
  Command,
  DoorOpen,
  Download,
  Eye,
  FileSpreadsheet,
  Film,
  FolderOpen,
  Footprints,
  Keyboard,
  Layers,
  Lightbulb,
  Monitor,
  Moon,
  Orbit,
  PenTool,
  Redo2,
  Ruler,
  Save,
  Share2,
  SlidersHorizontal,
  SquareSplitVertical,
  Sun,
  Undo2,
} from 'lucide-react';
import type { CurrencyCode } from '@/types';
import { FR } from '@/i18n/fr';
import { saveProject } from '@/persistence/indexedDb';
import { serializeProjectToJson } from '@/persistence/jsonSerializer';
import { useProjectStore, useProjectTemporal } from '@/store/useProjectStore';
import {
  useUIStore,
  type RenderQuality,
  type ViewMode,
  type WorkspaceTab,
} from '@/store/useUIStore';
import type { ThemePreference } from '@/styles/themeTokens';
import { convertCurrency } from '@/utils/currency';
import { APP_VERSION_BADGE } from '@/utils/appVersion';
import { downloadTextFile } from '@/utils/download';

const WORKSPACE_TABS: Array<{ id: WorkspaceTab; label: string; testId: string; icon: typeof PenTool }> = [
  { id: 'conception', label: FR.tabs.conception, testId: 'tab-conception', icon: PenTool },
  { id: 'cutlist', label: FR.tabs.cutlist, testId: 'tab-cutlist', icon: FileSpreadsheet },
  { id: 'nesting', label: FR.tabs.nesting, testId: 'tab-nesting', icon: Layers },
  { id: 'devis', label: FR.tabs.devis, testId: 'tab-devis', icon: Calculator },
];

const VIEW_MODES: Array<{
  id: ViewMode;
  label: string;
  testId: string;
  icon: typeof SquareSplitVertical;
}> = [
  { id: 'plan2d', label: FR.viewModes.plan2d, testId: 'view-mode-plan', icon: Ruler },
  {
    id: 'elevation2d',
    label: FR.viewModes.elevation2d,
    testId: 'view-mode-elevation',
    icon: SquareSplitVertical,
  },
  { id: 'view3d', label: FR.viewModes.view3d, testId: 'view-mode-3d', icon: Box },
  { id: 'split', label: FR.viewModes.split, testId: 'view-mode-split', icon: Columns2 },
];

export function TopToolbar({ hideWorkspaceTabs = false }: { hideWorkspaceTabs?: boolean }) {
  const document = useProjectStore((s) => s.document);
  const updatePricing = useProjectStore((s) => s.updatePricing);

  const pastCount = useProjectTemporal((s) => s.pastStates.length);
  const futureCount = useProjectTemporal((s) => s.futureStates.length);
  const undo = useProjectTemporal((s) => s.undo);
  const redo = useProjectTemporal((s) => s.redo);

  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const activeWorkspaceTab = useUIStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = useUIStore((s) => s.setActiveWorkspaceTab);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const toggleDisplayUnit = useUIStore((s) => s.toggleDisplayUnit);
  const cameraMode = useUIStore((s) => s.cameraMode);
  const toggleCameraMode = useUIStore((s) => s.toggleCameraMode);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const toggleLightingPreset = useUIStore((s) => s.toggleLightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);
  const toggleLed = useUIStore((s) => s.toggleLed);
  const openAll = useUIStore((s) => s.openAll);
  const toggleOpenAll = useUIStore((s) => s.toggleOpenAll);
  const setPresentationMode = useUIStore((s) => s.setPresentationMode);
  const setVideoStudioMode = useUIStore((s) => s.setVideoStudioMode);
  const setProjectLibraryOpen = useUIStore((s) => s.setProjectLibraryOpen);
  const renderQuality = useUIStore((s) => s.renderQuality);
  const setRenderQuality = useUIStore((s) => s.setRenderQuality);
  const themePreference = useUIStore((s) => s.themePreference);
  const setThemePreference = useUIStore((s) => s.setThemePreference);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setShortcutsHelpOpen = useUIStore((s) => s.setShortcutsHelpOpen);

  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isDisplayOpen, setIsDisplayOpen] = useState(false);
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const displayMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isExportOpen && !isDisplayOpen) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (isExportOpen && exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setIsExportOpen(false);
      }
      if (isDisplayOpen && displayMenuRef.current && !displayMenuRef.current.contains(target)) {
        setIsDisplayOpen(false);
      }
    };
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [isExportOpen, isDisplayOpen]);

  const handleCurrencyChange = (nextCurrency: CurrencyCode) => {
    const prevCurrency = document.pricing.currency;
    if (prevCurrency === nextCurrency) return;

    const nextMaterialOverrides: Record<string, number> = {};
    for (const [matId, price] of Object.entries(document.pricing.materialPriceOverrides)) {
      nextMaterialOverrides[matId] = convertCurrency(price, prevCurrency, nextCurrency);
    }

    const nextHardwarePrices = { ...document.pricing.hardwareUnitPrices };
    for (const key of Object.keys(nextHardwarePrices) as Array<keyof typeof nextHardwarePrices>) {
      nextHardwarePrices[key] = convertCurrency(
        nextHardwarePrices[key],
        prevCurrency,
        nextCurrency
      );
    }

    updatePricing({
      currency: nextCurrency,
      materialPriceOverrides: nextMaterialOverrides,
      edgeBandingPricesPerMeter: {
        '0.4': convertCurrency(
          document.pricing.edgeBandingPricesPerMeter['0.4'],
          prevCurrency,
          nextCurrency
        ),
        '2': convertCurrency(
          document.pricing.edgeBandingPricesPerMeter['2'],
          prevCurrency,
          nextCurrency
        ),
      },
      hardwareUnitPrices: nextHardwarePrices,
    });
  };

  const handleSaveProject = async () => {
    await saveProject(document);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleExportJson = () => {
    const json = serializeProjectToJson(document);
    const safeSlug =
      document.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/(^-|-$)/g, '') || 'projet';
    downloadTextFile(json, `${safeSlug}.atelier3d.json`, 'application/json;charset=utf-8');
    setIsExportOpen(false);
  };

  return (
    <header className="order-1 flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-atelier-border bg-atelier-panel px-3 py-1.5">
      {/* Left: Brand + Project Picker + Save + Undo/Redo */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="btn-projects-library"
          onClick={() => setProjectLibraryOpen(true)}
          title="Ouvrir la bibliothèque de projets"
          className="inline-flex items-center gap-2 rounded-lg border border-atelier-border bg-atelier-surface px-2.5 py-1 text-left transition-colors hover:border-atelier-accent"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-atelier-accent text-xs font-bold text-atelier-accent-fg">
            A3D
          </span>
          <span className="max-w-[140px] truncate text-xs font-semibold text-atelier-fg">
            {document.name}
          </span>
          <span
            data-testid="app-version-badge"
            className="hidden rounded border border-atelier-border bg-atelier-panel px-1.5 py-0.5 font-mono text-xs text-atelier-subtle xl:inline-block"
          >
            {APP_VERSION_BADGE}
          </span>
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-atelier-accent-text" />
        </button>

        <button
          type="button"
          data-testid="btn-save-project"
          onClick={() => void handleSaveProject()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 text-xs font-medium text-atelier-fg transition-colors hover:border-atelier-accent"
          title={`${FR.toolbar.saveNow} (Ctrl+S)`}
        >
          <Save className="h-3.5 w-3.5 text-atelier-success" />
          <span className="hidden xl:inline">
            {savedNotice ? FR.toolbar.saved : FR.toolbar.saveNow}
          </span>
        </button>

        <div className="flex items-center rounded-lg border border-atelier-border bg-atelier-surface-2">
          <button
            type="button"
            data-testid="btn-undo"
            disabled={pastCount === 0}
            onClick={() => undo()}
            title={`${FR.toolbar.undo} (Ctrl+Z)`}
            aria-label={FR.toolbar.undo}
            className="inline-flex h-8 items-center gap-1 rounded-l-lg px-2 text-xs text-atelier-fg hover:bg-atelier-surface disabled:pointer-events-none disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <div className="h-4 w-px bg-atelier-border" />
          <button
            type="button"
            data-testid="btn-redo"
            disabled={futureCount === 0}
            onClick={() => redo()}
            title={`${FR.toolbar.redo} (Ctrl+Y)`}
            aria-label={FR.toolbar.redo}
            className="inline-flex h-8 items-center gap-1 rounded-r-lg px-2 text-xs text-atelier-fg hover:bg-atelier-surface disabled:pointer-events-none disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Center: Integrated Workspace Switcher + View Mode Segmented Control */}
      <div className="flex flex-wrap items-center gap-2">
        {!hideWorkspaceTabs && (
          <nav
            aria-label="Espaces de travail"
            className="flex items-center rounded-lg border border-atelier-border bg-atelier-surface-2 p-0.5"
          >
            {WORKSPACE_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeWorkspaceTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={tab.testId}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-atelier-accent text-atelier-accent-fg shadow-sm'
                      : 'text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        )}

        <div className="flex items-center rounded-lg border border-atelier-border bg-atelier-surface-2 p-0.5">
          {VIEW_MODES.map((vm) => {
            const Icon = vm.icon;
            const active = activeWorkspaceTab === 'conception' && viewMode === vm.id;
            return (
              <button
                key={vm.id}
                type="button"
                data-testid={vm.testId}
                onClick={() => {
                  setActiveWorkspaceTab('conception');
                  setViewMode(vm.id);
                }}
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-atelier-surface text-atelier-accent-text shadow-sm'
                    : 'text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{vm.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Vue Client CTA + Affichage Popover + Palette + Exports */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          data-testid="toolbar-vue-client"
          onClick={() => setPresentationMode('client')}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2.5 text-xs font-semibold text-atelier-success transition-colors hover:bg-emerald-500/25"
          title="Présentation immersive intérieure pour le client (touche C)"
        >
          <Eye className="h-3.5 w-3.5" />
          <span>{FR.presentationModes.client}</span>
        </button>

        <button
          type="button"
          data-testid="toolbar-video-studio"
          onClick={() => setVideoStudioMode(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-accent/60 bg-atelier-accent/15 px-2.5 text-xs font-semibold text-atelier-accent-text transition-colors hover:bg-atelier-accent/25"
          title="Ouvrir le Studio Vidéo 3D (animation & export MP4/WebM hors-ligne)"
        >
          <Film className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{FR.videoStudio.title}</span>
        </button>

        {/* Display & Preferences Popover (Theme, Units, Currency, Lighting, Doors, Camera) */}
        <div className="relative" ref={displayMenuRef}>
          <button
            type="button"
            data-testid="btn-display-menu"
            onClick={() => setIsDisplayOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-2.5 text-xs font-medium text-atelier-fg transition-colors hover:border-atelier-accent"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-atelier-accent-text" />
            <span>Affichage</span>
            <ChevronDown className="h-3.5 w-3.5 text-atelier-muted" />
          </button>

          {isDisplayOpen && (
            <div
              data-testid="display-popover-menu"
              className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-atelier-border bg-atelier-panel p-3 shadow-2xl space-y-3 text-xs"
            >
              {/* UI Theme Switcher (Direction C) */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-atelier-muted">Thème de l’interface</div>
                <div className="grid grid-cols-3 gap-1 rounded-lg border border-atelier-border bg-atelier-surface-2 p-0.5">
                  {(
                    [
                      { id: 'sombre', label: 'Sombre', icon: Moon },
                      { id: 'clair', label: 'Clair', icon: Sun },
                      { id: 'auto', label: 'Auto', icon: Monitor },
                    ] as Array<{ id: ThemePreference; label: string; icon: typeof Sun }>
                  ).map((opt) => {
                    const Icon = opt.icon;
                    const active = themePreference === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`theme-option-${opt.id}`}
                        onClick={() => setThemePreference(opt.id)}
                        className={`inline-flex h-7 items-center justify-center gap-1 rounded-md text-xs font-medium transition-colors ${
                          active
                            ? 'bg-atelier-accent text-atelier-accent-fg'
                            : 'text-atelier-muted hover:text-atelier-fg'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Units & Currency */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-xs text-atelier-muted">{FR.units.label}</span>
                  <button
                    type="button"
                    data-testid="unit-toggle"
                    onClick={toggleDisplayUnit}
                    className="flex h-8 w-full items-center justify-center rounded-md border border-atelier-border bg-atelier-surface font-semibold text-atelier-accent-text hover:border-atelier-accent tabular-nums"
                  >
                    {displayUnit}
                  </button>
                </div>
                <label className="space-y-1">
                  <span className="text-xs text-atelier-muted">Devise</span>
                  <select
                    data-testid="currency-select"
                    aria-label="Devise"
                    value={document.pricing.currency}
                    onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
                    className="h-8 w-full rounded-md border border-atelier-border bg-atelier-surface px-2 text-xs font-medium text-atelier-fg focus:border-atelier-accent focus:outline-none"
                  >
                    <option value="MAD">{FR.currencies.MAD}</option>
                    <option value="EUR">{FR.currencies.EUR}</option>
                    <option value="USD">{FR.currencies.USD}</option>
                  </select>
                </label>
              </div>

              {/* 3D Lighting, LED, Doors & Camera */}
              <div className="space-y-1.5 border-t border-atelier-border pt-2.5">
                <div className="text-xs font-semibold text-atelier-muted">Scène 3D & Caméra</div>
                <div className="space-y-1">
                  <div className="text-xs text-atelier-muted">{FR.renderQuality.label}</div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg border border-atelier-border bg-atelier-surface-2 p-0.5">
                    {(
                      [
                        { id: 'standard', label: FR.renderQuality.standard },
                        { id: 'fort', label: FR.renderQuality.fort },
                        { id: 'ultra', label: FR.renderQuality.ultra },
                      ] as Array<{ id: RenderQuality; label: string }>
                    ).map((q) => {
                      const active = renderQuality === q.id;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          data-testid={`toolbar-quality-${q.id}`}
                          onClick={() => setRenderQuality(q.id)}
                          className={`inline-flex h-7 items-center justify-center rounded-md text-xs font-medium transition-colors ${
                            active
                              ? 'bg-atelier-accent text-atelier-accent-fg'
                              : 'text-atelier-muted hover:text-atelier-fg'
                          }`}
                        >
                          {q.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="btn-lighting-toggle"
                  onClick={toggleLightingPreset}
                  className="flex h-8 w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-surface px-2.5 text-xs text-atelier-fg hover:border-atelier-accent"
                >
                  <span className="inline-flex items-center gap-2">
                    {lightingPreset === 'jour' ? (
                      <Sun className="h-3.5 w-3.5 text-atelier-accent-text" />
                    ) : (
                      <Moon className="h-3.5 w-3.5 text-atelier-info" />
                    )}
                    <span>Éclairage scène</span>
                  </span>
                  <span className="font-semibold text-atelier-accent-text">
                    {lightingPreset === 'jour' ? FR.lighting.jour : FR.lighting.nuit}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="btn-led-toggle"
                  onClick={toggleLed}
                  className="flex h-8 w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-surface px-2.5 text-xs text-atelier-fg hover:border-atelier-accent"
                >
                  <span className="inline-flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5 text-atelier-accent-text" />
                    <span>{FR.lighting.led}</span>
                  </span>
                  <span className={ledEnabled ? 'font-semibold text-atelier-success' : 'text-atelier-subtle'}>
                    {ledEnabled ? 'Actif' : 'Coupé'}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="btn-toggle-open-all"
                  onClick={toggleOpenAll}
                  className="flex h-8 w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-surface px-2.5 text-xs text-atelier-fg hover:border-atelier-accent"
                >
                  <span className="inline-flex items-center gap-2">
                    <DoorOpen className="h-3.5 w-3.5 text-atelier-accent-text" />
                    <span>Façades & Tiroirs</span>
                  </span>
                  <span className="font-semibold text-atelier-accent-text">
                    {openAll ? FR.animations.closeAll : FR.animations.openAll}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="btn-camera-mode"
                  onClick={toggleCameraMode}
                  className="flex h-8 w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-surface px-2.5 text-xs text-atelier-fg hover:border-atelier-accent"
                >
                  <span className="inline-flex items-center gap-2">
                    {cameraMode === 'orbit' ? (
                      <Orbit className="h-3.5 w-3.5 text-atelier-info" />
                    ) : (
                      <Footprints className="h-3.5 w-3.5 text-atelier-success" />
                    )}
                    <span>Navigation 3D</span>
                  </span>
                  <span className="font-semibold text-atelier-info">
                    {cameraMode === 'orbit' ? FR.cameraModes.orbit : FR.cameraModes.walkthrough}
                  </span>
                </button>
              </div>

              {/* Command Palette & Shortcuts */}
              <div className="flex items-center justify-between gap-2 border-t border-atelier-border pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsDisplayOpen(false);
                    setCommandPaletteOpen(true);
                  }}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-atelier-border bg-atelier-surface-2 text-xs text-atelier-muted hover:text-atelier-fg"
                >
                  <Command className="h-3.5 w-3.5" />
                  <span>Commandes</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsDisplayOpen(false);
                    setShortcutsHelpOpen(true);
                  }}
                  className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-atelier-border bg-atelier-surface-2 text-xs text-atelier-muted hover:text-atelier-fg"
                >
                  <Keyboard className="h-3.5 w-3.5" />
                  <span>Raccourcis</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Grouped Export Menu */}
        <div className="relative" ref={exportMenuRef}>
          <button
            type="button"
            data-testid="btn-export-menu"
            onClick={() => setIsExportOpen((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-atelier-accent px-2.5 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{FR.toolbar.exports}</span>
          </button>

          {isExportOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-atelier-border bg-atelier-panel p-2 shadow-2xl space-y-1">
              {/* Native Share Section (WhatsApp / AirDrop on iPad & iPhone, download fallback on PC) */}
              <div className="px-2 py-1 text-xs font-semibold text-atelier-accent-text">
                Partage rapide
              </div>
              <button
                type="button"
                data-testid="share-devis-pdf"
                disabled={exportBusyId !== null}
                onClick={() => {
                  setExportBusyId('share-devis-pdf');
                  void import('@/exports/atelierExports')
                    .then((m) => m.exportDevisPdf({ share: true }))
                    .finally(() => {
                      setExportBusyId(null);
                      setIsExportOpen(false);
                    });
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-atelier-fg hover:bg-atelier-surface disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Share2 className="h-3.5 w-3.5 text-atelier-success" />
                  <span>Partager le Devis (PDF)</span>
                </span>
                <span className="text-xs font-semibold text-atelier-success">PDF</span>
              </button>
              <button
                type="button"
                data-testid="share-render-png"
                disabled={exportBusyId !== null}
                onClick={() => {
                  setExportBusyId('share-render-png');
                  void import('@/exports/render3dExport')
                    .then((m) => m.exportRenderPng({ share: true }))
                    .finally(() => {
                      setExportBusyId(null);
                      setIsExportOpen(false);
                    });
                }}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-atelier-fg hover:bg-atelier-surface disabled:opacity-50"
              >
                <span className="inline-flex items-center gap-2">
                  <Share2 className="h-3.5 w-3.5 text-atelier-info" />
                  <span>Partager le Rendu 3D (PNG)</span>
                </span>
                <span className="text-xs font-semibold text-atelier-info">PNG</span>
              </button>

              <div className="my-1 border-t border-atelier-border" />
              <div className="px-2 py-1 text-xs font-semibold text-atelier-muted">
                Documents Atelier
              </div>
              {[
                {
                  id: 'export-devis-pdf',
                  label: FR.exportMenu.devisPdf,
                  badge: 'PDF',
                  run: () => import('@/exports/atelierExports').then((m) => m.exportDevisPdf()),
                },
                {
                  id: 'export-cutlist-pdf',
                  label: FR.exportMenu.cutlistPdf,
                  badge: 'PDF',
                  run: () => import('@/exports/atelierExports').then((m) => m.exportCutlistPdf()),
                },
                {
                  id: 'export-nesting-pdf',
                  label: FR.exportMenu.nestingPdf,
                  badge: 'PDF',
                  run: () => import('@/exports/atelierExports').then((m) => m.exportNestingPdf()),
                },
                {
                  id: 'export-cutlist-csv',
                  label: FR.exportMenu.cutlistCsv,
                  badge: 'CSV',
                  run: () => import('@/exports/atelierExports').then((m) => m.exportCutlistCsv()),
                },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={item.id}
                  disabled={exportBusyId !== null}
                  onClick={() => {
                    setExportBusyId(item.id);
                    void Promise.resolve(item.run()).finally(() => {
                      setExportBusyId(null);
                      setIsExportOpen(false);
                    });
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-atelier-fg hover:bg-atelier-surface disabled:opacity-50"
                >
                  <span>{item.label}</span>
                  <span className="text-xs font-semibold text-atelier-accent-text">
                    {exportBusyId === item.id ? '…' : item.badge}
                  </span>
                </button>
              ))}

              <div className="my-1 border-t border-atelier-border" />
              <div className="px-2 py-1 text-xs font-semibold text-atelier-muted">
                Plans, 3D & Projet
              </div>
              {[
                {
                  id: 'export-plan-pdf',
                  label: FR.exportMenu.planPdf,
                  badge: 'PDF',
                  run: () => import('@/exports/planExport').then((m) => m.exportPlanPdf()),
                },
                {
                  id: 'export-plan-svg',
                  label: FR.exportMenu.planSvg,
                  badge: 'SVG',
                  run: () => import('@/exports/planExport').then((m) => m.exportPlanSvg()),
                },
                {
                  id: 'export-elevation-pdf',
                  label: FR.exportMenu.elevationPdf,
                  badge: 'PDF',
                  run: () => import('@/exports/planExport').then((m) => m.exportElevationPdf()),
                },
                {
                  id: 'export-elevation-svg',
                  label: FR.exportMenu.elevationSvg,
                  badge: 'SVG',
                  run: () => import('@/exports/planExport').then((m) => m.exportElevationSvg()),
                },
                {
                  id: 'export-render-png',
                  label: FR.exportMenu.renderPng,
                  badge: 'PNG',
                  run: () => import('@/exports/render3dExport').then((m) => m.exportRenderPng()),
                },
                {
                  id: 'export-scene-glb',
                  label: FR.exportMenu.sceneGlb,
                  badge: 'GLB',
                  run: () => import('@/exports/glbExport').then((m) => m.downloadSceneGlb()),
                },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={item.id}
                  disabled={exportBusyId !== null}
                  onClick={() => {
                    setExportBusyId(item.id);
                    void Promise.resolve(item.run()).finally(() => {
                      setExportBusyId(null);
                      setIsExportOpen(false);
                    });
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-atelier-fg hover:bg-atelier-surface disabled:opacity-50"
                >
                  <span>{item.label}</span>
                  <span className="text-xs font-semibold text-atelier-accent-text">
                    {exportBusyId === item.id ? '…' : item.badge}
                  </span>
                </button>
              ))}

              <button
                type="button"
                data-testid="export-project-json"
                onClick={handleExportJson}
                className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-atelier-fg hover:bg-atelier-surface"
              >
                <span>{FR.exportMenu.projectJson}</span>
                <span className="text-xs font-semibold text-atelier-accent-text">JSON</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
