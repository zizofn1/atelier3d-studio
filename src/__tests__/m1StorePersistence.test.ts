import { jsPDF } from 'jspdf';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MODULE_CATALOG,
  MODULE_CATALOG_BY_TYPE,
} from '@/data/defaultPricing';
import {
  MATERIALS_BY_ID,
  MATERIALS_CATALOG,
  getMaterialById,
  isValidMaterialId,
} from '@/data/materialsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { PDF_FONT_FAMILY, registerFrenchPdfFont } from '@/exports/fontLoader';
import { FR } from '@/i18n/fr';
import {
  deleteProject,
  duplicateProject,
  ensureStarterProjects,
  getProject,
  listProjects,
  loadInitialProject,
  renameProject,
  resetInMemoryProjectStore,
  saveProject,
} from '@/persistence/indexedDb';
import {
  parseAndValidateProjectJson,
  serializeProjectToJson,
} from '@/persistence/jsonSerializer';
import { generateThumbnailDataUrl } from '@/persistence/thumbnail';
import {
  pauseHistory,
  resumeHistory,
  useProjectStore,
} from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { convertCurrency, formatCurrency, roundCurrency } from '@/utils/currency';
import { generateId, nextModuleRef } from '@/utils/id';
import { cmToMm, formatDim, mmToCm, parseDim, roundMm } from '@/utils/units';

function normalizeSpaces(str: string): string {
  return str.replace(/[\s\u00A0\u202F]+/g, ' ').trim();
}

describe('M1 — Utilitaires unités & devises', () => {
  it('convertit et formate les dimensions en mm et cm selon les conventions françaises', () => {
    expect(roundMm(123.456, 1)).toBe(123.5);
    expect(mmToCm(600)).toBe(60);
    expect(cmToMm(60.5)).toBe(605);

    expect(normalizeSpaces(formatDim(600, 'mm'))).toBe('600 mm');
    expect(normalizeSpaces(formatDim(600, 'cm'))).toBe('60 cm');
    expect(normalizeSpaces(formatDim(605, 'cm'))).toBe('60,5 cm');
    expect(normalizeSpaces(formatDim(Number.NaN, 'mm'))).toBe('0 mm');
  });

  it('analyse les saisies utilisateur sans jamais retourner NaN', () => {
    expect(parseDim('600', 'mm')).toBe(600);
    expect(parseDim('60,5', 'cm')).toBe(605);
    expect(parseDim('60.5 cm', 'mm')).toBe(605);
    expect(parseDim('1 200 mm', 'cm')).toBe(1200);
    expect(parseDim('1,25 m', 'mm')).toBe(1250);

    expect(parseDim('', 'mm')).toBeNull();
    expect(parseDim('abc', 'mm')).toBeNull();
    expect(parseDim('-50', 'mm')).toBeNull();
    expect(parseDim('NaN', 'mm')).toBeNull();
    expect(parseDim(Number.NaN, 'mm')).toBeNull();
  });

  it('formate et convertit les devises MAD, EUR et USD en français', () => {
    expect(normalizeSpaces(formatCurrency(1250, 'MAD'))).toBe('1 250,00 MAD');
    expect(normalizeSpaces(formatCurrency(115, 'EUR'))).toBe('115,00 €');
    expect(normalizeSpaces(formatCurrency(125, 'USD'))).toBe('125,00 $');
    expect(normalizeSpaces(formatCurrency(Number.NaN, 'MAD'))).toBe('0,00 MAD');

    const eur = convertCurrency(1000, 'MAD', 'EUR');
    expect(eur).toBeGreaterThan(0);
    const backToMad = convertCurrency(eur, 'EUR', 'MAD');
    expect(Math.abs(backToMad - 1000)).toBeLessThanOrEqual(1);
    expect(convertCurrency(Number.NaN, 'MAD', 'EUR')).toBe(0);
  });

  it('génère des identifiants et références séquentielles de modules', () => {
    expect(generateId('mod')).toMatch(/^mod_/);
    expect(nextModuleRef([])).toBe('M01');
    expect(nextModuleRef([{ ref: 'M01' }, { ref: 'M03' }])).toBe('M04');
    expect(nextModuleRef([{ ref: 'M09' }])).toBe('M10');
  });
});

