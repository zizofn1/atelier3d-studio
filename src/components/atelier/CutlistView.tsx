import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, Search } from 'lucide-react';
import { getMaterialById } from '@/data/materialsCatalog';
import { formatEdgeSummaryCode } from '@/engine/devis';
import { FR } from '@/i18n/fr';
import { selectCutlist } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { formatDim, roundMm } from '@/utils/units';

export function CutlistView() {
  const doc = useProjectStore((s) => s.document);
  const updateGlobalCarpentry = useProjectStore((s) => s.updateGlobalCarpentry);
  const displayUnit = useUIStore((s) => s.displayUnit);

  const [materialFilter, setMaterialFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);

  const allItems = useMemo(() => selectCutlist(doc), [doc]);

  const materialsInCutlist = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allItems) {
      map.set(item.materialId, item.materialNameFr);
    }
    return Array.from(map.entries());
  }, [allItems]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((item) => {
      if (materialFilter !== 'all' && item.materialId !== materialFilter) return false;
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        item.moduleRef.toLowerCase().includes(q) ||
        item.moduleNameFr.toLowerCase().includes(q) ||
        item.partNameFr.toLowerCase().includes(q) ||
        item.materialNameFr.toLowerCase().includes(q)
      );
    });
  }, [allItems, materialFilter, searchQuery]);

  const totalAreaM2 = useMemo(
    () => roundMm(filteredItems.reduce((acc, i) => acc + i.areaM2 * i.quantity, 0), 2),
    [filteredItems]
  );

  const totalEdgeM = useMemo(
    () => roundMm(filteredItems.reduce((acc, i) => acc + i.edgeLengthM * i.quantity, 0), 2),
    [filteredItems]
  );

  const totalPieceCount = useMemo(
    () => filteredItems.reduce((acc, i) => acc + i.quantity, 0),
    [filteredItems]
  );

  const edgeMaterial = getMaterialById(doc.defaultCarpentry.edgeBandingMaterialId);
  const deductEdgeBanding = Boolean(doc.defaultCarpentry.deductEdgeBandingThickness);

  const handleExportCsv = async () => {
    const { exportCutlistCsv } = await import('@/exports/atelierExports');
    exportCutlistCsv();
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      const { exportCutlistPdf } = await import('@/exports/atelierExports');
      await exportCutlistPdf();
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      data-testid="atelier-cutlist-view"
      className="flex h-full w-full flex-col overflow-hidden bg-atelier-bg p-4"
    >
      {/* Header & Actions */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-atelier-border bg-atelier-panel p-3">
        <div>
          <h1 className="text-sm font-semibold text-atelier-accent-text">
            {FR.tabs.cutlist} — {doc.name}
          </h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-atelier-muted tabular-nums">
            <span>
              {totalPieceCount} pièces ({filteredItems.length} lignes)
            </span>
            <span>·</span>
            <span>Surface nette : {totalAreaM2.toFixed(2).replace('.', ',')} m²</span>
            <span>·</span>
            <span>Bandes de chant : {totalEdgeM.toFixed(2).replace('.', ',')} ml</span>
            <span>·</span>
            <span>Chant actif : {edgeMaterial.nameFr}</span>
            <span>·</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-atelier-fg">
              <input
                type="checkbox"
                data-testid="toggle-deduct-edge-thickness"
                checked={deductEdgeBanding}
                onChange={(e) =>
                  updateGlobalCarpentry({ deductEdgeBandingThickness: e.target.checked })
                }
                className="accent-atelier-accent"
              />
              <span>Déduire ép. chants (cote débit)</span>
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-atelier-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer repère, pièce, module..."
              aria-label="Rechercher dans la fiche de débit"
              className="h-9 rounded-lg border border-atelier-border bg-atelier-surface-2 pl-8 pr-2.5 text-xs text-atelier-fg placeholder:text-atelier-subtle focus:border-atelier-accent focus:outline-none"
            />
          </div>

          <select
            aria-label="Filtrer par matériau"
            value={materialFilter}
            onChange={(e) => setMaterialFilter(e.target.value)}
            className="h-9 rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 text-xs text-atelier-fg focus:border-atelier-accent focus:outline-none"
          >
            <option value="all">Tous les matériaux ({materialsInCutlist.length})</option>
            {materialsInCutlist.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>

          <button
            type="button"
            data-testid="export-cutlist-csv"
            onClick={() => void handleExportCsv()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-3 text-xs font-medium text-atelier-fg hover:border-atelier-accent"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-atelier-success" />
            <span>Exporter CSV</span>
          </button>

          <button
            type="button"
            data-testid="export-cutlist-pdf"
            disabled={exportingPdf}
            onClick={() => void handleExportPdf()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover disabled:opacity-50"
          >
            {exportingPdf ? (
              <Download className="h-3.5 w-3.5 animate-pulse" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            <span>Exporter PDF</span>
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-atelier-border bg-atelier-panel">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-atelier-border bg-atelier-surface-2 text-xs uppercase tracking-wider text-atelier-muted">
            <tr>
              <th className="px-3 py-2.5">Repère</th>
              <th className="px-3 py-2.5">Module</th>
              <th className="px-3 py-2.5">Pièce / Désignation</th>
              <th className="px-3 py-2.5">Matériau</th>
              <th className="px-3 py-2.5 text-right">Longueur ({displayUnit})</th>
              <th className="px-3 py-2.5 text-right">Largeur ({displayUnit})</th>
              <th className="px-3 py-2.5 text-right">Épaisseur ({displayUnit})</th>
              <th className="px-3 py-2.5 text-center">Qté</th>
              <th className="px-3 py-2.5 text-center">Sens du fil</th>
              <th className="px-3 py-2.5">Chants (H / B / G / D)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-atelier-border/60">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-atelier-subtle">
                  Aucune pièce dans la fiche de débit. Ajoutez des modules depuis l’onglet Conception.
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-atelier-surface/50">
                  <td className="px-3 py-2 font-mono text-xs text-atelier-accent-text">{item.id}</td>
                  <td className="px-3 py-2 text-atelier-fg">
                    <span className="mr-1 font-mono text-atelier-accent-text">{item.moduleRef}</span>
                    <span className="text-atelier-muted">{item.moduleNameFr}</span>
                  </td>
                  <td className="px-3 py-2 font-medium text-atelier-fg">{item.partNameFr}</td>
                  <td className="px-3 py-2 text-atelier-muted">{item.materialNameFr}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-atelier-fg">
                    {formatDim(item.lengthMm, displayUnit, false)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-atelier-fg">
                    {formatDim(item.widthMm, displayUnit, false)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-atelier-accent-text">
                    {formatDim(item.thicknessMm, displayUnit, false)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-atelier-fg">
                    {item.quantity}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                        item.grain === 'H'
                          ? 'bg-sky-500/20 text-atelier-info'
                          : item.grain === 'V'
                            ? 'bg-amber-500/20 text-atelier-accent-text'
                            : 'bg-atelier-surface text-atelier-muted'
                      }`}
                    >
                      {item.grain === 'none'
                        ? FR.carpentry.grainDirections.none
                        : `${item.grain} (${FR.carpentry.grainDirections[item.grain]})`}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-atelier-muted">
                    {formatEdgeSummaryCode(item.edges)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
