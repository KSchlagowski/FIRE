## 1. Phase 1 — Explanations rewrite + Słowniczek (~v1.18.0)

- [x] 1.1 Add a `.howto` CSS style (normal-text numbered list) in `styles.css`; keep
  `.formula` monospace only for the optional „Wzór dla dociekliwych" line
- [x] 1.2 Rewrite the 10 Analiza „Jak to liczymy?" blocks (`statsCard`, `planPerfCard`,
  `projectionCard` both note variants, `withdrawalCard`, `dieWithZeroResult`, `belkaCard`,
  `sensitivityCard`, `mortgageCard`, `familyLoanCard`) into 2–4 plain-Polish numbered steps
  using the user's actual numbers; drop untranslated jargon (also rewrote `ikeIkzeCard`,
  which shipped in v1.18 after the audit)
- [x] 1.3 Rewrite the 7 Symulacja blocks (`whatIfCard`, `targetAgeCard`, `latteCard`,
  `moreSavingsCard`, `overpaymentCard`, `loanCalcCard`, `returnCard`, `retirementResult`) to
  the same pattern
- [x] 1.4 Sharpen the top-of-card „co tu widzisz" sentence on each card where weak; pass over
  `tip()` texts in `ui.js` to unify terminology with the glossary
- [x] 1.5 Create `js/glossary.js` — pure L2 builder (local `esc()`, imports at most
  `format.js`) with ~16 entries (realnie/nominalnie, SWR, cel FIRE/ruchomy, FI%, Coast FIRE,
  zapas, annuitet, nadpłata, Belka/basis, dwa kubełki, plan fazowy/miesiąc budowy, werdykty/
  skala S, seria, korekty sald, prognoza wg planu vs delta, „do zera")
- [x] 1.6 Add routes `#/slowniczek` and `#/slowniczek/:term` to `route()` (term scrolls
  to/highlights the entry); map both to the Plan tab in `activeRoute()`
- [x] 1.7 Add a „📖 Słowniczek" item to the Plan hub; add inline `#/slowniczek/:term` links
  from jargon terms in the rewritten explanation blocks
- [x] 1.8 Add `./js/glossary.js` to `sw.js` PRECACHE; bump version in `sw.js` CACHE,
  `index.html` footer, `js/ui.js` APP_VERSION (1.18.0 was already taken by IKE/IKZE →
  Phase 1 ships as **v1.19.0**)
- [x] 1.9 Verify: `node tests/run-tests.js` green (no fixture change); click every Analiza/
  Symulacja card in dark+light; term links land on the right entry; `/FIRE/` subpath
  rehearsal

## 2. Phase 2 — UX restructure (~v1.19.0)

- [x] 2.1 Convert Symulacja to a hub: `#/symulacja` menu list (reuse `.hub`), `#/symulacja/
  :calc` single calculator with `← Symulacja` back button; retain module-scope input state;
  keep „Nadpłata" conditional; add the `route()` branch
- [x] 2.2 Remove `symTab` and the `.seg-scroll` strip; delete the now-unused `.seg-scroll`
  CSS if nothing else uses it
- [x] 2.3 Enlarge `details.tip summary` hit area to ≥44px (padding + negative margin, keep
  the 20px dot) and nudge the font size up
- [x] 2.4 Add `confirmModal(text, onYes)` on top of `showModal()`; replace all 5 native
  `confirm()` sites (delete entry ×2, remove earliest month, import replace, corrupt reset)
- [x] 2.5 Make theme apply instantly on the Aplikacja page: `change` → `applyTheme()` +
  `persist()` + toast; remove the theme Save button
- [x] 2.6 Micro-fixes: overpayment fields default empty with `0` placeholder;
  `window.scrollTo(0,0)` on onboarding validation failure; labeled anchor-month remove button
  („Usuń miesiąc i cofnij start planu") in the expanded row's action bar; `role="status"` on
  `#toast`; `aria-current="page"` on the active tab
- [x] 2.7 Bump version (3 places); verify: tests green, per-screen click-through dark+light,
  `/FIRE/` subpath rehearsal (shipped as **v1.24.0**; 195/195 in Node and in the browser
  runner under `/FIRE/`, headless click-through incl. an active-mortgage scenario for the
  conditional „Nadpłata" hub item and the empty-with-placeholder overpayment fields)

## 3. Phase 3 — Hardening (~v1.19.x)

- [ ] 3.1 Deepen `validateState` in `storage.js`: finite `assumptions`; entries'
  `earned/spent/overpayment/familyOverpayment` finite and overrides `null|finite`; `profile`
  object; `housing.housePlan.mortgage/familyLoan` shape when enabled; `taxes.belkaEnabled`
  boolean — reject with the existing Polish error
- [ ] 3.2 Add storage fixtures: NaN income, string `earned`, missing `profile` → all
  rejected; valid v1–v5 states still migrate (extend the migration test group)
- [ ] 3.3 Wrap import-apply (`ui.js`) in try/catch: on throw keep prior state, show Polish
  error toast, abort import
- [ ] 3.4 Wrap boot `recomputeDerived` (`ui.js`) in try/catch: on throw fall through to
  `renderCorrupt`
- [ ] 3.5 Add CSP `<meta>` to `index.html`: `default-src 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'; connect-src
  'self'`; verify SW/manifest/icons/charts load locally and under `/FIRE/`
- [ ] 3.6 Add offline probe to „Wymuś aktualizację": `fetch('./manifest.webmanifest',
  {cache:'no-store'})` before clearing caches; on failure toast „Jesteś offline — spróbuj z
  internetem" and abort
- [ ] 3.7 Bump version (3 places); verify: `node tests/run-tests.js` green, malformed-JSON
  import rejected with Polish error, offline force-update aborts cleanly, `/FIRE/` rehearsal

## 4. Phase 4 — Habit & motivation features (one release each)

- [ ] 4.1 Rebase `docs/plan-checkin-notes.md` to schema v6: `case 5` migration stamps
  `note: null`, `createState` version 6, fixture group renumbered to next free F-number
- [ ] 4.2 Implement check-in notes: optional ≤200-char note on the entry, inert in math,
  `esc()` at render, shown in Historia; add the migration + note fixtures; release
- [ ] 4.3 Implement savings-history chart (`docs/plan-savings-history-chart.md`): actual-vs-
  plan line at top of Historia, reuse `chartSVG` + `zoomable`; release
- [ ] 4.4 Implement milestones with celebration (`docs/plan-milestones-celebration.md`):
  10/25/50/75/100% + first 100k + half/full mortgage, celebrated via the check-in modal
  layer; persist `milestonesSeen` (schema bump, renumbered fixtures); release
- [ ] 4.5 Implement annual report (`docs/plan-annual-report.md`): read-only `#/raport/:year`
  retrospective; surface notes where useful; release

## 5. Phase 5 — Deeper analysis features (one release each)

- [x] 5.1 Implement chart tap-to-inspect tooltips
  (`docs/plan-chart-tooltips-tap-to-inspect.md`) in `charts.js` + render sites; release
  (v1.20.0; fixture group F37 — doc said F30, taken by Belka)
- [x] 5.2 Implement projection band (`docs/plan-projection-band.md`): ±1.5 p.p. shaded band
  on „Portfel vs cel"; add engine/fixtures per doc; release (v1.21.0; fixture group
  F38 — doc said F32, taken by the parsing audit; band def carries no `label` so
  the 5.1 tooltips skip it, per the doc's forward-compat note)
- [x] 5.3 Implement crash stress test (`docs/plan-crash-stress-test.md`): sequence-of-returns
  in Analiza/Symulacja; engine math + fixtures; release (v1.22.0; fixture group F39 —
  doc said F31, taken by IKE/IKZE; crash also scales the Belka/IKE/IKZE buckets,
  which post-date the doc)
- [x] 5.4 Implement CSV export of entries (`docs/plan-csv-export-entries.md`): include a
  properly quoted `Notatka` column (ships after notes); release (v1.23.0; fixture group
  F40 — doc said F30, taken by Belka; shipped BEFORE notes since Phase 4 hasn't run,
  so the 19-column layout has no `Notatka` yet — add it, quoted, when notes ship)

## 6. Per-phase verification (repeat for every release)

Done for the four Phase 5 releases (v1.20.0–v1.23.0) and for Phase 2 (v1.24.0 — no new
app files, PRECACHE unchanged, CACHE bumped); repeat when Phases 3–4 ship.

- [x] 6.1 `node tests/run-tests.js` → exit 0 (extend fixtures when engine/storage behavior
  changes; copy-only phases need none) — 195/195 after F37–F40
- [x] 6.2 Serve locally, click through every affected screen in dark and light theme —
  headless Chromium pass per release (Pulpit tap/scrub/band, Symulacja „Krach",
  Kopia zapasowa CSV) in both color schemes; verify by hand on the phone at will
- [x] 6.3 `/FIRE/` subpath rehearsal (catches absolute-path and CSP regressions) — parent-dir
  serve + `http://localhost:8000/FIRE/`, zero console errors each release
- [x] 6.4 Confirm SW update path: version bump caught by „Dostępna nowa wersja", new files in
  PRECACHE, `tests/tests.html` still loads (SW must not hijack non-shell navigations) —
  no new app files in Phase 5 (PRECACHE unchanged, CACHE bumped 4×); browser runner
  195/195 with the SW registered
- [x] 6.5 Phase-specific checks: XSS literal-render when notes ship; malformed-JSON import
  rejected after Phase 3; offline force-update aborts after Phase 3 — n/a for Phase 5
  (notes and Phase 3 hardening not yet shipped); CSV quoting covered by F40b
