# ZUS pension bridge — two-phase withdrawal (`pensionMonthly`, `pensionAge`)

## Context

Today every withdrawal-phase target assumes the portfolio carries **all** expenses
forever (classic SWR) or until `deathAge` ("do zera"). In reality a Polish user gets a
**state pension from ZUS** at the statutory retirement age (65 men / 60 women), which
permanently covers part of the expenses. The portfolio therefore only has to carry
*full* expenses on the **bridge** — from the FIRE month to the pension age — and after
that a smaller portfolio suffices: `(expenses − pension) / SWR`. This usually moves the
FIRE date **years earlier**, which is exactly the kind of motivating, honest number
this app exists to show.

The feature adds:

1. two **persisted plan settings**: `assumptions.pensionMonthly` (zł/month, **today's
   PLN**, default **1 978,49** — the minimum pension effective March 2026, an
   intentionally visible placeholder the user overwrites with the number from their
   yearly ZUS letter „Informacja o stanie konta / hipotetyczna emerytura") and
   `assumptions.pensionAge` (default **65**; help text tells women to set 60);
2. a **two-phase FIRE target** `bridgeTargetAt` + a scan `projectBridgeFire` for the
   new (usually earlier) FIRE date — displayed on a new **Analiza card „Most do
   emerytury ZUS"**;
3. **pension offsets in the withdrawal tables**: `projectWithdrawal` and
   `projectDieWithZero` subtract the pension from the yearly withdrawal once the
   pension age is reached (floored at zero), and the Analiza tables grow a ZUS column;
4. an **Analiza „Do zera" checkbox** to include/exclude ZUS in the die-with-zero
   scenario, and **Symulacja „Emerytura" what-if fields** (amount + age, nothing
   persisted).

This is **Feature 3 of `plans/A-retirement-projection.md`** (the authoritative design;
decisions **D6, D7, D8** there are the spec), implemented **standalone** — per user
decision the remaining batch features (Barista, crash test, projection bands) are
still NOT built now. Ships as a normal standalone release with a **Polish commit**.

## Prerequisites & current tree state

Features 1 and 2 of Plan A have **already shipped**:

- **bonds switch** (v1.14.0, `docs/plan-bonds-switch-at-retirement.md`) created the
  `retirementOpts(state, overrides)` seam, `ro` plumbing into `projectWithdrawal` /
  `dieWithZeroTargetAt` (4th param) / `projectDieWithZero`, the Plan → Profil i FIRE
  subsection „Po przejściu na FIRE" (`pl-postret`), and the Symulacja „Emerytura" tab
  (`retirementCard`/`retirementResult`, `#sym-ret-post`, module var `symRetPost`);
- **expense freeze** (v1.15.0, `docs/plan-expense-freeze-at-retirement.md`) added
  `freezeExpenses` to the seam, `withdrawalGrowthReal` on results, `pl-freeze`,
  `#sym-ret-freeze` + `symRetFreeze`, and bumped the schema to **v4**
  (`SCHEMA_VERSION = 4`, `case 3` migration).

So this plan starts from: schema **v4**; `retirementOpts` returning
`{ postReturnReal, freezeExpenses }`; `dieWithZeroTargetAt` using the **closed form**
with `x = G/(1+r)`; test letters F27a–d/f/g and F28a/b/d/e/f consumed, **F27e and F28c
reserved for this feature**, F29/F30 free.

**In-flight, unrelated work in the working tree** (fullscreen-landscape charts,
`docs/plan-fullscreen-landscape-charts.md`): `js/ui.js` has `chartSVG`/`stackedBarSVG`
extracted to a new `js/charts.js`. This plan does not touch charts; anchor every edit
by **artifact names, not line numbers**. If that feature ships first it consumes a
version number and adds `js/charts.js` to `PRECACHE` — independent of this plan. Use
the **next free minor version** at implementation time; this doc writes it as
**v1.16.0** (adjust if consumed).

## Locked semantics (Plan A D1/D3/D6/D7/D8 — do not re-derive)

