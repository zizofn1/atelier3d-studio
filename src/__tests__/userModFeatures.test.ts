import { describe, expect, it } from 'vitest';
import type { ModuleInstance, ProjectDocument } from '@/types';
import {
  DEFAULT_CARPENTRY_PARAMS,
  DEFAULT_NESTING_CONFIG,
  createDefaultPricing,
} from '@/data/defaultPricing';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { generateModuleOutput } from '@/engine/carpentry';
import {
  DEFAULT_SPOT_INTENSITY,
  buildRoomPresetWalls,
  computeAutoUtilitiesForPlacement,
  computeModuleFitSolution,
  detectProjectCollisions,
  resolveCeilingLighting,
} from '@/engine/geometry';
import { parseAndValidateProjectJson, serializeProjectToJson } from '@/persistence/jsonSerializer';
import { useProjectStore } from '@/store/useProjectStore';

function makeRectDoc(netW = 3000, netD = 3000): ProjectDocument {
  const walls = buildRoomPresetWalls('rect', netW, netD, 150, 2500, 'peinture-blanc-casse', 'w');
  return {
    id: 'test-doc',
    schemaVersion: 1,
    name: 'Test Room',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ceilingHeightMm: 2500,
    floorMaterialId: 'carrelage-gres',
    defaultCarpentry: { ...DEFAULT_CARPENTRY_PARAMS },
    walls,
    openings: [],
    utilities: [],
    modules: [],
    props: [],
    pricing: createDefaultPricing('MAD'),
    nestingConfig: { ...DEFAULT_NESTING_CONFIG },
  };
}

