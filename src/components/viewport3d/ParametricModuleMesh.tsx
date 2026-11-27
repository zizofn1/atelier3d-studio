import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarpentryParams, HandleStyle, ModuleInstance, ModuleOutput, PanelSpec } from '@/types';
import { resolveParams } from '@/engine/carpentry';
import {
  analyzeWalls,
  shouldCutawayWallAttachedItem,
  snapModulePosition,
  type WallMetrics,
} from '@/engine/geometry';
import { getPbrMaterial, getSharedEdgeLineMaterial } from '@/materials/proceduralTextures';
import { pauseHistory, resumeHistory, useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import {
  DRAG_THRESHOLD_PX,
  NO_RAYCAST,
  applyCutawayRaycast,
  isDirectFirstHit,
  shouldStartDrag,
} from './drag3dUtils';
import { getActiveVideoFrame, registerVideoFrameApplier } from './videoRuntimeRef';

const MM = 0.001;

// Cached chamfered/beveled box geometries, merged handles, ceramic vessel basin & SketchUp crease EdgesGeometry
const beveledGeoCache = new Map<string, RoundedBoxGeometry>();
const chamferedGeoCache = new Map<string, THREE.ExtrudeGeometry>();
const boxEdgeGeoCache = new Map<string, THREE.EdgesGeometry>();
const barHandleGeoCache = new Map<string, THREE.BufferGeometry>();
let cachedCeramicBasinGeo: THREE.LatheGeometry | null = null;

// Shared singleton materials (P4 draw-call & GPU shader dedup + C7.3 mirror material leak fix)
const SHARED_MIRROR_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: '#e5edf5',
  metalness: 0.94,
  roughness: 0.06,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.75,
});

const SHARED_GLASS_DOOR_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: '#e0f2fe',
  transparent: true,
  opacity: 0.24,
  roughness: 0.05,
  metalness: 0.08,
  reflectivity: 0.95,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.45,
  depthWrite: false,
});

const customGlassMatCache = new Map<string, THREE.MeshPhysicalMaterial>();

function getGlassDoorMaterial(tintHex?: string, opacity?: number): THREE.MeshPhysicalMaterial {
  const cleanTint = (tintHex ?? '#e0f2fe').toLowerCase();
  const safeOp = Math.max(0.12, Math.min(0.85, opacity ?? 0.24));
  if (cleanTint === '#e0f2fe' && Math.abs(safeOp - 0.24) < 0.01) {
    return SHARED_GLASS_DOOR_MATERIAL;
  }
  const key = `${cleanTint}_${safeOp.toFixed(2)}`;
  const cached = customGlassMatCache.get(key);
  if (cached) return cached;
  const isFrosted = safeOp >= 0.52;
  const mat = new THREE.MeshPhysicalMaterial({
    color: cleanTint,
    transparent: true,
    opacity: safeOp,
    roughness: isFrosted ? 0.34 : 0.06,
    metalness: 0.06,
    reflectivity: isFrosted ? 0.45 : 0.92,
    clearcoat: isFrosted ? 0.25 : 0.9,
    clearcoatRoughness: isFrosted ? 0.28 : 0.05,
    envMapIntensity: isFrosted ? 0.75 : 1.35,
    depthWrite: false,
  });
  if (customGlassMatCache.size > 48) {
    const firstKey = customGlassMatCache.keys().next().value;
    if (firstKey) {
      customGlassMatCache.get(firstKey)?.dispose();
      customGlassMatCache.delete(firstKey);
    }
  }
  customGlassMatCache.set(key, mat);
  return mat;
}

const SHARED_REVEAL_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#171717',
  roughness: 0.95,
  metalness: 0.05,
});

const SHARED_HANDLE_GORGE_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#334155',
  metalness: 0.85,
  roughness: 0.26,
  envMapIntensity: 1.2,
});

const SHARED_HANDLE_CHROME_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#e2e8f0',
  metalness: 0.9,
  roughness: 0.18,
  envMapIntensity: 1.4,
});

const SHARED_CHROME_SATIN_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#cbd5e1',
  metalness: 0.86,
  roughness: 0.22,
  envMapIntensity: 1.25,
});

const SHARED_CERAMIC_TOP_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: '#f8fafc',
  roughness: 0.14,
  clearcoat: 0.85,
  clearcoatRoughness: 0.1,
});

const SHARED_CERAMIC_BASIN_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: '#ffffff',
  roughness: 0.09,
  clearcoat: 0.95,
  clearcoatRoughness: 0.06,
  envMapIntensity: 1.35,
  side: THREE.DoubleSide,
});

const SHARED_DRAIN_CHROME_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#94a3b8',
  metalness: 0.92,
  roughness: 0.18,
});

const SHARED_OVEN_BEZEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#18181b',
  roughness: 0.35,
  metalness: 0.5,
});

const SHARED_OVEN_STEEL_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#d4d4d8',
  metalness: 0.88,
  roughness: 0.22,
  envMapIntensity: 1.35,
});

const SHARED_OVEN_DISPLAY_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#09090b',
  emissive: '#38bdf8',
  emissiveIntensity: 0.35,
  roughness: 0.15,
});

const SHARED_OVEN_GLASS_MATERIAL = new THREE.MeshPhysicalMaterial({
  color: '#0f172a',
  roughness: 0.08,
  metalness: 0.15,
  clearcoat: 1,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.7,
});

const SHARED_FLOOR_AO_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#0f172a',
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
});

const SHARED_SELECTION_WIRE_MATERIAL = new THREE.MeshBasicMaterial({
  color: '#fbbf24',
  wireframe: true,
});

function getMergedBarHandleGeometry(barLen: number): THREE.BufferGeometry {
  const key = barLen.toFixed(3);
  const cached = barHandleGeoCache.get(key);
  if (cached) return cached;

  const mainBar = new THREE.BoxGeometry(0.011, barLen, 0.012);
  const topStandoff = new THREE.BoxGeometry(0.009, 0.01, 0.014);
  topStandoff.translate(0, barLen * 0.36, -0.008);
  const botStandoff = new THREE.BoxGeometry(0.009, 0.01, 0.014);
  botStandoff.translate(0, -barLen * 0.36, -0.008);

  const merged = mergeGeometries([mainBar, topStandoff, botStandoff], false);
  mainBar.dispose();
  topStandoff.dispose();
  botStandoff.dispose();

  const result = merged ?? new THREE.BoxGeometry(0.011, barLen, 0.012);
  if (barHandleGeoCache.size > 64) {
    const firstKey = barHandleGeoCache.keys().next().value;
    if (firstKey) {
      barHandleGeoCache.get(firstKey)?.dispose();
      barHandleGeoCache.delete(firstKey);
    }
  }
  barHandleGeoCache.set(key, result);
  return result;
}

