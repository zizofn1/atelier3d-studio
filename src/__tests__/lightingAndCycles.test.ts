import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import {
  buildCyclesSceneConfig,
  computeSceneGeometryHash,
} from '@/exports/cyclesRenderClient';
import {
  applyGlobalMaterialTuning,
  getPbrMaterial,
} from '@/materials/proceduralTextures';

describe('Qualité 3D, Calibration PBR & Backend Blender Cycles (16x MSAA équiv.)', () => {
  it('maintient une rugosité et un envMapIntensity réalistes sans effet plastique ni éblouissement sur bois/sols mats', () => {
    // Typical Showroom Luxe tuning (hdriIntensity = 0.42, glossBoost = 0)
    applyGlobalMaterialTuning({ glossBoost: 0, hdriIntensity: 0.42, qualityEnvScale: 1.0 });

    const matteCabinet = getPbrMaterial('laque-blanc-mat', 'none');
    expect(matteCabinet.envMapIntensity).toBeLessThan(0.5);
    if (matteCabinet instanceof THREE.MeshPhysicalMaterial) {
      expect(matteCabinet.clearcoat).toBeLessThanOrEqual(0.06);
    }

    const floorTile = getPbrMaterial('carrelage-gres', 'none');
    expect(floorTile.roughness).toBeGreaterThanOrEqual(0.45);
    expect(floorTile.envMapIntensity).toBeLessThan(0.5);
    if (floorTile instanceof THREE.MeshPhysicalMaterial) {
      expect(floorTile.clearcoat).toBeLessThanOrEqual(0.1);
    }

    // Even when HDRI is turned all the way down to 0, reflections drop near zero
    applyGlobalMaterialTuning({ glossBoost: 0, hdriIntensity: 0, qualityEnvScale: 1.0 });
    expect(floorTile.envMapIntensity).toBeLessThan(0.15);
  });

  it('construit un payload Cycles complet avec caméra, spots plafond, bandeaux LED et mode 16x MSAA', () => {
    const doc = createCuisineEnLTemplate();
    doc.ceilingLighting = {
      spotsEnabled: true,
      spotIntensity: 0.55,
      spots: [
        { id: 'sp-1', xMm: 1200, zMm: 1000, intensity: 1.0, enabled: true },
        { id: 'sp-2', xMm: 2600, zMm: 1800, intensity: 0.8, enabled: true },
      ],
    };
    doc.props = [
      {
        id: 'prop-lamp',
        ref: 'E01',
        type: 'suspension_lustre',
        category: 'eclairage_deco',
        nameFr: 'Suspension',
        xMm: 1800,
        yMm: 1850,
        zMm: 1900,
        rotationYRad: 0,
        widthMm: 420,
        heightMm: 620,
        depthMm: 420,
        lightOn: true,
        lightIntensity: 1.2,
      },
    ];

    const payload = buildCyclesSceneConfig(
      doc,
      { positionMm: [3500, 1750, 3900], targetMm: [1800, 900, 1200], fovDeg: 52 },
      {
        lightingPreset: 'nuit',
        ledEnabled: true,
        exposure: 0.92,
        sunIntensity: 0,
        sunAngleDeg: 108,
      },
      { width: 2560, height: 1440, aaMode: 'aa16' }
    );

    expect(payload.width).toBe(2560);
    expect(payload.height).toBe(1440);
    expect(payload.aaMode).toBe('aa16');
    expect(payload.camera.fovDeg).toBe(52);
    expect(payload.lighting.spots).toHaveLength(2);
    expect(payload.lighting.spotIntensity).toBe(0.55);
    expect(payload.lighting.ledStrips.length).toBeGreaterThanOrEqual(1);
    expect(payload.lighting.propLights).toHaveLength(1);
    expect(payload.lighting.propLights[0].intensity).toBe(1.2);
  });

  it('inclut tous les fichiers du serveur maison Blender Cycles (FastAPI, script Cycles 16x MSAA, Docker & lanceur Windows)', () => {
    const serverDir = path.resolve(process.cwd(), 'backend', 'render_server');
    for (const file of [
      'server.py',
      'render_cycles.py',
      'blender_worker.py',
      'requirements.txt',
      'Dockerfile',
      'start_windows.bat',
      'README.md',
    ]) {
      const full = path.join(serverDir, file);
      expect(fs.existsSync(full), `Fichier backend manquant: ${file}`).toBe(true);
    }

    const cyclesSrc = fs.readFileSync(path.join(serverDir, 'render_cycles.py'), 'utf8');
    expect(cyclesSrc).toContain('BLACKMAN_HARRIS');
    expect(cyclesSrc).toContain('OPENIMAGEDENOISE');
    expect(cyclesSrc).toContain('AgX');
    expect(cyclesSrc).toContain('aa16');
    expect(cyclesSrc).toContain('LANCZOS');
    expect(cyclesSrc).toContain('ShaderNodeAmbientOcclusion');
    expect(cyclesSrc).toContain('BLENDER_EEVEE');
  });

  it('calcule un hash géométrique stable qui ignore les lumières/caméra et détecte les ajouts de caissons', () => {
    const doc = createCuisineEnLTemplate();
    const h1 = computeSceneGeometryHash(doc);
    // Changing ceiling lighting should NOT invalidate the 3D geometry cache
    doc.ceilingLighting = { spotsEnabled: false, spotIntensity: 0.2, spots: [] };
    const h2 = computeSceneGeometryHash(doc);
    expect(h2).toBe(h1);

    // Moving a module MUST invalidate the geometry cache
    doc.modules[0] = { ...doc.modules[0], xMm: doc.modules[0].xMm + 200 };
    const h3 = computeSceneGeometryHash(doc);
    expect(h3).not.toBe(h1);
  });
});
