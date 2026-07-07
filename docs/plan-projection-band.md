# Projection band on „Portfel vs cel" (return ±1.5 p.p.)

## Context

Today the dashboard's „Portfel vs cel" chart draws **one** projected portfolio line —
false precision for a 20–40-year forecast. This feature draws a shaded
optimistic/pessimistic **band** around the projection so the user sees a range: the
same deterministic projection rerun with `realReturnAnnual ± 1.5 p.p.`

This is **Feature 6 of `plans/A-retirement-projection.md`** (decisions **D9**, §2.7,
§2.8, §5.4–§5.6, §7.9, F32), implemented **standalone** — per user decision the other
batch features (ZUS bridge, Barista, crash stress test) are still NOT built now.
Ships as a normal standalone release, **committed in Polish**.

**Version**: the working tree already contains the (uncommitted) bonds release
v1.14.0, and `docs/plan-expense-freeze-at-retirement.md` reserves v1.15.0. This plan
therefore targets **v1.16.0**. If the freeze has not shipped when this runs, take
**v1.15.0** instead and the freeze plan rebases to v1.16.0 — the two features are
independent (this one has **no schema bump and no persisted state**, so only the
version string interacts).

## No hard prerequisites — but check the tree first

Unlike the freeze plan, nothing here needs the bonds seam (`retirementOpts`) — the
band lives entirely in the **accumulation-phase** projection. Before starting:

- If the bonds work (v1.14.0) is still uncommitted, **commit it first** as its own
  release — don't mix the two diffs.
- Re-grep `chartSVG(` before touching it. Two other *proposed* plans modify the same
  function: `docs/plan-fullscreen-landscape-charts.md` (adds `width`/`maxPoints`/
  `detail` options) and `plans/D-chart-ux.md` (interactivity; it already anticipates
  this band at its lines 82 and 441–443). If either landed, the band changes below
  are the same in substance — adapt mechanically: use the function's current locals
  for `W`/decimation, and give the band def **no `label`** (or whatever "decorative,
  skip in tooltip" escape hatch D introduced) so tooltips ignore it.

## Locked semantics (Plan A D9 + §2.8 — do not re-derive)

- **D9 — honesty ranges, not percentiles.** The band is two deterministic reruns at
  `realReturnAnnual ± BAND_SPREAD` (1.5 p.p.), **no Monte Carlo, no randomness**.
  Copy calls it „pasmo" / „scenariusz lepszy/gorszy" — **never „percentyl"** (we did
  not compute a distribution, and the app must not pretend it did).
- **Band = portfolio only.** The target line, debt curves, cash are not banded.
- **Analysis-layer only.** `recomputeDerived`, the headline FIRE date, verdicts,
  streak — all byte-identical. The band is computed at render time on the Pulpit,
  never persisted (`state.derived` untouched).
- **Scope: the Pulpit „Portfel vs cel" card only.** The debt-phase dashboard chart
  and the Analiza charts do not get a band (Plan A §5.5 scoped it to Pulpit).
- **`stopAtFire:false` for both variants** — the optimistic path reaches FIRE
  earlier, and without this its series would truncate there and the band would
  collapse mid-chart. Both variants share the anchor and `plan` length, so series
  align 1:1 by index.
- **`lo`/`hi` via `Math.min`/`Math.max` per row** — defensive against crossings in
  the debt phase (with a negative-portfolio month a higher rate can make things
  *worse*, since growth multiplies a negative balance).
- **History months: `lo === hi === actual balance`, by construction** (see the
  correction below) — visually the band opens exactly where the projection starts.

## Correction to Plan A §2.8 (record this — it's the one non-obvious part)

Plan A sketched `projectionBand` as "rerun the full projection (`projectionWith`)
with `realReturnAnnual ± spread`" and asserted history months come out equal. That
is **wrong as written**: `replayBalances` applies `rPort = monthlyRate(a.realReturnAnnual)`
to **history months too** (js/engine.js:394 — balances between check-ins grow at the
assumed rate unless pinned by an override). A naive `projectionWith` rerun would make
the band falsely diverge on the user's *past*.

Therefore `projectionBand` must run the **base replay once** (user's real
assumptions — identical to what `recomputeDerived` produced) and vary the rate only
in the two `projectFire` calls. This is safe because everything `projectFire` takes
as input is rate-independent:

