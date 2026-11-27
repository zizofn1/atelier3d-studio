import { beforeEach, describe, expect, it } from 'vitest';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import {
  analyzeWalls,
  buildRoomPresetWalls,
  clampCameraInsideRoom,
  computeCameraZones,
  detectProjectCollisions,
  extractRoomPolygons,
  findSafeRoomInteriorPoint,
  getWallElevationFrame,
  getWallInteriorSpanMm,
  isPointInPolygonXZ,
  moduleToFootprints2D,
  shouldCutawayWall,
  snapModulePosition,
  snapPropPosition,
} from '@/engine/geometry';
import { generateModuleOutput } from '@/engine/carpentry';
import { buildCarcassPanels, createPanelIdCounter } from '@/engine/carpentry/panelBuilder';
import { buildWallElevationDrawing2D } from '@/exports/drawing2d';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import type { ModuleInstance, ProjectDocument, SceneProp, WallSegment } from '@/types';

function makeMod(overrides: Partial<ModuleInstance> = {}): ModuleInstance {
  return {
    id: overrides.id ?? 'm-test',
    ref: overrides.ref ?? 'M99',
    type: overrides.type ?? 'caisson_bas',
    nameFr: overrides.nameFr ?? 'Caisson test',
    xMm: overrides.xMm ?? 0,
    yMm: overrides.yMm ?? 0,
    zMm: overrides.zMm ?? 0,
    rotationYRad: overrides.rotationYRad ?? 0,
    widthMm: overrides.widthMm ?? 600,
    heightMm: overrides.heightMm ?? 860,
    depthMm: overrides.depthMm ?? 600,
    attachedWallId: overrides.attachedWallId,
    doorCount: overrides.doorCount ?? 1,
    drawerCount: overrides.drawerCount ?? 0,
    shelfCount: overrides.shelfCount ?? 1,
    hasPlinth: overrides.hasPlinth ?? true,
    hingeSide: overrides.hingeSide,
  };
}

function makeProp(overrides: Partial<SceneProp> = {}): SceneProp {
  return {
    id: overrides.id ?? 'p-test',
    ref: overrides.ref ?? 'P01',
    type: overrides.type ?? 'refrigerateur',
    category: overrides.category ?? 'electromenager',
    nameFr: overrides.nameFr ?? 'Réfrigérateur',
    xMm: overrides.xMm ?? 0,
    yMm: overrides.yMm ?? 0,
    zMm: overrides.zMm ?? 0,
    rotationYRad: overrides.rotationYRad ?? 0,
    widthMm: overrides.widthMm ?? 600,
    heightMm: overrides.heightMm ?? 1850,
    depthMm: overrides.depthMm ?? 650,
    attachedWallId: overrides.attachedWallId,
  };
}

function makeSimpleRectDoc(walls: WallSegment[], extras: Partial<ProjectDocument> = {}): ProjectDocument {
  const base = createCuisineEnLTemplate();
  return {
    ...base,
    id: 'test-rect-doc',
    walls,
    openings: extras.openings ?? [],
    utilities: extras.utilities ?? [],
    modules: extras.modules ?? [],
    props: extras.props ?? [],
  };
}

