## Why

A full calculation-correctness audit of the finance core (six parallel deep-audit passes, every claim backed by a runnable Node probe against an independently computed expected value) confirmed a small set of real defects and refuted the rest. The confirmed defects are **not** in the core money math — annuities, the two-bucket replay, projections, Belka/IKE/IKZE taxes and the withdrawal phase all reconcile to the grosz. They live at the **edges**: input parsing, display formatting, division-by-zero guards, and the JSON-import validation path that bypasses the UI's own guards. Two of them (dot-grouped money input, a zero FIRE target) are reachable through normal onboarding and silently produce a wrong number or a broken dashboard. This change fixes the confirmed findings and closes the test gaps that let them ship.

## What Changes

- **Money parsing (`parsePLN`)** — `"1.000"` currently parses to `1` instead of `1000` (a dot is treated as a decimal point, and only the first comma is normalised). Parsing becomes locale-correct for Polish input: `,` is the decimal separator, `.`/NBSP/space are thousands separators, and genuinely ambiguous strings return `null` (surfaced as a field error) instead of a silently wrong value.
- **Number formatting** — `formatPLN` no longer emits a spurious `"-0 zł"` for values that round to zero at the displayed precision; `formatPct(x, 0)` no longer strips zeros from the integer part (`10% → "1%"`).
- **FIRE-progress display guards (`ui.js`, `ringSVG`)** — FI% (`portfolio / target`) is guarded against a zero target: no false "FIRE reached" from `Infinity`, no `NaN%` label or `dasharray="NaN …"` in the progress ring.
- **Import validation (`validateState`)** — the JSON-import path is hardened to reject (or clamp) the states the UI already forbids but storage silently accepts: `ikeStart + ikzeStart > portfolioStart` (which produces a negative taxable bucket and understated net worth) and economically impossible rates `≤ −100%` (which poison derived state with `NaN`/`Infinity`).
- **Chart rendering (`charts.js`)** — negative series are clamped into the viewBox instead of rendering off-canvas, and `maxPoints` decimation preserves the global min/max instead of dropping an interior spike from the y-scale.
- **Test coverage** — add coverage for the two UI-reachable engine functions that currently have **zero** tests (`deleteEntry`, `contributionsVsGrowth`), assert the IKE/IKZE limit **constants** (instead of duplicating them as fixture literals), and tighten the loose `eps = 1 zł` tolerances (F17) where the fixture supports it.

No change to the core engine math, the persisted schema shape, or any locked design decision. All fixes are additive guards, parser corrections, and tests.

## Capabilities

### New Capabilities
- `money-formatting-parsing`: Correct, locale-aware parsing and formatting of PLN amounts and percentages (`parsePLN`, `formatPLN`, `formatPct`) — the boundary between user text and the numeric engine.
- `state-import-validation`: Range and cross-field validation of imported JSON state so the import path enforces the same invariants as the UI, rejecting states that would produce `NaN`/`Infinity`/negative buckets.
- `fire-progress-display`: Safe rendering of the FIRE-progress ratio and progress ring for degenerate inputs (zero target, zero/negative portfolio) so the dashboard never shows a false "reached" or a broken ring.
- `chart-rendering`: Robust SVG chart scaling for negative and decimated series (viewBox clamping, min/max-preserving decimation).
- `calculation-test-coverage`: Regression coverage for previously untested UI-reachable engine functions and constant-backed assertions for tax limits.

### Modified Capabilities
<!-- No existing specs under openspec/specs/; all capabilities are new. -->

## Impact

- **Code**: `js/format.js` (`parsePLN`, `formatPLN`, `formatPct`), `js/storage.js` (`validateState`), `js/ui.js` (FI% call sites ~575/704/808, `ringSVG` ~118), `js/charts.js` (line/bar scaling + decimation), `js/engine.js` (optional defensive clamp in `makeTaxTracker` only if validation is chosen to clamp rather than reject).
- **Tests**: new cases in `tests/test-engine.js` (`deleteEntry`, `contributionsVsGrowth`, tax-limit constants), tolerance tightening in `tests/fixtures.js`; format/validation behaviour covered by new Node cases.
- **Schema / data**: none — no `SCHEMA_VERSION` bump, no migration; guards are read/parse-time only.
- **Release**: user-facing copy is Polish; a version bump + `PRECACHE`/cache update follows the standard release checklist since `js/*` files change.
- **Out of scope**: refuted suspects (swrComparison ÷0, loan `===0`/window boundary, analysis.js:213 re-derivation, Belka/IKE math) — documented as refuted, no code change. The absent `Kalkulator_FIRE.xlsx` provenance risk is noted as an open question, not fixed here.
