## ADDED Requirements

### Requirement: Deep state validation

`validateState` SHALL reject malformed or corrupt states beyond the current shallow check:
all `assumptions` fields used in math MUST be finite numbers; each entry's
`earned`/`spent`/`overpayment`/`familyOverpayment` MUST be finite and overrides MUST be
`null` or finite; `profile` MUST be an object; `housing.housePlan.mortgage`/`familyLoan`
MUST have the expected shape when enabled; `taxes.belkaEnabled` MUST be boolean. Rejection
SHALL use the existing Polish error pattern. Valid v1–v5 states MUST still migrate.

#### Scenario: Corrupt import rejected
- **WHEN** a backup with `monthlyIncome: "abc"`, a string `earned`, or a missing `profile`
  is imported
- **THEN** `validateState` rejects it with the Polish error and the app does not attempt
  to compute derived state from it

#### Scenario: Valid legacy states still migrate
- **WHEN** a valid v1–v5 state is loaded
- **THEN** it passes validation and migrates successfully, verified by the extended storage
  fixture group

### Requirement: Guarded recompute on import and boot

The import-apply path and the boot `recomputeDerived` call SHALL be wrapped in try/catch.
On an import-apply throw, the previous in-memory state MUST be preserved, a Polish error
toast shown, and the import aborted. On a boot throw, the app MUST fall through to
`renderCorrupt` (data preserved; export/import/reset available) rather than showing a white
screen.

#### Scenario: Import throw preserves state
- **WHEN** applying an imported state throws inside `recomputeDerived`
- **THEN** the app keeps the prior state, shows a Polish error toast, and aborts the import

#### Scenario: Boot throw shows recovery screen
- **WHEN** the boot `recomputeDerived` throws
- **THEN** the app renders `renderCorrupt` with export/import/reset options instead of
  crashing to a blank page

### Requirement: Content Security Policy meta tag

`index.html` SHALL include a CSP `<meta>` tag of the form `default-src 'self'; script-src
'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self';
connect-src 'self'`. The service worker registration, manifest, icons, and SVG charts MUST
continue to load both locally and under the `/FIRE/` subpath rehearsal.

#### Scenario: App works under CSP in subpath rehearsal
- **WHEN** the app is served under `http://localhost:8000/fire/` with the CSP meta present
- **THEN** the SW registers, the manifest and icons load, and charts render with no CSP
  violations

### Requirement: Offline-safe force-update

Before clearing caches and unregistering the service worker, „Wymuś aktualizację" SHALL
probe connectivity with `fetch('./manifest.webmanifest', {cache:'no-store'})`. On failure
it SHALL show the toast „Jesteś offline — spróbuj z internetem" and abort without touching
caches.

#### Scenario: Force-update aborts when offline
- **WHEN** the user taps „Wymuś aktualizację" while offline
- **THEN** the connectivity probe fails, an offline toast is shown, and caches and the SW
  registration are left intact
