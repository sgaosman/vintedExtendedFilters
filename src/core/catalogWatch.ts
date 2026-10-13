import { isOwnRequest } from '../vinted/ownRequests';

// Learns which category the user picked in Vinted's own member-page filter by
// observing the page's wardrobe requests (RESEARCH.md D3). A PerformanceObserver
// sees request URLs without wrapping fetch/XHR, so nothing on the page changes.

const WARDROBE_PATH_RE = /^\/api\/v2\/wardrobe\/(\d+)\/items\/?$/;

export interface WardrobeRequestInfo {
  userId: number;
  /** '' when the page requested all categories. */
  catalogIds: string;
}

export function parseWardrobeRequest(url: string): WardrobeRequestInfo | null {
  let u: URL;
  try {
    u = new URL(url, 'https://www.vinted.co.uk');
  } catch {
    return null;
  }
  const m = u.pathname.match(WARDROBE_PATH_RE);
  if (!m) return null;
  const catalogIds = (u.searchParams.get('catalog_ids') ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .join(',');
  return { userId: Number(m[1]), catalogIds };
}

/** Latest category scope seen per seller. */
const latest = new Map<number, string>();

function handle(url: string) {
  if (isOwnRequest(url)) return;
  const info = parseWardrobeRequest(url);
  if (info) latest.set(info.userId, info.catalogIds);
}

let started = false;

export function startCatalogWatch(): void {
  if (started || typeof PerformanceObserver === 'undefined') return;
  started = true;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) handle(entry.name);
    });
    // `buffered` replays requests made before this script ran.
    observer.observe({ type: 'resource', buffered: true });
  } catch {
    // Older engines without type/buffered support: category scope stays "all".
  }
}

/** The category scope Vinted's page last requested for this seller, if seen. */
export function currentCatalogIds(userId: number): string | undefined {
  return latest.get(userId);
}

/** For tests. */
export function _handleUrlForTest(url: string): void {
  handle(url);
}
