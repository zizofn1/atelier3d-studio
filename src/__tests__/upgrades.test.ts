import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DRAG_THRESHOLD_PX,
  NO_RAYCAST,
  isDirectFirstHit,
  shouldStartDrag,
} from '@/components/viewport3d/drag3dUtils';
import { DEFAULT_NESTING_CONFIG } from '@/data/defaultPricing';
import {
  FLOOR_COLOR_SWATCHES,
  WALL_COLOR_SWATCHES,
  getMaterialsByCategory,
} from '@/data/materialsCatalog';
import {
  PROPS_CATALOG,
  PROPS_CATALOG_BY_TYPE,
  TV_SIZE_PRESETS_MM,
  findPropSpawnPosition,
} from '@/data/propsCatalog';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { buildCutlist, computeDevisSummary, cutlistToNestingPieces } from '@/engine/devis';
import { runGuillotineNesting } from '@/engine/nesting';
import { getPbrMaterial } from '@/materials/proceduralTextures';
import { parseAndValidateProjectJson, serializeProjectToJson } from '@/persistence/jsonSerializer';
import { useProjectStore } from '@/store/useProjectStore';

describe('Upgrades: Personnalisation surfaces, Drag 3D direct-hit & Catalogue Électro/Déco', () => {
  it('utilise des murs blanc cassé lumineux et sols modernes propres dans les modèles par défaut', () => {
    const cuisine = createCuisineEnLTemplate();
    const dressing = createDressingSurMesureTemplate();

    expect(cuisine.wallColor).toBe('#F3F1EC');
    expect(dressing.wallColor).toBe('#F3F1EC');
    expect(cuisine.walls.every((w) => w.materialId === 'peinture-blanc-casse')).toBe(true);
    expect(dressing.walls.every((w) => w.materialId === 'peinture-blanc-casse')).toBe(true);
    expect(cuisine.floorMaterialId).toBe('carrelage-gres');
    expect(dressing.floorMaterialId).toBe('parquet-chene');

    // Rich wall & floor catalogs + French swatches
    expect(getMaterialsByCategory('mur').length).toBeGreaterThanOrEqual(5);
    expect(getMaterialsByCategory('sol').length).toBeGreaterThanOrEqual(7);
    expect(WALL_COLOR_SWATCHES.length).toBeGreaterThanOrEqual(8);
    expect(FLOOR_COLOR_SWATCHES.length).toBeGreaterThanOrEqual(7);
  });

  it('applique en direct couleurs personnalisées murs (global + accent), sol (zellige/carrelage + joints) et meubles', () => {
    useProjectStore.getState().loadTemplate('cuisine_en_l');
    const store = useProjectStore.getState();

    // Global wall texture + color + per-wall accent override
    store.updateRoomSurfaces({
      allWallsMaterialId: 'zellige-mural',
      wallColor: '#F7F6F2',
      floorMaterialId: 'zellige-marocain',
      floorColorOverride: '#2E6F6D',
      floorGroutColor: '#F2F0EB',
    });
    const firstWallId = useProjectStore.getState().document.walls[0].id;
    store.updateWall(firstWallId, { colorOverride: '#C26D52' });

    // Custom cabinet & countertop HEX colors
    store.updateGlobalCarpentry({
      facadeColorOverride: '#2B4C5E',
      carcassColorOverride: '#F3F1EC',
      countertopColorOverride: '#E7E4DC',
    });

    const doc = useProjectStore.getState().document;
    expect(doc.wallColor).toBe('#F7F6F2');
    expect(doc.walls[0].materialId).toBe('zellige-mural');
    expect(doc.walls[0].colorOverride).toBe('#C26D52');
    expect(doc.floorMaterialId).toBe('zellige-marocain');
    expect(doc.floorColorOverride).toBe('#2E6F6D');
    expect(doc.floorGroutColor).toBe('#F2F0EB');
    expect(doc.defaultCarpentry.facadeColorOverride).toBe('#2B4C5E');

    // PBR material builder supports all custom patterns & HEX overrides without errors
    const zelligeMat = getPbrMaterial('zellige-marocain', 'none', {
      uvInMeters: true,
      colorOverrideHex: '#2E6F6D',
      groutColorHex: '#F2F0EB',
    });
    const wallAccentMat = getPbrMaterial('peinture-blanc-casse', 'none', {
      uvInMeters: true,
      colorOverrideHex: '#C26D52',
    });
    const customFacadeMat = getPbrMaterial('chene-naturel', 'V', {
      colorOverrideHex: '#2B4C5E',
    });
    expect(zelligeMat).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(wallAccentMat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(customFacadeMat.color.getHexString()).toBe('2b4c5e');

    // Clear accent overrides cleanly
    store.updateRoomSurfaces({ clearWallColorOverrides: true });
    expect(useProjectStore.getState().document.walls[0].colorOverride).toBeUndefined();
  });

  it('impose un drag 3D strict direct-hit uniquement (seuil 5 px, jamais à travers mur/sol/vide)', () => {
    const moduleGroup = new THREE.Group();
    const panelMesh = new THREE.Mesh();
    moduleGroup.add(panelMesh);

    const wallMesh = new THREE.Mesh();
    const floorMesh = new THREE.Mesh();
    const otherGroup = new THREE.Group();
    const otherMesh = new THREE.Mesh();
    otherGroup.add(otherMesh);

    // Direct hit on module's own child mesh as closest intersection -> allowed
    expect(isDirectFirstHit([{ object: panelMesh }, { object: wallMesh }], moduleGroup)).toBe(true);

    // Empty space -> forbidden
    expect(isDirectFirstHit([], moduleGroup)).toBe(false);

    // Wall or floor in front of module -> strictly forbidden (cannot drag behind walls/floor!)
    expect(isDirectFirstHit([{ object: wallMesh }, { object: panelMesh }], moduleGroup)).toBe(false);
    expect(isDirectFirstHit([{ object: floorMesh }, { object: panelMesh }], moduleGroup)).toBe(false);

    // Another module in front -> strictly forbidden
    expect(isDirectFirstHit([{ object: otherMesh }, { object: panelMesh }], moduleGroup)).toBe(false);

    // Exact 5 px movement threshold
    expect(DRAG_THRESHOLD_PX).toBe(5);
    expect(shouldStartDrag(100, 100, 103, 103)).toBe(false); // ~4.24 px < 5 px
    expect(shouldStartDrag(100, 100, 104, 103)).toBe(true); // exactly 5.0 px

    // NO_RAYCAST helper never populates hits
    const hits: THREE.Intersection[] = [];
    NO_RAYCAST.call(panelMesh, new THREE.Raycaster(), hits);
    expect(hits).toHaveLength(0);
  });

  it('gère le catalogue Électro & Déco (18 objets, TV 43"-75", persistance JSON) sans polluer la fiche de débit ni le calepinage', () => {
    expect(PROPS_CATALOG).toHaveLength(25);
    expect(Object.keys(TV_SIZE_PRESETS_MM).map(Number)).toEqual([43, 55, 65, 75]);

    const baseDoc = createCuisineEnLTemplate();
    const baseCutlist = buildCutlist(baseDoc);
    const baseNesting = runGuillotineNesting(
      cutlistToNestingPieces(baseCutlist),
      baseDoc.nestingConfig ?? DEFAULT_NESTING_CONFIG
    );
    const baseDevis = computeDevisSummary(baseDoc, baseNesting, baseCutlist);

    useProjectStore.getState().replaceDocument(baseDoc, { clearHistory: true });
    const store = useProjectStore.getState();

    // Place appliances, TV, furniture & lights
    const typesToAdd = [
      'refrigerateur',
      'refrigerateur_americain',
      'plaque_cuisson',
      'hotte_aspirante',
      'evier_mitigeur',
      'lave_vaisselle',
      'four_encastrable',
      'tele_ecran_plat',
      'tabouret_bar',
      'table_repas',
      'chaise_moderne',
      'canape_moderne',
      'suspension_lustre',
      'applique_murale',
      'lampadaire_pied',
      'plante_pot',
      'tapis_deco',
    ] as const;

    for (const t of typesToAdd) {
      const spec = PROPS_CATALOG_BY_TYPE[t];
      const spawn = findPropSpawnPosition(useProjectStore.getState().document, spec);
      store.addProp({
        type: t,
        category: spec.category,
        nameFr: spec.nameFr,
        xMm: spawn.xMm,
        yMm: spawn.yMm,
        zMm: spawn.zMm,
        rotationYRad: spawn.rotationYRad,
        attachedWallId: spawn.attachedWallId,
        widthMm: spec.defaultWidthMm,
        heightMm: spec.defaultHeightMm,
        depthMm: spec.defaultDepthMm,
        colorHex: spec.defaultColorHex,
        finish: spec.defaultFinish,
        lightOn: spec.supportsLight ? true : undefined,
        tvSizeInches: spec.supportsTvSize ? 65 : undefined,
        tvMountMode: spec.supportsTvSize ? 'mural' : undefined,
      });
    }

    const withPropsDoc = useProjectStore.getState().document;
    expect(withPropsDoc.props).toHaveLength(17);

    // Cutlist, 2D Nesting, and Devis wood counts MUST remain 100% unchanged!
    const nextCutlist = buildCutlist(withPropsDoc);
    const nextNesting = runGuillotineNesting(
      cutlistToNestingPieces(nextCutlist),
      withPropsDoc.nestingConfig ?? DEFAULT_NESTING_CONFIG
    );
    const nextDevis = computeDevisSummary(withPropsDoc, nextNesting, nextCutlist);

    expect(nextCutlist).toHaveLength(baseCutlist.length);
    expect(nextNesting.totalSheets).toBe(baseNesting.totalSheets);
    expect(nextDevis.totalTTC).toBe(baseDevis.totalTTC);

    // JSON export/import round-trip preserves all 17 props & custom surface colors
    const json = serializeProjectToJson(withPropsDoc);
    const parsed = parseAndValidateProjectJson(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.document.props).toHaveLength(17);
      expect(parsed.document.wallColor).toBe('#F3F1EC');
    }
  });
});