describe('Modifications utilisateur : Angle mort G/D, Auto-Fit mur, Spots plafond & Synchro auto-réseaux', () => {
  it('1. Caisson d’angle mort/aveugle : bascule panneau fixe et porte entre gauche et droite + validation JSON', () => {
    const baseBlind: ModuleInstance = {
      id: 'mod-blind',
      ref: 'M01',
      type: 'caisson_angle_aveugle',
      nameFr: "Caisson d'angle mort / aveugle",
      xMm: 500,
      yMm: 0,
      zMm: 300,
      rotationYRad: 0,
      widthMm: 1000,
      heightMm: 860,
      depthMm: 600,
      doorCount: 1,
      drawerCount: 0,
      shelfCount: 1,
      blindSide: 'left',
    };

    const outLeft = generateModuleOutput(baseBlind, DEFAULT_CARPENTRY_PARAMS);
    const fixedLeft = outLeft.panels.find((p) => p.nameFr.includes('fixe'))!;
    const doorLeft = outLeft.panels.find((p) => p.role === 'porte' && Boolean(p.animationMeta))!;
    expect(fixedLeft).toBeDefined();
    expect(doorLeft).toBeDefined();
    expect(fixedLeft.positionMm[0]).toBeLessThan(0);
    expect(doorLeft.positionMm[0]).toBeGreaterThan(0);
    expect(doorLeft.animationMeta?.kind).toBe('hinged_right');

    const outRight = generateModuleOutput(
      { ...baseBlind, blindSide: 'right' },
      DEFAULT_CARPENTRY_PARAMS
    );
    const fixedRight = outRight.panels.find((p) => p.nameFr.includes('fixe'))!;
    const doorRight = outRight.panels.find((p) => p.role === 'porte' && Boolean(p.animationMeta))!;
    expect(fixedRight.positionMm[0]).toBeGreaterThan(0);
    expect(doorRight.positionMm[0]).toBeLessThan(0);
    expect(doorRight.animationMeta?.kind).toBe('hinged_left');

    // Explicit hingeSide override works in both directions
    const outRightExplicitHinge = generateModuleOutput(
      { ...baseBlind, blindSide: 'right', hingeSide: 'right' },
      DEFAULT_CARPENTRY_PARAMS
    );
    const doorExplicit = outRightExplicitHinge.panels.find(
      (p) => p.role === 'porte' && Boolean(p.animationMeta)
    )!;
    expect(doorExplicit.animationMeta?.kind).toBe('hinged_right');

    // JSON round-trip preserves blindSide
    const doc = makeRectDoc();
    doc.modules = [{ ...baseBlind, blindSide: 'right' }];
    const parsed = parseAndValidateProjectJson(serializeProjectToJson(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.modules[0].blindSide).toBe('right');
    }
  });

  it('2. Auto-Fit mur : ajuste la largeur d’un placard collé à un caisson et qui traverse le mur sans décoller du voisin', () => {
    // Net interior room is x in [0, 3000], z in [0, 3000]
    const doc = makeRectDoc(3000, 3000);
    const northWallId = doc.walls[0].id;

    // M1 spans [0, 2400], M2 (800 mm) is snapped flush to M1 -> spans [2400, 3200], poking 200 mm into East wall!
    doc.modules = [
      {
        id: 'm1',
        ref: 'M01',
        type: 'caisson_bas',
        nameFr: 'Caisson voisin',
        xMm: 1200,
        yMm: 0,
        zMm: 300,
        rotationYRad: 0,
        widthMm: 2400,
        heightMm: 860,
        depthMm: 600,
        attachedWallId: northWallId,
        doorCount: 2,
        drawerCount: 0,
        shelfCount: 1,
      },
      {
        id: 'm2',
        ref: 'M02',
        type: 'caisson_bas',
        nameFr: 'Placard trop long',
        xMm: 2800,
        yMm: 0,
        zMm: 300,
        rotationYRad: 0,
        widthMm: 800,
        heightMm: 860,
        depthMm: 600,
        attachedWallId: northWallId,
        doorCount: 2,
        drawerCount: 0,
        shelfCount: 1,
      },
    ];

    const beforeCollisions = detectProjectCollisions(doc);
    expect(beforeCollisions.some((c) => c.moduleId === 'm2')).toBe(true);

    const solution = computeModuleFitSolution(doc, 'm2');
    expect(solution).not.toBeNull();
    expect(solution!.changedDimensions).toContain('width');
    expect(solution!.patch.widthMm).toBe(600);
    // Must keep left edge at x = 2400 (flush with M1) and right edge at x = 3000 (flush with East wall)
    expect(solution!.patch.xMm).toBe(2700);
    expect(solution!.patch.zMm).toBe(300);

    const fixedDoc: ProjectDocument = {
      ...doc,
      modules: doc.modules.map((m) => (m.id === 'm2' ? { ...m, ...solution!.patch } : m)),
    };
    expect(detectProjectCollisions(fixedDoc)).toHaveLength(0);
  });

  it('2b. Auto-Fit : gère aussi un dépassement mur gauche et un dépassement hauteur sous plafond', () => {
    const doc = makeRectDoc(3000, 3000);
    doc.modules = [
      {
        id: 'm-tall-left',
        ref: 'M03',
        type: 'colonne',
        nameFr: 'Colonne trop haute et débordant à gauche',
        xMm: 200, // width 600 -> spans [-100, 500], pokes 100 mm into West wall at x=0
        yMm: 0,
        zMm: 300,
        rotationYRad: 0,
        widthMm: 600,
        heightMm: 2700, // ceiling is 2500 -> pokes 200 mm through ceiling
        depthMm: 600,
        doorCount: 2,
        drawerCount: 0,
        shelfCount: 3,
      },
    ];

    const sol = computeModuleFitSolution(doc, 'm-tall-left');
    expect(sol).not.toBeNull();
    expect(sol!.patch.widthMm).toBe(500);
    expect(sol!.patch.xMm).toBe(250); // right edge preserved at x=500, left edge flush at x=0
    expect(sol!.patch.heightMm).toBe(2500);

    const fixedDoc: ProjectDocument = {
      ...doc,
      modules: [{ ...doc.modules[0], ...sol!.patch }],
    };
    expect(detectProjectCollisions(fixedDoc)).toHaveLength(0);
  });

  it('3. Spots plafond : intensité adoucie par défaut, réglages intensité/emplacements et sérialisation JSON', () => {
    const doc = makeRectDoc(4000, 3200);
    useProjectStore.getState().replaceDocument(doc, { clearHistory: true });

    const initial = resolveCeilingLighting(doc.walls, doc.ceilingLighting);
    expect(initial.spotIntensity).toBe(DEFAULT_SPOT_INTENSITY);
    expect(initial.spotIntensity).toBeLessThan(1); // Softer than harsh full 100%
    expect(initial.spots).toHaveLength(4);
    expect(initial.spotsEnabled).toBe(true);

    // Adjust intensity & apply center preset
    useProjectStore.getState().updateCeilingLighting({ spotIntensity: 0.35 });
    expect(useProjectStore.getState().document.ceilingLighting?.spotIntensity).toBe(0.35);

    useProjectStore.getState().applyCeilingSpotPreset('center_1');
    expect(useProjectStore.getState().document.ceilingLighting?.spots).toHaveLength(1);

    // Add a custom spot and reposition it
    const newSpotId = useProjectStore.getState().addCeilingSpot({ xMm: 1200, zMm: 900 });
    expect(useProjectStore.getState().document.ceilingLighting?.spots).toHaveLength(2);

    useProjectStore.getState().updateCeilingSpot(newSpotId, { xMm: 1500, zMm: 1100, intensity: 0.8 });
    const movedSpot = useProjectStore
      .getState()
      .document.ceilingLighting?.spots?.find((s) => s.id === newSpotId);
    expect(movedSpot?.xMm).toBe(1500);
    expect(movedSpot?.zMm).toBe(1100);
    expect(movedSpot?.intensity).toBe(0.8);

    // JSON round-trip preserves ceilingLighting
    const saved = useProjectStore.getState().document;
    const parsed = parseAndValidateProjectJson(serializeProjectToJson(saved));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.ceilingLighting?.spotIntensity).toBe(0.35);
      expect(parsed.document.ceilingLighting?.spots).toHaveLength(2);
    }

    // Remove spot
    useProjectStore.getState().removeCeilingSpot(newSpotId);
    expect(useProjectStore.getState().document.ceilingLighting?.spots).toHaveLength(1);
  });

  it('4. Synchro auto-réseaux : déplacer ou supprimer un évier / électro met à jour automatiquement sa prise et son arrivée d’eau', () => {
    const base = makeRectDoc(4000, 3200);
    const northWallId = base.walls[0].id;
    const eastWallId = base.walls[1].id;
    useProjectStore.getState().replaceDocument(base, { clearHistory: true });

    // Place sink on North wall -> auto-creates linked arrivee_eau
    const sinkAuto = computeAutoUtilitiesForPlacement(useProjectStore.getState().document, {
      kind: 'prop',
      type: 'evier_mitigeur',
      nameFr: 'Évier + Mitigeur',
      xMm: 1200,
      yMm: 898,
      zMm: 300,
      attachedWallId: northWallId,
    });
    const sinkId = useProjectStore.getState().addPropWithUtilities(
      {
        type: 'evier_mitigeur',
        category: 'electromenager',
        nameFr: 'Évier + Mitigeur',
        xMm: 1200,
        yMm: 898,
        zMm: 300,
        rotationYRad: 0,
        attachedWallId: northWallId,
        widthMm: 800,
        heightMm: 340,
        depthMm: 500,
      },
      sinkAuto
    );

    const waterBefore = useProjectStore
      .getState()
      .document.utilities.find((u) => u.kind === 'arrivee_eau')!;
    expect(waterBefore).toBeDefined();
    expect(waterBefore.linkedEntityId).toBe(sinkId);
    expect(waterBefore.xMm).toBe(1200);

    // Move sink along North wall to x = 2600 -> arrivee_eau must follow automatically in 1 Undo step!
    const pastBeforeMove = useProjectStore.temporal.getState().pastStates.length;
    useProjectStore.getState().updateProp(sinkId, { xMm: 2600 });
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBeforeMove + 1);

    const waterAfter = useProjectStore
      .getState()
      .document.utilities.find((u) => u.id === waterBefore.id)!;
    expect(waterAfter.xMm).toBe(2600);
    expect(waterAfter.wallId).toBe(northWallId);

    // Move sink to East wall -> arrivee_eau must transfer to East wall automatically
    useProjectStore.getState().updateProp(sinkId, {
      xMm: 3700,
      zMm: 1600,
      attachedWallId: eastWallId,
    });
    const waterOnEast = useProjectStore
      .getState()
      .document.utilities.find((u) => u.id === waterBefore.id)!;
    expect(waterOnEast.wallId).toBe(eastWallId);
    expect(waterOnEast.zMm).toBe(1600);

    // Place a manual utility -> must NOT be removed when sink is deleted
    const manualId = useProjectStore.getState().addUtility({
      wallId: northWallId,
      kind: 'prise',
      labelFr: 'Prise électrique',
      xMm: 500,
      yMm: 1100,
      zMm: 15,
      widthMm: 80,
      depthMm: 20,
      heightMm: 80,
    });

    // Deleting sink removes its linked arrivee_eau but keeps manual utility
    useProjectStore.getState().removeProp(sinkId);
    const utilsAfterDelete = useProjectStore.getState().document.utilities;
    expect(utilsAfterDelete.some((u) => u.id === waterBefore.id)).toBe(false);
    expect(utilsAfterDelete.some((u) => u.id === manualId)).toBe(true);
  });

  it('4b. Synchro auto-réseaux (legacy) : adopte et déplace aussi les prises/arrivées d’eau des anciens projets sans linkedEntityId', () => {
    const doc = createCuisineEnLTemplate();
    const northWallId = doc.walls[0].id;
    const legacyDoc: ProjectDocument = {
      ...doc,
      props: [
        {
          id: 'prop-legacy-hob',
          ref: 'E01',
          type: 'plaque_cuisson',
          category: 'electromenager',
          nameFr: 'Plaque induction 4 feux',
          xMm: 1500,
          yMm: 898,
          zMm: 350,
          rotationYRad: 0,
          attachedWallId: northWallId,
          widthMm: 600,
          heightMm: 45,
          depthMm: 520,
        },
      ],
      utilities: [
        {
          id: 'util-legacy-hob',
          wallId: northWallId,
          kind: 'prise',
          labelFr: 'Prise électrique (Plaque induction 4 feux)',
          // Note: NO linkedEntityId (saved from older app version)
          xMm: 1500,
          yMm: 550,
          zMm: 90,
          widthMm: 80,
          depthMm: 20,
          heightMm: 80,
        },
      ],
    };

    useProjectStore.getState().replaceDocument(legacyDoc, { clearHistory: true });
    useProjectStore.getState().updateProp('prop-legacy-hob', { xMm: 2450 });

    const syncedUtil = useProjectStore
      .getState()
      .document.utilities.find((u) => u.id === 'util-legacy-hob')!;
    expect(syncedUtil.xMm).toBe(2450);
    expect(syncedUtil.linkedEntityId).toBe('prop-legacy-hob');
    expect(syncedUtil.linkedEntityKind).toBe('prop');
  });
});