describe('M1 — Catalogue matériaux, modules & modèles de démarrage', () => {
  it('contient au moins 22 matériaux couvrant les 7 catégories et tous les 26 modules', () => {
    expect(MATERIALS_CATALOG.length).toBeGreaterThanOrEqual(22);
    const categories = new Set(MATERIALS_CATALOG.map((m) => m.category));
    expect(categories.size).toBe(7);
    expect(getMaterialById('inexistant').id).toBe('blanc-alpin');

    expect(MODULE_CATALOG).toHaveLength(37);
    expect(Object.keys(MODULE_CATALOG_BY_TYPE)).toHaveLength(37);
    for (const entry of MODULE_CATALOG) {
      expect(FR.moduleNames[entry.type]).toBeTruthy();
      expect(entry.defaultWidthMm).toBeGreaterThan(0);
    }
  });

  it('valide la géométrie et les matériaux des modèles Cuisine en L et Dressing sur-mesure', () => {
    const templates = [createCuisineEnLTemplate(), createDressingSurMesureTemplate()];

    for (const tpl of templates) {
      expect(tpl.walls.length).toBeGreaterThan(0);
      expect(tpl.modules.length).toBeGreaterThan(0);
      expect(MATERIALS_BY_ID[tpl.floorMaterialId]).toBeDefined();
      for (const wall of tpl.walls) {
        expect(wall.thicknessMm).toBeGreaterThan(0);
        expect(wall.heightMm).toBeGreaterThan(0);
        expect(MATERIALS_BY_ID[wall.materialId]).toBeDefined();
      }
      for (const mod of tpl.modules) {
        expect(mod.widthMm).toBeGreaterThan(0);
        expect(mod.heightMm).toBeGreaterThan(0);
        expect(mod.depthMm).toBeGreaterThan(0);
      }

      const roundTrip = parseAndValidateProjectJson(serializeProjectToJson(tpl));
      expect(roundTrip.ok).toBe(true);
    }
  });
});

