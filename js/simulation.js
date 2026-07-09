// simulation.js — czyste buildery HTML ekranu „Symulacja" (#/symulacja).
// Zero DOM, zero stanu modułu: dane (wyniki z engine.js) wchodzą parametrami,
// wychodzi string. Mirror analysis.js. Silnik liczy się w ui.js; tutaj tylko
// prezentacja. Wszystkie kalkulatory to czyste „co jeśli" — nic nie zapisujemy.

import * as E from './engine.js';
import * as Fmt from './format.js';
import { fireCell } from './analysis.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const money = (v, dec = 0) => Fmt.formatPLN(v, dec);
const signed = v => (v >= 0 ? '+' : '') + money(v);

function kv(label, val, cls = '') {
  return `<div class="kv"><span>${label}</span><b${cls ? ` class="${cls}"` : ''}>${val}</b></div>`;
}

// Kroki zwykłym tekstem (ol.howto); opcjonalny wzór w monospace (.formula)
// tylko jako ostatnia linia „Wzór dla dociekliwych".
function metodologia(steps, formula = '') {
  return `<details class="section"><summary>Jak to liczymy?</summary>
    <ol class="howto">${steps.filter(Boolean).map(s => `<li>${s}</li>`).join('')}</ol>
    ${formula ? `<div class="formula">Wzór dla dociekliwych: ${formula}</div>` : ''}
  </details>`;
}

// Link do wpisu w Słowniczku (#/slowniczek/:term).
const gl = (term, text) => `<a href="#/slowniczek/${term}">${text}</a>`;

// Wspólna uwaga: dla FIRE liczy się sama nadwyżka, nie jej źródło. Pokazywana
// pod zakładkami, które dokładają kwotę do planu (nie dotyczy zakładki „Zwrot").
export function nadwyzkaNote() {
  return `<div class="banner info small" style="margin-top:12px">
    Symulacja nie rozróżnia, <b>skąd</b> bierze się nadwyżka. Dodatkowe +2000&nbsp;zł/mies.
    z podwyżki i te same +2000&nbsp;zł/mies. z cięcia wydatków dają identyczny wynik —
    tę samą datę FIRE. Dla matematyki FIRE liczy się sama nadwyżka (dochód − wydatki),
    nie to, którą stronę ruszysz.
  </div>`;
}

// Legenda słupków „ile zostało do spłaty" — identyczna dla nadpłaty i
// kalkulatora kredytu; wyeksportowana, by nakładka pełnoekranowa użyła jej
// pod powiększonym wykresem (jedno źródło prawdy).
export function remainingCmpLegend() {
  return `<div class="legend">
        <span><i style="background:var(--accent)"></i>kapitał</span>
        <span><i style="background:var(--flame)"></i>odsetki</span>
        <span><i style="background:var(--accent);opacity:.35"></i><i style="background:var(--flame);opacity:.35"></i>sama rata (blade)</span>
        <span><i style="background:var(--accent)"></i><i style="background:var(--flame)"></i>z nadpłatą (pełne)</span>
      </div>`;
}

// Wspólny komunikat „zyskujesz / tracisz N" na podstawie przesunięcia daty FIRE.
function gainLine(simFireYm, baseFireYm) {
  if (simFireYm == null || baseFireYm == null) return '';
  const d = E.ymToIdx(baseFireYm) - E.ymToIdx(simFireYm); // dodatnie = wcześniej
  if (d > 0) return `<p class="good">Zyskujesz ${Fmt.formatYearsMonths(d)} — FIRE bliżej. 🔥</p>`;
  if (d < 0) return `<p class="warn-text">Tracisz ${Fmt.formatYearsMonths(-d)} — FIRE dalej.</p>`;
  return '<p class="muted small">Bez zmiany daty FIRE.</p>';
}

// ── 1. Co jeśli? (przeniesione z analysis.js) ────────────────────────────

