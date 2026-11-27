import type {
  CarpentryParams,
  EdgeBandingCode,
  FourEdges,
  GrainDirection,
  HandleStyle,
  HardwareKind,
  HardwareRequirement,
  ModuleInstance,
  PanelAnimationGroup,
  PanelAnimationMeta,
  PanelRole,
  PanelSpec,
} from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
import { roundMm } from '@/utils/units';

export function resolveParams(
  module: ModuleInstance,
  defaults: CarpentryParams
): CarpentryParams {
  if (!module.overrides) {
    return { ...defaults };
  }
  return {
    ...defaults,
    ...module.overrides,
  };
}

export function normalizeGrain(
  materialId: string,
  preferred: Exclude<GrainDirection, 'none'>
): GrainDirection {
  const mat = getMaterialById(materialId);
  return mat.hasGrain ? preferred : 'none';
}

export function facadeGrain(
  materialId: string,
  preferred: Exclude<GrainDirection, 'none'>,
  moduleGrain?: GrainDirection
): GrainDirection {
  if (moduleGrain === 'H' || moduleGrain === 'V') {
    return moduleGrain;
  }
  if (moduleGrain === 'none') {
    return 'none';
  }
  const mat = getMaterialById(materialId);
  if (!mat.hasGrain) return 'none';
  return preferred;
}

export function allEdges(code: EdgeBandingCode): FourEdges {
  return { top: code, bottom: code, left: code, right: code };
}

export interface EdgePresetOptions {
  isWallHung?: boolean;
  exposedAll?: boolean;
  exposedEnds?: boolean;
}

export function edgePreset(role: PanelRole, options: EdgePresetOptions = {}): FourEdges {
  const { isWallHung = false, exposedAll = false, exposedEnds = false } = options;

  switch (role) {
    case 'porte':
    case 'tiroir_facade':
      return allEdges('2');
    case 'joue_gauche':
    case 'joue_droite':
      if (exposedAll) return allEdges('2');
      return {
        top: 'none',
        bottom: isWallHung ? '0.4' : 'none',
        left: 'none',
        right: '0.4',
      };
    case 'pied_panneau':
      return {
        top: '0.4',
        bottom: '0.4',
        left: '0.4',
        right: '2',
      };
    case 'separateur':
      return { top: 'none', bottom: 'none', left: 'none', right: '0.4' };
    case 'dessus':
    case 'dessous':
    case 'traverse':
    case 'etagere':
      return {
        top: '0.4',
        bottom: 'none',
        left: exposedEnds ? '0.4' : 'none',
        right: exposedEnds ? '0.4' : 'none',
      };
    case 'fond':
    case 'tiroir_fond':
      if (exposedAll) return allEdges('2');
      return allEdges('none');
    case 'tiroir_cote':
    case 'tiroir_arriere':
      return { top: '0.4', bottom: 'none', left: 'none', right: 'none' };
    case 'plinthe':
      return exposedAll
        ? allEdges('0.4')
        : { top: '0.4', bottom: '0.4', left: 'none', right: 'none' };
    case 'plan_travail':
      return exposedAll
        ? allEdges('2')
        : { top: '2', bottom: 'none', left: '2', right: '2' };
    case 'credence':
      return { top: '2', bottom: 'none', left: '2', right: '2' };
    default:
      return allEdges('none');
  }
}

export interface PanelIdCounter {
  next(role: PanelRole): string;
}

export function createPanelIdCounter(moduleId: string): PanelIdCounter {
  let seq = 0;
  return {
    next(role: PanelRole) {
      seq += 1;
      return `${moduleId}__${role}_${seq}`;
    },
  };
}

export interface HardwareAccumulator {
  add(kind: HardwareKind, quantity: number, labelFr?: string): void;
  list(): HardwareRequirement[];
}

