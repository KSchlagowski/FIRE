# Bonds/stable-instrument switch at retirement (`postRetirementReturnReal`)

## Context

After reaching FIRE, most people move money out of equities into safer, lower-yield
instruments (Polish retail treasury bonds: EDO 10y pays inflation + 2.00% margin →
the margin *is* the real return). Today the engine uses one `realReturnAnnual` (5%
default) for both the accumulation phase and the withdrawal phase, which overstates
how long the portfolio lasts in retirement. This feature adds:

1. a **persisted plan setting** `assumptions.postRetirementReturnReal` (default
   **0.02**, pre-tax — Belka interaction is explicitly out of scope, deferred to the
   taxes plan), used by all withdrawal-phase functions from the retirement month on;
2. a **Symulacja "Emerytura" what-if tab** (slider, nothing persisted) showing the
   effect of the post-FIRE rate on the "do zera" target/date and portfolio longevity.

This is **Feature 1 of `plans/A-retirement-projection.md`** (the authoritative design;
decisions D1–D5 there are locked), implemented **standalone** — per user decision, the
other 5 batch features (expense freeze, ZUS bridge, Barista, crash test, bands) are NOT
built now. Ships as a normal standalone release: **v1.14.0, committed in Polish**.

Key locked decisions adopted from Plan A:
- **D1**: "retirement month" = the withdrawal `startYm` (`fireYm` when reached,
  `todayYm()` in the hypothetical case) — never `familyFreeYm`. The withdrawal
  functions already start there, so the "seam" is simply: withdrawal-phase functions
  use the post rate; accumulation (`projectFire`, `replayBalances`, `fiStats`,
  `oneOffImpact`, `fireJourneyProgress`) stays on `realReturnAnnual` untouched.
- **D3**: headline FIRE date, verdicts, streak, dashboard — all unchanged.
- **D5**: default 2.0% real applied via migration to existing states too; the
  withdrawal card gets a banner naming the assumption.
- **D2 (scoped)**: introduce the `retirementOpts(state, overrides)` seam now with only
  `postReturnReal`; later features extend the object (openspec task 1.2 reuses it).

## Pre-step: commit unrelated in-flight fixes

The working tree has finished, unrelated bugfixes in `js/engine.js` +
`tests/test-engine.js` (die-with-zero start gate `gateIdx` + test F24h; `oneOffImpact`
fractional-age rounding + F25k; `fiStats` family payment in monthly expenses + F20k).
Run `node tests/run-tests.js`; if green, commit them **first** as their own commit
(Polish message, e.g. `fix: bramka startu zobowiązań w „do zera", zaokrąglanie wieku
FIRE w oneOffImpact, rata rodzinna w fiStats`). Do not mix them into the feature commit.

## Step 1 — `js/engine.js`

All references are to current line numbers (pre-step diff may shift them slightly).

