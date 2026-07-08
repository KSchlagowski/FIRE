# IKE/IKZE buckets — tax-sheltered accounts, limits, PIT refund (`taxes.ikeIkze`)

> **As shipped (v1.18.0):** the Belka release actually landed as **v1.17.0**
> with fixture **F30** (not v1.16.0/F29 as assumed below), so this feature
> shipped as **v1.18.0** with fixture **F31** (tests F31a–k). Schema step
> **5 → 6** as planned. Next free fixture key: F32.

## Context

Poland's two retirement wrappers change both the *tax* and the *timing* math:

- **IKE** — gains are **tax-free** when withdrawn after age **60** (55 with
  early-retirement rights) with contributions in ≥5 calendar years.
- **IKZE** — contributions **deduct from the PIT base** (12% or 32% marginal
  bracket → that percentage comes back as a refund the following year);
  withdrawal after age **65** is taxed at a flat **10% ryczałt on the whole
  amount** (principal + gains).

2026 annual limits, derived from the projected average monthly salary
(9 420 zł): **IKE 28 260 zł** (3×), **IKZE 11 304 zł** (1.2×, employees) /
**16 956 zł** (1.8×, self-employed). Statutorily they grow with projected
nominal wages; in the app's real-PLN world they are modeled **constant-real**
(D5 below — `incomeGrowthReal` indexing was considered and rejected).

This feature splits the portfolio into **three sub-buckets** (IKE / IKZE /
taxable), fills IKZE → IKE up to the annual limits first, applies per-bucket
tax at withdrawal (0% / 10% flat / 19%-on-gains), credits the IKZE PIT refund
as extra savings the following April, and shows in Analiza **how many months
the accounts shave off the FIRE date**. All deterministic, all engine-side.

This is **the IKE/IKZE half (feature 2) of `plans/B-taxes.md`** (the
authoritative design; decisions D1–D13 there are locked). It builds **directly
on the Belka release** (`docs/plan-belka-tax-toggle.md`, v1.16.0, schema 5,
fixture F29) — that plan ships the single-bucket `makeTaxTracker`,
`taxesActive`, `state.taxes`, the tracker threading through
`replayBalances`/`projectFire`/`projectWithdrawal`, `taxStats`, the `taxes`
override in `projectionWith`, and the `#/plan/podatki` settings page. **Do not
start this plan until that one is merged and green.** Ships as a normal
standalone release: **v1.17.0, committed in Polish**, schema **5 → 6**,
fixture **F30**.

Key locked decisions adopted from Plan B (see there for full rationale):

- **D4 — age gates on whole years** via `ageAt(birthDate, ym).years`: IKE
  tax-free at ≥ 60, IKZE ryczałt at ≥ 65. Before the gate: early IKE return
  pays Belka on gains (only when `belkaEnabled`), early IKZE return pays the
  marginal PIT rate on the **whole** amount (regardless of `belkaEnabled` —
  it is PIT, not Belka). Missing `birthDate` → early rates (conservative).
  The "55 with early-retirement rights" and "≥5 calendar years" conditions
  are **assumed away** (tooltip mentions them; the app plans decades ahead).
- **D5 — limits constant-real** at the 2026 values. Legal indexation tracks
  the projected national average wage ≈ inflation + real wage growth;
  constant-real assumes indexation ≈ inflation, the app's convention for
  "keeps pace" quantities (rent). `incomeGrowthReal` was rejected: that is
  the *user's personal* raise path, not the national average. Constant-real
  also means the monthly loop compares real contributions against fixed real
  limits — zero conversions. Stated in the methodology copy.
- **D6 — fill order IKZE → IKE → taxable** (IKZE first: the PIT refund is an
  immediate guaranteed return at the marginal rate). Only regular invest-phase
  contributions (incl. the reinvested refund) route through the limits; **loan
  spills go straight to taxable**. Deficits drain **taxable → IKE → IKZE**;
  past-empty the remainder makes taxable negative (basis floored at 0,
  negative taxable valued untaxed — mirrors how `portfolio` goes negative
  today).
