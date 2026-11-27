import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Copy, Download, FilePlus2, FolderOpen, Pencil, Save, Trash2, Upload, Wand2, X } from 'lucide-react';
import type { ProjectDocument, SavedProjectRecord } from '@/types';
import {
  DEFAULT_CARPENTRY_PARAMS,
  DEFAULT_NESTING_CONFIG,
  createDefaultPricing,
} from '@/data/defaultPricing';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { FR } from '@/i18n/fr';
import {
  deleteProject,
  duplicateProject,
  listProjects,
  renameProject,
  saveProject,
} from '@/persistence/indexedDb';
import { parseAndValidateProjectJson, serializeProjectToJson } from '@/persistence/jsonSerializer';
import { cloneAndRepairProjectDocument } from '@/persistence/projectRepair';
import { useProjectStore } from '@/store/useProjectStore';
import { useUIStore } from '@/store/useUIStore';
import { APP_VERSION_BADGE } from '@/utils/appVersion';
import { downloadTextFile } from '@/utils/download';
import { generateId } from '@/utils/id';

function createEmptyProject(): ProjectDocument {
  const now = new Date().toISOString();
  return {
    id: generateId('proj'),
    schemaVersion: 1,
    name: FR.library.newProjectDefaultName,
    createdAt: now,
    updatedAt: now,
    ceilingHeightMm: 2500,
    floorMaterialId: 'carrelage-gres',
    defaultCarpentry: { ...DEFAULT_CARPENTRY_PARAMS },
    walls: [
      {
        id: generateId('mur'),
        labelFr: 'Mur Nord',
        startMm: [0, 0],
        endMm: [4000, 0],
        thicknessMm: 150,
        heightMm: 2500,
        materialId: 'peinture-blanc-casse',
      },
      {
        id: generateId('mur'),
        labelFr: 'Mur Est',
        startMm: [4000, 0],
        endMm: [4000, 3000],
        thicknessMm: 150,
        heightMm: 2500,
        materialId: 'peinture-blanc-casse',
      },
      {
        id: generateId('mur'),
        labelFr: 'Mur Sud',
        startMm: [4000, 3000],
        endMm: [0, 3000],
        thicknessMm: 150,
        heightMm: 2500,
        materialId: 'peinture-grege',
      },
      {
        id: generateId('mur'),
        labelFr: 'Mur Ouest',
        startMm: [0, 3000],
        endMm: [0, 0],
        thicknessMm: 150,
        heightMm: 2500,
        materialId: 'peinture-grege',
      },
    ],
    openings: [],
    utilities: [],
    modules: [],
    pricing: createDefaultPricing('MAD'),
    nestingConfig: { ...DEFAULT_NESTING_CONFIG },
  };
}

