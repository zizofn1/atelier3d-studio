import type {
  CarpentryParams,
  ModuleInstance,
  ModuleOutput,
  PanelSpec,
} from '@/types';
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

export function generateCustomModule(
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

  const panels: PanelSpec[] = [];

  switch (module.type) {
    case 'meuble_tv': {
      const H_plinth = module.hasPlinth
        ? Math.min(params.plinthHeightMm, 120, Math.max(0, H - 150))
        : 0;
      const H_carcass = Math.max(100, H - H_plinth);
      const hasFacades = module.doorCount > 0 || module.drawerCount > 0;
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

      const numBays = W >= 1200 ? 3 : 2;
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

      if (numBays === 3) {
        // Outer bays: doors (left & right)
        if (module.doorCount > 0) {
          const leftDoors = Math.max(1, Math.ceil(module.doorCount / 2));
          const rightDoors = module.doorCount - leftDoors;

          const b0 = div.bays[0];
          const d0 = buildHingedDoors({
            counter,
            params,
            doorCount: leftDoors,
            zoneCenterXMm: b0.centerX - T / 2,
            zoneWidthMm: b0.innerW + T,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: H_carcass,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...d0.panels);
          hw.add('charniere', d0.hinges);

          if (rightDoors > 0) {
            const b2 = div.bays[2];
            const d2 = buildHingedDoors({
              counter,
              params,
              doorCount: rightDoors,
              zoneCenterXMm: b2.centerX + T / 2,
              zoneWidthMm: b2.innerW + T,
              zoneBottomYMm: H_plinth,
              zoneHeightMm: H_carcass,
              zFacadeCenterMm: zFacadeCenter,
              moduleGrain: module.grainDirection,
            });
            panels.push(...d2.panels);
            hw.add('charniere', d2.hinges);
          }
          addHandleHardware(hw, params.handleStyle, module.doorCount, b0.innerW * 2);
        }

        // Center bay: drawers + niche shelves
        const bCenter = div.bays[1];
        const drawerZoneH =
          module.drawerCount > 0 ? Math.round(H_carcass * 0.55) : 0;
        if (module.drawerCount > 0) {
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: module.drawerCount,
            zoneCenterXMm: bCenter.centerX,
            zoneWidthMm: bCenter.innerW + T,
            bayInnerWidthMm: bCenter.innerW,
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
          addHandleHardware(hw, params.handleStyle, module.drawerCount, bCenter.innerW);
        }

        if (module.shelfCount > 0) {
          const shelves = buildShelves({
            counter,
            params,
            shelfCount: module.shelfCount,
            bayCenterXMm: bCenter.centerX,
            bayInnerWidthMm: bCenter.innerW,
            yMinMm: H_plinth + (module.drawerCount > 0 ? drawerZoneH : T),
            yMaxMm: carcass.yInnerTop,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            hasFacades: false,
          });
          panels.push(...shelves);
          hw.add('taquet', shelves.length * 4);
        }
      } else {
        // 2 bays: bay 0 doors, bay 1 drawers + shelves
        const b0 = div.bays[0];
        const b1 = div.bays[1];
        if (module.doorCount > 0) {
          const d0 = buildHingedDoors({
            counter,
            params,
            doorCount: module.doorCount,
            zoneCenterXMm: b0.centerX - T / 2,
            zoneWidthMm: b0.innerW + T,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: H_carcass,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...d0.panels);
          hw.add('charniere', d0.hinges);
          addHandleHardware(hw, params.handleStyle, module.doorCount, b0.innerW);
        }

        const drawerZoneH =
          module.drawerCount > 0 ? Math.round(H_carcass * 0.55) : 0;
        if (module.drawerCount > 0) {
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: module.drawerCount,
            zoneCenterXMm: b1.centerX,
            zoneWidthMm: b1.innerW + T,
            bayInnerWidthMm: b1.innerW,
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
          addHandleHardware(hw, params.handleStyle, module.drawerCount, b1.innerW);
        }

        if (module.shelfCount > 0) {
          const shelves = buildShelves({
            counter,
            params,
            shelfCount: module.shelfCount,
            bayCenterXMm: b1.centerX,
            bayInnerWidthMm: b1.innerW,
            yMinMm: H_plinth + (module.drawerCount > 0 ? drawerZoneH : T),
            yMaxMm: carcass.yInnerTop,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            hasFacades: false,
          });
          panels.push(...shelves);
          hw.add('taquet', shelves.length * 4);
        }
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
        hw.add('pied_reglable', W > 1200 ? 6 : 4);
      } else {
        hw.add('verin', W > 1200 ? 6 : 4);
      }
      break;
    }

    case 'bibliotheque': {
      const H_plinth = module.hasPlinth
        ? Math.min(params.plinthHeightMm, 100, Math.max(0, H - 200))
        : 0;
      const H_carcass = Math.max(150, H - H_plinth);
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

      const cols = Math.max(
        1,
        Math.min(4, module.columnCount ?? (W >= 1800 ? 3 : W >= 1000 ? 2 : 1))
      );
      const div = buildVerticalDividers(
        counter,
        params,
        cols,
        carcass.innerW,
        carcass.yInnerBottom,
        carcass.yInnerTop,
        carcass.innerZBack,
        carcass.innerZFront
      );
      panels.push(...div.panels);

      for (const bay of div.bays) {
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: module.shelfCount,
          bayCenterXMm: bay.centerX,
          bayInnerWidthMm: bay.innerW,
          yMinMm: carcass.yInnerBottom,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
      }

      if (hasFacades) {
        const lowerDoorH = Math.min(Math.round(H_carcass * 0.4), 750);
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: module.doorCount,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: H_plinth,
          zoneHeightMm: lowerDoorH,
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
      }
      hw.add('verin', cols > 2 ? 6 : 4);
      break;
    }

    case 'bureau': {
      const topGrain = normalizeGrain(params.facadeMaterialId, 'H');
      const legGrain = normalizeGrain(params.carcassMaterialId, 'V');
      const legH = Math.max(100, H - T);
      const legD = Math.max(80, D - 40);

      // Desktop top
      panels.push(
        makePanel(counter, {
          nameFr: 'Plateau bureau',
          role: 'plan_travail',
          materialId: params.facadeMaterialId,
          widthMm: W,
          heightMm: D,
          thicknessMm: T,
          positionMm: [0, H - T / 2, 0],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: topGrain,
          edges: edgePreset('plan_travail', { exposedAll: true }),
        })
      );

      // Left leg panel
      const leftLegX = -W / 2 + T / 2 + 20;
      panels.push(
        makePanel(counter, {
          nameFr: 'Panneau piètement gauche',
          role: 'pied_panneau',
          materialId: params.carcassMaterialId,
          widthMm: legD,
          heightMm: legH,
          thicknessMm: T,
          positionMm: [leftLegX, legH / 2, 0],
          rotationRad: [0, -Math.PI / 2, 0],
          grain: legGrain,
          edges: edgePreset('pied_panneau'),
        })
      );

      const numDrawers = module.drawerCount;
      let modestyRightEdgeX = W / 2 - T - 20;

      if (numDrawers > 0) {
        // Right drawer pedestal
        const pedestalW = Math.min(450, Math.max(200, Math.round(W * 0.34)));
        const pedestalRightX = W / 2 - 20;
        const pedestalLeftX = pedestalRightX - pedestalW;
        const pedestalCenterX = (pedestalLeftX + pedestalRightX) / 2;
        const pedestalInnerW = Math.max(60, pedestalW - 2 * T);
        const pedestalD = Math.max(150, legD - T);
        const pedestalZBack = -legD / 2;
        const pedestalZFront = pedestalZBack + pedestalD;
        const pedestalZMid = (pedestalZBack + pedestalZFront) / 2;
        const zFacadeCenter = legD / 2 - T / 2;

        modestyRightEdgeX = pedestalLeftX;

        // Pedestal inner side, outer side, bottom, back
        panels.push(
          makePanel(counter, {
            nameFr: 'Séparateur caisson bureau',
            role: 'separateur',
            materialId: params.carcassMaterialId,
            widthMm: pedestalD,
            heightMm: legH,
            thicknessMm: T,
            positionMm: [pedestalLeftX + T / 2, legH / 2, pedestalZMid],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: legGrain,
            edges: edgePreset('pied_panneau'),
          }),
          makePanel(counter, {
            nameFr: 'Joue droite caisson bureau',
            role: 'joue_droite',
            materialId: params.carcassMaterialId,
            widthMm: pedestalD,
            heightMm: legH,
            thicknessMm: T,
            positionMm: [pedestalRightX - T / 2, legH / 2, pedestalZMid],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: legGrain,
            edges: edgePreset('joue_droite', { exposedAll: true }),
          }),
          makePanel(counter, {
            nameFr: 'Dessous caisson bureau',
            role: 'dessous',
            materialId: params.carcassMaterialId,
            widthMm: pedestalInnerW,
            heightMm: pedestalD,
            thicknessMm: T,
            positionMm: [pedestalCenterX, T / 2, pedestalZMid],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: normalizeGrain(params.carcassMaterialId, 'H'),
            edges: edgePreset('dessous'),
          }),
          makePanel(counter, {
            nameFr: 'Fond caisson bureau',
            role: 'fond',
            materialId: params.backMaterialId,
            widthMm: Math.max(20, pedestalW - 2),
            heightMm: Math.max(20, legH - 2),
            thicknessMm: params.backThickness,
            positionMm: [pedestalCenterX, legH / 2, pedestalZBack + params.backThickness / 2],
            rotationRad: [0, 0, 0],
            grain: normalizeGrain(params.backMaterialId, 'V'),
            edges: edgePreset('fond'),
          })
        );

        const drw = buildDrawers({
          counter,
          params,
          drawerCount: numDrawers,
          zoneCenterXMm: pedestalCenterX,
          zoneWidthMm: pedestalW,
          bayInnerWidthMm: pedestalInnerW,
          zoneBottomYMm: 0,
          zoneHeightMm: legH,
          zFacadeCenterMm: zFacadeCenter,
          innerZBackMm: pedestalZBack + params.backThickness,
          innerZFrontMm: pedestalZFront,
          moduleGrain: module.grainDirection,
          warnings,
        });
        panels.push(...drw.panels);
        hw.add('coulisse', drw.runnerCount);
        addHandleHardware(hw, params.handleStyle, numDrawers, pedestalW);
      } else {
        // Right leg panel
        panels.push(
          makePanel(counter, {
            nameFr: 'Panneau piètement droit',
            role: 'pied_panneau',
            materialId: params.carcassMaterialId,
            widthMm: legD,
            heightMm: legH,
            thicknessMm: T,
            positionMm: [W / 2 - T / 2 - 20, legH / 2, 0],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: legGrain,
            edges: edgePreset('pied_panneau'),
          })
        );
      }

      // Rear modesty panel
      const modestyW = Math.max(60, modestyRightEdgeX - (-W / 2 + T + 20));
      const modestyH = Math.min(350, Math.max(80, legH - 120));
      const modestyCX = (-W / 2 + T + 20 + modestyRightEdgeX) / 2;
      panels.push(
        makePanel(counter, {
          nameFr: 'Voile de fond bureau',
          role: 'pied_panneau',
          materialId: params.carcassMaterialId,
          widthMm: modestyW,
          heightMm: modestyH,
          thicknessMm: T,
          positionMm: [modestyCX, legH - modestyH / 2, -legD / 2 + T / 2 + 40],
          rotationRad: [0, 0, 0],
          grain: normalizeGrain(params.carcassMaterialId, 'H'),
          edges: edgePreset('pied_panneau'),
        })
      );

      hw.add('verin', 4);
      break;
    }

    case 'banc_entree': {
      const H_plinth = module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, 70);
      const seatT = Math.max(T, 22);
      const H_carcass = Math.max(180, H - H_plinth - seatT);
      const hasFacades = module.doorCount > 0 || module.drawerCount > 0;
      const D_carcass = hasFacades ? Math.max(160, D - T) : D;

      // Seat top slab
      panels.push(
        makePanel(counter, {
          nameFr: "Assise banc d'entrée",
          role: 'plan_travail',
          materialId: params.facadeMaterialId,
          widthMm: W,
          heightMm: D,
          thicknessMm: seatT,
          positionMm: [0, H - seatT / 2, 0],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: normalizeGrain(params.facadeMaterialId, 'H'),
          edges: edgePreset('plan_travail', { exposedAll: true }),
          surfaceSlot: 'facade',
        })
      );

      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'stretchers',
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
        labelFr: 'Étagère chaussures',
      });
      panels.push(...shelves);
      hw.add('taquet', shelves.length * 4);

      if (module.doorCount > 0) {
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
      }
      hw.add('verin', 4);
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