- **D7 — IKZE refund** = `pitRate × (real IKZE contributions of the previous
  calendar year)`, credited in **April** of the following year, **projected
  months only**. History replay never injects it — check-in entries are the
  source of truth and already contain whatever refund actually arrived. The
  projected refund is added to that month's savings `s` *before* phase
  routing, so it behaves exactly like extra savings and re-enters the
  IKZE→IKE→taxable filling. (Phases only move saving → debt → invest and
  IKZE contributions only happen in the invest phase, so the April refund is
  guaranteed to land in the invest phase too.)
- **D8 — start balances**: optional `ikeStart`/`ikzeStart` split of
  `portfolioStart`, seeded at anchor as **all principal** (basis = value,
  price factor 1); they do **not** count toward that year's limits.
- **D9 — `balanceOverride`**: scale all buckets *and* both nominal bases by
  `new/old` (preserves gain shares and bucket mix); old total ≤ EPS →
  everything to taxable, basis = `max(0, toNominal(new, …))`.
- **D10 — withdrawal order taxable → IKE → IKZE**, each grossed up by its own
  current rate so the *net* covers expenses. Sheltered accounts compound
  longest; the yearly tax column visibly drops when the retiree turns 60/65.
- **D11 — the two toggles are independent.** `belkaEnabled` off + `ikeIkze`
  on is coherent (taxable and early-IKE become tax-free; IKZE keeps its
  PIT-based exit rates and refund). UI footnote says IKE only shows benefits
  with Belka on.
- **D12** — all buckets grow at the same `realReturnAnnual` (one return
  assumption; per-account returns out of scope).
- **D13** — config lives in `state.taxes.ikeIkze`; `projectionWith`'s `taxes`
  override deep-merges the subsection.

Non-goals carried over from Plan B §1 verbatim: no OKI modeling (the settings
page already carries the informational banner from the Belka release), no tax
on the cash bucket, no tax on accumulation-phase sales (buckets shrink, no tax
levied), „do zera" stays gross-of-tax, `oneOffImpact` stays gross-of-tax,
`fiStats` FI% stays gross-portfolio/net-target, Pulpit untouched, no new
Symulacja tab (existing calculators become IKE/IKZE-aware automatically via
`projectionWith` reading `state.taxes`).

## Reconciliation with the Belka release (its "Deviations" section, resolved)

`docs/plan-belka-tax-toggle.md` ends with a contract for this batch. Apply it:

| Belka release shipped | This batch does |
|---|---|
| `makeTaxTracker` single-bucket `{ value, basisNominal }`, methods `contribute` / `withdraw` / `grow` / `setTotal` / `netValueReal` / `gainShare` / `row` / `snapshot` | **widen in place** to the Plan B §3.3 bucket tracker (same method surface + `contributeTaxable` + `beginMonth`); with `ikeIkze` off everything routes to `taxable` and behavior is **byte-identical** (keeps F29 green) |
| `taxesActive` → `{ belka, any }` | → `{ belka, ikeIkze, any }` (`any = belka || ikeIkze`) |
| `state.taxes = { belkaEnabled }`, schema **5** | add `ikeIkze` subsection, migration **5 → 6** |
| fixture **F29** consumed | IKE/IKZE takes **F30** |
| series rows carry scalar `basisNominal` + `netPortfolio` | keep `basisNominal` (now the **sum** `taxableBasisNominal + ikeBasisNominal` — equal to the old value when `ikeIkze` off) and **add** `buckets: tracker.row()`; `projectWithdrawal` seeding prefers `buckets`, falls back to the scalar |
| `renderPlanPodatki` with the Belka checkbox + OKI banner | IKE/IKZE controls slot into the same page |
| `projectionWith` shallow-merges `taxes` | add the nested `ikeIkze` merge |
| version **v1.16.0** consumed | this release is **v1.17.0** |

Where this plan says "the six mirror points", it means the tracker calls the
Belka release threaded through `replayBalances` (contribution/deficit, spills,
house spend, growth, override) and `projectFire` (family spill, mortgage
spill, deficit drains, invest contribution, house spend, growth). Line numbers
below cite **pre-Belka v1.15.0 code** (e.g. `const s = pm.plannedSavings +
delta` at engine.js:612) — re-locate against the merged Belka diff.

## Step 1 — `js/engine.js`

All inside the Belka release's `// ── Podatki … ──` section (extend the banner
to `// ── Podatki: Belka + IKE/IKZE ──`). Everything pure, comments in Polish,
no new imports (engine stays L0).

