// The page-request watcher (core/catalogWatch.ts) must ignore the extension's
// own wardrobe requests, so every URL the extension fetches is recorded here.

const own = new Set<string>();

export function isOwnRequest(absoluteUrl: string): boolean {
  return own.has(absoluteUrl);
}

/** Calls the page's current `fetch` (including any wrappers the site installed). */
export function ownFetch(input: string, init?: RequestInit): Promise<Response> {
  const abs = new URL(input, location.href).href;
  own.add(abs);
  // Bounded: only the most recent URLs matter for matching performance entries.
  if (own.size > 500) own.delete(own.values().next().value!);
  return window.fetch(abs, init);
}
