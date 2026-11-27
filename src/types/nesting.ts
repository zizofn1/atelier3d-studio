import type { FourEdges } from './carpentry';
import type { GrainDirection } from './materials';

export interface SheetSpec {
  id: string;
  labelFr: string;
  widthMm: number;
  heightMm: number;
  isCustom?: boolean;
}

export interface NestingConfig {
  sheet: SheetSpec;
  kerfMm: number;
  trimTopMm: number;
  trimBottomMm: number;
  trimLeftMm: number;
  trimRightMm: number;
  respectGrain: boolean;
}

export interface NestingPieceInput {
  id: string;
  moduleRef: string;
  partNameFr: string;
  materialId: string;
  thicknessMm: number;
  widthMm: number;
  heightMm: number;
  grain: GrainDirection;
  edges: FourEdges;
}

export interface PlacedPiece {
  pieceId: string;
  moduleRef: string;
  partNameFr: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  rotated: boolean;
  grain: GrainDirection;
  edges: FourEdges;
}

export interface GuillotineCutLine {
  orientation: 'H' | 'V';
  coordMm: number;
  startMm: number;
  endMm: number;
}

export interface NestingSheetResult {
  sheetIndex: number;
  sheetWidthMm: number;
  sheetHeightMm: number;
  usedAreaMm2: number;
  wastePercent: number;
  placements: PlacedPiece[];
  cutLines: GuillotineCutLine[];
}

export interface NestingGroupResult {
  materialId: string;
  thicknessMm: number;
  sheets: NestingSheetResult[];
  unplacedPieceIds: string[];
  totalPieces: number;
  totalWastePercent: number;
  totalSheetAreaM2: number;
}

export interface NestingRunResult {
  config: NestingConfig;
  groups: NestingGroupResult[];
  totalSheets: number;
  overallWastePercent: number;
  unplacedCount: number;
}
