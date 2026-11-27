import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PHOTO_TEXTURE_BY_MATERIAL_ID,
  applyGlobalMaterialTuning,
  getPbrMaterial,
  getSharedEdgeLineMaterial,
  setEdgeLinesOpacity,
} from '@/materials/proceduralTextures';
import {
  RENDER_STYLE_PRESETS,
  getDefaultStyleSettings,
  getRenderStylePreset,
  type RenderStyleId,
} from '@/materials/renderStyles';
import { useUIStore } from '@/store/useUIStore';

describe('Comparateur de Styles 3D & Assets PBR locaux', () => {
  it('expose exactement 5 styles de rendu distincts en français', () => {
    expect(RENDER_STYLE_PRESETS).toHaveLength(5);

    const ids = RENDER_STYLE_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      'homebyme_clair',
      'showroom_luxe',
      'sketchup_pro',
      'soleil_naturel',
      'ambiance_soiree',
    ]);

    for (const preset of RENDER_STYLE_PRESETS) {
      expect(preset.labelFr.length).toBeGreaterThan(3);
      expect(preset.descriptionFr.length).toBeGreaterThan(10);
      expect(['agx', 'aces']).toContain(preset.toneMapping);
    }

    // Distinct visual signatures across presets
    expect(getRenderStylePreset('homebyme_clair').toneMapping).toBe('agx');
    expect(getRenderStylePreset('showroom_luxe').defaultLedEnabled).toBe(true);
    expect(getRenderStylePreset('sketchup_pro').defaults.edgeLinesOpacity).toBeGreaterThan(0.2);
    expect(getRenderStylePreset('soleil_naturel').defaults.sunIntensity).toBeGreaterThan(2.0);
    expect(getRenderStylePreset('ambiance_soiree').isNightMood).toBe(true);
  });

  it('met à jour useUIStore lors du changement de style, curseurs et réinitialisation', () => {
    const store = useUIStore.getState();

    store.selectRenderStyle('showroom_luxe');
    let state = useUIStore.getState();
    expect(state.renderStyle.styleId).toBe('showroom_luxe');
    expect(state.ledEnabled).toBe(true);
    expect(state.lightingPreset).toBe('nuit');
    expect(state.renderStyle.exposure).toBe(0.92);
    expect(state.renderStyle.hdriIntensity).toBe(0.42);
    expect(state.renderStyle.sunIntensity).toBe(0);
    expect(state.renderStyle.sunAngleDeg).toBe(108);

    store.selectRenderStyle('ambiance_soiree');
    state = useUIStore.getState();
    expect(state.renderStyle.styleId).toBe('ambiance_soiree');
    expect(state.lightingPreset).toBe('nuit');
    expect(state.ledEnabled).toBe(true);

    store.selectRenderStyle('sketchup_pro');
    store.updateRenderStyleSetting({
      exposure: 1.5,
      edgeLinesOpacity: 0.45,
      sunAngleDeg: 180,
      glossBoost: 0.7,
    });
    state = useUIStore.getState();
    expect(state.renderStyle.exposure).toBe(1.5);
    expect(state.renderStyle.edgeLinesOpacity).toBe(0.45);
    expect(state.renderStyle.sunAngleDeg).toBe(180);
    expect(state.renderStyle.glossBoost).toBe(0.7);

    store.resetRenderStyle();
    state = useUIStore.getState();
    expect(state.renderStyle).toEqual(getDefaultStyleSettings('sketchup_pro'));

    // Restore default style
    store.selectRenderStyle('homebyme_clair');
  });

  it('pilote en direct les arêtes SketchUp et la brillance globale des matériaux PBR', () => {
    const edgeMat = getSharedEdgeLineMaterial();
    setEdgeLinesOpacity(0);
    expect(edgeMat.visible).toBe(false);
    expect(edgeMat.opacity).toBe(0);

    setEdgeLinesOpacity(0.32);
    expect(edgeMat.visible).toBe(true);
    expect(edgeMat.opacity).toBeCloseTo(0.32, 3);
    setEdgeLinesOpacity(0);

    const mat = getPbrMaterial('laque-blanc-brillant', 'none');
    applyGlobalMaterialTuning({ glossBoost: 0.9, hdriIntensity: 1.2 });
    expect(mat.roughness).toBeGreaterThanOrEqual(0.08);
    expect(mat.envMapIntensity).toBeGreaterThan(1.0);
  });

  it('vérifie que les 22 fichiers PBR + HDRI locaux existent dans public/ et couvrent tous les matériaux photo', () => {
    const publicDir = path.resolve(process.cwd(), 'public');
    const hdriPath = path.join(publicDir, 'env', 'atelier_daylight_1k.hdr');
    expect(fs.existsSync(hdriPath)).toBe(true);
    expect(fs.statSync(hdriPath).size).toBeGreaterThan(100_000);

    const requiredDirs = ['oak', 'walnut', 'marble', 'quartz', 'parquet', 'ceramic', 'plaster'] as const;
    for (const dir of requiredDirs) {
      for (const file of ['diff.jpg', 'nor_gl.jpg', 'rough.jpg']) {
        const full = path.join(publicDir, 'textures', dir, file);
        expect(fs.existsSync(full), `Fichier manquant: ${full}`).toBe(true);
        expect(fs.statSync(full).size).toBeGreaterThan(5_000);
      }
    }

    const entries = Object.entries(PHOTO_TEXTURE_BY_MATERIAL_ID);
    expect(entries.length).toBeGreaterThanOrEqual(12);
    for (const [matId, spec] of entries) {
      expect(requiredDirs).toContain(spec.dir);
      expect(spec.tileMeters, `Échelle UV invalide pour ${matId}`).toBeGreaterThanOrEqual(0.5);
      expect(spec.tileMeters, `Échelle UV invalide pour ${matId}`).toBeLessThanOrEqual(2.5);
    }

    // Ensure every RenderStyleId resolves cleanly
    const allIds: RenderStyleId[] = [
      'homebyme_clair',
      'showroom_luxe',
      'sketchup_pro',
      'soleil_naturel',
      'ambiance_soiree',
    ];
    for (const id of allIds) {
      expect(getRenderStylePreset(id).id).toBe(id);
    }
  });
});