/**
 * Sculpted hollow ceramic vessel basin (LatheGeometry):
 * real concave inner bowl + rounded rim lip for realistic Salle de Bain renders.
 */
function getCeramicBasinGeometry(): THREE.LatheGeometry {
  if (cachedCeramicBasinGeo) return cachedCeramicBasinGeo;
  const profile: THREE.Vector2[] = [
    // Outer flat base -> curved outer wall
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.135, 0.0),
    new THREE.Vector2(0.168, 0.015),
    new THREE.Vector2(0.198, 0.048),
    new THREE.Vector2(0.212, 0.088),
    new THREE.Vector2(0.214, 0.114),
    // Smooth rounded ceramic rim
    new THREE.Vector2(0.209, 0.122),
    new THREE.Vector2(0.199, 0.122),
    new THREE.Vector2(0.194, 0.114),
    // Deep concave interior wall -> inner basin floor
    new THREE.Vector2(0.184, 0.082),
    new THREE.Vector2(0.16, 0.045),
    new THREE.Vector2(0.118, 0.026),
    new THREE.Vector2(0.055, 0.021),
    new THREE.Vector2(0.0, 0.021),
  ];
  const geo = new THREE.LatheGeometry(profile, 28);
  geo.computeVertexNormals();
  cachedCeramicBasinGeo = geo;
  return geo;
}

function getBeveledBoxGeometry(wM: number, hM: number, tM: number, radiusM = 0.0025): RoundedBoxGeometry {
  const safeR = Math.min(radiusM, wM * 0.25, hM * 0.25, tM * 0.32);
  const key = `${wM.toFixed(4)}_${hM.toFixed(4)}_${tM.toFixed(4)}_${safeR.toFixed(4)}`;
  const cached = beveledGeoCache.get(key);
  if (cached) return cached;

  // Lightweight 1-segment chamfer (~4x fewer triangles than multi-segment rounds, crisp specular edges at 60 FPS)
  const geo = new RoundedBoxGeometry(wM, hM, tM, 1, safeR);
  // Keep cache bounded
  if (beveledGeoCache.size > 400) {
    const firstKey = beveledGeoCache.keys().next().value;
    if (firstKey) {
      beveledGeoCache.get(firstKey)?.dispose();
      beveledGeoCache.delete(firstKey);
    }
  }
  beveledGeoCache.set(key, geo);
  return geo;
}

/**
 * Pentagonal extruded geometry clipping the (-X, +Z) local front-left corner
 * (corresponding to (-wM/2, +hM/2) in shape XY before the [PI/2, 0, 0] rotation)
 * so pan-coupe carcass plates and shelves match the 45° diagonal front cleanly.
 */
function getChamferedPanelGeometry(
  wM: number,
  hM: number,
  tM: number,
  chamferM: number
): THREE.ExtrudeGeometry {
  const safeC = Math.max(0.01, Math.min(chamferM, wM * 0.9, hM * 0.9));
  const key = `${wM.toFixed(4)}_${hM.toFixed(4)}_${tM.toFixed(4)}_${safeC.toFixed(4)}`;
  const cached = chamferedGeoCache.get(key);
  if (cached) return cached;

  const hw = wM / 2;
  const hh = hM / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw + safeC, hh);
  shape.lineTo(-hw, hh - safeC);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: tM, bevelEnabled: false });
  geo.translate(0, 0, -tM / 2);
  geo.computeVertexNormals();

  if (chamferedGeoCache.size > 160) {
    const firstKey = chamferedGeoCache.keys().next().value;
    if (firstKey) {
      chamferedGeoCache.get(firstKey)?.dispose();
      chamferedGeoCache.delete(firstKey);
    }
  }
  chamferedGeoCache.set(key, geo);
  return geo;
}

function getBoxEdgesGeometry(wM: number, hM: number, tM: number): THREE.EdgesGeometry {
  const key = `${wM.toFixed(4)}_${hM.toFixed(4)}_${tM.toFixed(4)}`;
  const cached = boxEdgeGeoCache.get(key);
  if (cached) return cached;

  const tmp = new THREE.BoxGeometry(wM + 0.0006, hM + 0.0006, tM + 0.0006);
  const edges = new THREE.EdgesGeometry(tmp, 25);
  tmp.dispose();
  if (boxEdgeGeoCache.size > 400) {
    const firstKey = boxEdgeGeoCache.keys().next().value;
    if (firstKey) {
      boxEdgeGeoCache.get(firstKey)?.dispose();
      boxEdgeGeoCache.delete(firstKey);
    }
  }
  boxEdgeGeoCache.set(key, edges);
  return edges;
}

interface HandleMeshProps {
  panel: PanelSpec;
  handleStyle: HandleStyle;
  handleVerticalPlacement?: 'bottom' | 'center' | 'top';
}

function PanelHandleMesh({
  panel,
  handleStyle,
  handleVerticalPlacement = 'top',
}: HandleMeshProps) {
  if (handleStyle === 'push') return null;
  if (panel.role !== 'porte' && panel.role !== 'tiroir_facade') return null;
  // Never mount a handle onto a fixed blind corner filler panel
  if (panel.role === 'porte' && !panel.animationMeta && panel.nameFr.toLowerCase().includes('fixe')) {
    return null;
  }

  const w = panel.widthMm * MM;
  const h = panel.heightMm * MM;
  const t = panel.thicknessMm * MM;
  const zFront = t / 2 + 0.012;

  if (handleStyle === 'gorge') {
    const gorgeY = handleVerticalPlacement === 'bottom' ? -h / 2 + 0.014 : h / 2 - 0.014;
    return (
      <mesh position={[0, gorgeY, t / 2 + 0.002]} material={SHARED_HANDLE_GORGE_MATERIAL}>
        <boxGeometry args={[Math.max(0.05, w - 0.01), 0.022, 0.006]} />
      </mesh>
    );
  }

  // Position handle near opening edge for doors (bottom for upper cabinets, top/ergonomic for base), or top for drawers
  let hx = 0;
  let hy = 0;
  const isDoor = panel.role === 'porte';
  if (isDoor) {
    const isLeft = panel.animationMeta?.kind === 'hinged_left';
    const isSliding = panel.animationMeta?.kind === 'sliding';
    if (isSliding) {
      hx = panel.animationMeta?.index === 0 ? -w / 2 + 0.045 : w / 2 - 0.045;
      hy = 0;
    } else {
      hx = isLeft ? w / 2 - 0.038 : -w / 2 + 0.038;
      if (handleVerticalPlacement === 'bottom') {
        hy = -h / 2 + Math.min(0.14, h * 0.24);
      } else if (handleVerticalPlacement === 'center') {
        hy = 0;
      } else {
        hy = h > 1.2 ? -0.1 : h * 0.25;
      }
    }
  } else {
    hx = 0;
    hy = Math.min(0.05, h * 0.22);
  }

  if (handleStyle === 'knob') {
    return (
      <mesh
        position={[hx, hy, zFront]}
        rotation={[Math.PI / 2, 0, 0]}
        material={SHARED_HANDLE_CHROME_MATERIAL}
      >
        <cylinderGeometry args={[0.012, 0.01, 0.022, 14]} />
      </mesh>
    );
  }

  // Merged 1-draw-call brushed metal bar handle + twin standoffs (P4)
  const barLen = isDoor ? Math.min(0.18, h * 0.45) : Math.min(0.22, w * 0.45);
  const barGeo = useMemo(() => getMergedBarHandleGeometry(barLen), [barLen]);
  return (
    <mesh
      position={[hx, hy, zFront]}
      rotation={[0, 0, isDoor ? 0 : Math.PI / 2]}
      geometry={barGeo}
      material={SHARED_HANDLE_CHROME_MATERIAL}
    />
  );
}

