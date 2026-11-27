import type {
  CarpentryParams,
  ModuleInstance,
  ModuleOutput,
  PanelAnimationMeta,
  PanelSpec,
} from '@/types';
import { roundMm } from '@/utils/units';
import {
  addHandleHardware,
  buildCarcassPanels,
  buildDrawers,
  buildHingedDoors,
  buildPlinthPanel,
  buildShelves,
  buildVerticalDividers,
  createHardwareAccumulator,
  createPanelIdCounter,
  edgePreset,
  facadeGrain,
  makePanel,
  resolveParams,
} from './panelBuilder';

export function generateDressingModule(
  module: ModuleInstance,
  defaults: CarpentryParams
): ModuleOutput {
  const params = resolveParams(module, defaults);
  const counter = createPanelIdCounter(module.id);
  const hw = createHardwareAccumulator();
  const warnings: string[] = [];

  const W = Math.max(20, module.widthMm);
  const H = Math.max(10, module.heightMm);
  const D = Math.max(10, module.depthMm);
  const T = params.boardThickness;

  const H_plinth =
    module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - 250));
  const H_carcass = Math.max(120, H - H_plinth);
  const panels: PanelSpec[] = [];

  switch (module.type) {
    case 'dressing_penderie': {
      const hasFacades = module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(100, D - T) : D;
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        warnings,
      });
      panels.push(...carcass.panels);

      // Top hat shelf + optional bottom shelf
      if (module.shelfCount > 0) {
        const yShelfZoneMin = Math.max(
          carcass.yInnerBottom + 80,
          carcass.yInnerTop - Math.max(320, module.shelfCount * 300)
        );
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: module.shelfCount,
          bayCenterXMm: 0,
          bayInnerWidthMm: carcass.innerW,
          yMinMm: yShelfZoneMin,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades,
          labelFr: 'Étagère chapelière',
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
      }

      hw.add('tringle', Math.max(0.2, roundMm(carcass.innerW / 1000, 2)));

      if (hasFacades) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: H_plinth,
          zoneHeightMm: H_carcass,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, H_carcass);
      }

      if (H_plinth > 0) {
        const plinth = buildPlinthPanel(
          counter,
          params,
          W,
          H_plinth,
          carcass.innerZFront,
          module.grainDirection
        );
        if (plinth) panels.push(plinth);
        hw.add('pied_reglable', W > 900 ? 6 : 4);
      }
      break;
    }

    case 'dressing_etagere': {
      const hasFacades = module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(100, D - T) : D;
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        warnings,
      });
      panels.push(...carcass.panels);

      const shelves = buildShelves({
        counter,
        params,
        shelfCount: module.shelfCount,
        bayCenterXMm: 0,
        bayInnerWidthMm: carcass.innerW,
        yMinMm: carcass.yInnerBottom,
        yMaxMm: carcass.yInnerTop,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        hasFacades,
      });
      panels.push(...shelves);
      hw.add('taquet', shelves.length * 4);

      if (hasFacades) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: H_plinth,
          zoneHeightMm: H_carcass,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, H_carcass);
      }

      if (H_plinth > 0) {
        const plinth = buildPlinthPanel(
          counter,
          params,
          W,
          H_plinth,
          carcass.innerZFront,
          module.grainDirection
        );
        if (plinth) panels.push(plinth);
        hw.add('pied_reglable', W > 900 ? 6 : 4);
      }
      break;
    }

    case 'dressing_tiroirs': {
      const numDrawers = Math.max(1, module.drawerCount);
      const D_carcass = Math.max(120, D - T);
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        warnings,
      });
      panels.push(...carcass.panels);

      const drawerZoneH = Math.min(H_carcass * 0.55, Math.max(300, numDrawers * 180));
      const zFacadeCenter = D / 2 - T / 2;

      const drw = buildDrawers({
        counter,
        params,
        drawerCount: numDrawers,
        zoneCenterXMm: 0,
        zoneWidthMm: W,
        bayInnerWidthMm: carcass.innerW,
        zoneBottomYMm: H_plinth,
        zoneHeightMm: drawerZoneH,
        zFacadeCenterMm: zFacadeCenter,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        moduleGrain: module.grainDirection,
        warnings,
      });
      panels.push(...drw.panels);
      hw.add('coulisse', drw.runnerCount);
      addHandleHardware(hw, params.handleStyle, numDrawers, W);

      // Fixed separator shelf above drawer bank
      const yCap = H_plinth + drawerZoneH;
      const capShelf = buildShelves({
        counter,
        params,
        shelfCount: 1,
        bayCenterXMm: 0,
        bayInnerWidthMm: carcass.innerW,
        yMinMm: yCap - T,
        yMaxMm: yCap + T,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        hasFacades: true,
        labelFr: 'Tablette fixe sur tiroirs',
      });
      panels.push(...capShelf);

      // Upper adjustable shelves
      const shelves = buildShelves({
        counter,
        params,
        shelfCount: module.shelfCount,
        bayCenterXMm: 0,
        bayInnerWidthMm: carcass.innerW,
        yMinMm: yCap + T,
        yMaxMm: carcass.yInnerTop,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        hasFacades: module.doorCount > 0,
      });
      panels.push(...shelves);
      hw.add('taquet', shelves.length * 4);

      if (module.doorCount > 0 && H_plinth + H_carcass - yCap >= 100) {
        const upperDoors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: yCap,
          zoneHeightMm: H_plinth + H_carcass - yCap,
          zFacadeCenterMm: zFacadeCenter,
          moduleGrain: module.grainDirection,
        });
        panels.push(...upperDoors.panels);
        hw.add('charniere', upperDoors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, H_carcass - drawerZoneH);
      }

      if (H_plinth > 0) {
        const plinth = buildPlinthPanel(
          counter,
          params,
          W,
          H_plinth,
          carcass.innerZFront,
          module.grainDirection
        );
        if (plinth) panels.push(plinth);
        hw.add('pied_reglable', W > 900 ? 6 : 4);
      }
      break;
    }

    case 'portes_battantes': {
      const hasFacades = module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(120, D - T) : D;
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        warnings,
      });
      panels.push(...carcass.panels);

      const numBays = W > 950 ? 2 : 1;
      const div = buildVerticalDividers(
        counter,
        params,
        numBays,
        carcass.innerW,
        carcass.yInnerBottom,
        carcass.yInnerTop,
        carcass.innerZBack,
        carcass.innerZFront
      );
      panels.push(...div.panels);

      for (let b = 0; b < div.bays.length; b++) {
        const bayCount =
          numBays === 2
            ? b === 0
              ? Math.ceil(module.shelfCount / 2)
              : Math.floor(module.shelfCount / 2)
            : module.shelfCount;
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: bayCount,
          bayCenterXMm: div.bays[b].centerX,
          bayInnerWidthMm: div.bays[b].innerW,
          yMinMm: carcass.yInnerBottom,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
      }

      hw.add('tringle', Math.max(0.2, roundMm(carcass.innerW / 1000, 2)));

      if (hasFacades) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: H_plinth,
          zoneHeightMm: H_carcass,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, H_carcass);
      }

      if (H_plinth > 0) {
        const plinth = buildPlinthPanel(
          counter,
          params,
          W,
          H_plinth,
          carcass.innerZFront,
          module.grainDirection
        );
        if (plinth) panels.push(plinth);
        hw.add('pied_reglable', W > 900 ? 6 : 4);
      }
      break;
    }

    case 'portes_coulissantes': {
      const trackZoneMm = 2 * T + 12;
      const D_carcass = Math.max(150, D - trackZoneMm);
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        warnings,
      });
      panels.push(...carcass.panels);

      const numBays = W > 1800 ? 3 : 2;
      const div = buildVerticalDividers(
        counter,
        params,
        numBays,
        carcass.innerW,
        carcass.yInnerBottom,
        carcass.yInnerTop,
        carcass.innerZBack,
        carcass.innerZFront
      );
      panels.push(...div.panels);

      const shelvesPerBay = Math.max(0, Math.ceil(module.shelfCount / numBays));
      for (const bay of div.bays) {
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: shelvesPerBay,
          bayCenterXMm: bay.centerX,
          bayInnerWidthMm: bay.innerW,
          yMinMm: carcass.yInnerBottom,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades: true,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
      }

      const nDoors = Math.max(2, Math.min(3, module.doorCount || 2));
      const overlap = 25;
      const doorW = Math.max(100, (W + (nDoors - 1) * overlap) / nDoors);
      const doorH = Math.max(100, H_carcass - 20);
      const doorY = H_plinth + H_carcass / 2;
      // Distinct front/back Z-tracks separated by panel thickness + 4 mm air gap so leaves never z-fight
      const trackGapMm = 4;
      const zFrontTrack = D / 2 - 0.5 * T - 2;
      const zRearTrack = zFrontTrack - (T + trackGapMm);
      const grain = facadeGrain(params.facadeMaterialId, 'V', module.grainDirection);
      // Slide only the active leaf(ves) cleanly to the right so the interior is genuinely exposed
      const maxTwoDoorTravel = Math.max(50, doorW - overlap);
      const twoDoorTravel = roundMm(Math.min(doorW * 0.88, maxTwoDoorTravel), 2);
      const threeDoorFrontGap = Math.max(40, doorW - 2 * overlap - 4);
      const threeDoorFrontTravel = roundMm(Math.min(doorW * 0.88, threeDoorFrontGap), 2);
      const threeDoorMiddleTravel = roundMm(Math.min(doorW * 0.88, doorW - overlap), 2);

      for (let i = 0; i < nDoors; i++) {
        const cx = -W / 2 + doorW / 2 + i * (doorW - overlap);
        const cz = i % 2 === 0 ? zFrontTrack : zRearTrack;
        let leafTravel = 0;
        if (nDoors === 2) {
          // Only front-left door (i === 0) slides right over back-right door (i === 1)
          leafTravel = i === 0 ? twoDoorTravel : 0;
        } else {
          // For 3 doors: front-left (i === 0) slides right toward center bay,
          // rear-middle (i === 1) slides right behind front-right (i === 2),
          // front-right (i === 2) stays stationary so all leaves stack cleanly on the right
          leafTravel =
            i === 0 ? threeDoorFrontTravel : i === 1 ? threeDoorMiddleTravel : 0;
        }

        const dir: 1 | -1 = 1;
        const animGroup = leafTravel > 0 ? 'slide_left' : 'slide_right';
        const animMeta: PanelAnimationMeta = {
          kind: 'sliding',
          index: i,
          slideDirection: dir,
          slideTravelMm: leafTravel,
        };

        panels.push(
          makePanel(counter, {
            nameFr: `Vantail coulissant ${i + 1}`,
            role: 'porte',
            materialId: params.facadeMaterialId,
            widthMm: doorW,
            heightMm: doorH,
            thicknessMm: T,
            positionMm: [cx, doorY, cz],
            rotationRad: [0, 0, 0],
            grain,
            edges: edgePreset('porte'),
            animationGroup: animGroup,
            animationMeta: animMeta,
          })
        );
      }

      hw.add('kit_coulissant', 1);
      const totalRodMl = div.bays.reduce((sum, bay) => sum + bay.innerW / 1000, 0);
      hw.add('tringle', Math.max(0.2, roundMm(totalRodMl, 2)));
      addHandleHardware(hw, params.handleStyle, nDoors, H_carcass * nDoors);

      if (H_plinth > 0) {
        const plinth = buildPlinthPanel(
          counter,
          params,
          W,
          H_plinth,
          carcass.innerZFront,
          module.grainDirection
        );
        if (plinth) panels.push(plinth);
        hw.add('pied_reglable', W > 1100 ? 6 : 4);
      }
      break;
    }

    default:
      break;
  }

  return {
    panels,
    hardware: hw.list(),
    boundingBoxMm: { widthMm: W, heightMm: H, depthMm: D },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