export function createHardwareAccumulator(): HardwareAccumulator {
  const map = new Map<HardwareKind, { quantity: number; labelFr?: string }>();
  return {
    add(kind: HardwareKind, quantity: number, labelFr?: string) {
      if (!Number.isFinite(quantity) || quantity <= 0) return;
      const existing = map.get(kind);
      if (existing) {
        existing.quantity = roundMm(existing.quantity + quantity, 2);
        if (!existing.labelFr && labelFr) existing.labelFr = labelFr;
      } else {
        map.set(kind, { quantity: roundMm(quantity, 2), labelFr });
      }
    },
    list(): HardwareRequirement[] {
      const result: HardwareRequirement[] = [];
      for (const [kind, entry] of map.entries()) {
        if (entry.quantity > 0) {
          result.push({
            kind,
            quantity: entry.quantity,
            ...(entry.labelFr ? { labelFr: entry.labelFr } : {}),
          });
        }
      }
      return result;
    },
  };
}

export function makePanel(
  counter: PanelIdCounter,
  spec: Omit<PanelSpec, 'id'>
): PanelSpec {
  return {
    id: counter.next(spec.role),
    ...spec,
    widthMm: roundMm(Math.max(1, spec.widthMm), 2),
    heightMm: roundMm(Math.max(1, spec.heightMm), 2),
    thicknessMm: roundMm(Math.max(1, spec.thicknessMm), 2),
    positionMm: [
      roundMm(spec.positionMm[0], 2),
      roundMm(spec.positionMm[1], 2),
      roundMm(spec.positionMm[2], 2),
    ],
    rotationRad: [
      roundMm(spec.rotationRad[0], 6),
      roundMm(spec.rotationRad[1], 6),
      roundMm(spec.rotationRad[2], 6),
    ],
  };
}

export interface CarcassOptions {
  counter: PanelIdCounter;
  params: CarpentryParams;
  widthMm: number;
  heightMm: number;
  depthMm: number;
  yBaseMm: number;
  zBackMm: number;
  topMode: 'full' | 'stretchers' | 'none';
  isWallHung?: boolean;
  exposedSides?: boolean;
  exposedBack?: boolean;
  warnings?: string[];
}

export interface CarcassResult {
  panels: PanelSpec[];
  innerW: number;
  innerZBack: number;
  innerZFront: number;
  yInnerBottom: number;
  yInnerTop: number;
}

