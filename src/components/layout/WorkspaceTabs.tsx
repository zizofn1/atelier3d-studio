import { Calculator, FileSpreadsheet, Layers, PenTool } from 'lucide-react';
import { FR } from '@/i18n/fr';
import { useUIStore, type WorkspaceTab } from '@/store/useUIStore';

const TABS: Array<{ id: WorkspaceTab; label: string; testId: string; icon: typeof PenTool }> = [
  { id: 'conception', label: FR.tabs.conception, testId: 'tab-conception', icon: PenTool },
  { id: 'cutlist', label: FR.tabs.cutlist, testId: 'tab-cutlist', icon: FileSpreadsheet },
  { id: 'nesting', label: FR.tabs.nesting, testId: 'tab-nesting', icon: Layers },
  { id: 'devis', label: FR.tabs.devis, testId: 'tab-devis', icon: Calculator },
];

export function WorkspaceTabs() {
  const activeWorkspaceTab = useUIStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = useUIStore((s) => s.setActiveWorkspaceTab);

  return (
    <nav
      aria-label="Espaces de travail"
      className="order-2 flex items-center gap-1 overflow-x-auto border-b border-atelier-border bg-atelier-panel px-3 py-1.5"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = activeWorkspaceTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            data-testid={tab.testId}
            onClick={() => setActiveWorkspaceTab(tab.id)}
            className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
              active
                ? 'bg-atelier-accent text-atelier-accent-fg shadow-sm'
                : 'text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