export function simulationResult({ baseFireYm, sim, month }) {
  const simFireYm = sim.reached ? sim.fireYm : null;
  let note = '';
  if (baseFireYm != null && E.ymToIdx(month) > E.ymToIdx(baseFireYm)) {
    note = '<p class="muted small">Wybrany miesiąc wypada po prognozowanej dacie FIRE — ta kwota nic już nie zmienia.</p>';
  } else if (baseFireYm == null && simFireYm != null) {
    note = '<p class="muted small">Ta zmiana sprowadza FIRE z powrotem w horyzont prognozy. 🔥</p>';
  }
  return [
    kv('Prognoza bazowa', fireCell(baseFireYm, null)),
    kv('Po symulacji', fireCell(simFireYm, baseFireYm)),
    simFireYm ? kv('Wiek w dniu FIRE', esc(Fmt.formatAgeYM(sim.fireAge))) : '',
    note,
  ].join('');
}

export function whatIfCard({ nowYm, month, amount, recurring, resultHTML }) {
  return `<div class="card"><h2>Co jeśli? 🧪</h2>
    <p class="muted small">Co jeśli odłożysz więcej (albo mniej)? Czysta symulacja — niczego nie zapisujemy, Twoje wpisy pozostają jedynym źródłem prawdy.</p>
    <label class="field"><span class="lbl">Miesiąc</span>
      <input type="month" id="sim-month" min="${nowYm}" value="${esc(month)}">
    </label>
    <div class="seg" role="tablist">
      <button type="button" data-simmode="once" class="${recurring ? '' : 'on'}">Jednorazowo</button>
      <button type="button" data-simmode="from" class="${recurring ? 'on' : ''}">Co miesiąc</button>
    </div>
    <label class="field"><span class="lbl">Kwota <span class="muted">(zł)</span></span>
      <input type="text" id="sim-amount" inputmode="decimal" value="${esc(amount)}" placeholder="np. 2000">
      <div class="hint">„Jednorazowo” dodaje kwotę tylko w wybranym miesiącu; „Co miesiąc” — od tego miesiąca do końca prognozy. Ujemna kwota = odkładasz mniej.</div>
    </label>
    <div id="sim-result">${resultHTML}</div>
    ${metodologia([
      'Dodajemy Twoją kwotę do planu wybranego miesiąca i liczymy całą prognozę od nowa (plan → dług → salda → projekcja) — dokładnie tak, jakby ta kwota naprawdę się pojawiła.',
      'Niczego nie zapisujemy — po odświeżeniu ekranu symulacja znika, a Twoje wpisy i założenia pozostają nietknięte.',
    ])}
  </div>`;
}

// ── 2. Cel: wiek FIRE ────────────────────────────────────────────────────

export function targetAgeResult({ sol, ageYears, plannedNow, baseFireYm, cap }) {
  if (!sol.feasible) {
    return `<div class="banner warn small">Nawet dodatkowe ${money(cap)}/mies. nie wystarczą, aby osiągnąć FIRE w wieku ${esc(ageYears)}. Spróbuj późniejszego wieku albo zajrzyj do założeń.</div>`;
  }
  if (sol.extraMonthly === 0) {
    return `<div class="banner success small">Jesteś na dobrej drodze — cel FIRE w wieku ${esc(ageYears)} osiągniesz bez dodatkowych oszczędności. 🔥</div>
      ${kv('Prognoza FIRE', fireCell(sol.fireYm, baseFireYm))}
      ${sol.fireAge ? kv('Wiek w dniu FIRE', esc(Fmt.formatAgeYM(sol.fireAge))) : ''}`;
  }
  const total = sol.extraMonthly + plannedNow;
  return [
    kv('Dodatkowo trzeba odkładać', `<b>${money(Math.ceil(sol.extraMonthly))}</b>/mies.`),
    kv('Łącznie z planem', `${money(Math.round(total))}/mies.`),
    kv('Prognoza FIRE', fireCell(sol.fireYm, baseFireYm)),
    sol.fireAge ? kv('Wiek w dniu FIRE', esc(Fmt.formatAgeYM(sol.fireAge))) : '',
  ].join('');
}

