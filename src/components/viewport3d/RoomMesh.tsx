import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ProjectDocument, RoomUtility, WallOpening } from '@/types';
import {
  analyzeWalls,
  computeRoomBounds,
  computeWall3DTrimMm,
  computeWallPolygon2D,
  extractPrimaryRoomPolygon,
  findSafeRoomInteriorPoint,
  normalToRotationYRad,
  projectPointToWall,
  resolveCeilingLighting,
  shouldCutawayWall,
  shouldCutawayWallAttachedItem,
  type Point2D,
  type WallMetrics,
} from '@/engine/geometry';
import { getPbrMaterial, getSharedEdgeLineMaterial } from '@/materials/proceduralTextures';
import { useUIStore } from '@/store/useUIStore';
import { NO_RAYCAST, applyCutawayRaycast } from './drag3dUtils';

const MM = 0.001;
const CUTAWAY_STUB_HEIGHT_M = 0.15; // 150 mm low architectural stub

// Shared static architectural materials (P4 draw-call & GPU shader deduplication)
const MAT_PLINTHE = new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.5, metalness: 0.02 });
const MAT_PLINTHE_CAP = new THREE.MeshStandardMaterial({ color: '#e7e5df', roughness: 0.42, metalness: 0.02 });
const MAT_WIN_FRAME = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.38, metalness: 0.08 });
const MAT_WIN_SILL = new THREE.MeshStandardMaterial({ color: '#e7e5e4', roughness: 0.42, metalness: 0.04 });
const MAT_WIN_SASH = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.32, metalness: 0.12 });
const MAT_WIN_GLASS = new THREE.MeshPhysicalMaterial({
  color: '#e0f2fe',
  transparent: true,
  opacity: 0.24,
  roughness: 0.05,
  metalness: 0.08,
  reflectivity: 0.95,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.6,
  depthWrite: false,
});
const MAT_DOOR_FRAME = new THREE.MeshStandardMaterial({ color: '#5c3824', roughness: 0.5, metalness: 0.04 });
const MAT_DOOR_STOP = new THREE.MeshStandardMaterial({ color: '#4a2c1b', roughness: 0.58 });
const MAT_DOOR_LEAF = new THREE.MeshStandardMaterial({ color: '#7d4a28', roughness: 0.52, metalness: 0.03 });
const MAT_DOOR_GROOVE = new THREE.MeshStandardMaterial({ color: '#593219', roughness: 0.62 });
const MAT_DOOR_PANEL = new THREE.MeshStandardMaterial({ color: '#87522e', roughness: 0.5 });
const MAT_CHROME = new THREE.MeshStandardMaterial({ color: '#cbd5e1', metalness: 0.88, roughness: 0.2 });
const MAT_CHROME_LIGHT = new THREE.MeshStandardMaterial({ color: '#e4e4e7', metalness: 0.92, roughness: 0.17 });
const MAT_DARK_MATTE = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.9 });
const MAT_STUB_CAP = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.85, metalness: 0.05 });
const MAT_CEILING = new THREE.MeshStandardMaterial({ color: '#f5f3ee', roughness: 0.92, metalness: 0.0 });
const MAT_SPOT_TRIM = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.42, metalness: 0.18 });
const MAT_SPOT_BAFFLE = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.75, metalness: 0.25 });
const MAT_OUTLET_PLATE = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.38, metalness: 0.04 });
const MAT_OUTLET_BEVEL = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.42 });
const MAT_OUTLET_WELL = new THREE.MeshStandardMaterial({ color: '#f1f5f9', roughness: 0.5 });
const MAT_BRASS = new THREE.MeshStandardMaterial({ color: '#d4af37', metalness: 0.85, roughness: 0.25 });
const MAT_VALVE_BODY = new THREE.MeshStandardMaterial({ color: '#94a3b8', metalness: 0.88, roughness: 0.2 });
const MAT_VALVE_HOT = new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.4 });
const MAT_VALVE_COLD = new THREE.MeshStandardMaterial({ color: '#0284c7', roughness: 0.4 });
const MAT_PVC_DRAIN = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.55 });
const MAT_STRUCT_BEAM = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.78, metalness: 0.04 });

