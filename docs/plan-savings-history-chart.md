# Savings history chart — actual vs planned savings per month (Historia)

## Context

The Historia screen (`#/history`, `renderHistory` in `js/ui.js` ~line 980) is a bare
list of check-in rows plus a "Najdłuższa seria" footer. Each row already shows the
month's net savings and delta vs plan, but the *shape* of the user's discipline over
time — the streak as a trend — is invisible. This feature adds one line chart at the
top of Historia: **realnie odłożone vs zamrożony plan, miesiąc po miesiącu**, straight
from the check-in history.

This supersedes **Feature 3 (§5) of `plans/D-chart-ux.md`**, which was written before
the codebase moved on: chart builders now live in **`js/charts.js`** (L0 leaf, F29-tested,
no longer in ui.js), and the fullscreen-landscape mechanism shipped as the **`zoomable`
registry + `#chart-full` overlay** (see `docs/plan-fullscreen-landscape-charts.md`),
not the clone-based overlay batch D sketched. The engine math and placement decisions
from D §5 are preserved; everything about *how* it renders is re-planned against the
current tree. Batch D's tap-tooltips (Feature 2) are still unbuilt and remain out of
scope here.

Ships as a normal standalone release: **v1.16.0, committed in Polish**.

## Decisions (locked — do not re-derive)

- **Dual line via `chartSVG`, not bars.** Histories grow to many dozens of months;
  `chartSVG` decimates lines gracefully (`maxPoints`), while paired monthly bars at
  440 viewBox width become slivers. The brief is "streak as a *trend*" — a line shows
  that directly. `stackedBarSVG` is year-labeled and clamps negatives; wrong tool.
- **Placement: top of Historia, not Analiza.** The chart visualizes the check-in list
  rendered directly below it — same data, same screen, zero navigation — and Historia
  is where the streak already lives. Analiza → Przegląd already has the *cumulative*
  plan-vs-actual chart inside `planPerfCard`; a monthly variant there would crowd one
  card stack with two near-duplicate charts while Historia stays a bare list.
- **`planned` = the frozen `plannedSavingsSnapshot`, never a recomputed plan** —
  CLAUDE.md invariant: changing assumptions must not rewrite past months. The chart
  shows what the plan *said at the time*.
- **Months without entries are skipped, not zero-filled** — same semantics as
  `computeStreak` and `planVsActualStats.cumRows` (a gap neither breaks nor extends
  anything; the line connects across it). Note the x-axis is entry-index-based, so a
  gap compresses time — identical to the existing cumulative chart; acceptable.
