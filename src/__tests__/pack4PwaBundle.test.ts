import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import { loadPdfFontPair, PDF_FONT_FAMILY, registerFrenchPdfFont } from '@/exports/fontLoader';
import {
  DESKTOP_QUALITY_PROFILE,
  detectDeviceQualityProfile,
  MOBILE_IPAD_QUALITY_PROFILE,
} from '@/utils/deviceProfile';

const ROOT = process.cwd();

describe('Pack 4 (P5) — Profil Mobile/iPad, Polices TTF statiques & PWA Hors-Ligne', () => {
  it('détecte automatiquement le Profil Mobile / iPad (DPR [1, 1.2], anisotropie 2, textures 512px) vs Bureau', () => {
    // 1. iPad Pro / Air sous iPadOS 13+ (MacIntel + multi-touch)
    const ipad = detectDeviceQualityProfile({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
      viewportWidth: 1180,
    });
    expect(ipad).toEqual(MOBILE_IPAD_QUALITY_PROFILE);
    expect(ipad.dpr).toEqual([1, 1.2]);
    expect(ipad.maxAnisotropy).toBe(2);
    expect(ipad.maxTextureSizePx).toBe(512);

    // 2. iPhone / Android tactile
    const iphone = detectDeviceQualityProfile({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)',
      platform: 'iPhone',
      maxTouchPoints: 5,
      coarsePointer: true,
      viewportWidth: 390,
    });
    expect(iphone.id).toBe('mobile');
    expect(iphone.maxTextureSizePx).toBe(512);

    // 3. Station de travail Bureau Windows / macOS sans écran tactile
    const desktop = detectDeviceQualityProfile({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0',
      platform: 'Win32',
      maxTouchPoints: 0,
      coarsePointer: false,
      viewportWidth: 1920,
    });
    expect(desktop).toEqual(DESKTOP_QUALITY_PROFILE);
    expect(desktop.dpr).toEqual([1, 1.5]);
    expect(desktop.maxAnisotropy).toBe(4);
    expect(desktop.maxTextureSizePx).toBe(1024);
  });

  it('fournit les polices binaires DejaVuSans.ttf et DejaVuSans-Bold.ttf dans public/fonts/ sans bundle JS Base64', async () => {
    const regularPath = path.join(ROOT, 'public', 'fonts', 'DejaVuSans.ttf');
    const boldPath = path.join(ROOT, 'public', 'fonts', 'DejaVuSans-Bold.ttf');
    expect(fs.existsSync(regularPath)).toBe(true);
    expect(fs.existsSync(boldPath)).toBe(true);

    // Check TrueType 0x00010000 sfnt version header
    const regHeader = fs.readFileSync(regularPath).subarray(0, 4);
    expect(regHeader.readUInt32BE(0)).toBe(0x00010000);

    const pair = await loadPdfFontPair();
    expect(pair.regularBase64.length).toBeGreaterThan(100_000);
    expect(pair.boldBase64.length).toBeGreaterThan(100_000);

    const pdf = new jsPDF();
    const family = await registerFrenchPdfFont(pdf);
    expect(family).toBe(PDF_FONT_FAMILY);
  });

  it('génère des icônes PNG PWA valides (180, 192, 512 px) et configure manifest, index.html, sw.js et _headers', () => {
    const expectedIcons: Array<{ file: string; size: number }> = [
      { file: 'apple-touch-icon-180.png', size: 180 },
      { file: 'icon-192.png', size: 192 },
      { file: 'icon-512.png', size: 512 },
    ];

    for (const item of expectedIcons) {
      const iconPath = path.join(ROOT, 'public', 'icons', item.file);
      expect(fs.existsSync(iconPath), `${item.file} manquant`).toBe(true);
      const buf = fs.readFileSync(iconPath);
      // Standard 8-byte PNG signature + IHDR width & height at offsets 16 and 20
      expect(buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
      expect(buf.readUInt32BE(16)).toBe(item.size);
      expect(buf.readUInt32BE(20)).toBe(item.size);
    }

    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(indexHtml).toContain('apple-touch-icon');
    expect(indexHtml).toContain('/icons/apple-touch-icon-180.png');
    expect(indexHtml).toContain('/manifest.webmanifest');
    expect(indexHtml).toContain('viewport-fit=cover');

    const manifestRaw = fs.readFileSync(path.join(ROOT, 'public', 'manifest.webmanifest'), 'utf8');
    const manifest = JSON.parse(manifestRaw) as {
      lang: string;
      display: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };
    expect(manifest.lang).toBe('fr');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i) => i.sizes === '180x180' && i.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '192x192' && i.type === 'image/png')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png')).toBe(true);

    const swJs = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8');
    expect(swJs).toContain("addEventListener('install'");
    expect(swJs).toContain("addEventListener('activate'");
    expect(swJs).toContain("addEventListener('fetch'");

    const headersTxt = fs.readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');
    expect(headersTxt).toContain('/assets/*');
    expect(headersTxt).toContain('/textures/*');
    expect(headersTxt).toContain('/env/*');
    expect(headersTxt).toContain('/fonts/*');
    expect(headersTxt).toContain('max-age=31536000, immutable');

    // If dist/index.html exists from production build, verify three/pdf/html2canvas are NEVER preloaded eagerly
    const distIndexPath = path.join(ROOT, 'dist', 'index.html');
    if (fs.existsSync(distIndexPath)) {
      const distHtml = fs.readFileSync(distIndexPath, 'utf8');
      expect(distHtml).not.toContain('html2canvas');
      expect(distHtml).not.toMatch(/modulepreload[^>]+(three-|r3f-|pdf-)/);
    }
  });
});
