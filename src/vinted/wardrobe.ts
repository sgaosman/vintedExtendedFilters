import { apiHeaders } from './session';
import { ownFetch } from './ownRequests';
import { BlockedError, type Item, type RawWardrobeItem, type RawWardrobeResponse } from './types';

/** The endpoint ignores anything above 96 (RESEARCH.md §3). */
export const PER_PAGE = 96;

export interface WardrobeQuery {
  userId: number;
  /** Comma-separated catalog ids from Vinted's own category filter, or '' for all. */
  catalogIds: string;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  page: number;
  totalPages: number;
}

export interface LoadOptions {
  /** Delay between page requests in ms. */
  delayMs?: number;
  signal?: AbortSignal;
  /** Called after each page with the items from that page. */
  onPage?: (items: Item[], progress: LoadProgress) => void;
  /** Injected for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function wardrobeUrl(q: WardrobeQuery, page: number): string {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(PER_PAGE),
    order: 'relevance',
  });
  if (q.catalogIds) params.set('catalog_ids', q.catalogIds);
  return `/api/v2/wardrobe/${q.userId}/items?${params}`;
}

function pickThumb(raw: RawWardrobeItem): string {
  const photos = raw.photos ?? [];
  const main = photos.find((p) => p.is_main) ?? photos[0];
  if (!main) return '';
  const thumb = main.thumbnails?.find((t) => t.type === 'thumb310x430');
  return thumb?.url ?? main.url ?? '';
}

function toNumber(amount: string | undefined): number {
  const n = Number.parseFloat(amount ?? '');
  return Number.isFinite(n) ? n : 0;
}

export function normaliseItem(raw: RawWardrobeItem, rank: number, origin: string): Item {
  const price = toNumber(raw.price?.amount);
  const path = raw.path ?? `/items/${raw.id}`;
  return {
    id: raw.id,
    title: raw.title ?? '',
    url: raw.url ?? new URL(path, origin).href,
    price,
    totalPrice: raw.total_item_price ? toNumber(raw.total_item_price.amount) : price,
    currency: raw.price?.currency_code ?? raw.currency ?? 'GBP',
    brand: raw.brand?.trim() ?? '',
    size: raw.size?.trim() ?? '',
    condition: raw.status?.trim() ?? '',
    thumb: pickThumb(raw),
    favourites: raw.favourite_count ?? 0,
    reserved: Boolean(raw.is_reserved),
    rank,
  };
}

/** Wardrobe items that are not buyable are dropped. */
function isListed(raw: RawWardrobeItem): boolean {
  return !raw.is_closed && !raw.is_hidden && !raw.is_draft;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchPage(q: WardrobeQuery, page: number, signal?: AbortSignal): Promise<RawWardrobeResponse> {
  const res = await ownFetch(wardrobeUrl(q, page), {
    headers: apiHeaders(),
    credentials: 'include',
    signal,
  });
  if (res.status === 403 || res.status === 429) {
    throw new BlockedError(`Vinted refused the wardrobe request (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(`Wardrobe request failed (HTTP ${res.status}).`);
  const text = await res.text();
  let json: RawWardrobeResponse;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BlockedError('Vinted returned a page instead of data. Open the seller page normally, then try again.');
  }
  if (!Array.isArray(json.items) || !json.pagination) {
    throw new Error('Unexpected wardrobe response format.');
  }
  return json;
}

/** Pages through the whole wardrobe, one request at a time. */
export async function loadWardrobe(q: WardrobeQuery, opts: LoadOptions = {}): Promise<Item[]> {
  const { delayMs = 1500, signal, onPage, sleep = defaultSleep } = opts;
  const origin = location.origin;
  const all: Item[] = [];
  const seen = new Set<number>();
  let page = 1;
  let totalPages = 1;
  do {
    if (page > 1) await sleep(delayMs, signal);
    const res = await fetchPage(q, page, signal);
    totalPages = Math.max(1, res.pagination.total_pages);
    const pageItems: Item[] = [];
    for (const raw of res.items) {
      // Pages can shift while loading if the seller lists or sells something.
      if (seen.has(raw.id) || !isListed(raw)) continue;
      seen.add(raw.id);
      const item = normaliseItem(raw, all.length, origin);
      all.push(item);
      pageItems.push(item);
    }
    onPage?.(pageItems, {
      loaded: all.length,
      total: res.pagination.total_entries,
      page,
      totalPages,
    });
    if (res.items.length === 0) break;
    page++;
  } while (page <= totalPages);
  return all;
}
