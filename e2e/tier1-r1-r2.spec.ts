import { expect, test } from '@playwright/test';
import {
  addModuleByFrenchLabel,
  assertCanvasNonBlank,
  assertFrenchAuthenticity,
  attachErrorGuard,
  captureCanvasPngBuffer,
  clearAllWalls,
  createBlankProject,
  drawWallOn2DPlan,
  get3DCanvasLocator,
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
  validateJsonDownload,
} from './helpers/studio';

test.describe('Tier 1 — R1 & R2 (F1–F6, F10–F16)', () => {
  // =========================================================================
  // F1: Localisation 100% française (5 tests)
  // =========================================================================
  test.describe('F1 — Localisation 100% française', () => {
    test('F1.1 — Shell principal et onglets 100% en français', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await assertFrenchAuthenticity(page);
      await expect(page.getByTestId('tab-conception')).toContainText(/Conception/i);
      await expect(page.getByTestId('tab-cutlist')).toContainText(/Fiche de d[ée]bit/i);
      await expect(page.getByTestId('tab-nesting')).toContainText(/Calepinage/i);
      await expect(page.getByTestId('tab-devis')).toContainText(/Devis/i);
      await expect(page.getByTestId('view-mode-plan')).toContainText(/Plan/i);
      await expect(page.getByTestId('view-mode-elevation')).toContainText(/[ÉE]l[ée]vation/i);
      await expect(page.getByTestId('view-mode-3d')).toContainText(/3D/i);
      guard.assertNoErrors();
    });

    test('F1.2 — Catalogue affiche les catégories et modules en français authentique', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).toMatch(/Cuisine/i);
      expect(bodyText).toMatch(/Dressing/i);
      expect(bodyText).toMatch(/Caisson bas/i);
      expect(bodyText).toMatch(/Caisson haut/i);
      expect(bodyText).toMatch(/Colonne/i);
      expect(bodyText).toMatch(/Plinthe/i);
      guard.assertNoErrors();
    });

    test('F1.3 — Onglets Fiche de débit, Calepinage et Devis utilisent la terminologie métier française', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');

      const cutlistText = await getCutlistText(page);
      expect(cutlistText).toMatch(/Rep[èe]re|Pi[èe]ce/i);
      expect(cutlistText).toMatch(/Bande de chant|Chants/i);
      expect(cutlistText).toMatch(/Sens du fil|Fil/i);
      await assertFrenchAuthenticity(page);

      await switchWorkspaceTab(page, 'nesting');
      await expect(page.getByTestId('atelier-nesting-view')).toBeVisible();
      const nestingText = await page.locator('body').innerText();
      expect(nestingText).toMatch(/Taux de chute/i);
      expect(nestingText).toMatch(/Trait de scie/i);
      await assertFrenchAuthenticity(page);

      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/Quincaillerie/i);
      expect(devisText).toMatch(/TVA/i);
      await assertFrenchAuthenticity(page);
      guard.assertNoErrors();
    });

    test('F1.4 — Aucune fuite de termes anglais non traduits dans le DOM visible', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      await assertFrenchAuthenticity(page);
      await switchViewMode(page, 'elevation');
      await assertFrenchAuthenticity(page);
      await switchViewMode(page, '3d');
      await assertFrenchAuthenticity(page);
      guard.assertNoErrors();
    });

    test('F1.5 — Centre d’exports affiche des libellés français', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await page.getByTestId('btn-export-menu').click();
      const exportMenu = page
        .getByRole('dialog')
        .or(page.getByTestId('export-plan-pdf').locator('xpath=ancestor::div[1]'))
        .first();
      await expect(exportMenu).toBeVisible();
      const text = await exportMenu.innerText();
      expect(text).toMatch(/Plan 2D/i);
      expect(text).toMatch(/[ÉE]l[ée]vation/i);
      expect(text).toMatch(/3D/i);
      await assertFrenchAuthenticity(page);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F2: Unités mm canoniques + toggle cm (5 tests)
  // =========================================================================
  test.describe('F2 — Unités mm canoniques + bascule cm', () => {
    test('F2.1 — Unité par défaut est strictement mm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const state = await getRootState(page);
      expect(state.unitMode).toBe('mm');
      guard.assertNoErrors();
    });

    test('F2.2 — Bascule unit-toggle passe à cm puis revient à mm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect((await getRootState(page)).unitMode).toBe('cm');
      await page.getByTestId('unit-toggle').click();
      expect((await getRootState(page)).unitMode).toBe('mm');
      guard.assertNoErrors();
    });

    test('F2.3 — Inspecteur convertit exactement les dimensions entre mm et cm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 600);
      expect(await readNumericInputValue(widthInput)).toBe(600);

      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect((await getRootState(page)).unitMode).toBe('cm');
      expect(await readNumericInputValue(widthInput)).toBe(60);
      guard.assertNoErrors();
    });

    test('F2.4 — Une saisie en cm est stockée canoniquement en mm sans dérive', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 80);

      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect((await getRootState(page)).unitMode).toBe('mm');
      expect(await readNumericInputValue(widthInput)).toBe(800);
      guard.assertNoErrors();
    });

    test('F2.5 — La Fiche de débit reste exprimée en mm même lorsque affichage est en cm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 800);

      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect((await getRootState(page)).unitMode).toBe('cm');

      const cutlistText = await getCutlistText(page);
      expect(cutlistText).toMatch(/800|764|762|768/);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F3: Devises MAD, EUR, USD (5 tests)
  // =========================================================================
  test.describe('F3 — Devises MAD, EUR, USD', () => {
    test('F3.1 — Devise par défaut est MAD et affichée dans le Devis', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      expect((await getRootState(page)).currency).toBe('MAD');
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/MAD/);
      guard.assertNoErrors();
    });

    test('F3.2 — Sélection de EUR met à jour data-currency et le Devis', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await page.getByTestId('currency-select').selectOption('EUR');
      expect((await getRootState(page)).currency).toBe('EUR');
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/€|EUR/);
      guard.assertNoErrors();
    });

    test('F3.3 — Sélection de USD met à jour data-currency et le Devis', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await page.getByTestId('currency-select').selectOption('USD');
      expect((await getRootState(page)).currency).toBe('USD');
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/\$|USD/);
      guard.assertNoErrors();
    });

    test('F3.4 — Retour à MAD restaure le formatage MAD', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await page.getByTestId('currency-select').selectOption('EUR');
      await page.getByTestId('currency-select').selectOption('MAD');
      expect((await getRootState(page)).currency).toBe('MAD');
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/MAD/);
      guard.assertNoErrors();
    });

    test('F3.5 — Modification d’un prix unitaire ou marge recalcule le Total TTC', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const beforeText = await getDevisText(page);
      const marginInput = page.getByLabel(/marge/i).first();
      await expect(marginInput).toBeVisible();
      await setNumericInput(marginInput, 45);
      const afterText = await getDevisText(page);
      expect(afterText).not.toBe(beforeText);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F4: Persistance IndexedDB + Miniatures (5 tests)
  // =========================================================================
  test.describe('F4 — Persistance IndexedDB et Miniatures', () => {
    test('F4.1 — Sauvegarde un projet dans la bibliothèque IndexedDB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await saveProjectToLibrary(page, 'Cuisine Villa Test 1');
      const dialog = await openProjectLibrary(page);
      await expect(dialog.getByText('Cuisine Villa Test 1')).toBeVisible();
      guard.assertNoErrors();
    });

    test('F4.2 — Génère une miniature valide non vide dans la carte projet', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page, { waitFor3D: true });
      await loadTemplate(page, 'Cuisine en L');
      await saveProjectToLibrary(page, 'Projet Miniature');
      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Projet Miniature');
      await expect(card).toBeVisible();
      const thumbImg = card.locator('img').first();
      await expect(thumbImg).toBeVisible();
      const naturalWidth = await thumbImg.evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
      guard.assertNoErrors();
    });

    test('F4.3 — Persistance complète après rechargement navigateur (page.reload)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await addModuleByFrenchLabel(page, /Caisson haut/i);
      const savedCount = (await getRootState(page)).moduleCount;
      await saveProjectToLibrary(page, 'Projet Reprise Reload');

      await reloadStudio(page);
      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Projet Reprise Reload');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /ouvrir|charger/i }).first().click();

      await expect
        .poll(async () => (await getRootState(page)).moduleCount)
        .toBe(savedCount);
      guard.assertNoErrors();
    });

    test('F4.4 — Isolation multi-projets dans IndexedDB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await saveProjectToLibrary(page, 'Projet Alpha 1M');

      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await addModuleByFrenchLabel(page, /Colonne/i);
      await saveProjectToLibrary(page, 'Projet Beta 2M');

      const dialog = await openProjectLibrary(page);
      const alphaCard = getProjectCardLocator(dialog, 'Projet Alpha 1M');
      await expect(alphaCard).toBeVisible();
      await alphaCard.getByRole('button', { name: /ouvrir|charger/i }).first().click();
      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(1);
      guard.assertNoErrors();
    });

    test('F4.5 — Suppression d’un projet enregistré dans IndexedDB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await saveProjectToLibrary(page, 'Projet A Supprimer');

      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Projet A Supprimer');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /supprimer/i }).first().click();
      await expect(dialog.getByText('Projet A Supprimer')).toBeHidden();
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F5: Historique Annuler / Rétablir (5 tests)
  // =========================================================================
  test.describe('F5 — Historique Annuler / Rétablir', () => {
    test('F5.1 — Annuler (btn-undo) retire le dernier module ajouté', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const initialCount = (await getRootState(page)).moduleCount;
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      expect((await getRootState(page)).moduleCount).toBe(initialCount + 1);

      await page.getByTestId('btn-undo').click();
      expect((await getRootState(page)).moduleCount).toBe(initialCount);
      guard.assertNoErrors();
    });

    test('F5.2 — Rétablir (btn-redo) restaure le module annulé', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const initialCount = (await getRootState(page)).moduleCount;
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await page.getByTestId('btn-undo').click();
      expect((await getRootState(page)).moduleCount).toBe(initialCount);

      await page.getByTestId('btn-redo').click();
      expect((await getRootState(page)).moduleCount).toBe(initialCount + 1);
      guard.assertNoErrors();
    });

    test('F5.3 — Annuler / Rétablir restaure exactement une modification de dimension', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput } = selectInspectorDimensions(page);
      const initialWidth = await readNumericInputValue(widthInput);
      await setNumericInput(widthInput, 950);
      expect(await readNumericInputValue(widthInput)).toBe(950);

      await page.getByTestId('btn-undo').click();
      expect(await readNumericInputValue(widthInput)).toBe(initialWidth);

      await page.getByTestId('btn-redo').click();
      expect(await readNumericInputValue(widthInput)).toBe(950);
      guard.assertNoErrors();
    });

    test('F5.4 — Raccourcis clavier Ctrl+Z et Ctrl+Y fonctionnent', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const initialCount = (await getRootState(page)).moduleCount;
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      expect((await getRootState(page)).moduleCount).toBe(initialCount + 1);

      await page.keyboard.press('Control+z');
      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(initialCount);

      await page.keyboard.press('Control+y');
      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(initialCount + 1);
      guard.assertNoErrors();
    });

    test('F5.5 — État UI éphémère (vue 3D, éclairage, LED) exclu de la pile Undo', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const initialCount = (await getRootState(page)).moduleCount;
      await addModuleByFrenchLabel(page, /Caisson bas/i);

      await switchViewMode(page, '3d');
      await page.getByTestId('btn-lighting-toggle').click();
      await page.getByTestId('btn-led-toggle').click();
      const beforeUndo = await getRootState(page);
      expect(beforeUndo.lighting).toBe('nuit');
      expect(beforeUndo.led).toBe(true);

      await page.getByTestId('btn-undo').click();
      const afterUndo = await getRootState(page);
      expect(afterUndo.moduleCount).toBe(initialCount);
      expect(afterUndo.lighting).toBe('nuit');
      expect(afterUndo.led).toBe(true);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F6: Import / Export .json & Modèles (6 tests)
  // =========================================================================
  test.describe('F6 — Import / Export .json et Modèles pré-chargés', () => {
    test('F6.1 — Bibliothèque propose les deux modèles Cuisine en L et Dressing sur-mesure', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const dialog = await openProjectLibrary(page);
      await expect(dialog.getByText(/Cuisine en L/i).first()).toBeVisible();
      await expect(dialog.getByText(/Dressing sur-mesure/i).first()).toBeVisible();
      guard.assertNoErrors();
    });

    test('F6.2 — Chargement du modèle Cuisine en L peuple murs et modules', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const state = await getRootState(page);
      expect(state.wallCount).toBeGreaterThanOrEqual(2);
      expect(state.moduleCount).toBeGreaterThanOrEqual(4);
      guard.assertNoErrors();
    });

    test('F6.3 — Chargement du modèle Dressing sur-mesure peuple murs et modules', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      const state = await getRootState(page);
      expect(state.wallCount).toBeGreaterThanOrEqual(1);
      expect(state.moduleCount).toBeGreaterThanOrEqual(3);
      guard.assertNoErrors();
    });

    test('F6.4 — Export .json génère un document projet JSON valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const { filename, buffer } = await triggerExport(page, 'export-project-json');
      validateJsonDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F6.5 — Ré-import d’un fichier .json valide restaure exactement murs et modules', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const expectedState = await getRootState(page);
      const { filename, buffer } = await triggerExport(page, 'export-project-json');

      await loadTemplate(page, 'Dressing sur-mesure');
      const dialog = await openProjectLibrary(page);
      const fileInput = dialog.locator('input[type="file"]').first();
      await fileInput.setInputFiles({
        name: filename,
        mimeType: 'application/json',
        buffer,
      });

      await expect.poll(async () => (await getRootState(page)).wallCount).toBe(expectedState.wallCount);
      await expect.poll(async () => (await getRootState(page)).moduleCount).toBe(expectedState.moduleCount);
      guard.assertNoErrors();
    });

    test('F6.6 — Bascule entre Cuisine en L et Dressing sur-mesure sans résidu ni erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const cuisineCount = (await getRootState(page)).moduleCount;
      await loadTemplate(page, 'Dressing sur-mesure');
      const dressingCount = (await getRootState(page)).moduleCount;
      expect(cuisineCount).toBeGreaterThan(0);
      expect(dressingCount).toBeGreaterThan(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F10: Bascule Multi-Vues 2D ↔ 3D (5 tests)
  // =========================================================================
  test.describe('F10 — Bascule Multi-Vues 2D ↔ 3D', () => {
    test('F10.1 — Vue Plan 2D affiche viewport-2d-plan', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await switchViewMode(page, 'plan');
      await expect(page.getByTestId('viewport-2d-plan')).toBeVisible();
      guard.assertNoErrors();
    });

    test('F10.2 — Vue Élévation affiche viewport-2d-elevation', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'elevation');
      await expect(page.getByTestId('viewport-2d-elevation')).toBeVisible();
      guard.assertNoErrors();
    });

    test('F10.3 — Vue 3D Interactive rend le canvas WebGL prêt', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F10.4 — Split View affiche Plan 2D et Vue 3D simultanément', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'split');
      await expect(page.getByTestId('viewport-2d-plan')).toBeVisible();
      await expect(page.getByTestId('viewport-3d-canvas')).toBeVisible();
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F10.5 — Source unique Zustand : édition en Split View met à jour 2D et 3D en direct', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await switchViewMode(page, 'split');
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const before3D = await captureCanvasPngBuffer(page);
      const before2D = await page.getByTestId('viewport-2d-plan').innerHTML();

      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 1100);
      const after3D = await captureCanvasPngBuffer(page, 300);
      const after2D = await page.getByTestId('viewport-2d-plan').innerHTML();

      expect(after2D).not.toBe(before2D);
      expect(Buffer.compare(before3D, after3D)).not.toBe(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F11: Éditeur Plan 2D — Murs & Réseaux (8 tests)
  // =========================================================================
  test.describe('F11 — Éditeur Plan 2D (Murs, Ouvertures et Réseaux)', () => {
    test('F11.1 — Tracer un mur libre au pointeur incrémente data-wall-count', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await switchViewMode(page, 'plan');
      const before = (await getRootState(page)).wallCount;
      await drawWallOn2DPlan(page, { x: 160, y: 180 }, { x: 460, y: 180 });
      await expect.poll(async () => (await getRootState(page)).wallCount).toBeGreaterThan(before);
      guard.assertNoErrors();
    });

    test('F11.2 — Tracé multi-murs en L affiche des longueurs cotées en mm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await clearAllWalls(page);
      await switchViewMode(page, 'plan');
      const plan = page.getByTestId('viewport-2d-plan');
      const beforeSvg = await plan.innerHTML();
      await drawWallOn2DPlan(page, { x: 150, y: 150 }, { x: 450, y: 150 });
      await drawWallOn2DPlan(page, { x: 450, y: 150 }, { x: 450, y: 400 });
      expect((await getRootState(page)).wallCount).toBe(2);
      const afterSvg = await plan.innerHTML();
      expect(afterSvg).not.toBe(beforeSvg);
      const svgTexts = await plan.locator('svg text').allInnerTexts();
      expect(svgTexts.join(' ')).toMatch(/\d{3,4}/);
      guard.assertNoErrors();
    });

    test('F11.3 — Placement d’une Porte sur le plan 2D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const beforeSvg = await page.getByTestId('viewport-2d-plan').innerHTML();
      await placeOpeningOrUtility(page, /Porte(?!s)/i, { x: 300, y: 200 });
      const afterSvg = await page.getByTestId('viewport-2d-plan').innerHTML();
      expect(afterSvg).not.toBe(beforeSvg);
      guard.assertNoErrors();
    });

    test('F11.4 — Placement d’une Fenêtre sur le plan 2D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const beforeSvg = await page.getByTestId('viewport-2d-plan').innerHTML();
      await placeOpeningOrUtility(page, /Fen[êe]tre/i, { x: 360, y: 200 });
      const afterSvg = await page.getByTestId('viewport-2d-plan').innerHTML();
      expect(afterSvg).not.toBe(beforeSvg);
      guard.assertNoErrors();
    });

    test('F11.5 — Placement d’un Poteau, Prise et Arrivée d’eau sur le plan 2D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const plan = page.getByTestId('viewport-2d-plan');

      const beforeSvg = await plan.innerHTML();
      await placeOpeningOrUtility(page, /Poteau/i, { x: 250, y: 260 });
      const after1 = await plan.innerHTML();
      expect(after1).not.toBe(beforeSvg);

      await placeOpeningOrUtility(page, /Prise/i, { x: 320, y: 220 });
      const after2 = await plan.innerHTML();
      expect(after2).not.toBe(after1);

      await placeOpeningOrUtility(page, /Arriv[ée]e d'eau|Plomberie/i, { x: 380, y: 220 });
      const after3 = await plan.innerHTML();
      expect(after3).not.toBe(after2);
      guard.assertNoErrors();
    });

    test('F11.6 — Guides orthogonaux et grille actifs pendant le tracé de mur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await switchViewMode(page, 'plan');
      const beforeWalls = (await getRootState(page)).wallCount;
      const plan = page.getByTestId('viewport-2d-plan');
      const beforeSvg = await plan.innerHTML();
      await openLeftPanelTab(page, 'catalogue');
      await page.getByTestId('tool-draw-wall').click();
      const box = await plan.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + 200, box!.y + 200);
      await page.mouse.down();
      await page.mouse.move(box!.x + 380, box!.y + 203, { steps: 6 });
      await page.mouse.up();
      expect((await getRootState(page)).wallCount).toBe(beforeWalls + 1);
      const afterSvg = await plan.innerHTML();
      expect(afterSvg).not.toBe(beforeSvg);
      guard.assertNoErrors();
    });

    test('F11.7 — Tracé de murs non orthogonaux en angle / polygone libre', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await clearAllWalls(page);
      await switchViewMode(page, 'plan');
      const plan = page.getByTestId('viewport-2d-plan');
      const beforeSvg = await plan.innerHTML();
      await drawWallOn2DPlan(page, { x: 160, y: 180 }, { x: 380, y: 320 });
      await drawWallOn2DPlan(page, { x: 380, y: 320 }, { x: 160, y: 320 });
      await drawWallOn2DPlan(page, { x: 160, y: 320 }, { x: 160, y: 180 });
      expect((await getRootState(page)).wallCount).toBe(3);
      const afterSvg = await plan.innerHTML();
      expect(afterSvg).not.toBe(beforeSvg);
      guard.assertNoErrors();
    });

    test('F11.8 — Redimensionnement et suppression d’une ouverture via l’inspecteur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const plan = page.getByTestId('viewport-2d-plan');
      const beforePlaceSvg = await plan.innerHTML();
      await placeOpeningOrUtility(page, /Porte(?!s)/i, { x: 280, y: 120 });
      const afterPlaceSvg = await plan.innerHTML();
      expect(afterPlaceSvg).not.toBe(beforePlaceSvg);

      const inspector = getInspectorPanel(page);
      const { widthInput } = selectInspectorDimensions(page);
      await expect(widthInput).toBeVisible();
      await setNumericInput(widthInput, 930);
      expect(await readNumericInputValue(widthInput)).toBe(930);
      const afterResizeSvg = await plan.innerHTML();
      expect(afterResizeSvg).not.toBe(afterPlaceSvg);

      const deleteBtn = inspector.getByRole('button', { name: /supprimer/i }).first();
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();
      const afterDeleteSvg = await plan.innerHTML();
      expect(afterDeleteSvg).not.toBe(afterResizeSvg);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F12: Vue Élévation par Mur & Cotations (5 tests)
  // =========================================================================
  test.describe('F12 — Vue Élévation par Mur & Cotations', () => {
    test('F12.1 — Élévation par mur génère un dessin SVG structuré', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'elevation');
      const elev = page.getByTestId('viewport-2d-elevation');
      await expect(elev.locator('svg').first()).toBeVisible();
      guard.assertNoErrors();
    });

    test('F12.2 — Sélecteur wall-selector-* permet de basculer entre les murs', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'elevation');

      const selectors = page.locator('[data-testid^="wall-selector-"]');
      const count = await selectors.count();
      expect(count).toBeGreaterThanOrEqual(2);
      const firstHtml = await page.getByTestId('viewport-2d-elevation').innerHTML();
      await selectors.nth(1).click();
      const secondHtml = await page.getByTestId('viewport-2d-elevation').innerHTML();
      expect(secondHtml).not.toBe(firstHtml);
      guard.assertNoErrors();
    });

    test('F12.3 — Cotations multi-niveaux en mm affichées dans l’élévation', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'elevation');
      const elevText = await page.getByTestId('viewport-2d-elevation').innerText();
      expect(elevText).toMatch(/\d{3,4}/);
      guard.assertNoErrors();
    });

    test('F12.4 — Ouvertures présentes sur un mur apparaissent dans sa vue élévation', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'elevation');
      const svgCount = await page.getByTestId('viewport-2d-elevation').locator('svg rect, svg line').count();
      expect(svgCount).toBeGreaterThan(4);
      guard.assertNoErrors();
    });

    test('F12.5 — Modification de largeur met à jour les cotations de élévation en direct', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const inspector = getInspectorPanel(page);
      const moduleBtn = inspector.getByRole('button', { name: /M02|Caisson bas/i }).first();
      await expect(moduleBtn).toBeVisible();
      await moduleBtn.click();
      await switchViewMode(page, 'elevation');
      const beforeText = await page.getByTestId('viewport-2d-elevation').innerText();
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 875);
      const afterText = await page.getByTestId('viewport-2d-elevation').innerText();
      expect(afterText).toContain('875');
      expect(afterText).not.toBe(beforeText);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F13: Inspecteur Contextuel & Catalogue (5 tests)
  // =========================================================================
  test.describe('F13 — Inspecteur Contextuel & Catalogue', () => {
    test('F13.1 — Inspecteur mur affiche longueur, épaisseur et hauteur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const wallElement = page
        .getByTestId('viewport-2d-plan')
        .locator('svg:has([data-wall-id]) [data-wall-id], svg:not(:has([data-wall-id])) > line')
        .first();
      await expect(wallElement).toBeVisible();
      await wallElement.click({ force: true });
      const inspector = getInspectorPanel(page);
      const inspectorText = await inspector.innerText();
      expect(inspectorText).toMatch(/Longueur/i);
      expect(inspectorText).toMatch(/Hauteur/i);
      expect(inspectorText).toMatch(/[ÉE]paisseur/i);
      const { widthInput, heightInput, depthInput } = selectInspectorDimensions(page);
      await expect(widthInput).toBeVisible();
      await expect(heightInput).toBeVisible();
      await expect(depthInput).toBeVisible();
      guard.assertNoErrors();
    });

    test('F13.2 — Inspecteur module affiche largeur, hauteur et profondeur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput, heightInput, depthInput } = selectInspectorDimensions(page);
      await expect(widthInput).toBeVisible();
      await expect(heightInput).toBeVisible();
      await expect(depthInput).toBeVisible();
      expect(await readNumericInputValue(widthInput)).toBeGreaterThan(0);
      expect(await readNumericInputValue(heightInput)).toBeGreaterThan(0);
      expect(await readNumericInputValue(depthInput)).toBeGreaterThan(0);
      guard.assertNoErrors();
    });

    test('F13.3 — Édition des dimensions du module met à jour la Fiche de débit', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput, depthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 850);
      await setNumericInput(depthInput, 600);
      const cutlistText = await getCutlistText(page);
      expect(cutlistText).toMatch(/850|814|812|818/);
      guard.assertNoErrors();
    });

    test('F13.4 — Changement de hauteur module dans l’inspecteur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson haut/i);
      const { heightInput } = selectInspectorDimensions(page);
      await setNumericInput(heightInput, 900);
      expect(await readNumericInputValue(heightInput)).toBe(900);
      const cutlistText = await getCutlistText(page);
      expect(cutlistText).toContain('900');
      guard.assertNoErrors();
    });

    test('F13.5 — Surcharge matériau et style de poignée par module via inspecteur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const inspector = getInspectorPanel(page);
      const facadeSelect = inspector
        .getByLabel(/fa[çc]ade personnalis[ée]e|mat[ée]riau.*fa[çc]ade/i)
        .first();
      await expect(facadeSelect).toBeVisible();
      expect(await facadeSelect.locator('option').count()).toBeGreaterThan(1);
      await facadeSelect.selectOption({ index: 1 });
      expect((await facadeSelect.inputValue()).length).toBeGreaterThan(0);

      const handleSelect = inspector.getByLabel(/poign[ée]e/i).first();
      await expect(handleSelect).toBeVisible();
      expect(await handleSelect.locator('option').count()).toBeGreaterThan(1);
      await handleSelect.selectOption({ index: 1 });
      const selectedVal = await handleSelect.inputValue();
      expect(selectedVal.length).toBeGreaterThan(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F14: Moteur 3D Orbite & Visite Libre (5 tests)
  // =========================================================================
  test.describe('F14 — Moteur 3D Orbite & Visite Libre', () => {
    test('F14.1 — Scène 3D WebGL non vide sur Cuisine en L', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F14.2 — Glisser Orbite et molette Zoom modifient le rendu 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const before = await captureCanvasPngBuffer(page);

      const canvas = await get3DCanvasLocator(page);
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + 140, cy - 50, { steps: 10 });
      await page.mouse.up();
      await page.mouse.wheel(0, -180);

      const after = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(before, after)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F14.3 — Bascule vers le mode Visite libre via btn-camera-mode', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const camBtn = page.getByTestId('btn-camera-mode');
      const beforeLabel = await camBtn.innerText();
      await camBtn.click();
      const afterLabel = await camBtn.innerText();
      expect(afterLabel).not.toBe(beforeLabel);
      guard.assertNoErrors();
    });

    test('F14.4 — Touches ZQSD / WASD / Flèches en Visite libre déplacent la caméra sans erreur console', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-camera-mode').click();
      const before = await captureCanvasPngBuffer(page, 250);
      for (const key of ['KeyZ', 'KeyD', 'KeyW', 'ArrowUp']) {
        await page.keyboard.down(key);
        await page.waitForTimeout(100);
        await page.keyboard.up(key);
      }
      const after = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(before, after)).not.toBe(0);
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F14.5 — Retour au mode Orbite restaure une navigation fluide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-camera-mode').click();
      await page.getByTestId('btn-camera-mode').click();
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F15: Matériaux PBR Procéduraux & Sens du Fil (5 tests)
  // =========================================================================
  test.describe('F15 — Matériaux PBR Procéduraux & Sens du Fil', () => {
    test('F15.1 — Matériau mélaminé bois s’affiche sans erreur en 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const matSelect = page.locator('aside').first().getByLabel(/mat[ée]riau fa[çc]ade/i).first();
      await expect(matSelect).toBeVisible();
      const options = await matSelect.locator('option').allInnerTexts();
      const woodIdx = options.findIndex((o) => /ch[êe]ne|noyer|bois|m[ée]lamin[ée]/i.test(o));
      expect(woodIdx).toBeGreaterThanOrEqual(0);
      await matSelect.selectOption({ index: woodIdx });
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F15.2 — Changement de matériau façade (laque / bois) modifie le rendu 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchViewMode(page, '3d');
      const before = await captureCanvasPngBuffer(page);
      const inspector = getInspectorPanel(page);
      const matSelect = inspector
        .getByLabel(/fa[çc]ade personnalis[ée]e|mat[ée]riau.*fa[çc]ade/i)
        .first();
      await expect(matSelect).toBeVisible();
      const optionsCount = await matSelect.locator('option').count();
      expect(optionsCount).toBeGreaterThan(1);
      await matSelect.selectOption({ index: optionsCount - 1 });
      const after = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(before, after)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F15.3 — Changement de matériau sol ou mur modifie la scène 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const before = await captureCanvasPngBuffer(page);
      await openLeftPanelTab(page, 'atelier');
      const floorOrWallSelect = page
        .locator('aside')
        .first()
        .getByLabel(/mat[ée]riau sol|sol|parquet|carrelage|mur/i)
        .first();
      await expect(floorOrWallSelect).toBeVisible();
      const optionValues = await floorOrWallSelect
        .locator('option')
        .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      expect(optionValues.length).toBeGreaterThan(1);
      const currentVal = await floorOrWallSelect.inputValue();
      const nextIdx = optionValues.findIndex((v) => v !== currentVal);
      expect(nextIdx).toBeGreaterThanOrEqual(0);
      await floorOrWallSelect.selectOption({ index: nextIdx });
      const after = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(before, after)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F15.4 — Inversion du sens du fil (Horizontal / Vertical) met à jour Fiche de débit et 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchViewMode(page, '3d');
      const before3D = await captureCanvasPngBuffer(page);
      const beforeCutlist = await getCutlistText(page);
      await openLeftPanelTab(page, 'atelier');
      const grainControl = page
        .locator('aside')
        .first()
        .getByLabel(/sens du fil/i)
        .or(getInspectorPanel(page).getByLabel(/sens du fil/i))
        .first();
      await expect(grainControl).toBeVisible();
      const optionValues = await grainControl
        .locator('option')
        .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
      expect(optionValues.length).toBeGreaterThan(1);
      const currentVal = await grainControl.inputValue();
      const nextIdx = optionValues.findIndex((v) => v !== currentVal);
      expect(nextIdx).toBeGreaterThanOrEqual(0);
      await grainControl.selectOption({ index: nextIdx });
      const after3D = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(before3D, after3D)).not.toBe(0);
      const afterCutlist = await getCutlistText(page);
      expect(afterCutlist).not.toBe(beforeCutlist);
      guard.assertNoErrors();
    });

    test('F15.5 — Textures PBR 100% hors-ligne (zéro requête réseau externe échouée)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoFailedExternalRequests();
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F16: Éclairage Jour/Nuit & LED sous-meubles (5 tests)
  // =========================================================================
  test.describe('F16 — Éclairage Jour/Nuit & LED sous-meubles', () => {
    test('F16.1 — Preset d’éclairage par défaut est Jour', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      expect((await getRootState(page)).lighting).toBe('jour');
      guard.assertNoErrors();
    });

    test('F16.2 — Bascule vers Nuit met à jour data-lighting et le rendu 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const jourPng = await captureCanvasPngBuffer(page);

      await page.getByTestId('btn-lighting-toggle').click();
      expect((await getRootState(page)).lighting).toBe('nuit');
      const nuitPng = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(jourPng, nuitPng)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F16.3 — Interrupteur LED bascule data-led true/false', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      const initialLed = (await getRootState(page)).led;
      await page.getByTestId('btn-led-toggle').click();
      expect((await getRootState(page)).led).toBe(!initialLed);
      await page.getByTestId('btn-led-toggle').click();
      expect((await getRootState(page)).led).toBe(initialLed);
      guard.assertNoErrors();
    });

    test('F16.4 — LED sous-meubles en mode Nuit éclaire visiblement la scène 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const init = await getRootState(page);
      expect(init.lighting).toBe('jour');
      expect(init.led).toBe(false);

      await page.getByTestId('btn-lighting-toggle').click();
      expect((await getRootState(page)).lighting).toBe('nuit');
      const nuitNoLed = await captureCanvasPngBuffer(page, 250);

      await page.getByTestId('btn-led-toggle').click();
      expect((await getRootState(page)).led).toBe(true);
      const nuitWithLed = await captureCanvasPngBuffer(page, 250);
      expect(Buffer.compare(nuitNoLed, nuitWithLed)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F16.5 — Retour au preset Jour restaure un rendu 3D lumineux sans erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-lighting-toggle').click();
      await page.getByTestId('btn-lighting-toggle').click();
      expect((await getRootState(page)).lighting).toBe('jour');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });
  });
});
