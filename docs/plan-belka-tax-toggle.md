# Belka tax (19%) toggle — nominal cost-basis model (`taxes.belkaEnabled`)

## Context

The Polish capital-gains tax ("podatek Belki") is a flat **19% on nominal gains**
(never principal) — still true in 2026; no rate change happened. Today the app is
entirely gross-of-tax: the FIRE target, the FIRE condition, and the withdrawal
phase all pretend selling investments is free. This feature adds an **optional
persisted toggle** that:

1. applies Belka to withdrawals with **exact nominal cost-basis tracking**
   (not the gross-up shortcut — see D1 below),
2. shows the **net FIRE target difference** (gross target needed so that the
   after-tax value covers expenses) and the **tax-aware FIRE date**,
3. adds a per-year tax column to the Analiza withdrawal table.

**OKI is explicitly NOT modeled.** The OKI act (Osobiste Konto Inwestycyjne)
passed the Sejm on 3 July 2026, is now in the Senate, and takes effect
1 January 2027 (100 000 zł investment + 25 000 zł savings exempt from Belka,
asset-value tax above the limits, inflation-indexed from 2030). Until the law is
final, the app gets **one informational sentence in the settings UI** and
computes under 2026 rules. Revisit in a separate plan once enacted.

This is **the Belka half (feature 1) of `plans/B-taxes.md`** (the authoritative
design; decisions D1–D13 there are locked), implemented **standalone** — the
IKE/IKZE half is NOT built now. Ships as a normal standalone release:
**v1.16.0, committed in Polish**. Assumes a clean tree at `da312f3` (v1.15.0).

