## ADDED Requirements

### Requirement: Chart scaling keeps all points inside the viewBox

The SVG chart builders (`chartSVG`/`stackedBarSVG`) SHALL map every plotted value to a coordinate inside the chart's drawing area, including negative values. A negative data point MUST NOT be projected to a coordinate outside the viewBox.

#### Scenario: Series containing a negative value

- **WHEN** a series contains a negative value (e.g. a portfolio drawn below zero by a deficit)
- **THEN** every emitted coordinate is within the chart's height bounds — no point renders off-canvas

#### Scenario: Flat / all-equal series

- **WHEN** every value in a series is equal (including all-zero)
- **THEN** the builder produces valid output with no division-by-zero and no `NaN` coordinate

### Requirement: Decimation preserves the series extremes

When `maxPoints` decimation reduces the number of plotted points, the y-axis scale SHALL be computed from the full series (or the retained set SHALL include the global minimum and maximum), so an interior spike is never dropped from the scale.

#### Scenario: Interior spike beyond the sampling stride

- **WHEN** a series longer than `maxPoints` has its maximum at an index not on the decimation stride
- **THEN** the y-axis `max` still reflects that maximum, and the rendered chart does not understate the peak
