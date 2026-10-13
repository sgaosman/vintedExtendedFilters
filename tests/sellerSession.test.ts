import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { SellerSession, type SessionDeps } from '../src/core/sellerSession';
import * as cache from '../src/core/cache';
import { BlockedError, type Item, type ItemDetails } from '../src/vinted/types';

const mk = (id: number, extra: Partial<Item> = {}): Item => ({
  id,
  title: `t${id}`,
  url: `https://www.vinted.co.uk/items/${id}`,
  price: id,
  totalPrice: id,
  currency: 'GBP',
  brand: id % 2 ? 'Odd' : 'Even',
  size: 'M',
  condition: 'Good',
  thumb: '',
  favourites: 0,
  reserved: false,
  rank: id,
  ...extra,
});
const det = (id: number, colors: string[]): ItemDetails => ({
  id,
  colors,
  materials: [],
  patterns: [],
  attributes: {},
  fetchedAt: 0,
});

function deps(over: Partial<SessionDeps> = {}): Partial<SessionDeps> {
  const wardrobes = new Map<string, cache.CachedWardrobe>();
  const categories = new Map<string, cache.CachedCategory>();
  const details = new Map<number, ItemDetails>();
  return {
    loadWardrobe: vi.fn(async (q, opts) => {
      // catalog_ids=100 holds items 1 and 2; 200 holds item 3.
      const ids = q.catalogIds === '100' ? [1, 2] : q.catalogIds === '200' ? [3] : [1, 2, 3, 4];
      const items = ids.map((id) => mk(id));
      opts?.onPage?.(items, { loaded: items.length, total: items.length, page: 1, totalPages: 1 });
      return items;
    }),
    loadCategoryTree: vi.fn(async () => [
      { id: 100, title: 'Coats', count: 2, children: [] },
      { id: 200, title: 'Shirts', count: 1, children: [] },
    ]),
    fetchItemDetails: vi.fn(async (item: Item) => ({
      kind: 'ok' as const,
      details: det(item.id, [item.id <= 2 ? 'Blue' : 'Red']),
    })),
    getWardrobe: vi.fn(async (k: string) => wardrobes.get(k)),
    putWardrobe: vi.fn(async (e: cache.CachedWardrobe) => void wardrobes.set(e.key, e)),
    getCategory: vi.fn(async (k: string) => categories.get(k)),
    putCategory: vi.fn(async (e: cache.CachedCategory) => void categories.set(e.key, e)),
    getDetails: vi.fn(async (ids: number[]) => new Map(ids.filter((i) => details.has(i)).map((i) => [i, details.get(i)!]))),
    putDetails: vi.fn(async (d: ItemDetails) => void details.set(d.id, d)),
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => 1_000_000,
    detailDelayMs: 10,
    ...over,
  };
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(cond()).toBe(true);
};

type MockFn = ReturnType<typeof vi.fn>;

