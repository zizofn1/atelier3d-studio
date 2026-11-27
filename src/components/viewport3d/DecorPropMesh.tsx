import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { PropFinishPreset, SceneProp } from '@/types';
import { PROPS_CATALOG_BY_TYPE } from '@/data/propsCatalog';
import {
  analyzeWalls,
  shouldCutawayWallAttachedItem,
  snapPropPosition,
  type WallMetrics,
} from '@/engine/geometry';
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

// Shared common materials across decor & appliance props (P4 GPU state dedup)
const PROP_MAT_DARK_GASKET = new THREE.MeshStandardMaterial({ color: '#18181b', roughness: 0.85 });
const PROP_MAT_DARK_METAL = new THREE.MeshStandardMaterial({ color: '#1f232a', metalness: 0.72, roughness: 0.34 });
const PROP_MAT_CHROME = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.9, roughness: 0.18 });
const PROP_MAT_DARK_CHROME = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.85, roughness: 0.25 });
const PROP_MAT_BRASS = new THREE.MeshStandardMaterial({ color: '#d1ad66', metalness: 0.88, roughness: 0.22 });
const PROP_MAT_DARK_GLASS = new THREE.MeshPhysicalMaterial({
  color: '#0c111b',
  roughness: 0.05,
  metalness: 0.14,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.85,
});
const PROP_MAT_OVEN_TEMPERED_GLASS = new THREE.MeshPhysicalMaterial({
  color: '#0b1019',
  transparent: true,
  opacity: 0.62,
  roughness: 0.05,
  metalness: 0.12,
  clearcoat: 1,
  clearcoatRoughness: 0.04,
  envMapIntensity: 1.8,
});
const PROP_MAT_CAVITY = new THREE.MeshStandardMaterial({
  color: '#1b1f27',
  roughness: 0.72,
  metalness: 0.25,
});
const PROP_MAT_LED_CYAN = new THREE.MeshStandardMaterial({
  color: '#090b10',
  emissive: '#38bdf8',
  emissiveIntensity: 0.8,
  toneMapped: false,
});
const PROP_MAT_LED_RED = new THREE.MeshStandardMaterial({
  color: '#7f1d1d',
  emissive: '#ef4444',
  emissiveIntensity: 1.25,
  toneMapped: false,
});
const PROP_MAT_SELECTION_WIRE = new THREE.MeshBasicMaterial({ color: '#38bdf8', wireframe: true });