// Zero-FPS architectural corner ambient occlusion gradient material (1x64 alpha strip)
let cachedCornerAoMat: THREE.MeshBasicMaterial | null = null;
function getCornerAoMaterial(): THREE.MeshBasicMaterial {
  if (cachedCornerAoMat) return cachedCornerAoMat;
  if (typeof document === 'undefined') {
    cachedCornerAoMat = new THREE.MeshBasicMaterial({
      color: '#0f172a',
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
    });
    return cachedCornerAoMat;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Quadratic falloff from crease (y=0 -> v=1) to 0 at room interior (y=64 -> v=0)
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0.0, 'rgba(15, 23, 42, 0.20)');
    grad.addColorStop(0.28, 'rgba(15, 23, 42, 0.10)');
    grad.addColorStop(0.65, 'rgba(15, 23, 42, 0.03)');
    grad.addColorStop(1.0, 'rgba(15, 23, 42, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  cachedCornerAoMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  return cachedCornerAoMat;
}

interface Wall3DProps {
  wm: WallMetrics;
  allMetrics: WallMetrics[];
  roomPolygonPoints?: readonly Point2D[];
  openings: WallOpening[];
  autoCutaway: boolean;
  roomCenterM: [number, number];
  globalWallColor?: string;
  isClientMode?: boolean;
  showEdgeLines?: boolean;
}

function Wall3DMesh({
  wm,
  allMetrics,
  roomPolygonPoints,
  openings,
  autoCutaway,
  roomCenterM,
  globalWallColor,
  isClientMode = false,
  showEdgeLines = false,
}: Wall3DProps) {
  const { camera } = useThree();
  const selectEntity = useUIStore((s) => s.selectEntity);
  const fullGroupRef = useRef<THREE.Group | null>(null);
  const stubGroupRef = useRef<THREE.Group | null>(null);
  const lastCutRef = useRef<boolean | null>(null);

  const wall = wm.wall;
  const dx = wall.endMm[0] - wall.startMm[0];
  const dz = wall.endMm[1] - wall.startMm[1];
  const lengthMm = Math.hypot(dx, dz);
  const angleY = -Math.atan2(dz, dx);

  const trimMm = useMemo(() => computeWall3DTrimMm(wm, allMetrics), [wm, allMetrics]);
  const miterLocal = useMemo(() => {
    const poly = computeWallPolygon2D(wm, allMetrics);
    const toU = (p: Point2D) =>
      ((p.x - wm.start.x) * wm.tangent.x + (p.z - wm.start.z) * wm.tangent.z) * MM;
    const uStartPosZ = toU(poly[0]);
    const uStartNegZ = toU(poly[3]);
    const uEndPosZ = toU(poly[1]);
    const uEndNegZ = toU(poly[2]);
    const startSlanted = Math.abs(uStartPosZ - uStartNegZ) > 0.002;
    const endSlanted = Math.abs(uEndPosZ - uEndNegZ) > 0.002;
    return {
      uStartPosZ,
      uStartNegZ,
      uEndPosZ,
      uEndNegZ,
      startSlanted,
      endSlanted,
    };
  }, [wm, allMetrics]);

  const lengthM = Math.max(0.05, lengthMm * MM);
  const xStartM = miterLocal.startSlanted
    ? Math.min(miterLocal.uStartPosZ, miterLocal.uStartNegZ)
    : trimMm.startTrimMm * MM;
  const xEndM = Math.max(
    xStartM + 0.05,
    miterLocal.endSlanted
      ? Math.max(miterLocal.uEndPosZ, miterLocal.uEndNegZ)
      : (lengthMm - trimMm.endTrimMm) * MM
  );
  const interiorStartM = Math.max(0, trimMm.startInteriorInsetMm * MM);
  const interiorEndM = Math.max(interiorStartM + 0.05, (lengthMm - trimMm.endInteriorInsetMm) * MM);
  const interiorLenM = Math.max(0.05, interiorEndM - interiorStartM);
  const interiorMidM = (interiorStartM + interiorEndM) / 2;
  const heightM = Math.max(0.1, wall.heightMm * MM);
  const thicknessM = Math.max(0.02, wall.thicknessMm * MM);
  const stubHeightM = Math.min(CUTAWAY_STUB_HEIGHT_M, heightM);

  // Apply non-90° miter slopes cleanly on extruded wall end vertices without distorting interior openings
  const applyMiterSkew = (geo: THREE.BufferGeometry) => {
    if (!miterLocal.startSlanted && !miterLocal.endSlanted) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);
      const alpha = Math.max(0, Math.min(1, vz / thicknessM + 0.5));
      if (miterLocal.startSlanted && Math.abs(vx - xStartM) <= 0.002) {
        pos.setX(i, miterLocal.uStartNegZ + (miterLocal.uStartPosZ - miterLocal.uStartNegZ) * alpha);
      } else if (miterLocal.endSlanted && Math.abs(vx - xEndM) <= 0.002) {
        pos.setX(i, miterLocal.uEndNegZ + (miterLocal.uEndPosZ - miterLocal.uEndNegZ) * alpha);
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  };

  // Determine which local Z side (+1 or -1) faces the room interior for baseboards & sills
  const inwardLocalZSign = useMemo(() => {
    // Local +X is tangent (dx, dz)/len; local +Z is (-dz, dx)/len = leftNormal
    const dot = wm.inwardNormal.x * wm.leftNormal.x + wm.inwardNormal.z * wm.leftNormal.z;
    return dot >= 0 ? 1 : -1;
  }, [wm]);

  const wallGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(xStartM, 0);
    shape.lineTo(xEndM, 0);
    shape.lineTo(xEndM, heightM);
    shape.lineTo(xStartM, heightM);
    shape.closePath();

    for (const op of openings) {
      const ox = Math.max(xStartM + 0.01, op.offsetFromStartMm * MM);
      const ow = Math.min(xEndM - ox - 0.01, op.widthMm * MM);
      const oy = Math.max(0, op.sillHeightMm * MM);
      const oh = Math.min(heightM - oy - 0.01, op.heightMm * MM);
      if (ow <= 0.05 || oh <= 0.05) continue;

      const hole = new THREE.Path();
      hole.moveTo(ox, oy);
      hole.lineTo(ox + ow, oy);
      hole.lineTo(ox + ow, oy + oh);
      hole.lineTo(ox, oy + oh);
      hole.closePath();
      shape.holes.push(hole);
    }

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thicknessM,
      bevelEnabled: false,
    });
    geo.translate(0, 0, -thicknessM / 2);
    applyMiterSkew(geo);
    if (!miterLocal.startSlanted && !miterLocal.endSlanted) {
      geo.computeVertexNormals();
    }
    return geo;
  }, [xStartM, xEndM, heightM, thicknessM, openings, miterLocal]);

  // Low 150 mm stub geometry for cutaway state (respecting floor-level door openings)
  const stubGeo = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(xStartM, 0);
    shape.lineTo(xEndM, 0);
    shape.lineTo(xEndM, stubHeightM);
    shape.lineTo(xStartM, stubHeightM);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: thicknessM,
      bevelEnabled: false,
    });
    geo.translate(0, 0, -thicknessM / 2);
    applyMiterSkew(geo);
    if (!miterLocal.startSlanted && !miterLocal.endSlanted) {
      geo.computeVertexNormals();
    }
    return geo;
  }, [xStartM, xEndM, stubHeightM, thicknessM, miterLocal]);

  const wallEdgesGeo = useMemo(
    () => (showEdgeLines ? new THREE.EdgesGeometry(wallGeo, 28) : null),
    [wallGeo, showEdgeLines]
  );

  useEffect(() => {
    return () => {
      wallGeo.dispose();
    };
  }, [wallGeo]);

  useEffect(() => {
    return () => {
      wallEdgesGeo?.dispose();
    };
  }, [wallEdgesGeo]);

  useEffect(() => {
    return () => {
      stubGeo.dispose();
    };
  }, [stubGeo]);

  // ExtrudeGeometry UVs are in world meters -> set uvInMeters: true so plaster/zellige tiles accurately
  const effectiveWallColor = wall.colorOverride ?? globalWallColor;
  const wallMat = useMemo(
    () =>
      getPbrMaterial(wall.materialId, 'none', {
        uvInMeters: true,
        colorOverrideHex: effectiveWallColor,
      }),
    [wall.materialId, effectiveWallColor]
  );

  // Baseboard spans skipping floor-level openings (doors) and stopping flush at interior corners
  const baseboardSpans = useMemo(() => {
    const doorRanges = openings
      .filter((op) => op.sillHeightMm < 90)
      .map((op) => ({
        start: Math.max(interiorStartM, op.offsetFromStartMm * MM - 0.02),
        end: Math.min(interiorEndM, (op.offsetFromStartMm + op.widthMm) * MM + 0.02),
      }))
      .sort((a, b) => a.start - b.start);

    const spans: Array<{ start: number; end: number }> = [];
    let cursor = interiorStartM;
    for (const r of doorRanges) {
      if (r.start > cursor + 0.05) {
        spans.push({ start: cursor, end: r.start });
      }
      cursor = Math.max(cursor, r.end);
    }
    if (interiorEndM - cursor > 0.05) {
      spans.push({ start: cursor, end: interiorEndM });
    }
    return spans;
  }, [openings, interiorStartM, interiorEndM]);

  // Automatic per-frame cutaway check without React re-renders AND strict cutaway raycast disabling
  useFrame(() => {
    if (!fullGroupRef.current || !stubGroupRef.current) return;
    const cut =
      autoCutaway && !wall.keepVisibleInCutaway
        ? shouldCutawayWall(
            wm,
            [camera.position.x, camera.position.y, camera.position.z],
            roomCenterM,
            roomPolygonPoints
          )
        : false;

    if (lastCutRef.current !== cut) {
      lastCutRef.current = cut;
      // Disable raycast on every mesh inside the cutaway upper wall so clicks reach cabinets behind!
      applyCutawayRaycast(fullGroupRef.current, cut);
      applyCutawayRaycast(stubGroupRef.current, !cut);
    }
  });

  return (
    <group
      name={`Mur_${wall.id}`}
      position={[wall.startMm[0] * MM, 0, wall.startMm[1] * MM]}
      rotation={[0, angleY, 0]}
    >
      {/* Full-height wall & architectural openings */}
      <group ref={fullGroupRef}>
        <mesh
          geometry={wallGeo}
          material={wallMat}
          castShadow
          receiveShadow
          onPointerDown={(e) => {
            // Stop R3F raycast fall-through to modules behind this wall while OrbitControls still orbits freely
            e.stopPropagation();
          }}
          onClick={(e) => {
            if (!isClientMode && e.delta <= 4) {
              e.stopPropagation();
              selectEntity(wall.id, 'wall');
            }
          }}
        />
        {/* Crisp SketchUp Pro architectural crease edges (mounted only when enabled in current render style) */}
        {wallEdgesGeo && (
          <lineSegments
            geometry={wallEdgesGeo}
            material={getSharedEdgeLineMaterial()}
            raycast={NO_RAYCAST}
          />
        )}

        {/* Zero-FPS subtle architectural wall-ceiling interior corner AO shadow gradient */}
        <mesh
          position={[interiorMidM, heightM - 0.11, inwardLocalZSign * (thicknessM / 2 + 0.0022)]}
          rotation={[0, inwardLocalZSign > 0 ? 0 : Math.PI, 0]}
          material={getCornerAoMaterial()}
          raycast={NO_RAYCAST}
        >
          <planeGeometry args={[interiorLenM, 0.22]} />
        </mesh>

        {/* Architectural interior skirting / baseboards + subtle floor-wall contact AO strips */}
        {baseboardSpans.map((sp, idx) => {
          const spanLen = sp.end - sp.start;
          return (
            <group
              key={`plinthe-${idx}`}
              position={[
                sp.start + spanLen / 2,
                0,
                inwardLocalZSign * (thicknessM / 2 + 0.006),
              ]}
            >
              <mesh position={[0, 0.036, 0]} receiveShadow material={MAT_PLINTHE}>
                <boxGeometry args={[spanLen, 0.072, 0.013]} />
              </mesh>
              <mesh
                position={[0, 0.074, -inwardLocalZSign * 0.002]}
                receiveShadow
                material={MAT_PLINTHE_CAP}
              >
                <boxGeometry args={[spanLen, 0.005, 0.009]} />
              </mesh>
              {/* Zero-FPS subtle floor-wall corner ambient occlusion gradient strip */}
              <mesh
                position={[0, 0.0022, inwardLocalZSign * 0.11]}
                rotation={[-Math.PI / 2, 0, inwardLocalZSign > 0 ? 0 : Math.PI]}
                material={getCornerAoMaterial()}
                raycast={NO_RAYCAST}
              >
                <planeGeometry args={[spanLen, 0.21]} />
              </mesh>
            </group>
          );
        })}

        {/* Recessed opening frames, mullions, reflective glazing & molded doors */}
        {openings.map((op) => {
          const ow = op.widthMm * MM;
          const oh = op.heightMm * MM;
          const ox = op.offsetFromStartMm * MM;
          const oy = op.sillHeightMm * MM;
          const frameT = 0.05;
          const frameD = thicknessM + 0.014;
          const sashT = 0.032;

          return (
            <group key={op.id} position={[ox + ow / 2, oy + oh / 2, 0]}>
              {op.kind === 'fenetre' ? (
                <>
                  {/* Recessed outer casing / dormant */}
                  <mesh position={[0, oh / 2 - frameT / 2, 0]} castShadow receiveShadow material={MAT_WIN_FRAME}>
                    <boxGeometry args={[ow, frameT, frameD]} />
                  </mesh>
                  <mesh position={[-ow / 2 + frameT / 2, 0, 0]} castShadow receiveShadow material={MAT_WIN_FRAME}>
                    <boxGeometry args={[frameT, oh, frameD]} />
                  </mesh>
                  <mesh position={[ow / 2 - frameT / 2, 0, 0]} castShadow receiveShadow material={MAT_WIN_FRAME}>
                    <boxGeometry args={[frameT, oh, frameD]} />
                  </mesh>
                  {/* Protruding architectural windowsill (appui de fenêtre) */}
                  <mesh
                    position={[0, -oh / 2 + frameT * 0.45, inwardLocalZSign * 0.018]}
                    castShadow
                    receiveShadow
                    material={MAT_WIN_SILL}
                  >
                    <boxGeometry args={[ow + 0.05, 0.038, thicknessM + 0.056]} />
                  </mesh>

                  {/* Recessed inner sash frame (ouvrant) */}
                  <mesh
                    position={[0, oh / 2 - frameT - sashT / 2, -inwardLocalZSign * 0.015]}
                    castShadow
                    material={MAT_WIN_SASH}
                  >
                    <boxGeometry args={[ow - frameT * 2, sashT, 0.044]} />
                  </mesh>
                  <mesh
                    position={[0, -oh / 2 + frameT + sashT / 2, -inwardLocalZSign * 0.015]}
                    castShadow
                    material={MAT_WIN_SASH}
                  >
                    <boxGeometry args={[ow - frameT * 2, sashT, 0.044]} />
                  </mesh>
                  <mesh
                    position={[-ow / 2 + frameT + sashT / 2, 0, -inwardLocalZSign * 0.015]}
                    castShadow
                    material={MAT_WIN_SASH}
                  >
                    <boxGeometry args={[sashT, oh - frameT * 2, 0.044]} />
                  </mesh>
                  <mesh
                    position={[ow / 2 - frameT - sashT / 2, 0, -inwardLocalZSign * 0.015]}
                    castShadow
                    material={MAT_WIN_SASH}
                  >
                    <boxGeometry args={[sashT, oh - frameT * 2, 0.044]} />
                  </mesh>

                  {/* Central vertical mullion (meneau) */}
                  <mesh position={[0, 0, -inwardLocalZSign * 0.015]} castShadow material={MAT_WIN_SASH}>
                    <boxGeometry args={[0.038, oh - frameT * 2, 0.05]} />
                  </mesh>
                  {/* Subtle upper transom bar for tall windows */}
                  {oh >= 1.1 && (
                    <mesh
                      position={[0, oh * 0.22, -inwardLocalZSign * 0.015]}
                      castShadow
                      material={MAT_WIN_SASH}
                    >
                      <boxGeometry args={[ow - frameT * 2, 0.024, 0.036]} />
                    </mesh>
                  )}

                  {/* Brushed window handle (poignée de fenêtre) */}
                  <group position={[0.028, -0.04, inwardLocalZSign * 0.012]}>
                    <mesh material={MAT_CHROME}>
                      <boxGeometry args={[0.018, 0.05, 0.014]} />
                    </mesh>
                    <mesh position={[0, -0.042, inwardLocalZSign * 0.016]} material={MAT_CHROME_LIGHT}>
                      <boxGeometry args={[0.012, 0.09, 0.012]} />
                    </mesh>
                  </group>

                  {/* Reflective double-glazing pane (transparent so 3D garden shines through) */}
                  <mesh position={[0, 0, -inwardLocalZSign * 0.018]} material={MAT_WIN_GLASS}>
                    <boxGeometry args={[ow - frameT * 2 - 0.02, oh - frameT * 2 - 0.02, 0.01]} />
                  </mesh>
                </>
              ) : (
                <>
                  {/* Chamfered outer architectural door casing (chambranle / cadre) */}
                  <mesh position={[0, oh / 2 - frameT / 2, 0]} castShadow receiveShadow material={MAT_DOOR_FRAME}>
                    <boxGeometry args={[ow + 0.056, frameT + 0.014, frameD + 0.014]} />
                  </mesh>
                  <mesh
                    position={[-ow / 2 + frameT / 2 - 0.01, 0, 0]}
                    castShadow
                    receiveShadow
                    material={MAT_DOOR_FRAME}
                  >
                    <boxGeometry args={[frameT + 0.016, oh + 0.014, frameD + 0.014]} />
                  </mesh>
                  <mesh
                    position={[ow / 2 - frameT / 2 + 0.01, 0, 0]}
                    castShadow
                    receiveShadow
                    material={MAT_DOOR_FRAME}
                  >
                    <boxGeometry args={[frameT + 0.016, oh + 0.014, frameD + 0.014]} />
                  </mesh>
                  {/* Inner door stop rebate (feuillure) */}
                  <mesh position={[0, oh / 2 - frameT - 0.008, 0]} material={MAT_DOOR_STOP}>
                    <boxGeometry args={[ow - frameT * 2 + 0.01, 0.016, thicknessM - 0.02]} />
                  </mesh>

                  {/* 3 visible brushed steel barrel hinges (paumelles) on hinge jamb */}
                  {[-oh * 0.34, 0, oh * 0.34].map((hy, hIdx) => {
                    const isRight = op.hingeSide === 'right';
                    const hingeX = isRight ? ow / 2 - frameT - 0.004 : -ow / 2 + frameT + 0.004;
                    return (
                      <mesh
                        key={`hinge-${hIdx}`}
                        position={[hingeX, hy, inwardLocalZSign * (thicknessM / 2 + 0.004)]}
                        material={MAT_CHROME}
                      >
                        <cylinderGeometry args={[0.007, 0.007, 0.075, 10]} />
                      </mesh>
                    );
                  })}

                  {/* High-detail Architectural Door Leaf with Recessed Moldings & Dual-Side Lever Handles */}
                  {(() => {
                    const isRight = op.hingeSide === 'right';
                    const leafW = Math.max(0.3, ow - frameT * 2);
                    const leafH = Math.max(0.8, oh - frameT);
                    const panelW = Math.max(0.22, leafW - 0.2);
                    const dirSign = isRight ? -1 : 1;
                    const pivotX = isRight ? ow / 2 - frameT : -ow / 2 + frameT;
                    return (
                      <group
                        position={[pivotX, 0, inwardLocalZSign * (thicknessM / 2 - 0.01)]}
                        rotation={[0, inwardLocalZSign * dirSign * 0.28, 0]}
                      >
                        {/* Solid wood door leaf */}
                        <mesh position={[dirSign * (leafW / 2), 0, 0]} castShadow receiveShadow material={MAT_DOOR_LEAF}>
                          <boxGeometry args={[leafW, leafH, 0.044]} />
                        </mesh>
                        {/* Subtle dark architectural shadow groove reveals on BOTH sides */}
                        {[1, -1].map((side) => (
                          <group key={`face-${side}`} position={[dirSign * (leafW / 2), 0, side * 0.0225]}>
                            <mesh position={[0, leafH * 0.21, 0]} material={MAT_DOOR_GROOVE}>
                              <boxGeometry args={[panelW + 0.024, leafH * 0.37, 0.004]} />
                            </mesh>
                            <mesh position={[0, leafH * 0.21, side * 0.0028]} material={MAT_DOOR_PANEL}>
                              <boxGeometry args={[panelW - 0.014, leafH * 0.33, 0.005]} />
                            </mesh>
                            <mesh position={[0, -leafH * 0.22, 0]} material={MAT_DOOR_GROOVE}>
                              <boxGeometry args={[panelW + 0.024, leafH * 0.31, 0.004]} />
                            </mesh>
                            <mesh position={[0, -leafH * 0.22, side * 0.0028]} material={MAT_DOOR_PANEL}>
                              <boxGeometry args={[panelW - 0.014, leafH * 0.27, 0.005]} />
                            </mesh>
                          </group>
                        ))}

                        {/* Brushed metallic lever handle (poignée béquille) + rosette & keyhole escutcheon on BOTH sides */}
                        <group position={[dirSign * (leafW - 0.085), -0.02, 0]}>
                          <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT_CHROME}>
                            <cylinderGeometry args={[0.011, 0.011, 0.085, 12]} />
                          </mesh>
                          {[1, -1].map((side) => (
                            <group key={`handle-${side}`}>
                              <mesh
                                position={[0, 0, side * 0.025]}
                                rotation={[Math.PI / 2, 0, 0]}
                                material={MAT_CHROME_LIGHT}
                              >
                                <cylinderGeometry args={[0.027, 0.027, 0.008, 16]} />
                              </mesh>
                              <mesh position={[-dirSign * 0.056, 0, side * 0.05]} material={MAT_CHROME_LIGHT}>
                                <boxGeometry args={[0.122, 0.015, 0.013]} />
                              </mesh>
                              <mesh
                                position={[0, -0.072, side * 0.025]}
                                rotation={[Math.PI / 2, 0, 0]}
                                material={MAT_CHROME}
                              >
                                <cylinderGeometry args={[0.024, 0.024, 0.007, 16]} />
                              </mesh>
                              <mesh position={[0, -0.072, side * 0.0295]} material={MAT_DARK_MATTE}>
                                <boxGeometry args={[0.006, 0.018, 0.002]} />
                              </mesh>
                            </group>
                          ))}
                        </group>
                      </group>
                    );
                  })()}
                </>
              )}
            </group>
          );
        })}
      </group>

      {/* Cutaway 150 mm stub wall with crisp architectural section top cap */}
      <group ref={stubGroupRef} visible={false}>
        <mesh
          geometry={stubGeo}
          material={wallMat}
          receiveShadow
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            if (!isClientMode && e.delta <= 4) {
              e.stopPropagation();
              selectEntity(wall.id, 'wall');
            }
          }}
        />
        <mesh position={[lengthM / 2, stubHeightM + 0.003, 0]} material={MAT_STUB_CAP}>
          <boxGeometry args={[lengthM + 0.002, 0.006, thicknessM + 0.004]} />
        </mesh>
      </group>
    </group>
  );
}

