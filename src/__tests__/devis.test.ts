import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CARPENTRY_PARAMS,
  DEFAULT_NESTING_CONFIG,
  createDefaultPricing,
} from '@/data/defaultPricing';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import {
  buildCutlist,
  buildCutlistCsv,
  buildHardwareBom,
  computeDevisSummary,
  cutlistToNestingPieces,
} from '@/engine/devis';
import { runGuillotineNesting } from '@/engine/nesting';
import type { ProjectDocument } from '@/types';
import { roundCurrency } from '@/utils/currency';

function makeMinimalSingleModuleProject(): ProjectDocument {
  const now = new Date().toISOString();
  const pricing = createDefaultPricing('MAD');
  pricing.laborPercent = 20;
  pricing.marginPercent = 10;
  pricing.tvaPercent = 20;
  pricing.materialPriceOverrides = {
    'blanc-alpin': 200,
    'chene-naturel': 300,
  };
  pricing.edgeBandingPricesPerMeter = {
    '0.4': 5,
    '2': 10,
  };

  return {
    id: 'test-devis-1',
    schemaVersion: 1,
    name: 'Test Devis',
    createdAt: now,
    updatedAt: now,
    ceilingHeightMm: 2500,
    floorMaterialId: 'carrelage-gres',
    defaultCarpentry: { ...DEFAULT_CARPENTRY_PARAMS },
    walls: [],
    openings: [],
    utilities: [],
    modules: [
      {
        id: 'm1',
        ref: 'M01',
        type: 'caisson_bas',
        nameFr: 'Caisson bas 800',
        xMm: 400,
        yMm: 0,
        zMm: 300,
        rotationYRad: 0,
        widthMm: 800,
        heightMm: 860,
        depthMm: 600,
        doorCount: 2,
        drawerCount: 0,
        shelfCount: 1,
        hasPlinth: true,
      },
    ],
    pricing,
    nestingConfig: { ...DEFAULT_NESTING_CONFIG },
  };
}

describe('Fiche de débit, Quincaillerie BOM & Devis Automatique', () => {
  it('builds a valid UTF-8 BOM French semicolon CSV from cutlist items', () => {
    const project = createCuisineEnLTemplate();
    const cutlist = buildCutlist(project);
    expect(cutlist.length).toBeGreaterThan(20);

    const csv = buildCutlistCsv(cutlist);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    expect(lines.length).toBe(cutlist.length + 1);
    expect(lines[0]).toContain('Repère;Module;Désignation;Matériau;Longueur (mm);Largeur (mm);Épaisseur (mm)');
    expect(lines[0]).toContain('Sens du fil;Chant haut;Chant bas;Chant gauche;Chant droit');
  });

  it('computes exact Devis subtotals, labor, margin, TVA and TTC matching hand formulas', () => {
    const doc = makeMinimalSingleModuleProject();
    const cutlist = buildCutlist(doc);
    const nesting = runGuillotineNesting(cutlistToNestingPieces(cutlist), doc.nestingConfig!);
    const devis = computeDevisSummary(doc, nesting, cutlist);

    // Every material group is billed by full sheets
    const singleSheetAreaM2 =
      (DEFAULT_NESTING_CONFIG.sheet.widthMm * DEFAULT_NESTING_CONFIG.sheet.heightMm) / 1_000_000;
    for (const line of devis.materialLines) {
      expect(line.sheetAreaM2).toBeCloseTo(line.sheetsCount * singleSheetAreaM2, 2);
      expect(line.totalPrice).toBeCloseTo(
        roundCurrency(line.sheetAreaM2 * line.unitPricePerM2),
        2
      );
    }

    // Check edge banding linear meters > 0 for both 0.4 and 2 mm (carcass + doors)
    expect(devis.edgeBandingLines.some((e) => e.code === '0.4' && e.linearMeters > 0)).toBe(true);
    expect(devis.edgeBandingLines.some((e) => e.code === '2' && e.linearMeters > 0)).toBe(true);

    // Check hardware BOM includes hinges, handles, adjustable feet, shelf pegs
    const kinds = new Set(devis.hardwareItems.map((h) => h.kind));
    expect(kinds.has('charniere')).toBe(true);
    expect(kinds.has('poignee')).toBe(true);
    expect(kinds.has('pied_reglable')).toBe(true);
    expect(kinds.has('taquet')).toBe(true);

    // Exact arithmetic consistency
    const expectedSupply = roundCurrency(
      devis.materialsSubtotal + devis.edgeBandingSubtotal + devis.hardwareSubtotal
    );
    expect(devis.supplySubtotal).toBe(expectedSupply);

    const expectedLabor = roundCurrency(expectedSupply * 0.2);
    expect(devis.laborAmount).toBe(expectedLabor);

    const expectedMargin = roundCurrency((expectedSupply + expectedLabor) * 0.1);
    expect(devis.marginAmount).toBe(expectedMargin);

    const expectedHT = roundCurrency(expectedSupply + expectedLabor + expectedMargin);
    expect(devis.totalHT).toBe(expectedHT);

    const expectedTVA = roundCurrency(expectedHT * 0.2);
    expect(devis.tvaAmount).toBe(expectedTVA);

    expect(devis.totalTTC).toBe(roundCurrency(expectedHT + expectedTVA));
  });

  it('aggregates hardware BOM accurately across Cuisine en L template', () => {
    const cuisine = createCuisineEnLTemplate();
    const bom = buildHardwareBom(cuisine);
    const byKind = new Map(bom.map((b) => [b.kind, b]));

    expect(byKind.get('charniere')?.quantity).toBeGreaterThanOrEqual(20);
    expect(byKind.get('coulisse')?.quantity).toBeGreaterThanOrEqual(6);
    expect(byKind.get('pied_reglable')?.quantity).toBeGreaterThanOrEqual(24);
    expect(byKind.get('suspension_murale')?.quantity).toBeGreaterThanOrEqual(4);
  });
});
