import type {
  ProjectDocument,
  SceneProp,
  ScenePropCatalogEntry,
  ScenePropCategory,
  ScenePropType,
  TvSizeInches,
} from '@/types';
import {
  analyzeWalls,
  computeRoomBounds,
  findSafeRoomInteriorPoint,
  normalToRotationYRad,
} from '@/engine/geometry';

export const TV_SIZE_PRESETS_MM: Record<
  TvSizeInches,
  { labelFr: string; widthMm: number; heightMm: number }
> = {
  43: { labelFr: '43"', widthMm: 965, heightMm: 560 },
  55: { labelFr: '55"', widthMm: 1230, heightMm: 710 },
  65: { labelFr: '65"', widthMm: 1450, heightMm: 835 },
  75: { labelFr: '75"', widthMm: 1675, heightMm: 960 },
};

export const PROP_CATEGORIES: ScenePropCategory[] = [
  'electromenager',
  'salon_multimedia',
  'eclairage_deco',
];

export const PROPS_CATALOG: ScenePropCatalogEntry[] = [
  // Électroménager (Cuisine)
  {
    type: 'refrigerateur',
    category: 'electromenager',
    nameFr: 'Réfrigérateur combiné',
    descriptionFr: 'Réfrigérateur 2 portes finition inox brossé ou noir mat.',
    defaultWidthMm: 600,
    defaultHeightMm: 1900,
    defaultDepthMm: 650,
    defaultYMm: 0,
    defaultColorHex: '#c8cdd3',
    defaultFinish: 'inox',
    placementKind: 'floor',
  },
  {
    type: 'refrigerateur_americain',
    category: 'electromenager',
    nameFr: 'Réfrigérateur Américain',
    descriptionFr: 'Side-by-Side double porte avec distributeur eau/glaçons.',
    defaultWidthMm: 910,
    defaultHeightMm: 1790,
    defaultDepthMm: 720,
    defaultYMm: 0,
    defaultColorHex: '#bfc5cc',
    defaultFinish: 'inox',
    placementKind: 'floor',
  },
  {
    type: 'plaque_cuisson',
    category: 'electromenager',
    nameFr: 'Plaque induction 4 feux',
    descriptionFr: 'Table vitrocéramique noire à poser sur plan de travail.',
    defaultWidthMm: 600,
    defaultHeightMm: 45,
    defaultDepthMm: 520,
    defaultYMm: 898,
    defaultColorHex: '#15181e',
    defaultFinish: 'noir_mat',
    placementKind: 'countertop',
  },
  {
    type: 'hotte_aspirante',
    category: 'electromenager',
    nameFr: 'Hotte aspirante',
    descriptionFr: 'Hotte décorative murale ou îlot avec éclairage LED.',
    defaultWidthMm: 900,
    defaultHeightMm: 620,
    defaultDepthMm: 480,
    defaultYMm: 1580,
    defaultColorHex: '#cfd4da',
    defaultFinish: 'inox',
    placementKind: 'wall',
    supportsLight: true,
    supportsHoodMount: true,
  },
  {
    type: 'evier_mitigeur',
    category: 'electromenager',
    nameFr: 'Évier + Mitigeur',
    descriptionFr: 'Évier cuve + égouttoir et robinet col de cygne.',
    defaultWidthMm: 800,
    defaultHeightMm: 340,
    defaultDepthMm: 500,
    defaultYMm: 898,
    defaultColorHex: '#d2d6dc',
    defaultFinish: 'inox',
    placementKind: 'countertop',
  },
  {
    type: 'lave_vaisselle',
    category: 'electromenager',
    nameFr: 'Lave-vaisselle',
    descriptionFr: 'Lave-vaisselle 60 cm avec bandeau de commande inox/noir.',
    defaultWidthMm: 600,
    defaultHeightMm: 850,
    defaultDepthMm: 600,
    defaultYMm: 0,
    defaultColorHex: '#cfd4da',
    defaultFinish: 'inox',
    placementKind: 'floor',
  },
  {
    type: 'machine_laver',
    category: 'electromenager',
    nameFr: 'Machine à laver (Lave-linge)',
    descriptionFr: 'Lave-linge frontal hublot 60 cm avec bac lessive et tambour vitré.',
    defaultWidthMm: 600,
    defaultHeightMm: 850,
    defaultDepthMm: 580,
    defaultYMm: 0,
    defaultColorHex: '#f1f3f5',
    defaultFinish: 'blanc',
    placementKind: 'floor',
  },
  {
    type: 'seche_linge',
    category: 'electromenager',
    nameFr: 'Sèche-linge',
    descriptionFr: 'Sèche-linge hublot fumé 60 cm assorti au lave-linge.',
    defaultWidthMm: 600,
    defaultHeightMm: 850,
    defaultDepthMm: 580,
    defaultYMm: 0,
    defaultColorHex: '#f1f3f5',
    defaultFinish: 'blanc',
    placementKind: 'floor',
  },
  {
    type: 'four_encastrable',
    category: 'electromenager',
    nameFr: 'Four encastrable',
    descriptionFr: 'Four multifonction façade verre noir & bandeau inox.',
    defaultWidthMm: 595,
    defaultHeightMm: 595,
    defaultDepthMm: 560,
    defaultYMm: 860,
    defaultColorHex: '#1f232b',
    defaultFinish: 'noir_mat',
    placementKind: 'wall',
  },
  {
    type: 'micro_ondes',
    category: 'electromenager',
    nameFr: 'Micro-ondes encastrable',
    descriptionFr: 'Micro-ondes encastrable en niche colonne ou posable sur plan.',
    defaultWidthMm: 595,
    defaultHeightMm: 385,
    defaultDepthMm: 420,
    defaultYMm: 1465,
    defaultColorHex: '#1f232b',
    defaultFinish: 'noir_mat',
    placementKind: 'wall',
  },
  {
    type: 'machine_cafe',
    category: 'electromenager',
    nameFr: 'Machine à café expresso',
    descriptionFr: 'Machine expresso inox & noir avec tasses à poser sur le plan de travail.',
    defaultWidthMm: 280,
    defaultHeightMm: 350,
    defaultDepthMm: 320,
    defaultYMm: 898,
    defaultColorHex: '#cfd4da',
    defaultFinish: 'inox',
    placementKind: 'countertop',
  },
  {
    type: 'bouilloire_grille_pain',
    category: 'electromenager',
    nameFr: 'Set Petit-Déjeuner (Bouilloire + Toaster)',
    descriptionFr: 'Ensemble bouilloire électrique et grille-pain design sur plan de travail.',
    defaultWidthMm: 440,
    defaultHeightMm: 250,
    defaultDepthMm: 220,
    defaultYMm: 898,
    defaultColorHex: '#d4d8de',
    defaultFinish: 'inox',
    placementKind: 'countertop',
  },
  {
    type: 'chauffe_eau',
    category: 'electromenager',
    nameFr: 'Chauffe-eau / Chaudière murale',
    descriptionFr: 'Chauffe-eau mural compact avec raccordements eau & prise automatiques.',
    defaultWidthMm: 420,
    defaultHeightMm: 720,
    defaultDepthMm: 300,
    defaultYMm: 1450,
    defaultColorHex: '#f3f4f6',
    defaultFinish: 'blanc',
    placementKind: 'wall',
  },

  // Salon & Multimédia
  {
    type: 'tele_ecran_plat',
    category: 'salon_multimedia',
    nameFr: 'Téléviseur écran plat',
    descriptionFr: 'TV 4K ultra-fine (43" à 75"), murale ou sur pied.',
    defaultWidthMm: 1230,
    defaultHeightMm: 710,
    defaultDepthMm: 65,
    defaultYMm: 1050,
    defaultColorHex: '#161920',
    defaultFinish: 'noir_mat',
    placementKind: 'wall',
    supportsTvSize: true,
  },
  {
    type: 'tabouret_bar',
    category: 'salon_multimedia',
    nameFr: 'Tabouret de bar',
    descriptionFr: 'Tabouret haut pour îlot central, piètement métal fin.',
    defaultWidthMm: 430,
    defaultHeightMm: 880,
    defaultDepthMm: 450,
    defaultYMm: 0,
    defaultColorHex: '#b89b78',
    defaultFinish: 'tissu',
    placementKind: 'freestanding',
  },
  {
    type: 'table_repas',
    category: 'salon_multimedia',
    nameFr: 'Table à manger',
    descriptionFr: 'Table contemporaine plateau chêne & pieds fuselés.',
    defaultWidthMm: 1600,
    defaultHeightMm: 750,
    defaultDepthMm: 900,
    defaultYMm: 0,
    defaultColorHex: '#c79e6e',
    defaultFinish: 'bois',
    placementKind: 'freestanding',
  },
  {
    type: 'chaise_moderne',
    category: 'salon_multimedia',
    nameFr: 'Chaise moderne',
    descriptionFr: 'Chaise coque ergonomique assise rembourrée.',
    defaultWidthMm: 480,
    defaultHeightMm: 820,
    defaultDepthMm: 520,
    defaultYMm: 0,
    defaultColorHex: '#d9d2c5',
    defaultFinish: 'tissu',
    placementKind: 'freestanding',
  },
  {
    type: 'canape_moderne',
    category: 'salon_multimedia',
    nameFr: 'Canapé moderne',
    descriptionFr: 'Canapé 3 places contemporain aux lignes épurées.',
    defaultWidthMm: 2150,
    defaultHeightMm: 800,
    defaultDepthMm: 920,
    defaultYMm: 0,
    defaultColorHex: '#c8c0b4',
    defaultFinish: 'tissu',
    placementKind: 'freestanding',
  },

  // Éclairage & Déco
  {
    type: 'suspension_lustre',
    category: 'eclairage_deco',
    nameFr: 'Suspension / Lustre',
    descriptionFr: 'Luminaire suspendu design avec ampoule chaude active.',
    defaultWidthMm: 420,
    defaultHeightMm: 620,
    defaultDepthMm: 420,
    defaultYMm: 1820,
    defaultColorHex: '#22262e',
    defaultFinish: 'laiton',
    placementKind: 'ceiling',
    supportsLight: true,
  },
  {
    type: 'applique_murale',
    category: 'eclairage_deco',
    nameFr: 'Applique murale',
    descriptionFr: 'Applique architecturale éclairage haut et bas.',
    defaultWidthMm: 140,
    defaultHeightMm: 280,
    defaultDepthMm: 115,
    defaultYMm: 1680,
    defaultColorHex: '#c9a66b',
    defaultFinish: 'laiton',
    placementKind: 'wall',
    supportsLight: true,
  },
  {
    type: 'lampadaire_pied',
    category: 'eclairage_deco',
    nameFr: 'Lampadaire sur pied',
    descriptionFr: 'Lampadaire moderne abat-jour tissu et lumière chaude.',
    defaultWidthMm: 380,
    defaultHeightMm: 1680,
    defaultDepthMm: 380,
    defaultYMm: 0,
    defaultColorHex: '#efe9dd',
    defaultFinish: 'laiton',
    placementKind: 'freestanding',
    supportsLight: true,
  },
  {
    type: 'plante_pot',
    category: 'eclairage_deco',
    nameFr: 'Plante verte en pot',
    descriptionFr: 'Plante d’intérieur feuillage naturel dans pot céramique.',
    defaultWidthMm: 420,
    defaultHeightMm: 1180,
    defaultDepthMm: 420,
    defaultYMm: 0,
    defaultColorHex: '#e6e1d8',
    defaultFinish: 'blanc',
    placementKind: 'freestanding',
  },
  {
    type: 'tapis_deco',
    category: 'eclairage_deco',
    nameFr: 'Tapis décoratif',
    descriptionFr: 'Tapis tissé doux pour structurer l’espace salon ou repas.',
    defaultWidthMm: 2200,
    defaultHeightMm: 14,
    defaultDepthMm: 1600,
    defaultYMm: 0,
    defaultColorHex: '#ded6c8',
    defaultFinish: 'tissu',
    placementKind: 'freestanding',
  },
  {
    type: 'tableau_mural',
    category: 'eclairage_deco',
    nameFr: 'Tableau / Cadre mural',
    descriptionFr: 'Cadre décoratif architectural avec passe-partout et toile moderne.',
    defaultWidthMm: 750,
    defaultHeightMm: 950,
    defaultDepthMm: 32,
    defaultYMm: 1220,
    defaultColorHex: '#23272f',
    defaultFinish: 'bois',
    placementKind: 'wall',
  },
  {
    type: 'etagere_murale',
    category: 'eclairage_deco',
    nameFr: 'Étagère murale déco',
    descriptionFr: 'Tablette flottante en bois avec livres et vases décoratifs.',
    defaultWidthMm: 900,
    defaultHeightMm: 260,
    defaultDepthMm: 220,
    defaultYMm: 1520,
    defaultColorHex: '#c59c6c',
    defaultFinish: 'bois',
    placementKind: 'wall',
  },
];

