# Sequence-of-returns stress test — „Test krachu" (`stressTestRetirement`)

## Context

The biggest threat to a fresh retiree is a market crash right after switching to
withdrawals: the portfolio drops while withdrawals continue, and the same average
return produces a completely different outcome depending on *when* the bad years
arrive (sequence-of-returns risk). This feature adds a deterministic stress test —
no randomness, no Monte Carlo:

1. **engine**: `projectWithdrawal` learns to apply a one-off crash (`{ year, pct }`)
   at the start of a chosen retirement year; a new `stressTestRetirement` runs the
   full withdrawal path three times — no crash, crash in year 1, crash in year 10 —
   over the horizon `deathAge − startAge` and summarizes survival per scenario;
2. **UI**: a new Symulacja **„Krach" tab** (inputs: drop %, live-to age) showing
   whether the plan survives each scenario. Pure what-if — **nothing is persisted**
   (no storage change, no migration, no schema bump).

This is **Feature 5 of `plans/A-retirement-projection.md`** (the authoritative
design; §2.9 `stressTestRetirement`, §4.2 `crashCard`/`crashResult`, §7.8 copy,
§6 F31 tests), implemented **standalone** on top of the already-shipped Feature 1
(bonds switch, v1.14.0: `retirementOpts`, `ro.postReturnReal`). Ships as a normal
standalone release: **v1.15.0, committed in Polish**.

Key locked decisions adopted from Plan A:
- **D1**: retirement starts at the withdrawal `startYm` (`proj.fireYm` when FIRE is
  reached, `todayYm()` in the hypothetical case) — `projectWithdrawal` already
  resolves this; the stress test reuses the same rule.
- **D2**: the crash flows through the `retirementOpts` object (`ro.crash`,
  what-if only, never persisted) with an `opts.crash` override on `projectWithdrawal`.
- **D3**: headline FIRE date, verdicts, streak, dashboard — all unchanged. The
  stress test is analysis-layer only; `projectFire`/`recomputeDerived` untouched.
- **Crash semantics (§2.5/§2.9)**: shock at the **start** of retirement year
  `crash.year`, **before** that year's withdrawal; year 1 = the first retirement
  year. Deterministic: same inputs → same output, always.

Baseline: suite currently **131/131 green** (`node tests/run-tests.js`).

## Step 1 — `js/engine.js`

All references are to current line numbers.

1. **`retirementOpts` (engine.js:718)** — extend the returned object with one field
   (D2; the doc comment above it already announces future fields):
   ```js
   crash: overrides.crash || null, // { year, pct } — what-if Symulacji, nigdy nie zapisywane
   ```
2. **`projectWithdrawal` (engine.js:729)** — crash support:
   - near the top (after the `ro` line): `const crash = opts.crash != null ? opts.crash : ro.crash;`
   - in the yearly loop, replace `const startReal = bal;` (engine.js:758) with:
     ```js
     let startReal = bal;
     const crashed = !!(crash && n === crash.year);
     if (crashed) startReal *= (1 - crash.pct);
     ```
   - add `crashed` to the pushed row (engine.js:768–773). All nominal columns
     derive from `startReal`, so they stay consistent automatically. Note: the
     crash loss appears as a discontinuity between year `k−1`'s `endReal` and year
     `k`'s `startReal`, **not** inside `growthReal` — `growthReal` keeps its exact
     meaning (market growth after the withdrawal). Fine for this feature: the
     „Krach" tab renders summary rows, not the table.
   - add `crashApplied: rows.some(r => r.crashed)` to the returned object
     (engine.js:777–780).
   - `crash: null` / absent ⇒ **byte-identical behavior** to today (regression
     guard in F31a).