describe('Audit Mathématique/Géométrique + Évolutions Atelier3D', () => {
  beforeEach(() => {
    useUIStore.getState().resetPlan2dFilters();
    useUIStore.getState().setRenderQuality('fort');
  });

  it('C1: repère Élévation 2D invariant entre murs tracés dans le sens horaire (CW) et anti-horaire (CCW)', () => {
    // Same 4000x3000 rectangle drawn CW vs CCW
    const cwWalls = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 'cw');
    const ccwWalls: WallSegment[] = [...cwWalls]
      .reverse()
      .map((w) => ({ ...w, startMm: w.endMm, endMm: w.startMm }));

    const cwMetrics = analyzeWalls(cwWalls);
    const ccwMetrics = analyzeWalls(ccwWalls);

    // North wall interior normal is (0, +1) in BOTH orientations, so viewer looking North sees East (+1, 0) on the right
    const northCw = cwMetrics[0];
    const northCcw = ccwMetrics.find((m) => m.wall.id === northCw.wall.id)!;
    expect(northCw.inwardNormal.z).toBeCloseTo(1, 4);
    expect(northCcw.inwardNormal.z).toBeCloseTo(1, 4);
    expect(getWallElevationFrame(northCw).axisRight).toEqual({ x: 1, z: 0 });
    expect(getWallElevationFrame(northCcw).axisRight).toEqual({ x: 1, z: 0 });
    expect(getWallElevationFrame(northCcw).flippedAlongWall).toBe(true);

    // Module placed on the WEST (left when looking North) appears on the LEFT in BOTH CW & CCW elevations
    const modLeft = makeMod({
      id: 'mod-left',
      ref: 'M01',
      xMm: 450, // near x=0..600 interior left
      zMm: 300,
      widthMm: 600,
      depthMm: 600,
      attachedWallId: northCw.wall.id,
    });
    const elevCw = buildWallElevationDrawing2D(makeSimpleRectDoc(cwWalls, { modules: [modLeft] }), northCw.wall.id, 'mm');
    const elevCcw = buildWallElevationDrawing2D(makeSimpleRectDoc(ccwWalls, { modules: [modLeft] }), northCw.wall.id, 'mm');

    const rectCw = elevCw.rects.find((r) => r.entityId === 'mod-left')!;
    const rectCcw = elevCcw.rects.find((r) => r.entityId === 'mod-left')!;
    expect(rectCw.x).toBeCloseTo(rectCcw.x, 1);
    expect(rectCw.x).toBeLessThan(800);
  });

  it('C2 & M1: cotes nettes signées sur pièce en L / T-jonction avec cloison intérieure', () => {
    const lWalls = buildRoomPresetWalls('l', 4000, 3400, 150, 2500, 'peinture-blanc-casse', 'l');
    const lMetrics = analyzeWalls(lWalls);
    // Wall 1 (North top, net 4000) & Wall 4 (recess horizontal inner return) both have valid positive net lengths
    expect(getWallInteriorSpanMm(lMetrics[0], lMetrics).netLengthMm).toBe(4000);
    // Reflex corner on inner L-turn subtracts outer overhang cleanly (signed inset < 0 on reflex side)
    const reflexSpan = getWallInteriorSpanMm(lMetrics[2], lMetrics);
    expect(reflexSpan.netLengthMm).toBeGreaterThan(1000);

    // T-junction: 4 outer room walls + 1 interior partition splitting the room cleanly
    const rect = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 't');
    const partition: WallSegment = {
      id: 'cloison-int',
      labelFr: 'Cloison centrale',
      startMm: [2000, -75],
      endMm: [2000, 3075],
      thicknessMm: 100,
      heightMm: 2500,
      materialId: 'peinture-blanc-casse',
    };
    const allWithPartition = [...rect, partition];
    const polys = extractRoomPolygons(allWithPartition);
    expect(polys.length).toBeGreaterThanOrEqual(1);
    const tMetrics = analyzeWalls(allWithPartition);
    const partitionMetric = tMetrics.find((m) => m.wall.id === 'cloison-int')!;
    expect(partitionMetric).toBeDefined();
    expect(getWallInteriorSpanMm(partitionMetric, tMetrics).netLengthMm).toBe(3000);
  });

  it('C3 & Req #3: élévation 2D affiche mesures placards, portes, fenêtres, électro/déco et distances mur↔objet', () => {
    const walls = buildRoomPresetWalls('rect', 4000, 3000, 150, 2500, 'peinture-blanc-casse', 'elev');
    const northId = walls[0].id;
    const mod = makeMod({
      id: 'm-elev',
      ref: 'M01',
      xMm: 1000, // u = 1075 (700..1300 around x=1000)
      zMm: 300,
      widthMm: 600,
      heightMm: 860,
      depthMm: 600,
      attachedWallId: northId,
    });
    const prop = makeProp({
      id: 'p-elev',
      ref: 'E01',
      type: 'refrigerateur',
      nameFr: 'Réfrigérateur',
      xMm: 3400, // u = 3475 -> 300mm gap from right interior corner (4000)
      zMm: 331,
      widthMm: 600,
      heightMm: 1850,
      depthMm: 650,
      attachedWallId: northId,
    });
    const doc = makeSimpleRectDoc(walls, {
      modules: [mod],
      props: [prop],
      openings: [
        {
          id: 'fen-1',
          wallId: northId,
          kind: 'fenetre',
          offsetFromStartMm: 1800,
          widthMm: 1000,
          heightMm: 1100,
          sillHeightMm: 1050,
          labelFr: 'Fenêtre',
        },
      ],
    });

    const elev = buildWallElevationDrawing2D(doc, northId, 'mm');
    // Shows ref + dimension label for prop, opening & module
    expect(elev.texts.some((t) => t.text.includes('E01'))).toBe(true);
    expect(elev.texts.some((t) => t.text.includes('600') && t.text.includes('1') && t.text.includes('850'))).toBe(true);
    expect(elev.texts.some((t) => t.text.includes('Fenêtre') && t.text.includes('1') && t.text.includes('000'))).toBe(true);
    // Shows mur <-> objet horizontal dimensions (e.g. left wall to M01 = 700 mm, right prop to right wall = 300 mm)
    expect(elev.dimensions.some((d) => d.orientation === 'H' && /700/.test(d.label))).toBe(true);
    expect(elev.dimensions.some((d) => d.orientation === 'H' && /300/.test(d.label))).toBe(true);
    // Shows net interior 4 000 mm + full centerline 4 150 mm
    expect(elev.dimensions.some((d) => d.orientation === 'H' && /4[\s\u00a0\u202f]?000/.test(d.label))).toBe(true);
    expect(elev.dimensions.some((d) => d.orientation === 'H' && /4[\s\u00a0\u202f]?150/.test(d.label))).toBe(true);
  });

  it('C4 & M3: pan coupé unifié (-Z/+X) + pentagone 45° + plinthe diagonale + charnière droite exacte + fond rainuré', () => {
    const base = createCuisineEnLTemplate();
    const panCoupeMod = makeMod({
      id: 'pc-1',
      type: 'caisson_angle_pan_coupe',
      widthMm: 900,
      heightMm: 860,
      depthMm: 900,
      doorCount: 1,
      shelfCount: 1,
      hingeSide: 'right',
    });
    const out = generateModuleOutput(panCoupeMod, base.defaultCarpentry);

    // Unified backs on North (-Z) and East (+X) + chamfered plates & shelves
    expect(out.panels.some((p) => p.nameFr === 'Fond Nord pan coupé')).toBe(true);
    expect(out.panels.some((p) => p.nameFr === 'Fond Est pan coupé')).toBe(true);
    expect(out.panels.some((p) => p.role === 'dessous' && (p.chamferFrontCornerMm ?? 0) > 100)).toBe(true);
    expect(out.panels.some((p) => p.role === 'etagere' && (p.chamferFrontCornerMm ?? 0) > 100)).toBe(true);
    // 45° diagonal plinth
    const plinth = out.panels.find((p) => p.role === 'plinthe')!;
    expect(Math.abs(plinth.rotationRad[1] + Math.PI / 4)).toBeLessThan(0.01);

    // Right hinge pivot lies at (+halfW*cos(theta), -halfW*sin(theta)) from rotated door center
    const door = out.panels.find((p) => p.role === 'porte')!;
    expect(door.animationMeta?.kind).toBe('hinged_right');
    const theta = door.rotationRad[1];
    const expectedRightX = door.positionMm[0] + (door.widthMm / 2) * Math.cos(theta);
    const expectedRightZ = door.positionMm[2] - (door.widthMm / 2) * Math.sin(theta);
    expect(door.animationMeta!.pivotMm![0]).toBeCloseTo(expectedRightX, 0);
    expect(door.animationMeta!.pivotMm![2]).toBeCloseTo(expectedRightZ, 0);

    // Fond rainuré in topMode='full' spans exact interior groove height (H - 2*T + 2*grooveDepth)
    const counter = createPanelIdCounter('fond-test');
    const resFull = buildCarcassPanels({
      counter,
      params: { ...base.defaultCarpentry, boardThickness: 18, backMountType: 'rainure' },
      widthMm: 600,
      heightMm: 760,
      depthMm: 560,
      yBaseMm: 100,
      zBackMm: -280,
      topMode: 'full',
    });
    const fond = resFull.panels.find((p) => p.role === 'fond')!;
    expect(fond.heightMm).toBe(760 - 36 + 16); // 740 mm
  });

  it('C5 & Req #1: alignement coin 2 murs + conservation rotation utilisateur (placards et électro/déco) + L-OBB & mur collisions', () => {
    const walls = buildRoomPresetWalls('rect', 3000, 3000, 150, 2500, 'peinture-blanc-casse', 'c1');

    // 1. Corner cabinet placed near NE corner (x=2500, z=480) auto-snaps flush to BOTH North & East walls with backs on (-Z, +X)
    const cornerMod = makeMod({
      id: 'cm-1',
      type: 'caisson_angle_pan_coupe',
      xMm: 2480,
      zMm: 480,
      widthMm: 900,
      depthMm: 900,
    });
    const cornerSnap = snapModulePosition(cornerMod, walls, []);
    expect(Math.round(cornerSnap.xMm)).toBe(2550); // 3000 - 450
    expect(Math.round(cornerSnap.zMm)).toBe(450);  // 0 + 450
    expect(Math.abs(cornerSnap.rotationYRad)).toBeLessThan(0.01); // 0 rad aligns backs on -Z & +X cleanly into NE corner
    expect(cornerSnap.guides.filter((g) => g.kind === 'wall').length).toBeGreaterThanOrEqual(2);

    // 2. Non-square rectangular cabinet (800x600) placed in NW corner then rotated 90° preserves rotation & stays flush in corner
    const rectMod = makeMod({
      id: 'rm-1',
      type: 'caisson_bas',
      xMm: 420,
      zMm: 340,
      widthMm: 800,
      depthMm: 600,
    });
    const firstSnap = snapModulePosition(rectMod, walls, []);
    expect(Math.round(firstSnap.xMm)).toBe(400);
    expect(Math.round(firstSnap.zMm)).toBe(300);

    const rotatedSnap = snapModulePosition(
      { ...rectMod, ...firstSnap, rotationYRad: Math.PI / 2 },
      walls,
      [],
      { preserveRotation: true }
    );
    expect(rotatedSnap.rotationYRad).toBeCloseTo(Math.PI / 2, 4);
    expect(Math.round(rotatedSnap.xMm)).toBe(300); // depth rotated to X
    expect(Math.round(rotatedSnap.zMm)).toBe(400); // width rotated to Z

    // 3. Appliance / Decor prop (Fridge 700x600) near NW corner snaps to BOTH walls & preserves post-rotation
    const fridge = makeProp({
      id: 'fr-1',
      type: 'refrigerateur',
      xMm: 380,
      zMm: 340,
      widthMm: 700,
      depthMm: 600,
    });
    const propSnap = snapPropPosition(fridge, walls, []);
    expect(propSnap.guides?.filter((g) => g.kind === 'wall').length).toBeGreaterThanOrEqual(2);
    expect(Math.round(propSnap.xMm)).toBe(356); // 350 + 6 clearance
    expect(Math.round(propSnap.zMm)).toBe(306); // 300 + 6 clearance

    const propRotated = snapPropPosition(
      { ...fridge, ...propSnap, rotationYRad: Math.PI / 2 },
      walls,
      [],
      { preserveRotation: true }
    );
    expect(propRotated.rotationYRad).toBeCloseTo(Math.PI / 2, 4);
    expect(Math.round(propRotated.xMm)).toBe(306);
    expect(Math.round(propRotated.zMm)).toBe(356);

    // 4. L-shaped corner unit has 2 non-overlapping arm OBBs; table inside empty recess does NOT collide
    const lUnit = makeMod({
      id: 'l-unit',
      type: 'caisson_angle_l',
      xMm: 2550,
      zMm: 450,
      widthMm: 900,
      depthMm: 900,
      rotationYRad: 0,
    });
    expect(moduleToFootprints2D(lUnit)).toHaveLength(2);
    const smallStand = makeMod({
      id: 'in-recess',
      type: 'ilot_central',
      xMm: 2220, // inside empty (-X, +Z) recess of NE L-unit (x in [2100..2350], z in [700..900])
      zMm: 820,
      widthMm: 200,
      depthMm: 200,
    });
    const docL = makeSimpleRectDoc(walls, { modules: [lUnit, smallStand] });
    expect(detectProjectCollisions(docL).some((c) => c.kind === 'module')).toBe(false);

    // 5. Module overlapping a solid wall triggers structure collision
    const modThroughWall = makeMod({
      id: 'bad-mod',
      xMm: 1000,
      zMm: 0, // directly through North wall [-150..0]
      widthMm: 600,
      depthMm: 600,
    });
    const colWall = detectProjectCollisions(makeSimpleRectDoc(walls, { modules: [modThroughWall] }));
    expect(colWall.some((c) => c.targetId === walls[0].id)).toBe(true);
  });

  it('C6 & M4: coupe mur U-shape sûre + clamp caméra dans l’aile U + angles convexes valides', () => {
    const uWalls = buildRoomPresetWalls('u', 4000, 3200, 150, 2500, 'peinture-blanc-casse', 'u');
    const uMetrics = analyzeWalls(uWalls);
    const safePt = findSafeRoomInteriorPoint(uWalls, uMetrics);
    const centerM: [number, number] = [safePt.x * 0.001, safePt.z * 0.001];

    // Camera inside left wing of U room -> NO wall should cut away
    const insideLeftWing: [number, number, number] = [0.55, 1.5, 2.5];
    const cutInside = uMetrics.filter((wm) =>
      shouldCutawayWall(wm, insideLeftWing, centerM, uWalls)
    );
    expect(cutInside).toHaveLength(0);

    // Camera just outside right U-wing clamps cleanly INTO the right wing (x > 2.8m), not teleported across the U courtyard
    const clampedRight = clampCameraInsideRoom([4.3, 1.5, 2.6], uWalls, 2500, 250);
    expect(clampedRight[0]).toBeGreaterThan(2.8);
    expect(clampedRight[2]).toBeGreaterThan(2.0);

    // All generated corner camera presets sit inside closed L/U room polygon
    const uDoc = makeSimpleRectDoc(uWalls);
    const zones = computeCameraZones(uDoc);
    const cornerZones = zones.filter((z) => z.kind === 'corner');
    expect(cornerZones.length).toBeGreaterThanOrEqual(2);
    const polyPts = extractRoomPolygons(uWalls)[0].points;
    for (const cz of cornerZones) {
      expect(isPointInPolygonXZ({ x: cz.positionM[0] * 1000, z: cz.positionM[2] * 1000 }, polyPts)).toBe(true);
    }
  });

  it('Decision 2 & Req #2 & #4: resizeWallNetLength garde angles 90° + filtres Plan 2D + Qualité Standard/Fort/Ultra', () => {
    const walls = buildRoomPresetWalls('rect', 3000, 4000, 150, 2500, 'peinture-blanc-casse', 'res');
    useProjectStore.getState().setDocument(makeSimpleRectDoc(walls));
    // Resize wall 1 (North) from 3000 mm -> 3600 mm
    useProjectStore.getState().resizeWallNetLength(walls[0].id, 3600);
    const updatedWalls = useProjectStore.getState().document.walls;
    const updatedMetrics = analyzeWalls(updatedWalls);
    expect(getWallInteriorSpanMm(updatedMetrics[0], updatedMetrics).netLengthMm).toBe(3600);
    // East wall keeps its 4000 mm net length and stays vertical (90°)
    expect(getWallInteriorSpanMm(updatedMetrics[1], updatedMetrics).netLengthMm).toBe(4000);
    expect(updatedWalls[1].startMm[0]).toBe(updatedWalls[1].endMm[0]);
    // South wall also matches 3600 mm net
    expect(getWallInteriorSpanMm(updatedMetrics[2], updatedMetrics).netLengthMm).toBe(3600);

    // Plan 2D filters toggle cleanly
    const ui = useUIStore.getState();
    expect(ui.plan2dFilters).toEqual({ base: true, upper: true, surfaces: true, props: true });
    ui.togglePlan2dFilter('upper');
    expect(useUIStore.getState().plan2dFilters.upper).toBe(false);
    ui.togglePlan2dFilter('props');
    expect(useUIStore.getState().plan2dFilters.props).toBe(false);

    // 3-tier RenderQuality state cycling
    expect(useUIStore.getState().renderQuality).toBe('fort');
    ui.toggleRenderQuality();
    expect(useUIStore.getState().renderQuality).toBe('ultra');
    ui.toggleRenderQuality();
    expect(useUIStore.getState().renderQuality).toBe('standard');
  });
});
