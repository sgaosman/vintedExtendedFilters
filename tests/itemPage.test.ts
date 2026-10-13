import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchItemDetails,
  hasEnoughHtml,
  parseAttributeRows,
  parseItemHtml,
  parseJsonLdCategory,
} from '../src/vinted/itemPage';
import {
  CHALLENGE_HTML,
  ITEM_ATTRIBUTES_HTML,
  ITEM_PAGE_HTML,
  JSON_LD,
  PATTERNED_ATTRIBUTES_HTML,
} from './fixtures/itemPage';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('parseAttributeRows', () => {
  it('separates label from value instead of concatenating them', () => {
    const rows = parseAttributeRows(parse(ITEM_ATTRIBUTES_HTML));
    expect(rows.color).toBe('Blue, Purple');
    expect(rows.material).toBe('Polyester, Nylon');
    expect(rows.size).toBe('M');
    expect(rows.status).toBe('Very good');
    expect(rows.upload_date).toBe('9 months ago');
    expect(rows.brand).toBe('Rodeo');
  });

  it('skips nested controls and their own testids', () => {
    const rows = parseAttributeRows(parse(ITEM_ATTRIBUTES_HTML));
    expect(Object.keys(rows)).not.toContain('brand-menu-button');
    expect(Object.keys(rows)).not.toContain('size-faq-link');
    // The "?" faq link text must not leak into the value.
    expect(rows.size).not.toContain('?');
  });

  it('joins values split across elements', () => {
    const rows = parseAttributeRows(parse(PATTERNED_ATTRIBUTES_HTML));
    expect(rows.color).toBe('Black, White');
    expect(rows.patterns).toBe('Striped');
  });
});

describe('parseJsonLdCategory', () => {
  it('reads the Product category', () => {
    expect(parseJsonLdCategory(parse(JSON_LD))).toBe('Men Overcoats & long coats');
  });

  it('ignores malformed JSON-LD', () => {
    expect(parseJsonLdCategory(parse('<script type="application/ld+json">{oops</script>'))).toBeUndefined();
  });
});

describe('parseItemHtml', () => {
  it('extracts colours, materials, patterns and category as lists', () => {
    const d = parseItemHtml(7775580043, ITEM_PAGE_HTML)!;
    expect(d.colors).toEqual(['Blue', 'Purple']);
    expect(d.materials).toEqual(['Polyester', 'Nylon']);
    expect(d.patterns).toEqual([]);
    expect(d.category).toBe('Men Overcoats & long coats');
  });

  it('accepts a pattern row named with any pattern* key', () => {
    const d = parseItemHtml(1, PATTERNED_ATTRIBUTES_HTML)!;
    expect(d.patterns).toEqual(['Striped']);
  });

  it('returns null for a challenge page', () => {
    expect(parseItemHtml(1, CHALLENGE_HTML)).toBeNull();
  });
});

describe('hasEnoughHtml', () => {
  it('waits for </main> after the last attribute row', () => {
    const cut = ITEM_PAGE_HTML.indexOf('</main>');
    expect(hasEnoughHtml(ITEM_PAGE_HTML.slice(0, cut))).toBe(false);
    expect(hasEnoughHtml(ITEM_PAGE_HTML.slice(0, cut + 7))).toBe(true);
    expect(hasEnoughHtml(CHALLENGE_HTML)).toBe(false);
  });
});

function streamResponse(html: string, status = 200, chunk = 200) {
  const bytes = new TextEncoder().encode(html);
  let sent = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= bytes.length) return ctrl.close();
      ctrl.enqueue(bytes.slice(sent, sent + chunk));
      sent += chunk;
    },
    cancel() {
      cancelled = true;
    },
  });
  const res = new Response(body, { status, headers: { 'content-type': 'text/html' } });
  return { res, stats: () => ({ sent, total: bytes.length, cancelled }) };
}

describe('fetchItemDetails', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a streamed page and stops downloading once it has the attributes', async () => {
    // Make the page much bigger after </main> so early cancellation is measurable.
    const html = ITEM_PAGE_HTML.replace('</footer>', '</footer>' + 'x'.repeat(50_000));
    const { res, stats } = streamResponse(html);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    const result = await fetchItemDetails(7775580043, 'https://www.vinted.co.uk/items/7775580043');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.details.colors).toEqual(['Blue', 'Purple']);
    const s = stats();
    expect(s.sent).toBeLessThan(s.total / 2);
  });

  it('reports a challenge page as blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(streamResponse(CHALLENGE_HTML).res));
    const result = await fetchItemDetails(1, 'https://www.vinted.co.uk/items/1');
    expect(result.kind).toBe('blocked');
  });

  it.each([403, 429])('reports HTTP %i as blocked', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status })));
    const result = await fetchItemDetails(1, 'https://www.vinted.co.uk/items/1');
    expect(result).toMatchObject({ kind: 'blocked' });
  });

  it('marks sold or deleted items as gone instead of blocked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    const result = await fetchItemDetails(1, 'https://www.vinted.co.uk/items/1');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.details.gone).toBe(true);
  });
});