export function targetAgeCard({ ageValue, defaultAge, resultHTML }) {
  return `<div class="card"><h2>Cel: wiek FIRE 🎯</h2>
    <p class="muted small">W jakim wieku chcesz osiągnąć FIRE? Policzę, ile trzeba odkładać dodatkowo co miesiąc, żeby zdążyć.</p>
    <label class="field"><span class="lbl">Docelowy wiek FIRE</span>
      <input type="text" id="sym-age" inputmode="numeric" value="${esc(ageValue)}" placeholder="np. ${esc(defaultAge)}">
    </label>
    <div id="sym-age-result">${resultHTML}</div>
    ${metodologia([
      `Próbujemy różnych miesięcznych dopłat i szukamy najmniejszej, przy której ${gl('cel-fire', 'FIRE')} wypada najpóźniej w zadanym wieku.`,
      'Każda próba to pełna prognoza. Więcej oszczędności nigdy nie opóźnia FIRE, więc najmniejszą wystarczającą kwotę znajdujemy szybko, kolejnymi przybliżeniami (raz za dużo, raz za mało, aż do celu).',
      '„Łącznie z planem” = ta dopłata + Twój bieżący plan miesięczny.',
    ])}
  </div>`;
}

// ── 3. Efekt małych wydatków (latte factor) ──────────────────────────────

export function latteResult({ amount, fv10, fv20, fv30, sim, baseFireYm }) {
  const simFireYm = sim.reached ? sim.fireYm : null;
  return [
    `<p class="muted small">${money(amount)}/mies. ≈ ${money(amount / 30, 2)} dziennie.</p>`,
    kv('Wartość za 10 lat', money(Math.round(fv10))),
    kv('Wartość za 20 lat', money(Math.round(fv20))),
    kv('Wartość za 30 lat', money(Math.round(fv30))),
    kv('Wpływ na datę FIRE', fireCell(simFireYm, baseFireYm)),
  ].join('');
}

export function latteCard({ amountValue, resultHTML }) {
  return `<div class="card"><h2>Efekt małych wydatków ☕</h2>
    <p class="muted small">Codzienna kawa, subskrypcja, drobiazgi… Zobacz, ile taka miesięczna kwota mogłaby urosnąć, gdybyś ją odkładał zamiast wydawać.</p>
    <label class="field"><span class="lbl">Miesięczna kwota <span class="muted">(zł)</span></span>
      <input type="text" id="sym-latte" inputmode="decimal" value="${esc(amountValue)}" placeholder="np. 450">
      <div class="hint">15 zł dziennie ≈ 450 zł/mies. (×30).</div>
    </label>
    <div id="sym-latte-result">${resultHTML}</div>
    ${metodologia([
      `Liczymy, do czego urosłaby ta kwota, gdybyś odkładał ją co miesiąc przez 10, 20 i 30 lat przy Twoim realnym zwrocie — wynik w dzisiejszych złotówkach (${gl('realnie', 'realnie')}).`,
      'Wpływ na datę FIRE to pełna prognoza z tą kwotą doliczaną do planu każdego miesiąca.',
    ])}
  </div>`;
}

// ── 4. Oszczędzaj więcej (suwak) ─────────────────────────────────────────

export function moreSavingsResult({ extra, sim, baseFireYm }) {
  const simFireYm = sim.reached ? sim.fireYm : null;
  return [
    kv('Nowa data FIRE', fireCell(simFireYm, baseFireYm)),
    simFireYm ? kv('Wiek w dniu FIRE', esc(Fmt.formatAgeYM(sim.fireAge))) : '',
    gainLine(simFireYm, baseFireYm),
  ].join('');
}

