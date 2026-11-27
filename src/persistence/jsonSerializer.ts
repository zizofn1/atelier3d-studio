import type { HardwareKind, ModuleType, ProjectDocument, ScenePropType } from '@/types';
import { isValidMaterialId } from '@/data/materialsCatalog';
import { FR } from '@/i18n/fr';

export const MAX_DOOR_COUNT = 6;

export interface ProjectJsonEnvelope {
  schemaVersion: 1;
  app: 'Atelier3D Studio';
  exportedAt: string;
  document: ProjectDocument;
}

export type JsonImportResult =
  | { ok: true; document: ProjectDocument }
  | { ok: false; errorFr: string };

const VALID_PROP_TYPES = new Set<ScenePropType>([
  'refrigerateur',
  'refrigerateur_americain',
  'plaque_cuisson',
  'hotte_aspirante',
  'evier_mitigeur',
  'lave_vaisselle',
  'machine_laver',
  'seche_linge',
  'four_encastrable',
  'micro_ondes',
  'machine_cafe',
  'bouilloire_grille_pain',
  'chauffe_eau',
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
  'tableau_mural',
  'etagere_murale',
]);

const VALID_PROP_CATEGORIES = new Set(['electromenager', 'salon_multimedia', 'eclairage_deco']);

const VALID_MODULE_TYPES = new Set<ModuleType>([
  'caisson_bas',
  'caisson_casserolier',
  'caisson_sous_evier',
  'caisson_haut',
  'meuble_haut_vitre',
  'caisson_haut_angle_aveugle',
  'caisson_sur_frigo',
  'caisson_haut_relevant',
  'colonne',
  'colonne_garde_manger',
  'caisson_angle',
  'caisson_angle_l',
  'caisson_angle_aveugle',
  'caisson_angle_pan_coupe',
  'caisson_haut_angle',
  'caisson_bas_tiroir_porte',
  'caisson_bas_2tiroirs_porte',
  'colonne_mixte_tiroirs_portes',
  'meuble_vitrine',
  'ilot_central',
  'plan_de_travail',
  'credence',
  'plinthe',
  'meuble_vasque',
  'meuble_double_vasque',
  'armoire_miroir_led',
  'colonne_sdb',
  'meuble_buanderie',
  'dressing_penderie',
  'dressing_etagere',
  'dressing_tiroirs',
  'portes_battantes',
  'portes_coulissantes',
  'meuble_tv',
  'bibliotheque',
  'bureau',
  'banc_entree',
]);

const VALID_BOARD_THICKNESS = new Set([16, 18, 19, 22]);
const VALID_BACK_THICKNESS = new Set([5, 8]);
const VALID_BACK_MOUNT = new Set(['rainure', 'applique']);
const VALID_HANDLE_STYLE = new Set(['bar', 'knob', 'gorge', 'push']);
const VALID_GRAIN_DIRECTIONS = new Set(['H', 'V', 'none']);
const VALID_CURRENCIES = new Set(['MAD', 'EUR', 'USD']);
const VALID_OPENING_KINDS = new Set(['porte', 'fenetre']);
const VALID_UTILITY_KINDS = new Set(['poteau', 'poutre', 'prise', 'arrivee_eau']);

const HARDWARE_KINDS: readonly HardwareKind[] = [
  'charniere',
  'coulisse',
  'poignee',
  'bouton',
  'profil_gorge',
  'push_open',
  'pied_reglable',
  'verin',
  'taquet',
  'suspension_murale',
  'kit_coulissant',
  'tringle',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeNumber(value) && Number.isInteger(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function isPoint2D(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1])
  );
}

export function serializeProjectToJson(doc: ProjectDocument): string {
  const envelope: ProjectJsonEnvelope = {
    schemaVersion: 1,
    app: 'Atelier3D Studio',
    exportedAt: new Date().toISOString(),
    document: doc,
  };
  return JSON.stringify(envelope, null, 2);
}

