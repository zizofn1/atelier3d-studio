import type {
  CutlistItem,
  EdgeBandingCode,
  FourEdges,
  NestingPieceInput,
  PanelSpec,
  ProjectDocument,
} from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
import { generateModuleOutput } from '@/engine/carpentry';
import { FR } from '@/i18n/fr';
import { roundMm } from '@/utils/units';

function edgeThicknessMm(code: EdgeBandingCode): number {
  if (code === '2') return 2;
  if (code === '0.4') return 0.4;
  return 0;
}

/**
 * Orient a PanelSpec into workshop cutting dimensions (lengthMm x widthMm):
 * - When grain is 'V', the grain runs along panel.heightMm, so lengthMm = heightMm, widthMm = widthMm,
 *   and the 4 edge codes are mapped so top/bottom lie along lengthMm and left/right along widthMm.
 * - Otherwise (grain 'H' or 'none'), lengthMm = widthMm and widthMm = heightMm.
 * - When `deductEdgeBandingThickness` is true, deducts applied edge-banding thickness (2 mm / 0.4 mm)
 *   to obtain exact raw saw cutting dimensions (cote débit vs cote finie).
 */
export function orientPanelForCutlist(
  panel: PanelSpec,
  deductEdgeBandingThickness = false
): {
  lengthMm: number;
  widthMm: number;
  edges: FourEdges;
} {
  let rawLength: number;
  let rawWidth: number;
  let edges: FourEdges;

  if (panel.grain === 'V') {
    rawLength = panel.heightMm;
    rawWidth = panel.widthMm;
    edges = {
      top: panel.edges.left,
      bottom: panel.edges.right,
      left: panel.edges.top,
      right: panel.edges.bottom,
    };
  } else {
    rawLength = panel.widthMm;
    rawWidth = panel.heightMm;
    edges = { ...panel.edges };
  }

  if (deductEdgeBandingThickness) {
    const deductLength = edgeThicknessMm(edges.left) + edgeThicknessMm(edges.right);
    const deductWidth = edgeThicknessMm(edges.top) + edgeThicknessMm(edges.bottom);
    rawLength = Math.max(10, rawLength - deductLength);
    rawWidth = Math.max(10, rawWidth - deductWidth);
  }

  return {
    lengthMm: roundMm(rawLength, 1),
    widthMm: roundMm(rawWidth, 1),
    edges,
  };
}

export function computePanelEdgeLengthsMm(
  lengthMm: number,
  widthMm: number,
  edges: FourEdges
): { '0.4': number; '2': number; totalMm: number } {
  let len04 = 0;
  let len2 = 0;

  const add = (code: EdgeBandingCode, dimMm: number) => {
    if (code === '0.4') len04 += dimMm;
    else if (code === '2') len2 += dimMm;
  };

  add(edges.top, lengthMm);
  add(edges.bottom, lengthMm);
  add(edges.left, widthMm);
  add(edges.right, widthMm);

  return {
    '0.4': roundMm(len04, 1),
    '2': roundMm(len2, 1),
    totalMm: roundMm(len04 + len2, 1),
  };
}

export function buildCutlist(doc: ProjectDocument): CutlistItem[] {
  const items: CutlistItem[] = [];
  const groupIndexByKey = new Map<string, number>();

  for (const mod of doc.modules) {
    const output = generateModuleOutput(mod, doc.defaultCarpentry);
    const deductEdges = Boolean(
      mod.overrides?.deductEdgeBandingThickness ?? doc.defaultCarpentry.deductEdgeBandingThickness
    );
    for (const panel of output.panels) {
      const { lengthMm, widthMm, edges } = orientPanelForCutlist(panel, deductEdges);
      const mat = getMaterialById(panel.materialId);
      const areaM2 = roundMm((lengthMm * widthMm) / 1_000_000, 4);
      const edgeLengths = computePanelEdgeLengthsMm(lengthMm, widthMm, edges);

      const groupKey = [
        mod.id,
        panel.nameFr,
        panel.materialId,
        lengthMm,
        widthMm,
        panel.thicknessMm,
        panel.grain,
        edges.top,
        edges.bottom,
        edges.left,
        edges.right,
      ].join('|');

      const existingIdx = groupIndexByKey.get(groupKey);
      if (existingIdx !== undefined) {
        items[existingIdx] = {
          ...items[existingIdx],
          quantity: items[existingIdx].quantity + 1,
        };
        continue;
      }

      groupIndexByKey.set(groupKey, items.length);
      items.push({
        id: `${mod.ref}-${panel.id}`,
        moduleId: mod.id,
        moduleRef: mod.ref,
        moduleNameFr: mod.nameFr,
        partNameFr: panel.nameFr,
        materialId: panel.materialId,
        materialNameFr: mat.nameFr,
        lengthMm,
        widthMm,
        thicknessMm: panel.thicknessMm,
        grain: panel.grain,
        edges,
        quantity: 1,
        areaM2,
        edgeLengthM: roundMm(edgeLengths.totalMm / 1000, 3),
      });
    }
  }

  return items;
}

export function cutlistToNestingPieces(items: CutlistItem[]): NestingPieceInput[] {
  const pieces: NestingPieceInput[] = [];
  for (const item of items) {
    for (let q = 0; q < item.quantity; q++) {
      pieces.push({
        id: item.quantity > 1 ? `${item.id}#${q + 1}` : item.id,
        moduleRef: item.moduleRef,
        partNameFr: item.partNameFr,
        materialId: item.materialId,
        thicknessMm: item.thicknessMm,
        widthMm: item.lengthMm,
        heightMm: item.widthMm,
        grain: item.grain,
        edges: { ...item.edges },
      });
    }
  }
  return pieces;
}

function escapeCsvCell(value: string): string {
  if (/[;"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function fmtFrNum(n: number, decimals = 1): string {
  const rounded = roundMm(n, decimals);
  return String(rounded).replace('.', ',');
}

function fmtEdge(code: EdgeBandingCode): string {
  if (code === 'none') return '-';
  return code === '0.4' ? '0,4' : '2';
}

export function formatEdgeSummaryCode(edges: FourEdges): string {
  return `H:${fmtEdge(edges.top)} B:${fmtEdge(edges.bottom)} G:${fmtEdge(edges.left)} D:${fmtEdge(edges.right)}`;
}

export function buildCutlistCsv(items: CutlistItem[]): string {
  const headers = [
    'Repère',
    'Module',
    'Désignation',
    'Matériau',
    'Longueur (mm)',
    'Largeur (mm)',
    'Épaisseur (mm)',
    'Qté',
    'Sens du fil',
    'Chant haut',
    'Chant bas',
    'Chant gauche',
    'Chant droit',
  ];

  const lines: string[] = [headers.map(escapeCsvCell).join(';')];

  for (const item of items) {
    const row = [
      item.id,
      `${item.moduleRef} - ${item.moduleNameFr}`,
      item.partNameFr,
      item.materialNameFr,
      fmtFrNum(item.lengthMm, 1),
      fmtFrNum(item.widthMm, 1),
      fmtFrNum(item.thicknessMm, 1),
      String(item.quantity),
      FR.carpentry.grainDirections[item.grain],
      fmtEdge(item.edges.top),
      fmtEdge(item.edges.bottom),
      fmtEdge(item.edges.left),
      fmtEdge(item.edges.right),
    ];
    lines.push(row.map(escapeCsvCell).join(';'));
  }

  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
