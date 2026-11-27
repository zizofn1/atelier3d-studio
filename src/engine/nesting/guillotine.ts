import type {
  GuillotineCutLine,
  NestingConfig,
  NestingGroupResult,
  NestingPieceInput,
  NestingRunResult,
  NestingSheetResult,
  PlacedPiece,
} from '@/types';
import { roundMm } from '@/utils/units';

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SheetState {
  sheetIndex: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  freeRects: FreeRect[];
  placements: PlacedPiece[];
  cutLines: GuillotineCutLine[];
}

interface CandidatePlacement {
  sheetIdx: number;
  rectIdx: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  areaScore: number;
  shortSideScore: number;
}

const EPS = 1e-6;

function canRotatePiece(piece: NestingPieceInput, config: NestingConfig): boolean {
  if (Math.abs(piece.widthMm - piece.heightMm) < EPS) {
    return false;
  }
  if (config.respectGrain && piece.grain !== 'none') {
    return false;
  }
  return true;
}

function createSheet(sheetIndex: number, config: NestingConfig): SheetState {
  const usableW = config.sheet.widthMm - config.trimLeftMm - config.trimRightMm;
  const usableH = config.sheet.heightMm - config.trimTopMm - config.trimBottomMm;
  const freeRects: FreeRect[] = [];
  if (usableW >= 1 && usableH >= 1) {
    freeRects.push({
      x: roundMm(config.trimLeftMm, 3),
      y: roundMm(config.trimTopMm, 3),
      w: roundMm(usableW, 3),
      h: roundMm(usableH, 3),
    });
  }
  return {
    sheetIndex,
    sheetWidthMm: config.sheet.widthMm,
    sheetHeightMm: config.sheet.heightMm,
    freeRects,
    placements: [],
    cutLines: [],
  };
}

function findBestPlacement(
  piece: NestingPieceInput,
  sheets: SheetState[],
  config: NestingConfig
): CandidatePlacement | null {
  const orientations: Array<{ w: number; h: number; rotated: boolean }> = [
    { w: piece.widthMm, h: piece.heightMm, rotated: false },
  ];
  if (canRotatePiece(piece, config)) {
    orientations.push({ w: piece.heightMm, h: piece.widthMm, rotated: true });
  }

  let best: CandidatePlacement | null = null;

  for (let sIdx = 0; sIdx < sheets.length; sIdx++) {
    const sheet = sheets[sIdx];
    for (let rIdx = 0; rIdx < sheet.freeRects.length; rIdx++) {
      const rect = sheet.freeRects[rIdx];
      for (const orient of orientations) {
        if (orient.w <= rect.w + EPS && orient.h <= rect.h + EPS) {
          const areaScore = rect.w * rect.h - orient.w * orient.h;
          const shortSideScore = Math.min(rect.w - orient.w, rect.h - orient.h);
          const candidate: CandidatePlacement = {
            sheetIdx: sIdx,
            rectIdx: rIdx,
            x: rect.x,
            y: rect.y,
            w: orient.w,
            h: orient.h,
            rotated: orient.rotated,
            areaScore,
            shortSideScore,
          };

          if (
            !best ||
            candidate.sheetIdx < best.sheetIdx ||
            (candidate.sheetIdx === best.sheetIdx &&
              (candidate.areaScore < best.areaScore - EPS ||
                (Math.abs(candidate.areaScore - best.areaScore) <= EPS &&
                  (candidate.shortSideScore < best.shortSideScore - EPS ||
                    (Math.abs(candidate.shortSideScore - best.shortSideScore) <= EPS &&
                      (candidate.y < best.y - EPS ||
                        (Math.abs(candidate.y - best.y) <= EPS && candidate.x < best.x - EPS)))))))
          ) {
            best = candidate;
          }
        }
      }
    }
  }

  return best;
}

