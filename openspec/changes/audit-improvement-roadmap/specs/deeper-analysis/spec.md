## ADDED Requirements

### Requirement: Chart tap-to-inspect tooltips

Charts SHALL support tap-to-inspect: tapping (or hovering) a point reveals its exact value.
This applies to the chart builders in `charts.js` and their render sites, per
`docs/plan-chart-tooltips-tap-to-inspect.md`.

#### Scenario: Tapping a point shows its value
- **WHEN** the user taps a data point on a chart
- **THEN** the exact value (and its period) for that point is displayed

### Requirement: Projection band

The „Portfel vs cel" projection SHALL render a shaded ±1.5 p.p. return band around the
central line to communicate uncertainty instead of a single false-precision line, per
`docs/plan-projection-band.md`.

#### Scenario: Band brackets the central line
- **WHEN** the projection chart is shown
- **THEN** a shaded band bounded by the −1.5 p.p. and +1.5 p.p. return scenarios surrounds
  the central projection line

### Requirement: Crash stress test

Analiza/Symulacja SHALL offer a sequence-of-returns crash stress test that shows how an
early downturn affects the plan, per `docs/plan-crash-stress-test.md`. Engine math lives in
`engine.js` with a fixture group.

#### Scenario: Stress test reports impact
- **WHEN** the user runs the crash stress test
- **THEN** the app reports the effect of an adverse return sequence on the FIRE outcome

### Requirement: CSV export of entries

The app SHALL export the entry history as CSV, per `docs/plan-csv-export-entries.md`. When
shipped after check-in notes, the export MUST include a properly quoted `Notatka` column.

#### Scenario: Export includes quoted notes
- **WHEN** the user exports entries to CSV after notes have shipped
- **THEN** the CSV contains one row per entry and a `Notatka` column with values quoted so
  embedded commas, quotes, and newlines are preserved
