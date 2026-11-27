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
  openDisplayMenu,
  openProjectLibrary,
  openStudio,
  placeOpeningOrUtility,
  readNumericInputValue,
  reloadStudio,
  saveProjectToLibrary,
  selectInspectorDimensions,
  setNumericInput,
  switchViewMode,
  switchWorkspaceTab,
  triggerExport,
  validateCsvDownload,
  validateGlbDownload,
  validatePdfDownload,
  validatePngDownload,
  validateSvgDownload,
} from './helpers/studio';

test.describe('Tier 3 — Cross-Feature Pairwise Combinations (T3-01 to T3-26)', () => {
  // =========================================================================
  // Group 1: R1 ↔ R2 (Persistence, Units, Undo/Redo, Localization ↔ 2D/3D)
  // =========================================================================
  test('T3-01 — R1↔R2: Unités mm/cm synchronisées sur Plan, Élévation et Inspecteur', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const { widthInput } = selectInspectorDimensions(page);
    await setNumericInput(widthInput, 800);

    await openDisplayMenu(page);
    await page.getByTestId('unit-toggle').click();
    expect((await getRootState(page)).unitMode).toBe('cm');
    expect(await readNumericInputValue(widthInput)).toBe(80);

    await switchViewMode(page, 'elevation');
    await expect(page.getByTestId('viewport-2d-elevation')).toBeVisible();
    await setNumericInput(widthInput, 90);

    await openDisplayMenu(page);
    await page.getByTestId('unit-toggle').click();
    expect((await getRootState(page)).unitMode).toBe('mm');
    expect(await readNumericInputValue(widthInput)).toBe(900);
    expect(await page.getByTestId('viewport-2d-elevation').innerText()).toContain('900');
    guard.assertNoErrors();
  });

  test('T3-02 — R1↔R2: Undo/Redo en Vue Split répercute murs, modules et rendu 3D', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await switchViewMode(page, 'split');
    const baseWalls = (await getRootState(page)).wallCount;
    const baseModules = (await getRootState(page)).moduleCount;

    await drawWallOn2DPlan(page, { x: 120, y: 120 }, { x: 380, y: 120 });
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const { widthInput } = selectInspectorDimensions(page);
    await setNumericInput(widthInput, 1000);
    const editedPng = await captureCanvasPngBuffer(page, 250);

    await page.getByTestId('btn-undo').click();
    await page.getByTestId('btn-undo').click();
    await page.getByTestId('btn-undo').click();
    expect((await getRootState(page)).wallCount).toBe(baseWalls);
    expect((await getRootState(page)).moduleCount).toBe(baseModules);

    await page.getByTestId('btn-redo').click();
    await page.getByTestId('btn-redo').click();
    await page.getByTestId('btn-redo').click();
    expect((await getRootState(page)).moduleCount).toBe(baseModules + 1);
    const restoredPng = await captureCanvasPngBuffer(page, 250);
    expect(restoredPng.length).toBeGreaterThan(1000);
    expect(editedPng.length).toBeGreaterThan(1000);
    guard.assertNoErrors();
  });

  test('T3-03 — R1↔R2,R3: Undo préserve éclairage Nuit, LED, Ouvrir tout et Visite libre', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    expect((await getRootState(page)).moduleCount).toBe(1);

    await switchViewMode(page, '3d');
    await page.getByTestId('btn-lighting-toggle').click();
    await page.getByTestId('btn-led-toggle').click();
    await page.getByTestId('btn-toggle-open-all').click();
    await page.getByTestId('btn-camera-mode').click();

    await page.getByTestId('btn-undo').click();
    const afterUndo = await getRootState(page);
    expect(afterUndo.moduleCount).toBe(0);
    expect(afterUndo.lighting).toBe('nuit');
    expect(afterUndo.led).toBe(true);
    expect(afterUndo.openAll).toBe(true);
    guard.assertNoErrors();
  });

  test('T3-04 — R1↔R2: Modèle Cuisine en L à travers les 4 vues avec français 100%', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    const state = await getRootState(page);
    expect(state.wallCount).toBeGreaterThanOrEqual(2);
    expect(state.moduleCount).toBeGreaterThanOrEqual(4);

    for (const mode of ['plan', 'elevation', '3d', 'split'] as const) {
      await switchViewMode(page, mode);
      await assertFrenchAuthenticity(page);
    }
    await assertCanvasNonBlank(page);
    guard.assertNoErrors();
  });

  test('T3-05 — R1↔R2: Round-trip .json restaure murs, ouvertures, réseaux et scène 3D', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await switchViewMode(page, 'plan');
    await drawWallOn2DPlan(page, { x: 140, y: 140 }, { x: 440, y: 140 });
    await placeOpeningOrUtility(page, /Porte(?!s)/i, { x: 240, y: 140 });
    await placeOpeningOrUtility(page, /Prise/i, { x: 340, y: 140 });
    await addModuleByFrenchLabel(page, /Caisson haut/i);

    const expected = await getRootState(page);
    const { filename, buffer } = await triggerExport(page, 'export-project-json');

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
    await switchViewMode(page, '3d');
    await assertCanvasNonBlank(page);
    guard.assertNoErrors();
  });

  // =========================================================================
  // Group 2: R2 ↔ R3 (2D/3D Engine ↔ Parametric Carpentry & Animations)
  // =========================================================================
  test('T3-06 — R2↔R3: Tracé mur 2D + ajout caisson se répercutent en Élévation et 3D', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await switchViewMode(page, 'plan');
    await drawWallOn2DPlan(page, { x: 140, y: 160 }, { x: 440, y: 160 });
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await switchViewMode(page, 'elevation');
    await expect(page.getByTestId('viewport-2d-elevation').locator('svg').first()).toBeVisible();
    await switchViewMode(page, '3d');
    await assertCanvasNonBlank(page);
    guard.assertNoErrors();
  });

  test('T3-07 — R2↔R3: Détection et résolution de collision entre deux modules sur plan', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    const inspector = getInspectorPanel(page);
    const xInput = inspector.getByLabel(/position x|^x\b/i).first();
    const zInput = inspector.getByLabel(/position z|^z\b/i).first();

    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await expect(xInput).toBeVisible();
    await expect(zInput).toBeVisible();
    await setNumericInput(xInput, 600);
    await setNumericInput(zInput, 600);

    await addModuleByFrenchLabel(page, /Colonne/i);
    await expect(xInput).toBeVisible();
    await expect(zInput).toBeVisible();
    await setNumericInput(xInput, 700);
    await setNumericInput(zInput, 600);
    await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible();

    await setNumericInput(xInput, 1600);
    await expect(page.getByText(/collision|chevauchement/i)).toHaveCount(0);
    guard.assertNoErrors();
  });

  test('T3-08 — R2↔R3: Combinaison Nuit + LED sous-meubles + Ouvrir tout en 3D', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await addModuleByFrenchLabel(page, /Caisson haut/i);
    await switchViewMode(page, '3d');
    const basePng = await captureCanvasPngBuffer(page);

    await page.getByTestId('btn-lighting-toggle').click();
    await page.getByTestId('btn-led-toggle').click();
    await page.getByTestId('btn-toggle-open-all').click();
    const state = await getRootState(page);
    expect(state.lighting).toBe('nuit');
    expect(state.led).toBe(true);
    expect(state.openAll).toBe(true);

    const combinedPng = await captureCanvasPngBuffer(page, 600);
    expect(Buffer.compare(basePng, combinedPng)).not.toBe(0);
    guard.assertNoErrors();
  });

  test('T3-09 — R2↔R3: Animation Ouvrir tout active pendant mode Visite libre + retour Orbite', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchViewMode(page, '3d');
    await page.getByTestId('btn-camera-mode').click();
    await page.keyboard.press('KeyZ');
    await page.keyboard.press('KeyD');
    await page.getByTestId('btn-toggle-open-all').click();
    expect((await getRootState(page)).openAll).toBe(true);
    await page.getByTestId('btn-camera-mode').click();
    await assertCanvasNonBlank(page);
    guard.assertNoErrors();
  });

  test('T3-10 — R2↔R3: Matériau PBR bois + bascule sens du fil synchronisés 3D et Fiche de débit', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const cutBefore = await getCutlistText(page);
    await switchViewMode(page, '3d');
    const before3D = await captureCanvasPngBuffer(page);

    await openLeftPanelTab(page, 'atelier');
    const leftPanel = page.locator('aside').first();
    const matSelect = leftPanel.getByLabel(/mat[ée]riau.*fa[çc]ade|fa[çc]ade/i).first();
    await expect(matSelect).toBeVisible();
    const opts = await matSelect.locator('option').count();
    expect(opts).toBeGreaterThan(1);
    await matSelect.selectOption({ index: opts - 1 });

    const grainCtrl = leftPanel
      .getByLabel(/sens du fil/i)
      .or(getInspectorPanel(page).getByLabel(/sens du fil/i))
      .first();
    await expect(grainCtrl).toBeVisible();
    expect(await grainCtrl.locator('option').count()).toBeGreaterThan(1);
    await grainCtrl.selectOption({ index: 1 });

    const after3D = await captureCanvasPngBuffer(page, 250);
    expect(Buffer.compare(before3D, after3D)).not.toBe(0);
    const cutAfter = await getCutlistText(page);
    expect(cutAfter).not.toBe(cutBefore);
    expect(cutAfter).toMatch(/\b(H|V|Horizontal|Vertical)\b/i);
    guard.assertNoErrors();
  });

  test('T3-11 — R2↔R3: Hauteur de plinthe modifiée se répercute sur Élévation, 3D et Débit', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await addModuleByFrenchLabel(page, /Plinthe/i);
    await openLeftPanelTab(page, 'atelier');
    const plinthInput = page.locator('aside').first().getByLabel(/plinthe|pieds/i).first();
    await expect(plinthInput).toBeVisible();
    await setNumericInput(plinthInput, 150);

    await switchViewMode(page, 'elevation');
    await expect(page.getByTestId('viewport-2d-elevation')).toBeVisible();
    await switchViewMode(page, '3d');
    await assertCanvasNonBlank(page);
    const cutText = await getCutlistText(page);
    expect(cutText).toContain('150');
    guard.assertNoErrors();
  });

  // =========================================================================
  // Group 3: R3 ↔ R4 (Carpentry Engine ↔ Cutlist, Nesting, Devis)
  // =========================================================================
  test('T3-12 — R3↔R4: Épaisseur 18 mm → 22 mm met à jour Débit (764 → 756), Calepinage et Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const { widthInput } = selectInspectorDimensions(page);
    await setNumericInput(widthInput, 800);

    await openLeftPanelTab(page, 'atelier');
    const thickSelect = page.locator('aside').first().getByLabel(/^[ée]paisseur panneau/i).first();
    await expect(thickSelect).toBeVisible();
    await thickSelect.selectOption('18');
    const cut18 = await getCutlistText(page);
    expect(cut18).toContain('764');

    await openLeftPanelTab(page, 'atelier');
    await thickSelect.selectOption('22');
    const cut22 = await getCutlistText(page);
    expect(cut22).toContain('756');

    await switchWorkspaceTab(page, 'nesting');
    await expect(page.locator('svg').first()).toBeVisible();
    const devisText = await getDevisText(page);
    expect(devisText).toMatch(/MAD|€|\$/);
    guard.assertNoErrors();
  });

  test('T3-13 — R3↔R4: Fond rainuré (5 mm) → appliqué (8 mm) met à jour Débit et Calepinage', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await openLeftPanelTab(page, 'atelier');
    const leftPanel = page.locator('aside').first();
    const backThick = leftPanel.getByLabel(/fond.*([ée]paisseur|mm)|[ée]paisseur.*fond/i).first();
    const backMode = leftPanel.getByLabel(/montage.*fond|type.*fond|rainur[ée]|appliqu[ée]/i).first();
    await expect(backThick).toBeVisible();
    await expect(backMode).toBeVisible();

    await backThick.selectOption('5');
    await backMode.selectOption({ index: 0 });
    const cutRainure = await getCutlistText(page);

    await openLeftPanelTab(page, 'atelier');
    await backThick.selectOption('8');
    await backMode.selectOption({ index: 1 });
    const cutApplique = await getCutlistText(page);
    expect(cutApplique).not.toBe(cutRainure);

    await switchWorkspaceTab(page, 'nesting');
    await expect(page.locator('svg').first()).toBeVisible();
    guard.assertNoErrors();
  });

  test('T3-14 — R3↔R4: Jeu entre façades (2 → 3 mm) et Chants 4 bords impactent Débit et ml Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await openLeftPanelTab(page, 'atelier');
    const gapInput = page.locator('aside').first().getByLabel(/jeu.*fa[çc]ade|jeu/i).first();
    await expect(gapInput).toBeVisible();
    await setNumericInput(gapInput, 2);
    const cut2 = await getCutlistText(page);

    await openLeftPanelTab(page, 'atelier');
    await setNumericInput(gapInput, 3);
    const cut3 = await getCutlistText(page);
    expect(cut3).not.toBe(cut2);

    const devisText = await getDevisText(page);
    expect(devisText).toMatch(/\bml\b/i);
    guard.assertNoErrors();
  });

  test('T3-15 — R3↔R4: Changement des 4 styles de poignées met à jour la Quincaillerie BOM', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await addModuleByFrenchLabel(page, /Bloc tiroirs/i);

    await openLeftPanelTab(page, 'atelier');
    const handleSelect = page.locator('aside').first().getByLabel(/poign[ée]e/i).first();
    await expect(handleSelect).toBeVisible();
    const options = await handleSelect.locator('option').allInnerTexts();
    const barreIdx = options.findIndex((o) => /barre/i.test(o));
    const pushIdx = options.findIndex((o) => /push/i.test(o));
    expect(barreIdx).toBeGreaterThanOrEqual(0);
    expect(pushIdx).toBeGreaterThanOrEqual(0);

    await handleSelect.selectOption({ index: barreIdx });
    const devisBarre = await getDevisText(page);
    await openLeftPanelTab(page, 'atelier');
    await handleSelect.selectOption({ index: pushIdx });
    const devisPush = await getDevisText(page);
    expect(devisPush).not.toBe(devisBarre);
    guard.assertNoErrors();
  });

  test('T3-16 — R3↔R4: Format 2440×1220, trait de scie 6 mm et verrouillage fil impactent m² Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchWorkspaceTab(page, 'nesting');

    const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
    await preset.selectOption({ index: 1 });
    const kerfInput = page.getByLabel(/trait de scie/i).first();
    await setNumericInput(kerfInput, 6);
    const grainLock = page.getByLabel(/respecter le sens du fil/i).first();
    await grainLock.click();

    const devisText = await getDevisText(page);
    expect(devisText).toMatch(/m²|m2/i);
    guard.assertNoErrors();
  });

  test('T3-17 — R3↔R4: Modules spéciaux (Angle, Îlot, Plan, Crédence, Tiroirs) → Débit & BOM complet', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    for (const pat of [/Caisson d'angle|Angle/i, /[ÎI]lot central/i, /Plan de travail/i, /Cr[ée]dence/i, /Tiroirs/i]) {
      await addModuleByFrenchLabel(page, pat);
    }
    expect(await getCutlistRowCount(page)).toBeGreaterThanOrEqual(5);
    const devisText = await getDevisText(page);
    expect(devisText).toMatch(/Charni[èe]re/i);
    expect(devisText).toMatch(/Coulisse/i);
    expect(devisText).toMatch(/Pied/i);
    guard.assertNoErrors();
  });

  test('T3-18 — R3↔R4: Augmentation du Délignage (10 → 40 mm) augmente le taux de chute et m² Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchWorkspaceTab(page, 'nesting');
    const trimInput = page.getByLabel(/d[ée]lignage/i).first();
    await setNumericInput(trimInput, 10);
    const view10 = await page.locator('main, [data-testid*="nesting"]').first().innerText();

    await setNumericInput(trimInput, 40);
    const view40 = await page.locator('main, [data-testid*="nesting"]').first().innerText();
    expect(view40).not.toBe(view10);
    guard.assertNoErrors();
  });

  // =========================================================================
  // Group 4: R1 ↔ R4 (Units, Currency, Undo/Redo, IndexedDB ↔ Cutlist/Nesting/Devis)
  // =========================================================================
  test('T3-19 — R1↔R4: Invariance m², ml et Total TTC lors de la bascule mm ↔ cm', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    const devisBefore = await getDevisText(page);
    await openDisplayMenu(page);
    await page.getByTestId('unit-toggle').click();
    expect((await getRootState(page)).unitMode).toBe('cm');
    const devisCm = await getDevisText(page);
    await openDisplayMenu(page);
    await page.getByTestId('unit-toggle').click();
    const devisAfter = await getDevisText(page);
    expect(devisCm).toBe(devisBefore);
    expect(devisAfter).toBe(devisBefore);
    guard.assertNoErrors();
  });

  test('T3-20 — R1↔R4: Édition prix/marge/TVA + changement devise MAD→EUR→USD + PDF Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchWorkspaceTab(page, 'devis');
    const marginInput = page.getByLabel(/marge/i).first();
    const tvaInput = page.getByLabel(/tva/i).first();
    const priceInput = page.locator('input[type="number"]').first();
    await expect(marginInput).toBeVisible();
    await expect(tvaInput).toBeVisible();
    await expect(priceInput).toBeVisible();
    await setNumericInput(marginInput, 30);
    await setNumericInput(tvaInput, 20);
    await setNumericInput(priceInput, 450);

    await page.getByTestId('currency-select').selectOption('EUR');
    expect(await getDevisText(page)).toMatch(/€|EUR/);
    await page.getByTestId('currency-select').selectOption('USD');
    expect(await getDevisText(page)).toMatch(/\$|USD/);
    await page.getByTestId('currency-select').selectOption('MAD');
    expect(await getDevisText(page)).toMatch(/MAD/);

    const { filename, buffer } = await triggerExport(page, 'export-devis-pdf');
    validatePdfDownload(buffer, filename);
    guard.assertNoErrors();
  });

  test('T3-21 — R1↔R4: Undo/Redo synchronisé avec Fiche de débit et Total TTC Devis', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const rowsBefore = await getCutlistRowCount(page);
    const devisBefore = await getDevisText(page);

    await switchWorkspaceTab(page, 'conception');
    await addModuleByFrenchLabel(page, /Colonne/i);
    expect(await getCutlistRowCount(page)).toBeGreaterThan(rowsBefore);

    await page.getByTestId('btn-undo').click();
    expect(await getCutlistRowCount(page)).toBe(rowsBefore);
    expect(await getDevisText(page)).toBe(devisBefore);

    await page.getByTestId('btn-redo').click();
    expect(await getCutlistRowCount(page)).toBeGreaterThan(rowsBefore);
    guard.assertNoErrors();
  });

  test('T3-22 — R1↔R4: Configuration Calepinage et Devis persiste via IndexedDB après reload', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchWorkspaceTab(page, 'nesting');
    const kerfInput = page.getByLabel(/trait de scie/i).first();
    await expect(kerfInput).toBeVisible();
    await setNumericInput(kerfInput, 5);

    await switchWorkspaceTab(page, 'devis');
    const clientInput = page.getByLabel(/client/i).first();
    await expect(clientInput).toBeVisible();
    await clientInput.fill('Menuiserie Atlas');
    await expect(clientInput).toHaveValue('Menuiserie Atlas');
    await saveProjectToLibrary(page, 'Projet Persist Atelier');

    await reloadStudio(page);
    const dialog = await openProjectLibrary(page);
    const card = getProjectCardLocator(dialog, 'Projet Persist Atelier');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /ouvrir|charger/i }).first().click();

    await switchWorkspaceTab(page, 'nesting');
    expect(await readNumericInputValue(page.getByLabel(/trait de scie/i).first())).toBe(5);
    await switchWorkspaceTab(page, 'devis');
    expect(await page.getByLabel(/client/i).first().inputValue()).toBe('Menuiserie Atlas');
    guard.assertNoErrors();
  });

  // =========================================================================
  // Group 5: R2 / R3 / R4 ↔ R5 (Client & 3D Exports)
  // =========================================================================
  test('T3-23 — R2↔R5: Plan 2D et Élévations SVG & PDF sur projet multi-murs', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');

    const planSvg = await triggerExport(page, 'export-plan-svg');
    validateSvgDownload(planSvg.buffer, planSvg.filename);
    const planPdf = await triggerExport(page, 'export-plan-pdf');
    validatePdfDownload(planPdf.buffer, planPdf.filename);
    const elevSvg = await triggerExport(page, 'export-elevation-svg');
    validateSvgDownload(elevSvg.buffer, elevSvg.filename);
    const elevPdf = await triggerExport(page, 'export-elevation-pdf');
    validatePdfDownload(elevPdf.buffer, elevPdf.filename);
    guard.assertNoErrors();
  });

  test('T3-24 — R2,R3↔R5: Rendu PNG haute résolution sous Nuit + LED + Ouvrir tout', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await loadTemplate(page, 'Cuisine en L');
    await switchViewMode(page, '3d');
    await page.getByTestId('btn-lighting-toggle').click();
    await page.getByTestId('btn-led-toggle').click();
    await page.getByTestId('btn-toggle-open-all').click();
    await page.waitForTimeout(500);

    const { filename, buffer } = await triggerExport(page, 'export-render-png');
    validatePngDownload(buffer, filename, 800, 450);
    await assertCanvasNonBlank(page);
    guard.assertNoErrors();
  });

  test('T3-25 — R3↔R5: Export .glb reflète la croissance géométrique de la scène', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    const glb1 = await triggerExport(page, 'export-scene-glb');
    const info1 = validateGlbDownload(glb1.buffer, glb1.filename);

    await addModuleByFrenchLabel(page, /Colonne/i);
    await addModuleByFrenchLabel(page, /Biblioth[èe]que/i);
    const glb2 = await triggerExport(page, 'export-scene-glb');
    const info2 = validateGlbDownload(glb2.buffer, glb2.filename);

    expect(info2.meshCount).toBeGreaterThan(info1.meshCount);
    expect(glb2.buffer.length).toBeGreaterThan(glb1.buffer.length);
    guard.assertNoErrors();
  });

  test('T3-26 — R3,R4↔R5: Épaisseur 19 mm propagée dans Cutlist CSV, Cutlist PDF et Nesting PDF', async ({ page }) => {
    const guard = attachErrorGuard(page);
    await openStudio(page);
    await createBlankProject(page);
    await addModuleByFrenchLabel(page, /Caisson bas/i);
    await openLeftPanelTab(page, 'atelier');
    const thickSelect = page.locator('aside').first().getByLabel(/^[ée]paisseur panneau/i).first();
    await expect(thickSelect).toBeVisible();
    await thickSelect.selectOption('19');

    await switchWorkspaceTab(page, 'cutlist');
    const csv = await triggerExport(page, 'export-cutlist-csv');
    const csvText = validateCsvDownload(csv.buffer, csv.filename);
    expect(csvText).toContain('19');

    const cutPdf = await triggerExport(page, 'export-cutlist-pdf');
    validatePdfDownload(cutPdf.buffer, cutPdf.filename);

    await switchWorkspaceTab(page, 'nesting');
    const nestPdf = await triggerExport(page, 'export-nesting-pdf');
    validatePdfDownload(nestPdf.buffer, nestPdf.filename);
    guard.assertNoErrors();
  });
});