export const PROPS_CATALOG_BY_TYPE: Record<ScenePropType, ScenePropCatalogEntry> = Object.fromEntries(
  PROPS_CATALOG.map((entry) => [entry.type, entry])
) as Record<ScenePropType, ScenePropCatalogEntry>;

export function nextPropRef(existingProps: SceneProp[]): string {
  let maxNum = 0;
  for (const p of existingProps) {
    const match = /^E(\d+)$/i.exec(p.ref);
    if (match) {
      maxNum = Math.max(maxNum, Number.parseInt(match[1], 10));
    }
  }
  return `E${String(maxNum + 1).padStart(2, '0')}`;
}

export function findPropSpawnPosition(
  doc: ProjectDocument,
  spec: ScenePropCatalogEntry,
  preferredWallId?: string | null
): { xMm: number; yMm: number; zMm: number; rotationYRad: number; attachedWallId?: string } {
  const existingProps = doc.props ?? [];
  const wallMetrics = analyzeWalls(doc.walls);
  const safeInterior = findSafeRoomInteriorPoint(doc.walls, wallMetrics);

  // Countertop appliances (cooktop / sink): place neatly onto an existing countertop or island if present
  if (spec.placementKind === 'countertop') {
    const worktop =
      doc.modules.find((m) => m.type === 'plan_de_travail') ??
      doc.modules.find((m) => m.type === 'ilot_central') ??
      doc.modules.find((m) => m.type === 'caisson_bas');
    if (worktop) {
      const yTop = worktop.yMm + worktop.heightMm;
      const offsetShift = (existingProps.filter((p) => p.type === spec.type).length % 3) * 260;
      return {
        xMm: Math.round(worktop.xMm + offsetShift),
        yMm: Math.round(yTop),
        zMm: Math.round(worktop.zMm),
        rotationYRad: worktop.rotationYRad,
        attachedWallId: worktop.attachedWallId,
      };
    }
  }

  // Ceiling pendant lamp: center over island or room center, anchored below ceiling
  if (spec.placementKind === 'ceiling') {
    const island = doc.modules.find((m) => m.type === 'ilot_central');
    const yMm = Math.max(1500, doc.ceilingHeightMm - spec.defaultHeightMm);
    const idx = existingProps.filter((p) => p.type === spec.type).length;
    if (island) {
      return {
        xMm: Math.round(island.xMm + (idx === 0 ? 0 : idx % 2 === 1 ? -350 : 350)),
        yMm,
        zMm: Math.round(island.zMm),
        rotationYRad: island.rotationYRad,
      };
    }
    return {
      xMm: Math.round(safeInterior.x + (idx % 3) * 350),
      yMm,
      zMm: Math.round(safeInterior.z),
      rotationYRad: 0,
    };
  }

  // Freestanding furniture/decor (stool, table, sofa, floor lamp, plant, rug)
  if (spec.placementKind === 'freestanding') {
    const island = doc.modules.find((m) => m.type === 'ilot_central');
    const count = existingProps.filter((p) => p.type === spec.type).length;
    if (spec.type === 'tabouret_bar' && island) {
      const dx = (count - 1) * 520;
      return {
        xMm: Math.round(island.xMm + dx),
        yMm: 0,
        zMm: Math.round(island.zMm + island.depthMm / 2 + 240),
        rotationYRad: Math.PI,
      };
    }
    const shiftX = ((count % 3) - 1) * 380;
    const shiftZ = Math.floor(count / 3) * 380;
    return {
      xMm: Math.round(safeInterior.x + shiftX),
      yMm: spec.defaultYMm,
      zMm: Math.round(safeInterior.z + shiftZ),
      rotationYRad: 0,
    };
  }

  // Wall-mounted or floor-standing appliances snapped cleanly inside the room against a wall
  if (wallMetrics.length > 0) {
    const ordered = [...wallMetrics];
    if (preferredWallId) {
      ordered.sort((a, b) =>
        a.wall.id === preferredWallId ? -1 : b.wall.id === preferredWallId ? 1 : 0
      );
    }
    const wm = ordered.find((w) => w.lengthMm >= spec.defaultWidthMm + 200) ?? ordered[0];
    const u = Math.max(
      spec.defaultWidthMm / 2 + 120,
      Math.min(
        wm.lengthMm - spec.defaultWidthMm / 2 - 120,
        wm.lengthMm * 0.5 + (existingProps.length % 3 - 1) * 450
      )
    );
    const offset = wm.wall.thicknessMm / 2 + spec.defaultDepthMm / 2 + (spec.placementKind === 'wall' ? 6 : 12);
    return {
      xMm: Math.round(wm.start.x + wm.tangent.x * u + wm.inwardNormal.x * offset),
      yMm: Math.min(Math.max(0, doc.ceilingHeightMm - spec.defaultHeightMm), spec.defaultYMm),
      zMm: Math.round(wm.start.z + wm.tangent.z * u + wm.inwardNormal.z * offset),
      rotationYRad: normalToRotationYRad(wm.inwardNormal),
      attachedWallId: wm.wall.id,
    };
  }

  const bounds = computeRoomBounds(doc.walls, false);
  return {
    xMm: Math.round(bounds.center.x),
    yMm: spec.defaultYMm,
    zMm: Math.round(bounds.center.z),
    rotationYRad: 0,
  };
}
