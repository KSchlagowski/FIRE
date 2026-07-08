## Why

A full first-hand audit of FIRE Companion (v1.17.0) — every JS module, `styles.css`,
`index.html`, `sw.js`, and all 18 docs in `docs/` — surfaced three concrete problems the
owner cares about now: the „Jak to liczymy?" calculation explanations read like textbook
margin notes (owner: "made terrible"), Symulacja buries its calculators behind an
off-screen scrolling tab strip, and several robustness gaps (shallow `validateState`,
unguarded `recomputeDerived`, no CSP, offline-hostile force-update) let a bad import or
mistap degrade the app. No exploitable security vulnerability was found — the app is
offline, dependency-free, has no `eval`/`Function`/external requests, and escapes every
user-influenced string. This change records the audit findings and a sequenced,
release-by-release roadmap so the work can ship in independent, low-risk increments.

## What Changes

- **Explanations rewrite + Słowniczek (Phase 1)**: rewrite all 17 „Jak to liczymy?" blocks
  in `analysis.js`/`simulation.js` into plain-Polish numbered steps with the user's own
  numbers as a worked example; add a new `#/slowniczek` glossary screen (`js/glossary.js`)
  and link jargon terms to it. Add a `.howto` style; keep `.formula` only for the optional
  „Wzór dla dociekliwych" line.
- **UX restructure (Phase 2)**: convert Symulacja from a tab strip into a hub list
  (`#/symulacja/:calc`); enlarge tooltip hit areas to ≥44px; replace 5 native `confirm()`
  calls with an app modal (`confirmModal`); make theme selection apply instantly; a batch
  of accessibility/micro-fixes (empty overpayment fields, scroll-to-error, labeled
  remove-month button, `role="status"`, `aria-current`).
- **Hardening (Phase 3)**: deepen `validateState` (type/finite checks); guard the
  import-apply and boot `recomputeDerived` in try/catch; add a CSP `<meta>` tag; add an
  offline probe before the force-update cache clear.
- **Habit & motivation features (Phase 4)**: check-in notes (rebased to schema v6),
  savings-history chart, milestones with celebration, annual report — each from its ready
  doc in `docs/`, one release each.
- **Deeper analysis features (Phase 5)**: chart tap-to-inspect tooltips, projection band,
  crash stress test, CSV export of entries — one release each.
- Every phase is an independent release following the repo checklist (3-place version
  bump, new files into `PRECACHE`, `node tests/run-tests.js` green, `/FIRE/` subpath
  rehearsal). Engine layering stays intact; all UI copy and commits stay Polish.

## Capabilities

### New Capabilities
- `calculation-explanations`: the plain-Polish rewrite pattern for every calculated card
  and the Słowniczek glossary screen with per-term deep links.
- `ux-navigation-and-accessibility`: Symulacja hub navigation, app-modal confirmations,
  instant theme apply, tooltip touch targets, and the accessibility/micro-fix batch.
- `state-hardening`: deep import/boot validation, guarded recompute, CSP, and the
  offline-safe force-update.
- `habit-motivation`: check-in notes, savings-history chart, milestones with celebration,
  and the annual report.
- `deeper-analysis`: chart tap-to-inspect tooltips, projection band, crash stress test,
  and CSV export of entries.

### Modified Capabilities
<!-- No existing specs in openspec/specs/; all behavior here is captured as new capabilities. -->

## Impact

- **Code**: `js/analysis.js`, `js/simulation.js`, `js/ui.js`, `js/storage.js`,
  `js/engine.js`, `js/charts.js`, `js/coach.js`, new `js/glossary.js`, `styles.css`,
  `index.html`, `sw.js` (`PRECACHE` + CACHE version).
- **Schema**: Phase 4 bumps `SCHEMA_VERSION` (v5 → v6 for check-in notes, then further for
  milestones); each needs a `createState` default, a `migrate` step, and a renumbered
  fixture group. `docs/plan-checkin-notes.md` must be rebased off v5 (already taken by
  Belka).
- **Tests**: `tests/fixtures.js`/`tests/test-engine.js` extended whenever engine/storage
  behavior changes (Excel-derived numbers are the spec); copy-only phases need no new
  fixtures.
- **Release mechanics**: each phase is its own tagged release; new files (`js/glossary.js`)
  must enter the `sw.js` `PRECACHE` list; version bumped in `sw.js`, `index.html`, `ui.js`.
- **No new runtime dependencies, no build step, offline guarantee preserved.**
