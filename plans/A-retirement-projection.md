# Plan A — Retirement projection (bonds switch · expense freeze · ZUS bridge · Barista FIRE · crash stress test · projection bands)

Part of the v1.14.0 wave (see `plans/00-master-plan.md`). English plan, Polish UI copy
(drafts in §7 are ship-ready). Target audience of all UI copy: people who care about
their finances but are **not** mathematicians — plain words, always say what the number
means for their life.

Binding conventions (from `CLAUDE.md` / master plan): math in `engine.js`, markup in
pure builders, DOM/state/events only in `ui.js`; everything real PLN unless the name
ends in `Nominal`; months are `"YYYY-MM"` + integer indices; **no version bump** (the
release agent bumps to 1.14.0); **no commits**; `node tests/run-tests.js` green at the end.
No new app files are created by this batch → **no `PRECACHE` change in `sw.js`**.

---

## 0. Locked design decisions (do not re-derive)

**D1 — "Retirement month" = `fireYm`, never `familyFreeYm`.**
Retirement is the month you can stop living off work income. That is exactly the FIRE
condition (`portfolio ≥ target` AND mortgage `== 0` AND family loan `== 0`), i.e.
`projection.fireYm`. `familyFreeYm` is only one gate of that condition and always
satisfies `familyFreeYm ≤ fireYm`; at `familyFreeYm` the user is still working and
contributing — switching the portfolio to bonds or freezing expenses then would model a
retirement that has not happened. This also matches the existing convention:
`projectWithdrawal` and `projectDieWithZero` already start the withdrawal phase at
`proj.fireYm` (or, hypothetically, at today when FIRE is out of horizon). Every new
function uses the same rule: **retirement starts at the withdrawal `startYm`**
(`fireYm` when reached, `todayYm()` in the hypothetical scenario).

**D2 — One options object, not six bespoke functions.**
All six features flow through a single normalized options object produced by
`retirementOpts(state, overrides)` (§2.1). Persisted plan settings feed the defaults;
Symulacja what-ifs pass `overrides`. Every retirement-phase function takes `ro` as an
optional last parameter defaulting to `retirementOpts(state)`.

