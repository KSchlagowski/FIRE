# Plan: Scenario snapshots in Symulacja (2 saved configs per calculator)

Status: **SHIPPED** (rebased) · Shipped version: **v1.33.0** · Schema bump:
**v10 → v11** · Fixture group: **F49**

> The codebase moved well past the originally-planned v1.14.0 / schema 3 / F27
> (those were taken by later features). The feature shipped rebased onto the
> current head: schema **v10 → v11**, version **v1.33.0**, fixture group **F49**.
> Snapshots cover the 7 what-if tabs enumerated in the data model below
> (`cojesli`, `wiek`, `latte`, `wiecej`, `zwrot`, `kredyt`, `nadplata`); the
> three later retirement tabs (`emerytura`, `barista`, `krach`) are outside this
> plan's scope and get no scenarios card. Two adaptations vs the text below:
> `mergeSeries` emits rows keyed `ym` (what `chartSVG` consumes) rather than `x`,
> and `normalize` is idempotent (accepts both raw-field and canonical keys) so
> `readSnapshot`'s re-validation of stored inputs round-trips. Projection-tab
> overlays run the series with `stopAtFire:false` so an earlier-FIRE scenario's
> line doesn't cliff to zero.

## Goal

Every Symulacja calculator tab gets **two named snapshot slots (A and B)**.
Saving a slot persists the tab's current *inputs* (slider positions, amounts,
months — never results). Loading a slot restores those inputs into the live
controls. When both slots are filled, a comparison section renders the two
scenarios **side by side in one table and one overlay chart**, recomputed live
by the engine — no more re-typing slider values to eyeball two alternatives.

## User story

"On the «Więcej» tab I want to compare saving +1 000 zł/mies. against
+2 500 zł/mies. Today I have to drag the slider back and forth and memorize
the FIRE dates. I want to save both as scenario A and B and see the dates,
the gain, and the portfolio curves next to each other — and still have them
there tomorrow."

## Design decisions (locked)

1. **Inputs are persisted; results never are.** A snapshot is the tab's
   canonical input values plus `savedAt`. Every render recomputes both
   columns through the same engine calls the live calculator uses
   (`projectionWith`, `solveExtraSavingsForAge`, `remainingSchedule`, …).
   This is the repo's core pattern ("derived state is recomputed, never
   stored") applied to scenarios. Deliberate consequence: **changing
   assumptions or adding check-ins moves both columns** — the comparison
   always answers "what would A vs B mean *from where I stand today*", which
   is the honest question. The UI says so (copy below).

2. **This amends the "Symulacja persists nothing" rule — narrowly.** The
   invariant that matters is preserved: nothing on this screen ever touches
   `entries`, `assumptions`, verdicts, or the projection pipeline.
   `recomputeDerived` does not read `state.scenarios`; the derived pipeline
   (`buildPlan → replayBalances → replayDebt → computeStreak → projectFire`)
   is untouched. What we persist is bookmarked *what-if questions*, not
   answers and not plan data. The module comment in `simulation.js` and the
   „niczego nie zapisujemy" microcopy must be updated to state this precisely
   (see Copy), and `CLAUDE.md` gets the same one-line amendment.

3. **Persisted at top-level `state.scenarios`** — a sparse map
   `tabKey → [slotA|null, slotB|null]`. Sparse (tabs appear on first save) so
   future calculator tabs need no migration. Schema v2 → v3 with a
   `createState` default, a migration step, and a *light* `validateState`
   check only — snapshots are not load-critical, so a malformed slot must
   never brick the app; slots are re-validated defensively on read instead
   (decision 5).

4. **Exactly two slots, fixed labels A and B.** No naming UI, no third slot.
   The slot chip shows an auto-generated Polish summary of the inputs
   (`describe`, below) plus the save month. Save overwrites the slot
   immediately (toast confirms; re-saving is one tap, so no confirm dialog).

5. **All new pure logic lives in `simulation.js`; `ui.js` gets only glue.**
   A per-tab registry `SCENARIO_SPECS` (validate/normalize raw inputs,
   describe a snapshot in Polish) plus the new HTML builders and a series-
   merge helper are pure functions — testable in Node. `storage.js` (layer
   L0, imports nothing) cannot use the registry, which is why load-time
   validation stays minimal and per-slot validation happens at read time in
   `ui.js` via the specs: a slot that fails `normalize` renders as empty and
   is silently dropped on the next save to that tab.

