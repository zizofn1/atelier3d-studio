import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Lightbulb,
  PanelRightClose,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import type {
  BackMountType,
  BoardThickness,
  DisplayUnit,
  GrainDirection,
  HandleStyle,
  HandleVerticalPosition,
  PropFinishPreset,
  TvSizeInches,
} from '@/types';
import {
  CABINET_COLOR_SWATCHES,
  MATERIALS_CATALOG,
  WALL_COLOR_SWATCHES,
  getMaterialById,
} from '@/data/materialsCatalog';
import { PROPS_CATALOG_BY_TYPE, TV_SIZE_PRESETS_MM } from '@/data/propsCatalog';
import { FR } from '@/i18n/fr';
import {
  analyzeWalls,
  computeModuleFitSolution,
  computeMultiModuleSpacingMoves,
  getWallInteriorSpanMm,
  resolveCeilingLighting,
  snapModulePosition,
  snapPropPosition,
  type CeilingSpotPreset,
  type ModuleAutoFitSolution,
} from '@/engine/geometry';
import { selectProjectCollisions, selectSelectedEntity } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { flushContinuousEdit, runContinuousEdit } from '@/utils/historyBatch';
import { formatDim, parseDim } from '@/utils/units';
import { RoomSurfaceControls } from './RoomSurfaceControls';

interface DimFieldProps {
  label: string;
  valueMm: number;
  unit: DisplayUnit;
  testId?: string;
  minMm?: number;
  onCommit: (nextMm: number) => void;
}

function DimField({ label, valueMm, unit, testId, minMm = 10, onCommit }: DimFieldProps) {
  const [draft, setDraft] = useState(formatDim(valueMm, unit, false));
  const [invalid, setInvalid] = useState(false);
  const committedValueRef = useRef(valueMm);

  useEffect(() => {
    committedValueRef.current = valueMm;
    setDraft(formatDim(valueMm, unit, false));
    setInvalid(false);
  }, [valueMm, unit]);

  const commit = () => {
    const parsed = parseDim(draft, unit, { minMm });
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== committedValueRef.current) {
      committedValueRef.current = parsed;
      onCommit(parsed);
    }
  };

  return (
    <label className="block space-y-1 text-xs">
      <div className="flex items-center justify-between text-atelier-muted">
        <span>{label}</span>
        <span className="text-atelier-subtle">{unit}</span>
      </div>
      <input
        type="text"
        data-testid={testId}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`h-9 w-full rounded-md border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums focus:outline-none ${
          invalid
            ? 'border-red-500 focus:border-red-400'
            : 'border-atelier-border focus:border-atelier-accent'
        }`}
      />
      {invalid && <span className="text-xs text-atelier-danger">{FR.inspector.invalidDimension}</span>}
    </label>
  );
}

function InspectorSection({
  titleFr,
  defaultOpen = true,
  children,
}: {
  titleFr: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-atelier-border bg-atelier-surface-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left text-xs font-semibold text-atelier-fg hover:bg-atelier-surface"
      >
        <span>{titleFr}</span>
        {open ? (
          <ChevronDown className="h-4 w-4 text-atelier-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-atelier-muted" />
        )}
      </button>
      {open && <div className="space-y-3 border-t border-atelier-border p-2.5">{children}</div>}
    </section>
  );
}

