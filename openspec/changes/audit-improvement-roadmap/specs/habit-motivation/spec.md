## ADDED Requirements

### Requirement: Check-in notes

A monthly check-in SHALL accept an optional free-text note (≤200 characters) stored inert
on the entry as `note`. This introduces a schema bump to **v6** rebased off Belka's v5: a
`case 5` migration stamps `note: null`, `createState` uses version 6, and the fixture group
is renumbered to the next free F-number. The note MUST be escaped with `esc()` at render and
displayed in Historia. It participates in no calculation.

#### Scenario: Note saved and shown in Historia
- **WHEN** the user enters a note during a check-in and saves
- **THEN** the note is stored on the entry and appears in that month's Historia row

#### Scenario: Note is rendered as literal text
- **WHEN** a note contains markup such as `<b>test</b>`
- **THEN** it renders as literal text, not interpreted HTML

#### Scenario: v5 states migrate to v6
- **WHEN** a v5 state is loaded
- **THEN** the `case 5` migration stamps `note: null` on entries and the state validates as
  v6

### Requirement: Savings history chart

Historia SHALL show an actual-vs-plan savings line chart at the top of the screen, reusing
`chartSVG` and the `zoomable` fullscreen registry.

#### Scenario: Chart reflects entry history
- **WHEN** the user opens Historia with recorded entries
- **THEN** a line chart of actual savings versus plan is shown and can be opened fullscreen

### Requirement: Milestones with celebration

The app SHALL detect milestones (10/25/50/75/100% of target, first 100k, half and full
mortgage payoff) and celebrate newly reached ones via the existing check-in modal layer. A
persisted `milestonesSeen` set (schema bump per the milestones doc, renumbered to the
then-current fixture group) prevents re-celebrating.

#### Scenario: New milestone celebrated once
- **WHEN** a check-in first pushes the portfolio past a milestone threshold
- **THEN** a celebration modal appears and the milestone is recorded in `milestonesSeen` so
  it is not celebrated again

### Requirement: Annual report

The app SHALL provide a read-only annual retrospective at `#/raport/:year` summarizing that
year's progress. When check-in notes are present, the report MAY surface them.

#### Scenario: Year report renders read-only
- **WHEN** the user opens `#/raport/2026`
- **THEN** a read-only retrospective for 2026 is shown with no editable controls
