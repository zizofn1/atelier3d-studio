import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStore } from '@/store/useUIStore';
import {
  THEME_TOKENS,
  applyThemeToDom,
  computeContrastRatio,
  loadStoredThemePreference,
  resolveTheme,
  saveThemePreference,
} from '@/styles/themeTokens';
import { shareOrDownloadBlob } from '@/utils/download';
import {
  DESKTOP_MIN_WIDTH_PX,
  TABLET_MOUSE_MIN_WIDTH_PX,
  TABLET_TOUCH_MIN_WIDTH_PX,
  resolveFormFactor,
} from '@/utils/useFormFactor';

function collectTsxFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsxFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

describe('Palier 1 — Architecture tokens Clair / Sombre (Direction C)', () => {
  it('respecte un contraste WCAG AA (>= 4.5:1) sur sombre et clair', () => {
    for (const mode of ['sombre', 'clair'] as const) {
      const t = THEME_TOKENS[mode];
      for (const surfaceHex of [t.bg, t.panel, t.surface]) {
        expect(computeContrastRatio(t.fg, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.fgMuted, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.fgSubtle, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.accentText, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.infoText, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.successText, surfaceHex)).toBeGreaterThanOrEqual(4.5);
        expect(computeContrastRatio(t.dangerText, surfaceHex)).toBeGreaterThanOrEqual(4.5);
      }
      expect(computeContrastRatio(t.accentFg, t.accent)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('résout sombre par défaut et applique les attributs DOM', () => {
    window.localStorage.removeItem('atelier3d.themePreference');
    expect(loadStoredThemePreference()).toBe('sombre');
    expect(resolveTheme('sombre')).toBe('sombre');
    expect(resolveTheme('clair')).toBe('clair');
    expect(resolveTheme('auto', true)).toBe('sombre');
    expect(resolveTheme('auto', false)).toBe('clair');

    saveThemePreference('clair');
    expect(loadStoredThemePreference()).toBe('clair');
    expect(applyThemeToDom('clair')).toBe('clair');
    expect(document.documentElement.getAttribute('data-theme')).toBe('clair');
    expect(document.documentElement.style.colorScheme).toBe('light');

    saveThemePreference('sombre');
    expect(applyThemeToDom('sombre')).toBe('sombre');
    expect(document.documentElement.getAttribute('data-theme')).toBe('sombre');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('met à jour le store UI pour le thème, la palette de commandes et l’aide raccourcis', () => {
    useUIStore.getState().setThemePreference('sombre');
    expect(useUIStore.getState().themePreference).toBe('sombre');
    expect(useUIStore.getState().resolvedTheme).toBe('sombre');

    useUIStore.getState().cycleThemePreference();
    expect(useUIStore.getState().themePreference).toBe('clair');
    expect(useUIStore.getState().resolvedTheme).toBe('clair');

    useUIStore.getState().cycleThemePreference();
    expect(useUIStore.getState().themePreference).toBe('auto');

    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(true);
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().isCommandPaletteOpen).toBe(false);

    useUIStore.getState().setShortcutsHelpOpen(true);
    expect(useUIStore.getState().isShortcutsHelpOpen).toBe(true);
    useUIStore.getState().setShortcutsHelpOpen(false);
  });
});

describe('Palier 1 — Classification responsive & seuil tablette tactile 700 px', () => {
  it('classe correctement téléphone, tablette et PC selon la largeur et le pointeur', () => {
    expect(TABLET_TOUCH_MIN_WIDTH_PX).toBe(700);
    expect(TABLET_MOUSE_MIN_WIDTH_PX).toBe(768);
    expect(DESKTOP_MIN_WIDTH_PX).toBe(1280);

    // Tactile (iPad mini portrait 744px >= 700px -> tablet)
    expect(resolveFormFactor(699, true)).toEqual({
      formFactor: 'phone',
      density: 'coarse',
      widthPx: 699,
      tabletMinWidthPx: 700,
    });
    expect(resolveFormFactor(700, true)).toEqual({
      formFactor: 'tablet',
      density: 'coarse',
      widthPx: 700,
      tabletMinWidthPx: 700,
    });
    expect(resolveFormFactor(744, true).formFactor).toBe('tablet');
    expect(resolveFormFactor(1279, true).formFactor).toBe('tablet');
    expect(resolveFormFactor(1280, true)).toEqual({
      formFactor: 'desktop',
      density: 'coarse',
      widthPx: 1280,
      tabletMinWidthPx: 700,
    });

    // Souris (bureau)
    expect(resolveFormFactor(767, false).formFactor).toBe('phone');
    expect(resolveFormFactor(768, false)).toEqual({
      formFactor: 'tablet',
      density: 'fine',
      widthPx: 768,
      tabletMinWidthPx: 768,
    });
    expect(resolveFormFactor(1440, false)).toEqual({
      formFactor: 'desktop',
      density: 'fine',
      widthPx: 1440,
      tabletMinWidthPx: 768,
    });
  });
});

describe('Palier 1 — Partage natif Web Share API & repli téléchargement', () => {
  const originalShare = navigator.share;
  const originalCanShare = navigator.canShare;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: originalShare,
    });
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: originalCanShare,
    });
  });

  it('partage un fichier via navigator.share quand disponible', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    const canShareMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShareMock });

    const blob = new Blob(['pdf-content'], { type: 'application/pdf' });
    const result = await shareOrDownloadBlob(blob, 'devis.pdf', { title: 'Devis Atelier3D' });

    expect(result).toBe('shared');
    expect(shareMock).toHaveBeenCalledTimes(1);
    const arg = shareMock.mock.calls[0]?.[0];
    expect(arg.title).toBe('Devis Atelier3D');
    expect(arg.files[0]?.name).toBe('devis.pdf');
  });

  it('retourne cancelled sans déclencher de téléchargement si l’utilisateur ferme la feuille de partage', async () => {
    const abortErr = new Error('User cancelled');
    abortErr.name = 'AbortError';
    const shareMock = vi.fn().mockRejectedValue(abortErr);
    const canShareMock = vi.fn().mockReturnValue(true);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');

    Object.defineProperty(navigator, 'share', { configurable: true, value: shareMock });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShareMock });

    const blob = new Blob(['png'], { type: 'image/png' });
    const result = await shareOrDownloadBlob(blob, 'rendu.png');

    expect(result).toBe('cancelled');
    expect(createObjectUrlSpy).not.toHaveBeenCalled();
  });

  it('bascule vers le téléchargement navigateur si Web Share est absent', async () => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });

    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fallback');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const blob = new Blob(['devis'], { type: 'application/pdf' });
    const result = await shareOrDownloadBlob(blob, 'devis-test.pdf');

    expect(result).toBe('downloaded');
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Palier 1 — Hygiène UI (tokens sémantiques, plancher 12 px, déduplication Vue Client)', () => {
  it('supprime toute classe brute slate-* et toute police < 12 px dans src/components', () => {
    const componentsDir = path.resolve(process.cwd(), 'src/components');
    const files = collectTsxFiles(componentsDir);
    expect(files.length).toBeGreaterThan(10);

    const legacyClassPattern =
      /(?:bg|text|border|ring|divide|from|to)-slate-\d{2,3}|text-\[(?:8|9|10|11)px\]/;

    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      if (legacyClassPattern.test(content)) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('déduplique le bouton Vue Client entre TopToolbar et le HUD 3D de conception', () => {
    const sceneSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/viewport3d/Scene3D.tsx'),
      'utf-8'
    );
    const toolbarSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/layout/TopToolbar.tsx'),
      'utf-8'
    );

    expect(toolbarSrc).toContain('data-testid="toolbar-vue-client"');
    expect(sceneSrc).not.toContain('btn-mode-client');
    expect(sceneSrc).toContain('data-testid="btn-mode-conception"');
    expect(sceneSrc).toContain('Quitter Vue Client');
  });
});
