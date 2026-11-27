import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProjectDocument, SavedProjectRecord } from '@/types';
import { createCuisineEnLTemplate } from '@/data/templates/cuisineEnL';
import { createDressingSurMesureTemplate } from '@/data/templates/dressingSurMesure';
import { generateId } from '@/utils/id';
import { generateThumbnailDataUrl } from './thumbnail';

const DB_NAME = 'atelier3d_projects';
const DB_VERSION = 1;
const STORE_NAME = 'projects';
const LAST_PROJECT_STORAGE_KEY = 'atelier3d_last_project_id';

interface AtelierDBSchema extends DBSchema {
  projects: {
    key: string;
    value: SavedProjectRecord;
    indexes: {
      updatedAt: string;
    };
  };
}

const memoryFallback = new Map<string, SavedProjectRecord>();
let dbPromise: Promise<IDBPDatabase<AtelierDBSchema>> | null = null;

function isIndexedDbSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

async function getDb(): Promise<IDBPDatabase<AtelierDBSchema> | null> {
  if (!isIndexedDbSupported()) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB<AtelierDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      },
    }).catch(() => null as unknown as IDBPDatabase<AtelierDBSchema>);
  }
  const db = await dbPromise;
  return db ?? null;
}

function readLastProjectId(): string | null {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem(LAST_PROJECT_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

function writeLastProjectId(id: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LAST_PROJECT_STORAGE_KEY, id);
    }
  } catch {
    // Ignore storage quota or private-mode restriction
  }
}

function clearLastProjectId(id: string): void {
  try {
    if (
      typeof localStorage !== 'undefined'
      && localStorage.getItem(LAST_PROJECT_STORAGE_KEY) === id
    ) {
      localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

function toRecord(doc: ProjectDocument, thumbnailDataUrl?: string): SavedProjectRecord {
  const thumb = thumbnailDataUrl || generateThumbnailDataUrl(doc);
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    moduleCount: doc.modules.length,
    wallCount: doc.walls.length,
    thumbnailDataUrl: thumb,
    document: doc,
  };
}

function sortByNewest(records: SavedProjectRecord[]): SavedProjectRecord[] {
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function resetInMemoryProjectStore(): void {
  memoryFallback.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

export async function listProjects(): Promise<SavedProjectRecord[]> {
  const db = await getDb();
  if (db) {
    try {
      const all = await db.getAll(STORE_NAME);
      return sortByNewest(all);
    } catch {
      // Fallback below
    }
  }
  return sortByNewest(Array.from(memoryFallback.values()));
}

export async function getProject(id: string): Promise<SavedProjectRecord | null> {
  const db = await getDb();
  if (db) {
    try {
      return (await db.get(STORE_NAME, id)) ?? null;
    } catch {
      // Fallback below
    }
  }
  return memoryFallback.get(id) ?? null;
}

export async function saveProject(
  doc: ProjectDocument,
  thumbnailDataUrl?: string
): Promise<SavedProjectRecord> {
  const updatedDoc: ProjectDocument = {
    ...doc,
    updatedAt: doc.updatedAt || new Date().toISOString(),
  };
  const record = toRecord(updatedDoc, thumbnailDataUrl);

  const db = await getDb();
  if (db) {
    try {
      await db.put(STORE_NAME, record);
      writeLastProjectId(record.id);
      return record;
    } catch {
      // Fallback below
    }
  }

  memoryFallback.set(record.id, record);
  writeLastProjectId(record.id);
  return record;
}

export async function duplicateProject(id: string): Promise<SavedProjectRecord | null> {
  const existing = await getProject(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const clonedDoc: ProjectDocument = {
    ...structuredClone(existing.document),
    id: generateId('proj'),
    name: `${existing.document.name} (Copie)`,
    createdAt: now,
    updatedAt: now,
  };

  return saveProject(clonedDoc);
}

export async function renameProject(
  id: string,
  newName: string
): Promise<SavedProjectRecord | null> {
  const trimmed = newName.trim();
  if (!trimmed) return null;

  const existing = await getProject(id);
  if (!existing) return null;

  const updatedDoc: ProjectDocument = {
    ...existing.document,
    name: trimmed,
    updatedAt: new Date().toISOString(),
  };
  return saveProject(updatedDoc, existing.thumbnailDataUrl);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  if (db) {
    try {
      await db.delete(STORE_NAME, id);
      clearLastProjectId(id);
      memoryFallback.delete(id);
      return;
    } catch {
      // Fallback below
    }
  }
  memoryFallback.delete(id);
  clearLastProjectId(id);
}

export async function ensureStarterProjects(): Promise<SavedProjectRecord[]> {
  const current = await listProjects();
  if (current.length > 0) {
    return current;
  }

  const cuisine = createCuisineEnLTemplate();
  const dressing = createDressingSurMesureTemplate();
  // Ensure Cuisine en L appears as most recent default
  const older = new Date(Date.now() - 60_000).toISOString();
  dressing.createdAt = older;
  dressing.updatedAt = older;

  await saveProject(dressing);
  await saveProject(cuisine);
  writeLastProjectId(cuisine.id);

  return listProjects();
}

export async function loadInitialProject(): Promise<ProjectDocument> {
  const projects = await ensureStarterProjects();
  const lastId = readLastProjectId();
  if (lastId) {
    const found = projects.find((p) => p.id === lastId);
    if (found) {
      return found.document;
    }
  }
  if (projects.length > 0) {
    return projects[0].document;
  }
  return createCuisineEnLTemplate();
}
