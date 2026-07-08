# state-import-validation

## Purpose

Range and cross-field validation of imported JSON state so the import path enforces the same invariants as the UI, rejecting states that would produce `NaN`/`Infinity`/negative buckets. Storage MUST NOT accept a state the Plan form would forbid.

## Requirements

### Requirement: Imported state enforces the account-composition invariant

`validateState` SHALL reject (or the import path SHALL clamp) any state in which the seeded IKE and IKZE starting balances together exceed the starting portfolio (`ikeStart + ikzeStart > portfolioStart`), so that the taxable bucket can never be seeded negative. This is the same constraint the Plan form already enforces in the UI; the import path MUST NOT bypass it.

#### Scenario: Import with over-seeded tax accounts is refused

- **WHEN** a JSON state with `portfolioStart = 10000`, `ikeStart = 8000`, `ikzeStart = 7000` is imported
- **THEN** the import fails validation with a Polish error toast (or the buckets are clamped so `taxable ≥ 0`), and no negative taxable bucket reaches `makeTaxTracker`

#### Scenario: Valid composition still imports

- **WHEN** a JSON state with `ikeStart + ikzeStart ≤ portfolioStart` is imported
- **THEN** validation passes and the buckets seed unchanged

### Requirement: Imported rates are within the economically meaningful range

`validateState` SHALL reject imported real/nominal rate fields that are `≤ −100%` (i.e. `≤ −1.0`), which would drive `monthlyRate`/`toReal` to `NaN`/`Infinity` and silently poison every derived value. Rates SHALL be constrained to the same domain the UI produces (real rates within `[−0.5, 1]`, loan rates within `[0, 0.3]`, withdrawal rate `> 0`).

#### Scenario: Sub-negative-100% rate rejected

- **WHEN** a JSON state with `realReturnAnnual = -1.5` (or any rate `≤ −1.0`) is imported
- **THEN** validation fails with a Polish error rather than persisting a state whose derived projection is `NaN`

#### Scenario: Zero or negative withdrawal rate rejected

- **WHEN** a JSON state with `withdrawalRate ≤ 0` is imported
- **THEN** validation fails, because `fireTargetAt` requires `withdrawalRate > 0` and would otherwise throw at render time

#### Scenario: In-range rates accepted

- **WHEN** a JSON state with all rates inside their documented ranges is imported
- **THEN** validation passes unchanged