3. **New `stressTestRetirement`** — insert directly after `projectDieWithZero`
   (engine.js:907), before the `yearlyProjection` banner, still inside the
   retirement-phase section:
   ```js
   // Deterministyczny test krachu (ryzyko sekwencji zwrotów). Bez losowania:
   // dla każdego roku szoku k liczymy pełną fazę wypłat (projectWithdrawal)
   // z krachem {year: k, pct} na starcie k-tego roku wypłat; przebieg bazowy
   // (bez krachu) dla kontrastu. Horyzont = deathAge − wiek startowy; lata
   // szoku poza horyzontem są pomijane. Czysta analiza — nic nie zapisujemy.
   export function stressTestRetirement(state, opts = {}) {
     const birth = state.profile.birthDate;
     if (!birth) return null;
     const ro = opts.ro || retirementOpts(state);
     const shockPct = opts.shockPct != null ? opts.shockPct : 0.30;
     const deathAge = opts.deathAge != null ? opts.deathAge : 90;
     const proj = opts.projection || null;
     const reached = !!(proj && proj.reached);
     const startYm = opts.startYm != null ? opts.startYm : (reached ? proj.fireYm : todayYm());
     const startAge = ageAt(birth, startYm).years;
     const horizonYears = Math.max(1, deathAge - startAge);
     const shockYears = (opts.shockYears || [1, 10]).filter(y => y >= 1 && y <= horizonYears);
     const common = {
       projection: proj, ro, startYm, years: horizonYears,
       startPortfolioReal: opts.startPortfolioReal,
       withdrawalRealYearly: opts.withdrawalRealYearly,
     };
     const summarize = w => ({
       depletedYear: w.depletedYear,
       depletedAge: w.depletedYear != null ? w.rows[w.depletedYear - 1].age : null,
       survives: w.depletedYear == null,
       endReal: w.rows.length ? w.rows[w.rows.length - 1].endReal : 0,
     });
     const base = summarize(projectWithdrawal(state, common));
     const scenarios = shockYears.map(k => ({
       shockYear: k,
       ...summarize(projectWithdrawal(state, { ...common, crash: { year: k, pct: shockPct } })),
     }));
     return { startYm, startAge, horizonYears, shockPct, deathAge,
              hypothetical: !reached, base, scenarios };
   }
   ```
   The `startYm`/`startPortfolioReal`/`withdrawalRealYearly` passthroughs exist for
   test determinism (`todayYm()` is not injectable in `projectWithdrawal`) — the UI
   never passes them. `hypothetical` mirrors `projectWithdrawal`'s convention and
   feeds the banner (Step 3).

Do NOT touch: `projectFire`, `projectDieWithZero`, `dieWithZeroTargetAt`,
`replayBalances`, `fireTargetAt`, `recomputeDerived` path. **No `js/storage.js`
change** — nothing is persisted, no migration, `SCHEMA_VERSION` stays 3.

## Step 2 — tests (run `node tests/run-tests.js` after; must be green before UI work)

Numbering per Plan A §6: this feature owns **F31** (F29/F30 stay reserved for the
ZUS-bridge/Barista batch). No `baseState()` touch-up needed — it already carries
`postRetirementReturnReal: 0.05`, `birthDate: '2000-01-01'` (age 26 at anchor
`2026-07`).

1. **New fixture** (`tests/fixtures.js`, after F27, one header-comment line):
   ```js
   // Test krachu: szok −30% na starcie roku k, horyzont do deathAge. Baza 1,8M/W₁ 72k
   // przy r=5%: równowaga W₁(1+r)/r = 1 512 000 < 1,8M → baza przeżywa; po krachu < równowagi → wyczerpanie.
   F31: { shockPct: 0.30, deathAge: 90, years: [1, 10], start: 1800000, wYear: 72000, startYm: '2026-07' },
   ```
2. **New tests** (`tests/test-engine.js`, after the F28 block, banner
   `// ── F31: test krachu (ryzyko sekwencji zwrotów) ──…`):
   - **F31a** `projectWithdrawal` crash mechanics: with explicit
     `{ startYm: FIX.F31.startYm, startPortfolioReal: 1800000, withdrawalRealYearly: 72000, years: 10 }`:
     - `crash: { year: 1, pct: 0.3 }` ⇒ rows deep-equal (ignoring the `crashed`
       flag) to a **no-crash run started at `1800000 × 0.7`** — the year-1 crash
       identity; row 1 has `crashed === true`, result `crashApplied === true`;
     - `crash: { year: 3, pct: 0.3 }` ⇒ rows 1–2 identical to the base run
       (JSON compare); row 3: `crashed === true`,
       `startReal === base.rows[1].endReal × 0.7` (assertClose);
     - no `crash` ⇒ result JSON identical to the same call before this change
       (compare against an inline replica of the old recurrence), and every row
       has `crashed === false`, `crashApplied === false`.
   - **F31b** `stressTestRetirement` determinism + zero shock: `shockPct: 0` ⇒
     every scenario equals `base` field-by-field; two consecutive calls produce
     identical JSON; purity (state JSON unchanged before/after).
   - **F31c** sequence risk demonstrated (`baseState()`, explicit
     `startYm: '2026-07'`, `startPortfolioReal: 1800000`,
     `withdrawalRealYearly: 72000`, `deathAge: 90` → horizon 64):
     - `base.survives === true` (1,8M above the `W₁(1+r)/r = 1 512 000` equilibrium);
     - year-1 crash: `survives === false` with `depletedYear` equal to the value
       computed **in-test** by an independent recurrence loop
       (`P ← (P − 72000)·1.05` from `1 260 000`; ≈ year 37);
     - year-10 crash: `s10.depletedYear == null || s10.depletedYear > s1.depletedYear`
       (Plan A F31b assertion) — with these numbers both deplete, year 10 strictly
       later; also assert `s10.depletedYear` against the in-test recurrence
       (9 clean years, then ×0.7, then the loop);
     - `depletedAge === startAge + depletedYear − 1` for both scenarios.
   - **F31d** horizon & guards: `horizonYears === deathAge − startAge`;
     `shockYears: [1, 999]` ⇒ `scenarios.length === 1` (out-of-horizon year
     filtered); no `birthDate` ⇒ returns `null`; `deathAge ≤ startAge` ⇒
     `horizonYears === 1` (clamp); `hypothetical === true` without a reached
     projection and `false` with one (pass a minimal
     `{ reached: true, fireYm: '2026-07', series: [] }` stub plus explicit
     `startPortfolioReal` so no series lookup is needed).
   - **F27a addition**: extend the existing `retirementOpts` test with
     `crash` — default `null`, override `{ year: 1, pct: 0.3 }` wins.