describe('SellerSession', () => {
  it('loads the whole wardrobe, then serves the second load from cache', async () => {
    const d = deps();
    const s1 = new SellerSession(57342735, d);
    await s1.loadItems();
    expect(s1.load).toMatchObject({ kind: 'ready', fromCache: false });
    expect(s1.items).toHaveLength(4);
    expect(d.loadWardrobe).toHaveBeenCalledWith({ userId: 57342735, catalogIds: '' }, expect.anything());

    const s2 = new SellerSession(57342735, d);
    await s2.loadItems();
    expect(s2.load).toMatchObject({ kind: 'ready', fromCache: true });
    expect(d.loadWardrobe).toHaveBeenCalledTimes(1);

    await s2.loadItems(true);
    expect(d.loadWardrobe).toHaveBeenCalledTimes(2);
  });

  it('reloads once the cached wardrobe is older than the TTL', async () => {
    let now = 0;
    const d = deps({ now: () => now });
    await new SellerSession(1, d).loadItems();
    now = cache.WARDROBE_TTL_MS + 1;
    const s = new SellerSession(1, d);
    await s.loadItems();
    expect(s.load).toMatchObject({ fromCache: false });
    expect(d.loadWardrobe).toHaveBeenCalledTimes(2);
  });

  it('reports a blocked wardrobe load', async () => {
    const s = new SellerSession(1, deps({ loadWardrobe: vi.fn().mockRejectedValue(new BlockedError('HTTP 403')) }));
    await s.loadItems();
    expect(s.load).toEqual({ kind: 'error', message: 'HTTP 403', blocked: true });
  });

  it('fetches details only for items passing the instant filters', async () => {
    const d = deps();
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.updateFilters((f) => f.selected.brand.add('Odd'));
    expect(s.detailStats()).toEqual({ have: 0, need: 2 });

    s.updateFilters((f) => f.selected.color.add('Blue'));
    expect(s.result().pending.map((i) => i.id)).toEqual([1, 3]);

    s.startDetails();
    await waitFor(() => s.queueStatus.state === 'finished');
    const fetched = (d.fetchItemDetails as MockFn).mock.calls.map((c) => c[0].id);
    expect(fetched).toEqual([1, 3]);
    expect(s.result().visible.map((i) => i.id)).toEqual([1]);
    expect(s.result().pending).toEqual([]);
    expect(s.options('color').map((o) => o.value).sort()).toEqual(['Blue', 'Red']);
  });

  it('reuses cached details across sessions', async () => {
    const d = deps();
    const s1 = new SellerSession(1, d);
    await s1.loadItems();
    s1.startDetails();
    await waitFor(() => s1.queueStatus.state === 'finished');
    expect(d.fetchItemDetails).toHaveBeenCalledTimes(4);

    const s2 = new SellerSession(1, d);
    await s2.loadItems();
    expect(s2.detailStats()).toEqual({ have: 4, need: 0 });
  });

  it('fetches prioritised items (the cards on screen) first', async () => {
    const d = deps();
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.prioritise([4, 2]);
    expect(s.itemsNeedingDetails().map((i) => i.id)).toEqual([4, 2, 1, 3]);
    s.startDetails();
    await waitFor(() => s.queueStatus.state === 'finished');
    expect((d.fetchItemDetails as MockFn).mock.calls.map((c) => c[0].id)).toEqual([4, 2, 1, 3]);
  });

  it('estimates time from the current delay', async () => {
    const s = new SellerSession(1, deps({ detailDelayMs: 2500 }));
    await s.loadItems();
    expect(s.estimateMs()).toBe(4 * 2500);
  });

  it('does not start fetching details before items are ready', () => {
    const s = new SellerSession(1, deps());
    s.startDetails();
    expect(s.detailsRunning).toBe(false);
  });
});