export function buildCarcassPanels(opts: CarcassOptions): CarcassResult {
  const {
    counter,
    params,
    widthMm,
    heightMm,
    depthMm,
    yBaseMm,
    zBackMm,
    topMode,
    isWallHung = false,
    exposedSides = false,
    exposedBack = false,
    warnings,
  } = opts;

  const T = params.boardThickness;
  const T_back = params.backThickness;
  const zFront = zBackMm + depthMm;

  if (widthMm < 2 * T + 10 && warnings) {
    warnings.push(`Largeur caisson trop faible (${roundMm(widthMm, 0)} mm) pour panneaux de ${T} mm.`);
  }
  const innerW = Math.max(10, widthMm - 2 * T);
  const panels: PanelSpec[] = [];

  const sideEdges = edgePreset('joue_gauche', { isWallHung, exposedAll: exposedSides });
  const sideMat = exposedSides ? params.facadeMaterialId : params.carcassMaterialId;
  const sideGrain = normalizeGrain(sideMat, 'V');
  const horizGrain = normalizeGrain(params.carcassMaterialId, 'H');
  const backMat = exposedBack ? params.facadeMaterialId : params.backMaterialId;
  const backGrain = normalizeGrain(backMat, 'V');

  const yInnerBottom = yBaseMm + T;
  const yInnerTop = topMode === 'none' ? yBaseMm + heightMm : yBaseMm + heightMm - T;

  if (params.backMountType === 'rainure') {
    const grooveDepth = Math.min(8, Math.floor(T * 0.5));
    const setback = Math.min(12, Math.max(4, depthMm - T_back - 30));
    const zMid = (zBackMm + zFront) / 2;

    // Left & Right sides
    panels.push(
      makePanel(counter, {
        nameFr: 'Joue gauche',
        role: 'joue_gauche',
        materialId: sideMat,
        widthMm: depthMm,
        heightMm,
        thicknessMm: T,
        positionMm: [-(widthMm / 2 - T / 2), yBaseMm + heightMm / 2, zMid],
        rotationRad: [0, -Math.PI / 2, 0],
        grain: sideGrain,
        edges: sideEdges,
      }),
      makePanel(counter, {
        nameFr: 'Joue droite',
        role: 'joue_droite',
        materialId: sideMat,
        widthMm: depthMm,
        heightMm,
        thicknessMm: T,
        positionMm: [widthMm / 2 - T / 2, yBaseMm + heightMm / 2, zMid],
        rotationRad: [0, -Math.PI / 2, 0],
        grain: sideGrain,
        edges: edgePreset('joue_droite', { isWallHung, exposedAll: exposedSides }),
      })
    );

    // Bottom
    panels.push(
      makePanel(counter, {
        nameFr: 'Dessous',
        role: 'dessous',
        materialId: params.carcassMaterialId,
        widthMm: innerW,
        heightMm: depthMm,
        thicknessMm: T,
        positionMm: [0, yBaseMm + T / 2, zMid],
        rotationRad: [Math.PI / 2, 0, 0],
        grain: horizGrain,
        edges: edgePreset('dessous'),
      })
    );

    const zFond = zBackMm + setback + T_back / 2;
    const innerZBack = zBackMm + setback + T_back;

    if (topMode === 'full') {
      panels.push(
        makePanel(counter, {
          nameFr: 'Dessus',
          role: 'dessus',
          materialId: params.carcassMaterialId,
          widthMm: innerW,
          heightMm: depthMm,
          thicknessMm: T,
          positionMm: [0, yBaseMm + heightMm - T / 2, zMid],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: horizGrain,
          edges: edgePreset('dessus'),
        })
      );

      const fondW = Math.max(10, innerW + 2 * grooveDepth);
      const fondH = Math.max(10, heightMm - 2 * T + 2 * grooveDepth);
      panels.push(
        makePanel(counter, {
          nameFr: 'Fond rainuré',
          role: 'fond',
          materialId: backMat,
          widthMm: fondW,
          heightMm: fondH,
          thicknessMm: T_back,
          positionMm: [0, yBaseMm + heightMm / 2, zFond],
          rotationRad: [0, 0, 0],
          grain: backGrain,
          edges: edgePreset('fond', { exposedAll: exposedBack }),
        })
      );
    } else if (topMode === 'stretchers') {
      const stretcherD = Math.min(100, Math.max(30, (depthMm - setback - T_back) / 2 - 2));
      panels.push(
        makePanel(counter, {
          nameFr: 'Traverse haute arrière',
          role: 'traverse',
          materialId: params.carcassMaterialId,
          widthMm: innerW,
          heightMm: stretcherD,
          thicknessMm: T,
          positionMm: [0, yBaseMm + heightMm - T / 2, innerZBack + stretcherD / 2],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: horizGrain,
          edges: edgePreset('traverse'),
        }),
        makePanel(counter, {
          nameFr: 'Traverse haute avant',
          role: 'traverse',
          materialId: params.carcassMaterialId,
          widthMm: innerW,
          heightMm: stretcherD,
          thicknessMm: T,
          positionMm: [0, yBaseMm + heightMm - T / 2, zFront - stretcherD / 2],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: horizGrain,
          edges: edgePreset('traverse'),
        })
      );

      const fondW = Math.max(10, innerW + 2 * grooveDepth);
      const fondH = Math.max(10, heightMm - T + grooveDepth);
      const fondY = yBaseMm + T - grooveDepth + fondH / 2;
      panels.push(
        makePanel(counter, {
          nameFr: 'Fond rainuré',
          role: 'fond',
          materialId: backMat,
          widthMm: fondW,
          heightMm: fondH,
          thicknessMm: T_back,
          positionMm: [0, fondY, zFond],
          rotationRad: [0, 0, 0],
          grain: backGrain,
          edges: edgePreset('fond', { exposedAll: exposedBack }),
        })
      );
    } else {
      const fondW = Math.max(10, innerW + 2 * grooveDepth);
      const fondH = Math.max(10, heightMm - 2 * T + 2 * grooveDepth);
      const fondY = yBaseMm + T - grooveDepth + fondH / 2;
      panels.push(
        makePanel(counter, {
          nameFr: 'Fond rainuré',
          role: 'fond',
          materialId: backMat,
          widthMm: fondW,
          heightMm: fondH,
          thicknessMm: T_back,
          positionMm: [0, fondY, zFond],
          rotationRad: [0, 0, 0],
          grain: backGrain,
          edges: edgePreset('fond', { exposedAll: exposedBack }),
        })
      );
    }

    return {
      panels,
      innerW,
      innerZBack,
      innerZFront: zFront,
      yInnerBottom,
      yInnerTop,
    };
  }

  // Applique back mount
  const sideD = Math.max(40, depthMm - T_back);
  const zMid = (zBackMm + T_back + zFront) / 2;
  const innerZBack = zBackMm + T_back;

  panels.push(
    makePanel(counter, {
      nameFr: 'Joue gauche',
      role: 'joue_gauche',
      materialId: sideMat,
      widthMm: sideD,
      heightMm,
      thicknessMm: T,
      positionMm: [-(widthMm / 2 - T / 2), yBaseMm + heightMm / 2, zMid],
      rotationRad: [0, -Math.PI / 2, 0],
      grain: sideGrain,
      edges: sideEdges,
    }),
    makePanel(counter, {
      nameFr: 'Joue droite',
      role: 'joue_droite',
      materialId: sideMat,
      widthMm: sideD,
      heightMm,
      thicknessMm: T,
      positionMm: [widthMm / 2 - T / 2, yBaseMm + heightMm / 2, zMid],
      rotationRad: [0, -Math.PI / 2, 0],
      grain: sideGrain,
      edges: edgePreset('joue_droite', { isWallHung, exposedAll: exposedSides }),
    }),
    makePanel(counter, {
      nameFr: 'Dessous',
      role: 'dessous',
      materialId: params.carcassMaterialId,
      widthMm: innerW,
      heightMm: sideD,
      thicknessMm: T,
      positionMm: [0, yBaseMm + T / 2, zMid],
      rotationRad: [Math.PI / 2, 0, 0],
      grain: horizGrain,
      edges: edgePreset('dessous'),
    })
  );

  if (topMode === 'full') {
    panels.push(
      makePanel(counter, {
        nameFr: 'Dessus',
        role: 'dessus',
        materialId: params.carcassMaterialId,
        widthMm: innerW,
        heightMm: sideD,
        thicknessMm: T,
        positionMm: [0, yBaseMm + heightMm - T / 2, zMid],
        rotationRad: [Math.PI / 2, 0, 0],
        grain: horizGrain,
        edges: edgePreset('dessus'),
      })
    );
  } else if (topMode === 'stretchers') {
    const stretcherD = Math.min(100, Math.max(30, sideD / 2 - 2));
    panels.push(
      makePanel(counter, {
        nameFr: 'Traverse haute arrière',
        role: 'traverse',
        materialId: params.carcassMaterialId,
        widthMm: innerW,
        heightMm: stretcherD,
        thicknessMm: T,
        positionMm: [0, yBaseMm + heightMm - T / 2, innerZBack + stretcherD / 2],
        rotationRad: [Math.PI / 2, 0, 0],
        grain: horizGrain,
        edges: edgePreset('traverse'),
      }),
      makePanel(counter, {
        nameFr: 'Traverse haute avant',
        role: 'traverse',
        materialId: params.carcassMaterialId,
        widthMm: innerW,
        heightMm: stretcherD,
        thicknessMm: T,
        positionMm: [0, yBaseMm + heightMm - T / 2, zFront - stretcherD / 2],
        rotationRad: [Math.PI / 2, 0, 0],
        grain: horizGrain,
        edges: edgePreset('traverse'),
      })
    );
  }

  panels.push(
    makePanel(counter, {
      nameFr: 'Fond appliqué',
      role: 'fond',
      materialId: backMat,
      widthMm: Math.max(10, widthMm - 2),
      heightMm: Math.max(10, heightMm - 2),
      thicknessMm: T_back,
      positionMm: [0, yBaseMm + heightMm / 2, zBackMm + T_back / 2],
      rotationRad: [0, 0, 0],
      grain: backGrain,
      edges: edgePreset('fond', { exposedAll: exposedBack }),
    })
  );

  return {
    panels,
    innerW,
    innerZBack,
    innerZFront: zFront,
    yInnerBottom,
    yInnerTop,
  };
}

