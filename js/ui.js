// ui.js — renderery ekranów, router hashowy, wykresy SVG, zdarzenia.

import * as E from './engine.js';
import * as Fmt from './format.js';
import * as An from './analysis.js';
import { coachMessage, verdictLabel, verdictEmoji } from './coach.js';
import { storage, exportJSON, importPreview } from './storage.js';

export const APP_VERSION = '1.4.0';

let state = null;
let ob = null;               // stan kreatora onboardingu
let deferredPrompt = null;   // beforeinstallprompt
let importCandidate = null;  // podgląd importu
let resetArmed = false;

const view = () => document.getElementById('view');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Zapis + toast ───────────────────────────────────────────────────────

function persist() {
  const r = storage.save(state);
  if (!r.ok) toast(r.error, 8000);
}

let toastTimer = null;
export function toast(msg, ms = 4000, onClick = null) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  t.onclick = () => { t.hidden = true; if (onClick) onClick(); };
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function setDeferredPrompt(e) {
  deferredPrompt = e;
  if ((location.hash || '#/') === '#/' && state) route();
}

// ── Pomocnicze fragmenty HTML ───────────────────────────────────────────

function tip(text) {
  return `<details class="tip"><summary>?</summary><p>${esc(text)}</p></details>`;
}

function field({ id, label, value = '', tipText = '', hint = '', type = 'text', mode = 'decimal', placeholder = '', suffix = '', max = '' }) {
  const im = type === 'text' ? ` inputmode="${mode}"` : '';
  return `<label class="field">
    <span class="lbl">${esc(label)}${suffix ? ` <span class="muted">(${esc(suffix)})</span>` : ''}${tipText ? tip(tipText) : ''}</span>
    <input type="${type}" id="${id}"${im} value="${esc(value)}" placeholder="${esc(placeholder)}"${max ? ` max="${esc(max)}"` : ''}>
    ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}
  </label>`;
}

