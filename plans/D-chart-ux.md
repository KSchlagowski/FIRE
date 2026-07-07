# Batch D — Chart UX: fullscreen landscape, tap-to-inspect tooltips, savings-rate history chart

Target: implemented **after batches A/B/C/E** (see `plans/00-master-plan.md`). Batches A–E may
add new charts (percentile-band projection, comparison charts, annual-report visuals). All three
features below are built as **generic mechanisms inside the two chart generators**
(`chartSVG` / `stackedBarSVG` in `js/ui.js`) plus **one document-level delegated handler**, so
**every chart that exists at implementation time is covered automatically**. The implementer's
only per-chart work is a mechanical sweep adding Polish `label`s to series definitions at every
call site (section 6 lists the call sites known today; re-grep at implementation time).

Conventions binding this batch (from `CLAUDE.md` + master plan): no new runtime deps, no build
step, Polish UI copy, English docs, no version bump, no commits, any **new file** → `PRECACHE`
in `sw.js` (this plan adds **no new files**, so no `PRECACHE` change), `node tests/run-tests.js`
green, engine changes get fixtures.

---

## 1. Current state (verified against the code, 2026-07-06)

- **Chart generators live in `js/ui.js`** (allowed — CLAUDE.md lists "SVG chart generators" as
  ui.js responsibility): `chartSVG(rows, defs, { height = 170 })` (line chart, decimation to
  ≤120 points, `viewBox="0 0 440 170"`, `padL=48 padR=8 padT=10 padB=20`, scale floor at 0) and
  `stackedBarSVG(rows, segments, { height = 170 })` (stacked/grouped yearly bars, same viewBox
  conventions, negatives clamped to 0). Both return a raw `<svg class="chart">…</svg>` string,
  or `''` for empty rows. `ringSVG` (progress ring) is **not** a data chart — leave it untouched.
- **Data flow**: ui.js computes engine results, calls `chartSVG`/`stackedBarSVG`, and passes the
  resulting **string** as `chartHTML`/`barHTML`/`remainingBarHTML` params into the pure builders
  (`analysis.js` `simulation.js`), or interpolates it directly (dashboard, `renderHistory`).
  Builders never generate SVG themselves. **This plan does not change any builder signature** —
  the wrapper markup rides inside the string the builders already interpolate.
- **Row shapes**: every `chartSVG` call site today feeds rows with a `.ym` (`"YYYY-MM"`) field
  and (projection series) a boolean `.projected`; every `stackedBarSVG` call site feeds rows
  with a `.year` field (1-based loan/plan year). The tooltip payload relies on this: `ym` rows
  → title `Fmt.formatMonthName(ym)`; `year` rows → title `Rok ${year}`.
- **Overlay patterns already present**: `#modal` backdrop div in `index.html` +
  `showModal`/`closeModal` in ui.js (`.modal-backdrop` uses `--overlay`, z-index 60; `[hidden]`
  beats `display:flex` via explicit rule; Escape key handler; `route()` calls `closeModal()` so
  back-navigation never leaves a dead overlay). The fullscreen overlay mirrors this pattern with
  its own element and z-index 70. Toast is z-index 50.
- **Event pattern**: ui.js re-renders `#view` via `innerHTML` and attaches listeners per render.
  For chart interactions we instead install **one document-level delegated listener at startup**
  — it survives every re-render, covers every screen, and covers charts cloned into the
  fullscreen overlay. This is the key architectural choice; per-render wiring would have to be
  repeated in every renderer and would miss future charts.
- **Theme**: colors are CSS custom props defined in **three blocks** (`:root`, dark media query,
  `[data-theme="dark"]`; plus `[data-theme="light"]`). This plan needs **no new color props** —
  everything reuses `--card`, `--card2`, `--bg`, `--line`, `--muted`, `--text`, `--overlay`,
  `--shadow`, `--accent`, `--flame`, `--danger` and `opacity` (same trick as the existing
  `bar-*-ghost` classes, documented in styles.css ~line 305). **If the implementer does add a
  color prop, it must go into all three theme blocks** (`[data-theme="light"]` too, for parity).

Known call sites today (re-grep `chartSVG(|stackedBarSVG(` at implementation time — batches A–E
will have added more):