export interface ShelvesOptions {
  counter: PanelIdCounter;
  params: CarpentryParams;
  shelfCount: number;
  bayCenterXMm: number;
  bayInnerWidthMm: number;
  yMinMm: number;
  yMaxMm: number;
  innerZBackMm: number;
  innerZFrontMm: number;
  hasFacades: boolean;
  labelFr?: string;
}

export function buildShelves(opts: ShelvesOptions): PanelSpec[] {
  const {
    counter,
    params,
    shelfCount,
    bayCenterXMm,
    bayInnerWidthMm,
    yMinMm,
    yMaxMm,
    innerZBackMm,
    innerZFrontMm,
    hasFacades,
    labelFr = 'Étagère',
  } = opts;

  if (shelfCount <= 0 || yMaxMm - yMinMm < params.boardThickness + 20) {
    return [];
  }

  const T = params.boardThickness;
  const shelfW = Math.max(10, bayInnerWidthMm - 2);
  const frontSetback = hasFacades ? 20 : 2;
  const shelfD = Math.max(40, innerZFrontMm - frontSetback - (innerZBackMm + 2));
  const shelfZ = innerZBackMm + 2 + shelfD / 2;
  const grain = normalizeGrain(params.carcassMaterialId, 'H');

  const panels: PanelSpec[] = [];
  for (let k = 0; k < shelfCount; k++) {
    const y = yMinMm + ((k + 1) / (shelfCount + 1)) * (yMaxMm - yMinMm);
    panels.push(
      makePanel(counter, {
        nameFr: labelFr,
        role: 'etagere',
        materialId: params.carcassMaterialId,
        widthMm: shelfW,
        heightMm: shelfD,
        thicknessMm: T,
        positionMm: [bayCenterXMm, y, shelfZ],
        rotationRad: [Math.PI / 2, 0, 0],
        grain,
        edges: edgePreset('etagere'),
      })
    );
  }
  return panels;
}

