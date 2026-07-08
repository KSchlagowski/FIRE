// engine.js — czysty silnik finansowy FIRE Companion.
// Zero DOM, zero storage. Wszystkie kwoty w REALNYCH zł, chyba że
// identyfikator kończy się na "Nominal". Nominalne kontrakty: kredyt
// hipoteczny oraz dług rodzinny (family loan) — oba to umowy o stałej racie.

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

// ── Kredyty nominalne: hipoteczny i rodzinny ────────────────────────────

// Rdzeń annuitetu: równa rata spłacająca principal w N miesięcy przy stopie
// miesięcznej j. override != null → rata ręczna. Współdzielony przez kredyt
// hipoteczny i dług rodzinny (oba to nominalne kontrakty o stałej racie).
export function annuityPayment(principal, j, N, override = null) {
  if (!(N > 0)) throw new Error('N musi być > 0');
  if (override != null) return override;
  if (j === 0) return principal / N;
  return principal * j / (1 - Math.pow(1 + j, -N));
}

export function mortgagePayment(mtg) {
  if (!mtg || !(mtg.termYears > 0)) throw new Error('termYears musi być > 0');
  const N = Math.round(mtg.termYears * 12);
  return annuityPayment(mtg.principal, monthlyRate(mtg.rateNominal), N, mtg.paymentOverrideMonthly);
}

// Dług rodzinny: annuitet wyprowadzony z okna spłaty [startMonth, endMonth]
// (rata włącznie z miesiącem końcowym → +1). Spłaca się dokładnie na endMonth.
export function familyLoanTermMonths(fl) {
  return ymToIdx(fl.endMonth) - ymToIdx(fl.startMonth) + 1;
}

