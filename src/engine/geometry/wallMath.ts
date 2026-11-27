import type { ModuleInstance, WallSegment } from '@/types';

export interface Point2D {
  x: number;
  z: number;
}

export interface WallMetrics {
  wall: WallSegment;
  start: Point2D;
  end: Point2D;
  midpoint: Point2D;
  lengthMm: number;
  tangent: Point2D;
  leftNormal: Point2D;
  rightNormal: Point2D;
  inwardNormal: Point2D;
  hasPolygonOrientation: boolean;
}

export interface RoomPolygon {
  points: Point2D[];
  signedAreaMm2: number;
  isClosed: boolean;
}

export interface RoomBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  widthMm: number;
  depthMm: number;
  center: Point2D;
}

export interface PointWallProjection {
  uRawMm: number;
  uClampedMm: number;
  closestPoint: Point2D;
  distanceToSegmentMm: number;
  signedInwardDistanceMm: number;
}

export interface ModuleWallProjection {
  uMinMm: number;
  uMaxMm: number;
  dMinMm: number;
  dMaxMm: number;
  yMinMm: number;
  yMaxMm: number;
}

const ENDPOINT_TOL_MM = 2;

export function normalizeZero(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Object.is(n, -0) || Math.abs(n) < 1e-12 ? 0 : n;
}

export function normalToRotationYRad(normal: Point2D): number {
  return normalizeZero(Math.atan2(normal.x, normal.z));
}

export function getModuleAxes2D(rotationYRad: number): {
  axisX: Point2D;
  axisZ: Point2D;
} {
  const c = Math.cos(rotationYRad);
  const s = Math.sin(rotationYRad);
  return {
    axisX: { x: normalizeZero(c), z: normalizeZero(-s) },
    axisZ: { x: normalizeZero(s), z: normalizeZero(c) },
  };
}

export function getModuleCorners2D(
  mod: Pick<ModuleInstance, 'xMm' | 'zMm' | 'widthMm' | 'depthMm' | 'rotationYRad'>
): [Point2D, Point2D, Point2D, Point2D] {
  const { axisX, axisZ } = getModuleAxes2D(mod.rotationYRad);
  const hw = mod.widthMm / 2;
  const hd = mod.depthMm / 2;

  return [
    {
      x: mod.xMm - hw * axisX.x - hd * axisZ.x,
      z: mod.zMm - hw * axisX.z - hd * axisZ.z,
    },
    {
      x: mod.xMm + hw * axisX.x - hd * axisZ.x,
      z: mod.zMm + hw * axisX.z - hd * axisZ.z,
    },
    {
      x: mod.xMm + hw * axisX.x + hd * axisZ.x,
      z: mod.zMm + hw * axisX.z + hd * axisZ.z,
    },
    {
      x: mod.xMm - hw * axisX.x + hd * axisZ.x,
      z: mod.zMm - hw * axisX.z + hd * axisZ.z,
    },
  ];
}

export function computeSignedAreaXZ(points: readonly Point2D[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i].x * points[j].z - points[j].x * points[i].z;
  }
  return 0.5 * sum;
}

export function computeWallBaseMetrics(wall: WallSegment): WallMetrics {
  const start: Point2D = { x: wall.startMm[0], z: wall.startMm[1] };
  const end: Point2D = { x: wall.endMm[0], z: wall.endMm[1] };
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthMm = Math.hypot(dx, dz);

  let tangent: Point2D;
  if (lengthMm <= 1e-6) {
    tangent = { x: 1, z: 0 };
  } else {
    tangent = { x: normalizeZero(dx / lengthMm), z: normalizeZero(dz / lengthMm) };
  }

  const leftNormal: Point2D = {
    x: normalizeZero(-tangent.z),
    z: normalizeZero(tangent.x),
  };
  const rightNormal: Point2D = {
    x: normalizeZero(tangent.z),
    z: normalizeZero(-tangent.x),
  };

  return {
    wall,
    start,
    end,
    midpoint: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
    lengthMm,
    tangent,
    leftNormal,
    rightNormal,
    inwardNormal: leftNormal,
    hasPolygonOrientation: false,
  };
}

