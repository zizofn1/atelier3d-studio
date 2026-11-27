import { describe, expect, it } from 'vitest';
import type { ModuleInstance, ModuleType, ProjectDocument } from '@/types';
import { DEFAULT_CARPENTRY_PARAMS, DEFAULT_NESTING_CONFIG, createDefaultPricing } from '@/data/defaultPricing';
import { generateModuleOutput } from '@/engine/carpentry';
import {
  analyzeWalls,
  buildRoomPresetWalls,
  computeMultiModuleSpacingMoves,
  computeWall3DTrimMm,
  computeWallPolygon2D,
  getWallInteriorSpanMm,
  snapModulePosition,
} from '@/engine/geometry';
import { cloneAndRepairProjectDocument } from '@/persistence/projectRepair';

function makeMod(partial: Partial<ModuleInstance> & { id: string; type: ModuleType }): ModuleInstance {
  return {
    ref: partial.ref ?? partial.id.toUpperCase(),
    nameFr: partial.nameFr ?? partial.type,
    xMm: 0,
    yMm: 0,
    zMm: 0,
    rotationYRad: 0,
    widthMm: 600,
    heightMm: 860,
    depthMm: 600,
    doorCount: 1,
    drawerCount: 0,
    shelfCount: 1,
    ...partial,
  };
}

