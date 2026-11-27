import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Grid3x3,
  Maximize2,
  RotateCw,
  Square,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { RoomUtilityKind, SnapGuide, WallOpeningKind } from '@/types';
import {
  analyzeWalls,
  buildRoomPresetWalls,
  computeModuleFitSolution,
  computeRoomBounds,
  computeWallPolygon2D,
  getModuleAxes2D,
  getModuleCorners2D,
  getWallInteriorSpanMm,
  projectModuleToWall,
  projectPointToWall,
  resolveCeilingLighting,
  snapModulePosition,
  snapPropPosition,
  testYOverlap,
  type ModuleAutoFitSolution,
} from '@/engine/geometry';
import { FR } from '@/i18n/fr';
import { selectCollisionModuleIds, selectProjectCollisions } from '@/store/selectors';
import { pauseHistory, resumeHistory, useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { formatDim, roundMm } from '@/utils/units';
import { CollisionWarningsBanner, SnapGuidesSvg } from './SnapGuidesOverlay';

type RoomShapePreset = 'rect' | 'l' | 'u';

interface ViewTransform {
  minX: number;
  minZ: number;
  width: number;
  height: number;
}

const DEFAULT_VIEW: ViewTransform = {
  minX: -500,
  minZ: -500,
  width: 5000,
  height: 4400,
};

function snapValue(val: number, step: number): number {
  return Math.round(val / step) * step;
}

export function FloorplanCanvas() {
  const doc = useProjectStore((s) => s.document);
  const addWall = useProjectStore((s) => s.addWall);
  const updateWall = useProjectStore((s) => s.updateWall);
  const removeWall = useProjectStore((s) => s.removeWall);
  const applyRoomPresetWalls = useProjectStore((s) => s.applyRoomPresetWalls);
  const addOpening = useProjectStore((s) => s.addOpening);
  const updateOpening = useProjectStore((s) => s.updateOpening);
  const removeOpening = useProjectStore((s) => s.removeOpening);
  const addUtility = useProjectStore((s) => s.addUtility);
  const updateUtility = useProjectStore((s) => s.updateUtility);
  const removeUtility = useProjectStore((s) => s.removeUtility);
  const updateModule = useProjectStore((s) => s.updateModule);
  const removeModule = useProjectStore((s) => s.removeModule);
  const removeModulesBatch = useProjectStore((s) => s.removeModulesBatch);
  const updateProp = useProjectStore((s) => s.updateProp);
  const removeProp = useProjectStore((s) => s.removeProp);
  const removePropsBatch = useProjectStore((s) => s.removePropsBatch);
  const addCeilingSpot = useProjectStore((s) => s.addCeilingSpot);
  const updateCeilingSpot = useProjectStore((s) => s.updateCeilingSpot);
  const moveCeilingSpotsBatch = useProjectStore((s) => s.moveCeilingSpotsBatch);
  const removeCeilingSpot = useProjectStore((s) => s.removeCeilingSpot);
  const removeCeilingSpotsBatch = useProjectStore((s) => s.removeCeilingSpotsBatch);
  const setDocument = useProjectStore((s) => s.setDocument);

  const selectedId = useUIStore((s) => s.selectedId);
  const selectedIds = useUIStore((s) => s.selectedIds);
  const selectedKind = useUIStore((s) => s.selectedKind);
  const selectEntity = useUIStore((s) => s.selectEntity);
  const toggleSelectEntity = useUIStore((s) => s.toggleSelectEntity);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const plan2dFilters = useUIStore((s) => s.plan2dFilters);
  const togglePlan2dFilter = useUIStore((s) => s.togglePlan2dFilter);
  const showCeilingSpots2D = useUIStore((s) => s.showCeilingSpots2D);
  const toggleShowCeilingSpots2D = useUIStore((s) => s.toggleShowCeilingSpots2D);
  const userOrientedIds = useUIStore((s) => s.userOrientedIds);
  const markUserOriented = useUIStore((s) => s.markUserOriented);

  const svgRef = useRef<SVGSVGElement | null>(null);
  // Multi-touch registry for iPad/mobile two-finger pan & pinch-to-zoom
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    midClientX: number;
    midClientY: number;
    startView: ViewTransform;
  } | null>(null);

  const [view, setView] = useState<ViewTransform>(DEFAULT_VIEW);
  const [snapGrid, setSnapGrid] = useState(true);
  const [orthoLock, setOrthoLock] = useState(true);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [showRoomPresets, setShowRoomPresets] = useState(false);
  const [presetDims, setPresetDims] = useState({ w: 4000, d: 3400, thickness: 150 });
  const [marqueeBox, setMarqueeBox] = useState<{
    x1: number;
    z1: number;
    x2: number;
    z2: number;
  } | null>(null);
  const [rotationBadge, setRotationBadge] = useState<{
    x: number;
    z: number;
    deg: number;
  } | null>(null);

  // Draft wall state (supports both drag-to-draw and click-click)
  const [draftWall, setDraftWall] = useState<{
    start: [number, number];
    end: [number, number];
    isOrtho: boolean;
    pointerStartPx: [number, number];
  } | null>(null);

  // Active drag state
  const dragRef = useRef<
    | { kind: 'pan'; startClientX: number; startClientY: number; startView: ViewTransform }
    | {
        kind: 'module';
        moduleId: string;
        offsetX: number;
        offsetZ: number;
        moved: boolean;
      }
    | {
        kind: 'prop';
        propId: string;
        offsetX: number;
        offsetZ: number;
        moved: boolean;
      }
    | {
        kind: 'wall_endpoint';
        wallIds: Array<{ id: string; endpoint: 'startMm' | 'endMm' }>;
        moved: boolean;
      }
    | {
        kind: 'opening';
        openingId: string;
        wallId: string;
        moved: boolean;
      }
    | {
        kind: 'rotate';
        entityKind: 'module' | 'prop';
        entityId: string;
        centerX: number;
        centerZ: number;
        moved: boolean;
      }
    | {
        kind: 'marquee';
        startX: number;
        startZ: number;
        startClientX: number;
        startClientY: number;
        active: boolean;
      }
    | {
        kind: 'utility';
        utilityId: string;
        moved: boolean;
      }
    | {
        kind: 'spot';
        spotId: string;
        startWorldX: number;
        startWorldZ: number;
        initialPositions: Array<{ id: string; xMm: number; zMm: number }>;
        moved: boolean;
      }
    | null
  >(null);

  const wallMetricsList = useMemo(() => analyzeWalls(doc.walls), [doc.walls]);
  const metricsById = useMemo(
    () => new Map(wallMetricsList.map((wm) => [wm.wall.id, wm])),
    [wallMetricsList]
  );
  const collisions = useMemo(() => selectProjectCollisions(doc), [doc]);
  const collisionModuleIds = useMemo(() => selectCollisionModuleIds(doc), [doc]);
  const ceilingLighting = useMemo(
    () => resolveCeilingLighting(doc.walls, doc.ceilingLighting),
    [doc.walls, doc.ceilingLighting]
  );
  const fixableSolutions = useMemo(() => {
    const map = new Map<string, ModuleAutoFitSolution>();
    for (const c of collisions) {
      if (map.has(c.moduleId)) continue;
      const sol = computeModuleFitSolution(doc, c.moduleId);
      if (sol) map.set(c.moduleId, sol);
    }
    return map;
  }, [collisions, doc]);

  const fitViewToProject = useCallback(() => {
    if (doc.walls.length === 0 && doc.modules.length === 0) {
      setView(DEFAULT_VIEW);
      return;
    }
    const b = computeRoomBounds(doc.walls, true);
    const pad = 750;
    setView({
      minX: Math.round(b.minX - pad),
      minZ: Math.round(b.minZ - pad),
      width: Math.max(2600, Math.round(b.widthMm + pad * 2)),
      height: Math.max(2200, Math.round(b.depthMm + pad * 2)),
    });
  }, [doc.walls, doc.modules, doc.utilities]);

  // Refit whenever a different project is loaded
  const lastProjectIdRef = useRef<string>(doc.id);
  useEffect(() => {
    if (lastProjectIdRef.current !== doc.id) {
      lastProjectIdRef.current = doc.id;
      fitViewToProject();
    }
  }, [doc.id, fitViewToProject]);

  // Keyboard shortcuts (Escape cancels wall draw, R rotates selected module, Delete deletes)
  useEffect(() => {
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
      if (e.key === 'Escape') {
        setDraftWall(null);
        setActiveTool('select');
      } else if (
        (e.key === 'r' || e.key === 'R') &&
        (selectedKind === 'module' || selectedKind === 'prop') &&
        selectedId
      ) {
        if (selectedKind === 'module') {
          const mod = doc.modules.find((m) => m.id === selectedId);
          if (mod) {
            const nextRot = (mod.rotationYRad + Math.PI / 2) % (Math.PI * 2);
            markUserOriented(mod.id, true);
            const snapped = snapModulePosition(
              { ...mod, rotationYRad: nextRot },
              doc.walls,
              doc.modules,
              { ceilingHeightMm: doc.ceilingHeightMm, preserveRotation: true }
            );
            updateModule(mod.id, {
              rotationYRad: nextRot,
              xMm: snapped.xMm,
              zMm: snapped.zMm,
              attachedWallId: snapped.attachedWallId ?? mod.attachedWallId,
            });
          }
        } else {
          const prop = (doc.props ?? []).find((p) => p.id === selectedId);
          if (prop) {
            const nextRot = (prop.rotationYRad + Math.PI / 2) % (Math.PI * 2);
            markUserOriented(prop.id, true);
            const snapped = snapPropPosition(
              { ...prop, rotationYRad: nextRot },
              doc.walls,
              doc.modules,
              {
                freePlacement: useUIStore.getState().freePlacementMode,
                ceilingHeightMm: doc.ceilingHeightMm,
                preserveRotation: true,
              }
            );
            updateProp(prop.id, {
              rotationYRad: nextRot,
              xMm: snapped.xMm,
              zMm: snapped.zMm,
              attachedWallId: snapped.attachedWallId ?? prop.attachedWallId,
            });
          }
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && selectedKind) {
        if (selectedKind === 'module') {
          if (selectedIds.length > 1) removeModulesBatch(selectedIds);
          else removeModule(selectedId);
        } else if (selectedKind === 'prop') {
          if (selectedIds.length > 1) removePropsBatch(selectedIds);
          else removeProp(selectedId);
        } else if (selectedKind === 'wall') removeWall(selectedId);
        else if (selectedKind === 'opening') removeOpening(selectedId);
        else if (selectedKind === 'utility') removeUtility(selectedId);
        else if (selectedKind === 'spot') {
          if (selectedIds.length > 1) removeCeilingSpotsBatch(selectedIds);
          else removeCeilingSpot(selectedId);
        }
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedId,
    selectedIds,
    selectedKind,
    doc.modules,
    doc.props,
    updateModule,
    removeModule,
    removeModulesBatch,
    updateProp,
    removeProp,
    removePropsBatch,
    removeWall,
    removeOpening,
    removeUtility,
    removeCeilingSpot,
    removeCeilingSpotsBatch,
    clearSelection,
    setActiveTool,
  ]);

  const clientToWorldMm = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const svg = svgRef.current;
      if (!svg) return [0, 0];
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [0, 0];

      // SVG preserveAspectRatio="xMidYMid meet"
      const scale = Math.min(rect.width / view.width, rect.height / view.height);
      const renderedW = view.width * scale;
      const renderedH = view.height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      const wx = view.minX + (clientX - rect.left - offsetX) / scale;
      const wz = view.minZ + (clientY - rect.top - offsetY) / scale;
      return [roundMm(wx, 0), roundMm(wz, 0)];
    },
    [view]
  );

  const snapPointMm = useCallback(
    (
      pt: [number, number],
      anchor?: [number, number],
      forceOrtho = false
    ): { point: [number, number]; isOrtho: boolean } => {
      let [x, z] = pt;
      let isOrtho = false;

      // 1. Snap to existing wall endpoints within 140 mm
      for (const w of doc.walls) {
        for (const ep of [w.startMm, w.endMm]) {
          if (Math.hypot(x - ep[0], z - ep[1]) <= 140) {
            return { point: [ep[0], ep[1]], isOrtho: false };
          }
        }
      }

      if (snapGrid) {
        x = snapValue(x, 50);
        z = snapValue(z, 50);
      }

      // 2. Orthogonal / 45° angle lock relative to anchor
      if (anchor && (orthoLock || forceOrtho)) {
        const dx = x - anchor[0];
        const dz = z - anchor[1];
        const dist = Math.hypot(dx, dz);
        if (dist > 20) {
          const angle = Math.atan2(dz, dx);
          const step = Math.PI / 4; // 0, 45, 90, 135, 180...
          const nearest = Math.round(angle / step) * step;
          const diffDeg = Math.abs(((angle - nearest) * 180) / Math.PI);
          if (forceOrtho || diffDeg <= 7) {
            x = Math.round(anchor[0] + Math.cos(nearest) * dist);
            z = Math.round(anchor[1] + Math.sin(nearest) * dist);
            if (snapGrid && Math.abs(Math.sin(nearest)) < 0.01) {
              x = snapValue(x, 50);
            } else if (snapGrid && Math.abs(Math.cos(nearest)) < 0.01) {
              z = snapValue(z, 50);
            }
            isOrtho = true;
          }
        }
      }

      return { point: [x, z], isOrtho };
    },
    [doc.walls, snapGrid, orthoLock]
  );

  const commitDraftWall = useCallback(
    (start: [number, number], end: [number, number]) => {
      const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (len < 100) return;
      const wallNum = doc.walls.length + 1;
      const id = addWall({
        labelFr: `Mur ${wallNum}`,
        startMm: start,
        endMm: end,
        thicknessMm: 150,
        heightMm: doc.ceilingHeightMm,
        materialId: 'peinture-blanc-casse',
      });
      selectEntity(id, 'wall');
    },
    [addWall, doc.walls.length, doc.ceilingHeightMm, selectEntity]
  );

  const placeOpeningAt = useCallback(
    (kind: WallOpeningKind, worldPt: [number, number]) => {
      if (wallMetricsList.length === 0) return;

      const defaultW = kind === 'porte' ? 830 : 1200;
      const defaultH = kind === 'porte' ? 2040 : 1200;
      const defaultSill = kind === 'porte' ? 0 : 1050;

      // Sort walls by distance to pointer
      const rankedWalls = wallMetricsList
        .map((wm) => ({
          wm,
          proj: projectPointToWall(wm, { x: worldPt[0], z: worldPt[1] }),
        }))
        .sort((a, b) => a.proj.distanceToSegmentMm - b.proj.distanceToSegmentMm);

      const isBlockedOnWall = (
        wm: (typeof wallMetricsList)[number],
        uStart: number,
        uEnd: number
      ): boolean => {
        for (const mod of doc.modules) {
          if (!testYOverlap(mod.yMm, mod.heightMm, defaultSill, defaultH, 2)) continue;
          const mp = projectModuleToWall(wm, mod);
          const nearWall =
            mp.dMinMm <= wm.wall.thicknessMm / 2 + 120 &&
            mp.dMaxMm >= wm.wall.thicknessMm / 2 - 20;
          if (!nearWall) continue;
          if (Math.min(uEnd, mp.uMaxMm) - Math.max(uStart, mp.uMinMm) > 10) {
            return true;
          }
        }
        return false;
      };

      let chosenWm = rankedWalls[0].wm;
      let widthMm = Math.min(defaultW, Math.max(300, chosenWm.lengthMm - 100));
      let offsetFromStartMm = Math.max(
        50,
        Math.min(
          chosenWm.lengthMm - widthMm - 50,
          Math.round(rankedWalls[0].proj.uClampedMm - widthMm / 2)
        )
      );

      // If clicked location overlaps an existing cabinet at opening height, snap to nearest clear span
      if (isBlockedOnWall(chosenWm, offsetFromStartMm, offsetFromStartMm + widthMm)) {
        let foundClear = false;
        for (const { wm, proj } of rankedWalls) {
          const wCand = Math.min(defaultW, Math.max(300, wm.lengthMm - 100));
          const maxOff = wm.lengthMm - wCand - 50;
          if (maxOff < 50) continue;
          const desired = Math.max(50, Math.min(maxOff, Math.round(proj.uClampedMm - wCand / 2)));
          let bestOff: number | null = null;
          let bestDist = Infinity;
          for (let off = 50; off <= maxOff; off += 50) {
            if (!isBlockedOnWall(wm, off, off + wCand)) {
              const d = Math.abs(off - desired);
              if (d < bestDist) {
                bestDist = d;
                bestOff = off;
              }
            }
          }
          if (bestOff !== null) {
            chosenWm = wm;
            widthMm = wCand;
            offsetFromStartMm = bestOff;
            foundClear = true;
            break;
          }
        }
        void foundClear;
      }

      const id = addOpening({
        wallId: chosenWm.wall.id,
        kind,
        labelFr: kind === 'porte' ? 'Porte' : 'Fenêtre',
        offsetFromStartMm,
        widthMm,
        heightMm: defaultH,
        sillHeightMm: defaultSill,
      });
      selectEntity(id, 'opening');
      setActiveTool('select');
    },
    [wallMetricsList, doc.modules, addOpening, selectEntity, setActiveTool]
  );

  const placeUtilityAt = useCallback(
    (kind: RoomUtilityKind, worldPt: [number, number]) => {
      let xMm = snapGrid ? snapValue(worldPt[0], 50) : worldPt[0];
      let zMm = snapGrid ? snapValue(worldPt[1], 50) : worldPt[1];
      let wallId: string | undefined;

      // Snap electrical/plumbing points to nearest wall if reasonably close
      if ((kind === 'prise' || kind === 'arrivee_eau') && wallMetricsList.length > 0) {
        let bestWm = wallMetricsList[0];
        let bestProj = projectPointToWall(bestWm, { x: worldPt[0], z: worldPt[1] });
        for (let i = 1; i < wallMetricsList.length; i++) {
          const p = projectPointToWall(wallMetricsList[i], { x: worldPt[0], z: worldPt[1] });
          if (p.distanceToSegmentMm < bestProj.distanceToSegmentMm) {
            bestWm = wallMetricsList[i];
            bestProj = p;
          }
        }
        if (bestProj.distanceToSegmentMm <= 800) {
          wallId = bestWm.wall.id;
          const offset = bestWm.wall.thicknessMm / 2 + 15;
          xMm = Math.round(bestProj.closestPoint.x + bestWm.inwardNormal.x * offset);
          zMm = Math.round(bestProj.closestPoint.z + bestWm.inwardNormal.z * offset);
        }
      }

      const defaults: Record<
        RoomUtilityKind,
        { w: number; d: number; h: number; y: number; label: string }
      > = {
        poteau: { w: 250, d: 250, h: doc.ceilingHeightMm, y: 0, label: 'Poteau structurel' },
        poutre: { w: 1200, d: 250, h: 250, y: doc.ceilingHeightMm - 250, label: 'Poutre' },
        prise: { w: 80, d: 20, h: 80, y: 1100, label: 'Prise électrique' },
        arrivee_eau: { w: 80, d: 40, h: 120, y: 500, label: "Arrivée d'eau" },
      };
      const cfg = defaults[kind];
      const id = addUtility({
        wallId,
        kind,
        labelFr: cfg.label,
        xMm,
        yMm: cfg.y,
        zMm,
        widthMm: cfg.w,
        depthMm: cfg.d,
        heightMm: cfg.h,
      });
      selectEntity(id, 'utility');
      setActiveTool('select');
    },
    [wallMetricsList, doc.ceilingHeightMm, snapGrid, addUtility, selectEntity, setActiveTool]
  );

  // Safety cleanup: resume Zundo history if FloorplanCanvas unmounts mid-drag
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (drag && 'moved' in drag && drag.moved) {
        resumeHistory();
      }
      dragRef.current = null;
      activePointersRef.current.clear();
      pinchStartRef.current = null;
    };
  }, []);

  const captureSvgPointer = (pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      // Ignore synthetic events without pointer capture support
    }
  };

  const releaseSvgPointer = (pointerId: number) => {
    try {
      if (svgRef.current?.hasPointerCapture(pointerId)) {
        svgRef.current.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore
    }
  };

  const handleSvgPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two-finger touch pinch-to-zoom & pan on iPad/mobile
    if (activePointersRef.current.size === 2) {
      // Cancel any single-finger marquee/drag cleanly without losing Undo history
      const prevDrag = dragRef.current;
      if (prevDrag && 'moved' in prevDrag && prevDrag.moved) {
        resumeHistory();
        setDocument({ ...useProjectStore.getState().document });
      }
      dragRef.current = null;
      setMarqueeBox(null);
      setSnapGuides([]);
      setRotationBadge(null);

      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      pinchStartRef.current = {
        dist,
        midClientX: (pts[0].x + pts[1].x) / 2,
        midClientY: (pts[0].y + pts[1].y) / 2,
        startView: { ...view },
      };
      captureSvgPointer(e.pointerId);
      return;
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      dragRef.current = {
        kind: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startView: { ...view },
      };
      captureSvgPointer(e.pointerId);
      return;
    }

    if (e.button !== 0) return;

    const worldPt = clientToWorldMm(e.clientX, e.clientY);

    if (activeTool === 'draw_wall') {
      if (!draftWall) {
        const { point } = snapPointMm(worldPt);
        setDraftWall({
          start: point,
          end: point,
          isOrtho: false,
          pointerStartPx: [e.clientX, e.clientY],
        });
      } else {
        // Click-to-click finish segment
        const { point } = snapPointMm(worldPt, draftWall.start, e.shiftKey);
        commitDraftWall(draftWall.start, point);
        setDraftWall(null);
      }
      return;
    }

    if (activeTool === 'add_porte' || activeTool === 'add_fenetre') {
      placeOpeningAt(activeTool === 'add_porte' ? 'porte' : 'fenetre', worldPt);
      return;
    }

    if (
      activeTool === 'add_poteau' ||
      activeTool === 'add_poutre' ||
      activeTool === 'add_prise' ||
      activeTool === 'add_arrivee_eau'
    ) {
      const kind = activeTool.replace('add_', '') as RoomUtilityKind;
      placeUtilityAt(kind, worldPt);
      return;
    }

    // Clicked empty background in select mode -> prepare marquee box selection (or clear on click)
    if (e.target === svgRef.current) {
      dragRef.current = {
        kind: 'marquee',
        startX: worldPt[0],
        startZ: worldPt[1],
        startClientX: e.clientX,
        startClientY: e.clientY,
        active: false,
      };
      captureSvgPointer(e.pointerId);
    }
  };

  const handleSvgPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Live 2-finger pinch-to-zoom & pan for touchscreens / iPad
    if (activePointersRef.current.size >= 2 && pinchStartRef.current) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const pts = Array.from(activePointersRef.current.values());
      const curDist = Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const curMidX = (pts[0].x + pts[1].x) / 2;
      const curMidY = (pts[0].y + pts[1].y) / 2;
      const { dist, midClientX, midClientY, startView } = pinchStartRef.current;

      const zoomRatio = dist / curDist;
      const nextW = Math.max(1200, Math.min(25000, startView.width * zoomRatio));
      const nextH = Math.max(1000, Math.min(22000, startView.height * zoomRatio));

      const startScale = Math.min(rect.width / startView.width, rect.height / startView.height);
      const renderedW = startView.width * startScale;
      const renderedH = startView.height * startScale;
      const offX = (rect.width - renderedW) / 2;
      const offY = (rect.height - renderedH) / 2;
      const anchorWorldX = startView.minX + (midClientX - rect.left - offX) / startScale;
      const anchorWorldZ = startView.minZ + (midClientY - rect.top - offY) / startScale;

      const nextScale = Math.min(rect.width / nextW, rect.height / nextH);
      const nextRenderedW = nextW * nextScale;
      const nextRenderedH = nextH * nextScale;
      const nextOffX = (rect.width - nextRenderedW) / 2;
      const nextOffY = (rect.height - nextRenderedH) / 2;

      setView({
        minX: Math.round(anchorWorldX - (curMidX - rect.left - nextOffX) / nextScale),
        minZ: Math.round(anchorWorldZ - (curMidY - rect.top - nextOffY) / nextScale),
        width: Math.round(nextW),
        height: Math.round(nextH),
      });
      return;
    }

    const drag = dragRef.current;

    if (drag?.kind === 'pan') {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / drag.startView.width, rect.height / drag.startView.height);
      const dx = (e.clientX - drag.startClientX) / scale;
      const dz = (e.clientY - drag.startClientY) / scale;
      setView({
        ...drag.startView,
        minX: Math.round(drag.startView.minX - dx),
        minZ: Math.round(drag.startView.minZ - dz),
      });
      return;
    }

    const worldPt = clientToWorldMm(e.clientX, e.clientY);

    if (activeTool === 'draw_wall' && draftWall) {
      const { point, isOrtho } = snapPointMm(worldPt, draftWall.start, e.shiftKey);
      setDraftWall((prev) => (prev ? { ...prev, end: point, isOrtho } : null));
      return;
    }

    if (!drag) return;

    if (drag.kind === 'module') {
      const mod = doc.modules.find((m) => m.id === drag.moduleId);
      if (!mod) return;
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      const rawX = snapGrid ? snapValue(worldPt[0] - drag.offsetX, 10) : worldPt[0] - drag.offsetX;
      const rawZ = snapGrid ? snapValue(worldPt[1] - drag.offsetZ, 10) : worldPt[1] - drag.offsetZ;
      const snapped = snapModulePosition(
        { ...mod, xMm: rawX, zMm: rawZ },
        doc.walls,
        doc.modules,
        {
          ceilingHeightMm: doc.ceilingHeightMm,
          preserveRotation: Boolean(userOrientedIds[mod.id]),
        }
      );
      setSnapGuides(snapped.guides);
      updateModule(mod.id, {
        xMm: snapped.xMm,
        yMm: snapped.yMm,
        zMm: snapped.zMm,
        rotationYRad: snapped.rotationYRad,
        attachedWallId: snapped.attachedWallId,
      });
    } else if (drag.kind === 'prop') {
      const prop = (doc.props ?? []).find((p) => p.id === drag.propId);
      if (!prop) return;
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      const rawX = snapGrid ? snapValue(worldPt[0] - drag.offsetX, 10) : worldPt[0] - drag.offsetX;
      const rawZ = snapGrid ? snapValue(worldPt[1] - drag.offsetZ, 10) : worldPt[1] - drag.offsetZ;
      const freeOverride = useUIStore.getState().freePlacementMode || e.altKey;
      const snapped = snapPropPosition(
        { ...prop, xMm: rawX, zMm: rawZ },
        doc.walls,
        doc.modules,
        {
          freePlacement: freeOverride,
          ceilingHeightMm: doc.ceilingHeightMm,
          preserveRotation: Boolean(userOrientedIds[prop.id]),
        }
      );
      setSnapGuides(snapped.guides ?? []);
      updateProp(prop.id, {
        xMm: snapped.xMm,
        yMm: snapped.yMm,
        zMm: snapped.zMm,
        rotationYRad: snapped.rotationYRad,
        attachedWallId: snapped.attachedWallId,
      });
    } else if (drag.kind === 'rotate') {
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      // Compute angle from entity center to pointer; front local +Z corresponds to rotationYRad = 0
      const rawRad = Math.atan2(worldPt[0] - drag.centerX, worldPt[1] - drag.centerZ);
      let deg = ((rawRad * 180) / Math.PI + 360) % 360;
      if (!e.shiftKey) {
        // Strong snap to 45°/90° cardinals within 5°, otherwise smooth 15° steps
        const nearest45 = Math.round(deg / 45) * 45;
        if (Math.abs(deg - nearest45) <= 5) {
          deg = nearest45 % 360;
        } else {
          deg = (Math.round(deg / 15) * 15) % 360;
        }
      } else {
        deg = Math.round(deg) % 360;
      }
      const snappedRad = (deg * Math.PI) / 180;
      markUserOriented(drag.entityId, true);
      if (drag.entityKind === 'module') {
        const mod = doc.modules.find((m) => m.id === drag.entityId);
        if (mod) {
          const snapped = snapModulePosition(
            { ...mod, rotationYRad: snappedRad },
            doc.walls,
            doc.modules,
            { ceilingHeightMm: doc.ceilingHeightMm, preserveRotation: true }
          );
          updateModule(mod.id, {
            rotationYRad: snappedRad,
            xMm: snapped.xMm,
            zMm: snapped.zMm,
            attachedWallId: snapped.attachedWallId ?? mod.attachedWallId,
          });
        } else {
          updateModule(drag.entityId, { rotationYRad: snappedRad });
        }
      } else {
        const prop = (doc.props ?? []).find((p) => p.id === drag.entityId);
        if (prop) {
          const snapped = snapPropPosition(
            { ...prop, rotationYRad: snappedRad },
            doc.walls,
            doc.modules,
            {
              freePlacement: useUIStore.getState().freePlacementMode,
              ceilingHeightMm: doc.ceilingHeightMm,
              preserveRotation: true,
            }
          );
          updateProp(prop.id, {
            rotationYRad: snappedRad,
            xMm: snapped.xMm,
            zMm: snapped.zMm,
            attachedWallId: snapped.attachedWallId ?? prop.attachedWallId,
          });
        } else {
          updateProp(drag.entityId, { rotationYRad: snappedRad });
        }
      }
      setRotationBadge({ x: worldPt[0], z: worldPt[1], deg: Math.round(deg) });
    } else if (drag.kind === 'marquee') {
      const distPx = Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY);
      if (distPx >= 6) {
        drag.active = true;
        setMarqueeBox({
          x1: Math.min(drag.startX, worldPt[0]),
          z1: Math.min(drag.startZ, worldPt[1]),
          x2: Math.max(drag.startX, worldPt[0]),
          z2: Math.max(drag.startZ, worldPt[1]),
        });
      }
    } else if (drag.kind === 'wall_endpoint') {
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      const snappedPt: [number, number] = snapGrid
        ? [snapValue(worldPt[0], 50), snapValue(worldPt[1], 50)]
        : worldPt;
      for (const target of drag.wallIds) {
        updateWall(target.id, { [target.endpoint]: snappedPt });
      }
    } else if (drag.kind === 'opening') {
      const wm = metricsById.get(drag.wallId);
      const op = doc.openings.find((o) => o.id === drag.openingId);
      if (!wm || !op) return;
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      const proj = projectPointToWall(wm, { x: worldPt[0], z: worldPt[1] });
      const span = getWallInteriorSpanMm(wm, wallMetricsList);
      const minOff = Math.max(0, Math.round(span.startInsetMm));
      const maxOff = Math.max(minOff, Math.round(wm.lengthMm - span.endInsetMm - op.widthMm));
      const nextOffset = Math.max(
        minOff,
        Math.min(maxOff, Math.round(proj.uClampedMm - op.widthMm / 2))
      );
      updateOpening(op.id, { offsetFromStartMm: nextOffset });
    } else if (drag.kind === 'utility') {
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      updateUtility(drag.utilityId, {
        xMm: snapGrid ? snapValue(worldPt[0], 25) : worldPt[0],
        zMm: snapGrid ? snapValue(worldPt[1], 25) : worldPt[1],
      });
    } else if (drag.kind === 'spot') {
      if (!drag.moved) {
        pauseHistory();
        drag.moved = true;
      }
      if (drag.initialPositions.length > 1) {
        const dx = worldPt[0] - drag.startWorldX;
        const dz = worldPt[1] - drag.startWorldZ;
        moveCeilingSpotsBatch(
          drag.initialPositions.map((p) => ({
            id: p.id,
            xMm: snapGrid ? snapValue(p.xMm + dx, 25) : Math.round(p.xMm + dx),
            zMm: snapGrid ? snapValue(p.zMm + dz, 25) : Math.round(p.zMm + dz),
          }))
        );
      } else {
        updateCeilingSpot(drag.spotId, {
          xMm: snapGrid ? snapValue(worldPt[0], 25) : Math.round(worldPt[0]),
          zMm: snapGrid ? snapValue(worldPt[1], 25) : Math.round(worldPt[1]),
        });
      }
    }
  };

  const handleSvgPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    activePointersRef.current.delete(e.pointerId);
    releaseSvgPointer(e.pointerId);

    if (activePointersRef.current.size < 2 && pinchStartRef.current) {
      pinchStartRef.current = null;
      return;
    }

    if (activeTool === 'draw_wall' && draftWall) {
      const movedPx = Math.hypot(
        e.clientX - draftWall.pointerStartPx[0],
        e.clientY - draftWall.pointerStartPx[1]
      );
      if (movedPx >= 12) {
        // Drag-to-draw finished on pointerUp
        const worldPt = clientToWorldMm(e.clientX, e.clientY);
        const { point } = snapPointMm(worldPt, draftWall.start, e.shiftKey);
        commitDraftWall(draftWall.start, point);
        setDraftWall(null);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      if (drag.kind === 'marquee') {
        if (drag.active && marqueeBox) {
          const hitModIds = doc.modules
            .filter(
              (m) =>
                m.xMm >= marqueeBox.x1 &&
                m.xMm <= marqueeBox.x2 &&
                m.zMm >= marqueeBox.z1 &&
                m.zMm <= marqueeBox.z2
            )
            .map((m) => m.id);
          if (hitModIds.length > 0) {
            setSelectedIds(hitModIds, 'module');
          } else {
            const hitPropIds = (doc.props ?? [])
              .filter(
                (p) =>
                  p.xMm >= marqueeBox.x1 &&
                  p.xMm <= marqueeBox.x2 &&
                  p.zMm >= marqueeBox.z1 &&
                  p.zMm <= marqueeBox.z2
              )
              .map((p) => p.id);
            if (hitPropIds.length > 0) {
              setSelectedIds(hitPropIds, 'prop');
            } else {
              clearSelection();
            }
          }
        } else {
          clearSelection();
        }
        setMarqueeBox(null);
      } else if ('moved' in drag && drag.moved) {
        resumeHistory();
        // Trigger one clean snapshot commit
        setDocument({ ...useProjectStore.getState().document });
      }
      dragRef.current = null;
      setSnapGuides([]);
      setRotationBadge(null);
    }
  };

  // Non-passive wheel listener avoids React/browser passive-listener preventDefault warnings
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      setView((prev) => {
        const rect = svg.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return prev;
        const scale = Math.min(rect.width / prev.width, rect.height / prev.height);
        const renderedW = prev.width * scale;
        const renderedH = prev.height * scale;
        const offX = (rect.width - renderedW) / 2;
        const offY = (rect.height - renderedH) / 2;
        const wx = prev.minX + (e.clientX - rect.left - offX) / scale;
        const wz = prev.minZ + (e.clientY - rect.top - offY) / scale;
        const nextW = Math.max(1200, Math.min(25000, prev.width * factor));
        const nextH = Math.max(1000, Math.min(22000, prev.height * factor));
        const rx = (wx - prev.minX) / prev.width;
        const rz = (wz - prev.minZ) / prev.height;
        return {
          minX: Math.round(wx - rx * nextW),
          minZ: Math.round(wz - rz * nextH),
          width: Math.round(nextW),
          height: Math.round(nextH),
        };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const applyRoomPreset = (shape: RoomShapePreset) => {
    const W = Math.max(1500, presetDims.w);
    const D = Math.max(1500, presetDims.d);
    const T = Math.max(80, presetDims.thickness);
    const H = doc.ceilingHeightMm;
    const mat = 'peinture-blanc-casse';

    const walls = buildRoomPresetWalls(shape, W, D, T, H, mat, 'mur-preset');

    applyRoomPresetWalls(walls);
    setShowRoomPresets(false);
    setView({
      minX: -650 - T,
      minZ: -650 - T,
      width: W + 1300 + T * 2,
      height: D + 1300 + T * 2,
    });
  };

  const startWallEndpointDrag = (
    e: React.PointerEvent,
    pt: [number, number]
  ) => {
    e.stopPropagation();
    const attached: Array<{ id: string; endpoint: 'startMm' | 'endMm' }> = [];
    for (const w of doc.walls) {
      if (Math.hypot(w.startMm[0] - pt[0], w.startMm[1] - pt[1]) <= 20) {
        attached.push({ id: w.id, endpoint: 'startMm' });
      }
      if (Math.hypot(w.endMm[0] - pt[0], w.endMm[1] - pt[1]) <= 20) {
        attached.push({ id: w.id, endpoint: 'endMm' });
      }
    }
    dragRef.current = {
      kind: 'wall_endpoint',
      wallIds: attached,
      moved: false,
    };
    captureSvgPointer(e.pointerId);
  };

  return (
    <div
      data-testid="viewport-2d-plan"
      className="relative flex h-full w-full flex-col overflow-hidden bg-atelier-viewport p-3 select-none"
    >
      {/* Top Plan Toolbar */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-atelier-fg">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-atelier-accent-text">{FR.viewport.plan2dTitle}</span>
          <span className="text-xs text-atelier-muted tabular-nums">
            {doc.walls.length} {FR.viewport.wallsLabel.toLowerCase()} · {doc.modules.length}{' '}
            {FR.viewport.modulesLabel.toLowerCase()}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSnapGrid((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              snapGrid
                ? 'border-atelier-accent bg-atelier-accent/15 text-atelier-accent-text'
                : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
            }`}
            title="Magnétisme grille"
          >
            <Grid3x3 className="h-3.5 w-3.5" />
            <span>Grille</span>
          </button>

          <button
            type="button"
            onClick={() => setOrthoLock((v) => !v)}
            className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
              orthoLock
                ? 'border-atelier-info/70 bg-atelier-info/15 text-atelier-info'
                : 'border-atelier-border bg-atelier-panel text-atelier-muted hover:text-atelier-fg'
            }`}
            title="Guides orthogonaux 0° / 45° / 90°"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Ortho</span>
          </button>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtres Plan 2D">
            {(
              [
                { key: 'base', label: 'Bas & Colonnes' },
                { key: 'upper', label: 'Caissons hauts' },
                { key: 'surfaces', label: 'Plans & Crédences' },
                { key: 'props', label: 'Électro & Déco' },
              ] as const
            ).map((f) => {
              const active = plan2dFilters[f.key];
              return (
                <button
                  key={f.key}
                  type="button"
                  data-testid={`plan2d-filter-${f.key}`}
                  onClick={() => togglePlan2dFilter(f.key)}
                  className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-atelier-accent/70 bg-atelier-accent/15 text-atelier-accent-text'
                      : 'border-atelier-border bg-atelier-panel text-atelier-muted opacity-65 hover:text-atelier-fg'
                  }`}
                  title={`Afficher / masquer : ${f.label}`}
                >
                  {f.label}
                </button>
              );
            })}
            <button
              type="button"
              data-testid="plan2d-filter-spots"
              onClick={toggleShowCeilingSpots2D}
              className={`inline-flex items-center rounded border px-2 py-1 text-xs font-medium transition-colors ${
                showCeilingSpots2D
                  ? 'border-amber-400/70 bg-amber-400/15 text-amber-300'
                  : 'border-atelier-border bg-atelier-panel text-atelier-muted opacity-65 hover:text-atelier-fg'
              }`}
              title="Afficher / déplacer les spots plafond sur le plan 2D (Shift+clic pour sélection multiple)"
            >
              Spots
            </button>
            <button
              type="button"
              data-testid="plan2d-btn-add-spot"
              onClick={() => {
                if (!showCeilingSpots2D) toggleShowCeilingSpots2D();
                const newSpotId = addCeilingSpot();
                selectEntity(newSpotId, 'spot');
              }}
              className="inline-flex items-center rounded border border-atelier-accent/60 bg-atelier-accent/15 px-2 py-1 text-xs font-semibold text-atelier-accent-text hover:bg-atelier-accent/25"
              title="Ajouter un nouveau spot plafond"
            >
              + Spot
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRoomPresets((v) => !v)}
              className="inline-flex items-center gap-1 rounded border border-atelier-border bg-atelier-panel px-2 py-1 text-xs text-atelier-fg hover:border-atelier-accent"
            >
              <Square className="h-3.5 w-3.5 text-atelier-accent-text" />
              <span>Formes pièce</span>
            </button>
            {showRoomPresets && (
              <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-atelier-border bg-atelier-panel p-3 shadow-2xl space-y-2 text-xs">
                <div className="font-semibold text-atelier-accent-text">Générer une pièce (mm)</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="space-y-0.5">
                    <span className="text-xs text-atelier-muted">Largeur (mm)</span>
                    <input
                      type="number"
                      value={presetDims.w}
                      onChange={(e) =>
                        setPresetDims((p) => ({ ...p, w: Number(e.target.value) || 4000 }))
                      }
                      className="w-full rounded border border-atelier-border bg-atelier-bg px-1.5 py-1 text-atelier-fg tabular-nums"
                    />
                  </label>
                  <label className="space-y-0.5">
                    <span className="text-xs text-atelier-muted">Profondeur (mm)</span>
                    <input
                      type="number"
                      value={presetDims.d}
                      onChange={(e) =>
                        setPresetDims((p) => ({ ...p, d: Number(e.target.value) || 3400 }))
                      }
                      className="w-full rounded border border-atelier-border bg-atelier-bg px-1.5 py-1 text-atelier-fg tabular-nums"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    type="button"
                    onClick={() => applyRoomPreset('rect')}
                    className="rounded border border-atelier-border bg-atelier-surface py-1 text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    Rectangle
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRoomPreset('l')}
                    className="rounded border border-atelier-border bg-atelier-surface py-1 text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    En L
                  </button>
                  <button
                    type="button"
                    onClick={() => applyRoomPreset('u')}
                    className="rounded border border-atelier-border bg-atelier-surface py-1 text-xs text-atelier-fg hover:border-atelier-accent"
                  >
                    En U
                  </button>
                </div>
              </div>
            )}
          </div>

          {(selectedKind === 'module' || selectedKind === 'prop') && selectedId && (
            <button
              type="button"
              onClick={() => {
                if (selectedKind === 'module') {
                  const mod = doc.modules.find((m) => m.id === selectedId);
                  if (mod) {
                    const nextRot = (mod.rotationYRad + Math.PI / 2) % (Math.PI * 2);
                    markUserOriented(mod.id, true);
                    const snapped = snapModulePosition(
                      { ...mod, rotationYRad: nextRot },
                      doc.walls,
                      doc.modules,
                      { ceilingHeightMm: doc.ceilingHeightMm, preserveRotation: true }
                    );
                    updateModule(mod.id, {
                      rotationYRad: nextRot,
                      xMm: snapped.xMm,
                      zMm: snapped.zMm,
                      attachedWallId: snapped.attachedWallId ?? mod.attachedWallId,
                    });
                  }
                } else {
                  const prop = (doc.props ?? []).find((p) => p.id === selectedId);
                  if (prop) {
                    const nextRot = (prop.rotationYRad + Math.PI / 2) % (Math.PI * 2);
                    markUserOriented(prop.id, true);
                    const snapped = snapPropPosition(
                      { ...prop, rotationYRad: nextRot },
                      doc.walls,
                      doc.modules,
                      {
                        freePlacement: useUIStore.getState().freePlacementMode,
                        ceilingHeightMm: doc.ceilingHeightMm,
                        preserveRotation: true,
                      }
                    );
                    updateProp(prop.id, {
                      rotationYRad: nextRot,
                      xMm: snapped.xMm,
                      zMm: snapped.zMm,
                      attachedWallId: snapped.attachedWallId ?? prop.attachedWallId,
                    });
                  }
                }
              }}
              className="inline-flex items-center gap-1 rounded border border-atelier-border bg-atelier-panel px-2 py-1 text-xs text-atelier-fg hover:border-atelier-accent"
              title="Pivoter de 90° (touche R)"
            >
              <RotateCw className="h-3.5 w-3.5 text-atelier-accent-text" />
              <span>90°</span>
            </button>
          )}

          <div className="flex items-center rounded border border-atelier-border bg-atelier-panel">
            <button
              type="button"
              onClick={() =>
                setView((v) => ({
                  minX: Math.round(v.minX + v.width * 0.08),
                  minZ: Math.round(v.minZ + v.height * 0.08),
                  width: Math.max(1200, Math.round(v.width * 0.84)),
                  height: Math.max(1000, Math.round(v.height * 0.84)),
                }))
              }
              title="Zoom avant"
              className="p-1.5 text-atelier-muted hover:text-atelier-fg"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() =>
                setView((v) => ({
                  minX: Math.round(v.minX - v.width * 0.09),
                  minZ: Math.round(v.minZ - v.height * 0.09),
                  width: Math.min(25000, Math.round(v.width * 1.18)),
                  height: Math.min(22000, Math.round(v.height * 1.18)),
                }))
              }
              title="Zoom arrière"
              className="p-1.5 text-atelier-muted hover:text-atelier-fg"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={fitViewToProject}
              title="Recadrer le plan"
              className="p-1.5 text-atelier-muted hover:text-atelier-fg"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main SVG Viewport */}
      <div className="relative flex-1 overflow-hidden rounded-lg border border-atelier-border bg-[#0B1120]">
        <svg
          ref={svgRef}
          viewBox={`${view.minX} ${view.minZ} ${view.width} ${view.height}`}
          style={{ touchAction: 'none' }}
          className={`h-full w-full touch-none ${
            activeTool === 'draw_wall'
              ? 'cursor-crosshair'
              : activeTool.startsWith('add_')
                ? 'cursor-copy'
                : 'cursor-default'
          }`}
          onPointerDown={handleSvgPointerDown}
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onPointerCancel={handleSvgPointerUp}
        >
          <defs>
            <pattern id="grid-100" width="100" height="100" patternUnits="userSpaceOnUse">
              <path
                d="M 100 0 L 0 0 0 100"
                fill="none"
                stroke="#1e293b"
                strokeWidth="4"
              />
            </pattern>
            <pattern id="grid-1000" width="1000" height="1000" patternUnits="userSpaceOnUse">
              <rect width="1000" height="1000" fill="url(#grid-100)" />
              <path
                d="M 1000 0 L 0 0 0 1000"
                fill="none"
                stroke="#334155"
                strokeWidth="10"
              />
            </pattern>
          </defs>

          {/* Grid Backdrop */}
          <rect
            x={view.minX - 4000}
            y={view.minZ - 4000}
            width={view.width + 8000}
            height={view.height + 8000}
            fill="url(#grid-1000)"
            pointerEvents="none"
          />

          {/* Walls + Live Net Interior Length Labels */}
          {wallMetricsList.map((wm) => {
            const w = wm.wall;
            const isSelected = selectedKind === 'wall' && selectedId === w.id;
            const poly = computeWallPolygon2D(wm, wallMetricsList);
            const span = getWallInteriorSpanMm(wm, wallMetricsList);
            const labelDist = w.thicknessMm / 2 + 190;
            const lx = wm.midpoint.x - wm.inwardNormal.x * labelDist;
            const lz = wm.midpoint.z - wm.inwardNormal.z * labelDist;
            return (
              <g key={w.id}>
                <polygon
                  data-wall-id={w.id}
                  points={poly.map((p) => `${p.x},${p.z}`).join(' ')}
                  fill={isSelected ? '#f59e0b' : '#cbd5e1'}
                  stroke={isSelected ? '#fde68a' : '#475569'}
                  strokeWidth={12}
                  strokeLinejoin="miter"
                  className="cursor-pointer"
                  onPointerDown={(e) => {
                    if (activeTool !== 'select') return;
                    e.stopPropagation();
                    selectEntity(w.id, 'wall');
                  }}
                />
                {/* Live net interior wall length label */}
                <text
                  x={lx}
                  y={lz}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isSelected ? '#fde68a' : '#94a3b8'}
                  fontSize={92}
                  fontWeight={600}
                  pointerEvents="none"
                >
                  {formatDim(span.netLengthMm, displayUnit)}
                </text>

                {/* Draggable endpoints when wall selected */}
                {isSelected && (
                  <>
                    <circle
                      cx={w.startMm[0]}
                      cy={w.startMm[1]}
                      r={70}
                      fill="#f59e0b"
                      stroke="#0f172a"
                      strokeWidth={18}
                      className="cursor-grab"
                      onPointerDown={(e) => startWallEndpointDrag(e, w.startMm)}
                    />
                    <circle
                      cx={w.endMm[0]}
                      cy={w.endMm[1]}
                      r={70}
                      fill="#f59e0b"
                      stroke="#0f172a"
                      strokeWidth={18}
                      className="cursor-grab"
                      onPointerDown={(e) => startWallEndpointDrag(e, w.endMm)}
                    />
                  </>
                )}
              </g>
            );
          })}

          {/* Openings (Portes & Fenêtres) */}
          {doc.openings.map((op) => {
            const wm = metricsById.get(op.wallId);
            if (!wm) return null;
            const isSelected = selectedKind === 'opening' && selectedId === op.id;
            const p1x = wm.start.x + wm.tangent.x * op.offsetFromStartMm;
            const p1z = wm.start.z + wm.tangent.z * op.offsetFromStartMm;
            const p2x = p1x + wm.tangent.x * op.widthMm;
            const p2z = p1z + wm.tangent.z * op.widthMm;

            const r = op.widthMm;
            const isRightHinge = op.hingeSide === 'right';
            const hingeX = isRightHinge ? p2x : p1x;
            const hingeZ = isRightHinge ? p2z : p1z;
            const latchX = isRightHinge ? p1x : p2x;
            const latchZ = isRightHinge ? p1z : p2z;
            const leafEndX = hingeX + wm.inwardNormal.x * r;
            const leafEndZ = hingeZ + wm.inwardNormal.z * r;
            const cross =
              (latchX - hingeX) * (leafEndZ - hingeZ) - (latchZ - hingeZ) * (leafEndX - hingeX);
            const sweep = cross >= 0 ? 1 : 0;

            return (
              <g
                key={op.id}
                data-opening-id={op.id}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  if (activeTool !== 'select') return;
                  e.stopPropagation();
                  selectEntity(op.id, 'opening');
                  dragRef.current = {
                    kind: 'opening',
                    openingId: op.id,
                    wallId: op.wallId,
                    moved: false,
                  };
                  captureSvgPointer(e.pointerId);
                }}
              >
                {/* Wall gap */}
                <line
                  x1={p1x}
                  y1={p1z}
                  x2={p2x}
                  y2={p2z}
                  stroke="#020617"
                  strokeWidth={wm.wall.thicknessMm + 16}
                />
                {op.kind === 'fenetre' ? (
                  <line
                    x1={p1x}
                    y1={p1z}
                    x2={p2x}
                    y2={p2z}
                    stroke={isSelected ? '#fbbf24' : '#38bdf8'}
                    strokeWidth={54}
                  />
                ) : (
                  <>
                    <line
                      x1={hingeX}
                      y1={hingeZ}
                      x2={leafEndX}
                      y2={leafEndZ}
                      stroke={isSelected ? '#fbbf24' : '#f59e0b'}
                      strokeWidth={32}
                    />
                    <path
                      d={`M ${latchX} ${latchZ} A ${r} ${r} 0 0 ${sweep} ${leafEndX} ${leafEndZ}`}
                      fill="none"
                      stroke={isSelected ? '#fde68a' : '#d97706'}
                      strokeWidth={16}
                      strokeDasharray="32 22"
                    />
                  </>
                )}

                {/* Live Left / Right Interior Wall Clearances */}
                {isSelected && (() => {
                  const span = getWallInteriorSpanMm(wm, wallMetricsList);
                  const leftClearMm = Math.max(0, Math.round(op.offsetFromStartMm - span.startInsetMm));
                  const rightClearMm = Math.max(
                    0,
                    Math.round(wm.lengthMm - span.endInsetMm - (op.offsetFromStartMm + op.widthMm))
                  );
                  const dimOffset = wm.wall.thicknessMm / 2 + 150;
                  const nx = wm.inwardNormal.x * dimOffset;
                  const nz = wm.inwardNormal.z * dimOffset;
                  const leftCornerX = wm.start.x + wm.tangent.x * span.startInsetMm + nx;
                  const leftCornerZ = wm.start.z + wm.tangent.z * span.startInsetMm + nz;
                  const openStartX = p1x + nx;
                  const openStartZ = p1z + nz;
                  const openEndX = p2x + nx;
                  const openEndZ = p2z + nz;
                  const rightCornerX = wm.start.x + wm.tangent.x * (wm.lengthMm - span.endInsetMm) + nx;
                  const rightCornerZ = wm.start.z + wm.tangent.z * (wm.lengthMm - span.endInsetMm) + nz;
                  return (
                    <g pointerEvents="none">
                      {leftClearMm > 0 && (
                        <>
                          <line
                            x1={leftCornerX}
                            y1={leftCornerZ}
                            x2={openStartX}
                            y2={openStartZ}
                            stroke="#38bdf8"
                            strokeWidth={14}
                          />
                          <text
                            x={(leftCornerX + openStartX) / 2}
                            y={(leftCornerZ + openStartZ) / 2 - 48}
                            textAnchor="middle"
                            fill="#7dd3fc"
                            fontSize={76}
                            fontWeight={700}
                          >
                            {formatDim(leftClearMm, displayUnit)}
                          </text>
                        </>
                      )}
                      {rightClearMm > 0 && (
                        <>
                          <line
                            x1={openEndX}
                            y1={openEndZ}
                            x2={rightCornerX}
                            y2={rightCornerZ}
                            stroke="#38bdf8"
                            strokeWidth={14}
                          />
                          <text
                            x={(openEndX + rightCornerX) / 2}
                            y={(openEndZ + rightCornerZ) / 2 - 48}
                            textAnchor="middle"
                            fill="#7dd3fc"
                            fontSize={76}
                            fontWeight={700}
                          >
                            {formatDim(rightClearMm, displayUnit)}
                          </text>
                        </>
                      )}
                    </g>
                  );
                })()}
              </g>
            );
          })}

          {/* Utilities (Poteaux, Poutres, Prises, Arrivées d'eau) */}
          {doc.utilities.map((u) => {
            const isSelected = selectedKind === 'utility' && selectedId === u.id;
            const w = Math.max(u.widthMm, 110);
            const d = Math.max(u.depthMm, 110);
            const stroke = isSelected
              ? '#fbbf24'
              : u.kind === 'prise'
                ? '#facc15'
                : u.kind === 'arrivee_eau'
                  ? '#38bdf8'
                  : '#94a3b8';
            const fill =
              u.kind === 'prise'
                ? 'rgba(250, 204, 21, 0.3)'
                : u.kind === 'arrivee_eau'
                  ? 'rgba(56, 189, 248, 0.3)'
                  : 'rgba(148, 163, 184, 0.45)';
            return (
              <g
                key={u.id}
                data-utility-id={u.id}
                className="cursor-move"
                onPointerDown={(e) => {
                  if (activeTool !== 'select') return;
                  e.stopPropagation();
                  selectEntity(u.id, 'utility');
                  dragRef.current = {
                    kind: 'utility',
                    utilityId: u.id,
                    moved: false,
                  };
                  captureSvgPointer(e.pointerId);
                }}
              >
                <rect
                  x={u.xMm - w / 2}
                  y={u.zMm - d / 2}
                  width={w}
                  height={d}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={22}
                  strokeDasharray={u.kind === 'poutre' ? '40 24' : undefined}
                />
                <text
                  x={u.xMm}
                  y={u.zMm}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#f8fafc"
                  fontSize={68}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {u.kind === 'prise'
                    ? '⚡'
                    : u.kind === 'arrivee_eau'
                      ? '💧'
                      : u.kind === 'poteau'
                        ? 'P'
                        : 'PT'}
                </text>
              </g>
            );
          })}

          {/* Modules (filtrés selon Bas & Colonnes / Caissons hauts / Plans & Crédences) */}
          {doc.modules
            .filter((m) => {
              if (
                m.type === 'plan_de_travail' ||
                m.type === 'credence' ||
                m.type === 'plinthe'
              ) {
                return plan2dFilters.surfaces;
              }
              if (
                m.type === 'caisson_haut' ||
                m.type === 'meuble_haut_vitre' ||
                m.type === 'caisson_haut_angle' ||
                m.type === 'armoire_miroir_led'
              ) {
                return plan2dFilters.upper;
              }
              return plan2dFilters.base;
            })
            .map((m) => {
            const isSelected = selectedKind === 'module' && selectedIds.includes(m.id);
            const isSingleSelected = isSelected && selectedIds.length === 1;
            const isColliding = collisionModuleIds.has(m.id);
            const { axisX, axisZ } = getModuleAxes2D(m.rotationYRad);
            const isPanCoupe =
              m.type === 'caisson_angle_pan_coupe' || m.type === 'caisson_haut_angle';
            const corners = getModuleCorners2D(m);
            let polyPoints: Array<{ x: number; z: number }> = corners;
            let panDiagP1: { x: number; z: number } | null = null;
            let panDiagP2: { x: number; z: number } | null = null;
            if (isPanCoupe) {
              const hw = m.widthMm / 2;
              const hd = m.depthMm / 2;
              const retSide = Math.min(
                Math.round(Math.min(m.widthMm, m.depthMm) * 0.45),
                m.type === 'caisson_haut_angle' ? 320 : 350
              );
              const toW = (lx: number, lz: number) => ({
                x: m.xMm + lx * axisX.x + lz * axisZ.x,
                z: m.zMm + lx * axisX.z + lz * axisZ.z,
              });
              const pNW = toW(-hw, -hd);
              const pNE = toW(hw, -hd);
              const pSE = toW(hw, hd);
              const pSWCut = toW(hw - retSide, hd);
              const pWNCut = toW(-hw, -hd + retSide);
              polyPoints = [pNW, pNE, pSE, pSWCut, pWNCut];
              panDiagP1 = pWNCut;
              panDiagP2 = pSWCut;
            }
            const pointsStr = polyPoints.map((c) => `${c.x},${c.z}`).join(' ');
            const isWallHung =
              m.type === 'caisson_haut' ||
              m.type === 'meuble_haut_vitre' ||
              m.type === 'caisson_haut_angle' ||
              m.type === 'armoire_miroir_led';

            const fill = isColliding
              ? 'rgba(239, 68, 68, 0.42)'
              : isSelected
                ? 'rgba(245, 158, 11, 0.45)'
                : isWallHung
                  ? 'rgba(56, 189, 248, 0.22)'
                  : 'rgba(200, 157, 108, 0.34)';
            const stroke = isColliding
              ? '#ef4444'
              : isSelected
                ? '#fbbf24'
                : isWallHung
                  ? '#38bdf8'
                  : '#d97706';

            // Top-front corner/edge rotation handle position
            const frontMidX = (corners[2].x + corners[3].x) / 2;
            const frontMidZ = (corners[2].z + corners[3].z) / 2;
            const rotHandleX = frontMidX + axisZ.x * 165;
            const rotHandleZ = frontMidZ + axisZ.z * 165;

            return (
              <g
                key={m.id}
                data-module-id={m.id}
                className="cursor-move"
                onPointerDown={(e) => {
                  if (activeTool !== 'select') return;
                  e.stopPropagation();
                  if (e.shiftKey) {
                    toggleSelectEntity(m.id, 'module');
                    return;
                  }
                  selectEntity(m.id, 'module');
                  const [wx, wz] = clientToWorldMm(e.clientX, e.clientY);
                  dragRef.current = {
                    kind: 'module',
                    moduleId: m.id,
                    offsetX: wx - m.xMm,
                    offsetZ: wz - m.zMm,
                    moved: false,
                  };
                  captureSvgPointer(e.pointerId);
                }}
              >
                <polygon
                  points={pointsStr}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={isSelected || isColliding ? 30 : 20}
                  strokeDasharray={isWallHung ? '45 28' : undefined}
                />
                {/* Blind corner dead-zone indicator (Gauche / Droite, bas & haut) */}
                {(m.type === 'caisson_angle_aveugle' ||
                  m.type === 'caisson_haut_angle_aveugle' ||
                  (m.type === 'caisson_angle' && m.cornerKind === 'aveugle')) && (() => {
                  const blindW = Math.min(
                    Math.round(m.widthMm * 0.45),
                    m.type === 'caisson_haut_angle_aveugle' ? 400 : 450
                  );
                  const blindOnRight = m.blindSide === 'right';
                  const hw = m.widthMm / 2;
                  const hd = m.depthMm / 2;
                  const bxMin = blindOnRight ? hw - blindW : -hw;
                  const bxMax = blindOnRight ? hw : -hw + blindW;
                  const toW = (lx: number, lz: number) => ({
                    x: m.xMm + lx * axisX.x + lz * axisZ.x,
                    z: m.zMm + lx * axisX.z + lz * axisZ.z,
                  });
                  const b0 = toW(bxMin, -hd);
                  const b1 = toW(bxMax, -hd);
                  const b2 = toW(bxMax, hd);
                  const b3 = toW(bxMin, hd);
                  return (
                    <g pointerEvents="none">
                      <polygon
                        points={`${b0.x},${b0.z} ${b1.x},${b1.z} ${b2.x},${b2.z} ${b3.x},${b3.z}`}
                        fill="rgba(15, 23, 42, 0.45)"
                        stroke="#94a3b8"
                        strokeWidth={12}
                        strokeDasharray="24 16"
                      />
                      <line x1={b0.x} y1={b0.z} x2={b2.x} y2={b2.z} stroke="#94a3b8" strokeWidth={10} opacity={0.65} />
                      <line x1={b1.x} y1={b1.z} x2={b3.x} y2={b3.z} stroke="#94a3b8" strokeWidth={10} opacity={0.65} />
                    </g>
                  );
                })()}
                {/* Front facade indicator line */}
                <line
                  x1={panDiagP1 ? panDiagP1.x : corners[2].x}
                  y1={panDiagP1 ? panDiagP1.z : corners[2].z}
                  x2={panDiagP2 ? panDiagP2.x : corners[3].x}
                  y2={panDiagP2 ? panDiagP2.z : corners[3].z}
                  stroke={isColliding ? '#fca5a5' : '#fef3c7'}
                  strokeWidth={28}
                  pointerEvents="none"
                />
                {/* 2D single-door swing arc reflecting hingeSide (Gauche / Droite, incl. blind corner & 45° pan-coupe) */}
                {m.doorCount === 1 && m.type !== 'portes_coulissantes' && (() => {
                  const isBlindCorner =
                    m.type === 'caisson_angle_aveugle' ||
                    m.type === 'caisson_haut_angle_aveugle' ||
                    (m.type === 'caisson_angle' && m.cornerKind === 'aveugle');
                  const blindOnRight = m.blindSide === 'right';
                  const effectiveHinge =
                    m.hingeSide ?? (isBlindCorner ? (blindOnRight ? 'left' : 'right') : 'left');
                  const isRightHinge = effectiveHinge === 'right';

                  let pLeft = panDiagP1 ?? corners[3];
                  let pRight = panDiagP2 ?? corners[2];
                  if (isBlindCorner) {
                    const blindW = Math.min(Math.round(m.widthMm * 0.45), 450);
                    const hw = m.widthMm / 2;
                    const hd = m.depthMm / 2;
                    const dxMin = blindOnRight ? -hw : -hw + blindW;
                    const dxMax = blindOnRight ? hw - blindW : hw;
                    pLeft = {
                      x: m.xMm + dxMin * axisX.x + hd * axisZ.x,
                      z: m.zMm + dxMin * axisX.z + hd * axisZ.z,
                    };
                    pRight = {
                      x: m.xMm + dxMax * axisX.x + hd * axisZ.x,
                      z: m.zMm + dxMax * axisX.z + hd * axisZ.z,
                    };
                  }
                  const hPt = isRightHinge ? pRight : pLeft;
                  const lPt = isRightHinge ? pLeft : pRight;
                  const edgeDx = pRight.x - pLeft.x;
                  const edgeDz = pRight.z - pLeft.z;
                  const edgeLen = Math.hypot(edgeDx, edgeDz) || m.widthMm;
                  const swingR = panDiagP1 ? edgeLen : Math.min(m.widthMm, edgeLen);
                  // Outward normal of edge pLeft -> pRight (for pan-coupe diagonal OR straight front edge)
                  const outX = panDiagP1 ? -edgeDz / edgeLen : axisZ.x;
                  const outZ = panDiagP1 ? edgeDx / edgeLen : axisZ.z;
                  const endX = hPt.x + outX * swingR;
                  const endZ = hPt.z + outZ * swingR;
                  const c = (lPt.x - hPt.x) * (endZ - hPt.z) - (lPt.z - hPt.z) * (endX - hPt.x);
                  const sw = c >= 0 ? 1 : 0;
                  return (
                    <g pointerEvents="none" opacity={isSelected ? 0.9 : 0.45}>
                      <line
                        x1={hPt.x}
                        y1={hPt.z}
                        x2={endX}
                        y2={endZ}
                        stroke="#fbbf24"
                        strokeWidth={14}
                      />
                      <path
                        d={`M ${lPt.x} ${lPt.z} A ${swingR} ${swingR} 0 0 ${sw} ${endX} ${endZ}`}
                        fill="none"
                        stroke="#fbbf24"
                        strokeWidth={10}
                        strokeDasharray="24 18"
                      />
                    </g>
                  );
                })()}
                <text
                  x={m.xMm}
                  y={m.zMm - 32}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#f8fafc"
                  fontSize={96}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {m.ref}
                </text>
                <text
                  x={m.xMm}
                  y={m.zMm + 70}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#cbd5e1"
                  fontSize={72}
                  pointerEvents="none"
                >
                  {formatDim(m.widthMm, displayUnit, false)}
                </text>

                {/* Draggable 2D Corner/Edge Rotation Handle */}
                {isSingleSelected && (
                  <g
                    data-testid={`rotate-handle-${m.id}`}
                    className="cursor-grab"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = {
                        kind: 'rotate',
                        entityKind: 'module',
                        entityId: m.id,
                        centerX: m.xMm,
                        centerZ: m.zMm,
                        moved: false,
                      };
                      captureSvgPointer(e.pointerId);
                    }}
                  >
                    <line
                      x1={frontMidX}
                      y1={frontMidZ}
                      x2={rotHandleX}
                      y2={rotHandleZ}
                      stroke="#fbbf24"
                      strokeWidth={18}
                      strokeDasharray="24 16"
                    />
                    <circle
                      cx={rotHandleX}
                      cy={rotHandleZ}
                      r={68}
                      fill="#fbbf24"
                      stroke="#0f172a"
                      strokeWidth={18}
                    />
                    <text
                      x={rotHandleX}
                      y={rotHandleZ}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0f172a"
                      fontSize={72}
                      fontWeight={800}
                      pointerEvents="none"
                    >
                      ↻
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Électroménager, Éclairage & Déco (Props — filtrés selon Plan 2D) */}
          {(plan2dFilters.props ? doc.props ?? [] : []).map((p) => {
            const isSelected = selectedKind === 'prop' && selectedIds.includes(p.id);
            const isSingleSelected = isSelected && selectedIds.length === 1;
            const corners = getModuleCorners2D(p);
            const pointsStr = corners.map((c) => `${c.x},${c.z}`).join(' ');
            const isLight = p.category === 'eclairage_deco';
            const { axisZ } = getModuleAxes2D(p.rotationYRad);
            const frontMidX = (corners[2].x + corners[3].x) / 2;
            const frontMidZ = (corners[2].z + corners[3].z) / 2;
            const rotHandleX = frontMidX + axisZ.x * 155;
            const rotHandleZ = frontMidZ + axisZ.z * 155;

            return (
              <g
                key={p.id}
                data-prop-id={p.id}
                className="cursor-move"
                onPointerDown={(e) => {
                  if (activeTool !== 'select') return;
                  e.stopPropagation();
                  if (e.shiftKey) {
                    toggleSelectEntity(p.id, 'prop');
                    return;
                  }
                  selectEntity(p.id, 'prop');
                  const [wx, wz] = clientToWorldMm(e.clientX, e.clientY);
                  dragRef.current = {
                    kind: 'prop',
                    propId: p.id,
                    offsetX: wx - p.xMm,
                    offsetZ: wz - p.zMm,
                    moved: false,
                  };
                  captureSvgPointer(e.pointerId);
                }}
              >
                <polygon
                  points={pointsStr}
                  fill={
                    isSelected
                      ? 'rgba(56, 189, 248, 0.42)'
                      : isLight
                        ? 'rgba(250, 204, 21, 0.22)'
                        : 'rgba(14, 165, 233, 0.24)'
                  }
                  stroke={isSelected ? '#38bdf8' : isLight ? '#eab308' : '#0284c7'}
                  strokeWidth={isSelected ? 28 : 18}
                  strokeDasharray={p.type === 'suspension_lustre' ? '36 22' : undefined}
                />
                <line
                  x1={corners[2].x}
                  y1={corners[2].z}
                  x2={corners[3].x}
                  y2={corners[3].z}
                  stroke="#bae6fd"
                  strokeWidth={22}
                  pointerEvents="none"
                />
                <text
                  x={p.xMm}
                  y={p.zMm - 24}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#e0f2fe"
                  fontSize={84}
                  fontWeight={700}
                  pointerEvents="none"
                >
                  {p.ref}
                </text>
                <text
                  x={p.xMm}
                  y={p.zMm + 64}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#bae6fd"
                  fontSize={62}
                  pointerEvents="none"
                >
                  {formatDim(p.widthMm, displayUnit, false)}
                </text>

                {isSingleSelected && (
                  <g
                    data-testid={`rotate-handle-${p.id}`}
                    className="cursor-grab"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      dragRef.current = {
                        kind: 'rotate',
                        entityKind: 'prop',
                        entityId: p.id,
                        centerX: p.xMm,
                        centerZ: p.zMm,
                        moved: false,
                      };
                      captureSvgPointer(e.pointerId);
                    }}
                  >
                    <line
                      x1={frontMidX}
                      y1={frontMidZ}
                      x2={rotHandleX}
                      y2={rotHandleZ}
                      stroke="#38bdf8"
                      strokeWidth={16}
                      strokeDasharray="24 16"
                    />
                    <circle
                      cx={rotHandleX}
                      cy={rotHandleZ}
                      r={64}
                      fill="#38bdf8"
                      stroke="#0f172a"
                      strokeWidth={16}
                    />
                    <text
                      x={rotHandleX}
                      y={rotHandleZ}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#0f172a"
                      fontSize={68}
                      fontWeight={800}
                      pointerEvents="none"
                    >
                      ↻
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* Ceiling Spotlights (draggable & Shift/Ctrl multi-selectable in 2D Plan) */}
          {showCeilingSpots2D &&
            ceilingLighting.spots.map((sp, idx) => {
              const isSelected = selectedKind === 'spot' && selectedIds.includes(sp.id);
              const isActive = ceilingLighting.spotsEnabled && sp.enabled !== false && ceilingLighting.spotIntensity > 0;
              return (
                <g
                  key={sp.id}
                  data-spot-id={sp.id}
                  className="cursor-move"
                  onPointerDown={(e) => {
                    if (activeTool !== 'select') return;
                    e.stopPropagation();
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      toggleSelectEntity(sp.id, 'spot');
                      return;
                    }
                    const alreadyInMulti =
                      selectedKind === 'spot' &&
                      selectedIds.length > 1 &&
                      selectedIds.includes(sp.id);
                    const dragIds = alreadyInMulti ? selectedIds : [sp.id];
                    if (!alreadyInMulti) {
                      selectEntity(sp.id, 'spot');
                    }
                    const startPt = clientToWorldMm(e.clientX, e.clientY);
                    dragRef.current = {
                      kind: 'spot',
                      spotId: sp.id,
                      startWorldX: startPt[0],
                      startWorldZ: startPt[1],
                      initialPositions: ceilingLighting.spots
                        .filter((s) => dragIds.includes(s.id))
                        .map((s) => ({ id: s.id, xMm: s.xMm, zMm: s.zMm })),
                      moved: false,
                    };
                    captureSvgPointer(e.pointerId);
                  }}
                >
                  <circle
                    cx={sp.xMm}
                    cy={sp.zMm}
                    r={isSelected ? 125 : 100}
                    fill={isActive ? 'rgba(251, 191, 36, 0.20)' : 'rgba(148, 163, 184, 0.14)'}
                    stroke={isSelected ? '#fde047' : isActive ? '#f59e0b' : '#64748b'}
                    strokeWidth={isSelected ? 22 : 14}
                    strokeDasharray="30 18"
                  />
                  <circle
                    cx={sp.xMm}
                    cy={sp.zMm}
                    r={32}
                    fill={isActive ? '#fef08a' : '#94a3b8'}
                    pointerEvents="none"
                  />
                  <text
                    x={sp.xMm}
                    y={sp.zMm + 150}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={isSelected ? '#fef08a' : '#fbbf24'}
                    fontSize={62}
                    fontWeight={700}
                    pointerEvents="none"
                  >
                    S{idx + 1}
                  </text>
                </g>
              );
            })}

          {/* Marquee Multi-Selection Rectangle */}
          {marqueeBox && (
            <rect
              x={marqueeBox.x1}
              y={marqueeBox.z1}
              width={marqueeBox.x2 - marqueeBox.x1}
              height={marqueeBox.z2 - marqueeBox.z1}
              fill="rgba(56, 189, 248, 0.14)"
              stroke="#38bdf8"
              strokeWidth={18}
              strokeDasharray="48 28"
              pointerEvents="none"
            />
          )}

          {/* Live Rotation Angle Degree Badge */}
          {rotationBadge && (
            <g pointerEvents="none">
              <rect
                x={rotationBadge.x + 80}
                y={rotationBadge.z - 80}
                width={260}
                height={120}
                rx={24}
                fill="#0f172a"
                stroke="#fbbf24"
                strokeWidth={12}
              />
              <text
                x={rotationBadge.x + 210}
                y={rotationBadge.z - 20}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fde68a"
                fontSize={76}
                fontWeight={700}
              >
                {rotationBadge.deg}°
              </text>
            </g>
          )}

          {/* Magnetic Snap Guides & Live Wall Drawing Preview */}
          <SnapGuidesSvg
            guides={snapGuides}
            draftWall={draftWall}
            displayUnit={displayUnit}
          />
        </svg>

        {/* Active Tool Hint Pill */}
        {activeTool !== 'select' && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-atelier-accent/60 bg-atelier-panel/95 px-2.5 py-1 text-xs text-atelier-accent-text shadow-lg">
            {activeTool === 'draw_wall'
              ? 'Glissez ou cliquez deux points pour tracer un mur (Échap pour annuler)'
              : 'Cliquez sur le plan ou sur un mur pour placer l’élément'}
          </div>
        )}
      </div>

      {/* Collision warnings (only visible when collisions exist) */}
      <CollisionWarningsBanner
        warnings={collisions}
        fixableSolutions={fixableSolutions}
        onAutoFitModule={(modId) => {
          const sol = fixableSolutions.get(modId);
          if (!sol) return;
          updateModule(sol.moduleId, sol.patch);
          selectEntity(sol.moduleId, 'module');
        }}
      />

      {/* Bottom status */}
      <div className="mt-1.5 flex items-center justify-between text-xs text-atelier-muted">
        <span>Molette : zoom · Alt+glisser : déplacer la vue · R : pivoter 90°</span>
        <span className="tabular-nums">
          {FR.carpentry.ceilingHeight} : {formatDim(doc.ceilingHeightMm, displayUnit)}
        </span>
      </div>
    </div>
  );
}