interface GraphEdge {
  wallIndex: number;
  uNode: number;
  vNode: number;
}

function buildWallGraph(baseMetrics: WallMetrics[]): {
  nodes: Point2D[];
  edges: GraphEdge[];
  adj: Map<number, GraphEdge[]>;
} {
  const nodes: Point2D[] = [];

  const getOrAddNode = (p: Point2D): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - p.x, nodes[i].z - p.z) <= ENDPOINT_TOL_MM) {
        return i;
      }
    }
    nodes.push({ x: p.x, z: p.z });
    return nodes.length - 1;
  };

  const edges: GraphEdge[] = [];
  const adj = new Map<number, GraphEdge[]>();

  for (let i = 0; i < baseMetrics.length; i++) {
    const m = baseMetrics[i];
    const uNode = getOrAddNode(m.start);
    const vNode = getOrAddNode(m.end);
    if (uNode === vNode || m.lengthMm <= 1e-6) continue;

    const edge: GraphEdge = { wallIndex: i, uNode, vNode };
    edges.push(edge);

    const listU = adj.get(uNode) ?? [];
    listU.push(edge);
    adj.set(uNode, listU);

    const listV = adj.get(vNode) ?? [];
    listV.push(edge);
    adj.set(vNode, listV);
  }

  return { nodes, edges, adj };
}

export function extractRoomPolygons(walls: WallSegment[]): RoomPolygon[] {
  if (walls.length === 0) return [];
  const baseMetrics = walls.map(computeWallBaseMetrics);
  const { nodes, adj } = buildWallGraph(baseMetrics);

  const visitedNodes = new Set<number>();
  const polygons: RoomPolygon[] = [];

  for (let startNode = 0; startNode < nodes.length; startNode++) {
    if (visitedNodes.has(startNode)) continue;
    const startEdges = adj.get(startNode);
    if (!startEdges || startEdges.length === 0) continue;

    // Collect connected component
    const compNodes: number[] = [];
    const compEdgeSet = new Set<GraphEdge>();
    const queue = [startNode];
    visitedNodes.add(startNode);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      compNodes.push(curr);
      const inc = adj.get(curr) ?? [];
      for (const e of inc) {
        compEdgeSet.add(e);
        const nxt = e.uNode === curr ? e.vNode : e.uNode;
        if (!visitedNodes.has(nxt)) {
          visitedNodes.add(nxt);
          queue.push(nxt);
        }
      }
    }

    // Peel leaf nodes (deg === 1) to isolate a closed perimeter loop even with internal T-partition walls (M1)
    const coreNodes = new Set(compNodes);
    const coreEdges = new Set(compEdgeSet);
    let peeled = true;
    while (peeled) {
      peeled = false;
      for (const n of Array.from(coreNodes)) {
        const inc = (adj.get(n) ?? []).filter((e) => coreEdges.has(e));
        if (inc.length === 1) {
          coreEdges.delete(inc[0]);
          coreNodes.delete(n);
          peeled = true;
        }
      }
    }

    const coreArr = Array.from(coreNodes);
    const coreDeg2 = coreArr.filter(
      (n) => (adj.get(n) ?? []).filter((e) => coreEdges.has(e)).length === 2
    );
    const deg1 = compNodes.filter((n) => (adj.get(n)?.length ?? 0) === 1);
    const deg2 = compNodes.filter((n) => (adj.get(n)?.length ?? 0) === 2);

    const isClosedCycle = coreEdges.size >= 3 && coreArr.length >= 3 && coreDeg2.length === coreArr.length;
    const isOpenChain =
      !isClosedCycle &&
      compEdgeSet.size >= 2 &&
      deg1.length === 2 &&
      deg2.length === compNodes.length - 2;

    if (!isClosedCycle && !isOpenChain) {
      continue;
    }

    const activeEdges = isClosedCycle ? coreEdges : compEdgeSet;
    const walkStart = isClosedCycle ? coreArr[0] : deg1[0];
    const orderedNodes: number[] = [walkStart];
    const usedEdges = new Set<GraphEdge>();
    let curr = walkStart;

    while (true) {
      const candidates = (adj.get(curr) ?? []).filter((e) => activeEdges.has(e) && !usedEdges.has(e));
      if (candidates.length === 0) break;
      const e = candidates[0];
      usedEdges.add(e);
      const nxt = e.uNode === curr ? e.vNode : e.uNode;
      if (isClosedCycle && nxt === walkStart) break;
      orderedNodes.push(nxt);
      curr = nxt;
    }

    if (orderedNodes.length < 3) continue;
    const points = orderedNodes.map((n) => nodes[n]);
    const signedAreaMm2 = computeSignedAreaXZ(points);
    polygons.push({
      points,
      signedAreaMm2,
      isClosed: isClosedCycle,
    });
  }

  return polygons;
}

