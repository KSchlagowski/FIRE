# Plan B — Taxes: Belka 19% toggle + IKE/IKZE buckets

Batch B of the v1.14.0 wave (see `plans/00-master-plan.md`). Implemented **after
batch A** (`plans/A-retirement-projection.md`). At the time this plan was written
the A plan file did not exist yet — **read it first and apply the reconciliation
rules in §9 before touching code.** Everything else in this plan is designed
against the current codebase (commit `f1ba056`, v1.13.2) and is executable as-is
if A's changes are orthogonal.

Two features:

1. **Belka tax toggle** — optional persisted setting applying the Polish 19%
   capital-gains tax ("podatek Belki") to withdrawals, with exact **nominal
   cost-basis tracking**, showing the net-of-tax FIRE target difference and the
   tax-aware FIRE date.
2. **IKE/IKZE buckets** — model the two tax-sheltered accounts (3 portfolio
   sub-buckets: IKE / IKZE / taxable), annual contribution limits, per-bucket
   withdrawal tax, the IKZE PIT refund credited the following year, and show how
   much the accounts shave off the FIRE date.

Verified facts (July 2026) baked into this plan:

- Belka rate is still a flat **19%**, applied to **nominal** gains only (never
  principal).
- 2026 annual limits: **IKE 28 260 zł**, **IKZE 11 304 zł** (employees) /
  **16 956 zł** (self-employed).
- IKE: gains tax-free when withdrawn after age **60** (55 with early-retirement
  rights — not modeled, see §2) with contributions in ≥5 calendar years
  (assumed satisfied, see §2).
- IKZE: contributions deduct from the PIT base (12% or 32% marginal bracket →
  that is the refund); withdrawal after **65** taxed at a flat **10% ryczałt on
  the whole amount**.
- OKI reform (Osobiste Konto Inwestycyjne): passed the Sejm 3 July 2026, Senate
  pending, effective 1 Jan 2027. **Do NOT model it** — one Polish UI note only
  (§6).

---

## 1. Non-goals (explicit scope cuts)

- **No OKI modeling.** One informational sentence in the settings UI.
- **No tax on the cash bucket** (house fund). `cashReturnReal` defaults to 0;
  Belka on deposit interest is out of scope. Only the `portfolio` bucket is
  taxed.
- **No tax on accumulation-phase sales.** When a deficit month drains the
  portfolio, buckets/basis shrink proportionally but no tax is levied.
  Consequence (a deliberate, testable invariant): with taxes enabled the
  cash/portfolio **totals** of `replayBalances` are byte-identical to the
  disabled case, and `projectFire` flows are identical too unless the IKZE
  refund injects new money. Only the FIRE **condition** (and new informational
  fields) changes.
- **„Do zera" (`dieWithZeroTargetAt`/`projectDieWithZero`) stays gross-of-tax.**
  Batch F's copy sweep can add a caveat line; we do not change the math here.
- **`oneOffImpact` (motivation layer) stays gross-of-tax** — it is a
  keystroke-path O(1) function; threading a basis through it is not worth it.
- **`fiStats` FI% stays portfolio/net-target.** The tax view lives in the new
  Analiza „Podatki" section, not sprinkled over every stat.
- **Dashboard (Pulpit) untouched.** Its chart keeps plotting gross portfolio vs
  net target; the FIRE marker it shows comes from `projection.fireYm`, which IS
  tax-aware — acceptable, and batch F's IA pass can revisit.
- **No new Symulacja tab.** The with/without comparisons live in Analiza; the
  existing Symulacja calculators become tax-aware automatically because they go
  through `projectionWith`.

## 2. Locked design decisions (do not re-derive)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Exact nominal cost-basis tracking**, not the gross-up shortcut. Basis is tracked in **nominal PLN** (anchor-epoch, via `toNominal`) alongside the real bucket values. | Belka taxes nominal gains; with inflation > 0 the real effective tax exceeds 19% of real gains — a real-basis model would systematically understate tax. Matches the repo invariant: nominal quantities end in `Nominal`, conversions only via `toNominal`/`toReal`. |
| D2 | One unified mechanism for both features: a **bucket tracker** (taxable / IKE / IKZE, with nominal bases for taxable and IKE) threaded through the two monthly loops. Belka-only = everything sits in the taxable bucket. | One code path, one test surface; IKE/IKZE is "Belka + routing", not a second tax engine. |
| D3 | FIRE condition with taxes on: **net-of-tax portfolio value ≥ net target** (`fireTargetAt` unchanged). Net value = Σ per-bucket after-tax liquidation values at that month's age (formulas in §3.4). | Algebraically identical to grossing the target up per bucket, but stays a single comparable number and never touches `fireTargetAt`'s many call sites (buildPlan, swrComparison, dieWithZero, oneOffImpact…). |
| D4 | Age gates use **whole years** from `ageAt(...).years`: IKE tax-free at ≥ 60, IKZE ryczałt 10% at ≥ 65. Before the gate: IKE early return pays Belka on gains (gated on `belkaEnabled`), IKZE early return pays the marginal PIT rate on the **whole** amount (applies regardless of `belkaEnabled` — it is PIT, not Belka). Missing `birthDate` → early rates (conservative). IKE's "55 with early-retirement rights" and the "≥5 calendar years of contributions" condition are **assumed away** (tooltip mentions them; the app plans decades ahead). | Deterministic, testable, mirrors how `ageAt` is used elsewhere. |
| D5 | **Limits are constant-real** at the 2026 values (28 260 / 11 304 / 16 956 zł real). | Legal limits are indexed to projected average salary, i.e. they grow nominally roughly with inflation + real wage growth; constant-real assumes indexation ≈ inflation, which is the app's convention for "keeps pace" quantities (rent). Choosing `incomeGrowthReal` instead was rejected: that is the *user's personal* raise path, not the national average wage. Constant-real also means the monthly loop compares real contributions against fixed real limits — zero conversions. Stated as an assumption in the methodology copy. |
| D6 | **Fill order: IKZE → IKE → taxable.** Only regular invest-phase contributions (incl. the reinvested refund) route through the limits; **loan spills go straight to taxable**. Deficits drain **taxable → IKE → IKZE**; if all buckets are empty the remainder makes taxable negative (basis floored at 0, negative taxable valued untaxed). | IKZE first because the PIT refund is an immediate, guaranteed return at the marginal rate. Spills-to-taxable keeps IKZE contributions strictly inside the invest phase, which guarantees the April refund also lands in the invest phase (phases only move saving → debt → invest). Negative-taxable mirrors how `portfolio` itself can go negative in deficits today. |
| D7 | **IKZE refund = `pitRate × (real IKZE contributions of the previous calendar year)`, credited in APRIL of the following year, projected months only.** In history replay the refund is *never* injected — check-in entries are the source of truth and already contain whatever refund the user actually received. The projected refund is added to that month's savings `s` *before* phase routing, so it behaves exactly like extra savings (per spec) and re-enters the IKZE→IKE→taxable filling. | April ≈ typical e-filing refund arrival; any fixed month works, this one is realistic and deterministic. Refund-in-real from contributions-in-real is self-consistent (both deflated the same way). |
| D8 | **Basis seeding**: `portfolioStart` (and the optional `ikeStart`/`ikzeStart` split) is treated as **all principal** — basis = value at anchor (price factor 1 → nominal = real). Start balances do not count toward that year's contribution limits. | We cannot know the embedded gains of a pre-existing portfolio; all-principal is the simple, slightly tax-understating default. Documented in methodology copy; an optional "starting basis" field is a possible future extension, not in scope. |
| D9 | **`balanceOverride` / tracker resync**: scale all buckets *and* both nominal bases by `newTotal/oldTotal` (preserves gain shares and bucket mix). If old total ≤ EPS: everything to taxable, basis = `toNominal(new, …)`. | An override says "the total is X", nothing about composition; proportional scaling is the least-information-destroying choice and keeps `gainShare` continuous. |
| D10 | Withdrawal-phase order: **taxable first, then IKE, then IKZE**, each grossed up by its own current rate so that the *net* covers expenses. | Lets sheltered accounts compound longest; deterministic; produces the visible (and correct) effect that the yearly tax column drops when the retiree turns 60/65. |
| D11 | The two toggles are **independent**. `belkaEnabled` off + `ikeIkze` on is coherent: taxable and early-IKE valuations become tax-free, IKZE keeps its PIT-based exit rates and refund. UI hint says IKE only shows benefits with Belka on. | The math is well-defined for all four combinations; forcing coupling adds UI states for no modeling gain. |
| D12 | Both bucket values grow at the same `realReturnAnnual` as the portfolio (same investments). | The app has one return assumption; per-account returns are out of scope. |
| D13 | State lives in a new top-level section `state.taxes` (not under `assumptions`) — it is a feature configuration, not a market assumption, and `projectionWith` gets a parallel `taxes` override. | Mirrors how `housing` is separated from `assumptions`. |

