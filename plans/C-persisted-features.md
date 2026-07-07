# Plan C — Persisted features: timeline events, scenario slots, check-in notes

Batch C of the v1.14.0 wave (see `plans/00-master-plan.md`). Three features that
add **persisted** fields to the state. One schema bump covers all three.

Binding conventions (from `CLAUDE.md` + master plan):

- Math → `engine.js`; screen markup → pure builders; DOM/event/state glue → `ui.js` only.
- All amounts **real** (today's PLN) unless the identifier ends in `Nominal`.
  Everything in this batch is real PLN — no new nominal quantities.
- Months are `"YYYY-MM"`; arithmetic on `ymToIdx`/`idxToYm`. Never `new Date("YYYY-MM")`.
- UI copy Polish; this plan and code comments follow existing file style (Polish comments in js/).
- `node tests/run-tests.js` green after the batch; **no version bumps, no commits**
  (release agent handles both); write `docs/features/C.md` + one line in `docs/INDEX.md`.
- No new app files → **no `sw.js` PRECACHE change needed** (this plan deliberately
  adds no new JS module — see §6 rationale).

### Sequencing note (schema numbers)

At the time of writing, `SCHEMA_VERSION = 2`. Batches A and B run before C and may
each add their own bump. This plan is written as **v2 → v3**; if A/B already bumped,
use the **next free integer** and append the migration step to the end of the
fall-through `switch` in `storage.migrate` — the content of C's step is unchanged.
`createState` in `engine.js` hardcodes `version:` — it **must be updated to the same
number** (there is no import path from engine to storage; keeping them equal is a
manual invariant, asserted by test C-MIG-1 below).

---

## 1. Persisted-state diff (all three features)

### 1.1 New shapes

```
state.events = [            // Feature 1 — sorted ascending by ym (stable)
  {
    id:     string,         // unique, e.g. 'ev-<Date.now().toString(36)>-<rand36(5)>'
    ym:     'YYYY-MM',      // month the event lands in the projection
    amount: number,         // REAL PLN, roundGrosze'd; > 0 income, < 0 expense; never 0
    label:  string,         // user text, trimmed, 0–60 chars ('' allowed)
  }, …
]

state.simScenarios = [ slotA, slotB ]   // Feature 2 — ALWAYS length 2; empty slot = null
slot = {
  name:    string,          // user text, trimmed, 1–40 chars
  savedAt: string,          // ISO timestamp (now.toISOString())
  source:  'cojesli' | 'wiek' | 'latte' | 'wiecej' | 'zwrot',
  inputs:  object,          // canonical PARSED inputs per source (see §3.1) — no raw strings
}

entry.note = string | null  // Feature 3 — trimmed, 1–200 chars, or null (absent ⇒ null)
```

Design choice for scenarios: slots store **inputs, not solved results** — the
comparison re-runs `projectionWith` against the *current* data every render, so a
saved scenario stays meaningful as history grows (and nothing stale is persisted).

### 1.2 `engine.js createState` defaults

In the `state` literal (after `entries: []`):

```js
version: 3,                     // ← bump from 2 (keep equal to storage.SCHEMA_VERSION)
…
entries: [],
events: [],                     // planowane wydarzenia jednorazowe (realne zł)
simScenarios: [null, null],     // dwa sloty scenariuszy Symulacji (A i B)
```

Entries gain `note` at creation time inside `applyCheckIn` (see §4.1) — no
`createState` change needed for notes.

### 1.3 `storage.js` — SCHEMA_VERSION, migrate, validateState

```js
export const SCHEMA_VERSION = 3;   // was 2
```

Migration step (append inside `migrate`'s switch; keep fall-through style):

```js
case 2:
  // v2 → v3: planowane wydarzenia + sloty scenariuszy Symulacji.
  // Notatki wpisów (entry.note) nie wymagają kroku — brak pola czytany jako null.
  if (!Array.isArray(cur.events)) cur.events = [];
  if (!Array.isArray(cur.simScenarios) || cur.simScenarios.length !== 2) {
    cur.simScenarios = [null, null];
  }
  cur.version = 3;
  // fall-through
case 3:
  break;
```

`validateState` additions — **must be tolerant of the field being absent**,
because `load()` runs `validateState` BEFORE `migrate` (v1/v2 payloads have no
`events`). Insert after the `entries` loop:

```js
if (s.events !== undefined) {
  if (!Array.isArray(s.events)) throw new Error('Uszkodzona lista wydarzeń');
  for (const ev of s.events) {
    if (!/^\d{4}-\d{2}$/.test(ev.ym || '') || typeof ev.amount !== 'number') {
      throw new Error('Uszkodzone wydarzenie na osi czasu');
    }
  }
}
if (s.simScenarios !== undefined && !Array.isArray(s.simScenarios)) {
  throw new Error('Uszkodzone scenariusze symulacji');
}
```

Rationale: `events` is load-critical (`projectFire` reads it inside
`recomputeDerived`, which runs at startup), so its shape is checked. `simScenarios`
is only read by the Symulacja screen → light check. `entry.note` is **not**
load-critical and optional → **no validateState change** for notes (decision:
the entries loop stays as-is; readers use `e.note || null`).

Defensive reads in engine (belt-and-braces, costs one `|| []`): every consumer
uses `state.events || []` and `state.simScenarios || [null, null]` so a state
object constructed in tests without migration still works.

### 1.4 Export / import compatibility

- `exportJSON` strips only `derived` — new fields flow through automatically. No change.
- `importPreview`/`importJSON` run `migrate(validateState(...))` — old backups
  (v1/v2) gain `events`/`simScenarios` on import; v3 backups into an older app are
  already rejected by the existing `doc.version > SCHEMA_VERSION` check. No change.
- `.bak` path: unchanged (same load pipeline).

---

## 2. Feature 1 — Planned one-off events on the timeline

### 2.1 Locked semantics (state these in code comments)

1. **Projection-only.** Events are injected into the *projected* months of
   `projectFire` (and therefore every `projectionWith` what-if). They do **not**
   touch `buildPlan`, `plannedSavingsFor`, snapshots, verdicts, or
   `replayBalances`. The check-in "Plan na ten miesiąc" and verdict scale for an
   event month are unchanged.
2. **A past event simply stops applying.** The projection loop starts at
   `max(upto+1, a0)`, so any event with `ymToIdx(ev.ym) ≤ ymToIdx(uptoYm)` is
   naturally ignored — the *actual* money movement is expected to land in that
   month's check-in (`earned`/`spent`). This avoids double counting by
   construction. Past events are kept in the list (greyed in the UI with a hint
   to delete), never auto-deleted.
3. **Bucket routing = exactly the monthly-surplus routing.** The event amount is
   folded into the month's surplus `s`, so the existing phase logic applies
   unmodified: pre-mortgage → cash (house fund); during debt → positive amounts
   join the mortgage overpayment (locked strategy: pay debt first), negative
   amounts drain cash → portfolio; post-debt / no house → portfolio; deficits
   always drain cash first, then portfolio. A windfall during the debt phase
   *overpays the mortgage* — deliberate, consistent with the app's strategy;
   spill beyond the balance returns to the portfolio via the existing
   `mortgageStep.spill` path.
4. **Events after the projected FIRE month never apply** (the loop `break`s at
   `fireYm`). Multiple events in one month sum. Amounts are real PLN; the only
   nominal conversion is the existing `toNominal(s, …)` on the debt-overpay path.
5. Events **do** flow into everything derived from the projection automatically:
   dashboard chart, Analiza projection tables (as part of `flowCash`/
   `flowPortfolio` — the residual-growth identity of `yearlyProjection` still
   holds), sensitivity rows, `solveExtraSavingsForAge` / `requiredSavingsForGoal`
   (monotonicity intact — events are a fixed offset), `projectDieWithZero`.

### 2.2 `engine.js` — exact signatures & math

**(a) `projectFire` — signature unchanged** (`projectFire(state, plan, balances,
debtRes, familyRes, uptoYm)`); reads `state.events` internally. Before the
projection loop:

```js
// Wydarzenia jednorazowe: suma realnych kwot per indeks miesiąca. Tylko
// miesiące prognozy (idx ≥ startIdx) — przeszłe wydarzenia po prostu
// przestają działać (rzeczywistość ląduje w check-inie: brak podwójnego liczenia).
const evByIdx = new Map();
for (const ev of (state.events || [])) {
  const i = ymToIdx(ev.ym);
  evByIdx.set(i, (evByIdx.get(i) || 0) + ev.amount);
}
```

Inside the loop, the single math change:

```js
const s = pm.plannedSavings + delta + (evByIdx.get(idx) || 0);
```

Nothing else changes — routing/overpay/deficit/houseSpend paths already consume `s`.

**(b) `projectionWith` — new `events` option** (what-if override; `undefined` =
inherit the state's events, `[]` = "as if none"):

```js
export function projectionWith(state,
  { assumptions = {}, extraMonthlySavings = 0, extraSavings = null, events } = {},
  now = new Date()) {
  const st = { ...state, assumptions: { ...state.assumptions, ...assumptions },
               ...(events !== undefined ? { events } : {}) };
  … (rest unchanged)
```

**(c) New mutations** (place in the `// ── Check-in ──` mutation section, after
`deleteEntry`; both call `recomputeDerived` like every mutation):

```js
// Wydarzenia jednorazowe (realne zł): dodanie/edycja. id nadaje wywołujący
// (albo generowany); miesiąc musi być bieżący lub przyszły — przeszłe wydarzenia
// i tak nie działają na prognozę, więc nie pozwalamy ich tworzyć.
export function upsertEvent(state, input, now = new Date()) {
  const { ym } = input;
  if (!isValidYm(ym)) throw new Error('Nieprawidłowy miesiąc');
  if (ymToIdx(ym) < ymToIdx(todayYm(now))) throw new Error('Miesiąc wydarzenia już minął — wybierz bieżący lub przyszły');
  const amount = roundGrosze(Number(input.amount));
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Kwota nie może być zerem');
  const label = String(input.label || '').trim();
  if (label.length > 60) throw new Error('Nazwa może mieć najwyżej 60 znaków');
  state.events = state.events || [];
  const id = input.id || `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const ev = { id, ym, amount, label };
  const i = state.events.findIndex(e => e.id === id);
  if (i >= 0) state.events[i] = ev; else state.events.push(ev);
  state.events.sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0)); // stabilne
  recomputeDerived(state, now);
  return ev;
}