6. **Comparison = two-column grid reusing the existing result builders +
   one overlay line chart.** Each column is the tab's existing result block
   (`simulationResult`, `moreSavingsResult`, `loanCalcResult`, …) computed
   from that snapshot's inputs — zero duplicated math or markup, and the
   columns automatically stay in sync with any future changes to the live
   result. Per-column charts are suppressed (`chartHTML: ''`); instead one
   shared chart overlays both scenarios:
   - projection tabs (`cojesli`, `latte`, `wiecej`, `zwrot`): portfolio
     series A vs B via `chartSVG` ([ui.js:125](../js/ui.js#L125)) — two line
     defs over merged rows;
   - loan tabs (`kredyt`, `nadplata`): yearly "pozostało do spłaty"
     (kapitał + przyszłe odsetki) per scenario, same numbers the F26-covered
     `yearlyRemainingToPay` path produces, one line per scenario;
   - `wiek`: table only (the result is a required monthly amount — no
     natural time series).

7. **Unified validation for live result, save, and compare.** Today each
   result closure in `renderSymulacja` ([ui.js:1310](../js/ui.js#L1310))
   parses + validates + computes in one lump. Refactor each tab into:
   `SCENARIO_SPECS[tab].normalize(raw, ctx)` → `{ ok, inputs }` or
   `{ ok: false, msg, kind: 'hint' | 'error' }` (in `simulation.js`), and a
   compute function in `ui.js` taking canonical inputs. The live path is
   `normalize(capture()) → message | compute(inputs)`; the save path reuses
   the same `normalize` (not-ok → toast, nothing saved); the compare path
   calls `compute(snapshot.inputs)` directly. Every existing Polish
   validation message is preserved verbatim by moving it into `normalize`.

## Data model

```js
// state.scenarios — sparse: key exists only after the first save on that tab
{
  wiecej: [
    { savedAt: '2026-07-07T…',            // new Date() in ui.js (engine stays Date-free)
      inputs: { extra: 1500 } },          // canonical, parsed, roundGrosze'd
    null,                                  // slot B empty
  ],
  kredyt: [ …, … ],
}
```

Canonical `inputs` per tab (all amounts real PLN unless stated, all numbers
finite, strings already parsed via `format.js`):

| tab | inputs | notes |
|---|---|---|
| `cojesli` | `{ month, amount, recurring }` | `month` "YYYY-MM" ≥ current month at save time; `amount` ≠ 0, signed |
| `wiek` | `{ age }` | integer-ish years, > current age at save time |
| `latte` | `{ amount }` | > 0 |
| `wiecej` | `{ extra }` | > 0 (slider value) |
| `zwrot` | `{ realReturnAnnual }` | absolute fraction (e.g. `0.055`), not an offset |
| `kredyt` | `{ principal, ratePct, termYears, extra }` | the hypothetical loan is self-contained — snapshot works even if the user's plan changes |
| `nadplata` | `{ loan, extra }` | `loan` ∈ `'mortgage' | 'family'`; `extra` ≥ 0 |

Why store `zwrot` as an absolute value: the live slider range is
`assumption ± 3 pp` and moves when assumptions change; an offset would
silently mean a different return later. The absolute number is what the user
saw and saved.

## Changes by file

### `js/storage.js`

- `SCHEMA_VERSION` 2 → **3** ([storage.js:4](../js/storage.js#L4)).
- `migrate` ([storage.js:41](../js/storage.js#L41)) — extend the fall-through
  chain:

  ```js
  case 2:
    // v2 → v3: zapisane scenariusze Symulacji (tylko wejścia, nigdy wyniki)
    if (!cur.scenarios || typeof cur.scenarios !== 'object' || Array.isArray(cur.scenarios)) {
      cur.scenarios = {};
    }
    cur.version = 3;
    // fall-through
  case 3:
    break;
  ```

- `validateState` ([storage.js:20](../js/storage.js#L20)) — one cheap,
  non-load-critical shape check (runs before `migrate`, so a valid v2 blob
  without the key must pass):

  ```js
  if (s.scenarios != null && (typeof s.scenarios !== 'object' || Array.isArray(s.scenarios))) {
    throw new Error('Uszkodzona sekcja scenariuszy');
  }
  ```

  Anything finer-grained (slot shape, per-tab fields) is *not* validated
  here — decision 5: bad slots degrade to "empty", they don't block loading.
- Export/import: no code changes. `exportJSON` serializes the whole state,
  so scenarios ride along; older app versions reject v3 backups with the
  existing "kopia z nowszej wersji" error (established contract).

### `js/engine.js`

Two lines only — this feature adds **no finance logic**:

- `createState` ([engine.js:1385](../js/engine.js#L1385)): add
  `scenarios: {}` next to the other top-level defaults and bump the
  hardcoded `version: 2` → `3` (must match `SCHEMA_VERSION`).
- `recomputeDerived` and the whole pipeline stay untouched and must never
  read `state.scenarios` (guarded by a fixture, below).

(The currently uncommitted engine changes — die-with-zero gate, `oneOffImpact`
rounding, `fiStats` family payment — are unrelated; this plan does not touch
those functions.)

### `js/simulation.js`

All pure; imports `engine.js`/`format.js` it already has.

- **Amend the module header and card microcopy** (decision 2 / Copy below).
- **`export const SCENARIO_SPECS`** — per-tab object:
  - `normalize(raw, ctx)` → `{ ok: true, inputs }` or
    `{ ok: false, msg, kind }`. `raw` is whatever the live controls hold
    (strings included); parsing via `Fmt.parsePLN`, `roundGrosze` on
    amounts. `ctx` keeps it pure: `{ nowYm, currentAge, defaultAge, loans }`
    — supplied by `ui.js` from state/derived. The existing per-tab messages
    („Wybierz bieżący lub przyszły miesiąc.", „Nieprawidłowa kwota",
    „Podaj docelowy wiek.", „Podaj nadpłatę: 0 lub więcej." …) move here
    verbatim; empty-input prompts („Podaj kwotę, aby zobaczyć…") become
    `kind: 'hint'`.
  - `describe(inputs)` → short Polish chip summary, e.g.
    `jednorazowo 2 000 zł w 03.2027`, `co miesiąc +500 zł od 08.2026`,
    `wiek 45`, `450 zł/mies.`, `+1 500 zł/mies.`, `zwrot 5,5%`,
    `500 000 zł · 7% · 25 lat · nadpłata 500 zł/mies.`,
    `kredyt 🏠 · nadpłata 800 zł/mies.` (NBSP grouping from `formatPLN`).
- **`export function readSnapshot(scenarios, tab, i, ctx)`** — defensive
  read: returns the slot only if it exists and its `inputs` re-pass
  `normalize` (with the *save-time-only* checks relaxed, see Edge cases:
  a `cojesli` month that has since slipped into the past is returned but
  flagged `stale: true` so the column can explain itself instead of
  vanishing). Malformed → `null`.
- **`export function mergeSeries(a, b, key)`** — zips two engine series into
  `[{ x, a, b }]` aligned by `ym` (projection tabs) or by year offset (loan
  tabs), padding the shorter with `null`; pure, inputs untouched.
- **New builders** (strings in, string out, `esc()` on user-derived text —
  there is none here, but `describe` output goes through `esc` anyway):
  - `scenariosCard({ tab, slots, compareHTML })` — the „Scenariusze A/B 📌"
    card: two slot rows (label A/B, `describe` summary or „pusty", buttons
    `data-scn-save`/`data-scn-load`/`data-scn-del`, targets ≥ 48 px), the
    persistence hint, then `compareHTML`.
  - `scenarioCompare({ colA, colB, chartHTML, legendHTML, note })` — header
    row (A | B with describes), the two result columns in a `.scn-grid`,
    the shared overlay chart + legend, and the "both columns move with your
    plan" note. With one slot filled: single column + hint „Zapisz drugi
    scenariusz, aby porównać."

### `js/ui.js`

All inside the Symulacja section ([ui.js:1289](../js/ui.js#L1289)):

- **Refactor each result closure** into `capture()` (gather module vars →
  `raw`), `compute(inputs)` (engine calls + existing `Sim.*Result` builder),
  and a live wrapper `normalize(capture(), ctx) → msg | compute(inputs)`.
  Behavior-preserving — same messages, same results (the existing suite plus
  a manual pass guard this).
- **`applyInputs(tab, inputs)`** — writes snapshot inputs back into the
  module vars (`symMore = …`, `simMonth = …`, …) for the Load button.
  Slider-backed values are **clamped to the current slider range** on load
  (`wiecej` max is income-derived, `zwrot` is ±3 pp around the assumption);
  if clamped, toast „Wartość spoza zakresu suwaka — przycięto." The
  *comparison* always uses the stored, unclamped value.
- **Render**: after the calculator card, append
  `Sim.scenariosCard({ tab: symTab, slots, compareHTML })`. `compareHTML`
  is built here because it needs the engine + `chartSVG`: for each valid
  slot run `compute(inputs)` with per-column `chartHTML: ''`, build the
  overlay chart (`chartSVG` with two defs, classes `line-scn-a` /
  `line-scn-b`), hand everything to `Sim.scenarioCompare`.
- **Events**: wire `[data-scn-save]` (normalize current inputs → not-ok:
  toast the message; ok: write `{ savedAt: new Date().toISOString(), inputs }`
  into `state.scenarios[symTab][i]`, `persist()`, re-render, toast
  „Zapisano scenariusz A/B"), `[data-scn-load]` (`applyInputs` →
  re-render), `[data-scn-del]` (null the slot, prune the tab key if both
  empty, `persist()`, re-render). Mutations this trivial stay in `ui.js`
  (no engine mutation helper — nothing derived changes, so no
  `recomputeDerived` call either).

### `styles.css`

- `.scn-grid` — two-column grid for the comparison (mobile-first: two
  narrow columns at 480 px; the kv rows already wrap gracefully).
- `.scn-slot` — slot row layout, buttons ≥ 48 px.
- `.line-scn-a { stroke: var(--accent) }`, `.line-scn-b { stroke: var(--flame) }`
  — **existing** custom props only, so no new entries in the three theme
  blocks are needed.

### `index.html`, `sw.js`

No new files → `PRECACHE` unchanged. Only the release version bumps.

### `CLAUDE.md`

- `simulation.js` bullet: "nothing here is ever persisted" → "results are
  never persisted; the only persisted thing is `state.scenarios` — saved
  what-if *inputs* (2 slots per tab), which the derived pipeline never reads".
- Persisted-state-shape snippet: add `scenarios` line.

### New user-facing copy (Polish)

- Card title „Scenariusze A/B 📌"; slot chips „A: …opis…" / „B: pusty".
- Buttons: „Zapisz jako A/B", „Wczytaj", „Usuń".
- Persistence hint (replaces the blanket „niczego nie zapisujemy" where a
  card gains snapshots): „Zapisujemy tylko ustawienia tego kalkulatora
  (scenariusze A/B) — nigdy wyników. Twoje wpisy i założenia pozostają
  jedynym źródłem prawdy."
- Compare note: „Oba scenariusze liczone są od dziś, według aktualnych
  założeń — zmiana planu przesuwa obie kolumny."
- Toasts: „Zapisano scenariusz A", „Usunięto scenariusz B", „Wartość spoza
  zakresu suwaka — przycięto.", validation messages reused from `normalize`.
- Stale/degraded columns: „Miesiąc scenariusza już minął — zaktualizuj i
  zapisz ponownie.", „Ten kredyt jest już spłacony lub wyłączony."

## Tests — fixture group F27 (`tests/test-engine.js`)

Add `import * as Sim from '../js/simulation.js'` (pure module, Node-safe —
the file already imports `coach.js`, which sits in the same pure layer).
A state without scenarios must be bit-identical in behavior — the existing
121 tests passing untouched is the regression guard. New cases:

1. **Schema**: `createState()` has `scenarios: {}` and `version === 3`;
   `SCHEMA_VERSION === 3`.
2. **Migration**: a v2 blob gains `scenarios: {}` + `version 3`; a v1 blob
   runs the full chain (familyLoan + scenarios); a v3 blob with a garbage
   `scenarios` array is normalized to `{}` by the migrate guard when coming
   from ≤ v2, and rejected by `validateState` when claiming v3; unknown
   version still throws.
3. **Validation**: `validateState` passes a v2 blob without the key and a v3
   blob with `{}`; rejects `scenarios: []` / `'x'`.
4. **`normalize` per tab**: ok-path canonicalization (pl-PL string „2 500,50"
   → `2500.5`, `roundGrosze`, `recurring` coerced to boolean); every
   error/hint path returns the exact existing Polish message (`cojesli` past
   month, `wiek` age ≤ current, `kredyt` non-positive principal/term,
   negative rate, `nadplata` negative extra…); `ctx` purity (inputs object
   untouched).
5. **`describe`**: exact strings incl. NBSP grouping for one representative
   snapshot per tab.
6. **`readSnapshot`**: valid slot round-trips; malformed slot (missing field,
   NaN, wrong type, non-array tab) → `null`; past-month `cojesli` slot →
   returned with `stale: true`.
7. **`mergeSeries`**: equal lengths, unequal lengths (null padding), empty
   inputs, purity of both input arrays.
8. **Compute equivalence**: a snapshot's inputs fed to the engine give the
   identical result as the live path — e.g. `wiecej {extra: 1500}` →
   `projectionWith(state, { extraMonthlySavings: 1500 })` has the same
   `fireYm` after a JSON round-trip of the snapshot (guards number fidelity
   through storage).
9. **Pipeline independence**: `recomputeDerived` output (projection series,
   balances, streak) is deep-equal on the same state with `scenarios: {}` vs
   fully populated slots — nothing in the pipeline reads scenarios.
10. **Storage round-trip**: `save`/`load` and `exportJSON` → `importJSON`
    preserve `state.scenarios` deep-equal; `.bak` recovery unaffected;
    `stripDerived` leaves scenarios in place (they are data, not cache).

## Release checklist (v1.14.0)

1. `sw.js` → `const CACHE = 'fire-v1.14.0'`.
2. `index.html` footer → `FIRE Companion v1.14.0`.
3. `js/ui.js` → `APP_VERSION = '1.14.0'`.
4. `node tests/run-tests.js` green (existing suite + F27).
5. `/FIRE/` subpath rehearsal (serve parent dir, open `/fire/`).
6. Commit message in Polish, e.g.
   `feat: scenariusze A/B w Symulacji — zapis ustawień i porównanie obok siebie (v1.14.0)`.

## Edge cases

- **Stale `cojesli` month** (saved for 2026-09, it's now 2026-10): the slot
  stays saved and listed; its comparison column shows the stale note instead
  of numbers; Load still works (the month input then shows the live
  validation message). Deleting/re-saving is the user's fix.
- **`nadplata` snapshot for a loan that got paid off/disabled**: column shows
  the degraded note; if *no* loan is active the whole tab disappears (already
  the case, [ui.js:1367](../js/ui.js#L1367)) and the snapshots lie dormant,
  harmless, still in exports.
- **Slider range drift** (`zwrot` ±3 pp window moved, `wiecej` income-derived
  max shrank): comparison uses the stored value as-is (`projectionWith`
  accepts any number); only *loading* clamps, with a toast.
- **Assumptions/check-ins change**: both columns recompute — by design,
  stated in the UI note.
- **Both slots identical**: allowed, renders two equal columns; not worth a
  guard.
- **`localStorage` quota on save**: existing `persist()` path already toasts
  the Polish quota error; snapshots are tiny (< 1 kB) so no new mitigation.
- **Import of a v3 backup into an older app**: rejected with the existing
  "newer version" message (established contract).
- **Hand-edited import with junk slots**: passes `validateState` (object
  check only), each junk slot degrades to empty via `readSnapshot`; next
  save on that tab overwrites the tab's array wholesale.

## Non-goals (v1)

- **More than 2 slots or user-named scenarios** — A/B with auto-describe
  covers the compare use case; naming is UI surface with no math behind it.
- **A third "current inputs" column** — the live result is already on screen
  directly above; three columns don't fit 480 px.
- **Cross-tab scenarios** (one saved scenario spanning several calculators)
  — a different, much bigger feature (closer to "alternative plans").
- **Persisting scenario results or freezing them at save time** — against
  the derived-state rule; freezing would silently rot as the plan moves.
- **Snapshots for Analiza settings** — Analiza has no what-if inputs today.
- **Overlay chart for `wiek`** — no natural series; table row „Dodatkowo
  trzeba odkładać" *is* the comparison.

## Implementation order

1. `storage.js`: `SCHEMA_VERSION`, `migrate`, `validateState` (+ tests 1–3).
2. `simulation.js`: `SCENARIO_SPECS` (`normalize`/`describe`),
   `readSnapshot`, `mergeSeries` (+ tests 4–7).
3. `ui.js` refactor: split each tab's closure into `capture`/`normalize`/
   `compute` with zero behavior change — run the full suite + manual pass on
   all seven tabs *before* adding any new UI.
4. `engine.js`: `createState` default + version (+ tests 8–9).
5. `simulation.js` builders + `ui.js` glue (scenario card, compare, events,
   overlay charts) + `styles.css` (+ test 10).
6. Copy sweep: microcopy amendments, `CLAUDE.md` update.
7. Manual pass: save/load/delete on every tab, compare with 0/1/2 slots,
   stale-month and disabled-loan degradations, export/import round-trip,
   dark/light, subpath rehearsal.
8. Version bumps, full suite, commit.