- `buildPlan` — income/expense growth, inflation, `fireTargetAt` (expenses ÷
  withdrawal rate); no `realReturnAnnual` anywhere;
- `replayDebt` / `replayFamilyLoan` — nominal loan mechanics + inflation only;
- the history `series` prefix inside `projectFire` maps over `balances.rows` and
  adds `target`/`debtReal`/`familyReal` from `fireTargetAt`/`inflationAnnual` —
  also rate-independent.

So sharing `plan`, `debt`, `family`, `balances` across the two variants gives
byte-identical history rows and a projection that diverges only from `upto+1` on.

## Step 1 — `js/engine.js`

1. **`projectFire` — additive `stopAtFire` option** (Plan A §2.7):

   ```js
   export function projectFire(state, plan, balances, debtRes, familyRes, uptoYm, opts = {}) {
   ```

   and at the FIRE-crossing check (currently `{ fireYm = ym; break; }`,
   js/engine.js:698):

   ```js
   if (!fireYm && houseSettled && famSettled && portfolio >= pm.targetReal - EPS) {
     fireYm = ym;
     if (opts.stopAtFire !== false) break;
   }
   ```

   Nothing else changes: post-FIRE months keep routing through the existing
   `invest` branch (debt settled, surplus → portfolio). Both existing call sites
   (`recomputeDerived` js/engine.js:1377, `projectionWith` js/engine.js:1003) pass
   no `opts` ⇒ default `stopAtFire = true` ⇒ zero behavior change anywhere.

2. **`projectionWith` — pass-through**:

   ```js
   export function projectionWith(state, { assumptions = {}, extraMonthlySavings = 0,
     extraSavings = null, stopAtFire = true } = {}, now = new Date()) {
     …
     return projectFire(st, plan, balances, debt, family, upto, { stopAtFire });
   }
   ```

3. **`BAND_SPREAD` + `projectionBand`** — new exports in the projection section
   (next to `projectionWith`; doc comment in Polish, matching neighbors):

   ```js
   export const BAND_SPREAD = 0.015; // ±1,5 pkt proc. na realReturnAnnual (D9)

   // Pasmo prognozy: deterministyczna koperta optymistyczna/pesymistyczna.
   // Jedna wspólna baza (plan + repliki na PRAWDZIWYCH założeniach — historia
   // sald zależy od realReturnAnnual, więc nie wolno jej przeliczać wariantem),
   // potem projectFire ±spread ze stopAtFire:false (optymistyczna ścieżka nie
   // urywa się na swojej wcześniejszej dacie FIRE). Historia: lo == hi == fakt.
   export function projectionBand(state, { spread = BAND_SPREAD } = {}, now = new Date()) {
     const upto = lastCompleteMonth(now);
     const plan = buildPlan(state);
     const debt = replayDebt(state, upto);
     const family = replayFamilyLoan(state, upto);
     const balances = replayBalances(state, upto, debt, family);
     const run = r => projectFire(
       { ...state, assumptions: { ...state.assumptions, realReturnAnnual: r } },
       plan, balances, debt, family, upto, { stopAtFire: false }).series;
     const r0 = state.assumptions.realReturnAnnual;
     const up = run(r0 + spread), down = run(r0 - spread);
     const rows = [];
     for (let i = 0; i < Math.min(up.length, down.length); i++) rows.push({
       ym: up[i].ym,
       lo: Math.min(down[i].portfolio, up[i].portfolio),
       hi: Math.max(down[i].portfolio, up[i].portfolio),
     });
     return { spread, rows };
   }
   ```

   Pure — the shallow copy pattern is the same as `projectionWith` (F15a purity
   precedent). Cost: two extra 720-month loops per dashboard render — negligible
   (Symulacja already runs `projectionWith` per input event).

Do NOT touch: `replayBalances`, `buildPlan`, `fireTargetAt`, `recomputeDerived`,
`retirementOpts` or any withdrawal-phase function — the band is accumulation-phase
and read-only.

## Step 2 — `js/ui.js`

