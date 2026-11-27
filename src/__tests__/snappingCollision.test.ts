import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModuleInstance, WallSegment } from '@/types';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import {
  analyzeWalls,
  clampCameraInsideRoom,
  clampTargetInsideRoom,
  computeCameraZones,
  detectProjectCollisions,
  extractPrimaryRoomPolygon,
  findInteriorSpawnPosition,
  isPointInPolygonXZ,
  normalToRotationYRad,
  projectModuleToWall,
  projectPointToWall,
  shouldCutawayWall,
  snapModulePosition,
} from '@/engine/geometry';
import { MODULE_CATALOG_BY_TYPE } from '@/data/defaultPricing';
import {
  selectActiveWall,
  selectCollisionModuleIds,
  selectProjectCollisions,
  selectProjectCounts,
  selectProjectHardware,
  selectProjectPanels,
  selectSelectedEntity,
} from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';

function makeMod(overrides: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    id: 'm-test',
    ref: 'M90',
    type: 'caisson_bas',
    nameFr: 'Caisson bas test',
    xMm: 1000,
    yMm: 0,
    zMm: 455,
    rotationYRad: 0,
    widthMm: 800,
    heightMm: 860,
    depthMm: 600,
    doorCount: 2,
    drawerCount: 0,
    shelfCount: 1,
    hasPlinth: true,
    ...overrides,
  };
}