function moneyVal(v) {
  if (v == null || v === '') return '';
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

function pctVal(v) {
  if (v == null) return '';
  let s = (v * 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

function parseMoney(id, { required = true, min = 0 } = {}) {
  const raw = $('#' + id).value.trim();
  if (raw === '') return required ? { error: 'Pole wymagane' } : { value: null };
  const v = Fmt.parsePLN(raw);
  if (v == null) return { error: 'Nieprawidłowa kwota' };
  if (v < min) return { error: `Wartość nie może być mniejsza niż ${min}` };
  return { value: v };
}

function parsePct(id, { required = true, min = -0.5, max = 1 } = {}) {
  const raw = $('#' + id).value.trim();
  if (raw === '') return required ? { error: 'Pole wymagane' } : { value: null };
  const v = Fmt.parsePLN(raw);
  if (v == null) return { error: 'Nieprawidłowa wartość' };
  const p = v / 100;
  if (p < min || p > max) return { error: 'Wartość poza zakresem' };
  return { value: p };
}

function formatShort(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' mln';
  if (a >= 1e3) return Math.round(x / 1e3) + ' tys.';
  return String(Math.round(x));
}

// ── Wykres SVG (≤120 punktów po decymacji) ──────────────────────────────

export function chartSVG(rows, defs, { height = 170 } = {}) {
  if (!rows.length) return '';
  const step = Math.ceil(rows.length / 120);
  const pts = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const W = 440, H = height, padL = 48, padR = 8, padT = 10, padB = 20;
  let max = 0;
  for (const r of pts) for (const d of defs) max = Math.max(max, d.get(r) || 0);
  if (max <= 0) max = 1;
  const x = i => padL + i * (W - padL - padR) / Math.max(1, pts.length - 1);
  const y = v => padT + (1 - Math.min(v, max) / max) * (H - padT - padB);
  const lines = [];
  for (const d of defs) {
    if (d.split) {
      const hist = [], proj = [];
      pts.forEach((r, i) => {
        const p = `${x(i).toFixed(1)},${y(d.get(r) || 0).toFixed(1)}`;
        if (r.projected) { if (proj.length === 0 && hist.length) proj.push(hist[hist.length - 1]); proj.push(p); }
        else hist.push(p);
      });
      if (hist.length > 1) lines.push(`<polyline class="${d.cls}" points="${hist.join(' ')}"/>`);
      if (proj.length > 1) lines.push(`<polyline class="${d.clsProj || d.cls}" points="${proj.join(' ')}"/>`);
    } else {
      const p = pts.map((r, i) => `${x(i).toFixed(1)},${y(d.get(r) || 0).toFixed(1)}`);
      lines.push(`<polyline class="${d.cls}" points="${p.join(' ')}"/>`);
    }
  }
  const y0 = y(0), yM = y(max), yH = y(max / 2);
  const first = pts[0].ym.slice(0, 4), last = pts[pts.length - 1].ym.slice(0, 4);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    <line class="axis" x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}"/>
    <line class="axis" x1="${padL}" y1="${yM}" x2="${W - padR}" y2="${yM}" opacity=".4"/>
    <line class="axis" x1="${padL}" y1="${yH}" x2="${W - padR}" y2="${yH}" opacity=".4"/>
    <text x="${padL - 4}" y="${y0 + 3}" text-anchor="end">0</text>
    <text x="${padL - 4}" y="${yH + 3}" text-anchor="end">${formatShort(max / 2)}</text>
    <text x="${padL - 4}" y="${yM + 3}" text-anchor="end">${formatShort(max)}</text>
    <text x="${padL}" y="${H - 4}">${first}</text>
    <text x="${W - padR}" y="${H - 4}" text-anchor="end">${last}</text>
    ${lines.join('')}
  </svg>`;
}

function ringSVG(pct, sublabel = 'celu FIRE') {
  const r = 80, c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(pct, 1)) * c;
  return `<div class="ring-wrap">
    <svg viewBox="0 0 190 190" width="190" height="190">
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--accent)" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 95 95)"/>
    </svg>
    <div class="ring-center">
      <span class="pct">${(Math.min(pct, 1) * 100).toFixed(1).replace('.', ',')}%</span>
      <span class="muted small">${esc(sublabel)}</span>
    </div>
  </div>`;
}

// ── Router ──────────────────────────────────────────────────────────────

export function startApp(loaded) {
  state = loaded;
  if (state) {
    E.recomputeDerived(state);
    applyTheme();
  }
  $('#header-month').textContent = Fmt.formatMonthName(E.todayYm());
  window.addEventListener('hashchange', route);
  route();
}

export function getState() { return state; }

function applyTheme() {
  const t = state && state.ui.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function route() {
  const hash = location.hash || '#/';
  const tabbar = document.getElementById('tabbar');
  if (!state) {
    tabbar.hidden = true;
    renderOnboarding();
    return;
  }
  tabbar.hidden = false;
  $$('#tabbar a').forEach(a => a.classList.toggle('active',
    a.dataset.route === (hash.startsWith('#/checkin') ? '#/' : hash.split('/').slice(0, 2).join('/'))));
  window.scrollTo(0, 0);
  if (hash.startsWith('#/checkin')) {
    const m = hash.split('/')[2];
    renderCheckin(m && E.isValidYm(m) ? m : null);
  } else if (hash === '#/history') renderHistory();
  else if (hash === '#/analiza') renderAnaliza();
  else if (hash === '#/plan') renderPlan();
  else if (hash === '#/backup') renderBackup();
  else renderDashboard();
}

// ── Onboarding (5 kroków) ───────────────────────────────────────────────

const OB_DEFAULTS = {
  birthDate: '', targetFireAge: '', monthlyIncome: '',
  monthlyLivingExpenses: '', currentRentMonthly: '', cashStart: '', portfolioStart: '',
  houseEnabled: false, mtgStart: '', mtgPrincipal: '', mtgRate: '7', mtgTerm: '25', mtgOverride: '',
  moveIn: '', hsMonth: '', hsAmount: '', bizIncome: '', bizStart: '',
  wr: '4', realReturn: '5', inflation: '3', gExp: '1', gInc: '3', cashReturn: '0',
};

function renderOnboarding() {
  if (!ob) ob = { step: 0, d: { ...OB_DEFAULTS }, error: '' };
  const s = ob.step;
  const dots = `<div class="dots">${[0, 1, 2, 3, 4].map(i => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>`;
  const err = ob.error ? `<div class="field-error">${esc(ob.error)}</div>` : '';
  let body = '';

  if (s === 0) {
    body = `<div class="card">
      <h2>Witaj w FIRE Companion 🔥</h2>
      <p>Twój prywatny licznik drogi do <b>wolności finansowej</b> (FIRE — Financial Independence, Retire Early).</p>
      <p><b>Rytuał jest prosty:</b> 1. dnia każdego miesiąca wpisujesz, ile w poprzednim miesiącu
      <b>zarobiłeś</b> i ile <b>wydałeś</b>. Aplikacja aktualizuje Twój portfel, porównuje wynik z planem
      i mówi Ci wprost, jak idzie.</p>
      <p class="muted">Wszystkie dane zostają wyłącznie na tym urządzeniu. Zero kont, zero chmury, działa offline.</p>
      <button class="primary wide" data-next>Zaczynamy</button>
    </div>`;
  } else if (s === 1) {
    body = `<div class="card"><h2>O Tobie</h2>${err}
      ${field({ id: 'ob-birth', label: 'Data urodzenia', type: 'date', value: ob.d.birthDate })}
      ${field({ id: 'ob-fireage', label: 'Docelowy wiek FIRE', value: ob.d.targetFireAge, mode: 'numeric', placeholder: 'np. 45', tipText: 'Wiek, w którym chcesz móc przestać pracować dla pieniędzy. Prognoza będzie porównywana z tym celem.' })}
      ${field({ id: 'ob-income', label: 'Miesięczny dochód netto', suffix: 'zł', value: ob.d.monthlyIncome, tipText: 'Suma wszystkich dochodów "na rękę" w typowym miesiącu.' })}
      <div class="btn-row"><button data-back>Wstecz</button><button class="primary" data-next>Dalej</button></div>
    </div>`;
  } else if (s === 2) {
    body = `<div class="card"><h2>Wydatki i majątek</h2>${err}
      ${field({ id: 'ob-living', label: 'Miesięczne koszty życia', suffix: 'zł', value: ob.d.monthlyLivingExpenses, tipText: 'Bez kosztów mieszkania (czynsz najmu i rata liczą się osobno). Jedzenie, transport, rozrywka, ubrania itd.' })}
      ${field({ id: 'ob-rent', label: 'Miesięczny czynsz najmu', suffix: 'zł', value: ob.d.currentRentMonthly, tipText: 'Zakładamy, że czynsz rośnie z inflacją, czyli realnie jest stały. Wpisz 0, jeśli nie wynajmujesz.' })}
      ${field({ id: 'ob-cash', label: 'Gotówka / fundusz na dom', suffix: 'zł', value: ob.d.cashStart, tipText: 'Oszczędności odkładane na wkład własny lub budowę — lokaty, konta oszczędnościowe. Może być 0.' })}
      ${field({ id: 'ob-port', label: 'Portfel inwestycyjny', suffix: 'zł', value: ob.d.portfolioStart, tipText: 'Wartość rachunku maklerskiego / ETF-ów — to on liczy się do FIRE. Może być 0.' })}
      <div class="btn-row"><button data-back>Wstecz</button><button class="primary" data-next>Dalej</button></div>
    </div>`;
  } else if (s === 3) {
    const on = ob.d.houseEnabled;
    body = `<div class="card"><h2>Plan domu</h2>${err}
      <label class="field"><span class="lbl">
        <input type="checkbox" id="ob-house" ${on ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
        Planuję budowę / zakup domu na kredyt</span>
      </label>
      ${on ? `
      ${field({ id: 'ob-mtg-start', label: 'Start kredytu', type: 'month', value: ob.d.mtgStart })}
      ${field({ id: 'ob-mtg-principal', label: 'Kwota kredytu', suffix: 'zł', value: ob.d.mtgPrincipal })}
      ${field({ id: 'ob-mtg-rate', label: 'Oprocentowanie nominalne', suffix: '%', value: ob.d.mtgRate, tipText: 'Nominalne oprocentowanie kredytu z umowy (kredyt to jedyna nominalna rzecz w aplikacji — reszta liczona jest w dzisiejszych złotówkach).' })}
      ${field({ id: 'ob-mtg-term', label: 'Okres kredytu', suffix: 'lata', value: ob.d.mtgTerm, mode: 'numeric' })}
      <div class="banner info" id="ob-annuity">Rata: —</div>
      ${field({ id: 'ob-mtg-override', label: 'Rata ręcznie (opcjonalnie)', suffix: 'zł', value: ob.d.mtgOverride, hint: 'Zostaw puste, aby użyć raty wyliczonej.' })}
      ${field({ id: 'ob-movein', label: 'Miesiąc wprowadzki', type: 'month', value: ob.d.moveIn, tipText: 'Od tego miesiąca przestajesz płacić czynsz najmu.' })}
      ${field({ id: 'ob-hs-month', label: 'Miesiąc wydatku na dom', type: 'month', value: ob.d.hsMonth, hint: 'Domyślnie: start kredytu.', tipText: 'Moment, w którym gotówka (fundusz na dom) zostaje wydana na wkład własny / budowę.' })}
      ${field({ id: 'ob-hs-amount', label: 'Kwota wydatku na dom', suffix: 'zł', value: ob.d.hsAmount, hint: 'Zostaw puste = cała zgromadzona gotówka.' })}
      ${field({ id: 'ob-biz-income', label: 'Dodatkowy dochód (np. z działalności)', suffix: 'zł/mies.', value: ob.d.bizIncome, hint: 'Opcjonalnie. 0 = brak.' })}
      ${field({ id: 'ob-biz-start', label: 'Od kiedy dodatkowy dochód', type: 'month', value: ob.d.bizStart })}
      ` : '<p class="muted">Bez planu domu cel FIRE uwzględnia czynsz najmu płacony bezterminowo.</p>'}
      <div class="btn-row"><button data-back>Wstecz</button><button class="primary" data-next>Dalej</button></div>
    </div>`;
  } else if (s === 4) {
    body = `<div class="card"><h2>Założenia planu</h2>${err}
      <p class="muted small">Domyślne wartości są rozsądne — możesz je później zmienić w zakładce Plan.</p>
      ${field({ id: 'ob-wr', label: 'Stopa wypłat (WR)', suffix: '%', value: ob.d.wr, tipText: 'Ile procent portfela wypłacasz rocznie po FIRE. 4% to klasyka; niższa wartość = większy bufor bezpieczeństwa na złe sekwencje rynkowe.' })}
      ${field({ id: 'ob-return', label: 'Realny zwrot z inwestycji', suffix: '%/rok', value: ob.d.realReturn, tipText: 'Zwrot PONAD inflację. 5% realnie ≈ 8% nominalnie przy inflacji 3%.' })}
      ${field({ id: 'ob-infl', label: 'Inflacja', suffix: '%/rok', value: ob.d.inflation, tipText: 'Używana tylko do przeliczania kredytu (nominalnego) na dzisiejsze złotówki.' })}
      ${field({ id: 'ob-gexp', label: 'Realny wzrost wydatków', suffix: '%/rok', value: ob.d.gExp, tipText: 'Styl życia zwykle drożeje z wiekiem. Cel FIRE rośnie razem z nim (cel ruchomy). 0 = wydatki stałe.' })}
      ${field({ id: 'ob-ginc', label: 'Realny wzrost dochodów', suffix: '%/rok', value: ob.d.gInc, tipText: '3% realnie rocznie to ambitne podwyżki — ustaw 0, jeśli wolisz ostrożnie.' })}
      ${field({ id: 'ob-cashret', label: 'Realny zwrot z gotówki', suffix: '%/rok', value: ob.d.cashReturn, tipText: 'Lokaty zwykle ledwo doganiają inflację, stąd domyślnie 0% realnie.' })}
      <div class="btn-row"><button data-back>Wstecz</button><button class="primary" data-finish>Zaczynamy! 🔥</button></div>
    </div>`;
  }

  view().innerHTML = `<div class="center" style="padding-top:.5rem"><h2 style="margin:0">Konfiguracja</h2></div>${dots}${body}`;

  const grab = () => {
    const ids = {
      'ob-birth': 'birthDate', 'ob-fireage': 'targetFireAge', 'ob-income': 'monthlyIncome',
      'ob-living': 'monthlyLivingExpenses', 'ob-rent': 'currentRentMonthly', 'ob-cash': 'cashStart', 'ob-port': 'portfolioStart',
      'ob-mtg-start': 'mtgStart', 'ob-mtg-principal': 'mtgPrincipal', 'ob-mtg-rate': 'mtgRate', 'ob-mtg-term': 'mtgTerm',
      'ob-mtg-override': 'mtgOverride', 'ob-movein': 'moveIn', 'ob-hs-month': 'hsMonth', 'ob-hs-amount': 'hsAmount',
      'ob-biz-income': 'bizIncome', 'ob-biz-start': 'bizStart',
      'ob-wr': 'wr', 'ob-return': 'realReturn', 'ob-infl': 'inflation', 'ob-gexp': 'gExp', 'ob-ginc': 'gInc', 'ob-cashret': 'cashReturn',
    };
    for (const [id, key] of Object.entries(ids)) {
      const el = $('#' + id);
      if (el) ob.d[key] = el.value;
    }
    const house = $('#ob-house');
    if (house) ob.d.houseEnabled = house.checked;
  };

  const houseCb = $('#ob-house');
  if (houseCb) houseCb.addEventListener('change', () => { grab(); renderOnboarding(); });

  const annuityPreview = () => {
    const out = $('#ob-annuity');
    if (!out) return;
    const P = Fmt.parsePLN($('#ob-mtg-principal').value);
    const r = Fmt.parsePLN($('#ob-mtg-rate').value);
    const T = Fmt.parsePLN($('#ob-mtg-term').value);
    const ov = Fmt.parsePLN($('#ob-mtg-override').value);
    if (ov != null) { out.textContent = `Rata (ręczna): ${Fmt.formatPLN(ov)}/mies.`; return; }
    if (P != null && r != null && T > 0) {
      const A = E.mortgagePayment({ principal: P, rateNominal: r / 100, termYears: T, paymentOverrideMonthly: null });
      out.textContent = `Rata wyliczona: ${Fmt.formatPLN(A)}/mies.`;
    } else out.textContent = 'Rata: — (uzupełnij kwotę, oprocentowanie i okres)';
  };
  if ($('#ob-annuity')) {
    ['ob-mtg-principal', 'ob-mtg-rate', 'ob-mtg-term', 'ob-mtg-override'].forEach(id =>
      $('#' + id).addEventListener('input', annuityPreview));
    annuityPreview();
  }

  const back = $('[data-back]');
  if (back) back.addEventListener('click', () => { grab(); ob.error = ''; ob.step--; renderOnboarding(); });

  const next = $('[data-next]');
  if (next) next.addEventListener('click', () => {
    grab();
    ob.error = validateObStep(s);
    if (!ob.error) ob.step++;
    renderOnboarding();
  });

  const finish = $('[data-finish]');
  if (finish) finish.addEventListener('click', () => {
    grab();
    ob.error = validateObStep(4);
    if (ob.error) { renderOnboarding(); return; }
    finishOnboarding();
  });
}

function validateObStep(s) {
  const d = ob.d;
  const money = v => Fmt.parsePLN(v);
  if (s === 1) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.birthDate)) return 'Podaj datę urodzenia.';
    const age = E.ageAt(d.birthDate, E.todayYm()).years;
    const fa = money(d.targetFireAge);
    if (fa == null || fa <= age || fa > 100) return `Docelowy wiek FIRE musi być większy niż Twój obecny wiek (${age}).`;
    if (money(d.monthlyIncome) == null || money(d.monthlyIncome) < 0) return 'Podaj miesięczny dochód.';
  }
  if (s === 2) {
    for (const [k, l] of [['monthlyLivingExpenses', 'koszty życia'], ['currentRentMonthly', 'czynsz (może być 0)'], ['cashStart', 'gotówkę (może być 0)'], ['portfolioStart', 'portfel (może być 0)']]) {
      const v = money(d[k]);
      if (v == null || v < 0) return `Podaj ${l}.`;
    }
  }
  if (s === 3 && d.houseEnabled) {
    if (!E.isValidYm(d.mtgStart)) return 'Podaj miesiąc startu kredytu.';
    if (E.ymToIdx(d.mtgStart) < E.ymToIdx(E.todayYm())) return 'Start kredytu nie może być w przeszłości (jesteś dziś bez długu).';
    const P = money(d.mtgPrincipal);
    if (P == null || P <= 0) return 'Podaj kwotę kredytu.';
    const r = money(d.mtgRate);
    if (r == null || r < 0 || r > 30) return 'Podaj oprocentowanie (0–30%).';
    const T = money(d.mtgTerm);
    if (T == null || T <= 0 || T > 40) return 'Podaj okres kredytu w latach (1–40).';
    if (!E.isValidYm(d.moveIn)) return 'Podaj miesiąc wprowadzki.';
    if (d.hsMonth && !E.isValidYm(d.hsMonth)) return 'Nieprawidłowy miesiąc wydatku na dom.';
    if (d.bizIncome && money(d.bizIncome) > 0 && !E.isValidYm(d.bizStart)) return 'Podaj, od kiedy dodatkowy dochód.';
  }
  if (s === 4) {
    const wr = money(d.wr);
    if (wr == null || wr <= 0 || wr > 20) return 'Stopa wypłat musi być w zakresie 0–20%.';
    for (const k of ['realReturn', 'inflation', 'gExp', 'gInc', 'cashReturn']) {
      if (money(d[k]) == null) return 'Uzupełnij wszystkie założenia.';
    }
  }
  return '';
}

function finishOnboarding() {
  const d = ob.d;
  const m = v => Fmt.parsePLN(v) ?? 0;
  const houseOn = d.houseEnabled;
  state = E.createState({
    anchorMonth: E.todayYm(),
    profile: { birthDate: d.birthDate },
    assumptions: {
      monthlyIncome: m(d.monthlyIncome),
      monthlyLivingExpenses: m(d.monthlyLivingExpenses),
      cashStart: m(d.cashStart),
      portfolioStart: m(d.portfolioStart),
      cashReturnReal: m(d.cashReturn) / 100,
      targetFireAge: m(d.targetFireAge),
      withdrawalRate: m(d.wr) / 100,
      realReturnAnnual: m(d.realReturn) / 100,
      expenseGrowthReal: m(d.gExp) / 100,
      incomeGrowthReal: m(d.gInc) / 100,
      inflationAnnual: m(d.inflation) / 100,
    },
    housing: {
      currentRentMonthly: m(d.currentRentMonthly),
      housePlan: {
        enabled: houseOn,
        moveInMonth: houseOn ? d.moveIn : null,
        houseSpend: houseOn ? { month: d.hsMonth || d.mtgStart, amount: Fmt.parsePLN(d.hsAmount) } : { month: null, amount: null },
        businessIncomeMonthly: houseOn ? m(d.bizIncome) : 0,
        businessStartMonth: houseOn && d.bizStart ? d.bizStart : null,
        mortgage: houseOn ? {
          startMonth: d.mtgStart,
          principal: m(d.mtgPrincipal),
          rateNominal: m(d.mtgRate) / 100,
          termYears: m(d.mtgTerm),
          paymentOverrideMonthly: Fmt.parsePLN(d.mtgOverride),
        } : { startMonth: null, principal: 0, rateNominal: 0, termYears: 0, paymentOverrideMonthly: null },
      },
    },
  });
  E.recomputeDerived(state);
  persist();
  ob = null;
  applyTheme();
  location.hash = '#/';
  route();
  toast('Gotowe! Wskazówka: ustaw w telefonie przypomnienie „1. dnia miesiąca — FIRE check-in”.', 9000);
}

// ── Pulpit ──────────────────────────────────────────────────────────────

function dashboardMode() {
  const hp = state.housing.housePlan;
  if (hp.enabled) {
    const nowIdx = E.ymToIdx(E.todayYm());
    if (nowIdx < E.ymToIdx(hp.mortgage.startMonth)) return 'housefund';
    if (state.derived.debt.started && state.derived.debt.balanceNominal > 0) return 'debt';
  }
  return 'accumulation';
}

function renderDashboard() {
  const d = state.derived;
  const proj = d.projection;
  const nowYm = E.todayYm();
  const lastOk = E.lastCompleteMonth();
  const canCheckin = E.ymToIdx(lastOk) >= E.ymToIdx(state.anchorMonth) || state.entries.length > 0;
  const due = E.ymToIdx(lastOk) >= E.ymToIdx(state.anchorMonth) && !state.entries.find(e => e.month === lastOk);
  const mode = dashboardMode();
  const hp = state.housing.housePlan;
  let html = '';

  if (due) {
    html += `<div class="banner warn">📝 Czeka Cię check-in za <b>${Fmt.formatMonthName(lastOk)}</b> — domknij miesiąc, zanim ucieknie.</div>`;
  }
  if (deferredPrompt && !state.ui.installTipDismissed) {
    html += `<div class="banner info">📲 Zainstaluj aplikację na ekranie głównym — działa w pełni offline.
      <div class="btn-row"><button id="btn-install" class="primary">Zainstaluj</button><button id="btn-install-no" class="ghost">Ukryj</button></div></div>`;
  }
  if (d.balances.houseUnderfunded) {
    html += `<div class="banner danger">⚠️ Wydatek na dom przekroczył zgromadzone środki — sprawdź kwotę w zakładce Plan.</div>`;
  }

  const planNow = E.plannedSavingsFor(d.plan, nowYm);
  if (planNow < 0) {
    html += `<div class="banner info">🏗️ Miesiąc budowy: plan zakłada niedobór ${Fmt.formatPLN(-planNow)}. Cel = dyscyplina budżetu, nie odkładanie.</div>`;
  }

  // ── Hero wg fazy ──
  if (mode === 'housefund' || mode === 'debt') {
    // Ring „drogi do FIRE" na górze: postęp całej podróży oszczędzania (dom + dług
    // + inwestycje). Każda odłożona złotówka go podnosi, choć portfel jeszcze stoi.
    html += fireJourneyHero(proj);
  }
  if (mode === 'housefund') {
    const hsAmount = hp.houseSpend.amount;
    let goal = hsAmount;
    if (goal == null) {
      const preSpend = proj.series.find(r => r.ym === E.addMonths(hp.houseSpend.month || hp.mortgage.startMonth, -1));
      goal = preSpend ? preSpend.cash : d.balances.cash;
    }
    const pct = goal > 0 ? Math.min(1, d.balances.cash / goal) : 1;
    html += `<div class="card">
      <div class="muted">Fundusz na dom</div>
      <div class="big">${Fmt.formatPLN(d.balances.cash)}</div>
      <div class="muted small">z planowanych ~${Fmt.formatPLN(goal)} do ${Fmt.formatMonthGenitive(hp.houseSpend.month || hp.mortgage.startMonth)}</div>
      <div class="bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="muted small">Start kredytu: ${Fmt.formatMonthName(hp.mortgage.startMonth)}</div>
    </div>`;
  } else if (mode === 'debt') {
    const pct = d.debt.paidPct;
    const dfYm = proj.debtFreeYm;
    html += `<div class="card">
      <div class="muted">Do spłaty (realnie)</div>
      <div class="big">${Fmt.formatPLN(d.debt.balanceReal)}</div>
      <div class="muted small">nominalnie: ${Fmt.formatPLN(d.debt.balanceNominal)}</div>
      <div class="bar flame"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="small">spłacono <b>${(pct * 100).toFixed(1).replace('.', ',')}%</b></div>
      ${dfYm ? `<p>Wolny od długu: <b class="good">${Fmt.formatMonthName(dfYm)}</b><br>
        <span class="muted small">za ${Fmt.formatYearsMonths(Math.max(0, E.monthsBetween(nowYm, dfYm)))}</span></p>` : ''}
      <p class="muted small">Strategia: najpierw dług, potem inwestowanie — każda nadpłata przybliża datę wyżej.</p>
    </div>`;
    const debtRows = proj.series.filter(r => r.debtReal > 0 || !r.projected);
    if (debtRows.length > 1) {
      html += `<div class="card"><h2>Krzywa topnienia długu</h2>
        ${chartSVG(debtRows, [{ get: r => r.debtReal, cls: 'line-debt' }])}
      </div>`;
    }
  } else {
    const targets = E.fireTargetsToday(state, nowYm);
    const pct = d.balances.portfolio / targets.primary;
    const reachedNow = pct >= 1 && (!hp.enabled || (d.debt.started && d.debt.balanceNominal <= 0));
    html += `<div class="card hero">
      ${reachedNow ? '<div class="banner success"><b>🎉 FIRE osiągnięte!</b> Portfel pokrywa Twoje wydatki przy bezpiecznej stopie wypłat.</div>' : ''}
      ${ringSVG(pct)}
      <p style="margin:.5rem 0 0">${Fmt.formatPLN(d.balances.portfolio)} <span class="muted">z</span> <b>${Fmt.formatPLN(targets.primary)}</b> ${tip('Twoja liczba FIRE: roczne wydatki ÷ stopa wypłat. Cel jest ruchomy — rośnie razem z planowanym wzrostem wydatków.')}</p>
      ${proj.reached ? `<p>Prognoza FIRE: <b class="${proj.onTrack ? 'good' : 'warn-text'}">${Fmt.formatMonthName(proj.fireYm)}</b>
        <span class="muted">(wiek ${Fmt.formatAgeYM(proj.fireAge)}, cel: ${state.assumptions.targetFireAge})</span>
        ${proj.byPlanOnly ? '<br><span class="muted small">prognoza wg planu — po 3 wpisach użyję Twoich realnych wyników</span>' : ''}</p>`
        : '<p class="warn-text small">Przy obecnym planie cel FIRE jest poza 60-letnim horyzontem — zajrzyj do założeń.</p>'}
      ${hp.enabled ? `<p class="muted small">Gdybyś wynajmował na zawsze, cel wynosiłby ${Fmt.formatPLN(targets.rentingForever)}.</p>` : ''}
      ${d.streak.current > 0 ? `<p class="streak">🔥 seria: <b>${d.streak.current}</b> ${d.streak.current === 1 ? 'dobry miesiąc' : 'dobre miesiące z rzędu'}</p>` : ''}
    </div>`;
    const rows = proj.series;
    if (rows.length > 1) {
      html += `<div class="card"><h2>Portfel vs cel</h2>
        ${chartSVG(rows, [
        { get: r => r.target, cls: 'line-target' },
        { get: r => r.portfolio, cls: 'line-port', clsProj: 'line-proj', split: true },
      ])}
        <div class="legend"><span><i style="background:var(--accent)"></i>portfel (— historia, ⋯ prognoza)</span><span><i style="background:var(--muted)"></i>cel ruchomy</span></div>
      </div>`;
    }
  }

  // ── Salda zawsze widoczne ──
  html += `<div class="balances">
    <div class="card"><div class="muted small">Gotówka 💵</div><div class="big">${Fmt.formatPLN(d.balances.cash)}</div></div>
    <div class="card"><div class="muted small">Inwestycje 📈</div><div class="big">${Fmt.formatPLN(d.balances.portfolio)}</div></div>
  </div>`;

  html += canCheckin
    ? `<a class="btn primary wide" href="#/checkin">➕ Check-in — ${esc(Fmt.formatMonthName(lastOk))}</a>`
    : `<div class="banner info">Pierwszy pełny miesiąc zamknie się z końcem ${esc(Fmt.formatMonthGenitive(nowYm))} — wróć 1. dnia następnego miesiąca.</div>`;

  view().innerHTML = html;

  const inst = $('#btn-install');
  if (inst) inst.addEventListener('click', async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    route();
  });
  const instNo = $('#btn-install-no');
  if (instNo) instNo.addEventListener('click', () => {
    state.ui.installTipDismissed = true;
    persist();
    route();
  });
}

// Hero „drogi do FIRE" dla faz domu i długu — ring postępu całej podróży
// oszczędzania na górze pulpitu, nad kartą fazy (fundusz / spłata).
function fireJourneyHero(proj) {
  const d = state.derived;
  const targets = E.fireTargetsToday(state, E.todayYm());
  // Postęp „drogi" ma sens tylko, gdy prognoza sięga FIRE — bez tego mianownik
  // się degeneruje (brak przyszłych wpłat → 100% mimo celu poza horyzontem).
  // Wtedy wracamy do klasycznego FI% (portfel ÷ cel).
  if (!proj.reached) {
    return `<div class="card hero">
      ${ringSVG(d.balances.portfolio / targets.primary)}
      <p class="warn-text small" style="margin:.5rem 0 0">Przy obecnym planie cel FIRE jest poza 60-letnim horyzontem — zajrzyj do założeń.</p>
      <p class="muted small">Liczba FIRE dziś: ${Fmt.formatPLN(targets.primary)}.</p>
    </div>`;
  }
  const jp = E.fireJourneyProgress(state, d.plan, proj, d.uptoYm);
  return `<div class="card hero">
    ${ringSVG(jp.pct, 'drogi do FIRE')}
    <p style="margin:.5rem 0 0">Prognoza FIRE: <b class="${proj.onTrack ? 'good' : 'warn-text'}">${Fmt.formatMonthName(proj.fireYm)}</b>
      <span class="muted">(wiek ${Fmt.formatAgeYM(proj.fireAge)})</span></p>
    <p class="muted small">Każda złotówka odłożona na dom, dług i inwestycje przybliża Cię do celu (liczba FIRE dziś: ${Fmt.formatPLN(targets.primary)}). ${tip('Postęp całej drogi oszczędzania: suma tego, co już odłożone, do sumy potrzebnej do FIRE (dom + dług + inwestycje), ważona wzrostem inwestycji. W realnych zł, więc inflacja uwzględniona. Pasek tylko rośnie.')}</p>
  </div>`;
}

// ── Check-in ────────────────────────────────────────────────────────────

function checkinMonths() {
  const lastOk = E.lastCompleteMonth();
  const set = new Set(state.entries.map(e => e.month));
  const months = [];
  for (let i = E.ymToIdx(lastOk); i >= E.ymToIdx(state.anchorMonth); i--) months.push(E.idxToYm(i));
  for (const m of set) if (!months.includes(m)) months.push(m);
  return months.sort((a, b) => (a < b ? 1 : -1));
}

function renderCheckin(month) {
  const months = checkinMonths();
  if (!months.length) {
    view().innerHTML = `<div class="card"><h2>Check-in</h2>
      <p>Nie ma jeszcze żadnego zakończonego miesiąca do wpisania. Wróć 1. dnia następnego miesiąca — to Twój rytuał. 🔥</p>
      <a class="btn wide" href="#/">Wróć na pulpit</a></div>`;
    return;
  }
  const m = month && months.includes(month) ? month : months[0];
  const mi = months.indexOf(m); // months malejąco: ‹ (starszy) = mi+1, › (nowszy) = mi−1
  const existing = state.entries.find(e => e.month === m);
  const debt = E.replayDebt(state, m);
  const dm = debt.byMonth.get(E.ymToIdx(m));
  const debtActive = !!(dm && dm.balStart > E.EPS);
  const planned = E.plannedSavingsFor(state.derived.plan, m);

  view().innerHTML = `<div class="card">
    <h2>${existing ? 'Edycja wpisu' : 'Check-in'} — ${esc(Fmt.formatMonthName(m))}</h2>
    <div class="field"><span class="lbl">Miesiąc</span>
      <div class="month-nav">
        <button type="button" id="ci-prev" aria-label="Starszy miesiąc" ${mi + 1 < months.length ? '' : 'disabled'}>‹</button>
        <select id="ci-month">${months.map(x => `<option value="${x}" ${x === m ? 'selected' : ''}>${esc(Fmt.formatMonthName(x))}${state.entries.find(e => e.month === x) ? ' ✓' : ''}</option>`).join('')}</select>
        <button type="button" id="ci-next" aria-label="Nowszy miesiąc" ${mi > 0 ? '' : 'disabled'}>›</button>
      </div>
    </div>
    <div class="banner info small">Plan na ten miesiąc: <b>${Fmt.formatPLN(planned)}</b>${planned < 0 ? ' (miesiąc budowy — plan zakłada niedobór)' : ''}</div>
    <div id="ci-error"></div>
    ${field({ id: 'ci-earned', label: 'Zarobione', suffix: 'zł', value: existing ? moneyVal(existing.earned) : '', tipText: 'Wszystkie dochody netto w tym miesiącu.' })}
    ${field({ id: 'ci-spent', label: 'Wydane', suffix: 'zł', value: existing ? moneyVal(existing.spent) : '', hint: 'Razem z czynszem i ratą kredytu.' })}
    ${debtActive ? field({ id: 'ci-overpay', label: 'Nadpłata kredytu', suffix: 'zł', value: existing ? moneyVal(existing.overpayment) : '0', hint: 'Nadpłata liczy się jako oszczędzanie — zmniejsza dług.', tipText: 'Kwota wpłacona na kredyt PONAD ratę. Nie wliczaj jej do „Wydane”.' }) : ''}
    <details class="section"><summary>Popraw salda (opcjonalnie)</summary>
      <p class="muted small">Jeśli rzeczywiste saldo na koniec miesiąca różni się od wyliczonego — wpisz je tutaj. Puste = bez korekty.</p>
      ${field({ id: 'ci-cash-ov', label: 'Rzeczywista gotówka', suffix: 'zł', value: existing && existing.cashOverride != null ? moneyVal(existing.cashOverride) : '' })}
      ${field({ id: 'ci-port-ov', label: 'Rzeczywisty portfel (rachunek maklerski)', suffix: 'zł', value: existing && existing.balanceOverride != null ? moneyVal(existing.balanceOverride) : '' })}
    </details>
    <div class="btn-row">
      ${existing ? '<button id="ci-delete" class="danger">Usuń wpis</button>' : ''}
      <button id="ci-save" class="primary">${existing ? 'Zapisz zmiany' : 'Zapisz miesiąc'}</button>
    </div>
  </div>`;

  $('#ci-month').addEventListener('change', ev => {
    location.hash = '#/checkin/' + ev.target.value;
  });
  $('#ci-prev').addEventListener('click', () => {
    if (mi + 1 < months.length) location.hash = '#/checkin/' + months[mi + 1];
  });
  $('#ci-next').addEventListener('click', () => {
    if (mi > 0) location.hash = '#/checkin/' + months[mi - 1];
  });

  const del = $('#ci-delete');
  if (del) del.addEventListener('click', () => {
    if (confirm(`Usunąć wpis za ${Fmt.formatMonthName(m)}? Salda i prognoza zostaną przeliczone.`)) {
      E.deleteEntry(state, m);
      persist();
      toast('Wpis usunięty.');
      location.hash = '#/history';
    }
  });

  $('#ci-save').addEventListener('click', () => {
    const errBox = $('#ci-error');
    errBox.innerHTML = '';
    const earned = parseMoney('ci-earned');
    const spent = parseMoney('ci-spent');
    const over = debtActive ? parseMoney('ci-overpay', { required: false }) : { value: 0 };
    const cashOv = parseMoney('ci-cash-ov', { required: false });
    const portOv = parseMoney('ci-port-ov', { required: false });
    const bad = [earned, spent, over, cashOv, portOv].find(x => x.error);
    if (bad) { errBox.innerHTML = `<div class="field-error">${esc(bad.error)}</div>`; return; }
    const prevFireYm = state.derived.projection.reached ? state.derived.projection.fireYm : null;
    const wasFirst = state.entries.length === 0;
    const prevEntry = [...state.entries].filter(e => e.month < m).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    let entry;
    try {
      entry = E.applyCheckIn(state, {
        month: m, earned: earned.value, spent: spent.value,
        overpayment: over.value || 0,
        cashOverride: cashOv.value, balanceOverride: portOv.value,
      });
    } catch (err) {
      errBox.innerHTML = `<div class="field-error">${esc(err.message)}</div>`;
      return;
    }
    persist();
    renderCheckinResult(entry, { prevFireYm, wasFirst, prevEntry });
  });
}

function renderCheckinResult(entry, { prevFireYm, wasFirst, prevEntry }) {
  const d = state.derived;
  const proj = d.projection;
  const net = Math.round((entry.earned - entry.spent) * 100) / 100;
  const delta = net - entry.plannedSavingsSnapshot;
  const nextMonth = E.addMonths(entry.month, 1);
  const nextPlan = E.plannedSavingsFor(d.plan, nextMonth);
  const isComeback = !!(prevEntry && !E.isGoodVerdict(prevEntry.verdict) && E.isGoodVerdict(entry.verdict));
  const coach = coachMessage({
    verdict: entry.verdict, onTrack: proj.onTrack, streak: d.streak.current,
    month: entry.month, nextMonth, nextPlan, isFirst: wasFirst, isComeback,
  });

  let shift = '';
  if (proj.reached && prevFireYm) {
    const diff = E.monthsBetween(proj.fireYm, prevFireYm); // dodatnie = wcześniej
    if (diff > 0) shift = `<span class="good">▲ ${diff} mies. wcześniej</span>`;
    else if (diff < 0) shift = `<span class="bad">▼ ${-diff} mies. później</span>`;
    else shift = '<span class="muted">bez zmian</span>';
  }

  const reminderTip = !state.ui.reminderTipShown
    ? '<div class="banner info">⏰ Ustaw w telefonie cykliczne przypomnienie: <b>„1. dnia miesiąca — FIRE check-in”</b>. Aplikacja nie może sama wysyłać powiadomień, gdy jest zamknięta.</div>'
    : '';
  if (!state.ui.reminderTipShown) { state.ui.reminderTipShown = true; persist(); }

  view().innerHTML = `<div class="card center">
    <div class="badge v-${entry.verdict}">${verdictEmoji(entry.verdict)} ${esc(verdictLabel(entry.verdict))}</div>
    <div class="big" style="margin-top:.5rem">${Fmt.formatPLN(net)}</div>
    <div class="muted">plan: ${Fmt.formatPLN(entry.plannedSavingsSnapshot)} · ${delta >= 0 ? '+' : ''}${Fmt.formatPLN(delta)}</div>
  </div>
  <div class="card">
    <h2>Po aktualizacji</h2>
    <div class="kv"><span>Gotówka</span><b>${Fmt.formatPLN(d.balances.cash)}</b></div>
    <div class="kv"><span>Portfel inwestycyjny</span><b>${Fmt.formatPLN(d.balances.portfolio)}</b></div>
    ${d.debt.balanceNominal > 0 ? `<div class="kv"><span>Dług (realnie)</span><b>${Fmt.formatPLN(d.debt.balanceReal)}</b></div>` : ''}
    ${proj.reached ? `<div class="kv"><span>Prognoza FIRE</span><b>${Fmt.formatMonthName(proj.fireYm)} ${shift}</b></div>` : ''}
    ${d.streak.current > 0 ? `<div class="kv"><span>Seria</span><b>🔥 ${d.streak.current}</b></div>` : ''}
  </div>
  ${reminderTip}
  <div class="coach">💬 ${esc(coach)}</div>
  <a class="btn primary wide" href="#/">Wróć na pulpit</a>`;
  window.scrollTo(0, 0);
}

// ── Historia ────────────────────────────────────────────────────────────

let histExpanded = null;

function renderHistory() {
  const lastOk = E.lastCompleteMonth();
  const startIdx = E.ymToIdx(state.anchorMonth);
  const endIdx = E.ymToIdx(lastOk);
  const byMonth = new Map(state.entries.map(e => [e.month, e]));
  const rows = [];
  const allMonths = new Set(state.entries.map(e => e.month));
  for (let i = endIdx; i >= startIdx; i--) allMonths.add(E.idxToYm(i));
  const months = [...allMonths].sort((a, b) => (a < b ? 1 : -1));

  for (const ym of months) {
    const e = byMonth.get(ym);
    if (!e) {
      rows.push(`<div class="hist-row gap" data-m="${ym}" data-gap>
        <div class="m">${esc(Fmt.formatMonthName(ym))}<span class="muted small">brak wpisu — dotknij, aby uzupełnić</span></div>
      </div>`);
      continue;
    }
    const net = Math.round((e.earned - e.spent) * 100) / 100;
    const delta = net - e.plannedSavingsSnapshot;
    rows.push(`<div class="hist-row" data-m="${ym}">
      <div class="m"><b>${esc(Fmt.formatMonthName(ym))}</b>
        <span class="muted small">odłożone ${Fmt.formatPLN(net)} · ${delta >= 0 ? '+' : ''}${Fmt.formatPLN(delta)} vs plan</span></div>
      <span class="badge v-${e.verdict}">${verdictEmoji(e.verdict)}</span>
    </div>
    ${histExpanded === ym ? `<div class="hist-actions">
      <button data-edit="${ym}">✏️ Edytuj</button>
      <button class="danger" data-del="${ym}">🗑️ Usuń</button>
    </div>` : ''}`);
  }

  view().innerHTML = `<div class="card">
    <h2>Historia check-inów</h2>
    ${rows.length ? rows.join('') : '<p class="muted">Jeszcze pusto — pierwszy check-in przed Tobą.</p>'}
    ${state.derived.streak.best > 0 ? `<p class="muted small" style="margin-top:.75rem">Najdłuższa seria: 🔥 ${state.derived.streak.best}</p>` : ''}
  </div>`;

  $$('.hist-row[data-gap]').forEach(el => el.addEventListener('click', () => {
    location.hash = '#/checkin/' + el.dataset.m;
  }));
  $$('.hist-row:not([data-gap])').forEach(el => el.addEventListener('click', () => {
    histExpanded = histExpanded === el.dataset.m ? null : el.dataset.m;
    renderHistory();
  }));
  $$('[data-edit]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    location.hash = '#/checkin/' + el.dataset.edit;
  }));
  $$('[data-del]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const ym = el.dataset.del;
    if (confirm(`Usunąć wpis za ${Fmt.formatMonthName(ym)}? Salda i prognoza zostaną przeliczone.`)) {
      E.deleteEntry(state, ym);
      persist();
      histExpanded = null;
      renderHistory();
      toast('Wpis usunięty, wszystko przeliczone.');
    }
  }));
}

// ── Analiza ─────────────────────────────────────────────────────────────
// Wyniki liczone przy renderze (nie w recomputeDerived — potrzebne tylko tu).

let anMode = 'yearly';
let anYear = 1;
let simMonth = '';       // wejścia symulacji przeżywają pełne re-rendery ekranu
let simAmount = '';
let simRecurring = false;

// Wynik karty Symulacja: czysta symulacja na projectionWith — nic nie zapisujemy.
function simResultHTML(baseFireYm) {
  const month = simMonth || E.todayYm();
  if (!E.isValidYm(month) || E.ymToIdx(month) < E.ymToIdx(E.todayYm())) {
    return '<p class="muted small">Wybierz bieżący lub przyszły miesiąc.</p>';
  }
  const raw = simAmount.trim();
  if (raw === '') return '<p class="muted small">Podaj kwotę, aby zobaczyć wpływ na datę FIRE.</p>';
  const amount = Fmt.parsePLN(raw);
  if (amount == null) return '<div class="field-error">Nieprawidłowa kwota</div>';
  const sim = E.projectionWith(state, { extraSavings: { month, amount, recurring: simRecurring } });
  return An.simulationResult({ baseFireYm, sim, month });
}

function renderAnaliza() {
  if (!state.derived) E.recomputeDerived(state);
  const d = state.derived;
  const a = state.assumptions;
  const nowYm = E.todayYm();
  const proj = d.projection;
  const houseOn = !!(state.housing.housePlan && state.housing.housePlan.enabled);

  const fi = E.fiStats(state, d.balances, d.debt, d.plan, nowYm);
  const cvg = E.contributionsVsGrowth(state, d.balances);
  const sav = E.savingsStats(state, d.uptoYm);
  const pva = E.planVsActualStats(state.entries);
  const blocks = E.yearlyProjection(state, proj);
  if (anYear > blocks.length) anYear = 1;
  const excelContrib = E.plannedSavingsFor(d.plan, nowYm) * 12;
  const excelRows = E.excelProjection(state, { start: d.balances.portfolio, contribYearly: excelContrib });
  const w = E.projectWithdrawal(state, { projection: proj });

  // Wrażliwość: pełny przebieg prognozy na wariant (≤ 13 × 720 iteracji).
  const baseFireYm = proj.reached ? proj.fireYm : null;
  const vFire = p => (p.reached ? p.fireYm : null);
  const returnRows = [-0.02, -0.01, 0, 0.01, 0.02].map(dp => ({
    label: `${Fmt.formatPct(a.realReturnAnnual + dp)}${dp === 0 ? '' : ` (${dp > 0 ? '+' : '−'}${Math.round(Math.abs(dp) * 100)} pp)`}`,
    fireYm: dp === 0 ? baseFireYm : vFire(E.projectionWith(state, { assumptions: { realReturnAnnual: a.realReturnAnnual + dp } })),
    isBase: dp === 0,
  }));
  const savingsRows = [-1000, -500, 0, 500, 1000].map(x => ({
    label: x === 0 ? 'wg planu' : `${x > 0 ? '+' : '−'}${Fmt.formatPLN(Math.abs(x))}/mies.`,
    fireYm: x === 0 ? baseFireYm : vFire(E.projectionWith(state, { extraMonthlySavings: x })),
    isBase: x === 0,
  }));
  const swrRows = E.swrComparison(state, nowYm).map(r => ({
    ...r,
    fireYm: r.isUser ? baseFireYm : vFire(E.projectionWith(state, { assumptions: { withdrawalRate: r.swr } })),
  }));

  // Wykresy (chartSVG skaluje od 0 — skumulowany wykres tylko przy seriach ≥ 0).
  const cumChart = pva.cumRows.length > 1 && pva.cumRows.every(r => r.cumNet >= 0 && r.cumPlanned >= 0)
    ? chartSVG(pva.cumRows, [
      { get: r => r.cumPlanned, cls: 'line-target' },
      { get: r => r.cumNet, cls: 'line-port' },
    ])
    : '';
  const wChart = w.rows.length > 1
    ? chartSVG(w.rows, [
      { get: r => r.endNominal, cls: 'line-proj' },
      { get: r => r.endReal, cls: 'line-port' },
    ])
    : '';

  const ma = houseOn && d.debt.started ? E.mortgageAnalytics(state, d.debt, proj) : null;
  let debtChart = '';
  if (ma && d.debt.rows.length > 1) {
    const histBy = new Map(d.debt.rows.map(r => [r.ym, r.balNominal]));
    const schedBy = new Map(ma.scheduleRows.map((r, i) => [E.addMonths(ma.lastYm, i + 1), r.balNominal]));
    const projBy = new Map(proj.series.filter(r => r.projected)
      .map(r => [r.ym, E.toNominal(r.debtReal, state.anchorMonth, r.ym, a.inflationAnnual)]));
    const start = E.ymToIdx(d.debt.rows[0].ym);
    const end = E.ymToIdx(ma.lastYm) + ma.scheduleRows.length;
    const rows = [];
    for (let i = start; i <= end; i++) {
      const ym = E.idxToYm(i);
      const hist = histBy.get(ym);
      rows.push({
        ym,
        over: hist != null ? hist : (projBy.get(ym) || 0),
        sched: hist != null ? hist : (schedBy.get(ym) || 0),
      });
    }
    debtChart = rows.length > 1
      ? chartSVG(rows, [
        { get: r => r.sched, cls: 'line-debt-dash' },
        { get: r => r.over, cls: 'line-debt' },
      ])
      : '';
  }

  view().innerHTML = [
    An.statsCard({ fi, cvg, balances: d.balances, a, nowYm }),
    An.planPerfCard({ sav, pva, chartHTML: cumChart }),
    An.projectionCard({
      mode: anMode, blocks, series: proj.series, excelRows, houseOn,
      selectedYear: anYear, fireYm: proj.reached ? proj.fireYm : null,
      excelStart: d.balances.portfolio, excelContrib,
      byPlanOnly: proj.byPlanOnly, delta: proj.delta,
    }),
    An.withdrawalCard({ w, chartHTML: wChart }),
    An.sensitivityCard({ baseFireYm, returnRows, savingsRows, swrRows }),
    An.simulationCard({
      nowYm, month: simMonth || nowYm, amount: simAmount, recurring: simRecurring,
      resultHTML: simResultHTML(baseFireYm),
    }),
    ma ? An.mortgageCard({ ma, chartHTML: debtChart }) : '',
  ].join('');

  $$('[data-anmode]').forEach(el => el.addEventListener('click', () => {
    anMode = el.dataset.anmode;
    renderAnaliza();
  }));
  const yearSel = $('#an-year');
  if (yearSel) yearSel.addEventListener('change', () => {
    anYear = Number(yearSel.value) || 1;
    renderAnaliza();
  });

  // Symulacja: podmieniamy tylko #sim-result (pełny re-render gubiłby fokus
  // pola kwoty w trakcie pisania; projectionWith to jeden przebieg ≤720 iteracji).
  const refreshSim = () => { $('#sim-result').innerHTML = simResultHTML(baseFireYm); };
  const simM = $('#sim-month');
  simM.addEventListener('change', () => { simMonth = simM.value; refreshSim(); });
  const simA = $('#sim-amount');
  simA.addEventListener('input', () => { simAmount = simA.value; refreshSim(); });
  $$('[data-simmode]').forEach(el => el.addEventListener('click', () => {
    simRecurring = el.dataset.simmode === 'from';
    $$('[data-simmode]').forEach(b => b.classList.toggle('on', b === el));
    refreshSim();
  }));
}

// ── Plan i założenia ────────────────────────────────────────────────────

function renderPlan() {
  const a = state.assumptions;
  const h = state.housing;
  const hp = h.housePlan;
  const lastOk = E.lastCompleteMonth();
  const hasEntryLastOk = !!state.entries.find(e => e.month === lastOk);

  view().innerHTML = `
  <div id="plan-error"></div>
  <div class="card"><h2>Profil</h2>
    ${field({ id: 'pl-birth', label: 'Data urodzenia', type: 'date', value: state.profile.birthDate })}
    ${field({ id: 'pl-fireage', label: 'Docelowy wiek FIRE', value: moneyVal(a.targetFireAge), mode: 'numeric' })}
  </div>
  <div class="card"><h2>Założenia</h2>
    ${field({ id: 'pl-wr', label: 'Stopa wypłat (WR)', suffix: '%', value: pctVal(a.withdrawalRate), tipText: 'Wskaźnik bezpieczeństwa: ile procent portfela wypłacasz rocznie po FIRE. Niżej = bezpieczniej wobec ryzyka sekwencji złych lat na rynku.' })}
    ${field({ id: 'pl-return', label: 'Realny zwrot z inwestycji', suffix: '%/rok', value: pctVal(a.realReturnAnnual), tipText: 'Zwrot ponad inflację. Wszystko w aplikacji liczone jest w dzisiejszych złotówkach.' })}
    ${field({ id: 'pl-infl', label: 'Inflacja', suffix: '%/rok', value: pctVal(a.inflationAnnual), tipText: 'Służy wyłącznie do przeliczania kredytu (nominalnego kontraktu) na dzisiejsze złotówki.' })}
    ${field({ id: 'pl-gexp', label: 'Realny wzrost wydatków', suffix: '%/rok', value: pctVal(a.expenseGrowthReal), tipText: 'Cel ruchomy: liczba FIRE rośnie razem z planowanym wzrostem stylu życia.' })}
    ${field({ id: 'pl-ginc', label: 'Realny wzrost dochodów', suffix: '%/rok', value: pctVal(a.incomeGrowthReal), tipText: '3% realnie rocznie to ambitne podwyżki. Ustaw 0 dla ostrożnej prognozy.' })}
    ${field({ id: 'pl-cashret', label: 'Realny zwrot z gotówki', suffix: '%/rok', value: pctVal(a.cashReturnReal), tipText: 'Lokaty ≈ inflacja, stąd domyślnie 0% realnie.' })}
  </div>
  <div class="card"><h2>Finanse</h2>
    ${field({ id: 'pl-income', label: 'Miesięczny dochód netto', suffix: 'zł', value: moneyVal(a.monthlyIncome) })}
    ${field({ id: 'pl-living', label: 'Miesięczne koszty życia', suffix: 'zł', value: moneyVal(a.monthlyLivingExpenses), tipText: 'Bez kosztów mieszkania — czynsz i rata liczone osobno.' })}
  </div>
  <div class="card"><h2>Start planu</h2>
    ${field({ id: 'pl-anchor', label: 'Miesiąc startu planu', type: 'month', value: state.anchorMonth, max: E.todayYm(), tipText: 'Od tego miesiąca liczą się check-iny, salda startowe i krzywe wzrostu. Cofnij go, aby uzupełnić wcześniejsze miesiące.' })}
    ${field({ id: 'pl-cash-start', label: 'Gotówka na starcie', suffix: 'zł', value: moneyVal(a.cashStart) })}
    ${field({ id: 'pl-port-start', label: 'Portfel na starcie', suffix: 'zł', value: moneyVal(a.portfolioStart) })}
    <p class="muted small">Salda startowe to stan z początku miesiąca startu. Po cofnięciu startu ustaw je na stan z nowego miesiąca — inaczej uzupełniane wpisy policzą się podwójnie.</p>
  </div>
  <div class="card"><h2>Mieszkanie i dom</h2>
    ${field({ id: 'pl-rent', label: 'Miesięczny czynsz najmu', suffix: 'zł', value: moneyVal(h.currentRentMonthly), tipText: 'Czynsz rośnie z inflacją = realnie stały. Znika w miesiącu wprowadzki.' })}
    <label class="field"><span class="lbl">
      <input type="checkbox" id="pl-house" ${hp.enabled ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
      Plan domu z kredytem</span>
    </label>
    <div id="pl-house-fields" ${hp.enabled ? '' : 'hidden'}>
      ${field({ id: 'pl-movein', label: 'Miesiąc wprowadzki', type: 'month', value: hp.moveInMonth || '' })}
      ${field({ id: 'pl-hs-month', label: 'Miesiąc wydatku na dom', type: 'month', value: (hp.houseSpend && hp.houseSpend.month) || '' })}
      ${field({ id: 'pl-hs-amount', label: 'Kwota wydatku na dom', suffix: 'zł', value: hp.houseSpend ? moneyVal(hp.houseSpend.amount) : '', hint: 'Puste = cała zgromadzona gotówka.' })}
      ${field({ id: 'pl-biz-income', label: 'Dodatkowy dochód', suffix: 'zł/mies.', value: moneyVal(hp.businessIncomeMonthly) })}
      ${field({ id: 'pl-biz-start', label: 'Od kiedy dodatkowy dochód', type: 'month', value: hp.businessStartMonth || '' })}
      <h3>Kredyt</h3>
      ${field({ id: 'pl-mtg-start', label: 'Start kredytu', type: 'month', value: hp.mortgage.startMonth || '' })}
      ${field({ id: 'pl-mtg-principal', label: 'Kwota kredytu', suffix: 'zł', value: moneyVal(hp.mortgage.principal) })}
      ${field({ id: 'pl-mtg-rate', label: 'Oprocentowanie nominalne', suffix: '%', value: pctVal(hp.mortgage.rateNominal) })}
      ${field({ id: 'pl-mtg-term', label: 'Okres', suffix: 'lata', value: moneyVal(hp.mortgage.termYears), mode: 'numeric' })}
      <div class="banner info" id="pl-annuity">Rata: —</div>
      ${field({ id: 'pl-mtg-override', label: 'Rata ręcznie (opcjonalnie)', suffix: 'zł', value: moneyVal(hp.mortgage.paymentOverrideMonthly) })}
    </div>
  </div>
  <div class="card"><h2>Aplikacja</h2>
    <label class="field"><span class="lbl">Motyw</span>
      <select id="pl-theme">
        <option value="auto" ${state.ui.theme === 'auto' ? 'selected' : ''}>systemowy</option>
        <option value="light" ${state.ui.theme === 'light' ? 'selected' : ''}>jasny</option>
        <option value="dark" ${state.ui.theme === 'dark' ? 'selected' : ''}>ciemny</option>
      </select>
    </label>
  </div>
  <button id="pl-save" class="primary wide">Zapisz plan</button>
  <p class="muted small center">Zmiana dochodu, wydatków lub czynszu przesuwa start krzywych wzrostu na bieżący miesiąc. Historia pozostaje bez zmian.</p>

  <details class="section"><summary>Skoryguj salda</summary>
    <p class="muted small">Korekta „przypina się” do ostatniego pełnego miesiąca (${esc(Fmt.formatMonthName(lastOk))}). Puste pole = bez korekty.</p>
    ${hasEntryLastOk
      ? `${field({ id: 'cor-cash', label: 'Rzeczywista gotówka', suffix: 'zł' })}
         ${field({ id: 'cor-port', label: 'Rzeczywisty portfel', suffix: 'zł' })}`
      : `<p class="banner warn small">Korekta gotówki i portfela wymaga wpisu za ${esc(Fmt.formatMonthName(lastOk))} — zrób najpierw check-in (sekcja „Popraw salda”).</p>`}
    ${state.derived.debt.started && state.derived.debt.balanceNominal > 0
      ? field({ id: 'cor-debt', label: 'Rzeczywiste saldo kredytu (nominalne)', suffix: 'zł' })
      : ''}
    <button id="cor-save" class="wide">Zapisz korekty</button>
  </details>`;

  const houseCb = $('#pl-house');
  houseCb.addEventListener('change', () => {
    $('#pl-house-fields').hidden = !houseCb.checked;
  });

  const annuity = () => {
    const P = Fmt.parsePLN($('#pl-mtg-principal').value);
    const r = Fmt.parsePLN($('#pl-mtg-rate').value);
    const T = Fmt.parsePLN($('#pl-mtg-term').value);
    const ov = Fmt.parsePLN($('#pl-mtg-override').value);
    const out = $('#pl-annuity');
    if (ov != null) { out.textContent = `Rata (ręczna): ${Fmt.formatPLN(ov)}/mies.`; return; }
    if (P != null && r != null && T > 0) {
      out.textContent = `Rata wyliczona: ${Fmt.formatPLN(E.mortgagePayment({ principal: P, rateNominal: r / 100, termYears: T, paymentOverrideMonthly: null }))}/mies.`;
    } else out.textContent = 'Rata: —';
  };
  ['pl-mtg-principal', 'pl-mtg-rate', 'pl-mtg-term', 'pl-mtg-override'].forEach(id =>
    $('#' + id).addEventListener('input', annuity));
  annuity();

  $('#pl-save').addEventListener('click', () => {
    const errBox = $('#plan-error');
    errBox.innerHTML = '';
    const fail = msg => { errBox.innerHTML = `<div class="field-error">${esc(msg)}</div>`; window.scrollTo(0, 0); };

    const birth = $('#pl-birth').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return fail('Podaj datę urodzenia.');
    const vals = {};
    const specs = [
      ['pl-fireage', 'fireage', () => parseMoney('pl-fireage')],
      ['pl-wr', 'wr', () => parsePct('pl-wr', { min: 0.001, max: 0.2 })],
      ['pl-return', 'ret', () => parsePct('pl-return')],
      ['pl-infl', 'infl', () => parsePct('pl-infl')],
      ['pl-gexp', 'gexp', () => parsePct('pl-gexp')],
      ['pl-ginc', 'ginc', () => parsePct('pl-ginc')],
      ['pl-cashret', 'cashret', () => parsePct('pl-cashret')],
      ['pl-income', 'income', () => parseMoney('pl-income')],
      ['pl-living', 'living', () => parseMoney('pl-living')],
      ['pl-rent', 'rent', () => parseMoney('pl-rent')],
      ['pl-cash-start', 'cashStart', () => parseMoney('pl-cash-start')],
      ['pl-port-start', 'portStart', () => parseMoney('pl-port-start')],
    ];
    for (const [, key, get] of specs) {
      const r = get();
      if (r.error) return fail(`Popraw pola formularza: ${r.error}`);
      vals[key] = r.value;
    }
    const age = E.ageAt(birth, E.todayYm()).years;
    if (vals.fireage <= age) return fail(`Docelowy wiek FIRE musi być większy niż obecny wiek (${age}).`);

    const houseOn = houseCb.checked;
    let house = null;
    if (houseOn) {
      const start = $('#pl-mtg-start').value;
      const moveIn = $('#pl-movein').value;
      if (!E.isValidYm(start)) return fail('Podaj miesiąc startu kredytu.');
      if (!E.isValidYm(moveIn)) return fail('Podaj miesiąc wprowadzki.');
      const P = parseMoney('pl-mtg-principal'); if (P.error || P.value <= 0) return fail('Podaj kwotę kredytu.');
      const r = parsePct('pl-mtg-rate', { min: 0, max: 0.3 }); if (r.error) return fail('Popraw oprocentowanie.');
      const T = parseMoney('pl-mtg-term'); if (T.error || T.value <= 0 || T.value > 40) return fail('Okres kredytu: 1–40 lat.');
      const ov = parseMoney('pl-mtg-override', { required: false }); if (ov.error) return fail('Popraw ratę ręczną.');
      const hsM = $('#pl-hs-month').value;
      if (hsM && !E.isValidYm(hsM)) return fail('Nieprawidłowy miesiąc wydatku na dom.');
      const hsA = parseMoney('pl-hs-amount', { required: false }); if (hsA.error) return fail('Popraw kwotę wydatku na dom.');
      const bizI = parseMoney('pl-biz-income', { required: false }); if (bizI.error) return fail('Popraw dodatkowy dochód.');
      const bizS = $('#pl-biz-start').value;
      if ((bizI.value || 0) > 0 && !E.isValidYm(bizS)) return fail('Podaj, od kiedy dodatkowy dochód.');
      house = {
        enabled: true,
        moveInMonth: moveIn,
        houseSpend: { month: hsM || start, amount: hsA.value },
        businessIncomeMonthly: bizI.value || 0,
        businessStartMonth: bizS && E.isValidYm(bizS) ? bizS : null,
        mortgage: { startMonth: start, principal: P.value, rateNominal: r.value, termYears: T.value, paymentOverrideMonthly: ov.value },
      };
    }

    const anchorNew = $('#pl-anchor').value;
    if (!E.isValidYm(anchorNew)) return fail('Podaj miesiąc startu planu.');
    if (E.ymToIdx(anchorNew) > E.ymToIdx(E.todayYm())) return fail('Start planu nie może być w przyszłości.');
    const anchorChanged = anchorNew !== state.anchorMonth;
    const anchorBackward = anchorChanged && E.ymToIdx(anchorNew) < E.ymToIdx(state.anchorMonth);

    const reanchorNeeded = vals.income !== a.monthlyIncome
      || vals.living !== a.monthlyLivingExpenses
      || vals.rent !== h.currentRentMonthly;

    state.profile.birthDate = birth;
    Object.assign(state.assumptions, {
      targetFireAge: vals.fireage, withdrawalRate: vals.wr, realReturnAnnual: vals.ret,
      inflationAnnual: vals.infl, expenseGrowthReal: vals.gexp, incomeGrowthReal: vals.ginc,
      cashReturnReal: vals.cashret, monthlyIncome: vals.income, monthlyLivingExpenses: vals.living,
      cashStart: vals.cashStart, portfolioStart: vals.portStart,
    });
    state.housing.currentRentMonthly = vals.rent;
    if (houseOn) state.housing.housePlan = house;
    else state.housing.housePlan.enabled = false;
    state.ui.theme = $('#pl-theme').value;
    applyTheme();

    try {
      if (anchorChanged) {
        // Jawna zmiana startu wygrywa z automatycznym re-kotwiczeniem:
        // wstecz — otwiera wcześniejsze miesiące (salda startowe wg pól powyżej),
        // w przód — salda przenoszone przez reanchor jak dotychczas.
        E.reanchor(state, anchorNew);
        toast(anchorBackward
          ? `Zapisano. Plan startuje od: ${Fmt.formatMonthName(anchorNew)} — wcześniejsze miesiące uzupełnisz w check-inie.`
          : `Zapisano. Start planu przesunięty na ${Fmt.formatMonthName(anchorNew)} — salda startowe przeliczone.`);
      } else if (reanchorNeeded && state.anchorMonth !== E.todayYm()) {
        E.reanchor(state, E.todayYm());
        toast('Zapisano. Krzywe wzrostu wystartowały od nowa od bieżącego miesiąca — historia bez zmian.');
      } else {
        E.recomputeDerived(state);
        toast('Plan zapisany, wszystko przeliczone.');
      }
    } catch (err) {
      return fail('Błąd przeliczania: ' + err.message);
    }
    persist();
    location.hash = '#/';
  });

  const corSave = $('#cor-save');
  if (corSave) corSave.addEventListener('click', () => {
    const errBox = $('#plan-error');
    errBox.innerHTML = '';
    let changed = false;
    if ($('#cor-cash') || $('#cor-port')) {
      const cash = $('#cor-cash') ? parseMoney('cor-cash', { required: false }) : { value: null };
      const port = $('#cor-port') ? parseMoney('cor-port', { required: false }) : { value: null };
      if (cash.error || port.error) { errBox.innerHTML = '<div class="field-error">Popraw kwoty korekt.</div>'; return; }
      if (cash.value != null || port.value != null) {
        const e = state.entries.find(x => x.month === lastOk);
        if (e) {
          if (cash.value != null) e.cashOverride = cash.value;
          if (port.value != null) e.balanceOverride = port.value;
          changed = true;
        }
      }
    }
    const corDebt = $('#cor-debt');
    if (corDebt && corDebt.value.trim() !== '') {
      const v = Fmt.parsePLN(corDebt.value);
      if (v == null || v < 0) { errBox.innerHTML = '<div class="field-error">Popraw saldo kredytu.</div>'; return; }
      state.debt.overrides = (state.debt.overrides || []).filter(o => o.month !== lastOk);
      state.debt.overrides.push({ month: lastOk, balanceNominal: v });
      changed = true;
    }
    if (!changed) { toast('Brak korekt do zapisania.'); return; }
    E.recomputeDerived(state);
    persist();
    toast('Korekty zapisane, salda przeliczone.');
    location.hash = '#/';
  });
}

// ── Kopia zapasowa ──────────────────────────────────────────────────────

function renderBackup() {
  const last = state.ui.lastExportAt;
  const nudge = !last || (Date.now() - Date.parse(last)) > 61 * 24 * 3600 * 1000;
  view().innerHTML = `
  <div class="card"><h2>Kopia zapasowa</h2>
    <p class="muted small">Dane istnieją <b>tylko na tym urządzeniu</b>. Wyczyszczenie danych przeglądarki
    lub utrata telefonu = utrata historii. Regularny eksport to Twoje ubezpieczenie.</p>
    ${nudge ? '<div class="banner warn small">Dawno nie było kopii — wyeksportuj teraz.</div>' : ''}
    <p class="muted small">Ostatnia kopia: <b>${last ? esc(new Date(last).toLocaleDateString('pl-PL')) : 'nigdy'}</b></p>
    <button id="bk-export" class="primary wide">⬇️ Eksportuj kopię (JSON)</button>
  </div>
  <div class="card"><h2>Import</h2>
    <p class="muted small">Wczytaj wcześniej wyeksportowany plik. Obecne dane zostaną <b>zastąpione</b> po potwierdzeniu.</p>
    <input type="file" id="bk-file" accept=".json,application/json">
    <div id="bk-preview"></div>
  </div>
  <div class="card"><h2>Instalacja na Androidzie</h2>
    <details class="section"><summary>Jak zainstalować aplikację</summary>
      <ol class="small">
        <li>Otwórz tę stronę w <b>Chrome</b> na telefonie.</li>
        <li>Dotknij menu <b>⋮</b> w prawym górnym rogu.</li>
        <li>Wybierz <b>„Zainstaluj aplikację”</b> (lub „Dodaj do ekranu głównego”).</li>
        <li>Gotowe — ikona 🔥 pojawi się na ekranie głównym i działa offline.</li>
      </ol>
    </details>
  </div>
  <div class="card"><h2>Strefa ostrożności</h2>
    <button id="bk-reset" class="${resetArmed ? 'danger' : ''} wide">${resetArmed ? '⚠️ Potwierdź: usuń WSZYSTKIE dane' : 'Wyzeruj aplikację…'}</button>
    ${resetArmed ? '<p class="field-error center small">To usunie całą historię bezpowrotnie. Najpierw zrób eksport!</p>' : ''}
  </div>
  <p class="muted small center">FIRE Companion v${APP_VERSION}</p>`;

  $('#bk-export').addEventListener('click', () => {
    const json = exportJSON(state);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `fire-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    state.ui.lastExportAt = new Date().toISOString();
    persist();
    toast('Kopia pobrana. Przechowuj ją np. na dysku w chmurze.');
    renderBackup();
  });

  $('#bk-file').addEventListener('change', ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const box = $('#bk-preview');
      try {
        importCandidate = importPreview(reader.result);
      } catch (err) {
        importCandidate = null;
        box.innerHTML = `<div class="field-error">${esc(err.message)}</div>`;
        return;
      }
      const p = importCandidate;
      box.innerHTML = `<table class="preview">
        <tr><td>Wpisów</td><td>${p.entriesCount}</td></tr>
        <tr><td>Zakres</td><td>${p.range ? esc(Fmt.formatMonthName(p.range.from) + ' – ' + Fmt.formatMonthName(p.range.to)) : '—'}</td></tr>
        <tr><td>Portfel startowy</td><td>${Fmt.formatPLN(p.portfolioStart)}</td></tr>
        <tr><td>Gotówka startowa</td><td>${Fmt.formatPLN(p.cashStart)}</td></tr>
        <tr><td>Data eksportu</td><td>${p.exportedAt ? esc(new Date(p.exportedAt).toLocaleDateString('pl-PL')) : '—'}</td></tr>
      </table>
      <button id="bk-import-go" class="danger wide" style="margin-top:.5rem">Zastąp obecne dane tym plikiem</button>`;
      $('#bk-import-go').addEventListener('click', () => {
        if (!confirm('Na pewno? Obecne dane zostaną bezpowrotnie zastąpione danymi z pliku.')) return;
        state = importCandidate.state;
        importCandidate = null;
        E.recomputeDerived(state);
        persist();
        applyTheme();
        toast('Dane zaimportowane.');
        location.hash = '#/';
      });
    };
    reader.readAsText(file);
  });

  $('#bk-reset').addEventListener('click', () => {
    if (!resetArmed) {
      resetArmed = true;
      renderBackup();
      setTimeout(() => { resetArmed = false; if (location.hash === '#/backup') renderBackup(); }, 6000);
      return;
    }
    storage.reset();
    state = null;
    ob = null;
    resetArmed = false;
    location.hash = '#/';
    route();
    toast('Dane usunięte. Zaczynamy od zera.');
  });
}

// ── Ekran awaryjny (uszkodzone dane) ────────────────────────────────────

export function renderCorrupt(errorMsg) {
  document.getElementById('tabbar').hidden = true;
  view().innerHTML = `<div class="card">
    <h2>⚠️ Problem z danymi</h2>
    <p>Nie udało się odczytać zapisanych danych (${esc(errorMsg)}), a kopia awaryjna także jest nieczytelna.</p>
    <p><b>Nic nie zostało usunięte.</b> Masz dwie opcje:</p>
    <p>1) Wczytaj kopię zapasową (plik JSON z eksportu):</p>
    <input type="file" id="cr-file" accept=".json,application/json">
    <div id="cr-preview"></div>
    <p>2) Albo zacznij od zera:</p>
    <button id="cr-reset" class="danger wide">Usuń dane i skonfiguruj od nowa</button>
  </div>`;
  $('#cr-file').addEventListener('change', ev => {
    const file = ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = importPreview(reader.result);
        state = p.state;
        E.recomputeDerived(state);
        persist();
        applyTheme();
        document.getElementById('tabbar').hidden = false;
        location.hash = '#/';
        route();
        toast('Dane odzyskane z kopii. Uff!');
      } catch (err) {
        $('#cr-preview').innerHTML = `<div class="field-error">${esc(err.message)}</div>`;
      }
    };
    reader.readAsText(file);
  });
  $('#cr-reset').addEventListener('click', () => {
    if (!confirm('Na pewno usunąć uszkodzone dane i zacząć od nowa?')) return;
    storage.reset();
    state = null;
    route();
  });
}
