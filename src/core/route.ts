/** Seller id of the page the browser originally loaded (before any client-side navigation). */
export function initialMemberId(): number | null {
  const nav = performance.getEntriesByType('navigation')[0];
  const href = nav?.name || location.href;
  try {
    return memberIdFromPath(new URL(href).pathname);
  } catch {
    return null;
  }
}

/** Seller id from a member page path: `/member/57342735` or `/member/57342735-login`. */
export function memberIdFromPath(pathname: string): number | null {
  const m = pathname.match(/^\/member\/(\d+)(?:-[^/]*)?\/?$/);
  return m ? Number(m[1]) : null;
}

/**
 * Calls `onChange` whenever the URL changes. Next.js navigates with
 * history.pushState, which fires no event, so the URL is also polled.
 */
export function watchUrl(onChange: (url: URL) => void, intervalMs = 500): () => void {
  let last = '';
  const check = () => {
    if (location.href !== last) {
      last = location.href;
      onChange(new URL(location.href));
    }
  };
  check();
  const timer = setInterval(check, intervalMs);
  window.addEventListener('popstate', check);
  return () => {
    clearInterval(timer);
    window.removeEventListener('popstate', check);
  };
}
