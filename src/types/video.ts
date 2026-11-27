export type VideoEasing = 'linear' | 'easeInOut' | 'easeOut';

export type VideoAspectRatio = '16:9' | '9:16';

export type VideoQualityMode = 'fast' | 'studio';

export type VideoPresetId = 'tour_client' | 'reels_montage' | 'jour_nuit' | 'custom';

export interface VideoCameraKeyframe {
  id: string;
  timeSec: number;
  positionMm: [number, number, number];
  targetMm: [number, number, number];
  fovDeg: number;
  easing: VideoEasing;
  labelFr?: string;
}

export interface VideoDoorEvent {
  id: string;
  kind: 'open_doors' | 'close_doors';
  startSec: number;
  durationSec: number;
  /** 'all' for every module with doors/drawers, or a specific moduleId */
  target: 'all' | string;
}

export interface VideoLightingEvent {
  id: string;
  kind: 'lighting_transition';
  startSec: number;
  durationSec: number;
  fromPreset: 'jour' | 'nuit';
  toPreset: 'jour' | 'nuit';
  enableLedsAtEnd?: boolean;
}

export interface VideoAssemblyEvent {
  id: string;
  kind: 'assembly_mode';
  startSec: number;
  durationSec: number;
  /** Optional stagger interval in seconds between individual items within a phase */
  staggerSec?: number;
}

export type VideoTimelineEvent = VideoDoorEvent | VideoLightingEvent | VideoAssemblyEvent;

export interface VideoBrandingConfig {
  enabled: boolean;
  showCompanyName: boolean;
  showProjectTitle: boolean;
  /** Optional local PNG/JPG/SVG data URL uploaded by the user (100% offline) */
  logoDataUrl?: string;
  customTagline?: string;
}

export interface VideoStudioConfig {
  durationSec: number;
  fps: number;
  aspectRatio: VideoAspectRatio;
  qualityMode: VideoQualityMode;
  /** Keep interpolated camera safely clamped inside closed room walls */
  constrainInsideRoom: boolean;
  presetId?: VideoPresetId;
  keyframes: VideoCameraKeyframe[];
  events: VideoTimelineEvent[];
  branding: VideoBrandingConfig;
}

export const DEFAULT_VIDEO_BRANDING: VideoBrandingConfig = {
  enabled: true,
  showCompanyName: true,
  showProjectTitle: true,
};

export const DEFAULT_VIDEO_STUDIO_CONFIG: VideoStudioConfig = {
  durationSec: 12,
  fps: 30,
  aspectRatio: '16:9',
  qualityMode: 'fast',
  constrainInsideRoom: true,
  presetId: 'custom',
  keyframes: [],
  events: [],
  branding: { ...DEFAULT_VIDEO_BRANDING },
};