describe('Upgrades CAD & Menuiserie (9 améliorations + Dupliquer & Réaligner)', () => {
  it('génère des pièces à cotes nettes intérieures exactes et des jonctions murs sans chevauchement', () => {
    const walls = buildRoomPresetWalls('rect', 3000, 4000, 150, 2500, 'peinture-blanc-casse', 'test');
    expect(walls).toHaveLength(4);

    const metrics = analyzeWalls(walls);
    const north = metrics[0];
    const east = metrics[1];

    expect(getWallInteriorSpanMm(north, metrics).netLengthMm).toBe(3000);
    expect(getWallInteriorSpanMm(east, metrics).netLengthMm).toBe(4000);

    // 3D butt-flush trims: horizontal wall runs through (-75), vertical wall butts (+75) -> zero overlap
    const northTrim = computeWall3DTrimMm(north, metrics);
    const eastTrim = computeWall3DTrimMm(east, metrics);
    expect(northTrim.endTrimMm).toBe(-75);
    expect(eastTrim.startTrimMm).toBe(75);

    // 2D mitered polygon corners match interior [0, 3000] x [0, 4000]
    const northPoly = computeWallPolygon2D(north, metrics);
    expect(Math.round(northPoly[0].x)).toBe(0);
    expect(Math.round(northPoly[0].z)).toBe(0);
    expect(Math.round(northPoly[1].x)).toBe(3000);
    expect(Math.round(northPoly[1].z)).toBe(0);
  });

  it('aimante simultanément sur 2 murs dans un angle et émet les 2 guides', () => {
    const walls = buildRoomPresetWalls('rect', 3000, 4000, 150, 2500, 'peinture-blanc-casse', 'corner');
    // North wall interior face at z = 0, West wall interior face at x = 0.
    // Dragging a 600x600 cabinet near top-left corner (center around x=380, z=360)
    const mod = makeMod({ id: 'm1', type: 'caisson_bas', xMm: 380, zMm: 360, widthMm: 600, depthMm: 600 });
    const snapped = snapModulePosition(mod, walls, []);

    expect(Math.round(snapped.xMm)).toBe(300);
    expect(Math.round(snapped.zMm)).toBe(300);
    expect(snapped.attachedWallId).toBe(walls[0].id);
    expect(snapped.guides.filter((g) => g.kind === 'wall').length).toBeGreaterThanOrEqual(2);
  });

  it('applique un espacement exact entre plusieurs modules sélectionnés', () => {
    const walls = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 'space');
    const northId = walls[0].id;
    const m1 = makeMod({ id: 'm1', type: 'caisson_bas', xMm: 300, zMm: 300, widthMm: 600, attachedWallId: northId });
    const m2 = makeMod({ id: 'm2', type: 'caisson_bas', xMm: 1100, zMm: 300, widthMm: 800, attachedWallId: northId });
    const m3 = makeMod({ id: 'm3', type: 'caisson_bas', xMm: 2200, zMm: 300, widthMm: 600, attachedWallId: northId });

    const movesGap50 = computeMultiModuleSpacingMoves([m1, m2, m3], walls, 50);
    expect(movesGap50).toEqual([
      { id: 'm1', xMm: 300, zMm: 300 },
      { id: 'm2', xMm: 1050, zMm: 300 }, // 600 + 50 + 400
      { id: 'm3', xMm: 1800, zMm: 300 }, // 1450 + 50 + 300
    ]);

    const movesFlush = computeMultiModuleSpacingMoves([m1, m2, m3], walls, 0);
    expect(movesFlush[1].xMm).toBe(1000);
    expect(movesFlush[2].xMm).toBe(1700);
  });

  it('génère des panneaux valides pour les 8 nouveaux caissons d’angle, mixtes et vitrine', () => {
    const types: ModuleType[] = [
      'caisson_angle_l',
      'caisson_angle_aveugle',
      'caisson_angle_pan_coupe',
      'caisson_haut_angle',
      'caisson_bas_tiroir_porte',
      'caisson_bas_2tiroirs_porte',
      'colonne_mixte_tiroirs_portes',
      'meuble_vitrine',
    ];

    for (const type of types) {
      const mod = makeMod({
        id: `mod-${type}`,
        type,
        widthMm: type.includes('angle') ? 900 : 600,
        depthMm: type.includes('angle') && type !== 'caisson_angle_aveugle' ? 900 : 600,
        heightMm: type.includes('colonne') || type === 'meuble_vitrine' ? 2100 : 860,
        doorCount: 2,
        drawerCount: type.includes('tiroir') ? 2 : 0,
        shelfCount: 2,
      });
      const out = generateModuleOutput(mod, DEFAULT_CARPENTRY_PARAMS);
      expect(out.panels.length).toBeGreaterThanOrEqual(4);
      for (const p of out.panels) {
        expect(p.widthMm).toBeGreaterThan(0);
        expect(p.heightMm).toBeGreaterThan(0);
        expect(p.thicknessMm).toBeGreaterThan(0);
      }
      if (type === 'meuble_vitrine') {
        expect(out.panels.some((p) => p.surfaceSlot === 'glass')).toBe(true);
      }
    }
  });

  it('clone et répare le projet najiya sans jamais modifier l’original', () => {
    const original: ProjectDocument = {
      id: 'proj-najiya-orig',
      schemaVersion: 1,
      name: 'najiya',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ceilingHeightMm: 2500,
      floorMaterialId: 'carrelage-gres',
      defaultCarpentry: { ...DEFAULT_CARPENTRY_PARAMS },
      walls: [
        {
          id: 'w1',
          labelFr: 'Mur Nord',
          startMm: [0, 0],
          endMm: [4000, 0],
          thicknessMm: 150,
          heightMm: 2500,
          materialId: 'peinture-blanc-casse',
        },
        {
          id: 'w2',
          labelFr: 'Mur Ouest',
          startMm: [0, 3000],
          endMm: [6, 8], // 10mm disconnected from w1 start [0, 0]
          thicknessMm: 150,
          heightMm: 2500,
          materialId: 'peinture-blanc-casse',
        },
      ],
      openings: [
        {
          id: 'op-orphan',
          wallId: 'missing-wall',
          kind: 'porte',
          offsetFromStartMm: 500,
          widthMm: 900,
          heightMm: 2100,
          sillHeightMm: 0,
        },
      ],
      utilities: [],
      modules: [
        makeMod({
          id: 'm-corner',
          type: 'caisson_bas',
          xMm: 420,
          zMm: 430,
          widthMm: 600,
          depthMm: 600,
          attachedWallId: 'missing-wall',
        }),
      ],
      pricing: createDefaultPricing('MAD'),
      nestingConfig: { ...DEFAULT_NESTING_CONFIG },
    };

    const originalSnapshot = JSON.stringify(original);
    const repaired = cloneAndRepairProjectDocument(original);

    // Original must be 100% untouched
    expect(JSON.stringify(original)).toBe(originalSnapshot);

    expect(repaired.id).not.toBe(original.id);
    expect(repaired.name).toBe('najiya (Copie)');
    // Disconnected wall endpoint [6, 8] snapped to [0, 0]
    expect(repaired.walls[1].endMm).toEqual([0, 0]);
    // Orphan opening dropped
    expect(repaired.openings).toHaveLength(0);
    // Cabinet re-snapped cleanly into the North/West corner
    expect(['w1', 'w2']).toContain(repaired.modules[0].attachedWallId);
    expect(Math.round(repaired.modules[0].xMm)).toBe(375); // 150/2 + 600/2
    expect(Math.round(repaired.modules[0].zMm)).toBe(375); // 150/2 + 600/2
  });
});
