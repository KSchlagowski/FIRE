# Annual report — „Twój rok FIRE" (`#/raport/:year`)

## Context

A December retrospective of the year: how much was saved vs the plan, the verdict
mix and best streak, the FI% progress delta, and — the emotional headline — **how
many months the year's entries shaved off the projected FIRE date**. Everything is
read-only and recomputed from the entry history (the replay pattern); **nothing new
is persisted**, so there is no schema bump and no migration.

The authoritative design is **Feature 2 of `plans/E-reports-engagement.md`** (§0
decisions + §2) — do not re-derive its choices. This doc extracts that feature as a
**standalone release** and reconciles the batch plan with the tree as of **v1.16.0**,
because plans/E was written for a wave that shipped differently:

- fixture letters **F27/F28 were consumed** by the bonds/freeze features and **F29 by
  `charts.js`** — the annual report takes **F30** (plans/E numbered it F28);
- batch C (`note` field, `SCHEMA_VERSION 3`) **never shipped**; the report never
  needed it. Current `SCHEMA_VERSION` is 4 (`createState().version === 4`) and this
  feature **does not change it**;
- plans/E's other features (milestones, CSV export, backup nudge + .bak restore)
  remain **unimplemented** and are NOT built here;
- wave conventions (no version bump, no commit, `docs/features/E.md` + `docs/INDEX.md`)
  do not apply — those files don't exist. This is a normal standalone release:
  **v1.17.0, committed in Polish**.

Line numbers below refer to the v1.16.0 tree — anchor by names, not lines.

## Locked decisions (plans/E §0 + §2, restated against the current tree)

| Decision | Choice | Why |
|---|---|---|
| Math | Pure `engine.js`: `projectionAsOf`, `reportYears`, `annualReport` in a new section `// ── Raport roczny ──` | The FIRE-date shift needs two full projections — must be deterministic and fixture-tested in Node |
| Markup | New builder `annualReportScreen` in **`analysis.js`** (not a new module) | Report is analysis-flavored (`kv`/`table`/`metodologia` helpers live there); **no new file → no `PRECACHE` change** |
| Placement | Route `#/raport/:year` (Historia tab); seasonal card on Pulpit (December → current year, January → prior year); permanent „Raporty roczne" links at the bottom of Historia | Pulpit = discovery at the right moment (the December check-in lands Jan 1); Historia = the archive screen. Analiza rejected: heavy render, and it's about *current* state. Hash route = back-button friendly |
| Comparison semantics | Both projections use **today's assumptions**; only the entry set differs (truncated to Dec of the previous year vs end of the reported period) | Old assumptions can't be reconstructed; the comparison isolates the effect of the year's *entries*. Documented in the on-screen metodologia |
| Sign convention | `fireShiftMonths > 0` = FIRE **earlier** (months shaved off) | Matches the existing check-in result: `E.monthsBetween(proj.fireYm, prevFireYm) // dodatnie = wcześniej` (`ui.js`, `renderCheckinResult`) |
| FI% definition | `portfolio / fireTargetAt(state, ym)` — portfolio only, cash excluded | Identical to `fiStats().fiPct`; the report must not invent a second FI% |
| Persistence | None. No `SCHEMA_VERSION` change, no `createState` change, no `validateState` change | The report is a pure view over `state.entries` |

## Step 1 — `js/engine.js` (pure, new section `// ── Raport roczny ──`)

Place the section after `fireJourneyProgress`, before the `recomputeDerived`
pipeline banner.

