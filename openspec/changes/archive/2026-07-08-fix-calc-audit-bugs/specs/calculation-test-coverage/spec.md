## ADDED Requirements

### Requirement: UI-reachable mutation and analysis functions have regression coverage

The engine test suite SHALL include direct coverage for `deleteEntry` and `contributionsVsGrowth`, both of which are reachable from the UI yet currently have zero tests.

#### Scenario: deleteEntry is the inverse of applyCheckIn

- **WHEN** an entry is applied and then deleted (for the first, middle, last, and only entry)
- **THEN** the recomputed derived state (balances, debt, family loan, streak, projection) returns to its pre-apply values, and deleting a nonexistent entry is a no-op

#### Scenario: contributionsVsGrowth conserves value

- **WHEN** `contributionsVsGrowth` runs over a history with surplus, deficit, and non-zero returns
- **THEN** `start + contributions + growth` reconciles to the final portfolio value, and a zero-return history yields `growth = 0`

### Requirement: Tax limit constants are asserted, not duplicated

The test suite SHALL assert the engine's IKE/IKZE limit **constants** against their documented 2026 values by importing the constants, rather than duplicating the numbers as independent fixture literals that can silently diverge.

#### Scenario: Limit constants pinned to spec values

- **WHEN** the tax-limit test runs
- **THEN** it imports the engine constants and asserts IKE `= 28 260`, IKZE employee `= 11 304`, IKZE self-employed `= 16 956`, so a constant edit fails the test instead of silently disagreeing with the fixture

### Requirement: Money assertions use grosz-level tolerances where the fixture allows

Assertions comparing precise six-figure monetary fixtures SHALL use a tolerance tighter than `1 zł` where the fixture value is itself precise (e.g. Coast FIRE / contract-interest checks currently at `eps = 1`).

#### Scenario: Tightened tolerance on a precise fixture

- **WHEN** an assertion compares against a fixture value given to the grosz
- **THEN** the tolerance is reduced (e.g. to `0.01`) and the test still passes, catching drift that a `1 zł` band would hide