## 3. Engine changes (`js/engine.js`)

All new code below the existing "Analiza" banner or in a new section banner
`// ── Podatki: Belka + IKE/IKZE ──` placed after the loan section. Code
comments in Polish (match file style). Everything pure — no DOM, no storage.

### 3.1 Constants

```js
export const BELKA_RATE = 0.19;
export const IKZE_EXIT_RATE = 0.10;          // ryczałt przy wypłacie po 65
export const IKE_ACCESS_AGE = 60;            // pełne lata
export const IKZE_ACCESS_AGE = 65;
export const IKE_LIMIT_YEARLY = 28260;       // 2026, realnie (D5)
export const IKZE_LIMIT_EMPLOYEE = 11304;    // 2026, realnie
export const IKZE_LIMIT_SELFEMPLOYED = 16956;// 2026, realnie
export const IKZE_REFUND_MONTH = 4;          // kwiecień (D7)
```

### 3.2 Small helpers

```js
// Aktywność podatków — jedno miejsce prawdy dla obu pętli i UI.
export function taxesActive(state) {
  const t = state.taxes || {};
  const ik = t.ikeIkze || {};
  return { belka: !!t.belkaEnabled, ikeIkze: !!ik.enabled, any: !!t.belkaEnabled || !!ik.enabled };
}

export function ikzeLimitFor(taxes) {
  return (taxes.ikeIkze.employmentForm === 'selfEmployed')
    ? IKZE_LIMIT_SELFEMPLOYED : IKZE_LIMIT_EMPLOYEE;
}

// Udział zysku (nominalnego!) w kubełku: 1 − basisNominal / wartośćNominal.
// bucketReal ≤ EPS → 0 (kubełek pusty/ujemny nie generuje podatku). Clamp [0,1].
export function gainShareOf(bucketReal, basisNominal, anchor, ym, infl) {
  if (!(bucketReal > EPS)) return 0;
  const nom = toNominal(bucketReal, anchor, ym, infl);
  return Math.min(1, Math.max(0, 1 - basisNominal / nom));
}

// Cel brutto przy podatku Belki (gross-up) — TYLKO do wyświetlania różnicy celu.
export function belkaGrossTarget(targetNetReal, gainShare, rate = BELKA_RATE) {
  return targetNetReal / (1 - rate * Math.min(1, Math.max(0, gainShare)));
}
```

### 3.3 The bucket tracker — `makeTaxTracker(state, snapshot = null)`

A factory returning a plain closure object. Created *inside* `replayBalances`
and `projectFire` runs (no module state → replay functions stay pure and
deterministic). `snapshot` resumes a tracker at the history→projection seam.

Internal state (all real PLN unless suffixed `Nominal`):

```js
{ taxable, ike, ikze,                 // wartości kubełków (realnie)
  taxableBasisNominal, ikeBasisNominal, // koszt nabycia (nominalnie); IKZE bez basis
  ytdIkze, ytdIke,                    // wpłaty w bieżącym roku kalendarzowym (realnie)
  prevYearIkze,                       // wpłaty na IKZE w poprzednim roku (realnie)
  year }                              // rok kalendarzowy ostatnio przetworzonego miesiąca
```

Initial state (no snapshot): `taxable = (portfolioStart − ikeStart − ikzeStart)`,
`ike = ikeStart`, `ikze = ikzeStart` (both 0 when `ikeIkze` disabled — the split
is ignored, everything is taxable), `taxableBasisNominal = taxable`,
`ikeBasisNominal = ike` (anchor month ⇒ price factor 1, D8), counters 0,
`year = Number(anchorMonth.slice(0, 4))`.

Methods (exact math):