```js
// Pełny potok na kopii stanu z wpisami obciętymi do uptoYm i „zegarem"
// zamrożonym na uptoYm. Czysty (płytka kopia — wzorzec projectionWith).
// Obcięcie wpisów jest konieczne: assumedDelta patrzy na OSTATNIE ≤6 wpisów,
// a byPlanOnly na ich liczbę — bez obcięcia prognoza „sprzed roku"
// widziałaby przyszłość.
export function projectionAsOf(state, uptoYm) {
  const cut = ymToIdx(uptoYm);
  const st = { ...state, entries: state.entries.filter(e => ymToIdx(e.month) <= cut) };
  const plan = buildPlan(st);
  const debt = replayDebt(st, uptoYm);
  const family = replayFamilyLoan(st, uptoYm);
  const balances = replayBalances(st, uptoYm, debt, family);
  return projectFire(st, plan, balances, debt, family, uptoYm);
}

// Lata z co najmniej jednym wpisem, malejąco (punkt wejścia w Historii).
export function reportYears(state) {
  return [...new Set(state.entries.map(e => Number(e.month.slice(0, 4))))].sort((a, b) => b - a);
}

// Podsumowanie roku kalendarzowego `year`. null, gdy rok nie przecina się
// z planem (from > to). Wszystko realnie; assumptions są DZISIEJSZE dla obu
// prognoz — porównanie izoluje efekt wpisów z roku, nie zmian założeń.
export function annualReport(state, year, now = new Date()) {
  const fromIdx = Math.max(ymToIdx(`${year}-01`), ymToIdx(state.anchorMonth));
  const toIdx = Math.min(ymToIdx(`${year}-12`), ymToIdx(lastCompleteMonth(now)));
  if (fromIdx > toIdx) return null;
  const from = idxToYm(fromIdx), to = idxToYm(toIdx);
  const inYear = state.entries
    .filter(e => ymToIdx(e.month) >= fromIdx && ymToIdx(e.month) <= toIdx)
    .sort((x, y) => (x.month < y.month ? -1 : 1));

  // Sumy odłożone/plan + werdykty + najlepszy/najsłabszy miesiąc.
  let totalSaved = 0, totalPlanned = 0, best = null, worst = null;
  const verdicts = { crushed: 0, on_plan: 0, behind: 0, hard: 0 };
  for (const e of inYear) {
    const net = roundGrosze(e.earned - e.spent);
    totalSaved += net; totalPlanned += e.plannedSavingsSnapshot;
    if (verdicts[e.verdict] != null) verdicts[e.verdict]++;
    if (!best || net > best.net) best = { month: e.month, net };
    if (!worst || net < worst.net) worst = { month: e.month, net };
  }
  const goodMonths = inYear.filter(e => isGoodVerdict(e.verdict)).length;
  const bestRun = computeStreak(inYear).best;   // najdłuższa seria W ROKU

  // FI% na początek i koniec roku — definicja jak fiStats.fiPct (sam portfel).
  // replayBalances czyta wpisy tylko ≤ upto, więc obcięcie nie jest potrzebne.
  const prevEndYm = `${year - 1}-12`;
  const balPrev = replayBalances(state, prevEndYm);  // upto < anchor → salda startowe
  const balEnd = replayBalances(state, to);
  const tPrev = fireTargetAt(state, prevEndYm), tEnd = fireTargetAt(state, to);
  const fiPctStart = tPrev > 0 ? balPrev.portfolio / tPrev : null;
  const fiPctEnd = tEnd > 0 ? balEnd.portfolio / tEnd : null;

  // Przesunięcie prognozy FIRE: „tylko wpisy do grudnia zeszłego roku"
  // vs „wpisy do końca raportowanego okresu". Dodatnie = FIRE WCZEŚNIEJ.
  const projPrev = projectionAsOf(state, prevEndYm);
  const projNow = projectionAsOf(state, to);
  const fireShiftMonths = (projPrev.reached && projNow.reached)
    ? monthsBetween(projNow.fireYm, projPrev.fireYm) : null;

  return {
    year, from, to,
    entriesCount: inYear.length,
    monthsInPlan: toIdx - fromIdx + 1,
    totalSaved: roundGrosze(totalSaved), totalPlanned,
    delta: roundGrosze(totalSaved - totalPlanned),
    verdicts, goodMonths, bestRun, best, worst,
    fiPctStart, fiPctEnd,
    fiPctDelta: (fiPctStart != null && fiPctEnd != null) ? fiPctEnd - fiPctStart : null,
    reachedPrev: projPrev.reached, reachedNow: projNow.reached,
    fireYmPrev: projPrev.reached ? projPrev.fireYm : null,
    fireYmNow: projNow.reached ? projNow.fireYm : null,
    fireShiftMonths,
  };
}
```

Edge cases locked in (each has a test in Step 4):

- **Partial years clamp both ends**: a year starting mid-plan uses `from = anchorMonth`;
  the current year uses `to = lastCompleteMonth(now)` — a December render of the
  current year is a Jan–Nov report and says so via `from`/`to` in the header.