describe('M1 — Store Zustand + Zundo Undo/Redo & isolation UI', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceDocument(createCuisineEnLTemplate(), {
      clearHistory: true,
    });
  });

  it('gère les murs avec suppression en cascade des ouvertures et historique Annuler/Rétablir', () => {
    const store = useProjectStore.getState();
    const initialWallCount = store.document.walls.length;

    const wallId = store.addWall({
      labelFr: 'Cloison test',
      startMm: [500, 500],
      endMm: [2500, 500],
      thicknessMm: 100,
      heightMm: 2500,
      materialId: 'peinture-blanc-casse',
    });

    const openingId = store.addOpening({
      wallId,
      kind: 'porte',
      offsetFromStartMm: 400,
      widthMm: 830,
      heightMm: 2040,
      sillHeightMm: 0,
    });

    expect(useProjectStore.getState().document.walls).toHaveLength(initialWallCount + 1);
    expect(useProjectStore.getState().document.openings.some((o) => o.id === openingId)).toBe(true);

    store.updateWall(wallId, { thicknessMm: 140 });
    expect(
      useProjectStore.getState().document.walls.find((w) => w.id === wallId)?.thicknessMm
    ).toBe(140);

    store.removeWall(wallId);
    expect(useProjectStore.getState().document.walls).toHaveLength(initialWallCount);
    expect(useProjectStore.getState().document.openings.some((o) => o.id === openingId)).toBe(
      false
    );

    // Undo removeWall restores wall + opening
    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().document.walls).toHaveLength(initialWallCount + 1);
    expect(useProjectStore.getState().document.openings.some((o) => o.id === openingId)).toBe(true);

    // Redo removeWall deletes them again
    useProjectStore.temporal.getState().redo();
    expect(useProjectStore.getState().document.walls).toHaveLength(initialWallCount);
    expect(useProjectStore.getState().document.openings.some((o) => o.id === openingId)).toBe(
      false
    );
  });

  it('regroupe moveModulesBatch en une seule entrée historique et respecte la limite de 50 états', () => {
    const store = useProjectStore.getState();
    const m1 = store.document.modules[0];
    const m2 = store.document.modules[1];
    const pastBefore = useProjectStore.temporal.getState().pastStates.length;

    store.moveModulesBatch([
      { id: m1.id, xMm: m1.xMm + 100, zMm: m1.zMm },
      { id: m2.id, xMm: m2.xMm + 100, zMm: m2.zMm },
    ]);

    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore + 1);
    expect(useProjectStore.getState().document.modules[0].xMm).toBe(m1.xMm + 100);
    expect(useProjectStore.getState().document.modules[1].xMm).toBe(m2.xMm + 100);

    useProjectStore.temporal.getState().undo();
    expect(useProjectStore.getState().document.modules[0].xMm).toBe(m1.xMm);
    expect(useProjectStore.getState().document.modules[1].xMm).toBe(m2.xMm);

    // Pause / resume skips transient updates
    pauseHistory();
    store.updateModule(m1.id, { widthMm: 750 });
    resumeHistory();
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore);

    // History cap = 50
    for (let i = 0; i < 65; i++) {
      store.updateModule(m1.id, { xMm: 400 + i });
    }
    expect(useProjectStore.temporal.getState().pastStates.length).toBeLessThanOrEqual(50);
  });

  it("n'enregistre jamais les changements d'état UI dans la pile Annuler/Rétablir", () => {
    const pastBefore = useProjectStore.temporal.getState().pastStates.length;

    const ui = useUIStore.getState();
    ui.setViewMode('view3d');
    ui.setActiveWorkspaceTab('devis');
    ui.setDisplayUnit('cm');
    ui.selectEntity('mod-c-01', 'module');
    ui.setCameraMode('walkthrough');
    ui.setLightingPreset('nuit');
    ui.toggleLed();
    ui.toggleOpenAll();
    ui.toggleModuleOpen('mod-c-01');

    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore);
    expect(useUIStore.getState().viewMode).toBe('view3d');
    expect(useUIStore.getState().displayUnit).toBe('cm');
    expect(useUIStore.getState().openModuleIds['mod-c-01']).toBe(false);
  });

  it('charge le modèle dressing_sur_mesure et réinitialise proprement', () => {
    useProjectStore.getState().loadTemplate('dressing_sur_mesure');
    expect(useProjectStore.getState().document.name).toBe('Dressing sur-mesure');
    expect(useProjectStore.getState().document.modules.length).toBe(5);
  });
});