export function extractPrimaryRoomPolygon(walls: WallSegment[]): RoomPolygon | null {
  const polys = extractRoomPolygons(walls);
  if (polys.length === 0) return null;
  const closed = polys.filter((p) => p.isClosed);
  const pool = closed.length > 0 ? closed : polys;
  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    if (Math.abs(pool[i].signedAreaMm2) > Math.abs(best.signedAreaMm2)) {
      best = pool[i];
    }
  }
  return best;
}

export function analyzeWalls(walls: WallSegment[]): WallMetrics[] {
  if (walls.length === 0) return [];
  const metrics = walls.map(computeWallBaseMetrics);
  const { nodes, adj } = buildWallGraph(metrics);
  const visitedNodes = new Set<number>();

  // Global fallback center across all walls
  const bounds = computeRoomBounds(walls, false);

  for (let startNode = 0; startNode < nodes.length; startNode++) {
    if (visitedNodes.has(startNode)) continue;
    const startEdges = adj.get(startNode);
    if (!startEdges || startEdges.length === 0) continue;

    const compNodes: number[] = [];
    const compEdges = new Set<GraphEdge>();
    const queue = [startNode];
    visitedNodes.add(startNode);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      compNodes.push(curr);
      for (const e of adj.get(curr) ?? []) {
        compEdges.add(e);
        const nxt = e.uNode === curr ? e.vNode : e.uNode;
        if (!visitedNodes.has(nxt)) {
          visitedNodes.add(nxt);
          queue.push(nxt);
        }
      }
    }

    // 2-core leaf peeling isolates closed perimeter loop even with internal T-partition walls (M1)
    const coreNodes = new Set(compNodes);
    const coreEdges = new Set(compEdges);
    let peeled = true;
    while (peeled) {
      peeled = false;
      for (const n of Array.from(coreNodes)) {
        const inc = (adj.get(n) ?? []).filter((e) => coreEdges.has(e));
        if (inc.length === 1) {
          coreEdges.delete(inc[0]);
          coreNodes.delete(n);
          peeled = true;
        }
      }
    }

    const coreArr = Array.from(coreNodes);
    const coreDeg2 = coreArr.filter(
      (n) => (adj.get(n) ?? []).filter((e) => coreEdges.has(e)).length === 2
    );
    const deg1 = compNodes.filter((n) => (adj.get(n)?.length ?? 0) === 1);
    const deg2 = compNodes.filter((n) => (adj.get(n)?.length ?? 0) === 2);
    const isClosedCycle =
      coreEdges.size >= 3 && coreArr.length >= 3 && coreDeg2.length === coreArr.length;
    const isOpenChain =
      !isClosedCycle &&
      compEdges.size >= 2 &&
      deg1.length === 2 &&
      deg2.length === compNodes.length - 2;

    if (isClosedCycle || isOpenChain) {
      const activeEdges = isClosedCycle ? coreEdges : compEdges;
      const walkStart = isClosedCycle ? coreArr[0] : deg1[0];
      const orderedNodes: number[] = [walkStart];
      const orderedSteps: Array<{ edge: GraphEdge; dir: 1 | -1 }> = [];
      const usedEdges = new Set<GraphEdge>();
      let curr = walkStart;

      while (true) {
        const candidates = (adj.get(curr) ?? []).filter((e) => activeEdges.has(e) && !usedEdges.has(e));
        if (candidates.length === 0) break;
        const e = candidates[0];
        usedEdges.add(e);
        const dir: 1 | -1 = e.uNode === curr ? 1 : -1;
        orderedSteps.push({ edge: e, dir });
        const nxt = e.uNode === curr ? e.vNode : e.uNode;
        if (isClosedCycle && nxt === walkStart) break;
        orderedNodes.push(nxt);
        curr = nxt;
      }

      const points = orderedNodes.map((n) => nodes[n]);
      const signedArea = computeSignedAreaXZ(points);

      if (isClosedCycle || Math.abs(signedArea) > 1e-3) {
        const orientedIndices = new Set<number>();
        for (const step of orderedSteps) {
          orientedIndices.add(step.edge.wallIndex);
          const m = metrics[step.edge.wallIndex];
          const ex = m.tangent.x * step.dir;
          const ez = m.tangent.z * step.dir;
          const inward: Point2D =
            signedArea >= 0
              ? { x: normalizeZero(-ez), z: normalizeZero(ex) }
              : { x: normalizeZero(ez), z: normalizeZero(-ex) };
          m.inwardNormal = inward;
          m.hasPolygonOrientation = true;
        }
        // Orient any remaining peeled T-partition branches inside this component toward center
        for (const e of compEdges) {
          if (orientedIndices.has(e.wallIndex)) continue;
          const m = metrics[e.wallIndex];
          const toCenterX = bounds.center.x - m.midpoint.x;
          const toCenterZ = bounds.center.z - m.midpoint.z;
          const dotLeft = toCenterX * m.leftNormal.x + toCenterZ * m.leftNormal.z;
          m.inwardNormal = dotLeft >= 0 ? m.leftNormal : m.rightNormal;
          m.hasPolygonOrientation = false;
        }
        continue;
      }
    }

    // Fallback for single wall, collinear chain, or branched graph
    for (const e of compEdges) {
      const m = metrics[e.wallIndex];
      const toCenterX = bounds.center.x - m.midpoint.x;
      const toCenterZ = bounds.center.z - m.midpoint.z;
      const dotLeft = toCenterX * m.leftNormal.x + toCenterZ * m.leftNormal.z;
      if (Math.abs(dotLeft) > 10) {
        m.inwardNormal = dotLeft > 0 ? m.leftNormal : m.rightNormal;
      } else {
        m.inwardNormal = m.leftNormal;
      }
      m.hasPolygonOrientation = false;
    }
  }

  return metrics;
}

