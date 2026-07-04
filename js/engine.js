// engine.js — czysty silnik finansowy FIRE Companion.
// Zero DOM, zero storage. Wszystkie kwoty w REALNYCH zł, chyba że
// identyfikator kończy się na "Nominal" (kredyt to kontrakt nominalny).

export const EPS = 0.005;
export const HORIZON_MONTHS = 720;

// ── Pieniądze ────────────────────────────────────────────────────────────

export function roundGrosze(x) {
  return Math.round(x * 100) / 100;
}

// ── Czas: miesiące "YYYY-MM", arytmetyka na indeksach całkowitych ───────
// Nigdy new Date("YYYY-MM") — pułapka przesunięcia UTC.

export function ymToIdx(ym) {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

export function idxToYm(idx) {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function monthsBetween(a, b) {
  return ymToIdx(b) - ymToIdx(a);
}

export function addMonths(ym, n) {
  return idxToYm(ymToIdx(ym) + n);
}

export function isValidYm(ym) {
  return typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

// "Dzisiejszy miesiąc" wyłącznie z lokalnego czasu.
export function todayYm(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function lastCompleteMonth(now = new Date()) {
  return addMonths(todayYm(now), -1);
}

// Rok planu t = 1, 2, 3… liczony od anchorMonth (wzrosty schodkowe roczne).
export function planYear(anchor, ym) {
  return Math.floor(Math.max(0, monthsBetween(anchor, ym)) / 12) + 1;
}

export function ageAt(birthDate, ym) {
  const [by, bm] = birthDate.split('-').map(Number);
  const totalMonths = ymToIdx(ym) - (by * 12 + (bm - 1));
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, totalMonths };
}

// ── Stopy i konwersje real/nominal ──────────────────────────────────────

export function monthlyRate(annual) {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

export function toNominal(real, anchor, ym, infl) {
  return real * Math.pow(1 + infl, monthsBetween(anchor, ym) / 12);
}

export function toReal(nominal, anchor, ym, infl) {
  return nominal / Math.pow(1 + infl, monthsBetween(anchor, ym) / 12);
}

// Konwencja roczna Excela (arkusz Projekcja): end = (start + wpłaty) × (1+r).
// Używana tylko do testów parytetu z arkuszem.
export function yearlyCompound(start, contribYearly, r, years) {
  let bal = start;
  for (let i = 0; i < years; i++) bal = (bal + contribYearly) * (1 + r);
  return bal;
}

// ── Cel FIRE (ruchomy) ──────────────────────────────────────────────────

export function fireTargetAt(state, ym) {
  const a = state.assumptions;
  if (!(a.withdrawalRate > 0)) throw new Error('withdrawalRate musi być > 0');
  const t = planYear(state.anchorMonth, ym);
  const living = a.monthlyLivingExpenses * Math.pow(1 + a.expenseGrowthReal, t - 1);
  const houseOn = !!(state.housing.housePlan && state.housing.housePlan.enabled);
  // Z domem: cel = tylko koszty życia. Bez domu: czynsz na zawsze (stały realnie).
  const rent = houseOn ? 0 : (state.housing.currentRentMonthly || 0);
  return (living + rent) * 12 / a.withdrawalRate;
}

export function fireTargetsToday(state, nowYm = todayYm()) {
  const a = state.assumptions;
  const primary = fireTargetAt(state, nowYm);
  const houseOn = !!(state.housing.housePlan && state.housing.housePlan.enabled);
  const rentPart = (state.housing.currentRentMonthly || 0) * 12 / a.withdrawalRate;
  return {
    primary,
    rentingForever: houseOn ? primary + rentPart : primary,
  };
}

// ── Kredyt hipoteczny (nominalny) ───────────────────────────────────────

export function mortgagePayment(mtg) {
  if (!mtg || !(mtg.termYears > 0)) throw new Error('termYears musi być > 0');
  if (mtg.paymentOverrideMonthly != null) return mtg.paymentOverrideMonthly;
  const N = Math.round(mtg.termYears * 12);
  const j = monthlyRate(mtg.rateNominal);
  if (j === 0) return mtg.principal / N;
  return mtg.principal * j / (1 - Math.pow(1 + j, -N));
}

// Jeden miesiąc kredytu. spill = nadpłata ponad spłatę — wraca do inwestycji.
export function mortgageStep(balNominal, j, payment, overpayNominal = 0) {
  const interest = balNominal * j;
  const pay = payment + overpayNominal;
  let principalPaid = pay - interest;
  let spill = 0;
  if (principalPaid >= balNominal - EPS) {
    spill = Math.max(0, principalPaid - balNominal);
    principalPaid = balNominal;
  }
  let bal = balNominal - principalPaid;
  if (bal < EPS) bal = 0;
  return { bal, interest, principalPaid, spill };
}

export function amortizationSchedule(mtg) {
  const j = monthlyRate(mtg.rateNominal);
  const A = mortgagePayment(mtg);
  const N = Math.round(mtg.termYears * 12);
  const rows = [];
  let bal = mtg.principal;
  for (let i = 0; i < N && bal > 0; i++) {
    const step = mortgageStep(bal, j, A);
    bal = step.bal;
    rows.push({ n: i + 1, balNominal: bal, interest: step.interest, principalPaid: step.principalPaid });
  }
  return rows;
}

// ── Plan fazowy (benchmark, nie stan faktyczny) ─────────────────────────
// Rata w planie deflowana schodkowo rocznie: A·(1+infl)^−(t−1).
// Świadomy błąd: benchmark lekko konserwatywny (deflator roczny zamiast miesięcznego).

export function buildPlan(state, horizon = HORIZON_MONTHS) {
  const a = state.assumptions;
  const h = state.housing;
  const hp = h.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const a0 = ymToIdx(state.anchorMonth);
  const A = houseOn ? mortgagePayment(hp.mortgage) : 0;
  const mStart = houseOn ? ymToIdx(hp.mortgage.startMonth) : Infinity;
  const mEnd = houseOn ? mStart + Math.round(hp.mortgage.termYears * 12) : Infinity;
  const moveIn = houseOn && hp.moveInMonth ? ymToIdx(hp.moveInMonth) : Infinity;
  const bizStart = houseOn && hp.businessStartMonth ? ymToIdx(hp.businessStartMonth) : Infinity;
  const rows = [];
  for (let i = 0; i < horizon; i++) {
    const idx = a0 + i;
    const ym = idxToYm(idx);
    const t = Math.floor(i / 12) + 1;
    const incomeReal = a.monthlyIncome * Math.pow(1 + a.incomeGrowthReal, t - 1)
      + (idx >= bizStart ? (hp.businessIncomeMonthly || 0) : 0);
    const livingReal = a.monthlyLivingExpenses * Math.pow(1 + a.expenseGrowthReal, t - 1);
    const rentReal = (houseOn ? idx < moveIn : true) ? (h.currentRentMonthly || 0) : 0;
    const inTerm = idx >= mStart && idx < mEnd;
    const mortgagePaymentReal = inTerm ? A * Math.pow(1 + a.inflationAnnual, -(t - 1)) : 0;
    const plannedSavings = incomeReal - livingReal - rentReal - mortgagePaymentReal;
    const targetReal = fireTargetAt(state, ym);
    const phase = houseOn ? (idx < mStart ? 'saving' : inTerm ? 'debt' : 'invest') : 'invest';
    rows.push({ ym, t, incomeReal, livingReal, rentReal, mortgagePaymentReal, plannedSavings, targetReal, phase });
  }
  return rows;
}

export function plannedSavingsFor(plan, ym) {
  const i = ymToIdx(ym) - ymToIdx(plan[0].ym);
  if (i < 0 || i >= plan.length) return 0;
  return plan[i].plannedSavings;
}

// ── Replay długu (pochodna, nigdy nie zapisywana) ───────────────────────
// Rata planowa zakładana jako płacona także w miesiącach bez wpisu.
// Nadpłaty z wpisów wchodzą bez konwersji (wpisane "teraz" = nominał teraz).

export function replayDebt(state, uptoYm) {
  const hp = state.housing.housePlan;
  const empty = {
    active: false, started: false, balanceNominal: 0, balanceReal: 0,
    paidPct: 0, rows: [], byMonth: new Map(),
  };
  if (!hp || !hp.enabled) return empty;
  const mtg = hp.mortgage;
  const j = monthlyRate(mtg.rateNominal);
  const A = mortgagePayment(mtg);
  const start = ymToIdx(mtg.startMonth);
  const upto = ymToIdx(uptoYm);
  if (upto < start) return { ...empty, byMonth: new Map() };

  const entriesByMonth = new Map(state.entries.map(e => [ymToIdx(e.month), e]));
  const overrides = new Map((state.debt.overrides || []).map(o => [ymToIdx(o.month), o.balanceNominal]));
  let bal = mtg.principal;
  const rows = [];
  const byMonth = new Map();
  for (let idx = start; idx <= upto; idx++) {
    const balStart = bal;
    let interest = 0, principalPaid = 0, spill = 0;
    if (bal > 0) {
      const e = entriesByMonth.get(idx);
      const overpay = e ? (e.overpayment || 0) : 0;
      const step = mortgageStep(bal, j, A, overpay);
      bal = step.bal;
      interest = step.interest;
      principalPaid = step.principalPaid;
      spill = step.spill;
    }
    if (overrides.has(idx)) bal = overrides.get(idx); // korekta ręczna resetuje łańcuch
    byMonth.set(idx, { balStart, bal, spill });
    rows.push({ ym: idxToYm(idx), balNominal: bal, interest, principalPaid, spill });
  }
  return {
    active: bal > 0,
    started: true,
    balanceNominal: bal,
    balanceReal: toReal(bal, state.anchorMonth, uptoYm, state.assumptions.inflationAnnual),
    paidPct: mtg.principal > 0 ? (mtg.principal - bal) / mtg.principal : 0,
    rows,
    byMonth,
  };
}

// ── Replay sald: gotówka (fundusz na dom) + portfel inwestycyjny ────────
// Routing wg fazy: przed startem kredytu → gotówka; w długu → gotówka;
// po spłacie (lub bez planu domu) → portfel. Deficyty drenują najpierw
// gotówkę, potem portfel. Miesiące bez wpisu: tylko wzrost.

export function replayBalances(state, uptoYm, debtRes = null) {
  const a = state.assumptions;
  const a0 = ymToIdx(state.anchorMonth);
  const upto = ymToIdx(uptoYm);
  const rPort = monthlyRate(a.realReturnAnnual);
  const rCash = monthlyRate(a.cashReturnReal || 0);
  const hp = state.housing.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const debt = debtRes || replayDebt(state, uptoYm);
  const mStart = houseOn ? ymToIdx(hp.mortgage.startMonth) : Infinity;
  const hsMonth = houseOn ? ymToIdx((hp.houseSpend && hp.houseSpend.month) || hp.mortgage.startMonth) : Infinity;
  const hsAmount = houseOn && hp.houseSpend ? hp.houseSpend.amount : null;
  const entriesByMonth = new Map(state.entries.map(e => [ymToIdx(e.month), e]));

  let cash = a.cashStart || 0;
  let portfolio = a.portfolioStart || 0;
  let houseUnderfunded = false;
  let houseSpent = 0;
  const rows = [];

  for (let idx = a0; idx <= upto; idx++) {
    const e = entriesByMonth.get(idx);
    const net = e ? roundGrosze(e.earned - e.spent) : 0;
    const contribution = e ? roundGrosze(net - (e.overpayment || 0)) : 0;
    const d = debt.byMonth.get(idx);
    let flowCash = 0, flowPortfolio = 0; // przepływy (bez wzrostu i bez korekt sald)
    let phase;
    if (!houseOn) phase = 'invest';
    else if (idx < mStart) phase = 'saving';
    else if (d && d.balStart > EPS) phase = 'debt';
    else phase = 'invest';

    if (contribution >= 0) {
      if (phase === 'saving' || phase === 'debt') { cash += contribution; flowCash += contribution; }
      else { portfolio += contribution; flowPortfolio += contribution; }
    } else {
      let deficit = -contribution;
      const fromCash = Math.min(cash, deficit);
      cash -= fromCash;
      deficit -= fromCash;
      portfolio -= deficit;
      flowCash -= fromCash;
      flowPortfolio -= deficit;
    }

    if (d && d.spill > 0) { portfolio += d.spill; flowPortfolio += d.spill; } // nadpłata ponad spłatę wraca do inwestycji

    if (idx === hsMonth) {
      const amount = hsAmount == null ? cash : hsAmount; // null = "cała gotówka"
      const fromCash = Math.min(cash, amount);
      cash -= fromCash;
      let rest = amount - fromCash;
      const fromPort = Math.min(portfolio, rest);
      portfolio -= fromPort;
      rest -= fromPort;
      if (rest > EPS) houseUnderfunded = true;
      houseSpent = amount - rest;
      flowCash -= fromCash;
      flowPortfolio -= fromPort;
    }

    cash *= 1 + rCash;
    portfolio *= 1 + rPort;

    // Korekty sald to NIE przepływ — ich efekt ląduje w rezydualnym "wzroście".
    const override = !!(e && (e.cashOverride != null || e.balanceOverride != null));
    if (e && e.cashOverride != null) cash = e.cashOverride;
    if (e && e.balanceOverride != null) portfolio = e.balanceOverride;

    rows.push({ ym: idxToYm(idx), cash, portfolio, net, contribution, phase, hasEntry: !!e, flowCash, flowPortfolio, override });
  }
  return { cash, portfolio, rows, houseUnderfunded, houseSpent };
}

// ── Werdykt i seria ─────────────────────────────────────────────────────
// Skala S = max(|plan|, 500): odtwarza progi ×1.15/×0.6 ze spec dla plan > 500,
// rozszerza je w sposób ciągły na plan ≤ 0.

export function computeVerdict(net, plan) {
  const S = Math.max(Math.abs(plan), 500);
  if (net >= plan + 0.15 * S) return 'crushed';
  if (net >= plan) return 'on_plan';
  if (net >= plan - 0.40 * S) return 'behind';
  return 'hard';
}

export function isGoodVerdict(v) {
  return v === 'crushed' || v === 'on_plan';
}

// Brakujące miesiące są pomijane (nie przerywają i nie wydłużają serii).
export function computeStreak(entries) {
  const sorted = [...entries].sort((x, y) => (x.month < y.month ? -1 : 1));
  let run = 0, best = 0;
  for (const e of sorted) {
    if (isGoodVerdict(e.verdict)) { run++; if (run > best) best = run; }
    else run = 0;
  }
  return { current: run, best };
}

// ── Check-in ────────────────────────────────────────────────────────────

export function applyCheckIn(state, input, now = new Date()) {
  const { month } = input;
  if (!isValidYm(month)) throw new Error('Nieprawidłowy miesiąc');
  const existing = state.entries.find(e => e.month === month);
  const lastOk = lastCompleteMonth(now);
  if (ymToIdx(month) > ymToIdx(lastOk)) throw new Error('Miesiąc jeszcze się nie skończył');
  if (!existing && ymToIdx(month) < ymToIdx(state.anchorMonth)) {
    throw new Error('Miesiąc sprzed startu planu');
  }
  const earned = roundGrosze(Number(input.earned));
  const spent = roundGrosze(Number(input.spent));
  const overpayment = roundGrosze(Number(input.overpayment || 0));
  if (!(earned >= 0) || !(spent >= 0)) throw new Error('Kwoty muszą być liczbami ≥ 0');
  if (overpayment < 0) throw new Error('Nadpłata nie może być ujemna');
  if (overpayment > 0) {
    const debt = replayDebt(state, month);
    const d = debt.byMonth.get(ymToIdx(month));
    if (!d || d.balStart <= EPS) throw new Error('Nadpłata możliwa tylko przy aktywnym kredycie');
  }

  const plan = buildPlan(state);
  // Snapshot planu zamrożony przy tworzeniu; jawna edycja go odświeża.
  const plannedSavingsSnapshot = plannedSavingsFor(plan, month);
  const net = roundGrosze(earned - spent);
  const entry = {
    month, earned, spent, overpayment,
    cashOverride: input.cashOverride != null ? roundGrosze(Number(input.cashOverride)) : null,
    balanceOverride: input.balanceOverride != null ? roundGrosze(Number(input.balanceOverride)) : null,
    plannedSavingsSnapshot,
    verdict: computeVerdict(net, plannedSavingsSnapshot),
    createdAt: existing ? existing.createdAt : now.toISOString(),
    updatedAt: existing ? now.toISOString() : null,
  };
  if (existing) {
    state.entries[state.entries.indexOf(existing)] = entry;
  } else {
    state.entries.push(entry);
    state.entries.sort((x, y) => (x.month < y.month ? -1 : 1));
  }
  recomputeDerived(state, now);
  return entry;
}

export function deleteEntry(state, month, now = new Date()) {
  const i = state.entries.findIndex(e => e.month === month);
  if (i >= 0) state.entries.splice(i, 1);
  recomputeDerived(state, now);
}

// Re-kotwiczenie startu planu. W PRZÓD (auto po edycji dochodu/wydatków/czynszu
// albo ręcznie): salda przenoszone na nową kotwicę. WSTECZ (ręcznie, aby otworzyć
// wcześniejsze miesiące do check-inu): salda startowe zostają takie, jakie ustawił
// wywołujący — to stan początku nowego, wcześniejszego miesiąca. Historia (wpisy,
// werdykty) pozostaje bez zmian w obu kierunkach.
export function reanchor(state, newAnchor, now = new Date()) {
  if (newAnchor === state.anchorMonth) return;
  if (ymToIdx(newAnchor) > ymToIdx(state.anchorMonth)) {
    const upto = addMonths(newAnchor, -1);
    if (ymToIdx(upto) >= ymToIdx(state.anchorMonth)) {
      const debt = replayDebt(state, upto);
      const bal = replayBalances(state, upto, debt);
      state.assumptions.cashStart = roundGrosze(bal.cash);
      state.assumptions.portfolioStart = roundGrosze(bal.portfolio);
    }
  }
  state.anchorMonth = newAnchor;
  recomputeDerived(state, now);
}

// ── Prognoza ────────────────────────────────────────────────────────────

// Średnia (net − snapshot) z ostatnich min(6, n) wpisów; 0 gdy n < 3
// (wtedy etykieta "prognoza wg planu").
export function assumedDelta(entries) {
  const sorted = [...entries].sort((x, y) => (x.month < y.month ? -1 : 1));
  const n = sorted.length;
  if (n < 3) return 0;
  const last = sorted.slice(-Math.min(6, n));
  const sum = last.reduce((acc, e) => acc + (e.earned - e.spent) - e.plannedSavingsSnapshot, 0);
  return sum / last.length;
}

export function projectFire(state, plan, balances, debtRes, uptoYm) {
  const a = state.assumptions;
  const anchor = state.anchorMonth;
  const a0 = ymToIdx(anchor);
  const upto = ymToIdx(uptoYm);
  const delta = assumedDelta(state.entries);
  const byPlanOnly = state.entries.length < 3;
  const rPort = monthlyRate(a.realReturnAnnual);
  const rCash = monthlyRate(a.cashReturnReal || 0);
  const hp = state.housing.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const j = houseOn ? monthlyRate(hp.mortgage.rateNominal) : 0;
  const A = houseOn ? mortgagePayment(hp.mortgage) : 0;
  const mStart = houseOn ? ymToIdx(hp.mortgage.startMonth) : Infinity;
  const hsMonth = houseOn ? ymToIdx((hp.houseSpend && hp.houseSpend.month) || hp.mortgage.startMonth) : Infinity;
  const hsAmount = houseOn && hp.houseSpend ? hp.houseSpend.amount : null;

  let cash = balances.cash;
  let portfolio = balances.portfolio;
  let debtBal = 0;
  let debtStarted = false;
  if (houseOn && debtRes.started) {
    debtBal = debtRes.balanceNominal;
    debtStarted = true;
  }
  let houseDone = houseOn ? upto >= hsMonth : true;
  let houseShortfall = false;

  const series = balances.rows.map(r => ({
    ym: r.ym, cash: r.cash, portfolio: r.portfolio,
    flowCash: r.flowCash, flowPortfolio: r.flowPortfolio, override: r.override,
    debtReal: (debtRes.byMonth.get(ymToIdx(r.ym)) || { bal: 0 }).bal
      / Math.pow(1 + a.inflationAnnual, monthsBetween(anchor, r.ym) / 12),
    target: fireTargetAt(state, r.ym),
    projected: false,
  }));

  let fireYm = null;
  let debtFreeYm = null;
  if (debtStarted && debtBal <= EPS) debtFreeYm = uptoYm;

  const startIdx = Math.max(upto + 1, a0);
  for (let idx = startIdx; idx < a0 + plan.length; idx++) {
    const pm = plan[idx - a0];
    const ym = pm.ym;
    if (houseOn && idx >= mStart && !debtStarted) {
      debtBal = hp.mortgage.principal;
      debtStarted = true;
    }
    const debtActive = houseOn && debtStarted && debtBal > 0;
    const s = pm.plannedSavings + delta;
    let flowCash = 0, flowPortfolio = 0;

    if (debtActive) {
      // Strategia: cała nadwyżka nadpłaca kredyt (konwersja na nominał).
      const overpayNominal = s > 0 ? toNominal(s, anchor, ym, a.inflationAnnual) : 0;
      const step = mortgageStep(debtBal, j, A, overpayNominal);
      debtBal = step.bal;
      if (step.spill > 0) {
        const spillReal = toReal(step.spill, anchor, ym, a.inflationAnnual);
        portfolio += spillReal;
        flowPortfolio += spillReal;
      }
      if (s < 0) {
        let deficit = -s;
        const fromCash = Math.min(cash, deficit);
        cash -= fromCash;
        portfolio -= deficit - fromCash;
        flowCash -= fromCash;
        flowPortfolio -= deficit - fromCash;
      }
      if (debtBal <= EPS && !debtFreeYm) { debtBal = 0; debtFreeYm = ym; }
    } else if (houseOn && idx < mStart) {
      if (s >= 0) { cash += s; flowCash += s; }
      else {
        let deficit = -s;
        const fromCash = Math.min(cash, deficit);
        cash -= fromCash;
        portfolio -= deficit - fromCash;
        flowCash -= fromCash;
        flowPortfolio -= deficit - fromCash;
      }
    } else {
      if (s >= 0) { portfolio += s; flowPortfolio += s; }
      else {
        let deficit = -s;
        const fromCash = Math.min(cash, deficit);
        cash -= fromCash;
        portfolio -= deficit - fromCash;
        flowCash -= fromCash;
        flowPortfolio -= deficit - fromCash;
      }
    }

    if (houseOn && idx === hsMonth && !houseDone) {
      const amount = hsAmount == null ? cash : hsAmount;
      const fromCash = Math.min(cash, amount);
      cash -= fromCash;
      let rest = amount - fromCash;
      const fromPort = Math.min(portfolio, rest);
      portfolio -= fromPort;
      rest -= fromPort;
      if (rest > EPS) houseShortfall = true; // "plan zakłada niedobór wkładu"
      houseDone = true;
      flowCash -= fromCash;
      flowPortfolio -= fromPort;
    }

    cash *= 1 + rCash;
    portfolio *= 1 + rPort;

    series.push({
      ym, cash, portfolio, flowCash, flowPortfolio, override: false,
      debtReal: toReal(debtBal, anchor, ym, a.inflationAnnual),
      target: pm.targetReal,
      projected: true,
    });

    const houseSettled = !houseOn || (debtStarted && debtBal <= EPS && idx >= hsMonth);
    if (!fireYm && houseSettled && portfolio >= pm.targetReal - EPS) {
      fireYm = ym;
      break;
    }
  }

  const reached = fireYm != null;
  const fireAge = reached ? ageAt(state.profile.birthDate, fireYm) : null;
  const onTrack = reached && fireAge.totalMonths <= state.assumptions.targetFireAge * 12;
  return { reached, fireYm, fireAge, debtFreeYm, onTrack, series, delta, byPlanOnly, houseShortfall };
}

// ── Analiza (tabele i statystyki) ───────────────────────────────────────
// Funkcje czyste, liczone przy renderze ekranu #/analiza — NIE w
// recomputeDerived (potrzebne tylko tam, a recompute biegnie po każdej mutacji).

// Faza wypłat: rekurencja w REALNYCH zł, kolumny nominalne pochodne.
// Epoka nominalna = startYm (indeks cen 1 w miesiącu przejścia na FIRE —
// konwencja arkusza Faza wypłat): start_n = real·(1+i)^(n−1), end_n = real·(1+i)^n.
export function projectWithdrawal(state, opts = {}) {
  const a = state.assumptions;
  const proj = opts.projection || null;
  const reached = !!(proj && proj.reached);
  const hypothetical = opts.startYm == null && !reached;
  const startYm = opts.startYm != null ? opts.startYm : (reached ? proj.fireYm : todayYm());
  let startPortfolioReal = opts.startPortfolioReal;
  if (startPortfolioReal == null) {
    const row = reached ? proj.series.find(r => r.ym === startYm) : null;
    startPortfolioReal = row ? row.portfolio : fireTargetAt(state, startYm);
  }
  const years = opts.years || 35;
  const swr = a.withdrawalRate;
  const realRate = a.realReturnAnnual;
  const inflation = a.inflationAnnual;
  const nominalRate = (1 + realRate) * (1 + inflation) - 1;
  const withdrawalRealYearly = opts.withdrawalRealYearly != null
    ? opts.withdrawalRealYearly
    : fireTargetAt(state, startYm) * swr;
  const priceFactorAtStart = Math.pow(1 + inflation, monthsBetween(state.anchorMonth, startYm) / 12);
  const birth = state.profile.birthDate;
  const startAge = birth ? ageAt(birth, startYm).years : null;

  const rows = [];
  let depletedYear = null;
  let bal = startPortfolioReal;
  for (let n = 1; n <= years; n++) {
    const ym = addMonths(startYm, (n - 1) * 12);
    const startReal = bal;
    let endReal = (startReal - withdrawalRealYearly) * (1 + realRate);
    if (endReal <= EPS) { endReal = 0; depletedYear = n; }
    const growthReal = endReal - (startReal - withdrawalRealYearly);
    const pf1 = Math.pow(1 + inflation, n - 1);
    const pfN = Math.pow(1 + inflation, n);
    const startNominal = startReal * pf1;
    const withdrawalNominal = withdrawalRealYearly * pf1;
    const endNominal = endReal * pfN;
    const growthNominal = endNominal - (startNominal - withdrawalNominal);
    rows.push({
      year: n, ym, age: birth ? ageAt(birth, ym).years : null,
      startReal, startNominal,
      withdrawalReal: withdrawalRealYearly, withdrawalNominal,
      growthReal, growthNominal, endReal, endNominal,
    });
    bal = endReal;
    if (depletedYear != null) break;
  }
  return {
    startYm, startAge, hypothetical, swr, realRate, inflation, nominalRate,
    withdrawalRealYearly, priceFactorAtStart, rows, depletedYear,
  };
}

// Projekcja roczna (model aplikacji): serie miesięczne pogrupowane w bloki
// 12 miesięcy roku planu (od anchorMonth). Wzrost jest REZYDUALNY:
// saldo końc. = saldo pocz. + wpłaty + wzrost — tożsamość zachodzi dokładnie
// (korekty sald lądują we "wzroście", stąd flaga hasOverride → "*" w UI).
export function yearlyProjection(state, projection) {
  const series = projection.series;
  const birth = state.profile.birthDate;
  const blocks = [];
  for (let k = 0; k < series.length; k += 12) {
    const chunk = series.slice(k, k + 12);
    const prev = k > 0 ? series[k - 1] : null;
    const portStart = prev ? prev.portfolio : (state.assumptions.portfolioStart || 0);
    const cashStart = prev ? prev.cash : (state.assumptions.cashStart || 0);
    const last = chunk[chunk.length - 1];
    let flowPortfolio = 0, flowCash = 0, hasOverride = false, projCount = 0;
    for (const r of chunk) {
      flowPortfolio += r.flowPortfolio || 0;
      flowCash += r.flowCash || 0;
      if (r.override) hasOverride = true;
      if (r.projected) projCount++;
    }
    blocks.push({
      t: k / 12 + 1,
      ymFrom: chunk[0].ym, ymTo: last.ym, months: chunk.length,
      age: birth ? ageAt(birth, last.ym).years : null,
      portStart, flowPortfolio,
      growthPortfolio: last.portfolio - portStart - flowPortfolio,
      portEnd: last.portfolio,
      cashStart, flowCash, cashEnd: last.cash,
      debtRealEnd: last.debtReal, targetEnd: last.target,
      reached: !!(projection.reached && ymToIdx(chunk[0].ym) <= ymToIdx(projection.fireYm)
        && ymToIdx(projection.fireYm) <= ymToIdx(last.ym)),
      projected: projCount === 0 ? 'none' : (projCount === chunk.length ? 'full' : 'part'),
      hasOverride,
    });
  }
  return blocks;
}

// Widok parytetu z arkuszem Projekcja: kapitalizacja ROCZNA end = (start+wpłaty)·(1+r),
// cel rosnący (1+g_exp)^(n−1). Celowo różny od modelu aplikacji (miesięczna
// kapitalizacja, fazy, kubełki, delta) — służy do ręcznego cross-checku z Excelem.
export function excelProjection(state, opts = {}) {
  const a = state.assumptions;
  const anchor = state.anchorMonth;
  const years = opts.years || 60;
  const start = opts.start || 0;
  const contribYearly = opts.contribYearly || 0;
  const r = a.realReturnAnnual;
  const g = a.expenseGrowthReal;
  const target1 = fireTargetAt(state, anchor);
  const birth = state.profile.birthDate;
  const rows = [];
  let bal = start;
  for (let n = 1; n <= years; n++) {
    const startBal = bal;
    const growth = (startBal + contribYearly) * r;
    bal = (startBal + contribYearly) * (1 + r);
    const target = target1 * Math.pow(1 + g, n - 1);
    const ym = addMonths(anchor, n * 12 - 1);
    rows.push({
      year: n, ym, age: birth ? ageAt(birth, ym).years : null,
      startBal, contrib: contribYearly, growth, endBal: bal, target,
      reached: bal >= target - EPS,
    });
  }
  return rows;
}

// Wrażliwość: pełny potok na płytkiej kopii stanu (wszystkie funkcje potoku
// są czystymi czytelnikami — stan wejściowy pozostaje nietknięty, test F15a).
export function projectionWith(state, { assumptions = {}, extraMonthlySavings = 0, extraSavings = null } = {}, now = new Date()) {
  const st = { ...state, assumptions: { ...state.assumptions, ...assumptions } };
  const upto = lastCompleteMonth(now);
  let plan = buildPlan(st);
  if (extraMonthlySavings) {
    plan = plan.map(m => ({ ...m, plannedSavings: m.plannedSavings + extraMonthlySavings }));
  }
  if (extraSavings) {
    // Symulacja „co jeśli”: kwota w jednym miesiącu (recurring=false) albo od
    // tego miesiąca w górę (recurring=true). Ujemne kwoty legalne — deficyt
    // drenuje gotówkę→portfel istniejącymi ścieżkami projekcji.
    if (!isValidYm(extraSavings.month)) throw new Error('Nieprawidłowy miesiąc symulacji');
    const amount = Number(extraSavings.amount) || 0;
    const at = ymToIdx(extraSavings.month);
    const a0 = ymToIdx(st.anchorMonth);
    plan = plan.map((m, i) => {
      const hit = extraSavings.recurring ? a0 + i >= at : a0 + i === at;
      return hit ? { ...m, plannedSavings: m.plannedSavings + amount } : m;
    });
  }
  const debt = replayDebt(st, upto);
  const balances = replayBalances(st, upto, debt);
  return projectFire(st, plan, balances, debt, upto);
}

// Tabela SWR: cel = roczne wydatki / SWR (roczne wydatki wprost z celu użytkownika).
export function swrComparison(state, nowYm = todayYm()) {
  const user = state.assumptions.withdrawalRate;
  const expensesYearly = fireTargetAt(state, nowYm) * user;
  const target4 = expensesYearly / 0.04;
  const labels = new Map([[0.03, 'Bardzo konserwatywne'], [0.035, 'Konserwatywne'], [0.04, 'Klasyczne']]);
  const swrs = [...labels.keys()];
  if (!swrs.some(s => Math.abs(s - user) < 1e-9)) swrs.push(user);
  swrs.sort((x, y) => x - y);
  return swrs.map(swr => ({
    swr,
    multiplier: 1 / swr,
    target: expensesYearly / swr,
    diffVs4pct: expensesYearly / swr - target4,
    label: labels.get(swr) || 'Twoje ustawienie',
    isUser: Math.abs(swr - user) < 1e-9,
  }));
}

// Stopa oszczędzania: ostatni miesiąc / 12 miesięcy / od początku.
export function savingsStats(state, uptoYm) {
  const upto = ymToIdx(uptoYm);
  const entries = state.entries
    .filter(e => ymToIdx(e.month) <= upto)
    .sort((x, y) => (x.month < y.month ? -1 : 1));
  const agg = list => {
    const earned = list.reduce((s, e) => s + e.earned, 0);
    const spent = list.reduce((s, e) => s + e.spent, 0);
    const net = earned - spent;
    return { n: list.length, earned, spent, net, rate: earned > 0 ? net / earned : null };
  };
  return {
    last: agg(entries.slice(-1)),
    trailing12: agg(entries.filter(e => ymToIdx(e.month) > upto - 12)),
    overall: agg(entries),
  };
}

// Wykonanie planu na zamrożonych snapshotach (plannedSavingsSnapshot) —
// spójne z niezmiennikiem: zmiana założeń nie przepisuje przeszłych werdyktów.
export function planVsActualStats(entries) {
  const sorted = [...entries].sort((x, y) => (x.month < y.month ? -1 : 1));
  const verdicts = { crushed: 0, on_plan: 0, behind: 0, hard: 0 };
  const cumRows = [];
  let cumNet = 0, cumPlanned = 0, best = null, worst = null;
  for (const e of sorted) {
    const net = roundGrosze(e.earned - e.spent);
    const delta = net - e.plannedSavingsSnapshot;
    cumNet += net;
    cumPlanned += e.plannedSavingsSnapshot;
    if (verdicts[e.verdict] != null) verdicts[e.verdict]++;
    cumRows.push({ ym: e.month, cumNet, cumPlanned });
    if (!best || delta > best.delta) best = { ym: e.month, net, delta };
    if (!worst || delta < worst.delta) worst = { ym: e.month, net, delta };
  }
  return { n: sorted.length, cumNet, cumPlanned, cumDelta: cumNet - cumPlanned, verdicts, cumRows, best, worst };
}

// Harmonogram "sama rata" od zadanego salda (cap 1200 kroków).
export function remainingSchedule(balNominal, j, payment) {
  const rows = [];
  let bal = balNominal, totalInterest = 0;
  for (let n = 0; bal > 0 && n < 1200; n++) {
    const step = mortgageStep(bal, j, payment);
    bal = step.bal;
    totalInterest += step.interest;
    rows.push({ n: n + 1, balNominal: bal, interest: step.interest });
  }
  return { months: rows.length, totalInterest, rows };
}

// Analityka kredytu. Oszczędność z nadpłat liczona "na sztywno":
// interestSavedSoFar = Σodsetek kontraktu − zapłacone − pozostałe wg harmonogramu.
export function mortgageAnalytics(state, debt, projection) {
  const hp = state.housing.housePlan;
  if (!hp || !hp.enabled || !debt.started) return null;
  const mtg = hp.mortgage;
  const j = monthlyRate(mtg.rateNominal);
  const A = mortgagePayment(mtg);
  let paidInterest = 0, paidPrincipal = 0;
  let paidOffYm = null;
  for (const r of debt.rows) {
    paidInterest += r.interest;
    paidPrincipal += r.principalPaid;
    if (paidOffYm == null && r.balNominal <= 0) paidOffYm = r.ym;
  }
  const startIdx = ymToIdx(mtg.startMonth);
  const overpaidTotal = state.entries
    .filter(e => (e.overpayment || 0) > 0 && ymToIdx(e.month) >= startIdx)
    .reduce((s, e) => s + e.overpayment, 0);
  const balanceNominal = debt.balanceNominal;
  const lastYm = debt.rows.length ? debt.rows[debt.rows.length - 1].ym : addMonths(mtg.startMonth, -1);
  const rem = remainingSchedule(balanceNominal, j, A);
  const scheduleOnlyPayoffYm = paidOffYm || addMonths(lastYm, rem.months);
  const contract = remainingSchedule(mtg.principal, j, A);
  const contractPayoffYm = addMonths(mtg.startMonth, contract.months - 1);
  const contractTotalInterest = contract.totalInterest;
  const interestSavedSoFar = contractTotalInterest - paidInterest - rem.totalInterest;
  return {
    paidInterest, paidPrincipal, overpaidTotal, balanceNominal,
    scheduleOnlyPayoffYm, scheduleOnlyRemainingInterest: rem.totalInterest,
    contractPayoffYm, contractTotalInterest, interestSavedSoFar,
    monthsAheadOfContract: monthsBetween(scheduleOnlyPayoffYm, contractPayoffYm),
    projectedPayoffYm: projection ? projection.debtFreeYm : null,
    payment: A, rateMonthly: j, lastYm, scheduleRows: rem.rows,
  };
}

// Statystyki FIRE: FI%, majątek netto (bez wartości domu), runway, Coast FIRE.
// Coast = cel w miesiącu docelowego wieku FIRE zdyskontowany realnym zwrotem.
export function fiStats(state, balances, debt, plan, nowYm = todayYm()) {
  const a = state.assumptions;
  const target = fireTargetAt(state, nowYm);
  const netWorth = balances.cash + balances.portfolio - (debt ? debt.balanceReal : 0);
  const i = ymToIdx(nowYm) - ymToIdx(plan[0].ym);
  const row = plan[Math.min(Math.max(i, 0), plan.length - 1)];
  const monthlyExpenses = row.livingReal + row.rentReal + row.mortgagePaymentReal;
  const runwayMonths = monthlyExpenses > 0 ? (balances.cash + balances.portfolio) / monthlyExpenses : null;
  let coast = null;
  if (state.profile.birthDate && a.targetFireAge > 0) {
    const [by, bm] = state.profile.birthDate.split('-').map(Number);
    const fireAgeYm = idxToYm(by * 12 + (bm - 1) + Math.round(a.targetFireAge * 12));
    const mo = monthsBetween(nowYm, fireAgeYm);
    if (mo >= 0) {
      const number = fireTargetAt(state, fireAgeYm) / Math.pow(1 + a.realReturnAnnual, mo / 12);
      coast = { number, reached: balances.portfolio >= number - EPS, fireAgeYm };
    }
  }
  return {
    fiPct: target > 0 ? balances.portfolio / target : 0,
    target, netWorth, monthlyExpenses, runwayMonths, coast,
  };
}

// Wpłaty vs wzrost od startu planu (wzrost rezydualny — zawiera korekty sald).
export function contributionsVsGrowth(state, balances) {
  const a = state.assumptions;
  const start = (a.cashStart || 0) + (a.portfolioStart || 0);
  let totalFlow = 0, hasOverride = false;
  for (const r of balances.rows) {
    totalFlow += (r.flowCash || 0) + (r.flowPortfolio || 0);
    if (r.override) hasOverride = true;
  }
  const now = balances.cash + balances.portfolio;
  return { start, totalFlow, growth: now - start - totalFlow, now, hasOverride };
}

// ── Jeden potok po każdej mutacji ───────────────────────────────────────
// Pochodne trzymane na state.derived — nigdy nie utrwalane jako prawda.

export function recomputeDerived(state, now = new Date()) {
  const plan = buildPlan(state);
  let upto = lastCompleteMonth(now);
  // Wpisy mogą sięgać dalej niż "ostatni pełny miesiąc" tylko przy cofniętym zegarze — nie wspieramy.
  const debt = replayDebt(state, upto);
  const balances = replayBalances(state, upto, debt);
  const streak = computeStreak(state.entries);
  const projection = projectFire(state, plan, balances, debt, upto);
  state.derived = { plan, balances, debt, streak, projection, uptoYm: upto };
  return state;
}

// ── Stan początkowy ─────────────────────────────────────────────────────

export function defaultAssumptions() {
  return {
    monthlyIncome: 0,
    monthlyLivingExpenses: 0,
    cashStart: 0,
    portfolioStart: 0,
    cashReturnReal: 0,
    targetFireAge: 0,
    withdrawalRate: 0.04,
    realReturnAnnual: 0.05,
    expenseGrowthReal: 0.01,
    incomeGrowthReal: 0.03,
    inflationAnnual: 0.03,
  };
}

export function createState(partial = {}, now = new Date()) {
  const state = {
    version: 1,
    createdAt: now.toISOString(),
    anchorMonth: todayYm(now),
    profile: { birthDate: '' },
    assumptions: defaultAssumptions(),
    housing: {
      currentRentMonthly: 0,
      housePlan: {
        enabled: false,
        moveInMonth: null,
        houseSpend: { month: null, amount: null },
        businessIncomeMonthly: 0,
        businessStartMonth: null,
        mortgage: { startMonth: null, principal: 0, rateNominal: 0, termYears: 0, paymentOverrideMonthly: null },
      },
    },
    debt: { overrides: [] },
    entries: [],
    ui: { theme: 'auto', installTipDismissed: false, reminderTipShown: false, lastExportAt: null },
  };
  deepMerge(state, partial);
  return state;
}

function deepMerge(target, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])
      && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      deepMerge(target[k], src[k]);
    } else {
      target[k] = src[k];
    }
  }
  return target;
}