export function removeEvent(state, id, now = new Date()) {
  const i = (state.events || []).findIndex(e => e.id === id);
  if (i >= 0) state.events.splice(i, 1);
  recomputeDerived(state, now);
}
```

(Tests always pass an explicit `id` for determinism.)

**(d) `fireJourneyProgress` — include events in future contributions**, to keep
the documented invariant "the bar reaches 100% on the projected FIRE day"
(future months must assume exactly what `projectFire` assumes). Build the same
`evByIdx` map; change the future branch of `contrib` to:

```js
: plannedSavingsFor(plan, idxToYm(idx)) + delta + (evByIdx.get(idx) || 0);
```

(The existing `Math.max(0, contrib)` clamp already handles negative events —
the bar never regresses.)

**(e) `oneOffImpact` — additive optional `fromYm`** so the events manager can show
growth *from the event month* (not from today) without `Date` gymnastics:

```js
export function oneOffImpact(state, amount, now = new Date(), fromYm = null) {
  …
  const age = ageAt(birth, fromYm || todayYm(now));
  … (rest unchanged — O(1), keyboard-safe; existing F25 semantics intact when fromYm omitted)
```

### 2.3 UI — builder/glue split

**Placement decision:** a new Plan sub-page `#/plan/wydarzenia`. Precedent: all
Plan sub-pages (`renderPlanFire` … `renderPlanKorekty`) build their markup
inline in `ui.js`; this manager follows that pattern (no new module → no
PRECACHE/layering changes). Routing needs **no `route()` change** — only:

- `renderPlanHub` `items`: add (before the „Korekty sald" row):
  `['📅', 'Wydarzenia', 'planowane duże wydatki i wpływy', '#/plan/wydarzenia']`
- `renderPlanSection`: add `else if (section === 'wydarzenia') renderPlanWydarzenia();`

**New `renderPlanWydarzenia()` in `ui.js`** (mirror `renderPlanKorekty` structure):

- Module-level edit state: `let evEditId = null;` (null = add mode).
- Card 1 — the list, sorted as stored (ascending ym). Per event row (reuse
  `.hist-row`-style layout or plain `.kv` rows): month (`Fmt.formatMonthName`),
  **`esc(ev.label)`**, signed amount (`Fmt.formatPLN`, class `good` for `>0`,
  `warn-text` for `<0`), buttons `data-ev-edit="${ev.id}"` / `data-ev-del="${ev.id}"`.
  Under each **future** event a one-line impact from
  `E.oneOffImpact(state, Math.abs(ev.amount), new Date(), ev.ym)` (see copy below;
  skip the line when it returns `null` — incomplete profile). **Past** events
  (`ymToIdx(ev.ym) < ymToIdx(todayYm())`): grey the row (`class="muted"`), replace
  the impact line with the „minęło" hint, keep only the delete button.
- Card 1 footer — projection summary when any future event exists: run
  `const noEv = E.projectionWith(state, { events: [] })` once per render and show
  two `kv` lines using `An.fireCell` (import already present as `An`):
  `kv('FIRE z wydarzeniami', An.fireCell(d.projection.reached ? d.projection.fireYm : null, noEv.reached ? noEv.fireYm : null))`
  + `kv('FIRE bez wydarzeń', noEv.reached ? esc(Fmt.formatMonthName(noEv.fireYm)) : '<span class="warn-text">poza horyzontem</span>')`.
- Card 2 — add/edit form: `type="month"` input (`min` = `E.todayYm()`), a `.seg`
  toggle **Wydatek / Wpływ** (module var `evKind`, default `'expense'`), amount
  field (positive number typed by the user; stored sign applied from the toggle:
  expense ⇒ `-amount`), label text input `maxlength="60"`. Buttons: save
  (add or edit label per mode) + „Anuluj" in edit mode.
- Handlers: parse with `parseMoney`, call `E.upsertEvent` / `E.removeEvent` in
  `try/catch` (engine errors into `#plan-error` via `planFail`), then `persist()`,
  toast, re-render. Delete uses `confirm(...)`.
- The double-counting warning banner sits above the form (copy below).
- `metodologia([...])` at the bottom (copy below). Note: `metodologia` exists in
  the builders, not ui.js — either inline the same `<details class="section">`
  snippet or (simpler) hand-write it; do NOT import from simulation.js for this.

**Escaping:** `ev.label` is user text → `esc()` at every render site (list row,
confirm() message may use the raw string — `confirm` takes plain text, no HTML).

### 2.4 Polish copy — events

| Where | Copy |
|---|---|
| Hub item | `📅 Wydarzenia` / `planowane duże wydatki i wpływy` |
| Card 1 title | `Planowane wydarzenia 📅` |
| Card 1 intro | `Duże jednorazowe kwoty, o których już wiesz — samochód, wesele, spadek. Prognoza FIRE uwzględni je w wybranym miesiącu, w dzisiejszych złotówkach.` |
| Empty state | `Nie masz jeszcze żadnych wydarzeń. Dodaj pierwsze — np. „samochód za 3 lata” albo „spadek po cioci”.` |
| Impact line, expense (`amount<0`) | `Gdyby te pieniądze zostały w portfelu, do dnia FIRE urosłyby do ok. {formatPLN(round(futureValueReal))}.` |
| Impact line, income (`amount>0`) | `Do dnia FIRE ta kwota urośnie w portfelu do ok. {formatPLN(round(futureValueReal))}.` |
| Past-event hint | `minęło — ujmij w check-inie tego miesiąca i usuń z listy` |
| Summary kv labels | `FIRE z wydarzeniami` / `FIRE bez wydarzeń` |
| Warning banner (`banner info small`) | `Gdy miesiąc wydarzenia minie, wydarzenie przestaje działać na prognozę. Rzeczywisty wydatek lub wpływ zapisz wtedy w check-inie tego miesiąca — dzięki temu nic nie liczy się podwójnie.` |
| Form card title | `Dodaj wydarzenie` / (edit mode) `Edytuj wydarzenie` |
| Field: month | `Miesiąc` |
| Seg toggle | `Wydatek` / `Wpływ` |
| Field: amount | `Kwota` (suffix `zł`), hint: `Kwota w dzisiejszych złotówkach. Znak ustawia przełącznik powyżej.` |
| Field: label | `Nazwa`, placeholder `np. samochód, wesele, spadek`, hint: `Do 60 znaków.` |
| Buttons | `Dodaj wydarzenie` / `Zapisz zmiany` / `Anuluj` / row: `✏️ Edytuj`, `🗑️ Usuń` |
| Delete confirm | `Usunąć wydarzenie „{label}” ({formatMonthName(ym)})? Prognoza zostanie przeliczona.` |
| Toasts | `Wydarzenie dodane, prognoza przeliczona.` / `Wydarzenie zapisane, prognoza przeliczona.` / `Wydarzenie usunięte, prognoza przeliczona.` |
| Engine errors (thrown, shown via planFail) | `Nieprawidłowy miesiąc` · `Miesiąc wydarzenia już minął — wybierz bieżący lub przyszły` · `Kwota nie może być zerem` · `Nazwa może mieć najwyżej 60 znaków` |
| Metodologia | `Wydarzenie dolicza się do planu swojego miesiąca w prognozie — trafia tam, gdzie zwykła miesięczna nadwyżka: przed kredytem do funduszu na dom, w trakcie kredytu nadpłaca kredyt, po spłacie zasila portfel. Wydatek najpierw drenuje gotówkę, potem portfel.` · `Werdykty i „plan na miesiąc” w check-inie się nie zmieniają — wydarzenie działa wyłącznie na prognozę.` · `Szacunek „urośnie do” = kwota × (1+realny zwrot)^(lata od wydarzenia do docelowego wieku FIRE).` |

---

## 3. Feature 2 — Scenario snapshots in Symulacja (exactly 2 slots)

### 3.1 Locked semantics

- Exactly two named slots: `simScenarios[0]` = „Scenariusz A",
  `simScenarios[1]` = „Scenariusz B". Empty slot = `null`.
- Savable tabs and their canonical `inputs` (parsed values, never raw strings):

| `source` | `inputs` shape | Save precondition |
|---|---|---|
| `cojesli` | `{ month:'YYYY-MM', amount:number, recurring:boolean }` | valid month ≥ current, parsable amount |
| `wiek` | `{ ageYears:number }` | age > current age |
| `latte` | `{ amount:number }` | amount > 0 |
| `wiecej` | `{ extra:number }` | extra > 0 |
| `zwrot` | `{ realReturnAnnual:number }` (fraction) | always (slider) |

  Tabs `kredyt` and `nadplata` are **not savable** — they are pure loan
  calculators with no FIRE projection to compare.
- **Nothing mutates `assumptions` or entries.** Saving/deleting writes only
  `state.simScenarios` (+ `persist()`); loading writes only `ui.js` module vars;
  comparison runs `projectionWith` (read-only, F15a purity applies).
- Comparison is computed **fresh at render time** from stored inputs — a saved
  `wiek` scenario re-solves against current data (the solver already runs on
  every keystroke in that tab today, so per-render cost is acceptable).

### 3.2 `engine.js` — new pure helpers

```js
// Mapowanie scenariusza (source + inputs) na opcje projectionWith.
// 'wiek' wymaga solvera — dlatego silnik, nie UI. Zwraca { opts, infeasible }.
export function scenarioOpts(state, scenario, now = new Date()) {
  const { source, inputs } = scenario;
  if (source === 'zwrot')  return { opts: { assumptions: { realReturnAnnual: inputs.realReturnAnnual } }, infeasible: false };
  if (source === 'latte')  return { opts: { extraMonthlySavings: inputs.amount }, infeasible: false };
  if (source === 'wiecej') return { opts: { extraMonthlySavings: inputs.extra }, infeasible: false };
  if (source === 'cojesli') return { opts: { extraSavings: { month: inputs.month, amount: inputs.amount, recurring: !!inputs.recurring } }, infeasible: false };
  if (source === 'wiek') {
    const sol = solveExtraSavingsForAge(state, Math.round(inputs.ageYears * 12), {}, now);
    if (!sol.feasible) return { opts: null, infeasible: true };
    return { opts: { extraMonthlySavings: sol.extraMonthly }, infeasible: false };
  }
  throw new Error(`Nieznany scenariusz: ${source}`);
}

// Pełny przebieg scenariusza: { proj, infeasible }. proj = null gdy infeasible.
export function runScenario(state, scenario, now = new Date()) {
  const { opts, infeasible } = scenarioOpts(state, scenario, now);
  if (infeasible) return { proj: null, infeasible: true };
  return { proj: projectionWith(state, opts, now), infeasible: false };
}
```

Note: for a `cojesli` scenario whose month has meanwhile passed,
`projectionWith`'s `extraSavings` hits a plan index `< upto` → the amount lands
in an already-replayed month and has no effect. That degrades gracefully (result
= base projection); the compare card shows the stale-month note (copy below) when
`ymToIdx(inputs.month) ≤ ymToIdx(lastCompleteMonth(now))`.

### 3.3 `simulation.js` — new pure builders

```js
// Pasek zapisu scenariusza pod kartą symulacji (tylko zakładki „projekcyjne").
export function scenarioSaveBar({ slots, nameValue, canSave })
// → <div class="card"> z polem #scn-name (maxlength 40), przyciskami
//   data-scn-save="0" („💾 Zapisz jako A") i data-scn-save="1" („… jako B");
//   przy zajętym slocie dopisek „(nadpisze „{esc(name)}”)"; przyciski disabled gdy !canSave.

// Podsumowanie parametrów scenariusza po polsku (czysta funkcja — testowalna).
export function scenarioSummary(scenario)   // → string, np. „+2 000 zł jednorazowo (wrzesień 2026)"

// Karta porównania (zakładka „Scenariusze").
export function scenarioCompareCard({ slots, results, baseFireYm, chartHTML, staleNote })
// slots: [slotA|null, slotB|null]; results: [{proj, infeasible}|null, …] — same indexes.
// Renders: per-slot header (esc(name), source label, savedAt date, scenarioSummary,
// data-scn-load / data-scn-del buttons), comparison table when both present,
// chart + legend, empty states, metodologia.
```

`scenarioSummary` mapping (uses `Fmt`): `cojesli` →
`„{signed(amount)} jednorazowo ({formatMonthName(month)})”` or
`„{signed(amount)}/mies. od {formatMonthName(month)}”`; `wiek` → `„FIRE w wieku {ageYears}”`;
`latte` → `„+{formatPLN(amount)}/mies. (małe wydatki)”`; `wiecej` →
`„+{formatPLN(extra)}/mies.”`; `zwrot` → `„realny zwrot {formatPct(realReturnAnnual)}”`.

Source→label map (export it, ui.js reuses for the load toast):
`cojesli: 'Co jeśli?', wiek: 'Cel: wiek FIRE', latte: 'Małe wydatki', wiecej: 'Oszczędzaj więcej', zwrot: 'Wpływ zwrotu'`.

Comparison table (both slots present; reuse `fireCell` from analysis.js, already
imported): columns `['', 'Scenariusz A', 'Scenariusz B']`, rows:

- `Data FIRE` — `fireCell(projX.fireYm, baseFireYm)` per side (or
  `„cel nieosiągalny”`, class `warn-text`, when `infeasible`; `„poza horyzontem”`
  via fireCell when not reached).
- `Wiek w dniu FIRE` — `Fmt.formatAgeYM(fireAge)` or `—`.
- Final `kv` line „A vs B": if both reached,
  `d = ymToIdx(fireYmB) − ymToIdx(fireYmA)`; `d>0` →
  `„Scenariusz A wcześniej o {formatYearsMonths(d)}”` (class `good`), `d<0` →
  mirrored for B, `d===0` → `„Ten sam miesiąc FIRE.”`; otherwise omit.

All scenario **names go through `esc()`** everywhere rendered (card, save-bar
overwrite hint). `confirm()` messages may use raw names (plain text).

### 3.4 `ui.js` glue (`renderSymulacja`)

- New module vars: `let scnName = '';` (save-bar name field survives re-renders).
- Tabs list: append `['scenariusze', 'Scenariusze']` (always visible).
- Under each savable tab's card (after the `note`), append
  `Sim.scenarioSaveBar({ slots: state.simScenarios || [null,null], nameValue: scnName, canSave })`
  where `canSave` = the tab's current inputs parse per §3.1 (reuse the tab's
  existing parse logic; for `wiek` also require the solver-independent
  precondition age > current — do NOT run the solver just to enable the button).
- Save handler (`[data-scn-save]` click): trim name; empty →
  `„Podaj nazwę scenariusza (do 40 znaków).”` into the tab's result div is wrong —
  use `toast(...)` instead (no error div in the save bar); if slot occupied →
  `confirm('Nadpisać scenariusz {A|B} („{name}”)?')`; build `inputs` from the
  module vars (parsed), write
  `state.simScenarios[i] = { name, savedAt: new Date().toISOString(), source: symTab, inputs }`;
  `persist(); toast('Scenariusz zapisany w slocie {A|B}.'); renderSymulacja();`
- `scenariusze` tab body: `results = slots.map(s => s ? E.runScenario(state, s) : null)`;
  chart when both reached: merge the two projections' `series` by index into
  `rows = [{ ym, a, b }]` (pad the shorter series by repeating its last
  portfolio value so both lines span the longer horizon), then
  `chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }, { get: r => r.b, cls: 'line-cash' }])`
  — reuses existing CSS classes (accent vs warn), **no styles.css change**;
  legend: `A — portfel` (accent) / `B — portfel` (warn color).
- Load handler (`[data-scn-load="i"]`): set `symTab = slot.source`, restore that
  tab's module vars from `inputs` (`cojesli` → `simMonth/simAmount/simRecurring`
  (amount via `moneyVal`), `wiek` → `symAge`, `latte` → `symLatte`, `wiecej` →
  `symMore`, `zwrot` → `symReturn`), `renderSymulacja()`,
  `toast('Scenariusz wczytany — zakładka „{label}”.')`. No persistence.