```js
// Początek miesiąca: przełom roku zeruje liczniki; zwraca kwotę zwrotu PIT
// (realnie) należną w tym miesiącu — wołający decyduje, czy ją wstrzyknąć
// (projekcja: tak; historia: ignoruje — wpisy są prawdą, D7).
beginMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  if (y > year) { prevYearIkze = (y === year + 1) ? ytdIkze : 0; ytdIkze = 0; ytdIke = 0; year = y; }
  return (ikeIkzeOn && m === IKZE_REFUND_MONTH) ? pitRate * prevYearIkze : 0;
}

// Zwykła wpłata (c ≥ 0, realnie): IKZE → IKE → taxable wg limitów rocznych (D6).
contribute(cReal, ym) {
  let rest = cReal;
  if (ikeIkzeOn) {
    const toIkze = Math.min(rest, Math.max(0, ikzeLimit - ytdIkze));
    ikze += toIkze; ytdIkze += toIkze; rest -= toIkze;
    const toIke = Math.min(rest, Math.max(0, IKE_LIMIT_YEARLY - ytdIke));
    ike += toIke; ikeBasisNominal += toNominal(toIke, anchor, ym, infl);
    ytdIke += toIke; rest -= toIke;
  }
  taxable += rest; taxableBasisNominal += toNominal(rest, anchor, ym, infl);
}

// Wpływ omijający limity (spill z kredytów, D6) — prosto do taxable.
contributeTaxable(cReal, ym) {
  taxable += cReal; taxableBasisNominal += toNominal(cReal, anchor, ym, infl);
}

// Wypłata/deficyt (w ≥ 0): taxable → IKE → IKZE; basis maleje PROPORCJONALNIE
// (czynnik (bal−x)/bal jest niezależny od epoki — liczony na realach).
// Nadwyżka ponad sumę kubełków ujemni taxable (basis floor 0). Bez podatku (§1).
withdraw(wReal) {
  const t = Math.min(Math.max(taxable, 0), wReal);
  if (taxable > EPS) taxableBasisNominal *= (taxable - t) / taxable;
  taxable -= t; let rest = wReal - t;
  const i = Math.min(ike, rest);
  if (ike > EPS) ikeBasisNominal *= (ike - i) / ike;
  ike -= i; rest -= i;
  const z = Math.min(ikze, rest);
  ikze -= z; rest -= z;
  if (rest > 0) taxable -= rest;              // niedobór → taxable na minus
}

// Wzrost miesięczny: kubełki × (1+r); bases bez zmian (zysk to zysk).
grow(rMonthly) { taxable *= 1 + rMonthly; ike *= 1 + rMonthly; ikze *= 1 + rMonthly; }

// Korekta salda portfela (D9): skaluj kubełki i bases przez newTotal/oldTotal.
setTotal(newTotalReal, ym) {
  const tot = taxable + ike + ikze;
  if (tot > EPS) {
    const f = newTotalReal / tot;
    taxable *= f; ike *= f; ikze *= f;
    taxableBasisNominal *= f; ikeBasisNominal *= f;
  } else {
    taxable = newTotalReal; ike = 0; ikze = 0;
    taxableBasisNominal = Math.max(0, toNominal(newTotalReal, anchor, ym, infl));
    ikeBasisNominal = 0;
  }
}

// Wartość netto po podatku "jakby zlikwidować dziś" (warunek FIRE, D3/D4).
netValueReal(ym) {
  const age = birthDate ? ageAt(birthDate, ym).years : -1;   // brak daty → stawki "wczesne"
  const gT = gainShareOf(taxable, taxableBasisNominal, anchor, ym, infl);
  const taxableNet = belkaOn ? taxable * (1 - BELKA_RATE * gT) : taxable;
  const gI = gainShareOf(ike, ikeBasisNominal, anchor, ym, infl);
  const ikeNet = (age >= IKE_ACCESS_AGE) ? ike
    : (belkaOn ? ike * (1 - BELKA_RATE * gI) : ike);
  const ikzeNet = (age >= IKZE_ACCESS_AGE) ? ikze * (1 - IKZE_EXIT_RATE)
    : ikze * (1 - pitRate);
  return taxableNet + ikeNet + ikzeNet;
}

// Zrzut do wiersza serii / snapshot do wznowienia w projekcji.
row()      → { taxable, ike, ikze, taxableBasisNominal, ikeBasisNominal }
snapshot() → { ...row(), ytdIkze, ytdIke, prevYearIkze, year }
```

Note on `withdraw` in negative-taxable territory: valuation of a negative
taxable bucket is the raw value (untaxed) because `gainShareOf` guards on
`bucketReal ≤ EPS` — a debt-like residual carries no tax.

### 3.4 `replayBalances` — same signature, threaded tracker

`export function replayBalances(state, uptoYm, debtRes = null, familyRes = null)`
(unchanged). New behavior only when `taxesActive(state).any`:

- Before the loop: `const tracker = active.any ? makeTaxTracker(state) : null;`
- Mutation mirror, in the loop's **existing order** (do not reorder anything):
  1. Top of loop body: `if (tracker) tracker.beginMonth(idxToYm(idx));`
     — return value (refund) **ignored** in history (D7).
  2. `phase === 'invest' && contribution >= 0` → after `portfolio += contribution`:
     `tracker.contribute(contribution, ym)`.
  3. Deficit branch → after `portfolio -= deficit`: `tracker.withdraw(deficit)`
     (only the portfolio part, i.e. `deficit` after cash drain).
  4. Mortgage/family spills → after `portfolio += spill`:
     `tracker.contributeTaxable(spill, ym)` (D6).
  5. House-spend month → after `portfolio -= fromPort`: `tracker.withdraw(fromPort)`.
  6. After `portfolio *= 1 + rPort`: `tracker.grow(rPort)`.
  7. `balanceOverride != null` → after `portfolio = e.balanceOverride`:
     `tracker.setTotal(e.balanceOverride, ym)`.
     (`cashOverride` does not touch the tracker.)
- Each pushed row additionally gets, when tracker present:
  `buckets: tracker.row()`, `netPortfolio: tracker.netValueReal(ym)` (computed
  after growth/overrides, i.e. on end-of-month values, same as `cash`/`portfolio`).
- Result object gains `taxSnapshot: tracker ? tracker.snapshot() : null`.

**Invariant (test T-B7):** `cash`, `portfolio`, and every existing row field are
bit-identical with taxes on vs off. The tracker only *observes*.

### 3.5 `projectFire` — same signature, tax-aware condition

`export function projectFire(state, plan, balances, debtRes, familyRes, uptoYm)`
(unchanged signature). Changes:

- Setup: `const active = taxesActive(state);`
  `const tracker = active.any ? makeTaxTracker(state, balances.taxSnapshot) : null;`
