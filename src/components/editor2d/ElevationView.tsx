import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileCode, FileText } from 'lucide-react';
import {
  analyzeWalls,
  elevUFromWallU,
  getWallInteriorSpanMm,
  normalToRotationYRad,
  projectModuleToWall,
  snapModulePosition,
  wallUFromElevU,
} from '@/engine/geometry';
import { buildWallElevationDrawing2D } from '@/exports/drawing2d';
import { FR } from '@/i18n/fr';
import { selectActiveWall } from '@/store/selectors';
import { pauseHistory, resumeHistory, useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { formatDim, roundMm } from '@/utils/units';

interface ElevationDragState {
  entityKind: 'module' | 'prop';
  entityId: string;
  wallId: string;
  startClientX: number;
  startClientY: number;
  offsetU: number;
  offsetY: number;
  dCenterMm: number;
  allowVertical: boolean;
  moved: boolean;
}

export function ElevationView() {
  const doc = useProjectStore((s) => s.document);
  const updateModule = useProjectStore((s) => s.updateModule);
  const updateProp = useProjectStore((s) => s.updateProp);
  const setDocument = useProjectStore((s) => s.setDocument);

  const activeWallId = useUIStore((s) => s.activeWallId);
  const setActiveWallId = useUIStore((s) => s.setActiveWallId);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectEntity = useUIStore((s) => s.selectEntity);
  const toggleSelectEntity = useUIStore((s) => s.toggleSelectEntity);
  const displayUnit = useUIStore((s) => s.displayUnit);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<ElevationDragState | null>(null);
  const [draggingModId, setDraggingModId] = useState<string | null>(null);

  // Resume Zundo history if unmounted mid-drag
  useEffect(() => {
    return () => {
      if (dragRef.current?.moved) {
        resumeHistory();
      }
      dragRef.current = null;
    };
  }, []);
  const [dragHud, setDragHud] = useState<{
    uLeftMm: number;
    uRightMm: number;
    yMm: number;
    snapU?: number;
    snapY?: number;
  } | null>(null);

  const activeWall = selectActiveWall(doc, activeWallId);
  const wallMetricsList = useMemo(() => analyzeWalls(doc.walls), [doc.walls]);
  const activeWm = useMemo(
    () =>
      wallMetricsList.find((wm) => wm.wall.id === activeWall?.id) ??
      wallMetricsList[0] ??
      null,
    [wallMetricsList, activeWall?.id]
  );

  const drawing = useMemo(
    () => buildWallElevationDrawing2D(doc, activeWall?.id ?? '', displayUnit),
    [doc, activeWall?.id, displayUnit]
  );

  const { x, y, width, height } = drawing.viewBox;

  const clientToSvgMm = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const svg = svgRef.current;
      if (!svg) return [0, 0];
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [0, 0];

      const scale = Math.min(rect.width / width, rect.height / height);
      const renderedW = width * scale;
      const renderedH = height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      const sx = x + (clientX - rect.left - offsetX) / scale;
      const sy = y + (clientY - rect.top - offsetY) / scale;
      return [sx, sy];
    },
    [x, y, width, height]
  );

  const handleEntityPointerDown = (
    e: React.PointerEvent<SVGRectElement>,
    entityKind: 'module' | 'prop',
    entityId: string
  ) => {
    if (e.button !== 0 || !activeWm) return;
    e.stopPropagation();
    if (e.shiftKey) {
      toggleSelectEntity(entityId, entityKind);
      return;
    }
    selectEntity(entityId, entityKind);

    const entity =
      entityKind === 'module'
        ? doc.modules.find((m) => m.id === entityId)
        : (doc.props ?? []).find((p) => p.id === entityId);
    if (!entity) return;

    const proj = projectModuleToWall(activeWm, entity);
    const eA = elevUFromWallU(activeWm, proj.uMinMm);
    const eB = elevUFromWallU(activeWm, proj.uMaxMm);
    const uCenter = (eA + eB) / 2;
    const dCenter = (proj.dMinMm + proj.dMaxMm) / 2;
    const [svgX, svgY] = clientToSvgMm(e.clientX, e.clientY);
    const wallH = activeWm.wall.heightMm;
    const ptrY = wallH - svgY;

    const allowVertical =
      entityKind === 'prop' ||
      entity.type === 'caisson_haut' ||
      entity.type === 'meuble_haut_vitre' ||
      entity.type === 'caisson_haut_angle' ||
      entity.type === 'armoire_miroir_led' ||
      entity.type === 'meuble_vasque' ||
      entity.type === 'meuble_double_vasque' ||
      entity.type === 'colonne_sdb' ||
      entity.type === 'credence' ||
      entity.type === 'plan_de_travail';

    dragRef.current = {
      entityKind,
      entityId,
      wallId: activeWm.wall.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      offsetU: uCenter - svgX,
      offsetY: entity.yMm - ptrY,
      dCenterMm: Math.max(activeWm.wall.thicknessMm / 2 + entity.depthMm / 2, dCenter),
      allowVertical,
      moved: false,
    };

    try {
      svgRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable in synthetic test events
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !activeWm || drag.wallId !== activeWm.wall.id) return;

    const [svgX, svgY] = clientToSvgMm(e.clientX, e.clientY);
    const wallLen = activeWm.lengthMm;
    const wallH = activeWm.wall.heightMm;
    const span = getWallInteriorSpanMm(activeWm, wallMetricsList);
    const eInA = elevUFromWallU(activeWm, span.startInsetMm);
    const eInB = elevUFromWallU(activeWm, wallLen - span.endInsetMm);
    const uInStart = Math.max(0, Math.min(wallLen, Math.min(eInA, eInB)));
    const uInEnd = Math.max(uInStart, Math.min(wallLen, Math.max(eInA, eInB)));

    if (drag.entityKind === 'prop') {
      const prop = (doc.props ?? []).find((p) => p.id === drag.entityId);
      if (!prop) return;
      if (!drag.moved) {
        const distPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
        if (distPx < 4) return;
        pauseHistory();
        drag.moved = true;
        setDraggingModId(prop.id);
      }

      const halfW = prop.widthMm / 2;
      const minElevU = Math.min(uInStart + halfW, (uInStart + uInEnd) / 2);
      const maxElevU = Math.max(uInEnd - halfW, (uInStart + uInEnd) / 2);
      const rawElevU = Math.round((svgX + drag.offsetU) / 10) * 10;
      let clampedElevU = Math.max(minElevU, Math.min(maxElevU, rawElevU));
      if (Math.abs(clampedElevU - minElevU) <= 50) clampedElevU = minElevU;
      else if (Math.abs(clampedElevU - maxElevU) <= 50) clampedElevU = maxElevU;

      const rawWallU = wallUFromElevU(activeWm, clampedElevU);
      const nextY = Math.max(
        0,
        Math.min(
          Math.max(0, wallH - prop.heightMm),
          Math.round((wallH - svgY + drag.offsetY) / 10) * 10
        )
      );
      const wallOffset = activeWm.wall.thicknessMm / 2 + prop.depthMm / 2 + 6;
      const finalX = roundMm(
        activeWm.start.x + activeWm.tangent.x * rawWallU + activeWm.inwardNormal.x * wallOffset,
        0
      );
      const finalZ = roundMm(
        activeWm.start.z + activeWm.tangent.z * rawWallU + activeWm.inwardNormal.z * wallOffset,
        0
      );
      updateProp(prop.id, {
        xMm: finalX,
        yMm: nextY,
        zMm: finalZ,
        rotationYRad: normalToRotationYRad(activeWm.inwardNormal),
        attachedWallId: activeWm.wall.id,
      });
      setDragHud({
        uLeftMm: Math.max(0, Math.round(clampedElevU - halfW - uInStart)),
        uRightMm: Math.max(0, Math.round(uInEnd - (clampedElevU + halfW))),
        yMm: Math.round(nextY),
      });
      return;
    }

    const mod = doc.modules.find((m) => m.id === drag.entityId);
    if (!mod) return;

    if (!drag.moved) {
      const distPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (distPx < 4) return;
      pauseHistory();
      drag.moved = true;
      setDraggingModId(mod.id);
    }

    const halfW = mod.widthMm / 2;

    // Raw horizontal u in invariant Elevation frame (10 mm step, clamped inside net interior span)
    const rawElevU = Math.round((svgX + drag.offsetU) / 10) * 10;
    const minU = Math.min(uInStart + halfW, (uInStart + uInEnd) / 2);
    const maxU = Math.max(uInEnd - halfW, (uInStart + uInEnd) / 2);
    let elevU = Math.max(minU, Math.min(maxU, rawElevU));

    // Snap cleanly to net interior corner walls within 60 mm
    let snapU: number | undefined;
    if (Math.abs(elevU - minU) <= 60) {
      elevU = minU;
      snapU = uInStart;
    } else if (Math.abs(elevU - maxU) <= 60) {
      elevU = maxU;
      snapU = uInEnd;
    }

    const rawY = drag.allowVertical
      ? Math.max(
          0,
          Math.min(
            Math.max(0, wallH - mod.heightMm),
            Math.round((wallH - svgY + drag.offsetY) / 10) * 10
          )
        )
      : mod.yMm;

    const wallU = wallUFromElevU(activeWm, elevU);
    const wallOffset = activeWm.wall.thicknessMm / 2 + mod.depthMm / 2;
    const candX =
      activeWm.start.x +
      activeWm.tangent.x * wallU +
      activeWm.inwardNormal.x * wallOffset;
    const candZ =
      activeWm.start.z +
      activeWm.tangent.z * wallU +
      activeWm.inwardNormal.z * wallOffset;

    const snapped = snapModulePosition(
      {
        ...mod,
        xMm: candX,
        yMm: rawY,
        zMm: candZ,
        rotationYRad: normalToRotationYRad(activeWm.inwardNormal),
        attachedWallId: activeWm.wall.id,
      },
      doc.walls,
      doc.modules,
      { ceilingHeightMm: doc.ceilingHeightMm }
    );

    // Keep module projected onto this wall in invariant Elevation frame
    const finalProj = projectModuleToWall(activeWm, {
      ...mod,
      xMm: snapped.xMm,
      yMm: snapped.yMm,
      zMm: snapped.zMm,
      rotationYRad: snapped.rotationYRad,
    });
    const finalElevUCenter =
      (elevUFromWallU(activeWm, finalProj.uMinMm) +
        elevUFromWallU(activeWm, finalProj.uMaxMm)) /
      2;
    const clampedElevU = Math.max(minU, Math.min(maxU, finalElevUCenter));
    const clampedWallU = wallUFromElevU(activeWm, clampedElevU);
    const finalX = roundMm(
      activeWm.start.x +
        activeWm.tangent.x * clampedWallU +
        activeWm.inwardNormal.x * wallOffset,
      0
    );
    const finalZ = roundMm(
      activeWm.start.z +
        activeWm.tangent.z * clampedWallU +
        activeWm.inwardNormal.z * wallOffset,
      0
    );

    const hasCabinetGuide = snapped.guides.some((g) => g.kind === 'cabinet_flush');
    const hasVerticalGuide = snapped.guides.some((g) => g.kind === 'vertical');

    updateModule(mod.id, {
      xMm: finalX,
      yMm: snapped.yMm,
      zMm: finalZ,
      rotationYRad: normalToRotationYRad(activeWm.inwardNormal),
      attachedWallId: activeWm.wall.id,
    });

    setDragHud({
      uLeftMm: Math.max(0, Math.round(clampedElevU - halfW - uInStart)),
      uRightMm: Math.max(0, Math.round(uInEnd - (clampedElevU + halfW))),
      yMm: Math.round(snapped.yMm),
      snapU: hasCabinetGuide ? clampedElevU : snapU,
      snapY: hasVerticalGuide ? snapped.yMm : undefined,
    });
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      if (svgRef.current?.hasPointerCapture(e.pointerId)) {
        svgRef.current.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore
    }
    if (drag.moved) {
      resumeHistory();
      setDocument({ ...useProjectStore.getState().document });
    }
    dragRef.current = null;
    setDraggingModId(null);
    setDragHud(null);
  };

  const activeWallH = activeWm?.wall.heightMm ?? 2500;
  const activeWallLen = activeWm?.lengthMm ?? 4000;

  return (
    <div
      data-testid="viewport-2d-elevation"
      className="flex h-full w-full flex-col overflow-hidden bg-atelier-viewport p-3 select-none"
    >
      {/* Wall Selector & Quick Export */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-atelier-accent-text">
            {FR.viewport.elevation2dTitle}
          </span>
          <span className="text-xs text-atelier-muted">{FR.viewport.selectWallPrompt}</span>
          {doc.walls.map((w) => {
            const active = activeWall?.id === w.id;
            return (
              <button
                key={w.id}
                type="button"
                data-testid={`wall-selector-${w.id}`}
                onClick={() => setActiveWallId(w.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-atelier-accent text-atelier-accent-fg'
                    : 'border border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
                }`}
              >
                {w.labelFr ?? w.id}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          {dragHud && (
            <span className="rounded border border-amber-500/60 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-atelier-accent-text tabular-nums">
              Mur G : {formatDim(dragHud.uLeftMm, displayUnit)} · Mur D : {formatDim(dragHud.uRightMm, displayUnit)} · Y : {formatDim(dragHud.yMm, displayUnit)}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              void import('@/exports/planExport').then((m) => m.exportElevationSvg(activeWall?.id))
            }
            className="inline-flex items-center gap-1 rounded border border-atelier-border bg-atelier-panel px-2.5 py-1 text-xs text-atelier-fg hover:border-atelier-accent"
          >
            <FileCode className="h-3.5 w-3.5 text-atelier-info" />
            <span>SVG</span>
          </button>
          <button
            type="button"
            onClick={() =>
              void import('@/exports/planExport').then((m) => m.exportElevationPdf())
            }
            className="inline-flex items-center gap-1 rounded border border-atelier-border bg-atelier-panel px-2.5 py-1 text-xs text-atelier-fg hover:border-atelier-accent"
          >
            <FileText className="h-3.5 w-3.5 text-atelier-accent-text" />
            <span>PDF</span>
          </button>
        </div>
      </div>

      {/* Interactive Elevation SVG Canvas */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-atelier-border bg-white">
        <svg
          ref={svgRef}
          viewBox={`${x} ${y} ${width} ${height}`}
          style={{ touchAction: 'none' }}
          className={`h-full w-full touch-none ${draggingModId ? 'cursor-grabbing' : ''}`}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
        >
          {/* Rectangles (Wall, Openings, Utilities, Modules, Parametric Facades, Props) */}
          {drawing.rects.map((r, idx) => {
            const isSelected = Boolean(r.entityId && selectedIds.includes(r.entityId));
            const isModule = r.entityKind === 'module' && Boolean(r.entityId);
            const isProp = r.entityKind === 'prop' && Boolean(r.entityId);
            const isDraggable = isModule || isProp;
            const isDraggingThis = isDraggable && r.entityId === draggingModId;
            return (
              <rect
                key={`r-${idx}`}
                x={r.x}
                y={r.y}
                width={r.width}
                height={r.height}
                fill={r.fill}
                stroke={isDraggingThis ? '#ea580c' : isSelected ? '#d97706' : r.stroke}
                strokeWidth={isSelected ? r.strokeWidth * 1.6 : r.strokeWidth}
                strokeDasharray={r.dashed ? '30 20' : undefined}
                data-elevation-module-id={isModule ? r.entityId : undefined}
                data-elevation-prop-id={isProp ? r.entityId : undefined}
                className={
                  isDraggable
                    ? isDraggingThis
                      ? 'cursor-grabbing'
                      : 'cursor-grab'
                    : r.entityId
                      ? 'cursor-pointer'
                      : undefined
                }
                onPointerDown={(e) => {
                  if (isModule && r.entityId) {
                    handleEntityPointerDown(e, 'module', r.entityId);
                  } else if (isProp && r.entityId) {
                    handleEntityPointerDown(e, 'prop', r.entityId);
                  }
                }}
                onClick={() => {
                  if (r.entityId && r.entityKind) {
                    selectEntity(r.entityId, r.entityKind);
                  }
                }}
              />
            );
          })}

          {/* Live Magnetic Snap Guides during Elevation Drag */}
          {dragHud?.snapU !== undefined && (
            <line
              x1={dragHud.snapU}
              y1={-120}
              x2={dragHud.snapU}
              y2={activeWallH + 120}
              stroke="#0284c7"
              strokeWidth={14}
              strokeDasharray="36 22"
              pointerEvents="none"
            />
          )}
          {dragHud?.snapY !== undefined && (
            <line
              x1={-120}
              y1={activeWallH - dragHud.snapY}
              x2={activeWallLen + 120}
              y2={activeWallH - dragHud.snapY}
              stroke="#10b981"
              strokeWidth={14}
              strokeDasharray="36 22"
              pointerEvents="none"
            />
          )}

          {/* Lines */}
          {drawing.lines.map((l, idx) => (
            <line
              key={`l-${idx}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={l.stroke}
              strokeWidth={l.strokeWidth}
              strokeDasharray={l.dashed ? '28 18' : undefined}
              pointerEvents="none"
            />
          ))}

          {/* Multi-tier Cotations */}
          {drawing.dimensions.map((dim, idx) => {
            if (dim.orientation === 'H') {
              const dy = dim.y1 + dim.offsetMm;
              return (
                <g key={`d-${idx}`} pointerEvents="none">
                  <line
                    x1={dim.x1}
                    y1={dim.y1}
                    x2={dim.x1}
                    y2={dy}
                    stroke="#64748b"
                    strokeWidth={6}
                  />
                  <line
                    x1={dim.x2}
                    y1={dim.y2}
                    x2={dim.x2}
                    y2={dy}
                    stroke="#64748b"
                    strokeWidth={6}
                  />
                  <line
                    x1={dim.x1}
                    y1={dy}
                    x2={dim.x2}
                    y2={dy}
                    stroke="#0f172a"
                    strokeWidth={10}
                  />
                  <circle cx={dim.x1} cy={dy} r={16} fill="#0f172a" />
                  <circle cx={dim.x2} cy={dy} r={16} fill="#0f172a" />
                  <text
                    x={(dim.x1 + dim.x2) / 2}
                    y={dy - 28}
                    textAnchor="middle"
                    fill="#0f172a"
                    fontSize={76}
                    fontWeight={700}
                  >
                    {dim.label}
                  </text>
                </g>
              );
            }
            const dx = dim.x1 + dim.offsetMm;
            const midY = (dim.y1 + dim.y2) / 2;
            return (
              <g key={`d-${idx}`} pointerEvents="none">
                <line
                  x1={dim.x1}
                  y1={dim.y1}
                  x2={dx}
                  y2={dim.y1}
                  stroke="#64748b"
                  strokeWidth={6}
                />
                <line
                  x1={dim.x2}
                  y1={dim.y2}
                  x2={dx}
                  y2={dim.y2}
                  stroke="#64748b"
                  strokeWidth={6}
                />
                <line
                  x1={dx}
                  y1={dim.y1}
                  x2={dx}
                  y2={dim.y2}
                  stroke="#0f172a"
                  strokeWidth={10}
                />
                <circle cx={dx} cy={dim.y1} r={16} fill="#0f172a" />
                <circle cx={dx} cy={dim.y2} r={16} fill="#0f172a" />
                <text
                  x={dx + 28}
                  y={midY}
                  textAnchor="start"
                  dominantBaseline="central"
                  fill="#0f172a"
                  fontSize={72}
                  fontWeight={700}
                >
                  {dim.label}
                </text>
              </g>
            );
          })}

          {/* Labels */}
          {drawing.texts.map((t, idx) => (
            <text
              key={`t-${idx}`}
              x={t.x}
              y={t.y}
              textAnchor={t.anchor ?? 'middle'}
              dominantBaseline="central"
              fill={t.fill}
              fontSize={t.fontSize}
              fontWeight={t.bold ? 700 : 400}
              pointerEvents="none"
            >
              {t.text}
            </text>
          ))}
        </svg>
      </div>

      {/* Footer info */}
      <div className="mt-1.5 flex items-center justify-between text-xs text-atelier-muted">
        <span>
          {drawing.titleFr} · Glisser un module pour déplacer le long du mur (et en hauteur pour les
          caissons hauts)
        </span>
        <span className="tabular-nums">{drawing.subtitleFr}</span>
      </div>
    </div>
  );
}