1. **Constants + helper** (Plan B §3.1–3.2):

   ```js
   export const IKZE_EXIT_RATE = 0.10;           // ryczałt przy wypłacie po 65
   export const IKE_ACCESS_AGE = 60;             // pełne lata (D4)
   export const IKZE_ACCESS_AGE = 65;
   export const IKE_LIMIT_YEARLY = 28260;        // 2026, realnie (D5)
   export const IKZE_LIMIT_EMPLOYEE = 11304;     // 2026, realnie
   export const IKZE_LIMIT_SELFEMPLOYED = 16956; // 2026, realnie
   export const IKZE_REFUND_MONTH = 4;           // kwiecień (D7)

   export function ikzeLimitFor(taxes) {
     return ((taxes.ikeIkze || {}).employmentForm === 'selfEmployed')
       ? IKZE_LIMIT_SELFEMPLOYED : IKZE_LIMIT_EMPLOYEE;
   }
   ```

   `taxesActive` gains the key:
   `{ belka: !!t.belkaEnabled, ikeIkze: !!(t.ikeIkze && t.ikeIkze.enabled), any: … }`.

2. **Widen `makeTaxTracker(state, snapshot = null)`** to Plan B §3.3 (exact
   math there — reproduce it, don't re-derive). Internal state:

   ```js
   { taxable, ike, ikze,                   // wartości kubełków (realnie)
     taxableBasisNominal, ikeBasisNominal, // koszt nabycia (nominalnie); IKZE bez basis
     ytdIkze, ytdIke,                      // wpłaty w bieżącym roku kalendarzowym (realnie)
     prevYearIkze,                         // wpłaty na IKZE w poprzednim roku (realnie)
     year }                                // rok ostatnio przetworzonego miesiąca
   ```

   Initial (no snapshot): `ike = ikzeStart`-style seeding per D8 —
   `ike = ikeStart`, `ikze = ikzeStart`, `taxable = portfolioStart − ike −
   ikze` (both 0 when `ikeIkze` disabled), bases = values (anchor ⇒ factor 1),
   counters 0, `year = Number(anchorMonth.slice(0, 4))`. Methods:

   - `beginMonth(ym)` — **new.** Year rollover zeroes `ytd*` and sets
     `prevYearIkze = ytdIkze` only when the jump is exactly +1 year (bigger
     gap → 0). Returns the PIT refund due this month, `pitRate ×
     prevYearIkze` when `ikeIkze` on and month === `IKZE_REFUND_MONTH`, else
     0 — **the caller decides whether to inject it** (projection: yes;
     history: ignores, D7).
   - `contribute(cReal, ym)` — fills `min(rest, limit − ytd)` into IKZE, then
     IKE (bumping `ikeBasisNominal` via `toNominal`), remainder to taxable
     (bumping `taxableBasisNominal`). With `ikeIkze` off, straight to taxable
     — exactly the Belka behavior.
   - `contributeTaxable(cReal, ym)` — **new**, bypasses limits (loan spills,
     D6): taxable value + basis only.
   - `withdraw(wReal)` — drains taxable → IKE → IKZE (D6); each bucket's
     basis shrinks **proportionally** (`(bal − x)/bal`, epoch-independent);
     leftover past all three makes taxable negative, bases floored at 0.
   - `grow(rMonthly)` — all three buckets × `(1 + r)`; bases unchanged.
   - `setTotal(newTotalReal, ym)` — D9 rescale of all buckets + both bases;
     empty-total fallback: all taxable.
   - `netValueReal(ym)` — D3/D4 liquidation value:
     `taxableNet = belkaOn ? taxable·(1 − 0.19·gT) : taxable`;
     `ikeNet = age ≥ 60 ? ike : (belkaOn ? ike·(1 − 0.19·gI) : ike)`;
     `ikzeNet = age ≥ 65 ? ikze·(1 − 0.10) : ikze·(1 − pitRate)`;
     missing `birthDate` → `age = −1` (early rates). Negative buckets valued
     raw (`gainShareOf` guards on ≤ EPS).
   - `row()` → `{ taxable, ike, ikze, taxableBasisNominal, ikeBasisNominal }`;
     `snapshot()` → `{ ...row(), ytdIkze, ytdIke, prevYearIkze, year }`.

3. **`replayBalances`** — the Belka release already threads the mirror
   points. Three edits: (a) top of the loop body, `if (tracker)
   tracker.beginMonth(ym);` — **return value ignored** (history, D7);
   (b) the two spill mirrors switch `contribute` → **`contributeTaxable`**
   (D6); (c) pushed rows: `basisNominal` becomes the basis **sum**, plus
   `buckets: tracker.row()`. `netPortfolio` and `taxSnapshot` unchanged in
   shape (snapshot now carries the counters automatically).

4. **`projectFire`** — same signature. Edits: (a) top of the projected loop,
   `const refund = tracker ? tracker.beginMonth(ym) : 0;` then the savings
   line (engine.js:612 pre-Belka) becomes
   `const s = pm.plannedSavings + delta + refund;` — with `ikeIkze` off,
   `beginMonth` returns 0 and `s` is unchanged; (b) both spill mirrors
   (family :624, mortgage :637) switch to `contributeTaxable`; (c) seed-series
   map and pushed rows carry `buckets` + summed `basisNominal` as in step 3.
   FIRE condition already uses `tracker.netValueReal(ym)` (Belka) — the
   bucket-aware version slots in with no further change.

5. **`projectWithdrawal`** — per-bucket gross-up (Plan B §3.6). Taxes fully
   off ⇒ byte-identical (F13/F27 stay green). Seeding: prefer the series
   row's `buckets` (scale all buckets + bases by
   `startPortfolioReal / rowPortfolio`); scalar-`basisNominal`-only rows or
   no projection → all taxable (Belka fallback, unchanged). Yearly loop, in
   bucket order (D10), each leg using the same gross-up shape the Belka
   release introduced:

   ```js
   const age = birth ? ageAt(birth, ym).years : -1;
   let need = withdrawalReal;                    // NETTO (już przemnożone przez wG^(n−1))
   let taxReal = 0;
   // 1) taxable: stawka = belkaOn ? 0.19 × gainShare : 0
   // 2) IKE:     stawka = age ≥ 60 ? 0 : (belkaOn ? 0.19 × gainShare : 0)
   // 3) IKZE:    stawka = age ≥ 65 ? 0.10 : pitRate — od CAŁEJ kwoty, bez basis
   //    każda noga: gross = min(max(bal,0), need/(1−r)); basis ∝; need −= gross·(1−r)
   // depleted gdy need > EPS po trzech kubełkach; potem wszystkie ×(1+realRate)
   ```

   Row fields `taxReal`/`taxNominal`/`grossReal` keep their Belka meaning
   (now summed over legs); `startReal`/`endReal` = bucket sums. Result's
   `taxesApplied` is now the triple from `taxesActive`.

