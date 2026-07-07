# Master Plan — FIRE Companion feature wave (target release v1.14.0)

Orchestration (project-manager session, 2026-07-06):
**1 audit agent + 6 plan agents (parallel) → 6 implementation agents (sequential) → 1 code-review/security/release agent.**
Plans live in `plans/`, maintenance docs in `docs/features/`, audit report in `docs/audit-calculations.md`.

## Priorities (from the user)
1. **Most important:** verify every calculation in the app is correct (audit batch).
2. **Second:** rewrite calculation descriptions for finance-interested non-mathematicians (batch F).
3. Implement the feature batches below.
4. Then navigation/IA cleanup (batch F, after all features exist).
5. Lastly code review + vulnerability scan, then release.

## Batches

| Batch | Plan file | Contents |
|---|---|---|
| Audit | (report only: `docs/audit-calculations.md`) | Re-derive and verify every engine/format calculation vs Excel fixtures; fix bugs + regression tests |
| A | `plans/A-retirement-projection.md` | Bonds/stable-instrument switch at retirement, expense-growth freeze at retirement, ZUS/pension bridge, Barista FIRE, sequence-of-returns stress test, percentile bands on projection chart |
| B | `plans/B-taxes.md` | Belka 19% toggle (nominal cost-basis tracking), IKE/IKZE buckets + IKZE PIT refund |
| C | `plans/C-persisted-features.md` | Planned one-off events (persisted, migration), 2 scenario snapshots in Symulacja, check-in notes |
| E | `plans/E-reports-engagement.md` | Milestones + celebration, annual report „Twój rok FIRE", CSV export (BOM/semicolon/decimal-comma), backup nudge + .bak restore |
| D | `plans/D-chart-ux.md` | Fullscreen landscape charts, tap-to-inspect tooltips, savings-rate history chart |
| F | `plans/F-copy-and-navigation.md` | Rewrite all calculation descriptions (PL, non-experts), navigation/IA cleanup |

## Implementation order & rationale

**A → B → C → E → D → F**

- A and B both rework projection internals in `engine.js` — strictly sequential, A first (B's tax layer sits on A's unified projection params).
- C adds persisted fields (migrations chain sequentially).
- E adds reports/exports on top of C's data (notes column in CSV).
- D last of the chart work so tooltips/fullscreen cover every chart added by A–E (incl. E's report and its own savings-rate chart).
- F absolutely last: copy sweep + IA reorg must cover all new screens.

## Conventions binding every implementation agent

- Obey `CLAUDE.md`: layering (math → `engine.js`, markup → pure builders, DOM/state → `ui.js` only), real-vs-nominal, `YYYY-MM` month indices, Polish UI copy, English docs.
- `node tests/run-tests.js` must be green after each batch; engine changes require new fixtures.
- Any **new file** → add to `PRECACHE` in `sw.js` immediately.
- **No version bumps** mid-wave; the final release agent bumps to v1.14.0 in the three places.
- **No commits** — everything stays in the working tree; the user decides when to commit.
- Each batch writes short maintenance docs to `docs/features/<batch>.md` and appends one line to `docs/INDEX.md`.

## Final step (review/release agent)

Review the entire working-tree diff for correctness + security (XSS via unescaped user text, CSV injection, PRECACHE completeness, layering violations), fix criticals, bump v1.14.0 (sw.js `CACHE`, index.html footer, `ui.js` `APP_VERSION`), final test run, report in `docs/code-review.md`.
