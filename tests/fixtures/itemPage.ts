// Mirrors the structure observed on /items/7775580043 (RESEARCH.md §5): label and
// value in separate elements inside each data-testid row, plus a JSON-LD Product.
// Vinted's real class names are generated; these are placeholders.

export const ITEM_ATTRIBUTES_HTML = `
<div data-testid="item-attributes">
  <div data-testid="item-attributes-brand"><span>Brand</span><a href="/brand/rodeo"><span>Rodeo</span></a>
    <button data-testid="item-attributes-brand-menu-button"><svg><title>Brand menu</title></svg></button></div>
  <div data-testid="item-attributes-size"><div class="label">Size</div><div class="value"><span>M</span>
    <a data-testid="item-attributes-size-faq-link" href="#">?</a></div></div>
  <div data-testid="item-attributes-status"><div class="label">Condition</div><div class="value">Very good
    <a data-testid="item-attributes-status-faq-link" href="#">?</a></div></div>
  <div data-testid="item-attributes-material"><div class="label">Material</div><div class="value"><span>Polyester, Nylon</span></div></div>
  <div data-testid="item-attributes-color"><div class="label">Colour</div><div class="value"><span>Blue, Purple</span></div></div>
  <div data-testid="item-attributes-upload_date"><div class="label">Uploaded</div><div class="value"><span>9 months ago</span></div></div>
</div>`;

export const JSON_LD = `<script type="application/ld+json">{"@type":"Product","name":"Vintage 90s blue purple coat","brand":{"@type":"Brand","name":"Rodeo"},"offers":{"@type":"Offer","price":20,"priceCurrency":"GBP"},"category":"Men Overcoats & long coats","color":"Blue","@context":"https://schema.org"}</script>`;

export const ITEM_PAGE_HTML = `<!doctype html><html lang="en-GB"><head><title>Vintage 90s blue purple coat | Vinted</title></head>
<body><div id="__next"><main>${'<div class="filler"></div>'.repeat(50)}
${ITEM_ATTRIBUTES_HTML}
${JSON_LD}
</main><footer>${'<a href="/about">About</a>'.repeat(50)}</footer></div></body></html>`;

/** What a 20 KB challenge page looks like: valid HTML with none of the markers. */
export const CHALLENGE_HTML = `<!doctype html><html><head><title>Vinted</title></head><body>
<div class="site-container"><div class="content-box"><p>Please verify you are a human.</p></div></div></body></html>`;

export const PATTERNED_ATTRIBUTES_HTML = `<main>
  <div data-testid="item-attributes-color"><span>Colour</span><span>Black</span><span>,</span><span>White</span></div>
  <div data-testid="item-attributes-patterns"><span>Pattern</span><span>Striped</span></div>
</main>`;