export function moreSavingsCard({ value, max, resultHTML }) {
  const v = value == null ? 0 : Number(value);
  return `<div class="card"><h2>Oszczędzaj więcej 💪</h2>
    <p class="muted small">Przesuń suwak i zobacz, o ile wcześniej osiągniesz FIRE, odkładając więcej co miesiąc.</p>
    <label class="field"><span class="lbl">Dodatkowo <b id="sym-more-val">${esc(Fmt.formatPLN(v))}</b>/mies.</span>
      <input type="range" id="sym-more" min="0" max="${max}" step="100" value="${v}">
    </label>
    <div id="sym-more-result">${resultHTML}</div>
    ${metodologia([
      'Suwak dolicza stałą kwotę do planu każdego prognozowanego miesiąca i przelicza całą prognozę od nowa.',
      'Zakres suwaka to 0 … Twój zaokrąglony miesięczny dochód.',
    ])}
  </div>`;
}

// ── 4a. Nadpłata kredytu (suwak) ─────────────────────────────────────────
// Kalkulator czysto kredytowy: punktem wyjścia jest spłata „przy samej racie"
// (bieżące saldo + rata kontraktowa) — niezależnie od strategii prognozy FIRE,
// która i tak nadpłaca kredyt hipoteczny nadwyżką. Nic nie zapisujemy.

export function overpaymentResult({ amount, basePayoffYm, payoffYm, monthsSaved, interestSaved, chartHTML }) {
  return [
    kv('Spłata przy samej racie', esc(Fmt.formatMonthName(basePayoffYm))),
    kv(`Spłata z nadpłatą ${money(amount)}/mies.`, esc(Fmt.formatMonthName(payoffYm))),
    kv('Szybciej o', monthsSaved > 0 ? Fmt.formatYearsMonths(monthsSaved) : '—', monthsSaved > 0 ? 'good' : ''),
    kv('Odsetki zaoszczędzone', money(Math.round(interestSaved)), interestSaved > 0.005 ? 'good' : ''),
    chartHTML ? `<h3>Ile zostało do spłaty: kapitał + przyszłe odsetki</h3>${chartHTML}
      ${remainingCmpLegend()}` : '',
  ].join('');
}

export function overpaymentCard({ loans, activeLoan, amount, resultHTML }) {
  const v = amount == null ? '' : String(amount);
  const toggle = loans.length > 1
    ? `<div class="seg" role="tablist">${loans.map(l =>
      `<button type="button" data-oploan="${l.key}" class="${l.key === activeLoan ? 'on' : ''}">${l.label}</button>`).join('')}</div>`
    : '';
  return `<div class="card"><h2>Nadpłata kredytu 🧮</h2>
    <p class="muted small">Stała miesięczna nadpłata ponad ratę — zobacz, o ile skraca spłatę i ile odsetek oszczędza. Czysta symulacja, niczego nie zapisujemy.</p>
    ${toggle}
    <label class="field"><span class="lbl">Nadpłata <span class="muted">(zł/mies.)</span></span>
      <input type="text" inputmode="decimal" id="sym-overpay" value="${esc(v)}" placeholder="np. 500">
    </label>
    <div id="sym-overpay-result">${resultHTML}</div>
    ${metodologia([
      'Punktem wyjścia jest spłata „przy samej racie”: bieżące saldo + rata z umowy, bez żadnych nadpłat.',
      `Do każdej raty doliczamy Twoją ${gl('nadplata', 'nadpłatę')} aż do spłaty; nadwyżka ostatniego miesiąca nie przepada w rachunku odsetek.`,
      'Prognoza FIRE i tak nadpłaca kredyt hipoteczny całą nadwyżką — ten kalkulator pokazuje czysty efekt stałej nadpłaty, niezależnie od tej strategii. Słupek na wykresie = saldo kapitału + wszystkie przyszłe odsetki na początku roku spłaty.',
    ])}
  </div>`;
}

// ── 4b. Kalkulator kredytu (hipotetyczny) ────────────────────────────────
// Kredyt, którego użytkownik jeszcze nie ma: kwota / oprocentowanie / okres
// wpisywane ręcznie. Rata i amortyzacja liczone tymi samymi funkcjami silnika
// co realny kredyt (annuityPayment → remainingSchedule → remainingToPayComparison).
// Spłata pokazywana jako czas trwania (nie data — kredyt nie ma startMonth).

