import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NO_RAYCAST, applyCutawayRaycast } from '@/components/viewport3d/drag3dUtils';
import { MODULE_CATALOG_BY_TYPE } from '@/data/defaultPricing';
import { PROPS_CATALOG, PROPS_CATALOG_BY_TYPE } from '@/data/propsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { generateModuleOutput } from '@/engine/carpentry';
import {
  computeAutoUtilitiesForPlacement,
  snapModulePosition,
  snapPropPosition,
} from '@/engine/geometry';
import { getDefaultStyleSettings, getRenderStylePreset } from '@/materials/renderStyles';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';

describe('V2 Upgrades: Cutaway Raycast, Multi-Selection, Salle de Bain, Smart Placement & Auto-Utilities', () => {
  it('désactive strictement le raycast des murs auto-coupés et le rétablit en mur plein', () => {
    const upperWallGroup = new THREE.Group();
    const wallMesh = new THREE.Mesh();
    const windowGlass = new THREE.Mesh();
    upperWallGroup.add(wallMesh, windowGlass);

    applyCutawayRaycast(upperWallGroup, true);
    expect(upperWallGroup.visible).toBe(false);
    expect(wallMesh.raycast).toBe(NO_RAYCAST);
    expect(windowGlass.raycast).toBe(NO_RAYCAST);

    applyCutawayRaycast(upperWallGroup, false);
    expect(upperWallGroup.visible).toBe(true);
    expect(wallMesh.raycast).toBe(THREE.Mesh.prototype.raycast);
    expect(windowGlass.raycast).toBe(THREE.Mesh.prototype.raycast);
  });

  it('applique exactement la configuration par défaut Showroom Luxe demandée', () => {
    const preset = getRenderStylePreset('showroom_luxe');
    const defaults = getDefaultStyleSettings();

    expect(defaults.styleId).toBe('showroom_luxe');
    expect(preset.labelFr).toBe('Showroom Luxe');
    expect(preset.toneMapping).toBe('aces');
    expect(preset.isNightMood).toBe(true);
    expect(preset.defaultLedEnabled).toBe(true);
    expect(defaults).toEqual({
      styleId: 'showroom_luxe',
      exposure: 0.92,
      hdriIntensity: 0.42,
      sunIntensity: 0,
      sunAngleDeg: 108,
      edgeLinesOpacity: 0,
      glossBoost: 0,
    });
  });

  it('gère la sélection multiple (Shift+Click / marquee) et la mise à jour ou suppression en lot en 1 seul Undo', () => {
    const base = createCuisineEnLTemplate();
    useProjectStore.getState().replaceDocument(base, { clearHistory: true });
    const ui = useUIStore.getState();

    const m1 = base.modules[1].id;
    const m2 = base.modules[2].id;
    const m3 = base.modules[3].id;

    ui.selectEntity(m1, 'module');
    ui.toggleSelectEntity(m2, 'module');
    ui.toggleSelectEntity(m3, 'module');
    expect(useUIStore.getState().selectedIds).toEqual([m1, m2, m3]);

    // Toggle m2 off via Shift+Click
    ui.toggleSelectEntity(m2, 'module');
    expect(useUIStore.getState().selectedIds).toEqual([m1, m3]);

    // Batch update facade color + handle style as a single Undo step
    const beforePastCount = useProjectStore.temporal.getState().pastStates.length;
    useProjectStore.getState().updateModulesBatch([m1, m3], {
      overrides: {
        facadeColorOverride: '#2B4C5E',
        handleStyle: 'gorge',
        boardThickness: 19,
      },
    });
    const afterPastCount = useProjectStore.temporal.getState().pastStates.length;
    expect(afterPastCount).toBe(beforePastCount + 1);

    const updated = useProjectStore.getState().document;
    const mod1 = updated.modules.find((m) => m.id === m1)!;
    const mod3 = updated.modules.find((m) => m.id === m3)!;
    expect(mod1.overrides?.facadeColorOverride).toBe('#2B4C5E');
    expect(mod3.overrides?.facadeColorOverride).toBe('#2B4C5E');
    expect(mod1.overrides?.handleStyle).toBe('gorge');
    expect(mod3.overrides?.boardThickness).toBe(19);

    // Single Undo reverts BOTH modules at once
    useProjectStore.temporal.getState().undo();
    const reverted = useProjectStore.getState().document;
    expect(reverted.modules.find((m) => m.id === m1)?.overrides?.facadeColorOverride).toBeUndefined();
    expect(reverted.modules.find((m) => m.id === m3)?.overrides?.facadeColorOverride).toBeUndefined();

    // Batch delete commits as 1 Undo step
    const countBeforeDel = reverted.modules.length;
    useProjectStore.getState().removeModulesBatch([m1, m3]);
    expect(useProjectStore.getState().document.modules.length).toBe(countBeforeDel - 2);
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().document.modules.length).toBe(countBeforeDel);
    ui.clearSelection();
  });

  it('génère les panneaux réels et tags surfaceSlot facade sur les 10 nouveaux modules (Salle de Bain & Cuisine/Entrée)', () => {
    const doc = createCuisineEnLTemplate();
    const newTypes = [
      'meuble_vasque',
      'meuble_double_vasque',
      'armoire_miroir_led',
      'colonne_sdb',
      'meuble_buanderie',
      'caisson_casserolier',
      'caisson_sous_evier',
      'meuble_haut_vitre',
      'colonne_garde_manger',
      'banc_entree',
    ] as const;

    for (const type of newTypes) {
      const spec = MODULE_CATALOG_BY_TYPE[type];
      expect(spec).toBeDefined();
      const out = generateModuleOutput(
        {
          id: `test-${type}`,
          ref: 'M99',
          type,
          nameFr: spec.nameFr,
          xMm: 1000,
          yMm: spec.defaultYMm,
          zMm: 400,
          rotationYRad: 0,
          widthMm: spec.defaultWidthMm,
          heightMm: spec.defaultHeightMm,
          depthMm: spec.defaultDepthMm,
          doorCount: spec.defaultDoorCount,
          drawerCount: spec.defaultDrawerCount,
          shelfCount: spec.defaultShelfCount,
        },
        doc.defaultCarpentry
      );
      expect(out.panels.length).toBeGreaterThanOrEqual(4);
      const facadePanels = out.panels.filter(
        (p) => p.surfaceSlot === 'facade' || p.surfaceSlot === 'glass'
      );
      expect(facadePanels.length, `Façade manquante pour ${type}`).toBeGreaterThanOrEqual(1);
    }
  });

  it('applique les règles de placement intelligent (Four, Évier, Suspension) + contournement Placement libre + alignement mur auto', () => {
    const doc = createCuisineEnLTemplate();

    // 1. Auto wall alignment turns cabinet face toward room interior
    const mod = doc.modules[1];
    const aligned = snapModulePosition(
      { ...mod, xMm: 1800, zMm: 500, rotationYRad: Math.PI }, // initially facing wrong way near North wall
      doc.walls,
      doc.modules
    );
    expect(aligned.attachedWallId).toBe('mur-nord');
    expect(Math.abs(aligned.rotationYRad)).toBeLessThan(0.01); // Facing +Z into room!

    // 2. Smart placement: Sink snaps onto countertop surface (898 mm)
    const sinkSpec = PROPS_CATALOG_BY_TYPE.evier_mitigeur;
    const sinkSnap = snapPropPosition(
      {
        id: 'p1',
        ref: 'E01',
        type: 'evier_mitigeur',
        category: 'electromenager',
        nameFr: sinkSpec.nameFr,
        xMm: 2225,
        yMm: 200,
        zMm: 385,
        rotationYRad: 0,
        widthMm: sinkSpec.defaultWidthMm,
        heightMm: sinkSpec.defaultHeightMm,
        depthMm: sinkSpec.defaultDepthMm,
      },
      doc.walls,
      doc.modules,
      { freePlacement: false, ceilingHeightMm: doc.ceilingHeightMm }
    );
    expect(sinkSnap.snappedConstraint).toBe('countertop');
    expect(sinkSnap.yMm).toBe(898);

    // 3. Free placement override bypasses countertop/ceiling constraints
    const freeSnap = snapPropPosition(
      {
        id: 'p2',
        ref: 'E02',
        type: 'evier_mitigeur',
        category: 'electromenager',
        nameFr: sinkSpec.nameFr,
        xMm: 2225,
        yMm: 200,
        zMm: 385,
        rotationYRad: 0,
        widthMm: sinkSpec.defaultWidthMm,
        heightMm: sinkSpec.defaultHeightMm,
        depthMm: sinkSpec.defaultDepthMm,
      },
      doc.walls,
      doc.modules,
      { freePlacement: true, ceilingHeightMm: doc.ceilingHeightMm }
    );
    expect(freeSnap.snappedConstraint).toBe('free');
    expect(freeSnap.yMm).toBe(200);

    // 4. Built-in Oven snaps into colonne four niche
    const ovenSpec = PROPS_CATALOG_BY_TYPE.four_encastrable;
    const ovenSnap = snapPropPosition(
      {
        id: 'p3',
        ref: 'E03',
        type: 'four_encastrable',
        category: 'electromenager',
        nameFr: ovenSpec.nameFr,
        xMm: 400,
        yMm: 100,
        zMm: 400,
        rotationYRad: 0,
        widthMm: ovenSpec.defaultWidthMm,
        heightMm: ovenSpec.defaultHeightMm,
        depthMm: ovenSpec.defaultDepthMm,
      },
      doc.walls,
      doc.modules,
      { freePlacement: false, ceilingHeightMm: doc.ceilingHeightMm }
    );
    expect(ovenSnap.snappedConstraint).toBe('niche');
    expect(ovenSnap.xMm).toBe(375);

    // 5. Ceiling pendant snaps cleanly under ceiling
    const lampSpec = PROPS_CATALOG_BY_TYPE.suspension_lustre;
    const lampSnap = snapPropPosition(
      {
        id: 'p4',
        ref: 'E04',
        type: 'suspension_lustre',
        category: 'eclairage_deco',
        nameFr: lampSpec.nameFr,
        xMm: 1625,
        yMm: 100,
        zMm: 2050,
        rotationYRad: 0,
        widthMm: lampSpec.defaultWidthMm,
        heightMm: lampSpec.defaultHeightMm,
        depthMm: lampSpec.defaultDepthMm,
      },
      doc.walls,
      doc.modules,
      { freePlacement: false, ceilingHeightMm: 2500 }
    );
    expect(lampSnap.snappedConstraint).toBe('ceiling');
    expect(lampSnap.yMm).toBe(2500 - lampSpec.defaultHeightMm);
  });

  it('crée automatiquement les raccordements techniques (Arrivée d’eau / Prise électrique) et inclut le manifeste PWA', () => {
    const doc = createCuisineEnLTemplate();
    // Clear existing utilities to test fresh auto-creation cleanly
    const cleanDoc = { ...doc, utilities: [] };

    const sinkUtils = computeAutoUtilitiesForPlacement(cleanDoc, {
      kind: 'prop',
      type: 'evier_mitigeur',
      nameFr: 'Évier + Mitigeur',
      xMm: 2000,
      yMm: 898,
      zMm: 380,
      attachedWallId: 'mur-nord',
    });
    expect(sinkUtils.some((u) => u.kind === 'arrivee_eau')).toBe(true);

    const dishwasherUtils = computeAutoUtilitiesForPlacement(cleanDoc, {
      kind: 'prop',
      type: 'lave_vaisselle',
      nameFr: 'Lave-vaisselle',
      xMm: 1500,
      yMm: 0,
      zMm: 380,
      attachedWallId: 'mur-nord',
    });
    expect(dishwasherUtils.some((u) => u.kind === 'arrivee_eau')).toBe(true);
    expect(dishwasherUtils.some((u) => u.kind === 'prise')).toBe(true);

    const vanityUtils = computeAutoUtilitiesForPlacement(cleanDoc, {
      kind: 'module',
      type: 'meuble_vasque',
      nameFr: 'Meuble vasque suspendu',
      xMm: 1800,
      yMm: 320,
      zMm: 315,
      attachedWallId: 'mur-nord',
    });
    expect(vanityUtils.some((u) => u.kind === 'arrivee_eau')).toBe(true);

    const fridgeUtils = computeAutoUtilitiesForPlacement(cleanDoc, {
      kind: 'prop',
      type: 'refrigerateur',
      nameFr: 'Réfrigérateur combiné',
      xMm: 600,
      yMm: 0,
      zMm: 400,
      attachedWallId: 'mur-nord',
    });
    expect(fridgeUtils.some((u) => u.kind === 'prise')).toBe(true);

    // Verify 25 props catalog + offline PWA manifest file
    expect(PROPS_CATALOG).toHaveLength(25);
    const manifestPath = path.resolve(process.cwd(), 'public', 'manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifestJson.display).toBe('standalone');
    expect(manifestJson.lang).toBe('fr');
  });
});