export interface SeparatorsResult {
  panels: PanelSpec[];
  bays: Array<{ centerX: number; innerW: number; xMin: number; xMax: number }>;
}

export function buildVerticalDividers(
  counter: PanelIdCounter,
  params: CarpentryParams,
  numBays: number,
  totalInnerW: number,
  yInnerBottom: number,
  yInnerTop: number,
  innerZBack: number,
  innerZFront: number,
  startCenterX = 0
): SeparatorsResult {
  const T = params.boardThickness;
  const count = Math.max(1, numBays);
  const sepCount = count - 1;
  const sepD = Math.max(40, innerZFront - innerZBack - 2);
  const sepZ = innerZBack + 2 + sepD / 2;
  const sepH = Math.max(10, yInnerTop - yInnerBottom);
  const sepY = yInnerBottom + sepH / 2;
  const bayW = Math.max(10, (totalInnerW - sepCount * T) / count);
  const grain = normalizeGrain(params.carcassMaterialId, 'V');

  const panels: PanelSpec[] = [];
  const bays: Array<{ centerX: number; innerW: number; xMin: number; xMax: number }> = [];

  const leftEdge = startCenterX - totalInnerW / 2;
  for (let b = 0; b < count; b++) {
    const xMin = leftEdge + b * (bayW + T);
    const xMax = xMin + bayW;
    bays.push({
      centerX: (xMin + xMax) / 2,
      innerW: bayW,
      xMin,
      xMax,
    });
    if (b < sepCount) {
      const sepX = xMax + T / 2;
      panels.push(
        makePanel(counter, {
          nameFr: 'Séparateur vertical',
          role: 'separateur',
          materialId: params.carcassMaterialId,
          widthMm: sepD,
          heightMm: sepH,
          thicknessMm: T,
          positionMm: [sepX, sepY, sepZ],
          rotationRad: [0, -Math.PI / 2, 0],
          grain,
          edges: edgePreset('separateur'),
        })
      );
    }
  }

  return { panels, bays };
}

export function hingesPerDoorHeight(heightMm: number): number {
  if (heightMm <= 900) return 2;
  if (heightMm <= 1600) return 3;
  if (heightMm <= 2100) return 4;
  return 5;
}