- **`prevEndYm` before the anchor is legal**: `replayBalances`' loop
  (`for idx = a0; idx <= upto`) doesn't run → start balances, empty `rows`;
  `replayDebt`/`replayFamilyLoan` return `EMPTY_LOAN()` (`started: false`) and
  `projectFire`'s `startIdx = Math.max(upto + 1, a0)` degenerates to a plan-only
  projection. The "year one" report compares against the plan baseline — no
  special-casing.
- **`fireShiftMonths === null`** whenever either projection misses the horizon
  (`HORIZON_MONTHS`); the builder then shows reached/unreached wording instead.
- **Zero entries** in a plan-intersecting year still returns a report
  (`entriesCount: 0`, `best`/`worst` null) — the builder renders the empty-year
  line. Historia only links years from `reportYears`, so this occurs only via
  manual URL.
- **Purity**: both functions leave `state` byte-identical (`JSON.stringify` before
  == after) — shallow copy + filtered array, no mutation of entries.

Do NOT touch: `projectFire`, `replayBalances`, `fireTargetAt`, `computeStreak`,
`fiStats`, `recomputeDerived` — the report is a reader, not a pipeline change.

## Step 2 — `js/analysis.js` (pure builder)

New exported builder at the end of the file, reusing the local helpers
(`esc`, `ymShort`, `money`, `signed`, `kv`, `table`, `metodologia`) and the
already-imported `verdictLabel`/`verdictEmoji`:

```js
// rep = wynik engine.annualReport (nie-null); years = engine.reportYears(state)
export function annualReportScreen({ rep, years }) → string
```

Cards, top to bottom (mobile-first, no new CSS classes):

1. **Header** — `„Twój rok FIRE ${rep.year} 🔥"`; when the year is clamped
   (`rep.from !== '${year}-01'` or `rep.to !== '${year}-12'`) add the covered range
   `${ymShort(rep.from)} – ${ymShort(rep.to)}` as a muted line.
2. **„Odłożone w roku"** — kv rows: `Odłożone razem` (`money(rep.totalSaved)`),
   `Plan na ten okres` (`money(rep.totalPlanned)`), `Różnica` (`signed(rep.delta)`,
   class `good`/`bad`), `Najlepszy miesiąc` / `Najsłabszy miesiąc`
   (`Fmt.formatMonthName` + net). Summary line under the rows:
   - `delta ≥ 0`: „Rok na plus względem planu. Tę nadwyżkę procent składany będzie
     powtarzał Ci przez dekady."
   - `delta < 0`: „Rok poniżej planu — ale zmierzony, a co mierzysz, tym zarządzasz.
     Wybierz jedną rzecz do poprawy na nowy rok."
