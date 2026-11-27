import type { NestingRunResult, ProjectDocument } from '@/types';
import { getMaterialById } from '@/data/materialsCatalog';
import { PDF_FONT_FAMILY } from './fontLoader';
import { createFrenchPdfDocument, drawPdfFooters, drawPdfHeader, pdfToBlob } from './pdfBase';

export async function generateNestingPdfBlob(
  project: ProjectDocument,
  nesting: NestingRunResult
): Promise<Blob> {
  const doc = await createFrenchPdfDocument('landscape');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  const allSheets: Array<{
    materialNameFr: string;
    thicknessMm: number;
    sheetNumInGroup: number;
    groupSheetCount: number;
    sheet: NestingRunResult['groups'][number]['sheets'][number];
  }> = [];

  for (const g of nesting.groups) {
    const mat = getMaterialById(g.materialId);
    g.sheets.forEach((sheet, idx) => {
      allSheets.push({
        materialNameFr: mat.nameFr,
        thicknessMm: g.thicknessMm,
        sheetNumInGroup: idx + 1,
        groupSheetCount: g.sheets.length,
        sheet,
      });
    });
  }

  if (allSheets.length === 0) {
    const startY = drawPdfHeader(doc, {
      titleFr: 'Calepinage 2D (Découpe guillotine)',
      subtitleFr: '0 feuille',
      project,
    });
    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setFontSize(10);
    doc.text('Aucune pièce à calepiner pour ce projet.', margin, startY + 8);
    drawPdfFooters(doc, project.name);
    return pdfToBlob(doc);
  }

  const cfg = nesting.config;

  allSheets.forEach((entry, globalIdx) => {
    if (globalIdx > 0) {
      doc.addPage('a4', 'landscape');
    }

    const startY = drawPdfHeader(doc, {
      titleFr: 'Calepinage 2D — Plan de découpe',
      subtitleFr: `Feuille ${globalIdx + 1} / ${allSheets.length}`,
      project,
    });

    const { sheet } = entry;
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(
      `${entry.materialNameFr} — Ép. ${entry.thicknessMm} mm (Feuille ${entry.sheetNumInGroup}/${entry.groupSheetCount})`,
      margin,
      startY
    );

    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    doc.text(
      `Format : ${sheet.sheetWidthMm} × ${sheet.sheetHeightMm} mm  |  Trait de scie : ${cfg.kerfMm} mm  |  Délignage : ${cfg.trimLeftMm}/${cfg.trimTopMm}/${cfg.trimRightMm}/${cfg.trimBottomMm} mm  |  Sens du fil : ${cfg.respectGrain ? 'Verrouillé' : 'Libre'}  |  Taux de chute : ${sheet.wastePercent.toFixed(1).replace('.', ',')} %`,
      margin,
      startY + 5
    );

    const drawTop = startY + 10;
    const availW = pageWidth - margin * 2;
    const availH = pageHeight - drawTop - 18;
    const scale = Math.min(availW / sheet.sheetWidthMm, availH / sheet.sheetHeightMm);
    const drawW = sheet.sheetWidthMm * scale;
    const drawH = sheet.sheetHeightMm * scale;
    const ox = margin + (availW - drawW) / 2;
    const oy = drawTop + (availH - drawH) / 2;

    // Sheet background (waste area)
    doc.setFillColor(241, 245, 249);
    doc.setDrawColor(51, 65, 85);
    doc.setLineWidth(0.5);
    doc.rect(ox, oy, drawW, drawH, 'FD');

    // Usable inner trim zone
    const ux = ox + cfg.trimLeftMm * scale;
    const uy = oy + cfg.trimTopMm * scale;
    const uw = (sheet.sheetWidthMm - cfg.trimLeftMm - cfg.trimRightMm) * scale;
    const uh = (sheet.sheetHeightMm - cfg.trimTopMm - cfg.trimBottomMm) * scale;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.2);
    doc.rect(ux, uy, uw, uh, 'S');

    // Guillotine cut lines
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(0.2);
    for (const cut of sheet.cutLines) {
      if (cut.orientation === 'H') {
        const y = oy + cut.coordMm * scale;
        doc.line(ox + cut.startMm * scale, y, ox + cut.endMm * scale, y);
      } else {
        const x = ox + cut.coordMm * scale;
        doc.line(x, oy + cut.startMm * scale, x, oy + cut.endMm * scale);
      }
    }

    // Placed pieces
    for (const p of sheet.placements) {
      const px = ox + p.xMm * scale;
      const py = oy + p.yMm * scale;
      const pw = p.widthMm * scale;
      const ph = p.heightMm * scale;

      doc.setFillColor(254, 243, 199);
      doc.setDrawColor(180, 83, 9);
      doc.setLineWidth(0.35);
      doc.rect(px, py, pw, ph, 'FD');

      // Edge-banding marks (thick dark blue for 2mm, amber for 0.4mm)
      const drawEdgeMark = (code: string, x1: number, y1: number, x2: number, y2: number) => {
        if (code === 'none') return;
        if (code === '2') {
          doc.setDrawColor(37, 99, 235);
          doc.setLineWidth(0.9);
        } else {
          doc.setDrawColor(16, 185, 129);
          doc.setLineWidth(0.5);
        }
        doc.line(x1, y1, x2, y2);
      };

      const inset = Math.min(1.2, pw * 0.1, ph * 0.1);
      drawEdgeMark(p.edges.top, px + inset, py + inset, px + pw - inset, py + inset);
      drawEdgeMark(p.edges.bottom, px + inset, py + ph - inset, px + pw - inset, py + ph - inset);
      drawEdgeMark(p.edges.left, px + inset, py + inset, px + inset, py + ph - inset);
      drawEdgeMark(p.edges.right, px + pw - inset, py + inset, px + pw - inset, py + ph - inset);

      if (pw >= 14 && ph >= 7) {
        doc.setFont(PDF_FONT_FAMILY, 'bold');
        doc.setFontSize(Math.min(7.5, Math.max(5, Math.min(pw / 6, ph / 2.2))));
        doc.setTextColor(15, 23, 42);
        const label = `${p.moduleRef} ${p.partNameFr}`.slice(0, Math.max(6, Math.floor(pw / 2)));
        doc.text(label, px + pw / 2, py + ph / 2 - 1, { align: 'center' });

        if (ph >= 11) {
          doc.setFont(PDF_FONT_FAMILY, 'normal');
          doc.setFontSize(Math.min(6.5, Math.max(4.5, ph / 3)));
          doc.setTextColor(71, 85, 105);
          doc.text(
            `${Math.round(p.widthMm)}×${Math.round(p.heightMm)}${p.rotated ? ' (90°)' : ''}`,
            px + pw / 2,
            py + ph / 2 + 2.6,
            { align: 'center' }
          );
        }
      }
    }
  });

  drawPdfFooters(doc, project.name);
  return pdfToBlob(doc);
}
