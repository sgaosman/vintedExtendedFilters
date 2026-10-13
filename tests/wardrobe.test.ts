import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWardrobe, normaliseItem, wardrobeUrl } from '../src/vinted/wardrobe';
import { findCsrfToken, readAnonId, resetSessionCache } from '../src/vinted/session';
import { BlockedError } from '../src/vinted/types';
import { cobalt, colourBlock, page, rodeo } from './fixtures/wardrobe';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('wardrobeUrl', () => {
  it('requests 96 per page in relevance order', () => {
    expect(wardrobeUrl({ userId: 57342735, catalogIds: '' }, 2)).toBe(
      '/api/v2/wardrobe/57342735/items?page=2&per_page=96&order=relevance',
    );
  });

  it('passes the category scope through', () => {
    expect(wardrobeUrl({ userId: 1, catalogIds: '2533' }, 1)).toContain('catalog_ids=2533');
  });
});

describe('normaliseItem', () => {
  it('maps the real response fields', () => {
    const item = normaliseItem(rodeo, 0, 'https://www.vinted.co.uk');
    expect(item).toMatchObject({
      id: 7775580043,
      price: 20,
      totalPrice: 21.7,
      currency: 'GBP',
      brand: 'Rodeo',
      size: 'M',
      condition: 'Very good',
      favourites: 4,
      reserved: false,
      rank: 0,
    });
    expect(item.thumb).toContain('310x430');
    expect(item.url).toBe(rodeo.url);
  });

  it('builds an absolute URL from path when url is missing', () => {
    const item = normaliseItem(colourBlock, 1, 'https://www.vinted.co.uk');
    expect(item.url).toBe(`https://www.vinted.co.uk${colourBlock.path}`);
    expect(item.thumb).toContain('f800');
  });

  it('copes with items without photos or fee', () => {
    const item = normaliseItem({ ...cobalt, total_item_price: undefined, photos: undefined }, 2, 'https://x.test');
    expect(item.thumb).toBe('');
    expect(item.totalPrice).toBe(22);
    expect(item.reserved).toBe(true);
  });
});

describe('session headers', () => {
  beforeEach(() => resetSessionCache());

  it('reads anon_id from the cookie string', () => {
    expect(readAnonId('foo=1; anon_id=00000000-1111-2222-3333-444444444444; bar=2')).toBe(
      '00000000-1111-2222-3333-444444444444',
    );
    expect(readAnonId('foo=1')).toBeUndefined();
  });

  it('finds the CSRF token in escaped Next.js data', () => {
    const script = String.raw`self.__next_f.push([1,"{\"NEXT_J...\",\"CSRF_TOKEN\":\"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\",\"NODE_ENV\":\"production\"}"])`;
    expect(findCsrfToken(['unrelated', script])).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('finds the CSRF token in plain JSON', () => {
    expect(findCsrfToken(['{"CSRF_TOKEN":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}'])).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
  });
});

describe('loadWardrobe', () => {
  const sleep = vi.fn().mockResolvedValue(undefined);
  afterEach(() => {
    vi.unstubAllGlobals();
    sleep.mockClear();
  });

  it('pages until total_pages, deduplicating and dropping closed items', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(page([rodeo, colourBlock], 1, 2, 4)))
      // rodeo repeats (the list shifted), and one closed item is dropped.
      .mockResolvedValueOnce(json(page([rodeo, cobalt, { ...cobalt, id: 99, is_closed: true }], 2, 2, 4)));
    vi.stubGlobal('fetch', fetchMock);

    const pages: number[] = [];
    const items = await loadWardrobe(
      { userId: 57342735, catalogIds: '' },
      { sleep, onPage: (_, p) => pages.push(p.page) },
    );

    expect(items.map((i) => i.id)).toEqual([rodeo.id, colourBlock.id, cobalt.id]);
    expect(items.map((i) => i.rank)).toEqual([0, 1, 2]);
    expect(pages).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain('page=2');
    expect(init.credentials).toBe('include');
    expect(init.headers.accept).toContain('application/json');
  });

  it('throws BlockedError on 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html>', { status: 403 })));
    await expect(loadWardrobe({ userId: 1, catalogIds: '' }, { sleep })).rejects.toBeInstanceOf(BlockedError);
  });

  it('throws BlockedError when an HTML page comes back with 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<!doctype html><p>verify</p>', { status: 200 })));
    await expect(loadWardrobe({ userId: 1, catalogIds: '' }, { sleep })).rejects.toBeInstanceOf(BlockedError);
  });

  it('stops on an empty page even if total_pages says otherwise', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(page([rodeo], 1, 5, 400)))
      .mockResolvedValueOnce(json(page([], 2, 5, 400)));
    vi.stubGlobal('fetch', fetchMock);
    const items = await loadWardrobe({ userId: 1, catalogIds: '' }, { sleep });
    expect(items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
