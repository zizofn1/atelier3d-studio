import type { DisplayUnit } from '@/types';

export function roundMm(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function mmToCm(mm: number): number {
  return roundMm(mm / 10, 2);
}

export function cmToMm(cm: number): number {
  return roundMm(cm * 10, 1);
}

export function formatDim(mm: number, unit: DisplayUnit, includeUnit = true): string {
  const safeMm = Number.isFinite(mm) ? mm : 0;
  const displayValue = unit === 'cm' ? roundMm(safeMm / 10, 2) : roundMm(safeMm, 1);
  const formattedNumber = new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: unit === 'cm' ? 2 : 1,
  }).format(displayValue);

  if (!includeUnit) {
    return formattedNumber;
  }
  return `${formattedNumber} ${unit}`;
}

export interface ParseDimOptions {
  minMm?: number;
  maxMm?: number;
}

export function parseDim(
  raw: string | number,
  defaultUnit: DisplayUnit,
  options: ParseDimOptions = {}
): number | null {
  const minMm = options.minMm ?? 0;
  const maxMm = options.maxMm ?? Infinity;

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const mm = defaultUnit === 'cm' ? raw * 10 : raw;
    if (mm < minMm || mm > maxMm) return null;
    return roundMm(mm, 1);
  }

  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[\s\u00A0\u202F]+/g, '');

  if (!normalized) return null;

  const match = normalized.match(/^([+-]?\d+(?:\.\d+)?)(mm|cm|m)?$/);
  if (!match) return null;

  const num = Number(match[1]);
  if (!Number.isFinite(num)) return null;

  const suffix = match[2];
  let mm: number;
  if (suffix === 'mm') {
    mm = num;
  } else if (suffix === 'cm') {
    mm = num * 10;
  } else if (suffix === 'm') {
    mm = num * 1000;
  } else {
    mm = defaultUnit === 'cm' ? num * 10 : num;
  }

  if (!Number.isFinite(mm) || mm < minMm || mm > maxMm) return null;
  return roundMm(mm, 1);
}