interface Utility3DProps {
  utility: RoomUtility;
  wallMetrics: WallMetrics[];
  autoCutaway?: boolean;
  roomCenterM?: [number, number];
}

function Utility3DMesh({
  utility,
  wallMetrics,
  autoCutaway = false,
  roomCenterM,
}: Utility3DProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group | null>(null);
  const lastCutRef = useRef<boolean | null>(null);
  const x = utility.xMm * MM;
  const y = (utility.yMm + utility.heightMm / 2) * MM;
  const z = utility.zMm * MM;

  const isWallUtility = utility.kind === 'prise' || utility.kind === 'arrivee_eau';

  useFrame(() => {
    if (!groupRef.current || !isWallUtility) return;
    const cut =
      autoCutaway && roomCenterM
        ? shouldCutawayWallAttachedItem(
            {
              xMm: utility.xMm,
              zMm: utility.zMm,
              depthMm: utility.depthMm,
              attachedWallId: utility.wallId,
            },
            wallMetrics,
            [camera.position.x, camera.position.y, camera.position.z],
            roomCenterM
          )
        : false;
    if (lastCutRef.current !== cut) {
      lastCutRef.current = cut;
      applyCutawayRaycast(groupRef.current, cut);
    }
  });

  // Determine wall orientation so outlet plates / plumbing valves sit flush with their wall
  const orientationY = useMemo(() => {
    if (!isWallUtility) return 0;
    const byId = utility.wallId
      ? wallMetrics.find((wm) => wm.wall.id === utility.wallId)
      : undefined;
    if (byId) return normalToRotationYRad(byId.inwardNormal);

    let best: WallMetrics | null = null;
    let bestDist = Infinity;
    for (const wm of wallMetrics) {
      const p = projectPointToWall(wm, { x: utility.xMm, z: utility.zMm });
      if (p.distanceToSegmentMm < bestDist) {
        bestDist = p.distanceToSegmentMm;
        best = wm;
      }
    }
    return best ? normalToRotationYRad(best.inwardNormal) : 0;
  }, [isWallUtility, utility, wallMetrics]);

  // Authentic French Legrand-style 2P+T electrical outlet plate
  if (utility.kind === 'prise') {
    const plateW = Math.max(0.082, Math.max(utility.widthMm, utility.depthMm) * MM);
    const plateH = Math.max(0.082, utility.heightMm * MM);
    return (
      <group
        ref={groupRef}
        name={`Reseau_${utility.id}`}
        position={[x, y, z]}
        rotation={[0, orientationY, 0]}
      >
        <mesh receiveShadow material={MAT_OUTLET_PLATE}>
          <boxGeometry args={[plateW, plateH, 0.009]} />
        </mesh>
        <mesh position={[0, 0, 0.0048]} material={MAT_OUTLET_BEVEL}>
          <boxGeometry args={[plateW * 0.72, plateH * 0.72, 0.002]} />
        </mesh>
        <mesh position={[0, 0, 0.0052]} rotation={[Math.PI / 2, 0, 0]} material={MAT_OUTLET_WELL}>
          <cylinderGeometry args={[0.02, 0.02, 0.004, 20]} />
        </mesh>
        <mesh position={[-0.0095, 0, 0.0074]} rotation={[Math.PI / 2, 0, 0]} material={MAT_DARK_MATTE}>
          <cylinderGeometry args={[0.0028, 0.0028, 0.002, 10]} />
        </mesh>
        <mesh position={[0.0095, 0, 0.0074]} rotation={[Math.PI / 2, 0, 0]} material={MAT_DARK_MATTE}>
          <cylinderGeometry args={[0.0028, 0.0028, 0.002, 10]} />
        </mesh>
        <mesh position={[0, 0.011, 0.011]} rotation={[Math.PI / 2, 0, 0]} material={MAT_BRASS}>
          <cylinderGeometry args={[0.0024, 0.0024, 0.012, 10]} />
        </mesh>
      </group>
    );
  }

  // Authentic plumbing manifold (robinets d'arrêt EC/EF + évacuation)
  if (utility.kind === 'arrivee_eau') {
    return (
      <group
        ref={groupRef}
        name={`Reseau_${utility.id}`}
        position={[x, y, z]}
        rotation={[0, orientationY, 0]}
      >
        <group position={[-0.036, 0.025, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT_CHROME}>
            <cylinderGeometry args={[0.02, 0.02, 0.008, 16]} />
          </mesh>
          <mesh position={[0, 0, 0.018]} rotation={[Math.PI / 2, 0, 0]} material={MAT_VALVE_BODY}>
            <cylinderGeometry args={[0.008, 0.008, 0.03, 12]} />
          </mesh>
          <mesh position={[0, 0.012, 0.028]} material={MAT_VALVE_HOT}>
            <boxGeometry args={[0.024, 0.008, 0.008]} />
          </mesh>
        </group>

        <group position={[0.036, 0.025, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} material={MAT_CHROME}>
            <cylinderGeometry args={[0.02, 0.02, 0.008, 16]} />
          </mesh>
          <mesh position={[0, 0, 0.018]} rotation={[Math.PI / 2, 0, 0]} material={MAT_VALVE_BODY}>
            <cylinderGeometry args={[0.008, 0.008, 0.03, 12]} />
          </mesh>
          <mesh position={[0, 0.012, 0.028]} material={MAT_VALVE_COLD}>
            <boxGeometry args={[0.024, 0.008, 0.008]} />
          </mesh>
        </group>

        <mesh position={[0, -0.032, 0.016]} rotation={[Math.PI / 2, 0, 0]} material={MAT_PVC_DRAIN}>
          <cylinderGeometry args={[0.02, 0.02, 0.034, 16]} />
        </mesh>
      </group>
    );
  }

  // Structural column / beam (poteau / poutre)
  const w = Math.max(0.03, utility.widthMm * MM);
  const h = Math.max(0.03, utility.heightMm * MM);
  const d = Math.max(0.02, utility.depthMm * MM);
  return (
    <mesh
      name={`Reseau_${utility.id}`}
      position={[x, y, z]}
      castShadow
      receiveShadow
      material={MAT_STRUCT_BEAM}
    >
      <boxGeometry args={[w, h, d]} />
    </mesh>
  );
}

interface RoomMeshProps {
  doc: ProjectDocument;
  autoCutaway?: boolean;
  showCeiling?: boolean;
  isNight?: boolean;
  isClientMode?: boolean;
  isCapturingRender?: boolean;
  showEdgeLines?: boolean;
}

export function RoomMesh({
  doc,
  autoCutaway = false,
  showCeiling = false,
  isNight = false,
  isClientMode = false,
  isCapturingRender = false,
  showEdgeLines = false,
}: RoomMeshProps) {
  const selectEntity = useUIStore((s) => s.selectEntity);
  const bounds = useMemo(() => computeRoomBounds(doc.walls, true), [doc.walls]);
  const wallMetrics = useMemo(() => analyzeWalls(doc.walls), [doc.walls]);
  const primaryPoly = useMemo(() => extractPrimaryRoomPolygon(doc.walls), [doc.walls]);
  const roomCenterM = useMemo<[number, number]>(() => {
    const safePt = findSafeRoomInteriorPoint(doc.walls, wallMetrics);
    return [safePt.x * MM, safePt.z * MM];
  }, [doc.walls, wallMetrics]);

  const floorGeo = useMemo(() => {
    const poly = extractPrimaryRoomPolygon(doc.walls);
    if (poly && poly.points.length >= 3) {
      const shape = new THREE.Shape();
      // Shape in XY, rotated -PI/2 around X maps (x, y) -> (x, 0, -y), so use -z for shape Y
      shape.moveTo(poly.points[0].x * MM, -poly.points[0].z * MM);
      for (let i = 1; i < poly.points.length; i++) {
        shape.lineTo(poly.points[i].x * MM, -poly.points[i].z * MM);
      }
      shape.closePath();
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      return geo;
    }

    const w = Math.max(4, (bounds.widthMm + 1200) * MM);
    const d = Math.max(4, (bounds.depthMm + 1200) * MM);
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(bounds.center.x * MM, 0, bounds.center.z * MM);
    return geo;
  }, [doc.walls, bounds]);

  // Ceiling slab geometry matching floor polygon (for immersive Vue Client)
  const ceilingGeo = useMemo(() => {
    const poly = extractPrimaryRoomPolygon(doc.walls);
    if (poly && poly.points.length >= 3) {
      const shape = new THREE.Shape();
      shape.moveTo(poly.points[0].x * MM, -poly.points[0].z * MM);
      for (let i = 1; i < poly.points.length; i++) {
        shape.lineTo(poly.points[i].x * MM, -poly.points[i].z * MM);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      return geo;
    }

    const w = Math.max(4, (bounds.widthMm + 200) * MM);
    const d = Math.max(4, (bounds.depthMm + 200) * MM);
    const geo = new THREE.BoxGeometry(w, 0.12, d);
    geo.translate(bounds.center.x * MM, 0.06, bounds.center.z * MM);
    return geo;
  }, [doc.walls, bounds]);

  useEffect(() => {
    return () => {
      floorGeo.dispose();
    };
  }, [floorGeo]);

  useEffect(() => {
    return () => {
      ceilingGeo.dispose();
    };
  }, [ceilingGeo]);

  const hasPolygonFloor = useMemo(() => {
    const poly = extractPrimaryRoomPolygon(doc.walls);
    return Boolean(poly && poly.points.length >= 3);
  }, [doc.walls]);

  // ShapeGeometry UVs are in world meters (uvInMeters: true); PlaneGeometry fallback UVs are normalized 0..1
  const floorMat = useMemo(
    () =>
      getPbrMaterial(doc.floorMaterialId, 'H', {
        uvInMeters: hasPolygonFloor,
        repeatX: Math.max(4, (bounds.widthMm + 1200) * MM),
        repeatY: Math.max(4, (bounds.depthMm + 1200) * MM),
        colorOverrideHex: doc.floorColorOverride,
        groutColorHex: doc.floorGroutColor,
      }),
    [
      doc.floorMaterialId,
      doc.floorColorOverride,
      doc.floorGroutColor,
      hasPolygonFloor,
      bounds.widthMm,
      bounds.depthMm,
    ]
  );

  const openingsByWall = useMemo(() => {
    const map = new Map<string, WallOpening[]>();
    for (const op of doc.openings) {
      const arr = map.get(op.wallId) ?? [];
      arr.push(op);
      map.set(op.wallId, arr);
    }
    return map;
  }, [doc.openings]);

  // Ceiling recessed spotlights (user-customized positions or default 2x2 grid)
  const ceilingLighting = useMemo(
    () => resolveCeilingLighting(doc.walls, doc.ceilingLighting),
    [doc.walls, doc.ceilingLighting]
  );

  const ceilingY = doc.ceilingHeightMm * MM;

  return (
    <group name="Piece_Architecture">
      {/* Floor */}
      <mesh
        name="Sol"
        geometry={floorGeo}
        material={floorMat}
        position={[0, -0.002, 0]}
        receiveShadow
        onPointerDown={(e) => {
          // Stop raycast propagation so floor clicks/drags never trigger module drags behind/under floor
          e.stopPropagation();
        }}
        onClick={(e) => {
          if (!isClientMode && e.delta <= 4) {
            e.stopPropagation();
            selectEntity('sol', 'floor');
          }
        }}
      />

      {/* Walls */}
      {wallMetrics.map((wm) => (
        <Wall3DMesh
          key={wm.wall.id}
          wm={wm}
          allMetrics={wallMetrics}
          roomPolygonPoints={primaryPoly?.points}
          openings={openingsByWall.get(wm.wall.id) ?? []}
          autoCutaway={autoCutaway}
          roomCenterM={roomCenterM}
          globalWallColor={doc.wallColor}
          isClientMode={isClientMode}
          showEdgeLines={showEdgeLines}
        />
      ))}

      {/* Ceiling & architectural downlights (rendered in Vue Client) */}
      {showCeiling && (
        <group name="Plafond">
          <mesh
            geometry={ceilingGeo}
            position={[0, ceilingY, 0]}
            receiveShadow
            material={MAT_CEILING}
          />

          {ceilingLighting.spots.map((sp) => {
            const spOn = ceilingLighting.spotsEnabled && sp.enabled !== false;
            const emInt = spOn
              ? (isNight ? 3.0 : 1.3) * ceilingLighting.spotIntensity * (sp.intensity ?? 1)
              : 0;
            return (
              <group key={sp.id} position={[sp.xMm * MM, ceilingY - 0.006, sp.zMm * MM]}>
                {/* Matte white recessed trim ring */}
                <mesh material={MAT_SPOT_TRIM}>
                  <cylinderGeometry args={[0.056, 0.056, 0.008, 20]} />
                </mesh>
                {/* Dark recessed anti-glare baffle ring */}
                <mesh position={[0, -0.0025, 0]} material={MAT_SPOT_BAFFLE}>
                  <cylinderGeometry args={[0.043, 0.043, 0.006, 20]} />
                </mesh>
                {/* Warm HDR LED diffuser lens */}
                <mesh position={[0, -0.004, 0]}>
                  <cylinderGeometry args={[0.034, 0.034, 0.004, 20]} />
                  <meshStandardMaterial
                    color={spOn && emInt > 0.05 ? '#fffbeb' : '#cbd5e1'}
                    emissive={isNight ? '#fde68a' : '#fff3cd'}
                    emissiveIntensity={emInt}
                    toneMapped={false}
                  />
                </mesh>
              </group>
            );
          })}
        </group>
      )}

      {/* Utilities (hide technical electrical/plumbing markers during 2K photo capture) */}
      {doc.utilities.map((u) => {
        if (isCapturingRender && (u.kind === 'prise' || u.kind === 'arrivee_eau')) {
          return null;
        }
        return (
          <Utility3DMesh
            key={u.id}
            utility={u}
            wallMetrics={wallMetrics}
            autoCutaway={autoCutaway}
            roomCenterM={roomCenterM}
          />
        );
      })}
    </group>
  );
}
