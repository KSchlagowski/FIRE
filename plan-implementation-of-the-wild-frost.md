# FIRE Companion — Implementation Plan

## Context

Build a motivational, offline, private PWA ("FIRE Companion") tracking progress toward FIRE (Financial Independence, Retire Early). Polish user, PLN; entire UI + coach copy in Polish. Monthly ritual: on the 1st, enter last month's earned/spent → app updates portfolio, compares vs plan, shows progress and a mobilizing coach message.

- Working dir: `C:\Repos\fire` — contains only `FIRE_App_Spec.md`. Greenfield; git repo initialized as part of implementation.
- Reference verified: `C:\Users\Kamil\Desktop\Kalkulator_FIRE.xlsx` — **4 sheets** (Kalkulator, Projekcja, Faza wypłat, Plan z domem). The spec's claimed 5th sheet ("Nadpłata vs inwestycja") doesn't exist; that module is **dropped** (user confirmed).
- Excel semantics confirmed: compounding `end = (start + contributions) × (1+r)`; "Plan z domem" keeps rent constant-real until move-in and **FIRE requires the mortgage term finished** (adopted). Spec's moving target (`g_exp`) and income growth (`g_inc`) are extensions over the Excel — kept, settable to 0.

## Locked decisions (user-confirmed 2026-07-03)

1. **No prefilled personal defaults** — onboarding collects everything; only generic assumption defaults (WR 4%, real return 5%/yr, inflation 3%, `g_exp` 1%/yr, `g_inc` 3%/yr).
2. **Birth date stored** (`2000-01-01`), age computed; FIRE age displayed "X lat Y mies.".
3. **Rent**: entered monthly amount, assumed to rise with inflation → **constant in real terms** (tooltip explains); disappears at move-in month.
4. **Mortgage is a future plan** (user debt-free today). Fields: start month, principal, nominal rate, term; payment = monthly annuity `A_m = L·j/(1−(1+j)^−N)`, `j=(1+i)^(1/12)−1`, optional manual override. Once started, app tracks the real balance monthly.
5. **Strategy locked: pay debt first, then invest.** During mortgage years all surplus overpays the loan; investing starts after debt-free. Overpay-vs-invest screen replaced by a two-phase dashboard: debt phase (melting balance + debt-free date) → accumulation phase (FIRE ring).
6. **Check-in fields**: earned, spent (consumption + rent + scheduled payment), optional overpayment (counts as saving, reduces debt), optional real brokerage balance override. `netSavings = earned − spent`; `portfolioContribution = netSavings − overpayment`.
7. **FIRE reached** = portfolio ≥ moving target **AND** debt = 0. Target with house = living-only expenses grown by `g_exp`; also show "gdybyś wynajmował na zawsze" contrast.
8. **Real/nominal**: everything real except the loan (nominal contract); conversions confined to `toNominal`/`toReal` helpers.
9. **Deployment**: files + git repo + Polish GitHub Pages guide (`WDROZENIE.md`); user deploys himself. Must work under a subpath (`https://user.github.io/fire/`) → relative paths everywhere.
10. **Two money buckets** (user-requested): **cash** (gotówka — savings being built up for the house, spent on it at build time, ~0 during debt years) and **invested portfolio** (brokerage — counts toward FIRE). Life-cycle: now→house start: surplus accumulates as cash; at house start: cash consumed by a "wydatek na dom" event (amount + month, default = all cash at mortgage start); debt years: all surplus overpays; post-debt: all surplus → portfolio. Both balances editable/correctable at any time. Cash earns 0% real by default (tooltip: lokaty ≈ inflacja), editable.

## Global conventions

- Money: JS Number, rounded to grosze on ingest; `EPS = 0.005` zeroing for debt/target comparisons; all amounts REAL PLN unless identifier ends in `Nominal`.
- Months: `"YYYY-MM"` strings, arithmetic on integer indices (`year*12 + month−1`). Never `new Date("YYYY-MM")` (UTC shift trap); "today's month" only from local `getFullYear()/getMonth()`.
- `anchorMonth`: month growth curves start from; set at onboarding; **re-anchored to current month when user edits income/expenses/rent**. Phase events (mortgage start, move-in, business start) stored as absolute `"YYYY-MM"`. Plan year `t = floor(monthsSince(anchor)/12)+1`; growth stepwise annual `(1+g)^(t−1)` (matches Excel).
- Compounding: monthly, `bal' = (bal + contribution)·(1+r_m)`, `r_m = (1+r)^(1/12)−1`.
- Mortgage deflator in plan: `A_m_real(t) = A_m·(1+infl)^−(t−1)` stepwise yearly. Documented error: benchmark slightly conservative. Actual check-in overpayments need no conversion (entered "now" = nominal now).

