import { expect, type Download, type Locator, type Page } from '@playwright/test';
import * as fs from 'node:fs/promises';

export const ROOT_SELECTOR = '#atelier-root';

export type ViewModeAttr = 'plan2d' | 'elevation2d' | 'view3d' | 'split';
export type ViewModeButton = 'plan' | 'elevation' | '3d' | 'split';
export type WorkspaceTab = 'conception' | 'cutlist' | 'nesting' | 'devis';
export type LeftPanelTab = 'catalogue' | 'materiaux' | 'atelier';
export type UnitMode = 'mm' | 'cm';
export type CurrencyCode = 'MAD' | 'EUR' | 'USD';
export type LightingPreset = 'jour' | 'nuit';

export interface RootState {
  viewMode: string;
  workspaceTab: string;
  unitMode: string;
  currency: string;
  moduleCount: number;
  wallCount: number;
  openAll: boolean;
  lighting: string;
  led: boolean;
  sceneReady: boolean;
}

export interface ErrorGuard {
  consoleErrors: string[];
  pageErrors: string[];
  failedExternalRequests: string[];
  assertNoErrors: () => void;
  assertNoFailedExternalRequests: () => void;
}

const VIEW_MODE_ATTR_MAP: Record<ViewModeButton, ViewModeAttr> = {
  plan: 'plan2d',
  elevation: 'elevation2d',
  '3d': 'view3d',
  split: 'split',
};

const ENGLISH_LEAK_REGEX =
  /\b(Base Cabinet|Wall Cabinet|Tall Unit|Corner Cabinet|Kitchen Island|Wardrobe|Cutlist|Nesting|Waste Rate|Edge Banding|Grain Direction|Back Panel|Thickness|Clearance|Quote|Invoice|Hardware|Open All|Daylight|Walkthrough|Save Project|Project Library|Width|Height|Depth|Settings|Drawer|Shelf|Door|Panel|VAT|Kerf|Margin|Labor|Save|Cancel|Delete|Undo|Redo|Wall|Floor|Ceiling|Countertop|Backsplash|Material|Currency)\b/i;

const FRENCH_CARPENTRY_REGEX =
  /(Conception|Fiche de d[ée]bit|Calepinage|Devis|Caisson|Plinthe|Bande de chant|Sens du fil|Taux de chute|Cotations|Plan|Él[ée]vation|Menuiserie|Quincaillerie)/i;

export function attachErrorGuard(page: Page): ErrorGuard {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedExternalRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(err.message || String(err));
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      failedExternalRequests.push(`${url} (${req.failure()?.errorText ?? 'failed'})`);
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedExternalRequests,
    assertNoErrors() {
      expect(
        { consoleErrors, pageErrors },
        `Runtime errors detected: console=${JSON.stringify(consoleErrors)}, pageerror=${JSON.stringify(pageErrors)}`,
      ).toEqual({ consoleErrors: [], pageErrors: [] });
    },
    assertNoFailedExternalRequests() {
      expect(
        failedExternalRequests,
        `Unexpected external network requests failed: ${JSON.stringify(failedExternalRequests)}`,
      ).toEqual([]);
    },
  };
}

export async function getRootState(page: Page): Promise<RootState> {
  const root = page.locator(ROOT_SELECTOR);
  await expect(root).toBeVisible();
  return root.evaluate((el) => ({
    viewMode: el.getAttribute('data-view-mode') ?? '',
    workspaceTab: el.getAttribute('data-workspace-tab') ?? '',
    unitMode: el.getAttribute('data-unit-mode') ?? '',
    currency: el.getAttribute('data-currency') ?? '',
    moduleCount: Number(el.getAttribute('data-module-count') ?? '0'),
    wallCount: Number(el.getAttribute('data-wall-count') ?? '0'),
    openAll: el.getAttribute('data-open-all') === 'true',
    lighting: el.getAttribute('data-lighting') ?? '',
    led: el.getAttribute('data-led') === 'true',
    sceneReady: el.getAttribute('data-scene-ready') === 'true',
  }));
}

