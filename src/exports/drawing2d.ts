import type {
  DisplayUnit,
  ModuleInstance,
  ProjectDocument,
  RoomUtility,
  WallOpening,
  WallSegment,
} from '@/types';
import {
  analyzeWalls,
  computeRoomBounds,
  computeWallPolygon2D,
  elevUFromWallU,
  getModuleAxes2D,
  getModuleCorners2D,
  getWallElevationFrame,
  getWallInteriorSpanMm,
  projectModuleToWall,
  projectPointToWall,
  type WallMetrics,
} from '@/engine/geometry';
import { selectProjectModuleOutputs } from '@/store/selectors';
import { formatDim, roundMm } from '@/utils/units';

export interface DrawingLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}

export interface DrawingRect {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
  rotationDeg?: number;
  cx?: number;
  cy?: number;
  entityId?: string;
  entityKind?: 'wall' | 'opening' | 'utility' | 'module' | 'prop';
}

export interface DrawingPath {
  d: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed?: boolean;
}

export interface DrawingText {
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  bold?: boolean;
  rotationDeg?: number;
}

export interface DimensionLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  offsetMm: number;
  label: string;
  orientation: 'H' | 'V' | 'aligned';
}

export interface TechnicalDrawing2D {
  kind: 'plan' | 'elevation';
  titleFr: string;
  subtitleFr: string;
  viewBox: { x: number; y: number; width: number; height: number };
  lines: DrawingLine[];
  rects: DrawingRect[];
  paths: DrawingPath[];
  texts: DrawingText[];
  dimensions: DimensionLine[];
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatWallOpeningOnPlan(
  wall: WallSegment,
  wm: WallMetrics,
  opening: WallOpening,
  lines: DrawingLine[],
  paths: DrawingPath[],
  texts: DrawingText[],
  unit: DisplayUnit
): void {
  const halfT = wall.thicknessMm / 2;
  const uStart = opening.offsetFromStartMm;
  const uEnd = uStart + opening.widthMm;
  const p1 = {
    x: wm.start.x + wm.tangent.x * uStart,
    y: wm.start.z + wm.tangent.z * uStart,
  };
  const p2 = {
    x: wm.start.x + wm.tangent.x * uEnd,
    y: wm.start.z + wm.tangent.z * uEnd,
  };

  // Clear gap mask over wall
  lines.push({
    x1: p1.x,
    y1: p1.y,
    x2: p2.x,
    y2: p2.y,
    stroke: '#ffffff',
    strokeWidth: wall.thicknessMm + 8,
  });

  if (opening.kind === 'fenetre') {
    const nx = wm.inwardNormal.x * (halfT * 0.45);
    const ny = wm.inwardNormal.z * (halfT * 0.45);
    lines.push(
      { x1: p1.x + nx, y1: p1.y + ny, x2: p2.x + nx, y2: p2.y + ny, stroke: '#0284c7', strokeWidth: 12 },
      { x1: p1.x - nx, y1: p1.y - ny, x2: p2.x - nx, y2: p2.y - ny, stroke: '#0284c7', strokeWidth: 12 },
      { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, stroke: '#38bdf8', strokeWidth: 6 }
    );
  } else {
    // Door leaf + quarter-circle swing arc into the room (respecting hingeSide left/right)
    const r = opening.widthMm;
    const isRightHinge = opening.hingeSide === 'right';
    const hinge = isRightHinge ? p2 : p1;
    const latch = isRightHinge ? p1 : p2;
    const leafEnd = {
      x: hinge.x + wm.inwardNormal.x * r,
      y: hinge.y + wm.inwardNormal.z * r,
    };
    lines.push({
      x1: hinge.x,
      y1: hinge.y,
      x2: leafEnd.x,
      y2: leafEnd.y,
      stroke: '#b45309',
      strokeWidth: 18,
    });
    const cross =
      (latch.x - hinge.x) * (leafEnd.y - hinge.y) - (latch.y - hinge.y) * (leafEnd.x - hinge.x);
    const sweep = cross >= 0 ? 1 : 0;
    paths.push({
      d: `M ${roundMm(latch.x, 1)} ${roundMm(latch.y, 1)} A ${roundMm(r, 1)} ${roundMm(r, 1)} 0 0 ${sweep} ${roundMm(leafEnd.x, 1)} ${roundMm(leafEnd.y, 1)}`,
      fill: 'none',
      stroke: '#b45309',
      strokeWidth: 10,
      dashed: true,
    });
  }

  const midX = (p1.x + p2.x) / 2 + wm.inwardNormal.x * (halfT + 140);
  const midY = (p1.y + p2.y) / 2 + wm.inwardNormal.z * (halfT + 140);
  texts.push({
    x: midX,
    y: midY,
    text: `${opening.kind === 'porte' ? 'P' : 'F'} ${formatDim(opening.widthMm, unit)}`,
    fontSize: 75,
    fill: opening.kind === 'porte' ? '#92400e' : '#0369a1',
    anchor: 'middle',
  });
}

export function buildPlanDrawing2D(
  doc: ProjectDocument,
  displayUnit: DisplayUnit = 'mm'
): TechnicalDrawing2D {
  const lines: DrawingLine[] = [];
  const rects: DrawingRect[] = [];
  const paths: DrawingPath[] = [];
  const texts: DrawingText[] = [];
  const dimensions: DimensionLine[] = [];

  const bounds = computeRoomBounds(doc.walls, true);
  const pad = 650;
  const viewBox = {
    x: Math.floor(bounds.minX - pad),
    y: Math.floor(bounds.minZ - pad),
    width: Math.max(2000, Math.ceil(bounds.widthMm + pad * 2)),
    height: Math.max(1600, Math.ceil(bounds.depthMm + pad * 2)),
  };

  const wallMetricsList = analyzeWalls(doc.walls);
  const metricsById = new Map(wallMetricsList.map((wm) => [wm.wall.id, wm]));

  // 1. Walls (mitered 2D polygons with zero corner overlap) + net interior length dimension lines
  for (const wm of wallMetricsList) {
    const w = wm.wall;
    const poly = computeWallPolygon2D(wm, wallMetricsList);
    const span = getWallInteriorSpanMm(wm, wallMetricsList);
    paths.push({
      d: `M ${roundMm(poly[0].x, 1)} ${roundMm(poly[0].z, 1)} L ${roundMm(poly[1].x, 1)} ${roundMm(poly[1].z, 1)} L ${roundMm(poly[2].x, 1)} ${roundMm(poly[2].z, 1)} L ${roundMm(poly[3].x, 1)} ${roundMm(poly[3].z, 1)} Z`,
      fill: '#1e293b',
      stroke: '#0f172a',
      strokeWidth: 8,
    });

    // Net interior dimension line outside the room (-inwardNormal)
    const outDist = w.thicknessMm / 2 + 260;
    const ox = -wm.inwardNormal.x * outDist;
    const oy = -wm.inwardNormal.z * outDist;
    const p1x = wm.start.x + wm.tangent.x * span.startInsetMm + ox;
    const p1z = wm.start.z + wm.tangent.z * span.startInsetMm + oy;
    const p2x = wm.start.x + wm.tangent.x * (wm.lengthMm - span.endInsetMm) + ox;
    const p2z = wm.start.z + wm.tangent.z * (wm.lengthMm - span.endInsetMm) + oy;
    dimensions.push({
      x1: p1x,
      y1: p1z,
      x2: p2x,
      y2: p2z,
      offsetMm: 0,
      label: `${w.labelFr ? `${w.labelFr} : ` : ''}${formatDim(span.netLengthMm, displayUnit)}`,
      orientation: 'aligned',
    });
  }

  // 2. Openings
  for (const opening of doc.openings) {
    const wm = metricsById.get(opening.wallId);
    if (!wm) continue;
    formatWallOpeningOnPlan(wm.wall, wm, opening, lines, paths, texts, displayUnit);
  }

  // 3. Utilities
  for (const u of doc.utilities) {
    const fill =
      u.kind === 'poteau'
        ? '#cbd5e1'
        : u.kind === 'poutre'
          ? 'rgba(148,163,184,0.25)'
          : u.kind === 'prise'
            ? '#fef08a'
            : '#bae6fd';
    const stroke =
      u.kind === 'poteau' || u.kind === 'poutre'
        ? '#334155'
        : u.kind === 'prise'
          ? '#ca8a04'
          : '#0284c7';
    const w = Math.max(u.widthMm, 90);
    const d = Math.max(u.depthMm, 90);
    rects.push({
      x: u.xMm - w / 2,
      y: u.zMm - d / 2,
      width: w,
      height: d,
      fill,
      stroke,
      strokeWidth: 14,
      dashed: u.kind === 'poutre',
      entityId: u.id,
      entityKind: 'utility',
    });
    texts.push({
      x: u.xMm,
      y: u.zMm + d / 2 + 95,
      text: u.labelFr ?? u.kind,
      fontSize: 65,
      fill: stroke,
      anchor: 'middle',
    });
  }

  // 4. Modules
  for (const m of doc.modules) {
    const corners = getModuleCorners2D(m);
    const d = `M ${roundMm(corners[0].x, 1)} ${roundMm(corners[0].z, 1)} L ${roundMm(corners[1].x, 1)} ${roundMm(corners[1].z, 1)} L ${roundMm(corners[2].x, 1)} ${roundMm(corners[2].z, 1)} L ${roundMm(corners[3].x, 1)} ${roundMm(corners[3].z, 1)} Z`;
    const isWallHung = m.type === 'caisson_haut';
    paths.push({
      d,
      fill: isWallHung ? 'rgba(56, 189, 248, 0.18)' : 'rgba(217, 119, 6, 0.22)',
      stroke: isWallHung ? '#0284c7' : '#b45309',
      strokeWidth: 16,
      dashed: isWallHung,
    });
    // Front edge highlight (corners[2] -> corners[3])
    lines.push({
      x1: corners[2].x,
      y1: corners[2].z,
      x2: corners[3].x,
      y2: corners[3].z,
      stroke: isWallHung ? '#0369a1' : '#78350f',
      strokeWidth: 26,
    });
    texts.push(
      {
        x: m.xMm,
        y: m.zMm - 35,
        text: m.ref,
        fontSize: 95,
        fill: '#0f172a',
        anchor: 'middle',
        bold: true,
      },
      {
        x: m.xMm,
        y: m.zMm + 75,
        text: formatDim(m.widthMm, displayUnit),
        fontSize: 70,
        fill: '#334155',
        anchor: 'middle',
      }
    );
  }

  return {
    kind: 'plan',
    titleFr: `Plan 2D coté — ${doc.name}`,
    subtitleFr: `${doc.walls.length} murs · ${doc.modules.length} modules · HSP ${formatDim(doc.ceilingHeightMm, displayUnit)}`,
    viewBox,
    lines,
    rects,
    paths,
    texts,
    dimensions,
  };
}

export interface ProjectedElevationModule {
  module: ModuleInstance;
  uMinMm: number;
  uMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
}

export function getModulesForWallElevation(
  doc: ProjectDocument,
  wm: WallMetrics
): ProjectedElevationModule[] {
  const result: ProjectedElevationModule[] = [];
  for (const mod of doc.modules) {
    const proj = projectModuleToWall(wm, mod);
    const attached = mod.attachedWallId === wm.wall.id;
    const overlapsSpan = proj.uMaxMm > 5 && proj.uMinMm < wm.lengthMm - 5;
    const nearWall = proj.dMinMm <= wm.wall.thicknessMm / 2 + 120 && proj.dMaxMm >= -120;

    if (attached || (overlapsSpan && nearWall)) {
      const eA = elevUFromWallU(wm, proj.uMinMm);
      const eB = elevUFromWallU(wm, proj.uMaxMm);
      result.push({
        module: mod,
        uMinMm: Math.max(0, roundMm(Math.min(eA, eB), 1)),
        uMaxMm: Math.min(wm.lengthMm, roundMm(Math.max(eA, eB), 1)),
        yMinMm: roundMm(proj.yMinMm, 1),
        yMaxMm: roundMm(proj.yMaxMm, 1),
      });
    }
  }
  result.sort((a, b) => a.uMinMm - b.uMinMm || a.yMinMm - b.yMinMm);
  return result;
}

export function buildWallElevationDrawing2D(
  doc: ProjectDocument,
  wallId: string,
  displayUnit: DisplayUnit = 'mm'
): TechnicalDrawing2D {
  const wallMetricsList = analyzeWalls(doc.walls);
  const wm = wallMetricsList.find((item) => item.wall.id === wallId) ?? wallMetricsList[0];

  if (!wm) {
    return {
      kind: 'elevation',
      titleFr: `Élévation — ${doc.name}`,
      subtitleFr: 'Aucun mur défini',
      viewBox: { x: 0, y: 0, width: 2000, height: 1500 },
      lines: [],
      rects: [],
      paths: [],
      texts: [
        {
          x: 1000,
          y: 750,
          text: 'Aucun mur à afficher en élévation.',
          fontSize: 90,
          fill: '#64748b',
          anchor: 'middle',
        },
      ],
      dimensions: [],
    };
  }

  const wallLen = roundMm(wm.lengthMm, 1);
  const wallH = roundMm(wm.wall.heightMm, 1);
  const lines: DrawingLine[] = [];
  const rects: DrawingRect[] = [];
  const paths: DrawingPath[] = [];
  const texts: DrawingText[] = [];
  const dimensions: DimensionLine[] = [];

  const yToSvg = (yMm: number) => wallH - yMm;
  const { flippedAlongWall } = getWallElevationFrame(wm);
  const toElevU = (uWallMm: number) => (flippedAlongWall ? wallLen - uWallMm : uWallMm);

  const wallSpan = getWallInteriorSpanMm(wm, wallMetricsList);
  const eInA = toElevU(wallSpan.startInsetMm);
  const eInB = toElevU(wallLen - wallSpan.endInsetMm);
  const uInStart = Math.max(0, Math.min(wallLen, Math.min(eInA, eInB)));
  const uInEnd = Math.max(uInStart, Math.min(wallLen, Math.max(eInA, eInB)));
  const netLen = Math.max(0, roundMm(uInEnd - uInStart, 1));

  // Wall outline rectangle (full centerline elevation) + return perpendicular wall cuts at left/right corners
  rects.push({
    x: 0,
    y: 0,
    width: wallLen,
    height: wallH,
    fill: '#f8fafc',
    stroke: '#1e293b',
    strokeWidth: 20,
    entityId: wm.wall.id,
    entityKind: 'wall',
  });
  if (uInStart > 2) {
    rects.push({
      x: 0,
      y: 0,
      width: uInStart,
      height: wallH,
      fill: 'rgba(148, 163, 184, 0.32)',
      stroke: '#64748b',
      strokeWidth: 10,
      dashed: true,
    });
  }
  if (wallLen - uInEnd > 2) {
    rects.push({
      x: uInEnd,
      y: 0,
      width: wallLen - uInEnd,
      height: wallH,
      fill: 'rgba(148, 163, 184, 0.32)',
      stroke: '#64748b',
      strokeWidth: 10,
      dashed: true,
    });
  }

  // Floor & ceiling reference lines
  lines.push(
    { x1: -200, y1: wallH, x2: wallLen + 200, y2: wallH, stroke: '#0f172a', strokeWidth: 26 },
    { x1: -100, y1: 0, x2: wallLen + 100, y2: 0, stroke: '#475569', strokeWidth: 14, dashed: true }
  );

  // Openings on this wall: CW/CCW invariant position, exact measurements, and mur<->ouverture distances
  const wallOpenings = doc.openings.filter((o) => o.wallId === wm.wall.id);
  const openingElevRanges: Array<{ id: string; kind: 'porte' | 'fenetre'; uMin: number; uMax: number; yMin: number }> = [];

  for (const op of wallOpenings) {
    const eOpA = toElevU(op.offsetFromStartMm);
    const eOpB = toElevU(op.offsetFromStartMm + op.widthMm);
    const opMin = Math.min(eOpA, eOpB);
    const opMax = Math.max(eOpA, eOpB);
    const topY = yToSvg(op.sillHeightMm + op.heightMm);

    openingElevRanges.push({
      id: op.id,
      kind: op.kind,
      uMin: Math.max(uInStart, opMin),
      uMax: Math.min(uInEnd, opMax),
      yMin: op.sillHeightMm,
    });

    const leftClearMm = Math.max(0, Math.round(opMin - uInStart));
    const rightClearMm = Math.max(0, Math.round(uInEnd - opMax));
    const dimBandY =
      op.kind === 'fenetre'
        ? Math.min(wallH - 130, topY + op.heightMm + 110)
        : Math.max(240, wallH - 360);

    if (leftClearMm >= 10) {
      dimensions.push({
        x1: uInStart,
        y1: dimBandY,
        x2: opMin,
        y2: dimBandY,
        offsetMm: 0,
        label: formatDim(leftClearMm, displayUnit),
        orientation: 'H',
      });
    }
    if (rightClearMm >= 10) {
      dimensions.push({
        x1: opMax,
        y1: dimBandY,
        x2: uInEnd,
        y2: dimBandY,
        offsetMm: 0,
        label: formatDim(rightClearMm, displayUnit),
        orientation: 'H',
      });
    }

    rects.push({
      x: opMin,
      y: topY,
      width: op.widthMm,
      height: op.heightMm,
      fill: op.kind === 'fenetre' ? 'rgba(186, 230, 253, 0.55)' : 'rgba(254, 243, 199, 0.6)',
      stroke: op.kind === 'fenetre' ? '#0284c7' : '#b45309',
      strokeWidth: 16,
      entityId: op.id,
      entityKind: 'opening',
    });

    if (op.kind === 'fenetre') {
      lines.push(
        {
          x1: opMin + op.widthMm / 2,
          y1: topY,
          x2: opMin + op.widthMm / 2,
          y2: topY + op.heightMm,
          stroke: '#0284c7',
          strokeWidth: 10,
        },
        {
          x1: opMin,
          y1: topY + op.heightMm / 2,
          x2: opMin + op.widthMm,
          y2: topY + op.heightMm / 2,
          stroke: '#0284c7',
          strokeWidth: 8,
        }
      );
    } else {
      lines.push(
        {
          x1: opMin,
          y1: topY,
          x2: opMin + op.widthMm,
          y2: topY + op.heightMm / 2,
          stroke: '#b45309',
          strokeWidth: 8,
          dashed: true,
        },
        {
          x1: opMin,
          y1: topY + op.heightMm,
          x2: opMin + op.widthMm,
          y2: topY + op.heightMm / 2,
          stroke: '#b45309',
          strokeWidth: 8,
          dashed: true,
        }
      );
    }

    texts.push({
      x: opMin + op.widthMm / 2,
      y: topY + op.heightMm / 2,
      text: `${op.labelFr ?? (op.kind === 'porte' ? 'Porte' : 'Fenêtre')} (${formatDim(op.widthMm, displayUnit, false)}×${formatDim(op.heightMm, displayUnit)})`,
      fontSize: 64,
      fill: '#0f172a',
      anchor: 'middle',
      bold: true,
    });
    if (op.sillHeightMm > 20) {
      texts.push({
        x: opMin + op.widthMm / 2,
        y: topY + op.heightMm - 55,
        text: `Allège ${formatDim(op.sillHeightMm, displayUnit)}`,
        fontSize: 52,
        fill: '#0369a1',
        anchor: 'middle',
      });
    }
  }

  // Utilities projected onto this wall (transformed into invariant elevation X)
  const wallUtilities: Array<{ u: RoomUtility; uCoord: number }> = [];
  for (const util of doc.utilities) {
    const proj = projectPointToWall(wm, { x: util.xMm, z: util.zMm });
    if (
      util.wallId === wm.wall.id ||
      (proj.distanceToSegmentMm <= wm.wall.thicknessMm / 2 + 260 &&
        proj.uRawMm >= -100 &&
        proj.uRawMm <= wallLen + 100)
    ) {
      wallUtilities.push({ u: util, uCoord: toElevU(proj.uClampedMm) });
    }
  }

  for (const { u, uCoord } of wallUtilities) {
    const w = Math.max(u.widthMm, 80);
    const h = Math.max(u.heightMm, 80);
    const topY = yToSvg(u.yMm + h);
    rects.push({
      x: uCoord - w / 2,
      y: topY,
      width: w,
      height: h,
      fill: u.kind === 'prise' ? '#fef08a' : u.kind === 'arrivee_eau' ? '#bae6fd' : '#e2e8f0',
      stroke: u.kind === 'prise' ? '#ca8a04' : u.kind === 'arrivee_eau' ? '#0284c7' : '#475569',
      strokeWidth: 12,
      entityId: u.id,
      entityKind: 'utility',
    });
  }

  // Modules projected onto this wall
  const outputs = selectProjectModuleOutputs(doc);
  const projectedModules = getModulesForWallElevation(doc, wm);

  const uniqueHeights = new Set<number>();

  for (const pm of projectedModules) {
    const mod = pm.module;
    const modW = Math.max(10, pm.uMaxMm - pm.uMinMm);
    const modH = Math.max(10, pm.yMaxMm - pm.yMinMm);
    const topY = yToSvg(pm.yMaxMm);

    const isCountertop = mod.type === 'plan_de_travail';
    const isCredence = mod.type === 'credence';
    const isWallHung =
      mod.type === 'caisson_haut' ||
      mod.type === 'meuble_haut_vitre' ||
      mod.type === 'caisson_haut_angle' ||
      mod.type === 'caisson_haut_angle_aveugle' ||
      mod.type === 'caisson_sur_frigo' ||
      mod.type === 'caisson_haut_relevant' ||
      mod.type === 'armoire_miroir_led';

    rects.push({
      x: pm.uMinMm,
      y: topY,
      width: modW,
      height: modH,
      fill: isCountertop
        ? '#94a3b8'
        : isCredence
          ? '#cbd5e1'
          : isWallHung
            ? 'rgba(251, 191, 36, 0.25)'
            : 'rgba(217, 119, 6, 0.24)',
      stroke: isCountertop ? '#334155' : '#92400e',
      strokeWidth: 16,
      entityId: mod.id,
      entityKind: 'module',
    });

    // Draw front-facing parametric facade sub-panels using transformed world coordinates (m2)
    const out = outputs.get(mod.id);
    if (out) {
      const { axisX: modX, axisZ: modZ } = getModuleAxes2D(mod.rotationYRad);
      for (const panel of out.panels) {
        if (
          panel.role !== 'porte' &&
          panel.role !== 'tiroir_facade' &&
          panel.role !== 'plinthe'
        ) {
          continue;
        }
        const totalRotY = mod.rotationYRad + (panel.rotationRad[1] ?? 0);
        const { axisZ: panelFront } = getModuleAxes2D(totalRotY);
        const frontDot = panelFront.x * wm.inwardNormal.x + panelFront.z * wm.inwardNormal.z;
        if (frontDot <= 0.7) continue;

        const wx = mod.xMm + panel.positionMm[0] * modX.x + panel.positionMm[2] * modZ.x;
        const wz = mod.zMm + panel.positionMm[0] * modX.z + panel.positionMm[2] * modZ.z;
        const panelProj = projectPointToWall(wm, { x: wx, z: wz });
        const panelCenterElev = toElevU(panelProj.uRawMm);
        const px = panelCenterElev - panel.widthMm / 2;
        const pyTop = yToSvg(mod.yMm + panel.positionMm[1] + panel.heightMm / 2);
        rects.push({
          x: px,
          y: pyTop,
          width: panel.widthMm,
          height: panel.heightMm,
          fill: panel.role === 'plinthe' ? 'rgba(51, 65, 85, 0.35)' : 'rgba(254, 243, 199, 0.55)',
          stroke: panel.role === 'plinthe' ? '#334155' : '#b45309',
          strokeWidth: 8,
          entityId: mod.id,
          entityKind: 'module',
        });
      }
    }

    if (modH >= 120 && modW >= 180) {
      texts.push(
        {
          x: pm.uMinMm + modW / 2,
          y: topY + modH / 2 - 40,
          text: mod.ref,
          fontSize: 85,
          fill: '#0f172a',
          anchor: 'middle',
          bold: true,
        },
        {
          x: pm.uMinMm + modW / 2,
          y: topY + modH / 2 + 55,
          text: `${formatDim(mod.widthMm, displayUnit, false)}×${formatDim(mod.heightMm, displayUnit)}`,
          fontSize: 62,
          fill: '#334155',
          anchor: 'middle',
        }
      );
    }

    if (pm.yMinMm > 0) uniqueHeights.add(pm.yMinMm);
    if (pm.yMaxMm > 0 && pm.yMaxMm < wallH) uniqueHeights.add(pm.yMaxMm);
  }

  // Props (Électroménager, Éclairage & Déco) projected onto this wall with exact dimensions + wall distances
  const projectedProps: Array<{ id: string; uMin: number; uMax: number; yMin: number; yMax: number; widthMm: number }> = [];
  for (const prop of doc.props ?? []) {
    const proj = projectModuleToWall(wm, prop);
    const matchesWall =
      prop.attachedWallId === wm.wall.id ||
      (proj.dMinMm <= wm.wall.thicknessMm / 2 + 450 &&
        proj.uMaxMm > 0 &&
        proj.uMinMm < wallLen);
    if (!matchesWall) continue;

    const ePA = toElevU(proj.uMinMm);
    const ePB = toElevU(proj.uMaxMm);
    const uMin = Math.max(0, Math.min(ePA, ePB));
    const uMax = Math.min(wallLen, Math.max(ePA, ePB));
    const propW = Math.max(20, uMax - uMin);
    const propH = Math.max(20, prop.heightMm);
    const topY = yToSvg(prop.yMm + prop.heightMm);

    projectedProps.push({
      id: prop.id,
      uMin: Math.max(uInStart, uMin),
      uMax: Math.min(uInEnd, uMax),
      yMin: prop.yMm,
      yMax: prop.yMm + prop.heightMm,
      widthMm: prop.widthMm,
    });

    rects.push({
      x: uMin,
      y: topY,
      width: propW,
      height: propH,
      fill:
        prop.category === 'eclairage_deco'
          ? 'rgba(250, 204, 21, 0.22)'
          : 'rgba(14, 165, 233, 0.22)',
      stroke: prop.category === 'eclairage_deco' ? '#ca8a04' : '#0284c7',
      strokeWidth: 14,
      entityId: prop.id,
      entityKind: 'prop',
    });

    if (propH >= 90 && propW >= 120) {
      texts.push(
        {
          x: uMin + propW / 2,
          y: topY + propH / 2 - 28,
          text: `${prop.ref} ${prop.nameFr.split(' ')[0]}`,
          fontSize: 64,
          fill: '#0369a1',
          anchor: 'middle',
          bold: true,
        },
        {
          x: uMin + propW / 2,
          y: topY + propH / 2 + 42,
          text: `${formatDim(prop.widthMm, displayUnit, false)}×${formatDim(prop.heightMm, displayUnit)}`,
          fontSize: 54,
          fill: '#0c4a6e',
          anchor: 'middle',
        }
      );
    }

    // For elevated wall-mounted decor / appliances (e.g. hotte, TV, applique), also annotate mur<->prop distance if no overlapping upper chain
    const leftClearProp = Math.max(0, Math.round(uMin - uInStart));
    const rightClearProp = Math.max(0, Math.round(uInEnd - uMax));
    if (prop.yMm >= 600 && prop.yMm < 1200) {
      const bandY = topY + propH / 2;
      if (leftClearProp >= 20) {
        dimensions.push({
          x1: uInStart,
          y1: bandY,
          x2: uMin,
          y2: bandY,
          offsetMm: 0,
          label: formatDim(leftClearProp, displayUnit),
          orientation: 'H',
        });
      }
      if (rightClearProp >= 20) {
        dimensions.push({
          x1: uMax,
          y1: bandY,
          x2: uInEnd,
          y2: bandY,
          offsetMm: 0,
          label: formatDim(rightClearProp, displayUnit),
          orientation: 'H',
        });
      }
    }

    if (prop.yMm > 0) uniqueHeights.add(prop.yMm);
    if (prop.yMm + prop.heightMm > 0 && prop.yMm + prop.heightMm < wallH) {
      uniqueHeights.add(prop.yMm + prop.heightMm);
    }
  }

  // Helper emitting complete Tier 1 chain (wall -> gaps + items -> wall) summing strictly to netLen (C3)
  const emitHorizontalChain = (
    items: Array<{ uMin: number; uMax: number; labelMm?: number }>,
    yBase: number,
    offsetMm: number
  ) => {
    const sorted = items
      .map((it) => ({
        uMin: Math.max(uInStart, Math.min(uInEnd, it.uMin)),
        uMax: Math.max(uInStart, Math.min(uInEnd, it.uMax)),
        labelMm: it.labelMm,
      }))
      .filter((it) => it.uMax - it.uMin >= 10)
      .sort((a, b) => a.uMin - b.uMin);

    if (sorted.length === 0) return;

    let cursor = uInStart;
    for (const seg of sorted) {
      if (seg.uMin < cursor - 5) continue; // skip overlapping/secondary projections
      const gap = Math.round(seg.uMin - cursor);
      if (gap >= 5) {
        dimensions.push({
          x1: cursor,
          y1: yBase,
          x2: seg.uMin,
          y2: yBase,
          offsetMm,
          label: formatDim(gap, displayUnit),
          orientation: 'H',
        });
      }
      const wSpan = seg.labelMm ?? Math.round(seg.uMax - seg.uMin);
      dimensions.push({
        x1: seg.uMin,
        y1: yBase,
        x2: seg.uMax,
        y2: yBase,
        offsetMm,
        label: formatDim(wSpan, displayUnit),
        orientation: 'H',
      });
      cursor = seg.uMax;
    }

    const trailingGap = Math.round(uInEnd - cursor);
    if (trailingGap >= 5) {
      dimensions.push({
        x1: cursor,
        y1: yBase,
        x2: uInEnd,
        y2: yBase,
        offsetMm,
        label: formatDim(trailingGap, displayUnit),
        orientation: 'H',
      });
    }
  };

  // Tier 1 (bottom floor chain): base/tall cabinets + doors + floor props + wall clearances
  const floorChainItems: Array<{ uMin: number; uMax: number; labelMm?: number }> = [
    ...projectedModules
      .filter((pm) => pm.module.type !== 'plan_de_travail' && pm.module.type !== 'credence' && pm.yMinMm < 1200)
      .map((pm) => ({ uMin: pm.uMinMm, uMax: pm.uMaxMm, labelMm: pm.module.widthMm })),
    ...openingElevRanges
      .filter((o) => o.yMin < 1200)
      .map((o) => ({ uMin: o.uMin, uMax: o.uMax })),
    ...projectedProps
      .filter((p) => p.yMin < 1200)
      .map((p) => ({ uMin: p.uMin, uMax: p.uMax, labelMm: p.widthMm })),
  ];
  emitHorizontalChain(floorChainItems, wallH, 220);

  // Tier 1b (top ceiling chain): wall-hung cabinets + wall-mounted upper props + wall clearances
  const upperChainItems: Array<{ uMin: number; uMax: number; labelMm?: number }> = [
    ...projectedModules
      .filter((pm) => pm.yMinMm >= 1200)
      .map((pm) => ({ uMin: pm.uMinMm, uMax: pm.uMaxMm, labelMm: pm.module.widthMm })),
    ...projectedProps
      .filter((p) => p.yMin >= 1200)
      .map((p) => ({ uMin: p.uMin, uMax: p.uMax, labelMm: p.widthMm })),
  ];
  emitHorizontalChain(upperChainItems, 0, -190);

  // Tier 2: Net interior face-to-face wall span
  if (netLen > 0) {
    dimensions.push({
      x1: uInStart,
      y1: wallH,
      x2: uInEnd,
      y2: wallH,
      offsetMm: 420,
      label: formatDim(netLen, displayUnit),
      orientation: 'H',
    });
  }

  // Tier 3: Centerline overall wall length when joined walls subtract corner thickness
  if (uInStart > 2 || wallLen - uInEnd > 2 || netLen <= 0) {
    dimensions.push({
      x1: 0,
      y1: wallH,
      x2: wallLen,
      y2: wallH,
      offsetMm: 600,
      label: formatDim(wallLen, displayUnit),
      orientation: 'H',
    });
  }

  // Vertical cotations (right side of wall)
  const sortedLevels = [0, ...Array.from(uniqueHeights).sort((a, b) => a - b), wallH];
  // Deduplicate levels closer than 35 mm to prevent overlapping dimension labels
  const cleanLevels: number[] = [0];
  for (let i = 1; i < sortedLevels.length; i++) {
    const lvl = sortedLevels[i];
    if (lvl - cleanLevels[cleanLevels.length - 1] >= 35) {
      cleanLevels.push(lvl);
    }
  }
  if (cleanLevels[cleanLevels.length - 1] !== wallH) {
    cleanLevels[cleanLevels.length - 1] = wallH;
  }

  for (let i = 0; i < cleanLevels.length - 1; i++) {
    const yLow = cleanLevels[i];
    const yHigh = cleanLevels[i + 1];
    dimensions.push({
      x1: wallLen,
      y1: yToSvg(yLow),
      x2: wallLen,
      y2: yToSvg(yHigh),
      offsetMm: 220,
      label: formatDim(yHigh - yLow, displayUnit),
      orientation: 'V',
    });
  }

  // Overall ceiling height (outer vertical tier)
  dimensions.push({
    x1: wallLen,
    y1: wallH,
    x2: wallLen,
    y2: 0,
    offsetMm: 450,
    label: formatDim(wallH, displayUnit),
    orientation: 'V',
  });

  const viewBox = {
    x: -360,
    y: -380,
    width: wallLen + 1060,
    height: wallH + 1140,
  };

  return {
    kind: 'elevation',
    titleFr: `Élévation — ${wm.wall.labelFr ?? wm.wall.id}`,
    subtitleFr: `Cote nette ${formatDim(netLen, displayUnit)} (mur ${formatDim(wallLen, displayUnit)}) · Hauteur ${formatDim(wallH, displayUnit)} · ${projectedModules.length} module(s)`,
    viewBox,
    lines,
    rects,
    paths,
    texts,
    dimensions,
  };
}

function renderDimensionSvg(dim: DimensionLine): string {
  const parts: string[] = [];
  if (dim.orientation === 'H') {
    const y = dim.y1 + dim.offsetMm;
    parts.push(
      `<line x1="${roundMm(dim.x1, 1)}" y1="${roundMm(dim.y1, 1)}" x2="${roundMm(dim.x1, 1)}" y2="${roundMm(y, 1)}" stroke="#64748b" stroke-width="6" />`,
      `<line x1="${roundMm(dim.x2, 1)}" y1="${roundMm(dim.y2, 1)}" x2="${roundMm(dim.x2, 1)}" y2="${roundMm(y, 1)}" stroke="#64748b" stroke-width="6" />`,
      `<line x1="${roundMm(dim.x1, 1)}" y1="${roundMm(y, 1)}" x2="${roundMm(dim.x2, 1)}" y2="${roundMm(y, 1)}" stroke="#0f172a" stroke-width="9" />`,
      `<text x="${roundMm((dim.x1 + dim.x2) / 2, 1)}" y="${roundMm(y - 26, 1)}" text-anchor="middle" font-size="78" font-family="sans-serif" font-weight="600" fill="#0f172a">${escapeXml(dim.label)}</text>`
    );
  } else if (dim.orientation === 'V') {
    const x = dim.x1 + dim.offsetMm;
    const midY = (dim.y1 + dim.y2) / 2;
    parts.push(
      `<line x1="${roundMm(dim.x1, 1)}" y1="${roundMm(dim.y1, 1)}" x2="${roundMm(x, 1)}" y2="${roundMm(dim.y1, 1)}" stroke="#64748b" stroke-width="6" />`,
      `<line x1="${roundMm(dim.x2, 1)}" y1="${roundMm(dim.y2, 1)}" x2="${roundMm(x, 1)}" y2="${roundMm(dim.y2, 1)}" stroke="#64748b" stroke-width="6" />`,
      `<line x1="${roundMm(x, 1)}" y1="${roundMm(dim.y1, 1)}" x2="${roundMm(x, 1)}" y2="${roundMm(dim.y2, 1)}" stroke="#0f172a" stroke-width="9" />`,
      `<text x="${roundMm(x + 28, 1)}" y="${roundMm(midY, 1)}" text-anchor="start" dominant-baseline="central" font-size="74" font-family="sans-serif" font-weight="600" fill="#0f172a">${escapeXml(dim.label)}</text>`
    );
  } else {
    const midX = (dim.x1 + dim.x2) / 2;
    const midY = (dim.y1 + dim.y2) / 2;
    let angleDeg = (Math.atan2(dim.y2 - dim.y1, dim.x2 - dim.x1) * 180) / Math.PI;
    if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;
    parts.push(
      `<line x1="${roundMm(dim.x1, 1)}" y1="${roundMm(dim.y1, 1)}" x2="${roundMm(dim.x2, 1)}" y2="${roundMm(dim.y2, 1)}" stroke="#0f172a" stroke-width="9" />`,
      `<text x="${roundMm(midX, 1)}" y="${roundMm(midY - 30, 1)}" text-anchor="middle" font-size="78" font-family="sans-serif" font-weight="600" fill="#0f172a" transform="rotate(${roundMm(angleDeg, 1)} ${roundMm(midX, 1)} ${roundMm(midY, 1)})">${escapeXml(dim.label)}</text>`
    );
  }
  return parts.join('\n');
}

export function renderDrawing2DToSvg(drawing: TechnicalDrawing2D): string {
  const { x, y, width, height } = drawing.viewBox;
  const headerH = Math.max(240, Math.round(height * 0.09));
  const totalH = height + headerH;

  const elements: string[] = [];

  // Background
  elements.push(
    `<rect x="${x}" y="${y - headerH}" width="${width}" height="${totalH}" fill="#ffffff" />`
  );

  // Cartouche / title block
  elements.push(
    `<rect x="${x}" y="${y - headerH}" width="${width}" height="${headerH}" fill="#0f172a" />`,
    `<text x="${x + 80}" y="${y - headerH * 0.56}" font-size="${Math.round(headerH * 0.32)}" font-family="sans-serif" font-weight="700" fill="#fbbf24">${escapeXml(drawing.titleFr)}</text>`,
    `<text x="${x + 80}" y="${y - headerH * 0.2}" font-size="${Math.round(headerH * 0.22)}" font-family="sans-serif" fill="#cbd5e1">${escapeXml(drawing.subtitleFr)} — Atelier3D Studio</text>`
  );

  for (const r of drawing.rects) {
    const dash = r.dashed ? ' stroke-dasharray="32 20"' : '';
    const tr =
      r.rotationDeg && r.cx !== undefined && r.cy !== undefined
        ? ` transform="rotate(${roundMm(r.rotationDeg, 1)} ${roundMm(r.cx, 1)} ${roundMm(r.cy, 1)})"`
        : '';
    elements.push(
      `<rect x="${roundMm(r.x, 1)}" y="${roundMm(r.y, 1)}" width="${roundMm(r.width, 1)}" height="${roundMm(r.height, 1)}" fill="${r.fill}" stroke="${r.stroke}" stroke-width="${r.strokeWidth}"${dash}${tr} />`
    );
  }

  for (const p of drawing.paths) {
    const dash = p.dashed ? ' stroke-dasharray="28 18"' : '';
    elements.push(
      `<path d="${p.d}" fill="${p.fill}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}"${dash} />`
    );
  }

  for (const l of drawing.lines) {
    const dash = l.dashed ? ' stroke-dasharray="28 18"' : '';
    elements.push(
      `<line x1="${roundMm(l.x1, 1)}" y1="${roundMm(l.y1, 1)}" x2="${roundMm(l.x2, 1)}" y2="${roundMm(l.y2, 1)}" stroke="${l.stroke}" stroke-width="${l.strokeWidth}" stroke-linecap="square"${dash} />`
    );
  }

  for (const dim of drawing.dimensions) {
    elements.push(renderDimensionSvg(dim));
  }

  for (const t of drawing.texts) {
    const weight = t.bold ? '700' : '400';
    const anchor = t.anchor ?? 'middle';
    const tr = t.rotationDeg
      ? ` transform="rotate(${roundMm(t.rotationDeg, 1)} ${roundMm(t.x, 1)} ${roundMm(t.y, 1)})"`
      : '';
    elements.push(
      `<text x="${roundMm(t.x, 1)}" y="${roundMm(t.y, 1)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${t.fontSize}" font-family="sans-serif" font-weight="${weight}" fill="${t.fill}"${tr}>${escapeXml(t.text)}</text>`
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y - headerH} ${width} ${totalH}" width="1400" height="${Math.round((1400 * totalH) / width)}">`,
    ...elements,
    '</svg>',
  ].join('\n');
}
