export type {
  CollisionKind,
  CollisionWarning,
  SnapGuide,
  SnapGuideKind,
  SnapResult,
} from '@/types';

export {
  analyzeWalls,
  buildRoomPresetWalls,
  computeRoomBounds,
  computeSignedAreaXZ,
  computeWall3DTrimMm,
  computeWallBaseMetrics,
  computeWallPolygon2D,
  elevUFromWallU,
  extractPrimaryRoomPolygon,
  extractRoomPolygons,
  getModuleAxes2D,
  getModuleCorners2D,
  getWallElevationFrame,
  getWallInteriorSpanMm,
  normalToRotationYRad,
  normalizeZero,
  projectModuleToWall,
  projectPointToWall,
  wallUFromElevU,
  type ModuleWallProjection,
  type Point2D,
  type PointWallProjection,
  type RoomBounds,
  type RoomPolygon,
  type WallMetrics,
} from './wallMath';

export {
  computeMultiModuleSpacingMoves,
  findInteriorSpawnPosition,
  snapModulePosition,
  snapPropPosition,
  type InteriorSpawnResult,
  type MultiModuleSpacingMove,
  type PropSnapOptions,
  type PropSnapResult,
  type SnapOptions,
} from './snapping';

export {
  buildAutoUtilityTargetFromModule,
  buildAutoUtilityTargetFromProp,
  computeAutoUtilitiesForPlacement,
  computeAutoUtilitySpecsForTarget,
  syncLinkedUtilitiesForEntity,
  type AutoUtilityTarget,
} from './autoUtilities';

export {
  computeModuleFitSolution,
  type ModuleAutoFitSolution,
} from './autoFit';

export {
  DEFAULT_SPOT_INTENSITY,
  MAX_SPOT_INTENSITY,
  MIN_SPOT_INTENSITY,
  buildCeilingSpotPreset,
  resolveCeilingLighting,
  type CeilingSpotPreset,
} from './ceilingSpots';

export {
  DEFAULT_EXTERIOR_FOV,
  DEFAULT_INTERIOR_FOV,
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
  clampCameraInsideRoom,
  clampTargetInsideRoom,
  computeCameraZones,
  findSafeRoomInteriorPoint,
  isPointInPolygonXZ,
  shouldCutawayWall,
  shouldCutawayWallAttachedItem,
  type CameraZonePreset,
} from './cameraZones';

export {
  detectProjectCollisions,
  moduleToFootprints2D,
  moduleToOBB2D,
  testOBBOverlap2D,
  testYOverlap,
  utilityToOBB2D,
  type OBB2D,
} from './collision';
