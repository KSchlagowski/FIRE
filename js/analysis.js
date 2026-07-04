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

function metodologia(lines) {
  return `<details class="section"><summary>Jak to liczymy?</summary>
    ${lines.map(l => `<div class="formula">${l}</div>`).join('')}
  </details>`;
}

// ── 1. Statystyki FIRE ──────────────────────────────────────────────────

export function statsCard({ fi, cvg, balances, a, nowYm }) {
  const coastYears = fi.coast ? E.monthsBetween(nowYm, fi.coast.fireAgeYm) / 12 : 0;
  const runway = fi.runwayMonths != null ? Fmt.formatYearsMonths(Math.floor(fi.runwayMonths)) : '—';
  const star = cvg.hasOverride ? '*' : '';
  return `<div class="card"><h2>Statystyki FIRE 🎯</h2>
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
      `FI% = portfel ÷ cel = ${money(balances.portfolio)} ÷ ${money(fi.target)} = ${Fmt.formatPct(fi.fiPct, 1)}`,
      fi.coast ? `Coast FIRE = cel w wieku FIRE ÷ (1+r)^lata = ${money(fi.coast.number * Math.pow(1 + a.realReturnAnnual, coastYears))} ÷ ${Math.pow(1 + a.realReturnAnnual, coastYears).toFixed(4).replace('.', ',')} = ${money(fi.coast.number)}` : '',
      `Zapas = (gotówka + portfel) ÷ wydatki mies. = ${money(balances.cash + balances.portfolio)} ÷ ${money(fi.monthlyExpenses)} = ${fi.runwayMonths != null ? Math.floor(fi.runwayMonths) + ' mies.' : '—'}`,
      `Wzrost = stan dziś − stan startowy − wpłaty = ${money(cvg.now)} − ${money(cvg.start)} − ${money(cvg.totalFlow)} = ${money(cvg.growth)}`,
    ].filter(Boolean))}
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
      <div class="legend"><span><i style="background:var(--accent)"></i>odłożone</span><span><i style="background:var(--muted)"></i>plan</span></div>` : ''}
    ${metodologia([
      'Stopa oszczędzania = (zarobione − wydane) ÷ zarobione.',
      'Plan każdego miesiąca to snapshot zamrożony przy zapisie wpisu — późniejsza zmiana założeń nie przepisuje przeszłości.',
      `Skumulowana różnica = ${money(pva.cumNet)} − ${money(pva.cumPlanned)} = ${signed(pva.cumDelta)}`,
    ])}
  </div>`;
}

// ── 3. Projekcja — akumulacja ───────────────────────────────────────────

export function projectionCard({ mode, blocks, series, excelRows, houseOn, selectedYear, fireYm, excelStart, excelContrib, byPlanOnly, delta }) {
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
        <td>Rok ${b.t} <span class="muted small">${ymShort(b.ymFrom)}–${ymShort(b.ymTo)}</span></td>
        <td>${b.age != null ? b.age : '—'}</td>
        <td>${money(b.portStart)}</td>
        <td>${money(b.flowPortfolio)}</td>
        <td>${money(b.growthPortfolio)}${b.hasOverride ? '*' : ''}</td>
        <td>${money(b.portEnd)}</td>
        ${houseOn ? `<td>${money(b.cashEnd)}</td><td>${money(b.debtRealEnd)}</td>` : ''}
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
        ${houseOn ? `<td>${money(r.debtReal)}</td>` : ''}
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
      <td>${r.year} <span class="muted small">${r.ym.slice(0, 4)}</span></td>
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

  const noteLines = mode === 'excel'
    ? [
      `Konwencja arkusza Projekcja: saldo końc. = (saldo pocz. + wpłaty) × (1+r) — kapitalizacja ROCZNA.`,
      `Start = dzisiejszy portfel = ${money(excelStart)}; wpłaty roczne = plan bieżącego miesiąca × 12 = ${money(excelContrib)}.`,
      'Ten widok różni się od modelu aplikacji: aplikacja liczy miesięcznie (annuity-due), zna fazy (dom/dług), dwa kubełki i deltę z Twoich wpisów. Excel służy do ręcznego cross-checku z arkuszem.',
    ]
    : [
      'Saldo końc. = saldo pocz. + wpłaty + wzrost — tożsamość zachodzi dokładnie; wzrost jest rezydualny.',
      hasOverride ? '* wzrost zawiera ręczne korekty sald (korekta nie jest wpłatą).' : '',
      'Lata planu to bloki 12 miesięcy od startu planu (kotwicy), nie lata kalendarzowe.',
      byPlanOnly
        ? 'Prognoza wg planu — po 3 wpisach doliczana będzie delta z Twoich realnych wyników.'
        : `Prognozowane miesiące = plan + delta z ostatnich wpisów (${signed(delta)}/mies.).`,
      'Tabela kończy się w miesiącu osiągnięcia FIRE (jak kolumna „Osiągnięto?” w Excelu) — dalej liczy się Faza wypłat poniżej.',
    ];

  return `<div class="card"><h2>Projekcja — akumulacja 📈</h2>
    ${seg}${body}${metodologia(noteLines.filter(Boolean))}
  </div>`;
}

// ── 4. Faza wypłat ──────────────────────────────────────────────────────

export function withdrawalCard({ w, chartHTML }) {
  const target = w.swr > 0 ? w.withdrawalRealYearly / w.swr : 0;
  const banner = w.hypothetical
    ? `<div class="banner info small">FIRE poza horyzontem prognozy — scenariusz modelowy od dzisiejszego celu (${money(target)}).</div>`
    : `<p class="muted small">Start: ${esc(Fmt.formatMonthName(w.startYm))}${w.startAge != null ? ` (wiek ${w.startAge})` : ''}, portfel ${money(w.rows.length ? w.rows[0].startReal : 0)}.</p>`;
  const headers = ['Rok', 'Wiek', 'Saldo pocz. (nom.)', 'Wypłata (nom.)', 'Wzrost (nom.)', 'Saldo końc. (nom.)', 'Saldo końc. (realnie)'];
  const rows = w.rows.map(r => `<tr${w.depletedYear === r.year ? ' class="depleted"' : ''}>
    <td>${r.year} <span class="muted small">${r.ym.slice(0, 4)}</span></td>
    <td>${r.age != null ? r.age : '—'}</td>
    <td>${money(r.startNominal)}</td>
    <td>${money(r.withdrawalNominal)}</td>
    <td>${money(r.growthNominal)}</td>
    <td>${money(r.endNominal)}</td>
    <td>${money(r.endReal)}</td>
  </tr>`).join('');
  const depletionWarn = w.depletedYear
    ? `<div class="banner danger small">⚠️ Portfel wyczerpuje się w ${w.depletedYear}. roku wypłat — rozważ niższą stopę wypłat lub większy portfel.</div>`
    : '';
  return `<div class="card"><h2>Faza wypłat 🏖️</h2>
    ${banner}${depletionWarn}
    ${chartHTML ? `${chartHTML}<div class="legend"><span><i style="background:var(--accent)"></i>saldo (— realnie, ⋯ nominalnie)</span></div>` : ''}
    ${table(headers, rows)}
    ${metodologia([
      `Wypłata (rok 1) = cel × SWR = ${money(target)} × ${Fmt.formatPct(w.swr)} = ${money(w.withdrawalRealYearly)}/rok; rośnie z inflacją ${Fmt.formatPct(w.inflation)}.`,
      `R nominalne = (1+${Fmt.formatPct(w.realRate)})·(1+${Fmt.formatPct(w.inflation)}) − 1 = ${Fmt.formatPct(w.nominalRate)}`,
      'Saldo końc. (realnie) = (saldo pocz. − wypłata) × (1+r) — rekurencja w dzisiejszych zł; kolumny nominalne = realne × (1+inflacja)^n.',
      `Kwoty nominalne w złotówkach z cen roku przejścia na FIRE (indeks cen = 1 w ${esc(Fmt.formatMonthGenitive(w.startYm))}).`,
    ])}
  </div>`;
}

// ── 5. Wrażliwość ───────────────────────────────────────────────────────

function fireCell(fireYm, baseFireYm, isBase = false) {
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
      'Każdy wariant to pełny przebieg prognozy (plan → dług → salda → projekcja) z jednym zmienionym założeniem.',
      'Cel przy SWR = roczne wydatki ÷ SWR; mnożnik = 1 ÷ SWR (4% → 25× rocznych wydatków).',
    ])}
  </div>`;
}

