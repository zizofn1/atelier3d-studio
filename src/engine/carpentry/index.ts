import type { CarpentryParams, ModuleInstance, ModuleOutput } from '@/types';
import { generateBathroomModule } from './bathroomModules';
import { generateCustomModule } from './customModules';
import { generateDressingModule } from './dressingModules';
import { generateKitchenModule } from './kitchenModules';
import { resolveParams } from './panelBuilder';

export {
  addHandleHardware,
  allEdges,
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
export { generateKitchenModule } from './kitchenModules';
export { generateBathroomModule } from './bathroomModules';
export { generateDressingModule } from './dressingModules';
export { generateCustomModule } from './customModules';

const INTERIOR_ROLES = new Set([
  'etagere',
  'separateur',
  'tiroir_cote',
  'tiroir_fond',
  'tiroir_arriere',
]);

// Two-level cache: avoids regenerating panels/hardware for untouched modules or pure X/Y/Z/rotation drags
const moduleOutputRefCache = new WeakMap<CarpentryParams, WeakMap<ModuleInstance, ModuleOutput>>();
const moduleOutputGeomCache = new WeakMap<CarpentryParams, Map<string, ModuleOutput>>();
const MAX_GEOM_CACHE_PER_DEFAULTS = 400;

function computeModuleGeometryKey(module: ModuleInstance): string {
  const ov = module.overrides;
  return [
    module.id,
    module.type,
    module.widthMm,
    module.heightMm,
    module.depthMm,
    module.doorCount,
    module.drawerCount,
    module.shelfCount,
    module.columnCount ?? '',
    module.cornerKind ?? '',
    module.blindSide ?? '',
    module.facadeKind ?? '',
    module.hingeSide ?? '',
    module.colonneVariant ?? '',
    module.overhangMm ?? '',
    module.grainDirection ?? '',
    module.hasPlinth === false ? '0' : '1',
    module.hasCountertop === false ? '0' : '1',
    ov ? JSON.stringify(ov) : '',
  ].join('|');
}

export function generateModuleOutput(
  module: ModuleInstance,
  globalDefaults: CarpentryParams
): ModuleOutput {
  let byMod = moduleOutputRefCache.get(globalDefaults);
  const directHit = byMod?.get(module);
  if (directHit) return directHit;

  let byGeom = moduleOutputGeomCache.get(globalDefaults);
  const geomKey = computeModuleGeometryKey(module);
  const geomHit = byGeom?.get(geomKey);
  if (geomHit) {
    if (!byMod) {
      byMod = new WeakMap();
      moduleOutputRefCache.set(globalDefaults, byMod);
    }
    byMod.set(module, geomHit);
    return geomHit;
  }

  let output: ModuleOutput;
  switch (module.type) {
    case 'caisson_bas':
    case 'caisson_casserolier':
    case 'caisson_sous_evier':
    case 'caisson_bas_tiroir_porte':
    case 'caisson_bas_2tiroirs_porte':
    case 'caisson_haut':
    case 'meuble_haut_vitre':
    case 'caisson_haut_angle':
    case 'caisson_haut_angle_aveugle':
    case 'caisson_sur_frigo':
    case 'caisson_haut_relevant':
    case 'colonne':
    case 'colonne_garde_manger':
    case 'colonne_mixte_tiroirs_portes':
    case 'meuble_vitrine':
    case 'caisson_angle':
    case 'caisson_angle_l':
    case 'caisson_angle_aveugle':
    case 'caisson_angle_pan_coupe':
    case 'ilot_central':
    case 'plan_de_travail':
    case 'credence':
    case 'plinthe':
      output = generateKitchenModule(module, globalDefaults);
      break;

    case 'meuble_vasque':
    case 'meuble_double_vasque':
    case 'armoire_miroir_led':
    case 'colonne_sdb':
    case 'meuble_buanderie':
      output = generateBathroomModule(module, globalDefaults);
      break;

    case 'dressing_penderie':
    case 'dressing_etagere':
    case 'dressing_tiroirs':
    case 'portes_battantes':
    case 'portes_coulissantes':
      output = generateDressingModule(module, globalDefaults);
      break;

    case 'meuble_tv':
    case 'bibliotheque':
    case 'bureau':
    case 'banc_entree':
      output = generateCustomModule(module, globalDefaults);
      break;
  }

  const params = resolveParams(module, globalDefaults);
  const baseCode = params.facadeEdgeCode ?? '2';
  const ov = params.facadeEdgeOverrides;
  const applyEdgeOverride = Boolean(params.facadeEdgeCode || params.facadeEdgeOverrides);

  const isGlazedModule =
    module.facadeKind === 'vitre' ||
    module.type === 'meuble_haut_vitre' ||
    module.type === 'meuble_vitrine';

  output = {
    ...output,
    panels: output.panels.map((p) => {
      // Tag canonical surfaceSlot so custom facade / carcass / countertop colors apply across ALL modules
      const isFacadeRole =
        p.role === 'porte' || p.role === 'tiroir_facade' || p.role === 'plinthe';
      const isCountertopRole =
        (p.role === 'plan_travail' && module.type !== 'bureau' && module.type !== 'banc_entree') ||
        p.role === 'credence';
      const isExposedFacadeSide =
        (p.role === 'joue_gauche' || p.role === 'joue_droite' || p.role === 'fond') &&
        p.edges.top === '2' &&
        p.edges.bottom === '2';

      const isGlazedDoor = isGlazedModule && p.role === 'porte';
      const surfaceSlot = isGlazedDoor
        ? 'glass'
        : p.surfaceSlot ??
          (isFacadeRole ||
          isExposedFacadeSide ||
          (p.role === 'plan_travail' && (module.type === 'bureau' || module.type === 'banc_entree'))
            ? 'facade'
            : isCountertopRole
              ? 'countertop'
              : p.role === 'fond' || p.role === 'tiroir_fond'
                ? 'back'
                : 'carcass');

      const nameFr =
        isGlazedDoor && !p.nameFr.toLowerCase().includes('vitr')
          ? `${p.nameFr} (cadre vitré)`
          : p.nameFr;

      const isInterior = p.isInterior ?? INTERIOR_ROLES.has(p.role);

      const nextEdges =
        applyEdgeOverride && (p.role === 'porte' || p.role === 'tiroir_facade')
          ? {
              top: ov?.top ?? baseCode,
              bottom: ov?.bottom ?? baseCode,
              left: ov?.left ?? baseCode,
              right: ov?.right ?? baseCode,
            }
          : p.edges;

      // Apply single-door hingeSide override ('left' | 'right') across all cabinet builders
      let animationGroup = p.animationGroup;
      let animationMeta = p.animationMeta;
      if (
        module.doorCount === 1 &&
        p.role === 'porte' &&
        animationMeta &&
        ((module.hingeSide === 'right' && animationMeta.kind === 'hinged_left') ||
          (module.hingeSide === 'left' && animationMeta.kind === 'hinged_right'))
      ) {
        const toRight = module.hingeSide === 'right';
        const theta = p.rotationRad[1] ?? 0;
        const halfW = p.widthMm / 2;
        const sign = toRight ? 1 : -1;
        const pivotX = Math.round((p.positionMm[0] + sign * halfW * Math.cos(theta)) * 100) / 100;
        const pivotZ = Math.round((p.positionMm[2] - sign * halfW * Math.sin(theta)) * 100) / 100;
        animationGroup = toRight ? 'door_right' : 'door_left';
        animationMeta = {
          ...animationMeta,
          kind: toRight ? 'hinged_right' : 'hinged_left',
          pivotMm: [
            pivotX,
            animationMeta.pivotMm?.[1] ?? p.positionMm[1],
            pivotZ,
          ],
        };
      }

      return {
        ...p,
        nameFr,
        surfaceSlot,
        isInterior,
        edges: nextEdges,
        animationGroup,
        animationMeta,
      };
    }),
  };

  if (!byMod) {
    byMod = new WeakMap();
    moduleOutputRefCache.set(globalDefaults, byMod);
  }
  byMod.set(module, output);

  if (!byGeom) {
    byGeom = new Map();
    moduleOutputGeomCache.set(globalDefaults, byGeom);
  }
  if (byGeom.size >= MAX_GEOM_CACHE_PER_DEFAULTS) {
    const oldest = byGeom.keys().next().value;
    if (oldest) byGeom.delete(oldest);
  }
  byGeom.set(geomKey, output);

  return output;
}
