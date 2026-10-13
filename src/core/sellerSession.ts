import { loadWardrobe as defaultLoadWardrobe, defaultSleep } from '../vinted/wardrobe';
import { fetchItemDetails as defaultFetchItemDetails } from '../vinted/itemPage';
import { loadCategoryTree as defaultLoadCategoryTree, type CategoryNode } from '../vinted/categoryTree';
import { BlockedError, type DetailFetchResult, type Item, type ItemDetails } from '../vinted/types';
import * as cache from './cache';
import { DetailQueue, type QueueStatus } from './detailQueue';
import { guessForItem, type TitleGuess } from './titleGuess';
import {
  applyFilters,
  emptyFilters,
  facetOptions,
  matchesInstant,
  priceBounds,
  sortItems,
  type Facet,
  type FacetOption,
  type FilterResult,
  type FilterState,
} from './filters';

/** "Load details" runs longer than this suggest narrowing by category first. */
export const LONG_RUN_MS = 3 * 60 * 1000;

export interface CategoryEstimate {
  id: number;
  title: string;
  /** Items in this category that still need details. */
  need: number;
  ms: number;
}

export type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; loaded: number; total: number }
  | { kind: 'ready'; savedAt: number; fromCache: boolean }
  | { kind: 'error'; message: string; blocked: boolean };

export type CategoryState = 'loading' | 'ready' | 'error';

export interface SessionDeps {
  loadWardrobe: typeof defaultLoadWardrobe;
  loadCategoryTree: (userId: number, signal: AbortSignal) => Promise<CategoryNode[]>;
  fetchItemDetails: (item: Item, signal: AbortSignal) => Promise<DetailFetchResult>;
  getWardrobe: typeof cache.getWardrobe;
  putWardrobe: typeof cache.putWardrobe;
  getCategory: typeof cache.getCategory;
  putCategory: typeof cache.putCategory;
  getDetails: typeof cache.getDetails;
  putDetails: typeof cache.putDetails;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  detailDelayMs: number;
}

const defaultDeps: SessionDeps = {
  loadWardrobe: defaultLoadWardrobe,
  loadCategoryTree: (userId, signal) => defaultLoadCategoryTree(userId, { useCurrentPage: true, signal }),
  fetchItemDetails: (item, signal) => defaultFetchItemDetails(item.id, item.url, signal),
  getWardrobe: cache.getWardrobe,
  putWardrobe: cache.putWardrobe,
  getCategory: cache.getCategory,
  putCategory: cache.putCategory,
  getDetails: cache.getDetails,
  putDetails: cache.putDetails,
  sleep: defaultSleep,
  now: Date.now,
  detailDelayMs: 2500,
};

/** All state for one seller while the panel is in use. */
export class SellerSession {
  items: Item[] = [];
  readonly details = new Map<number, ItemDetails>();
  filters: FilterState = emptyFilters();
  load: LoadState = { kind: 'idle' };
  queueStatus: QueueStatus = { state: 'idle' };
  /** This seller's category tree from Vinted's page; [] until loaded or if unavailable. */
  categories: CategoryNode[] = [];
  /**
   * - missing: the page had no seller category list
   * - blocked: Vinted refused the request for it (403/429)
   */
  categoryTreeState: 'idle' | 'loading' | 'ready' | 'missing' | 'blocked' | 'error' = 'idle';
  /** Per-category membership load state. */
  readonly categoryState = new Map<number, CategoryState>();

  private readonly deps: SessionDeps;
  private readonly queue: DetailQueue;
  private readonly abort = new AbortController();
  private loadAbort: AbortController | null = null;
  private readonly members = new Map<number, Set<number>>();
  /** Category membership requests run one after another, never in parallel. */
  private categoryChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private readonly guessCache = new Map<number, TitleGuess>();
  /** Item ids to fetch before anything else, e.g. the cards currently on screen. */
  private priority: number[] = [];
  /** Why a category failed to load: 'blocked' (403/429/challenge page) or 'failed'. */
  private readonly categoryErrors = new Map<number, 'blocked' | 'failed'>();
  /** Category currently being loaded ahead of a click; only one at a time. */
  private prefetching: number | null = null;

