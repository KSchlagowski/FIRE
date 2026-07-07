# Plan E — Reports & engagement (milestones, annual report, CSV export, backup nudge + .bak restore)

Part of the v1.14.0 wave (see `plans/00-master-plan.md`). Implemented **after batch C**,
which adds an optional free-text `note` field to check-in entries and bumps
`SCHEMA_VERSION` (expected 2 → 3). This plan assumes C's `note` exists; the CSV export
includes it. All design decisions are made here — do not re-derive them.

Wave conventions that bind this batch: **no version bump** (release agent does it), **no
commits**, `node tests/run-tests.js` green at the end, write `docs/features/E.md` and add
one line to `docs/INDEX.md`. **No new JS files are created by this plan**, so `PRECACHE`
in `sw.js` stays untouched (deliberate: the annual-report markup extends `analysis.js`
instead of adding a new module).

---

## 0. Cross-cutting decisions (read first)

| Decision | Choice | Why |
|---|---|---|
| Milestone detection | Pure `engine.js` functions (`milestoneStatus` + `newMilestones`) comparing derived pipeline results before/after a check-in save | Testable in Node; "crossing" semantics prevent fake fanfare for wealth that pre-dates the app |
| Milestone celebration UI | Extend the existing `Mot.checkinModal` with an optional `milestone` block (one modal, not two chained) | One tap to dismiss on mobile; reuses the only modal pattern in the app |
| `milestonesSeen` persistence | `state.ui.milestonesSeen: string[]` + full migration checklist (§5) | Celebrate once, ever — survives balance dips/corrections that re-cross a threshold |
| Annual report math | Pure `engine.js` (`projectionAsOf`, `annualReport`, `reportYears`) | The FIRE-date shift needs two full projections — must be deterministic and fixture-tested |
| Annual report markup | New builders in **`analysis.js`** (not a new file) | Report is analysis-flavored (kv/table/metodologia helpers already live there); avoids a PRECACHE addition |
| Annual report placement | New route `#/raport/:year`; seasonal card on Pulpit (December → current year, January → prior year) + permanent "Raporty roczne" links at the bottom of Historia | Pulpit card = discovery at the emotionally right moment (Dec anticipation; Jan 1 is when the December check-in completes the year). Historia = the archive screen, natural permanent home for past years. Analiza is rejected: its render is already heavy and it's about *current* state, not yearly retrospectives. A hash route keeps it back-button friendly |
| CSV builder location | **`storage.js`** (`entriesToCSV`), not `engine.js` | It's export serialization, sibling of `exportJSON`; `storage.js` is an L0 pure leaf already exercised in Node. `engine.js` stays finance-only. Uses its own minimal number formatting (CSV needs `1234,56` — no NBSP grouping, no "zł" — so `format.js` is *not* reused) |
| Verdict column in CSV | Raw key by default; ui.js injects Polish labels via an optional param | `storage.js` must import nothing (layering) — labels are passed in, not imported from `coach.js` |
| CSV export and `lastExportAt` | CSV export does **NOT** update `state.ui.lastExportAt` | CSV is not restorable — only the JSON backup counts as a backup; the nudge must not be silenced by a CSV download |
| Backup-nudge condition | Pure `backupNudgeDue(state, nowMs)` in `storage.js`; ui shows it once per app open (module flag), wired from `app.js` | Same 61-day threshold already used inline in `renderBackup` — refactor to one source of truth |
| .bak restore | `storage.loadBackup()` (preview only) + adopt-and-`persist()` in ui.js — **no** dedicated restore method | `storage.save` already copies current → `.bak` before writing, so "restore then save" naturally swaps the two snapshots: **restoring twice undoes the restore.** Document this in the UI copy |
| .bak "date" in confirm | Show entry count + month range + "stan sprzed ostatniego zapisu" | `.bak` is a raw state JSON with no saved-at timestamp (adding one would break `load()`'s recovery parsing). Range/count is the honest equivalent |

---

## 1. Feature 1 — Milestones with celebration

### 1.1 `engine.js` — detection (pure)

Add a new section banner `// ── Kamienie milowe ─────` after the streak section.

```js
// Priority order, most significant first. The FIRST crossed key becomes the
// modal headline; the rest are listed as extra lines. Keys are persisted in
// state.ui.milestonesSeen — never rename them (they are a schema).
export const MILESTONES_ORDER = [
  'fi100', 'mortgageDone', 'familyDone', 'fi75', 'fi50',
  'mortgageHalf', 'fi25', 'port100k', 'fi10',
];

// Boolean status of every milestone given the derived pipeline results.
// Pure reader — takes replay results as params (same style as fiStats).
export function milestoneStatus(state, balances, debt, family, uptoYm) {
  const target = fireTargetAt(state, uptoYm);
  const p = balances.portfolio;
  const pct = q => target > 0 && p >= q * target - EPS;
  return {
    fi10: pct(0.10), fi25: pct(0.25), fi50: pct(0.50), fi75: pct(0.75), fi100: pct(1.0),
    port100k: p >= 100000 - EPS,
    mortgageHalf: debt.started && debt.paidPct >= 0.5,
    mortgageDone: debt.started && debt.balanceNominal <= EPS,
    familyDone: family.started && family.balanceNominal <= EPS,
  };
}

// Crossing = false→true between two status snapshots, minus already-seen keys.
// Returns keys in MILESTONES_ORDER (priority) order. Tolerates seen == null.
export function newMilestones(before, after, seen = []) {
  const s = seen || [];
  return MILESTONES_ORDER.filter(k => after[k] && !before[k] && !s.includes(k));
}
```

Semantics locked in:

- **`fi100` is a portfolio milestone** (`portfolio ≥ fireTargetAt`), intentionally NOT
  gated on debts — it mirrors the FI% ring (`fiStats.fiPct`). The full FIRE condition
  (all three: target + mortgage 0 + family 0) stays exclusive to `projectFire`.
- **`mortgageHalf`** uses `debt.paidPct ≥ 0.5` (already computed by `replayLoanCore`).
  `mortgageDone`/`familyDone` require `started` — a plan with no mortgage (or a
  never-enabled family loan) yields `EMPTY_LOAN().started === false` and can never fire.
- **Crossing, not state**: wealth already above a threshold when the app is adopted
  (or when a milestone was true before this save) never celebrates — `before[k]` is
  already `true`. No seeding of `milestonesSeen` at onboarding is needed.
- **Once ever**: after celebrating, keys go into `state.ui.milestonesSeen`; a
  correction that dips the portfolio below 25% and a later re-cross stays silent.
- Detection runs **only in the check-in save path** (new entries AND edits — an edit
  can legitimately push a threshold). Entry deletion and assumption edits never
  celebrate and never un-see.

### 1.2 `coach.js` — Polish copy + seeded selection

Add below the `DECISION` block, reusing the existing `pickSeeded`:

```js
const MILESTONE_MSGS = {
  fi10: { title: '10% celu FIRE', variants: [
    'Pierwsza dziesiątka procent celu FIRE w portfelu. Najtrudniejszy krok — start — masz już za sobą.',
    '10% celu FIRE. Kula śniegowa ruszyła — od teraz procent składany pracuje razem z Tobą.',
  ]},
  fi25: { title: 'Ćwierć celu FIRE', variants: [
    '25% celu FIRE. Co czwarta złotówka Twojej wolności już jest Twoja — i pracuje.',
    'Ćwierć drogi za Tobą. Kolejne ćwiartki pójdą szybciej, bo portfel zaczął zarabiać sam.',
  ]},
  fi50: { title: 'Połowa celu FIRE', variants: [
    'Połowa celu FIRE! Od dziś portfel odkłada razem z Tobą — druga połowa przyjdzie szybciej niż pierwsza.',
    '50% celu. Połowa wolności kupiona. Wzrost z tej kwoty robi teraz więcej niż niejedna pensja.',
  ]},
  fi75: { title: '75% celu FIRE', variants: [
    'Trzy czwarte celu! Ostatnia prosta — największą robotę wykonuje teraz rynek, Ty tylko nie przeszkadzaj.',
    '75% celu FIRE. Widać metę. Utrzymaj kurs — nudna konsekwencja dowiezie resztę.',
  ]},
  fi100: { title: 'Cel FIRE osiągnięty!', variants: [
    'Portfel pokrył Twój cel FIRE. To jest ta liczba, do której szedłeś latami. Ogromna rzecz.',
    '100% celu FIRE w portfelu. Wolność finansowa przestała być planem — zaczęła być stanem konta.',
  ]},
  port100k: { title: 'Pierwsze 100 000 zł', variants: [
    'Pierwsze 100 000 zł w portfelu! Podobno najtrudniejsze. Od teraz każdy procent zwrotu to tysiąc złotych.',
    'Sześć cyfr w portfelu. 100 000 zł pracuje dla Ciebie dzień i noc — bez urlopu i bez L4.',
  ]},
  mortgageHalf: { title: 'Połowa kredytu spłacona', variants: [
    'Połowa kredytu za Tobą! Każda kolejna rata to coraz więcej kapitału i coraz mniej odsetek. Bank traci przewagę.',
    '50% kredytu spłacone. Druga połowa topnieje szybciej — odsetki maleją z każdym miesiącem.',
  ]},
  mortgageDone: { title: 'Kredyt spłacony!', variants: [
    'Zero. Kredyt spłacony w całości — dom jest Twój, a rata od dziś staje się nadwyżką. Wszystko idzie teraz na wolność.',
    'Ostatnia rata za Tobą. Koniec z odsetkami — cała nadwyżka pracuje teraz wyłącznie na FIRE.',
  ]},
  familyDone: { title: 'Dług rodzinny spłacony!', variants: [
    'Dług rodzinny oddany co do grosza. Słowo dotrzymane — a Twoja nadwyżka właśnie dostała podwyżkę.',
    'Rodzinne zobowiązanie zamknięte. Takich długów nie mierzy się tylko w złotówkach — brawo za dowiezienie.',
  ]},
};

// → { title, text } | null dla nieznanego klucza (UI wtedy pomija blok).
export function milestoneMessage(key, seed) {
  const m = MILESTONE_MSGS[key];
  return m ? { title: m.title, text: pickSeeded(m.variants, seed) } : null;
}
```

### 1.3 `motivation.js` — modal extension (pure builder)

Extend `checkinModal` backward-compatibly; render the milestone block between the badge
and the coach message, reusing the existing `.banner.success.small` classes (no
`styles.css` change):

```js
// milestone: null | { title, text, extraTitles: string[] }
export function checkinModal({ verdict, message, milestone = null }) {
  const ms = milestone ? `<div class="banner success small">🏆 <b>${esc(milestone.title)}</b><br>${esc(milestone.text)}${
    milestone.extraTitles && milestone.extraTitles.length
      ? `<br><span class="muted">A do tego: ${milestone.extraTitles.map(esc).join(' · ')}</span>` : ''
  }</div>` : '';
  return `<div class="modal-emoji">${verdictEmoji(verdict)}</div>
    <div class="badge v-${verdict}">${esc(verdictLabel(verdict))}</div>
    ${ms}
    <div class="modal-msg">${esc(message)}</div>
    <button class="btn primary wide" data-close-modal>Dalej 🔥</button>`;
}
```

### 1.4 `ui.js` — glue in the `#ci-save` handler (`renderCheckin`)

Immediately before the `E.applyCheckIn` try-block (next to the existing `prevFireYm`
capture), snapshot the milestone status from the current (pre-mutation) `state.derived`;
after a successful save, diff and record **before** `persist()`:

```js
const d0 = state.derived;
const msBefore = E.milestoneStatus(state, d0.balances, d0.debt, d0.family, d0.uptoYm);
// ... applyCheckIn succeeds (it runs recomputeDerived) ...
const d1 = state.derived;
const msAfter = E.milestoneStatus(state, d1.balances, d1.debt, d1.family, d1.uptoYm);
const crossed = E.newMilestones(msBefore, msAfter, state.ui.milestonesSeen);
if (crossed.length) state.ui.milestonesSeen = [...(state.ui.milestonesSeen || []), ...crossed];
persist();                       // seen-set rides the same save as the entry
renderCheckinResult(entry, { prevFireYm, wasFirst, prevEntry });
const seed = Math.floor(Math.random() * 1e6);
const ms = crossed.length ? milestoneMessage(crossed[0], seed) : null;
showModal(Mot.checkinModal({
  verdict: entry.verdict,
  message: checkinCelebration(entry.verdict, seed),
  milestone: ms ? { ...ms, extraTitles: crossed.slice(1).map(k => milestoneMessage(k, seed).title) } : null,
}));
```

Import `milestoneMessage` in the existing `coach.js` import line of `ui.js`.

---

## 2. Feature 2 — Annual report „Twój rok FIRE"

### 2.1 `engine.js` — math (pure), new section `// ── Raport roczny ──`

```js
// Pełny potok na kopii stanu z wpisami obciętymi do uptoYm i „zegarem"
// zamrożonym na uptoYm. Czysty (wzorzec projectionWith — płytka kopia).
// Obcięcie wpisów jest konieczne: assumedDelta patrzy na OSTATNIE wpisy,
// więc bez niego prognoza „sprzed roku" widziałaby przyszłość.
export function projectionAsOf(state, uptoYm) {
  const cut = ymToIdx(uptoYm);
  const st = { ...state, entries: state.entries.filter(e => ymToIdx(e.month) <= cut) };
  const plan = buildPlan(st);
  const debt = replayDebt(st, uptoYm);
  const family = replayFamilyLoan(st, uptoYm);
  const balances = replayBalances(st, uptoYm, debt, family);
  return projectFire(st, plan, balances, debt, family, uptoYm);
}

// Lata z co najmniej jednym wpisem, malejąco (punkt wejścia w Historii).
export function reportYears(state) {
  return [...new Set(state.entries.map(e => Number(e.month.slice(0, 4))))].sort((a, b) => b - a);
}

// Podsumowanie roku kalendarzowego `year`. null, gdy rok nie przecina się
// z planem (from > to). Wszystko realnie; assumptions są DZISIEJSZE dla obu
// prognoz — porównanie izoluje efekt wpisów z roku, nie zmian założeń
// (starych założeń nie da się odtworzyć — udokumentowana semantyka).
export function annualReport(state, year, now = new Date()) {
  const from = /* max(`${year}-01`, state.anchorMonth) via ymToIdx */;
  const to   = /* min(`${year}-12`, lastCompleteMonth(now)) via ymToIdx */;
  if (ymToIdx(from) > ymToIdx(to)) return null;
  const inYear = state.entries.filter(e => e.month >= from && e.month <= to)
    .sort((x, y) => (x.month < y.month ? -1 : 1));

  // Suma odłożone/plan + werdykty + najlepszy/najgorszy miesiąc (wzorzec planVsActualStats)
  let totalSaved = 0, totalPlanned = 0, best = null, worst = null;
  const verdicts = { crushed: 0, on_plan: 0, behind: 0, hard: 0 };
  for (const e of inYear) {
    const net = roundGrosze(e.earned - e.spent);
    totalSaved += net; totalPlanned += e.plannedSavingsSnapshot;
    if (verdicts[e.verdict] != null) verdicts[e.verdict]++;
    if (!best || net > best.net) best = { month: e.month, net };
    if (!worst || net < worst.net) worst = { month: e.month, net };
  }
  const goodMonths = inYear.filter(e => isGoodVerdict(e.verdict)).length;
  const bestRun = computeStreak(inYear).best;   // najdłuższa seria W ROKU

  // FI% na początek i koniec roku (balances: replay i tak czyta tylko ≤ upto)
  const prevEndYm = `${year - 1}-12`;
  const balPrev = replayBalances(state, prevEndYm);   // upto < anchor → salda startowe
  const balEnd  = replayBalances(state, to);
  const tPrev = fireTargetAt(state, prevEndYm), tEnd = fireTargetAt(state, to);
  const fiPctStart = tPrev > 0 ? balPrev.portfolio / tPrev : null;
  const fiPctEnd   = tEnd  > 0 ? balEnd.portfolio  / tEnd  : null;

  // Przesunięcie prognozy FIRE: prognoza „tylko wpisy do grudnia zeszłego
  // roku" vs „wpisy do końca raportowanego okresu". Znak jak w
  // renderCheckinResult: dodatni = FIRE WCZEŚNIEJ (skrócone miesiące).
  const projPrev = projectionAsOf(state, prevEndYm);
  const projNow  = projectionAsOf(state, to);
  const fireShiftMonths = (projPrev.reached && projNow.reached)
    ? monthsBetween(projNow.fireYm, projPrev.fireYm) : null;

  return {
    year, from, to,
    entriesCount: inYear.length,
    monthsInPlan: monthsBetween(from, to) + 1,
    totalSaved: roundGrosze(totalSaved), totalPlanned, delta: roundGrosze(totalSaved - totalPlanned),
    verdicts, goodMonths, bestRun, best, worst,
    fiPctStart, fiPctEnd,
    fiPctDelta: (fiPctStart != null && fiPctEnd != null) ? fiPctEnd - fiPctStart : null,
    reachedPrev: projPrev.reached, reachedNow: projNow.reached,
    fireYmPrev: projPrev.reached ? projPrev.fireYm : null,
    fireYmNow: projNow.reached ? projNow.fireYm : null,
    fireShiftMonths,
  };
}
```

Edge cases locked in:

- **Partial years clamp both ends**: a year starting mid-plan uses `from = anchorMonth`;
  the current year uses `to = lastCompleteMonth(now)` (a December render of the current
  year is a Jan–Nov report and says so via `from`/`to`).
- `prevEndYm` **before the anchor** is legal: `replayBalances`' loop doesn't run
  (returns start balances) and `projectionAsOf` degenerates to a plan-only projection —
  the "year one" report compares against the plan baseline. No special-casing.
- `fireShiftMonths === null` whenever either projection misses the 60-year horizon;
  the builder then shows the reached/unreached wording instead of a number.
- Zero entries in a plan-intersecting year still returns a report (`entriesCount: 0`) —
  the builder renders the "empty year" line; the Historia links only offer years from
  `reportYears`, so this occurs only via manual URL.

### 2.2 `analysis.js` — markup builder (pure)

New exported builder at the end of the file (reuses local `kv`, `table`, `metodologia`,
`money`, `signed`, `ymShort`):

```js
// rep = wynik engine.annualReport (nie-null); years = engine.reportYears(state)
export function annualReportScreen({ rep, years }) → string
```

Contents (all cards, mobile-first, no new CSS classes):

1. Header card `„Twój rok FIRE ${rep.year} 🔥"` with the covered range
   (`${ymShort(rep.from)} – ${ymShort(rep.to)}`) when the year is clamped.
2. „Odłożone w roku" — kv rows: `Odłożone razem` (`money(rep.totalSaved)`), `Plan na ten
   okres`, `Różnica` (signed, class `good`/`bad`), `Najlepszy miesiąc` /
   `Najsłabszy miesiąc` (month name + net).
3. „Seria i werdykty" — kv: `Dobre miesiące` (`X z Y wpisów`), `Najdłuższa seria w roku`
   (`🔥 N`), plus the four verdict counts (reuse the `verdictEmoji`/`verdictLabel`
   imports already present in `analysis.js`).
4. „Postęp do celu" — kv: `FI% na początku roku`, `FI% na końcu`, `Zmiana`
   (`Fmt.formatPct(rep.fiPctDelta, 1)` signed, in **percentage points** — label
   `pkt proc.`).
5. „Data FIRE" — one sentence (copy in §2.4) + `metodologia([...])` explaining: both
   projections use today's assumptions; only the set of entries differs.
6. Year navigation: prev/next year links for years present in `years` (plain `<a>` to
   `#/raport/YYYY`), and `<a class="btn ghost wide" href="#/history">← Historia</a>`.
7. `entriesCount === 0` → replace cards 2–5 with `<p class="muted">Brak wpisów w tym
   roku.</p>`.

### 2.3 `ui.js` — route + renderer + entry points

- **Route**: in `route()` add `else if (hash.startsWith('#/raport/')) renderRaport(hash.split('/')[2]);`
  In `activeRoute()` add `if (hash.startsWith('#/raport')) return '#/history';` (report
  belongs to the Historia tab). No `#tabbar` change.
- **`renderRaport(yearStr)`**: parse `const year = Number(yearStr)`; if not a safe
  integer (1900–2200) or `E.annualReport(state, year)` returns null → `location.hash =
  '#/history'; return;`. Otherwise `view().innerHTML = An.annualReportScreen({ rep,
  years: E.reportYears(state) });` — no event wiring beyond plain hash links.
- **Pulpit card (seasonal)**: in `renderDashboard`, right after the `due` banner block:

  ```js
  const nowMonth = Number(nowYm.slice(5));                    // 1..12
  const reportYear = nowMonth === 12 ? Number(nowYm.slice(0, 4))
                   : nowMonth === 1 ? Number(nowYm.slice(0, 4)) - 1 : null;
  if (reportYear != null && E.reportYears(state).includes(reportYear)) {
    html += `<div class="banner info">🎁 <b>Twój rok FIRE ${reportYear}</b> — zobacz podsumowanie:
      ile odłożone, jak seria, o ile przybliżyło się FIRE.
      <div class="btn-row"><a class="btn primary" href="#/raport/${reportYear}">Pokaż raport</a></div></div>`;
  }
  ```

  December shows the in-progress current year (anticipation), January the just-completed
  prior year (the December check-in lands Jan 1). The card itself computes **nothing**
  heavy — `annualReport` (two full projections) runs only on `#/raport/*`.
- **Historia entry point**: at the bottom of the history card (after the best-streak
  line): `Raporty roczne: <a href="#/raport/2026">2026</a> · …` from
  `E.reportYears(state)`; omit the whole line when empty.

### 2.4 Polish copy (report)

- FIRE-date sentence, by case:
  - shift > 0: `„Prognoza FIRE przyspieszyła w tym roku o ${Fmt.formatYearsMonths(shift)} — z ${monthName(fireYmPrev)} na ${monthName(fireYmNow)}. Tak wygląda kupowanie sobie czasu."`
  - shift < 0: `„Prognoza FIRE przesunęła się o ${Fmt.formatYearsMonths(-shift)} dalej — z ${monthName(fireYmPrev)} na ${monthName(fireYmNow)}. Jeden rok nie przekreśla planu: wnioski są w liczbach wyżej."`
  - shift === 0: `„Prognoza FIRE bez zmian: ${monthName(fireYmNow)}. Stabilnie — dokładnie tak buduje się wolność."`
  - `!reachedPrev && reachedNow`: `„Rok temu prognoza nie domykała się w horyzoncie — dziś FIRE ma datę: ${monthName(fireYmNow)}. To zasługa tego roku."`
  - `reachedPrev && !reachedNow`: `„Prognoza wypadła poza horyzont — zajrzyj do założeń i wpisów, liczby wyżej pokażą, co się zmieniło."`
  - neither: `„Prognoza FIRE jest poza 60-letnim horyzontem — raport pokazuje, co realnie udało się odłożyć."`
- Summary line under „Odłożone": delta ≥ 0 → `„Rok na plus względem planu. Tę nadwyżkę
  procent składany będzie powtarzał Ci przez dekady."`; delta < 0 → `„Rok poniżej planu —
  ale zmierzony, a co mierzysz, tym zarządzasz. Wybierz jedną rzecz do poprawy na nowy rok."`
- Metodologia lines: `„Obie prognozy liczone dzisiejszymi założeniami — porównujemy tylko
  wpisy: stan na koniec ${year−1} vs stan na ${ymShort(to)}."`, `„FI% = portfel ÷ cel FIRE
  w danym miesiącu (cel jest ruchomy)."`

---

## 3. Feature 3 — CSV export of check-in entries

### 3.1 `storage.js` — pure builder

Add under the `// ── Eksport / import ──` banner:

```js
export const CSV_BOM = 'FEFF';
const CSV_SEP = ';';
const CSV_EOL = '\r\n';   // RFC 4180 / Excel; runtime string, nie plik w repo

// Komórka tekstowa (dane użytkownika lub etykiety): najpierw strażnik
// przed wstrzyknięciem formuły (pierwszy znak =, +, -, @, TAB lub CR →
// prefiks apostrofu), potem cytowanie RFC 4180 (separator/cudzysłów/nowa
// linia → otoczenie "…" i podwojenie ").
function csvText(s) {
  let v = String(s ?? '');
  if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
  if (/[";\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}

// Komórka liczbowa generowana przez aplikację: przecinek dziesiętny, BEZ
// grupowania tysięcy, BEZ strażnika (wiodący minus to legalna liczba,
// nie formuła — liczb nie tworzy użytkownik). null → pusta komórka.
function csvNum(v) {
  return v == null ? '' : v.toFixed(2).replace('.', ',');
}

// CSV wszystkich wpisów (rosnąco po miesiącu) dla polskiego Excela:
// UTF-8 Z BOM, średniki, przecinek dziesiętny. verdictLabel wstrzykiwany
// (ui.js podaje polskie etykiety z coach.js — storage nie importuje NIC).
export function entriesToCSV(state, verdictLabel = v => v) {
  const header = ['miesiąc', 'zarobione', 'wydane', 'nadpłata kredytu',
    'nadpłata długu rodzinnego', 'korekta gotówki', 'korekta portfela',
    'plan oszczędności', 'wynik netto', 'werdykt', 'notatka',
    'utworzono', 'zaktualizowano'];
  const rows = [...state.entries]
    .sort((x, y) => (x.month < y.month ? -1 : 1))
    .map(e => [
      csvText(e.month),
      csvNum(e.earned), csvNum(e.spent),
      csvNum(e.overpayment || 0), csvNum(e.familyOverpayment || 0),
      csvNum(e.cashOverride), csvNum(e.balanceOverride),
      csvNum(e.plannedSavingsSnapshot),
      csvNum(Math.round((e.earned - e.spent) * 100) / 100),
      csvText(verdictLabel(e.verdict)),
      csvText(e.note || ''),                       // pole z partii C
      csvText(e.createdAt || ''), csvText(e.updatedAt || ''),
    ].join(CSV_SEP));
  return CSV_BOM + [header.map(csvText).join(CSV_SEP), ...rows].join(CSV_EOL) + CSV_EOL;
}
```

Locked-in rules (each has a test in §6):

- **BOM**: single `FEFF` as the very first character — without it Polish Excel decodes
  diacritics as mojibake. Never duplicated per line.
- **Semicolon separator + decimal comma**: Polish Excel locale expects exactly this pair;
  a decimal point or comma separator silently mangles amounts into dates/text.
- **No thousands grouping** in numeric cells (`1234,50`, not `1 234,50`).
- **Injection guard applies to text cells only** (`note` is user text; month/verdict/
  dates run through the same pipeline for uniformity and are unaffected). Numeric cells
  are app-generated and keep a leading `-` (a guarded `'-100,00` would break sums).
- `plannedSavingsSnapshot` is an unrounded float → `toFixed(2)` normalizes it.
- Batch C's `note` may be absent on pre-C entries → `e.note || ''`.

### 3.2 `ui.js` — glue in `renderBackup`

In the „Kopia zapasowa" card, under the JSON button:

```html
<button id="bk-export-csv" class="wide">📊 Eksportuj wpisy (CSV dla Excela)</button>
<p class="muted small">CSV to tylko podgląd wpisów w arkuszu — kopią zapasową
(do przywrócenia danych) jest wyłącznie plik JSON.</p>
```

Handler (mirror of `#bk-export`, without touching `lastExportAt`):

```js
$('#bk-export-csv').addEventListener('click', () => {
  const csv = entriesToCSV(state, verdictLabel);   // verdictLabel już importowany w ui.js
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  // <a download> jak w #bk-export; nazwa: fire-wpisy-RRRR-MM-DD.csv
  toast('CSV pobrany. Otwórz w Excelu lub arkuszu Google.');
});
```

Add `entriesToCSV` to the existing `storage.js` import line in `ui.js`.

---

## 4. Feature 4 — Backup nudge + one-tap .bak restore

### 4.1 `storage.js` — pure helpers

```js
// ~2 miesiące — ta sama liczba, której dziś używa renderBackup (61 dni).
export const BACKUP_STALE_MS = 61 * 24 * 3600 * 1000;

// Czy przypominać o kopii: są wpisy, a eksportu nie było nigdy albo dawno.
// nowMs jako parametr — czysta i testowalna w Node.
export function backupNudgeDue(state, nowMs = Date.now()) {
  if (!state || !state.entries || !state.entries.length) return false;
  const last = state.ui && state.ui.lastExportAt;
  return last == null || (nowMs - Date.parse(last)) > BACKUP_STALE_MS;
}
```

In `makeStorage(backing)` add (next to `load`):

```js
// Podgląd kopii awaryjnej sprzed ostatniego zapisu — bez żadnych mutacji.
// → { state, entriesCount, range } | { missing: true } | { corrupt: true, error }
loadBackup() {
  const raw = backing.getItem(BAK);
  if (raw == null) return { missing: true };
  try {
    const state = migrate(validateState(JSON.parse(raw)));
    const months = state.entries.map(e => e.month).sort();
    return { state, entriesCount: state.entries.length,
             range: months.length ? { from: months[0], to: months[months.length - 1] } : null };
  } catch (err) {
    return { corrupt: true, error: String(err && err.message || err) };
  }
},
```

**No `restoreBackup` method.** Restoring = adopt `loadBackup().state` and call the
normal `persist()` → `storage.save` copies the outgoing current state into `.bak` first,
so current and backup **swap**: a second restore undoes the first. This is the entire
safety story; document it in `docs/features/E.md` and in the UI copy.

### 4.2 `ui.js` + `app.js` — nudge glue

- Refactor `renderBackup`'s inline stale check
  (`const nudge = !last || (Date.now() - Date.parse(last)) > 61 * 24 * 3600 * 1000;`)
  to `const nudge = backupNudgeDue(state);` (import it).
- New export in `ui.js`:

```js
let backupNudgeShown = false;   // raz na otwarcie aplikacji (flaga sesji, nie persist)
export function maybeBackupNudge() {
  if (backupNudgeShown || !state) return;
  if ((location.hash || '#/') === '#/backup') return;      // już na miejscu
  if (!backupNudgeDue(state)) return;
  backupNudgeShown = true;
  const msg = state.ui.lastExportAt
    ? '💾 Dawno nie było kopii zapasowej — dotknij, aby wyeksportować dane.'
    : '💾 Twoje dane istnieją tylko na tym urządzeniu. Dotknij, aby zrobić pierwszą kopię zapasową.';
  toast(msg, 8000, () => { location.hash = '#/backup'; });
}
```

- `app.js`: call it only when the sticky `.bak`-recovery toast is **not** shown (both use
  the single `#toast` element):

```js
startApp(res.state || null);
if (res.recovered) {
  toast('⚠️ …', 0);          // istniejący kod bez zmian
} else {
  maybeBackupNudge();          // dopisz do importu z ui.js
}
```

### 4.3 `ui.js` — .bak restore card in `renderBackup`

New card between „Import" and „Instalacja na Androidzie":

```html
<div class="card"><h2>Cofnij ostatni zapis</h2>
  <p class="muted small">Aplikacja przed każdym zapisem odkłada poprzednią wersję danych
  (kopię awaryjną). Jeśli ostatnia zmiana coś zepsuła, możesz ją cofnąć jednym dotknięciem.</p>
  <button id="bk-bak" class="wide">↩️ Przywróć stan sprzed ostatniego zapisu</button>
  <div id="bk-bak-preview"></div>
</div>
```

Handler (mirrors the import-preview → confirm flow):

```js
$('#bk-bak').addEventListener('click', () => {
  const box = $('#bk-bak-preview');
  const p = storage.loadBackup();
  if (p.missing) { box.innerHTML = '<p class="muted small">Brak kopii awaryjnej — powstanie automatycznie przy najbliższym zapisie.</p>'; return; }
  if (p.corrupt) { box.innerHTML = `<div class="field-error">Kopia awaryjna jest nieczytelna (${esc(p.error)}).</div>`; return; }
  box.innerHTML = `<table class="preview">
    <tr><td>Wpisów</td><td>${p.entriesCount}</td></tr>
    <tr><td>Zakres</td><td>${p.range ? esc(Fmt.formatMonthName(p.range.from) + ' – ' + Fmt.formatMonthName(p.range.to)) : '—'}</td></tr>
    <tr><td>Stan</td><td>sprzed ostatniego zapisu</td></tr>
  </table>
  <p class="muted small">Obecne dane zostaną zastąpione tą kopią. Spokojnie — samo
  przywracanie też robi kopię, więc ponowne dotknięcie cofa przywrócenie.</p>
  <button id="bk-bak-go" class="danger wide" style="margin-top:.5rem">Przywróć te dane</button>`;
  $('#bk-bak-go').addEventListener('click', () => {
    state = p.state;
    E.recomputeDerived(state);
    persist();                       // save kopiuje dotychczasowy stan do .bak → swap
    applyTheme();
    toast('Przywrócono dane z kopii awaryjnej.');
    location.hash = '#/';
  });
});
```

(No wall-clock date exists in `.bak` — see §0; count + range + the "sprzed ostatniego
zapisu" label are the confirm-step facts.)

---

## 5. Persisted-state diff & migration (the full checklist)

Single new persisted field: **`state.ui.milestonesSeen: string[]`** (keys from
`MILESTONES_ORDER`). `lastExportAt` already exists; the nudge and CSV add **no** fields.

1. **Default** — `engine.js` `createState`: `ui: { theme: 'auto', installTipDismissed:
   false, reminderTipShown: false, lastExportAt: null, milestonesSeen: [] }` (plus
   whatever batch C added — merge, don't replace). Also bump the hardcoded `version:`
   literal in `createState` to the new number.
2. **`SCHEMA_VERSION`** — `storage.js`: bump by exactly one from the value batch C left.
   Expected: C left `3` → E sets `SCHEMA_VERSION = 4`. If C shipped without a bump
   (still 2), E sets 3 — check the file, don't assume.
3. **Migration** — extend the fall-through `switch` in `migrate` with the new step
   (shown here as `case 3:` for the expected numbering):

   ```js
   case 3:
     // v3 → v4: lista obejrzanych kamieni milowych.
     cur.ui = cur.ui || {};
     if (!Array.isArray(cur.ui.milestonesSeen)) cur.ui.milestonesSeen = [];
     cur.version = 4;
     // fall-through
   case 4:
     break;
   ```

4. **`validateState`** — **no addition.** `milestonesSeen` is not load-critical (a
   corrupted value can't brick the app: `newMilestones` tolerates `null`, and migration
   re-normalizes non-arrays on every load). Keeping `validateState` minimal is the
   existing convention (it guards only what would crash the replay pipeline).
5. Existing exports/imports keep working: `importPreview` already runs `migrate`, so old
   JSON backups gain `milestonesSeen: []` on import. `storage.load` rejects
   newer-version data as before (no change needed).

---

## 6. Tests — new fixtures & cases (`tests/fixtures.js` + `tests/test-engine.js`)

Follow the house pattern: `NOW = new Date(2026, 6, 15)`, `baseState`, `entry()`, `deep()`
helpers; `assertEq`/`assertClose`/`assertTrue`/`assertThrows`; append fixture comments in
Polish. Update `CLAUDE.md`'s test-count line and the F-range sentence at the end.

### F27 — milestones

Fixture `F27`: `{ thresholds: [0.10, 0.25, 0.50, 0.75, 1.0], port100k: 100000 }` plus a
mortgage variant reusing the F3 loan (1 100 000 zł @ 7% / 15 lat).

- **F27a `milestoneStatus` — progi FI%**: baseState (target 1 800 000), balances stub
  `{ portfolio: 179999 }` → `fi10 === false`; `180000 - EPS/2` → `true` (EPS tolerance);
  `450000` → `fi25 true, fi50 false`; `1800000` → all five `true`. `port100k` at
  `99999.99` false / `100000` true. Zero-expense state (`target === 0`) → every `fiXX`
  false, no division blowup.
- **F27b `newMilestones` — crossing + seen + priorytet**: before `{fi10:true, …}` /
  after `{fi10:true, fi25:true, port100k:true}` → `['fi25','port100k']` (priority order
  asserted: `fi25` before `port100k` per `MILESTONES_ORDER`); with `seen=['fi25']` →
  `['port100k']`; `seen=null` safe; `before[k]===true` never returned (no celebration
  for pre-existing wealth).
- **F27c kredytowe kamienie przez replay**: housePlan state; entries with `overpayment`
  large enough that `replayDebt` crosses `paidPct ≥ 0.5` in month M → status flips
  `mortgageHalf` between `uptoYm = M−1` and `M`; a final overpayment zeroing the balance
  flips `mortgageDone`; family-loan mirror flips `familyDone` at `endMonth`. No-mortgage
  state → `mortgageHalf/mortgageDone/familyDone` all false at any balance.
- **F27d integracja check-in**: full flow on state copies — derived before, `applyCheckIn`
  with a big-earn entry, derived after, `newMilestones` returns the crossed key; repeat
  the same crossing after adding the key to seen → empty array.
- **F27e `milestoneMessage`**: for every key in `MILESTONES_ORDER` and every seed
  `0..variants.length−1` — non-empty `title`/`text`, variants unique per key; seed
  modulo (`seed=7` ≡ `seed=7−len`); negative seed safe; unknown key → `null`.

### F28 — annual report

Fixture `F28`: `NOW2 = new Date(2027, 0, 15)` (last complete month `2026-12`), baseState
with `realReturnAnnual: 0, cashReturnReal: 0, expenseGrowthReal: 0, incomeGrowthReal: 0`
for integer arithmetic; entries `2026-07 … 2026-12` with `net = plan + 1000` each
(`plan = 4000` → net 5000; snapshots set via `applyCheckIn` so they're real).

- **F28a sumy i werdykty**: `annualReport(state, 2026, NOW2)` → `from '2026-07'`,
  `to '2026-12'`, `entriesCount 6`, `totalSaved 30000`, `totalPlanned 24000`,
  `delta 6000`; `verdicts.crushed === 6` (1000 ≥ 0.15·S dla S=4000 → sprawdź progi —
  jeśli nie, dobierz nadwyżkę 1500), `goodMonths 6`, `bestRun 6`; `best.net === worst.net`
  gdy równe wpłaty.
- **F28b FI% delta (r=0)**: `fiPctStart === portfolioStart / 1800000`,
  `fiPctEnd === (portfolioStart + 30000) / 1800000`, `fiPctDelta` closes the identity
  (assertClose, eps 1e-9).
- **F28c przesunięcie daty FIRE**: `fireShiftMonths > 0` (positive = earlier) for
  above-plan entries on a 5%-return state (use the plain baseState, not the r=0 variant —
  with r=0 the target is unreachable and `fireShiftMonths === null`, assert that too on
  the r=0 state as the null branch). Sign check: below-plan entries (`net = plan − 2000`)
  → `fireShiftMonths < 0`.
- **F28d obcięcie wpisów w `projectionAsOf`**: state with 6 entries;
  `projectionAsOf(state, '2026-09')` has the same `fireYm` as a state that never had the
  Oct–Dec entries (deep-equal `fireYm`, `delta`); **purity**: `JSON.stringify(state)`
  identical before/after both `projectionAsOf` and `annualReport` (F15a pattern).
- **F28e krawędzie**: `annualReport(state, 2025, NOW2) === null` (year entirely before
  anchor); year 2027 at `NOW2` → null (`from '2027-01' > to '2026-12'`); current partial
  year at `NOW = 2026-07-15` → `to === '2026-06'`; `reportYears` returns `[2026]`
  descending and `[]` for no entries.

### F29 — CSV export

Fixture `F29`: two entries — `2026-05` (earned 10234.5, spent 9000, note
`'=SUM(A1:A9)'`) and `2026-06` (earned 1000, spent 1100 → net −100, overrides null,
note `'średnio; "trudny" miesiąc\nale ok'`). Expected header string verbatim.

- **F29a BOM + nagłówek + separatory**: `csv.charCodeAt(0) === 0xFEFF`; the second BOM
  never appears (`csv.indexOf('FEFF', 1) === -1`); first line (after BOM) equals the
  header verbatim; a data line contains exactly 12 unquoted `;` (13 columns).
- **F29b przecinek dziesiętny, bez grupowania, minus**: line for `2026-05` contains
  `10234,50` (not `10 234,50`, not `10234.50`); net cell for `2026-06` is `-100,00`
  (leading minus **not** apostrophe-prefixed).
- **F29c strażnik formuł**: note cell renders as `'=SUM(A1:A9)` (apostrophe prefix);
  same for notes starting `+`, `-`, `@`, tab (parametrized loop); plain note `Zwykła
  notatka` unchanged; empty/missing note → empty cell.
- **F29d cytowanie RFC 4180**: the `2026-06` note cell is wrapped in quotes with `""`
  doubling and the embedded `\n` retained inside quotes (assert on the raw string —
  do not split lines naively); rows end with `\r\n` incl. the last.
- **F29e sortowanie + etykiety**: entries passed in reverse order come out ascending by
  month; default verdict cell is the raw key (`on_plan`); with
  `entriesToCSV(state, v => ({ on_plan: 'W planie' }[v] || v))` the cell is `W planie`.

### F30 — backup nudge, .bak restore, migration

- **F30a `backupNudgeDue`**: no entries → false even with `lastExportAt: null`; entries +
  `lastExportAt: null` → true; export 1 day ago (`nowMs − 86400e3`) → false; 62 days →
  true; exactly `BACKUP_STALE_MS` → false (strict `>`); malformed state (`ui` missing)
  → no throw.
- **F30b `loadBackup` podgląd**: `makeStorage(memoryBacking)` — save(A: income 10000),
  save(B: income 11000) → `loadBackup().state.assumptions.monthlyIncome === 10000`,
  `entriesCount`/`range` match A; fresh store → `{ missing: true }`; poisoned BAK
  (`backing.setItem(BAK, '{nope')`) → `{ corrupt: true }`.
- **F30c przywrócenie = swap (undo działa)**: after save(A), save(B): adopt
  `loadBackup().state` and `store.save(it)` → `load().state` is A **and**
  `loadBackup().state` is now B; repeat once more → back to B/A. This is the whole
  restore contract of §4.1.
- **F30d migracja `milestonesSeen`**: hand-built state at version N−1 (whatever C left)
  without `ui.milestonesSeen` → `migrate` adds `[]` and bumps to N; a state with
  `milestonesSeen: 'oops'` (non-array) → normalized to `[]`; `validateState` still
  passes; version N+1 still rejected by `validateState`; `createState().version === N`
  and `createState().ui.milestonesSeen` is `[]` (keeps the literal in sync).

---

## 7. Exact file-touch list

| File | Changes |
|---|---|
| `js/engine.js` | New section `// ── Kamienie milowe ──`: `MILESTONES_ORDER`, `milestoneStatus`, `newMilestones`. New section `// ── Raport roczny ──`: `projectionAsOf`, `reportYears`, `annualReport`. `createState`: `ui.milestonesSeen: []` default + bump the `version:` literal |
| `js/storage.js` | Bump `SCHEMA_VERSION` (+1 over batch C); new `migrate` case; `CSV_BOM`, `entriesToCSV` (+ local `csvText`/`csvNum`); `BACKUP_STALE_MS`, `backupNudgeDue`; `loadBackup()` inside `makeStorage` |
| `js/coach.js` | `MILESTONE_MSGS` + `milestoneMessage(key, seed)` (reuses `pickSeeded`) |
| `js/motivation.js` | `checkinModal` gains optional `milestone` param (backward-compatible) |
| `js/analysis.js` | `annualReportScreen({ rep, years })` builder (+ any tiny local helpers) |
| `js/ui.js` | `#ci-save`: milestone before/after hook + extended `showModal` call; `renderRaport` + `route()`/`activeRoute()` entries; Pulpit seasonal report banner; Historia „Raporty roczne" links; `renderBackup`: CSV button + handler, „Cofnij ostatni zapis" card + handlers, nudge condition refactored to `backupNudgeDue`; `maybeBackupNudge` export; extend imports (`milestoneMessage`, `entriesToCSV`, `backupNudgeDue`) |
| `js/app.js` | Import + call `maybeBackupNudge()` in the non-recovered branch |
| `tests/fixtures.js` | `F27`, `F28`, `F29`, `F30` blocks with Polish derivation comments |
| `tests/test-engine.js` | Tests F27a–e, F28a–e, F29a–e, F30a–d as specced in §6 |
| `CLAUDE.md` | Update test count + append F27–F30 to the fixture-coverage paragraph |
| `docs/features/E.md` (new) + `docs/INDEX.md` | Short maintenance doc (milestone keys are a schema; CSV rules; .bak swap semantics) + one index line |
| `sw.js` | **No change** — no new files, and version bumps are the release agent's job |
| `index.html`, `styles.css` | **No change** — reuse `#modal`/`#toast`, `banner`/`card`/`kv`/`preview` classes. If a distinct milestone style is truly needed, add the `--var` in all three theme blocks per CLAUDE.md |

## 8. Implementation order & verification

1. `storage.js` (schema bump + migration + CSV + nudge/loadBackup) → F29/F30 tests green.
2. `engine.js` milestones + `coach.js`/`motivation.js` copy → F27 green.
3. `engine.js` annual report → F28 green.
4. `ui.js`/`app.js`/`analysis.js` glue (no engine logic in ui — only event wiring,
   `state` mutation, `persist`, render calls).
5. `node tests/run-tests.js` — all green (121 existing + new).
6. Manual pass: check-in save crossing a milestone shows one modal with the banner;
   `#/raport/2026` renders and survives back-button; CSV opens in Excel/LibreOffice with
   Polish locale (amounts as numbers, diacritics intact, `=SUM` note inert); nudge toast
   appears once on a stale-export profile and navigates to `#/backup`; restore card
   preview → confirm → restore → restore again returns to the pre-restore state.
7. Subpath rehearsal (`cd .. && python -m http.server 8000` → `http://localhost:8000/fire/`)
   — CSV/restore use no absolute paths, but the rehearsal is a wave requirement.
8. Write `docs/features/E.md`, append to `docs/INDEX.md`. **No version bump, no commit.**