- The `series` seed rows (mapped from `balances.rows`) copy `buckets` and
  `netPortfolio` through when present.
- Projected loop, mirroring mutations in **existing order**:
  1. Top of loop body: `const refund = tracker ? tracker.beginMonth(ym) : 0;`
     then `const s = pm.plannedSavings + delta + refund;` — the refund IS
     injected here (projected months only, D7). When `!active.ikeIkze`,
     `beginMonth` returns 0, so `s` is unchanged.
  2. Family-loan spill → `tracker.contributeTaxable(spillReal, ym)`.
  3. Debt-active branch: mortgage spill → `contributeTaxable(spillReal, ym)`;
     deficit portfolio drain → `tracker.withdraw(deficit − fromCash)`.
  4. Saving-phase branch: portfolio drain → `tracker.withdraw(...)` (no
     contribution call — money goes to cash).
  5. Invest branch: `s >= 0` → `tracker.contribute(s, ym)`; else
     `tracker.withdraw(deficit − fromCash)`.
  6. House-spend: `tracker.withdraw(fromPort)`.
  7. After `portfolio *= 1 + rPort`: `tracker.grow(rPort)`.
  8. Pushed series row gains `buckets: tracker.row()`,
     `netPortfolio: tracker.netValueReal(ym)` when tracker present.
  9. **FIRE condition** becomes:
     ```js
     const effective = tracker ? tracker.netValueReal(ym) : portfolio;
     if (!fireYm && houseSettled && famSettled && effective >= pm.targetReal - EPS) { … }
     ```
- Result object gains `taxes: active` (so builders know what applied) — all
  existing fields unchanged.

**Invariants:** taxes fully off ⇒ output deep-equal to today (T-B1). Belka-only
⇒ identical flows/series values, only `fireYm`/`netPortfolio` may differ (T-B7).
`ikeIkze` on ⇒ flows may differ only in April months (refund) (T-B12).

### 3.6 `projectWithdrawal` — same signature, per-bucket gross-up

`export function projectWithdrawal(state, opts = {})` (unchanged signature;
reads `state.taxes`). When `taxesActive(state).any` is false → **byte-identical
output to today** (keeps F13 green, incl. the 8.15% nominal-rate assertion).

Bucket seeding (real values + nominal bases, anchor epoch):

- If `opts.projection` has series rows with `buckets`: take the row at
  `startYm` (or the nearest preceding row), then scale buckets *and* bases by
  `startPortfolioReal / rowPortfolio` (preserves gain shares; if
  `rowPortfolio ≤ EPS` → all taxable, basis = `toNominal(startPortfolioReal,
  anchor, startYm, infl)`, gainShare 0).
- No projection / no buckets on rows: all taxable, basis as above (documented:
  conservative-low tax; the app always passes a projection in practice).

Yearly loop (n = 1…years), replacing the plain
`endReal = (startReal − withdrawal) × (1 + realRate)` when taxes active —
withdraw-then-grow order preserved:

```js
const ym = addMonths(startYm, (n - 1) * 12);
const age = birth ? ageAt(birth, ym).years : -1;
let need = withdrawalRealYearly;               // NETTO — tyle musi zostać na wydatki
let taxReal = 0;
// 1) taxable: efektywna stawka 19% × gainShare (0 gdy belka wyłączona)
const gT = gainShareOf(taxable, taxableBasisNominal, anchor, ym, infl);
const rT = belkaOn ? BELKA_RATE * gT : 0;
const gross = Math.min(Math.max(taxable, 0), rT < 1 ? need / (1 - rT) : Infinity);
taxableBasisNominal *= taxable > EPS ? (taxable - gross) / taxable : 1;
taxable -= gross; need -= gross * (1 - rT); taxReal += gross * rT;
// 2) IKE: 0% po 60; wcześniej Belka od zysków (gdy belkaOn) — ta sama formuła
// 3) IKZE: stawka = age ≥ 65 ? 0.10 : pitRate, od CAŁEJ kwoty — ta sama formuła bez basis
// depleted, gdy need > EPS po wyczerpaniu kubełków
taxable *= 1 + realRate; ike *= 1 + realRate; ikze *= 1 + realRate;
```

Row fields: existing columns keep their meaning (`withdrawalReal/Nominal` stay
**net** = expenses); new per-row fields `taxReal`, `taxNominal
(= taxReal × pf1)`, `grossReal (= withdrawalReal + taxReal)`. `startReal`/
`endReal` = bucket sums; nominal derived columns unchanged in formula. Result
gains `taxesApplied` (the `taxesActive` triple) and `taxTotalReal`. The
`gainShareOf` calls use the **anchor epoch** (`priceFactorAtStart` already
exists for display; ratios are epoch-invariant so no double conversion —
comment this in code).

### 3.7 `taxStats` — data for the Analiza „Podatki" cards

```js
// Statystyki podatkowe "na dziś" — czysta, licząca się przy renderze Analizy.
// null, gdy podatki wyłączone.
export function taxStats(state, balances, nowYm = todayYm()) {
  const active = taxesActive(state);
  if (!active.any) return null;
  const snap = balances.taxSnapshot; // zawsze obecny gdy active.any (3.4)
  const gT = gainShareOf(snap.taxable, snap.taxableBasisNominal, state.anchorMonth, nowYm, state.assumptions.inflationAnnual);
  const targetNet = fireTargetAt(state, nowYm);
  // Cel brutto liczony z gainShare CAŁEGO portfela traktowanego jak taxable —
  // pojedyncza liczba "różnicy celu" dla karty Belki.
  return {
    active,
    buckets: { taxable: snap.taxable, ike: snap.ike, ikze: snap.ikze },
    gainShareTaxable: gT,
    netValueReal: /* makeTaxTracker(state, snap).netValueReal(nowYm) */,
    targetNet,
    targetGross: active.belka ? belkaGrossTarget(targetNet, gT) : targetNet,
    ytdIkze: snap.ytdIkze, ytdIke: snap.ytdIke,
    nextRefund: active.ikeIkze ? state.taxes.ikeIkze.pitRate * snap.ytdIkze : 0,
    limits: { ike: IKE_LIMIT_YEARLY, ikze: ikzeLimitFor(state.taxes) },
  };
}
```

(Implementation may instantiate a tracker from the snapshot for `netValueReal`
— cheap, O(1).)

### 3.8 `projectionWith` — `taxes` override

