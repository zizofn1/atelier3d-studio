import type { EvaluatedVideoFrame } from '@/engine/video';

export type VideoFrameApplier = (frame: EvaluatedVideoFrame | null) => void;

export interface OrbitTargetBridge {
  getTargetM: () => [number, number, number];
  setTargetM: (x: number, y: number, z: number) => void;
}

let activeVideoFrame: EvaluatedVideoFrame | null = null;
let orbitTargetBridge: OrbitTargetBridge | null = null;
const frameAppliers = new Set<VideoFrameApplier>();

export function getActiveVideoFrame(): EvaluatedVideoFrame | null {
  return activeVideoFrame;
}

export function registerVideoFrameApplier(fn: VideoFrameApplier): () => void {
  frameAppliers.add(fn);
  if (activeVideoFrame) {
    fn(activeVideoFrame);
  }
  return () => {
    frameAppliers.delete(fn);
  };
}

/**
 * Synchronously pushes a deterministic EvaluatedVideoFrame to every subscribed
 * Three.js camera, light, door/drawer panel, cabinet assembly group, and prop.
 * Guarantees 100% frame-accurate parity between live preview and offline Studio export.
 */
export function applyVideoFrameSync(frame: EvaluatedVideoFrame | null): void {
  activeVideoFrame = frame;
  for (const fn of frameAppliers) {
    fn(frame);
  }
}

export function registerOrbitTargetBridge(bridge: OrbitTargetBridge | null): void {
  orbitTargetBridge = bridge;
}

export function getOrbitTargetBridge(): OrbitTargetBridge | null {
  return orbitTargetBridge;
}