6. **`taxStats`** — widen per Plan B §3.7: add `buckets: { taxable, ike,
   ikze }`, `ytdIkze`, `ytdIke`, `nextRefund: pitRate × ytdIkze` (0 when
   `ikeIkze` off), `limits: { ike: IKE_LIMIT_YEARLY, ikze:
   ikzeLimitFor(state.taxes) }`. Existing Belka fields (`gainShare`,
   `netValueReal`, `targetNet`, `targetGross`, `basisNominal`) unchanged —
   `gainShare`/`targetGross` stay taxable-bucket-based (a single "target
   difference" number for the Belka card).

7. **`projectionWith`** — the Belka release merges `st.taxes = {
   ...state.taxes, ...taxes }`. Add the nested merge:
   `ikeIkze: { ...(state.taxes || {}).ikeIkze, ...(taxes.ikeIkze || {}) }`.
   Shallow copies only, never mutate `state` (F29i extends; test F30j).
   `solveExtraSavingsForAge`/`requiredSavingsForGoal` and every Symulacja
   calculator become IKE/IKZE-aware for free (monotonicity holds: more
   savings ⇒ every bucket ≥ pointwise ⇒ `netValueReal` ≥ ⇒ FIRE not later).

8. **`createState`**: `taxes` becomes

   ```js
   taxes: {
     belkaEnabled: false,
     ikeIkze: { enabled: false, employmentForm: 'employee', pitRate: 0.12,
                ikeStart: 0, ikzeStart: 0 },
   },
   ```

   and `version: 5` → `6`. `defaultAssumptions` unchanged.

Do NOT touch: `fireTargetAt`, `fireTargetsToday`, `buildPlan`, `replayDebt`,
`replayFamilyLoan`, `dieWithZeroTargetAt`, `projectDieWithZero`,
`oneOffImpact`, `fiStats`, `fireJourneyProgress`, `swrComparison`,
`retirementOpts`, `gainShareOf`, `belkaGrossTarget`.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 6;`
2. In `migrate`, replace `case 5: break;` with:

   ```js
   case 5:
     // v5 → v6: podsekcja IKE/IKZE, domyślnie wyłączona.
     if (!cur.taxes) cur.taxes = { belkaEnabled: false };
     if (!cur.taxes.ikeIkze) {
       cur.taxes.ikeIkze = { enabled: false, employmentForm: 'employee',
                             pitRate: 0.12, ikeStart: 0, ikzeStart: 0 };
     }
     cur.version = 6;
     // fall-through
   case 6:
     break;
   ```

3. `validateState`: **no new check** — a missing `ikeIkze` is not
   load-critical (migration backfills; `taxesActive` guards), and
   `validateState` runs before `migrate`, so v≤5 backups must not be rejected.
4. Export/import: nothing — new derived fields (`buckets` on rows, counters
   in `taxSnapshot`) live under `state.derived` and are stripped
   automatically.

## Step 3 — tests (run `node tests/run-tests.js` after; green before UI work)

1. **Touch-up first** (`tests/test-engine.js`): version literals `5` → `6`
   wherever the Belka release bumped `4` → `5` (the "nowy stan = v5" line,
   the migration-chain label, the reject case). The `createState().version
   === S.SCHEMA_VERSION` assertion stays green once both bump. **All F29
   assertions must stay green untouched** — with `ikeIkze` off the widened
   tracker is byte-identical to the single-bucket one.
2. **New fixture** (`tests/fixtures.js`, after F29; Plan B §7's F28 content,
   renumbered):

   ```js
   // F30 — IKE/IKZE: limity 2026, kolejność wypełniania, zwrot PIT w kwietniu.
   F30: {
     limits: { ike: 28260, ikzeEmployee: 11304, ikzeSelfEmployed: 16956 },
     yearlyContrib: 48000,        // 4000/mies. → IKZE 11304, IKE 28260, taxable 8436
     taxableRemainder: 8436,
     refundEmployee12: 1356.48,   // 0.12 × 11304
     refundPit32: 3617.28,        // 0.32 × 11304
     eps: 0.01,
   },
   ```

3. **New tests** (`tests/test-engine.js`, after the F29 block; Plan B §7
   T-B10…T-B22 renumbered to F30):
   - **F30a fill order & limits**: employee, 4 000 zł/mies. for 24 projected
     months → calendar-year sums IKZE 11 304, IKE 28 260, taxable
     `F30.taxableRemainder`; `ytd*` counters are 0 at each January (via
     snapshot / row buckets).
   - **F30b self-employed limit**: `employmentForm: 'selfEmployed'` → IKZE
     fills to 16 956 before IKE receives anything.
   - **F30c refund timing & amount**: contributions in projected year Y →
     the April Y+1 series row's `flowPortfolio` exceeds the
     `ikeIkze`-disabled run's same row by exactly `F30.refundEmployee12`;
     **no other projected month differs in flows; no** refund in any
     `replayBalances` (history) row; a history year's IKZE contributions
     (entries through December, `NOW` in July next year) feed the first
     *projected* April — seam via `balances.taxSnapshot.prevYearIkze`.
   - **F30d pit32**: same with `pitRate: 0.32` → refund `F30.refundPit32`.
   - **F30e net valuation at age gates**: unit-test the tracker directly —
     `netValueReal` returns raw `ike` from the month `age ≥ 60`,
     `0.9 × ikze` from `age ≥ 65`, `(1 − pitRate) × ikze` before; with
     `belkaEnabled: false` early IKE is untaxed but early IKZE still pays
     `pitRate` (D11).
   - **F30f FIRE date shaved**: belka on; enabling `ikeIkze` ⇒
     `ymToIdx(fireYm) ≤` baseline; pin the exact month pair for the fixture
     state during implementation as a regression anchor.
   - **F30g bucket-sum invariant**: for every series row with `buckets`,
     `taxable + ike + ikze ≈ portfolio` (assertClose, relative 1e-6) —
     including after overrides, spills, house spend, deficits; and the row's
     scalar `basisNominal === taxableBasisNominal + ikeBasisNominal`.
   - **F30h override preserves composition (D9)**: `balanceOverride` entry →
     bucket shares and both gainShares equal before/after (assertClose);
     zero → positive override lands all-taxable, gainShare 0.
   - **F30i start balances (D8)**: `ikeStart`/`ikzeStart` seed buckets at
     anchor, bases = values, no `ytd` counted. (The
     `ikeStart + ikzeStart ≤ portfolioStart` constraint is UI-level; the
     engine trusts state — note as documentation, no throw.)
   - **F30j withdrawal order & tax cliff (D10)**: `projectWithdrawal` with
     all three buckets, FIRE age < 60 → taxable hits 0 before `ike` moves;
     in the year age crosses 60 with only IKE left, `taxReal` drops to 0;
     with only IKZE left after 65, `taxReal === 0.10 × grossFromIkze`.
     Purity: `projectionWith(state, { taxes: { ikeIkze: { enabled: true } } })`
     leaves the `JSON.stringify(state)` snapshot untouched.
   - **F30k spills bypass limits (D6)**: a family-loan last-payment spill
     lands in `taxable` even with IKZE-limit headroom; flows outside April
     are identical to the `ikeIkze`-off run (refund is the only flow delta).
   - **Storage additions** (F11 region): v5 payload (no `ikeIkze`) →
     `migrate` → `version === 6` with the exact default subsection; v1 chain
     1→…→6 in one pass; an existing `ikeIkze` config survives migration
     untouched; `version: 7` rejected; `importJSON(exportJSON(state))`
     preserves `taxes.ikeIkze` verbatim.

## Step 4 — `js/analysis.js` (pure builders; copy from Plan B §5.1/§6)

1. **New `ikeIkzeCard({ ts, fireWith, fireWithout, pitRate, employmentForm })`**
   — card **„IKE i IKZE 🛡️"**, shown by ui.js only when `ts.active.ikeIkze`.
   KV rows (reuse `kv`/`money`/`fireCell`): „Na IKE" / „Na IKZE" / „Konto
   zwykłe (opodatkowane)" from `ts.buckets`; „Roczny limit IKE (2026)" /
   „Roczny limit IKZE (2026)" from `ts.limits`; „Wpłacone na IKZE w tym
   roku" `money(ts.ytdIkze)`; „Wpłacone na IKE w tym roku" `money(ts.ytdIke)`;
   „Zwrot PIT w przyszłym roku (prognoza)" `money(ts.nextRefund)`; „Data FIRE
   z IKE/IKZE" `fireCell(fireWith, fireWithout)` — renders **„▲ N mies.
   wcześniej"** when the accounts help. `metodologia([...])` — the four
   IKE/IKZE lines from Plan B §6.3 verbatim (fill order + constant-real
   limits, April refund, per-bucket FIRE condition, withdrawal order).
2. **`withdrawalCard`** — already tax-aware from the Belka release (column
   „Podatek (nom.)", `taxTotalReal` summary). One addition, guarded on
   `w.taxesApplied && w.taxesApplied.ikeIkze`: the cliff methodology line
   „Podatek maleje skokowo, gdy kończysz 60 lat (IKE bez Belki) i 65 lat
   (IKZE: 10% ryczałtu zamiast stawki PIT)."
3. `belkaCard` untouched.

## Step 5 — `js/ui.js` glue

1. **Settings** — extend `renderPlanPodatki()` (created by the Belka release)
   below the Belka checkbox, following its own `field()`/save pattern:
   - Hub item subtitle updates: `'podatek Belki (19%)'` → **„podatek Belki,
     IKE i IKZE"**.
   - checkbox `#pl-ikeikze` → `taxes.ikeIkze.enabled`, label **„Oszczędzam
     przez IKE i IKZE"**, tooltip: „Konta emerytalne z ulgami: IKE — bez
     podatku Belki przy wypłacie po 60. roku życia; IKZE — wpłaty odliczasz
     od podatku (zwrot PIT), a wypłatę po 65. roku życia obciąża tylko 10%
     ryczałtu. Aplikacja wypełnia najpierw limit IKZE, potem IKE, resztę
     odkłada na zwykłe konto maklerskie." Toggles a `#pl-ike-fields` div:
   - `<select id="pl-emp">` „Forma zatrudnienia": „Umowa o pracę" /
     „Działalność gospodarcza" → `employmentForm`. Hint: „Od formy
     zatrudnienia zależy roczny limit wpłat na IKZE: 11 304 zł (etat) albo
     16 956 zł (działalność) — limity z 2026 r."
   - `<select id="pl-pit">` „Twoja stawka PIT": „12%" / „32%" →
     `pitRate = 0.12 / 0.32`. Hint: „Tyle procent wpłaconej na IKZE kwoty
     wraca do Ciebie jako zwrot podatku w kolejnym roku."
   - `field #pl-ike-start` „Już zgromadzone na IKE" (suffix „zł") →
     `ikeStart`; hint: „Część Twojego portfela startowego, która leży na
     IKE. Zostaw 0, jeśli zaczynasz od zera." Analogous `#pl-ikze-start` →
     `ikzeStart`.
   - Save-time validation: both parsed with `parseMoney(…, { required:
     false })`, default 0; error when `ikeStart + ikzeStart >
     assumptions.portfolioStart`: „Środki na IKE i IKZE nie mogą łącznie
     przekraczać portfela startowego ({kwota})."
   - Footnote under save (muted small): „Gdy podatek Belki jest wyłączony,
     IKE nie zmienia prognozy — jego zaletą jest właśnie brak Belki. IKZE
     działa niezależnie (zwrot PIT i 10% ryczałtu przy wypłacie)."
   - Existing save flow unchanged (mutate `state.taxes` →
     `E.recomputeDerived(state)` → `persist()` → toast → `#/plan`).
