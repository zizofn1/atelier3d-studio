import autoTable from 'jspdf-autotable';
import type { DevisSummary, ProjectDocument } from '@/types';
import { formatCurrency } from '@/utils/currency';
import { PDF_FONT_FAMILY } from './fontLoader';
import {
  createFrenchPdfDocument,
  drawPdfFooters,
  drawPdfHeader,
  formatFrenchDate,
  pdfToBlob,
} from './pdfBase';

function fmtPdfMoney(amount: number, currency: DevisSummary['currency']): string {
  // Replace narrow no-break spaces with regular spaces for crisp PDF font rendering
  return formatCurrency(amount, currency).replace(/[\u202f\u00a0]/g, ' ');
}

export async function generateDevisPdfBlob(
  project: ProjectDocument,
  devis: DevisSummary
): Promise<Blob> {
  const doc = await createFrenchPdfDocument('portrait');
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  const pricing = project.pricing;
  const currency = devis.currency;

  const startY = drawPdfHeader(doc, {
    titleFr: `DEVIS N° ${pricing.quoteReference || 'DEV-001'}`,
    subtitleFr: `Validité ${pricing.validityDays} jours`,
    project,
  });

  // Company & Client boxes
  const boxW = (pageWidth - margin * 2 - 6) / 2;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, startY, boxW, 28, 2, 2, 'FD');
  doc.roundedRect(margin + boxW + 6, startY, boxW, 28, 2, 2, 'FD');

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(180, 83, 9);
  doc.text('ATELIER / ÉMETTEUR', margin + 3, startY + 5.5);
  doc.text('CLIENT / DESTINATAIRE', margin + boxW + 9, startY + 5.5);

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(pricing.company.name || 'Atelier Menuiserie', margin + 3, startY + 11);
  doc.text(pricing.client.name || 'Client', margin + boxW + 9, startY + 11);

  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(pricing.company.address || '', margin + 3, startY + 15.5, { maxWidth: boxW - 6 });
  doc.text(
    `${pricing.company.phone || ''} · ${pricing.company.email || ''}`,
    margin + 3,
    startY + 21.5
  );
  doc.text(pricing.company.taxId || '', margin + 3, startY + 25.5);

  doc.text(pricing.client.address || '', margin + boxW + 9, startY + 15.5, {
    maxWidth: boxW - 6,
  });
  doc.text(
    `${pricing.client.phone || ''} · ${pricing.client.email || ''}`,
    margin + boxW + 9,
    startY + 21.5
  );
  doc.text(`Date d'émission : ${formatFrenchDate()}`, margin + boxW + 9, startY + 25.5);

  let cursorY = startY + 34;

  // 1. Panneaux (Feuilles pleines calepinées)
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { font: PDF_FONT_FAMILY, fontSize: 7.8, cellPadding: 2, textColor: [15, 23, 42] },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: 'bold',
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
    },
    head: [
      [
        'Panneaux (feuilles calepinées)',
        'Ép.',
        'Feuilles',
        'Surf. facturée',
        'Chute',
        'P.U. / m²',
        'Total HT',
      ],
    ],
    body:
      devis.materialLines.length > 0
        ? devis.materialLines.map((m) => [
            (m.unplacedCount ?? 0) > 0
              ? `${m.materialNameFr} (${m.unplacedCount} hors-format +15%)`
              : m.materialNameFr,
            `${m.thicknessMm} mm`,
            String(m.sheetsCount),
            `${m.sheetAreaM2.toFixed(2).replace('.', ',')} m²`,
            `${m.wastePercent.toFixed(1).replace('.', ',')} %`,
            fmtPdfMoney(m.unitPricePerM2, currency),
            fmtPdfMoney(m.totalPrice, currency),
          ])
        : [['Aucun panneau', '—', '0', '0 m²', '0 %', fmtPdfMoney(0, currency), fmtPdfMoney(0, currency)]],
  });

  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 24;
  cursorY += 5;

  // 2. Bandes de chant
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { font: PDF_FONT_FAMILY, fontSize: 7.8, cellPadding: 2, textColor: [15, 23, 42] },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: 'bold',
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
    },
    head: [['Bandes de chant', 'Métrage linéaire', 'P.U. / ml', 'Total HT']],
    body:
      devis.edgeBandingLines.length > 0
        ? devis.edgeBandingLines.map((e) => [
            e.labelFr,
            `${e.linearMeters.toFixed(2).replace('.', ',')} ml`,
            fmtPdfMoney(e.unitPricePerMeter, currency),
            fmtPdfMoney(e.totalPrice, currency),
          ])
        : [['Aucune bande de chant', '0 ml', fmtPdfMoney(0, currency), fmtPdfMoney(0, currency)]],
  });

  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 20;
  cursorY += 5;

  // 3. Quincaillerie BOM
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 16 },
    styles: { font: PDF_FONT_FAMILY, fontSize: 7.8, cellPadding: 2, textColor: [15, 23, 42] },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: 'bold',
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
    },
    head: [['Quincaillerie (Nomenclature BOM)', 'Quantité', 'Unité', 'P.U.', 'Total HT']],
    body:
      devis.hardwareItems.length > 0
        ? devis.hardwareItems.map((h) => [
            h.labelFr,
            String(h.quantity),
            h.unitFr,
            fmtPdfMoney(h.unitPrice, currency),
            fmtPdfMoney(h.totalPrice, currency),
          ])
        : [['Aucune quincaillerie', '0', '—', fmtPdfMoney(0, currency), fmtPdfMoney(0, currency)]],
  });

  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 20;
  cursorY += 6;

  // Totals block
  const summaryRows = [
    ['Sous-total Panneaux', fmtPdfMoney(devis.materialsSubtotal, currency)],
    ['Sous-total Bandes de chant', fmtPdfMoney(devis.edgeBandingSubtotal, currency)],
    ['Sous-total Quincaillerie', fmtPdfMoney(devis.hardwareSubtotal, currency)],
    ['Sous-total Fournitures', fmtPdfMoney(devis.supplySubtotal, currency)],
    [`Main-d'œuvre (${pricing.laborPercent} %)`, fmtPdfMoney(devis.laborAmount, currency)],
    [`Marge atelier (${pricing.marginPercent} %)`, fmtPdfMoney(devis.marginAmount, currency)],
    ['Total HT', fmtPdfMoney(devis.totalHT, currency)],
    [`TVA (${pricing.tvaPercent} %)`, fmtPdfMoney(devis.tvaAmount, currency)],
    ['Total TTC', fmtPdfMoney(devis.totalTTC, currency)],
  ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: pageWidth - margin - 88, right: margin, bottom: 18 },
    styles: { font: PDF_FONT_FAMILY, fontSize: 8.2, cellPadding: 2, textColor: [15, 23, 42] },
    columnStyles: {
      0: { fontStyle: 'normal', cellWidth: 50 },
      1: { halign: 'right', fontStyle: 'bold', cellWidth: 38 },
    },
    body: summaryRows,
    didParseCell(data) {
      if (data.row.index === summaryRows.length - 1) {
        data.cell.styles.fillColor = [15, 23, 42];
        data.cell.styles.textColor = [251, 191, 36];
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fontSize = 9.5;
      } else if (data.row.index === summaryRows.length - 3) {
        data.cell.styles.fillColor = [241, 245, 249];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  const obsParts: string[] = [];
  if ((devis.unplacedPiecesCount ?? 0) > 0) {
    obsParts.push(
      `Note : ${devis.unplacedPiecesCount} pièce(s) hors-format feuille standard facturée(s) en surface nette majorée de 15 %.`
    );
  }
  if (pricing.notesFr) obsParts.push(pricing.notesFr);

  if (obsParts.length > 0) {
    const finalY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      cursorY + 55;
    if (finalY < doc.internal.pageSize.getHeight() - 25) {
      doc.setFont(PDF_FONT_FAMILY, 'normal');
      doc.setFontSize(7.8);
      doc.setTextColor(71, 85, 105);
      doc.text(`Observations : ${obsParts.join(' ')}`, margin, finalY + 7, {
        maxWidth: pageWidth - margin * 2,
      });
    }
  }

  drawPdfFooters(doc, project.name);
  return pdfToBlob(doc);
}