| # | Where (ui.js) | Generator | Series |
|---|---|---|---|
| 1 | `renderDashboard` debt hero (~line 708) | chartSVG | mortgage+family debt (real) |
| 2 | `renderDashboard` accumulation hero (~line 732) | chartSVG | target, portfolio (split) |
| 3 | `renderAnaliza` Przegląd cumulative (~1129) | chartSVG | cumPlanned, cumNet |
| 4 | `renderAnaliza` withdrawal (~1161) | chartSVG | endNominal, endReal |
| 5 | `renderAnaliza` die-with-zero (~1180) + live re-render (~1279) | chartSVG | endNominal, endReal |
| 6 | `renderAnaliza` Kredyty melt chart ×2 (~1212) | chartSVG | sched, over |
| 7 | `renderAnaliza` Kredyty P/I bars ×2 (~1220) | stackedBarSVG | principal, interest |
| 8 | `renderAnaliza` Kredyty remaining bars ×2 (~1233) | stackedBarSVG | 4 segments, 2 groups |
| 9 | `renderSymulacja` overpayment (~1384) | stackedBarSVG | 4 segments, 2 groups |
| 10 | `renderSymulacja` loan calculator (~1432) | stackedBarSVG | 4 segments, 2 groups |
| 11 | **new** `renderHistory` savings-rate chart (feature 3) | chartSVG | planned, net |

---

## 2. Generic mechanism: the chart wrapper + data contract

### 2.1 Generator signature changes (js/ui.js)

```js
export function chartSVG(rows, defs, { height = 170, interactive = true, getNote = null } = {})
export function stackedBarSVG(rows, segments, { height = 170, interactive = true } = {})
```

- `defs[i]` / `segments[i]` gain an **optional `label`** (Polish, short, lowercase — shown in the
  tooltip). A def/segment without `label` is drawn as before but **omitted from the tooltip**
  (escape hatch for purely decorative series, e.g. a future percentile band polygon whose values
  are already covered by the median line).
- `interactive: false` returns the bare `<svg>` exactly as today (escape hatch for any future
  non-interactive embedding, e.g. batch E report snippets). Default `true`.
- `getNote(row) → string|null` (chartSVG only): optional extra tooltip line per point — used by
  the savings-rate chart to show the verdict label (section 5).

### 2.2 Output wrapper

When `interactive` and `rows.length`, both generators return, instead of the bare svg:

```html
<div class="chart-wrap" data-chart="«esc(JSON.stringify(payload))»">
  <svg class="chart" …>…</svg>
  <button type="button" class="chart-fs-btn" data-chart-fs
          aria-label="Powiększ wykres na pełny ekran">⛶</button>
</div>
```

Empty rows still return `''`. The wrapper is what call sites already interpolate, so **no call
site changes are needed for the wrapper itself** (only the `label` sweep). Legends stay outside
the wrapper, directly after it, as today — the fullscreen code exploits that adjacency (3.2).

### 2.3 The `data-chart` payload (the declarative contract)

Built inside the generator from the same decimated points / bar rows it draws (so tooltip and
pixels can never disagree). Raw numbers, not preformatted strings — formatting happens in the
ui.js handler via `format.js` (keeps the attribute small and the pl-PL formatting in one place).

```js
// chartSVG (kind 'line'); one entry per decimated point:
{ kind: 'line',
  series: [{ label: 'portfel', cls: 'line-port' }, …],   // only defs that have a label
  pts: [{ x: 51.3, ym: '2027-03', p: 1,                  // x = SVG user-space x, p = projected?1:0
           n: 'werdykt: na planie',                      // only when getNote returns a string
           v: [123456.78, 98000.0] }, …] }               // v[i] ↔ series[i], (d.get(r) || 0), raw

// stackedBarSVG (kind 'bars'); one entry per row (bar slot):
{ kind: 'bars',
  series: [{ label: 'kapitał (kontrakt)', cls: 'bar-principal-ghost' }, …],
  pts: [{ x: 61.4, year: 1, v: [520000, 310000, 520000, 310000] }, …] }  // clamped ≥0, as drawn
```

- `x` uses the generator's own `x(i)` / slot-center math, rounded to 0.1 — the handler snaps taps
  to the nearest `x`, which makes the **entire plot area the hit target** (satisfies the ≥24px
  effective-hit-target requirement without 3px-wide per-point rects; 120 points over the 384px
  inner width would otherwise be untappable).
