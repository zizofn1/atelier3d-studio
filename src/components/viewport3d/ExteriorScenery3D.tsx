import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RoomBounds } from '@/engine/geometry';
import type { LightingPreset } from '@/store/useUIStore';

const MM = 0.001;

interface ExteriorScenery3DProps {
  bounds: RoomBounds;
  lightingPreset: LightingPreset;
}

function createSkyTexture(isJour: boolean): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  if (isJour) {
    grad.addColorStop(0.0, '#1e5cb3');
    grad.addColorStop(0.24, '#569de6');
    grad.addColorStop(0.45, '#b6def8');
    grad.addColorStop(0.51, '#fef4e4');
    grad.addColorStop(0.6, '#d9e3cf');
    grad.addColorStop(1.0, '#5f7d52');
  } else {
    grad.addColorStop(0.0, '#040917');
    grad.addColorStop(0.28, '#0b1836');
    grad.addColorStop(0.47, '#1d2d52');
    grad.addColorStop(0.53, '#293247');
    grad.addColorStop(1.0, '#080e17');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createStoneTerraceTexture(isJour: boolean): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = isJour ? '#b3aa9c' : '#2d313a';
  ctx.fillRect(0, 0, size, size);

  const cols = 4;
  const rows = 4;
  const cw = size / cols;
  const ch = size / rows;
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 0 ? 0 : cw * 0.5;
    for (let c = -1; c <= cols; c++) {
      const shade = Math.round((rand() - 0.5) * 16);
      const baseR = (isJour ? 216 : 74) + shade;
      const baseG = (isJour ? 209 : 74) + shade;
      const baseB = (isJour ? 196 : 78) + shade;
      ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
      ctx.fillRect(c * cw + offset + 2, r * ch + 2, cw - 4, ch - 4);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.needsUpdate = true;
  return tex;
}

function createLawnTexture(isJour: boolean): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = isJour ? '#5a8748' : '#182b1c';
  ctx.fillRect(0, 0, size, size);

  let seed = 4219;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle =
      i % 3 === 0
        ? isJour
          ? '#6f9f5a'
          : '#233b27'
        : isJour
          ? '#477038'
          : '#122116';
    ctx.globalAlpha = 0.25 + rand() * 0.35;
    ctx.fillRect(rand() * size, rand() * size, 2 + rand() * 5, 2 + rand() * 5);
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.needsUpdate = true;
  return tex;
}

interface TreeSpec {
  x: number;
  z: number;
  scale: number;
  kind: 'olive' | 'cypress' | 'ornamental';
  tint: string;
}

interface InstanceTransform {
  pos: [number, number, number];
  rot?: [number, number, number];
  scale: [number, number, number];
  color?: string;
}

/**
 * Reusable lightweight InstancedMesh helper (P4): renders N architectural/landscape elements in 1 single draw call.
 */