- Delete handler (`[data-scn-del="i"]`): `confirm('Usunąć scenariusz {A|B} („{name}”)?')`
  → `state.simScenarios[i] = null; persist(); renderSymulacja(); toast('Scenariusz usunięty.');`

### 3.5 Polish copy — scenarios

| Where | Copy |
|---|---|
| Tab label | `Scenariusze` |
| Compare card title | `Scenariusze A i B 🆚` |
| Compare intro | `Zapisz dwa warianty symulacji i porównaj je obok siebie. To nadal czyste „co jeśli” — Twoje założenia i wpisy pozostają nietknięte.` |
| Empty (0 slots) | `Nie masz jeszcze zapisanych scenariuszy. Otwórz dowolną symulację (Co jeśli?, Cel: wiek, Małe wydatki, Więcej, Zwrot) i zapisz ją jako A lub B.` |
| Empty (1 slot) | `Zapisz drugi scenariusz, aby zobaczyć porównanie obok siebie.` |
| Save bar label | `Nazwa scenariusza`, placeholder `np. Podwyżka 2027` |
| Save buttons | `💾 Zapisz jako A` / `💾 Zapisz jako B`; occupied hint: `(nadpisze „{name}”)` |
| Save toasts/errors | `Scenariusz zapisany w slocie A.` (/B) · `Podaj nazwę scenariusza (do 40 znaków).` |
| Overwrite confirm | `Nadpisać scenariusz A („{name}”)?` |
| Slot meta | `Zapisano: {locale date}` · source label per map §3.3 |
| Slot buttons | `Wczytaj` / `Usuń` |
| Load toast | `Scenariusz wczytany — zakładka „{label}”.` |
| Delete confirm / toast | `Usunąć scenariusz A („{name}”)?` / `Scenariusz usunięty.` |
| Infeasible cell | `cel nieosiągalny (nawet +100 000 zł/mies.)` |
| Stale-month note (`cojesli` with past month) | `Miesiąc tego scenariusza już minął — kwota nie wpływa już na prognozę.` |
| Table rows | `Data FIRE` · `Wiek w dniu FIRE` · A-vs-B line per §3.3 |
| Chart legend | `A — portfel` / `B — portfel` |
| Metodologia | `Każdy scenariusz to pełny przebieg prognozy (plan → dług → salda → projekcja) z parametrami zapisanymi w slocie, liczony na Twoich AKTUALNYCH danych.` · `Scenariusz „Cel: wiek” za każdym razem od nowa szuka minimalnej dopłaty — wynik może się zmieniać wraz z nowymi wpisami.` · `Zapisujemy tylko parametry symulacji (dwa sloty) — nigdy założeń ani wpisów.` |