export async function waitForStudioHydration(page: Page): Promise<void> {
  await expect(page.locator(ROOT_SELECTOR)).toBeVisible();
  await expect
    .poll(async () => (await getRootState(page)).wallCount, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.length), { timeout: 10_000 })
    .toBeGreaterThan(0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function openStudio(page: Page, opts?: { waitFor3D?: boolean }): Promise<void> {
  await page.goto('/');
  await waitForStudioHydration(page);
  if (opts?.waitFor3D) {
    await waitForSceneReady(page);
  }
}

export async function reloadStudio(page: Page, opts?: { waitFor3D?: boolean }): Promise<void> {
  await page.reload();
  await waitForStudioHydration(page);
  await page.waitForTimeout(150);
  if (opts?.waitFor3D) {
    await waitForSceneReady(page);
  }
}

export async function switchViewMode(
  page: Page,
  mode: ViewModeButton,
  opts?: { waitFor3D?: boolean },
): Promise<void> {
  await page.getByTestId(`view-mode-${mode}`).click();
  await expect(page.locator(ROOT_SELECTOR)).toHaveAttribute('data-view-mode', VIEW_MODE_ATTR_MAP[mode]);
  if ((mode === '3d' || mode === 'split') && opts?.waitFor3D !== false) {
    await waitForSceneReady(page);
  }
}

export async function switchWorkspaceTab(page: Page, tab: WorkspaceTab): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
  await expect(page.locator(ROOT_SELECTOR)).toHaveAttribute('data-workspace-tab', tab);
}

export async function openLeftPanelTab(page: Page, tab: LeftPanelTab): Promise<void> {
  await switchWorkspaceTab(page, 'conception');
  const expandLeft = page.getByTestId('btn-expand-left-panel');
  if (await expandLeft.isVisible()) {
    await expandLeft.click();
  }
  const labelMap: Record<LeftPanelTab, RegExp> = {
    catalogue: /^Meubles$/i,
    materiaux: /^Mat[ée]riaux$/i,
    atelier: /^Atelier$/i,
  };
  const leftPanel = page.getByTestId('left-catalog-panel');
  await expect(leftPanel).toBeVisible();
  const tabBtn = leftPanel.getByRole('button', { name: labelMap[tab] }).first();
  await expect(tabBtn).toBeVisible();
  await tabBtn.click();
}

export async function openDisplayMenu(page: Page): Promise<void> {
  const menu = page.getByTestId('display-popover-menu');
  if (await menu.isVisible()) return;
  await page.getByTestId('btn-display-menu').click();
  await expect(menu).toBeVisible();
}

export function getInspectorPanel(page: Page): Locator {
  return page.locator('aside').last();
}

export function getProjectCardLocator(dialog: Locator, projectName: string): Locator {
  return dialog
    .getByText(projectName, { exact: true })
    .first()
    .locator('xpath=ancestor::*[self::div or self::article or self::li][.//img and .//button][1]');
}

