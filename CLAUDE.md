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
node tests/run-tests.js      # engine test suite; exit 0 = all green (64 tests)
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

Six ES modules under `js/`, loaded via `<script type="module" src="js/app.js">`.

- **`engine.js`** — pure finance core. **Zero DOM, zero storage imports.** All
  math lives here and is unit-tested. If logic can go here, it goes here.
- **`format.js`** — pl-PL formatting/parsing (pure). Manual NBSP grouping so Node
  and browser produce identical strings (don't swap in `Intl` blindly — tests
  assert exact output including the non-breaking space ` `).
- **`coach.js`** — Polish message library + deterministic variant selection (pure).
- **`storage.js`** — `localStorage` wrapper, schema version, migration chain,
  `.bak` backup, export/import. Backend is injectable (`makeStorage(backing)`) so
  tests run in Node without a real `localStorage`.
- **`ui.js`** — all screen renderers, hash router, SVG charts, event handling.
  Template strings + event delegation, no framework.
- **`app.js`** — bootstrap: load state → onboarding if empty → register SW →
  route → install hint.

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
purity/monotonicity, SWR table, Coast FIRE, and mortgage analytics.

When you change engine behavior, **update or add a fixture** — the Excel-derived
numbers are the spec. Prefer adding a test over eyeballing a screenshot.

## Conventions for changes

- Keep it dependency-free and offline-first. No CDN, no fonts, no fetch to
  anything but the app's own files. No build tooling.
- Put logic in `engine.js` (testable), presentation in `ui.js`.
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
