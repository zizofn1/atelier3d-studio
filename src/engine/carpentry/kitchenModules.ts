import type {
  CarpentryParams,
  ModuleInstance,
  ModuleOutput,
  PanelSpec,
} from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
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
  hingesPerDoorHeight,
  makePanel,
  normalizeGrain,
  resolveParams,
} from './panelBuilder';

export function generateKitchenModule(
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
    case 'caisson_bas':
    case 'caisson_casserolier':
    case 'caisson_sous_evier':
    case 'caisson_bas_tiroir_porte':
    case 'caisson_bas_2tiroirs_porte': {
      const isUnderSink = module.type === 'caisson_sous_evier';
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - 150));
      const H_carcass = Math.max(60, H - H_plinth);
      const hasFacades = module.doorCount > 0 || module.drawerCount > 0;
      const D_carcass = hasFacades ? Math.max(80, D - T) : D;

      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: -D / 2,
        topMode: 'stretchers',
        warnings,
      });
      // For caisson_sous_evier, shorten back panel to lower half to leave plumbing clearance
      if (isUnderSink) {
        panels.push(
          ...carcass.panels.map((p) =>
            p.role === 'fond'
              ? {
                  ...p,
                  nameFr: 'Fond réduit passage plomberie',
                  heightMm: Math.max(120, Math.round(p.heightMm * 0.48)),
                  positionMm: [
                    p.positionMm[0],
                    H_plinth + T + Math.max(60, Math.round(p.heightMm * 0.24)),
                    p.positionMm[2],
                  ] as [number, number, number],
                }
              : p
          )
        );
      } else {
        panels.push(...carcass.panels);
      }

      const zFacadeCenter = D / 2 - T / 2;
      const numDoors = module.doorCount;
      const numDrawers = module.drawerCount;

      let doorZoneBottom = H_plinth;
      let doorZoneHeight = H_carcass;

      if (numDrawers > 0 && numDoors > 0) {
        const drawerBandH = Math.min(H_carcass * 0.45, Math.max(140, numDrawers * 160));
        const drawerZoneBottom = H_plinth + H_carcass - drawerBandH;

        const drw = buildDrawers({
          counter,
          params,
          drawerCount: numDrawers,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          bayInnerWidthMm: carcass.innerW,
          zoneBottomYMm: drawerZoneBottom,
          zoneHeightMm: drawerBandH,
          zFacadeCenterMm: zFacadeCenter,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          moduleGrain: module.grainDirection,
          warnings,
        });
        panels.push(...drw.panels);
        hw.add('coulisse', drw.runnerCount);
        addHandleHardware(hw, params.handleStyle, numDrawers, W);

        doorZoneBottom = H_plinth;
        doorZoneHeight = H_carcass - drawerBandH;
      } else if (numDrawers > 0) {
        const drw = buildDrawers({
          counter,
          params,
          drawerCount: numDrawers,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          bayInnerWidthMm: carcass.innerW,
          zoneBottomYMm: H_plinth,
          zoneHeightMm: H_carcass,
          zFacadeCenterMm: zFacadeCenter,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          moduleGrain: module.grainDirection,
          warnings,
        });
        panels.push(...drw.panels);
        hw.add('coulisse', drw.runnerCount);
        addHandleHardware(hw, params.handleStyle, numDrawers, W);
        doorZoneHeight = 0;
      }

      if (numDoors > 0 && doorZoneHeight >= 60) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: numDoors,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: doorZoneBottom,
          zoneHeightMm: doorZoneHeight,
          zFacadeCenterMm: zFacadeCenter,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, numDoors, W);
      }

      const shelfYMax =
        numDrawers > 0 && numDoors > 0
          ? H_plinth + doorZoneHeight - T
          : numDrawers > 0
            ? carcass.yInnerBottom
            : carcass.yInnerTop;

      if (module.shelfCount > 0 && shelfYMax > carcass.yInnerBottom + 40) {
        const shelves = buildShelves({
          counter,
          params,
          shelfCount: module.shelfCount,
          bayCenterXMm: 0,
          bayInnerWidthMm: carcass.innerW,
          yMinMm: carcass.yInnerBottom,
          yMaxMm: shelfYMax,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
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

    case 'caisson_haut':
    case 'meuble_haut_vitre':
    case 'caisson_sur_frigo':
    case 'caisson_haut_relevant': {
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

      if (module.doorCount > 0) {
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
        addHandleHardware(hw, params.handleStyle, module.doorCount, W);
      }

      hw.add('suspension_murale', W > 1000 ? 3 : 2);
      break;
    }

    case 'colonne':
    case 'colonne_garde_manger': {
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - 300));
      const H_carcass = Math.max(200, H - H_plinth);
      const hasFacades = module.doorCount > 0 || module.drawerCount > 0;
      const D_carcass = hasFacades ? Math.max(100, D - T) : D;
      const variant =
        module.type === 'colonne_garde_manger'
          ? 'rangement'
          : (module.colonneVariant ?? (module.drawerCount > 0 ? 'four' : 'rangement'));

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

      const zFacadeCenter = D / 2 - T / 2;
      const horizGrain = normalizeGrain(params.carcassMaterialId, 'H');

      if (variant === 'four') {
        const lowerH = Math.min(Math.max(300, H_carcass * 0.34), 740);
        const ovenH = Math.min(595, Math.max(300, H_carcass - lowerH - 350));
        const yOvenBottom = H_plinth + lowerH;
        const yOvenTop = yOvenBottom + ovenH;

        // Fixed shelves framing oven niche
        const fixedShelfD = Math.max(40, carcass.innerZFront - carcass.innerZBack - 4);
        const fixedShelfZ = carcass.innerZBack + 2 + fixedShelfD / 2;
        panels.push(
          makePanel(counter, {
            nameFr: 'Tablette fixe sous four',
            role: 'etagere',
            materialId: params.carcassMaterialId,
            widthMm: carcass.innerW,
            heightMm: fixedShelfD,
            thicknessMm: T,
            positionMm: [0, yOvenBottom - T / 2, fixedShelfZ],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('etagere'),
          }),
          makePanel(counter, {
            nameFr: 'Tablette fixe sur four',
            role: 'etagere',
            materialId: params.carcassMaterialId,
            widthMm: carcass.innerW,
            heightMm: fixedShelfD,
            thicknessMm: T,
            positionMm: [0, yOvenTop + T / 2, fixedShelfZ],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('etagere'),
          })
        );

        let remainingDoors = module.doorCount;
        if (module.drawerCount > 0) {
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: module.drawerCount,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            bayInnerWidthMm: carcass.innerW,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: lowerH,
            zFacadeCenterMm: zFacadeCenter,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            moduleGrain: module.grainDirection,
            warnings,
          });
          panels.push(...drw.panels);
          hw.add('coulisse', drw.runnerCount);
          addHandleHardware(hw, params.handleStyle, module.drawerCount, W);
        } else if (remainingDoors > 0) {
          const lowerDoorsCount = remainingDoors >= 2 ? Math.min(2, Math.floor(remainingDoors / 2)) : 1;
          const lowerDoors = buildHingedDoors({
            counter,
            params,
            doorCount: lowerDoorsCount,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: lowerH,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...lowerDoors.panels);
          hw.add('charniere', lowerDoors.hinges);
          addHandleHardware(hw, params.handleStyle, lowerDoorsCount, W);
          remainingDoors -= lowerDoorsCount;
        }

        const upperZoneH = H_plinth + H_carcass - yOvenTop;
        if (remainingDoors > 0 && upperZoneH >= 80) {
          const upperDoors = buildHingedDoors({
            counter,
            params,
            doorCount: remainingDoors,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            zoneBottomYMm: yOvenTop,
            zoneHeightMm: upperZoneH,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...upperDoors.panels);
          hw.add('charniere', upperDoors.hinges);
          addHandleHardware(hw, params.handleStyle, remainingDoors, W);
        }

        if (module.shelfCount > 0 && carcass.yInnerTop - (yOvenTop + T) > 60) {
          const shelves = buildShelves({
            counter,
            params,
            shelfCount: module.shelfCount,
            bayCenterXMm: 0,
            bayInnerWidthMm: carcass.innerW,
            yMinMm: yOvenTop + T,
            yMaxMm: carcass.yInnerTop,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            hasFacades,
          });
          panels.push(...shelves);
          hw.add('taquet', shelves.length * 4);
        }
      } else if (variant === 'refrigerateur') {
        const fridgeH = Math.min(1550, Math.round(H_carcass * 0.72));
        const ySep = H_plinth + fridgeH;
        const fixedShelfD = Math.max(40, carcass.innerZFront - carcass.innerZBack - 4);
        panels.push(
          makePanel(counter, {
            nameFr: 'Séparation réfrigérateur',
            role: 'etagere',
            materialId: params.carcassMaterialId,
            widthMm: carcass.innerW,
            heightMm: fixedShelfD,
            thicknessMm: T,
            positionMm: [0, ySep, carcass.innerZBack + 2 + fixedShelfD / 2],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('etagere'),
          })
        );

        const totalDoors = module.doorCount;
        if (totalDoors >= 1) {
          const lowerDoors = buildHingedDoors({
            counter,
            params,
            doorCount: totalDoors > 2 ? 2 : 1,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: fridgeH,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...lowerDoors.panels);
          hw.add('charniere', lowerDoors.hinges);
          addHandleHardware(hw, params.handleStyle, lowerDoors.panels.length, W);
        }
        const upperDoorsCount = totalDoors >= 2 ? Math.max(1, totalDoors - (totalDoors > 2 ? 2 : 1)) : 0;
        const upperH = H_plinth + H_carcass - ySep;
        if (upperDoorsCount > 0 && upperH >= 80) {
          const upperDoors = buildHingedDoors({
            counter,
            params,
            doorCount: upperDoorsCount,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            zoneBottomYMm: ySep,
            zoneHeightMm: upperH,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...upperDoors.panels);
          hw.add('charniere', upperDoors.hinges);
          addHandleHardware(hw, params.handleStyle, upperDoorsCount, W);
        }

        if (module.shelfCount > 0) {
          const shelves = buildShelves({
            counter,
            params,
            shelfCount: module.shelfCount,
            bayCenterXMm: 0,
            bayInnerWidthMm: carcass.innerW,
            yMinMm: ySep + T / 2,
            yMaxMm: carcass.yInnerTop,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            hasFacades,
          });
          panels.push(...shelves);
          hw.add('taquet', shelves.length * 4);
        }
      } else {
        // 'rangement'
        const hasDrw = module.drawerCount > 0;
        const drawerBandH = hasDrw
          ? Math.min(H_carcass * 0.4, Math.max(240, module.drawerCount * 170))
          : 0;
        if (hasDrw) {
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: module.drawerCount,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            bayInnerWidthMm: carcass.innerW,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: drawerBandH,
            zFacadeCenterMm: zFacadeCenter,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            moduleGrain: module.grainDirection,
            warnings,
          });
          panels.push(...drw.panels);
          hw.add('coulisse', drw.runnerCount);
          addHandleHardware(hw, params.handleStyle, module.drawerCount, W);
        }

        const upperBottom = H_plinth + drawerBandH;
        const upperH = H_carcass - drawerBandH;
        if (module.doorCount > 0 && upperH >= 80) {
          const doors = buildHingedDoors({
            counter,
            params,
            doorCount: module.doorCount,
            zoneCenterXMm: 0,
            zoneWidthMm: W,
            zoneBottomYMm: upperBottom,
            zoneHeightMm: upperH,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
          });
          panels.push(...doors.panels);
          hw.add('charniere', doors.hinges);
          addHandleHardware(hw, params.handleStyle, module.doorCount, W);
        }

        const shelves = buildShelves({
          counter,
          params,
          shelfCount: module.shelfCount,
          bayCenterXMm: 0,
          bayInnerWidthMm: carcass.innerW,
          yMinMm: hasDrw ? upperBottom + T / 2 : carcass.yInnerBottom,
          yMaxMm: carcass.yInnerTop,
          innerZBackMm: carcass.innerZBack,
          innerZFrontMm: carcass.innerZFront,
          hasFacades,
        });
        panels.push(...shelves);
        hw.add('taquet', shelves.length * 4);
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

    case 'caisson_angle':
    case 'caisson_angle_l':
    case 'caisson_angle_aveugle':
    case 'caisson_haut_angle_aveugle': {
      const isUpperBlind = module.type === 'caisson_haut_angle_aveugle';
      const H_plinth =
        isUpperBlind || module.hasPlinth === false
          ? 0
          : Math.min(params.plinthHeightMm, Math.max(0, H - 150));
      const H_carcass = Math.max(80, H - H_plinth);
      const kind =
        module.type === 'caisson_angle_aveugle' || isUpperBlind
          ? 'aveugle'
          : module.type === 'caisson_angle_l'
            ? 'en_l'
            : (module.cornerKind ?? 'en_l');

      if (kind === 'aveugle') {
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
          topMode: isUpperBlind ? 'full' : 'stretchers',
          isWallHung: isUpperBlind,
          warnings,
        });
        panels.push(...carcass.panels);

        const blindW = Math.min(Math.round(W * 0.45), isUpperBlind ? 400 : 450);
        const blindOnRight = module.blindSide === 'right';
        const zFacadeCenter = D / 2 - T / 2;
        const doorGrain = facadeGrain(params.facadeMaterialId, 'V', module.grainDirection);
        const blindX = blindOnRight ? W / 2 - blindW / 2 : -W / 2 + blindW / 2;
        panels.push(
          makePanel(counter, {
            nameFr: 'Panneau fixe angle aveugle',
            role: 'porte',
            materialId: params.facadeMaterialId,
            widthMm: Math.max(40, blindW - params.facadeGapMm),
            heightMm: Math.max(40, H_carcass - params.facadeGapMm),
            thicknessMm: T,
            positionMm: [blindX, H_plinth + H_carcass / 2, zFacadeCenter],
            rotationRad: [0, 0, 0],
            grain: doorGrain,
            edges: edgePreset('porte'),
          })
        );

        const doorZoneW = Math.max(60, W - blindW);
        const doorZoneCenterX = blindOnRight
          ? -W / 2 + doorZoneW / 2
          : -W / 2 + blindW + doorZoneW / 2;
        if (module.doorCount > 0) {
          const doors = buildHingedDoors({
            counter,
            params,
            doorCount: Math.min(2, module.doorCount),
            zoneCenterXMm: doorZoneCenterX,
            zoneWidthMm: doorZoneW,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: H_carcass,
            zFacadeCenterMm: zFacadeCenter,
            moduleGrain: module.grainDirection,
            hingeSide: module.hingeSide ?? (blindOnRight ? 'left' : 'right'),
          });
          panels.push(...doors.panels);
          hw.add('charniere', doors.hinges);
          addHandleHardware(hw, params.handleStyle, doors.panels.length, doorZoneW);
        }

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

        if (isUpperBlind) {
          hw.add('suspension_murale', W > 950 ? 3 : 2);
        } else if (H_plinth > 0) {
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
      } else {
        // 'en_l' L-shaped corner unit: North (-Z) & East (+X) backs, recess on (-X, +Z)
        const W_wing = Math.min(600, Math.max(300, Math.round(Math.min(W, D) * 0.67)));
        const T_back = params.backThickness;
        const gap = params.facadeGapMm;
        const sideGrain = normalizeGrain(params.carcassMaterialId, 'V');
        const horizGrain = normalizeGrain(params.carcassMaterialId, 'H');
        const backGrain = normalizeGrain(params.backMaterialId, 'V');
        const doorGrain = facadeGrain(params.facadeMaterialId, 'V', module.grainDirection);

        const recessX = -W / 2 + (W - W_wing); // e.g. -150 for 900x900
        const recessZ = -D / 2 + W_wing;       // e.g. +150 for 900x900
        const hasFacades = module.doorCount > 0;
        const facadeShift = hasFacades ? T : 0;

        // North wing back (-Z) & East wing back (+X)
        const northBackZ = -D / 2 + (params.backMountType === 'rainure' ? 12 + T_back / 2 : T_back / 2);
        const eastBackX = W / 2 - (params.backMountType === 'rainure' ? 12 + T_back / 2 : T_back / 2);
        const innerZBack = northBackZ + T_back / 2;
        const innerXBack = eastBackX - T_back / 2;

        // Left return side (x = -W/2 + T/2, z from -D/2 to recessZ - facadeShift)
        const leftSideD = Math.max(60, recessZ - facadeShift - (-D / 2));
        panels.push(
          makePanel(counter, {
            nameFr: 'Joue gauche angle',
            role: 'joue_gauche',
            materialId: params.carcassMaterialId,
            widthMm: leftSideD,
            heightMm: H_carcass,
            thicknessMm: T,
            positionMm: [-W / 2 + T / 2, H_plinth + H_carcass / 2, -D / 2 + leftSideD / 2],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: sideGrain,
            edges: edgePreset('joue_gauche'),
          })
        );

        // Front-right return side (z = +D/2 - T/2, x from recessX + facadeShift to +W/2)
        const rightReturnW = Math.max(60, W / 2 - (recessX + facadeShift));
        panels.push(
          makePanel(counter, {
            nameFr: 'Joue retour droite angle',
            role: 'joue_droite',
            materialId: params.carcassMaterialId,
            widthMm: rightReturnW,
            heightMm: H_carcass,
            thicknessMm: T,
            positionMm: [recessX + facadeShift + rightReturnW / 2, H_plinth + H_carcass / 2, D / 2 - T / 2],
            rotationRad: [0, 0, 0],
            grain: sideGrain,
            edges: edgePreset('joue_droite'),
          })
        );

        // Backs
        panels.push(
          makePanel(counter, {
            nameFr: 'Fond Nord angle',
            role: 'fond',
            materialId: params.backMaterialId,
            widthMm: Math.max(40, W - 2 * T),
            heightMm: Math.max(40, H_carcass - 2),
            thicknessMm: T_back,
            positionMm: [0, H_plinth + H_carcass / 2, northBackZ],
            rotationRad: [0, 0, 0],
            grain: backGrain,
            edges: edgePreset('fond'),
          }),
          makePanel(counter, {
            nameFr: 'Fond Est angle',
            role: 'fond',
            materialId: params.backMaterialId,
            widthMm: Math.max(40, D - 2 * T),
            heightMm: Math.max(40, H_carcass - 2),
            thicknessMm: T_back,
            positionMm: [eastBackX, H_plinth + H_carcass / 2, 0],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: backGrain,
            edges: edgePreset('fond'),
          })
        );

        // Bottom in 2 non-overlapping pieces
        const armAW = Math.max(40, innerXBack - (-W / 2 + T));
        const armAD = Math.max(40, recessZ - facadeShift - innerZBack);
        const armBW = Math.max(40, innerXBack - (recessX + facadeShift));
        const armBD = Math.max(40, D / 2 - T - (recessZ - facadeShift));

        panels.push(
          makePanel(counter, {
            nameFr: 'Dessous angle (branche Nord)',
            role: 'dessous',
            materialId: params.carcassMaterialId,
            widthMm: armAW,
            heightMm: armAD,
            thicknessMm: T,
            positionMm: [-W / 2 + T + armAW / 2, H_plinth + T / 2, innerZBack + armAD / 2],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('dessous'),
          }),
          makePanel(counter, {
            nameFr: 'Dessous angle (branche Est)',
            role: 'dessous',
            materialId: params.carcassMaterialId,
            widthMm: armBW,
            heightMm: armBD,
            thicknessMm: T,
            positionMm: [recessX + facadeShift + armBW / 2, H_plinth + T / 2, recessZ - facadeShift + armBD / 2],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('dessous'),
          })
        );

        // Top stretchers
        const stD = Math.min(90, Math.max(30, armAD / 3));
        panels.push(
          makePanel(counter, {
            nameFr: 'Traverse angle Nord',
            role: 'traverse',
            materialId: params.carcassMaterialId,
            widthMm: armAW,
            heightMm: stD,
            thicknessMm: T,
            positionMm: [-W / 2 + T + armAW / 2, H_plinth + H_carcass - T / 2, recessZ - facadeShift - stD / 2],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('traverse'),
          }),
          makePanel(counter, {
            nameFr: 'Traverse angle Est',
            role: 'traverse',
            materialId: params.carcassMaterialId,
            widthMm: Math.min(90, Math.max(30, armBW / 3)),
            heightMm: armBD,
            thicknessMm: T,
            positionMm: [recessX + facadeShift + Math.min(90, Math.max(30, armBW / 3)) / 2, H_plinth + H_carcass - T / 2, recessZ - facadeShift + armBD / 2],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: horizGrain,
            edges: edgePreset('traverse'),
          })
        );

        // Shelves
        if (module.shelfCount > 0) {
          const yMin = H_plinth + T;
          const yMax = H_plinth + H_carcass - T;
          for (let k = 0; k < module.shelfCount; k++) {
            const y = yMin + ((k + 1) / (module.shelfCount + 1)) * (yMax - yMin);
            panels.push(
              makePanel(counter, {
                nameFr: 'Étagère angle (branche Nord)',
                role: 'etagere',
                materialId: params.carcassMaterialId,
                widthMm: Math.max(20, armAW - 4),
                heightMm: Math.max(20, armAD - 4),
                thicknessMm: T,
                positionMm: [-W / 2 + T + armAW / 2, y, innerZBack + armAD / 2],
                rotationRad: [Math.PI / 2, 0, 0],
                grain: horizGrain,
                edges: edgePreset('etagere'),
              }),
              makePanel(counter, {
                nameFr: 'Étagère angle (branche Est)',
                role: 'etagere',
                materialId: params.carcassMaterialId,
                widthMm: Math.max(20, armBW - 4),
                heightMm: Math.max(20, armBD - 4),
                thicknessMm: T,
                positionMm: [recessX + facadeShift + armBW / 2, y, recessZ - facadeShift + armBD / 2],
                rotationRad: [Math.PI / 2, 0, 0],
                grain: horizGrain,
                edges: edgePreset('etagere'),
              })
            );
          }
          hw.add('taquet', module.shelfCount * 6);
        }

        // Bi-fold doors in recess (-X, +Z)
        if (hasFacades) {
          const door1W = Math.max(40, recessX - (-W / 2) - gap);
          const door2W = Math.max(40, D / 2 - recessZ - gap);
          const doorH = Math.max(40, H_carcass - gap);
          const doorY = H_plinth + H_carcass / 2;
          const door1X = -W / 2 + gap / 2 + door1W / 2;
          const door1Z = recessZ - T / 2;
          const door2X = recessX + T / 2;
          const door2Z = recessZ + gap / 2 + door2W / 2;

          panels.push(
            makePanel(counter, {
              nameFr: 'Porte angle 1',
              role: 'porte',
              materialId: params.facadeMaterialId,
              widthMm: door1W,
              heightMm: doorH,
              thicknessMm: T,
              positionMm: [door1X, doorY, door1Z],
              rotationRad: [0, 0, 0],
              grain: doorGrain,
              edges: edgePreset('porte'),
              animationGroup: 'door_left',
              animationMeta: {
                kind: 'hinged_left',
                index: 0,
                pivotMm: [roundMm(-W / 2 + gap / 2, 2), roundMm(doorY, 2), roundMm(recessZ, 2)],
              },
            }),
            makePanel(counter, {
              nameFr: 'Porte angle 2',
              role: 'porte',
              materialId: params.facadeMaterialId,
              widthMm: door2W,
              heightMm: doorH,
              thicknessMm: T,
              positionMm: [door2X, doorY, door2Z],
              rotationRad: [0, -Math.PI / 2, 0],
              grain: doorGrain,
              edges: edgePreset('porte'),
              animationGroup: 'door_right',
              animationMeta: {
                kind: 'hinged_right',
                index: 1,
                pivotMm: [roundMm(recessX, 2), roundMm(doorY, 2), roundMm(D / 2 - gap / 2, 2)],
              },
            })
          );
          hw.add('charniere', hingesPerDoorHeight(doorH) * 2);
          addHandleHardware(hw, params.handleStyle, Math.min(2, module.doorCount), door1W + door2W);
        }

        if (H_plinth > 0) {
          const pH = Math.max(10, H_plinth - 2);
          const p1W = Math.max(40, recessX - (-W / 2) + params.plinthRecessMm);
          const p2W = Math.max(40, D / 2 - recessZ + params.plinthRecessMm);
          panels.push(
            makePanel(counter, {
              nameFr: 'Plinthe angle Nord',
              role: 'plinthe',
              materialId: params.facadeMaterialId,
              widthMm: p1W,
              heightMm: pH,
              thicknessMm: T,
              positionMm: [-W / 2 + p1W / 2, pH / 2, recessZ - params.plinthRecessMm - T / 2],
              rotationRad: [0, 0, 0],
              grain: facadeGrain(params.facadeMaterialId, 'H', module.grainDirection),
              edges: edgePreset('plinthe'),
            }),
            makePanel(counter, {
              nameFr: 'Plinthe angle Est',
              role: 'plinthe',
              materialId: params.facadeMaterialId,
              widthMm: p2W,
              heightMm: pH,
              thicknessMm: T,
              positionMm: [recessX + params.plinthRecessMm + T / 2, pH / 2, D / 2 - p2W / 2],
              rotationRad: [0, -Math.PI / 2, 0],
              grain: facadeGrain(params.facadeMaterialId, 'H', module.grainDirection),
              edges: edgePreset('plinthe'),
            })
          );
          hw.add('pied_reglable', 5);
        }
      }
      break;
    }

    case 'caisson_angle_pan_coupe':
    case 'caisson_haut_angle': {
      const isUpper = module.type === 'caisson_haut_angle';
      const H_plinth =
        isUpper || module.hasPlinth === false
          ? 0
          : Math.min(params.plinthHeightMm, Math.max(0, H - 150));
      const H_carcass = Math.max(80, H - H_plinth);
      const T_back = params.backThickness;
      const sideGrain = normalizeGrain(params.carcassMaterialId, 'V');
      const horizGrain = normalizeGrain(params.carcassMaterialId, 'H');
      const backGrain = normalizeGrain(params.backMaterialId, 'V');
      const doorGrain = facadeGrain(params.facadeMaterialId, 'V', module.grainDirection);
      const gap = params.facadeGapMm;

      // Unified backs on (-Z Nord) and (+X Est) to match caisson_angle_l; chamfered 45° front on (-X, +Z)
      const returnSideMm = Math.min(Math.round(Math.min(W, D) * 0.45), isUpper ? 320 : 350);
      const backZ = -D / 2 + T_back / 2;
      const eastBackX = W / 2 - T_back / 2;

      // North (-Z) & East (+X) backs
      panels.push(
        makePanel(counter, {
          nameFr: 'Fond Nord pan coupé',
          role: 'fond',
          materialId: params.backMaterialId,
          widthMm: Math.max(40, W - 2 * T),
          heightMm: Math.max(40, H_carcass - 2),
          thicknessMm: T_back,
          positionMm: [0, H_plinth + H_carcass / 2, backZ],
          rotationRad: [0, 0, 0],
          grain: backGrain,
          edges: edgePreset('fond'),
        }),
        makePanel(counter, {
          nameFr: 'Fond Est pan coupé',
          role: 'fond',
          materialId: params.backMaterialId,
          widthMm: Math.max(40, D - 2 * T),
          heightMm: Math.max(40, H_carcass - 2),
          thicknessMm: T_back,
          positionMm: [eastBackX, H_plinth + H_carcass / 2, 0],
          rotationRad: [0, -Math.PI / 2, 0],
          grain: backGrain,
          edges: edgePreset('fond'),
        })
      );

      // Left (-X) & Front-right (+Z) return sides abutting the adjacent cabinets
      panels.push(
        makePanel(counter, {
          nameFr: 'Joue retour gauche (pan coupé)',
          role: 'joue_gauche',
          materialId: params.carcassMaterialId,
          widthMm: returnSideMm,
          heightMm: H_carcass,
          thicknessMm: T,
          positionMm: [-W / 2 + T / 2, H_plinth + H_carcass / 2, -D / 2 + returnSideMm / 2],
          rotationRad: [0, -Math.PI / 2, 0],
          grain: sideGrain,
          edges: edgePreset('joue_gauche', { isWallHung: isUpper }),
        }),
        makePanel(counter, {
          nameFr: 'Joue retour droite (pan coupé)',
          role: 'joue_droite',
          materialId: params.carcassMaterialId,
          widthMm: returnSideMm,
          heightMm: H_carcass,
          thicknessMm: T,
          positionMm: [W / 2 - returnSideMm / 2, H_plinth + H_carcass / 2, D / 2 - T / 2],
          rotationRad: [0, 0, 0],
          grain: sideGrain,
          edges: edgePreset('joue_droite', { isWallHung: isUpper }),
        })
      );

      // True pentagonal chamfered top & bottom plates clipping (-X, +Z) front corner
      const innerW = Math.max(60, W - T * 2);
      const innerD = Math.max(60, D - T * 2);
      const plateChamferMm = Math.max(0, Math.min(innerW, innerD) - Math.max(40, returnSideMm - T));
      panels.push(
        makePanel(counter, {
          nameFr: 'Dessous angle pan coupé',
          role: 'dessous',
          materialId: params.carcassMaterialId,
          widthMm: innerW,
          heightMm: innerD,
          thicknessMm: T,
          positionMm: [0, H_plinth + T / 2, 0],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: horizGrain,
          edges: edgePreset('dessous', { isWallHung: isUpper }),
          chamferFrontCornerMm: plateChamferMm,
        }),
        makePanel(counter, {
          nameFr: 'Dessus angle pan coupé',
          role: 'dessus',
          materialId: params.carcassMaterialId,
          widthMm: innerW,
          heightMm: innerD,
          thicknessMm: T,
          positionMm: [0, H_plinth + H_carcass - T / 2, 0],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: horizGrain,
          edges: edgePreset('dessus', { isWallHung: isUpper }),
          chamferFrontCornerMm: plateChamferMm,
        })
      );

      // Pentagonal shelves inside the chamfered carcass
      if (module.shelfCount > 0) {
        const yMin = H_plinth + T;
        const yMax = H_plinth + H_carcass - T;
        const step = (yMax - yMin) / (module.shelfCount + 1);
        const shelfW = Math.max(40, innerW - 6);
        const shelfD = Math.max(40, innerD - 6);
        const shelfChamferMm = Math.max(0, plateChamferMm - 6);
        for (let s = 1; s <= module.shelfCount; s++) {
          panels.push(
            makePanel(counter, {
              nameFr: `Étagère angle pan coupé ${s}`,
              role: 'etagere',
              materialId: params.carcassMaterialId,
              widthMm: shelfW,
              heightMm: shelfD,
              thicknessMm: T,
              positionMm: [0, roundMm(yMin + step * s, 2), 0],
              rotationRad: [Math.PI / 2, 0, 0],
              grain: horizGrain,
              edges: edgePreset('etagere'),
              chamferFrontCornerMm: shelfChamferMm,
            })
          );
        }
        hw.add('taquet', module.shelfCount * 5);
      }

      // Diagonal 45° front door across (-X, +Z): A=(-W/2, -D/2+returnSideMm) -> B=(W/2-returnSideMm, D/2)
      const ax = -W / 2;
      const az = -D / 2 + returnSideMm;
      const bx = W / 2 - returnSideMm;
      const bz = D / 2;
      const rawDiag = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / (rawDiag || 1); // outward normal (-0.707, +0.707)
      const nz = (bx - ax) / (rawDiag || 1);
      const doorAngleY = Math.atan2(nx, nz); // local +Z aligns with outward normal (nx, nz), i.e. -PI/4

      if (module.doorCount > 0) {
        const diagLen = Math.max(80, rawDiag - gap - T * 0.45);
        const doorH = Math.max(60, H_carcass - gap);
        const midX = (ax + bx) / 2 - nx * (T * 0.45);
        const midZ = (az + bz) / 2 - nz * (T * 0.45);
        const doorY = H_plinth + H_carcass / 2;

        panels.push(
          makePanel(counter, {
            nameFr: 'Porte diagonale 45°',
            role: 'porte',
            materialId: params.facadeMaterialId,
            widthMm: roundMm(diagLen, 1),
            heightMm: doorH,
            thicknessMm: T,
            positionMm: [roundMm(midX, 2), doorY, roundMm(midZ, 2)],
            rotationRad: [0, doorAngleY, 0],
            grain: doorGrain,
            edges: edgePreset('porte'),
            animationGroup: 'door_left',
            animationMeta: {
              kind: 'hinged_left',
              index: 0,
              pivotMm: [roundMm(ax, 2), roundMm(doorY, 2), roundMm(az, 2)],
            },
          })
        );
        hw.add('charniere', hingesPerDoorHeight(doorH));
        addHandleHardware(hw, params.handleStyle, 1, diagLen);
      }

      if (isUpper) {
        hw.add('suspension_murale', 2);
      } else if (H_plinth > 0) {
        const plinthH = Math.max(10, H_plinth - 2);
        const plinthW = Math.max(80, rawDiag - params.plinthRecessMm * 1.15);
        const recOffset = params.plinthRecessMm + T / 2;
        panels.push(
          makePanel(counter, {
            nameFr: 'Plinthe diagonale 45°',
            role: 'plinthe',
            materialId: params.facadeMaterialId,
            widthMm: roundMm(plinthW, 1),
            heightMm: plinthH,
            thicknessMm: T,
            positionMm: [
              roundMm((ax + bx) / 2 - nx * recOffset, 2),
              plinthH / 2,
              roundMm((az + bz) / 2 - nz * recOffset, 2),
            ],
            rotationRad: [0, doorAngleY, 0],
            grain: facadeGrain(params.facadeMaterialId, 'H', module.grainDirection),
            edges: edgePreset('plinthe'),
          })
        );
        hw.add('pied_reglable', 4);
      }
      break;
    }

    case 'colonne_mixte_tiroirs_portes': {
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - 300));
      const H_carcass = Math.max(200, H - H_plinth);
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

      const zFacadeCenter = D / 2 - T / 2;
      const numDrawers = Math.max(1, module.drawerCount);
      const drawerBandH = Math.min(H_carcass * 0.45, Math.max(360, numDrawers * 210));
      const drw = buildDrawers({
        counter,
        params,
        drawerCount: numDrawers,
        zoneCenterXMm: 0,
        zoneWidthMm: W,
        bayInnerWidthMm: carcass.innerW,
        zoneBottomYMm: H_plinth,
        zoneHeightMm: drawerBandH,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        zFacadeCenterMm: zFacadeCenter,
        moduleGrain: module.grainDirection,
      });
      panels.push(...drw.panels);
      hw.add('coulisse', drw.runnerCount);
      addHandleHardware(hw, params.handleStyle, numDrawers, W);

      const upperBottom = H_plinth + drawerBandH;
      const upperH = Math.max(120, H - upperBottom);
      const numDoors = Math.max(1, module.doorCount);
      const doors = buildHingedDoors({
        counter,
        params,
        doorCount: numDoors,
        zoneCenterXMm: 0,
        zoneWidthMm: W,
        zoneBottomYMm: upperBottom,
        zoneHeightMm: upperH,
        zFacadeCenterMm: zFacadeCenter,
        moduleGrain: module.grainDirection,
      });
      panels.push(...doors.panels);
      hw.add('charniere', doors.hinges);
      addHandleHardware(hw, params.handleStyle, doors.panels.length, W / numDoors);

      const shelves = buildShelves({
        counter,
        params,
        shelfCount: module.shelfCount,
        bayCenterXMm: 0,
        bayInnerWidthMm: carcass.innerW,
        yMinMm: upperBottom + T,
        yMaxMm: carcass.yInnerTop,
        innerZBackMm: carcass.innerZBack,
        innerZFrontMm: carcass.innerZFront,
        hasFacades,
      });
      panels.push(...shelves);
      hw.add('taquet', shelves.length * 4);

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

    case 'meuble_vitrine': {
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - 250));
      const H_carcass = Math.max(200, H - H_plinth);
      const D_carcass = module.doorCount > 0 ? Math.max(120, D - T) : D;

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
        panels.push(...doors.panels.map((p) => ({ ...p, surfaceSlot: 'glass' as const })));
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, doors.panels.length, W / module.doorCount);
      }

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
        hasFacades: module.doorCount > 0,
      });
      panels.push(...shelves);
      hw.add('taquet', shelves.length * 4);

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

    case 'ilot_central': {
      const hasCountertop = module.hasCountertop !== false;
      const topMatDef = getMaterialById(params.countertopMaterialId);
      const H_countertop = hasCountertop
        ? Math.min(topMatDef.defaultThicknessMm ?? 38, Math.max(20, Math.round(H * 0.1)))
        : 0;
      const H_plinth =
        module.hasPlinth === false ? 0 : Math.min(params.plinthHeightMm, Math.max(0, H - H_countertop - 150));
      const H_carcass = Math.max(100, H - H_countertop - H_plinth);

      const requestedOverhang = module.overhangMm ?? 280;
      const effectiveOverhang = Math.max(0, Math.min(requestedOverhang, Math.max(0, D - 350)));
      if (requestedOverhang > effectiveOverhang) {
        warnings.push(
          `Débord plan de travail îlot ramené à ${roundMm(effectiveOverhang, 0)} mm pour préserver le caisson.`
        );
      }

      const D_body = D - effectiveOverhang;
      const hasFacades = module.doorCount > 0 || module.drawerCount > 0;
      const D_carcass = hasFacades ? Math.max(150, D_body - T) : D_body;
      const zBodyBack = D / 2 - D_body;

      if (hasCountertop) {
        panels.push(
          makePanel(counter, {
            nameFr: 'Plan de travail îlot',
            role: 'plan_travail',
            materialId: params.countertopMaterialId,
            widthMm: W,
            heightMm: D,
            thicknessMm: H_countertop,
            positionMm: [0, H - H_countertop / 2, 0],
            rotationRad: [Math.PI / 2, 0, 0],
            grain: normalizeGrain(params.countertopMaterialId, 'H'),
            edges: edgePreset('plan_travail', { exposedAll: true }),
          })
        );
      }

      const carcass = buildCarcassPanels({
        counter,
        params,
        widthMm: W,
        heightMm: H_carcass,
        depthMm: D_carcass,
        yBaseMm: H_plinth,
        zBackMm: zBodyBack,
        topMode: 'stretchers',
        exposedSides: true,
        exposedBack: true,
        warnings,
      });
      panels.push(...carcass.panels);

      const numBays = W > 1000 ? 2 : 1;
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
      const numDoors = module.doorCount;
      const numDrawers = module.drawerCount;

      let doorBottom = H_plinth;
      let doorH = H_carcass;

      if (numDrawers > 0 && numDoors > 0) {
        const rows = numBays === 2 ? Math.ceil(numDrawers / 2) : numDrawers;
        const drawerBandH = Math.min(H_carcass * 0.42, Math.max(140, rows * 160));
        const drawerBottom = H_plinth + H_carcass - drawerBandH;

        let drawerIdx = 0;
        for (let b = 0; b < numBays; b++) {
          const bayCount =
            numBays === 2
              ? b === 0
                ? Math.ceil(numDrawers / 2)
                : Math.floor(numDrawers / 2)
              : numDrawers;
          if (bayCount <= 0) continue;
          const bay = div.bays[b];
          const zoneW = numBays === 2 ? W / 2 : W;
          const zoneCX = numBays === 2 ? (b === 0 ? -W / 4 : W / 4) : 0;
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: bayCount,
            zoneCenterXMm: zoneCX,
            zoneWidthMm: zoneW,
            bayInnerWidthMm: bay.innerW,
            zoneBottomYMm: drawerBottom,
            zoneHeightMm: drawerBandH,
            zFacadeCenterMm: zFacadeCenter,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            startDrawerIndex: drawerIdx,
            moduleGrain: module.grainDirection,
            warnings,
          });
          panels.push(...drw.panels);
          hw.add('coulisse', drw.runnerCount);
          drawerIdx += bayCount;
        }
        addHandleHardware(hw, params.handleStyle, numDrawers, W);
        doorBottom = H_plinth;
        doorH = H_carcass - drawerBandH;
      } else if (numDrawers > 0) {
        let drawerIdx = 0;
        for (let b = 0; b < numBays; b++) {
          const bayCount =
            numBays === 2
              ? b === 0
                ? Math.ceil(numDrawers / 2)
                : Math.floor(numDrawers / 2)
              : numDrawers;
          if (bayCount <= 0) continue;
          const bay = div.bays[b];
          const zoneW = numBays === 2 ? W / 2 : W;
          const zoneCX = numBays === 2 ? (b === 0 ? -W / 4 : W / 4) : 0;
          const drw = buildDrawers({
            counter,
            params,
            drawerCount: bayCount,
            zoneCenterXMm: zoneCX,
            zoneWidthMm: zoneW,
            bayInnerWidthMm: bay.innerW,
            zoneBottomYMm: H_plinth,
            zoneHeightMm: H_carcass,
            zFacadeCenterMm: zFacadeCenter,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            startDrawerIndex: drawerIdx,
            moduleGrain: module.grainDirection,
            warnings,
          });
          panels.push(...drw.panels);
          hw.add('coulisse', drw.runnerCount);
          drawerIdx += bayCount;
        }
        addHandleHardware(hw, params.handleStyle, numDrawers, W);
        doorH = 0;
      }

      if (numDoors > 0 && doorH >= 80) {
        const doors = buildHingedDoors({
          counter,
          params,
          doorCount: numDoors,
          zoneCenterXMm: 0,
          zoneWidthMm: W,
          zoneBottomYMm: doorBottom,
          zoneHeightMm: doorH,
          zFacadeCenterMm: zFacadeCenter,
          moduleGrain: module.grainDirection,
        });
        panels.push(...doors.panels);
        hw.add('charniere', doors.hinges);
        addHandleHardware(hw, params.handleStyle, numDoors, W);
      }

      const shelfYMax =
        numDrawers > 0 && numDoors > 0
          ? H_plinth + doorH - T
          : numDrawers > 0
            ? carcass.yInnerBottom
            : carcass.yInnerTop;

      if (module.shelfCount > 0 && shelfYMax > carcass.yInnerBottom + 40) {
        for (const bay of div.bays) {
          const shelves = buildShelves({
            counter,
            params,
            shelfCount: module.shelfCount,
            bayCenterXMm: bay.centerX,
            bayInnerWidthMm: bay.innerW,
            yMinMm: carcass.yInnerBottom,
            yMaxMm: shelfYMax,
            innerZBackMm: carcass.innerZBack,
            innerZFrontMm: carcass.innerZFront,
            hasFacades,
          });
          panels.push(...shelves);
          hw.add('taquet', shelves.length * 4);
        }
      }

      if (H_plinth > 0) {
        const pH = Math.max(10, H_plinth - 2);
        const rec = Math.min(params.plinthRecessMm, Math.max(10, D_carcass / 4));
        const pW = Math.max(60, W - 2 * rec);
        const pD = Math.max(60, D_carcass - 2 * rec);
        const pZCenter = zBodyBack + D_carcass / 2;
        const pGrain = facadeGrain(params.facadeMaterialId, 'H', module.grainDirection);
        panels.push(
          makePanel(counter, {
            nameFr: 'Plinthe îlot avant',
            role: 'plinthe',
            materialId: params.facadeMaterialId,
            widthMm: pW,
            heightMm: pH,
            thicknessMm: T,
            positionMm: [0, pH / 2, pZCenter + pD / 2 - T / 2],
            rotationRad: [0, 0, 0],
            grain: pGrain,
            edges: edgePreset('plinthe', { exposedAll: true }),
          }),
          makePanel(counter, {
            nameFr: 'Plinthe îlot arrière',
            role: 'plinthe',
            materialId: params.facadeMaterialId,
            widthMm: pW,
            heightMm: pH,
            thicknessMm: T,
            positionMm: [0, pH / 2, pZCenter - pD / 2 + T / 2],
            rotationRad: [0, 0, 0],
            grain: pGrain,
            edges: edgePreset('plinthe', { exposedAll: true }),
          }),
          makePanel(counter, {
            nameFr: 'Plinthe îlot gauche',
            role: 'plinthe',
            materialId: params.facadeMaterialId,
            widthMm: Math.max(20, pD - 2 * T),
            heightMm: pH,
            thicknessMm: T,
            positionMm: [-pW / 2 + T / 2, pH / 2, pZCenter],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: pGrain,
            edges: edgePreset('plinthe', { exposedAll: true }),
          }),
          makePanel(counter, {
            nameFr: 'Plinthe îlot droite',
            role: 'plinthe',
            materialId: params.facadeMaterialId,
            widthMm: Math.max(20, pD - 2 * T),
            heightMm: pH,
            thicknessMm: T,
            positionMm: [pW / 2 - T / 2, pH / 2, pZCenter],
            rotationRad: [0, -Math.PI / 2, 0],
            grain: pGrain,
            edges: edgePreset('plinthe', { exposedAll: true }),
          })
        );
        hw.add('pied_reglable', 6);
      }
      break;
    }

    case 'plan_de_travail': {
      panels.push(
        makePanel(counter, {
          nameFr: 'Plan de travail',
          role: 'plan_travail',
          materialId: params.countertopMaterialId,
          widthMm: W,
          heightMm: D,
          thicknessMm: H,
          positionMm: [0, H / 2, 0],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: normalizeGrain(params.countertopMaterialId, 'H'),
          edges: edgePreset('plan_travail'),
        })
      );
      break;
    }

    case 'credence': {
      const matId = module.overrides?.facadeMaterialId ?? params.countertopMaterialId;
      panels.push(
        makePanel(counter, {
          nameFr: 'Crédence murale',
          role: 'credence',
          materialId: matId,
          widthMm: W,
          heightMm: H,
          thicknessMm: D,
          positionMm: [0, H / 2, 0],
          rotationRad: [0, 0, 0],
          grain: normalizeGrain(matId, 'H'),
          edges: edgePreset('credence'),
        })
      );
      break;
    }

    case 'plinthe': {
      panels.push(
        makePanel(counter, {
          nameFr: 'Plinthe continue',
          role: 'plinthe',
          materialId: params.facadeMaterialId,
          widthMm: W,
          heightMm: H,
          thicknessMm: D,
          positionMm: [0, H / 2, 0],
          rotationRad: [0, 0, 0],
          grain: facadeGrain(params.facadeMaterialId, 'H', module.grainDirection),
          edges: edgePreset('plinthe', { exposedAll: true }),
        })
      );
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
