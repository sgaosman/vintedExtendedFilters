import type { RawWardrobeItem, RawWardrobeResponse } from '../../src/vinted/types';

// Trimmed from the real response for seller 57342735, catalog_ids=2533 (RESEARCH.md §3).
export const rodeo: RawWardrobeItem = {
  id: 7775580043,
  title: 'Vintage 90s blue purple funky crazy pattern zipped winter coat jacket unisex Rodeo',
  path: '/items/7775580043-vintage-90s-blue-purple-funky-crazy-pattern-zipped-winter-coat-jacket-unisex-rodeo',
  url: 'https://www.vinted.co.uk/items/7775580043-vintage-90s-blue-purple-funky-crazy-pattern-zipped-winter-coat-jacket-unisex-rodeo',
  price: { amount: '20.0', currency_code: 'GBP' },
  total_item_price: { amount: '21.7', currency_code: 'GBP' },
  currency: 'GBP',
  brand: 'Rodeo',
  size: 'M',
  status: 'Very good',
  favourite_count: 4,
  is_reserved: false,
  is_closed: false,
  is_hidden: false,
  is_draft: false,
  photos: [
    {
      is_main: true,
      url: 'https://images1.vinted.net/t/06_01fa0/f800/1765900197.webp',
      thumbnails: [
        { type: 'thumb70x100', url: 'https://images1.vinted.net/t/06_01fa0/70x100/1765900197.webp' },
        { type: 'thumb310x430', url: 'https://images1.vinted.net/t/06_01fa0/310x430/1765900197.webp' },
      ],
    },
  ],
};

export const colourBlock: RawWardrobeItem = {
  id: 8020890590,
  title: '80s 90s retro red green colour block coat jacket Men’s tall 2XL/3XL Angelo Litrico',
  path: '/items/8020890590-80s-90s-retro-red-green-colour-block-coat-jacket-mens-tall-2xl3xl-angelo-litrico',
  price: { amount: '27.5', currency_code: 'GBP' },
  total_item_price: { amount: '29.58', currency_code: 'GBP' },
  brand: 'Vintage Dressing',
  size: 'XXL',
  status: 'Very good',
  favourite_count: 3,
  photos: [{ is_main: true, url: 'https://images1.vinted.net/t/05_00d9e/f800/1769336928.webp' }],
};

export const cobalt: RawWardrobeItem = {
  id: 7426868992,
  title: 'Cobalt blue parka jacket drawstring waist high neck Klepper',
  path: '/items/7426868992-cobalt-blue-parka-jacket-drawstring-waist-high-neck-klepper',
  price: { amount: '22.0', currency_code: 'GBP' },
  total_item_price: { amount: '23.8', currency_code: 'GBP' },
  brand: 'Vintage Dressing',
  size: 'M',
  status: 'Very good',
  favourite_count: 2,
  is_reserved: true,
};

export function page(
  items: RawWardrobeItem[],
  current: number,
  totalPages: number,
  totalEntries: number,
): RawWardrobeResponse {
  return {
    items,
    pagination: { current_page: current, total_pages: totalPages, total_entries: totalEntries, per_page: 96 },
  };
}