export async function openProjectLibrary(page: Page): Promise<Locator> {
  await page.getByTestId('btn-projects-library').click();
  const dialog = page.getByRole('dialog').or(page.locator('[data-testid*="library"], [data-testid*="projects"]')).first();
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function closeModalIfOpen(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  if (await dialog.count()) {
    const first = dialog.first();
    if (await first.isVisible()) {
      const closeBtn = first.getByRole('button', { name: /fermer|annuler|x|×/i }).first();
      if (await closeBtn.count()) {
        await closeBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(first).toBeHidden();
    }
  }
}

export async function loadTemplate(
  page: Page,
  templateName: 'Cuisine en L' | 'Dressing sur-mesure',
): Promise<void> {
  const dialog = await openProjectLibrary(page);
  const pattern = templateName === 'Cuisine en L' ? /Cuisine en L/i : /Dressing sur-mesure/i;
  const candidateBtn = dialog.getByRole('button', { name: pattern }).first();
  await expect(candidateBtn).toBeVisible();
  await candidateBtn.click();
  await expect
    .poll(async () => (await getRootState(page)).moduleCount, { timeout: 10_000 })
    .toBeGreaterThan(0);
  await closeModalIfOpen(page);
}

export async function addModuleByFrenchLabel(
  page: Page,
  labelRegex: RegExp,
  expectedDelta = 1,
): Promise<void> {
  await openLeftPanelTab(page, 'catalogue');
  const before = (await getRootState(page)).moduleCount;
  const leftPanel = page.getByTestId('left-catalog-panel');
  const targetBtn = leftPanel
    .locator('[data-testid^="catalog-add-"]')
    .filter({ hasText: labelRegex })
    .first();
  await expect(targetBtn).toBeVisible();
  await targetBtn.scrollIntoViewIfNeeded();
  await targetBtn.click();
  await expect
    .poll(async () => (await getRootState(page)).moduleCount, { timeout: 10_000 })
    .toBe(before + expectedDelta);
}

export function selectInspectorDimensions(page: Page): {
  widthInput: Locator;
  heightInput: Locator;
  depthInput: Locator;
} {
  return {
    widthInput: page.getByTestId('inspector-input-width'),
    heightInput: page.getByTestId('inspector-input-height'),
    depthInput: page.getByTestId('inspector-input-depth'),
  };
}

export async function setNumericInput(locator: Locator, value: number | string): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.click();
  await locator.fill(String(value));
  await locator.press('Enter');
  await locator.blur();
}

export async function readNumericInputValue(locator: Locator): Promise<number> {
  const raw = await locator.inputValue();
  const normalized = raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
  if (normalized === '') {
    return Number.NaN;
  }
  return Number(normalized);
}

export function parseFrenchMoney(text: string, labelPattern: RegExp): number {
  const match = new RegExp(
    `${labelPattern.source}(?:[^\\d\\n]*\\([^)\\n]*\\))?[^\\d]*?(\\d[\\d \\t\\u00a0\\u202f]*(?:[.,]\\d+)?)`,
    labelPattern.flags,
  ).exec(text);
  expect(match, `Missing numeric value for ${labelPattern}`).not.toBeNull();
  const val = Number(match![1].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  expect(Number.isNaN(val)).toBe(false);
  return val;
}

export async function assertFrenchAuthenticity(page: Page): Promise<void> {
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.trim().length).toBeGreaterThan(20);
  expect(bodyText).toMatch(FRENCH_CARPENTRY_REGEX);
  const leakMatch = bodyText.match(ENGLISH_LEAK_REGEX);
  expect(leakMatch, `English UI leak detected: ${leakMatch?.[0] ?? ''}`).toBeNull();
}

export async function get3DCanvasLocator(page: Page): Promise<Locator> {
  const container = page.getByTestId('viewport-3d-canvas');
  await expect(container).toBeVisible();
  const tagName = await container.evaluate((el) => el.tagName.toLowerCase());
  if (tagName === 'canvas') {
    return container;
  }
  const innerCanvas = container.locator('canvas').first();
  await expect(innerCanvas).toBeVisible();
  return innerCanvas;
}

export async function waitForSceneReady(page: Page): Promise<void> {
  await expect(page.locator(`${ROOT_SELECTOR}[data-scene-ready="true"]`)).toBeVisible({
    timeout: 20_000,
  });
  const canvas = await get3DCanvasLocator(page);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(200);
  expect(box!.height).toBeGreaterThanOrEqual(150);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

export async function assertCanvasNonBlank(page: Page): Promise<void> {
  await waitForSceneReady(page);
  const canvas = await get3DCanvasLocator(page);
  const metrics = await canvas.evaluate((canvasEl) => {
    const glCanvas = canvasEl as HTMLCanvasElement;
    const offscreen = document.createElement('canvas');
    offscreen.width = 128;
    offscreen.height = 128;
    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      return { ok: false, reason: 'no-2d-context', nonZeroAlphaRatio: 0, distinctColors: 0, spread: 0 };
    }
    ctx.drawImage(glCanvas, 0, 0, 128, 128);
    const data = ctx.getImageData(0, 0, 128, 128).data;
    const totalPixels = 128 * 128;
    let nonZeroAlpha = 0;
    const buckets = new Set<number>();
    let minVal = 255;
    let maxVal = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0) {
        nonZeroAlpha++;
      }
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.add(key);
      minVal = Math.min(minVal, r, g, b);
      maxVal = Math.max(maxVal, r, g, b);
    }

    return {
      ok: true,
      reason: '',
      nonZeroAlphaRatio: nonZeroAlpha / totalPixels,
      distinctColors: buckets.size,
      spread: maxVal - minVal,
    };
  });

  expect(metrics.ok, metrics.reason).toBe(true);
  expect(metrics.nonZeroAlphaRatio).toBeGreaterThan(0.5);
  expect(metrics.distinctColors).toBeGreaterThanOrEqual(8);
  expect(metrics.spread).toBeGreaterThan(10);
}

