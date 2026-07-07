# Backup nudge toast + one-tap `.bak` restore

## Context

The app's data lives only in `localStorage`; the JSON export is the user's only
insurance. Today the app reminds about stale exports in exactly one place: the
**Kopia zapasowa** screen itself shows a warning banner when `state.ui.lastExportAt`
is missing or older than 61 days (`js/ui.js:1957`, inline date math). That is a
reminder you only see if you already went where the reminder would send you.

The `.bak` safety copy (`fireApp.bak`, written before **every** save —
`js/storage.js:103`) is likewise used in exactly one place: automatic recovery
when the main key fails to parse at load (`js/storage.js:92`, surfaced by the
sticky toast in `js/app.js:14`). There is no way for the *user* to reach it — yet
"undo my last write" is exactly what you want after a fat-fingered entry delete,
a bad correction, or an import you regret.

This feature adds two small things:

1. **Backup nudge** — a gentle toast on the dashboard when the last export is
   older than ~2 months; tapping it jumps to `#/backup`.
2. **One-tap `.bak` restore** — a new card on the Kopia zapasowa screen that
   previews what the `.bak` copy holds and restores it with a single tap.

No engine math changes, no new files, no schema bump. Logic goes to `storage.js`
(L0, Node-tested); glue and markup stay in `ui.js`.

## Locked decisions

- **D1 — The staleness rule is a pure function in `storage.js`.**
  `export const EXPORT_STALE_MS = 61 * 24 * 3600 * 1000;` and
  `export function backupOverdue(state, nowMs = Date.now())` →
  `nowMs − Date.parse(state.ui.lastExportAt || state.createdAt) > EXPORT_STALE_MS`.
  `storage.js` is the backup-domain leaf module and already runs in the Node
  suite; putting the rule there makes the threshold testable and gives the
  existing Kopia zapasowa banner and the new toast a single source of truth.
  Details:
  - **Never-exported fallback**: `lastExportAt == null` falls back to
    `createdAt` (a full ISO timestamp, `js/engine.js:1415`) — a brand-new user
    is *not* nudged on day one; the nudge starts 61 days after they started
    using the app.
  - **Defensive on garbage**: if the chosen date fails `Date.parse` (NaN), the
    comparison is false → no nudge. Never nag on unreadable data.
  - Dates here are real timestamps, not `"YYYY-MM"` months — the
    `ymToIdx`-only invariant does not apply; `Date.parse` on ISO strings is fine.
- **D2 — Nudge fires from `renderDashboard`, not `startApp`.** The dashboard is
  the screen every session starts on and the only place the toast makes sense;
  triggering there automatically skips onboarding (`state == null`), the corrupt
  screen, and deep links into other tabs. Conditions, all required:
  `state.entries.length > 0` (nothing worth backing up otherwise) **and**
  `backupOverdue(state)` **and** the `#toast` element is currently hidden
  **and** the session flag (D3) is unset.
- **D3 — Once per session via a module flag; no persisted snooze.**
  `let backupNudgeShown = false` next to `resetArmed` (`js/ui.js:18`), set when
  the toast is shown. A persisted snooze (`ui.backupNudgeSnoozedAt`) was
  considered and **rejected**: it would force `SCHEMA_VERSION` 5 plus a
  migration step for zero real gain — the app is opened roughly monthly for the
  check-in, so "once per app open" already *is* a gentle cadence.
- **D4 — The nudge never clobbers a more important toast.** There is a single
  `#toast` element and a later `toast()` call overwrites it (`js/ui.js:36`). The
  `.bak`-recovery warning (`js/app.js:14`) and the quota error (`js/ui.js:32`)
  are sticky/urgent and may already be visible when the dashboard renders — if
  `#toast` is not hidden, skip the nudge **without setting the flag** (it may
  fire on a later dashboard visit this session). The SW "new version" toast
  arriving *later* will overwrite the nudge — acceptable; updates win.
- **D5 — `loadBak()` joins `makeStorage`; restore is just `save(bakState)`.**
  `loadBak()` mirrors `load()`: parse + `validateState` + `migrate` on the `BAK`
  key, returning `{ state } | { none: true } | { corrupt: true, error }`. No
  separate `restoreBak()` mutation is needed, because `save()` already copies
  the current main key into `.bak` before writing (`js/storage.js:105`) —
  restoring via `save(loadBak().state)` therefore **swaps** KEY ↔ BAK.
- **D6 — One tap, no confirm dialog.** The KEY ↔ BAK swap makes restore its own
  undo: tapping the button again swaps straight back. That reversibility is what
  justifies skipping the `confirm()` that guards import (`js/ui.js:2054`) and
  the armed two-tap that guards reset (`js/ui.js:2068`). The card shows a
  preview (entry count, month range, side-by-side with the current state) so
  the user can judge *before* tapping, and the post-restore toast says how to
  undo. Known residual risk, accepted: any *other* save between the two taps
  (e.g. editing a check-in) moves the `.bak` point and the original state is
  gone — the toast wording nudges the user to undo immediately if it was a
  mistake. **Fallback** if this feels hot during QA: reuse the `resetArmed`
  6-second armed pattern.
