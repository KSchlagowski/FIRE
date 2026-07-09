# Check-in notes — optional monthly note on the entry (`note`)

## Context

A monthly check-in captures numbers; the *story* of the month (bonus, vacation,
car repair) evaporates. This feature adds one optional free-text note (≤200
characters) to the entry, shown in Historia and exported in the CSV. The note is
**inert** — it participates in no calculation, no verdict, no replay.

This doc is the **rebase** required by the audit roadmap (task 4.1 of
`openspec/changes/audit-improvement-roadmap`): the original plan assumed the
next free schema version was 5, then the roadmap re-pinned it to 6 — but Belka
took v5 and IKE/IKZE took v6 before Phase 4 ran. Notes therefore ship as
**schema v7** (`case 6` migration stamping `note: null`), fixture group **F42**
(next free number), release **v1.26.0**, committed in Polish.

## Locked decisions

- **`note` lives on the entry**, `null` when absent. Ingest normalizes in
  `applyCheckIn`: trim, empty → `null`, hard-truncate to 200 chars. The UI
  textarea carries `maxlength="200"`; the engine truncation is the backstop.
- **Inert in math.** No engine reader looks at `note`; `state.derived` is
  bit-identical with and without notes (fixture-guarded).
- **Escaped at render.** Historia and the check-in prefill go through the local
  `esc()` — a note containing `<b>test</b>` renders as literal text.
- **Schema v6 → v7**: `case 6` migration stamps `note: null` on every entry
  missing the field; `createState` uses `version: 7`; `validateState` rejects a
  non-string, non-null `note` (length is NOT validated — old exports with longer
  notes must not brick an import; the engine truncates on the next edit).
- **CSV gains a `Notatka` column, appended last** (after „Zaktualizowano") —
  appending keeps every existing column index stable (F40 asserts exact bytes)
  and free text belongs at the row's end. Quoted via the existing `csvCell`
  (RFC 4180) — this closes the „add it, quoted, when notes ship" note left by
  the CSV release (task 5.4).
- **No new files** → no `PRECACHE` change; version bump only.

## Steps

1. `js/engine.js` — `applyCheckIn`: normalize `input.note` (trim → null/slice
   200) and store it on the entry; `createState` `version: 7`.
2. `js/storage.js` — `SCHEMA_VERSION = 7`; `migrate` `case 6` stamps
   `note: null` (fall-through `case 7: break`); `validateState` type-checks
   `note`; `entriesCSV` appends the quoted `Notatka` column.
3. `js/ui.js` — `renderCheckin`: `<textarea id="ci-note" maxlength="200">` with
   prefill on edit; `#ci-save` passes the raw value to `applyCheckIn`.
   `renderHistory`: note shown as a muted line inside the month's row.
4. `styles.css` — add `textarea` to the shared input selector block.
5. Tests — **F42**: note ingest (trim/truncate/null/edit), derived-invariance,
   migration v6→v7 (missing field → `null`, existing note survives, v1 chain
   ends at 7, newer version rejected), `validateState` type check; extend
   **F40** for the `Notatka` column (header bytes, quoting, field count).
   Version literals in F11/F33/F41 move to `S.SCHEMA_VERSION` so future bumps
   stop rewriting them.
6. Release **v1.26.0** (three places), `node tests/run-tests.js` green,
   `/FIRE/` subpath rehearsal, Polish commit.
