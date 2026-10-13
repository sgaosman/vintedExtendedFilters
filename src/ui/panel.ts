import { LONG_RUN_MS, type SellerSession } from '../core/sellerSession';
import { DETAIL_FACETS, INSTANT_FACETS, type Facet, type FilterState, type SortKey } from '../core/filters';
import type { Item } from '../vinted/types';
import type { CategoryNode } from '../vinted/categoryTree';
import { pageLocale } from '../vinted/session';
import { formatDuration, formatMoney, h, uid } from './dom';
import { STYLES } from './styles';

const FACET_LABELS: Record<Facet, string> = {
  brand: 'Brand',
  size: 'Size',
  condition: 'Condition',
  color: 'Colour',
  material: 'Material',
  pattern: 'Pattern',
};

const SORT_LABELS: Record<SortKey, string> = {
  relevance: 'Relevance',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
  newest: 'Newest first',
};

const PAGE_SIZE = 120;
/** Facets with more options than this get a search box. */
const SEARCHABLE_AFTER = 12;

interface FacetSection {
  details: HTMLDetailsElement;
  count: HTMLElement;
  search?: HTMLInputElement;
  options: HTMLElement;
}

/**
 * The launcher button and full-screen filter panel, inside a shadow root.
 * Static controls are built once; dynamic parts are re-rendered on each change,
 * restoring focus by `data-focus-key` so keyboard users don't lose their place.
 */
export class Panel {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly launcher: HTMLButtonElement;
  private readonly launcherBadge: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly noticeEl: HTMLElement;
  private readonly detailsBox: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly chipsEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly moreEl: HTMLElement;
  private readonly aside: HTMLElement;
  private readonly minInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly textInput: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly totalCheck: HTMLInputElement;
  private readonly reservedCheck: HTMLInputElement;
  private readonly guessCheck: HTMLInputElement;
  private readonly categoryCount: HTMLElement;
  private readonly categoryBody: HTMLElement;
  /** Category ids whose subcategories are expanded in the tree. */
  private readonly expanded = new Set<number>();
  private readonly sections = new Map<Facet, FacetSection>();
  private readonly facetQuery = new Map<Facet, string>();

  private session: SellerSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private shown = PAGE_SIZE;
  private renderQueued = false;
  private readonly locale = pageLocale();

  /** Called the first time the panel opens for a session, and on Refresh. */
  onRequestLoad: (force: boolean) => void = () => {};
  /** Called when the overlay opens, so the caller can pick the right session. */
  onOpen: () => void = () => {};