## File layout

```
C:\Repos\fire\
├── index.html               # app shell: header, bottom nav, one <section> per screen
├── styles.css               # CSS custom props, dark mode, mobile-first
├── sw.js                    # classic script at root → scope = subpath
├── manifest.webmanifest
├── .nojekyll
├── js/
│   ├── engine.js            # pure finance engine — zero DOM/storage imports
│   ├── coach.js             # Polish message library + deterministic selection (pure)
│   ├── format.js            # pl-PL formatting/parsing (pure)
│   ├── storage.js           # localStorage, schema version, migration, export/import
│   ├── ui.js                # renderers per screen, hash router, SVG charts, events
│   └── app.js               # bootstrap: load state, register SW, route, install hint
├── icons/icon-192.png, icon-512.png, icon-maskable-512.png   # checked-in PNGs
├── tools/make-icons.html    # zero-dep canvas→PNG generator (run once in browser)
├── tests/
│   ├── tests.html           # browser runner (imports engine)
│   ├── test-engine.mjs      # assertions (shared browser/Node)
│   ├── fixtures.mjs         # Excel-derived expected numbers
│   └── run-tests.mjs        # node tests/run-tests.mjs → exit 0/1
├── WDROZENIE.md             # Polish GitHub Pages deploy guide
├── README.md                # Polish: what it is, run tests, release checklist
└── FIRE_App_Spec.md         # existing, kept
```

`index.html` loads `<script type="module" src="js/app.js">` (relative). No external dependencies, no fonts, zero network calls beyond app files.

## Engine API (`js/engine.js`, pure)

**Time & rates**: `ymToIdx/idxToYm/monthsBetween`, `planYear(anchor, ym)`, `ageAt(birthDate, ym) → {years, months}`, `monthlyRate(annual)`, `toNominal(real, anchor, ym, infl)` = `real·(1+infl)^(months/12)`, `toReal(...)` inverse.

**Targets**: `fireTargetAt(state, ym)` — living·12·(1+g_exp)^(t−1) / WR when house enabled; + rent·12 when disabled (renting forever). `fireTargetsToday(state) → {primary, rentingForever}`.

**Mortgage**: `mortgagePayment(mtg)` (override ?? annuity; guards term>0, j==0 → L/N). `mortgageStep(balNominal, j, payment, overpayNominal) → {bal, interest, principalPaid, spill}` — spill = overpayment beyond payoff, flows back to investing; balance zeroed within EPS. `amortizationSchedule(mtg)` for settings preview.

**Phased plan**: `buildPlan(state, horizon=720) → PlanMonth[]` — per month: `incomeReal = monthlyIncome·(1+g_inc)^(t−1) + business (if ym ≥ businessStartMonth)`; `livingReal = living·(1+g_exp)^(t−1)`; `rentReal` until moveInMonth; `mortgagePaymentReal` (deflated) during term; `plannedSavings = income − living − rent − mortgagePayment` (**can be negative during build years**); `targetReal`. `plannedSavingsFor(plan, ym)` lookup.

**Replays (derived, never stored)**:
- `replayBalances(state, uptoYm) → {cash, portfolio, rows}`: from `cashStart`/`portfolioStart` at anchor. Per month, `contribution = netSavings − overpayment` is **routed by phase**: before mortgage start (house plan enabled) → cash bucket; during debt → cash (usually ≈0; deficits drain cash first, then portfolio); after debt-free (or house disabled) → portfolio. Cash grows at `cashReturnReal` (default 0), portfolio at `r_m`. The `houseSpend` event (`{month, amount}`) deducts from cash at its month (clamped to available cash + portfolio spill-over, warning if underfunded). Entry overrides: `cashOverride`/`balanceOverride` replace the respective bucket that month. Gap months: growth only.
- `replayDebt(state, uptoYm)`: from principal at startMonth; monthly `mortgageStep` with entry overpayment; scheduled payment assumed paid in gap months; `debt.overrides` (manual corrections) reset the chain; real balance for display via `toReal`.