export function addHandleHardware(
  hw: HardwareAccumulator,
  style: HandleStyle,
  count: number,
  runLengthMm = 0
): void {
  if (count <= 0) return;
  switch (style) {
    case 'bar':
      hw.add('poignee', count);
      break;
    case 'knob':
      hw.add('bouton', count);
      break;
    case 'push':
      hw.add('push_open', count);
      break;
    case 'gorge':
      hw.add('profil_gorge', Math.max(0.2, roundMm(runLengthMm / 1000, 2)));
      break;
  }
}

export interface HingedDoorsOptions {
  counter: PanelIdCounter;
  params: CarpentryParams;
  doorCount: number;
  zoneCenterXMm: number;
  zoneWidthMm: number;
  zoneBottomYMm: number;
  zoneHeightMm: number;
  zFacadeCenterMm: number;
  moduleGrain?: GrainDirection;
  hingeSide?: 'left' | 'right';
}

export function buildHingedDoors(opts: HingedDoorsOptions): {
  panels: PanelSpec[];
  hinges: number;
  doorHeightMm: number;
} {
  const {
    counter,
    params,
    doorCount,
    zoneCenterXMm,
    zoneWidthMm,
    zoneBottomYMm,
    zoneHeightMm,
    zFacadeCenterMm,
    moduleGrain,
    hingeSide,
  } = opts;

  if (doorCount <= 0) {
    return { panels: [], hinges: 0, doorHeightMm: 0 };
  }

  const n = Math.max(1, Math.min(6, Math.round(doorCount)));
  const gap = params.facadeGapMm;
  const T = params.boardThickness;
  const doorW = Math.max(40, (zoneWidthMm - n * gap) / n);
  const doorH = Math.max(40, zoneHeightMm - gap);
  const cy = zoneBottomYMm + zoneHeightMm / 2;
  const grain = facadeGrain(params.facadeMaterialId, 'V', moduleGrain);

  const panels: PanelSpec[] = [];
  let hinges = 0;

  for (let i = 0; i < n; i++) {
    const cx = zoneCenterXMm - zoneWidthMm / 2 + gap / 2 + i * (doorW + gap) + doorW / 2;
    let isLeft: boolean;
    if (n === 1) {
      isLeft = hingeSide !== 'right';
    } else if (n === 2) {
      isLeft = i === 0;
    } else if (n === 3) {
      isLeft = i < 2;
    } else {
      isLeft = i % 2 === 0;
    }

    const animationGroup: PanelAnimationGroup = isLeft ? 'door_left' : 'door_right';
    const pivotX = isLeft ? cx - doorW / 2 : cx + doorW / 2;
    const animationMeta: PanelAnimationMeta = {
      kind: isLeft ? 'hinged_left' : 'hinged_right',
      index: i,
      pivotMm: [roundMm(pivotX, 2), roundMm(cy, 2), roundMm(zFacadeCenterMm + T / 2, 2)],
    };

    panels.push(
      makePanel(counter, {
        nameFr: n === 1 ? 'Porte' : `Porte ${i + 1}`,
        role: 'porte',
        materialId: params.facadeMaterialId,
        widthMm: doorW,
        heightMm: doorH,
        thicknessMm: T,
        positionMm: [cx, cy, zFacadeCenterMm],
        rotationRad: [0, 0, 0],
        grain,
        edges: edgePreset('porte'),
        animationGroup,
        animationMeta,
      })
    );
    hinges += hingesPerDoorHeight(doorH);
  }

  return { panels, hinges, doorHeightMm: doorH };
}

export interface DrawersOptions {
  counter: PanelIdCounter;
  params: CarpentryParams;
  drawerCount: number;
  zoneCenterXMm: number;
  zoneWidthMm: number;
  bayInnerWidthMm: number;
  zoneBottomYMm: number;
  zoneHeightMm: number;
  zFacadeCenterMm: number;
  innerZBackMm: number;
  innerZFrontMm: number;
  startDrawerIndex?: number;
  moduleGrain?: GrainDirection;
  warnings?: string[];
}

