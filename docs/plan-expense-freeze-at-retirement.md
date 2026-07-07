# Expense-growth freeze at retirement (`freezeExpensesAtRetirement`)

## Context

Today the engine grows living expenses at `expenseGrowthReal` (default 1% real/yr)
**only until the retirement month**: the moving FIRE target (`fireTargetAt`) bakes the
growth into W₁, and every withdrawal-phase function then treats expenses as **flat in
real PLN** (they grow only with inflation nominally). Some users consider that
optimistic — lifestyle costs (health care, help at home) may keep rising in real terms
during retirement too. This feature lets the user choose:

1. a **persisted plan setting** `assumptions.freezeExpensesAtRetirement` (bool,
   default **`true`** = today's exact behavior). When `false`, post-retirement
   expenses keep growing at `expenseGrowthReal` on top of inflation, so the
   "do zera" target rises and the classic-SWR portfolio can deplete — which the
   withdrawal table then shows honestly;
2. a **Symulacja "Emerytura" what-if checkbox** (nothing persisted) to flip the
   assumption live and see the effect on the "do zera" target/date and portfolio
   longevity.

This is **Feature 2 of `plans/A-retirement-projection.md`** (the authoritative design;
decision **D4** there is the spec of the semantics), implemented **standalone** — per
user decision the remaining batch features (ZUS bridge, Barista, crash test, bands)
are still NOT built now. Ships as a normal standalone release: **v1.15.0, committed
in Polish**.

## Hard prerequisite — bonds switch must land first

`docs/plan-bonds-switch-at-retirement.md` (Feature 1, v1.14.0) creates everything this
feature plugs into:

- the `retirementOpts(state, overrides)` seam in `engine.js` (this plan adds one field);
- `ro` plumbing into `projectWithdrawal`, `dieWithZeroTargetAt` (4th param) and
  `projectDieWithZero` (incl. passing `ro` into both `dieWithZeroTargetAt` calls);
- `SCHEMA_VERSION = 3` + the v2→v3 migration (this plan appends v3→v4);
- the Plan → Profil i FIRE subsection „Po przejściu na FIRE" (`pl-postret`);
- the Symulacja „Emerytura" tab (`retirementCard`/`retirementResult`, `#sym-ret-post`,
  module var `symRetPost`, result swap on `#sym-ret-result`).

**If the bonds plan is not yet implemented when this one runs: implement it first,
in full, including its pre-step commit of the in-flight bugfixes.** Do not cherry-pick
parts of it — the two features share the seam and the migration chain order matters.
Line numbers below are therefore relative to the post-bonds tree; anchor by the
artifact names above, not by absolute lines.

## Locked semantics (Plan A D4 + D1 — do not re-derive)

- **Retirement month = the withdrawal `startYm`** (`fireYm` when reached, `todayYm()`
  in the hypothetical scenario) — never `familyFreeYm` (D1). Retirement year 1 is the
  12 months starting at `startYm`.
- **Pre-retirement growth is untouched.** The moving target (`fireTargetAt`,
  `buildPlan.livingReal`, projections, verdicts) already models expense growth up to
  the retirement month and is NOT governed by this flag.