1. **`chartSVG` — band def support** (Plan A §5.4). New def shape:
   `{ band: true, lo: r => …, hi: r => …, cls }`. Contract: rendering follows defs
   order, so the **caller puts the band def first** to paint it behind the lines.

   - max-scan (currently `max = Math.max(max, d.get(r) || 0)`):

     ```js
     for (const r of pts) for (const d of defs)
       max = Math.max(max, (d.band ? d.hi(r) : d.get(r)) || 0);
     ```

   - in the defs loop, a new first branch before `d.split`:

     ```js
     if (d.band) {
       const fwd = [], bwd = [];
       pts.forEach((r, i) => {
         const lo = d.lo(r), hi = d.hi(r);
         if (Number.isFinite(lo) && Number.isFinite(hi)) {
           fwd.push(`${x(i).toFixed(1)},${y(hi).toFixed(1)}`);
           bwd.unshift(`${x(i).toFixed(1)},${y(lo).toFixed(1)}`);
         }
       });
       if (fwd.length > 1) lines.push(`<polygon class="${d.cls}" points="${fwd.join(' ')} ${bwd.join(' ')}"/>`);
     } else if (d.split) { …
     ```

   The polygon uses the same decimated `pts` and `x(i)`/`y(v)` as the polylines, so
   it stays aligned. Rows without band values (non-finite) are skipped; fewer than
   2 usable points ⇒ no polygon. Non-band defs untouched — all existing call sites
   keep working. Note the y-scale now includes `hi`, so the chart max grows when the
   optimistic path outruns the base line — intended.

