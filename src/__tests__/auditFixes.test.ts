import { describe, expect, it } from 'vitest';
import { DEFAULT_NESTING_CONFIG } from '@/data/defaultPricing';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { generateModuleOutput } from '@/engine/carpentry';
import { computeDevisSummary, resolveMaterialPricePerM2 } from '@/engine/devis/calculator';
import { buildCutlist, cutlistToNestingPieces } from '@/engine/devis/cutlist';
import { runGuillotineNesting } from '@/engine/nesting/guillotine';
import { verifyNestingResult } from '@/engine/nesting/verifier';
import { parseAndValidateProjectJson, serializeProjectToJson } from '@/persistence/jsonSerializer';
import { useProjectStore } from '@/store/useProjectStore';
import { flushContinuousEdit, runContinuousEdit } from '@/utils/historyBatch';
import type { ModuleInstance, NestingConfig, NestingPieceInput } from '@/types';

describe('Correctifs Audit Packs 1–3 (C1, C2, C3, C5, C8)', () => {
  it('C1: pivote les chants (edges) à 90° quand une pièce est tournée en calepinage 2D et valide via verifyNestingResult', () => {
    const pieces: NestingPieceInput[] = [
      {
        id: 'p_rot',
        moduleRef: 'M01',
        partNameFr: 'Montant tourné',
        materialId: 'mela_blanc',
        thicknessMm: 18,
        // 1900 x 800 on a 1000 x 2000 sheet forces a 90° rotation
        widthMm: 1900,
        heightMm: 800,
        grain: 'none',
        edges: { top: '2', bottom: '0.4', left: 'none', right: '2' },
      },
    ];

    const config: NestingConfig = {
      ...DEFAULT_NESTING_CONFIG,
      sheet: {
        ...DEFAULT_NESTING_CONFIG.sheet,
        widthMm: 1000,
        heightMm: 2000,
      },
      respectGrain: true,
    };

    const result = runGuillotineNesting(pieces, config);
    expect(result.unplacedCount).toBe(0);
    expect(result.groups).toHaveLength(1);
    const placed = result.groups[0].sheets[0].placements[0];
    expect(placed.rotated).toBe(true);
    expect(placed.widthMm).toBe(800);
    expect(placed.heightMm).toBe(1900);
    // Original top/bottom become left/right; original left/right become top/bottom
    expect(placed.edges).toEqual({
      top: 'none',
      bottom: '2',
      left: '2',
      right: '0.4',
    });

    const verification = verifyNestingResult(result, config, pieces);
    expect(verification.ok).toBe(true);
    expect(verification.errorsFr).toHaveLength(0);

    // Corrupted unrotated edges must be flagged by verifier
    const corruptedResult = structuredClone(result);
    corruptedResult.groups[0].sheets[0].placements[0].edges = {
      top: '2',
      bottom: '0.4',
      left: 'none',
      right: '2',
    };
    const badCheck = verifyNestingResult(corruptedResult, config, pieces);
    expect(badCheck.ok).toBe(false);
    expect(badCheck.errorsFr.some((e) => e.includes('Orientation des chants incohérente'))).toBe(true);
  });

  it('C2: facture une pièce hors-format (non placée) à surface nette × 1,15 et remonte unplacedPiecesCount', () => {
    const doc = createCuisineEnLTemplate();
    const oversizedMod: ModuleInstance = {
      id: 'mod_oversized_pt',
      ref: 'PT01',
      type: 'plan_de_travail',
      nameFr: 'Plan de travail XXL',
      xMm: 1600,
      yMm: 850,
      zMm: 400,
      rotationYRad: 0,
      widthMm: 3200,
      heightMm: 38,
      depthMm: 650,
      doorCount: 0,
      drawerCount: 0,
      shelfCount: 0,
    };
    doc.modules = [oversizedMod];

    const cutlist = buildCutlist(doc);
    const pieces = cutlistToNestingPieces(cutlist);
    const nesting = runGuillotineNesting(pieces, doc.nestingConfig ?? DEFAULT_NESTING_CONFIG);

    expect(nesting.unplacedCount).toBe(1);
    expect(nesting.groups[0].sheets).toHaveLength(0);
    expect(nesting.groups[0].unplacedPieceIds).toHaveLength(1);

    const devis = computeDevisSummary(doc, nesting, cutlist);
    expect(devis.unplacedPiecesCount).toBe(1);
    expect(devis.materialLines).toHaveLength(1);

    const line = devis.materialLines[0];
    expect(line.unplacedCount).toBe(1);
    expect(line.sheetsCount).toBe(0);
    const expectedNetM2 = (3200 * 650) / 1_000_000;
    const expectedBillableM2 = expectedNetM2 * 1.15;
    expect(line.unplacedBillableAreaM2).toBeCloseTo(expectedBillableM2, 2);

    const unitPrice = resolveMaterialPricePerM2(doc, line.materialId);
    expect(line.totalPrice).toBeCloseTo(expectedBillableM2 * unitPrice, 1);
    expect(devis.materialsSubtotal).toBeGreaterThan(0);
    expect(devis.totalTTC).toBeGreaterThan(0);
  });

  it('C3: applyRoomPresetWalls et removeWall nettoient attachedWallId/wallId pour un aller-retour JSON valide', () => {
    const baseDoc = createCuisineEnLTemplate();
    useProjectStore.getState().replaceDocument(baseDoc, { clearHistory: true });

    const firstWallId = useProjectStore.getState().document.walls[0].id;
    useProjectStore.getState().addProp({
      type: 'tele_ecran_plat',
      category: 'salon_multimedia',
      nameFr: 'TV murale',
      xMm: 1000,
      yMm: 1200,
      zMm: 100,
      rotationYRad: 0,
      widthMm: 1200,
      heightMm: 700,
      depthMm: 60,
      attachedWallId: firstWallId,
    });

    // 1. Delete single wall -> dangling refs must be cleared
    useProjectStore.getState().removeWall(firstWallId);
    const afterRemove = useProjectStore.getState().document;
    expect(afterRemove.modules.some((m) => m.attachedWallId === firstWallId)).toBe(false);
    expect(afterRemove.utilities.some((u) => u.wallId === firstWallId)).toBe(false);
    expect((afterRemove.props ?? []).some((p) => p.attachedWallId === firstWallId)).toBe(false);

    const json1 = serializeProjectToJson(afterRemove);
    const parsed1 = parseAndValidateProjectJson(json1);
    expect(parsed1.ok).toBe(true);

    // 2. Replace all walls via room preset -> all old wall refs cleaned
    useProjectStore.getState().applyRoomPresetWalls([
      {
        id: 'preset_w1',
        startMm: [0, 0],
        endMm: [4000, 0],
        heightMm: 2600,
        thicknessMm: 150,
        materialId: 'peinture-blanc-casse',
      },
      {
        id: 'preset_w2',
        startMm: [4000, 0],
        endMm: [4000, 3500],
        heightMm: 2600,
        thicknessMm: 150,
        materialId: 'peinture-blanc-casse',
      },
      {
        id: 'preset_w3',
        startMm: [4000, 3500],
        endMm: [0, 3500],
        heightMm: 2600,
        thicknessMm: 150,
        materialId: 'peinture-blanc-casse',
      },
      {
        id: 'preset_w4',
        startMm: [0, 3500],
        endMm: [0, 0],
        heightMm: 2600,
        thicknessMm: 150,
        materialId: 'peinture-blanc-casse',
      },
    ]);

    const afterPreset = useProjectStore.getState().document;
    expect(afterPreset.openings).toHaveLength(0);
    expect(afterPreset.modules.every((m) => m.attachedWallId === undefined)).toBe(true);
    expect(afterPreset.utilities.every((u) => u.wallId === undefined)).toBe(true);
    expect((afterPreset.props ?? []).every((p) => p.attachedWallId === undefined)).toBe(true);

    const json2 = serializeProjectToJson(afterPreset);
    const parsed2 = parseAndValidateProjectJson(json2);
    expect(parsed2.ok).toBe(true);
  });

  it('C5: addModuleWithUtilities et runContinuousEdit consomment exactement 1 seule étape Undo', () => {
    const baseDoc = createCuisineEnLTemplate();
    useProjectStore.getState().replaceDocument(baseDoc, { clearHistory: true });
    useProjectStore.temporal.getState().clear();

    const initialModCount = useProjectStore.getState().document.modules.length;
    const initialUtilCount = useProjectStore.getState().document.utilities.length;

    // Atomic placement of module + utility = 1 single Undo step
    useProjectStore.getState().addModuleWithUtilities(
      {
        type: 'colonne',
        nameFr: 'Colonne Four',
        xMm: 1200,
        yMm: 0,
        zMm: 400,
        rotationYRad: 0,
        widthMm: 600,
        heightMm: 2150,
        depthMm: 580,
        doorCount: 2,
        drawerCount: 0,
        shelfCount: 3,
      },
      [
        {
          kind: 'prise',
          xMm: 1200,
          yMm: 400,
          zMm: 100,
          widthMm: 85,
          heightMm: 85,
          depthMm: 20,
          labelFr: 'Prise four',
        },
      ]
    );

    expect(useProjectStore.temporal.getState().pastStates.length).toBe(1);
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().document.modules.length).toBe(initialModCount);
    expect(useProjectStore.getState().document.utilities.length).toBe(initialUtilCount);

    // Continuous color edits (25 rapid ticks) = 1 single Undo step
    useProjectStore.temporal.getState().clear();
    const initialWallColor = useProjectStore.getState().document.wallColor;
    for (let i = 0; i < 25; i++) {
      const hex = `#${(0x101010 + i * 0x050505).toString(16).padStart(6, '0')}`;
      runContinuousEdit(() => {
        useProjectStore.getState().updateRoomSurfaces({ wallColor: hex });
      });
    }
    flushContinuousEdit();

    expect(useProjectStore.temporal.getState().pastStates.length).toBe(1);
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().document.wallColor).toBe(initialWallColor);
    useProjectStore.temporal.getState().redo();
    expect(useProjectStore.getState().document.wallColor).not.toBe(initialWallColor);
  });

  it('C8: tringle en ml réels, push-open armoire miroir LED, regroupement débit (qty > 1) et déduction épaisseur chants', () => {
    const doc = createCuisineEnLTemplate();
    const defaults = { ...doc.defaultCarpentry, boardThickness: 18 as const };

    // 1. Dressing penderie 1200 mm -> innerW = 1200 - 36 = 1164 mm -> 1.16 ml
    const penderie: ModuleInstance = {
      id: 'mod_pend',
      ref: 'D01',
      type: 'dressing_penderie',
      nameFr: 'Penderie 1200',
      xMm: 800,
      yMm: 0,
      zMm: 400,
      rotationYRad: 0,
      widthMm: 1200,
      heightMm: 2200,
      depthMm: 580,
      doorCount: 0,
      drawerCount: 0,
      shelfCount: 3,
    };
    const pendOut = generateModuleOutput(penderie, defaults);
    const tringle = pendOut.hardware.find((h) => h.kind === 'tringle');
    expect(tringle).toBeDefined();
    expect(tringle?.quantity).toBeCloseTo(1.16, 2);

    // 2. Armoire miroir LED -> includes push_open hardware
    const miroir: ModuleInstance = {
      id: 'mod_mir',
      ref: 'S01',
      type: 'armoire_miroir_led',
      nameFr: 'Armoire miroir LED',
      xMm: 2000,
      yMm: 1350,
      zMm: 200,
      rotationYRad: 0,
      widthMm: 800,
      heightMm: 700,
      depthMm: 180,
      doorCount: 2,
      drawerCount: 0,
      shelfCount: 2,
    };
    const mirOut = generateModuleOutput(miroir, defaults);
    const pushHw = mirOut.hardware.find((h) => h.kind === 'push_open');
    expect(pushHw).toBeDefined();
    expect(pushHw?.quantity).toBe(2);

    // 3. Cutlist grouping: 3 identical shelves in penderie merge into 1 line with quantity >= 3,
    //    while cutlistToNestingPieces expands back to exact total panel count.
    doc.modules = [penderie];
    const groupedCutlist = buildCutlist(doc);
    const shelfLine = groupedCutlist.find((c) => c.partNameFr.toLowerCase().includes('étagère'));
    expect(shelfLine).toBeDefined();
    expect(shelfLine?.quantity).toBe(3);

    const expandedPieces = cutlistToNestingPieces(groupedCutlist);
    expect(expandedPieces.length).toBe(pendOut.panels.length);

    // 4. Optional edge-banding thickness deduction on 4-sided 2mm door (-4 mm on length & width)
    const basMod: ModuleInstance = {
      id: 'mod_bas_deduct',
      ref: 'M01',
      type: 'caisson_bas',
      nameFr: 'Caisson bas',
      xMm: 600,
      yMm: 0,
      zMm: 400,
      rotationYRad: 0,
      widthMm: 600,
      heightMm: 850,
      depthMm: 580,
      doorCount: 1,
      drawerCount: 0,
      shelfCount: 1,
    };
    doc.modules = [basMod];
    doc.defaultCarpentry = { ...defaults, deductEdgeBandingThickness: false };
    const doorRaw = buildCutlist(doc).find((c) => c.partNameFr.toLowerCase().includes('porte'))!;

    doc.defaultCarpentry = { ...defaults, deductEdgeBandingThickness: true };
    const doorDeducted = buildCutlist(doc).find((c) => c.partNameFr.toLowerCase().includes('porte'))!;

    expect(doorDeducted.lengthMm).toBeCloseTo(doorRaw.lengthMm - 4, 2);
    expect(doorDeducted.widthMm).toBeCloseTo(doorRaw.widthMm - 4, 2);
  });
});
