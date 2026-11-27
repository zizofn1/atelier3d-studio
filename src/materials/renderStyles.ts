export type RenderStyleId =
  | 'homebyme_clair'
  | 'showroom_luxe'
  | 'sketchup_pro'
  | 'soleil_naturel'
  | 'ambiance_soiree';

export interface RenderStyleSettings {
  styleId: RenderStyleId;
  /** Renderer toneMappingExposure (0.6 – 1.8) */
  exposure: number;
  /** HDRI environment reflection intensity (0.0 – 1.5) */
  hdriIntensity: number;
  /** Directional sunlight / primary key light intensity (0.0 – 3.0) */
  sunIntensity: number;
  /** Horizontal sun azimuth in degrees (0° – 360°) */
  sunAngleDeg: number;
  /** SketchUp-style architectural crease edge lines opacity (0.0 – 0.6) */
  edgeLinesOpacity: number;
  /** Global sheen / varnish / clearcoat boost (0.0 – 1.0) */
  glossBoost: number;
}

export interface RenderStylePreset {
  id: RenderStyleId;
  labelFr: string;
  shortLabelFr: string;
  descriptionFr: string;
  toneMapping: 'agx' | 'aces';
  isNightMood: boolean;
  defaultLedEnabled: boolean;
  conceptionBgHex: string;
  clientBgHex: string;
  hemiSkyHex: string;
  hemiGroundHex: string;
  hemiIntensity: number;
  ambientIntensity: number;
  sunColorHex: string;
  sunElevationDeg: number;
  fillColorHex: string;
  fillIntensity: number;
  interiorAccentHex: string;
  interiorAccentIntensity: number;
  contactShadowOpacity: number;
  ledLightIntensity: number;
  ledEmissiveIntensity: number;
  defaults: Omit<RenderStyleSettings, 'styleId'>;
}

