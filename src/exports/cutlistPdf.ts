import autoTable from 'jspdf-autotable';
import type { CutlistItem, ProjectDocument } from '@/types';
import { formatEdgeSummaryCode } from '@/engine/devis';
import { FR } from '@/i18n/fr';
import { roundMm } from '@/utils/units';
import { PDF_FONT_FAMILY } from './fontLoader';
import { createFrenchPdfDocument, drawPdfFooters, drawPdfHeader, pdfToBlob } from './pdfBase';

export async function generateCutlistPdfBlob(
  project: ProjectDocument,
  items: CutlistItem[]
): Promise<Blob> {
  const doc = await createFrenchPdfDocument('landscape');
  const startY = drawPdfHeader(doc, {
    titleFr: 'Fiche de débit atelier',
    subtitleFr: `${items.length} pièces`,
    project,
  });

  const totalArea = roundMm(
    items.reduce((acc, i) => acc + i.areaM2 * i.quantity, 0),
    2
  );
  const totalEdgeM = roundMm(
    items.reduce((acc, i) => acc + i.edgeLengthM * i.quantity, 0),
    2
  );

  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Surface nette totale : ${totalArea.toFixed(2).replace('.', ',')} m²   |   Chants cumulés : ${totalEdgeM.toFixed(2).replace('.', ',')} ml   |   Modules : ${project.modules.length}`,
    12,
    startY
  );

  const body =
    items.length > 0
      ? items.map((item) => [
          item.id,
          `${item.moduleRef} (${item.moduleNameFr})`,
          item.partNameFr,
          item.materialNameFr,
          String(roundMm(item.lengthMm, 1)),
          String(roundMm(item.widthMm, 1)),
          String(roundMm(item.thicknessMm, 1)),
          String(item.quantity),
          FR.carpentry.grainDirections[item.grain],
          formatEdgeSummaryCode(item.edges),
        ])
      : [['—', '—', 'Aucune pièce dans le projet', '—', '0', '0', '0', '0', '—', '—']];

  autoTable(doc, {
    startY: startY + 4,
    margin: { left: 12, right: 12, bottom: 16 },
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 7.5,
      cellPadding: 1.8,
      textColor: [15, 23, 42],
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: 'bold',
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    head: [
      [
        'Repère',
        'Module',
        'Désignation',
        'Matériau',
        'Long. (mm)',
        'Larg. (mm)',
        'Ép. (mm)',
        'Qté',
        'Sens du fil',
        'Chants (H/B/G/D)',
      ],
    ],
    body,
  });

  drawPdfFooters(doc, project.name);
  return pdfToBlob(doc);
}
