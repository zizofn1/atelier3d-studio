import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardThickness, HandleStyle, ModuleInstance, PanelSpec } from '@/types';
import { DEFAULT_CARPENTRY_PARAMS, MODULE_CATALOG } from '@/data/defaultPricing';
import { isValidMaterialId } from '@/data/materialsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { generateModuleOutput } from '@/engine/carpentry';

function makeTestModule(
  overrides: Partial<ModuleInstance> = {}
): ModuleInstance {
  return {
    id: 'test-mod-1',
    ref: 'M99',
    type: 'caisson_bas',
    nameFr: 'Module test',
    xMm: 1000,
    yMm: 0,
    zMm: 500,
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

function panelLocalBox(p: PanelSpec): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  // Exact box spans matching our 3 canonical rotations
  const [rx, ry] = p.rotationRad;
  let sx = p.widthMm;
  let sy = p.heightMm;
  let sz = p.thicknessMm;

  if (Math.abs(Math.abs(rx) - Math.PI / 2) < 0.01) {
    // Rotated +-90deg around X: widthMm along X, heightMm along Z, thicknessMm along Y
    sx = p.widthMm;
    sy = p.thicknessMm;
    sz = p.heightMm;
  } else if (Math.abs(ry) > 0.01) {
    // Rotated around Y (supports +-90deg and 45deg diagonal corner doors)
    const c = Math.abs(Math.cos(ry));
    const s = Math.abs(Math.sin(ry));
    sx = p.widthMm * c + p.thicknessMm * s;
    sy = p.heightMm;
    sz = p.widthMm * s + p.thicknessMm * c;
  }

  return {
    minX: p.positionMm[0] - sx / 2,
    maxX: p.positionMm[0] + sx / 2,
    minY: p.positionMm[1] - sy / 2,
    maxY: p.positionMm[1] + sy / 2,
    minZ: p.positionMm[2] - sz / 2,
    maxZ: p.positionMm[2] + sz / 2,
  };
}

describe('Moteur Paramétrique Menuiserie (src/engine/carpentry)', () => {
  it('génère des panneaux valides et positifs pour les 16 types du catalogue', () => {
    for (const entry of MODULE_CATALOG) {
      const mod = makeTestModule({
        id: `cat-${entry.type}`,
        type: entry.type,
        nameFr: entry.nameFr,
        yMm: entry.defaultYMm,
        widthMm: entry.defaultWidthMm,
        heightMm: entry.defaultHeightMm,
        depthMm: entry.defaultDepthMm,
        doorCount: entry.defaultDoorCount,
        drawerCount: entry.defaultDrawerCount,
        shelfCount: entry.defaultShelfCount,
        hasPlinth: true,
        hasCountertop: true,
      });

      const out = generateModuleOutput(mod, DEFAULT_CARPENTRY_PARAMS);
      expect(out.panels.length, `${entry.type} doit générer >= 1 panneau`).toBeGreaterThan(0);
      expect(out.boundingBoxMm).toEqual({
        widthMm: entry.defaultWidthMm,
        heightMm: entry.defaultHeightMm,
        depthMm: entry.defaultDepthMm,
      });

      if (
        entry.type !== 'plan_de_travail' &&
        entry.type !== 'credence' &&
        entry.type !== 'plinthe'
      ) {
        expect(out.hardware.length, `${entry.type} doit générer de la quincaillerie`).toBeGreaterThan(0);
      }

      for (const p of out.panels) {
        expect(Number.isFinite(p.widthMm) && p.widthMm > 0).toBe(true);
        expect(Number.isFinite(p.heightMm) && p.heightMm > 0).toBe(true);
        expect(Number.isFinite(p.thicknessMm) && p.thicknessMm > 0).toBe(true);
        expect(p.positionMm.every((v) => Number.isFinite(v))).toBe(true);
        expect(p.rotationRad.every((v) => Number.isFinite(v))).toBe(true);
        expect(isValidMaterialId(p.materialId)).toBe(true);
        expect(['H', 'V', 'none']).toContain(p.grain);

        const box = panelLocalBox(p);
        expect(box.minX).toBeGreaterThanOrEqual(-mod.widthMm / 2 - 0.1);
        expect(box.maxX).toBeLessThanOrEqual(mod.widthMm / 2 + 0.1);
        expect(box.minY).toBeGreaterThanOrEqual(-0.1);
        expect(box.maxY).toBeLessThanOrEqual(mod.heightMm + 0.1);
        expect(box.minZ).toBeGreaterThanOrEqual(-mod.depthMm / 2 - 0.1);
        expect(box.maxZ).toBeLessThanOrEqual(mod.depthMm / 2 + 0.1);
      }
    }
  });

  it('respecte les épaisseurs de panneau 16 / 18 / 19 / 22 mm dans les déductions de largeur', () => {
    const thicknesses: BoardThickness[] = [16, 18, 19, 22];
    for (const T of thicknesses) {
      const mod = makeTestModule({
        type: 'caisson_haut',
        widthMm: 800,
        heightMm: 700,
        depthMm: 350,
        doorCount: 2,
        shelfCount: 1,
        hasPlinth: false,
      });
      const out = generateModuleOutput(mod, {
        ...DEFAULT_CARPENTRY_PARAMS,
        boardThickness: T,
      });

      const leftSide = out.panels.find((p) => p.role === 'joue_gauche')!;
      const bottom = out.panels.find((p) => p.role === 'dessous')!;
      const top = out.panels.find((p) => p.role === 'dessus')!;
      const shelf = out.panels.find((p) => p.role === 'etagere')!;

      expect(leftSide.thicknessMm).toBe(T);
      expect(bottom.widthMm).toBe(800 - 2 * T);
      expect(top.widthMm).toBe(800 - 2 * T);
      expect(shelf.widthMm).toBe(800 - 2 * T - 2);
    }
  });

  it('gère le fond rainuré vs appliqué en 5 mm et 8 mm', () => {
    for (const T_back of [5, 8] as const) {
      const mod = makeTestModule({
        type: 'caisson_haut',
        widthMm: 800,
        heightMm: 700,
        depthMm: 350,
        doorCount: 0,
        shelfCount: 0,
        hasPlinth: false,
      });

      const grooved = generateModuleOutput(mod, {
        ...DEFAULT_CARPENTRY_PARAMS,
        boardThickness: 18,
        backThickness: T_back,
        backMountType: 'rainure',
      });
      const gBack = grooved.panels.find((p) => p.role === 'fond')!;
      const gSide = grooved.panels.find((p) => p.role === 'joue_gauche')!;
      expect(gBack.thicknessMm).toBe(T_back);
      expect(gBack.widthMm).toBe(800 - 36 + 16); // +8mm groove each side
      expect(gBack.heightMm).toBe(700 - 36 + 16);
      expect(gSide.widthMm).toBe(350);

      const applied = generateModuleOutput(mod, {
        ...DEFAULT_CARPENTRY_PARAMS,
        boardThickness: 18,
        backThickness: T_back,
        backMountType: 'applique',
      });
      const aBack = applied.panels.find((p) => p.role === 'fond')!;
      const aSide = applied.panels.find((p) => p.role === 'joue_gauche')!;
      expect(aBack.thicknessMm).toBe(T_back);
      expect(aBack.widthMm).toBe(800 - 2);
      expect(aBack.heightMm).toBe(700 - 2);
      expect(aSide.widthMm).toBe(350 - T_back);
    }
  });

  it('calcule les jeux entre façades (2 mm / 3 mm) pour 1 à 6 portes et tiroirs complets (5 pièces)', () => {
    for (const gap of [2, 3]) {
      for (const nDoors of [1, 2, 3, 4, 5, 6]) {
        const mod = makeTestModule({
          type: 'bibliotheque',
          widthMm: 1800,
          heightMm: 2000,
          depthMm: 400,
          doorCount: nDoors,
          drawerCount: 0,
          shelfCount: 2,
          hasPlinth: false,
        });
        const out = generateModuleOutput(mod, {
          ...DEFAULT_CARPENTRY_PARAMS,
          facadeGapMm: gap,
        });
        const doors = out.panels.filter((p) => p.role === 'porte');
        expect(doors).toHaveLength(nDoors);
        const totalDoorW = doors.reduce((s, d) => s + d.widthMm, 0);
        expect(totalDoorW).toBeCloseTo(1800 - nDoors * gap, 1);
      }
    }

    // 3 stacked drawers -> 3 fronts + 3*(2 sides + 2 backs + 1 bottom) = 18 drawer panels
    const drawerMod = makeTestModule({
      type: 'caisson_bas',
      widthMm: 600,
      heightMm: 860,
      depthMm: 600,
      doorCount: 0,
      drawerCount: 3,
      shelfCount: 0,
      hasPlinth: true,
    });
    const out = generateModuleOutput(drawerMod, {
      ...DEFAULT_CARPENTRY_PARAMS,
      facadeGapMm: 3,
    });
    const fronts = out.panels.filter((p) => p.role === 'tiroir_facade');
    const sides = out.panels.filter((p) => p.role === 'tiroir_cote');
    const backs = out.panels.filter((p) => p.role === 'tiroir_arriere');
    const bottoms = out.panels.filter((p) => p.role === 'tiroir_fond');

    expect(fronts).toHaveLength(3);
    expect(sides).toHaveLength(6);
    expect(backs).toHaveLength(6);
    expect(bottoms).toHaveLength(3);
    const totalFrontH = fronts.reduce((s, f) => s + f.heightMm, 0);
    expect(totalFrontH).toBeCloseTo(760 - 3 * 3, 1);
    expect(fronts[0].animationMeta?.kind).toBe('drawer');
    expect(fronts[0].animationMeta?.slideTravelMm).toBeGreaterThan(200);
  });

  it('applique les bandes de chant sur les 4 bords et normalise le sens du fil', () => {
    const mod = makeTestModule({
      type: 'caisson_bas',
      doorCount: 2,
      shelfCount: 1,
    });
    const out = generateModuleOutput(mod, {
      ...DEFAULT_CARPENTRY_PARAMS,
      carcassMaterialId: 'blanc-alpin', // hasGrain: false
      facadeMaterialId: 'chene-naturel', // hasGrain: true
      backMaterialId: 'blanc-alpin',
    });

    const door = out.panels.find((p) => p.role === 'porte')!;
    expect(door.edges).toEqual({ top: '2', bottom: '2', left: '2', right: '2' });
    expect(door.grain).toBe('V');

    const shelf = out.panels.find((p) => p.role === 'etagere')!;
    expect(shelf.edges).toEqual({ top: '0.4', bottom: 'none', left: 'none', right: 'none' });
    expect(shelf.grain).toBe('none');

    const back = out.panels.find((p) => p.role === 'fond')!;
    expect(back.edges).toEqual({ top: 'none', bottom: 'none', left: 'none', right: 'none' });
    expect(back.grain).toBe('none');
  });

  it('génère la quincaillerie selon le style de poignée et les spécificités des modules', () => {
    const styles: Array<[HandleStyle, string]> = [
      ['bar', 'poignee'],
      ['knob', 'bouton'],
      ['gorge', 'profil_gorge'],
      ['push', 'push_open'],
    ];
    for (const [style, expectedKind] of styles) {
      const out = generateModuleOutput(makeTestModule({ doorCount: 2 }), {
        ...DEFAULT_CARPENTRY_PARAMS,
        handleStyle: style,
      });
      expect(out.hardware.some((h) => h.kind === expectedKind)).toBe(true);
    }

    // Sliding wardrobe
    const sliding = generateModuleOutput(
      makeTestModule({
        type: 'portes_coulissantes',
        widthMm: 1800,
        heightMm: 2300,
        depthMm: 650,
        doorCount: 3,
        shelfCount: 4,
      }),
      DEFAULT_CARPENTRY_PARAMS
    );
    const slidingDoors = sliding.panels.filter((p) => p.role === 'porte');
    expect(slidingDoors).toHaveLength(3);
    // Doors 0 and 2 on front Z track, door 1 on rear Z track, 0 and 2 separated in X
    expect(slidingDoors[0].positionMm[2]).toBe(slidingDoors[2].positionMm[2]);
    expect(slidingDoors[0].positionMm[2]).not.toBe(slidingDoors[1].positionMm[2]);
    expect(
      slidingDoors[2].positionMm[0] - slidingDoors[2].widthMm / 2
    ).toBeGreaterThan(
      slidingDoors[0].positionMm[0] + slidingDoors[0].widthMm / 2
    );
    expect(sliding.hardware.some((h) => h.kind === 'kit_coulissant')).toBe(true);

    // Corner unit en_l & aveugle
    const angleL = generateModuleOutput(
      makeTestModule({
        type: 'caisson_angle',
        widthMm: 900,
        heightMm: 860,
        depthMm: 900,
        cornerKind: 'en_l',
        doorCount: 2,
      }),
      DEFAULT_CARPENTRY_PARAMS
    );
    expect(angleL.panels.filter((p) => p.role === 'porte')).toHaveLength(2);
    expect(angleL.panels.filter((p) => p.role === 'plinthe')).toHaveLength(2);

    const angleBlind = generateModuleOutput(
      makeTestModule({
        type: 'caisson_angle',
        widthMm: 1000,
        heightMm: 860,
        depthMm: 600,
        cornerKind: 'aveugle',
        doorCount: 1,
      }),
      DEFAULT_CARPENTRY_PARAMS
    );
    expect(angleBlind.panels.filter((p) => p.role === 'porte')).toHaveLength(2);

    // Colonne four vs refrigerateur
    const colFour = generateModuleOutput(
      makeTestModule({
        type: 'colonne',
        widthMm: 600,
        heightMm: 2150,
        depthMm: 600,
        colonneVariant: 'four',
        doorCount: 1,
        drawerCount: 1,
      }),
      DEFAULT_CARPENTRY_PARAMS
    );
    expect(colFour.panels.some((p) => p.nameFr.includes('four'))).toBe(true);

    const colFridge = generateModuleOutput(
      makeTestModule({
        type: 'colonne',
        widthMm: 600,
        heightMm: 2150,
        depthMm: 600,
        colonneVariant: 'refrigerateur',
        doorCount: 2,
        drawerCount: 0,
      }),
      DEFAULT_CARPENTRY_PARAMS
    );
    expect(colFridge.panels.some((p) => p.nameFr.includes('réfrigérateur'))).toBe(true);
  });

  it('respecte les overrides par module sans muter les paramètres globaux', () => {
    const mod = makeTestModule({
      overrides: {
        boardThickness: 22,
        facadeMaterialId: 'laque-vert-sauge',
      },
    });
    const out = generateModuleOutput(mod, DEFAULT_CARPENTRY_PARAMS);
    const door = out.panels.find((p) => p.role === 'porte')!;
    expect(door.thicknessMm).toBe(22);
    expect(door.materialId).toBe('laque-vert-sauge');
    expect(door.grain).toBe('none');
    expect(DEFAULT_CARPENTRY_PARAMS.boardThickness).toBe(18);
  });

  it('génère tous les modules des modèles Cuisine en L et Dressing sur-mesure sans NaN ni débordement', () => {
    for (const tpl of [createCuisineEnLTemplate(), createDressingSurMesureTemplate()]) {
      for (const mod of tpl.modules) {
        const out = generateModuleOutput(mod, tpl.defaultCarpentry);
        expect(out.panels.length).toBeGreaterThan(0);
        for (const p of out.panels) {
          expect(Number.isFinite(p.widthMm) && p.widthMm > 0).toBe(true);
          expect(Number.isFinite(p.heightMm) && p.heightMm > 0).toBe(true);
          expect(Number.isFinite(p.thicknessMm) && p.thicknessMm > 0).toBe(true);
          const box = panelLocalBox(p);
          expect(box.minX).toBeGreaterThanOrEqual(-mod.widthMm / 2 - 0.1);
          expect(box.maxX).toBeLessThanOrEqual(mod.widthMm / 2 + 0.1);
          expect(box.minY).toBeGreaterThanOrEqual(-0.1);
          expect(box.maxY).toBeLessThanOrEqual(mod.heightMm + 0.1);
          expect(box.minZ).toBeGreaterThanOrEqual(-mod.depthMm / 2 - 0.1);
          expect(box.maxZ).toBeLessThanOrEqual(mod.depthMm / 2 + 0.1);
        }
      }
    }
  });

  it('anime les portes coulissantes sans inversion (rails Z distincts T+4mm et ouverture réelle de l’intérieur)', () => {
    const T = DEFAULT_CARPENTRY_PARAMS.boardThickness; // 18 mm

    // 2 doors: front-left slides ~88% over stationary back-right
    const twoDoorMod = makeTestModule({
      type: 'portes_coulissantes',
      widthMm: 1400,
      heightMm: 2300,
      depthMm: 650,
      doorCount: 2,
      shelfCount: 4,
    });
    const out2 = generateModuleOutput(twoDoorMod, DEFAULT_CARPENTRY_PARAMS);
    const doors2 = out2.panels.filter((p) => p.role === 'porte');
    expect(doors2).toHaveLength(2);
    // Distinct Z tracks separated by T + 4 mm
    expect(doors2[0].positionMm[2] - doors2[1].positionMm[2]).toBeCloseTo(T + 4, 2);

    const t0 = (doors2[0].animationMeta?.slideTravelMm ?? 0) * (doors2[0].animationMeta?.slideDirection ?? 1);
    const t1 = (doors2[1].animationMeta?.slideTravelMm ?? 0) * (doors2[1].animationMeta?.slideDirection ?? 1);
    expect(t0).toBeGreaterThan(doors2[0].widthMm * 0.8);
    expect(t1).toBe(0); // Back-right leaf stays put — never swaps!

    // Compute open X spans: left bay must be genuinely exposed & door 0 stays within cabinet width
    const d0OpenLeft = doors2[0].positionMm[0] + t0 - doors2[0].widthMm / 2;
    const d0OpenRight = doors2[0].positionMm[0] + t0 + doors2[0].widthMm / 2;
    expect(d0OpenLeft - -twoDoorMod.widthMm / 2).toBeGreaterThan(doors2[0].widthMm * 0.8);
    expect(d0OpenRight).toBeLessThanOrEqual(twoDoorMod.widthMm / 2 + 0.5);

    // 3 doors: left + middle slide right cleanly without front-track collision or overhang
    const threeDoorMod = makeTestModule({
      type: 'portes_coulissantes',
      widthMm: 1800,
      heightMm: 2300,
      depthMm: 650,
      doorCount: 3,
      shelfCount: 4,
    });
    const out3 = generateModuleOutput(threeDoorMod, DEFAULT_CARPENTRY_PARAMS);
    const doors3 = out3.panels.filter((p) => p.role === 'porte');
    expect(doors3).toHaveLength(3);
    expect(doors3[0].positionMm[2] - doors3[1].positionMm[2]).toBeCloseTo(T + 4, 2);
    expect(doors3[0].positionMm[2]).toBe(doors3[2].positionMm[2]);

    const s0 = (doors3[0].animationMeta?.slideTravelMm ?? 0) * (doors3[0].animationMeta?.slideDirection ?? 1);
    const s1 = (doors3[1].animationMeta?.slideTravelMm ?? 0) * (doors3[1].animationMeta?.slideDirection ?? 1);
    const s2 = (doors3[2].animationMeta?.slideTravelMm ?? 0) * (doors3[2].animationMeta?.slideDirection ?? 1);
    expect(s0).toBeGreaterThan(300);
    expect(s1).toBeGreaterThan(300);
    expect(s2).toBe(0);

    // Front-left leaf (door 0) must not collide with front-right leaf (door 2) when open
    const d0Right = doors3[0].positionMm[0] + s0 + doors3[0].widthMm / 2;
    const d2Left = doors3[2].positionMm[0] + s2 - doors3[2].widthMm / 2;
    expect(d0Right).toBeLessThan(d2Left);

    // Left bay is genuinely exposed
    const d0Left = doors3[0].positionMm[0] + s0 - doors3[0].widthMm / 2;
    expect(d0Left - -threeDoorMod.widthMm / 2).toBeGreaterThan(400);
  });

  it('ne contient aucun import DOM, React ou Three.js dans src/engine/carpentry', () => {
    const files = [
      'panelBuilder.ts',
      'kitchenModules.ts',
      'dressingModules.ts',
      'customModules.ts',
      'index.ts',
    ];
    for (const file of files) {
      const content = readFileSync(
        resolve(process.cwd(), 'src/engine/carpentry', file),
        'utf-8'
      );
      expect(content).not.toMatch(/from\s+['"](?:react|three|@react-three|zustand)/);
      expect(content).not.toMatch(/\b(?:window|document)\./);
    }
  });
});