interface AnimatedPanelProps {
  moduleId: string;
  panel: PanelSpec;
  handleStyle: HandleStyle;
  handleVerticalPlacement?: 'bottom' | 'center' | 'top';
  isOpen: boolean;
  isColliding: boolean;
  colorOverrideHex?: string;
  doorVisualStyle?: 'solid' | 'mirror' | 'glass';
  glassFrameWidthMm?: number;
  glassTintHex?: string;
  glassOpacity?: number;
  showEdgeLines?: boolean;
}

function Panel3DMesh({
  moduleId,
  panel,
  handleStyle,
  handleVerticalPlacement = 'top',
  isOpen,
  isColliding,
  colorOverrideHex,
  doorVisualStyle = 'solid',
  glassFrameWidthMm,
  glassTintHex,
  glassOpacity,
  showEdgeLines = false,
}: AnimatedPanelProps) {
  const { invalidate } = useThree();
  const animGroupRef = useRef<THREE.Group>(null);
  const progressRef = useRef(0);

  const wM = panel.widthMm * MM;
  const hM = panel.heightMm * MM;
  const tM = panel.thicknessMm * MM;

  const isFacade = panel.role === 'porte' || panel.role === 'tiroir_facade';
  const isCountertop = panel.role === 'plan_travail';
  const useBevel = isFacade || isCountertop;

  const useChamfer = Boolean(panel.chamferFrontCornerMm && panel.chamferFrontCornerMm > 2);
  const chamferGeo = useMemo(
    () =>
      useChamfer
        ? getChamferedPanelGeometry(wM, hM, tM, (panel.chamferFrontCornerMm ?? 0) * MM)
        : null,
    [useChamfer, wM, hM, tM, panel.chamferFrontCornerMm]
  );

  const beveledGeo = useMemo(
    () =>
      useBevel && !useChamfer
        ? getBeveledBoxGeometry(wM, hM, tM, isCountertop ? 0.003 : 0.0022)
        : null,
    [useBevel, useChamfer, isCountertop, wM, hM, tM]
  );

  // Cached crisp crease outline strictly mounted only when SketchUp Pro edge lines are enabled (P4)
  const edgesGeo = useMemo(
    () => (showEdgeLines && !useChamfer ? getBoxEdgesGeometry(wM, hM, tM) : null),
    [showEdgeLines, useChamfer, wM, hM, tM]
  );
  const edgeMat = getSharedEdgeLineMaterial();

  const material = useMemo(() => {
    if (!isColliding && panel.role === 'porte' && doorVisualStyle === 'mirror') {
      return SHARED_MIRROR_MATERIAL;
    }
    return getPbrMaterial(panel.materialId, panel.grain, {
      repeatX: Math.max(0.5, wM),
      repeatY: Math.max(0.5, hM),
      collisionTint: isColliding,
      colorOverrideHex,
    });
  }, [panel.materialId, panel.grain, panel.role, doorVisualStyle, wM, hM, isColliding, colorOverrideHex]);

  const meta = panel.animationMeta;

  const applyPanelTransform = (p: number) => {
    if (!meta || !animGroupRef.current) return;
    if (meta.kind === 'hinged_left') {
      animGroupRef.current.rotation.y = -p * 1.65;
    } else if (meta.kind === 'hinged_right') {
      animGroupRef.current.rotation.y = p * 1.65;
    } else if (meta.kind === 'sliding') {
      const travel = ((meta.slideTravelMm ?? 0) * MM) * (meta.slideDirection ?? 1);
      animGroupRef.current.position.x = p * travel;
    } else if (meta.kind === 'drawer') {
      const travel = ((meta.slideTravelMm ?? 380) * MM) * (meta.slideDirection ?? 1);
      animGroupRef.current.position.z = p * travel;
    }
  };

  useEffect(() => {
    if (!meta) return;
    return registerVideoFrameApplier((frame) => {
      if (!animGroupRef.current) return;
      if (frame) {
        const p = frame.moduleDoorProgress[moduleId] ?? 0;
        progressRef.current = p;
        applyPanelTransform(p);
      } else {
        const p = isOpen ? 1 : 0;
        progressRef.current = p;
        applyPanelTransform(p);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId, meta, isOpen]);

  useFrame((_, delta) => {
    if (!meta || !animGroupRef.current) return;
    const videoFrame = getActiveVideoFrame();
    if (videoFrame) {
      const p = videoFrame.moduleDoorProgress[moduleId] ?? 0;
      progressRef.current = p;
      applyPanelTransform(p);
      return;
    }

    const target = isOpen ? 1 : 0;
    if (Math.abs(target - progressRef.current) < 0.0005) {
      progressRef.current = target;
      return;
    }
    const speed = 7.5;
    const next = THREE.MathUtils.lerp(progressRef.current, target, Math.min(1, delta * speed));
    if (Math.abs(next - progressRef.current) < 0.0005 && Math.abs(target - next) < 0.0005) {
      progressRef.current = target;
    } else {
      progressRef.current = next;
      // Keep on-demand frameloop animating smoothly until settled
      invalidate();
    }
    applyPanelTransform(progressRef.current);
  });

  // Translucent framed glass door: 4 outer frame stiles/rails + genuinely transparent center pane
  const isGlazedDoor = panel.role === 'porte' && doorVisualStyle === 'glass';
  const requestedFrameM = Math.max(15, Math.min(120, glassFrameWidthMm ?? 52)) * MM;
  const frameBar = Math.max(0.015, Math.min(requestedFrameM, Math.min(wM, hM) * 0.38));
  const innerGlassW = Math.max(0.03, wM - frameBar * 2);
  const innerGlassH = Math.max(0.03, hM - frameBar * 2);
  const glassMaterial = useMemo(
    () => (isGlazedDoor ? getGlassDoorMaterial(glassTintHex, glassOpacity) : SHARED_GLASS_DOOR_MATERIAL),
    [isGlazedDoor, glassTintHex, glassOpacity]
  );

  const renderDoorGeometryContent = () => {
    if (!isGlazedDoor) {
      return (
        <>
          {!beveledGeo && <boxGeometry args={[wM, hM, tM]} />}
          {edgesGeo && <lineSegments geometry={edgesGeo} material={edgeMat} raycast={NO_RAYCAST} />}
          {facadeReveal}
          <PanelHandleMesh
            panel={panel}
            handleStyle={handleStyle}
            handleVerticalPlacement={handleVerticalPlacement}
          />
        </>
      );
    }

    return (
      <group>
        {/* Top & bottom frame rails */}
        <mesh position={[0, hM / 2 - frameBar / 2, 0]} material={material} castShadow receiveShadow>
          <boxGeometry args={[wM, frameBar, tM]} />
        </mesh>
        <mesh position={[0, -hM / 2 + frameBar / 2, 0]} material={material} castShadow receiveShadow>
          <boxGeometry args={[wM, frameBar, tM]} />
        </mesh>
        {/* Left & right frame stiles */}
        <mesh position={[-wM / 2 + frameBar / 2, 0, 0]} material={material} castShadow receiveShadow>
          <boxGeometry args={[frameBar, innerGlassH, tM]} />
        </mesh>
        <mesh position={[wM / 2 - frameBar / 2, 0, 0]} material={material} castShadow receiveShadow>
          <boxGeometry args={[frameBar, innerGlassH, tM]} />
        </mesh>
        {/* Genuinely transparent glass pane with customizable tint & opacity */}
        <mesh position={[0, 0, 0]} material={glassMaterial} raycast={NO_RAYCAST}>
          <boxGeometry args={[innerGlassW, innerGlassH, 0.005]} />
        </mesh>
        <PanelHandleMesh
          panel={panel}
          handleStyle={handleStyle}
          handleVerticalPlacement={handleVerticalPlacement}
        />
      </group>
    );
  };

  // Crisp dark shadow reveal trim along the rear perimeter of facades (creates 2-3 mm architectural joint depth)
  const facadeReveal = isFacade && !isGlazedDoor ? (
    <mesh
      position={[0, 0, -tM / 2 - 0.0008]}
      material={SHARED_REVEAL_MATERIAL}
      raycast={NO_RAYCAST}
    >
      <boxGeometry args={[wM + 0.0018, hM + 0.0018, 0.0012]} />
    </mesh>
  ) : null;

  // Hinged door uses pivot group at pivotMm
  if (meta && (meta.kind === 'hinged_left' || meta.kind === 'hinged_right') && meta.pivotMm) {
    const px = meta.pivotMm[0] * MM;
    const py = meta.pivotMm[1] * MM;
    const pz = meta.pivotMm[2] * MM;
    const ox = (panel.positionMm[0] - meta.pivotMm[0]) * MM;
    const oy = (panel.positionMm[1] - meta.pivotMm[1]) * MM;
    const oz = (panel.positionMm[2] - meta.pivotMm[2]) * MM;

    if (isGlazedDoor) {
      return (
        <group ref={animGroupRef} position={[px, py, pz]}>
          <group name={panel.id} position={[ox, oy, oz]} rotation={panel.rotationRad}>
            {renderDoorGeometryContent()}
          </group>
        </group>
      );
    }

    return (
      <group ref={animGroupRef} position={[px, py, pz]}>
        <mesh
          name={panel.id}
          position={[ox, oy, oz]}
          rotation={panel.rotationRad}
          geometry={beveledGeo ?? undefined}
          material={material}
          castShadow
          receiveShadow
        >
          {renderDoorGeometryContent()}
        </mesh>
      </group>
    );
  }

  // Sliding door or drawer translates via wrapper group
  if (meta && (meta.kind === 'sliding' || meta.kind === 'drawer')) {
    if (isGlazedDoor) {
      return (
        <group ref={animGroupRef}>
          <group
            name={panel.id}
            position={[panel.positionMm[0] * MM, panel.positionMm[1] * MM, panel.positionMm[2] * MM]}
            rotation={panel.rotationRad}
          >
            {renderDoorGeometryContent()}
          </group>
        </group>
      );
    }
    return (
      <group ref={animGroupRef}>
        <mesh
          name={panel.id}
          position={[panel.positionMm[0] * MM, panel.positionMm[1] * MM, panel.positionMm[2] * MM]}
          rotation={panel.rotationRad}
          geometry={beveledGeo ?? undefined}
          material={material}
          castShadow
          receiveShadow
        >
          {renderDoorGeometryContent()}
        </mesh>
      </group>
    );
  }

  // Static panel (pentagonal chamfer for pan-coupe plates/shelves, beveled for countertops)
  const staticGeo = chamferGeo ?? beveledGeo;
  return (
    <mesh
      name={panel.id}
      position={[panel.positionMm[0] * MM, panel.positionMm[1] * MM, panel.positionMm[2] * MM]}
      rotation={panel.rotationRad}
      geometry={staticGeo ?? undefined}
      material={material}
      castShadow
      receiveShadow
    >
      {!staticGeo && <boxGeometry args={[wM, hM, tM]} />}
      {edgesGeo && <lineSegments geometry={edgesGeo} material={edgeMat} raycast={NO_RAYCAST} />}
    </mesh>
  );
}

interface ParametricModuleMeshProps {
  module: ModuleInstance;
  output: ModuleOutput;
  defaults: CarpentryParams;
  isSelected: boolean;
  isColliding: boolean;
  isOpen: boolean;
  ledEnabled: boolean;
  allowLedPointLight: boolean;
  ledLightIntensity?: number;
  ledEmissiveIntensity?: number;
  isCapturingRender: boolean;
  isClientMode?: boolean;
  showEdgeLines?: boolean;
  autoCabinetCutaway?: boolean;
  wallMetrics?: WallMetrics[];
  roomCenterM?: [number, number];
}

export function ParametricModuleMesh({
  module,
  output,
  defaults,
  isSelected,
  isColliding,
  isOpen,
  ledEnabled,
  allowLedPointLight,
  ledLightIntensity = 1.8,
  ledEmissiveIntensity = 3.2,
  isCapturingRender,
  isClientMode = false,
  showEdgeLines = false,
  autoCabinetCutaway = false,
  wallMetrics = [],
  roomCenterM,
}: ParametricModuleMeshProps) {
  const { camera, gl, invalidate } = useThree();
  const selectEntity = useUIStore((s) => s.selectEntity);
  const toggleSelectEntity = useUIStore((s) => s.toggleSelectEntity);
  const toggleModuleOpen = useUIStore((s) => s.toggleModuleOpen);
  const setIsDragging3D = useUIStore((s) => s.setIsDragging3D);

  const groupRef = useRef<THREE.Group | null>(null);
  const interiorGroupRef = useRef<THREE.Group | null>(null);
  const openProgressRef = useRef<number>(isOpen ? 1 : 0);
  const lastCabinetCutRef = useRef<boolean | null>(null);
  const justDraggedAtRef = useRef<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useFrame(() => {
    if (!groupRef.current) return;
    const cut =
      autoCabinetCutaway && roomCenterM
        ? shouldCutawayWallAttachedItem(
            {
              xMm: module.xMm,
              zMm: module.zMm,
              depthMm: module.depthMm,
              attachedWallId: module.attachedWallId,
              isFreestandingOnly: module.type === 'ilot_central',
            },
            wallMetrics,
            [camera.position.x, camera.position.y, camera.position.z],
            roomCenterM
          )
        : false;
    if (lastCabinetCutRef.current !== cut) {
      lastCabinetCutRef.current = cut;
      applyCutawayRaycast(groupRef.current, cut);
    }
  });

  // C7.3: Guarantee window drag listeners + history state clean up if module unmounts mid-drag
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const params = useMemo(() => resolveParams(module, defaults), [module, defaults]);
  const hasAnimatedPanels = useMemo(
    () => output.panels.some((p) => Boolean(p.animationMeta)),
    [output.panels]
  );

  const isGlazedCabinet =
    module.facadeKind === 'vitre' ||
    module.type === 'meuble_haut_vitre' ||
    module.type === 'meuble_vitrine';

  // Interior culling: modules with opaque closing doors/drawers hide interior shelves/drawer boxes when closed
  const hasClosedOpaqueFront = useMemo(() => {
    if (isGlazedCabinet || module.type === 'bibliotheque') {
      return false;
    }
    return output.panels.some((p) => p.role === 'porte' || p.role === 'tiroir_facade');
  }, [isGlazedCabinet, module.type, output.panels]);

  const { exteriorPanels, interiorPanels } = useMemo(() => {
    const ext: PanelSpec[] = [];
    const intr: PanelSpec[] = [];
    for (const p of output.panels) {
      if (p.isInterior) intr.push(p);
      else ext.push(p);
    }
    return { exteriorPanels: ext, interiorPanels: intr };
  }, [output.panels]);

  // Imperative Studio Vidéo applier: synchronous assembly entrance + interior visibility for offline frame-by-frame export
  useEffect(() => {
    return registerVideoFrameApplier((frame) => {
      if (!groupRef.current) return;
      if (!frame) {
        groupRef.current.visible = true;
        groupRef.current.scale.set(1, 1, 1);
        groupRef.current.position.set(module.xMm * MM, module.yMm * MM, module.zMm * MM);
        if (interiorGroupRef.current) {
          interiorGroupRef.current.visible = !hasClosedOpaqueFront || openProgressRef.current > 0.01;
        }
        return;
      }
      const asm = frame.moduleAssembly[module.id];
      if (asm) {
        groupRef.current.visible = asm.visible;
        groupRef.current.scale.setScalar(asm.scale);
        groupRef.current.position.set(
          module.xMm * MM,
          (module.yMm + asm.yOffsetMm) * MM,
          module.zMm * MM
        );
      }
      const doorP = frame.moduleDoorProgress[module.id] ?? 0;
      openProgressRef.current = doorP;
      if (interiorGroupRef.current) {
        interiorGroupRef.current.visible = !hasClosedOpaqueFront || doorP > 0.01;
      }
    });
  }, [module.id, module.xMm, module.yMm, module.zMm, hasClosedOpaqueFront]);

  useFrame((_, delta) => {
    if (getActiveVideoFrame()) return;
    const target = isOpen ? 1 : 0;
    if (Math.abs(target - openProgressRef.current) > 0.001) {
      openProgressRef.current = THREE.MathUtils.lerp(
        openProgressRef.current,
        target,
        Math.min(1, delta * 7.5)
      );
      if (Math.abs(target - openProgressRef.current) <= 0.001) {
        openProgressRef.current = target;
      } else {
        invalidate();
      }
    }
    if (interiorGroupRef.current) {
      interiorGroupRef.current.visible = !hasClosedOpaqueFront || openProgressRef.current > 0.01;
    }
  });

  const showLed =
    ledEnabled &&
    (Boolean(module.ledUnder) ||
      module.type === 'caisson_haut' ||
      module.type === 'meuble_haut_vitre' ||
      module.type === 'caisson_haut_angle_aveugle' ||
      module.type === 'caisson_haut_relevant' ||
      module.type === 'armoire_miroir_led');
  const allowDrag = !isClientMode && !isCapturingRender;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!allowDrag || e.button !== 0) return;
    // STRICT DIRECT-HIT ONLY: never start a drag unless the frontmost raycast hit is this module's mesh
    if (!isDirectFirstHit(e.intersections, groupRef.current)) return;
    e.stopPropagation();

    if (e.shiftKey) {
      toggleSelectEntity(module.id, 'module');
      invalidate();
      return;
    }
    selectEntity(module.id, 'module');

    const pointerId = e.pointerId;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialHit = e.point.clone();

    const offsetX = module.xMm - initialHit.x * 1000;
    const offsetY = module.yMm - initialHit.y * 1000;
    const offsetZ = module.zMm - initialHit.z * 1000;

    // Drag plane is strictly lazily created ONLY after crossing the 5px threshold
    let dragPlane: THREE.Plane | null = null;
    let useVerticalWallPlane = false;
    let dragStarted = false;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    const activateDragPlane = () => {
      const docSnapshot = useProjectStore.getState().document;
      const wallMetrics = analyzeWalls(docSnapshot.walls);
      const attachedWm = module.attachedWallId
        ? wallMetrics.find((w) => w.wall.id === module.attachedWallId)
        : undefined;
      const isWallHung =
        module.type === 'caisson_haut' ||
        module.type === 'meuble_haut_vitre' ||
        module.type === 'caisson_haut_angle' ||
        module.type === 'caisson_haut_angle_aveugle' ||
        module.type === 'caisson_sur_frigo' ||
        module.type === 'caisson_haut_relevant' ||
        module.type === 'armoire_miroir_led' ||
        module.type === 'meuble_vasque' ||
        module.type === 'meuble_double_vasque' ||
        module.type === 'colonne_sdb' ||
        module.type === 'credence';

      useVerticalWallPlane = false;
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -initialHit.y);

      if (isWallHung && attachedWm) {
        const nVec = new THREE.Vector3(
          attachedWm.inwardNormal.x,
          0,
          attachedWm.inwardNormal.z
        ).normalize();
        const camDir = new THREE.Vector3();
        camera.getWorldDirection(camDir);
        if (Math.abs(camDir.dot(nVec)) > 0.22) {
          useVerticalWallPlane = true;
          dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(nVec, initialHit);
        }
      }
    };

    const onPointerMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!dragStarted) {
        if (!shouldStartDrag(startClientX, startClientY, ev.clientX, ev.clientY, DRAG_THRESHOLD_PX)) {
          return;
        }
        dragStarted = true;
        activateDragPlane();
        pauseHistory();
        setIsDragging3D(true);
        gl.domElement.style.cursor = 'grabbing';
      }

      if (!dragPlane) return;

      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;

      const storeState = useProjectStore.getState();
      const currentDoc = storeState.document;
      const liveMod = currentDoc.modules.find((m) => m.id === module.id);
      if (!liveMod) return;

      const snap10 = (v: number) => Math.round(v / 10) * 10;
      const rawX = snap10(hitPoint.x * 1000 + offsetX);
      const rawZ = snap10(hitPoint.z * 1000 + offsetZ);
      const rawY = useVerticalWallPlane
        ? Math.max(
            0,
            Math.min(
              currentDoc.ceilingHeightMm - liveMod.heightMm,
              snap10(hitPoint.y * 1000 + offsetY)
            )
          )
        : liveMod.yMm;

      const snapped = snapModulePosition(
        { ...liveMod, xMm: rawX, yMm: rawY, zMm: rawZ },
        currentDoc.walls,
        currentDoc.modules,
        { ceilingHeightMm: currentDoc.ceilingHeightMm }
      );

      storeState.updateModule(liveMod.id, {
        xMm: snapped.xMm,
        yMm: snapped.yMm,
        zMm: snapped.zMm,
        rotationYRad: snapped.rotationYRad,
        attachedWallId: snapped.attachedWallId,
      });
      invalidate();
    };

    const cleanup = () => {
      dragCleanupRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
      dragPlane = null;
      gl.domElement.style.cursor = '';

      if (dragStarted) {
        dragStarted = false;
        setIsDragging3D(false);
        justDraggedAtRef.current = performance.now();
        resumeHistory();
        const latestDoc = useProjectStore.getState().document;
        useProjectStore.getState().setDocument({ ...latestDoc });
      }
    };

    const onPointerUp = (ev?: Event) => {
      if (ev instanceof PointerEvent && ev.pointerId !== pointerId) return;
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    window.addEventListener('blur', onPointerUp);
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!isDirectFirstHit(e.intersections, groupRef.current)) return;
    e.stopPropagation();
    if (e.shiftKey) return;
    // Ignore click immediately following a 3D drag
    if (performance.now() - justDraggedAtRef.current < 260) {
      return;
    }
    if (!isClientMode) {
      selectEntity(module.id, 'module');
    }
    if (hasAnimatedPanels) {
      toggleModuleOpen(module.id);
      invalidate();
    }
  };

  // Subtle ambient occlusion shadow pad under floor-standing cabinets
  const showFloorAo = module.yMm <= 5 && module.type !== 'plinthe';
  const showSlidingRails = module.type === 'portes_coulissantes';
  const showHangingRod =
    module.type === 'dressing_penderie' ||
    module.type === 'portes_battantes' ||
    module.type === 'portes_coulissantes';
  const showBuiltInOven =
    module.type === 'colonne' && module.colonneVariant === 'four' && module.heightMm >= 1600;
  const plinthH =
    module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, module.heightMm - 250));
  const innerSpanM = Math.max(0.12, (module.widthMm - params.boardThickness * 2) * MM);
  const ovenCenterYM = (plinthH + 740 + 295) * MM;
  const ovenFrontZM = (module.depthMm / 2 - params.boardThickness * 0.45) * MM;

  const resolvePanelColorOverride = (panel: PanelSpec): string | undefined => {
    const slot = panel.surfaceSlot;
    if (slot === 'facade' || panel.role === 'porte' || panel.role === 'tiroir_facade' || panel.role === 'plinthe') {
      return params.facadeColorOverride;
    }
    if (slot === 'countertop' || panel.role === 'plan_travail' || panel.role === 'credence') {
      return params.countertopColorOverride;
    }
    return params.carcassColorOverride;
  };

  const doorVisualStyle: 'solid' | 'mirror' | 'glass' =
    module.type === 'armoire_miroir_led'
      ? 'mirror'
      : isGlazedCabinet
        ? 'glass'
        : 'solid';

  const isUpperCabinet =
    module.type === 'caisson_haut' ||
    module.type === 'meuble_haut_vitre' ||
    module.type === 'caisson_haut_angle' ||
    module.type === 'caisson_haut_angle_aveugle' ||
    module.type === 'caisson_sur_frigo' ||
    module.type === 'caisson_haut_relevant' ||
    module.type === 'armoire_miroir_led' ||
    module.yMm >= 1100;

  const handleVerticalPlacement: 'bottom' | 'center' | 'top' =
    module.handlePositionY && module.handlePositionY !== 'auto'
      ? module.handlePositionY
      : isUpperCabinet
        ? 'bottom'
        : 'top';

  const showInteriorLed =
    ledEnabled && (Boolean(module.ledInterior) || module.type === 'meuble_vitrine');
  const ledColorHex = module.ledColorHex ?? '#ffcf87';
  const ledMult = Math.max(0.1, Math.min(2.5, module.ledIntensity ?? 1.0));
  const ledInteriorWrap = module.ledInteriorWrap !== false;

  const ledInnerBottomM = (plinthH + params.boardThickness + 8) * MM;
  const ledInnerTopM = Math.max(
    ledInnerBottomM + 0.12,
    (module.heightMm - params.boardThickness - 8) * MM
  );
  const ledInnerHeightM = Math.max(0.12, ledInnerTopM - ledInnerBottomM);
  const ledInnerMidYM = (ledInnerBottomM + ledInnerTopM) / 2;
  const ledInnerSpanM = Math.max(0.12, innerSpanM - 0.014);
  const ledPerimeterZM = Math.max(
    -module.depthMm * MM * 0.35,
    (module.depthMm * 0.5 - params.boardThickness - 24) * MM
  );

  const showBathroomBasin =
    module.type === 'meuble_vasque' || module.type === 'meuble_double_vasque';
  const basinOffsets =
    module.type === 'meuble_double_vasque'
      ? [-module.widthMm * MM * 0.24, module.widthMm * MM * 0.24]
      : [0];

  return (
    <group
      ref={groupRef}
      name={`Module_${module.ref}`}
      position={[module.xMm * MM, module.yMm * MM, module.zMm * MM]}
      rotation={[0, module.rotationYRad, 0]}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      onPointerOver={
        allowDrag
          ? (e) => {
              if (!isDirectFirstHit(e.intersections, groupRef.current)) return;
              e.stopPropagation();
              if (!useUIStore.getState().isDragging3D) {
                gl.domElement.style.cursor = 'grab';
              }
            }
          : undefined
      }
      onPointerOut={
        allowDrag
          ? () => {
              if (!useUIStore.getState().isDragging3D) {
                gl.domElement.style.cursor = '';
              }
            }
          : undefined
      }
    >
      {/* Always-visible exterior carcass & facade panels */}
      {exteriorPanels.map((panel) => (
        <Panel3DMesh
          key={panel.id}
          moduleId={module.id}
          panel={panel}
          handleStyle={params.handleStyle}
          handleVerticalPlacement={handleVerticalPlacement}
          isOpen={isOpen}
          isColliding={isColliding && !isCapturingRender && !isClientMode}
          colorOverrideHex={resolvePanelColorOverride(panel)}
          doorVisualStyle={doorVisualStyle}
          glassFrameWidthMm={module.glassFrameWidthMm}
          glassTintHex={module.glassTintHex}
          glassOpacity={module.glassOpacity}
          showEdgeLines={showEdgeLines}
        />
      ))}

      {/* Interior Culling Group: hidden when closed-door cabinet openProgress <= 0.01 */}
      <group ref={interiorGroupRef} visible={!hasClosedOpaqueFront || isOpen}>
        {interiorPanels.map((panel) => (
          <Panel3DMesh
            key={panel.id}
            moduleId={module.id}
            panel={panel}
            handleStyle={params.handleStyle}
            handleVerticalPlacement={handleVerticalPlacement}
            isOpen={isOpen}
            isColliding={isColliding && !isCapturingRender && !isClientMode}
            colorOverrideHex={resolvePanelColorOverride(panel)}
            doorVisualStyle={doorVisualStyle}
            glassFrameWidthMm={module.glassFrameWidthMm}
            glassTintHex={module.glassTintHex}
            glassOpacity={module.glassOpacity}
            showEdgeLines={showEdgeLines}
          />
        ))}

        {/* Chrome hanging rod (tringle penderie) with end brackets (culled when doors closed) */}
        {showHangingRod && (
          <group position={[0, Math.max(plinthH * MM + 0.9, (module.heightMm - 260) * MM), -0.02]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={SHARED_HANDLE_CHROME_MATERIAL}>
              <cylinderGeometry args={[0.013, 0.013, innerSpanM, 14]} />
            </mesh>
            <mesh
              position={[-innerSpanM / 2 + 0.008, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
              material={SHARED_CHROME_SATIN_MATERIAL}
            >
              <cylinderGeometry args={[0.022, 0.022, 0.014, 10]} />
            </mesh>
            <mesh
              position={[innerSpanM / 2 - 0.008, 0, 0]}
              rotation={[0, 0, Math.PI / 2]}
              material={SHARED_CHROME_SATIN_MATERIAL}
            >
              <cylinderGeometry args={[0.022, 0.022, 0.014, 10]} />
            </mesh>
          </group>
        )}

        {/* Interior cabinet LED (full 4-side wrap-around perimeter strip + customizable color & intensity) */}
        {showInteriorLed && (
          <group>
            {/* Top horizontal LED strip */}
            <mesh position={[0, ledInnerTopM, ledPerimeterZM]} raycast={NO_RAYCAST}>
              <boxGeometry args={[ledInnerSpanM, 0.011, 0.016]} />
              <meshStandardMaterial
                color={ledColorHex}
                emissive={ledColorHex}
                emissiveIntensity={Math.max(0.4, Math.min(5.5, ledEmissiveIntensity * 1.15 * ledMult))}
                toneMapped={false}
              />
            </mesh>
            {ledInteriorWrap && (
              <>
                {/* Bottom horizontal LED strip */}
                <mesh position={[0, ledInnerBottomM, ledPerimeterZM]} raycast={NO_RAYCAST}>
                  <boxGeometry args={[ledInnerSpanM, 0.011, 0.016]} />
                  <meshStandardMaterial
                    color={ledColorHex}
                    emissive={ledColorHex}
                    emissiveIntensity={Math.max(0.4, Math.min(5.5, ledEmissiveIntensity * 1.05 * ledMult))}
                    toneMapped={false}
                  />
                </mesh>
                {/* Left vertical LED strip */}
                <mesh
                  position={[-ledInnerSpanM / 2 + 0.006, ledInnerMidYM, ledPerimeterZM]}
                  raycast={NO_RAYCAST}
                >
                  <boxGeometry args={[0.011, ledInnerHeightM, 0.016]} />
                  <meshStandardMaterial
                    color={ledColorHex}
                    emissive={ledColorHex}
                    emissiveIntensity={Math.max(0.4, Math.min(5.5, ledEmissiveIntensity * 1.05 * ledMult))}
                    toneMapped={false}
                  />
                </mesh>
                {/* Right vertical LED strip */}
                <mesh
                  position={[ledInnerSpanM / 2 - 0.006, ledInnerMidYM, ledPerimeterZM]}
                  raycast={NO_RAYCAST}
                >
                  <boxGeometry args={[0.011, ledInnerHeightM, 0.016]} />
                  <meshStandardMaterial
                    color={ledColorHex}
                    emissive={ledColorHex}
                    emissiveIntensity={Math.max(0.4, Math.min(5.5, ledEmissiveIntensity * 1.05 * ledMult))}
                    toneMapped={false}
                  />
                </mesh>
              </>
            )}
            <pointLight
              position={[0, ledInnerMidYM, Math.min(0.04, ledPerimeterZM - 0.04)]}
              color={ledColorHex}
              intensity={
                (allowLedPointLight ? Math.min(1.15, ledLightIntensity * 0.36) : 0.45) * ledMult
              }
              distance={1.15}
              decay={2}
            />
          </group>
        )}
      </group>

      {/* Sculpted Hollow Ceramic Basin(s) (LatheGeometry) & Mixer Tap(s) for Salle de Bain */}
      {showBathroomBasin && (
        <group position={[0, module.heightMm * MM, 0]}>
          {/* Ceramic vanity top slab */}
          <mesh position={[0, 0.016, 0]} castShadow receiveShadow material={SHARED_CERAMIC_TOP_MATERIAL}>
            <boxGeometry args={[module.widthMm * MM + 0.01, 0.032, module.depthMm * MM + 0.01]} />
          </mesh>
          {basinOffsets.map((bx, i) => (
            <group key={`vasque-${i}`} position={[bx, 0.032, 0.02]}>
              {/* Sculpted hollow ceramic vessel basin */}
              <mesh
                geometry={getCeramicBasinGeometry()}
                material={SHARED_CERAMIC_BASIN_MATERIAL}
                castShadow
                receiveShadow
              />
              {/* Recessed chrome pop-up waste drain plug inside inner bowl */}
              <mesh position={[0, 0.024, 0]} material={SHARED_DRAIN_CHROME_MATERIAL}>
                <cylinderGeometry args={[0.024, 0.024, 0.005, 18]} />
              </mesh>
              {/* Brushed chrome mixer tap (mitigeur) */}
              <mesh position={[0, 0.11, -0.195]} material={SHARED_HANDLE_CHROME_MATERIAL}>
                <cylinderGeometry args={[0.016, 0.018, 0.22, 12]} />
              </mesh>
              <mesh
                position={[0, 0.205, -0.135]}
                rotation={[Math.PI / 2, 0, 0]}
                material={SHARED_HANDLE_CHROME_MATERIAL}
              >
                <cylinderGeometry args={[0.01, 0.011, 0.12, 10]} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* Built-in Oven Architectural Detail (Colonne Four) */}
      {showBuiltInOven && (
        <group position={[0, ovenCenterYM, ovenFrontZM]}>
          {/* Matte black recessed oven body bezel */}
          <mesh castShadow receiveShadow material={SHARED_OVEN_BEZEL_MATERIAL}>
            <boxGeometry args={[Math.min(0.595, module.widthMm * MM - 0.006), 0.59, 0.022]} />
          </mesh>
          {/* Upper brushed stainless steel control panel */}
          <mesh position={[0, 0.235, 0.012]} material={SHARED_OVEN_STEEL_MATERIAL}>
            <boxGeometry args={[Math.min(0.585, module.widthMm * MM - 0.016), 0.095, 0.008]} />
          </mesh>
          {/* Digital display window */}
          <mesh position={[0, 0.235, 0.017]} material={SHARED_OVEN_DISPLAY_MATERIAL}>
            <boxGeometry args={[0.11, 0.036, 0.003]} />
          </mesh>
          {/* Rotary control knobs */}
          <mesh
            position={[-0.18, 0.235, 0.024]}
            rotation={[Math.PI / 2, 0, 0]}
            material={SHARED_HANDLE_CHROME_MATERIAL}
          >
            <cylinderGeometry args={[0.019, 0.021, 0.022, 16]} />
          </mesh>
          <mesh
            position={[0.18, 0.235, 0.024]}
            rotation={[Math.PI / 2, 0, 0]}
            material={SHARED_HANDLE_CHROME_MATERIAL}
          >
            <cylinderGeometry args={[0.019, 0.021, 0.022, 16]} />
          </mesh>
          {/* Dark tinted reflective oven glass door */}
          <mesh position={[0, -0.055, 0.013]} material={SHARED_OVEN_GLASS_MATERIAL}>
            <boxGeometry args={[Math.min(0.56, module.widthMm * MM - 0.036), 0.45, 0.01]} />
          </mesh>
          {/* Brushed stainless horizontal oven bar handle with standoffs */}
          <mesh position={[0, 0.135, 0.044]} castShadow material={SHARED_HANDLE_CHROME_MATERIAL}>
            <boxGeometry args={[Math.min(0.48, module.widthMm * MM - 0.1), 0.016, 0.014]} />
          </mesh>
          <mesh
            position={[-Math.min(0.2, module.widthMm * MM * 0.34), 0.135, 0.028]}
            material={SHARED_CHROME_SATIN_MATERIAL}
          >
            <boxGeometry args={[0.014, 0.014, 0.026]} />
          </mesh>
          <mesh
            position={[Math.min(0.2, module.widthMm * MM * 0.34), 0.135, 0.028]}
            material={SHARED_CHROME_SATIN_MATERIAL}
          >
            <boxGeometry args={[0.014, 0.014, 0.026]} />
          </mesh>
        </group>
      )}

      {/* Sleek brushed aluminum top & bottom rails for sliding wardrobes */}
      {showSlidingRails && (
        <>
          <mesh
            position={[
              0,
              (module.heightMm - 8) * MM,
              (module.depthMm / 2 - params.boardThickness - 4) * MM,
            ]}
            material={SHARED_CHROME_SATIN_MATERIAL}
          >
            <boxGeometry args={[module.widthMm * MM - 0.01, 0.016, (params.boardThickness * 2 + 8) * MM]} />
          </mesh>
          <mesh
            position={[
              0,
              (plinthH + 6) * MM,
              (module.depthMm / 2 - params.boardThickness - 4) * MM,
            ]}
            material={SHARED_CHROME_SATIN_MATERIAL}
          >
            <boxGeometry args={[module.widthMm * MM - 0.01, 0.012, (params.boardThickness * 2 + 8) * MM]} />
          </mesh>
        </>
      )}

      {/* Subtle floor ambient-occlusion contact shadow directly under cabinet plinth/base */}
      {showFloorAo && (
        <mesh
          position={[0, 0.0015, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={SHARED_FLOOR_AO_MATERIAL}
          raycast={NO_RAYCAST}
        >
          <planeGeometry args={[module.widthMm * MM + 0.04, module.depthMm * MM + 0.04]} />
        </mesh>
      )}

      {/* Under-cabinet LED strip */}
      {showLed && (
        <group position={[0, -0.008, module.depthMm * MM * 0.15]}>
          <mesh raycast={NO_RAYCAST}>
            <boxGeometry args={[Math.max(0.1, module.widthMm * MM - 0.06), 0.012, 0.022]} />
            <meshStandardMaterial
              color={ledColorHex}
              emissive={ledColorHex}
              emissiveIntensity={Math.max(0.3, Math.min(3.5, ledEmissiveIntensity * 0.65 * ledMult))}
              toneMapped={false}
            />
          </mesh>
          {allowLedPointLight && (
            <pointLight
              position={[0, -0.09, 0.05]}
              color={ledColorHex}
              intensity={Math.min(1.8, ledLightIntensity * 0.34 * ledMult)}
              distance={1.45}
              decay={2}
            />
          )}
        </group>
      )}

      {/* Selection wireframe (hidden in Vue Client and during PNG capture; never raycastable) */}
      {isSelected && !isCapturingRender && !isClientMode && (
        <mesh
          position={[0, (module.heightMm * MM) / 2, 0]}
          material={SHARED_SELECTION_WIRE_MATERIAL}
          raycast={NO_RAYCAST}
        >
          <boxGeometry
            args={[
              module.widthMm * MM + 0.012,
              module.heightMm * MM + 0.012,
              module.depthMm * MM + 0.012,
            ]}
          />
        </mesh>
      )}
    </group>
  );
}
