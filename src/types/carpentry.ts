import type { EdgeBandingCode, GrainDirection } from './materials';
import type { HardwareKind } from './devis';

export type BoardThickness = 16 | 18 | 19 | 22;

export type BackThickness = 5 | 8;

export type BackMountType = 'rainure' | 'applique';

export type HandleStyle = 'bar' | 'knob' | 'gorge' | 'push';

export type HandleVerticalPosition = 'auto' | 'bottom' | 'center' | 'top';

export type ModuleCategory = 'cuisine' | 'salle_de_bain' | 'dressing' | 'mobilier';

export type ModuleType =
  | 'caisson_bas'
  | 'caisson_casserolier'
  | 'caisson_sous_evier'
  | 'caisson_haut'
  | 'meuble_haut_vitre'
  | 'caisson_haut_angle_aveugle'
  | 'caisson_sur_frigo'
  | 'caisson_haut_relevant'
  | 'colonne'
  | 'colonne_garde_manger'
  | 'caisson_angle'
  | 'caisson_angle_l'
  | 'caisson_angle_aveugle'
  | 'caisson_angle_pan_coupe'
  | 'caisson_haut_angle'
  | 'caisson_bas_tiroir_porte'
  | 'caisson_bas_2tiroirs_porte'
  | 'colonne_mixte_tiroirs_portes'
  | 'meuble_vitrine'
  | 'ilot_central'
  | 'plan_de_travail'
  | 'credence'
  | 'plinthe'
  | 'meuble_vasque'
  | 'meuble_double_vasque'
  | 'armoire_miroir_led'
  | 'colonne_sdb'
  | 'meuble_buanderie'
  | 'dressing_penderie'
  | 'dressing_etagere'
  | 'dressing_tiroirs'
  | 'portes_battantes'
  | 'portes_coulissantes'
  | 'meuble_tv'
  | 'bibliotheque'
  | 'bureau'
  | 'banc_entree';

export interface CarpentryParams {
  boardThickness: BoardThickness;
  backThickness: BackThickness;
  backMountType: BackMountType;
  facadeGapMm: number;
  plinthHeightMm: number;
  plinthRecessMm: number;
  handleStyle: HandleStyle;
  carcassMaterialId: string;
  facadeMaterialId: string;
  backMaterialId: string;
  countertopMaterialId: string;
  edgeBandingMaterialId: string;
  facadeColorOverride?: string;
  carcassColorOverride?: string;
  countertopColorOverride?: string;
  facadeEdgeCode?: EdgeBandingCode;
  facadeEdgeOverrides?: Partial<FourEdges>;
  /** When true, deducts applied edge-banding thickness (2 mm / 0.4 mm) from raw saw cut dimensions. */
  deductEdgeBandingThickness?: boolean;
}

export interface FourEdges {
  top: EdgeBandingCode;
  bottom: EdgeBandingCode;
  left: EdgeBandingCode;
  right: EdgeBandingCode;
}

export type PanelRole =
  | 'joue_gauche'
  | 'joue_droite'
  | 'dessus'
  | 'dessous'
  | 'traverse'
  | 'fond'
  | 'etagere'
  | 'porte'
  | 'tiroir_facade'
  | 'tiroir_cote'
  | 'tiroir_fond'
  | 'tiroir_arriere'
  | 'plan_travail'
  | 'credence'
  | 'plinthe'
  | 'separateur'
  | 'pied_panneau';

export type PanelAnimationGroup =
  | 'door_left'
  | 'door_right'
  | 'slide_left'
  | 'slide_right'
  | `drawer_${number}`;

export interface PanelAnimationMeta {
  kind: 'hinged_left' | 'hinged_right' | 'sliding' | 'drawer';
  index: number;
  pivotMm?: [number, number, number];
  slideDirection?: 1 | -1;
  slideTravelMm?: number;
}

export interface PanelSpec {
  id: string;
  nameFr: string;
  role: PanelRole;
  materialId: string;
  widthMm: number;
  heightMm: number;
  thicknessMm: number;
  positionMm: [number, number, number];
  rotationRad: [number, number, number];
  grain: GrainDirection;
  edges: FourEdges;
  surfaceSlot?: 'facade' | 'carcass' | 'countertop' | 'back' | 'glass';
  isInterior?: boolean;
  /** Optional 45° corner chamfer clipped at the (-X, +Z) panel corner (mm) for pentagonal corner shelves/carcass plates */
  chamferFrontCornerMm?: number;
  animationGroup?: PanelAnimationGroup;
  animationMeta?: PanelAnimationMeta;
}

export interface HardwareRequirement {
  kind: HardwareKind;
  quantity: number;
  labelFr?: string;
}

export interface ModuleOutput {
  panels: PanelSpec[];
  hardware: HardwareRequirement[];
  boundingBoxMm: {
    widthMm: number;
    heightMm: number;
    depthMm: number;
  };
  warnings?: string[];
}

export interface ModuleInstance {
  id: string;
  ref: string;
  type: ModuleType;
  nameFr: string;
  xMm: number;
  yMm: number;
  zMm: number;
  rotationYRad: number;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  attachedWallId?: string;
  doorCount: number;
  drawerCount: number;
  shelfCount: number;
  columnCount?: number;
  cornerKind?: 'en_l' | 'aveugle';
  blindSide?: 'left' | 'right';
  /** Unified facade style: solid wood/melamine ('plein') or framed transparent glass ('vitre'). */
  facadeKind?: 'plein' | 'vitre';
  /** Custom glass pane tint color (hex, e.g. '#e0f2fe' clair, '#475569' fumé). */
  glassTintHex?: string;
  /** Custom glass pane opacity (0.15 - 0.85, default 0.24). */
  glassOpacity?: number;
  /** Width of the wood/aluminum perimeter frame around glazed doors in mm (e.g. 20 = 2 cm, 50 = 5 cm). */
  glassFrameWidthMm?: number;
  /** Vertical handle placement override ('auto' places upper cabinet handles at the bottom). */
  handlePositionY?: HandleVerticalPosition;
  /** Door opening hinge side for single-door cabinets ('left' | 'right'). */
  hingeSide?: 'left' | 'right';
  colonneVariant?: 'four' | 'refrigerateur' | 'rangement';
  overhangMm?: number;
  grainDirection?: GrainDirection;
  hasPlinth?: boolean;
  hasCountertop?: boolean;
  ledUnder?: boolean;
  ledInterior?: boolean;
  /** When true (default when ledInterior is on), interior LED wraps around all 4 inner edges. */
  ledInteriorWrap?: boolean;
  /** Per-module LED strip color (hex, e.g. '#ffcf87' warm white, '#dceeff' cool white). */
  ledColorHex?: string;
  /** Per-module LED strip intensity multiplier (0.1 - 2.0, default 1.0). */
  ledIntensity?: number;
  overrides?: Partial<CarpentryParams>;
}

export interface ModuleCatalogEntry {
  type: ModuleType;
  category: ModuleCategory;
  nameFr: string;
  descriptionFr: string;
  defaultWidthMm: number;
  defaultHeightMm: number;
  defaultDepthMm: number;
  defaultYMm: number;
  minWidthMm: number;
  maxWidthMm: number;
  minHeightMm: number;
  maxHeightMm: number;
  minDepthMm: number;
  maxDepthMm: number;
  defaultDoorCount: number;
  defaultDrawerCount: number;
  defaultShelfCount: number;
  supportsLedUnder?: boolean;
}
