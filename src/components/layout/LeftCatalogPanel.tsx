import { useMemo, useState } from 'react';
import {
  Box,
  Info,
  Lamp,
  Layers,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import type {
  BackMountType,
  BackThickness,
  BoardThickness,
  EdgeBandingCode,
  HandleStyle,
  MaterialCategory,
  ModuleCategory,
  ModuleType,
  ScenePropCategory,
  ScenePropType,
} from '@/types';
import { MODULE_CATALOG, MODULE_CATALOG_BY_TYPE } from '@/data/defaultPricing';
import { MATERIALS_CATALOG } from '@/data/materialsCatalog';
import {
  PROPS_CATALOG,
  PROPS_CATALOG_BY_TYPE,
  PROP_CATEGORIES,
  findPropSpawnPosition,
} from '@/data/propsCatalog';
import { computeAutoUtilitiesForPlacement, findInteriorSpawnPosition } from '@/engine/geometry';
import { FR } from '@/i18n/fr';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore, type LeftPanelTab } from '@/store/useUIStore';
import { formatCurrency } from '@/utils/currency';
import { formatDim, parseDim } from '@/utils/units';
import { CatalogThumbnailSvg } from './CatalogThumbnailSvg';
import { RoomSurfaceControls } from './RoomSurfaceControls';

const CATEGORIES: ModuleCategory[] = ['cuisine', 'salle_de_bain', 'dressing', 'mobilier'];
const MATERIAL_CATEGORIES: MaterialCategory[] = [
  'melamine_bois',
  'melamine_uni',
  'laque_mat',
  'laque_brillant',
  'plan_pierre',
  'sol',
  'mur',
];