export function computeRoomBounds(
  walls: WallSegment[],
  includeWallThickness = false
): RoomBounds {
  if (walls.length === 0) {
    return {
      minX: 0,
      maxX: 4000,
      minZ: 0,
      maxZ: 3000,
      widthMm: 4000,
      depthMm: 3000,
      center: { x: 2000, z: 1500 },
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const w of walls) {
    const pad = includeWallThickness ? w.thicknessMm / 2 : 0;
    minX = Math.min(minX, w.startMm[0] - pad, w.endMm[0] - pad);
    maxX = Math.max(maxX, w.startMm[0] + pad, w.endMm[0] + pad);
    minZ = Math.min(minZ, w.startMm[1] - pad, w.endMm[1] - pad);
    maxZ = Math.max(maxZ, w.startMm[1] + pad, w.endMm[1] + pad);
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    widthMm: Math.max(0, maxX - minX),
    depthMm: Math.max(0, maxZ - minZ),
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
  };
}

export function projectPointToWall(
  metrics: WallMetrics,
  point: Point2D
): PointWallProjection {
  const vx = point.x - metrics.start.x;
  const vz = point.z - metrics.start.z;
  const uRawMm = vx * metrics.tangent.x + vz * metrics.tangent.z;
  const uClampedMm = Math.max(0, Math.min(metrics.lengthMm, uRawMm));
  const closestPoint: Point2D = {
    x: metrics.start.x + metrics.tangent.x * uClampedMm,
    z: metrics.start.z + metrics.tangent.z * uClampedMm,
  };
  const distanceToSegmentMm = Math.hypot(
    point.x - closestPoint.x,
    point.z - closestPoint.z
  );
  const signedInwardDistanceMm =
    vx * metrics.inwardNormal.x + vz * metrics.inwardNormal.z;

  return {
    uRawMm,
    uClampedMm,
    closestPoint,
    distanceToSegmentMm,
    signedInwardDistanceMm,
  };
}

export function projectModuleToWall(
  metrics: WallMetrics,
  mod: Pick<
    ModuleInstance,
    'xMm' | 'yMm' | 'zMm' | 'widthMm' | 'heightMm' | 'depthMm' | 'rotationYRad'
  >
): ModuleWallProjection {
  const corners = getModuleCorners2D(mod);
  let uMinMm = Infinity;
  let uMaxMm = -Infinity;
  let dMinMm = Infinity;
  let dMaxMm = -Infinity;

  for (const c of corners) {
    const vx = c.x - metrics.start.x;
    const vz = c.z - metrics.start.z;
    const u = vx * metrics.tangent.x + vz * metrics.tangent.z;
    const d = vx * metrics.inwardNormal.x + vz * metrics.inwardNormal.z;
    if (u < uMinMm) uMinMm = u;
    if (u > uMaxMm) uMaxMm = u;
    if (d < dMinMm) dMinMm = d;
    if (d > dMaxMm) dMaxMm = d;
  }

  return {
    uMinMm,
    uMaxMm,
    dMinMm,
    dMaxMm,
    yMinMm: mod.yMm,
    yMaxMm: mod.yMm + mod.heightMm,
  };
}

function intersectLines2D(
  p1: Point2D,
  d1: Point2D,
  p2: Point2D,
  d2: Point2D
): Point2D | null {
  const det = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(det) < 1e-4) return null;
  const rx = p2.x - p1.x;
  const rz = p2.z - p1.z;
  const t = (rx * d2.z - rz * d2.x) / det;
  return {
    x: p1.x + t * d1.x,
    z: p1.z + t * d1.z,
  };
}