export async function captureCanvasPngBuffer(page: Page, settleMs = 250): Promise<Buffer> {
  await waitForSceneReady(page);
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
  const canvas = await get3DCanvasLocator(page);
  return canvas.screenshot();
}

async function readDownloadBuffer(download: Download): Promise<Buffer> {
  const filePath = await download.path();
  if (filePath) {
    return fs.readFile(filePath);
  }
  const stream = await download.createReadStream();
  if (!stream) {
    throw new Error(`Unable to read download stream for ${download.suggestedFilename()}`);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function captureDownload(
  page: Page,
  trigger: () => Promise<void>,
): Promise<{ filename: string; buffer: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 25_000 }), trigger()]);
  const buffer = await readDownloadBuffer(download);
  return {
    filename: download.suggestedFilename(),
    buffer,
  };
}

export async function triggerExport(
  page: Page,
  testId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const directBtn = page.getByTestId(testId);
  const isAlreadyVisible = (await directBtn.count()) > 0 && (await directBtn.first().isVisible());
  if (!isAlreadyVisible) {
    await page.getByTestId('btn-export-menu').click();
    await expect(directBtn.first()).toBeVisible({ timeout: 10_000 });
  }
  return captureDownload(page, () => directBtn.first().click());
}

export function validateCsvDownload(buffer: Buffer, filename: string): string {
  expect(filename).toMatch(/\.csv$/i);
  expect(buffer.length).toBeGreaterThan(30);
  expect(buffer[0]).toBe(0xef);
  expect(buffer[1]).toBe(0xbb);
  expect(buffer[2]).toBe(0xbf);

  const text = buffer.toString('utf8');
  expect(text.startsWith('\uFEFF')).toBe(true);
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  expect(lines.length).toBeGreaterThanOrEqual(2);

  const header = lines[0];
  expect(header.split(';').length).toBeGreaterThanOrEqual(5);
  expect(header).toMatch(/rep[èe]re|pi[èe]ce/i);
  expect(header).toMatch(/module/i);
  expect(header).toMatch(/mat[ée]riau/i);
  expect(header).toMatch(/longueur|largeur|[ée]paisseur/i);
  expect(header).toMatch(/fil|chant/i);
  return text;
}

export function validateSvgDownload(buffer: Buffer, filename: string): string {
  expect(filename).toMatch(/\.svg$/i);
  const text = buffer.toString('utf8');
  expect(text).toContain('<svg');
  expect(text).toContain('</svg>');
  expect(text).toMatch(/viewBox=|width=/i);
  expect(text).toMatch(/<(line|rect|path|polygon|polyline)\b/i);
  expect(text).toMatch(/<text\b/i);
  expect(text).toMatch(/\d/);
  return text;
}

