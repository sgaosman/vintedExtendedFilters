import { ownFetch } from './ownRequests';
import type { DetailFetchResult, ItemDetails } from './types';

// Item pages are the only source of colour/material/pattern (RESEARCH.md §5).
// They are ~2 MB, and the attribute rows end roughly halfway, so the response
// is streamed and the download cancelled once `</main>` follows the rows.

const ATTR_PREFIX = 'item-attributes-';
const MAX_BYTES = 4 * 1024 * 1024;

/** Testid suffixes that are controls rather than attribute rows. */
const IGNORED_SUFFIXES = ['-faq-link', '-menu-button'];

function splitValues(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Non-empty text nodes under `el`, skipping nested attribute controls. */
function textParts(el: Element): string[] {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        const t = child.textContent?.trim();
        if (t) parts.push(t);
      } else if (child.nodeType === 1) {
        const testid = (child as Element).getAttribute('data-testid');
        if (testid?.startsWith(ATTR_PREFIX)) continue;
        const tag = (child as Element).tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'svg' || tag === 'SVG') continue;
        walk(child);
      }
    }
  };
  walk(el);
  return parts;
}

/**
 * Reads every `[data-testid^="item-attributes-"]` row. The first text node is the
 * localised label ("Colour"); the remaining text is the value ("Blue, Purple").
 */
export function parseAttributeRows(doc: ParentNode): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of Array.from(doc.querySelectorAll(`[data-testid^="${ATTR_PREFIX}"]`))) {
    const key = el.getAttribute('data-testid')!.slice(ATTR_PREFIX.length);
    if (!key || IGNORED_SUFFIXES.some((s) => key.endsWith(s))) continue;
    const parts = textParts(el);
    if (parts.length < 2) continue;
    // Values may be split across elements ("Blue", ",", "Purple"); rejoin them.
    const value = parts
      .slice(1)
      .flatMap(splitValues)
      .join(', ');
    if (value && !(key in out)) out[key] = value;
  }
  return out;
}

/** Category from the page's JSON-LD Product block. */
export function parseJsonLdCategory(doc: ParentNode): string | undefined {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '');
      const nodes: unknown[] = Array.isArray(data) ? data : data?.['@graph'] ?? [data];
      for (const node of nodes) {
        const n = node as { '@type'?: string; category?: unknown };
        if (n?.['@type'] === 'Product' && typeof n.category === 'string' && n.category.trim()) {
          return n.category.trim();
        }
      }
    } catch {
      // Malformed JSON-LD: ignore.
    }
  }
  return undefined;
}

export function detailsFromAttributes(
  id: number,
  attributes: Record<string, string>,
  category: string | undefined,
  now = Date.now(),
): ItemDetails {
  const pick = (pred: (key: string) => boolean) =>
    Object.entries(attributes)
      .filter(([k]) => pred(k))
      .flatMap(([, v]) => splitValues(v));
  return {
    id,
    colors: pick((k) => k === 'color' || k === 'colour' || k.startsWith('color')),
    materials: pick((k) => k.startsWith('material')),
    patterns: pick((k) => k.startsWith('pattern')),
    category,
    attributes,
    fetchedAt: now,
  };
}

interface HtmlPolicy {
  createHTML(s: string): unknown;
}
let htmlPolicy: HtmlPolicy | undefined;

/**
 * DOMParser is a Trusted Types sink. If the page enforces Trusted Types, retry
 * through a named policy (the parsed document is inert: no scripts run).
 */
function parseHtml(html: string): Document {
  const parser = new DOMParser();
  try {
    return parser.parseFromString(html, 'text/html');
  } catch (err) {
    const tt = (window as unknown as { trustedTypes?: { createPolicy(n: string, p: object): HtmlPolicy } })
      .trustedTypes;
    if (!tt) throw err;
    htmlPolicy ??= tt.createPolicy('vinted-seller-filters', { createHTML: (s: string) => s });
    return parser.parseFromString(htmlPolicy.createHTML(html) as string, 'text/html');
  }
}

export function parseItemHtml(id: number, html: string): ItemDetails | null {
  const doc = parseHtml(html);
  const attributes = parseAttributeRows(doc);
  const category = parseJsonLdCategory(doc);
  if (Object.keys(attributes).length === 0 && !category) return null;
  return detailsFromAttributes(id, attributes, category);
}

/** True once the streamed HTML contains the attribute rows and the end of `<main>`. */
export function hasEnoughHtml(html: string): boolean {
  const last = html.lastIndexOf(ATTR_PREFIX);
  return last !== -1 && html.indexOf('</main>', last) !== -1;
}

async function readUntilEnough(res: Response): Promise<string> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (hasEnoughHtml(html) || bytes > MAX_BYTES) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return html;
}

export async function fetchItemDetails(
  id: number,
  url: string,
  signal?: AbortSignal,
): Promise<DetailFetchResult> {
  const res = await ownFetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    credentials: 'include',
    signal,
  });
  if (res.status === 403 || res.status === 429) {
    res.body?.cancel().catch(() => {});
    return { kind: 'blocked', reason: `Vinted refused an item page (HTTP ${res.status}).` };
  }
  if (res.status === 404 || res.status === 410) {
    res.body?.cancel().catch(() => {});
    return {
      kind: 'ok',
      details: { ...detailsFromAttributes(id, {}, undefined), gone: true },
    };
  }
  if (!res.ok) {
    res.body?.cancel().catch(() => {});
    throw new Error(`Item page request failed (HTTP ${res.status}).`);
  }
  const html = await readUntilEnough(res);
  const details = parseItemHtml(id, html);
  if (!details) {
    // A normal page always has attribute rows; a challenge page has none (RESEARCH.md §6).
    return { kind: 'blocked', reason: 'Vinted served a verification page instead of the item.' };
  }
  return { kind: 'ok', details };
}