interface ConnectedWallMatch {
  other: WallMetrics;
  isSegmentInteriorTJoin: boolean;
}

function findConnectedWallAtEndpoint(
  wm: WallMetrics,
  endpoint: Point2D,
  allMetrics: WallMetrics[]
): ConnectedWallMatch | null {
  for (const other of allMetrics) {
    if (other.wall.id === wm.wall.id) continue;
    const nearStart = Math.hypot(other.start.x - endpoint.x, other.start.z - endpoint.z) <= ENDPOINT_TOL_MM;
    const nearEnd = Math.hypot(other.end.x - endpoint.x, other.end.z - endpoint.z) <= ENDPOINT_TOL_MM;
    if (nearStart || nearEnd) {
      return { other, isSegmentInteriorTJoin: false };
    }
  }
  // Support T-junctions where endpoint lands on the interior of an existing wall segment (M1)
  for (const other of allMetrics) {
    if (other.wall.id === wm.wall.id) continue;
    const proj = projectPointToWall(other, endpoint);
    if (
      proj.uRawMm > ENDPOINT_TOL_MM &&
      proj.uRawMm < other.lengthMm - ENDPOINT_TOL_MM &&
      proj.distanceToSegmentMm <= ENDPOINT_TOL_MM
    ) {
      return { other, isSegmentInteriorTJoin: true };
    }
  }
  return null;
}

/**
 * Computes the 4 mitered 2D polygon corners [startIn, endIn, endOut, startOut]
 * so 2D walls meet cleanly at corners and T-junctions with zero overlap or corner gaps.
 */