---

## 4. Feature 3 — Notes on check-ins

### 4.1 `engine.js applyCheckIn` — one additive change

Accept optional `input.note`; validate; store on the entry:

```js
const note = input.note != null ? String(input.note).trim() : '';
if (note.length > 200) throw new Error('Notatka może mieć najwyżej 200 znaków');
…
const entry = {
  month, earned, spent, overpayment, familyOverpayment,
  …,
  note: note || null,          // '' → null; brak pola → null
  plannedSavingsSnapshot, verdict, createdAt, updatedAt,
};
```

Editing an entry re-runs `applyCheckIn` → the note is replaced by whatever is in
the form (the form pre-fills the existing note, so nothing is lost silently).
`deleteEntry` needs no change. **No migration action** (absent field reads as
`undefined` → all readers use `e.note || ''`/`|| null`); the v3 migration-step
comment documents this explicitly (§1.3). **No validateState change** (§1.3).

### 4.2 `ui.js` — check-in form + Historia

`renderCheckin`: after the `ci-spent` field (before the overpayment fields), add
a textarea block (the `field()` helper renders `<input>` only — hand-write this
one, matching `.field` markup):

```html
<label class="field"><span class="lbl">Notatka <span class="muted">(opcjonalnie)</span></span>
  <textarea id="ci-note" maxlength="200" rows="2"
    placeholder="np. premia roczna, wakacje, naprawa auta">${existing && existing.note ? esc(existing.note) : ''}</textarea>
  <div class="hint">Krótka notatka wyjaśni za rok, skąd wziął się nietypowy miesiąc (do 200 znaków).</div>
</label>
```

