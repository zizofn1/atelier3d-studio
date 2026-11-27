export type DeviceProfileId = 'mobile' | 'desktop';

export interface DeviceQualityProfile {
  id: DeviceProfileId;
  isMobileOrTablet: boolean;
  labelFr: string;
  /** R3F Canvas [minDpr, maxDpr] */
  dpr: [number, number];
  /** Maximum anisotropic filtering level */
  maxAnisotropy: number;
  /** Maximum dimension (px) for WebGL photo & procedural textures */
  maxTextureSizePx: 512 | 1024;
  /** ContactShadows render target resolution */
  contactShadowResolution: 192 | 256;
  /** Environment cubemap resolution */
  hdriEnvResolution: 128 | 256;
  /** Secondary night ceiling spotlight shadow resolution */
  nightSpotShadowSize: 512 | 1024;
}

export interface DeviceProbeInput {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  viewportWidth?: number;
}

export const MOBILE_IPAD_QUALITY_PROFILE: DeviceQualityProfile = {
  id: 'mobile',
  isMobileOrTablet: true,
  labelFr: 'Profil Mobile / iPad (60 FPS)',
  dpr: [1, 1.2],
  maxAnisotropy: 2,
  maxTextureSizePx: 512,
  contactShadowResolution: 192,
  hdriEnvResolution: 128,
  nightSpotShadowSize: 512,
};

export const DESKTOP_QUALITY_PROFILE: DeviceQualityProfile = {
  id: 'desktop',
  isMobileOrTablet: false,
  labelFr: 'Profil Bureau Haute Fidélité',
  dpr: [1, 1.5],
  maxAnisotropy: 4,
  maxTextureSizePx: 1024,
  contactShadowResolution: 256,
  hdriEnvResolution: 256,
  nightSpotShadowSize: 1024,
};

/**
 * Pure detector for Mobile / iPadOS / Android / coarse-pointer tablets.
 * Automatically handles iPadOS 13+ desktop-class Safari (`MacIntel` + `maxTouchPoints > 1`).
 */
export function detectDeviceQualityProfile(probe?: DeviceProbeInput): DeviceQualityProfile {
  const ua =
    probe?.userAgent ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const platform =
    probe?.platform ??
    (typeof navigator !== 'undefined' ? navigator.platform : '');
  const maxTouchPoints =
    probe?.maxTouchPoints ??
    (typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0);
  const coarsePointer =
    probe?.coarsePointer ??
    (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false);
  const viewportWidth =
    probe?.viewportWidth ??
    (typeof window !== 'undefined' ? window.innerWidth : 1440);

  const isUaMobileOrTablet = /iPad|iPhone|iPod|Android|Mobile|Tablet|Silk/i.test(ua);
  const isIPadDesktopMode = platform === 'MacIntel' && maxTouchPoints > 1;
  const isTouchTabletOrPhone =
    maxTouchPoints > 0 && (coarsePointer || viewportWidth <= 1024);

  if (isUaMobileOrTablet || isIPadDesktopMode || isTouchTabletOrPhone) {
    return MOBILE_IPAD_QUALITY_PROFILE;
  }

  return DESKTOP_QUALITY_PROFILE;
}

let cachedDeviceProfile: DeviceQualityProfile | null = null;

export function getDeviceQualityProfile(): DeviceQualityProfile {
  if (!cachedDeviceProfile) {
    cachedDeviceProfile = detectDeviceQualityProfile();
  }
  return cachedDeviceProfile;
}
