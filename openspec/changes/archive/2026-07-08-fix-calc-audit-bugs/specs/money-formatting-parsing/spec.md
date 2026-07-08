## ADDED Requirements

### Requirement: PLN amount parsing is Polish-locale correct

`parsePLN` SHALL interpret a string as a Polish-formatted monetary amount where the comma (`,`) is the decimal separator and the space, non-breaking space, and dot (`.`) are thousands (grouping) separators. It SHALL return a number rounded to the grosz (2 decimals), or `null` for empty, non-numeric, or genuinely ambiguous input. It MUST NOT silently return a wrong magnitude.

#### Scenario: Dot used as thousands separator

- **WHEN** the input is `"1.000"`
- **THEN** `parsePLN` returns `1000` (not `1`)

#### Scenario: Mixed grouping and decimal

- **WHEN** the input is `"1.234,56"`
- **THEN** `parsePLN` returns `1234.56`

#### Scenario: Comma decimal without grouping

- **WHEN** the input is `"1234,56"` or `"1,5"`
- **THEN** `parsePLN` returns `1234.56` and `1.5` respectively

#### Scenario: Space / NBSP grouping preserved

- **WHEN** the input is `"1 234,56"` or `"2 500,50"` (with regular or non-breaking spaces)
- **THEN** `parsePLN` returns `1234.56` and `2500.5`

#### Scenario: Ambiguous or malformed input rejected, not guessed

- **WHEN** the input cannot be resolved to a single unambiguous number (e.g. `"1,2,3"`, `"1.0.0"`, or an empty/`"-"` string)
- **THEN** `parsePLN` returns `null` so the calling field surfaces a validation error rather than persisting a wrong value

### Requirement: Amount formatting never shows a false negative zero

`formatPLN` SHALL render a value that rounds to zero at the displayed precision as a non-negative `"0 zł"` string, without a leading minus sign.

#### Scenario: Tiny negative residual rounds to zero

- **WHEN** `formatPLN(-0.004)` is called at the default (0-decimal) precision
- **THEN** the result is `"0 zł"`, not `"-0 zł"`

#### Scenario: Genuine negative is preserved

- **WHEN** `formatPLN(-12.5)` is called
- **THEN** the result retains the minus sign (`"-12,50 zł"` at 2 decimals / `"-13 zł"` at 0 decimals per rounding)

### Requirement: Percent formatting preserves the integer part at zero decimals

`formatPct` SHALL strip only trailing fractional zeros, never digits belonging to the integer part of the percentage.

#### Scenario: Whole-number percent at zero decimals

- **WHEN** `formatPct(0.10, 0)` and `formatPct(1.0, 0)` are called
- **THEN** the results are `"10%"` and `"100%"` respectively (not `"1%"`)

#### Scenario: Fractional zeros still stripped

- **WHEN** `formatPct(0.10, 2)` is called
- **THEN** the result is `"10%"` (trailing `,00` stripped), unchanged from current behavior