export function loanCalcResult({ payment, baseMonths, extra, simMonths, baseInterest, interestSaved, chartHTML }) {
  const rows = [
    kv('Rata miesięczna', money(payment, 2)),
    kv('Spłata przy samej racie', esc(Fmt.formatYearsMonths(baseMonths))),
    kv(`Spłata z nadpłatą ${money(extra)}/mies.`, esc(Fmt.formatYearsMonths(simMonths))),
    kv('Szybciej o', baseMonths - simMonths > 0 ? Fmt.formatYearsMonths(baseMonths - simMonths) : '—', baseMonths - simMonths > 0 ? 'good' : ''),
    kv('Odsetki łącznie (sama rata)', money(Math.round(baseInterest))),
    kv('Odsetki zaoszczędzone', money(Math.round(interestSaved)), interestSaved > 0.005 ? 'good' : ''),
    chartHTML ? `<h3>Ile zostało do spłaty: kapitał + przyszłe odsetki</h3>${chartHTML}
      ${remainingCmpLegend()}` : '',
  ];
  return rows.join('');
}

export function loanCalcCard({ principal, rate, term, amount, resultHTML }) {
  const v = amount == null ? '' : String(amount);
  return `<div class="card"><h2>Kalkulator kredytu 🧮</h2>
    <p class="muted small">Policz ratę i amortyzację kredytu, którego jeszcze nie masz — plus efekt stałej nadpłaty. Czysta symulacja, niczego nie zapisujemy.</p>
    <label class="field"><span class="lbl">Kwota kredytu (zł)</span>
      <input type="text" inputmode="decimal" id="sym-loan-principal" value="${esc(String(principal))}"></label>
    <label class="field"><span class="lbl">Oprocentowanie roczne (%)</span>
      <input type="text" inputmode="decimal" id="sym-loan-rate" value="${esc(String(rate))}"></label>
    <label class="field"><span class="lbl">Okres kredytu (lata)</span>
      <input type="text" inputmode="numeric" id="sym-loan-term" value="${esc(String(term))}"></label>
    <label class="field"><span class="lbl">Nadpłata <span class="muted">(zł/mies.)</span></span>
      <input type="text" inputmode="decimal" id="sym-loan-op" value="${esc(v)}" placeholder="np. 500">
    </label>
    <div id="sym-loan-result">${resultHTML}</div>
    ${metodologia([
      `Rata jest stała przez cały okres — to ${gl('annuitet', 'rata równa (annuitet)')} przy stałym oprocentowaniu i miesięcznej kapitalizacji.`,
      `${gl('nadplata', 'Nadpłata')} dochodzi do raty w każdym miesiącu aż do spłaty; nadwyżka ostatniego miesiąca nie przepada w rachunku odsetek.`,
      'Słupek na wykresie = saldo kapitału + wszystkie przyszłe odsetki na początku roku spłaty; blade słupki to sama rata, pełne — z nadpłatą.',
      'Kalkulator jest hipotetyczny — nie korzysta z Twojego planu ani zapisanych kredytów i niczego nie zmienia.',
    ], 'stopa miesięczna = (1+roczna)^(1/12) − 1')}
  </div>`;
}

// ── 5. Wpływ zwrotu (suwak) ──────────────────────────────────────────────

export function returnResult({ newReturn, baseReturn, sim, baseFireYm }) {
  const simFireYm = sim.reached ? sim.fireYm : null;
  return [
    kv('Realny zwrot', `${Fmt.formatPct(newReturn)} <span class="muted small">(baza ${Fmt.formatPct(baseReturn)})</span>`),
    kv('Nowa data FIRE', fireCell(simFireYm, baseFireYm)),
    gainLine(simFireYm, baseFireYm),
  ].join('');
}