export const RENDER_STYLE_PRESETS: RenderStylePreset[] = [
  {
    id: 'homebyme_clair',
    labelFr: 'HomeByMe / Clair',
    shortLabelFr: 'Clair',
    descriptionFr: 'Lumière du jour scandinave aérienne, rendu doux et murs lumineux.',
    toneMapping: 'agx',
    isNightMood: false,
    defaultLedEnabled: false,
    conceptionBgHex: '#edf2f7',
    clientBgHex: '#a5d2fa',
    hemiSkyHex: '#ffffff',
    hemiGroundHex: '#efe6d8',
    hemiIntensity: 1.05,
    ambientIntensity: 0.3,
    sunColorHex: '#fffaf0',
    sunElevationDeg: 52,
    fillColorHex: '#e6f2ff',
    fillIntensity: 0.45,
    interiorAccentHex: '#fff8ec',
    interiorAccentIntensity: 1.45,
    contactShadowOpacity: 0.24,
    ledLightIntensity: 1.6,
    ledEmissiveIntensity: 2.6,
    defaults: {
      exposure: 1.22,
      hdriIntensity: 0.78,
      sunIntensity: 1.35,
      sunAngleDeg: 42,
      edgeLinesOpacity: 0,
      glossBoost: 0.25,
    },
  },
  {
    id: 'showroom_luxe',
    labelFr: 'Showroom Luxe',
    shortLabelFr: 'Showroom',
    descriptionFr: 'Ambiance showroom nuit élégante, LEDs sous-meubles actives, exposition maîtrisée.',
    toneMapping: 'aces',
    isNightMood: true,
    defaultLedEnabled: true,
    conceptionBgHex: '#0b111e',
    clientBgHex: '#070d1b',
    hemiSkyHex: '#3c4d6e',
    hemiGroundHex: '#33251a',
    hemiIntensity: 0.44,
    ambientIntensity: 0.14,
    sunColorHex: '#ffe6bd',
    sunElevationDeg: 44,
    fillColorHex: '#cfe4ff',
    fillIntensity: 0.22,
    interiorAccentHex: '#ffcf87',
    interiorAccentIntensity: 1.9,
    contactShadowOpacity: 0.44,
    ledLightIntensity: 1.6,
    ledEmissiveIntensity: 2.6,
    defaults: {
      exposure: 0.92,
      hdriIntensity: 0.42,
      sunIntensity: 0,
      sunAngleDeg: 108,
      edgeLinesOpacity: 0,
      glossBoost: 0,
    },
  },
  {
    id: 'sketchup_pro',
    labelFr: 'SketchUp Pro',
    shortLabelFr: 'SketchUp',
    descriptionFr: 'Arêtes architecturales nettes sur caissons et murs, lecture technique précise.',
    toneMapping: 'agx',
    isNightMood: false,
    defaultLedEnabled: false,
    conceptionBgHex: '#f1f5f9',
    clientBgHex: '#bae0ff',
    hemiSkyHex: '#ffffff',
    hemiGroundHex: '#e2e8f0',
    hemiIntensity: 1.12,
    ambientIntensity: 0.36,
    sunColorHex: '#ffffff',
    sunElevationDeg: 58,
    fillColorHex: '#f1f5f9',
    fillIntensity: 0.42,
    interiorAccentHex: '#ffffff',
    interiorAccentIntensity: 0.8,
    contactShadowOpacity: 0.2,
    ledLightIntensity: 1.4,
    ledEmissiveIntensity: 2.2,
    defaults: {
      exposure: 1.26,
      hdriIntensity: 0.5,
      sunIntensity: 1.25,
      sunAngleDeg: 55,
      edgeLinesOpacity: 0.32,
      glossBoost: 0.1,
    },
  },
  {
    id: 'soleil_naturel',
    labelFr: 'Soleil Naturel',
    shortLabelFr: 'Soleil',
    descriptionFr: 'Rayons dorés rasants traversant les fenêtres, contrastes photo naturels.',
    toneMapping: 'aces',
    isNightMood: false,
    defaultLedEnabled: false,
    conceptionBgHex: '#dbe7f3',
    clientBgHex: '#7cb7f0',
    hemiSkyHex: '#eef6ff',
    hemiGroundHex: '#d8c2a3',
    hemiIntensity: 0.72,
    ambientIntensity: 0.16,
    sunColorHex: '#ffe9c2',
    sunElevationDeg: 32,
    fillColorHex: '#cbe4ff',
    fillIntensity: 0.38,
    interiorAccentHex: '#fff3db',
    interiorAccentIntensity: 1.2,
    contactShadowOpacity: 0.38,
    ledLightIntensity: 1.7,
    ledEmissiveIntensity: 2.8,
    defaults: {
      exposure: 1.14,
      hdriIntensity: 0.88,
      sunIntensity: 2.55,
      sunAngleDeg: 28,
      edgeLinesOpacity: 0,
      glossBoost: 0.45,
    },
  },
  {
    id: 'ambiance_soiree',
    labelFr: 'Ambiance Soirée',
    shortLabelFr: 'Soirée',
    descriptionFr: 'Crépuscule doux extérieur, spots plafond 2700K et bandeaux LED chaleureux.',
    toneMapping: 'aces',
    isNightMood: true,
    defaultLedEnabled: true,
    conceptionBgHex: '#080e1c',
    clientBgHex: '#060c1a',
    hemiSkyHex: '#283c63',
    hemiGroundHex: '#2c1f14',
    hemiIntensity: 0.34,
    ambientIntensity: 0.12,
    sunColorHex: '#93c5fd',
    sunElevationDeg: 26,
    fillColorHex: '#60a5fa',
    fillIntensity: 0.22,
    interiorAccentHex: '#ffc978',
    interiorAccentIntensity: 2.1,
    contactShadowOpacity: 0.42,
    ledLightIntensity: 1.8,
    ledEmissiveIntensity: 2.8,
    defaults: {
      exposure: 0.98,
      hdriIntensity: 0.18,
      sunIntensity: 0.25,
      sunAngleDeg: 210,
      edgeLinesOpacity: 0,
      glossBoost: 0.65,
    },
  },
];

export const RENDER_STYLE_BY_ID: Record<RenderStyleId, RenderStylePreset> = Object.fromEntries(
  RENDER_STYLE_PRESETS.map((p) => [p.id, p])
) as Record<RenderStyleId, RenderStylePreset>;

export function getRenderStylePreset(id: RenderStyleId): RenderStylePreset {
  return RENDER_STYLE_BY_ID[id] ?? RENDER_STYLE_PRESETS[0];
}

export function getDefaultStyleSettings(id: RenderStyleId = 'showroom_luxe'): RenderStyleSettings {
  const preset = getRenderStylePreset(id);
  return {
    styleId: preset.id,
    ...preset.defaults,
  };
}
