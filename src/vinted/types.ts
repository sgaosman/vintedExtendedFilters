/** The subset of a `/api/v2/wardrobe/{id}/items` item that the extension reads (RESEARCH.md §3). */
export interface RawWardrobeItem {
  id: number;
  title: string;
  path?: string;
  url?: string;
  price: { amount: string; currency_code: string };
  total_item_price?: { amount: string; currency_code: string };
  currency?: string;
  brand?: string | null;
  size?: string | null;
  status?: string | null;
  favourite_count?: number;
  is_reserved?: boolean;
  is_closed?: boolean;
  is_hidden?: boolean;
  is_draft?: boolean;
  photos?: Array<{
    url?: string;
    is_main?: boolean;
    thumbnails?: Array<{ type: string; url: string }>;
  }>;
  user?: { login?: string };
}

export interface RawWardrobeResponse {
  items: RawWardrobeItem[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_entries: number;
    per_page: number;
  };
}

/** A wardrobe item normalised for filtering. */
export interface Item {
  id: number;
  title: string;
  /** Absolute item URL. */
  url: string;
  price: number;
  /** Price including Vinted's buyer protection fee. */
  totalPrice: number;
  currency: string;
  brand: string;
  size: string;
  condition: string;
  thumb: string;
  favourites: number;
  reserved: boolean;
  /** Position in Vinted's relevance order, used for the "Relevance" sort. */
  rank: number;
}

/** Attributes only available on the item page (RESEARCH.md §5). */
export interface ItemDetails {
  id: number;
  colors: string[];
  materials: string[];
  patterns: string[];
  /** From the page's JSON-LD Product, e.g. "Men Overcoats & long coats". */
  category?: string;
  /** Every `item-attributes-*` row as key → value text, for debugging and future filters. */
  attributes: Record<string, string>;
  fetchedAt: number;
  /** The item page returned 404/410 (sold or deleted). */
  gone?: boolean;
}

export type DetailFetchResult =
  | { kind: 'ok'; details: ItemDetails }
  | { kind: 'blocked'; reason: string };

/** Thrown when Vinted answers with a 403/429 or a challenge page instead of data. */
export class BlockedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'BlockedError';
  }
}
