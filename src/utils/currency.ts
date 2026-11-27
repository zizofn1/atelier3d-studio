import type { CurrencyCode } from '@/types';

export const DEFAULT_CURRENCY: CurrencyCode = 'MAD';

export const CURRENCY_INFO: Record<
  CurrencyCode,
  { symbol: string; labelFr: string; rateFromMad: number }
> = {
  MAD: {
    symbol: 'MAD',
    labelFr: 'Dirham marocain (MAD)',
    rateFromMad: 1,
  },
  EUR: {
    symbol: '€',
    labelFr: 'Euro (€)',
    rateFromMad: 0.092,
  },
  USD: {
    symbol: '$',
    labelFr: 'Dollar US ($)',
    rateFromMad: 0.1,
  },
};

export function roundCurrency(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const rounded = Math.round(amount * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

export function convertCurrency(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode
): number {
  if (!Number.isFinite(amount)) return 0;
  if (from === to) return roundCurrency(amount);
  const inMad = amount / CURRENCY_INFO[from].rateFromMad;
  const converted = inMad * CURRENCY_INFO[to].rateFromMad;
  return roundCurrency(converted);
}

export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const safeAmount = Number.isFinite(amount) ? roundCurrency(amount) : 0;
  const formattedNumber = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
  return `${formattedNumber} ${CURRENCY_INFO[currency].symbol}`;
}