- `cls` is carried so the tooltip swatch can reuse the series color via CSS (section 7).
- The JSON goes through the existing `esc()` before landing in the attribute (quotes →
  `&quot;`; values are numbers/`"YYYY-MM"` strings/short Polish labels — safe either way, but
  esc() is non-negotiable for consistency with the module's escaping discipline).
- Size: ≤120 points × ≤4 series of raw numbers ≈ a few KB per chart — fine for an in-memory DOM.

### 2.4 ui.js delegation (all interaction glue in one place)

New ui.js section `// ── Wykresy: interakcje (pełny ekran + dotknięcie punktu) ──` after the
generators. `initChartInteractions()` is called **once** from `startApp` (idempotence guard).
It installs on `document`:

- **`click`** (works for taps and mouse):
  1. `e.target.closest('[data-chart-fs]')` → `openChartFullscreen(btn.closest('.chart-wrap'))`.
  2. `e.target.closest('[data-chart-close]')` → `closeChartFullscreen()`.
  3. `e.target.closest('.chart-wrap')` → `showChartTip(wrap, e)`.
  4. otherwise → `hideChartTip()` (tap anywhere else dismisses the tooltip).
- **`keydown`** Escape → `closeChartFullscreen()` (checked before the modal's own handler runs;
  both may coexist — each only acts if its overlay is open).

Module state (ui.js is the state layer, this is allowed): `let chartFsOpen = false;` plus the
tooltip elements are created/destroyed on demand (they die naturally with `innerHTML` re-renders
because they live **inside** `.chart-wrap`).

`route()` gains `closeChartFullscreen();` right next to the existing `closeModal();` — the same
"back-navigation must not leave a dead overlay" rule.

Coordinate mapping (works identically in the normal view and inside the rotated fullscreen
stage): map the tap to SVG user space with the CTM, never with manual `getBoundingClientRect`
math (which breaks under `transform: rotate`):

```js
const svg = wrap.querySelector('svg.chart');
const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
// p.x is in viewBox units (0..440) → snap to nearest payload pt by |p.x - pt.x|
```

Payload is parsed lazily once per wrapper and cached as an element property
(`wrap._chartData ??= JSON.parse(wrap.dataset.chart)`) — clones don't inherit properties, so the
fullscreen copy re-parses its own attribute (correct by construction).

---

## 3. Feature 1 — Fullscreen landscape charts

### 3.1 Decision: **clone, not re-render**

The overlay shows a **deep clone** (`wrap.cloneNode(true)`) of the tapped `.chart-wrap`.
Rationale: (a) SVG scales losslessly via `viewBox` + `preserveAspectRatio="xMidYMid meet"`, so
re-rendering at overlay size produces identical geometry; (b) the `data-chart` attribute is
cloned with the node, so **tooltips work in fullscreen with zero extra code** (same delegated
handler, same CTM mapping); (c) re-rendering would require a module-scope registry of
rows/defs keyed by chart id — new mutable state duplicating render inputs for no visual gain.
The clone keeps its `data-chart-fs` button; CSS hides it inside the overlay
(`.chart-fs .chart-fs-btn { display: none; }`).

**Legend**: if `wrap.nextElementSibling` exists and has class `legend`, clone it too and append
it under the chart inside the stage (this matches how every current call site lays out
chart-then-legend). If absent, show the chart alone. Fullscreen without a legend is acceptable,
never wrong.

### 3.2 Markup

Add to `index.html` (static, mirroring `#modal`; `index.html` is already precached — content
change only, no PRECACHE edit):

```html
<div id="chart-fs" class="chart-fs" hidden></div>
```

`openChartFullscreen(wrap)` fills it:

```html
<button type="button" class="chart-fs-close" data-chart-close aria-label="Zamknij pełny ekran">✕</button>
<div class="chart-fs-stage" role="dialog" aria-modal="true" aria-label="Wykres na pełnym ekranie">
  «cloned .chart-wrap»«cloned .legend, if any»
  <p class="muted small center">Dotknij wykresu, aby zobaczyć wartości.</p>
</div>
```

then: `fs.hidden = false; document.body.classList.add('no-scroll'); chartFsOpen = true;` and
focuses the close button (same focus discipline as `showModal`). A click on the stage itself
(`e.target === stage`, i.e. the backdrop padding around the chart) also closes.
`closeChartFullscreen()`: `hidden = true; innerHTML = ''; body.classList.remove('no-scroll');
chartFsOpen = false;`.

### 3.3 Rotation without `screen.orientation.lock()`

`lock()` is unavailable on iOS Safari, so the landscape effect is pure CSS: when the **viewport
is portrait**, the stage is sized `100dvh × 100dvw` and rotated 90° so the chart renders
landscape without OS rotation. When the viewport is already landscape (user rotated the phone,
or desktop), no transform applies.

```css
.chart-fs { position: fixed; inset: 0; z-index: 70; background: var(--bg); }
.chart-fs[hidden] { display: none; }
.chart-fs-stage {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: .5rem; padding: 1rem;
}
@media (orientation: portrait) {
  .chart-fs-stage {
    inset: auto; top: 0; left: 0;
    width: 100dvh; height: 100dvw;
    transform: rotate(90deg) translateY(-100%);
    transform-origin: top left;
  }
}
.chart-fs-stage .chart-wrap { width: min(94%, 1100px); }
.chart-fs-close {
  position: fixed;
  top: calc(.5rem + env(safe-area-inset-top));
  right: calc(.5rem + env(safe-area-inset-right));
  width: 48px; height: 48px; min-height: 48px; padding: 0;
  border-radius: 50%; font-size: 1.2rem; z-index: 2;
}
.chart-fs .chart-fs-btn { display: none; }
body.no-scroll { overflow: hidden; }
```

Transform math (verified: transforms compose right-to-left; `translateY(-100%)` then
`rotate(90deg)` around top-left maps the `100dvh × 100dvw` box exactly onto the portrait
viewport). The close button stays **outside** the stage, `position: fixed`, so it sits at the
physical top-right corner regardless of the emulated rotation — always reachable, 48×48.
Backdrop = `--bg` (a full page, not a dimmed veil) for maximum chart readability; works in both
themes because it's a theme var. Tooltips opened inside the stage rotate with it (they are
children of the cloned wrapper), so their text matches the chart orientation — correct.