export function validatePdfDownload(buffer: Buffer, filename: string): void {
  expect(filename).toMatch(/\.pdf$/i);
  expect(buffer.length).toBeGreaterThan(2000);
  expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  const tail = buffer.subarray(Math.max(0, buffer.length - 256)).toString('ascii');
  expect(tail).toContain('%%EOF');
}

export function validatePngDownload(
  buffer: Buffer,
  filename: string,
  minWidth = 800,
  minHeight = 450,
): { width: number; height: number } {
  expect(filename).toMatch(/\.png$/i);
  expect(buffer.length).toBeGreaterThan(5000);
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buffer.subarray(0, 8).equals(pngMagic)).toBe(true);
  expect(buffer.subarray(12, 16).toString('ascii')).toBe('IHDR');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  expect(width).toBeGreaterThanOrEqual(minWidth);
  expect(height).toBeGreaterThanOrEqual(minHeight);
  expect(buffer.includes(Buffer.from('IDAT', 'ascii'))).toBe(true);
  return { width, height };
}

export function validateGlbDownload(buffer: Buffer, filename: string): {
  meshCount: number;
  nodeCount: number;
} {
  expect(filename).toMatch(/\.glb$/i);
  expect(buffer.length).toBeGreaterThan(100);
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67); // 'glTF'
  expect(buffer.readUInt32LE(4)).toBe(2);
  expect(buffer.readUInt32LE(8)).toBe(buffer.length);

  const chunk0Length = buffer.readUInt32LE(12);
  const chunk0Type = buffer.readUInt32LE(16);
  expect(chunk0Type).toBe(0x4e4f534a); // 'JSON'

  const jsonSlice = buffer.subarray(20, 20 + chunk0Length).toString('utf8').replace(/\0+$/, '').trim();
  const gltf = JSON.parse(jsonSlice) as {
    asset?: { version?: string };
    meshes?: unknown[];
    nodes?: unknown[];
  };
  expect(gltf.asset?.version).toBe('2.0');
  expect(Array.isArray(gltf.meshes)).toBe(true);
  expect(gltf.meshes!.length).toBeGreaterThan(0);

  return {
    meshCount: gltf.meshes!.length,
    nodeCount: Array.isArray(gltf.nodes) ? gltf.nodes.length : 0,
  };
}

export function validateJsonDownload(buffer: Buffer, filename: string): Record<string, unknown> {
  expect(filename).toMatch(/\.json$/i);
  const parsed = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>;
  expect(parsed).toBeTruthy();
  expect(typeof parsed).toBe('object');
  const doc =
    parsed.document && typeof parsed.document === 'object'
      ? (parsed.document as Record<string, unknown>)
      : parsed;
  expect(Array.isArray(doc.walls)).toBe(true);
  expect(Array.isArray(doc.modules)).toBe(true);
  return parsed;
}

export async function drawWallOn2DPlan(
  page: Page,
  startOffset: { x: number; y: number },
  endOffset: { x: number; y: number },
): Promise<void> {
  await openLeftPanelTab(page, 'catalogue');
  const toolBtn = page.getByTestId('tool-draw-wall');
  await expect(toolBtn).toBeVisible();
  await toolBtn.click();

  const viewport = page.getByTestId('viewport-2d-plan');
  await expect(viewport).toBeVisible();
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();

  const sx = box!.x + startOffset.x;
  const sy = box!.y + startOffset.y;
  const ex = box!.x + endOffset.x;
  const ey = box!.y + endOffset.y;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(ex, ey, { steps: 10 });
  await page.mouse.up();
}