- **D6 — Pension defaults & model.** `pensionMonthly: 1978.49`, `pensionAge: 65`.
  The amount is in **today's PLN (real)** and is modeled **flat-real** (ZUS indexation
  ≈ inflation); it does **not** grow with `expenseGrowthReal` even when the freeze is
  off — lifestyle inflation is yours, not ZUS's. `pensionMonthly = 0` disables the
  feature everywhere (no card, no checkbox, no column, all targets degrade to classic).
- **D7 — Net-withdrawal floor at zero.** The yearly amount taken **from the
  portfolio** is `max(0, expenses_n − pension_n)`. Pension above expenses is
  spent/gifted, never modeled as re-contribution. Keeps targets monotone, paths
  non-negative, and avoids "borrowing against future ZUS" inside PVs.
- **D8 — Year granularity.** All retirement-phase math is yearly. Ages are integer
  years via `ageAt(...).years`; pension is active in retirement year *n* iff
  `ageAt(birth, addMonths(startYm, (n−1)·12)).years ≥ pensionAge`. Bridge length `B`
  is an integer count of years.
- **D3 — The core FIRE condition and verdicts do not change.** `projectFire`,
  `fireTargetAt`, verdicts, streak, dashboard headline date: all untouched. The
  bridge date is an **analysis-layer scan** over the existing projection series —
  same precedent as `projectDieWithZero`.
- **D1 — Retirement month = the withdrawal `startYm`** (`fireYm` when reached,
  `todayYm()` in the hypothetical scenario) — never `familyFreeYm`.
- **Missing `birthDate`** ⇒ pension is unknowable: `projectBridgeFire` returns `null`
  (like `projectDieWithZero`); inside `projectWithdrawal` the pension is simply
  ignored (rows keep `pensionReal = 0`).

## Math (Plan A §1 specialized to pension — one PV loop)

At retirement month `ym`: `W₁ = fireTargetAt(state, ym) × withdrawalRate` (yearly
expenses at retirement, real; includes rent-forever when no house plan);
`g = freezeExpenses ? 0 : expenseGrowthReal`, `G = 1 + g`; `r = ro.postReturnReal`,
`q = 1/(1+r)`; `age0 = ageAt(birth, ym).years`.

- Gross expense in retirement year *n*: `E_n = W₁·G^(n−1)`.
- Pension offset: `pens_n = 12·pensionMonthly` if `age0 + (n−1) ≥ pensionAge` else 0.
- **Net withdrawal**: `w_n = max(0, E_n − pens_n)` (D7).
- Recurrence (unchanged convention): `P_n = (P_{n−1} − w_n)·(1+r)` — annuity-due,
  withdrawal at the start of the year.

**PV to an exact terminal value — the backward loop** (exact, O(years), handles
growth + offsets + floor without case analysis; this ONE implementation serves the
die-with-zero target now and Barista later):

```
P = terminal;
for (n = years; n >= 1; n--) P = P/(1+r) + w_n;   // P = required portfolio at ym
```

Equivalent closed forms (used by TESTS as the spec, not by the engine):
`P₀ = Σ w_n·q^(n−1) + terminal·q^years`; with no offsets and terminal 0 this is the
existing `W₁·(1−(Gq)^N)/(1−(Gq))` (and `N·W₁` when `Gq → 1`).

**Bridge target**: `B = max(0, pensionOn ? pensionAge − age0 : 0)`.
Terminal (portfolio needed at the start of year B+1, when the pension flows):
`terminal = max(0, E_{B+1} − 12·pensionMonthly) / withdrawalRate` where
`E_{B+1} = W₁·G^B`. Then the backward loop over years 1..B seeded with `terminal`.
Identities: pension off ⇒ `B = 0`, `terminal = W₁/withdrawalRate =
fireTargetAt(state, ym)` **exactly** (test F29a); `age0 ≥ pensionAge` ⇒ `B = 0`,
`target = terminal` (F29d). The freeze-off terminal uses the classic SWR on the
residual even though expenses keep growing — a locked approximation (D4 precedent:
the SWR perpetuity cannot encode growth).

## Step 1 — `js/engine.js`

All new code goes into the existing retirement-phase area (after the „do zera"
block); extend the section banner comment to name the bridge.