export function returnCard({ value, min, max, baseReturn, resultHTML }) {
  const v = value == null ? baseReturn : Number(value);
  return `<div class="card"><h2>Wpływ zwrotu z inwestycji 📊</h2>
    <p class="muted small">Rynkowy zwrot jest niepewny. Zobacz, jak realny zwrot roczny przesuwa datę FIRE (reszta założeń bez zmian).</p>
    <label class="field"><span class="lbl">Realny zwrot roczny <b id="sym-return-val">${esc(Fmt.formatPct(v))}</b></span>
      <input type="range" id="sym-return" min="${min}" max="${max}" step="0.005" value="${v}">
    </label>
    <div id="sym-return-result">${resultHTML}</div>
    ${metodologia([
      `Suwak zmienia tylko ${gl('realnie', 'realny')} zwrot roczny (±3 pp wokół Twojego założenia ${Fmt.formatPct(baseReturn)}) i przelicza całą prognozę od nowa.`,
      'To ta sama matematyka co tabela „Wrażliwość prognozy” w Analizie — tu masz ją interaktywnie.',
    ])}
  </div>`;
}

// ── 6. Emerytura po FIRE: zwrot po FIRE (suwak) ──────────────────────────

export function retirementResult({ ro, dz, dzBase, w, pb, deathAge }) {
  if (dz == null) {
    return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć fazę emerytalną.</p>';
  }
  const diff = dz.target - dzBase.target;
  let longevity;
  if (w.depletedYear) {
    const k = w.depletedYear;
    const age = w.rows[k - 1] ? w.rows[k - 1].age : null;
    longevity = kv('Portfel przy Twojej stopie wypłat wystarcza',
      `do wieku ${age != null ? age : '—'} <span class="muted small">(${k}. rok wypłat)</span>`, 'warn-text');
  } else {
    longevity = kv('Portfel przy Twojej stopie wypłat wystarcza', `ponad ${w.rows.length} lat`, 'good');
  }
  return [
    kv(`Cel „do zera” (do wieku ${deathAge})`, money(dz.target)),
    kv('Zmiana vs Twoje ustawienie', signed(diff), diff <= 0 ? 'good' : 'warn-text'),
    kv('Data FIRE „do zera”', fireCell(dz.fireYm, dzBase.fireYm)),
    kv('Data FIRE z mostem ZUS', fireCell(pb.fireYm, pb.classicFireYm)),
    kv('Emerytura ZUS', ro.pension && ro.pension.monthly > 0
      ? `${money(ro.pension.monthly)}/mies. od ${ro.pension.fromAge} r.ż.`
      : 'nieuwzględniana'),
    kv('Wydatki po FIRE', ro.freezeExpenses ? 'stałe realnie'
      : 'rosną o ' + Fmt.formatPct(w.withdrawalGrowthReal) + ' realnie/rok'),
    longevity,
    metodologia([
      `Każde przesunięcie suwaka przelicza fazę wypłat od nowa: po FIRE portfel rośnie o wybrany ${gl('realnie', 'realny')} zwrot, a wypłaty pokrywają Twoje wydatki.`,
      `Odznaczenie „wydatki przestają rosnąć” podnosi wypłaty co roku o realny wzrost wydatków — ${gl('do-zera', 'cel „do zera”')} musi być większy albo portfel skończy się wcześniej.`,
      'Od wieku emerytalnego ZUS pokrywa część wydatków — z portfela wypłacasz tylko resztę, dlatego cel z mostem bywa niższy, a FIRE wcześniej.',
      'Niczego nie zapisujemy — to podgląd; ustawienie na stałe jest w Plan → Profil i FIRE.',
    ]),
  ].join('');
}

// ── 7. Test krachu (ryzyko sekwencji zwrotów) ────────────────────────────