Note for the implementer: `getScreenCTM()` includes ancestor CSS transforms in all current
browsers, which is exactly why 2.4 mandates it. Verify on iOS Safari during manual checks
(section 9); if a legacy WebKit quirk surfaces, the fallback is to detect
`.chart-fs-stage`-ancestry and swap axes manually — do not silently ship broken fullscreen taps.

---

## 4. Feature 2 — Tap-to-inspect tooltips

### 4.1 Behavior

Tap anywhere on a chart → tooltip for the **nearest point/bar by x** (payload `pts`), plus a
1px vertical rule at that x for orientation. Tap another spot → tooltip moves. Tap outside any
chart → dismissed. Screen re-render (navigation, seg-tab switch, slider input replacing a
`#…-result` container) destroys it naturally because it lives inside the replaced DOM. Works
identically in the fullscreen overlay (same delegated handler, cloned `data-chart`).

### 4.2 Tooltip markup (built in ui.js with `textContent`/`createElement` — no innerHTML with
data, XSS-safe even though the payload is app-generated)

```html
<div class="chart-tip" role="status">
  <div class="chart-tip-title">marzec 2027 <span class="muted">(prognoza)</span></div>
  <div class="chart-tip-row"><i class="sw line-port"></i><span>portfel</span><b>123 457 zł</b></div>
  <div class="chart-tip-row"><i class="sw line-target"></i><span>cel ruchomy</span><b>98 000 zł</b></div>
  <div class="chart-tip-note">werdykt: na planie</div>   <!-- only if pt.n present -->
</div>
<div class="chart-tip-rule"></div>
```

- Title: `kind === 'line'` → `Fmt.formatMonthName(pt.ym)` + suffix `(prognoza)` when `pt.p`;
  `kind === 'bars'` → `Rok ${pt.year}` (matches the existing loan-year axis semantics).
- Values: `Fmt.formatPLN(v)` (0 decimals — consistent with axis labels and the analysis cards).
- Swatch `i.sw` gets the series `cls` and a CSS background mapping (section 7) so its color
  always matches the drawn line/bar in both themes.

### 4.3 Positioning (must not overflow the 480px viewport)

Both elements are appended to the tapped `.chart-wrap` (which is `position: relative`).
Convert the snapped SVG x to wrapper pixels: `px = pt.x / 440 * svg.clientWidth`
(the svg fills the wrapper width; in the rotated stage `clientWidth` is the pre-transform layout
width — correct, because the tooltip is positioned in the same transformed coordinate space).
Then:

1. append the tooltip hidden, measure `offsetWidth`,
2. `left = clamp(px − tipWidth/2, 4, wrap.clientWidth − tipWidth − 4)`, `top = 0`
   (tooltip hugs the top padding band of the chart; charts are 170 SVG-units tall so vertical
   placement is not worth per-point logic),
