import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {
  getSceneRegistry,
  isSceneMounted,
  waitForScene,
  type SceneRegistryEntry,
} from '@/components/viewport3d/sceneRegistry';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { getDeviceQualityProfile } from '@/utils/deviceProfile';
import { shareOrDownloadBlob, triggerBlobDownload } from '@/utils/download';

export interface StudioRenderConfig {
  widthPx: number;
  heightPx: number;
  shadowMapSize: 2048 | 4096;
  msaaSamples: number;
}

/**
 * Pure resolution/MSAA/shadow calculator for the single-frame Rendu Photo 2K pipeline.
 * Caps mobile/iPad at 1920x1080 + 2048px shadows to prevent Safari WebGL context loss.
 */
export function computeStudioRenderConfig(
  isMobileOrTablet: boolean,
  maxSamples: number
): StudioRenderConfig {
  const safeMaxSamples = Number.isFinite(maxSamples) ? Math.max(0, Math.floor(maxSamples)) : 4;
  return {
    widthPx: isMobileOrTablet ? 1920 : 2560,
    heightPx: isMobileOrTablet ? 1080 : 1440,
    shadowMapSize: isMobileOrTablet ? 2048 : 4096,
    msaaSamples: Math.min(8, safeMaxSamples),
  };
}

function nextFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const step = () => {
      remaining--;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export async function withMountedScene3D<T>(
  fn: (entry: SceneRegistryEntry) => Promise<T>
): Promise<T> {
  const ui = useUIStore.getState();
  const prevTab = ui.activeWorkspaceTab;
  const prevMode = ui.viewMode;
  let switched = false;

  if (!isSceneMounted()) {
    switched = true;
    ui.setActiveWorkspaceTab('conception');
    if (prevMode !== 'view3d' && prevMode !== 'split') {
      ui.setViewMode('view3d');
    }
  }

  try {
    const entry = getSceneRegistry() ?? (await waitForScene(5000));
    await nextFrames(2);
    return await fn(entry);
  } finally {
    if (switched) {
      const currentUi = useUIStore.getState();
      currentUi.setViewMode(prevMode);
      currentUi.setActiveWorkspaceTab(prevTab);
    }
  }
}

/**
 * On-demand single-frame "Rendu Photo 2K" studio PNG capture:
 * - 2560x1440 desktop (1920x1080 mobile/iPad) with hardware MSAA clamped to min(8, maxSamples)
 * - Temporary 4096x4096 (desktop) / 2048x2048 (mobile) sun shadow boost
 * - Temporary EffectComposer with denoised GTAOPass + subtle UnrealBloomPass + OutputPass
 * - Immediately disposes temporary GPU buffers and restores the 60 FPS live viewport
 */
export async function captureRenderPngBlob(): Promise<Blob> {
  return withMountedScene3D(async ({ gl, scene, camera, keyLight }) => {
    const ui = useUIStore.getState();
    ui.setIsCapturingRender(true);
    await nextFrames(2);

    const profile = getDeviceQualityProfile();
    const cfg = computeStudioRenderConfig(
      profile.isMobileOrTablet,
      gl.capabilities.maxSamples ?? 4
    );

    const prevSize = new THREE.Vector2();
    gl.getSize(prevSize);
    const prevPixelRatio = gl.getPixelRatio();
    const prevShadowW = keyLight?.shadow.mapSize.width ?? 1024;
    const prevShadowH = keyLight?.shadow.mapSize.height ?? 1024;

    let renderTarget: THREE.WebGLRenderTarget | null = null;
    let composer: EffectComposer | null = null;
    let gtaoPass: GTAOPass | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let outputPass: OutputPass | null = null;

    try {
      // 1. Boost primary directional shadow map strictly for this single studio frame
      if (keyLight && (prevShadowW < cfg.shadowMapSize || prevShadowH < cfg.shadowMapSize)) {
        keyLight.shadow.mapSize.set(cfg.shadowMapSize, cfg.shadowMapSize);
        if (keyLight.shadow.map) {
          keyLight.shadow.map.dispose();
          keyLight.shadow.map = null;
        }
        keyLight.shadow.needsUpdate = true;
      }

      gl.setPixelRatio(1);
      gl.setSize(cfg.widthPx, cfg.heightPx, false);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = cfg.widthPx / cfg.heightPx;
        camera.updateProjectionMatrix();
      }

      // 2. Render single studio frame through temporary EffectComposer (GTAO + Bloom + Output)
      let composerRendered = false;
      try {
        renderTarget = new THREE.WebGLRenderTarget(cfg.widthPx, cfg.heightPx, {
          type: THREE.HalfFloatType,
          samples: cfg.msaaSamples,
        });
        composer = new EffectComposer(gl, renderTarget);
        composer.setPixelRatio(1);
        composer.setSize(cfg.widthPx, cfg.heightPx);

        const renderPass = new RenderPass(scene, camera);
        composer.addPass(renderPass);

        gtaoPass = new GTAOPass(scene, camera, cfg.widthPx, cfg.heightPx);
        gtaoPass.output = GTAOPass.OUTPUT.Default;
        gtaoPass.updateGtaoMaterial({
          radius: 0.3,
          distanceExponent: 1.8,
          thickness: 0.9,
          scale: 1.12,
          samples: profile.isMobileOrTablet ? 12 : 16,
        });
        gtaoPass.updatePdMaterial({
          lumaPhi: 10,
          depthPhi: 2,
          normalPhi: 3,
          radius: 4,
          radiusExponent: 1,
          rings: 2,
          samples: 12,
        });
        composer.addPass(gtaoPass);

        bloomPass = new UnrealBloomPass(
          new THREE.Vector2(cfg.widthPx, cfg.heightPx),
          0.1,
          0.36,
          2.1
        );
        composer.addPass(bloomPass);

        outputPass = new OutputPass();
        composer.addPass(outputPass);

        composer.render();
        composerRendered = true;
      } catch {
        // Fallback to direct 2K render if WebGL2 HalfFloat/GTAO extension is unavailable
        composerRendered = false;
      }

      if (!composerRendered) {
        gl.render(scene, camera);
      }

      const blob = await new Promise<Blob>((resolve, reject) => {
        gl.domElement.toBlob((b) => {
          if (b && b.size > 0) resolve(b);
          else reject(new Error('Échec de la capture PNG haute résolution (2K).'));
        }, 'image/png');
      });
      return blob;
    } finally {
      // Immediately dispose all temporary GPU buffers & passes
      try {
        gtaoPass?.dispose();
        bloomPass?.dispose();
        outputPass?.dispose();
        composer?.dispose();
        renderTarget?.dispose();
      } catch {
        // Ignore disposal errors on lost contexts
      }

      // Restore 60 FPS live shadow map & viewport size
      if (keyLight && (prevShadowW < cfg.shadowMapSize || prevShadowH < cfg.shadowMapSize)) {
        keyLight.shadow.mapSize.set(prevShadowW, prevShadowH);
        if (keyLight.shadow.map) {
          keyLight.shadow.map.dispose();
          keyLight.shadow.map = null;
        }
        keyLight.shadow.needsUpdate = true;
      }

      gl.setPixelRatio(prevPixelRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.aspect = prevSize.x / Math.max(1, prevSize.y);
        camera.updateProjectionMatrix();
      }
      gl.render(scene, camera);
      useUIStore.getState().setIsCapturingRender(false);
    }
  });
}

function slug(str: string): string {
  return (
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'projet'
  );
}

export async function exportRenderPng(options?: {
  share?: boolean;
}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const doc = useProjectStore.getState().document;
  const blob = await captureRenderPngBlob();
  const filename = `rendu-photo-2k-${slug(doc.name)}.png`;
  const profile = getDeviceQualityProfile();
  if (options?.share || profile.isMobileOrTablet) {
    return shareOrDownloadBlob(blob, filename, {
      title: `Rendu Photo 2K — ${doc.name}`,
      text: `Visuel 3D Atelier3D Studio pour ${doc.name}`,
    });
  }
  triggerBlobDownload(blob, filename);
  return 'downloaded';
}
