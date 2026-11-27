import { Suspense, lazy, useEffect } from 'react';
import { Loader2, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import { FloorplanCanvas } from '@/components/editor2d/FloorplanCanvas';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { LeftCatalogPanel } from '@/components/layout/LeftCatalogPanel';
import { RightInspectorPanel } from '@/components/layout/RightInspectorPanel';
import { StatusBar } from '@/components/layout/StatusBar';
import { ToolRail } from '@/components/layout/ToolRail';
import { TopToolbar } from '@/components/layout/TopToolbar';
import { WorkspaceTabs } from '@/components/layout/WorkspaceTabs';
import { loadInitialProject, saveProject } from '@/persistence/indexedDb';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { useFormFactor } from '@/utils/useFormFactor';

// Code-split heavy 3D engine, secondary 2D elevation, Atelier tabs & Project Library modal on demand (P5)
const Scene3D = lazy(() =>
  import('@/components/viewport3d/Scene3D').then((m) => ({ default: m.Scene3D }))
);
const ElevationView = lazy(() =>
  import('@/components/editor2d/ElevationView').then((m) => ({ default: m.ElevationView }))
);
const CutlistView = lazy(() =>
  import('@/components/atelier/CutlistView').then((m) => ({ default: m.CutlistView }))
);
const NestingView = lazy(() =>
  import('@/components/atelier/NestingView').then((m) => ({ default: m.NestingView }))
);
const DevisView = lazy(() =>
  import('@/components/atelier/DevisView').then((m) => ({ default: m.DevisView }))
);
const ProjectLibraryModal = lazy(() =>
  import('@/components/modals/ProjectLibraryModal').then((m) => ({
    default: m.ProjectLibraryModal,
  }))
);

function AtelierChunkLoader({ labelFr }: { labelFr: string }) {
  return (
    <div
      role="status"
      className="flex h-full w-full flex-1 flex-col items-center justify-center gap-2 bg-atelier-bg text-xs text-atelier-muted"
    >
      <Loader2 className="h-5 w-5 animate-spin text-atelier-accent-text" />
      <span className="font-medium text-atelier-fg">{labelFr}</span>
    </div>
  );
}

export function App() {
  // Primitive selectors prevent root <App /> from re-rendering at 60 Hz on every 2D/3D drag tick
  const currency = useProjectStore((s) => s.document.pricing.currency);
  const moduleCount = useProjectStore((s) => s.document.modules.length);
  const wallCount = useProjectStore((s) => s.document.walls.length);
  const replaceDocument = useProjectStore((s) => s.replaceDocument);

  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const activeWorkspaceTab = useUIStore((s) => s.activeWorkspaceTab);
  const setActiveWorkspaceTab = useUIStore((s) => s.setActiveWorkspaceTab);
  const presentationMode = useUIStore((s) => s.presentationMode);
  const togglePresentationMode = useUIStore((s) => s.togglePresentationMode);
  const videoStudioMode = useUIStore((s) => s.videoStudioMode);
  const displayUnit = useUIStore((s) => s.displayUnit);
  const lightingPreset = useUIStore((s) => s.lightingPreset);
  const ledEnabled = useUIStore((s) => s.ledEnabled);
  const openAll = useUIStore((s) => s.openAll);
  const toggleOpenAll = useUIStore((s) => s.toggleOpenAll);
  const sceneReady = useUIStore((s) => s.sceneReady);
  const setActiveWallId = useUIStore((s) => s.setActiveWallId);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const setLeftPanelOpen = useUIStore((s) => s.setLeftPanelOpen);
  const setRightPanelOpen = useUIStore((s) => s.setRightPanelOpen);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const isProjectLibraryOpen = useUIStore((s) => s.isProjectLibraryOpen);
  const resolvedTheme = useUIStore((s) => s.resolvedTheme);
  const syncSystemTheme = useUIStore((s) => s.syncSystemTheme);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const setShortcutsHelpOpen = useUIStore((s) => s.setShortcutsHelpOpen);

  const { formFactor, density } = useFormFactor();
  const isDesktop = formFactor === 'desktop';

  // Sync system prefers-color-scheme when themePreference === 'auto'
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => syncSystemTheme();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [syncSystemTheme]);

  // Responsive panel behavior across Desktop <-> Tablet/Phone transitions
  useEffect(() => {
    if (formFactor === 'desktop') {
      setLeftPanelOpen(true);
      setRightPanelOpen(true);
    } else {
      setLeftPanelOpen(false);
      setRightPanelOpen(false);
    }
  }, [formFactor, setLeftPanelOpen, setRightPanelOpen]);

  // Boot from IndexedDB (auto-seeding Cuisine en L & Dressing sur-mesure)
  useEffect(() => {
    let active = true;
    void loadInitialProject().then((doc) => {
      if (!active) return;
      replaceDocument(doc, { clearHistory: true });
      setActiveWallId(doc.walls[0]?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [replaceDocument, setActiveWallId]);

  // Debounced IndexedDB auto-save (1500 ms) + immediate flush on Safari/iPad backgrounding or pagehide
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSavedUpdatedAt = useProjectStore.getState().document.updatedAt;
    let dirty = false;

    const persistNow = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (!dirty) return;
      const doc = useProjectStore.getState().document;
      if (doc.updatedAt === lastSavedUpdatedAt) {
        dirty = false;
        return;
      }
      lastSavedUpdatedAt = doc.updatedAt;
      dirty = false;
      void saveProject(doc);
    };

    const scheduleSave = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (useUIStore.getState().isDragging3D) {
          scheduleSave();
          return;
        }
        persistNow();
      }, 1500);
    };

    const unsub = useProjectStore.subscribe((state, prevState) => {
      if (state.document !== prevState.document) {
        dirty = true;
        scheduleSave();
      }
    });

    const onVisibilityChange = () => {
      if (window.document.visibilityState === 'hidden') {
        persistNow();
      }
    };
    const onPageHide = () => {
      persistNow();
    };

    window.document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      unsub();
      window.document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  // Global Desktop Keyboard Shortcuts (Undo/Redo, Save, Ctrl+K, ?, Views, Tools, Doors, Client Mode)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === 'k') {
        e.preventDefault();
        toggleCommandPalette();
        return;
      }

      if (mod && key === 's') {
        e.preventDefault();
        void saveProject(useProjectStore.getState().document);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          useProjectStore.temporal.getState().undo();
        } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
          e.preventDefault();
          useProjectStore.temporal.getState().redo();
        }
        return;
      }

      if (e.key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault();
        setShortcutsHelpOpen(true);
      } else if (key === 'v') {
        setActiveTool('select');
      } else if (key === 'w') {
        setActiveWorkspaceTab('conception');
        setViewMode('plan2d');
        setActiveTool('draw_wall');
      } else if (key === '1') {
        setActiveWorkspaceTab('conception');
        setViewMode('plan2d');
      } else if (key === '2') {
        setActiveWorkspaceTab('conception');
        setViewMode('elevation2d');
      } else if (key === '3') {
        setActiveWorkspaceTab('conception');
        setViewMode('view3d');
      } else if (key === '4') {
        setActiveWorkspaceTab('conception');
        setViewMode('split');
      } else if (key === 'c') {
        togglePresentationMode();
      } else if (e.code === 'Space' && useUIStore.getState().activeWorkspaceTab === 'conception') {
        e.preventDefault();
        toggleOpenAll();
      } else if (e.key === 'Tab' && useUIStore.getState().presentationMode !== 'client') {
        e.preventDefault();
        const ui = useUIStore.getState();
        const nextOpen = !(ui.leftPanelOpen || ui.rightPanelOpen);
        setLeftPanelOpen(nextOpen);
        setRightPanelOpen(nextOpen);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    setActiveTool,
    setActiveWorkspaceTab,
    setLeftPanelOpen,
    setRightPanelOpen,
    setShortcutsHelpOpen,
    setViewMode,
    toggleCommandPalette,
    toggleOpenAll,
    togglePresentationMode,
  ]);

  const isClientMode = presentationMode === 'client';
  const isFullscreen3D = isClientMode || videoStudioMode;

  return (
    <div
      id="atelier-root"
      data-form-factor={formFactor}
      data-density={density}
      data-theme={resolvedTheme}
      data-view-mode={viewMode}
      data-workspace-tab={activeWorkspaceTab}
      data-presentation-mode={presentationMode}
      data-video-studio={String(videoStudioMode)}
      data-unit-mode={displayUnit}
      data-currency={currency}
      data-module-count={String(moduleCount)}
      data-wall-count={String(wallCount)}
      data-open-all={String(openAll)}
      data-lighting={lightingPreset}
      data-led={String(ledEnabled)}
      data-scene-ready={String(sceneReady)}
      className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-atelier-bg text-atelier-fg"
    >
      {isProjectLibraryOpen && (
        <Suspense fallback={null}>
          <ProjectLibraryModal />
        </Suspense>
      )}
      <CommandPalette />

      {!isFullscreen3D && <TopToolbar hideWorkspaceTabs={!isDesktop} />}
      {!isFullscreen3D && !isDesktop && <WorkspaceTabs />}

      <main className="order-3 flex flex-1 overflow-hidden">
        {isFullscreen3D ? (
          <section className="flex flex-1 overflow-hidden">
            <Suspense fallback={<AtelierChunkLoader labelFr="Chargement de la scène 3D…" />}>
              <Scene3D />
            </Suspense>
          </section>
        ) : (
          <>
            {activeWorkspaceTab === 'conception' && (
              <div className="relative flex flex-1 overflow-hidden">
                <ToolRail />

                {/* Collapsible Left Catalog Panel (static sidebar on lg+, slide-over drawer on <1024px) */}
                {leftPanelOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-30 bg-black/55 lg:hidden"
                      onClick={toggleLeftPanel}
                    />
                    <div className="fixed inset-y-0 left-0 z-40 h-full lg:static lg:z-auto">
                      <LeftCatalogPanel />
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="btn-expand-left-panel"
                    onClick={toggleLeftPanel}
                    title="Ouvrir la Bibliothèque"
                    className="atelier-glass absolute left-14 top-2.5 z-20 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-atelier-accent-text shadow-lg hover:border-atelier-accent"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">Catalogue</span>
                  </button>
                )}

                <section className="flex flex-1 overflow-hidden">
                  {viewMode === 'plan2d' && <FloorplanCanvas />}
                  {viewMode === 'elevation2d' && (
                    <Suspense
                      fallback={<AtelierChunkLoader labelFr="Chargement de l’élévation 2D…" />}
                    >
                      <ElevationView />
                    </Suspense>
                  )}
                  {viewMode === 'view3d' && (
                    <Suspense fallback={<AtelierChunkLoader labelFr="Chargement de la scène 3D…" />}>
                      <Scene3D />
                    </Suspense>
                  )}
                  {viewMode === 'split' && (
                    <div className="grid h-full w-full grid-cols-1 divide-y divide-atelier-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                      <FloorplanCanvas />
                      <Suspense
                        fallback={<AtelierChunkLoader labelFr="Chargement de la scène 3D…" />}
                      >
                        <Scene3D />
                      </Suspense>
                    </div>
                  )}
                </section>

                {/* Collapsible Right Inspector Panel (static sidebar on lg+, slide-over drawer on <1024px) */}
                {rightPanelOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-30 bg-black/55 lg:hidden"
                      onClick={toggleRightPanel}
                    />
                    <div className="fixed inset-y-0 right-0 z-40 h-full lg:static lg:z-auto">
                      <RightInspectorPanel />
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="btn-expand-right-panel"
                    onClick={toggleRightPanel}
                    title="Ouvrir l'Inspecteur"
                    className="atelier-glass absolute right-3 top-2.5 z-20 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium text-atelier-accent-text shadow-lg hover:border-atelier-accent"
                  >
                    <PanelRightOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">Inspecteur</span>
                  </button>
                )}
              </div>
            )}

            {activeWorkspaceTab === 'cutlist' && (
              <Suspense
                fallback={<AtelierChunkLoader labelFr="Chargement de la fiche de débit…" />}
              >
                <CutlistView />
              </Suspense>
            )}
            {activeWorkspaceTab === 'nesting' && (
              <Suspense
                fallback={<AtelierChunkLoader labelFr="Chargement du calepinage 2D…" />}
              >
                <NestingView />
              </Suspense>
            )}
            {activeWorkspaceTab === 'devis' && (
              <Suspense fallback={<AtelierChunkLoader labelFr="Chargement du devis…" />}>
                <DevisView />
              </Suspense>
            )}
          </>
        )}
      </main>

      {!isClientMode && isDesktop && <StatusBar />}
    </div>
  );
}

export default App;