3. rule: `left = px`, `top = 0`, `bottom = 20/height*100%` — a fixed approximation of `padB` is
   fine; simplest correct version: `top: 0; bottom: 12%;`.

Clamping to the wrapper guarantees no overflow: wrappers live inside `.card` inside the 480px
`#app` column, and inside the fullscreen stage they're ≤94% of the stage.

### 4.4 Hit-target statement

There are deliberately **no per-point SVG hit rects**. The whole plot area is one hit surface
with nearest-x snapping, so the effective target per point is `plotWidth / nPoints` but a tap
anywhere lands on *some* point — strictly better than the ≥24px minimum for reachability. The
`.chart-fs-btn` (48×48) overlaps the chart's top-right corner; the tap handler checks
`[data-chart-fs]` **before** the `.chart-wrap` branch, so the button always wins over the
tooltip in its own area.

---

## 5. Feature 3 — Savings-rate history chart (actual vs planned per month)

### 5.1 Engine: new pure function (js/engine.js, in the „Analiza (tabele i statystyki)" section,
next to `planVsActualStats`)

```js
// Historia oszczędzania miesiąc po miesiącu — realne odłożone vs zamrożony plan.
// Czysta funkcja wpisów: [{ ym, net, planned, delta, rate, verdict }] rosnąco po ym.
// planned = plannedSavingsSnapshot (niezmiennik: zmiana założeń nie przepisuje przeszłości).
export function monthlySavingsHistory(entries) {
  return [...entries]
    .sort((x, y) => (x.month < y.month ? -1 : 1))
    .map(e => {
      const net = roundGrosze(e.earned - e.spent);
      return {
        ym: e.month,
        net,
        planned: e.plannedSavingsSnapshot,
        delta: roundGrosze(net - e.plannedSavingsSnapshot),
        rate: e.earned > 0 ? net / e.earned : null,
        verdict: e.verdict,
      };
    });
}
```

Math notes (all already-established conventions, listed so nobody re-derives them):
`net` uses `roundGrosze` exactly like `planVsActualStats`; `planned` is the **frozen snapshot**,
never a recomputed plan (invariant from CLAUDE.md); months without entries are **skipped**, not
zero-filled (same semantics as `computeStreak` — a gap neither breaks nor extends anything; the
line simply connects across it); `rate` is net/earned or `null` when `earned === 0` (mirrors
`savingsStats`); input array is not mutated (spread before sort).

### 5.2 Rendering: dual line via `chartSVG` (decision) + negative-domain support

**Dual line, not paired bars.** Reasons: (a) histories grow to many dozens of months — paired
bars at 440 viewBox width become ~3px slivers, while `chartSVG` already decimates lines
gracefully; (b) the feature's goal is "streak as a *trend*", which a line shows directly;
(c) `stackedBarSVG` labels/titles are year-based and would need reworking for monthly data.

**`chartSVG` must learn negative values** — build months legitimately have `planned < 0`
(the app renders "miesiąc budowy: plan zakłada niedobór" banners), and bad months have
`net < 0`. Clamping to 0 would misrepresent exactly the months the user most needs to see.
Minimal change to the scale (a no-op for every existing all-≥0 chart):

```js
let max = 0, min = 0;
for (const r of pts) for (const d of defs) {
  const v = d.get(r) || 0;
  if (v > max) max = v;
  if (v < min) min = v;
}
if (max <= min) max = min + 1;
const y = v => padT + (1 - (Math.min(Math.max(v, min), max) - min) / (max - min)) * (H - padT - padB);
```

Axis/gridlines: solid axis stays at `y(0)`; faint line at `y(max)` with label `formatShort(max)`;
when `min < 0` the third faint line moves from `y(max/2)` (label `formatShort(max/2)`) to
`y(min)` (label `formatShort(min)`); when `min === 0` output is **byte-identical to today**
(verify manually, section 9). `formatShort` already handles negatives.

Call site (ui.js `renderHistory`, chart above the rows list, only when ≥2 entries):

```js
const hist = E.monthlySavingsHistory(state.entries);
const chart = hist.length > 1 ? chartSVG(hist, [
  { get: r => r.planned, cls: 'line-target', label: 'plan' },
  { get: r => r.net,     cls: 'line-port',   label: 'odłożone' },
], { getNote: r => `werdykt: ${verdictLabel(r.verdict)}` }) : '';
view().innerHTML = An.savingsHistoryCard({ chartHTML: chart, n: hist.length }) + /* existing card */;
```

