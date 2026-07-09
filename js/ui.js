// ui.js — renderery ekranów, router hashowy, wykresy SVG, zdarzenia.

import * as E from './engine.js';
import * as Fmt from './format.js';
import * as An from './analysis.js';
import * as Sim from './simulation.js';
import * as Mot from './motivation.js';
import { chartSVG, stackedBarSVG, tipHit } from './charts.js';
import { glossaryScreen } from './glossary.js';
import { coachMessage, verdictLabel, verdictEmoji, checkinCelebration, decisionMessage, milestoneMessage } from './coach.js';
import { storage, exportJSON, importPreview, entriesCSV } from './storage.js';

export const APP_VERSION = '1.32.0';

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

// ── Modal (jedyny wzorzec nakładki poza toastem) ────────────────────────

let modalKeyHandler = null;
function showModal(innerHTML) {
  const m = document.getElementById('modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${innerHTML}</div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close-modal]')) closeModal(); };
  modalKeyHandler = e => { if (e.key === 'Escape') closeModal(); };
  document.addEventListener('keydown', modalKeyHandler);
  const btn = m.querySelector('[data-close-modal]');
  if (btn) btn.focus();
}
function closeModal() {
  const m = document.getElementById('modal');
  if (!m || m.hidden) return;
  m.hidden = true;
  m.innerHTML = '';
  m.onclick = null;
  if (modalKeyHandler) { document.removeEventListener('keydown', modalKeyHandler); modalKeyHandler = null; }
}

// Potwierdzenie w stylu aplikacji zamiast natywnego confirm(). Escape i tło
// zamykają jak każdy modal (= anuluj); fokus startuje na „Anuluj" (showModal
// fokusuje [data-close-modal]) — bezpieczny domyślny wybór przy usuwaniu.
function confirmModal(text, onYes, { yesLabel = 'Tak' } = {}) {
  showModal(`<div class="modal-msg">${esc(text)}</div>
    <div class="btn-row">
      <button type="button" data-close-modal>Anuluj</button>
      <button type="button" class="danger" data-confirm-yes>${esc(yesLabel)}</button>
    </div>`);
  $('[data-confirm-yes]').addEventListener('click', () => { closeModal(); onYes(); });
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

// FI% odporne na zdegenerowany cel (D4): przy celu ≤ 0 (np. onboarding z zerowymi
// wydatkami) zwraca null zamiast dzielić — ring nie pokaże NaN/∞, a „FIRE osiągnięte"
// nie zapali się fałszywie z Infinity.
function fiPercent(portfolio, target) {
  return target > 0 ? portfolio / target : null;
}

function ringSVG(pct, sublabel = 'celu FIRE') {
  const r = 80, c = 2 * Math.PI * r;
  // D5: NaN/Infinity/null/ujemne → 0; >100% → 1. Jeden zacisk dla geometrii i etykiety.
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(pct, 1)) : 0;
  const dash = p * c;
  return `<div class="ring-wrap">
    <svg viewBox="0 0 190 190" width="190" height="190">
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--line)" stroke-width="14"/>
      <circle cx="95" cy="95" r="${r}" fill="none" stroke="var(--accent)" stroke-width="14"
        stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"
        transform="rotate(-90 95 95)"/>
    </svg>
    <div class="ring-center">
      <span class="pct">${(p * 100).toFixed(1).replace('.', ',')}%</span>
      <span class="muted small">${esc(sublabel)}</span>
    </div>
  </div>`;
}

// ── Wykres na pełnym ekranie ────────────────────────────────────────────
// Rejestr domknięć przebudowujących wykres, po jednym na miejsce (key). Wykres
// idzie do czystych builderów jako gotowy string, więc warstwy niżej nie zmieniają
// sygnatur; tutaj owijamy go przyciskiem „⛶" i zapamiętujemy closure `build`,
// którą nakładka woła ponownie w dowolnym rozmiarze. Klucze stałe per miejsce →
// podmiany (suwaki, pola) NADPISUJĄ wpis zamiast go mnożyć; route() czyści mapę.

const chartZoom = new Map();   // key → { title, build, legendHTML }

function zoomable(key, title, build, { legendHTML = '' } = {}) {
  const html = build({});                       // renderowanie w karcie, opcje domyślne
  if (!html) return '';                         // pusty wykres → bez przycisku
  chartZoom.set(key, { title, build, legendHTML });
  return `<div class="chart-zoom">${html}
    <button type="button" class="chart-zoom-btn" data-chart-zoom="${key}" aria-label="Pokaż wykres na pełnym ekranie">⛶</button></div>`;
}

let chartFullKey = null, chartFullResizeT = null, chartFullKeyHandler = null;

function openChartFull(key) {
  const reg = chartZoom.get(key);
  if (!reg || chartFullKey) return;
  chartFullKey = key;
  history.pushState({ chartFull: true }, '');   // D7: własny wpis historii (usuwalny fallback)
  const el = document.getElementById('chart-full');
  el.innerHTML = `<div class="chart-full-head"><b>${esc(reg.title)}</b>
      <button type="button" class="chart-zoom-btn" data-chart-close aria-label="Zamknij">✕</button>
    </div><div class="chart-full-body"></div>`;
  el.hidden = false;
  renderChartFullBody();
  chartFullKeyHandler = e => { if (e.key === 'Escape') closeChartFull(); };
  document.addEventListener('keydown', chartFullKeyHandler);
  window.addEventListener('resize', onChartFullResize);
}

// Decyzja o orientacji z pomiaru pudełka (nie z sensora): pudełko poziome →
// rysuj normalnie; pionowe (blokada auto-obrotu) → rysuj dla transpozycji i
// obróć wrapper o 90° CSS. Mierzymy flex-box wprost, omijając kwirki iOS 100vh.
function renderChartFullBody() {
  const reg = chartZoom.get(chartFullKey);
  const body = document.querySelector('#chart-full .chart-full-body');
  if (!reg || !body) return;
  const box = body.getBoundingClientRect();
  const landscape = box.width >= box.height;
  const long = Math.max(box.width, box.height), short = Math.min(box.width, box.height);
  const W = 800, H = Math.max(240, Math.min(620, Math.round(W * short / Math.max(1, long))));
  const svg = reg.build({ width: W, height: H, detail: true, maxPoints: 240 });
  if (landscape) {
    body.innerHTML = svg + reg.legendHTML;
  } else {
    body.innerHTML = `<div class="cf-rot" style="width:${Math.round(box.height)}px">${svg}${reg.legendHTML}</div>`;
  }
}

function onChartFullResize() {
  clearTimeout(chartFullResizeT);
  chartFullResizeT = setTimeout(renderChartFullBody, 150);
}

function closeChartFull({ keepHistory = false } = {}) {
  if (chartFullKey == null) return;
  chartFullKey = null;
  clearTimeout(chartFullResizeT);
  const el = document.getElementById('chart-full');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  if (chartFullKeyHandler) { document.removeEventListener('keydown', chartFullKeyHandler); chartFullKeyHandler = null; }
  window.removeEventListener('resize', onChartFullResize);
  if (!keepHistory) history.back();             // skonsumuj wpis wepchnięty przy otwarciu
}

// ── Odczyt wykresu (tap-to-inspect) ─────────────────────────────────────
// Wykres z atrybutem data-tip (defs z `label` w charts.js) reaguje na dotyk:
// press pokazuje krzyżyk + odczyt dokładnych wartości, drag przewija po
// punktach/slotach, puszczenie zostawia odczyt, tap poza wykresem czyści.
// Warstwa odczytu żyje WEWNĄTRZ SVG w jednostkach viewBox — skalowanie CSS
// i obrót .cf-rot nakładki pełnoekranowej działają za darmo (mapowanie
// klient→viewBox przez getScreenCTM). Budowa przez createElementNS +
// textContent — zero powierzchni na wstrzyknięcie stringów.

const SVG_NS = 'http://www.w3.org/2000/svg';
let chartTipSvg = null;                 // svg z aktualnie widocznym odczytem

