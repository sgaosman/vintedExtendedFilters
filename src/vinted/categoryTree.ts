import { ownFetch } from './ownRequests';
import { BlockedError } from './types';

// The member page embeds this seller's category tree, with item counts, in its
// Next.js flight data (RESEARCH.md §3a). Nodes look like:
//   {"id":2051,"title":"Coats","code":"MEN_COATS","photo":null,
//    "catalogIds":[2533,1227],"depth":0,"itemCount":4,"catalogs":[...]}
// The site-wide catalog tree uses the same shape without "itemCount", so
// requiring itemCount selects the seller's tree.

export interface CategoryNode {
  id: number;
  title: string;
  /** This seller's item count, as reported by Vinted's page. */
  count: number;
  children: CategoryNode[];
}

interface RawNode {
  id?: unknown;
  title?: unknown;
  itemCount?: unknown;
  catalogs?: unknown;
}

const NODE_START_AT = /^\{"id":\d+,"title":"/;

/** Index just past the object or array starting at `start`, or -1. Skips brackets inside strings. */
export function matchBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
      continue;
    }
    if (c === 34) inString = true;
    else if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function toNode(raw: RawNode): CategoryNode | null {
  if (typeof raw?.id !== 'number' || typeof raw.title !== 'string' || typeof raw.itemCount !== 'number') {
    return null;
  }
  const children = Array.isArray(raw.catalogs)
    ? raw.catalogs.map((c) => toNode(c as RawNode)).filter((c): c is CategoryNode => c !== null)
    : [];
  return { id: raw.id, title: raw.title, count: raw.itemCount, children };
}

/**
 * Start of the node that owns the "itemCount" key at `before`. Keys before
 * itemCount are id, title, code, photo, catalogIds and depth; catalogIds can
 * be long, so this walks back to the nearest `{"id":N,"title":"` with no limit.
 */
function findNodeStart(text: string, before: number, notBefore: number): number {
  let i = before;
  while (i > notBefore) {
    i = text.lastIndexOf('{"id":', i - 1);
    if (i < notBefore) return -1;
    if (NODE_START_AT.test(text.slice(i, i + 200))) return i;
  }
  return -1;
}

function countNodes(n: CategoryNode): number {
  return n.children.reduce((sum, c) => sum + countNodes(c), 1);
}

function collectDescendants(n: CategoryNode, into: Set<number>): void {
  for (const c of n.children) {
    into.add(c.id);
    collectDescendants(c, into);
  }
}

/**
 * Finds the seller's root category nodes in flight data. Returns [] if none.
 *
 * The payload can hold the same categories several times, including nested
 * nodes on their own (e.g. a flat list beside the tree). Every node is parsed,
 * then only nodes that aren't a descendant of another node are kept as roots.
 */
export function extractCategoryTree(flight: string): CategoryNode[] {
  const candidates: CategoryNode[] = [];
  let pos = 0;
  for (;;) {
    const i = flight.indexOf('"itemCount":', pos);
    if (i === -1) break;
    const start = findNodeStart(flight, i, pos);
    const end = start === -1 ? -1 : matchBracket(flight, start);
    let node: CategoryNode | null = null;
    if (end !== -1) {
      try {
        node = toNode(JSON.parse(flight.slice(start, end)));
      } catch {
        node = null;
      }
    }
    if (node) {
      candidates.push(node);
      pos = end;
    } else {
      pos = i + 1;
    }
  }

  const nested = new Set<number>();
  for (const c of candidates) collectDescendants(c, nested);

  // Keep the most complete copy of each root, in first-seen order.
  const roots = new Map<number, CategoryNode>();
  for (const c of candidates) {
    if (nested.has(c.id)) continue;
    const prev = roots.get(c.id);
    if (!prev || countNodes(c) > countNodes(prev)) roots.set(c.id, c);
  }
  return [...roots.values()];
}

const PUSH_RE = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

/** Flight data from `self.__next_f.push([1,"…"])` calls in raw HTML or script text. */
export function flightTextFromHtml(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(PUSH_RE)) {
    try {
      parts.push(JSON.parse(m[1]!) as string);
    } catch {
      // Skip a chunk that isn't a plain string literal.
    }
  }
  return parts.join('');
}

/** Flight data of the document the browser originally loaded. */
export function flightTextFromPage(): string {
  const pushed = (window as unknown as { __next_f?: unknown[] }).__next_f;
  if (Array.isArray(pushed)) {
    const parts: string[] = [];
    for (const entry of pushed) {
      if (Array.isArray(entry) && entry[0] === 1 && typeof entry[1] === 'string') parts.push(entry[1]);
    }
    if (parts.length) return parts.join('');
  }
  return flightTextFromHtml(Array.from(document.scripts, (s) => s.textContent ?? '').join('\n'));
}

/**
 * The seller's category tree. Reads the current page's data when it was loaded
 * directly on this seller's page; after client-side navigation that data belongs
 * to a different page, so the seller page HTML is fetched once instead.
 */
export async function loadCategoryTree(
  userId: number,
  opts: { useCurrentPage: boolean; signal?: AbortSignal },
): Promise<CategoryNode[]> {
  if (opts.useCurrentPage) {
    const tree = extractCategoryTree(flightTextFromPage());
    if (tree.length) return tree;
  }
  const res = await ownFetch(`/member/${userId}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
    credentials: 'include',
    signal: opts.signal,
  });
  if (res.status === 403 || res.status === 429) {
    res.body?.cancel().catch(() => {});
    throw new BlockedError(`Vinted refused the seller page request (HTTP ${res.status}).`);
  }
  if (!res.ok) return [];
  return extractCategoryTree(flightTextFromHtml(await res.text()));
}

/** Depth-first lookup by id. */
export function findCategory(roots: CategoryNode[], id: number): CategoryNode | undefined {
  for (const n of roots) {
    if (n.id === id) return n;
    const hit = findCategory(n.children, id);
    if (hit) return hit;
  }
  return undefined;
}

/** Ids of the nodes from a root down to `id` (excluding `id`), or [] if not found. */
export function categoryAncestors(roots: CategoryNode[], id: number): number[] {
  for (const n of roots) {
    if (n.id === id) return [];
    const below = categoryAncestors(n.children, id);
    if (below.length || findCategory(n.children, id)) return [n.id, ...below];
  }
  return [];
}