1. **New seam function** — insert directly above `projectWithdrawal` (engine.js:717)
   under a new banner `// ── Faza emerytalna: opcje ──…`:
   ```js
   // Jeden znormalizowany obiekt opcji fazy emerytalnej (wypłat). Domyślne wartości
   // z zapisanych założeń; `overrides` to what-ify z Symulacji (nic nie zapisują).
   // Kolejne pola (mrożenie wydatków, ZUS…) dojdą tu w przyszłych funkcjach.
   export function retirementOpts(state, overrides = {}) {
     const a = state.assumptions;
     return {
       postReturnReal: overrides.postReturnReal != null ? overrides.postReturnReal
         : (a.postRetirementReturnReal != null ? a.postRetirementReturnReal : 0.02),
     };
   }
   ```
   (Use the repo's `x != null ? x : y` idiom, not `??` — matches existing code.)
2. **`projectWithdrawal` (engine.js:717)**: add `const ro = opts.ro || retirementOpts(state);`
   near the top; change line 730 `const realRate = a.realReturnAnnual;` →
   `const realRate = ro.postReturnReal;`. Add `ro` to the returned object (line 764).
   Everything else (nominalRate formula, recurrence, `depletedYear`) unchanged —
   `realRate`/`nominalRate` result fields now automatically carry the post-FIRE rate.
3. **`dieWithZeroTargetAt` (engine.js:776)**: new optional 4th param
   `ro = retirementOpts(state)`; line 783 `const r = a.realReturnAnnual;` →
   `const r = ro.postReturnReal;`. Update the doc comment (portfolio grows at the
   post-FIRE real return). Back-compatible arity — existing 3-arg callers keep working.
4. **`projectDieWithZero` (engine.js:795)**: add `const ro = opts.ro || retirementOpts(state);`
   near the top; pass `ro` into both `dieWithZeroTargetAt` calls (scan at :829,
   fallback at :849); line 844 `const r = a.realReturnAnnual;` → `const r = ro.postReturnReal;`.
   Add `ro` to both return objects (:851 and :887). `realRate` result field now carries it.
5. **`defaultAssumptions()` (engine.js:1369)**: append
   `postRetirementReturnReal: 0.02, // realny zwrot po FIRE (marża EDO, przed podatkiem)`.
6. **`createState` (engine.js:1387)**: bump hard-coded `version: 2` → `version: 3`.

Do NOT touch: `projectFire`, `replayBalances`, `fireTargetAt`, `oneOffImpact`,
`fiStats`, `fireJourneyProgress`, `swrComparison`, `projectionWith`.

## Step 2 — `js/storage.js`

1. `export const SCHEMA_VERSION = 3;` (storage.js:4)
2. In `migrate` (storage.js:41), replace `case 2: break;` with:
   ```js
   case 2: {
     // v2 → v3: realny zwrot po FIRE (obligacje) — domyślnie marża EDO 2%.
     const a = cur.assumptions || (cur.assumptions = {});
     if (typeof a.postRetirementReturnReal !== 'number') a.postRetirementReturnReal = 0.02;
     cur.version = 3;
   }
   // fall-through
   case 3:
     break;
   ```
3. `validateState`: **no change** (field is not load-critical; migration backfills and
   `retirementOpts` has a fallback — same precedent as the v1→v2 familyLoan step).

## Step 3 — tests (run `node tests/run-tests.js` after; must be green before UI work)

1. **Touch-up first** (`tests/test-engine.js` `baseState()`, ~line 45): add
   `postRetirementReturnReal: 0.05` to the assumptions. This keeps every F13/F24
   expected number byte-for-byte (post rate == old rate in legacy fixtures).
   Also grep tests for hard-coded `version: 2` expectations (F11) and update to 3 /
   `S.SCHEMA_VERSION` as needed.
2. **New fixture** (`tests/fixtures.js`, after F26):
   `F27: { depleted: { start: 1800000, wYear: 72000, rPost: 0.02, year: 35 } }`
   (+ one header-comment line). Test numbering deliberately matches Plan A §6 so the
   later batch fills the gaps (F27d/e, F28b/c reserved for freeze/pension).
3. **New tests** (`tests/test-engine.js`, after the F26 block):
   - **F27a** `retirementOpts`: `createState()` state → `postReturnReal === 0.02`;
     override wins; missing assumption → 0.02 fallback; purity (state JSON unchanged).
   - **F27b** `projectWithdrawal` parity: under `baseState()` the result has
     `ro.postReturnReal === 0.05` and `nominalRate` still ≈ `FIX.F13.nominalRate`
     (0.0815) — i.e. F13 numbers preserved via the seam.
   - **F27c** bonds switch depletes the 4% portfolio: state with
     `postRetirementReturnReal: 0.02`; `projectWithdrawal(st, { startYm: '2026-07',
     startPortfolioReal: 1_800_000, withdrawalRealYearly: 72_000, years: 40 })` →
     `depletedYear === 35`; assert both against the fixture and against the closed
     form computed in-test (smallest N with `W₁·(1−q^N)/(1−q) > P₀`, `q = 1/1.02`).
   - **F27f** `createState().version === S.SCHEMA_VERSION` (cross-module sync guard;
     engine is L0 and cannot import storage — the test is the guard).
   - **F28a** `dieWithZeroTargetAt` legacy parity: explicit
     `ro = { postReturnReal: 0.05 }` reproduces `FIX.F24.target` (1 486 901,33) and
     the `r0` case (720 000) exactly.
   - **F28d** sensitivity: same state/month, `target(rPost 0.02) > target(rPost 0.05)`;
     and `projectDieWithZero(st, { ro: { postReturnReal: 0.02 }, … }).realRate === 0.02`
     with a larger `target` than the 5% run (the what-if path works end to end).
   - **F11 addition** (storage): a v2 state → `migrate` → `version === 3` and
     `postRetirementReturnReal === 0.02`; a v1 state chains 1→2→3 in one pass;
     `version: 4` still rejected by `validateState`; an existing explicit value
     (e.g. 0.03) survives migration untouched.

## Step 4 — `js/analysis.js` (copy only; data flows through `w`/`z`)

1. **`withdrawalCard` (analysis.js:192)**: after the start banner add an always-shown
   info banner:
   > „Po FIRE portfel pracuje na {Fmt.formatPct(w.realRate)} realnie — tak, jakby
   > pieniądze leżały w bezpieczniejszych instrumentach (np. obligacjach). Zmienisz to
   > w Ustawieniach → Profil i FIRE."
   Add a metodologia line: „Po FIRE portfel rośnie o realny zwrot po FIRE
   ({Fmt.formatPct(w.realRate)}), nie o zwrot z fazy oszczędzania — po przejściu na
   emeryturę zwykle inwestuje się bezpieczniej." (The existing `R nominalne` line at
   :216 self-updates via `w.realRate`.)