export async function placeOpeningOrUtility(
  page: Page,
  labelRegex: RegExp,
  offset: { x: number; y: number },
): Promise<void> {
  await openLeftPanelTab(page, 'catalogue');
  const leftPanel = page.getByTestId('left-catalog-panel');
  const toolBtn = leftPanel
    .locator('[data-testid^="tool-add-"]')
    .filter({ hasText: labelRegex })
    .or(leftPanel.getByRole('button', { name: labelRegex }))
    .first();
  await expect(toolBtn).toBeVisible();
  await toolBtn.click();

  const viewport = page.getByTestId('viewport-2d-plan');
  await expect(viewport).toBeVisible();
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + offset.x, box!.y + offset.y);
}

export async function saveProjectToLibrary(page: Page, projectName: string): Promise<void> {
  const dialog = await openProjectLibrary(page);

  const saveBtn = dialog
    .getByRole('button', { name: /enregistrer le projet actuel|enregistrer|sauvegarder/i })
    .first();
  await expect(saveBtn).toBeVisible();
  await saveBtn.click();

  const activeBadge = dialog.getByText(/^Actif$/i).first();
  await expect(activeBadge).toBeVisible({ timeout: 10_000 });
  const activeCard = activeBadge.locator(
    'xpath=ancestor::*[self::div or self::article or self::li][.//img and .//button][1]',
  );

  const renameBtn = activeCard.getByRole('button', { name: /renommer/i }).first();
  await expect(renameBtn).toBeVisible();
  await renameBtn.click();

  const renameInput = activeCard.locator('input[type="text"], input:not([type])').first();
  await expect(renameInput).toBeVisible();
  await renameInput.fill(projectName);

  const confirmBtn = activeCard.getByRole('button', { name: /valider|confirmer/i }).first();
  await expect(confirmBtn).toBeVisible();
  await confirmBtn.click();

  await expect(dialog.getByText(projectName, { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await closeModalIfOpen(page);
}

export async function createBlankProject(page: Page): Promise<void> {
  const dialog = await openProjectLibrary(page);
  const newBtn = dialog
    .getByRole('button', { name: /nouveau projet vide|nouveau projet|projet vierge/i })
    .first();
  await expect(newBtn).toBeVisible();
  await newBtn.click();
  await closeModalIfOpen(page);

  await expect
    .poll(async () => (await getRootState(page)).moduleCount, { timeout: 10_000 })
    .toBe(0);
}

export async function clearAllWalls(page: Page): Promise<void> {
  await switchWorkspaceTab(page, 'conception');
  let state = await getRootState(page);
  while (state.wallCount > 0) {
    const inspector = getInspectorPanel(page);
    const firstWallBtn = inspector
      .getByText(/^Murs\s*\(/i)
      .locator('xpath=following-sibling::div[1]//button')
      .first();
    await expect(firstWallBtn).toBeVisible();
    await firstWallBtn.click();
    const deleteBtn = inspector.getByRole('button', { name: /supprimer/i }).first();
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();
    await expect
      .poll(async () => (await getRootState(page)).wallCount, { timeout: 5_000 })
      .toBe(state.wallCount - 1);
    state = await getRootState(page);
  }
  expect((await getRootState(page)).wallCount).toBe(0);
}

export async function getCutlistRowCount(page: Page): Promise<number> {
  await switchWorkspaceTab(page, 'cutlist');
  const rows = page.locator('table tbody tr');
  return rows.count();
}

export async function getCutlistText(page: Page): Promise<string> {
  await switchWorkspaceTab(page, 'cutlist');
  await expect(page.getByTestId('atelier-cutlist-view')).toBeVisible();
  await expect(page.locator('table')).toBeVisible();
  return page.getByTestId('atelier-cutlist-view').innerText();
}

export async function getDevisText(page: Page): Promise<string> {
  await switchWorkspaceTab(page, 'devis');
  await expect(page.getByTestId('atelier-devis-view')).toBeVisible();
  return page.getByTestId('atelier-devis-view').innerText();
}
