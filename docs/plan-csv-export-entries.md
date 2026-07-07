# CSV export of check-in history (`entriesCSV`)

## Context

The Kopia zapasowa screen (`#/backup`, `renderBackup` in `js/ui.js`) offers a single
export today: the full-state JSON backup (`exportJSON` in `js/storage.js`, wired to
`#bk-export`). That file is a *backup* — it round-trips through `importPreview`/
`importJSON` but is useless for ad-hoc analysis: the user who wants to pivot their
check-in history in Excel has to hand-copy numbers out of the Historia screen.

This feature adds a second, **one-way** export next to the JSON button: the check-in
history (`state.entries`) plus the per-month derived context (balances, phase, loan
balances) as a **CSV that opens correctly in Polish Excel**. Nothing about the JSON
backup changes; the CSV is explicitly *not* importable and must not be presented as a
backup.

Ships as a normal standalone release: **v1.17.0, committed in Polish**.

## Locked decisions (do not re-derive)

- **CSV dialect targets Excel pl-PL, not RFC-default readers:**
  - field separator **`;`** — the Polish list separator; a comma-separated file opens
    as one column in Polish Excel;
  - decimal separator **`,`**, always **exactly two decimals**, **no thousands
    grouping** (`1234,56`, `-123,45`, `0,00`). Do **not** reuse `format.js` — its NBSP
    grouping is for display and would break Excel's number parsing. A local
    `csvNum()` helper (`toFixed(2).replace('.', ',')`) is the whole story;
  - **UTF-8 BOM prefix (`'\uFEFF'`)** so Excel decodes Polish diacritics in headers
    and verdict labels;
  - **CRLF (`\r\n`)** row separator, rows joined with no trailing newline;
  - RFC 4180 quoting anyway: any cell containing `;`, `"`, `\r` or `\n` is wrapped in
    `"…"` with inner quotes doubled. Current data never triggers it (months, keys,
    fixed labels), but the injected verdict label is caller-supplied — escape
    defensively and test it.
- **One row per entry**, sorted ascending by month (defensive `[...entries].sort` —
  the `planVsActualStats` idiom — even though `applyCheckIn` keeps the array sorted).
  Months without a check-in are **not** emitted; this is an export of the history,
  not of the replay range.
- **Builder lives in `js/storage.js`**, export section, next to `exportJSON` — it is
  the export/import module and an L0 leaf. To keep it a leaf (imports **nothing**):
  - it must **not** call engine replays itself. Derived per-month context is read
    from **`state.derived`** (attached at runtime by `recomputeDerived`; always
    present in the app after load/mutation). When `state.derived` is absent, the
    derived columns are simply blank — the entry columns never depend on it;
  - join derived data **by `ym` string**, using the `rows` arrays
    (`derived.balances.rows[].ym`, `derived.debt.rows[].ym`,
    `derived.family.rows[].ym`) — **not** the `byMonth` maps, which are keyed by
    integer index and would drag `ymToIdx` (an engine import) into storage;
  - the Polish verdict label comes from an **injected formatter** (the
    `makeStorage(backing)` injection precedent): storage cannot import `coach.js`
    (L1), and `ui.js` already imports `verdictLabel` (line 9).
- **Verdict ships twice**: the raw key (`crushed`/`on_plan`/`behind`/`hard`) as the
  stable, filter-friendly identifier, and the Polish label as the human column.
- **The CSV is not a backup.** Do **not** touch `state.ui.lastExportAt` (the 61-day
  nudge must keep pointing at the JSON export) and do not change the import section.
  The UI copy says so explicitly.