function applyPlacement(
  sheet: SheetState,
  piece: NestingPieceInput,
  cand: CandidatePlacement,
  kerfMm: number
): void {
  const rect = sheet.freeRects[cand.rectIdx];
  sheet.freeRects.splice(cand.rectIdx, 1);

  // Rotate edge-banding mapping when the piece is placed rotated 90° on the sheet
  // so workshop plans & PDFs always mark the true banded edges!
  const placedEdges = cand.rotated
    ? {
        top: piece.edges.left,
        bottom: piece.edges.right,
        left: piece.edges.top,
        right: piece.edges.bottom,
      }
    : { ...piece.edges };

  const placed: PlacedPiece = {
    pieceId: piece.id,
    moduleRef: piece.moduleRef,
    partNameFr: piece.partNameFr,
    xMm: roundMm(cand.x, 3),
    yMm: roundMm(cand.y, 3),
    widthMm: roundMm(cand.w, 3),
    heightMm: roundMm(cand.h, 3),
    rotated: cand.rotated,
    grain: piece.grain,
    edges: placedEdges,
  };
  sheet.placements.push(placed);

  const rawRemW = rect.w - cand.w;
  const rawRemH = rect.h - cand.h;
  const remW = rawRemW - kerfMm;
  const remH = rawRemH - kerfMm;

  // Shorter Leftover Axis Split (SAS): maximizes the larger remaining guillotine region.
  // Both sub-rectangles are strictly separated from the placed piece and from each other by >= kerfMm.
  const splitHorizontal = rawRemW < rawRemH;

  if (splitHorizontal) {
    if (rawRemH > EPS) {
      sheet.cutLines.push({
        orientation: 'H',
        coordMm: roundMm(rect.y + cand.h, 3),
        startMm: roundMm(rect.x, 3),
        endMm: roundMm(rect.x + rect.w, 3),
      });
    }
    if (rawRemW > EPS) {
      sheet.cutLines.push({
        orientation: 'V',
        coordMm: roundMm(rect.x + cand.w, 3),
        startMm: roundMm(rect.y, 3),
        endMm: roundMm(rect.y + cand.h, 3),
      });
    }

    // Right sub-rect (same height as placed piece)
    if (remW >= 1 && cand.h >= 1) {
      sheet.freeRects.push({
        x: roundMm(rect.x + cand.w + kerfMm, 3),
        y: roundMm(rect.y, 3),
        w: roundMm(remW, 3),
        h: roundMm(cand.h, 3),
      });
    }
    // Bottom sub-rect (full width of parent free rect)
    if (rect.w >= 1 && remH >= 1) {
      sheet.freeRects.push({
        x: roundMm(rect.x, 3),
        y: roundMm(rect.y + cand.h + kerfMm, 3),
        w: roundMm(rect.w, 3),
        h: roundMm(remH, 3),
      });
    }
  } else {
    if (rawRemW > EPS) {
      sheet.cutLines.push({
        orientation: 'V',
        coordMm: roundMm(rect.x + cand.w, 3),
        startMm: roundMm(rect.y, 3),
        endMm: roundMm(rect.y + rect.h, 3),
      });
    }
    if (rawRemH > EPS) {
      sheet.cutLines.push({
        orientation: 'H',
        coordMm: roundMm(rect.y + cand.h, 3),
        startMm: roundMm(rect.x, 3),
        endMm: roundMm(rect.x + cand.w, 3),
      });
    }

    // Right sub-rect (full height of parent free rect)
    if (remW >= 1 && rect.h >= 1) {
      sheet.freeRects.push({
        x: roundMm(rect.x + cand.w + kerfMm, 3),
        y: roundMm(rect.y, 3),
        w: roundMm(remW, 3),
        h: roundMm(rect.h, 3),
      });
    }
    // Bottom sub-rect (same width as placed piece)
    if (cand.w >= 1 && remH >= 1) {
      sheet.freeRects.push({
        x: roundMm(rect.x, 3),
        y: roundMm(rect.y + cand.h + kerfMm, 3),
        w: roundMm(cand.w, 3),
        h: roundMm(remH, 3),
      });
    }
  }
}

function finalizeSheet(sheet: SheetState): NestingSheetResult {
  const sheetAreaMm2 = sheet.sheetWidthMm * sheet.sheetHeightMm;
  let usedAreaMm2 = 0;
  for (const p of sheet.placements) {
    usedAreaMm2 += p.widthMm * p.heightMm;
  }
  const clampedUsed = Math.min(sheetAreaMm2, usedAreaMm2);
  const wastePercent =
    sheetAreaMm2 > 0
      ? roundMm(((sheetAreaMm2 - clampedUsed) / sheetAreaMm2) * 100, 2)
      : 0;

  return {
    sheetIndex: sheet.sheetIndex,
    sheetWidthMm: sheet.sheetWidthMm,
    sheetHeightMm: sheet.sheetHeightMm,
    usedAreaMm2: roundMm(usedAreaMm2, 2),
    wastePercent,
    placements: sheet.placements,
    cutLines: sheet.cutLines,
  };
}

function pieceFitsUsableSheet(piece: NestingPieceInput, config: NestingConfig): boolean {
  const usableW = config.sheet.widthMm - config.trimLeftMm - config.trimRightMm;
  const usableH = config.sheet.heightMm - config.trimTopMm - config.trimBottomMm;
  if (usableW <= 0 || usableH <= 0) return false;
  if (piece.widthMm <= 0 || piece.heightMm <= 0) return false;

  if (piece.widthMm <= usableW + EPS && piece.heightMm <= usableH + EPS) {
    return true;
  }
  if (canRotatePiece(piece, config)) {
    return piece.heightMm <= usableW + EPS && piece.widthMm <= usableH + EPS;
  }
  return false;
}