export function computeWallPolygon2D(
  wm: WallMetrics,
  allMetrics: WallMetrics[]
): [Point2D, Point2D, Point2D, Point2D] {
  const halfT = wm.wall.thicknessMm / 2;
  const inN = wm.inwardNormal;
  const outN: Point2D = { x: -inN.x, z: -inN.z };
  const maxMiter = halfT * 2.4;

  const computeCorner = (endpoint: Point2D, normal: Point2D, sign: number): Point2D => {
    const fallback: Point2D = {
      x: endpoint.x + normal.x * halfT,
      z: endpoint.z + normal.z * halfT,
    };
    const match = findConnectedWallAtEndpoint(wm, endpoint, allMetrics);
    if (!match) return fallback;
    const { other, isSegmentInteriorTJoin } = match;

    const otherHalfT = other.wall.thicknessMm / 2;
    let otherNormal: Point2D;
    if (isSegmentInteriorTJoin) {
      // Stop flush against the host wall face nearest to wm.midpoint
      const toMidX = wm.midpoint.x - endpoint.x;
      const toMidZ = wm.midpoint.z - endpoint.z;
      const dotIn = toMidX * other.inwardNormal.x + toMidZ * other.inwardNormal.z;
      otherNormal =
        dotIn >= 0
          ? other.inwardNormal
          : { x: -other.inwardNormal.x, z: -other.inwardNormal.z };
    } else {
      otherNormal =
        sign > 0
          ? other.inwardNormal
          : { x: -other.inwardNormal.x, z: -other.inwardNormal.z };
    }
    const p2: Point2D = {
      x: endpoint.x + otherNormal.x * otherHalfT,
      z: endpoint.z + otherNormal.z * otherHalfT,
    };
    const hit = intersectLines2D(fallback, wm.tangent, p2, other.tangent);
    if (!hit) return fallback;
    if (Math.hypot(hit.x - endpoint.x, hit.z - endpoint.z) > maxMiter + halfT) {
      return fallback;
    }
    return hit;
  };

  return [
    computeCorner(wm.start, inN, 1),
    computeCorner(wm.end, inN, 1),
    computeCorner(wm.end, outN, -1),
    computeCorner(wm.start, outN, -1),
  ];
}

/**
 * Computes exact signed net interior face-to-face span of a wall from its mitered interior polygon
 * corners [startIn, endIn]. Convex 90° corners give +T/2 insets; re-entrant L/U 270° corners give -T/2 insets;
 * T-junctions give +T_host/2; obtuse/acute angles give exact miter trig offsets (C2).
 */
export function getWallInteriorSpanMm(
  wm: WallMetrics,
  allMetrics: WallMetrics[]
): { startInsetMm: number; endInsetMm: number; netLengthMm: number } {
  const [startIn, endIn] = computeWallPolygon2D(wm, allMetrics);
  const startU = (startIn.x - wm.start.x) * wm.tangent.x + (startIn.z - wm.start.z) * wm.tangent.z;
  const endU = (endIn.x - wm.start.x) * wm.tangent.x + (endIn.z - wm.start.z) * wm.tangent.z;
  const startInsetMm = normalizeZero(startU);
  const endInsetMm = normalizeZero(wm.lengthMm - endU);
  const netLengthMm = Math.max(0, Math.round(wm.lengthMm - startInsetMm - endInsetMm));
  return { startInsetMm, endInsetMm, netLengthMm };
}

/**
 * Computes butt-flush 3D trims along wm.tangent so perpendicular walls and T-junctions
 * meet cleanly in 3D without overlapping or leaving corner notches.
 */
export function computeWall3DTrimMm(
  wm: WallMetrics,
  allMetrics: WallMetrics[]
): {
  startTrimMm: number;
  endTrimMm: number;
  startInteriorInsetMm: number;
  endInteriorInsetMm: number;
} {
  const { startInsetMm, endInsetMm } = getWallInteriorSpanMm(wm, allMetrics);

  const decideTrim = (endpoint: Point2D, insetMm: number): number => {
    const match = findConnectedWallAtEndpoint(wm, endpoint, allMetrics);
    if (!match) return 0;
    const { other, isSegmentInteriorTJoin } = match;
    const mag = Math.abs(insetMm);
    if (mag <= 0.1) return 0;
    if (isSegmentInteriorTJoin) {
      // Partition wall always stops flush against the continuous host wall face
      return mag;
    }
    const wmHoriz = Math.abs(wm.tangent.x);
    const otherHoriz = Math.abs(other.tangent.x);
    const wmWins =
      Math.abs(wmHoriz - otherHoriz) > 0.05
        ? wmHoriz > otherHoriz
        : wm.wall.id < other.wall.id;
    return wmWins ? -mag : mag;
  };

  return {
    startTrimMm: decideTrim(wm.start, startInsetMm),
    endTrimMm: decideTrim(wm.end, endInsetMm),
    startInteriorInsetMm: startInsetMm,
    endInteriorInsetMm: endInsetMm,
  };
}