describe('M1 — Sérialisation JSON, Persistance & Miniatures', () => {
  beforeEach(() => {
    resetInMemoryProjectStore();
  });

  it('rejette les fichiers JSON invalides ou corrompus avec des messages en français', () => {
    const badSyntax = parseAndValidateProjectJson('{invalid');
    expect(badSyntax.ok).toBe(false);
    if (!badSyntax.ok) expect(badSyntax.errorFr).toBe(FR.validation.invalidJson);

    const wrongApp = parseAndValidateProjectJson(
      JSON.stringify({ schemaVersion: 2, app: 'AutreApp', document: {} })
    );
    expect(wrongApp.ok).toBe(false);

    const tpl = createCuisineEnLTemplate();
    tpl.modules[0].widthMm = -100;
    const negativeDim = parseAndValidateProjectJson(serializeProjectToJson(tpl));
    expect(negativeDim.ok).toBe(false);

    const tplUnknownMat = createCuisineEnLTemplate();
    tplUnknownMat.walls[0].materialId = 'materiau-introuvable';
    const unknownMat = parseAndValidateProjectJson(serializeProjectToJson(tplUnknownMat));
    expect(unknownMat.ok).toBe(false);
    if (!unknownMat.ok) expect(unknownMat.errorFr).toContain('materiau-introuvable');
  });

  it('effectue le CRUD complet de projets et génère des miniatures non vides en happy-dom', async () => {
    const initial = await loadInitialProject();
    expect(initial.walls.length).toBeGreaterThan(0);
    expect(initial.modules.length).toBeGreaterThan(0);

    const seeded = await ensureStarterProjects();
    expect(seeded.length).toBe(2);

    const thumb = generateThumbnailDataUrl(initial);
    expect(thumb.startsWith('data:image/')).toBe(true);
    expect(thumb.length).toBeGreaterThan(40);

    const saved = await saveProject({ ...initial, id: 'proj-test-1', name: 'Cuisine Test' });
    expect((await getProject('proj-test-1'))?.name).toBe('Cuisine Test');

    const dup = await duplicateProject(saved.id);
    expect(dup).not.toBeNull();
    expect(dup?.name).toBe('Cuisine Test (Copie)');

    const renamed = await renameProject(saved.id, 'Cuisine Rénovée');
    expect(renamed?.name).toBe('Cuisine Rénovée');

    await deleteProject(saved.id);
    expect(await getProject(saved.id)).toBeNull();
    expect((await listProjects()).length).toBe(3);
  });

  it('charge et enregistre la police UTF-8 française DejaVuSans dans jsPDF hors-ligne', async () => {
    const doc = new jsPDF();
    const fontFamily = await registerFrenchPdfFont(doc);
    expect(fontFamily).toBe(PDF_FONT_FAMILY);

    doc.text('Étagère chêne — 1 250,00 MAD € œ', 15, 20);
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    doc.text('Fiche de débit & Calepinage', 15, 30);

    const output = doc.output('arraybuffer');
    expect(output.byteLength).toBeGreaterThan(10_000);
  });
});

