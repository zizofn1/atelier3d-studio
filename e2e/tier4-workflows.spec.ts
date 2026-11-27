import { expect, test } from '@playwright/test';
import {
  addModuleByFrenchLabel,
  assertCanvasNonBlank,
  assertFrenchAuthenticity,
  attachErrorGuard,
  captureCanvasPngBuffer,
  closeModalIfOpen,
  createBlankProject,
  drawWallOn2DPlan,
  getCutlistRowCount,
  getCutlistText,
  getDevisText,
  getInspectorPanel,
  getProjectCardLocator,
  getRootState,
  loadTemplate,
  openLeftPanelTab,
  openProjectLibrary,
  openStudio,
  parseFrenchMoney,
  placeOpeningOrUtility,
  reloadStudio,
  saveProjectToLibrary,
  selectInspectorDimensions,
  setNumericInput,
  switchViewMode,
  switchWorkspaceTab,
  triggerExport,
  validateCsvDownload,
  validateGlbDownload,
  validateJsonDownload,
  validatePdfDownload,
  validatePngDownload,
  validateSvgDownload,
} from './helpers/studio';

test.describe('Tier 4 — Real-World Application Workflows (T4-01 to T4-14)', () => {
  test.setTimeout(90_000);

  // =========================================================================
  // Workflow 1: Cuisine en L complète (T4-01 – T4-03)
  // =========================================================================
  test.describe('Workflow 1 — Cuisine en L complète', () => {
    test('T4-01 — Implantation L, fenêtre, réseaux et élévations par mur sans collision', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      await placeOpeningOrUtility(page, /Fen[êe]tre/i, { x: 260, y: 180 });
      await placeOpeningOrUtility(page, /Prise/i, { x: 320, y: 180 });
      await placeOpeningOrUtility(page, /Arriv[ée]e d'eau|Plomberie/i, { x: 380, y: 180 });

      await expect(page.getByText(/collision d[ée]tect[ée]e|chevauchement/i)).toHaveCount(0);
      await switchViewMode(page, 'elevation');
      const wallSelectors = page.locator('[data-testid^="wall-selector-"]');
      expect(await wallSelectors.count()).toBeGreaterThanOrEqual(2);
      await wallSelectors.nth(1).click();
      await expect(page.getByTestId('viewport-2d-elevation').locator('svg').first()).toBeVisible();

      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('T4-02 — Ensemble Cuisine 8 modules, LED/Nuit, Ouvrir tout, PNG 3D et GLB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      for (const pat of [/Îlot central|Ilot central/i, /Plan de travail/i, /Cr[ée]dence/i, /Plinthe/i]) {
        await addModuleByFrenchLabel(page, pat);
      }
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      const before = await captureCanvasPngBuffer(page);

      await page.getByTestId('btn-lighting-toggle').click();
      await page.getByTestId('btn-led-toggle').click();
      await page.getByTestId('btn-toggle-open-all').click();
      const after = await captureCanvasPngBuffer(page, 600);
      expect(Buffer.compare(before, after)).not.toBe(0);

      const png = await triggerExport(page, 'export-render-png');
      validatePngDownload(png.buffer, png.filename, 800, 450);

      const glb = await triggerExport(page, 'export-scene-glb');
      const glbInfo = validateGlbDownload(glb.buffer, glb.filename);
      expect(glbInfo.meshCount).toBeGreaterThan(4);
      guard.assertNoErrors();
    });

    test('T4-03 — Dossier complet production Cuisine (CSV, PDFs, Plan/Élévation SVG & PDF)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');

      await switchWorkspaceTab(page, 'cutlist');
      const csv = await triggerExport(page, 'export-cutlist-csv');
      validateCsvDownload(csv.buffer, csv.filename);
      const cutPdf = await triggerExport(page, 'export-cutlist-pdf');
      validatePdfDownload(cutPdf.buffer, cutPdf.filename);

      await switchWorkspaceTab(page, 'nesting');
      await expect(page.locator('svg').first()).toBeVisible();
      const nestPdf = await triggerExport(page, 'export-nesting-pdf');
      validatePdfDownload(nestPdf.buffer, nestPdf.filename);

      await switchWorkspaceTab(page, 'devis');
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/Charni[èe]re/i);
      const devisPdf = await triggerExport(page, 'export-devis-pdf');
      validatePdfDownload(devisPdf.buffer, devisPdf.filename);

      const planSvg = await triggerExport(page, 'export-plan-svg');
      validateSvgDownload(planSvg.buffer, planSvg.filename);
      const elevPdf = await triggerExport(page, 'export-elevation-pdf');
      validatePdfDownload(elevPdf.buffer, elevPdf.filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // Workflow 2: Dressing sur-mesure (T4-04 – T4-06)
  // =========================================================================
  test.describe('Workflow 2 — Dressing sur-mesure', () => {
    test('T4-04 — Composition murale Dressing complète avec cotations élévation', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      for (const pat of [/Penderie/i, /[ÉE]tag[èe]res/i, /Tiroirs/i, /Portes battantes/i, /Portes coulissantes/i]) {
        await addModuleByFrenchLabel(page, pat);
      }
      await switchViewMode(page, 'elevation');
      const elevText = await page.getByTestId('viewport-2d-elevation').innerText();
      expect(elevText).toMatch(/\d{3,4}/);
      guard.assertNoErrors();
    });

    test('T4-05 — Paramétrage 19 mm, fond 8 mm rainuré, chants 2 mm, visite libre ZQSD', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      await openLeftPanelTab(page, 'atelier');
      const leftPanel = page.locator('aside').first();
      const boardThick = leftPanel.getByLabel(/^[ée]paisseur panneau/i).first();
      const backThick = leftPanel.getByLabel(/fond.*([ée]paisseur|mm)|[ée]paisseur.*fond/i).first();
      const backMode = leftPanel.getByLabel(/montage.*fond|type.*fond|rainur[ée]|appliqu[ée]/i).first();
      const edgeSelect = leftPanel
        .getByLabel(/chant/i)
        .or(getInspectorPanel(page).getByLabel(/chant/i))
        .first();

      await expect(boardThick).toBeVisible();
      await expect(backThick).toBeVisible();
      await expect(backMode).toBeVisible();
      await expect(edgeSelect).toBeVisible();

      await boardThick.selectOption('19');
      await backThick.selectOption('8');
      const modeOpts = await backMode.locator('option').allInnerTexts();
      const rainureIdx = modeOpts.findIndex((o) => /rainur[ée]/i.test(o));
      expect(rainureIdx).toBeGreaterThanOrEqual(0);
      await backMode.selectOption({ index: rainureIdx });

      const edgeOpts = await edgeSelect.locator('option').allInnerTexts();
      const edge2Idx = edgeOpts.findIndex((o) => /\b2\b/.test(o));
      expect(edge2Idx).toBeGreaterThanOrEqual(0);
      await edgeSelect.selectOption({ index: edge2Idx });

      const cutText = await getCutlistText(page);
      expect(cutText).toContain('19');
      expect(cutText).toContain('8');
      expect(cutText).toMatch(/\b2\b/);

      await switchViewMode(page, '3d');
      await page.getByTestId('btn-toggle-open-all').click();
      await page.getByTestId('btn-camera-mode').click();
      await page.keyboard.press('KeyZ');
      await page.keyboard.press('KeyQ');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('T4-06 — Calepinage fil verrouillé, quincaillerie Dressing et exports atelier', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');

      await switchWorkspaceTab(page, 'nesting');
      const grainLock = page.getByLabel(/respecter le sens du fil/i).first();
      await expect(grainLock).toBeVisible();
      await grainLock.check();
      await expect(grainLock).toBeChecked();
      await expect(page.locator('svg').first()).toBeVisible();
      const nestPdf = await triggerExport(page, 'export-nesting-pdf');
      validatePdfDownload(nestPdf.buffer, nestPdf.filename);

      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/Charni[èe]re|Coulisse/i);
      const devisPdf = await triggerExport(page, 'export-devis-pdf');
      validatePdfDownload(devisPdf.buffer, devisPdf.filename);

      await switchWorkspaceTab(page, 'cutlist');
      const csv = await triggerExport(page, 'export-cutlist-csv');
      validateCsvDownload(csv.buffer, csv.filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // Workflow 3: Espace Séjour / Bureau sur-mesure (T4-07 – T4-08)
  // =========================================================================
  test.describe('Workflow 3 — Espace Séjour / Bureau sur-mesure', () => {
    test('T4-07 — Pièce en U avec porte, fenêtre, poteau et Meuble TV + Bibliothèque + Bureau', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, 'plan');
      await drawWallOn2DPlan(page, { x: 140, y: 140 }, { x: 520, y: 140 });
      await drawWallOn2DPlan(page, { x: 520, y: 140 }, { x: 520, y: 420 });
      await drawWallOn2DPlan(page, { x: 140, y: 140 }, { x: 140, y: 420 });
      expect((await getRootState(page)).wallCount).toBeGreaterThanOrEqual(3);

      await placeOpeningOrUtility(page, /Porte(?!s)/i, { x: 200, y: 140 });
      await placeOpeningOrUtility(page, /Fen[êe]tre/i, { x: 360, y: 140 });
      await placeOpeningOrUtility(page, /Poteau/i, { x: 520, y: 260 });

      await addModuleByFrenchLabel(page, /Meuble TV/i);
      await addModuleByFrenchLabel(page, /Biblioth[èe]que/i);
      await addModuleByFrenchLabel(page, /Bureau/i);
      expect((await getRootState(page)).moduleCount).toBe(3);
      guard.assertNoErrors();
    });

    test('T4-08 — Plans clients multi-murs (SVG/PDF), rendu Nuit PNG et scène GLB Séjour/Bureau', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, 'plan');
      await drawWallOn2DPlan(page, { x: 150, y: 150 }, { x: 500, y: 150 });
      await drawWallOn2DPlan(page, { x: 500, y: 150 }, { x: 500, y: 400 });
      await addModuleByFrenchLabel(page, /Meuble TV/i);
      await addModuleByFrenchLabel(page, /Biblioth[èe]que/i);
      await addModuleByFrenchLabel(page, /Bureau/i);

      await switchViewMode(page, 'elevation');
      await expect(page.getByTestId('viewport-2d-elevation').locator('svg').first()).toBeVisible();

      const planSvg = await triggerExport(page, 'export-plan-svg');
      validateSvgDownload(planSvg.buffer, planSvg.filename);
      const elevSvg = await triggerExport(page, 'export-elevation-svg');
      validateSvgDownload(elevSvg.buffer, elevSvg.filename);
      const planPdf = await triggerExport(page, 'export-plan-pdf');
      validatePdfDownload(planPdf.buffer, planPdf.filename);

      await switchViewMode(page, '3d');
      await page.getByTestId('btn-lighting-toggle').click();
      const png = await triggerExport(page, 'export-render-png');
      validatePngDownload(png.buffer, png.filename, 800, 450);

      const glb = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(glb.buffer, glb.filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // Workflow 4: Workflow Devis & Atelier Maroc (MAD, TVA 20%) (T4-09 – T4-11)
  // =========================================================================
  test.describe('Workflow 4 — Devis & Atelier Maroc (MAD, TVA 20%)', () => {
    test('T4-09 — Paramétrage scie atelier Maroc (2440×1220, trait 4 mm, délignage 15 mm, fil ON)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');

      await page.getByLabel(/format.*panneau|panneau|feuille/i).first().selectOption({ index: 1 });
      await setNumericInput(page.getByLabel(/trait de scie/i).first(), 4);
      await setNumericInput(page.getByLabel(/d[ée]lignage/i).first(), 15);
      const grainLock = page.getByLabel(/respecter le sens du fil/i).first();
      await expect(grainLock).toBeVisible();
      await grainLock.check();
      await expect(grainLock).toBeChecked();

      await expect(page.locator('svg').first()).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/Taux de chute/i);
      const nestPdf = await triggerExport(page, 'export-nesting-pdf');
      validatePdfDownload(nestPdf.buffer, nestPdf.filename);
      guard.assertNoErrors();
    });

    test('T4-10 — Chiffrage MAD, marge, main d’œuvre, TVA 20%, en-tête client et Devis PDF', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      expect((await getRootState(page)).currency).toBe('MAD');

      await switchWorkspaceTab(page, 'devis');
      const marginInput = page.getByLabel(/marge/i).first();
      const laborInput = page.getByLabel(/main d['’]œuvre|main-d['’]œuvre/i).first();
      const tvaInput = page.getByLabel(/tva/i).first();
      const clientInput = page.getByLabel(/client/i).first();

      await expect(marginInput).toBeVisible();
      await expect(laborInput).toBeVisible();
      await expect(tvaInput).toBeVisible();
      await expect(clientInput).toBeVisible();

      await setNumericInput(marginInput, 25);
      await setNumericInput(laborInput, 15);
      await setNumericInput(tvaInput, 20);
      await clientInput.fill('Résidence Anfa — M. Benali');
      await expect(clientInput).toHaveValue('Résidence Anfa — M. Benali');

      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/MAD/);
      expect(devisText).toMatch(/TVA/i);
      expect(devisText).toMatch(/HT/i);
      expect(devisText).toMatch(/TTC/i);
      const ht = parseFrenchMoney(devisText, /Total\s*HT/i);
      const ttc = parseFrenchMoney(devisText, /Total\s*TTC/i);
      expect(ht).toBeGreaterThan(0);
      expect(Math.abs(ttc - ht * 1.2)).toBeLessThanOrEqual(0.5);

      const devisPdf = await triggerExport(page, 'export-devis-pdf');
      validatePdfDownload(devisPdf.buffer, devisPdf.filename);
      guard.assertNoErrors();
    });

    test('T4-11 — Comparatif multi-devises MAD → EUR → USD → MAD et pack complet atelier', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');

      await page.getByTestId('currency-select').selectOption('EUR');
      expect(await getDevisText(page)).toMatch(/€|EUR/);
      await page.getByTestId('currency-select').selectOption('USD');
      expect(await getDevisText(page)).toMatch(/\$|USD/);
      await page.getByTestId('currency-select').selectOption('MAD');
      expect(await getDevisText(page)).toMatch(/MAD/);

      await switchWorkspaceTab(page, 'cutlist');
      validateCsvDownload(...(await (async () => { const r = await triggerExport(page, 'export-cutlist-csv'); return [r.buffer, r.filename] as const; })()));
      validatePdfDownload(...(await (async () => { const r = await triggerExport(page, 'export-cutlist-pdf'); return [r.buffer, r.filename] as const; })()));
      await switchWorkspaceTab(page, 'nesting');
      validatePdfDownload(...(await (async () => { const r = await triggerExport(page, 'export-nesting-pdf'); return [r.buffer, r.filename] as const; })()));
      await switchWorkspaceTab(page, 'devis');
      validatePdfDownload(...(await (async () => { const r = await triggerExport(page, 'export-devis-pdf'); return [r.buffer, r.filename] as const; })()));
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // Workflow 5: Cycle complet Persistance & Reprise (T4-12 – T4-14)
  // =========================================================================
  test.describe('Workflow 5 — Cycle complet Persistance & Reprise', () => {
    test('T4-12 — Création from scratch, Undo/Redo et sauvegarde IndexedDB avec miniature', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, 'plan');
      await drawWallOn2DPlan(page, { x: 150, y: 150 }, { x: 480, y: 150 });
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await addModuleByFrenchLabel(page, /Caisson haut/i);
      await page.getByTestId('btn-undo').click();
      await page.getByTestId('btn-redo').click();
      expect((await getRootState(page)).moduleCount).toBe(2);

      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      await saveProjectToLibrary(page, 'Projet Cycle E2E');

      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Projet Cycle E2E');
      await expect(card).toBeVisible();
      const thumb = card.locator('img').first();
      await expect(thumb).toBeVisible();
      expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await closeModalIfOpen(page);
      guard.assertNoErrors();
    });

    test('T4-13 — Rechargement page.reload() et reprise intégrale depuis IndexedDB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 920);
      await saveProjectToLibrary(page, 'Reprise Complète Reload');

      await reloadStudio(page);
      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Reprise Complète Reload');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /ouvrir|charger/i }).first().click();

      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(1);
      const cutText = await getCutlistText(page);
      expect(cutText).toContain('920');
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      await assertFrenchAuthenticity(page);
      guard.assertNoErrors();
    });

    test('T4-14 — Portabilité .json export, bascule modèle et ré-import fidèle', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await addModuleByFrenchLabel(page, /Bureau/i);
      const expected = await getRootState(page);
      const expectedCutRows = await getCutlistRowCount(page);

      const { filename, buffer } = await triggerExport(page, 'export-project-json');
      validateJsonDownload(buffer, filename);

      await loadTemplate(page, 'Dressing sur-mesure');
      const dialog = await openProjectLibrary(page);
      await dialog.locator('input[type="file"]').first().setInputFiles({
        name: filename,
        mimeType: 'application/json',
        buffer,
      });
      await closeModalIfOpen(page);

      await expect.poll(async () => (await getRootState(page)).wallCount).toBe(expected.wallCount);
      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(expected.moduleCount);
      expect(await getCutlistRowCount(page)).toBe(expectedCutRows);
      guard.assertNoErrors();
    });
  });
});