/**
 * Canonical interior Elevation coordinate frame (C1):
 * Looking at the wall from INSIDE the room (-inwardNormal), axisRight strictly points
 * to the viewer's RIGHT: (-inwardNormal) x +Y = (inwardNormal.z, -inwardNormal.x).
 * Invariant to whether the user drew walls CW or CCW.
 */
export function getWallElevationFrame(wm: WallMetrics): {
  origin: Point2D;
  axisRight: Point2D;
  flippedAlongWall: boolean;
} {
  const axisRight: Point2D = {
    x: normalizeZero(wm.inwardNormal.z),
    z: normalizeZero(-wm.inwardNormal.x),
  };
  const dot = wm.tangent.x * axisRight.x + wm.tangent.z * axisRight.z;
  const flippedAlongWall = dot < 0;
  return {
    origin: flippedAlongWall ? wm.end : wm.start,
    axisRight,
    flippedAlongWall,
  };
}

export function wallUFromElevU(wm: WallMetrics, uElevMm: number): number {
  const { flippedAlongWall } = getWallElevationFrame(wm);
  return flippedAlongWall ? wm.lengthMm - uElevMm : uElevMm;
}

export function elevUFromWallU(wm: WallMetrics, uWallMm: number): number {
  const { flippedAlongWall } = getWallElevationFrame(wm);
  return flippedAlongWall ? wm.lengthMm - uWallMm : uWallMm;
}

/**
 * Builds closed room walls (rect, l, u) where netWidthMm and netDepthMm are exact
 * net interior face-to-face dimensions (centerlines offset outward by thicknessMm / 2).
 */
export function buildRoomPresetWalls(
  shape: 'rect' | 'l' | 'u',
  netWidthMm: number,
  netDepthMm: number,
  thicknessMm: number,
  heightMm: number,
  materialId: string,
  idPrefix = 'mur-preset'
): WallSegment[] {
  const W = Math.max(1000, Math.round(netWidthMm));
  const D = Math.max(1000, Math.round(netDepthMm));
  const T = Math.max(50, Math.round(thicknessMm));
  const H = Math.max(500, Math.round(heightMm));
  const halfT = T / 2;

  const interiorPts: Array<[number, number]> =
    shape === 'rect'
      ? [
          [0, 0],
          [W, 0],
          [W, D],
          [0, D],
        ]
      : shape === 'l'
        ? [
            [0, 0],
            [W, 0],
            [W, Math.round(D * 0.55)],
            [Math.round(W * 0.55), Math.round(D * 0.55)],
            [Math.round(W * 0.55), D],
            [0, D],
          ]
        : [
            [0, 0],
            [W, 0],
            [W, D],
            [Math.round(W * 0.72), D],
            [Math.round(W * 0.72), Math.round(D * 0.5)],
            [Math.round(W * 0.28), Math.round(D * 0.5)],
            [Math.round(W * 0.28), D],
            [0, D],
          ];

  // Clockwise polygon in XZ: outward normal for edge (a -> b) is (dz/len, -dx/len)
  const edges = interiorPts.map((p, idx) => {
    const q = interiorPts[(idx + 1) % interiorPts.length];
    const dx = q[0] - p[0];
    const dz = q[1] - p[1];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len;
    const tz = dz / len;
    const outX = tz;
    const outZ = -tx;
    return {
      p: { x: p[0] + outX * halfT, z: p[1] + outZ * halfT },
      dir: { x: tx, z: tz },
    };
  });

  const centerlinePts: Array<[number, number]> = edges.map((curr, idx) => {
    const prev = edges[(idx - 1 + edges.length) % edges.length];
    const hit = intersectLines2D(prev.p, prev.dir, curr.p, curr.dir);
    return hit
      ? [Math.round(hit.x), Math.round(hit.z)]
      : [Math.round(curr.p.x), Math.round(curr.p.z)];
  });

  const stamp = Date.now();
  return centerlinePts.map((p, idx) => {
    const next = centerlinePts[(idx + 1) % centerlinePts.length];
    return {
      id: `${idPrefix}-${idx + 1}-${stamp}`,
      labelFr: `Mur ${idx + 1}`,
      startMm: p,
      endMm: next,
      thicknessMm: T,
      heightMm: H,
      materialId,
    };
  });
}
