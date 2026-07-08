## Context

The confirmed findings come from an empirical audit (probes in the session scratchpad, each comparing engine output to an independently computed value). The core engine math is correct; the defects are at the parse/format/display boundary and in the JSON-import path that bypasses UI validation. Constraints from `CLAUDE.md` that shape the fixes:

- **No build step, no deps, offline PWA.** Fixes are hand-edited ES modules; no tooling added.
- **Layering:** logic that can be tested in Node lives in `engine.js`/`format.js`/`storage.js`/`charts.js`; only `ui.js` touches the DOM. `ringSVG` and the FI% call sites live in `ui.js` and stay there.
- **Manual NBSP formatting, byte-identical Node/browser output** — no `Intl`.
- **Derived state is replay-only; schema is not bumped** — these are read/parse-time guards, so no migration.
- **Money in real PLN, `,` decimal**; tests are the type system, so every behavioural fix ships with a Node test.

## Goals / Non-Goals

**Goals:**
- Correct `parsePLN` for Polish grouping/decimal input; make ambiguous input `null`, never a wrong magnitude.
- Remove the `-0 zł` and `formatPct(x,0)` formatting artifacts.
- Guard FI% and `ringSVG` so a zero target / `NaN` never yields a false "reached" or broken SVG.
- Harden `validateState` so the import path enforces the invariants the UI already enforces (no negative taxable bucket, no `≤ −100%` rates, `withdrawalRate > 0`).
- Clamp negative chart values into the viewBox and make decimation min/max-preserving.
- Backfill tests for `deleteEntry` and `contributionsVsGrowth`; assert IKE/IKZE limit constants; tighten `eps = 1` tolerances where the fixture is precise.

**Non-Goals:**
- No change to core engine math (annuities, replay, projection, Belka/IKE/IKZE, withdrawal) — all reconciled clean.
- No fixes for **refuted** suspects (swrComparison ÷0 throws cleanly; loan `===0`/window boundary; analysis.js:213 re-derivation is algebraically exact).
- Not sourcing/committing `Kalkulator_FIRE.xlsx` — tracked as an open question.
- No schema bump / migration.

## Decisions

### D1 — `parsePLN`: locale-aware tokenizer, ambiguous → `null`
Replace the `.replace(',', '.')` one-shot with an explicit rule: strip currency and spaces/NBSP; treat the **comma** as the decimal point (at most one); treat **dots** as grouping separators **only** when they partition the integer part into 3-digit groups; otherwise return `null`.
- `"1.000"` → `1000`; `"1.234,56"` → `1234.56`; `"1 234,56"` → `1234.56`; `"1,5"` → `1.5`; `"1,2,3"`/`"1.0.0"` → `null`.
- **Alternative considered:** swap in `Intl.NumberFormat` parsing — rejected: `Intl` varies by runtime/ICU and would break the byte-identical Node/browser guarantee the tests assert.
- **Alternative considered:** strip all dots unconditionally — rejected: `"1.5"` typed by a user with a numpad would silently become `15`. Keeping the comma canonical and validating dot-grouping is safer and matches the pl-PL convention.

### D2 — `formatPLN`: decide the sign after rounding
Compute `neg` from the **rounded** value at the target precision, not the raw input: `const rounded = Number(v.toFixed(decimals)); const neg = rounded > 0 && x < 0;` (or equivalently zero-out `-0`). A value that rounds to `0` displays `"0 zł"`. Genuine negatives keep the sign.

### D3 — `formatPct`: only strip fractional zeros
Guard the trailing-zero strip so it never runs on the integer part: apply the `/0+$/` strip **only when a decimal separator is present** (i.e. `maxDecimals > 0` and the string contains `.`). At `maxDecimals = 0` return the integer string untouched. There is no live `maxDecimals=0` caller today, so this is a latent-trap fix with no behavioural change to current call sites.