2. **`renderDashboard` — attach the band** (invest-phase branch, the „Portfel vs
   cel" card, js/ui.js:729–738). Replace the card body:

   ```js
   const rows = proj.series;
   if (rows.length > 1) {
     const band = E.projectionBand(state);
     const bandBy = new Map(band.rows.map(b => [b.ym, b]));
     const chartRows = rows.map(r => {
       const b = bandBy.get(r.ym);
       return b ? { ...r, bandLo: b.lo, bandHi: b.hi } : r;
     });
     html += `<div class="card"><h2>Portfel vs cel</h2>
       ${chartSVG(chartRows, [
       { band: true, lo: r => r.bandLo, hi: r => r.bandHi, cls: 'band-return' },
       { get: r => r.target, cls: 'line-target' },
       { get: r => r.portfolio, cls: 'line-port', clsProj: 'line-proj', split: true },
     ])}
       <div class="legend"><span><i style="background:var(--accent)"></i>portfel (— historia, ⋯ prognoza)</span><span><i style="background:var(--muted)"></i>cel ruchomy</span><span><i style="background:var(--accent);opacity:.25"></i>pasmo: zwrot ±1,5 pkt proc.</span></div>
       <p class="muted small">Pasmo pokazuje, jak prognoza się rozjeżdża, gdy rynek da o 1,5 punktu procentowego więcej albo mniej, niż zakładasz — im dalej w przyszłość, tym mniej pewna jest każda prognoza.</p>
     </div>`;
   }
   ```

   Copy is Plan A §7.9, ship-ready. The „±1,5 pkt proc." in the legend and explainer
   is the locked D9 value — if `BAND_SPREAD` ever changes, this copy must change with
   it (they are the same fact in two places; acceptable for a constant locked by D9).
   `band.rows` covers the full 720-month horizon while `proj.series` stops at
   `fireYm`, so every chart row gets its band values; the chart's x-domain is
   unchanged. History rows have `lo === hi` ⇒ the polygon degenerates to the line
   there and visually opens at the projection seam. The debt-phase branch
   („Krzywa topnienia długu") is NOT touched.

## Step 3 — `styles.css`

One rule next to the other `.chart` line classes:

```css
.chart .band-return { fill: var(--accent); opacity: .12; }
```

No new CSS custom property ⇒ the three-block rule (`:root` / dark media query /
`[data-theme="dark"]`) does not apply. `--accent` at 12% works on both themes.

## Step 4 — tests (run `node tests/run-tests.js` after; green before any UI work)

**F32 is the letter group reserved for this feature** by Plan A §6 (F29–F31 stay
reserved for ZUS/Barista/crash). No `baseState()` touch-up needed — nothing
persisted, no new assumptions.

1. **Fixture** (`tests/fixtures.js`): `F32: { spread: 0.015 }` + one header comment
   line (F32 — pasmo prognozy). Purpose: the test asserting
   `E.BAND_SPREAD === FIX.F32.spread` pins the D9 constant against accidental edits.
2. **New tests** (`tests/test-engine.js`), on `baseState()`-style states with the
   fixed `NOW` the F18+ suites use:
   - **F32a** `projectionWith` stopAtFire: `full = projectionWith(st, { stopAtFire: false }, NOW)`
     vs `base = projectionWith(st, {}, NOW)` — same `fireYm`, same
     `fireAge.totalMonths`, `reached` true; `full.series` longer and its last row's
     `ym` equals `E.addMonths(st.anchorMonth, E.HORIZON_MONTHS - 1)` (runs to plan
     end); prefix identity — for sampled indices `i` (0, mid, `base.series.length - 1`)
     `JSON.stringify(full.series[i]) === JSON.stringify(base.series[i])`; explicit
     `{ stopAtFire: true }` run deep-equals `base` (JSON).
   - **F32b** band shape + alignment: `band = E.projectionBand(st, {}, NOW)` —
     `band.spread === E.BAND_SPREAD === FIX.F32.spread`; `band.rows.length ===
     full.series.length` and `band.rows[i].ym === full.series[i].ym` for sampled i;
     every row `hi >= lo`; on every history row (`full.series[i].projected === false`)
     **strict equality** `band.rows[i].lo === band.rows[i].hi === full.series[i].portfolio`
     (this is the assertion that guards the §2.8 correction — a naive
     `projectionWith` rerun fails it whenever entries leave gaps for assumed growth).
   - **F32c** envelope: on a surplus-positive state (the F13b-style base), for every
     projected row `lo ≤ full.series[i].portfolio ≤ hi` (tolerance `1e-9` for float
     residue; `full` = the user's-rate `stopAtFire:false` run).
   - **F32d** edges + purity: `projectionBand(st, { spread: 0 }, NOW)` ⇒ every row
     `hi === lo`; `JSON.stringify(state)` identical before/after a `projectionBand`
     call (F15a-style purity); two identical calls return JSON-identical results
     (determinism).
3. The whole pre-existing suite must stay green with zero expected-number changes —
   `stopAtFire` defaults on, `projectionBand` is new code, nothing persisted.

## Step 5 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three places
(v1.16.0, or v1.15.0 per the note in Context): `sw.js` `CACHE = 'fire-v1.16.0'`,
`index.html` footer `FIRE Companion v1.16.0`, `js/ui.js` `APP_VERSION = '1.16.0'`.
No schema bump (`SCHEMA_VERSION` untouched — nothing persisted). Commit in Polish,
e.g.:
`feat: pasmo prognozy ±1,5 pkt proc. na wykresie „Portfel vs cel" (v1.16.0)`,
then push (release checklist).

## Verification

1. `node tests/run-tests.js` → exit 0; every pre-existing expected number unchanged
   (the headline regression claim: default `stopAtFire` ≡ legacy `projectFire`).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - Pulpit (invest phase, i.e. no active mortgage in the test data): „Portfel vs
     cel" shows a shaded band **behind** both lines, collapsed to the portfolio
     line over history and fanning out over the projection; legend has the third
     entry; explainer paragraph under the legend;
   - the FIRE date, verdict, streak and every other card are **identical** to
     before (band is analysis-layer only);
   - debt-phase dashboard (data with an active mortgage): „Krzywa topnienia długu"
     unchanged, no band;
   - Analiza / Symulacja charts unchanged;
   - dark and light theme: band visible but subtle in both (opacity .12 on
     `--accent`).
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the later batch)

- **§2.8 corrected**: `projectionBand` does NOT rerun `projectionWith` naively —
  `replayBalances` grows history months at `realReturnAnnual` (js/engine.js:394),
  so the band shares one base replay (`plan`/`debt`/`family`/`balances` computed
  once with the user's real assumptions) and varies the rate only in the two
  `projectFire` calls. This is what makes Plan A's own "history lo == hi"
  guarantee true. Keep this construction when the batch lands; F32b enforces it.
- `chartSVG` band contract nailed down: rendering follows defs order (caller
  prepends the band def) rather than a separate two-pass "bands first" scan —
  simpler and sufficient with a single band.
- Only Feature 6 ships; F29–F31 test letters and the remaining §5/§7 sections stay
  reserved. Version v1.16.0 (or v1.15.0 — see Context) is consumed by this
  standalone release.
- If `plans/D-chart-ux.md` ships later: give this band def no `label` so the
  tooltip skips it (D lines 441–443 already plan for that).