export function RightInspectorPanel() {
  const document = useProjectStore((s) => s.document);
  const updateWall = useProjectStore((s) => s.updateWall);
  const resizeWallNetLength = useProjectStore((s) => s.resizeWallNetLength);
  const removeWall = useProjectStore((s) => s.removeWall);
  const updateOpening = useProjectStore((s) => s.updateOpening);
  const removeOpening = useProjectStore((s) => s.removeOpening);
  const updateUtility = useProjectStore((s) => s.updateUtility);
  const removeUtility = useProjectStore((s) => s.removeUtility);
  const updateModule = useProjectStore((s) => s.updateModule);
  const updateModulesBatch = useProjectStore((s) => s.updateModulesBatch);
  const moveModulesBatch = useProjectStore((s) => s.moveModulesBatch);
  const removeModule = useProjectStore((s) => s.removeModule);
  const removeModulesBatch = useProjectStore((s) => s.removeModulesBatch);
  const updateProp = useProjectStore((s) => s.updateProp);
  const removeProp = useProjectStore((s) => s.removeProp);
  const updateCeilingLighting = useProjectStore((s) => s.updateCeilingLighting);
  const applyCeilingSpotPreset = useProjectStore((s) => s.applyCeilingSpotPreset);
  const addCeilingSpot = useProjectStore((s) => s.addCeilingSpot);
  const updateCeilingSpot = useProjectStore((s) => s.updateCeilingSpot);
  const updateCeilingSpotsBatch = useProjectStore((s) => s.updateCeilingSpotsBatch);
  const alignCeilingSpots = useProjectStore((s) => s.alignCeilingSpots);
  const removeCeilingSpot = useProjectStore((s) => s.removeCeilingSpot);
  const removeCeilingSpotsBatch = useProjectStore((s) => s.removeCeilingSpotsBatch);

  const selectedId = useUIStore((s) => s.selectedId);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectedKind = useUIStore((s) => s.selectedKind);
  const selectEntity = useUIStore((s) => s.selectEntity);
  const toggleSelectEntity = useUIStore((s) => s.toggleSelectEntity);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const markUserOriented = useUIStore((s) => s.markUserOriented);

  const rotateModuleWithCornerSnap = (modId: string, nextRotRad: number) => {
    const mod = document.modules.find((m) => m.id === modId);
    if (!mod) return;
    markUserOriented(mod.id, true);
    const snapped = snapModulePosition(
      { ...mod, rotationYRad: nextRotRad },
      document.walls,
      document.modules,
      { ceilingHeightMm: document.ceilingHeightMm, preserveRotation: true }
    );
    updateModule(mod.id, {
      rotationYRad: nextRotRad,
      xMm: snapped.xMm,
      zMm: snapped.zMm,
      attachedWallId: snapped.attachedWallId ?? mod.attachedWallId,
    });
  };

  const rotatePropWithCornerSnap = (propId: string, nextRotRad: number) => {
    const prop = (document.props ?? []).find((p) => p.id === propId);
    if (!prop) return;
    markUserOriented(prop.id, true);
    const snapped = snapPropPosition(
      { ...prop, rotationYRad: nextRotRad },
      document.walls,
      document.modules,
      {
        freePlacement: useUIStore.getState().freePlacementMode,
        ceilingHeightMm: document.ceilingHeightMm,
        preserveRotation: true,
      }
    );
    updateProp(prop.id, {
      rotationYRad: nextRotRad,
      xMm: snapped.xMm,
      zMm: snapped.zMm,
      attachedWallId: snapped.attachedWallId ?? prop.attachedWallId,
    });
  };

  const [spacingGapMm, setSpacingGapMm] = useState(0);

  const selected = selectSelectedEntity(document, selectedId, selectedKind);
  const isMultiModules = selectedKind === 'module' && selectedIds.length > 1;
  const multiModules = isMultiModules
    ? document.modules.filter((m) => selectedIds.includes(m.id))
    : [];
  const collisions = selectProjectCollisions(document);
  const ceilingLighting = resolveCeilingLighting(document.walls, document.ceilingLighting);
  const isMultiSpots = selectedKind === 'spot' && selectedIds.length > 1;
  const multiSpots = isMultiSpots
    ? ceilingLighting.spots.filter((sp) => selectedIds.includes(sp.id))
    : [];
  const selectedFitSolution: ModuleAutoFitSolution | null =
    !isMultiModules && selected?.kind === 'module'
      ? computeModuleFitSolution(document, selected.entity.id)
      : null;

  const firstCollisionFix: ModuleAutoFitSolution | null = (() => {
    if (selectedFitSolution) return selectedFitSolution;
    const seen = new Set<string>();
    for (const c of collisions) {
      if (seen.has(c.moduleId)) continue;
      seen.add(c.moduleId);
      const sol = computeModuleFitSolution(document, c.moduleId);
      if (sol) return sol;
    }
    return null;
  })();

  const applyAutoFitSolution = (sol: ModuleAutoFitSolution) => {
    updateModule(sol.moduleId, sol.patch);
    selectEntity(sol.moduleId, 'module');
  };

  return (
    <aside className="flex h-full w-76 shrink-0 flex-col border-l border-atelier-border bg-atelier-panel">
      <div className="flex items-center justify-between border-b border-atelier-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
          {FR.inspector.title}
        </h2>
        <button
          type="button"
          data-testid="btn-collapse-right-panel"
          onClick={toggleRightPanel}
          title="Réduire l'Inspecteur (Tab)"
          className="rounded p-1 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
        >
          <PanelRightClose className="h-4 w-4" />
        </button>
      </div>

      {collisions.length > 0 && (
        <div
          role="alert"
          className="mx-3 mt-2.5 space-y-1.5 rounded-lg border border-red-500/50 bg-red-500/12 px-2.5 py-2 text-xs text-atelier-danger"
        >
          <div className="font-semibold">Collision détectée ({collisions.length})</div>
          <div className="truncate text-xs opacity-90">{collisions[0].messageFr}</div>
          {firstCollisionFix && (
            <button
              type="button"
              data-testid="btn-alert-autofit"
              onClick={() => applyAutoFitSolution(firstCollisionFix)}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-400/60 bg-emerald-500/20 px-2 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30"
            >
              <Wand2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Ajuster {firstCollisionFix.moduleRef} ({firstCollisionFix.summaryFr})
              </span>
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!selected && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-atelier-muted">
              {FR.inspector.emptySelection}
            </p>

            {/* Direct Room Surface (Walls & Floor) Color & Texture Controls */}
            <RoomSurfaceControls />

            {/* Ceiling Spotlights Intensity & Placement Controls */}
            <InspectorSection titleFr="Spots & Éclairage plafond" defaultOpen>
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-medium text-atelier-fg">
                    <Lightbulb className="h-3.5 w-3.5 text-atelier-accent-text" />
                    <span>Spots plafond</span>
                  </span>
                  <button
                    type="button"
                    data-testid="inspector-spots-toggle"
                    onClick={() =>
                      updateCeilingLighting({ spotsEnabled: !ceilingLighting.spotsEnabled })
                    }
                    className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      ceilingLighting.spotsEnabled
                        ? 'bg-atelier-accent text-atelier-accent-fg'
                        : 'border border-atelier-border bg-atelier-panel text-atelier-muted'
                    }`}
                  >
                    {ceilingLighting.spotsEnabled ? 'Allumés' : 'Éteints'}
                  </button>
                </div>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs text-atelier-muted">
                    <span>Intensité des spots</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {Math.round(ceilingLighting.spotIntensity * 100)} %
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="inspector-spot-intensity"
                    min={0}
                    max={150}
                    step={5}
                    value={Math.round(ceilingLighting.spotIntensity * 100)}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      runContinuousEdit(() =>
                        updateCeilingLighting({
                          spotsEnabled: pct > 0,
                          spotIntensity: pct / 100,
                        })
                      );
                    }}
                    onPointerUp={flushContinuousEdit}
                    onBlur={flushContinuousEdit}
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                <div className="space-y-1">
                  <span className="text-xs text-atelier-muted">Disposition rapide</span>
                  <div className="grid grid-cols-2 gap-1">
                    {(
                      [
                        { id: 'grid_2x2', label: 'Grille 2×2' },
                        { id: 'center_1', label: 'Centré (1)' },
                        { id: 'line_x', label: 'Ligne H (3)' },
                        { id: 'line_z', label: 'Ligne V (3)' },
                      ] as Array<{ id: CeilingSpotPreset; label: string }>
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        data-testid={`spot-preset-${p.id}`}
                        onClick={() => applyCeilingSpotPreset(p.id)}
                        className="h-7 rounded border border-atelier-border bg-atelier-panel px-2 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs text-atelier-muted">
                      Emplacements ({ceilingLighting.spots.length})
                    </span>
                    <div className="flex items-center gap-1">
                      {ceilingLighting.spots.length > 1 && (
                        <button
                          type="button"
                          data-testid="btn-select-all-spots"
                          onClick={() =>
                            setSelectedIds(
                              ceilingLighting.spots.map((s) => s.id),
                              'spot'
                            )
                          }
                          className="rounded border border-atelier-border bg-atelier-panel px-1.5 py-0.5 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                        >
                          Tout sél.
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="btn-add-ceiling-spot"
                        onClick={() => {
                          const newSpotId = addCeilingSpot();
                          selectEntity(newSpotId, 'spot');
                        }}
                        className="inline-flex items-center gap-1 rounded border border-atelier-accent/50 bg-atelier-accent/15 px-2 py-0.5 text-xs font-medium text-atelier-accent-text hover:bg-atelier-accent/25"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Ajouter</span>
                      </button>
                    </div>
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto">
                    {ceilingLighting.spots.map((sp, idx) => (
                      <div
                        key={sp.id}
                        className="flex items-center justify-between gap-1 rounded-md border border-atelier-border bg-atelier-panel px-2 py-1"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Sélectionner ${sp.labelFr ?? `Spot ${idx + 1}`}`}
                          checked={selectedKind === 'spot' && selectedIds.includes(sp.id)}
                          onChange={() => toggleSelectEntity(sp.id, 'spot')}
                          className="accent-atelier-accent"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            if (e.shiftKey || e.ctrlKey || e.metaKey) {
                              toggleSelectEntity(sp.id, 'spot');
                            } else {
                              selectEntity(sp.id, 'spot');
                            }
                          }}
                          className="flex min-w-0 flex-1 items-center justify-between text-left hover:text-atelier-accent-text"
                        >
                          <span className="truncate font-medium text-atelier-fg">
                            {sp.labelFr ?? `Spot ${idx + 1}`}
                          </span>
                          <span className="ml-2 text-xs text-atelier-subtle tabular-nums">
                            {formatDim(sp.xMm, displayUnit, false)} / {formatDim(sp.zMm, displayUnit, false)}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeCeilingSpot(sp.id)}
                          title="Supprimer ce spot"
                          className="rounded p-0.5 text-atelier-subtle hover:text-atelier-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-atelier-subtle">
                    Astuce : cochez plusieurs spots (ou Shift+clic sur le Plan 2D) pour les modifier ou les déplacer en lot.
                  </p>
                </div>
              </div>
            </InspectorSection>

            {/* Collapsible Quick Selection Lists */}
            <InspectorSection
              titleFr={`${FR.viewport.modulesLabel} (${document.modules.length})`}
              defaultOpen={false}
            >
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {document.modules.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selectEntity(m.id, 'module')}
                    className="flex w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-panel px-2.5 py-1.5 text-left text-xs hover:border-atelier-accent"
                  >
                    <span className="truncate text-atelier-fg">
                      <span className="mr-1.5 font-mono text-atelier-accent-text">{m.ref}</span>
                      {m.nameFr}
                    </span>
                    <span className="text-xs text-atelier-subtle tabular-nums">
                      {formatDim(m.widthMm, displayUnit, false)}
                    </span>
                  </button>
                ))}
              </div>
            </InspectorSection>

            {(document.props?.length ?? 0) > 0 && (
              <InspectorSection
                titleFr={`Électro & Déco (${document.props?.length ?? 0})`}
                defaultOpen={false}
              >
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {(document.props ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectEntity(p.id, 'prop')}
                      className="flex w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-panel px-2.5 py-1.5 text-left text-xs hover:border-sky-400"
                    >
                      <span className="truncate text-atelier-fg">
                        <span className="mr-1.5 font-mono text-atelier-info">{p.ref}</span>
                        {p.nameFr}
                      </span>
                      <span className="text-xs text-atelier-subtle tabular-nums">
                        {formatDim(p.widthMm, displayUnit, false)}
                      </span>
                    </button>
                  ))}
                </div>
              </InspectorSection>
            )}

            <InspectorSection
              titleFr={`${FR.viewport.wallsLabel} (${document.walls.length})`}
              defaultOpen={false}
            >
              <div className="space-y-1">
                {document.walls.map((w) => {
                  const len = Math.hypot(w.endMm[0] - w.startMm[0], w.endMm[1] - w.startMm[1]);
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => selectEntity(w.id, 'wall')}
                      className="flex w-full items-center justify-between rounded-md border border-atelier-border bg-atelier-panel px-2.5 py-1.5 text-left text-xs hover:border-atelier-accent"
                    >
                      <span className="truncate text-atelier-fg">{w.labelFr ?? w.id}</span>
                      <span className="text-xs text-atelier-subtle tabular-nums">
                        {formatDim(len, displayUnit)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </InspectorSection>
          </div>
        )}

        {selected?.kind === 'floor' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-atelier-border bg-atelier-surface-2 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                {FR.inspector.kindLabels.floor}
              </div>
              <div className="text-sm font-semibold text-atelier-fg">
                {getMaterialById(document.floorMaterialId).nameFr}
              </div>
            </div>

            <RoomSurfaceControls focusSection="floor" />
          </div>
        )}

        {isMultiModules && multiModules.length > 1 && (
          <div data-testid="batch-inspector" className="space-y-3 text-xs">
            <div className="rounded-lg border border-atelier-accent/50 bg-atelier-accent/15 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                Sélection multiple ({multiModules.length} éléments)
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {multiModules.map((m) => (
                  <span
                    key={m.id}
                    className="rounded border border-atelier-border bg-atelier-panel px-1.5 py-0.5 font-mono text-xs text-atelier-accent-text"
                  >
                    {m.ref}
                  </span>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Matériau façade (lot)</span>
              <select
                data-testid="batch-facade-material"
                defaultValue=""
                onChange={(e) => {
                  const matId = e.target.value;
                  if (!matId) return;
                  updateModulesBatch(selectedIds, {
                    overrides: {
                      facadeMaterialId: matId === '__default__' ? undefined : matId,
                      facadeColorOverride: undefined,
                    },
                  });
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value="">— Appliquer un matériau —</option>
                <option value="__default__">{FR.inspector.inheritDefault}</option>
                {MATERIALS_CATALOG.filter((m) => m.category !== 'sol' && m.category !== 'mur').map(
                  (m) => (
                    <option key={m.id} value={m.id}>
                      {m.nameFr}
                    </option>
                  )
                )}
              </select>
            </label>

            <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-atelier-muted">Couleur façade (lot)</span>
                <input
                  type="color"
                  data-testid="batch-facade-color"
                  defaultValue="#f7f7f5"
                  onChange={(e) => {
                    const hex = e.target.value;
                    runContinuousEdit(() =>
                      updateModulesBatch(selectedIds, {
                        overrides: { facadeColorOverride: hex },
                      })
                    );
                  }}
                  onBlur={flushContinuousEdit}
                  className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                />
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {CABINET_COLOR_SWATCHES.map((sw) => (
                  <button
                    key={sw.hex}
                    type="button"
                    title={sw.labelFr}
                    onClick={() =>
                      updateModulesBatch(selectedIds, {
                        overrides: { facadeColorOverride: sw.hex },
                      })
                    }
                    className="h-5 w-full rounded border border-atelier-border-strong hover:scale-105"
                    style={{ backgroundColor: sw.hex }}
                  />
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Matériau caisson (lot)</span>
              <select
                data-testid="batch-carcass-material"
                defaultValue=""
                onChange={(e) => {
                  const matId = e.target.value;
                  if (!matId) return;
                  updateModulesBatch(selectedIds, {
                    overrides: {
                      carcassMaterialId: matId === '__default__' ? undefined : matId,
                      carcassColorOverride: undefined,
                    },
                  });
                }}
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              >
                <option value="">— Appliquer un caisson —</option>
                <option value="__default__">{FR.inspector.inheritDefault}</option>
                {MATERIALS_CATALOG.filter(
                  (m) => m.category === 'melamine_bois' || m.category === 'melamine_uni'
                ).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nameFr}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-atelier-muted">Poignées (lot)</span>
                <select
                  data-testid="batch-handle-style"
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    updateModulesBatch(selectedIds, {
                      overrides: {
                        handleStyle: val === '__default__' ? undefined : (val as HandleStyle),
                      },
                    });
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                >
                  <option value="">— Choisir —</option>
                  <option value="__default__">{FR.inspector.inheritDefault}</option>
                  <option value="bar">{FR.carpentry.handleStyles.bar}</option>
                  <option value="knob">{FR.carpentry.handleStyles.knob}</option>
                  <option value="gorge">{FR.carpentry.handleStyles.gorge}</option>
                  <option value="push">{FR.carpentry.handleStyles.push}</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-atelier-muted">Épaisseur (lot)</span>
                <select
                  data-testid="batch-board-thickness"
                  defaultValue=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    updateModulesBatch(selectedIds, {
                      overrides: {
                        boardThickness:
                          val === '__default__' ? undefined : (Number(val) as BoardThickness),
                      },
                    });
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                >
                  <option value="">— Choisir —</option>
                  <option value="__default__">{FR.inspector.inheritDefault}</option>
                  <option value={16}>16 mm</option>
                  <option value={18}>18 mm</option>
                  <option value={19}>19 mm</option>
                  <option value={22}>22 mm</option>
                </select>
              </label>
            </div>

            <div className="space-y-1.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <span className="text-xs text-atelier-muted">Façade (lot)</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-testid="batch-facade-kind-plein"
                  onClick={() => updateModulesBatch(selectedIds, { facadeKind: 'plein' })}
                  className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs font-medium text-atelier-fg hover:border-atelier-accent"
                >
                  Bois plein
                </button>
                <button
                  type="button"
                  data-testid="batch-facade-kind-vitre"
                  onClick={() => updateModulesBatch(selectedIds, { facadeKind: 'vitre' })}
                  className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs font-medium text-atelier-fg hover:border-atelier-accent"
                >
                  Vitrée (cadre + verre)
                </button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="text-xs font-semibold text-atelier-accent-text">
                Espacement exact entre modules
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <DimField
                    label="Écart (mm/cm)"
                    valueMm={spacingGapMm}
                    unit={displayUnit}
                    testId="batch-spacing-input"
                    minMm={0}
                    onCommit={(val) => setSpacingGapMm(val)}
                  />
                </div>
                <button
                  type="button"
                  data-testid="batch-apply-spacing"
                  onClick={() => {
                    const moves = computeMultiModuleSpacingMoves(
                      multiModules,
                      document.walls,
                      spacingGapMm
                    );
                    if (moves.length > 0) {
                      moveModulesBatch(moves);
                    }
                  }}
                  className="h-9 shrink-0 rounded-md bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
                >
                  Appliquer l’espacement
                </button>
              </div>
            </div>

            <button
              type="button"
              data-testid="batch-delete-btn"
              onClick={() => {
                removeModulesBatch(selectedIds);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>Supprimer la sélection ({multiModules.length})</span>
            </button>
          </div>
        )}

        {!isMultiModules && selected?.kind === 'module' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-atelier-border bg-atelier-surface-2 px-3 py-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                  {FR.inspector.kindLabels.module} · {selected.entity.ref}
                </div>
                <div className="truncate text-sm font-semibold text-atelier-fg">
                  {FR.moduleNames[selected.entity.type]}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  rotateModuleWithCornerSnap(
                    selected.entity.id,
                    (selected.entity.rotationYRad + Math.PI / 2) % (Math.PI * 2)
                  )
                }
                title="Pivoter de 90° (R)"
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-atelier-border bg-atelier-panel px-2 text-xs font-medium text-atelier-accent-text hover:border-atelier-accent"
              >
                <RotateCw className="h-3.5 w-3.5" />
                <span>90°</span>
              </button>
            </div>

            <InspectorSection titleFr="Dimensions & Position" defaultOpen>
              <label className="block space-y-1 text-xs">
                <span className="text-atelier-muted">{FR.inspector.name}</span>
                <input
                  type="text"
                  value={selected.entity.nameFr}
                  onChange={(e) => updateModule(selected.entity.id, { nameFr: e.target.value })}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2.5 text-atelier-fg"
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                <DimField
                  label={FR.inspector.width}
                  valueMm={selected.entity.widthMm}
                  unit={displayUnit}
                  testId="inspector-input-width"
                  minMm={50}
                  onCommit={(widthMm) => updateModule(selected.entity.id, { widthMm })}
                />
                <DimField
                  label={FR.inspector.height}
                  valueMm={selected.entity.heightMm}
                  unit={displayUnit}
                  testId="inspector-input-height"
                  minMm={16}
                  onCommit={(heightMm) => updateModule(selected.entity.id, { heightMm })}
                />
                <DimField
                  label={FR.inspector.depth}
                  valueMm={selected.entity.depthMm}
                  unit={displayUnit}
                  testId="inspector-input-depth"
                  minMm={8}
                  onCommit={(depthMm) => updateModule(selected.entity.id, { depthMm })}
                />
              </div>

              {selectedFitSolution && (
                <div
                  data-testid="inspector-autofit-card"
                  className="space-y-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-2.5 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-emerald-300">
                      Débordement détecté ({selectedFitSolution.reasonFr})
                    </div>
                    <div className="text-atelier-muted">{selectedFitSolution.summaryFr}</div>
                  </div>
                  <button
                    type="button"
                    data-testid="btn-autofit-module"
                    onClick={() => applyAutoFitSolution(selectedFitSolution)}
                    className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-2.5 text-xs font-semibold text-atelier-accent-fg transition-colors hover:bg-emerald-400"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>Ajuster la taille automatiquement</span>
                  </button>
                </div>
              )}

              {selected.entity.type === 'caisson_angle' && (
                <div className="space-y-1.5 rounded-md border border-atelier-border bg-atelier-panel p-2 text-xs">
                  <span className="text-atelier-muted">Type d’angle</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateModule(selected.entity.id, { cornerKind: 'en_l' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        (selected.entity.cornerKind ?? 'en_l') === 'en_l'
                          ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      En L (90°)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateModule(selected.entity.id, { cornerKind: 'aveugle' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        selected.entity.cornerKind === 'aveugle'
                          ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-surface-2 text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      Angle mort / aveugle
                    </button>
                  </div>
                </div>
              )}

              {(selected.entity.type === 'caisson_angle_aveugle' ||
                selected.entity.type === 'caisson_haut_angle_aveugle' ||
                (selected.entity.type === 'caisson_angle' &&
                  selected.entity.cornerKind === 'aveugle')) && (
                <div
                  data-testid="inspector-blind-side-section"
                  className="space-y-1.5 rounded-md border border-atelier-accent/40 bg-atelier-accent/10 p-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-atelier-fg">Côté angle mort (panneau fixe)</span>
                    <span className="text-xs text-atelier-muted">
                      {selected.entity.blindSide === 'right' ? 'Porte à gauche' : 'Porte à droite'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      data-testid="inspector-blind-side-left"
                      onClick={() => updateModule(selected.entity.id, { blindSide: 'left' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        (selected.entity.blindSide ?? 'left') === 'left'
                          ? 'border-atelier-accent bg-atelier-accent/25 font-semibold text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      À gauche
                    </button>
                    <button
                      type="button"
                      data-testid="inspector-blind-side-right"
                      onClick={() => updateModule(selected.entity.id, { blindSide: 'right' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        selected.entity.blindSide === 'right'
                          ? 'border-atelier-accent bg-atelier-accent/25 font-semibold text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      À droite
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <span className="text-xs text-atelier-muted">Largeurs standards (1 clic)</span>
                <div className="flex flex-wrap gap-1">
                  {[300, 400, 450, 500, 600, 800, 900, 1000, 1200].map((w) => (
                    <button
                      key={w}
                      type="button"
                      data-testid={`width-preset-${w}`}
                      onClick={() => updateModule(selected.entity.id, { widthMm: w })}
                      className={`rounded border px-1.5 py-0.5 text-xs tabular-nums transition-colors ${
                        selected.entity.widthMm === w
                          ? 'border-atelier-accent bg-atelier-accent/20 font-semibold text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <DimField
                  label={FR.inspector.positionX}
                  valueMm={selected.entity.xMm}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(xMm) => updateModule(selected.entity.id, { xMm })}
                />
                <DimField
                  label={FR.inspector.elevationY}
                  valueMm={selected.entity.yMm}
                  unit={displayUnit}
                  minMm={0}
                  onCommit={(yMm) => updateModule(selected.entity.id, { yMm })}
                />
                <DimField
                  label={FR.inspector.positionZ}
                  valueMm={selected.entity.zMm}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(zMm) => updateModule(selected.entity.id, { zMm })}
                />
              </div>
            </InspectorSection>

            <InspectorSection titleFr="Matériaux & Finitions" defaultOpen>
              <label className="block space-y-1 text-xs">
                <span className="text-atelier-muted">{FR.inspector.overrideFacadeMaterial}</span>
                <select
                  value={selected.entity.overrides?.facadeMaterialId ?? ''}
                  onChange={(e) =>
                    updateModule(selected.entity.id, {
                      overrides: {
                        ...selected.entity.overrides,
                        facadeMaterialId: e.target.value || undefined,
                        facadeColorOverride: undefined,
                      },
                    })
                  }
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                >
                  <option value="">{FR.inspector.inheritDefault}</option>
                  {MATERIALS_CATALOG.filter((m) => m.category !== 'sol' && m.category !== 'mur').map(
                    (m) => (
                      <option key={m.id} value={m.id}>
                        {m.nameFr}
                      </option>
                    )
                  )}
                </select>
              </label>

              {/* Custom HEX Color Pickers */}
              <div className="space-y-2.5 rounded-md border border-atelier-border bg-atelier-panel p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-atelier-muted">Façades laquées</span>
                  <div className="flex items-center gap-1.5">
                    {selected.entity.overrides?.facadeColorOverride && (
                      <button
                        type="button"
                        onClick={() =>
                          updateModule(selected.entity.id, {
                            overrides: {
                              ...selected.entity.overrides,
                              facadeColorOverride: undefined,
                            },
                          })
                        }
                        className="text-xs text-atelier-subtle hover:text-atelier-fg"
                      >
                        ✕
                      </button>
                    )}
                    <input
                      type="color"
                      data-testid="module-facade-color-picker"
                      value={
                        selected.entity.overrides?.facadeColorOverride ??
                        document.defaultCarpentry.facadeColorOverride ??
                        getMaterialById(
                          selected.entity.overrides?.facadeMaterialId ??
                            document.defaultCarpentry.facadeMaterialId
                        ).colorHex
                      }
                      onChange={(e) => {
                        const hex = e.target.value;
                        runContinuousEdit(() =>
                          updateModule(selected.entity.id, {
                            overrides: {
                              ...selected.entity.overrides,
                              facadeColorOverride: hex,
                            },
                          })
                        );
                      }}
                      onBlur={flushContinuousEdit}
                      className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {CABINET_COLOR_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      type="button"
                      title={`Façade ${sw.labelFr}`}
                      onClick={() =>
                        updateModule(selected.entity.id, {
                          overrides: {
                            ...selected.entity.overrides,
                            facadeColorOverride: sw.hex,
                          },
                        })
                      }
                      className="h-5 w-full rounded border border-atelier-border-strong hover:scale-105"
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-atelier-muted">Caisson / corps</span>
                  <div className="flex items-center gap-1.5">
                    {selected.entity.overrides?.carcassColorOverride && (
                      <button
                        type="button"
                        onClick={() =>
                          updateModule(selected.entity.id, {
                            overrides: {
                              ...selected.entity.overrides,
                              carcassColorOverride: undefined,
                            },
                          })
                        }
                        className="text-xs text-atelier-subtle hover:text-atelier-fg"
                      >
                        ✕
                      </button>
                    )}
                    <input
                      type="color"
                      data-testid="module-carcass-color-picker"
                      value={
                        selected.entity.overrides?.carcassColorOverride ??
                        document.defaultCarpentry.carcassColorOverride ??
                        getMaterialById(
                          selected.entity.overrides?.carcassMaterialId ??
                            document.defaultCarpentry.carcassMaterialId
                        ).colorHex
                      }
                      onChange={(e) => {
                        const hex = e.target.value;
                        runContinuousEdit(() =>
                          updateModule(selected.entity.id, {
                            overrides: {
                              ...selected.entity.overrides,
                              carcassColorOverride: hex,
                            },
                          })
                        );
                      }}
                      onBlur={flushContinuousEdit}
                      className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                    />
                  </div>
                </div>

                {(selected.entity.type === 'plan_de_travail' ||
                  selected.entity.type === 'ilot_central' ||
                  selected.entity.type === 'credence') && (
                  <div className="flex items-center justify-between">
                    <span className="text-atelier-muted">Plan de travail / crédence</span>
                    <div className="flex items-center gap-1.5">
                      {selected.entity.overrides?.countertopColorOverride && (
                        <button
                          type="button"
                          onClick={() =>
                            updateModule(selected.entity.id, {
                              overrides: {
                                ...selected.entity.overrides,
                                countertopColorOverride: undefined,
                              },
                            })
                          }
                          className="text-xs text-atelier-subtle hover:text-atelier-fg"
                        >
                          ✕
                        </button>
                      )}
                      <input
                        type="color"
                        data-testid="module-countertop-color-picker"
                        value={
                          selected.entity.overrides?.countertopColorOverride ??
                          document.defaultCarpentry.countertopColorOverride ??
                          getMaterialById(
                            selected.entity.overrides?.countertopMaterialId ??
                              document.defaultCarpentry.countertopMaterialId
                          ).colorHex
                        }
                        onChange={(e) => {
                          const hex = e.target.value;
                          runContinuousEdit(() =>
                            updateModule(selected.entity.id, {
                              overrides: {
                                ...selected.entity.overrides,
                                countertopColorOverride: hex,
                              },
                            })
                          );
                        }}
                        onBlur={flushContinuousEdit}
                        className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                      />
                    </div>
                  </div>
                )}
              </div>

              <label className="block space-y-1 text-xs">
                <span className="text-atelier-muted">{FR.carpentry.carcassMaterial}</span>
                <select
                  data-testid="inspector-carcass-material"
                  value={selected.entity.overrides?.carcassMaterialId ?? ''}
                  onChange={(e) =>
                    updateModule(selected.entity.id, {
                      overrides: {
                        ...selected.entity.overrides,
                        carcassMaterialId: e.target.value || undefined,
                        carcassColorOverride: undefined,
                      },
                    })
                  }
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                >
                  <option value="">{FR.inspector.inheritDefault}</option>
                  {MATERIALS_CATALOG.filter((m) => m.category !== 'sol' && m.category !== 'mur').map(
                    (m) => (
                      <option key={m.id} value={m.id}>
                        {m.nameFr}
                      </option>
                    )
                  )}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-atelier-muted">{FR.carpentry.handleStyle}</span>
                  <select
                    value={selected.entity.overrides?.handleStyle ?? ''}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        overrides: {
                          ...selected.entity.overrides,
                          handleStyle: (e.target.value || undefined) as HandleStyle | undefined,
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                  >
                    <option value="">{FR.inspector.inheritDefault}</option>
                    <option value="bar">{FR.carpentry.handleStyles.bar}</option>
                    <option value="knob">{FR.carpentry.handleStyles.knob}</option>
                    <option value="gorge">{FR.carpentry.handleStyles.gorge}</option>
                    <option value="push">{FR.carpentry.handleStyles.push}</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-atelier-muted">Position poignée</span>
                  <select
                    data-testid="inspector-handle-position-y"
                    value={selected.entity.handlePositionY ?? 'auto'}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        handlePositionY: e.target.value as HandleVerticalPosition,
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                  >
                    <option value="auto">Auto (Bas en haut)</option>
                    <option value="bottom">En bas</option>
                    <option value="center">Au milieu</option>
                    <option value="top">En haut</option>
                  </select>
                </label>
              </div>
            </InspectorSection>

            <InspectorSection titleFr="Aménagement, Vitrage & LED" defaultOpen>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <label className="space-y-1">
                  <span className="text-atelier-muted">{FR.inspector.doorCount}</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    value={selected.entity.doorCount}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        doorCount: Math.min(
                          6,
                          Math.max(0, Number.parseInt(e.target.value, 10) || 0)
                        ),
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-atelier-muted">{FR.inspector.drawerCount}</span>
                  <input
                    type="number"
                    min={0}
                    max={8}
                    value={selected.entity.drawerCount}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        drawerCount: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg tabular-nums"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-atelier-muted">{FR.inspector.shelfCount}</span>
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={selected.entity.shelfCount}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        shelfCount: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg tabular-nums"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-atelier-muted">{FR.carpentry.grainDirection}</span>
                  <select
                    value={selected.entity.grainDirection ?? ''}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        grainDirection: (e.target.value || undefined) as GrainDirection | undefined,
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                  >
                    <option value="">{FR.inspector.inheritDefault}</option>
                    <option value="H">{FR.carpentry.grainDirections.H}</option>
                    <option value="V">{FR.carpentry.grainDirections.V}</option>
                    <option value="none">{FR.carpentry.grainDirections.none}</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-atelier-muted">{FR.carpentry.boardThickness}</span>
                  <select
                    value={selected.entity.overrides?.boardThickness ?? ''}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        overrides: {
                          ...selected.entity.overrides,
                          boardThickness: e.target.value
                            ? (Number(e.target.value) as BoardThickness)
                            : undefined,
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                  >
                    <option value="">{FR.inspector.inheritDefault}</option>
                    <option value={16}>16 mm</option>
                    <option value={18}>18 mm</option>
                    <option value={19}>19 mm</option>
                    <option value={22}>22 mm</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-atelier-muted">{FR.carpentry.backMountType}</span>
                  <select
                    value={selected.entity.overrides?.backMountType ?? ''}
                    onChange={(e) =>
                      updateModule(selected.entity.id, {
                        overrides: {
                          ...selected.entity.overrides,
                          backMountType: (e.target.value || undefined) as
                            | BackMountType
                            | undefined,
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                  >
                    <option value="">{FR.inspector.inheritDefault}</option>
                    <option value="rainure">{FR.carpentry.backMountLabels.rainure}</option>
                    <option value="applique">{FR.carpentry.backMountLabels.applique}</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-atelier-muted">{FR.inspector.rotationDeg}</span>
                  <input
                    type="number"
                    step={15}
                    value={Math.round((selected.entity.rotationYRad * 180) / Math.PI)}
                    onChange={(e) => {
                      const deg = Number(e.target.value);
                      if (Number.isFinite(deg)) {
                        rotateModuleWithCornerSnap(selected.entity.id, (deg * Math.PI) / 180);
                      }
                    }}
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg tabular-nums"
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-atelier-muted">Façade</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    data-testid="inspector-facade-kind-plein"
                    onClick={() => updateModule(selected.entity.id, { facadeKind: 'plein' })}
                    className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                      (selected.entity.facadeKind ??
                        (selected.entity.type === 'meuble_haut_vitre' ||
                        selected.entity.type === 'meuble_vitrine'
                          ? 'vitre'
                          : 'plein')) === 'plein'
                        ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                        : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                    }`}
                  >
                    Bois plein
                  </button>
                  <button
                    type="button"
                    data-testid="inspector-facade-kind-vitre"
                    onClick={() => updateModule(selected.entity.id, { facadeKind: 'vitre' })}
                    className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                      (selected.entity.facadeKind ??
                        (selected.entity.type === 'meuble_haut_vitre' ||
                        selected.entity.type === 'meuble_vitrine'
                          ? 'vitre'
                          : 'plein')) === 'vitre'
                        ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                        : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                    }`}
                  >
                    Vitrée (verre)
                  </button>
                </div>
              </div>

              {(selected.entity.facadeKind === 'vitre' ||
                (selected.entity.facadeKind !== 'plein' &&
                  (selected.entity.type === 'meuble_haut_vitre' ||
                    selected.entity.type === 'meuble_vitrine'))) && (
                <div
                  data-testid="inspector-glass-controls"
                  className="space-y-2.5 rounded-md border border-sky-500/40 bg-sky-500/10 p-2.5 text-xs"
                >
                  <div className="font-semibold text-atelier-info">Cadre bois & Teinte du verre</div>

                  <div className="space-y-1.5">
                    <DimField
                      label="Largeur cadre autour du verre"
                      valueMm={selected.entity.glassFrameWidthMm ?? 52}
                      unit={displayUnit}
                      testId="inspector-glass-frame-width"
                      minMm={15}
                      onCommit={(val) =>
                        updateModule(selected.entity.id, {
                          glassFrameWidthMm: Math.max(15, Math.min(120, Math.round(val))),
                        })
                      }
                    />
                    <div className="grid grid-cols-4 gap-1">
                      {[
                        { mm: 20, label: '2 cm' },
                        { mm: 35, label: '3.5 cm' },
                        { mm: 50, label: '5 cm' },
                        { mm: 70, label: '7 cm' },
                      ].map((p) => (
                        <button
                          key={p.mm}
                          type="button"
                          data-testid={`glass-frame-${p.mm}`}
                          onClick={() =>
                            updateModule(selected.entity.id, { glassFrameWidthMm: p.mm })
                          }
                          className={`h-7 rounded border text-xs tabular-nums ${
                            Math.round(selected.entity.glassFrameWidthMm ?? 52) === p.mm
                              ? 'border-sky-400 bg-sky-500/25 font-semibold text-atelier-fg'
                              : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-atelier-muted">Couleur / teinte du verre</span>
                      <input
                        type="color"
                        data-testid="inspector-glass-tint-picker"
                        value={selected.entity.glassTintHex ?? '#e0f2fe'}
                        onChange={(e) => {
                          const hex = e.target.value;
                          runContinuousEdit(() =>
                            updateModule(selected.entity.id, { glassTintHex: hex })
                          );
                        }}
                        onBlur={flushContinuousEdit}
                        className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {[
                        { label: 'Clair', hex: '#e0f2fe', op: 0.24 },
                        { label: 'Fumé', hex: '#64748b', op: 0.42 },
                        { label: 'Bronze', hex: '#855e42', op: 0.44 },
                        { label: 'Noir', hex: '#1e293b', op: 0.56 },
                        { label: 'Dépoli', hex: '#f1f5f9', op: 0.65 },
                      ].map((g) => (
                        <button
                          key={g.label}
                          type="button"
                          onClick={() =>
                            updateModule(selected.entity.id, {
                              glassTintHex: g.hex,
                              glassOpacity: g.op,
                            })
                          }
                          className="rounded border border-atelier-border bg-atelier-panel px-1 py-1 text-xs text-atelier-muted hover:border-sky-400 hover:text-atelier-fg"
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="block space-y-1">
                    <div className="flex justify-between text-atelier-muted">
                      <span>Opacité / Effet dépoli</span>
                      <span className="font-mono text-atelier-info tabular-nums">
                        {Math.round((selected.entity.glassOpacity ?? 0.24) * 100)} %
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="inspector-glass-opacity"
                      min={15}
                      max={80}
                      step={5}
                      value={Math.round((selected.entity.glassOpacity ?? 0.24) * 100)}
                      onChange={(e) => {
                        const op = Number(e.target.value) / 100;
                        runContinuousEdit(() =>
                          updateModule(selected.entity.id, { glassOpacity: op })
                        );
                      }}
                      onPointerUp={flushContinuousEdit}
                      onBlur={flushContinuousEdit}
                      className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                    />
                  </label>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-xs">
                <DimField
                  label="Plinthe H"
                  valueMm={
                    selected.entity.overrides?.plinthHeightMm ??
                    document.defaultCarpentry.plinthHeightMm
                  }
                  unit={displayUnit}
                  minMm={0}
                  onCommit={(val) =>
                    updateModule(selected.entity.id, {
                      hasPlinth: val > 0,
                      overrides: {
                        ...selected.entity.overrides,
                        plinthHeightMm: Math.round(val),
                      },
                    })
                  }
                />
                <DimField
                  label="Recul pl."
                  valueMm={
                    selected.entity.overrides?.plinthRecessMm ??
                    document.defaultCarpentry.plinthRecessMm
                  }
                  unit={displayUnit}
                  minMm={0}
                  onCommit={(val) =>
                    updateModule(selected.entity.id, {
                      overrides: {
                        ...selected.entity.overrides,
                        plinthRecessMm: Math.round(val),
                      },
                    })
                  }
                />
                <DimField
                  label="Jeu faç."
                  valueMm={
                    selected.entity.overrides?.facadeGapMm ?? document.defaultCarpentry.facadeGapMm
                  }
                  unit="mm"
                  minMm={0}
                  onCommit={(val) =>
                    updateModule(selected.entity.id, {
                      overrides: {
                        ...selected.entity.overrides,
                        facadeGapMm: Math.min(12, Math.max(0, Math.round(val))),
                      },
                    })
                  }
                />
              </div>

              {selected.entity.doorCount === 1 && (
                <div className="space-y-1.5">
                  <span className="text-xs text-atelier-muted">Sens d’ouverture</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      data-testid="inspector-hinge-left"
                      onClick={() => updateModule(selected.entity.id, { hingeSide: 'left' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        (selected.entity.hingeSide ?? 'left') === 'left'
                          ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      Gauche
                    </button>
                    <button
                      type="button"
                      data-testid="inspector-hinge-right"
                      onClick={() => updateModule(selected.entity.id, { hingeSide: 'right' })}
                      className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                        selected.entity.hingeSide === 'right'
                          ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                          : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                      }`}
                    >
                      Droite
                    </button>
                  </div>
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-xs text-atelier-fg">
                <input
                  type="checkbox"
                  checked={Boolean(selected.entity.ledUnder)}
                  onChange={(e) =>
                    updateModule(selected.entity.id, { ledUnder: e.target.checked })
                  }
                  className="accent-atelier-accent"
                />
                <span>{FR.inspector.ledUnder}</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs text-atelier-fg">
                <input
                  type="checkbox"
                  data-testid="inspector-led-interior"
                  checked={Boolean(selected.entity.ledInterior)}
                  onChange={(e) =>
                    updateModule(selected.entity.id, {
                      ledInterior: e.target.checked,
                      ...(e.target.checked && selected.entity.ledInteriorWrap === undefined
                        ? { ledInteriorWrap: true }
                        : {}),
                    })
                  }
                  className="accent-atelier-accent"
                />
                <span>{FR.inspector.ledInterior}</span>
              </label>

              {(selected.entity.ledInterior ||
                selected.entity.ledUnder ||
                selected.entity.type === 'meuble_vitrine' ||
                selected.entity.type === 'caisson_haut' ||
                selected.entity.type === 'meuble_haut_vitre' ||
                selected.entity.type === 'caisson_haut_angle_aveugle' ||
                selected.entity.type === 'caisson_haut_relevant') && (
                <div
                  data-testid="inspector-led-settings"
                  className="space-y-2 rounded-md border border-atelier-accent/40 bg-atelier-accent/10 p-2.5 text-xs"
                >
                  <div className="font-semibold text-atelier-accent-text">
                    Réglages LED du caisson
                  </div>

                  {(selected.entity.ledInterior || selected.entity.type === 'meuble_vitrine') && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-atelier-fg">
                      <input
                        type="checkbox"
                        data-testid="inspector-led-wrap"
                        checked={selected.entity.ledInteriorWrap !== false}
                        onChange={(e) =>
                          updateModule(selected.entity.id, { ledInteriorWrap: e.target.checked })
                        }
                        className="accent-atelier-accent"
                      />
                      <span>Bandeau LED tout autour (4 côtés)</span>
                    </label>
                  )}

                  <label className="block space-y-1">
                    <div className="flex justify-between text-atelier-muted">
                      <span>Intensité LED</span>
                      <span className="font-mono text-atelier-accent-text tabular-nums">
                        {Math.round((selected.entity.ledIntensity ?? 1) * 100)} %
                      </span>
                    </div>
                    <input
                      type="range"
                      data-testid="inspector-led-intensity"
                      min={10}
                      max={200}
                      step={10}
                      value={Math.round((selected.entity.ledIntensity ?? 1) * 100)}
                      onChange={(e) => {
                        const mult = Number(e.target.value) / 100;
                        runContinuousEdit(() =>
                          updateModule(selected.entity.id, { ledIntensity: mult })
                        );
                      }}
                      onPointerUp={flushContinuousEdit}
                      onBlur={flushContinuousEdit}
                      className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                    />
                  </label>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-atelier-muted">Couleur LED</span>
                      <input
                        type="color"
                        data-testid="inspector-led-color-picker"
                        value={selected.entity.ledColorHex ?? '#ffcf87'}
                        onChange={(e) => {
                          const hex = e.target.value;
                          runContinuousEdit(() =>
                            updateModule(selected.entity.id, { ledColorHex: hex })
                          );
                        }}
                        onBlur={flushContinuousEdit}
                        className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                      />
                    </div>
                    <div className="grid grid-cols-5 gap-1">
                      {[
                        { label: 'Chaud', hex: '#ffcf87' },
                        { label: 'Neutre', hex: '#fff1dc' },
                        { label: 'Froid', hex: '#dceeff' },
                        { label: 'Ambre', hex: '#ff9e44' },
                        { label: 'Bleu', hex: '#38bdf8' },
                      ].map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => updateModule(selected.entity.id, { ledColorHex: c.hex })}
                          className="rounded border border-atelier-border bg-atelier-panel px-1 py-1 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </InspectorSection>

            <button
              type="button"
              onClick={() => {
                removeModule(selected.entity.id);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>{FR.inspector.deleteItem}</span>
            </button>
          </div>
        )}

        {selected?.kind === 'wall' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-atelier-border bg-atelier-surface-2 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                {FR.inspector.kindLabels.wall}
              </div>
              <div className="text-sm font-semibold text-atelier-fg">
                {selected.entity.labelFr ?? selected.entity.id}
              </div>
            </div>

            {(() => {
              const wall = selected.entity;
              const dx = wall.endMm[0] - wall.startMm[0];
              const dz = wall.endMm[1] - wall.startMm[1];
              const allMetrics = analyzeWalls(document.walls);
              const wm = allMetrics.find((m) => m.wall.id === wall.id);
              const span = wm
                ? getWallInteriorSpanMm(wm, allMetrics)
                : {
                    startInsetMm: 0,
                    endInsetMm: 0,
                    netLengthMm: Math.round(Math.hypot(dx, dz)),
                  };
              return (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <DimField
                      label={`${FR.inspector.length} (nette)`}
                      valueMm={span.netLengthMm}
                      unit={displayUnit}
                      testId="inspector-input-width"
                      minMm={100}
                      onCommit={(nextNetLen) => resizeWallNetLength(wall.id, nextNetLen)}
                    />
                    <DimField
                      label={FR.inspector.height}
                      valueMm={wall.heightMm}
                      unit={displayUnit}
                      testId="inspector-input-height"
                      minMm={500}
                      onCommit={(heightMm) => updateWall(wall.id, { heightMm })}
                    />
                    <DimField
                      label={FR.inspector.thickness}
                      valueMm={wall.thicknessMm}
                      unit={displayUnit}
                      testId="inspector-input-depth"
                      minMm={50}
                      onCommit={(thicknessMm) => updateWall(wall.id, { thicknessMm })}
                    />
                  </div>
                  <label className="flex cursor-pointer items-center justify-between rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 py-2 text-xs text-atelier-fg">
                    <span>Toujours visible (ignorer auto-coupe)</span>
                    <input
                      type="checkbox"
                      data-testid="wall-keep-visible-cutaway"
                      checked={Boolean(wall.keepVisibleInCutaway)}
                      onChange={(e) =>
                        updateWall(wall.id, { keepVisibleInCutaway: e.target.checked })
                      }
                      className="h-4 w-4 accent-atelier-accent"
                    />
                  </label>
                </>
              );
            })()}

            <div className="space-y-2.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                  Finition de ce mur
                </span>
                {selected.entity.colorOverride && (
                  <button
                    type="button"
                    onClick={() => updateWall(selected.entity.id, { colorOverride: undefined })}
                    className="inline-flex items-center gap-1 text-xs text-atelier-info hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Globale</span>
                  </button>
                )}
              </div>

              <label className="block space-y-1">
                <span className="text-atelier-muted">Texture murale</span>
                <select
                  data-testid="wall-material-select"
                  value={selected.entity.materialId}
                  onChange={(e) =>
                    updateWall(selected.entity.id, { materialId: e.target.value })
                  }
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
                >
                  {MATERIALS_CATALOG.filter((m) => m.category === 'mur').map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nameFr}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-atelier-muted">Couleur accent du mur</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs uppercase text-atelier-subtle">
                      {selected.entity.colorOverride ??
                        document.wallColor ??
                        getMaterialById(selected.entity.materialId).colorHex}
                    </span>
                    <input
                      type="color"
                      data-testid="wall-accent-color-picker"
                      aria-label="Couleur accent du mur"
                      value={
                        selected.entity.colorOverride ??
                        document.wallColor ??
                        getMaterialById(selected.entity.materialId).colorHex
                      }
                      onChange={(e) => {
                        const hex = e.target.value;
                        runContinuousEdit(() =>
                          updateWall(selected.entity.id, { colorOverride: hex })
                        );
                      }}
                      onBlur={flushContinuousEdit}
                      className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-8 gap-1">
                  {WALL_COLOR_SWATCHES.map((sw) => (
                    <button
                      key={sw.hex}
                      type="button"
                      title={`${sw.labelFr} (${sw.hex})`}
                      onClick={() => updateWall(selected.entity.id, { colorOverride: sw.hex })}
                      className={`h-5 w-full rounded border transition-transform hover:scale-110 ${
                        selected.entity.colorOverride?.toLowerCase() === sw.hex.toLowerCase()
                          ? 'border-atelier-accent ring-1 ring-atelier-accent'
                          : 'border-atelier-border-strong'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                removeWall(selected.entity.id);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>{FR.inspector.deleteItem}</span>
            </button>
          </div>
        )}

        {selected?.kind === 'prop' && (() => {
          const prop = selected.entity;
          const spec = PROPS_CATALOG_BY_TYPE[prop.type];
          return (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-sky-500/40 bg-atelier-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider text-atelier-info">
                    {FR.inspector.kindLabels.prop} · {prop.ref}
                  </div>
                  <div className="truncate text-sm font-semibold text-atelier-fg">
                    {FR.propNames[prop.type]}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    rotatePropWithCornerSnap(
                      prop.id,
                      (prop.rotationYRad + Math.PI / 2) % (Math.PI * 2)
                    )
                  }
                  title="Pivoter de 90°"
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-atelier-border bg-atelier-panel px-2 text-xs text-atelier-info hover:border-sky-400"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>90°</span>
                </button>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="text-atelier-muted">{FR.inspector.name}</span>
                <input
                  type="text"
                  value={prop.nameFr}
                  onChange={(e) => updateProp(prop.id, { nameFr: e.target.value })}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2.5 text-atelier-fg"
                />
              </label>

              {spec.supportsTvSize && (
                <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5 text-xs">
                  <div className="text-xs font-semibold uppercase tracking-wider text-atelier-info">
                    Format Téléviseur
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {([43, 55, 65, 75] as TvSizeInches[]).map((sz) => {
                      const active = (prop.tvSizeInches ?? 55) === sz;
                      const dims = TV_SIZE_PRESETS_MM[sz];
                      return (
                        <button
                          key={sz}
                          type="button"
                          data-testid={`tv-size-${sz}`}
                          onClick={() =>
                            updateProp(prop.id, {
                              tvSizeInches: sz,
                              widthMm: dims.widthMm,
                              heightMm: dims.heightMm,
                            })
                          }
                          className={`h-8 rounded text-xs font-semibold ${
                            active
                              ? 'bg-sky-500 text-white'
                              : 'border border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                          }`}
                        >
                          {dims.labelFr}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1 pt-0.5">
                    {(['mural', 'sur_pied'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() =>
                          updateProp(prop.id, {
                            tvMountMode: mode,
                            depthMm: mode === 'sur_pied' ? 240 : 65,
                            yMm: mode === 'sur_pied' ? 500 : 1050,
                          })
                        }
                        className={`h-8 rounded text-xs font-medium ${
                          (prop.tvMountMode ?? 'mural') === mode
                            ? 'bg-atelier-accent text-atelier-accent-fg'
                            : 'border border-atelier-border bg-atelier-panel text-atelier-muted'
                        }`}
                      >
                        {mode === 'mural' ? 'Support mural' : 'Sur pied'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {spec.supportsHoodMount && (
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {(['murale', 'ilot'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => updateProp(prop.id, { hoodMountMode: mode })}
                      className={`h-8 rounded text-xs font-medium ${
                        (prop.hoodMountMode ?? 'murale') === mode
                          ? 'bg-sky-500 text-white'
                          : 'border border-atelier-border bg-atelier-surface-2 text-atelier-muted'
                      }`}
                    >
                      {mode === 'murale' ? 'Hotte murale' : 'Hotte îlot'}
                    </button>
                  ))}
                </div>
              )}

              {spec.supportsLight && (
                <div className="space-y-2 rounded-lg border border-atelier-accent/40 bg-atelier-accent/10 p-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 font-medium text-atelier-accent-text">
                      <Lightbulb className="h-4 w-4" />
                      <span>Éclairage luminaire</span>
                    </span>
                    <button
                      type="button"
                      data-testid="prop-toggle-light"
                      onClick={() => updateProp(prop.id, { lightOn: prop.lightOn === false })}
                      className={`rounded px-2.5 py-1 text-xs font-semibold ${
                        prop.lightOn !== false
                          ? 'bg-atelier-accent text-atelier-accent-fg'
                          : 'border border-atelier-border bg-atelier-surface text-atelier-muted'
                      }`}
                    >
                      {prop.lightOn !== false ? 'Allumé' : 'Éteint'}
                    </button>
                  </div>
                  {prop.lightOn !== false && (
                    <label className="block space-y-1">
                      <div className="flex justify-between text-xs text-atelier-muted">
                        <span>Intensité lumineuse</span>
                        <span className="font-mono text-atelier-accent-text">
                          {Math.round((prop.lightIntensity ?? 1) * 100)} %
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={2.0}
                        step={0.1}
                        value={prop.lightIntensity ?? 1}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          runContinuousEdit(() => updateProp(prop.id, { lightIntensity: val }));
                        }}
                        onPointerUp={flushContinuousEdit}
                        onBlur={flushContinuousEdit}
                        className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                      />
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <DimField
                  label={FR.inspector.width}
                  valueMm={prop.widthMm}
                  unit={displayUnit}
                  minMm={40}
                  onCommit={(widthMm) => updateProp(prop.id, { widthMm })}
                />
                <DimField
                  label={FR.inspector.height}
                  valueMm={prop.heightMm}
                  unit={displayUnit}
                  minMm={10}
                  onCommit={(heightMm) => updateProp(prop.id, { heightMm })}
                />
                <DimField
                  label={FR.inspector.depth}
                  valueMm={prop.depthMm}
                  unit={displayUnit}
                  minMm={20}
                  onCommit={(depthMm) => updateProp(prop.id, { depthMm })}
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <DimField
                  label={FR.inspector.positionX}
                  valueMm={prop.xMm}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(xMm) => updateProp(prop.id, { xMm })}
                />
                <DimField
                  label={FR.inspector.elevationY}
                  valueMm={prop.yMm}
                  unit={displayUnit}
                  minMm={0}
                  onCommit={(yMm) => updateProp(prop.id, { yMm })}
                />
                <DimField
                  label={FR.inspector.positionZ}
                  valueMm={prop.zMm}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(zMm) => updateProp(prop.id, { zMm })}
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <label className="block space-y-1">
                  <span className="text-atelier-muted">Finition</span>
                  <select
                    value={prop.finish ?? spec.defaultFinish}
                    onChange={(e) => {
                      const fin = e.target.value as PropFinishPreset;
                      const presetColor: Record<PropFinishPreset, string> = {
                        inox: '#cfd4da',
                        noir_mat: '#1e2229',
                        blanc: '#f3f2ee',
                        laiton: '#c8a462',
                        bois: '#c59c6c',
                        tissu: '#c8c0b4',
                      };
                      updateProp(prop.id, { finish: fin, colorHex: presetColor[fin] });
                    }}
                    className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                  >
                    <option value="inox">Inox brossé</option>
                    <option value="noir_mat">Noir mat</option>
                    <option value="blanc">Blanc</option>
                    <option value="laiton">Laiton brossé</option>
                    <option value="bois">Bois naturel</option>
                    <option value="tissu">Tissu / Textile</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-atelier-muted">Couleur exacte</span>
                  <div className="flex h-9 items-center gap-1.5 rounded-md border border-atelier-border bg-atelier-surface-2 px-2">
                    <input
                      type="color"
                      value={prop.colorHex ?? spec.defaultColorHex}
                      onChange={(e) => {
                        const hex = e.target.value;
                        runContinuousEdit(() => updateProp(prop.id, { colorHex: hex }));
                      }}
                      onBlur={flushContinuousEdit}
                      className="h-5 w-7 cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="font-mono text-xs uppercase text-atelier-muted">
                      {prop.colorHex ?? spec.defaultColorHex}
                    </span>
                  </div>
                </label>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="text-atelier-muted">{FR.inspector.rotationDeg}</span>
                <input
                  type="number"
                  step={15}
                  value={Math.round((prop.rotationYRad * 180) / Math.PI)}
                  onChange={(e) => {
                    const deg = Number(e.target.value);
                    if (Number.isFinite(deg)) {
                      rotatePropWithCornerSnap(prop.id, (deg * Math.PI) / 180);
                    }
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  removeProp(prop.id);
                  clearSelection();
                }}
                className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
                <span>{FR.inspector.deleteItem}</span>
              </button>
            </div>
          );
        })()}

        {selected?.kind === 'opening' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-atelier-border bg-atelier-surface-2 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                {FR.inspector.kindLabels.opening}
              </div>
              <div className="text-sm font-semibold text-atelier-fg">
                {FR.openings[selected.entity.kind]}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <DimField
                label={FR.inspector.width}
                valueMm={selected.entity.widthMm}
                unit={displayUnit}
                testId="inspector-input-width"
                minMm={200}
                onCommit={(widthMm) => updateOpening(selected.entity.id, { widthMm })}
              />
              <DimField
                label={FR.inspector.height}
                valueMm={selected.entity.heightMm}
                unit={displayUnit}
                testId="inspector-input-height"
                minMm={200}
                onCommit={(heightMm) => updateOpening(selected.entity.id, { heightMm })}
              />
              <DimField
                label={FR.inspector.sillHeight}
                valueMm={selected.entity.sillHeightMm}
                unit={displayUnit}
                testId="inspector-input-depth"
                minMm={0}
                onCommit={(sillHeightMm) => updateOpening(selected.entity.id, { sillHeightMm })}
              />
            </div>

            {(() => {
              const op = selected.entity;
              const allMetrics = analyzeWalls(document.walls);
              const wm = allMetrics.find((m) => m.wall.id === op.wallId);
              if (!wm) return null;
              const span = getWallInteriorSpanMm(wm, allMetrics);
              const leftClearMm = Math.max(0, Math.round(op.offsetFromStartMm - span.startInsetMm));
              const rightClearMm = Math.max(
                0,
                Math.round(wm.lengthMm - span.endInsetMm - (op.offsetFromStartMm + op.widthMm))
              );
              const minOff = Math.max(0, Math.round(span.startInsetMm));
              const maxOff = Math.max(minOff, Math.round(wm.lengthMm - span.endInsetMm - op.widthMm));
              return (
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
                  <DimField
                    label="Distance bord gauche"
                    valueMm={leftClearMm}
                    unit={displayUnit}
                    testId="opening-left-clearance"
                    minMm={0}
                    onCommit={(nextLeft) => {
                      const nextOffset = Math.max(
                        minOff,
                        Math.min(maxOff, Math.round(span.startInsetMm + nextLeft))
                      );
                      updateOpening(op.id, { offsetFromStartMm: nextOffset });
                    }}
                  />
                  <DimField
                    label="Distance bord droit"
                    valueMm={rightClearMm}
                    unit={displayUnit}
                    testId="opening-right-clearance"
                    minMm={0}
                    onCommit={(nextRight) => {
                      const nextOffset = Math.max(
                        minOff,
                        Math.min(
                          maxOff,
                          Math.round(wm.lengthMm - span.endInsetMm - op.widthMm - nextRight)
                        )
                      );
                      updateOpening(op.id, { offsetFromStartMm: nextOffset });
                    }}
                  />
                </div>
              );
            })()}

            {selected.entity.kind === 'porte' && (
              <div className="space-y-1.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5 text-xs">
                <span className="text-atelier-muted">Sens d’ouverture</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    data-testid="opening-hinge-left"
                    onClick={() => updateOpening(selected.entity.id, { hingeSide: 'left' })}
                    className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                      (selected.entity.hingeSide ?? 'left') === 'left'
                        ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                        : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                    }`}
                  >
                    Gauche
                  </button>
                  <button
                    type="button"
                    data-testid="opening-hinge-right"
                    onClick={() => updateOpening(selected.entity.id, { hingeSide: 'right' })}
                    className={`h-8 rounded-md border text-xs font-medium transition-colors ${
                      selected.entity.hingeSide === 'right'
                        ? 'border-atelier-accent bg-atelier-accent/20 text-atelier-accent-text'
                        : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                    }`}
                  >
                    Droite
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                removeOpening(selected.entity.id);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>{FR.inspector.deleteItem}</span>
            </button>
          </div>
        )}

        {isMultiSpots && multiSpots.length > 1 && (
          <div data-testid="batch-spot-inspector" className="space-y-3 text-xs">
            <div className="space-y-2 rounded-lg border border-atelier-accent/50 bg-atelier-accent/15 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                  Spots sélectionnés ({multiSpots.length})
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const newSpotId = addCeilingSpot();
                    setSelectedIds([...selectedIds, newSpotId], 'spot');
                  }}
                  className="inline-flex items-center gap-1 rounded border border-atelier-accent/60 bg-atelier-panel px-2 py-0.5 text-xs font-medium text-atelier-accent-text hover:bg-atelier-accent/20"
                >
                  <Plus className="h-3 w-3" />
                  <span>Ajouter</span>
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {multiSpots.map((sp) => (
                  <span
                    key={sp.id}
                    className="rounded border border-atelier-border bg-atelier-panel px-1.5 py-0.5 text-xs text-atelier-accent-text"
                  >
                    {sp.labelFr ?? sp.id}
                  </span>
                ))}
              </div>
            </div>

            <div className="space-y-2.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  data-testid="batch-spots-on"
                  onClick={() => updateCeilingSpotsBatch(selectedIds, { enabled: true })}
                  className="h-8 rounded-md bg-atelier-accent text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
                >
                  Tout allumer
                </button>
                <button
                  type="button"
                  data-testid="batch-spots-off"
                  onClick={() => updateCeilingSpotsBatch(selectedIds, { enabled: false })}
                  className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs font-medium text-atelier-muted hover:text-atelier-fg"
                >
                  Tout éteindre
                </button>
              </div>

              <label className="block space-y-1">
                <div className="flex justify-between text-atelier-muted">
                  <span>Puissance du lot ({multiSpots.length} spots)</span>
                  <span className="font-mono text-atelier-accent-text tabular-nums">
                    {Math.round(
                      (multiSpots.reduce((acc, s) => acc + (s.intensity ?? 1), 0) /
                        multiSpots.length) *
                        100
                    )}{' '}
                    %
                  </span>
                </div>
                <input
                  type="range"
                  data-testid="batch-spots-intensity"
                  min={20}
                  max={200}
                  step={5}
                  value={Math.round(
                    (multiSpots.reduce((acc, s) => acc + (s.intensity ?? 1), 0) /
                      multiSpots.length) *
                      100
                  )}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    runContinuousEdit(() => updateCeilingSpotsBatch(selectedIds, { intensity: val }));
                  }}
                  onPointerUp={flushContinuousEdit}
                  onBlur={flushContinuousEdit}
                  className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                />
              </label>

              <div className="space-y-1 border-t border-atelier-border pt-2">
                <span className="text-atelier-muted">Aligner & répartir le lot</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    data-testid="batch-spots-align-x"
                    onClick={() => alignCeilingSpots(selectedIds, 'align_x')}
                    className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    Aligner en X
                  </button>
                  <button
                    type="button"
                    data-testid="batch-spots-align-z"
                    onClick={() => alignCeilingSpots(selectedIds, 'align_z')}
                    className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    Aligner en Z
                  </button>
                  <button
                    type="button"
                    data-testid="batch-spots-dist-x"
                    onClick={() => alignCeilingSpots(selectedIds, 'distribute_x')}
                    className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    Répartir en X
                  </button>
                  <button
                    type="button"
                    data-testid="batch-spots-dist-z"
                    onClick={() => alignCeilingSpots(selectedIds, 'distribute_z')}
                    className="h-8 rounded-md border border-atelier-border bg-atelier-panel text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    Répartir en Z
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-atelier-border pt-2">
                <DimField
                  label="X commun"
                  valueMm={Math.round(
                    multiSpots.reduce((acc, s) => acc + s.xMm, 0) / multiSpots.length
                  )}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(xMm) => updateCeilingSpotsBatch(selectedIds, { xMm })}
                />
                <DimField
                  label="Z commun"
                  valueMm={Math.round(
                    multiSpots.reduce((acc, s) => acc + s.zMm, 0) / multiSpots.length
                  )}
                  unit={displayUnit}
                  minMm={-50000}
                  onCommit={(zMm) => updateCeilingSpotsBatch(selectedIds, { zMm })}
                />
              </div>
            </div>

            {/* Quick toggle list to add/remove spots from active multi-selection */}
            <div className="space-y-1 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-atelier-muted">Tous les spots ({ceilingLighting.spots.length})</span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      ceilingLighting.spots.map((s) => s.id),
                      'spot'
                    )
                  }
                  className="text-xs text-atelier-accent-text hover:underline"
                >
                  Tout sélectionner
                </button>
              </div>
              <div className="max-h-32 space-y-1 overflow-y-auto">
                {ceilingLighting.spots.map((sp, idx) => (
                  <label
                    key={sp.id}
                    className="flex cursor-pointer items-center justify-between rounded border border-atelier-border bg-atelier-panel px-2 py-1"
                  >
                    <span className="inline-flex items-center gap-2 text-atelier-fg">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(sp.id)}
                        onChange={() => toggleSelectEntity(sp.id, 'spot')}
                        className="accent-atelier-accent"
                      />
                      <span>{sp.labelFr ?? `Spot ${idx + 1}`}</span>
                    </span>
                    <span className="text-xs text-atelier-subtle tabular-nums">
                      {Math.round((sp.intensity ?? 1) * 100)} %
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="button"
              data-testid="batch-spots-delete"
              onClick={() => {
                removeCeilingSpotsBatch(selectedIds);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>Supprimer la sélection ({multiSpots.length} spots)</span>
            </button>
          </div>
        )}

        {!isMultiSpots && selected?.kind === 'spot' && (
          <div className="space-y-3 text-xs">
            <div className="space-y-2 rounded-lg border border-atelier-accent/50 bg-atelier-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                    {FR.inspector.kindLabels.spot}
                  </div>
                  <div className="text-sm font-semibold text-atelier-fg">
                    {selected.entity.labelFr ?? selected.entity.id}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="spot-single-add-another"
                  onClick={() => {
                    const newSpotId = addCeilingSpot();
                    selectEntity(newSpotId, 'spot');
                  }}
                  className="inline-flex items-center gap-1 rounded border border-atelier-accent/50 bg-atelier-accent/15 px-2 py-1 text-xs font-medium text-atelier-accent-text hover:bg-atelier-accent/25"
                >
                  <Plus className="h-3 w-3" />
                  <span>Ajouter</span>
                </button>
              </div>
              {ceilingLighting.spots.length > 1 && (
                <button
                  type="button"
                  data-testid="spot-single-select-all"
                  onClick={() =>
                    setSelectedIds(
                      ceilingLighting.spots.map((s) => s.id),
                      'spot'
                    )
                  }
                  className="w-full rounded border border-atelier-border bg-atelier-panel py-1 text-xs font-medium text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                >
                  Sélectionner tous les spots ({ceilingLighting.spots.length}) pour édition en lot
                </button>
              )}
            </div>

            <div className="space-y-2.5 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-atelier-fg">État du spot</span>
                <button
                  type="button"
                  data-testid="spot-toggle-enabled"
                  onClick={() =>
                    updateCeilingSpot(selected.entity.id, {
                      enabled: selected.entity.enabled === false,
                    })
                  }
                  className={`rounded px-2.5 py-1 text-xs font-semibold ${
                    selected.entity.enabled !== false
                      ? 'bg-atelier-accent text-atelier-accent-fg'
                      : 'border border-atelier-border bg-atelier-panel text-atelier-muted'
                  }`}
                >
                  {selected.entity.enabled !== false ? 'Allumé' : 'Éteint'}
                </button>
              </div>

              <label className="block space-y-1">
                <div className="flex justify-between text-atelier-muted">
                  <span>Puissance de ce spot</span>
                  <span className="font-mono text-atelier-accent-text tabular-nums">
                    {Math.round((selected.entity.intensity ?? 1) * 100)} %
                  </span>
                </div>
                <input
                  type="range"
                  data-testid="spot-individual-intensity"
                  min={20}
                  max={200}
                  step={5}
                  value={Math.round((selected.entity.intensity ?? 1) * 100)}
                  onChange={(e) => {
                    const val = Number(e.target.value) / 100;
                    runContinuousEdit(() =>
                      updateCeilingSpot(selected.entity.id, { intensity: val })
                    );
                  }}
                  onPointerUp={flushContinuousEdit}
                  onBlur={flushContinuousEdit}
                  className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                />
              </label>

              <label className="block space-y-1 border-t border-atelier-border pt-2">
                <div className="flex justify-between text-atelier-muted">
                  <span>Intensité globale (tous les spots)</span>
                  <span className="font-mono text-atelier-accent-text tabular-nums">
                    {Math.round(ceilingLighting.spotIntensity * 100)} %
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={150}
                  step={5}
                  value={Math.round(ceilingLighting.spotIntensity * 100)}
                  onChange={(e) => {
                    const pct = Number(e.target.value);
                    runContinuousEdit(() =>
                      updateCeilingLighting({
                        spotsEnabled: pct > 0,
                        spotIntensity: pct / 100,
                      })
                    );
                  }}
                  onPointerUp={flushContinuousEdit}
                  onBlur={flushContinuousEdit}
                  className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <DimField
                label={FR.inspector.positionX}
                valueMm={selected.entity.xMm}
                unit={displayUnit}
                testId="spot-input-x"
                minMm={-50000}
                onCommit={(xMm) => updateCeilingSpot(selected.entity.id, { xMm })}
              />
              <DimField
                label={FR.inspector.positionZ}
                valueMm={selected.entity.zMm}
                unit={displayUnit}
                testId="spot-input-z"
                minMm={-50000}
                onCommit={(zMm) => updateCeilingSpot(selected.entity.id, { zMm })}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                removeCeilingSpot(selected.entity.id);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>{FR.inspector.deleteItem}</span>
            </button>
          </div>
        )}

        {selected?.kind === 'utility' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-atelier-border bg-atelier-surface-2 px-3 py-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
                {FR.inspector.kindLabels.utility}
              </div>
              <div className="text-sm font-semibold text-atelier-fg">
                {FR.utilities[selected.entity.kind]}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <DimField
                label={FR.inspector.width}
                valueMm={selected.entity.widthMm}
                unit={displayUnit}
                testId="inspector-input-width"
                minMm={20}
                onCommit={(widthMm) => updateUtility(selected.entity.id, { widthMm })}
              />
              <DimField
                label={FR.inspector.height}
                valueMm={selected.entity.heightMm}
                unit={displayUnit}
                testId="inspector-input-height"
                minMm={20}
                onCommit={(heightMm) => updateUtility(selected.entity.id, { heightMm })}
              />
              <DimField
                label={FR.inspector.depth}
                valueMm={selected.entity.depthMm}
                unit={displayUnit}
                testId="inspector-input-depth"
                minMm={10}
                onCommit={(depthMm) => updateUtility(selected.entity.id, { depthMm })}
              />
            </div>

            <button
              type="button"
              onClick={() => {
                removeUtility(selected.entity.id);
                clearSelection();
              }}
              className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 text-xs font-semibold text-atelier-danger hover:bg-red-500/20"
            >
              <Trash2 className="h-4 w-4" />
              <span>{FR.inspector.deleteItem}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