- **`chartSVG` learns negative values.** Build months legitimately have `planned < 0`
  (the app renders „miesiąc budowy" banners for them) and deficit months have
  `net < 0`. Today `chartSVG` scales from 0 and negative points map *below* the plot
  area, off-canvas (which is exactly why the Analiza call site guards
  `cumRows.every(r => … >= 0)` — ui.js ~1111). Clamping or hiding would misrepresent
  precisely the months the user most needs to see. The extension is a strict no-op
  for all-≥0 data (byte-identical output — F29 stays green untouched).
- **No new files** → no `sw.js` `PRECACHE` change (only the release cache bump).
  The card builder goes into `analysis.js` (precedent: it already exports the shared
  `fireCell` consumed by simulation.js and `cumLegend()` which this card reuses).
- **No new CSS.** Series classes `line-port` / `line-target` and `.legend` markup
  already exist; a line dipping below the 0-axis needs no styling.

## Step 1 — `js/engine.js`: `monthlySavingsHistory(entries)`

New pure function in the „Analiza (tabele i statystyki)" section, next to
`planVsActualStats` (~line 1146). Polish doc comment, repo style:

```js
// Historia oszczędzania miesiąc po miesiącu — realnie odłożone vs zamrożony plan.
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

Conventions already established elsewhere (listed so nobody re-derives them):
`net` uses `roundGrosze` exactly like `planVsActualStats`; input array is not mutated
(spread before sort); `rate` mirrors `savingsStats` (`null` when `earned` is 0);
`delta`/`rate`/`verdict` ride along for future tooltip/summary use — only `ym`,
`net`, `planned` feed the chart today.

## Step 2 — `js/charts.js`: negative-domain support in `chartSVG`

Two touches, both no-ops when `min === 0`:

1. **Scale** (replace the `max`-only scan and `y`):

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

   Parity proof: for all-≥0 data `min` stays 0, `Math.max(v, 0) === v`, the old
   all-zero guard `max <= 0 → max = 1` coincides with `max <= min → max = min + 1`,
   and `(x − 0) / (max − 0)` is bit-identical to `x / max` in IEEE — so every
   existing chart's output string is unchanged. (For all-negative data old and new
   outputs differ, but no such call site exists and the old one drew off-canvas.)

2. **Axis** — `yAxisSvg` gains a trailing `min = 0` param. When `min < 0`, **append**
   (after all existing entries, so the string prefix is untouched at `min === 0`)
   one faint gridline at `y(min)` and one label `formatShort(min)`:

   ```js
   if (min < 0) {
     lines.push(`<line class="axis" x1="${padL}" y1="${y(min)}" x2="${W - padR}" y2="${y(min)}" opacity=".4"/>`);
     labels.push(`<text x="${padL - 4}" y="${y(min) + 3}" text-anchor="end">${formatShort(min)}</text>`);
   }
   ```

   The solid axis stays at `y(0)` — with negatives present it visibly floats above
   the bottom, which is the whole point. The `max/2` (and detail `max/4`, `3·max/4`)
   gridlines keep their *values*; their labels stay truthful. `formatShort` already
   handles negatives (`formatShort(-2000)` → `-2 tys.`). `chartSVG` passes `min`
   through; **`stackedBarSVG` is untouched** (it clamps to ≥0 by design and is not
   used here — pass nothing, its `yAxisSvg` call keeps the default `min = 0`).

Update the module header comment (it promises byte-parity at defaults — still true;
mention the negative domain in one clause).

## Step 3 — `js/analysis.js`: `savingsHistoryCard`

Pure builder next to `planPerfCard`, reusing the module-local `kv`-style idiom and
the existing `cumLegend()` (its „odłożone / plan" swatches match the series classes
used below exactly):

```js
// Karta Historii: wykres miesiąc po miesiącu (realnie odłożone vs zamrożony plan).
export function savingsHistoryCard({ chartHTML }) {
  if (!chartHTML) return '';
  return `<div class="card"><h2>Miesiąc po miesiącu 📈</h2>
    <p class="muted small">Każdy punkt to jeden check-in: linia pokazuje, ile według
    planu miało się odłożyć i ile realnie się udało. Miesiące bez wpisu są pomijane.</p>
    ${chartHTML}
    ${cumLegend()}
  </div>`;
}
```

Copy is a draft — match coach.js warmth at implementation time. Polish UI copy only;
no user data is interpolated, so no `esc()` needed inside the card itself.

## Step 4 — `js/ui.js`: call site in `renderHistory`

At the top of `renderHistory` (before `view().innerHTML = …`), mirroring the
Analiza cumulative-chart pattern (ui.js ~1112):

```js
const hist = E.monthlySavingsHistory(state.entries);
const chartCard = hist.length > 1
  ? An.savingsHistoryCard({
      chartHTML: zoomable('hist-plan', 'Miesiąc po miesiącu: odłożone vs plan',
        o => chartSVG(hist, [
          { get: r => r.planned, cls: 'line-target' },
          { get: r => r.net,     cls: 'line-port' },
        ], o), { legendHTML: An.cumLegend() }),
    })
  : '';
```

then prepend `chartCard` to the existing `view().innerHTML` template. Notes:

- `hist.length > 1` guard: a 1-point line is meaningless; with 0–1 entries the card
  simply doesn't render (same rule as the cumulative chart's `cumRows.length > 1`).
- **No ≥0 guard** — that's what Step 2 exists for. Do *not* copy the
  `every(r => … >= 0)` condition from the Analiza call site.
- `zoomable` key `'hist-plan'` is stable per place; `renderHistory` re-renders on row
  expand (`histExpanded` toggle) and the registry entry is overwritten, not
  duplicated — that's the registry's documented contract.
- Draw order: `planned` first, `net` second, so the accent-colored actual line sits
  on top of the dashed muted plan line — same order as the cumulative chart.
- The fullscreen overlay works with zero extra code: `zoomable` re-invokes the
  closure with `{ width: 800, height: …, detail: true, maxPoints: 240 }`, and the
  legend rides in via `legendHTML`.
- The „Najdłuższa seria" footer stays where it is.

## Step 5 — tests (`tests/test-engine.js`)

No fixture-file additions — build inputs inline like F25/F29 (the `entry()` helper
at the top of the file already fabricates check-in entries).

**F29f–g (append to the charts block):**

- `F29f: chartSVG — domena ujemna (min < 0): 4 osie, etykieta min, brak NaN`.
  Rows with e.g. `a ∈ {1000, −1000}` → assert 4 `class="axis"` lines, a
  `>−1 tys.</text>`-style min label (use the local `fmtShort` replica), no `NaN`,
  purity (two calls identical). With symmetric data (min = −max) the 0-axis line
  lands at the vertical midpoint of the plot area — for defaults
  `y(0) = 10 + 0.5·140 = 80`, so assert the first axis line has `y1="80"`.
- `F29g: chartSVG — parytet przy min = 0 (strażnik bajt-w-bajt)`.
  All-≥0 rows → output has exactly 3 axis lines and no negative label; this pins the
  no-op claim from Step 2 alongside the untouched F29a.

**F30 (new block `// ── F30: historia oszczędzania miesiąc po miesiącu ──`):**

- `F30a: mapowanie i sortowanie` — three entries pushed **out of order** with known
  `earned/spent/plannedSavingsSnapshot/verdict`; assert ascending `ym`, exact `net`
  (assertClose ±0.005), `planned`/`verdict` passthrough, `delta = net − planned`.
- `F30b: rate — null przy zerowym dochodzie, ułamek przy dodatnim` — `earned: 0` →
  `rate === null`; `earned: 8000, spent: 6000` → `rate ≈ 0.25`.
- `F30c: miesiąc budowy — ujemny plan, ujemny net` — freeze a negative snapshot via
  a real `applyCheckIn` on a house-plan state during a build month (pattern from the
  F6 negative-plan tests) with `spent > earned`; assert both signs and exact `delta`.
  This is the row the negative-domain chart exists for.
- `F30d: czystość` — deep-copy entries before the call, `JSON.stringify` equal after;
  two calls identical; `[]` → `[]`.
- `F30e: zamrożony snapshot, nie przeliczony plan` — `applyCheckIn`, then change
  `state.assumptions.monthlyIncome` + `recomputeDerived`; assert `planned` of the
  existing row still equals the original snapshot.

Run `node tests/run-tests.js` — all pre-existing tests (F29a is the parity canary)
plus the new ones must be green.

## Step 6 — manual QA (Node can't cover ui.js)

Serve locally (`python -m http.server 8000`) **and** do the `/FIRE/` subpath
rehearsal; unregister the SW / "Update on reload" first (CLAUDE.md gotcha). Then:

1. **Historia**: 0–1 entries → no chart card; ≥2 entries → card at top, list intact,
   row expand/edit/delete and „Dodaj wcześniejszy miesiąc" still work (the re-render
   keeps exactly one registry entry for `hist-plan`).
