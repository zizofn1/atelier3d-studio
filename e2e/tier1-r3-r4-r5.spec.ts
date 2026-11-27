import { expect, test } from '@playwright/test';
import {
  addModuleByFrenchLabel,
  assertCanvasNonBlank,
  assertFrenchAuthenticity,
  attachErrorGuard,
  captureCanvasPngBuffer,
  createBlankProject,
  get3DCanvasLocator,
  getCutlistRowCount,
  getCutlistText,
  getDevisText,
  getInspectorPanel,
  getRootState,
  loadTemplate,
  openLeftPanelTab,
  openStudio,
  parseFrenchMoney,
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

const ALL_16_MODULES: Array<{ category: string; name: string; pattern: RegExp }> = [
  { category: 'Cuisine', name: 'Caisson bas', pattern: /Caisson bas/i },
  { category: 'Cuisine', name: 'Caisson haut', pattern: /Caisson haut/i },
  { category: 'Cuisine', name: 'Colonne four/réfrigérateur', pattern: /Colonne/i },
  { category: 'Cuisine', name: "Caisson d'angle", pattern: /Caisson d'angle|Angle/i },
  { category: 'Cuisine', name: 'Îlot central', pattern: /[ÎI]lot central/i },
  { category: 'Cuisine', name: 'Plan de travail continu', pattern: /Plan de travail/i },
  { category: 'Cuisine', name: 'Crédence', pattern: /Cr[ée]dence/i },
  { category: 'Cuisine', name: 'Plinthe', pattern: /Plinthe/i },
  { category: 'Dressing', name: 'Module penderie', pattern: /Penderie/i },
  { category: 'Dressing', name: 'Colonne étagères', pattern: /[ÉE]tag[èe]res/i },
  { category: 'Dressing', name: 'Bloc tiroirs', pattern: /Bloc tiroirs|Tiroirs/i },
  { category: 'Dressing', name: 'Portes battantes', pattern: /Portes battantes/i },
  { category: 'Dressing', name: 'Portes coulissantes', pattern: /Portes coulissantes/i },
  { category: 'Mobilier', name: 'Meuble TV', pattern: /Meuble TV/i },
  { category: 'Mobilier', name: 'Bibliothèque', pattern: /Biblioth[èe]que/i },
  { category: 'Mobilier', name: 'Bureau', pattern: /Bureau/i },
];

const PANEL_THICKNESSES = [16, 18, 19, 22] as const;

const HANDLE_STYLES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Poignée barre', pattern: /barre/i },
  { label: 'Bouton', pattern: /bouton/i },
  { label: 'Gorge sans poignée', pattern: /gorge/i },
  { label: 'Push-to-open', pattern: /push/i },
];

test.describe('Tier 1 — R3, R4 & R5 (F7–F9, F17–F24)', () => {
  // =========================================================================
  // F7: Catalogue 16 Modules Paramétriques (18 tests)
  // =========================================================================
  test.describe('F7 — Catalogue des 16 Modules Paramétriques', () => {
    for (const mod of ALL_16_MODULES) {
      test(`F7 — Ajout et décomposition en panneaux : ${mod.category} / ${mod.name}`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, mod.pattern);
        const rows = await getCutlistRowCount(page);
        expect(rows).toBeGreaterThan(0);
        const cutlistText = await getCutlistText(page);
        expect(cutlistText).toMatch(/\d{2,4}/);
        guard.assertNoErrors();
      });
    }

    test('F7.17 — Ajout combiné des 16 modules dans un même projet', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      for (const mod of ALL_16_MODULES) {
        await addModuleByFrenchLabel(page, mod.pattern);
      }
      expect((await getRootState(page)).moduleCount).toBe(16);
      expect(await getCutlistRowCount(page)).toBeGreaterThanOrEqual(16);
      guard.assertNoErrors();
    });

    test('F7.18 — Rendu 3D WebGL des 16 modules assemblés sans erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      for (const mod of ALL_16_MODULES) {
        await addModuleByFrenchLabel(page, mod.pattern);
      }
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F8: Paramètres Menuiserie & Joinery (13 tests)
  // =========================================================================
  test.describe('F8 — Paramètres Menuiserie & Joinery', () => {
    for (const thickness of PANEL_THICKNESSES) {
      test(`F8.1 — Épaisseur panneau ${thickness} mm reflétée dans la Fiche de débit`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await openLeftPanelTab(page, 'atelier');
        const thicknessControl = page
          .locator('aside')
          .first()
          .getByLabel(/^[ée]paisseur panneau/i)
          .first();
        await expect(thicknessControl).toBeVisible();
        await thicknessControl.selectOption(String(thickness));
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        const cutlistText = await getCutlistText(page);
        expect(cutlistText).toContain(String(thickness));
        expect(cutlistText).toContain(String(800 - 2 * thickness));
        guard.assertNoErrors();
      });
    }

    test('F8.2 — Épaisseur du fond 5 mm vs 8 mm dans la Fiche de débit', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const backThick = page
        .locator('aside')
        .first()
        .getByLabel(/fond.*([ée]paisseur|mm)|[ée]paisseur.*fond/i)
        .first();
      await expect(backThick).toBeVisible();
      await backThick.selectOption('5');
      const text5 = await getCutlistText(page);
      expect(text5).toMatch(/Fond/i);
      expect(text5).toContain('5');

      await openLeftPanelTab(page, 'atelier');
      await backThick.selectOption('8');
      const text8 = await getCutlistText(page);
      expect(text8).toContain('8');
      expect(text8).not.toBe(text5);
      guard.assertNoErrors();
    });

    test('F8.3 — Montage du fond Rainuré vs Appliqué modifie les dimensions du Fond', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const backMode = page
        .locator('aside')
        .first()
        .getByLabel(/montage.*fond|type.*fond|rainur[ée]|appliqu[ée]/i)
        .first();
      await expect(backMode).toBeVisible();
      expect(await backMode.locator('option').count()).toBeGreaterThan(1);
      await backMode.selectOption({ index: 0 });
      const cutRainure = await getCutlistText(page);

      await openLeftPanelTab(page, 'atelier');
      await backMode.selectOption({ index: 1 });
      const cutApplique = await getCutlistText(page);
      expect(cutApplique).not.toBe(cutRainure);
      guard.assertNoErrors();
    });

    test('F8.4 — Jeu entre façades (2 mm vs 3 mm) ajuste les cotes de façade', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const clearanceInput = page
        .locator('aside')
        .first()
        .getByLabel(/jeu.*fa[çc]ade|jeu/i)
        .first();
      await expect(clearanceInput).toBeVisible();
      await setNumericInput(clearanceInput, 2);
      const cut2 = await getCutlistText(page);

      await openLeftPanelTab(page, 'atelier');
      await setNumericInput(clearanceInput, 3);
      const cut3 = await getCutlistText(page);
      expect(cut3).not.toBe(cut2);
      guard.assertNoErrors();
    });

    test('F8.5 — Bandes de chant 4 bords (0.4 mm / 2 mm) reflétées dans Débit et Devis', async ({ page }) => {
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
      const optCount = await edgeSelect.locator('option').count();
      expect(optCount).toBeGreaterThan(1);

      await edgeSelect.selectOption({ index: 0 });
      const cutBefore = await getCutlistText(page);

      await openLeftPanelTab(page, 'atelier');
      await edgeSelect.selectOption({ index: optCount - 1 });
      const cutAfter = await getCutlistText(page);
      expect(cutAfter).not.toBe(cutBefore);
      expect(cutAfter).toMatch(/\b(0[.,]4|2)\b/);

      const devisText = await getDevisText(page);
      expect(devisText).toMatch(/\d+[.,]?\d*\s*ml\b/i);
      guard.assertNoErrors();
    });

    test('F8.6 — Pieds réglables et hauteur de plinthe modifient la pièce Plinthe', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      await openLeftPanelTab(page, 'atelier');
      const plinthInput = page
        .locator('aside')
        .first()
        .getByLabel(/plinthe|pieds/i)
        .first();
      await expect(plinthInput).toBeVisible();
      await setNumericInput(plinthInput, 100);
      const cut100 = await getCutlistText(page);

      await openLeftPanelTab(page, 'atelier');
      await setNumericInput(plinthInput, 150);
      const cut150 = await getCutlistText(page);
      expect(cut150).toContain('150');
      expect(cut150).not.toBe(cut100);
      guard.assertNoErrors();
    });

    for (const style of HANDLE_STYLES) {
      test(`F8.7 — Style de poignée "${style.label}" met à jour le module et le Devis BOM`, async ({ page }) => {
        const guard = attachErrorGuard(page);
        await openStudio(page);
        await createBlankProject(page);
        await addModuleByFrenchLabel(page, /Caisson bas/i);
        await openLeftPanelTab(page, 'atelier');
        const handleSelect = page
          .locator('aside')
          .first()
          .getByLabel(/poign[ée]e/i)
          .first();
        await expect(handleSelect).toBeVisible();
        const options = await handleSelect.locator('option').allInnerTexts();
        const idx = options.findIndex((o) => style.pattern.test(o));
        expect(idx).toBeGreaterThanOrEqual(0);
        await handleSelect.selectOption({ index: idx });
        const devisText = await getDevisText(page);
        expect(devisText).toMatch(/Quincaillerie|Poign|Bouton|Gorge|Push/i);
        guard.assertNoErrors();
      });
    }
  });

  // =========================================================================
  // F9: Magnétisme & Détection Collisions (5 tests)
  // =========================================================================
  test.describe('F9 — Magnétisme & Détection Collisions', () => {
    test('F9.1 — Magnétisme mur-caisson aligne le caisson sans collision', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(/chevauchement|collision d[ée]tect[ée]e/i);
      guard.assertNoErrors();
    });

    test('F9.2 — Deux caissons côte à côte sans recouvrement restent sans alerte', async ({ page }) => {
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

    test('F9.3 — Alignement vertical Caisson bas + Caisson haut sans collision', async ({ page }) => {
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

    test('F9.4 — Superposition de deux caissons bas déclenche une alerte collision en français', async ({ page }) => {
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

      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible({ timeout: 5_000 });
      guard.assertNoErrors();
    });

    test('F9.5 — Déplacement du caisson hors zone de conflit supprime l’alerte collision', async ({ page }) => {
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
      await setNumericInput(xInput, 650);
      await setNumericInput(zInput, 600);
      await expect(page.getByText(/collision|chevauchement/i).first()).toBeVisible();

      await setNumericInput(xInput, 1500);
      await expect(page.getByText(/collision|chevauchement/i)).toHaveCount(0);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F17: Animations 3D Portes & Tiroirs (5 tests)
  // =========================================================================
  test.describe('F17 — Animations 3D Portes & Tiroirs', () => {
    test('F17.1 — Attribut data-open-all initialisé à false', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      expect((await getRootState(page)).openAll).toBe(false);
      guard.assertNoErrors();
    });

    test('F17.2 — Bouton "Ouvrir tout" anime les portes/tiroirs et modifie le rendu 3D', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const closedPng = await captureCanvasPngBuffer(page);

      await page.getByTestId('btn-toggle-open-all').click();
      expect((await getRootState(page)).openAll).toBe(true);
      const openPng = await captureCanvasPngBuffer(page, 600);
      expect(Buffer.compare(closedPng, openPng)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F17.3 — Second clic sur "Ouvrir tout" referme les façades', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-toggle-open-all').click();
      const openPng = await captureCanvasPngBuffer(page, 500);

      await page.getByTestId('btn-toggle-open-all').click();
      expect((await getRootState(page)).openAll).toBe(false);
      const closedAgainPng = await captureCanvasPngBuffer(page, 600);
      expect(Buffer.compare(openPng, closedAgainPng)).not.toBe(0);
      guard.assertNoErrors();
    });

    test('F17.4 — Clic interactif dans le viewport 3D ouvre/anime la façade sans erreur', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const inspector = getInspectorPanel(page);
      const xInput = inspector.getByLabel(/position x|^x\b/i).first();
      const zInput = inspector.getByLabel(/position z|^z\b/i).first();
      await expect(xInput).toBeVisible();
      await expect(zInput).toBeVisible();
      await setNumericInput(xInput, 2000);
      await setNumericInput(zInput, 1500);

      await switchViewMode(page, '3d');
      const before = await captureCanvasPngBuffer(page);
      const canvas = await get3DCanvasLocator(page);
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      const after = await captureCanvasPngBuffer(page, 600);
      expect(Buffer.compare(before, after)).not.toBe(0);
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F17.5 — Bascules rapides répétées Ouvrir/Fermer sans fuite ou crash', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      await switchViewMode(page, '3d');
      for (let i = 0; i < 4; i++) {
        await page.getByTestId('btn-toggle-open-all').click();
        await page.waitForTimeout(120);
      }
      expect((await getRootState(page)).openAll).toBe(false);
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F18: Fiche de Débit CSV & PDF (5 tests)
  // =========================================================================
  test.describe('F18 — Fiche de Débit (CSV & PDF)', () => {
    test('F18.1 — Tableau Fiche de débit affiche colonnes françaises obligatoires', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const text = await getCutlistText(page);
      expect(text).toMatch(/Rep[èe]re|Pi[èe]ce/i);
      expect(text).toMatch(/Mat[ée]riau/i);
      expect(text).toMatch(/Longueur/i);
      expect(text).toMatch(/Largeur/i);
      expect(text).toMatch(/[ÉE]paisseur/i);
      expect(text).toMatch(/Fil/i);
      expect(text).toMatch(/Chants/i);
      guard.assertNoErrors();
    });

    test('F18.2 — Le nombre de pièces croît à l’ajout d’un module', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const count1 = await getCutlistRowCount(page);
      await switchWorkspaceTab(page, 'conception');
      await addModuleByFrenchLabel(page, /Bloc tiroirs/i);
      const count2 = await getCutlistRowCount(page);
      expect(count2).toBeGreaterThan(count1);
      guard.assertNoErrors();
    });

    test('F18.3 — Chaque pièce indique sens du fil et codes chants 4 bords', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const text = await getCutlistText(page);
      expect(text).toMatch(/\b(H|V|Horizontal|Vertical)\b/i);
      expect(text).toMatch(/\b(0[.,]4|2)\b/);
      guard.assertNoErrors();
    });

    test('F18.4 — Export Fiche de débit CSV UTF-8 BOM + séparateur point-virgule', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'cutlist');
      const { filename, buffer } = await triggerExport(page, 'export-cutlist-csv');
      const csvText = validateCsvDownload(buffer, filename);
      expect(csvText).toMatch(/Caisson|Fond|Joue|Fa[çc]ade/i);
      guard.assertNoErrors();
    });

    test('F18.5 — Export Fiche de débit PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'cutlist');
      const { filename, buffer } = await triggerExport(page, 'export-cutlist-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F19: Optimiseur de Découpe 2D Guillotine (5 tests)
  // =========================================================================
  test.describe('F19 — Optimiseur de Découpe 2D Guillotine', () => {
    test('F19.1 — Calepinage affiche diagrammes SVG avec repères et taux de chute %', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      await expect(page.locator('svg').first()).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/Taux de chute/i);
      expect(text).toMatch(/%/);
      guard.assertNoErrors();
    });

    test('F19.2 — Bascule format panneau 2800×2070 vs 2440×1220 recalcule le nombre de feuilles', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      const presetSelect = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(presetSelect).toBeVisible();
      await presetSelect.selectOption({ index: 0 });
      const view2800 = await page.locator('main, [data-testid*="nesting"]').first().innerText();
      await presetSelect.selectOption({ index: 1 });
      const view2440 = await page.locator('main, [data-testid*="nesting"]').first().innerText();
      expect(view2440).not.toBe(view2800);
      guard.assertNoErrors();
    });

    test('F19.3 — Saisie format panneau personnalisé 2500×1250 recalcule le calepinage', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      await switchWorkspaceTab(page, 'nesting');
      const nestingContainer = page.locator('main, [data-testid*="nesting"]').first();
      const before = await nestingContainer.innerText();
      const presetSelect = page.getByLabel(/format.*panneau|panneau|feuille/i).first();
      await expect(presetSelect).toBeVisible();
      const options = await presetSelect.locator('option').allInnerTexts();
      const customIdx = options.findIndex((o) => /personnalis[ée]|custom/i.test(o));
      expect(customIdx).toBeGreaterThanOrEqual(0);
      await presetSelect.selectOption({ index: customIdx });

      const wInput = page.getByLabel(/longueur.*feuille|largeur.*panneau/i).first();
      const hInput = page.getByLabel(/largeur.*feuille|hauteur.*panneau/i).first();
      await expect(wInput).toBeVisible();
      await expect(hInput).toBeVisible();
      await setNumericInput(wInput, 2500);
      await setNumericInput(hInput, 1250);

      expect(await page.locator('svg').count()).toBeGreaterThan(0);
      const after = await nestingContainer.innerText();
      expect(after).not.toBe(before);
      expect(after).toMatch(/2[\s\u00a0\u202f]?500/);
      expect(after).toMatch(/1[\s\u00a0\u202f]?250/);
      guard.assertNoErrors();
    });

    test('F19.4 — Trait de scie (8 mm), délignage (25 mm) et verrouillage du fil recalcule le calepinage', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      const nestingContainer = page.locator('main, [data-testid*="nesting"]').first();
      const before = await nestingContainer.innerText();

      const kerfInput = page.getByLabel(/trait de scie/i).first();
      const trimInput = page.getByLabel(/d[ée]lignage/i).first();
      const grainToggle = page.getByLabel(/respecter le sens du fil/i).first();
      await expect(kerfInput).toBeVisible();
      await expect(trimInput).toBeVisible();
      await expect(grainToggle).toBeVisible();

      await setNumericInput(kerfInput, 8);
      await setNumericInput(trimInput, 25);
      await grainToggle.click();

      expect(await page.locator('svg').count()).toBeGreaterThan(0);
      const after = await nestingContainer.innerText();
      expect(after).not.toBe(before);
      expect(after).not.toMatch(/NaN|Infinity/i);
      guard.assertNoErrors();
    });

    test('F19.5 — Export Calepinage PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'nesting');
      const { filename, buffer } = await triggerExport(page, 'export-nesting-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F20: Devis Automatique & Quincaillerie BOM (5 tests)
  // =========================================================================
  test.describe('F20 — Devis Automatique & Quincaillerie BOM', () => {
    test('F20.1 — Devis calcule la surface panneaux (m²) et chants (ml)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const text = await getDevisText(page);
      expect(text).toMatch(/m²|m2/i);
      expect(text).toMatch(/\bml\b/i);
      guard.assertNoErrors();
    });

    test('F20.2 — Nomenclature quincaillerie BOM complète', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const text = await getDevisText(page);
      expect(text).toMatch(/Charni[èe]re/i);
      expect(text).toMatch(/Coulisse|Pied|Poign[ée]e/i);
      guard.assertNoErrors();
    });

    test('F20.3 — Prix unitaires éditables recalculent Total HT et TTC', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const before = await getDevisText(page);
      const priceInput = page.locator('input[type="number"]').first();
      await expect(priceInput).toBeVisible();
      await setNumericInput(priceInput, 999);
      const after = await getDevisText(page);
      expect(after).not.toBe(before);
      guard.assertNoErrors();
    });

    test('F20.4 — Marge, Main d’œuvre, TVA 20% et en-tête client/atelier', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const before = await getDevisText(page);

      const marginInput = page.getByLabel(/marge/i).first();
      const laborInput = page.getByLabel(/main d['’]œuvre|main-d['’]œuvre/i).first();
      const tvaInput = page.getByLabel(/tva/i).first();
      const clientInput = page.getByLabel(/client/i).first();
      const companyInput = page.getByLabel(/atelier|entreprise|soci[ée]t[ée]/i).first();

      await expect(marginInput).toBeVisible();
      await expect(laborInput).toBeVisible();
      await expect(tvaInput).toBeVisible();
      await expect(clientInput).toBeVisible();
      await expect(companyInput).toBeVisible();

      await setNumericInput(marginInput, 25);
      await setNumericInput(laborInput, 15);
      await setNumericInput(tvaInput, 20);
      await clientInput.fill('Atelier Casablanca SARL');
      await expect(clientInput).toHaveValue('Atelier Casablanca SARL');
      await companyInput.fill('Menuiserie Atlas');
      await expect(companyInput).toHaveValue('Menuiserie Atlas');

      const after = await getDevisText(page);
      expect(after).not.toBe(before);
      expect(after).toMatch(/TVA/i);
      expect(after).toMatch(/HT/i);
      expect(after).toMatch(/TTC/i);

      const ht = parseFrenchMoney(after, /Total\s*HT/i);
      const ttc = parseFrenchMoney(after, /Total\s*TTC/i);
      expect(ht).toBeGreaterThan(0);
      expect(Math.abs(ttc - ht * 1.2)).toBeLessThanOrEqual(0.5);
      guard.assertNoErrors();
    });

    test('F20.5 — Export Devis PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'devis');
      const { filename, buffer } = await triggerExport(page, 'export-devis-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F21: Plan 2D & Élévations Cotés PDF & SVG (5 tests)
  // =========================================================================
  test.describe('F21 — Plan 2D & Élévations Cotés (PDF & SVG)', () => {
    test('F21.1 — Export Plan 2D SVG vectoriel avec cotations', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const { filename, buffer } = await triggerExport(page, 'export-plan-svg');
      validateSvgDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F21.2 — Export Plan 2D PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const { filename, buffer } = await triggerExport(page, 'export-plan-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F21.3 — Export Élévations SVG vectoriel avec cotations', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const { filename, buffer } = await triggerExport(page, 'export-elevation-svg');
      validateSvgDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F21.4 — Export Élévations PDF valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      const { filename, buffer } = await triggerExport(page, 'export-elevation-pdf');
      validatePdfDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F21.5 — Export depuis le modal Centre d’exports fonctionne', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      await page.getByTestId('btn-export-menu').click();
      const { filename, buffer } = await triggerExport(page, 'export-plan-svg');
      validateSvgDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F22: Rendu 3D PNG Haute Résolution (5 tests)
  // =========================================================================
  test.describe('F22 — Rendu 3D PNG Haute Résolution', () => {
    test('F22.1 — Export PNG 3D haute résolution valide (>= 800×450)', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const { filename, buffer } = await triggerExport(page, 'export-render-png');
      validatePngDownload(buffer, filename, 800, 450);
      guard.assertNoErrors();
    });

    test('F22.2 — Viewport 3D reste interactif et sans gizmo résiduel après capture PNG', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await triggerExport(page, 'export-render-png');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F22.3 — Capture PNG sous éclairage Nuit + LEDs valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-lighting-toggle').click();
      await page.getByTestId('btn-led-toggle').click();
      const { filename, buffer } = await triggerExport(page, 'export-render-png');
      validatePngDownload(buffer, filename, 800, 450);
      guard.assertNoErrors();
    });

    test('F22.4 — Capture PNG avec portes ouvertes ("Ouvrir tout") valide', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await page.getByTestId('btn-toggle-open-all').click();
      await page.waitForTimeout(500);
      const { filename, buffer } = await triggerExport(page, 'export-render-png');
      validatePngDownload(buffer, filename, 800, 450);
      guard.assertNoErrors();
    });

    test('F22.5 — Captures PNG consécutives sans perte de contexte WebGL', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const first = await triggerExport(page, 'export-render-png');
      validatePngDownload(first.buffer, first.filename, 800, 450);
      const second = await triggerExport(page, 'export-render-png');
      validatePngDownload(second.buffer, second.filename, 800, 450);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F23: Export 3D GLB / GLTF (5 tests)
  // =========================================================================
  test.describe('F23 — Export 3D GLB / GLTF', () => {
    test('F23.1 — Export .glb valide sur Cuisine en L', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      const { filename, buffer } = await triggerExport(page, 'export-scene-glb');
      const info = validateGlbDownload(buffer, filename);
      expect(info.meshCount).toBeGreaterThan(0);
      guard.assertNoErrors();
    });

    test('F23.2 — En-tête binaire glTF v2 et longueur exacte du tampon', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const { filename, buffer } = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(buffer, filename);
      guard.assertNoErrors();
    });

    test('F23.3 — Export .glb sur Dressing sur-mesure contient les maillages du dressing', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Dressing sur-mesure');
      const { filename, buffer } = await triggerExport(page, 'export-scene-glb');
      const info = validateGlbDownload(buffer, filename);
      expect(info.meshCount).toBeGreaterThan(2);
      guard.assertNoErrors();
    });

    test('F23.4 — Taille du .glb augmente avec le nombre de modules', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await createBlankProject(page);
      await addModuleByFrenchLabel(page, /Caisson bas/i);
      const small = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(small.buffer, small.filename);

      await loadTemplate(page, 'Cuisine en L');
      const large = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(large.buffer, large.filename);
      expect(large.buffer.length).toBeGreaterThan(small.buffer.length);
      guard.assertNoErrors();
    });

    test('F23.5 — Export .glb déclenché depuis la vue Plan 2D fonctionne aussi', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      const { filename, buffer } = await triggerExport(page, 'export-scene-glb');
      validateGlbDownload(buffer, filename);
      guard.assertNoErrors();
    });
  });

  // =========================================================================
  // F24: Stabilité Runtime & Zéro Erreur Console (4 tests)
  // =========================================================================
  test.describe('F24 — Stabilité Runtime & Zéro Erreur', () => {
    test('F24.1 — Cycle complet des 4 onglets atelier sans erreur runtime', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchWorkspaceTab(page, 'cutlist');
      await switchWorkspaceTab(page, 'nesting');
      await switchWorkspaceTab(page, 'devis');
      await switchWorkspaceTab(page, 'conception');
      guard.assertNoErrors();
    });

    test('F24.2 — Bascules rapides Plan / Élévation / 3D / Split sans perte de contexte WebGL', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, 'plan');
      await switchViewMode(page, 'elevation');
      await switchViewMode(page, '3d');
      await switchViewMode(page, 'split');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F24.3 — Bascule répétée entre modèles sans fuite d’erreurs', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      await loadTemplate(page, 'Dressing sur-mesure');
      await loadTemplate(page, 'Cuisine en L');
      await switchViewMode(page, '3d');
      await assertCanvasNonBlank(page);
      guard.assertNoErrors();
    });

    test('F24.4 — Authenticité française maintenue sur tous les onglets', async ({ page }) => {
      const guard = attachErrorGuard(page);
      await openStudio(page);
      await loadTemplate(page, 'Cuisine en L');
      for (const tab of ['conception', 'cutlist', 'nesting', 'devis'] as const) {
        await switchWorkspaceTab(page, tab);
        await assertFrenchAuthenticity(page);
      }
      guard.assertNoErrors();
    });
  });
});
