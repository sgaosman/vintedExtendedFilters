import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  emptyFilters,
  facetOptions,
  fold,
  priceBounds,
  sortItems,
  type DetailsLookup,
  type GuessLookup,
} from '../src/core/filters';
import { guessForItem } from '../src/core/titleGuess';
import type { Item, ItemDetails } from '../src/vinted/types';

function item(partial: Partial<Item> & { id: number }): Item {
  return {
    title: `Item ${partial.id}`,
    url: `https://www.vinted.co.uk/items/${partial.id}`,
    price: 10,
    totalPrice: 11,
    currency: 'GBP',
    brand: '',
    size: '',
    condition: '',
    thumb: '',
    favourites: 0,
    reserved: false,
    rank: partial.id,
    ...partial,
  };
}

const items: Item[] = [
  item({ id: 3, rank: 0, title: 'Rodeo coat', brand: 'Rodeo', size: 'M', condition: 'Very good', price: 20, totalPrice: 21.7 }),
  item({ id: 1, rank: 1, title: 'Colour block jacket Angelo Litrico', brand: 'Vintage Dressing', size: 'XXL', condition: 'Very good', price: 27.5, totalPrice: 29.58 }),
  item({ id: 2, rank: 2, title: 'Cobalt parka Klepper', brand: 'Vintage Dressing', size: 'M', condition: 'Good', price: 22, totalPrice: 23.8, reserved: true }),
];

const detailMap = new Map<number, ItemDetails>([
  [3, { id: 3, colors: ['Blue', 'Purple'], materials: ['Polyester', 'Nylon'], patterns: [], category: 'Coats', attributes: {}, fetchedAt: 0 }],
  [1, { id: 1, colors: ['Red', 'Green'], materials: ['Polyester'], patterns: ['Colour block'], category: 'Jackets', attributes: {}, fetchedAt: 0 }],
]);
const lookup: DetailsLookup = (id) => detailMap.get(id);
const none: DetailsLookup = () => undefined;
const guess: GuessLookup = (i) => guessForItem(i);
const ids = (list: Item[]) => list.map((i) => i.id);

describe('instant filters', () => {
  it('returns everything in relevance order with no filters', () => {
    expect(ids(applyFilters(items, emptyFilters(), none).visible)).toEqual([3, 1, 2]);
  });

  it('filters by price range, inclusive', () => {
    const f = emptyFilters();
    f.minPrice = 21;
    f.maxPrice = 27.5;
    expect(ids(applyFilters(items, f, none).visible)).toEqual([1, 2]);
  });

  it('can compare against the price including the fee', () => {
    const f = emptyFilters();
    f.maxPrice = 21;
    expect(ids(applyFilters(items, f, none).visible)).toEqual([3]);
    f.useTotalPrice = true;
    expect(ids(applyFilters(items, f, none).visible)).toEqual([]);
  });

  it('ORs values within a facet and ANDs across facets', () => {
    const f = emptyFilters();
    f.selected.brand.add('Rodeo').add('Vintage Dressing');
    f.selected.size.add('M');
    expect(ids(applyFilters(items, f, none).visible)).toEqual([3, 2]);
  });

  it('matches every search word against title and brand, ignoring case and accents', () => {
    const f = emptyFilters();
    f.text = 'KLEPPER parka';
    expect(ids(applyFilters(items, f, none).visible)).toEqual([2]);
    f.text = 'vintage litrico';
    expect(ids(applyFilters(items, f, none).visible)).toEqual([1]);
    expect(fold('Été')).toBe('ete');
  });

  it('hides reserved items when asked', () => {
    const f = emptyFilters();
    f.hideReserved = true;
    expect(ids(applyFilters(items, f, none).visible)).toEqual([3, 1]);
  });
});