export function familyLoanPayment(fl) {
  const N = familyLoanTermMonths(fl);
  return annuityPayment(fl.principal, monthlyRate(fl.rateNominal), N, fl.paymentOverrideMonthly);
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

// Harmonogram kontraktowy (bez nadpłat): rdzeń po (principal, rate, N, override).
export function amortizationScheduleN(principal, rateNominal, N, override = null) {
  const j = monthlyRate(rateNominal);
  const A = annuityPayment(principal, j, N, override);
  const rows = [];
  let bal = principal;
  for (let i = 0; i < N && bal > 0; i++) {
    const step = mortgageStep(bal, j, A);
    bal = step.bal;
    rows.push({ n: i + 1, balNominal: bal, interest: step.interest, principalPaid: step.principalPaid });
  }
  return rows;
}

export function amortizationSchedule(mtg) {
  return amortizationScheduleN(mtg.principal, mtg.rateNominal, Math.round(mtg.termYears * 12), mtg.paymentOverrideMonthly);
}

// Roczna dekompozycja rat na kapitał i odsetki (dane do wykresu słupkowego).
// Σ principal = principal kontraktu; Σ (principal+interest) = Σ rat.
export function yearlyPrincipalInterest(rows, groupBy = 12) {
  const years = [];
  for (let k = 0; k < rows.length; k += groupBy) {
    const chunk = rows.slice(k, k + groupBy);
    let principal = 0, interest = 0;
    for (const r of chunk) { principal += r.principalPaid; interest += r.interest; }
    years.push({ year: k / groupBy + 1, principal, interest });
  }
  return years;
}

// „Ile zostało do spłaty" na początku każdego roku kredytu: kapitał (saldo)
// + wszystkie przyszłe odsetki (suma sufiksowa, jeden przebieg wsteczny).
// Tożsamość (kontrakt annuitetowy): principal_k + interest_k ≈ A × pozostałe raty.
export function yearlyRemainingToPay(rows, principal, groupBy = 12) {
  const suffix = new Array(rows.length + 1).fill(0);
  for (let i = rows.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + rows[i].interest;
  const years = [];
  for (let k = 0; k * groupBy < rows.length; k++) {
    years.push({
      year: k + 1,
      principal: k === 0 ? principal : rows[k * groupBy - 1].balNominal,
      interest: suffix[k * groupBy],
    });
  }
  return years;
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
  const flOn = houseOn && hp.familyLoan && hp.familyLoan.enabled;
  const A_fam = flOn ? familyLoanPayment(hp.familyLoan) : 0;
  const flStart = flOn ? ymToIdx(hp.familyLoan.startMonth) : Infinity;
  const flEnd = flOn ? ymToIdx(hp.familyLoan.endMonth) : Infinity; // włącznie
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
    const inFam = idx >= flStart && idx <= flEnd;
    const familyPaymentReal = inFam ? A_fam * Math.pow(1 + a.inflationAnnual, -(t - 1)) : 0;
    const plannedSavings = incomeReal - livingReal - rentReal - mortgagePaymentReal - familyPaymentReal;
    const targetReal = fireTargetAt(state, ym);
    // Faza wciąż sterowana kredytem; rata rodzinna tylko obniża plannedSavings.
    const phase = houseOn ? (idx < mStart ? 'saving' : inTerm ? 'debt' : 'invest') : 'invest';
    rows.push({ ym, t, incomeReal, livingReal, rentReal, mortgagePaymentReal, familyPaymentReal, plannedSavings, targetReal, phase });
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

const EMPTY_LOAN = () => ({
  active: false, started: false, balanceNominal: 0, balanceReal: 0,
  paidPct: 0, rows: [], byMonth: new Map(),
});

// Rdzeń replayu kredytu — współdzielony przez kredyt hipoteczny (overpayKey
// 'overpayment', korekty debt.overrides) i dług rodzinny (overpayKey
// 'familyOverpayment', korekty debt.familyOverrides). Publiczne API obu
// pozostaje niezmienione.
function replayLoanCore({ start, principal, j, payment, overpayKey, overrides }, state, uptoYm) {
  const upto = ymToIdx(uptoYm);
  if (upto < start) return EMPTY_LOAN();
  const entriesByMonth = new Map(state.entries.map(e => [ymToIdx(e.month), e]));
  const ov = new Map((overrides || []).map(o => [ymToIdx(o.month), o.balanceNominal]));
  let bal = principal;
  const rows = [];
  const byMonth = new Map();
  for (let idx = start; idx <= upto; idx++) {
    const balStart = bal;
    let interest = 0, principalPaid = 0, spill = 0;
    if (bal > 0) {
      const e = entriesByMonth.get(idx);
      const overpay = e ? (e[overpayKey] || 0) : 0;
      const step = mortgageStep(bal, j, payment, overpay);
      bal = step.bal;
      interest = step.interest;
      principalPaid = step.principalPaid;
      spill = step.spill;
    }
    if (ov.has(idx)) bal = ov.get(idx); // korekta ręczna resetuje łańcuch
    byMonth.set(idx, { balStart, bal, spill });
    rows.push({ ym: idxToYm(idx), balNominal: bal, interest, principalPaid, spill });
  }
  return {
    active: bal > 0,
    started: true,
    balanceNominal: bal,
    balanceReal: toReal(bal, state.anchorMonth, uptoYm, state.assumptions.inflationAnnual),
    paidPct: principal > 0 ? (principal - bal) / principal : 0,
    rows,
    byMonth,
  };
}

export function replayDebt(state, uptoYm) {
  const hp = state.housing.housePlan;
  if (!hp || !hp.enabled) return EMPTY_LOAN();
  const mtg = hp.mortgage;
  return replayLoanCore({
    start: ymToIdx(mtg.startMonth),
    principal: mtg.principal,
    j: monthlyRate(mtg.rateNominal),
    payment: mortgagePayment(mtg),
    overpayKey: 'overpayment',
    overrides: state.debt.overrides,
  }, state, uptoYm);
}

// Dług rodzinny topi się równolegle do kredytu (ta sama zasada „podwójnego
// zapisu”): rata siedzi w wydatkach użytkownika, saldo melduje się tutaj.
export function replayFamilyLoan(state, uptoYm) {
  const hp = state.housing.housePlan;
  const fl = hp && hp.familyLoan;
  if (!hp || !hp.enabled || !fl || !fl.enabled) return EMPTY_LOAN();
  return replayLoanCore({
    start: ymToIdx(fl.startMonth),
    principal: fl.principal,
    j: monthlyRate(fl.rateNominal),
    payment: familyLoanPayment(fl),
    overpayKey: 'familyOverpayment',
    overrides: state.debt.familyOverrides,
  }, state, uptoYm);
}

// ── Podatki: Belka + IKE/IKZE ────────────────────────────────────────────
// Basis (koszt nabycia) śledzony NOMINALNIE w epoce kotwicy — podatek Belki
// liczy się od zysków nominalnych, więc zysk czysto inflacyjny też jest
// opodatkowany (realnie oddajesz więcej niż 19% realnego zysku). Konwersje
// wyłącznie przez toNominal/toReal (inwariant repo). IKE/IKZE: trzy kubełki
// portfela (wpłaty IKZE → IKE → taxable wg limitów rocznych, D6), zwrot PIT
// w kwietniu następnego roku (D7), podatek przy wypłacie zależny od wieku
// (D4/D10). Limity stałe realnie na poziomie 2026 (D5).

export const BELKA_RATE = 0.19;
export const IKZE_EXIT_RATE = 0.10;           // ryczałt przy wypłacie po 65
export const IKE_ACCESS_AGE = 60;             // pełne lata (D4)
export const IKZE_ACCESS_AGE = 65;
export const IKE_LIMIT_YEARLY = 28260;        // 2026, realnie (D5)
export const IKZE_LIMIT_EMPLOYEE = 11304;     // 2026, realnie
export const IKZE_LIMIT_SELFEMPLOYED = 16956; // 2026, realnie
export const IKZE_REFUND_MONTH = 4;           // kwiecień (D7)

// Aktywność podatków — jedno miejsce prawdy dla pętli i UI.
export function taxesActive(state) {
  const t = state.taxes || {};
  const ik = t.ikeIkze || {};
  return { belka: !!t.belkaEnabled, ikeIkze: !!ik.enabled, any: !!t.belkaEnabled || !!ik.enabled };
}

// Roczny limit wpłat na IKZE zależy od formy zatrudnienia (D5).
export function ikzeLimitFor(taxes) {
  return (((taxes || {}).ikeIkze || {}).employmentForm === 'selfEmployed')
    ? IKZE_LIMIT_SELFEMPLOYED : IKZE_LIMIT_EMPLOYEE;
}

// Udział zysku NOMINALNEGO: 1 − basisNominal / wartośćNominalna, clamp [0,1].
// Wartość ≤ EPS → 0 (puste/ujemne saldo nie generuje podatku).
export function gainShareOf(valueReal, basisNominal, anchor, ym, infl) {
  if (!(valueReal > EPS)) return 0;
  const nom = toNominal(valueReal, anchor, ym, infl);
  return Math.min(1, Math.max(0, 1 - basisNominal / nom));
}

// Cel brutto (gross-up) — TYLKO do wyświetlenia różnicy celu w Analizie.
export function belkaGrossTarget(targetNetReal, gainShare, rate = BELKA_RATE) {
  return targetNetReal / (1 - rate * Math.min(1, Math.max(0, gainShare)));
}

// Tracker podatkowy portfela: trzy kubełki (taxable / IKE / IKZE, realnie) +
// koszt nabycia (nominalnie, epoka kotwicy; IKZE bez basisu — ryczałt liczy
// się od CAŁEJ kwoty). Tworzony WEWNĄTRZ każdego przebiegu replay/projekcji
// (zero stanu modułu — funkcje pozostają czyste). Tracker tylko OBSERWUJE
// przepływy: salda liczone obok są bit-w-bit identyczne z podatkami i bez
// nich. Z wyłączonym ikeIkze wszystko trafia do taxable — zachowanie
// identyczne z trackerem jednokubełkowym z wydania Belki (F30 zielone).
// snapshot wznawia tracker na szwie historia→prognoza.
export function makeTaxTracker(state, snapshot = null) {
  const anchor = state.anchorMonth;
  const infl = state.assumptions.inflationAnnual;
  const t = state.taxes || {};
  const ik = t.ikeIkze || {};
  const ikeIkzeOn = !!ik.enabled;
  const belkaOn = !!t.belkaEnabled;
  const pitRate = ik.pitRate != null ? ik.pitRate : 0.12;
  const ikzeLimit = ikzeLimitFor(t);
  const birth = (state.profile && state.profile.birthDate) || '';
  // D8: portfel startowy w całości jako wpłaty (basis = wartość; kotwica ⇒
  // indeks cen 1, więc nominał = real). ikeStart/ikzeStart dzielą portfel
  // startowy między kubełki; NIE liczą się do limitów bieżącego roku.
  let taxable, ike, ikze, taxableBasisNominal, ikeBasisNominal;
  let ytdIkze = 0, ytdIke = 0, prevYearIkze = 0, year = Number(anchor.slice(0, 4));
  if (snapshot) {
    const legacy = snapshot.taxable == null; // stary kształt { value, basisNominal }
    taxable = legacy ? snapshot.value : snapshot.taxable;
    ike = legacy ? 0 : snapshot.ike;
    ikze = legacy ? 0 : snapshot.ikze;
    taxableBasisNominal = legacy ? snapshot.basisNominal : snapshot.taxableBasisNominal;
    ikeBasisNominal = legacy ? 0 : snapshot.ikeBasisNominal;
    ytdIkze = snapshot.ytdIkze || 0;
    ytdIke = snapshot.ytdIke || 0;
    prevYearIkze = snapshot.prevYearIkze || 0;
    if (snapshot.year != null) year = snapshot.year;
  } else {
    ike = ikeIkzeOn ? (ik.ikeStart || 0) : 0;
    ikze = ikeIkzeOn ? (ik.ikzeStart || 0) : 0;
    taxable = (state.assumptions.portfolioStart || 0) - ike - ikze;
    taxableBasisNominal = Math.max(0, taxable);
    ikeBasisNominal = Math.max(0, ike);
  }
  return {
    // Początek miesiąca: przełom roku zeruje liczniki wpłat (skok > 1 rok →
    // przepada też zwrot). Zwraca kwotę zwrotu PIT (realnie) należną w tym
    // miesiącu — wołający decyduje, czy ją wstrzyknąć (prognoza: tak;
    // historia: ignoruje — wpisy są prawdą, D7).
    beginMonth(ym) {
      const y = Number(ym.slice(0, 4));
      if (y > year) {
        prevYearIkze = (y === year + 1) ? ytdIkze : 0;
        ytdIkze = 0; ytdIke = 0; year = y;
      }
      return (ikeIkzeOn && Number(ym.slice(5, 7)) === IKZE_REFUND_MONTH) ? pitRate * prevYearIkze : 0;
    },
    // Zwykła wpłata (c ≥ 0, realnie): IKZE → IKE → taxable wg limitów (D6);
    // basis rośnie o ówczesną wartość nominalną wpłaty.
    contribute(cReal, ym) {
      let rest = cReal;
      if (ikeIkzeOn) {
        const toIkze = Math.min(rest, Math.max(0, ikzeLimit - ytdIkze));
        ikze += toIkze; ytdIkze += toIkze; rest -= toIkze;
        const toIke = Math.min(rest, Math.max(0, IKE_LIMIT_YEARLY - ytdIke));
        ike += toIke; ikeBasisNominal += toNominal(toIke, anchor, ym, infl);
        ytdIke += toIke; rest -= toIke;
      }
      taxable += rest;
      taxableBasisNominal += toNominal(rest, anchor, ym, infl);
    },
    // Wpływ omijający limity (spill z kredytów, D6) — prosto do taxable.
    contributeTaxable(cReal, ym) {
      taxable += cReal;
      taxableBasisNominal += toNominal(cReal, anchor, ym, infl);
    },
    // Wypłata/deficyt: taxable → IKE → IKZE (D6); basis maleje PROPORCJONALNIE
    // — czynnik (bal−x)/bal liczony na realach jest niezależny od epoki.
    // Nadmierny drenaż ponad sumę kubełków ujemni taxable, bases z podłogą 0
    // (dług nie generuje podatku).
    withdraw(wReal) {
      const fromT = Math.min(Math.max(taxable, 0), wReal);
      if (taxable > EPS) taxableBasisNominal *= Math.max(0, taxable - fromT) / taxable;
      taxable -= fromT;
      let rest = wReal - fromT;
      const fromI = Math.min(Math.max(ike, 0), rest);
      if (ike > EPS) ikeBasisNominal *= Math.max(0, ike - fromI) / ike;
      ike -= fromI; rest -= fromI;
      const fromZ = Math.min(Math.max(ikze, 0), rest);
      ikze -= fromZ; rest -= fromZ;
      if (rest > 0) taxable -= rest;
    },
    // Wzrost miesięczny: kubełki × (1+r); bases bez zmian (wzrost to zysk).
    grow(rMonthly) { taxable *= 1 + rMonthly; ike *= 1 + rMonthly; ikze *= 1 + rMonthly; },
    // Korekta salda (D9): skaluj kubełki i bases przez new/old — zachowuje
    // udziały zysku i miks kont. Stara suma ≤ EPS → wszystko do taxable.
    setTotal(newTotalReal, ym) {
      const tot = taxable + ike + ikze;
      if (tot > EPS) {
        const f = newTotalReal / tot;
        ike *= f; ikze *= f;
        taxable = newTotalReal - ike - ikze; // suma kubełków dokładnie = korekta
        taxableBasisNominal *= f; ikeBasisNominal *= f;
      } else {
        taxable = newTotalReal; ike = 0; ikze = 0;
        taxableBasisNominal = Math.max(0, toNominal(newTotalReal, anchor, ym, infl));
        ikeBasisNominal = 0;
      }
    },
    // Wartość netto „jakby zlikwidować dziś" (warunek FIRE, D3/D4): taxable i
    // wczesne IKE płacą Belkę od zysków (gdy włączona), IKE po 60 bez podatku,
    // IKZE 10% ryczałtu po 65, wcześniej stawka PIT od CAŁOŚCI (niezależnie
    // od Belki — to PIT, D11). Brak daty urodzenia → stawki „wczesne".
    // Kubełek ≤ EPS wyceniany surowo (rezydualny minus nie niesie podatku).
    netValueReal(ym) {
      const age = birth ? ageAt(birth, ym).years : -1;
      const gT = gainShareOf(taxable, taxableBasisNominal, anchor, ym, infl);
      const taxableNet = belkaOn ? taxable * (1 - BELKA_RATE * gT) : taxable;
      const gI = gainShareOf(ike, ikeBasisNominal, anchor, ym, infl);
      const ikeNet = age >= IKE_ACCESS_AGE ? ike : (belkaOn ? ike * (1 - BELKA_RATE * gI) : ike);
      const ikzeNet = ikze > EPS
        ? (age >= IKZE_ACCESS_AGE ? ikze * (1 - IKZE_EXIT_RATE) : ikze * (1 - pitRate))
        : ikze;
      return taxableNet + ikeNet + ikzeNet;
    },
    // Udział zysku KONTA ZWYKŁEGO — karta Belki (pojedyncza liczba celu brutto).
    gainShare(ym) { return gainShareOf(taxable, taxableBasisNominal, anchor, ym, infl); },
    row() { return { taxable, ike, ikze, taxableBasisNominal, ikeBasisNominal }; },
    snapshot() {
      return {
        taxable, ike, ikze, taxableBasisNominal, ikeBasisNominal,
        ytdIkze, ytdIke, prevYearIkze, year,
        value: taxable + ike + ikze,                          // sumy dla zgodności
        basisNominal: taxableBasisNominal + ikeBasisNominal,  // (F30, karta Belki)
      };
    },
  };
}

// ── Replay sald: gotówka (fundusz na dom) + portfel inwestycyjny ────────
// Routing wg fazy: przed startem kredytu → gotówka; w długu → gotówka;
// po spłacie (lub bez planu domu) → portfel. Deficyty drenują najpierw
// gotówkę, potem portfel. Miesiące bez wpisu: tylko wzrost.

export function replayBalances(state, uptoYm, debtRes = null, familyRes = null) {
  const a = state.assumptions;
  const a0 = ymToIdx(state.anchorMonth);
  const upto = ymToIdx(uptoYm);
  const rPort = monthlyRate(a.realReturnAnnual);
  const rCash = monthlyRate(a.cashReturnReal || 0);
  const hp = state.housing.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const debt = debtRes || replayDebt(state, uptoYm);
  const family = familyRes || replayFamilyLoan(state, uptoYm);
  const mStart = houseOn ? ymToIdx(hp.mortgage.startMonth) : Infinity;
  const hsMonth = houseOn ? ymToIdx((hp.houseSpend && hp.houseSpend.month) || hp.mortgage.startMonth) : Infinity;
  const hsAmount = houseOn && hp.houseSpend ? hp.houseSpend.amount : null;
  const entriesByMonth = new Map(state.entries.map(e => [ymToIdx(e.month), e]));
  // Tracker podatkowy tylko OBSERWUJE — cash/portfolio i pola wierszy są
  // bit-w-bit identyczne z podatkami i bez nich (test F30g).
  const tracker = taxesActive(state).any ? makeTaxTracker(state) : null;

  let cash = a.cashStart || 0;
  let portfolio = a.portfolioStart || 0;
  let houseUnderfunded = false;
  let houseSpent = 0;
  const rows = [];

  for (let idx = a0; idx <= upto; idx++) {
    const ym = idxToYm(idx);
    // Przełom roku zeruje liczniki limitów; zwrot PIT IGNOROWANY w historii —
    // wpisy są prawdą i zawierają zwrot, który faktycznie przyszedł (D7).
    if (tracker) tracker.beginMonth(ym);
    const e = entriesByMonth.get(idx);
    const net = e ? roundGrosze(e.earned - e.spent) : 0;
    const contribution = e ? roundGrosze(net - (e.overpayment || 0) - (e.familyOverpayment || 0)) : 0;
    const d = debt.byMonth.get(idx);
    const fd = family.byMonth.get(idx);
    let flowCash = 0, flowPortfolio = 0; // przepływy (bez wzrostu i bez korekt sald)
    let phase;
    if (!houseOn) phase = 'invest';
    else if (idx < mStart) phase = 'saving';
    else if (d && d.balStart > EPS) phase = 'debt';
    else phase = 'invest';

    if (contribution >= 0) {
      if (phase === 'saving' || phase === 'debt') { cash += contribution; flowCash += contribution; }
      else {
        portfolio += contribution; flowPortfolio += contribution;
        if (tracker) tracker.contribute(contribution, ym);
      }
    } else {
      let deficit = -contribution;
      const fromCash = Math.min(cash, deficit);
      cash -= fromCash;
      deficit -= fromCash;
      portfolio -= deficit;
      flowCash -= fromCash;
      flowPortfolio -= deficit;
      if (tracker) tracker.withdraw(deficit); // tylko część portfelowa (po gotówce)
    }

    if (d && d.spill > 0) { portfolio += d.spill; flowPortfolio += d.spill; if (tracker) tracker.contributeTaxable(d.spill, ym); } // nadpłata ponad spłatę wraca do inwestycji (poza limitami, D6)
    if (fd && fd.spill > 0) { portfolio += fd.spill; flowPortfolio += fd.spill; if (tracker) tracker.contributeTaxable(fd.spill, ym); } // nadpłata długu rodzinnego ponad saldo → portfel (poza limitami, D6)

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
      if (tracker) tracker.withdraw(fromPort);
    }

    cash *= 1 + rCash;
    portfolio *= 1 + rPort;
    if (tracker) tracker.grow(rPort);

    // Korekty sald to NIE przepływ — ich efekt ląduje w rezydualnym "wzroście".
    const override = !!(e && (e.cashOverride != null || e.balanceOverride != null));
    if (e && e.cashOverride != null) cash = e.cashOverride;
    if (e && e.balanceOverride != null) {
      portfolio = e.balanceOverride;
      if (tracker) tracker.setTotal(e.balanceOverride, ym); // cashOverride nie dotyka trackera
    }

    const trRow = tracker ? tracker.row() : null;
    rows.push({
      ym, cash, portfolio, net, contribution, phase, hasEntry: !!e, flowCash, flowPortfolio, override,
      ...(trRow ? {
        buckets: trRow,
        basisNominal: trRow.taxableBasisNominal + trRow.ikeBasisNominal,
        netPortfolio: tracker.netValueReal(ym),
      } : {}),
    });
  }
  return { cash, portfolio, rows, houseUnderfunded, houseSpent, taxSnapshot: tracker ? tracker.snapshot() : null };
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
  const familyOverpayment = roundGrosze(Number(input.familyOverpayment || 0));
  if (!(earned >= 0) || !(spent >= 0)) throw new Error('Kwoty muszą być liczbami ≥ 0');
  if (overpayment < 0) throw new Error('Nadpłata nie może być ujemna');
  if (familyOverpayment < 0) throw new Error('Nadpłata długu rodzinnego nie może być ujemna');
  if (overpayment > 0) {
    const debt = replayDebt(state, month);
    const d = debt.byMonth.get(ymToIdx(month));
    if (!d || d.balStart <= EPS) throw new Error('Nadpłata możliwa tylko przy aktywnym kredycie');
  }
  if (familyOverpayment > 0) {
    const family = replayFamilyLoan(state, month);
    const f = family.byMonth.get(ymToIdx(month));
    if (!f || f.balStart <= EPS) throw new Error('Nadpłata możliwa tylko przy aktywnym długu rodzinnym');
  }

  const plan = buildPlan(state);
  // Snapshot planu zamrożony przy tworzeniu; jawna edycja go odświeża.
  const plannedSavingsSnapshot = plannedSavingsFor(plan, month);
  const net = roundGrosze(earned - spent);
  const entry = {
    month, earned, spent, overpayment, familyOverpayment,
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
      const family = replayFamilyLoan(state, upto);
      const bal = replayBalances(state, upto, debt, family);
      state.assumptions.cashStart = roundGrosze(bal.cash);
      state.assumptions.portfolioStart = roundGrosze(bal.portfolio);
    }
  }
  state.anchorMonth = newAnchor;
  recomputeDerived(state, now);
}

// Historia: dodaj wcześniejszy miesiąc — cofa start planu o 1 miesiąc.
// Salda startowe zostają (to stan początku nowego, wcześniejszego miesiąca),
// dokładnie jak reanchor wstecz. Otwiera pusty miesiąc do check-inu.
export function addEarlierMonth(state, now = new Date()) {
  reanchor(state, addMonths(state.anchorMonth, -1), now);
}

// Historia: usuń najwcześniejszy miesiąc — przesuwa start planu o 1 miesiąc w
// przód, ZACHOWUJĄC salda startowe (dokładna odwrotność addEarlierMonth). Jeśli
// ten miesiąc ma wpis, usuwa go wraz z werdyktem. Startu nie można przesunąć poza
// bieżący miesiąc.
export function removeEarliestMonth(state, now = new Date()) {
  const anchor = state.anchorMonth;
  if (ymToIdx(addMonths(anchor, 1)) > ymToIdx(todayYm(now))) {
    throw new Error('Nie można przesunąć startu w przyszłość');
  }
  const i = state.entries.findIndex(e => e.month === anchor);
  if (i >= 0) state.entries.splice(i, 1);
  state.anchorMonth = addMonths(anchor, 1);
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

export function projectFire(state, plan, balances, debtRes, familyRes, uptoYm, opts = {}) {
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
  const flOn = houseOn && hp.familyLoan && hp.familyLoan.enabled;
  const jFam = flOn ? monthlyRate(hp.familyLoan.rateNominal) : 0;
  const A_fam = flOn ? familyLoanPayment(hp.familyLoan) : 0;
  const flStart = flOn ? ymToIdx(hp.familyLoan.startMonth) : Infinity;
  const flEnd = flOn ? ymToIdx(hp.familyLoan.endMonth) : Infinity;

  let cash = balances.cash;
  let portfolio = balances.portfolio;
  let debtBal = 0;
  let debtStarted = false;
  if (houseOn && debtRes.started) {
    debtBal = debtRes.balanceNominal;
    debtStarted = true;
  }
  let famBal = 0;
  let famStarted = false;
  if (flOn && familyRes.started) {
    famBal = familyRes.balanceNominal;
    famStarted = true;
  }
  let houseDone = houseOn ? upto >= hsMonth : true;
  let houseShortfall = false;

  // Tracker podatkowy wznawiany ze snapshotu historii (szew replay→prognoza).
  // Brak snapshotu (obcy wywołujący) → konserwatywnie: cały portfel jako
  // wpłaty w uptoYm (gainShare 0, podatek zaniżony — udokumentowane).
  const active = taxesActive(state);
  const tracker = active.any
    ? makeTaxTracker(state, balances.taxSnapshot
      || { taxable: balances.portfolio, ike: 0, ikze: 0,
        taxableBasisNominal: Math.max(0, toNominal(balances.portfolio, anchor, uptoYm, a.inflationAnnual)),
        ikeBasisNominal: 0, ytdIkze: 0, ytdIke: 0, prevYearIkze: 0,
        year: Number(uptoYm.slice(0, 4)) })
    : null;

  const series = balances.rows.map(r => ({
    ym: r.ym, cash: r.cash, portfolio: r.portfolio,
    flowCash: r.flowCash, flowPortfolio: r.flowPortfolio, override: r.override,
    ...(r.basisNominal != null ? { basisNominal: r.basisNominal, netPortfolio: r.netPortfolio, buckets: r.buckets } : {}),
    debtReal: (debtRes.byMonth.get(ymToIdx(r.ym)) || { bal: 0 }).bal
      / Math.pow(1 + a.inflationAnnual, monthsBetween(anchor, r.ym) / 12),
    familyReal: (familyRes.byMonth.get(ymToIdx(r.ym)) || { bal: 0 }).bal
      / Math.pow(1 + a.inflationAnnual, monthsBetween(anchor, r.ym) / 12),
    target: fireTargetAt(state, r.ym),
    projected: false,
  }));

  let fireYm = null;
  let debtFreeYm = null;
  let familyFreeYm = null;
  if (debtStarted && debtBal <= EPS) debtFreeYm = uptoYm;
  if (famStarted && famBal <= EPS) familyFreeYm = uptoYm;

  const startIdx = Math.max(upto + 1, a0);
  for (let idx = startIdx; idx < a0 + plan.length; idx++) {
    const pm = plan[idx - a0];
    const ym = pm.ym;
    if (houseOn && idx >= mStart && !debtStarted) {
      debtBal = hp.mortgage.principal;
      debtStarted = true;
    }
    const debtActive = houseOn && debtStarted && debtBal > 0;
    // Zwrot PIT za zeszłoroczne wpłaty na IKZE wpada do kwietniowych
    // oszczędności — tylko w miesiącach PROGNOZY (D7); z wyłączonym ikeIkze
    // beginMonth zwraca 0 i s pozostaje bez zmian.
    const refund = tracker ? tracker.beginMonth(ym) : 0;
    const s = pm.plannedSavings + delta + refund;
    let flowCash = 0, flowPortfolio = 0;

    // Dług rodzinny topi się równolegle wg harmonogramu (bez auto-nadpłat).
    // Rata jest już odjęta w plannedSavings, więc s (nadwyżka nadpłacająca
    // kredyt) jej nie dubluje. Spill z ostatniej raty wraca do portfela.
    if (flOn && idx >= flStart && !famStarted) { famBal = hp.familyLoan.principal; famStarted = true; }
    if (famStarted && famBal > EPS && idx <= flEnd) {
      const stepF = mortgageStep(famBal, jFam, A_fam);
      famBal = stepF.bal;
      if (stepF.spill > 0) {
        const spillReal = toReal(stepF.spill, anchor, ym, a.inflationAnnual);
        portfolio += spillReal;
        flowPortfolio += spillReal;
        if (tracker) tracker.contributeTaxable(spillReal, ym); // poza limitami (D6)
      }
      if (famBal <= EPS && !familyFreeYm) { famBal = 0; familyFreeYm = ym; }
    }

    if (debtActive) {
      // Strategia: cała nadwyżka nadpłaca kredyt (konwersja na nominał).
      const overpayNominal = s > 0 ? toNominal(s, anchor, ym, a.inflationAnnual) : 0;
      const step = mortgageStep(debtBal, j, A, overpayNominal);
      debtBal = step.bal;
      if (step.spill > 0) {
        const spillReal = toReal(step.spill, anchor, ym, a.inflationAnnual);
        portfolio += spillReal;
        flowPortfolio += spillReal;
        if (tracker) tracker.contributeTaxable(spillReal, ym); // poza limitami (D6)
      }
      if (s < 0) {
        let deficit = -s;
        const fromCash = Math.min(cash, deficit);
        cash -= fromCash;
        portfolio -= deficit - fromCash;
        flowCash -= fromCash;
        flowPortfolio -= deficit - fromCash;
        if (tracker) tracker.withdraw(deficit - fromCash);
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
        if (tracker) tracker.withdraw(deficit - fromCash);
      }
    } else {
      if (s >= 0) {
        portfolio += s; flowPortfolio += s;
        if (tracker) tracker.contribute(s, ym);
      } else {
        let deficit = -s;
        const fromCash = Math.min(cash, deficit);
        cash -= fromCash;
        portfolio -= deficit - fromCash;
        flowCash -= fromCash;
        flowPortfolio -= deficit - fromCash;
        if (tracker) tracker.withdraw(deficit - fromCash);
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
      if (tracker) tracker.withdraw(fromPort);
    }

    cash *= 1 + rCash;
    portfolio *= 1 + rPort;
    if (tracker) tracker.grow(rPort);

    const trRow = tracker ? tracker.row() : null;
    series.push({
      ym, cash, portfolio, flowCash, flowPortfolio, override: false,
      debtReal: toReal(debtBal, anchor, ym, a.inflationAnnual),
      familyReal: toReal(famBal, anchor, ym, a.inflationAnnual),
      target: pm.targetReal,
      projected: true,
      ...(trRow ? {
        buckets: trRow,
        basisNominal: trRow.taxableBasisNominal + trRow.ikeBasisNominal,
        netPortfolio: tracker.netValueReal(ym),
      } : {}),
    });

    const houseSettled = !houseOn || (debtStarted && debtBal <= EPS && idx >= hsMonth);
    const famSettled = !flOn || (famStarted && famBal <= EPS);
    // Warunek FIRE z podatkami: portfel "po podatku" ≥ cel netto (D3).
    const effective = tracker ? tracker.netValueReal(ym) : portfolio;
    if (!fireYm && houseSettled && famSettled && effective >= pm.targetReal - EPS) {
      fireYm = ym;
      // stopAtFire:false (pasmo prognozy) biegnie dalej do końca planu —
      // po FIRE miesiące dalej idą istniejącą ścieżką invest (dług spłacony).
      if (opts.stopAtFire !== false) break;
    }
  }

  const reached = fireYm != null;
  const fireAge = reached ? ageAt(state.profile.birthDate, fireYm) : null;
  const onTrack = reached && fireAge.totalMonths <= state.assumptions.targetFireAge * 12;
  return { reached, fireYm, fireAge, debtFreeYm, familyFreeYm, onTrack, series, delta, byPlanOnly, houseShortfall, taxes: active };
}

// ── Analiza (tabele i statystyki) ───────────────────────────────────────
// Funkcje czyste, liczone przy renderze ekranu #/analiza — NIE w
// recomputeDerived (potrzebne tylko tam, a recompute biegnie po każdej mutacji).

// ── Faza emerytalna: opcje ──────────────────────────────────────────────
// Jeden znormalizowany obiekt opcji fazy emerytalnej (wypłat). Domyślne wartości
// z zapisanych założeń; `overrides` to what-ify z Symulacji (nic nie zapisują).
// Kolejne pola (ZUS…) dojdą tu w przyszłych funkcjach.
export function retirementOpts(state, overrides = {}) {
  const a = state.assumptions;
  return {
    postReturnReal: overrides.postReturnReal != null ? overrides.postReturnReal
      : (a.postRetirementReturnReal != null ? a.postRetirementReturnReal : 0.02),
    freezeExpenses: overrides.freezeExpenses != null ? overrides.freezeExpenses
      : (a.freezeExpensesAtRetirement != null ? a.freezeExpensesAtRetirement : true),
  };
}

// Faza wypłat: rekurencja w REALNYCH zł, kolumny nominalne pochodne.
// Epoka nominalna = startYm (indeks cen 1 w miesiącu przejścia na FIRE —
// konwencja arkusza Faza wypłat): start_n = real·(1+i)^(n−1), end_n = real·(1+i)^n.
export function projectWithdrawal(state, opts = {}) {
  const a = state.assumptions;
  const ro = opts.ro || retirementOpts(state);
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
  const realRate = ro.postReturnReal;
  const wG = 1 + (ro.freezeExpenses ? 0 : a.expenseGrowthReal);
  const inflation = a.inflationAnnual;
  const nominalRate = (1 + realRate) * (1 + inflation) - 1;
  const withdrawalRealYearly = opts.withdrawalRealYearly != null
    ? opts.withdrawalRealYearly
    : fireTargetAt(state, startYm) * swr;
  const priceFactorAtStart = Math.pow(1 + inflation, monthsBetween(state.anchorMonth, startYm) / 12);
  const birth = state.profile.birthDate;
  const startAge = birth ? ageAt(birth, startYm).years : null;

  // Podatki: kubełki (realnie) + bases (nominalnie, epoka kotwicy) zasiewane
  // z wiersza serii prognozy w startYm (albo najbliższego wcześniejszego),
  // przeskalowane przez startPortfolioReal/portfel wiersza — zachowuje udziały
  // zysku i miks kont. Bez serii / bez kubełków na wierszach → cały portfel
  // jako wpłaty na taxable (gainShare 0, konserwatywnie zaniża podatek —
  // udokumentowane w metodologii).
  const active = taxesActive(state);
  const anchor = state.anchorMonth;
  const ikCfg = (state.taxes || {}).ikeIkze || {};
  const pitRate = ikCfg.pitRate != null ? ikCfg.pitRate : 0.12;
  let bT = 0, bIke = 0, bIkze = 0, basisT = 0, basisIke = 0;
  if (active.any) {
    let seedRow = null;
    if (proj && proj.series) {
      const sIdx = ymToIdx(startYm);
      for (const r of proj.series) {
        if (ymToIdx(r.ym) > sIdx) break;
        if (r.basisNominal != null) seedRow = r;
      }
    }
    if (seedRow && seedRow.buckets && seedRow.portfolio > EPS) {
      const f = startPortfolioReal / seedRow.portfolio;
      bT = seedRow.buckets.taxable * f;
      bIke = seedRow.buckets.ike * f;
      bIkze = seedRow.buckets.ikze * f;
      basisT = seedRow.buckets.taxableBasisNominal * f;
      basisIke = seedRow.buckets.ikeBasisNominal * f;
    } else if (seedRow && seedRow.portfolio > EPS) {
      bT = startPortfolioReal; // stary wiersz bez kubełków — wszystko taxable
      basisT = seedRow.basisNominal * (startPortfolioReal / seedRow.portfolio);
    } else {
      bT = startPortfolioReal;
      basisT = Math.max(0, toNominal(startPortfolioReal, anchor, startYm, inflation));
    }
  }

  const rows = [];
  let depletedYear = null;
  let taxTotalReal = 0;
  let bal = startPortfolioReal;
  for (let n = 1; n <= years; n++) {
    const ym = addMonths(startYm, (n - 1) * 12);
    const startReal = bal;
    const withdrawalReal = withdrawalRealYearly * Math.pow(wG, n - 1);
    let endReal, taxReal = 0, grossReal = withdrawalReal;
    if (active.any) {
      // Wypłata brutto per kubełek, kolejność taxable → IKE → IKZE (D10) —
      // konta z ulgami pracują najdłużej. Każda noga powiększona tak, by
      // NETTO pokryło wydatki: taxable 19% × udział zysku (gdy Belka), IKE
      // 0% po 60 (wcześniej jak taxable), IKZE po 65 ryczałt 10%, wcześniej
      // stawka PIT — od CAŁEJ kwoty, bez basisu (ułamki udziału zysku
      // niezmiennicze względem epoki).
      const age = birth ? ageAt(birth, ym).years : -1;
      let need = withdrawalReal;
      let grossSum = 0;
      { // 1) konto zwykłe
        const g = gainShareOf(bT, basisT, anchor, ym, inflation);
        const r = active.belka ? BELKA_RATE * g : 0;
        const gross = Math.min(Math.max(bT, 0), need / (1 - r));
        if (bT > EPS) basisT *= (bT - gross) / bT;
        bT -= gross; need -= gross * (1 - r); taxReal += gross * r; grossSum += gross;
      }
      { // 2) IKE
        const g = gainShareOf(bIke, basisIke, anchor, ym, inflation);
        const r = age >= IKE_ACCESS_AGE ? 0 : (active.belka ? BELKA_RATE * g : 0);
        const gross = Math.min(Math.max(bIke, 0), need / (1 - r));
        if (bIke > EPS) basisIke *= (bIke - gross) / bIke;
        bIke -= gross; need -= gross * (1 - r); taxReal += gross * r; grossSum += gross;
      }
      { // 3) IKZE
        const r = age >= IKZE_ACCESS_AGE ? IKZE_EXIT_RATE : pitRate;
        const gross = Math.min(Math.max(bIkze, 0), need / (1 - r));
        bIkze -= gross; need -= gross * (1 - r); taxReal += gross * r; grossSum += gross;
      }
      grossReal = grossSum;
      bT *= 1 + realRate; bIke *= 1 + realRate; bIkze *= 1 + realRate;
      endReal = bT + bIke + bIkze;
      // Wyczerpanie: netto dostarczone poniżej potrzeby albo saldo na zerze.
      if (need > EPS || endReal <= EPS) {
        if (endReal <= EPS) endReal = 0;
        depletedYear = n;
      }
      taxTotalReal += taxReal;
    } else {
      endReal = (startReal - withdrawalReal) * (1 + realRate);
      if (endReal <= EPS) { endReal = 0; depletedYear = n; }
    }
    const growthReal = endReal - (startReal - grossReal);
    const pf1 = Math.pow(1 + inflation, n - 1);
    const pfN = Math.pow(1 + inflation, n);
    const startNominal = startReal * pf1;
    const withdrawalNominal = withdrawalReal * pf1;
    const endNominal = endReal * pfN;
    const growthNominal = endNominal - (startNominal - withdrawalNominal - (active.any ? taxReal * pf1 : 0));
    rows.push({
      year: n, ym, age: birth ? ageAt(birth, ym).years : null,
      startReal, startNominal,
      withdrawalReal, withdrawalNominal,
      growthReal, growthNominal, endReal, endNominal,
      ...(active.any ? { taxReal, taxNominal: taxReal * pf1, grossReal } : {}),
    });
    bal = endReal;
    if (depletedYear != null) break;
  }
  return {
    startYm, startAge, hypothetical, swr, realRate, inflation, nominalRate,
    withdrawalRealYearly, withdrawalGrowthReal: wG - 1, priceFactorAtStart,
    rows, depletedYear, ro, taxesApplied: active,
    ...(active.any ? { taxTotalReal } : {}),
  };
}

// Statystyki podatkowe „na dziś" dla karty w Analizie — czysta, liczona przy
// renderze (nie w recomputeDerived). null, gdy podatki wyłączone.
export function taxStats(state, balances, nowYm = todayYm()) {
  const active = taxesActive(state);
  if (!active.any || !balances.taxSnapshot) return null;
  const snap = balances.taxSnapshot;
  const tracker = makeTaxTracker(state, snap); // O(1)
  const gainShare = tracker.gainShare(nowYm);  // udział zysku konta zwykłego
  const targetNet = fireTargetAt(state, nowYm);
  const ikCfg = (state.taxes || {}).ikeIkze || {};
  return {
    active,
    gainShare,
    netValueReal: tracker.netValueReal(nowYm),
    targetNet,
    targetGross: active.belka ? belkaGrossTarget(targetNet, gainShare) : targetNet,
    basisNominal: snap.basisNominal,
    portfolio: balances.portfolio,
    buckets: { taxable: snap.taxable, ike: snap.ike, ikze: snap.ikze },
    ytdIkze: snap.ytdIkze, ytdIke: snap.ytdIke,
    nextRefund: active.ikeIkze ? (ikCfg.pitRate != null ? ikCfg.pitRate : 0.12) * snap.ytdIkze : 0,
    limits: { ike: IKE_LIMIT_YEARLY, ikze: ikzeLimitFor(state.taxes) },
  };
}

// Cel „do zera": portfel = 0 dokładnie w wieku deathAge. Wypłata taka sama
// jak w fireTargetAt (roczne wydatki = cel × SWR). Domyślnie STAŁA realnie po
// FIRE — ten sam model wydatków co cel klasyczny i projectWithdrawal
// (expenseGrowthReal działa tylko do daty FIRE, przez W₁). Gdy mrożenie jest
// wyłączone (`ro.freezeExpenses === false`), wypłaty rosną o expenseGrowthReal
// także po FIRE: W_n = W₁·G^(n−1), G = 1 + expenseGrowthReal. Portfel rośnie
// realnie o r. Rozwiązanie P_N = 0 daje PV renty z podstawieniem q → G·q:
// cel = W₁·(1−x^N)/(1−x), x = G/(1+r); dla x ≈ 1 → cel = N·W₁. Przy G = 1
// odtwarza dawną formułę annuity-due 1:1. Portfel rośnie realnie o zwrot po
// FIRE (obligacje) z `ro.postReturnReal`, nie o zwrot z fazy oszczędzania.
export function dieWithZeroTargetAt(state, ym, deathAge, ro = retirementOpts(state)) {
  const a = state.assumptions;
  const birth = state.profile.birthDate;
  if (!birth) return null;
  const yearsN = deathAge - ageAt(birth, ym).years;
  if (!(yearsN >= 1)) return null;
  const withdrawalYear1 = fireTargetAt(state, ym) * a.withdrawalRate;
  const r = ro.postReturnReal;
  const g = ro.freezeExpenses ? 0 : a.expenseGrowthReal;
  const x = (1 + g) / (1 + r);
  const target = Math.abs(x - 1) < 1e-12
    ? yearsN * withdrawalYear1
    : withdrawalYear1 * (1 - Math.pow(x, yearsN)) / (1 - x);
  return { target, yearsN, withdrawalYear1 };
}

// Faza wypłat „do zera": tabela roczna od dokładnie celu „do zera" do 0 w wieku
// deathAge. Skanuje prognozę o pierwszy miesiąc, w którym dług spłacony i portfel
// ≥ cel „do zera" (cel liczony per-miesiąc — rozwiązuje cykliczność: N maleje, a
// W₁ rośnie z latami planu). Analiza-only; nie zmienia projectFire ani warunku FIRE.
export function projectDieWithZero(state, opts = {}) {
  const a = state.assumptions;
  const ro = opts.ro || retirementOpts(state);
  const birth = state.profile.birthDate;
  if (!birth) return null;
  const deathAge = opts.deathAge != null ? opts.deathAge : 110;
  const proj = opts.projection || null;
  const now = todayYm(opts.now); // opts.now tylko dla determinizmu testów
  const nowIdx = ymToIdx(now);

  // Klasyczna data FIRE (do porównania). Cel klasyczny liczony niżej, w TYM
  // SAMYM miesiącu co cel „do zera" (startYm) — porównanie z dwóch różnych dat
  // zawyżało „do zera" o wzrost wydatków między dziś a datą FIRE.
  const classicFireYm = proj && proj.reached ? proj.fireYm : null;

  // Bramka startowa zobowiązań: przed wydatkiem na dom / startem kredytu /
  // startem długu rodzinnego salda są 0, bo zobowiązanie JESZCZE nie istnieje —
  // to nie jest „spłacone". Ta sama logika co houseSettled/famSettled w
  // projectFire (idx ≥ hsMonth, debtStarted, famStarted).
  const hp = state.housing.housePlan;
  const houseOn = !!(hp && hp.enabled);
  const flOn = houseOn && hp.familyLoan && hp.familyLoan.enabled;
  const gateIdx = Math.max(
    houseOn ? ymToIdx((hp.houseSpend && hp.houseSpend.month) || hp.mortgage.startMonth) : -Infinity,
    houseOn ? ymToIdx(hp.mortgage.startMonth) : -Infinity,
    flOn ? ymToIdx(hp.familyLoan.startMonth) : -Infinity,
  );

  // Skan miesiąca osiągnięcia celu „do zera".
  let fireYm = null, dz = null;
  if (proj && proj.series) {
    for (const r of proj.series) {
      if (ymToIdx(r.ym) < nowIdx) continue;
      if (ymToIdx(r.ym) < gateIdx) continue;
      if (ageAt(birth, r.ym).years >= deathAge) break;
      const t = dieWithZeroTargetAt(state, r.ym, deathAge, ro);
      if (!t) continue;
      const settled = (r.debtReal || 0) <= EPS && (r.familyReal || 0) <= EPS;
      if (settled && r.portfolio >= t.target - EPS) {
        fireYm = r.ym;
        dz = t;
        break;
      }
    }
  }

  const hypothetical = fireYm == null;
  const startYm = fireYm != null ? fireYm : now;
  const startAge = ageAt(birth, startYm).years;
  const targetClassic = fireTargetAt(state, startYm);
  const r = ro.postReturnReal;
  const wG = 1 + (ro.freezeExpenses ? 0 : a.expenseGrowthReal);
  const inflation = a.inflationAnnual;
  const nominalRate = (1 + r) * (1 + inflation) - 1;

  // Wiek ≤ obecny → brak lat wypłat: marker (rows puste), UI pokazuje field-error.
  if (dz == null) dz = dieWithZeroTargetAt(state, startYm, deathAge, ro);
  if (dz == null) {
    return {
      deathAge, startYm, startAge, yearsN: deathAge - startAge,
      target: 0, targetClassic, fireYm, classicFireYm, hypothetical,
      realRate: r, inflation, nominalRate,
      withdrawalYear1: 0, withdrawalGrowthReal: wG - 1, rows: [], ro,
    };
  }

  const { target, yearsN, withdrawalYear1: W1 } = dz;

  // Tabela: zawsze od DOKŁADNIE celu (semantyka „0 w chwili śmierci"), nie od
  // prognozowanej nadwyżki portfela. Kolumny nominalne jak w projectWithdrawal.
  const rows = [];
  let bal = target;
  for (let n = 1; n <= yearsN; n++) {
    const ym = addMonths(startYm, (n - 1) * 12);
    const startReal = bal;
    const withdrawalReal = W1 * Math.pow(wG, n - 1); // rośnie o G gdy mrożenie off (0 gdy stałe)
    let endReal = (startReal - withdrawalReal) * (1 + r);
    if (Math.abs(endReal) <= EPS) endReal = 0;
    const growthReal = endReal - (startReal - withdrawalReal);
    const pf1 = Math.pow(1 + inflation, n - 1);
    const pfN = Math.pow(1 + inflation, n);
    const startNominal = startReal * pf1;
    const withdrawalNominal = withdrawalReal * pf1;
    const endNominal = endReal * pfN;
    const growthNominal = endNominal - (startNominal - withdrawalNominal);
    rows.push({
      year: n, ym, age: ageAt(birth, ym).years,
      startReal, startNominal,
      withdrawalReal, withdrawalNominal,
      growthReal, growthNominal, endReal, endNominal,
    });
    bal = endReal;
  }

  return {
    deathAge, startYm, startAge, yearsN, target, targetClassic,
    fireYm, classicFireYm, hypothetical, realRate: r, inflation,
    nominalRate, withdrawalYear1: W1, withdrawalGrowthReal: wG - 1, rows, ro,
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
      debtRealEnd: last.debtReal, familyRealEnd: last.familyReal || 0, targetEnd: last.target,
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
export function projectionWith(state, { assumptions = {}, taxes = null, extraMonthlySavings = 0, extraSavings = null, stopAtFire = true } = {}, now = new Date()) {
  const st = { ...state, assumptions: { ...state.assumptions, ...assumptions } };
  if (taxes) {
    // Płytkie kopie + zagnieżdżony merge podsekcji ikeIkze — stan wejściowy
    // nietknięty (testy F30i/F31j).
    st.taxes = { ...state.taxes, ...taxes,
      ikeIkze: { ...(state.taxes || {}).ikeIkze, ...(taxes.ikeIkze || {}) } };
  }
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
  const family = replayFamilyLoan(st, upto);
  const balances = replayBalances(st, upto, debt, family);
  return projectFire(st, plan, balances, debt, family, upto, { stopAtFire });
}

export const BAND_SPREAD = 0.015; // ±1,5 pkt proc. na realReturnAnnual (D9)

// Pasmo prognozy: deterministyczna koperta optymistyczna/pesymistyczna — dwa
// przebiegi projectFire przy realReturnAnnual ± spread, bez losowania (D9,
// „pasmo", nigdy „percentyl"). Jedna wspólna baza: plan + repliki liczone raz
// na PRAWDZIWYCH założeniach — replayBalances rośnie w miesiącach historii wg
// realReturnAnnual, więc naiwny rerun projectionWith fałszywie rozjechałby
// pasmo na przeszłości użytkownika. stopAtFire:false, bo optymistyczna ścieżka
// osiąga FIRE wcześniej i bez tego urywałaby się w połowie wykresu. Historia:
// lo == hi == fakt (z konstrukcji). Czysta — nic nie zapisujemy.
export function projectionBand(state, { spread = BAND_SPREAD } = {}, now = new Date()) {
  const upto = lastCompleteMonth(now);
  const plan = buildPlan(state);
  const debt = replayDebt(state, upto);
  const family = replayFamilyLoan(state, upto);
  const balances = replayBalances(state, upto, debt, family);
  const run = r => projectFire(
    { ...state, assumptions: { ...state.assumptions, realReturnAnnual: r } },
    plan, balances, debt, family, upto, { stopAtFire: false }).series;
  const r0 = state.assumptions.realReturnAnnual;
  const up = run(r0 + spread), down = run(r0 - spread);
  // min/max per wiersz — defensywnie na skrzyżowania (ujemny portfel w fazie
  // długu rośnie „na minus" szybciej przy wyższej stopie).
  const rows = [];
  for (let i = 0; i < Math.min(up.length, down.length); i++) rows.push({
    ym: up[i].ym,
    lo: Math.min(down[i].portfolio, up[i].portfolio),
    hi: Math.max(down[i].portfolio, up[i].portfolio),
  });
  return { spread, rows };
}

// Wartość przyszła równych miesięcznych wpłat (annuity-due — kolejność jak w
// projekcji: portfolio += flow; portfolio *= 1+r). Czysta forma zamknięta,
// zgodna konwencją ze składkową częścią replayBalances (test F21).
export function futureValueOfMonthly(monthly, annualReal, years) {
  const r = monthlyRate(annualReal);
  const N = years * 12;
  return r === 0 ? monthly * N : monthly * ((Math.pow(1 + r, N) - 1) / r) * (1 + r);
}

// Wpływ jednorazowej decyzji (wydanej lub powstrzymanej) na majątek w dniu FIRE.
// Czysta, O(1) — bezpieczna w ścieżce każdego naciśnięcia klawisza; NIGDY nie
// wołaj tu projectionWith. Wszystko realnie. null, gdy profil niekompletny
// (UI degraduje się łagodnie). Po docelowym wieku → yearsToFire=0, factor=1.
export function oneOffImpact(state, amount, now = new Date()) {
  const a = state.assumptions;
  const birth = state.profile.birthDate;
  if (!birth || !(a.targetFireAge > 0)) return null;
  const age = ageAt(birth, todayYm(now));
  // Miesiące celu zaokrąglone jak w fiStats/requiredSavingsForGoal — ułamkowy
  // wiek FIRE (np. 45,1) dawałby ułamkowy indeks i zdeformowany "YYYY-MM".
  const targetMonths = Math.round(a.targetFireAge * 12);
  const yearsToFire = Math.max(0, targetMonths - age.totalMonths) / 12;
  const factor = Math.pow(1 + a.realReturnAnnual, yearsToFire);
  const futureValueReal = (Number(amount) || 0) * factor;
  const [by, bm] = birth.split('-').map(Number);
  const fireAtYm = idxToYm(by * 12 + (bm - 1) + targetMonths);
  const monthlySpendAtFire = fireTargetAt(state, fireAtYm) * a.withdrawalRate / 12;
  const retirementDays = monthlySpendAtFire > 0
    ? futureValueReal / (monthlySpendAtFire * 12 / 365.25) : null;
  return { yearsToFire, factor, futureValueReal, monthlySpendAtFire, retirementDays };
}

// Ile dodatkowych zł/mies. potrzeba, by osiągnąć FIRE najpóźniej w zadanym wieku.
// Poszukiwanie binarne minimalnego extraMonthlySavings ≥ 0 spełniającego
// (reached && fireAge.totalMonths ≤ targetAgeMonths) — funkcja monotoniczna:
// więcej oszczędności ⇒ FIRE nie później. Każdy krok to jeden przebieg
// projectionWith (na płytkiej kopii stanu — nic nie mutuje, test F15a).
export function solveExtraSavingsForAge(state, targetAgeMonths, { cap = 100000 } = {}, now = new Date()) {
  const run = extra => projectionWith(state, { extraMonthlySavings: extra }, now);
  const meets = p => p.reached && p.fireAge.totalMonths <= targetAgeMonths;

  const base = run(0);
  if (meets(base)) {
    return { feasible: true, extraMonthly: 0, fireYm: base.fireYm, fireAge: base.fireAge };
  }
  const capRes = run(cap);
  if (!meets(capRes)) {
    return {
      feasible: false, extraMonthly: null,
      fireYm: capRes.reached ? capRes.fireYm : null,
      fireAge: capRes.reached ? capRes.fireAge : null,
    };
  }
  // lo = najwyższe znane „za mało", hi = najniższe znane „wystarcza".
  let lo = 0, hi = cap;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (meets(run(mid))) hi = mid; else lo = mid;
  }
  const res = run(hi);
  return { feasible: true, extraMonthly: hi, fireYm: res.fireYm, fireAge: res.fireAge };
}

// Ile trzeba odkładać miesięcznie, by osiągnąć FIRE w docelowym wieku:
// baza planu + ewentualna dopłata. Normalizuje wynik solveExtraSavingsForAge
// do jednego kształtu dla wszystkich ekranów (pulpit, check-in, Analiza).
// Czysta: buduje własny plan, nic nie mutuje.
export function requiredSavingsForGoal(state, now = new Date()) {
  const nowYm = todayYm(now);
  const targetAgeYears = state.assumptions.targetFireAge;
  const birthDate = state.profile.birthDate;
  if (!birthDate || !targetAgeYears) return { status: 'na' };
  const currentAge = ageAt(birthDate, nowYm).years;
  if (targetAgeYears <= currentAge) return { status: 'na' };

  const plannedNow = plannedSavingsFor(buildPlan(state), nowYm);
  const sol = solveExtraSavingsForAge(state, Math.round(targetAgeYears * 12), {}, now);
  if (!sol.feasible) {
    return { status: 'infeasible', targetAgeYears, plannedNow,
             fireYm: sol.fireYm, fireAge: sol.fireAge };
  }
  if (sol.extraMonthly === 0) {
    return { status: 'onTrack', targetAgeYears, plannedNow, extraMonthly: 0,
             requiredMonthly: plannedNow, fireYm: sol.fireYm, fireAge: sol.fireAge };
  }
  return { status: 'need', targetAgeYears, plannedNow, extraMonthly: sol.extraMonthly,
           requiredMonthly: plannedNow + sol.extraMonthly,
           fireYm: sol.fireYm, fireAge: sol.fireAge };
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
export function remainingSchedule(balNominal, j, payment, extraMonthly = 0) {
  const rows = [];
  let bal = balNominal, totalInterest = 0;
  for (let n = 0; bal > 0 && n < 1200; n++) {
    const step = mortgageStep(bal, j, payment, extraMonthly);
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

// Analityka długu rodzinnego — lustro mortgageAnalytics. Spłata wg kontraktu
// przypada dokładnie na endMonth (annuitet z okna [start, end]).
export function familyLoanAnalytics(state, family, projection) {
  const hp = state.housing.housePlan;
  const fl = hp && hp.familyLoan;
  if (!hp || !hp.enabled || !fl || !fl.enabled || !family.started) return null;
  const j = monthlyRate(fl.rateNominal);
  const A = familyLoanPayment(fl);
  let paidInterest = 0, paidPrincipal = 0;
  let paidOffYm = null;
  for (const r of family.rows) {
    paidInterest += r.interest;
    paidPrincipal += r.principalPaid;
    if (paidOffYm == null && r.balNominal <= 0) paidOffYm = r.ym;
  }
  const startIdx = ymToIdx(fl.startMonth);
  const overpaidTotal = state.entries
    .filter(e => (e.familyOverpayment || 0) > 0 && ymToIdx(e.month) >= startIdx)
    .reduce((s, e) => s + e.familyOverpayment, 0);
  const balanceNominal = family.balanceNominal;
  const lastYm = family.rows.length ? family.rows[family.rows.length - 1].ym : addMonths(fl.startMonth, -1);
  const rem = remainingSchedule(balanceNominal, j, A);
  const scheduleOnlyPayoffYm = paidOffYm || addMonths(lastYm, rem.months);
  const N = familyLoanTermMonths(fl);
  const contractRows = amortizationScheduleN(fl.principal, fl.rateNominal, N, fl.paymentOverrideMonthly);
  const contractTotalInterest = contractRows.reduce((s, r) => s + r.interest, 0);
  const contractPayoffYm = fl.endMonth;
  const interestSavedSoFar = contractTotalInterest - paidInterest - rem.totalInterest;
  return {
    paidInterest, paidPrincipal, overpaidTotal, balanceNominal,
    scheduleOnlyPayoffYm, scheduleOnlyRemainingInterest: rem.totalInterest,
    contractPayoffYm, contractTotalInterest, interestSavedSoFar,
    monthsAheadOfContract: monthsBetween(scheduleOnlyPayoffYm, contractPayoffYm),
    projectedPayoffYm: projection ? projection.familyFreeYm : null,
    payment: A, rateMonthly: j, lastYm, scheduleRows: rem.rows,
    principal: fl.principal, rateNominal: fl.rateNominal, termMonths: N,
  };
}

// Miesięczna ścieżka kredytu od startu do spłaty: historia (replay) +
// prognoza (seria projectFire przeliczona na nominał). Odsetki prognozy
// odtwarzane jak w mortgageStep: saldo poprzedniego miesiąca × j.
// Dwa bezpieczniki: ścieżka kończy się na pierwszym zerowym saldzie
// (spłacony kredyt nie ciągnie zer do horyzontu) oraz na zamrożonym saldzie
// (prognoza przestaje krokować dług rodzinny po endMonth — korekta w górę
// zostawiłaby wieczne saldo; nie dorabiamy mu fantomowych odsetek).
export function loanPathWithProjection(state, loanRes, projection, realField, j) {
  const infl = state.assumptions.inflationAnnual;
  const anchor = state.anchorMonth;
  const path = [];
  let prevBal = null;
  for (const r of loanRes.rows) {
    path.push({ ym: r.ym, balNominal: r.balNominal, interest: r.interest });
    prevBal = r.balNominal;
    if (r.balNominal === 0) return path;
  }
  for (const r of projection.series) {
    if (!r.projected) continue;
    const bal = toNominal(r[realField] || 0, anchor, r.ym, infl);
    if (prevBal != null && bal > 0 && Math.abs(bal - prevBal) < EPS) break; // saldo zamrożone
    path.push({ ym: r.ym, balNominal: bal, interest: (prevBal || 0) * j });
    if (bal === 0) break;
    prevBal = bal;
  }
  return path;
}

// Zestawienie „ile zostało do spłaty" rok po roku: kontrakt (bez nadpłat)
// vs ścieżka faktyczna (historia + prognoza). Krótsza strona dopełniana
// zerami w OBIE strony — korekta salda w górę potrafi wydłużyć ścieżkę
// faktyczną ponad kontrakt. Dopełnianie tutaj, nie w UI: pod testami Node.
export function remainingToPayComparison(principal, contractRows, actualRows, groupBy = 12) {
  const c = yearlyRemainingToPay(contractRows, principal, groupBy);
  const a = yearlyRemainingToPay(actualRows, principal, groupBy);
  const rows = [];
  for (let k = 0; k < Math.max(c.length, a.length); k++) {
    rows.push({
      year: k + 1,
      cPrincipal: c[k] ? c[k].principal : 0, cInterest: c[k] ? c[k].interest : 0,
      aPrincipal: a[k] ? a[k].principal : 0, aInterest: a[k] ? a[k].interest : 0,
    });
  }
  return rows;
}

// Statystyki FIRE: FI%, majątek netto (bez wartości domu), runway, Coast FIRE.
// Coast = cel w miesiącu docelowego wieku FIRE zdyskontowany realnym zwrotem.
export function fiStats(state, balances, debt, plan, nowYm = todayYm(), family = null) {
  const a = state.assumptions;
  const target = fireTargetAt(state, nowYm);
  const familyReal = family ? family.balanceReal : 0;
  const netWorth = balances.cash + balances.portfolio - (debt ? debt.balanceReal : 0) - familyReal;
  const i = ymToIdx(nowYm) - ymToIdx(plan[0].ym);
  const row = plan[Math.min(Math.max(i, 0), plan.length - 1)];
  const monthlyExpenses = row.livingReal + row.rentReal + row.mortgagePaymentReal + (row.familyPaymentReal || 0);
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

// Postęp „drogi do FIRE": jaka część CAŁEJ podróży oszczędzania jest już za Tobą.
// Sensowny także w fazie domu/długu, gdzie portfel ≈ 0 a klasyczne FI% stoi w miejscu.
//
// Każdy miesiąc ma kwotę do odłożenia (na dom, dług, inwestycje): historia to
// realny wynik earned−spent, przyszłość to plan + delta — DOKŁADNIE to, co
// zakłada projectFire, więc pasek sięga 100% w prognozowanym dniu FIRE. Aby było
// „realistycznie", ważymy każdą wpłatę jej wzrostem do dnia FIRE (realny zwrot
// z inwestycji) — wcześniejsza złotówka jest warta więcej; wszystko w realnych zł,
// więc inflacja już uwzględniona. Miesiące na minusie nie cofają paska
// (max(0, …)) → pasek tylko rośnie. Wpłaty z faz domu i długu też się liczą.
export function fireJourneyProgress(state, plan, projection, uptoYm) {
  const a = state.assumptions;
  const a0 = ymToIdx(state.anchorMonth);
  const upto = ymToIdx(uptoYm);
  const series = projection.series;
  const reached = !!projection.reached;
  if (!series.length) return { pct: 0, savedValue: 0, totalValue: 0, reached, monthlySaveNow: 0 };
  const endIdx = ymToIdx(series[series.length - 1].ym); // dzień FIRE (albo koniec horyzontu)
  const r = monthlyRate(a.realReturnAnnual);
  const delta = projection.delta || 0;
  const entriesByMonth = new Map(state.entries.map(e => [ymToIdx(e.month), e]));
  let saved = 0, total = 0;
  for (let idx = a0; idx <= endIdx; idx++) {
    const e = entriesByMonth.get(idx);
    const contrib = idx <= upto
      ? (e ? roundGrosze(e.earned - e.spent) : 0)               // historia: realny wynik
      : plannedSavingsFor(plan, idxToYm(idx)) + delta;           // przyszłość: jak projectFire
    const c = Math.max(0, contrib);
    const w = Math.pow(1 + r, endIdx - idx);                     // wartość przyszła (do dnia FIRE)
    total += c * w;
    if (idx <= upto) saved += c * w;
  }
  const pct = total > 0 ? Math.min(1, Math.max(0, saved / total)) : 0;
  const monthlySaveNow = plannedSavingsFor(plan, idxToYm(Math.min(upto + 1, endIdx))) + delta;
  return { pct, savedValue: saved, totalValue: total, reached, monthlySaveNow };
}

// ── Jeden potok po każdej mutacji ───────────────────────────────────────
// Pochodne trzymane na state.derived — nigdy nie utrwalane jako prawda.

export function recomputeDerived(state, now = new Date()) {
  const plan = buildPlan(state);
  let upto = lastCompleteMonth(now);
  // Wpisy mogą sięgać dalej niż "ostatni pełny miesiąc" tylko przy cofniętym zegarze — nie wspieramy.
  const debt = replayDebt(state, upto);
  const family = replayFamilyLoan(state, upto);
  const balances = replayBalances(state, upto, debt, family);
  const streak = computeStreak(state.entries);
  const projection = projectFire(state, plan, balances, debt, family, upto);
  state.derived = { plan, balances, debt, family, streak, projection, uptoYm: upto };
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
    postRetirementReturnReal: 0.02, // realny zwrot po FIRE (marża EDO, przed podatkiem)
    freezeExpensesAtRetirement: true, // wydatki stałe realnie po FIRE (dzisiejsze zachowanie)
  };
}

export function createState(partial = {}, now = new Date()) {
  const state = {
    version: 6,
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
        familyLoan: { enabled: false, startMonth: null, endMonth: null, principal: 0, rateNominal: 0, paymentOverrideMonthly: null },
      },
    },
    debt: { overrides: [], familyOverrides: [] },
    taxes: {
      belkaEnabled: false,
      ikeIkze: { enabled: false, employmentForm: 'employee', pitRate: 0.12, ikeStart: 0, ikzeStart: 0 },
    },
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