2. **`dieWithZeroResult` (analysis.js:227)**: add one metodologia line: „Portfel rośnie
   o realny zwrot po FIRE ({Fmt.formatPct(z.realRate)}) — ustawisz go w Plan → Profil
   i FIRE." (Line :264 already prints `z.realRate`, which now carries the post rate.)

No `ui.js` glue change needed for Analiza — engine defaults `ro` from state.

## Step 5 — `js/simulation.js` (new builders, pure, nothing persisted)

New exports (pattern-copy `returnCard`/`returnResult`, simulation.js:267–297):

- **`retirementResult({ ro, dz, dzBase, w, deathAge })`**:
  - if `dz == null` (no birthDate) → the same profile prompt wording as
    `dieWithZeroResult` (:229);
  - rows (reuse local `kv`/`money`/`fireCell`):
    „Cel «do zera» (do wieku 90)" `money(dz.target)` + signed diff vs `dzBase.target`
    (class `good` when ≤ 0); „Data FIRE «do zera»" `fireCell(dz.fireYm, dzBase.fireYm)`;
    „Portfel przy Twojej stopie wypłat wystarcza" → `w.depletedYear` set:
    „do wieku {rows[depletedYear−1].age} ({k}. rok wypłat)" (warn) else
    „ponad {w.rows.length} lat" (good);
  - `metodologia([...])`: „Każda zmiana przelicza fazę wypłat od nowa: po FIRE portfel
    rośnie o podany realny zwrot, a wypłaty pokrywają Twoje wydatki." /
    „Niczego nie zapisujemy — to podgląd; ustawienie na stałe jest w Plan → Profil i FIRE."
- **`retirementCard({ value, base, resultHTML })`** — title `Emerytura po FIRE 🏖️`,
  intro: „Po przejściu na FIRE wiele osób przenosi pieniądze w bezpieczniejsze
  instrumenty, np. obligacje skarbowe — portfel rośnie wolniej, więc musi wystarczyć
  na dłużej. Przesuń suwak i sprawdź, co to zmienia. Czysta symulacja — niczego nie
  zapisujemy." Slider label `Realny zwrot po FIRE`:
  `<input type="range" id="sym-ret-post" min="0" max="0.06" step="0.0025" value="…">`
  + `<b id="sym-ret-post-val">` (formatPct) + muted hint „Twoje ustawienie:
  {formatPct(base)}". Result container `<div id="sym-ret-result">`.

## Step 6 — `js/ui.js` glue

