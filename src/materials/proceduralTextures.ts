import * as THREE from 'three';
import type { GrainDirection, MaterialDef } from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
import { getDeviceQualityProfile } from '@/utils/deviceProfile';

export interface PhotoTextureSetSpec {
  dir: 'oak' | 'walnut' | 'marble' | 'quartz' | 'parquet' | 'ceramic' | 'plaster';
  /** Real-world physical size (in meters) represented by one 0..1 texture tile */
  tileMeters: number;
  /** Subtle tint multiplier to differentiate related catalog finishes */
  tintHex: string;
  normalScale: number;
  roughnessMult: number;
  baseClearcoat?: number;
  baseClearcoatRoughness?: number;
  isStoneCountertop?: boolean;
}

export const PHOTO_TEXTURE_BY_MATERIAL_ID: Record<string, PhotoTextureSetSpec> = {
  // Mélaminé Bois & Chêne Massif (~0.85 m grain repeat; roughness >= 0.86 to avoid multiplying roughnessMap into plastic gloss)
  'chene-naturel': {
    dir: 'oak',
    tileMeters: 0.85,
    tintHex: '#ffffff',
    normalScale: 0.42,
    roughnessMult: 0.92,
    baseClearcoat: 0,
  },
  'noyer-fonce': {
    dir: 'walnut',
    tileMeters: 0.85,
    tintHex: '#f8efe6',
    normalScale: 0.42,
    roughnessMult: 0.9,
    baseClearcoat: 0,
  },
  'hetre-clair': {
    dir: 'oak',
    tileMeters: 0.85,
    tintHex: '#ffeed9',
    normalScale: 0.36,
    roughnessMult: 0.92,
    baseClearcoat: 0,
  },
  'frene-blanchi': {
    dir: 'oak',
    tileMeters: 0.9,
    tintHex: '#fbf8f2',
    normalScale: 0.32,
    roughnessMult: 0.94,
    baseClearcoat: 0,
  },
  'chene-massif-pdt': {
    dir: 'oak',
    tileMeters: 1.05,
    tintHex: '#e6be8c',
    normalScale: 0.48,
    roughnessMult: 0.82,
    baseClearcoat: 0.06,
  },

  // Plans de travail Pierre (subtle satin polish, no mirror glare)
  'marbre-carrare': {
    dir: 'marble',
    tileMeters: 1.5,
    tintHex: '#ffffff',
    normalScale: 0.24,
    roughnessMult: 0.56,
    baseClearcoat: 0.22,
    baseClearcoatRoughness: 0.28,
    isStoneCountertop: true,
  },
  'quartz-beton': {
    dir: 'quartz',
    tileMeters: 1.25,
    tintHex: '#dce0e4',
    normalScale: 0.3,
    roughnessMult: 0.64,
    baseClearcoat: 0.14,
    baseClearcoatRoughness: 0.34,
    isStoneCountertop: true,
  },
  'granit-noir': {
    dir: 'quartz',
    tileMeters: 1.0,
    tintHex: '#464a52',
    normalScale: 0.36,
    roughnessMult: 0.56,
    baseClearcoat: 0.24,
    baseClearcoatRoughness: 0.26,
    isStoneCountertop: true,
  },

  // Sols photographiques (world-meter UVs, realistic matte/satin roughness without wet-floor glare)
  'parquet-chene': {
    dir: 'parquet',
    tileMeters: 1.15,
    tintHex: '#ffffff',
    normalScale: 0.6,
    roughnessMult: 0.88,
  },
  'parquet-noyer': {
    dir: 'parquet',
    tileMeters: 1.15,
    tintHex: '#866349',
    normalScale: 0.6,
    roughnessMult: 0.86,
  },
  'marbre-clair-sol': {
    dir: 'marble',
    tileMeters: 1.6,
    tintHex: '#ffffff',
    normalScale: 0.2,
    roughnessMult: 0.52,
    baseClearcoat: 0.2,
    baseClearcoatRoughness: 0.26,
    isStoneCountertop: true,
  },

  // Murs photographiques (white_plaster_02 bright architectural matte plaster)
  'peinture-blanc-casse': {
    dir: 'plaster',
    tileMeters: 1.6,
    tintHex: '#f6f4ef',
    normalScale: 0.2,
    roughnessMult: 0.94,
  },
  'platre-lisse': {
    dir: 'plaster',
    tileMeters: 1.8,
    tintHex: '#faf9f5',
    normalScale: 0.08,
    roughnessMult: 0.88,
  },
  'peinture-grege': {
    dir: 'plaster',
    tileMeters: 1.6,
    tintHex: '#e2dbd0',
    normalScale: 0.22,
    roughnessMult: 0.94,
  },
};

interface BasePhotoMaps {
  diff: THREE.Texture;
  nor: THREE.Texture;
  rough: THREE.Texture;
  clonesByChannel: {
    diff: Set<THREE.Texture>;
    nor: Set<THREE.Texture>;
    rough: Set<THREE.Texture>;
  };
}

interface ProceduralSurfaceBundle {
  albedo: THREE.CanvasTexture;
  bump?: THREE.CanvasTexture;
}