  constructor() {
    this.host = h('div', { id: 'vinted-seller-filters-root' });
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = h('style');
    style.textContent = STYLES;

    this.launcherBadge = h('span', { class: 'launcher-badge' });
    this.launcher = h(
      'button',
      { class: 'launcher', type: 'button', 'aria-haspopup': 'dialog' },
      'Extended Filters',
      this.launcherBadge,
    );
    this.launcher.hidden = true;
    this.launcher.addEventListener('click', () => this.open());

    const titleId = uid('title');
    this.statusEl = h('span', { class: 'status', role: 'status' });
    this.refreshBtn = h('button', { class: 'btn', type: 'button' }, 'Refresh');
    this.refreshBtn.addEventListener('click', () => this.onRequestLoad(true));
    const filtersToggle = h('button', { class: 'btn filters-toggle', type: 'button', 'aria-expanded': 'false' }, 'Filters');
    const closeBtn = h('button', { class: 'btn', type: 'button', 'data-focus-key': 'close' }, 'Close');
    closeBtn.addEventListener('click', () => this.close());

    const header = h(
      'header',
      { class: 'bar' },
      h('h2', { id: titleId }, 'Seller filters'),
      this.statusEl,
      h('span', { class: 'spacer' }),
      filtersToggle,
      this.refreshBtn,
      closeBtn,
    );

    // ---- Sidebar: static controls ----
    this.textInput = h('input', { type: 'search', placeholder: 'Search titles and brands', 'data-focus-key': 'text' });
    let textTimer: ReturnType<typeof setTimeout> | undefined;
    this.textInput.addEventListener('input', () => {
      clearTimeout(textTimer);
      textTimer = setTimeout(() => this.update((f) => (f.text = this.textInput.value)), 200);
    });

    this.sortSelect = h('select', { 'data-focus-key': 'sort' });
    for (const [value, label] of Object.entries(SORT_LABELS)) {
      this.sortSelect.append(h('option', { value }, label));
    }
    this.sortSelect.addEventListener('change', () => this.update((f) => (f.sort = this.sortSelect.value as SortKey)));

    this.minInput = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: 'Any' });
    this.maxInput = h('input', { type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: 'Any' });
    const onPrice = () =>
      this.update((f) => {
        f.minPrice = parsePrice(this.minInput.value);
        f.maxPrice = parsePrice(this.maxInput.value);
      });
    this.minInput.addEventListener('change', onPrice);
    this.maxInput.addEventListener('change', onPrice);

    this.totalCheck = h('input', { type: 'checkbox' });
    this.totalCheck.addEventListener('change', () => this.update((f) => (f.useTotalPrice = this.totalCheck.checked)));
    this.reservedCheck = h('input', { type: 'checkbox' });
    this.reservedCheck.addEventListener('change', () => this.update((f) => (f.hideReserved = this.reservedCheck.checked)));
    this.guessCheck = h('input', { type: 'checkbox', checked: true });
    this.guessCheck.addEventListener('change', () => this.update((f) => (f.useGuesses = this.guessCheck.checked)));

    const textId = uid('text');
    const sortId = uid('sort');
    this.textInput.id = textId;
    this.sortSelect.id = sortId;

    this.detailsBox = h('div', { class: 'details-box' });
    this.categoryCount = h('span', { class: 'count' });
    this.categoryBody = h('div', { class: 'options tree', role: 'group', 'aria-label': 'Category' });
    const categorySection = h(
      'details',
      { class: 'facet', open: true },
      h('summary', {}, 'Category', this.categoryCount),
      this.categoryBody,
    );

    this.aside = h(
      'aside',
      { class: 'filters', 'aria-label': 'Filters' },
      h('div', { class: 'group' }, h('label', { class: 'label', for: textId }, 'Search'), this.textInput),
      h('div', { class: 'group' }, h('label', { class: 'label', for: sortId }, 'Sort by'), this.sortSelect),
      h(
        'fieldset',
        { class: 'group' },
        h('legend', {}, 'Price'),
        h(
          'div',
          { class: 'row' },
          h('label', {}, 'Minimum', this.minInput),
          h('label', {}, 'Maximum', this.maxInput),
        ),
        h('label', { class: 'check' }, this.totalCheck, 'Include buyer protection fee'),
        h('label', { class: 'check' }, this.reservedCheck, 'Hide reserved items'),
      ),
      categorySection,
      ...INSTANT_FACETS.map((f) => this.buildSection(f)),
      h('h3', { class: 'group label' }, 'From item pages'),
      this.detailsBox,
      h('label', { class: 'check' }, this.guessCheck, 'Use titles until details load (approximate)'),
      ...DETAIL_FACETS.map((f) => this.buildSection(f)),
    );

    filtersToggle.addEventListener('click', () => {
      const open = this.aside.classList.toggle('open');
      filtersToggle.setAttribute('aria-expanded', String(open));
    });

    // ---- Results ----
    this.noticeEl = h('div');
    this.summaryEl = h('span', { 'aria-live': 'polite' });
    this.chipsEl = h('span', { class: 'summary' });
    const clearBtn = h('button', { class: 'btn link', type: 'button' }, 'Clear all filters');
    clearBtn.addEventListener('click', () => this.clearAll());
    this.gridEl = h('ul', { class: 'grid' });
    this.moreEl = h('div', { class: 'more' });

    const main = h(
      'main',
      { class: 'results' },
      this.noticeEl,
      h('div', { class: 'summary' }, this.summaryEl, h('span', { class: 'spacer' }), clearBtn),
      this.chipsEl,
      this.gridEl,
      this.moreEl,
    );

    this.overlay = h(
      'div',
      { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      header,
      h('div', { class: 'body' }, this.aside, main),
    );
    this.overlay.hidden = true;
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      } else if (e.key === 'Tab') {
        this.trapFocus(e);
      }
    });

    this.root.append(style, this.launcher, this.overlay);
  }

  // ---- Lifecycle -----------------------------------------------------------

  setLauncherVisible(visible: boolean): void {
    this.launcher.hidden = !visible;
    if (!visible) this.close(false);
  }

  get isOpen(): boolean {
    return !this.overlay.hidden;
  }

  open(): void {
    this.onOpen();
    this.overlay.hidden = false;
    (this.root.querySelector('[data-focus-key="close"]') as HTMLElement | null)?.focus();
    if (this.session?.load.kind === 'idle') this.onRequestLoad(false);
  }

  /** Keeps Tab inside the dialog, since it covers the whole page. */
  private trapFocus(e: KeyboardEvent): void {
    const focusable = Array.from(
      this.overlay.querySelectorAll<HTMLElement>('button, input, select, summary, a[href]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = this.root.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  close(restoreFocus = true): void {
    if (this.overlay.hidden) return;
    this.overlay.hidden = true;
    if (restoreFocus) this.launcher.focus();
  }

  setSession(session: SellerSession | null): void {
    if (session === this.session) return;
    this.unsubscribe?.();
    this.session = session;
    this.shown = PAGE_SIZE;
    this.facetQuery.clear();
    this.unsubscribe = session ? session.onChange(() => this.scheduleRender()) : null;
    if (session) this.syncControls();
    this.render();
  }

  // ---- State changes -------------------------------------------------------

  private update(mutate: Parameters<SellerSession['updateFilters']>[0]): void {
    if (!this.session) return;
    this.shown = PAGE_SIZE;
    this.session.updateFilters(mutate);
  }

  private clearAll(): void {
    this.session?.setCategories([]);
    this.update((f) => {
      f.text = '';
      f.minPrice = null;
      f.maxPrice = null;
      for (const set of Object.values(f.selected)) set.clear();
    });
    this.syncControls();
  }

  /** Copies filter state into the static controls (after a session switch or Clear). */
  private syncControls(): void {
    const f = this.session?.filters;
    if (!f) return;
    this.textInput.value = f.text;
    this.minInput.value = f.minPrice === null ? '' : String(f.minPrice);
    this.maxInput.value = f.maxPrice === null ? '' : String(f.maxPrice);
    this.sortSelect.value = f.sort;
    this.totalCheck.checked = f.useTotalPrice;
    this.reservedCheck.checked = f.hideReserved;
    this.guessCheck.checked = f.useGuesses;
  }

  private scheduleRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  // ---- Rendering -----------------------------------------------------------

  private buildSection(facet: Facet): HTMLElement {
    const count = h('span', { class: 'count' });
    const options = h('div', { class: 'options', role: 'group', 'aria-label': FACET_LABELS[facet] });
    const details = h('details', { class: 'facet' }, h('summary', {}, FACET_LABELS[facet], count), options);
    const section: FacetSection = { details, count, options };
    this.sections.set(facet, section);
    return details;
  }

  render(): void {
    const s = this.session;
    if (!s) return;
    // Focus inside a shadow root shows up as the host on document.activeElement.
    const active = document.activeElement === this.host ? (this.root.activeElement as HTMLElement | null) : null;
    const focusKey = active?.getAttribute('data-focus-key');

    this.renderLauncher(s);
    this.renderStatus(s);
    this.renderNotice(s);
    this.renderDetailsBox(s);
    this.renderCategories(s);
    for (const facet of [...INSTANT_FACETS, ...DETAIL_FACETS]) this.renderFacet(s, facet);
    this.renderResults(s);

    if (focusKey && this.root.activeElement !== active) {
      const target = Array.from(this.root.querySelectorAll<HTMLElement>('[data-focus-key]')).find(
        (el) => el.getAttribute('data-focus-key') === focusKey,
      );
      target?.focus();
    }
  }

  private renderStatus(s: SellerSession): void {
    switch (s.load.kind) {
      case 'idle':
        this.statusEl.textContent = '';
        break;
      case 'loading':
        this.statusEl.textContent = `Loading items… ${s.load.loaded}${s.load.total ? ` of ${s.load.total}` : ''}`;
        break;
      case 'ready': {
        const mins = Math.max(0, Math.round((Date.now() - s.load.savedAt) / 60000));
        this.statusEl.textContent = `${s.items.length} items · loaded ${mins === 0 ? 'just now' : `${mins} min ago`}`;
        break;
      }
      case 'error':
        this.statusEl.textContent = 'Could not load items';
        break;
    }
    this.refreshBtn.disabled = s.load.kind === 'loading';
  }

  private renderNotice(s: SellerSession): void {
    this.noticeEl.replaceChildren();
    if (s.load.kind !== 'error') return;
    const retry = h('button', { class: 'btn', type: 'button', 'data-focus-key': 'retry' }, 'Try again');
    retry.addEventListener('click', () => this.onRequestLoad(true));
    const hint = s.load.blocked
      ? 'Vinted may be asking for verification. Reload the seller page, complete any check it shows, then try again.'
      : '';
    this.noticeEl.append(
      h('div', { class: 'notice', role: 'alert' }, h('p', {}, s.load.message), hint && h('p', {}, hint), h('div', { class: 'actions' }, retry)),
    );
  }

  private renderDetailsBox(s: SellerSession): void {
    const { have, need } = s.detailStats();
    const q = s.queueStatus;
    const box = this.detailsBox;
    box.replaceChildren();

    box.append(
      h(
        'p',
        {},
        'Colour, material and pattern are only on each item page, so they are fetched one item at a time for the items matching your other filters, then cached.',
      ),
    );

    if (s.load.kind !== 'ready') {
      box.append(h('p', {}, 'Available once items have loaded.'));
      return;
    }

    const total = have + need;
    if (s.categoriesLoading) {
      box.append(h('p', {}, 'Waiting for the selected category to load…'));
      return;
    }
    box.append(h('p', {}, `${have} of ${total} matching items have details.`));
    if (total > 0) box.append(h('progress', { max: total, value: have, 'aria-label': 'Item details loaded' }));

    if (q.state === 'paused' && q.blocked) {
      box.append(
        h(
          'div',
          { class: 'notice', role: 'alert' },
          h('p', {}, `${q.reason} Fetching has stopped.`),
          h('p', {}, 'Wait a few minutes, open any item page normally to clear any verification, then resume (it will go slower).'),
        ),
      );
    }

    if (s.detailsRunning) {
      const stop = h('button', { class: 'btn', type: 'button', 'data-focus-key': 'details-toggle' }, 'Stop');
      stop.addEventListener('click', () => s.stopDetails());
      const remaining = q.state === 'running' ? q.remaining : need;
      box.append(h('p', {}, `Fetching… about ${formatDuration(remaining * s.detailDelayMs)} left.`), stop);
    } else if (need > 0) {
      const ms = s.estimateMs(need);
      const label = q.state === 'paused' ? 'Resume' : `Load details for ${need} item${need === 1 ? '' : 's'}`;
      const start = h('button', { class: 'btn primary', type: 'button', 'data-focus-key': 'details-toggle' }, label);
      start.addEventListener('click', () => s.startDetails());
      box.append(
        h(
          'p',
          {},
          `Takes about ${formatDuration(ms)}. It keeps going while this panel is closed, and each item is only ever fetched once.`,
        ),
      );
      if (ms > LONG_RUN_MS) this.renderSuggestions(s, box);
      box.append(start);
    }
  }

  /** Categories small enough to finish in about three minutes. */
  private renderSuggestions(s: SellerSession, box: HTMLElement): void {
    const picks = s.suggestCategories();
    if (picks.length === 0) return;
    const list = h('div', { class: 'suggest' });
    for (const p of picks) {
      const b = h(
        'button',
        { class: 'chip', type: 'button', 'data-focus-key': `suggest-${p.id}` },
        `${p.title} · ${formatDuration(p.ms)}`,
      );
      b.addEventListener('click', () => {
        this.shown = PAGE_SIZE;
        s.setCategory(p.id, true);
      });
      list.append(b);
    }
    box.append(h('p', {}, 'Faster: pick a category first.'), list);
  }

  /** Shows fetch progress on the launcher, since fetching continues with the panel closed. */
  private renderLauncher(s: SellerSession): void {
    const q = s.queueStatus;
    if (s.detailsRunning && q.state === 'running') {
      this.launcherBadge.textContent = ` · details: ${q.remaining} left`;
    } else if (q.state === 'paused' && q.blocked) {
      this.launcherBadge.textContent = ' · details paused';
    } else {
      this.launcherBadge.textContent = '';
    }
  }

  private categoryTitle(nodes: CategoryNode[], id: number): string | undefined {
    for (const n of nodes) {
      if (n.id === id) return n.title;
      const t = this.categoryTitle(n.children, id);
      if (t) return t;
    }
    return undefined;
  }

  /**
   * Vinted's own category tree for this seller, with Vinted's counts. Ticking a
   * category loads its membership with one wardrobe request per 96 items.
   */
  private renderCategories(s: SellerSession): void {
    const selected = s.filters.categories;
    this.categoryCount.textContent = selected.size ? `(${selected.size})` : '';
    const body = this.categoryBody;
    body.replaceChildren();

    if (s.categories.length === 0) {
      const messages: Record<string, string> = {
        missing:
          "Vinted's page didn't include a category list for this seller, so the category filter isn't available. The other filters still work.",
        blocked:
          'Vinted refused the request for this seller’s categories, which usually means it wants a verification check. Reload the seller page, complete any check it shows, then press Refresh.',
        error: 'Couldn’t read this seller’s categories. Press Refresh to try again.',
      };
      const text = messages[s.categoryTreeState] ?? 'Loading…';
      body.append(h('p', { class: s.categoryTreeState === 'blocked' ? 'notice' : 'hint' }, text));
      return;
    }

    const err = s.selectedCategoryError;
    if (err) {
      body.append(
        h(
          'p',
          { class: 'notice', role: 'alert' },
          err === 'blocked'
            ? 'Vinted refused the category request, which usually means it wants a verification check. Reload the seller page, complete any check, then untick and tick the category.'
            : 'A category couldn’t be loaded. Untick and tick it to try again.',
        ),
      );
    }

    const list = (nodes: CategoryNode[]): HTMLElement => {
      const ul = h('ul', { class: 'tree-level' });
      for (const n of nodes) {
        const state = s.categoryState.get(n.id);
        const cb = h('input', {
          type: 'checkbox',
          checked: selected.has(n.id),
          'data-focus-key': `cat-${n.id}`,
        });
        cb.addEventListener('change', () => {
          this.shown = PAGE_SIZE;
          s.setCategory(n.id, cb.checked);
        });
        const label = h(
          'label',
          { class: 'check' },
          cb,
          h('span', { class: 'name' }, n.title),
          h('span', { class: 'n' }, state === 'loading' ? '…' : state === 'error' ? '!' : String(n.count)),
        );
        if (state === 'error') label.title = 'Could not load this category. Untick and tick it to retry.';
        // Start loading on hover or keyboard focus, so the click itself is instant.
        const warm = () => s.prefetchCategory(n.id);
        label.addEventListener('pointerenter', warm);
        cb.addEventListener('focus', warm);
        const row = h('div', { class: 'tree-row' });
        if (n.children.length) {
          const open = this.expanded.has(n.id);
          const toggle = h(
            'button',
            {
              class: 'tree-toggle',
              type: 'button',
              'aria-expanded': String(open),
              'aria-label': `${open ? 'Collapse' : 'Expand'} ${n.title}`,
              'data-focus-key': `cat-toggle-${n.id}`,
            },
            open ? '▾' : '▸',
          );
          toggle.addEventListener('click', () => {
            if (this.expanded.has(n.id)) this.expanded.delete(n.id);
            else this.expanded.add(n.id);
            this.renderCategories(s);
          });
          row.append(toggle, label);
        } else {
          row.append(h('span', { class: 'tree-spacer' }), label);
        }
        const li = h('li', {}, row);
        if (n.children.length && this.expanded.has(n.id)) li.append(list(n.children));
        ul.append(li);
      }
      return ul;
    };
    body.append(list(s.categories));
  }

  private renderFacet(s: SellerSession, facet: Facet): void {
    const section = this.sections.get(facet)!;
    const selected = s.filters.selected[facet];
    section.count.textContent = selected.size ? `(${selected.size})` : '';

    const all = s.options(facet);
    const isDetail = (DETAIL_FACETS as readonly string[]).includes(facet);
    section.options.replaceChildren();

    if (all.length === 0) {
      const text = isDetail
        ? 'No values yet. Load item details to see options.'
        : s.load.kind === 'ready'
          ? 'No values.'
          : 'Loading…';
      section.options.append(h('p', { class: 'hint' }, text));
      return;
    }

    if (all.length > SEARCHABLE_AFTER) {
      if (!section.search) {
        section.search = h('input', {
          type: 'search',
          class: 'facet-search',
          placeholder: `Find ${FACET_LABELS[facet].toLowerCase()}`,
          'aria-label': `Find ${FACET_LABELS[facet].toLowerCase()}`,
          'data-focus-key': `facet-search-${facet}`,
        });
        section.search.addEventListener('input', () => {
          this.facetQuery.set(facet, section.search!.value);
          this.renderFacet(this.session!, facet);
          section.search!.focus();
        });
        section.options.before(section.search);
      }
    } else if (section.search) {
      section.search.remove();
      section.search = undefined;
      this.facetQuery.delete(facet);
    }

    const q = (this.facetQuery.get(facet) ?? '').toLowerCase().trim();
    const shown = q ? all.filter((o) => o.value.toLowerCase().includes(q)) : all;
    if (isDetail && s.detailStats().need > 0) {
      const hint = s.filters.useGuesses
        ? 'Counts include title matches for items without details yet, so they are approximate.'
        : 'Counts cover items with details loaded so far.';
      section.options.append(h('p', { class: 'hint' }, hint));
    }
    for (const opt of shown) {
      const cb = h('input', {
        type: 'checkbox',
        checked: selected.has(opt.value),
        'data-focus-key': `opt-${facet}-${opt.value}`,
      });
      cb.addEventListener('change', () =>
        this.update((f) => {
          if (cb.checked) f.selected[facet].add(opt.value);
          else f.selected[facet].delete(opt.value);
        }),
      );
      section.options.append(
        h('label', { class: 'check' }, cb, h('span', { class: 'name' }, opt.value), h('span', { class: 'n' }, String(opt.count))),
      );
    }
    if (shown.length === 0) section.options.append(h('p', { class: 'hint' }, 'No matches.'));
  }

  private renderResults(s: SellerSession): void {
    const { visible, pending, approximate } = s.result();
    const detailFiltering = DETAIL_FACETS.some((k) => s.filters.selected[k].size > 0);

    let summary = `${visible.length} item${visible.length === 1 ? '' : 's'}`;
    if (s.load.kind === 'loading') summary += ' so far';
    if (approximate.size > 0) summary += ` (${approximate.size} matched from titles)`;
    if (detailFiltering && pending.length > 0) {
      summary += ` · ${pending.length} more not checked yet (load item details)`;
    }
    this.summaryEl.textContent = summary;

    this.renderChips(s);

    const onScreen = visible.slice(0, this.shown);
    this.gridEl.replaceChildren(...onScreen.map((item) => this.card(item, approximate.has(item.id))));
    // Fetch what's on screen first: title-matched cards to confirm them, then
    // unchecked items that might match (RESEARCH.md D2).
    s.prioritise([
      ...onScreen.filter((i) => !detailFiltering || approximate.has(i.id)).map((i) => i.id),
      ...(detailFiltering ? pending.map((i) => i.id) : []),
    ]);
    this.moreEl.replaceChildren();
    if (visible.length > this.shown) {
      const more = h('button', { class: 'btn', type: 'button', 'data-focus-key': 'more' }, `Show more (${visible.length - this.shown} left)`);
      more.addEventListener('click', () => {
        this.shown += PAGE_SIZE;
        this.render();
      });
      this.moreEl.append(more);
    } else if (visible.length === 0 && s.load.kind === 'ready') {
      this.moreEl.append(h('p', { class: 'empty' }, 'No items match these filters.'));
    }
  }

  private renderChips(s: SellerSession): void {
    const f = s.filters;
    const chips: HTMLElement[] = [];
    const chip = (label: string, clear: (st: FilterState) => void) => {
      const b = h('button', { class: 'chip', type: 'button', 'aria-label': `Remove filter ${label}` }, label, ' ×');
      b.addEventListener('click', () => {
        this.update(clear);
        this.syncControls();
      });
      chips.push(b);
    };
    const currency = s.items[0]?.currency ?? 'GBP';
    for (const id of f.categories) {
      const label = this.categoryTitle(s.categories, id) ?? `#${id}`;
      const b = h('button', { class: 'chip', type: 'button', 'aria-label': `Remove filter ${label}` }, label, ' ×');
      b.addEventListener('click', () => {
        this.shown = PAGE_SIZE;
        s.setCategory(id, false);
      });
      chips.push(b);
    }
    if (f.text) chip(`“${f.text}”`, (st) => void (st.text = ''));
    if (f.minPrice !== null) chip(`From ${formatMoney(f.minPrice, currency, this.locale)}`, (st) => void (st.minPrice = null));
    if (f.maxPrice !== null) chip(`Up to ${formatMoney(f.maxPrice, currency, this.locale)}`, (st) => void (st.maxPrice = null));
    for (const facet of [...INSTANT_FACETS, ...DETAIL_FACETS]) {
      for (const v of f.selected[facet]) chip(`${FACET_LABELS[facet]}: ${v}`, (st) => void st.selected[facet].delete(v));
    }
    this.chipsEl.replaceChildren(...chips);
  }

  private card(item: Item, approximate = false): HTMLElement {
    const meta = [item.brand, item.size, item.condition].filter(Boolean).join(' · ');
    const img = item.thumb
      ? h('img', { src: item.thumb, alt: '', loading: 'lazy', decoding: 'async' })
      : null;
    return h(
      'li',
      { class: 'card' },
      h(
        'a',
        { href: item.url, target: '_blank', rel: 'noopener' },
        h(
          'div',
          { class: 'img' },
          img,
          item.reserved && h('span', { class: 'badge' }, 'Reserved'),
          approximate &&
            h(
              'span',
              { class: 'badge approx', title: 'Matched from the title. Confirmed when details load.' },
              'From title',
            ),
        ),
        h('div', { class: 'price' }, formatMoney(item.price, item.currency, this.locale)),
        item.totalPrice !== item.price &&
          h('div', { class: 'total' }, `${formatMoney(item.totalPrice, item.currency, this.locale)} incl. fee`),
        meta && h('div', { class: 'meta' }, meta),
        h('div', { class: 'title' }, item.title),
      ),
    );
  }
}

function parsePrice(v: string): number | null {
  if (!v.trim()) return null;
  const n = Number.parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
