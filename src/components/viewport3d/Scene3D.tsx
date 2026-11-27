import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer } from '@react-three/drei';
import {
  ArrowLeft,
  Box,
  Camera,
  Check,
  ChevronDown,
  Copy,
  DoorOpen,
  Film,
  HelpCircle,
  ImageDown,
  Layers,
  Lightbulb,
  Moon,
  Palette,
  Pin,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from 'lucide-react';
import * as THREE from 'three';
import { DEFAULT_VIDEO_STUDIO_CONFIG } from '@/types';
import {
  MAX_CAMERA_FOV,
  MIN_CAMERA_FOV,
  analyzeWalls,
  computeCameraZones,
  computeRoomBounds,
  findSafeRoomInteriorPoint,
  resolveCeilingLighting,
  type CameraZonePreset,
} from '@/engine/geometry';
import { evaluateFrameAt } from '@/engine/video';
import { FR } from '@/i18n/fr';
import { getDeviceQualityProfile } from '@/utils/deviceProfile';
import {
  applyGlobalMaterialTuning,
  refreshAllTexturesAfterContextRestore,
  setEdgeLinesOpacity,
  setMaxTextureAnisotropy,
} from '@/materials/proceduralTextures';
import {
  RENDER_STYLE_PRESETS,
  getRenderStylePreset,
  type RenderStylePreset,
  type RenderStyleSettings,
} from '@/materials/renderStyles';
import { selectCollisionModuleIds, selectProjectModuleOutputs } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore, type RenderQuality } from '@/store/useUIStore';
import { flushContinuousEdit, runContinuousEdit } from '@/utils/historyBatch';
import { PROPS_CATALOG_BY_TYPE } from '@/data/propsCatalog';
import { DecorPropMesh } from './DecorPropMesh';
import { ExteriorScenery3D } from './ExteriorScenery3D';
import { ParametricModuleMesh } from './ParametricModuleMesh';
import { RoomMesh } from './RoomMesh';
import { registerScene3D, unregisterScene3D } from './sceneRegistry';
import {
  applyVideoFrameSync,
  getOrbitTargetBridge,
  registerVideoFrameApplier,
} from './videoRuntimeRef';
import { WalkthroughControls } from './WalkthroughControls';

const VideoStudioOverlay = lazy(() =>
  import('./VideoStudioOverlay').then((m) => ({ default: m.VideoStudioOverlay }))
);
const CyclesRenderModal = lazy(() =>
  import('@/components/modals/CyclesRenderModal').then((m) => ({
    default: m.CyclesRenderModal,
  }))
);

interface SceneBridgeProps {
  exportGroupRef: React.RefObject<THREE.Group | null>;
  keyLightRef: React.RefObject<THREE.DirectionalLight | null>;
  preset: RenderStylePreset;
  renderStyle: RenderStyleSettings;
  onContextLostChange?: (lost: boolean) => void;
}

function SceneBridge({
  exportGroupRef,
  keyLightRef,
  preset,
  renderStyle,
  onContextLostChange,
}: SceneBridgeProps) {
  const { gl, scene, camera, invalidate } = useThree();
  const readyMarkedRef = useRef(false);
  const docUpdatedAt = useProjectStore((s) => s.document.updatedAt);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);
  const openAll = useUIStore((s) => s.openAll);
  const openModuleIds = useUIStore((s) => s.openModuleIds);
  const wallCutaway = useUIStore((s) => s.wallCutaway);
  const presentationMode = useUIStore((s) => s.presentationMode);
  const cameraMode = useUIStore((s) => s.cameraMode);
  const isCapturingRender = useUIStore((s) => s.isCapturingRender);
  const renderQuality = useUIStore((s) => s.renderQuality);

  useEffect(() => {
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxTextureAnisotropy(gl.capabilities.getMaxAnisotropy());

    const getCurrentCameraPose = () => {
      const targetM = getOrbitTargetBridge()?.getTargetM() ?? [
        camera.position.x,
        camera.position.y - 0.15,
        camera.position.z - 2,
      ];
      return {
        positionMm: [
          Math.round(camera.position.x * 1000),
          Math.round(camera.position.y * 1000),
          Math.round(camera.position.z * 1000),
        ] as [number, number, number],
        targetMm: [
          Math.round(targetM[0] * 1000),
          Math.round(targetM[1] * 1000),
          Math.round(targetM[2] * 1000),
        ] as [number, number, number],
        fovDeg: camera instanceof THREE.PerspectiveCamera ? Math.round(camera.fov) : 60,
      };
    };

    registerScene3D({
      gl,
      scene,
      camera,
      exportGroup: exportGroupRef.current,
      keyLight: keyLightRef.current,
      getCurrentCameraPose,
    });

    const dom = gl.domElement;
    const handleContextLost = (ev: Event) => {
      ev.preventDefault();
      onContextLostChange?.(true);
    };
    const handleContextRestored = () => {
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
      refreshAllTexturesAfterContextRestore();
      onContextLostChange?.(false);
      invalidate();
    };
    dom.addEventListener('webglcontextlost', handleContextLost, false);
    dom.addEventListener('webglcontextrestored', handleContextRestored, false);

    invalidate();
    return () => {
      dom.removeEventListener('webglcontextlost', handleContextLost);
      dom.removeEventListener('webglcontextrestored', handleContextRestored);
      unregisterScene3D();
      useUIStore.getState().setSceneReady(false);
    };
  }, [gl, scene, camera, exportGroupRef, keyLightRef, invalidate, onContextLostChange]);

  // Live tone mapping (AgX vs ACESFilmic), exposure, gloss boost, quality reflection scale & SketchUp edge lines
  useEffect(() => {
    gl.toneMapping =
      preset.toneMapping === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = renderStyle.exposure;
    // Gentle quality reflection scaling (avoids double-multiplying HDRI reflections on Fort/Ultra)
    const qualityEnvScale =
      renderQuality === 'ultra' ? 1.08 : renderQuality === 'fort' ? 1.0 : 0.9;
    applyGlobalMaterialTuning({
      glossBoost: renderStyle.glossBoost,
      hdriIntensity: renderStyle.hdriIntensity,
      qualityEnvScale,
    });
    setEdgeLinesOpacity(renderStyle.edgeLinesOpacity);
    invalidate();
  }, [
    gl,
    invalidate,
    preset.toneMapping,
    renderStyle.exposure,
    renderStyle.glossBoost,
    renderStyle.hdriIntensity,
    renderStyle.edgeLinesOpacity,
    renderStyle.sunIntensity,
    renderStyle.sunAngleDeg,
    renderQuality,
  ]);

  // Trigger on-demand frame redraw whenever document, selection, lighting, LEDs, doors, camera, quality or mode change
  useEffect(() => {
    invalidate();
  }, [
    invalidate,
    docUpdatedAt,
    selectedIds,
    lightingPreset,
    ledEnabled,
    openAll,
    openModuleIds,
    wallCutaway,
    presentationMode,
    cameraMode,
    isCapturingRender,
    renderQuality,
  ]);

  useFrame(() => {
    if (!readyMarkedRef.current) {
      readyMarkedRef.current = true;
      registerScene3D({
        gl,
        scene,
        camera,
        exportGroup: exportGroupRef.current,
        keyLight: keyLightRef.current,
        getCurrentCameraPose: () => {
          const targetM = getOrbitTargetBridge()?.getTargetM() ?? [
            camera.position.x,
            camera.position.y - 0.15,
            camera.position.z - 2,
          ];
          return {
            positionMm: [
              Math.round(camera.position.x * 1000),
              Math.round(camera.position.y * 1000),
              Math.round(camera.position.z * 1000),
            ],
            targetMm: [
              Math.round(targetM[0] * 1000),
              Math.round(targetM[1] * 1000),
              Math.round(targetM[2] * 1000),
            ],
            fovDeg: camera instanceof THREE.PerspectiveCamera ? Math.round(camera.fov) : 60,
          };
        },
      });
      useUIStore.getState().setSceneReady(true);
    }
  });

  return null;
}

interface VideoPlaybackControllerProps {
  keyLightRef: React.RefObject<THREE.DirectionalLight | null>;
  hemiLightRef: React.RefObject<THREE.HemisphereLight | null>;
  ambientLightRef: React.RefObject<THREE.AmbientLight | null>;
  interiorPointRef: React.RefObject<THREE.PointLight | null>;
  nightSpotRef: React.RefObject<THREE.SpotLight | null>;
  spotScale: number;
  preset: RenderStylePreset;
  renderStyle: RenderStyleSettings;
  cx: number;
  cz: number;
}

