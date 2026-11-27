import type { CarpentryParams, ModuleInstance, ModuleOutput, PanelSpec } from '@/types';
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
  makePanel,
  normalizeGrain,
  resolveParams,
} from './panelBuilder';

export function generateBathroomModule(
  module: ModuleInstance,
  defaults: CarpentryParams
): ModuleOutput {
  const params = resolveParams(module, defaults);
  const counter = createPanelIdCounter(module.id);
  const hw = createHardwareAccumulator();
  const warnings: string[] = [];

  const W = Math.max(200, module.widthMm);
  const H = Math.max(200, module.heightMm);
  const D = Math.max(100, module.depthMm);
  const T = params.boardThickness;
  const panels: PanelSpec[] = [];

  switch (module.type) {
    case 'meuble_vasque':
    case 'meuble_double_vasque': {
      const isDouble = module.type === 'meuble_double_vasque';
      const hasFacades = module.drawerCount > 0 || module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(150, D - T) : D;

      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H,
        depthMm: D_carcass,
        yBaseMm: 0,
        zBackMm: -D / 2,
        topMode: 'stretchers',
        isWallHung: true,
        exposedSides: true,
        warnings,
      });
      panels.push(...carcass.panels);

      const numBays = isDouble ? 2 : 1;
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

      const zFacadeCenter = D / 2 - T / 2;
      const totalDrawers = module.drawerCount > 0 ? module.drawerCount : isDouble ? 4 : 2;
      let drawerIdx = 0;

      if (module.drawerCount > 0 || module.doorCount === 0) {
        for (let b = 0; b < numBays; b++) {
          const bayDrawers =
            numBays === 2
              ? b === 0
                ? Math.ceil(totalDrawers / 2)
                : Math.floor(totalDrawers / 2)
              : totalDrawers;
          if (bayDrawers <= 0) continue;
          const bay = div.bays[b];
          const zoneW = numBays === 2 ? W / 2 : W;
          const zoneCX = numBays === 2 ? (b === 0 ? -W / 4 : W / 4) : 0;
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: bayDrawers,
            zoneCenterXMm: zoneCX,
            zoneWidthMm: zoneW,
            bayInnerWidthMm: bay.innerW,
            zoneBottomYMm: 0,
            zoneHeightMm: H,
            zFacadeCenterMm: zFacadeCenter,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            startDrawerIndex: drawerIdx,
            moduleGrain: module.grainDirection,
            warnings,
          });
          panels.push(...drw.panels);
          hw.add('coulisse', drw.runnerCount);
          drawerIdx += bayDrawers;
        }
        addHandleHardware(hw, params.handleStyle, totalDrawers, W);
      } else if (module.doorCount > 0) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: 0,
          zoneHeightMm: H,
          zFacadeCenterMm: zFacadeCenter,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, W);
      }

      hw.add('suspension_murale', isDouble ? 4 : 2);
      break;
    }

    case 'armoire_miroir_led': {
      const hasFacades = module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(80, D - T) : D;
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H,
        depthMm: D_carcass,
        yBaseMm: 0,
        zBackMm: -D / 2,
        topMode: 'full',
        isWallHung: true,
        exposedSides: true,
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
          zoneBottomYMm: 0,
          zoneHeightMm: H,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        // Mirror cabinet doors use push-to-open dampers (prise de main discrète / push-open)
        addHandleHardware(hw, 'push', module.doorCount, W);
      }

      hw.add('suspension_murale', W > 900 ? 3 : 2);
      break;
    }

    case 'colonne_sdb': {
      const hasFacades = module.doorCount > 0;
      const D_carcass = hasFacades ? Math.max(100, D - T) : D;
      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H,
        depthMm: D_carcass,
        yBaseMm: 0,
        zBackMm: -D / 2,
        topMode: 'full',
        isWallHung: true,
        exposedSides: true,
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
          zoneBottomYMm: 0,
          zoneHeightMm: H,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, H);
      }

      hw.add('suspension_murale', 2);
      break;
    }

    case 'meuble_buanderie': {
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, 100);
      const H_carcass = Math.max(400, H - H_plinth);
      const D_carcass = Math.max(250, D - T);

      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'full',
        exposedSides: true,
        warnings,
      });
      panels.push(...carcass.panels);

      // Fixed work shelf above washing machine niche (~880 mm clearance)
      const nicheH = Math.min(900, Math.round(H_carcass * 0.45));
      const yShelf = H_plinth + nicheH;
      const shelfD = Math.max(80, carcass.innerZFront - carcass.innerZBack - 4);
      const shelfZ = carcass.innerZBack + 2 + shelfD / 2;
      panels.push(
        makePanel(counter, {
          nameFr: 'Tablette fixe sur niche lave-linge',
          role: 'etagere',
          materialId: params.carcassMaterialId,
          widthMm: carcass.innerW,
          heightMm: shelfD,
          thicknessMm: T,
          positionMm: [0, yShelf, shelfZ],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: normalizeGrain(params.carcassMaterialId, 'H'),
          edges: edgePreset('etagere'),
        })
      );

      const upperH = H_plinth + H_carcass - (yShelf + T);
      if (module.shelfCount > 0 && upperH > 200) {
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: module.shelfCount,
          bayCenterXMm: 0,
          bayInnerWidthMm: carcass.innerW,
          yMinMm: yShelf + T,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades: module.doorCount > 0,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
      }

      if (module.doorCount > 0 && upperH > 150) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: yShelf + T / 2,
          zoneHeightMm: upperH,
          zFacadeCenterMm: D / 2 - T / 2,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, module.doorCount, W);
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
        hw.add('pied_reglable', 4);
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