Key locked decisions adopted from Plan B (renumbered against today's code):

- **D1 — nominal basis.** Belka taxes nominal gains; with inflation > 0 the real
  effective tax exceeds 19% of real gains, so a real-basis model would
  systematically understate tax. The basis is tracked in **nominal PLN, anchor
  epoch**, converted only via `toNominal`/`toReal` (repo invariant). The tax at
  withdrawal is `19% × gainShare`, `gainShare = 1 − basisNominal/valueNominal`.
- **D3 — FIRE condition** with the toggle on: **net-of-tax portfolio ≥ net
  target**. `fireTargetAt` is untouched (its many call sites — buildPlan,
  swrComparison, dieWithZero, oneOffImpact — stay gross). Algebraically the same
  as grossing the target up, but keeps one comparable number.
- **D8 — basis seeding**: `portfolioStart` is all principal (basis = value at
  anchor; price factor 1 ⇒ nominal = real). Simple, slightly tax-understating;
  said in the methodology copy.
- **D9 — `balanceOverride`**: scale value *and* basis by `new/old` (preserves
  gainShare); old total ≤ EPS → basis = `max(0, toNominal(new, …))`.
- **D13 — state shape**: new top-level `state.taxes` section (feature config,
  not a market assumption — mirrors `housing`), `projectionWith` gets a `taxes`
  override.
- **D2 (scoped)**: Plan B's unified bucket tracker ships here as a
  **single-bucket** `makeTaxTracker` (value + `basisNominal`) with the same
  method surface; the IKE/IKZE batch extends it with buckets/limits/refund
  instead of rewriting (same precedent as `retirementOpts` in the bonds plan).

Non-goals carried over from Plan B §1 verbatim: no tax on the cash bucket, no
tax on accumulation-phase sales (the tracker only *observes* — flows are
byte-identical on/off), „do zera" stays gross-of-tax, `oneOffImpact` stays
gross-of-tax, `fiStats` FI% stays gross-portfolio/net-target, Pulpit untouched,
no new Symulacja tab (existing calculators become tax-aware automatically via
`projectionWith` reading `state.taxes`).

## Reconciliation with the code as of v1.15.0 (Plan B §9, resolved)

Plan B was written against v1.13.2; batches A features 1–2 have since shipped.
Apply these renumberings — everything else in B's Belka math stands:

| Plan B says | Reality now | Use |
|---|---|---|
| `SCHEMA_VERSION` 2 → 3 | schema is at **4** (bonds v3, freeze v4) | **4 → 5** |
| `createState` `version: 2` → 3 | literal is `4` (engine.js:1414) | → **5** |
| fixtures F27/F28 | claimed by batch A (bonds/freeze) | Belka = **F29**; IKE/IKZE later = F30 |
| withdrawal growth `realRate = a.realReturnAnnual` | `ro.postReturnReal` via `retirementOpts` (A-1) | tracker growth uses **`realRate` as-is** — basis logic is rate-agnostic (B §9.4) |
| flat withdrawal `withdrawalRealYearly` | grows by `wG` when freeze off (A-2) | the **net need** per year is the already-grown `withdrawalReal` |
| release bundled in the wave | standalone releases since | **v1.16.0** |

## Step 1 — `js/engine.js`

New section banner `// ── Podatki: Belka (19% od zysków nominalnych) ──` inserted
directly above `replayBalances` (engine.js:329). Everything pure, comments in
Polish, no new imports (engine stays L0).

1. **Constant + helpers** (Plan B §3.1–3.2, Belka subset):
   ```js
   export const BELKA_RATE = 0.19;

   // Aktywność podatków — jedno miejsce prawdy dla pętli i UI.
   // (Batch IKE/IKZE dołoży tu klucz ikeIkze.)
   export function taxesActive(state) {
     const t = state.taxes || {};
     return { belka: !!t.belkaEnabled, any: !!t.belkaEnabled };
   }

   // Udział zysku NOMINALNEGO: 1 − basisNominal / wartośćNominalna, clamp [0,1].
   // Wartość ≤ EPS → 0 (puste/ujemne saldo nie generuje podatku).
   export function gainShareOf(valueReal, basisNominal, anchor, ym, infl) { … }

   // Cel brutto (gross-up) — TYLKO do wyświetlenia różnicy celu w Analizie.
   export function belkaGrossTarget(targetNetReal, gainShare, rate = BELKA_RATE) {
     return targetNetReal / (1 - rate * Math.min(1, Math.max(0, gainShare)));
   }
   ```
2. **`makeTaxTracker(state, snapshot = null)`** — factory returning a closure
   object, created *inside* each replay/projection run (no module state).
   Internal: `{ value, basisNominal }`. Initial (no snapshot): `value =
   portfolioStart`, `basisNominal = value` (D8; anchor ⇒ factor 1). Methods —
   exact math per Plan B §3.3 collapsed to one bucket:
   - `contribute(cReal, ym)` — `value += c; basisNominal += toNominal(c, anchor, ym, infl)`.
     (No limits ⇒ B's `contribute`/`contributeTaxable` collapse into one; loan
     spills call this too.)
   - `withdraw(wReal)` — basis shrinks **proportionally**: factor
     `(value − w)/value` when `value > EPS` (epoch-independent — computed on
     reals); over-drain leaves `value` negative, basis floored at 0.
   - `grow(rMonthly)` — `value *= 1 + r`; basis unchanged (growth is the gain).
   - `setTotal(newTotalReal, ym)` — D9 rescale.
   - `netValueReal(ym)` — `value × (1 − BELKA_RATE × gainShareOf(…))`; equals
     raw `value` when `value ≤ EPS` (a debt-like residual carries no tax).
   - `gainShare(ym)`, `row()` → `{ basisNominal }`, `snapshot()` → same (the
     IKE/IKZE batch widens both).
3. **`replayBalances` (engine.js:329)** — same signature. When
   `taxesActive(state).any`, create a tracker before the loop and mirror the
   existing mutations **in their existing order** (do not reorder anything):
   contribution/deficit (:363–374 — `contribute(contribution, ym)`; in the
   deficit branch mirror **only the portfolio part**: there `deficit` is already
   net of `fromCash` when the portfolio is hit, so it is `withdraw(deficit)` —
   unlike `projectFire`, where the same amount is spelled
   `deficit − fromCash`), both spills
   (:376–377 → `contribute(spill, ym)`), house-spend portfolio part (:384–385 →
   `withdraw(fromPort)`), growth (:394 → `grow(rPort)`), `balanceOverride`
   (:399 → `setTotal(e.balanceOverride, ym)`; `cashOverride` does not touch the
   tracker). Each pushed row (:401) additionally gets `basisNominal:
   tracker.row().basisNominal, netPortfolio: tracker.netValueReal(ym)` (end-of-
   month values, after growth/overrides). Result (:403) gains
   `taxSnapshot: tracker ? tracker.snapshot() : null`.
   **Invariant (F29g):** `cash`, `portfolio`, and every pre-existing row field
   are bit-identical on vs off — the tracker only observes.
4. **`projectFire` (engine.js:547)** — same signature. Setup: tracker from
   `balances.taxSnapshot` when active. Seed-series map (:586–595) copies
   `basisNominal`/`netPortfolio` through when present. Projected loop mirror, in
   order: family spill (:624 → `contribute(spillReal, ym)`), mortgage spill
   (:637 → same), every deficit portfolio-drain (:644, :655, :665 →
   `withdraw(deficit − fromCash)`), invest contribution (:660 →
   `contribute(s, ym)`; the saving-phase cash branch :650 does NOT touch the
   tracker), house spend (:677 → `withdraw(fromPort)`), growth (:686 →
   `grow(rPort)`). Pushed series rows (:688) gain `basisNominal`/`netPortfolio`.
   **FIRE condition (:698)** becomes:
   ```js
   const effective = tracker ? tracker.netValueReal(ym) : portfolio;
   if (!fireYm && houseSettled && famSettled && effective >= pm.targetReal - EPS) { … }
   ```
   Result (:707) gains `taxes: active`.
5. **`projectWithdrawal` (engine.js:731)** — same signature; reads
   `state.taxes`. Taxes off ⇒ **byte-identical output** (keeps F13 + F27 green,
   incl. the 8,15% nominal-rate assertion). When on:
   - Seeding: from the `opts.projection` series row at `startYm` (nearest
     preceding row otherwise): take its `basisNominal`, scale by
     `startPortfolioReal / rowPortfolio` (preserves gainShare; row portfolio
     ≤ EPS or no projection/no `basisNominal` on rows → basis =
     `toNominal(startPortfolioReal, anchor, startYm, infl)`, gainShare 0 —
     conservative-low, documented).
   - Yearly loop replaces `endReal = (startReal − withdrawalReal) × (1 + realRate)`
     with withdraw-then-grow on the tracked pair. The **net need** is the
     existing `withdrawalReal = withdrawalRealYearly × wG^(n−1)` (:762):
     ```js
     const g = gainShareOf(bal, basisNominal, anchor, ym, infl); // epoka anchor;
     const rT = BELKA_RATE * g;          // ułamki są niezmiennicze względem epoki
     const gross = Math.min(Math.max(bal, 0), need / (1 - rT));
     basisNominal *= bal > EPS ? (bal - gross) / bal : 1;
     bal -= gross;  taxReal = gross * rT;
     // depleted gdy netto dostarczone < need − EPS; potem bal *= 1 + realRate
     ```
     `realRate` is already the post-FIRE rate (`ro.postReturnReal`) — growth
     unchanged.
   - Row fields: existing columns keep their meaning (`withdrawalReal/Nominal`
     stay **net** = expenses); new per-row `taxReal`,
     `taxNominal (= taxReal × pf1)`, `grossReal (= withdrawalReal + taxReal)`.
     Result gains `taxesApplied` (the `taxesActive` pair) and `taxTotalReal`.
6. **`taxStats(state, balances, nowYm = todayYm())`** — Plan B §3.7 Belka
   subset; `null` when inactive. Returns `{ active, gainShare, netValueReal
   (tracker from snapshot, O(1)), targetNet: fireTargetAt(state, nowYm),
   targetGross: belkaGrossTarget(targetNet, gainShare), basisNominal,
   portfolio: balances.portfolio }`.
7. **`projectionWith` (engine.js:990)** — add `taxes = null` to the options
   object; `if (taxes) st.taxes = { ...state.taxes, ...taxes };` right after the
   `st` construction (:991). Shallow copies only — never mutate `state` (F15a
   guarantee extends; test F29i). `solveExtraSavingsForAge` /
   `requiredSavingsForGoal` / all Symulacja calculators flow through `st.taxes`
   and become tax-aware for free (monotonicity holds: more savings ⇒ value and
   basis both ≥ pointwise ⇒ `netValueReal` ≥ ⇒ FIRE not later).
8. **`createState` (engine.js:1412)**: add `taxes: { belkaEnabled: false },`
   (after `debt`), bump `version: 4` → `5`. `defaultAssumptions` unchanged.

Do NOT touch: `fireTargetAt`, `fireTargetsToday`, `buildPlan`, `replayDebt`,
`replayFamilyLoan`, `dieWithZeroTargetAt`, `projectDieWithZero`, `oneOffImpact`,
`fiStats`, `fireJourneyProgress`, `swrComparison`, `retirementOpts`.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 5;` (storage.js:4)
2. In `migrate` (storage.js:41), replace `case 4: break;` with:
   ```js
   case 4:
     // v4 → v5: sekcja podatków (Belka), domyślnie wyłączona.
     if (!cur.taxes || typeof cur.taxes.belkaEnabled !== 'boolean') {
       cur.taxes = { belkaEnabled: false };
     }
     cur.version = 5;
     // fall-through
   case 5:
     break;
   ```
3. `validateState`: **no new check** — a missing `taxes` is not load-critical
   (migration backfills; `taxesActive` guards with `state.taxes || {}`), and
   `validateState` runs before `migrate`, so v≤4 backups must not be rejected.
4. Export/import: nothing — `exportJSON` strips only `derived`; the new derived
   fields (`taxSnapshot`, `basisNominal`/`netPortfolio` on rows, `taxes` on the
   projection) live under `state.derived` and are stripped automatically.

## Step 3 — tests (run `node tests/run-tests.js` after; green before UI work)

1. **Touch-up first** (`tests/test-engine.js`): version literals `4` → `5` at
   :459 (`'nowy stan = v4'` → v5), :461, :467, :480 (`'łańcuch 2→3→4'` →
   …→5), :496. F27f (:1719) needs no edit — it asserts
   `createState().version === S.SCHEMA_VERSION` and stays green once both bump.
2. **New fixture** (`tests/fixtures.js`, after F28):
   ```js
   // F29 — podatek Belki: basis nominalny, gross-up, niezmienniki włącz/wyłącz.
   F29: { singleContrib: 10000, months: 24, infl: 0.03, netTarget: 1800000, eps: 1e-6 },
   ```
3. **New tests** (`tests/test-engine.js`, after the F28 block; adapted from
   Plan B §7 T-B1…T-B9 — keep B's intent, renumber to F29):
   - **F29a off-invariance**: a v4-shaped state (no `taxes`) run through
     `migrate`, plus `belkaEnabled: false` → `projectFire` (`fireYm`, series
     cash/portfolio) and `projectWithdrawal` rows identical to the untaxed path;
     existing F13 assertions (year-35 nominal 8 724 696,89, nominal rate 8,15%)
     simply stay green.
   - **F29b never-taxed-on-principal**: `realReturnAnnual = 0`,
     `inflationAnnual = 0`, contributions only → `gainShare === 0` every month;
     `belkaGrossTarget(net, 0) === net`; `projectWithdrawal` `taxReal === 0`.
   - **F29c nominal basis (inflation-only gains)**: `realReturnAnnual = 0`,
     `inflationAnnual = 0.03`, single contribution `F29.singleContrib` at
     anchor, no further flows → after `F29.months`:
     `gainShare = 1 − 1.03^(−months/12)` (assertClose, `F29.eps`) — **real
     gains are zero yet tax > 0**: the basis-must-be-nominal assertion.
   - **F29d gross-up algebra**: `belkaGrossTarget(F29.netTarget, g) × (1 − 0.19·g)
     === F29.netTarget` (assertClose); `belkaGrossTarget` increasing in `g`.
   - **F29e tracker invariants**: `withdraw(x)` preserves gainShare for several
     `x` (assertClose); `setTotal` preserves gainShare (D9); zero → positive
     override lands with gainShare 0; over-drain → negative value, basis 0,
     `netValueReal` = raw value.
   - **F29f Belka delays FIRE**: F1-like state (income 10 000 / living 6 000,
     portfolioStart 100 000) → `ymToIdx(fireYm on) ≥ ymToIdx(fireYm off)`; pin
     the exact on-month during implementation as a regression anchor.
   - **F29g observer invariant**: same state on vs off → `replayBalances` rows
     deep-equal on `cash`/`portfolio`/`flow*`; `projectFire` series equal on
     `portfolio` over the common prefix (the on-run may reach FIRE later).
   - **F29h withdrawal-phase basis erosion**: belka on, real 5% (set
     `postRetirementReturnReal: 0.05` so the closed form is simple), infl 3% →
     per-year `taxReal` strictly increasing (gainShare monotone ↑) and identity
     `endReal = (startReal − withdrawalReal − taxReal) × 1.05` per row
     (assertClose); `taxNominal = taxReal × pf1`.
   - **F29i purity**: `projectionWith(state, { taxes: { belkaEnabled: true } })`
     leaves the `JSON.stringify(state)` snapshot untouched, and its `fireYm`
     matches mutating a copy directly.
   - **Storage additions** (in the existing F11 region): v4 payload (no
     `taxes`) → `migrate` → `version === 5`, `taxes.belkaEnabled === false`;
     v1 chains 1→…→5 in one pass; an existing `taxes: { belkaEnabled: true }`
     survives migration untouched; `version: 6` rejected by `validateState`;
     `importJSON(exportJSON(state))` preserves `taxes` verbatim.

## Step 4 — `js/analysis.js` (pure builders; copy from Plan B §6)

1. **New `belkaCard({ ts, fireWith, fireWithout })`** — card „Podatek Belki 🧾"
   shown by ui.js only when `ts` is non-null. KV rows (reuse local
   `kv`/`money`/`fireCell`): „Cel FIRE (netto, bez podatku)" `money(ts.targetNet)`;
   „Cel FIRE (brutto, z podatkiem)" `money(ts.targetGross)`; „Różnica przez
   podatek" `money(ts.targetGross − ts.targetNet)`; „Udział zysku w portfelu
   (dziś)" `Fmt.formatPct(ts.gainShare)`; „Portfel po podatku (dziś)"
   `money(ts.netValueReal)`; „Data FIRE z podatkiem"
   `fireCell(fireWith, fireWithout)` (renders „▼ N mies. później").
   `metodologia([...])` — Plan B §6.3 Belka block verbatim (basis tracking, 19% ×
   udział zysku, nominal-basis rationale, gross-up formula, all-principal
   seeding).
2. **`withdrawalCard` (analysis.js:192)** — every addition guarded on
   `w.taxesApplied && w.taxesApplied.any` (byte-identical output when off):
   header column „Podatek (nom.)" after „Wypłata (nom.)" with
   `money(r.taxNominal)`; a summary KV „Podatki w fazie wypłat łącznie
   (realnie)" `money(w.taxTotalReal)`; two extra `metodologia` lines (:215):
   „Wypłata brutto jest powiększona tak, aby po podatku zostało dokładnie tyle,
   ile potrzebujesz na wydatki; kolumna «Podatek» pokazuje różnicę." and
   „Podatek = 19% × udział zysku nominalnego w portfelu — rośnie z czasem, bo
   coraz większa część portfela to zysk."

## Step 5 — `js/ui.js` glue

1. **Settings page** — `renderPlanHub` items (ui.js:1590): insert
   `['🧾', 'Podatki', 'podatek Belki (19%)', '#/plan/podatki']` before
   „Aplikacja"; `renderPlanSection` (:1609): add
   `else if (section === 'podatki') renderPlanPodatki();`. New
   **`renderPlanPodatki()`** follows the `renderPlanAplikacja`/`renderPlanDom`
   pattern (back link, save → mutate `state.taxes` → `E.recomputeDerived(state)`
   → `persist()` → `toast('Zapisano ustawienia podatków.')` → back to `#/plan`):
   - checkbox `#pl-belka` → `taxes.belkaEnabled`, label **„Uwzględniaj podatek
     Belki (19%)"**, tooltip: „Podatek od zysków kapitałowych: przy sprzedaży
     inwestycji płacisz 19% od zysku — od tego, o ile cena sprzedaży przewyższa
     cenę zakupu. Liczony od kwot nominalnych, bez korekty o inflację — dlatego
     realnie oddajesz więcej niż 19% realnego zysku. Aplikacja śledzi koszt
     zakupu Twoich wpłat i sprawdza cel FIRE na portfelu «po podatku»."
   - OKI banner (always visible, `banner info small`): „Od 2027 planowana jest
     reforma OKI (Osobiste Konto Inwestycyjne) — część oszczędności ma być
     zwolniona z podatku Belki. Aplikacja liczy według przepisów obowiązujących
     w 2026 r."
   No `index.html` change (`#/plan/*` already maps to the Plan tab via
   `activeRoute`).
2. **Analiza section** — `renderAnaliza` (ui.js:1099): after the `showKredyty`
   guard (:1113) add the same pattern:
   `if (anSection === 'podatki' && !E.taxesActive(state).any) anSection = 'przeglad';`
   and `if (E.taxesActive(state).any) sections.push(['podatki', 'Podatki']);`
   (:1116). New branch after `dozera`:
   ```js
   } else if (anSection === 'podatki') {
     const ts = E.taxStats(state, d.balances, nowYm);
     const noBelka = E.projectionWith(state, { taxes: { belkaEnabled: false } });
     body = An.belkaCard({ ts,
       fireWith: proj.reached ? proj.fireYm : null,
       fireWithout: noBelka.reached ? noBelka.fireYm : null });
   }
   ```
   (One extra full projection — cheaper than the existing 13-run sensitivity
   card at :1146–1159.) The section-switch handler (:1261) needs no change.
3. Nothing else: Pulpit, check-in, coach, `simulation.js`, `motivation.js`
   untouched. The Prognoza branch already passes `w` into `withdrawalCard`
   (:1175) — the tax column appears automatically once `state.taxes` is on.

## Step 6 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three
places: `sw.js` `CACHE = 'fire-v1.16.0'`, `index.html` footer
`FIRE Companion v1.16.0`, `js/ui.js` `APP_VERSION = '1.16.0'` (:11). Update
CLAUDE.md: append the F29 sentence to the Tests paragraph and add `taxes` to
the persisted-state sketch. Commit in Polish, e.g.
`feat: podatek Belki (19%) — śledzenie kosztu nabycia, cel i data FIRE po podatku (v1.16.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0 (all existing + F29 cases; F13/F27
   numbers unchanged — the off-path is byte-identical).
2. App run via preview (`.claude/launch.json` → `fire-app`):
   - **off-guard**: with the toggle off, dashboard, Analiza, and Symulacja are
     pixel-identical to v1.15.0 (spot-check FIRE date + withdrawal table);
   - Plan → Podatki: page renders, OKI banner visible, checkbox saves and
     survives reload; export JSON has `version: 5` and `taxes`;
   - toggle on → Analiza gains the „Podatki" tab: gross target > net target,
     difference and gainShare shown, „Data FIRE z podatkiem" later than
     without (▼ N mies.); Prognoza → Faza wypłat shows the „Podatek (nom.)"
     column and the yearly tax grows over time;
   - toggle off again → „Podatki" tab disappears, `anSection` falls back to
     Przegląd (guard), withdrawal table drops the column;
   - **Migration**: with pre-change v4 data in localStorage, reload → app
     loads, no toast errors, toggle shows off (backfilled).
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app + new settings page load, no
   absolute-path 404s.

## Deviations from `plans/B-taxes.md` (record for the IKE/IKZE batch)

- `makeTaxTracker` ships **single-bucket** (`value` + `basisNominal`); the
  IKE/IKZE batch adds buckets, `ytd*` counters, `beginMonth`/refund, and the
  `contribute`/`contributeTaxable` split.
- `taxesActive` returns `{ belka, any }` — the `ikeIkze` key joins later.
- `state.taxes` is `{ belkaEnabled }` only; the `ikeIkze` subsection needs its
  own migration step (v5 → v6) when that batch ships.
- Fixture **F29** is consumed by Belka; IKE/IKZE takes F30 (Plan B §7's
  "renumber" rule applied — F27/F28 went to batch A).
- Series rows carry `basisNominal` (scalar), not `buckets` — widen the field,
  don't rename it, to keep `projectWithdrawal` seeding stable.
- Plan B §5's settings page is created here with only the Belka control —
  IKE/IKZE controls slot into the same `renderPlanPodatki`.
- Version v1.16.0 is consumed by this standalone release.