- **Loan balances are nominal** (contract PLN), everything else is real — per the
  repo invariant. The column headers name it („nominalnie") so the sheet can't be
  misread.
- Entries **older than `anchorMonth`** can exist after a forward `reanchor` (history
  is never rewritten); `derived.balances.rows` starts at the anchor, so such rows get
  blank derived columns. This is expected, not a bug — test it.
- **Empty history** → `entriesCSV` still returns a header-only CSV (pure function,
  no opinion); the **UI** short-circuits with a toast instead of downloading a
  header-only file.

## Column layout (header row, in order)

| # | Header | Source | Blank when |
|---|--------|--------|-----------|
| 1 | `Miesiąc` | `e.month` (`YYYY-MM`, sorts as text) | never |
| 2 | `Zarobione` | `e.earned` | never |
| 3 | `Wydane` | `e.spent` | never |
| 4 | `Oszczędności` | `e.earned − e.spent` | never |
| 5 | `Plan oszczędności` | `e.plannedSavingsSnapshot` | never |
| 6 | `Różnica vs plan` | net − snapshot | never |
| 7 | `Werdykt` | `e.verdict` raw key | never |
| 8 | `Werdykt (opis)` | injected `verdictLabel(e.verdict)` | never (falls back to raw key) |
| 9 | `Nadpłata kredytu` | `e.overpayment` | never (0,00) |
| 10 | `Nadpłata długu rodzinnego` | `e.familyOverpayment` | never (0,00) |
| 11 | `Korekta gotówki` | `e.cashOverride` | `null` |
| 12 | `Korekta portfela` | `e.balanceOverride` | `null` |
| 13 | `Gotówka po miesiącu` | balances row `.cash` | no derived / month before anchor |
| 14 | `Portfel po miesiącu` | balances row `.portfolio` | ditto |
| 15 | `Faza` | balances row `.phase` (`saving`/`debt`/`invest` raw key) | ditto |
| 16 | `Kredyt — saldo (nominalnie)` | debt row `.balNominal` | loan not started / no row |
| 17 | `Dług rodzinny — saldo (nominalnie)` | family row `.balNominal` | ditto |
| 18 | `Utworzono` | `e.createdAt` (ISO string, as-is) | never |
| 19 | `Zaktualizowano` | `e.updatedAt` | `null` |

Money cells (2–6, 9–14, 16–17) go through `csvNum`; balances/loan values are raw
replay floats, so `toFixed(2)` is the rounding. Text cells (1, 7, 8, 15, 18, 19) go
through the quoting helper untouched otherwise.

## Step 1 — `js/storage.js`

Append to the `// ── Eksport / import ──` section (after `exportJSON`):

```js
// CSV historii check-inów — eksport jednokierunkowy do analizy (Excel pl-PL):
// średniki, przecinek dziesiętny, BOM, CRLF. To NIE jest kopia zapasowa.
// Kolumny pochodne czytane z state.derived (cache z recomputeDerived) po ym;
// bez derived zostają puste. verdictLabel wstrzykiwany (storage nie importuje coach).
export function entriesCSV(state, { verdictLabel = v => v } = {}) { … }
```

Implementation notes:

1. Local helpers, private to the module: `csvNum(x)` (null/undefined → `''`, else
   `Number(x).toFixed(2).replace('.', ',')`) and `csvCell(s)` (RFC quoting as locked
   above).
2. Build three `Map`s keyed by `ym` from `state.derived?.balances?.rows`,
   `state.derived?.debt?.rows`, `state.derived?.family?.rows` — use the repo idiom
   (`state.derived && state.derived.balances ? … : new Map()`), not optional
   chaining, to match the file's style.
3. Header row exactly as the table above; rows from the sorted entry copy; join all
   lines with `'\r\n'`; prefix `'\uFEFF'`; return the string. No mutation of `state`
   or its arrays (sort a copy).

No changes to `validateState`, `migrate`, `SCHEMA_VERSION`, `exportJSON`, or the
import functions — the persisted schema is untouched, so **no migration**.

## Step 2 — tests (`tests/test-engine.js`, group **F30**; F29 is taken by charts)

Register the group comment in `tests/fixtures.js` header if the file's convention
asks for it (F30 — CSV historii); the expected strings are computed in-test — no
Excel-derived fixture numbers here, the dialect itself is the spec.

- **F30a — exact serialization.** `baseState()` + two `applyCheckIn`s (one plain, one
  with `overpayment`, `familyOverpayment` and both overrides), `recomputeDerived`,
  then assert the **byte-exact** full CSV: leading `\uFEFF`, header row, `;`
  separators, `\r\n` joins, no trailing newline, `1234,56`-style numbers, ISO
  `createdAt`. Assert the derived cells equal
  `state.derived.balances.rows` values re-formatted through the same rounding.
- **F30b — quoting.** Inject `verdictLabel: () => 'W "planie"; test'` → the cell is
  `"W ""planie""; test"` and the row still has exactly 19 fields when split on
  unquoted `;`.
- **F30c — blanks.** `cashOverride`/`balanceOverride` null → empty cells (`;;`);
  strip `state.derived` → columns 13–17 empty but 1–12/18–19 intact; an entry month
  **before** `anchorMonth` (set `anchorMonth` forward after check-in, recompute) →
  that row's 13–15 empty while others are filled; no mortgage (`housePlan.enabled =
  false`) → column 16–17 empty.
- **F30d — sorting + purity.** Feed entries deliberately unsorted (push then don't
  sort) → output ascending by month; `JSON.stringify` of the state (taken after
  `recomputeDerived`) identical before/after the call.
- **F30e — empty history.** `entries: []` → exactly BOM + header row, nothing else.
- **F30f — defaults.** No options object → `Werdykt (opis)` equals the raw key;
  negative net renders `-…`, zero renders `0,00`.

Run `node tests/run-tests.js` — green (currently 141 tests + F30) before any UI work.

## Step 3 — `js/ui.js` glue (`renderBackup`)

1. Extend the storage import (line 10):
   `import { storage, exportJSON, importPreview, entriesCSV } from './storage.js';`
   (`verdictLabel` is already imported from `coach.js`, line 9.)
2. Markup — in the „Kopia zapasowa" card, directly under `#bk-export`:
   ```html
   <button id="bk-export-csv" class="wide">📊 Eksportuj historię (CSV)</button>
   <p class="muted small">CSV służy do analizy (np. w Excelu) — <b>nie jest kopią
   zapasową</b> i nie da się go wczytać z powrotem.</p>
   ```
   JSON keeps the `primary` class and the top spot — it is the safety-critical
   action; CSV is plain `wide`.
3. Handler — mirror of the `#bk-export` closure with three deliberate differences:
   ```js
   $('#bk-export-csv').addEventListener('click', () => {
     if (!state.entries.length) { toast('Brak wpisów — najpierw zrób pierwszy check-in.'); return; }
     const csv = entriesCSV(state, { verdictLabel });
     const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
     const a = document.createElement('a');
     a.href = URL.createObjectURL(blob);
     const d = new Date();
     a.download = `fire-historia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
     a.click();
     URL.revokeObjectURL(a.href);
     toast('Historia pobrana (CSV). Kopią zapasową pozostaje eksport JSON.');
   });
   ```
   Deliberately **no** `state.ui.lastExportAt` update, **no** `persist()`, **no**
   `renderBackup()` re-render — nothing changed.

No engine, coach, analysis, simulation, charts, or SW `fetch`-handler changes.

## Step 4 — release (per CLAUDE.md checklist)

No new app files → **no `PRECACHE` change**. Bump the version in all three places:
`sw.js` `CACHE = 'fire-v1.17.0'`, `index.html` footer `FIRE Companion v1.17.0`,
`js/ui.js` `APP_VERSION = '1.17.0'`. Commit in Polish, e.g.:
`feat: eksport historii check-inów do CSV (Excel) na ekranie „Kopia zapasowa" (v1.17.0)`,
then push.