### D4 — FI% guard: helper, not inline division
Add a small pure helper (e.g. `fiPercent(portfolio, target)`) used by all three `ui.js` call sites (~575/704/808): returns `null`/`0` when `target <= 0`, else `portfolio / target`. "FIRE reached" checks `target > 0 && portfolio >= target` so a zero target is never trivially "met". Single helper avoids the current triplicated expression.

### D5 — `ringSVG`: clamp percent to finite `[0,1]` for geometry
At the top of `ringSVG`, coerce: `const p = Number.isFinite(pct) ? Math.max(0, Math.min(1, pct)) : 0;` use `p` for the dasharray; the **label** derives from the clamped/again-guarded value so `NaN`→`"0,0%"`. This keeps a valid arc for `Infinity`/`NaN`/negative input.

### D6 — `validateState`: reject over-import (fail closed)
Add checks in `storage.js` `validateState`: (a) `ikeStart + ikzeStart <= portfolioStart`; (b) each rate field within its documented range and `> -1`; (c) `withdrawalRate > 0`. On violation, **reject** the import (surface the existing Polish error toast path) rather than clamp — the imported file is user-authored and a hard reject is clearer than silently mutating their numbers. `makeTaxTracker` gets no change (the invariant is enforced upstream), keeping the engine untouched.
- **Alternative considered:** clamp buckets / rates on import — rejected as surprising; a bad import should be reported, not silently corrected. (If reject proves too strict in practice, clamping is a fast follow.)

### D7 — `charts.js`: clamp range and preserve extremes
Line/bar y-mapping computes the domain from the full (pre-decimation) series and clamps mapped values into `[padT, height-padB]`; negative values map to the bottom band instead of a large off-canvas `y`. Decimation keeps the last row (as today) **and** ensures the domain min/max come from the full series, so an interior spike still sets the scale.

### D8 — Tests ride with each fix
Every code fix above adds a Node case in `tests/test-engine.js` (or a format test file) asserting the corrected behaviour, plus the two coverage backfills (`deleteEntry` inverse across positions; `contributionsVsGrowth` conservation) and the constant-import assertion for IKE/IKZE limits. Tighten F17 `eps` from `1` → `0.01` and confirm green.

## Risks / Trade-offs

- **[D1 parser regression on an untested string form]** → Add an exhaustive parse table (the audit's table plus edge forms) as the first test; run full suite before/after.
- **[D6 hard-reject breaks a previously-importable (but invalid) backup]** → Only states that were already producing `NaN`/negative buckets are rejected; those were silently broken anyway. Error message names the offending field.
- **[D4/D5 changing "reached" semantics]** → A zero target only arises from degenerate onboarding (living expenses 0); guarding it cannot regress any realistic user, and existing "reached" tests use positive targets.
- **[D7 chart visual shift]** → Only affects series with negatives or >`maxPoints` rows with an off-stride peak; default-path output for normal (monotone, ≤maxPoints) series must stay byte-identical — assert this (mirrors the existing F29 parity guard).
- **[Release/cache]** → `js/*` change requires the standard version bump + `PRECACHE`/cache-name update; easy to forget. Called out in tasks.

## Migration Plan

No data migration — no `SCHEMA_VERSION` bump. Deploy is the standard release: bump version in the three places, update `sw.js` cache name, run `node tests/run-tests.js` green, do the `/FIRE/` subpath rehearsal, commit (Polish message), push. Rollback = revert the commit; no persisted-state change means old and new binaries read the same `localStorage`.

## Open Questions

- **`Kalkulator_FIRE.xlsx` provenance:** the cited spec source is absent from the repo, so Excel-parity literals (F1/F13/F17…) cannot be re-derived. Should the xlsx be committed (or its derivation scripted) so the "spec" is versioned? Out of scope for this change; flagged for the user.
- **D6 reject vs clamp:** confirm hard-reject is the desired UX for a malformed import, or whether clamping-with-warning is preferred.
- Should the negative-chart clamp (D7) also apply to the fullscreen-landscape overlay path, or is that covered by the shared builder? (Expected: shared builder covers both.)