3. **„Seria i werdykty"** — kv: `Dobre miesiące` (`X z Y wpisów`), `Najdłuższa seria
   w roku` (`🔥 ${rep.bestRun}`), then the four verdict counts rendered with
   `verdictEmoji`/`verdictLabel` (skip zero-count rows).
4. **„Postęp do celu"** — kv: `FI% na początku roku`, `FI% na końcu roku`
   (`Fmt.formatPct(..., 1)`), `Zmiana` (`(rep.fiPctDelta >= 0 ? '+' : '') +
   Fmt.formatPct(rep.fiPctDelta, 1)`, class `good`/`bad`). `formatPct` already
   appends `%`, so the row does NOT add „pkt proc." — the percentage-point wording
   lives in the metodologia (deviation from plans/E recorded below).
5. **„Data FIRE"** — one sentence, by case:
   - shift > 0: „Prognoza FIRE przyspieszyła w tym roku o
     ${Fmt.formatYearsMonths(shift)} — z ${Fmt.formatMonthName(fireYmPrev)} na
     ${Fmt.formatMonthName(fireYmNow)}. Tak wygląda kupowanie sobie czasu."
   - shift < 0: „Prognoza FIRE przesunęła się o ${Fmt.formatYearsMonths(-shift)}
     dalej — z ${Fmt.formatMonthName(fireYmPrev)} na ${Fmt.formatMonthName(fireYmNow)}.
     Jeden rok nie przekreśla planu: wnioski są w liczbach wyżej."
   - shift === 0: „Prognoza FIRE bez zmian: ${Fmt.formatMonthName(fireYmNow)}.
     Stabilnie — dokładnie tak buduje się wolność."
   - `!reachedPrev && reachedNow`: „Rok temu prognoza nie domykała się w horyzoncie —
     dziś FIRE ma datę: ${Fmt.formatMonthName(fireYmNow)}. To zasługa tego roku."
   - `reachedPrev && !reachedNow`: „Prognoza wypadła poza horyzont — zajrzyj do
     założeń i wpisów, liczby wyżej pokażą, co się zmieniło."
   - neither: „Prognoza FIRE jest poza 60-letnim horyzontem — raport pokazuje, co
     realnie udało się odłożyć."

   Below it, `metodologia([...])`:
   - „Obie prognozy liczone dzisiejszymi założeniami — porównujemy tylko wpisy:
     stan na koniec ${year − 1} vs stan na ${ymShort(rep.to)}."
   - „FI% = portfel ÷ cel FIRE w danym miesiącu (cel jest ruchomy); zmiana podana
     w punktach procentowych."
6. **Year navigation** — prev/next links for adjacent years present in `years`
   (plain `<a href="#/raport/YYYY">`), plus
   `<a class="btn ghost wide" href="#/history">← Historia</a>`.
7. **`rep.entriesCount === 0`** → replace cards 2–5 with
   `<p class="muted">Brak wpisów w tym roku.</p>` (header + nav stay).

## Step 3 — `js/ui.js` (glue only — no logic)

1. **Route** — in `route()`, before the final `else renderDashboard();`:
   `else if (hash.startsWith('#/raport/')) renderRaport(hash.split('/')[2]);`
   In `activeRoute()` add `if (hash.startsWith('#/raport')) return '#/history';`
   — the generic `slice(0, 2)` fallback would return `'#/raport'` and highlight no
   tab. No `#tabbar` change (report lives under the Historia tab).
2. **`renderRaport(yearStr)`** — `const year = Number(yearStr);` if not a safe
   integer in 1900–2200, or `E.annualReport(state, year)` returns `null` →
   `location.hash = '#/history'; return;`. Otherwise
   `view().innerHTML = An.annualReportScreen({ rep, years: E.reportYears(state) });`
   No event wiring beyond the plain hash links.
3. **Pulpit seasonal card** — in `renderDashboard`, right after the `due` banner:

   ```js
   const nowMonth = Number(nowYm.slice(5));                     // 1..12
   const reportYear = nowMonth === 12 ? Number(nowYm.slice(0, 4))
                    : nowMonth === 1 ? Number(nowYm.slice(0, 4)) - 1 : null;
   if (reportYear != null && E.reportYears(state).includes(reportYear)) {
     html += `<div class="banner info">🎁 <b>Twój rok FIRE ${reportYear}</b> — zobacz podsumowanie:
       ile odłożone, jak seria, o ile przybliżyło się FIRE.
       <div class="btn-row"><a class="btn primary" href="#/raport/${reportYear}">Pokaż raport</a></div></div>`;
   }
   ```

   December shows the in-progress current year (anticipation), January the
   just-completed prior year (the December check-in lands Jan 1). The card computes
   **nothing heavy** — `annualReport` (two full projections) runs only on `#/raport/*`.
4. **Historia entry point** — in `renderHistory`, after the best-streak line
   (inside the same card): `Raporty roczne: <a href="#/raport/2026">2026</a> · …`
   from `E.reportYears(state)`; omit the whole line when the list is empty.

## Step 4 — tests (F30; run `node tests/run-tests.js`, green before any UI work)

House pattern: `NOW = new Date(2026, 6, 15)` exists; F30 adds
`NOW2 = new Date(2027, 0, 15)` (last complete month `2026-12`). Fixture block `F30`
in `tests/fixtures.js` with a Polish derivation comment; cases in
`tests/test-engine.js`. Base data: state with `realReturnAnnual: 0,
cashReturnReal: 0, expenseGrowthReal: 0, incomeGrowthReal: 0` for integer
arithmetic; income/living/rent chosen so `plannedSavingsFor` is a flat
**4 000 zł/mo**; entries `2026-07 … 2026-12` created via `applyCheckIn` (so
`plannedSavingsSnapshot` and `verdict` are real) with `net = 5000` each.
Surplus 1000 ≥ 0.15·S for S = 4000 (600) → every verdict is `crushed`.