export function crashResult({ st }) {
  if (st == null) {
    return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć fazę emerytalną.</p>';
  }
  const pathCell = s => s.survives
    ? `✅ portfel wystarcza do wieku ${st.deathAge} <span class="muted small">(zostaje ${money(s.endReal)})</span>`
    : `⚠️ portfel kończy się w wieku ${s.depletedAge} <span class="muted small">(${s.depletedYear}. rok wypłat)</span>`;
  const pathCls = s => s.survives ? 'good' : 'warn-text';
  return [
    st.hypothetical ? '<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy liczony od dziś.</div>' : '',
    kv('Bez krachu', pathCell(st.base), pathCls(st.base)),
    ...st.scenarios.map(s => kv(`Krach w ${s.shockYear}. roku FIRE`, pathCell(s), pathCls(s))),
    `<p class="muted small">Ten sam krach dziesięć lat później boli mniej — portfel zdążył urosnąć, a część wypłat masz już za sobą. O bezpieczeństwie planu decyduje więc nie tylko średni zwrot, ale i to, KIEDY przyjdą złe lata. Dlatego niższa stopa wypłat i bezpieczniejszy portfel po FIRE to Twoja poduszka.</p>`,
    metodologia([
      'Bez losowania: liczymy zwykłą fazę wypłat i w wybranym roku obniżamy portfel o podany procent, a potem liczymy dalej. Dwa terminy krachu pokazują tzw. ryzyko sekwencji zwrotów.',
      `Portfel po FIRE rośnie o ${gl('realnie', 'realny')} zwrot po FIRE z Twoich ustawień; niczego nie zapisujemy — to podgląd.`,
    ]),
  ].join('');
}

export function crashCard({ pct, deathAge, resultHTML }) {
  return `<div class="card"><h2>Test krachu 📉</h2>
    <p class="muted small">Największy wróg świeżego emeryta to krach tuż po przejściu na FIRE — portfel traci, a Ty i tak musisz z niego żyć. Sprawdź, czy Twój plan przeżyje spadek o podany procent: raz w pierwszym roku FIRE, raz — dla porównania — w dziesiątym.</p>
    <label class="field"><span class="lbl">Spadek portfela <span class="muted">(%)</span></span>
      <input type="text" id="sym-crash-pct" inputmode="numeric" value="${esc(pct)}" placeholder="np. 30"></label>
    <label class="field"><span class="lbl">Dożywam do wieku</span>
      <input type="text" id="sym-crash-age" inputmode="numeric" value="${esc(deathAge)}" placeholder="np. 90"></label>
    <div id="sym-crash-result">${resultHTML}</div>
  </div>`;
}

// ── 8. Barista FIRE (dorabianie po FIRE) ─────────────────────────────────
// Czysty what-if: dwa wejścia (kwota, wiek końca), porównanie z tym samym
// mostem ZUS bez dorabiania. Nic nie zapisywane — barista nigdy nie wchodzi
// do state.assumptions.

export function baristaResult({ pb, pbBase, amount, untilAge }) {
  if (pb == null || pbBase == null) {
    return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć wariant Barista.</p>';
  }
  const pensionOn = !!(pb.ro.pension && pb.ro.pension.monthly > 0);
  const diff = pb.target - pbBase.target;
  const rows = [
    pb.hypothetical ? '<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy liczony od dziś.</div>' : '',
    kv('Potrzebny portfel (Barista)', money(pb.target)),
    kv(pensionOn ? 'Potrzebny portfel (bez dorabiania, z ZUS)' : 'Potrzebny portfel (bez dorabiania)', money(pbBase.target)),
    kv('Różnica', signed(diff), diff <= 0 ? 'good' : 'warn-text'),
    kv('Data FIRE (Barista)', fireCell(pb.fireYm, pbBase.fireYm)),
    gainLine(pb.fireYm, pbBase.fireYm),
    amount > 0 && pb.baristaYearly === 0
      ? `<p class="muted small">W miesiącu startu wypłat masz już ${pb.startAge} lat — dorabianie do wieku ${esc(untilAge)} nie obejmuje ani roku po FIRE. Podaj późniejszy wiek.</p>`
      : '',
    metodologia([
      'Dorobione pieniądze zmniejszają wypłaty z portfela, dopóki dorabiasz; od podanego wieku portfel przejmuje pełne wydatki (klasyczna stopa wypłat). Ten sam rachunek co przy moście ZUS — najpierw lżejsze lata, potem pełny cel.',
      pensionOn ? 'Emerytura z ZUS z Twoich ustawień jest uwzględniona w obu wariantach — różnica pokazuje czysty efekt dorabiania.' : '',
      `Po FIRE portfel pracuje na ${gl('realnie', 'realny')} zwrot po FIRE (z ustawień). Gdy jest niższy niż Twoja stopa wypłat, lata «na moście» są drogie — przy małym dorabianiu cel może wyjść nawet wyższy niż klasyczny. To nie błąd, tylko cena bezpieczniejszego portfela.`,
      'Kwota w dzisiejszych złotówkach, stała realnie. Niczego nie zapisujemy — to podgląd.',
    ]),
  ];
  return rows.join('');
}

