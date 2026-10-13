import { describe, expect, it } from 'vitest';
import { memberIdFromPath } from '../src/core/route';
import { _handleUrlForTest, currentCatalogIds, parseWardrobeRequest } from '../src/core/catalogWatch';
import { ownFetch } from '../src/vinted/ownRequests';
import { vi } from 'vitest';

describe('memberIdFromPath', () => {
  it.each([
    ['/member/57342735', 57342735],
    ['/member/57342735-acefentura', 57342735],
    ['/member/57342735/', 57342735],
  ])('reads %s', (path, id) => {
    expect(memberIdFromPath(path)).toBe(id);
  });

  it.each(['/member/', '/member/abc', '/items/7775580043', '/member/57342735/reviews', '/catalog/2050-clothing'])(
    'rejects %s',
    (path) => {
      expect(memberIdFromPath(path)).toBeNull();
    },
  );
});

describe('parseWardrobeRequest', () => {
  it('reads seller and category from the page’s own request', () => {
    expect(
      parseWardrobeRequest(
        'https://www.vinted.co.uk/api/v2/wardrobe/57342735/items?page=1&per_page=20&order=relevance&catalog_ids=2533',
      ),
    ).toEqual({ userId: 57342735, catalogIds: '2533' });
  });

  it('treats a missing catalog_ids as all categories', () => {
    expect(parseWardrobeRequest('/api/v2/wardrobe/1/items?page=1')).toEqual({ userId: 1, catalogIds: '' });
  });

  it('normalises multiple ids and drops junk', () => {
    expect(parseWardrobeRequest('/api/v2/wardrobe/1/items?catalog_ids=1;2,x,3')?.catalogIds).toBe('1,2,3');
  });

  it('ignores other endpoints', () => {
    expect(parseWardrobeRequest('/api/v2/wardrobe/1/items/summary')).toBeNull();
    expect(parseWardrobeRequest('https://api.vinted.co.uk/svc-catalogue/items?page=1')).toBeNull();
  });
});

describe('catalog watch', () => {
  it("records the page's latest category choice", () => {
    _handleUrlForTest('https://www.vinted.co.uk/api/v2/wardrobe/42/items?page=1&catalog_ids=2533');
    expect(currentCatalogIds(42)).toBe('2533');
    _handleUrlForTest('https://www.vinted.co.uk/api/v2/wardrobe/42/items?page=1');
    expect(currentCatalogIds(42)).toBe('');
  });

  it('ignores the extension’s own requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    _handleUrlForTest(`${location.origin}/api/v2/wardrobe/77/items?page=1&catalog_ids=5`);
    await ownFetch('/api/v2/wardrobe/77/items?page=1&per_page=96&order=relevance');
    _handleUrlForTest(`${location.origin}/api/v2/wardrobe/77/items?page=1&per_page=96&order=relevance`);
    expect(currentCatalogIds(77)).toBe('5');
    vi.unstubAllGlobals();
  });
});
