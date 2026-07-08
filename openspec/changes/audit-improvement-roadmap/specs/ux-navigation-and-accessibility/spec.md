## ADDED Requirements

### Requirement: Symulacja hub navigation

The Symulacja screen SHALL present its calculators as a hub list (reusing the `.hub`
pattern from `renderPlanHub`) at `#/symulacja` — icon, name, and one-line description per
calculator — rather than a horizontally scrolling tab strip. Each calculator SHALL render
on its own route `#/symulacja/:calc` with a `← Symulacja` back button. Module-scope input
state MUST survive navigation between calculators. „Nadpłata" SHALL remain conditionally
shown as today. The `symTab` state and the `.seg-scroll` strip SHALL be removed, and the
now-unused `.seg-scroll` CSS deleted if nothing else uses it.

#### Scenario: Hub lists every calculator
- **WHEN** the user opens `#/symulacja`
- **THEN** a hub list shows all calculators (8, with „Nadpłata" shown only when applicable),
  each with an icon, name, and one-line description

#### Scenario: Single calculator with back button
- **WHEN** the user taps a calculator in the hub
- **THEN** `#/symulacja/:calc` renders just that calculator with a `← Symulacja` back
  button, and previously entered inputs are preserved

#### Scenario: Tab highlighting unchanged
- **WHEN** any `#/symulacja/*` route is active
- **THEN** `activeRoute()` still highlights the Symulacja tab

### Requirement: App-modal confirmations replace native confirm()

A `confirmModal(text, onYes)` helper built on the existing `showModal()` SHALL replace all
five native `confirm()` call sites (delete entry ×2, remove earliest month, import replace,
corrupt reset). The modal SHALL support Escape and backdrop-close consistent with the
existing modal pattern.

#### Scenario: Deleting an entry uses the app modal
- **WHEN** the user deletes a check-in entry
- **THEN** an in-app confirmation modal appears (not the browser `confirm()` dialog) and
  the deletion proceeds only on confirm

### Requirement: Instant theme apply

On the Aplikacja settings page, changing the theme `select` SHALL immediately call
`applyTheme()`, `persist()`, and show a toast, with no separate Save button for the theme.

#### Scenario: Theme changes on selection
- **WHEN** the user picks a different theme in the Aplikacja page select
- **THEN** the theme applies immediately, is persisted, and a confirmation toast is shown
  without tapping a Save button

### Requirement: Tooltip touch targets and accessibility micro-fixes

Tooltip `details.tip summary` elements SHALL have a hit area of at least 44px (via padding
plus negative margin, keeping the 20px visual dot) with a slightly larger font. Overpayment
fields SHALL default to empty with a `0` placeholder. Onboarding validation failure SHALL
`window.scrollTo(0,0)`. The anchor-month remove control SHALL become a labeled button
(„Usuń miesiąc i cofnij start planu") in the expanded row's action bar. `#toast` SHALL have
`role="status"` and the active tab link SHALL have `aria-current="page"`.

#### Scenario: Tooltip is easy to tap
- **WHEN** the user taps a `?` tooltip on a phone
- **THEN** the tap target is at least 44px and the input behind it is not accidentally
  focused

#### Scenario: Active tab is announced
- **WHEN** a top-level tab is active
- **THEN** its link carries `aria-current="page"` and `#toast` carries `role="status"`