  constructor(
    readonly userId: number,
    deps: Partial<SessionDeps> = {},
  ) {
    this.deps = { ...defaultDeps, ...deps };
    this.queue = new DetailQueue({
      fetchDetails: this.deps.fetchItemDetails,
      saveDetails: this.deps.putDetails,
      nextBatch: () => this.itemsNeedingDetails(),
      onDetails: (d) => {
        this.details.set(d.id, d);
        this.emit();
      },
      onStatus: (s) => {
        this.queueStatus = s;
        this.emit();
      },
      sleep: this.deps.sleep,
      baseDelayMs: this.deps.detailDelayMs,
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    if (this.disposed) return;
    for (const fn of this.listeners) fn();
  }

  private lookup = (id: number) => this.details.get(id);

  private guess = (item: Item): TitleGuess => {
    let g = this.guessCache.get(item.id);
    if (!g) {
      g = guessForItem(item);
      this.guessCache.set(item.id, g);
    }
    return g;
  };

  // ---- Loading -------------------------------------------------------------

  /** Loads the wardrobe (all categories), from cache when fresh unless `force`. */
  async loadItems(force = false): Promise<void> {
    this.loadAbort?.abort();
    const ctrl = new AbortController();
    this.loadAbort = ctrl;
    const key = cache.wardrobeKey(this.userId);
    // Retry the tree on Refresh if it failed or was missing (e.g. after a verification check).
    if (this.categories.length === 0 || force) {
      if (force && this.categoryTreeState !== 'ready') this.categoryTreeState = 'idle';
      if (this.categoryTreeState !== 'ready') void this.loadCategories();
    }
    if (force) {
      this.members.clear();
      this.categoryState.clear();
    }

    if (!force) {
      const cached = await this.deps.getWardrobe(key);
      if (ctrl.signal.aborted) return;
      if (cached && this.deps.now() - cached.savedAt < cache.WARDROBE_TTL_MS) {
        this.items = cached.items;
        await this.loadCachedDetails();
        this.load = { kind: 'ready', savedAt: cached.savedAt, fromCache: true };
        this.emit();
        return;
      }
    }

    this.items = [];
    this.load = { kind: 'loading', loaded: 0, total: 0 };
    this.emit();
    try {
      const items = await this.deps.loadWardrobe(
        { userId: this.userId, catalogIds: '' },
        {
          signal: ctrl.signal,
          onPage: (pageItems, p) => {
            if (ctrl.signal.aborted) return;
            this.items = this.items.concat(pageItems);
            this.load = { kind: 'loading', loaded: p.loaded, total: p.total };
            this.emit();
          },
        },
      );
      if (ctrl.signal.aborted) return;
      const savedAt = this.deps.now();
      this.items = items;
      await this.deps.putWardrobe({ key, items, savedAt });
      await this.loadCachedDetails();
      this.load = { kind: 'ready', savedAt, fromCache: false };
      // Re-request any categories that were selected before a forced reload.
      for (const id of this.filters.categories) this.ensureCategory(id);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      this.load = {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        blocked: err instanceof BlockedError,
      };
    } finally {
      if (this.loadAbort === ctrl) this.loadAbort = null;
    }
    this.emit();
  }

  private async loadCategories(): Promise<void> {
    if (this.categoryTreeState === 'loading') return;
    this.categoryTreeState = 'loading';
    try {
      const tree = await this.deps.loadCategoryTree(this.userId, this.abort.signal);
      if (this.disposed) return;
      this.categories = tree;
      this.categoryTreeState = tree.length ? 'ready' : 'missing';
    } catch (err) {
      if (this.disposed) return;
      // No tree means no category filter; everything else still works.
      console.warn('[vinted-seller-filters] category tree unavailable', err);
      this.categoryTreeState = err instanceof BlockedError ? 'blocked' : 'error';
    }
    this.emit();
  }

  private async loadCachedDetails(): Promise<void> {
    const missing = this.items.filter((i) => !this.details.has(i.id)).map((i) => i.id);
    if (missing.length === 0) return;
    const found = await this.deps.getDetails(missing);
    for (const [id, d] of found) this.details.set(id, d);
  }

  // ---- Categories ----------------------------------------------------------

  /**
   * Selects or clears a category. Membership comes from one wardrobe request per
   * 96 items in that category (`catalog_ids` filters server-side and includes
   * subcategories), so no item pages are needed (RESEARCH.md D3).
   */
  setCategory(id: number, selected: boolean): void {
    if (selected) {
      this.filters.categories.add(id);
      this.ensureCategory(id);
    } else {
      this.filters.categories.delete(id);
    }
    this.syncCategoryFilter();
    this.emit();
  }

  /** Replaces the selection, e.g. with the category chosen in Vinted's own filter. */
  setCategories(ids: Iterable<number>): void {
    this.filters.categories = new Set(ids);
    for (const id of this.filters.categories) this.ensureCategory(id);
    this.syncCategoryFilter();
    this.emit();
  }

  private ensureCategory(id: number): void {
    const state = this.categoryState.get(id);
    if (state === 'ready' || state === 'loading') return;
    this.categoryState.set(id, 'loading');
    this.categoryChain = this.categoryChain.then(() => this.fetchCategory(id));
  }

  /**
   * Starts loading a category's membership before it's ticked, e.g. on hover,
   * so the click feels instant. Uses the same single request the click would
   * make, and only one prefetch runs at a time.
   */
  prefetchCategory(id: number): void {
    if (this.load.kind !== 'ready' || this.categoryState.has(id)) return;
    if (this.prefetching !== null) return;
    this.prefetching = id;
    this.ensureCategory(id);
    void this.categoryChain.then(() => {
      if (this.prefetching === id) this.prefetching = null;
    });
  }

  /** Whether a category's items are already known, so ticking it is instant. */
  categoryReady(id: number): boolean {
    return this.categoryState.get(id) === 'ready';
  }

  /** The worst error among selected categories, for the panel's notice. */
  get selectedCategoryError(): 'blocked' | 'failed' | null {
    let worst: 'blocked' | 'failed' | null = null;
    for (const id of this.filters.categories) {
      const e = this.categoryErrors.get(id);
      if (e === 'blocked') return 'blocked';
      if (e) worst = e;
    }
    return worst;
  }

  /** Highest item id in the loaded wardrobe; ids increase over time (RESEARCH.md §3). */
  private maxItemId(): number {
    let max = 0;
    for (const i of this.items) if (i.id > max) max = i.id;
    return max;
  }

  /**
   * Cached membership is still complete when the seller has listed nothing
   * since it was saved. Removed items don't matter: the wardrobe list no longer
   * contains them, so they are never shown.
   */
  private isCategoryFresh(c: cache.CachedCategory): boolean {
    const age = this.deps.now() - c.savedAt;
    if (age < cache.WARDROBE_TTL_MS) return true;
    if (this.load.kind !== 'ready' || c.maxItemId === undefined) return false;
    return age < cache.CATEGORY_MAX_AGE_MS && this.maxItemId() <= c.maxItemId;
  }

  private async fetchCategory(id: number): Promise<void> {
    if (this.disposed) return;
    const key = cache.categoryKey(this.userId, id);
    try {
      const cached = await this.deps.getCategory(key);
      let ids: number[];
      if (cached && this.isCategoryFresh(cached)) {
        ids = cached.ids;
      } else {
        const items = await this.deps.loadWardrobe(
          { userId: this.userId, catalogIds: String(id) },
          { signal: this.abort.signal },
        );
        ids = items.map((i) => i.id);
        const maxItemId = Math.max(this.maxItemId(), ...ids, 0);
        await this.deps.putCategory({ key, ids, savedAt: this.deps.now(), maxItemId });
      }
      this.members.set(id, new Set(ids));
      this.categoryState.set(id, 'ready');
      this.categoryErrors.delete(id);
    } catch (err) {
      if (this.disposed) return;
      console.warn('[vinted-seller-filters] category load failed', id, err);
      this.categoryState.set(id, 'error');
      this.categoryErrors.set(id, err instanceof BlockedError ? 'blocked' : 'failed');
    }
    this.syncCategoryFilter();
    this.emit();
  }

  /** Recomputes the item-id set used by the category filter. */
  private syncCategoryFilter(): void {
    const selected = this.filters.categories;
    if (selected.size === 0) {
      this.filters.categoryItems = null;
      return;
    }
    const union = new Set<number>();
    for (const id of selected) for (const itemId of this.members.get(id) ?? []) union.add(itemId);
    this.filters.categoryItems = union;
  }

  /** True while a selected category's membership is still loading. */
  get categoriesLoading(): boolean {
    for (const id of this.filters.categories) if (this.categoryState.get(id) === 'loading') return true;
    return false;
  }

  // ---- Filtering -----------------------------------------------------------

  updateFilters(mutate: (f: FilterState) => void): void {
    mutate(this.filters);
    this.syncCategoryFilter();
    this.emit();
  }

  result(): FilterResult {
    return applyFilters(this.items, this.filters, this.lookup, this.guess);
  }

  options(facet: Facet): FacetOption[] {
    return facetOptions(this.items, facet, this.filters, this.lookup, this.guess);
  }

  /** Title guess for an item (cached). Exposed for the UI's "approximate" labels. */
  guessFor(item: Item): TitleGuess {
    return this.guess(item);
  }

  priceBounds() {
    return priceBounds(this.items, this.filters);
  }

  /**
   * Items passing the instant filters that have no details yet: prioritised ids
   * first (the cards on screen), then in display order.
   */
  itemsNeedingDetails(): Item[] {
    // Don't spend item-page requests on items a pending category might exclude.
    if (this.categoriesLoading) return [];
    const needed = sortItems(
      this.items.filter((i) => !this.details.has(i.id) && matchesInstant(i, this.filters)),
      this.filters.sort,
    );
    if (this.priority.length === 0) return needed;
    const rank = new Map(this.priority.map((id, i) => [id, i]));
    const first = needed.filter((i) => rank.has(i.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    return first.concat(needed.filter((i) => !rank.has(i.id)));
  }

  /** Fetch these items' details first, in this order (RESEARCH.md D2). */
  prioritise(ids: number[]): void {
    this.priority = ids.slice(0, 200);
  }

  /** Estimated time to load details for everything matching the current filters. */
  estimateMs(need = this.detailStats().need): number {
    return need * this.queue.currentDelayMs;
  }

  /**
   * Categories that would bring "Load details" under LONG_RUN_MS, using Vinted's
   * per-category counts. Only offered when no category is selected yet. Counts
   * include items already fetched, so these are upper bounds.
   */
  suggestCategories(limit = 6): CategoryEstimate[] {
    if (this.filters.categories.size > 0 || this.categories.length === 0) return [];
    const delay = this.queue.currentDelayMs;
    const fetchedShare = this.items.length ? this.details.size / this.items.length : 0;
    const out: CategoryEstimate[] = [];
    const walk = (nodes: typeof this.categories) => {
      for (const n of nodes) {
        const need = Math.max(0, Math.round(n.count * (1 - fetchedShare)));
        if (need > 0 && need * delay <= LONG_RUN_MS) out.push({ id: n.id, title: n.title, need, ms: need * delay });
        else walk(n.children);
      }
    };
    walk(this.categories);
    // Largest first: the most useful category that still fits.
    return out.sort((a, b) => b.need - a.need).slice(0, limit);
  }

  detailStats(): { have: number; need: number } {
    let have = 0;
    let need = 0;
    for (const item of this.items) {
      if (!matchesInstant(item, this.filters)) continue;
      if (this.details.has(item.id)) have++;
      else need++;
    }
    return { have, need };
  }

  // ---- Item details --------------------------------------------------------

  get detailDelayMs(): number {
    return this.queue.currentDelayMs;
  }

  startDetails(): void {
    if (this.load.kind !== 'ready') return;
    this.queue.start();
  }

  stopDetails(reason?: string): void {
    this.queue.stop(reason);
  }

  get detailsRunning(): boolean {
    return this.queue.running;
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.loadAbort?.abort();
    this.queue.stop();
    this.listeners.clear();
  }
}
