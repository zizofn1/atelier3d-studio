export type ThemePreference = 'sombre' | 'clair' | 'auto';
export type ResolvedTheme = 'sombre' | 'clair';

export interface ThemeTokenSet {
  bg: string;
  panel: string;
  surface: string;
  surface2: string;
  viewportBg: string;
  glass: string;
  glassBorder: string;
  border: string;
  borderStrong: string;
  fg: string;
  fgMuted: string;
  fgSubtle: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  accentText: string;
  infoText: string;
  successText: string;
  dangerText: string;
  scrollbarTrack: string;
  scrollbarThumb: string;
}

export const THEME_TOKENS: Record<ResolvedTheme, ThemeTokenSet> = {
  sombre: {
    bg: '#0B0E14',
    panel: '#12161F',
    surface: '#1A202C',
    surface2: '#0F141D',
    viewportBg: '#090D14',
    glass: 'rgba(18, 22, 31, 0.82)',
    glassBorder: 'rgba(255, 255, 255, 0.10)',
    border: '#2A3243',
    borderStrong: '#3B455B',
    fg: '#F2EFE9',
    fgMuted: '#A9B0BE',
    fgSubtle: '#8D96A7',
    accent: '#E8A33D',
    accentHover: '#F2B85C',
    accentFg: '#1A1205',
    accentText: '#FBBF24',
    infoText: '#7DD3FC',
    successText: '#6EE7B7',
    dangerText: '#FCA5A5',
    scrollbarTrack: '#0B0E14',
    scrollbarThumb: '#2A3243',
  },
  clair: {
    bg: '#F6F4EF',
    panel: '#FFFFFF',
    surface: '#EFECE5',
    surface2: '#E7E3DA',
    viewportBg: '#E6E9F0',
    glass: 'rgba(255, 255, 255, 0.93)',
    glassBorder: 'rgba(27, 26, 23, 0.12)',
    border: '#D9D4C9',
    borderStrong: '#B8B1A3',
    fg: '#1B1A17',
    fgMuted: '#4E4B44',
    fgSubtle: '#615D54',
    accent: '#B45309',
    accentHover: '#92400E',
    accentFg: '#FFFFFF',
    accentText: '#92400E',
    infoText: '#0369A1',
    successText: '#166534',
    dangerText: '#B91C1C',
    scrollbarTrack: '#EFECE5',
    scrollbarThumb: '#C7C1B5',
  },
};

const THEME_STORAGE_KEY = 'atelier3d.themePreference';

export function loadStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined' || !window.localStorage) return 'sombre';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'sombre' || raw === 'clair' || raw === 'auto') {
      return raw;
    }
  } catch {
    // Ignore storage access errors in private WebViews
  }
  return 'sombre';
}

export function saveThemePreference(pref: ThemePreference): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // Ignore storage errors
  }
}

export function resolveTheme(pref: ThemePreference, systemPrefersDark?: boolean): ResolvedTheme {
  if (pref === 'sombre' || pref === 'clair') return pref;
  if (typeof systemPrefersDark === 'boolean') {
    return systemPrefersDark ? 'sombre' : 'clair';
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'clair' : 'sombre';
  }
  return 'sombre';
}

export function applyThemeToDom(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.colorScheme = resolved === 'clair' ? 'light' : 'dark';
  }
  return resolved;
}

/**
 * Pure WCAG 2.1 contrast ratio helper for automated palette regression testing.
 */
export function computeContrastRatio(fgHex: string, bgHex: string): number {
  const parseHex = (hex: string): [number, number, number] => {
    const clean = hex.replace('#', '');
    return [
      Number.parseInt(clean.slice(0, 2), 16) / 255,
      Number.parseInt(clean.slice(2, 4), 16) / 255,
      Number.parseInt(clean.slice(4, 6), 16) / 255,
    ];
  };
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const relLum = (hex: string) => {
    const [r, g, b] = parseHex(hex);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const l1 = relLum(fgHex);
  const l2 = relLum(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