- The flag governs only what happens **after** the retirement month:
  - `true` (default = today's implicit behavior): withdrawals flat in real PLN.
    **All existing numbers stay byte-identical.**
  - `false`: gross expense in retirement year *n* is `E_n = W₁·G^(n−1)` real, where
    `G = 1 + expenseGrowthReal`. Nominal columns get inflation on top (existing
    `·(1+infl)^(n−1)` epoch convention — automatic).
- **`fireTargetAt` stays as-is** — the classic SWR perpetuity cannot encode growing
  withdrawals; the flag acts only inside the withdrawal-phase functions. Headline
  FIRE date, verdicts, streak, dashboard: all unchanged (D3). The "do zera"
  date/target DO change when the freeze is off — that is analysis-layer, allowed
  (same precedent as the post-FIRE rate).
- **Math (Plan A §1, specialized — no pension/barista):** with `q = 1/(1+r)`,
  `r = ro.postReturnReal`, `x = G·q`:
  - recurrence: `P_n = (P_{n−1} − E_n)·(1+r)`;
  - die-with-zero closed form (solve `P_N = 0`): `P₀ = W₁·(1−x^N)/(1−x)`;
    for `|x−1| < 1e-12` → `P₀ = N·W₁`. This is the exact generalization of the
    current annuity-due formula (the `G = 1` case reproduces it verbatim).

## Step 1 — `js/engine.js`

1. **`retirementOpts`** — add the field (repo idiom `x != null ? x : y`, not `??`):
   ```js
   freezeExpenses: overrides.freezeExpenses != null ? overrides.freezeExpenses
     : (a.freezeExpensesAtRetirement != null ? a.freezeExpensesAtRetirement : true),
   ```
   Update the function's doc comment (kolejne pola: ZUS… dojdą później).
2. **`dieWithZeroTargetAt(state, ym, deathAge, ro = retirementOpts(state))`** —
   generalize the closed form by the substitution `q → G·q`:
   ```js
   const g = ro.freezeExpenses ? 0 : a.expenseGrowthReal;
   const x = (1 + g) / (1 + r);           // r = ro.postReturnReal (bonds step)
   const target = Math.abs(x - 1) < 1e-12
     ? yearsN * withdrawalYear1
     : withdrawalYear1 * (1 - Math.pow(x, yearsN)) / (1 - x);
   ```
   Result shape unchanged (`{ target, yearsN, withdrawalYear1 }`). Update the doc
   comment: expenses flat real **by default**; with the freeze off they grow at
   `expenseGrowthReal` also after FIRE (`W_n = W₁·G^(n−1)`), closed form via `x = G·q`.
3. **`projectWithdrawal`** — per-year gross withdrawal grows:
   - top of function (next to the existing `ro` line): `const wG = 1 + (ro.freezeExpenses ? 0 : a.expenseGrowthReal);`
   - in the loop replace the flat withdrawal with
     `const withdrawalReal = withdrawalRealYearly * Math.pow(wG, n - 1);` and use it
     in the recurrence, the `growthReal` line and the row (the row field
     `withdrawalReal` already exists — it simply becomes year-varying; the nominal
     column `withdrawalReal * pf1` is automatic).
   - result gains `withdrawalGrowthReal: wG - 1` (0 when frozen — the builders key
     copy off this, no state access needed). `withdrawalRealYearly` keeps meaning
     "year-1 withdrawal".
4. **`projectDieWithZero`** — same treatment in the yearly table:
   - `const wG = 1 + (ro.freezeExpenses ? 0 : a.expenseGrowthReal);`
   - in the loop: `const withdrawalReal = W1 * Math.pow(wG, n - 1);` (replace the
     `// stała realnie` line + comment). Starting from the exact target the table
     still hits 0 at year N — the closed form guarantees it; the existing
     `Math.abs(endReal) <= EPS` clamp absorbs float residue (test F28f).
   - the scan and the fallback already pass `ro` into `dieWithZeroTargetAt` (bonds
     step) — the freeze rides along with **no further change**.
   - both return objects gain `withdrawalGrowthReal: wG - 1`.
5. **`defaultAssumptions()`** — append
   `freezeExpensesAtRetirement: true, // wydatki stałe realnie po FIRE (dzisiejsze zachowanie)`.
6. **`createState`** — bump the hardcoded `version: 3` → `version: 4` (must equal
   `storage.SCHEMA_VERSION`; the existing F27f sync test enforces it).

Do NOT touch: `fireTargetAt`, `projectFire`, `replayBalances`, `buildPlan`,
`oneOffImpact`, `fiStats`, `swrComparison`, `coastFire`, `projectionWith`,
`requiredSavingsForGoal`, `solveExtraSavingsForAge` — pre-retirement growth and the
classic target are out of scope by D4.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 4;`
2. In `migrate`, replace `case 3: break;` with:
   ```js
   case 3: {
     // v3 → v4: mrożenie wzrostu wydatków po FIRE — domyślnie jak dotąd (stałe realnie).
     const a = cur.assumptions || (cur.assumptions = {});
     if (typeof a.freezeExpensesAtRetirement !== 'boolean') a.freezeExpensesAtRetirement = true;
     cur.version = 4;
   }
   // fall-through
   case 4:
     break;
   ```
3. `validateState`: **no change** (not load-critical; migration backfills and
   `retirementOpts` has the `true` fallback — same precedent as v2→v3).

## Step 3 — tests (run `node tests/run-tests.js` after; green before any UI work)

Numbering continues Plan A §6: **F27d and F28b are the letters reserved for this
feature** by the bonds plan; extras take fresh letters (F27g, F28e/f). Closed forms
computed in-test ARE the spec (F26/F27 style).

1. **Touch-up first** (`tests/test-engine.js` `baseState()` assumptions): add
   `freezeExpensesAtRetirement: true` next to `postRetirementReturnReal: 0.05`.
   (True is the legacy behavior, so all F13/F24/F27/F28 numbers stay byte-identical.)
2. **Fixture** (`tests/fixtures.js`): `F28: { growth: { g: 0.01 } }` + one header
   comment line (F28 — mrożenie wydatków po FIRE).
3. **New tests** (`tests/test-engine.js`):
   - **F27g** `retirementOpts` freeze field: `createState()` state →
     `freezeExpenses === true`; assumption `false` → `false`; override wins over
     assumption in both directions; missing assumption → `true`; purity (state JSON
     unchanged).
   - **F27d** `projectWithdrawal` growth: state with `expenseGrowthReal: 0.01`,
     freeze **off** (via `ro` override) → `rows[n-1].withdrawalReal` ≈
     `withdrawalRealYearly·1.01^(n−1)` for sampled n (1, 2, 10);
     `withdrawalNominal = withdrawalReal·(1+infl)^(n−1)`; freeze **on** → all rows
     flat (byte-parity with a pre-change run: assert `withdrawalGrowthReal === 0`
     and row values equal `withdrawalRealYearly`). Monotonicity: with identical
     inputs, `depletedYear(growth on) <= depletedYear(growth off)` when both deplete
     (growing withdrawals never extend the portfolio).
   - **F28b** `dieWithZeroTargetAt` growth variant: freeze off, g = 1%, r = 5% ⇒
     `target` equals `W₁·(1−x^N)/(1−x)` with `x = 1.01/1.05` computed in-test, and is
     **strictly greater** than the frozen target for the same month/age.
   - **F28e** the `x = 1` edge: `postRetirementReturnReal: 0.01` and
     `expenseGrowthReal: 0.01`, freeze off ⇒ `target === yearsN · withdrawalYear1`
     exactly (growth cancels the return).
   - **F28f** `projectDieWithZero` end-to-end with freeze off: result
     `withdrawalGrowthReal === 0.01`; table rows grow at G; **last row
     `endReal === 0`** (the exact-target table depletes exactly at year N); the dz
     `fireYm` is **later or equal** vs the frozen run (higher target ⇒ never
     earlier); `hypothetical`/guards unchanged.
   - **F11 addition** (storage): a v3 state (no freeze field) → `migrate` →
     `version === 4` and `freezeExpensesAtRetirement === true`; a v2 state chains
     2→3→4 in one pass (both new fields backfilled); a v1 state chains 1→…→4; an
     explicit `false` survives migration untouched; `version: 5` rejected by
     `validateState`; `.bak` round-trip unaffected.
   - F27f (`createState().version === S.SCHEMA_VERSION`) exists and self-updates —
     just confirm it passes with 4.

## Step 4 — `js/analysis.js` (copy only; data flows through `w`/`z`)

1. **`withdrawalCard`**: add ONE conditional metodologia line, keyed off the new
   result field (no state access):
   - when `w.withdrawalGrowthReal > 0`:
     „Wydatki rosną o {Fmt.formatPct(w.withdrawalGrowthReal)} realnie także po FIRE —
     tak wybrano w ustawieniach (Plan → Profil i FIRE)."
   The table needs no change — the `Wypłata` columns self-update through the rows.
2. **`dieWithZeroResult`**: same conditional line when `z.withdrawalGrowthReal > 0`:
   „Wypłaty rosną o {Fmt.formatPct(z.withdrawalGrowthReal)} realnie każdego roku —
   dlatego cel «do zera» jest wyższy niż przy stałych wydatkach."

No `ui.js` glue change needed for Analiza — engine defaults `ro` from state.

## Step 5 — `js/simulation.js` (pure, nothing persisted)

Extend the bonds-plan builders (pattern: checkbox idiom from `ui.js` `pl-house`):

1. **`retirementCard({ value, base, freeze, resultHTML })`** — new `freeze` param
   (effective boolean). Between the slider and the result container insert:
   ```html
   <label class="field"><span class="lbl">
     <input type="checkbox" id="sym-ret-freeze" ${freeze ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
     Wydatki przestają rosnąć po FIRE</span></label>
   ```
   Extend the intro sentence: „…co to zmienia. Możesz też sprawdzić, co się stanie,
   gdy wydatki będą rosły dalej także na emeryturze."
2. **`retirementResult({ ro, dz, dzBase, w, deathAge })`** — add one kv row (after
   the „Cel «do zera»" row) making the checkbox effect legible even when dates barely
   move: label `Wydatki po FIRE`, value `ro.freezeExpenses ? 'stałe realnie' :
   'rosną o ' + Fmt.formatPct(w.withdrawalGrowthReal) + ' realnie/rok'`. Add a
   metodologia line: „Odznaczenie «wydatki przestają rosnąć» podnosi wypłaty co roku
   o realny wzrost wydatków — portfel musi być większy albo skończy się wcześniej."

## Step 6 — `js/ui.js` glue

1. **Plan setting** — `renderPlanFire`, inside the „Po przejściu na FIRE" subsection,
   directly after the `pl-postret` field:
   ```html
   <label class="field"><span class="lbl">
     <input type="checkbox" id="pl-freeze" ${a.freezeExpensesAtRetirement ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
     Wydatki przestają rosnąć po FIRE${tip('Zaznaczone: po przejściu na FIRE Twoje wydatki są stałe w dzisiejszych złotówkach — rosną już tylko z inflacją. Odznaczone: zakładasz, że styl życia drożeje dalej (o „realny wzrost wydatków”) także na emeryturze — to ostrożniejsze założenie, portfel musi być większy.')}</span></label>
   ```
   (Match the exact `tip()` helper/argument shape used by the neighboring fields.)
   Save handler: no `specs` entry (checkbox, nothing to parse) — add
   `freezeExpensesAtRetirement: $('#pl-freeze').checked` to the `Object.assign`.
   This section only calls `recomputeDerived` + `persist()` — correct, **no reanchor**
   (the freeze is not income/living/rent).
2. **Symulacja „Emerytura" tab**:
   - module var (next to `symRetPost`): `let symRetFreeze = null; // Emerytura: mrożenie wydatków po FIRE (null = z ustawień)`;
   - result closure: extend the `retirementOpts` override —
     `E.retirementOpts(state, { ...(symRetPost == null ? {} : { postReturnReal: Number(symRetPost) }), ...(symRetFreeze == null ? {} : { freezeExpenses: symRetFreeze }) })`
     (or the equivalent two-step object build if spread-in-conditional reads foreign
     to the file — keep the file's idiom);
   - body branch: pass `freeze: symRetFreeze == null ? a.freezeExpensesAtRetirement : symRetFreeze`
     into `Sim.retirementCard`;
   - event wiring (the `#sym-ret-post` branch's sibling): `#sym-ret-freeze` on
     `'change'` → `symRetFreeze = el.checked;` then swap `#sym-ret-result` innerHTML
     with the recomputed result (same swap the slider does).

## Step 7 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three places:
`sw.js` `CACHE = 'fire-v1.15.0'`, `index.html` footer `FIRE Companion v1.15.0`,
`js/ui.js` `APP_VERSION = '1.15.0'`. Commit in Polish, e.g.:
`feat: mrożenie wzrostu wydatków po FIRE — ustawienie planu + what-if w „Emeryturze" (v1.15.0)`,
then push (release checklist).

## Verification

1. `node tests/run-tests.js` → exit 0; every pre-existing expected number unchanged
   (freeze default `true` ≡ legacy math — this is the headline regression claim).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **D3 guard**: dashboard FIRE date/verdict identical before vs after;
   - Plan → Profil i FIRE: checkbox present, checked by default; uncheck + save →
     persists after reload; Analiza „Do zera" target visibly rises and the „Faza
     wypłat" table's yearly withdrawal column starts growing; metodologia lines name
     the growth; re-check → numbers return to the previous values exactly;
   - Symulacja → „Emerytura": flipping the checkbox updates „Wydatki po FIRE",
     „Cel «do zera»", the dz date and the longevity row live, without a full
     re-render; with checkbox == setting the values equal the Analiza numbers;
     nothing persists (reload → setting unchanged);
   - **Migration**: with v3 data in localStorage (post-bonds), reload → no errors,
     checkbox checked (backfilled), export JSON has `version: 4`.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the later batch)

- Plan A §3 folds freeze + pension into one v2→v3 migration; reality is now
  **v2→v3 = bonds (postRetirementReturnReal), v3→v4 = freeze**. The pension/ZUS
  fields will need their own v4→v5 step; `plans/B-taxes.md` migration numbering
  shifts accordingly.
- `dieWithZeroTargetAt` keeps the **closed form** (with the `x = G·q` substitution)
  instead of Plan A §2.2's backward loop — exact and minimal while there are no
  pension/barista offsets. The backward loop replaces it when Feature 3 ships
  (its F28a/F28b parity tests then assert loop ≡ closed form).
- New result field `withdrawalGrowthReal` on `projectWithdrawal`/`projectDieWithZero`
  is not in Plan A — added so pure builders can render freeze copy without state
  access. Keep it when the batch lands.
- Tests F27e / F28c (pension) remain reserved. Version v1.15.0 is consumed by this
  standalone release.