function VideoPlaybackController({
  keyLightRef,
  hemiLightRef,
  ambientLightRef,
  interiorPointRef,
  nightSpotRef,
  spotScale,
  preset,
  renderStyle,
  cx,
  cz,
}: VideoPlaybackControllerProps) {
  const { camera, scene, invalidate } = useThree();
  const doc = useProjectStore((s) => s.document);
  const videoStudioMode = useUIStore((s) => s.videoStudioMode);
  const videoIsPlaying = useUIStore((s) => s.videoIsPlaying);
  const videoPlayheadSec = useUIStore((s) => s.videoPlayheadSec);
  const setVideoPlayheadSec = useUIStore((s) => s.setVideoPlayheadSec);
  const setVideoIsPlaying = useUIStore((s) => s.setVideoIsPlaying);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);

  const liveTimeRef = useRef(videoPlayheadSec);
  const lastUiSyncMsRef = useRef(0);

  // Sync liveTimeRef whenever user scrubs or pauses
  useEffect(() => {
    if (!videoIsPlaying) {
      liveTimeRef.current = videoPlayheadSec;
    }
  }, [videoPlayheadSec, videoIsPlaying]);

  // Register imperative camera + smooth lighting transition applier for live preview & offline Studio export
  useEffect(() => {
    const daySunColor = new THREE.Color(preset.sunColorHex);
    const goldenSunColor = new THREE.Color('#ffaa5e');
    const nightSunColor = new THREE.Color('#93c5fd');
    const dayBgColor = new THREE.Color(preset.clientBgHex);
    const nightBgColor = new THREE.Color('#060c1a');
    const tmpColor = new THREE.Color();

    return registerVideoFrameApplier((frame) => {
      if (!frame) return;

      // 1. Camera pose + FOV
      const px = frame.camera.positionMm[0] * 0.001;
      const py = frame.camera.positionMm[1] * 0.001;
      const pz = frame.camera.positionMm[2] * 0.001;
      const tx = frame.camera.targetMm[0] * 0.001;
      const ty = frame.camera.targetMm[1] * 0.001;
      const tz = frame.camera.targetMm[2] * 0.001;

      camera.position.set(px, py, pz);
      if (camera instanceof THREE.PerspectiveCamera) {
        if (Math.abs(camera.fov - frame.camera.fovDeg) > 0.01) {
          camera.fov = frame.camera.fovDeg;
          camera.updateProjectionMatrix();
        }
      }
      const orbitBridge = getOrbitTargetBridge();
      if (orbitBridge) {
        orbitBridge.setTargetM(tx, ty, tz);
      } else {
        camera.lookAt(tx, ty, tz);
      }

      // 2. Smooth Day <-> Golden Hour <-> Night lighting & LED accent interpolation
      const nf = frame.lightingNightFactor;
      if (keyLightRef.current) {
        const sunInt = THREE.MathUtils.lerp(renderStyle.sunIntensity, 0.28, nf);
        keyLightRef.current.intensity = sunInt;
        if (nf < 0.5) {
          tmpColor.copy(daySunColor).lerp(goldenSunColor, nf * 2);
        } else {
          tmpColor.copy(goldenSunColor).lerp(nightSunColor, (nf - 0.5) * 2);
        }
        keyLightRef.current.color.copy(tmpColor);
        const azRad = (renderStyle.sunAngleDeg * Math.PI) / 180;
        const elDeg = THREE.MathUtils.lerp(12, preset.sunElevationDeg, frame.sunElevationFactor);
        const elRad = (elDeg * Math.PI) / 180;
        const dist = 11.5;
        keyLightRef.current.position.set(
          cx + Math.cos(azRad) * Math.cos(elRad) * dist,
          Math.max(1.8, Math.sin(elRad) * dist),
          cz - Math.sin(azRad) * Math.cos(elRad) * dist
        );
      }

      if (hemiLightRef.current) {
        hemiLightRef.current.intensity = THREE.MathUtils.lerp(preset.hemiIntensity, 0.34, nf);
      }
      if (ambientLightRef.current) {
        ambientLightRef.current.intensity = THREE.MathUtils.lerp(preset.ambientIntensity, 0.14, nf);
      }
      if (interiorPointRef.current) {
        interiorPointRef.current.intensity = THREE.MathUtils.lerp(
          preset.interiorAccentIntensity * spotScale,
          1.1 * spotScale * Math.max(0.35, frame.ledIntensityFactor),
          nf
        );
      }
      if (nightSpotRef.current) {
        nightSpotRef.current.intensity = 7.5 * spotScale * nf * Math.max(0.3, frame.ledIntensityFactor);
      }
      if (scene.background instanceof THREE.Color) {
        scene.background.copy(dayBgColor).lerp(nightBgColor, nf);
      }
    });
  }, [
    camera,
    scene,
    keyLightRef,
    hemiLightRef,
    ambientLightRef,
    interiorPointRef,
    nightSpotRef,
    spotScale,
    preset,
    renderStyle.sunIntensity,
    renderStyle.sunAngleDeg,
    cx,
    cz,
  ]);

  // Apply scrubbed / initial frame whenever playhead or videoStudio config changes while paused
  useEffect(() => {
    if (!videoStudioMode) {
      applyVideoFrameSync(null);
      invalidate();
      return;
    }
    const cfg = doc.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;
    if (!videoIsPlaying && (cfg.keyframes.length > 0 || cfg.events.length > 0)) {
      const frame = evaluateFrameAt(videoPlayheadSec, cfg, doc, lightingPreset, ledEnabled);
      applyVideoFrameSync(frame);
      invalidate();
    }
  }, [videoStudioMode, videoPlayheadSec, videoIsPlaying, doc, lightingPreset, ledEnabled, invalidate]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      applyVideoFrameSync(null);
    };
  }, []);

  // Smooth demand-driven live playback (returns to 0% GPU immediately when paused)
  useFrame((_, delta) => {
    if (!videoStudioMode || !videoIsPlaying) return;
    const cfg = doc.videoStudio ?? DEFAULT_VIDEO_STUDIO_CONFIG;
    const dt = Math.min(delta, 0.08);
    let nextT = liveTimeRef.current + dt;
    let reachedEnd = false;
    if (nextT >= cfg.durationSec) {
      nextT = cfg.durationSec;
      reachedEnd = true;
    }
    liveTimeRef.current = nextT;

    const frame = evaluateFrameAt(nextT, cfg, doc, lightingPreset, ledEnabled);
    applyVideoFrameSync(frame);
    invalidate();

    const now = performance.now();
    if (reachedEnd || now - lastUiSyncMsRef.current >= 60) {
      lastUiSyncMsRef.current = now;
      setVideoPlayheadSec(Number(nextT.toFixed(2)));
    }
    if (reachedEnd) {
      setVideoIsPlaying(false);
    }
  });

  return null;
}

