# Plan F — Calculation-copy rewrite + navigation/IA cleanup

Batch F of the v1.14.0 wave (see `plans/00-master-plan.md`). **Implemented LAST**,
after batches A–E, because the copy sweep and the IA reorg must cover every screen
those batches add. Two deliverables:

- **Part 1 (user's #2 priority overall):** rewrite every calculation description so
  a person who cares about their finances — but is not a mathematician or IT person —
  understands what each number means for their life.
- **Part 2:** reorganize navigation/IA so the grown app (5 tabs, Plan hub, 7+
  Symulacja calculators, plus A–E's new screens) stays findable.

Binding conventions (from `CLAUDE.md` + master plan): UI copy in **Polish**, docs in
English; math in `engine.js`, markup in pure builders, DOM/state only in `ui.js`;
no new npm deps, no build step; **no version bump, no commits** (release agent does
that); `node tests/run-tests.js` must stay green.

---

## 0. Scope guardrails

- **Do NOT touch `js/engine.js` copy.** Engine-produced labels (`swrComparison`:
  `'Bardzo konserwatywne'`, `'Konserwatywne'`, `'Klasyczne'`, `'Twoje ustawienie'`)
  are asserted by tests (`tests/test-engine.js` line ~786 `assertEq(rows2[3].label,
  'Twoje ustawienie')`). All copy work happens in builders (`analysis.js`,
  `simulation.js`, `motivation.js`), `ui.js`, and `coach.js` (tone reference only —
  no changes needed there).
- **No new files** in the app shell → **no `PRECACHE` change in `sw.js`**. If any
  batch A–E left a new file un-precached, fix it, but F itself adds none.
- `format.js` untouched: all numbers keep flowing through `Fmt.formatPLN` /
  `formatPct` / `formatMonthName` (manual NBSP grouping — never hand-format a number
  in copy).
- Verdict labels in `coach.js` (`Ponad plan!` / `W planie` / `Poniżej planu` /
  `Ciężki miesiąc`) and all CELEBRATION/DECISION/MESSAGES variants are already the
  target tone — **leave them as-is**; they are the style reference for new copy.

---

## PART 1 — Plain-language rewrite of calculation descriptions

### 1.1 The plain-language principles (checklist — reused verbatim in §4)

Every new or edited user-facing string must pass all of these:

- **P1 — Short sentences, one idea each.** No nested clauses stacking three concepts.
- **P2 — No unexplained jargon.** Banned words unless wrapped in a „Co to znaczy?"
  explainer: *SWR, stopa realna/nominalna (bare), annuitet/annuita, percentyl,
  kapitalizacja, horyzont, delta, rezydualny, rekurencja, annuity-due, poszukiwanie
  binarne, indeks cen, PV/wartość obecna, sekwencja zwrotów, mnożnik (bare)*.
- **P3 — Say what the number means for the user's life**, not just what it is.
  („Starczy na 8 miesięcy życia bez pracy", not „runway: 8").
- **P4 — Always give the next step when a result is bad.** Point at a concrete
  place: „zmień założenia w Plan → Profil i FIRE", never a bare „zajrzyj do założeń".
- **P5 — Numbers only via `format.js`** (`formatPLN`, `formatPct`, `formatAgeYM`,
  `formatYearsMonths`, `formatMonthName`); never inline-format amounts in copy.
- **P6 — coach.js tone:** warm, direct, second person („Ty"), concrete, never
  condescending, no exclamation marks in analytical copy (celebratory copy may keep them).
- **P7 — Fixed vocabulary** (see glossary §1.4): *realnie* → „w dzisiejszych
  złotówkach"; *nominalnie* → „w przyszłych złotówkach" (projections) or „jak na
  umowie / z umowy" (loans); *annuitet* → „rata równa"; *SWR* → „stopa wypłat".
- **P8 — Formulas survive, demoted.** The `metodologia()` blocks („Jak to
  liczymy?") stay for power users, but their first line must be a plain-Polish
  sentence; symbol-only lines get a plain phrase in front or in parentheses.
- **P9 — Mobile fits:** `kv` labels ≤ ~35 chars; table headers short — move detail
  into a legend line under the table.
- **P10 — Polish copy, English identifiers/comments.**

### 1.2 The „Co to znaczy?" collapsible mechanism (spec)

Native `<details>`, mirroring the existing `metodologia()` pattern but visually
lighter and with plain prose instead of formula boxes.

**Builder helper** — add to `js/analysis.js` and export (reused by
`simulation.js`, which already imports from `analysis.js`; `ui.js` also imports
`analysis.js` so Plan/Pulpit screens can use it too — layering stays legal:
analysis is L2, simulation L3, ui L4):

```js
// analysis.js — obok metodologia()
export function explain(title, paragraphs) {
  // title: np. 'Co to znaczy: stopa wypłat?' — default 'Co to znaczy?'
  return `<details class="explain"><summary>${esc(title || 'Co to znaczy?')}</summary>
    ${paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}
  </details>`;
}
```

Rules: `paragraphs` are plain strings (escaped — no HTML injection), 1–3 short
paragraphs, ≤ ~45 words each. One `explain()` per term per card (don't repeat the
same explainer twice on one screen). Placement: directly under the heading or the
first `kv` that uses the term, **above** `metodologia()`.

**CSS** — add to `styles.css` (uses only existing custom props, so **no** edits to
the three theme blocks are needed):

```css
/* „Co to znaczy?" — lżejszy kuzyn details.section: proza, nie wzory */
details.explain {
  margin: .4rem 0 .6rem;
}
details.explain summary {
  cursor: pointer;
  color: var(--muted);
  font-size: .8rem;
  font-weight: 600;
  min-height: 40px;               /* dotyk */
  display: flex; align-items: center;
}
details.explain summary::before { content: 'ℹ️ '; margin-right: .3rem; }
details.explain p {
  font-size: .82rem;
  color: var(--text);
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: .55rem .7rem;
  margin: .3rem 0 0;
}
```

**Canonical explainer texts** (write once, reuse where mapped in §1.3; keep them
byte-identical across screens so users learn one phrasing):

| Key | Title | Body (Polish) |
|---|---|---|
| EXP-SWR | `Co to znaczy: stopa wypłat?` | `To procent oszczędności, który wypłacasz sobie co roku, gdy przestajesz pracować. Przy 4% potrzebujesz portfela równego 25 × Twoje roczne wydatki. Niższy procent = większy zapas bezpieczeństwa na słabe lata na giełdzie.` |
| EXP-REAL | `Co to znaczy: dzisiejsze i przyszłe złotówki?` | `„W dzisiejszych złotówkach" znaczy: po odjęciu inflacji — tyle, ile ta kwota jest warta dziś. „W przyszłych złotówkach" to kwota, którą wtedy zobaczysz na koncie; wygląda na większą, ale kupisz za nią tyle samo. Dzięki temu możesz porównywać kwoty z różnych lat.` |
| EXP-COAST | `Co to znaczy: Coast FIRE?` | `To taka wielkość portfela, przy której możesz przestać dopłacać: same zyski z inwestycji urosną do Twojego celu na docelowy wiek FIRE. Po jej osiągnięciu wystarczy zarabiać na bieżące życie.` |
| EXP-ANNU | `Co to znaczy: rata równa?` | `Kredyt spłacany taką samą kwotą co miesiąc. Na początku większość raty to odsetki, pod koniec — prawie sam kapitał. Tak działa typowy kredyt hipoteczny w Polsce.` |
| EXP-TARGET | `Co to znaczy: cel ruchomy?` | `Twoja kwota FIRE to roczne wydatki podzielone przez stopę wypłat. Jeśli w założeniach wydatki rosną (styl życia drożeje), cel rośnie razem z nimi — dlatego na wykresie powoli „ucieka" do przodu.` |
| EXP-PROJ | `Skąd bierze się prognoza?` | `Zaczynamy od Twojego planu oszczędzania. Po trzech wpisach dodajemy do niego średnią różnicę między planem a Twoimi realnymi wynikami — prognoza uczy się z tego, jak naprawdę Ci idzie.` |
| EXP-NOMLOAN | `Dlaczego kredyt liczymy inaczej?` | `Kredyt i dług rodzinny to umowy w „przyszłych złotówkach" — bank nie obniży Ci raty, bo była inflacja. Dlatego ich kwoty pokazujemy tak, jak na umowie, a obok przeliczamy na dzisiejsze złotówki, żeby dało się je porównać z resztą planu.` |

Batch-A/B sweep (§4) adds analogous entries: EXP-PERC (percentyle), EXP-SEQ
(sekwencja zwrotów), EXP-BARISTA, EXP-BRIDGE (most do emerytury/ZUS), EXP-BELKA,
EXP-IKE (IKE/IKZE) — texts drafted by the implementer using the same pattern.

### 1.3 Complete copy inventory & before → after table

Full inventory of calculation-adjacent strings, screen by screen. **Verdict `keep`**
= already plain (listed so the sweep is provably complete); **`rewrite`** = replace
with the new text; **`+EXP-x`** = additionally insert that explainer at this spot.
Grep anchors are unique substrings of the current text.

#### A. Pulpit — `js/ui.js` (`renderDashboard`, `fireJourneyHero`, `goalSavingsHTML`)

| # | Location (grep anchor) | Current | Verdict / New Polish text |
|---|---|---|---|
| A1 | `Twoja kwota FIRE: roczne wydatki` (hero tip, ~l.721) | `Twoja kwota FIRE: roczne wydatki ÷ stopa wypłat. Cel jest ruchomy — rośnie razem z planowanym wzrostem wydatków.` | rewrite: `Twoja kwota FIRE to portfel, z którego możesz żyć bez pracy: roczne wydatki ÷ stopa wypłat (przy 4% to 25 × roczne wydatki). Cel powoli rośnie, bo w założeniach Twoje wydatki też rosną.` |
| A2 | `Do spłaty (realnie)` (~l.695) | `Do spłaty (realnie)` | rewrite: `Do spłaty (w dzisiejszych złotówkach)` |
| A3 | `(nom. ` (~l.696–697, 2×) | `kredyt: X (nom. Y)` / `dług rodzinny: X (nom. Y)` | rewrite: `kredyt: X (na umowie: Y)` / `dług rodzinny: X (na umowie: Y)` |
| A4 | `Strategia: najpierw dług` (~l.703) | `Strategia: najpierw dług, potem inwestowanie — każda nadpłata przybliża datę wyżej.` | keep |
| A5 | `poza 60-letnim horyzontem` (~l.725 i ~l.820, 2×) | `Przy obecnym planie cel FIRE jest poza 60-letnim horyzontem — zajrzyj do założeń.` | rewrite: `Przy obecnym planie nie osiągniesz celu w ciągu 60 lat prognozy. Zwiększ oszczędności albo zmień założenia w Plan → Profil i FIRE.` |
| A6 | `Postęp całej drogi oszczędzania` (journey tip, ~l.829) | `Postęp całej drogi oszczędzania: suma tego, co już odłożone, do sumy potrzebnej do FIRE (dom + dług + inwestycje), ważona wzrostem inwestycji. W realnych zł, więc inflacja uwzględniona. Pasek tylko rośnie.` | rewrite: `Ten pasek mierzy całą Twoją drogę: ile już odłożone (dom + spłata długu + inwestycje) wobec tego, ile łącznie potrzeba do FIRE. Wcześniejsze wpłaty liczą się mocniej, bo dłużej pracują. Pasek nigdy się nie cofa.` |
| A7 | `Gdybyś wynajmował na zawsze` (~l.726) | keep | keep |
| A8 | `Miesiąc budowy: plan zakłada niedobór` (banner, ~l.663) | `🏗️ Miesiąc budowy: plan zakłada niedobór X. Cel = dyscyplina budżetu, nie odkładanie.` | rewrite: `🏗️ Miesiąc budowy: plan zakłada, że wydasz o X więcej, niż zarobisz. Twoim celem jest teraz trzymanie budżetu, nie odkładanie.` |
| A9 | `Cel wieku ${age} jest poza zasięgiem` (goalSavingsHTML) | `Cel wieku X jest poza zasięgiem nawet przy dużych oszczędnościach — zajrzyj do założeń lub wybierz późniejszy wiek.` | rewrite: `Cel wieku X jest poza zasięgiem nawet przy dużych oszczędnościach. Wybierz późniejszy wiek albo zmień założenia w Plan → Profil i FIRE.` |
| A10 | `Jesteś na dobrej drodze — odkładając` | keep | keep |
| A11 | `utrzymaj dyscyplinę i dołóż` (build-month need) | keep | keep |
| A12 | `Portfel pokrywa Twoje wydatki przy bezpiecznej stopie wypłat` (~l.719) | keep, +EXP not needed (banner) | keep |
| A13 | legend `cel ruchomy` (~l.736) | `cel ruchomy` | rewrite: `cel (rośnie z wydatkami)` |
| A14 | `prognoza wg planu — po 3 wpisach użyję` (~l.724) | keep | keep |
| A15 | Balances cards `Gotówka 💵` / `Inwestycje 📈` | keep | keep |
| A16 | „Dzisiejsza decyzja" card copy (`motivation.js decisionCard`) | keep | keep |

Additionally on Pulpit: under the hero card of the accumulation mode, after the
`Portfel vs cel` chart legend, add `explain(EXP-TARGET)` once.

#### B. Check-in — `js/ui.js` (`renderCheckin`, `renderCheckinResult`)

| # | Location | Current | Verdict / New |
|---|---|---|---|
| B1 | `Plan na ten miesiąc` banner | `Plan na ten miesiąc: X (miesiąc budowy — plan zakłada niedobór)` | rewrite parenthesis: `(miesiąc budowy — plan zakłada, że wydasz więcej, niż zarobisz)` |
| B2 | tip `Wszystkie dochody netto w tym miesiącu.` | keep | keep |
| B3 | hint `Razem z czynszem i ratą kredytu.` | keep | keep |
| B4 | tip `Kwota wpłacona na kredyt PONAD ratę…` (2× kredyt/rodzinny) | keep | keep |
| B5 | `Popraw salda (opcjonalnie)` + intro | keep | keep |
| B6 | result `plan: X · +Y` line | keep | keep |
| B7 | `Kredyt (realnie)` / `Dług rodzinny (realnie)` (renderCheckinResult kv) | rewrite: `Kredyt (w dzisiejszych zł)` / `Dług rodzinny (w dzisiejszych zł)` |
| B8 | empty state `Nie ma jeszcze żadnego zakończonego miesiąca…` | keep | keep |

#### C. Historia — `js/ui.js` (`renderHistory`)

All strings (`brak wpisu — dotknij, aby uzupełnić`, `odłożone X · +Y vs plan`,
`Cofa start planu o miesiąc…`, `Najdłuższa seria`) — **keep**; already plain.

#### D. Analiza → Przegląd — `js/analysis.js` (`statsCard`, `planPerfCard`)

| # | Location | Current | Verdict / New |
|---|---|---|---|
| D1 | `FI% (postęp do celu)` | kv label | rewrite: `Postęp do FIRE` |
| D2 | `Cel FIRE (dziś)` | kv label | rewrite: `Twoja kwota FIRE (dziś)` — +`explain(EXP-TARGET)` under this card's kv list |
| D3 | `Coast FIRE` | kv label | keep label, +`explain(EXP-COAST)` |
| D4 | `Zapas (runway)` | kv label | rewrite: `Na ile starczy bez pracy` |
| D5 | `Wzrost rynkowy od startu` | kv label | rewrite: `Zysk z inwestycji od startu` |
| D6 | `Majątek netto = gotówka + portfel − dług (realnie), bez wartości domu.` | footnote | rewrite: `Majątek netto = gotówka + portfel − dług, w dzisiejszych złotówkach, bez wartości domu.` |
| D7 | `Coast FIRE = portfel, który bez dalszych wpłat sam dorośnie…` | footnote | delete (redundant with EXP-COAST) |
| D8 | metodologia `FI% = portfel ÷ cel = …` | formula | keep, prefix line: `Postęp = jaki procent kwoty FIRE już masz w portfelu.` |
| D9 | metodologia `Zapas = (gotówka + portfel) ÷ wydatki mies.` | formula | keep, prefix: `Zapas = na ile miesięcy życia starczą dziś wszystkie Twoje oszczędności, gdyby dochód spadł do zera.` |
| D10 | `Stopa oszczędzania (ostatni mies.)` (+12 mies., od początku) | kv labels | keep labels, + one `explain('Co to znaczy: stopa oszczędzania?', ['To procent zarobków, który udało Ci się zatrzymać: (zarobione − wydane) ÷ zarobione. Im wyższa, tym szybciej rośnie Twoja wolność — to najważniejsza pojedyncza liczba w drodze do FIRE.'])` |
| D11 | `Skumulowana różnica vs plan` | kv label | rewrite: `Łącznie: różnica vs plan` |
| D12 | metodologia `Plan każdego miesiąca to snapshot zamrożony…` | line | rewrite: `Plan każdego miesiąca zapisujemy w chwili check-inu. Późniejsza zmiana założeń nie przepisuje przeszłych ocen.` |
| D13 | empty state `Jeszcze brak wpisów — statystyki pojawią się po pierwszym check-inie.` | keep | keep |

#### E. Analiza → Prognoza — `js/analysis.js` (`projectionCard`, `sensitivityCard`)

| # | Location | Current | Verdict / New |
|---|---|---|---|
| E1 | `Projekcja — akumulacja 📈` | h2 | rewrite: `Prognoza: jak rośnie portfel 📈` — +`explain(EXP-PROJ)` right under seg |
| E2 | seg `Excel` | tab label | keep (proper noun; explained by E8) |
| E3 | headers `Saldo pocz.` / `Saldo końc.` | table | rewrite: `Na początku` / `Na końcu` (yearly, monthly, Excel and withdrawal tables alike) |
| E4 | header `Wzrost` | table | rewrite: `Zysk` |
| E5 | header `Dług (real.)` | table | rewrite: `Dług` + legend line under table: `Dług i wszystkie kwoty — w dzisiejszych złotówkach.` |
| E6 | (new) legend under yearly/monthly table | — | add: `<p class="muted small">Szare wiersze to prognoza. Wiersz z 🔥 — miesiąc/rok osiągnięcia FIRE.</p>` |
| E7 | metodologia `Saldo końc. = saldo pocz. + wpłaty + wzrost — tożsamość zachodzi dokładnie; wzrost jest rezydualny.` | line | rewrite: `Saldo na końcu = saldo z początku + wpłaty + zysk. „Zysk" to cała reszta zmiany salda, której nie wyjaśniają wpłaty — dzięki temu tabela zawsze dokładnie się sumuje.` |
| E8 | metodologia Excel `Konwencja arkusza Projekcja: … kapitalizacja ROCZNA.` + 2 lines | lines | rewrite (3 lines): `Ta zakładka liczy jak arkusz kalkulacyjny: cały rok naraz, (saldo + wpłaty) × (1 + zwrot).` / `Start = dzisiejszy portfel (X); wpłaty roczne = plan bieżącego miesiąca × 12 (Y).` / `Aplikacja liczy dokładniej — miesiąc po miesiącu i zna Twoje fazy (dom, kredyt). Zakładka Excel służy do porównania z własnym arkuszem.` |
| E9 | metodologia `Lata planu to bloki 12 miesięcy od startu planu (kotwicy)…` | line | rewrite: `Rok 1 zaczyna się w miesiącu startu planu, nie w styczniu.` |
| E10 | metodologia `Prognozowane miesiące = plan + delta z ostatnich wpisów (+X/mies.).` | line | rewrite: `Prognoza = Twój plan + średnia różnica z Twoich dotychczasowych wyników (+X/mies.).` |
| E11 | metodologia `Kolumna „Dług (real.)" to suma kredytu i długu rodzinnego (realnie).` | line | rewrite: `Kolumna „Dług" to kredyt + dług rodzinny, w dzisiejszych złotówkach.` |
| E12 | metodologia `Tabela kończy się w miesiącu osiągnięcia FIRE…` | line | rewrite: `Tabela kończy się w miesiącu osiągnięcia FIRE — dalsze lata znajdziesz w sekcji Emerytura.` (label matches new IA, §2) |
| E13 | `Wrażliwość prognozy 🎛️` | h2 | rewrite: `Co przesuwa datę FIRE? 🎛️` |
| E14 | intro `Jak przesuwa się data FIRE, gdy zmienisz jedno założenie (reszta bez zmian).` | keep | keep |
| E15 | `Stopa wypłat (SWR)` (mini-table title) | h3 | rewrite: `Stopa wypłat` + `explain(EXP-SWR)` directly above this mini-table |
| E16 | header `Mnożnik` | table | rewrite: `Ile × rocznych wydatków` |
| E17 | header `Różnica vs 4%` | keep | keep |
| E18 | metodologia `Cel przy SWR = roczne wydatki ÷ SWR; mnożnik = 1 ÷ SWR (4% → 25× rocznych wydatków).` | line | rewrite: `Cel = roczne wydatki ÷ stopa wypłat. Przy 4% potrzebujesz 25 × rocznych wydatków, przy 3% — ponad 33 ×.` |
| E19 | engine labels `Bardzo konserwatywne` / `Klasyczne` / `Twoje ustawienie` | data from engine | **keep — do not touch** (test-asserted) |

#### F. Analiza → Emerytura (dziś: „Faza wypłat" + „Do zera") — `js/analysis.js` (`withdrawalCard`, `dieWithZeroCard`, `dieWithZeroResult`)

| # | Location | Current | Verdict / New |
|---|---|---|---|
| F1 | `Faza wypłat 🏖️` | h2 | rewrite: `Po FIRE: życie z portfela 🏖️` — +`explain(EXP-REAL)` under heading (once for the whole section) |
| F2 | headers `Saldo pocz. (nom.)` / `Wypłata (nom.)` / `Wzrost (nom.)` / `Saldo końc. (nom.)` / `Saldo końc. (realnie)` (2 tables: withdrawal + do zera) | table | rewrite: `Na początku` / `Wypłata` / `Zysk` / `Na końcu` / `Na końcu (dzisiejsze zł)` + legend under table: `Kwoty bez dopisku — w przyszłych złotówkach (tak, jak zobaczysz je wtedy na koncie).` |
| F3 | banner `FIRE poza horyzontem prognozy — scenariusz modelowy od dzisiejszego celu (X).` | 2× (withdrawal, do zera) | rewrite: `Prognoza nie sięga daty FIRE, więc pokazujemy scenariusz przykładowy: start od dzisiejszej kwoty celu (X).` |
| F4 | legend `saldo (— realnie, ⋯ nominalnie)` | chart legend | rewrite: `saldo (— dzisiejsze zł, ⋯ przyszłe zł)` (same in „Do zera" chart) |
| F5 | depletion banner `⚠️ Portfel wyczerpuje się w N. roku wypłat — rozważ niższą stopę wypłat lub większy portfel.` | keep, extend | rewrite: `⚠️ Portfel kończy się w N. roku wypłat. Obniż stopę wypłat w Plan → Profil i FIRE albo celuj w większy portfel.` |
| F6 | metodologia `Wypłata (rok 1) = cel × SWR = …; rośnie z inflacją X.` | line | rewrite: `Wypłata w 1. roku = kwota FIRE × stopa wypłat (X × Y = Z/rok). Co roku wypłacasz tyle samo w dzisiejszych złotówkach — kwota na koncie rośnie z inflacją.` |
| F7 | metodologia `R nominalne = (1+r)·(1+i) − 1 = …` | line | rewrite: `Zwrot „na koncie" = zwrot ponad inflację złożony z inflacją: (1+X)·(1+Y) − 1 = Z.` |
| F8 | metodologia `Saldo końc. (realnie) = (saldo pocz. − wypłata) × (1+r) — rekurencja w dzisiejszych zł; kolumny nominalne = realne × (1+inflacja)^n.` | line | rewrite: `Rok po roku: (saldo − wypłata) × (1 + zwrot), w dzisiejszych złotówkach. Kolumny „przyszłe zł" to te same kwoty przeliczone na ceny danego roku.` |
| F9 | metodologia `Kwoty nominalne w złotówkach z cen roku przejścia na FIRE (indeks cen = 1 w …).` | line | rewrite: `Punkt odniesienia dla cen: miesiąc przejścia na FIRE (…).` |
| F10 | `Życie do zera ⏳` h2 + intro `Klasyczny cel (4%) ma starczyć na zawsze…` | keep (already plain and good) | keep |
| F11 | `Cel „do zera"` / `Cel klasyczny (4%, ten sam miesiąc)` | kv | keep first; rewrite second: `Cel klasyczny (liczony w tym samym miesiącu)` |
| F12 | `Lata wypłat (N)` | kv | rewrite: `Ile lat wypłat` |
| F13 | metodologia `Cel = W₁·(1−qᴺ)/(1−q), q = 1/(1+r) = PV renty…` | line | rewrite: `Cel „do zera" to kwota, która przy Twoim zwrocie wystarcza dokładnie na N lat stałych wypłat — w wieku X portfel = 0. (Wzór dla dociekliwych: W₁·(1−qᴺ)/(1−q), q = 1/(1+r).)` |
| F14 | metodologia `Cel klasyczny do porównania liczony w tym samym miesiącu… porównanie z dwóch dat byłoby mylące.` | line | rewrite: `Oba cele liczymy na ten sam miesiąc (…), żeby porównanie było uczciwe — cele rosną w czasie razem z wydatkami.` |
| F15 | metodologia `Tabela startuje od dokładnie celu… Wiek N to pełne lata (podłoga z wieku).` | line | rewrite: `Tabela zaczyna się dokładnie od kwoty celu — dlatego kończy się równo na 0 zł. Liczbę lat wypłat zaokrąglamy w dół do pełnych lat.` |
| F16 | `Uzupełnij datę urodzenia w Plan → Profil, aby policzyć…` | keep | keep |

#### G. Analiza → Kredyty — `js/analysis.js` (`mortgageCard`, `familyLoanCard`, `remainingSection`, legends)

Both cards get `explain(EXP-NOMLOAN)` under the h2 (once per card) and
`explain(EXP-ANNU)` inside metodologia is NOT needed — instead the first
metodologia line is rewritten (G8).

| # | Location | Current | Verdict / New |
|---|---|---|---|
| G1 | `Saldo (nominalnie)` (2×) | kv | rewrite: `Saldo (jak na umowie)` |
| G2 | `Odsetki pozostałe (sama rata)` (2×) | kv | rewrite: `Odsetki jeszcze do zapłaty (bez nadpłat)` |
| G3 | `Pozostało do spłaty (sama rata)` (2×) | kv | rewrite: `Razem do spłaty (bez nadpłat)` |
| G4 | `Oszczędność z nadpłat (dotychczas)` (2×) | keep | keep |
| G5 | `Przed harmonogramem kontraktu` (2×) | kv | rewrite: `Wyprzedzasz harmonogram o` |
| G6 | `Spłata wg kontraktu` / `Spłata przy samej racie` / `Spłata prognozowana (z nadpłatami)` (2×) | kv | rewrite: `Koniec kredytu wg umowy` / `Koniec przy samej racie` / `Koniec z nadpłatami (prognoza)` (family card: `Koniec spłaty wg umowy` …) |
| G7 | h3 `Saldo nominalne: sama rata vs z nadpłatami` (2×) | h3 | rewrite: `Jak topnieje dług: sama rata vs z nadpłatami` |
| G8 | metodologia `Rata = X/mies. (annuitet, nominalnie — kredyt to jeden z dwóch nominalnych kontraktów…)` (2× variants) | line | rewrite: `Rata równa X/mies. Kwoty kredytu podajemy tak, jak na umowie i wyciągu z banku — bez przeliczania na dzisiejsze złotówki.` |
| G9 | metodologia `Oszczędność = Σ odsetek kontraktu − zapłacone − pozostałe wg harmonogramu = …` (2×) | formula | keep, prefix: `Oszczędność z nadpłat = odsetki z umowy − już zapłacone − te, które jeszcze zapłacisz:` |
| G10 | metodologia `Prognoza „z nadpłatami" zakłada strategię aplikacji: cała miesięczna nadwyżka nadpłaca kredyt…` | keep | keep |
| G11 | metodologia `Wykres „Ile zostało do spłaty": na początku każdego roku kredytu saldo kapitału + suma wszystkich przyszłych odsetek; blade słupki = kontrakt…` (2× variants) | line | rewrite: `Wykres „Ile zostało do spłaty": każdy słupek = to, co w danym roku jeszcze oddasz bankowi (kapitał + wszystkie przyszłe odsetki). Blade słupki — spłata wg umowy; pełne — Twoja faktyczna droga z nadpłatami.` |
| G12 | remainingSection note `Słupek = stan na początku roku kredytu… to miesiące szybszej wolności od długu.` | keep | keep |
| G13 | legend `kontrakt (blade)` (remainingLegend) | legend | rewrite: `wg umowy (blade)` |
| G14 | family metodologia `Dług rodzinny ma harmonogram stały — nie jest agresywnie nadpłacany; przyspieszają go tylko jawne nadpłaty z check-inu.` | keep | keep |
| G15 | legend `historia + prognoza z nadpłatami` / `sama rata` | keep | keep |

#### H. Symulacja — `js/simulation.js`

| # | Location | Current | Verdict / New |
|---|---|---|---|
| H1 | `nadwyzkaNote()` full text | keep — model plain-language copy | keep |
| H2 | whatIfCard intro + hint | keep | keep |
| H3 | whatIf metodologia both lines | keep | keep |
| H4 | targetAge metodologia `Poszukiwanie binarne minimalnej dodatkowej kwoty/mies.…` | line | rewrite: `Aplikacja sprawdza kolejne kwoty dopłaty (dzieląc przedział na pół) i wybiera najmniejszą, przy której zdążysz przed zadanym wiekiem.` |
| H5 | targetAge metodologia `Każdy krok to pełny przebieg prognozy — funkcja monotoniczna: więcej oszczędności ⇒ FIRE nie później.` | line | rewrite: `Każda próba to pełne przeliczenie prognozy. Więcej oszczędności nigdy nie opóźnia FIRE, więc wynik jest jednoznaczny.` |
| H6 | targetAge infeasible banner `Nawet dodatkowe X/mies. nie wystarczą… Spróbuj późniejszego wieku albo zajrzyj do założeń.` | banner | rewrite ending: `…Spróbuj późniejszego wieku albo zmień założenia w Plan → Profil i FIRE.` |
| H7 | latte metodologia `Wartość przyszła równych wpłat (annuity-due) przy Twoim realnym zwrocie — kwoty w dzisiejszych złotówkach.` | line | rewrite: `Liczymy, ile urośnie stała miesięczna wpłata przy Twoim zwrocie ponad inflację (wpłata na początku miesiąca). Wynik w dzisiejszych złotówkach.` |
| H8 | moreSavings metodologia | keep | keep |
| H9 | returnCard intro `Rynkowy zwrot jest niepewny. Zobacz, jak realny zwrot roczny przesuwa datę FIRE…` | intro | rewrite: `Nikt nie zna przyszłych zysków z giełdy. Zobacz, jak zwrot ponad inflację przesuwa Twoją datę FIRE (reszta założeń bez zmian).` |
| H10 | returnCard metodologia `Suwak zmienia tylko realny zwrot roczny… (± 3 pp wokół Twojego założenia).` | line | rewrite: `Suwak zmienia tylko roczny zwrot ponad inflację — o ±3 punkty procentowe wokół Twojego założenia — i przelicza całą prognozę.` |
| H11 | returnCard label `Realny zwrot roczny` + result kv `Realny zwrot` | labels | rewrite: `Zwrot ponad inflację (rocznie)` / `Zwrot ponad inflację` |
| H12 | overpayment metodologia line 1 `Punkt wyjścia to spłata „przy samej racie": bieżące saldo + rata kontraktowa…` | line | rewrite: `Punkt wyjścia: bieżące saldo i sama rata z umowy, bez nadpłat. Prognoza FIRE i tak nadpłaca kredyt hipoteczny całą nadwyżką — ten kalkulator odpowiada na prostsze pytanie: co daje stała nadpłata X.` |
| H13 | loanCalc metodologia `Rata liczona metodą raty równej (annuitet): stałe oprocentowanie przez cały okres, kapitalizacja miesięczna. Miesięczna stopa to (1+roczna)^(1/12)−1.` | line | rewrite: `Rata równa przez cały okres, przy stałym oprocentowaniu. Miesięczny procent dobieramy tak, by 12 miesięcy złożyło się dokładnie na procent roczny.` + `explain(EXP-ANNU)` under card intro |
| H14 | loanCalc/overpayment legend `sama rata (blade)` / `z nadpłatą (pełne)` | keep | keep |
| H15 | result kv labels (`Spłata przy samej racie`, `Szybciej o`, `Odsetki zaoszczędzone` …) | keep | keep |
| H16 | simulationResult note `Wybrany miesiąc wypada po prognozowanej dacie FIRE — ta kwota nic już nie zmienia.` | keep | keep |

#### I. Plan & onboarding — `js/ui.js` (tips/hints in `renderOnboarding`, `renderPlanFire`, `renderPlanFinanse`, `renderPlanDom`, `renderPlanKorekty`)

| # | Location | Current | Verdict / New |
|---|---|---|---|
| I1 | label `Stopa wypłat (WR)` (onboarding `ob-wr` + plan `pl-wr`) | label | rewrite: `Stopa wypłat` (drop the acronym) |
| I2 | `ob-wr` tip `Ile procent portfela wypłacasz rocznie po FIRE. 4% to klasyka; niższa wartość = większy bufor bezpieczeństwa na złe sekwencje rynkowe.` | tip | rewrite: `Ile procent oszczędności wypłacasz sobie co roku po FIRE. Przy 4% potrzebujesz portfela = 25 × roczne wydatki. Mniejszy procent = większy zapas na słabe lata na giełdzie.` |
| I3 | `pl-wr` tip `Wskaźnik bezpieczeństwa: … wobec ryzyka sekwencji złych lat na rynku.` | tip | rewrite: same text as I2 (unify) |
| I4 | `ob-return`/`pl-return` tip `Zwrot PONAD inflację. 5% realnie ≈ 8% nominalnie przy inflacji 3%.` / `Zwrot ponad inflację. Wszystko w aplikacji liczone jest w dzisiejszych złotówkach.` | tips | rewrite (unify): `Zysk z inwestycji PONAD inflację. Przykład: fundusz zarabia 8%, inflacja 3% → zostaje ok. 5%. Dzięki temu wszystkie kwoty w aplikacji są w dzisiejszych złotówkach.` |
| I5 | `ob-infl`/`pl-infl` tip `Używana tylko do przeliczania kredytu (nominalnego) na dzisiejsze złotówki.` | tips | rewrite (unify): `Potrzebna tylko do przeliczania kredytu — bo raty z umowy są w przyszłych złotówkach, a resztę planu liczymy w dzisiejszych.` |
| I6 | label `Oprocentowanie nominalne` (ob-mtg-rate, ob-fl-rate, pl-mtg-rate, pl-fl-rate — 4×) | label | rewrite: `Oprocentowanie (z umowy)` |
| I7 | `ob-mtg-rate` tip `Nominalne oprocentowanie kredytu z umowy (kredyt to jedyna nominalna rzecz w aplikacji…)` | tip | rewrite: `Procent z umowy kredytowej. Kredyt liczymy w przyszłych złotówkach — tak jak bank; resztę planu w dzisiejszych.` |
| I8 | `ob-fl-rate` tip `Stałe oprocentowanie pożyczki od rodziny (nominalne — to drugi nominalny kontrakt w aplikacji).` | tip | rewrite: `Stały procent pożyczki od rodziny, z umowy — liczymy go tak samo jak kredyt bankowy.` |
| I9 | `ob-gexp`/`pl-gexp` tip (`Styl życia zwykle drożeje z wiekiem. Cel FIRE rośnie razem z nim (cel ruchomy). 0 = wydatki stałe.` / `Cel ruchomy: kwota FIRE rośnie razem z planowanym wzrostem stylu życia.`) | tips | rewrite (unify): `Styl życia zwykle drożeje z wiekiem — Twoja kwota FIRE rośnie razem z nim. Wpisz 0, jeśli zakładasz stałe wydatki.` |
| I10 | `ob-cashret`/`pl-cashret` tip `Lokaty zwykle ledwo doganiają inflację, stąd domyślnie 0% realnie.` / `Lokaty ≈ inflacja, stąd domyślnie 0% realnie.` | tips | rewrite (unify): `Konta oszczędnościowe zwykle ledwo doganiają inflację, dlatego domyślnie 0% ponad inflację.` |
| I11 | `ob-ginc`/`pl-ginc` tip `3% realnie rocznie to ambitne podwyżki — ustaw 0, jeśli wolisz ostrożnie.` | tips | rewrite (unify): `3% rocznie ponad inflację to ambitne podwyżki. Wpisz 0, jeśli wolisz ostrożną prognozę.` |
| I12 | plan dom family-loan tip `…To drugi nominalny kontrakt w aplikacji (obok kredytu).` | tip | rewrite ending: `…Liczymy ją tak samo jak kredyt bankowy — w kwotach z umowy.` |
| I13 | `pl-fl-end` tip `Ostatni miesiąc spłaty (włącznie). Rata annuitetowa jest tak dobrana, by dług zniknął dokładnie wtedy.` | tip | rewrite: `Ostatni miesiąc spłaty (włącznie). Równą ratę dobieramy tak, by dług zniknął dokładnie wtedy.` |
| I14 | Korekty sald: `Rzeczywiste saldo kredytu (nominalne)` (+ family variant) | labels | rewrite: `Rzeczywiste saldo kredytu (z wyciągu banku)` / `Rzeczywiste saldo długu rodzinnego (z umowy)` |
| I15 | `pl-anchor` tip, start-plan hints, reanchor toasts | keep | keep |
| I16 | onboarding step-0 intro (`Rytuał jest prosty…`) | keep | keep |

#### J. Motivation layer — `js/motivation.js`

| # | Location | Current | Verdict / New |
|---|---|---|---|
| J1 | `PROFILE_HINT` `Uzupełnij datę urodzenia i docelowy wiek FIRE w Ustawieniach…` | const | rewrite: `Uzupełnij datę urodzenia i docelowy wiek FIRE w zakładce Plan, aby zobaczyć, ile ta kwota znaczy na dzień FIRE.` |
| J2 | everything else (payoffLines, decisionCard, avoided/spentResult) | keep | keep — this module is the tone benchmark |

### 1.4 Vocabulary glossary (binding for all copy, incl. §4 sweep)

| Term today | Always write | Never write |
|---|---|---|
| realnie / real. | `w dzisiejszych złotówkach` (`dzisiejsze zł` in tight tables/legends) | bare „realnie" in labels |
| nominalnie / nom. | `w przyszłych złotówkach` (projections) · `jak na umowie / z umowy` (loans) | bare „nominalnie" |
| SWR / stopa wypłat (WR) | `stopa wypłat` (+EXP-SWR once per screen) | „SWR", „WR" |
| annuitet / annuita | `rata równa` (+EXP-ANNU) | „annuitet" bare |
| kontrakt (loans) | `umowa` | „kontrakt" |
| delta | `różnica vs plan` | „delta" |
| horyzont | `w ciągu 60 lat prognozy` | „horyzont" bare |
| percentyl (batch A) | `scenariusz lepszy/gorszy niż X% przypadków` (+EXP-PERC) | „percentyl" bare |
| kapitalizacja | describe („procent dolicza się co miesiąc/rok") | „kapitalizacja" |
| portfel, gotówka, cel FIRE, nadpłata, rata, seria | keep — established app vocabulary | — |

---

## PART 2 — Navigation / IA reorganization

Design constraints honored: hash router + 5-tab bottom bar stays; `activeRoute()`
contract from CLAUDE.md extended explicitly; every screen stays reachable in ≤ 2
taps from a tab; sub-screens are **real hash routes** so the browser/Android back
button works consistently.

### 2.1 Target route/screen tree

```
#/                        Pulpit                       renderDashboard        tab: Pulpit
#/checkin, #/checkin/:m   Check-in                     renderCheckin          tab: Pulpit
#/history                 Historia                     renderHistory          tab: Historia
#/raport                  Roczny raport „Twój rok FIRE" (batch E) renderReport tab: Historia
#/analiza                 = alias for #/analiza/przeglad
#/analiza/przeglad        Przegląd  (statystyki, wykonanie planu, wykres stopy oszczędzania z D)
#/analiza/prognoza        Prognoza  (projekcja + pasma percentyli z A, wrażliwość)
#/analiza/emerytura       Emerytura (faza wypłat, „do zera", most ZUS/pension bridge z A)
#/analiza/kredyty         Kredyty   (conditional — jak dziś: tylko gdy jest kredyt/dług)
#/symulacja               Hub kalkulatorów (grouped, patrz 2.4)
#/symulacja/:calc         cojesli | wiek | latte | wiecej | zwrot | stress (A) | barista (A)
                          | kredyt | nadplata (cond.) | scenariusze (C)
#/plan                    Hub „Plan i ustawienia"
#/plan/fire               Profil i FIRE (+ ustawienia emerytalne z A: obligacje po FIRE,
                          zamrożenie wzrostu wydatków, parametry mostu ZUS)
#/plan/finanse            Finanse i start planu
#/plan/dom                Mieszkanie i kredyt
#/plan/podatki            Podatki: Belka, IKE/IKZE (batch B)
#/plan/zdarzenia          Zaplanowane zdarzenia (batch C, persisted)
#/plan/aplikacja          Aplikacja (motyw)
#/plan/korekty            Korekty sald
#/backup                  Dane i kopia zapasowa (+ eksport CSV z E)    tab: Plan
```

Fullscreen charts + tap-tooltips (batch D) remain **route-less overlays** (modal
pattern) — `route()` already calls `closeModal()` on every hashchange, which gives
back-button dismissal for free. Do not give them routes.

### 2.2 `#tabbar` spec (final)

**Unchanged** — 5 tabs, same order, same routes, same icons. This is deliberate:
the reorg moves depth *inside* tabs, not tabs themselves, so muscle memory and
the `#tabbar` markup in `index.html` survive untouched.

```html
<a href="#/"          data-route="#/">          <span>📊</span>Pulpit</a>
<a href="#/history"   data-route="#/history">   <span>📅</span>Historia</a>
<a href="#/analiza"   data-route="#/analiza">   <span>📈</span>Analiza</a>
<a href="#/symulacja" data-route="#/symulacja"> <span>🔮</span>Symulacja</a>
<a href="#/plan"      data-route="#/plan">      <span>⚙️</span>Plan</a>
```

### 2.3 `activeRoute()` rules (extended — keep the CLAUDE.md contract)

```js
function activeRoute(hash) {
  if (hash.startsWith('#/checkin')) return '#/';        // check-in = Pulpit (unchanged)
  if (hash === '#/backup') return '#/plan';             // backup = Plan (unchanged)
  if (hash === '#/raport') return '#/history';          // NEW: annual report = Historia
  return hash.split('/').slice(0, 2).join('/');         // covers #/plan/*, #/analiza/*, #/symulacja/*
}
```

The existing `slice(0,2)` trick already maps `#/analiza/emerytura → #/analiza` and
`#/symulacja/kredyt → #/symulacja`; the only new explicit case is `#/raport`.
Update the Polish comment above the function and the CLAUDE.md "Screens & routing"
table accordingly (CLAUDE.md edit is in-scope for F).

### 2.4 Symulacja: grouped hub instead of the flat scrollable tab row

Problem: 7 tabs today in a horizontally scrolling `seg-scroll`; batches A and C add
3+ more — a 10-item scroll row is unusable and hides entry points.

Solution: `#/symulacja` becomes a **hub of grouped items** (reuses the Plan hub's
`.hub`/`.hub-item` styles), each calculator a sub-route. Groups and order:

```
Oszczędzanie i cel          Rynek i emerytura           Kredyty                 Scenariusze
─ 🧪 Co jeśli?              ─ 📊 Zwrot z inwestycji     ─ 🧮 Kalkulator kredytu ─ 🗂️ Zapisane scenariusze (C)
─ 🎯 Cel: wiek FIRE         ─ 📉 Stress test (A)        ─ 💳 Nadpłata kredytu
─ ☕ Efekt małych wydatków  ─ ☕💼 Barista FIRE (A)        (cond.: tylko aktywny dług)
─ 💪 Oszczędzaj więcej
```

- Hub markup comes from a new **pure builder** `Sim.simHub(groups)` in
  `simulation.js` (`groups: [{title, items:[{key, icon, title, sub}]}]`); `ui.js`
  supplies the (possibly conditional) group data and wires `data-go` clicks to
  `location.hash = '#/symulacja/' + key`. Each item has a one-line `sub`
  description (e.g. `Co jeśli? — „dodatkowa kwota raz albo co miesiąc"`).
- Each calculator screen renders exactly today's card, prefixed with a ghost back
  link `<a class="btn ghost wide" href="#/symulacja">← Symulacja</a>` (mirror of
  `planBack`) and suffixed with `nadwyzkaNote()` where applicable (unchanged rule).
- Calculator **input state stays module-level** in `ui.js` (as today: `simMonth`,
  `symAge`, `symOverpay`, …) so hub↔calculator round-trips keep the user's inputs.
- Guards in `route()`: unknown `:calc` → render hub; `nadplata` requested with no
  active loan → render hub (replaces today's `symTab='cojesli'` fallback).
- The `symTab` module variable and the `seg seg-scroll` row in `renderSymulacja`
  are **removed**.

### 2.5 Analiza: sections become routes

`anSection` module state → route param. `#/analiza` renders `przeglad` (no
redirect — just default; internal seg buttons navigate by setting
`location.hash = '#/analiza/' + key`, so the seg row stays visually identical but
becomes deep-linkable and back-button friendly). Section set changes:

- `przeglad` — unchanged content + batch D's savings-rate chart inside
  `planPerfCard` area.
- `prognoza` — `projectionCard` (+A's percentile bands) + `sensitivityCard` +
  `goalSavingsHTML`. **`withdrawalCard` moves out** (to `emerytura`).
- `emerytura` — **new label** (`Emerytura`): `withdrawalCard`, then
  `dieWithZeroCard` (its death-age input and `anDeathAge` module state unchanged),
  then batch A's pension-bridge/ZUS view. Replaces the `dozera` section.
- `kredyty` — unchanged, still conditional; guard: `#/analiza/kredyty` with no
  loans → render `przeglad` (as today's fallback).

Seg labels: `Przegląd · Prognoza · Emerytura · Kredyty` (4 items — fits 360 px
without `seg-scroll`).

### 2.6 Homes for batch A–E entry points + migration notes

One line per moved/new entry point (old place → new place):

1. Analiza section state (in-memory seg) → real routes `#/analiza/:section` (deep-linkable, back-button works).
2. Analiza „Do zera" tab → merged into `#/analiza/emerytura`, below „Po FIRE: życie z portfela".
3. Analiza→Prognoza „Faza wypłat" card → `#/analiza/emerytura` (top card).
4. Symulacja flat tab row → grouped hub at `#/symulacja`; every calculator at `#/symulacja/:calc` (keys unchanged: `cojesli`, `wiek`, `latte`, `wiecej`, `zwrot`, `kredyt`, `nadplata`).
5. Symulacja „Nadpłata" conditional tab → „Kredyty" group in the hub, hidden when no active debt.
6. Batch A retirement **what-ifs** (stress test, Barista FIRE) → `#/symulacja/stress`, `#/symulacja/barista` in group „Rynek i emerytura" (wherever A parked them, move here).
7. Batch A retirement **settings** (bonds switch at FIRE, expense-growth freeze, ZUS bridge parameters) → `#/plan/fire`, new sub-heading `<h3>Emerytura</h3>` (settings that change persisted truth live under Plan; what-ifs live under Symulacja — this is the settings/what-if split rule).
8. Batch A pension-bridge/percentile **result views** → `#/analiza/emerytura` and `#/analiza/prognoza` respectively.
9. Batch B Belka/IKE-IKZE settings (wherever B parked them) → `#/plan/podatki`, hub item `['🧾', 'Podatki', 'podatek Belki, IKE / IKZE', '#/plan/podatki']`.
10. Batch C planned-events manager → `#/plan/zdarzenia`, hub item `['📌', 'Zaplanowane zdarzenia', 'jednorazowe wydatki i wpływy w przyszłości', '#/plan/zdarzenia']`; plus a one-line link from `#/analiza/prognoza` metodologia area: `Przyszłe zdarzenia uwzględnione w prognozie ustawisz w Plan → Zaplanowane zdarzenia.`
11. Batch C scenario save/compare → `#/symulacja/scenariusze` (group „Scenariusze"); the „save current sim as scenario" buttons stay on individual calculators, the compare view lives here.
12. Batch E annual report „Twój rok FIRE" → `#/raport`; entry points: wide ghost button at top of Historia (`📖 Twój rok FIRE — raport roczny`) + Pulpit banner in January (E's logic).
13. Batch E CSV export → `#/backup` (screen renamed `Dane i kopia zapasowa`), new card `Eksport CSV` under the JSON export card.
14. Batch D savings-rate chart → `#/analiza/przeglad`, inside „Wykonanie planu" card.
15. Batch D fullscreen charts / tooltips → overlay only, no route (see 2.1).
16. Plan hub heading `Ustawienia` → `Plan i ustawienia`; `planBack` label `← Ustawienia` → `← Plan` (matches the tab name the user tapped).
17. `#/backup` screen title `Kopia zapasowa` → `Dane i kopia zapasowa` (hub item subtitle: `eksport JSON i CSV, import, aktualizacja`).

### 2.7 Consistent back behavior (the rule, stated once)

- Every sub-page has one top ghost link `← <Parent>`: `#/plan/*` → `← Plan`;
  `#/backup` → `← Plan`; `#/symulacja/:calc` → `← Symulacja`; `#/raport` →
  `← Historia`. Analiza sections do NOT get one (the seg row is the switcher —
  sections are siblings, not children).
- Browser/Android back always works because every sub-screen is a hash route and
  `route()` re-renders on `hashchange` (already true; the reorg extends it to
  Symulacja/Analiza).
- Modals (check-in celebration, D's fullscreen chart) never get routes; they are
  closed by `route()`'s existing `closeModal()` on any navigation.
- `window.scrollTo(0, 0)` on route change stays as-is.

---

## 3. Exact changes per file

### `js/ui.js`

1. `route()` — replace the Analiza/Symulacja branches:
   ```js
   else if (hash === '#/analiza' || hash.startsWith('#/analiza/'))
     renderAnaliza(hash.split('/')[2] || 'przeglad');
   else if (hash === '#/symulacja') renderSymulacja(null);          // hub
   else if (hash.startsWith('#/symulacja/')) renderSymulacja(hash.split('/')[2]);
   else if (hash === '#/raport') renderReport();                    // batch E renderer
   ```
   (keep the existing order: checkin → history → analiza → symulacja → raport →
   plan → plan/* → backup → dashboard).
2. `activeRoute()` — add the `#/raport` case (see 2.3) and update the Polish comment.
3. `renderAnaliza(section)` — delete `let anSection` module state; validate
   `section` against `['przeglad','prognoza','emerytura','kredyty']` (fallback
   `przeglad`; `kredyty` guarded by `showKredyty`). Seg buttons keep
   `data-ansection` but the handler becomes
   `location.hash = '#/analiza/' + el.dataset.ansection;`. Move `withdrawalCard`
   +its chart out of the `prognoza` branch into the new `emerytura` branch together
   with the whole `dozera` body (incl. the `#an-death-age` listener). Rename seg
   labels per 2.5.
4. `renderSymulacja(calc)` — delete `symTab`; when `calc` is falsy render
   `Sim.simHub(groups)` (groups built here, incl. conditional `nadplata` and, post
   A/C, `stress`/`barista`/`scenariusze`); otherwise render back-link + the
   existing card + listeners for that calculator (the big `if/else` chain keys off
   `calc` instead of `symTab`). Remove the `[data-symtab]` wiring; add
   `[data-go]`-style wiring for hub items (same pattern as `renderPlanHub`).
5. `renderPlanHub()` — heading `Plan i ustawienia`; extend `items` with
   `podatki` and `zdarzenia` rows (icons/subtitles from 2.6 #9–10); backup row
   subtitle per 2.6 #17.
6. `renderPlanSection()` — add `podatki` and `zdarzenia` dispatch (renderers exist
   after B/C; if their renderers ended up elsewhere, move the glue here).
7. `renderPlanFire()` — group A's retirement settings under `<h3>Emerytura</h3>`.
8. `renderHistory()` — add the `#/raport` entry button at the top of the card.
9. `renderBackup()` — retitle `Dane i kopia zapasowa`; host E's CSV card.
10. `planBack` const — `'<a class="btn ghost wide" href="#/plan">← Plan</a>'`.
11. Apply every Part-1 rewrite from tables A, B, I (Pulpit/check-in/Plan/onboarding
    strings live here), incl. adding `explain(EXP-TARGET)` on Pulpit (import
    `explain` via the existing `An` namespace: `An.explain(...)`).

### `js/analysis.js`

- Add `export function explain(title, paragraphs)` (§1.2).
- Apply tables D, E, F, G rewrites (labels, headers, metodologia lines, legends,
  new table legends E6/F2, explainer placements).
- No signature changes to existing builders except: `projectionCard` needs no new
  params; `withdrawalCard`/`dieWithZero*` unchanged signatures (only strings).

### `js/simulation.js`

- Add `export function simHub(groups)` (pure; reuses `.hub` classes; each item
  `<button class="hub-item" data-go="#/symulacja/KEY">` with icon/title/sub).
- Apply table H rewrites. Import `explain` from `./analysis.js` (already imports
  `fireCell` — layering unchanged).

### `js/motivation.js`

- J1 only (`PROFILE_HINT`).

### `js/coach.js`

- **No changes.**

### `js/engine.js`

- **No changes** (see §0).

### `index.html`

- **No changes.** Tabbar stays byte-identical; footer version is the release
  agent's job. (Listed here so the implementer verifies rather than assumes.)

### `styles.css`

- Add the `details.explain` block (§1.2) — uses existing custom props only, so the
  three theme blocks stay untouched.
- Add `.hub-group` heading style for the Symulacja hub:
  ```css
  .hub-group + .hub-group { margin-top: .9rem; }
  .hub-group > h3 { font-size: .8rem; color: var(--muted); margin: 0 0 .35rem; }
  ```
- `.seg.seg-scroll` becomes unused after 2.4 — leave the rule in place (cheap,
  and D's fullscreen UI may reuse it); just note it in the maintenance doc.

### `CLAUDE.md`

- Update the "Screens & routing" table (new routes `#/analiza/:section`,
  `#/symulacja/:calc`, `#/raport`, `#/plan/podatki`, `#/plan/zdarzenia`) and the
  `activeRoute()` sentence (add `#/raport` → Historia).

### `docs/features/F.md` + `docs/INDEX.md`

- Per master-plan convention: short maintenance doc (where the explain() helper
  lives, the vocabulary glossary, the route map) + one INDEX line.

---

## 4. Mandatory copy sweep of batch A–E screens (at implementation time)

Batches A–E will have shipped screens that do not exist today, written before this
plan's language rules existed. **The F implementer must sweep every one of them**
— this is not optional polish; it is half the point of doing F last:

- A: stress test, Barista FIRE, pension bridge, bonds-switch settings, percentile
  band legend/labels;
- B: Belka toggle, IKE/IKZE screens and any tax lines added to tables;
- C: planned-events manager, scenario save/compare, check-in notes field;
- D: fullscreen chart chrome, tooltip labels, savings-rate chart title/legend;
- E: milestones/celebration copy, annual report, CSV export, backup nudge.

Procedure: grep each batch's builders/renderers for user-facing strings (`rg -n
"„|[ąćęłńóśźż]" js/`), run every string through the **P1–P10 checklist (§1.1)**
and the **glossary (§1.4)**, rewrite violations, and add the missing explainers
(EXP-PERC, EXP-SEQ, EXP-BARISTA, EXP-BRIDGE, EXP-BELKA, EXP-IKE) using the §1.2
mechanism. New terms from those batches that P2 bans: *percentyl, sekwencja
zwrotów, obligacje indeksowane, pomost/bridge, Belka, IKZE limit, odroczony
podatek*. Log the swept strings as an appendix table in `docs/features/F.md`
(same before→after format as §1.3).

---

## 5. Verification

### 5.1 What Node tests cover

`node tests/run-tests.js` must stay green — but it only exercises `engine.js`,
`format.js`, `storage.js` and fixtures. Since F changes **no engine behavior**, a
green run proves only that nothing was accidentally imported/broken at module load
(builders are imported by tests indirectly? they are not — engine-only). Run it
anyway before and after.

### 5.2 Manual-check list (cannot be verified in Node)

Serve locally (`python -m http.server 8000`) and check in a real browser, mobile
viewport (~360–480 px), **both themes** (auto-dark + manual light):

1. **Routing matrix**: direct-load and reload every route in §2.1 (type the hash,
   press F5) — correct screen, correct tab highlighted (esp. `#/raport` →
   Historia; `#/symulacja/kredyt` → Symulacja; `#/analiza/emerytura` → Analiza;
   `#/backup` → Plan; `#/checkin/2026-06` → Pulpit).
2. **Back behavior**: from every sub-page, browser back returns to its hub/tab;
   the check-in celebration modal and D's fullscreen chart close on back without
   leaving a dead overlay.
3. **Guards**: `#/analiza/kredyty` and `#/symulacja/nadplata` with a no-house
   profile fall back to Przegląd / hub; unknown `#/symulacja/xyz` → hub.
4. **State survival**: enter values in a Symulacja calculator, go back to hub,
   re-enter — inputs preserved; same for Analiza's death-age input within a session.
5. **Copy rendering**: every rewritten string from §1.3 visible and unclipped at
   360 px; `kv` labels don't wrap the value off-card; table headers (`Na
   początku`, `Ile × rocznych wydatków`) don't force horizontal scroll beyond
   `.table-scroll`; NBSP grouping intact in all amounts (no line break inside
   `1 931 854 zł`).
6. **Explainers**: every `details.explain` opens/closes by tap (target ≥40 px),
   readable in both themes, no double explainer for the same term on one screen.
7. **Seg rows**: Analiza's 4 sections fit without scrolling at 360 px.
8. **Onboarding**: full 5-step run with house+family loan — new tips render, no
   layout breakage.
9. **Offline/PWA**: with SW active, hard-reload then airplane-mode reload — app
   loads (no new files, so `PRECACHE` untouched — verify no 404s in DevTools).
10. **Subpath rehearsal**: `cd .. && python -m http.server 8000`, open
    `http://localhost:8000/fire/` — every new route works under the subpath (hash
    routes are subpath-immune, but verify anyway per CLAUDE.md).
11. **Human read-through**: have a non-technical Polish speaker read Analiza →
    Przegląd/Prognoza/Emerytura and say out loud what each card tells them; any
    stumble = copy bug, iterate.

---

## 6. Exact file-touch list

| File | Nature of change |
|---|---|
| `js/ui.js` | routing (route/activeRoute), renderAnaliza/renderSymulacja restructure, Plan hub items, planBack, backup/history entry points, copy tables A/B/I |
| `js/analysis.js` | `explain()` helper, copy tables D/E/F/G, table legends |
| `js/simulation.js` | `simHub()` builder, copy table H |
| `js/motivation.js` | `PROFILE_HINT` only |
| `styles.css` | `details.explain`, `.hub-group` (no theme-block edits) |
| `CLAUDE.md` | routing table + activeRoute note update |
| `docs/features/F.md` (new, docs only — not app shell) | maintenance notes + A–E sweep appendix |
| `docs/INDEX.md` | +1 line |
| `js/coach.js`, `js/engine.js`, `js/format.js`, `js/storage.js`, `js/app.js`, `index.html`, `sw.js`, `tests/*` | **untouched** (verify at the end with `git diff --stat`) |

No new app-shell files ⇒ no `PRECACHE` edit ⇒ no SW churn. No version bump (release
agent). No commits (user commits).

---

## 7. Definition of done

- All §1.3 rewrites applied verbatim (or with better wording that still passes
  P1–P10 — improving is allowed, regressing to jargon is not).
- All §2 routes live, guards in place, tab highlighting per §2.3.
- All §2.6 migration notes true in the shipped app (each old entry point either
  redirects trivially — same hash — or its new home is reachable in ≤2 taps).
- §4 sweep executed and logged in `docs/features/F.md`.
- `node tests/run-tests.js` green; §5.2 manual matrix walked; `git diff --stat`
  matches §6.