describe('M1 — Régression durcissement validation, géométrie et -0', () => {
  beforeEach(() => {
    useProjectStore.getState().replaceDocument(createCuisineEnLTemplate(), {
      clearHistory: true,
    });
  });

  it('bloque les clés de prototype sur MATERIALS_BY_ID, getMaterialById et JSON import', () => {
    for (const protoKey of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(isValidMaterialId(protoKey)).toBe(false);
      expect(MATERIALS_BY_ID[protoKey]).toBeUndefined();
      expect(getMaterialById(protoKey).id).toBe('blanc-alpin');
    }

    const badFloor = createCuisineEnLTemplate();
    badFloor.floorMaterialId = 'toString';
    expect(parseAndValidateProjectJson(serializeProjectToJson(badFloor)).ok).toBe(false);

    const badWall = createCuisineEnLTemplate();
    badWall.walls[0].materialId = 'constructor';
    expect(parseAndValidateProjectJson(serializeProjectToJson(badWall)).ok).toBe(false);

    const badOverride = createCuisineEnLTemplate();
    badOverride.modules[0].overrides = { facadeMaterialId: 'valueOf' };
    expect(parseAndValidateProjectJson(serializeProjectToJson(badOverride)).ok).toBe(false);
  });

  it('valide les overrides de modules, champs de tarification, horodatages et intégrité référentielle', () => {
    // 1. Invalid mod.overrides
    const badBoard = createCuisineEnLTemplate();
    (badBoard.modules[0] as unknown as Record<string, unknown>).overrides = { boardThickness: 17 };
    expect(parseAndValidateProjectJson(serializeProjectToJson(badBoard)).ok).toBe(false);

    const badMount = createCuisineEnLTemplate();
    (badMount.modules[0] as unknown as Record<string, unknown>).overrides = {
      backMountType: 'colle',
    };
    expect(parseAndValidateProjectJson(serializeProjectToJson(badMount)).ok).toBe(false);

    const badGap = createCuisineEnLTemplate();
    badGap.modules[0].overrides = { facadeGapMm: -2 };
    expect(parseAndValidateProjectJson(serializeProjectToJson(badGap)).ok).toBe(false);

    // 2. Missing / negative pricing maps & company/client/validity
    const missingEb = createCuisineEnLTemplate();
    delete (missingEb.pricing as unknown as Record<string, unknown>).edgeBandingPricesPerMeter;
    expect(parseAndValidateProjectJson(serializeProjectToJson(missingEb)).ok).toBe(false);

    const missingHw = createCuisineEnLTemplate();
    delete (missingHw.pricing as unknown as Record<string, unknown>).hardwareUnitPrices;
    expect(parseAndValidateProjectJson(serializeProjectToJson(missingHw)).ok).toBe(false);

    const negHw = createCuisineEnLTemplate();
    negHw.pricing.hardwareUnitPrices.charniere = -50;
    expect(parseAndValidateProjectJson(serializeProjectToJson(negHw)).ok).toBe(false);

    const negMatOverride = createCuisineEnLTemplate();
    negMatOverride.pricing.materialPriceOverrides['chene-naturel'] = -10;
    expect(parseAndValidateProjectJson(serializeProjectToJson(negMatOverride)).ok).toBe(false);

    const zeroValidity = createCuisineEnLTemplate();
    zeroValidity.pricing.validityDays = 0;
    expect(parseAndValidateProjectJson(serializeProjectToJson(zeroValidity)).ok).toBe(false);

    const emptyCompany = createCuisineEnLTemplate();
    emptyCompany.pricing.company.name = '   ';
    expect(parseAndValidateProjectJson(serializeProjectToJson(emptyCompany)).ok).toBe(false);

    // 3. Invalid timestamps
    const badDates = createCuisineEnLTemplate();
    badDates.createdAt = 'pas-une-date';
    expect(parseAndValidateProjectJson(serializeProjectToJson(badDates)).ok).toBe(false);

    // 4. Zero-length wall
    const zeroWall = createCuisineEnLTemplate();
    zeroWall.walls[0].startMm = [100, 100];
    zeroWall.walls[0].endMm = [100, 100];
    expect(parseAndValidateProjectJson(serializeProjectToJson(zeroWall)).ok).toBe(false);

    // 5. Duplicate IDs
    const dupWall = createCuisineEnLTemplate();
    dupWall.walls.push({ ...dupWall.walls[0] });
    expect(parseAndValidateProjectJson(serializeProjectToJson(dupWall)).ok).toBe(false);

    const dupMod = createCuisineEnLTemplate();
    dupMod.modules.push({ ...dupMod.modules[0] });
    expect(parseAndValidateProjectJson(serializeProjectToJson(dupMod)).ok).toBe(false);

    const dupOpening = createCuisineEnLTemplate();
    dupOpening.openings.push({ ...dupOpening.openings[0] });
    expect(parseAndValidateProjectJson(serializeProjectToJson(dupOpening)).ok).toBe(false);

    const dupUtil = createCuisineEnLTemplate();
    dupUtil.utilities.push({ ...dupUtil.utilities[0] });
    expect(parseAndValidateProjectJson(serializeProjectToJson(dupUtil)).ok).toBe(false);

    // 6. Non-integer / out-of-range module counts
    const floatDoor = createCuisineEnLTemplate();
    floatDoor.modules[0].doorCount = 1.5;
    expect(parseAndValidateProjectJson(serializeProjectToJson(floatDoor)).ok).toBe(false);

    const tooManyDoors = createCuisineEnLTemplate();
    tooManyDoors.modules[0].doorCount = 7;
    expect(parseAndValidateProjectJson(serializeProjectToJson(tooManyDoors)).ok).toBe(false);

    // 7. Out-of-bounds opening
    const oobOpeningX = createCuisineEnLTemplate();
    oobOpeningX.openings[0].offsetFromStartMm = 999999;
    expect(parseAndValidateProjectJson(serializeProjectToJson(oobOpeningX)).ok).toBe(false);

    const oobOpeningY = createCuisineEnLTemplate();
    oobOpeningY.openings[0].sillHeightMm = 2000;
    oobOpeningY.openings[0].heightMm = 1000;
    expect(parseAndValidateProjectJson(serializeProjectToJson(oobOpeningY)).ok).toBe(false);

    // 8. Dangling optional wall references
    const danglingMod = createCuisineEnLTemplate();
    danglingMod.modules[0].attachedWallId = 'mur-inexistant';
    expect(parseAndValidateProjectJson(serializeProjectToJson(danglingMod)).ok).toBe(false);

    const danglingUtil = createCuisineEnLTemplate();
    danglingUtil.utilities[0].wallId = 'mur-inexistant';
    expect(parseAndValidateProjectJson(serializeProjectToJson(danglingUtil)).ok).toBe(false);
  });

  it('normalise -0 vers +0 dans roundMm, parseDim, formatDim, roundCurrency et formatCurrency', () => {
    expect(Object.is(roundMm(-0.01, 1), 0)).toBe(true);
    expect(Object.is(parseDim('-0', 'mm'), 0)).toBe(true);
    expect(Object.is(roundCurrency(-0.001), 0)).toBe(true);
    expect(Object.is(convertCurrency(-0.001, 'MAD', 'EUR'), 0)).toBe(true);

    expect(normalizeSpaces(formatDim(-0.01, 'mm'))).toBe('0 mm');
    expect(normalizeSpaces(formatDim(-0.01, 'cm'))).toBe('0 cm');
    expect(normalizeSpaces(formatCurrency(-0.001, 'MAD'))).toBe('0,00 MAD');
    expect(normalizeSpaces(formatCurrency(-0.001, 'EUR'))).toBe('0,00 €');
  });

  it('ne crée pas de snapshot Undo sur un moveModulesBatch sans effet', () => {
    const store = useProjectStore.getState();
    const pastBefore = useProjectStore.temporal.getState().pastStates.length;

    store.moveModulesBatch([]);
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore);

    store.moveModulesBatch([{ id: 'mod-inexistant', xMm: 100, zMm: 200 }]);
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore);

    const m0 = store.document.modules[0];
    store.moveModulesBatch([
      {
        id: m0.id,
        xMm: m0.xMm,
        yMm: m0.yMm,
        zMm: m0.zMm,
        rotationYRad: m0.rotationYRad,
        attachedWallId: m0.attachedWallId,
      },
    ]);
    expect(useProjectStore.temporal.getState().pastStates.length).toBe(pastBefore);
  });

  it('garantit zéro chevauchement AABB 3D entre modules dans Cuisine en L et Dressing sur-mesure', () => {
    const EPS = 1e-6;
    const templates = [createCuisineEnLTemplate(), createDressingSurMesureTemplate()];

    for (const tpl of templates) {
      const boxes = tpl.modules.map((m) => {
        const c = Math.abs(Math.cos(m.rotationYRad));
        const s = Math.abs(Math.sin(m.rotationYRad));
        const halfX = (c * m.widthMm + s * m.depthMm) / 2;
        const halfZ = (s * m.widthMm + c * m.depthMm) / 2;
        return {
          ref: m.ref,
          minX: m.xMm - halfX,
          maxX: m.xMm + halfX,
          minY: m.yMm,
          maxY: m.yMm + m.heightMm,
          minZ: m.zMm - halfZ,
          maxZ: m.zMm + halfZ,
        };
      });

      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
          const oy = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
          const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
          const overlaps = ox > EPS && oy > EPS && oz > EPS;
          expect(overlaps, `${tpl.name}: ${a.ref} chevauche ${b.ref}`).toBe(false);
        }
      }
    }
  });
});