```js
export function projectionWith(state, { assumptions = {}, taxes = null,
  extraMonthlySavings = 0, extraSavings = null } = {}, now = new Date()) {
  const st = { ...state, assumptions: { ...state.assumptions, ...assumptions } };
  if (taxes) st.taxes = { ...state.taxes, ...taxes,
    ikeIkze: { ...state.taxes.ikeIkze, ...(taxes.ikeIkze || {}) } };
  …rest unchanged…
}
```

Purity: shallow copies only, never mutate `state` (extends existing F15a-style
guarantees; test T-B9). `solveExtraSavingsForAge`/`requiredSavingsForGoal` flow
through unchanged — they become tax-aware for free (monotonicity still holds:
more savings ⇒ every bucket ≥ pointwise ⇒ `netValueReal` ≥ ⇒ FIRE not later).

### 3.9 `createState` / `defaultAssumptions`

`defaultAssumptions()` unchanged. `createState` gains (and bumps `version: 3`,
see §4):

```js
taxes: {
  belkaEnabled: false,
  ikeIkze: { enabled: false, employmentForm: 'employee', pitRate: 0.12,
             ikeStart: 0, ikzeStart: 0 },
},
```

## 4. Persisted-state changes (`js/storage.js`)

Per the CLAUDE.md checklist — default in `createState` (§3.9), `validateState`,
migration:

1. `SCHEMA_VERSION` 2 → **3**. (`createState`'s literal `version: 2` → `3`;
   they must match — same convention as today.)
2. `migrate` — extend the chain:
   ```js
   case 2:
     // v2 → v3: sekcja podatków (Belka + IKE/IKZE), domyślnie wyłączona.
     cur.taxes = cur.taxes || {
       belkaEnabled: false,
       ikeIkze: { enabled: false, employmentForm: 'employee', pitRate: 0.12,
                  ikeStart: 0, ikzeStart: 0 },
     };
     cur.version = 3;
     // fall-through
   case 3:
     break;
   ```
3. `validateState`: **no new hard check.** `validateState` runs *before*
   `migrate` in `load()`/`importPreview`, so v2 payloads legitimately lack
   `taxes`; it is not load-critical (a missing section is defaulted by the
   migration). Do not add a check that would reject v2 backups.
4. Export/import: nothing to do — `exportJSON` strips only `derived`;
   `importPreview` runs the same `migrate(validateState(...))` chain.
5. `state.derived` additions (`taxSnapshot` on balances, `buckets`/
   `netPortfolio` on series rows, `taxes` on projection) are cache — stripped by
   `stripDerived` automatically since they live under `derived`/inside results.

## 5. Pure builders + ui.js glue

### 5.1 `js/analysis.js` — new builders (pure, params in → string out)