**Verdict & streak**: `computeVerdict(net, plan)` — scale `S = max(|plan|, 500)`: `net ≥ plan+0.15S` → crushed; `≥ plan` → on_plan; `≥ plan−0.40S` → behind; else hard. Reproduces spec's ×1.15/×0.6 tiers for plan > 500, extends continuously to plan ≤ 0. `computeStreak(entries)` — good = crushed|on_plan; missing months skipped (neither break nor extend); derived fresh each mutation.

**Check-in**: `applyCheckIn(state, {month, earned, spent, overpayment=0, balanceOverride=null})` — validates month ∈ [anchor, lastCompleteMonth], edit replaces, overpayment only when mortgage active. Entry stores `plannedSavingsSnapshot` **frozen at creation** (assumption changes don't rewrite past verdicts; explicit edit refreshes). Then `recomputeDerived`.

**Projection**: `assumedDelta(entries, plan)` — mean of (net − snapshot) over last min(6, n) entries; 0 if n < 3 (labeled "prognoza wg planu"). `projectFire(state)` — from current replayed balances, monthly for ≤720, same phase routing as `replayBalances`: pre-house → surplus builds cash; `houseSpend` month → cash consumed (shortfall drains portfolio, flagged "plan zakłada niedobór wkładu"); debt active → surplus overpays (`toNominal`), payoff spill → portfolio; post-debt → `(bal+s)(1+r_m)`. FIRE when `portfolio ≥ fireTargetAt AND debt == 0`. Returns `{reached, fireYm, fireAge, debtFreeYm, onTrack, series}` (series includes cash, portfolio, debt, target for the chart).

`recomputeDerived(state)`: single pipeline after any mutation — buildPlan → replayBalances → replayDebt → computeStreak → projectFire; cached on `state.derived`, never persisted as truth.

## Other modules

- **`format.js`**: `formatPLN` (Intl pl-PL, NBSP grouping, " zł"), `formatPct` ("3,5%"), `formatAgeYM` (Polish plurals: rok/lata/lat), `formatMonthName` ("czerwiec 2026"), `parsePLN` (accepts comma/dot, NBSP).
- **`coach.js`**: `coachMessage(ctx)` — MESSAGES[verdict][on/off-track], ≥3 variants per bucket (~24–30 strings, tone per spec §6); milestone prefixes at streak 3/6/12; comeback variant; first-entry variant. Selection `ymToIdx(month) % variants.length` (deterministic, rotates monthly). Always ends "Cel na {miesiąc}: {nextPlan} zł"; when nextPlan ≤ 0 → budget-discipline phrasing for build years.
- **`storage.js`**: key `fireApp` + backup `fireApp.bak` written before every save; `loadState` validates → migrates, falls back to .bak with recovery dialog (never silent reset); quota try/catch with Polish warning; `migrate` version-switch chain (v1 identity); `exportJSON`/`importJSON` (app tag + version check + preview data), `resetState`.
- **`ui.js`/`app.js`**: hash router (`#/`, `#/checkin`, `#/history`, `#/plan`, `#/backup`, `#/onboarding`), `render<Screen>(state)` via template strings + event delegation, tap-friendly `<details>` tooltips, SVG line chart (≤120 decimated points). Bootstrap: state → onboarding if empty → `register('./sw.js')` → check-in-due banner → `beforeinstallprompt` hint.

## State schema v1 (localStorage `fireApp`)

```json
{
  "version": 1, "createdAt": "…", "anchorMonth": "2026-07",
  "profile": { "birthDate": "2000-01-01" },
  "assumptions": { "monthlyIncome": …, "monthlyLivingExpenses": …,
    "cashStart": …, "portfolioStart": …, "cashReturnReal": 0,
    "targetFireAge": …, "withdrawalRate": 0.04, "realReturnAnnual": 0.05,
    "expenseGrowthReal": 0.01, "incomeGrowthReal": 0.03, "inflationAnnual": 0.03 },
  "housing": { "currentRentMonthly": …,
    "housePlan": { "enabled": …, "moveInMonth": "YYYY-MM",
      "houseSpend": { "month": "YYYY-MM", "amount": null },
      "businessIncomeMonthly": 0, "businessStartMonth": null,
      "mortgage": { "startMonth": "YYYY-MM", "principal": …, "rateNominal": …,
        "termYears": …, "paymentOverrideMonthly": null } } },
  "debt": { "overrides": [] },
  "entries": [ { "month": "YYYY-MM", "earned": …, "spent": …, "overpayment": 0,
    "cashOverride": null, "balanceOverride": null, "plannedSavingsSnapshot": …,
    "verdict": "…", "createdAt": "…", "updatedAt": null } ],
  "ui": { "theme": "auto", "installTipDismissed": false, "reminderTipShown": false,
    "lastExportAt": null }
}
```

Deliberate deviations from spec §4: birthDate not ageNow; no stored `portfolio.currentValue`/`streak`/`savings`/`portfolioAfter` (all derived by replay); absolute months not year indices; rent outside `housePlan` (renter with house off pays rent forever → target includes it); **two-bucket balances** (`cashStart` house fund + `portfolioStart` brokerage) with `houseSpend` event (`amount: null` = "all available cash", `month` defaults to mortgage start).

## Screens

Bottom tab bar (thumb zone): **Pulpit / Historia / Plan / Kopia**; check-in via prominent dashboard CTA.

1. **Onboarding** (5 steps, progress dots): intro+ritual explainer → birthDate, targetFireAge (validate > age), income → living expenses (tooltip: excl. housing), rent (tooltip: inflation-indexed = constant real), **cash savings (fundusz na dom) + invested portfolio (either can be 0)** → house toggle (mortgage start/principal/rate/term + live computed payment + override; moveInMonth; house-spend amount/month with "cała gotówka" default; business income/start) → assumptions review with §3 tooltips. Finish → recompute → dashboard + one-time tip: set phone reminder "1. dnia miesiąca — FIRE check-in".
2. **Dashboard** — **three modes** following the life-cycle: *house-fund phase* (before mortgage: hero = cash growing toward the planned house spend, "fundusz na dom: X / Y zł", secondary FIRE card) / *debt phase* (hero: melting real balance, % repaid bar, "wolny od długu: {data} — za X lat Y mies.", secondary portfolio card, projected debt curve chart) / *accumulation phase* (progress ring `portfolio/fireTargetsToday().primary`, FIRE number, projected vs target age — green when onTrack, renting-forever contrast, streak flame, chart: history solid + projection dashed + moving target). Both balances (gotówka / inwestycje) always visible. Check-in-due banner; negative-plan phase notice.
3. **Check-in**: month select (last complete month default; existing = "edycja"), earned, spent (helper: "razem z czynszem i ratą"), overpayment (only when mortgage active; "nadpłata liczy się jako oszczędzanie"), collapsible "Popraw salda" → cash and/or portfolio override; `inputmode="decimal"`. Result screen: verdict badge, net vs plan delta, updated balances (+debt), projection shift arrow, streak, coach message.
4. **History**: reverse-chron list (month, netSavings, delta, badge); gaps greyed "brak wpisu" (tap → prefilled check-in); tap entry → edit/delete (confirm). Every mutation → full recompute.
5. **Plan & assumptions**: grouped form (Profil / Założenia / Finanse / Mieszkanie i dom / Kredyt), each field with §3 tooltip (real vs nominal, moving target, WR as safety ratio, sequence risk, ambitious 3% raises, cash ≈ 0% real); live annuity preview; house-spend amount/month; "skoryguj salda" (cash/portfolio/debt corrections → overrides); save → validate → re-anchor if income/expenses/rent changed → recompute; note "historia pozostaje bez zmian".
6. **Backup**: export (Blob download `fire-backup-YYYY-MM-DD.json`), import (file → preview: entries count, range, portfolio → explicit overwrite confirm), 2-step reset, data-loss warning + "ostatnia kopia: {lastExportAt}" nudge, Android install instructions.

Layout: mobile-first single column, max-width 480px; touch targets ≥48px; sticky bottom nav + `env(safe-area-inset-bottom)`; theme via CSS custom props, `prefers-color-scheme` default + manual override; system font stack.

## PWA

- **manifest**: relative `"id"/"start_url"/"scope": "./"`, `display: standalone`, `lang: pl`, 192/512/maskable-512 PNGs.
- **sw.js** (root → scope = subpath; registered `./sw.js`): `CACHE = 'fire-v1.0.0'` (version also in index.html footer — bump both on release); explicit PRECACHE list of all app files (new JS file must be added — checklist item); install: `addAll` + `skipWaiting`; activate: delete old caches + `clients.claim`; fetch: navigations → cached index.html, same-origin GET cache-first. Update flow: `updatefound` → toast "Dostępna nowa wersja — dotknij, aby odświeżyć" → reload.
- **Reminder honesty (spec §10)**: on-open due detection + one-time phone-reminder tip; optional local Notification when open and due; no push, stated in UI.

## Testing & verification

No frameworks: `tests/test-engine.mjs` (assertEq/assertClose/assertThrows helpers) shared by `tests.html` (browser, green/red list) and `node tests/run-tests.mjs` (exit code). Fixtures (Excel-derived):

- **F1** yearly convention: start 100 000, +48 000/yr, 5% → year-20 balance **1 931 853.86** (eps 0.5), crosses 1.8M in year 20 (verified against Projekcja sheet).
- **F2** monthly engine ≡ annuity-due closed form FV.
- **F3** annuity 1 100 000 @ 7%/15y → **≈9 755.8 zł/mo** (eps 1); 180 steps → balance 0; override respected.
- **F4** targets: 6 000/mo @ 4% → 1 800 000; moving target; renting-forever contrast; WR=0/term=0 throw.
- **F5** 3-phase plan incl. negative build-year months, stepwise-deflated payment, business switch-on month.
- **F6** verdict tiers at plan 4000 (4600/4000/2400 boundaries), plan 0, plan −2000, negative net.
- **F7** streak: gap skipped, bad breaks, edit rederives, best streak.
- **F8** replay determinism with override + overpayment; edit month 3 recomputes downstream; gap-month scheduled payment; overpay > balance spills.
- **F9** projection: pure-plan hits hand-computed month; delta shifts; FIRE requires debt=0 AND target; 720 cap → null.
- **F10** format/parse: NBSP grouping, "3,5%", plurals (1 rok/3 lata/5 lat/22 lata), parsePLN round-trip.
- **F11** storage: export/import round-trip, .bak recovery, migrate identity, higher-version reject.
- **F12** bucket routing: pre-mortgage surplus lands in cash; `houseSpend` (null amount) zeroes cash at mortgage start with shortfall draining portfolio; debt-phase deficits drain cash then portfolio; post-debt surplus lands in portfolio; cash/portfolio overrides reset the respective chain only.

Manual PWA verification (documented in README):
1. `python -m http.server 8000` in repo → localhost is a secure context, SW registers on HTTP.
2. DevTools → Application → Manifest (installability) + Service Workers (activated).
3. Network → Offline → hard reload → app works; add a check-in offline.
4. **Subpath rehearsal**: serve `C:\Repos` and open `http://localhost:8000/fire/` — catches absolute paths exactly as GitHub Pages would.
5. Phone after deploy: Chrome ⋮ → "Zainstaluj aplikację"; airplane-mode test.
6. Dev loop: keep DevTools "Update on reload" checked (SW staleness).

Optionally use the Claude Preview MCP (`.claude/launch.json` → `python -m http.server`) to drive/inspect the app during implementation.

## Build order

1. **Engine + tests**: git init, skeleton, `engine.js`/`format.js`/`coach.js`/`storage.js`, fixtures F1–F11 green (browser + Node). Exit: all Excel fixtures pass.
2. **UI + PWA**: shell, router, onboarding, both dashboard modes, check-in + result, history edit/delete, settings with tooltips, backup; manifest, icons (via `tools/make-icons.html`), sw.js; local install/offline/subpath verification.
3. **Polish & ship**: full coach variant library (incl. negative-plan phrasing), edge-case sweep (spec §12), dark-mode audit, `WDROZENIE.md` (Polish: GitHub account → repo → upload → Settings→Pages → install on Android → how to release updates → backups), README release checklist.

## Top risks & mitigations

1. **Real/nominal mixing in debt sim** → `Nominal` suffix convention, conversions only via `toNominal`/`toReal`, stepwise deflator with documented conservative error, fixtures F5/F8/F9 assert hand-computed mixed months.
2. **SW cache staleness** ("phone shows old app") → skipWaiting+claim, update toast, versioned cache, release checklist, PRECACHE enumeration called out.
3. **localStorage loss/corruption** → `.bak` before every save, validate-on-load with recovery dialog, quota catch, export nudges.
4. **Month/timezone bugs** → integer month indices, local-time "today" only, no Date arithmetic in engine, year-boundary test months.
5. **Floating-point money** (e.g. −0.003 zł debt blocking FIRE condition) → grosze rounding on ingest, EPS zeroing in `mortgageStep`/comparisons, display via Intl, F3/F8 assert exact zero-out.
