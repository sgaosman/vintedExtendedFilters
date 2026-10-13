import { VINTED_MATCHES } from '../vinted/domains';
import { loadCategoryTree } from '../vinted/categoryTree';
import { currentCatalogIds, startCatalogWatch } from '../core/catalogWatch';
import { initialMemberId, memberIdFromPath, watchUrl } from '../core/route';
import { SellerSession } from '../core/sellerSession';
import { Panel } from '../ui/panel';

// Runs in the page's MAIN world so requests behave exactly like Vinted's own
// (RESEARCH.md D4). Starts at document_start only to begin observing the
// page's wardrobe requests early; the UI waits for the page to finish loading.
export default defineContentScript({
  matches: VINTED_MATCHES,
  world: 'MAIN',
  runAt: 'document_start',
  noScriptStartedPostMessage: true,
  main() {
    startCatalogWatch();
    if (document.readyState === 'complete') init();
    else window.addEventListener('load', init, { once: true });
  },
});

function init(): void {
  const panel = new Panel();
  const landedOn = initialMemberId();
  let mounted = false;
  let session: SellerSession | null = null;
  let userId: number | null = null;

  const mount = () => {
    // React can replace <body> children during hydration; re-attach if removed.
    if (!panel.host.isConnected) document.body.append(panel.host);
    mounted = true;
  };

  /** One session per seller; category scope is a filter inside it. */
  const ensureSession = () => {
    if (userId === null) return;
    if (!session || session.userId !== userId) {
      session?.dispose();
      const id = userId;
      session = new SellerSession(id, {
        // The embedded tree belongs to the page the browser loaded; after
        // client-side navigation to another seller it must be fetched.
        loadCategoryTree: (uid, signal) =>
          loadCategoryTree(uid, { useCurrentPage: landedOn === uid, signal }),
      });
      // Start from whatever category is selected in Vinted's own filter (RESEARCH.md D3).
      const fromPage = currentCatalogIds(id);
      if (fromPage) session.setCategories(fromPage.split(',').map(Number));
      panel.setSession(session);
    }
  };

  panel.onOpen = ensureSession;
  panel.onRequestLoad = (force) => void session?.loadItems(force);

  watchUrl((url) => {
    const id = memberIdFromPath(url.pathname);
    if (id === null) {
      userId = null;
      panel.setLauncherVisible(false);
      session?.stopDetails();
      return;
    }
    if (!mounted || !panel.host.isConnected) mount();
    if (id !== userId) {
      userId = id;
      session?.dispose();
      session = null;
      panel.setSession(null);
    }
    panel.setLauncherVisible(true);
  });

  // Keep the host attached if the page re-renders the body.
  new MutationObserver(() => {
    if (mounted && !panel.host.isConnected && userId !== null) mount();
  }).observe(document.body, { childList: true });
}