(`verdictLabel` is already imported in ui.js from coach.js.)

New pure builder in **`analysis.js`** (decision: no new module — a fourth builder file would
need a `PRECACHE` entry and SW cache-bump churn for one card; `analysis.js` already exports the
shared `fireCell` consumed by simulation.js, so hosting a shared history card there has
precedent; it stays a pure string builder either way):

```js
export function savingsHistoryCard({ chartHTML, n }) {
  if (!chartHTML) return '';   // <2 entries → no card at all
  return `<div class="card"><h2>Plan vs rzeczywistość 📊</h2>
    <p class="muted small">Każdy miesiąc z historii: ile planowałeś odłożyć i ile realnie
    odłożyłeś. Dotknij wykresu, aby zobaczyć dokładne kwoty.</p>
    ${chartHTML}
    <div class="legend"><span><i style="background:var(--accent)"></i>odłożone</span><span><i style="background:var(--muted)"></i>plan</span></div>
  </div>`;
}
```

### 5.3 Placement decision: **Historia (top of `#/history`), not Analiza**

Justification: the chart is a visualization *of the check-in list rendered directly below it* —
same data, same screen, zero navigation; Historia is where the streak already lives ("Najdłuższa
seria" footer), and the feature's brief is "make the streak visible as a trend"; Analiza →
Przegląd already carries the *cumulative* plan-vs-actual chart (`planPerfCard`) — putting the
monthly variant there would crowd one card-stack with two near-duplicate charts while Historia
stays a bare list. Batch F (IA cleanup) can revisit; record this in `docs/features/D.md`.

---

## 6. Label sweep (per-call-site Polish tooltip labels)

Add `label` to every def/segment. For charts present today (extend the sweep to any chart
batches A–E added — the rule: labels match the adjacent legend text where a legend exists):

| Call site | Labels (in def order) |
|---|---|
| Dashboard debt melt | `kredyt + dług rodzinny (realnie)` |
| Dashboard portfolio vs target | `cel ruchomy`, `portfel` |
| Analiza cumulative | `plan (narastająco)`, `odłożone (narastająco)` |
| Analiza withdrawal & die-with-zero (both call sites incl. the live `#dwz-result` re-render) | `saldo (nominalnie)`, `saldo (realnie)` |
| Analiza melt charts (mortgage & family) | `sama rata`, `z nadpłatami` |
| Analiza P/I bars | `kapitał`, `odsetki` |
| Analiza remaining bars / Symulacja overpayment / Symulacja loan calc (identical 4-segment shape, 5 call sites) | `odsetki (kontrakt)`, `kapitał (kontrakt)`, `odsetki (z nadpłatami)`, `kapitał (z nadpłatami)` — in the loan-calculator tab use `(z nadpłatą)` |
| Historia savings chart | `plan`, `odłożone` |

Percentile-band chart from batch A: label the drawn lines (`mediana`, `optymistycznie (p90)`,
`pesymistycznie (p10)` — adjust to whatever batch A shipped); if the band is a filled `<path>`
def-type that chartSVG grew in batch A, either give the band no `label` (omitted from tooltip)
or extend the payload the same way the lines work. Do not skip the sweep — an unlabeled series
silently disappears from tooltips.

---

## 7. styles.css additions (single file, mobile-first)

All colors via existing vars — **no new custom props, no theme-block edits** (see section 1).
Append one commented section:

```css
/* ── Wykresy: fullscreen + tooltip (batch D) ── */
.chart-wrap { position: relative; }
.chart-fs-btn {
  position: absolute; top: 0; right: 0;
  width: 48px; height: 48px; min-height: 48px; padding: 0;
  border: none; background: transparent; color: var(--muted);
  font-size: 1.05rem; opacity: .8;
}
.chart-tip {
  position: absolute; z-index: 5; pointer-events: none;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  box-shadow: var(--shadow); padding: .45rem .6rem;
  font-size: .75rem; max-width: 240px; white-space: nowrap;
}
.chart-tip-title { font-weight: 700; margin-bottom: .15rem; }
.chart-tip-row { display: flex; align-items: center; gap: .35rem; }
.chart-tip-row b { margin-left: auto; }
.chart-tip-note { color: var(--muted); margin-top: .15rem; }
.chart-tip .sw { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; }
/* Swatch = kolor serii (te same vary co linie/słupki — działa w obu motywach). */
.chart-tip .sw.line-port, .chart-tip .sw.line-proj { background: var(--accent); }
.chart-tip .sw.line-target, .chart-tip .sw.line-debt-dash { background: var(--muted); }
.chart-tip .sw.line-debt { background: var(--danger); }
.chart-tip .sw.line-cash { background: var(--warn); }
.chart-tip .sw.bar-principal { background: var(--accent); }
.chart-tip .sw.bar-interest { background: var(--flame); }
.chart-tip .sw.bar-principal-ghost { background: var(--accent); opacity: .35; }
.chart-tip .sw.bar-interest-ghost { background: var(--flame); opacity: .35; }
.chart-tip-rule {
  position: absolute; top: 0; bottom: 12%; width: 1px;
  background: var(--muted); opacity: .5; pointer-events: none;
}
```

plus the `.chart-fs*` / `body.no-scroll` block from section 3.3. Add a swatch rule for every
series class that exists at implementation time (batches A–E may have added classes — grep
`.chart .line-` / `.chart .bar-`).

---

## 8. Polish UI copy (draft, non-expert tone — match coach.js warmth, no jargon)

| Where | Copy |
|---|---|
| Fullscreen open button | glyph `⛶`, `aria-label="Powiększ wykres na pełny ekran"` |
| Fullscreen close button | glyph `✕`, `aria-label="Zamknij pełny ekran"` |
| Fullscreen stage aria-label | `Wykres na pełnym ekranie` |
| Fullscreen hint line | `Dotknij wykresu, aby zobaczyć wartości.` |
| Tooltip projected suffix | `(prognoza)` |
| Tooltip note (savings chart) | `werdykt: «verdictLabel»` (reuses coach.js labels: Rozjechane!, Na planie, Poniżej planu, Ciężki miesiąc) |
| History card heading | `Plan vs rzeczywistość 📊` |
| History card intro | `Każdy miesiąc z historii: ile planowałeś odłożyć i ile realnie odłożyłeś. Dotknij wykresu, aby zobaczyć dokładne kwoty.` |
| Legend entries | `odłożone` / `plan` |

(Verify `verdictLabel` strings against coach.js at implementation time rather than trusting the
table above.)

---

## 9. Tests + manual checks

### 9.1 Node tests (engine only — the generators and interaction glue live in ui.js, which the
Node runner never imports; do NOT try to import ui.js in tests)