export function parseAndValidateProjectJson(rawJson: string): JsonImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, errorFr: FR.validation.invalidJson };
  }

  if (!isRecord(parsed)) {
    return { ok: false, errorFr: FR.validation.invalidEnvelope };
  }

  if (
    parsed.schemaVersion !== 1 ||
    parsed.app !== 'Atelier3D Studio' ||
    !isRecord(parsed.document)
  ) {
    return { ok: false, errorFr: FR.validation.invalidEnvelope };
  }

  const doc = parsed.document;

  if (
    !isNonEmptyString(doc.id) ||
    doc.schemaVersion !== 1 ||
    !isNonEmptyString(doc.name) ||
    !isValidDateString(doc.createdAt) ||
    !isValidDateString(doc.updatedAt) ||
    !isNonEmptyString(doc.floorMaterialId) ||
    !Array.isArray(doc.walls) ||
    !Array.isArray(doc.openings) ||
    !Array.isArray(doc.utilities) ||
    !Array.isArray(doc.modules)
  ) {
    return { ok: false, errorFr: FR.validation.missingFields };
  }

  if (!isPositiveNumber(doc.ceilingHeightMm)) {
    return { ok: false, errorFr: FR.validation.invalidCeilingHeight };
  }

  if (!isValidMaterialId(doc.floorMaterialId)) {
    return {
      ok: false,
      errorFr: `${FR.validation.unknownMaterial} ${doc.floorMaterialId}`,
    };
  }

  // Validate defaultCarpentry
  const cp = doc.defaultCarpentry;
  if (
    !isRecord(cp) ||
    !isFiniteNumber(cp.boardThickness) ||
    !VALID_BOARD_THICKNESS.has(cp.boardThickness) ||
    !isFiniteNumber(cp.backThickness) ||
    !VALID_BACK_THICKNESS.has(cp.backThickness) ||
    typeof cp.backMountType !== 'string' ||
    !VALID_BACK_MOUNT.has(cp.backMountType) ||
    !isNonNegativeNumber(cp.facadeGapMm) ||
    !isNonNegativeNumber(cp.plinthHeightMm) ||
    !isNonNegativeNumber(cp.plinthRecessMm) ||
    typeof cp.handleStyle !== 'string' ||
    !VALID_HANDLE_STYLE.has(cp.handleStyle) ||
    !isNonEmptyString(cp.carcassMaterialId) ||
    !isNonEmptyString(cp.facadeMaterialId) ||
    !isNonEmptyString(cp.backMaterialId) ||
    !isNonEmptyString(cp.countertopMaterialId) ||
    !isNonEmptyString(cp.edgeBandingMaterialId)
  ) {
    return { ok: false, errorFr: FR.validation.invalidCarpentry };
  }

  const carpentryMaterialIds = [
    cp.carcassMaterialId,
    cp.facadeMaterialId,
    cp.backMaterialId,
    cp.countertopMaterialId,
    cp.edgeBandingMaterialId,
  ];
  for (const matId of carpentryMaterialIds) {
    if (!isValidMaterialId(matId)) {
      return { ok: false, errorFr: `${FR.validation.unknownMaterial} ${matId}` };
    }
  }

  // Validate walls
  const wallById = new Map<string, { lengthMm: number; heightMm: number }>();
  for (const wall of doc.walls) {
    if (
      !isRecord(wall) ||
      !isNonEmptyString(wall.id) ||
      wallById.has(wall.id) ||
      !isPoint2D(wall.startMm) ||
      !isPoint2D(wall.endMm) ||
      !isPositiveNumber(wall.thicknessMm) ||
      !isPositiveNumber(wall.heightMm) ||
      !isNonEmptyString(wall.materialId)
    ) {
      return { ok: false, errorFr: FR.validation.invalidWall };
    }
    const wallLength = Math.hypot(
      wall.endMm[0] - wall.startMm[0],
      wall.endMm[1] - wall.startMm[1]
    );
    if (!Number.isFinite(wallLength) || wallLength <= 0) {
      return { ok: false, errorFr: FR.validation.invalidWall };
    }
    if (!isValidMaterialId(wall.materialId)) {
      return { ok: false, errorFr: `${FR.validation.unknownMaterial} ${wall.materialId}` };
    }
    wallById.set(wall.id, { lengthMm: wallLength, heightMm: wall.heightMm });
  }

  // Validate openings
  const openingIds = new Set<string>();
  for (const opening of doc.openings) {
    if (
      !isRecord(opening) ||
      !isNonEmptyString(opening.id) ||
      openingIds.has(opening.id) ||
      !isNonEmptyString(opening.wallId) ||
      typeof opening.kind !== 'string' ||
      !VALID_OPENING_KINDS.has(opening.kind) ||
      !isNonNegativeNumber(opening.offsetFromStartMm) ||
      !isPositiveNumber(opening.widthMm) ||
      !isPositiveNumber(opening.heightMm) ||
      !isNonNegativeNumber(opening.sillHeightMm)
    ) {
      return { ok: false, errorFr: FR.validation.invalidOpening };
    }
    const parentWall = wallById.get(opening.wallId);
    if (
      !parentWall ||
      opening.offsetFromStartMm + opening.widthMm > parentWall.lengthMm ||
      opening.sillHeightMm + opening.heightMm > parentWall.heightMm
    ) {
      return { ok: false, errorFr: FR.validation.invalidOpening };
    }
    openingIds.add(opening.id);
  }

  // Validate utilities
  const utilityIds = new Set<string>();
  for (const util of doc.utilities) {
    if (
      !isRecord(util) ||
      !isNonEmptyString(util.id) ||
      utilityIds.has(util.id) ||
      typeof util.kind !== 'string' ||
      !VALID_UTILITY_KINDS.has(util.kind) ||
      !isFiniteNumber(util.xMm) ||
      !isFiniteNumber(util.yMm) ||
      !isFiniteNumber(util.zMm) ||
      !isPositiveNumber(util.widthMm) ||
      !isPositiveNumber(util.depthMm) ||
      !isPositiveNumber(util.heightMm)
    ) {
      return { ok: false, errorFr: FR.validation.invalidUtility };
    }
    if (
      util.wallId !== undefined &&
      (!isNonEmptyString(util.wallId) || !wallById.has(util.wallId))
    ) {
      return { ok: false, errorFr: FR.validation.invalidUtility };
    }
    if (util.linkedEntityId !== undefined && !isNonEmptyString(util.linkedEntityId)) {
      return { ok: false, errorFr: FR.validation.invalidUtility };
    }
    if (
      util.linkedEntityKind !== undefined &&
      util.linkedEntityKind !== 'module' &&
      util.linkedEntityKind !== 'prop'
    ) {
      return { ok: false, errorFr: FR.validation.invalidUtility };
    }
    utilityIds.add(util.id);
  }

  // Validate modules
  const moduleIds = new Set<string>();
  for (const mod of doc.modules) {
    if (
      !isRecord(mod) ||
      !isNonEmptyString(mod.id) ||
      moduleIds.has(mod.id) ||
      !isNonEmptyString(mod.ref) ||
      typeof mod.type !== 'string' ||
      !VALID_MODULE_TYPES.has(mod.type as ModuleType) ||
      !isNonEmptyString(mod.nameFr) ||
      !isFiniteNumber(mod.xMm) ||
      !isFiniteNumber(mod.yMm) ||
      !isFiniteNumber(mod.zMm) ||
      !isFiniteNumber(mod.rotationYRad) ||
      !isPositiveNumber(mod.widthMm) ||
      !isPositiveNumber(mod.heightMm) ||
      !isPositiveNumber(mod.depthMm) ||
      !isNonNegativeInteger(mod.doorCount) ||
      mod.doorCount > MAX_DOOR_COUNT ||
      !isNonNegativeInteger(mod.drawerCount) ||
      !isNonNegativeInteger(mod.shelfCount)
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (
      mod.attachedWallId !== undefined &&
      (!isNonEmptyString(mod.attachedWallId) || !wallById.has(mod.attachedWallId))
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (mod.columnCount !== undefined && !isNonNegativeInteger(mod.columnCount)) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (mod.overhangMm !== undefined && !isNonNegativeNumber(mod.overhangMm)) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (
      mod.grainDirection !== undefined &&
      (typeof mod.grainDirection !== 'string' || !VALID_GRAIN_DIRECTIONS.has(mod.grainDirection))
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (
      mod.cornerKind !== undefined &&
      mod.cornerKind !== 'en_l' &&
      mod.cornerKind !== 'aveugle'
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (
      mod.blindSide !== undefined &&
      mod.blindSide !== 'left' &&
      mod.blindSide !== 'right'
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }
    if (
      mod.colonneVariant !== undefined &&
      mod.colonneVariant !== 'four' &&
      mod.colonneVariant !== 'refrigerateur' &&
      mod.colonneVariant !== 'rangement'
    ) {
      return { ok: false, errorFr: FR.validation.invalidModule };
    }

    if (mod.overrides !== undefined) {
      if (!isRecord(mod.overrides)) {
        return { ok: false, errorFr: FR.validation.invalidCarpentry };
      }
      const ov = mod.overrides;
      if (
        (ov.boardThickness !== undefined &&
          (!isFiniteNumber(ov.boardThickness) || !VALID_BOARD_THICKNESS.has(ov.boardThickness))) ||
        (ov.backThickness !== undefined &&
          (!isFiniteNumber(ov.backThickness) || !VALID_BACK_THICKNESS.has(ov.backThickness))) ||
        (ov.backMountType !== undefined &&
          (typeof ov.backMountType !== 'string' || !VALID_BACK_MOUNT.has(ov.backMountType))) ||
        (ov.handleStyle !== undefined &&
          (typeof ov.handleStyle !== 'string' || !VALID_HANDLE_STYLE.has(ov.handleStyle))) ||
        (ov.facadeGapMm !== undefined && !isNonNegativeNumber(ov.facadeGapMm)) ||
        (ov.plinthHeightMm !== undefined && !isNonNegativeNumber(ov.plinthHeightMm)) ||
        (ov.plinthRecessMm !== undefined && !isNonNegativeNumber(ov.plinthRecessMm))
      ) {
        return { ok: false, errorFr: FR.validation.invalidCarpentry };
      }

      const matKeys = [
        'carcassMaterialId',
        'facadeMaterialId',
        'backMaterialId',
        'countertopMaterialId',
        'edgeBandingMaterialId',
      ] as const;
      for (const k of matKeys) {
        const val = ov[k];
        if (val !== undefined) {
          if (typeof val !== 'string' || !isValidMaterialId(val)) {
            return {
              ok: false,
              errorFr: `${FR.validation.unknownMaterial} ${String(val)}`,
            };
          }
        }
      }
    }

    moduleIds.add(mod.id);
  }

  // Validate pricing
  const pricing = doc.pricing;
  if (
    !isRecord(pricing) ||
    typeof pricing.currency !== 'string' ||
    !VALID_CURRENCIES.has(pricing.currency) ||
    !isNonNegativeNumber(pricing.laborPercent) ||
    !isNonNegativeNumber(pricing.marginPercent) ||
    !isNonNegativeNumber(pricing.tvaPercent) ||
    !isNonEmptyString(pricing.quoteReference) ||
    !isPositiveNumber(pricing.validityDays) ||
    (pricing.notesFr !== undefined && typeof pricing.notesFr !== 'string')
  ) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }

  if (!isRecord(pricing.materialPriceOverrides)) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }
  for (const val of Object.values(pricing.materialPriceOverrides)) {
    if (!isNonNegativeNumber(val)) {
      return { ok: false, errorFr: FR.validation.invalidPricing };
    }
  }

  const ebPrices = pricing.edgeBandingPricesPerMeter;
  if (
    !isRecord(ebPrices) ||
    !Object.hasOwn(ebPrices, '0.4') ||
    !isNonNegativeNumber(ebPrices['0.4']) ||
    !Object.hasOwn(ebPrices, '2') ||
    !isNonNegativeNumber(ebPrices['2'])
  ) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }

  const hwPrices = pricing.hardwareUnitPrices;
  if (!isRecord(hwPrices)) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }
  for (const kind of HARDWARE_KINDS) {
    if (!Object.hasOwn(hwPrices, kind) || !isNonNegativeNumber(hwPrices[kind])) {
      return { ok: false, errorFr: FR.validation.invalidPricing };
    }
  }

  const company = pricing.company;
  if (
    !isRecord(company) ||
    !isNonEmptyString(company.name) ||
    typeof company.address !== 'string' ||
    typeof company.phone !== 'string' ||
    typeof company.email !== 'string' ||
    typeof company.taxId !== 'string'
  ) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }

  const client = pricing.client;
  if (
    !isRecord(client) ||
    !isNonEmptyString(client.name) ||
    typeof client.address !== 'string' ||
    typeof client.phone !== 'string' ||
    typeof client.email !== 'string'
  ) {
    return { ok: false, errorFr: FR.validation.invalidPricing };
  }

  // Validate optional props (Électroménager, Éclairage & Déco)
  if (doc.props !== undefined) {
    if (!Array.isArray(doc.props)) {
      return { ok: false, errorFr: FR.validation.missingFields };
    }
    const propIds = new Set<string>();
    for (const prop of doc.props) {
      if (
        !isRecord(prop) ||
        !isNonEmptyString(prop.id) ||
        propIds.has(prop.id) ||
        !isNonEmptyString(prop.ref) ||
        typeof prop.type !== 'string' ||
        !VALID_PROP_TYPES.has(prop.type as ScenePropType) ||
        typeof prop.category !== 'string' ||
        !VALID_PROP_CATEGORIES.has(prop.category) ||
        !isNonEmptyString(prop.nameFr) ||
        !isFiniteNumber(prop.xMm) ||
        !isFiniteNumber(prop.yMm) ||
        !isFiniteNumber(prop.zMm) ||
        !isFiniteNumber(prop.rotationYRad) ||
        !isPositiveNumber(prop.widthMm) ||
        !isPositiveNumber(prop.heightMm) ||
        !isPositiveNumber(prop.depthMm)
      ) {
        return { ok: false, errorFr: FR.validation.missingFields };
      }
      if (
        prop.attachedWallId !== undefined &&
        (!isNonEmptyString(prop.attachedWallId) || !wallById.has(prop.attachedWallId))
      ) {
        return { ok: false, errorFr: FR.validation.missingFields };
      }
      propIds.add(prop.id);
    }
  }

  // Validate optional nestingConfig
  if (doc.nestingConfig !== undefined) {
    const nc = doc.nestingConfig;
    if (
      !isRecord(nc) ||
      !isRecord(nc.sheet) ||
      !isNonEmptyString(nc.sheet.id) ||
      !isNonEmptyString(nc.sheet.labelFr) ||
      !isPositiveNumber(nc.sheet.widthMm) ||
      !isPositiveNumber(nc.sheet.heightMm) ||
      !isNonNegativeNumber(nc.kerfMm) ||
      !isNonNegativeNumber(nc.trimTopMm) ||
      !isNonNegativeNumber(nc.trimBottomMm) ||
      !isNonNegativeNumber(nc.trimLeftMm) ||
      !isNonNegativeNumber(nc.trimRightMm) ||
      typeof nc.respectGrain !== 'boolean'
    ) {
      return { ok: false, errorFr: FR.validation.missingFields };
    }
  }

  // Validate optional videoStudio configuration (100% backward-compatible when omitted)
  if (doc.videoStudio !== undefined) {
    const vs = doc.videoStudio;
    const isVec3 = (v: unknown): v is [number, number, number] =>
      Array.isArray(v) &&
      v.length === 3 &&
      isFiniteNumber(v[0]) &&
      isFiniteNumber(v[1]) &&
      isFiniteNumber(v[2]);

    if (
      !isRecord(vs) ||
      !isPositiveNumber(vs.durationSec) ||
      !isPositiveNumber(vs.fps) ||
      (vs.aspectRatio !== '16:9' && vs.aspectRatio !== '9:16') ||
      (vs.qualityMode !== 'fast' && vs.qualityMode !== 'studio') ||
      typeof vs.constrainInsideRoom !== 'boolean' ||
      !Array.isArray(vs.keyframes) ||
      !Array.isArray(vs.events) ||
      !isRecord(vs.branding) ||
      typeof vs.branding.enabled !== 'boolean' ||
      typeof vs.branding.showCompanyName !== 'boolean' ||
      typeof vs.branding.showProjectTitle !== 'boolean'
    ) {
      return { ok: false, errorFr: FR.validation.missingFields };
    }

    for (const kf of vs.keyframes) {
      if (
        !isRecord(kf) ||
        !isNonEmptyString(kf.id) ||
        !isNonNegativeNumber(kf.timeSec) ||
        !isVec3(kf.positionMm) ||
        !isVec3(kf.targetMm) ||
        !isPositiveNumber(kf.fovDeg) ||
        (kf.easing !== 'linear' && kf.easing !== 'easeInOut' && kf.easing !== 'easeOut')
      ) {
        return { ok: false, errorFr: FR.validation.missingFields };
      }
    }

    for (const ev of vs.events) {
      if (
        !isRecord(ev) ||
        !isNonEmptyString(ev.id) ||
        !isNonNegativeNumber(ev.startSec) ||
        !isPositiveNumber(ev.durationSec) ||
        (ev.kind !== 'open_doors' &&
          ev.kind !== 'close_doors' &&
          ev.kind !== 'lighting_transition' &&
          ev.kind !== 'assembly_mode')
      ) {
        return { ok: false, errorFr: FR.validation.missingFields };
      }
    }
  }

  // Validate optional ceilingLighting configuration (100% backward-compatible when omitted)
  if (doc.ceilingLighting !== undefined) {
    const cl = doc.ceilingLighting;
    if (
      !isRecord(cl) ||
      !isNonNegativeNumber(cl.spotIntensity) ||
      typeof cl.spotsEnabled !== 'boolean'
    ) {
      return { ok: false, errorFr: FR.validation.missingFields };
    }
    if (cl.spots !== undefined) {
      if (!Array.isArray(cl.spots)) {
        return { ok: false, errorFr: FR.validation.missingFields };
      }
      for (const sp of cl.spots) {
        if (
          !isRecord(sp) ||
          !isNonEmptyString(sp.id) ||
          !isFiniteNumber(sp.xMm) ||
          !isFiniteNumber(sp.zMm) ||
          (sp.intensity !== undefined && !isNonNegativeNumber(sp.intensity)) ||
          (sp.enabled !== undefined && typeof sp.enabled !== 'boolean')
        ) {
          return { ok: false, errorFr: FR.validation.missingFields };
        }
      }
    }
  }

  return {
    ok: true,
    document: doc as unknown as ProjectDocument,
  };
}
