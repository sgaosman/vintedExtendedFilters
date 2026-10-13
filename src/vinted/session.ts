// Request headers the wardrobe endpoint accepts (RESEARCH.md §2).
// Either x-anon-id or x-csrf-token alone is enough; both are sent when available.

const CSRF_RE = /CSRF_TOKEN\\?"\s*:\s*\\?"([0-9a-f-]{36})/i;

let cachedCsrf: string | null | undefined;

/** Reads the anon id from the `anon_id` cookie. */
export function readAnonId(cookie: string = document.cookie): string | undefined {
  const m = cookie.match(/(?:^|;\s*)anon_id=([^;]+)/);
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

/** Finds the CSRF token embedded in the page's Next.js data. */
export function findCsrfToken(scriptTexts: Iterable<string>): string | undefined {
  for (const text of scriptTexts) {
    if (!text.includes('CSRF_TOKEN')) continue;
    const m = text.match(CSRF_RE);
    if (m) return m[1];
  }
  return undefined;
}

function readCsrfFromPage(): string | undefined {
  if (cachedCsrf === undefined) {
    const texts = Array.from(document.scripts, (s) => s.textContent ?? '');
    cachedCsrf = findCsrfToken(texts) ?? null;
  }
  return cachedCsrf ?? undefined;
}

/** Locale header in the `en-GB` form Vinted's own requests use. */
export function pageLocale(): string {
  const lang = document.documentElement.lang;
  if (lang && lang.includes('-')) return lang;
  return navigator.language || 'en-GB';
}

export function apiHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    locale: pageLocale(),
  };
  const anon = readAnonId();
  if (anon) headers['x-anon-id'] = anon;
  const csrf = readCsrfFromPage();
  if (csrf) headers['x-csrf-token'] = csrf;
  return headers;
}

/** For tests. */
export function resetSessionCache(): void {
  cachedCsrf = undefined;
}
