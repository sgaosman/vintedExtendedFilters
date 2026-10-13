import type { Item, ItemDetails } from '../vinted/types';

// IndexedDB in the vinted.* origin (the script runs in the page's MAIN world,
// so extension storage is unavailable, RESEARCH.md D4). Every call degrades to
// a no-op if IndexedDB is blocked, so the extension still works uncached.

const DB_NAME = 'vinted-seller-filters';
const DB_VERSION = 2;
const DETAILS = 'details';
const WARDROBES = 'wardrobes';
const CATEGORIES = 'categories';

/** How long a loaded wardrobe is reused before reloading (RESEARCH.md D7). */
export const WARDROBE_TTL_MS = 30 * 60 * 1000;

export interface CachedWardrobe {
  key: string;
  items: Item[];
  savedAt: number;
}

/** Which of a seller's items are in one category (from a `catalog_ids` wardrobe request). */
export interface CachedCategory {
  key: string;
  ids: number[];
  savedAt: number;
  /**
   * Highest item id in the seller's wardrobe when this was fetched. Item ids
   * increase over time, so if the wardrobe has nothing newer, the membership is
   * still complete (RESEARCH.md D13).
   */
  maxItemId?: number;
}

/** Category membership with no newer listings is reused for up to this long. */
export const CATEGORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(DETAILS)) db.createObjectStore(DETAILS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(WARDROBES)) db.createObjectStore(WARDROBES, { keyPath: 'key' });
          if (!db.objectStoreNames.contains(CATEGORIES)) db.createObjectStore(CATEGORIES, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  const db = await openDb();
  if (!db) return fallback;
  try {
    return await fn(db.transaction(name, mode).objectStore(name));
  } catch {
    return fallback;
  }
}

export function wardrobeKey(userId: number): string {
  return String(userId);
}

export function categoryKey(userId: number, categoryId: number): string {
  return `${userId}|${categoryId}`;
}

export function getCategory(key: string): Promise<CachedCategory | undefined> {
  return withStore(CATEGORIES, 'readonly', (s) => promisify(s.get(key)), undefined);
}

export function putCategory(entry: CachedCategory): Promise<void> {
  return withStore(CATEGORIES, 'readwrite', async (s) => void (await promisify(s.put(entry))), undefined);
}

export function getWardrobe(key: string): Promise<CachedWardrobe | undefined> {
  return withStore(WARDROBES, 'readonly', (s) => promisify(s.get(key)), undefined);
}

export function putWardrobe(entry: CachedWardrobe): Promise<void> {
  return withStore(WARDROBES, 'readwrite', async (s) => void (await promisify(s.put(entry))), undefined);
}

export function getDetails(ids: number[]): Promise<Map<number, ItemDetails>> {
  return withStore(
    DETAILS,
    'readonly',
    async (s) => {
      const out = new Map<number, ItemDetails>();
      const results = await Promise.all(ids.map((id) => promisify(s.get(id))));
      for (const d of results) if (d) out.set((d as ItemDetails).id, d as ItemDetails);
      return out;
    },
    new Map(),
  );
}

export function putDetails(details: ItemDetails): Promise<void> {
  return withStore(DETAILS, 'readwrite', async (s) => void (await promisify(s.put(details))), undefined);
}

/** For tests. */
export function _resetCacheForTest(): void {
  dbPromise = null;
}