2. **Analiza** — the „Podatki" section (created by the Belka release; its
   `taxesActive(state).any` tab guard already covers `ikeIkze`-only). Extend
   the branch:

   ```js
   } else if (anSection === 'podatki') {
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
   }
   ```

   (At most 2 extra full projections — still cheaper than the 13-run
   sensitivity card.)
3. Nothing else: Pulpit, check-in, coach, `simulation.js`, `motivation.js`
   untouched.

## Step 6 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three
places: `sw.js` `CACHE = 'fire-v1.17.0'`, `index.html` footer
`FIRE Companion v1.17.0`, `js/ui.js` `APP_VERSION = '1.17.0'`. Update
CLAUDE.md: append the F30 sentence to the Tests paragraph and widen the
`taxes` line in the persisted-state sketch. Commit in Polish, e.g.
`feat: IKE i IKZE — trzy kubełki portfela, limity roczne, zwrot PIT, podatek przy wypłacie (v1.17.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0 (all existing incl. F29 untouched +
   F30; F13/F27 numbers unchanged — taxes-off path stays byte-identical).
2. App run via preview:
   - **off-guard**: with `ikeIkze` off nothing changes vs v1.16.0 (Belka-only
     behavior identical, spot-check FIRE date + Analiza „Podatki" card set);
   - Plan → Podatki: new checkbox reveals the four fields; validation error
     fires when IKE+IKZE start exceeds `portfolioStart`; settings save and
     survive reload; export JSON has `version: 6` and the `ikeIkze` shape;
   - toggle on → Analiza „Podatki" gains the „IKE i IKZE 🛡️" card: three
     bucket balances sum to the portfolio, limits shown, ytd counters move
     after a check-in, refund forecast = pitRate × ytd IKZE, „Data FIRE z
     IKE/IKZE" earlier than without (▲ N mies. wcześniej);
   - Prognoza → Faza wypłat: with a birth date crossing 60/65 inside the
     table, the „Podatek (nom.)" column visibly steps down at those ages;
   - `ikeIkze` on + Belka off → IKE shows no benefit (footnote explains),
     IKZE refund + ryczałt still apply;
   - **Migration**: with pre-change v5 data in localStorage, reload → app
     loads, no error toasts, `ikeIkze` defaults off.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — settings page + Analiza load, no
   absolute-path 404s.

## Notes for future batches

- The tracker is now the full Plan B §3.3 shape — Plan B's tax design is
  complete after this release; `plans/B-taxes.md` becomes historical record.
- OKI (effective 2027): when enacted, model it as a **fourth bucket / new
  exemption layer** in the same tracker — new plan doc, new schema step.
- An optional "starting basis" field for pre-existing portfolios (relaxing
  D8's all-principal assumption) remains a possible extension — out of scope.
- Fixture **F30** is consumed here; the next free key is F31.