function StaticInstancedBatch({
  geometry,
  material,
  instances,
  receiveShadow = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instances: InstanceTransform[];
  receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh | null>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh || instances.length === 0) return;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let hasColors = false;

    for (let i = 0; i < instances.length; i++) {
      const it = instances[i];
      dummy.position.set(it.pos[0], it.pos[1], it.pos[2]);
      if (it.rot) dummy.rotation.set(it.rot[0], it.rot[1], it.rot[2]);
      else dummy.rotation.set(0, 0, 0);
      dummy.scale.set(it.scale[0], it.scale[1], it.scale[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (it.color) {
        color.set(it.color);
        mesh.setColorAt(i, color);
        hasColors = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (hasColors && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }, [instances]);

  if (instances.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[geometry, material, instances.length]}
      receiveShadow={receiveShadow}
      frustumCulled={false}
    />
  );
}

// Shared unit geometries for all instanced exterior batches (never recreated per render)
const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const UNIT_CYL_GEO = new THREE.CylinderGeometry(0.75, 1.0, 1, 8);
const UNIT_POST_CYL_GEO = new THREE.CylinderGeometry(1, 1, 1, 12);
const UNIT_CONE_GEO = new THREE.ConeGeometry(1, 1, 9);
const UNIT_DODEC_GEO = new THREE.DodecahedronGeometry(1, 1);
const UNIT_BLOOM_GEO = new THREE.SphereGeometry(1, 8, 6);

export function ExteriorScenery3D({ bounds, lightingPreset }: ExteriorScenery3DProps) {
  const isJour = lightingPreset === 'jour';

  const cx = bounds.center.x * MM;
  const cz = bounds.center.z * MM;
  const roomW = Math.max(3.5, bounds.widthMm * MM);
  const roomD = Math.max(3.0, bounds.depthMm * MM);
  const halfW = roomW / 2;
  const halfD = roomD / 2;

  const skyTex = useMemo(() => createSkyTexture(isJour), [isJour]);
  const terraceTex = useMemo(() => createStoneTerraceTexture(isJour), [isJour]);
  const lawnTex = useMemo(() => createLawnTexture(isJour), [isJour]);

  useEffect(() => () => { skyTex?.dispose(); }, [skyTex]);
  useEffect(() => () => { terraceTex?.dispose(); }, [terraceTex]);
  useEffect(() => () => { lawnTex?.dispose(); }, [lawnTex]);

  // Shared materials keyed on isJour and disposed cleanly on change/unmount
  const mats = useMemo(() => {
    const wood = new THREE.MeshStandardMaterial({
      color: isJour ? '#9e6b3b' : '#4a3525',
      roughness: 0.78,
    });
    const trunk = new THREE.MeshStandardMaterial({
      color: isJour ? '#6d5542' : '#2e241c',
      roughness: 0.93,
    });
    const foliage = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.86,
    });
    const planterBox = new THREE.MeshStandardMaterial({
      color: isJour ? '#e3ddd3' : '#434955',
      roughness: 0.85,
    });
    const shrub = new THREE.MeshStandardMaterial({
      color: isJour ? '#4c7e3e' : '#18301e',
      roughness: 0.9,
    });
    const bloom = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: 0.8,
    });
    const bollardMetal = new THREE.MeshStandardMaterial({
      color: '#1f242c',
      metalness: 0.55,
      roughness: 0.41,
    });
    const bollardLens = new THREE.MeshStandardMaterial({
      color: '#fffbeb',
      emissive: isJour ? '#fef3c7' : '#ffb85c',
      emissiveIntensity: isJour ? 0.25 : 4.2,
      toneMapped: false,
    });
    const wall = new THREE.MeshStandardMaterial({
      color: isJour ? '#ece7dd' : '#3a4150',
      roughness: 0.9,
    });
    const coping = new THREE.MeshStandardMaterial({
      color: isJour ? '#d6cfc2' : '#4b5260',
      roughness: 0.82,
    });
    const hedge = new THREE.MeshStandardMaterial({
      color: isJour ? '#3d6b34' : '#15291a',
      roughness: 0.92,
    });
    return {
      wood,
      trunk,
      foliage,
      planterBox,
      shrub,
      bloom,
      bollardMetal,
      bollardLens,
      wall,
      coping,
      hedge,
    };
  }, [isJour]);

  useEffect(() => {
    return () => {
      Object.values(mats).forEach((m) => m.dispose());
    };
  }, [mats]);

  // Deterministic starfield for Nuit mode
  const starGeo = useMemo(() => {
    const count = 220;
    const positions = new Float32Array(count * 3);
    let seed = 9187;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = rand() * Math.PI * 0.44 + 0.04;
      const r = 56;
      positions[i * 3] = cx + r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = cz + r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [cx, cz]);

  useEffect(() => () => { starGeo.dispose(); }, [starGeo]);

  const gardenHalfW = halfW + 6.6;
  const gardenHalfD = halfD + 6.6;
  const terraceW = roomW + 5.6;
  const terraceD = roomD + 5.6;

  const pergolaW = Math.min(4.6, roomW + 0.8);
  const pergolaD = 2.4;
  const pergolaH = 2.55;
  const pergolaZ = cz - halfD - pergolaD / 2 - 0.15;
  const pergolaSlatCount = 11;

  // Batched InstancedMesh transforms for Pergola timber, Trees, Planters, and Bollards (~145 -> ~11 draw calls!)
  const {
    pergolaWoodInstances,
    trunkInstances,
    foliageInstances,
    cypressConeInstances,
    planterBoxInstances,
    shrubInstances,
    bloomInstances,
    bollardMetalInstances,
    bollardLensInstances,
  } = useMemo(() => {
    const trees: TreeSpec[] = [
      { x: cx - 1.7, z: cz - halfD - 4.3, scale: 1.12, kind: 'olive', tint: '#6c8a62' },
      { x: cx + 2.3, z: cz - halfD - 4.8, scale: 1.25, kind: 'cypress', tint: '#356133' },
      { x: cx + 0.45, z: cz - halfD - 5.5, scale: 0.96, kind: 'ornamental', tint: '#548545' },
      { x: cx + halfW + 4.4, z: cz - 1.2, scale: 1.14, kind: 'olive', tint: '#6f8d65' },
      { x: cx + halfW + 5.0, z: cz + 2.3, scale: 1.2, kind: 'cypress', tint: '#325a30' },
      { x: cx - 2.0, z: cz + halfD + 4.6, scale: 1.06, kind: 'ornamental', tint: '#4b7a3c' },
      { x: cx + 2.5, z: cz + halfD + 4.9, scale: 1.12, kind: 'cypress', tint: '#3d6b37' },
      { x: cx - halfW - 4.5, z: cz + 0.9, scale: 1.12, kind: 'olive', tint: '#6a8860' },
      { x: cx - halfW - 4.8, z: cz - 2.5, scale: 1.05, kind: 'cypress', tint: '#386335' },
    ];

    const planters = [
      { x: cx - 0.6, z: cz - halfD - 2.55, bloom: '#e07a5f' },
      { x: cx + 1.45, z: cz - halfD - 2.55, bloom: '#f2cc8f' },
      { x: cx + halfW + 2.55, z: cz - 0.6, bloom: '#e07a5f' },
      { x: cx + halfW + 2.55, z: cz + 1.4, bloom: '#f4a261' },
      { x: cx - halfW - 2.55, z: cz - 0.5, bloom: '#e9c46a' },
    ];

    const bollards: Array<[number, number, number]> = [
      [cx - 1.9, -0.03, cz - halfD - 2.85],
      [cx + 0.5, -0.03, cz - halfD - 2.85],
      [cx + 2.6, -0.03, cz - halfD - 2.85],
      [cx + halfW + 2.85, -0.03, cz - 1.6],
      [cx + halfW + 2.85, -0.03, cz + 1.2],
    ];

    // 1. Pergola posts + header + 11 slats (1 instanced draw call)
    const pWood: InstanceTransform[] = [
      {
        pos: [cx - pergolaW / 2 + 0.12, pergolaH / 2, pergolaZ - pergolaD / 2 + 0.12],
        scale: [0.13, pergolaH, 0.13],
      },
      {
        pos: [cx + pergolaW / 2 - 0.12, pergolaH / 2, pergolaZ - pergolaD / 2 + 0.12],
        scale: [0.13, pergolaH, 0.13],
      },
      {
        pos: [cx, pergolaH, pergolaZ - pergolaD / 2 + 0.12],
        scale: [pergolaW, 0.14, 0.12],
      },
    ];
    for (let idx = 0; idx < pergolaSlatCount; idx++) {
      const sx = -pergolaW / 2 + 0.18 + (idx / (pergolaSlatCount - 1)) * (pergolaW - 0.36);
      pWood.push({
        pos: [cx + sx, pergolaH + 0.08, pergolaZ],
        scale: [0.06, 0.09, pergolaD],
      });
    }

    // 2. Trees: trunks, dodecahedron canopies & cypress cones
    const trunks: InstanceTransform[] = [];
    const foliage: InstanceTransform[] = [];
    const cones: InstanceTransform[] = [];

    for (const spec of trees) {
      const s = spec.scale;
      const baseColor = isJour ? spec.tint : '#192f21';
      const altOlive = isJour ? '#7b9470' : '#1e3528';

      if (spec.kind === 'cypress') {
        trunks.push({
          pos: [spec.x, -0.05 + 0.55 * s, spec.z],
          scale: [0.13 * s, 1.1 * s, 0.13 * s],
        });
        cones.push({
          pos: [spec.x, -0.05 + 2.25 * s, spec.z],
          scale: [0.58 * s, 3.2 * s, 0.58 * s],
          color: baseColor,
        });
        cones.push({
          pos: [spec.x, -0.05 + 3.35 * s, spec.z],
          scale: [0.38 * s, 1.9 * s, 0.38 * s],
          color: baseColor,
        });
      } else if (spec.kind === 'olive') {
        trunks.push({
          pos: [spec.x, -0.05 + 0.72 * s, spec.z],
          rot: [0.06, 0, 0.08],
          scale: [0.2 * s, 1.45 * s, 0.2 * s],
        });
        trunks.push({
          pos: [spec.x + 0.26 * s, -0.05 + 1.45 * s, spec.z + 0.06 * s],
          rot: [0.1, 0, -0.42],
          scale: [0.11 * s, 0.9 * s, 0.11 * s],
        });
        trunks.push({
          pos: [spec.x - 0.24 * s, -0.05 + 1.42 * s, spec.z - 0.08 * s],
          rot: [-0.12, 0, 0.44],
          scale: [0.11 * s, 0.85 * s, 0.11 * s],
        });
        const oliveClusters: Array<[number, number, number, number]> = [
          [0, 2.25, 0, 0.95],
          [0.68, 2.0, 0.28, 0.72],
          [-0.64, 2.05, -0.22, 0.76],
          [0.18, 2.68, -0.25, 0.65],
          [-0.22, 2.55, 0.34, 0.62],
        ];
        oliveClusters.forEach(([lx, ly, lz, lr], idx) => {
          foliage.push({
            pos: [spec.x + lx * s, -0.05 + ly * s, spec.z + lz * s],
            scale: [lr * s, lr * s, lr * s],
            color: idx % 2 === 0 ? baseColor : altOlive,
          });
        });
      } else {
        trunks.push({
          pos: [spec.x, -0.05 + 0.95 * s, spec.z],
          scale: [0.16 * s, 1.9 * s, 0.16 * s],
        });
        const ornClusters: Array<[number, number, number, number]> = [
          [0, 2.35, 0, 1.0],
          [0.6, 2.08, 0.34, 0.7],
          [-0.56, 2.12, -0.28, 0.74],
          [0.08, 3.0, -0.1, 0.66],
        ];
        ornClusters.forEach(([lx, ly, lz, lr]) => {
          foliage.push({
            pos: [spec.x + lx * s, -0.05 + ly * s, spec.z + lz * s],
            scale: [lr * s, lr * s, lr * s],
            color: baseColor,
          });
        });
      }
    }

    // 3. Planters, shrubs & blooms
    const pBoxes: InstanceTransform[] = [];
    const shrubs: InstanceTransform[] = [];
    const blooms: InstanceTransform[] = [];
    for (const p of planters) {
      pBoxes.push({
        pos: [p.x, -0.02 + 0.22, p.z],
        scale: [1.15, 0.44, 0.48],
      });
      for (const ox of [-0.32, 0, 0.32]) {
        shrubs.push({
          pos: [p.x + ox, -0.02 + 0.52, p.z],
          scale: [0.24, 0.24, 0.24],
        });
        blooms.push({
          pos: [p.x + ox, -0.02 + 0.68, p.z + 0.06],
          scale: [0.075, 0.075, 0.075],
          color: isJour ? p.bloom : '#6c4938',
        });
      }
    }

    // 4. Bollards (post + cap in 1 metal batch, warm diffuser lenses in 1 emissive batch)
    const bMetal: InstanceTransform[] = [];
    const bLens: InstanceTransform[] = [];
    for (const [bx, by, bz] of bollards) {
      bMetal.push({ pos: [bx, by + 0.26, bz], scale: [0.045, 0.52, 0.045] });
      bMetal.push({ pos: [bx, by + 0.59, bz], scale: [0.048, 0.022, 0.048] });
      bLens.push({ pos: [bx, by + 0.54, bz], scale: [0.038, 0.08, 0.038] });
    }

    return {
      pergolaWoodInstances: pWood,
      trunkInstances: trunks,
      foliageInstances: foliage,
      cypressConeInstances: cones,
      planterBoxInstances: pBoxes,
      shrubInstances: shrubs,
      bloomInstances: blooms,
      bollardMetalInstances: bMetal,
      bollardLensInstances: bLens,
    };
  }, [cx, cz, halfW, halfD, pergolaW, pergolaD, pergolaH, pergolaZ, isJour]);

  return (
    <group name="Environnement_Exterieur">
      {/* Smooth Realistic Gradient Sky Dome */}
      <mesh position={[cx, 0, cz]}>
        <sphereGeometry args={[62, 24, 16]} />
        <meshBasicMaterial
          map={skyTex ?? undefined}
          color={skyTex ? '#ffffff' : isJour ? '#93c5fd' : '#0b1120'}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Sun (Jour) or Moon + Starfield + Warm Garden Uplight Glow (Nuit) */}
      {isJour ? (
        <group position={[cx + 16, 19, cz - 26]}>
          <mesh>
            <sphereGeometry args={[2.1, 14, 10]} />
            <meshBasicMaterial color="#fff7cc" />
          </mesh>
          <mesh>
            <sphereGeometry args={[3.6, 14, 10]} />
            <meshBasicMaterial color="#fef08a" transparent opacity={0.2} />
          </mesh>
        </group>
      ) : (
        <>
          <points geometry={starGeo}>
            <pointsMaterial color="#e2e8f0" size={0.32} sizeAttenuation />
          </points>
          <mesh position={[cx - 14, 18, cz - 28]}>
            <sphereGeometry args={[1.5, 14, 10]} />
            <meshBasicMaterial color="#f1f5f9" />
          </mesh>
          <pointLight
            position={[cx, 1.35, cz - halfD - 3.9]}
            color="#ffca7a"
            intensity={1.9}
            distance={3.6}
            decay={2}
          />
          <pointLight
            position={[cx + halfW + 3.9, 1.25, cz]}
            color="#ffca7a"
            intensity={1.7}
            distance={3.6}
            decay={2}
          />
        </>
      )}

      {/* Exterior Garden Lawn */}
      <mesh position={[cx, -0.08, cz]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[110, 110]} />
        <meshStandardMaterial
          map={lawnTex ?? undefined}
          color={lawnTex ? '#ffffff' : isJour ? '#5a8748' : '#182b1c'}
          roughness={0.95}
          metalness={0}
        />
      </mesh>

      {/* Paved Stone Terrace Deck */}
      <mesh position={[cx, -0.055, cz]} receiveShadow>
        <boxGeometry args={[terraceW, 0.05, terraceD]} />
        <meshStandardMaterial
          map={terraceTex ?? undefined}
          color={terraceTex ? '#ffffff' : isJour ? '#d7cfc2' : '#4a4a4e'}
          roughness={0.82}
          metalness={0.02}
        />
      </mesh>

      {/* Instanced Cedar Wood Pergola (posts + header + 11 slats = 1 draw call) */}
      <StaticInstancedBatch geometry={UNIT_BOX_GEO} material={mats.wood} instances={pergolaWoodInstances} />

      {/* Garden Perimeter Architectural Masonry Wall + Wood Slats + Trimmed Hedges */}
      {[
        { pos: [cx, 0, cz - gardenHalfD] as [number, number, number], rotY: 0, len: gardenHalfW * 2 },
        { pos: [cx, 0, cz + gardenHalfD] as [number, number, number], rotY: Math.PI, len: gardenHalfW * 2 },
        { pos: [cx + gardenHalfW, 0, cz] as [number, number, number], rotY: -Math.PI / 2, len: gardenHalfD * 2 },
        { pos: [cx - gardenHalfW, 0, cz] as [number, number, number], rotY: Math.PI / 2, len: gardenHalfD * 2 },
      ].map((side, idx) => (
        <group key={`fence-${idx}`} position={side.pos} rotation={[0, side.rotY, 0]}>
          <mesh position={[0, 0.52, 0]} receiveShadow material={mats.wall}>
            <boxGeometry args={[side.len, 1.08, 0.22]} />
          </mesh>
          <mesh position={[0, 1.08, 0]} material={mats.coping}>
            <boxGeometry args={[side.len + 0.04, 0.05, 0.28]} />
          </mesh>
          {[1.28, 1.48, 1.68].map((slatY) => (
            <mesh key={`slat-${slatY}`} position={[0, slatY, 0]} material={mats.wood}>
              <boxGeometry args={[side.len, 0.12, 0.04]} />
            </mesh>
          ))}
          <mesh position={[0, 0.56, 0.44]} receiveShadow material={mats.hedge}>
            <boxGeometry args={[side.len - 0.8, 1.12, 0.56]} />
          </mesh>
        </group>
      ))}

      {/* Instanced Mediterranean Trees (Trunks + Dodecahedron Canopies + Cypress Cones = 3 draw calls total!) */}
      <StaticInstancedBatch geometry={UNIT_CYL_GEO} material={mats.trunk} instances={trunkInstances} />
      <StaticInstancedBatch
        geometry={UNIT_DODEC_GEO}
        material={mats.foliage}
        instances={foliageInstances}
        receiveShadow
      />
      <StaticInstancedBatch
        geometry={UNIT_CONE_GEO}
        material={mats.foliage}
        instances={cypressConeInstances}
        receiveShadow
      />

      {/* Instanced Stone Planters, Shrubs & Blooms (3 draw calls total!) */}
      <StaticInstancedBatch
        geometry={UNIT_BOX_GEO}
        material={mats.planterBox}
        instances={planterBoxInstances}
        receiveShadow
      />
      <StaticInstancedBatch geometry={UNIT_DODEC_GEO} material={mats.shrub} instances={shrubInstances} />
      <StaticInstancedBatch geometry={UNIT_BLOOM_GEO} material={mats.bloom} instances={bloomInstances} />

      {/* Instanced Pathway Bollards (2 draw calls total!) */}
      <StaticInstancedBatch
        geometry={UNIT_POST_CYL_GEO}
        material={mats.bollardMetal}
        instances={bollardMetalInstances}
      />
      <StaticInstancedBatch
        geometry={UNIT_POST_CYL_GEO}
        material={mats.bollardLens}
        instances={bollardLensInstances}
      />
    </group>
  );
}