export function LeftCatalogPanel() {
  const document = useProjectStore((s) => s.document);
  const addModuleWithUtilities = useProjectStore((s) => s.addModuleWithUtilities);
  const addPropWithUtilities = useProjectStore((s) => s.addPropWithUtilities);
  const updateGlobalCarpentry = useProjectStore((s) => s.updateGlobalCarpentry);
  const setDocument = useProjectStore((s) => s.setDocument);

  const leftPanelTab = useUIStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useUIStore((s) => s.setLeftPanelTab);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);
  const freePlacementMode = useUIStore((s) => s.freePlacementMode);
  const toggleFreePlacementMode = useUIStore((s) => s.toggleFreePlacementMode);
  const autoUtilitiesEnabled = useUIStore((s) => s.autoUtilitiesEnabled);
  const toggleAutoUtilitiesEnabled = useUIStore((s) => s.toggleAutoUtilitiesEnabled);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const activeWallId = useUIStore((s) => s.activeWallId);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const selectEntity = useUIStore((s) => s.selectEntity);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedModuleCat, setSelectedModuleCat] = useState<ModuleCategory | 'all'>('all');
  const [selectedPropCat, setSelectedPropCat] = useState<ScenePropCategory | 'all'>('all');
  const [inspectedItem, setInspectedItem] = useState<{
    kind: 'module' | 'prop';
    type: ModuleType | ScenePropType;
    nameFr: string;
    descriptionFr: string;
    w: number;
    h: number;
    d: number;
  } | null>(null);

  const handleAddModule = (type: ModuleType) => {
    const spec = MODULE_CATALOG_BY_TYPE[type];
    const spawn = findInteriorSpawnPosition(document, spec, activeWallId);
    const autoUtils = autoUtilitiesEnabled
      ? computeAutoUtilitiesForPlacement(document, {
          kind: 'module',
          type,
          nameFr: spec.nameFr,
          xMm: spawn.xMm,
          yMm: spawn.yMm,
          zMm: spawn.zMm,
          attachedWallId: spawn.attachedWallId,
          colonneVariant: type === 'colonne' ? 'four' : undefined,
        })
      : [];
    const newId = addModuleWithUtilities(
      {
        type,
        nameFr: spec.nameFr,
        xMm: spawn.xMm,
        yMm: spawn.yMm,
        zMm: spawn.zMm,
        rotationYRad: spawn.rotationYRad,
        attachedWallId: spawn.attachedWallId,
        widthMm: spec.defaultWidthMm,
        heightMm: spec.defaultHeightMm,
        depthMm: spec.defaultDepthMm,
        doorCount: spec.defaultDoorCount,
        drawerCount: spec.defaultDrawerCount,
        shelfCount: spec.defaultShelfCount,
        ledUnder: Boolean(spec.supportsLedUnder),
      },
      autoUtils
    );
    selectEntity(newId, 'module');
    setActiveTool('select');
  };

  const handleAddProp = (type: ScenePropType) => {
    const spec = PROPS_CATALOG_BY_TYPE[type];
    const spawn = findPropSpawnPosition(document, spec, activeWallId);
    const autoUtils = autoUtilitiesEnabled
      ? computeAutoUtilitiesForPlacement(document, {
          kind: 'prop',
          type,
          nameFr: spec.nameFr,
          xMm: spawn.xMm,
          yMm: spawn.yMm,
          zMm: spawn.zMm,
          attachedWallId: spawn.attachedWallId,
        })
      : [];
    const newId = addPropWithUtilities(
      {
        type,
        category: spec.category,
        nameFr: spec.nameFr,
        xMm: spawn.xMm,
        yMm: spawn.yMm,
        zMm: spawn.zMm,
        rotationYRad: spawn.rotationYRad,
        attachedWallId: spawn.attachedWallId,
        widthMm: spec.defaultWidthMm,
        heightMm: spec.defaultHeightMm,
        depthMm: spec.defaultDepthMm,
        colorHex: spec.defaultColorHex,
        finish: spec.defaultFinish,
        lightOn: spec.supportsLight ? true : undefined,
        lightIntensity: spec.supportsLight ? 1 : undefined,
        tvSizeInches: spec.supportsTvSize ? 55 : undefined,
        tvMountMode: spec.supportsTvSize ? 'mural' : undefined,
        hoodMountMode: spec.supportsHoodMount ? 'murale' : undefined,
      },
      autoUtils
    );
    selectEntity(newId, 'prop');
    setActiveTool('select');
  };

  const panelTabs: Array<{ id: LeftPanelTab; label: string; icon: typeof Box }> = [
    { id: 'catalogue', label: FR.leftPanel.tabs.catalogue, icon: Box },
    { id: 'electro', label: FR.leftPanel.tabs.electro, icon: Lamp },
    { id: 'materiaux', label: FR.leftPanel.tabs.materiaux, icon: Layers },
    { id: 'atelier', label: FR.leftPanel.tabs.atelier, icon: Settings2 },
  ];

  const q = searchQuery.trim().toLowerCase();

  const HIDDEN_DUPLICATE_GLASS_TYPES = useMemo(
    () => new Set<ModuleType>(['meuble_haut_vitre', 'meuble_vitrine']),
    []
  );

  const filteredModules = useMemo(() => {
    return MODULE_CATALOG.filter((m) => {
      if (HIDDEN_DUPLICATE_GLASS_TYPES.has(m.type)) return false;
      if (selectedModuleCat !== 'all' && m.category !== selectedModuleCat) return false;
      if (!q) return true;
      return (
        m.nameFr.toLowerCase().includes(q) ||
        m.descriptionFr.toLowerCase().includes(q) ||
        FR.moduleCategories[m.category].toLowerCase().includes(q)
      );
    });
  }, [HIDDEN_DUPLICATE_GLASS_TYPES, selectedModuleCat, q]);

  const filteredProps = useMemo(() => {
    return PROPS_CATALOG.filter((p) => {
      if (selectedPropCat !== 'all' && p.category !== selectedPropCat) return false;
      if (!q) return true;
      return (
        p.nameFr.toLowerCase().includes(q) ||
        p.descriptionFr.toLowerCase().includes(q) ||
        FR.propCategories[p.category].toLowerCase().includes(q)
      );
    });
  }, [selectedPropCat, q]);

  const cp = document.defaultCarpentry;
  const currency = document.pricing.currency;

  return (
    <aside
      data-testid="left-catalog-panel"
      className="relative flex h-full w-76 shrink-0 flex-col border-r border-atelier-border bg-atelier-panel"
    >
      {/* Header + Collapse Button */}
      <div className="flex items-center justify-between border-b border-atelier-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
          Bibliothèque
        </span>
        <button
          type="button"
          data-testid="btn-collapse-left-panel"
          onClick={toggleLeftPanel}
          title="Réduire le panneau Catalogue (Tab)"
          className="rounded p-1 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="grid grid-cols-2 gap-1 border-b border-atelier-border bg-atelier-surface-2 p-1.5">
        {panelTabs.map((t) => {
          const Icon = t.icon;
          const active = leftPanelTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`left-tab-${t.id}`}
              onClick={() => setLeftPanelTab(t.id)}
              className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
                active
                  ? 'bg-atelier-surface text-atelier-accent-text shadow-sm'
                  : 'text-atelier-muted hover:text-atelier-fg'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Shared Search Bar for Meubles / Électro tabs */}
      {(leftPanelTab === 'catalogue' || leftPanelTab === 'electro') && (
        <div className="border-b border-atelier-border px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-atelier-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher un module ou objet…"
              aria-label="Rechercher dans le catalogue"
              className="h-8 w-full rounded-lg border border-atelier-border bg-atelier-surface-2 pl-8 pr-7 text-xs text-atelier-fg placeholder:text-atelier-subtle focus:border-atelier-accent focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-atelier-subtle hover:text-atelier-fg"
                aria-label="Effacer la recherche"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {leftPanelTab === 'catalogue' && (
          <>
            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedModuleCat('all')}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedModuleCat === 'all'
                    ? 'border-atelier-accent bg-atelier-accent text-atelier-accent-fg'
                    : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                }`}
              >
                Tous
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedModuleCat(cat)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedModuleCat === cat
                      ? 'border-atelier-accent bg-atelier-accent text-atelier-accent-fg'
                      : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  {FR.moduleCategories[cat].split(' ')[0]}
                </button>
              ))}
            </div>

            {/* 2-Column Visual Thumbnail Grid */}
            <div className="grid grid-cols-2 gap-2">
              {filteredModules.map((mod) => (
                <div
                  key={mod.type}
                  className="group relative flex flex-col rounded-xl border border-atelier-border bg-atelier-surface-2 p-2 transition-colors hover:border-atelier-accent"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setInspectedItem({
                        kind: 'module',
                        type: mod.type,
                        nameFr: mod.nameFr,
                        descriptionFr: mod.descriptionFr,
                        w: mod.defaultWidthMm,
                        h: mod.defaultHeightMm,
                        d: mod.defaultDepthMm,
                      })
                    }
                    title={`Détails : ${mod.nameFr}`}
                    aria-label={`Détails ${mod.nameFr}`}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-atelier-subtle hover:bg-atelier-surface hover:text-atelier-fg"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    data-testid={`catalog-add-${mod.type}`}
                    onClick={() => handleAddModule(mod.type)}
                    className="flex flex-1 flex-col items-center text-center focus:outline-none"
                  >
                    <div className="my-1">
                      <CatalogThumbnailSvg kind="module" type={mod.type} size={48} />
                    </div>
                    <div className="line-clamp-2 text-xs font-medium leading-tight text-atelier-fg">
                      {mod.nameFr}
                    </div>
                    <div className="mt-1 text-xs text-atelier-subtle tabular-nums">
                      {formatDim(mod.defaultWidthMm, displayUnit, false)} ×{' '}
                      {formatDim(mod.defaultHeightMm, displayUnit, false)}
                    </div>
                  </button>
                </div>
              ))}
            </div>

            {filteredModules.length === 0 && (
              <div className="rounded-lg border border-atelier-border bg-atelier-surface-2 p-4 text-center text-xs text-atelier-subtle">
                Aucun module ne correspond à votre recherche.
              </div>
            )}
          </>
        )}

        {leftPanelTab === 'electro' && (
          <div className="space-y-3">
            {/* Smart Placement Override + Auto-Utilities Toggles */}
            <div className="space-y-1.5">
              <button
                type="button"
                data-testid="toggle-free-placement"
                onClick={toggleFreePlacementMode}
                className={`flex h-9 w-full items-center justify-between rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  freePlacementMode
                    ? 'border-atelier-accent bg-atelier-accent/15 text-atelier-accent-text'
                    : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                }`}
                title="Désactive les contraintes mur/plan/plafond (ou maintenez Alt en glissant)"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Unlock className="h-3.5 w-3.5 text-atelier-accent-text" />
                  <span>Placement libre</span>
                </span>
                <span className="text-xs font-semibold">
                  {freePlacementMode ? 'LIBRE' : 'AUTO'}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleAutoUtilitiesEnabled}
                className={`flex h-9 w-full items-center justify-between rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                  autoUtilitiesEnabled
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-atelier-success'
                    : 'border-atelier-border bg-atelier-surface-2 text-atelier-subtle hover:text-atelier-fg'
                }`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-atelier-accent-text" />
                  <span>Raccordements auto</span>
                </span>
                <span className="text-xs font-semibold">
                  {autoUtilitiesEnabled ? 'ACTIF' : 'INACTIF'}
                </span>
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedPropCat('all')}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedPropCat === 'all'
                    ? 'border-sky-500 bg-sky-500/20 text-atelier-info'
                    : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                }`}
              >
                Tous
              </button>
              {PROP_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedPropCat(cat)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedPropCat === cat
                      ? 'border-sky-500 bg-sky-500/20 text-atelier-info'
                      : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                  }`}
                >
                  {FR.propCategories[cat].split(' ')[0]}
                </button>
              ))}
            </div>

            {/* 2-Column Visual Grid for Électro & Déco */}
            <div className="grid grid-cols-2 gap-2">
              {filteredProps.map((prop) => (
                <div
                  key={prop.type}
                  className="group relative flex flex-col rounded-xl border border-atelier-border bg-atelier-surface-2 p-2 transition-colors hover:border-sky-400"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setInspectedItem({
                        kind: 'prop',
                        type: prop.type,
                        nameFr: prop.nameFr,
                        descriptionFr: prop.descriptionFr,
                        w: prop.defaultWidthMm,
                        h: prop.defaultHeightMm,
                        d: prop.defaultDepthMm,
                      })
                    }
                    title={`Détails : ${prop.nameFr}`}
                    aria-label={`Détails ${prop.nameFr}`}
                    className="absolute right-1.5 top-1.5 rounded p-1 text-atelier-subtle hover:bg-atelier-surface hover:text-atelier-fg"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>

                  <button
                    type="button"
                    data-testid={`prop-add-${prop.type}`}
                    onClick={() => handleAddProp(prop.type)}
                    className="flex flex-1 flex-col items-center text-center focus:outline-none"
                  >
                    <div className="my-1">
                      <CatalogThumbnailSvg kind="prop" type={prop.type} size={48} />
                    </div>
                    <div className="line-clamp-2 text-xs font-medium leading-tight text-atelier-fg">
                      {prop.nameFr}
                    </div>
                    <div className="mt-1 text-xs text-atelier-subtle tabular-nums">
                      {formatDim(prop.defaultWidthMm, displayUnit, false)} ×{' '}
                      {formatDim(prop.defaultHeightMm, displayUnit, false)}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {leftPanelTab === 'materiaux' && (
          <div className="space-y-4">
            <RoomSurfaceControls showCarpentryColors />

            <h2 className="pt-1 text-xs font-semibold uppercase tracking-wider text-atelier-muted">
              {FR.leftPanel.materialsTitle}
            </h2>
            {MATERIAL_CATEGORIES.map((cat) => {
              const mats = MATERIALS_CATALOG.filter((m) => m.category === cat);
              return (
                <div key={cat} className="space-y-1.5">
                  <div className="text-xs font-semibold text-atelier-accent-text">
                    {FR.materialCategories[cat]}
                  </div>
                  <div className="space-y-1">
                    {mats.map((mat) => (
                      <div
                        key={mat.id}
                        className="flex items-center justify-between rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 py-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-5 w-5 shrink-0 rounded border border-atelier-border-strong"
                            style={{ backgroundColor: mat.colorHex }}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-atelier-fg">
                              {mat.nameFr}
                            </div>
                            <div className="text-xs text-atelier-subtle tabular-nums">
                              {formatCurrency(mat.pricePerM2[currency], currency)}/m²
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {leftPanelTab === 'atelier' && (
          <div className="space-y-3 text-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
              {FR.leftPanel.atelierTitle}
            </h2>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.boardThickness}</span>
              <select
                value={cp.boardThickness}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    boardThickness: Number(e.target.value) as BoardThickness,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value={16}>16 mm</option>
                <option value={18}>18 mm</option>
                <option value={19}>19 mm</option>
                <option value={22}>22 mm</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.backThickness}</span>
              <select
                value={cp.backThickness}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    backThickness: Number(e.target.value) as BackThickness,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value={5}>5 mm</option>
                <option value={8}>8 mm</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.backMountType}</span>
              <select
                value={cp.backMountType}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    backMountType: e.target.value as BackMountType,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value="rainure">{FR.carpentry.backMountLabels.rainure}</option>
                <option value="applique">{FR.carpentry.backMountLabels.applique}</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.handleStyle}</span>
              <select
                value={cp.handleStyle}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    handleStyle: e.target.value as HandleStyle,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value="bar">{FR.carpentry.handleStyles.bar}</option>
                <option value="knob">{FR.carpentry.handleStyles.knob}</option>
                <option value="gorge">{FR.carpentry.handleStyles.gorge}</option>
                <option value="push">{FR.carpentry.handleStyles.push}</option>
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.facadeMaterial}</span>
              <select
                value={cp.facadeMaterialId}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    facadeMaterialId: e.target.value,
                    facadeColorOverride: undefined,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                {MATERIALS_CATALOG.filter(
                  (m) => m.category !== 'sol' && m.category !== 'mur' && m.category !== 'plan_pierre'
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameFr}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">
                {FR.carpentry.facadeGap} ({displayUnit})
              </span>
              <input
                type="text"
                defaultValue={formatDim(cp.facadeGapMm, displayUnit, false)}
                key={`gap-${displayUnit}-${cp.facadeGapMm}`}
                onBlur={(e) => {
                  const mm = parseDim(e.target.value, displayUnit, { minMm: 0, maxMm: 10 });
                  if (mm !== null && mm !== cp.facadeGapMm) {
                    updateGlobalCarpentry({ facadeGapMm: mm });
                  }
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">
                {FR.carpentry.plinthHeight} ({displayUnit})
              </span>
              <input
                type="text"
                defaultValue={formatDim(cp.plinthHeightMm, displayUnit, false)}
                key={`plinth-${displayUnit}-${cp.plinthHeightMm}`}
                onBlur={(e) => {
                  const mm = parseDim(e.target.value, displayUnit, { minMm: 0, maxMm: 300 });
                  if (mm !== null && mm !== cp.plinthHeightMm) {
                    updateGlobalCarpentry({ plinthHeightMm: mm });
                  }
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">
                {FR.carpentry.ceilingHeight} ({displayUnit})
              </span>
              <input
                type="text"
                defaultValue={formatDim(document.ceilingHeightMm, displayUnit, false)}
                key={`ceil-${displayUnit}-${document.ceilingHeightMm}`}
                onBlur={(e) => {
                  const mm = parseDim(e.target.value, displayUnit, { minMm: 1800, maxMm: 6000 });
                  if (mm !== null && mm !== document.ceilingHeightMm) {
                    setDocument({ ...document, ceilingHeightMm: mm });
                  }
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">{FR.carpentry.carcassMaterial}</span>
              <select
                value={cp.carcassMaterialId}
                onChange={(e) =>
                  updateGlobalCarpentry({
                    carcassMaterialId: e.target.value,
                    carcassColorOverride: undefined,
                  })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                {MATERIALS_CATALOG.filter(
                  (m) => m.category === 'melamine_bois' || m.category === 'melamine_uni'
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameFr}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Épaisseur bande de chant</span>
              <select
                value={cp.facadeEdgeCode ?? '2'}
                onChange={(e) => {
                  const code = e.target.value as EdgeBandingCode;
                  updateGlobalCarpentry({
                    facadeEdgeCode: code,
                    facadeEdgeOverrides: undefined,
                  });
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value="0.4">0,4 mm</option>
                <option value="2">2 mm</option>
              </select>
            </label>

            <div className="space-y-1.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="text-xs font-medium text-atelier-muted">Chants façades (4 bords)</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    { key: 'top', label: 'Chant Haut' },
                    { key: 'bottom', label: 'Chant Bas' },
                    { key: 'left', label: 'Chant Gauche' },
                    { key: 'right', label: 'Chant Droite' },
                  ] as const
                ).map((edge) => (
                  <label key={edge.key} className="block space-y-0.5">
                    <span className="text-xs text-atelier-subtle">{edge.label}</span>
                    <select
                      value={cp.facadeEdgeOverrides?.[edge.key] ?? cp.facadeEdgeCode ?? '2'}
                      onChange={(e) =>
                        updateGlobalCarpentry({
                          facadeEdgeOverrides: {
                            ...cp.facadeEdgeOverrides,
                            [edge.key]: e.target.value as EdgeBandingCode,
                          },
                        })
                      }
                      className="h-8 w-full rounded border border-atelier-border bg-atelier-panel px-1.5 text-xs text-atelier-fg"
                    >
                      <option value="2">2 mm</option>
                      <option value="0.4">0,4 mm</option>
                      <option value="none">Aucun</option>
                    </select>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 py-2 text-atelier-fg">
              <input
                type="checkbox"
                checked={Boolean(cp.deductEdgeBandingThickness)}
                onChange={(e) =>
                  updateGlobalCarpentry({ deductEdgeBandingThickness: e.target.checked })
                }
                className="accent-atelier-accent"
              />
              <span className="text-xs">Déduire ép. chants (cote débit scie)</span>
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">
                Décor {FR.carpentry.edgeBandingMaterial.toLowerCase()}
              </span>
              <select
                value={cp.edgeBandingMaterialId}
                onChange={(e) => updateGlobalCarpentry({ edgeBandingMaterialId: e.target.value })}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                {MATERIALS_CATALOG.filter(
                  (m) => m.category !== 'sol' && m.category !== 'mur' && m.category !== 'plan_pierre'
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameFr}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {/* Tap / Click Accessible Preview Card (no hover-only dependency) */}
      {inspectedItem && (
        <div
          data-testid="catalog-detail-preview"
          className="border-t border-atelier-accent/50 bg-atelier-surface p-3 shadow-2xl"
        >
          <div className="flex items-start gap-2.5">
            <CatalogThumbnailSvg
              kind={inspectedItem.kind}
              type={inspectedItem.type}
              size={52}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-start justify-between gap-1">
                <div className="truncate text-xs font-semibold text-atelier-accent-text">
                  {inspectedItem.nameFr}
                </div>
                <button
                  type="button"
                  onClick={() => setInspectedItem(null)}
                  className="rounded p-0.5 text-atelier-muted hover:text-atelier-fg"
                  aria-label="Fermer l'aperçu"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="line-clamp-2 text-xs leading-snug text-atelier-muted">
                {inspectedItem.descriptionFr}
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="font-mono text-xs text-atelier-info tabular-nums">
                  {formatDim(inspectedItem.w, displayUnit, false)} ×{' '}
                  {formatDim(inspectedItem.h, displayUnit, false)} ×{' '}
                  {formatDim(inspectedItem.d, displayUnit)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (inspectedItem.kind === 'module') {
                      handleAddModule(inspectedItem.type as ModuleType);
                    } else {
                      handleAddProp(inspectedItem.type as ScenePropType);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded bg-atelier-accent px-2 py-1 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
                >
                  <Plus className="h-3 w-3" />
                  <span>Ajouter</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