interface GlobalTuningState {
  glossBoost: number;
  hdriIntensity: number;
  qualityEnvScale?: number;
}

const basePhotoCache = new Map<string, BasePhotoMaps>();
const derivedTextureCache = new Map<string, THREE.Texture>();
const proceduralSurfaceCache = new Map<string, ProceduralSurfaceBundle>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

const MAX_MATERIAL_CACHE = 260;
const MAX_PROCEDURAL_CACHE = 120;
const MAX_DERIVED_TEXTURE_CACHE = 320;

let sharedLoader: THREE.TextureLoader | null = null;
let currentMaxAnisotropy = 4;
let currentTuning: GlobalTuningState = { glossBoost: 0.25, hdriIntensity: 0.78 };

// Shared SketchUp Pro crease edge line material (instant 0ms live slider updates!)
const sharedEdgeLineMaterial = new THREE.LineBasicMaterial({
  color: '#1e293b',
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
sharedEdgeLineMaterial.visible = false;

export function getSharedEdgeLineMaterial(): THREE.LineBasicMaterial {
  return sharedEdgeLineMaterial;
}

export function setEdgeLinesOpacity(opacity: number): void {
  const clamped = Math.max(0, Math.min(0.65, opacity));
  sharedEdgeLineMaterial.opacity = clamped;
  sharedEdgeLineMaterial.visible = clamped > 0.005;
}

function normalizeHex(hex?: string): string | undefined {
  if (!hex || typeof hex !== 'string') return undefined;
  const trimmed = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex) ?? '#cccccc';
  return [
    Number.parseInt(norm.slice(1, 3), 16),
    Number.parseInt(norm.slice(3, 5), 16),
    Number.parseInt(norm.slice(5, 7), 16),
  ];
}

function rgbToCss(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function applyTuningToMaterial(mat: THREE.MeshStandardMaterial, tuning: GlobalTuningState): void {
  const meta = mat.userData as {
    isCollision?: boolean;
    baseRoughness?: number;
    baseClearcoat?: number;
    baseClearcoatRoughness?: number;
    baseEnvIntensity?: number;
    category?: string;
    isGlossyTile?: boolean;
  };
  if (meta.isCollision) return;

  const baseR = meta.baseRoughness ?? mat.roughness;
  const baseEnv = meta.baseEnvIntensity ?? 0.85;
  const g = Math.max(0, Math.min(1, tuning.glossBoost));

  // Walls & floors stay architectural matte/satin unless explicitly glossy zellige
  const isWall = meta.category === 'mur' && !meta.isGlossyTile;
  const isFloor = meta.category === 'sol' && !meta.isGlossyTile;
  const roughnessDrop = isWall ? g * 0.05 : isFloor ? g * 0.16 : g * 0.28;
  const envScale = tuning.qualityEnvScale ?? 1.0;
  mat.roughness = Math.max(0.08, Math.min(1.0, baseR * (1 - roughnessDrop)));
  // Single clean linear HDRI scaling (eliminates old double-boost glare on cabinets & floor)
  mat.envMapIntensity = baseEnv * (0.15 + Math.max(0, tuning.hdriIntensity) * 0.85) * envScale;

  if (mat instanceof THREE.MeshPhysicalMaterial) {
    const baseCc = meta.baseClearcoat ?? 0;
    const baseCcR = meta.baseClearcoatRoughness ?? 0.28;
    const ccAdd = isWall ? 0 : isFloor ? g * 0.12 : g * 0.34;
    mat.clearcoat = Math.min(1.0, baseCc + ccAdd);
    mat.clearcoatRoughness = Math.max(0.06, baseCcR * (1 - g * 0.35));
  }
}

export function applyGlobalMaterialTuning(tuning: GlobalTuningState): void {
  currentTuning = { ...tuning };
  for (const mat of materialCache.values()) {
    applyTuningToMaterial(mat, currentTuning);
  }
}

function canLoadBrowserTextures(): boolean {
  if (typeof window === 'undefined' || typeof Image === 'undefined') return false;
  if (
    'happyDOM' in window ||
    (typeof navigator !== 'undefined' && /HappyDOM|jsdom/i.test(navigator.userAgent))
  ) {
    return false;
  }
  return true;
}

export function setMaxTextureAnisotropy(maxSupported: number): void {
  const profileCap = getDeviceQualityProfile().maxAnisotropy;
  const clamped = Math.max(1, Math.min(profileCap, Math.floor(maxSupported || profileCap)));
  if (clamped === currentMaxAnisotropy) return;
  currentMaxAnisotropy = clamped;
  for (const tex of derivedTextureCache.values()) {
    tex.anisotropy = clamped;
    if (tex.image) tex.needsUpdate = true;
  }
  for (const bundle of proceduralSurfaceCache.values()) {
    bundle.albedo.anisotropy = clamped;
    bundle.albedo.needsUpdate = true;
    if (bundle.bump) {
      bundle.bump.anisotropy = clamped;
      bundle.bump.needsUpdate = true;
    }
  }
}

/**
 * Downscales an HTMLImageElement onto a bounded offscreen canvas on Mobile/iPad (<= 512px)
 * so 1K photo PBR textures consume 75% less WebGL VRAM on Safari iOS/iPadOS.
 */
function capTextureImageResolution(
  img: TexImageSource | undefined,
  maxDimPx: number
): TexImageSource | undefined {
  if (!img || typeof document === 'undefined') return img;
  const srcW = (img as { width?: number }).width ?? 0;
  const srcH = (img as { height?: number }).height ?? 0;
  if (srcW <= maxDimPx && srcH <= maxDimPx) return img;
  if (srcW <= 0 || srcH <= 0) return img;

  const scale = maxDimPx / Math.max(srcW, srcH);
  const dstW = Math.max(64, Math.round(srcW * scale));
  const dstH = Math.max(64, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;
  ctx.drawImage(img as CanvasImageSource, 0, 0, dstW, dstH);
  return canvas;
}

function getTextureLoader(): THREE.TextureLoader {
  if (!sharedLoader) {
    sharedLoader = new THREE.TextureLoader();
  }
  return sharedLoader;
}

function loadBasePhotoMaps(dir: PhotoTextureSetSpec['dir']): BasePhotoMaps {
  const cached = basePhotoCache.get(dir);
  if (cached) return cached;

  const loader = getTextureLoader();
  const basePath = `/textures/${dir}`;
  const maxTexPx = getDeviceQualityProfile().maxTextureSizePx;
  const clonesByChannel = {
    diff: new Set<THREE.Texture>(),
    nor: new Set<THREE.Texture>(),
    rough: new Set<THREE.Texture>(),
  };

  const loadMap = (
    channel: 'diff' | 'nor' | 'rough',
    filename: string,
    isColor: boolean
  ): THREE.Texture => {
    const tex = loader.load(`${basePath}/${filename}`, (loadedTex) => {
      const cappedImage = capTextureImageResolution(
        loadedTex.image as TexImageSource | undefined,
        maxTexPx
      );
      if (cappedImage && cappedImage !== loadedTex.image) {
        (loadedTex as THREE.Texture<TexImageSource>).image = cappedImage;
        loadedTex.needsUpdate = true;
      }
      const channelClones = clonesByChannel[channel];
      for (const c of channelClones) {
        c.image = loadedTex.image;
        c.needsUpdate = true;
      }
      channelClones.clear();
    });
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = currentMaxAnisotropy;
    return tex;
  };

  const maps: BasePhotoMaps = {
    diff: loadMap('diff', 'diff.jpg', true),
    nor: loadMap('nor', 'nor_gl.jpg', false),
    rough: loadMap('rough', 'rough.jpg', false),
    clonesByChannel,
  };

  basePhotoCache.set(dir, maps);
  return maps;
}

function getDerivedPhotoTexture(
  baseMaps: BasePhotoMaps,
  channel: 'diff' | 'nor' | 'rough',
  cacheKey: string,
  repeatU: number,
  repeatV: number,
  rotate90: boolean
): THREE.Texture {
  const cached = derivedTextureCache.get(cacheKey);
  if (cached) return cached;

  const baseTex = baseMaps[channel];
  const clone = baseTex.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.anisotropy = currentMaxAnisotropy;
  clone.colorSpace = baseTex.colorSpace;
  clone.center.set(0.5, 0.5);
  clone.rotation = rotate90 ? Math.PI / 2 : 0;
  clone.repeat.set(repeatU, repeatV);

  if (baseTex.image) {
    clone.image = baseTex.image;
    clone.needsUpdate = true;
  } else {
    baseMaps.clonesByChannel[channel].add(clone);
  }

  if (derivedTextureCache.size >= MAX_DERIVED_TEXTURE_CACHE) {
    const oldestKey = derivedTextureCache.keys().next().value;
    if (oldestKey) {
      derivedTextureCache.get(oldestKey)?.dispose();
      derivedTextureCache.delete(oldestKey);
    }
  }
  derivedTextureCache.set(cacheKey, clone);
  return clone;
}

// ============================================================================
// High-Detail Procedural Architectural Surfaces (Zellige, Large Tiles, Béton Ciré,
// Checkerboard, Textured Wallpaper) + Lightweight Fallback
// ============================================================================

function seededRand(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) + 1;
}

function getArchitecturalPatternTileMeters(mat: MaterialDef): number {
  switch (mat.pattern) {
    case 'large_tile':
      return 1.2; // 2x2 grid of 60x60 cm large-format stoneware tiles
    case 'zellige_tile':
      return 0.6; // 6x6 grid of authentic 10x10 cm handmade Moroccan zellige tiles
    case 'checker_tile':
      return 0.8; // 2x2 grid of 40x40 cm classic checkerboard tiles
    case 'beton_cire':
      return 1.6;
    case 'wallpaper_textured':
      return 0.75;
    default:
      return 1.0;
  }
}

function isCustomArchitecturalPattern(mat: MaterialDef): boolean {
  return (
    mat.pattern === 'large_tile' ||
    mat.pattern === 'zellige_tile' ||
    mat.pattern === 'checker_tile' ||
    mat.pattern === 'beton_cire' ||
    mat.pattern === 'wallpaper_textured'
  );
}

function createArchitecturalCanvases(
  mat: MaterialDef,
  grain: GrainDirection,
  primaryHex: string,
  groutHex: string
): { albedoCanvas: HTMLCanvasElement; bumpCanvas?: HTMLCanvasElement } | null {
  if (typeof document === 'undefined') return null;
  const highRes = isCustomArchitecturalPattern(mat);
  const maxTexPx = getDeviceQualityProfile().maxTextureSizePx;
  const size = Math.min(maxTexPx, highRes ? 512 : 256);

  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const ctx = albedoCanvas.getContext('2d');
  if (!ctx) return null;

  let bumpCanvas: HTMLCanvasElement | undefined;
  let bctx: CanvasRenderingContext2D | null = null;
  if (highRes) {
    bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    bctx = bumpCanvas.getContext('2d');
    if (bctx) {
      bctx.fillStyle = '#d4d4d4';
      bctx.fillRect(0, 0, size, size);
    }
  }

  const rand = seededRand(hashString(`${mat.id}-${grain}-${primaryHex}-${groutHex}`));
  const [r0, g0, b0] = hexToRgb(primaryHex);

  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, size, size);

  if (mat.pattern === 'large_tile') {
    // Clean modern 60x60 cm large-format tiles (2x2 per 1.2 m tile) with crisp fine grout
    const cells = 2;
    const cell = size / cells;
    const groutW = 3;

    // Fill grout background
    ctx.fillStyle = groutHex;
    ctx.fillRect(0, 0, size, size);
    if (bctx) {
      bctx.fillStyle = '#383838';
      bctx.fillRect(0, 0, size, size);
    }

    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const delta = (rand() - 0.5) * 8;
        ctx.fillStyle = rgbToCss(r0 + delta, g0 + delta, b0 + delta);
        const x = cx * cell + groutW / 2;
        const y = cy * cell + groutW / 2;
        const w = cell - groutW;
        const h = cell - groutW;
        ctx.fillRect(x, y, w, h);

        if (bctx) {
          bctx.fillStyle = '#e0e0e0';
          bctx.fillRect(x, y, w, h);
        }

        // Subtle mineral stoneware speckles inside each tile
        for (let s = 0; s < 55; s++) {
          const sx = x + rand() * w;
          const sy = y + rand() * h;
          const rad = 1 + rand() * 3.5;
          const lum = (rand() - 0.5) * 14;
          ctx.fillStyle = rgbToCss(r0 + lum, g0 + lum, b0 + lum);
          ctx.globalAlpha = 0.16;
          ctx.beginPath();
          ctx.arc(sx, sy, rad, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  } else if (mat.pattern === 'zellige_tile') {
    // Authentic handmade Moroccan zellige (6x6 grid of ~10x10 cm glazed squares)
    const cells = 6;
    const cell = size / cells;
    const groutW = 2.6;

    ctx.fillStyle = groutHex;
    ctx.fillRect(0, 0, size, size);
    if (bctx) {
      bctx.fillStyle = '#262626';
      bctx.fillRect(0, 0, size, size);
    }

    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        // Artisanal tonal variation between individual zellige tiles
        const tone = (rand() - 0.5) * 28;
        const warm = (rand() - 0.5) * 10;
        const x = cx * cell + groutW / 2;
        const y = cy * cell + groutW / 2;
        const w = cell - groutW;
        const h = cell - groutW;

        const grad = ctx.createLinearGradient(x, y, x + w, y + h);
        grad.addColorStop(0, rgbToCss(r0 + tone + warm + 10, g0 + tone + 10, b0 + tone - warm + 8));
        grad.addColorStop(0.5, rgbToCss(r0 + tone, g0 + tone, b0 + tone));
        grad.addColorStop(1, rgbToCss(r0 + tone - 12, g0 + tone - 10, b0 + tone - 8));
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, h);

        // Subtle glazed edge highlight
        ctx.strokeStyle = rgbToCss(r0 + tone + 28, g0 + tone + 28, b0 + tone + 28);
        ctx.globalAlpha = 0.28;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
        ctx.globalAlpha = 1;

        if (bctx) {
          // Undulating handmade surface relief in bump map
          const bVal = 185 + Math.round((rand() - 0.5) * 45);
          const bGrad = bctx.createRadialGradient(
            x + w * (0.35 + rand() * 0.3),
            y + h * (0.35 + rand() * 0.3),
            w * 0.08,
            x + w / 2,
            y + h / 2,
            w * 0.72
          );
          bGrad.addColorStop(0, rgbToCss(bVal + 30, bVal + 30, bVal + 30));
          bGrad.addColorStop(1, rgbToCss(bVal - 25, bVal - 25, bVal - 25));
          bctx.fillStyle = bGrad;
          bctx.fillRect(x, y, w, h);
        }
      }
    }
  } else if (mat.pattern === 'checker_tile') {
    // Classic 2x2 architectural checkerboard with crisp grout
    const cells = 2;
    const cell = size / cells;
    const groutW = 3;
    const darkHex = mat.secondaryHex ?? '#2f3238';
    const [dr, dg, db] = hexToRgb(darkHex);

    ctx.fillStyle = groutHex;
    ctx.fillRect(0, 0, size, size);
    if (bctx) {
      bctx.fillStyle = '#383838';
      bctx.fillRect(0, 0, size, size);
    }

    for (let cy = 0; cy < cells; cy++) {
      for (let cx = 0; cx < cells; cx++) {
        const isDark = (cx + cy) % 2 === 1;
        const [cr, cg, cb] = isDark ? [dr, dg, db] : [r0, g0, b0];
        const d = (rand() - 0.5) * 6;
        const x = cx * cell + groutW / 2;
        const y = cy * cell + groutW / 2;
        const w = cell - groutW;
        const h = cell - groutW;
        ctx.fillStyle = rgbToCss(cr + d, cg + d, cb + d);
        ctx.fillRect(x, y, w, h);
        if (bctx) {
          bctx.fillStyle = '#dfdfdf';
          bctx.fillRect(x, y, w, h);
        }
      }
    }
  } else if (mat.pattern === 'beton_cire') {
    // Architectural trowel-burnished micro-cement clouds
    for (let i = 0; i < 65; i++) {
      const cx = rand() * size;
      const cy = rand() * size;
      const rad = 28 + rand() * 85;
      const delta = (rand() - 0.5) * 26;
      const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, rad);
      grad.addColorStop(0, rgbToCss(r0 + delta, g0 + delta, b0 + delta));
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();

      if (bctx) {
        const bLum = 180 + delta * 1.4;
        bctx.fillStyle = rgbToCss(bLum, bLum, bLum);
        bctx.globalAlpha = 0.14;
        bctx.beginPath();
        bctx.arc(cx, cy, rad * 0.85, 0, Math.PI * 2);
        bctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (bctx) bctx.globalAlpha = 1;
  } else if (mat.pattern === 'wallpaper_textured') {
    // Subtle woven linen / textured architectural wallpaper
    for (let y = 0; y < size; y += 4) {
      const delta = (rand() - 0.5) * 14;
      ctx.fillStyle = rgbToCss(r0 + delta, g0 + delta, b0 + delta);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(0, y, size, 2);
      if (bctx) {
        bctx.fillStyle = delta > 0 ? '#e6e6e6' : '#c2c2c2';
        bctx.globalAlpha = 0.45;
        bctx.fillRect(0, y, size, 2);
      }
    }
    for (let x = 0; x < size; x += 6) {
      const delta = (rand() - 0.5) * 12;
      ctx.fillStyle = rgbToCss(r0 + delta, g0 + delta, b0 + delta);
      ctx.globalAlpha = 0.26;
      ctx.fillRect(x, 0, 2, size);
      if (bctx) {
        bctx.fillStyle = delta > 0 ? '#ebebeb' : '#bcbcbc';
        bctx.globalAlpha = 0.35;
        bctx.fillRect(x, 0, 2, size);
      }
    }
    ctx.globalAlpha = 1;
    if (bctx) bctx.globalAlpha = 1;
  } else if (mat.pattern === 'wood_grain' || mat.pattern === 'parquet_plank') {
    const secondary = mat.secondaryHex ?? primaryHex;
    ctx.save();
    if (grain === 'V') {
      ctx.translate(size / 2, size / 2);
      ctx.rotate(Math.PI / 2);
      ctx.translate(-size / 2, -size / 2);
    }
    ctx.strokeStyle = secondary;
    for (let i = 0; i < 48; i++) {
      const y0 = rand() * size;
      ctx.globalAlpha = 0.14 + rand() * 0.18;
      ctx.lineWidth = 1 + rand() * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= size; x += 32) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.02 + i) * 4);
      }
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  } else if (mat.pattern === 'solid_matte' || mat.pattern === 'plaster_wall') {
    for (let i = 0; i < 320; i++) {
      const delta = (rand() - 0.5) * 12;
      ctx.fillStyle = rgbToCss(r0 + delta, g0 + delta, b0 + delta);
      ctx.globalAlpha = 0.08 + rand() * 0.06;
      const r = 1 + rand() * 2.5;
      ctx.fillRect(rand() * size, rand() * size, r, r);
    }
    ctx.globalAlpha = 1;
  }

  return { albedoCanvas, bumpCanvas };
}

