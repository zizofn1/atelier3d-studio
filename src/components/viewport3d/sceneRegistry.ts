import type * as THREE from 'three';

export interface SceneRegistryEntry {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  exportGroup: THREE.Group | null;
  keyLight?: THREE.DirectionalLight | null;
  getCurrentCameraPose?: () => {
    positionMm: [number, number, number];
    targetMm: [number, number, number];
    fovDeg: number;
  };
}

let currentEntry: SceneRegistryEntry | null = null;
const waiters: Array<(entry: SceneRegistryEntry) => void> = [];

export function registerScene3D(entry: SceneRegistryEntry): void {
  currentEntry = {
    ...entry,
    keyLight: entry.keyLight ?? currentEntry?.keyLight ?? null,
    getCurrentCameraPose: entry.getCurrentCameraPose ?? currentEntry?.getCurrentCameraPose,
  };
  while (waiters.length > 0) {
    const resolve = waiters.shift();
    resolve?.(currentEntry);
  }
}

export function unregisterScene3D(): void {
  currentEntry = null;
}

export function isSceneMounted(): boolean {
  return currentEntry !== null;
}

export function getSceneRegistry(): SceneRegistryEntry | null {
  return currentEntry;
}

export function waitForScene(timeoutMs = 5000): Promise<SceneRegistryEntry> {
  if (currentEntry) {
    return Promise.resolve(currentEntry);
  }
  return new Promise<SceneRegistryEntry>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.indexOf(onReady);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new Error('Scène 3D non disponible dans le délai imparti.'));
    }, timeoutMs);

    const onReady = (entry: SceneRegistryEntry) => {
      clearTimeout(timer);
      resolve(entry);
    };

    waiters.push(onReady);
  });
}
