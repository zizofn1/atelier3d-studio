import type {
  DevisPricingConfig,
  HardwareBomItem,
  HardwareKind,
  ProjectDocument,
} from '@/types';
import { generateModuleOutput } from '@/engine/carpentry';
import { FR } from '@/i18n/fr';
import { roundCurrency } from '@/utils/currency';
import { roundMm } from '@/utils/units';

export const HARDWARE_UNITS_FR: Record<HardwareKind, string> = {
  charniere: 'pce',
  coulisse: 'paire',
  poignee: 'pce',
  bouton: 'pce',
  profil_gorge: 'ml',
  push_open: 'pce',
  pied_reglable: 'pce',
  verin: 'pce',
  taquet: 'pce',
  suspension_murale: 'pce',
  kit_coulissant: 'kit',
  tringle: 'ml',
};

const HARDWARE_ORDER: HardwareKind[] = [
  'charniere',
  'coulisse',
  'poignee',
  'bouton',
  'profil_gorge',
  'push_open',
  'pied_reglable',
  'verin',
  'taquet',
  'suspension_murale',
  'kit_coulissant',
  'tringle',
];

export function buildHardwareBom(
  doc: ProjectDocument,
  pricing: DevisPricingConfig = doc.pricing
): HardwareBomItem[] {
  const totals = new Map<HardwareKind, number>();

  for (const mod of doc.modules) {
    const out = generateModuleOutput(mod, doc.defaultCarpentry);
    for (const req of out.hardware) {
      if (req.quantity <= 0) continue;
      totals.set(req.kind, roundMm((totals.get(req.kind) ?? 0) + req.quantity, 2));
    }
  }

  const items: HardwareBomItem[] = [];
  for (const kind of HARDWARE_ORDER) {
    const qty = totals.get(kind);
    if (!qty || qty <= 0) continue;
    const unitPrice = Math.max(0, pricing.hardwareUnitPrices[kind] ?? 0);
    items.push({
      kind,
      labelFr: FR.hardware[kind],
      unitFr: HARDWARE_UNITS_FR[kind],
      quantity: qty,
      unitPrice: roundCurrency(unitPrice),
      totalPrice: roundCurrency(qty * unitPrice),
    });
  }

  return items;
}