function getProceduralSurfaceBundle(
  mat: MaterialDef,
  grain: GrainDirection,
  repeatX: number,
  repeatY: number,
  primaryHex: string,
  groutHex: string
): ProceduralSurfaceBundle | null {
  const key = `surf:${mat.id}:${grain}:${repeatX.toFixed(3)}x${repeatY.toFixed(3)}:${primaryHex}:${groutHex}`;
  const cached = proceduralSurfaceCache.get(key);
  if (cached) return cached;

  const canvases = createArchitecturalCanvases(mat, grain, primaryHex, groutHex);
  if (!canvases) return null;

  const albedo = new THREE.CanvasTexture(canvases.albedoCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(repeatX, repeatY);
  albedo.anisotropy = currentMaxAnisotropy;
  albedo.needsUpdate = true;

  let bump: THREE.CanvasTexture | undefined;
  if (canvases.bumpCanvas) {
    bump = new THREE.CanvasTexture(canvases.bumpCanvas);
    bump.colorSpace = THREE.NoColorSpace;
    bump.wrapS = THREE.RepeatWrapping;
    bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(repeatX, repeatY);
    bump.anisotropy = currentMaxAnisotropy;
    bump.needsUpdate = true;
  }

  if (proceduralSurfaceCache.size >= MAX_PROCEDURAL_CACHE) {
    const oldestKey = proceduralSurfaceCache.keys().next().value;
    if (oldestKey) {
      const oldest = proceduralSurfaceCache.get(oldestKey);
      oldest?.albedo.dispose();
      oldest?.bump?.dispose();
      proceduralSurfaceCache.delete(oldestKey);
    }
  }

  const bundle: ProceduralSurfaceBundle = { albedo, bump };
  proceduralSurfaceCache.set(key, bundle);
  return bundle;
}

/**
 * Quantizes normalized-UV panel dimensions (in meters) into 0.25-tile buckets so similar panels
 * share GPU material instances cleanly at 60 FPS.
 */
function quantizeNormalizedRepeat(meters: number, tileMeters: number): number {
  const raw = Math.max(0.25, meters / Math.max(0.2, tileMeters));
  return Math.max(0.25, Math.round(raw * 4) / 4);
}

export function getProceduralTexture(
  materialId: string,
  grain: GrainDirection = 'H',
  repeatX = 1,
  repeatY = 1,
  uvInMeters = false
): THREE.Texture | null {
  const mat = getMaterialById(materialId);
  const effGrain = mat.hasGrain ? grain : 'none';
  const photoSpec = PHOTO_TEXTURE_BY_MATERIAL_ID[mat.id];

  if (photoSpec && canLoadBrowserTextures()) {
    const base = loadBasePhotoMaps(photoSpec.dir);
    const ru = uvInMeters
      ? Number((1 / photoSpec.tileMeters).toFixed(3))
      : quantizeNormalizedRepeat(repeatX, photoSpec.tileMeters);
    const rv = uvInMeters
      ? Number((1 / photoSpec.tileMeters).toFixed(3))
      : quantizeNormalizedRepeat(repeatY, photoSpec.tileMeters);
    const rot90 = effGrain === 'V';
    return getDerivedPhotoTexture(
      base,
      'diff',
      `diff:${photoSpec.dir}:${ru}x${rv}:${rot90 ? 'V' : 'H'}`,
      rot90 ? rv : ru,
      rot90 ? ru : rv,
      rot90
    );
  }

  const bundle = getProceduralSurfaceBundle(
    mat,
    effGrain,
    repeatX,
    repeatY,
    mat.colorHex,
    mat.secondaryHex ?? '#c5c0b6'
  );
  return bundle?.albedo ?? null;
}

export interface PbrMaterialOptions {
  repeatX?: number;
  repeatY?: number;
  /** Set true for Three.js ShapeGeometry / ExtrudeGeometry whose UVs are already in meters! */
  uvInMeters?: boolean;
  collisionTint?: boolean;
  /** Optional custom HEX color picker override for walls, floors, or bespoke lacquered cabinets */
  colorOverrideHex?: string;
  /** Optional custom grout HEX color for tiles, zellige, and checkerboard floors/walls */
  groutColorHex?: string;
}

export function getPbrMaterial(
  materialId: string,
  grain: GrainDirection = 'H',
  options: PbrMaterialOptions = {}
): THREE.MeshStandardMaterial {
  const mat = getMaterialById(materialId);
  const rx = options.repeatX ?? 1;
  const ry = options.repeatY ?? 1;
  const uvInMeters = Boolean(options.uvInMeters);
  const effGrain = mat.hasGrain ? grain : 'none';
  const photoSpec = PHOTO_TEXTURE_BY_MATERIAL_ID[mat.id];
  const customHex = normalizeHex(options.colorOverrideHex);
  const groutHex = normalizeHex(options.groutColorHex) ?? mat.secondaryHex ?? '#c5c0b6';

  const archPattern = isCustomArchitecturalPattern(mat);
  const tileMeters = photoSpec?.tileMeters ?? (archPattern ? getArchitecturalPatternTileMeters(mat) : 1);

  const ru =
    photoSpec || archPattern
      ? uvInMeters
        ? Number((1 / tileMeters).toFixed(3))
        : quantizeNormalizedRepeat(rx, tileMeters)
      : uvInMeters
        ? 1
        : Math.max(0.5, Math.round(rx * 2) / 2);
  const rv =
    photoSpec || archPattern
      ? uvInMeters
        ? Number((1 / tileMeters).toFixed(3))
        : quantizeNormalizedRepeat(ry, tileMeters)
      : uvInMeters
        ? 1
        : Math.max(0.5, Math.round(ry * 2) / 2);

  const key = `${mat.id}:${effGrain}:${ru}x${rv}:${uvInMeters ? 'm' : 'n'}:${options.collisionTint ? 'col' : 'std'}:${customHex ?? '-'}:${archPattern ? groutHex : '-'}`;
  const cached = materialCache.get(key);
  if (cached) return cached;

  let threeMat: THREE.MeshStandardMaterial;

  if (options.collisionTint) {
    threeMat = new THREE.MeshStandardMaterial({
      color: '#ef4444',
      roughness: 0.55,
      metalness: 0.05,
      emissive: new THREE.Color('#991b1b'),
      emissiveIntensity: 0.35,
    });
    threeMat.userData = { isCollision: true };
  } else if (archPattern) {
    // Architectural custom surfaces: Zellige, Large Format Tile, Checkerboard, Béton Ciré, Wallpaper
    const primaryHex = customHex ?? mat.colorHex;
    const bundle = getProceduralSurfaceBundle(mat, effGrain, ru, rv, primaryHex, groutHex);
    const isZellige = mat.pattern === 'zellige_tile';
    const isTile = mat.pattern === 'large_tile' || mat.pattern === 'checker_tile';

    if (isZellige || isTile) {
      const baseCc = isZellige ? 0.55 : 0.06;
      const baseCcR = isZellige ? 0.18 : 0.38;
      const baseEnv = isZellige ? 0.85 : 0.58;
      const effRough = isTile ? Math.max(0.48, mat.roughness) : mat.roughness;
      threeMat = new THREE.MeshPhysicalMaterial({
        color: bundle ? '#ffffff' : primaryHex,
        map: bundle?.albedo ?? null,
        bumpMap: bundle?.bump ?? null,
        bumpScale: isZellige ? 0.008 : 0.004,
        roughness: effRough,
        metalness: mat.metalness,
        clearcoat: baseCc,
        clearcoatRoughness: baseCcR,
        envMapIntensity: baseEnv,
      });
      threeMat.userData = {
        baseRoughness: effRough,
        baseClearcoat: baseCc,
        baseClearcoatRoughness: baseCcR,
        baseEnvIntensity: baseEnv,
        category: mat.category,
        isGlossyTile: isZellige,
      };
    } else {
      threeMat = new THREE.MeshStandardMaterial({
        color: bundle ? '#ffffff' : primaryHex,
        map: bundle?.albedo ?? null,
        bumpMap: bundle?.bump ?? null,
        bumpScale: mat.pattern === 'beton_cire' ? 0.005 : 0.004,
        roughness: mat.roughness,
        metalness: mat.metalness,
        envMapIntensity: mat.category === 'sol' ? 0.88 : 0.72,
      });
      threeMat.userData = {
        baseRoughness: mat.roughness,
        baseEnvIntensity: mat.category === 'sol' ? 0.88 : 0.72,
        category: mat.category,
      };
    }
  } else if (
    customHex &&
    (mat.category === 'melamine_bois' ||
      mat.category === 'melamine_uni' ||
      mat.category === 'laque_mat' ||
      mat.category === 'laque_brillant')
  ) {
    // Bespoke custom HEX lacquered cabinet finish (exact color, clean architectural sheen without glare)
    const isGloss = mat.pattern === 'solid_gloss';
    const baseR = isGloss ? 0.16 : 0.48;
    const baseCc = isGloss ? 0.72 : 0.06;
    const baseCcR = isGloss ? 0.1 : 0.42;
    threeMat = new THREE.MeshPhysicalMaterial({
      color: customHex,
      roughness: baseR,
      metalness: isGloss ? 0.05 : 0.02,
      clearcoat: baseCc,
      clearcoatRoughness: baseCcR,
      envMapIntensity: isGloss ? 1.05 : 0.62,
    });
    threeMat.userData = {
      baseRoughness: baseR,
      baseClearcoat: baseCc,
      baseClearcoatRoughness: baseCcR,
      baseEnvIntensity: isGloss ? 1.05 : 0.62,
      category: mat.category,
    };
  } else if (photoSpec && canLoadBrowserTextures()) {
    const base = loadBasePhotoMaps(photoSpec.dir);
    const rot90 = effGrain === 'V';
    const tileU = rot90 ? rv : ru;
    const tileV = rot90 ? ru : rv;
    const suffix = `${photoSpec.dir}:${tileU}x${tileV}:${rot90 ? 'V' : 'H'}`;

    const map = getDerivedPhotoTexture(base, 'diff', `diff:${suffix}`, tileU, tileV, rot90);
    const normalMap = getDerivedPhotoTexture(base, 'nor', `nor:${suffix}`, tileU, tileV, rot90);
    const roughnessMap = getDerivedPhotoTexture(base, 'rough', `rough:${suffix}`, tileU, tileV, rot90);
    const normalScale = new THREE.Vector2(photoSpec.normalScale, photoSpec.normalScale);
    const baseEnv = photoSpec.isStoneCountertop ? 0.82 : mat.category === 'sol' ? 0.55 : mat.category === 'mur' ? 0.45 : 0.58;
    const effectiveTint = customHex ?? photoSpec.tintHex;

    // Use MeshPhysicalMaterial on countertops & cabinet wood so live Brilliance/Vernis slider works cleanly
    if (photoSpec.isStoneCountertop || mat.category === 'melamine_bois') {
      const baseCc = photoSpec.baseClearcoat ?? 0;
      const baseCcR = photoSpec.baseClearcoatRoughness ?? 0.4;
      threeMat = new THREE.MeshPhysicalMaterial({
        color: effectiveTint,
        map,
        normalMap,
        normalScale,
        roughnessMap,
        roughness: photoSpec.roughnessMult,
        metalness: mat.metalness,
        clearcoat: baseCc,
        clearcoatRoughness: baseCcR,
        envMapIntensity: baseEnv,
      });
      threeMat.userData = {
        baseRoughness: photoSpec.roughnessMult,
        baseClearcoat: baseCc,
        baseClearcoatRoughness: baseCcR,
        baseEnvIntensity: baseEnv,
        category: mat.category,
      };
    } else {
      threeMat = new THREE.MeshStandardMaterial({
        color: effectiveTint,
        map,
        normalMap,
        normalScale,
        roughnessMap,
        roughness: photoSpec.roughnessMult,
        metalness: mat.metalness,
        envMapIntensity: baseEnv,
      });
      threeMat.userData = {
        baseRoughness: photoSpec.roughnessMult,
        baseEnvIntensity: baseEnv,
        category: mat.category,
      };
    }
  } else if (mat.pattern === 'solid_gloss') {
    threeMat = new THREE.MeshPhysicalMaterial({
      color: customHex ?? mat.colorHex,
      roughness: mat.roughness,
      metalness: mat.metalness,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
      envMapIntensity: 1.2,
    });
    threeMat.userData = {
      baseRoughness: mat.roughness,
      baseClearcoat: 0.9,
      baseClearcoatRoughness: 0.08,
      baseEnvIntensity: 1.2,
      category: mat.category,
    };
  } else if (mat.category === 'laque_mat' || mat.category === 'melamine_uni') {
    threeMat = new THREE.MeshPhysicalMaterial({
      color: customHex ?? mat.colorHex,
      roughness: mat.roughness,
      metalness: mat.metalness,
      clearcoat: mat.category === 'laque_mat' ? 0.04 : 0,
      clearcoatRoughness: 0.48,
      envMapIntensity: 0.56,
    });
    threeMat.userData = {
      baseRoughness: mat.roughness,
      baseClearcoat: mat.category === 'laque_mat' ? 0.04 : 0,
      baseClearcoatRoughness: 0.48,
      baseEnvIntensity: 0.56,
      category: mat.category,
    };
  } else {
    const primaryHex = customHex ?? mat.colorHex;
    const bundle = getProceduralSurfaceBundle(mat, effGrain, ru, rv, primaryHex, groutHex);
    threeMat = new THREE.MeshStandardMaterial({
      color: bundle ? '#ffffff' : primaryHex,
      map: bundle?.albedo ?? null,
      roughness: mat.roughness,
      metalness: mat.metalness,
      envMapIntensity: 0.85,
    });
    threeMat.userData = {
      baseRoughness: mat.roughness,
      baseEnvIntensity: 0.85,
      category: mat.category,
    };
  }

  applyTuningToMaterial(threeMat, currentTuning);

  if (materialCache.size >= MAX_MATERIAL_CACHE) {
    const oldestKey = materialCache.keys().next().value;
    if (oldestKey) {
      materialCache.get(oldestKey)?.dispose();
      materialCache.delete(oldestKey);
    }
  }
  materialCache.set(key, threeMat);
  return threeMat;
}

export function refreshAllTexturesAfterContextRestore(): void {
  for (const base of basePhotoCache.values()) {
    if (base.diff.image) base.diff.needsUpdate = true;
    if (base.nor.image) base.nor.needsUpdate = true;
    if (base.rough.image) base.rough.needsUpdate = true;
  }
  for (const tex of derivedTextureCache.values()) {
    if (tex.image) tex.needsUpdate = true;
  }
  for (const bundle of proceduralSurfaceCache.values()) {
    bundle.albedo.needsUpdate = true;
    if (bundle.bump) bundle.bump.needsUpdate = true;
  }
  for (const mat of materialCache.values()) {
    mat.needsUpdate = true;
  }
}

export function disposeProceduralMaterials(): void {
  for (const mat of materialCache.values()) {
    mat.dispose();
  }
  materialCache.clear();
  for (const tex of derivedTextureCache.values()) {
    tex.dispose();
  }
  derivedTextureCache.clear();
  for (const base of basePhotoCache.values()) {
    base.diff.dispose();
    base.nor.dispose();
    base.rough.dispose();
    base.clonesByChannel.diff.clear();
    base.clonesByChannel.nor.clear();
    base.clonesByChannel.rough.clear();
  }
  basePhotoCache.clear();
  for (const bundle of proceduralSurfaceCache.values()) {
    bundle.albedo.dispose();
    bundle.bump?.dispose();
  }
  proceduralSurfaceCache.clear();
}