Save handler: pass `note: $('#ci-note').value` into `E.applyCheckIn` input.

`renderHistory`: in the non-gap row, when `e.note` present append below the
existing subtitle line: `<span class="muted small">📝 ${esc(e.note)}</span>`
(inside the `.m` div, as a second line). Notes are user text → `esc()` — this is
the XSS-sensitive spot the review agent will check.

### 4.3 `styles.css` — one selector extension (only CSS change in this batch)

`textarea` is currently unstyled. Extend the two existing rules:

- line ~202: `input[type="text"], input[type="number"], input[type="date"], input[type="month"], select, textarea { … }`
- line ~212: `input:focus, select:focus, textarea:focus { … }`
- plus one new declaration: `textarea { resize: vertical; font: inherit; }`

Add nothing else; dark mode is inherited via the CSS custom props already used
by those rules.

---

## 5. Tests & fixtures

Fixture numbering: next free numbers after batch A/B land; referred to here as
**F27 (events), F28 (notes), F29 (scenarios)** — renumber if A/B consumed them.
All new engine tests use the existing helpers (`baseState()`, `entry()`,
`housePlan()`, `NOW = new Date(2026, 6, 15)` → `upto = '2026-06'`,
anchor `'2026-07'`, plannedSavings = 4 000 zł/mies. at r defaults).
For exact-arithmetic tests override `realReturnAnnual: 0, cashReturnReal: 0,
inflationAnnual: 0` (and mortgage `rateNominal: 0` where a loan is involved).

