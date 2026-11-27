import { jsPDF } from 'jspdf';
import type { ProjectDocument } from '@/types';
import { PDF_FONT_FAMILY, registerFrenchPdfFont } from './fontLoader';

export interface PdfHeaderOptions {
  titleFr: string;
  subtitleFr?: string;
  project: ProjectDocument;
  orientation?: 'portrait' | 'landscape';
}

export async function createFrenchPdfDocument(
  orientation: 'portrait' | 'landscape' = 'landscape'
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });
  await registerFrenchPdfFont(doc);
  return doc;
}

export function formatFrenchDate(isoOrDate: string | Date = new Date()): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return new Date().toLocaleDateString('fr-FR');
  }
  return d.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function drawPdfHeader(
  doc: jsPDF,
  opts: { titleFr: string; subtitleFr?: string; project: ProjectDocument }
): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 24, 'F');

  doc.setFillColor(245, 158, 11);
  doc.rect(0, 23, pageWidth, 1.2, 'F');

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text('Atelier3D Studio', margin, 10);

  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const companyLine = opts.project.pricing.company.name || 'Atelier Menuiserie';
  doc.text(`${companyLine} — Projet : ${opts.project.name}`, margin, 17);

  doc.setFont(PDF_FONT_FAMILY, 'bold');
  doc.setFontSize(12);
  doc.setTextColor(251, 191, 36);
  doc.text(opts.titleFr, pageWidth - margin, 10, { align: 'right' });

  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(203, 213, 225);
  const rightMeta = opts.subtitleFr
    ? `${opts.subtitleFr} · ${formatFrenchDate()}`
    : `Date : ${formatFrenchDate()}`;
  doc.text(rightMeta, pageWidth - margin, 17, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  return 30;
}

export function drawPdfFooters(doc: jsPDF, projectName: string): void {
  const totalPages = doc.getNumberOfPages();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.25);
    doc.line(margin, pageHeight - 11, pageWidth - margin, pageHeight - 11);

    doc.setFont(PDF_FONT_FAMILY, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `Atelier3D Studio · ${projectName} · Toutes cotes en millimètres (mm)`,
      margin,
      pageHeight - 6
    );
    doc.text(`Page ${i} / ${totalPages}`, pageWidth - margin, pageHeight - 6, {
      align: 'right',
    });
  }
}

export function pdfToBlob(doc: jsPDF): Blob {
  return doc.output('blob');
}
