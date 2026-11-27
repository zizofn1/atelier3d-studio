import type { ProjectDocument, WallSegment } from '@/types';
import {
  analyzeWalls,
  computeRoomBounds,
  computeSignedAreaXZ,
  extractPrimaryRoomPolygon,
  projectPointToWall,
  type Point2D,
  type WallMetrics,
} from './wallMath';

const MM = 0.001;

export const DEFAULT_INTERIOR_FOV = 70;
export const DEFAULT_EXTERIOR_FOV = 50;
export const MIN_CAMERA_FOV = 50;
export const MAX_CAMERA_FOV = 85;

export interface CameraZonePreset {
  id: string;
  labelFr: string;
  kind: 'global' | 'wall' | 'corner';
  wallId?: string;
  positionM: [number, number, number];
  targetM: [number, number, number];
  fovDeg: number;
}

/**
 * Ray-casting point-in-polygon test in the XZ plane (all coordinates in mm).
 */
export function isPointInPolygonXZ(pt: Point2D, polygon: readonly Point2D[]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    const intersects =
      zi > pt.z !== zj > pt.z &&
      pt.x < ((xj - xi) * (pt.z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Finds a guaranteed interior anchor point inside a room polygon (in mm).
 */
export function findSafeRoomInteriorPoint(
  walls: WallSegment[],
  wallMetrics: WallMetrics[]
): Point2D {
  const bounds = computeRoomBounds(walls, false);
  const poly = extractPrimaryRoomPolygon(walls);

  if (!poly || !poly.isClosed || poly.points.length < 3) {
    return bounds.center;
  }

  if (isPointInPolygonXZ(bounds.center, poly.points)) {
    return bounds.center;
  }

  // Fallback for concave L/U polygons whose bbox center lies outside:
  // sample inward from the midpoint of the longest wall
  const sorted = [...wallMetrics].sort((a, b) => b.lengthMm - a.lengthMm);
  for (const wm of sorted) {
    for (const dist of [500, 350, 200, 120]) {
      const candidate: Point2D = {
        x: wm.midpoint.x + wm.inwardNormal.x * (wm.wall.thicknessMm / 2 + dist),
        z: wm.midpoint.z + wm.inwardNormal.z * (wm.wall.thicknessMm / 2 + dist),
      };
      if (isPointInPolygonXZ(candidate, poly.points)) {
        return candidate;
      }
    }
  }

  // Final centroid fallback
  let sx = 0;
  let sz = 0;
  for (const p of poly.points) {
    sx += p.x;
    sz += p.z;
  }
  return { x: sx / poly.points.length, z: sz / poly.points.length };
}

/**
 * Determines whether a wall stands between the camera and the room center
 * and should be cut away to a 150 mm stub in Conception Orbit mode.
 * Coordinates are in meters.
 * Guarded for concave L/U polygons: never cuts when camera is inside a closed room polygon,
 * nor when the wall plane lies behind roomCenter or far off the camera->center segment.
 */
export function shouldCutawayWall(
  wm: WallMetrics,
  cameraPosM: [number, number, number],
  roomCenterM: [number, number],
  wallsOrPolygon?: readonly WallSegment[] | readonly Point2D[]
): boolean {
  const camX = cameraPosM[0];
  const camZ = cameraPosM[2];

  // Never cut any wall while camera is inside the closed room polygon
  if (wallsOrPolygon && wallsOrPolygon.length >= 3) {
    let polyPts: readonly Point2D[] | null = null;
    const first = wallsOrPolygon[0];
    if ('startMm' in first) {
      polyPts = extractPrimaryRoomPolygon(wallsOrPolygon as WallSegment[])?.points ?? null;
    } else {
      polyPts = wallsOrPolygon as readonly Point2D[];
    }
    if (polyPts && polyPts.length >= 3 && isPointInPolygonXZ({ x: camX * 1000, z: camZ * 1000 }, polyPts)) {
      return false;
    }
  }

  const mx = wm.midpoint.x * MM;
  const mz = wm.midpoint.z * MM;

  const toCenterX = roomCenterM[0] - camX;
  const toCenterZ = roomCenterM[1] - camZ;
  const toCenterDist = Math.hypot(toCenterX, toCenterZ);
  if (toCenterDist < 0.12) {
    // Camera is directly above room center: keep walls standing
    return false;
  }

  const viewDirX = toCenterX / toCenterDist;
  const viewDirZ = toCenterZ / toCenterDist;

  // Dot product of wall inward normal with camera-to-room-center view vector.
  // Positive when wall's interior face points away from the camera (wall is in front).
  const viewDot = viewDirX * wm.inwardNormal.x + viewDirZ * wm.inwardNormal.z;
  if (viewDot <= 0.12) {
    return false;
  }

  // Camera must also be on the exterior side of the wall plane (so interior views stay full)
  const wallToCamX = camX - mx;
  const wallToCamZ = camZ - mz;
  const signedInwardM =
    wallToCamX * wm.inwardNormal.x + wallToCamZ * wm.inwardNormal.z;

  if (signedInwardM >= -0.02) {
    return false;
  }

  // Wall plane must actually sit between camera (t=0) and roomCenter (t=1), not behind roomCenter
  const tHit = -signedInwardM / (viewDot * toCenterDist);
  if (tHit > 1.05) {
    return false;
  }

  // Hit point along wall segment must lie near the actual wall segment (guards U/L concave recess walls)
  const hitX = camX + toCenterX * tHit;
  const hitZ = camZ + toCenterZ * tHit;
  const uHit =
    (hitX - wm.start.x * MM) * wm.tangent.x +
    (hitZ - wm.start.z * MM) * wm.tangent.z;
  const lenM = wm.lengthMm * MM;
  return uHit >= -0.6 && uHit <= lenM + 0.6;
}

/**
 * Scoped cutaway test for cabinets, wall-mounted decor/appliances, and utilities:
 * ONLY returns true when the item is attached to or flush against a wall that is
 * currently cut away (and not pinned with keepVisibleInCutaway).
 * Freestanding islands (îlot central) or items on visible walls are NEVER hidden.
 */
export function shouldCutawayWallAttachedItem(
  item: {
    xMm: number;
    zMm: number;
    depthMm?: number;
    attachedWallId?: string;
    isFreestandingOnly?: boolean;
  },
  wallMetrics: WallMetrics[],
  cameraPosM: [number, number, number],
  roomCenterM: [number, number],
  maxFlushGapMm = 140
): boolean {
  if (item.isFreestandingOnly || wallMetrics.length === 0) return false;

  let hostWall: WallMetrics | null = null;
  if (item.attachedWallId) {
    hostWall = wallMetrics.find((wm) => wm.wall.id === item.attachedWallId) ?? null;
  }

  if (!hostWall) {
    const halfD = (item.depthMm ?? 0) / 2;
    let bestGap = Infinity;
    for (const wm of wallMetrics) {
      const proj = projectPointToWall(wm, { x: item.xMm, z: item.zMm });
      if (proj.uRawMm < -100 || proj.uRawMm > wm.lengthMm + 100) continue;
      const distFromFace = Math.abs(
        Math.abs(proj.signedInwardDistanceMm) - (wm.wall.thicknessMm / 2 + halfD)
      );
      if (distFromFace <= maxFlushGapMm && distFromFace < bestGap) {
        bestGap = distFromFace;
        hostWall = wm;
      }
    }
  }

  if (!hostWall || hostWall.wall.keepVisibleInCutaway) return false;
  return shouldCutawayWall(
    hostWall,
    cameraPosM,
    roomCenterM,
    wallMetrics.map((w) => w.wall)
  );
}

/**
 * Ray-segment intersection in XZ (mm). Returns distance t > 0 along ray or null.
 */
function raySegmentDistanceXZ(
  origin: Point2D,
  dir: Point2D,
  a: Point2D,
  b: Point2D
): number | null {
  const v1x = origin.x - a.x;
  const v1z = origin.z - a.z;
  const v2x = b.x - a.x;
  const v2z = b.z - a.z;
  const v3x = -dir.z;
  const v3z = dir.x;

  const dot = v2x * v3x + v2z * v3z;
  if (Math.abs(dot) < 1e-8) return null;

  const t1 = (v2x * v1z - v2z * v1x) / dot;
  const t2 = (v1x * v3x + v1z * v3z) / dot;

  if (t1 > 10 && t2 >= -0.01 && t2 <= 1.01) {
    return t1;
  }
  return null;
}

/**
 * Strictly clamps a 3D camera position (in meters) inside the room polygon
 * with a safe wall, floor, and ceiling margin so the user can never exit or clip through walls.
 */
export function clampCameraInsideRoom(
  posM: [number, number, number],
  walls: WallSegment[],
  ceilingHeightMm: number,
  marginMm = 320,
  minFloorM = 0.45,
  ceilingMarginM = 0.25
): [number, number, number] {
  const maxY = Math.max(minFloorM + 0.2, ceilingHeightMm * MM - ceilingMarginM);
  const clampedY = Math.max(minFloorM, Math.min(maxY, posM[1]));

  if (walls.length === 0) {
    const cx = Math.max(0.35, Math.min(3.65, posM[0]));
    const cz = Math.max(0.35, Math.min(2.65, posM[2]));
    return [cx, clampedY, cz];
  }

  const wallMetrics = analyzeWalls(walls);
  const bounds = computeRoomBounds(walls, false);
  const poly = extractPrimaryRoomPolygon(walls);
  const safeInterior = findSafeRoomInteriorPoint(walls, wallMetrics);

  let pt: Point2D = { x: posM[0] * 1000, z: posM[2] * 1000 };

  if (poly && poly.isClosed && poly.points.length >= 3) {
    // 1. If point is outside the closed room polygon, project onto the nearest wall segment
    //    and step inside along its inwardNormal so U/L wings don't teleport across notches.
    if (!isPointInPolygonXZ(pt, poly.points)) {
      let bestDistSq = Infinity;
      let nearestCandidate: Point2D | null = null;
      for (const wm of wallMetrics) {
        const proj = projectPointToWall(wm, pt);
        const uClamped = Math.max(0, Math.min(wm.lengthMm, proj.uRawMm));
        const closestX = wm.start.x + wm.tangent.x * uClamped;
        const closestZ = wm.start.z + wm.tangent.z * uClamped;
        const d2 = (pt.x - closestX) ** 2 + (pt.z - closestZ) ** 2;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          const inset = wm.wall.thicknessMm / 2 + marginMm;
          nearestCandidate = {
            x: closestX + wm.inwardNormal.x * inset,
            z: closestZ + wm.inwardNormal.z * inset,
          };
        }
      }

      if (nearestCandidate && isPointInPolygonXZ(nearestCandidate, poly.points)) {
        pt = nearestCandidate;
      } else {
        const dx = pt.x - safeInterior.x;
        const dz = pt.z - safeInterior.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 1) {
          const dir: Point2D = { x: dx / dist, z: dz / dist };
          let bestT = Infinity;
          let hitWallThickness = 150;
          for (const wm of wallMetrics) {
            const t = raySegmentDistanceXZ(safeInterior, dir, wm.start, wm.end);
            if (t !== null && t < bestT) {
              bestT = t;
              hitWallThickness = wm.wall.thicknessMm;
            }
          }
          if (Number.isFinite(bestT)) {
            const safeDist = Math.max(0, bestT - hitWallThickness / 2 - marginMm);
            pt = {
              x: safeInterior.x + dir.x * safeDist,
              z: safeInterior.z + dir.z * safeDist,
            };
          } else {
            pt = { ...safeInterior };
          }
        } else {
          pt = { ...safeInterior };
        }
      }
    }

    // 2. Enforce safe wall clearance against all walls (2 passes for concave/corner convergence)
    for (let pass = 0; pass < 2; pass++) {
      for (const wm of wallMetrics) {
        const proj = projectPointToWall(wm, pt);
        if (proj.uRawMm < -marginMm || proj.uRawMm > wm.lengthMm + marginMm) {
          continue;
        }
        const minInward = wm.wall.thicknessMm / 2 + marginMm;
        if (
          proj.signedInwardDistanceMm < minInward &&
          proj.distanceToSegmentMm < minInward + 450
        ) {
          const push = minInward - proj.signedInwardDistanceMm;
          pt = {
            x: pt.x + wm.inwardNormal.x * push,
            z: pt.z + wm.inwardNormal.z * push,
          };
        }
      }
    }

    // 3. Final safeguard: if margin pushed point across an opposite wall (tiny room / alcove),
    //    binary-search back toward safeInterior until strictly inside.
    if (!isPointInPolygonXZ(pt, poly.points)) {
      let lo = 0;
      let hi = 1;
      for (let iter = 0; iter < 12; iter++) {
        const mid = (lo + hi) / 2;
        const testPt: Point2D = {
          x: safeInterior.x + (pt.x - safeInterior.x) * mid,
          z: safeInterior.z + (pt.z - safeInterior.z) * mid,
        };
        if (isPointInPolygonXZ(testPt, poly.points)) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const safeFactor = Math.max(0, lo * 0.9);
      pt = {
        x: safeInterior.x + (pt.x - safeInterior.x) * safeFactor,
        z: safeInterior.z + (pt.z - safeInterior.z) * safeFactor,
      };
    }
  } else {
    // Non-closed wall configuration: clamp safely inside room bounding box
    const halfW = bounds.widthMm / 2;
    const halfD = bounds.depthMm / 2;
    const effMarginX = Math.min(marginMm, Math.max(20, halfW * 0.4));
    const effMarginZ = Math.min(marginMm, Math.max(20, halfD * 0.4));
    pt = {
      x: Math.max(bounds.minX + effMarginX, Math.min(bounds.maxX - effMarginX, pt.x)),
      z: Math.max(bounds.minZ + effMarginZ, Math.min(bounds.maxZ - effMarginZ, pt.z)),
    };
  }

  return [pt.x * MM, clampedY, pt.z * MM];
}

/**
 * Clamps an OrbitControls target point inside the room boundaries (with smaller margin).
 */
export function clampTargetInsideRoom(
  targetM: [number, number, number],
  walls: WallSegment[],
  ceilingHeightMm: number
): [number, number, number] {
  return clampCameraInsideRoom(targetM, walls, ceilingHeightMm, 120, 0.2, 0.15);
}

/**
 * Automatically computes camera zone presets from the project's walls:
 * - Vue Globale (Isometric Orbit — Conception mode only)
 * - Dynamic Interior Wall Viewpoints (e.g., Vue Mur Nord / Est / Sud / Ouest)
 * - Interior Corner Diagonal Viewpoints
 */
export function computeCameraZones(doc: ProjectDocument): CameraZonePreset[] {
  const bounds = computeRoomBounds(doc.walls, false);
  const wallMetrics = analyzeWalls(doc.walls);
  const cx = bounds.center.x * MM;
  const cz = bounds.center.z * MM;
  const span = Math.max(3.5, Math.hypot(bounds.widthMm, bounds.depthMm) * MM);
  const eyeY = Math.min(1.48, Math.max(1.1, (doc.ceilingHeightMm - 420) * MM));
  const lookY = Math.min(1.22, Math.max(0.85, doc.ceilingHeightMm * MM * 0.48));

  const presets: CameraZonePreset[] = [
    {
      id: 'global',
      labelFr: 'Vue Globale',
      kind: 'global',
      positionM: [cx + span * 0.62, Math.max(2.4, span * 0.56), cz + span * 0.72],
      targetM: [cx, 0.9, cz],
      fovDeg: DEFAULT_EXTERIOR_FOV,
    },
  ];

  // Dynamic Interior Wall Viewpoints: positioned far back near the opposite wall (~220 mm clearance)
  // at eye level (~1480 mm) so the entire target wall, floor, and ceiling fit cleanly in wide-angle frame.
  for (let i = 0; i < wallMetrics.length; i++) {
    const wm = wallMetrics[i];
    if (wm.lengthMm < 350) continue;

    const rayOrigin: Point2D = {
      x: wm.midpoint.x + wm.inwardNormal.x * (wm.wall.thicknessMm / 2 + 40),
      z: wm.midpoint.z + wm.inwardNormal.z * (wm.wall.thicknessMm / 2 + 40),
    };
    let oppositeDist = Math.max(bounds.widthMm, bounds.depthMm) * 0.92;
    let oppositeHalfThickness = 75;
    for (const other of wallMetrics) {
      if (other.wall.id === wm.wall.id) continue;
      const t = raySegmentDistanceXZ(rayOrigin, wm.inwardNormal, other.start, other.end);
      if (t !== null && t < oppositeDist) {
        oppositeDist = t;
        oppositeHalfThickness = other.wall.thicknessMm / 2;
      }
    }

    // Pull back close to the opposite wall with ~220 mm clearance from its inner face
    const oppositeInnerClearance = oppositeHalfThickness + 220;
    const maxPullbackFromWallFace = Math.max(700, oppositeDist - oppositeInnerClearance);
    const desiredDist = Math.max(700, maxPullbackFromWallFace);

    const rawPos: [number, number, number] = [
      (wm.midpoint.x + wm.inwardNormal.x * (wm.wall.thicknessMm / 2 + 40 + desiredDist)) * MM,
      eyeY,
      (wm.midpoint.z + wm.inwardNormal.z * (wm.wall.thicknessMm / 2 + 40 + desiredDist)) * MM,
    ];
    const clampedPos = clampCameraInsideRoom(rawPos, doc.walls, doc.ceilingHeightMm, 220);

    const wallTarget: [number, number, number] = [
      (wm.midpoint.x + wm.inwardNormal.x * (wm.wall.thicknessMm / 2 + 160)) * MM,
      lookY,
      (wm.midpoint.z + wm.inwardNormal.z * (wm.wall.thicknessMm / 2 + 160)) * MM,
    ];

    const rawLabel = (wm.wall.labelFr ?? `Mur ${i + 1}`).trim();
    const labelFr = /^vue\b/i.test(rawLabel) ? rawLabel : `Vue ${rawLabel}`;

    presets.push({
      id: `wall-${wm.wall.id}`,
      labelFr,
      kind: 'wall',
      wallId: wm.wall.id,
      positionM: clampedPos,
      targetM: wallTarget,
      fovDeg: DEFAULT_INTERIOR_FOV,
    });
  }

  // Interior diagonal corner viewpoints built from true convex room vertices (handles L/U shapes safely)
  if (doc.walls.length >= 2) {
    const safeCenter = findSafeRoomInteriorPoint(doc.walls, wallMetrics);
    const poly = extractPrimaryRoomPolygon(doc.walls);
    const cornerCandidates: Array<{ id: string; labelFr: string; raw: Point2D }> = [];

    if (poly && poly.isClosed && poly.points.length >= 3) {
      const pts = poly.points;
      const polySignedArea = computeSignedAreaXZ(pts);
      const seenLabels = new Set<string>();
      for (let i = 0; i < pts.length; i++) {
        const prev = pts[(i - 1 + pts.length) % pts.length];
        const curr = pts[i];
        const next = pts[(i + 1) % pts.length];
        const e1x = curr.x - prev.x;
        const e1z = curr.z - prev.z;
        const e2x = next.x - curr.x;
        const e2z = next.z - curr.z;
        const l1 = Math.hypot(e1x, e1z);
        const l2 = Math.hypot(e2x, e2z);
        if (l1 < 50 || l2 < 50) continue;

        // Bisect both candidate inward normals at vertex curr
        const n1a: Point2D = { x: -e1z / l1, z: e1x / l1 };
        const n2a: Point2D = { x: -e2z / l2, z: e2x / l2 };
        const s = polySignedArea >= 0 ? 1 : -1;
        const bisX = (n1a.x + n2a.x) * s;
        const bisZ = (n1a.z + n2a.z) * s;
        const bLen = Math.hypot(bisX, bisZ);
        if (bLen < 0.1) continue;
        const testPt: Point2D = {
          x: curr.x + (bisX / bLen) * 420,
          z: curr.z + (bisZ / bLen) * 420,
        };
        // Only convex interior corners pass point-in-polygon near vertex along interior bisector
        if (!isPointInPolygonXZ(testPt, pts)) continue;

        const isEast = curr.x >= bounds.center.x;
        const isSouth = curr.z >= bounds.center.z;
        const baseLabel = isSouth
          ? isEast
            ? 'Angle Sud-Est'
            : 'Angle Sud-Ouest'
          : isEast
            ? 'Angle Nord-Est'
            : 'Angle Nord-Ouest';
        let labelFr = baseLabel;
        if (seenLabels.has(labelFr)) {
          labelFr = `${baseLabel} ${cornerCandidates.length + 1}`;
        }
        seenLabels.add(labelFr);
        cornerCandidates.push({
          id: `corner-${i + 1}`,
          labelFr,
          raw: testPt,
        });
        if (cornerCandidates.length >= 4) break;
      }
    }

    if (cornerCandidates.length === 0) {
      const inset = 340;
      cornerCandidates.push(
        {
          id: 'corner-so',
          labelFr: 'Angle Sud-Ouest',
          raw: { x: bounds.minX + inset, z: bounds.maxZ - inset },
        },
        {
          id: 'corner-se',
          labelFr: 'Angle Sud-Est',
          raw: { x: bounds.maxX - inset, z: bounds.maxZ - inset },
        }
      );
    }

    for (const c of cornerCandidates) {
      const clampedPos = clampCameraInsideRoom(
        [c.raw.x * MM, eyeY, c.raw.z * MM],
        doc.walls,
        doc.ceilingHeightMm,
        220
      );
      presets.push({
        id: c.id,
        labelFr: c.labelFr,
        kind: 'corner',
        positionM: clampedPos,
        targetM: [safeCenter.x * MM, lookY, safeCenter.z * MM],
        fovDeg: DEFAULT_INTERIOR_FOV,
      });
    }
  }

  return presets;
}
