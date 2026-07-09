// analysis.js — czyste buildery HTML ekranu „Analiza” (#/analiza).
// Zero DOM, zero stanu modułu: dane wchodzą parametrami (wyniki z engine.js,
// gotowe wykresy SVG z ui.js), wychodzi string. Formatowanie przez format.js.

import * as E from './engine.js';
import * as Fmt from './format.js';
import { verdictLabel, verdictEmoji } from './coach.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MONTH_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function ymShort(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${y}`;
}

const money = (v, dec = 0) => Fmt.formatPLN(v, dec);
const signed = v => (v >= 0 ? '+' : '') + money(v);

function kv(label, val, cls = '') {
  return `<div class="kv"><span>${label}</span><b${cls ? ` class="${cls}"` : ''}>${val}</b></div>`;
}

function table(headers, rowsHtml) {
  return `<div class="table-scroll"><table class="data">
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
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

// ── Legendy wykresów (jedno źródło prawdy: karta i nakładka pełnoekranowa) ─
// Wyeksportowane, by ui.js użył ich pod wykresem powiększonym bez duplikatów.
export function cumLegend() {
  return `<div class="legend"><span><i style="background:var(--accent)"></i>odłożone</span><span><i style="background:var(--muted)"></i>plan</span></div>`;
}
export function withdrawalLegend() {
  return `<div class="legend"><span><i style="background:var(--accent)"></i>saldo (— realnie, ⋯ nominalnie)</span></div>`;
}
export function meltLegend() {
  return `<div class="legend"><span><i style="background:var(--danger)"></i>historia + prognoza z nadpłatami</span><span><i style="background:var(--muted)"></i>sama rata</span></div>`;
}

// ── 1. Statystyki FIRE ──────────────────────────────────────────────────

export function statsCard({ fi, cvg, balances, a, nowYm }) {
  const coastYears = fi.coast ? E.monthsBetween(nowYm, fi.coast.fireAgeYm) / 12 : 0;
  const runway = fi.runwayMonths != null ? Fmt.formatYearsMonths(Math.floor(fi.runwayMonths)) : '—';
  const star = cvg.hasOverride ? '*' : '';
  return `<div class="card"><h2>Statystyki FIRE 🎯</h2>
    <p class="muted small">Twoje kluczowe liczby w jednym miejscu: ile drogi za Tobą, na jak długo starczą oszczędności i ile zarobił za Ciebie rynek.</p>
    ${kv('FI% (postęp do celu)', Fmt.formatPct(fi.fiPct, 1))}
    ${kv('Cel FIRE (dziś)', money(fi.target))}
    ${fi.coast ? kv('Coast FIRE', `${money(fi.coast.number)}${fi.coast.reached ? ' <span class="good">✓</span>' : ''}`) : ''}
    ${kv('Zapas (runway)', runway)}
    ${kv('Majątek netto', money(fi.netWorth))}
    ${kv('Suma wpłat od startu planu', money(cvg.totalFlow))}
    ${kv(`Wzrost rynkowy od startu${star}`, money(cvg.growth))}
    <p class="muted small">Majątek netto = gotówka + portfel − dług (realnie), <b>bez wartości domu</b>.
    ${fi.coast ? 'Coast FIRE = portfel, który bez dalszych wpłat sam dorośnie do celu w docelowym wieku FIRE.' : ''}
    ${cvg.hasOverride ? ' * wzrost zawiera ręczne korekty sald.' : ''}</p>
    ${metodologia([
      `${gl('fi-procent', 'FI%')} to Twój portfel podzielony przez ${gl('cel-fire', 'cel FIRE')}: ${money(balances.portfolio)} ÷ ${money(fi.target)} = ${Fmt.formatPct(fi.fiPct, 1)} — tyle drogi masz już za sobą.`,
      `${gl('zapas', 'Zapas')}: sumujemy gotówkę i portfel (${money(balances.cash + balances.portfolio)}) i dzielimy przez miesięczne wydatki (${money(fi.monthlyExpenses)}) — bez żadnych dochodów starczy Ci na ${fi.runwayMonths != null ? 'ok. ' + Math.floor(fi.runwayMonths) + ' mies.' : '—'}`,
      fi.coast ? `${gl('coast-fire', 'Coast FIRE')} (${money(fi.coast.number)}) to portfel, który bez ani jednej nowej wpłaty sam urośnie do celu do Twojego docelowego wieku FIRE — cofamy cel o ${coastYears.toFixed(1).replace('.', ',')} lat wzrostu.` : '',
      `Wzrost rynkowy: od dzisiejszego stanu (${money(cvg.now)}) odejmujemy stan startowy (${money(cvg.start)}) i wszystkie Twoje wpłaty (${money(cvg.totalFlow)}) — reszta, ${money(cvg.growth)}, to praca rynku.`,
    ], 'FI% = portfel ÷ cel; zapas = (gotówka + portfel) ÷ wydatki mies.')}
  </div>`;
}

// ── 2. Wykonanie planu ──────────────────────────────────────────────────

export function planPerfCard({ sav, pva, chartHTML }) {
  if (!pva.n) {
    return `<div class="card"><h2>Wykonanie planu 📋</h2>
      <p class="muted">Jeszcze brak wpisów — statystyki pojawią się po pierwszym check-inie.</p></div>`;
  }
  const rate = r => (r.n && r.rate != null ? Fmt.formatPct(r.rate, 1) : '—');
  const bars = ['crushed', 'on_plan', 'behind', 'hard'].map(v => {
    const c = pva.verdicts[v];
    const w = (c / pva.n) * 100;
    return `<div class="vbar-row"><span class="vbar-label">${verdictEmoji(v)} ${esc(verdictLabel(v))}</span>
      <div class="vbar"><i class="v-${v}" style="width:${w.toFixed(0)}%"></i></div><span class="vbar-count">${c}</span></div>`;
  }).join('');
  return `<div class="card"><h2>Wykonanie planu 📋</h2>
    <p class="muted small">Jak Twoje realne wyniki z check-inów mają się do planu — miesiąc po miesiącu i narastająco.</p>
    ${kv('Stopa oszczędzania (ostatni mies.)', rate(sav.last))}
    ${kv('Stopa oszczędzania (12 mies.)', rate(sav.trailing12))}
    ${kv('Stopa oszczędzania (od początku)', rate(sav.overall))}
    ${kv('Odłożone łącznie', money(pva.cumNet))}
    ${kv('Plan łącznie', money(pva.cumPlanned))}
    ${kv('Skumulowana różnica vs plan', signed(pva.cumDelta), pva.cumDelta >= 0 ? 'good' : 'warn-text')}
    <h3>Werdykty (${pva.n} ${pva.n === 1 ? 'wpis' : 'wpisów'})</h3>
    ${bars}
    ${pva.best ? kv('Najlepszy miesiąc', `${esc(Fmt.formatMonthName(pva.best.ym))} (${signed(pva.best.delta)})`) : ''}
    ${pva.worst ? kv('Najsłabszy miesiąc', `${esc(Fmt.formatMonthName(pva.worst.ym))} (${signed(pva.worst.delta)})`) : ''}
    ${chartHTML ? `<h3>Skumulowane: odłożone vs plan</h3>${chartHTML}
      ${cumLegend()}` : ''}
    ${metodologia([
      'Stopa oszczędzania mówi, jaka część zarobków u Ciebie zostaje: (zarobione − wydane) ÷ zarobione.',
      `Każdy check-in porównujemy z planem zamrożonym w chwili zapisu wpisu — stąd ${gl('werdykty', 'werdykt')} miesiąca; późniejsza zmiana założeń nie przepisuje przeszłości.`,
      `Skumulowana różnica: odłożone łącznie ${money(pva.cumNet)} minus plan łącznie ${money(pva.cumPlanned)} = ${signed(pva.cumDelta)}.`,
    ])}
  </div>`;
}

// ── 2b. Historia: miesiąc po miesiącu (karta ekranu Historia) ───────────
// Buduje kartę z gotowym wykresem (engine.monthlySavingsHistory → chartSVG w
// ui.js). Precedens współdzielenia: analysis.js hostuje już fireCell/cumLegend.

export function savingsHistoryCard({ chartHTML }) {
  if (!chartHTML) return '';
  return `<div class="card"><h2>Miesiąc po miesiącu 📈</h2>
    <p class="muted small">Każdy punkt to jeden check-in: ile według planu miało się
    odłożyć i ile realnie się udało. Miesiące bez wpisu są pomijane; miesiące budowy
    i deficyty schodzą poniżej osi zera.</p>
    ${chartHTML}
    ${cumLegend()}
  </div>`;
}

// ── 3. Projekcja — akumulacja ───────────────────────────────────────────

export function projectionCard({ mode, blocks, series, excelRows, houseOn, selectedYear, fireYm, excelStart, excelContrib, byPlanOnly, delta, hasFamily }) {
  const seg = `<div class="seg" role="tablist">
    ${[['yearly', 'Rocznie'], ['monthly', 'Miesięcznie'], ['excel', 'Excel']]
      .map(([m, l]) => `<button type="button" data-anmode="${m}" class="${mode === m ? 'on' : ''}">${l}</button>`).join('')}
  </div>`;
  let body = '';
  let hasOverride = false;

  if (mode === 'yearly') {
    const headers = ['Rok', 'Wiek', 'Saldo pocz.', 'Wpłaty', 'Wzrost', 'Saldo końc.',
      ...(houseOn ? ['Gotówka', 'Dług (real.)'] : []), 'Cel FIRE', '✓'];
    const rows = blocks.map(b => {
      if (b.hasOverride) hasOverride = true;
      const cls = [b.projected === 'full' ? 'proj' : '', b.reached ? 'reached' : ''].filter(Boolean).join(' ');
      return `<tr${cls ? ` class="${cls}"` : ''}>
        <td>${b.t}</td>
        <td>${b.age != null ? b.age : '—'}</td>
        <td>${money(b.portStart)}</td>
        <td>${money(b.flowPortfolio)}</td>
        <td>${money(b.growthPortfolio)}${b.hasOverride ? '*' : ''}</td>
        <td>${money(b.portEnd)}</td>
        ${houseOn ? `<td>${money(b.cashEnd)}</td><td>${money(b.debtRealEnd + (b.familyRealEnd || 0))}</td>` : ''}
        <td>${money(b.targetEnd)}</td>
        <td>${b.reached ? '🔥' : ''}</td>
      </tr>`;
    }).join('');
    body = table(headers, rows);
  } else if (mode === 'monthly') {
    const opts = blocks.map(b =>
      `<option value="${b.t}" ${b.t === selectedYear ? 'selected' : ''}>Rok ${b.t} (${ymShort(b.ymFrom)}–${ymShort(b.ymTo)})</option>`).join('');
    const chunk = series.slice((selectedYear - 1) * 12, (selectedYear - 1) * 12 + 12);
    const headers = ['Miesiąc', 'Wpłaty', 'Gotówka', 'Portfel', ...(houseOn ? ['Dług (real.)'] : []), 'Cel FIRE'];
    const rows = chunk.map(r => {
      if (r.override) hasOverride = true;
      const cls = [r.projected ? 'proj' : '', r.ym === fireYm ? 'reached' : ''].filter(Boolean).join(' ');
      return `<tr${cls ? ` class="${cls}"` : ''}>
        <td>${ymShort(r.ym)}</td>
        <td>${money((r.flowCash || 0) + (r.flowPortfolio || 0))}${r.override ? '*' : ''}</td>
        <td>${money(r.cash)}</td>
        <td>${money(r.portfolio)}</td>
        ${houseOn ? `<td>${money(r.debtReal + (r.familyReal || 0))}</td>` : ''}
        <td>${money(r.target)}</td>
      </tr>`;
    }).join('');
    body = `<label class="field"><span class="lbl">Rok planu</span><select id="an-year">${opts}</select></label>`
      + table(headers, rows);
  } else {
    const firstReached = excelRows.findIndex(r => r.reached);
    const shown = firstReached >= 0 ? excelRows.slice(0, Math.min(excelRows.length, firstReached + 5)) : excelRows;
    const headers = ['Rok', 'Wiek', 'Saldo pocz.', 'Wpłaty', 'Wzrost', 'Saldo końc.', 'Cel FIRE', '✓'];
    const rows = shown.map((r, i) => `<tr${i === firstReached ? ' class="reached"' : ''}>
      <td>${r.year}</td>
      <td>${r.age != null ? r.age : '—'}</td>
      <td>${money(r.startBal)}</td>
      <td>${money(r.contrib)}</td>
      <td>${money(r.growth)}</td>
      <td>${money(r.endBal)}</td>
      <td>${money(r.target)}</td>
      <td>${r.reached ? '✓' : ''}</td>
    </tr>`).join('');
    body = table(headers, rows)
      + (firstReached >= 0 && firstReached + 5 < excelRows.length
        ? '<p class="muted small">Tabela ucięta kilka lat po osiągnięciu celu.</p>' : '');
  }

  const noteHTML = mode === 'excel'
    ? metodologia([
      `Ten widok liczy tak jak arkusz kalkulacyjny: raz na rok, saldo końcowe = (saldo początkowe + wpłaty) × (1 + zwrot).`,
      `Startujemy od Twojego dzisiejszego portfela (${money(excelStart)}); wpłaty roczne to bieżący plan miesięczny × 12 = ${money(excelContrib)}.`,
      `Aplikacja liczy dokładniej — co miesiąc, z fazami (dom/dług), ${gl('dwa-kubelki', 'dwoma kubełkami')} i deltą z Twoich wpisów. Ten widok służy do ręcznego porównania z arkuszem Excel.`,
    ])
    : metodologia([
      `Każdy wiersz to prosta suma: saldo końcowe = saldo początkowe + wpłaty + wzrost — zgadza się co do grosza.${hasOverride ? ` Gwiazdka (*) oznacza, że we wzroście siedzą też Twoje ręczne ${gl('korekty', 'korekty sald')} — korekta nie jest wpłatą.` : ''}`,
      'Lata planu to bloki 12 miesięcy od startu planu, nie lata kalendarzowe.',
      byPlanOnly
        ? `Na razie ${gl('delta', 'prognoza „wg planu"')} — po 3 wpisach zaczniemy doliczać deltę z Twoich realnych wyników.`
        : `Prognozowane miesiące = plan + ${gl('delta', 'delta')} z Twoich ostatnich wpisów (${signed(delta)}/mies.) — prognoza uczy się na tym, jak naprawdę Ci idzie.`,
      `Tabela kończy się w miesiącu osiągnięcia FIRE — dalej liczy się Faza wypłat poniżej.${hasFamily ? ' Kolumna „Dług (real.)” to kredyt i dług rodzinny razem, w dzisiejszych złotówkach.' : ''}`,
    ]);

  return `<div class="card"><h2>Projekcja — akumulacja 📈</h2>
    <p class="muted small">Droga Twojego portfela do celu FIRE, rok po roku: historia z wpisów + prognoza (wiersze na szarym tle).</p>
    ${seg}${body}${noteHTML}
  </div>`;
}

// ── 4. Faza wypłat ──────────────────────────────────────────────────────

// Tabela roczna fazy wypłat — współdzielona przez withdrawalCard i
// dieWithZeroResult. Kolumna ZUS pojawia się tylko, gdy emerytura realnie
// płynie w którymkolwiek wierszu; wtedy „Wypłata (nom.)" staje się
// „Z portfela (nom.)" (netto po ZUS), a „Emerytura (nom.)" ląduje zaraz za nią.
// Bez ZUS wyjście jest bajt-w-bajt jak przed tą funkcją.
function withdrawalTable(rows, { taxed = false, rowClass = () => '' } = {}) {
  const showPension = rows.some(r => (r.pensionReal || 0) > 0);
  const headers = ['Rok', 'Wiek', 'Saldo pocz. (nom.)',
    showPension ? 'Z portfela (nom.)' : 'Wypłata (nom.)',
    ...(showPension ? ['Emerytura (nom.)'] : []),
    ...(taxed ? ['Podatek (nom.)'] : []),
    'Wzrost (nom.)', 'Saldo końc. (nom.)', 'Saldo końc. (realnie)'];
  const body = rows.map(r => {
    const cls = rowClass(r);
    return `<tr${cls ? ` class="${cls}"` : ''}>
    <td>${r.year} <span class="muted small">${r.ym.slice(0, 4)}</span></td>
    <td>${r.age != null ? r.age : '—'}</td>
    <td>${money(r.startNominal)}</td>
    <td>${money(showPension ? r.netWithdrawalNominal : r.withdrawalNominal)}</td>
    ${showPension ? `<td>${money(r.pensionNominal)}</td>` : ''}
    ${taxed ? `<td>${money(r.taxNominal)}</td>` : ''}
    <td>${money(r.growthNominal)}</td>
    <td>${money(r.endNominal)}</td>
    <td>${money(r.endReal)}</td>
  </tr>`;
  }).join('');
  return { html: table(headers, body), showPension };
}

export function withdrawalCard({ w, chartHTML }) {
  const target = w.swr > 0 ? w.withdrawalRealYearly / w.swr : 0;
  const taxed = !!(w.taxesApplied && w.taxesApplied.any);
  const banner = w.hypothetical
    ? `<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy od dzisiejszego celu (${money(target)}).</div>`
    : `<p class="muted small">Start: ${esc(Fmt.formatMonthName(w.startYm))}${w.startAge != null ? ` (wiek ${w.startAge})` : ''}, portfel ${money(w.rows.length ? w.rows[0].startReal : 0)}.</p>`;
  const wt = withdrawalTable(w.rows, {
    taxed,
    rowClass: r => (w.depletedYear === r.year ? 'depleted' : ''),
  });
  const pens = wt.showPension && w.ro && w.ro.pension ? w.ro.pension : null;
  const depletionWarn = w.depletedYear
    ? `<div class="banner danger small">⚠️ Portfel wyczerpuje się w ${w.depletedYear}. roku wypłat — rozważ niższą stopę wypłat lub większy portfel.${pens ? ' Emerytura z ZUS wypłacana jest dalej — kończy się tylko portfel.' : ''}</div>`
    : '';
  const postRateBanner = `<div class="banner info small">Po FIRE portfel pracuje na ${Fmt.formatPct(w.realRate)} realnie — tak, jakby pieniądze leżały w bezpieczniejszych instrumentach (np. obligacjach). Zmienisz to w Plan → Profil i FIRE.</div>`;
  return `<div class="card"><h2>Faza wypłat 🏖️</h2>
    <p class="muted small">Co dzieje się z portfelem po osiągnięciu FIRE: coroczne wypłaty pokrywają wydatki, a reszta dalej pracuje.</p>
    ${banner}${postRateBanner}${depletionWarn}
    ${chartHTML ? `${chartHTML}${withdrawalLegend()}` : ''}
    ${taxed ? kv('Podatki w fazie wypłat łącznie (realnie)', money(w.taxTotalReal)) : ''}
    ${wt.html}
    ${metodologia([
      `Pierwsza roczna wypłata to cel × ${gl('swr', 'stopa wypłat')}: ${money(target)} × ${Fmt.formatPct(w.swr)} = ${money(w.withdrawalRealYearly)}. W kolejnych latach rośnie z inflacją (${Fmt.formatPct(w.inflation)})${w.withdrawalGrowthReal > 0 ? ` i dodatkowo o ${Fmt.formatPct(w.withdrawalGrowthReal)} realnie — tak wybrano w Plan → Profil i FIRE` : ''}.`,
      pens ? `Od wieku ${pens.fromAge} część wydatków pokrywa emerytura z ZUS (${money(pens.monthly)}/mies. w dzisiejszych złotówkach) — z portfela wypłacasz tylko resztę.` : null,
      `Co roku portfel najpierw oddaje wypłatę, a reszta pracuje na ${Fmt.formatPct(w.realRate)} ${gl('realnie', 'realnie')} — to zwrot „po FIRE”, niższy niż w fazie oszczędzania, bo na emeryturze zwykle inwestuje się bezpieczniej.`,
      taxed ? `Wypłatę powiększamy tak, aby po ${gl('belka', 'podatku Belki')} (19% od części, która jest zyskiem) zostało dokładnie tyle, ile potrzebujesz — kolumna „Podatek” pokazuje różnicę. Podatek rośnie z czasem, bo coraz większa część portfela to zysk${w.taxesApplied && w.taxesApplied.ikeIkze ? ', a maleje skokowo przy 60. urodzinach (IKE bez podatku) i 65. (IKZE: 10% ryczałtu)' : ''}.` : null,
      `Kolumny nominalne pokazują przyszłe złotówki: kwoty realne × (1+inflacja)^lata, w cenach z ${esc(Fmt.formatMonthGenitive(w.startYm))} — miesiąca przejścia na FIRE.`,
    ], `saldo końc. (realnie) = (saldo pocz. − wypłata) × (1+r); r nominalne = (1+${Fmt.formatPct(w.realRate)})·(1+${Fmt.formatPct(w.inflation)}) − 1 = ${Fmt.formatPct(w.nominalRate)}`)}
  </div>`;
}

// ── 4b. Życie do zera (die with zero) ───────────────────────────────────

// Część wynikowa (podsumowanie + tabela) — podmieniana w #dwz-result przy
// zmianie wieku, więc oddzielona od karty (intro + input trwają).
export function dieWithZeroResult({ z, deathAgeRaw }) {
  if (z == null) {
    return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć fazę wypłat „do zera”.</p>';
  }
  if (z.yearsN < 1 || z.rows.length === 0) {
    return `<div class="field-error">Podaj wiek większy niż obecny (${z.startAge}).</div>`;
  }
  const diff = z.target - z.targetClassic;
  const banner = z.hypothetical
    ? `<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy od dzisiejszego celu „do zera” (${money(z.target)}).</div>`
    : '';
  const summary = kv('Cel „do zera”', money(z.target))
    + kv('Cel klasyczny (4%, ten sam miesiąc)', money(z.targetClassic))
    + kv('Różnica vs klasyczny', signed(diff), diff <= 0 ? 'good' : 'warn-text')
    + kv('Data FIRE „do zera”', fireCell(z.fireYm, z.classicFireYm))
    + kv('Data FIRE klasyczna', z.classicFireYm ? esc(Fmt.formatMonthName(z.classicFireYm)) : '<span class="warn-text">poza horyzontem</span>')
    + kv('Lata wypłat (N)', String(z.yearsN))
    + kv('Wypłata (rok 1)', money(z.withdrawalYear1));

  const wt = withdrawalTable(z.rows, {
    rowClass: r => (z.rows.length && r.year === z.rows[z.rows.length - 1].year ? 'reached' : ''),
  });

  return `${banner}${summary}
    ${wt.html}
    ${metodologia([
      `Zamiast portfela „na zawsze” liczymy taki, który wystarczy dokładnie do wieku ${z.deathAge} — czyli na ${z.yearsN} lat wypłat. ${gl('do-zera', 'Cel „do zera”')} to dzisiejsza wartość wszystkich tych wypłat razem.`,
      `Wypłata w pierwszym roku jest taka sama jak w klasycznej fazie wypłat: cel klasyczny × ${gl('swr', 'stopa wypłat')} = ${money(z.withdrawalYear1)}/rok${z.withdrawalGrowthReal > 0 ? `; rośnie o ${Fmt.formatPct(z.withdrawalGrowthReal)} realnie rocznie — dlatego cel „do zera” jest wyższy niż przy stałych wydatkach` : ', stała w dzisiejszych złotówkach (nominalnie rośnie z inflacją)'}.`,
      wt.showPension ? 'Od wieku emerytalnego z portfela wypłacasz tylko wydatki minus emeryturę z ZUS — dlatego cel «do zera» jest niższy.' : null,
      `Między wypłatami portfel pracuje na ${Fmt.formatPct(z.realRate)} ${gl('realnie', 'realnie')} (realny zwrot po FIRE — ustawisz go w Plan → Profil i FIRE).`,
      `Tabela startuje od dokładnie celu „do zera” i kończy się na 0 zł. Cel klasyczny do porównania liczymy w tym samym miesiącu (${esc(Fmt.formatMonthGenitive(z.startYm))}) — oba cele rosną z wydatkami, więc porównanie z dwóch różnych dat byłoby mylące.`,
    ], `cel = W₁·(1−qᴺ)/(1−q), q = 1/(1+r), N = ${z.yearsN}${wt.showPension ? ' (bez ZUS; z ZUS liczone rok po roku)' : ''}`)}`;
}

export function dieWithZeroCard({ resultHTML, deathAge, zusOn = false, pensionMonthly = 0, pensionAge = 65 }) {
  const zus = pensionMonthly > 0
    ? `<label class="field"><span class="lbl">
        <input type="checkbox" id="an-dwz-zus" ${zusOn ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
        Uwzględnij emeryturę ZUS (${money(pensionMonthly)}/mies. od ${pensionAge} r.ż.)</span></label>
      <p class="muted small">Kwotę i wiek zmienisz w Plan → Profil i FIRE.</p>`
    : '';
  return `<div class="card"><h2>Życie do zera ⏳</h2>
    <p class="muted small">Klasyczny cel (4%) ma starczyć na zawsze. Tu wydajesz portfel „do zera” w założonym wieku — potrzebny kapitał zwykle mniejszy, więc FIRE bywa wcześniej. Cena: pieniądze kończą się zgodnie z planem.</p>
    <div class="field">
      <label for="an-death-age">Dożywam do wieku <span class="muted small">(domyślnie 110)</span></label>
      <input id="an-death-age" type="number" inputmode="numeric" min="1" value="${deathAge}">
    </div>
    ${zus}
    <div id="dwz-result">${resultHTML}</div>
  </div>`;
}

// ── 4e. Most do emerytury ZUS ───────────────────────────────────────────
// Statyczna karta sekcji „Prognoza" (bez zdarzeń). pb = projectBridgeFire
// (nie-null: renderowana tylko przy pensionMonthly > 0 i dacie urodzenia).

export function pensionBridgeCard({ pb }) {
  const diff = pb.target - pb.targetClassic;
  const banner = pb.hypothetical
    ? '<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy liczony od dziś.</div>'
    : '';
  return `<div class="card"><h2>Most do emerytury ZUS 🌉</h2>
    <p class="muted small">Portfel nie musi wystarczyć na zawsze. Od wieku emerytalnego część wydatków pokryje ZUS — portfel dźwiga pełne wydatki tylko «na moście»: od FIRE do emerytury. Dlatego potrzebny kapitał jest mniejszy, a FIRE zwykle wypada wcześniej.</p>
    ${banner}
    ${kv('Cel z mostem ZUS', money(pb.target))}
    ${kv('Cel klasyczny (ten sam miesiąc)', money(pb.targetClassic))}
    ${kv('Różnica', signed(diff), diff <= 0 ? 'good' : 'warn-text')}
    ${kv('Data FIRE z mostem', fireCell(pb.fireYm, pb.classicFireYm))}
    ${kv('Data FIRE klasyczna', pb.classicFireYm ? esc(Fmt.formatMonthName(pb.classicFireYm)) : '<span class="warn-text">poza horyzontem</span>')}
    ${kv('Lata mostu (FIRE → emerytura)', String(pb.bridgeYears))}
    ${kv('Emerytura ZUS', `${money(pb.pensionYearly / 12)}/mies. <span class="muted small">od ${pb.pensionAge} r.ż.</span>`)}
    ${kv('Cel po emeryturze', money(pb.terminalTarget))}
    ${metodologia([
      'Cel z mostem = pieniądze na pełne wydatki od FIRE do wieku emerytalnego + kapitał, który od emerytury pokryje już tylko różnicę (wydatki − ZUS) przy Twojej stopie wypłat.',
      `Wszystko w dzisiejszych złotówkach; emerytura ZUS stała ${gl('realnie', 'realnie')} (rośnie z inflacją). Portfel na moście pracuje na realny zwrot po FIRE.`,
      'To analiza — pulpit i werdykty dalej używają klasycznego celu.',
    ], 'cel = Σ wydatki·qⁿ⁻¹ (lata mostu) + max(0, wydatki − ZUS)/SWR · qᴮ, q = 1/(1+r)')}
  </div>`;
}

// ── 4c. Podatek Belki ───────────────────────────────────────────────────

export function belkaCard({ ts, fireWith, fireWithout }) {
  return `<div class="card"><h2>Podatek Belki 🧾</h2>
    <p class="muted small">Ile 19% podatku od zysków kapitałowych zabierze przy wypłacie — i o ile przez to rośnie Twój cel FIRE.</p>
    ${kv('Cel FIRE (netto, bez podatku)', money(ts.targetNet))}
    ${kv('Cel FIRE (brutto, z podatkiem)', money(ts.targetGross))}
    ${kv('Różnica przez podatek', money(ts.targetGross - ts.targetNet), 'warn-text')}
    ${kv('Udział zysku w portfelu (dziś)', Fmt.formatPct(ts.gainShare, 1))}
    ${kv('Portfel po podatku (dziś)', money(ts.netValueReal))}
    ${kv('Data FIRE z podatkiem', fireCell(fireWith, fireWithout))}
    ${metodologia([
      `Zapisujemy, ile złotówek naprawdę wpłacasz — to Twój ${gl('belka', 'koszt nabycia')}. Wpłata go powiększa, wypłata zabiera proporcjonalny kawałek, a wzrost rynku go nie zmienia. Portfel startowy traktujemy w całości jako wpłaty.`,
      'Przy wypłacie podatek to 19% × udział zysku w portfelu. Od samych wpłat (Twojego kapitału) podatku nie ma.',
      `Liczymy ${gl('realnie', 'nominalnie')}, bo tak działa podatek Belki: zysk czysto inflacyjny też jest opodatkowany — realnie oddajesz więcej niż 19% realnego zysku.`,
      'Cel brutto powiększamy dokładnie o tyle, żeby po zapłaceniu podatku zostało to, czego potrzebujesz na wydatki.',
    ], 'cel brutto = cel netto ÷ (1 − 19% × udział zysku); udział zysku = 1 − koszt nabycia ÷ wartość nominalna')}
  </div>`;
}

// ── 4d. IKE i IKZE ──────────────────────────────────────────────────────

export function ikeIkzeCard({ ts, fireWith, fireWithout, pitRate, employmentForm }) {
  const empLabel = employmentForm === 'selfEmployed' ? 'działalność' : 'etat';
  return `<div class="card"><h2>IKE i IKZE 🛡️</h2>
    <p class="muted small">Jak dzielą się Twoje pieniądze między konta emerytalne a zwykłe — i ile podatku oszczędzają ulgi.</p>
    ${kv('Na IKE', money(ts.buckets.ike))}
    ${kv('Na IKZE', money(ts.buckets.ikze))}
    ${kv('Konto zwykłe (opodatkowane)', money(ts.buckets.taxable))}
    ${kv('Roczny limit IKE (2026)', money(ts.limits.ike))}
    ${kv('Roczny limit IKZE (2026)', `${money(ts.limits.ikze)} <span class="muted small">(${empLabel})</span>`)}
    ${kv('Wpłacone na IKZE w tym roku', money(ts.ytdIkze))}
    ${kv('Wpłacone na IKE w tym roku', money(ts.ytdIke))}
    ${kv('Zwrot PIT w przyszłym roku (prognoza)', money(ts.nextRefund))}
    ${kv('Data FIRE z IKE/IKZE', fireCell(fireWith, fireWithout))}
    ${metodologia([
      'Każda miesięczna nadwyżka wypełnia najpierw roczny limit IKZE, potem IKE, a reszta idzie na zwykłe konto. Limity z 2026 r. traktujemy jako stałe w dzisiejszych złotówkach (ustawowo rosną mniej więcej z inflacją).',
      `Za wpłaty na IKZE dostajesz zwrot PIT — ${Fmt.formatPct(pitRate)} wpłaconej kwoty. Doliczamy go do planu w kwietniu następnego roku jako dodatkową oszczędność.`,
      `Do warunku FIRE porównujemy z celem portfel „po podatku”: IKE bez podatku po 60. urodzinach, IKZE minus 10% ryczałtu po 65. (wcześniej oba jak zwykłe konto), zwykłe konto minus 19% ${gl('belka', 'podatku Belki')} od zysków.`,
      'W fazie wypłat pieniądze wypływają najpierw ze zwykłego konta, potem z IKE, na końcu z IKZE — konta z ulgami pracują najdłużej.',
    ])}
  </div>`;
}

// ── 5. Wrażliwość ───────────────────────────────────────────────────────

export function fireCell(fireYm, baseFireYm, isBase = false) {
  if (fireYm == null) return '<span class="warn-text">poza horyzontem</span>';
  const when = esc(Fmt.formatMonthName(fireYm));
  if (isBase) return `<b>${when}</b> <span class="muted small">(baza)</span>`;
  if (baseFireYm == null) return when;
  const d = E.ymToIdx(fireYm) - E.ymToIdx(baseFireYm);
  if (d === 0) return `${when} <span class="muted small">(bez zmian)</span>`;
  return d < 0
    ? `${when} <span class="good small">▲ ${-d} mies. wcześniej</span>`
    : `${when} <span class="warn-text small">▼ ${d} mies. później</span>`;
}

export function sensitivityCard({ baseFireYm, returnRows, savingsRows, swrRows }) {
  const mini = (title, headers, rowsHtml) => `<h3>${title}</h3>${table(headers, rowsHtml)}`;
  const returns = returnRows.map(r => `<tr>
    <td>${esc(r.label)}</td><td>${fireCell(r.fireYm, baseFireYm, r.isBase)}</td>
  </tr>`).join('');
  const savings = savingsRows.map(r => `<tr>
    <td>${esc(r.label)}</td><td>${fireCell(r.fireYm, baseFireYm, r.isBase)}</td>
  </tr>`).join('');
  const swr = swrRows.map(r => `<tr>
    <td>${Fmt.formatPct(r.swr)}${r.isUser ? ' <b>(Twoje)</b>' : ''} <span class="muted small">${esc(r.label)}</span></td>
    <td>×${r.multiplier.toFixed(1).replace('.', ',')}</td>
    <td>${money(r.target)}</td>
    <td>${signed(r.diffVs4pct)}</td>
    <td>${fireCell(r.fireYm, baseFireYm, r.isUser)}</td>
  </tr>`).join('');
  return `<div class="card"><h2>Wrażliwość prognozy 🎛️</h2>
    <p class="muted small">Jak przesuwa się data FIRE, gdy zmienisz jedno założenie (reszta bez zmian).</p>
    ${mini('Realny zwrot z inwestycji', ['Zwrot', 'Data FIRE'], returns)}
    ${mini('Miesięczne oszczędności', ['Zmiana', 'Data FIRE'], savings)}
    ${mini('Stopa wypłat (SWR)', ['SWR', 'Mnożnik', 'Cel', 'Różnica vs 4%', 'Data FIRE'], swr)}
    ${metodologia([
      'Bierzemy Twoją prognozę, zmieniamy jedno założenie i liczymy wszystko od nowa (plan → dług → salda → projekcja) — reszta zostaje bez zmian.',
      `Cel przy danej ${gl('swr', 'stopie wypłat')} to roczne wydatki ÷ stopa; przy 4% potrzebujesz 25× rocznych wydatków, przy 3% już 33×.`,
    ], 'cel = roczne wydatki ÷ SWR; mnożnik = 1 ÷ SWR')}
  </div>`;
}

// ── 6. Kredyt ───────────────────────────────────────────────────────────

// Legenda słupków kapitał/odsetki (współdzielona przez kredyt i dług rodzinny).
export function barLegend() {
  return `<div class="legend"><span><i style="background:var(--accent)"></i>kapitał</span><span><i style="background:var(--flame)"></i>odsetki</span></div>`;
}

// Legenda słupków „ile zostało do spłaty": kolory jak wyżej, blade = kontrakt.
export function remainingLegend(overLabel) {
  return `<div class="legend">
    <span><i style="background:var(--accent)"></i>kapitał</span>
    <span><i style="background:var(--flame)"></i>odsetki</span>
    <span><i style="background:var(--accent);opacity:.35"></i><i style="background:var(--flame);opacity:.35"></i>kontrakt (blade)</span>
    <span><i style="background:var(--accent)"></i><i style="background:var(--flame)"></i>${overLabel}</span>
  </div>`;
}

// Sekcja „ile zostało do spłaty" (współdzielona przez oba kredyty).
function remainingSection(remainingBarHTML, overLabel) {
  if (!remainingBarHTML) return '';
  return `<h3>Ile zostało do spłaty: kapitał + przyszłe odsetki</h3>${remainingBarHTML}${remainingLegend(overLabel)}
    <p class="muted small">Słupek = stan na początku roku kredytu: saldo kapitału + wszystkie przyszłe odsetki. Pełne słupki kończą się wcześniej niż blade — to miesiące szybszej wolności od długu.</p>`;
}

export function mortgageCard({ ma, chartHTML, barHTML, remainingBarHTML }) {
  const saved = ma.interestSavedSoFar;
  return `<div class="card"><h2>Kredyt 🏠</h2>
    <p class="muted small">Gdzie jesteś w spłacie kredytu, ile kosztują Cię odsetki i ile realnie dają nadpłaty.</p>
    ${kv('Saldo (nominalnie)', money(ma.balanceNominal))}
    ${kv('Odsetki zapłacone', money(ma.paidInterest))}
    ${kv('Kapitał spłacony', money(ma.paidPrincipal))}
    ${kv('Nadpłaty łącznie', money(ma.overpaidTotal))}
    ${kv('Odsetki pozostałe (sama rata)', money(ma.scheduleOnlyRemainingInterest))}
    ${kv('Pozostało do spłaty (sama rata)', money(ma.balanceNominal + ma.scheduleOnlyRemainingInterest))}
    ${kv('Oszczędność z nadpłat (dotychczas)', money(saved), saved > 0.005 ? 'good' : '')}
    ${ma.monthsAheadOfContract > 0 ? kv('Przed harmonogramem kontraktu', `${ma.monthsAheadOfContract} mies.`, 'good') : ''}
    ${kv('Spłata wg kontraktu', esc(Fmt.formatMonthName(ma.contractPayoffYm)))}
    ${kv('Spłata przy samej racie', esc(Fmt.formatMonthName(ma.scheduleOnlyPayoffYm)))}
    ${kv('Spłata prognozowana (z nadpłatami)', ma.projectedPayoffYm ? esc(Fmt.formatMonthName(ma.projectedPayoffYm)) : '—')}
    ${chartHTML ? `<h3>Saldo nominalne: sama rata vs z nadpłatami</h3>${chartHTML}
      ${meltLegend()}` : ''}
    ${remainingSection(remainingBarHTML, 'z nadpłatami (pełne)')}
    ${barHTML ? `<h3>Struktura rat: kapitał vs odsetki</h3>${barHTML}${barLegend()}
      <p class="muted small">Rozkład kontraktowy (bez nadpłat) po latach kredytu — odsetki maleją, kapitał rośnie.</p>` : ''}
    ${metodologia([
      `Twoja rata to ${money(ma.payment, 2)}/mies. — stała przez cały okres (${gl('annuitet', 'rata równa')}) i ${gl('realnie', 'nominalna')}: umowa kredytu jest w przyszłych złotówkach, więc realnie rata z czasem „topnieje” z inflacją.`,
      `Oszczędność z nadpłat: od wszystkich odsetek umowy (${money(ma.contractTotalInterest)}) odejmujemy już zapłacone (${money(ma.paidInterest)}) i te, które zostały przy samej racie (${money(ma.scheduleOnlyRemainingInterest)}) = ${money(saved)}.`,
      `Prognoza „z nadpłatami” zakłada strategię aplikacji: cała miesięczna nadwyżka ${gl('nadplata', 'nadpłaca')} kredyt, nadmiar wraca do portfela.`,
      'Wykres „Ile zostało do spłaty”: na początku każdego roku kredytu pokazujemy saldo kapitału + wszystkie przyszłe odsetki. Blade słupki to umowa bez nadpłat, pełne — historia z nadpłatami + prognoza.',
    ])}
  </div>`;
}

// ── 6a. Dług rodzinny ───────────────────────────────────────────────────

export function familyLoanCard({ fa, chartHTML, barHTML, remainingBarHTML }) {
  const saved = fa.interestSavedSoFar;
  return `<div class="card"><h2>Dług rodzinny 👨‍👩‍👧</h2>
    <p class="muted small">Gdzie jesteś w spłacie długu rodzinnego i co zmieniają jawne nadpłaty z check-inów.</p>
    ${kv('Saldo (nominalnie)', money(fa.balanceNominal))}
    ${kv('Odsetki zapłacone', money(fa.paidInterest))}
    ${kv('Kapitał spłacony', money(fa.paidPrincipal))}
    ${kv('Nadpłaty łącznie', money(fa.overpaidTotal))}
    ${kv('Odsetki pozostałe (sama rata)', money(fa.scheduleOnlyRemainingInterest))}
    ${kv('Pozostało do spłaty (sama rata)', money(fa.balanceNominal + fa.scheduleOnlyRemainingInterest))}
    ${kv('Oszczędność z nadpłat (dotychczas)', money(saved), saved > 0.005 ? 'good' : '')}
    ${fa.monthsAheadOfContract > 0 ? kv('Przed harmonogramem kontraktu', `${fa.monthsAheadOfContract} mies.`, 'good') : ''}
    ${kv('Spłata wg kontraktu', esc(Fmt.formatMonthName(fa.contractPayoffYm)))}
    ${kv('Spłata przy samej racie', esc(Fmt.formatMonthName(fa.scheduleOnlyPayoffYm)))}
    ${kv('Spłata prognozowana (z nadpłatami)', fa.projectedPayoffYm ? esc(Fmt.formatMonthName(fa.projectedPayoffYm)) : '—')}
    ${chartHTML ? `<h3>Saldo nominalne: sama rata vs z nadpłatami</h3>${chartHTML}
      ${meltLegend()}` : ''}
    ${remainingSection(remainingBarHTML, 'z nadpłatami (tylko jawne z check-inu)')}
    ${barHTML ? `<h3>Struktura rat: kapitał vs odsetki</h3>${barHTML}${barLegend()}
      <p class="muted small">Rozkład kontraktowy (bez nadpłat) po latach spłaty.</p>` : ''}
    ${metodologia([
      `Rata to ${money(fa.payment, 2)}/mies. — ${gl('annuitet', 'rata równa')} dobrana tak, by dług zniknął dokładnie na koniec umówionego okna spłaty. Jak kredyt, dług rodzinny jest ${gl('realnie', 'nominalny')} (umowa w przyszłych złotówkach).`,
      `Oszczędność z nadpłat: od wszystkich odsetek umowy (${money(fa.contractTotalInterest)}) odejmujemy już zapłacone (${money(fa.paidInterest)}) i te, które zostały przy samej racie (${money(fa.scheduleOnlyRemainingInterest)}) = ${money(saved)}.`,
      `Dług rodzinny spłaca się według stałego harmonogramu — miesięczna nadwyżka go nie nadpłaca; przyspieszają go tylko jawne ${gl('nadplata', 'nadpłaty')} z check-inu.`,
      'Wykres „Ile zostało do spłaty”: na początku każdego roku spłaty pokazujemy saldo kapitału + wszystkie przyszłe odsetki. Blade słupki to umowa, pełne — historia (z jawnymi nadpłatami) + prognoza.',
    ])}
  </div>`;
}

// ── 7. Raport roczny „Twój rok FIRE" (#/raport/:year) ────────────────────
// rep = wynik engine.annualReport (nie-null); years = engine.reportYears(state).
// Tylko odczyt: żadnych pól, żadnych zapisów — nawigacja to zwykłe hash-linki.

export function annualReportScreen({ rep, years }) {
  const clamped = rep.from !== `${rep.year}-01` || rep.to !== `${rep.year}-12`;
  const header = `<div class="card center">
    <h2>Twój rok FIRE ${rep.year} 🔥</h2>
    ${clamped ? `<p class="muted small">Raport obejmuje ${ymShort(rep.from)} – ${ymShort(rep.to)} (część roku w planie).</p>` : ''}
  </div>`;

  // Nawigacja: sąsiednie lata z wpisami + powrót do Historii.
  const prevY = years.includes(rep.year - 1) ? `<a class="btn" href="#/raport/${rep.year - 1}">← ${rep.year - 1}</a>` : '';
  const nextY = years.includes(rep.year + 1) ? `<a class="btn" href="#/raport/${rep.year + 1}">${rep.year + 1} →</a>` : '';
  const nav = `${prevY || nextY ? `<div class="btn-row">${prevY}${nextY}</div>` : ''}
    <a class="btn ghost wide" href="#/history">← Historia</a>`;

  if (rep.entriesCount === 0) {
    return `${header}<div class="card"><p class="muted">Brak wpisów w tym roku.</p></div>${nav}`;
  }

  // 2. Odłożone w roku.
  const savedSummary = rep.delta >= 0
    ? 'Rok na plus względem planu. Tę nadwyżkę procent składany będzie powtarzał Ci przez dekady.'
    : 'Rok poniżej planu — ale zmierzony, a co mierzysz, tym zarządzasz. Wybierz jedną rzecz do poprawy na nowy rok.';
  const saved = `<div class="card"><h2>Odłożone w roku 💰</h2>
    ${kv('Odłożone razem', money(rep.totalSaved))}
    ${kv('Plan na ten okres', money(rep.totalPlanned))}
    ${kv('Różnica', signed(rep.delta), rep.delta >= 0 ? 'good' : 'warn-text')}
    ${rep.best ? kv('Najlepszy miesiąc', `${esc(Fmt.formatMonthName(rep.best.month))} (${money(rep.best.net)})`) : ''}
    ${rep.worst ? kv('Najsłabszy miesiąc', `${esc(Fmt.formatMonthName(rep.worst.month))} (${money(rep.worst.net)})`) : ''}
    <p class="muted small">${savedSummary}</p>
  </div>`;

  // 3. Seria i werdykty (wiersze zerowe pomijane).
  const verdictRows = ['crushed', 'on_plan', 'behind', 'hard']
    .filter(v => rep.verdicts[v] > 0)
    .map(v => kv(`${verdictEmoji(v)} ${esc(verdictLabel(v))}`, String(rep.verdicts[v])))
    .join('');
  const streak = `<div class="card"><h2>Seria i werdykty 🎖️</h2>
    ${kv('Dobre miesiące', `${rep.goodMonths} z ${rep.entriesCount} wpisów`)}
    ${kv('Najdłuższa seria w roku', `🔥 ${rep.bestRun}`)}
    ${verdictRows}
  </div>`;

  // 4. Postęp do celu (FI%).
  const pct = v => Fmt.formatPct(v, 1);
  const progress = (rep.fiPctStart != null && rep.fiPctEnd != null)
    ? `<div class="card"><h2>Postęp do celu 🎯</h2>
      ${kv('FI% na początku roku', pct(rep.fiPctStart))}
      ${kv('FI% na końcu roku', pct(rep.fiPctEnd))}
      ${kv('Zmiana', `${rep.fiPctDelta >= 0 ? '+' : ''}${pct(rep.fiPctDelta)}`, rep.fiPctDelta >= 0 ? 'good' : 'warn-text')}
    </div>` : '';

  // 5. Data FIRE — jedno zdanie wg przypadku.
  const shift = rep.fireShiftMonths;
  let fireLine;
  if (shift != null && shift > 0) {
    fireLine = `Prognoza FIRE przyspieszyła w tym roku o ${Fmt.formatYearsMonths(shift)} — z ${esc(Fmt.formatMonthName(rep.fireYmPrev))} na ${esc(Fmt.formatMonthName(rep.fireYmNow))}. Tak wygląda kupowanie sobie czasu.`;
  } else if (shift != null && shift < 0) {
    fireLine = `Prognoza FIRE przesunęła się o ${Fmt.formatYearsMonths(-shift)} dalej — z ${esc(Fmt.formatMonthName(rep.fireYmPrev))} na ${esc(Fmt.formatMonthName(rep.fireYmNow))}. Jeden rok nie przekreśla planu: wnioski są w liczbach wyżej.`;
  } else if (shift === 0) {
    fireLine = `Prognoza FIRE bez zmian: ${esc(Fmt.formatMonthName(rep.fireYmNow))}. Stabilnie — dokładnie tak buduje się wolność.`;
  } else if (!rep.reachedPrev && rep.reachedNow) {
    fireLine = `Rok temu prognoza nie domykała się w horyzoncie — dziś FIRE ma datę: ${esc(Fmt.formatMonthName(rep.fireYmNow))}. To zasługa tego roku.`;
  } else if (rep.reachedPrev && !rep.reachedNow) {
    fireLine = 'Prognoza wypadła poza horyzont — zajrzyj do założeń i wpisów, liczby wyżej pokażą, co się zmieniło.';
  } else {
    fireLine = 'Prognoza FIRE jest poza 60-letnim horyzontem — raport pokazuje, co realnie udało się odłożyć.';
  }
  const fire = `<div class="card"><h2>Data FIRE 📅</h2>
    <p>${fireLine}</p>
    ${metodologia([
      `Obie prognozy liczone dzisiejszymi założeniami — porównujemy tylko wpisy: stan na koniec ${rep.year - 1} vs stan na ${ymShort(rep.to)}.`,
      'FI% = portfel ÷ cel FIRE w danym miesiącu (cel jest ruchomy); zmiana podana w punktach procentowych.',
    ])}
  </div>`;

  // 6. Notatki z roku (jeśli są) — historia miesięcy własnymi słowami.
  const notes = rep.notes && rep.notes.length
    ? `<div class="card"><h2>Notatki z roku 📝</h2>
      ${rep.notes.map(n => kv(esc(Fmt.formatMonthName(n.ym)), esc(n.note))).join('')}
    </div>` : '';

  return `${header}${saved}${streak}${progress}${fire}${notes}${nav}`;
}