### `tests/fixtures.js` additions

```js
// Wydarzenia jednorazowe (projekcja): kwoty i miesiące dla testów r=0/infl=0.
F27: {
  income: { ym: '2026-10', amount: 12000, label: 'spadek' },
  expense: { ym: '2026-11', amount: -8000, label: 'samochód' },
  cashStart: 5000,
  pastYm: '2026-05',            // ≤ upto (2026-06) → ignorowane
  debtEvent: { ym: '2028-09', amount: 10000 }, // hipoteka 0%: saldo niżej dokładnie o 10 000
},
// Notatki wpisów.
F28: { note: '  premia roczna  ', trimmed: 'premia roczna', max: 200 },
// Sloty scenariuszy.
F29: {
  slotA: { name: 'Podwyżka', savedAt: '2026-07-01T00:00:00.000Z',
           source: 'zwrot', inputs: { realReturnAnnual: 0.06 } },
  slotB: { name: 'Kawa & dojazdy', savedAt: '2026-07-01T00:00:00.000Z',
           source: 'latte', inputs: { amount: 450 } },
  wiekFeasible: { source: 'wiek', inputs: { ageYears: 40 } },   // na stanie F23.need
  wiekInfeasible: { source: 'wiek', inputs: { ageYears: 27 } }, // na stanie F23.infeasible
},
```

