export type HardwareKind =
  | 'charniere'
  | 'coulisse'
  | 'poignee'
  | 'bouton'
  | 'profil_gorge'
  | 'push_open'
  | 'pied_reglable'
  | 'verin'
  | 'taquet'
  | 'suspension_murale'
  | 'kit_coulissant'
  | 'tringle';

export interface HardwareBomItem {
  kind: HardwareKind;
  labelFr: string;
  unitFr: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

import type { CurrencyCode, EdgeBandingCode, GrainDirection } from './materials';

export interface CutlistItem {
  id: string;
  moduleId: string;
  moduleRef: string;
  moduleNameFr: string;
  partNameFr: string;
  materialId: string;
  materialNameFr: string;
  lengthMm: number;
  widthMm: number;
  thicknessMm: number;
  grain: GrainDirection;
  edges: {
    top: EdgeBandingCode;
    bottom: EdgeBandingCode;
    left: EdgeBandingCode;
    right: EdgeBandingCode;
  };
  quantity: number;
  areaM2: number;
  edgeLengthM: number;
}

export interface MaterialDevisLine {
  materialId: string;
  materialNameFr: string;
  thicknessMm: number;
  sheetsCount: number;
  sheetAreaM2: number;
  netAreaM2: number;
  wastePercent: number;
  unitPricePerM2: number;
  totalPrice: number;
  /** Number of oversized pieces exceeding standard sheet dimensions billed via net area + 15% loss. */
  unplacedCount?: number;
  /** Extra billable area (m²) for oversized pieces not fitting on standard sheets. */
  unplacedBillableAreaM2?: number;
}

export interface EdgeBandingDevisLine {
  code: Exclude<EdgeBandingCode, 'none'>;
  labelFr: string;
  linearMeters: number;
  unitPricePerMeter: number;
  totalPrice: number;
}

export interface DevisPricingConfig {
  currency: CurrencyCode;
  materialPriceOverrides: Record<string, number>;
  edgeBandingPricesPerMeter: Record<'0.4' | '2', number>;
  hardwareUnitPrices: Record<HardwareKind, number>;
  laborPercent: number;
  marginPercent: number;
  tvaPercent: number;
  company: {
    name: string;
    address: string;
    phone: string;
    email: string;
    taxId: string;
  };
  client: {
    name: string;
    address: string;
    phone: string;
    email: string;
  };
  quoteReference: string;
  validityDays: number;
  notesFr: string;
}

export interface DevisSummary {
  currency: CurrencyCode;
  materialLines: MaterialDevisLine[];
  edgeBandingLines: EdgeBandingDevisLine[];
  hardwareItems: HardwareBomItem[];
  materialsSubtotal: number;
  edgeBandingSubtotal: number;
  hardwareSubtotal: number;
  supplySubtotal: number;
  laborAmount: number;
  marginAmount: number;
  totalHT: number;
  tvaAmount: number;
  totalTTC: number;
  /** Total count of oversized pieces across all material groups that exceeded standard sheet limits. */
  unplacedPiecesCount?: number;
}
