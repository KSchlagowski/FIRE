// motivation.js — czyste buildery HTML warstwy motywacyjnej: modal po check-inie
// oraz karta „Dzisiejsza decyzja" na pulpicie. Zero DOM, zero stanu modułu:
// dane (werdykt, wpływ z engine.js, komunikat z coach.js) wchodzą parametrami,
// wychodzi string. Mirror analysis.js/simulation.js. Kalkulatory „Dzisiejszej
// decyzji" są efemeryczne (żadnego persist() w ich ścieżce); ścieżka modala
// check-inu jedzie na persist() wpisu w ui.js — tam też zapisuje się
// milestonesSeen, gdy modal niesie baner kamienia milowego.

import * as Fmt from './format.js';
import { verdictLabel, verdictEmoji } from './coach.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Drobne kwoty (< 100 zł) z groszami, większe okrągło.
const money = v => Fmt.formatPLN(v, Math.abs(v) < 100 ? 2 : 0);

// Mnożnik „×2,5" — jedno miejsce po przecinku, przecinek dziesiętny.
function fmtFactor(f) {
  return f.toFixed(1).replace('.', ',');
}

// Polska liczba mnoga dni, z wariantem ułamkowym „1,3 dnia".
function polishDays(d) {
  if (d < 1) return `${d.toFixed(1).replace('.', ',')} dnia`;
  const whole = Math.round(d);
  return whole === 1 ? '1 dzień' : `${whole} dni`;
}

const PROFILE_HINT = 'Uzupełnij datę urodzenia i docelowy wiek FIRE w Ustawieniach, aby zobaczyć, ile ta kwota znaczy na dzień FIRE.';

// Zdanie o mnożniku + opcjonalna linia „≈ N dni emerytury".
function payoffLines(amount, impact, { kind }) {
  const out = [];
  if (impact.yearsToFire === 0) {
    out.push('<p class="muted small">Jesteś już w swoim wieku FIRE — ta kwota pracuje dla Ciebie od razu.</p>');
  } else {
    const f = fmtFactor(impact.factor);
    out.push(kind === 'avoided'
      ? `<p class="muted small">To ×${f} — nie kupiłeś jednego dziś, by w wieku FIRE stać Cię było na ${f} takich.</p>`
      : `<p class="muted small">To ×${f} — jeden zakup dziś to ${f} takich, na które nie będzie Cię stać w wieku FIRE.</p>`);
  }
  const rd = impact.retirementDays;
  if (rd != null && rd >= 0.05) {
    out.push(`<p class="muted small">≈ ${polishDays(rd)} sfinansowanej emerytury.</p>`);
  }
  return out.join('');
}

// ── Modal motywacyjny po zapisaniu check-inu ─────────────────────────────

// milestone: null | { title, text, extraTitles?: string[] } — baner 🏆 między
// badge'em a komunikatem trenera; kolejne klucze z tego samego zapisu idą
// jedną linią „A do tego: …" (jeden modal, nie łańcuszek).
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

// ── Karta „Dzisiejsza decyzja" (pulpit) ──────────────────────────────────

export function decisionCard({ mode, amount, category, resultHTML }) {
  const spent = mode === 'spent';
  const catSeg = spent ? `<div class="seg" role="tablist">
      <button type="button" data-deccat="invest" class="${category === 'invest' ? 'on' : ''}">Inwestycja w siebie</button>
      <button type="button" data-deccat="impulse" class="${category === 'impulse' ? 'on' : ''}">Zakup impulsywny</button>
    </div>` : '';
  return `<div class="card"><h2>Dzisiejsza decyzja 💸</h2>
    <p class="muted small">Powstrzymałeś się albo coś kupiłeś? Sprawdź, co to znaczy dla Twojego FIRE. Niczego nie zapisujemy — to tylko chwila refleksji.</p>
    <div class="seg" role="tablist">
      <button type="button" data-decmode="avoided" class="${spent ? '' : 'on'}">Powstrzymałem się</button>
      <button type="button" data-decmode="spent" class="${spent ? 'on' : ''}">Wydałem</button>
    </div>
    ${catSeg}
    <label class="field"><span class="lbl">Kwota <span class="muted">(zł)</span></span>
      <input type="text" id="dec-amount" inputmode="decimal" value="${esc(amount)}" placeholder="np. 50">
    </label>
    <div id="dec-result">${resultHTML}</div>
  </div>`;
}

// ── Wynik: powstrzymałem się ─────────────────────────────────────────────

export function avoidedResult({ amount, impact, message }) {
  const praise = `<div class="banner success small">✋ ${esc(message)}</div>`;
  if (impact == null) {
    return `${praise}<p class="muted small">${PROFILE_HINT}</p>`;
  }
  return [
    praise,
    `<div class="kv"><span>Nie wydane dziś</span><b>${money(amount)}</b></div>`,
    `<div class="kv"><span>Realnie w wieku FIRE</span><b class="good">${money(impact.futureValueReal)}</b></div>`,
    payoffLines(amount, impact, { kind: 'avoided' }),
  ].join('');
}

// ── Wynik: wydałem ───────────────────────────────────────────────────────

export function spentResult({ amount, category, impact, message }) {
  if (category === 'invest') {
    return `<div class="banner success small">🌱 ${esc(message)}</div>`;
  }
  const intro = `<div class="banner info small">🧾 ${esc(message)}</div>`;
  if (impact == null) {
    return `${intro}<p class="muted small">${PROFILE_HINT}</p>`;
  }
  return [
    intro,
    `<div class="kv"><span>Wydane dziś</span><b>${money(amount)}</b></div>`,
    `<div class="kv"><span>W cenach z wieku FIRE</span><b class="bad">${money(impact.futureValueReal)}</b></div>`,
    payoffLines(amount, impact, { kind: 'impulse' }),
  ].join('');
}
