// Injected into the panel's shadow root, so none of it leaks into Vinted's page
// and Vinted's CSS can't reach in (RESEARCH.md D5).
export const STYLES = `
:host {
  all: initial;
  --vsf-bg: #ffffff;
  --vsf-surface: #f5f6f7;
  --vsf-border: #d9dcde;
  --vsf-text: #171717;
  --vsf-muted: #5f6368;
  --vsf-accent: #007782;
  --vsf-accent-text: #ffffff;
  --vsf-warn-bg: #fff4e5;
  --vsf-warn-text: #7a4100;
  --vsf-focus: #005a63;
  color-scheme: light;
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: var(--vsf-text);
}
@media (prefers-color-scheme: dark) {
  :host {
    --vsf-bg: #1b1c1d;
    --vsf-surface: #26282a;
    --vsf-border: #3c4043;
    --vsf-text: #ececec;
    --vsf-muted: #a8adb3;
    --vsf-accent: #3bb3bd;
    --vsf-accent-text: #0b1d1f;
    --vsf-warn-bg: #3a2a12;
    --vsf-warn-text: #ffd59a;
    --vsf-focus: #7fd6dd;
    color-scheme: dark;
  }
}
*, *::before, *::after { box-sizing: border-box; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--vsf-focus); outline-offset: 2px; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  padding: 10px 16px; border: 0; border-radius: 999px; cursor: pointer;
  background: var(--vsf-accent); color: var(--vsf-accent-text);
  font-weight: 600; box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
}
.launcher:hover { filter: brightness(1.08); }

.overlay {
  position: fixed; inset: 0; z-index: 2147483001;
  background: var(--vsf-bg); display: flex; flex-direction: column;
}
.overlay[hidden] { display: none; }

header.bar {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 16px; border-bottom: 1px solid var(--vsf-border);
}
header.bar h2 { font-size: 17px; margin: 0; }
header.bar .spacer { flex: 1; }
.status { color: var(--vsf-muted); }

.btn {
  padding: 7px 12px; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--vsf-border); background: var(--vsf-surface);
}
.btn:hover:not(:disabled) { border-color: var(--vsf-muted); }
.btn:disabled { opacity: 0.55; cursor: default; }
.btn.primary { background: var(--vsf-accent); color: var(--vsf-accent-text); border-color: transparent; font-weight: 600; }
.btn.link { border: 0; background: none; padding: 2px 0; color: var(--vsf-accent); text-decoration: underline; }

.body { flex: 1; display: flex; min-height: 0; }
aside.filters {
  width: 300px; flex: none; overflow-y: auto; padding: 12px 16px 24px;
  border-right: 1px solid var(--vsf-border); overscroll-behavior: contain;
}
main.results { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 16px; }

.group { border: 0; padding: 0; margin: 0 0 16px; min-width: 0; }
.group > legend, .group > .label { font-weight: 600; margin-bottom: 6px; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; }
.row > label { flex: 1; display: flex; flex-direction: column; gap: 2px; color: var(--vsf-muted); font-size: 12px; }
input[type="number"], input[type="search"], select {
  width: 100%; padding: 6px 8px; border-radius: 6px;
  border: 1px solid var(--vsf-border); background: var(--vsf-bg);
}
.check { display: flex; gap: 8px; align-items: center; margin: 4px 0; cursor: pointer; }

details.facet { border-top: 1px solid var(--vsf-border); padding: 8px 0; }
details.facet > summary { cursor: pointer; font-weight: 600; display: flex; gap: 6px; align-items: baseline; }
details.facet > summary .count { color: var(--vsf-accent); font-weight: 600; }
details.facet .hint { color: var(--vsf-muted); font-size: 12px; margin: 6px 0; }
.options { max-height: 240px; overflow-y: auto; margin-top: 6px; }
.options .check { justify-content: space-between; }
.options .check span.name { flex: 1; overflow-wrap: anywhere; }
.options .check span.n { color: var(--vsf-muted); font-variant-numeric: tabular-nums; }
.facet-search { margin-top: 6px; }
.tree { max-height: 360px; }
.tree-level { list-style: none; margin: 0; padding: 0; }
.tree-level .tree-level { padding-left: 18px; }
.tree-row { display: flex; align-items: center; gap: 2px; }
.tree-row .check { flex: 1; }
.tree-toggle, .tree-spacer { flex: none; width: 22px; height: 22px; }
.tree-toggle { border: 0; background: none; cursor: pointer; color: var(--vsf-muted); padding: 0; border-radius: 4px; }
.tree-toggle:hover { background: var(--vsf-surface); }

.notice {
  background: var(--vsf-warn-bg); color: var(--vsf-warn-text);
  border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;
}
.notice p { margin: 0 0 8px; }
.notice .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.details-box { background: var(--vsf-surface); border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; }
.details-box p { margin: 0 0 8px; }
progress { width: 100%; height: 6px; }

.summary { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
.summary .spacer { flex: 1; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px;
  border-radius: 999px; background: var(--vsf-surface); border: 1px solid var(--vsf-border); cursor: pointer;
}

ul.grid {
  list-style: none; margin: 0; padding: 0;
  display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
}
.card a { color: inherit; text-decoration: none; display: block; }
.card a:hover .title { text-decoration: underline; }
.card .img {
  aspect-ratio: 310 / 430; width: 100%; border-radius: 6px; overflow: hidden;
  background: var(--vsf-surface); position: relative;
}
.card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.card .badge {
  position: absolute; left: 6px; top: 6px; padding: 2px 6px; border-radius: 4px;
  background: rgb(0 0 0 / 0.7); color: #fff; font-size: 11px;
}
.card .badge.approx { left: auto; right: 6px; background: var(--vsf-warn-bg); color: var(--vsf-warn-text); }
.suggest { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.launcher-badge { font-weight: 400; }
.card .price { font-weight: 700; margin-top: 6px; }
.card .total { color: var(--vsf-muted); font-size: 12px; }
.card .meta { color: var(--vsf-muted); font-size: 12px; }
.card .title { font-size: 13px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.empty { color: var(--vsf-muted); padding: 40px 0; text-align: center; }
.more { display: flex; justify-content: center; margin: 20px 0; }

.filters-toggle { display: none; }
@media (max-width: 760px) {
  .filters-toggle { display: inline-block; }
  aside.filters { position: absolute; inset: 0; top: auto; height: 75%; z-index: 2; background: var(--vsf-bg); border-top: 1px solid var(--vsf-border); border-right: 0; }
  aside.filters:not(.open) { display: none; }
  .body { position: relative; }
}
@media (prefers-reduced-motion: no-preference) {
  .launcher { transition: filter 0.15s; }
}
`;