function SymmetricInteriorEnv({
  intensity,
  resolution,
  isNight,
}: {
  intensity: number;
  resolution: number;
  isNight: boolean;
}) {
  const safeRes = Math.max(64, Math.min(256, resolution));
  const wallTint = isNight ? '#d8e4f5' : '#fffdf8';
  const ceilTint = isNight ? '#fff3dd' : '#ffffff';
  const floorTint = isNight ? '#4a3d31' : '#e8dfd2';
  const wallInt = isNight ? 0.55 : 0.85;
  const ceilInt = isNight ? 0.75 : 1.15;
  const floorInt = isNight ? 0.25 : 0.45;

  return (
    <Environment resolution={safeRes} frames={1} environmentIntensity={Math.max(0, intensity)}>
      {/* Balanced omnidirectional overhead softbox */}
      <Lightformer
        form="rect"
        intensity={ceilInt}
        position={[0, 6, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[12, 12, 1]}
        color={ceilTint}
      />
      {/* 4 strictly symmetric cardinal wall softboxes so no wall or cabinet side is darker than its opposite */}
      <Lightformer
        form="rect"
        intensity={wallInt}
        position={[0, 2.5, -7]}
        rotation={[0, 0, 0]}
        scale={[12, 5, 1]}
        color={wallTint}
      />
      <Lightformer
        form="rect"
        intensity={wallInt}
        position={[0, 2.5, 7]}
        rotation={[0, Math.PI, 0]}
        scale={[12, 5, 1]}
        color={wallTint}
      />
      <Lightformer
        form="rect"
        intensity={wallInt}
        position={[7, 2.5, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        scale={[12, 5, 1]}
        color={wallTint}
      />
      <Lightformer
        form="rect"
        intensity={wallInt}
        position={[-7, 2.5, 0]}
        rotation={[0, Math.PI / 2, 0]}
        scale={[12, 5, 1]}
        color={wallTint}
      />
      {/* Gentle symmetric floor bounce */}
      <Lightformer
        form="rect"
        intensity={floorInt}
        position={[0, -4, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[12, 12, 1]}
        color={floorTint}
      />
    </Environment>
  );
}

interface SceneContentProps {
  cameraZones: CameraZonePreset[];
  targetFov: number;
  onContextLostChange?: (lost: boolean) => void;
}

function SceneContent({ cameraZones, targetFov, onContextLostChange }: SceneContentProps) {
  const doc = useProjectStore((s) => s.document);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectedKind = useUIStore((s) => s.selectedKind);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const cameraMode = useUIStore((s) => s.cameraMode);
  const presentationMode = useUIStore((s) => s.presentationMode);
  const wallCutaway = useUIStore((s) => s.wallCutaway);
  const cabinetCutaway = useUIStore((s) => s.cabinetCutaway);
  const activeCameraZoneId = useUIStore((s) => s.activeCameraZoneId);
  const cameraTransitionNonce = useUIStore((s) => s.cameraTransitionNonce);
  const renderStyle = useUIStore((s) => s.renderStyle);
  const renderQuality = useUIStore((s) => s.renderQuality);
  const isDragging3D = useUIStore((s) => s.isDragging3D);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);
  const openAll = useUIStore((s) => s.openAll);
  const openModuleIds = useUIStore((s) => s.openModuleIds);
  const isCapturingRender = useUIStore((s) => s.isCapturingRender);
  const videoStudioMode = useUIStore((s) => s.videoStudioMode);
  const videoIsPlaying = useUIStore((s) => s.videoIsPlaying);

  const exportGroupRef = useRef<THREE.Group | null>(null);
  const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
  const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null);
  const interiorPointRef = useRef<THREE.PointLight | null>(null);
  const nightSpotRef = useRef<THREE.SpotLight | null>(null);
  const roomCenterTargetObj = useMemo(() => new THREE.Object3D(), []);
  const spotTargetObj = useMemo(() => new THREE.Object3D(), []);
  const deviceProfile = useMemo(() => getDeviceQualityProfile(), []);

  const moduleOutputs = useMemo(() => selectProjectModuleOutputs(doc), [doc]);
  const collisionIds = useMemo(() => selectCollisionModuleIds(doc), [doc]);
  const bounds = useMemo(() => computeRoomBounds(doc.walls, true), [doc.walls]);
  const wallMetricsList = useMemo(() => analyzeWalls(doc.walls), [doc.walls]);
  const ceilingLighting = useMemo(
    () => resolveCeilingLighting(doc.walls, doc.ceilingLighting),
    [doc.walls, doc.ceilingLighting]
  );
  const enabledCeilingSpots = useMemo(
    () =>
      ceilingLighting.spotsEnabled
        ? ceilingLighting.spots.filter((s) => s.enabled !== false)
        : [],
    [ceilingLighting]
  );
  const spotScale =
    ceilingLighting.spotsEnabled && enabledCeilingSpots.length > 0
      ? ceilingLighting.spotIntensity
      : 0;
  const spotCentroidM = useMemo<[number, number]>(() => {
    if (enabledCeilingSpots.length === 0) {
      return [bounds.center.x * 0.001, bounds.center.z * 0.001];
    }
    let sx = 0;
    let sz = 0;
    for (const sp of enabledCeilingSpots) {
      sx += sp.xMm;
      sz += sp.zMm;
    }
    return [(sx / enabledCeilingSpots.length) * 0.001, (sz / enabledCeilingSpots.length) * 0.001];
  }, [enabledCeilingSpots, bounds.center.x, bounds.center.z]);
  const safeRoomCenterM = useMemo<[number, number]>(() => {
    const safePt = findSafeRoomInteriorPoint(doc.walls, wallMetricsList);
    return [safePt.x * 0.001, safePt.z * 0.001];
  }, [doc.walls, wallMetricsList]);

  const preset = getRenderStylePreset(renderStyle.styleId);
  const cx = bounds.center.x * 0.001;
  const cz = bounds.center.z * 0.001;
  const isNight = lightingPreset === 'nuit';
  const isClientMode = presentationMode === 'client';
  const isPresentationClean = isClientMode || videoStudioMode;
  const autoCutaway = !isPresentationClean && wallCutaway && cameraMode === 'orbit';
  // Scoped cutaway: cabinets & wall-mounted props ONLY hide when attached/flush to a currently cut-away wall
  const autoCabinetCutaway = autoCutaway && cabinetCutaway;

  // Compute directional sun position from live sunAngleDeg (0–360°) & preset elevation
  const sunPosition = useMemo<[number, number, number]>(() => {
    const azRad = (renderStyle.sunAngleDeg * Math.PI) / 180;
    const elRad = (preset.sunElevationDeg * Math.PI) / 180;
    const dist = 11.5;
    const horiz = Math.cos(elRad) * dist;
    const sy = Math.max(2.2, Math.sin(elRad) * dist);
    return [cx + Math.cos(azRad) * horiz, sy, cz - Math.sin(azRad) * horiz];
  }, [cx, cz, renderStyle.sunAngleDeg, preset.sunElevationDeg]);

  // Opposite fill light direction
  const fillPosition = useMemo<[number, number, number]>(() => {
    const azRad = ((renderStyle.sunAngleDeg + 180) * Math.PI) / 180;
    return [cx + Math.cos(azRad) * 6, 4.0, cz - Math.sin(azRad) * 6];
  }, [cx, cz, renderStyle.sunAngleDeg]);

  // Effective HDRI intensity respects both live slider and explicit Jour/Nuit toggle
  const effectiveHdriIntensity =
    isNight && !preset.isNightMood
      ? Math.min(0.22, renderStyle.hdriIntensity * 0.3)
      : renderStyle.hdriIntensity;

  const effectiveSunIntensity =
    isNight && !preset.isNightMood
      ? Math.min(0.35, renderStyle.sunIntensity * 0.25)
      : renderStyle.sunIntensity;

  const bgHex = isNight
    ? isClientMode
      ? '#060c1a'
      : '#080e1c'
    : isClientMode
      ? preset.clientBgHex
      : preset.conceptionBgHex;

  // Cap pooled LED & luminaire point lights to preserve 60 FPS WebGL shader budget
  let ledLightBudget = 4;
  let propLightBudget = 4;

  const contactScale = Math.max(
    8,
    Math.max(bounds.widthMm, bounds.depthMm) * 0.001 + 2.5
  );

  // Bake ContactShadows ONCE per room/module/prop geometry edit, FROZEN during live drag to avoid RT thrashing
  const rawContactBakeKey = useMemo(() => {
    const wallSig = doc.walls
      .map((w) => `${w.startMm[0]},${w.startMm[1]}-${w.endMm[0]},${w.endMm[1]}`)
      .join('|');
    const modSig = doc.modules
      .map(
        (m) =>
          `${m.id}:${Math.round(m.xMm)},${Math.round(m.yMm)},${Math.round(m.zMm)},${m.widthMm}x${m.depthMm}`
      )
      .join('|');
    const propSig = (doc.props ?? [])
      .map(
        (p) =>
          `${p.id}:${Math.round(p.xMm)},${Math.round(p.yMm)},${Math.round(p.zMm)},${p.widthMm}x${p.depthMm}`
      )
      .join('|');
    return `${doc.id}:${renderStyle.styleId}:${lightingPreset}:${wallSig}:${modSig}:${propSig}`;
  }, [doc.id, doc.walls, doc.modules, doc.props, renderStyle.styleId, lightingPreset]);

  const stableContactKeyRef = useRef<string>(rawContactBakeKey);
  if (!isDragging3D) {
    stableContactKeyRef.current = rawContactBakeKey;
  }
  const contactBakeKey = stableContactKeyRef.current;

  // Tight dynamic sun shadow frustum matched to room bounds (+100% effective shadow texel sharpness at 0 GPU cost)
  const sunShadowHalf = Math.max(
    2.6,
    Math.min(7.0, Math.max(bounds.widthMm, bounds.depthMm) * 0.00062 + 0.9)
  );
  const sunCastsShadow = effectiveSunIntensity > 0.01;
  const showEdgeLines = renderStyle.edgeLinesOpacity > 0.005;

  // Keep directional sun aimed at room center & downward ceiling spot aimed at active spot centroid
  useEffect(() => {
    roomCenterTargetObj.position.set(cx, 0.75, cz);
    roomCenterTargetObj.updateMatrixWorld();
    spotTargetObj.position.set(spotCentroidM[0], 0.75, spotCentroidM[1]);
    spotTargetObj.updateMatrixWorld();
    if (keyLightRef.current) {
      keyLightRef.current.target = roomCenterTargetObj;
      keyLightRef.current.shadow.camera.updateProjectionMatrix();
    }
    if (nightSpotRef.current) {
      nightSpotRef.current.target = spotTargetObj;
    }
  }, [cx, cz, spotCentroidM, sunShadowHalf, roomCenterTargetObj, spotTargetObj]);

  const ceilingY = Math.max(2.0, doc.ceilingHeightMm * 0.001 - 0.18);
  const showWarmShowroomSpots =
    renderStyle.styleId === 'showroom_luxe' ||
    renderStyle.styleId === 'ambiance_soiree' ||
    isNight;

  const qualityCfg = useMemo(() => {
    if (renderQuality === 'ultra') {
      return {
        shadowSize: deviceProfile.isMobileOrTablet ? 2048 : 4096,
        envRes: deviceProfile.isMobileOrTablet ? 128 : 256,
        contactRes: deviceProfile.isMobileOrTablet ? 512 : 1024,
      };
    }
    if (renderQuality === 'fort') {
      return {
        shadowSize: deviceProfile.isMobileOrTablet ? 1024 : 2048,
        envRes: 128,
        contactRes: 512,
      };
    }
    return {
      shadowSize: 1024,
      envRes: 64,
      contactRes: 256,
    };
  }, [renderQuality, deviceProfile]);

  // Real Bundled Local 1K Architectural Daylight HDRI (100% offline from public/env/)
  return (
    <>
      <primitive object={roomCenterTargetObj} />
      <primitive object={spotTargetObj} />
      <SceneBridge
        exportGroupRef={exportGroupRef}
        keyLightRef={keyLightRef}
        preset={preset}
        renderStyle={renderStyle}
        onContextLostChange={onContextLostChange}
      />
      <VideoPlaybackController
        keyLightRef={keyLightRef}
        hemiLightRef={hemiLightRef}
        ambientLightRef={ambientLightRef}
        interiorPointRef={interiorPointRef}
        nightSpotRef={nightSpotRef}
        spotScale={spotScale}
        preset={preset}
        renderStyle={renderStyle}
        cx={cx}
        cz={cz}
      />

      <color attach="background" args={[bgHex]} />

      {/* Symmetric 360° Interior Softbox IBL: eliminates unilateral dark/bright wall splits and harsh outdoor sky glare */}
      <SymmetricInteriorEnv
        intensity={effectiveHdriIntensity}
        resolution={qualityCfg.envRes}
        isNight={isNight}
      />

      {/* Uniform omnidirectional ambient & hemisphere base fill (identical on all 4 wall directions) */}
      <hemisphereLight
        ref={hemiLightRef}
        args={[
          isNight ? '#334155' : preset.hemiSkyHex,
          isNight ? '#2c2520' : preset.hemiGroundHex,
          isNight ? 0.36 : preset.hemiIntensity * 0.88,
        ]}
      />
      <ambientLight
        ref={ambientLightRef}
        intensity={isNight ? 0.16 : preset.ambientIntensity * 0.9}
        color={isNight ? '#cbd5e1' : '#fffdf9'}
      />

      {/* Primary Directional Sun / Key Light: only active when sunIntensity > 0 */}
      <directionalLight
        key={`sun-${renderQuality}`}
        ref={keyLightRef}
        position={sunPosition}
        intensity={effectiveSunIntensity}
        color={isNight ? '#93c5fd' : preset.sunColorHex}
        castShadow={sunCastsShadow}
        shadow-mapSize-width={qualityCfg.shadowSize}
        shadow-mapSize-height={qualityCfg.shadowSize}
        shadow-camera-near={0.5}
        shadow-camera-far={24}
        shadow-camera-left={-sunShadowHalf}
        shadow-camera-right={sunShadowHalf}
        shadow-camera-top={sunShadowHalf}
        shadow-camera-bottom={-sunShadowHalf}
        shadow-bias={-0.00028}
        shadow-normalBias={0.018}
        shadow-radius={renderQuality === 'ultra' ? 2.4 : renderStyle.styleId === 'soleil_naturel' ? 1.8 : 2.6}
      />

      {/* Subtle Opposing Sky Fill ONLY when directional sunlight is actually enabled (zero leakage when lights are off!) */}
      {effectiveSunIntensity > 0.05 && (
        <directionalLight
          position={fillPosition}
          intensity={Math.min(0.32, (isNight ? 0.08 : preset.fillIntensity * 0.55) * Math.min(1, effectiveSunIntensity))}
          color={isNight ? '#60a5fa' : preset.fillColorHex}
        />
      )}

      {/* Interior Warm Ceiling Fill (strictly scales to 0 when ceiling spots are turned OFF) */}
      <pointLight
        ref={interiorPointRef}
        position={[spotCentroidM[0], ceilingY, spotCentroidM[1]]}
        intensity={
          spotScale <= 0.01
            ? 0
            : isNight
              ? 1.05 * spotScale
              : preset.interiorAccentIntensity * 0.55 * spotScale
        }
        distance={10}
        decay={2}
        color={isNight ? '#ffd296' : preset.interiorAccentHex}
      />

      {/* Single-Pass Downward Ceiling SpotLight positioned at active ceiling spots centroid */}
      {(isNight || showWarmShowroomSpots || videoStudioMode) && (
        <spotLight
          ref={nightSpotRef}
          position={[spotCentroidM[0], ceilingY + 0.08, spotCentroidM[1]]}
          intensity={
            isNight
              ? 7.5 * spotScale
              : showWarmShowroomSpots
                ? 2.8 * spotScale
                : 0
          }
          distance={10}
          angle={Math.PI * 0.46}
          penumbra={0.92}
          decay={2}
          color="#ffd7a1"
          castShadow={spotScale > 0.02}
          shadow-mapSize-width={deviceProfile.nightSpotShadowSize}
          shadow-mapSize-height={deviceProfile.nightSpotShadowSize}
          shadow-bias={-0.0003}
          shadow-normalBias={0.02}
        />
      )}

      {/* Individual positioned ceiling spotlight pools (softly calibrated to prevent glossy cabinet/floor glare) */}
      {spotScale > 0.01 &&
        enabledCeilingSpots.slice(0, 4).map((sp) => {
          const countNorm = Math.max(1, Math.sqrt(Math.min(4, enabledCeilingSpots.length)));
          const basePerSpot = (isNight ? 1.35 : showWarmShowroomSpots ? 0.85 : 0.45) / countNorm;
          const spInt = basePerSpot * spotScale * (sp.intensity ?? 1);
          if (spInt <= 0.01) return null;
          return (
            <pointLight
              key={`ceil-spot-light-${sp.id}`}
              position={[sp.xMm * 0.001, ceilingY - 0.06, sp.zMm * 0.001]}
              intensity={spInt}
              distance={5.5}
              decay={2}
              color="#ffdfb3"
            />
          );
        })}

      {/* ContactShadows baked ONCE per edit (frames={1}, zero per-frame GPU cost) */}
      <ContactShadows
        key={`${contactBakeKey}:${renderQuality}`}
        position={[cx, 0.0025, cz]}
        opacity={preset.contactShadowOpacity}
        scale={contactScale}
        blur={renderStyle.styleId === 'homebyme_clair' ? 2.4 : 1.9}
        far={1.35}
        frames={1}
        resolution={qualityCfg.contactRes}
        color="#1c1917"
      />

      {/* Neutral studio reference grid in Mode Conception (hidden in Vue Client, Studio Vidéo & PNG capture) */}
      {!isPresentationClean && !isCapturingRender && (
        <gridHelper
          args={[
            16,
            32,
            isNight || renderStyle.styleId === 'showroom_luxe' ? '#334155' : '#94a3b8',
            isNight || renderStyle.styleId === 'showroom_luxe' ? '#1e293b' : '#cbd5e1',
          ]}
          position={[cx, -0.005, cz]}
        />
      )}

      {/* Real 3D Procedural Exterior Scenery in Vue Client & Studio Vidéo (kept outside GLB exportGroup) */}
      {isPresentationClean && (
        <ExteriorScenery3D bounds={bounds} lightingPreset={lightingPreset} />
      )}

      {/* Clean Exportable Architecture, Parametric Modules & Appliances/Decor Group */}
      <group
        ref={exportGroupRef}
        name="Atelier3D_Scene"
        onPointerMissed={(e) => {
          // Only deselect on a clean click in empty space (never during/after an orbit drag)
          if (!isPresentationClean && e.type === 'click') clearSelection();
        }}
      >
        <RoomMesh
          doc={doc}
          autoCutaway={autoCutaway}
          showCeiling={isPresentationClean}
          isNight={isNight}
          isClientMode={isPresentationClean}
          isCapturingRender={isCapturingRender || videoStudioMode}
          showEdgeLines={showEdgeLines}
        />

        {doc.modules.map((mod) => {
          const out = moduleOutputs.get(mod.id);
          if (!out) return null;
          const isOpen = openModuleIds[mod.id] ?? openAll;
          const wantsLed =
            (ledEnabled || videoStudioMode) &&
            (Boolean(mod.ledUnder) ||
              Boolean(mod.ledInterior) ||
              mod.type === 'caisson_haut' ||
              mod.type === 'meuble_vitrine');
          const allowLight = wantsLed && ledLightBudget > 0;
          if (allowLight) ledLightBudget--;

          return (
            <ParametricModuleMesh
              key={mod.id}
              module={mod}
              output={out}
              defaults={doc.defaultCarpentry}
              isSelected={!videoStudioMode && selectedKind === 'module' && selectedIds.includes(mod.id)}
              isColliding={!videoStudioMode && collisionIds.has(mod.id)}
              isOpen={isOpen}
              ledEnabled={ledEnabled || videoStudioMode}
              allowLedPointLight={allowLight}
              ledLightIntensity={preset.ledLightIntensity}
              ledEmissiveIntensity={preset.ledEmissiveIntensity}
              isCapturingRender={isCapturingRender || videoStudioMode}
              isClientMode={isPresentationClean}
              showEdgeLines={showEdgeLines}
              autoCabinetCutaway={autoCabinetCutaway}
              wallMetrics={wallMetricsList}
              roomCenterM={safeRoomCenterM}
            />
          );
        })}

        {(doc.props ?? []).map((prop) => {
          const propSpec = PROPS_CATALOG_BY_TYPE[prop.type];
          const wantsLight = Boolean(propSpec?.supportsLight) && prop.lightOn !== false;
          const allowLight = wantsLight && propLightBudget > 0;
          if (allowLight) propLightBudget--;

          return (
            <DecorPropMesh
              key={prop.id}
              prop={prop}
              ceilingHeightMm={doc.ceilingHeightMm}
              isSelected={!videoStudioMode && selectedKind === 'prop' && selectedIds.includes(prop.id)}
              isClientMode={isPresentationClean}
              isCapturingRender={isCapturingRender || videoStudioMode}
              allowPointLight={allowLight}
              isNight={isNight}
              autoCabinetCutaway={autoCabinetCutaway}
              wallMetrics={wallMetricsList}
              roomCenterM={safeRoomCenterM}
            />
          );
        })}
      </group>

      <WalkthroughControls
        cameraMode={cameraMode}
        presentationMode={presentationMode}
        videoStudioMode={videoStudioMode}
        videoIsPlaying={videoIsPlaying}
        bounds={bounds}
        walls={doc.walls}
        ceilingHeightMm={doc.ceilingHeightMm}
        cameraZones={cameraZones}
        activeCameraZoneId={activeCameraZoneId}
        cameraTransitionNonce={cameraTransitionNonce}
        targetFov={targetFov}
        isDragging3D={isDragging3D}
      />
    </>
  );
}

export function Scene3D() {
  const doc = useProjectStore((s) => s.document);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const toggleLightingPreset = useUIStore((s) => s.toggleLightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);
  const toggleLed = useUIStore((s) => s.toggleLed);
  const cameraMode = useUIStore((s) => s.cameraMode);
  const presentationMode = useUIStore((s) => s.presentationMode);
  const setPresentationMode = useUIStore((s) => s.setPresentationMode);
  const wallCutaway = useUIStore((s) => s.wallCutaway);
  const toggleWallCutaway = useUIStore((s) => s.toggleWallCutaway);
  const cabinetCutaway = useUIStore((s) => s.cabinetCutaway);
  const toggleCabinetCutaway = useUIStore((s) => s.toggleCabinetCutaway);
  const selectedId = useUIStore((s) => s.selectedId);
  const selectedKind = useUIStore((s) => s.selectedKind);
  const updateWall = useProjectStore((s) => s.updateWall);
  const updateCeilingLighting = useProjectStore((s) => s.updateCeilingLighting);
  const resolvedCeilingLighting = useMemo(
    () => resolveCeilingLighting(doc.walls, doc.ceilingLighting),
    [doc.walls, doc.ceilingLighting]
  );
  const selectedWall =
    selectedKind === 'wall' && selectedId
      ? doc.walls.find((w) => w.id === selectedId) ?? null
      : null;
  const activeCameraZoneId = useUIStore((s) => s.activeCameraZoneId);
  const selectCameraZone = useUIStore((s) => s.selectCameraZone);
  const interiorFov = useUIStore((s) => s.interiorFov);
  const exteriorFov = useUIStore((s) => s.exteriorFov);
  const setInteriorFov = useUIStore((s) => s.setInteriorFov);
  const setExteriorFov = useUIStore((s) => s.setExteriorFov);
  const renderStyle = useUIStore((s) => s.renderStyle);
  const selectRenderStyle = useUIStore((s) => s.selectRenderStyle);
  const updateRenderStyleSetting = useUIStore((s) => s.updateRenderStyleSetting);
  const resetRenderStyle = useUIStore((s) => s.resetRenderStyle);
  const openAll = useUIStore((s) => s.openAll);
  const toggleOpenAll = useUIStore((s) => s.toggleOpenAll);
  const openModuleIds = useUIStore((s) => s.openModuleIds);
  const renderQuality = useUIStore((s) => s.renderQuality);
  const setRenderQuality = useUIStore((s) => s.setRenderQuality);
  const videoStudioMode = useUIStore((s) => s.videoStudioMode);
  const setVideoStudioMode = useUIStore((s) => s.setVideoStudioMode);
  const isCapturingRender = useUIStore((s) => s.isCapturingRender);

  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [styleMenuOpen, setStyleMenuOpen] = useState(false);
  const [tuningOpen, setTuningOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cyclesModalOpen, setCyclesModalOpen] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const deviceProfile = useMemo(() => getDeviceQualityProfile(), []);

  const isClientMode = presentationMode === 'client';
  const isInteriorView =
    isClientMode ||
    cameraMode === 'walkthrough' ||
    (activeCameraZoneId !== null && activeCameraZoneId !== 'global');
  const activeFov = isInteriorView ? interiorFov : exteriorFov;
  const activePreset = getRenderStylePreset(renderStyle.styleId);

  const cameraZones = useMemo(() => computeCameraZones(doc), [doc]);
  const visibleCameraZones = useMemo(
    () => (isClientMode ? cameraZones.filter((z) => z.kind !== 'global') : cameraZones),
    [cameraZones, isClientMode]
  );

  const openCount = useMemo(
    () => doc.modules.filter((m) => openModuleIds[m.id] ?? openAll).length,
    [doc.modules, openModuleIds, openAll]
  );

  const activeZoneLabel =
    visibleCameraZones.find((z) => z.id === activeCameraZoneId)?.labelFr ??
    (isClientMode ? FR.cameraZones.title : FR.cameraZones.global);

  const canvasDpr: [number, number] =
    renderQuality === 'ultra'
      ? [1, deviceProfile.isMobileOrTablet ? 1.5 : 2]
      : renderQuality === 'fort'
        ? [1, Math.min(1.5, Math.max(1.25, deviceProfile.dpr[1]))]
        : [1, Math.min(1.15, deviceProfile.dpr[1])];

  const handleCopyRenderConfig = async () => {
    const payload = {
      style: renderStyle.styleId,
      nomStyleFr: activePreset.labelFr,
      toneMapping: activePreset.toneMapping,
      exposition: Number(renderStyle.exposure.toFixed(2)),
      intensiteHdri: Number(renderStyle.hdriIntensity.toFixed(2)),
      soleilLumiere: Number(renderStyle.sunIntensity.toFixed(2)),
      angleSoleilDeg: Math.round(renderStyle.sunAngleDeg),
      lignesAretesPct: Math.round(renderStyle.edgeLinesOpacity * 100),
      brillanceVernis: Number(renderStyle.glossBoost.toFixed(2)),
      fovDeg: activeFov,
      ledActives: ledEnabled,
      ambiance: lightingPreset,
    };
    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      // Fallback copy via textarea if clipboard permission is restricted
      const ta = document.createElement('textarea');
      ta.value = json;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2200);
  };

  return (
    <div
      data-testid="viewport-3d-canvas"
      data-open-modules={String(openCount)}
      data-presentation-mode={presentationMode}
      data-wall-cutaway={String(wallCutaway)}
      data-camera-fov={String(activeFov)}
      data-render-style={renderStyle.styleId}
      data-render-quality={renderQuality}
      data-device-profile={deviceProfile.id}
      className="relative h-full w-full overflow-hidden bg-atelier-viewport"
    >
      <Canvas
        frameloop="demand"
        shadows
        dpr={canvasDpr}
        gl={{
          preserveDrawingBuffer: false,
          antialias: true,
          powerPreference: 'high-performance',
          toneMapping:
            activePreset.toneMapping === 'agx'
              ? THREE.AgXToneMapping
              : THREE.ACESFilmicToneMapping,
          toneMappingExposure: renderStyle.exposure,
        }}
        camera={{ fov: activeFov, near: 0.05, far: 140, position: [4.2, 2.8, 4.8] }}
      >
        <SceneContent
          cameraZones={cameraZones}
          targetFov={activeFov}
          onContextLostChange={setContextLost}
        />
      </Canvas>

      {contextLost && (
        <div
          role="alert"
          className="atelier-glass absolute inset-0 z-40 flex items-center justify-center p-4 text-center"
        >
          <div className="max-w-sm space-y-1.5 rounded-xl border border-atelier-accent/50 bg-atelier-panel p-4 text-xs text-atelier-fg shadow-2xl">
            <div className="font-semibold text-atelier-accent-text">
              Contexte graphique 3D temporairement interrompu
            </div>
            <p className="text-atelier-muted">
              Restauration automatique du moteur WebGL en cours… Vos données sont conservées.
            </p>
          </div>
        </div>
      )}

      {/* French progress overlay during on-demand Rendu Photo 2K capture (outside WebGL canvas) */}
      {isCapturingRender && (
        <div
          role="status"
          data-testid="render-2k-progress"
          className="atelier-glass absolute inset-0 z-40 flex items-center justify-center p-4"
        >
          <div className="flex items-center gap-3 rounded-xl border border-atelier-accent/60 bg-atelier-panel px-5 py-3.5 text-sm font-semibold text-atelier-fg shadow-2xl">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-atelier-accent border-t-transparent" />
            <span>Génération du rendu Photo 2K…</span>
          </div>
        </div>
      )}

      {/* Integrated Studio Vidéo Overlay (Framing Mask, Presets, Keyframes & Offline Exporter) */}
      {videoStudioMode && !isCapturingRender && (
        <Suspense fallback={null}>
          <VideoStudioOverlay />
        </Suspense>
      )}

      {/* Photorealistic Blender Cycles Home-Server Modal */}
      {cyclesModalOpen && (
        <Suspense fallback={null}>
          <CyclesRenderModal
            open={cyclesModalOpen}
            onClose={() => setCyclesModalOpen(false)}
          />
        </Suspense>
      )}

      {/* Uncluttered & Deduplicated French 3D HUD Overlay */}
      {!isCapturingRender && !videoStudioMode && (
        <>
          {/* Top-Left Compact Controls: Conception tools OR Exit Client Mode */}
          <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-24px)] flex-wrap items-center gap-2">
            {isClientMode ? (
              <>
                <button
                  type="button"
                  data-testid="btn-mode-conception"
                  onClick={() => setPresentationMode('conception')}
                  className="atelier-glass inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold text-atelier-fg shadow-lg transition-colors hover:border-atelier-accent"
                >
                  <ArrowLeft className="h-3.5 w-3.5 text-atelier-accent-text" />
                  <span>Quitter Vue Client</span>
                </button>

                <div className="atelier-glass inline-flex h-9 items-center gap-1 rounded-full border px-1.5 text-xs shadow-lg">
                  <button
                    type="button"
                    data-testid="client-btn-lighting"
                    onClick={toggleLightingPreset}
                    className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium transition-colors ${
                      lightingPreset === 'nuit'
                        ? 'bg-indigo-500/25 text-atelier-info'
                        : 'text-atelier-accent-text hover:bg-atelier-surface'
                    }`}
                  >
                    {lightingPreset === 'jour' ? (
                      <Sun className="h-3.5 w-3.5" />
                    ) : (
                      <Moon className="h-3.5 w-3.5" />
                    )}
                    <span>{lightingPreset === 'jour' ? FR.lighting.jour : FR.lighting.nuit}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="client-btn-led"
                    onClick={toggleLed}
                    className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium transition-colors ${
                      ledEnabled
                        ? 'bg-atelier-accent/20 text-atelier-accent-text'
                        : 'text-atelier-muted hover:bg-atelier-surface'
                    }`}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    <span>LED</span>
                  </button>
                  <button
                    type="button"
                    data-testid="client-btn-open-all"
                    onClick={toggleOpenAll}
                    className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium transition-colors ${
                      openAll
                        ? 'bg-emerald-500/20 text-atelier-success'
                        : 'text-atelier-fg hover:bg-atelier-surface'
                    }`}
                  >
                    <DoorOpen className="h-3.5 w-3.5" />
                    <span>{openAll ? FR.animations.closeAll : FR.animations.openAll}</span>
                  </button>
                </div>

                {/* Client Mode 3-Tier Quality Pill */}
                <div
                  role="group"
                  aria-label="Qualité du rendu 3D"
                  className="atelier-glass inline-flex h-9 items-center gap-0.5 rounded-full border p-1 text-xs shadow-lg"
                >
                  {(
                    [
                      { id: 'standard', label: FR.renderQuality.standard },
                      { id: 'fort', label: FR.renderQuality.fort },
                      { id: 'ultra', label: FR.renderQuality.ultra },
                    ] as Array<{ id: RenderQuality; label: string }>
                  ).map((q) => {
                    const active = renderQuality === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        data-testid={`client-quality-${q.id}`}
                        onClick={() => setRenderQuality(q.id)}
                        className={`inline-flex h-7 items-center rounded-full px-2.5 font-medium transition-colors ${
                          active
                            ? 'bg-atelier-accent text-atelier-accent-fg'
                            : 'text-atelier-muted hover:text-atelier-fg'
                        }`}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>

                <div className="atelier-glass inline-flex h-9 items-center rounded-full border shadow-lg">
                  <button
                    type="button"
                    data-testid="client-btn-render-png"
                    onClick={() =>
                      void import('@/exports/render3dExport').then((m) => m.exportRenderPng())
                    }
                    className="inline-flex h-full items-center gap-1.5 rounded-l-full px-3 text-xs font-semibold text-atelier-accent-text transition-colors hover:bg-atelier-surface"
                    title="Capturer un rendu Photo Studio 2K (GTAO + Bloom + ombres 4K, sans interface)"
                  >
                    <ImageDown className="h-3.5 w-3.5" />
                    <span>Capture PNG (2K)</span>
                  </button>
                  <div className="h-4 w-px bg-atelier-border" />
                  <button
                    type="button"
                    data-testid="client-btn-share-png"
                    onClick={() =>
                      void import('@/exports/render3dExport').then((m) =>
                        m.exportRenderPng({ share: true })
                      )
                    }
                    className="inline-flex h-full items-center rounded-r-full px-2.5 text-atelier-info transition-colors hover:bg-atelier-surface"
                    title="Partager le rendu Photo 2K (WhatsApp / AirDrop / Fichiers)"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="client-btn-cycles-render"
                  onClick={() => setCyclesModalOpen(true)}
                  className="atelier-glass inline-flex h-9 items-center gap-1.5 rounded-full border border-atelier-accent/70 px-3 text-xs font-semibold text-atelier-accent-text shadow-lg transition-colors hover:bg-atelier-accent/15"
                  title="Rendu Photoréaliste Pro via serveur Blender Cycles (16× MSAA équiv.)"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Rendu Pro (Cycles)</span>
                </button>
              </>
            ) : (
              <>
                {/* Auto-Cutaway Wall Toggle */}
                <button
                  type="button"
                  data-testid="btn-wall-cutaway"
                  onClick={toggleWallCutaway}
                  className={`atelier-glass inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-md transition-colors ${
                    wallCutaway
                      ? 'border-atelier-accent/70 text-atelier-accent-text'
                      : 'text-atelier-muted hover:text-atelier-fg'
                  }`}
                  title="Couper automatiquement les murs face à la caméra"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>
                    {wallCutaway ? FR.wallCutaway.autoCut : FR.wallCutaway.fullWalls}
                  </span>
                </button>

                {/* Auto-Cutaway Cabinets Toggle */}
                <button
                  type="button"
                  data-testid="btn-cabinet-cutaway"
                  onClick={toggleCabinetCutaway}
                  className={`atelier-glass inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-md transition-colors ${
                    cabinetCutaway
                      ? 'border-atelier-accent/70 text-atelier-accent-text'
                      : 'text-atelier-muted hover:text-atelier-fg'
                  }`}
                  title="Masquer automatiquement les placards situés sur un mur coupé"
                >
                  <Box className="h-3.5 w-3.5" />
                  <span>{cabinetCutaway ? 'Placards auto-coupés' : 'Placards visibles'}</span>
                </button>

                {/* Quick Per-Wall Pin Override */}
                {selectedWall && (
                  <button
                    type="button"
                    data-testid="btn-hud-pin-wall"
                    onClick={() =>
                      updateWall(selectedWall.id, {
                        keepVisibleInCutaway: !selectedWall.keepVisibleInCutaway,
                      })
                    }
                    className={`atelier-glass inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium shadow-md transition-colors ${
                      selectedWall.keepVisibleInCutaway
                        ? 'border-emerald-400/70 text-emerald-300'
                        : 'text-atelier-muted hover:text-atelier-fg'
                    }`}
                    title="Garder ce mur toujours visible même en auto-coupe"
                  >
                    <Pin className="h-3.5 w-3.5" />
                    <span>
                      {selectedWall.keepVisibleInCutaway ? 'Mur épinglé' : 'Épingler mur'}
                    </span>
                  </button>
                )}

                {/* 3-Tier Quality Selector (Standard / Fort / Ultra) in Conception HUD */}
                <div
                  role="group"
                  aria-label="Qualité du rendu 3D"
                  className="atelier-glass inline-flex h-8 items-center gap-0.5 rounded-lg border p-0.5 shadow-md"
                >
                  {(
                    [
                      { id: 'standard', label: FR.renderQuality.standard },
                      { id: 'fort', label: FR.renderQuality.fort },
                      { id: 'ultra', label: FR.renderQuality.ultra },
                    ] as Array<{ id: RenderQuality; label: string }>
                  ).map((q) => {
                    const active = renderQuality === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        data-testid={`hud-quality-${q.id}`}
                        onClick={() => setRenderQuality(q.id)}
                        className={`inline-flex h-7 items-center rounded-md px-2 text-xs font-medium transition-colors ${
                          active
                            ? 'bg-atelier-accent text-atelier-accent-fg'
                            : 'text-atelier-muted hover:text-atelier-fg'
                        }`}
                        title={`Qualité 3D : ${q.label}`}
                      >
                        {q.label}
                      </button>
                    );
                  })}
                </div>

                {/* Studio Vidéo 3D Button in Conception HUD */}
                <button
                  type="button"
                  data-testid="btn-hud-video-studio"
                  onClick={() => setVideoStudioMode(true)}
                  className="atelier-glass inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-accent/60 px-2.5 text-xs font-semibold text-atelier-accent-text shadow-md transition-colors hover:bg-atelier-accent/15"
                  title="Ouvrir le Studio Vidéo 3D (animation caméra & export MP4/WebM)"
                >
                  <Film className="h-3.5 w-3.5" />
                  <span>{FR.videoStudio.title}</span>
                </button>

                {/* On-demand HD Render Capture + Quick Native Share */}
                <div className="atelier-glass inline-flex h-8 items-center rounded-lg border shadow-md">
                  <button
                    type="button"
                    data-testid="btn-hud-render-png"
                    onClick={() =>
                      void import('@/exports/render3dExport').then((m) => m.exportRenderPng())
                    }
                    className="inline-flex h-full items-center gap-1.5 rounded-l-lg px-2.5 text-xs font-medium text-atelier-accent-text hover:bg-atelier-surface"
                    title="Capturer un rendu 3D haute résolution (2×, ombres 2048px, sans interface)"
                  >
                    <ImageDown className="h-3.5 w-3.5" />
                    <span>Rendu PNG</span>
                  </button>
                  <div className="h-4 w-px bg-atelier-border" />
                  <button
                    type="button"
                    data-testid="btn-hud-share-png"
                    onClick={() =>
                      void import('@/exports/render3dExport').then((m) =>
                        m.exportRenderPng({ share: true })
                      )
                    }
                    className="inline-flex h-full items-center px-2 rounded-r-lg text-atelier-info hover:bg-atelier-surface"
                    title="Partager le rendu 3D (WhatsApp / AirDrop / Enregistrer)"
                    aria-label="Partager le rendu 3D"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  data-testid="btn-hud-cycles-render"
                  onClick={() => setCyclesModalOpen(true)}
                  className="atelier-glass inline-flex h-8 items-center gap-1.5 rounded-lg border border-atelier-accent/70 px-2.5 text-xs font-semibold text-atelier-accent-text shadow-md transition-colors hover:bg-atelier-accent/15"
                  title="Rendu Photoréaliste Pro via serveur Blender Cycles (16× MSAA équiv.)"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Rendu Pro (Cycles)</span>
                </button>
              </>
            )}

            {/* Compact Help Popover Trigger (replaces permanent cluttered hint banner) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setHelpOpen((v) => !v)}
                aria-label="Aide navigation 3D"
                title="Aide navigation 3D"
                className="atelier-glass inline-flex h-8 w-8 items-center justify-center rounded-lg border text-atelier-muted shadow-md hover:text-atelier-fg"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
              {helpOpen && (
                <div className="absolute left-0 top-full mt-1.5 w-64 rounded-xl border border-atelier-border bg-atelier-panel p-3 text-xs text-atelier-muted shadow-2xl">
                  <div className="mb-1 font-semibold text-atelier-fg">Navigation 3D</div>
                  <p className="leading-relaxed">
                    {cameraMode === 'walkthrough'
                      ? 'Visite libre : ZQSD / Flèches pour avancer · Glisser le fond pour orienter le regard.'
                      : 'Orbite : glisser le fond pour pivoter · Glisser un meuble pour déplacer · Clic simple pour ouvrir/fermer.'}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Bottom-Center Unified Floating Glass Bar: Camera Zones + FOV + Render Style + Tuning */}
          <div className="absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-col items-center gap-2">
            {/* Collapsible Live Tuning Drawer ("Réglages Visuels") */}
            {tuningOpen && (
              <div
                data-testid="render-tuning-drawer"
                className="w-76 rounded-xl border border-atelier-border bg-atelier-panel p-3.5 text-xs text-atelier-fg shadow-2xl space-y-2.5"
              >
                <div className="flex items-center justify-between border-b border-atelier-border pb-2">
                  <div>
                    <div className="font-semibold text-atelier-accent-text">Réglages Visuels</div>
                    <div className="text-xs text-atelier-muted">{activePreset.labelFr}</div>
                  </div>
                  <button
                    type="button"
                    onClick={resetRenderStyle}
                    title="Réinitialiser les curseurs du style actif"
                    className="inline-flex items-center gap-1 rounded border border-atelier-border px-2 py-1 text-xs text-atelier-muted hover:border-atelier-accent hover:text-atelier-fg"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Défaut</span>
                  </button>
                </div>

                {/* Exposition */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Exposition</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {renderStyle.exposure.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-exposure"
                    min={0.6}
                    max={1.8}
                    step={0.02}
                    value={renderStyle.exposure}
                    onChange={(e) =>
                      updateRenderStyleSetting({ exposure: Number(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                {/* Intensité HDRI / Reflets */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Intensité HDRI / Reflets</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {renderStyle.hdriIntensity.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-hdri"
                    min={0}
                    max={1.5}
                    step={0.02}
                    value={renderStyle.hdriIntensity}
                    onChange={(e) =>
                      updateRenderStyleSetting({ hdriIntensity: Number(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                {/* Soleil / Lumière */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Soleil / Lumière</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {renderStyle.sunIntensity.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-sun-intensity"
                    min={0}
                    max={3.0}
                    step={0.05}
                    value={renderStyle.sunIntensity}
                    onChange={(e) =>
                      updateRenderStyleSetting({ sunIntensity: Number(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                {/* Angle du soleil */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Angle du soleil</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {Math.round(renderStyle.sunAngleDeg)}°
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-sun-angle"
                    min={0}
                    max={360}
                    step={2}
                    value={renderStyle.sunAngleDeg}
                    onChange={(e) =>
                      updateRenderStyleSetting({ sunAngleDeg: Number(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                {/* Lignes arêtes (SketchUp) */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Lignes arêtes (SketchUp)</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {Math.round(renderStyle.edgeLinesOpacity * 100)} %
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-edge-lines"
                    min={0}
                    max={60}
                    step={1}
                    value={Math.round(renderStyle.edgeLinesOpacity * 100)}
                    onChange={(e) =>
                      updateRenderStyleSetting({
                        edgeLinesOpacity: Number(e.target.value) / 100,
                      })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                {/* Intensité des spots plafond */}
                <div className="space-y-1 border-t border-atelier-border pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-atelier-muted">Spots plafond</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-atelier-accent-text tabular-nums">
                        {resolvedCeilingLighting.spotsEnabled
                          ? `${Math.round(resolvedCeilingLighting.spotIntensity * 100)} %`
                          : 'OFF'}
                      </span>
                      <button
                        type="button"
                        data-testid="btn-toggle-ceiling-spots"
                        onClick={() =>
                          updateCeilingLighting({
                            spotsEnabled: !resolvedCeilingLighting.spotsEnabled,
                          })
                        }
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                          resolvedCeilingLighting.spotsEnabled
                            ? 'bg-atelier-accent/20 text-atelier-accent-text'
                            : 'border border-atelier-border bg-atelier-surface text-atelier-muted'
                        }`}
                      >
                        {resolvedCeilingLighting.spotsEnabled ? 'ON' : 'OFF'}
                      </button>
                    </div>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-spot-intensity"
                    min={0}
                    max={150}
                    step={5}
                    value={Math.round(resolvedCeilingLighting.spotIntensity * 100)}
                    onChange={(e) => {
                      const pct = Number(e.target.value);
                      runContinuousEdit(() =>
                        updateCeilingLighting({
                          spotsEnabled: pct > 0,
                          spotIntensity: pct / 100,
                        })
                      );
                    }}
                    onPointerUp={flushContinuousEdit}
                    onBlur={flushContinuousEdit}
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </div>

                {/* Brillance / Vernis */}
                <label className="block space-y-1">
                  <div className="flex justify-between">
                    <span className="text-atelier-muted">Brillance / Vernis</span>
                    <span className="font-mono text-atelier-accent-text tabular-nums">
                      {renderStyle.glossBoost.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid="slider-gloss-boost"
                    min={0}
                    max={1}
                    step={0.02}
                    value={renderStyle.glossBoost}
                    onChange={(e) =>
                      updateRenderStyleSetting({ glossBoost: Number(e.target.value) })
                    }
                    className="h-1.5 w-full cursor-pointer accent-atelier-accent"
                  />
                </label>

                <button
                  type="button"
                  data-testid="btn-copy-render-config"
                  onClick={() => void handleCopyRenderConfig()}
                  className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-atelier-accent text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
                >
                  {copiedNotice ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Réglages copiés !</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copier les réglages</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Style Preset Popover (collapsed into single pill button) */}
            {styleMenuOpen && (
              <div
                data-testid="render-style-bar"
                className="flex flex-wrap items-center justify-center gap-1 rounded-xl border border-atelier-border bg-atelier-panel p-1.5 text-xs shadow-2xl"
              >
                {RENDER_STYLE_PRESETS.map((p) => {
                  const active = renderStyle.styleId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      data-testid={`render-style-${p.id}`}
                      title={p.descriptionFr}
                      onClick={() => {
                        selectRenderStyle(p.id);
                        setStyleMenuOpen(false);
                      }}
                      className={`rounded-lg px-2.5 py-1 font-medium transition-colors ${
                        active
                          ? 'bg-atelier-accent text-atelier-accent-fg shadow-sm'
                          : 'text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg'
                      }`}
                    >
                      {p.labelFr}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Main Bottom-Center Glass Cluster */}
            <div className="atelier-glass flex flex-wrap items-center justify-center gap-1.5 rounded-full border px-2.5 py-1 text-xs shadow-xl">
              {/* Camera Zones */}
              <div className="relative">
                <button
                  type="button"
                  data-testid="btn-camera-zones"
                  onClick={() => setCameraMenuOpen((v) => !v)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium text-atelier-fg hover:bg-atelier-surface"
                >
                  <Camera className="h-3.5 w-3.5 text-atelier-accent-text" />
                  <span>{activeZoneLabel}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-atelier-muted" />
                </button>

                {cameraMenuOpen && (
                  <div
                    data-testid="camera-zones-menu"
                    className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-atelier-border bg-atelier-panel p-1.5 shadow-2xl"
                  >
                    <div className="px-2 py-1 text-xs font-semibold text-atelier-muted">
                      {FR.cameraZones.title}
                    </div>
                    {visibleCameraZones.map((zone) => {
                      const active = activeCameraZoneId === zone.id;
                      return (
                        <button
                          key={zone.id}
                          type="button"
                          data-testid={`camera-zone-${zone.id}`}
                          onClick={() => {
                            selectCameraZone(zone.id);
                            setCameraMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                            active
                              ? 'bg-atelier-accent/20 font-semibold text-atelier-accent-text'
                              : 'text-atelier-fg hover:bg-atelier-surface'
                          }`}
                        >
                          <span className="truncate">{zone.labelFr}</span>
                          <span className="text-xs text-atelier-subtle">
                            {zone.kind === 'global'
                              ? 'Iso'
                              : zone.kind === 'corner'
                                ? 'Angle'
                                : 'Int.'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="h-4 w-px bg-atelier-border" />

              {/* Wide-angle FOV Slider */}
              <label
                className="inline-flex h-7 items-center gap-1.5 px-1.5 text-xs text-atelier-fg"
                title={FR.cameraZones.fovLabel}
              >
                <span className="text-atelier-muted">FOV</span>
                <input
                  type="range"
                  data-testid="slider-camera-fov"
                  aria-label={FR.cameraZones.fovLabel}
                  min={MIN_CAMERA_FOV}
                  max={MAX_CAMERA_FOV}
                  step={1}
                  value={activeFov}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (isInteriorView) setInteriorFov(val);
                    else setExteriorFov(val);
                  }}
                  className="h-1.5 w-20 cursor-pointer accent-atelier-accent"
                />
                <span className="w-8 text-right font-mono text-xs text-atelier-accent-text tabular-nums">
                  {activeFov}°
                </span>
              </label>

              {!isClientMode && (
                <>
                  <div className="h-4 w-px bg-atelier-border" />
                  <button
                    type="button"
                    data-testid="btn-toggle-render-styles"
                    onClick={() => setStyleMenuOpen((v) => !v)}
                    className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 font-medium transition-colors ${
                      styleMenuOpen
                        ? 'bg-atelier-accent text-atelier-accent-fg'
                        : 'text-atelier-fg hover:bg-atelier-surface'
                    }`}
                  >
                    <Palette className="h-3.5 w-3.5" />
                    <span>{activePreset.shortLabelFr}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="btn-render-tuning"
                    onClick={() => setTuningOpen((v) => !v)}
                    className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium transition-colors ${
                      tuningOpen
                        ? 'bg-sky-500 text-white'
                        : 'text-atelier-info hover:bg-atelier-surface'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    <span>Réglages</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