// ── 5a. Symulacja „co jeśli” ────────────────────────────────────────────

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

export function simulationCard({ nowYm, month, amount, recurring, resultHTML }) {
  return `<div class="card"><h2>Symulacja 🧪</h2>
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
      'Symulacja = pełny przebieg prognozy (plan → dług → salda → projekcja) z kwotą dodaną do planu wybranego miesiąca.',
      'Nic nie zapisujemy — po odświeżeniu ekranu symulacja znika, a wpisy i założenia pozostają nietknięte.',
    ])}
  </div>`;
}

// ── 6. Kredyt ───────────────────────────────────────────────────────────

export function mortgageCard({ ma, chartHTML }) {
  const saved = ma.interestSavedSoFar;
  return `<div class="card"><h2>Kredyt 🏠</h2>
    ${kv('Saldo (nominalnie)', money(ma.balanceNominal))}
    ${kv('Odsetki zapłacone', money(ma.paidInterest))}
    ${kv('Kapitał spłacony', money(ma.paidPrincipal))}
    ${kv('Nadpłaty łącznie', money(ma.overpaidTotal))}
    ${kv('Odsetki pozostałe (sama rata)', money(ma.scheduleOnlyRemainingInterest))}
    ${kv('Oszczędność z nadpłat (dotychczas)', money(saved), saved > 0.005 ? 'good' : '')}
    ${ma.monthsAheadOfContract > 0 ? kv('Przed harmonogramem kontraktu', `${ma.monthsAheadOfContract} mies.`, 'good') : ''}
    ${kv('Spłata wg kontraktu', esc(Fmt.formatMonthName(ma.contractPayoffYm)))}
    ${kv('Spłata przy samej racie', esc(Fmt.formatMonthName(ma.scheduleOnlyPayoffYm)))}
    ${kv('Spłata prognozowana (z nadpłatami)', ma.projectedPayoffYm ? esc(Fmt.formatMonthName(ma.projectedPayoffYm)) : '—')}
    ${chartHTML ? `<h3>Saldo nominalne: sama rata vs z nadpłatami</h3>${chartHTML}
      <div class="legend"><span><i style="background:var(--danger)"></i>historia + prognoza z nadpłatami</span><span><i style="background:var(--muted)"></i>sama rata</span></div>` : ''}
    ${metodologia([
      `Rata = ${money(ma.payment, 2)}/mies. (annuitet, nominalnie — kredyt to jedyny nominalny kontrakt w aplikacji).`,
      `Oszczędność = Σ odsetek kontraktu − zapłacone − pozostałe wg harmonogramu = ${money(ma.contractTotalInterest)} − ${money(ma.paidInterest)} − ${money(ma.scheduleOnlyRemainingInterest)} = ${money(saved)}`,
      'Prognoza „z nadpłatami” zakłada strategię aplikacji: cała miesięczna nadwyżka nadpłaca kredyt, nadmiar wraca do portfela.',
    ])}
  </div>`;
}