## Step 3 — `js/simulation.js` (new builders, pure, nothing persisted)

Append a new section after `retirementCard` (simulation.js:330), banner
`// ── 7. Test krachu (ryzyko sekwencji zwrotów) ──…`. Copy is Plan A §7.8,
ship-ready:

- **`crashResult({ st })`** (`st` = `stressTestRetirement` result):
  - `st == null` (no birthDate) → the same profile prompt wording as
    `retirementResult` (simulation.js:296);
  - hypothetical banner when `st.hypothetical` (wording pattern of
    analysis.js:194): `<div class="banner info small">FIRE poza horyzontem
    prognozy — scenariusz modelowy liczony od dziś.</div>`;
  - one `kv` row per path — „Bez krachu" for `st.base`, then
    „Krach w {k}. roku FIRE" for each scenario (render only the scenarios
    present — year 10 disappears when the horizon is shorter). Values via a local
    helper:
    - survives: `✅ portfel wystarcza do wieku {st.deathAge}
      <span class="muted small">(zostaje {money(endReal)})</span>` — class `good`;
    - depleted: `⚠️ portfel kończy się w wieku {depletedAge}
      <span class="muted small">({depletedYear}. rok wypłat)</span>` — class `warn-text`;
  - punchline paragraph (`<p class="muted small">`): „Ten sam krach dziesięć lat
    później boli mniej — portfel zdążył urosnąć, a część wypłat masz już za sobą.
    O bezpieczeństwie planu decyduje więc nie tylko średni zwrot, ale i to, KIEDY
    przyjdą złe lata. Dlatego niższa stopa wypłat i bezpieczniejszy portfel po
    FIRE to Twoja poduszka.";
  - `metodologia([...])`: „Bez losowania: liczymy zwykłą fazę wypłat i w wybranym
    roku obniżamy portfel o podany procent, a potem liczymy dalej. Dwa terminy
    krachu pokazują tzw. ryzyko sekwencji zwrotów." / „Portfel po FIRE rośnie o
    realny zwrot po FIRE z Twoich ustawień; niczego nie zapisujemy — to podgląd."
- **`crashCard({ pct, deathAge, resultHTML })`** — title `Test krachu 📉`, intro:
  „Największy wróg świeżego emeryta to krach tuż po przejściu na FIRE — portfel
  traci, a Ty i tak musisz z niego żyć. Sprawdź, czy Twój plan przeżyje spadek o
  podany procent: raz w pierwszym roku FIRE, raz — dla porównania — w dziesiątym."
  Two text fields (pattern: `targetAgeCard`, simulation.js:107):
  `<input type="text" id="sym-crash-pct" inputmode="numeric" value="…" placeholder="np. 30">`
  labeled `Spadek portfela <span class="muted">(%)</span>`, and
  `<input type="text" id="sym-crash-age" inputmode="numeric" value="…" placeholder="np. 90">`
  labeled `Dożywam do wieku`. Result container `<div id="sym-crash-result">`.

## Step 4 — `js/ui.js` glue

All inside `renderSymulacja` (ui.js:1310+):