New block in `tests/test-engine.js` + params in `tests/fixtures.js` under the **next free
F-number** (F27 as of this writing — batches A–E will have consumed numbers; renumber to the
next free and update the F-list paragraph in CLAUDE.md's Tests section accordingly, as every
batch does). Fixture object `FIX.F27 = { … }` with hand-computable entry values.

- `F27a: monthlySavingsHistory — mapowanie i sortowanie`: three entries pushed **out of order**
  (e.g. 2026-08, 2026-06, 2026-07) with known `earned/spent/plannedSavingsSnapshot/verdict`;
  assert output ascending by `ym`, and for each row exact `net` (assertClose ±0.005 — grosze),
  `planned` passthrough, `delta = net − planned`, `verdict` passthrough.
- `F27b: rate — null przy zerowym dochodzie, ułamek przy dodatnim`: entry with `earned: 0,
  spent: 500` → `rate === null`; entry with `earned: 8000, spent: 6000` → `rate` assertClose
  `0.25`.
- `F27c: miesiąc budowy — ujemny plan, ujemny net`: entry with `plannedSavingsSnapshot: -2000`
  (freeze it via a real `applyCheckIn` on a house-plan state during a build month, like the F6
  negative-plan tests) and `net < 0`; assert `delta` sign/value exact. This is the row the
  negative-domain chart exists for.
- `F27d: czystość — wejście nienaruszone, dwa wywołania identyczne`: deep-copy entries before
  the call, `assertEq(JSON.stringify(before), JSON.stringify(after))`; two calls
  `JSON.stringify`-equal. Empty array → `[]`.
- `F27e: zamrożony snapshot, nie przeliczony plan`: create an entry via `applyCheckIn`, then
  change `state.assumptions.monthlyIncome` and `recomputeDerived`; assert
  `monthlySavingsHistory(state.entries)[0].planned` still equals the original snapshot.

