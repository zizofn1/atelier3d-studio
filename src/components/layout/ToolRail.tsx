import {
  Columns,
  DoorOpen,
  Droplets,
  MousePointer,
  PenLine,
  PlugZap,
  Square,
  Zap,
} from 'lucide-react';
import { FR } from '@/i18n/fr';
import { useUIStore, type ActiveTool } from '@/store/useUIStore';

const RAIL_ITEMS: Array<{
  tool: ActiveTool;
  labelFr: string;
  shortcut?: string;
  icon: typeof MousePointer;
  testId: string;
}> = [
  {
    tool: 'select',
    labelFr: FR.leftPanel.selectTool,
    shortcut: 'V',
    icon: MousePointer,
    testId: 'tool-select',
  },
  {
    tool: 'draw_wall',
    labelFr: FR.leftPanel.drawWallTool,
    shortcut: 'W',
    icon: PenLine,
    testId: 'tool-draw-wall',
  },
  { tool: 'add_porte', labelFr: FR.openings.porte, icon: DoorOpen, testId: 'tool-add-porte' },
  { tool: 'add_fenetre', labelFr: FR.openings.fenetre, icon: Square, testId: 'tool-add-fenetre' },
  { tool: 'add_poteau', labelFr: FR.utilities.poteau, icon: Columns, testId: 'tool-add-poteau' },
  { tool: 'add_prise', labelFr: FR.utilities.prise, icon: PlugZap, testId: 'tool-add-prise' },
  {
    tool: 'add_arrivee_eau',
    labelFr: FR.utilities.arrivee_eau,
    icon: Droplets,
    testId: 'tool-add-arrivee_eau',
  },
];

export function ToolRail() {
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const autoUtilitiesEnabled = useUIStore((s) => s.autoUtilitiesEnabled);
  const toggleAutoUtilitiesEnabled = useUIStore((s) => s.toggleAutoUtilitiesEnabled);

  return (
    <aside
      aria-label="Outils de dessin"
      data-testid="desktop-tool-rail"
      className="flex w-12 shrink-0 flex-col items-center justify-between border-r border-atelier-border bg-atelier-panel py-2"
    >
      <div className="flex flex-col items-center gap-1.5">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTool === item.tool;
          const tooltip = item.shortcut ? `${item.labelFr} (${item.shortcut})` : item.labelFr;
          return (
            <button
              key={item.tool}
              type="button"
              data-testid={item.testId}
              title={tooltip}
              aria-label={tooltip}
              aria-pressed={active}
              onClick={() => setActiveTool(item.tool)}
              className={`atelier-touch flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                active
                  ? 'border-atelier-accent bg-atelier-accent text-atelier-accent-fg shadow-sm'
                  : 'border-transparent text-atelier-muted hover:border-atelier-border hover:bg-atelier-surface hover:text-atelier-fg'
              }`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}

        <div className="my-1 h-px w-7 bg-atelier-border" />

        <button
          type="button"
          data-testid="tool-add-poutre"
          title={FR.utilities.poutre}
          aria-label={FR.utilities.poutre}
          aria-pressed={activeTool === 'add_poutre'}
          onClick={() => setActiveTool('add_poutre')}
          className={`atelier-touch flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-bold transition-colors ${
            activeTool === 'add_poutre'
              ? 'border-atelier-accent bg-atelier-accent text-atelier-accent-fg shadow-sm'
              : 'border-transparent text-atelier-muted hover:border-atelier-border hover:bg-atelier-surface hover:text-atelier-fg'
          }`}
        >
          P
        </button>
      </div>

      <button
        type="button"
        data-testid="toggle-auto-utilities"
        onClick={toggleAutoUtilitiesEnabled}
        aria-pressed={autoUtilitiesEnabled}
        title={`Raccordements automatiques Eau / Élec : ${autoUtilitiesEnabled ? 'Actifs' : 'Inactifs'}`}
        className={`atelier-touch flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
          autoUtilitiesEnabled
            ? 'border-emerald-500/60 bg-emerald-500/15 text-atelier-success'
            : 'border-atelier-border bg-atelier-surface text-atelier-subtle hover:text-atelier-fg'
        }`}
      >
        <Zap className="h-4 w-4" />
      </button>
    </aside>
  );
}
