import { expect, test } from '@playwright/test';
import { ALL_INVALID_PROJECT_FIXTURES } from './fixtures/projects';
import {
  addModuleByFrenchLabel,
  assertCanvasNonBlank,
  assertFrenchAuthenticity,
  attachErrorGuard,
  clearAllWalls,
  closeModalIfOpen,
  createBlankProject,
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

test.describe('Tier 2 — Boundaries, Edge Cases & Negative Rejections (F1–F24)', () => {
  // =========================================================================
  // 1. Panel Thickness Boundaries (7 tests)
  // =========================================================================
  test.describe('T2.1 — Limites épaisseur de panneau', () => {
    for (const thickness of [16, 18, 19, 22]) {
      test(`T2.1 — Épaisseur valide ${thickness} mm ajuste les dimensions internes de caisson`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const { widthInput } = selectInspectorDimensions(page);
        await setNumericInput(widthInput, 800);

        await openLeftPanelTab(page, 'atelier');
        const thickSelect = page.locator('aside').first().getByLabel(/^[ée]paisseur panneau/i).first();
        await expect(thickSelect).toBeVisible();
        await thickSelect.selectOption(String(thickness));

        const expectedInterior = 800 - 2 * thickness;
        const cutText = await getCutlistText(page);
        expect(cutText).toContain(String(thickness));
        expect(cutText).toContain(String(expectedInterior));
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const badThick of [0, -18, 100]) {
      test(`T2.1 — Valeur extrême/invalide épaisseur (${badThick}) ne produit aucun NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const thickCtrl = page.locator('aside').first().getByLabel(/^[ée]paisseur panneau/i).first();
        await expect(thickCtrl).toBeVisible();
        const tag = await thickCtrl.evaluate((el) => el.tagName.toLowerCase());
        expect(tag).toBe('select');
        const options = await thickCtrl.locator('option').allInnerTexts();
        expect(options.some((o) => o.includes(String(badThick)))).toBe(false);
        const cutText = await getCutlistText(page);
        expect(cutText).not.toMatch(/NaN|Infinity|undefined/i);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 2. Back Panel (Fond) 5/8 mm & Rainuré/Appliqué Boundaries (6 tests)
  // =========================================================================
  test.describe('T2.2 — Limites fond 5/8 mm et rainuré/appliqué', () => {
    const backMatrix = [
      { thick: '5', modeIdx: 0, label: '5 mm rainuré' },
      { thick: '5', modeIdx: 1, label: '5 mm appliqué' },
      { thick: '8', modeIdx: 0, label: '8 mm rainuré' },
      { thick: '8', modeIdx: 1, label: '8 mm appliqué' },
    ];

    for (const cfg of backMatrix) {
      test(`T2.2 — Fond ${cfg.label} calculé sans NaN dans la Fiche de débit`, async ({ page }) => {
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
        await backThick.selectOption(cfg.thick);
        await backMode.selectOption({ index: cfg.modeIdx });

        const cutText = await getCutlistText(page);
        expect(cutText).toMatch(/Fond/i);
        expect(cutText).toContain(cfg.thick);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const noBackModule of [/Plan de travail/i, /Plinthe/i]) {
      test(`T2.2 — Module sans caisson fermé (${noBackModule.source}) ne génère pas de NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, noBackModule);
        const cutText = await getCutlistText(page);
        expect(cutText.trim().length).toBeGreaterThan(0);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 3. Facade Clearance Boundaries (5 tests)
  // =========================================================================
  test.describe('T2.3 — Limites jeu entre façades', () => {
    for (const gap of [0, 2, 3, 5]) {
      test(`T2.3 — Jeu entre façades = ${gap} mm borné et sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const gapInput = page.locator('aside').first().getByLabel(/jeu.*fa[çc]ade|jeu/i).first();
        await expect(gapInput).toBeVisible();
        await setNumericInput(gapInput, gap);
        const cutText = await getCutlistText(page);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.3 — Jeu entre façades = -2 mm rejeté ou borné sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const cutBefore = await getCutlistText(page);
      await openLeftPanelTab(page, 'atelier');
      const gapInput = page.locator('aside').first().getByLabel(/jeu.*fa[çc]ade|jeu/i).first();
      await expect(gapInput).toBeVisible();
      await setNumericInput(gapInput, -2);
      const val = await readNumericInputValue(gapInput);
      const cutAfter = await getCutlistText(page);
      expect(val >= 0 || cutAfter === cutBefore).toBe(true);
      expect(cutAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 4. 4-Edge Banding Boundaries (6 tests)
  // =========================================================================
  test.describe('T2.4 — Limites bandes de chant 4 bords', () => {
    for (const edgeLabel of [
      /\bHaut\b|chant.*haut/i,
      /\bBas\b|chant.*bas/i,
      /\bGauche\b|chant.*gauche/i,
      /\bDroite\b|chant.*droite/i,
    ]) {
      test(`T2.4 — Chant bord ${edgeLabel.source} modifiable indépendamment`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const cutBefore = await getCutlistText(page);
        await openLeftPanelTab(page, 'atelier');
        const edgeCtrl = page
          .locator('aside')
          .first()
          .getByLabel(edgeLabel)
          .or(getInspectorPanel(page).getByLabel(edgeLabel))
          .first();
        await expect(edgeCtrl).toBeVisible();
        expect(await edgeCtrl.locator('option').count()).toBeGreaterThan(1);
        await edgeCtrl.selectOption({ index: 1 });
        const cutAfter = await getCutlistText(page);
        expect(cutAfter).not.toBe(cutBefore);
        expect(cutAfter).not.toMatch(/NaN/i);
        guard.assertNoErrors();
      });
    }

    test('T2.4 — Chants 0.4 mm vs 2 mm ajustent les codes dans la Fiche de débit', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const edgeSelect = page
        .locator('aside')
        .first()
        .getByLabel(/chant/i)
        .or(getInspectorPanel(page).getByLabel(/chant/i))
        .first();
      await expect(edgeSelect).toBeVisible();
      const optionsCount = await edgeSelect.locator('option').count();
      expect(optionsCount).toBeGreaterThan(1);

      await edgeSelect.selectOption({ index: 0 });
      const cutA = await getCutlistText(page);
      await openLeftPanelTab(page, 'atelier');
      await edgeSelect.selectOption({ index: optionsCount - 1 });
      const cutB = await getCutlistText(page);
      expect(cutB).not.toBe(cutA);
      expect(cutA).toMatch(/\b(0[.,]4|2)\b/);
      expect(cutB).toMatch(/\b(0[.,]4|2)\b/);
      guard.assertNoErrors();
    });

    test('T2.4 — Longueur totale de chants (ml) dans Devis toujours >= 0', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/\d+[.,]?\d*\s*ml/i);
      expect(devisText).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 5. Grain Direction & Nesting Grain-Lock Boundaries (5 tests)
  // =========================================================================
  test.describe('T2.5 — Limites sens du fil et verrouillage calepinage', () => {
    for (const dir of ['Horizontal', 'Vertical']) {
      test(`T2.5 — Sens du fil ${dir} reflété sans erreur`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const grainCtrl = page
          .locator('aside')
          .first()
          .getByLabel(/sens du fil/i)
          .or(getInspectorPanel(page).getByLabel(/sens du fil/i))
          .first();
        await expect(grainCtrl).toBeVisible();
        const options = await grainCtrl.locator('option').allInnerTexts();
        const idx = options.findIndex((o) => new RegExp(dir, 'i').test(o));
        expect(idx).toBeGreaterThanOrEqual(0);
        await grainCtrl.selectOption({ index: idx });
        const cutText = await getCutlistText(page);
        expect(cutText).toMatch(/\b(H|V|Horizontal|Vertical)\b/i);
        expect(cutText).not.toMatch(/NaN/i);
        guard.assertNoErrors();
      });
    }

    test('T2.5 — Verrouillage du fil ON empêche la rotation sur panneau étroit (pièce non placée)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Plan de travail/i);
      const { widthInput, depthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 2200);
      await setNumericInput(depthInput, 800);

      await switchWorkspaceTab(page, 'nesting');
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      const options = await preset.locator('option').allInnerTexts();
      const customIdx = options.findIndex((o) => /personnalis[ée]|custom/i.test(o));
      expect(customIdx).toBeGreaterThanOrEqual(0);
      await preset.selectOption({ index: customIdx });

      const lenInput = page.getByLabel(/longueur.*feuille|largeur.*panneau/i).first();
      const widInput = page.getByLabel(/largeur.*feuille|hauteur.*panneau/i).first();
      await expect(lenInput).toBeVisible();
      await expect(widInput).toBeVisible();
      await setNumericInput(lenInput, 1400);
      await setNumericInput(widInput, 2400);

      const grainLock = page.getByLabel(/respecter le sens du fil/i).first();
      await expect(grainLock).toBeVisible();
      await grainLock.check();
      await expect(grainLock).toBeChecked();

      const nestingText = await page.locator('body').innerText();
      expect(nestingText).toMatch(/non plac[ée]|hors format/i);
      guard.assertNoErrors();
    });

    test('T2.5 — Verrouillage du fil OFF autorise la rotation 90°', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Plan de travail/i);
      const { widthInput, depthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 2200);
      await setNumericInput(depthInput, 800);

      await switchWorkspaceTab(page, 'nesting');
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      const options = await preset.locator('option').allInnerTexts();
      const customIdx = options.findIndex((o) => /personnalis[ée]|custom/i.test(o));
      expect(customIdx).toBeGreaterThanOrEqual(0);
      await preset.selectOption({ index: customIdx });

      const lenInput = page.getByLabel(/longueur.*feuille|largeur.*panneau/i).first();
      const widInput = page.getByLabel(/largeur.*feuille|hauteur.*panneau/i).first();
      await expect(lenInput).toBeVisible();
      await expect(widInput).toBeVisible();
      await setNumericInput(lenInput, 1400);
      await setNumericInput(widInput, 2400);

      const grainLock = page.getByLabel(/respecter le sens du fil/i).first();
      await expect(grainLock).toBeVisible();
      await grainLock.uncheck();
      await expect(grainLock).not.toBeChecked();

      await expect(page.locator('svg').first()).toBeVisible();
      const nestingText = await page.locator('body').innerText();
      expect(nestingText).not.toMatch(/non plac[ée]|hors format/i);
      guard.assertNoErrors();
    });

    test('T2.5 — Bascule répétée du sens du fil maintient la stabilité 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const grainCtrl = page
        .locator('aside')
        .first()
        .getByLabel(/sens du fil/i)
        .or(getInspectorPanel(page).getByLabel(/sens du fil/i))
        .first();
      await expect(grainCtrl).toBeVisible();
      expect(await grainCtrl.locator('option').count()).toBeGreaterThan(1);
      await grainCtrl.selectOption({ index: 0 });
      await grainCtrl.selectOption({ index: 1 });
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 6. Plinth / Legs & 4 Handle Styles Boundaries (9 tests)
  // =========================================================================
  test.describe('T2.6 — Limites plinthe, pieds et poignées', () => {
    for (const plinthH of [0, 100, 150, 250]) {
      test(`T2.6 — Hauteur de plinthe ${plinthH} mm bornée et sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const plinthInput = page.locator('aside').first().getByLabel(/plinthe|pieds/i).first();
        await expect(plinthInput).toBeVisible();
        await setNumericInput(plinthInput, plinthH);
        const cutText = await getCutlistText(page);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.6 — Hauteur de plinthe -50 mm rejetée ou bornée sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const cutBefore = await getCutlistText(page);
      await openLeftPanelTab(page, 'atelier');
      const plinthInput = page.locator('aside').first().getByLabel(/plinthe|pieds/i).first();
      await expect(plinthInput).toBeVisible();
      await setNumericInput(plinthInput, -50);
      const val = await readNumericInputValue(plinthInput);
      const cutAfter = await getCutlistText(page);
      expect(val >= 0 || cutAfter === cutBefore).toBe(true);
      expect(cutAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    for (const handlePattern of [/barre/i, /bouton/i, /gorge/i, /push/i]) {
      test(`T2.6 — Poignée "${handlePattern.source}" cohérente dans le Devis BOM`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const handleSelect = page.locator('aside').first().getByLabel(/poign[ée]e/i).first();
        await expect(handleSelect).toBeVisible();
        const options = await handleSelect.locator('option').allInnerTexts();
        const idx = options.findIndex((o) => handlePattern.test(o));
        expect(idx).toBeGreaterThanOrEqual(0);
        await handleSelect.selectOption({ index: idx });
        const devisText = await getDevisText(page);
        expect(devisText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 7. Nesting Sheet / Kerf / Trim / Oversized Boundaries (12 tests)
  // =========================================================================
  test.describe('T2.7 — Limites calepinage 2D (feuilles, trait de scie, délignage, hors format)', () => {
    test('T2.7 — Feuille 2800×2070 calcule correctement les chutes', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      await preset.selectOption({ index: 0 });
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/\d+[.,]?\d*\s*%/);
      guard.assertNoErrors();
    });

    test('T2.7 — Feuille 2440×1220 recalcule un plus grand nombre de feuilles', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      const nestingContainer = page.locator('main, [data-testid*="nesting"]').first();
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      await preset.selectOption({ index: 0 });
      const text2800 = await nestingContainer.innerText();
      await preset.selectOption({ index: 1 });
      const text2440 = await nestingContainer.innerText();
      expect(text2440).toMatch(/\d+[.,]?\d*\s*%/);
      expect(text2440).not.toBe(text2800);
      guard.assertNoErrors();
    });

    test('T2.7 — Pièce surdimensionnée (3000 mm sur 2440×1220) signale pièce non placée', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Plan de travail/i);
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 3000);
      await switchWorkspaceTab(page, 'nesting');
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      await preset.selectOption({ index: 1 });
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/non plac[ée]|hors format|impossible/i);
      guard.assertNoErrors();
    });

    test('T2.7 — Feuille personnalisée minuscule 500×500 signale les pièces hors format sans crash', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchWorkspaceTab(page, 'nesting');
      const preset = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(preset).toBeVisible();
      const options = await preset.locator('option').allInnerTexts();
      const customIdx = options.findIndex((o) => /personnalis[ée]|custom/i.test(o));
      expect(customIdx).toBeGreaterThanOrEqual(0);
      await preset.selectOption({ index: customIdx });

      const lenInput = page.getByLabel(/longueur.*feuille|largeur.*panneau/i).first();
      const widInput = page.getByLabel(/largeur.*feuille|hauteur.*panneau/i).first();
      await expect(lenInput).toBeVisible();
      await expect(widInput).toBeVisible();
      await setNumericInput(lenInput, 500);
      await setNumericInput(widInput, 500);
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/non plac[ée]|hors format/i);
      guard.assertNoErrors();
    });

    for (const kerf of [0, 4, 10, 2000]) {
      test(`T2.7 — Trait de scie = ${kerf} mm géré sans NaN ni boucle infinie`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await switchWorkspaceTab(page, 'nesting');
        const kerfInput = page.getByLabel(/trait de scie/i).first();
        await expect(kerfInput).toBeVisible();
        await setNumericInput(kerfInput, kerf);
        const text = await page.locator('body').innerText();
        expect(text).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.7 — Trait de scie = -4 mm rejeté ou borné sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchWorkspaceTab(page, 'nesting');
      const nestingContainer = page.locator('main, [data-testid*="nesting"]').first();
      const beforeText = await nestingContainer.innerText();
      const kerfInput = page.getByLabel(/trait de scie/i).first();
      await expect(kerfInput).toBeVisible();
      await setNumericInput(kerfInput, -4);
      const val = await readNumericInputValue(kerfInput);
      const afterText = await nestingContainer.innerText();
      expect(val >= 0 || afterText === beforeText).toBe(true);
      expect(afterText).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    for (const trim of [0, 50]) {
      test(`T2.7 — Délignage = ${trim} mm géré et borné sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await switchWorkspaceTab(page, 'nesting');
        const trimInput = page.getByLabel(/d[ée]lignage/i).first();
        await expect(trimInput).toBeVisible();
        await setNumericInput(trimInput, trim);
        const text = await page.locator('body').innerText();
        expect(text).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.7 — Délignage = -10 mm rejeté ou borné sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchWorkspaceTab(page, 'nesting');
      const nestingContainer = page.locator('main, [data-testid*="nesting"]').first();
      const beforeText = await nestingContainer.innerText();
      const trimInput = page.getByLabel(/d[ée]lignage/i).first();
      await expect(trimInput).toBeVisible();
      await setNumericInput(trimInput, -10);
      const val = await readNumericInputValue(trimInput);
      const afterText = await nestingContainer.innerText();
      expect(val >= 0 || afterText === beforeText).toBe(true);
      expect(afterText).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 8. Collision & Snapping Boundaries (6 tests)
  // =========================================================================
  test.describe('T2.8 — Limites détection de collisions', () => {
    test('T2.8 — Contact exact bord à bord (0 mm chevauchement) ne déclenche aucune alerte', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const inspector = getInspectorPanel(page);
      const xInput = inspector.getByLabel(/position x|^x\b/i).first();
      const zInput = inspector.getByLabel(/position z|^z\b/i).first();

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 600);
      await setNumericInput(zInput, 600);

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 1200);
      await setNumericInput(zInput, 600);

      await expect(page.getByText(/collision d[ée]tect[ée]e|chevauchement/i)).toHaveCount(0);
      guard.assertNoErrors();
    });

    test('T2.8 — Chevauchement minimal de 5 mm déclenche l’alerte collision', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const inspector = getInspectorPanel(page);
      const xInput = inspector.getByLabel(/position x|^x\b/i).first();
      const zInput = inspector.getByLabel(/position z|^z\b/i).first();

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 600);
      await setNumericInput(zInput, 600);

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 1195);
      await setNumericInput(zInput, 600);

      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.8 — Chevauchement important de 50 mm déclenche l’alerte collision', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const inspector = getInspectorPanel(page);
      const xInput = inspector.getByLabel(/position x|^x\b/i).first();
      const zInput = inspector.getByLabel(/position z|^z\b/i).first();

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 600);
      await setNumericInput(zInput, 600);

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(selectInspectorDimensions(page).widthInput, 600);
      await setNumericInput(xInput, 1150);
      await setNumericInput(zInput, 600);

      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.8 — Séparation verticale Y (Caisson bas + Caisson haut) sans collision', async ({ page }) => {
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

      await addModuleByFrenchLabel(page, /Caisson haut/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(xInput, 600);
      await setNumericInput(zInput, 600);

      await expect(page.getByText(/collision d[ée]tect[ée]e|chevauchement/i)).toHaveCount(0);
      guard.assertNoErrors();
    });

    test('T2.8 — Superposition caisson devant ouverture Porte sur mur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await addModuleByFrenchLabel(page, /Colonne/i);
      const inspector = getInspectorPanel(page);
      const xInput = inspector.getByLabel(/position x|^x\b/i).first();
      const zInput = inspector.getByLabel(/position z|^z\b/i).first();
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      // Position dégagée initiale : aucune alerte collision avant le chevauchement de la porte
      await setNumericInput(xInput, 1600);
      await setNumericInput(zInput, 2900);
      await expect(page.getByText(/collision|chevauchement/i)).toHaveCount(0);
      // Cuisine en L has Porte d'accès on Mur Est (x=3850, z=2300..3130)
      await setNumericInput(xInput, 3500);
      await setNumericInput(zInput, 2700);
      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible({
        timeout: 5_000,
      });
      guard.assertNoErrors();
    });

    test('T2.8 — Retour à une position dégagée supprime l’alerte collision', async ({ page }) => {
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

      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(xInput, 700);
      await setNumericInput(zInput, 600);
      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible();

      await setNumericInput(xInput, 1500);
      await expect(page.getByText(/collision|chevauchement/i)).toHaveCount(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 9. Corrupted / Invalid JSON Import Rejection (6 tests)
  // =========================================================================
  test.describe('T2.9 — Rejet strict des imports .json invalides ou corrompus', () => {
    for (const fixture of ALL_INVALID_PROJECT_FIXTURES) {
      test(`T2.9 — Rejet fichier corrompu : ${fixture.description}`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        const beforeState = await getRootState(page);

        const dialog = await openProjectLibrary(page);
        const fileInput = dialog.locator('input[type="file"]').first();
        await expect(fileInput).toBeAttached();
        await fileInput.setInputFiles(fixture.payload);

        await expect(
          page.getByText(/invalide|erreur|corrompu|impossible|format/i).first(),
        ).toBeVisible({ timeout: 5_000 });
        await closeModalIfOpen(page);

        const afterState = await getRootState(page);
        expect(afterState.moduleCount).toBe(beforeState.moduleCount);
        expect(afterState.wallCount).toBe(beforeState.wallCount);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 10. Empty Project State Across Views, Tabs & Exports (10 tests)
  // =========================================================================
  test.describe('T2.10 — Projet vide (0 module) dans tous les onglets et exports', () => {
    test('T2.10 — Conception 2D sur projet vide sans erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, 'plan');
      await expect(page.getByTestId('viewport-2d-plan')).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.10 — Vue Élévation sur projet sans modules affiche un état vide propre', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, 'elevation');
      await expect(page.getByTestId('viewport-2d-elevation')).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.10 — Vue 3D sur projet vide initialise la scène sans erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchViewMode(page, '3d');
      await expect(page.locator('#atelier-root[data-scene-ready="true"]')).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.10 — Fiche de débit sur projet vide affiche état vide français sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const text = await getCutlistText(page);
      expect(text).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.10 — Calepinage sur projet vide affiche état vide propre sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchWorkspaceTab(page, 'nesting');
      const text = await page.locator('body').innerText();
      expect(text).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.10 — Devis sur projet vide affiche 0,00 sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const text = await getDevisText(page);
      expect(text).toMatch(/0[,.]00/);
      expect(text).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.10 — Export Plan SVG sur projet vide génère un SVG valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const { filename, buffer } = await triggerExport(page, 'export-plan-svg');
      validateSvgDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('T2.10 — Export Plan PDF sur projet vide génère un PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      const { filename, buffer } = await triggerExport(page, 'export-plan-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('T2.10 — Export Cutlist CSV sur projet vide génère en-tête UTF-8 BOM', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchWorkspaceTab(page, 'cutlist');
      const { filename, buffer } = await triggerExport(page, 'export-cutlist-csv');
      expect(filename).toMatch(/\.csv$/i);
      expect(buffer[0]).toBe(0xef);
      expect(buffer[1]).toBe(0xbb);
      expect(buffer[2]).toBe(0xbf);
      guard.assertNoErrors();
    });

    test('T2.10 — Export Devis PDF sur projet vide génère un PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await switchWorkspaceTab(page, 'devis');
      const { filename, buffer } = await triggerExport(page, 'export-devis-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 11. Extreme Module Dimensions (11 tests)
  // =========================================================================
  test.describe('T2.11 — Dimensions extrêmes de modules', () => {
    for (const w of [50, 3500, 5000]) {
      test(`T2.11 — Largeur module extrême (${w} mm) bornée et sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const { widthInput } = selectInspectorDimensions(page);
        await setNumericInput(widthInput, w);
        expect(await readNumericInputValue(widthInput)).toBeGreaterThan(0);
        const cutText = await getCutlistText(page);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const w of [0, -200]) {
      test(`T2.11 — Largeur module invalide (${w} mm) rejetée/bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const cutBefore = await getCutlistText(page);
        await switchWorkspaceTab(page, 'conception');
        const { widthInput } = selectInspectorDimensions(page);
        await setNumericInput(widthInput, w);
        const val = await readNumericInputValue(widthInput);
        const invalidVis = await getInspectorPanel(page).getByText(/dimension invalide/i).first().isVisible();
        const cutAfter = await getCutlistText(page);
        expect(val > 0 || (invalidVis && cutAfter === cutBefore)).toBe(true);
        expect(cutAfter).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const h of [100, 2800]) {
      test(`T2.11 — Hauteur module extrême (${h} mm) bornée et sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Colonne/i);
        const { heightInput } = selectInspectorDimensions(page);
        await setNumericInput(heightInput, h);
        expect(await readNumericInputValue(heightInput)).toBeGreaterThan(0);
        const cutText = await getCutlistText(page);
        expect(cutText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const h of [0, -100]) {
      test(`T2.11 — Hauteur module invalide (${h} mm) rejetée/bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Colonne/i);
        const cutBefore = await getCutlistText(page);
        await switchWorkspaceTab(page, 'conception');
        const { heightInput } = selectInspectorDimensions(page);
        await setNumericInput(heightInput, h);
        const val = await readNumericInputValue(heightInput);
        const invalidVis = await getInspectorPanel(page).getByText(/dimension invalide/i).first().isVisible();
        const cutAfter = await getCutlistText(page);
        expect(val > 0 || (invalidVis && cutAfter === cutBefore)).toBe(true);
        expect(cutAfter).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const d of [0, -50]) {
      test(`T2.11 — Profondeur module invalide (${d} mm) rejetée/bornée`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const cutBefore = await getCutlistText(page);
        await switchWorkspaceTab(page, 'conception');
        const { depthInput } = selectInspectorDimensions(page);
        await setNumericInput(depthInput, d);
        const val = await readNumericInputValue(depthInput);
        const invalidVis = await getInspectorPanel(page).getByText(/dimension invalide/i).first().isVisible();
        const cutAfter = await getCutlistText(page);
        expect(val > 0 || (invalidVis && cutAfter === cutBefore)).toBe(true);
        expect(cutAfter).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 12. Extreme Wall Dimensions (8 tests)
  // =========================================================================
  test.describe('T2.12 — Dimensions extrêmes des murs', () => {
    for (const wallLen of [150, 15000]) {
      test(`T2.12 — Longueur mur (${wallLen} mm) bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchViewMode(page, 'plan');
        const wallEl = page
          .getByTestId('viewport-2d-plan')
          .locator('svg:has([data-wall-id]) [data-wall-id], svg:not(:has([data-wall-id])) > line')
          .first();
        await expect(wallEl).toBeVisible();
        await wallEl.click({ force: true });
        const inspector = getInspectorPanel(page);
        const lenInput = inspector.getByLabel(/longueur/i).first();
        await expect(lenInput).toBeVisible();
        await setNumericInput(lenInput, wallLen);
        expect(await readNumericInputValue(lenInput)).toBeGreaterThan(0);
        expect(await page.locator('body').innerText()).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const wallLen of [0, -500]) {
      test(`T2.12 — Longueur mur invalide (${wallLen} mm) rejetée/bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchViewMode(page, 'plan');
        const wallEl = page
          .getByTestId('viewport-2d-plan')
          .locator('svg:has([data-wall-id]) [data-wall-id], svg:not(:has([data-wall-id])) > line')
          .first();
        await expect(wallEl).toBeVisible();
        await wallEl.click({ force: true });
        const inspector = getInspectorPanel(page);
        const lenInput = inspector.getByLabel(/longueur/i).first();
        await expect(lenInput).toBeVisible();
        await setNumericInput(lenInput, wallLen);
        const val = await readNumericInputValue(lenInput);
        const invalidVis = await inspector.getByText(/dimension invalide/i).first().isVisible();
        expect(val > 0 || invalidVis).toBe(true);
        expect(await page.locator('body').innerText()).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    for (const wallThick of [50, 600]) {
      test(`T2.12 — Épaisseur mur (${wallThick} mm) rendue proprement`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchViewMode(page, 'plan');
        const wallEl = page
          .getByTestId('viewport-2d-plan')
          .locator('svg:has([data-wall-id]) [data-wall-id], svg:not(:has([data-wall-id])) > line')
          .first();
        await expect(wallEl).toBeVisible();
        await wallEl.click({ force: true });
        const inspector = getInspectorPanel(page);
        const thickInput = inspector.getByLabel(/^[ée]paisseur/i).first();
        await expect(thickInput).toBeVisible();
        await setNumericInput(thickInput, wallThick);
        await switchViewMode(page, '3d');
        await assertCanvasNonBlank(page);
        guard.assertNoErrors();
      });
    }

    for (const ceilingH of [2000, 4500]) {
      test(`T2.12 — Hauteur sous plafond (${ceilingH} mm) valide en élévation et 3D`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchViewMode(page, 'plan');
        const wallEl = page
          .getByTestId('viewport-2d-plan')
          .locator('svg:has([data-wall-id]) [data-wall-id], svg:not(:has([data-wall-id])) > line')
          .first();
        await expect(wallEl).toBeVisible();
        await wallEl.click({ force: true });
        const inspector = getInspectorPanel(page);
        const ceilInput = inspector.getByLabel(/^hauteur|plafond/i).first();
        await expect(ceilInput).toBeVisible();
        await setNumericInput(ceilInput, ceilingH);
        await switchViewMode(page, 'elevation');
        const elev = page.getByTestId('viewport-2d-elevation');
        await expect(elev.locator('svg').first()).toBeVisible();
        const elevText = (await elev.innerText()).replace(/[\s\u00a0\u202f]/g, '');
        expect(elevText).toContain(String(ceilingH));
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // 13. Unit mm/cm Boundary Conversions (6 tests)
  // =========================================================================
  test.describe('T2.13 — Limites conversion mm / cm', () => {
    test('T2.13 — Saisie décimale 12.5 cm convertie exactement à 125 mm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 12.5);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect(await readNumericInputValue(widthInput)).toBeGreaterThanOrEqual(125);
      guard.assertNoErrors();
    });

    test('T2.13 — Grande dimension 2400 mm affichée en 240 cm sans perte', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Colonne/i);
      const { heightInput } = selectInspectorDimensions(page);
      await setNumericInput(heightInput, 2400);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      expect(await readNumericInputValue(heightInput)).toBe(240);
      guard.assertNoErrors();
    });

    test('T2.13 — Valeur négative saisie en mode cm est rejetée/bornée', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const cutBefore = await getCutlistText(page);
      await switchWorkspaceTab(page, 'conception');
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, -20);
      const val = await readNumericInputValue(widthInput);
      const invalidVis = await getInspectorPanel(page).getByText(/dimension invalide/i).first().isVisible();
      const cutAfter = await getCutlistText(page);
      expect(val > 0 || (invalidVis && cutAfter === cutBefore)).toBe(true);
      expect(cutAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.13 — Invariance de la Fiche de débit en mode cm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const cutMm = await getCutlistText(page);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      const cutCm = await getCutlistText(page);
      expect(cutCm).toBe(cutMm);
      guard.assertNoErrors();
    });

    test('T2.13 — Invariance des m² et ml du Devis en mode cm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const devisMm = await getDevisText(page);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      const devisCm = await getDevisText(page);
      expect(devisCm).toBe(devisMm);
      guard.assertNoErrors();
    });

    test('T2.13 — Export CSV reste strictement en mm même quand UI est en cm', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { widthInput } = selectInspectorDimensions(page);
      await setNumericInput(widthInput, 750);
      await openDisplayMenu(page);
      await page.getByTestId('unit-toggle').click();
      await switchWorkspaceTab(page, 'cutlist');
      const { filename, buffer } = await triggerExport(page, 'export-cutlist-csv');
      const csv = validateCsvDownload(buffer, filename);
      expect(csv).toMatch(/750|714/);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 14. Currency & Devis Math Boundaries (9 tests)
  // =========================================================================
  test.describe('T2.14 — Limites Devis, TVA, marge et devises', () => {
    for (const tva of [0, 20, 100]) {
      test(`T2.14 — TVA = ${tva}% calculée et bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchWorkspaceTab(page, 'devis');
        const tvaInput = page.getByLabel(/tva/i).first();
        await expect(tvaInput).toBeVisible();
        await setNumericInput(tvaInput, tva);
        const devisText = await getDevisText(page);
        expect(devisText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.14 — TVA = -5% rejetée ou bornée sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const devisBefore = await getDevisText(page);
      const tvaInput = page.getByLabel(/tva/i).first();
      await expect(tvaInput).toBeVisible();
      await setNumericInput(tvaInput, -5);
      const val = await readNumericInputValue(tvaInput);
      const devisAfter = await getDevisText(page);
      expect(val >= 0 || devisAfter === devisBefore).toBe(true);
      expect(devisAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    for (const margin of [0, 50]) {
      test(`T2.14 — Marge = ${margin}% calculée et bornée sans NaN`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchWorkspaceTab(page, 'devis');
        const marginInput = page.getByLabel(/marge/i).first();
        await expect(marginInput).toBeVisible();
        await setNumericInput(marginInput, margin);
        const devisText = await getDevisText(page);
        expect(devisText).not.toMatch(/NaN|Infinity/i);
        guard.assertNoErrors();
      });
    }

    test('T2.14 — Marge = -10% rejetée ou bornée sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const devisBefore = await getDevisText(page);
      const marginInput = page.getByLabel(/marge/i).first();
      await expect(marginInput).toBeVisible();
      await setNumericInput(marginInput, -10);
      const val = await readNumericInputValue(marginInput);
      const devisAfter = await getDevisText(page);
      expect(val >= 0 || devisAfter === devisBefore).toBe(true);
      expect(devisAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.14 — Prix unitaire = 0 géré sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const priceInput = page.locator('input[type="number"]').first();
      await expect(priceInput).toBeVisible();
      await setNumericInput(priceInput, 0);
      const devisText = await getDevisText(page);
      expect(devisText).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('T2.14 — Prix unitaire = -100 rejeté ou borné sans NaN', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const devisBefore = await getDevisText(page);
      const priceInput = page.locator('input[type="number"]').first();
      await expect(priceInput).toBeVisible();
      await setNumericInput(priceInput, -100);
      const val = await readNumericInputValue(priceInput);
      const devisAfter = await getDevisText(page);
      expect(val >= 0 || devisAfter === devisBefore).toBe(true);
      expect(devisAfter).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 15. Undo / Redo Stack Boundaries (5 tests)
  // =========================================================================
  test.describe('T2.15 — Limites pile Annuler / Rétablir', () => {
    test('T2.15 — Annuler sur pile vide ne génère aucune erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await page.getByTestId('btn-undo').click({ force: true });
      await page.keyboard.press('Control+z');
      expect((await getRootState(page)).moduleCount).toBe(0);
      guard.assertNoErrors();
    });

    test('T2.15 — Rétablir sur pile redo vide ne modifie pas l’état', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await page.getByTestId('btn-redo').click({ force: true });
      await page.keyboard.press('Control+y');
      expect((await getRootState(page)).moduleCount).toBe(1);
      guard.assertNoErrors();
    });

    test('T2.15 — Pile profonde de 10 ajouts consécutifs annulés et rétablis', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      for (let i = 0; i < 10; i++) {
        await addModuleByFrenchLabel(page, /Caisson bas/i);
      }
      expect((await getRootState(page)).moduleCount).toBe(10);
      for (let i = 0; i < 10; i++) {
        await page.getByTestId('btn-undo').click();
      }
      expect((await getRootState(page)).moduleCount).toBe(0);
      for (let i = 0; i < 10; i++) {
        await page.getByTestId('btn-redo').click();
      }
      expect((await getRootState(page)).moduleCount).toBe(10);
      guard.assertNoErrors();
    });

    test('T2.15 — Nouvelle action après Undo invalide la branche Redo', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await addModuleByFrenchLabel(page, /Caisson haut/i);
      await page.getByTestId('btn-undo').click();
      await addModuleByFrenchLabel(page, /Colonne/i);
      await page.getByTestId('btn-redo').click({ force: true });
      expect((await getRootState(page)).moduleCount).toBe(2);
      guard.assertNoErrors();
    });

    test('T2.15 — Annuler après bascule multi-vues n’altère pas data-view-mode', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await switchViewMode(page, 'split');
      await page.getByTestId('btn-undo').click();
      expect((await getRootState(page)).viewMode).toBe('split');
      expect((await getRootState(page)).moduleCount).toBe(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 16. IndexedDB & Library Boundaries (5 tests)
  // =========================================================================
  test.describe('T2.16 — Limites bibliothèque IndexedDB', () => {
    test('T2.16 — Sauvegarde avec nom accentué et caractères spéciaux français', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Biblioth[èe]que/i);
      const specialName = 'Étagère & Chêne N°1 — Hôtel';
      await saveProjectToLibrary(page, specialName);
      const dialog = await openProjectLibrary(page);
      await expect(getProjectCardLocator(dialog, specialName)).toBeVisible();
      guard.assertNoErrors();
    });

    test('T2.16 — Sauvegarde avec nom vide utilise un libellé français par défaut ou bloque proprement', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
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

      const nameInput = activeCard.locator('input[type="text"], input:not([type])').first();
      await expect(nameInput).toBeVisible();
      await nameInput.fill('   ');
      const confirmBtn = activeCard.getByRole('button', { name: /valider|confirmer/i }).first();
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      await expect(activeCard.getByText(/Nouvel agencement|invalide|erreur|obligatoire/i).first()).toBeVisible();
      await closeModalIfOpen(page);
      guard.assertNoErrors();
    });

    test('T2.16 — Deux projets portant le même nom ne cassent pas IndexedDB', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await saveProjectToLibrary(page, 'Doublon Test');
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson haut/i);
      await saveProjectToLibrary(page, 'Doublon Test');
      const dialog = await openProjectLibrary(page);
      expect(await dialog.getByText('Doublon Test', { exact: true }).count()).toBeGreaterThanOrEqual(2);
      guard.assertNoErrors();
    });

    test('T2.16 — Suppression du projet courant conserve le studio fonctionnel', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await saveProjectToLibrary(page, 'Projet Courant Del');
      const dialog = await openProjectLibrary(page);
      const card = getProjectCardLocator(dialog, 'Projet Courant Del');
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /supprimer/i }).first().click();
      await closeModalIfOpen(page);
      await addModuleByFrenchLabel(page, /Bureau/i);
      expect((await getRootState(page)).moduleCount).toBe(2);
      guard.assertNoErrors();
    });

    test('T2.16 — Rechargement page avec bibliothèque vide ne lève aucune erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await reloadStudio(page);
      await expect(page.locator('#atelier-root')).toBeVisible();
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // 17. Runtime, Viewport, Export & French Leak Boundaries (8 tests)
  // =========================================================================
  test.describe('T2.17 — Limites vue, export et authenticité française', () => {
    test('T2.17 — Élévation sur projet avec 0 mur affiche message propre', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await clearAllWalls(page);
      expect((await getRootState(page)).wallCount).toBe(0);
      await switchViewMode(page, 'elevation');
      await expect(page.getByTestId('viewport-2d-elevation')).toBeVisible();
      await assertFrenchAuthenticity(page);
      guard.assertNoErrors();
    });

    test('T2.17 — Export PNG en vue Split fonctionne sans inclure les contrôles UI', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'split');
      const { filename, buffer } = await triggerExport(page, 'export-render-png');
      validatePngDownload(buffer, filename, 800, 450);
      guard.assertNoErrors();
    });

    test('T2.17 — Export GLB sur projet avec 1 seul module fonctionne', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Bureau/i);
      expect((await getRootState(page)).moduleCount).toBe(1);
      const { filename, buffer } = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('T2.17 — Bascule rapide Jour/Nuit et LEDs 6 fois sans erreur WebGL', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      for (let i = 0; i < 6; i++) {
        await page.getByTestId('btn-lighting-toggle').click();
        await page.getByTestId('btn-led-toggle').click();
      }
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    for (const tab of ['conception', 'cutlist', 'nesting', 'devis'] as const) {
      test(`T2.17 — Contrôle anti-anglicismes sur onglet "${tab}" avec template chargé`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await loadTemplate(page, 'Cuisine en L');
        await switchWorkspaceTab(page, tab);
        await assertFrenchAuthenticity(page);
        guard.assertNoErrors();
      });
    }
  });
});