Run `node tests/run-tests.js` — must be green (all pre-existing tests plus the new block).

### 9.2 Manual checks (UI interactions are untestable in Node — this list is mandatory)

Serve locally (`python -m http.server 8000`) **and** do the subpath rehearsal
(`cd .. && python -m http.server 8000` → `http://localhost:8000/fire/`); unregister the SW /
"Update on reload" first (CLAUDE.md gotcha). Use DevTools device emulation at 375×812 plus at
least one real Android/iOS phone.

1. **Regression: geometry unchanged.** For every chart with all-≥0 data (all of today's), the
   drawn SVG must look identical to before (the negative-domain refactor is a no-op at
   `min === 0`; compare a saved screenshot or the SVG markup of the dashboard chart).
2. **Sweep**: grep `chartSVG(` and `stackedBarSVG(` — every call site has `label`s; open every
   screen/tab that renders a chart (Pulpit ×2 modes, Historia, Analiza ×4 sections incl. both
   loans, Symulacja „Nadpłata" + „Kredyt", plus every chart added by batches A–E) and confirm
   the ⛶ button and tap-tooltip on each.
3. **Tooltip**: tap left edge / right edge / middle — tooltip never clips outside the card
   (480px and 375px widths); values match the analysis tables for the same month; projected
   months show `(prognoza)`; bars show `Rok N`; tap outside dismisses; switching seg-tabs or
   moving a slider (Symulacja) leaves no orphan tooltip.
4. **Fullscreen**: opens from every chart; portrait phone → chart renders rotated 90°
   (landscape) and fills the screen; physically rotating the phone (OS auto-rotate on) →
   un-rotated fullscreen still correct; ✕ (48px), backdrop tap, Escape (desktop), and
   hash navigation (tap a tabbar item / browser back) all close it; body scroll locked while
   open and restored after; legend appears when the source chart had one.
5. **Tooltips inside fullscreen**: tap points in the rotated stage — snapping must hit the
   visually-nearest point (this validates the `getScreenCTM` mapping on iOS Safari
   specifically).
6. **Both themes**: repeat 3–5 in light and dark (`Plan → Aplikacja → Motyw`), checking tooltip
   swatch colors match the lines/bars.
7. **History chart**: with 0–1 entries → no card; with ≥2 incl. a negative-net or build month →
   line dips below the 0 axis, `min` label appears on the left axis, tooltip shows the verdict
   note.
8. **No regressions to non-charts**: check-in modal still opens/closes; `tests/tests.html`
   still loads through the HTTP server (SW navigation fallback untouched).

---

## 10. Exact file-touch list

| File | Change |
|---|---|
| `js/engine.js` | add `monthlySavingsHistory(entries)` in the analysis-stats section (near `planVsActualStats`) |
| `js/ui.js` | `chartSVG`/`stackedBarSVG`: negative-domain scale (chartSVG), `label`/`interactive`/`getNote` options, `.chart-wrap` + `data-chart` payload + ⛶ button; new section with `initChartInteractions` (delegated click/keydown), `showChartTip`/`hideChartTip`, `openChartFullscreen`/`closeChartFullscreen`; call `initChartInteractions()` in `startApp`; `closeChartFullscreen()` in `route()`; label sweep over all call sites; `renderHistory` computes `E.monthlySavingsHistory` + renders `An.savingsHistoryCard` |
| `js/analysis.js` | add pure builder `savingsHistoryCard({ chartHTML, n })` |
| `index.html` | add `<div id="chart-fs" class="chart-fs" hidden></div>` next to `#modal` |
| `styles.css` | append the batch-D block (section 7 + 3.3); no theme-block edits |
| `tests/fixtures.js` | `FIX.F27` (or next free number) input params |
| `tests/test-engine.js` | F27a–F27e; update the header comment if it enumerates F-blocks |
| `CLAUDE.md` | extend the Tests paragraph with the new F-block (one sentence, matching the existing style) |
| `docs/features/D.md` | short maintenance doc (mechanism summary, placement decision, sweep rule for future charts) + one line appended to `docs/INDEX.md` |

**No new files** → no `sw.js` `PRECACHE` change. **No version bump** (final release agent does
v1.14.0). **No commits** (working tree only, per master plan).

Suggested implementation order: engine fn + tests (green) → chartSVG negative domain (verify
no-op) → wrapper/payload + label sweep → delegation + tooltip → fullscreen overlay → history
card → styles → manual checklist → docs.
