import { AlertTriangle, Command, Keyboard, Moon, Sun } from 'lucide-react';
import { FR } from '@/i18n/fr';
import { selectProjectCollisions } from '@/store/selectors';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';

export function StatusBar() {
  const doc = useProjectStore((s) => s.document);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const resolvedTheme = useUIStore((s) => s.resolvedTheme);
  const cycleThemePreference = useUIStore((s) => s.cycleThemePreference);
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const setShortcutsHelpOpen = useUIStore((s) => s.setShortcutsHelpOpen);

  const collisions = selectProjectCollisions(doc);

  return (
    <footer
      data-testid="desktop-status-bar"
      className="order-4 flex h-7 shrink-0 items-center justify-between border-t border-atelier-border bg-atelier-panel px-3 text-xs text-atelier-muted"
    >
      <div className="flex items-center gap-3 tabular-nums">
        <span>
          {doc.walls.length} {FR.viewport.wallsLabel.toLowerCase()} · {doc.modules.length}{' '}
          {FR.viewport.modulesLabel.toLowerCase()}
        </span>
        {collisions.length > 0 ? (
          <span className="inline-flex items-center gap-1 font-medium text-atelier-danger">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>
              {collisions.length} collision{collisions.length > 1 ? 's' : ''}
            </span>
          </span>
        ) : (
          <span className="text-atelier-success">Aucune collision</span>
        )}
        <span className="hidden md:inline text-atelier-subtle">
          · Unité : {displayUnit} · Plafond : {doc.ceilingHeightMm} mm
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={cycleThemePreference}
          title="Basculer thème Sombre / Clair / Auto"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
        >
          {resolvedTheme === 'clair' ? (
            <Sun className="h-3.5 w-3.5 text-atelier-accent-text" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-atelier-accent-text" />
          )}
          <span className="hidden sm:inline">
            {resolvedTheme === 'clair' ? 'Clair' : 'Sombre'}
          </span>
        </button>

        <button
          type="button"
          data-testid="btn-command-palette"
          onClick={() => setCommandPaletteOpen(true)}
          title="Palette de commandes (Ctrl+K)"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
        >
          <Command className="h-3.5 w-3.5" />
          <span>Ctrl+K</span>
        </button>

        <button
          type="button"
          data-testid="btn-shortcuts-help"
          onClick={() => setShortcutsHelpOpen(true)}
          title="Aide & Raccourcis clavier (?)"
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
        >
          <Keyboard className="h-3.5 w-3.5" />
          <span>?</span>
        </button>
      </div>
    </footer>
  );
}
