import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Keyboard, Search, X } from 'lucide-react';
import { FR } from '@/i18n/fr';
import { saveProject } from '@/persistence/indexedDb';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';

interface PaletteAction {
  id: string;
  labelFr: string;
  categoryFr: string;
  shortcut?: string;
  run: () => void | Promise<unknown>;
}

const SHORTCUTS_LIST: Array<{ keys: string; descFr: string }> = [
  { keys: 'Ctrl / ⌘ + K', descFr: 'Ouvrir la palette de commandes' },
  { keys: '?', descFr: 'Afficher les raccourcis clavier' },
  { keys: 'V', descFr: 'Outil Sélection' },
  { keys: 'W', descFr: 'Tracer un mur (Plan 2D)' },
  { keys: 'R', descFr: 'Pivoter la sélection de 90°' },
  { keys: 'Suppr', descFr: 'Supprimer la sélection' },
  { keys: '1 / 2 / 3 / 4', descFr: 'Basculer Plan / Élévation / 3D / Split' },
  { keys: 'Espace', descFr: 'Ouvrir / fermer toutes les façades' },
  { keys: 'C', descFr: 'Basculer Mode Conception ↔ Vue Client' },
  { keys: 'Tab', descFr: 'Replier / déplier les panneaux latéraux' },
  { keys: 'Ctrl / ⌘ + S', descFr: 'Enregistrer le projet localement' },
  { keys: 'Ctrl / ⌘ + Z / Y', descFr: 'Annuler / Rétablir' },
];

