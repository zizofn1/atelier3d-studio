import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { extractPrimaryRoomPolygon, isPointInPolygonXZ } from '@/engine/geometry';
import {
  applyEasing,
  catmullRom3D,
  createJourNuitPreset,
  createReelsMontagePreset,
  createTourClientPreset,
  evaluateCameraAt,
  evaluateFrameAt,
} from '@/engine/video';
import {
  computeCenterCropRect,
  resolveVideoExportDimensions,
  selectSupportedVideoMimeType,
} from '@/exports/videoExport';
import {
  parseAndValidateProjectJson,
  serializeProjectToJson,
} from '@/persistence/jsonSerializer';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { DEFAULT_VIDEO_STUDIO_CONFIG, type VideoStudioConfig } from '@/types';

describe('Studio Vidéo — Moteur d’animation pur, Presets & Persistance', () => {
  beforeEach(() => {
    useUIStore.getState().setVideoStudioMode(false);
    useUIStore.getState().setVideoPlayheadSec(0);
  });

  it('respecte les bornes et la monotonie des courbes de lissage (linear, easeInOut, easeOut)', () => {
    for (const easing of ['linear', 'easeInOut', 'easeOut'] as const) {
      expect(applyEasing(-0.5, easing)).toBe(0);
      expect(applyEasing(0, easing)).toBe(0);
      expect(applyEasing(1, easing)).toBe(1);
      expect(applyEasing(1.5, easing)).toBe(1);

      let prev = 0;
      for (let i = 1; i <= 20; i++) {
        const val = applyEasing(i / 20, easing);
        expect(val).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(val).toBeLessThanOrEqual(1);
        prev = val;
      }
    }
    // easeOut rises faster than linear at t=0.25
    expect(applyEasing(0.25, 'easeOut')).toBeGreaterThan(0.25);
    // easeInOut is symmetric around 0.5
    expect(applyEasing(0.5, 'easeInOut')).toBeCloseTo(0.5, 5);
  });

  it('interpole exactement aux points clés en spline Catmull-Rom 3D et contraint la caméra dans la pièce', () => {
    const doc = createCuisineEnLTemplate();
    const p0: [number, number, number] = [600, 1500, 2600];
    const p1: [number, number, number] = [1800, 1500, 2600];
    const p2: [number, number, number] = [2800, 1500, 1800];
    const p3: [number, number, number] = [2800, 1500, 900];

    expect(catmullRom3D(p0, p1, p2, p3, 0)).toEqual(p1);
    expect(catmullRom3D(p0, p1, p2, p3, 1)).toEqual(p2);

    const cfg: VideoStudioConfig = {
      ...DEFAULT_VIDEO_STUDIO_CONFIG,
      durationSec: 10,
      constrainInsideRoom: false,
      keyframes: [
        {
          id: 'k1',
          timeSec: 0,
          positionMm: p0,
          targetMm: [1800, 1100, 300],
          fovDeg: 60,
          easing: 'easeInOut',
        },
        {
          id: 'k2',
          timeSec: 5,
          positionMm: p1,
          targetMm: [1800, 1100, 300],
          fovDeg: 70,
          easing: 'linear',
        },
        {
          id: 'k3',
          timeSec: 10,
          positionMm: p2,
          targetMm: [300, 1100, 1500],
          fovDeg: 65,
          easing: 'easeOut',
        },
      ],
    };

    const atStart = evaluateCameraAt(0, cfg, doc);
    expect(atStart.positionMm[0]).toBeCloseTo(p0[0], 3);
    expect(atStart.fovDeg).toBe(60);

    const atMid = evaluateCameraAt(5, cfg, doc);
    expect(atMid.positionMm[0]).toBeCloseTo(p1[0], 3);
    expect(atMid.fovDeg).toBe(70);

    const atEnd = evaluateCameraAt(10, cfg, doc);
    expect(atEnd.positionMm[0]).toBeCloseTo(p2[0], 3);
    expect(atEnd.fovDeg).toBe(65);

    // Constrained inside room pulls an out-of-bounds keyframe strictly inside closed walls
    const outsideCfg: VideoStudioConfig = {
      ...cfg,
      constrainInsideRoom: true,
      keyframes: [
        {
          id: 'k-out',
          timeSec: 0,
          positionMm: [9000, 1500, 9000],
          targetMm: [1800, 1100, 1500],
          fovDeg: 65,
          easing: 'linear',
        },
      ],
    };
    const clampedPose = evaluateCameraAt(0, outsideCfg, doc);
    const poly = extractPrimaryRoomPolygon(doc.walls)!;
    expect(
      isPointInPolygonXZ({ x: clampedPose.positionMm[0], z: clampedPose.positionMm[2] }, poly.points)
    ).toBe(true);
  });

  it('évalue de manière déterministe les portes, transitions Jour→Nuit et le montage progressif (Bas → Plan → Haut → Déco)', () => {
    const doc = createCuisineEnLTemplate();
    // Ensure a prop exists to validate Phase 3 (Électro & Déco) assembly stagger
    doc.props = [
      {
        id: 'prop-test-1',
        ref: 'E01',
        type: 'refrigerateur',
        category: 'electromenager',
        nameFr: 'Réfrigérateur',
        xMm: 1000,
        yMm: 0,
        zMm: 350,
        rotationYRad: 0,
        widthMm: 600,
        heightMm: 1850,
        depthMm: 650,
      },
    ];

    const cfg: VideoStudioConfig = {
      ...DEFAULT_VIDEO_STUDIO_CONFIG,
      durationSec: 10,
      events: [
        { id: 'ev-asm', kind: 'assembly_mode', startSec: 0, durationSec: 8 },
        { id: 'ev-open', kind: 'open_doors', startSec: 4, durationSec: 2, target: 'all' },
        {
          id: 'ev-light',
          kind: 'lighting_transition',
          startSec: 2,
          durationSec: 6,
          fromPreset: 'jour',
          toPreset: 'nuit',
          enableLedsAtEnd: true,
        },
      ],
    };

    const baseMod = doc.modules.find((m) => m.type === 'caisson_bas')!;
    const worktopMod = doc.modules.find((m) => m.type === 'plan_de_travail')!;
    const upperMod = doc.modules.find((m) => m.type === 'caisson_haut')!;

    // At t = 0: doors closed, day lighting, assembly hidden
    const f0 = evaluateFrameAt(0, cfg, doc, 'jour', true);
    expect(f0.moduleDoorProgress[baseMod.id]).toBe(0);
    expect(f0.lightingNightFactor).toBe(0);
    expect(f0.moduleAssembly[baseMod.id].visible).toBe(false);
    expect(f0.propAssembly['prop-test-1'].visible).toBe(false);

    // At t = 2.5s (31% of assembly): base cabinets already appearing, upper/props still waiting
    const fEarly = evaluateFrameAt(2.5, cfg, doc, 'jour', true);
    expect(fEarly.moduleAssembly[baseMod.id].progress).toBeGreaterThan(0.5);
    expect(fEarly.moduleAssembly[upperMod.id].progress).toBe(0);
    expect(fEarly.propAssembly['prop-test-1'].progress).toBe(0);

    // At t = 5s (62.5% of assembly): base & worktop finished, upper appearing, doors halfway open, twilight lighting
    const fMid = evaluateFrameAt(5, cfg, doc, 'jour', true);
    expect(fMid.moduleAssembly[baseMod.id].progress).toBe(1);
    expect(fMid.moduleAssembly[worktopMod.id].progress).toBe(1);
    expect(fMid.moduleAssembly[upperMod.id].progress).toBeGreaterThan(0);
    expect(fMid.moduleDoorProgress[baseMod.id]).toBeCloseTo(0.5, 2);
    expect(fMid.lightingNightFactor).toBeCloseTo(0.5, 2);

    // At t = 9s: everything fully assembled, doors open, night lighting & LEDs ON
    const fEnd = evaluateFrameAt(9, cfg, doc, 'jour', true);
    expect(fEnd.moduleAssembly[upperMod.id].progress).toBe(1);
    expect(fEnd.propAssembly['prop-test-1'].progress).toBe(1);
    expect(fEnd.propAssembly['prop-test-1'].yOffsetMm).toBe(0);
    expect(fEnd.moduleDoorProgress[baseMod.id]).toBe(1);
    expect(fEnd.lightingNightFactor).toBe(1);
    expect(fEnd.ledIntensityFactor).toBe(1);
  });

  it('génère les 3 modèles 1-clic automatiques valides (Tour Client, Reels Montage 9:16, Jour → Nuit)', () => {
    const doc = createCuisineEnLTemplate();

    const tour = createTourClientPreset(doc);
    expect(tour.aspectRatio).toBe('16:9');
    expect(tour.keyframes.length).toBeGreaterThanOrEqual(2);
    expect(tour.events.some((e) => e.kind === 'open_doors')).toBe(true);

    const reels = createReelsMontagePreset(doc);
    expect(reels.aspectRatio).toBe('9:16');
    expect(reels.events.some((e) => e.kind === 'assembly_mode')).toBe(true);

    const dayNight = createJourNuitPreset(doc);
    expect(dayNight.aspectRatio).toBe('16:9');
    expect(dayNight.events.some((e) => e.kind === 'lighting_transition')).toBe(true);
  });

  it('résout correctement les résolutions 16:9 / 9:16, le recadrage centré et la priorité MP4 → WebM', () => {
    expect(resolveVideoExportDimensions('16:9', false)).toMatchObject({ width: 1920, height: 1080, shadowMapSize: 4096 });
    expect(resolveVideoExportDimensions('9:16', false)).toMatchObject({ width: 1080, height: 1920, shadowMapSize: 4096 });
    expect(resolveVideoExportDimensions('9:16', true)).toMatchObject({ width: 720, height: 1280, shadowMapSize: 2048 });

    // 9:16 crop inside a 1920x1080 landscape canvas crops symmetrically horizontally
    const crop = computeCenterCropRect(1920, 1080, 1080, 1920);
    expect(crop.sh).toBe(1080);
    expect(crop.sw).toBeCloseTo(607.5, 1);
    expect(crop.sx).toBeCloseTo((1920 - 607.5) / 2, 1);

    // MIME priority: MP4 H.264 first, seamless WebM VP9 fallback
    const mp4Pick = selectSupportedVideoMimeType((m) => m.startsWith('video/mp4'));
    expect(mp4Pick?.extension).toBe('mp4');

    const webmPick = selectSupportedVideoMimeType((m) => m === 'video/webm;codecs=vp9');
    expect(webmPick).toEqual({ mimeType: 'video/webm;codecs=vp9', extension: 'webm' });
  });

  it('persiste et valide videoStudio en aller-retour .atelier3d.json (avec rétrocompatibilité)', () => {
    const doc = createCuisineEnLTemplate();
    // 1. Legacy document without videoStudio still validates
    const legacyParsed = parseAndValidateProjectJson(serializeProjectToJson(doc));
    expect(legacyParsed.ok).toBe(true);

    // 2. Document with videoStudio (keyframes, events, branding logo data-URL) roundtrips cleanly
    const reels = createReelsMontagePreset(doc);
    reels.branding.logoDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    useProjectStore.getState().setDocument(doc);
    useProjectStore.getState().setVideoStudio(reels);

    const savedDoc = useProjectStore.getState().document;
    const rawJson = serializeProjectToJson(savedDoc);
    const parsed = parseAndValidateProjectJson(rawJson);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.videoStudio).toEqual(reels);
      expect(parsed.document.videoStudio?.branding.logoDataUrl).toBe(
        'data:image/png;base64,iVBORw0KGgo='
      );
    }

    // UI mode toggles cleanly
    useUIStore.getState().setVideoStudioMode(true);
    expect(useUIStore.getState().videoStudioMode).toBe(true);
    expect(useUIStore.getState().viewMode).toBe('view3d');
  });

  it('garantit l’isolation pure du moteur src/engine/video (aucun import React, Three.js ou DOM)', () => {
    for (const file of ['animationEngine.ts', 'presets.ts', 'index.ts']) {
      const content = readFileSync(resolve(process.cwd(), 'src/engine/video', file), 'utf-8');
      expect(content).not.toMatch(/from\s+['"](?:react|three|@react-three|zustand)/);
      expect(content).not.toMatch(/\b(?:window|document)\./);
    }
  });
});
