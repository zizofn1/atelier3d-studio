import type {
  CutlistItem,
  DevisSummary,
  EdgeBandingDevisLine,
  MaterialDevisLine,
  NestingRunResult,
  ProjectDocument,
} from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
import { roundCurrency } from '@/utils/currency';
import { roundMm } from '@/utils/units';
import { computePanelEdgeLengthsMm, cutlistToNestingPieces } from './cutlist';
import { buildHardwareBom } from './hardwareBom';

const OVERSIZED_WASTE_MULTIPLIER = 1.15;

export function resolveMaterialPricePerM2(
  doc: ProjectDocument,
  materialId: string
): number {
  const override = doc.pricing.materialPriceOverrides[materialId];
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return roundCurrency(override);
  }
  const mat = getMaterialById(materialId);
  return roundCurrency(mat.pricePerM2[doc.pricing.currency] ?? 0);
}

/**
 * Compute full commercial quote summary (DevisSummary):
 * - Board material costs are billed by FULL sheets required by the 2D nesting optimizer
 *   (sheetsCount * sheetAreaM2 * unitPricePerM2).
 * - Edge banding is aggregated in linear meters (ml) separately for 0.4 mm and 2 mm codes.
 * - Hardware BOM is aggregated across all placed modules.
 * - Labor (main-d'œuvre) is applied on supplySubtotal; margin (marge) is applied on (supplySubtotal + laborAmount);
 *   totalHT = supplySubtotal + laborAmount + marginAmount; TVA is applied on totalHT.
 */
export function computeDevisSummary(
  doc: ProjectDocument,
  nesting: NestingRunResult,
  cutlist: CutlistItem[]
): DevisSummary {
  const pricing = doc.pricing;
  const currency = pricing.currency;

  // Index individual nesting pieces by ID so oversized/unplaced pieces are NEVER billed at 0
  const piecesById = new Map(cutlistToNestingPieces(cutlist).map((p) => [p.id, p]));

  // 1. Material lines from nesting full sheets (+ net area × 1.15 for any oversized unplaced pieces)
  const materialLines: MaterialDevisLine[] = [];
  let totalUnplacedPieces = 0;
  for (const group of nesting.groups) {
    const mat = getMaterialById(group.materialId);
    const sheetsCount = group.sheets.length;
    const placedSheetAreaM2 = group.totalSheetAreaM2;
    const placedNetAreaMm2 = group.sheets.reduce((acc, s) => acc + s.usedAreaMm2, 0);

    let unplacedNetMm2 = 0;
    for (const unplacedId of group.unplacedPieceIds) {
      const piece = piecesById.get(unplacedId);
      if (piece) {
        unplacedNetMm2 += piece.widthMm * piece.heightMm;
      }
    }
    const unplacedCount = group.unplacedPieceIds.length;
    totalUnplacedPieces += unplacedCount;
    const unplacedNetAreaM2 = unplacedNetMm2 / 1_000_000;
    const unplacedBillableAreaM2 =
      unplacedCount > 0 ? roundMm(unplacedNetAreaM2 * OVERSIZED_WASTE_MULTIPLIER, 3) : 0;

    const billableAreaM2 = roundMm(placedSheetAreaM2 + unplacedBillableAreaM2, 3);
    const netAreaM2 = roundMm((placedNetAreaMm2 + unplacedNetMm2) / 1_000_000, 3);
    const unitPricePerM2 = resolveMaterialPricePerM2(doc, group.materialId);
    const totalPrice = roundCurrency(billableAreaM2 * unitPricePerM2);

    const effectiveWastePercent =
      billableAreaM2 > 0
        ? unplacedCount > 0
          ? roundMm(((billableAreaM2 - Math.min(billableAreaM2, netAreaM2)) / billableAreaM2) * 100, 2)
          : group.totalWastePercent
        : 0;

    materialLines.push({
      materialId: group.materialId,
      materialNameFr: mat.nameFr,
      thicknessMm: group.thicknessMm,
      sheetsCount,
      sheetAreaM2: billableAreaM2,
      netAreaM2,
      wastePercent: effectiveWastePercent,
      unitPricePerM2,
      totalPrice,
      ...(unplacedCount > 0
        ? { unplacedCount, unplacedBillableAreaM2 }
        : {}),
    });
  }

  // 2. Edge banding lines (ml)
  let total04Mm = 0;
  let total2Mm = 0;
  for (const item of cutlist) {
    const lens = computePanelEdgeLengthsMm(item.lengthMm, item.widthMm, item.edges);
    total04Mm += lens['0.4'] * item.quantity;
    total2Mm += lens['2'] * item.quantity;
  }

  const edgeBandingLines: EdgeBandingDevisLine[] = [];
  const ml04 = roundMm(total04Mm / 1000, 2);
  const ml2 = roundMm(total2Mm / 1000, 2);

  if (ml04 > 0) {
    const unit = roundCurrency(Math.max(0, pricing.edgeBandingPricesPerMeter['0.4'] ?? 0));
    edgeBandingLines.push({
      code: '0.4',
      labelFr: 'Bande de chant 0,4 mm',
      linearMeters: ml04,
      unitPricePerMeter: unit,
      totalPrice: roundCurrency(ml04 * unit),
    });
  }
  if (ml2 > 0) {
    const unit = roundCurrency(Math.max(0, pricing.edgeBandingPricesPerMeter['2'] ?? 0));
    edgeBandingLines.push({
      code: '2',
      labelFr: 'Bande de chant 2 mm',
      linearMeters: ml2,
      unitPricePerMeter: unit,
      totalPrice: roundCurrency(ml2 * unit),
    });
  }

  // 3. Hardware BOM
  const hardwareItems = buildHardwareBom(doc, pricing);

  // 4. Subtotals & commercial totals
  const materialsSubtotal = roundCurrency(
    materialLines.reduce((acc, l) => acc + l.totalPrice, 0)
  );
  const edgeBandingSubtotal = roundCurrency(
    edgeBandingLines.reduce((acc, l) => acc + l.totalPrice, 0)
  );
  const hardwareSubtotal = roundCurrency(
    hardwareItems.reduce((acc, h) => acc + h.totalPrice, 0)
  );

  const supplySubtotal = roundCurrency(
    materialsSubtotal + edgeBandingSubtotal + hardwareSubtotal
  );

  const laborPct = Math.max(0, pricing.laborPercent);
  const marginPct = Math.max(0, pricing.marginPercent);
  const tvaPct = Math.max(0, pricing.tvaPercent);

  const laborAmount = roundCurrency(supplySubtotal * (laborPct / 100));
  const marginAmount = roundCurrency((supplySubtotal + laborAmount) * (marginPct / 100));
  const totalHT = roundCurrency(supplySubtotal + laborAmount + marginAmount);
  const tvaAmount = roundCurrency(totalHT * (tvaPct / 100));
  const totalTTC = roundCurrency(totalHT + tvaAmount);

  return {
    currency,
    materialLines,
    edgeBandingLines,
    hardwareItems,
    materialsSubtotal,
    edgeBandingSubtotal,
    hardwareSubtotal,
    supplySubtotal,
    laborAmount,
    marginAmount,
    totalHT,
    tvaAmount,
    totalTTC,
    unplacedPiecesCount: totalUnplacedPieces,
  };
}
