# Chart tooltips / tap-to-inspect

## Context

Every data chart is a static inline SVG built by the pure builders in
`js/charts.js` (`chartSVG` / `stackedBarSVG`) and shipped around as a finished
string. The user can *see* the shape of a series but cannot read an exact value:
the Y axis shows only 3–5 `formatShort` ticks ("512 tys.", "2,1 mln") and the X
axis only a few years. The fullscreen-landscape overlay
(`docs/plan-fullscreen-landscape-charts.md`) made charts bigger; its "Out of
scope" list explicitly deferred *"tooltips / tap-to-read-value on data points —
separate feature"*. This is that feature.

**Tap (or press-and-drag) anywhere on a chart** → a vertical crosshair snaps to
the nearest data point (line charts) or year slot (bar charts) and a readout
shows the exact month/year and the exact PLN value of every series, formatted
with the app's canonical `formatPLN`. Works on the inline card charts **and**
inside the fullscreen overlay, including its CSS-rotated portrait mode. Scrubbing
horizontally moves the crosshair; lifting the finger leaves the readout in place;
tapping outside any chart dismisses it.

Nothing is persisted; no engine math changes. Touched layers: `charts.js` (emit
machine-readable point data + one pure hit-test helper), `ui.js` (pointer
handling + readout injection), `styles.css`, tests. No new files, no
`index.html` change.

## Locked decisions

- **D1 — The data rides inside the SVG, as a `data-tip` attribute on the
  `<svg>` root.** Charts travel through `analysis.js`/`simulation.js` as
  finished strings, so a registry-only approach in `ui.js` cannot know which
  points survived decimation — only `chartSVG` knows. Embedding a JSON payload
  (see D3) makes every rendered chart self-describing: the fullscreen overlay
  re-renders via the `zoomable` build closure at `maxPoints: 240` and the
  payload regenerates automatically, in sync with what is actually drawn. No
  pure-module signature changes; layering (`charts.js` stays a zero-import L0
  leaf) is untouched.
- **D2 — Opt-in via a new `label` field on defs/segments; unlabeled output is
  byte-identical.** `chartSVG` defs and `stackedBarSVG` segments gain an
  optional `label` (Polish, the readout name of the series). `data-tip` is
  emitted **only when at least one def/segment carries a `label`** — so the
  F29 fixtures (label-less `LINE_DEFS`/`BAR_SEGS`, `tests/test-engine.js:1854`)
  keep passing unchanged, and the "default output byte-identical" guarantee
  survives for any caller that doesn't opt in. All real call sites opt in (see
  inventory). Defs *without* a label in a mixed set are still drawn but excluded
  from the readout.
- **D3 — Payload format (grosze-rounded raw numbers, formatted only at display
  time).**

  ```js
  data-tip = esc(JSON.stringify({
    kind: 'line' | 'bars',
    x0, x1,          // plot area in viewBox units: padL, W − padR
    y0, y1,          // padT, H − padB (crosshair extent)
    labels: [...],   // per point: 'YYYY-MM' strings (line, post-decimation pts) or years (bars)
    series: [{ label, v: [...] }]   // v aligned with labels; Math.round(v*100)/100
  }))
  ```

  Raw numbers, not preformatted strings: `ui.js` already imports `format.js`
  and renders the readout with `Fmt.formatPLN` / `Fmt.formatMonthName`, keeping
  a single source of formatting truth (and the NBSP convention) while the
  payload stays compact (~6 KB worst case: 240 points × 2 series in
  fullscreen). Values mirror what is plotted: `Math.round((d.get(r) || 0) * 100) / 100`.
  Geometry (`x0/x1/y0/y1`) is embedded rather than duplicated as constants in
  `ui.js`, so a future padding change in `charts.js` cannot drift out of sync
  with hit-testing.
- **D4 — Hit-testing is a pure exported helper in `charts.js`, Node-testable.**

  ```js
  export function tipHit(tip, vx)   // → { i, cx } | null
  ```

  - `kind: 'line'`: `step = (x1−x0) / max(1, n−1)`; `i = clamp(round((vx−x0)/step), 0, n−1)`;
    `cx = x0 + i*step` (n = 1 → `i = 0`, `cx = x0` — matches how `chartSVG`
    places a single point).
  - `kind: 'bars'`: `slot = (x1−x0)/n`; `i = clamp(floor((vx−x0)/slot), 0, n−1)`;
    `cx = x0 + slot*(i+0.5)` (the bar-row center used by `stackedBarSVG`).
  - Returns `null` for an empty/malformed `tip`.

  `ui.js` (already an importer of `charts.js`) converts the pointer's client
  coordinates to viewBox coordinates and calls this — the math that must agree
  with rendering lives next to the rendering and under tests.