describe('SellerSession categories', () => {
  it("loads the seller's category tree alongside the items", async () => {
    const s = new SellerSession(1, deps());
    await s.loadItems();
    await waitFor(() => s.categories.length === 2);
    expect(s.categories.map((c) => c.title)).toEqual(['Coats', 'Shirts']);
  });

  it('filters by category with one wardrobe request instead of item pages', async () => {
    const d = deps();
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.setCategory(100, true);
    expect(s.categoryState.get(100)).toBe('loading');
    // Detail fetching waits for the category so it doesn't fetch items about to be excluded.
    expect(s.itemsNeedingDetails()).toEqual([]);
    await waitFor(() => s.categoryState.get(100) === 'ready');
    expect(s.result().visible.map((i) => i.id)).toEqual([1, 2]);
    expect(d.loadWardrobe).toHaveBeenCalledWith({ userId: 1, catalogIds: '100' }, expect.anything());
    expect(d.fetchItemDetails).not.toHaveBeenCalled();

    s.setCategory(200, true);
    await waitFor(() => s.categoryState.get(200) === 'ready');
    expect(s.result().visible.map((i) => i.id)).toEqual([1, 2, 3]);

    s.setCategory(100, false);
    s.setCategory(200, false);
    expect(s.result().visible).toHaveLength(4);
  });

  it('caches category membership', async () => {
    const d = deps();
    const s1 = new SellerSession(1, d);
    await s1.loadItems();
    s1.setCategory(100, true);
    await waitFor(() => s1.categoryState.get(100) === 'ready');

    const s2 = new SellerSession(1, d);
    await s2.loadItems();
    s2.setCategories([100]);
    await waitFor(() => s2.categoryState.get(100) === 'ready');
    const categoryCalls = (d.loadWardrobe as MockFn).mock.calls.filter((c) => c[0].catalogIds === '100');
    expect(categoryCalls).toHaveLength(1);
  });

  it('suggests the largest categories that fit in about three minutes', async () => {
    const tree = [
      {
        id: 1,
        title: 'Men',
        count: 880,
        children: [
          { id: 11, title: 'Jackets', count: 71, children: [] },
          { id: 12, title: 'Jumpers', count: 300, children: [{ id: 121, title: 'Cardigans', count: 40, children: [] }] },
        ],
      },
      { id: 2, title: 'Kids', count: 5, children: [] },
    ];
    const s = new SellerSession(1, deps({ loadCategoryTree: vi.fn(async () => tree), detailDelayMs: 2500 }));
    await s.loadItems();
    await waitFor(() => s.categories.length === 2);
    // 3 min at 2.5 s = 72 items: Men (880) and Jumpers (300) are too big, so their children are offered.
    expect(s.suggestCategories().map((c) => [c.title, c.need])).toEqual([
      ['Jackets', 71],
      ['Cardigans', 40],
      ['Kids', 5],
    ]);
    s.setCategory(11, true);
    expect(s.suggestCategories()).toEqual([]);
  });

  it('reuses category membership for a day when the seller has listed nothing new', async () => {
    let now = 0;
    const d = deps({ now: () => now });
    const s1 = new SellerSession(1, d);
    await s1.loadItems();
    s1.setCategory(100, true);
    await waitFor(() => s1.categoryState.get(100) === 'ready');

    // Two hours later: past the 30-minute TTL, but no new listings (same max id).
    now = 2 * 60 * 60 * 1000;
    const s2 = new SellerSession(1, d);
    await s2.loadItems();
    s2.setCategory(100, true);
    await waitFor(() => s2.categoryState.get(100) === 'ready');
    const calls = () => (d.loadWardrobe as MockFn).mock.calls.filter((c) => c[0].catalogIds === '100').length;
    expect(calls()).toBe(1);

    // A new listing appears: membership must be re-fetched.
    const base = d.loadWardrobe!;
    d.loadWardrobe = vi.fn(async (q, o) => {
      const items = await base(q, o);
      return q.catalogIds ? items : [...items, mk(99)];
    });
    const s3 = new SellerSession(1, d);
    await s3.loadItems(true);
    s3.setCategory(100, true);
    await waitFor(() => s3.categoryState.get(100) === 'ready');
    expect((d.loadWardrobe as MockFn).mock.calls.some((c) => c[0].catalogIds === '100')).toBe(true);
  });

  it('prefetches a category on hover with the same single request', async () => {
    const d = deps();
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.prefetchCategory(100);
    s.prefetchCategory(200); // ignored: one prefetch at a time
    await waitFor(() => s.categoryReady(100));
    expect(s.categoryState.has(200)).toBe(false);
    expect(s.filters.categories.size).toBe(0); // not selected, just warmed
    s.setCategory(100, true);
    expect(s.result().visible.map((i) => i.id)).toEqual([1, 2]); // instant
    expect((d.loadWardrobe as MockFn).mock.calls.filter((c) => c[0].catalogIds === '100')).toHaveLength(1);
  });

  it('distinguishes a seller with no category list from a blocked request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const missing = new SellerSession(1, deps({ loadCategoryTree: vi.fn(async () => []) }));
    await missing.loadItems();
    await waitFor(() => missing.categoryTreeState === 'missing');

    const blocked = new SellerSession(1, deps({ loadCategoryTree: vi.fn().mockRejectedValue(new BlockedError('HTTP 403')) }));
    await blocked.loadItems();
    await waitFor(() => blocked.categoryTreeState === 'blocked');

    // Refresh retries the tree.
    blocked['deps'].loadCategoryTree = vi.fn(async () => [{ id: 100, title: 'Coats', count: 2, children: [] }]);
    await blocked.loadItems(true);
    await waitFor(() => blocked.categoryTreeState === 'ready');
    expect(blocked.categories).toHaveLength(1);
    warn.mockRestore();
  });

  it('reports a blocked category request', async () => {
    const d = deps();
    const base = d.loadWardrobe!;
    d.loadWardrobe = vi.fn(async (q, o) => {
      if (q.catalogIds) throw new BlockedError('HTTP 403');
      return base(q, o);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.setCategory(100, true);
    await waitFor(() => s.categoryState.get(100) === 'error');
    expect(s.selectedCategoryError).toBe('blocked');
    warn.mockRestore();
  });

  it('marks a failed category as error and shows nothing for it', async () => {
    const d = deps();
    const base = d.loadWardrobe!;
    d.loadWardrobe = vi.fn(async (q, o) => {
      if (q.catalogIds) throw new Error('boom');
      return base(q, o);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new SellerSession(1, d);
    await s.loadItems();
    s.setCategory(100, true);
    await waitFor(() => s.categoryState.get(100) === 'error');
    expect(s.result().visible).toEqual([]);
    warn.mockRestore();
  });
});

describe('IndexedDB cache', () => {
  it('round-trips wardrobes, categories and details', async () => {
    cache._resetCacheForTest();
    await cache.putWardrobe({ key: cache.wardrobeKey(5), items: [mk(1)], savedAt: 42 });
    expect(await cache.getWardrobe('5')).toMatchObject({ savedAt: 42, items: [{ id: 1 }] });
    await cache.putCategory({ key: cache.categoryKey(5, 2533), ids: [1, 2], savedAt: 7 });
    expect(await cache.getCategory('5|2533')).toMatchObject({ ids: [1, 2] });
    await cache.putDetails(det(9, ['Blue']));
    const found = await cache.getDetails([9, 10]);
    expect([...found.keys()]).toEqual([9]);
    expect(found.get(9)?.colors).toEqual(['Blue']);
  });
});
