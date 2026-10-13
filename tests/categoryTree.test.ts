import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  categoryAncestors,
  extractCategoryTree,
  findCategory,
  flightTextFromHtml,
  loadCategoryTree,
  matchBracket,
} from '../src/vinted/categoryTree';
import { FLIGHT_TEXT, memberPageHtml } from './fixtures/categoryTree';
import { BlockedError } from '../src/vinted/types';

describe('matchBracket', () => {
  it('ignores brackets inside strings, including escaped quotes', () => {
    const text = '{"a":"}]\\"{","b":[1,{"c":2}]} trailing';
    expect(text.slice(0, matchBracket(text, 0))).toBe('{"a":"}]\\"{","b":[1,{"c":2}]}');
  });

  it('returns -1 for an unterminated object', () => {
    expect(matchBracket('{"a":[1,2}', 0)).toBe(-1);
  });
});

describe('extractCategoryTree', () => {
  const tree = extractCategoryTree(FLIGHT_TEXT);

  it('picks the seller tree (with itemCount), not the site-wide catalog', () => {
    expect(tree.map((n) => [n.title, n.count])).toEqual([
      ['Women', 460],
      ['Men', 878],
      ['Kids', 5],
    ]);
  });

  it("keeps Men's subcategories under Men even when its catalogIds list is very long", () => {
    const titles = tree.map((n) => n.title);
    expect(titles).not.toContain('Outerwear');
    expect(titles).not.toContain('Coats');
    expect(findCategory(tree, 5)!.children.map((c) => c.title)).toEqual(['Outerwear']);
  });

  it('does not promote a standalone copy of a nested node to the top level', () => {
    expect(tree.map((n) => n.title)).not.toContain('Clothing');
    expect(findCategory(tree, 1904)!.children.map((c) => c.title)).toEqual(['Clothing']);
  });

  it('keeps nesting and counts', () => {
    const coats = findCategory(tree, 2051)!;
    expect(coats).toMatchObject({ title: 'Coats', count: 4 });
    expect(coats.children.map((c) => [c.id, c.title, c.count])).toEqual([
      [2533, 'Overcoats & long coats', 3],
      [1227, 'Parkas', 1],
    ]);
  });

  it('de-duplicates a tree repeated in the payload', () => {
    expect(tree.filter((n) => n.id === 5)).toHaveLength(1);
  });

  it('handles category icons given as objects (seller 153786109)', () => {
    // Shape copied from the live page: "photo" is an object, not null.
    const photo = (code: string) => ({ url: `https://static-assets.vinted.com/ontologies/icons/categories/${code}.png`, thumbnails: [] });
    const node = (id: number, title: string, code: string, itemCount: number, catalogs: unknown[] = []) => ({
      id,
      title,
      code,
      photo: photo(code),
      catalogIds: catalogs.map((c) => (c as { id: number }).id),
      depth: 0,
      itemCount,
      catalogs,
    });
    const women = node(1904, 'Women', 'WOMEN_ROOT', 682, [
      node(16, 'Shoes', 'WOMEN_SHOES', 677, [node(1049, 'Boots', 'WOMEN_BOOTS', 148, [node(2618, 'Ankle boots', 'X', 131)])]),
      node(4, 'Clothing', 'WOMENS', 1, [node(13, 'Jumpers & sweaters', 'Y', 1)]),
    ]);
    const flight = `0:{"isShadowBanned":"$undefined","adminUrl":"$undefined"},"catalogs":[${JSON.stringify(women)}]}`;
    const tree = extractCategoryTree(flight);
    expect(tree.map((n) => [n.title, n.count])).toEqual([['Women', 682]]);
    expect(findCategory(tree, 2618)).toMatchObject({ title: 'Ankle boots', count: 131 });
    expect(findCategory(tree, 13)).toMatchObject({ title: 'Jumpers & sweaters', count: 1 });
  });

  it('returns [] when there is no seller tree', () => {
    expect(extractCategoryTree('{"catalogTree":[{"id":1,"title":"x","catalogs":[]}]}')).toEqual([]);
  });

  it('finds ancestors for a nested id', () => {
    expect(categoryAncestors(tree, 2533)).toEqual([5, 1206, 2051]);
    expect(categoryAncestors(tree, 5)).toEqual([]);
  });
});

describe('flightTextFromHtml', () => {
  it('joins and unescapes split push() chunks', () => {
    expect(flightTextFromHtml(memberPageHtml())).toBe(FLIGHT_TEXT);
  });

  it('parses the real snippet copied from the live member page', () => {
    // Verbatim from the DevTools output (a JSON-stringified slice of innerHTML).
    const pasted = String.raw`"\\\"catalogIds\\\":[2050],\\\"depth\\\":0,\\\"itemCount\\\":878,\\\"catalogs\\\":[{\\\"id\\\":1206,\\\"title\\\":\\\"Outerwear\\\",\\\"code\\\":\\\"MEN_OUTERWEAR_NEW\\\",\\\"photo\\\":null,\\\"catalogIds\\\":[2051,2553,2052],\\\"depth\\\":0,\\\"itemCount\\\":43,\\\"catalogs\\\":[{\\\"id\\\":2051,\\\"title\\\":\\\"Coats\\\",\\\"code\\\":\\\"MEN_COATS\\\",\\\"photo\\\":null,\\\"catalogIds\\\":[2533,1227],\\\"depth\\\":0,\\\"itemCount\\\":4,\\\"catalogs\\\":[{\\\"id\\\":2533,\\\"title\\\":\\\"Overcoats \\u0026 long coats\\\",\\\"code\\\":\\\"MEN_OVERCOATS_LONGCOATS\\\",\\\"photo\\\":null,\\\"catalogIds\\\":[],\\\"depth\\\":0,\\\"itemCount\\\":3,\\\"catalogs\\\":[],\\\"parentId\\\":-1}],\\\"parentId\\\":-1}],\\\"parentId\\\":-1}],\\\"parentId\\\":-1}"`;
    const innerHtmlSlice = JSON.parse(pasted) as string;
    // Rebuild the <script> around it the way Next.js emits flight data.
    const html = `<script>self.__next_f.push([1,"{\\"id\\":5,\\"title\\":\\"Men\\",\\"code\\":\\"MEN_ROOT\\",\\"photo\\":null,${innerHtmlSlice}"])</script>`;
    const tree = extractCategoryTree(flightTextFromHtml(html));
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ id: 5, title: 'Men', count: 878 });
    expect(findCategory(tree, 2533)).toEqual({ id: 2533, title: 'Overcoats & long coats', count: 3, children: [] });
  });
});

describe('loadCategoryTree', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches the seller page when the current page belongs to someone else', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(memberPageHtml()));
    vi.stubGlobal('fetch', fetchMock);
    const tree = await loadCategoryTree(57342735, { useCurrentPage: false });
    expect(fetchMock.mock.calls[0]![0]).toContain('/member/57342735');
    expect(tree.map((n) => n.title)).toEqual(['Women', 'Men', 'Kids']);
  });

  it('reports a 403 as blocked rather than as "no categories"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(loadCategoryTree(1, { useCurrentPage: false })).rejects.toBeInstanceOf(BlockedError);
  });

  it('returns [] when the page loads but has no seller category list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body>no tree</body></html>')));
    expect(await loadCategoryTree(1, { useCurrentPage: false })).toEqual([]);
  });
});
