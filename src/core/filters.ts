import type { Item, ItemDetails } from '../vinted/types';
import type { TitleGuess } from './titleGuess';

export type SortKey = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

/** Facets read from the wardrobe list: filtering on them is free. */
export const INSTANT_FACETS = ['brand', 'size', 'condition'] as const;
/** Facets read from item pages: filtering on them needs details (RESEARCH.md D2). */
export const DETAIL_FACETS = ['color', 'material', 'pattern'] as const;

export type InstantFacet = (typeof INSTANT_FACETS)[number];
export type DetailFacet = (typeof DETAIL_FACETS)[number];
export type Facet = InstantFacet | DetailFacet;

export interface FilterState {
  text: string;
  minPrice: number | null;
  maxPrice: number | null;
  /** Compare against the price including Vinted's buyer protection fee. */
  useTotalPrice: boolean;
  hideReserved: boolean;
  /** Use title guesses for items whose details aren't loaded yet (RESEARCH.md D11). */
  useGuesses: boolean;
  /** Selected Vinted category ids; an empty set means "any". */
  categories: Set<number>;
  /**
   * Ids of items in any selected category, maintained by SellerSession from
   * per-category wardrobe requests (RESEARCH.md D3). null = no category filter.
   */
  categoryItems: Set<number> | null;
  /** Selected values per facet; an empty set means "any". Values within a facet are OR'd. */
  selected: Record<Facet, Set<string>>;
  sort: SortKey;
}

export function emptyFilters(): FilterState {
  return {
    text: '',
    minPrice: null,
    maxPrice: null,
    useTotalPrice: false,
    hideReserved: false,
    useGuesses: true,
    categories: new Set(),
    categoryItems: null,
    selected: {
      brand: new Set(),
      size: new Set(),
      condition: new Set(),
      color: new Set(),
      material: new Set(),
      pattern: new Set(),
    },
    sort: 'relevance',
  };
}

export type DetailsLookup = (id: number) => ItemDetails | undefined;
export type GuessLookup = (item: Item) => TitleGuess;

/** Case-folded, accent-insensitive form used for text matching and grouping. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function priceOf(item: Item, f: FilterState): number {
  return f.useTotalPrice ? item.totalPrice : item.price;
}

const GUESS_KEY: Record<DetailFacet, keyof TitleGuess> = {
  color: 'colors',
  material: 'materials',
  pattern: 'patterns',
};
const DETAIL_KEY: Record<DetailFacet, 'colors' | 'materials' | 'patterns'> = GUESS_KEY;

/**
 * Values of one facet for an item. Detail facets use the fetched details when
 * present, otherwise the title guess (if `guesses` is given).
 */
export function facetValues(item: Item, facet: Facet, details: DetailsLookup, guesses?: GuessLookup): string[] {
  switch (facet) {
    case 'brand':
      return item.brand ? [item.brand] : [];
    case 'size':
      return item.size ? [item.size] : [];
    case 'condition':
      return item.condition ? [item.condition] : [];
    default: {
      const d = details(item.id);
      if (d) return d[DETAIL_KEY[facet]];
      return guesses ? guesses(item)[GUESS_KEY[facet]] : [];
    }
  }
}

export function activeDetailFacets(f: FilterState): DetailFacet[] {
  return DETAIL_FACETS.filter((k) => f.selected[k].size > 0);
}

function matchesFacet(item: Item, facet: Facet, f: FilterState, details: DetailsLookup, guesses?: GuessLookup): boolean {
  const wanted = f.selected[facet];
  if (wanted.size === 0) return true;
  return facetValues(item, facet, details, guesses).some((v) => wanted.has(v));
}

/** Text, price, availability, category and instant facets. Needs no item-page data. */
export function matchesInstant(item: Item, f: FilterState, skip?: Facet): boolean {
  if (f.hideReserved && item.reserved) return false;
  if (f.categoryItems && !f.categoryItems.has(item.id)) return false;
  const p = priceOf(item, f);
  if (f.minPrice !== null && p < f.minPrice) return false;
  if (f.maxPrice !== null && p > f.maxPrice) return false;
  if (f.text) {
    const haystack = fold(`${item.title} ${item.brand}`);
    for (const word of fold(f.text).split(/\s+/)) {
      if (word && !haystack.includes(word)) return false;
    }
  }
  for (const facet of INSTANT_FACETS) {
    if (facet !== skip && !matchesFacet(item, facet, f, details0)) return false;
  }
  return true;
}