function nestGroup(
  materialId: string,
  thicknessMm: number,
  pieces: NestingPieceInput[],
  config: NestingConfig
): NestingGroupResult {
  const sorted = [...pieces].sort((a, b) => {
    const maxA = Math.max(a.widthMm, a.heightMm);
    const maxB = Math.max(b.widthMm, b.heightMm);
    if (Math.abs(maxB - maxA) > EPS) return maxB - maxA;
    const areaA = a.widthMm * a.heightMm;
    const areaB = b.widthMm * b.heightMm;
    if (Math.abs(areaB - areaA) > EPS) return areaB - areaA;
    return a.id.localeCompare(b.id);
  });

  const sheets: SheetState[] = [];
  const unplacedPieceIds: string[] = [];
  const safeKerf = Math.max(0, config.kerfMm);

  for (const piece of sorted) {
    if (!pieceFitsUsableSheet(piece, config)) {
      unplacedPieceIds.push(piece.id);
      continue;
    }

    let best = findBestPlacement(piece, sheets, config);
    if (!best) {
      const nextSheet = createSheet(sheets.length, config);
      sheets.push(nextSheet);
      best = findBestPlacement(piece, [nextSheet], config);
      if (best) {
        best = { ...best, sheetIdx: sheets.length - 1 };
      }
    }

    if (!best) {
      unplacedPieceIds.push(piece.id);
      continue;
    }

    applyPlacement(sheets[best.sheetIdx], piece, best, safeKerf);
  }

  const finalizedSheets = sheets.map(finalizeSheet);
  const singleSheetAreaMm2 = config.sheet.widthMm * config.sheet.heightMm;
  const totalSheetAreaMm2 = finalizedSheets.length * singleSheetAreaMm2;
  const totalUsedMm2 = finalizedSheets.reduce((acc, s) => acc + s.usedAreaMm2, 0);
  const totalWastePercent =
    totalSheetAreaMm2 > 0
      ? roundMm(((totalSheetAreaMm2 - Math.min(totalSheetAreaMm2, totalUsedMm2)) / totalSheetAreaMm2) * 100, 2)
      : 0;

  return {
    materialId,
    thicknessMm,
    sheets: finalizedSheets,
    unplacedPieceIds,
    totalPieces: pieces.length,
    totalWastePercent,
    totalSheetAreaM2: roundMm(totalSheetAreaMm2 / 1_000_000, 4),
  };
}

export function runGuillotineNesting(
  pieces: NestingPieceInput[],
  config: NestingConfig
): NestingRunResult {
  const sanitizedConfig: NestingConfig = {
    ...config,
    kerfMm: Math.max(0, config.kerfMm),
    trimTopMm: Math.max(0, config.trimTopMm),
    trimBottomMm: Math.max(0, config.trimBottomMm),
    trimLeftMm: Math.max(0, config.trimLeftMm),
    trimRightMm: Math.max(0, config.trimRightMm),
    sheet: {
      ...config.sheet,
      widthMm: Math.max(100, config.sheet.widthMm),
      heightMm: Math.max(100, config.sheet.heightMm),
    },
  };

  const groupMap = new Map<string, { materialId: string; thicknessMm: number; pieces: NestingPieceInput[] }>();

  for (const piece of pieces) {
    const key = `${piece.materialId}::${piece.thicknessMm}`;
    let entry = groupMap.get(key);
    if (!entry) {
      entry = {
        materialId: piece.materialId,
        thicknessMm: piece.thicknessMm,
        pieces: [],
      };
      groupMap.set(key, entry);
    }
    entry.pieces.push(piece);
  }

  const sortedKeys = Array.from(groupMap.keys()).sort();
  const groups: NestingGroupResult[] = sortedKeys.map((key) => {
    const entry = groupMap.get(key)!;
    return nestGroup(entry.materialId, entry.thicknessMm, entry.pieces, sanitizedConfig);
  });

  const totalSheets = groups.reduce((acc, g) => acc + g.sheets.length, 0);
  const unplacedCount = groups.reduce((acc, g) => acc + g.unplacedPieceIds.length, 0);
  const singleSheetAreaMm2 = sanitizedConfig.sheet.widthMm * sanitizedConfig.sheet.heightMm;
  const totalSheetAreaMm2 = totalSheets * singleSheetAreaMm2;
  const totalUsedMm2 = groups.reduce(
    (acc, g) => acc + g.sheets.reduce((sAcc, s) => sAcc + s.usedAreaMm2, 0),
    0
  );
  const overallWastePercent =
    totalSheetAreaMm2 > 0
      ? roundMm(((totalSheetAreaMm2 - Math.min(totalSheetAreaMm2, totalUsedMm2)) / totalSheetAreaMm2) * 100, 2)
      : 0;

  return {
    config: sanitizedConfig,
    groups,
    totalSheets,
    overallWastePercent,
    unplacedCount,
  };
}