- **F30a sumy i werdykty**: `annualReport(state, 2026, NOW2)` → `from '2026-07'`,
  `to '2026-12'`, `entriesCount 6`, `monthsInPlan 6`, `totalSaved 30000`,
  `totalPlanned 24000`, `delta 6000`, `verdicts.crushed 6`, `goodMonths 6`,
  `bestRun 6`; `best.net === worst.net === 5000` for equal entries.
- **F30b FI% delta (r=0)**: `fiPctStart === portfolioStart / target`,
  `fiPctEnd === (portfolioStart + 30000) / target` (no-house state routes surplus
  to the portfolio), `fiPctDelta` closes the identity (`assertClose`, eps 1e-9).
  Also: FI% start uses start balances (prevEndYm `2025-12` < anchor).
- **F30c przesunięcie daty FIRE**: on the plain 5%-return `baseState`, above-plan
  entries → `fireShiftMonths > 0` (positive = earlier); below-plan entries
  (`net = plan − 2000`) → `< 0`. On the r=0 variant the target is unreachable →
  `reachedNow === false` and `fireShiftMonths === null` (the null branch).
- **F30d obcięcie i czystość**: with 6 entries, `projectionAsOf(state, '2026-09')`
  yields the same `fireYm`/`delta` as a state that never had the Oct–Dec entries;
  `JSON.stringify(state)` identical before/after both `projectionAsOf` and
  `annualReport` (F15a pattern).
- **F30e krawędzie**: `annualReport(state, 2025, NOW2) === null` (year entirely
  before the anchor); `annualReport(state, 2027, NOW2) === null`
  (`from '2027-01' > to '2026-12'`); at `NOW` (July 2026) the 2026 report has
  `to === '2026-06'`; a plan-intersecting year with zero entries →
  `entriesCount 0`, `best === null`; `reportYears` returns years descending and
  `[]` for no entries.

Then update **`CLAUDE.md`**: the test-count line (`141` → new total), append an F30
sentence to the fixture-coverage paragraph, and add the `#/raport/:year` row to the
routes table.

## Step 5 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three places:
`sw.js` `CACHE = 'fire-v1.17.0'`, `index.html` footer `FIRE Companion v1.17.0`,
`js/ui.js` `APP_VERSION = '1.17.0'`. Commit in Polish, e.g.:
`feat: raport roczny „Twój rok FIRE" — podsumowanie roku i trasa #/raport (v1.17.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0 (141 existing + F30 all green); no
   pre-existing expected number changes (the feature only adds readers).
2. App run via preview (`.claude/launch.json`):
   - `#/raport/<year with entries>` renders all cards; Historia tab highlighted;
     back button returns to the previous screen (no dead overlay);
   - Historia shows the „Raporty roczne" links; a fresh profile (no entries) shows
     no links and `#/raport/2026` typed by hand redirects to `#/history`;
   - `#/raport/abc` and `#/raport/1800` redirect to `#/history`;
   - Pulpit card: verify the month gate by temporarily overriding the device date
     (or asserting the `reportYear` expression) — December → current year,
     January → prior year, February–November → no card;
   - copy check: positive shift year shows „przyspieszyła … o X mies.", and the
     range line appears only for clamped years.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — the new links are hash-only, but the rehearsal
   is the standing release requirement.

## Deviations from `plans/E-reports-engagement.md` (record)

- **Fixture letter**: plans/E §6 assigned F28 — taken by the expense-freeze
  feature; F29 is `charts.js`. Annual report ships as **F30**.
- **No schema work**: plans/E §5's `milestonesSeen` migration belongs to the
  milestones feature (Feature 1), which is NOT built here. `SCHEMA_VERSION`
  stays 4.
- **No batch-C dependency**: the `note` field never shipped and the report never
  needed it; the CSV export (Feature 3) that consumed it also stays unbuilt.
- **Release conventions**: standalone (version bump + Polish commit) instead of
  the wave's "no bump, no commit, `docs/features/E.md`"; this doc is the record.
- **FI-delta rendering**: plans/E's `formatPct(...) + „pkt proc."` label would
  double-mark units (`formatPct` appends `%`); the row keeps `%` and the
  percentage-point wording moved into the metodologia line.
- **No chart in the report** (deliberate): v1.16.0's `charts.js` could draw a
  monthly-net bar, but plans/E locked a kv-card design; adding a chart is a
  separate decision, not silent scope creep.