1. **Module vars** — after `symRetPost` (ui.js:1307):
   ```js
   let symCrashPct = '30'; // Krach: % spadku portfela
   let symCrashAge = '90'; // Krach: dożywam do wieku
   ```
2. **Result closure** — after `retirementResult` (ui.js:1462):
   ```js
   const crashResult = () => {
     const pct = Fmt.parsePLN(symCrashPct);
     if (pct == null || pct <= 0 || pct >= 100) return '<div class="field-error">Podaj spadek w procentach (między 0 a 100).</div>';
     const deathAge = Fmt.parsePLN(symCrashAge);
     if (deathAge == null || deathAge <= 0) return '<div class="field-error">Podaj wiek.</div>';
     const st = E.stressTestRetirement(state, { projection: proj, shockPct: pct / 100, shockYears: [1, 10], deathAge });
     if (st && deathAge <= st.startAge) return `<div class="field-error">Podaj wiek większy niż wiek w chwili FIRE (${st.startAge} lat).</div>`;
     return Sim.crashResult({ st });
   };
   ```
3. **Tabs array** (ui.js:1464): insert `['krach', 'Krach']` after
   `['emerytura', 'Emerytura']` (the `.seg-scroll` row already scrolls).
4. **Body chain** (ui.js:1490–1494): add
   `else if (symTab === 'krach') { body = Sim.crashCard({ pct: symCrashPct, deathAge: symCrashAge, resultHTML: crashResult() }); }`.
5. **`nadwyzkaNote` suppression** (ui.js:1501): add `|| symTab === 'krach'`
   (pure preview, adds nothing to the plan) and extend the comment above it.
6. **Event branch** (after the `emerytura` branch, ui.js:1554–1560) — the
   two-text-input pattern of `nadplata`/`kredyt`:
   ```js
   } else if (symTab === 'krach') {
     const refresh = () => { const r = $('#sym-crash-result'); if (r) r.innerHTML = crashResult(); };
     const pEl = $('#sym-crash-pct'); if (pEl) pEl.addEventListener('input', () => { symCrashPct = pEl.value; refresh(); });
     const aEl = $('#sym-crash-age'); if (aEl) aEl.addEventListener('input', () => { symCrashAge = aEl.value; refresh(); });
   ```

No changes to `styles.css` (existing `kv`/`banner`/`field-error`/`good`/`warn-text`
classes cover everything), `index.html` (tab bar unchanged — Symulacja is one
route), `js/analysis.js`, `js/coach.js`, `js/motivation.js`, `js/app.js`.

## Step 5 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change in `sw.js`**. Bump the version in all
three places: `sw.js` `CACHE = 'fire-v1.15.0'`, `index.html` footer
`FIRE Companion v1.15.0`, `js/ui.js` `APP_VERSION = '1.15.0'`. Commit in Polish, e.g.:
`feat: test krachu — deterministyczny stres sekwencji zwrotów w Symulacji (v1.15.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0 (131 existing + new F31 cases; every F13/F27
   expected number byte-for-byte unchanged — the no-crash path is identical code).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **D3 guard**: dashboard FIRE date/verdict/streak identical before vs after;
   - Symulacja → „Krach": default 30%/90 shows three rows; „Bez krachu" matches
     the Analiza withdrawal card's longevity (same engine path, no crash); typing
     50 (%) worsens outcomes live without a full re-render; garbage/empty input →
     Polish `field-error`, no crash; year-1 row never outlives the year-10 row;
   - hypothetical case (FIRE out of horizon, e.g. temp profile with income ≈
     expenses): banner shows, rows still render from today's target;
   - no birthDate: profile prompt instead of results; no `nadwyzkaNote` on this tab;
   - reload → nothing persisted (inputs reset to 30/90, localStorage untouched).
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app + new tab load, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the later batch)

- `retirementOpts` now carries `postReturnReal` + `crash` only; `freezeExpenses` /
  `pension` / `barista` still pending (Plan A §2.1).
- `stressTestRetirement` gains `startYm`/`startPortfolioReal`/`withdrawalRealYearly`
  passthroughs and a `hypothetical` result field (test determinism + UI banner) —
  not in the §2.9 signature.
- `projectWithdrawal` gains only `crash`/`crashed`/`crashApplied` from §2.5; the
  pension/growth/net-withdrawal row fields stay for the batch.
- Tests: F31 consumed (split a/b/c/d slightly differently than §6 — crash-mechanics
  unit test added as F31a); F29/F30/F32 remain reserved.
- Version v1.15.0 is consumed by this standalone release.