1. **`retirementOpts`** — add the pension field. Deliberate exception to the file's
   `!= null` idiom: `null` is a meaningful override ("disable pension"), so test
   `!== undefined`:
   ```js
   pension: overrides.pension !== undefined
     ? overrides.pension                 // null ⇒ ZUS wyłączony w tym what-ifie
     : { monthly: a.pensionMonthly != null ? a.pensionMonthly : 0,
         fromAge: a.pensionAge != null ? a.pensionAge : 65 },
   ```
   Update the doc comment (the „Kolejne pola (ZUS…)" note is now fulfilled).
   Consumers guard with `const pensionOn = !!(ro.pension && ro.pension.monthly > 0 && birth)`.
2. **Private helper `netWithdrawalYear(ro, a, birth, ym, W1, n)`** (or an inline
   closure shared per function — keep ONE definition of `w_n`): returns
   `{ gross, pension, net }` for retirement year *n* per the Math section. This is
   the single place the floor and the age test live.
3. **Private helper `pvOfRetirement(...)`** — the backward loop of the Math section
   over `years` seeded with `terminal`, calling the `w_n` helper. Used by
   `dieWithZeroTargetAt` and `bridgeTargetAt` — **exactly one PV implementation**
   (Plan A acceptance item; Barista reuses it later).
4. **`dieWithZeroTargetAt(state, ym, deathAge, ro)`** — replace the closed form with
   `pvOfRetirement` over `N = deathAge − age0` years, `terminal = 0`. Result shape
   (`{ target, yearsN, withdrawalYear1 }`) and the `birthDate`/`yearsN ≥ 1` guards
   unchanged. With pension inert the loop reproduces the closed form algebraically —
   existing F24/F28a/F28b/F28e assertions become the loop≡closed-form parity tests
   and **must keep passing with unchanged expected numbers** (float residue of the
   loop is ~1e-9 relative; if an exact `assertEq` trips, that's a bug in the loop,
   not a reason to touch the fixture). Note in the doc comment that the scan calls
   this per month, now O(N) per call — ≤ 720 × 110 iterations, negligible
   (precedent: sensitivity reruns are 13 × 720 full projections).
5. **NEW `bridgeTargetAt(state, ym, ro = retirementOpts(state))`** →
   `{ target, targetClassic, bridgeYears, terminalTarget, withdrawalYear1,
   pensionYearly } | null` (no `birthDate` ⇒ null). Math per the Math section;
   `targetClassic = fireTargetAt(state, ym)` echoed for the UI comparison;
   `pensionYearly = pensionOn ? 12·ro.pension.monthly : 0`.
6. **NEW private `scanFireBy(state, projection, now, targetFn, stopFn)`** — extract
   the existing scan loop from `projectDieWithZero` verbatim (the `nowIdx` skip, the
   **liability-start gate** `gateIdx`, the settled + `portfolio ≥ target − EPS`
   condition), with `targetFn(ym) → { target, … } | null` and optional
   `stopFn(ym) → bool` (dz passes the `age ≥ deathAge` break; bridge passes none).
   Returns `{ fireYm, t }`. `projectDieWithZero` and `projectBridgeFire` both call
   it — the two scans stay in lockstep forever.
7. **NEW `projectBridgeFire(state, { projection = null, ro = retirementOpts(state), now } = {})`**
   → `{ fireYm, classicFireYm, hypothetical, startYm, startAge, target,
   targetClassic, bridgeYears, terminalTarget, withdrawalYear1, pensionYearly,
   pensionMonthly, pensionAge, ro } | null` (no `birthDate`). Scan via `scanFireBy`
   with `targetFn = ym => bridgeTargetAt(state, ym, ro)`; fallback rules identical
   to `projectDieWithZero` (`hypothetical`, `startYm = fireYm ?? todayYm(now)`);
   `classicFireYm = projection && projection.reached ? projection.fireYm : null`;
   all targets echoed **at `startYm`** (same-month comparison rule — the F24g/„ten
   sam miesiąc" precedent).
8. **`projectWithdrawal`** — pension offsets in the yearly loop (via the shared
   `w_n` helper): per row compute `pensionReal` and
   `netWithdrawalReal = max(0, withdrawalReal − pensionReal)`; the recurrence and
   `growthReal` use **net** (`endReal = (startReal − netWithdrawalReal)·(1+realRate)`).
   Row gains `pensionReal, pensionNominal, netWithdrawalReal, netWithdrawalNominal`
   (nominal = real × `(1+infl)^(n−1)`, same epoch as the other columns).
   `withdrawalReal` keeps meaning **gross** expenses. `depletedYear` logic unchanged
   (the portfolio story ends at depletion even though the pension keeps flowing —
   UI copy names this). No signature change — the pension rides in through `ro`.
9. **`projectDieWithZero`** — the yearly table gets the same treatment (gross,
   pension, net columns; recurrence on net). The target now comes from the
   generalized `dieWithZeroTargetAt`, so starting the table from exactly `target`
   still ends at **0 in year N** (the loop is the inverted recurrence; the existing
   `Math.abs(endReal) <= EPS` clamp absorbs float residue). The scan moves to
   `scanFireBy` (pure refactor). Both return objects keep their shape plus the new
   row fields.
10. **`defaultAssumptions()`** — append
    `pensionMonthly: 1978.49,  // D6 — emerytura minimalna od marca 2026 (placeholder do nadpisania kwotą z listu ZUS)`
    and `pensionAge: 65,  // ustawowy wiek: 65 M / 60 K`.
11. **`createState`** — bump the hardcoded `version: 4` → `version: 5` (must equal
    `storage.SCHEMA_VERSION`; the F27f sync test enforces it).

Do NOT touch: `fireTargetAt`, `projectFire`, `replayBalances`, `buildPlan`,
`oneOffImpact`, `fiStats`, `swrComparison`, `coastFire`, `projectionWith`,
`requiredSavingsForGoal`, `solveExtraSavingsForAge` — the classic target, verdicts
and the accumulation phase are out of scope by D3.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 5;`
2. In `migrate`, replace `case 4: break;` with:
   ```js
   case 4: {
     // v4 → v5: most ZUS — prognozowana emerytura (dziś: minimalna) i wiek emerytalny.
     const a = cur.assumptions || (cur.assumptions = {});
     if (typeof a.pensionMonthly !== 'number') a.pensionMonthly = 1978.49;
     if (typeof a.pensionAge !== 'number') a.pensionAge = 65;
     cur.version = 5;
   }
   // fall-through
   case 5:
     break;
   ```
3. `validateState`: **no change** (not load-critical; migration backfills and
   `retirementOpts` has fallbacks — same precedent as v2→v3 and v3→v4).

Note the deliberate consequence: after migration **existing users see the ZUS card
and column with the minimum-pension placeholder** — D6 wants the placeholder visible
so it gets corrected, and `pensionMonthly = 0` is the documented opt-out.

## Step 3 — tests (run `node tests/run-tests.js`; green before any UI work)

**F27e and F28c are the letters reserved for this feature** (bonds-plan reservation);
F29/F30 are free and match Plan A §6's numbering for `bridgeTargetAt` /
`projectBridgeFire`. **F29e/F29f stay reserved for Barista** (Plan A). Closed forms
computed in-test ARE the spec (F26/F27 style); the engine uses the backward loop —
parity is the test.

1. **Touch-up first** (`tests/test-engine.js` `baseState()` assumptions): add
   `pensionMonthly: 0, pensionAge: 65` next to `postRetirementReturnReal: 0.05`.
   (Pension 0 = inert, so every F13/F24/F27/F28 number stays byte-identical — this
   is the headline regression claim.)
2. **Fixture** (`tests/fixtures.js`): one header comment line (F29 — most ZUS) +
   `F29: { pension: { monthly: 2000, fromAge: 65 } }`. Expected values are computed
   in-test from the closed forms (per-suite, since they depend on `baseState` ages).
3. **New tests** (`tests/test-engine.js`):
   - **F27h** `retirementOpts` pension field: `createState()` state →
     `{ monthly: 1978.49, fromAge: 65 }`; assumptions win; override object wins;
     `pension: null` override disables; missing assumptions → `{ 0, 65 }`; purity.
   - **F27e** `projectWithdrawal` pension offset + floor: baseState with pension
     2 000 zł/mies. from age 65 and `years` large enough to cross the pension age
     (derive the crossing row in-test from `ageAt`; e.g. `years: 45`): all rows with
     `age < 65` have `pensionReal === 0` and `netWithdrawalReal === withdrawalReal`;
     the first row with `age ≥ 65` has `pensionReal === 24000` and
     `netWithdrawalReal === Math.max(0, withdrawalReal − 24000)`; recurrence uses
     net (recompute one row by hand). With pension 10 000/mies. the net floors at
     exactly 0 and `endReal > startReal` (portfolio grows). With no `birthDate`:
     all `pensionReal === 0`.
   - **F28c** pension inside dz (integer arithmetic): `postRetirementReturnReal: 0`,
     pension 24 000/yr starting `B` years after the start age, `deathAge` giving
     `N` years ⇒ `target = B·W₁ + (N−B)·(W₁ − 24000)` computed in-test (the Plan A
     example: N = 10, B = 4, W₁ = 72 000 ⇒ 576 000). Also: pension ≥ W₁ from age0
     ⇒ `target === 0` (floor); `pensionAge > deathAge` ⇒ target equals the
     no-pension target exactly.
   - **F29a** identity: pension off (monthly 0 **and** `pension: null` override) ⇒
     `bridgeTargetAt(st, ym).target === fireTargetAt(st, ym)` (1e-6) and
     `bridgeYears === 0`.
   - **F29b** closed forms: r = 0 integer case —
     `target = B·W₁ + max(0, W₁ − pensY)/wr` with B from `ageAt` in-test; plus one
     r = 5% case asserted against `Σ w_n·q^(n−1) + terminal·q^B` computed in-test.
   - **F29c** terminal floor: pension ≥ expenses ⇒ `terminalTarget === 0`, target =
     bridge-only PV.
   - **F29d** B ≤ 0: `ym` at age ≥ pensionAge ⇒ `bridgeYears === 0` and
     `target === terminalTarget`.
   - **F29g** guards & purity: no `birthDate` ⇒ `null`; state JSON unchanged;
     freeze-off variant: target strictly greater than the frozen-target variant
     (growth raises both phases).
   - **F30a** identity: pension 0 ⇒ `projectBridgeFire(...).fireYm ===
     projection.fireYm` (scan target ≡ classic target month-by-month).
   - **F30b** earlier date: pension 2 000/mies. on a reaching state (F13b-style,
     `portfolioStart` high enough) ⇒ `fireYm` **strictly earlier** than
     `classicFireYm`; `hypothetical === false`; `target < targetClassic`.
   - **F30c** hypothetical + guards: income = expenses state ⇒
     `hypothetical === true`, `startYm === todayYm(NOW)`; no `birthDate` ⇒ `null`.
   - **F30d** same-month comparison: `targetClassic === fireTargetAt(state, startYm)`.
   - **F11 additions** (storage): a v4 state (no pension fields) → `migrate` →
     `version === 5`, `pensionMonthly === 1978.49`, `pensionAge === 65`; explicit
     values (incl. `pensionMonthly: 0`) survive untouched; a v1 state chains
     1→…→5 in one pass; `version: 6` rejected by `validateState`; `.bak` round-trip
     unaffected.
   - F27f (`createState().version === S.SCHEMA_VERSION`) self-updates — confirm it
     passes with 5. F24/F28a/F28b/F28e/F28f pass unchanged (loop ≡ closed form).

## Step 4 — `js/analysis.js` (pure; data flows through `w`/`z`/`pb`)

1. **Shared local helper** — the withdrawal-table headers/rows are now built twice
   with a conditional ZUS column; add a tiny local `withdrawalTable(rows, opts)` (or
   header/row helpers) used by `withdrawalCard` and `dieWithZeroResult`. Derive
   `showPension = rows.some(r => (r.pensionReal || 0) > 0)`. When true: relabel
   „Wypłata (nom.)" → **„Z portfela (nom.)"** (bind to `netWithdrawalNominal`) and
   add **„Emerytura (nom.)"** (bind to `pensionNominal`) right after it; when false
   the table is byte-identical to today.
2. **`withdrawalCard`**: use the helper; metodologia gains one conditional line
   (when `showPension`):
   „Od wieku {pensionAge} część wydatków pokrywa emerytura z ZUS
   ({money(pensionMonthly)}/mies. w dzisiejszych złotówkach) — z portfela wypłacasz
   tylko resztę." — pass `pensionMonthly`/`pensionAge` from `w.ro.pension` (data on
   the result, no state access). The depletion warning gains a tail when
   `showPension`: „Emerytura z ZUS wypłacana jest dalej — kończy się tylko portfel."
3. **`dieWithZeroResult`**: same conditional column via the helper; metodologia
   extra line when pension active: „Od wieku emerytalnego z portfela wypłacasz tylko
   wydatki minus emeryturę z ZUS — dlatego cel «do zera» jest niższy." (and note the
   first closed-form line stays labeled as the no-ZUS formula: append „(bez ZUS;
   z ZUS liczone rok po roku)" when pension active).
4. **`dieWithZeroCard({ resultHTML, deathAge, zusOn, pensionMonthly, pensionAge })`**
   — below the age input, rendered only when `pensionMonthly > 0`:
   ```html
   <label class="field"><span class="lbl">
     <input type="checkbox" id="an-dwz-zus" ${zusOn ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
     Uwzględnij emeryturę ZUS (${money(pensionMonthly)}/mies. od ${pensionAge} r.ż.)</span></label>
   <p class="muted small">Kwotę i wiek zmienisz w Plan → Profil i FIRE.</p>
   ```
5. **NEW `pensionBridgeCard({ pb, wr })`** — static card for the Analiza „Prognoza"
   section. Layout mirrors `dieWithZeroResult`'s kv block:
   - Title: `Most do emerytury ZUS 🌉`
   - Intro: „Portfel nie musi wystarczyć na zawsze. Od wieku emerytalnego część
     wydatków pokryje ZUS — portfel dźwiga pełne wydatki tylko «na moście»: od FIRE
     do emerytury. Dlatego potrzebny kapitał jest mniejszy, a FIRE zwykle wypada
     wcześniej."
   - Hypothetical banner (when `pb.hypothetical`): „FIRE poza horyzontem prognozy —
     scenariusz modelowy liczony od dziś."
   - kv rows: „Cel z mostem ZUS" `money(pb.target)`; „Cel klasyczny (ten sam
     miesiąc)" `money(pb.targetClassic)`; „Różnica" `signed(pb.target −
     pb.targetClassic)` (class `good` when ≤ 0); „Data FIRE z mostem"
     `fireCell(pb.fireYm, pb.classicFireYm)`; „Data FIRE klasyczna" (formatted month
     or „poza horyzontem" — copy the dz row); „Lata mostu (FIRE → emerytura)"
     `pb.bridgeYears`; „Emerytura ZUS" `money(pb.pensionYearly / 12)` „/mies.";
     „Cel po emeryturze" `money(pb.terminalTarget)`.
   - Metodologia: „Cel z mostem = pieniądze na pełne wydatki od FIRE do wieku
     emerytalnego + kapitał, który od emerytury pokryje już tylko różnicę (wydatki −
     ZUS) przy Twojej stopie wypłat." / „Wszystko w dzisiejszych złotówkach;
     emerytura ZUS stała realnie (rośnie z inflacją). Portfel na moście pracuje na
     realny zwrot po FIRE." / „To analiza — pulpit i werdykty dalej używają
     klasycznego celu."

## Step 5 — `js/simulation.js` (pure, nothing persisted)

1. **`retirementCard({ value, base, freeze, pension, pensionAge, resultHTML })`** —
   two new params (effective values, strings ok). After the freeze checkbox insert:
   ```html
   ${/* pattern: the text-input fields of the other tabs */''}
   <label class="field"><span class="lbl">Emerytura z ZUS <span class="muted">(zł/mies.)</span></span>
     <input type="text" id="sym-ret-pension" inputmode="decimal" value="${esc(pension)}"></label>
   <label class="field"><span class="lbl">Wiek emerytalny (ZUS)</span>
     <input type="text" id="sym-ret-page" inputmode="numeric" value="${esc(pensionAge)}"></label>
   ```
   Extend the intro: „…także na emeryturze. Możesz też doliczyć emeryturę z ZUS —
   od wieku emerytalnego portfel dźwiga tylko część wydatków."
2. **`retirementResult({ ro, dz, dzBase, w, pb, deathAge })`** — new `pb` param
   (`projectBridgeFire` result with the what-if `ro`; may be `null` only when `dz`
   is null too — same birthDate guard). Add after the „Data FIRE «do zera»" row:
   `kv('Data FIRE z mostem ZUS', fireCell(pb.fireYm, pb.classicFireYm))` and
   `kv('Emerytura ZUS', ro.pension && ro.pension.monthly > 0 ?
   money(ro.pension.monthly) + '/mies. od ' + ro.pension.fromAge + ' r.ż.' : 'nieuwzględniana')`.
   Metodologia gains: „Od wieku emerytalnego ZUS pokrywa część wydatków — z portfela
   wypłacasz tylko resztę, dlatego cel z mostem bywa niższy, a FIRE wcześniej."

## Step 6 — `js/ui.js` glue

1. **Plan setting** — `renderPlanFire`, „Po przejściu na FIRE" subsection, directly
   after the `pl-freeze` checkbox:
   ```js
   ${field({ id: 'pl-pension', label: 'Prognozowana emerytura z ZUS', suffix: 'zł/mies.',
     value: moneyVal(a.pensionMonthly),
     tipText: 'Kwota w dzisiejszych złotówkach. ZUS co roku wysyła „Informację o stanie konta” z prognozą Twojej hipotetycznej emerytury — przepisz ją tutaj. Domyślnie wpisana jest emerytura minimalna (1978,49 zł od marca 2026). Od wieku emerytalnego ZUS pokryje część Twoich wydatków, więc portfel musi udźwignąć mniej.',
     hint: 'Wpisz 0, aby nie uwzględniać ZUS.' })}
   ${field({ id: 'pl-page', label: 'Wiek emerytalny (ZUS)', value: moneyVal(a.pensionAge), mode: 'numeric',
     tipText: 'Ustawowy wiek emerytalny: 65 lat dla mężczyzn, 60 dla kobiet. Od tego wieku emerytura z ZUS zaczyna dopłacać do Twoich wydatków.' })}
   ```
   Save handler: `specs` gains `['pension', () => parseMoney('pl-pension')]` and
   `['page', () => parseMoney('pl-page')]`; after the fireage guard add
   `if (vals.page < 1 || vals.page > 100) return planFail('Podaj realny wiek emerytalny (1–100).');`
   then extend the `Object.assign` with `pensionMonthly: vals.pension, pensionAge:
   Math.round(vals.page)`. This section calls `recomputeDerived` + `persist()` only —
   correct, **no reanchor** (pension is not income/living/rent).
2. **Analiza „Prognoza"** — in `renderAnaliza`, after the
   `An.withdrawalCard({ w, chartHTML: wChart })` term add, when
   `a.pensionMonthly > 0 && state.profile.birthDate`:
   ```js
   const pb = E.projectBridgeFire(state, { projection: proj });
   body += An.pensionBridgeCard({ pb, wr: a.withdrawalRate });
   ```
   Static card — no new events. `withdrawalCard` itself needs no glue change (the
   pension flows in through the default `ro` inside `projectWithdrawal`).
3. **Analiza „Do zera"** — module var next to `anDeathAge`:
   `let anDzZus = true; // Do zera: uwzględniaj emeryturę ZUS`. Build
   `const dzRo = E.retirementOpts(state, anDzZus ? {} : { pension: null });` and pass
   `ro: dzRo` into **both** `projectDieWithZero` calls (initial render and the
   `#an-death-age` input handler — both must read the live `anDzZus`). Pass
   `zusOn: anDzZus, pensionMonthly: a.pensionMonthly, pensionAge: a.pensionAge` into
   `dieWithZeroCard`. Wire `#an-dwz-zus` on `'change'` → flip `anDzZus`, recompute
   `z` + `zChart`, swap `#dwz-result` innerHTML (mirror the age handler; factor the
   recompute-and-swap into a small local function shared by both handlers).
4. **Symulacja „Emerytura"** — module vars (next to `symRetFreeze`):
   ```js
   let symRetPension = null; // Emerytura: ZUS zł/mies. (string; null = z ustawień)
   let symRetPage = null;    // Emerytura: wiek emerytalny (string; null = z ustawień)
   ```
   `retirementResult()` closure: parse the two fields when set
   (`Fmt.parsePLN`-based, pattern of the other tabs) — on bad input (NaN, pension
   < 0, age outside 1–100) return a `field-error` div. Build the effective pension:
   ```js
   const pMonthly = symRetPension == null ? a.pensionMonthly : parsed;
   const pAge = symRetPage == null ? a.pensionAge : Math.round(parsedAge);
   overrides.pension = { monthly: pMonthly, fromAge: pAge };
   ```
   (always passing the effective object keeps the base/override symmetry; equal to
   settings when untouched). Add `const pb = E.projectBridgeFire(state,
   { projection: proj, ro });` and pass `pb` into `Sim.retirementResult`. The card
   call gains `pension: symRetPension == null ? moneyVal(a.pensionMonthly) :
   symRetPension, pensionAge: symRetPage == null ? String(a.pensionAge) : symRetPage`.
   Event wiring (siblings of `#sym-ret-post`/`#sym-ret-freeze`): `#sym-ret-pension`
   and `#sym-ret-page` on `'input'` → update the module var, swap `#sym-ret-result`
   innerHTML. Nothing persists (module vars only — keep the tab's motto).

## Step 7 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change** (unless the in-flight charts feature
ships in between — its own plan handles that). Bump the version in all three places
to the next free minor (written here as v1.16.0): `sw.js`
`CACHE = 'fire-v1.16.0'`, `index.html` footer `FIRE Companion v1.16.0`, `js/ui.js`
`APP_VERSION = '1.16.0'`. Commit in Polish, e.g.:
`feat: most ZUS — emerytura w celu dwufazowym, kolumna ZUS w fazie wypłat, what-if w „Emeryturze" (v1.16.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0; every pre-existing expected number unchanged
   (pension 0 in `baseState` = legacy math; loop ≡ closed form in F24/F28).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **D3 guard**: dashboard FIRE date/verdict identical before vs after (with any
     `pensionMonthly` value);
   - Plan → Profil i FIRE: two new fields, defaults 1978,49 / 65; save 0 → ZUS card,
     dz checkbox and table column all disappear; save 60 as the age → bridge shortens;
   - Analiza „Prognoza": „Most do emerytury ZUS" card shows `target <
     targetClassic` and an earlier (or equal) FIRE date; „Faza wypłat" table shows
     „Emerytura (nom.)" + „Z portfela (nom.)" from the pension-age row on, and the
     net column floors at 0 when pension > expenses;
   - Analiza „Do zera": checkbox flips the target/date and the table column live
     (no full re-render, age input keeps working after a flip);
   - Symulacja „Emerytura": editing amount/age updates „Data FIRE z mostem ZUS" and
     the dz rows live; values equal the Analiza numbers when inputs equal settings;
     reload → nothing persisted;
   - **Migration**: with v4 data in localStorage, reload → no errors, fields
     backfilled (1978,49 / 65), export JSON has `version: 5`; an explicit 0 stays 0.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the later batch)

- **Migration numbering**: Plan A folded all four assumptions into one v2→v3 step;
  reality is v2→v3 = bonds, v3→v4 = freeze, **v4→v5 = pension (this plan)**.
  `plans/B-taxes.md` numbering shifts accordingly.
- **`retirementOpts` gains only `pension`** — the `barista`/`crash` fields from Plan
  A §2.1 arrive with their own features. The one-PV invariant is preserved through
  the private `pvOfRetirement` + `netWithdrawalYear` helpers: Barista later extends
  `w_n` with one more offset and passes `untilAge` through `ro`, nothing else.
- **`bridgeTargetAt` result** carries `terminalTarget`, `pensionMonthly`,
  `pensionAge` (not in Plan A's sketch) so pure builders can render copy without
  state access — same precedent as `withdrawalGrowthReal` from the freeze release.
- **Test letters**: Plan A's F29e/f (Barista) stay reserved; this plan's extras took
  F27h, F28c-edges and F29g. The loop≡closed-form parity Plan A expected from
  "F28a/F28b" is delivered by those tests continuing to pass unchanged.
- **Charts extraction** (`js/charts.js`, in flight, separate feature) is orthogonal;
  this plan adds no charts and anchors by artifact names, not line numbers.