- **D7 — The existing banner refactors onto the shared predicate.** The inline
  61-day math at `js/ui.js:1957` becomes
  `!last || backupOverdue(state)` — keeping the banner's current
  "never exported → warn immediately" behavior (on the backup screen that
  immediacy is right; the user is already there), while the *toast* uses the
  gentler `createdAt` fallback from D1.
- **D8 — All new copy is Polish, inline in `ui.js`** like every other toast and
  screen string (`coach.js` is for check-in coaching messages, not chrome).

## Step 1 — `js/storage.js`

Two additions, both covered by F30:

```js
// ── Przypomnienie o kopii ───────────────────────────────────────────────
export const EXPORT_STALE_MS = 61 * 24 * 3600 * 1000;   // ~2 miesiące

export function backupOverdue(state, nowMs = Date.now()) {
  const ref = Date.parse(state.ui.lastExportAt || state.createdAt);
  if (!Number.isFinite(ref)) return false;
  return nowMs - ref > EXPORT_STALE_MS;
}
```

Inside `makeStorage(backing)`, next to `load()`:

```js
// → { state } | { none: true } | { corrupt: true, error }
loadBak() {
  const raw = backing.getItem(BAK);
  if (raw == null) return { none: true };
  try {
    return { state: migrate(validateState(JSON.parse(raw))) };
  } catch (err) {
    return { corrupt: true, error: String(err && err.message || err) };
  }
},
```

Notes:

- `loadBak` runs the same `validateState → migrate` chain as `load()`, so a
  `.bak` written by an older schema restores correctly, and a `.bak` from a
  *newer* version is rejected with the existing Polish error.
- `.bak` content never contains `derived` (already stripped by `save`), so the
  restored state is safe to hand to `recomputeDerived` as-is.

## Step 2 — tests (new fixture group **F30**, `tests/test-engine.js`)

All storage-level, memory backing, injectable `nowMs` — no DOM needed:

1. **F30a `backupOverdue`** — with a fixed `now`: fresh `createdAt`, no export
   → `false`; `createdAt` 62 days back, no export → `true`; `lastExportAt`
   60 days back → `false`; 62 days back → `true`; recent `lastExportAt` wins
   over an old `createdAt`; unparseable date → `false`; exactly 61 days →
   `false` (strict `>`).
2. **F30b `loadBak` shapes** — fresh backing → `{ none: true }`; after two
   `save()`s → `.state` deep-equals the *first* saved state (JSON compare) and
   has no `derived` key; garbage in `BAK` → `{ corrupt: true }` with a message.
3. **F30c restore is a KEY ↔ BAK swap** — save A, save B; "restore" =
   `save(loadBak().state)` → now `load()` yields A and `loadBak()` yields B;
   restore again → back to B / A. This is the invariant D6 leans on — if
   `save()` ever stops pre-copying to `.bak`, this test is the tripwire.
4. **F30d `loadBak` migrates** — plant a v1-shaped state JSON in `BAK` (reuse
   the existing migration fixture) → `loadBak().state.version === SCHEMA_VERSION`
   with the v2–v4 defaults filled in.

## Step 3 — `js/ui.js`: the nudge

Module scope, next to `resetArmed`:

```js
let backupNudgeShown = false;   // raz na sesję (D3)
```

At the top of `renderDashboard` (`js/ui.js:621`), after the derived reads:

```js
if (!backupNudgeShown && state.entries.length > 0 && backupOverdue(state)
    && document.getElementById('toast').hidden) {
  backupNudgeShown = true;
  toast('💾 Dawno nie było kopii zapasowej — dotknij, aby ją wyeksportować.',
        8000, () => { location.hash = '#/backup'; });
}
```

`ui.js` already imports from `./storage.js` (the `storage` instance plus
`exportJSON`/`importPreview`); the import list gains `backupOverdue`. Layering
is untouched — `ui.js` (L4) importing from `storage.js` (L0) is the existing
edge.

Refactor per D7: `js/ui.js:1957` becomes
`const nudge = !last || backupOverdue(state);` and the 61-day literal leaves
`ui.js` entirely.

## Step 4 — `js/ui.js`: the restore card

New card in `renderBackup`, between **Import** and **Instalacja na Androidzie**:

```html
<div class="card"><h2>Kopia awaryjna</h2>
  <p class="muted small">Przed każdym zapisem aplikacja odkłada poprzedni stan do
  kopii awaryjnej. Przywrócenie cofa <b>ostatnią</b> zmianę — a ponowne dotknięcie
  przywraca z powrotem.</p>
  <!-- one of: -->
  <p class="muted small">Brak kopii awaryjnej — pojawi się po pierwszym zapisie.</p>
  <div class="field-error">Kopia awaryjna jest nieczytelna.</div>
  <!-- or preview + button: -->
  <table class="preview">
    <tr><td>Wpisów w kopii</td><td>N (obecnie: M)</td></tr>
    <tr><td>Zakres</td><td>styczeń 2025 – czerwiec 2026</td></tr>
  </table>
  <button id="bk-bak-restore" class="wide">↩️ Przywróć stan sprzed ostatniego zapisu</button>
</div>
```