- `export function belkaCard({ ts, fireWith, fireWithout })` — card
  „Podatek Belki 🧾". KV rows: net target, gross target, difference
  (`targetGross − targetNet`), current `gainShareTaxable`
  (`Fmt.formatPct`), FIRE date with vs without Belka using the existing
  `fireCell(fireWith, fireWithout)` (renders „▼ N mies. później"), plus a
  `metodologia([...])` block (copy in §6.3). Shown only when `ts.active.belka`.
- `export function ikeIkzeCard({ ts, fireWith, fireWithout, pitRate,
  employmentForm })` — card „IKE i IKZE 🛡️". KV rows: three bucket balances,
  the two annual limits, this-year IKZE/IKE contributions (`ytdIkze`/`ytdIke`),
  projected next-April refund (`nextRefund`), FIRE date with vs without IKE/IKZE
  (`fireCell(fireWith, fireWithout)` → „▲ N mies. wcześniej"), methodology
  block. Shown only when `ts.active.ikeIkze`.
- `withdrawalCard({ w, chartHTML })` — extend: when `w.taxesApplied?.any`, add
  header column „Podatek (nom.)" with `money(r.taxNominal)` per row, a summary
  line with `w.taxTotalReal`, and the extra methodology lines (§6.3). When taxes
  off, output is byte-identical to today (guard every addition on
  `w.taxesApplied`).

### 5.2 `js/ui.js` — glue only

- **Route/hub**: add `['🧾', 'Podatki', 'podatek Belki, IKE i IKZE',
  '#/plan/podatki']` to `renderPlanHub` items (before „Aplikacja"); add
  `else if (section === 'podatki') renderPlanPodatki();` to
  `renderPlanSection`. No `index.html` change (Plan hub is dynamic; `#/plan/*`
  already maps to the Plan tab via `activeRoute`).
- **`renderPlanPodatki()`** — follows the `renderPlanFire`/`renderPlanDom`
  pattern (`planBack`, `#plan-error`, `field()` helper, checkbox that toggles a
  `hidden` fields div, `#pl-save` → validate → mutate `state.taxes` →
  `E.recomputeDerived(state)` → `persist()` → `toast` → `location.hash =
  '#/plan'`). Controls:
  - checkbox `#pl-belka` → `taxes.belkaEnabled`; static info banner under it
    (OKI note, §6.1).
  - checkbox `#pl-ikeikze` toggling `#pl-ike-fields`:
    - `<select id="pl-emp">` options `employee`/`selfEmployed`;
    - `<select id="pl-pit">` options `12`/`32` → `pitRate = 0.12/0.32`;
    - `field({ id: 'pl-ike-start', … suffix: 'zł' })` → `ikeStart`;
    - `field({ id: 'pl-ikze-start', … suffix: 'zł' })` → `ikzeStart`;
  - Save-time validation: `ikeStart`/`ikzeStart` parsed with `parseMoney(…,
    { required: false })`, default 0, and
    `ikeStart + ikzeStart ≤ assumptions.portfolioStart` (error copy §6.1).
- **`renderAnaliza()`**: extend the sections array —
  `if (E.taxesActive(state).any) sections.push(['podatki', 'Podatki']);` (same
  guard-reset pattern as `kredyty`: if `anSection === 'podatki'` and inactive →
  `'przeglad'`). In the new branch compute:
  ```js
  const ts = E.taxStats(state, d.balances, nowYm);
  const withYm = proj.reached ? proj.fireYm : null;
  const noBelka = ts.active.belka
    ? E.projectionWith(state, { taxes: { belkaEnabled: false } }) : null;
  const noIke = ts.active.ikeIkze
    ? E.projectionWith(state, { taxes: { ikeIkze: { enabled: false } } }) : null;
  body = (ts.active.belka ? An.belkaCard({ ts, fireWith: withYm,
      fireWithout: noBelka.reached ? noBelka.fireYm : null }) : '')
    + (ts.active.ikeIkze ? An.ikeIkzeCard({ ts, fireWith: withYm,
      fireWithout: noIke.reached ? noIke.fireYm : null,
      pitRate: state.taxes.ikeIkze.pitRate,
      employmentForm: state.taxes.ikeIkze.employmentForm }) : '');
  ```
  (2 extra full projections, cheaper than the existing 13-run sensitivity card.)
- No other screen changes. Symulacja, Pulpit, check-in, coach untouched.
  `js/simulation.js` and `js/motivation.js` untouched.

### 5.3 Layering check

`engine.js` stays L0 (no new imports). `analysis.js` (L2) keeps importing only
engine/format/coach. All state mutation and `projectionWith` calls stay in
`ui.js` (L4). No new files ⇒ **no `PRECACHE` change in `sw.js`**, no version
bump (the wave's release agent bumps once at the end, per master plan).

## 6. Polish UI copy (draft — final wording may be polished by batch F)

### 6.1 Settings — Plan → Podatki (`#/plan/podatki`)

- Hub item: **„Podatki"** / subtitle: „podatek Belki, IKE i IKZE".
- Card title: **„Podatki 🧾"**.
- Belka checkbox label: **„Uwzględniaj podatek Belki (19%)"**.
  Tooltip (`tip`): „Podatek od zysków kapitałowych: przy sprzedaży inwestycji
  płacisz 19% od zysku — od tego, o ile cena sprzedaży przewyższa cenę zakupu.
  Liczony od kwot nominalnych, bez korekty o inflację — dlatego realnie oddajesz
  więcej niż 19% realnego zysku. Aplikacja śledzi koszt zakupu Twoich wpłat i
  powiększa cel FIRE tak, żeby po podatku zostało dokładnie tyle, ile
  potrzebujesz."
- OKI banner (always visible on this page, `banner info small`):
  „Od 2027 planowana jest reforma OKI (Osobiste Konto Inwestycyjne) — część
  oszczędności ma być zwolniona z podatku Belki. Aplikacja liczy według
  przepisów obowiązujących w 2026 r."
- IKE/IKZE checkbox label: **„Oszczędzam przez IKE i IKZE"**.
  Tooltip: „Konta emerytalne z ulgami: IKE — bez podatku Belki przy wypłacie po
  60. roku życia; IKZE — wpłaty odliczasz od podatku (zwrot PIT), a wypłatę po
  65. roku życia obciąża tylko 10% ryczałtu. Aplikacja wypełnia najpierw limit
  IKZE, potem IKE, resztę odkłada na zwykłe konto maklerskie."
- Field „Forma zatrudnienia" (`select`): options **„Umowa o pracę"** /
  **„Działalność gospodarcza"**. Hint: „Od formy zatrudnienia zależy roczny
  limit wpłat na IKZE: 11 304 zł (etat) albo 16 956 zł (działalność) — limity
  z 2026 r."
- Field „Twoja stawka PIT" (`select`): options **„12%"** / **„32%"**. Hint:
  „Tyle procent wpłaconej na IKZE kwoty wraca do Ciebie jako zwrot podatku w
  kolejnym roku."
- Field „Już zgromadzone na IKE" (suffix „zł"): hint „Część Twojego portfela
  startowego, która leży na IKE. Zostaw 0, jeśli zaczynasz od zera."
- Field „Już zgromadzone na IKZE" (suffix „zł"): hint analogiczny.
- Validation error: „Środki na IKE i IKZE nie mogą łącznie przekraczać portfela
  startowego ({kwota})."
- Save toast: **„Zapisano ustawienia podatków."**
- Footnote under save (muted small): „Gdy podatek Belki jest wyłączony, IKE nie
  zmienia prognozy — jego zaletą jest właśnie brak Belki. IKZE działa
  niezależnie (zwrot PIT i 10% ryczałtu przy wypłacie)."

### 6.2 Analiza — section tab + cards

- Tab label: **„Podatki"**.
- Card **„Podatek Belki 🧾"** KV labels: „Cel FIRE (netto, bez podatku)",
  „Cel FIRE (brutto, z podatkiem)", „Różnica przez podatek", „Udział zysku w
  portfelu (dziś)", „Data FIRE bez podatku", „Data FIRE z podatkiem".
- Card **„IKE i IKZE 🛡️"** KV labels: „Na IKE", „Na IKZE", „Konto zwykłe
  (opodatkowane)", „Roczny limit IKE (2026)", „Roczny limit IKZE (2026)",
  „Wpłacone na IKZE w tym roku", „Wpłacone na IKE w tym roku", „Zwrot PIT w
  przyszłym roku (prognoza)", „Data FIRE bez IKE/IKZE", „Data FIRE z IKE/IKZE".
- Withdrawal table new column header: **„Podatek (nom.)"**; summary KV:
  „Podatki w fazie wypłat łącznie (realnie)".

### 6.3 Methodology copy (`metodologia` lines)

Belka card:
- „Aplikacja śledzi koszt zakupu (basis) Twoich wpłat nominalnie: wpłata
  powiększa basis o swoją ówczesną wartość w złotówkach, wypłata zabiera basis
  proporcjonalnie, wzrost portfela go nie zmienia."
- „Podatek przy wypłacie = 19% × udział zysku = 19% × (1 − basis ÷ wartość
  nominalna). Od samych wpłat (kapitału) podatku nie ma."
- „Basis liczymy nominalnie, bo tak działa podatek Belki — zysk czysto
  inflacyjny też jest opodatkowany, więc realnie oddajesz więcej niż 19%
  realnego zysku."
- „Cel brutto = cel netto ÷ (1 − 19% × udział zysku) — tyle musi mieć portfel,
  żeby po podatku zostało dokładnie tyle, ile potrzebujesz."
- „Portfel startowy traktujemy jako w całości wpłaty (basis = wartość na
  starcie) — bez tej informacji to najprostsze bezpieczne założenie."

IKE/IKZE card:
- „Każda miesięczna nadwyżka wypełnia najpierw roczny limit IKZE, potem IKE,
  reszta idzie na zwykłe konto. Limity z 2026 r. traktujemy jako stałe w
  dzisiejszych złotówkach — ustawowo rosną z prognozowanym przeciętnym
  wynagrodzeniem, czyli mniej więcej z inflacją."
- „Zwrot PIT za wpłaty na IKZE (12% albo 32% wpłaconej kwoty) trafia do planu w
  kwietniu następnego roku jako dodatkowa oszczędność."
- „Warunek FIRE porównuje z celem portfel «po podatku»: IKE bez podatku po 60.
  roku życia (wcześniej jak zwykłe konto), IKZE minus 10% ryczałtu po 65.
  (wcześniej minus Twoja stawka PIT od całości), zwykłe konto minus 19% od
  zysków."
- „W fazie wypłat pieniądze wypływają najpierw ze zwykłego konta, potem z IKE,
  na końcu z IKZE — konta z ulgami pracują najdłużej."

Withdrawal card (added lines, only when taxes active):
- „Wypłata brutto jest powiększona tak, aby po podatku zostało dokładnie tyle,
  ile potrzebujesz na wydatki; kolumna «Podatek» pokazuje różnicę."
- „Podatek maleje skokowo, gdy kończysz 60 lat (IKE bez Belki) i 65 lat (IKZE:
  10% ryczałtu zamiast stawki PIT)."

## 7. Tests & fixtures

Fixture keys **F27 (Belka)** and **F28 (IKE/IKZE)** in `tests/fixtures.js` —
**if batch A already claimed F27/F28, renumber to the next free keys** and
update the CLAUDE.md test-inventory paragraph accordingly. Follow the F26
convention: fixtures store *inputs*; expected values computed in-test from
closed forms, plus a few hard anchors.

```js
// F27 — podatek Belki: basis nominalny, gross-up, niezmienniki włącz/wyłącz.
F27: {
  singleContrib: 10000, months: 24, infl: 0.03,   // gainShare = 1 − 1.03^(−2)
  netTarget: 1800000,
  eps: 1e-6,
},
// F28 — IKE/IKZE: limity 2026, kolejność wypełniania, zwrot PIT w kwietniu.
F28: {
  limits: { ike: 28260, ikzeEmployee: 11304, ikzeSelfEmployed: 16956 },
  yearlyContrib: 48000,                  // 4000/mies. → IKZE 11304, IKE 28260, taxable 8436
  taxableRemainder: 8436,
  refundEmployee12: 1356.48,             // 0.12 × 11304
  pit32: 0.32, refundMonth: '…-04',
  eps: 0.01,
},
```

Named tests in `tests/test-engine.js` (grouped under `// ── F27 …` and
`// ── F28 …` banners; reuse `baseState`, `NOW = 2026-07-15`, `entry`, `deep`):

**F27 — Belka**

- **T-B1 off-invariance**: `projectFire` (via `recomputeDerived`) on a state
  with `taxes` absent (v2-shaped, run through `migrate`) and with
  `taxes.belkaEnabled === false` produces `fireYm`, `series` portfolio/cash
  values, and `projectWithdrawal` rows identical to a pre-change golden run
  (assert against F13 fixture values: year-35 nominal 8 724 696,89, nominal rate
  8,15% — the existing F13 tests must simply stay green).
- **T-B2 never-taxed-on-principal**: `realReturnAnnual = 0`,
  `inflationAnnual = 0`, contributions only → tracker `gainShareOf` = 0 every
  month; `belkaGrossTarget(net, 0) === net`; `projectWithdrawal` `taxReal === 0`
  every year.
- **T-B3 nominal-basis (inflation-only gains)**: `realReturnAnnual = 0`,
  `inflationAnnual = 0.03`, single contribution `F27.singleContrib` at anchor,
  no further flows. After `F27.months`: `gainShare = 1 − 1.03^(−months/12)`
  (assertClose, `F27.eps`) — **real gains are zero yet tax > 0**, the
  basis-must-be-nominal assertion.
- **T-B4 gross-up algebra**: for the T-B3 state,
  `belkaGrossTarget(F27.netTarget, g) × (1 − 0.19 × g) === F27.netTarget`
  (assertClose) and `belkaGrossTarget` is increasing in `g`.
- **T-B5 proportional withdrawal preserves gainShare**: tracker with mixed
  basis; `withdraw(x)` for several x → gainShare before == after (assertClose).
- **T-B6 Belka delays FIRE (monotonicity + exact month)**: pick the F1-like
  state (income 10 000 / living 6 000, portfolioStart 100 000); assert
  `fireYm(belka on) ≥ fireYm(off)` on month indices, and pin the exact
  `fireYm` for the fixture state (compute once during implementation, assert
  as regression anchor).
- **T-B7 observer invariant**: same state, belka on vs off →
  `replayBalances` rows deep-equal on `cash`/`portfolio`/`flow*`;
  `projectFire` series equal on `portfolio` for the months both runs contain
  (fireYm may truncate the on-run later — compare the common prefix).
- **T-B8 withdrawal-phase basis erosion**: `projectWithdrawal` with belka on,
  `real = 0.05, infl = 0.03` → per-year `taxReal` strictly increasing while
  taxable-only (gainShare monotone ↑), and `endReal` identity
  `endReal = (startReal − withdrawalReal − taxReal) × 1.05` (assertClose per
  row).
- **T-B9 purity**: `projectionWith(state, { taxes: { belkaEnabled: true } })`
  leaves `state.taxes` (and the rest of state, `JSON.stringify` snapshot)
  untouched.

**F28 — IKE/IKZE**

- **T-B10 fill order & limits**: employee, 4 000 zł/mies. contributions for 24
  projected months (or via entries) → calendar-year sums: IKZE 11 304, IKE
  28 260, taxable `F28.taxableRemainder`; counters reset in January
  (`ytd* == 0` at year start via snapshot).
- **T-B11 self-employed limit**: `employmentForm: 'selfEmployed'` → IKZE fills
  to 16 956 before IKE receives anything.
- **T-B12 refund timing & amount**: contributions in projected year Y → April
  Y+1 series row has `flowPortfolio` exactly `F28.refundEmployee12` above the
  no-ikeIkze run's same row; **no** other projected month differs in flows;
  **no** refund appears in any `replayBalances` (history) row; a history year's
  IKZE contributions (entries through Dec, `NOW` in July next year) feed the
  first *projected* April — seam test via `balances.taxSnapshot.prevYearIkze`.
- **T-B13 pit32**: same as T-B12 with `pitRate: 0.32` → refund
  `0.32 × 11 304 = 3 617,28`.
- **T-B14 net valuation at age gates**: craft states where the birthDate puts
  the projected FIRE crossing just before/after age 60 (and 65): with the
  portfolio held exactly at the threshold, assert
  `netValueReal` uses `ike` (not taxed) from the month `age ≥ 60`, and
  `0.9 × ikze` from `age ≥ 65` / `(1 − pitRate) × ikze` before — unit-test the
  tracker directly (`makeTaxTracker` exported) rather than through full
  projections.
- **T-B15 FIRE date shaved**: belka on; enabling `ikeIkze` ⇒
  `ymToIdx(fireYm) ≤` baseline; pin the exact month pair for the fixture state
  as a regression anchor.
- **T-B16 bucket-sum invariant**: for every series row with buckets,
  `taxable + ike + ikze === portfolio` (assertClose 1e-6 relative), including
  after overrides, spills, house spend, deficits.
- **T-B17 override preserves composition (D9)**: entry with `balanceOverride`
  → bucket shares and both gainShares equal before/after (assertClose); zero →
  positive override lands all-taxable with gainShare 0.
- **T-B18 start balances (D8)**: `ikeStart`/`ikzeStart` seed buckets at anchor,
  bases = values, no `ytd` contribution counted; UI-level constraint
  `ikeStart + ikzeStart ≤ portfolioStart` is *not* an engine throw (engine
  trusts state; note in test as documentation).
- **T-B19 withdrawal order & tax cliff (D10)**: `projectWithdrawal` with all
  three buckets and FIRE age < 60: taxable drains first (`taxable` hits 0
  before `ike` moves); in the year `age` crosses 60 with only IKE left,
  `taxReal` drops to 0; with only IKZE left after 65, effective rate is exactly
  `0.10` of the gross (`taxReal === 0.1 × grossFromIkze`).
- **T-B20 spills bypass limits (D6)**: family-loan last-payment spill lands in
  `taxable` even when IKZE limit has headroom.

**Storage tests (update existing + add)**

- Update `tests/test-engine.js` lines ~457–469: „nowy stan = v2" → **v3**;
  export→validate→migrate roundtrip returns version 3; v99 reject unchanged.
- **T-B21 migration v1→3 and v2→3**: a v1 payload migrates through both steps
  (familyLoan added, then `taxes` defaults); a v2 payload (no `taxes`) gains
  the exact default `taxes` shape; an already-v3 payload passes through
  untouched (existing user `taxes` values not overwritten by `||`).
- **T-B22 import roundtrip**: `importJSON(exportJSON(state))` preserves
  `taxes` verbatim.

Also update the CLAUDE.md „Tests" paragraph (append the F27/F28 sentence) —
CLAUDE.md documents fixture coverage.

## 8. File-touch list (exact)

| File | Change |
|------|--------|
| `js/engine.js` | §3: constants, `taxesActive`, `ikzeLimitFor`, `gainShareOf`, `belkaGrossTarget`, `makeTaxTracker`, `taxStats`; thread tracker through `replayBalances` + `projectFire`; per-bucket tax in `projectWithdrawal`; `taxes` override in `projectionWith`; `taxes` section + `version: 3` in `createState`. |
| `js/storage.js` | `SCHEMA_VERSION = 3`; `migrate` case 2→3. |
| `js/analysis.js` | `belkaCard`, `ikeIkzeCard`; extend `withdrawalCard` (tax column + methodology, guarded). |
| `js/ui.js` | Hub item + `renderPlanSection` branch + `renderPlanPodatki()`; Analiza „Podatki" section (tab guard, `taxStats`, two `projectionWith` comparison runs, card calls). |
| `tests/fixtures.js` | `F27`, `F28` (renumber if A claimed them). |
| `tests/test-engine.js` | T-B1…T-B22; update version-literal assertions (~457–469). |
| `CLAUDE.md` | Append F27/F28 sentence to the Tests section; add `taxes` to the persisted-state sketch. |
| `docs/features/B-taxes.md` | Short maintenance doc (what/where/how to extend), per master plan. |
| `docs/INDEX.md` | Append one line. |

**Not touched**: `sw.js` (no new files → PRECACHE unchanged; no version bump —
release agent does it), `index.html`, `js/simulation.js`, `js/motivation.js`,
`js/coach.js`, `js/format.js`, `js/app.js`. No commits (master plan: working
tree only). `node tests/run-tests.js` must be green (121 existing + new).

## 9. Reconciliation with batch A (MANDATORY first step)

Batch A (`plans/A-retirement-projection.md`) lands first and "introduces a
unified extended projection-options object for retirement-phase what-ifs"
(bonds switch at retirement, expense freeze, ZUS/pension bridge, Barista FIRE,
stress tests, percentile bands). Before implementing B:

1. **Read A's plan and diff of `engine.js`.** Wherever this plan says
   "`projectFire`'s projected loop, existing order", re-locate the six mutation
   points (contribution routing, spills, deficits, house spend, growth,
   condition check) in A's post-change loop and mirror the tracker calls there.
   The tracker API itself is loop-agnostic.
2. **Options object**: if A replaced `projectWithdrawal(state, opts)` /
   `projectionWith(state, opts)` shapes, fold this plan's additions into A's
   object (`taxes` override key, `taxReal`/`taxNominal` row fields) instead of
   adding parallel parameters. Naming defers to A.
3. **Pension bridge interplay**: if A's withdrawal phase nets ZUS/pension income
   against expenses, the Belka gross-up applies to the **residual portfolio
   withdrawal** (need = expenses − pension for that year), not to the pension.
4. **Return switch at retirement**: if A grows the retirement portfolio at a
   bond rate, `tracker.grow`/bucket growth in `projectWithdrawal` uses A's
   effective rate — the basis logic is rate-agnostic.
5. **Fixture numbering**: if A used F27/F28, take the next free numbers and fix
   the references in §7 and CLAUDE.md.
6. **Percentile/stress reruns**: they call the same pipeline, so they become
   tax-aware automatically — verify A didn't clone the loop somewhere the
   tracker isn't threaded.

## 10. Implementation order (suggested)

1. Reconcile with A (§9). 2. Storage: schema v3 + migration + tests (T-B21/22).
3. Engine constants + tracker + unit tests (T-B2…T-B5, T-B10/11/14/17).
4. Thread `replayBalances` (T-B7/16/18/20), then `projectFire`
   (T-B1/6/12/13/15). 5. `projectWithdrawal` (T-B8/19) + `taxStats` +
   `projectionWith` override (T-B9). 6. Builders + settings page + Analiza
   section (manual check via `python -m http.server 8000`, incl. the `/FIRE/`
   subpath rehearsal). 7. Full test run, CLAUDE.md + docs updates.
