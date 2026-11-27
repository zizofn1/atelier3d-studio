import { useMemo, useState } from 'react';
import { AlertTriangle, FileText, Share2 } from 'lucide-react';
import type { CurrencyCode, HardwareKind } from '@/types';
import { FR } from '@/i18n/fr';
import { selectDevis } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { convertCurrency, formatCurrency } from '@/utils/currency';

export function DevisView() {
  const doc = useProjectStore((s) => s.document);
  const updatePricing = useProjectStore((s) => s.updatePricing);

  const devis = useMemo(() => selectDevis(doc), [doc]);
  const [exportingPdf, setExportingPdf] = useState(false);

  const pricing = doc.pricing;
  const currency = pricing.currency;

  const handleCurrencyChange = (nextCurrency: CurrencyCode) => {
    if (nextCurrency === currency) return;
    const nextMaterialOverrides: Record<string, number> = {};
    for (const [id, p] of Object.entries(pricing.materialPriceOverrides)) {
      nextMaterialOverrides[id] = convertCurrency(p, currency, nextCurrency);
    }
    const nextHardware = { ...pricing.hardwareUnitPrices };
    for (const k of Object.keys(nextHardware) as HardwareKind[]) {
      nextHardware[k] = convertCurrency(nextHardware[k], currency, nextCurrency);
    }
    updatePricing({
      currency: nextCurrency,
      materialPriceOverrides: nextMaterialOverrides,
      edgeBandingPricesPerMeter: {
        '0.4': convertCurrency(pricing.edgeBandingPricesPerMeter['0.4'], currency, nextCurrency),
        '2': convertCurrency(pricing.edgeBandingPricesPerMeter['2'], currency, nextCurrency),
      },
      hardwareUnitPrices: nextHardware,
    });
  };

  const handleMaterialPriceChange = (materialId: string, raw: string) => {
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val < 0) return;
    updatePricing({
      materialPriceOverrides: {
        ...pricing.materialPriceOverrides,
        [materialId]: val,
      },
    });
  };

  const handleEdgePriceChange = (code: '0.4' | '2', raw: string) => {
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val < 0) return;
    updatePricing({
      edgeBandingPricesPerMeter: {
        ...pricing.edgeBandingPricesPerMeter,
        [code]: val,
      },
    });
  };

  const handleHardwarePriceChange = (kind: HardwareKind, raw: string) => {
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val < 0) return;
    updatePricing({
      hardwareUnitPrices: {
        ...pricing.hardwareUnitPrices,
        [kind]: val,
      },
    });
  };

  const handleExportPdf = async (share = false) => {
    setExportingPdf(true);
    try {
      const { exportDevisPdf } = await import('@/exports/atelierExports');
      await exportDevisPdf({ share });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      data-testid="atelier-devis-view"
      className="flex h-full w-full flex-col space-y-4 overflow-y-auto bg-atelier-bg p-4"
    >
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-atelier-border bg-atelier-panel p-3">
        <div>
          <h1 className="text-sm font-semibold text-atelier-accent-text">
            {FR.tabs.devis} automatique — {doc.name}
          </h1>
          <p className="text-xs text-atelier-muted">
            Calculé sur feuilles pleines calepinées, métrage linéaire de chants (ml) et nomenclature
            quincaillerie.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Devise du devis"
            value={currency}
            onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
            className="h-9 rounded-lg border border-atelier-border bg-atelier-surface-2 px-2.5 text-xs text-atelier-fg"
          >
            <option value="MAD">{FR.currencies.MAD}</option>
            <option value="EUR">{FR.currencies.EUR}</option>
            <option value="USD">{FR.currencies.USD}</option>
          </select>

          <button
            type="button"
            data-testid="share-devis-pdf-view"
            disabled={exportingPdf}
            onClick={() => void handleExportPdf(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 text-xs font-semibold text-atelier-success hover:bg-emerald-500/25 disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            <span>Partager</span>
          </button>

          <button
            type="button"
            data-testid="export-devis-pdf"
            disabled={exportingPdf}
            onClick={() => void handleExportPdf(false)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Exporter Devis PDF</span>
          </button>
        </div>
      </div>

      {/* Oversized / Unplaced pieces alert banner */}
      {(devis.unplacedPiecesCount ?? 0) > 0 && (
        <div
          role="alert"
          data-testid="devis-unplaced-alert"
          className="flex items-start gap-2.5 rounded-xl border border-atelier-accent/60 bg-atelier-accent/15 px-3.5 py-2.5 text-xs text-atelier-fg"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-atelier-accent-text" />
          <div>
            <div className="font-semibold text-atelier-accent-text">
              {devis.unplacedPiecesCount} pièce(s) dépassent le format de feuille standard
            </div>
            <div className="text-xs text-atelier-muted">
              Ces éléments hors-format (ex. plan de travail long) sont facturés automatiquement sur
              leur surface nette majorée de 15 % pour chute/délignage afin d’éviter toute
              sous-facturation.
            </div>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Left 2 cols: Tables */}
        <div className="space-y-4 xl:col-span-2">
          {/* Panneaux */}
          <section className="overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel">
            <div className="border-b border-atelier-border bg-atelier-surface-2 px-3 py-2 text-xs font-semibold text-atelier-accent-text">
              Panneaux (surface en m² sur feuilles pleines calepinées)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-atelier-border text-xs text-atelier-muted">
                  <tr>
                    <th className="px-3 py-2">Matériau</th>
                    <th className="px-3 py-2 text-right">Ép.</th>
                    <th className="px-3 py-2 text-right">Feuilles</th>
                    <th className="px-3 py-2 text-right">Surface (m²)</th>
                    <th className="px-3 py-2 text-right">Chute</th>
                    <th className="px-3 py-2 text-right">P.U. / m² ({currency})</th>
                    <th className="px-3 py-2 text-right">Montant HT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-atelier-border/50">
                  {devis.materialLines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-atelier-subtle">
                        Aucun panneau dans le projet.
                      </td>
                    </tr>
                  ) : (
                    devis.materialLines.map((line) => (
                      <tr key={`${line.materialId}-${line.thicknessMm}`}>
                        <td className="px-3 py-2 font-medium text-atelier-fg">
                          <div>{line.materialNameFr}</div>
                          {(line.unplacedCount ?? 0) > 0 && (
                            <div className="text-xs font-normal text-atelier-accent-text">
                              dont {line.unplacedCount} pièce(s) hors-format (+15 % perte)
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-atelier-muted">
                          {line.thicknessMm} mm
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-atelier-fg">
                          {line.sheetsCount}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-atelier-fg">
                          {line.sheetAreaM2.toFixed(2).replace('.', ',')} m²
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-atelier-muted">
                          {line.wastePercent.toFixed(1).replace('.', ',')} %
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            aria-label={`Prix unitaire ${line.materialNameFr}`}
                            value={line.unitPricePerM2}
                            onChange={(e) =>
                              handleMaterialPriceChange(line.materialId, e.target.value)
                            }
                            className="h-8 w-24 rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-atelier-accent-text">
                          {formatCurrency(line.totalPrice, currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Bandes de chant */}
          <section className="overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel">
            <div className="border-b border-atelier-border bg-atelier-surface-2 px-3 py-2 text-xs font-semibold text-atelier-accent-text">
              Bandes de chant (mètres linéaires — ml)
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-atelier-border text-xs text-atelier-muted">
                <tr>
                  <th className="px-3 py-2">Type de chant</th>
                  <th className="px-3 py-2 text-right">Métrage (ml)</th>
                  <th className="px-3 py-2 text-right">P.U. / ml ({currency})</th>
                  <th className="px-3 py-2 text-right">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-atelier-border/50">
                {devis.edgeBandingLines.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-atelier-subtle">
                      Aucune bande de chant comptabilisée.
                    </td>
                  </tr>
                ) : (
                  devis.edgeBandingLines.map((edge) => (
                    <tr key={edge.code}>
                      <td className="px-3 py-2 font-medium text-atelier-fg">{edge.labelFr}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-atelier-fg">
                        {edge.linearMeters.toFixed(2).replace('.', ',')} ml
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          aria-label={`Prix unitaire ${edge.labelFr}`}
                          value={edge.unitPricePerMeter}
                          onChange={(e) => handleEdgePriceChange(edge.code, e.target.value)}
                          className="h-8 w-24 rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-atelier-accent-text">
                        {formatCurrency(edge.totalPrice, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          {/* Quincaillerie BOM */}
          <section className="overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel">
            <div className="border-b border-atelier-border bg-atelier-surface-2 px-3 py-2 text-xs font-semibold text-atelier-accent-text">
              {FR.carpentry.parts.quincaillerie} (Nomenclature BOM)
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-atelier-border text-xs text-atelier-muted">
                <tr>
                  <th className="px-3 py-2">Désignation</th>
                  <th className="px-3 py-2 text-right">Quantité</th>
                  <th className="px-3 py-2">Unité</th>
                  <th className="px-3 py-2 text-right">P.U. ({currency})</th>
                  <th className="px-3 py-2 text-right">Montant HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-atelier-border/50">
                {devis.hardwareItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-atelier-subtle">
                      Aucune quincaillerie détectée.
                    </td>
                  </tr>
                ) : (
                  devis.hardwareItems.map((hw) => (
                    <tr key={hw.kind}>
                      <td className="px-3 py-2 font-medium text-atelier-fg">{hw.labelFr}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-atelier-fg">
                        {hw.quantity}
                      </td>
                      <td className="px-3 py-2 text-atelier-muted">{hw.unitFr}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`Prix unitaire ${hw.labelFr}`}
                          value={hw.unitPrice}
                          onChange={(e) => handleHardwarePriceChange(hw.kind, e.target.value)}
                          className="h-8 w-24 rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-atelier-accent-text">
                        {formatCurrency(hw.totalPrice, currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </div>

        {/* Right col: Commercial parameters, Client/Company header & Totals */}
        <div className="space-y-4">
          {/* Totals Card */}
          <section className="space-y-2.5 rounded-xl border border-atelier-accent/40 bg-atelier-panel p-4 text-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-atelier-accent-text">
              Récapitulatif financier
            </h2>

            <div className="grid grid-cols-3 gap-2">
              <label className="block space-y-1">
                <span className="text-atelier-muted">Main-d’œuvre (%)</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={pricing.laborPercent}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(v) && v >= 0) updatePricing({ laborPercent: v });
                  }}
                  className="h-8 w-full rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-atelier-muted">Marge (%)</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={pricing.marginPercent}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(v) && v >= 0) updatePricing({ marginPercent: v });
                  }}
                  className="h-8 w-full rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-atelier-muted">TVA (%)</span>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={pricing.tvaPercent}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(v) && v >= 0) updatePricing({ tvaPercent: v });
                  }}
                  className="h-8 w-full rounded border border-atelier-border bg-atelier-surface-2 px-2 text-right text-atelier-fg tabular-nums"
                />
              </label>
            </div>

            <div className="space-y-1.5 border-t border-atelier-border pt-2.5 tabular-nums">
              <div className="flex justify-between text-atelier-muted">
                <span>Sous-total Panneaux</span>
                <span>{formatCurrency(devis.materialsSubtotal, currency)}</span>
              </div>
              <div className="flex justify-between text-atelier-muted">
                <span>Sous-total Chants</span>
                <span>{formatCurrency(devis.edgeBandingSubtotal, currency)}</span>
              </div>
              <div className="flex justify-between text-atelier-muted">
                <span>Sous-total Quincaillerie</span>
                <span>{formatCurrency(devis.hardwareSubtotal, currency)}</span>
              </div>
              <div className="flex justify-between text-atelier-muted">
                <span>Main-d’œuvre ({pricing.laborPercent} %)</span>
                <span>{formatCurrency(devis.laborAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-atelier-muted">
                <span>Marge ({pricing.marginPercent} %)</span>
                <span>{formatCurrency(devis.marginAmount, currency)}</span>
              </div>
              <div className="flex justify-between border-t border-atelier-border pt-2 text-sm font-semibold text-atelier-fg">
                <span>Total HT</span>
                <span>{formatCurrency(devis.totalHT, currency)}</span>
              </div>
              <div className="flex justify-between text-atelier-muted">
                <span>TVA ({pricing.tvaPercent} %)</span>
                <span>{formatCurrency(devis.tvaAmount, currency)}</span>
              </div>
              <div className="flex justify-between rounded-lg bg-atelier-accent/15 px-3 py-2 text-base font-bold text-atelier-accent-text">
                <span>Total TTC</span>
                <span>{formatCurrency(devis.totalTTC, currency)}</span>
              </div>
            </div>
          </section>

          {/* Company & Client Metadata */}
          <section className="space-y-3 rounded-xl border border-atelier-border bg-atelier-panel p-4 text-xs">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
              En-tête Atelier & Client
            </h2>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-atelier-muted">Référence devis</span>
                <input
                  type="text"
                  value={pricing.quoteReference}
                  onChange={(e) => updatePricing({ quoteReference: e.target.value })}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-atelier-muted">Validité (jours)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={pricing.validityDays}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v > 0) updatePricing({ validityDays: v });
                  }}
                  className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg tabular-nums"
                />
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Nom de l’atelier / société</span>
              <input
                type="text"
                value={pricing.company.name}
                onChange={(e) =>
                  updatePricing({ company: { ...pricing.company, name: e.target.value } })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Adresse atelier</span>
              <input
                type="text"
                value={pricing.company.address}
                onChange={(e) =>
                  updatePricing({ company: { ...pricing.company, address: e.target.value } })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Nom du client</span>
              <input
                type="text"
                value={pricing.client.name}
                onChange={(e) =>
                  updatePricing({ client: { ...pricing.client, name: e.target.value } })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Adresse client</span>
              <input
                type="text"
                value={pricing.client.address}
                onChange={(e) =>
                  updatePricing({ client: { ...pricing.client, address: e.target.value } })
                }
                className="h-9 w-full rounded-md border border-atelier-border bg-atelier-surface-2 px-2 text-atelier-fg"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-atelier-muted">Conditions & observations</span>
              <textarea
                rows={3}
                value={pricing.notesFr}
                onChange={(e) => updatePricing({ notesFr: e.target.value })}
                className="w-full rounded-md border border-atelier-border bg-atelier-surface-2 p-2 text-atelier-fg"
              />
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
