## ADDED Requirements

### Requirement: FIRE-progress ratio is guarded against a zero target

The dashboard/analysis FI% computation (`portfolio / target`) SHALL treat a non-positive FIRE target as "progress not computable" rather than dividing by it. A zero target MUST NOT yield `Infinity` (a false "FIRE reached") or `NaN`.

#### Scenario: Zero target with positive portfolio

- **WHEN** the FIRE target is `0` (e.g. onboarding with monthly living expenses `= 0`) and the portfolio is positive
- **THEN** the FI% ratio is not treated as `≥ 100%`, and "FIRE reached" is not falsely triggered

#### Scenario: Zero target with zero portfolio

- **WHEN** both the FIRE target and the portfolio are `0`
- **THEN** the computation yields a defined display value (e.g. `0%` / a neutral placeholder), never `NaN`

### Requirement: Progress ring renders valid SVG for all inputs

`ringSVG` SHALL clamp its percentage argument to a finite `[0, 1]` range for geometry, producing a valid `stroke-dasharray` and a sensible label for any input including `NaN`, `Infinity`, and negative percentages.

#### Scenario: NaN percentage

- **WHEN** `ringSVG` receives `NaN` (e.g. from a `0/0` FI% ratio)
- **THEN** the emitted SVG contains no literal `"NaN"` — the `stroke-dasharray` is numeric and the label is a defined string (e.g. `"0,0%"`), not `"NaN%"`

#### Scenario: Percentage above 100% or below 0%

- **WHEN** `ringSVG` receives `1.5` or `-0.5`
- **THEN** the ring geometry is clamped to the `[0, 1]` arc and the label reflects a bounded, non-broken value