describe('Géométrie, Magnétisme & Détection de Collisions (src/engine/geometry)', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceDocument(createCuisineEnLTemplate());
  });

  it('calcule les normales intérieures correctement pour sens horaire, anti-horaire, mixte et chaînes L/U', () => {
    const cuisine = createCuisineEnLTemplate();
    const cw = analyzeWalls(cuisine.walls);
    expect(cw).toHaveLength(4);
    expect(cw[0].inwardNormal).toEqual({ x: 0, z: 1 });   // mur-nord
    expect(cw[1].inwardNormal).toEqual({ x: -1, z: 0 });  // mur-est
    expect(cw[2].inwardNormal).toEqual({ x: 0, z: -1 });  // mur-sud
    expect(cw[3].inwardNormal).toEqual({ x: 1, z: 0 });   // mur-ouest

    expect(normalToRotationYRad(cw[0].inwardNormal)).toBe(0);
    expect(normalToRotationYRad(cw[1].inwardNormal)).toBeCloseTo(-Math.PI / 2, 6);
    expect(normalToRotationYRad(cw[3].inwardNormal)).toBeCloseTo(Math.PI / 2, 6);

    // Reversed CCW walls -> inward normals must still point inside!
    const ccwWalls: WallSegment[] = [...cuisine.walls]
      .reverse()
      .map((w) => ({ ...w, startMm: w.endMm, endMm: w.startMm }));
    const ccw = analyzeWalls(ccwWalls);
    const ccwNord = ccw.find((m) => m.wall.id === 'mur-nord')!;
    const ccwEst = ccw.find((m) => m.wall.id === 'mur-est')!;
    expect(ccwNord.inwardNormal).toEqual({ x: 0, z: 1 });
    expect(ccwEst.inwardNormal).toEqual({ x: -1, z: 0 });

    // Mixed orientation walls
    const mixedWalls: WallSegment[] = cuisine.walls.map((w, idx) =>
      idx % 2 === 1 ? { ...w, startMm: w.endMm, endMm: w.startMm } : w
    );
    const mixed = analyzeWalls(mixedWalls);
    expect(mixed[0].inwardNormal).toEqual({ x: 0, z: 1 });
    expect(mixed[1].inwardNormal).toEqual({ x: -1, z: 0 });

    // Open L-shape (2 walls)
    const openL = analyzeWalls(cuisine.walls.slice(0, 2));
    expect(openL[0].inwardNormal).toEqual({ x: 0, z: 1 });
    expect(openL[1].inwardNormal).toEqual({ x: -1, z: 0 });

    // Open U-shape (3 walls)
    const openU = analyzeWalls(cuisine.walls.slice(0, 3));
    expect(openU[0].inwardNormal).toEqual({ x: 0, z: 1 });
    expect(openU[1].inwardNormal).toEqual({ x: -1, z: 0 });
    expect(openU[2].inwardNormal).toEqual({ x: 0, z: -1 });

    // 45° diagonal wall projection
    const diag: WallSegment = {
      id: 'diag',
      startMm: [0, 0],
      endMm: [1000, 1000],
      thicknessMm: 100,
      heightMm: 2500,
      materialId: 'peinture-blanc-casse',
    };
    const [dm] = analyzeWalls([diag]);
    expect(dm.lengthMm).toBeCloseTo(Math.SQRT2 * 1000, 3);
    const ptProj = projectPointToWall(dm, { x: 500, z: 500 });
    expect(ptProj.distanceToSegmentMm).toBeCloseTo(0, 3);
    const modProj = projectModuleToWall(
      dm,
      makeMod({ xMm: 500, zMm: 500, widthMm: 400, depthMm: 400, rotationYRad: 0 })
    );
    expect(modProj.uMaxMm).toBeGreaterThan(modProj.uMinMm);
  });

  it('aimante au mur (<= 150 mm), dans les angles, sur les autres caissons (<= 80 mm) et en vertical (<= 60 mm)', () => {
    const cuisine = createCuisineEnLTemplate();

    // 1. Wall snap within 150 mm (600mm cabinet on 150mm wall -> target z = 375; placed at z=455 -> 80mm gap)
    const nearNorth = makeMod({
      xMm: 1500,
      zMm: 455,
      yMm: 25,
      rotationYRad: 0.25,
    });
    const res1 = snapModulePosition(nearNorth, cuisine.walls, []);
    expect(res1.attachedWallId).toBe('mur-nord');
    expect(res1.zMm).toBeCloseTo(375, 2);
    expect(res1.rotationYRad).toBe(0);
    expect(res1.yMm).toBe(0); // vertical floor snap within 60 mm
    expect(res1.guides.some((g) => g.kind === 'wall')).toBe(true);
    expect(res1.guides.some((g) => g.kind === 'vertical')).toBe(true);

    // 2. Beyond 150 mm -> does not attach to wall
    const farFromWall = makeMod({ xMm: 1500, zMm: 800, yMm: 0 });
    const resFar = snapModulePosition(farFromWall, cuisine.walls, []);
    expect(resFar.attachedWallId).toBeUndefined();

    // 3. Corner snap near [0, 0]
    const nearCorner = makeMod({ xMm: 420, zMm: 400, widthMm: 600, depthMm: 600 });
    const resCorner = snapModulePosition(nearCorner, cuisine.walls, []);
    expect(resCorner.xMm).toBeCloseTo(375, 2); // 75 + 300
    expect(resCorner.zMm).toBeCloseTo(375, 2);

    // 4. ilot_central never snaps to walls
    const island = makeMod({
      type: 'ilot_central',
      xMm: 1000,
      zMm: 400,
      widthMm: 1400,
      depthMm: 850,
    });
    const resIsland = snapModulePosition(island, cuisine.walls, []);
    expect(resIsland.attachedWallId).toBeUndefined();

    // 5. Cabinet-to-cabinet flush snap along wall (M02 ends at x=1475 -> new 600mm cabinet near x=1820 snaps to x=1775)
    const m02 = cuisine.modules.find((m) => m.ref === 'M02')!;
    const neighbor = makeMod({
      id: 'new-neighbor',
      xMm: 1820,
      zMm: 390,
      widthMm: 600,
      depthMm: 600,
    });
    const resFlush = snapModulePosition(neighbor, cuisine.walls, [m02]);
    expect(resFlush.xMm).toBeCloseTo(1775, 2); // 1475 + 300 = 1775 (0 mm gap)
    expect(resFlush.guides.some((g) => g.kind === 'cabinet_flush')).toBe(true);

    // 6. Upper cabinet aligns left edge with lower cabinet without vertical collision
    const upper = makeMod({
      id: 'new-upper',
      type: 'caisson_haut',
      xMm: 1095,
      yMm: 1440,
      zMm: 270,
      widthMm: 800,
      heightMm: 700,
      depthMm: 350,
    });
    const resUpper = snapModulePosition(upper, cuisine.walls, [m02]);
    expect(resUpper.xMm).toBeCloseTo(1075, 2);
    expect(resUpper.yMm).toBe(1470);
    expect(resUpper.zMm).toBeCloseTo(250, 2);

    // 7. Countertop snaps onto base cabinet & backsplash onto countertop
    const worktop = makeMod({
      id: 'new-wt',
      type: 'plan_de_travail',
      xMm: 1075,
      yMm: 830,
      zMm: 400,
      widthMm: 800,
      heightMm: 38,
      depthMm: 620,
    });
    const resWt = snapModulePosition(worktop, cuisine.walls, [m02]);
    expect(resWt.yMm).toBe(860);

    const cred = makeMod({
      id: 'new-cred',
      type: 'credence',
      xMm: 1075,
      yMm: 920,
      zMm: 100,
      widthMm: 800,
      heightMm: 500,
      depthMm: 16,
    });
    const resCred = snapModulePosition(cred, cuisine.walls, [
      { ...worktop, yMm: 860, zMm: 385 },
    ]);
    expect(resCred.yMm).toBe(898);

    // 8. Plinthe recesses 45 mm under base cabinet front
    const plinthe = makeMod({
      id: 'new-plinthe',
      type: 'plinthe',
      xMm: 1075,
      yMm: 15,
      zMm: 600,
      widthMm: 800,
      heightMm: 98,
      depthMm: 18,
    });
    const resPlinthe = snapModulePosition(plinthe, cuisine.walls, [m02]);
    expect(resPlinthe.yMm).toBe(0);
    // wall face 75 + depth 600 - recess 45 - plintheDepth/2 9 = 621
    expect(resPlinthe.zMm).toBeCloseTo(621, 2);

    // 9. Free-standing front-plane alignment
    const island1 = makeMod({
      id: 'isl-1',
      type: 'ilot_central',
      xMm: 1500,
      zMm: 2000,
      widthMm: 1000,
      depthMm: 800,
    });
    const island2 = makeMod({
      id: 'isl-2',
      type: 'ilot_central',
      xMm: 2540,
      zMm: 2030,
      widthMm: 1000,
      depthMm: 800,
    });
    const resFree = snapModulePosition(island2, [], [island1]);
    expect(resFree.xMm).toBeCloseTo(2500, 2);
    expect(resFree.zMm).toBeCloseTo(2000, 2);
    expect(resFree.guides.some((g) => g.kind === 'cabinet_front')).toBe(true);
  });

  it('ne signale aucune collision dans Cuisine en L ni Dressing sur-mesure', () => {
    expect(detectProjectCollisions(createCuisineEnLTemplate())).toEqual([]);
    expect(detectProjectCollisions(createDressingSurMesureTemplate())).toEqual([]);
  });

  it('détecte les collisions réelles OBB SAT, structurelles (poteau/poutre) et ouvertures sans faux positifs', () => {
    const baseDoc = createCuisineEnLTemplate();

    // 1. Overlapping module -> 'module' warning
    const overlapDoc = structuredClone(baseDoc);
    overlapDoc.modules.push(
      makeMod({
        id: 'mod-overlap',
        ref: 'M99',
        xMm: 1085,
        yMm: 0,
        zMm: 375,
        widthMm: 400,
        heightMm: 860,
        depthMm: 600,
      })
    );
    const modCols = detectProjectCollisions(overlapDoc);
    expect(
      modCols.some(
        (c) =>
          c.kind === 'module' &&
          (c.moduleRef === 'M99' || c.targetId === 'mod-overlap')
      )
    ).toBe(true);

    // 2. Rotated OBB SAT near-miss vs true rotated overlap
    const satDoc = {
      ...baseDoc,
      openings: [],
      utilities: [],
      modules: [
        makeMod({
          id: 'rot-a',
          ref: 'R1',
          xMm: 1500,
          yMm: 0,
          zMm: 1500,
          widthMm: 1000,
          depthMm: 200,
          rotationYRad: Math.PI / 4,
        }),
        makeMod({
          id: 'rot-b',
          ref: 'R2',
          // AABBs overlap strongly, but parallel 45deg boxes shifted along their normal by 230mm (>200mm) do NOT touch!
          xMm: 1500 + 230 * Math.SQRT1_2,
          yMm: 0,
          zMm: 1500 + 230 * Math.SQRT1_2,
          widthMm: 1000,
          depthMm: 200,
          rotationYRad: Math.PI / 4,
        }),
      ],
    };
    expect(detectProjectCollisions(satDoc)).toEqual([]);

    // Shift rot-b closer -> actual rotated overlap
    satDoc.modules[1].xMm = 1500 + 150 * Math.SQRT1_2;
    satDoc.modules[1].zMm = 1500 + 150 * Math.SQRT1_2;
    expect(detectProjectCollisions(satDoc).some((c) => c.kind === 'module')).toBe(true);

    // 3. Structural poteau collision vs non-structural prise/arrivee_eau
    const structDoc = structuredClone(baseDoc);
    structDoc.modules.push(
      makeMod({
        id: 'mod-poteau',
        ref: 'MP',
        xMm: 225, // matches util-poteau-1 at (225, 3175)
        yMm: 0,
        zMm: 3175,
        widthMm: 400,
        heightMm: 860,
        depthMm: 400,
      })
    );
    const structCols = detectProjectCollisions(structDoc);
    expect(
      structCols.some((c) => c.kind === 'structure' && c.moduleRef === 'MP')
    ).toBe(true);

    // 4. Opening obstruction: tall column across fenetre triggers 'ouverture', low base below fenetre does not
    const openDoc = structuredClone(baseDoc);
    openDoc.modules.push(
      makeMod({
        id: 'mod-block-win',
        ref: 'MW',
        type: 'colonne',
        xMm: 2200, // inside ouv-fenetre-1 u in [1675, 2875]
        yMm: 0,
        zMm: 375,
        widthMm: 600,
        heightMm: 2150,
        depthMm: 600,
      })
    );
    const openCols = detectProjectCollisions(openDoc);
    expect(
      openCols.some((c) => c.kind === 'ouverture' && c.moduleRef === 'MW')
    ).toBe(true);
  });

  it('fournit les sélecteurs Zustand mémoïsés (M1 préservés + M2 panneaux, quincaillerie, collisions)', () => {
    const doc = useProjectStore.getState().document;
    expect(selectActiveWall(doc, 'mur-est')?.id).toBe('mur-est');
    expect(selectSelectedEntity(doc, 'mod-c-01', 'module')?.kind).toBe('module');
    expect(selectProjectCounts(doc).moduleCount).toBe(12);

    const panels1 = selectProjectPanels(doc);
    const panels2 = selectProjectPanels(doc);
    expect(panels1).toBe(panels2); // WeakMap memoized reference stability
    expect(panels1.length).toBeGreaterThan(50);

    const hw = selectProjectHardware(doc);
    expect(hw.some((h) => h.kind === 'charniere')).toBe(true);
    expect(selectProjectCollisions(doc)).toEqual([]);
    expect(selectCollisionModuleIds(doc).size).toBe(0);

    // Add overlapping module via store -> live collision warning
    const overlapId = useProjectStore.getState().addModule({
      type: 'caisson_bas',
      nameFr: 'Caisson chevauchant',
      xMm: 1075,
      yMm: 0,
      zMm: 375,
      rotationYRad: 0,
      widthMm: 600,
      heightMm: 860,
      depthMm: 600,
      doorCount: 2,
      drawerCount: 0,
      shelfCount: 1,
    });
    const updatedDoc = useProjectStore.getState().document;
    const cols = selectProjectCollisions(updatedDoc);
    expect(cols.length).toBeGreaterThan(0);
    expect(selectCollisionModuleIds(updatedDoc).has(overlapId)).toBe(true);
  });

  it('verrouille strictement la caméra à l’intérieur de la pièce (rectangulaire et en L) et calcule les zones de caméra & murs auto-coupés', () => {
    const cuisine = createCuisineEnLTemplate();
    const poly = extractPrimaryRoomPolygon(cuisine.walls)!;
    expect(poly.isClosed).toBe(true);

    // Extreme exterior points on all sides + below floor + above ceiling must clamp strictly inside
    const exteriorCandidates: Array<[number, number, number]> = [
      [-5, 1.5, 1.5],
      [10, 1.5, 1.5],
      [2, 1.5, -4],
      [2, 1.5, 9],
      [8, -2, 8],
      [2, 6.0, 2],
    ];
    for (const pos of exteriorCandidates) {
      const clamped = clampCameraInsideRoom(pos, cuisine.walls, cuisine.ceilingHeightMm, 320);
      expect(clamped[1]).toBeGreaterThanOrEqual(0.45);
      expect(clamped[1]).toBeLessThanOrEqual(cuisine.ceilingHeightMm * 0.001 - 0.25 + 1e-6);
      expect(isPointInPolygonXZ({ x: clamped[0] * 1000, z: clamped[2] * 1000 }, poly.points)).toBe(
        true
      );
      // Respects wall thickness/2 (75mm) + margin (320mm) = 395mm clearance from wall centerlines
      expect(clamped[0] * 1000).toBeGreaterThanOrEqual(385);
      expect(clamped[0] * 1000).toBeLessThanOrEqual(3850 - 385);
      expect(clamped[2] * 1000).toBeGreaterThanOrEqual(385);
      expect(clamped[2] * 1000).toBeLessThanOrEqual(3400 - 385);
    }

    const clampedTarget = clampTargetInsideRoom([9, 4, -3], cuisine.walls, cuisine.ceilingHeightMm);
    expect(
      isPointInPolygonXZ({ x: clampedTarget[0] * 1000, z: clampedTarget[2] * 1000 }, poly.points)
    ).toBe(true);

    // Concave L-shaped room: point placed in the outer concave notch must clamp strictly inside L polygon
    const lWalls: WallSegment[] = [
      { id: 'l1', startMm: [0, 0], endMm: [4000, 0], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
      { id: 'l2', startMm: [4000, 0], endMm: [4000, 2000], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
      { id: 'l3', startMm: [4000, 2000], endMm: [2000, 2000], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
      { id: 'l4', startMm: [2000, 2000], endMm: [2000, 4000], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
      { id: 'l5', startMm: [2000, 4000], endMm: [0, 4000], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
      { id: 'l6', startMm: [0, 4000], endMm: [0, 0], thicknessMm: 150, heightMm: 2500, materialId: 'peinture-blanc-casse' },
    ];
    const lPoly = extractPrimaryRoomPolygon(lWalls)!;
    const notchClamped = clampCameraInsideRoom([3.5, 1.5, 3.5], lWalls, 2500, 300);
    expect(
      isPointInPolygonXZ({ x: notchClamped[0] * 1000, z: notchClamped[2] * 1000 }, lPoly.points)
    ).toBe(true);

    // Dynamic Camera Zones: includes Vue Globale (50° FOV) + wide-angle (70° FOV) interior wall viewpoints
    const zones = computeCameraZones(cuisine);
    const globalZone = zones.find((z) => z.id === 'global');
    expect(globalZone).toBeDefined();
    expect(globalZone!.fovDeg).toBe(50);

    const wallZones = zones.filter((z) => z.kind === 'wall');
    expect(wallZones).toHaveLength(4);
    for (const z of zones.filter((p) => p.kind !== 'global')) {
      expect(z.fovDeg).toBe(70);
      expect(z.positionM[1]).toBeCloseTo(1.48, 2);
      expect(
        isPointInPolygonXZ({ x: z.positionM[0] * 1000, z: z.positionM[2] * 1000 }, poly.points)
      ).toBe(true);
    }
    // Vue Mur Nord sits pulled back near Mur Sud (~220 mm clearance -> z >= 2.95 m in 3.4 m deep room)
    const northZone = wallZones.find((z) => z.wallId === 'mur-nord')!;
    expect(northZone.positionM[2]).toBeGreaterThanOrEqual(2.95);
    expect(northZone.positionM[2]).toBeLessThanOrEqual(3.15);

    // Automatic Front-Wall Cutaway dot-product test
    const wMetrics = analyzeWalls(cuisine.walls);
    const centerM: [number, number] = [1.925, 1.7];
    const camSouthEast: [number, number, number] = [5.2, 2.8, 5.0];
    const cutSouthEast = wMetrics
      .filter((wm) => shouldCutawayWall(wm, camSouthEast, centerM))
      .map((wm) => wm.wall.id);
    expect(cutSouthEast).toContain('mur-sud');
    expect(cutSouthEast).toContain('mur-est');
    expect(cutSouthEast).not.toContain('mur-nord');
    expect(cutSouthEast).not.toContain('mur-ouest');

    // Interior camera must NOT cut away any wall
    const camInside: [number, number, number] = [1.9, 1.5, 1.8];
    const cutInside = wMetrics.filter((wm) => shouldCutawayWall(wm, camInside, centerM));
    expect(cutInside).toHaveLength(0);

    // Interior module spawn always lands inside the room polygon
    const spawn = findInteriorSpawnPosition(cuisine, MODULE_CATALOG_BY_TYPE.caisson_bas);
    expect(isPointInPolygonXZ({ x: spawn.xMm, z: spawn.zMm }, poly.points)).toBe(true);
    expect(spawn.attachedWallId).toBeDefined();
  });

  it('ne contient aucun import DOM, React ou Three.js dans src/engine/geometry', () => {
    const files = ['wallMath.ts', 'snapping.ts', 'collision.ts', 'cameraZones.ts', 'index.ts'];
    for (const file of files) {
      const content = readFileSync(
        resolve(process.cwd(), 'src/engine/geometry', file),
        'utf-8'
      );
      expect(content).not.toMatch(/from\s+['"](?:react|three|@react-three|zustand)/);
      expect(content).not.toMatch(/\b(?:window|document)\./);
    }
  });
});
