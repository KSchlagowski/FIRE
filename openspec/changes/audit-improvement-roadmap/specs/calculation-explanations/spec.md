## ADDED Requirements

### Requirement: Plain-Polish explanation pattern for calculated cards

Every calculated card in the Analiza and Symulacja screens SHALL present its
„Jak to liczymy?" content as plain-Polish numbered steps (2–4 steps), one idea per line,
in second person, with the user's actual numbers used as a worked example. Untranslated
jargon (annuity-due, rezydualny, PV renty, poszukiwanie binarne) MUST NOT appear in the
step text. The literal formula MAY appear only as a final optional
„Wzór dla dociekliwych: …" line rendered in the existing monospace `.formula` style; all
step lines above it use a new non-monospace `.howto` style.

#### Scenario: Die-with-zero explanation is rewritten
- **WHEN** the user opens „Jak to liczymy?" on the „do zera" card in Analiza
- **THEN** the explanation shows numbered plain-Polish steps describing the 65-year
  payout to age 110 with the user's figures
- **AND** the only monospace line, if present, is the „Wzór dla dociekliwych" formula

#### Scenario: All seventeen blocks follow the pattern
- **WHEN** any of the 17 calculated cards (`statsCard`, `planPerfCard`, `projectionCard`,
  `withdrawalCard`, `dieWithZeroResult`, `belkaCard`, `sensitivityCard`, `mortgageCard`,
  `familyLoanCard`, `whatIfCard`, `targetAgeCard`, `latteCard`, `moreSavingsCard`,
  `overpaymentCard`, `loanCalcCard`, `returnCard`, `retirementResult`) is rendered
- **THEN** its „Jak to liczymy?" body uses `.howto` numbered steps, not a stack of
  `.formula` boxes

#### Scenario: No engine behavior changes
- **WHEN** the copy rewrite ships
- **THEN** `node tests/run-tests.js` stays green with no fixture changes, because the
  engine output is unchanged and F-fixtures assert engine values, not builder HTML

### Requirement: Słowniczek glossary screen

The app SHALL provide a Słowniczek (glossary) screen at route `#/slowniczek` built by a new
pure HTML builder `js/glossary.js` (imports nothing beyond `format.js`, with a local
`esc()`). The screen SHALL define approximately 16 entries covering recurring concepts:
realnie vs nominalnie, stopa wypłat (SWR), cel FIRE i cel ruchomy, FI%, Coast FIRE, zapas
(runway), annuitet, nadpłata, podatek Belki i koszt nabycia, dwa kubełki, plan fazowy i
miesiąc budowy, werdykty i skala S, seria, korekty sald, prognoza „wg planu" vs delta, and
„do zera". The route `#/slowniczek/:term` SHALL scroll to and highlight the matching entry.
`activeRoute()` SHALL map both routes to the Plan tab.

#### Scenario: Glossary reachable from Plan hub
- **WHEN** the user opens the Plan hub
- **THEN** a „📖 Słowniczek" item is present and navigates to `#/slowniczek`

#### Scenario: Term deep link highlights the entry
- **WHEN** the user follows an inline jargon link such as `#/slowniczek/swr`
- **THEN** the Słowniczek screen renders and the „stopa wypłat (SWR)" entry is scrolled
  into view and visually highlighted

#### Scenario: Glossary file is precached
- **WHEN** the Phase 1 release is built
- **THEN** `./js/glossary.js` is present in the `sw.js` `PRECACHE` list and the version is
  bumped in all three required places