### New tests in `tests/test-engine.js` (IDs = test names; add helper `eventOf(fix, id)` inline if useful)

**Migration / storage (extend the F11 section):**

- `C-MIG-1: v3 = createState.version = SCHEMA_VERSION; v2→v3 dodaje events i simScenarios`
  — `baseState().version === S.SCHEMA_VERSION` (guards the manual invariant);
  clone a state via `JSON.parse(S.exportJSON(st)).state`, set `version = 2`,
  `delete events; delete simScenarios`, run `S.migrate(S.validateState(v2))` →
  `version === 3`, `events` is `[]`, `simScenarios` deep-equals `[null, null]`.
- `C-MIG-2: pełny łańcuch v1→v3` — take the existing F11 v1 fixture construction
  (also delete `events`/`simScenarios`), migrate → `version === 3`, familyLoan
  added AND events/simScenarios added (chain fall-through works end to end).
- `C-MIG-3: validateState — uszkodzone events odrzucone, brak events przechodzi`
  — `{...st, events: 'x'}` throws; `{...st, events: [{ ym: 'zle', amount: 1 }]}`
  throws; a v2-shaped state **without** `events` passes `validateState`
  (validate-before-migrate order); `{...st, simScenarios: 'x'}` throws.
- `C-MIG-4: eksport/import round-trip nowych pól` — state with one event
  (label `"<script>alert(1)</script>"`), one note, one scenario slot →
  `exportJSON` → `importPreview` → deep-equal `events`, `simScenarios`,
  `entries[0].note` (data layer stores raw text; escaping is render-time).

**Events → projection (F27):**

- `F27a: wydarzenie dodatnie = skok portfela dokładnie o kwotę (r=0, infl=0)` —
  no house, no entries (delta 0, byPlanOnly), event `+12000 @ 2026-10` via
  `E.upsertEvent(st, {...FIX.F27.income, id:'e1'}, NOW)`; compare
  `projectFire`-series (from `st.derived.projection`) against a no-events clone:
  portfolio equal for months `< 2026-10`, exactly `+12000` for every month
  `≥ 2026-10`; `fireYm` (with events) ≤ base `fireYm` (as month indices).
- `F27b: wydatek najpierw drenuje gotówkę, potem portfel` — `cashStart 5000`
  (no house ⇒ history months just grow; projected months route surplus to
  portfolio, deficits cash-first): event `−8000 @ 2026-11`, plan 4000 ⇒
  `s = −4000` that month → cash `5000→1000`, portfolio unchanged vs previous
  month's portfolio + 0 (assert `series` row `2026-11`: `cash === 1000`,
  `flowCash === -4000`, `flowPortfolio === 0`).
- `F27c: w fazie długu wydarzenie nadpłaca kredyt; nadmiar wraca do portfela` —
  housePlan mortgage `rateNominal: 0`, small principal, `inflationAnnual: 0`;
  event `+10000` in a debt month ⇒ that month's `debtReal` lower by exactly
  10 000 vs no-events run; second variant with event large enough to clear the
  balance ⇒ `debtFreeYm` that month and the spill lands in portfolio
  (`flowPortfolio` includes the excess).
- `F27d: przeszłe wydarzenie nie działa; buildPlan/werdykty nietknięte` — event
  `@ 2026-05` (≤ upto): `JSON.stringify(projection.series)` identical to
  no-events run; `E.plannedSavingsFor(buildPlan(st), '2026-05')` identical
  with/without events; `replayBalances` rows identical.
- `F27e: wydarzenie po dacie FIRE nie działa` — event at `addMonths(fireYm, 2)`
  ⇒ same `fireYm`, same series length.
- `F27f: dwa wydarzenia w tym samym miesiącu się sumują` — `+5000` i `−2000`
  @ same ym ≡ single `+3000` run (series deep-equal).
- `F27g: projectionWith czystość + opcja events` —
  `before = JSON.stringify(state)`; run
  `projectionWith(st, { events: [{id:'x', ym:'2026-10', amount: 12000, label:''}] })`
  and `projectionWith(st, { events: [] })`; `JSON.stringify(state) === before`
  (F15a-style purity); the `events: []` run deep-equals the projection of a
  state that never had events; omitted `events` inherits `state.events`.
- `F27h: fireJourneyProgress uwzględnia wydarzenia` — positive future event ⇒
  `totalValue` strictly greater than without; with the event the bar still ends
  at `pct ≤ 1`.
- `F27i: walidacja upsertEvent/removeEvent` — bad ym throws; `amount: 0` throws;
  61-char label throws; `ym: '2026-05'` (past vs NOW) throws; upsert with same
  id replaces (length stays 1); list sorted ascending by ym after inserts out of
  order; `removeEvent` deletes by id and recomputes (`state.derived` refreshed).

**Notes (F28):**

- `F28a: notatka przycinana, pusta → null` — `applyCheckIn(st, { month:'2026-06',
  earned: 8000, spent: 5000, note: FIX.F28.note }, NOW)` ⇒
  `entry.note === 'premia roczna'`; second entry with `note: '   '` ⇒ `null`;
  omitted `note` ⇒ `null`.
