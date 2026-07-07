# Plan: Planned one-off events on the timeline (persisted)

Status: proposed · Target version: **v1.14.0** · Schema bump: **v2 → v3**

## Goal

Let the user place future big one-off expenses and incomes (car, wedding,
inheritance, bonus) in specific months, persist them in `state`, and have the
FIRE projection reflect them. Unlike the Symulacja "what-if" calculators
(ephemeral, never persisted), these events are part of the user's actual plan
and survive reloads, exports, and imports.

## User story

"In 2028-06 I'm paying ~40 000 zł for a wedding, and in 2030 I expect a
~100 000 zł inheritance. I want the Pulpit/Analiza projection — my FIRE date,
the debt-free date, the chart — to already account for both, without me
re-entering them into a simulator every time."

## Design decisions (locked)

1. **Amounts are real (today's PLN), signed.** Positive = income, negative =
   expense. This matches the repo invariant (nothing without a `Nominal`
   suffix is nominal) and the existing `extraSavings` convention in
   `projectionWith` ([engine.js:965](../js/engine.js#L965)), where negative
   amounts are already legal and drain cash → portfolio through the existing
   deficit paths. The UI presents a *wydatek/przychód* toggle plus a positive
   amount; the sign is applied on save.

2. **Events affect the projection only — never history, never verdicts.**
   History is truth via check-in entries: when an event's month arrives, the
   actual money flows through that month's check-in (`earned`/`spent`), and
   the event stops being projected. Concretely:
   - `buildPlan` is **not** touched. `plannedSavingsFor` → check-in
     `plannedSavingsSnapshot` → verdicts stay exactly as they are. A planned
     wedding does not rewrite the savings benchmark for that month.
   - `projectFire` injects events only in its future loop, which already
     starts at `max(upto + 1, anchorIdx)` ([engine.js:603](../js/engine.js#L603)) —
     elapsed events (month ≤ last complete month) and pre-anchor events are
     excluded for free. No double counting is possible.

3. **Events reuse the phase routing as-is.** Inside the projection loop the
   event amount is simply added to the month's surplus `s`:
   - *saving* phase: income → cash bucket; expense → drains cash, then portfolio.
   - *debt* phase: income → overpays the mortgage (converted via `toNominal`,
     spill returns to portfolio) — consistent with the locked strategy
     "pay debt first, then invest"; expense → deficit path.
   - *invest* phase: income → portfolio; expense → deficit path.
   No new routing code; the existing `s < 0` / `s ≥ 0` branches handle it.

4. **Top-level persisted field `state.events`**, parallel to `state.entries`.
   Schema version 2 → 3 with a migration step, a `createState` default, and a
   `validateState` check (load-critical: a NaN amount would poison the whole
   projection).

5. **Scope: accumulation projection only.** Events are consumed by
   `projectFire` (and therefore by everything built on it: the Pulpit chart,
   `projectionWith`, `solveExtraSavingsForAge`, `requiredSavingsForGoal`,
   `fireJourneyProgress`). The withdrawal-phase analyses
   (`projectWithdrawal`, `projectDieWithZero`) do **not** consume events in
   v1 — see Non-goals.

## Data model

```js
// state.events — sorted by month on insert (like state.entries)
[
  {
    id: 1,                    // monotonic integer: max(existing ids) + 1 — deterministic, no Date/random in the engine
    month: '2028-06',         // "YYYY-MM"; arithmetic via ymToIdx only
    amount: -40000,           // real PLN, signed; roundGrosze on ingest; never 0
    label: 'Wesele',          // user text, ≤ 80 chars; escaped at render time
    createdAt: '…ISO…',       // from the `now` param, mirroring applyCheckIn
  },
]
```

Why signed `amount` instead of `{ kind, amount }`: one source of truth, the
engine consumes it directly, and it matches `extraSavings.amount`. The
income/expense distinction is a UI presentation concern.

## Changes by file

### `js/storage.js`

- `SCHEMA_VERSION` 2 → **3**.
- `migrate`: extend the fall-through chain ([storage.js:41](../js/storage.js#L41)):

  ```js
  case 2:
    // v2 → v3: planowane zdarzenia jednorazowe
    if (!Array.isArray(cur.events)) cur.events = [];
    cur.version = 3;
    // fall-through
  case 3:
    break;
  ```

- `validateState`: after the entries check, mirror it for events:

  ```js
  if (!Array.isArray(s.events || [])) throw new Error('Uszkodzona lista zdarzeń');
  for (const ev of s.events || []) {
    if (!/^\d{4}-\d{2}$/.test(ev.month) || typeof ev.amount !== 'number' || !isFinite(ev.amount)) {
      throw new Error('Uszkodzone zdarzenie w planie');
    }
  }
  ```

  Note `s.events || []`: `validateState` runs **before** `migrate` in
  `load()`/`importPreview`, so a valid v2 blob (no `events` key) must pass.
- Export/import need no further work — `exportJSON` already serializes the
  whole state, and `importPreview` runs `validateState` + `migrate`. Old app
  versions will reject v3 backups with the existing "kopia z nowszej wersji"
  error, which is the established contract.

### `js/engine.js`

- `createState` ([engine.js:1385](../js/engine.js#L1385)): add `events: []`
  and bump the hardcoded `version: 2` → `3` (it must match `SCHEMA_VERSION`).

- **New mutation helpers** in the check-in mutations section, mirroring
  `applyCheckIn`/`deleteEntry` conventions (Polish error messages, `now`
  param, `recomputeDerived` at the end):

  ```js
  export function addEvent(state, input, now = new Date()) {
    const { month, label } = input;
    if (!isValidYm(month)) throw new Error('Nieprawidłowy miesiąc');
    if (ymToIdx(month) <= ymToIdx(lastCompleteMonth(now))) {
      throw new Error('Zdarzenie musi dotyczyć bieżącego lub przyszłego miesiąca');
    }
    const amount = roundGrosze(Number(input.amount));
    if (!isFinite(amount) || amount === 0) throw new Error('Kwota musi być różna od zera');
    const id = state.events.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    const ev = { id, month, amount, label: String(label || '').trim().slice(0, 80), createdAt: now.toISOString() };
    state.events.push(ev);
    state.events.sort((x, y) => (x.month < y.month ? -1 : 1));
    recomputeDerived(state, now);
    return ev;
  }

  export function removeEvent(state, id, now = new Date()) {
    const i = state.events.findIndex(e => e.id === id);
    if (i >= 0) state.events.splice(i, 1);
    recomputeDerived(state, now);
  }
  ```

  The current month is allowed (it is still a projected month — `upto` is the
  *last complete* month), so "I'm buying the car this month" works and hands
  off cleanly to the check-in when the month completes.

- **`projectFire`** ([engine.js:547](../js/engine.js#L547)): build an index
  map once before the loop, then add the month's event total to `s`:

  ```js
  const eventsByIdx = new Map();
  for (const ev of state.events || []) {
    const i = ymToIdx(ev.month);
    eventsByIdx.set(i, (eventsByIdx.get(i) || 0) + ev.amount);
  }
  ```

  and in the loop ([engine.js:612](../js/engine.js#L612)):

  ```js
  const s = pm.plannedSavings + delta + (eventsByIdx.get(idx) || 0);
  ```

  That single line is the entire projection integration. `state.events || []`
  keeps the function safe for shallow-copied states in tests and for callers
  that build partial states. Everything downstream — chart series, `fireYm`,
  `debtFreeYm`, `onTrack` — updates automatically because it all derives from
  the same loop.

  Deliberate consequence of touching `s` (not a separate flow): the event
  participates in the same month ordering as planned savings — applied before
  growth, before the `houseSpend` withdrawal, exactly like an extra
  contribution in `projectionWith`. Excel-parity fixtures stay valid because
  states without events are byte-identical in behavior.

- `recomputeDerived`, `projectionWith`, and the solvers need **no changes** —
  they pass `state` through to `projectFire`, so events flow automatically.
  (`projectionWith` shallow-copies the state and shares the `events` array by
  reference; that is fine — nothing mutates it.)

### `js/ui.js`

- **Plan hub tile** in `renderPlanHub` ([ui.js:1556](../js/ui.js#L1556)):

  ```js
  ['📅', 'Zdarzenia jednorazowe', 'planowane duże wydatki i przychody', '#/plan/zdarzenia'],
  ```

- **New sub-page** `#/plan/zdarzenia` wired through `renderPlanSection`.
  It follows the existing plan-section pattern (markup inline in `ui.js`,
  `planBack` link, event delegation). Contents:
  - **Add form**: `<input type="month">` (min = current month), a segmented
    *Wydatek / Przychód* toggle, an amount **text field** with pl-PL parsing
    via `format.js` (same pattern as the v1.13.1 overpayment field — not
    `type="number"`), and a label text input (maxlength 80). Submit calls
    `addEvent` (applying the sign from the toggle), `persist()`, re-render;
    engine validation errors surface as the existing toast/inline pattern.
  - **List** of events sorted by month: month, label (through `ui.js`'s
    `esc()` — user-derived text), signed amount formatted pl-PL (expenses red
    with −, incomes green with +), and a delete button (touch target ≥ 48px)
    calling `removeEvent` → `persist()` → re-render.
  - **Elapsed events** (month ≤ last complete month, possible only because
    time passed) stay listed but greyed with a badge „minione — ujęte w
    check-inie" and the delete button; they no longer influence anything.
  - A one-line hint under the form: „Kwoty w dzisiejszych złotych. Zdarzenie
    wpływa na prognozę; gdy miesiąc nadejdzie, rzeczywistą kwotę zapisz w
    check-inie."
- `activeRoute()` needs no change — every `#/plan/*` sub-page already maps to
  the Plan tab.

### `index.html`, `sw.js`

- No new files → `PRECACHE` list unchanged. Only the release version bump
  (below).

### New user-facing copy (Polish)

All strings above; keep the tone consistent with `coach.js`. No new
`coach.js` messages are required for v1 (no motivational layer hook).

## Tests — fixture group F27 (`tests/test-engine.js`)

The Excel-derived fixtures are the spec; a state without events must be
bit-identical to today's behavior (regression guard is the existing suite
passing untouched). New cases:

1. **Defaults & schema**: `createState()` has `events: []` and `version === 3`;
   `SCHEMA_VERSION === 3`.
2. **Migration**: a v2 blob gains `events: []` and `version 3`; a v1 blob
   runs the full chain (familyLoan + events); unknown version still throws.
3. **Validation**: `validateState` passes a v2 blob without `events`; rejects
   a non-array `events`, a bad `month`, and a non-finite `amount`.
4. **Mutations**: `addEvent` rejects an invalid month, a past month
   (≤ last complete month) and a zero amount; accepts the current month;
   assigns monotonic ids (1, 2, 3 — also after deleting the middle one, the
   next id is max+1, not reuse); rounds to grosze; sorts by month;
   `removeEvent` with an unknown id is a no-op; both trigger
   `recomputeDerived`.
5. **Projection — income**: one future income event in the *invest* phase →
   from that month the portfolio series exceeds the no-event run by exactly
   `amount` compounded at `(1 + rPort)` per month; `fireYm` is not later.
6. **Projection — expense**: one future expense in the *saving* phase drains
   cash first, then portfolio (assert both buckets against hand-computed
   values); a large expense pushes `fireYm` later.
7. **Projection — debt phase**: an income event during the mortgage overpays
   it (compare `debtFreeYm` with/without; spill lands in portfolio when the
   event exceeds the remaining balance).
8. **No double counting**: an event with month ≤ `uptoYm` changes nothing in
   the projection output; an event before `anchorMonth` changes nothing.
9. **Verdicts untouched**: `plannedSavingsFor` and a check-in's
   `plannedSavingsSnapshot`/`verdict` in the event month are identical with
   and without the event.
10. **Purity & determinism**: `projectionWith` on a state with events leaves
    the state untouched (F15a pattern); `recomputeDerived` twice → identical
    series.
11. **Solvers**: `solveExtraSavingsForAge` with a large future expense
    returns a strictly larger requirement than without it.
12. **Storage round-trip**: `exportJSON` → `importJSON` preserves events
    exactly; `.bak` recovery path unaffected.

## Release checklist (v1.14.0)

1. `sw.js` → `const CACHE = 'fire-v1.14.0'`.
2. `index.html` footer → `FIRE Companion v1.14.0`.
3. `js/ui.js` → `APP_VERSION = '1.14.0'`.
4. `node tests/run-tests.js` green (all existing + F27).
5. `/FIRE/` subpath rehearsal (serve parent dir, open `/fire/`).
6. Commit message in Polish, e.g.
   `feat: planowane zdarzenia jednorazowe w prognozie (v1.14.0)`.

## Edge cases

- **Two events in the same month** — summed via the `eventsByIdx` map;
  both stay individually listed and deletable in the UI.
- **Event in the current (incomplete) month** — projected until the month
  completes; after the check-in it becomes "minione" and is ignored.
- **Event beyond the plan horizon** (720 months) — silently outside the loop
  range; the UI month input should cap at +60 years to make this unreachable.
- **Event after the computed `fireYm`** — `projectFire` breaks at FIRE, so it
  is ignored (see Non-goals). Cheap guard worth adding in the UI: if any
  event month > `fireYm`, show a note that the projection ends at FIRE.
- **Huge expense** — the deficit path already floors implicitly the same way
  projected deficits do today; no new negative-balance behavior is
  introduced (portfolio can go negative in projection exactly as it can now
  with a sustained negative plan — unchanged semantics).
- **Import of a v3 backup into this version** — works; into an older app —
  rejected with the existing "newer version" message (established contract).

## Non-goals (v1)

- **Withdrawal-phase analyses** (`projectWithdrawal`, `projectDieWithZero`)
  do not consume events. Post-FIRE events would need a different model
  (they'd interact with the withdrawal rate and die-with-zero glidepath).
  Candidate for a follow-up.
- **Editing an event in place** — delete + re-add covers v1; an edit form is
  a trivial follow-up if it earns its keep.
- **Recurring events** — the Symulacja screen's recurring what-if stays
  ephemeral; recurring *persisted* flows are a different feature (they'd
  belong in assumptions, not events).
- **Migrating `houseSpend` onto events** — the house purchase stays a
  dedicated, phase-defining mechanism; events are general-purpose extras.
- **Chart markers / Pulpit "upcoming event" card** — nice-to-have visual
  layer; the projection numbers and chart already move. Stretch, not v1.

## Implementation order

1. `storage.js`: `SCHEMA_VERSION`, `migrate`, `validateState`.
2. `engine.js`: `createState` default + version, `addEvent`/`removeEvent`,
   the two-line `projectFire` injection.
3. `tests/test-engine.js`: F27 (write alongside step 2; the projection
   assertions drive out the injection details).
4. `ui.js`: hub tile + `#/plan/zdarzenia` section.
5. Manual pass: add/delete events, verify Pulpit chart and FIRE date move,
   export/import round-trip, subpath rehearsal.
6. Version bumps, full suite, commit.
