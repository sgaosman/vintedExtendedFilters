# Vinted Seller Filters: research and decisions

## Goal

A browser extension for Chrome, Edge and Firefox that adds the catalog page's full filtering to a Vinted seller's page (`/member/{id}`):

- price range (minimum and maximum)
- brand, size and condition
- colour, material and pattern
- category, plus the existing sort options

Vinted's own seller page can only filter by category and sort by relevance, price or newest.

All findings below came from manual DevTools testing on vinted.co.uk on 2026-10-11, logged in, using seller `57342735` (1,344 listed items) and item `7775580043`.

---

## 1. Endpoints

| Endpoint | Result | Notes |
|---|---|---|
| `GET /api/v2/wardrobe/{userId}/items?page&per_page&order&catalog_ids` | Works | The source of a seller's items. Needs a header (see 2). |
| `GET https://api.vinted.co.uk/svc-catalogue/items?...attribute_ids[...]` | Works | The catalog search. It has no seller filter (see 4). |
| `GET https://api.vinted.co.uk/svc-filters/filters?...` and `/svc-filters/faceted_categories?...` | Seen | Supply the catalog page's filter options. Not used. |
| `GET https://api.vinted.co.uk/item-details/more-items/{itemId}?content_source=other_user_items` | 200, 44 KB | Seller's other items on an item page. Has no colour or material, only the photo `dominant_color`. |
| `GET /api/v2/items/{id}` | 404 | Removed. |
| `GET /api/v2/items/{id}/details` | 403 (HTML page) | Blocked, even with the CSRF and anon-ID headers. |
| `GET /api/v2/items/{id}/plugins/attributes` | 400 "Feature 'attributes' doesn't exist" | The route exists but no plugin by that name. |
| `GET https://api.vinted.co.uk/item-details/plugins/{itemId}/{feature}` | Dead end | The newer form of the plugin route (`getSvcPluginsByFeature`, beside `getPluginsByFeature` → `/api/v2/items/{id}/plugins/{feature}`). Item pages are built from server-rendered "plugins" (`attributes`, `summary`, `description`, `gallery` and about 25 more). The client only calls these endpoints to refresh one plugin after an interaction: the item page made no plugins request on load, and `/api/v2/.../plugins/attributes` already returned "Feature 'attributes' doesn't exist". A console call for `gallery` failed its CORS preflight. Even if one worked, it would still be one request per item. |
| Vinted Pro Integrations API ([pro-docs.svc.vinted.com](https://pro-docs.svc.vinted.com/)) | Official, but not usable here | The only official Vinted API. Limited to "a limited set of allowlisted Vinted Pro businesses", uses HMAC-signed requests, and only manages the caller's own listings. It can't read another seller's items. |
| Third-party "Vinted APIs" (ScrapeBadger, ReefAPI, Apify, Scrappa and others) | Not used | Paid scraping services that wrap the same public endpoints. Their seller-items calls take no colour or material filter, and attribute data needs a separate per-item detail call. Using them would also send the user's browsing to a third party. |
| Batch item lookups (`item_ids`) | Not found | Script scan: `item_ids` only appears for offers (`/offers/request_options`) and bumps (`/vas/bumps/*`), neither of which returns attributes. |
| `GET /api/v2/catalog/items?...` | 404 | The old catalog endpoint, now moved to `svc-catalogue`. |
| `GET /items/{id}` (HTML) | 200, about 1,955 KB decompressed, brotli | The only place colour, material and pattern appear (see 5). |
| `GET /items/{id}` with header `RSC: 1` | 200, about 1,669 KB | The page's data without the surrounding HTML. Barely smaller, so not useful. |

## 2. Request headers

- A bare `fetch()` to the wardrobe endpoint returned **403** with an HTML page.
- The same request with Vinted's own headers returned **200**.
- **Either `x-anon-id` or `x-csrf-token` on its own is enough** for the wardrobe endpoint. All three combinations were tested.
- Where the extension can read them:
  - `x-anon-id`: the `anon_id` cookie, readable with `document.cookie`.
  - `x-csrf-token`: only in the page's embedded Next.js data, as `CSRF_TOKEN":"<uuid>"`. There's no cookie or meta tag for it.
- Requests to `api.vinted.co.uk` (svc-catalogue) are sent by the page with these headers:
  - `accept`
  - `locale: en-GB`
  - `platform: web`
  - `x-next-app: marketplace-web`
  - `x-anon-id`
  - `x-csrf-token`
  - `credentials: include`
- `tags.js`, almost certainly DataDome bot protection, wraps `window.fetch`.
- `ERR_BLOCKED_BY_CLIENT` on `/relay/events` was the user's ad blocker. It isn't relevant.

## 3. Wardrobe endpoint behaviour

- **The only server-side filter is `catalog_ids`.** These were all ignored:
  - `price_from`
  - `price_to`
  - `status_ids`
- **Colour parameters are ignored too.** `color_ids=9`, `color_ids[]=9` and `attribute_ids[color]=9` all returned the full 1,346 items (tested later the same day).
- **Parent categories include their subcategories.** `catalog_ids=2050` (Men's clothing) returned 880 of 1,346 items, while `catalog_ids=2533` returned 3. So one request per category can tag items with their category.
- **The member page's Category dropdown makes no request** when opened (the only entry was an inline `data:` SVG chevron icon).

## 3a. The seller's category tree is embedded in the member page

The member page's Next.js flight data (the `self.__next_f.push([1,"…"])` scripts) contains **two** category trees:

| Tree | Shape | Example |
|---|---|---|
| Site-wide catalog | `{"id","title","url","catalogs":[…]}` | every Vinted category |
| **This seller's tree** | `{"id","title","code","photo","catalogIds":[…],"depth","itemCount","catalogs":[…],"parentId"}` | Men (878) › Outerwear (43) › Coats (4) › Overcoats & long coats (3) |

The seller's tree is the one with `itemCount`, which is this seller's item count in each category. It only lists categories the seller has items in. The extension finds it by looking for `"itemCount":` and parsing the enclosing object (`src/vinted/categoryTree.ts`).

Two details of the payload that the parser has to handle (the first version got both wrong, which put subcategories at the top level next to "Women"):

- **Long `catalogIds` lists.** A top-level node's `catalogIds` lists every descendant id. For "Men" that list was long enough that a fixed 4,000-character look-back from `itemCount` missed the start of the node. The parser now walks back with no limit to the nearest `{"id":N,"title":"`.
- **Repeated copies.** The same categories appear more than once, including nested nodes on their own. The parser keeps only nodes that aren't a descendant of another node it found.

Vinted's own dropdown shows exactly three top-level entries for this seller (Women 460, Men 880, Kids 5, total 1,345), and the panel should match. No extra request is needed when the page was loaded directly. After navigating within the site from another seller, the data on the page belongs to a different seller, so the extension fetches `/member/{id}` once instead.

Other keys seen near it: `catalogTree`, `catalogs`, `catalogIds`, `is_catalog_moderator`, `is_catalog_role_marketing_photos`.
- **`per_page` is capped at 96.** Asking for 200 returned 96. This seller takes 14 pages, so about 20 seconds at 1.5 seconds per request.
- `order` accepts `relevance`. The member page's other sort options presumably map to other `order` values, but these weren't tested because the extension sorts in the browser.
- The response has `items[]` and `pagination { current_page, total_pages, total_entries, per_page, time }`.

**Fields on each item**, verified from a real response:

| Field | Example | Use |
|---|---|---|
| `id` | `7775580043` | Key. Assumed to increase over time, so it's used for "Newest first". |
| `title` | "Vintage 90s blue purple…" | Text search |
| `price.amount` | `"20.0"` (a string) | Price filter and sort |
| `total_item_price.amount` | `"21.7"` | Price including the buyer protection fee |
| `currency` / `price.currency_code` | `GBP` | Display |
| `brand` | "Rodeo" | Brand filter (display label, no ID) |
| `size` | "M", "XXL" | Size filter (display label, no ID) |
| `status` | "Very good" | Condition filter (display label, no ID) |
| `path` / `url` | `/items/7775580043-…` | Link, and the URL to fetch for details |
| `photos[].thumbnails[]` | `thumb310x430` and others | Card image |
| `photos[].dominant_color` | `#4F5D95` | Approximate colour. Often picks up the background. |
| `is_reserved`, `is_closed`, `is_hidden`, `is_draft` | booleans | Availability |
| `favourite_count` | `4` | Display |

**Missing fields:** colour, material, pattern, category (`catalog_id`) and upload timestamp.

**Brand is whatever the seller tagged.** Several items say "Angelo Litrico" or "Klepper" in the title but are tagged "Vintage Dressing". Text search on titles covers this.

## 4. The catalog search has no seller filter

The current catalog search is `api.vinted.co.uk/svc-catalogue/items` (`page`, `per_page=96`, `time`, `search_text`, `order`, and `attribute_ids[catalog|size|brand|status|color|patterns|material]`). To select more than one value, separate them with commas, for example `attribute_ids[color]=9,22`. Blue is colour `9`.

Seller-filter test results (colour 9, baseline 960 results from 20 different sellers):

| Parameter | Result |
|---|---|
| `user_id`, `user_ids`, `seller_id` | Ignored. The same 960 mixed results. |
| `attribute_ids[user]`, `attribute_ids[user_id]` | 0 results. Unknown attribute names make the search return nothing. |

Two further limitations:

- Every catalog search stops at 960 results, so the seller's matches can't be found by paging through it.
- Catalog items only carry `item_box` display text, with no brand, size or colour fields.

**Conclusion:** Vinted can't filter one seller's items by colour, material or pattern on its servers.

## 5. Where colour, material and pattern come from

The item page makes no item-detail API call. Its Vinted calls are only:

- `info_banners`
- `offers/request_options`
- `business_accounts/{id}/terms`
- `more-items`

The attributes are in the server-rendered HTML, in rows with stable `data-testid` names:

| `data-testid` | Text read from the page |
|---|---|
| `item-attributes-size` | "Size / M" |
| `item-attributes-status` | "Condition / Very good" |
| `item-attributes-material` | "Material / Polyester, Nylon" |
| `item-attributes-color` | "Colour / Blue, Purple" |
| `item-attributes-upload_date` | "Uploaded / 9 months ago" |
| `item-attributes-brand-menu-button`, `*-faq-link` | Controls, not attributes |

Other details:

- **Pattern:** it only appears on some items or categories. The item tested had no pattern row.
- **Structured data:** the page's JSON-LD `Product` block has `category` ("Men Overcoats & long coats") and only the **first** colour (`"color":"Blue"`). It has no material.
- **Where in the page:** in the streamed HTML, the attribute rows and JSON-LD appear about 909 KB into a 1,955 KB page, so the download can stop about halfway.
- **Parsing:** with `DOMParser`, `textContent` runs the label and value together ("ColourBlue, Purple"). The label and value have to be read from separate child elements.

## 6. Bot protection

After about 10 scripted requests in a few minutes, one `fetch('/items/7775580043')` returned a **20 KB gzip page with no attributes**. Normally the page is about 1,955 KB brotli. It was almost certainly a challenge page. Opening the same item normally in the browser still worked, so it affected scripted requests only, not the account.

Consequences for the design:

- Fetching item pages one by one carries the most risk. They should be fetched slowly, only when needed, and cached permanently.
- A challenge page has to be recognised: no `item-attributes-` rows, or a 403 or 429 status. Fetching must then stop rather than retry.

## 7. Other notes

- **The browser's list of network requests fills up.** It holds about 250 entries, and the ad and tracking calls use it up quickly, so later calls are missing from `performance.getEntriesByType('resource')`. Use the Network tab to see them.
- **The catalog page's first load shows no search call.** Vinted renders it on the server, and the browser only calls the search once a filter changes.

---

## Decisions

### D1: Filter in the browser using the wardrobe API

Vinted can't filter a seller's items server-side (sections 3 and 4). The extension pages through the wardrobe at 96 items per request, about 1.5 seconds apart, and filters and sorts in memory. This instant tier covers price, brand, size, condition, title search and all four sorts.

### D2: Colour, material and pattern are an opt-in tier that reads item pages

Item pages are the only source (section 5). Fetching them is expensive and the most likely to be blocked (section 6), so:

- **Only on request.** Nothing is fetched until the user clicks "Load details". The button shows how many items it will fetch and roughly how long it will take.
- **Only for items still showing.** Pages are fetched only for items that pass the instant filters. The list is recalculated before each fetch, so narrowing the filters mid-run takes effect straight away.
- **Slow and one at a time.** One request runs at a time, about 2.5 seconds apart with random variation.
- **Partial downloads.** Each page is read as it streams in, and the download stops once the end of the main content (`</main>`) has been read and attribute rows were found.
- **Permanent cache.** Results are cached per item, since these attributes rarely change.
- **Stops when blocked.** If a 403 or 429 comes back, or a page has no attributes, fetching stops and the panel says why. The user can resume, and the wait between requests then doubles.
- **Options built from the data.** Colour, material and pattern options come from the details fetched so far. This works on every Vinted country site without a fixed list of IDs.
- **Speed ceiling.** At about 2.5 seconds per item, this seller's 1,345 items take about 55 minutes. Fetching them all in 3 minutes would need about 7.5 requests a second. That isn't attempted: no endpoint returns attributes for more than one item (section 1), and late in a day of testing even Vinted's own `api.vinted.co.uk/tracking-events/batch` call started getting 403s. The way to short runs is narrowing first (category) and permanent caching.
- **Not parallel.** Requests stay one at a time. The limit is how often Vinted accepts requests, not how long each one takes, so parallel requests would only raise the rate that triggers DataDome (section 6).
- **Category is not in this tier.** The first version read category from each item page's JSON-LD. D3 replaced that with something much cheaper.

### D3: Category is an instant-tier filter backed by `catalog_ids`

Wardrobe items have no category field, but the endpoint filters by `catalog_ids` on the server, including subcategories (section 3). The seller's category tree and counts are already on the member page (section 3a). So:

- **The panel shows Vinted's own tree** for this seller, with Vinted's counts. Nested levels can be expanded.
- **Ticking a category** sends `catalog_ids={id}` wardrobe requests, one per 96 items in that category (3 items means 1 request, 878 items means 10). The returned item ids become the category filter. No item pages are fetched.
- **Several categories** are combined (an item matching any of them is shown). Requests run one after another.
- **Cache:** membership is cached for 30 minutes per seller and category, the same as the wardrobe.
- **Detail fetching waits** while a selected category is still loading, so it never fetches pages for items the category is about to exclude.
- **Starting selection from Vinted's own filter:** a `PerformanceObserver` on resource entries watches the URLs of the page's own wardrobe requests. If the user has picked a category in Vinted's dropdown, the panel starts with it ticked. The observer leaves the page's `fetch` (and DataDome's wrapper) untouched, and the extension skips URLs it fetched itself.
- **Fallback:** if the tree can't be found, the category section says so and everything else still works.

**What this replaced:** first, a single category scope copied from Vinted's dropdown. Then category was read from each item page's JSON-LD at one request per item.

### D4: Run inside the page (`world: "MAIN"`)

The content script runs in the page's own context. Its requests then go through the same `fetch` as Vinted's code, including the DataDome wrapper. They carry the same Origin, cookies and headers, and behave the same in Chrome and Firefox. A Firefox content script in its usual separate context makes requests on behalf of the extension, not the page.

What this changes:

- **No extension APIs.** The cache therefore uses the site's own **IndexedDB** (database `vinted-seller-filters`). It survives reloads and is lost if the user clears Vinted's site data.
- **Shadow DOM built by hand.** The UI's CSS is bundled as a string.
- **No permissions.** The manifest requests none. `host_permissions` only limits which sites the script runs on.
- **Trusted Types.** If Vinted ever enforces them, parsing item HTML with `DOMParser` falls back to a named Trusted Types policy. The parsed document is inert, so none of its scripts run.
- **Safe text.** All seller text is inserted with `textContent`, never `innerHTML`.
- **Minimum browser versions:** Chrome or Edge 111+, Firefox 128+ (with Manifest V3).

### D5: A separate overlay panel, not changes to Vinted's markup

Vinted's class names are generated and change between releases, and the member page's markup wasn't examined. Instead, the extension shows a floating "Extended Filters" button on member pages. It opens a full-screen panel with its own filter sidebar and results grid.

- **Style isolation:** the panel lives in a Shadow DOM, so styles don't leak in either direction.
- **Vinted's page is left alone.** None of its elements are hidden or changed, so the only coupling is to the URL and the APIs.

### D6: Following page changes without reloads

Vinted is a Next.js single-page app. The script therefore runs on every page of the supported Vinted domains, from `document_start`, because it has to wrap `fetch` before Vinted uses it.

- **Detecting a member page:** it checks the URL (`/member/{id}`) every 500 ms, and on `popstate` events.
- **Button and panel:** they're added only after the page has finished loading, to avoid upsetting React's hydration.

### D7: Nothing loads until the panel is opened

Visiting a member page sends no requests. The full wardrobe loads when the panel is first opened. It's cached for 30 minutes per seller, category membership is cached for 30 minutes per category, and there's a Refresh button that reloads both.

### D8: Tooling

- **Build:** WXT 0.21.4 with Vite 8.2.2, producing Chrome, Edge and Firefox builds from one codebase. Firefox is built as Manifest V3 (`--mv3`) so it can use `world: "MAIN"`.
- **Language:** TypeScript 5.9.3.
- **Tests:** Vitest 4.1.11 with happy-dom 20.14.4, plus fake-indexeddb 6.2.5 for the cache tests.
- **UI:** plain TypeScript and DOM with no UI framework, to keep it small.
- **Versions:** all pinned exactly, each released at least two weeks before the build.

### D9: Supported domains

The script is limited to an explicit list of Vinted country domains: `www.vinted.{co.uk, fr, de, es, it, nl, be, at, lu, pl, cz, sk, lt, pt, se, dk, fi, hu, ro, hr, gr, ie, com}`. Browser address patterns can't use a wildcard for the country ending.

**Only vinted.co.uk has been tested.** The other domains are assumed to use the same API paths, which is likely but unconfirmed.

### D10: Not included in v1

- **Approximate colour from the photos' dominant colour.** It's unreliable because it often picks up the background.
- **Changing Vinted's own item grid.** Covered by D5.
- **Using `svc-catalogue`.** Covered in section 4.
- **Fetching faster than one item page every 2.5 seconds.** Covered in D2.

### D11: Approximate colour, material and pattern from titles

Many sellers put colours and fabrics in their titles. This seller writes "blue purple", "brown burgundy beige", "Pure wool", "striped" and "colour block". So until an item's details have loaded, the extension matches its title against a fixed English vocabulary (`src/core/titleGuess.ts`):

- **Labels:** about 50 colour words, 30 materials and 15 patterns, mapped to Vinted UK's filter labels where known (for example cobalt → Blue, olive → Khaki, plaid → Checked). Guessed and real values therefore usually land on the same option.
- **Matching rules:**
  - Whole words only: "Redwood" isn't red.
  - Multi-word phrases come first: "light blue" isn't also "blue".
  - The brand is removed first: "Red Herring" isn't red.
  - "Colour block" counts as a pattern, not a colour.
- **A guess can only add an item, never rule one out.** An item whose title mentions the selected value is shown straight away with a "From title" badge, and the summary counts these. An item whose title says nothing stays "not checked yet". Once its details arrive, the real values replace the guess either way.
- **Fetching order:** title-matched cards on screen are fetched first, so they get confirmed or removed quickly.
- **On by default,** with a checkbox to turn it off ("Use titles until details load"). It only works on English titles, so other country sites get few guesses and fall back to normal fetching.

### D12: Getting most runs down to a few minutes

Fetching speed is capped (D2), so a full first run for 1,345 items still takes about 55 minutes. The aim is to make that rare and to make results useful before it finishes:

- **Category first.** If "Load details" would take more than 3 minutes and no category is ticked, the panel suggests the largest categories that would finish within 3 minutes, using Vinted's own counts. Each suggestion shows its estimated time and ticks that category in one click. A category that's too big is replaced by its subcategories.
- **Keeps going in the background.** Fetching continues while the panel is closed, as long as the tab stays on the seller's page. The "Extended Filters" button shows "details: N left", or "details paused" after a block.
- **On-screen items first.** The queue fetches the cards currently shown before the rest. When a colour, material or pattern filter is active, it fetches the title-matched cards on screen, then items not checked yet.
- **Each item only once.** Details are cached permanently (D2), so a seller's later visits only fetch newly listed items.

### D13: Making category clicks feel instant

Measured with 1,345 synthetic items, filtering and option counting take about 1 ms and a full panel render about 20 ms. The 1 to 2 second delay after ticking a category is entirely the network request for that category's members (`catalog_ids`, D3), so the fixes are about when that request happens:

- **Start on hover.** Pointing at a category, or tabbing to it, starts loading its members. By the time it's clicked, the result is usually already there. It's the same single request the click would make, and only one prefetch runs at a time.
- **Reuse for a day if nothing's new.** Item ids increase over time, so if the wardrobe's highest id hasn't changed since a category was loaded, the seller hasn't listed anything and the cached membership is still complete. Items removed since then don't matter, because they no longer appear in the wardrobe. Membership is reused for up to 24 hours in that case, against the default 30 minutes.

### D14: Sellers whose page has no category list

Some seller pages show an empty Category dropdown and a Sort by that does nothing (seen on `/member/153786109`). It cleared by itself the next day, so it looks like a temporary problem on Vinted's side rather than a seller setting:

- **Category list:** the page then contained it (Women 682 › Shoes 677 › Boots 148 › Ankle boots 131, and so on).
- **Wardrobe requests:** they returned 200.
- **Category filtering:** `catalog_ids=13` returned exactly the 1 item Vinted's count promised.

This seller's tree differs from the first seller's in one way: `photo` is an object (`{"url":"…/WOMEN_ROOT.png","thumbnails":[]}`) rather than `null`. The parser handles both, and a regression test covers it. Two causes are possible: Vinted didn't include the seller's category list, or Vinted's own wardrobe request failed (the 403s seen late in testing would do it). The extension now tells these apart:

- **No list in the page:** the category section says the filter isn't available for this seller. Everything else still works, because the full wardrobe is loaded separately.
- **Request refused (403 or 429):** it says Vinted wants a verification check, and Refresh retries the list.
- **A selected category fails to load:** a notice says whether it was refused or just failed, and how to retry.

---

## Risks and open questions

- **Changes on Vinted's side:**
  - The wardrobe endpoint or its required headers may change.
  - The `item-attributes-*` names or the JSON-LD may change.
  - All Vinted-specific code lives in `src/vinted/` so fixes stay small.
- **Bot protection:** blocks during detail fetching could become stricter. The extension stops when blocked, but heavy use may still trigger challenges.
- **Terms of service:** Vinted's terms restrict automated access. Low-volume personal use at a human pace is low risk. Publishing the extension widely is a bigger risk.
- **Pattern rows:** their `data-testid` name hasn't been seen yet. It's assumed to start with `item-attributes-pattern`, and any key starting with `pattern` is accepted.
- **Category tree format:** the tree is found by its `itemCount` key in the Next.js flight data (section 3a). If Vinted renames that key or stops embedding the tree, the category section shows "unavailable" and the other filters keep working.
- **Picking up Vinted's own category choice:** this depends on the member page calling the wardrobe endpoint from the page, which it did in testing. If that stops, the panel simply starts with no category ticked.

## Build, install and verify

```
npm install
npm test            # unit tests (parsers, filters, queue, cache, panel)
npm run build:all   # .output/chrome-mv3, edge-mv3, firefox-mv3
```

**Loading the extension:**

- **Chrome or Edge:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, click "Load unpacked" and choose `.output/chrome-mv3` (Chrome) or `.output/edge-mv3` (Edge).
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and choose `.output/firefox-mv3/manifest.json`. This lasts until Firefox restarts.

**Live checks (none of these have been run yet):**

1. Open a member page. An "Extended Filters" button should appear in the bottom-right corner. On any other page it should not.
2. Open the panel. Items should load in batches of 96, and the count should match the seller's listing count, minus hidden or closed items.
3. Set a price range and pick a brand, size and condition. Results should update instantly, and the chips and option counts should match.
4. The Category section should show the same tree and counts as Vinted's own dropdown. Ticking a category should show only its items after about 1 to 10 requests, with no item-page requests in the Network tab. Choosing a category in Vinted's own dropdown before opening the panel should leave that category ticked.
5. Before loading any details, open Colour. Options should already appear from titles. Tick one and check that the cards carry a "From title" badge.
6. With no category ticked, the details box should suggest categories with times of 3 minutes or less. Click one, then "Load details". Colour and material should match the item pages, the "From title" badges should disappear as details arrive, and the run should keep going (shown on the "Extended Filters" button) after the panel is closed.
7. Reload the page and reopen the panel. Items and details should come from the cache with no new item-page requests (check the Network tab).
8. Firefox: repeat steps 1 to 3, mainly to confirm that `world: "MAIN"` works.