- **D5 — Client→viewBox mapping via the SVG's own CTM.**
  `svg.createSVGPoint()` + `pt.matrixTransform(svg.getScreenCTM().inverse())`.
  This transparently handles `width:100%; height:auto` scaling, the
  `preserveAspectRatio="xMidYMid meet"` letterboxing, **and** the fullscreen
  overlay's `.cf-rot` 90° CSS rotation — no orientation special-casing in the
  tap handler. **Fallback** (mirrors the fullscreen plan's D7 style): if some
  engine ignores CSS transforms in `getScreenCTM()` during QA, compute manually
  from `getBoundingClientRect()` and transpose when a `.cf-rot` ancestor is
  present — the handler is the only place that would change.
- **D6 — The readout renders *inside* the SVG, in viewBox units, injected by
  `ui.js` into the live DOM.** A `<g data-tip-layer>` containing: the vertical
  crosshair `<line>` from `y0` to `y1` at `cx` (lines) or a translucent
  full-height slot `<rect>` (bars), plus a text block — row 0 the period
  (`Fmt.formatMonthName(ym)` / `String(year)`), one row per series
  (`label: formatPLN(v[i])`) — over a backing `<rect>` sized with `getBBox()`
  after insertion and padded ~3 units. Because it lives in viewBox coordinates
  it survives CSS scaling and the rotated overlay for free; an HTML tooltip
  positioned in client coordinates would need rotation math and a positioned
  ancestor. Built with `createElementNS` + `textContent` (no string injection
  surface). No dots on the series lines in v1: `split` defs render as two
  polylines (history/projection) and reverse-mapping a global index into them
  buys little for the added complexity — crosshair + readout carries the value.
- **D7 — Readout anchors to the *opposite* half of the chart.** Crosshair on
  the left half → text block right-anchored at `x1`; right half → left-anchored
  at `x0 + 4`; vertical start `y0 + 10`, line height 12. Deterministic, never
  overlaps the crosshair, no measure-flip-remeasure loop. The worst case (4
  labeled segments on the remaining-to-pay bars → 5 rows ≈ 60 viewBox units)
  covers part of a 170-unit-tall inline chart — acceptable for a transient
  inspection layer, and negligible in fullscreen (H up to 620).
- **D8 — Interaction model: press shows, drag scrubs, release keeps, outside
  tap clears.** One **delegated `pointerdown` listener on `document`** (same
  pattern and same rationale as the existing chart-zoom click listener at
  `js/ui.js:215` — it survives every `innerHTML` swap of dynamic subtrees). On
  press over `svg.chart[data-tip]`: parse-and-cache the payload on the element,
  `setPointerCapture`, show the tip, update on `pointermove` (rAF-throttled),
  detach on `pointerup`/`pointercancel` leaving the tip visible. A press
  anywhere else clears the current tip (one module-scope ref, `clearChartTip()`).
  Re-renders — `route()`, slider/input result swaps, overlay `resize` re-render —
  destroy the tip together with the old markup; no teardown bookkeeping needed
  beyond nulling the ref.
- **D9 — `touch-action`: `pan-y` inline, `none` in the overlay.** Inline charts
  live in a vertically scrolling page: `.chart-zoom .chart { touch-action: pan-y }`
  keeps vertical scroll native while horizontal scrubs reach the chart. The
  fullscreen body doesn't scroll, and in the CSS-rotated portrait mode a
  *visually* horizontal scrub is a *physically* vertical gesture that `pan-y`
  would steal — so `.chart-full-body .chart { touch-action: none }`.
- **D10 — No new colors, no new files.** The tip layer reuses `--text`,
  `--card`, `--line`, `--muted` (all already defined in the three theme
  blocks); dark/light follow automatically. The zoom button (`⛶`, absolute
  top-right, *sibling* of the svg) is unaffected: it never matches
  `closest('svg[data-tip]')`, so tapping it clears any tip and opens the
  overlay as before.

## Series-label inventory (every def/segment gains `label`)

Labels are Polish, short, and mirror the existing legends. Shared builder
helpers mean only ~9 textual def arrays change for 13 chart sites:

| Site(s) | Where defs live | Series → `label` |
|---|---|---|
| `dash-dlug` | `ui.js` dashboard | `debtReal+familyReal` → `dług (realnie)` |
| `dash-portfel` | `ui.js` dashboard | `target` → `cel` · `portfolio` (split) → `portfel` |
| `an-plan-cum` | `ui.js` renderAnaliza | `cumPlanned` → `plan` · `cumNet` → `odłożone` |
| `an-wyplaty` | `ui.js` renderAnaliza | `endNominal` → `nominalnie` · `endReal` → `realnie` |
| `an-dozera` (×2: initial render + `#dwz-result` swap) | `ui.js` | same as `an-wyplaty` |
| `an-mtg-melt`, `an-fl-melt` | `meltChart` helper | `sched` → `sama rata` · `over` → `z nadpłatami` |
| `an-mtg-raty`, `an-fl-raty` | `piBars` helper | `principal` → `kapitał` · `interest` → `odsetki` |
| `an-mtg-dozaplaty`, `an-fl-dozaplaty` | `remainingBars` helper | `cInterest` → `odsetki (kontrakt)` · `cPrincipal` → `kapitał (kontrakt)` · `aInterest` → `odsetki (z nadpłatami)` · `aPrincipal` → `kapitał (z nadpłatami)` |
| `sym-nadplata` | `overpayResult()` closure | same 4 as remaining-to-pay above |
| `sym-kredyt` | `loanCalcResult()` closure | same 4 as remaining-to-pay above |

The three swap-rebuilt charts (`an-dozera`, `sym-nadplata`, `sym-kredyt`)
need nothing extra: their def arrays live inside the result closures, so the
fresh `data-tip` ships with every swap, and the delegated document listener
(D8) keeps working on the swapped markup.

## Step 1 — `js/charts.js`: `label`, `data-tip`, `tipHit`

Still a zero-import L0 leaf (grosze rounding is inlined, **not** imported from
`engine.js`).

1. **`chartSVG`**: after computing the decimated `pts`, when
   `defs.some(d => d.label)` build

   ```js
   const tip = { kind: 'line', x0: padL, x1: W - padR, y0: padT, y1: H - padB,
     labels: pts.map(r => r.ym),
     series: defs.filter(d => d.label)
       .map(d => ({ label: d.label, v: pts.map(r => Math.round((d.get(r) || 0) * 100) / 100) })) };
   ```

   and emit `<svg class="chart" ... data-tip="${esc(JSON.stringify(tip))}">`.
   No labels → attribute absent → output byte-for-byte as today.
2. **`stackedBarSVG`**: same shape with `kind: 'bars'`,
   `labels: rows.map(r => r.year)`, `Math.max(0, s.get(r) || 0)` for values
   (mirroring what is drawn), series order = segment order.
3. **`export function tipHit(tip, vx)`** as specced in D4.
4. Update the file-top comment (the module now also carries tap-to-inspect
   data; defaults *without* labels stay byte-identical).

## Step 2 — tests (new fixture group **F30**, `tests/test-engine.js`)

Pure string/value assertions, shared by the Node runner and `tests.html`.
Reuse the F29 `lineRows`/`barRows` fixtures; add labeled variants
`LINE_DEFS_L`/`BAR_SEGS_L`. A small local helper extracts the attribute and
reverses `esc()` (`&quot;` etc.) before `JSON.parse`.

1. **Opt-out parity**: label-less defs → output contains no `data-tip` and
   equals the labeled call's output with the attribute stripped… simplest
   form: assert `!svg.includes('data-tip')` for `LINE_DEFS`, and that F29a–e
   pass untouched (they do — their fixtures have no labels).
2. **Line payload**: 36-month rows, 2 labeled defs → parse `data-tip`; assert
   `kind === 'line'`, `x0 === 48`, `x1 === 432`, `y0 === 10`, `y1 === 150`,
   `labels.length === 36`, `labels[0] === '2026-01'`, series labels in def
   order, `v` values equal `get(r)` rounded to grosze.
3. **Decimation sync**: 500 rows at `maxPoints: 240` → `labels.length` equals
   the rendered polyline's point count (both come from the same `pts`).
4. **Bars payload**: 20-year rows, 2 labeled segments → `kind === 'bars'`,
   `labels` are the years, negative segment values clamp to 0 in `v` exactly
   as in the drawn rects.
5. **`tipHit` lines**: midpoints round to the nearer index; `vx < x0` → 0;
   `vx > x1` → n−1; `n === 1` → `{ i: 0, cx: x0 }`; `cx` equals the builder's
   `x(i)`.
6. **`tipHit` bars**: slot boundaries land in the correct bar; clamping at
   both ends; `cx` is the slot center; empty `labels` → `null`.
7. **Purity / hygiene**: two identical labeled calls → identical strings; no
   `NaN` in the payload; `esc`-round-trip preserves the JSON (quotes in
   attribute).

The pointer handling and readout injection are DOM (`ui.js`) — manual QA below,
not Node.

## Step 3 — `js/ui.js`: pointer glue + readout layer

All new code sits next to the chart-zoom block (`js/ui.js:134-202`); `tipHit`
joins the existing `charts.js` import.

### 3a. State + teardown

```js
let chartTipSvg = null;                 // svg element currently showing a tip

function clearChartTip() {
  if (!chartTipSvg) return;
  const g = chartTipSvg.querySelector('[data-tip-layer]');
  if (g) g.remove();
  chartTipSvg = null;
}
```

(If the svg was already re-rendered away, the ref is simply nulled — the layer
died with the old markup.)

### 3b. Delegated pointer handling (in `startApp`, next to the click listener)

```js
document.addEventListener('pointerdown', e => {
  const svg = e.target.closest('svg.chart[data-tip]');
  if (!svg) return clearChartTip();
  e.preventDefault();                   // no text selection while scrubbing
  if (svg !== chartTipSvg) clearChartTip();
  const tip = svg._tip || (svg._tip = JSON.parse(svg.dataset.tip));
  const move = ev => showChartTip(svg, tip, ev.clientX, ev.clientY);
  move(e);
  svg.setPointerCapture(e.pointerId);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerup', () => svg.removeEventListener('pointermove', move), { once: true });
  svg.addEventListener('pointercancel', () => svg.removeEventListener('pointermove', move), { once: true });
});
```

(`pointermove` may additionally be rAF-throttled; with ≤ 240 points and a
handful of nodes it is likely unnecessary — decide during QA.)

### 3c. `showChartTip(svg, tip, clientX, clientY)`

1. Client → viewBox: `const p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;`
   `const v = p.matrixTransform(svg.getScreenCTM().inverse());`
2. `const hit = tipHit(tip, v.x); if (!hit) return;`
3. Remove the previous `[data-tip-layer]` group; build a fresh
   `<g data-tip-layer>` via `createElementNS`:
   - **line**: `<line class="tip-x" x1=cx y1=tip.y0 x2=cx y2=tip.y1>`;
   - **bars**: `<rect class="tip-slot">` covering the slot
     (`x = x0 + slot*i`, `width = slot`, `y = y0`, `height = y1 − y0`);
   - readout texts (`class="tip-txt"`): row 0
     `kind === 'line' ? Fmt.formatMonthName(labels[i]) : String(labels[i])`,
     then per series `` `${s.label}: ${Fmt.formatPLN(s.v[i])}` `` — anchored
     per D7;
   - append, then measure the text block with `getBBox()` and insert a
     `<rect class="tip-bg">` (bbox + 3 units padding) *before* the texts.
4. `chartTipSvg = svg;`

### 3d. Hygiene

- `route()` needs **no** new teardown call: the tip layer lives inside the
  replaced markup. Adding `clearChartTip()` next to the existing
  `closeChartFull(...)` line anyway costs one line and keeps the module ref
  from pointing at a detached node — do it.
- `renderChartFullBody()` (overlay re-render on resize/rotate) replaces
  `innerHTML` — same story; the next tap starts clean.

## Step 4 — `styles.css`

Existing custom props only — nothing added to the three color blocks:

```css
.chart-zoom .chart { touch-action: pan-y; }        /* poziomy scrub, pionowy scroll strony */
.chart-full-body .chart { touch-action: none; }    /* nakładka nie scrolluje; D9 */
.chart .tip-x { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
.chart .tip-slot { fill: var(--muted); opacity: .15; }
.chart .tip-bg { fill: var(--card); stroke: var(--line); stroke-width: 1; opacity: .92; }
.chart text.tip-txt { fill: var(--text); font-size: 11px; }
.chart text.tip-txt:first-of-type { font-weight: 600; }
.chart-full-body .chart text.tip-txt { font-size: 13px; }  /* > 12px etykiet osi */
```

(`.chart text` currently sets `fill: var(--muted)` at 10px — the `tip-txt`
rules override both for legibility.)

## Step 5 — release

1. No new files → `PRECACHE` in `sw.js` unchanged; still bump
   `const CACHE` (contents of `js/charts.js`, `js/ui.js`, `styles.css` change).
2. Version bump in the usual three places (`sw.js`, `index.html` footer,
   `APP_VERSION` in `js/ui.js`). Target **v1.17.0** — if another planned
   feature lands first, take the next free minor (same convention as previous
   plans).
3. `node tests/run-tests.js` green (141 + F30).
4. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`).
5. While developing: unregister the SW / "Update on reload", or you'll test
   the stale cache.
6. Commit (Polish), e.g.
   `feat: dotknij wykresu, by odczytać dokładne wartości (v1.17.0)`.

## Step 6 — docs

- **CLAUDE.md**: extend the `charts.js` bullet (defs/segments accept `label`;
  labeled charts embed a `data-tip` payload + pure `tipHit` hit-testing;
  unlabeled output unchanged); mention the tap-to-inspect pointer glue in the
  `ui.js` bullet; append an F30 sentence to the Tests section.
- `docs/plan-fullscreen-landscape-charts.md` stays as-is (historical); its
  "Out of scope" tooltip bullet is superseded by this plan.

## Manual QA checklist (no Node coverage possible)

On a phone (installed PWA) and in desktop DevTools device mode:

- [ ] Tap each chart type once: dashboard line, Analiza cum/withdrawal/do-zera
      lines, melt lines, raty bars, do-zapłaty grouped bars, both Symulacja
      bars — crosshair/slot appears, readout shows Polish month or year +
      every labeled series with full `formatPLN` values.
- [ ] Values sanity-check against the Analiza tables for the same month/year.
- [ ] Scrub left–right: crosshair follows the finger, snaps per point/slot;
      readout flips sides at mid-chart; releasing keeps it; tapping the card
      text outside the svg clears it.
- [ ] Vertical page scroll still works when the gesture starts on an inline
      chart (touch-action `pan-y`).
- [ ] Dynamic swaps: change `#an-death-age`, the Nadpłata amount, Kalkulator
      kredytu fields — tapping the *new* chart reads the *new* data.
- [ ] Fullscreen overlay, auto-rotate **on** (true landscape): tap + scrub
      works, 13px readout.
- [ ] Fullscreen overlay, auto-rotate **off** (`.cf-rot` CSS rotation): tap
      lands on the correct point (D5 — if offsets appear on iOS, apply the D5
      manual-mapping fallback); scrubbing along the *visual* X axis works
      (touch-action `none`).
- [ ] Rotating the device with the overlay open re-renders the chart — old tip
      gone, next tap clean.
- [ ] Zoom button ⛶ still opens the overlay (tip cleared, no stray scrub).
- [ ] Readout legible in dark **and** light theme; backing rect covers the
      series lines beneath.
- [ ] Desktop: mouse press + drag scrubs; no text selection artifacts.
- [ ] Subpath rehearsal serve: spot-check the above under `/fire/`.

## Out of scope (explicitly not in v1)

- Hover (mouseover) tooltips without a press — pointer-down-only keeps one
  code path for touch and mouse; add a hover affordance later if desktop use
  grows.
- Dots/markers on the tapped line points (split hist/proj polylines make the
  y-lookup disproportionately fiddly — D6).
- Per-group totals or delta rows in the bars readout (e.g. "kontrakt razem X");
  v1 lists each labeled segment uniformly.
- Pinning multiple readouts / comparing two months side by side.
- Any keyboard navigation of data points (arrow-key stepping).
