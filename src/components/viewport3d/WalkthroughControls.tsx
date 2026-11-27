import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import type { WallSegment } from '@/types';
import {
  clampCameraInsideRoom,
  clampTargetInsideRoom,
  type CameraZonePreset,
  type RoomBounds,
} from '@/engine/geometry';
import type { CameraMode, PresentationMode } from '@/store/useUIStore';
import { registerOrbitTargetBridge } from './videoRuntimeRef';

const MM = 0.001;

interface WalkthroughControlsProps {
  cameraMode: CameraMode;
  presentationMode: PresentationMode;
  videoStudioMode?: boolean;
  videoIsPlaying?: boolean;
  bounds: RoomBounds;
  walls: WallSegment[];
  ceilingHeightMm: number;
  cameraZones: CameraZonePreset[];
  activeCameraZoneId: string | null;
  cameraTransitionNonce: number;
  targetFov: number;
  isDragging3D: boolean;
}

interface TransitionState {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTarget: THREE.Vector3;
  endTarget: THREE.Vector3;
  elapsed: number;
  duration: number;
}

export function WalkthroughControls({
  cameraMode,
  presentationMode,
  videoStudioMode = false,
  videoIsPlaying = false,
  bounds,
  walls,
  ceilingHeightMm,
  cameraZones,
  activeCameraZoneId,
  cameraTransitionNonce,
  targetFov,
  isDragging3D,
}: WalkthroughControlsProps) {
  const { camera, gl, invalidate } = useThree();
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const lookingRef = useRef(false);
  const lastMouseRef = useRef<[number, number]>([0, 0]);
  const transitionRef = useRef<TransitionState | null>(null);
  const lastNonceRef = useRef<number>(cameraTransitionNonce);
  const prevPresentationModeRef = useRef<PresentationMode>(presentationMode);

  const isClientMode = presentationMode === 'client';
  const centerX = bounds.center.x * MM;
  const centerZ = bounds.center.z * MM;

  // Helper to launch a smooth animated transition to a viewpoint
  const startTransition = (posM: [number, number, number], targetM: [number, number, number], duration = 0.65) => {
    const safePos = isClientMode
      ? clampCameraInsideRoom(posM, walls, ceilingHeightMm, 220)
      : posM;
    const safeTarget = isClientMode
      ? clampTargetInsideRoom(targetM, walls, ceilingHeightMm)
      : targetM;

    const currentTarget = orbitRef.current
      ? orbitRef.current.target.clone()
      : new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion).add(camera.position);

    transitionRef.current = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(safePos[0], safePos[1], safePos[2]),
      startTarget: currentTarget,
      endTarget: new THREE.Vector3(safeTarget[0], safeTarget[1], safeTarget[2]),
      elapsed: 0,
      duration,
    };
    invalidate();
  };

  // Position camera sensibly when switching between orbit and walkthrough
  useEffect(() => {
    transitionRef.current = null;
    if (cameraMode === 'walkthrough') {
      const rawPos: [number, number, number] = [
        centerX,
        Math.min(1.55, ceilingHeightMm * MM - 0.35),
        centerZ + Math.max(0.8, bounds.depthMm * MM * 0.28),
      ];
      const pos = isClientMode
        ? clampCameraInsideRoom(rawPos, walls, ceilingHeightMm, 350)
        : rawPos;
      camera.position.set(pos[0], pos[1], pos[2]);
      camera.lookAt(centerX, 1.3, bounds.minZ * MM + 0.2);
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
      yawRef.current = euler.y;
      pitchRef.current = euler.x;
    } else if (!isClientMode) {
      const span = Math.max(3.5, Math.hypot(bounds.widthMm, bounds.depthMm) * MM);
      camera.position.set(centerX + span * 0.62, Math.max(2.4, span * 0.56), centerZ + span * 0.72);
      camera.lookAt(centerX, 0.9, centerZ);
      if (orbitRef.current) {
        orbitRef.current.target.set(centerX, 0.9, centerZ);
        orbitRef.current.update();
      }
    }
    invalidate();
  }, [cameraMode, camera, centerX, centerZ, bounds.depthMm, bounds.widthMm, bounds.minZ, ceilingHeightMm, isClientMode, walls, invalidate]);

  // Smoothly enter/exit Vue Client mode
  useEffect(() => {
    const prev = prevPresentationModeRef.current;
    prevPresentationModeRef.current = presentationMode;
    if (prev === presentationMode) return;

    if (presentationMode === 'client') {
      // Pick first interior corner or wall viewpoint so client starts inside looking across the room
      const interiorPreset =
        cameraZones.find((z) => z.kind === 'corner') ??
        cameraZones.find((z) => z.kind === 'wall');
      if (interiorPreset) {
        startTransition(interiorPreset.positionM, interiorPreset.targetM, 0.7);
      } else {
        const clamped = clampCameraInsideRoom([centerX, 1.5, centerZ], walls, ceilingHeightMm, 350);
        startTransition(clamped, [centerX, 1.15, bounds.minZ * MM + 0.3], 0.7);
      }
    } else {
      const globalPreset = cameraZones.find((z) => z.id === 'global');
      if (globalPreset) {
        startTransition(globalPreset.positionM, globalPreset.targetM, 0.6);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationMode]);

  // Trigger smooth animated transition when user clicks a camera zone preset
  useEffect(() => {
    if (cameraTransitionNonce === lastNonceRef.current) return;
    lastNonceRef.current = cameraTransitionNonce;
    if (!activeCameraZoneId) return;

    const preset = cameraZones.find((z) => z.id === activeCameraZoneId);
    if (!preset) return;
    if (isClientMode && preset.kind === 'global') return;

    startTransition(preset.positionM, preset.targetM, 0.65);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraTransitionNonce, activeCameraZoneId]);

  // Register imperative OrbitControls target bridge for Studio Vidéo keyframe capture & playback
  useEffect(() => {
    registerOrbitTargetBridge({
      getTargetM: () => {
        if (orbitRef.current) {
          const t = orbitRef.current.target;
          return [t.x, t.y, t.z];
        }
        const dir = new THREE.Vector3(0, 0, -2.2).applyQuaternion(camera.quaternion).add(camera.position);
        return [dir.x, dir.y, dir.z];
      },
      setTargetM: (x, y, z) => {
        if (orbitRef.current) {
          orbitRef.current.target.set(x, y, z);
          orbitRef.current.update();
        } else {
          camera.lookAt(x, y, z);
        }
      },
    });
    return () => registerOrbitTargetBridge(null);
  }, [camera]);

  // Ensure on-demand frameloop wakes up whenever targetFov changes
  useEffect(() => {
    invalidate();
  }, [targetFov, invalidate]);

  // Keyboard & mouse-look listeners for walkthrough mode (works with or without pointer lock)
  useEffect(() => {
    if (cameraMode !== 'walkthrough') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      transitionRef.current = null;
      keysRef.current.add(e.code);
      invalidate();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    const dom = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 0) {
        transitionRef.current = null;
        lookingRef.current = true;
        lastMouseRef.current = [e.clientX, e.clientY];
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!lookingRef.current) return;
      const dx = e.clientX - lastMouseRef.current[0];
      const dy = e.clientY - lastMouseRef.current[1];
      lastMouseRef.current = [e.clientX, e.clientY];
      yawRef.current -= dx * 0.004;
      pitchRef.current = THREE.MathUtils.clamp(pitchRef.current - dy * 0.003, -1.2, 1.2);
      invalidate();
    };
    const onPointerUp = () => {
      lookingRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    dom.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      keysRef.current.clear();
      lookingRef.current = false;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      dom.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [cameraMode, gl, invalidate]);

  useFrame((_, delta) => {
    // While Studio Vidéo is actively playing/exporting, spline playback owns camera pose & FOV
    if (videoStudioMode && videoIsPlaying) return;

    const dt = Math.min(delta, 0.1);

    // 0. Smooth architectural FOV interpolation & close-range near clip enforcement
    if (camera instanceof THREE.PerspectiveCamera) {
      let projDirty = false;
      if (Math.abs(camera.near - 0.05) > 0.001) {
        camera.near = 0.05;
        projDirty = true;
      }
      if (!videoStudioMode && Math.abs(camera.fov - targetFov) > 0.04) {
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, dt * 8));
        if (Math.abs(camera.fov - targetFov) <= 0.04) {
          camera.fov = targetFov;
        }
        projDirty = true;
      }
      if (projDirty) {
        camera.updateProjectionMatrix();
        invalidate();
      }
    }

    // 1. Animated camera zone transition
    const tr = transitionRef.current;
    if (tr) {
      tr.elapsed += dt;
      const rawT = Math.min(1, tr.elapsed / tr.duration);
      // Cubic ease-out
      const ease = 1 - Math.pow(1 - rawT, 3);

      camera.position.lerpVectors(tr.startPos, tr.endPos, ease);
      const currentTarget = new THREE.Vector3().lerpVectors(tr.startTarget, tr.endTarget, ease);

      if (cameraMode === 'orbit' && orbitRef.current) {
        orbitRef.current.target.copy(currentTarget);
        orbitRef.current.update();
      } else {
        camera.lookAt(currentTarget);
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        yawRef.current = euler.y;
        pitchRef.current = euler.x;
      }

      if (rawT >= 1) {
        transitionRef.current = null;
      } else {
        invalidate();
      }
    }

    // 2. Walkthrough movement
    if (cameraMode === 'walkthrough' && !tr) {
      const euler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);

      const keys = keysRef.current;
      if (keys.size > 0) {
        const speed = 2.6 * dt;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() > 0) forward.normalize();

        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        right.y = 0;
        if (right.lengthSq() > 0) right.normalize();

        const move = new THREE.Vector3();
        if (keys.has('KeyW') || keys.has('KeyZ') || keys.has('ArrowUp')) move.add(forward);
        if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward);
        if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
        if (keys.has('KeyA') || keys.has('KeyQ') || keys.has('ArrowLeft')) move.sub(right);

        if (move.lengthSq() > 0) {
          move.normalize().multiplyScalar(speed);
          camera.position.add(move);
          camera.position.y = Math.min(1.55, ceilingHeightMm * MM - 0.35);
          invalidate();
        }
      }
    }

    // 3. Strict interior room clamping in Vue Client mode (camera + orbit target can NEVER exit room)
    if (isClientMode) {
      const clampedCam = clampCameraInsideRoom(
        [camera.position.x, camera.position.y, camera.position.z],
        walls,
        ceilingHeightMm,
        220
      );
      camera.position.set(clampedCam[0], clampedCam[1], clampedCam[2]);

      if (cameraMode === 'orbit' && orbitRef.current) {
        const t = orbitRef.current.target;
        const clampedTarget = clampTargetInsideRoom([t.x, t.y, t.z], walls, ceilingHeightMm);
        t.set(clampedTarget[0], clampedTarget[1], clampedTarget[2]);
      }
    }
  });

  if (cameraMode === 'orbit') {
    const interiorMaxDist = Math.max(
      1.8,
      Math.hypot(bounds.widthMm, bounds.depthMm) * MM * 0.85
    );
    return (
      <OrbitControls
        ref={orbitRef}
        makeDefault
        enabled={!isDragging3D && !(videoStudioMode && videoIsPlaying)}
        enableDamping
        dampingFactor={0.08}
        target={[centerX, 0.9, centerZ]}
        minPolarAngle={isClientMode ? 0.25 : 0.08}
        maxPolarAngle={isClientMode ? Math.PI * 0.8 : Math.PI * 0.495}
        minDistance={isClientMode ? 0.35 : 0.6}
        maxDistance={isClientMode ? interiorMaxDist : 24}
        onStart={() => {
          transitionRef.current = null;
          invalidate();
        }}
        onChange={() => {
          invalidate();
        }}
      />
    );
  }

  return null;
}
