import type { NestingRunResult } from '@/types';
import { buildCutlistCsv } from '@/engine/devis';
import { selectCutlist, selectDevis, selectNesting } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { downloadTextFile, shareOrDownloadBlob, triggerBlobDownload } from '@/utils/download';

function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'projet'
  );
}

export function exportCutlistCsv(): void {
  const doc = useProjectStore.getState().document;
  const items = selectCutlist(doc);
  const csv = buildCutlistCsv(items);
  downloadTextFile(csv, `fiche-de-debit-${slugifyName(doc.name)}.csv`, 'text/csv;charset=utf-8');
}

export async function exportCutlistPdf(): Promise<void> {
  const doc = useProjectStore.getState().document;
  const items = selectCutlist(doc);
  const { generateCutlistPdfBlob } = await import('./cutlistPdf');
  const blob = await generateCutlistPdfBlob(doc, items);
  triggerBlobDownload(blob, `fiche-de-debit-${slugifyName(doc.name)}.pdf`);
}

export async function exportNestingPdf(precomputedNesting?: NestingRunResult): Promise<void> {
  const doc = useProjectStore.getState().document;
  const nesting = precomputedNesting ?? selectNesting(doc);
  const { generateNestingPdfBlob } = await import('./nestingPdf');
  const blob = await generateNestingPdfBlob(doc, nesting);
  triggerBlobDownload(blob, `calepinage-${slugifyName(doc.name)}.pdf`);
}

export async function exportDevisPdf(options?: { share?: boolean }): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const doc = useProjectStore.getState().document;
  const devis = selectDevis(doc);
  const { generateDevisPdfBlob } = await import('./devisPdf');
  const blob = await generateDevisPdfBlob(doc, devis);
  const filename = `devis-${slugifyName(doc.name)}.pdf`;
  if (options?.share) {
    return shareOrDownloadBlob(blob, filename, {
      title: `Devis — ${doc.name}`,
      text: `Devis Atelier3D Studio pour ${doc.name}`,
    });
  }
  triggerBlobDownload(blob, filename);
  return 'downloaded';
}