1. **Plan setting** — `renderPlanFire` (ui.js:1586): after the `pl-cashret` field add
   a subsection header `Po przejściu na FIRE` and
   `field({ id: 'pl-postret', label: 'Realny zwrot po FIRE', suffix: '%/rok',
   value: pctVal(a.postRetirementReturnReal), tipText: … })` with tip (Plan A §7.1):
   > „Po przejściu na FIRE wiele osób przenosi pieniądze w bezpieczniejsze miejsca,
   > np. obligacje skarbowe. Detaliczne obligacje 10-letnie (EDO) płacą inflację +
   > ok. 2% marży — ta marża to Twój realny zysk. Wpisz, ile ponad inflację ma
   > zarabiać portfel, gdy przestaniesz pracować. Mniejszy zwrot = portfel wolniej
   > się odbudowuje, więc musi być większy na starcie."
   Save handler: add `['postret', () => parsePct('pl-postret')]` to `specs` (:1608) and
   `postRetirementReturnReal: vals.postret` to the `Object.assign` (:1622). This
   section only calls `recomputeDerived` + `persist()` — correct, **no reanchor**.
2. **Symulacja tab** — `renderSymulacja` (ui.js:1310):
   - module var (near the `sym*` block, :1293): `let symRetPost = null; // Emerytura:
     zwrot po FIRE (ułamek; null = z ustawień)`;
   - `tabs` array (:1455): insert `['emerytura', 'Emerytura']` after `['zwrot', 'Zwrot']`;
   - result closure (near `returnResult`, :1447):
     ```js
     const retirementResult = () => {
       const ro = E.retirementOpts(state, symRetPost == null ? {} : { postReturnReal: Number(symRetPost) });
       const dz = E.projectDieWithZero(state, { deathAge: 90, projection: proj, ro });
       const dzBase = E.projectDieWithZero(state, { deathAge: 90, projection: proj });
       const w = E.projectWithdrawal(state, { projection: proj, ro });
       return Sim.retirementResult({ ro, dz, dzBase, w, deathAge: 90 });
     };
     ```
   - body branch (:1467 chain): `else if (symTab === 'emerytura') body =
     Sim.retirementCard({ value: symRetPost == null ? a.postRetirementReturnReal : Number(symRetPost),
     base: a.postRetirementReturnReal, resultHTML: retirementResult() });`
   - `nadwyzkaNote` suppression (:1486): add `|| symTab === 'emerytura'`;
   - event branch (:1495 chain) — the `#sym-return` slider pattern (:1540):
     `'input'` → `symRetPost = el.value`; `$('#sym-ret-post-val').textContent =
     Fmt.formatPct(Number(symRetPost))`; swap `#sym-ret-result` innerHTML.

## Step 7 — release (standalone, per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three places:
`sw.js` `CACHE = 'fire-v1.14.0'`, `index.html` footer `FIRE Companion v1.14.0`,
`js/ui.js` `APP_VERSION = '1.14.0'`. Commit in Polish, e.g.:
`feat: obligacje po FIRE — realny zwrot po FIRE w fazie wypłat + zakładka „Emerytura" (v1.14.0)`,
then push (release checklist).

## Verification

1. `node tests/run-tests.js` → exit 0 (121 existing + new F27/F28/F11 cases; F13/F24
   numbers unchanged).
2. App run via preview (`.claude/launch.json` → `fire-app`, port 8123):
   - **D3 guard**: dashboard FIRE date/verdict identical before vs after the change;
   - Plan → Profil i FIRE: new „Realny zwrot po FIRE" field shows 2%, saves, persists
     after reload; entering e.g. 3% updates the Analiza withdrawal table;
   - Analiza → Prognoza: „Faza wypłat" shows the new banner naming the rate; `R
     nominalne` reflects the post rate; Do zera metodologia names the rate;
   - Symulacja → „Emerytura": slider moves → „Cel do zera"/„Data FIRE do zera"/
     longevity row update live without full re-render; at slider == setting the
     values equal the Analiza numbers; no `nadwyzkaNote` on this tab;
   - **Migration**: with pre-change v2 data in localStorage, reload → app loads, no
     toast errors, Plan form shows 2% (backfilled), export JSON has `version: 3`.
3. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app + new tab load, no absolute-path 404s.

## Deviations from `plans/A-retirement-projection.md` (record for the later batch)

- v2→v3 migration adds **only** `postRetirementReturnReal`; freeze/pension fields will
  need their own v3→v4 step when Feature 2/3 ship (Plan A §3 and `plans/B-taxes.md`
  §migration must renumber accordingly).
- `retirementOpts` ships with only `postReturnReal`.
- Tests F27d/e and F28b/c (freeze/pension) intentionally left for the batch.
- Version v1.14.0 is consumed by this standalone release.
