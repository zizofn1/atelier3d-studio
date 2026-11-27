import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileText, Layers, Loader2 } from 'lucide-react';
import type { NestingRunResult, PlacedPiece } from '@/types';
import { DEFAULT_NESTING_CONFIG, STANDARD_SHEET_PRESETS } from '@/data/defaultPricing';
import { getMaterialById } from '@/data/materialsCatalog';
import { cutlistToNestingPieces } from '@/engine/devis';
import type { NestingWorkerResponse } from '@/engine/nesting/nestingWorker';
import { FR } from '@/i18n/fr';
import { selectCutlist, selectNesting } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';

const CUSTOM_PRESET_ID = 'custom';

export function NestingView() {
  const doc = useProjectStore((s) => s.document);
  const updateNestingConfig = useProjectStore((s) => s.updateNestingConfig);

  const config = doc.nestingConfig ?? DEFAULT_NESTING_CONFIG;
  const cutlist = useMemo(() => selectCutlist(doc), [doc]);
  const pieces = useMemo(() => cutlistToNestingPieces(cutlist), [cutlist]);

  // True Web Worker offloading: zero synchronous double-compute on the main thread when Worker is available
  const [workerNesting, setWorkerNesting] = useState<NestingRunResult | null>(null);
  const [workerFailed, setWorkerFailed] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const reqIdRef = useRef(0);

  const supportsWorker =
    typeof window !== 'undefined' &&
    typeof Worker !== 'undefined' &&
    !('happyDOM' in window);

  useEffect(() => {
    if (!supportsWorker) return;
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../../engine/nesting/nestingWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (ev: MessageEvent<NestingWorkerResponse>) => {
        if (ev.data.requestId === reqIdRef.current) {
          setWorkerNesting(ev.data.result);
          setIsComputing(false);
        }
      };
      worker.onerror = () => {
        setIsComputing(false);
        setWorkerFailed(true);
      };
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
      setWorkerFailed(true);
    }
    return () => {
      worker?.terminate();
      workerRef.current = null;
    };
  }, [supportsWorker]);

  useEffect(() => {
    if (!supportsWorker || workerFailed || !workerRef.current) return;
    reqIdRef.current += 1;
    setIsComputing(true);
    workerRef.current.postMessage({
      requestId: reqIdRef.current,
      pieces,
      config,
    });
  }, [supportsWorker, workerFailed, pieces, config]);

  const useSyncFallback = !supportsWorker || workerFailed;
  const syncFallback = useMemo(
    () => (useSyncFallback ? selectNesting(doc) : null),
    [useSyncFallback, doc]
  );
  const emptyNesting: NestingRunResult = useMemo(
    () => ({
      config,
      groups: [],
      totalSheets: 0,
      overallWastePercent: 0,
      unplacedCount: 0,
    }),
    [config]
  );
  const nesting = workerNesting ?? syncFallback ?? emptyNesting;

  const [hoveredPiece, setHoveredPiece] = useState<{
    sheetLabel: string;
    piece: PlacedPiece;
  } | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const currentPresetValue = config.sheet.isCustom ? CUSTOM_PRESET_ID : config.sheet.id;

  const handlePresetChange = (presetId: string) => {
    if (presetId === CUSTOM_PRESET_ID) {
      updateNestingConfig({
        sheet: {
          id: CUSTOM_PRESET_ID,
          labelFr: `Format personnalisé ${config.sheet.widthMm} × ${config.sheet.heightMm} mm`,
          widthMm: config.sheet.widthMm,
          heightMm: config.sheet.heightMm,
          isCustom: true,
        },
      });
      return;
    }
    const found = STANDARD_SHEET_PRESETS.find((s) => s.id === presetId);
    if (found) {
      updateNestingConfig({ sheet: { ...found, isCustom: false } });
    }
  };

  const handleCustomSheetDim = (axis: 'widthMm' | 'heightMm', raw: string) => {
    const num = Number(raw.replace(',', '.'));
    if (!Number.isFinite(num) || num < 200) return;
    const widthMm = axis === 'widthMm' ? Math.round(num) : config.sheet.widthMm;
    const heightMm = axis === 'heightMm' ? Math.round(num) : config.sheet.heightMm;
    updateNestingConfig({
      sheet: {
        id: CUSTOM_PRESET_ID,
        labelFr: `Format personnalisé ${widthMm} × ${heightMm} mm`,
        widthMm,
        heightMm,
        isCustom: true,
      },
    });
  };

  const handleUniformTrim = (raw: string) => {
    const num = Number(raw.replace(',', '.'));
    if (!Number.isFinite(num) || num < 0) return;
    const trim = Math.min(200, Math.round(num));
    updateNestingConfig({
      trimTopMm: trim,
      trimBottomMm: trim,
      trimLeftMm: trim,
      trimRightMm: trim,
    });
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const { exportNestingPdf } = await import('@/exports/atelierExports');
      await exportNestingPdf(workerNesting ?? undefined);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      data-testid="atelier-nesting-view"
      className="flex h-full w-full flex-col overflow-hidden bg-atelier-bg p-4"
    >
      {/* Controls & KPI Bar */}
      <div className="mb-3 space-y-3 rounded-xl border border-atelier-border bg-atelier-panel p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-sm font-semibold text-atelier-accent-text">
              {FR.tabs.nesting} — Optimiseur de découpe 2D guillotine
            </h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-atelier-muted tabular-nums">
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-atelier-accent-text" />
                <strong className="text-atelier-fg">{nesting.totalSheets}</strong> feuilles requises (
                {config.sheet.widthMm} × {config.sheet.heightMm} mm)
              </span>
              <span>·</span>
              <span>
                Taux de chute global :{' '}
                <strong className="text-atelier-accent-text">
                  {nesting.overallWastePercent.toFixed(1).replace('.', ',')} %
                </strong>
              </span>
              {isComputing && (
                <>
                  <span>·</span>
                  <span
                    data-testid="nesting-computing-indicator"
                    className="inline-flex items-center gap-1 font-medium text-atelier-info"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Optimisation en cours…</span>
                  </span>
                </>
              )}
              {nesting.unplacedCount > 0 && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1 font-medium text-atelier-danger">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {nesting.unplacedCount} pièce(s) hors format
                  </span>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="export-nesting-pdf"
            disabled={exportingPdf}
            onClick={() => void handleExportPdf()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Exporter Calepinage PDF</span>
          </button>
        </div>

        <div className="grid grid-cols-2 items-end gap-2.5 text-xs md:grid-cols-6">
          <label className="col-span-2 block space-y-1">
            <span className="text-atelier-muted">Format panneau</span>
            <select
              value={currentPresetValue}
              onChange={(e) => handlePresetChange(e.target.value)}
              className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
            >
              {STANDARD_SHEET_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.labelFr}
                </option>
              ))}
              <option value={CUSTOM_PRESET_ID}>Format personnalisé</option>
            </select>
          </label>

          {config.sheet.isCustom && (
            <>
              <label className="block space-y-1">
                <span className="text-atelier-muted">Longueur feuille (mm)</span>
                <input
                  type="number"
                  min={200}
                  max={6000}
                  defaultValue={config.sheet.widthMm}
                  key={`sw-${config.sheet.widthMm}`}
                  onBlur={(e) => handleCustomSheetDim('widthMm', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCustomSheetDim('widthMm', (e.target as HTMLInputElement).value);
                    }
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-atelier-muted">Largeur feuille (mm)</span>
                <input
                  type="number"
                  min={200}
                  max={4000}
                  defaultValue={config.sheet.heightMm}
                  key={`sh-${config.sheet.heightMm}`}
                  onBlur={(e) => handleCustomSheetDim('heightMm', e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleCustomSheetDim('heightMm', (e.target as HTMLInputElement).value);
                    }
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
                />
              </label>
            </>
          )}

          <label className="block space-y-1">
            <span className="text-atelier-muted">{FR.carpentry.parts.traitDeScie} (mm)</span>
            <input
              type="number"
              min={0}
              max={20}
              step={0.5}
              defaultValue={config.kerfMm}
              key={`kerf-${config.kerfMm}`}
              onBlur={(e) => {
                const v = Number(e.target.value.replace(',', '.'));
                if (Number.isFinite(v) && v >= 0) updateNestingConfig({ kerfMm: v });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = Number((e.target as HTMLInputElement).value.replace(',', '.'));
                  if (Number.isFinite(v) && v >= 0) updateNestingConfig({ kerfMm: v });
                }
              }}
              className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-atelier-muted">{FR.carpentry.parts.delignage} (mm)</span>
            <input
              type="number"
              min={0}
              max={200}
              defaultValue={config.trimLeftMm}
              key={`trim-${config.trimLeftMm}`}
              onBlur={(e) => handleUniformTrim(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleUniformTrim((e.target as HTMLInputElement).value);
                }
              }}
              className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
            />
          </label>

          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-atelier-border bg-atelier-surface-2 px-2.5 text-atelier-fg">
            <input
              type="checkbox"
              checked={config.respectGrain}
              onChange={(e) => updateNestingConfig({ respectGrain: e.target.checked })}
              className="accent-atelier-accent"
            />
            <span>Respecter le sens du fil</span>
          </label>
        </div>
      </div>

      {/* Hovered/Tapped piece status bar */}
      {hoveredPiece && (
        <div className="mb-2 flex items-center justify-between rounded-lg border border-atelier-accent/40 bg-atelier-accent/15 px-3 py-1.5 text-xs text-atelier-accent-text">
          <span>
            <strong>{hoveredPiece.piece.pieceId}</strong> — {hoveredPiece.piece.moduleRef} ·{' '}
            {hoveredPiece.piece.partNameFr}
          </span>
          <span className="tabular-nums">
            {Math.round(hoveredPiece.piece.widthMm)} × {Math.round(hoveredPiece.piece.heightMm)} mm ·
            Pos. ({Math.round(hoveredPiece.piece.xMm)}, {Math.round(hoveredPiece.piece.yMm)}) mm ·
            Fil : {FR.carpentry.grainDirections[hoveredPiece.piece.grain]}
            {hoveredPiece.piece.rotated ? ' · Rotation 90°' : ''}
          </span>
        </div>
      )}

      {/* Sheets Grid */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {isComputing && nesting.groups.length === 0 && pieces.length > 0 ? (
          <div
            role="status"
            data-testid="nesting-worker-loading"
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-atelier-border bg-atelier-panel p-10 text-center text-xs text-atelier-muted"
          >
            <Loader2 className="h-5 w-5 animate-spin text-atelier-accent-text" />
            <div className="font-semibold text-atelier-accent-text">Optimisation en cours…</div>
            <div className="text-xs text-atelier-subtle">
              Calcul du calepinage guillotine ({pieces.length} pièces) en tâche de fond.
            </div>
          </div>
        ) : nesting.groups.length === 0 ? (
          <div className="rounded-xl border border-atelier-border bg-atelier-panel p-8 text-center text-xs text-atelier-subtle">
            Aucune pièce à optimiser. Placez des modules dans la vue Conception.
          </div>
        ) : (
          nesting.groups.map((group) => {
            const mat = getMaterialById(group.materialId);
            return (
              <section
                key={`${group.materialId}-${group.thicknessMm}`}
                className="space-y-3 rounded-xl border border-atelier-border bg-atelier-panel p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-atelier-border pb-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded border border-atelier-border-strong"
                      style={{ backgroundColor: mat.colorHex }}
                    />
                    <span className="text-xs font-semibold text-atelier-fg">
                      {mat.nameFr} — Épaisseur {group.thicknessMm} mm
                    </span>
                  </div>
                  <div className="text-xs text-atelier-muted tabular-nums">
                    {group.sheets.length} feuille(s) · {group.totalPieces} pièces · Taux de chute :{' '}
                    <span className="font-semibold text-atelier-accent-text">
                      {group.totalWastePercent.toFixed(1).replace('.', ',')} %
                    </span>
                  </div>
                </div>

                {group.unplacedPieceIds.length > 0 && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/12 px-3 py-2 text-xs text-atelier-danger">
                    Pièces dépassant le format utile de la feuille :{' '}
                    {group.unplacedPieceIds.join(', ')}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {group.sheets.map((sheet) => {
                    const sheetLabel = `${mat.nameFr} #${sheet.sheetIndex + 1}`;
                    return (
                      <div
                        key={sheet.sheetIndex}
                        className="space-y-2 rounded-lg border border-atelier-border bg-atelier-surface-2 p-2.5"
                      >
                        <div className="flex items-center justify-between text-xs text-atelier-muted tabular-nums">
                          <span className="font-semibold text-atelier-fg">
                            Feuille {sheet.sheetIndex + 1} / {group.sheets.length} (
                            {sheet.sheetWidthMm} × {sheet.sheetHeightMm} mm)
                          </span>
                          <span>
                            {sheet.placements.length} pièces · Taux de chute :{' '}
                            <strong className="text-atelier-accent-text">
                              {sheet.wastePercent.toFixed(1).replace('.', ',')} %
                            </strong>
                          </span>
                        </div>

                        <svg
                          viewBox={`0 0 ${sheet.sheetWidthMm} ${sheet.sheetHeightMm}`}
                          className="h-auto max-h-[340px] w-full rounded border border-atelier-border bg-atelier-viewport"
                        >
                          {/* Full sheet */}
                          <rect
                            x={0}
                            y={0}
                            width={sheet.sheetWidthMm}
                            height={sheet.sheetHeightMm}
                            fill="#1e293b"
                          />
                          {/* Usable trimmed zone */}
                          <rect
                            x={config.trimLeftMm}
                            y={config.trimTopMm}
                            width={Math.max(
                              0,
                              sheet.sheetWidthMm - config.trimLeftMm - config.trimRightMm
                            )}
                            height={Math.max(
                              0,
                              sheet.sheetHeightMm - config.trimTopMm - config.trimBottomMm
                            )}
                            fill="#0f172a"
                            stroke="#475569"
                            strokeWidth={6}
                            strokeDasharray="18 10"
                          />

                          {/* Guillotine cut lines */}
                          {sheet.cutLines.map((c, idx) =>
                            c.orientation === 'H' ? (
                              <line
                                key={`c-${idx}`}
                                x1={c.startMm}
                                y1={c.coordMm}
                                x2={c.endMm}
                                y2={c.coordMm}
                                stroke="#ef4444"
                                strokeWidth={Math.max(3, config.kerfMm)}
                                strokeOpacity={0.5}
                              />
                            ) : (
                              <line
                                key={`c-${idx}`}
                                x1={c.coordMm}
                                y1={c.startMm}
                                x2={c.coordMm}
                                y2={c.endMm}
                                stroke="#ef4444"
                                strokeWidth={Math.max(3, config.kerfMm)}
                                strokeOpacity={0.5}
                              />
                            )
                          )}

                          {/* Pieces */}
                          {sheet.placements.map((p) => {
                            const inset = Math.min(14, p.widthMm * 0.08, p.heightMm * 0.08);
                            const fontSize = Math.max(
                              28,
                              Math.min(62, Math.min(p.widthMm / 7, p.heightMm / 2.6))
                            );
                            const edgeColor = (code: string) =>
                              code === '2' ? '#38bdf8' : code === '0.4' ? '#34d399' : 'none';
                            return (
                              <g
                                key={p.pieceId}
                                className="cursor-pointer"
                                onMouseEnter={() => setHoveredPiece({ sheetLabel, piece: p })}
                                onMouseLeave={() => setHoveredPiece(null)}
                              >
                                <rect
                                  x={p.xMm}
                                  y={p.yMm}
                                  width={p.widthMm}
                                  height={p.heightMm}
                                  fill="rgba(217, 119, 6, 0.32)"
                                  stroke="#f59e0b"
                                  strokeWidth={6}
                                />
                                {/* Edge banding indicators */}
                                {p.edges.top !== 'none' && (
                                  <line
                                    x1={p.xMm + inset}
                                    y1={p.yMm + inset}
                                    x2={p.xMm + p.widthMm - inset}
                                    y2={p.yMm + inset}
                                    stroke={edgeColor(p.edges.top)}
                                    strokeWidth={p.edges.top === '2' ? 14 : 8}
                                  />
                                )}
                                {p.edges.bottom !== 'none' && (
                                  <line
                                    x1={p.xMm + inset}
                                    y1={p.yMm + p.heightMm - inset}
                                    x2={p.xMm + p.widthMm - inset}
                                    y2={p.yMm + p.heightMm - inset}
                                    stroke={edgeColor(p.edges.bottom)}
                                    strokeWidth={p.edges.bottom === '2' ? 14 : 8}
                                  />
                                )}
                                {p.edges.left !== 'none' && (
                                  <line
                                    x1={p.xMm + inset}
                                    y1={p.yMm + inset}
                                    x2={p.xMm + inset}
                                    y2={p.yMm + p.heightMm - inset}
                                    stroke={edgeColor(p.edges.left)}
                                    strokeWidth={p.edges.left === '2' ? 14 : 8}
                                  />
                                )}
                                {p.edges.right !== 'none' && (
                                  <line
                                    x1={p.xMm + p.widthMm - inset}
                                    y1={p.yMm + inset}
                                    x2={p.xMm + p.widthMm - inset}
                                    y2={p.yMm + p.heightMm - inset}
                                    stroke={edgeColor(p.edges.right)}
                                    strokeWidth={p.edges.right === '2' ? 14 : 8}
                                  />
                                )}
                                {p.widthMm >= 140 && p.heightMm >= 70 && (
                                  <>
                                    <text
                                      x={p.xMm + p.widthMm / 2}
                                      y={p.yMm + p.heightMm / 2 - fontSize * 0.25}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      fill="#f8fafc"
                                      fontSize={fontSize}
                                      fontWeight={700}
                                    >
                                      {p.moduleRef} · {p.partNameFr.slice(0, 14)}
                                    </text>
                                    <text
                                      x={p.xMm + p.widthMm / 2}
                                      y={p.yMm + p.heightMm / 2 + fontSize * 0.75}
                                      textAnchor="middle"
                                      dominantBaseline="central"
                                      fill="#fde68a"
                                      fontSize={fontSize * 0.8}
                                    >
                                      {Math.round(p.widthMm)}×{Math.round(p.heightMm)}
                                      {p.rotated ? ' ↻' : ''}
                                    </text>
                                  </>
                                )}
                              </g>
                            );
                          })}
                        </svg>

                        <div className="flex items-center gap-4 text-xs text-atelier-muted">
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-1.5 w-4 bg-sky-400" />
                            Chant 2 mm
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-1.5 w-4 bg-emerald-400" />
                            Chant 0,4 mm
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-1.5 w-4 bg-red-500/70" />
                            Trait de scie ({config.kerfMm} mm)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