Renderer logic: call `storage.loadBak()` once at the top of `renderBackup`;
branch the card body on `none` / `corrupt` / `state`. The preview rows are
computed inline from `bak.state.entries` exactly the way `importPreview` does
(count + sorted month range via `Fmt.formatMonthName`) — no new storage helper
needed for two lines of array math. The "obecnie: M" comparison against
`state.entries.length` is what lets the user sanity-check a one-tap action.

Handler:

```js
const bkRestore = $('#bk-bak-restore');
if (bkRestore) bkRestore.addEventListener('click', () => {
  const r = storage.loadBak();
  if (!r.state) { renderBackup(); return; }   // kopia zniknęła/padła w międzyczasie
  state = r.state;
  E.recomputeDerived(state);
  persist();                                   // swap: obecny stan ląduje w .bak (D5/D6)
  applyTheme();                                // motyw mógł się różnić — jak przy imporcie
  renderBackup();                              // zostajemy na ekranie; podgląd pokazuje zamianę
  toast('Przywrócono stan sprzed ostatniego zapisu. Pomyłka? Dotknij „Przywróć” jeszcze raz.');
});
```

Details:

- Re-read `loadBak()` inside the handler (not the render-time copy) — the
  screen may have sat open across other saves.
- Stay on `#/backup` after restoring (unlike import, which navigates home):
  the re-rendered card now previews the *swapped-out* state, which is the
  "tap again to undo" affordance made visible.
- Nothing else is written between `loadBak` and `persist`, which is what keeps
  the swap exact (F30c).
- Fresh installs simply see the "Brak kopii awaryjnej" line — `fireApp.bak`
  first appears on the second-ever save.

## Step 5 — release

1. No new files → `PRECACHE` list in `sw.js` unchanged; still bump
   `const CACHE` so the changed `ui.js`/`storage.js` re-cache.
2. Version bump in the usual three places (`sw.js`, `index.html` footer,
   `APP_VERSION` in `js/ui.js`). Target **v1.17.0** — if another planned
   feature lands first, take the next free minor.
3. `node tests/run-tests.js` green (141 + the 4 F30 tests = 145).
4. Subpath rehearsal (`cd .. && python -m http.server 8000` →
   `http://localhost:8000/fire/`).
5. While developing: unregister the SW / "Update on reload", or you'll test the
   stale cache.
6. Commit (Polish), e.g.
   `feat: przypomnienie o kopii zapasowej + przywracanie z kopii awaryjnej (v1.17.0)`.

## Step 6 — docs

- **CLAUDE.md**: extend the `storage.js` bullet with `loadBak` +
  `backupOverdue`; append the F30 sentence to the Tests section; update the
  test count in the Commands section (141 → 145).
- No changes to `plan-implementation-of-the-wild-frost.md` (no engine/schema
  impact).

## Manual QA checklist (DOM paths have no Node coverage)

In DevTools (Application → Local Storage) and on the phone:

- [ ] Edit `fireApp` → set `ui.lastExportAt` ~3 months back → reload → toast
      appears once on the dashboard; tapping it lands on `#/backup` where the
      banner is also showing; navigating Pulpit ↔ Historia does **not** re-show
      the toast this session.
- [ ] Export from `#/backup` → banner gone; reload → no toast.
- [ ] Fresh profile (recent `createdAt`, never exported) → no toast; state with
      stale `lastExportAt` but **zero** entries → no toast.
- [ ] Collision: corrupt the `fireApp` value (keep `.bak` valid) → reload → the
      sticky "przywrócono dane z kopii awaryjnej" toast shows and the nudge does
      **not** overwrite it.
- [ ] Restore card: fresh install → "Brak kopii awaryjnej"; after a check-in
      save → preview shows counts/range; garbage in `fireApp.bak` → the
      unreadable-copy error, no button.
- [ ] One-tap round trip: delete an entry (Historia), go to `#/backup`, tap
      Przywróć → entry is back everywhere (Pulpit/Historia recompute); tap
      Przywróć again → deletion is back. Preview numbers swap on each tap.
- [ ] Restore with a different `ui.theme` in `.bak` → theme applies immediately.
- [ ] Dark and light theme; subpath rehearsal serve: nudge + restore once more
      under `/fire/`.

## Out of scope (explicitly not in v1)

- Multi-level undo / snapshot history — `.bak` is one step deep by design;
  deeper history would grow `localStorage` against the quota that `.bak`
  already presses on.
- A persisted nudge snooze or configurable threshold (rejected, D3).
- Auto-export / File System Access API / Web Share of the backup file —
  separate feature with its own permission and offline questions.
- Nudging anywhere other than the dashboard (e.g. blocking the check-in flow) —
  the nudge stays gentle by construction.
