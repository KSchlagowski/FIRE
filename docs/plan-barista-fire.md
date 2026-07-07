# Barista FIRE — what-if partial income after FIRE (`ro.barista`)

## Context

Classic FIRE assumes work income stops dead at the FIRE month. In reality many
people downshift instead: quit the full-time job but keep earning something — a
half-time gig, freelance work, the proverbial barista shift. That income covers
part of the expenses for a while, so the portfolio only has to carry the
**difference** during those years and the full load afterwards. Result: a smaller
required portfolio and (usually) an earlier FIRE date.

This feature adds a **Symulacja tab „Barista"** — a pure what-if calculator with
two inputs:

- **X = `monthly`** — net partial income after FIRE, zł/month, **today's PLN
  (real)**, modeled flat-real (a wage roughly tracks inflation; same convention
  as the ZUS pension);
- **Y = `untilAge`** — the age at which that income stops (integer years, D8).

It shows the required portfolio with and without the side income, the difference,
and the new FIRE date. **Nothing is persisted** — `barista` is a what-if override
only, it never enters `state.assumptions` (Plan A §2.1: "what-if only, never
persisted"). There is no plan setting, no migration, no schema bump.

This is **Feature 4 of `plans/A-retirement-projection.md`** (the authoritative
design; decisions **D1, D3, D7, D8** there are the spec), implemented
**standalone** — per user decision the remaining batch features (crash stress
test, projection bands) are still NOT built now. Ships as a normal standalone
release with a **Polish commit**.

## Hard prerequisite — the ZUS bridge must land first

`docs/plan-zus-pension-bridge.md` (Feature 3) creates everything Barista plugs
into:

- the **one PV implementation**: private `pvOfRetirement` (backward loop) +
  `netWithdrawalYear` (the single definition of the yearly net withdrawal `w_n`);
- **`bridgeTargetAt`** (two-phase target) and **`projectBridgeFire`** (the scan
  for the new FIRE date) — Barista reuses both, adding one offset;
- the `pension` field in `retirementOpts` and the pension row fields on
  `projectWithdrawal`/`projectDieWithZero` rows;
- schema **v5** (`pensionMonthly`/`pensionAge` migration).

**If the ZUS bridge is not yet implemented when this plan runs: implement it
first, in full.** Do not cherry-pick parts of it — the ZUS plan's deviations
section explicitly reserves the extension seam for Barista ("Barista later
extends `w_n` with one more offset and passes `untilAge` through `ro`, nothing
else"). Anchor every edit below by **artifact names, not line numbers**.

## Current tree state (verified 2026-07-07)

- App at **v1.16.0** (fullscreen-landscape charts, `js/charts.js`); schema **v4**
  (bonds v1.14.0 + expense freeze v1.15.0 shipped). The ZUS bridge is **not**
  implemented yet (no `pensionMonthly`, `bridgeTargetAt` or `projectBridgeFire`
  anywhere in `js/`).
- `retirementOpts` currently returns `{ postReturnReal, freezeExpenses }`.
- **Test letters consumed in the tree**: F27a–d/f/g, F28a/b/d/e/f, and — note —
  **F29a–e are taken by the `charts.js` suite** (the charts split shipped after
  Plan A was written). F27e/F27h/F28c are reserved for the ZUS bridge. Plan A's
  reservation of "F29e/F29f" for Barista is therefore **stale**: at ZUS
  implementation time its `bridgeTargetAt`/`projectBridgeFire` suites must take
  the next free numbers — this plan writes them as **F30** (bridgeTargetAt) and
  **F31** (projectBridgeFire). If the actual ZUS release used different letters,
  join whatever suites it created; anchor by suite content, not by the letter.

## Locked semantics (Plan A D1/D3/D7/D8 — do not re-derive)

- **D7 — Net-withdrawal floor at zero.** The yearly amount taken **from the
  portfolio** is `w_n = max(0, E_n − pens_n − bar_n)`. Income above expenses is
  spent/gifted, never modeled as re-contribution. Keeps targets monotone, paths
  non-negative.
- **D8 — Year granularity.** Barista is active in retirement year *n* iff
  `ageAt(birth, addMonths(startYm, (n−1)·12)).years < untilAge`. Bridge length
  `B` is an integer count of years.
- **D3 — The core FIRE condition and verdicts do not change.** The Barista date
  is an analysis-layer scan (`projectBridgeFire`), same precedent as the ZUS
  card and „do zera".
- **D1 — Retirement month = the withdrawal `startYm`** (`fireYm` when reached,
  `todayYm()` in the hypothetical scenario).
- **Missing `birthDate`** ⇒ barista is unknowable: `projectBridgeFire` returns
  `null`; inside `projectWithdrawal` the offset is simply ignored
  (`baristaReal = 0` on all rows) — mirror of the pension guard.
- **Barista amount is real and flat** (today's PLN); it does **not** grow with
  `expenseGrowthReal` even when the freeze is off (same rule as the pension, D6
  rationale: lifestyle inflation is yours, not your employer's).

## Math (Plan A §1 with the barista offset — no new machinery)

At retirement month `ym`: `W₁ = fireTargetAt(state, ym) × withdrawalRate`;
`g = freezeExpenses ? 0 : expenseGrowthReal`, `G = 1 + g`;
`r = ro.postReturnReal`, `q = 1/(1+r)`; `age0 = ageAt(birth, ym).years`.

- Gross expense in retirement year *n*: `E_n = W₁·G^(n−1)`.
- Offsets: `pens_n = 12·pension.monthly` if `age0 + (n−1) ≥ pensionAge` else 0;
  **`bar_n = 12·barista.monthly` if `age0 + (n−1) < untilAge` else 0**.
- Net withdrawal `w_n = max(0, E_n − pens_n − bar_n)` (D7); recurrence
  `P_n = (P_{n−1} − w_n)·(1+r)`.
- **Bridge length**:
  `B = max(0, pensionOn ? pensionAge − age0 : 0, baristaOn ? untilAge − age0 : 0)`.
  Terminal (start of year B+1, both streams settled — barista has ended by
  construction, only the pension can persist):
  `terminal = max(0, E_{B+1} − pens_{B+1}) / withdrawalRate`, `E_{B+1} = W₁·G^B`.
  Then the ZUS release's backward loop (`pvOfRetirement`) over years 1..B seeded
  with `terminal`. Interior structure (pension starting before barista ends, or
  a gap between barista end and pension start) is handled by the year-by-year
  `w_n` — **no phase split, no case analysis**.
- Closed form used by TESTS as the spec (flat case, freeze on):
  `target = Σ_{n=1..B} w_n·q^(n−1) + terminal·q^B`; at `r = 0` (q = 1) simply
  `Σ w_n + terminal`.

**⚠ Correction to Plan A's worked example (F29e).** Plan A asserts, at `r = 0`,
`target = 14·(72000−36000) + 1800000 = 2 304 000` **and** "barista target <
classic target" — but the classic target is `72000/0.04 = 1 800 000`, so the
inequality is **false at r = 0**. Both statements cannot hold: at `r = 0` the
bridge years are undiscounted, and funding them plus the full classic terminal
always costs more than the classic target alone. The strict inequality only
holds when the post-FIRE return is high enough relative to the withdrawal rate
(at `r = 5%`, the same inputs give ≈ `1 283 000 < 1 800 000` ✓). Consequence for
tests (§ Tests below): assert the **arithmetic identity at r = 0** and the
**inequality at r = 5%** as two separate cases — do not chase a "failing"
combined assertion. Consequence for UI (§ simulation.js): with the default
post-FIRE return (2%) **below** the 4% withdrawal rate and no ZUS pension, a
small side income can legitimately show a **higher** required portfolio than
classic — the copy must explain this instead of hiding it.

## Step 1 — `js/engine.js`

All edits extend artifacts created by the ZUS release; the retirement-phase
banner section already exists.

1. **`retirementOpts`** — add the field (no persisted default exists, so plain
   `!= null` idiom is fine here):
   ```js
   barista: overrides.barista != null ? overrides.barista : null,
   // { monthly, untilAge } — wyłącznie what-if z Symulacji; nigdy nie zapisywane
   ```
   Consumers guard with
   `const barOn = !!(ro.barista && ro.barista.monthly > 0 && birth);`.
2. **`netWithdrawalYear`** (the ZUS release's single `w_n` definition) — add the
   barista offset per the Math section; return shape gains `barista`:
   `{ gross, pension, barista, net }`. This is the ONLY place the age test
   `age0 + (n−1) < untilAge` lives.
3. **`bridgeTargetAt`** — extend the bridge length to
   `B = max(0, pensionB, baristaB)` with
   `baristaB = barOn ? ro.barista.untilAge − age0 : 0`. The terminal formula is
   untouched (barista has ended by construction). Result gains
   `baristaYearly` (= `12·ro.barista.monthly` when barista is active at `ym`,
   i.e. `barOn && untilAge > age0`, else `0`).
4. **`projectWithdrawal` / `projectDieWithZero`** — nothing structural: the
   offset rides in through the shared `w_n` helper. Rows gain
   `baristaReal, baristaNominal` next to the pension fields (nominal = real ×
   `(1+infl)^(n−1)`, same epoch); `netWithdrawalReal` now nets out both streams.
   No signature change.
5. **`projectBridgeFire`** — no scan change (the target function already goes
   through `bridgeTargetAt` with `ro`). Result gains the echo fields
   `baristaYearly` (at `startYm`), `baristaMonthly`, `baristaUntilAge` so pure
   builders can render copy without state access (same precedent as
   `pensionMonthly`/`pensionAge` from the ZUS release and
   `withdrawalGrowthReal` from the freeze release).

Do NOT touch: `fireTargetAt`, `projectFire`, `replayBalances`, `buildPlan`,
`oneOffImpact`, `fiStats`, `swrComparison`, `projectionWith`,
`requiredSavingsForGoal`, `solveExtraSavingsForAge`, `defaultAssumptions`,
`createState` — no persisted field means no version constant changes (D3, and
the "never persisted" rule above).

## Step 2 — `js/storage.js`: NO changes

First retirement-phase feature with zero storage surface: no `SCHEMA_VERSION`
bump, no migration case, no `validateState` change, no `createState` version
edit. If you find yourself editing `storage.js`, you are off-plan.

## Step 3 — tests (run `node tests/run-tests.js`; green before any UI work)

**No `baseState()` touch-up is needed** — `barista` defaults to `null` (inert),
so every existing expected number stays byte-identical. That is the headline
regression claim of this release.

Letters below assume the ZUS release created **F30 = bridgeTargetAt** and
**F31 = projectBridgeFire** (see Current tree state); Barista's cases join those
suites with the next free letters. Closed forms computed in-test ARE the spec
(F26/F27 style); the engine uses the backward loop — parity is the test.

1. **Fixture** (`tests/fixtures.js`): one header comment line (Barista FIRE) +
   `BARISTA: { monthly: 3000, untilAge: 40 }` appended to the ZUS release's F30
   fixture entry (or its own key if that entry is closed — cosmetic).
2. **New tests** (`tests/test-engine.js`):
   - **`retirementOpts` barista field** (next free F27 letter, e.g. F27i):
     default `null` on `createState()`; an override object passes through
     verbatim; explicit `barista: null` stays `null`; purity (state JSON
     unchanged).
   - **`projectWithdrawal` barista offset + floor** (e.g. F27j): baseState with
     birthDate; `ro` override with `{ monthly: 3000, untilAge }` where
     `untilAge` is derived in-test from `ageAt` so the boundary falls mid-table:
     rows with `age < untilAge` have `baristaReal === 36000` and
     `netWithdrawalReal === Math.max(0, withdrawalReal − pensionReal − 36000)`;
     the first row with `age ≥ untilAge` has `baristaReal === 0`; recurrence
     uses net (recompute one row by hand). With a huge `monthly` the net floors
     at exactly 0 and `endReal > startReal`. With no `birthDate`: all
     `baristaReal === 0`.
   - **`dieWithZeroTargetAt` barista integer case** (e.g. F28g):
     `postRetirementReturnReal: 0`, freeze on, no pension, barista active for
     `B` of `N` years ⇒ `target = B·(W₁ − 36000) + (N−B)·W₁` computed in-test;
     barista ≥ W₁ ⇒ the covered years contribute exactly 0 (floor);
     `untilAge ≤ age0` ⇒ target equals the no-barista target exactly.
   - **`bridgeTargetAt` barista identity at r = 0** (F30 suite, Plan A's
     "F29e" first half): the Plan A worked example —
     `target = B·(W₁ − barYearly) + W₁/wr` with `B` from `ageAt` in-test.
     **Do NOT assert `target < targetClassic` here** (see the Math correction).
   - **`bridgeTargetAt` barista inequality at r = 5%** (same suite, second
     half): identical inputs but `postRetirementReturnReal: 0.05` ⇒ `target`
     equals `Σ w_n·q^(n−1) + terminal·q^B` computed in-test AND
     `target < targetClassic`. Also: `baristaYearly === 36000` echoed;
     `untilAge ≤ age0` ⇒ full identity with the no-barista result.
   - **Combined pension + barista** (Plan A's "F29f"): with both streams,
     `target ≤` each single-offset target (monotonicity — more income never
     raises the requirement *within the same construction*); purity.
   - **`projectBridgeFire` barista override** (F31 suite): on a reaching state
     (F13b-style, `postRetirementReturnReal: 0.05`) a meaningful barista
     override ⇒ `fireYm` **not later** than the no-barista `fireYm` (strictly
     earlier for a large enough amount); `hypothetical`/`startYm`/same-month
     echo rules unchanged (F24g precedent); result echoes
     `baristaMonthly`/`baristaUntilAge`.
3. Confirm untouched: F13/F24/F27/F28 numbers, the ZUS release's suites, F29
   (charts), F27f version-sync (no version change at all this time).

## Step 4 — `js/analysis.js`: NO changes

Analiza always computes with the persisted `retirementOpts(state)` — `barista`
is never persisted, so no Analiza card, table column or metodologia line can
ever see it. (The row fields added in Step 1 surface only in tests and in the
Symulacja closures.)

## Step 5 — `js/simulation.js` (pure, nothing persisted)

New banner section after the „Emerytura" builders:
`// ── 7. Barista FIRE (dorabianie po FIRE) ────────────────────────────────`.

1. **`baristaCard({ amount, untilAge, resultHTML })`** (copy from Plan A §7.7):
   ```html
   <div class="card"><h2>Barista FIRE ☕💼</h2>
     <p class="muted small">Nie musisz rzucać pracy z dnia na dzień. Jeśli po FIRE
       dorobisz kilka tysięcy miesięcznie — pół etatu, zlecenia — portfel może być
       mniejszy, a FIRE bliżej. Czysta symulacja, niczego nie zapisujemy.</p>
     <label class="field"><span class="lbl">Dorabiam po FIRE <span class="muted">(zł/mies. netto)</span></span>
       <input type="text" id="sym-barista" inputmode="decimal" value="${esc(amount)}" placeholder="np. 3000">
       <div class="hint">Kwota w dzisiejszych złotówkach.</div></label>
     <label class="field"><span class="lbl">Dorabiam do wieku</span>
       <input type="text" id="sym-barista-age" inputmode="numeric" value="${esc(untilAge)}" placeholder="np. 55"></label>
     <div id="sym-barista-result">${resultHTML}</div>
   </div>
   ```
2. **`baristaResult({ pb, pbBase, amount, untilAge })`** — `pb` =
   `projectBridgeFire` with the barista override, `pbBase` = the same call with
   the **persisted** `retirementOpts(state)` (see Step 6 and the Deviations
   section — the baseline is pension-aware, NOT the bare classic target).
   Layout (module-local `kv`/`money`/`signed`/`gainLine`/`fireCell` as in the
   other builders):
   - hypothetical banner when `pb.hypothetical`: „FIRE poza horyzontem prognozy
     — scenariusz modelowy liczony od dziś." (same string as the ZUS card);
   - `kv('Potrzebny portfel (Barista)', money(pb.target))`;
   - `kv(pensionOn ? 'Potrzebny portfel (bez dorabiania, z ZUS)'
       : 'Potrzebny portfel (bez dorabiania)', money(pbBase.target))` where
     `pensionOn = !!(pb.ro.pension && pb.ro.pension.monthly > 0)`;
   - `kv('Różnica', signed(pb.target − pbBase.target), diff <= 0 ? 'good' : 'warn-text')`;
   - `kv('Data FIRE (Barista)', fireCell(pb.fireYm, pbBase.fireYm))`;
   - `gainLine(pb.fireYm, pbBase.fireYm)`;
   - when `pb.baristaYearly === 0` (age boundary at or before `startYm`):
     „<p class="muted small">W miesiącu startu wypłat masz już ${pb.startAge}
     lat — dorabianie do wieku ${untilAge} nie obejmuje ani roku po FIRE.
     Podaj późniejszy wiek.</p>";
   - metodologia:
     - „Dorobione pieniądze zmniejszają wypłaty z portfela, dopóki dorabiasz;
       od podanego wieku portfel przejmuje pełne wydatki (klasyczna stopa
       wypłat). Ten sam rachunek co przy moście ZUS — najpierw lżejsze lata,
       potem pełny cel."
     - (when `pensionOn`) „Emerytura z ZUS z Twoich ustawień jest uwzględniona
       w obu wariantach — różnica pokazuje czysty efekt dorabiania."
     - „Po FIRE portfel pracuje na realny zwrot po FIRE (z ustawień). Gdy jest
       niższy niż Twoja stopa wypłat, lata «na moście» są drogie — przy małym
       dorabianiu cel może wyjść nawet wyższy niż klasyczny. To nie błąd, tylko
       cena bezpieczniejszego portfela." (the Math-correction consequence)
     - „Kwota w dzisiejszych złotówkach, stała realnie. Niczego nie zapisujemy
       — to podgląd."

## Step 6 — `js/ui.js` glue

1. **Module vars** (next to `symRetFreeze`):
   ```js
   let symBarista = '';    // Barista: dorabiane zł/mies. (string)
   let symBaristaAge = ''; // Barista: do wieku (string)
   ```
2. **Tabs array** — insert `['barista', 'Barista']` after
   `['emerytura', 'Emerytura']` (the `.seg-scroll` row already scrolls).
3. **Result closure** (sibling of `retirementResult()`; validation wording
   pattern-copied from `whatIfResult`/`targetAgeResult`):
   ```js
   const baristaResult = () => {
     if (!state.profile.birthDate) return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć wariant Barista.</p>';
     const rawA = String(symBarista).trim(), rawW = String(symBaristaAge).trim();
     if (rawA === '' || rawW === '') return '<p class="muted small">Podaj kwotę i wiek, aby zobaczyć efekt dorabiania.</p>';
     const amount = Fmt.parsePLN(rawA);
     if (amount == null || amount < 0) return '<div class="field-error">Podaj kwotę: 0 lub więcej.</div>';
     const ageY = Fmt.parsePLN(rawW);
     if (ageY == null || ageY <= 0 || ageY > 100) return '<div class="field-error">Podaj realny wiek (1–100).</div>';
     const currentAge = E.ageAt(state.profile.birthDate, nowYm).years;
     if (ageY <= currentAge) return `<p class="muted small">Podaj wiek większy niż Twój obecny (${currentAge}).</p>`;
     const ro = E.retirementOpts(state, { barista: { monthly: amount, untilAge: Math.round(ageY) } });
     const pb = E.projectBridgeFire(state, { projection: proj, ro });
     const pbBase = E.projectBridgeFire(state, { projection: proj });
     return Sim.baristaResult({ pb, pbBase, amount, untilAge: Math.round(ageY) });
   };
   ```
   Note the override passes **only** `barista` — the persisted pension and
   post-FIRE settings ride along in both `ro`s, so the comparison isolates the
   side-income effect.
4. **Body branch**: `else if (symTab === 'barista') { body = Sim.baristaCard({
   amount: symBarista, untilAge: symBaristaAge, resultHTML: baristaResult() }); }`.
5. **`nadwyzkaNote` suppression** — add `|| symTab === 'barista'` to the
   exclusion condition (the tab does not add amounts to the plan; extend the
   comment above it).
6. **Event wiring** (sibling of the `emerytura` branch): `#sym-barista` and
   `#sym-barista-age` on `'input'` → update the module var, swap
   `#sym-barista-result` innerHTML. Nothing persists (module vars only).

No `index.html`, `styles.css`, `sw.js`, `app.js`, `coach.js`, `motivation.js`,
`format.js`, `charts.js` changes.

## Step 7 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three
places to the **next free minor at implementation time** — written here as
**v1.18.0** on the assumption the ZUS bridge ships as v1.17.0 (adjust if
consumed): `sw.js` `CACHE = 'fire-v1.18.0'`, `index.html` footer
`FIRE Companion v1.18.0`, `js/ui.js` `APP_VERSION = '1.18.0'`. Update the
CLAUDE.md Tests paragraph with one sentence naming the Barista cases. Commit in
Polish, e.g.:
`feat: Barista FIRE — dorabianie po FIRE jako what-if w Symulacji (v1.18.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0; every pre-existing expected number
   unchanged (barista `null` = inert — no baseState touch-up was needed, so any
   legacy diff is a bug in the offset plumbing).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **D3 guard**: dashboard FIRE date/verdict identical before vs after;
   - Symulacja → „Barista": empty fields → prompt; amount 3000 + age above the
     projected FIRE age → target drops vs base, FIRE date earlier or equal,
     `gainLine` matches the date shift; age ≤ current age → the guard message;
     age at/below the FIRE age → the „nie obejmuje ani roku po FIRE" note and
     zero difference;
   - **honest-penalty case**: set `pensionMonthly = 0` and post-FIRE return 2%,
     enter a small amount (e.g. 200 zł) — „Różnica" may be positive and styled
     `warn-text`, and the metodologia line explains why;
   - with `pensionMonthly > 0` the base row reads „(bez dorabiania, z ZUS)" and
     equals the Analiza ZUS-card target for the same month;
   - amount `0` → result identical to base (identity), no error;
   - reload → inputs reset, nothing persisted; other tabs unaffected;
   - `nadwyzkaNote` absent on the Barista tab.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the batch)

- **Comparison baseline**: Plan A §4.2 compared the Barista target against the
  bare classic target (`pb.targetClassic`) and the classic FIRE date
  (`baseFireYm`). This plan compares against **`pbBase` = `projectBridgeFire`
  with the persisted `retirementOpts(state)`** instead. Rationale: after the ZUS
  release, `pensionMonthly` defaults to > 0, so the persisted `ro` already
  contains the pension — comparing barista+pension against no-pension classic
  would attribute the ZUS effect to the side income. With `pensionMonthly = 0`
  the two baselines coincide (the ZUS plan's B = 0 identity), so nothing from
  Plan A's design is lost.
- **Plan A's F29e assertion pair is arithmetically inconsistent at r = 0** (see
  the Math correction above): the identity and the `< classic` inequality are
  split into two test cases at r = 0 and r = 5% respectively, and the UI gains
  an honest metodologia line for the `r < withdrawalRate` regime.
- **Test letters shifted**: the charts split consumed F29, so Plan A's
  "F29e/F29f" land in the suites the ZUS release actually created (written here
  as F30/F31), plus fresh F27/F28 letters for the offset plumbing.
- **Result echo fields** `baristaYearly`/`baristaMonthly`/`baristaUntilAge` on
  `projectBridgeFire` are not in Plan A's sketch — added so pure builders render
  copy without state access (the `withdrawalGrowthReal`/`pensionMonthly`
  precedent). Keep them when the batch lands.
- Plan A §2.5's `crashed` row field and the crash machinery belong to Feature 5
  (crash stress test) and are **not** touched here.