export function baristaCard({ amount, untilAge, resultHTML }) {
  return `<div class="card"><h2>Barista FIRE ☕💼</h2>
    <p class="muted small">Nie musisz rzucać pracy z dnia na dzień. Jeśli po FIRE dorobisz kilka tysięcy miesięcznie — pół etatu, zlecenia — portfel może być mniejszy, a FIRE bliżej. Czysta symulacja, niczego nie zapisujemy.</p>
    <label class="field"><span class="lbl">Dorabiam po FIRE <span class="muted">(zł/mies. netto)</span></span>
      <input type="text" id="sym-barista" inputmode="decimal" value="${esc(amount)}" placeholder="np. 3000">
      <div class="hint">Kwota w dzisiejszych złotówkach.</div></label>
    <label class="field"><span class="lbl">Dorabiam do wieku</span>
      <input type="text" id="sym-barista-age" inputmode="numeric" value="${esc(untilAge)}" placeholder="np. 55"></label>
    <div id="sym-barista-result">${resultHTML}</div>
  </div>`;
}

export function retirementCard({ value, base, freeze, pension, pensionAge, resultHTML }) {
  const v = value == null ? base : Number(value);
  return `<div class="card"><h2>Emerytura po FIRE 🏖️</h2>
    <p class="muted small">Po przejściu na FIRE wiele osób przenosi pieniądze w bezpieczniejsze instrumenty, np. obligacje skarbowe — portfel rośnie wolniej, więc musi wystarczyć na dłużej. Przesuń suwak i sprawdź, co to zmienia. Możesz też sprawdzić, co się stanie, gdy wydatki będą rosły dalej także na emeryturze. Możesz też doliczyć emeryturę z ZUS — od wieku emerytalnego portfel dźwiga tylko część wydatków. Czysta symulacja — niczego nie zapisujemy.</p>
    <label class="field"><span class="lbl">Realny zwrot po FIRE <b id="sym-ret-post-val">${esc(Fmt.formatPct(v))}</b></span>
      <input type="range" id="sym-ret-post" min="0" max="0.06" step="0.0025" value="${v}">
    </label>
    <p class="muted small">Twoje ustawienie: ${esc(Fmt.formatPct(base))}</p>
    <label class="field"><span class="lbl">
      <input type="checkbox" id="sym-ret-freeze" ${freeze ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
      Wydatki przestają rosnąć po FIRE</span></label>
    <label class="field"><span class="lbl">Emerytura z ZUS <span class="muted">(zł/mies.)</span></span>
      <input type="text" id="sym-ret-pension" inputmode="decimal" value="${esc(pension)}" placeholder="0 = bez ZUS"></label>
    <label class="field"><span class="lbl">Wiek emerytalny (ZUS)</span>
      <input type="text" id="sym-ret-page" inputmode="numeric" value="${esc(pensionAge)}"></label>
    <div id="sym-ret-result">${resultHTML}</div>
  </div>`;
}