export function buildDrawers(opts: DrawersOptions): {
  panels: PanelSpec[];
  runnerCount: number;
} {
  const {
    counter,
    params,
    drawerCount,
    zoneCenterXMm,
    zoneWidthMm,
    bayInnerWidthMm,
    zoneBottomYMm,
    zoneHeightMm,
    zFacadeCenterMm,
    innerZBackMm,
    innerZFrontMm,
    startDrawerIndex = 0,
    moduleGrain,
    warnings,
  } = opts;

  if (drawerCount <= 0) {
    return { panels: [], runnerCount: 0 };
  }

  const n = Math.max(1, Math.round(drawerCount));
  const gap = params.facadeGapMm;
  const T = params.boardThickness;
  const T_d = Math.min(16, T);
  const T_back = params.backThickness;

  const frontW = Math.max(40, zoneWidthMm - gap);
  const frontH = Math.max(40, (zoneHeightMm - n * gap) / n);
  const frontGrain = facadeGrain(params.facadeMaterialId, 'H', moduleGrain);
  const boxSideGrain = normalizeGrain(params.carcassMaterialId, 'H');
  const boxBackGrain = normalizeGrain(params.carcassMaterialId, 'H');
  const boxBottomGrain = normalizeGrain(params.backMaterialId, 'H');

  const usableD = Math.max(80, innerZFrontMm - innerZBackMm);
  if (usableD < 150 && warnings) {
    warnings.push(`Profondeur utile réduite (${roundMm(usableD, 0)} mm) pour les coulisses de tiroir.`);
  }
  const steppedRunner = Math.floor((usableD - 40) / 50) * 50;
  const D_runner = Math.max(
    60,
    Math.min(usableD - 10, steppedRunner >= 150 ? steppedRunner : usableD - 20)
  );
  const boxOuterW = Math.max(60, bayInnerWidthMm - 26);
  const boxInnerW = Math.max(20, boxOuterW - 2 * T_d);
  const boxH = Math.max(36, Math.min(frontH - 36, 180));
  const slideTravelMm = roundMm(D_runner * 0.85, 2);

  const panels: PanelSpec[] = [];

  for (let i = 0; i < n; i++) {
    const idx = startDrawerIndex + i;
    const animGroup: PanelAnimationGroup = `drawer_${idx}`;
    const animMeta: PanelAnimationMeta = {
      kind: 'drawer',
      index: idx,
      slideDirection: 1,
      slideTravelMm,
    };

    const cy = zoneBottomYMm + gap / 2 + i * (frontH + gap) + frontH / 2;

    // 1. Drawer front
    panels.push(
      makePanel(counter, {
        nameFr: `Façade tiroir ${idx + 1}`,
        role: 'tiroir_facade',
        materialId: params.facadeMaterialId,
        widthMm: frontW,
        heightMm: frontH,
        thicknessMm: T,
        positionMm: [zoneCenterXMm, cy, zFacadeCenterMm],
        rotationRad: [0, 0, 0],
        grain: frontGrain,
        edges: edgePreset('tiroir_facade'),
        animationGroup: animGroup,
        animationMeta: animMeta,
      })
    );

    const boxBottomY = Math.max(zoneBottomYMm + 8, cy - boxH / 2 - 4);
    const boxCenterY = boxBottomY + boxH / 2;
    const boxFrontZ = innerZFrontMm;
    const boxBackZ = innerZFrontMm - D_runner;
    const boxCenterZ = (boxFrontZ + boxBackZ) / 2;

    // 2. Left & Right drawer sides
    panels.push(
      makePanel(counter, {
        nameFr: `Côté tiroir G ${idx + 1}`,
        role: 'tiroir_cote',
        materialId: params.carcassMaterialId,
        widthMm: D_runner,
        heightMm: boxH,
        thicknessMm: T_d,
        positionMm: [zoneCenterXMm - boxOuterW / 2 + T_d / 2, boxCenterY, boxCenterZ],
        rotationRad: [0, -Math.PI / 2, 0],
        grain: boxSideGrain,
        edges: edgePreset('tiroir_cote'),
        animationGroup: animGroup,
        animationMeta: animMeta,
      }),
      makePanel(counter, {
        nameFr: `Côté tiroir D ${idx + 1}`,
        role: 'tiroir_cote',
        materialId: params.carcassMaterialId,
        widthMm: D_runner,
        heightMm: boxH,
        thicknessMm: T_d,
        positionMm: [zoneCenterXMm + boxOuterW / 2 - T_d / 2, boxCenterY, boxCenterZ],
        rotationRad: [0, -Math.PI / 2, 0],
        grain: boxSideGrain,
        edges: edgePreset('tiroir_cote'),
        animationGroup: animGroup,
        animationMeta: animMeta,
      })
    );

    // 3. Drawer rear & internal counter-front
    panels.push(
      makePanel(counter, {
        nameFr: `Dos tiroir ${idx + 1}`,
        role: 'tiroir_arriere',
        materialId: params.carcassMaterialId,
        widthMm: boxInnerW,
        heightMm: boxH,
        thicknessMm: T_d,
        positionMm: [zoneCenterXMm, boxCenterY, boxBackZ + T_d / 2],
        rotationRad: [0, 0, 0],
        grain: boxBackGrain,
        edges: edgePreset('tiroir_arriere'),
        animationGroup: animGroup,
        animationMeta: animMeta,
      }),
      makePanel(counter, {
        nameFr: `Contre-façade tiroir ${idx + 1}`,
        role: 'tiroir_arriere',
        materialId: params.carcassMaterialId,
        widthMm: boxInnerW,
        heightMm: boxH,
        thicknessMm: T_d,
        positionMm: [zoneCenterXMm, boxCenterY, boxFrontZ - T_d / 2],
        rotationRad: [0, 0, 0],
        grain: boxBackGrain,
        edges: edgePreset('tiroir_arriere'),
        animationGroup: animGroup,
        animationMeta: animMeta,
      })
    );

    // 4. Drawer bottom
    if (params.backMountType === 'rainure') {
      const groove = Math.min(8, Math.floor(T_d * 0.5));
      panels.push(
        makePanel(counter, {
          nameFr: `Fond tiroir ${idx + 1}`,
          role: 'tiroir_fond',
          materialId: params.backMaterialId,
          widthMm: boxInnerW + 2 * groove,
          heightMm: Math.max(20, D_runner - 2 * T_d + 2 * groove),
          thicknessMm: T_back,
          positionMm: [zoneCenterXMm, boxBottomY + 12 + T_back / 2, boxCenterZ],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: boxBottomGrain,
          edges: edgePreset('tiroir_fond'),
          animationGroup: animGroup,
          animationMeta: animMeta,
        })
      );
    } else {
      panels.push(
        makePanel(counter, {
          nameFr: `Fond tiroir ${idx + 1}`,
          role: 'tiroir_fond',
          materialId: params.backMaterialId,
          widthMm: Math.max(20, boxOuterW - 2),
          heightMm: Math.max(20, D_runner - 2),
          thicknessMm: T_back,
          positionMm: [zoneCenterXMm, Math.max(zoneBottomYMm + T_back / 2, boxBottomY - T_back / 2), boxCenterZ],
          rotationRad: [Math.PI / 2, 0, 0],
          grain: boxBottomGrain,
          edges: edgePreset('tiroir_fond'),
          animationGroup: animGroup,
          animationMeta: animMeta,
        })
      );
    }
  }

  return { panels, runnerCount: n };
}

export function buildPlinthPanel(
  counter: PanelIdCounter,
  params: CarpentryParams,
  widthMm: number,
  plinthHeightMm: number,
  zFrontCarcassMm: number,
  moduleGrain?: GrainDirection
): PanelSpec | null {
  if (plinthHeightMm < 12) return null;
  const T = params.boardThickness;
  const h = Math.max(10, plinthHeightMm);
  const zPos = zFrontCarcassMm - params.plinthRecessMm - T / 2;
  return makePanel(counter, {
    nameFr: 'Plinthe',
    role: 'plinthe',
    materialId: params.facadeMaterialId,
    widthMm,
    heightMm: h,
    thicknessMm: T,
    positionMm: [0, h / 2, zPos],
    rotationRad: [0, 0, 0],
    grain: facadeGrain(params.facadeMaterialId, 'H', moduleGrain),
    edges: edgePreset('plinthe'),
  });
}
