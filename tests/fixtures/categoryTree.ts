// Reconstructed from the member page's flight data for seller 57342735 (RESEARCH.md §3a).
// The page carries two trees: the site-wide catalog (no itemCount) and the seller's
// own tree (with itemCount). Only the second should be extracted.

const siteWideTree = {
  id: 1206,
  title: 'Outerwear',
  url: '/catalog/1206-outerwear',
  catalogs: [
    {
      id: 2051,
      title: 'Coats',
      url: '/catalog/2051-coats',
      catalogs: [
        { id: 1225, title: 'Duffle coats', url: '/catalog/1225-duffle-coats', catalogs: [] },
        { id: 2533, title: 'Overcoats & long coats', url: '/catalog/2533-overcoats-and-long-coats', catalogs: [] },
      ],
    },
  ],
};

const leaf = (id: number, title: string, code: string, itemCount: number) => ({
  id,
  title,
  code,
  photo: null,
  catalogIds: [],
  depth: 0,
  itemCount,
  catalogs: [],
  parentId: -1,
});

export const sellerTree = {
  id: 5,
  title: 'Men',
  code: 'MEN_ROOT',
  photo: null,
  // The real Men root lists every descendant id here (the paste ended "…,76,79,80]"),
  // which pushed its start more than 4,000 characters before "itemCount".
  catalogIds: Array.from({ length: 1500 }, (_, i) => 1000 + i),
  depth: 0,
  itemCount: 878,
  catalogs: [
    {
      id: 1206,
      title: 'Outerwear',
      code: 'MEN_OUTERWEAR_NEW',
      photo: null,
      catalogIds: [2051, 2553, 2052],
      depth: 0,
      itemCount: 43,
      catalogs: [
        {
          id: 2051,
          title: 'Coats',
          code: 'MEN_COATS',
          photo: null,
          catalogIds: [2533, 1227],
          depth: 0,
          itemCount: 4,
          catalogs: [leaf(2533, 'Overcoats & long coats', 'MEN_OVERCOATS_LONGCOATS', 3), leaf(1227, 'Parkas', 'MEN_PARKAS', 1)],
          parentId: -1,
        },
      ],
      parentId: -1,
    },
  ],
  parentId: -1,
};

const womenClothing = {
  ...leaf(4, 'Clothing', 'WOMEN_CLOTHING', 458),
  catalogs: [leaf(10, 'Dresses', 'WOMEN_DRESSES', 120)],
};

export const womenTree = {
  ...leaf(1904, 'Women', 'WOMEN_ROOT', 460),
  catalogs: [womenClothing],
};

export const kidsTree = leaf(1193, 'Kids', 'KIDS_ROOT', 5);

/** Flight text as the page's script would hold it after unescaping. */
export const FLIGHT_TEXT =
  `1:["$","div",null,{"catalogTree":[${JSON.stringify(siteWideTree)}],"title":"x \\" ]} tricky"}]\n` +
  `2a:["$","$L3",null,{"catalogs":[${JSON.stringify(womenTree)},${JSON.stringify(sellerTree)},${JSON.stringify(kidsTree)}],"catalogIds":[]}]\n` +
  // The same tree repeated later in the payload.
  `2b:["$","$L4",null,{"catalogs":[${JSON.stringify(sellerTree)}]}]\n` +
  // A nested node on its own (e.g. the selected path), which must not become a root.
  `2c:["$","$L5",null,{"selected":${JSON.stringify(womenClothing)}}]\n`;

/** Raw HTML with the flight text split across two push() calls, as Next.js does. */
export function memberPageHtml(): string {
  const mid = Math.floor(FLIGHT_TEXT.length / 2);
  const push = (chunk: string) => `<script>self.__next_f.push([1,${JSON.stringify(chunk)}])</script>`;
  return `<!doctype html><html><body><div id="__next"></div>${push(FLIGHT_TEXT.slice(0, mid))}${push(FLIGHT_TEXT.slice(mid))}</body></html>`;
}