export function CommandPalette() {
  const isCommandPaletteOpen = useUIStore((s) => s.isCommandPaletteOpen);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const isShortcutsHelpOpen = useUIStore((s) => s.isShortcutsHelpOpen);
  const setShortcutsHelpOpen = useUIStore((s) => s.setShortcutsHelpOpen);

  const setActiveWorkspaceTab = useUIStore((s) => s.setActiveWorkspaceTab);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const togglePresentationMode = useUIStore((s) => s.togglePresentationMode);
  const toggleLightingPreset = useUIStore((s) => s.toggleLightingPreset);
  const toggleOpenAll = useUIStore((s) => s.toggleOpenAll);
  const toggleLed = useUIStore((s) => s.toggleLed);
  const cycleThemePreference = useUIStore((s) => s.cycleThemePreference);
  const setProjectLibraryOpen = useUIStore((s) => s.setProjectLibraryOpen);
  const toggleDisplayUnit = useUIStore((s) => s.toggleDisplayUnit);

  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery('');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCommandPaletteOpen]);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'view-plan',
        categoryFr: 'Vues',
        labelFr: `Afficher : ${FR.viewModes.plan2d}`,
        shortcut: '1',
        run: () => {
          setActiveWorkspaceTab('conception');
          setViewMode('plan2d');
        },
      },
      {
        id: 'view-elev',
        categoryFr: 'Vues',
        labelFr: `Afficher : ${FR.viewModes.elevation2d}`,
        shortcut: '2',
        run: () => {
          setActiveWorkspaceTab('conception');
          setViewMode('elevation2d');
        },
      },
      {
        id: 'view-3d',
        categoryFr: 'Vues',
        labelFr: `Afficher : ${FR.viewModes.view3d}`,
        shortcut: '3',
        run: () => {
          setActiveWorkspaceTab('conception');
          setViewMode('view3d');
        },
      },
      {
        id: 'view-split',
        categoryFr: 'Vues',
        labelFr: `Afficher : ${FR.viewModes.split}`,
        shortcut: '4',
        run: () => {
          setActiveWorkspaceTab('conception');
          setViewMode('split');
        },
      },
      {
        id: 'client-mode',
        categoryFr: 'Présentation',
        labelFr: 'Basculer Vue Client / Conception',
        shortcut: 'C',
        run: () => togglePresentationMode(),
      },
      {
        id: 'tab-cutlist',
        categoryFr: 'Atelier',
        labelFr: 'Ouvrir : Fiche de débit',
        run: () => setActiveWorkspaceTab('cutlist'),
      },
      {
        id: 'tab-nesting',
        categoryFr: 'Atelier',
        labelFr: 'Ouvrir : Calepinage 2D',
        run: () => setActiveWorkspaceTab('nesting'),
      },
      {
        id: 'tab-devis',
        categoryFr: 'Atelier',
        labelFr: 'Ouvrir : Devis estimatif',
        run: () => setActiveWorkspaceTab('devis'),
      },
      {
        id: 'tool-select',
        categoryFr: 'Outils',
        labelFr: 'Outil Sélection',
        shortcut: 'V',
        run: () => {
          setActiveWorkspaceTab('conception');
          setActiveTool('select');
        },
      },
      {
        id: 'tool-wall',
        categoryFr: 'Outils',
        labelFr: 'Tracer un mur',
        shortcut: 'W',
        run: () => {
          setActiveWorkspaceTab('conception');
          setViewMode('plan2d');
          setActiveTool('draw_wall');
        },
      },
      {
        id: 'toggle-doors',
        categoryFr: 'Scène 3D',
        labelFr: 'Ouvrir / Fermer toutes les portes',
        shortcut: 'Espace',
        run: () => toggleOpenAll(),
      },
      {
        id: 'toggle-lighting',
        categoryFr: 'Scène 3D',
        labelFr: 'Basculer éclairage Jour / Nuit',
        run: () => toggleLightingPreset(),
      },
      {
        id: 'toggle-led',
        categoryFr: 'Scène 3D',
        labelFr: 'Activer / Couper LED sous-meubles',
        run: () => toggleLed(),
      },
      {
        id: 'cycle-theme',
        categoryFr: 'Interface',
        labelFr: 'Changer de thème (Sombre / Clair / Auto)',
        run: () => cycleThemePreference(),
      },
      {
        id: 'toggle-unit',
        categoryFr: 'Interface',
        labelFr: 'Basculer unité mm / cm',
        run: () => toggleDisplayUnit(),
      },
      {
        id: 'save-project',
        categoryFr: 'Projet',
        labelFr: 'Enregistrer le projet maintenant',
        shortcut: 'Ctrl+S',
        run: () => saveProject(useProjectStore.getState().document),
      },
      {
        id: 'open-library',
        categoryFr: 'Projet',
        labelFr: 'Ouvrir la bibliothèque de projets',
        run: () => setProjectLibraryOpen(true),
      },
      {
        id: 'export-devis-share',
        categoryFr: 'Export & Partage',
        labelFr: 'Partager ou télécharger le Devis (PDF)',
        run: () => import('@/exports/atelierExports').then((m) => m.exportDevisPdf({ share: true })),
      },
      {
        id: 'export-render-share',
        categoryFr: 'Export & Partage',
        labelFr: 'Partager ou télécharger le Rendu 3D HD (PNG)',
        run: () => import('@/exports/render3dExport').then((m) => m.exportRenderPng({ share: true })),
      },
      {
        id: 'show-shortcuts',
        categoryFr: 'Aide',
        labelFr: 'Afficher les raccourcis clavier',
        shortcut: '?',
        run: () => setShortcutsHelpOpen(true),
      },
    ],
    [
      cycleThemePreference,
      setActiveTool,
      setActiveWorkspaceTab,
      setProjectLibraryOpen,
      setShortcutsHelpOpen,
      setViewMode,
      toggleDisplayUnit,
      toggleLed,
      toggleLightingPreset,
      toggleOpenAll,
      togglePresentationMode,
    ]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.labelFr.toLowerCase().includes(q) || a.categoryFr.toLowerCase().includes(q)
    );
  }, [actions, query]);

  return (
    <>
      {isCommandPaletteOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Palette de commandes"
          data-testid="command-palette-modal"
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-20 backdrop-blur-sm"
          onClick={() => setCommandPaletteOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-atelier-border px-3.5 py-2.5">
              <Search className="h-4 w-4 text-atelier-accent-text" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setCommandPaletteOpen(false);
                  } else if (e.key === 'Enter' && filtered[0]) {
                    void filtered[0].run();
                    setCommandPaletteOpen(false);
                  }
                }}
                placeholder="Rechercher une action, une vue, un export…"
                className="w-full bg-transparent text-sm text-atelier-fg placeholder:text-atelier-subtle focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                className="rounded p-1 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-xs text-atelier-subtle">
                  Aucune commande trouvée.
                </div>
              ) : (
                filtered.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      void action.run();
                      setCommandPaletteOpen(false);
                    }}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs text-atelier-fg hover:bg-atelier-surface"
                  >
                    <div className="flex items-center gap-2.5">
                      <Command className="h-3.5 w-3.5 text-atelier-accent-text" />
                      <span>{action.labelFr}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-atelier-subtle">{action.categoryFr}</span>
                      {action.shortcut && (
                        <kbd className="rounded border border-atelier-border bg-atelier-surface-2 px-1.5 py-0.5 font-mono text-xs text-atelier-muted">
                          {action.shortcut}
                        </kbd>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {isShortcutsHelpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Raccourcis clavier"
          data-testid="shortcuts-help-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setShortcutsHelpOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-atelier-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Keyboard className="h-4 w-4 text-atelier-accent-text" />
                <h2 className="text-sm font-semibold text-atelier-fg">Raccourcis clavier</h2>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsHelpOpen(false)}
                className="rounded p-1 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="divide-y divide-atelier-border/60 p-4">
              {SHORTCUTS_LIST.map((s) => (
                <div key={s.keys} className="flex items-center justify-between py-2 text-xs">
                  <span className="text-atelier-muted">{s.descFr}</span>
                  <kbd className="rounded border border-atelier-border bg-atelier-surface px-2 py-0.5 font-mono text-xs text-atelier-fg">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