describe('detail filters', () => {
  it('separates matches, non-matches and items without details', () => {
    const f = emptyFilters();
    f.selected.color.add('Blue');
    const r = applyFilters(items, f, lookup);
    expect(ids(r.visible)).toEqual([3]);
    expect(ids(r.pending)).toEqual([2]);
    expect(r.instantCount).toBe(3);
  });

  it('matches any of an item’s colours', () => {
    const f = emptyFilters();
    f.selected.color.add('Green');
    expect(ids(applyFilters(items, f, lookup).visible)).toEqual([1]);
  });

  it('combines with instant filters', () => {
    const f = emptyFilters();
    f.selected.material.add('Polyester');
    f.selected.size.add('XXL');
    const r = applyFilters(items, f, lookup);
    expect(ids(r.visible)).toEqual([1]);
    expect(r.pending).toEqual([]);
  });

  it('shows title matches as approximate until details arrive', () => {
    const f = emptyFilters();
    f.selected.color.add('Blue');
    // Item 2 ("Cobalt parka") has no details; its title says cobalt.
    const r = applyFilters(items, f, lookup, guess);
    expect(ids(r.visible)).toEqual([3, 2]);
    expect([...r.approximate]).toEqual([2]);
    expect(r.pending).toEqual([]);
  });

  it('never lets a title guess override real details', () => {
    const f = emptyFilters();
    f.selected.color.add('Green');
    // Item 3's title says nothing; item 1's details say Red, Green.
    const r = applyFilters(items, f, lookup, () => ({ colors: ['Green'], materials: [], patterns: [] }));
    expect(ids(r.visible)).toEqual([1, 2]);
    expect([...r.approximate]).toEqual([2]);
  });

  it('leaves items without a title match pending, and ignores guesses when turned off', () => {
    const f = emptyFilters();
    f.selected.color.add('Yellow');
    expect(ids(applyFilters(items, f, lookup, guess).pending)).toEqual([2]);
    f.selected.color = new Set(['Blue']);
    f.useGuesses = false;
    const r = applyFilters(items, f, lookup, guess);
    expect(r.approximate.size).toBe(0);
    expect(ids(r.pending)).toEqual([2]);
  });

  it('builds detail options from titles before any details load', () => {
    const opts = facetOptions(items, 'color', emptyFilters(), none, guess);
    expect(opts.map((o) => o.value)).toContain('Blue');
  });

  it('never shows gone items while detail filters are active', () => {
    const f = emptyFilters();
    f.selected.color.add('Blue');
    const gone: DetailsLookup = (id) =>
      id === 3 ? { ...detailMap.get(3)!, gone: true } : detailMap.get(id);
    expect(ids(applyFilters(items, f, gone).visible)).toEqual([]);
  });
});

describe('sorting', () => {
  it('sorts by price both ways, breaking ties by relevance', () => {
    expect(ids(sortItems(items, 'price_asc'))).toEqual([3, 2, 1]);
    expect(ids(sortItems(items, 'price_desc'))).toEqual([1, 2, 3]);
  });

  it('treats higher ids as newer', () => {
    expect(ids(sortItems(items, 'newest'))).toEqual([3, 2, 1]);
  });

  it('does not mutate its input', () => {
    const copy = items.slice();
    sortItems(items, 'price_desc');
    expect(items).toEqual(copy);
  });
});

describe('facetOptions', () => {
  it('counts values, most common first', () => {
    expect(facetOptions(items, 'brand', emptyFilters(), none)).toEqual([
      { value: 'Vintage Dressing', count: 2 },
      { value: 'Rodeo', count: 1 },
    ]);
  });

  it('ignores its own selection so other values stay selectable', () => {
    const f = emptyFilters();
    f.selected.brand.add('Rodeo');
    f.selected.size.add('M');
    const brands = facetOptions(items, 'brand', f, none);
    // Size M still applies: Vintage Dressing has one M item.
    expect(brands).toEqual([
      { value: 'Rodeo', count: 1 },
      { value: 'Vintage Dressing', count: 1 },
    ]);
  });

  it('keeps selected values that no longer match, with a zero count', () => {
    const f = emptyFilters();
    f.selected.size.add('S');
    expect(facetOptions(items, 'size', f, none)).toContainEqual({ value: 'S', count: 0 });
  });

  it('builds detail facets from fetched details only', () => {
    expect(facetOptions(items, 'color', emptyFilters(), lookup).map((o) => o.value).sort()).toEqual([
      'Blue',
      'Green',
      'Purple',
      'Red',
    ]);
    expect(facetOptions(items, 'pattern', emptyFilters(), none)).toEqual([]);
  });
});

describe('priceBounds', () => {
  it('returns min and max for the chosen price basis', () => {
    expect(priceBounds(items, emptyFilters())).toEqual({ min: 20, max: 27.5 });
    const f = emptyFilters();
    f.useTotalPrice = true;
    expect(priceBounds(items, f)).toEqual({ min: 21.7, max: 29.58 });
    expect(priceBounds([], f)).toBeNull();
  });
});
