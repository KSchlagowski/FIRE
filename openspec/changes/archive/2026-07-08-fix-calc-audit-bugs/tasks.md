## 1. Baseline

- [x] 1.1 Confirm `node tests/run-tests.js` is green (162/162) and `git status` is clean before touching code
- [x] 1.2 Add a failing-first Node parse table for `parsePLN` (`"1.000"`, `"1.234,56"`, `"1 234,56"`, `"1234,56"`, `"1,5"`, `"2 500,50"`, `"1,2,3"`, `"1.0.0"`, `"-0,004"`, empty, `"-"`) capturing expected values from the design (D1)

## 2. format.js fixes

- [x] 2.1 Rewrite `parsePLN` (D1): `,` = decimal (≤1), dots = 3-group thousands separators only, ambiguous → `null`; keep grosz rounding and the `number`/non-string guards
- [x] 2.2 Fix `formatPLN` sign (D2): derive `neg` from the value rounded to the shown precision so a value rounding to 0 renders `"0 zł"`, never `"-0 zł"`; keep genuine negatives
- [x] 2.3 Fix `formatPct` (D3): only strip trailing zeros when a decimal separator is present so `formatPct(0.10,0)` → `"10%"`, `formatPct(1.0,0)` → `"100%"`; confirm default-precision callers unchanged
- [x] 2.4 Run the parse table + add `formatPLN`/`formatPct` cases; all green

## 3. storage.js import validation

- [x] 3.1 Add `validateState` check: reject when `ikeStart + ikzeStart > portfolioStart` (D6), with the existing Polish error path
- [x] 3.2 Add `validateState` rate-range checks: real rates in `[-0.5, 1]`, loan rates in `[0, 0.3]`, all rates `> -1`, `withdrawalRate > 0`
- [x] 3.3 Add Node cases: an over-seeded-accounts state and a `≤ -100%`-rate state are rejected; an in-range state still imports

## 4. ui.js display guards

- [x] 4.1 Add pure `fiPercent(portfolio, target)` helper (D4) returning `null`/`0` for `target <= 0`; route the ~575/704/808 call sites through it
- [x] 4.2 Make "FIRE reached" require `target > 0 && portfolio >= target` so a zero target is never trivially met
- [x] 4.3 Guard `ringSVG` (D5): clamp `pct` to finite `[0,1]` for geometry and label so `NaN`/`Infinity`/negative never emit `"NaN"` or a broken `dasharray`
- [x] 4.4 Manually verify via the preview: onboarding with living expenses `= 0` shows a defined ring (no `NaN%`, no false "FIRE osiągnięte")

## 5. charts.js robustness

- [x] 5.1 Clamp mapped y-coordinates into the drawing area for negative values (D7); keep the flat/all-zero div-by-zero guard
- [x] 5.2 Compute the y-domain from the full series so `maxPoints` decimation never drops an interior min/max from the scale
- [x] 5.3 Assert default-path parity: normal (≥0, ≤maxPoints) series output stays byte-identical (mirror the existing F29 guard); add negative-series and off-stride-spike cases

## 6. Test coverage backfill

- [x] 6.1 Add `deleteEntry` inverse tests: apply→delete restores derived state for first / middle / last / only entry, and delete-nonexistent is a no-op
- [x] 6.2 Add `contributionsVsGrowth` conservation test: `start + contributions + growth` reconciles to final portfolio; zero-return → `growth = 0`
- [x] 6.3 Import IKE/IKZE limit constants into the tests and assert `28 260 / 11 304 / 16 956`; replace the duplicated fixture literals with the imported constants
- [x] 6.4 Tighten F17 `eps` from `1` → `0.01` (Coast FIRE + contract-interest assertions) and confirm still green

## 7. Verify & release

- [x] 7.1 `node tests/run-tests.js` green; open `tests/tests.html` through the HTTP server to confirm the browser runner matches
- [x] 7.2 Bump the version in all three places (`sw.js` cache, `index.html` footer, `js/ui.js` APP_VERSION) and update the `sw.js` `PRECACHE`/cache name per the release checklist
- [x] 7.3 Do the `/FIRE/` subpath rehearsal (serve parent dir) to catch absolute-path/formatting regressions
- [x] 7.4 Commit with a Polish message describing the fixes; leave the refuted suspects and the `Kalkulator_FIRE.xlsx` provenance question documented in the proposal/design