**D3 — The core FIRE condition and verdicts do not change.**
`projectFire`, `fireTargetAt`, verdicts, streak, `requiredSavingsForGoal`, dashboard
headline date: all untouched (except the additive `stopAtFire` option, §2.7). The
pension-bridge / barista / die-with-zero dates are **analysis-layer scans** over the
existing projection series — same precedent as `projectDieWithZero` ("Analiza-only;
nie zmienia projectFire ani warunku FIRE").

**D4 — Expense-freeze semantics.** `freezeExpensesAtRetirement` (bool, default `true`).
Pre-retirement expense growth is already modeled (moving target via `fireTargetAt`,
`buildPlan.livingReal`) and is NOT touched by this flag. The flag governs what happens
**after** the retirement month:
- `true` (default = today's implicit behavior): withdrawals are flat in real PLN
  (they grow only with inflation nominally). All existing numbers stay identical.
- `false`: expenses keep growing at `expenseGrowthReal` **during retirement** too:
  withdrawal in retirement year *n* is `W₁·(1+g)^(n−1)` real. This raises the
  die-with-zero and bridge targets and can deplete the classic 4% portfolio — which
  the withdrawal table then shows honestly.
The classic SWR target formula (`fireTargetAt`) cannot encode growing withdrawals and
stays as-is; the flag acts only inside the retirement-phase functions (§2).

**D5 — Post-retirement return default = 2.0% real, applied via migration to existing
states too.** Justification (verified, July 2026 retail offer): EDO 10-year Polish
retail bonds pay 5.35% in year 1, then inflation + 2.00% margin — the margin *is* the
real return; pre-tax. `postRetirementReturnReal: 0.02` in `defaultAssumptions()` and in
the v2→v3 migration. This changes only analysis-layer outputs (withdrawal tables,
die-with-zero, new cards) — never the headline FIRE date/verdicts (D3). The withdrawal
card gets a banner naming the assumption with a pointer to settings (§7.3).

**D6 — Pension defaults.** `pensionMonthly: 1978.49` (minimum pension effective March
2026 — an intentionally visible placeholder the user overwrites with the number from
their yearly ZUS letter, "Informacja o stanie konta / hipotetyczna emerytura"),
`pensionAge: 65` (statutory: 65 men / 60 women — help text tells women to set 60).
Pension amount is in **today's PLN (real)** and is modeled flat-real (ZUS indexation ≈
inflation); it does **not** grow with `expenseGrowthReal` even when the freeze is off —
lifestyle inflation is yours, not ZUS's. `pensionMonthly = 0` disables the feature
everywhere (guards in §2).

**D7 — Net-withdrawal floor at zero.** In every retirement-phase flow the yearly amount
taken **from the portfolio** is `max(0, expenses_n − pension_n − barista_n)`. Income
above expenses is spent/gifted, never modeled as re-contribution. This keeps every
target monotone, keeps paths non-negative, and avoids "borrowing against future ZUS"
inside the die-with-zero PV.

**D8 — Year granularity.** All retirement-phase math is yearly (like
`projectWithdrawal`/`projectDieWithZero` today). Ages are integer years via
`ageAt(...).years`; pension is active in retirement year *n* iff
`ageAt(birth, ymOfYear_n).years ≥ pensionAge`; barista active iff `< untilAge`.
Bridge length `B` is therefore an integer count of years.

**D9 — Bands are honesty ranges, not percentiles.** ±1.5 p.p. on `realReturnAnnual`,
deterministic reruns. Copy calls them "scenariusz lepszy/gorszy", never "percentyl".

---

## 1. Shared math (spelled out once, referenced by every function)

Let, at retirement month `ym`:
- `W₁ = fireTargetAt(state, ym) × withdrawalRate` — yearly expenses at retirement, real.
  (Includes rent-forever when no house plan — same as everywhere else.)
- `g = freezeExpenses ? 0 : expenseGrowthReal`, `G = 1 + g`.
- `r = ro.postReturnReal` (feature 1), `q = 1/(1+r)`.
- Yearly gross expense in retirement year *n* (n = 1, 2, …): `E_n = W₁·G^(n−1)`.
- Yearly offsets: `pens_n = 12·pensionMonthly` if pension active in year *n* else 0;
  `bar_n = 12·barista.monthly` if barista active else 0.
- **Net withdrawal**: `w_n = max(0, E_n − pens_n − bar_n)` (D7).
- Recurrence (unchanged convention of `projectWithdrawal`/`projectDieWithZero`):
  `P_n = (P_{n−1} − w_n)·(1+r)`.

**PV of a schedule to an exact terminal value.** Solving `P_B = terminal` gives
`P_0 = Σ_{n=1..B} w_n·q^(n−1) + terminal·q^B`. Implemented as a backward loop
(exact, O(B), handles pension+barista+growth without case analysis):

```
P = terminal;
for (n = B; n >= 1; n--) P = P/(1+r) + w_n;   // P is the required portfolio at ym
```

Closed forms used by TESTS as the spec (flat offsets):
- flat expenses, no offsets, terminal 0 (die-with-zero, existing F24):
  `P₀ = W₁·(1−q^N)/(1−q)`; `q→1` (r=0): `N·W₁`. (Unchanged.)
- growing expenses (freeze off): substitute `q → G·q`:
  `P₀ = W₁·(1−(Gq)^N)/(1−(Gq))`; `Gq→1`: `N·W₁`.
- bridge with flat offset and terminal:
  `P₀ = W₁·(1−(Gq)^B)/(1−(Gq)) − offsetY·(1−q^B)/(1−q) + terminal·q^B`.

---

## 2. Engine changes (`js/engine.js`) — exact signatures + math

Place all new code in a new banner section after the „do zera" block:
`// ── Faza emerytalna: opcje, cele mostowe, ścieżki, pasma ────────────────`.

### 2.1 `retirementOpts` — THE options object

```js
// One normalized options object for every retirement-phase function.
// Defaults come from persisted assumptions; `overrides` are Symulacja what-ifs.
// Pure; no clamping beyond ?? fallbacks (UI validates inputs).
export function retirementOpts(state, overrides = {}) {
  const a = state.assumptions;
  return {
    postReturnReal:  overrides.postReturnReal  ?? a.postRetirementReturnReal ?? 0.02,
    freezeExpenses:  overrides.freezeExpenses  ?? a.freezeExpensesAtRetirement ?? true,
    pension: overrides.pension !== undefined
      ? overrides.pension                                    // pass null to disable
      : { monthly: a.pensionMonthly ?? 0, fromAge: a.pensionAge ?? 65 },
    barista: overrides.barista ?? null,   // { monthly, untilAge } — what-if only, never persisted
    crash:   overrides.crash   ?? null,   // { year, pct }        — what-if only, never persisted
  };
}
```

`pension: null` or `pension.monthly <= 0` ⇒ pension inert. `state.profile.birthDate`
missing ⇒ pension/barista are ignored inside consumers (age unknowable); functions that
cannot proceed return `null` exactly like `dieWithZeroTargetAt` does today.

### 2.2 `dieWithZeroTargetAt` — generalized (backward-compatible arity)

```js
export function dieWithZeroTargetAt(state, ym, deathAge, ro = retirementOpts(state))
// → { target, yearsN, withdrawalYear1 } | null   (shape unchanged)
```

Replace the closed form with the backward loop of §1 over `N = deathAge − age(ym)`
years, `terminal = 0`, `w_n` per §1 (growth via `G`, pension/barista offsets, floor).
`r = ro.postReturnReal` (was `realReturnAnnual` — the only silent behavior change,
covered by D5 + fixture touch-ups §8.0). With `ro = {postReturnReal: r_old,
freezeExpenses: true, pension: null}` the function reproduces today's numbers exactly
(F24 parity). Keep the `yearsN ≥ 1` and `birthDate` guards as they are.

### 2.3 `bridgeTargetAt` — the ONE two-phase PV function (pension bridge ∧ barista)

```js
// Required portfolio at `ym` when income streams cover part of retirement:
// bridge phase (until the LAST stream boundary) is funded year-by-year, then a
// classic SWR perpetuity on the residual need. Pension and barista share this.
export function bridgeTargetAt(state, ym, ro = retirementOpts(state))
// → { target, targetClassic, bridgeYears, terminalTarget, withdrawalYear1,
//     pensionYearly, baristaYearly } | null (no birthDate)
```

Math: `age0 = ageAt(birth, ym).years`.
`B = max(0, max(pensionOn ? pension.fromAge − age0 : 0, baristaOn ? barista.untilAge − age0 : 0))`.
Terminal (start of year B+1): `E_{B+1} = W₁·G^B`; only pension persists past the bridge
(barista has ended by construction; if pension starts *after* barista ends, interior
years are handled by the year-by-year `w_n` — the backward loop needs no phase split):
`terminal = max(0, E_{B+1} − pensYearly_if_active_at_age0+B) / withdrawalRate`.
Then the §1 backward loop over years 1..B seeded with `terminal`.
Invariant (test F29a): no pension, no barista, freeze on ⇒ `B = 0`,
`target = W₁/withdrawalRate = fireTargetAt(state, ym)` exactly.
`targetClassic = fireTargetAt(state, ym)` echoed for the UI comparison.

### 2.4 `projectBridgeFire` — the "new (usually earlier) FIRE date" scan

```js
// First month in the projection series (≥ now) with debts settled and
// portfolio ≥ bridgeTargetAt(state, ym, ro). Generalizes the projectDieWithZero
// scan; analysis-only (D3). Serves the ZUS card (persisted ro) AND the Barista
// what-if (ro override) — same function, same math.
export function projectBridgeFire(state, { projection = null, ro = retirementOpts(state), now } = {})
// → { fireYm, classicFireYm, hypothetical, startYm, startAge, target,
//     targetClassic, bridgeYears, pensionYearly, baristaYearly } | null (no birthDate)
```

Implementation: extract the existing scan loop from `projectDieWithZero` into a private
helper `scanFireBy(state, projection, nowYm, targetFn)` (returns `{fireYm, t}`), where
`targetFn(ym) → {target, …}|null`; `projectDieWithZero` and `projectBridgeFire` both
call it — pension/dz stay in lockstep forever. `hypothetical`/`startYm` fallback rules
identical to `projectDieWithZero` (`startYm = fireYm ?? todayYm(now)`); `classicFireYm`
from `projection.reached ? projection.fireYm : null`; targets echoed **at `startYm`**
(same-month comparison rule, F24g precedent).

### 2.5 `projectWithdrawal` — extended (carries features 1, 2, 3 and the crash)

```js
export function projectWithdrawal(state, opts = {})
// opts gains: ro (default retirementOpts(state)), crash ({year, pct} | null, default ro.crash)
```

Changes inside (everything else, incl. the nominal-column epoch convention, stays):
- `realRate = ro.postReturnReal` (was `a.realReturnAnnual`); `nominalRate` formula unchanged.
- Withdrawal year *n*: gross `withdrawalReal = withdrawalRealYearly·G^(n−1)` (G per §1);
  offsets `pensionReal`, `baristaReal` per D8; `netWithdrawalReal = max(0, gross − offsets)`.
- Recurrence uses **net**: `endReal = (startReal − netWithdrawalReal)·(1+realRate)`.
- Crash: if `crash && n === crash.year`, then **before** the withdrawal:
  `startReal *= (1 − crash.pct)` and mark the row `crashed: true`. (Shock at the start
  of retirement year `crash.year`; year 1 = the first retirement month, per feature 5.)
- Row gains fields: `pensionReal, pensionNominal, baristaReal, netWithdrawalReal,
  netWithdrawalNominal, crashed` (nominal = real × `(1+infl)^(n−1)`, same epoch as the
  other columns). Existing fields keep their exact meaning (`withdrawalReal` = gross).
- Result gains: `ro`, `crashApplied` (bool). `depletedYear` logic unchanged (portfolio
  story ends at depletion even though the pension keeps flowing — noted in UI copy).

### 2.6 `projectDieWithZero` — routed through `ro`

```js
export function projectDieWithZero(state, opts = {})   // opts gains: ro
```

`ro = opts.ro ?? retirementOpts(state)`. Use `r = ro.postReturnReal` everywhere the
function used `a.realReturnAnnual`; target via §2.2 with `ro`; the scan via the shared
`scanFireBy` (§2.4); the yearly table uses the same `w_n` machinery (gross withdrawal,
offsets, net, floor — add the same new row fields as §2.5 so the builder can show the
ZUS column). Result gains `ro`. Shape/guards otherwise unchanged.

### 2.7 `projectFire` + `projectionWith` — additive `stopAtFire`

```js
export function projectFire(state, plan, balances, debtRes, familyRes, uptoYm, opts = {})
// opts: { stopAtFire = true }
export function projectionWith(state, { assumptions = {}, extraMonthlySavings = 0,
  extraSavings = null, stopAtFire = true } = {}, now = new Date())
```

When `stopAtFire === false`: still record `fireYm`/`fireAge` at the first crossing,
but do **not** `break` — keep simulating to the end of `plan` (post-FIRE months route
as the existing `invest` branch; nothing else changes). `recomputeDerived` keeps
calling with defaults ⇒ zero behavior change anywhere else.

### 2.8 `projectionBand` — feature 6 data (pure, tested)

```js
export const BAND_SPREAD = 0.015;
// Deterministic optimistic/pessimistic envelope: rerun the full projection with
// realReturnAnnual ± spread, stopAtFire:false (so the optimistic path doesn't
// stop at its earlier FIRE date). Both variants share anchor and plan length,
// so series align 1:1 by index. History months: lo == hi == actual balance.
export function projectionBand(state, { spread = BAND_SPREAD } = {}, now = new Date())
// → { spread, rows: [{ ym, lo, hi }] }   // lo = min, hi = max of the two portfolios
```

`lo/hi` via `Math.min/max` per row (defensive against crossings in the debt phase).
Rendering is ui.js's job (§5.4/§5.5) — engine returns data only.

### 2.9 `stressTestRetirement` — feature 5

```js
// Deterministic sequence-of-returns stress test. No randomness. For each shock
// year k: full withdrawal path (projectWithdrawal) with crash {year: k, pct},
// horizon = deathAge − startAge years. Base path (no crash) included for contrast.
export function stressTestRetirement(state, { projection = null, shockPct = 0.30,
  shockYears = [1, 10], deathAge = 90, ro = retirementOpts(state) } = {})
// → { startYm, startAge, horizonYears, shockPct, deathAge,
//     base:      { depletedYear, depletedAge, survives, endReal },
//     scenarios: [{ shockYear, depletedYear, depletedAge, survives, endReal }] }
//   | null (no birthDate)
```

`startYm/startAge/startPortfolioReal` resolved exactly as `projectWithdrawal` does
(reached → `fireYm` + series portfolio; else hypothetical from today's target).
`horizonYears = max(1, deathAge − startAge)`; `survives = depletedYear == null`;
`depletedAge = rows[depletedYear−1].age` when depleted, else null; `endReal` = last
row's `endReal`. Shock years beyond the horizon are clamped out (scenario reported
with `shockYear` and base numbers — UI hides it; simpler: filter such years out).

### 2.10 Persisted defaults (`defaultAssumptions`, `createState`)

```js
// append inside defaultAssumptions():
postRetirementReturnReal: 0.02,      // D5 — EDO margin, real, pre-tax
freezeExpensesAtRetirement: true,    // D4 — true == today's behavior
pensionMonthly: 1978.49,             // D6 — minimum pension, March 2026 placeholder
pensionAge: 65,                      // D6 — statutory (men); women set 60
```

`createState`: bump the hardcoded `version: 2` → `version: 3` (must equal
`storage.SCHEMA_VERSION`; engine is L0 and cannot import it — add test §6 F27f).

---

## 3. Persisted-state changes (`js/storage.js`)

1. `export const SCHEMA_VERSION = 3;`
2. Migration chain — replace `case 2: break;` with:

```js
case 2: {
  // v2 → v3: faza emerytalna — zwrot po FIRE, mrożenie wydatków, emerytura ZUS.
  const a = cur.assumptions || (cur.assumptions = {});
  if (typeof a.postRetirementReturnReal   !== 'number')  a.postRetirementReturnReal = 0.02;
  if (typeof a.freezeExpensesAtRetirement !== 'boolean') a.freezeExpensesAtRetirement = true;
  if (typeof a.pensionMonthly             !== 'number')  a.pensionMonthly = 1978.49;
  if (typeof a.pensionAge                 !== 'number')  a.pensionAge = 65;
  cur.version = 3;
}
// fall-through
case 3:
  break;
```

3. `validateState`: **no change.** The new fields are not load-critical — `migrate`
   backfills them and `retirementOpts` has `??` fallbacks (double safety, same
   precedent as the v1→v2 familyLoan migration which added no validate checks).
4. `exportJSON`/`importPreview` need no edits (they use `SCHEMA_VERSION`; older
   backups migrate on import, newer are rejected — existing logic).

---

## 4. Pure builders — who renders what

### 4.1 `js/analysis.js`

- **`withdrawalCard({ w, chartHTML })` — extend.** Derive
  `showPension = w.rows.some(r => (r.pensionReal || 0) > 0)`. When true add a column
  „Emerytura (nom.)” after „Wypłata (nom.)” and relabel „Wypłata (nom.)” →
  „Z portfela (nom.)” (bind to `netWithdrawalNominal`; gross expenses stay derivable in
  metodologia). Add the D5 banner (§7.3) whenever `w.ro.postReturnReal !==
  a.realReturnAnnual` is not needed — show it always, it names the assumption. Update
  metodologia lines (§7.3). Mark crashed rows `class="depleted"`-style only in the
  stress context (stress renders in simulation.js, not here — no change needed here).
- **`dieWithZeroResult({ z })` — copy only.** Metodologia now names
  `z.ro.postReturnReal` as the rate (§7.4) and, when pension active, one extra line.
  Table gains the same conditional ZUS column as `withdrawalCard` (share a tiny local
  helper `withdrawalHeaders(showPension)` / row-builder inside analysis.js).
- **`dieWithZeroCard({ resultHTML, deathAge, zusOn, pensionMonthly })` — extend.**
  Below the age input add the checkbox `#an-dwz-zus` („Uwzględnij emeryturę ZUS…”,
  §7.4) rendered only when `pensionMonthly > 0`.
- **NEW `pensionBridgeCard({ pb, wr })`** — feature 3 display. `pb` =
  `projectBridgeFire` result with persisted `ro`; `wr` = withdrawalRate. Layout: intro
  paragraph, then `kv` rows: „Cel z mostem ZUS (w miesiącu FIRE)” `money(pb.target)`,
  „Cel klasyczny (ten sam miesiąc)” `money(pb.targetClassic)`, „Różnica”
  `signed(pb.target − pb.targetClassic)` (class `good` when ≤ 0), „Data FIRE z mostem”
  `fireCell(pb.fireYm, pb.classicFireYm)`, „Data FIRE klasyczna”, „Lata mostu (FIRE →
  emerytura)” `pb.bridgeYears`, „Emerytura ZUS” `money(pensionYearly/12)/mies.`,
  „Cel po emeryturze” `money(pb.terminalTarget ?? …)` — return `terminalTarget` from
  §2.3 through §2.4 for this (add it to `projectBridgeFire`'s result). Hypothetical
  banner like `withdrawalCard`'s. Metodologia §7.5.

### 4.2 `js/simulation.js` (all what-if, nothing persisted — keep the module motto)

- **NEW `retirementCard({ post, postBase, freeze, pension, pensionAge, resultHTML })`**
  + **`retirementResult({ ro, base, dz, dzBase, pb, w })`** — the „Emerytura” tab
  (features 1+2+3 what-if). Inputs: range `#sym-ret-post` (min 0, max 0.06, step 0.0025,
  value = override ?? persisted), checkbox `#sym-ret-freeze`, text `#sym-ret-pension`,
  text `#sym-ret-page`. Result rows: „Cel «do zera» (do wieku 90)” now vs base,
  „Data FIRE «do zera»” `fireCell(dz.fireYm, dzBase.fireYm)`, „Data FIRE z mostem ZUS”
  `fireCell(pb.fireYm, pb.classicFireYm)`, „Portfel przy 4% wystarcza”
  (`w.depletedYear` → „do wieku N (rok k)” warn / „ponad 35 lat” good), `gainLine`.
  Copy §7.6.
- **NEW `baristaCard({ amount, untilAge, resultHTML })` + `baristaResult({ pb, baseFireYm, amount, untilAge })`**
  — feature 4. Result: „Potrzebny portfel (Barista)” `money(pb.target)`, „Potrzebny
  portfel (klasycznie)” `money(pb.targetClassic)`, „Różnica” signed/good, „Data FIRE
  (Barista)” `fireCell(pb.fireYm, baseFireYm)`, `gainLine(pb.fireYm, baseFireYm)`.
  Copy §7.7.
- **NEW `crashCard({ pct, deathAge, resultHTML })` + `crashResult({ st })`** (`st` =
  `stressTestRetirement` result) — feature 5. Three `kv`-style rows: „Bez krachu”,
  „Krach w 1. roku FIRE”, „Krach w 10. roku FIRE”; each renders ✅ „portfel wystarcza do
  wieku {deathAge}” (class `good`) or „⚠️ portfel kończy się w wieku {depletedAge}
  (rok {depletedYear} wypłat)” (class `warn-text`), plus `money(endReal)` „zostaje na
  koniec” when survives. Sequence-risk punchline paragraph §7.8. When
  `st == null` (no birthDate) → prompt to fill the profile (reuse the dz wording).

Add `'emerytura', 'barista', 'krach'` to the tabs that suppress `nadwyzkaNote()`
(they do not add amounts to the plan).

### 4.3 `js/motivation.js`, `js/coach.js` — untouched.

---

## 5. `js/ui.js` glue (events, module state, render)

### 5.1 Plan settings — `renderPlanFire()`

After the `pl-cashret` field append a subsection:

```
<h3>Po przejściu na FIRE</h3>
${field({ id: 'pl-postret',  label: 'Realny zwrot po FIRE', suffix: '%/rok', value: pctVal(a.postRetirementReturnReal), tipText: §7.1 })}
<label class="field"><span class="lbl">
  <input type="checkbox" id="pl-freeze" ${a.freezeExpensesAtRetirement ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
  Wydatki przestają rosnąć po FIRE${tip(§7.1)}</span></label>
${field({ id: 'pl-pension',  label: 'Prognozowana emerytura z ZUS', suffix: 'zł/mies.', value: moneyVal(a.pensionMonthly), tipText: §7.1, hint: 'Wpisz 0, aby nie uwzględniać ZUS.' })}
${field({ id: 'pl-page',     label: 'Wiek emerytalny (ZUS)', value: moneyVal(a.pensionAge), mode: 'numeric', tipText: §7.1 })}
```

Save handler `specs` additions: `['postret', () => parsePct('pl-postret')]`,
`['pension', () => parseMoney('pl-pension')]`, `['page', () => parseMoney('pl-page')]`;
guard `if (vals.page < 1 || vals.page > 100) return planFail('Podaj realny wiek emerytalny (1–100).');`
then extend the `Object.assign(state.assumptions, { …, postRetirementReturnReal:
vals.postret, freezeExpensesAtRetirement: $('#pl-freeze').checked, pensionMonthly:
vals.pension, pensionAge: Math.round(vals.page) })`. `recomputeDerived` + `persist()`
already follow.

### 5.2 Analiza — `renderAnaliza()`

- „Prognoza” section: after `An.withdrawalCard(...)` insert, when
  `a.pensionMonthly > 0 && state.profile.birthDate`:
  `const pb = E.projectBridgeFire(state, { projection: proj }); body += An.pensionBridgeCard({ pb, wr: a.withdrawalRate });`
  (no new events — static card).
- „Do zera” section: module var `let anDzZus = true;`. Build
  `const dzRo = E.retirementOpts(state, anDzZus ? {} : { pension: null });` and pass
  `ro: dzRo` into both `projectDieWithZero` calls (initial render + the `#an-death-age`
  input handler). Pass `zusOn: anDzZus, pensionMonthly: a.pensionMonthly` into
  `dieWithZeroCard`; wire `#an-dwz-zus` `change` → flip `anDzZus`, recompute, swap
  `#dwz-result` innerHTML (mirror the age handler).
- `withdrawalCard` needs no glue change (data flows through `w`).

### 5.3 Symulacja — `renderSymulacja()`

Module state additions (near the existing `sym*` block):

```js
let symRetPost = null;      // Emerytura: zwrot po FIRE (ułamek; null = z ustawień)
let symRetFreeze = null;    // Emerytura: mrożenie wydatków (null = z ustawień)
let symRetPension = null;   // Emerytura: zł/mies. (string; null = z ustawień)
let symRetPage = null;      // Emerytura: wiek emerytalny (string; null = z ustawień)
let symBarista = '';        // Barista: dorabiane zł/mies.
let symBaristaAge = '';     // Barista: do wieku
let symCrashPct = '30';     // Krach: % spadku portfela
let symCrashAge = '90';     // Krach: dożywam do wieku
```

Tabs array: insert `['emerytura', 'Emerytura'], ['barista', 'Barista'], ['krach', 'Krach']`
after `['zwrot', 'Zwrot']` (the `.seg-scroll` row already scrolls horizontally).

Result closures (pattern-copy the existing ones; all read live module vars, parse via
`Fmt.parsePLN`, return `field-error` divs on bad input):

- `retirementResult()`: build `ro = E.retirementOpts(state, { postReturnReal:
  symRetPost ?? undefined, freezeExpenses: symRetFreeze ?? undefined, pension:
  parsed pension/page override or undefined })`; `baseRo = E.retirementOpts(state)`;
  `dz = E.projectDieWithZero(state, { deathAge: 90, projection: proj, ro })`,
  `dzBase` likewise with `baseRo`; `pb = E.projectBridgeFire(state, { projection: proj, ro })`;
  `w = E.projectWithdrawal(state, { projection: proj, ro })` → `Sim.retirementResult(...)`.
- `baristaResult()`: validate amount ≥ 0 and `untilAge > current age` (reuse the
  `targetAgeResult` age guard wording); `ro = E.retirementOpts(state, { barista:
  { monthly: X, untilAge: Y } })`; `pb = E.projectBridgeFire(state, { projection: proj, ro })`
  → `Sim.baristaResult({ pb, baseFireYm, amount: X, untilAge: Y })`.
- `crashResult()`: pct ∈ (0, 100), deathAge > current age;
  `st = E.stressTestRetirement(state, { projection: proj, shockPct: pct/100, shockYears: [1, 10], deathAge })`
  → `Sim.crashResult({ st })`.

Event wiring (mirror existing tabs): each input `input`/`change` handler updates its
module var and swaps only `#sym-ret-result` / `#sym-barista-result` /
`#sym-crash-result`; the `#sym-ret-post` slider also updates a `<b id="sym-ret-post-val">`
percent label (pattern: `sym-return`). Checkbox `#sym-ret-freeze` uses `change`.

### 5.4 `chartSVG` — band rendering (feature 6)

Extend the `defs` contract with a band def: `{ band: true, lo: r => …, hi: r => …, cls }`.
In the max-scan include `d.hi(r)` for band defs. Render band polygons **first** (behind
all polylines): points = forward pass of `(x(i), y(hi))` for rows where both `lo`/`hi`
are numbers, then backward pass of `(x(i), y(lo))`; emit
`<polygon class="${d.cls}" points="…"/>`; skip if fewer than 2 usable points.
Non-band defs are untouched (all existing call sites keep working).

### 5.5 Dashboard — attach the band to „Portfel vs cel”

In `renderDashboard`, invest-phase branch, before building the chart:

```js
const band = E.projectionBand(state);
const bandBy = new Map(band.rows.map(b => [b.ym, b]));
const rows = proj.series.map(r => {
  const b = bandBy.get(r.ym);
  return b ? { ...r, bandLo: b.lo, bandHi: b.hi } : r;
});
```

and prepend the def `{ band: true, lo: r => r.bandLo, hi: r => r.bandHi, cls: 'band-return' }`
to the `chartSVG` defs. Add a legend entry + explainer line (§7.9). History months have
`lo == hi` (engine guarantees) → the band visually starts where the projection starts.

### 5.6 `styles.css`

One rule next to the other `.chart` line classes (~line 300):
`.chart .band-return { fill: var(--accent); opacity: .12; }`.
No new CSS custom property ⇒ the three-block (`:root`/dark media/dark override) rule
does not apply.

---

## 6. Tests — names, fixtures, assertions

**F-numbering continues: F27–F32.** Fixture style follows F26: store input params in
`tests/fixtures.js`, compute expected values in tests from the closed forms of §1
(the closed forms ARE the spec; the engine uses the backward loop — parity is the test).

### 6.0 Touch-ups required to keep the existing suite green (do FIRST)

- `tests/test-engine.js` `baseState()` assumptions: add
  `postRetirementReturnReal: 0.05, freezeExpensesAtRetirement: true, pensionMonthly: 0, pensionAge: 65`.
  Rationale: preserves every F13/F24 expected number byte-for-byte (r_post = old r,
  no pension in legacy fixtures); new tests override explicitly.
- F11 (storage): update any hardcoded `version: 2` expectations; add cases below.

### F27 — `retirementOpts` + extended `projectWithdrawal`

- `F27a` defaults & overrides: `retirementOpts(createState())` returns
  `{0.02, true, {1978.49, 65}, null, null}`; overrides win field-by-field;
  `pension: null` disables; purity (state JSON unchanged).
- `F27b` F13 parity is preserved (already covered by touched-up F13 — add one explicit
  assertion that `projectWithdrawal(st, {startYm, startPortfolioReal}).ro.postReturnReal === 0.05`).
- `F27c` bonds switch depletes the 4% portfolio: state with
  `postRetirementReturnReal: 0.02`, start 1 800 000, W₁ 72 000, freeze on, pension 0,
  `years: 40` → `depletedYear === 35` (closed form: smallest N with
  `W₁·(1−q^N)/(1−q) > P₀`, q = 1/1.02 — compute in the test and assert both ways).
- `F27d` freeze off: `withdrawalReal` of year n equals `W₁·1.01^(n−1)` (g = 1%);
  freeze on ⇒ flat (existing F24c analog for projectWithdrawal).
- `F27e` pension offset + floor: pension 2 000 zł/mies. from age 65, birth 2000-01,
  start 2026-07 → rows 1..38 have `pensionReal === 0`, row 40 (age 65) has
  `pensionReal === 24000`, `netWithdrawalReal === max(0, withdrawalReal − 24000)`;
  with pension 10 000/mies. net floors at exactly 0 and portfolio grows.
- `F27f` `createState().version === S.SCHEMA_VERSION` (cross-module sync guard).
- Fixture `F27: { depleted: { start: 1800000, rPost: 0.02, year: 35 }, pension: { monthly: 2000, fromAge: 65 } }`.

### F28 — generalized `dieWithZeroTargetAt`

- `F28a` legacy parity: with explicit `ro = {postReturnReal: 0.05, freezeExpenses: true, pension: null}`
  reproduces `FIX.F24.target` (1 486 901,33) and `r0` (720 000) exactly.
- `F28b` growth variant: freeze off, g = 1%, r = 5% ⇒ target equals
  `W₁·(1−(Gq)^N)/(1−Gq)` (computed in-test) and is **greater** than the frozen target.
- `F28c` pension inside dz (integer arithmetic): r = 0, deathAge 36 (N = 10), pension
  24 000/yr from age 30 (B = 4) ⇒ target `= 4·72000 + 6·(72000−24000) = 576000`.
- `F28d` rPost sensitivity: target(rPost 2%) > target(rPost 5%) (same month/age) — the
  "effect on the FIRE target" of feature 1.

### F29 — `bridgeTargetAt` (shared two-phase PV)

- `F29a` identity: no pension, no barista, freeze on ⇒
  `target === fireTargetAt(state, ym)` (1e-6) and `bridgeYears === 0`.
- `F29b` pension closed form: r = 0 integer case — pension 24 000/yr from 65, age 26
  (B = 39): `target = 39·72000 + (72000−24000)/0.04 = 2808000 + 1200000 = 4008000`;
  plus one r = 5% case asserted against the §1 closed form computed in-test.
- `F29c` terminal floor: pension ≥ expenses ⇒ `terminalTarget === 0`,
  target = bridge-only PV.
- `F29d` B ≤ 0: `ym` at age ≥ pensionAge ⇒ `target === terminalTarget`.
- `F29e` barista (r = 0): 3 000/mies. to age 40 (B = 14):
  `target = 14·(72000−36000) + 1800000 = 2304000`; barista target < classic target.
- `F29f` combined pension + barista is ≤ each single-offset target; purity.
- Fixture `F29: { pension: { monthly: 2000, fromAge: 65 }, barista: { monthly: 3000, untilAge: 40 }, r0Target: 4008000, r0Barista: 2304000 }`.

### F30 — `projectBridgeFire` scan

- `F30a` identity: pension 0 + freeze on ⇒ `fireYm === projection.fireYm` (the scan
  target equals the classic target month-by-month).
- `F30b` earlier date: pension 2 000/mies. (rest as F13b state, portfolioStart
  1 700 000) ⇒ `fireYm` strictly earlier than `classicFireYm`; `hypothetical === false`.
- `F30c` hypothetical: income = expenses state ⇒ `hypothetical === true`,
  `startYm === todayYm(NOW)`; no birthDate ⇒ returns `null`.
- `F30d` same-month comparison: `targetClassic === fireTargetAt(state, startYm)` (F24g analog).

### F31 — `stressTestRetirement`

- `F31a` determinism + pct 0: `shockPct: 0` ⇒ scenarios identical to `base`
  (field-by-field); two consecutive calls give identical JSON.
- `F31b` sequence risk demonstrated: choose start = exact dz-target-like level so the
  base survives (e.g. F13 state, rPost 5%, start 1 800 000, deathAge 90): crash 30% in
  year 1 ⇒ `survives === false` with some `depletedYear`; crash 30% in year 10 ⇒
  `depletedYear` **strictly later** (or survives) — assert
  `s10.depletedYear == null || s10.depletedYear > s1.depletedYear`.
- `F31c` horizon: `horizonYears === deathAge − startAge`; `depletedAge` matches the
  row's age; purity.
- Fixture `F31: { shockPct: 0.30, deathAge: 90, years: [1, 10] }`.

### F32 — `stopAtFire` + `projectionBand`

- `F32a` `projectionWith(state, { stopAtFire: false })`: same `fireYm/fireAge` as the
  default run; series longer (runs to plan end); prefix up to `fireYm` identical
  (compare a few sampled rows by JSON).
- `F32b` band shape: `rows.length` = full horizon; every row `hi ≥ lo`;
  on history months `hi === lo` = the actual portfolio of the base replay.
- `F32c` envelope: for a surplus-positive plan (F13b state) every projected month has
  `lo ≤ basePortfolio ≤ hi` (base = `stopAtFire:false` run at the user's r).
- `F32d` `spread: 0` ⇒ `hi === lo` everywhere; purity (state JSON unchanged).

### F11 additions (storage)

- `F11-migracja-v3`: a v2 state (no new fields) → `migrate` → `version === 3` and the
  four defaults present; a v1 state chains 1→2→3 in one pass; `version: 4` still
  rejected by `validateState`; `.bak` round-trip unaffected.

---

## 7. Polish UI copy (ship-ready drafts)

### 7.1 Plan → Profil i FIRE → subsection „Po przejściu na FIRE”

- Section header: `Po przejściu na FIRE`
- `pl-postret` label: `Realny zwrot po FIRE` (suffix `%/rok`), tip:
  „Po przejściu na FIRE wiele osób przenosi pieniądze w bezpieczniejsze miejsca, np.
  obligacje skarbowe. Detaliczne obligacje 10-letnie (EDO) płacą inflację + ok. 2%
  marży — ta marża to Twój realny zysk. Wpisz, ile ponad inflację ma zarabiać portfel,
  gdy przestaniesz pracować. Mniejszy zwrot = portfel wolniej się odbudowuje, więc
  musi być większy na starcie.”
- `pl-freeze` label: `Wydatki przestają rosnąć po FIRE`, tip:
  „Zaznaczone: po przejściu na FIRE Twoje wydatki są stałe w dzisiejszych złotówkach —
  rosną już tylko z inflacją. Odznaczone: zakładasz, że styl życia drożeje dalej
  (o «realny wzrost wydatków») także na emeryturze — to ostrożniejsze założenie,
  portfel musi być większy.”
- `pl-pension` label: `Prognozowana emerytura z ZUS` (suffix `zł/mies.`), tip:
  „Kwota w dzisiejszych złotówkach. ZUS co roku wysyła «Informację o stanie konta»
  z prognozą Twojej hipotetycznej emerytury — przepisz ją tutaj. Domyślnie wpisana
  jest emerytura minimalna (1978,49 zł od marca 2026). Od wieku emerytalnego ZUS
  pokryje część Twoich wydatków, więc portfel musi udźwignąć mniej.”
  hint: „Wpisz 0, aby nie uwzględniać ZUS.”
- `pl-page` label: `Wiek emerytalny (ZUS)`, tip:
  „Ustawowy wiek emerytalny: 65 lat dla mężczyzn, 60 dla kobiet. Od tego wieku
  emerytura z ZUS zaczyna dopłacać do Twoich wydatków.”

### 7.2 Toast after save — existing `Zapisano profil i założenia.` stays (no change).

### 7.3 Analiza → „Faza wypłat” card

- New banner (always shown):
  „Po FIRE portfel pracuje na {formatPct(ro.postReturnReal)} realnie — tak, jakby
  pieniądze leżały w bezpieczniejszych instrumentach (np. obligacjach). Zmienisz to w
  Ustawieniach → Profil i FIRE.”
- New column header (when pension active): `Emerytura (nom.)`; relabel `Wypłata (nom.)`
  → `Z portfela (nom.)`.
- Metodologia — replace/extend lines:
  - „Po FIRE portfel rośnie o realny zwrot po FIRE ({formatPct(ro.postReturnReal)}),
    nie o zwrot z fazy oszczędzania — po przejściu na emeryturę zwykle inwestuje się
    bezpieczniej.”
  - (pension) „Od wieku {pensionAge} część wydatków pokrywa emerytura z ZUS
    ({money} zł/mies. w dzisiejszych złotówkach) — z portfela wypłacasz tylko resztę.”
  - (freeze off) „Wydatki rosną o {formatPct(g)} realnie także po FIRE — tak wybrano
    w ustawieniach.”
- Depletion warning (existing) gains a tail when pension active:
  „Emerytura z ZUS wypłacana jest dalej — kończy się tylko portfel.”

### 7.4 Analiza → „Do zera”

- Checkbox (shown when `pensionMonthly > 0`): label
  „Uwzględnij emeryturę ZUS ({money(pensionMonthly)}/mies. od {pensionAge} r.ż.)”,
  hint: „Kwotę i wiek zmienisz w Ustawieniach → Profil i FIRE.”
- Metodologia extra line: „Portfel rośnie o realny zwrot po FIRE
  ({formatPct(ro.postReturnReal)}); jeśli uwzględniasz ZUS, od wieku emerytalnego
  z portfela wypłacasz tylko wydatki minus emeryturę.”

### 7.5 Analiza → NEW card „Most do emerytury ZUS 🌉” (when `pensionMonthly > 0`)

- Intro: „Portfel nie musi wystarczyć na zawsze. Od wieku emerytalnego część wydatków
  pokryje ZUS — portfel dźwiga pełne wydatki tylko «na moście»: od FIRE do emerytury.
  Dlatego potrzebny kapitał jest mniejszy, a FIRE zwykle wypada wcześniej.”
- kv labels: `Cel z mostem ZUS`, `Cel klasyczny (ten sam miesiąc)`, `Różnica`,
  `Data FIRE z mostem`, `Data FIRE klasyczna`, `Lata mostu (FIRE → emerytura)`,
  `Emerytura ZUS`, `Cel po emeryturze`.
- Hypothetical banner: „FIRE poza horyzontem prognozy — scenariusz modelowy liczony od
  dziś.”
- Metodologia:
  - „Cel z mostem = pieniądze na pełne wydatki od FIRE do wieku emerytalnego + kapitał,
    który od emerytury pokryje już tylko różnicę (wydatki − ZUS) przy Twojej stopie
    wypłat.”
  - „Wszystko w dzisiejszych złotówkach; emerytura ZUS stała realnie (rośnie z
    inflacją). Portfel na moście pracuje na realny zwrot po FIRE.”
  - „To analiza — pulpit i werdykty dalej używają klasycznego celu.”

### 7.6 Symulacja → NEW tab „Emerytura” (`retirementCard`)

- Title: `Emerytura po FIRE 🏖️`
- Intro: „Co się dzieje z planem, gdy po FIRE inwestujesz bezpieczniej, wydatki
  przestają rosnąć albo doliczysz emeryturę z ZUS? Przesuń suwak i sprawdź. Czysta
  symulacja — niczego nie zapisujemy; na stałe zmienisz to w Ustawieniach.”
- Field labels: `Realny zwrot po FIRE` (slider + `<b>` value), checkbox
  `Wydatki przestają rosnąć po FIRE`, `Emerytura z ZUS (zł/mies.)`,
  `Wiek emerytalny (ZUS)`.
- Result labels: `Cel „do zera” (do wieku 90)`, `Data FIRE „do zera”`,
  `Data FIRE z mostem ZUS`, `Portfel przy Twojej stopie wypłat wystarcza` →
  value „do wieku {N}” (warn) or „ponad {years} lat” (good).
- Metodologia: „Każda zmiana przelicza fazę wypłat od nowa: portfel po FIRE rośnie o
  podany zwrot, wydatki rosną albo stoją, a od wieku emerytalnego ZUS pokrywa część
  wydatków.” / „Niczego nie zapisujemy — to podgląd; ustawienia na stałe są w
  Plan → Profil i FIRE.”

### 7.7 Symulacja → NEW tab „Barista” (`baristaCard`)

- Title: `Barista FIRE ☕💼`
- Intro: „Nie musisz rzucać pracy z dnia na dzień. Jeśli po FIRE dorobisz kilka tysięcy
  miesięcznie — pół etatu, zlecenia — portfel może być mniejszy, a FIRE bliżej.
  Czysta symulacja, niczego nie zapisujemy.”
- Fields: `Dorabiam po FIRE` (suffix `zł/mies. netto`, placeholder `np. 3000`),
  `Dorabiam do wieku` (placeholder `np. 55`).
- Result labels: `Potrzebny portfel (Barista)`, `Potrzebny portfel (klasycznie)`,
  `Różnica`, `Data FIRE (Barista)` + `gainLine`.
- Metodologia: „Dorobione pieniądze zmniejszają wypłaty z portfela, dopóki dorabiasz;
  od podanego wieku portfel przejmuje pełne wydatki (klasyczna stopa wypłat). Ten sam
  rachunek co przy moście ZUS — najpierw lżejsze lata, potem pełny cel.”

### 7.8 Symulacja → NEW tab „Krach” (`crashCard`)

- Title: `Test krachu 📉`
- Intro: „Największy wróg świeżego emeryta to krach tuż po przejściu na FIRE — portfel
  traci, a Ty i tak musisz z niego żyć. Sprawdź, czy Twój plan przeżyje spadek o podany
  procent: raz w pierwszym roku FIRE, raz — dla porównania — w dziesiątym.”
- Fields: `Spadek portfela` (suffix `%`, default 30), `Dożywam do wieku` (default 90).
- Row labels: `Bez krachu`, `Krach w 1. roku FIRE`, `Krach w 10. roku FIRE`; values:
  „✅ portfel wystarcza do wieku {deathAge} (zostaje {money})” / „⚠️ portfel kończy się
  w wieku {age} ({k}. rok wypłat)”.
- Punchline paragraph: „Ten sam krach dziesięć lat później boli mniej — portfel zdążył
  urosnąć, a część wypłat masz już za sobą. O bezpieczeństwie planu decyduje więc nie
  tylko średni zwrot, ale i to, KIEDY przyjdą złe lata. Dlatego niższa stopa wypłat
  i bezpieczniejszy portfel po FIRE to Twoja poduszka.”
- Metodologia: „Bez losowania: liczymy zwykłą fazę wypłat i w wybranym roku obniżamy
  portfel o podany procent, a potem liczymy dalej. Dwa terminy krachu pokazują tzw.
  ryzyko sekwencji zwrotów.”

### 7.9 Pulpit → „Portfel vs cel” band

- Legend entry: `<span><i style="background:var(--accent);opacity:.25"></i>pasmo: zwrot ±1,5 pkt proc.</span>`
- Explainer line under the legend (muted small): „Pasmo pokazuje, jak prognoza się
  rozjeżdża, gdy rynek da o 1,5 punktu procentowego więcej albo mniej, niż zakładasz —
  im dalej w przyszłość, tym mniej pewna jest każda prognoza.”

---

## 8. File-touch list & execution order

| # | File | Change |
|---|------|--------|
| 1 | `js/engine.js` | §2: `retirementOpts`, generalized `dieWithZeroTargetAt`, `bridgeTargetAt`, `scanFireBy` (private) + `projectBridgeFire`, extended `projectWithdrawal` (ro/pension/barista/growth/crash + new row fields), `projectDieWithZero` ro, `projectFire`/`projectionWith` `stopAtFire`, `projectionBand` + `BAND_SPREAD`, `stressTestRetirement`, `defaultAssumptions` 4 new fields, `createState` version 3 |
| 2 | `js/storage.js` | §3: `SCHEMA_VERSION = 3`, migration `case 2` |
| 3 | `tests/test-engine.js` | §6.0 `baseState` touch-up; suites F27–F32; F11 migration cases |
| 4 | `tests/fixtures.js` | `F27`, `F29`, `F31` fixture entries (+ header comment lines) |
| 5 | `js/analysis.js` | §4.1: `withdrawalCard` ext, `dieWithZeroResult`/`dieWithZeroCard` ext, NEW `pensionBridgeCard` |
| 6 | `js/simulation.js` | §4.2: NEW `retirementCard/Result`, `baristaCard/Result`, `crashCard/Result` |
| 7 | `js/ui.js` | §5: `renderPlanFire` fields+save, `renderAnaliza` (pension card, dz ZUS checkbox + `anDzZus`), `renderSymulacja` (3 tabs, 8 module vars, result closures, events, nadwyzkaNote exclusions), `chartSVG` band def, `renderDashboard` band merge + legend |
| 8 | `styles.css` | §5.6: `.chart .band-return` |
| 9 | `docs/features/A.md` + `docs/INDEX.md` | short maintenance doc + one index line (create dirs/files if missing — master-plan convention; NOT precached, not an app file) |

Do **not** touch: `sw.js` (no new app files, no version bump — release agent),
`index.html`, `js/app.js`, `js/coach.js`, `js/motivation.js`, `js/format.js`.

**Order**: 1 → 2 → 3+4 (run `node tests/run-tests.js` — must be green before any UI
work) → 5 → 6 → 7 → 8 → manual pass (`python -m http.server 8000`, check Pulpit band,
Plan form save, Analiza cards, 3 Symulacja tabs, dz checkbox) → subpath rehearsal
(`cd .. && python -m http.server 8000` → `http://localhost:8000/fire/`) → 9 → final
test run.

## 9. Acceptance checklist (fresh-implementer self-test)

- [ ] `node tests/run-tests.js` exit 0; all F1–F26 untouched numbers still pass.
- [ ] Existing user data (v2 JSON) loads, migrates to v3, and the dashboard FIRE date
      is **unchanged** (D3); withdrawal table now shows the 2% banner.
- [ ] Setting `pensionMonthly = 0` hides the ZUS card and the dz checkbox; every new
      function degrades to classic numbers (F29a/F30a identities).
- [ ] Barista tab and ZUS card produce their targets through the same
      `bridgeTargetAt` + `projectBridgeFire` (grep: exactly one PV implementation).
- [ ] Crash tab shows year-1 depleting earlier than year-10 for a borderline plan.
- [ ] Band renders behind the lines, collapses to the line on history, and the page
      renders identically when `projectionBand` returns matching lo/hi (spread edge).
- [ ] All new copy is Polish, plain-language; plan/docs English; no new deps, no build,
      relative paths only.
