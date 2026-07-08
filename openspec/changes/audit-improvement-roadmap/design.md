## Context

FIRE Companion is an offline, dependency-free PWA (v1.17.0) with a pure, unit-tested
`engine.js`, pure HTML builders (`analysis.js`/`simulation.js`/`motivation.js`), and DOM +
state confined to `ui.js`. The module layering (L0 pure leaves → L4 `ui.js`) is the core
constraint that keeps the money math testable in Node. This change is a **roadmap
container**: five workstreams the owner wants sequenced as independent, release-by-release
increments. Each release follows the repo checklist (3-place version bump, new files into
`sw.js` PRECACHE, `node tests/run-tests.js` green, `/FIRE/` subpath rehearsal). The design
below records the technical decisions that span phases; per-phase feature docs in `docs/`
carry the finer detail.

## Goals / Non-Goals

**Goals:**
- Rewrite calculation explanations into plain Polish without changing any engine output.
- Add a glossary screen and route without breaking the hash router or SW navigation rules.
- Restructure Symulacja navigation and fix the ranked UX/accessibility issues.
- Harden import/boot robustness and add CSP + an offline-safe force-update — all low-risk.
- Land the two chosen feature bundles (habit/motivation, deeper analysis) from ready docs,
  each as its own release, with correct schema-version sequencing.
- Preserve the offline guarantee, the one-way layering, and the "derived state is never
  persisted" invariant throughout.

**Non-Goals:**
- No new runtime dependencies, no build step, no framework, no CDN/fonts/network calls.
- No backlog items (ZUS bridge, IKE/IKZE, Barista, scenario snapshots, passphrase
  encryption, dashboard backup-nudge) — explicitly deferred by the owner.
- No engine math changes in Phases 1–3 (copy/UX/hardening only); math changes are confined
  to Phase 5 features that ship with their own fixtures.
- Not shipping all five phases at once — this document is the plan; each phase is a separate
  future release.

## Decisions

**One roadmap change, five capability specs, phased releases.** Rather than five separate
OpenSpec changes, this is a single change whose specs enumerate the target behavior per
capability; implementation lands phase by phase. Alternative (one change per phase) was
rejected because the owner asked for a single audit-and-roadmap deliverable and the phases
share release mechanics and invariants.

**Explanations: new `.howto` style, `.formula` retained only for the optional formula
line.** Keeps the one-monospace-line escape hatch for the curious while making the default
read as prose. Alternative (restyle `.formula` itself) was rejected because a genuine
formula line still benefits from monospace; splitting the styles keeps both readable.

**Glossary as a pure L2 builder (`js/glossary.js`) with two routes.** `#/slowniczek` renders
the list; `#/slowniczek/:term` scrolls/highlights an entry — a `:term` path segment is used
because a second `#` inside the hash cannot work with the hash router. `activeRoute()` maps
both to the Plan tab, mirroring `#/backup`. The file must be added to PRECACHE.

**Symulacja hub reuses the `.hub` pattern.** `#/symulacja/:calc` mirrors `#/plan/:section`
with a `← Symulacja` back button; module-scope input state is retained so values survive
navigation. `activeRoute()` already maps `#/symulacja/*` via `slice(0,2)`, so only `route()`
changes. Drop `symTab` and `.seg-scroll`.

**`confirmModal(text, onYes)` on top of `showModal()`.** Centralizes the 5 native
`confirm()` sites into one app-consistent modal with Escape/backdrop close.

**Hardening is defensive and reversible.** Deep `validateState` rejects with the existing
Polish error pattern; guarded recompute preserves prior state on import and falls to
`renderCorrupt` on boot; CSP is a `<meta>` tag (GitHub Pages can't set headers) with
`style-src 'unsafe-inline'` because the app uses inline `style="…"` attributes but no inline
scripts; the force-update probes `fetch('./manifest.webmanifest', {cache:'no-store'})`
(more reliable than `navigator.onLine`) before clearing caches.

**Schema-version sequencing is explicit.** Belka already took v5. Check-in notes rebase to
**v6** (`case 5` migration stamping `note: null`); milestones bump again to the then-current
version. Each bump needs a `createState` default, a `validateState` check if load-critical,
a `migrate` step, and a renumbered fixture group. Fixture numbers are assigned at
implementation time (next free F-number) to avoid collisions across phases.

**Tests follow the existing discipline.** Copy-only (Phase 1) and pure-UX (Phase 2) phases
add no engine fixtures — F-fixtures assert engine/storage output, not builder HTML. Phase 3
extends the storage/migration fixture group. Phase 4/5 features add fixtures per their docs
(notes migration, milestone status, stress-test math, CSV row shape).

## Risks / Trade-offs

- **CSP breaks an asset under the subpath** → mitigate with the mandatory `/FIRE/` subpath
  rehearsal in Phase 3 verification; `style-src 'unsafe-inline'` is included precisely
  because inline `style` attributes exist.
- **Schema renumbering drift** (notes doc still says v5) → the proposal and this design pin
  the rebase to v6; the first task of Phase 4 is the rebase before any code.
- **Glossary/route regressions hijack SW navigation** → keep the SW `navigate` handler's
  cache→network→`index.html` fallback so `tests/tests.html` and `tools/*` still load; verify
  in the SW-update step.
- **Explanation rewrite silently changes a card's numbers** → forbidden; the rewrite is
  copy-only and the green test suite (unchanged fixtures) is the guard.
- **Milestone celebration double-fires** → `milestonesSeen` persisted set gates each
  milestone to one celebration.

## Migration Plan

- Each phase ships as its own release: bump `sw.js` CACHE, `index.html` footer,
  `ui.js` APP_VERSION; add any new file (`js/glossary.js`) to `sw.js` PRECACHE; run
  `node tests/run-tests.js`; do the `/FIRE/` subpath rehearsal; commit (Polish message);
  push. The phone shows the „Dostępna nowa wersja" toast.
- **Data migrations** (Phase 4+): v5 → v6 (notes) then the milestones bump run forward-only
  via the `migrate` chain; `.bak` is written before every save, so rollback is restoring a
  prior export/`.bak`. No destructive migration — new fields default to `null`/empty.
- **Rollback**: because every release is static files, reverting the commit and re-deploying
  restores the prior version; user data is untouched (migrations only add nullable fields).

## Open Questions

- Exact F-fixture numbers for Phase 4/5 groups — assigned at implementation time to the next
  free number; not decidable now without knowing intervening releases.
- Milestone thresholds copy and celebration variants — to be finalized against
  `docs/plan-milestones-celebration.md` during that release.
- Whether the annual report links directly to per-month notes or only summarizes them —
  decided during the Phase 4 annual-report release.