const details0: DetailsLookup = () => undefined;

/**
 * - match: the item's fetched details satisfy every active detail filter
 * - guess: no details yet, but its title suggests it matches
 * - nomatch: its details rule it out
 * - unknown: no details yet and nothing in the title to go on
 *
 * A title guess never rules an item out, because titles rarely list everything.
 */
export type DetailMatch = 'match' | 'guess' | 'nomatch' | 'unknown';

export function matchesDetails(
  item: Item,
  f: FilterState,
  details: DetailsLookup,
  skip?: Facet,
  guesses?: GuessLookup,
): DetailMatch {
  const facets = activeDetailFacets(f).filter((k) => k !== skip);
  if (facets.length === 0) return 'match';
  const d = details(item.id);
  if (d) {
    if (d.gone) return 'nomatch';
    return facets.every((k) => matchesFacet(item, k, f, details)) ? 'match' : 'nomatch';
  }
  if (f.useGuesses && guesses && facets.every((k) => matchesFacet(item, k, f, details, guesses))) return 'guess';
  return 'unknown';
}

export interface FilterResult {
  /** Items passing every filter (confirmed or guessed), sorted. */
  visible: Item[];
  /** Ids in `visible` that only match by title guess. */
  approximate: Set<number>;
  /** Items passing the instant filters whose details are still needed and have no guess. */
  pending: Item[];
  /** Items passing the instant filters, regardless of detail filters. */
  instantCount: number;
}

export function applyFilters(items: Item[], f: FilterState, details: DetailsLookup, guesses?: GuessLookup): FilterResult {
  const visible: Item[] = [];
  const approximate = new Set<number>();
  const pending: Item[] = [];
  let instantCount = 0;
  for (const item of items) {
    if (!matchesInstant(item, f)) continue;
    instantCount++;
    const m = matchesDetails(item, f, details, undefined, guesses);
    if (m === 'match') visible.push(item);
    else if (m === 'guess') {
      visible.push(item);
      approximate.add(item.id);
    } else if (m === 'unknown') pending.push(item);
  }
  return { visible: sortItems(visible, f.sort), approximate, pending: sortItems(pending, f.sort), instantCount };
}

export function sortItems(items: Item[], sort: SortKey): Item[] {
  const out = items.slice();
  switch (sort) {
    case 'relevance':
      return out.sort((a, b) => a.rank - b.rank);
    case 'price_asc':
      return out.sort((a, b) => a.price - b.price || a.rank - b.rank);
    case 'price_desc':
      return out.sort((a, b) => b.price - a.price || a.rank - b.rank);
    case 'newest':
      // Item ids increase over time (RESEARCH.md §3); there is no upload timestamp in the list.
      return out.sort((a, b) => b.id - a.id);
  }
}

export interface FacetOption {
  value: string;
  count: number;
}

/**
 * Options for one facet with counts, computed against every other active filter
 * (so selecting "Rodeo" doesn't hide the other brands). Selected values are always
 * included, even with a zero count, so they can be unticked. With `guesses`,
 * detail-facet options and counts include items known only by title guess.
 */
export function facetOptions(
  items: Item[],
  facet: Facet,
  f: FilterState,
  details: DetailsLookup,
  guesses?: GuessLookup,
): FacetOption[] {
  const g = f.useGuesses ? guesses : undefined;
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!matchesInstant(item, f, facet)) continue;
    const m = matchesDetails(item, f, details, facet, g);
    if (m !== 'match' && m !== 'guess') continue;
    for (const v of new Set(facetValues(item, facet, details, g))) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  for (const v of f.selected[facet]) if (!counts.has(v)) counts.set(v, 0);
  return Array.from(counts, ([value, count]) => ({ value, count })).sort(
    (a, b) => b.count - a.count || a.value.localeCompare(b.value),
  );
}

export function priceBounds(items: Item[], f: FilterState): { min: number; max: number } | null {
  if (items.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const item of items) {
    const p = priceOf(item, f);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}
