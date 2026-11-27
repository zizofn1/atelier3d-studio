import { RotateCcw } from 'lucide-react';
import {
  CABINET_COLOR_SWATCHES,
  FLOOR_COLOR_SWATCHES,
  GROUT_COLOR_SWATCHES,
  MATERIALS_CATALOG,
  WALL_COLOR_SWATCHES,
  getMaterialById,
} from '@/data/materialsCatalog';
import { useProjectStore } from '@/store/useProjectStore';
import { flushContinuousEdit, runContinuousEdit } from '@/utils/historyBatch';

interface RoomSurfaceControlsProps {
  focusSection?: 'all' | 'floor' | 'walls';
  showCarpentryColors?: boolean;
}

const TILE_FLOOR_IDS = new Set(['carrelage-gres', 'zellige-marocain', 'damier-classique']);

export function RoomSurfaceControls({
  focusSection = 'all',
  showCarpentryColors = false,
}: RoomSurfaceControlsProps) {
  const doc = useProjectStore((s) => s.document);
  const updateRoomSurfaces = useProjectStore((s) => s.updateRoomSurfaces);
  const updateGlobalCarpentry = useProjectStore((s) => s.updateGlobalCarpentry);

  const wallMaterials = MATERIALS_CATALOG.filter((m) => m.category === 'mur');
  const floorMaterials = MATERIALS_CATALOG.filter((m) => m.category === 'sol');

  const currentWallMatId = doc.walls[0]?.materialId ?? 'peinture-blanc-casse';
  const currentWallColor = doc.wallColor ?? getMaterialById(currentWallMatId).colorHex;
  const currentFloorMat = getMaterialById(doc.floorMaterialId);
  const currentFloorColor = doc.floorColorOverride ?? currentFloorMat.colorHex;
  const currentGroutColor = doc.floorGroutColor ?? currentFloorMat.secondaryHex ?? '#c5c0b6';
  const hasGrout = TILE_FLOOR_IDS.has(doc.floorMaterialId);
  const hasPerWallOverrides = doc.walls.some((w) => Boolean(w.colorOverride));

  const cp = doc.defaultCarpentry;

  return (
    <div className="space-y-3 text-xs">
      {/* WALLS SECTION */}
      {(focusSection === 'all' || focusSection === 'walls') && (
        <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
              Murs de la pièce
            </span>
            {hasPerWallOverrides && (
              <button
                type="button"
                onClick={() => updateRoomSurfaces({ clearWallColorOverrides: true })}
                className="inline-flex items-center gap-1 text-xs text-atelier-info hover:underline"
                title="Réinitialiser les murs d'accent à la couleur globale"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Unifier</span>
              </button>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-atelier-muted">Texture murale</span>
            <select
              data-testid="select-global-wall-material"
              value={currentWallMatId}
              onChange={(e) => updateRoomSurfaces({ allWallsMaterialId: e.target.value })}
              className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
            >
              {wallMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameFr}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-atelier-muted">Couleur globale</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs uppercase text-atelier-subtle">
                  {currentWallColor}
                </span>
                <input
                  type="color"
                  data-testid="wall-color-picker"
                  aria-label="Couleur des murs"
                  value={currentWallColor}
                  onChange={(e) => {
                    const hex = e.target.value;
                    runContinuousEdit(() => updateRoomSurfaces({ wallColor: hex }));
                  }}
                  onBlur={flushContinuousEdit}
                  className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                />
              </div>
            </div>

            <div className="grid grid-cols-8 gap-1">
              {WALL_COLOR_SWATCHES.map((sw) => {
                const active = currentWallColor.toLowerCase() === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    title={`${sw.labelFr} (${sw.hex})`}
                    onClick={() => updateRoomSurfaces({ wallColor: sw.hex })}
                    className={`h-5 w-full rounded border transition-transform hover:scale-110 ${
                      active
                        ? 'border-atelier-accent ring-1 ring-atelier-accent'
                        : 'border-atelier-border-strong'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* FLOOR SECTION */}
      {(focusSection === 'all' || focusSection === 'floor') && (
        <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
              Sol & Carrelage
            </span>
            {(doc.floorColorOverride || doc.floorGroutColor) && (
              <button
                type="button"
                onClick={() =>
                  updateRoomSurfaces({
                    floorColorOverride: undefined,
                    floorGroutColor: undefined,
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-atelier-muted hover:text-atelier-fg"
                title="Revenir aux couleurs par défaut du revêtement"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Défaut</span>
              </button>
            )}
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-atelier-muted">Style de revêtement</span>
            <select
              data-testid="select-floor-material"
              value={doc.floorMaterialId}
              onChange={(e) =>
                updateRoomSurfaces({
                  floorMaterialId: e.target.value,
                  floorColorOverride: undefined,
                  floorGroutColor: undefined,
                })
              }
              className="h-9 w-full rounded-md border border-atelier-border bg-atelier-panel px-2 text-atelier-fg"
            >
              {floorMaterials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nameFr}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-atelier-muted">Couleur / teinte du sol</span>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs uppercase text-atelier-subtle">
                  {currentFloorColor}
                </span>
                <input
                  type="color"
                  data-testid="floor-color-picker"
                  aria-label="Couleur du sol"
                  value={currentFloorColor}
                  onChange={(e) => {
                    const hex = e.target.value;
                    runContinuousEdit(() => updateRoomSurfaces({ floorColorOverride: hex }));
                  }}
                  onBlur={flushContinuousEdit}
                  className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                />
              </div>
            </div>

            <div className="grid grid-cols-9 gap-1">
              {FLOOR_COLOR_SWATCHES.map((sw) => {
                const active = currentFloorColor.toLowerCase() === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    title={`${sw.labelFr} (${sw.hex})`}
                    onClick={() => updateRoomSurfaces({ floorColorOverride: sw.hex })}
                    className={`h-5 w-full rounded border transition-transform hover:scale-110 ${
                      active
                        ? 'border-atelier-accent ring-1 ring-atelier-accent'
                        : 'border-atelier-border-strong'
                    }`}
                    style={{ backgroundColor: sw.hex }}
                  />
                );
              })}
            </div>
          </div>

          {hasGrout && (
            <div className="space-y-1.5 border-t border-atelier-border pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-atelier-muted">Couleur des joints</span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs uppercase text-atelier-subtle">
                    {currentGroutColor}
                  </span>
                  <input
                    type="color"
                    data-testid="floor-grout-picker"
                    aria-label="Couleur des joints"
                    value={currentGroutColor}
                    onChange={(e) => {
                      const hex = e.target.value;
                      runContinuousEdit(() => updateRoomSurfaces({ floorGroutColor: hex }));
                    }}
                    onBlur={flushContinuousEdit}
                    className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-5 gap-1">
                {GROUT_COLOR_SWATCHES.map((sw) => {
                  const active = currentGroutColor.toLowerCase() === sw.hex.toLowerCase();
                  return (
                    <button
                      key={sw.hex}
                      type="button"
                      title={`Joint ${sw.labelFr} (${sw.hex})`}
                      onClick={() => updateRoomSurfaces({ floorGroutColor: sw.hex })}
                      className={`h-5 w-full rounded border transition-transform hover:scale-105 ${
                        active
                          ? 'border-atelier-accent ring-1 ring-atelier-accent'
                          : 'border-atelier-border-strong'
                      }`}
                      style={{ backgroundColor: sw.hex }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* CUSTOM CABINET & COUNTERTOP COLORS */}
      {showCarpentryColors && (
        <div className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
              Couleurs sur-mesure (Meubles)
            </span>
            {(cp.facadeColorOverride || cp.carcassColorOverride || cp.countertopColorOverride) && (
              <button
                type="button"
                onClick={() =>
                  updateGlobalCarpentry({
                    facadeColorOverride: undefined,
                    carcassColorOverride: undefined,
                    countertopColorOverride: undefined,
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-atelier-muted hover:text-atelier-fg"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Réinit.</span>
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-atelier-muted">Façades laquées</span>
              <div className="flex items-center gap-1.5">
                {cp.facadeColorOverride && (
                  <button
                    type="button"
                    onClick={() => updateGlobalCarpentry({ facadeColorOverride: undefined })}
                    className="text-xs text-atelier-subtle hover:text-atelier-fg"
                  >
                    ✕
                  </button>
                )}
                <input
                  type="color"
                  data-testid="global-facade-color-picker"
                  aria-label="Couleur sur-mesure façades"
                  value={cp.facadeColorOverride ?? getMaterialById(cp.facadeMaterialId).colorHex}
                  onChange={(e) => {
                    const hex = e.target.value;
                    runContinuousEdit(() => updateGlobalCarpentry({ facadeColorOverride: hex }));
                  }}
                  onBlur={flushContinuousEdit}
                  className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
                />
              </div>
            </div>
            <div className="grid grid-cols-6 gap-1">
              {CABINET_COLOR_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  type="button"
                  title={`Façade ${sw.labelFr}`}
                  onClick={() => updateGlobalCarpentry({ facadeColorOverride: sw.hex })}
                  className={`h-5 w-full rounded border ${
                    cp.facadeColorOverride?.toLowerCase() === sw.hex.toLowerCase()
                      ? 'border-atelier-accent ring-1 ring-atelier-accent'
                      : 'border-atelier-border-strong'
                  }`}
                  style={{ backgroundColor: sw.hex }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-atelier-muted">Caissons</span>
            <div className="flex items-center gap-1.5">
              {cp.carcassColorOverride && (
                <button
                  type="button"
                  onClick={() => updateGlobalCarpentry({ carcassColorOverride: undefined })}
                  className="text-xs text-atelier-subtle hover:text-atelier-fg"
                >
                  ✕
                </button>
              )}
              <input
                type="color"
                data-testid="global-carcass-color-picker"
                aria-label="Couleur sur-mesure caissons"
                value={cp.carcassColorOverride ?? getMaterialById(cp.carcassMaterialId).colorHex}
                onChange={(e) => {
                  const hex = e.target.value;
                  runContinuousEdit(() => updateGlobalCarpentry({ carcassColorOverride: hex }));
                }}
                onBlur={flushContinuousEdit}
                className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-atelier-muted">Plans de travail</span>
            <div className="flex items-center gap-1.5">
              {cp.countertopColorOverride && (
                <button
                  type="button"
                  onClick={() => updateGlobalCarpentry({ countertopColorOverride: undefined })}
                  className="text-xs text-atelier-subtle hover:text-atelier-fg"
                >
                  ✕
                </button>
              )}
              <input
                type="color"
                data-testid="global-countertop-color-picker"
                aria-label="Couleur sur-mesure plan de travail"
                value={
                  cp.countertopColorOverride ?? getMaterialById(cp.countertopMaterialId).colorHex
                }
                onChange={(e) => {
                  const hex = e.target.value;
                  runContinuousEdit(() => updateGlobalCarpentry({ countertopColorOverride: hex }));
                }}
                onBlur={flushContinuousEdit}
                className="h-6 w-8 cursor-pointer rounded border border-atelier-border bg-transparent p-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
