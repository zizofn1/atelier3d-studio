import { describe, expect, it } from 'vitest';
import { DEFAULT_CARPENTRY_PARAMS, MODULE_CATALOG_BY_TYPE } from '@/data/defaultPricing';
import { PROPS_CATALOG_BY_TYPE } from '@/data/propsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { generateModuleOutput } from '@/engine/carpentry';
import { computeAutoUtilitiesForPlacement, resolveCeilingLighting } from '@/engine/geometry';
import { buildCyclesSceneConfig } from '@/exports/cyclesRenderClient';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';

describe('Liberté Inspecteur Caissons, Nouveaux Modèles & Multi-Spots', () => {
  it('génère correctement le caisson haut d’angle aveugle (gauche/droite, sans plinthe, suspension murale)', () => {
    expect(MODULE_CATALOG_BY_TYPE.caisson_haut_angle_aveugle).toBeDefined();
    expect(MODULE_CATALOG_BY_TYPE.caisson_sur_frigo).toBeDefined();
    expect(MODULE_CATALOG_BY_TYPE.caisson_haut_relevant).toBeDefined();

    const makeMod = (blindSide: 'left' | 'right') => ({
      id: `mod-upper-blind-${blindSide}`,
      ref: 'M90',
      type: 'caisson_haut_angle_aveugle' as const,
      nameFr: "Caisson haut d'angle mort",
      xMm: 1000,
      yMm: 1470,
      zMm: 300,
      rotationYRad: 0,
      widthMm: 950,
      heightMm: 720,
      depthMm: 350,
      doorCount: 1,
      drawerCount: 0,
      shelfCount: 2,
      blindSide,
    });

    const outLeft = generateModuleOutput(makeMod('left'), DEFAULT_CARPENTRY_PARAMS);
    const outRight = generateModuleOutput(makeMod('right'), DEFAULT_CARPENTRY_PARAMS);

    // Wall-hung: zero plinth panel, has suspension_murale hardware
    expect(outLeft.panels.some((p) => p.role === 'plinthe')).toBe(false);
    expect(outLeft.hardware.some((h) => h.kind === 'suspension_murale')).toBe(true);

    const fixedLeft = outLeft.panels.find((p) => p.nameFr.toLowerCase().includes('fixe'));
    const fixedRight = outRight.panels.find((p) => p.nameFr.toLowerCase().includes('fixe'));
    expect(fixedLeft).toBeDefined();
    expect(fixedRight).toBeDefined();
    expect(fixedLeft!.positionMm[0]).toBeLessThan(0);
    expect(fixedRight!.positionMm[0]).toBeGreaterThan(0);
  });

  it('transmet les réglages LED personnalisés (couleur, intensité, pourtour) au payload Cycles', () => {
    const doc = createCuisineEnLTemplate();
    doc.modules[0] = {
      ...doc.modules[0],
      facadeKind: 'vitre',
      glassFrameWidthMm: 20,
      glassTintHex: '#64748b',
      glassOpacity: 0.42,
      handlePositionY: 'bottom',
      ledInterior: true,
      ledInteriorWrap: true,
      ledColorHex: '#dceeff',
      ledIntensity: 1.6,
    };

    const payload = buildCyclesSceneConfig(
      doc,
      { positionMm: [3000, 1600, 3200], targetMm: [1500, 900, 1200], fovDeg: 50 },
      { lightingPreset: 'nuit', ledEnabled: true, exposure: 1.0, sunIntensity: 0, sunAngleDeg: 90 }
    );

    const interiorStrip = payload.lighting.ledStrips.find((s) => s.interior);
    expect(interiorStrip).toBeDefined();
    expect(interiorStrip!.wrap).toBe(true);
    expect(interiorStrip!.colorHex).toBe('#dceeff');
    expect(interiorStrip!.intensity).toBe(1.6);
  });

  it('inclut la machine à laver et les nouveaux modèles électro/déco avec raccordements auto eau + prise', () => {
    for (const t of [
      'machine_laver',
      'seche_linge',
      'machine_cafe',
      'bouilloire_grille_pain',
      'chauffe_eau',
      'tableau_mural',
      'etagere_murale',
    ] as const) {
      expect(PROPS_CATALOG_BY_TYPE[t], `Catalogue manquant pour ${t}`).toBeDefined();
    }

    const doc = createCuisineEnLTemplate();
    doc.utilities = [];
    const wall = doc.walls[0];
    const autoUtils = computeAutoUtilitiesForPlacement(doc, {
      entityId: 'p-wash',
      kind: 'prop',
      type: 'machine_laver',
      nameFr: 'Machine à laver',
      xMm: 1600,
      yMm: 0,
      zMm: 400,
      attachedWallId: wall.id,
    });

    expect(autoUtils.some((u) => u.kind === 'arrivee_eau')).toBe(true);
    expect(autoUtils.some((u) => u.kind === 'prise')).toBe(true);
  });

  it('permet d’ajouter plusieurs spots sans empilement et de les modifier/aligner/supprimer en lot', () => {
    const doc = createCuisineEnLTemplate();
    useProjectStore.getState().setDocument(doc);
    useUIStore.getState().clearSelection();

    const s1 = useProjectStore.getState().addCeilingSpot();
    const s2 = useProjectStore.getState().addCeilingSpot();
    const afterAdd = resolveCeilingLighting(
      useProjectStore.getState().document.walls,
      useProjectStore.getState().document.ceilingLighting
    );
    const sp1 = afterAdd.spots.find((s) => s.id === s1)!;
    const sp2 = afterAdd.spots.find((s) => s.id === s2)!;
    expect(sp1).toBeDefined();
    expect(sp2).toBeDefined();
    expect(Math.hypot(sp1.xMm - sp2.xMm, sp1.zMm - sp2.zMm)).toBeGreaterThanOrEqual(200);

    // Multi-select spots and batch-update intensity & alignment
    useUIStore.getState().setSelectedIds([s1, s2], 'spot');
    expect(useUIStore.getState().selectedKind).toBe('spot');
    expect(useUIStore.getState().selectedIds).toEqual([s1, s2]);

    useProjectStore.getState().updateCeilingSpotsBatch([s1, s2], { intensity: 1.45, enabled: true });
    useProjectStore.getState().alignCeilingSpots([s1, s2], 'align_z');

    const afterBatch = resolveCeilingLighting(
      useProjectStore.getState().document.walls,
      useProjectStore.getState().document.ceilingLighting
    );
    const up1 = afterBatch.spots.find((s) => s.id === s1)!;
    const up2 = afterBatch.spots.find((s) => s.id === s2)!;
    expect(up1.intensity).toBe(1.45);
    expect(up2.intensity).toBe(1.45);
    expect(up1.zMm).toBe(up2.zMm);

    // Batch delete selected spots
    const countBefore = afterBatch.spots.length;
    useProjectStore.getState().removeCeilingSpotsBatch([s1, s2]);
    const afterDel = resolveCeilingLighting(
      useProjectStore.getState().document.walls,
      useProjectStore.getState().document.ceilingLighting
    );
    expect(afterDel.spots.length).toBe(countBefore - 2);
  });
});
