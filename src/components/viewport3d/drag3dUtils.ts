import * as THREE from 'three';

/** Strictly disables Three.js raycasting on decorative overlays (wireframes, AO pads, edge lines). */
export const NO_RAYCAST: THREE.Object3D['raycast'] = () => {
  // Intentionally empty: non-interactive overlay must never intercept pointer hits.
};

/** Pointer movement threshold (px) before transitioning a direct hit click into a 3D drag. */
export const DRAG_THRESHOLD_PX = 5;

/**
 * Returns true if `obj` is `ancestor` or a descendant of `ancestor` in the Three.js scene graph.
 */
export function isObjectDescendantOf(
  obj: THREE.Object3D | null | undefined,
  ancestor: THREE.Object3D | null | undefined
): boolean {
  if (!obj || !ancestor) return false;
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

/**
 * Strict direct-hit test: returns true ONLY when the closest (frontmost) raycast intersection
 * hits a visible mesh belonging to `targetGroup`. Clicking empty space, walls, floor, or an
 * occluding object in front of `targetGroup` always returns false.
 */
export function isDirectFirstHit(
  intersections: ReadonlyArray<{ object: THREE.Object3D }>,
  targetGroup: THREE.Object3D | null | undefined
): boolean {
  if (!targetGroup || intersections.length === 0) return false;
  return isObjectDescendantOf(intersections[0].object, targetGroup);
}

/**
 * Disables raycasting on every mesh inside a cutaway upper-wall group so pointer hits from outside
 * the room pass cleanly through to cabinets behind the cut wall, while restoring normal raycasting
 * when the wall is full-height.
 */
export function applyCutawayRaycast(
  group: THREE.Object3D | null | undefined,
  isCutaway: boolean
): void {
  if (!group) return;
  group.visible = !isCutaway;
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      if (child.userData.alwaysNoRaycast) {
        child.raycast = NO_RAYCAST;
      } else {
        child.raycast = isCutaway ? NO_RAYCAST : THREE.Mesh.prototype.raycast;
      }
    }
  });
}

/**
 * Returns true once the pointer has moved at least `thresholdPx` pixels from its pointerdown origin.
 */
export function shouldStartDrag(
  startClientX: number,
  startClientY: number,
  currentClientX: number,
  currentClientY: number,
  thresholdPx = DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(currentClientX - startClientX, currentClientY - startClientY) >= thresholdPx;
}