function clearChartTip() {
  if (!chartTipSvg) return;
  const g = chartTipSvg.querySelector('[data-tip-layer]');
  if (g) g.remove();
  chartTipSvg = null;
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function showChartTip(svg, tip, clientX, clientY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const p = svg.createSVGPoint();
  p.x = clientX; p.y = clientY;
  const v = p.matrixTransform(ctm.inverse());
  const hit = tipHit(tip, v.x);
  if (!hit) return;
  const old = svg.querySelector('[data-tip-layer]');
  if (old) old.remove();
  const g = svgEl('g', { 'data-tip-layer': '' });
  if (tip.kind === 'bars') {
    const slot = (tip.x1 - tip.x0) / tip.labels.length;
    g.appendChild(svgEl('rect', {
      class: 'tip-slot', x: (tip.x0 + slot * hit.i).toFixed(1), y: tip.y0,
      width: slot.toFixed(1), height: tip.y1 - tip.y0,
    }));
  } else {
    g.appendChild(svgEl('line', {
      class: 'tip-x', x1: hit.cx.toFixed(1), x2: hit.cx.toFixed(1), y1: tip.y0, y2: tip.y1,
    }));
  }
  // Odczyt po przeciwnej połowie niż krzyżyk (D7) — nigdy się nie nakładają.
  const right = hit.cx <= (tip.x0 + tip.x1) / 2;
  const rowsTxt = [
    tip.kind === 'line' ? Fmt.formatMonthName(tip.labels[hit.i]) : String(tip.labels[hit.i]),
    ...tip.series.map(s => `${s.label}: ${Fmt.formatPLN(s.v[hit.i])}`),
  ];
  const texts = rowsTxt.map((t, k) => {
    const el = svgEl('text', {
      class: 'tip-txt', x: right ? tip.x1 : tip.x0 + 4,
      y: tip.y0 + 10 + k * 12, 'text-anchor': right ? 'end' : 'start',
    });
    el.textContent = t;
    return el;
  });
  texts.forEach(t => g.appendChild(t));
  svg.appendChild(g);
  // Tło pod tekstem: pomiar getBBox możliwy dopiero po wstawieniu do DOM.
  let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
  for (const t of texts) {
    const b = t.getBBox();
    bx1 = Math.min(bx1, b.x); by1 = Math.min(by1, b.y);
    bx2 = Math.max(bx2, b.x + b.width); by2 = Math.max(by2, b.y + b.height);
  }
  g.insertBefore(svgEl('rect', {
    class: 'tip-bg', x: (bx1 - 3).toFixed(1), y: (by1 - 3).toFixed(1),
    width: (bx2 - bx1 + 6).toFixed(1), height: (by2 - by1 + 6).toFixed(1),
  }), texts[0]);
  chartTipSvg = svg;
}

// ── Router ──────────────────────────────────────────────────────────────

export function startApp(loaded) {
  state = loaded;
  // Stan mógł przejść walidację, a przeliczenie i tak paść — zamiast białego
  // ekranu spadamy na ekran awaryjny (dane w localStorage nietknięte).
  let bootError = null;
  if (state) {
    try {
      E.recomputeDerived(state);
    } catch (err) {
      bootError = String(err && err.message || err);
      state = null;
    }
  }
  if (state) applyTheme();
  $('#header-month').textContent = Fmt.formatMonthName(E.todayYm());
  // Jeden delegowany listener na cały dokument — przeżywa podmiany innerHTML
  // dynamicznych poddrzew (wyniki suwaków), inaczej niż wiązanie per-render.
  document.addEventListener('click', e => {
    const zoomBtn = e.target.closest('[data-chart-zoom]');
    if (zoomBtn) return openChartFull(zoomBtn.dataset.chartZoom);
    if (e.target.closest('[data-chart-close]')) closeChartFull();
  });
  // Odczyt wykresu: ten sam wzorzec delegacji co wyżej — przeżywa podmiany
  // innerHTML (suwaki, pola). Press na wykresie z data-tip pokazuje odczyt,
  // drag przewija (pointer capture), press gdziekolwiek indziej czyści.
  document.addEventListener('pointerdown', e => {
    const svg = e.target.closest('svg.chart[data-tip]');
    if (!svg) return clearChartTip();
    e.preventDefault();                 // bez zaznaczania tekstu przy przewijaniu
    if (svg !== chartTipSvg) clearChartTip();
    const tip = svg._tip || (svg._tip = JSON.parse(svg.dataset.tip));
    const move = ev => showChartTip(svg, tip, ev.clientX, ev.clientY);
    move(e);
    if (svg.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch (_) { /* np. pointer już zwolniony */ } }
    svg.addEventListener('pointermove', move);
    const stop = () => svg.removeEventListener('pointermove', move);
    svg.addEventListener('pointerup', stop, { once: true });
    svg.addEventListener('pointercancel', stop, { once: true });
  });
  window.addEventListener('popstate', () => {
    if (chartFullKey) closeChartFull({ keepHistory: true });
  });
  window.addEventListener('hashchange', route);
  route();
  // Ten sam wzorzec co ścieżka corrupt w app.js: router wyrenderował spód,
  // ekran awaryjny nadpisuje go na wierzchu.
  if (bootError) renderCorrupt(bootError);
}

export function getState() { return state; }

function applyTheme() {
  const t = state && state.ui.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function route() {
  closeModal(); // nawigacja wstecz nie może zostawić martwej nakładki
  closeChartFull({ keepHistory: true }); // ta sama zasada dla nakładki wykresu
  clearChartTip();                       // warstwa ginie z markupem — zeruj też ref
  chartZoom.clear();                     // rejestr odbudowuje się przy renderze ekranu
  const hash = location.hash || '#/';
  const tabbar = document.getElementById('tabbar');
  if (!state) {
    tabbar.hidden = true;
    renderOnboarding();
    return;
  }
  tabbar.hidden = false;
  $$('#tabbar a').forEach(a => {
    const on = a.dataset.route === activeRoute(hash);
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (hash.startsWith('#/checkin')) {
    const m = hash.split('/')[2];
    renderCheckin(m && E.isValidYm(m) ? m : null);
  } else if (hash === '#/history') renderHistory();
  else if (hash === '#/analiza') renderAnaliza();
  else if (hash === '#/symulacja') renderSymulacjaHub();
  else if (hash.startsWith('#/symulacja/')) renderSymulacja(hash.split('/')[2]);
  else if (hash === '#/plan') renderPlanHub();
  else if (hash.startsWith('#/plan/')) renderPlanSection(hash.split('/')[2]);
  else if (hash === '#/slowniczek') renderGlossary(null);
  else if (hash.startsWith('#/slowniczek/')) renderGlossary(hash.split('/')[2]);
  else if (hash === '#/backup') renderBackup();
  else if (hash.startsWith('#/raport/')) renderRaport(hash.split('/')[2]);
  else renderDashboard();
}

// Podświetlenie zakładki: check-in należy do Pulpitu, a Kopia, Słowniczek
// i wszystkie pod-strony Planu (#/plan/*) — do zakładki Plan
// (slice(0,2) daje już „#/plan").
function activeRoute(hash) {
  if (hash.startsWith('#/checkin')) return '#/';
  if (hash === '#/backup') return '#/plan';
  if (hash.startsWith('#/slowniczek')) return '#/plan';
  if (hash.startsWith('#/raport')) return '#/history'; // raport roczny żyje pod Historią
  return hash.split('/').slice(0, 2).join('/');
}

// ── Onboarding (5 kroków) ───────────────────────────────────────────────

const OB_DEFAULTS = {
  birthDate: '', targetFireAge: '', monthlyIncome: '',
  monthlyLivingExpenses: '', currentRentMonthly: '', cashStart: '', portfolioStart: '',
  houseEnabled: false, mtgStart: '', mtgPrincipal: '', mtgRate: '7', mtgTerm: '25', mtgOverride: '',
  moveIn: '', hsMonth: '', hsAmount: '', bizIncome: '', bizStart: '',
  flEnabled: false, flPrincipal: '', flRate: '3.5', flStart: '', flEnd: '', flOverride: '',
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
      ${field({ id: 'ob-mtg-rate', label: 'Oprocentowanie nominalne', suffix: '%', value: ob.d.mtgRate, tipText: 'Nominalne oprocentowanie kredytu z umowy (kredyt i dług rodzinny to jedyne nominalne kontrakty w aplikacji — reszta liczona jest realnie, w dzisiejszych złotówkach).' })}
      ${field({ id: 'ob-mtg-term', label: 'Okres kredytu', suffix: 'lata', value: ob.d.mtgTerm, mode: 'numeric' })}
      <div class="banner info" id="ob-annuity">Rata: —</div>
      ${field({ id: 'ob-mtg-override', label: 'Rata ręcznie (opcjonalnie)', suffix: 'zł', value: ob.d.mtgOverride, hint: 'Zostaw puste, aby użyć raty wyliczonej.' })}
      ${field({ id: 'ob-movein', label: 'Miesiąc wprowadzki', type: 'month', value: ob.d.moveIn, tipText: 'Od tego miesiąca przestajesz płacić czynsz najmu.' })}
      ${field({ id: 'ob-hs-month', label: 'Miesiąc wydatku na dom', type: 'month', value: ob.d.hsMonth, hint: 'Domyślnie: start kredytu.', tipText: 'Moment, w którym gotówka (fundusz na dom) zostaje wydana na wkład własny / budowę.' })}
      ${field({ id: 'ob-hs-amount', label: 'Kwota wydatku na dom', suffix: 'zł', value: ob.d.hsAmount, hint: 'Zostaw puste = cała zgromadzona gotówka.' })}
      ${field({ id: 'ob-biz-income', label: 'Dodatkowy dochód (np. z działalności)', suffix: 'zł/mies.', value: ob.d.bizIncome, hint: 'Opcjonalnie. 0 = brak.' })}
      ${field({ id: 'ob-biz-start', label: 'Od kiedy dodatkowy dochód', type: 'month', value: ob.d.bizStart })}
      <h3>Dług rodzinny</h3>
      <label class="field"><span class="lbl">
        <input type="checkbox" id="ob-fl" ${ob.d.flEnabled ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
        Dodatkowy dług rodzinny (obok kredytu)</span>
      </label>
      ${ob.d.flEnabled ? `
      ${field({ id: 'ob-fl-principal', label: 'Kwota długu rodzinnego', suffix: 'zł', value: ob.d.flPrincipal })}
      ${field({ id: 'ob-fl-rate', label: 'Oprocentowanie nominalne', suffix: '%', value: ob.d.flRate, tipText: 'Stałe oprocentowanie pożyczki od rodziny (nominalne — to drugi nominalny kontrakt w aplikacji).' })}
      ${field({ id: 'ob-fl-start', label: 'Start spłaty', type: 'month', value: ob.d.flStart, tipText: 'Miesiąc, w którym pojawia się saldo i zaczyna się spłata.' })}
      ${field({ id: 'ob-fl-end', label: 'Koniec spłaty', type: 'month', value: ob.d.flEnd, tipText: 'Ostatni miesiąc spłaty (włącznie).' })}
      <div class="banner info" id="ob-fl-annuity">Rata: —</div>
      ${field({ id: 'ob-fl-override', label: 'Rata ręcznie (opcjonalnie)', suffix: 'zł', value: ob.d.flOverride, hint: 'Zostaw puste, aby użyć raty wyliczonej.' })}
      ` : ''}
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
      'ob-fl-principal': 'flPrincipal', 'ob-fl-rate': 'flRate', 'ob-fl-start': 'flStart', 'ob-fl-end': 'flEnd', 'ob-fl-override': 'flOverride',
      'ob-wr': 'wr', 'ob-return': 'realReturn', 'ob-infl': 'inflation', 'ob-gexp': 'gExp', 'ob-ginc': 'gInc', 'ob-cashret': 'cashReturn',
    };
    for (const [id, key] of Object.entries(ids)) {
      const el = $('#' + id);
      if (el) ob.d[key] = el.value;
    }
    const house = $('#ob-house');
    if (house) ob.d.houseEnabled = house.checked;
    const fl = $('#ob-fl');
    if (fl) ob.d.flEnabled = fl.checked;
  };

  const houseCb = $('#ob-house');
  if (houseCb) houseCb.addEventListener('change', () => { grab(); renderOnboarding(); });
  const flCb = $('#ob-fl');
  if (flCb) flCb.addEventListener('change', () => { grab(); renderOnboarding(); });

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

  const flAnnuityPreview = () => {
    const out = $('#ob-fl-annuity');
    if (!out) return;
    const P = Fmt.parsePLN($('#ob-fl-principal').value);
    const r = Fmt.parsePLN($('#ob-fl-rate').value);
    const start = $('#ob-fl-start').value;
    const end = $('#ob-fl-end').value;
    const ov = Fmt.parsePLN($('#ob-fl-override').value);
    if (ov != null) { out.textContent = `Rata (ręczna): ${Fmt.formatPLN(ov)}/mies.`; return; }
    if (P != null && r != null && E.isValidYm(start) && E.isValidYm(end) && E.ymToIdx(end) >= E.ymToIdx(start)) {
      const A = E.familyLoanPayment({ principal: P, rateNominal: r / 100, startMonth: start, endMonth: end, paymentOverrideMonthly: null });
      const N = E.familyLoanTermMonths({ startMonth: start, endMonth: end });
      out.textContent = `Rata wyliczona: ${Fmt.formatPLN(A)}/mies. (${N} mies.)`;
    } else out.textContent = 'Rata: — (uzupełnij kwotę, oprocentowanie i okno spłaty)';
  };
  if ($('#ob-fl-annuity')) {
    ['ob-fl-principal', 'ob-fl-rate', 'ob-fl-start', 'ob-fl-end', 'ob-fl-override'].forEach(id =>
      $('#' + id).addEventListener('input', flAnnuityPreview));
    flAnnuityPreview();
  }

  const back = $('[data-back]');
  if (back) back.addEventListener('click', () => { grab(); ob.error = ''; ob.step--; renderOnboarding(); });

  const next = $('[data-next]');
  if (next) next.addEventListener('click', () => {
    grab();
    ob.error = validateObStep(s);
    if (!ob.error) ob.step++;
    renderOnboarding();
    if (ob.error) window.scrollTo(0, 0);   // komunikat błędu jest na górze karty
  });

  const finish = $('[data-finish]');
  if (finish) finish.addEventListener('click', () => {
    grab();
    ob.error = validateObStep(4);
    if (ob.error) { renderOnboarding(); window.scrollTo(0, 0); return; }
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
    if (d.flEnabled) {
      const flP = money(d.flPrincipal);
      if (flP == null || flP <= 0) return 'Podaj kwotę długu rodzinnego.';
      const flR = money(d.flRate);
      if (flR == null || flR < 0 || flR > 30) return 'Podaj oprocentowanie długu rodzinnego (0–30%).';
      if (!E.isValidYm(d.flStart)) return 'Podaj start spłaty długu rodzinnego.';
      if (!E.isValidYm(d.flEnd)) return 'Podaj koniec spłaty długu rodzinnego.';
      if (E.ymToIdx(d.flEnd) < E.ymToIdx(d.flStart)) return 'Koniec spłaty długu rodzinnego nie może być przed startem.';
    }
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
        familyLoan: houseOn && d.flEnabled ? {
          enabled: true,
          startMonth: d.flStart,
          endMonth: d.flEnd,
          principal: m(d.flPrincipal),
          rateNominal: m(d.flRate) / 100,
          paymentOverrideMonthly: Fmt.parsePLN(d.flOverride),
        } : { enabled: false, startMonth: null, endMonth: null, principal: 0, rateNominal: 0, paymentOverrideMonthly: null },
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
    const d = state.derived;
    const nowIdx = E.ymToIdx(E.todayYm());
    if (nowIdx < E.ymToIdx(hp.mortgage.startMonth)) return 'housefund';
    const debtOn = d.debt.started && d.debt.balanceNominal > 0;
    const famOn = d.family && d.family.started && d.family.balanceNominal > 0;
    if (debtOn || famOn) return 'debt';
  }
  return 'accumulation';
}

// Czy FIRE jest osiągnięte „tu i teraz": portfel pokrywa cel ORAZ (bez domu lub
// kredyt + dług rodzinny spłacone). Współdzielone przez hero i kartę celu.
function fireReachedNow(state, d, nowYm) {
  const hp = state.housing.housePlan;
  const targets = E.fireTargetsToday(state, nowYm);
  const pct = fiPercent(d.balances.portfolio, targets.primary);
  const famSettled = !(d.family && d.family.started) || d.family.balanceNominal <= 0;
  // Cel ≤ 0 (pct === null) nigdy nie jest trywialnie „osiągnięty" (4.2).
  return pct != null && pct >= 1 && (!hp.enabled || (d.debt.started && d.debt.balanceNominal <= 0 && famSettled));
}

// Wspólny render „ile odkładać, by zdążyć na wiek FIRE" — jeden komunikat dla
// pulpitu, check-inu i Analizy. rsg = E.requiredSavingsForGoal(state).
// compact → wersja bannerowa (jedna linia); domyślnie karta z dużą liczbą.
function goalSavingsHTML(rsg, { compact = false } = {}) {
  if (!rsg || rsg.status === 'na') return '';
  const age = esc(rsg.targetAgeYears);

  if (rsg.status === 'infeasible') {
    return `<div class="banner warn small">Cel wieku ${age} jest poza zasięgiem nawet przy dużych oszczędnościach — zajrzyj do założeń lub wybierz późniejszy wiek.</div>`;
  }

  if (rsg.status === 'onTrack') {
    const plan = Fmt.formatPLN(Math.round(rsg.plannedNow));
    const atAge = rsg.fireAge ? esc(Fmt.formatAgeYM(rsg.fireAge)) : '—';
    return `<div class="banner success small">Jesteś na dobrej drodze — odkładając <b>${plan}</b>/mies. osiągniesz FIRE w wieku ${atAge} (cel: ${age}). 🔥</div>`;
  }

  // status === 'need'
  const req = Math.round(rsg.requiredMonthly);
  const planPLN = Fmt.formatPLN(Math.round(rsg.plannedNow));
  const extraPLN = Fmt.formatPLN(Math.ceil(rsg.extraMonthly));

  // Miesiąc budowy: plan zakłada niedobór — nie drukuj „odkładaj −X".
  if (req <= 0) {
    const deficit = Fmt.formatPLN(Math.round(-rsg.plannedNow));
    return `<div class="banner info small">Aby zdążyć na wiek ${age}: to miesiąc budowy (plan zakłada niedobór ${deficit}) — utrzymaj dyscyplinę i dołóż <b>${extraPLN}</b> ponad plan.</div>`;
  }

  const reqPLN = Fmt.formatPLN(req);
  if (compact) {
    return `<div class="banner info small">Aby zdążyć na wiek ${age}: odkładaj <b>${reqPLN}</b>/mies. <span class="muted">(plan ${planPLN} + ${extraPLN})</span></div>`;
  }
  return `<div class="card">
    <div class="muted small">Aby osiągnąć FIRE w wieku ${age}</div>
    <div class="big">Odkładaj ${reqPLN} / mies.</div>
    <div class="muted small">plan ${planPLN} + dodatkowo ${extraPLN}</div>
  </div>`;
}

// Karta „Dzisiejsza decyzja" — stan przejściowy (wzorzec Symulacji). Efemeryczne:
// nic nie zapisujemy, zmienne giną przy przeładowaniu — z założenia.
let decMode = 'avoided';   // 'avoided' | 'spent'
let decAmount = '';
let decCategory = null;    // 'invest' | 'impulse' — w trybie 'spent' wymagany wybór
let decSeed = Math.floor(Math.random() * 1e6);

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
  // Karta sezonowa raportu rocznego: grudzień → bieżący rok (rok w toku),
  // styczeń → miniony (grudniowy check-in wpada 1 stycznia). Nic ciężkiego
  // nie liczymy — annualReport (2 pełne prognozy) działa dopiero na #/raport.
  {
    const nowMonth = Number(nowYm.slice(5));
    const reportYear = nowMonth === 12 ? Number(nowYm.slice(0, 4))
      : nowMonth === 1 ? Number(nowYm.slice(0, 4)) - 1 : null;
    if (reportYear != null && E.reportYears(state).includes(reportYear)) {
      html += `<div class="banner info">🎁 <b>Twój rok FIRE ${reportYear}</b> — zobacz podsumowanie:
        ile odłożone, jaka seria, o ile przybliżyło się FIRE.
        <div class="btn-row"><a class="btn primary" href="#/raport/${reportYear}">Pokaż raport</a></div></div>`;
    }
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
    const fam = d.family;
    const famOn = !!(fam && fam.started && fam.balanceNominal > 0);
    const mtgOn = d.debt.started && d.debt.balanceNominal > 0;
    html += `<div class="card">
      <div class="muted">Do spłaty (realnie)</div>
      <div class="big">${Fmt.formatPLN(d.debt.balanceReal + (fam ? fam.balanceReal : 0))}</div>
      ${mtgOn ? `<div class="muted small">kredyt: ${Fmt.formatPLN(d.debt.balanceReal)} (nom. ${Fmt.formatPLN(d.debt.balanceNominal)})</div>` : ''}
      ${famOn ? `<div class="muted small">dług rodzinny: ${Fmt.formatPLN(fam.balanceReal)} (nom. ${Fmt.formatPLN(fam.balanceNominal)})</div>` : ''}
      <div class="bar flame"><i style="width:${(pct * 100).toFixed(1)}%"></i></div>
      <div class="small">kredyt spłacony w <b>${(pct * 100).toFixed(1).replace('.', ',')}%</b></div>
      ${dfYm ? `<p>Wolny od kredytu: <b class="good">${Fmt.formatMonthName(dfYm)}</b><br>
        <span class="muted small">za ${Fmt.formatYearsMonths(Math.max(0, E.monthsBetween(nowYm, dfYm)))}</span></p>` : ''}
      ${famOn && proj.familyFreeYm ? `<p>Wolny od długu rodzinnego: <b class="good">${Fmt.formatMonthName(proj.familyFreeYm)}</b></p>` : ''}
      <p class="muted small">Strategia: najpierw dług, potem inwestowanie — każda nadpłata przybliża datę wyżej.</p>
    </div>`;
    const debtRows = proj.series.filter(r => r.debtReal > 0 || (r.familyReal || 0) > 0 || !r.projected);
    if (debtRows.length > 1) {
      const debtLegend = famOn ? '<div class="legend"><span><i style="background:var(--danger)"></i>kredyt + dług rodzinny (realnie)</span></div>' : '';
      html += `<div class="card"><h2>Krzywa topnienia długu</h2>
        ${zoomable('dash-dlug', 'Krzywa topnienia długu', o => chartSVG(debtRows, [
        { get: r => r.debtReal + (r.familyReal || 0), cls: 'line-debt', label: 'dług (realnie)' },
      ], o), { legendHTML: debtLegend })}
        ${debtLegend}
      </div>`;
    }
  } else {
    const targets = E.fireTargetsToday(state, nowYm);
    const pct = fiPercent(d.balances.portfolio, targets.primary);
    const reachedNow = fireReachedNow(state, d, nowYm);
    html += `<div class="card hero">
      ${reachedNow ? '<div class="banner success"><b>🎉 FIRE osiągnięte!</b> Portfel pokrywa Twoje wydatki przy bezpiecznej stopie wypłat.</div>' : ''}
      ${ringSVG(pct)}
      <p style="margin:.5rem 0 0">${Fmt.formatPLN(d.balances.portfolio)} <span class="muted">z</span> <b>${Fmt.formatPLN(targets.primary)}</b> ${tip('Twoja kwota FIRE: roczne wydatki ÷ stopa wypłat. Cel jest ruchomy — rośnie razem z planowanym wzrostem wydatków.')}</p>
      ${proj.reached ? `<p>Prognoza FIRE: <b class="${proj.onTrack ? 'good' : 'warn-text'}">${Fmt.formatMonthName(proj.fireYm)}</b>
        <span class="muted">(wiek ${Fmt.formatAgeYM(proj.fireAge)}, cel: ${state.assumptions.targetFireAge})</span>
        ${proj.byPlanOnly ? '<br><span class="muted small">prognoza wg planu — po 3 wpisach użyję Twoich realnych wyników</span>' : ''}</p>`
        : '<p class="warn-text small">Przy obecnym planie cel FIRE jest poza 60-letnim horyzontem — zajrzyj do założeń.</p>'}
      ${hp.enabled ? `<p class="muted small">Gdybyś wynajmował na zawsze, cel wynosiłby ${Fmt.formatPLN(targets.rentingForever)}.</p>` : ''}
      ${d.streak.current > 0 ? `<p class="streak">🔥 seria: <b>${d.streak.current}</b> ${d.streak.current === 1 ? 'dobry miesiąc' : 'dobre miesiące z rzędu'}</p>` : ''}
    </div>`;
    const rows = proj.series;
    if (rows.length > 1) {
      // Pasmo prognozy (D9): zwrot ±1,5 pkt proc., liczone przy renderze —
      // nigdy nie zapisywane. band.rows kryją pełny horyzont (stopAtFire:false),
      // więc każdy wiersz wykresu dostaje lo/hi; historia ma lo == hi == fakt,
      // więc wielokąt otwiera się dokładnie na szwie prognozy.
      const band = E.projectionBand(state);
      const bandBy = new Map(band.rows.map(b => [b.ym, b]));
      const chartRows = rows.map(r => {
        const b = bandBy.get(r.ym);
        return b ? { ...r, bandLo: b.lo, bandHi: b.hi } : r;
      });
      const portLegend = '<div class="legend"><span><i style="background:var(--accent)"></i>portfel (— historia, ⋯ prognoza)</span><span><i style="background:var(--muted)"></i>cel ruchomy</span><span><i style="background:var(--accent);opacity:.25"></i>pasmo: zwrot ±1,5 pkt proc.</span></div>';
      html += `<div class="card"><h2>Portfel vs cel</h2>
        ${zoomable('dash-portfel', 'Portfel vs cel', o => chartSVG(chartRows, [
        { band: true, lo: r => r.bandLo, hi: r => r.bandHi, cls: 'band-return' },
        { get: r => r.target, cls: 'line-target', label: 'cel' },
        { get: r => r.portfolio, cls: 'line-port', clsProj: 'line-proj', split: true, label: 'portfel' },
      ], o), { legendHTML: portLegend })}
        ${portLegend}
        <p class="muted small">Pasmo pokazuje, jak prognoza się rozjeżdża, gdy rynek da o 1,5 punktu procentowego więcej albo mniej, niż zakładasz — im dalej w przyszłość, tym mniej pewna jest każda prognoza.</p>
      </div>`;
    }
  }

  // ── Ile odkładać, by zdążyć na wiek FIRE ──
  // Nie pokazujemy, gdy FIRE już osiągnięte tu i teraz.
  if (!fireReachedNow(state, d, nowYm)) {
    html += goalSavingsHTML(E.requiredSavingsForGoal(state));
  }

  // ── Salda zawsze widoczne ──
  html += `<div class="balances">
    <div class="card"><div class="muted small">Gotówka 💵</div><div class="big">${Fmt.formatPLN(d.balances.cash)}</div></div>
    <div class="card"><div class="muted small">Inwestycje 📈</div><div class="big">${Fmt.formatPLN(d.balances.portfolio)}</div></div>
  </div>`;

  html += canCheckin
    ? `<a class="btn primary wide" href="#/checkin">➕ Check-in — ${esc(Fmt.formatMonthName(lastOk))}</a>`
    : `<div class="banner info">Pierwszy pełny miesiąc zamknie się z końcem ${esc(Fmt.formatMonthGenitive(nowYm))} — wróć 1. dnia następnego miesiąca.</div>`;

  // ── Karta „Dzisiejsza decyzja" (na dole, nigdy nad CTA check-inu) ──
  const decisionResult = () => {
    const raw = decAmount.trim();
    if (raw === '') return '<p class="muted small">Podaj kwotę, aby zobaczyć, co to znaczy dla Twojego FIRE.</p>';
    const amount = Fmt.parsePLN(raw);
    if (amount == null || amount <= 0) return '<div class="field-error">Podaj dodatnią kwotę.</div>';
    if (decMode === 'spent' && !decCategory) return '<p class="muted small">Wybierz kategorię wydatku.</p>';
    const impact = E.oneOffImpact(state, amount);
    if (decMode === 'avoided') {
      return Mot.avoidedResult({ amount, impact, message: decisionMessage('avoided', decSeed) });
    }
    return Mot.spentResult({
      amount, category: decCategory, impact,
      message: decisionMessage(decCategory, decSeed),
    });
  };
  html += Mot.decisionCard({ mode: decMode, amount: decAmount, category: decCategory, resultHTML: decisionResult() });

  view().innerHTML = html;

  const decAmt = $('#dec-amount');
  if (decAmt) decAmt.addEventListener('input', () => {
    decAmount = decAmt.value;
    const r = $('#dec-result');
    if (r) r.innerHTML = decisionResult(); // tylko podmiana wyniku — fokus przeżywa
  });
  $$('[data-decmode]').forEach(el => el.addEventListener('click', () => {
    decMode = el.dataset.decmode;
    decSeed = Math.floor(Math.random() * 1e6); // nowa próba → inny komunikat
    renderDashboard();
  }));
  $$('[data-deccat]').forEach(el => el.addEventListener('click', () => {
    decCategory = el.dataset.deccat;
    decSeed = Math.floor(Math.random() * 1e6);
    renderDashboard();
  }));

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
      ${ringSVG(fiPercent(d.balances.portfolio, targets.primary))}
      <p class="warn-text small" style="margin:.5rem 0 0">Przy obecnym planie cel FIRE jest poza 60-letnim horyzontem — zajrzyj do założeń.</p>
      <p class="muted small">Kwota FIRE dziś: ${Fmt.formatPLN(targets.primary)}.</p>
    </div>`;
  }
  const jp = E.fireJourneyProgress(state, d.plan, proj, d.uptoYm);
  return `<div class="card hero">
    ${ringSVG(jp.pct, 'drogi do FIRE')}
    <p style="margin:.5rem 0 0">Prognoza FIRE: <b class="${proj.onTrack ? 'good' : 'warn-text'}">${Fmt.formatMonthName(proj.fireYm)}</b>
      <span class="muted">(wiek ${Fmt.formatAgeYM(proj.fireAge)})</span></p>
    <p class="muted small">Każda złotówka odłożona na dom, dług i inwestycje przybliża Cię do celu (kwota FIRE dziś: ${Fmt.formatPLN(targets.primary)}). ${tip('Postęp całej drogi oszczędzania: suma tego, co już odłożone, do sumy potrzebnej do FIRE (dom + dług + inwestycje), ważona wzrostem inwestycji. W realnych zł, więc inflacja uwzględniona. Pasek tylko rośnie.')}</p>
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
  const family = E.replayFamilyLoan(state, m);
  const fm = family.byMonth.get(E.ymToIdx(m));
  const familyActive = !!(fm && fm.balStart > E.EPS);
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
    ${m === months[0] ? goalSavingsHTML(E.requiredSavingsForGoal(state), { compact: true }) : ''}
    <div id="ci-error"></div>
    ${field({ id: 'ci-earned', label: 'Zarobione', suffix: 'zł', value: existing ? moneyVal(existing.earned) : '', tipText: 'Wszystkie dochody netto w tym miesiącu.' })}
    ${field({ id: 'ci-spent', label: 'Wydane', suffix: 'zł', value: existing ? moneyVal(existing.spent) : '', hint: 'Razem z czynszem i ratą kredytu.' })}
    ${debtActive ? field({ id: 'ci-overpay', label: 'Nadpłata kredytu', suffix: 'zł', value: existing ? moneyVal(existing.overpayment) : '', placeholder: '0', hint: 'Nadpłata liczy się jako oszczędzanie — zmniejsza dług.', tipText: 'Kwota wpłacona na kredyt PONAD ratę. Nie wliczaj jej do „Wydane”.' }) : ''}
    ${familyActive ? field({ id: 'ci-fl-overpay', label: 'Nadpłata długu rodzinnego', suffix: 'zł', value: existing ? moneyVal(existing.familyOverpayment) : '', placeholder: '0', hint: 'Nadpłata liczy się jako oszczędzanie — zmniejsza dług rodzinny.', tipText: 'Kwota wpłacona na dług rodzinny PONAD ratę. Nie wliczaj jej do „Wydane”.' }) : ''}
    <label class="field"><span class="lbl">Notatka <span class="muted">(opcjonalnie)</span></span>
      <textarea id="ci-note" maxlength="200" rows="2" placeholder="np. premia, urlop, naprawa auta…">${existing && existing.note ? esc(existing.note) : ''}</textarea>
      <div class="hint">Krótka historia miesiąca (do 200 znaków) — zobaczysz ją w Historii. Na liczby nie wpływa.</div>
    </label>
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
    confirmModal(`Usunąć wpis za ${Fmt.formatMonthName(m)}? Salda i prognoza zostaną przeliczone.`, () => {
      E.deleteEntry(state, m);
      persist();
      toast('Wpis usunięty.');
      location.hash = '#/history';
    }, { yesLabel: 'Usuń' });
  });

  $('#ci-save').addEventListener('click', () => {
    const errBox = $('#ci-error');
    errBox.innerHTML = '';
    const earned = parseMoney('ci-earned');
    const spent = parseMoney('ci-spent');
    const over = debtActive ? parseMoney('ci-overpay', { required: false }) : { value: 0 };
    const flOver = familyActive ? parseMoney('ci-fl-overpay', { required: false }) : { value: 0 };
    const cashOv = parseMoney('ci-cash-ov', { required: false });
    const portOv = parseMoney('ci-port-ov', { required: false });
    const bad = [earned, spent, over, flOver, cashOv, portOv].find(x => x.error);
    if (bad) { errBox.innerHTML = `<div class="field-error">${esc(bad.error)}</div>`; return; }
    const prevFireYm = state.derived.projection.reached ? state.derived.projection.fireYm : null;
    const wasFirst = state.entries.length === 0;
    const prevEntry = [...state.entries].filter(e => e.month < m).sort((a, b) => (a.month < b.month ? 1 : -1))[0];
    // Kamienie milowe: snapshot statusu PRZED mutacją, diff PO niej — celebrują
    // tylko przekroczenia z tego zapisu; obejrzane klucze jadą tym samym persist().
    const d0 = state.derived;
    const msBefore = E.milestoneStatus(state, d0.balances, d0.debt, d0.family, d0.uptoYm);
    let entry;
    try {
      entry = E.applyCheckIn(state, {
        month: m, earned: earned.value, spent: spent.value,
        overpayment: over.value || 0,
        familyOverpayment: flOver.value || 0,
        cashOverride: cashOv.value, balanceOverride: portOv.value,
        note: $('#ci-note').value,
      });
    } catch (err) {
      errBox.innerHTML = `<div class="field-error">${esc(err.message)}</div>`;
      return;
    }
    const d1 = state.derived; // applyCheckIn przeliczył pochodne
    const msAfter = E.milestoneStatus(state, d1.balances, d1.debt, d1.family, d1.uptoYm);
    const crossed = E.newMilestones(msBefore, msAfter, state.ui.milestonesSeen);
    if (crossed.length) {
      const seen = Array.isArray(state.ui.milestonesSeen) ? state.ui.milestonesSeen : [];
      state.ui.milestonesSeen = [...seen, ...crossed];
    }
    persist();
    renderCheckinResult(entry, { prevFireYm, wasFirst, prevEntry });
    const seed = Math.floor(Math.random() * 1e6);
    const ms = crossed.length ? milestoneMessage(crossed[0], seed) : null;
    showModal(Mot.checkinModal({
      verdict: entry.verdict,
      message: checkinCelebration(entry.verdict, seed),
      milestone: ms ? { ...ms, extraTitles: crossed.slice(1).map(k => milestoneMessage(k, seed).title) } : null,
    }));
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
    ${d.debt.balanceNominal > 0 ? `<div class="kv"><span>Kredyt (realnie)</span><b>${Fmt.formatPLN(d.debt.balanceReal)}</b></div>` : ''}
    ${d.family && d.family.balanceNominal > 0 ? `<div class="kv"><span>Dług rodzinny (realnie)</span><b>${Fmt.formatPLN(d.family.balanceReal)}</b></div>` : ''}
    ${proj.reached ? `<div class="kv"><span>Prognoza FIRE</span><b>${Fmt.formatMonthName(proj.fireYm)} ${shift}</b></div>` : ''}
    ${d.streak.current > 0 ? `<div class="kv"><span>Seria</span><b>🔥 ${d.streak.current}</b></div>` : ''}
  </div>
  ${goalSavingsHTML(E.requiredSavingsForGoal(state), { compact: true })}
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

  // Usunięcie najwcześniejszego miesiąca: pełny, opisany przycisk (nie samotny ✕)
  // — dla wpisu w pasku akcji rozwiniętego wiersza, dla pustego miesiąca od razu
  // pod wierszem (pusty wiersz nie rozwija się — dotknięcie prowadzi do check-inu).
  const canRemove = E.ymToIdx(E.addMonths(state.anchorMonth, 1)) <= E.ymToIdx(E.todayYm());
  const removeBar = ym => (ym === state.anchorMonth && canRemove)
    ? `<button class="danger hist-remove" data-remove-earliest="${ym}">🗑️ Usuń miesiąc i cofnij start planu</button>`
    : '';

  for (const ym of months) {
    const e = byMonth.get(ym);
    if (!e) {
      const bar = removeBar(ym);
      rows.push(`<div class="hist-row gap" data-m="${ym}" data-gap>
        <div class="m">${esc(Fmt.formatMonthName(ym))}<span class="muted small">brak wpisu — dotknij, aby uzupełnić</span></div>
      </div>
      ${bar ? `<div class="hist-actions">${bar}</div>` : ''}`);
      continue;
    }
    const net = Math.round((e.earned - e.spent) * 100) / 100;
    const delta = net - e.plannedSavingsSnapshot;
    rows.push(`<div class="hist-row" data-m="${ym}">
      <div class="m"><b>${esc(Fmt.formatMonthName(ym))}</b>
        <span class="muted small">odłożone ${Fmt.formatPLN(net)} · ${delta >= 0 ? '+' : ''}${Fmt.formatPLN(delta)} vs plan</span>
        ${e.note ? `<span class="muted small hist-note">📝 ${esc(e.note)}</span>` : ''}</div>
      <span class="badge v-${e.verdict}">${verdictEmoji(e.verdict)}</span>
    </div>
    ${histExpanded === ym ? `<div class="hist-actions">
      <button data-edit="${ym}">✏️ Edytuj</button>
      <button class="danger" data-del="${ym}">🗑️ Usuń</button>
      ${removeBar(ym)}
    </div>` : ''}`);
  }

  const addEarlier = `<button class="btn ghost wide hist-add" id="hist-add-earlier">➕ Dodaj wcześniejszy miesiąc</button>
    <p class="muted small">Cofa start planu o miesiąc, aby uzupełnić wcześniejsze check-iny.</p>`;

  // Wykres „odłożone vs plan" nad listą — te same dane, ten sam ekran.
  // Bez strażnika ≥ 0: chartSVG zna domenę ujemną (miesiące budowy/deficyty).
  const hist = E.monthlySavingsHistory(state.entries);
  const chartCard = hist.length > 1
    ? An.savingsHistoryCard({
      chartHTML: zoomable('hist-plan', 'Miesiąc po miesiącu: odłożone vs plan',
        o => chartSVG(hist, [
          { get: r => r.planned, cls: 'line-target', label: 'plan' },
          { get: r => r.net, cls: 'line-port', label: 'odłożone' },
        ], o), { legendHTML: An.cumLegend() }),
    })
    : '';

  view().innerHTML = `${chartCard}<div class="card">
    <h2>Historia check-inów</h2>
    ${rows.length ? rows.join('') : '<p class="muted">Jeszcze pusto — pierwszy check-in przed Tobą.</p>'}
    ${addEarlier}
    ${state.derived.streak.best > 0 ? `<p class="muted small" style="margin-top:.75rem">Najdłuższa seria: 🔥 ${state.derived.streak.best}</p>` : ''}
    ${E.reportYears(state).length ? `<p class="muted small">Raporty roczne: ${E.reportYears(state).map(y => `<a href="#/raport/${y}">${y}</a>`).join(' · ')}</p>` : ''}
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
    confirmModal(`Usunąć wpis za ${Fmt.formatMonthName(ym)}? Salda i prognoza zostaną przeliczone.`, () => {
      E.deleteEntry(state, ym);
      persist();
      histExpanded = null;
      renderHistory();
      toast('Wpis usunięty, wszystko przeliczone.');
    }, { yesLabel: 'Usuń' });
  }));
  const addBtn = document.getElementById('hist-add-earlier');
  if (addBtn) addBtn.addEventListener('click', () => {
    E.addEarlierMonth(state);
    persist();
    histExpanded = null;
    renderHistory();
    toast('Dodano ' + Fmt.formatMonthName(state.anchorMonth) + ' — uzupełnij go w check-inie.');
  });
  $$('[data-remove-earliest]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const ym = el.dataset.removeEarliest;
    const hasEntry = byMonth.has(ym);
    const doRemove = () => {
      try {
        E.removeEarliestMonth(state);
        persist();
        histExpanded = null;
        renderHistory();
        toast(hasEntry ? 'Miesiąc usunięty, start planu przesunięty.' : 'Usunięto pusty najwcześniejszy miesiąc.');
      } catch (err) {
        toast(err.message, 6000);
      }
    };
    if (hasEntry) confirmModal(`Usunąć miesiąc ${Fmt.formatMonthName(ym)} wraz z jego check-inem i przesunąć start planu? Salda i prognoza zostaną przeliczone.`, doRemove, { yesLabel: 'Usuń' });
    else doRemove();
  }));
}

// ── Raport roczny (#/raport/:year) ──────────────────────────────────────
// Tylko odczyt — markup w analysis.js; zły/pusty rok wraca do Historii.

function renderRaport(yearStr) {
  const year = Number(yearStr);
  const rep = Number.isSafeInteger(year) && year >= 1900 && year <= 2200
    ? E.annualReport(state, year) : null;
  if (!rep) { location.hash = '#/history'; return; }
  view().innerHTML = An.annualReportScreen({ rep, years: E.reportYears(state) });
}

// ── Analiza ─────────────────────────────────────────────────────────────
// Wyniki liczone przy renderze (nie w recomputeDerived — potrzebne tylko tu).

let anMode = 'yearly';
let anYear = 1;
let anSection = 'przeglad';   // sekcja Analizy: przeglad | prognoza | dozera | kredyty
let anDeathAge = 110;         // „Do zera": wiek dożycia (efemeryczny, domyślnie 110)
let anDzZus = true;           // „Do zera": uwzględniaj emeryturę ZUS (efemeryczny)

function renderAnaliza() {
  if (!state.derived) E.recomputeDerived(state);
  const d = state.derived;
  const a = state.assumptions;
  const nowYm = E.todayYm();
  const proj = d.projection;
  const houseOn = !!(state.housing.housePlan && state.housing.housePlan.enabled);
  const hp = state.housing.housePlan;

  // Analityka kredytów — potrzebna też do decyzji, czy pokazać zakładkę Kredyty.
  const ma = houseOn && d.debt.started ? E.mortgageAnalytics(state, d.debt, proj) : null;
  const fam = d.family;
  const fa = houseOn && fam && fam.started ? E.familyLoanAnalytics(state, fam, proj) : null;
  const showKredyty = !!(ma || fa);
  if (anSection === 'kredyty' && !showKredyty) anSection = 'przeglad';
  const showPodatki = E.taxesActive(state).any;
  if (anSection === 'podatki' && !showPodatki) anSection = 'przeglad';

  const sections = [['przeglad', 'Przegląd'], ['prognoza', 'Prognoza'], ['dozera', 'Do zera']];
  if (showPodatki) sections.push(['podatki', 'Podatki']);
  if (showKredyty) sections.push(['kredyty', 'Kredyty']);
  const seg = `<div class="seg" role="tablist">${sections.map(([k, l]) =>
    `<button type="button" data-ansection="${k}" class="${anSection === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  let body = '';

  if (anSection === 'przeglad') {
    const fi = E.fiStats(state, d.balances, d.debt, d.plan, nowYm, d.family);
    const cvg = E.contributionsVsGrowth(state, d.balances);
    const sav = E.savingsStats(state, d.uptoYm);
    const pva = E.planVsActualStats(state.entries);
    // chartSVG skaluje od 0 — skumulowany wykres tylko przy seriach ≥ 0.
    const cumChart = pva.cumRows.length > 1 && pva.cumRows.every(r => r.cumNet >= 0 && r.cumPlanned >= 0)
      ? zoomable('an-plan-cum', 'Skumulowane: odłożone vs plan', o => chartSVG(pva.cumRows, [
        { get: r => r.cumPlanned, cls: 'line-target', label: 'plan' },
        { get: r => r.cumNet, cls: 'line-port', label: 'odłożone' },
      ], o), { legendHTML: An.cumLegend() })
      : '';
    body = An.statsCard({ fi, cvg, balances: d.balances, a, nowYm })
      + An.planPerfCard({ sav, pva, chartHTML: cumChart });
  } else if (anSection === 'prognoza') {
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
    const wChart = w.rows.length > 1
      ? zoomable('an-wyplaty', 'Faza wypłat: saldo portfela', o => chartSVG(w.rows, [
        { get: r => r.endNominal, cls: 'line-proj', label: 'nominalnie' },
        { get: r => r.endReal, cls: 'line-port', label: 'realnie' },
      ], o), { legendHTML: An.withdrawalLegend() })
      : '';

    // Most ZUS: karta statyczna, tylko przy włączonej emeryturze i dacie
    // urodzenia (bez niej wiek emerytalny jest nieobliczalny → null).
    const bridgeCard = a.pensionMonthly > 0 && state.profile.birthDate
      ? An.pensionBridgeCard({ pb: E.projectBridgeFire(state, { projection: proj }) })
      : '';

    body = goalSavingsHTML(E.requiredSavingsForGoal(state))
      + An.projectionCard({
        mode: anMode, blocks, series: proj.series, excelRows, houseOn,
        selectedYear: anYear, fireYm: proj.reached ? proj.fireYm : null,
        excelStart: d.balances.portfolio, excelContrib,
        byPlanOnly: proj.byPlanOnly, delta: proj.delta,
        hasFamily: !!fa,
      })
      + An.withdrawalCard({ w, chartHTML: wChart })
      + bridgeCard
      + An.sensitivityCard({ baseFireYm, returnRows, savingsRows, swrRows });
  } else if (anSection === 'dozera') {
    body = An.dieWithZeroCard({
      resultHTML: dwzResultHTML(proj),
      deathAge: anDeathAge,
      zusOn: anDzZus, pensionMonthly: a.pensionMonthly, pensionAge: a.pensionAge,
    });
  } else if (anSection === 'podatki') {
    // Najwyżej dwa dodatkowe pełne przebiegi prognozy (bez Belki / bez
    // IKE-IKZE) — tańsze niż istniejąca karta wrażliwości (13 przebiegów).
    const ts = E.taxStats(state, d.balances, nowYm);
    const withYm = proj.reached ? proj.fireYm : null;
    const noBelka = ts.active.belka
      ? E.projectionWith(state, { taxes: { belkaEnabled: false } }) : null;
    const noIke = ts.active.ikeIkze
      ? E.projectionWith(state, { taxes: { ikeIkze: { enabled: false } } }) : null;
    body = (ts.active.belka ? An.belkaCard({
      ts,
      fireWith: withYm,
      fireWithout: noBelka.reached ? noBelka.fireYm : null,
    }) : '')
      + (ts.active.ikeIkze ? An.ikeIkzeCard({
        ts,
        fireWith: withYm,
        fireWithout: noIke.reached ? noIke.fireYm : null,
        pitRate: state.taxes.ikeIkze.pitRate,
        employmentForm: state.taxes.ikeIkze.employmentForm,
      }) : '');
  } else {
    // ── Kredyty ──
    // Wykres topnienia salda (sama rata vs z nadpłatami) — wspólny dla kredytu
    // i długu rodzinnego; realField wskazuje pole realne w serii prognozy.
    const meltChart = (analytics, loanRes, realField, zoom) => {
      if (!analytics || loanRes.rows.length <= 1) return '';
      const histBy = new Map(loanRes.rows.map(r => [r.ym, r.balNominal]));
      const schedBy = new Map(analytics.scheduleRows.map((r, i) => [E.addMonths(analytics.lastYm, i + 1), r.balNominal]));
      const projBy = new Map(proj.series.filter(r => r.projected)
        .map(r => [r.ym, E.toNominal(r[realField] || 0, state.anchorMonth, r.ym, a.inflationAnnual)]));
      const start = E.ymToIdx(loanRes.rows[0].ym);
      const end = E.ymToIdx(analytics.lastYm) + analytics.scheduleRows.length;
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
      return rows.length > 1
        ? zoomable(zoom.key, zoom.title, o => chartSVG(rows, [
          { get: r => r.sched, cls: 'line-debt-dash', label: 'sama rata' },
          { get: r => r.over, cls: 'line-debt', label: 'z nadpłatami' },
        ], o), { legendHTML: An.meltLegend() })
        : '';
    };
    // Słupki kapitał/odsetki wg kontraktu (deterministyczne, bez nadpłat).
    const piBars = (rows, zoom) => rows.length
      ? zoomable(zoom.key, zoom.title, o => stackedBarSVG(rows, [
        { get: r => r.principal, cls: 'bar-principal', label: 'kapitał' },
        { get: r => r.interest, cls: 'bar-interest', label: 'odsetki' },
      ], o), { legendHTML: An.barLegend() })
      : '';

    // Słupki „ile zostało do spłaty": kapitał NA odsetkach (odwrotnie niż
    // struktura rat), kontrakt jako blade tło obok pełnej ścieżki faktycznej.
    const remainingBars = (analytics, loanRes, realField, contractRows, principal, zoom) => {
      if (!analytics || !contractRows.length) return '';
      const actual = E.loanPathWithProjection(state, loanRes, proj, realField, analytics.rateMonthly);
      const rows = E.remainingToPayComparison(principal, contractRows, actual);
      return rows.length
        ? zoomable(zoom.key, zoom.title, o => stackedBarSVG(rows, [
          { get: r => r.cInterest, cls: 'bar-interest-ghost', group: 0, label: 'odsetki (kontrakt)' },
          { get: r => r.cPrincipal, cls: 'bar-principal-ghost', group: 0, label: 'kapitał (kontrakt)' },
          { get: r => r.aInterest, cls: 'bar-interest', group: 1, label: 'odsetki (z nadpłatami)' },
          { get: r => r.aPrincipal, cls: 'bar-principal', group: 1, label: 'kapitał (z nadpłatami)' },
        ], o), { legendHTML: An.remainingLegend(zoom.overLabel) })
        : '';
    };

    // Harmonogramy kontraktowe liczone raz — współdzielone przez oba wykresy.
    const mtgSched = ma ? E.amortizationSchedule(hp.mortgage) : [];
    const flSched = fa && hp.familyLoan
      ? E.amortizationScheduleN(hp.familyLoan.principal, hp.familyLoan.rateNominal, E.familyLoanTermMonths(hp.familyLoan), hp.familyLoan.paymentOverrideMonthly)
      : [];
    const debtChart = meltChart(ma, d.debt, 'debtReal', { key: 'an-mtg-melt', title: 'Kredyt: saldo — sama rata vs z nadpłatami' });
    const mtgBar = mtgSched.length ? piBars(E.yearlyPrincipalInterest(mtgSched), { key: 'an-mtg-raty', title: 'Kredyt: struktura rat' }) : '';
    const familyChart = meltChart(fa, fam, 'familyReal', { key: 'an-fl-melt', title: 'Dług rodzinny: saldo — sama rata vs z nadpłatami' });
    const flBar = flSched.length ? piBars(E.yearlyPrincipalInterest(flSched), { key: 'an-fl-raty', title: 'Dług rodzinny: struktura rat' }) : '';
    const mtgRemaining = ma ? remainingBars(ma, d.debt, 'debtReal', mtgSched, hp.mortgage.principal, { key: 'an-mtg-dozaplaty', title: 'Kredyt: ile zostało do spłaty', overLabel: 'z nadpłatami (pełne)' }) : '';
    const flRemaining = fa ? remainingBars(fa, fam, 'familyReal', flSched, hp.familyLoan.principal, { key: 'an-fl-dozaplaty', title: 'Dług rodzinny: ile zostało do spłaty', overLabel: 'z nadpłatami (tylko jawne z check-inu)' }) : '';

    body = (ma ? An.mortgageCard({ ma, chartHTML: debtChart, barHTML: mtgBar, remainingBarHTML: mtgRemaining }) : '')
      + (fa ? An.familyLoanCard({ fa, chartHTML: familyChart, barHTML: flBar, remainingBarHTML: flRemaining }) : '');
  }

  view().innerHTML = seg + body;

  $$('[data-ansection]').forEach(el => el.addEventListener('click', () => {
    anSection = el.dataset.ansection;
    renderAnaliza();
  }));
  $$('[data-anmode]').forEach(el => el.addEventListener('click', () => {
    anMode = el.dataset.anmode;
    renderAnaliza();
  }));
  const yearSel = $('#an-year');
  if (yearSel) yearSel.addEventListener('change', () => {
    anYear = Number(yearSel.value) || 1;
    renderAnaliza();
  });
  // „Do zera": oba handlery (wiek, checkbox ZUS) podmieniają tylko #dwz-result
  // przez wspólne dwzResultHTML — pola i fokus przeżywają zmianę.
  const dwzSwap = () => { const dz = $('#dwz-result'); if (dz) dz.innerHTML = dwzResultHTML(proj); };
  const da = $('#an-death-age');
  if (da) da.addEventListener('input', () => {
    const v = Math.floor(Number(da.value));
    anDeathAge = Number.isFinite(v) && v > 0 ? v : 110;
    dwzSwap();
  });
  const dzZus = $('#an-dwz-zus');
  if (dzZus) dzZus.addEventListener('change', () => {
    anDzZus = dzZus.checked;
    dwzSwap();
  });
}

// „Do zera": wynik + wykres — współdzielone przez pierwszy render i oba
// handlery (wiek dożycia, checkbox ZUS). Checkbox wyłącza emeryturę przez
// override `pension: null` w retirementOpts — nic nie zapisujemy.
function dwzResultHTML(proj) {
  const ro = E.retirementOpts(state, anDzZus ? {} : { pension: null });
  const z = E.projectDieWithZero(state, { deathAge: anDeathAge, projection: proj, ro });
  const zChart = z && z.rows.length > 1
    ? zoomable('an-dozera', 'Do zera: saldo portfela', o => chartSVG(z.rows, [
      { get: r => r.endNominal, cls: 'line-proj', label: 'nominalnie' },
      { get: r => r.endReal, cls: 'line-port', label: 'realnie' },
    ], o), { legendHTML: An.withdrawalLegend() })
    : '';
  return An.dieWithZeroResult({ z }) + zChart;
}

// ── Symulacja (#/symulacja — hub, #/symulacja/:calc — kalkulator) ───────
// Kalkulatory motywacyjne: hub-lista (wzorzec Planu) + osobna pod-strona na
// każdy kalkulator. Wejścia przeżywają nawigację (stan modułu); wyniki
// podmieniane w #…-result, by nie gubić fokusu/uchwytu.

let simMonth = '';        // Co jeśli?: miesiąc
let simAmount = '';       // Co jeśli?: kwota
let simRecurring = false; // Co jeśli?: jednorazowo/co miesiąc
let symAge = '';          // Cel: wiek FIRE
let symLatte = '';        // Efekt małych wydatków
let symMore = null;       // Suwak „oszczędzaj więcej" (zł/mies.)
let symReturn = null;     // Suwak „wpływ zwrotu" (realny zwrot roczny, ułamek)
let symOverpay = 500;     // Suwak „nadpłata kredytu" (zł/mies.)
let symOverpayLoan = 'mortgage'; // Nadpłata: który kredyt (mortgage/family)
let symLoanP = null;   // Kalkulator kredytu: kwota (null = użyj seeda)
let symLoanR = null;   // Kalkulator kredytu: oprocentowanie roczne % (null = seed)
let symLoanT = null;   // Kalkulator kredytu: okres w latach (null = seed)
let symLoanOp = 0;     // Kalkulator kredytu: nadpłata zł/mies.
let symRetPost = null; // Emerytura: zwrot po FIRE (ułamek; null = z ustawień)
let symRetFreeze = null; // Emerytura: mrożenie wydatków po FIRE (null = z ustawień)
let symRetPension = null; // Emerytura: ZUS zł/mies. (string; null = z ustawień)
let symRetPage = null;    // Emerytura: wiek emerytalny (string; null = z ustawień)
let symCrashPct = '30'; // Krach: % spadku portfela
let symCrashAge = '90'; // Krach: dożywam do wieku
let symBarista = '';    // Barista: dorabiane zł/mies. (string)
let symBaristaAge = ''; // Barista: dorabiam do wieku (string)

const SYM_CAP = 100000;   // górny limit dopłaty w „Cel: wiek FIRE"

// Nadpłata ma sens tylko przy aktywnym (saldo > 0) kredycie lub długu rodzinnym
// — wspólna decyzja huba (czy pokazać pozycję) i routera (czy wpuścić na stronę).
function symNadplataAvailable() {
  const d = state.derived;
  const houseOn = !!(state.housing.housePlan && state.housing.housePlan.enabled);
  return houseOn && !!((d.debt && d.debt.active) || (d.family && d.family.active));
}

const SYM_CALCS = [
  ['cojesli', '🧪', 'Co jeśli?', 'wpływ jednorazowej lub comiesięcznej dopłaty na datę FIRE'],
  ['wiek', '🎯', 'Cel: wiek FIRE', 'ile odkładać, by zdążyć na wybrany wiek'],
  ['latte', '☕', 'Efekt małych wydatków', 'co daje obcięcie drobnych stałych wydatków'],
  ['wiecej', '💪', 'Oszczędzaj więcej', 'o ile wcześniej osiągniesz FIRE'],
  ['zwrot', '📊', 'Wpływ zwrotu', 'jak inny zwrot z inwestycji przesuwa FIRE'],
  ['emerytura', '🏖️', 'Emerytura po FIRE', 'zwrot po FIRE, mrożenie wydatków i emerytura ZUS'],
  ['barista', '☕', 'Barista FIRE', 'dorabianie po FIRE — mniejszy portfel, FIRE bliżej'],
  ['krach', '📉', 'Test krachu', 'co krach rynkowy zrobi z Twoją emeryturą'],
  ['kredyt', '🧮', 'Kalkulator kredytu', 'rata, odsetki i efekt nadpłat dowolnego kredytu'],
  ['nadplata', '💸', 'Nadpłata kredytu', 'ile oszczędzasz, nadpłacając swój kredyt'],
];

function renderSymulacjaHub() {
  if (!state.derived) E.recomputeDerived(state);
  const showNadplata = symNadplataAvailable();
  const items = SYM_CALCS.filter(([k]) => k !== 'nadplata' || showNadplata);
  view().innerHTML = `<div class="card"><h2>Symulacja 🔮</h2>
    <p class="muted small">Kalkulatory „co by było, gdyby” — niczego nie zapisują i nie zmieniają planu.</p>
    <div class="hub">${items.map(([k, ic, t, s]) =>
      `<button type="button" class="hub-item" data-go="#/symulacja/${k}">
        <span class="hub-ic">${ic}</span>
        <span class="hub-txt"><b>${esc(t)}</b><small>${esc(s)}</small></span>
        <span class="hub-arr">›</span>
      </button>`).join('')}</div>
  </div>`;
  $$('[data-go]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; }));
}

const symBack = '<a class="btn ghost wide" href="#/symulacja">← Symulacja</a>';

function renderSymulacja(calc) {
  if (!state.derived) E.recomputeDerived(state);
  // Nieznany kalkulator lub „Nadpłata" bez aktywnego długu → wróć na hub.
  if (!SYM_CALCS.some(([k]) => k === calc) || (calc === 'nadplata' && !symNadplataAvailable())) {
    location.hash = '#/symulacja';
    return;
  }
  const d = state.derived;
  const a = state.assumptions;
  const nowYm = E.todayYm();
  const proj = d.projection;
  const baseFireYm = proj.reached ? proj.fireYm : null;

  // ── Kalkulatory wyników (czyste projectionWith / funkcje silnika) ──
  const whatIfResult = () => {
    const month = simMonth || nowYm;
    if (!E.isValidYm(month) || E.ymToIdx(month) < E.ymToIdx(nowYm)) {
      return '<p class="muted small">Wybierz bieżący lub przyszły miesiąc.</p>';
    }
    const raw = simAmount.trim();
    if (raw === '') return '<p class="muted small">Podaj kwotę, aby zobaczyć wpływ na datę FIRE.</p>';
    const amount = Fmt.parsePLN(raw);
    if (amount == null) return '<div class="field-error">Nieprawidłowa kwota</div>';
    const sim = E.projectionWith(state, { extraSavings: { month, amount, recurring: simRecurring } });
    return Sim.simulationResult({ baseFireYm, sim, month });
  };

  const targetAgeResult = () => {
    const raw = String(symAge).trim();
    const ageYears = raw === '' ? a.targetFireAge : Fmt.parsePLN(raw);
    if (ageYears == null || ageYears <= 0) return '<div class="field-error">Podaj docelowy wiek.</div>';
    const currentAge = E.ageAt(state.profile.birthDate, nowYm).years;
    if (ageYears <= currentAge) return `<p class="muted small">Podaj wiek większy niż Twój obecny (${currentAge}).</p>`;
    const sol = E.solveExtraSavingsForAge(state, Math.round(ageYears * 12), { cap: SYM_CAP });
    const plannedNow = E.plannedSavingsFor(d.plan, nowYm);
    return Sim.targetAgeResult({ sol, ageYears, plannedNow, baseFireYm, cap: SYM_CAP });
  };

  const latteResult = () => {
    const raw = String(symLatte).trim();
    if (raw === '') return '<p class="muted small">Podaj miesięczną kwotę, aby zobaczyć efekt.</p>';
    const amount = Fmt.parsePLN(raw);
    if (amount == null || amount <= 0) return '<div class="field-error">Podaj dodatnią kwotę.</div>';
    const fv = y => E.futureValueOfMonthly(amount, a.realReturnAnnual, y);
    const sim = E.projectionWith(state, { extraMonthlySavings: amount });
    return Sim.latteResult({ amount, fv10: fv(10), fv20: fv(20), fv30: fv(30), sim, baseFireYm });
  };

  const moreMax = Math.max(1000, Math.round((a.monthlyIncome || 0) / 100) * 100);
  const moreResult = () => {
    const extra = symMore == null ? 0 : Number(symMore);
    if (!extra) return '<p class="muted small">Przesuń suwak, aby zobaczyć, o ile wcześniej osiągniesz FIRE.</p>';
    const sim = E.projectionWith(state, { extraMonthlySavings: extra });
    return Sim.moreSavingsResult({ extra, sim, baseFireYm });
  };

  // ── Nadpłata kredytu: analityka tylko dla aktywnych (saldo > 0) długów ──
  const hp = state.housing.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const opMa = houseOn && d.debt.active ? E.mortgageAnalytics(state, d.debt, proj) : null;
  const opFa = houseOn && d.family && d.family.active ? E.familyLoanAnalytics(state, d.family, proj) : null;
  const opLoans = [
    ...(opMa ? [{ key: 'mortgage', label: 'Kredyt 🏠' }] : []),
    ...(opFa ? [{ key: 'family', label: 'Dług rodzinny 👨‍👩‍👧' }] : []),
  ];
  if (symOverpayLoan === 'family' ? !opFa : !opMa) symOverpayLoan = opLoans.length ? opLoans[0].key : 'mortgage';

  const overpayResult = () => {
    const an = symOverpayLoan === 'family' ? opFa : opMa;
    if (!an) return '';
    const raw = symOverpay == null ? '' : String(symOverpay);
    const X = raw.trim() === '' ? 0 : Fmt.parsePLN(raw);
    if (X == null || X < 0) return '<div class="field-error">Podaj nadpłatę: 0 lub więcej.</div>';
    const base = E.remainingSchedule(an.balanceNominal, an.rateMonthly, an.payment);
    const sim = E.remainingSchedule(an.balanceNominal, an.rateMonthly, an.payment, X);
    const chartRows = E.remainingToPayComparison(an.balanceNominal, base.rows, sim.rows);
    const chartHTML = chartRows.length
      ? zoomable('sym-nadplata', 'Nadpłata: ile zostało do spłaty', o => stackedBarSVG(chartRows, [
        { get: r => r.cInterest, cls: 'bar-interest-ghost', group: 0, label: 'odsetki (kontrakt)' },
        { get: r => r.cPrincipal, cls: 'bar-principal-ghost', group: 0, label: 'kapitał (kontrakt)' },
        { get: r => r.aInterest, cls: 'bar-interest', group: 1, label: 'odsetki (z nadpłatami)' },
        { get: r => r.aPrincipal, cls: 'bar-principal', group: 1, label: 'kapitał (z nadpłatami)' },
      ], o), { legendHTML: Sim.remainingCmpLegend() })
      : '';
    return Sim.overpaymentResult({
      amount: X,
      basePayoffYm: E.addMonths(an.lastYm, base.months),
      payoffYm: E.addMonths(an.lastYm, sim.months),
      monthsSaved: base.months - sim.months,
      interestSaved: base.totalInterest - sim.totalInterest,
      chartHTML,
    });
  };

  // ── Kalkulator kredytu (hipotetyczny): seed z planowanego kredytu hip. ──
  const mtg = hp && hp.mortgage;
  const seedP = mtg && mtg.principal > 0 ? mtg.principal : 500000;
  const seedR = mtg && mtg.principal > 0 ? Math.round(mtg.rateNominal * 1000) / 10 : 7; // % z ułamka
  const seedT = mtg && mtg.principal > 0 ? mtg.termYears : 25;
  const loanP = symLoanP != null ? symLoanP : String(seedP);
  const loanR = symLoanR != null ? symLoanR : String(seedR);
  const loanT = symLoanT != null ? symLoanT : String(seedT);

  const loanCalcResult = () => {
    // Odczyt na żywo (nie z const loanP/… zamrożonych przy renderze), by edycja
    // pól tekstowych odświeżała wynik bez pełnego re-renderu. Seed jak wyżej.
    const lp = symLoanP != null ? symLoanP : String(seedP);
    const lr = symLoanR != null ? symLoanR : String(seedR);
    const lt = symLoanT != null ? symLoanT : String(seedT);
    const P = Fmt.parsePLN(lp), R = Fmt.parsePLN(lr), T = Fmt.parsePLN(lt);
    if (P == null || R == null || T == null) return '<div class="field-error">Uzupełnij poprawnie wszystkie pola.</div>';
    if (!(P > 0)) return '<p class="muted small">Podaj dodatnią kwotę kredytu.</p>';
    if (R < 0) return '<div class="field-error">Oprocentowanie nie może być ujemne.</div>';
    if (!(T > 0)) return '<p class="muted small">Podaj okres kredytu w latach.</p>';
    const j = E.monthlyRate(R / 100);
    const N = Math.round(T * 12);
    if (!(N > 0)) return '<p class="muted small">Podaj okres kredytu w latach.</p>'; // annuityPayment rzuca dla N<=0
    const payment = E.annuityPayment(P, j, N);
    const rawOp = symLoanOp == null ? '' : String(symLoanOp);
    const extra = rawOp.trim() === '' ? 0 : Fmt.parsePLN(rawOp);
    if (extra == null || extra < 0) return '<div class="field-error">Podaj nadpłatę: 0 lub więcej.</div>';
    const base = E.remainingSchedule(P, j, payment);
    const sim = extra > 0 ? E.remainingSchedule(P, j, payment, extra) : base;
    const chartRows = E.remainingToPayComparison(P, base.rows, sim.rows);
    const chartHTML = chartRows.length
      ? zoomable('sym-kredyt', 'Kalkulator kredytu: ile zostało do spłaty', o => stackedBarSVG(chartRows, [
        { get: r => r.cInterest, cls: 'bar-interest-ghost', group: 0, label: 'odsetki (kontrakt)' },
        { get: r => r.cPrincipal, cls: 'bar-principal-ghost', group: 0, label: 'kapitał (kontrakt)' },
        { get: r => r.aInterest, cls: 'bar-interest', group: 1, label: 'odsetki (z nadpłatami)' },
        { get: r => r.aPrincipal, cls: 'bar-principal', group: 1, label: 'kapitał (z nadpłatami)' },
      ], o), { legendHTML: Sim.remainingCmpLegend() })
      : '';
    return Sim.loanCalcResult({
      payment, baseMonths: base.months, extra, simMonths: sim.months,
      baseInterest: base.totalInterest, interestSaved: base.totalInterest - sim.totalInterest, chartHTML,
    });
  };

  const retMin = Math.round((a.realReturnAnnual - 0.03) * 1000) / 1000;
  const retMax = Math.round((a.realReturnAnnual + 0.03) * 1000) / 1000;
  const returnResult = () => {
    const newReturn = symReturn == null ? a.realReturnAnnual : Number(symReturn);
    const sim = Math.abs(newReturn - a.realReturnAnnual) < 1e-9
      ? proj
      : E.projectionWith(state, { assumptions: { realReturnAnnual: newReturn } });
    return Sim.returnResult({ newReturn, baseReturn: a.realReturnAnnual, sim, baseFireYm });
  };

  const retirementResult = () => {
    const overrides = {};
    if (symRetPost != null) overrides.postReturnReal = Number(symRetPost);
    if (symRetFreeze != null) overrides.freezeExpenses = symRetFreeze;
    // ZUS: puste pole = wartość z ustawień; zawsze przekazujemy efektywny
    // obiekt (symetria baza/override — równy ustawieniom, gdy nietknięte).
    let pMonthly = a.pensionMonthly, pAge = a.pensionAge;
    const rawPension = symRetPension == null ? '' : String(symRetPension).trim();
    if (rawPension !== '') {
      const v = Fmt.parsePLN(rawPension);
      if (v == null || v < 0) return '<div class="field-error">Podaj emeryturę z ZUS: 0 lub więcej.</div>';
      pMonthly = v;
    }
    const rawPage = symRetPage == null ? '' : String(symRetPage).trim();
    if (rawPage !== '') {
      const v = Fmt.parsePLN(rawPage);
      if (v == null || v < 1 || v > 100) return '<div class="field-error">Podaj realny wiek emerytalny (1–100).</div>';
      pAge = Math.round(v);
    }
    overrides.pension = { monthly: pMonthly, fromAge: pAge };
    const ro = E.retirementOpts(state, overrides);
    const dz = E.projectDieWithZero(state, { deathAge: 90, projection: proj, ro });
    const dzBase = E.projectDieWithZero(state, { deathAge: 90, projection: proj });
    const w = E.projectWithdrawal(state, { projection: proj, ro });
    const pb = E.projectBridgeFire(state, { projection: proj, ro });
    return Sim.retirementResult({ ro, dz, dzBase, w, pb, deathAge: 90 });
  };

  // Barista: override niesie TYLKO baristę — zapisana emerytura i ustawienia po
  // FIRE jadą w obu ro, więc porównanie izoluje sam efekt dorabiania.
  const baristaResult = () => {
    if (!state.profile.birthDate) return '<p class="muted">Uzupełnij datę urodzenia w Plan → Profil, aby policzyć wariant Barista.</p>';
    const rawA = String(symBarista).trim(), rawW = String(symBaristaAge).trim();
    if (rawA === '' || rawW === '') return '<p class="muted small">Podaj kwotę i wiek, aby zobaczyć efekt dorabiania.</p>';
    const amount = Fmt.parsePLN(rawA);
    if (amount == null || amount < 0) return '<div class="field-error">Podaj kwotę: 0 lub więcej.</div>';
    const ageY = Fmt.parsePLN(rawW);
    if (ageY == null || ageY <= 0 || ageY > 100) return '<div class="field-error">Podaj realny wiek (1–100).</div>';
    const currentAge = E.ageAt(state.profile.birthDate, nowYm).years;
    if (ageY <= currentAge) return `<p class="muted small">Podaj wiek większy niż Twój obecny (${currentAge}).</p>`;
    const ro = E.retirementOpts(state, { barista: { monthly: amount, untilAge: Math.round(ageY) } });
    const pb = E.projectBridgeFire(state, { projection: proj, ro });
    const pbBase = E.projectBridgeFire(state, { projection: proj });
    return Sim.baristaResult({ pb, pbBase, amount, untilAge: Math.round(ageY) });
  };

  const crashResult = () => {
    const pct = Fmt.parsePLN(symCrashPct);
    if (pct == null || pct <= 0 || pct >= 100) return '<div class="field-error">Podaj spadek w procentach (między 0 a 100).</div>';
    const deathAge = Fmt.parsePLN(symCrashAge);
    if (deathAge == null || deathAge <= 0) return '<div class="field-error">Podaj wiek.</div>';
    const st = E.stressTestRetirement(state, { projection: proj, shockPct: pct / 100, shockYears: [1, 10], deathAge });
    if (st && deathAge <= st.startAge) return `<div class="field-error">Podaj wiek większy niż wiek w chwili FIRE (${st.startAge} lat).</div>`;
    return Sim.crashResult({ st });
  };

  let body = '';
  if (calc === 'cojesli') {
    body = Sim.whatIfCard({ nowYm, month: simMonth || nowYm, amount: simAmount, recurring: simRecurring, resultHTML: whatIfResult() });
  } else if (calc === 'wiek') {
    body = Sim.targetAgeCard({ ageValue: symAge, defaultAge: a.targetFireAge, resultHTML: targetAgeResult() });
  } else if (calc === 'latte') {
    body = Sim.latteCard({ amountValue: symLatte, resultHTML: latteResult() });
  } else if (calc === 'wiecej') {
    body = Sim.moreSavingsCard({ value: symMore, max: moreMax, resultHTML: moreResult() });
  } else if (calc === 'kredyt') {
    body = Sim.loanCalcCard({ principal: loanP, rate: loanR, term: loanT, amount: symLoanOp, resultHTML: loanCalcResult() });
  } else if (calc === 'nadplata') {
    body = Sim.overpaymentCard({ loans: opLoans, activeLoan: symOverpayLoan, amount: symOverpay, resultHTML: overpayResult() });
  } else if (calc === 'emerytura') {
    body = Sim.retirementCard({
      value: symRetPost == null ? a.postRetirementReturnReal : Number(symRetPost),
      base: a.postRetirementReturnReal,
      freeze: symRetFreeze == null ? a.freezeExpensesAtRetirement : symRetFreeze,
      pension: symRetPension == null ? moneyVal(a.pensionMonthly) : symRetPension,
      pensionAge: symRetPage == null ? String(a.pensionAge) : symRetPage,
      resultHTML: retirementResult(),
    });
  } else if (calc === 'barista') {
    body = Sim.baristaCard({ amount: symBarista, untilAge: symBaristaAge, resultHTML: baristaResult() });
  } else if (calc === 'krach') {
    body = Sim.crashCard({ pct: symCrashPct, deathAge: symCrashAge, resultHTML: crashResult() });
  } else {
    body = Sim.returnCard({ value: symReturn, min: retMin, max: retMax, baseReturn: a.realReturnAnnual, resultHTML: returnResult() });
  }

  // Kalkulatory dokładające kwotę do planu — przypomnij, że liczy się sama
  // nadwyżka. Nie dotyczy „Zwrotu", „Nadpłaty", „Kredytu", „Emerytury",
  // „Baristy" ani „Krachu" (czyste podglądy — nic nie dokładają do planu).
  const note = calc === 'zwrot' || calc === 'nadplata' || calc === 'kredyt' || calc === 'emerytura' || calc === 'barista' || calc === 'krach' ? '' : Sim.nadwyzkaNote();

  view().innerHTML = symBack + body + note + symBack;

  if (calc === 'cojesli') {
    const refresh = () => { const r = $('#sim-result'); if (r) r.innerHTML = whatIfResult(); };
    const simM = $('#sim-month');
    if (simM) simM.addEventListener('change', () => { simMonth = simM.value; refresh(); });
    const simA = $('#sim-amount');
    if (simA) simA.addEventListener('input', () => { simAmount = simA.value; refresh(); });
    $$('[data-simmode]').forEach(el => el.addEventListener('click', () => {
      simRecurring = el.dataset.simmode === 'from';
      $$('[data-simmode]').forEach(b => b.classList.toggle('on', b === el));
      refresh();
    }));
  } else if (calc === 'wiek') {
    const ageEl = $('#sym-age');
    if (ageEl) ageEl.addEventListener('input', () => { symAge = ageEl.value; $('#sym-age-result').innerHTML = targetAgeResult(); });
  } else if (calc === 'latte') {
    const latteEl = $('#sym-latte');
    if (latteEl) latteEl.addEventListener('input', () => { symLatte = latteEl.value; $('#sym-latte-result').innerHTML = latteResult(); });
  } else if (calc === 'wiecej') {
    const moreEl = $('#sym-more');
    if (moreEl) moreEl.addEventListener('input', () => {
      symMore = moreEl.value;
      $('#sym-more-val').textContent = Fmt.formatPLN(Number(symMore));
      $('#sym-more-result').innerHTML = moreResult();
    });
  } else if (calc === 'kredyt') {
    const refresh = () => { const r = $('#sym-loan-result'); if (r) r.innerHTML = loanCalcResult(); };
    const pEl = $('#sym-loan-principal'); if (pEl) pEl.addEventListener('input', () => { symLoanP = pEl.value; refresh(); });
    const rEl = $('#sym-loan-rate'); if (rEl) rEl.addEventListener('input', () => { symLoanR = rEl.value; refresh(); });
    const tEl = $('#sym-loan-term'); if (tEl) tEl.addEventListener('input', () => { symLoanT = tEl.value; refresh(); });
    const opEl = $('#sym-loan-op');
    if (opEl) opEl.addEventListener('input', () => {
      symLoanOp = opEl.value;
      $('#sym-loan-result').innerHTML = loanCalcResult();
    });
  } else if (calc === 'nadplata') {
    const opEl = $('#sym-overpay');
    if (opEl) opEl.addEventListener('input', () => {
      symOverpay = opEl.value;
      $('#sym-overpay-result').innerHTML = overpayResult();
    });
    $$('[data-oploan]').forEach(el => el.addEventListener('click', () => {
      symOverpayLoan = el.dataset.oploan;
      renderSymulacja('nadplata');
    }));
  } else if (calc === 'emerytura') {
    const postEl = $('#sym-ret-post');
    if (postEl) postEl.addEventListener('input', () => {
      symRetPost = postEl.value;
      $('#sym-ret-post-val').textContent = Fmt.formatPct(Number(symRetPost));
      $('#sym-ret-result').innerHTML = retirementResult();
    });
    const freezeEl = $('#sym-ret-freeze');
    if (freezeEl) freezeEl.addEventListener('change', () => {
      symRetFreeze = freezeEl.checked;
      $('#sym-ret-result').innerHTML = retirementResult();
    });
    const pensEl = $('#sym-ret-pension');
    if (pensEl) pensEl.addEventListener('input', () => {
      symRetPension = pensEl.value;
      $('#sym-ret-result').innerHTML = retirementResult();
    });
    const pageEl = $('#sym-ret-page');
    if (pageEl) pageEl.addEventListener('input', () => {
      symRetPage = pageEl.value;
      $('#sym-ret-result').innerHTML = retirementResult();
    });
  } else if (calc === 'barista') {
    const refresh = () => { const r = $('#sym-barista-result'); if (r) r.innerHTML = baristaResult(); };
    const amEl = $('#sym-barista'); if (amEl) amEl.addEventListener('input', () => { symBarista = amEl.value; refresh(); });
    const agEl = $('#sym-barista-age'); if (agEl) agEl.addEventListener('input', () => { symBaristaAge = agEl.value; refresh(); });
  } else if (calc === 'krach') {
    const refresh = () => { const r = $('#sym-crash-result'); if (r) r.innerHTML = crashResult(); };
    const pEl = $('#sym-crash-pct'); if (pEl) pEl.addEventListener('input', () => { symCrashPct = pEl.value; refresh(); });
    const aEl = $('#sym-crash-age'); if (aEl) aEl.addEventListener('input', () => { symCrashAge = aEl.value; refresh(); });
  } else {
    const retEl = $('#sym-return');
    if (retEl) retEl.addEventListener('input', () => {
      symReturn = retEl.value;
      $('#sym-return-val').textContent = Fmt.formatPct(Number(symReturn));
      $('#sym-return-result').innerHTML = returnResult();
    });
  }
}

// ── Ustawienia: hub + pod-strony (#/plan, #/plan/*) ─────────────────────
// Monolityczny formularz rozbity na osobne strony, każda z własnym „Zapisz".
// Zero zmian w silniku — reanchor / recomputeDerived tylko przeniesione.

const planBack = '<a class="btn ghost wide" href="#/plan">← Ustawienia</a>';
const planFail = msg => { $('#plan-error').innerHTML = `<div class="field-error">${esc(msg)}</div>`; window.scrollTo(0, 0); };

function renderPlanHub() {
  const items = [
    ['🎯', 'Profil i FIRE', 'wiek, stopa wypłat, założenia', '#/plan/fire'],
    ['💰', 'Finanse i start planu', 'dochód, wydatki, salda startowe', '#/plan/finanse'],
    ['🏠', 'Mieszkanie i kredyt', 'czynsz, dom, kredyt, dług rodzinny', '#/plan/dom'],
    ['🧾', 'Podatki', 'podatek Belki, IKE i IKZE', '#/plan/podatki'],
    ['📅', 'Zdarzenia jednorazowe', 'planowane duże wydatki i przychody', '#/plan/zdarzenia'],
    ['⚙️', 'Aplikacja', 'motyw', '#/plan/aplikacja'],
    ['🩹', 'Korekty sald', 'wyrównanie gotówki, portfela i długu', '#/plan/korekty'],
    ['📖', 'Słowniczek', 'pojęcia używane w aplikacji', '#/slowniczek'],
    ['💾', 'Kopia zapasowa', 'eksport, import, aktualizacja', '#/backup'],
  ];
  view().innerHTML = `<div class="card"><h2>Ustawienia</h2>
    <div class="hub">${items.map(([ic, t, s, go]) =>
      `<button type="button" class="hub-item" data-go="${go}">
        <span class="hub-ic">${ic}</span>
        <span class="hub-txt"><b>${esc(t)}</b><small>${esc(s)}</small></span>
        <span class="hub-arr">›</span>
      </button>`).join('')}</div>
  </div>`;
  $$('[data-go]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.go; }));
}

// ── Słowniczek (#/slowniczek, #/slowniczek/:term) ──
// Builder jest czysty (glossary.js); tu tylko render + przewinięcie i
// podświetlenie wpisu, gdy weszliśmy z deep-linku #/slowniczek/:term.
// „Wróć" cofa historię (wejścia są i z Planu, i z bloków „Jak to liczymy?");
// przy wejściu bez historii spada na hub Planu.
function renderGlossary(term) {
  view().innerHTML = `<button type="button" id="gl-back" class="btn ghost wide">← Wróć</button>${glossaryScreen()}`;
  $('#gl-back').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.hash = '#/plan';
  });
  if (!term) return;
  const el = document.getElementById('gl-' + term);
  if (!el) return;
  el.classList.add('gl-hit');
  el.scrollIntoView({ block: 'center' });
}

function renderPlanSection(section) {
  if (section === 'fire') renderPlanFire();
  else if (section === 'finanse') renderPlanFinanse();
  else if (section === 'dom') renderPlanDom();
  else if (section === 'podatki') renderPlanPodatki();
  else if (section === 'zdarzenia') renderPlanZdarzenia();
  else if (section === 'aplikacja') renderPlanAplikacja();
  else if (section === 'korekty') renderPlanKorekty();
  else location.hash = '#/plan';
}

// ── Profil i FIRE ──
function renderPlanFire() {
  const a = state.assumptions;
  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Profil i FIRE 🎯</h2>
    ${field({ id: 'pl-birth', label: 'Data urodzenia', type: 'date', value: state.profile.birthDate })}
    ${field({ id: 'pl-fireage', label: 'Docelowy wiek FIRE', value: moneyVal(a.targetFireAge), mode: 'numeric' })}
    <h3>Założenia</h3>
    ${field({ id: 'pl-wr', label: 'Stopa wypłat (WR)', suffix: '%', value: pctVal(a.withdrawalRate), tipText: 'Wskaźnik bezpieczeństwa: ile procent portfela wypłacasz rocznie po FIRE. Niżej = bezpieczniej wobec ryzyka sekwencji złych lat na rynku.' })}
    ${field({ id: 'pl-return', label: 'Realny zwrot z inwestycji', suffix: '%/rok', value: pctVal(a.realReturnAnnual), tipText: 'Zwrot ponad inflację. Wszystko w aplikacji liczone jest w dzisiejszych złotówkach.' })}
    ${field({ id: 'pl-infl', label: 'Inflacja', suffix: '%/rok', value: pctVal(a.inflationAnnual), tipText: 'Służy wyłącznie do przeliczania kredytu (nominalnego kontraktu) na dzisiejsze złotówki.' })}
    ${field({ id: 'pl-gexp', label: 'Realny wzrost wydatków', suffix: '%/rok', value: pctVal(a.expenseGrowthReal), tipText: 'Cel ruchomy: kwota FIRE rośnie razem z planowanym wzrostem stylu życia.' })}
    ${field({ id: 'pl-ginc', label: 'Realny wzrost dochodów', suffix: '%/rok', value: pctVal(a.incomeGrowthReal), tipText: '3% realnie rocznie to ambitne podwyżki. Ustaw 0 dla ostrożnej prognozy.' })}
    ${field({ id: 'pl-cashret', label: 'Realny zwrot z gotówki', suffix: '%/rok', value: pctVal(a.cashReturnReal), tipText: 'Lokaty ≈ inflacja, stąd domyślnie 0% realnie.' })}
    <h3>Po przejściu na FIRE</h3>
    ${field({ id: 'pl-postret', label: 'Realny zwrot po FIRE', suffix: '%/rok', value: pctVal(a.postRetirementReturnReal), tipText: 'Po przejściu na FIRE wiele osób przenosi pieniądze w bezpieczniejsze miejsca, np. obligacje skarbowe. Detaliczne obligacje 10-letnie (EDO) płacą inflację + ok. 2% marży — ta marża to Twój realny zysk. Wpisz, ile ponad inflację ma zarabiać portfel, gdy przestaniesz pracować. Mniejszy zwrot = portfel wolniej się odbudowuje, więc musi być większy na starcie.' })}
    <label class="field"><span class="lbl">
      <input type="checkbox" id="pl-freeze" ${a.freezeExpensesAtRetirement ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
      Wydatki przestają rosnąć po FIRE${tip('Zaznaczone: po przejściu na FIRE Twoje wydatki są stałe w dzisiejszych złotówkach — rosną już tylko z inflacją. Odznaczone: zakładasz, że styl życia drożeje dalej (o „realny wzrost wydatków”) także na emeryturze — to ostrożniejsze założenie, portfel musi być większy.')}</span></label>
    ${field({ id: 'pl-pension', label: 'Prognozowana emerytura z ZUS', suffix: 'zł/mies.',
      value: moneyVal(a.pensionMonthly),
      tipText: 'Kwota w dzisiejszych złotówkach. ZUS co roku wysyła „Informację o stanie konta” z prognozą Twojej hipotetycznej emerytury — przepisz ją tutaj. Domyślnie wpisana jest emerytura minimalna (1978,49 zł od marca 2026). Od wieku emerytalnego ZUS pokryje część Twoich wydatków, więc portfel musi udźwignąć mniej.',
      hint: 'Wpisz 0, aby nie uwzględniać ZUS.' })}
    ${field({ id: 'pl-page', label: 'Wiek emerytalny (ZUS)', value: moneyVal(a.pensionAge), mode: 'numeric',
      tipText: 'Ustawowy wiek emerytalny: 65 lat dla mężczyzn, 60 dla kobiet. Od tego wieku emerytura z ZUS zaczyna dopłacać do Twoich wydatków.' })}
  </div>
  <button id="pl-save" class="primary wide">Zapisz</button>
  ${planBack}`;

  $('#pl-save').addEventListener('click', () => {
    $('#plan-error').innerHTML = '';
    const birth = $('#pl-birth').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return planFail('Podaj datę urodzenia.');
    const specs = [
      ['fireage', () => parseMoney('pl-fireage')],
      ['wr', () => parsePct('pl-wr', { min: 0.001, max: 0.2 })],
      ['ret', () => parsePct('pl-return')],
      ['infl', () => parsePct('pl-infl')],
      ['gexp', () => parsePct('pl-gexp')],
      ['ginc', () => parsePct('pl-ginc')],
      ['cashret', () => parsePct('pl-cashret')],
      ['postret', () => parsePct('pl-postret')],
      ['pension', () => parseMoney('pl-pension')],
      ['page', () => parseMoney('pl-page')],
    ];
    const vals = {};
    for (const [k, get] of specs) { const r = get(); if (r.error) return planFail(`Popraw pola formularza: ${r.error}`); vals[k] = r.value; }
    const age = E.ageAt(birth, E.todayYm()).years;
    if (vals.fireage <= age) return planFail(`Docelowy wiek FIRE musi być większy niż obecny wiek (${age}).`);
    if (vals.page < 1 || vals.page > 100) return planFail('Podaj realny wiek emerytalny (1–100).');
    state.profile.birthDate = birth;
    Object.assign(state.assumptions, {
      targetFireAge: vals.fireage, withdrawalRate: vals.wr, realReturnAnnual: vals.ret,
      inflationAnnual: vals.infl, expenseGrowthReal: vals.gexp, incomeGrowthReal: vals.ginc,
      cashReturnReal: vals.cashret, postRetirementReturnReal: vals.postret,
      freezeExpensesAtRetirement: $('#pl-freeze').checked,
      pensionMonthly: vals.pension, pensionAge: Math.round(vals.page),
    });
    try { E.recomputeDerived(state); } catch (err) { return planFail('Błąd przeliczania: ' + err.message); }
    persist();
    toast('Zapisano profil i założenia.');
    location.hash = '#/plan';
  });
}

// ── Finanse i start planu ──
function renderPlanFinanse() {
  const a = state.assumptions;
  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Finanse 💰</h2>
    ${field({ id: 'pl-income', label: 'Miesięczny dochód netto', suffix: 'zł', value: moneyVal(a.monthlyIncome) })}
    ${field({ id: 'pl-living', label: 'Miesięczne koszty życia', suffix: 'zł', value: moneyVal(a.monthlyLivingExpenses), tipText: 'Bez kosztów mieszkania — czynsz i rata liczone osobno.' })}
  </div>
  <div class="card"><h2>Start planu</h2>
    ${field({ id: 'pl-anchor', label: 'Miesiąc startu planu', type: 'month', value: state.anchorMonth, max: E.todayYm(), tipText: 'Od tego miesiąca liczą się check-iny, salda startowe i krzywe wzrostu. Cofnij go, aby uzupełnić wcześniejsze miesiące.' })}
    ${field({ id: 'pl-cash-start', label: 'Gotówka na starcie', suffix: 'zł', value: moneyVal(a.cashStart) })}
    ${field({ id: 'pl-port-start', label: 'Portfel na starcie', suffix: 'zł', value: moneyVal(a.portfolioStart) })}
    <p class="muted small">Salda startowe to stan z początku miesiąca startu. Po cofnięciu startu ustaw je na stan z nowego miesiąca — inaczej uzupełniane wpisy policzą się podwójnie.</p>
  </div>
  <button id="pl-save" class="primary wide">Zapisz</button>
  <p class="muted small center">Zmiana dochodu lub wydatków przesuwa start krzywych wzrostu na bieżący miesiąc. Historia pozostaje bez zmian.</p>
  ${planBack}`;

  $('#pl-save').addEventListener('click', () => {
    $('#plan-error').innerHTML = '';
    const income = parseMoney('pl-income'); if (income.error) return planFail(`Popraw pola formularza: ${income.error}`);
    const living = parseMoney('pl-living'); if (living.error) return planFail(`Popraw pola formularza: ${living.error}`);
    const cashStart = parseMoney('pl-cash-start'); if (cashStart.error) return planFail(`Popraw pola formularza: ${cashStart.error}`);
    const portStart = parseMoney('pl-port-start'); if (portStart.error) return planFail(`Popraw pola formularza: ${portStart.error}`);
    const anchorNew = $('#pl-anchor').value;
    if (!E.isValidYm(anchorNew)) return planFail('Podaj miesiąc startu planu.');
    if (E.ymToIdx(anchorNew) > E.ymToIdx(E.todayYm())) return planFail('Start planu nie może być w przyszłości.');
    const anchorChanged = anchorNew !== state.anchorMonth;
    const anchorBackward = anchorChanged && E.ymToIdx(anchorNew) < E.ymToIdx(state.anchorMonth);
    const reanchorNeeded = income.value !== a.monthlyIncome || living.value !== a.monthlyLivingExpenses;

    Object.assign(state.assumptions, {
      monthlyIncome: income.value, monthlyLivingExpenses: living.value,
      cashStart: cashStart.value, portfolioStart: portStart.value,
    });
    try {
      if (anchorChanged) {
        // Jawna zmiana startu wygrywa z automatycznym re-kotwiczeniem.
        E.reanchor(state, anchorNew);
        toast(anchorBackward
          ? `Zapisano. Plan startuje od: ${Fmt.formatMonthName(anchorNew)} — wcześniejsze miesiące uzupełnisz w check-inie.`
          : `Zapisano. Start planu przesunięty na ${Fmt.formatMonthName(anchorNew)} — salda startowe przeliczone.`);
      } else if (reanchorNeeded && state.anchorMonth !== E.todayYm()) {
        E.reanchor(state, E.todayYm());
        toast('Zapisano. Krzywe wzrostu wystartowały od nowa od bieżącego miesiąca — historia bez zmian.');
      } else {
        E.recomputeDerived(state);
        toast('Zapisano finanse, wszystko przeliczone.');
      }
    } catch (err) { return planFail('Błąd przeliczania: ' + err.message); }
    persist();
    location.hash = '#/plan';
  });
}

// ── Mieszkanie i kredyt ──
function renderPlanDom() {
  const h = state.housing;
  const hp = h.housePlan;
  const fl = hp.familyLoan || { enabled: false, startMonth: null, endMonth: null, principal: 0, rateNominal: 0, paymentOverrideMonthly: null };

  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Mieszkanie i dom 🏠</h2>
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
      <h3>Dług rodzinny</h3>
      <label class="field"><span class="lbl">
        <input type="checkbox" id="pl-fl" ${fl.enabled ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
        Dodatkowy dług rodzinny (obok kredytu)${tip('Pożyczka od rodziny na budowę domu — stałe oprocentowanie, spłacana równą ratą w oknie [start, koniec]. To drugi nominalny kontrakt w aplikacji (obok kredytu).')}</span>
      </label>
      <div id="pl-fl-fields" ${fl.enabled ? '' : 'hidden'}>
        ${field({ id: 'pl-fl-principal', label: 'Kwota długu rodzinnego', suffix: 'zł', value: moneyVal(fl.principal) })}
        ${field({ id: 'pl-fl-rate', label: 'Oprocentowanie nominalne', suffix: '%', value: pctVal(fl.rateNominal) })}
        ${field({ id: 'pl-fl-start', label: 'Start spłaty', type: 'month', value: fl.startMonth || '', tipText: 'Miesiąc, w którym pojawia się saldo długu (= kwota) i zaczyna się spłata.' })}
        ${field({ id: 'pl-fl-end', label: 'Koniec spłaty', type: 'month', value: fl.endMonth || '', tipText: 'Ostatni miesiąc spłaty (włącznie). Rata równa (annuitet) jest tak dobrana, by dług zniknął dokładnie wtedy.' })}
        <div class="banner info" id="pl-fl-annuity">Rata: —</div>
        ${field({ id: 'pl-fl-override', label: 'Rata ręcznie (opcjonalnie)', suffix: 'zł', value: moneyVal(fl.paymentOverrideMonthly) })}
      </div>
    </div>
  </div>
  <button id="pl-save" class="primary wide">Zapisz</button>
  <p class="muted small center">Zmiana czynszu przesuwa start krzywych wzrostu na bieżący miesiąc. Historia pozostaje bez zmian.</p>
  ${planBack}`;

  const houseCb = $('#pl-house');
  houseCb.addEventListener('change', () => { $('#pl-house-fields').hidden = !houseCb.checked; });
  const flCb = $('#pl-fl');
  if (flCb) flCb.addEventListener('change', () => { $('#pl-fl-fields').hidden = !flCb.checked; });

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

  const flAnnuity = () => {
    const out = $('#pl-fl-annuity');
    if (!out) return;
    const P = Fmt.parsePLN($('#pl-fl-principal').value);
    const r = Fmt.parsePLN($('#pl-fl-rate').value);
    const start = $('#pl-fl-start').value;
    const end = $('#pl-fl-end').value;
    const ov = Fmt.parsePLN($('#pl-fl-override').value);
    if (ov != null) { out.textContent = `Rata (ręczna): ${Fmt.formatPLN(ov)}/mies.`; return; }
    if (P != null && r != null && E.isValidYm(start) && E.isValidYm(end) && E.ymToIdx(end) >= E.ymToIdx(start)) {
      const A = E.familyLoanPayment({ principal: P, rateNominal: r / 100, startMonth: start, endMonth: end, paymentOverrideMonthly: null });
      const N = E.familyLoanTermMonths({ startMonth: start, endMonth: end });
      out.textContent = `Rata wyliczona: ${Fmt.formatPLN(A)}/mies. (${N} mies.)`;
    } else out.textContent = 'Rata: — (uzupełnij kwotę, oprocentowanie i okno spłaty)';
  };
  if ($('#pl-fl-annuity')) {
    ['pl-fl-principal', 'pl-fl-rate', 'pl-fl-start', 'pl-fl-end', 'pl-fl-override'].forEach(id =>
      $('#' + id).addEventListener('input', flAnnuity));
    flAnnuity();
  }

  $('#pl-save').addEventListener('click', () => {
    $('#plan-error').innerHTML = '';
    const rent = parseMoney('pl-rent'); if (rent.error) return planFail(`Popraw pola formularza: ${rent.error}`);
    const houseOn = houseCb.checked;
    let house = null;
    if (houseOn) {
      const start = $('#pl-mtg-start').value;
      const moveIn = $('#pl-movein').value;
      if (!E.isValidYm(start)) return planFail('Podaj miesiąc startu kredytu.');
      if (!E.isValidYm(moveIn)) return planFail('Podaj miesiąc wprowadzki.');
      const P = parseMoney('pl-mtg-principal'); if (P.error || P.value <= 0) return planFail('Podaj kwotę kredytu.');
      const r = parsePct('pl-mtg-rate', { min: 0, max: 0.3 }); if (r.error) return planFail('Popraw oprocentowanie.');
      const T = parseMoney('pl-mtg-term'); if (T.error || T.value <= 0 || T.value > 40) return planFail('Okres kredytu: 1–40 lat.');
      const ov = parseMoney('pl-mtg-override', { required: false }); if (ov.error) return planFail('Popraw ratę ręczną.');
      const hsM = $('#pl-hs-month').value;
      if (hsM && !E.isValidYm(hsM)) return planFail('Nieprawidłowy miesiąc wydatku na dom.');
      const hsA = parseMoney('pl-hs-amount', { required: false }); if (hsA.error) return planFail('Popraw kwotę wydatku na dom.');
      const bizI = parseMoney('pl-biz-income', { required: false }); if (bizI.error) return planFail('Popraw dodatkowy dochód.');
      const bizS = $('#pl-biz-start').value;
      if ((bizI.value || 0) > 0 && !E.isValidYm(bizS)) return planFail('Podaj, od kiedy dodatkowy dochód.');
      let familyLoan = { enabled: false, startMonth: null, endMonth: null, principal: 0, rateNominal: 0, paymentOverrideMonthly: null };
      if ($('#pl-fl') && $('#pl-fl').checked) {
        const flStart = $('#pl-fl-start').value;
        const flEnd = $('#pl-fl-end').value;
        if (!E.isValidYm(flStart)) return planFail('Podaj start spłaty długu rodzinnego.');
        if (!E.isValidYm(flEnd)) return planFail('Podaj koniec spłaty długu rodzinnego.');
        if (E.ymToIdx(flEnd) < E.ymToIdx(flStart)) return planFail('Koniec spłaty długu rodzinnego nie może być przed startem.');
        const flP = parseMoney('pl-fl-principal'); if (flP.error || flP.value <= 0) return planFail('Podaj kwotę długu rodzinnego.');
        const flR = parsePct('pl-fl-rate', { min: 0, max: 0.3 }); if (flR.error) return planFail('Popraw oprocentowanie długu rodzinnego (0–30%).');
        const flOv = parseMoney('pl-fl-override', { required: false }); if (flOv.error) return planFail('Popraw ratę ręczną długu rodzinnego.');
        familyLoan = {
          enabled: true, startMonth: flStart, endMonth: flEnd,
          principal: flP.value, rateNominal: flR.value, paymentOverrideMonthly: flOv.value,
        };
      }
      house = {
        enabled: true,
        moveInMonth: moveIn,
        houseSpend: { month: hsM || start, amount: hsA.value },
        businessIncomeMonthly: bizI.value || 0,
        businessStartMonth: bizS && E.isValidYm(bizS) ? bizS : null,
        mortgage: { startMonth: start, principal: P.value, rateNominal: r.value, termYears: T.value, paymentOverrideMonthly: ov.value },
        familyLoan,
      };
    }

    const rentChanged = rent.value !== h.currentRentMonthly;
    state.housing.currentRentMonthly = rent.value;
    if (houseOn) state.housing.housePlan = house;
    else state.housing.housePlan.enabled = false;

    try {
      if (rentChanged && state.anchorMonth !== E.todayYm()) {
        E.reanchor(state, E.todayYm());
        toast('Zapisano. Krzywe wzrostu wystartowały od nowa od bieżącego miesiąca — historia bez zmian.');
      } else {
        E.recomputeDerived(state);
        toast('Zapisano mieszkanie i kredyt, wszystko przeliczone.');
      }
    } catch (err) { return planFail('Błąd przeliczania: ' + err.message); }
    persist();
    location.hash = '#/plan';
  });
}

// ── Podatki ──
function renderPlanPodatki() {
  const t = state.taxes || { belkaEnabled: false };
  const ik = t.ikeIkze || { enabled: false, employmentForm: 'employee', pitRate: 0.12, ikeStart: 0, ikzeStart: 0 };
  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Podatki 🧾</h2>
    <label class="field"><span class="lbl">
      <input type="checkbox" id="pl-belka" ${t.belkaEnabled ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
      Uwzględniaj podatek Belki (19%)${tip('Podatek od zysków kapitałowych: przy sprzedaży inwestycji płacisz 19% od zysku — od tego, o ile cena sprzedaży przewyższa cenę zakupu. Liczony od kwot nominalnych, bez korekty o inflację — dlatego realnie oddajesz więcej niż 19% realnego zysku. Aplikacja śledzi koszt zakupu Twoich wpłat i sprawdza cel FIRE na portfelu «po podatku».')}</span></label>
    <div class="banner info small">Od 2027 planowana jest reforma OKI (Osobiste Konto Inwestycyjne) — część oszczędności ma być zwolniona z podatku Belki. Aplikacja liczy według przepisów obowiązujących w 2026 r.</div>
    <label class="field"><span class="lbl">
      <input type="checkbox" id="pl-ikeikze" ${ik.enabled ? 'checked' : ''} style="width:20px;height:20px;min-height:0">
      Oszczędzam przez IKE i IKZE${tip('Konta emerytalne z ulgami: IKE — bez podatku Belki przy wypłacie po 60. roku życia; IKZE — wpłaty odliczasz od podatku (zwrot PIT), a wypłatę po 65. roku życia obciąża tylko 10% ryczałtu. Aplikacja wypełnia najpierw limit IKZE, potem IKE, resztę odkłada na zwykłe konto maklerskie.')}</span></label>
    <div id="pl-ike-fields" ${ik.enabled ? '' : 'hidden'}>
      <label class="field"><span class="lbl">Forma zatrudnienia</span>
        <select id="pl-emp">
          <option value="employee" ${ik.employmentForm !== 'selfEmployed' ? 'selected' : ''}>Umowa o pracę</option>
          <option value="selfEmployed" ${ik.employmentForm === 'selfEmployed' ? 'selected' : ''}>Działalność gospodarcza</option>
        </select>
        <div class="hint">Od formy zatrudnienia zależy roczny limit wpłat na IKZE: 11 304 zł (etat) albo 16 956 zł (działalność) — limity z 2026 r.</div>
      </label>
      <label class="field"><span class="lbl">Twoja stawka PIT</span>
        <select id="pl-pit">
          <option value="0.12" ${ik.pitRate !== 0.32 ? 'selected' : ''}>12%</option>
          <option value="0.32" ${ik.pitRate === 0.32 ? 'selected' : ''}>32%</option>
        </select>
        <div class="hint">Tyle procent wpłaconej na IKZE kwoty wraca do Ciebie jako zwrot podatku w kolejnym roku.</div>
      </label>
      ${field({ id: 'pl-ike-start', label: 'Już zgromadzone na IKE', suffix: 'zł', value: moneyVal(ik.ikeStart || 0), hint: 'Część Twojego portfela startowego, która leży na IKE. Zostaw 0, jeśli zaczynasz od zera.' })}
      ${field({ id: 'pl-ikze-start', label: 'Już zgromadzone na IKZE', suffix: 'zł', value: moneyVal(ik.ikzeStart || 0), hint: 'Część Twojego portfela startowego, która leży na IKZE. Zostaw 0, jeśli zaczynasz od zera.' })}
    </div>
  </div>
  <button id="pl-save" class="primary wide">Zapisz</button>
  <p class="muted small">Gdy podatek Belki jest wyłączony, IKE nie zmienia prognozy — jego zaletą jest właśnie brak Belki. IKZE działa niezależnie (zwrot PIT i 10% ryczałtu przy wypłacie).</p>
  ${planBack}`;

  $('#pl-ikeikze').addEventListener('change', e => { $('#pl-ike-fields').hidden = !e.target.checked; });

  $('#pl-save').addEventListener('click', () => {
    $('#plan-error').innerHTML = '';
    const ikeStart = parseMoney('pl-ike-start', { required: false });
    const ikzeStart = parseMoney('pl-ikze-start', { required: false });
    if (ikeStart.error || ikzeStart.error) {
      return planFail('Popraw kwoty zgromadzone na IKE/IKZE.');
    }
    const iS = ikeStart.value != null ? ikeStart.value : 0;
    const zS = ikzeStart.value != null ? ikzeStart.value : 0;
    if (iS + zS > state.assumptions.portfolioStart) {
      return planFail(`Środki na IKE i IKZE nie mogą łącznie przekraczać portfela startowego (${Fmt.formatPLN(state.assumptions.portfolioStart)}).`);
    }
    state.taxes = {
      ...state.taxes,
      belkaEnabled: $('#pl-belka').checked,
      ikeIkze: {
        enabled: $('#pl-ikeikze').checked,
        employmentForm: $('#pl-emp').value,
        pitRate: Number($('#pl-pit').value),
        ikeStart: iS,
        ikzeStart: zS,
      },
    };
    try { E.recomputeDerived(state); } catch (err) { return planFail('Błąd przeliczania: ' + err.message); }
    persist();
    toast('Zapisano ustawienia podatków.');
    location.hash = '#/plan';
  });
}

// ── Zdarzenia jednorazowe (#/plan/zdarzenia) ──
// Planowane duże wydatki/przychody wpięte w prognozę (projectFire), nie w
// historię. Formularz: miesiąc (bieżący lub przyszły), segment Wydatek/Przychód
// (znak nadawany przy zapisie), kwota (pl-PL, pole tekstowe jak nadpłaty — nie
// type=number) i opcjonalny opis (≤80 znaków). Lista sortowana po miesiącu, z
// usuwaniem; minione zdarzenia (miesiąc ≤ ostatni pełny — możliwe tylko, gdy
// upłynął czas) wyszarzone z plakietką i wciąż usuwalne — nic już nie liczą.
function renderPlanZdarzenia() {
  const minMonth = E.todayYm();          // bieżący lub przyszły
  const lastOk = E.lastCompleteMonth();  // granica „minione"
  const proj = state.derived.projection;
  const fireYm = proj && proj.reached ? proj.fireYm : null;
  const events = [...state.events].sort((a, b) => (a.month < b.month ? -1 : 1));

  const row = ev => {
    const past = E.ymToIdx(ev.month) <= E.ymToIdx(lastOk);
    const income = ev.amount > 0;
    const afterFire = !past && fireYm && E.ymToIdx(ev.month) > E.ymToIdx(fireYm);
    return `<div class="ev-row${past ? ' ev-past' : ''}">
      <div class="ev-main">
        <div class="ev-when">${esc(Fmt.formatMonthName(ev.month))}</div>
        ${ev.label ? `<div class="muted small">${esc(ev.label)}</div>` : ''}
        ${past ? '<div class="ev-badge muted small">minione — ujęte w check-inie</div>'
          : afterFire ? '<div class="ev-badge muted small">po prognozowanym FIRE — prognoza kończy się na FIRE</div>' : ''}
      </div>
      <div class="ev-amount ${income ? 'good' : 'bad'}">${income ? '+' : '−'}${Fmt.formatPLN(Math.abs(ev.amount))}</div>
      <button type="button" class="btn ghost ev-del" data-del-ev="${ev.id}" aria-label="Usuń zdarzenie">✕</button>
    </div>`;
  };

  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Zdarzenia jednorazowe 📅</h2>
    <p class="muted small">Kwoty w dzisiejszych złotych. Zdarzenie wpływa na prognozę; gdy miesiąc nadejdzie, rzeczywistą kwotę zapisz w check-inie.</p>
    <label class="field"><span class="lbl">Miesiąc</span>
      <input type="month" id="ev-month" min="${minMonth}" value="${minMonth}">
    </label>
    <div class="seg" role="tablist">
      <button type="button" data-ev-kind="expense" class="on">Wydatek</button>
      <button type="button" data-ev-kind="income">Przychód</button>
    </div>
    <label class="field"><span class="lbl">Kwota <span class="muted">(zł)</span></span>
      <input type="text" inputmode="decimal" id="ev-amount" placeholder="np. 40 000">
    </label>
    <label class="field"><span class="lbl">Opis <span class="muted">(opcjonalnie)</span></span>
      <input type="text" id="ev-label" maxlength="80" placeholder="np. Wesele, spadek, premia">
    </label>
    <button id="ev-add" class="primary wide">Dodaj zdarzenie</button>
  </div>
  ${events.length
    ? `<div class="card"><h3>Zaplanowane</h3>${events.map(row).join('')}</div>`
    : '<p class="muted small center">Brak zaplanowanych zdarzeń.</p>'}
  ${planBack}`;

  let kind = 'expense';
  $$('[data-ev-kind]').forEach(el => el.addEventListener('click', () => {
    kind = el.dataset.evKind;
    $$('[data-ev-kind]').forEach(b => b.classList.toggle('on', b === el));
  }));

  $('#ev-add').addEventListener('click', () => {
    $('#plan-error').innerHTML = '';
    const month = $('#ev-month').value;
    if (!/^\d{4}-\d{2}$/.test(month)) return planFail('Podaj miesiąc zdarzenia.');
    const amt = parseMoney('ev-amount', { min: 0 });
    if (amt.error) return planFail(`Popraw kwotę: ${amt.error}`);
    if (!(amt.value > 0)) return planFail('Kwota musi być większa od zera.');
    const signed = kind === 'income' ? amt.value : -amt.value;
    try {
      E.addEvent(state, { month, amount: signed, label: $('#ev-label').value });
    } catch (err) {
      return planFail(err.message);
    }
    persist();
    toast('Dodano zdarzenie.');
    renderPlanZdarzenia();
  });

  $$('[data-del-ev]').forEach(el => el.addEventListener('click', () => {
    E.removeEvent(state, Number(el.dataset.delEv));
    persist();
    toast('Usunięto zdarzenie.');
    renderPlanZdarzenia();
  }));
}

// ── Aplikacja ──
function renderPlanAplikacja() {
  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Aplikacja ⚙️</h2>
    <label class="field"><span class="lbl">Motyw</span>
      <select id="pl-theme">
        <option value="auto" ${state.ui.theme === 'auto' ? 'selected' : ''}>systemowy</option>
        <option value="light" ${state.ui.theme === 'light' ? 'selected' : ''}>jasny</option>
        <option value="dark" ${state.ui.theme === 'dark' ? 'selected' : ''}>ciemny</option>
      </select>
      <div class="hint">Zmiana działa od razu — bez zapisywania.</div>
    </label>
  </div>
  ${planBack}`;
  // Motyw stosuje się natychmiast przy wyborze — bez osobnego „Zapisz".
  $('#pl-theme').addEventListener('change', () => {
    state.ui.theme = $('#pl-theme').value;
    applyTheme();
    persist();
    toast('Motyw zapisany.');
  });
}

// ── Korekty sald (zaawansowane) ──
function renderPlanKorekty() {
  const lastOk = E.lastCompleteMonth();
  const hasEntryLastOk = !!state.entries.find(e => e.month === lastOk);
  view().innerHTML = `${planBack}
  <div id="plan-error"></div>
  <div class="card"><h2>Korekty sald 🩹</h2>
    <p class="muted small">Zaawansowane. Korekta „przypina się” do ostatniego pełnego miesiąca (${esc(Fmt.formatMonthName(lastOk))}). Puste pole = bez korekty.</p>
    ${hasEntryLastOk
      ? `${field({ id: 'cor-cash', label: 'Rzeczywista gotówka', suffix: 'zł' })}
         ${field({ id: 'cor-port', label: 'Rzeczywisty portfel', suffix: 'zł' })}`
      : `<p class="banner warn small">Korekta gotówki i portfela wymaga wpisu za ${esc(Fmt.formatMonthName(lastOk))} — zrób najpierw check-in (sekcja „Popraw salda”).</p>`}
    ${state.derived.debt.started && state.derived.debt.balanceNominal > 0
      ? field({ id: 'cor-debt', label: 'Rzeczywiste saldo kredytu (nominalne)', suffix: 'zł' })
      : ''}
    ${state.derived.family && state.derived.family.started && state.derived.family.balanceNominal > 0
      ? field({ id: 'cor-fl-debt', label: 'Rzeczywiste saldo długu rodzinnego (nominalne)', suffix: 'zł' })
      : ''}
    <button id="cor-save" class="primary wide">Zapisz korekty</button>
  </div>
  ${planBack}`;

  $('#cor-save').addEventListener('click', () => {
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
    const corFlDebt = $('#cor-fl-debt');
    if (corFlDebt && corFlDebt.value.trim() !== '') {
      const v = Fmt.parsePLN(corFlDebt.value);
      if (v == null || v < 0) { errBox.innerHTML = '<div class="field-error">Popraw saldo długu rodzinnego.</div>'; return; }
      state.debt.familyOverrides = (state.debt.familyOverrides || []).filter(o => o.month !== lastOk);
      state.debt.familyOverrides.push({ month: lastOk, balanceNominal: v });
      changed = true;
    }
    if (!changed) { toast('Brak korekt do zapisania.'); return; }
    E.recomputeDerived(state);
    persist();
    toast('Korekty zapisane, salda przeliczone.');
    location.hash = '#/plan';
  });
}

// ── Kopia zapasowa ──────────────────────────────────────────────────────

function renderBackup() {
  const last = state.ui.lastExportAt;
  const nudge = !last || (Date.now() - Date.parse(last)) > 61 * 24 * 3600 * 1000;
  view().innerHTML = `
  <a class="btn ghost wide" href="#/plan">← Ustawienia</a>
  <div class="card"><h2>Kopia zapasowa</h2>
    <p class="muted small">Dane istnieją <b>tylko na tym urządzeniu</b>. Wyczyszczenie danych przeglądarki
    lub utrata telefonu = utrata historii. Regularny eksport to Twoje ubezpieczenie.</p>
    ${nudge ? '<div class="banner warn small">Dawno nie było kopii — wyeksportuj teraz.</div>' : ''}
    <p class="muted small">Ostatnia kopia: <b>${last ? esc(new Date(last).toLocaleDateString('pl-PL')) : 'nigdy'}</b></p>
    <button id="bk-export" class="primary wide">⬇️ Eksportuj kopię (JSON)</button>
    <button id="bk-export-csv" class="wide">📊 Eksportuj historię (CSV)</button>
    <p class="muted small">CSV służy do analizy (np. w Excelu) — <b>nie jest kopią
    zapasową</b> i nie da się go wczytać z powrotem.</p>
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
  <div class="card"><h2>Aktualizacja</h2>
    <p class="muted small">Jeśli aplikacja nie odświeża się do najnowszej wersji, wymuś ponowne pobranie
    wszystkich plików z sieci. <b>Twoje dane pozostaną nietknięte</b> — czyścimy tylko pamięć podręczną plików aplikacji.</p>
    <button id="bk-update" class="wide">🔄 Wymuś aktualizację i przeładuj</button>
  </div>
  <div class="card"><h2>Strefa ostrożności</h2>
    <button id="bk-reset" class="${resetArmed ? 'danger' : ''} wide">${resetArmed ? '⚠️ Potwierdź: usuń WSZYSTKIE dane' : 'Wyzeruj aplikację…'}</button>
    ${resetArmed ? '<p class="field-error center small">To usunie całą historię bezpowrotnie. Najpierw zrób eksport!</p>' : ''}
  </div>
  <p class="muted small center">FIRE Companion v${APP_VERSION}</p>`;

  $('#bk-update').addEventListener('click', async () => {
    const btn = $('#bk-update');
    btn.disabled = true;
    btn.textContent = '⏳ Pobieram najnowszą wersję…';
    // Sonda online PRZED czyszczeniem cache — offline skasowalibyśmy jedyną
    // kopię aplikacji. Unikalny query omija cache-first SW (dokładne
    // dopasowanie URL), a no-store — HTTP cache; pewniejsze niż navigator.onLine.
    try {
      await fetch('./manifest.webmanifest?sonda=' + Date.now(), { cache: 'no-store' });
    } catch {
      btn.disabled = false;
      btn.textContent = '🔄 Wymuś aktualizację i przeładuj';
      toast('Jesteś offline — spróbuj z internetem.');
      return;
    }
    try {
      // Kasujemy TYLKO Cache Storage (pliki aplikacji) — localStorage z danymi zostaje.
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      // Wyrejestruj service workery, żeby po przeładowaniu wszystko poszło ze świeżej sieci.
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch (err) {
      console.warn('Wymuszona aktualizacja:', err);
    }
    // reload(true) jest przestarzały i ignorowany, ale samo przeładowanie bez SW
    // pobierze wszystko z sieci — a app.js zarejestruje nowy SW od nowa.
    location.reload();
  });

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

  // CSV: jednokierunkowy eksport do analizy. Celowo BEZ lastExportAt, BEZ
  // persist() i BEZ re-renderu — nic się nie zmieniło; kopią zapasową
  // pozostaje wyłącznie JSON (nudge 61 dni patrzy tylko na niego).
  $('#bk-export-csv').addEventListener('click', () => {
    if (!state.entries.length) { toast('Brak wpisów — najpierw zrób pierwszy check-in.'); return; }
    const csv = entriesCSV(state, { verdictLabel });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const d = new Date();
    a.download = `fire-historia-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Historia pobrana (CSV). Kopią zapasową pozostaje eksport JSON.');
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
        confirmModal('Na pewno? Obecne dane zostaną bezpowrotnie zastąpione danymi z pliku.', () => {
          // Walidacja przepuszcza, a przeliczenie i tak może paść — wtedy
          // zostajemy przy dotychczasowym stanie (persist się nie wykonał).
          const prev = state;
          try {
            state = importCandidate.state;
            E.recomputeDerived(state);
          } catch (err) {
            state = prev;
            importCandidate = null;
            toast('Import przerwany — nie udało się przeliczyć danych z pliku (' + err.message + '). Obecne dane pozostały bez zmian.', 8000);
            return;
          }
          importCandidate = null;
          persist();
          applyTheme();
          toast('Dane zaimportowane.');
          location.hash = '#/';
        }, { yesLabel: 'Zastąp' });
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
        // Przypisanie dopiero PO udanym przeliczeniu — rzut nie może
        // zostawić w module na wpół zepsutego stanu.
        E.recomputeDerived(p.state);
        state = p.state;
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
    confirmModal('Na pewno usunąć uszkodzone dane i zacząć od nowa?', () => {
      storage.reset();
      state = null;
      route();
    }, { yesLabel: 'Usuń' });
  });
}
