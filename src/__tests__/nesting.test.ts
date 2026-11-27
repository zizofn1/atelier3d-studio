import { describe, expect, it } from 'vitest';
import type { NestingConfig, NestingPieceInput } from '@/types';
import { DEFAULT_NESTING_CONFIG, STANDARD_SHEET_PRESETS } from '@/data/defaultPricing';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { buildCutlist, cutlistToNestingPieces } from '@/engine/devis';
import { runGuillotineNesting, verifyNestingResult } from '@/engine/nesting';

function makePiece(
  id: string,
  widthMm: number,
  heightMm: number,
  overrides: Partial<NestingPieceInput> = {}
): NestingPieceInput {
  return {
    id,
    moduleRef: 'M01',
    partNameFr: `Pièce ${id}`,
    materialId: 'chene-naturel',
    thicknessMm: 18,
    widthMm,
    heightMm,
    grain: 'H',
    edges: { top: '0.4', bottom: 'none', left: 'none', right: 'none' },
    ...overrides,
  };
}

describe('Optimiseur de découpe 2D Guillotine (Nesting invariants)', () => {
  it('respects sheet bounds, edge trim, saw kerf, and zero overlaps on standard 2800x2070', () => {
    const pieces: NestingPieceInput[] = [
      makePiece('P1', 1200, 700),
      makePiece('P2', 1200, 700),
      makePiece('P3', 900, 600),
      makePiece('P4', 900, 600),
      makePiece('P5', 600, 500),
      makePiece('P6', 600, 500),
      makePiece('P7', 800, 400),
    ];

    const config: NestingConfig = {
      ...DEFAULT_NESTING_CONFIG,
      kerfMm: 4,
      trimTopMm: 15,
      trimBottomMm: 15,
      trimLeftMm: 15,
      trimRightMm: 15,
      respectGrain: true,
    };

    const result = runGuillotineNesting(pieces, config);
    const report = verifyNestingResult(result, config, pieces);

    expect(report.errorsFr).toEqual([]);
    expect(report.ok).toBe(true);
    expect(result.unplacedCount).toBe(0);
    expect(result.totalSheets).toBeGreaterThanOrEqual(1);
  });

  it('never rotates grain-locked pieces 90° when respectGrain is true, but allows rotation when false or grain is none', () => {
    // Sheet usable area: 1000 - 20 = 980 wide x 600 - 20 = 580 high
    // Piece is 500 x 800 -> fits ONLY if rotated 90° to 800 x 500!
    const customConfig: NestingConfig = {
      sheet: { id: 'custom', labelFr: 'Test 1000x600', widthMm: 1000, heightMm: 600, isCustom: true },
      kerfMm: 4,
      trimTopMm: 10,
      trimBottomMm: 10,
      trimLeftMm: 10,
      trimRightMm: 10,
      respectGrain: true,
    };

    const grainLocked = [makePiece('G1', 500, 800, { grain: 'H' })];
    const lockedRes = runGuillotineNesting(grainLocked, customConfig);
    expect(lockedRes.unplacedCount).toBe(1);
    expect(verifyNestingResult(lockedRes, customConfig, grainLocked).ok).toBe(true);

    // Same piece with grain: 'none' rotates and fits!
    const grainFree = [makePiece('G2', 500, 800, { grain: 'none' })];
    const freeRes = runGuillotineNesting(grainFree, customConfig);
    expect(freeRes.unplacedCount).toBe(0);
    expect(freeRes.groups[0].sheets[0].placements[0].rotated).toBe(true);
    expect(verifyNestingResult(freeRes, customConfig, grainFree).ok).toBe(true);

    // Same grain piece with respectGrain: false rotates and fits!
    const unlockedConfig: NestingConfig = { ...customConfig, respectGrain: false };
    const unlockedRes = runGuillotineNesting(grainLocked, unlockedConfig);
    expect(unlockedRes.unplacedCount).toBe(0);
    expect(unlockedRes.groups[0].sheets[0].placements[0].rotated).toBe(true);
    expect(verifyNestingResult(unlockedRes, unlockedConfig, grainLocked).ok).toBe(true);
  });

  it('computes exact waste percentage on a hand-calculated single-sheet case', () => {
    const config: NestingConfig = {
      sheet: { id: 'custom', labelFr: '1000x1000', widthMm: 1000, heightMm: 1000, isCustom: true },
      kerfMm: 4,
      trimTopMm: 0,
      trimBottomMm: 0,
      trimLeftMm: 0,
      trimRightMm: 0,
      respectGrain: true,
    };

    // Two pieces of 500 x 400 -> total used = 400,000 mm² out of 1,000,000 mm² -> 60% waste
    const pieces = [makePiece('A', 500, 400), makePiece('B', 500, 400)];
    const res = runGuillotineNesting(pieces, config);

    expect(res.totalSheets).toBe(1);
    expect(res.groups[0].sheets[0].usedAreaMm2).toBe(400_000);
    expect(res.groups[0].sheets[0].wastePercent).toBe(60);
    expect(res.overallWastePercent).toBe(60);
    expect(verifyNestingResult(res, config, pieces).ok).toBe(true);
  });

  it('handles multi-sheet allocation and oversized unplaced pieces gracefully', () => {
    const config: NestingConfig = {
      sheet: STANDARD_SHEET_PRESETS[1], // 2440 x 1220
      kerfMm: 4,
      trimTopMm: 10,
      trimBottomMm: 10,
      trimLeftMm: 10,
      trimRightMm: 10,
      respectGrain: true,
    };

    const pieces = [
      makePiece('BIG1', 1100, 1100),
      makePiece('BIG2', 1100, 1100),
      makePiece('BIG3', 1100, 1100),
      makePiece('HUGE', 3000, 1000), // exceeds 2420 usable width
    ];

    const res = runGuillotineNesting(pieces, config);
    expect(res.totalSheets).toBe(2);
    expect(res.unplacedCount).toBe(1);
    expect(res.groups[0].unplacedPieceIds).toEqual(['HUGE']);
    expect(verifyNestingResult(res, config, pieces).ok).toBe(true);
  });

  it('is 100% deterministic and passes all invariants on Cuisine en L & Dressing templates', () => {
    const cuisine = createCuisineEnLTemplate();
    const cuisinePieces = cutlistToNestingPieces(buildCutlist(cuisine));
    const res1 = runGuillotineNesting(cuisinePieces, DEFAULT_NESTING_CONFIG);
    const res2 = runGuillotineNesting(cuisinePieces, DEFAULT_NESTING_CONFIG);

    expect(res1).toEqual(res2);
    expect(res1.totalSheets).toBeGreaterThan(0);
    const reportCuisine = verifyNestingResult(res1, DEFAULT_NESTING_CONFIG, cuisinePieces);
    expect(reportCuisine.errorsFr).toEqual([]);
    expect(reportCuisine.ok).toBe(true);

    const dressing = createDressingSurMesureTemplate();
    const dressingPieces = cutlistToNestingPieces(buildCutlist(dressing));
    const resDressing = runGuillotineNesting(dressingPieces, DEFAULT_NESTING_CONFIG);
    const reportDressing = verifyNestingResult(
      resDressing,
      DEFAULT_NESTING_CONFIG,
      dressingPieces
    );
    expect(reportDressing.errorsFr).toEqual([]);
    expect(reportDressing.ok).toBe(true);
  });
});
