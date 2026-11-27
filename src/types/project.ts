import type { CarpentryParams, ModuleInstance } from './carpentry';
import type { DevisPricingConfig } from './devis';
import type { NestingConfig } from './nesting';
import type { VideoStudioConfig } from './video';

export interface WallSegment {
  id: string;
  labelFr?: string;
  startMm: [number, number];
  endMm: [number, number];
  thicknessMm: number;
  heightMm: number;
  materialId: string;
  colorOverride?: string;
  /** When true, this wall stays full-height even when Murs auto-coupés is enabled. */
  keepVisibleInCutaway?: boolean;
}

export type ScenePropCategory = 'electromenager' | 'salon_multimedia' | 'eclairage_deco';

export type ScenePropType =
  | 'refrigerateur'
  | 'refrigerateur_americain'
  | 'plaque_cuisson'
  | 'hotte_aspirante'
  | 'evier_mitigeur'
  | 'lave_vaisselle'
  | 'machine_laver'
  | 'seche_linge'
  | 'four_encastrable'
  | 'micro_ondes'
  | 'machine_cafe'
  | 'bouilloire_grille_pain'
  | 'chauffe_eau'
  | 'tele_ecran_plat'
  | 'tabouret_bar'
  | 'table_repas'
  | 'chaise_moderne'
  | 'canape_moderne'
  | 'suspension_lustre'
  | 'applique_murale'
  | 'lampadaire_pied'
  | 'plante_pot'
  | 'tapis_deco'
  | 'tableau_mural'
  | 'etagere_murale';

export type TvSizeInches = 43 | 55 | 65 | 75;
export type TvMountMode = 'mural' | 'sur_pied';
export type PropFinishPreset = 'inox' | 'noir_mat' | 'blanc' | 'laiton' | 'bois' | 'tissu';

export interface SceneProp {
  id: string;
  ref: string;
  type: ScenePropType;
  category: ScenePropCategory;
  nameFr: string;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationYRad: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  attachedWallId?: string;
  colorHex?: string;
  finish?: PropFinishPreset;
  lightOn?: boolean;
  lightIntensity?: number;
  tvSizeInches?: TvSizeInches;
  tvMountMode?: TvMountMode;
  hoodMountMode?: 'murale' | 'ilot';
}

export interface ScenePropCatalogEntry {
  type: ScenePropType;
  category: ScenePropCategory;
  nameFr: string;
  descriptionFr: string;
  defaultWidthMm: number;
  defaultHeightMm: number;
  defaultDepthMm: number;
  defaultYMm: number;
  defaultColorHex: string;
  defaultFinish: PropFinishPreset;
  placementKind: 'floor' | 'wall' | 'countertop' | 'ceiling' | 'freestanding';
  supportsLight?: boolean;
  supportsTvSize?: boolean;
  supportsHoodMount?: boolean;
}

export type WallOpeningKind = 'porte' | 'fenetre';

export interface WallOpening {
  id: string;
  wallId: string;
  kind: WallOpeningKind;
  labelFr?: string;
  offsetFromStartMm: number;
  widthMm: number;
  heightMm: number;
  sillHeightMm: number;
  /** Door opening hinge side ('left' default or 'right'). */
  hingeSide?: 'left' | 'right';
}

export type RoomUtilityKind = 'poteau' | 'poutre' | 'prise' | 'arrivee_eau';

export interface RoomUtility {
  id: string;
  wallId?: string;
  kind: RoomUtilityKind;
  labelFr?: string;
  /** Optional ID of the module or prop that owns this auto-generated utility. */
  linkedEntityId?: string;
  linkedEntityKind?: 'module' | 'prop';
  xMm: number;
  yMm: number;
  zMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

export interface CeilingSpotLight {
  id: string;
  labelFr?: string;
  xMm: number;
  zMm: number;
  /** Per-spot intensity multiplier (0.0 – 2.0, default 1.0). */
  intensity?: number;
  enabled?: boolean;
}

export interface CeilingLightingConfig {
  /** Master ceiling spotlight brightness multiplier (0.0 – 1.5, default 0.6). */
  spotIntensity: number;
  /** Master enable switch for ceiling spots. */
  spotsEnabled: boolean;
  /** Custom ceiling spot positions (mm). When omitted, auto-computed 2x2 grid is used. */
  spots?: CeilingSpotLight[];
}

export interface ProjectDocument {
  id: string;
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  ceilingHeightMm: number;
  floorMaterialId: string;
  floorColorOverride?: string;
  floorGroutColor?: string;
  wallColor?: string;
  ceilingLighting?: CeilingLightingConfig;
  defaultCarpentry: CarpentryParams;
  walls: WallSegment[];
  openings: WallOpening[];
  utilities: RoomUtility[];
  modules: ModuleInstance[];
  props?: SceneProp[];
  pricing: DevisPricingConfig;
  nestingConfig?: NestingConfig;
  videoStudio?: VideoStudioConfig;
}

export interface SavedProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  moduleCount: number;
  wallCount: number;
  thumbnailDataUrl: string;
}

export interface SavedProjectRecord extends SavedProjectMeta {
  document: ProjectDocument;
}

export type SnapGuideKind = 'wall' | 'cabinet_flush' | 'cabinet_front' | 'vertical';

export interface SnapGuide {
  kind: SnapGuideKind;
  x1Mm: number;
  z1Mm: number;
  x2Mm: number;
  z2Mm: number;
  yMm?: number;
  labelFr?: string;
}

export interface SnapResult {
  xMm: number;
  yMm: number;
  zMm: number;
  rotationYRad: number;
  attachedWallId?: string;
  guides: SnapGuide[];
}

export type CollisionKind = 'module' | 'structure' | 'ouverture';

export interface CollisionWarning {
  id: string;
  kind: CollisionKind;
  moduleId: string;
  moduleRef: string;
  targetId: string;
  targetLabelFr: string;
  messageFr: string;
  penetrationMm: number;
}
