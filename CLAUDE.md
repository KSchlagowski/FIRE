# CLAUDE.md — FIRE Companion

Notes for AI assistants working in this repo. Read this before touching code.

## What this is

Offline, private **PWA** that tracks a Polish user's progress toward **FIRE**
(Financial Independence, Retire Early). Zero dependencies, zero build step, zero
network calls beyond the app's own files. UI + all copy in **Polish**, money in
**PLN**. Data lives only in the browser's `localStorage`. Deployed on GitHub Pages
under a subpath: <https://kschlagowski.github.io/FIRE/>.

The authoritative design docs are **`plan-implementation-of-the-wild-frost.md`**
(implementation plan, locked decisions) and **`FIRE_App_Spec.md`** (original spec).
When a question isn't answered here, check the plan file first.

## Commands

```bash
node tests/run-tests.js      # engine test suite; exit 0 = all green (141 tests)
python -m http.server 8000   # serve at http://localhost:8000/ (SW works on localhost)
```

- **Browser test runner**: open `tests/tests.html` **through the HTTP server**
  (not file://), green/red list. Same assertions as the Node runner.
- **Subpath rehearsal** (catches absolute-path bugs exactly like GitHub Pages):
  serve the *parent* dir (`cd .. && python -m http.server 8000`) and open
  `http://localhost:8000/fire/` (or `/FIRE/`).
- **Regenerate icons**: `tools/make-icons.html` (open in browser, download PNGs)
  — icons are already committed; only rerun if changing the design.

## Architecture

**Ten ES modules under `js/`** (loaded via `<script type="module" src="js/app.js">`)
plus a single hand-written **`styles.css`** at the repo root. No build step, no
bundler — the browser loads the modules directly.

- **`engine.js`** — pure finance core (~1300 lines). **Zero DOM, zero storage
  imports.** All math lives here and is unit-tested. If logic can go here, it goes
  here. Section banners (`// ── … ──`) are the map: money → time → rates → FIRE
  target → nominal loans → phased plan → replays → verdict/streak → check-in
  mutations → projection → analysis tables/stats → the one pipeline → initial state.
- **`format.js`** — pl-PL formatting/parsing (pure). Manual NBSP grouping so Node
  and browser produce identical strings (don't swap in `Intl` blindly — tests
  assert exact output including the non-breaking space ` `).
- **`coach.js`** — Polish message library + deterministic variant selection (pure).
- **`charts.js`** — pure SVG chart builders (`chartSVG`/`stackedBarSVG` + private
  `formatShort`), **zero imports** (L0 leaf), local `esc()`. `width`/`maxPoints`/
  `detail` options drive the fullscreen-landscape overlay; at defaults the output
  is byte-identical to before the split (guarded by F29).
- **`analysis.js`** — pure HTML builders for the **Analiza** screen (`#/analiza`).
  Zero DOM, zero module state: engine results + pre-rendered SVG charts come in as
  params, an HTML string comes out. Has a local `esc()` for user-derived text.
- **`simulation.js`** — pure HTML builders for the **Symulacja** screen
  (`#/symulacja`); a mirror of `analysis.js`. All calculators are read-only
  "what-if" — **nothing here is ever persisted.** Reuses `fireCell` from `analysis.js`.
- **`motivation.js`** — pure HTML builders for the emotional-feedback layer: the
  post-check-in **modal** (`checkinModal`) and the **Pulpit** „Dzisiejsza decyzja"
  card (`decisionCard`/`avoidedResult`/`spentResult`). Zero DOM/state, local `esc()`.
  Everything ephemeral — the calculators show a message and forget (no `persist()`
  in their code path). Money→future math comes from `engine.oneOffImpact`.
- **`storage.js`** — `localStorage` wrapper, schema version, migration chain,
  `.bak` backup, export/import. Backend is injectable (`makeStorage(backing)`) so
  tests run in Node without a real `localStorage`.
- **`ui.js`** — the **only** module that touches the DOM or holds mutable state
  (~1900 lines): all screen renderers, hash router, onboarding, event handling, and
  the fullscreen-landscape chart overlay (`zoomable` registry + `#chart-full`). It
  imports the SVG builders from `charts.js` and the progress ring `ringSVG` stays
  local. Template strings + event delegation, no framework. It calls the engine,
  then hands results to `analysis.js`/`simulation.js` to build the markup.
- **`app.js`** — bootstrap: load state → onboarding if empty → register SW →
  route → install hint.

### Module layering (the dependency rule to preserve)

Dependencies point **one way**, from pure leaves up to the DOM — no cycles. Keep it
that way; it's what keeps the whole finance core unit-testable in Node. Actual import
graph (each module imports only from lower layers):

```
L0  engine.js · format.js · storage.js · charts.js   ← import NOTHING (pure leaves; storage's backing is injectable)
L1  coach.js        imports engine, format
L2  analysis.js     imports engine, format, coach
L3  simulation.js   imports engine, format, analysis
L3  motivation.js   imports format, coach
L4  ui.js           imports engine, format, coach, analysis, simulation, motivation, charts, storage   ← ONLY DOM + mutable state
L5  app.js          imports ui, storage                                            ← bootstrap
```

Rules of thumb: **only `ui.js` may touch the DOM or own state.** Everything in
L0–L3 (`engine`, `format`, `coach`, `analysis`, `simulation`) is pure — values/
strings in → values/strings out — so the Node runner can exercise it (note "pure"
≠ "leaf": `coach` imports `engine`, but still holds no DOM/state). A new computation
goes in `engine.js`; a new screen's markup goes in a `*.js` builder; only the glue
(event wiring, `state` mutation, `render` call) lives in `ui.js`.

### Screens & routing

Hash router in `ui.js` (`route()` on `hashchange`). The single mutable `state`
lives at module scope in `ui.js`; `getState()` exposes it, everyone else is pure
and receives data as params. A 5-tab bottom nav (`#tabbar` in `index.html`) maps to:

| Route | Screen | Renderer |
|-------|--------|----------|
| `#/` | Pulpit (dashboard) | `renderDashboard` |
| `#/checkin/:month` | miesięczny check-in | `renderCheckin` |
| `#/history` | Historia | `renderHistory` |
| `#/analiza` | Analiza | `renderAnaliza` → `analysis.js` |
| `#/symulacja` | Symulacja | `renderSymulacja` → `simulation.js` |
| `#/plan`, `#/plan/:section` | Plan hub + sub-pages | `renderPlanHub` / `renderPlanSection` |
| `#/backup` | Kopia zapasowa | `renderBackup` |

`activeRoute()` decides tab highlighting: check-in counts as **Pulpit**; `#/backup`
and every `#/plan/*` sub-page count as **Plan**. Add a route by extending `route()`
and, if it's a top-level tab, the `#tabbar` list in `index.html`.

### Persisted state shape (see `createState`)

```
{ version, createdAt, anchorMonth,
  profile:     { birthDate },
  assumptions: { monthlyIncome, monthlyLivingExpenses, cashStart, portfolioStart,
                 cashReturnReal, targetFireAge, withdrawalRate, realReturnAnnual,
                 expenseGrowthReal, incomeGrowthReal, inflationAnnual },
  housing:     { currentRentMonthly, housePlan: { mortgage{…Nominal}, familyLoan{…Nominal}, … } },
  debt:        { overrides, familyOverrides },   // real & family-loan corrections
  entries:     [ … monthly check-ins … ],
  ui:          { theme, installTipDismissed, reminderTipShown, lastExportAt } }
```

`state.derived` is attached at runtime by `recomputeDerived` and **stripped before
save** — it is cache, never truth (see below). A new persisted field needs: a
default in `createState`/`defaultAssumptions`, a `validateState` check if it's
load-critical, and a migration step (bump `SCHEMA_VERSION`, see `migrate`).

### Styling & theme

Single `styles.css`, mobile-first (max-width 480px). Colors are **CSS custom props**
on `:root`; dark is the default via `@media (prefers-color-scheme: dark)`, and a
manual override lives in `state.ui.theme` → applied by `applyTheme()` as
`documentElement.dataset.theme` (`light` / `dark` / absent for auto). Add a color as
a `--var` in **all three** blocks (`:root`, the dark media query, `[data-theme="dark"]`).
No external fonts, no CSS framework.

### The one pattern to understand: derived state via replay

**Nothing computed is ever persisted as truth.** Balances, debt, streak, and the
FIRE projection are *always* recomputed from the entry history by replaying month
by month. After **any** mutation, call `recomputeDerived(state)`, which runs the
single pipeline `buildPlan → replayBalances → replayDebt → computeStreak →
projectFire` and caches the result on `state.derived`. `storage.save` strips
`state.derived` before writing — it is cache, not data.

Consequence: to change how balances evolve, edit the replay functions, not stored
numbers. "Corrections" (real cash/portfolio/debt overrides) are entries in the
replay chain that reset it from that month forward, not overwrites of a stored total.

## Tech decisions (the *why*, so you don't "fix" them)

- **No build step, no framework, raw ES modules.** The app must run forever from
  static files served under a subpath, fully offline. A bundler/CDN/framework would
  add a toolchain to maintain and a network dependency that breaks the offline
  guarantee. Payoff: what you edit is what ships — debug straight in the browser,
  no source maps. Cost: no JSX/TS; markup is template strings and types live in the
  test suite. **Don't introduce npm runtime deps or a build.**
- **PWA + cache-first service worker.** Offline-first is a hard requirement, so the
  app caches itself and serves from cache. That is also why updates are fiddly — see
  the SW gotchas and the release checklist (`cache: 'reload'` + active `reg.update()`
  on visibility/hourly exist to beat GitHub Pages `max-age=600`).
- **`localStorage` is the only store; no server, no account.** Privacy is the
  product — the data never leaves the device. The price: no cross-device sync and a
  small quota, mitigated by JSON export/import and the `.bak`-before-every-write
  safety net. A quota error surfaces as a Polish toast, not a crash.
- **Derived state is recomputed, never stored (replay, above).** The entry history
  is the single source of truth; every balance/debt/streak/projection is a pure
  function of it. This makes "editing the past" trivially correct and is the core
  reason `engine.js` stays DOM-free.
- **Pure engine + DOM only in `ui.js`.** So the whole money core runs under Node
  with no browser — which is *why* the test files are `.js` with `"type": "module"`,
  and why the HTML builders (`analysis.js`/`simulation.js`) return strings instead
  of poking the DOM.
- **Manual NBSP number formatting, not `Intl`.** Node and the browser must produce
  byte-identical strings so tests can assert exact output — `Intl` varies by
  runtime/ICU version. (See `format.js`.)

## Invariants — break these and money math goes wrong

- **Real vs nominal**: every amount is **real** (today's PLN) *unless the
  identifier ends in `Nominal`*. The nominal things are the two loan contracts —
  the mortgage and the **family loan** (`housePlan.familyLoan`). Conversions
  happen **only** through `toNominal`/`toReal`. Don't mix.
- **Months are `"YYYY-MM"` strings; arithmetic is on integer indices** via
  `ymToIdx`/`idxToYm`. **Never** `new Date("YYYY-MM")` — it parses as UTC and
  shifts the month in negative-offset zones. "Today's month" comes only from local
  `getFullYear()/getMonth()` (`todayYm()`). The engine does no `Date` arithmetic.
- **Money rounding**: `roundGrosze` on ingest; `EPS = 0.005` zeroes tiny residuals
  in `mortgageStep` and debt/target comparisons (a −0.003 zł debt must not block
  the FIRE condition).
- **`anchorMonth`** is where growth curves start. It is **re-anchored to the
  current month when the user edits income / living expenses / rent** — and only
  then. `reanchor()` rolls the two bucket balances forward to the new anchor;
  history (entries, verdicts) is left untouched.
- **`plannedSavingsSnapshot`** is frozen when an entry is created. Changing
  assumptions does **not** rewrite past verdicts; only an explicit re-save of that
  entry refreshes its snapshot.
- **FIRE reached** ⇔ `portfolio ≥ fireTargetAt(...)` **AND** mortgage `debt == 0`
  **AND** family loan `== 0`. All three. The family loan melts on a fixed annuity
  schedule (`replayFamilyLoan`/`projectFire`) — only explicit check-in
  `familyOverpayment`s accelerate it; monthly surplus still overpays the mortgage.
- **Verdict scale** `S = max(|plan|, 500)`: `≥ plan+0.15S` crushed, `≥ plan`
  on_plan, `≥ plan−0.40S` behind, else hard. Works for negative plans (build months).
- **Two buckets**: `cash` (fundusz na dom) and `portfolio` (brokerage, counts to
  FIRE). Phase routing in `replayBalances`/`projectFire`: pre-mortgage surplus →
  cash; during debt → cash (and all surplus overpays the loan); post-debt → portfolio.
  Deficits drain cash first, then portfolio. Strategy is locked: **pay debt first,
  then invest.**

## Gotchas discovered during build (don't re-learn these)

- **Windows `python -m http.server` serves `.mjs` as `text/plain`**, which makes
  the browser refuse the module (`Failed to fetch dynamically imported module`).
  That's why the test files are **`.js`** (not `.mjs`) with a root `package.json`
  declaring `"type": "module"`. **Do not rename them back to `.mjs`.**
- **Service worker must not hijack navigations outside the app shell.** The
  `fetch` handler for `navigate` requests is cache → network → `index.html`
  fallback, so `tests/tests.html` and `tools/*` still load normally. If you make
  the SW return the shell for *every* navigation, the test page breaks.
- **SW staleness while developing**: after changing `sw.js` or cached assets,
  unregister the SW and clear caches (or DevTools → Application → *Update on
  reload*), otherwise you'll test the old version.
- **Line endings**: repo is authored LF; git warns "LF will be replaced by CRLF"
  on Windows checkout. Harmless — leave it.
- **All paths must stay relative** (`./sw.js`, `js/app.js`, `icons/...`). The app
  runs under `/FIRE/`, so a single leading `/` would 404 on Pages. The subpath
  rehearsal above is the way to catch this.

## Making a release

Bump the version in **three** places (they must match) and update the cache:

1. `sw.js` → `const CACHE = 'fire-v1.0.0'` (bump, e.g. `fire-v1.0.1`)
2. `index.html` footer → `FIRE Companion v1.0.0`
3. `js/ui.js` → `export const APP_VERSION = '1.0.0'`

Then: **any new app file must be added to the `PRECACHE` list in `sw.js`**, run
`node tests/run-tests.js` (green), do the `/FIRE/` subpath rehearsal, commit, push.
On the phone the app shows a "Dostępna nowa wersja" toast → tap to reload.
Full checklist is in `README.md`; deploy guide in `WDROZENIE.md`.

## Tests

No framework. `tests/test-engine.js` holds `assertEq/assertClose/assertThrows`
helpers and all cases; shared by the Node runner and `tests.html`. Fixtures
(`tests/fixtures.js`) are **derived from `Kalkulator_FIRE.xlsx`** — F1–F12 cover:
Excel yearly-compounding parity (year-20 = 1 931 853,86 zł), monthly engine vs
annuity-due closed form, mortgage annuity (≈9 755,8 zł/mo, 180 steps → 0), FIRE
targets + renting-forever contrast, 3-phase plan (incl. negative build months),
verdict tiers, streak, replay determinism, projection, format/parse, storage
(.bak recovery, migration, version reject), and two-bucket routing. F13–F17
cover the Analiza screen: withdrawal-phase Excel parity (year-35 nominal
8 724 696,89 zł, depletion, nominal rate 8,15%), yearly projection residual
identity + reconciliation, `excelProjection` parity, `projectionWith`
purity/monotonicity, SWR table, Coast FIRE, and mortgage analytics. F18–F24 cover
the Symulacja/goal features: `projectionWith` "what-if" extra savings (purity, one-
time vs recurring, edge months), the "droga do FIRE" progress bar, the **family
loan** (`replayFamilyLoan`, annuity parity, overrides/overpayments, FIRE gated on
`familyFreeYm`), future-value of equal contributions, `solveExtraSavingsForAge` and
`requiredSavingsForGoal` (hit the target FIRE age, infeasibility guards), and the
"do zera" / die-with-zero target (`dieWithZeroTargetAt`, `projectDieWithZero`).
F25 covers the motivational layer: `oneOffImpact` (yearsToFire/factor, real
future value, spend-at-FIRE + retirement-days incl. an expense-growth variant,
past-target-age → factor 1, incomplete-profile → null, zero-amount, purity) and
the seeded message selectors (`checkinCelebration`/`decisionMessage`: unique
non-empty variants per bucket, seed modulo, negative seed, unknown-key fallback).
F26 covers the "ile zostało do spłaty" loan charts + overpayment slider:
`yearlyRemainingToPay` (contract identities `p_k + i_k ≈ A × remaining months`,
closed-form principal), `loanPathWithProjection` (purity, history→projection seam
continuity, zero at `debtFreeYm`, the frozen-balance and zero-trim guards),
`remainingToPayComparison` (two-way zero padding when an upward override outlives
the contract), and `remainingSchedule`'s `extraMonthly` param (0 ≡ 3-arg call,
strict monotonicity in X, 0% integer case). F29 covers `charts.js`: default
output parity/purity (`viewBox`, 3 axis lines, Y/X labels), the `width`/`height`
size options (no `NaN`), `maxPoints` decimation (last row kept at the right edge),
and the `detail` flag (5 Y labels, intermediate no-duplicate year labels on lines,
denser year labels on bars). The fullscreen overlay itself is DOM (`ui.js`) —
covered by manual QA, not Node.

When you change engine behavior, **update or add a fixture** — the Excel-derived
numbers are the spec. Prefer adding a test over eyeballing a screenshot.

## Conventions for changes

- Keep it dependency-free and offline-first. No CDN, no fonts, no fetch to
  anything but the app's own files. No build tooling.
- Put logic in `engine.js` (testable); screen markup in a pure HTML builder
  (`analysis.js`/`simulation.js` for those screens); only DOM/event/state glue in
  `ui.js`. Keep the one-way layering (see Architecture).
- New user-facing text is **Polish**. Match the existing tone in `coach.js`.
- **Plans, design docs, and technical writing are in English.** Only the parts
  that ship as UI copy (or otherwise reach the user) are Polish — the app is
  Polish, the planning is not.
- **Commit messages in Polish** to match history (`git log`).
- Mobile-first, max-width 480px, touch targets ≥48px, dark mode via CSS custom
  props + `prefers-color-scheme` with a manual override in `state.ui.theme`.

## Git / deploy

- Remote `origin` → `https://github.com/KSchlagowski/FIRE.git`, default branch
  `main`. GitHub Pages serves `main` at `/ (root)` → `https://kschlagowski.github.io/FIRE/`.
- The repo name is uppercase `FIRE`; Pages URLs are case-sensitive but the app's
  relative paths make case irrelevant to functionality.
