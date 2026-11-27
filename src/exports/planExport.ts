import type { jsPDF } from 'jspdf';
import type { DisplayUnit, ProjectDocument } from '@/types';
import { selectActiveWall } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { downloadTextFile, triggerBlobDownload } from '@/utils/download';
import {
  buildPlanDrawing2D,
  buildWallElevationDrawing2D,
  renderDrawing2DToSvg,
  type TechnicalDrawing2D,
} from './drawing2d';
import { PDF_FONT_FAMILY } from './fontLoader';

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  if (color.includes('217, 119, 6')) return [253, 230, 180];
  if (color.includes('251, 191, 36')) return [254, 243, 199];
  if (color.includes('56, 189, 248') || color.includes('186, 230, 253')) return [219, 234, 254];
  if (color.includes('254, 243, 199')) return [254, 243, 199];
  if (color.includes('51, 65, 85')) return [203, 213, 225];
  return [241, 245, 249];
}

function drawTechnicalDrawingOnPdfPage(
  doc: jsPDF,
  drawing: TechnicalDrawing2D,
  topY: number
): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - topY - 18;

  const vb = drawing.viewBox;
  const scale = Math.min(availW / vb.width, availH / vb.height);
  const drawW = vb.width * scale;
  const drawH = vb.height * scale;
  const ox = margin + (availW - drawW) / 2;
  const oy = topY + (availH - drawH) / 2;

  const mapX = (wx: number) => ox + (wx - vb.x) * scale;
  const mapY = (wy: number) => oy + (wy - vb.y) * scale;

  // Drawing frame
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(margin, topY, availW, availH, 'S');

  // Scale label
  const ratio = Math.max(1, Math.round(1 / scale));
  doc.setFont(PDF_FONT_FAMILY, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`Échelle approx. 1:${ratio} · ${drawing.subtitleFr}`, margin + 2, topY + 4.5);

  // Rectangles
  for (const r of drawing.rects) {
    const [fr, fg, fb] = hexToRgb(r.fill);
    const [sr, sg, sb] = hexToRgb(r.stroke);
    doc.setFillColor(fr, fg, fb);
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(Math.max(0.18, r.strokeWidth * scale));
    doc.rect(mapX(r.x), mapY(r.y), r.width * scale, r.height * scale, 'FD');
  }

  // Polygon paths (M x y L x y ... Z) and SVG door swing elliptical arcs (M x1 y1 A rx ry rot large sweep x2 y2)
  for (const p of drawing.paths) {
    const [sr, sg, sb] = hexToRgb(p.stroke);
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(Math.max(0.2, p.strokeWidth * scale));

    const arcMatch = p.d.match(
      /M\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+A\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+([01])\s+([01])\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/
    );
    if (arcMatch) {
      const x1 = Number(arcMatch[1]);
      const y1 = Number(arcMatch[2]);
      const rx = Math.max(1, Number(arcMatch[3]));
      const sweepFlag = Number(arcMatch[7]);
      const x2 = Number(arcMatch[8]);
      const y2 = Number(arcMatch[9]);
      // Quarter-circle center reconstruction from chord (x1,y1)->(x2,y2) with radius rx
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const chord = Math.hypot(dx, dy);
      if (chord > 1e-3) {
        const halfChord = chord / 2;
        const hDist = Math.sqrt(Math.max(0, rx * rx - halfChord * halfChord));
        const perpSign = sweepFlag === 1 ? 1 : -1;
        const cx = mx + perpSign * (-dy / chord) * hDist;
        const cy = my + perpSign * (dx / chord) * hDist;
        let a1 = Math.atan2(y1 - cy, x1 - cx);
        let a2 = Math.atan2(y2 - cy, x2 - cx);
        let delta = a2 - a1;
        if (sweepFlag === 1 && delta < 0) delta += Math.PI * 2;
        if (sweepFlag === 0 && delta > 0) delta -= Math.PI * 2;
        const steps = 14;
        if (p.dashed) doc.setLineDashPattern([1.2, 0.9], 0);
        let prevX = mapX(x1);
        let prevY = mapY(y1);
        for (let s = 1; s <= steps; s++) {
          const ang = a1 + (delta * s) / steps;
          const nx = mapX(cx + Math.cos(ang) * rx);
          const ny = mapY(cy + Math.sin(ang) * rx);
          doc.line(prevX, prevY, nx, ny);
          prevX = nx;
          prevY = ny;
        }
        if (p.dashed) doc.setLineDashPattern([], 0);
      }
      continue;
    }

    const pts = Array.from(p.d.matchAll(/[ML]\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)).map(
      (m) => [mapX(Number(m[1])), mapY(Number(m[2]))] as [number, number]
    );
    if (pts.length >= 2) {
      if (p.dashed) doc.setLineDashPattern([1.2, 0.9], 0);
      for (let i = 0; i < pts.length - 1; i++) {
        doc.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      }
      if (p.d.trim().endsWith('Z') && pts.length >= 3) {
        doc.line(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
      }
      if (p.dashed) doc.setLineDashPattern([], 0);
    }
  }

  // Lines
  for (const l of drawing.lines) {
    const [sr, sg, sb] = hexToRgb(l.stroke);
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(Math.max(0.15, Math.min(3.5, l.strokeWidth * scale)));
    doc.line(mapX(l.x1), mapY(l.y1), mapX(l.x2), mapY(l.y2));
  }

  // Dimensions
  for (const dim of drawing.dimensions) {
    doc.setDrawColor(30, 41, 59);
    doc.setLineWidth(0.22);
    doc.setFont(PDF_FONT_FAMILY, 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(15, 23, 42);

    if (dim.orientation === 'H') {
      const y = mapY(dim.y1 + dim.offsetMm);
      const x1 = mapX(dim.x1);
      const x2 = mapX(dim.x2);
      doc.line(x1, mapY(dim.y1), x1, y);
      doc.line(x2, mapY(dim.y2), x2, y);
      doc.line(x1, y, x2, y);
      doc.text(dim.label, (x1 + x2) / 2, y - 1.2, { align: 'center' });
    } else if (dim.orientation === 'V') {
      const x = mapX(dim.x1 + dim.offsetMm);
      const y1 = mapY(dim.y1);
      const y2 = mapY(dim.y2);
      doc.line(mapX(dim.x1), y1, x, y1);
      doc.line(mapX(dim.x2), y2, x, y2);
      doc.line(x, y1, x, y2);
      doc.text(dim.label, x + 1.4, (y1 + y2) / 2 + 1, { align: 'left' });
    } else {
      const x1 = mapX(dim.x1);
      const y1 = mapY(dim.y1);
      const x2 = mapX(dim.x2);
      const y2 = mapY(dim.y2);
      doc.line(x1, y1, x2, y2);
      doc.text(dim.label, (x1 + x2) / 2, (y1 + y2) / 2 - 1.2, { align: 'center' });
    }
  }

  // Labels
  for (const t of drawing.texts) {
    doc.setFont(PDF_FONT_FAMILY, t.bold ? 'bold' : 'normal');
    doc.setFontSize(Math.max(5.5, Math.min(8.5, t.fontSize * scale * 2.2)));
    doc.setTextColor(15, 23, 42);
    const align = t.anchor === 'start' ? 'left' : t.anchor === 'end' ? 'right' : 'center';
    doc.text(t.text, mapX(t.x), mapY(t.y) + 1, { align });
  }
}

export function generatePlanSvg(doc: ProjectDocument, displayUnit: DisplayUnit = 'mm'): string {
  return renderDrawing2DToSvg(buildPlanDrawing2D(doc, displayUnit));
}

export function generateElevationSvg(
  doc: ProjectDocument,
  wallId?: string | null,
  displayUnit: DisplayUnit = 'mm'
): string {
  const active = selectActiveWall(doc, wallId ?? null);
  return renderDrawing2DToSvg(
    buildWallElevationDrawing2D(doc, active?.id ?? '', displayUnit)
  );
}

export async function generatePlanPdfBlob(
  project: ProjectDocument,
  displayUnit: DisplayUnit = 'mm'
): Promise<Blob> {
  const { createFrenchPdfDocument, drawPdfFooters, drawPdfHeader, pdfToBlob } =
    await import('./pdfBase');
  const pdf = await createFrenchPdfDocument('landscape');
  const drawing = buildPlanDrawing2D(project, displayUnit);
  const startY = drawPdfHeader(pdf, {
    titleFr: 'Plan 2D coté',
    subtitleFr: `${project.walls.length} murs · ${project.modules.length} modules`,
    project,
  });
  drawTechnicalDrawingOnPdfPage(pdf, drawing, startY);
  drawPdfFooters(pdf, project.name);
  return pdfToBlob(pdf);
}

export async function generateElevationsPdfBlob(
  project: ProjectDocument,
  displayUnit: DisplayUnit = 'mm'
): Promise<Blob> {
  const { createFrenchPdfDocument, drawPdfFooters, drawPdfHeader, pdfToBlob } =
    await import('./pdfBase');
  const pdf = await createFrenchPdfDocument('landscape');

  if (project.walls.length === 0) {
    const startY = drawPdfHeader(pdf, {
      titleFr: 'Élévations par mur',
      subtitleFr: '0 mur',
      project,
    });
    pdf.setFont(PDF_FONT_FAMILY, 'normal');
    pdf.setFontSize(10);
    pdf.text('Aucun mur défini dans le projet.', 12, startY + 8);
    drawPdfFooters(pdf, project.name);
    return pdfToBlob(pdf);
  }

  project.walls.forEach((wall, idx) => {
    if (idx > 0) {
      pdf.addPage('a4', 'landscape');
    }
    const drawing = buildWallElevationDrawing2D(project, wall.id, displayUnit);
    const startY = drawPdfHeader(pdf, {
      titleFr: `Élévation — ${wall.labelFr ?? wall.id}`,
      subtitleFr: `Mur ${idx + 1} / ${project.walls.length}`,
      project,
    });
    drawTechnicalDrawingOnPdfPage(pdf, drawing, startY);
  });

  drawPdfFooters(pdf, project.name);
  return pdfToBlob(pdf);
}

function slug(str: string): string {
  return (
    str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'projet'
  );
}

export function exportPlanSvg(): void {
  const doc = useProjectStore.getState().document;
  const unit = useUIStore.getState().displayUnit;
  const svg = generatePlanSvg(doc, unit);
  downloadTextFile(svg, `plan-2d-${slug(doc.name)}.svg`, 'image/svg+xml;charset=utf-8');
}

export async function exportPlanPdf(): Promise<void> {
  const doc = useProjectStore.getState().document;
  const unit = useUIStore.getState().displayUnit;
  const blob = await generatePlanPdfBlob(doc, unit);
  triggerBlobDownload(blob, `plan-2d-${slug(doc.name)}.pdf`);
}

export function exportElevationSvg(wallId?: string | null): void {
  const doc = useProjectStore.getState().document;
  const unit = useUIStore.getState().displayUnit;
  const targetId = wallId ?? useUIStore.getState().activeWallId;
  const wall = selectActiveWall(doc, targetId);
  const svg = generateElevationSvg(doc, wall?.id, unit);
  const wallSlug = slug(wall?.labelFr ?? wall?.id ?? 'mur');
  downloadTextFile(svg, `elevation-${wallSlug}.svg`, 'image/svg+xml;charset=utf-8');
}

export async function exportElevationPdf(): Promise<void> {
  const doc = useProjectStore.getState().document;
  const unit = useUIStore.getState().displayUnit;
  const blob = await generateElevationsPdfBlob(doc, unit);
  triggerBlobDownload(blob, `elevations-${slug(doc.name)}.pdf`);
}