// Lightweight cached chamfered box & swan-neck faucet geometries (zero per-render allocation)
const propChamferCache = new Map<string, RoundedBoxGeometry>();
function getPropChamferBox(w: number, h: number, d: number, r = 0.006): RoundedBoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(4)}`;
  const cached = propChamferCache.get(key);
  if (cached) return cached;
  const safeR = Math.min(r, w * 0.25, h * 0.25, d * 0.25);
  const geo = new RoundedBoxGeometry(w, h, d, 1, safeR);
  propChamferCache.set(key, geo);
  return geo;
}

let cachedSwanNeckGeo: THREE.TubeGeometry | null = null;
function getSwanNeckFaucetGeometry(): THREE.TubeGeometry {
  if (cachedSwanNeckGeo) return cachedSwanNeckGeo;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.05, 0),
    new THREE.Vector3(0, 0.22, 0),
    new THREE.Vector3(0, 0.32, 0.045),
    new THREE.Vector3(0, 0.34, 0.115),
    new THREE.Vector3(0, 0.29, 0.175),
    new THREE.Vector3(0, 0.235, 0.185),
  ]);
  cachedSwanNeckGeo = new THREE.TubeGeometry(curve, 24, 0.0105, 12, false);
  return cachedSwanNeckGeo;
}

/**
 * Real recessed 3D kitchen sink geometry (ExtrudeGeometry outer rim with genuine rectangular basin cutout
 * + recessed inner stainless/matte-black bowl walls & basket drain strainer, completely above countertop y=0).
 */
function RecessedKitchenSink3D({
  w,
  d,
  finish,
  fp,
}: {
  w: number;
  d: number;
  finish: PropFinishPreset | undefined;
  fp: { color: string; metalness: number; roughness: number };
}) {
  const rimH = 0.044; // 44 mm sculptural overmount profile -> real 38 mm 3D basin cavity without clipping countertop
  const lipT = 0.008;
  const bowlFloorY = 0.005;
  const wallH = rimH - bowlFloorY;
  const wallT = 0.007;

  const bowlW = Math.min(w * 0.52, Math.max(0.24, w - 0.14));
  const bowlD = Math.min(d * 0.76, Math.max(0.22, d - 0.12));
  const bowlCx = -w * 0.18;
  const bowlCz = 0.022;

  // Extruded top deck slab with real rectangular basin cutout
  const deckGeo = useMemo(() => {
    const hw = w / 2;
    const hd = d / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw, -hd);
    shape.lineTo(hw, -hd);
    shape.lineTo(hw, hd);
    shape.lineTo(-hw, hd);
    shape.closePath();

    // RotateX(-PI/2) maps shape (x, y) -> world (x, 0, -y), so use -bowlCz for hole Y
    const hx = bowlCx;
    const hy = -bowlCz;
    const hbw = bowlW / 2;
    const hbd = bowlD / 2;
    const hole = new THREE.Path();
    hole.moveTo(hx - hbw, hy - hbd);
    hole.lineTo(hx + hbw, hy - hbd);
    hole.lineTo(hx + hbw, hy + hbd);
    hole.lineTo(hx - hbw, hy + hbd);
    hole.closePath();
    shape.holes.push(hole);

    const geo = new THREE.ExtrudeGeometry(shape, { depth: lipT, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, [w, d, bowlW, bowlD, bowlCx, bowlCz]);

  useEffect(() => () => { deckGeo.dispose(); }, [deckGeo]);

  const innerColor = finish === 'noir_mat' ? '#12151b' : '#9aa3ae';
  const faucetMat = finish === 'noir_mat' ? PROP_MAT_DARK_METAL : PROP_MAT_CHROME;

  return (
    <group>
      {/* Solid outer perimeter skirt supporting the overmount deck cleanly on the countertop */}
      <mesh position={[0, (rimH - lipT) / 2, -d / 2 + 0.005]} castShadow receiveShadow>
        <boxGeometry args={[w, rimH - lipT, 0.01]} />
        <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
      </mesh>
      <mesh position={[0, (rimH - lipT) / 2, d / 2 - 0.005]} castShadow receiveShadow>
        <boxGeometry args={[w, rimH - lipT, 0.01]} />
        <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
      </mesh>
      <mesh position={[-w / 2 + 0.005, (rimH - lipT) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.01, rimH - lipT, d]} />
        <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
      </mesh>
      <mesh position={[w / 2 - 0.005, (rimH - lipT) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.01, rimH - lipT, d]} />
        <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
      </mesh>

      {/* Extruded top rim plate with real cutout opening */}
      <mesh geometry={deckGeo} position={[0, rimH - lipT, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
      </mesh>

      {/* Recessed 3D basin cavity: 4 vertical inner walls + sunken bottom + overflow + basket drain */}
      <group position={[bowlCx, 0, bowlCz]}>
        {/* Sunken basin floor */}
        <mesh position={[0, bowlFloorY, 0]} receiveShadow>
          <boxGeometry args={[bowlW, 0.006, bowlD]} />
          <meshStandardMaterial color={innerColor} metalness={0.76} roughness={0.32} />
        </mesh>
        {/* 4 recessed inner basin walls */}
        <mesh position={[0, bowlFloorY + wallH / 2, -bowlD / 2 + wallT / 2]} receiveShadow>
          <boxGeometry args={[bowlW, wallH, wallT]} />
          <meshStandardMaterial color={innerColor} metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[0, bowlFloorY + wallH / 2, bowlD / 2 - wallT / 2]} receiveShadow>
          <boxGeometry args={[bowlW, wallH, wallT]} />
          <meshStandardMaterial color={innerColor} metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[-bowlW / 2 + wallT / 2, bowlFloorY + wallH / 2, 0]} receiveShadow>
          <boxGeometry args={[wallT, wallH, bowlD]} />
          <meshStandardMaterial color={innerColor} metalness={0.78} roughness={0.28} />
        </mesh>
        <mesh position={[bowlW / 2 - wallT / 2, bowlFloorY + wallH / 2, 0]} receiveShadow>
          <boxGeometry args={[wallT, wallH, bowlD]} />
          <meshStandardMaterial color={innerColor} metalness={0.78} roughness={0.28} />
        </mesh>
        {/* Chrome basket strainer drain + dark central ring */}
        <mesh position={[0, bowlFloorY + 0.004, -0.02]} material={PROP_MAT_CHROME}>
          <cylinderGeometry args={[0.04, 0.04, 0.003, 20]} />
        </mesh>
        <mesh position={[0, bowlFloorY + 0.0052, -0.02]} material={PROP_MAT_DARK_CHROME}>
          <cylinderGeometry args={[0.024, 0.024, 0.0025, 16]} />
        </mesh>
        {/* Brushed overflow slot on rear basin wall */}
        <mesh position={[0, rimH - 0.017, -bowlD / 2 + wallT + 0.001]} material={PROP_MAT_DARK_CHROME}>
          <boxGeometry args={[0.036, 0.008, 0.002]} />
        </mesh>
      </group>

      {/* Drainer grooves on right side */}
      {[-0.14, -0.07, 0, 0.07, 0.14].map((gz, i) => (
        <mesh key={i} position={[w * 0.27, rimH + 0.0015, gz]} material={PROP_MAT_DARK_CHROME}>
          <boxGeometry args={[w * 0.34, 0.003, 0.009]} />
        </mesh>
      ))}

      {/* Curved Swan-Neck Mixer Tap (mitigeur col de cygne) */}
      <group position={[bowlCx, rimH, -d * 0.42]}>
        {/* Sculpted tap base collar */}
        <mesh position={[0, 0.032, 0]} castShadow material={faucetMat}>
          <cylinderGeometry args={[0.022, 0.027, 0.064, 18]} />
        </mesh>
        {/* Continuous curved swan-neck spout */}
        <mesh geometry={getSwanNeckFaucetGeometry()} castShadow material={faucetMat} />
        {/* Brushed aerator tip nozzle */}
        <mesh position={[0, 0.23, 0.185]} castShadow material={PROP_MAT_DARK_CHROME}>
          <cylinderGeometry args={[0.0115, 0.011, 0.014, 14]} />
        </mesh>
        {/* Side mixer lever hub + ergonomic handle */}
        <mesh position={[0.022, 0.056, 0]} rotation={[0, 0, Math.PI / 2]} material={faucetMat}>
          <cylinderGeometry args={[0.011, 0.011, 0.024, 12]} />
        </mesh>
        <mesh position={[0.046, 0.072, 0.016]} rotation={[0.25, 0, -Math.PI / 2.6]} castShadow material={faucetMat}>
          <cylinderGeometry args={[0.0055, 0.007, 0.078, 10]} />
        </mesh>
      </group>
    </group>
  );
}

interface DecorPropMeshProps {
  prop: SceneProp;
  ceilingHeightMm: number;
  isSelected: boolean;
  isClientMode: boolean;
  isCapturingRender: boolean;
  allowPointLight: boolean;
  isNight: boolean;
  autoCabinetCutaway?: boolean;
  wallMetrics?: WallMetrics[];
  roomCenterM?: [number, number];
}

function getFinishParams(
  finish: PropFinishPreset | undefined,
  colorHex: string
): { color: string; metalness: number; roughness: number } {
  switch (finish) {
    case 'inox':
      return { color: colorHex || '#cfd4da', metalness: 0.82, roughness: 0.28 };
    case 'laiton':
      return { color: colorHex || '#c8a462', metalness: 0.86, roughness: 0.26 };
    case 'noir_mat':
      return { color: colorHex || '#1e2229', metalness: 0.25, roughness: 0.48 };
    case 'blanc':
      return { color: colorHex || '#f3f2ee', metalness: 0.05, roughness: 0.36 };
    case 'bois':
      return { color: colorHex || '#c59c6c', metalness: 0.02, roughness: 0.62 };
    case 'tissu':
    default:
      return { color: colorHex || '#c8c0b4', metalness: 0.0, roughness: 0.88 };
  }
}

function PropGeometry3D({
  prop,
  ceilingHeightMm,
  allowPointLight,
  isNight,
}: {
  prop: SceneProp;
  ceilingHeightMm: number;
  allowPointLight: boolean;
  isNight: boolean;
}) {
  const w = Math.max(0.04, prop.widthMm * MM);
  const h = Math.max(0.01, prop.heightMm * MM);
  const d = Math.max(0.02, prop.depthMm * MM);

  const spec = PROPS_CATALOG_BY_TYPE[prop.type];
  const color = prop.colorHex ?? spec.defaultColorHex;
  const finish = prop.finish ?? spec.defaultFinish;
  const fp = useMemo(() => getFinishParams(finish, color), [finish, color]);

  const lightActive = prop.lightOn !== false;
  const lightBoost = (isNight ? 1.5 : 1.0) * (prop.lightIntensity ?? 1.0);
  const handleColor = finish === 'noir_mat' ? '#525866' : '#e2e8f0';

  switch (prop.type) {
    case 'refrigerateur': {
      const plinthH = 0.045;
      const lowerH = (h - plinthH) * 0.36;
      const upperH = h - plinthH - lowerH - 0.014;
      const doorT = 0.046;
      const bodyD = Math.max(0.1, d - doorT);
      const upperDoorGeo = getPropChamferBox(w - 0.004, upperH, doorT, 0.008);
      const lowerDoorGeo = getPropChamferBox(w - 0.004, lowerH - 0.008, doorT, 0.008);
      return (
        <group>
          {/* Main insulated chassis */}
          <mesh position={[0, h / 2, -doorT / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, h, bodyD]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness + 0.06} />
          </mesh>
          {/* Bottom ventilation plinth grille */}
          <mesh position={[0, plinthH / 2, d / 2 - 0.025]} material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w - 0.024, plinthH, 0.032]} />
          </mesh>
          {[-0.01, 0.01].map((vy, i) => (
            <mesh key={i} position={[0, plinthH / 2 + vy, d / 2 - 0.008]} material={PROP_MAT_DARK_GASKET}>
              <boxGeometry args={[w - 0.08, 0.005, 0.004]} />
            </mesh>
          ))}
          {/* Dark shadow gasket behind doors */}
          <mesh position={[0, plinthH + (h - plinthH) / 2, d / 2 - doorT - 0.004]} material={PROP_MAT_DARK_GASKET}>
            <boxGeometry args={[w - 0.012, h - plinthH - 0.012, 0.012]} />
          </mesh>
          {/* Chamfered upper fridge door */}
          <mesh
            geometry={upperDoorGeo}
            position={[0, plinthH + lowerH + 0.012 + upperH / 2, d / 2 - doorT / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Chamfered lower freezer door */}
          <mesh
            geometry={lowerDoorGeo}
            position={[0, plinthH + lowerH / 2, d / 2 - doorT / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Top illuminated digital temp display */}
          <mesh position={[0, h - 0.17, d / 2 + 0.001]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[0.13, 0.048, 0.004]} />
          </mesh>
          <mesh position={[0, h - 0.17, d / 2 + 0.0035]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.09, 0.02, 0.002]} />
          </mesh>
          {/* Vertical stainless tubular handles with standoffs */}
          <group position={[-w / 2 + 0.042, plinthH + lowerH + upperH * 0.34, d / 2 + 0.026]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.0085, 0.0085, Math.min(0.46, upperH * 0.42), 12]} />
              <meshStandardMaterial color={handleColor} metalness={0.92} roughness={0.18} />
            </mesh>
            {[-0.17, 0.17].map((sy, i) => (
              <mesh key={i} position={[0, sy, -0.014]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_DARK_CHROME}>
                <cylinderGeometry args={[0.006, 0.006, 0.026, 8]} />
              </mesh>
            ))}
          </group>
          <group position={[-w / 2 + 0.042, plinthH + lowerH - 0.15, d / 2 + 0.026]}>
            <mesh castShadow>
              <cylinderGeometry args={[0.0085, 0.0085, Math.min(0.26, lowerH * 0.44), 12]} />
              <meshStandardMaterial color={handleColor} metalness={0.92} roughness={0.18} />
            </mesh>
            {[-0.09, 0.09].map((sy, i) => (
              <mesh key={i} position={[0, sy, -0.014]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_DARK_CHROME}>
                <cylinderGeometry args={[0.006, 0.006, 0.026, 8]} />
              </mesh>
            ))}
          </group>
        </group>
      );
    }

    case 'refrigerateur_americain': {
      const plinthH = 0.05;
      const doorT = 0.052;
      const bodyD = Math.max(0.12, d - doorT);
      const halfW = w / 2 - 0.007;
      const doorH = h - plinthH - 0.016;
      const doorGeo = getPropChamferBox(halfW, doorH, doorT, 0.009);
      const nicheW = Math.min(0.24, halfW * 0.56);
      return (
        <group>
          {/* Main chassis */}
          <mesh position={[0, h / 2, -doorT / 2]} castShadow receiveShadow>
            <boxGeometry args={[w, h, bodyD]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness + 0.06} />
          </mesh>
          {/* Dark center seam gasket */}
          <mesh position={[0, plinthH + doorH / 2, d / 2 - doorT - 0.004]} material={PROP_MAT_DARK_GASKET}>
            <boxGeometry args={[w - 0.014, doorH, 0.012]} />
          </mesh>
          {/* Chamfered left freezer door */}
          <mesh
            geometry={doorGeo}
            position={[-w / 4 - 0.002, plinthH + doorH / 2 + 0.008, d / 2 - doorT / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Chamfered right fridge door */}
          <mesh
            geometry={doorGeo}
            position={[w / 4 + 0.002, plinthH + doorH / 2 + 0.008, d / 2 - doorT / 2]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Illuminated water & ice dispenser alcove on left door */}
          <group position={[-w / 4 - 0.002, h * 0.56, d / 2 + 0.002]}>
            <mesh material={PROP_MAT_DARK_METAL}>
              <boxGeometry args={[nicheW, 0.36, 0.012]} />
            </mesh>
            <mesh position={[0, -0.025, 0.006]} material={PROP_MAT_CAVITY}>
              <boxGeometry args={[nicheW - 0.028, 0.23, 0.006]} />
            </mesh>
            {/* Touch display strip above alcove */}
            <mesh position={[0, 0.13, 0.007]} material={PROP_MAT_LED_CYAN}>
              <boxGeometry args={[nicheW * 0.72, 0.022, 0.003]} />
            </mesh>
            {/* Soft cool ice-dispenser downlight */}
            <mesh position={[0, 0.082, 0.009]}>
              <boxGeometry args={[nicheW * 0.52, 0.009, 0.004]} />
              <meshStandardMaterial color="#e0f2fe" emissive="#bae6fd" emissiveIntensity={2.2} toneMapped={false} />
            </mesh>
            {/* Dispenser paddle + stainless drip tray */}
            <mesh position={[0, -0.04, 0.009]} material={PROP_MAT_DARK_CHROME}>
              <boxGeometry args={[0.068, 0.11, 0.006]} />
            </mesh>
            <mesh position={[0, -0.145, 0.014]} material={PROP_MAT_CHROME}>
              <boxGeometry args={[nicheW - 0.024, 0.012, 0.022]} />
            </mesh>
          </group>
          {/* Twin full-height tubular bar handles with standoffs */}
          {[-0.036, 0.036].map((hx, idx) => (
            <group key={idx} position={[hx, h * 0.54, d / 2 + 0.028]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.0095, 0.0095, h * 0.56, 12]} />
                <meshStandardMaterial color={handleColor} metalness={0.92} roughness={0.18} />
              </mesh>
              {[-h * 0.22, h * 0.22].map((sy, i) => (
                <mesh key={i} position={[0, sy, -0.015]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_DARK_CHROME}>
                  <cylinderGeometry args={[0.007, 0.007, 0.028, 8]} />
                </mesh>
              ))}
            </group>
          ))}
          {/* Louvered bottom ventilation plinth */}
          <mesh position={[0, plinthH / 2, d / 2 - 0.024]} material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w - 0.02, plinthH, 0.036]} />
          </mesh>
          {[-0.012, 0, 0.012].map((vy, i) => (
            <mesh key={i} position={[0, plinthH / 2 + vy, d / 2 - 0.005]} material={PROP_MAT_DARK_GASKET}>
              <boxGeometry args={[w - 0.09, 0.004, 0.004]} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'plaque_cuisson': {
      const glassH = Math.max(0.012, Math.min(0.02, h));
      const burners: Array<[number, number, number]> = [
        [-w * 0.24, -d * 0.19, Math.min(w, d) * 0.195],
        [w * 0.24, -d * 0.18, Math.min(w, d) * 0.155],
        [-w * 0.24, d * 0.16, Math.min(w, d) * 0.155],
        [w * 0.24, d * 0.17, Math.min(w, d) * 0.175],
      ];
      return (
        <group>
          {/* Brushed thin perimeter inox frame */}
          <mesh position={[0, glassH / 2, 0]} castShadow receiveShadow material={PROP_MAT_DARK_CHROME}>
            <boxGeometry args={[w + 0.008, glassH * 0.72, d + 0.008]} />
          </mesh>
          {/* Glossy black ceramic induction glass */}
          <mesh
            geometry={getPropChamferBox(w, glassH, d, 0.003)}
            position={[0, glassH / 2 + 0.003, 0]}
            receiveShadow
            material={PROP_MAT_DARK_GLASS}
          />
          {/* 4 dual-concentric induction cooking zone rings + center crosshairs */}
          {burners.map(([bx, bz, rad], idx) => (
            <group key={idx} position={[bx, glassH + 0.0042, bz]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[rad * 0.87, rad, 32]} />
                <meshBasicMaterial color="#cbd5e1" transparent opacity={0.62} />
              </mesh>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[rad * 0.42, rad * 0.48, 24]} />
                <meshBasicMaterial color="#94a3b8" transparent opacity={0.42} />
              </mesh>
              <mesh position={[0, 0.0002, 0]}>
                <boxGeometry args={[0.022, 0.0006, 0.003]} />
                <meshBasicMaterial color="#cbd5e1" transparent opacity={0.55} />
              </mesh>
              <mesh position={[0, 0.0002, 0]}>
                <boxGeometry args={[0.003, 0.0006, 0.022]} />
                <meshBasicMaterial color="#cbd5e1" transparent opacity={0.55} />
              </mesh>
            </group>
          ))}
          {/* Front glowing red digital touch control bar */}
          <mesh position={[0, glassH + 0.0045, d * 0.41]} material={PROP_MAT_LED_RED}>
            <boxGeometry args={[w * 0.36, 0.002, 0.016]} />
          </mesh>
          {[-w * 0.14, -w * 0.07, 0, w * 0.07, w * 0.14].map((tx, i) => (
            <mesh key={i} position={[tx, glassH + 0.0048, d * 0.36]} material={PROP_MAT_LED_RED}>
              <boxGeometry args={[0.018, 0.0018, 0.008]} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'hotte_aspirante': {
      const canopyH = Math.min(0.085, h * 0.16);
      const ductH = Math.max(0.28, h - canopyH);
      const ductW = Math.min(0.32, w * 0.36);
      const ductD = Math.min(0.28, d * 0.56);
      const isIsland = prop.hoodMountMode === 'ilot';
      const ductZ = isIsland ? 0 : -d / 2 + ductD / 2;
      return (
        <group>
          {/* Sleek T-shape extractor canopy */}
          <mesh
            geometry={getPropChamferBox(w, canopyH, d, 0.005)}
            position={[0, canopyH / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Tempered black glass front touch fascia */}
          <mesh position={[0, canopyH / 2, d / 2 + 0.002]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w - 0.01, canopyH * 0.82, 0.006]} />
          </mesh>
          <mesh position={[0, canopyH / 2, d / 2 + 0.006]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.14, 0.012, 0.002]} />
          </mesh>
          {/* Multi-baffle stainless grease filter grilles underneath */}
          {[-w * 0.28, 0, w * 0.28].map((fx, i) => (
            <mesh key={i} position={[fx, 0.003, 0.02]} material={PROP_MAT_DARK_CHROME}>
              <boxGeometry args={[w * 0.25, 0.007, d * 0.72]} />
            </mesh>
          ))}
          {/* Chimney duct */}
          <mesh position={[0, canopyH + ductH / 2, ductZ]} castShadow receiveShadow>
            <boxGeometry args={[ductW, ductH, ductD]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Twin warm HDR LED downlights */}
          {[-w * 0.28, w * 0.28].map((lx, idx) => (
            <group key={idx} position={[lx, -0.002, -d * 0.28]}>
              <mesh material={PROP_MAT_CHROME}>
                <cylinderGeometry args={[0.032, 0.032, 0.005, 16]} />
              </mesh>
              <mesh position={[0, -0.001, 0]}>
                <cylinderGeometry args={[0.024, 0.024, 0.006, 16]} />
                <meshStandardMaterial
                  color="#fffbeb"
                  emissive={lightActive ? '#fde68a' : '#334155'}
                  emissiveIntensity={lightActive ? 3.5 : 0}
                  toneMapped={false}
                />
              </mesh>
            </group>
          ))}
          {lightActive && allowPointLight && (
            <pointLight
              position={[0, -0.08, 0]}
              color="#ffe6b5"
              intensity={1.7 * lightBoost}
              distance={3.2}
              decay={2}
            />
          )}
        </group>
      );
    }

    case 'evier_mitigeur': {
      return <RecessedKitchenSink3D w={w} d={d} finish={finish} fp={fp} />;
    }

    case 'lave_vaisselle': {
      const panelH = h - 0.1;
      return (
        <group>
          {/* Main body */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Recessed dark toe kick */}
          <mesh position={[0, 0.048, d / 2 - 0.018]} material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w - 0.01, 0.096, 0.04]} />
          </mesh>
          {/* Front control bar fascia */}
          <mesh position={[0, h - 0.056, d / 2 + 0.005]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w - 0.008, 0.1, 0.012]} />
          </mesh>
          {/* Brushed trim divider under control bar */}
          <mesh position={[0, h - 0.108, d / 2 + 0.006]} material={PROP_MAT_CHROME}>
            <boxGeometry args={[w - 0.008, 0.006, 0.012]} />
          </mesh>
          {/* Recessed pocket handle */}
          <mesh position={[0, h - 0.056, d / 2 + 0.011]} material={PROP_MAT_DARK_GASKET}>
            <boxGeometry args={[0.2, 0.036, 0.008]} />
          </mesh>
          {/* Digital display + status LED dots */}
          <mesh position={[w * 0.28, h - 0.056, d / 2 + 0.012]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.068, 0.024, 0.004]} />
          </mesh>
          {[-w * 0.34, -w * 0.28, -w * 0.22].map((bx, i) => (
            <mesh key={i} position={[bx, h - 0.056, d / 2 + 0.012]} material={PROP_MAT_CHROME}>
              <cylinderGeometry args={[0.007, 0.007, 0.004, 10]} />
            </mesh>
          ))}
          {/* Chamfered lower door panel */}
          <mesh
            geometry={getPropChamferBox(w - 0.008, panelH - 0.116, 0.012, 0.004)}
            position={[0, 0.1 + (panelH - 0.112) / 2, d / 2 + 0.003]}
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
        </group>
      );
    }

    case 'four_encastrable': {
      const glassW = w - 0.03;
      const glassH = h * 0.72;
      return (
        <group>
          {/* Recessed oven chassis */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w, h, d]} />
          </mesh>
          {/* Brushed inox outer perimeter trim frame */}
          <mesh position={[0, h / 2, d / 2 + 0.002]}>
            <boxGeometry args={[w + 0.004, h + 0.004, 0.006]} />
            <meshStandardMaterial color={fp.color} metalness={0.86} roughness={0.22} />
          </mesh>
          {/* Upper control fascia */}
          <mesh position={[0, h - 0.054, d / 2 + 0.007]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w - 0.008, 0.098, 0.012]} />
          </mesh>
          {/* Glowing digital clock & temp display */}
          <mesh position={[0, h - 0.054, d / 2 + 0.014]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.115, 0.032, 0.003]} />
          </mesh>
          {/* Knurled rotary dials */}
          {[-w * 0.31, w * 0.31].map((kx, i) => (
            <group key={i} position={[kx, h - 0.054, d / 2 + 0.022]}>
              <mesh rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_CHROME}>
                <cylinderGeometry args={[0.02, 0.022, 0.022, 18]} />
              </mesh>
              <mesh position={[0, 0, 0.012]} material={PROP_MAT_DARK_METAL}>
                <boxGeometry args={[0.004, 0.014, 0.002]} />
              </mesh>
            </group>
          ))}
          {/* Subtle inner cavity + chrome oven wire rack visible behind tempered glass */}
          <mesh position={[0, h * 0.41, d / 2 - 0.012]} material={PROP_MAT_CAVITY}>
            <boxGeometry args={[glassW - 0.06, glassH - 0.08, 0.04]} />
          </mesh>
          <mesh position={[0, h * 0.38, d / 2 - 0.002]} material={PROP_MAT_CHROME}>
            <boxGeometry args={[glassW - 0.09, 0.006, 0.025]} />
          </mesh>
          <mesh position={[0, h * 0.5, d / 2 - 0.002]} material={PROP_MAT_CHROME}>
            <boxGeometry args={[glassW - 0.09, 0.005, 0.025]} />
          </mesh>
          {/* Reflective dark semi-transparent tempered glass door */}
          <mesh position={[0, h * 0.41, d / 2 + 0.01]} material={PROP_MAT_OVEN_TEMPERED_GLASS}>
            <boxGeometry args={[glassW, glassH, 0.01]} />
          </mesh>
          {/* Brushed inox tubular oven handle with standoffs */}
          <group position={[0, h * 0.72, d / 2 + 0.042]}>
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow material={PROP_MAT_CHROME}>
              <cylinderGeometry args={[0.009, 0.009, w * 0.8, 12]} />
            </mesh>
            {[-w * 0.34, w * 0.34].map((hx, i) => (
              <mesh key={i} position={[hx, 0, -0.016]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_DARK_CHROME}>
                <cylinderGeometry args={[0.007, 0.007, 0.03, 8]} />
              </mesh>
            ))}
          </group>
        </group>
      );
    }

    case 'micro_ondes': {
      const winW = w * 0.65;
      const winH = h * 0.74;
      return (
        <group>
          {/* Built-in microwave body */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w, h, d]} />
          </mesh>
          {/* Outer brushed inox trim bezel */}
          <mesh position={[0, h / 2, d / 2 + 0.004]}>
            <boxGeometry args={[w + 0.006, h + 0.006, 0.008]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Subtle inner cavity + turntable plate behind tinted window */}
          <mesh position={[-w * 0.12, h / 2, d / 2 - 0.006]} material={PROP_MAT_CAVITY}>
            <boxGeometry args={[winW - 0.04, winH - 0.04, 0.025]} />
          </mesh>
          <mesh position={[-w * 0.12, h * 0.25, d / 2 - 0.002]} material={PROP_MAT_CHROME}>
            <cylinderGeometry args={[Math.min(0.11, winW * 0.32), Math.min(0.11, winW * 0.32), 0.006, 18]} />
          </mesh>
          {/* Semi-transparent reflective dark glass door */}
          <mesh position={[-w * 0.12, h / 2, d / 2 + 0.01]} material={PROP_MAT_OVEN_TEMPERED_GLASS}>
            <boxGeometry args={[winW, winH, 0.006]} />
          </mesh>
          {/* Right control fascia + digital timer + rotary knob + door button */}
          <mesh position={[w * 0.34, h / 2, d / 2 + 0.009]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w * 0.22, winH, 0.005]} />
          </mesh>
          <mesh position={[w * 0.34, h * 0.7, d / 2 + 0.012]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[w * 0.16, 0.036, 0.003]} />
          </mesh>
          <mesh position={[w * 0.34, h * 0.44, d / 2 + 0.017]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_CHROME}>
            <cylinderGeometry args={[0.02, 0.02, 0.016, 16]} />
          </mesh>
          <mesh position={[w * 0.34, h * 0.22, d / 2 + 0.013]} material={PROP_MAT_CHROME}>
            <boxGeometry args={[w * 0.12, 0.022, 0.006]} />
          </mesh>
        </group>
      );
    }

    case 'tele_ecran_plat': {
      const standing = prop.tvMountMode === 'sur_pied';
      const standH = standing ? 0.085 : 0;
      const screenH = Math.max(0.28, h - standH);
      const panelT = 0.02;
      const screenCenterY = standH + screenH / 2;
      return (
        <group>
          {/* Ultra-slim dark aluminum TV bezel */}
          <mesh
            geometry={getPropChamferBox(w, screenH, panelT, 0.003)}
            position={[0, screenCenterY, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={color || '#15181e'} roughness={0.32} metalness={0.55} />
          </mesh>
          {/* Glossy reflective OLED screen with ultra-thin 6mm bezel */}
          <mesh position={[0, screenCenterY, panelT / 2 + 0.0015]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w - 0.012, screenH - 0.014, 0.004]} />
          </mesh>
          {/* Brushed bottom metallic chin accent + standby LED */}
          <mesh position={[0, standH + 0.005, panelT / 2 + 0.003]} material={PROP_MAT_DARK_CHROME}>
            <boxGeometry args={[w - 0.008, 0.008, 0.003]} />
          </mesh>
          <mesh position={[0, standH + 0.005, panelT / 2 + 0.005]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.018, 0.004, 0.002]} />
          </mesh>
          {standing ? (
            <>
              <mesh position={[0, standH / 2, -0.01]} castShadow material={PROP_MAT_DARK_CHROME}>
                <boxGeometry args={[w * 0.14, standH, 0.036]} />
              </mesh>
              <mesh
                geometry={getPropChamferBox(Math.min(0.54, w * 0.44), 0.016, 0.24, 0.003)}
                position={[0, 0.008, 0.02]}
                castShadow
                receiveShadow
                material={PROP_MAT_DARK_METAL}
              />
            </>
          ) : (
            <mesh position={[0, screenCenterY, -panelT / 2 - 0.014]} material={PROP_MAT_DARK_METAL}>
              <boxGeometry args={[w * 0.42, screenH * 0.35, 0.028]} />
            </mesh>
          )}
        </group>
      );
    }

    case 'tabouret_bar': {
      const seatY = h * 0.75;
      const legR = 0.011;
      const legOffX = w * 0.38;
      const legOffZ = d * 0.36;
      const metal = '#1f232a';
      return (
        <group>
          {/* 4 slender metal legs */}
          {[
            [-legOffX, -legOffZ],
            [legOffX, -legOffZ],
            [-legOffX, legOffZ],
            [legOffX, legOffZ],
          ].map(([lx, lz], i) => (
            <mesh key={i} position={[lx, seatY / 2, lz]} castShadow>
              <cylinderGeometry args={[legR * 0.85, legR, seatY, 10]} />
              <meshStandardMaterial color={metal} metalness={0.72} roughness={0.34} />
            </mesh>
          ))}
          {/* Perimeter footrest rails */}
          <mesh position={[0, seatY * 0.35, legOffZ]}>
            <boxGeometry args={[legOffX * 2, 0.014, 0.014]} />
            <meshStandardMaterial color={metal} metalness={0.72} roughness={0.34} />
          </mesh>
          <mesh position={[0, seatY * 0.35, -legOffZ]}>
            <boxGeometry args={[legOffX * 2, 0.014, 0.014]} />
            <meshStandardMaterial color={metal} metalness={0.72} roughness={0.34} />
          </mesh>
          <mesh position={[-legOffX, seatY * 0.35, 0]}>
            <boxGeometry args={[0.014, 0.014, legOffZ * 2]} />
            <meshStandardMaterial color={metal} metalness={0.72} roughness={0.34} />
          </mesh>
          <mesh position={[legOffX, seatY * 0.35, 0]}>
            <boxGeometry args={[0.014, 0.014, legOffZ * 2]} />
            <meshStandardMaterial color={metal} metalness={0.72} roughness={0.34} />
          </mesh>
          {/* Upholstered seat cushion */}
          <mesh position={[0, seatY + 0.032, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.064, d * 0.92]} />
            <meshStandardMaterial color={fp.color} roughness={fp.roughness} metalness={fp.metalness} />
          </mesh>
          {/* Low ergonomic backrest */}
          <mesh position={[0, seatY + (h - seatY) * 0.55, -d * 0.41]} rotation={[-0.12, 0, 0]} castShadow>
            <boxGeometry args={[w * 0.96, h - seatY - 0.03, 0.048]} />
            <meshStandardMaterial color={fp.color} roughness={fp.roughness} metalness={fp.metalness} />
          </mesh>
        </group>
      );
    }

    case 'table_repas': {
      const topT = 0.038;
      const legH = h - topT;
      const lx = w / 2 - 0.08;
      const lz = d / 2 - 0.08;
      return (
        <group>
          {/* Tabletop */}
          <mesh position={[0, h - topT / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, topT, d]} />
            <meshStandardMaterial color={fp.color} roughness={fp.roughness} metalness={fp.metalness} />
          </mesh>
          {/* Recessed under-frame apron */}
          <mesh position={[0, h - topT - 0.025, 0]}>
            <boxGeometry args={[w - 0.16, 0.05, d - 0.16]} />
            <meshStandardMaterial color="#1f232a" metalness={0.55} roughness={0.4} />
          </mesh>
          {/* 4 tapered architectural legs */}
          {[
            [-lx, -lz],
            [lx, -lz],
            [-lx, lz],
            [lx, lz],
          ].map(([x, z], i) => (
            <mesh key={i} position={[x, legH / 2, z]} castShadow receiveShadow>
              <cylinderGeometry args={[0.026, 0.018, legH, 12]} />
              <meshStandardMaterial color="#1f232a" metalness={0.62} roughness={0.35} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'chaise_moderne': {
      const seatY = 0.45;
      const legOffX = w * 0.39;
      const legOffZ = d * 0.38;
      return (
        <group>
          {[
            [-legOffX, -legOffZ],
            [legOffX, -legOffZ],
            [-legOffX, legOffZ],
            [legOffX, legOffZ],
          ].map(([lx, lz], i) => (
            <mesh key={i} position={[lx, seatY / 2, lz]} castShadow>
              <cylinderGeometry args={[0.014, 0.01, seatY, 10]} />
              <meshStandardMaterial color="#252932" metalness={0.65} roughness={0.35} />
            </mesh>
          ))}
          {/* Seat */}
          <mesh position={[0, seatY + 0.028, 0.01]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.056, d * 0.88]} />
            <meshStandardMaterial color={fp.color} roughness={fp.roughness} metalness={fp.metalness} />
          </mesh>
          {/* Angled ergonomic backrest */}
          <mesh position={[0, seatY + (h - seatY) * 0.54, -d * 0.38]} rotation={[-0.14, 0, 0]} castShadow>
            <boxGeometry args={[w * 0.94, h - seatY - 0.02, 0.048]} />
            <meshStandardMaterial color={fp.color} roughness={fp.roughness} metalness={fp.metalness} />
          </mesh>
        </group>
      );
    }

    case 'canape_moderne': {
      const legH = 0.12;
      const baseH = 0.18;
      const seatH = 0.16;
      const armW = Math.min(0.18, w * 0.1);
      const innerW = Math.max(0.4, w - armW * 2);
      const cushionCount = w >= 1.7 ? 3 : 2;
      const cW = innerW / cushionCount - 0.012;
      return (
        <group>
          {/* 4 recessed dark metal legs */}
          {[
            [-w / 2 + 0.1, -d / 2 + 0.1],
            [w / 2 - 0.1, -d / 2 + 0.1],
            [-w / 2 + 0.1, d / 2 - 0.1],
            [w / 2 - 0.1, d / 2 - 0.1],
          ].map(([lx, lz], i) => (
            <mesh key={i} position={[lx, legH / 2, lz]} castShadow>
              <cylinderGeometry args={[0.016, 0.012, legH, 10]} />
              <meshStandardMaterial color="#1e2229" metalness={0.7} roughness={0.32} />
            </mesh>
          ))}
          {/* Lower upholstered base frame */}
          <mesh position={[0, legH + baseH / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, baseH, d]} />
            <meshStandardMaterial color={fp.color} roughness={0.9} />
          </mesh>
          {/* Left & Right armrests */}
          {[-w / 2 + armW / 2, w / 2 - armW / 2].map((ax, i) => (
            <mesh key={i} position={[ax, legH + baseH + 0.16, 0]} castShadow receiveShadow>
              <boxGeometry args={[armW, 0.34, d]} />
              <meshStandardMaterial color={fp.color} roughness={0.88} />
            </mesh>
          ))}
          {/* Rear backrest frame */}
          <mesh position={[0, legH + baseH + 0.25, -d / 2 + 0.09]} castShadow receiveShadow>
            <boxGeometry args={[w, 0.5, 0.18]} />
            <meshStandardMaterial color={fp.color} roughness={0.9} />
          </mesh>
          {/* Seat & backrest cushions */}
          {Array.from({ length: cushionCount }).map((_, idx) => {
            const cx = -innerW / 2 + (idx + 0.5) * (innerW / cushionCount);
            return (
              <group key={idx}>
                <mesh position={[cx, legH + baseH + seatH / 2, 0.07]} castShadow receiveShadow>
                  <boxGeometry args={[cW, seatH, d - 0.22]} />
                  <meshStandardMaterial color={fp.color} roughness={0.92} />
                </mesh>
                <mesh
                  position={[cx, legH + baseH + seatH + 0.16, -d / 2 + 0.23]}
                  rotation={[-0.18, 0, 0]}
                  castShadow
                >
                  <boxGeometry args={[cW - 0.01, 0.36, 0.15]} />
                  <meshStandardMaterial color={fp.color} roughness={0.92} />
                </mesh>
              </group>
            );
          })}
          {/* Two contrasting accent throw pillows */}
          {[-innerW * 0.36, innerW * 0.36].map((px, i) => (
            <mesh
              key={i}
              position={[px, legH + baseH + seatH + 0.12, -0.08]}
              rotation={[-0.22, i === 0 ? 0.35 : -0.35, 0]}
              castShadow
            >
              <boxGeometry args={[0.32, 0.3, 0.11]} />
              <meshStandardMaterial color="#6e7f71" roughness={0.9} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'suspension_lustre': {
      const shadeH = Math.min(0.24, h * 0.42);
      const shadeR = Math.min(w, d) / 2;
      const ceilingTopLocalY = Math.max(h, (ceilingHeightMm - prop.yMm) * MM);
      const cordLen = Math.max(0.15, ceilingTopLocalY - shadeH);
      return (
        <group>
          {/* Ceiling rose canopy */}
          <mesh position={[0, ceilingTopLocalY - 0.014, 0]}>
            <cylinderGeometry args={[0.065, 0.065, 0.028, 20]} />
            <meshStandardMaterial color="#1f232a" metalness={0.65} roughness={0.32} />
          </mesh>
          {/* Slender suspension cable */}
          <mesh position={[0, shadeH + cordLen / 2, 0]}>
            <cylinderGeometry args={[0.004, 0.004, cordLen, 8]} />
            <meshStandardMaterial color="#1e293b" roughness={0.7} />
          </mesh>
          {/* Brushed brass socket collar */}
          <mesh position={[0, shadeH + 0.035, 0]} castShadow material={PROP_MAT_BRASS}>
            <cylinderGeometry args={[0.026, 0.034, 0.07, 16]} />
          </mesh>
          {/* Sculptural modern dome shade */}
          <mesh position={[0, shadeH * 0.55, 0]} castShadow>
            <cylinderGeometry args={[shadeR * 0.32, shadeR, shadeH, 28, 1, true]} />
            <meshStandardMaterial
              color={color || '#22262e'}
              metalness={0.45}
              roughness={0.32}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Warm brass inner reflector disc */}
          <mesh position={[0, shadeH * 0.92, 0]}>
            <cylinderGeometry args={[shadeR * 0.31, shadeR * 0.31, 0.01, 20]} />
            <meshStandardMaterial color="#d4b06a" metalness={0.85} roughness={0.25} />
          </mesh>
          {/* Warm glowing opal globe bulb */}
          <mesh position={[0, shadeH * 0.38, 0]}>
            <sphereGeometry args={[Math.min(0.062, shadeR * 0.34), 18, 14]} />
            <meshStandardMaterial
              color="#fffbeb"
              emissive={lightActive ? '#ffd584' : '#475569'}
              emissiveIntensity={lightActive ? 3.8 : 0}
              toneMapped={false}
            />
          </mesh>
          {lightActive && allowPointLight && (
            <pointLight
              position={[0, -0.05, 0]}
              color="#ffd699"
              intensity={2.4 * lightBoost}
              distance={6.5}
              decay={2}
            />
          )}
        </group>
      );
    }

    case 'applique_murale': {
      return (
        <group>
          {/* Wall backplate */}
          <mesh position={[0, h / 2, -d / 2 + 0.01]} castShadow>
            <boxGeometry args={[w * 0.72, h * 0.6, 0.02]} />
            <meshStandardMaterial color="#1f232a" metalness={0.65} roughness={0.35} />
          </mesh>
          {/* Architectural cylindrical brass/black diffuser body */}
          <mesh position={[0, h / 2, 0.015]} castShadow>
            <cylinderGeometry args={[w * 0.34, w * 0.34, h, 20]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Top & bottom warm LED glow lenses */}
          {[h - 0.003, 0.003].map((ly, i) => (
            <mesh key={i} position={[0, ly, 0.015]}>
              <cylinderGeometry args={[w * 0.3, w * 0.3, 0.008, 18]} />
              <meshStandardMaterial
                color="#fffbeb"
                emissive={lightActive ? '#ffd27d' : '#334155'}
                emissiveIntensity={lightActive ? 3.5 : 0}
                toneMapped={false}
              />
            </mesh>
          ))}
          {lightActive && allowPointLight && (
            <pointLight
              position={[0, h / 2, 0.14]}
              color="#ffd38d"
              intensity={1.9 * lightBoost}
              distance={4.5}
              decay={2}
            />
          )}
        </group>
      );
    }

    case 'lampadaire_pied': {
      const shadeH = Math.min(0.32, h * 0.22);
      const shadeR = Math.min(w, d) / 2;
      const stemH = h - shadeH * 0.75;
      return (
        <group>
          {/* Weighted floor base */}
          <mesh position={[0, 0.016, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[shadeR * 0.75, shadeR * 0.8, 0.032, 24]} />
            <meshStandardMaterial color="#242830" metalness={0.65} roughness={0.34} />
          </mesh>
          {/* Slender brushed brass/metal vertical pole */}
          <mesh position={[0, stemH / 2, 0]} castShadow>
            <cylinderGeometry args={[0.011, 0.014, stemH, 14]} />
            <meshStandardMaterial color="#c9a563" metalness={0.86} roughness={0.24} />
          </mesh>
          {/* Linen drum shade */}
          <mesh position={[0, h - shadeH / 2, 0]} castShadow>
            <cylinderGeometry args={[shadeR * 0.88, shadeR, shadeH, 28, 1, true]} />
            <meshStandardMaterial
              color={color || '#efe9dd'}
              emissive={lightActive ? '#ffd99e' : '#000000'}
              emissiveIntensity={lightActive ? 0.55 : 0}
              roughness={0.85}
              side={THREE.DoubleSide}
            />
          </mesh>
          {/* Glowing warm bulb inside */}
          <mesh position={[0, h - shadeH * 0.52, 0]}>
            <sphereGeometry args={[0.045, 14, 12]} />
            <meshStandardMaterial
              color="#fffbeb"
              emissive={lightActive ? '#ffd584' : '#475569'}
              emissiveIntensity={lightActive ? 3.5 : 0}
              toneMapped={false}
            />
          </mesh>
          {lightActive && allowPointLight && (
            <pointLight
              position={[0, h - shadeH * 0.45, 0]}
              color="#ffd699"
              intensity={2.2 * lightBoost}
              distance={6.0}
              decay={2}
            />
          )}
        </group>
      );
    }

    case 'plante_pot': {
      const potH = Math.min(0.4, h * 0.34);
      const potR = Math.min(w, d) * 0.42;
      const leaves: Array<{ x: number; y: number; z: number; rx: number; ry: number; rz: number; s: number }> = [
        { x: 0, y: potH + 0.34, z: 0, rx: 0.1, ry: 0, rz: 0.08, s: 1.0 },
        { x: 0.08, y: potH + 0.48, z: 0.06, rx: 0.42, ry: 0.8, rz: -0.35, s: 0.92 },
        { x: -0.09, y: potH + 0.52, z: 0.05, rx: 0.36, ry: -0.9, rz: 0.38, s: 0.95 },
        { x: 0.06, y: potH + 0.44, z: -0.09, rx: -0.45, ry: 2.1, rz: -0.28, s: 0.88 },
        { x: -0.07, y: potH + 0.38, z: -0.08, rx: -0.38, ry: -2.2, rz: 0.32, s: 0.86 },
        { x: 0.02, y: potH + 0.62, z: -0.02, rx: -0.18, ry: 1.4, rz: 0.14, s: 0.82 },
        { x: 0.11, y: potH + 0.28, z: -0.02, rx: 0.22, ry: 0.3, rz: -0.55, s: 0.78 },
        { x: -0.11, y: potH + 0.29, z: 0.02, rx: -0.2, ry: -0.4, rz: 0.52, s: 0.76 },
      ];
      return (
        <group>
          {/* Modern ceramic planter pot */}
          <mesh position={[0, potH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[potR, potR * 0.78, potH, 22]} />
            <meshStandardMaterial color={color || '#e6e1d8'} roughness={0.55} metalness={0.04} />
          </mesh>
          {/* Organic dark potting soil */}
          <mesh position={[0, potH - 0.012, 0]}>
            <cylinderGeometry args={[potR * 0.9, potR * 0.88, 0.02, 18]} />
            <meshStandardMaterial color="#3b2f26" roughness={0.96} />
          </mesh>
          {/* Central woody stems */}
          <mesh position={[0, potH + (h - potH) * 0.32, 0]} castShadow>
            <cylinderGeometry args={[0.011, 0.018, (h - potH) * 0.65, 10]} />
            <meshStandardMaterial color="#5c4632" roughness={0.88} />
          </mesh>
          {/* Lush botanical green leaves */}
          {leaves.map((lf, idx) => (
            <mesh
              key={idx}
              position={[lf.x, Math.min(h - 0.08, lf.y), lf.z]}
              rotation={[lf.rx, lf.ry, lf.rz]}
              scale={[lf.s, lf.s * 1.35, lf.s * 0.22]}
              castShadow
            >
              <dodecahedronGeometry args={[Math.min(w, d) * 0.28, 1]} />
              <meshStandardMaterial
                color={idx % 2 === 0 ? '#3f6e44' : '#4d8252'}
                roughness={0.62}
                metalness={0.02}
              />
            </mesh>
          ))}
        </group>
      );
    }

    case 'tapis_deco': {
      const rugH = Math.max(0.01, h);
      return (
        <group>
          {/* Outer woven rug body */}
          <mesh position={[0, rugH / 2 + 0.002, 0]} receiveShadow>
            <boxGeometry args={[w, rugH, d]} />
            <meshStandardMaterial color={color || '#ded6c8'} roughness={0.96} metalness={0} />
          </mesh>
          {/* Subtle inner woven accent border */}
          <mesh position={[0, rugH + 0.0028, 0]} receiveShadow>
            <boxGeometry args={[w * 0.88, 0.002, d * 0.84]} />
            <meshStandardMaterial color="#c9bfb0" roughness={0.98} metalness={0} />
          </mesh>
        </group>
      );
    }

    case 'machine_laver':
    case 'seche_linge': {
      const isDryer = prop.type === 'seche_linge';
      const topH = 0.032;
      const panelH = 0.13;
      const drumR = Math.min(w * 0.34, h * 0.25);
      const drumY = h * 0.44;
      return (
        <group>
          {/* Insulated white/inox cabinet chassis */}
          <mesh
            geometry={getPropChamferBox(w, h - topH, d - 0.01, 0.008)}
            position={[0, (h - topH) / 2, -0.005]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Top overhang worktop lid */}
          <mesh
            geometry={getPropChamferBox(w + 0.006, topH, d, 0.005)}
            position={[0, h - topH / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness * 0.5} roughness={0.32} />
          </mesh>
          {/* Upper fascia control bar */}
          <mesh position={[0, h - topH - panelH / 2, d / 2 - 0.004]} receiveShadow>
            <boxGeometry args={[w - 0.012, panelH - 0.006, 0.014]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Left detergent / water drawer */}
          <mesh
            geometry={getPropChamferBox(w * 0.32, panelH * 0.72, 0.012, 0.004)}
            position={[-w * 0.31, h - topH - panelH / 2, d / 2 + 0.004]}
            castShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Center rotary program dial */}
          <mesh
            position={[0, h - topH - panelH / 2, d / 2 + 0.016]}
            rotation={[Math.PI / 2, 0, 0]}
            castShadow
            material={PROP_MAT_CHROME}
          >
            <cylinderGeometry args={[0.026, 0.028, 0.024, 20]} />
          </mesh>
          <mesh
            position={[0, h - topH - panelH / 2, d / 2 + 0.029]}
            rotation={[Math.PI / 2, 0, 0]}
            material={PROP_MAT_DARK_METAL}
          >
            <cylinderGeometry args={[0.02, 0.02, 0.004, 18]} />
          </mesh>
          {/* Right digital LED display panel */}
          <mesh position={[w * 0.28, h - topH - panelH / 2, d / 2 + 0.005]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w * 0.32, panelH * 0.62, 0.008]} />
          </mesh>
          <mesh position={[w * 0.28, h - topH - panelH / 2, d / 2 + 0.01]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[w * 0.18, 0.022, 0.003]} />
          </mesh>
          {/* Porthole outer chrome/dark bezel ring */}
          <mesh position={[0, drumY, d / 2 + 0.01]} castShadow material={isDryer ? PROP_MAT_DARK_CHROME : PROP_MAT_CHROME}>
            <torusGeometry args={[drumR, 0.024, 16, 36]} />
          </mesh>
          {/* Dark inner stainless drum cavity */}
          <mesh position={[0, drumY, d / 2 - 0.02]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_CAVITY}>
            <cylinderGeometry args={[drumR - 0.02, drumR - 0.02, 0.05, 28]} />
          </mesh>
          {/* Reflective tempered glass porthole window */}
          <mesh
            position={[0, drumY, d / 2 + 0.014]}
            rotation={[Math.PI / 2, 0, 0]}
            material={isDryer ? PROP_MAT_DARK_GLASS : PROP_MAT_OVEN_TEMPERED_GLASS}
          >
            <cylinderGeometry args={[drumR - 0.016, drumR - 0.016, 0.012, 28]} />
          </mesh>
          {/* Porthole right-side latch handle */}
          <mesh position={[drumR + 0.006, drumY, d / 2 + 0.02]} material={PROP_MAT_DARK_CHROME}>
            <boxGeometry args={[0.022, 0.075, 0.016]} />
          </mesh>
          {/* Bottom service plinth + filter door */}
          <mesh position={[0, 0.04, d / 2 - 0.012]} material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w - 0.016, 0.076, 0.028]} />
          </mesh>
          <mesh position={[w * 0.34, 0.04, d / 2 + 0.003]} material={PROP_MAT_DARK_GASKET}>
            <boxGeometry args={[0.085, 0.056, 0.004]} />
          </mesh>
        </group>
      );
    }

    case 'machine_cafe': {
      return (
        <group>
          {/* Brushed stainless espresso body */}
          <mesh
            geometry={getPropChamferBox(w, h * 0.92, d * 0.62, 0.008)}
            position={[0, h * 0.46, -d * 0.18]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Upper overhanging brew head */}
          <mesh
            geometry={getPropChamferBox(w * 0.96, h * 0.28, d * 0.42, 0.006)}
            position={[0, h * 0.78, d * 0.16]}
            castShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Front control buttons + pressure gauge */}
          <mesh position={[0, h * 0.78, d * 0.375]} rotation={[Math.PI / 2, 0, 0]} material={PROP_MAT_CHROME}>
            <cylinderGeometry args={[0.024, 0.024, 0.008, 18]} />
          </mesh>
          <mesh position={[-w * 0.28, h * 0.78, d * 0.376]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[0.026, 0.012, 0.004]} />
          </mesh>
          {/* Portafilter basket + ergonomic handle */}
          <mesh position={[0, h * 0.61, d * 0.18]} material={PROP_MAT_CHROME}>
            <cylinderGeometry args={[0.032, 0.028, 0.038, 18]} />
          </mesh>
          <mesh position={[0, h * 0.61, d * 0.31]} rotation={[Math.PI / 2, 0, 0]} castShadow material={PROP_MAT_DARK_METAL}>
            <cylinderGeometry args={[0.011, 0.013, 0.13, 12]} />
          </mesh>
          {/* Drip tray base */}
          <mesh position={[0, 0.02, d * 0.15]} castShadow receiveShadow material={PROP_MAT_DARK_METAL}>
            <boxGeometry args={[w * 0.94, 0.04, d * 0.48]} />
          </mesh>
          <mesh position={[0, 0.042, d * 0.15]} material={PROP_MAT_CHROME}>
            <boxGeometry args={[w * 0.88, 0.004, d * 0.42]} />
          </mesh>
          {/* Twin ceramic espresso cups */}
          {[-0.045, 0.045].map((cx, i) => (
            <mesh key={i} position={[cx, 0.075, d * 0.18]} castShadow>
              <cylinderGeometry args={[0.026, 0.021, 0.062, 16]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.18} metalness={0.05} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'bouilloire_grille_pain': {
      const toasterW = w * 0.48;
      const kettleR = Math.min(w * 0.19, d * 0.42);
      return (
        <group>
          {/* Left: Modern 2-slot stainless toaster */}
          <group position={[-w * 0.24, 0, 0]}>
            <mesh
              geometry={getPropChamferBox(toasterW, h * 0.72, d * 0.78, 0.018)}
              position={[0, h * 0.36, 0]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
            </mesh>
            {[-d * 0.14, d * 0.14].map((sz, i) => (
              <mesh key={i} position={[0, h * 0.722, sz]} material={PROP_MAT_DARK_GASKET}>
                <boxGeometry args={[toasterW * 0.74, 0.005, 0.024]} />
              </mesh>
            ))}
            <mesh position={[toasterW / 2 + 0.008, h * 0.45, 0]} material={PROP_MAT_DARK_CHROME}>
              <boxGeometry args={[0.014, 0.016, 0.042]} />
            </mesh>
          </group>
          {/* Right: Sleek cordless electric kettle */}
          <group position={[w * 0.26, 0, 0]}>
            <mesh position={[0, 0.014, 0]} castShadow material={PROP_MAT_DARK_METAL}>
              <cylinderGeometry args={[kettleR * 1.02, kettleR * 1.06, 0.028, 22]} />
            </mesh>
            <mesh position={[0, h * 0.5, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[kettleR * 0.82, kettleR, h * 0.88, 22]} />
              <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
            </mesh>
            <mesh position={[0, h * 0.95, 0]} material={PROP_MAT_DARK_METAL}>
              <cylinderGeometry args={[kettleR * 0.78, kettleR * 0.82, 0.024, 20]} />
            </mesh>
            {/* Kettle ergonomic handle */}
            <mesh position={[kettleR * 0.95, h * 0.55, 0]} castShadow material={PROP_MAT_DARK_METAL}>
              <boxGeometry args={[0.022, h * 0.56, 0.026]} />
            </mesh>
          </group>
        </group>
      );
    }

    case 'chauffe_eau': {
      const bodyH = h * 0.86;
      return (
        <group>
          {/* Compact white rounded wall-mounted boiler */}
          <mesh
            geometry={getPropChamferBox(w, bodyH, d, 0.022)}
            position={[0, h - bodyH / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={0.08} roughness={0.34} />
          </mesh>
          {/* Front digital temperature & pressure panel */}
          <mesh position={[0, h * 0.34, d / 2 + 0.003]} material={PROP_MAT_DARK_GLASS}>
            <boxGeometry args={[w * 0.42, 0.095, 0.008]} />
          </mesh>
          <mesh position={[0, h * 0.34, d / 2 + 0.008]} material={PROP_MAT_LED_CYAN}>
            <boxGeometry args={[w * 0.22, 0.028, 0.003]} />
          </mesh>
          {/* Top flue exhaust collar */}
          <mesh position={[0, h + 0.04, -d * 0.15]} castShadow material={PROP_MAT_CHROME}>
            <cylinderGeometry args={[0.045, 0.048, 0.08, 16]} />
          </mesh>
          {/* Bottom copper/chrome hot & cold water connection pipes */}
          {[-w * 0.26, -w * 0.09, w * 0.09, w * 0.26].map((px, i) => (
            <mesh key={i} position={[px, (h - bodyH) / 2, -d * 0.15]} material={i % 2 === 0 ? PROP_MAT_CHROME : PROP_MAT_BRASS}>
              <cylinderGeometry args={[0.011, 0.011, h - bodyH + 0.04, 12]} />
            </mesh>
          ))}
        </group>
      );
    }

    case 'tableau_mural': {
      const frameW = Math.min(0.032, Math.min(w, h) * 0.06);
      return (
        <group>
          {/* Outer picture frame */}
          <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Crisp off-white museum passe-partout mat */}
          <mesh position={[0, h / 2, d / 2 + 0.001]} receiveShadow>
            <boxGeometry args={[w - frameW * 2, h - frameW * 2, 0.004]} />
            <meshStandardMaterial color="#f5f3ef" roughness={0.9} metalness={0} />
          </mesh>
          {/* Warm architectural abstract art print */}
          <mesh position={[0, h / 2, d / 2 + 0.0035]} receiveShadow>
            <boxGeometry args={[w - frameW * 4.5, h - frameW * 4.5, 0.002]} />
            <meshStandardMaterial color="#e6dfd5" roughness={0.88} metalness={0} />
          </mesh>
          <mesh position={[-w * 0.08, h * 0.56, d / 2 + 0.005]}>
            <circleGeometry args={[Math.min(w, h) * 0.16, 28]} />
            <meshStandardMaterial color="#b46b45" roughness={0.85} />
          </mesh>
          <mesh position={[w * 0.08, h * 0.41, d / 2 + 0.0052]}>
            <boxGeometry args={[w * 0.34, h * 0.22, 0.001]} />
            <meshStandardMaterial color="#2f3b47" roughness={0.85} />
          </mesh>
        </group>
      );
    }

    case 'etagere_murale': {
      const plankH = 0.032;
      return (
        <group>
          {/* Floating wood shelf plank */}
          <mesh
            geometry={getPropChamferBox(w, plankH, d, 0.004)}
            position={[0, plankH / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color={fp.color} metalness={fp.metalness} roughness={fp.roughness} />
          </mesh>
          {/* Decorative stacked books on left */}
          <mesh position={[-w * 0.28, plankH + 0.09, -0.01]} castShadow receiveShadow>
            <boxGeometry args={[0.028, 0.18, d * 0.62]} />
            <meshStandardMaterial color="#334155" roughness={0.82} />
          </mesh>
          <mesh position={[-w * 0.235, plankH + 0.075, -0.01]} castShadow receiveShadow>
            <boxGeometry args={[0.024, 0.15, d * 0.58]} />
            <meshStandardMaterial color="#c2824b" roughness={0.82} />
          </mesh>
          <mesh position={[-w * 0.195, plankH + 0.085, -0.01]} castShadow receiveShadow>
            <boxGeometry args={[0.022, 0.17, d * 0.6]} />
            <meshStandardMaterial color="#e5e0d8" roughness={0.86} />
          </mesh>
          {/* Sculptural ceramic vase on right */}
          <mesh position={[w * 0.24, plankH + 0.085, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.028, 0.048, 0.17, 20]} />
            <meshStandardMaterial color="#ebe6de" roughness={0.55} />
          </mesh>
          <mesh position={[w * 0.11, plankH + 0.05, 0.01]} castShadow receiveShadow>
            <cylinderGeometry args={[0.034, 0.038, 0.1, 18]} />
            <meshStandardMaterial color="#475569" roughness={0.65} />
          </mesh>
        </group>
      );
    }
  }
}

export function DecorPropMesh({
  prop,
  ceilingHeightMm,
  isSelected,
  isClientMode,
  isCapturingRender,
  allowPointLight,
  isNight,
  autoCabinetCutaway = false,
  wallMetrics = [],
  roomCenterM,
}: DecorPropMeshProps) {
  const { camera, gl, invalidate } = useThree();
  const selectEntity = useUIStore((s) => s.selectEntity);
  const toggleSelectEntity = useUIStore((s) => s.toggleSelectEntity);
  const setIsDragging3D = useUIStore((s) => s.setIsDragging3D);
  const groupRef = useRef<THREE.Group | null>(null);
  const lastPropCutRef = useRef<boolean | null>(null);
  const justDraggedAtRef = useRef<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  const spec = PROPS_CATALOG_BY_TYPE[prop.type];

  // Imperative Studio Vidéo applier for staggered prop assembly entrance
  useEffect(() => {
    return registerVideoFrameApplier((frame) => {
      if (!groupRef.current) return;
      if (!frame) {
        groupRef.current.visible = true;
        groupRef.current.scale.set(1, 1, 1);
        groupRef.current.position.set(prop.xMm * MM, prop.yMm * MM, prop.zMm * MM);
        return;
      }
      const asm = frame.propAssembly[prop.id];
      if (asm) {
        groupRef.current.visible = asm.visible;
        groupRef.current.scale.setScalar(asm.scale);
        groupRef.current.position.set(
          prop.xMm * MM,
          (prop.yMm + asm.yOffsetMm) * MM,
          prop.zMm * MM
        );
      }
    });
  }, [prop.id, prop.xMm, prop.yMm, prop.zMm]);

  useFrame(() => {
    if (!groupRef.current || getActiveVideoFrame()) return;
    const isFreestandingOnly =
      spec.placementKind === 'freestanding' || spec.placementKind === 'ceiling';
    const cut =
      autoCabinetCutaway && roomCenterM
        ? shouldCutawayWallAttachedItem(
            {
              xMm: prop.xMm,
              zMm: prop.zMm,
              depthMm: prop.depthMm,
              attachedWallId: prop.attachedWallId,
              isFreestandingOnly,
            },
            wallMetrics,
            [camera.position.x, camera.position.y, camera.position.z],
            roomCenterM
          )
        : false;
    if (lastPropCutRef.current !== cut) {
      lastPropCutRef.current = cut;
      applyCutawayRaycast(groupRef.current, cut);
    }
  });

  // C7.3: Clean up active window drag listeners & Zundo pause if prop unmounts mid-drag
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const allowDrag = !isClientMode && !isCapturingRender;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!allowDrag || e.button !== 0) return;
    // STRICT DIRECT-HIT ONLY: frontmost raycast hit MUST belong to this prop's mesh
    if (!isDirectFirstHit(e.intersections, groupRef.current)) return;
    e.stopPropagation();

    if (e.shiftKey) {
      toggleSelectEntity(prop.id, 'prop');
      invalidate();
      return;
    }
    selectEntity(prop.id, 'prop');

    const pointerId = e.pointerId;
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const initialHit = e.point.clone();

    const offsetX = prop.xMm - initialHit.x * 1000;
    const offsetY = prop.yMm - initialHit.y * 1000;
    const offsetZ = prop.zMm - initialHit.z * 1000;

    let dragPlane: THREE.Plane | null = null;
    let useVerticalWallPlane = false;
    let dragStarted = false;

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    const activateDragPlane = () => {
      const docSnapshot = useProjectStore.getState().document;
      const wallMetrics = analyzeWalls(docSnapshot.walls);
      const attachedWm = prop.attachedWallId
        ? wallMetrics.find((w) => w.wall.id === prop.attachedWallId)
        : undefined;
      const isWallMounted =
        spec.placementKind === 'wall' &&
        !(prop.type === 'tele_ecran_plat' && prop.tvMountMode === 'sur_pied') &&
        !(prop.type === 'hotte_aspirante' && prop.hoodMountMode === 'ilot');

      useVerticalWallPlane = false;
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -initialHit.y);

      if (isWallMounted && attachedWm) {
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
      const liveProp = (currentDoc.props ?? []).find((p) => p.id === prop.id);
      if (!liveProp) return;

      const snap10 = (v: number) => Math.round(v / 10) * 10;
      const rawX = snap10(hitPoint.x * 1000 + offsetX);
      const rawZ = snap10(hitPoint.z * 1000 + offsetZ);
      const rawY = useVerticalWallPlane
        ? Math.max(
            0,
            Math.min(
              currentDoc.ceilingHeightMm - liveProp.heightMm,
              snap10(hitPoint.y * 1000 + offsetY)
            )
          )
        : liveProp.yMm;

      const freeOverride = useUIStore.getState().freePlacementMode || ev.altKey;
      const snapped = snapPropPosition(
        { ...liveProp, xMm: rawX, yMm: rawY, zMm: rawZ },
        currentDoc.walls,
        currentDoc.modules,
        {
          freePlacement: freeOverride,
          ceilingHeightMm: currentDoc.ceilingHeightMm,
        }
      );

      storeState.updateProp(liveProp.id, {
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
    if (performance.now() - justDraggedAtRef.current < 260) return;

    if (!isClientMode) {
      selectEntity(prop.id, 'prop');
    } else if (spec.supportsLight) {
      // In Vue Client, clicking a luminaire toggles its light cleanly
      useProjectStore.getState().updateProp(prop.id, { lightOn: prop.lightOn === false });
      invalidate();
    }
  };

  return (
    <group
      ref={groupRef}
      name={`Objet_${prop.ref}`}
      position={[prop.xMm * MM, prop.yMm * MM, prop.zMm * MM]}
      rotation={[0, prop.rotationYRad, 0]}
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
      <PropGeometry3D
        prop={prop}
        ceilingHeightMm={ceilingHeightMm}
        allowPointLight={allowPointLight}
        isNight={isNight}
      />

      {/* Non-raycastable selection wireframe */}
      {isSelected && !isCapturingRender && !isClientMode && (
        <mesh
          position={[0, (prop.heightMm * MM) / 2, 0]}
          material={PROP_MAT_SELECTION_WIRE}
          raycast={NO_RAYCAST}
        >
          <boxGeometry
            args={[
              prop.widthMm * MM + 0.016,
              Math.max(0.03, prop.heightMm * MM + 0.016),
              prop.depthMm * MM + 0.016,
            ]}
          />
        </mesh>
      )}
    </group>
  );
}
