export type CurrencyCode = 'MAD' | 'EUR' | 'USD';

export type DisplayUnit = 'mm' | 'cm';

export type EdgeBandingCode = 'none' | '0.4' | '2';

export type GrainDirection = 'H' | 'V' | 'none';

export type MaterialCategory =
  | 'melamine_bois'
  | 'melamine_uni'
  | 'laque_mat'
  | 'laque_brillant'
  | 'plan_pierre'
  | 'sol'
  | 'mur';

export type ProceduralPattern =
  | 'wood_grain'
  | 'solid_matte'
  | 'solid_gloss'
  | 'marble_vein'
  | 'quartz_speckle'
  | 'granite_flame'
  | 'parquet_plank'
  | 'ceramic_tile'
  | 'plaster_wall'
  | 'large_tile'
  | 'zellige_tile'
  | 'beton_cire'
  | 'checker_tile'
  | 'wallpaper_textured';

export interface MaterialDef {
  id: string;
  nameFr: string;
  category: MaterialCategory;
  colorHex: string;
  secondaryHex?: string;
  pattern: ProceduralPattern;
  roughness: number;
  metalness: number;
  hasGrain: boolean;
  defaultThicknessMm?: number;
  pricePerM2: Record<CurrencyCode, number>;
}
