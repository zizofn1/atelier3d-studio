import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModuleInstance, ProjectDocument } from '@/types';
import { DEFAULT_CARPENTRY_PARAMS, DEFAULT_NESTING_CONFIG, createDefaultPricing } from '@/data/defaultPricing';
import { generateModuleOutput } from '@/engine/carpentry';
import {
  analyzeWalls,
  buildRoomPresetWalls,
  shouldCutawayWallAttachedItem,
} from '@/engine/geometry';
import { buildPlanDrawing2D } from '@/exports/drawing2d';
import { computeStudioRenderConfig } from '@/exports/render3dExport';
import { APP_VERSION, APP_VERSION_BADGE } from '@/utils/appVersion';

function makeMod(partial: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    id: 'm-rc1',
    ref: 'M01',
    type: 'caisson_haut',
    nameFr: 'Caisson haut',
    xMm: 1000,
    yMm: 1450,
    zMm: 300,
    rotationYRad: 0,
    widthMm: 600,
    heightMm: 720,
    depthMm: 350,
    doorCount: 1,
    drawerCount: 0,
    shelfCount: 2,
    ...partial,
  };
}

describe('v1.0.0-rc.1 — Rendu 2K, façade Bois/Vitrée, auto-coupe ciblée, sens porte & najia_copie', () => {
  it('calcule correctement la configuration Rendu Photo 2K (bureau vs mobile/iPad + clamp MSAA)', () => {
    expect(computeStudioRenderConfig(false, 16)).toEqual({
      widthPx: 2560,
      heightPx: 1440,
      shadowMapSize: 4096,
      msaaSamples: 8,
    });
    expect(computeStudioRenderConfig(false, 4)).toEqual({
      widthPx: 2560,
      heightPx: 1440,
      shadowMapSize: 4096,
      msaaSamples: 4,
    });
    expect(computeStudioRenderConfig(true, 16)).toEqual({
      widthPx: 1920,
      heightPx: 1080,
      shadowMapSize: 2048,
      msaaSamples: 8,
    });
  });

  it('bascule la façade Bois plein / Vitrée (cadre + verre) et met à jour la fiche de débit', () => {
    const pleinOut = generateModuleOutput(makeMod({ facadeKind: 'plein' }), DEFAULT_CARPENTRY_PARAMS);
    const pleinDoor = pleinOut.panels.find((p) => p.role === 'porte');
    expect(pleinDoor?.surfaceSlot).toBe('facade');
    expect(pleinDoor?.nameFr).not.toContain('vitré');

    const vitreOut = generateModuleOutput(makeMod({ facadeKind: 'vitre' }), DEFAULT_CARPENTRY_PARAMS);
    const vitreDoor = vitreOut.panels.find((p) => p.role === 'porte');
    expect(vitreDoor?.surfaceSlot).toBe('glass');
    expect(vitreDoor?.nameFr).toContain('cadre vitré');
  });

  it('bascule le sens d’ouverture Gauche / Droite sur meubles mono-porte et portes murales', () => {
    const leftDoor = generateModuleOutput(
      makeMod({ doorCount: 1, hingeSide: 'left' }),
      DEFAULT_CARPENTRY_PARAMS
    ).panels.find((p) => p.role === 'porte');
    const rightDoor = generateModuleOutput(
      makeMod({ doorCount: 1, hingeSide: 'right' }),
      DEFAULT_CARPENTRY_PARAMS
    ).panels.find((p) => p.role === 'porte');

    expect(leftDoor?.animationMeta?.kind).toBe('hinged_left');
    expect(rightDoor?.animationMeta?.kind).toBe('hinged_right');
    expect(rightDoor?.animationGroup).toBe('door_right');
    expect((rightDoor?.animationMeta?.pivotMm?.[0] ?? 0)).toBeGreaterThan(
      leftDoor?.animationMeta?.pivotMm?.[0] ?? 0
    );

    const walls = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 'door');
    const baseDoc: ProjectDocument = {
      id: 'proj-door',
      schemaVersion: 1,
      name: 'Test Porte',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ceilingHeightMm: 2500,
      floorMaterialId: 'carrelage-gres',
      defaultCarpentry: { ...DEFAULT_CARPENTRY_PARAMS },
      walls,
      openings: [
        {
          id: 'op-1',
          wallId: walls[0].id,
          kind: 'porte',
          offsetFromStartMm: 800,
          widthMm: 900,
          heightMm: 2040,
          sillHeightMm: 0,
          hingeSide: 'left',
        },
      ],
      utilities: [],
      modules: [],
      pricing: createDefaultPricing('MAD'),
      nestingConfig: { ...DEFAULT_NESTING_CONFIG },
    };

    const planLeft = buildPlanDrawing2D(baseDoc, 'mm');
    const planRight = buildPlanDrawing2D(
      {
        ...baseDoc,
        openings: [{ ...baseDoc.openings[0], hingeSide: 'right' }],
      },
      'mm'
    );
    const arcLeft = planLeft.paths.find((p) => p.dashed)?.d;
    const arcRight = planRight.paths.find((p) => p.dashed)?.d;
    expect(arcLeft).toBeTruthy();
    expect(arcRight).toBeTruthy();
    expect(arcRight).not.toBe(arcLeft);
  });

  it('applique l’auto-coupe uniquement aux éléments liés à un mur coupé (jamais à un îlot central)', () => {
    const walls = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 'cut');
    const wallMetrics = analyzeWalls(walls);
    // Camera in front of South wall (z = +5.5m) looking toward room center (2.0m, 1.5m) -> South wall (walls[2]) is cut away, North wall (walls[0]) stays visible
    const cameraPosM: [number, number, number] = [2.0, 2.2, 5.5];
    const roomCenterM: [number, number] = [2.0, 1.5];

    // Cabinet attached to cut-away South wall -> hidden
    expect(
      shouldCutawayWallAttachedItem(
        { xMm: 2000, zMm: 2700, depthMm: 600, attachedWallId: walls[2].id },
        wallMetrics,
        cameraPosM,
        roomCenterM
      )
    ).toBe(true);

    // Cabinet attached to visible North wall -> stays visible
    expect(
      shouldCutawayWallAttachedItem(
        { xMm: 2000, zMm: 300, depthMm: 600, attachedWallId: walls[0].id },
        wallMetrics,
        cameraPosM,
        roomCenterM
      )
    ).toBe(false);

    // Freestanding island in middle of room -> NEVER hidden
    expect(
      shouldCutawayWallAttachedItem(
        { xMm: 2000, zMm: 1800, depthMm: 900, isFreestandingOnly: true },
        wallMetrics,
        cameraPosM,
        roomCenterM
      )
    ).toBe(false);

    // Electrical outlet flush against South wall -> hidden when South wall is cut away
    expect(
      shouldCutawayWallAttachedItem(
        { xMm: 2000, zMm: 2990, depthMm: 20, attachedWallId: walls[2].id },
        wallMetrics,
        cameraPosM,
        roomCenterM
      )
    ).toBe(true);
  });

  it('expose la version v1.0.0-rc.1 et conserve najia.atelier3d.json intact face à najia_copie.atelier3d.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'));
    expect(pkg.version).toBe('1.0.0-rc.1');
    expect(APP_VERSION).toBe('1.0.0-rc.1');
    expect(APP_VERSION_BADGE).toBe('v1.0.0-rc.1');

    const origPath = path.resolve(process.cwd(), 'najia.atelier3d.json');
    const copyPath = path.resolve(process.cwd(), 'najia_copie.atelier3d.json');
    expect(fs.existsSync(origPath)).toBe(true);
    expect(fs.existsSync(copyPath)).toBe(true);

    const orig = JSON.parse(fs.readFileSync(origPath, 'utf-8'));
    const copy = JSON.parse(fs.readFileSync(copyPath, 'utf-8'));
    expect(orig.document.name).toBe('najia');
    expect(copy.document.name).toBe('najia (Copie)');
    expect(copy.document.id).not.toBe(orig.document.id);
    const mur5Copy = copy.document.walls.find((w: { id: string }) => w.id === 'mur_701a9e42');
    expect(mur5Copy.startMm).toEqual([1000, 0]);
  });
});