2. **Negative months**: with a build-month or deficit entry, the actual/plan line dips
   below the solid 0-axis and a negative label appears at the bottom left.
3. **Fullscreen**: ⛶ opens the overlay with title, denser labels, legend; rotation,
   Escape, ✕, backdrop and browser-back all close it (existing overlay QA list).
4. **Regression**: Pulpit, Analiza (all sections incl. both loan charts), Symulacja
   charts render pixel-identical (all-≥0 data → Step 2 is a no-op).
5. Both themes; 375 px width; touch targets unaffected.

## Step 7 — docs & release

- **CLAUDE.md**: extend the Tests paragraph — one sentence for F30 and the F29f–g
  additions, matching the existing style; append a clause to the `analysis.js`
  module bullet (it now also hosts the shared Historia card) and to the `charts.js`
  bullet (negative-domain support, still byte-parity at `min === 0`).
- **Release v1.16.0** (three places, must match): `sw.js` `CACHE = 'fire-v1.16.0'`,
  `index.html` footer, `js/ui.js` `APP_VERSION`. No new files → `PRECACHE` list
  unchanged. Tests green → subpath rehearsal → commit **in Polish**, e.g.
  `feat: wykres historii oszczędzania — odłożone vs plan miesiąc po miesiącu (v1.16.0)`.

## File-touch list

| File | Change |
|---|---|
| `js/engine.js` | add `monthlySavingsHistory(entries)` next to `planVsActualStats` |
| `js/charts.js` | `chartSVG` negative-domain scale; `yAxisSvg` optional `min` (appended line+label); header comment |
| `js/analysis.js` | add pure builder `savingsHistoryCard({ chartHTML })` |
| `js/ui.js` | `renderHistory`: compute history, `zoomable('hist-plan', …)`, prepend card; `APP_VERSION` bump |
| `tests/test-engine.js` | F29f–g (charts), F30a–e (engine) |
| `CLAUDE.md` | Tests paragraph + `analysis.js`/`charts.js` bullets |
| `index.html`, `sw.js` | version/cache bump only |

Suggested order: engine fn + F30 (green) → charts negative domain + F29f–g (green,
F29a untouched) → builder + call site → manual QA → CLAUDE.md → release bump.