- `F28b: limit 200 znaków` — `'x'.repeat(200)` OK, `'x'.repeat(201)` throws
  (`assertThrows`).
- `F28c: wpis bez notatki nadal przechodzi walidację i replay` — hand-built
  entry via the `entry()` helper (no `note` key) → `validateState` passes,
  `recomputeDerived` runs, and editing that month via `applyCheckIn` with a new
  note sets it (edit path).

**Scenarios (F29):**

- `F29a: scenarioOpts — mapowanie 1:1` — `zwrot` ⇒
  `{ assumptions: { realReturnAnnual: 0.06 } }`; `latte`/`wiecej` ⇒
  `extraMonthlySavings`; `cojesli` ⇒ `extraSavings` passthrough with boolean
  `recurring`; unknown source throws.
- `F29b: runScenario('zwrot') ≡ projectionWith z tym samym założeniem` —
  `fireYm` and last-series portfolio equal between
  `runScenario(st, FIX.F29.slotA, NOW).proj` and
  `projectionWith(st, { assumptions: { realReturnAnnual: 0.06 } }, NOW)`.
- `F29c: 'wiek' — parytet z solverem i flaga infeasible` — on the F23 `need`
  state, `scenarioOpts(..., wiekFeasible)` extraMonthlySavings ≈
  `solveExtraSavingsForAge(...).extraMonthly` (assertClose); on the F23
  `infeasible` state, `runScenario` returns `{ proj: null, infeasible: true }`.
- `F29d: czystość runScenario` — `JSON.stringify(state)` unchanged across
  `runScenario` (including the `wiek` solver path).

Also update the **CLAUDE.md tests paragraph** (one sentence listing F27–F29) and
the persisted-state shape block (add `events`, `simScenarios`, `note`) — keep
CLAUDE.md truthful for the later batches.

---

## 6. Exact file-touch list

| File | Change |
|---|---|
| `js/engine.js` | `createState`: `version: 3`, `events: []`, `simScenarios: [null, null]` · `applyCheckIn`: `note` (validate ≤200, trim, ''→null; new `note` field on entry) · new `upsertEvent`, `removeEvent` (mutations section) · `projectFire`: `evByIdx` map + `s = … + (evByIdx.get(idx) || 0)` · `projectionWith`: `events` option · `fireJourneyProgress`: events in future contribs · `oneOffImpact`: optional `fromYm` param · new `scenarioOpts`, `runScenario` |
| `js/storage.js` | `SCHEMA_VERSION = 3` · `migrate` case 2→3 (events, simScenarios; note documented as no-op) · `validateState` tolerant checks for `events` / `simScenarios` |
| `js/simulation.js` | new builders: `scenarioSaveBar`, `scenarioSummary`, `scenarioCompareCard`, exported source→label map; `esc()` on every name/label |
| `js/ui.js` | `renderPlanHub` item + `renderPlanSection` branch + new `renderPlanWydarzenia` (list, add/edit form, impact lines via `oneOffImpact(..., fromYm)`, summary via `projectionWith({events: []})`, handlers) · `renderCheckin`: note textarea + pass `note` to `applyCheckIn` · `renderHistory`: `📝 note` line (esc) · `renderSymulacja`: `Scenariusze` tab, save bars on 5 tabs, save/load/delete handlers, A/B chart via `chartSVG` (`line-port`/`line-cash`), new module vars (`scnName`, `evEditId`, `evKind`) |
| `styles.css` | add `textarea` to the two input rules + `textarea { resize: vertical; font: inherit; }` (only CSS change) |
| `tests/fixtures.js` | `F27`, `F28`, `F29` blocks (§5) |
| `tests/test-engine.js` | tests `C-MIG-1…4`, `F27a–i`, `F28a–c`, `F29a–d` (§5) |
| `CLAUDE.md` | persisted-state shape block (`events`, `simScenarios`, `note`), tests paragraph (F27–F29), routes table (`#/plan/wydarzenia` falls under existing `#/plan/:section` row — mention in the Plan-hub sentence) |
| `docs/features/C.md` (new) | short maintenance doc: shapes, injection point, scenario slot contract, note field |
| `docs/INDEX.md` | append one line for batch C |

**Deliberately untouched:** `sw.js` (no new app files; version bump is the
release agent's job), `index.html` (no new top-level tab; footer version stays),
`js/app.js`, `js/format.js`, `js/coach.js`, `js/motivation.js`, `js/analysis.js`
(reuses `fireCell` via existing imports only).

---

## 7. Implementation order & acceptance checklist

1. `storage.js` + `engine.js createState` (schema first) → run tests, fix the two
   existing F11 assertions that pin `version === 2` (update them to
   `S.SCHEMA_VERSION` / 3 as part of C-MIG-1).
2. Engine: events (`upsertEvent`/`removeEvent`/`projectFire`/`projectionWith`/
   `fireJourneyProgress`/`oneOffImpact`) + notes (`applyCheckIn`) + scenarios
   (`scenarioOpts`/`runScenario`). Add F27/F28/F29 fixtures + tests as each lands.
3. UI: events manager → check-in note + Historia → Symulacja scenarios.
4. `styles.css` textarea rule; CLAUDE.md + docs.
5. Acceptance: `node tests/run-tests.js` green (121 + new); `/FIRE/` subpath
   rehearsal loads; manual smoke on `localhost`: add event → dashboard chart
   jumps at that month; event month passes (simulate by editing state month) →
   projection ignores it; save two scenarios → compare tab shows table + chart;
   note with `<b>xss</b>` renders literally in Historia and the events manager;
   export → wipe → import restores events/scenarios/notes; a v2 backup imports
   cleanly (migration).