## Verification

1. `node tests/run-tests.js` → exit 0; all pre-existing numbers untouched (the
   feature adds a function, changes none).
2. App run via preview (`.claude/launch.json` → `fire-app`): `#/backup` shows the
   new button + disclaimer; with zero entries → toast, no download; with history →
   a `fire-historia-YYYY-MM-DD.csv` downloads; JSON export flow and the „Ostatnia
   kopia" date behave exactly as before (CSV export does **not** refresh it).
3. Open the file in **Excel with Polish locale**: columns split on `;`, diacritics
   render (BOM), money cells are numeric (SUM works), `Miesiąc` stays text and sorts
   chronologically, verdict label column reads „Ponad plan!/W planie/…".
   Cross-check one row against the Historia screen. Sanity-open in LibreOffice /
   Google Sheets (both auto-detect `;`).
4. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`) — app loads, download works under the subpath
   (blob URLs are path-independent, but rehearse anyway per checklist).

## Out of scope (record so it isn't re-litigated)

- **CSV import** — the JSON backup remains the only round-trip format; a CSV
  importer would need its own validation/merge semantics.
- **Full replay-range export** (rows for months without check-ins) and derived
  cumulative columns (`cumNet`/`cumPlanned`) — Excel can SUM; revisit only if asked.
- **A locale/dialect switch** (comma-separated, dot-decimal variant) — the app is
  pl-PL by design; YAGNI.