export function ProjectLibraryModal() {
  const currentDoc = useProjectStore((s) => s.document);
  const replaceDocument = useProjectStore((s) => s.replaceDocument);
  const setActiveWallId = useUIStore((s) => s.setActiveWallId);
  const clearSelection = useUIStore((s) => s.clearSelection);
  const setProjectLibraryOpen = useUIStore((s) => s.setProjectLibraryOpen);

  const [projects, setProjects] = useState<SavedProjectRecord[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusSuccess, setStatusSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refreshList = async () => {
    const items = await listProjects();
    setProjects(items);
  };

  useEffect(() => {
    void refreshList();
  }, []);

  const activateDocument = (doc: ProjectDocument) => {
    replaceDocument(doc, { clearHistory: true });
    setActiveWallId(doc.walls[0]?.id ?? null);
    clearSelection();
    setProjectLibraryOpen(false);
  };

  const handleSaveCurrent = async () => {
    await saveProject(currentDoc);
    await refreshList();
    setStatusError(null);
    setStatusSuccess(FR.toolbar.saved);
  };

  const handleCreateTemplate = async (kind: 'cuisine' | 'dressing' | 'empty') => {
    const base =
      kind === 'cuisine'
        ? createCuisineEnLTemplate()
        : kind === 'dressing'
          ? createDressingSurMesureTemplate()
          : createEmptyProject();
    const freshDoc: ProjectDocument = {
      ...base,
      id: generateId('proj'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProject(freshDoc);
    activateDocument(freshDoc);
  };

  const handleDuplicate = async (id: string) => {
    await duplicateProject(id);
    await refreshList();
  };

  const handleDuplicateAndRepair = async (proj: SavedProjectRecord) => {
    const repairedCopy = cloneAndRepairProjectDocument(proj.document);
    await saveProject(repairedCopy);
    await refreshList();
    setStatusError(null);
    setStatusSuccess(`Copie réalignée créée : ${repairedCopy.name}`);
    activateDocument(repairedCopy);
  };

  const handleDelete = async (id: string) => {
    await deleteProject(id);
    const remaining = await listProjects();
    setProjects(remaining);
    if (id === currentDoc.id) {
      if (remaining.length > 0) {
        replaceDocument(remaining[0].document, { clearHistory: true });
        setActiveWallId(remaining[0].document.walls[0]?.id ?? null);
      } else {
        const fresh = createEmptyProject();
        await saveProject(fresh);
        replaceDocument(fresh, { clearHistory: true });
        setActiveWallId(fresh.walls[0]?.id ?? null);
        await refreshList();
      }
      clearSelection();
    }
  };

  const handleCommitRename = async (id: string) => {
    const updated = await renameProject(id, renameDraft);
    if (updated && updated.id === currentDoc.id) {
      replaceDocument(updated.document, { clearHistory: false });
    }
    setRenamingId(null);
    await refreshList();
  };

  const handleExportJson = () => {
    const json = serializeProjectToJson(currentDoc);
    const safeSlug =
      currentDoc.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/(^-|-$)/g, '') || 'projet';
    downloadTextFile(json, `${safeSlug}.atelier3d.json`, 'application/json;charset=utf-8');
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const text = await file.text();
    const res = parseAndValidateProjectJson(text);
    if (!res.ok) {
      setStatusSuccess(null);
      setStatusError(res.errorFr);
      return;
    }

    await saveProject(res.document);
    setStatusError(null);
    setStatusSuccess(FR.library.importSuccess);
    activateDocument(res.document);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={FR.library.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-atelier-border bg-atelier-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-atelier-border px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-atelier-fg">{FR.library.title}</h2>
            <p className="text-xs text-atelier-muted">{FR.library.subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => setProjectLibraryOpen(false)}
            className="rounded-md p-1.5 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
            aria-label={FR.library.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-atelier-border bg-atelier-surface-2 px-5 py-2.5">
          <button
            type="button"
            onClick={() => void handleSaveCurrent()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-atelier-accent px-3 text-xs font-semibold text-atelier-accent-fg hover:bg-atelier-accent-hover"
          >
            <Save className="h-3.5 w-3.5" />
            <span>{FR.library.saveCurrent}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleCreateTemplate('empty')}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-3 text-xs font-medium text-atelier-fg hover:border-atelier-accent"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span>{FR.library.newEmptyProject}</span>
          </button>

          <button
            type="button"
            data-testid="export-project-json"
            onClick={handleExportJson}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-3 text-xs font-medium text-atelier-fg hover:border-atelier-accent"
          >
            <Download className="h-3.5 w-3.5 text-atelier-accent-text" />
            <span>{FR.library.exportJson}</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-atelier-border bg-atelier-surface px-3 text-xs font-medium text-atelier-fg hover:border-atelier-accent"
          >
            <Upload className="h-3.5 w-3.5 text-atelier-success" />
            <span>{FR.library.importJson}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handleImportFile(e)}
            className="hidden"
          />
        </div>

        {(statusError || statusSuccess) && (
          <div
            className={`px-5 py-2 text-xs ${
              statusError ? 'bg-red-500/15 text-atelier-danger' : 'bg-emerald-500/15 text-atelier-success'
            }`}
          >
            {statusError ?? statusSuccess}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Starter Templates */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
              {FR.library.templatesTitle}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleCreateTemplate('cuisine')}
                className="flex flex-col items-start rounded-lg border border-atelier-border bg-atelier-surface-2 p-3 text-left transition-colors hover:border-atelier-accent hover:bg-atelier-surface"
              >
                <div className="text-sm font-semibold text-atelier-accent-text">
                  {FR.library.templateCuisine}
                </div>
                <p className="mt-1 text-xs text-atelier-muted">{FR.library.templateCuisineDesc}</p>
              </button>

              <button
                type="button"
                onClick={() => void handleCreateTemplate('dressing')}
                className="flex flex-col items-start rounded-lg border border-atelier-border bg-atelier-surface-2 p-3 text-left transition-colors hover:border-atelier-accent hover:bg-atelier-surface"
              >
                <div className="text-sm font-semibold text-atelier-accent-text">
                  {FR.library.templateDressing}
                </div>
                <p className="mt-1 text-xs text-atelier-muted">{FR.library.templateDressingDesc}</p>
              </button>
            </div>
          </section>

          {/* Saved Projects */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-atelier-muted">
              {FR.library.savedProjectsTitle} ({projects.length})
            </h3>
            {projects.length === 0 ? (
              <p className="text-xs text-atelier-muted">{FR.library.noSavedProjects}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((proj) => {
                  const isActive = proj.id === currentDoc.id;
                  const isRenaming = renamingId === proj.id;
                  const isNajiya = /najiya/i.test(proj.name);
                  return (
                    <div
                      key={proj.id}
                      className={`flex flex-col overflow-hidden rounded-lg border bg-atelier-surface-2 ${
                        isActive
                          ? 'border-atelier-accent'
                          : isNajiya
                            ? 'border-amber-400/80 ring-1 ring-amber-400/40'
                            : 'border-atelier-border'
                      }`}
                    >
                      <div className="relative h-28 bg-atelier-viewport">
                        <img
                          src={proj.thumbnailDataUrl}
                          alt={proj.name}
                          className="h-full w-full object-cover"
                        />
                        {isNajiya && (
                          <span className="absolute left-2 top-2 rounded bg-atelier-accent px-2 py-0.5 text-xs font-bold text-atelier-accent-fg">
                            À copier & réaligner
                          </span>
                        )}
                        {isActive && (
                          <span className="absolute right-2 top-2 rounded bg-atelier-accent px-2 py-0.5 text-xs font-bold text-atelier-accent-fg">
                            {FR.library.activeBadge}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-1 flex-col justify-between p-3 space-y-2">
                        {isRenaming ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              value={renameDraft}
                              placeholder={FR.library.renamePromptPlaceholder}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              className="h-8 w-full rounded border border-atelier-border bg-atelier-panel px-2 text-xs text-atelier-fg"
                            />
                            <button
                              type="button"
                              onClick={() => void handleCommitRename(proj.id)}
                              className="h-8 rounded bg-atelier-accent px-2.5 text-xs font-semibold text-atelier-accent-fg"
                            >
                              {FR.library.confirmRename}
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="truncate text-sm font-semibold text-atelier-fg">
                              {proj.name}
                            </div>
                            <div className="text-xs text-atelier-muted tabular-nums">
                              {proj.wallCount} {FR.library.wallUnitCount} · {proj.moduleCount}{' '}
                              {FR.library.moduleUnitCount}
                            </div>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => activateDocument(proj.document)}
                              className="inline-flex h-8 items-center gap-1 rounded bg-atelier-surface px-2.5 text-xs font-medium text-atelier-accent-text hover:bg-atelier-accent hover:text-atelier-accent-fg"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                              <span>{FR.library.load}</span>
                            </button>
                            <button
                              type="button"
                              data-testid={`btn-repair-copy-${proj.id}`}
                              title="Créer une copie sans modifier l'original, réparer les jonctions murs et réaligner les caissons"
                              onClick={() => void handleDuplicateAndRepair(proj)}
                              className="inline-flex h-8 items-center gap-1 rounded border border-atelier-accent/50 bg-atelier-accent/15 px-2 text-xs font-semibold text-atelier-accent-text hover:bg-atelier-accent hover:text-atelier-accent-fg"
                            >
                              <Wand2 className="h-3.5 w-3.5" />
                              <span>Dupliquer & Réaligner</span>
                            </button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              title={FR.library.rename}
                              onClick={() => {
                                setRenamingId(proj.id);
                                setRenameDraft(proj.name);
                              }}
                              className="rounded p-1.5 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title={FR.library.duplicate}
                              onClick={() => void handleDuplicate(proj.id)}
                              className="rounded p-1.5 text-atelier-muted hover:bg-atelier-surface hover:text-atelier-fg"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title={FR.library.delete}
                              onClick={() => void handleDelete(proj.id)}
                              className="rounded p-1.5 text-atelier-muted hover:bg-red-500/20 hover:text-atelier-danger"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
        <div className="flex items-center justify-between border-t border-atelier-border bg-atelier-surface-2 px-5 py-2 text-xs text-atelier-muted">
          <span>Atelier3D Studio · 100 % hors-ligne</span>
          <span data-testid="library-version-badge" className="font-mono text-atelier-subtle">
            {APP_VERSION_BADGE}
          </span>
        </div>
      </div>
    </div>
  );
}
