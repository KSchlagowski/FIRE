// test-engine.js — asercje współdzielone przez przeglądarkę (tests.html)
// i Node (run-tests.mjs). Zero frameworków.

import * as E from '../js/engine.js';
import * as F from '../js/format.js';
import * as S from '../js/storage.js';
import * as Sim from '../js/simulation.js';
import { coachMessage, checkinCelebration, decisionMessage, milestoneMessage } from '../js/coach.js';
import { chartSVG, stackedBarSVG, tipHit } from '../js/charts.js';
import { FIX } from './fixtures.js';

// ── Mini-harness ────────────────────────────────────────────────────────

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

export function runAll() {
  return tests.map(t => {
    try {
      t.fn();
      return { name: t.name, ok: true };
    } catch (e) {
      return { name: t.name, ok: false, error: (e && e.stack) || String(e) };
    }
  });
}

function fail(msg) { throw new Error(msg); }
function assertTrue(cond, msg = 'oczekiwano true') { if (!cond) fail(msg); }
function assertEq(actual, expected, msg = '') {
  if (actual !== expected) fail(`${msg} oczekiwano ${JSON.stringify(expected)}, otrzymano ${JSON.stringify(actual)}`);
}
function assertClose(actual, expected, eps = 0.01, msg = '') {
  if (!(Math.abs(actual - expected) <= eps)) {
    fail(`${msg} oczekiwano ${expected} ±${eps}, otrzymano ${actual}`);
  }
}
function assertThrows(fn, msg = 'oczekiwano wyjątku') {
  try { fn(); } catch { return; }
  fail(msg);
}

// ── Budowa stanu testowego ──────────────────────────────────────────────

const NOW = new Date(2026, 6, 15); // 15 lipca 2026 → ostatni pełny miesiąc: 2026-06

function baseState(partial = {}) {
  return E.createState(deep({
    anchorMonth: '2026-07',
    profile: { birthDate: '2000-01-01' },
    assumptions: {
      monthlyIncome: 10000,
      monthlyLivingExpenses: 6000,
      cashStart: 0,
      portfolioStart: 0,
      targetFireAge: 45,
      withdrawalRate: 0.04,
      realReturnAnnual: 0.05,
      expenseGrowthReal: 0,
      incomeGrowthReal: 0,
      inflationAnnual: 0.03,
      postRetirementReturnReal: 0.05, // == realReturnAnnual → liczby F13/F24 bez zmian
      freezeExpensesAtRetirement: true, // legacy: wydatki stałe realnie po FIRE
      pensionMonthly: 0, // ZUS wyłączony → cała matematyka legacy bajt-w-bajt
      pensionAge: 65,
    },
    housing: { currentRentMonthly: 0 },
  }, partial), NOW);
}

function deep(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over)) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])
      && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deep(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

function entry(month, earned, spent, extra = {}) {
  return {
    month, earned, spent,
    overpayment: 0, cashOverride: null, balanceOverride: null,
    plannedSavingsSnapshot: extra.snapshot ?? 0,
    verdict: extra.verdict ?? 'on_plan',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null,
    ...extra,
  };
}

function housePlan(over = {}) {
  return deep({
    enabled: true,
    moveInMonth: '2029-07',
    houseSpend: { month: null, amount: null },
    businessIncomeMonthly: 0,
    businessStartMonth: null,
    mortgage: { startMonth: '2028-07', principal: 600000, rateNominal: 0.07, termYears: 20, paymentOverrideMonthly: null },
  }, over);
}

// ── F1: konwencja roczna Excela (arkusz Projekcja) ──────────────────────

test('F1: rok 20 = 1 931 853.86 (konwencja roczna Excela)', () => {
  const f = FIX.F1;
  assertClose(E.yearlyCompound(f.start, f.contribYearly, f.r, f.years), f.expectedYear20, f.eps);
});

test('F1: przekracza 1.8 mln dokładnie w roku 20', () => {
  const f = FIX.F1;
  assertTrue(E.yearlyCompound(f.start, f.contribYearly, f.r, f.crossesAtYear - 1) < f.threshold, 'rok 19 poniżej progu');
  assertTrue(E.yearlyCompound(f.start, f.contribYearly, f.r, f.crossesAtYear) >= f.threshold, 'rok 20 nad progiem');
});

// ── F2: silnik miesięczny ≡ zamknięta forma annuity-due ─────────────────

test('F2: replayBalances ≡ FV annuity-due (24 miesiące)', () => {
  const st = baseState({ assumptions: { portfolioStart: 10000 } });
  const c = 1000;
  for (let i = 0; i < 24; i++) {
    st.entries.push(entry(E.addMonths('2026-07', i), c, 0));
  }
  const res = E.replayBalances(st, E.addMonths('2026-07', 23));
  const rm = E.monthlyRate(0.05);
  const n = 24;
  const fv = 10000 * Math.pow(1 + rm, n) + c * (1 + rm) * (Math.pow(1 + rm, n) - 1) / rm;
  assertClose(res.portfolio, fv, 0.01);
});

// ── F3: annuitet kredytu ────────────────────────────────────────────────

test('F3: rata 1.1 mln @ 7%/15 lat ≈ 9 755.8 zł', () => {
  const f = FIX.F3;
  assertClose(E.mortgagePayment(f), f.expectedPayment, f.eps);
});

test('F3: 180 rat → saldo dokładnie 0', () => {
  const f = FIX.F3;
  const j = E.monthlyRate(f.rateNominal);
  const A = E.mortgagePayment(f);
  let bal = f.principal;
  for (let i = 0; i < 180; i++) bal = E.mortgageStep(bal, j, A).bal;
  assertEq(bal, 0, 'saldo po 180 ratach');
});

test('F3: override raty respektowany', () => {
  assertEq(E.mortgagePayment({ ...FIX.F3, paymentOverrideMonthly: 10000 }), 10000);
});

test('F3: rateNominal=0 → rata liniowa L/N', () => {
  assertClose(E.mortgagePayment({ principal: 120000, rateNominal: 0, termYears: 10 }), 1000, 1e-9);
});

// ── F4: cele FIRE ───────────────────────────────────────────────────────

test('F4: 6 000/mies. @ WR 4% → 1 800 000', () => {
  const st = baseState();
  assertClose(E.fireTargetAt(st, '2026-07'), FIX.F4.expectedTarget, 0.01);
});

test('F4: cel ruchomy rośnie schodkowo z g_exp', () => {
  const st = baseState({ assumptions: { expenseGrowthReal: 0.01 } });
  assertClose(E.fireTargetAt(st, '2027-06'), 1800000, 0.01, 'rok 1 bez wzrostu');
  assertClose(E.fireTargetAt(st, '2027-07'), 1800000 * 1.01, 0.01, 'rok 2 = ×1.01');
});

test('F4: kontrast "gdybyś wynajmował na zawsze"', () => {
  const stOff = baseState({ housing: { currentRentMonthly: 2000 } });
  assertClose(E.fireTargetAt(stOff, '2026-07'), (6000 + 2000) * 12 / 0.04, 0.01, 'dom wyłączony: czynsz w celu');
  const stOn = baseState({ housing: { currentRentMonthly: 2000, housePlan: housePlan() } });
  const t = E.fireTargetsToday(stOn, '2026-07');
  assertClose(t.primary, 1800000, 0.01, 'z domem: tylko życie');
  assertClose(t.rentingForever, 2400000, 0.01, 'kontrast z czynszem');
});

test('F4: WR=0 i termYears=0 rzucają', () => {
  const st = baseState({ assumptions: { withdrawalRate: 0 } });
  assertThrows(() => E.fireTargetAt(st, '2026-07'), 'WR=0');
  assertThrows(() => E.mortgagePayment({ principal: 1, rateNominal: 0.05, termYears: 0 }), 'term=0');
});

// ── F5: plan 3-fazowy ───────────────────────────────────────────────────

function f5State() {
  return baseState({
    assumptions: { incomeGrowthReal: 0.03, expenseGrowthReal: 0.01, monthlyLivingExpenses: 5000 },
    housing: {
      currentRentMonthly: 2000,
      housePlan: housePlan({ businessIncomeMonthly: 1000, businessStartMonth: '2030-07' }),
    },
  });
}

test('F5: faza oszczędzania (przed kredytem)', () => {
  const plan = E.buildPlan(f5State());
  const m = plan[0]; // 2026-07, t=1
  assertEq(m.phase, 'saving');
  assertClose(m.plannedSavings, 10000 - 5000 - 2000, 0.01);
});

test('F5: faza długu — ujemne miesiące budowy, rata deflowana schodkowo', () => {
  const st = f5State();
  const plan = E.buildPlan(st);
  const A = E.mortgagePayment(st.housing.housePlan.mortgage);
  const i = E.monthsBetween('2026-07', '2028-07'); // t=3
  const m = plan[i];
  assertEq(m.phase, 'debt');
  const expected = 10000 * 1.03 ** 2 - 5000 * 1.01 ** 2 - 2000 - A * 1.03 ** -2;
  assertClose(m.plannedSavings, expected, 0.01);
  assertTrue(m.plannedSavings < 0, 'rok budowy: czynsz + rata → plan ujemny');
});

test('F5: po wprowadzce czynsz znika, biznes włącza się w swoim miesiącu', () => {
  const st = f5State();
  const plan = E.buildPlan(st);
  const A = E.mortgagePayment(st.housing.housePlan.mortgage);
  const m4 = plan[E.monthsBetween('2026-07', '2029-07')]; // t=4, po wprowadzce
  assertEq(m4.rentReal, 0, 'czynsz po wprowadzce');
  assertClose(m4.plannedSavings, 10000 * 1.03 ** 3 - 5000 * 1.01 ** 3 - A * 1.03 ** -3, 0.01);
  const m5pre = plan[E.monthsBetween('2026-07', '2030-06')];
  const m5 = plan[E.monthsBetween('2026-07', '2030-07')];
  assertClose(m5.incomeReal - m5pre.incomeReal, 1000 + (10000 * 1.03 ** 4 - 10000 * 1.03 ** 3), 0.01, 'biznes +1000 od 2030-07');
});

// ── F6: progi werdyktu ──────────────────────────────────────────────────

test('F6: progi przy planie 4000 (4600 / 4000 / 2400)', () => {
  assertEq(E.computeVerdict(4600, 4000), 'crushed');
  assertEq(E.computeVerdict(4599.99, 4000), 'on_plan');
  assertEq(E.computeVerdict(4000, 4000), 'on_plan');
  assertEq(E.computeVerdict(3999.99, 4000), 'behind');
  assertEq(E.computeVerdict(2400, 4000), 'behind');
  assertEq(E.computeVerdict(2399.99, 4000), 'hard');
});

test('F6: plan 0 → skala minimalna 500', () => {
  assertEq(E.computeVerdict(75, 0), 'crushed');
  assertEq(E.computeVerdict(0, 0), 'on_plan');
  assertEq(E.computeVerdict(-200, 0), 'behind');
  assertEq(E.computeVerdict(-200.01, 0), 'hard');
});

test('F6: plan −2000 (miesiące budowy) i ujemny net', () => {
  assertEq(E.computeVerdict(-1700, -2000), 'crushed');
  assertEq(E.computeVerdict(-2000, -2000), 'on_plan');
  assertEq(E.computeVerdict(-2800, -2000), 'behind');
  assertEq(E.computeVerdict(-2800.01, -2000), 'hard');
});

// ── F7: seria (streak) ──────────────────────────────────────────────────

test('F7: luka pomijana, zły werdykt przerywa, best zapamiętany', () => {
  const es = [
    entry('2026-07', 1, 0, { verdict: 'on_plan' }),
    entry('2026-08', 1, 0, { verdict: 'crushed' }),
    // 2026-09 brak — luka
    entry('2026-10', 1, 0, { verdict: 'on_plan' }),
  ];
  assertEq(E.computeStreak(es).current, 3, 'luka nie przerywa');
  es.push(entry('2026-11', 1, 0, { verdict: 'hard' }));
  const s = E.computeStreak(es);
  assertEq(s.current, 0, 'zły werdykt zeruje');
  assertEq(s.best, 3, 'best zostaje');
  // edycja: naprawiamy listopad → seria wraca (pochodna liczona od nowa)
  es[3] = entry('2026-11', 1, 0, { verdict: 'on_plan' });
  assertEq(E.computeStreak(es).current, 4);
});

// ── F8: determinizm replay ──────────────────────────────────────────────

function f8State() {
  // Kredyt 0% dla ręcznych rachunków: 12 000 zł / 1 rok → rata 1000.
  return baseState({
    anchorMonth: '2026-01',
    assumptions: { cashStart: 5000, portfolioStart: 20000, realReturnAnnual: 0, inflationAnnual: 0 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2026-01',
        houseSpend: { month: '2026-01', amount: 0 },
        mortgage: { startMonth: '2026-01', principal: 12000, rateNominal: 0, termYears: 1 },
      }),
    },
  });
}

test('F8: replay deterministyczny (dwa przebiegi identyczne)', () => {
  const st = f8State();
  st.entries.push(entry('2026-01', 8000, 6000, { overpayment: 500 }));
  st.entries.push(entry('2026-02', 8000, 6000));
  const a = E.replayBalances(st, '2026-03');
  const b = E.replayBalances(st, '2026-03');
  assertEq(JSON.stringify(a.rows), JSON.stringify(b.rows));
});

test('F8: miesiąc bez wpisu — rata planowa i tak schodzi z długu', () => {
  const st = f8State();
  const d = E.replayDebt(st, '2026-03'); // 3 miesiące, zero wpisów
  assertClose(d.balanceNominal, 12000 - 3000, 0.001);
});

test('F8: nadpłata z wpisu redukuje dług, kontrybucja idzie do gotówki', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 8000, 6000, { overpayment: 500 }));
  const d = E.replayDebt(st, '2026-02');
  assertClose(d.balanceNominal, 12000 - 2000 - 500, 0.001);
  const b = E.replayBalances(st, '2026-02', d);
  // Faza długu: kontrybucja (2000−500=1500) → gotówka.
  assertClose(b.cash, 5000 + 1500, 0.001);
  assertClose(b.portfolio, 20000, 0.001);
});

test('F8: edycja miesiąca 3 przelicza dalsze miesiące', () => {
  const st = f8State();
  st.entries.push(entry('2026-03', 8000, 6000));
  const before = E.replayBalances(st, '2026-05').cash;
  st.entries[0] = entry('2026-03', 9000, 6000);
  const after = E.replayBalances(st, '2026-05').cash;
  assertClose(after - before, 1000, 0.001);
});

test('F8: nadpłata ponad saldo → spill do portfela, dług = 0', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 30000, 6000, { overpayment: 20000 }));
  const d = E.replayDebt(st, '2026-02');
  assertEq(d.balanceNominal, 0, 'dług wyzerowany');
  // Luty: saldo startowe 11000, rata 1000 + nadpłata 20000 → spill 10000.
  const b = E.replayBalances(st, '2026-02', d);
  assertClose(b.portfolio, 20000 + 10000, 0.001);
});

test('F8: override salda resetuje łańcuch od tego miesiąca', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 8000, 6000, { balanceOverride: 50000 }));
  st.entries.push(entry('2026-03', 8000, 6000));
  const b = E.replayBalances(st, '2026-03');
  assertClose(b.portfolio, 50000, 0.001, 'override obowiązuje (faza długu: kontrybucje→gotówka)');
});

// ── F9: prognoza ────────────────────────────────────────────────────────

test('F9: czysty plan trafia w ręcznie policzony miesiąc', () => {
  const st = baseState({ assumptions: { portfolioStart: 1700000 } });
  // plan = 10000 − 6000 = 4000/mies., cel stały 1 800 000
  E.recomputeDerived(st, NOW);
  const rm = E.monthlyRate(0.05);
  let bal = 1700000, months = 0;
  while (bal < 1800000 - E.EPS) { bal = (bal + 4000) * (1 + rm); months++; }
  const expected = E.addMonths('2026-07', months - 1);
  assertEq(st.derived.projection.fireYm, expected);
  assertTrue(st.derived.projection.byPlanOnly, '<3 wpisów → prognoza wg planu');
});

test('F9: delta z wpisów przesuwa prognozę', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const base = st.derived.projection.fireYm;
  // 3 wpisy z net = plan + 2000 → delta 2000
  for (const m of ['2026-01', '2026-02', '2026-03']) {
    st.entries.push(entry(m, 12000, 6000, { snapshot: 4000, plannedSavingsSnapshot: 4000 }));
  }
  E.recomputeDerived(st, NOW);
  assertClose(st.derived.projection.delta, 2000, 0.01);
  assertTrue(E.ymToIdx(st.derived.projection.fireYm) < E.ymToIdx(base), 'FIRE wcześniej');
});

test('F9: FIRE wymaga długu = 0 nawet przy portfelu ≥ cel', () => {
  const st = baseState({
    assumptions: { portfolioStart: 2000000, cashStart: 0 },
    housing: {
      housePlan: housePlan({
        moveInMonth: '2026-08',
        houseSpend: { month: '2026-08', amount: 0 },
        mortgage: { startMonth: '2026-08', principal: 500000, rateNominal: 0.07, termYears: 20 },
      }),
    },
  });
  E.recomputeDerived(st, NOW);
  const p = st.derived.projection;
  assertTrue(p.reached, 'w końcu osiąga FIRE');
  assertTrue(E.ymToIdx(p.fireYm) >= E.ymToIdx(p.debtFreeYm), 'nie wcześniej niż spłata długu');
});

test('F9: horyzont 720 miesięcy → brak FIRE = null', () => {
  const st = baseState({ assumptions: { monthlyIncome: 6100, monthlyLivingExpenses: 6000 } });
  // 100 zł/mies. nigdy nie dobije do 1.8 mln w 60 lat
  E.recomputeDerived(st, NOW);
  assertEq(st.derived.projection.reached, false);
  assertEq(st.derived.projection.fireYm, null);
});

// ── F10: formatowanie ───────────────────────────────────────────────────

test('F10: formatPLN z grupowaniem NBSP', () => {
  assertEq(F.formatPLN(1234567), '1 234 567 zł');
  assertEq(F.formatPLN(1234.56, 2), '1 234,56 zł');
  assertEq(F.formatPLN(-500), '-500 zł');
});

test('F10: formatPct', () => {
  assertEq(F.formatPct(0.035), '3,5%');
  assertEq(F.formatPct(0.04), '4%');
});

test('F10: polskie liczby mnogie lat', () => {
  assertEq(F.formatAgeYM({ years: 1, months: 0 }), '1 rok');
  assertEq(F.formatAgeYM({ years: 3, months: 2 }), '3 lata 2 mies.');
  assertEq(F.formatAgeYM({ years: 5, months: 0 }), '5 lat');
  assertEq(F.formatAgeYM({ years: 12, months: 1 }), '12 lat 1 mies.');
  assertEq(F.formatAgeYM({ years: 22, months: 0 }), '22 lata');
});

test('F10: formatMonthName + parsePLN round-trip', () => {
  assertEq(F.formatMonthName('2026-06'), 'czerwiec 2026');
  assertEq(F.parsePLN(F.formatPLN(1234567)), 1234567);
  assertEq(F.parsePLN('1 234,56 zł'), 1234.56);
  assertEq(F.parsePLN('12345,67'), 12345.67);      // przecinek = separator dziesiętny
  assertEq(F.parsePLN('abc'), null);
});

// ── F32: parsowanie/formatowanie pl-PL — poprawki z audytu (D1–D3) ────────

test('F32a: parsePLN — tabela locale pl-PL (D1)', () => {
  const cases = [
    ['1.000', 1000],           // kropka = separator tysięcy, nie dziesiętny
    ['1.234,56', 1234.56],     // grupowanie + przecinek dziesiętny
    ['1 234,56', 1234.56],     // spacja grupująca
    ['1234,56', 1234.56],      // bez grupowania
    ['1,5', 1.5],
    ['2 500,50', 2500.5],      // NBSP-podobna spacja grupująca
    ['1,2,3', null],           // dwa przecinki → niejednoznaczne
    ['1.0.0', null],           // kropki nie dzielą na grupy po 3 → null
    ['-0,004', 0],             // zaokrągla do grosza (0), bez -0
    ['', null],
    ['-', null],
  ];
  for (const [input, expected] of cases) {
    assertEq(F.parsePLN(input), expected, `parsePLN(${JSON.stringify(input)})`);
  }
  // liczba wejściowa: zaokrąglenie do grosza; niebyt-skończone → null
  assertEq(F.parsePLN(1234.567), 1234.57);
  assertEq(F.parsePLN(Infinity), null);
});

test('F32b: formatPLN — znak liczony po zaokrągleniu (D2)', () => {
  const NB = String.fromCharCode(0xa0);                              // formatPLN grupuje NBSP-em
  assertEq(F.formatPLN(-0.004), `0${NB}zł`);        // zaokrągla do 0 → bez minusa
  assertEq(F.formatPLN(-0.004, 2), `0,00${NB}zł`);
  assertEq(F.formatPLN(-12.5, 2), `-12,50${NB}zł`); // prawdziwy minus zachowany
  assertEq(F.formatPLN(-0.6), `-1${NB}zł`);         // zaokrągla do 1 → minus zostaje
  assertEq(F.formatPLN(0), `0${NB}zł`);
});

test('F32c: formatPct — część całkowita zachowana przy 0 miejscach (D3)', () => {
  assertEq(F.formatPct(0.10, 0), '10%');            // nie „1%"
  assertEq(F.formatPct(1.0, 0), '100%');            // nie „1%"
  assertEq(F.formatPct(0.10, 2), '10%');            // ułamkowe zera nadal ucinane
  assertEq(F.formatPct(0.035), '3,5%');             // domyślna precyzja bez zmian
  assertEq(F.formatPct(0.04), '4%');
});

// ── F11: storage ────────────────────────────────────────────────────────

function mockBacking() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _raw: m,
  };
}

test('F11: eksport/import round-trip', () => {
  const st = baseState({ taxes: { belkaEnabled: true } });
  st.entries.push(entry('2026-07', 8000, 5000));
  const json = S.exportJSON(st);
  const preview = S.importPreview(json);
  assertEq(preview.entriesCount, 1);
  assertEq(preview.range.from, '2026-07');
  assertEq(JSON.stringify(preview.state.entries), JSON.stringify(st.entries));
  assertEq(JSON.stringify(S.importJSON(json).taxes), JSON.stringify(st.taxes), 'taxes przeżywa round-trip dosłownie');
});

test('F33: import odrzuca stany, które UI już zabrania (D6)', () => {
  // Nad-zaseedowane konta: IKE + IKZE > portfel startowy → odrzucone.
  const over = baseState();
  over.assumptions.portfolioStart = 10000;
  over.taxes.ikeIkze = { enabled: true, employmentForm: 'employee', pitRate: 0.12, ikeStart: 8000, ikzeStart: 7000 };
  assertThrows(() => S.validateState(over), 'IKE+IKZE > portfel odrzucone');
  // Stopa realna ≤ −100% → odrzucona (inaczej NaN/Infinity w projekcji).
  const badRate = baseState();
  badRate.assumptions.realReturnAnnual = -1.5;
  assertThrows(() => S.validateState(badRate), 'stopa ≤ −100% odrzucona');
  // Stopa wypłat ≤ 0 → odrzucona (fireTargetAt wymaga > 0).
  const badSwr = baseState();
  badSwr.assumptions.withdrawalRate = 0;
  assertThrows(() => S.validateState(badSwr), 'withdrawalRate ≤ 0 odrzucone');
  // Oprocentowanie kredytu poza [0, 30%] → odrzucone.
  const badLoan = baseState();
  badLoan.housing.housePlan.mortgage.rateNominal = 0.5;
  assertThrows(() => S.validateState(badLoan), 'oprocentowanie > 30% odrzucone');
  // Poprawna kompozycja (IKE+IKZE ≤ portfel, stopy w zakresie) nadal przechodzi.
  const ok = baseState();
  ok.assumptions.portfolioStart = 20000;
  ok.taxes.ikeIkze = { enabled: true, employmentForm: 'employee', pitRate: 0.12, ikeStart: 8000, ikzeStart: 7000 };
  assertEq(S.validateState(ok).version, S.SCHEMA_VERSION, 'poprawna kompozycja przechodzi');
});

test('F41: głęboka walidacja importu — NaN/typy/kształty odrzucone (Faza 3)', () => {
  // NaN w założeniach → odrzucone (typeof 'number' by to przepuścił).
  const nanIncome = baseState();
  nanIncome.assumptions.monthlyIncome = NaN;
  assertThrows(() => S.validateState(nanIncome), 'NaN monthlyIncome odrzucone');
  // String zamiast liczby we wpisie → odrzucony.
  const strEarned = baseState();
  strEarned.entries.push(entry('2026-07', 8000, 5000));
  strEarned.entries[0].earned = '8000';
  assertThrows(() => S.validateState(strEarned), 'string earned odrzucone');
  // NaN nadpłata → odrzucona; null-owe korekty sald nadal przechodzą.
  const badOver = baseState();
  badOver.entries.push(entry('2026-07', 8000, 5000, { overpayment: NaN }));
  assertThrows(() => S.validateState(badOver), 'NaN overpayment odrzucone');
  const badOverride = baseState();
  badOverride.entries.push(entry('2026-07', 8000, 5000, { cashOverride: '100' }));
  assertThrows(() => S.validateState(badOverride), 'string cashOverride odrzucone');
  // Brak profilu → odrzucony.
  const noProfile = baseState();
  delete noProfile.profile;
  assertThrows(() => S.validateState(noProfile), 'brak profile odrzucony');
  // belkaEnabled nie-boolean przy v ≥ 5 → odrzucone.
  const badTaxes = baseState();
  badTaxes.taxes.belkaEnabled = 'tak';
  assertThrows(() => S.validateState(badTaxes), 'nie-boolean belkaEnabled odrzucone');
  // Kształt kredytu przy włączonym planie: principal jako string → odrzucone.
  const badMortgage = baseState({ housing: { housePlan: housePlan() } });
  badMortgage.housing.housePlan.mortgage.principal = '600000';
  assertThrows(() => S.validateState(badMortgage), 'string principal odrzucone');
  // Poprawny stan (null-owe korekty, brak familyOverpayment w starych wpisach,
  // włączony plan domu) nadal przechodzi.
  const ok = baseState({ housing: { housePlan: housePlan() } });
  ok.entries.push(entry('2026-07', 8000, 5000));
  assertEq(S.validateState(ok).version, S.SCHEMA_VERSION, 'poprawny stan przechodzi');
  // Kopie sprzed v5 (bez sekcji podatków) nadal przechodzą i migrują —
  // walidacja podatków jest bramkowana wersją.
  const v4 = JSON.parse(JSON.stringify(baseState()));
  v4.version = 4;
  delete v4.taxes;
  assertEq(S.migrate(S.validateState(v4)).version, S.SCHEMA_VERSION, 'v4 bez taxes przechodzi i migruje');
});

test('F11: odzysk z .bak po korupcji', () => {
  const backing = mockBacking();
  const store = S.makeStorage(backing);
  const st = baseState();
  store.save(st);
  st.assumptions.monthlyIncome = 11000;
  store.save(st); // .bak = wersja z 10000
  backing.setItem(S.KEY, '{uszkodzone');
  const res = store.load();
  assertTrue(res.recovered, 'flaga recovered');
  // .bak zawiera stan sprzed OSTATNIEGO zapisu — tracimy najwyżej jedną mutację.
  assertEq(res.state.assumptions.monthlyIncome, 10000, '.bak trzyma poprzedni pełny zapis');
});

test('F11: round-trip do najnowszej wersji; łańcuch migracji v1→…→SCHEMA_VERSION; nowsza wersja odrzucona', () => {
  const st = baseState();
  assertEq(st.version, S.SCHEMA_VERSION, 'engine i storage zsynchronizowane');
  assertEq(S.migrate(S.validateState(JSON.parse(S.exportJSON(st)).state)).version, S.SCHEMA_VERSION);
  const defaultIkeIkze = JSON.stringify({ enabled: false, employmentForm: 'employee', pitRate: 0.12, ikeStart: 0, ikzeStart: 0 });
  // v8 → v9: most ZUS — dokładane pola emerytury (celowo widoczny placeholder
  // emerytury minimalnej; D6).
  const v8 = JSON.parse(JSON.stringify(st));
  v8.version = 8;
  delete v8.assumptions.pensionMonthly;
  delete v8.assumptions.pensionAge;
  const m8 = S.migrate(S.validateState(v8));
  assertEq(m8.version, S.SCHEMA_VERSION);
  assertEq(m8.assumptions.pensionMonthly, 1978.49, 'placeholder emerytury minimalnej (marzec 2026)');
  assertEq(m8.assumptions.pensionAge, 65, 'ustawowy wiek 65');
  // Jawne wartości — w tym 0 = udokumentowany opt-out — przeżywają bez zmian.
  const v8b = JSON.parse(JSON.stringify(st));
  v8b.version = 8;
  v8b.assumptions.pensionMonthly = 0;
  v8b.assumptions.pensionAge = 60;
  const m8b = S.migrate(S.validateState(v8b));
  assertEq(m8b.assumptions.pensionMonthly, 0, 'jawne 0 (ZUS wyłączony) nietknięte');
  assertEq(m8b.assumptions.pensionAge, 60, 'jawny wiek (60 K) nietknięty');
  // v6 → v7: notatka na wpisie — brakujące pole dostemplowane jako null.
  const v6 = JSON.parse(JSON.stringify(st));
  v6.version = 6;
  v6.entries = [{ ...entry('2026-07', 8000, 5000), note: undefined }];
  delete v6.entries[0].note;
  const m6 = S.migrate(S.validateState(v6));
  assertEq(m6.version, S.SCHEMA_VERSION);
  assertEq(m6.entries[0].note, null, 'note dostemplowane jako null przy 6→7');
  // v5 → v6: dokładana podsekcja IKE/IKZE, domyślnie wyłączona.
  const v5 = JSON.parse(JSON.stringify(st));
  v5.version = 5;
  v5.taxes = { belkaEnabled: true }; // kształt v5: bez ikeIkze
  const m5 = S.migrate(S.validateState(v5));
  assertEq(m5.version, S.SCHEMA_VERSION);
  assertEq(m5.taxes.belkaEnabled, true, 'Belka nietknięta przy 5→6');
  assertEq(JSON.stringify(m5.taxes.ikeIkze), defaultIkeIkze, 'dokładny domyślny kształt ikeIkze');
  // Istniejąca konfiguracja ikeIkze przeżywa migrację bez zmian.
  const v5b = JSON.parse(JSON.stringify(st));
  v5b.version = 5;
  v5b.assumptions.portfolioStart = 2000; // IKE+IKZE ⊆ portfel (D6: kompozycja)
  v5b.taxes = { belkaEnabled: false, ikeIkze: { enabled: true, employmentForm: 'selfEmployed', pitRate: 0.32, ikeStart: 1000, ikzeStart: 500 } };
  const m5b = S.migrate(S.validateState(v5b));
  assertEq(m5b.taxes.ikeIkze.employmentForm, 'selfEmployed', 'jawna konfiguracja nietknięta');
  assertEq(m5b.taxes.ikeIkze.pitRate, 0.32, 'jawny pitRate nietknięty');
  // v4 → v5: dokładana sekcja podatków (Belka), domyślnie wyłączona.
  const v4 = JSON.parse(JSON.stringify(st));
  v4.version = 4;
  delete v4.taxes;
  const m4 = S.migrate(S.validateState(v4));
  assertEq(m4.version, S.SCHEMA_VERSION);
  assertEq(m4.taxes.belkaEnabled, false, 'Belka domyślnie wyłączona');
  assertEq(JSON.stringify(m4.taxes.ikeIkze), defaultIkeIkze, 'ikeIkze dołożone w łańcuchu 4→…→6');
  // Jawnie włączona Belka przeżywa migrację bez zmian.
  const v4b = JSON.parse(JSON.stringify(st));
  v4b.version = 4;
  v4b.taxes = { belkaEnabled: true };
  assertEq(S.migrate(S.validateState(v4b)).taxes.belkaEnabled, true, 'jawne true nietknięte');
  // v3 → v4: dokładane mrożenie wydatków po FIRE — domyślnie true (stałe realnie).
  const v3 = JSON.parse(JSON.stringify(st));
  v3.version = 3;
  delete v3.assumptions.freezeExpensesAtRetirement;
  delete v3.taxes;
  const m3 = S.migrate(S.validateState(v3));
  assertEq(m3.version, S.SCHEMA_VERSION);
  assertEq(m3.assumptions.freezeExpensesAtRetirement, true, 'domyślnie stałe realnie');
  // Jawne false przeżywa migrację bez zmian.
  const v3b = JSON.parse(JSON.stringify(st));
  v3b.version = 3;
  v3b.assumptions.freezeExpensesAtRetirement = false;
  assertEq(S.migrate(S.validateState(v3b)).assumptions.freezeExpensesAtRetirement, false, 'jawne false nietknięte');
  // v2 → v4: oba nowe pola (zwrot po FIRE + mrożenie) dołożone w jednym przebiegu.
  const v2 = JSON.parse(JSON.stringify(st));
  v2.version = 2;
  delete v2.assumptions.postRetirementReturnReal;
  delete v2.assumptions.freezeExpensesAtRetirement;
  delete v2.taxes;
  const m2 = S.migrate(S.validateState(v2));
  assertEq(m2.version, S.SCHEMA_VERSION, 'łańcuch 2→3→4→5→6→7');
  assertEq(m2.taxes.belkaEnabled, false, 'podatki dołożone w łańcuchu');
  assertEq(m2.assumptions.postRetirementReturnReal, 0.02, 'domyślna marża EDO 2%');
  assertEq(m2.assumptions.freezeExpensesAtRetirement, true, 'mrożenie dołożone');
  // Istniejąca jawna wartość zwrotu po FIRE przeżywa migrację bez zmian.
  const v2b = JSON.parse(JSON.stringify(st));
  v2b.version = 2;
  v2b.assumptions.postRetirementReturnReal = 0.03;
  assertEq(S.migrate(S.validateState(v2b)).assumptions.postRetirementReturnReal, 0.03, 'jawna wartość nietknięta');
  // v1 (bez długu rodzinnego, zwrotu po FIRE, mrożenia) → łańcuch 1→2→3→4.
  const v1 = JSON.parse(JSON.stringify(st));
  v1.version = 1;
  delete v1.housing.housePlan.familyLoan;
  delete v1.debt.familyOverrides;
  delete v1.assumptions.postRetirementReturnReal;
  delete v1.assumptions.freezeExpensesAtRetirement;
  delete v1.assumptions.pensionMonthly;
  delete v1.assumptions.pensionAge;
  delete v1.taxes;
  const migrated = S.migrate(S.validateState(v1));
  assertEq(migrated.version, S.SCHEMA_VERSION);
  assertTrue(migrated.housing.housePlan.familyLoan && migrated.housing.housePlan.familyLoan.enabled === false, 'familyLoan dodany, wyłączony');
  assertTrue(Array.isArray(migrated.debt.familyOverrides) && migrated.debt.familyOverrides.length === 0, 'familyOverrides = []');
  assertEq(migrated.assumptions.postRetirementReturnReal, 0.02, 'zwrot po FIRE dodany w łańcuchu');
  assertEq(migrated.assumptions.freezeExpensesAtRetirement, true, 'mrożenie dodane w łańcuchu');
  assertEq(migrated.taxes.belkaEnabled, false, 'podatki dodane w łańcuchu 1→…→7');
  assertTrue(migrated.taxes.ikeIkze && migrated.taxes.ikeIkze.enabled === false, 'ikeIkze dodane w łańcuchu 1→…→7');
  assertEq(migrated.assumptions.pensionMonthly, 1978.49, 'emerytura dodana w łańcuchu 1→…→9');
  assertEq(migrated.assumptions.pensionAge, 65, 'wiek emerytalny dodany w łańcuchu 1→…→9');
  assertThrows(() => S.importPreview(JSON.stringify({ app: S.APP_TAG, version: S.SCHEMA_VERSION + 1, state: {} })), 'wersja o 1 nowsza odrzucona');
  assertThrows(() => S.importPreview(JSON.stringify({ app: S.APP_TAG, version: 99, state: {} })), 'v99 odrzucona');
  assertThrows(() => S.importPreview(JSON.stringify({ app: 'inna-apka', version: 1, state: {} })), 'obcy plik odrzucony');
});

test('F11: świeży start i derived nie trafia do zapisu', () => {
  const backing = mockBacking();
  const store = S.makeStorage(backing);
  assertTrue(store.load().fresh, 'brak danych → fresh');
  const st = baseState();
  E.recomputeDerived(st, NOW);
  store.save(st);
  assertTrue(!JSON.parse(backing.getItem(S.KEY)).derived, 'derived odcięte');
});

// ── F12: routing dwóch kubełków ─────────────────────────────────────────

test('F12: przed kredytem nadwyżka ląduje w gotówce', () => {
  const st = baseState({
    anchorMonth: '2026-01',
    assumptions: { cashStart: 1000, portfolioStart: 500, realReturnAnnual: 0, inflationAnnual: 0 },
    housing: { housePlan: housePlan({ mortgage: { startMonth: '2027-01', principal: 12000, rateNominal: 0, termYears: 1 } }) },
  });
  st.entries.push(entry('2026-01', 5000, 3000));
  const b = E.replayBalances(st, '2026-01');
  assertClose(b.cash, 3000, 0.001);
  assertClose(b.portfolio, 500, 0.001);
});

test('F12: houseSpend (amount=null) zeruje gotówkę na starcie kredytu', () => {
  const st = f8State();
  st.housing.housePlan.houseSpend = { month: '2026-01', amount: null };
  const b = E.replayBalances(st, '2026-01');
  assertClose(b.cash, 0, 0.001, 'cała gotówka wydana na dom');
  assertClose(b.portfolio, 20000, 0.001, 'portfel nietknięty');
});

test('F12: houseSpend ponad gotówkę drenuje portfel + flaga niedoboru', () => {
  const st = f8State();
  st.housing.housePlan.houseSpend = { month: '2026-01', amount: 30000 };
  const b = E.replayBalances(st, '2026-01');
  assertClose(b.cash, 0, 0.001);
  assertClose(b.portfolio, 0, 0.001, '5000 gotówki + 20000 portfela < 30000');
  assertTrue(b.houseUnderfunded, 'flaga niedoboru');
});

test('F12: deficyt w fazie długu drenuje najpierw gotówkę, potem portfel', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 1000, 8000)); // net −7000 > gotówka 5000
  const b = E.replayBalances(st, '2026-02');
  assertClose(b.cash, 0, 0.001);
  assertClose(b.portfolio, 20000 - 2000, 0.001);
});

test('F12: po spłacie długu nadwyżka idzie do portfela', () => {
  const st = f8State(); // kredyt kończy się po 2026-12
  st.entries.push(entry('2027-02', 8000, 6000));
  const b = E.replayBalances(st, '2027-02');
  assertClose(b.portfolio, 22000, 0.001);
  assertClose(b.cash, 5000, 0.001);
});

test('F12: cashOverride resetuje tylko kubełek gotówki', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 8000, 6000, { cashOverride: 12345 }));
  const b = E.replayBalances(st, '2026-02');
  assertClose(b.cash, 12345, 0.001);
  assertClose(b.portfolio, 20000, 0.001);
});

// ── Check-in end-to-end ─────────────────────────────────────────────────

test('check-in: snapshot zamrożony, edycja odświeża, walidacje', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  const e = E.applyCheckIn(st, { month: '2026-05', earned: 10500, spent: 6000 }, NOW);
  assertClose(e.plannedSavingsSnapshot, 4000, 0.01);
  assertEq(e.verdict, 'on_plan'); // 4500 < 4000+600
  // Zmiana założeń nie przepisuje werdyktu…
  st.assumptions.monthlyIncome = 20000;
  E.recomputeDerived(st, NOW);
  assertEq(st.entries[0].verdict, 'on_plan');
  // …ale jawna edycja tak.
  const e2 = E.applyCheckIn(st, { month: '2026-05', earned: 10500, spent: 6000 }, NOW);
  assertClose(e2.plannedSavingsSnapshot, 14000, 0.01);
  assertEq(e2.verdict, 'hard');
  assertThrows(() => E.applyCheckIn(st, { month: '2026-07', earned: 1, spent: 1 }, NOW), 'przyszły miesiąc');
  assertThrows(() => E.applyCheckIn(st, { month: '2025-12', earned: 1, spent: 1 }, NOW), 'sprzed kotwicy');
  assertThrows(() => E.applyCheckIn(st, { month: '2026-04', earned: 1, spent: 1, overpayment: 100 }, NOW), 'nadpłata bez kredytu');
});

test('re-anchor: salda przeniesione, historia bez zmian', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 100000 } });
  E.applyCheckIn(st, { month: '2026-03', earned: 10000, spent: 6000 }, NOW);
  const balBefore = E.replayBalances(st, '2026-06').portfolio;
  E.reanchor(st, '2026-07', NOW);
  assertEq(st.anchorMonth, '2026-07');
  assertClose(st.assumptions.portfolioStart, Math.round(balBefore * 100) / 100, 0.011);
  assertEq(st.entries.length, 1, 'wpis został');
});

test('re-anchor wstecz: otwiera wcześniejsze miesiące, salda startowe bez zmian', () => {
  const st = baseState({ anchorMonth: '2026-05', assumptions: { portfolioStart: 100000, cashStart: 3000 } });
  E.recomputeDerived(st, NOW);
  // Wstecz na 2026-02: salda startowe zostają (to stan początku lutego wg wywołującego).
  E.reanchor(st, '2026-02', NOW);
  assertEq(st.anchorMonth, '2026-02');
  assertClose(st.assumptions.portfolioStart, 100000, 1e-9, 'portfel startowy nietknięty');
  assertClose(st.assumptions.cashStart, 3000, 1e-9, 'gotówka startowa nietknięta');
  // Teraz wcześniejszy miesiąc daje się wpisać (był „sprzed startu”).
  const e = E.applyCheckIn(st, { month: '2026-03', earned: 10000, spent: 6000 }, NOW);
  assertEq(e.month, '2026-03');
  assertThrows(() => E.applyCheckIn(st, { month: '2026-01', earned: 1, spent: 1 }, NOW), 'wciąż sprzed nowego startu');
});

test('Historia: add→remove wcześniejszego miesiąca to dokładny round trip', () => {
  const st = baseState({
    anchorMonth: '2026-05',
    assumptions: { portfolioStart: 100000, cashStart: 3000, realReturnAnnual: 0.05, cashReturnReal: 0.02 },
  });
  E.recomputeDerived(st, NOW);
  const anchor0 = st.anchorMonth;
  const port0 = st.assumptions.portfolioStart;
  const cash0 = st.assumptions.cashStart;
  E.addEarlierMonth(st, NOW);
  assertEq(st.anchorMonth, '2026-04', 'start cofnięty o miesiąc');
  E.removeEarliestMonth(st, NOW);
  assertEq(st.anchorMonth, anchor0, 'kotwica przywrócona');
  assertClose(st.assumptions.portfolioStart, port0, 1e-9, 'portfel startowy przywrócony');
  assertClose(st.assumptions.cashStart, cash0, 1e-9, 'gotówka startowa przywrócona');
});

test('Historia: remove pustego najwcześniejszego miesiąca — salda i wpisy bez zmian', () => {
  const st = baseState({
    anchorMonth: '2026-05',
    assumptions: { portfolioStart: 100000, cashStart: 3000, realReturnAnnual: 0.05, cashReturnReal: 0.02 },
  });
  E.recomputeDerived(st, NOW);
  const port0 = st.assumptions.portfolioStart;
  const cash0 = st.assumptions.cashStart;
  E.removeEarliestMonth(st, NOW);
  assertEq(st.anchorMonth, '2026-06', 'start przesunięty o miesiąc w przód');
  assertClose(st.assumptions.portfolioStart, port0, 1e-9, 'portfel startowy nietknięty');
  assertClose(st.assumptions.cashStart, cash0, 1e-9, 'gotówka startowa nietknięta');
  assertEq(st.entries.length, 0, 'brak wpisów, brak zmian');
});

test('Historia: remove usuwa check-in z najwcześniejszego miesiąca', () => {
  const st = baseState({ anchorMonth: '2026-05', assumptions: { portfolioStart: 100000 } });
  E.applyCheckIn(st, { month: '2026-05', earned: 10000, spent: 6000 }, NOW);
  E.applyCheckIn(st, { month: '2026-06', earned: 10000, spent: 6000 }, NOW);
  E.removeEarliestMonth(st, NOW);
  assertEq(st.anchorMonth, '2026-06', 'start przesunięty w przód');
  assertEq(st.entries.length, 1, 'brzegowy wpis usunięty, późniejszy został');
  assertEq(st.entries[0].month, '2026-06', 'został wpis czerwcowy');
});

test('Historia: remove nie przesuwa startu w przyszłość', () => {
  const st = baseState({ anchorMonth: '2026-07' }); // = todayYm(NOW)
  E.recomputeDerived(st, NOW);
  assertThrows(() => E.removeEarliestMonth(st, NOW), 'przyszłość');
});

// ── F13: Faza wypłat ────────────────────────────────────────────────────

test('F13a: Faza wypłat — parytet Excela (lata 1/2/35, R nominalne 8,15%)', () => {
  const f = FIX.F13;
  const st = baseState();
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: f.startReal });
  assertClose(w.nominalRate, f.nominalRate, 1e-9);
  const y1 = w.rows[0];
  assertClose(y1.withdrawalNominal, f.year1.withdrawalNominal, f.eps);
  assertClose(y1.growthNominal, f.year1.growthNominal, f.eps);
  assertClose(y1.endNominal, f.year1.endNominal, f.eps);
  assertClose(y1.endReal, f.year1.endReal, f.eps);
  assertClose(y1.endNominal / (1 + f.infl), y1.endReal, 1e-6, 'tożsamość nominal/real (rok 1)');
  assertClose(w.rows[1].endNominal, f.year2.endNominal, f.eps);
  assertEq(w.rows.length, 35);
  assertClose(w.rows[34].endNominal, f.year35EndNominal, f.eps);
  assertEq(w.depletedYear, null);
});

test('F13b: domyślny start = fireYm z portfelem z serii', () => {
  const st = baseState({ assumptions: { portfolioStart: 1700000 } });
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  assertTrue(proj.reached, 'FIRE osiągalne');
  const w = E.projectWithdrawal(st, { projection: proj });
  assertEq(w.hypothetical, false);
  assertEq(w.startYm, proj.fireYm);
  const row = proj.series.find(r => r.ym === proj.fireYm);
  assertClose(w.rows[0].startReal, row.portfolio, 1e-9);
});

test('F13c: r=0 → wyczerpanie dokładnie w roku 10', () => {
  const f = FIX.F13.depletionR0;
  // Faza wypłat czyta teraz zwrot po FIRE — zerujemy go, by uzyskać r=0.
  const st = baseState({ assumptions: { realReturnAnnual: 0, postRetirementReturnReal: 0 } });
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: f.startReal });
  assertEq(w.depletedYear, f.years);
  assertEq(w.rows.length, f.years);
  assertClose(w.rows[f.years - 1].endReal, 0, 1e-9);
});

test('F13d: FIRE poza horyzontem → scenariusz modelowy (hypothetical)', () => {
  const st = baseState({ assumptions: { monthlyIncome: 6100 } });
  E.recomputeDerived(st, NOW);
  assertEq(st.derived.projection.reached, false);
  const w = E.projectWithdrawal(st, { projection: st.derived.projection });
  assertEq(w.hypothetical, true);
  assertClose(w.rows[0].startReal, E.fireTargetAt(st, w.startYm), 1e-9, 'start od dzisiejszego celu');
});

// ── F14: Projekcja roczna (model aplikacji) ─────────────────────────────

test('F14a: tożsamość rezydualna + rok 1 = 154 290,31 + rekonsyliacja z serią', () => {
  const f = FIX.F14;
  const st = baseState({ assumptions: { portfolioStart: f.start } });
  E.recomputeDerived(st, NOW);
  const blocks = E.yearlyProjection(st, st.derived.projection);
  for (const b of blocks) {
    assertClose(b.portEnd - b.portStart - b.flowPortfolio, b.growthPortfolio, 1e-9, `rok ${b.t}:`);
  }
  const b1 = blocks[0];
  assertEq(b1.months, 12);
  assertEq(b1.projected, 'full');
  assertClose(b1.portStart, f.start, 1e-9);
  assertClose(b1.flowPortfolio, f.monthlyContrib * 12, 0.01);
  assertClose(b1.portEnd, f.year1End, f.eps);
  const series = st.derived.projection.series;
  assertClose(blocks[blocks.length - 1].portEnd, series[series.length - 1].portfolio, 1e-9, 'rekonsyliacja:');
});

test('F14b: częściowy rok końcowy kończy się w fireYm', () => {
  const st = baseState({ assumptions: { portfolioStart: 1700000 } });
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  const blocks = E.yearlyProjection(st, proj);
  const last = blocks[blocks.length - 1];
  assertTrue(proj.reached);
  assertEq(last.ymTo, proj.fireYm);
  assertTrue(last.months <= 12, 'blok częściowy');
  assertEq(last.reached, true);
  assertTrue(blocks.slice(0, -1).every(b => !b.reached), 'FIRE tylko w ostatnim bloku');
});

test('F14c: przepływy domu i długu przy stopach 0% (arytmetyka całkowita)', () => {
  const st = f8State();
  st.entries.push(entry('2026-02', 8000, 6000)); // kontrybucja 2000 → gotówka
  E.recomputeDerived(st, NOW);
  const blocks = E.yearlyProjection(st, st.derived.projection);
  const b1 = blocks[0]; // 2026-01..2026-12: pół historii, pół prognozy
  assertEq(b1.projected, 'part');
  assertClose(b1.flowCash, 2000, 1e-9);
  assertClose(b1.cashEnd, 5000 + 2000, 1e-9);
  // Prognoza: lip nadpłata 3000 → dług 2000; sie spill 2000 → portfel; wrz–gru +3000/mies.
  assertClose(b1.flowPortfolio, 2000 + 4 * 3000, 1e-9);
  assertClose(b1.portEnd, 20000 + 14000, 1e-9);
  assertClose(b1.growthPortfolio, 0, 1e-9, 'r=0 → wzrost 0:');
  assertClose(b1.debtRealEnd, 0, 1e-9);
});

// ── F15: parytet arkusza Projekcja + wrażliwość ─────────────────────────

test('F15: excelProjection — rok 20 z F1, rok 22 osiąga cel rosnący 1%', () => {
  const f1 = FIX.F1;
  const st = baseState({ assumptions: { expenseGrowthReal: 0.01 } });
  const rows = E.excelProjection(st, { start: f1.start, contribYearly: f1.contribYearly, years: 25 });
  assertClose(rows[19].endBal, f1.expectedYear20, f1.eps);
  const y22 = rows[21];
  assertClose(y22.endBal, FIX.F15.excelYear22.end, 0.5);
  assertClose(y22.target, FIX.F15.excelYear22.target, 0.5);
  assertEq(y22.reached, FIX.F15.excelYear22.reached);
  assertEq(rows[20].reached, false, 'rok 21 jeszcze nie:');
});

test('F15a: projectionWith nie mutuje stanu', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  st.entries.push(entry('2026-01', 10000, 6000, { plannedSavingsSnapshot: 4000 }));
  E.recomputeDerived(st, NOW);
  const before = JSON.stringify(st);
  E.projectionWith(st, { assumptions: { realReturnAnnual: 0.07, withdrawalRate: 0.035 }, extraMonthlySavings: 1000 }, NOW);
  assertEq(JSON.stringify(st), before);
});

test('F15b: bez nadpisań wynik = prognoza bazowa', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const p = E.projectionWith(st, {}, NOW);
  assertEq(p.reached, true);
  assertEq(p.fireYm, st.derived.projection.fireYm);
});

test('F15c: monotoniczność (±1 pp zwrotu, +1000 zł oszczędności)', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const base = st.derived.projection.fireYm;
  const up = E.projectionWith(st, { assumptions: { realReturnAnnual: 0.06 } }, NOW).fireYm;
  const down = E.projectionWith(st, { assumptions: { realReturnAnnual: 0.04 } }, NOW).fireYm;
  const extra = E.projectionWith(st, { extraMonthlySavings: 1000 }, NOW).fireYm;
  assertTrue(E.ymToIdx(up) <= E.ymToIdx(base), 'wyższy zwrot nie później');
  assertTrue(E.ymToIdx(down) >= E.ymToIdx(base), 'niższy zwrot nie wcześniej');
  assertTrue(E.ymToIdx(extra) <= E.ymToIdx(base), 'wyższe oszczędności nie później');
});

// ── F16: tabela SWR ─────────────────────────────────────────────────────

test('F16: tabela SWR (2,4 mln / ~2,057 mln / 1,8 mln)', () => {
  const st = baseState();
  const rows = E.swrComparison(st, '2026-07');
  assertEq(rows.length, 3, 'WR użytkownika = 4% → bez dodatkowego wiersza:');
  for (const fx of FIX.F16.rows) {
    const r = rows.find(x => Math.abs(x.swr - fx.swr) < 1e-9);
    assertClose(r.target, fx.target, 0.01, `SWR ${fx.swr}:`);
  }
  assertClose(rows[0].diffVs4pct, FIX.F16.diff3pct, 0.01);
  assertClose(rows[1].diffVs4pct, FIX.F16.diff35pct, 0.01);
  assertClose(rows[2].multiplier, 25, 1e-9);
  assertTrue(rows[2].isUser, 'flaga isUser na 4%');
  const rows2 = E.swrComparison(baseState({ assumptions: { withdrawalRate: 0.045 } }), '2026-07');
  assertEq(rows2.length, 4, 'nietypowe WR → dodatkowy wiersz:');
  assertEq(rows2[3].label, 'Twoje ustawienie');
});

// ── F17: Coast FIRE i analityka kredytu ─────────────────────────────────

test('F17a: Coast FIRE = 729 911,95 zł', () => {
  const st = baseState();
  E.recomputeDerived(st, NOW);
  const fi = E.fiStats(st, st.derived.balances, st.derived.debt, st.derived.plan, '2026-07');
  assertClose(fi.coast.number, FIX.F17.coast, FIX.F17.eps);
  assertEq(fi.coast.reached, false);
  assertEq(fi.coast.fireAgeYm, '2045-01');
  assertClose(fi.target, 1800000, 0.01);
  assertClose(fi.monthlyExpenses, 6000, 0.01);
});

function f17State() {
  return baseState({
    anchorMonth: '2026-01',
    housing: {
      housePlan: housePlan({
        moveInMonth: '2026-01',
        houseSpend: { month: '2026-01', amount: 0 },
        mortgage: { startMonth: '2026-01', principal: 1100000, rateNominal: 0.07, termYears: 15 },
      }),
    },
  });
}

test('F17b: kredyt bez nadpłat — Σodsetek kontraktu, oszczędność ≈ 0', () => {
  const st = f17State();
  E.recomputeDerived(st, NOW);
  const ma = E.mortgageAnalytics(st, st.derived.debt, st.derived.projection);
  assertClose(ma.contractTotalInterest, FIX.F17.contractInterest, FIX.F17.eps);
  assertClose(ma.interestSavedSoFar, 0, FIX.F17.eps);
  assertEq(ma.monthsAheadOfContract, 0);
  assertEq(ma.contractPayoffYm, '2040-12');
  assertClose(ma.paidInterest + ma.scheduleOnlyRemainingInterest, ma.contractTotalInterest, FIX.F17.eps);
  assertEq(ma.overpaidTotal, 0);
});

test('F17c: nadpłata → oszczędność odsetek i szybsza spłata', () => {
  const st = f17State();
  st.entries.push(entry('2026-03', 60000, 6000, { overpayment: 50000 }));
  E.recomputeDerived(st, NOW);
  const ma = E.mortgageAnalytics(st, st.derived.debt, st.derived.projection);
  assertTrue(ma.interestSavedSoFar > 0, 'oszczędność > 0');
  assertTrue(ma.monthsAheadOfContract >= 1, 'spłata szybciej o ≥ 1 mies.');
  assertClose(ma.overpaidTotal, 50000, 0.01);
});

// ── F18: symulacja „co jeśli” (extraSavings per miesiąc) ────────────────

function f18State() {
  return baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 100000, realReturnAnnual: 0 } });
}

const rowAt = (p, ym) => p.series.find(r => r.ym === ym);

test('F18a: extraSavings nie mutuje stanu', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  st.entries.push(entry('2026-01', 10000, 6000, { plannedSavingsSnapshot: 4000 }));
  E.recomputeDerived(st, NOW);
  const before = JSON.stringify(st);
  E.projectionWith(st, { extraSavings: { month: '2026-09', amount: 2000, recurring: false } }, NOW);
  E.projectionWith(st, { extraSavings: { month: '2026-09', amount: -500, recurring: true } }, NOW);
  assertEq(JSON.stringify(st), before);
});

test('F18b: jednorazowo przy r=0 — dokładnie +2000 od miesiąca symulacji', () => {
  const f = FIX.F18.oneTime;
  const st = f18State();
  const base = E.projectionWith(st, {}, NOW);
  const sim = E.projectionWith(st, { extraSavings: { month: f.month, amount: f.amount, recurring: false } }, NOW);
  assertClose(rowAt(sim, '2026-08').portfolio - rowAt(base, '2026-08').portfolio, 0, 1e-9, 'przed miesiącem symulacji:');
  assertClose(rowAt(sim, f.month).portfolio - rowAt(base, f.month).portfolio, f.amount, 1e-9, 'miesiąc symulacji:');
  assertClose(rowAt(sim, '2027-06').portfolio - rowAt(base, '2027-06').portfolio, f.amount, 1e-9, 'utrzymuje się dalej:');
});

test('F18c: co miesiąc od pierwszego prognozowanego miesiąca ≡ extraMonthlySavings', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  const flat = E.projectionWith(st, { extraMonthlySavings: 1000 }, NOW);
  const rec = E.projectionWith(st, { extraSavings: { month: '2026-07', amount: 1000, recurring: true } }, NOW);
  assertEq(rec.fireYm, flat.fireYm);
  assertClose(rec.series[rec.series.length - 1].portfolio, flat.series[flat.series.length - 1].portfolio, 1e-9);
  const past = E.projectionWith(st, { extraSavings: { month: '2026-01', amount: 1000, recurring: true } }, NOW);
  assertEq(past.fireYm, flat.fireYm, 'start w przeszłości = od pierwszego prognozowanego:');
  assertClose(past.series[past.series.length - 1].portfolio, flat.series[flat.series.length - 1].portfolio, 1e-9);
});

test('F18d: krawędzie — przeszłość / poza horyzontem / po dacie FIRE = baza; zły miesiąc rzuca', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  const base = E.projectionWith(st, {}, NOW);
  assertTrue(base.reached, 'baza osiąga FIRE');
  const past = E.projectionWith(st, { extraSavings: { month: '2026-03', amount: 5000, recurring: false } }, NOW);
  assertEq(past.fireYm, base.fireYm, 'jednorazowo w przeszłości:');
  assertClose(past.series[past.series.length - 1].portfolio, base.series[base.series.length - 1].portfolio, 1e-9);
  const far = E.projectionWith(st, { extraSavings: { month: '2100-01', amount: 5000, recurring: false } }, NOW);
  assertEq(far.fireYm, base.fireYm, 'poza horyzontem planu:');
  const after = E.projectionWith(st, { extraSavings: { month: E.addMonths(base.fireYm, 12), amount: 5000, recurring: false } }, NOW);
  assertEq(after.fireYm, base.fireYm, 'po dacie FIRE:');
  assertThrows(() => E.projectionWith(st, { extraSavings: { month: '2026-13', amount: 100, recurring: false } }, NOW));
});

test('F18e: ujemne kwoty, monotoniczność; r=0 → +1000 od 2027-01 = +6000 w 2027-06', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  const base = E.projectionWith(st, {}, NOW);
  const minus = E.projectionWith(st, { extraSavings: { month: '2026-07', amount: -1000, recurring: true } }, NOW);
  const plus = E.projectionWith(st, { extraSavings: { month: '2026-07', amount: 1000, recurring: true } }, NOW);
  assertTrue(minus.reached && E.ymToIdx(minus.fireYm) >= E.ymToIdx(base.fireYm), 'mniej oszczędności nie wcześniej');
  assertTrue(plus.reached && E.ymToIdx(plus.fireYm) <= E.ymToIdx(base.fireYm), 'więcej oszczędności nie później');
  const st0 = f18State();
  const b0 = E.projectionWith(st0, {}, NOW);
  const r0 = E.projectionWith(st0, { extraSavings: { month: FIX.F18.recurringFrom, amount: FIX.F18.recurringAmount, recurring: true } }, NOW);
  assertClose(rowAt(r0, '2027-06').portfolio - rowAt(b0, '2027-06').portfolio,
    FIX.F18.recurringAmount * FIX.F18.monthsToJun2027, 1e-9);
});

// ── F19: postęp „drogi do FIRE" ─────────────────────────────────────────

test('F19a: droga do FIRE przy r=0 to udział odłożonych miesięcy', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000, realReturnAnnual: 0 } });
  // Snapshot = plan (4000) → delta 0; przyszłość = czysty plan, ułamek dokładny.
  for (let i = 0; i < 6; i++) st.entries.push(entry(E.addMonths('2026-01', i), 10000, 6000, { plannedSavingsSnapshot: 4000 }));
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const jp = E.fireJourneyProgress(st, d.plan, d.projection, d.uptoYm);
  assertTrue(jp.reached, 'FIRE w horyzoncie');
  const totalMonths = E.ymToIdx(d.projection.fireYm) - E.ymToIdx('2026-01') + 1;
  assertClose(jp.pct, 6 / totalMonths, 1e-9);
  assertClose(jp.savedValue, 6 * 4000, 1e-9, 'r=0 → wagi = 1');
  assertClose(jp.monthlySaveNow, 4000, 1e-9);
});

test('F19b: pasek tylko rośnie — miesiąc na minusie liczony jako 0', () => {
  const mk = neg => {
    const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000, realReturnAnnual: 0 } });
    for (let i = 0; i < 5; i++) st.entries.push(entry(E.addMonths('2026-01', i), 10000, 6000)); // 5 dobrych
    st.entries.push(entry('2026-06', neg ? 3000 : 10000, neg ? 9000 : 6000)); // minus (−6000) vs plus (+4000)
    E.recomputeDerived(st, NOW);
    return E.fireJourneyProgress(st, st.derived.plan, st.derived.projection, st.derived.uptoYm);
  };
  const plus = mk(false), minus = mk(true);
  assertClose(minus.savedValue, 5 * 4000, 1e-9, 'minus nie odejmuje — max(0, ·)');
  assertTrue(plus.savedValue > minus.savedValue, 'dobry miesiąc podnosi pasek');
  assertTrue(minus.pct >= 0 && minus.pct <= 1, 'zakres [0,1]');
});

test('F19d: cel poza horyzontem → mianownik zdegenerowany, reached=false (UI wraca do FI%)', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { monthlyIncome: 1000, monthlyLivingExpenses: 6000, portfolioStart: 10000, realReturnAnnual: 0 } });
  st.entries.push(entry('2026-01', 10000, 6000)); // jeden dobry miesiąc mimo ujemnego planu
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  assertEq(d.projection.reached, false);
  const jp = E.fireJourneyProgress(st, d.plan, d.projection, d.uptoYm);
  assertEq(jp.reached, false, 'flaga dla UI');
  assertClose(jp.pct, 1, 1e-9, 'bez dodatnich przyszłych wpłat saved = total');
});

test('F19c: wpłaty w fazie domu też liczą się do FIRE', () => {
  const st = baseState({
    anchorMonth: '2026-01',
    assumptions: { portfolioStart: 1300000, realReturnAnnual: 0 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2027-01',
        houseSpend: { month: '2027-01', amount: 0 },
        mortgage: { startMonth: '2027-01', principal: 300000, rateNominal: 0.07, termYears: 20 },
      }),
    },
  });
  for (let i = 0; i < 6; i++) st.entries.push(entry(E.addMonths('2026-01', i), 10000, 6000)); // faza funduszu na dom
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const jp = E.fireJourneyProgress(st, d.plan, d.projection, d.uptoYm);
  assertClose(jp.savedValue, 6 * 4000, 1e-9, 'odłożone na dom liczą się (r=0)');
  assertTrue(jp.pct > 0 && jp.pct < 1, 'pasek rusza mimo portfela ≈ start');
});

// ── F20: dług rodzinny (family loan) ────────────────────────────────────

// Kredyt 0% i dług rodzinny 0% dla ręcznych rachunków całkowitych.
// Mortgage: 12 000/1 rok → rata 1000. Family: 24 000, okno 12 mies. → rata 2000.
function f20State(flOver = {}) {
  return baseState({
    anchorMonth: '2026-01',
    assumptions: { cashStart: 5000, portfolioStart: 20000, realReturnAnnual: 0, inflationAnnual: 0 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2026-01',
        houseSpend: { month: '2026-01', amount: 0 },
        mortgage: { startMonth: '2026-01', principal: 12000, rateNominal: 0, termYears: 1 },
        familyLoan: deep({ enabled: true, startMonth: '2026-01', endMonth: '2026-12', principal: 24000, rateNominal: 0, paymentOverrideMonthly: null }, flOver),
      }),
    },
  });
}

test('F20a: familyLoanPayment ≡ annuitet; N krokiem → saldo ≈ 0', () => {
  const f = FIX.F20;
  const fl = { principal: f.principal, rateNominal: f.rateNominal, startMonth: f.startMonth, endMonth: f.endMonth, paymentOverrideMonthly: null };
  assertEq(E.familyLoanTermMonths(fl), f.N);
  const A = E.familyLoanPayment(fl);
  const j = E.monthlyRate(f.rateNominal);
  assertClose(A, E.annuityPayment(f.principal, j, f.N, null), 1e-9, 'parytet z annuityPayment');
  let bal = f.principal;
  for (let i = 0; i < f.N; i++) bal = E.mortgageStep(bal, j, A).bal;
  assertClose(bal, 0, f.eps, 'saldo po N ratach');
  // Override raty respektowany.
  assertEq(E.familyLoanPayment({ ...fl, paymentOverrideMonthly: 3333 }), 3333);
});

test('F20b: replayFamilyLoan — determinizm i miesiące bez wpisu', () => {
  const st = f20State();
  const a = E.replayFamilyLoan(st, '2026-03');
  const b = E.replayFamilyLoan(st, '2026-03');
  assertEq(JSON.stringify(a.rows), JSON.stringify(b.rows));
  assertClose(a.balanceNominal, 24000 - 6000, 1e-9, 'rata planowa schodzi mimo braku wpisów');
  assertTrue(a.started && a.active);
  // Wyłączony dług rodzinny → pusty wynik.
  const off = f20State({ enabled: false });
  const e = E.replayFamilyLoan(off, '2026-03');
  assertEq(e.started, false);
  assertEq(e.balanceNominal, 0);
});

test('F20c: familyOverpayment redukuje dług; kontrybucja pomniejszona idzie do gotówki', () => {
  const st = f20State();
  st.entries.push(entry('2026-02', 8000, 6000, { familyOverpayment: 500 }));
  const fam = E.replayFamilyLoan(st, '2026-02');
  assertClose(fam.balanceNominal, 24000 - 4000 - 500, 1e-9);
  const debt = E.replayDebt(st, '2026-02');
  const b = E.replayBalances(st, '2026-02', debt, fam);
  // Faza długu (kredyt aktywny) → kontrybucja (2000−500=1500) do gotówki.
  assertClose(b.cash, 5000 + 1500, 1e-9);
  assertClose(b.portfolio, 20000, 1e-9);
});

test('F20d: nadpłata długu rodzinnego ponad saldo → spill do portfela, dług = 0', () => {
  const st = f20State();
  st.entries.push(entry('2026-02', 40000, 6000, { familyOverpayment: 30000 }));
  const fam = E.replayFamilyLoan(st, '2026-02');
  assertEq(fam.balanceNominal, 0, 'dług rodzinny wyzerowany');
  // Sty: 24000→22000. Lut: rata 2000 + nadpłata 30000 → spill 10000.
  const debt = E.replayDebt(st, '2026-02');
  const b = E.replayBalances(st, '2026-02', debt, fam);
  assertClose(b.portfolio, 20000 + 10000, 1e-9);
  // kontrybucja = 34000 − 30000 = 4000 → gotówka (faza długu).
  assertClose(b.cash, 5000 + 4000, 1e-9);
});

test('F20e: familyOverrides resetuje łańcuch od tego miesiąca', () => {
  const st = f20State();
  st.debt.familyOverrides = [{ month: '2026-02', balanceNominal: 50000 }];
  const fam = E.replayFamilyLoan(st, '2026-03');
  assertClose(fam.balanceNominal, 50000 - 2000, 1e-9, 'override 50000 w lutym, rata w marcu');
});

test('F20f: buildPlan — plannedSavings pomniejszone o ratę rodzinną tylko w oknie', () => {
  const st = baseState({
    anchorMonth: '2026-01',
    assumptions: { monthlyIncome: 10000, monthlyLivingExpenses: 6000, incomeGrowthReal: 0, expenseGrowthReal: 0, inflationAnnual: 0 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2026-01',
        houseSpend: { month: '2030-01', amount: 0 },
        mortgage: { startMonth: '2030-01', principal: 12000, rateNominal: 0, termYears: 1 },
        familyLoan: { enabled: true, startMonth: '2028-01', endMonth: '2028-12', principal: 24000, rateNominal: 0, paymentOverrideMonthly: null },
      }),
    },
  });
  const plan = E.buildPlan(st);
  const at = ym => plan[E.monthsBetween('2026-01', ym)];
  assertClose(at('2027-12').plannedSavings, 4000, 1e-9, 'przed oknem: pełne 4000');
  assertClose(at('2028-06').plannedSavings, 4000 - 2000, 1e-9, 'w oknie: −rata 2000');
  assertClose(at('2028-06').familyPaymentReal, 2000, 1e-9);
  assertClose(at('2029-01').plannedSavings, 4000, 1e-9, 'po oknie: znów 4000');
});

test('F20g: projectFire — FIRE zablokowane póki dług rodzinny > 0; familyFreeYm', () => {
  const st = baseState({
    anchorMonth: '2026-01',
    assumptions: { portfolioStart: 2000000, cashStart: 0, realReturnAnnual: 0.05 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2026-08',
        houseSpend: { month: '2026-08', amount: 0 },
        mortgage: { startMonth: '2026-08', principal: 12000, rateNominal: 0, termYears: 1 },
        familyLoan: { enabled: true, startMonth: '2026-08', endMonth: '2027-07', principal: 24000, rateNominal: 0.035, paymentOverrideMonthly: null },
      }),
    },
  });
  E.recomputeDerived(st, NOW);
  const p = st.derived.projection;
  assertTrue(p.reached, 'w końcu osiąga FIRE');
  assertTrue(p.familyFreeYm != null, 'data spłaty długu rodzinnego wyznaczona');
  assertTrue(E.ymToIdx(p.fireYm) >= E.ymToIdx(p.familyFreeYm), 'FIRE nie przed spłatą długu rodzinnego');
  assertTrue(E.ymToIdx(p.fireYm) >= E.ymToIdx(p.debtFreeYm), 'ani przed spłatą kredytu');
});

test('F20h: majątek netto pomniejszony o dług rodzinny (realnie)', () => {
  const st = f20State();
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const withFam = E.fiStats(st, d.balances, d.debt, d.plan, '2026-06', d.family);
  const noFam = E.fiStats(st, d.balances, d.debt, d.plan, '2026-06', null);
  assertClose(noFam.netWorth - withFam.netWorth, d.family.balanceReal, 1e-9);
  assertTrue(d.family.balanceReal > 0, 'dług rodzinny wciąż aktywny w 2026-06');
});

test('F20i: yearlyPrincipalInterest — Σ kapitału = principal, Σ rat = kapitał+odsetki', () => {
  const f = FIX.F20;
  const rows = E.amortizationScheduleN(f.principal, f.rateNominal, f.N, null);
  const years = E.yearlyPrincipalInterest(rows);
  const sumP = years.reduce((s, y) => s + y.principal, 0);
  const sumI = years.reduce((s, y) => s + y.interest, 0);
  assertClose(sumP, f.principal, 0.01, 'Σ kapitału = principal');
  const A = E.familyLoanPayment({ principal: f.principal, rateNominal: f.rateNominal, startMonth: f.startMonth, endMonth: f.endMonth, paymentOverrideMonthly: null });
  assertClose(sumP + sumI, A * f.N, 0.5, 'Σ (kapitał+odsetki) = Σ rat');
  assertEq(years.length, Math.ceil(f.N / 12));
});

test('F20k: fiStats — rata rodzinna wliczona w miesięczne wydatki (runway)', () => {
  const st = f20State();
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const fi = E.fiStats(st, d.balances, d.debt, d.plan, '2026-06', d.family);
  // życie 6000 + czynsz 0 + rata kredytu 1000 + rata rodzinna 2000 = 9000.
  assertClose(fi.monthlyExpenses, 9000, 1e-9, 'wydatki mies. z ratą rodzinną');
  assertClose(fi.runwayMonths, (d.balances.cash + d.balances.portfolio) / 9000, 1e-9, 'runway na pełnych wydatkach');
});

test('F20j: applyCheckIn — nadpłata rodzinna tylko przy aktywnym długu, zapisana na wpisie', () => {
  const st = f20State();
  const e = E.applyCheckIn(st, { month: '2026-02', earned: 8000, spent: 6000, familyOverpayment: 500 }, NOW);
  assertEq(e.familyOverpayment, 500);
  // derived liczy do ostatniego pełnego miesiąca (2026-06): 6 rat po 2000 + nadpłata 500.
  assertClose(st.derived.family.balanceNominal, 24000 - 12000 - 500, 1e-9);
  // Po oknie spłaty (dług rodzinny = 0) nadpłata rzuca. Okno 2 mies. → spłacone od marca.
  const st2 = f20State({ endMonth: '2026-02' });
  assertThrows(() => E.applyCheckIn(st2, { month: '2026-04', earned: 8000, spent: 6000, familyOverpayment: 100 }, NOW),
    'nadpłata bez aktywnego długu rodzinnego');
});

// ── F21: wartość przyszła równych wpłat (annuity-due) ───────────────────

test('F21a: futureValueOfMonthly ≡ zamknięta forma i część składkowa silnika', () => {
  const f = FIX.F21;
  const rm = E.monthlyRate(f.annualReal);
  const N = f.months;
  const closed = f.monthly * (1 + rm) * (Math.pow(1 + rm, N) - 1) / rm;
  assertClose(E.futureValueOfMonthly(f.monthly, f.annualReal, N / 12), closed, 1e-6, 'parytet z zamkniętą formą');
  // Cross-check konwencji annuity-due z F2: replayBalances (start 0, same wpłaty).
  const st = baseState({ assumptions: { portfolioStart: 0, realReturnAnnual: f.annualReal } });
  for (let i = 0; i < N; i++) st.entries.push(entry(E.addMonths('2026-07', i), f.monthly, 0));
  const res = E.replayBalances(st, E.addMonths('2026-07', N - 1));
  assertClose(res.portfolio, E.futureValueOfMonthly(f.monthly, f.annualReal, N / 12), 0.01, 'parytet z silnikiem miesięcznym');
});

test('F21b: r=0 → suma nominalna monthly·N', () => {
  assertClose(E.futureValueOfMonthly(500, 0, 3), 500 * 36, 1e-9);
});

// ── F22: cel wieku FIRE (solveExtraSavingsForAge) ───────────────────────

test('F22a: rozwiązanie osiąga cel, tuż poniżej nie; monotoniczność', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const base = st.derived.projection;
  assertTrue(base.reached, 'baza osiąga FIRE');
  const targetMonths = base.fireAge.totalMonths - 12; // rok wcześniej → wymaga dodatku
  const sol = E.solveExtraSavingsForAge(st, targetMonths, {}, NOW);
  assertTrue(sol.feasible, 'wykonalne w granicach cap');
  assertTrue(sol.extraMonthly > 0, 'wymaga dodatkowych oszczędności');
  const at = E.projectionWith(st, { extraMonthlySavings: sol.extraMonthly }, NOW);
  assertTrue(at.reached && at.fireAge.totalMonths <= targetMonths, 'cel spełniony przy rozwiązaniu');
  const below = E.projectionWith(st, { extraMonthlySavings: Math.max(0, sol.extraMonthly - 500) }, NOW);
  assertTrue(!(below.reached && below.fireAge.totalMonths <= targetMonths), 'tuż poniżej progu nie spełnia');
  const more = E.projectionWith(st, { extraMonthlySavings: sol.extraMonthly + 2000 }, NOW);
  assertTrue(E.ymToIdx(more.fireYm) <= E.ymToIdx(at.fireYm), 'monotoniczność: więcej → nie później');
});

test('F22b: cel niewykonalny w granicach cap → feasible=false', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 100000 } });
  E.recomputeDerived(st, NOW);
  // Wiek 20 lat (240 mies.) — już za nami (urodzony 2000), nieosiągalne mimo cap.
  const sol = E.solveExtraSavingsForAge(st, 240, { cap: FIX.F22.cap }, NOW);
  assertEq(sol.feasible, false);
  assertEq(sol.extraMonthly, null);
});

test('F22c: już na dobrej drodze → extraMonthly=0', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1700000 } });
  E.recomputeDerived(st, NOW);
  const base = st.derived.projection;
  assertTrue(base.reached);
  const sol = E.solveExtraSavingsForAge(st, base.fireAge.totalMonths + 24, {}, NOW);
  assertEq(sol.extraMonthly, 0);
  assertTrue(sol.feasible);
});

// ── F23: wymagane oszczędności na cel wieku (requiredSavingsForGoal) ─────

test('F23a: plan wystarcza → onTrack, extra=0, required=plan', () => {
  const st = baseState({ anchorMonth: '2026-07', assumptions: {
    portfolioStart: FIX.F23.onTrack.portfolioStart, targetFireAge: FIX.F23.onTrack.targetFireAge } });
  const rsg = E.requiredSavingsForGoal(st, NOW);
  assertEq(rsg.status, 'onTrack');
  assertEq(rsg.extraMonthly, 0);
  const plannedNow = E.plannedSavingsFor(E.buildPlan(st), '2026-07');
  assertClose(rsg.plannedNow, plannedNow, 1e-9);
  assertClose(rsg.requiredMonthly, plannedNow, 1e-9);
});

test('F23b: plan nie wystarcza → need, required=plan+extra, dopłata trafia w cel', () => {
  const st = baseState({ anchorMonth: '2026-07', assumptions: {
    portfolioStart: FIX.F23.need.portfolioStart, targetFireAge: FIX.F23.need.targetFireAge } });
  const rsg = E.requiredSavingsForGoal(st, NOW);
  assertEq(rsg.status, 'need');
  assertTrue(rsg.extraMonthly > 0, 'wymaga dopłaty');
  assertClose(rsg.requiredMonthly, rsg.plannedNow + rsg.extraMonthly, 1e-9);
  // Kontrola: dopłata = extraMonthly sprowadza FIRE najpóźniej do docelowego wieku
  // (wiąże liczbę z kontraktem solvera solveExtraSavingsForAge).
  const ctrl = E.projectionWith(st, { extraMonthlySavings: rsg.extraMonthly }, NOW);
  assertTrue(ctrl.reached, 'osiąga FIRE');
  assertTrue(ctrl.fireAge.totalMonths <= Math.round(FIX.F23.need.targetFireAge * 12), 'w docelowym wieku');
});

test('F23c: wiek nieosiągalny nawet przy dużej dopłacie → infeasible', () => {
  const st = baseState({ anchorMonth: '2026-07', assumptions: {
    portfolioStart: FIX.F23.infeasible.portfolioStart, targetFireAge: FIX.F23.infeasible.targetFireAge } });
  const rsg = E.requiredSavingsForGoal(st, NOW);
  assertEq(rsg.status, 'infeasible');
});

// ── Statystyki oszczędzania i wykonania planu ───────────────────────────

test('statystyki: stopa oszczędzania (ostatni / 12 mies. / całość)', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-01', 10000, 6000));
  st.entries.push(entry('2026-02', 10000, 8000));
  const s = E.savingsStats(st, '2026-06');
  assertEq(s.overall.n, 2);
  assertClose(s.overall.net, 6000, 0.01);
  assertClose(s.overall.rate, 0.3, 1e-9);
  assertEq(s.last.n, 1);
  assertClose(s.last.rate, 0.2, 1e-9, 'ostatni = luty:');
  assertClose(s.trailing12.net, s.overall.net, 1e-9);
  assertEq(E.savingsStats(baseState(), '2026-06').overall.rate, null, 'brak wpisów → rate null');
});

test('statystyki: wykonanie planu na zamrożonych snapshotach', () => {
  const es = [
    entry('2026-01', 10000, 6000, { plannedSavingsSnapshot: 4000, verdict: 'on_plan' }),
    entry('2026-02', 10000, 5000, { plannedSavingsSnapshot: 4000, verdict: 'crushed' }),
    entry('2026-03', 10000, 8000, { plannedSavingsSnapshot: 4000, verdict: 'hard' }),
  ];
  const p = E.planVsActualStats(es);
  assertEq(p.n, 3);
  assertClose(p.cumNet, 11000, 0.01);
  assertClose(p.cumPlanned, 12000, 0.01);
  assertClose(p.cumDelta, -1000, 0.01);
  assertEq(p.verdicts.crushed, 1);
  assertEq(p.verdicts.on_plan, 1);
  assertEq(p.verdicts.hard, 1);
  assertEq(p.verdicts.behind, 0);
  assertEq(p.cumRows.length, 3);
  assertClose(p.cumRows[2].cumNet, 11000, 0.01);
  assertEq(p.best.ym, '2026-02');
  assertEq(p.worst.ym, '2026-03');
});

// ── Trener ──────────────────────────────────────────────────────────────

test('coach: deterministyczny wybór + cel na kolejny miesiąc', () => {
  const ctx = { verdict: 'on_plan', onTrack: true, streak: 1, month: '2026-06', nextMonth: '2026-07', nextPlan: 3000 };
  const a = coachMessage(ctx);
  assertEq(a, coachMessage(ctx), 'deterministyczny');
  assertTrue(a.includes('Cel na lipiec 2026: 3 000 zł.'), 'kończy się celem: ' + a);
});

test('coach: kamień milowy przy serii 3 i fraza budżetowa przy planie ≤ 0', () => {
  const m = coachMessage({ verdict: 'crushed', onTrack: false, streak: 3, month: '2026-06', nextMonth: '2026-07', nextPlan: -1500 });
  assertTrue(m.includes('3 dobre miesiące'), 'kamień milowy');
  assertTrue(m.includes('niedobór'), 'fraza budowy przy ujemnym planie');
});

test('coach: pierwszy wpis ma własny wariant', () => {
  const m = coachMessage({ verdict: 'on_plan', onTrack: true, streak: 1, month: '2026-06', nextMonth: '2026-07', nextPlan: 100, isFirst: true });
  assertTrue(m.includes('Pierwszy wpis') || m.includes('Start!'), m);
});

// ── F24: cel „do zera" (die with zero) ──────────────────────────────────

test('F24a: dieWithZeroTargetAt — forma zamknięta (stała realna wypłata, q=1)', () => {
  const f = FIX.F24;
  const t = E.dieWithZeroTargetAt(baseState(), f.startYm, f.deathAge);
  assertEq(t.yearsN, f.N);
  assertClose(t.target, f.target, f.eps);
  assertClose(t.withdrawalYear1, 72000, 1e-9);
  // g nie zmienia celu w tym samym miesiącu (kotwica: W₁ bez wzrostu) —
  // wydatki po FIRE są stałe realnie, jak w celu klasycznym.
  const g1 = E.dieWithZeroTargetAt(baseState({ assumptions: { expenseGrowthReal: 0.01 } }), f.startYm, f.deathAge);
  assertClose(g1.target, f.target, f.eps, 'g działa tylko do FIRE, nie w wypłatach');
  assertTrue(g1.target < f.classic, 'cel „do zera" < klasyczny 1,8 mln');
  // q=1 (r=0): cel = N·W₁ = dokładnie 720 000 dla N=10. Faza wypłat = zwrot po FIRE.
  const r0 = E.dieWithZeroTargetAt(baseState({ assumptions: { realReturnAnnual: 0, postRetirementReturnReal: 0 } }), f.startYm, f.r0.deathAge);
  assertEq(r0.yearsN, f.r0.N);
  assertClose(r0.target, f.r0.target, 1e-6, 'q=1 → arytmetyka całkowita');
});

test('F24b: projectDieWithZero — tożsamość replay, tabela do 0', () => {
  const f = FIX.F24;
  // FIRE poza horyzontem → startYm = dziś (2026-07), N = 84.
  const st = baseState({ assumptions: { monthlyIncome: 6100 } });
  E.recomputeDerived(st, NOW);
  const z = E.projectDieWithZero(st, { deathAge: f.deathAge, projection: st.derived.projection, now: NOW });
  assertEq(z.hypothetical, true);
  assertEq(z.startYm, f.startYm);
  assertEq(z.rows.length, f.N);
  assertClose(z.rows[0].startReal, f.target, f.eps, 'tabela startuje od dokładnie celu');
  assertClose(z.rows[0].endReal, f.year1EndReal, f.eps);
  assertClose(z.rows[1].endReal, f.year2EndReal, f.eps);
  assertClose(z.rows[z.rows.length - 1].endReal, 0, 1e-9, 'ostatni rok kończy na 0 zł');
  for (const r of z.rows) {
    const expected = (r.startReal - r.withdrawalReal) * (1 + z.realRate);
    if (r.endReal !== 0) assertClose(r.endReal, expected, 1e-9, `tożsamość rekurencji rok ${r.year}`);
    assertClose(r.endNominal / Math.pow(1 + z.inflation, r.year), r.endReal, 1e-6, `tożsamość nominal/real rok ${r.year}`);
  }
});

test('F24c: wypłaty stałe realnie (g działa tylko do daty FIRE)', () => {
  const st = baseState({ assumptions: { monthlyIncome: 6100, expenseGrowthReal: 0.01 } });
  E.recomputeDerived(st, NOW);
  const z = E.projectDieWithZero(st, { deathAge: 110, projection: st.derived.projection, now: NOW });
  for (const r of z.rows) {
    assertClose(r.withdrawalReal, z.withdrawalYear1, 1e-9, `wypłata stała realnie, rok ${r.year}`);
  }
});

test('F24d: monotonia wieku + porównanie z celem klasycznym', () => {
  const f = FIX.F24;
  const st = baseState();
  const t110 = E.dieWithZeroTargetAt(st, f.startYm, 110).target;
  const t80 = E.dieWithZeroTargetAt(st, f.startYm, 80).target;
  assertClose(t80, f.target54, f.eps);
  assertTrue(t110 > t80, 'dłuższe życie → wyższy cel');
  assertTrue(t110 < f.classic, 'g=0: cel „do zera" < klasyczny 1,8 mln');
});

test('F24e: skan FIRE „do zera" ≤ klasyczny; brak oszczędności → hypothetical', () => {
  const st = baseState({ assumptions: { portfolioStart: 10000, cashStart: 6000 } });
  E.recomputeDerived(st, NOW);
  const z = E.projectDieWithZero(st, { deathAge: 110, projection: st.derived.projection, now: NOW });
  assertEq(z.hypothetical, false);
  assertTrue(E.ymToIdx(z.startYm) <= E.ymToIdx(z.classicFireYm), 'FIRE „do zera" nie później niż klasyczny (g=0)');
  // income = expenses → brak nadwyżki → FIRE poza horyzontem.
  const hyp = baseState({ assumptions: { monthlyIncome: 6000 } });
  E.recomputeDerived(hyp, NOW);
  const zh = E.projectDieWithZero(hyp, { deathAge: 110, projection: hyp.derived.projection, now: NOW });
  assertEq(zh.hypothetical, true);
  assertEq(zh.startYm, E.todayYm(NOW));
});

test('F24g: cel klasyczny porównywany w tym samym miesiącu co cel „do zera"', () => {
  // g=1%: oba cele rosną z wydatkami — porównanie musi być z tej samej daty.
  const st = baseState({ assumptions: { portfolioStart: 10000, cashStart: 6000, expenseGrowthReal: 0.01 } });
  E.recomputeDerived(st, NOW);
  const z = E.projectDieWithZero(st, { deathAge: 80, projection: st.derived.projection, now: NOW });
  assertEq(z.hypothetical, false);
  assertClose(z.targetClassic, E.fireTargetAt(st, z.startYm), 1e-9, 'klasyczny liczony w startYm');
  assertTrue(z.targetClassic > E.fireTargetAt(st, E.todayYm(NOW)), 'w startYm wydatki już urosły (g>0)');
  assertTrue(z.target < z.targetClassic, 'skończone wypłaty < wieczna renta 4% (ten sam miesiąc)');
  // Ta sama tożsamość w scenariuszu hipotetycznym (startYm = dziś).
  const hyp = baseState({ assumptions: { monthlyIncome: 6000, expenseGrowthReal: 0.01 } });
  E.recomputeDerived(hyp, NOW);
  const zh = E.projectDieWithZero(hyp, { deathAge: 80, projection: hyp.derived.projection, now: NOW });
  assertClose(zh.targetClassic, E.fireTargetAt(hyp, zh.startYm), 1e-9);
  assertTrue(zh.target < zh.targetClassic, 'hipotetycznie również < klasyczny');
});

test('F24h: dom w planie — FIRE „do zera" nie przed wydatkiem na dom i startem kredytu', () => {
  const st = baseState({
    assumptions: { portfolioStart: 1500000, cashStart: 0 },
    housing: {
      currentRentMonthly: 0,
      housePlan: housePlan({
        moveInMonth: '2027-01',
        houseSpend: { month: '2027-01', amount: 800000 },
        mortgage: { startMonth: '2027-01', principal: 600000, rateNominal: 0.07, termYears: 20 },
      }),
    },
  });
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  const z = E.projectDieWithZero(st, { deathAge: 110, projection: proj, now: NOW });
  // Portfel (1,5 mln) już dziś przekracza cel „do zera" (~1,49 mln), ale dom
  // (800 tys.) i kredyt (600 tys.) dopiero przed nami — salda 0 znaczą
  // „jeszcze nie zaczęte", nie „spłacone". Data „do zera" nie może wypaść
  // przed wydatkiem na dom / startem kredytu ani przed jego spłatą.
  assertEq(z.hypothetical, false, 'data „do zera" w horyzoncie');
  assertTrue(E.ymToIdx(z.fireYm) >= E.ymToIdx('2027-01'), 'nie przed wydatkiem na dom/startem kredytu');
  assertTrue(E.ymToIdx(z.fireYm) >= E.ymToIdx(proj.debtFreeYm), 'nie przed spłatą kredytu');
  assertTrue(proj.reached && E.ymToIdx(z.fireYm) <= E.ymToIdx(proj.fireYm), 'nie później niż klasyczny (g=0)');
});

test('F24f: strażnicy (brak daty urodzenia, wiek ≤ obecny) + czystość', () => {
  const nb = baseState();
  nb.profile.birthDate = null;
  assertEq(E.projectDieWithZero(nb, { deathAge: 110, now: NOW }), null, 'brak birthDate → null');
  assertEq(E.dieWithZeroTargetAt(nb, '2026-07', 110), null);
  // Wiek ≤ obecny → marker z pustą tabelą (nie null), by UI pokazał field-error.
  const st = baseState();
  E.recomputeDerived(st, NOW);
  const z = E.projectDieWithZero(st, { deathAge: 20, projection: st.derived.projection, now: NOW });
  assertTrue(z != null && z.rows.length === 0, 'marker bez wierszy');
  assertTrue(z.yearsN < 1, 'N < 1');
  // Czystość: stan nie mutowany (wzorzec F15a).
  const before = JSON.stringify(st);
  E.projectDieWithZero(st, { deathAge: 90, projection: st.derived.projection, now: NOW });
  assertEq(JSON.stringify(st), before);
});

// ── F25: wpływ jednorazowej decyzji + komunikaty motywacyjne ─────────────

test('F25a: oneOffImpact — yearsToFire i factor', () => {
  const f = FIX.F25;
  const imp = E.oneOffImpact(baseState(), f.amount, NOW);
  assertClose(imp.yearsToFire, f.yearsToFire, 1e-9, 'yearsToFire');
  assertClose(imp.factor, f.factor, f.eps, 'factor');
});

test('F25b: oneOffImpact — wartość przyszła realna', () => {
  const f = FIX.F25;
  const imp = E.oneOffImpact(baseState(), f.amount, NOW);
  assertClose(imp.futureValueReal, f.futureValueReal, f.eps, 'futureValueReal');
});

test('F25c: oneOffImpact — wydatek w dniu FIRE i dni emerytury (+ wariant z g)', () => {
  const f = FIX.F25;
  const imp = E.oneOffImpact(baseState(), f.amount, NOW);
  assertClose(imp.monthlySpendAtFire, f.monthlySpendAtFire, f.eps, 'monthlySpendAtFire');
  assertClose(imp.retirementDays, f.retirementDays, f.eps, 'retirementDays');
  const grown = E.oneOffImpact(baseState({ assumptions: { expenseGrowthReal: 0.01 } }), f.amount, NOW);
  assertClose(grown.monthlySpendAtFire, f.grown.monthlySpendAtFire, f.eps, 'monthlySpendAtFire (g=1%)');
});

test('F25d: wiek FIRE ≤ obecny → factor 1, fv = kwota', () => {
  const st = baseState({ assumptions: { targetFireAge: 20 } }); // < 26
  const imp = E.oneOffImpact(st, 100, NOW);
  assertEq(imp.yearsToFire, 0);
  assertClose(imp.factor, 1, 1e-12, 'factor=1');
  assertClose(imp.futureValueReal, 100, 1e-9, 'fv=kwota');
});

test('F25e: profil niekompletny → null', () => {
  const nb = baseState();
  nb.profile.birthDate = '';
  assertEq(E.oneOffImpact(nb, 100, NOW), null, 'brak birthDate → null');
  const na = baseState({ assumptions: { targetFireAge: 0 } });
  assertEq(E.oneOffImpact(na, 100, NOW), null, 'targetFireAge 0 → null');
});

test('F25f: kwota 0 → fv 0, brak NaN', () => {
  const imp = E.oneOffImpact(baseState(), 0, NOW);
  assertEq(imp.futureValueReal, 0);
  assertTrue(!Number.isNaN(imp.retirementDays), 'retirementDays nie NaN');
});

test('F25k: oneOffImpact — ułamkowy wiek FIRE zaokrąglany do pełnych miesięcy', () => {
  // 45,1 roku = 541,2 mies. → zaokrąglone 541: 2000-01 + 541 mies. = 2045-02.
  // Bez zaokrąglenia idxToYm dostawał ułamkowy indeks i zdeformowany "YYYY-M.M".
  const st = baseState({ assumptions: { targetFireAge: 45.1, expenseGrowthReal: 0.01 } });
  const imp = E.oneOffImpact(st, 100, NOW);
  assertClose(imp.yearsToFire, (541 - 318) / 12, 1e-9, 'yearsToFire z zaokrąglonych miesięcy');
  assertClose(imp.monthlySpendAtFire,
    E.fireTargetAt(st, '2045-02') * st.assumptions.withdrawalRate / 12, 1e-9,
    'wydatek w dniu FIRE liczony w poprawnym miesiącu');
});

test('F25g: oneOffImpact — czystość stanu (wzorzec F15a)', () => {
  const st = baseState();
  const before = JSON.stringify(st);
  E.oneOffImpact(st, 250, NOW);
  assertEq(JSON.stringify(st), before);
});

test('F25h: checkinCelebration — 10 unikalnych, niepustych na werdykt', () => {
  for (const v of ['crushed', 'on_plan', 'behind', 'hard']) {
    const set = new Set();
    for (let s = 0; s < 10; s++) {
      const msg = checkinCelebration(v, s);
      assertTrue(typeof msg === 'string' && msg.length > 0, `${v} seed ${s} niepusty`);
      set.add(msg);
    }
    assertEq(set.size, 10, `${v}: 10 unikalnych`);
  }
});

test('F25i: checkinCelebration — modulo, ujemny seed, fallback', () => {
  assertEq(checkinCelebration('on_plan', 12), checkinCelebration('on_plan', 2), 'modulo 10');
  assertTrue(typeof checkinCelebration('on_plan', -3) === 'string', 'ujemny seed bezpieczny');
  assertEq(checkinCelebration('nieznany', 0), checkinCelebration('on_plan', 0), 'fallback on_plan');
});

test('F25j: decisionMessage — 5 unikalnych na rodzaj + fallback', () => {
  for (const k of ['avoided', 'invest', 'impulse']) {
    const set = new Set();
    for (let s = 0; s < 5; s++) {
      const msg = decisionMessage(k, s);
      assertTrue(typeof msg === 'string' && msg.length > 0, `${k} seed ${s} niepusty`);
      set.add(msg);
    }
    assertEq(set.size, 5, `${k}: 5 unikalnych`);
  }
  assertEq(decisionMessage('nieznany', 0), decisionMessage('avoided', 0), 'fallback avoided');
});

// ── F26: „Ile zostało do spłaty" + suwak nadpłaty ───────────────────────

test('F26a: yearlyRemainingToPay — tożsamości kontraktu (kredyt F3)', () => {
  const mtg = { principal: 1100000, rateNominal: 0.07, termYears: 15, startMonth: '2026-01', paymentOverrideMonthly: null };
  const rows = E.amortizationSchedule(mtg);
  const years = E.yearlyRemainingToPay(rows, mtg.principal);
  assertEq(years.length, 15, '15 lat kredytu');
  assertClose(years[0].principal, 1100000, 1e-6, 'rok 1: kapitał = principal');
  assertClose(years[0].interest, FIX.F17.contractInterest, FIX.F17.eps, 'rok 1: odsetki = Σ odsetek kontraktu');
  const A = E.mortgagePayment(mtg);
  years.forEach((yk, i) => {
    assertClose(yk.principal + yk.interest, A * (180 - 12 * i), 0.05, `rok ${i + 1}: p+i = A × pozostałe raty`);
  });
  for (let i = 1; i < years.length; i++) {
    assertTrue(years[i].principal + years[i].interest < years[i - 1].principal + years[i - 1].interest,
      `rok ${i + 1}: suma ściśle maleje`);
  }
  // Kapitał roku 3 z formy zamkniętej: saldo po 24 ratach.
  const j = E.monthlyRate(mtg.rateNominal);
  const p3 = mtg.principal * Math.pow(1 + j, 24) - A * (Math.pow(1 + j, 24) - 1) / j;
  assertClose(years[2].principal, p3, 0.01, 'rok 3: kapitał z formy zamkniętej');
});

test('F26b: loanPathWithProjection — czystość, szew historia→prognoza, zero w debtFreeYm', () => {
  const st = f17State();
  st.entries.push(entry(FIX.F26.overpayMonth, 60000, 6000, { overpayment: FIX.F26.overpayment }));
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const ma = E.mortgageAnalytics(st, d.debt, d.projection);
  const before = JSON.stringify(st);
  const path = E.loanPathWithProjection(st, d.debt, d.projection, 'debtReal', ma.rateMonthly);
  assertEq(JSON.stringify(st), before, 'czystość stanu');
  assertEq(path[0].ym, '2026-01', 'start = start kredytu');
  for (let i = 1; i < path.length; i++) {
    assertEq(path[i].ym, E.addMonths(path[i - 1].ym, 1), 'miesiące ciągłe (bez dziury na szwie)');
  }
  const histLen = d.debt.rows.length;
  assertClose(path[histLen].interest, d.debt.balanceNominal * ma.rateMonthly, 0.01,
    'pierwszy prognozowany miesiąc: odsetki = saldo końca historii × j');
  const last = path[path.length - 1];
  assertEq(last.balNominal, 0, 'ścieżka kończy się na saldzie 0');
  assertEq(last.ym, d.projection.debtFreeYm, 'zero dokładnie w debtFreeYm');
});

test('F26c: rodzinny bez nadpłat ≡ kontrakt (0%, liczby całkowite)', () => {
  const st = f20State();
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const fa = E.familyLoanAnalytics(st, d.family, d.projection);
  const path = E.loanPathWithProjection(st, d.family, d.projection, 'familyReal', fa.rateMonthly);
  const contract = E.amortizationScheduleN(24000, 0, 12);
  assertEq(path.length, contract.length, 'długość = kontrakt (12 mies.)');
  path.forEach((p, i) => {
    assertClose(p.balNominal, contract[i].balNominal, 1e-9, `mies. ${i + 1}: saldo`);
    assertClose(p.interest, contract[i].interest, 1e-9, `mies. ${i + 1}: odsetki`);
  });
  const years = E.yearlyRemainingToPay(path, 24000);
  assertEq(years.length, 1);
  assertClose(years[0].principal, 24000, 1e-9);
  assertClose(years[0].interest, 0, 1e-9);
});

test('F26d: nadpłaty — spłata wcześniej niż kontrakt (miesiące), rocznie a ≤ c', () => {
  const st = f17State();
  st.entries.push(entry(FIX.F26.overpayMonth, 60000, 6000, { overpayment: FIX.F26.overpayment }));
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const ma = E.mortgageAnalytics(st, d.debt, d.projection);
  const contract = E.amortizationSchedule(st.housing.housePlan.mortgage);
  const path = E.loanPathWithProjection(st, d.debt, d.projection, 'debtReal', ma.rateMonthly);
  const payoffYm = path[path.length - 1].ym;
  assertTrue(E.ymToIdx(payoffYm) < E.ymToIdx(ma.contractPayoffYm), 'spłata przed kontraktem (indeks miesiąca)');
  const rows = E.remainingToPayComparison(1100000, contract, path);
  rows.forEach(r => {
    assertTrue(r.aPrincipal + r.aInterest <= r.cPrincipal + r.cInterest + 1, `rok ${r.year}: z nadpłatami ≤ kontrakt`);
  });
});

test('F26e: zamrożone saldo (korekta w górę po oknie) — ścieżka się kończy, bez fantomowych odsetek', () => {
  const st = f20State({ rateNominal: FIX.F26.famRate });
  st.debt.familyOverrides = [FIX.F26.frozenOverride];
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  assertTrue(d.projection.familyFreeYm == null, 'dług rodzinny nigdy nie spłacony w prognozie');
  const fa = E.familyLoanAnalytics(st, d.family, d.projection);
  const path = E.loanPathWithProjection(st, d.family, d.projection, 'familyReal', fa.rateMonthly);
  assertEq(path[path.length - 1].ym, '2026-12', 'ścieżka urwana na końcu okna spłaty');
  assertEq(path.length, 12, '12 wierszy, nie 720');
  assertTrue(path[path.length - 1].balNominal > 0, 'saldo zamrożone > 0');
});

test('F26f: korekta w górę → ścieżka dłuższa niż kontrakt, kontrakt dopełniony zerami', () => {
  const st = f20State();
  st.debt.overrides = [FIX.F26.upOverride];
  E.recomputeDerived(st, NOW);
  const d = st.derived;
  const ma = E.mortgageAnalytics(st, d.debt, d.projection);
  const contract = E.amortizationSchedule(st.housing.housePlan.mortgage);
  const path = E.loanPathWithProjection(st, d.debt, d.projection, 'debtReal', ma.rateMonthly);
  assertTrue(path.length > contract.length, 'ścieżka faktyczna dłuższa niż kontrakt');
  const rows = E.remainingToPayComparison(12000, contract, path);
  assertEq(rows.length, Math.ceil(path.length / 12), 'liczba lat = dłuższa strona');
  const lastYear = rows[rows.length - 1];
  assertEq(lastYear.cPrincipal, 0, 'kontrakt dopełniony zerem (kapitał)');
  assertEq(lastYear.cInterest, 0, 'kontrakt dopełniony zerem (odsetki)');
  assertTrue(lastYear.aPrincipal > 0, 'strona faktyczna wciąż niesie saldo');
});

test('F26g: remainingSchedule — extra 0 ≡ wywołanie 3-argumentowe', () => {
  const j = E.monthlyRate(0.07);
  const A = E.annuityPayment(1100000, j, 180, null);
  const a = E.remainingSchedule(1100000, j, A);
  const b = E.remainingSchedule(1100000, j, A, 0);
  assertEq(JSON.stringify(b), JSON.stringify(a), 'identyczny wynik');
});

test('F26h: stała nadpłata — mniej miesięcy i odsetek, monotonicznie w X', () => {
  const j = E.monthlyRate(0.07);
  const A = E.annuityPayment(1100000, j, 180, null);
  let prev = E.remainingSchedule(1100000, j, A);
  for (const X of [500, 1000, 2000, 5000]) {
    const cur = E.remainingSchedule(1100000, j, A, X);
    assertTrue(cur.months < prev.months, `X=${X}: ściśle mniej miesięcy`);
    assertTrue(cur.totalInterest < prev.totalInterest, `X=${X}: ściśle mniej odsetek`);
    prev = cur;
  }
});

test('F26i: 0% — rachunek całkowity; ogromna nadpłata → 1 miesiąc', () => {
  const f = FIX.F26.simple;
  const r = E.remainingSchedule(f.bal, 0, f.payment, f.extra);
  assertEq(r.months, f.months, '12 000 przy 2 000/mies. → 6 mies.');
  assertClose(r.totalInterest, 0, 1e-9, 'zero odsetek przy 0%');
  const one = E.remainingSchedule(f.bal, 0, f.payment, 1e9);
  assertEq(one.months, 1, 'nadpłata ponad saldo → spłata w 1 miesiąc');
});

// ── F27/F28: obligacje po FIRE (postRetirementReturnReal) ────────────────

test('F27a: retirementOpts — domyślna, override, fallback, czystość', () => {
  const st = E.createState();
  assertEq(E.retirementOpts(st).postReturnReal, 0.02, 'nowy stan → domyślna marża EDO 2%');
  assertEq(E.retirementOpts(st, { postReturnReal: 0.045 }).postReturnReal, 0.045, 'override wygrywa');
  assertEq(E.retirementOpts(st).crash, null, 'crash domyślnie null (F39)');
  assertEq(E.retirementOpts(st, { crash: { year: 1, pct: 0.3 } }).crash.year, 1, 'override crash wygrywa');
  // Brak założenia w stanie → fallback 0.02.
  const noField = E.createState();
  delete noField.assumptions.postRetirementReturnReal;
  assertEq(E.retirementOpts(noField).postReturnReal, 0.02, 'brak pola → 0.02');
  // Czystość: stan nie mutowany.
  const before = JSON.stringify(st);
  E.retirementOpts(st, { postReturnReal: 0.03 });
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
});

test('F27b: projectWithdrawal — szew niesie zwrot po FIRE, liczby F13 zachowane', () => {
  const f = FIX.F13;
  const st = baseState(); // postRetirementReturnReal 0.05 == realReturnAnnual
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: f.startReal });
  assertEq(w.ro.postReturnReal, 0.05, 'ro niesie zwrot po FIRE z założeń');
  assertClose(w.nominalRate, f.nominalRate, 1e-9, 'nominalRate F13 zachowany przez szew');
  assertClose(w.rows[0].endReal, f.year1.endReal, f.eps, 'liczby F13 bez zmian');
});

test('F27c: przełącznik na obligacje wyczerpuje portfel 4% (kontrola formy zamkniętej)', () => {
  const f = FIX.F27.depleted;
  const st = baseState({ assumptions: { postRetirementReturnReal: f.rPost } });
  const w = E.projectWithdrawal(st, {
    startYm: '2026-07', startPortfolioReal: f.start,
    withdrawalRealYearly: f.wYear, years: 40,
  });
  assertEq(w.depletedYear, f.year, 'depleted w roku z fixtury');
  // Kontrola: najmniejsze N z W₁·(1−q^N)/(1−q) > P₀, q = 1/(1+rPost).
  const q = 1 / (1 + f.rPost);
  let N = 1;
  while (!(f.wYear * (1 - Math.pow(q, N)) / (1 - q) > f.start)) N++;
  assertEq(w.depletedYear, N, 'zgodność z formą zamkniętą renty');
});

test('F27f: createState().version == SCHEMA_VERSION (strażnik synchronizacji modułów)', () => {
  assertEq(E.createState().version, S.SCHEMA_VERSION, 'engine (L0) i storage zsynchronizowane');
});

test('F28a: dieWithZeroTargetAt — parytet legacy z jawnym ro 0.05', () => {
  const f = FIX.F24;
  const ro = { postReturnReal: 0.05 };
  const t = E.dieWithZeroTargetAt(baseState(), f.startYm, f.deathAge, ro);
  assertClose(t.target, f.target, f.eps, 'cel „do zera" F24 odtworzony');
  const r0 = E.dieWithZeroTargetAt(baseState(), f.startYm, f.r0.deathAge, { postReturnReal: 0 });
  assertClose(r0.target, f.r0.target, 1e-6, 'q=1 (r=0) → 720 000');
});

test('F28d: czułość — niższy zwrot po FIRE podnosi cel „do zera"; ścieżka what-if działa', () => {
  const f = FIX.F24;
  const st = baseState();
  const tLow = E.dieWithZeroTargetAt(st, f.startYm, f.deathAge, { postReturnReal: 0.02 }).target;
  const tHigh = E.dieWithZeroTargetAt(st, f.startYm, f.deathAge, { postReturnReal: 0.05 }).target;
  assertTrue(tLow > tHigh, 'niższy zwrot → wyższy cel „do zera"');
  // What-if end-to-end przez projectDieWithZero. Zerowe oszczędności (dochód =
  // wydatki) → portfel nie dogoni celu → hypothetical, startYm = dziś dla obu
  // przebiegów, więc porównanie celów jest czyste (bez przesunięcia miesiąca skanu).
  const base = baseState({ assumptions: { monthlyIncome: 6000 } });
  E.recomputeDerived(base, NOW);
  const proj = base.derived.projection;
  const zLow = E.projectDieWithZero(base, { deathAge: 90, projection: proj, now: NOW, ro: { postReturnReal: 0.02 } });
  const zHigh = E.projectDieWithZero(base, { deathAge: 90, projection: proj, now: NOW, ro: { postReturnReal: 0.05 } });
  assertTrue(zLow.hypothetical && zLow.startYm === zHigh.startYm, 'oba hipotetyczne, ten sam startYm');
  assertEq(zLow.realRate, 0.02, 'realRate niesie zwrot po FIRE z what-if');
  assertTrue(zLow.target > zHigh.target, 'niższy zwrot → wyższy cel (ścieżka what-if)');
});

// ── F27g/F28b/e/f: mrożenie wzrostu wydatków po FIRE (freezeExpenses) ─────

test('F27g: retirementOpts — pole freezeExpenses (domyślna, założenie, override, czystość)', () => {
  const st = E.createState(); // defaultAssumptions → freezeExpensesAtRetirement true
  assertEq(E.retirementOpts(st).freezeExpenses, true, 'nowy stan → mrożenie true');
  const off = E.createState({ assumptions: { freezeExpensesAtRetirement: false } });
  assertEq(E.retirementOpts(off).freezeExpenses, false, 'założenie false → false');
  // Override wygrywa nad założeniem w obie strony.
  assertEq(E.retirementOpts(st, { freezeExpenses: false }).freezeExpenses, false, 'override false > założenie true');
  assertEq(E.retirementOpts(off, { freezeExpenses: true }).freezeExpenses, true, 'override true > założenie false');
  // Brak założenia → fallback true.
  const noField = E.createState();
  delete noField.assumptions.freezeExpensesAtRetirement;
  assertEq(E.retirementOpts(noField).freezeExpenses, true, 'brak pola → true');
  // Czystość: stan nie mutowany.
  const before = JSON.stringify(st);
  E.retirementOpts(st, { freezeExpenses: false });
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
});

test('F27d: projectWithdrawal — wypłaty rosną o G przy wyłączonym mrożeniu, płaskie przy włączonym', () => {
  const g = FIX.F28.growth.g; // 0.01
  const st = baseState({ assumptions: { expenseGrowthReal: g } });
  const common = { startYm: '2026-07', startPortfolioReal: 5000000, withdrawalRealYearly: 72000, years: 12 };
  const wOff = E.projectWithdrawal(st, { ...common, ro: E.retirementOpts(st, { freezeExpenses: false }) });
  assertClose(wOff.withdrawalGrowthReal, g, 1e-12, 'off → wzrost wypłat = G−1');
  for (const n of [1, 2, 10]) {
    const row = wOff.rows[n - 1];
    assertClose(row.withdrawalReal, 72000 * Math.pow(1 + g, n - 1), 1e-6, `wypłata realna rok ${n}`);
    assertClose(row.withdrawalNominal, row.withdrawalReal * Math.pow(1 + wOff.inflation, n - 1), 1e-6, `wypłata nominalna rok ${n}`);
  }
  const wOn = E.projectWithdrawal(st, { ...common, ro: E.retirementOpts(st, { freezeExpenses: true }) });
  assertEq(wOn.withdrawalGrowthReal, 0, 'on → wzrost 0');
  for (const n of [1, 2, 10]) assertClose(wOn.rows[n - 1].withdrawalReal, 72000, 1e-9, `płaska wypłata rok ${n}`);
  // Monotonia: rosnące wypłaty nie wydłużają portfela (oba się wyczerpują).
  const dep = { startYm: '2026-07', startPortfolioReal: 1000000, withdrawalRealYearly: 72000, years: 60 };
  const depOff = E.projectWithdrawal(st, { ...dep, ro: E.retirementOpts(st, { freezeExpenses: false, postReturnReal: 0.02 }) });
  const depOn = E.projectWithdrawal(st, { ...dep, ro: E.retirementOpts(st, { freezeExpenses: true, postReturnReal: 0.02 }) });
  assertTrue(depOff.depletedYear != null && depOn.depletedYear != null, 'oba się wyczerpują');
  assertTrue(depOff.depletedYear <= depOn.depletedYear, 'wzrost wypłat nie wydłuża portfela');
});

test('F28b: dieWithZeroTargetAt — wariant z rosnącymi wydatkami (x = G/(1+r))', () => {
  const g = FIX.F28.growth.g; // 0.01
  const st = baseState({ assumptions: { expenseGrowthReal: g } });
  const ym = '2026-07', deathAge = 110;
  const tOff = E.dieWithZeroTargetAt(st, ym, deathAge, E.retirementOpts(st, { freezeExpenses: false, postReturnReal: 0.05 }));
  const tOn = E.dieWithZeroTargetAt(st, ym, deathAge, E.retirementOpts(st, { freezeExpenses: true, postReturnReal: 0.05 }));
  const x = (1 + g) / 1.05;
  const expect = tOff.withdrawalYear1 * (1 - Math.pow(x, tOff.yearsN)) / (1 - x);
  assertClose(tOff.target, expect, 1e-6, 'cel wg formy zamkniętej x = G/(1+r)');
  assertTrue(tOff.target > tOn.target, 'rosnące wydatki → cel wyższy niż przy stałych');
});

test('F28e: dieWithZeroTargetAt — krawędź x = 1 (wzrost = zwrot → cel = N·W₁)', () => {
  const st = baseState({ assumptions: { expenseGrowthReal: 0.01, postRetirementReturnReal: 0.01 } });
  const t = E.dieWithZeroTargetAt(st, '2026-07', 110, E.retirementOpts(st, { freezeExpenses: false }));
  assertClose(t.target, t.yearsN * t.withdrawalYear1, 1e-9, 'wzrost kasuje zwrot → cel = N·W₁');
});

test('F28f: projectDieWithZero — end-to-end z wyłączonym mrożeniem', () => {
  const g = FIX.F28.growth.g; // 0.01
  const st = baseState({ assumptions: { monthlyIncome: 6000, expenseGrowthReal: g } });
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  const zOff = E.projectDieWithZero(st, { deathAge: 90, projection: proj, now: NOW, ro: E.retirementOpts(st, { freezeExpenses: false }) });
  const zOn = E.projectDieWithZero(st, { deathAge: 90, projection: proj, now: NOW, ro: E.retirementOpts(st, { freezeExpenses: true }) });
  assertClose(zOff.withdrawalGrowthReal, g, 1e-12, 'wynik niesie wzrost wypłat');
  for (const n of [1, 2, 10]) {
    assertClose(zOff.rows[n - 1].withdrawalReal, zOff.withdrawalYear1 * Math.pow(1 + g, n - 1), 1e-6, `wypłata rok ${n}`);
  }
  // Tabela zawsze od dokładnie celu → ostatni rok kończy się na 0.
  assertEq(zOff.rows[zOff.rows.length - 1].endReal, 0, 'dokładnie 0 w roku N');
  assertTrue(zOff.target > zOn.target, 'rosnące wydatki → wyższy cel „do zera"');
  // Wyższy cel ⇒ data „do zera" nie wcześniejsza (null = nieosiągnięte = +∞).
  const idxOrInf = ym => ym == null ? Infinity : E.ymToIdx(ym);
  assertTrue(idxOrInf(zOff.fireYm) >= idxOrInf(zOn.fireYm), 'wyższy cel → data „do zera" nie wcześniejsza');
  assertEq(zOff.hypothetical, zOn.hypothetical, 'flaga hypothetical strukturalnie bez zmian');
});

// ── F27e/F27h/F28c + F46/F47: most ZUS (pensionMonthly/pensionAge) ────────
// Emerytura państwowa jako offset fazy wypłat (D7: podłoga zera) i dwufazowy
// cel FIRE (most → terminal). Formy zamknięte liczone w testach SĄ specyfikacją
// (wzorzec F26/F27); silnik liczy pętlą wsteczną pvOfRetirement — parytet to
// test. Litery wg rezerwacji planu obligacji (F27e/F28c) + F46/F47 (w planie
// ZUS „F29/F30" — zajęte przez charts.js i Belkę).

test('F27h: retirementOpts — pole pension (domyślna, założenia, override, null, czystość)', () => {
  const st = E.createState();
  assertEq(st.assumptions.pensionMonthly, 1978.49, 'placeholder: emerytura minimalna od marca 2026');
  assertEq(JSON.stringify(E.retirementOpts(st).pension),
    JSON.stringify({ monthly: 1978.49, fromAge: 65 }), 'nowy stan → placeholder D6');
  // Założenia wygrywają nad domyślną.
  const own = E.createState({ assumptions: { pensionMonthly: 3200, pensionAge: 60 } });
  assertEq(E.retirementOpts(own).pension.monthly, 3200, 'kwota z założeń');
  assertEq(E.retirementOpts(own).pension.fromAge, 60, 'wiek z założeń (60 K)');
  // Override-obiekt wygrywa nad założeniami; null = ZUS wyłączony w what-ifie.
  const o = E.retirementOpts(own, { pension: { monthly: 500, fromAge: 67 } });
  assertEq(o.pension.monthly, 500, 'override kwoty wygrywa');
  assertEq(o.pension.fromAge, 67, 'override wieku wygrywa');
  assertEq(E.retirementOpts(own, { pension: null }).pension, null, 'null → ZUS wyłączony');
  // Brak pól w założeniach → fallback { 0, 65 }.
  const noField = E.createState();
  delete noField.assumptions.pensionMonthly;
  delete noField.assumptions.pensionAge;
  assertEq(JSON.stringify(E.retirementOpts(noField).pension),
    JSON.stringify({ monthly: 0, fromAge: 65 }), 'brak pól → { 0, 65 }');
  // Czystość: stan nie mutowany.
  const before = JSON.stringify(st);
  E.retirementOpts(st, { pension: null });
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
});

test('F27e: projectWithdrawal — offset emerytury od wieku emerytalnego + podłoga zera', () => {
  const f = FIX.F46.pension; // 2 000 zł/mies. od 65
  const st = baseState({ assumptions: { pensionMonthly: f.monthly, pensionAge: f.fromAge } });
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45 });
  const crossing = w.rows.find(r => r.age >= f.fromAge); // wiersz przekroczenia z ageAt, nie z ręki
  assertTrue(!!crossing, 'horyzont 45 lat przecina wiek emerytalny');
  for (const r of w.rows) {
    if (r.age < f.fromAge) {
      assertEq(r.pensionReal, 0, `bez emerytury przed ${f.fromAge} (rok ${r.year})`);
      assertEq(r.netWithdrawalReal, r.withdrawalReal, 'netto = brutto przed emeryturą');
    } else {
      assertEq(r.pensionReal, 12 * f.monthly, `emerytura 24 000/rok od ${f.fromAge} (rok ${r.year})`);
      assertClose(r.netWithdrawalReal, Math.max(0, r.withdrawalReal - 12 * f.monthly), 1e-9, 'netto = brutto − ZUS');
    }
  }
  // withdrawalReal to dalej wydatki BRUTTO; rekurencja używa NETTO (jeden wiersz z ręki).
  assertClose(crossing.withdrawalReal, 72000, 1e-9, 'brutto bez zmian po wieku emerytalnym');
  assertClose(crossing.endReal, (crossing.startReal - crossing.netWithdrawalReal) * 1.05, 1e-6, 'rekurencja na netto');
  assertClose(crossing.pensionNominal, crossing.pensionReal * Math.pow(1.03, crossing.year - 1), 1e-6, 'nominal: epoka startYm');
  // Podłoga zera (D7): emerytura > wydatki → nic nie schodzi z portfela, portfel rośnie.
  const rich = baseState({ assumptions: { pensionMonthly: 10000, pensionAge: f.fromAge } });
  const wRich = E.projectWithdrawal(rich, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45 });
  for (const r of wRich.rows.filter(r => r.age >= f.fromAge)) {
    assertEq(r.netWithdrawalReal, 0, `netto na podłodze 0 (rok ${r.year})`);
    assertTrue(r.endReal > r.startReal, `portfel rośnie, gdy ZUS pokrywa całość (rok ${r.year})`);
  }
  // Brak daty urodzenia → emerytura nieobliczalna, wiersze z pensionReal 0.
  const nb = baseState({ assumptions: { pensionMonthly: f.monthly, pensionAge: f.fromAge } });
  nb.profile.birthDate = null;
  const wNb = E.projectWithdrawal(nb, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45 });
  assertTrue(wNb.rows.every(r => r.pensionReal === 0), 'bez birthDate → pensionReal 0 wszędzie');
});

test('F28c: cel „do zera" z emeryturą — arytmetyka całkowita przy r = 0 i krawędzie', () => {
  // Przykład Planu A: N = 10, B = 4, W₁ = 72 000, ZUS 24 000/rok →
  // cel = 4·72000 + 6·(72000 − 24000) = 576 000. B z ageAt: wiek 26 w 2026-07,
  // wiek emerytalny 30 → emerytura płynie od 5. roku wypłat.
  const st = baseState({ assumptions: { postRetirementReturnReal: 0, pensionMonthly: 2000, pensionAge: 30 } });
  const t = E.dieWithZeroTargetAt(st, '2026-07', 36);
  assertEq(t.yearsN, 10);
  assertClose(t.target, 4 * 72000 + 6 * (72000 - 24000), 1e-6, 'B·W₁ + (N−B)·(W₁−ZUS) = 576 000');
  // Emerytura ≥ W₁ od wieku startowego → podłoga zera w każdym roku → cel 0.
  const full = baseState({ assumptions: { postRetirementReturnReal: 0, pensionMonthly: 6000, pensionAge: 26 } });
  assertEq(E.dieWithZeroTargetAt(full, '2026-07', 36).target, 0, 'ZUS pokrywa całość → cel 0 (podłoga)');
  // Wiek emerytalny za horyzontem dożycia → cel DOKŁADNIE jak bez emerytury.
  const late = baseState({ assumptions: { postRetirementReturnReal: 0, pensionMonthly: 2000, pensionAge: 40 } });
  const none = baseState({ assumptions: { postRetirementReturnReal: 0 } });
  assertEq(E.dieWithZeroTargetAt(late, '2026-07', 36).target,
    E.dieWithZeroTargetAt(none, '2026-07', 36).target, 'pensionAge > deathAge → bez wpływu');
});

test('F46a: bridgeTargetAt — bez emerytury cel ≡ fireTargetAt (B = 0)', () => {
  const st = baseState(); // pensionMonthly 0
  const bt = E.bridgeTargetAt(st, '2026-07');
  assertEq(bt.bridgeYears, 0, 'monthly 0 → most zerowy');
  assertClose(bt.target, E.fireTargetAt(st, '2026-07'), 1e-6, 'cel degeneruje się do klasycznego');
  assertEq(bt.pensionYearly, 0);
  // Druga droga wyłączenia: override pension: null.
  const on = baseState({ assumptions: { pensionMonthly: 2000 } });
  const btNull = E.bridgeTargetAt(on, '2026-07', E.retirementOpts(on, { pension: null }));
  assertEq(btNull.bridgeYears, 0);
  assertClose(btNull.target, E.fireTargetAt(on, '2026-07'), 1e-6, 'pension: null → cel klasyczny');
});

test('F46b: bridgeTargetAt — formy zamknięte (r = 0 całkowite; r = 5% vs Σ w·qⁿ⁻¹ + terminal·qᴮ)', () => {
  const f = FIX.F46.pension;
  // r = 0: cel = B·W₁ + (W₁ − pensY)/wr; B z ageAt (wiek 26 w 2026-07 → 39).
  const st0 = baseState({ assumptions: { postRetirementReturnReal: 0, pensionMonthly: f.monthly, pensionAge: f.fromAge } });
  const B = f.fromAge - E.ageAt(st0.profile.birthDate, '2026-07').years;
  const bt0 = E.bridgeTargetAt(st0, '2026-07');
  assertEq(bt0.bridgeYears, B);
  assertEq(bt0.pensionYearly, 12 * f.monthly);
  assertClose(bt0.terminalTarget, (72000 - 24000) / 0.04, 1e-6, 'terminal = resztówka / SWR');
  assertClose(bt0.target, B * 72000 + (72000 - 24000) / 0.04, 1e-6, 'r=0: most + terminal');
  // r = 5%: pętla ≡ forma zamknięta PV (g = 0, mrożenie on).
  const st5 = baseState({ assumptions: { pensionMonthly: f.monthly, pensionAge: f.fromAge } });
  const bt5 = E.bridgeTargetAt(st5, '2026-07');
  const q = 1 / 1.05;
  const expected = 72000 * (1 - Math.pow(q, B)) / (1 - q) + ((72000 - 24000) / 0.04) * Math.pow(q, B);
  assertClose(bt5.target, expected, 1e-6, 'r=5%: Σ w_n·qⁿ⁻¹ + terminal·qᴮ');
  assertClose(bt5.targetClassic, 1800000, 1e-9, 'echo celu klasycznego (ten sam miesiąc)');
  assertTrue(bt5.target < bt5.targetClassic, 'most ZUS obniża cel');
  assertClose(bt5.withdrawalYear1, 72000, 1e-9);
});

test('F46c: bridgeTargetAt — emerytura ≥ wydatki → terminal 0, cel = sam most', () => {
  const st = baseState({ assumptions: { postRetirementReturnReal: 0, pensionMonthly: 7000, pensionAge: 65 } });
  const B = 65 - E.ageAt(st.profile.birthDate, '2026-07').years;
  const bt = E.bridgeTargetAt(st, '2026-07');
  assertEq(bt.terminalTarget, 0, 'podłoga zera na terminalu (84 000 > 72 000)');
  assertClose(bt.target, B * 72000, 1e-6, 'cel = PV samego mostu (r = 0)');
});

test('F46d: bridgeTargetAt — wiek ≥ emerytalny → B = 0, cel = terminal', () => {
  const st = baseState({ assumptions: { pensionMonthly: 2000, pensionAge: 65 } });
  const ym = '2065-07'; // urodzony 2000-01 → wiek 65
  assertEq(E.ageAt(st.profile.birthDate, ym).years, 65, 'kontrola wieku');
  const bt = E.bridgeTargetAt(st, ym);
  assertEq(bt.bridgeYears, 0, 'most nie może być ujemny');
  assertEq(bt.target, bt.terminalTarget, 'PV nad 0 lat = terminal (dokładnie)');
});

test('F46g: bridgeTargetAt — strażnicy, czystość, mrożenie wydatków', () => {
  const nb = baseState({ assumptions: { pensionMonthly: 2000 } });
  nb.profile.birthDate = null;
  assertEq(E.bridgeTargetAt(nb, '2026-07'), null, 'brak birthDate → null');
  const st = baseState({ assumptions: { pensionMonthly: 2000, expenseGrowthReal: 0.01 } });
  const before = JSON.stringify(st);
  const tOn = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { freezeExpenses: true })).target;
  const tOff = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { freezeExpenses: false })).target;
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
  assertTrue(tOff > tOn, 'wzrost wydatków podnosi obie fazy → cel większy');
});

test('F47a: projectBridgeFire — emerytura 0 → data ≡ klasyczna (cel ≡ cel co miesiąc)', () => {
  const st = baseState({ assumptions: { portfolioStart: 10000, cashStart: 6000 } }); // ZUS 0
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  assertTrue(proj.reached, 'stan osiąga klasyczne FIRE');
  const pb = E.projectBridgeFire(st, { projection: proj, now: NOW });
  assertEq(pb.fireYm, proj.fireYm, 'skan mostu ≡ klasyczny przy ZUS 0');
  assertEq(pb.hypothetical, false);
  assertEq(pb.bridgeYears, 0);
});

test('F47b: projectBridgeFire — ZUS przesuwa FIRE wcześniej; cel < klasycznego', () => {
  const f = FIX.F46.pension;
  const st = baseState({ assumptions: {
    portfolioStart: 10000, cashStart: 6000,
    pensionMonthly: f.monthly, pensionAge: f.fromAge,
  } });
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  const pb = E.projectBridgeFire(st, { projection: proj, now: NOW });
  assertEq(pb.hypothetical, false);
  assertTrue(proj.reached && E.ymToIdx(pb.fireYm) < E.ymToIdx(pb.classicFireYm), 'FIRE z mostem ściśle wcześniej');
  assertTrue(pb.target < pb.targetClassic, 'cel z mostem niższy (ten sam miesiąc)');
  assertEq(pb.pensionMonthly, f.monthly, 'kwota echo dla czystych builderów');
  assertEq(pb.pensionAge, f.fromAge, 'wiek echo dla czystych builderów');
  assertTrue(pb.bridgeYears > 0, 'przed wiekiem emerytalnym most > 0 lat');
});

test('F47c: projectBridgeFire — hipotetyczny start dziś; brak birthDate → null', () => {
  const st = baseState({ assumptions: { monthlyIncome: 6000, pensionMonthly: 2000 } });
  E.recomputeDerived(st, NOW);
  const pb = E.projectBridgeFire(st, { projection: st.derived.projection, now: NOW });
  assertEq(pb.hypothetical, true, 'dochód = wydatki → poza horyzontem');
  assertEq(pb.fireYm, null);
  assertEq(pb.startYm, E.todayYm(NOW), 'scenariusz modelowy od dziś');
  assertEq(pb.startAge, 26);
  const nb = baseState({ assumptions: { pensionMonthly: 2000 } });
  nb.profile.birthDate = null;
  assertEq(E.projectBridgeFire(nb, { now: NOW }), null, 'brak birthDate → null');
});

test('F47d: projectBridgeFire — cel klasyczny echo z TEGO SAMEGO miesiąca (startYm)', () => {
  const f = FIX.F46.pension;
  const st = baseState({ assumptions: {
    portfolioStart: 10000, cashStart: 6000, expenseGrowthReal: 0.01,
    pensionMonthly: f.monthly, pensionAge: f.fromAge,
  } });
  E.recomputeDerived(st, NOW);
  const pb = E.projectBridgeFire(st, { projection: st.derived.projection, now: NOW });
  assertEq(pb.hypothetical, false);
  assertClose(pb.targetClassic, E.fireTargetAt(st, pb.startYm), 1e-9, 'klasyczny liczony w startYm');
  assertTrue(pb.targetClassic > E.fireTargetAt(st, E.todayYm(NOW)), 'w startYm wydatki już urosły (g>0)');
  // Ta sama tożsamość w scenariuszu hipotetycznym (startYm = dziś).
  const hyp = baseState({ assumptions: { monthlyIncome: 6000, expenseGrowthReal: 0.01, pensionMonthly: f.monthly } });
  E.recomputeDerived(hyp, NOW);
  const ph = E.projectBridgeFire(hyp, { projection: hyp.derived.projection, now: NOW });
  assertClose(ph.targetClassic, E.fireTargetAt(hyp, ph.startYm), 1e-9, 'hipotetycznie również');
});

// ── Barista FIRE: drugi offset w_n (dorabianie po FIRE) ─────────────────
// Dołącza do suit ZUS: F27 (retirementOpts/projectWithdrawal), F28 (do zera),
// F46 (bridgeTargetAt), F47 (projectBridgeFire). Formy zamknięte liczone w
// teście SĄ specyfikacją; silnik liczy pętlą wsteczną — parytet to test.
// Nic nie zapisywane: barista domyślnie null (inert), więc liczby F13/F24/F27/
// F28/F46/F47 bez zmian (patrz 229 wcześniejszych asercji powyżej).

test('F27i: retirementOpts — pole barista (domyślna null, override, jawny null, czystość)', () => {
  const st = E.createState();
  assertEq(E.retirementOpts(st).barista, null, 'nowy stan → brak dorabiania (null)');
  const o = E.retirementOpts(st, { barista: { monthly: 3000, untilAge: 40 } });
  assertEq(o.barista.monthly, 3000, 'kwota z override');
  assertEq(o.barista.untilAge, 40, 'wiek z override');
  assertEq(E.retirementOpts(st, { barista: null }).barista, null, 'jawny null → brak dorabiania');
  const before = JSON.stringify(st);
  E.retirementOpts(st, { barista: { monthly: 1000, untilAge: 50 } });
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
});

test('F27j: projectWithdrawal — offset baristy do untilAge + podłoga zera', () => {
  const b = FIX.BARISTA;
  const st = baseState(); // ZUS 0, postReturnReal 0.05
  const age0 = E.ageAt(st.profile.birthDate, '2026-07').years; // 26
  const untilAge = age0 + 10; // 36 — granica w środku tabeli
  const ro = E.retirementOpts(st, { barista: { monthly: b.monthly, untilAge } });
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45, ro });
  const crossing = w.rows.find(r => r.age >= untilAge); // wiersz z ageAt, nie z ręki
  assertTrue(!!crossing, 'horyzont przecina wiek końca dorabiania');
  for (const r of w.rows) {
    if (r.age < untilAge) {
      assertEq(r.baristaReal, 12 * b.monthly, `dorabianie 36 000/rok przed ${untilAge} (rok ${r.year})`);
      assertClose(r.netWithdrawalReal, Math.max(0, r.withdrawalReal - r.pensionReal - 12 * b.monthly), 1e-9, 'netto = brutto − ZUS − barista');
    } else {
      assertEq(r.baristaReal, 0, `brak dorabiania od ${untilAge} (rok ${r.year})`);
    }
  }
  assertEq(crossing.baristaReal, 0, 'wiersz przekroczenia bez dorabiania');
  // Rekurencja na NETTO (jeden aktywny wiersz z ręki); brutto bez zmian.
  const active = w.rows[0];
  assertClose(active.withdrawalReal, 72000, 1e-9, 'brutto to dalej pełne wydatki');
  assertClose(active.netWithdrawalReal, 72000 - 12 * b.monthly, 1e-9, 'netto = brutto − barista');
  assertClose(active.endReal, (active.startReal - active.netWithdrawalReal) * 1.05, 1e-6, 'rekurencja na netto');
  assertClose(active.baristaNominal, active.baristaReal * Math.pow(1.03, active.year - 1), 1e-6, 'nominal: epoka startYm');
  // Podłoga zera (D7): ogromne dorabianie → nic nie schodzi z portfela, rośnie.
  const rich = E.retirementOpts(st, { barista: { monthly: 10000, untilAge } });
  const wRich = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45, ro: rich });
  for (const r of wRich.rows.filter(r => r.age < untilAge)) {
    assertEq(r.netWithdrawalReal, 0, `netto na podłodze 0 (rok ${r.year})`);
    assertTrue(r.endReal > r.startReal, `portfel rośnie, gdy dorabianie pokrywa całość (rok ${r.year})`);
  }
  // Brak daty urodzenia → dorabianie nieobliczalne, baristaReal 0 wszędzie.
  const nb = baseState();
  nb.profile.birthDate = null;
  const wNb = E.projectWithdrawal(nb, { startYm: '2026-07', startPortfolioReal: 1800000, years: 45,
    ro: E.retirementOpts(nb, { barista: { monthly: b.monthly, untilAge } }) });
  assertTrue(wNb.rows.every(r => r.baristaReal === 0), 'bez birthDate → baristaReal 0 wszędzie');
});

test('F28g: cel „do zera" z baristą — arytmetyka całkowita przy r = 0 i krawędzie', () => {
  // N = 10 (wiek 26 w 2026-07, dożycie 36). Barista 3 000/mies. = 36 000/rok do
  // wieku 30 → aktywna lata 1..4 (wiek 26–29). cel = 4·(72000−36000) + 6·72000.
  const st = baseState({ assumptions: { postRetirementReturnReal: 0 } });
  const ro = E.retirementOpts(st, { barista: { monthly: 3000, untilAge: 30 } });
  const t = E.dieWithZeroTargetAt(st, '2026-07', 36, ro);
  assertEq(t.yearsN, 10);
  assertClose(t.target, 4 * (72000 - 36000) + 6 * 72000, 1e-6, 'B·(W₁−bar) + (N−B)·W₁ = 576 000');
  // Dorabianie ≥ W₁ → podłoga zera przez cały most → cel = same lata po baristcie.
  const rich = E.retirementOpts(st, { barista: { monthly: 6000, untilAge: 30 } }); // 72 000 = W₁
  assertClose(E.dieWithZeroTargetAt(st, '2026-07', 36, rich).target, 6 * 72000, 1e-6, 'barista ≥ W₁ → lata mostu składają 0');
  // untilAge ≤ wiek startowy → cel DOKŁADNIE jak bez baristy.
  const none = E.dieWithZeroTargetAt(st, '2026-07', 36).target;
  const past = E.retirementOpts(st, { barista: { monthly: 3000, untilAge: 26 } });
  assertEq(E.dieWithZeroTargetAt(st, '2026-07', 36, past).target, none, 'untilAge = wiek0 → bez wpływu');
});

test('F46e: bridgeTargetAt — barista, tożsamość arytmetyczna przy r = 0', () => {
  const b = FIX.BARISTA; // 3 000/mies. do wieku 40
  const st = baseState({ assumptions: { postRetirementReturnReal: 0 } });
  const age0 = E.ageAt(st.profile.birthDate, '2026-07').years; // 26
  const B = b.untilAge - age0; // 14
  const bt = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { barista: b }));
  assertEq(bt.bridgeYears, B, 'most = untilAge − wiek0');
  assertEq(bt.baristaYearly, 12 * b.monthly, 'echo rocznej baristy');
  assertClose(bt.terminalTarget, 72000 / 0.04, 1e-6, 'terminal = pełne wydatki / SWR (barista wygasła)');
  assertClose(bt.target, B * (72000 - 12 * b.monthly) + 72000 / 0.04, 1e-6, 'r=0: B·(W₁−bar) + W₁/wr = 2 304 000');
  // KOREKTA planu: przy r = 0 cel NIE jest < klasyczny — most jest
  // nieprzeceniony, więc finansowanie lat mostu + pełny terminal kosztuje
  // WIĘCEJ niż sam klasyczny. Nierówność żyje dopiero w F46f przy r = 5%.
  assertTrue(bt.target > bt.targetClassic, 'r=0: finansowanie lat mostu podnosi cel ponad klasyczny');
});

test('F46f: bridgeTargetAt — barista, forma zamknięta i nierówność przy r = 5%', () => {
  const b = FIX.BARISTA;
  const st = baseState(); // postRetirementReturnReal 0.05, ZUS 0
  const age0 = E.ageAt(st.profile.birthDate, '2026-07').years;
  const B = b.untilAge - age0; // 14
  const bt = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { barista: b }));
  const q = 1 / 1.05;
  const w = 72000 - 12 * b.monthly; // 36 000
  const expected = w * (1 - Math.pow(q, B)) / (1 - q) + (72000 / 0.04) * Math.pow(q, B);
  assertClose(bt.target, expected, 1e-6, 'r=5%: Σ w·qⁿ⁻¹ + terminal·qᴮ');
  assertClose(bt.targetClassic, 1800000, 1e-9, 'echo klasyczny (ten sam miesiąc)');
  assertTrue(bt.target < bt.targetClassic, 'przy r > wr dorabianie obniża cel');
  assertEq(bt.baristaYearly, 36000, 'echo rocznej baristy');
  // untilAge ≤ wiek0 → most 0, cel DOKŁADNIE klasyczny (jak bez baristy).
  const past = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { barista: { monthly: 3000, untilAge: age0 } }));
  assertEq(past.bridgeYears, 0, 'untilAge = wiek0 → most zerowy');
  assertEq(past.baristaYearly, 0, 'echo 0, gdy barista nieaktywna w ym');
  assertClose(past.target, E.fireTargetAt(st, '2026-07'), 1e-6, 'cel degeneruje się do klasycznego');
});

test('F46h: bridgeTargetAt — emerytura + barista razem: monotoniczność i czystość', () => {
  const st = baseState({ assumptions: { pensionMonthly: 2000, pensionAge: 65 } });
  const bar = { monthly: 3000, untilAge: 40 };
  const both = E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { barista: bar })).target;
  const pensOnly = E.bridgeTargetAt(st, '2026-07').target; // sama emerytura z założeń
  const barOnly = E.bridgeTargetAt(st, '2026-07',
    E.retirementOpts(st, { pension: null, barista: bar })).target;
  // Więcej dochodu nigdy nie podnosi wymaganego celu (w tej samej konstrukcji).
  assertTrue(both < pensOnly, 'dodanie baristy obniża cel vs sama emerytura');
  assertTrue(both < barOnly, 'dodanie emerytury obniża cel vs sama barista');
  const before = JSON.stringify(st);
  E.bridgeTargetAt(st, '2026-07', E.retirementOpts(st, { barista: bar }));
  assertEq(JSON.stringify(st), before, 'stan nietknięty');
});

test('F47e: projectBridgeFire — barista przesuwa FIRE nie później; echo pól', () => {
  const st = baseState({ assumptions: { portfolioStart: 10000, cashStart: 6000 } }); // ZUS 0
  E.recomputeDerived(st, NOW);
  const proj = st.derived.projection;
  assertTrue(proj.reached, 'stan osiąga klasyczne FIRE');
  const age0 = E.ageAt(st.profile.birthDate, proj.fireYm).years;
  const bar = { monthly: 3000, untilAge: age0 + 20 };
  const pb = E.projectBridgeFire(st, { projection: proj, now: NOW, ro: E.retirementOpts(st, { barista: bar }) });
  const pbBase = E.projectBridgeFire(st, { projection: proj, now: NOW });
  assertEq(pb.hypothetical, false);
  assertTrue(E.ymToIdx(pb.fireYm) <= E.ymToIdx(pbBase.fireYm), 'FIRE z baristą nie później niż bez');
  assertTrue(pb.target < pbBase.target, 'cel z baristą niższy (r > wr)');
  assertEq(pb.baristaMonthly, bar.monthly, 'echo kwoty dla builderów');
  assertEq(pb.baristaUntilAge, bar.untilAge, 'echo wieku dla builderów');
  assertTrue(pb.baristaYearly > 0, 'barista aktywna w startYm → echo roczne > 0');
  assertClose(pb.targetClassic, E.fireTargetAt(st, pb.startYm), 1e-9, 'klasyczny liczony w startYm (precedens F47d)');
  // Duże dorabianie → FIRE ściśle wcześniej.
  const rich = E.projectBridgeFire(st, { projection: proj, now: NOW,
    ro: E.retirementOpts(st, { barista: { monthly: 5000, untilAge: age0 + 30 } }) });
  assertTrue(E.ymToIdx(rich.fireYm) < E.ymToIdx(pbBase.fireYm), 'duże dorabianie → FIRE ściśle wcześniej');
});

// ── F29: charts.js — buildery SVG (opcje width/maxPoints/detail) ─────────
// Czyste asercje na stringach (bez DOM). Domyślne wyjście ma być bajt-w-bajt
// jak przed wydzieleniem modułu; opcje obsługują nakładkę pełnoekranową.

// formatShort jest prywatne w charts.js — replikujemy do asercji etykiet Y.
function fmtShort(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' mln';
  if (a >= 1e3) return Math.round(x / 1e3) + ' tys.';
  return String(Math.round(x));
}
function lineRows(months, startYm = '2026-01') {
  const base = E.ymToIdx(startYm);
  const rows = [];
  for (let i = 0; i < months; i++) rows.push({ ym: E.idxToYm(base + i), a: i * 10000, b: i * 5000 });
  return rows;
}
function barRows(years, startYear = 2026) {
  const rows = [];
  for (let i = 0; i < years; i++) rows.push({ year: startYear + i, principal: 1000 + i * 100, interest: 500 });
  return rows;
}
const LINE_DEFS = [{ get: r => r.a, cls: 'line-port' }, { get: r => r.b, cls: 'line-target' }];
const BAR_SEGS = [{ get: r => r.principal, cls: 'bar-principal' }, { get: r => r.interest, cls: 'bar-interest' }];

test('F29a: chartSVG — domyślne wyjście (viewBox, 3 osie, etykiety Y/X) i czystość', () => {
  const rows = lineRows(36); // 2026-01 … 2028-12, max a = 350 000
  const svg = chartSVG(rows, LINE_DEFS);
  assertTrue(svg.includes('viewBox="0 0 440 170"'), 'domyślny viewBox 440×170');
  assertEq((svg.match(/class="axis"/g) || []).length, 3, 'dokładnie 3 linie osi');
  assertTrue(svg.includes('>0</text>'), 'etykieta Y = 0');
  assertTrue(svg.includes(`>${fmtShort(350000 / 2)}</text>`), 'etykieta Y = ½ max (175 tys.)');
  assertTrue(svg.includes(`>${fmtShort(350000)}</text>`), 'etykieta Y = max (350 tys.)');
  assertTrue(svg.includes('>2026</text>'), 'pierwszy rok (kotwica start)');
  assertTrue(svg.includes('text-anchor="end">2028</text>'), 'ostatni rok (kotwica end)');
  assertEq(chartSVG(rows, LINE_DEFS), svg, 'czystość: dwa wywołania identyczne');
});

test('F29b: chartSVG/stackedBarSVG — opcja rozmiaru (width/height), zero NaN', () => {
  const line = chartSVG(lineRows(36), LINE_DEFS, { width: 800, height: 360 });
  assertTrue(line.includes('viewBox="0 0 800 360"'), 'viewBox liniowy 800×360');
  assertTrue(!/NaN/.test(line), 'brak NaN w wykresie liniowym');
  const bar = stackedBarSVG(barRows(20), BAR_SEGS, { width: 800, height: 360 });
  assertTrue(bar.includes('viewBox="0 0 800 360"'), 'viewBox słupków 800×360');
  assertTrue(!/NaN/.test(bar), 'brak NaN w słupkach');
});

test('F29c: chartSVG — decymacja do maxPoints, ostatni punkt na prawej krawędzi', () => {
  const svg = chartSVG(lineRows(500), [{ get: r => r.a, cls: 'line-port' }], { maxPoints: 240 });
  const pts = svg.match(/points="([^"]+)"/)[1].split(' ');
  assertTrue(pts.length <= 241, `≤241 punktów po decymacji, było ${pts.length}`);
  const lastX = Number(pts[pts.length - 1].split(',')[0]);
  assertClose(lastX, 440 - 8, 0.5, 'ostatni punkt na x = width − padR (ostatni rząd uwzględniony)');
});

test('F29d: chartSVG detail — 5 etykiet Y, pośrednie lata bez duplikatów; bez detail 2 etykiety X', () => {
  const rows = lineRows(361); // 30 lat miesięcznie
  const oneDef = [{ get: r => r.a, cls: 'line-port' }];
  const det = chartSVG(rows, oneDef, { width: 800, height: 360, detail: true });
  assertEq((det.match(/x="44"/g) || []).length, 5, 'detail → 5 etykiet Y (x = padL−4)');
  const mids = [...det.matchAll(/text-anchor="middle">(\d{4})</g)].map(m => m[1]);
  assertTrue(mids.length >= 4, `≥4 pośrednich etykiet lat, było ${mids.length}`);
  for (let i = 1; i < mids.length; i++) assertTrue(mids[i] !== mids[i - 1], 'brak sąsiadujących duplikatów lat');
  const plain = chartSVG(rows, oneDef, { width: 800, height: 360 });
  assertEq((plain.match(/y="356"/g) || []).length, 2, 'bez detail → dokładnie 2 etykiety X');
});

test('F29e: stackedBarSVG detail — gęstsze etykiety lat na szerokim płótnie; domyślne bez zmian', () => {
  const rows = barRows(30);
  const plain = stackedBarSVG(rows, BAR_SEGS);
  const plainLabels = (plain.match(/text-anchor="middle"/g) || []).length;
  assertEq(plainLabels, 9, 'domyślnie krok ceil(30/8)=4 → 9 etykiet lat');
  const detLabels = (stackedBarSVG(rows, BAR_SEGS, { width: 800, detail: true }).match(/text-anchor="middle"/g) || []).length;
  assertTrue(detLabels > plainLabels, `detail gęstsze: ${detLabels} > ${plainLabels}`);
  assertTrue(plain.includes('viewBox="0 0 440 170"'), 'domyślny viewBox słupków bez zmian');
  assertEq((plain.match(/class="axis"/g) || []).length, 3, 'domyślnie 3 osie');
});

test('F29f: chartSVG — domena ujemna (min < 0): 4 osie, etykieta min, brak NaN', () => {
  const base = E.ymToIdx('2026-01');
  const rows = [1000, -1000].map((v, i) => ({ ym: E.idxToYm(base + i), a: v }));
  const svg = chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }]);
  assertTrue(!/NaN/.test(svg), 'brak NaN');
  assertEq((svg.match(/class="axis"/g) || []).length, 4, '4 linie osi (0/max/½/min)');
  assertTrue(svg.includes(`>${fmtShort(-1000)}</text>`), 'etykieta minimum (−1 tys.)');
  // Dane symetryczne (min = −max) → oś 0 dokładnie w połowie pola: y(0) = 10 + 0.5·140 = 80.
  assertTrue(svg.includes('y1="80"'), 'solidna oś 0 w pionowym środku pola');
  assertEq(chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }]), svg, 'czystość: dwa wywołania identyczne');
});

test('F29g: chartSVG — parytet przy min = 0 (strażnik bajt-w-bajt)', () => {
  const svg = chartSVG(lineRows(36), LINE_DEFS);
  assertEq((svg.match(/class="axis"/g) || []).length, 3, 'dane ≥ 0 → dokładnie 3 osie');
  assertTrue(!svg.includes(`>${fmtShort(-1000)}</text>`), 'bez etykiety ujemnej');
  assertTrue(!/>-[\d ]/.test(svg), 'żadnej ujemnej etykiety w wyjściu dla danych ≥ 0');
});

// ── F34: charts.js — zaciski negatywów i skala z pełnej serii (D7) ────────

test('F34a: chartSVG — ujemne wartości zaciśnięte do viewBox (D7)', () => {
  const base = E.ymToIdx('2026-01');
  const vals = [1000, -5000, 3000, -200, 8000];
  const rows = vals.map((v, i) => ({ ym: E.idxToYm(base + i), a: v }));
  const svg = chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }]);
  assertTrue(!/NaN/.test(svg), 'brak NaN mimo wartości ujemnych');
  const pts = svg.match(/points="([^"]+)"/)[1].split(' ');
  const padT = 10, H = 170, padB = 20;
  for (const p of pts) {
    const yv = Number(p.split(',')[1]);
    assertTrue(yv >= padT - 0.01 && yv <= H - padB + 0.01, `y=${yv} poza [${padT}, ${H - padB}]`);
  }
});

test('F34b: chartSVG — szczyt poza krokiem decymacji wyznacza skalę (D7)', () => {
  const base = E.ymToIdx('2026-01');
  const rows = [];
  for (let i = 0; i < 500; i++) rows.push({ ym: E.idxToYm(base + i), a: i });
  rows[497].a = 950000; // indeks 497: krok decymacji = 5, ≠ ostatni → odrzucony z próbki
  const svg = chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }]);
  assertTrue(svg.includes(`>${fmtShort(950000)}</text>`), 'oś Y = szczyt z pełnej serii, nie z próbki');
});

test('F34c: chartSVG — domyślna ścieżka (v ≥ 0) bez zmian współrzędnych (D7 parytet)', () => {
  const base = E.ymToIdx('2026-01');
  const rows = [0, 5000, 10000].map((v, i) => ({ ym: E.idxToYm(base + i), a: v }));
  const svg = chartSVG(rows, [{ get: r => r.a, cls: 'line-port' }]);
  const pts = svg.match(/points="([^"]+)"/)[1];
  assertEq(pts, '48.0,150.0 240.0,80.0 432.0,10.0', 'współrzędne jak w oryginalnym mapowaniu');
});

// ── F35: deleteEntry — odwrotność applyCheckIn (dotąd bez pokrycia) ───────

test('F35: deleteEntry to odwrotność applyCheckIn (pierwszy/środek/ostatni/jedyny)', () => {
  const mk = () => baseState({ anchorMonth: '2026-01' });
  const snap = s => JSON.stringify(s.derived);

  // „Jedyny": z pustej historii apply → delete wraca do stanu bez wpisów.
  const s0 = mk();
  E.recomputeDerived(s0, NOW);
  const base0 = snap(s0);
  E.applyCheckIn(s0, { month: '2026-03', earned: 8000, spent: 5000 }, NOW);
  E.deleteEntry(s0, '2026-03', NOW);
  assertEq(s0.entries.length, 0, 'brak wpisów po delete');
  assertEq(snap(s0), base0, 'jedyny wpis: apply→delete przywraca derived');

  // Historia 2026-02 + 2026-04 — wstaw i usuń na pierwszej/środkowej/ostatniej pozycji.
  for (const [pos, month] of [['ostatni', '2026-06'], ['pierwszy', '2026-01'], ['środek', '2026-03']]) {
    const s = mk();
    E.applyCheckIn(s, { month: '2026-02', earned: 9000, spent: 6000 }, NOW);
    E.applyCheckIn(s, { month: '2026-04', earned: 7000, spent: 8000 }, NOW); // deficyt
    const before = snap(s);
    E.applyCheckIn(s, { month, earned: 8000, spent: 4000 }, NOW);
    E.deleteEntry(s, month, NOW);
    assertEq(s.entries.length, 2, `${pos}: liczba wpisów wraca do 2`);
    assertEq(snap(s), before, `${pos}: apply→delete przywraca derived`);
  }

  // Usunięcie nieistniejącego wpisu = no-op.
  const s2 = mk();
  E.applyCheckIn(s2, { month: '2026-02', earned: 9000, spent: 6000 }, NOW);
  const beforeNoop = snap(s2);
  E.deleteEntry(s2, '2099-12', NOW);
  assertEq(s2.entries.length, 1, 'liczba wpisów bez zmian');
  assertEq(snap(s2), beforeNoop, 'delete nieistniejącego = no-op');
});

// ── F36: contributionsVsGrowth — zachowanie wartości (dotąd bez pokrycia) ──

test('F36: contributionsVsGrowth zachowuje wartość; zerowy zwrot → growth 0', () => {
  // Nadwyżka + deficyt + niezerowy zwrot: start + wpłaty + wzrost = suma sald.
  const s = baseState({ anchorMonth: '2026-01',
    assumptions: { portfolioStart: 50000, realReturnAnnual: 0.05, cashReturnReal: 0.02 } });
  E.applyCheckIn(s, { month: '2026-01', earned: 10000, spent: 6000 }, NOW);
  E.applyCheckIn(s, { month: '2026-02', earned: 5000, spent: 8000 }, NOW); // deficyt
  E.applyCheckIn(s, { month: '2026-03', earned: 12000, spent: 4000 }, NOW);
  const bal = s.derived.balances;
  const cg = E.contributionsVsGrowth(s, bal);
  assertClose(cg.start + cg.totalFlow + cg.growth, bal.cash + bal.portfolio, 0.01, 'start + wpłaty + wzrost = portfel');
  assertClose(cg.now, bal.cash + bal.portfolio, 0.01, 'now = suma sald');

  // Zerowy zwrot → brak wzrostu.
  const z = baseState({ anchorMonth: '2026-01',
    assumptions: { portfolioStart: 50000, realReturnAnnual: 0, cashReturnReal: 0 } });
  E.applyCheckIn(z, { month: '2026-01', earned: 10000, spent: 6000 }, NOW);
  E.applyCheckIn(z, { month: '2026-02', earned: 12000, spent: 4000 }, NOW);
  const cgz = E.contributionsVsGrowth(z, z.derived.balances);
  assertClose(cgz.growth, 0, 0.01, 'zerowy zwrot → growth ≈ 0');
});

// ── F30: podatek Belki (19% od zysków nominalnych) ───────────────────────
// Basis nominalny (epoka kotwicy), gross-up, warunek FIRE „po podatku",
// niezmienniki włącz/wyłącz. Plan: docs/plan-belka-tax-toggle.md (F29→F30,
// bo F29 zajęły wykresy).

// Stan F1-podobny: dochód 10 000 / życie 6 000, portfel startowy 100 000.
function f30State(belka, over = {}) {
  return baseState(deep({
    assumptions: { portfolioStart: 100000 },
    taxes: { belkaEnabled: belka },
  }, over));
}

test('F30a: podatki wyłączone — stan v4 po migracji liczy identycznie jak belkaEnabled:false', () => {
  const stOff = f30State(false);
  const v4 = JSON.parse(JSON.stringify(stOff));
  v4.version = 4;
  delete v4.taxes;
  const stMig = S.migrate(S.validateState(v4));
  const pOff = E.projectionWith(stOff, {}, NOW);
  const pMig = E.projectionWith(stMig, {}, NOW);
  assertEq(pMig.fireYm, pOff.fireYm, 'fireYm identyczne');
  assertEq(pMig.taxes.any, false, 'podatki nieaktywne po migracji');
  assertEq(
    JSON.stringify(pMig.series.map(r => [r.ym, r.cash, r.portfolio])),
    JSON.stringify(pOff.series.map(r => [r.ym, r.cash, r.portfolio])),
    'serie identyczne',
  );
  const w = E.projectWithdrawal(stOff, { projection: pOff });
  assertEq(w.taxesApplied.any, false, 'wypłaty bez podatków');
  assertTrue(w.rows.every(r => r.taxReal === undefined && r.grossReal === undefined), 'wiersze bez pól podatkowych');
  assertTrue(w.taxTotalReal === undefined, 'brak taxTotalReal przy wyłączonych podatkach');
});

test('F30b: sam kapitał (r=0, inflacja=0) — gainShare 0, cel brutto = netto, podatek 0', () => {
  const f = FIX.F30;
  const st = f30State(true, {
    assumptions: { realReturnAnnual: 0, inflationAnnual: 0, cashReturnReal: 0, postRetirementReturnReal: 0 },
  });
  for (let i = 0; i < 6; i++) st.entries.push(entry(E.addMonths('2026-07', i), 10000, 6000));
  const bal = E.replayBalances(st, '2026-12');
  const tr = E.makeTaxTracker(st, bal.taxSnapshot);
  for (const r of bal.rows) {
    assertClose(E.gainShareOf(r.portfolio, r.basisNominal, st.anchorMonth, r.ym, 0), 0, f.eps, `gainShare 0 w ${r.ym}`);
    assertClose(r.netPortfolio, r.portfolio, 1e-9, `netto = brutto w ${r.ym}`);
  }
  assertClose(tr.gainShare('2026-12'), 0, f.eps);
  assertEq(E.belkaGrossTarget(f.netTarget, 0), f.netTarget, 'gross-up przy gainShare 0 = identyczność');
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: 720000, years: 5 });
  assertTrue(w.rows.every(r => Math.abs(r.taxReal) < f.eps), 'taxReal = 0 każdego roku');
});

test('F30c: basis NOMINALNY — zysk czysto inflacyjny też opodatkowany (r=0, inflacja 3%)', () => {
  const f = FIX.F30;
  const st = f30State(true, {
    assumptions: { portfolioStart: 0, realReturnAnnual: 0, inflationAnnual: f.infl },
  });
  const tr = E.makeTaxTracker(st);
  tr.contribute(f.singleContrib, '2026-07'); // wpłata na kotwicy, bez dalszych przepływów
  const ym = E.addMonths('2026-07', f.months);
  const expected = 1 - Math.pow(1 + f.infl, -f.months / 12);
  assertClose(tr.gainShare(ym), expected, f.eps, 'gainShare = 1 − 1,03^(−2)');
  assertTrue(tr.netValueReal(ym) < f.singleContrib - 1, 'realny zysk 0, a podatek > 0 — basis musi być nominalny');
  // End-to-end: replayBalances z samym portfelem startowym daje ten sam udział.
  const st2 = f30State(true, {
    assumptions: { portfolioStart: f.singleContrib, realReturnAnnual: 0, inflationAnnual: f.infl },
  });
  const bal2 = E.replayBalances(st2, ym);
  const tr2 = E.makeTaxTracker(st2, bal2.taxSnapshot);
  assertClose(tr2.gainShare(ym), expected, f.eps, 'ten sam udział przez replayBalances');
});

test('F30d: algebra gross-up — odwracalność i monotonia w gainShare', () => {
  const f = FIX.F30;
  let prev = 0;
  for (const g of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    const gross = E.belkaGrossTarget(f.netTarget, g);
    assertClose(gross * (1 - E.BELKA_RATE * g), f.netTarget, 0.01, `odwracalność przy g=${g}`);
    assertTrue(gross >= prev, `rosnący w g (g=${g})`);
    prev = gross;
  }
  assertEq(E.belkaGrossTarget(f.netTarget, -1), f.netTarget, 'clamp g<0');
  assertClose(E.belkaGrossTarget(f.netTarget, 2), f.netTarget / (1 - E.BELKA_RATE), 0.01, 'clamp g>1');
});

test('F30e: niezmienniki trackera — withdraw/setTotal zachowują gainShare, krawędzie', () => {
  const f = FIX.F30;
  const st = f30State(true, { assumptions: { portfolioStart: 0, inflationAnnual: f.infl } });
  const mkTr = () => {
    const tr = E.makeTaxTracker(st);
    tr.contribute(10000, '2026-07');
    for (let i = 0; i < 24; i++) tr.grow(0.01); // zysk rynkowy → gainShare > 0
    return tr;
  };
  const ym = E.addMonths('2026-07', 24);
  const g0 = mkTr().gainShare(ym);
  assertTrue(g0 > 0.1, 'jest zysk do opodatkowania');
  for (const x of [100, 5000, 12000]) {
    const tr = mkTr();
    tr.withdraw(x);
    assertClose(tr.gainShare(ym), g0, f.eps, `withdraw(${x}) zachowuje gainShare`);
  }
  const tr2 = mkTr();
  tr2.setTotal(31337, ym);
  assertClose(tr2.gainShare(ym), g0, f.eps, 'setTotal (D9) zachowuje gainShare');
  assertClose(tr2.snapshot().value, 31337, 1e-9);
  // Zero → dodatnia korekta: wszystko jako wpłata, gainShare 0.
  const tr3 = E.makeTaxTracker(st);
  tr3.setTotal(50000, ym);
  assertClose(tr3.gainShare(ym), 0, f.eps, 'korekta z zera → gainShare 0');
  // Nadmierny drenaż: wartość ujemna, basis 0, netto = surowa wartość.
  const tr4 = mkTr();
  tr4.withdraw(99999);
  const snap4 = tr4.snapshot();
  assertTrue(snap4.value < 0, 'wartość ujemna po nadmiernym drenażu');
  assertEq(snap4.basisNominal, 0, 'basis z podłogą 0');
  assertClose(tr4.netValueReal(ym), snap4.value, 1e-9, 'ujemna wartość bez podatku');
});

test('F30f: Belka opóźnia FIRE — miesiąc przypięty jako kotwica regresji', () => {
  const st = f30State(false);
  const pOff = E.projectionWith(st, {}, NOW);
  const pOn = E.projectionWith(st, { taxes: { belkaEnabled: true } }, NOW);
  assertTrue(pOff.reached && pOn.reached, 'obie prognozy osiągają FIRE');
  assertTrue(E.ymToIdx(pOn.fireYm) >= E.ymToIdx(pOff.fireYm), 'z podatkiem nie wcześniej');
  assertTrue(E.ymToIdx(pOn.fireYm) > E.ymToIdx(pOff.fireYm), 'z podatkiem później (jest zysk do opodatkowania)');
  assertEq(pOff.fireYm, '2045-10', 'kotwica regresji bez podatku');
  assertEq(pOn.fireYm, '2047-06', 'kotwica regresji z podatkiem (+20 mies.)');
});

test('F30g: tracker tylko obserwuje — salda i przepływy bit-w-bit identyczne on/off', () => {
  const mk = belka => {
    const st = f30State(belka, { assumptions: { portfolioStart: 50000 } });
    st.entries.push(entry('2026-07', 9000, 4000));
    st.entries.push(entry('2026-08', 3000, 9500)); // deficyt → drenaż portfela
    st.entries.push(entry('2026-09', 8000, 5000, { balanceOverride: 70000 }));
    st.entries.push(entry('2026-10', 8000, 5000));
    return st;
  };
  const on = E.replayBalances(mk(true), '2026-12');
  const off = E.replayBalances(mk(false), '2026-12');
  const strip = rows => rows.map(r => [r.ym, r.cash, r.portfolio, r.flowCash, r.flowPortfolio, r.phase, r.override]);
  assertEq(JSON.stringify(strip(on.rows)), JSON.stringify(strip(off.rows)), 'wiersze replayBalances identyczne');
  assertTrue(on.taxSnapshot != null && off.taxSnapshot == null, 'snapshot tylko przy aktywnych podatkach');
  assertClose(on.taxSnapshot.value, on.portfolio, 1e-9, 'tracker lustrzany do portfela');
  assertTrue(on.rows.every(r => r.basisNominal != null && r.netPortfolio <= r.portfolio + 1e-9), 'pola podatkowe na wierszach');
  const NOW2 = new Date(2027, 0, 15);
  const pOn = E.projectionWith(mk(true), {}, NOW2);
  const pOff = E.projectionWith(mk(false), {}, NOW2);
  const n = Math.min(pOn.series.length, pOff.series.length);
  for (let i = 0; i < n; i++) {
    if (Math.abs(pOn.series[i].portfolio - pOff.series[i].portfolio) > 1e-6) {
      fail(`portfel rozjechany w ${pOn.series[i].ym}`);
    }
  }
  assertTrue(E.ymToIdx(pOn.fireYm) >= E.ymToIdx(pOff.fireYm), 'on-run kończy nie wcześniej');
});

test('F30h: faza wypłat — erozja basisu, podatek rośnie, tożsamość wiersza', () => {
  const st = f30State(true, { assumptions: { postRetirementReturnReal: 0.05 } }); // infl 3% z baseState
  const w = E.projectWithdrawal(st, { startYm: '2026-07', startPortfolioReal: 1800000, years: 20 });
  assertEq(w.taxesApplied.belka, true);
  assertClose(w.rows[0].taxReal, 0, 1e-9, 'rok 1: basis = wartość na starcie (seed bez projekcji) → podatek 0');
  for (let i = 1; i < w.rows.length; i++) {
    assertTrue(w.rows[i].taxReal > w.rows[i - 1].taxReal - 1e-12, `podatek niemalejący (rok ${i + 1})`);
  }
  assertTrue(w.rows[w.rows.length - 1].taxReal > 0, 'podatek dodatni na końcu');
  let taxSum = 0;
  for (const r of w.rows) {
    assertClose(r.endReal, (r.startReal - r.withdrawalReal - r.taxReal) * 1.05, 0.01, `tożsamość endReal (rok ${r.year})`);
    assertClose(r.taxNominal, r.taxReal * Math.pow(1.03, r.year - 1), 0.01, `taxNominal = taxReal × pf1 (rok ${r.year})`);
    assertClose(r.grossReal, r.withdrawalReal + r.taxReal, 0.01, `brutto = netto + podatek (rok ${r.year})`);
    taxSum += r.taxReal;
  }
  assertClose(w.taxTotalReal, taxSum, 0.01, 'suma podatków spójna');
  assertEq(w.depletedYear, null, 'portfel 25× wydatków przy 5% realnie się nie wyczerpuje');
});

test('F30i: projectionWith({taxes}) — czystość stanu i zgodność z mutacją kopii', () => {
  const st = f30State(false);
  const before = JSON.stringify(st);
  const p = E.projectionWith(st, { taxes: { belkaEnabled: true } }, NOW);
  assertEq(JSON.stringify(st), before, 'stan wejściowy nietknięty');
  const stCopy = JSON.parse(before);
  stCopy.taxes = { belkaEnabled: true };
  const pDirect = E.projectionWith(stCopy, {}, NOW);
  assertEq(p.fireYm, pDirect.fireYm, 'override ≡ bezpośrednia mutacja kopii');
  assertEq(p.taxes.belka, true, 'projekcja wie, że Belka aktywna');
});

test('F30j: taxStats — cel brutto > netto, netto portfela ≤ brutto, null gdy wyłączone', () => {
  const st = f30State(true);
  for (let i = 0; i < 6; i++) st.entries.push(entry(E.addMonths('2026-07', i), 10000, 6000));
  const bal = E.replayBalances(st, '2026-12');
  const ts = E.taxStats(st, bal, '2026-12');
  assertTrue(ts != null, 'taxStats obecny przy aktywnej Belce');
  assertTrue(ts.gainShare >= 0 && ts.gainShare <= 1, 'gainShare w [0,1]');
  assertTrue(ts.targetGross >= ts.targetNet, 'cel brutto ≥ netto');
  assertClose(ts.targetGross, E.belkaGrossTarget(ts.targetNet, ts.gainShare), 0.01, 'gross-up spójny');
  assertTrue(ts.netValueReal <= ts.portfolio + 1e-9, 'portfel po podatku ≤ brutto');
  const stOff = f30State(false);
  const balOff = E.replayBalances(stOff, '2026-12');
  assertEq(E.taxStats(stOff, balOff, '2026-12'), null, 'null przy wyłączonych podatkach');
});

// ── F31: IKE/IKZE — trzy kubełki, limity, zwrot PIT, podatek przy wypłacie ──
// Kolejność wypełniania IKZE → IKE → taxable (D6), zwrot PIT w kwietniu (D7),
// wycena netto wg progów wieku 60/65 (D4), wypłaty taxable → IKE → IKZE (D10).
// Plan: docs/plan-ike-ikze-buckets.md (tam F30 → tu F31, bo F30 zajęła Belka).

// Stan z kotwicą 2026-01 i zerowymi stopami: kubełki rosną wyłącznie o wpłaty,
// więc wartości na koniec roku = sumy wpłat (czyste odczyty limitów).
function f31State(over = {}) {
  return baseState(deep({
    anchorMonth: '2026-01',
    assumptions: { realReturnAnnual: 0, inflationAnnual: 0, cashReturnReal: 0, postRetirementReturnReal: 0 },
    taxes: { belkaEnabled: true, ikeIkze: { enabled: true } },
  }, over));
}
const NOW31 = new Date(2026, 0, 15); // upto = 2025-12 → wszystko prognozą od kotwicy

test('F31: stałe limitów IKE/IKZE przypięte do wartości 2026 (nie duplikat fixture)', () => {
  // Przypinamy stałe silnika do udokumentowanych wartości 2026 — edycja stałej
  // wywali ten test, zamiast po cichu rozjechać się z fixture (fixture je importuje).
  assertEq(E.IKE_LIMIT_YEARLY, 28260, 'limit IKE 2026');
  assertEq(E.IKZE_LIMIT_EMPLOYEE, 11304, 'limit IKZE (etat) 2026');
  assertEq(E.IKZE_LIMIT_SELFEMPLOYED, 16956, 'limit IKZE (działalność) 2026');
  // Fixture faktycznie odwołuje się do tych samych stałych.
  assertEq(FIX.F31.limits.ike, E.IKE_LIMIT_YEARLY, 'fixture.ike = stała silnika');
  assertEq(FIX.F31.limits.ikzeEmployee, E.IKZE_LIMIT_EMPLOYEE, 'fixture.ikzeEmployee = stała');
  assertEq(FIX.F31.limits.ikzeSelfEmployed, E.IKZE_LIMIT_SELFEMPLOYED, 'fixture.ikzeSelfEmployed = stała');
});

test('F31a: kolejność wypełniania i limity — IKZE 11304, IKE 28260, reszta taxable; liczniki zerowane w styczniu', () => {
  const f = FIX.F31;
  const p = E.projectionWith(f31State(), {}, NOW31);
  const row = ym => p.series.find(r => r.ym === ym);
  const feb = row('2026-02');
  assertClose(feb.buckets.ikze, 8000, f.eps, 'najpierw IKZE');
  assertClose(feb.buckets.ike, 0, f.eps, 'IKE puste przed limitem IKZE');
  const dec = row('2026-12');
  assertClose(dec.buckets.ikze, f.limits.ikzeEmployee, f.eps, 'IKZE do limitu');
  assertClose(dec.buckets.ike, f.limits.ike, f.eps, 'IKE do limitu');
  assertClose(dec.buckets.taxable, f.taxableRemainder, f.eps, 'reszta na konto zwykłe');
  // Styczeń otwiera nowe limity: cała miesięczna wpłata (4000) idzie na IKZE.
  const jan = row('2027-01');
  assertClose(jan.buckets.ikze - dec.buckets.ikze, 4000, f.eps, 'liczniki wyzerowane w styczniu');
});

test('F31b: limit dla działalności — IKZE wypełnia się do 16956 zanim IKE cokolwiek dostanie', () => {
  const f = FIX.F31;
  const p = E.projectionWith(f31State({ taxes: { ikeIkze: { employmentForm: 'selfEmployed' } } }), {}, NOW31);
  const row = ym => p.series.find(r => r.ym === ym);
  assertClose(row('2026-04').buckets.ikze, 16000, f.eps, '4 miesiące w całości na IKZE');
  assertClose(row('2026-04').buckets.ike, 0, f.eps, 'IKE puste przed limitem IKZE');
  assertClose(row('2026-12').buckets.ikze, f.limits.ikzeSelfEmployed, f.eps, 'IKZE do limitu działalności');
});

test('F31c: zwrot PIT — kwiecień następnego roku, tylko prognoza; szew historia→prognoza przez prevYearIkze', () => {
  const f = FIX.F31;
  const st = f31State();
  const pOn = E.projectionWith(st, {}, NOW31);
  const pOff = E.projectionWith(st, { taxes: { ikeIkze: { enabled: false } } }, NOW31);
  const flows = p => new Map(p.series.map(r => [r.ym, r.flowPortfolio]));
  const fOn = flows(pOn), fOff = flows(pOff);
  let checked = 0;
  for (const [ym, v] of fOn) {
    if (!fOff.has(ym)) continue;
    if (ym.endsWith('-04') && ym !== '2026-04') continue; // kwietnie z osobna niżej
    assertClose(v - fOff.get(ym), 0, f.eps, `przepływy identyczne poza kwietniem (${ym})`);
    checked++;
  }
  assertTrue(checked > 20, 'porównano sensowną liczbę miesięcy');
  assertClose(fOn.get('2027-04') - fOff.get('2027-04'), f.refundEmployee12, f.eps, 'kwiecień 2027: 0,12 × 11304');
  // Szew: wpłaty IKZE z HISTORII zasilają pierwszy PROGNOZOWANY kwiecień.
  const mkH = ikeOn => {
    const s = f31State(ikeOn ? {} : { taxes: { ikeIkze: { enabled: false } } });
    for (let i = 0; i < 12; i++) s.entries.push(entry(E.addMonths('2026-01', i), 10000, 6000, { snapshot: 4000 }));
    return s;
  };
  const NOWH = new Date(2027, 1, 15); // luty 2027 → upto 2027-01, kwiecień 2027 jest prognozą
  const balH = E.replayBalances(mkH(true), '2027-01');
  assertClose(balH.taxSnapshot.prevYearIkze, f.limits.ikzeEmployee, f.eps, 'szew niesie zeszłoroczne wpłaty IKZE');
  assertClose(balH.taxSnapshot.ytdIkze, 0, f.eps, 'licznik bieżącego roku wyzerowany w styczniu');
  const balHOff = E.replayBalances(mkH(false), '2027-01');
  assertEq(
    JSON.stringify(balH.rows.map(r => [r.ym, r.flowPortfolio, r.flowCash])),
    JSON.stringify(balHOff.rows.map(r => [r.ym, r.flowPortfolio, r.flowCash])),
    'historia nigdy nie wstrzykuje zwrotu (wpisy są prawdą, D7)',
  );
  const pH = E.projectionWith(mkH(true), {}, NOWH);
  const pHOff = E.projectionWith(mkH(false), {}, NOWH);
  const apr = pH.series.find(r => r.ym === '2027-04');
  const aprOff = pHOff.series.find(r => r.ym === '2027-04');
  assertTrue(apr.projected, 'kwiecień 2027 jest miesiącem prognozy');
  assertClose(apr.flowPortfolio - aprOff.flowPortfolio, f.refundEmployee12, f.eps, 'zwrot za historyczny rok trafia do pierwszego prognozowanego kwietnia');
});

test('F31d: stawka PIT 32% — zwrot 3617,28', () => {
  const f = FIX.F31;
  const st = f31State({ taxes: { ikeIkze: { pitRate: 0.32 } } });
  const pOn = E.projectionWith(st, {}, NOW31);
  const pOff = E.projectionWith(st, { taxes: { ikeIkze: { enabled: false } } }, NOW31);
  const get = (p, ym) => p.series.find(r => r.ym === ym).flowPortfolio;
  assertClose(get(pOn, '2027-04') - get(pOff, '2027-04'), f.refundPit32, f.eps, '0,32 × 11304');
});

test('F31e: wycena netto przy progach wieku — IKE od 60, IKZE 10% od 65, wcześniej PIT; D11 przy wyłączonej Belce', () => {
  const f = FIX.F31;
  const mk = belka => {
    const st = f31State({
      profile: { birthDate: '1970-01-01' },
      assumptions: { portfolioStart: 30000 },
      taxes: { belkaEnabled: belka, ikeIkze: { ikeStart: 10000, ikzeStart: 5000 } },
    });
    const tr = E.makeTaxTracker(st);
    tr.grow(1); // ×2: taxable 30000, IKE 20000, IKZE 10000; bases 15000/10000 → gainShare 0,5
    return tr;
  };
  const tNet = 30000 * (1 - 0.19 * 0.5);
  const iNetEarly = 20000 * (1 - 0.19 * 0.5);
  const tr = mk(true);
  assertClose(tr.netValueReal('2029-12'), tNet + iNetEarly + 10000 * 0.88, f.eps, 'wiek 59: wczesne stawki (IKE Belka, IKZE PIT 12%)');
  assertClose(tr.netValueReal('2030-01'), tNet + 20000 + 10000 * 0.88, f.eps, 'wiek 60: IKE bez podatku');
  assertClose(tr.netValueReal('2035-01'), tNet + 20000 + 10000 * 0.90, f.eps, 'wiek 65: IKZE 10% ryczałtu');
  // D11: Belka wyłączona → taxable i wczesne IKE bez podatku, IKZE dalej płaci PIT.
  const trOff = mk(false);
  assertClose(trOff.netValueReal('2029-12'), 30000 + 20000 + 10000 * 0.88, f.eps, 'bez Belki: IKZE nadal płaci PIT');
  // Brak daty urodzenia → konserwatywnie stawki wczesne.
  const stNB = f31State({
    profile: { birthDate: '' },
    assumptions: { portfolioStart: 30000 },
    taxes: { ikeIkze: { ikeStart: 10000, ikzeStart: 5000 } },
  });
  const trNB = E.makeTaxTracker(stNB);
  trNB.grow(1);
  assertClose(trNB.netValueReal('2050-01'), tNet + iNetEarly + 10000 * 0.88, f.eps, 'brak daty urodzenia → stawki wczesne');
});

test('F31f: IKE/IKZE przyspieszają FIRE przy włączonej Belce — kotwice regresji', () => {
  const st = baseState({
    assumptions: { portfolioStart: 100000 },
    taxes: { belkaEnabled: true, ikeIkze: { enabled: true } },
  });
  const pIke = E.projectionWith(st, {}, NOW);
  const pBase = E.projectionWith(st, { taxes: { ikeIkze: { enabled: false } } }, NOW);
  assertTrue(pIke.reached && pBase.reached, 'obie prognozy osiągają FIRE');
  assertTrue(E.ymToIdx(pIke.fireYm) <= E.ymToIdx(pBase.fireYm), 'z IKE/IKZE nie później');
  assertEq(pBase.fireYm, '2047-06', 'kotwica: sama Belka (jak F30f)');
  assertEq(pIke.fireYm, '2047-02', 'kotwica: Belka + IKE/IKZE (▲ 4 mies. wcześniej)');
});

test('F31g: suma kubełków = portfel w każdym wierszu; basis skalarny = suma bases', () => {
  const st = baseState({
    assumptions: { portfolioStart: 40000, cashStart: 10000 },
    taxes: { belkaEnabled: true, ikeIkze: { enabled: true, ikeStart: 8000, ikzeStart: 2000 } },
    housing: {
      housePlan: housePlan({
        moveInMonth: '2027-01',
        houseSpend: { month: '2027-01', amount: 20000 },
        mortgage: { startMonth: '2027-01', principal: 120000, rateNominal: 0.07, termYears: 10, paymentOverrideMonthly: null },
        familyLoan: { enabled: true, startMonth: '2027-01', endMonth: '2028-12', principal: 24000, rateNominal: 0, paymentOverrideMonthly: null },
      }),
    },
  });
  st.entries.push(entry('2026-07', 10000, 6000, { snapshot: 4000 }));
  st.entries.push(entry('2026-08', 3000, 9500, { snapshot: 4000 }));   // deficyt
  st.entries.push(entry('2026-09', 8000, 5000, { snapshot: 4000, balanceOverride: 70000 }));
  st.entries.push(entry('2026-10', 8000, 5000, { snapshot: 4000 }));
  st.entries.push(entry('2026-11', 8000, 5000, { snapshot: 4000 }));
  const p = E.projectionWith(st, {}, new Date(2026, 11, 15)); // upto 2026-11
  let rowsChecked = 0;
  for (const r of p.series) {
    if (!r.buckets) continue;
    const sum = r.buckets.taxable + r.buckets.ike + r.buckets.ikze;
    const tol = Math.max(1e-6 * Math.abs(r.portfolio), 1e-6);
    assertClose(sum, r.portfolio, tol, `suma kubełków = portfel (${r.ym})`);
    assertClose(r.basisNominal, r.buckets.taxableBasisNominal + r.buckets.ikeBasisNominal, 1e-9, `basis skalarny = suma bases (${r.ym})`);
    rowsChecked++;
  }
  assertTrue(rowsChecked > 100, 'sprawdzono historię i prognozę (korekty, deficyty, spille, zakup domu)');
});

test('F31h: korekta salda (D9) zachowuje miks kont i udziały zysku; z zera → wszystko taxable', () => {
  const f = FIX.F31;
  const st = f31State();
  const mk = () => {
    const tr = E.makeTaxTracker(st);
    tr.contribute(20000, '2026-01'); // IKZE 11304, IKE 8696
    tr.contribute(30000, '2026-02'); // IKE do 28260, reszta taxable
    tr.grow(0.5);                    // zysk we wszystkich kubełkach
    return tr;
  };
  const before = mk().row();
  const tot = before.taxable + before.ike + before.ikze;
  const gT0 = E.gainShareOf(before.taxable, before.taxableBasisNominal, '2026-01', '2026-06', 0);
  const gI0 = E.gainShareOf(before.ike, before.ikeBasisNominal, '2026-01', '2026-06', 0);
  assertTrue(gT0 > 0.3 && gI0 > 0.3, 'jest zysk do opodatkowania');
  const tr = mk();
  tr.setTotal(tot / 2, '2026-06');
  const after = tr.row();
  assertClose(after.taxable / (tot / 2), before.taxable / tot, 1e-9, 'udział taxable zachowany');
  assertClose(after.ike / (tot / 2), before.ike / tot, 1e-9, 'udział IKE zachowany');
  assertClose(after.ikze / (tot / 2), before.ikze / tot, 1e-9, 'udział IKZE zachowany');
  assertClose(E.gainShareOf(after.taxable, after.taxableBasisNominal, '2026-01', '2026-06', 0), gT0, f.eps, 'gainShare taxable zachowany');
  assertClose(E.gainShareOf(after.ike, after.ikeBasisNominal, '2026-01', '2026-06', 0), gI0, f.eps, 'gainShare IKE zachowany');
  // Korekta z zera: wszystko do taxable, konta z ulgami puste, gainShare 0.
  const tr0 = E.makeTaxTracker(st);
  tr0.setTotal(50000, '2026-06');
  const r0 = tr0.row();
  assertEq(r0.ike, 0, 'IKE puste');
  assertEq(r0.ikze, 0, 'IKZE puste');
  assertClose(r0.taxable, 50000, 1e-9, 'całość na koncie zwykłym');
  assertClose(E.gainShareOf(r0.taxable, r0.taxableBasisNominal, '2026-01', '2026-06', 0), 0, f.eps, 'gainShare 0');
});

test('F31i: salda startowe IKE/IKZE (D8) — basis = wartość, bez zaliczenia do limitów', () => {
  const st = f31State({
    assumptions: { portfolioStart: 30000 },
    taxes: { ikeIkze: { ikeStart: 10000, ikzeStart: 5000 } },
  });
  const tr = E.makeTaxTracker(st);
  const snap = tr.snapshot();
  assertClose(snap.taxable, 15000, 1e-9, 'taxable = reszta portfela startowego');
  assertClose(snap.ike, 10000, 1e-9, 'IKE = ikeStart');
  assertClose(snap.ikze, 5000, 1e-9, 'IKZE = ikzeStart');
  assertClose(snap.taxableBasisNominal, 15000, 1e-9, 'basis = wartość na kotwicy');
  assertClose(snap.ikeBasisNominal, 10000, 1e-9, 'basis IKE = wartość');
  assertEq(snap.ytdIkze, 0, 'start nie liczy się do limitu IKZE');
  assertEq(snap.ytdIke, 0, 'start nie liczy się do limitu IKE');
  tr.contribute(4000, '2026-01');
  assertClose(tr.row().ikze, 9000, 1e-9, 'pełny limit dostępny — pierwsza wpłata w całości na IKZE');
  // Uwaga: ograniczenia ikeStart + ikzeStart ≤ portfolioStart pilnuje UI —
  // silnik ufa stanowi (bez rzucania), dlatego tu bez testu wyjątku (D8).
  const bal = E.replayBalances(st, '2025-12'); // przed kotwicą → zero iteracji
  assertClose(bal.taxSnapshot.ike, 10000, 1e-9, 'szew niesie kubełki startowe');
  // Wyłączone ikeIkze → split ignorowany, wszystko na koncie zwykłym.
  const stOff = f31State({
    assumptions: { portfolioStart: 30000 },
    taxes: { ikeIkze: { enabled: false, ikeStart: 10000, ikzeStart: 5000 } },
  });
  const snapOff = E.makeTaxTracker(stOff).snapshot();
  assertClose(snapOff.taxable, 30000, 1e-9, 'wyłączone ikeIkze → wszystko taxable');
  assertEq(snapOff.ike, 0, 'IKE puste przy wyłączonym ikeIkze');
});

test('F31j: faza wypłat — kolejność taxable → IKE → IKZE i klify podatkowe 60/65; czystość projectionWith', () => {
  const f = FIX.F31;
  const st = f31State({ profile: { birthDate: '1971-01-01' } }); // wiek 55 na starcie wypłat
  const buckets = {
    taxable: 240000, ike: 300000, ikze: 300000,
    taxableBasisNominal: 240000, ikeBasisNominal: 150000, // taxable bez zysku, IKE w połowie zysk
  };
  const proj = {
    reached: true, fireYm: '2026-01',
    series: [{ ym: '2026-01', portfolio: 840000, basisNominal: 390000, buckets }],
  };
  const w = E.projectWithdrawal(st, { projection: proj, withdrawalRealYearly: 60000, years: 12 });
  assertEq(w.taxesApplied.ikeIkze, true, 'wypłaty wiedzą o IKE/IKZE');
  const t = y => w.rows[y - 1].taxReal;
  for (let y = 1; y <= 4; y++) assertClose(t(y), 0, f.eps, `rok ${y}: najpierw konto zwykłe (bez zysku → bez podatku)`);
  assertClose(t(5), (60000 / (1 - 0.19 * 0.5)) * 0.19 * 0.5, f.eps, 'rok 5 (wiek 59): wczesne IKE płaci Belkę od zysków');
  assertClose(t(6), 0, f.eps, 'rok 6 (wiek 60): klif — IKE bez podatku');
  assertClose(t(10), (60000 / (1 - 0.12)) * 0.12, f.eps, 'rok 10 (wiek 64): IKZE przed 65 → PIT od całości');
  assertClose(t(11), (60000 / 0.9) * 0.1, f.eps, 'rok 11 (wiek 65): klif — ryczałt 10%');
  // Czystość: override ikeIkze w projectionWith nie dotyka stanu wejściowego.
  const st2 = baseState();
  const before = JSON.stringify(st2);
  E.projectionWith(st2, { taxes: { ikeIkze: { enabled: true } } }, NOW);
  assertEq(JSON.stringify(st2), before, 'stan wejściowy nietknięty');
});

test('F31k: spill z kredytów omija limity (D6) — ląduje na koncie zwykłym mimo wolnego limitu IKZE', () => {
  const f = FIX.F31;
  const st = f31State({
    assumptions: { monthlyIncome: 12000 },
    housing: {
      housePlan: housePlan({
        moveInMonth: '2026-01',
        mortgage: { startMonth: '2026-01', principal: 100, rateNominal: 0.07, termYears: 1, paymentOverrideMonthly: null },
        familyLoan: { enabled: true, startMonth: '2026-02', endMonth: '2027-01', principal: 12000, rateNominal: 0, paymentOverrideMonthly: 5000 },
      }),
    },
  });
  const p = E.projectionWith(st, {}, NOW31);
  const row = ym => p.series.find(r => r.ym === ym);
  // Rodzinny 5000/mies. od lutego: luty 12000→7000, marzec →2000, kwiecień:
  // ostatnia rata 5000 pokrywa 2000 → spill 3000 wraca do portfela.
  const mar = row('2026-03'), apr = row('2026-04');
  assertClose(apr.buckets.taxable - mar.buckets.taxable, 3000, f.eps, 'spill w całości na taxable');
  assertTrue(apr.buckets.ikze < f.limits.ikzeEmployee - 1000, 'limit IKZE miał zapas — spill go ominął');
  assertTrue(apr.buckets.ikze > mar.buckets.ikze, 'zwykła kwietniowa wpłata dalej trafia na IKZE');
  // Przepływy poza kwietniami identyczne z wyłączonym ikeIkze (jedyną różnicą
  // przepływów jest zwrot PIT — routing kubełków nie zmienia sald).
  const pOff = E.projectionWith(st, { taxes: { ikeIkze: { enabled: false } } }, NOW31);
  const fOn = new Map(p.series.map(r => [r.ym, r.flowPortfolio]));
  for (const r of pOff.series) {
    if (!fOn.has(r.ym) || r.ym.endsWith('-04')) continue;
    assertClose(fOn.get(r.ym) - r.flowPortfolio, 0, f.eps, `przepływy identyczne (${r.ym})`);
  }
});

// ── F37: tap-to-inspect — payload data-tip + hit-test tipHit ──────────────
// Plan: docs/plan-chart-tooltips-tap-to-inspect.md (tam „F30" — zajęte przez
// Belkę → F37). Etykiety serii (label) są opt-in: bez nich wyjście builderów
// pozostaje bajt-w-bajt jak w F29; payload niesie surowe liczby (grosze),
// formatowanie robi ui.js. Wskaźnik/odczyt to DOM (ui.js) — QA ręczne.

const LINE_DEFS_L = [
  { get: r => r.a, cls: 'line-port', label: 'portfel' },
  { get: r => r.b, cls: 'line-target', label: 'cel' },
];
const BAR_SEGS_L = [
  { get: r => r.principal, cls: 'bar-principal', label: 'kapitał' },
  { get: r => r.interest, cls: 'bar-interest', label: 'odsetki' },
];

// Wyciąga i odkodowuje payload data-tip (odwrotność esc; &amp; na końcu).
function tipOf(svg) {
  const m = svg.match(/ data-tip="([^"]*)"/);
  if (!m) return null;
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

test('F37a: bez etykiet zero zmian — data-tip tylko przy label, po zdjęciu atrybutu wyjścia identyczne', () => {
  const rows = lineRows(36);
  const plain = chartSVG(rows, LINE_DEFS);
  assertTrue(!plain.includes('data-tip'), 'bez label brak atrybutu (linie)');
  const labeled = chartSVG(rows, LINE_DEFS_L);
  assertTrue(labeled.includes('data-tip'), 'z label atrybut jest');
  assertEq(labeled.replace(/ data-tip="[^"]*"/, ''), plain, 'poza atrybutem wyjście bajt-w-bajt');
  const bplain = stackedBarSVG(barRows(20), BAR_SEGS);
  assertTrue(!bplain.includes('data-tip'), 'bez label brak atrybutu (słupki)');
  assertEq(stackedBarSVG(barRows(20), BAR_SEGS_L).replace(/ data-tip="[^"]*"/, ''), bplain, 'słupki: poza atrybutem identyczne');
});

test('F37b: payload liniowy — geometria pola rysunku, etykiety YYYY-MM, wartości do grosza w kolejności defs', () => {
  const tip = tipOf(chartSVG(lineRows(36), LINE_DEFS_L));
  assertEq(tip.kind, 'line', 'kind');
  assertEq(tip.x0, 48, 'x0 = padL');
  assertEq(tip.x1, 432, 'x1 = W − padR');
  assertEq(tip.y0, 10, 'y0 = padT');
  assertEq(tip.y1, 150, 'y1 = H − padB');
  assertEq(tip.labels.length, 36, '36 punktów bez decymacji');
  assertEq(tip.labels[0], '2026-01', 'pierwsza etykieta = ym pierwszego rzędu');
  assertEq(tip.series.map(s => s.label).join(','), 'portfel,cel', 'kolejność serii = kolejność defs');
  assertEq(tip.series[0].v[7], 70000, 'v[i] = get(r) (a = i·10 000)');
  assertEq(tip.series[1].v[7], 35000, 'v[i] = get(r) (b = i·5 000)');
  const frac = tipOf(chartSVG([{ ym: '2026-01', a: 1234.5678, b: 0 }], LINE_DEFS_L));
  assertEq(frac.series[0].v[0], 1234.57, 'zaokrąglenie do grosza');
});

test('F37c: decymacja — payload ma dokładnie te punkty, które narysowano', () => {
  const svg = chartSVG(lineRows(500), [{ get: r => r.a, cls: 'line-port', label: 'a' }], { maxPoints: 240 });
  const pts = svg.match(/points="([^"]+)"/)[1].split(' ');
  const tip = tipOf(svg);
  assertEq(tip.labels.length, pts.length, 'labels i polyline z tych samych pts');
  assertEq(tip.series[0].v.length, pts.length, 'v wyrównane z labels');
  assertEq(tip.labels[tip.labels.length - 1], lineRows(500)[499].ym, 'ostatni rząd zachowany');
});

test('F37d: payload słupkowy — lata jako etykiety, ujemne segmenty zaciśnięte do 0 jak na rysunku', () => {
  const rows = barRows(20);
  rows[3].interest = -700; // rysunek pomija ujemne — payload musi też
  const tip = tipOf(stackedBarSVG(rows, BAR_SEGS_L));
  assertEq(tip.kind, 'bars', 'kind');
  assertEq(tip.labels.length, 20, '20 słupków');
  assertEq(tip.labels[0], 2026, 'etykiety = lata (liczby)');
  assertEq(tip.series[1].v[3], 0, 'ujemny segment → 0 (jak narysowano)');
  assertEq(tip.series[0].v[3], 1300, 'sąsiedni segment bez zmian');
});

test('F37e: tipHit linie — najbliższy punkt siatki, zaciski na krańcach, n=1', () => {
  const tip = { kind: 'line', x0: 48, x1: 432, y0: 10, y1: 150, labels: ['a', 'b', 'c', 'd', 'e'], series: [] };
  const step = (432 - 48) / 4;
  assertEq(tipHit(tip, 48).i, 0, 'vx = x0 → i 0');
  assertEq(tipHit(tip, 0).i, 0, 'vx < x0 → zacisk 0');
  assertEq(tipHit(tip, 9999).i, 4, 'vx > x1 → zacisk n−1');
  assertEq(tipHit(tip, 48 + step * 1.4).i, 1, '1,4 kroku → punkt 1');
  assertEq(tipHit(tip, 48 + step * 1.6).i, 2, '1,6 kroku → punkt 2');
  assertClose(tipHit(tip, 48 + step * 1.6).cx, 48 + 2 * step, 1e-9, 'cx = x(i) buildera');
  const one = tipHit({ ...tip, labels: ['x'] }, 240);
  assertEq(one.i, 0, 'n=1 → i 0');
  assertEq(one.cx, 48, 'n=1 → cx = x0 (jak pojedynczy punkt chartSVG)');
});

test('F37f: tipHit słupki — slot z floor, środek slotu, zaciski; pusty/zepsuty payload → null', () => {
  const tip = { kind: 'bars', x0: 48, x1: 432, y0: 10, y1: 150, labels: [2026, 2027, 2028, 2029], series: [] };
  const slot = (432 - 48) / 4;
  assertEq(tipHit(tip, 48 + slot * 0.99).i, 0, 'tuż przed granicą slotu → 0');
  assertEq(tipHit(tip, 48 + slot * 1.01).i, 1, 'tuż za granicą → 1');
  assertEq(tipHit(tip, -50).i, 0, 'zacisk lewy');
  assertEq(tipHit(tip, 5000).i, 3, 'zacisk prawy');
  assertClose(tipHit(tip, 48 + slot * 2.5).cx, 48 + slot * 2.5, 1e-9, 'cx = środek slotu');
  assertEq(tipHit({ ...tip, labels: [] }, 100), null, 'puste labels → null');
  assertEq(tipHit(null, 100), null, 'null → null');
  assertEq(tipHit({}, 100), null, 'obiekt bez labels → null');
});

test('F37g: czystość i higiena — determinizm, zero NaN, esc płaszczyzny atrybutu odwracalne', () => {
  const rows = lineRows(36);
  assertEq(chartSVG(rows, LINE_DEFS_L), chartSVG(rows, LINE_DEFS_L), 'dwa wywołania identyczne');
  const svg = chartSVG(rows, LINE_DEFS_L);
  assertTrue(!/NaN/.test(svg), 'zero NaN');
  assertTrue(svg.includes('&quot;'), 'cudzysłowy JSON-a zescape\'owane w atrybucie');
  const withQuote = chartSVG(rows, [{ get: r => r.a, cls: 'line-port', label: 'z "cudzysłowem" & <znakami>' }]);
  assertEq(tipOf(withQuote).series[0].label, 'z "cudzysłowem" & <znakami>', 'round-trip esc → JSON.parse');
});

// ── F38: pasmo prognozy — projectionBand + stopAtFire (D9) ────────────────
// Deterministyczna koperta ±spread na realReturnAnnual. Wspólna baza replayów
// (historia sald zależy od realReturnAnnual — naiwny rerun projectionWith
// fałszywie rozjechałby pasmo na przeszłości; F38b to egzekwuje). Wielokąt
// w charts.js (def {band:true}) — geometria pod F38e.

test('F38: BAND_SPREAD przypięty do fixture (kopia w legendzie ui.js idzie razem z nim)', () => {
  assertEq(E.BAND_SPREAD, FIX.F38.spread, 'stała silnika = fixture');
});

test('F38a: stopAtFire:false — ta sama data FIRE, seria biegnie do końca planu, prefiks identyczny', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const base = E.projectionWith(st, {}, NOW);
  const full = E.projectionWith(st, { stopAtFire: false }, NOW);
  assertEq(full.reached, true, 'reached');
  assertEq(full.fireYm, base.fireYm, 'fireYm identyczny');
  assertEq(full.fireAge.totalMonths, base.fireAge.totalMonths, 'fireAge identyczny');
  assertTrue(full.series.length > base.series.length, 'seria pełna dłuższa niż ucięta na FIRE');
  assertEq(full.series[full.series.length - 1].ym, E.addMonths(st.anchorMonth, E.HORIZON_MONTHS - 1),
    'ostatni wiersz = koniec 720-miesięcznego planu');
  for (const i of [0, Math.floor(base.series.length / 2), base.series.length - 1]) {
    assertEq(JSON.stringify(full.series[i]), JSON.stringify(base.series[i]), `prefiks identyczny (i=${i})`);
  }
  const explicit = E.projectionWith(st, { stopAtFire: true }, NOW);
  assertEq(JSON.stringify(explicit), JSON.stringify(base), 'jawne stopAtFire:true ≡ domyślne');
});

test('F38b: pasmo wyrównane z serią; historia lo === hi === fakt (wspólna baza replayów)', () => {
  // Wpis tylko w 2026-01 → miesiące 02–06 to historia rosnąca wg realReturnAnnual;
  // naiwny rerun wariantami rozjechałby tu lo/hi — strikte równości to łapią.
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  st.entries.push(entry('2026-01', 10000, 6000, { plannedSavingsSnapshot: 4000 }));
  E.recomputeDerived(st, NOW);
  const full = E.projectionWith(st, { stopAtFire: false }, NOW);
  const band = E.projectionBand(st, {}, NOW);
  assertEq(band.spread, E.BAND_SPREAD, 'domyślny spread');
  assertEq(band.rows.length, full.series.length, 'pasmo pokrywa pełną serię');
  for (const i of [0, 5, Math.floor(full.series.length / 2), full.series.length - 1]) {
    assertEq(band.rows[i].ym, full.series[i].ym, `ym wyrównany (i=${i})`);
  }
  let histSeen = 0;
  band.rows.forEach((b, i) => {
    assertTrue(b.hi >= b.lo, `hi ≥ lo (${b.ym})`);
    if (full.series[i].projected === false) {
      histSeen++;
      assertEq(b.lo, full.series[i].portfolio, `historia lo === fakt (${b.ym})`);
      assertEq(b.hi, full.series[i].portfolio, `historia hi === fakt (${b.ym})`);
    }
  });
  assertTrue(histSeen >= 6, `test ma realną historię (${histSeen} wierszy)`);
});

test('F38c: koperta — na prognozie lo ≤ portfel(stopa użytkownika) ≤ hi', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  E.recomputeDerived(st, NOW);
  const full = E.projectionWith(st, { stopAtFire: false }, NOW);
  const band = E.projectionBand(st, {}, NOW);
  band.rows.forEach((b, i) => {
    if (!full.series[i].projected) return;
    assertTrue(b.lo <= full.series[i].portfolio + 1e-9, `lo ≤ portfel (${b.ym})`);
    assertTrue(b.hi >= full.series[i].portfolio - 1e-9, `hi ≥ portfel (${b.ym})`);
  });
});

test('F38d: krawędzie i czystość — spread 0 zwija pasmo; stan nietknięty; determinizm', () => {
  const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 1000000 } });
  st.entries.push(entry('2026-01', 10000, 6000, { plannedSavingsSnapshot: 4000 }));
  E.recomputeDerived(st, NOW);
  const zero = E.projectionBand(st, { spread: 0 }, NOW);
  zero.rows.forEach(b => assertEq(b.hi, b.lo, `spread 0 → hi === lo (${b.ym})`));
  const before = JSON.stringify(st);
  const b1 = E.projectionBand(st, {}, NOW);
  assertEq(JSON.stringify(st), before, 'czystość (wzorzec F15a)');
  assertEq(JSON.stringify(E.projectionBand(st, {}, NOW)), JSON.stringify(b1), 'dwa wywołania identyczne');
});

test('F38e: chartSVG def {band:true} — wielokąt za liniami, skala z hi, bez label brak w data-tip', () => {
  const base = E.ymToIdx('2026-01');
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push({
    ym: E.idxToYm(base + i), a: 1000 + i * 100,
    lo: 900 + i * 80, hi: 1100 + i * 130,
  });
  const defs = [
    { band: true, lo: r => r.lo, hi: r => r.hi, cls: 'band-return' },
    { get: r => r.a, cls: 'line-port', label: 'portfel' },
  ];
  const svg = chartSVG(rows, defs);
  const polyIdx = svg.indexOf('<polygon class="band-return"');
  assertTrue(polyIdx >= 0, 'wielokąt pasma obecny');
  assertTrue(polyIdx < svg.indexOf('<polyline'), 'pasmo rysowane przed linią (tło)');
  const ptsAttr = svg.match(/<polygon[^>]*points="([^"]+)"/)[1].split(' ');
  assertEq(ptsAttr.length, 24, '12 punktów hi (w przód) + 12 lo (wstecz)');
  const maxHi = 1100 + 11 * 130; // 2530 > max a — skala musi objąć hi
  assertTrue(svg.includes(`>${fmtShort(maxHi)}</text>`), 'etykieta Y = max z hi');
  const tip = tipOf(svg);
  assertEq(tip.series.length, 1, 'pasmo (bez label) nieobecne w odczycie');
  assertEq(tip.series[0].label, 'portfel', 'seria liniowa w odczycie');
  // Wiersze bez skończonych lo/hi wypadają z wielokąta, a < 2 punktów → brak.
  const sparse = rows.map((r, i) => i < 11 ? { ...r, lo: undefined, hi: undefined } : r);
  assertTrue(!chartSVG(sparse, defs).includes('<polygon'), '≤1 użyteczny punkt → bez wielokąta');
});

// ── F39: test krachu (ryzyko sekwencji zwrotów) ───────────────────────────
// Deterministyczny szok {year, pct} w projectWithdrawal + stressTestRetirement
// (bez losowania, D2: crash płynie przez retirementOpts/opts, nic nie
// zapisujemy). Plan: docs/plan-crash-stress-test.md (tam „F31" — zajęte
// przez IKE/IKZE → F39). Wartości oczekiwane z niezależnej rekurencji w teście:
// P ← (P − W₁)·(1+r), szok mnoży P ×(1−pct) na starcie roku k, przed wypłatą.

test('F39a: projectWithdrawal — mechanika krachu (tożsamość roku 1, prefiks do szoku, brak = bez zmian)', () => {
  const f = FIX.F39;
  const st = baseState();
  const common = { startYm: f.startYm, startPortfolioReal: f.start, withdrawalRealYearly: f.wYear, years: 10 };
  const base = E.projectWithdrawal(st, common);
  // Krach w roku 1 ≡ przebieg bez krachu od kapitału ×0,7 (poza flagą crashed).
  const c1 = E.projectWithdrawal(st, { ...common, crash: { year: 1, pct: f.shockPct } });
  const c1ref = E.projectWithdrawal(st, { ...common, startPortfolioReal: f.start * (1 - f.shockPct) });
  assertEq(c1.rows.length, c1ref.rows.length, 'ta sama długość przebiegu');
  c1.rows.forEach((r, i) => {
    const { crashed: _a, ...rest } = r;
    const { crashed: _b, ...ref } = c1ref.rows[i];
    assertEq(JSON.stringify(rest), JSON.stringify(ref), `rok ${i + 1} identyczny poza flagą`);
  });
  assertEq(c1.rows[0].crashed, true, 'rok 1 oflagowany');
  assertEq(c1.crashApplied, true, 'crashApplied');
  // Krach w roku 3: prefiks 1–2 bajt-w-bajt z bazą, potem start = end₂ × 0,7.
  const c3 = E.projectWithdrawal(st, { ...common, crash: { year: 3, pct: f.shockPct } });
  assertEq(JSON.stringify(c3.rows.slice(0, 2)), JSON.stringify(base.rows.slice(0, 2)), 'lata przed szokiem nietknięte');
  assertEq(c3.rows[2].crashed, true, 'rok szoku oflagowany');
  assertClose(c3.rows[2].startReal, base.rows[1].endReal * (1 - f.shockPct), 1e-6, 'start roku 3 = end roku 2 × 0,7');
  // Bez krachu: każda flaga false, crashApplied false (ścieżka jak dotąd —
  // liczby F13/F27 pilnują wartości).
  assertTrue(base.rows.every(r => r.crashed === false), 'bez krachu flagi false');
  assertEq(base.crashApplied, false, 'crashApplied false');
});

test('F39b: stressTestRetirement — szok 0 ≡ baza, determinizm, czystość', () => {
  const f = FIX.F39;
  const st = baseState();
  const opts = { startYm: f.startYm, startPortfolioReal: f.start, withdrawalRealYearly: f.wYear, deathAge: f.deathAge };
  const zero = E.stressTestRetirement(st, { ...opts, shockPct: 0 });
  zero.scenarios.forEach(s => {
    assertEq(s.survives, zero.base.survives, `szok 0 (rok ${s.shockYear}): survives = baza`);
    assertEq(s.depletedYear, zero.base.depletedYear, 'depletedYear = baza');
    assertClose(s.endReal, zero.base.endReal, 1e-9, 'endReal = baza');
  });
  const before = JSON.stringify(st);
  const r1 = E.stressTestRetirement(st, { ...opts, shockPct: f.shockPct });
  assertEq(JSON.stringify(st), before, 'czystość (wzorzec F15a)');
  assertEq(JSON.stringify(E.stressTestRetirement(st, { ...opts, shockPct: f.shockPct })), JSON.stringify(r1), 'dwa wywołania identyczne');
});

test('F39c: ryzyko sekwencji — baza przeżywa, krach w roku 1 boli bardziej niż w roku 10', () => {
  const f = FIX.F39;
  const st = baseState();
  const r = st.assumptions.postRetirementReturnReal; // 5% — mrożenie włączone, wypłaty płaskie realnie
  const res = E.stressTestRetirement(st, {
    startYm: f.startYm, startPortfolioReal: f.start, withdrawalRealYearly: f.wYear,
    deathAge: f.deathAge, shockPct: f.shockPct, shockYears: f.years,
  });
  assertEq(res.horizonYears, f.deathAge - res.startAge, 'horyzont = deathAge − wiek startowy');
  assertEq(res.base.survives, true, 'baza przeżywa (1,8M > równowagi 1 512 000)');
  // Niezależna rekurencja: rok n → P ← (P − W₁)·(1+r); szok ×(1−pct) na starcie roku k.
  const depletion = shockYear => {
    let P = f.start;
    for (let n = 1; n <= res.horizonYears; n++) {
      if (n === shockYear) P *= (1 - f.shockPct);
      P = (P - f.wYear) * (1 + r);
      if (P <= 0.005) return n;
    }
    return null;
  };
  const s1 = res.scenarios.find(s => s.shockYear === 1);
  const s10 = res.scenarios.find(s => s.shockYear === 10);
  assertEq(s1.survives, false, 'krach w roku 1 → wyczerpanie');
  assertEq(s1.depletedYear, depletion(1), 'rok wyczerpania = rekurencja niezależna (szok w 1.)');
  assertEq(s10.depletedYear, depletion(10), 'rok wyczerpania = rekurencja niezależna (szok w 10.)');
  assertTrue(s10.depletedYear == null || s10.depletedYear > s1.depletedYear, 'ten sam krach 10 lat później → później albo wcale');
  assertEq(s1.depletedAge, res.startAge + s1.depletedYear - 1, 'wiek wyczerpania (szok 1)');
  assertEq(s10.depletedAge, res.startAge + s10.depletedYear - 1, 'wiek wyczerpania (szok 10)');
});

test('F39d: horyzont i strażnicy — filtr lat szoku, brak profilu, clamp, hypothetical', () => {
  const f = FIX.F39;
  const st = baseState();
  const opts = { startYm: f.startYm, startPortfolioReal: f.start, withdrawalRealYearly: f.wYear, deathAge: f.deathAge };
  const filtered = E.stressTestRetirement(st, { ...opts, shockYears: [1, 999] });
  assertEq(filtered.scenarios.length, 1, 'rok poza horyzontem odfiltrowany');
  assertEq(filtered.scenarios[0].shockYear, 1, 'został tylko rok 1');
  const noBirth = baseState({ profile: { birthDate: null } });
  assertEq(E.stressTestRetirement(noBirth, opts), null, 'bez daty urodzenia → null');
  const clamp = E.stressTestRetirement(st, { ...opts, deathAge: 10 });
  assertEq(clamp.horizonYears, 1, 'deathAge ≤ wiek startowy → horyzont 1 (clamp)');
  assertEq(E.stressTestRetirement(st, opts).hypothetical, true, 'bez osiągniętej prognozy → hypothetical');
  const withProj = E.stressTestRetirement(st, {
    ...opts, startYm: undefined,
    projection: { reached: true, fireYm: f.startYm, series: [] },
  });
  assertEq(withProj.hypothetical, false, 'osiągnięta prognoza → nie-hipotetyczny');
  assertEq(withProj.startYm, f.startYm, 'startYm = fireYm prognozy');
});

// ── F40: eksport CSV historii check-inów (Excel pl-PL) ────────────────────
// Dialekt sam w sobie jest specyfikacją: średniki, przecinek dziesiętny bez
// grupowania (dwa miejsca), BOM UTF-8, CRLF bez końcowego, cytowanie RFC 4180.
// Kolumny pochodne z state.derived po ym (bez derived → puste); verdictLabel
// wstrzykiwany. Plan: docs/plan-csv-export-entries.md (tam „F30" — zajęte
// przez Belkę → F40; kolumna „Notatka" doszła z notatkami z fazy 4 — na końcu,
// żeby nie ruszać indeksów istniejących kolumn).

const CSV_HEADER = 'Miesiąc;Zarobione;Wydane;Oszczędności;Plan oszczędności;'
  + 'Różnica vs plan;Werdykt;Werdykt (opis);Nadpłata kredytu;Nadpłata długu rodzinnego;'
  + 'Korekta gotówki;Korekta portfela;Gotówka po miesiącu;Portfel po miesiącu;Faza;'
  + 'Kredyt — saldo (nominalnie);Dług rodzinny — saldo (nominalnie);Utworzono;Zaktualizowano;Notatka';
const csvNumT = x => Number(x).toFixed(2).replace('.', ',');

test('F40a: dokładna serializacja — BOM, nagłówek, CRLF bez końcowego, przecinek dziesiętny, derived po ym', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-01', 10000, 6000, { snapshot: 4000 }));
  st.entries.push(entry('2026-02', 9000.5, 7500.25, {
    snapshot: 4000, verdict: 'behind', overpayment: 300, familyOverpayment: 150,
    cashOverride: 1000, balanceOverride: 50000, updatedAt: '2026-03-02T10:00:00.000Z',
    note: 'Premia roczna',
  }));
  E.recomputeDerived(st, NOW);
  const labels = { on_plan: 'W planie', behind: 'Lekko pod planem' };
  const csv = S.entriesCSV(st, { verdictLabel: v => labels[v] || v });
  assertEq(csv[0], '\uFEFF', 'BOM na początku');
  assertTrue(!csv.endsWith('\r\n'), 'bez końcowego CRLF');
  const lines = csv.slice(1).split('\r\n');
  assertEq(lines.length, 3, 'nagłówek + 2 wpisy');
  assertEq(lines[0], CSV_HEADER, 'nagłówek co do bajta');
  const bal = m => st.derived.balances.rows.find(r => r.ym === m);
  const b1 = bal('2026-01'), b2 = bal('2026-02');
  assertEq(lines[1], ['2026-01', '10000,00', '6000,00', '4000,00', '4000,00', '0,00',
    'on_plan', 'W planie', '0,00', '0,00', '', '',
    csvNumT(b1.cash), csvNumT(b1.portfolio), b1.phase, '', '',
    '2026-01-01T00:00:00.000Z', '', ''].join(';'), 'wiersz 1 co do bajta (bez notatki: pusta komórka)');
  assertEq(lines[2], ['2026-02', '9000,50', '7500,25', '1500,25', '4000,00', '-2499,75',
    'behind', 'Lekko pod planem', '300,00', '150,00', '1000,00', '50000,00',
    csvNumT(b2.cash), csvNumT(b2.portfolio), b2.phase, '', '',
    '2026-01-01T00:00:00.000Z', '2026-03-02T10:00:00.000Z', 'Premia roczna'].join(';'), 'wiersz 2 co do bajta');
});

test('F40b: cytowanie RFC 4180 — średnik/cudzysłów/nowa linia w komórce', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-01', 10000, 6000));
  E.recomputeDerived(st, NOW);
  const csv = S.entriesCSV(st, { verdictLabel: () => 'W "planie"; test' });
  assertTrue(csv.includes(';"W ""planie""; test";'), 'komórka opakowana, cudzysłowy podwojone');
  const row = csv.slice(1).split('\r\n')[1];
  const quoted = row.match(/"([^"]|"")*"/g);
  assertEq(quoted.length, 1, 'jedna komórka cytowana');
  assertEq(row.replace(/"([^"]|"")*"/g, 'X').split(';').length, 20, '20 pól mimo średnika w treści');
  const nl = S.entriesCSV(st, { verdictLabel: () => 'a\nb' });
  assertTrue(nl.includes(';"a\nb";'), 'nowa linia w komórce → cytowanie');
  // Notatka ze średnikiem/cudzysłowem → cytowana RFC 4180 (ostatnia kolumna).
  const st2 = baseState({ anchorMonth: '2026-01' });
  st2.entries.push(entry('2026-01', 10000, 6000, { note: 'urlop; "all inclusive"' }));
  E.recomputeDerived(st2, NOW);
  const row2 = S.entriesCSV(st2).slice(1).split('\r\n')[1];
  assertTrue(row2.endsWith(';"urlop; ""all inclusive"""'), 'notatka cytowana, cudzysłowy podwojone');
});

test('F40c: puste komórki — brak derived, miesiąc sprzed kotwicy, brak kredytu; kredyt wypełnia saldo', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-01', 10000, 6000));
  E.recomputeDerived(st, NOW);
  const stripped = { ...st };
  delete stripped.derived;
  const row = S.entriesCSV(stripped).slice(1).split('\r\n')[1].split(';');
  assertEq(row.slice(12, 17).join('|'), '||||', 'bez derived kolumny 13–17 puste');
  assertEq(row[1], '10000,00', 'kolumny wpisu nietknięte');
  // Wpis sprzed kotwicy (historia po reanchor w przód): saldo/faza puste.
  const st2 = baseState({ anchorMonth: '2026-03' });
  st2.entries.push(entry('2026-01', 10000, 6000));
  st2.entries.push(entry('2026-03', 10000, 6000));
  E.recomputeDerived(st2, NOW);
  const rows2 = S.entriesCSV(st2).slice(1).split('\r\n');
  assertEq(rows2[1].split(';').slice(12, 15).join('|'), '||', 'miesiąc sprzed kotwicy: 13–15 puste');
  assertTrue(rows2[2].split(';')[12] !== '', 'miesiąc od kotwicy: gotówka wypełniona');
  // Aktywny kredyt: kolumna 16 niesie saldo nominalne z repliki długu.
  const st3 = baseState({
    anchorMonth: '2026-01',
    housing: { housePlan: housePlan({ moveInMonth: '2026-01', mortgage: { startMonth: '2026-01' } }) },
  });
  st3.entries.push(entry('2026-02', 10000, 6000));
  E.recomputeDerived(st3, NOW);
  const row3 = S.entriesCSV(st3).slice(1).split('\r\n')[1].split(';');
  const debtRow = st3.derived.debt.rows.find(r => r.ym === '2026-02');
  assertEq(row3[15], csvNumT(debtRow.balNominal), 'saldo kredytu z repliki (nominalnie)');
});

test('F40d: sortowanie rosnąco po miesiącu + czystość stanu', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-03', 1000, 500));
  st.entries.push(entry('2026-01', 1000, 500));
  st.entries.push(entry('2026-02', 1000, 500));
  E.recomputeDerived(st, NOW);
  const before = JSON.stringify(st);
  const months = S.entriesCSV(st).slice(1).split('\r\n').slice(1).map(r => r.split(';')[0]);
  assertEq(months.join(','), '2026-01,2026-02,2026-03', 'wyjście rosnąco');
  assertEq(st.entries[0].month, '2026-03', 'tablica wejściowa nieposortowana (kopia)');
  assertEq(JSON.stringify(st), before, 'czystość — stan (z derived) nietknięty');
});

test('F40e: pusta historia → dokładnie BOM + nagłówek', () => {
  const st = baseState();
  E.recomputeDerived(st, NOW);
  assertEq(S.entriesCSV(st), '\uFEFF' + CSV_HEADER, 'tylko nagłówek');
});

test('F40f: domyślne opcje — opis = surowy klucz; zero i ujemne kwoty w dialekcie', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  st.entries.push(entry('2026-01', 5000, 6500.75, { verdict: 'hard' }));
  E.recomputeDerived(st, NOW);
  const row = S.entriesCSV(st).slice(1).split('\r\n')[1].split(';');
  assertEq(row[6], 'hard', 'surowy klucz');
  assertEq(row[7], 'hard', 'bez opcji opis = klucz');
  assertEq(row[3], '-1500,75', 'ujemne oszczędności z minusem');
  assertEq(row[8], '0,00', 'zero jako 0,00');
});

// ── F42: notatki check-inów (note) — schemat v7 ───────────────────────────
// Notatka jest obojętna dla matematyki; trim/cięcie do 200 znaków przy zapisie;
// migracja v6→v7 stempluje note: null. Plan: docs/plan-checkin-notes.md
// (roadmap mówił „v6" — zajęte przez IKE/IKZE → v7; grupa F42).

test('F42a: applyCheckIn — trim, pusta → null, cięcie do 200, edycja odświeża', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  const e1 = E.applyCheckIn(st, { month: '2026-01', earned: 8000, spent: 5000, note: '  Premia  ' }, NOW);
  assertEq(e1.note, 'Premia', 'trim z brzegów');
  const e2 = E.applyCheckIn(st, { month: '2026-02', earned: 8000, spent: 5000, note: '   ' }, NOW);
  assertEq(e2.note, null, 'sama biel → null');
  const e3 = E.applyCheckIn(st, { month: '2026-03', earned: 8000, spent: 5000 }, NOW);
  assertEq(e3.note, null, 'brak pola → null');
  const e4 = E.applyCheckIn(st, { month: '2026-04', earned: 8000, spent: 5000, note: 'x'.repeat(250) }, NOW);
  assertEq(e4.note.length, 200, 'twarde cięcie do 200 znaków');
  // Edycja wpisu nadpisuje notatkę (także z powrotem na null).
  const e5 = E.applyCheckIn(st, { month: '2026-01', earned: 8000, spent: 5000, note: 'Po edycji' }, NOW);
  assertEq(e5.note, 'Po edycji', 'edycja odświeża notatkę');
  const e6 = E.applyCheckIn(st, { month: '2026-01', earned: 8000, spent: 5000 }, NOW);
  assertEq(e6.note, null, 'edycja bez notatki czyści ją');
});

test('F42b: notatka obojętna dla matematyki — derived bit-w-bit identyczne', () => {
  const mk = note => {
    const st = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 50000 } });
    E.applyCheckIn(st, { month: '2026-01', earned: 9000, spent: 6000, note }, NOW);
    E.applyCheckIn(st, { month: '2026-02', earned: 7000, spent: 8000, note }, NOW);
    return JSON.stringify(st.derived);
  };
  assertEq(mk('Notatka <b>xss</b>; "cudzysłów"'), mk(null), 'derived identyczne z notatką i bez');
});

test('F42c: migracja v6→v7 stempluje note: null; walidacja odrzuca nie-string', () => {
  const st = baseState();
  const v6 = JSON.parse(JSON.stringify(st));
  v6.version = 6;
  v6.entries = [entry('2026-07', 8000, 5000), entry('2026-08', 8000, 5000, { note: 'zostaje' })];
  const m = S.migrate(S.validateState(v6));
  assertEq(m.version, S.SCHEMA_VERSION, 'v6 migruje do najnowszej');
  assertEq(m.entries[0].note, null, 'brakujące pole dostemplowane jako null');
  assertEq(m.entries[1].note, 'zostaje', 'jawna notatka nietknięta');
  // validateState: note nie-string → odrzucona; null/string przechodzą.
  const bad = baseState();
  bad.entries.push(entry('2026-07', 8000, 5000, { note: 42 }));
  assertThrows(() => S.validateState(bad), 'note liczbowa odrzucona');
  const ok = baseState();
  ok.entries.push(entry('2026-07', 8000, 5000, { note: null }));
  ok.entries.push(entry('2026-08', 8000, 5000, { note: 'ok' }));
  assertEq(S.validateState(ok).version, S.SCHEMA_VERSION, 'null i string przechodzą');
});

// ── F43: historia oszczędzania miesiąc po miesiącu (monthlySavingsHistory) ─
// Wykres na górze Historii: realnie odłożone vs zamrożony plan. Plan:
// docs/plan-savings-history-chart.md (tam „F30" — zajęte przez Belkę → F43).

test('F43a: mapowanie i sortowanie rosnąco po ym', () => {
  const entries = [
    entry('2026-03', 9000, 5500, { snapshot: 4000, verdict: 'behind' }),
    entry('2026-01', 10000, 6000, { snapshot: 4000, verdict: 'on_plan' }),
    entry('2026-02', 12000, 5000, { snapshot: 4000, verdict: 'crushed' }),
  ];
  const h = E.monthlySavingsHistory(entries);
  assertEq(h.map(r => r.ym).join(','), '2026-01,2026-02,2026-03', 'rosnąco po ym');
  assertClose(h[0].net, 4000, 0.005); assertClose(h[1].net, 7000, 0.005); assertClose(h[2].net, 3500, 0.005);
  assertEq(h[1].planned, 4000, 'planned = snapshot bez przeliczeń');
  assertEq(h[2].verdict, 'behind', 'verdict przechodzi 1:1');
  assertClose(h[2].delta, -500, 0.005, 'delta = net − planned');
});

test('F43b: rate — null przy zerowym dochodzie, ułamek przy dodatnim', () => {
  const h = E.monthlySavingsHistory([
    entry('2026-01', 0, 500, { snapshot: 0 }),
    entry('2026-02', 8000, 6000, { snapshot: 0 }),
  ]);
  assertEq(h[0].rate, null, 'earned 0 → rate null');
  assertClose(h[1].rate, 0.25, 1e-9, '(8000−6000)/8000');
});

test('F43c: miesiąc budowy — ujemny zamrożony plan i ujemny net', () => {
  // Kredyt F3 (rata ≈ 9755,8) aktywny od kotwicy → plan mocno ujemny.
  const st = baseState({
    anchorMonth: '2026-01',
    housing: {
      currentRentMonthly: 2000,
      housePlan: housePlan({
        moveInMonth: '2027-01',
        mortgage: { startMonth: '2026-01', principal: 1100000, rateNominal: 0.07, termYears: 15 },
      }),
    },
  });
  const e = E.applyCheckIn(st, { month: '2026-03', earned: 8000, spent: 12000 }, NOW);
  assertTrue(e.plannedSavingsSnapshot < 0, 'zamrożony plan ujemny (rok budowy)');
  const h = E.monthlySavingsHistory(st.entries);
  assertClose(h[0].net, -4000, 0.005, 'net ujemny');
  assertEq(h[0].planned, e.plannedSavingsSnapshot, 'planned = snapshot z wpisu');
  assertClose(h[0].delta, -4000 - e.plannedSavingsSnapshot, 0.005, 'delta domyka tożsamość');
});

test('F43d: czystość — wejście nietknięte, dwa wywołania identyczne, [] → []', () => {
  const entries = [
    entry('2026-02', 9000, 5000, { snapshot: 4000 }),
    entry('2026-01', 10000, 6000, { snapshot: 4000 }),
  ];
  const before = JSON.stringify(entries);
  const h1 = E.monthlySavingsHistory(entries);
  assertEq(JSON.stringify(entries), before, 'wejście nieposortowane/niezmutowane');
  assertEq(JSON.stringify(E.monthlySavingsHistory(entries)), JSON.stringify(h1), 'determinizm');
  assertEq(E.monthlySavingsHistory([]).length, 0, 'pusta historia → pusta tablica');
});

test('F43e: zamrożony snapshot — zmiana założeń nie przepisuje wykresu', () => {
  const st = baseState({ anchorMonth: '2026-01' });
  E.applyCheckIn(st, { month: '2026-01', earned: 10000, spent: 6000 }, NOW);
  const frozen = st.entries[0].plannedSavingsSnapshot;
  st.assumptions.monthlyIncome = 20000;
  E.recomputeDerived(st, NOW);
  const h = E.monthlySavingsHistory(st.entries);
  assertEq(h[0].planned, frozen, 'planned = snapshot sprzed zmiany założeń');
});

// ── F44: kamienie milowe z celebracją (milestoneStatus/newMilestones) ──────
// Celebracja tylko przy przekroczeniu (false→true wokół zapisu check-inu) i
// tylko raz (state.ui.milestonesSeen, schemat v8). Plan:
// docs/plan-milestones-celebration.md (tam „F30"/v5 — zajęte → F44/v8).

const NO_LOAN = () => ({ started: false, paidPct: 0, balanceNominal: 0 });

test('F44a: milestoneStatus — progi FI% (z EPS), port100k, cel zdegenerowany', () => {
  const st = baseState();
  const upto = '2026-06';
  const target = E.fireTargetAt(st, upto);
  assertTrue(target > 0, 'cel dodatni w fixture');
  const at = p => E.milestoneStatus(st, { portfolio: p }, NO_LOAN(), NO_LOAN(), upto);
  assertEq(at(0.10 * target - 1).fi10, false, 'tuż pod 10% → false');
  assertEq(at(0.10 * target - E.EPS / 2).fi10, true, '10% − EPS/2 → true (tolerancja)');
  const q25 = at(0.25 * target);
  assertEq(q25.fi25, true, '25% → fi25');
  assertEq(q25.fi50, false, '25% → fi50 false');
  const full = at(target);
  for (const k of ['fi10', 'fi25', 'fi50', 'fi75', 'fi100']) assertEq(full[k], true, `${k} przy pełnym celu`);
  assertEq(at(99999.98).port100k, false, '99 999,98 → false');
  assertEq(at(100000).port100k, true, '100 000 → true');
  // Cel 0 (zerowe wydatki) → żaden próg FI% nie jest „osiągnięty", zero dzielenia.
  const zero = baseState({ assumptions: { monthlyLivingExpenses: 0 } });
  const z = E.milestoneStatus(zero, { portfolio: 1e9 }, NO_LOAN(), NO_LOAN(), upto);
  for (const k of ['fi10', 'fi25', 'fi50', 'fi75', 'fi100']) assertEq(z[k], false, `${k} przy celu 0`);
});

test('F44b: newMilestones — przekroczenie, seen, priorytet, odporność', () => {
  const before = { fi10: true, fi25: false, fi50: false, fi75: false, fi100: false, port100k: false, mortgageHalf: false, mortgageDone: false, familyDone: false };
  const after = { ...before, fi25: true, port100k: true };
  assertEq(E.newMilestones(before, after).join(','), 'fi25,port100k', 'kolejność wg MILESTONES_ORDER');
  assertEq(E.newMilestones(before, after, ['fi25']).join(','), 'port100k', 'obejrzane pomijane');
  assertEq(E.newMilestones(before, after, null).join(','), 'fi25,port100k', 'seen=null bezpieczne');
  assertEq(E.newMilestones(before, after, 'oops').join(','), 'fi25,port100k', 'seen nie-tablica bezpieczne');
  assertEq(E.newMilestones(after, after).length, 0, 'true→true nigdy nie wraca');
});

test('F44c: kredytowe kamienie przez replay — połowa, spłata, dług rodzinny', () => {
  // Kredyt 120 000 @ 0% / 10 lat → rata 1000; rodzinny 6 000 @ 0%, okno 6 mies. → rata 1000.
  const st = baseState({
    anchorMonth: '2026-01',
    housing: {
      housePlan: housePlan({
        moveInMonth: '2026-01',
        mortgage: { startMonth: '2026-01', principal: 120000, rateNominal: 0, termYears: 10 },
        familyLoan: { enabled: true, startMonth: '2026-01', endMonth: '2026-06', principal: 6000, rateNominal: 0, paymentOverrideMonthly: null },
      }),
    },
  });
  // Nadpłata 57 000 w marcu: po 3 ratach (3 000) + nadpłacie spłacone 60 000 = 50%.
  st.entries.push(entry('2026-03', 70000, 5000, { overpayment: 57000 }));
  // Nadpłata 59 000 w maju zeruje resztę salda (60 000 − rata kwietnia i maja).
  st.entries.push(entry('2026-05', 70000, 5000, { overpayment: 59000 }));
  const stat = upto => E.milestoneStatus(st, { portfolio: 0 },
    E.replayDebt(st, upto), E.replayFamilyLoan(st, upto), upto);
  assertEq(stat('2026-02').mortgageHalf, false, 'luty: przed połową');
  assertEq(stat('2026-03').mortgageHalf, true, 'marzec: paidPct ≥ 0.5');
  assertEq(stat('2026-04').mortgageDone, false, 'kwiecień: saldo > 0');
  assertEq(stat('2026-05').mortgageDone, true, 'maj: saldo 0 po nadpłacie');
  assertEq(stat('2026-05').familyDone, false, 'maj: rodzinny jeszcze żywy');
  assertEq(stat('2026-06').familyDone, true, 'czerwiec (endMonth): rodzinny 0');
  // Stan bez kredytu: kamienie kredytowe nigdy nie strzelą (started false).
  const plain = baseState();
  const s = E.milestoneStatus(plain, { portfolio: 1e9 },
    E.replayDebt(plain, '2026-06'), E.replayFamilyLoan(plain, '2026-06'), '2026-06');
  assertEq(s.mortgageHalf || s.mortgageDone || s.familyDone, false, 'EMPTY_LOAN → false');
});

test('F44d: integracja z check-inem — przekroczenie raz, seen wycisza', () => {
  const mk = () => {
    const s = baseState({ anchorMonth: '2026-01', assumptions: { portfolioStart: 95000 } });
    E.recomputeDerived(s, NOW);
    return s;
  };
  const run = seen => {
    const s = mk();
    const d0 = s.derived;
    const before = E.milestoneStatus(s, d0.balances, d0.debt, d0.family, d0.uptoYm);
    E.applyCheckIn(s, { month: '2026-01', earned: 20000, spent: 5000 }, NOW);
    const d1 = s.derived;
    const after = E.milestoneStatus(s, d1.balances, d1.debt, d1.family, d1.uptoYm);
    return E.newMilestones(before, after, seen);
  };
  assertEq(run([]).join(','), 'port100k', 'wpłata 15 000 przekracza 100 tys.');
  assertEq(run(['port100k']).length, 0, 'obejrzany klucz nie celebruje ponownie');
});

test('F44e: milestoneMessage — tytuły/warianty per klucz, seed, nieznany klucz', () => {
  for (const key of E.MILESTONES_ORDER) {
    const texts = new Set();
    for (const seed of [0, 1]) {
      const m = milestoneMessage(key, seed);
      assertTrue(m && m.title && m.title.length > 0, `${key}: tytuł niepusty`);
      assertTrue(m.text && m.text.length > 0, `${key}: treść niepusta`);
      texts.add(m.text);
    }
    assertEq(texts.size, 2, `${key}: 2 unikalne warianty`);
    assertEq(milestoneMessage(key, 2).text, milestoneMessage(key, 0).text, `${key}: seed modulo`);
    assertEq(milestoneMessage(key, -1).title, milestoneMessage(key, 1).title, `${key}: ujemny seed bezpieczny`);
  }
  assertEq(milestoneMessage('nie-ma-takiego', 0), null, 'nieznany klucz → null');
});

test('F44f: migracja v7→v8 — milestonesSeen dokładane/normalizowane/nietykane', () => {
  const st = baseState();
  assertEq(st.version, S.SCHEMA_VERSION, 'createState zsynchronizowany (v8)');
  assertTrue(Array.isArray(st.ui.milestonesSeen) && st.ui.milestonesSeen.length === 0, 'nowy stan: pusta lista');
  // v7 bez pola → [] po migracji.
  const v7 = JSON.parse(JSON.stringify(st));
  v7.version = 7;
  delete v7.ui.milestonesSeen;
  const m7 = S.migrate(S.validateState(v7));
  assertEq(m7.version, S.SCHEMA_VERSION);
  assertEq(JSON.stringify(m7.ui.milestonesSeen), '[]', 'pole dołożone jako []');
  // Nie-tablica → znormalizowana do [].
  const bad = JSON.parse(JSON.stringify(st));
  bad.version = 7;
  bad.ui.milestonesSeen = 'oops';
  assertEq(JSON.stringify(S.migrate(S.validateState(bad)).ui.milestonesSeen), '[]', 'nie-tablica → []');
  // Istniejąca niepusta lista przeżywa migrację nietknięta.
  const keep = JSON.parse(JSON.stringify(st));
  keep.version = 7;
  keep.ui.milestonesSeen = ['fi10', 'port100k'];
  assertEq(S.migrate(S.validateState(keep)).ui.milestonesSeen.join(','), 'fi10,port100k', 'jawna lista nietknięta');
  // Łańcuch v1→…→v8 dokłada pole (v1 sprzed ui.milestonesSeen).
  const v1 = JSON.parse(JSON.stringify(st));
  v1.version = 1;
  delete v1.housing.housePlan.familyLoan;
  delete v1.debt.familyOverrides;
  delete v1.assumptions.postRetirementReturnReal;
  delete v1.assumptions.freezeExpensesAtRetirement;
  delete v1.taxes;
  delete v1.ui.milestonesSeen;
  const m1 = S.migrate(S.validateState(v1));
  assertEq(m1.version, S.SCHEMA_VERSION, 'łańcuch 1→…→8');
  assertEq(JSON.stringify(m1.ui.milestonesSeen), '[]', 'pole dołożone w łańcuchu');
});

// ── F45: raport roczny „Twój rok FIRE" (projectionAsOf/reportYears/annualReport) ─
// Wszystko czytane z historii wpisów, nic nie utrwalane (zero zmian schematu).
// Plan: docs/plan-annual-report.md (tam „F30" — zajęte przez Belkę → F45).

const NOW2 = new Date(2027, 0, 15); // 15 stycznia 2027 → ostatni pełny miesiąc: 2026-12

// r = 0 wszędzie → arytmetyka całkowita; plan płaski 4 000 zł/mies. (10k − 6k).
function raportState(over = {}) {
  return baseState(deep({
    assumptions: { realReturnAnnual: 0, cashReturnReal: 0, postRetirementReturnReal: 0, portfolioStart: 100000 },
  }, over));
}
function raportEntries(st, net, note = null) {
  for (let i = 0; i < 6; i++) {
    const month = E.idxToYm(E.ymToIdx('2026-07') + i);
    E.applyCheckIn(st, { month, earned: 6000 + net, spent: 6000, note }, NOW2);
  }
}

test('F45a: sumy, werdykty i seria roku (okres obcięty do kotwicy)', () => {
  const st = raportState();
  raportEntries(st, 5000); // +1000 vs plan 4000 → crushed ×6
  const rep = E.annualReport(st, 2026, NOW2);
  assertEq(rep.from, '2026-07'); assertEq(rep.to, '2026-12');
  assertEq(rep.entriesCount, 6); assertEq(rep.monthsInPlan, 6);
  assertClose(rep.totalSaved, 30000, 0.005); assertClose(rep.totalPlanned, 24000, 0.005);
  assertClose(rep.delta, 6000, 0.005);
  assertEq(rep.verdicts.crushed, 6); assertEq(rep.goodMonths, 6); assertEq(rep.bestRun, 6);
  assertClose(rep.best.net, 5000, 0.005, 'równe wpisy: best = worst');
  assertClose(rep.worst.net, 5000, 0.005);
});

test('F45b: FI% start/koniec przy r = 0 — tożsamość zamyka się co do grosza', () => {
  const st = raportState();
  raportEntries(st, 5000);
  const rep = E.annualReport(st, 2026, NOW2);
  const target = E.fireTargetAt(st, '2026-12'); // wzrost wydatków 0 → cel stały
  assertClose(rep.fiPctStart, 100000 / target, 1e-9, 'start = salda startowe (2025-12 przed kotwicą)');
  assertClose(rep.fiPctEnd, 130000 / target, 1e-9, 'koniec = start + 30 000 (bez domu → portfel)');
  assertClose(rep.fiPctDelta, 30000 / target, 1e-9, 'delta domyka tożsamość');
});

test('F45c: przesunięcie daty FIRE — dodatnie/ujemne/null poza horyzontem', () => {
  // Ponad plan (r = 5%): wpisy przyspieszają FIRE → shift > 0.
  const up = baseState({ assumptions: { portfolioStart: 100000 } });
  for (let i = 0; i < 6; i++) {
    E.applyCheckIn(up, { month: E.idxToYm(E.ymToIdx('2026-07') + i), earned: 11000, spent: 6000 }, NOW2);
  }
  const repUp = E.annualReport(up, 2026, NOW2);
  assertTrue(repUp.reachedPrev && repUp.reachedNow, 'obie prognozy sięgają FIRE');
  assertTrue(repUp.fireShiftMonths > 0, `ponad plan → wcześniej (${repUp.fireShiftMonths})`);
  // Poniżej planu: delta z wpisów ujemna → FIRE później → shift < 0.
  const down = baseState({ assumptions: { portfolioStart: 100000 } });
  for (let i = 0; i < 6; i++) {
    E.applyCheckIn(down, { month: E.idxToYm(E.ymToIdx('2026-07') + i), earned: 8000, spent: 6000 }, NOW2);
  }
  const repDown = E.annualReport(down, 2026, NOW2);
  assertTrue(repDown.fireShiftMonths < 0, `poniżej planu → później (${repDown.fireShiftMonths})`);
  // r = 0 i wysokie wydatki: cel 2,85 mln przy 1 500 zł/mies. oszczędności
  // (≤ 1,08 mln w horyzoncie) → obie prognozy poza horyzontem → gałąź null.
  const flat = raportState({ assumptions: { monthlyLivingExpenses: 9500 } });
  for (let i = 0; i < 6; i++) {
    E.applyCheckIn(flat, { month: E.idxToYm(E.ymToIdx('2026-07') + i), earned: 11000, spent: 9500 }, NOW2);
  }
  const repFlat = E.annualReport(flat, 2026, NOW2);
  assertEq(repFlat.reachedNow, false, 'cel poza horyzontem');
  assertEq(repFlat.fireShiftMonths, null, 'brak daty → shift null');
});

test('F45d: projectionAsOf — obcięcie wpisów i czystość stanu', () => {
  const full = baseState({ assumptions: { portfolioStart: 100000 } });
  for (let i = 0; i < 6; i++) {
    E.applyCheckIn(full, { month: E.idxToYm(E.ymToIdx('2026-07') + i), earned: 11000, spent: 6000 }, NOW2);
  }
  const partial = baseState({ assumptions: { portfolioStart: 100000 } });
  for (let i = 0; i < 3; i++) { // tylko lip–wrz
    E.applyCheckIn(partial, { month: E.idxToYm(E.ymToIdx('2026-07') + i), earned: 11000, spent: 6000 }, NOW2);
  }
  const a = E.projectionAsOf(full, '2026-09');
  const b = E.projectionAsOf(partial, '2026-09');
  assertEq(a.fireYm, b.fireYm, 'obcięcie ≡ stan bez późniejszych wpisów (fireYm)');
  assertClose(a.delta, b.delta, 1e-9, 'obcięcie ≡ stan bez późniejszych wpisów (delta)');
  const before = JSON.stringify(full);
  E.projectionAsOf(full, '2026-09');
  E.annualReport(full, 2026, NOW2);
  assertEq(JSON.stringify(full), before, 'czystość: stan bajt-w-bajt nietknięty');
});

test('F45e: krawędzie — lata poza planem, rok bieżący, pusty rok, reportYears', () => {
  const st = raportState();
  raportEntries(st, 5000, 'notatka roku');
  assertEq(E.annualReport(st, 2025, NOW2), null, 'rok w całości przed kotwicą → null');
  assertEq(E.annualReport(st, 2027, NOW2), null, 'rok w całości po ostatnim pełnym miesiącu → null');
  // Rok bieżący obcinany do ostatniego pełnego miesiąca (kotwica cofnięta do 2026-01).
  const cur = raportState({ anchorMonth: '2026-01' });
  const repCur = E.annualReport(cur, 2026, NOW); // NOW = 15 lipca 2026
  assertEq(repCur.to, '2026-06', 'to = ostatni pełny miesiąc');
  assertEq(repCur.from, '2026-01');
  assertEq(repCur.entriesCount, 0, 'rok bez wpisów nadal raportowany');
  assertEq(repCur.best, null, 'brak wpisów → brak najlepszego miesiąca');
  // Notatki roku lądują w raporcie (dla karty „Notatki z roku").
  const rep = E.annualReport(st, 2026, NOW2);
  assertEq(rep.notes.length, 6, 'notatki z wpisów w raporcie');
  assertEq(rep.notes[0].ym, '2026-07');
  assertEq(rep.notes[0].note, 'notatka roku');
  // reportYears: malejąco; pusta historia → [].
  st.entries.push(entry('2027-01', 1000, 500));
  assertEq(E.reportYears(st).join(','), '2027,2026', 'lata malejąco');
  assertEq(E.reportYears(baseState()).length, 0, 'brak wpisów → []');
});

// ── F48: planowane zdarzenia jednorazowe (events) — schemat v10 ────────────
// Duże jednorazowe wydatki/przychody wpięte w prognozę (projectFire), nigdy w
// historię ani werdykty. Kwota realna, ze znakiem: + przychód, − wydatek.
// Stan bez zdarzeń jest bajt-w-bajt jak dotąd (gwarancja: reszta suite przechodzi).

const findRow = (proj, ym) => proj.series.find(r => r.ym === ym);

test('F48a: domyślne i schemat — createState.events = [], version = SCHEMA_VERSION', () => {
  const st = E.createState({}, NOW);
  assertTrue(Array.isArray(st.events) && st.events.length === 0, 'events = []');
  assertEq(st.version, S.SCHEMA_VERSION, 'createState nadaje najnowszą wersję');
});

test('F48b: migracja — v9 zyskuje events=[]; łańcuch v1 też; jawna lista nietknięta', () => {
  const st = baseState();
  const v9 = JSON.parse(JSON.stringify(st));
  v9.version = 9;
  delete v9.events;
  const m9 = S.migrate(S.validateState(v9));
  assertEq(m9.version, S.SCHEMA_VERSION);
  assertTrue(Array.isArray(m9.events) && m9.events.length === 0, 'events dołożone jako []');
  // Jawna lista zdarzeń przeżywa migrację bez zmian.
  const v9b = JSON.parse(JSON.stringify(st));
  v9b.version = 9;
  v9b.events = [{ id: 1, month: '2030-01', amount: -1000, label: 'x', createdAt: '2026-01-01T00:00:00.000Z' }];
  const m9b = S.migrate(S.validateState(v9b));
  assertEq(m9b.events.length, 1, 'jawna lista nietknięta');
  assertEq(m9b.events[0].amount, -1000);
  // Łańcuch od v1 dokłada events po drodze (1→…→10).
  const v1 = JSON.parse(JSON.stringify(st));
  v1.version = 1;
  delete v1.events;
  delete v1.housing.housePlan.familyLoan;
  delete v1.debt.familyOverrides;
  delete v1.assumptions.postRetirementReturnReal;
  delete v1.assumptions.freezeExpensesAtRetirement;
  delete v1.assumptions.pensionMonthly;
  delete v1.assumptions.pensionAge;
  delete v1.taxes;
  const m1 = S.migrate(S.validateState(v1));
  assertEq(m1.version, S.SCHEMA_VERSION, 'łańcuch 1→…→10');
  assertTrue(Array.isArray(m1.events) && m1.events.length === 0, 'events dołożone w łańcuchu');
});

test('F48c: walidacja — kopia v9 bez events przechodzi; zła lista/miesiąc/kwota odrzucone', () => {
  // s.events || [] — kopia sprzed v10 (brak klucza) musi przejść (walidacja przed migracją).
  const v9 = JSON.parse(JSON.stringify(baseState()));
  v9.version = 9;
  delete v9.events;
  assertEq(S.validateState(v9).version, 9, 'v9 bez events przechodzi');
  // Nie-tablica events → odrzucone.
  const badList = baseState();
  badList.events = { nope: true };
  assertThrows(() => S.validateState(badList), 'events nie-tablica odrzucone');
  // Zły miesiąc (jednocyfrowy) → odrzucone.
  const badMonth = baseState();
  badMonth.events = [{ id: 1, month: '2030-1', amount: -1000, label: 'x', createdAt: 'x' }];
  assertThrows(() => S.validateState(badMonth), 'zły miesiąc odrzucony');
  // Kwota nie-skończona / nie-liczbowa → odrzucone (NaN zatrułby prognozę).
  const badAmt = baseState();
  badAmt.events = [{ id: 1, month: '2030-01', amount: NaN, label: 'x', createdAt: 'x' }];
  assertThrows(() => S.validateState(badAmt), 'NaN kwota odrzucona');
  const badAmt2 = baseState();
  badAmt2.events = [{ id: 1, month: '2030-01', amount: 'dużo', label: 'x', createdAt: 'x' }];
  assertThrows(() => S.validateState(badAmt2), 'string kwota odrzucona');
});

test('F48d: mutacje — addEvent waliduje, nadaje monotoniczne id, zaokrągla, sortuje; removeEvent', () => {
  const st = baseState();
  // Bieżący miesiąc dozwolony (2026-07 przy NOW = 15 lipca 2026; upto = 2026-06).
  const e1 = E.addEvent(st, { month: '2026-07', amount: 1000, label: 'teraz' }, NOW);
  assertEq(e1.id, 1);
  assertEq(e1.month, '2026-07');
  // Przeszły miesiąc (≤ ostatni pełny), zły miesiąc, zero — odrzucone.
  assertThrows(() => E.addEvent(st, { month: '2026-06', amount: 1000 }, NOW), 'przeszły miesiąc');
  assertThrows(() => E.addEvent(st, { month: '2026-13', amount: 1000 }, NOW), 'zły miesiąc');
  assertThrows(() => E.addEvent(st, { month: '2027-01', amount: 0 }, NOW), 'zero');
  // Zaokrąglenie do grosza.
  const e2 = E.addEvent(st, { month: '2027-02', amount: 100.005, label: 'grosz' }, NOW);
  assertEq(e2.amount, 100.01);
  // Monotoniczne id + sort po miesiącu.
  const e3 = E.addEvent(st, { month: '2026-09', amount: 500, label: 'c' }, NOW);
  assertEq(e3.id, 3);
  assertEq(st.events.map(e => e.month).join(','), '2026-07,2026-09,2027-02', 'sort rosnąco');
  // Usunięcie środkowego → następne id = max+1 (bez reuse skasowanego).
  E.removeEvent(st, e2.id, NOW);
  const e4 = E.addEvent(st, { month: '2030-01', amount: 700, label: 'd' }, NOW);
  assertEq(e4.id, 4, 'id = max+1, nie reuse 2');
  // Etykieta cięta do 80 znaków.
  const e5 = E.addEvent(st, { month: '2031-01', amount: 100, label: 'x'.repeat(200) }, NOW);
  assertEq(e5.label.length, 80);
  // removeEvent z nieznanym id — no-op.
  const n = st.events.length;
  E.removeEvent(st, 9999, NOW);
  assertEq(st.events.length, n, 'nieznany id no-op');
  // Mutacje uruchamiają recomputeDerived.
  assertTrue(!!st.derived && !!st.derived.projection, 'derived przeliczone');
});

test('F48e: prognoza — przychód w fazie inwestowania rośnie o kwotę × (1+rPort)^k; FIRE nie później', () => {
  const noEv = baseState();
  E.recomputeDerived(noEv, NOW);
  const withEv = baseState();
  E.addEvent(withEv, { month: '2028-01', amount: 100000, label: 'spadek' }, NOW);
  const rPort = E.monthlyRate(0.05);
  const p0 = noEv.derived.projection, p1 = withEv.derived.projection;
  // Przed miesiącem zdarzenia serie identyczne.
  assertClose(findRow(p1, '2027-12').portfolio, findRow(p0, '2027-12').portfolio, 1e-6, 'przed zdarzeniem bez zmian');
  // Od miesiąca zdarzenia różnica = kwota skapitalizowana (1+rPort) na miesiąc.
  assertClose(findRow(p1, '2028-01').portfolio - findRow(p0, '2028-01').portfolio, 100000 * (1 + rPort), 0.01);
  assertClose(findRow(p1, '2028-02').portfolio - findRow(p0, '2028-02').portfolio, 100000 * (1 + rPort) ** 2, 0.01);
  assertClose(findRow(p1, '2028-06').portfolio - findRow(p0, '2028-06').portfolio, 100000 * (1 + rPort) ** 6, 0.01);
  // FIRE nie później niż bez zdarzenia (przychód przyspiesza).
  assertTrue(E.ymToIdx(p1.fireYm) <= E.ymToIdx(p0.fireYm), 'FIRE nie później');
  assertTrue(E.ymToIdx(p1.fireYm) < E.ymToIdx(p0.fireYm), 'duży przychód → FIRE wcześniej');
});

test('F48f: prognoza — wydatek w fazie oszczędzania drenuje gotówkę, potem portfel; wydatek opóźnia FIRE', () => {
  // Faza oszczędzania = przed startem kredytu (kubełek gotówki). Zwroty 0 →
  // ręczne wyliczenie trywialne.
  const mk = () => baseState({
    assumptions: { portfolioStart: 50000, realReturnAnnual: 0, cashReturnReal: 0, targetFireAge: 60 },
    housing: { housePlan: housePlan({
      moveInMonth: '2035-07',
      houseSpend: { month: null, amount: null },
      mortgage: { startMonth: '2035-07', principal: 600000, rateNominal: 0.07, termYears: 20, paymentOverrideMonthly: null },
    }) },
  });
  const noEv = mk();
  E.recomputeDerived(noEv, NOW);
  const withEv = mk();
  E.addEvent(withEv, { month: '2027-01', amount: -60000, label: 'wesele' }, NOW);
  const p0 = noEv.derived.projection, p1 = withEv.derived.projection;
  // 2026-12: przed zdarzeniem gotówka 24000 (6 × 4000), portfel 50000 w obu.
  assertClose(findRow(p0, '2026-12').cash, 24000, 0.01);
  assertClose(findRow(p1, '2026-12').cash, 24000, 0.01);
  // Bez zdarzenia 2027-01: gotówka 28000, portfel 50000.
  assertClose(findRow(p0, '2027-01').cash, 28000, 0.01);
  assertClose(findRow(p0, '2027-01').portfolio, 50000, 0.01);
  // Ze zdarzeniem: s netto = 4000 − 60000 = −56000 → gotówka 24000 pochłonięta
  // do zera, reszta 32000 z portfela (50000 − 32000 = 18000).
  assertClose(findRow(p1, '2027-01').cash, 0, 0.01, 'gotówka najpierw');
  assertClose(findRow(p1, '2027-01').portfolio, 18000, 0.01, 'potem portfel');
  // Duży wydatek w fazie inwestowania (bez domu, prognoza sięga FIRE) opóźnia FIRE.
  const b0 = baseState();
  E.recomputeDerived(b0, NOW);
  const b1 = baseState();
  E.addEvent(b1, { month: '2035-01', amount: -300000, label: 'duży wydatek' }, NOW);
  assertTrue(E.ymToIdx(b1.derived.projection.fireYm) > E.ymToIdx(b0.derived.projection.fireYm), 'wydatek → FIRE później');
});

test('F48g: prognoza — przychód w fazie długu nadpłaca kredyt; nadwyżka wraca do portfela', () => {
  const mk = () => baseState({
    assumptions: { monthlyIncome: 20000, targetFireAge: 60, cashReturnReal: 0 },
    housing: { housePlan: housePlan({
      moveInMonth: '2026-07',
      houseSpend: { month: '2026-07', amount: 0 },
      mortgage: { startMonth: '2026-07', principal: 300000, rateNominal: 0.07, termYears: 20, paymentOverrideMonthly: null },
    }) },
  });
  const noEv = mk();
  E.recomputeDerived(noEv, NOW);
  const withEv = mk();
  E.addEvent(withEv, { month: '2027-01', amount: 50000, label: 'premia' }, NOW);
  const p0 = noEv.derived.projection, p1 = withEv.derived.projection;
  // Przychód nadpłaca kredyt → wolny od długu wcześniej.
  assertTrue(E.ymToIdx(p1.debtFreeYm) < E.ymToIdx(p0.debtFreeYm), 'przychód przyspiesza spłatę');
  // Ogromny przychód > saldo → dług spłacony w tym miesiącu, nadwyżka (spill) w portfelu.
  const spillState = mk();
  E.addEvent(spillState, { month: '2027-01', amount: 400000, label: 'ogromna premia' }, NOW);
  const ps = spillState.derived.projection;
  assertEq(ps.debtFreeYm, '2027-01', 'ogromny przychód spłaca dług w tym miesiącu');
  assertClose(findRow(ps, '2027-01').debtReal, 0, 0.01, 'saldo długu zero');
  assertTrue(findRow(ps, '2027-01').portfolio > findRow(p0, '2027-01').portfolio + 1, 'spill trafia do portfela');
});

test('F48h: brak podwójnego liczenia — zdarzenie ≤ upto lub sprzed kotwicy nie zmienia prognozy', () => {
  const a = baseState();
  E.recomputeDerived(a, NOW);
  const b = baseState();
  // Wstrzykujemy ręcznie (addEvent odrzuca przeszłe miesiące) — test dotyczy
  // odcięcia startIdx w projectFire, nie walidacji mutacji.
  b.events = [
    { id: 1, month: '2026-06', amount: 999999, label: 'upto', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 2, month: '2026-05', amount: -555555, label: 'preanchor', createdAt: '2026-01-01T00:00:00.000Z' },
  ];
  E.recomputeDerived(b, NOW);
  assertEq(JSON.stringify(b.derived.projection.series), JSON.stringify(a.derived.projection.series), 'seria bez zmian');
  assertEq(b.derived.projection.fireYm, a.derived.projection.fireYm, 'FIRE bez zmian');
});

test('F48i: werdykty i benchmark nietknięte — buildPlan/plannedSavingsFor/check-in identyczne', () => {
  const mk = () => baseState({ anchorMonth: '2026-01' }); // kotwica cofnięta → check-in 2026-06 legalny
  const noEv = mk();
  const withEv = mk();
  E.addEvent(withEv, { month: '2028-06', amount: -40000, label: 'wesele' }, NOW);
  // Zdarzenie nie rusza buildPlan → benchmark oszczędności ten sam.
  assertEq(JSON.stringify(E.buildPlan(withEv)), JSON.stringify(E.buildPlan(noEv)), 'buildPlan identyczny');
  assertEq(E.plannedSavingsFor(E.buildPlan(withEv), '2028-06'), E.plannedSavingsFor(E.buildPlan(noEv), '2028-06'));
  // Check-in za ostatni pełny miesiąc daje ten sam snapshot i werdykt.
  const ea = E.applyCheckIn(noEv, { month: '2026-06', earned: 10000, spent: 6000 }, NOW);
  const eb = E.applyCheckIn(withEv, { month: '2026-06', earned: 10000, spent: 6000 }, NOW);
  assertEq(eb.plannedSavingsSnapshot, ea.plannedSavingsSnapshot, 'snapshot identyczny');
  assertEq(eb.verdict, ea.verdict, 'werdykt identyczny');
});

test('F48j: czystość i determinizm — projectionWith nie rusza stanu; recomputeDerived dwa razy identyczne', () => {
  const st = baseState();
  E.addEvent(st, { month: '2030-01', amount: -50000, label: 'x' }, NOW);
  const strip = s => { const { derived, ...rest } = s; return JSON.stringify(rest); };
  const before = strip(st);
  E.projectionWith(st, { extraMonthlySavings: 1000 }, NOW);
  assertEq(strip(st), before, 'projectionWith nie mutuje stanu (w tym events)');
  E.recomputeDerived(st, NOW);
  const s1 = JSON.stringify(st.derived.projection.series);
  E.recomputeDerived(st, NOW);
  assertEq(JSON.stringify(st.derived.projection.series), s1, 'dwa przebiegi identyczne');
});

test('F48k: solvery — duży przyszły wydatek zwiększa wymaganą dopłatę', () => {
  const mk = () => baseState({ assumptions: { targetFireAge: 42 } });
  const noEv = mk();
  const withEv = mk();
  E.addEvent(withEv, { month: '2030-01', amount: -200000, label: 'dom' }, NOW);
  const solNo = E.solveExtraSavingsForAge(noEv, 42 * 12, {}, NOW);
  const solEv = E.solveExtraSavingsForAge(withEv, 42 * 12, {}, NOW);
  assertTrue(solNo.feasible && solEv.feasible, 'oba wykonalne');
  assertTrue(solEv.extraMonthly > solNo.extraMonthly, 'wydatek → większa wymagana dopłata');
});

test('F48l: round-trip eksport/import zachowuje zdarzenia dokładnie', () => {
  const st = baseState();
  E.addEvent(st, { month: '2028-06', amount: -40000, label: 'Wesele' }, NOW);
  E.addEvent(st, { month: '2030-03', amount: 100000, label: 'Spadek' }, NOW);
  const back = S.importJSON(S.exportJSON(st));
  assertEq(JSON.stringify(back.events), JSON.stringify(st.events), 'events przeżywają round-trip');
  assertEq(back.version, S.SCHEMA_VERSION);
});

// ── F49: scenariusze A/B w Symulacji (state.scenarios) — schemat v11 ───────
// Zapisujemy tylko WEJŚCIA what-if (2 sloty na kalkulator), nigdy wyniki;
// pipeline pochodny ich nie czyta. Cała logika czysta (SCENARIO_SPECS,
// readSnapshot, mergeSeries) — testowalna w Node. Regułą regresji jest reszta
// pakietu przechodząca bez zmian dla stanu bez scenariuszy.

const NB = ' '; // NBSP — grupowanie w formatPLN

// ctx dla normalize/readSnapshot dla stanu testowego (birthDate 2000-01, NOW 2026-07 → wiek 26).
const scnCtx = { nowYm: '2026-07', currentAge: 26, defaultAge: 45, baseReturn: 0.05 };

function memBacking() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

test('F49a: schemat — createState.scenarios = {}, version 11, SCHEMA_VERSION 11', () => {
  const st = E.createState({}, NOW);
  assertTrue(st.scenarios && typeof st.scenarios === 'object' && !Array.isArray(st.scenarios), 'scenarios = {}');
  assertEq(Object.keys(st.scenarios).length, 0, 'pusta mapa na start');
  assertEq(st.version, 11, 'version 11');
  assertEq(S.SCHEMA_VERSION, 11, 'SCHEMA_VERSION 11');
});

test('F49b: migracja — v10 zyskuje scenarios={}; łańcuch v1 też; śmieciowa tablica normalizowana; nieznana wersja rzuca', () => {
  const st = baseState();
  // v10 → v11: brak klucza dołożony jako {}.
  const v10 = JSON.parse(JSON.stringify(st));
  v10.version = 10;
  delete v10.scenarios;
  const m10 = S.migrate(S.validateState(v10));
  assertEq(m10.version, S.SCHEMA_VERSION);
  assertTrue(m10.scenarios && typeof m10.scenarios === 'object' && !Array.isArray(m10.scenarios), 'scenarios dołożone jako {}');
  // Jawna mapa scenariuszy przeżywa migrację bez zmian.
  const v10b = JSON.parse(JSON.stringify(st));
  v10b.version = 10;
  v10b.scenarios = { wiecej: [{ savedAt: 'x', inputs: { extra: 1500 } }, null] };
  const m10b = S.migrate(S.validateState(v10b));
  assertEq(JSON.stringify(m10b.scenarios), JSON.stringify(v10b.scenarios), 'jawna mapa nietknięta');
  // migrate na blobie ≤v10 ze śmieciową TABLICĄ scenarios → {} (strażnik case 10).
  const junk = JSON.parse(JSON.stringify(st));
  junk.version = 10;
  junk.scenarios = ['śmieci'];
  const mjunk = S.migrate(junk);
  assertTrue(Array.isArray(mjunk.scenarios) === false && typeof mjunk.scenarios === 'object', 'śmieciowa tablica → {}');
  assertEq(Object.keys(mjunk.scenarios).length, 0);
  // Łańcuch od v1 dokłada scenarios po drodze (1→…→11).
  const v1 = JSON.parse(JSON.stringify(st));
  v1.version = 1;
  delete v1.scenarios;
  delete v1.events;
  delete v1.housing.housePlan.familyLoan;
  delete v1.debt.familyOverrides;
  delete v1.assumptions.postRetirementReturnReal;
  delete v1.assumptions.freezeExpensesAtRetirement;
  delete v1.assumptions.pensionMonthly;
  delete v1.assumptions.pensionAge;
  delete v1.taxes;
  const m1 = S.migrate(S.validateState(v1));
  assertEq(m1.version, S.SCHEMA_VERSION, 'łańcuch 1→…→11');
  assertTrue(m1.scenarios && !Array.isArray(m1.scenarios), 'scenarios dołożone w łańcuchu');
  // Nieznana wersja nadal rzuca.
  const bad = JSON.parse(JSON.stringify(st));
  bad.version = 99;
  assertThrows(() => S.migrate(bad), 'nieznana wersja rzuca');
});

test('F49c: walidacja — v10 bez klucza i v11 z {} przechodzą; tablica / string odrzucone', () => {
  const st = baseState();
  const v10 = JSON.parse(JSON.stringify(st));
  v10.version = 10;
  delete v10.scenarios;
  assertEq(S.validateState(v10).version, 10, 'v10 bez scenarios przechodzi (klucz undefined)');
  const v11 = JSON.parse(JSON.stringify(st)); // baseState już ma scenarios:{}
  assertEq(S.validateState(v11).version, 11, 'v11 z {} przechodzi');
  const arr = JSON.parse(JSON.stringify(st)); arr.scenarios = [];
  assertThrows(() => S.validateState(arr), 'scenarios:[] odrzucone');
  const strv = JSON.parse(JSON.stringify(st)); strv.scenarios = 'x';
  assertThrows(() => S.validateState(strv), "scenarios:'x' odrzucone");
});

test('F49d: normalize — kanonizacja pl-PL + roundGrosze + recurring bool; dokładne komunikaty; czystość', () => {
  // cojesli: „2 500,50" → 2500.5, recurring wymuszony na bool.
  const raw = { month: '2027-03', amount: '2 500,50', recurring: 1 };
  const n = Sim.SCENARIO_SPECS.cojesli.normalize(raw, scnCtx);
  assertTrue(n.ok, 'cojesli ok');
  assertEq(n.inputs.amount, 2500.5, 'pl-PL sparsowane + grosze');
  assertEq(n.inputs.recurring, true, 'recurring→bool');
  assertEq(raw.amount, '2 500,50', 'wejście nietknięte (czystość)');
  // cojesli: przeszły miesiąc przy zapisie → hint z dokładnym tekstem.
  const past = Sim.SCENARIO_SPECS.cojesli.normalize({ month: '2026-05', amount: '100' }, scnCtx);
  assertTrue(!past.ok && past.kind === 'hint', 'przeszły miesiąc = hint');
  assertEq(past.msg, 'Wybierz bieżący lub przyszły miesiąc.');
  // cojesli: pusta kwota → hint; zła kwota → error.
  assertEq(Sim.SCENARIO_SPECS.cojesli.normalize({ month: '2027-03', amount: '' }, scnCtx).msg, 'Podaj kwotę, aby zobaczyć wpływ na datę FIRE.');
  const badAmt = Sim.SCENARIO_SPECS.cojesli.normalize({ month: '2027-03', amount: 'abc' }, scnCtx);
  assertTrue(!badAmt.ok && badAmt.kind === 'error', 'zła kwota = error');
  assertEq(badAmt.msg, 'Nieprawidłowa kwota');
  // wiek: ≤ obecny → hint z liczbą; puste pole → domyślny wiek.
  const ageLow = Sim.SCENARIO_SPECS.wiek.normalize({ age: '20' }, scnCtx);
  assertTrue(!ageLow.ok && ageLow.kind === 'hint');
  assertEq(ageLow.msg, 'Podaj wiek większy niż Twój obecny (26).');
  assertEq(Sim.SCENARIO_SPECS.wiek.normalize({ age: '' }, scnCtx).inputs.age, 45, 'puste → defaultAge');
  assertEq(Sim.SCENARIO_SPECS.wiek.normalize({ age: '0' }, scnCtx).msg, 'Podaj docelowy wiek.');
  // latte: pusta → hint; ≤0 → error.
  assertEq(Sim.SCENARIO_SPECS.latte.normalize({ amount: '' }, scnCtx).msg, 'Podaj miesięczną kwotę, aby zobaczyć efekt.');
  assertEq(Sim.SCENARIO_SPECS.latte.normalize({ amount: '0' }, scnCtx).msg, 'Podaj dodatnią kwotę.');
  assertEq(Sim.SCENARIO_SPECS.latte.normalize({ amount: '450' }, scnCtx).inputs.amount, 450);
  // wiecej: 0/pusty → hint.
  assertEq(Sim.SCENARIO_SPECS.wiecej.normalize({ extra: 0 }, scnCtx).msg, 'Przesuń suwak, aby zobaczyć, o ile wcześniej osiągniesz FIRE.');
  assertEq(Sim.SCENARIO_SPECS.wiecej.normalize({ extra: '1500' }, scnCtx).inputs.extra, 1500);
  // zwrot: puste pole → baseReturn; wartość bezwzględna.
  assertEq(Sim.SCENARIO_SPECS.zwrot.normalize({ realReturnAnnual: '' }, scnCtx).inputs.realReturnAnnual, 0.05, 'puste → baseReturn');
  assertEq(Sim.SCENARIO_SPECS.zwrot.normalize({ realReturnAnnual: 0.055 }, scnCtx).inputs.realReturnAnnual, 0.055);
  // kredyt: komplet komunikatów.
  assertEq(Sim.SCENARIO_SPECS.kredyt.normalize({ principal: 'x', rate: '7', term: '25', extra: '' }, scnCtx).msg, 'Uzupełnij poprawnie wszystkie pola.');
  assertEq(Sim.SCENARIO_SPECS.kredyt.normalize({ principal: '0', rate: '7', term: '25', extra: '' }, scnCtx).msg, 'Podaj dodatnią kwotę kredytu.');
  assertEq(Sim.SCENARIO_SPECS.kredyt.normalize({ principal: '500000', rate: '-1', term: '25', extra: '' }, scnCtx).msg, 'Oprocentowanie nie może być ujemne.');
  assertEq(Sim.SCENARIO_SPECS.kredyt.normalize({ principal: '500000', rate: '7', term: '0', extra: '' }, scnCtx).msg, 'Podaj okres kredytu w latach.');
  assertEq(Sim.SCENARIO_SPECS.kredyt.normalize({ principal: '500000', rate: '7', term: '25', extra: '-5' }, scnCtx).msg, 'Podaj nadpłatę: 0 lub więcej.');
  const kOk = Sim.SCENARIO_SPECS.kredyt.normalize({ principal: '500 000', rate: '7', term: '25', extra: '500' }, scnCtx);
  assertTrue(kOk.ok && kOk.inputs.principal === 500000 && kOk.inputs.extra === 500);
  // nadplata: ujemna → error; loan whitelisting.
  assertEq(Sim.SCENARIO_SPECS.nadplata.normalize({ loan: 'family', extra: '-1' }, scnCtx).msg, 'Podaj nadpłatę: 0 lub więcej.');
  assertEq(Sim.SCENARIO_SPECS.nadplata.normalize({ loan: 'coś', extra: '800' }, scnCtx).inputs.loan, 'mortgage', 'nieznany loan → mortgage');
});

test('F49e: describe — dokładne stringi z grupowaniem NBSP', () => {
  assertEq(Sim.SCENARIO_SPECS.cojesli.describe({ month: '2027-03', amount: 2000, recurring: false }), `jednorazowo 2${NB}000${NB}zł w 03.2027`);
  assertEq(Sim.SCENARIO_SPECS.cojesli.describe({ month: '2026-08', amount: 500, recurring: true }), `co miesiąc +500${NB}zł od 08.2026`);
  assertEq(Sim.SCENARIO_SPECS.wiek.describe({ age: 45 }), 'wiek 45');
  assertEq(Sim.SCENARIO_SPECS.latte.describe({ amount: 450 }), `450${NB}zł/mies.`);
  assertEq(Sim.SCENARIO_SPECS.wiecej.describe({ extra: 1500 }), `+1${NB}500${NB}zł/mies.`);
  assertEq(Sim.SCENARIO_SPECS.zwrot.describe({ realReturnAnnual: 0.055 }), 'zwrot 5,5%');
  assertEq(Sim.SCENARIO_SPECS.kredyt.describe({ principal: 500000, ratePct: 7, termYears: 25, extra: 500 }), `500${NB}000${NB}zł · 7% · 25 lat · nadpłata 500${NB}zł/mies.`);
  assertEq(Sim.SCENARIO_SPECS.nadplata.describe({ loan: 'mortgage', extra: 800 }), `kredyt 🏠 · nadpłata 800${NB}zł/mies.`);
});

test('F49f: readSnapshot — poprawny slot round-trip; śmieci → null; przeszły cojesli → stale', () => {
  const scen = { wiecej: [{ savedAt: '2026-07-07T00:00:00.000Z', inputs: { extra: 1500 } }, null] };
  const snap = Sim.readSnapshot(scen, 'wiecej', 0, scnCtx);
  assertTrue(snap && snap.inputs.extra === 1500 && snap.stale === false, 'poprawny slot');
  assertEq(snap.savedAt, '2026-07-07T00:00:00.000Z');
  assertEq(Sim.readSnapshot(scen, 'wiecej', 1, scnCtx), null, 'slot B pusty → null');
  // Uszkodzenia → null.
  assertEq(Sim.readSnapshot({ wiecej: [{ inputs: { extra: NaN } }, null] }, 'wiecej', 0, scnCtx), null, 'NaN → null');
  assertEq(Sim.readSnapshot({ wiecej: [{ savedAt: 'x' }, null] }, 'wiecej', 0, scnCtx), null, 'brak inputs → null');
  assertEq(Sim.readSnapshot({ wiecej: 'x' }, 'wiecej', 0, scnCtx), null, 'nie-tablica zakładki → null');
  assertEq(Sim.readSnapshot({}, 'wiecej', 0, scnCtx), null, 'brak zakładki → null');
  // Przeterminowany cojesli: zwrócony z inputs, oznaczony stale.
  const staleScen = { cojesli: [{ savedAt: 'x', inputs: { month: '2026-05', amount: 1000, recurring: false } }, null] };
  const st = Sim.readSnapshot(staleScen, 'cojesli', 0, scnCtx);
  assertTrue(st && st.stale === true, 'przeszły miesiąc → stale:true');
  assertEq(st.inputs.month, '2026-05', 'inputs zachowane mimo stale');
  // Przyszły cojesli: nie stale.
  const fresh = { cojesli: [{ savedAt: 'x', inputs: { month: '2027-03', amount: 1000, recurring: false } }, null] };
  assertEq(Sim.readSnapshot(fresh, 'cojesli', 0, scnCtx).stale, false, 'przyszły miesiąc → nie stale');
  // Idempotencja: normalize na KANONICZNYCH wejściach (klucze ratePct/termYears,
  // kwoty jako liczby) musi się udać — inaczej readSnapshot zwróciłby null i slot
  // wyglądałby na pusty (regresja złapana testem przeglądarkowym).
  const kSnap = { kredyt: [{ savedAt: 'x', inputs: { principal: 500000, ratePct: 7, termYears: 25, extra: 500 } }, null] };
  const kRead = Sim.readSnapshot(kSnap, 'kredyt', 0, scnCtx);
  assertTrue(kRead && kRead.inputs.ratePct === 7 && kRead.inputs.termYears === 25 && kRead.inputs.extra === 500, 'kredyt kanon round-trip');
  // Kwota ułamkowa (grosze) w cojesli: String(2500.5) wpadłby w regułę kropki
  // parsePLN → null; readAmount przepuszcza liczbę wprost.
  const fracRead = Sim.readSnapshot({ cojesli: [{ savedAt: 'x', inputs: { month: '2027-03', amount: 2500.5, recurring: true } }, null] }, 'cojesli', 0, scnCtx);
  assertTrue(fracRead && fracRead.inputs.amount === 2500.5, 'ułamkowa kwota round-trip');
  // Ogólna idempotencja: normalize(normalize(raw).inputs).inputs === inputs.
  for (const [tab, raw] of [
    ['cojesli', { month: '2027-03', amount: '2 500,50', recurring: 1 }],
    ['latte', { amount: '450' }],
    ['kredyt', { principal: '500 000', rate: '7', term: '25', extra: '500' }],
    ['nadplata', { loan: 'family', extra: '800' }],
    ['wiek', { age: '48' }],
  ]) {
    const once = Sim.SCENARIO_SPECS[tab].normalize(raw, scnCtx);
    assertTrue(once.ok, tab + ' pierwsza normalize ok');
    const twice = Sim.SCENARIO_SPECS[tab].normalize(once.inputs, scnCtx);
    assertTrue(twice.ok, tab + ' druga normalize ok');
    assertEq(JSON.stringify(twice.inputs), JSON.stringify(once.inputs), tab + ' idempotentne');
  }
});

test('F49g: mergeSeries — równe/nierówne długości (null padding), puste, czystość', () => {
  const a = [{ ym: '2026-07', portfolio: 10 }, { ym: '2026-08', portfolio: 20 }];
  const b = [{ ym: '2026-07', portfolio: 5 }, { ym: '2026-08', portfolio: 6 }, { ym: '2026-09', portfolio: 7 }];
  const m = Sim.mergeSeries(a, b);
  assertEq(m.length, 3, 'długość = max');
  assertEq(JSON.stringify(m[0]), JSON.stringify({ ym: '2026-07', a: 10, b: 5 }));
  assertEq(JSON.stringify(m[2]), JSON.stringify({ ym: '2026-09', a: null, b: 7 }), 'krótsza dopełniona null');
  // yKey inne pole (nakładka kredytowa).
  const la = [{ ym: '2026-07', val: 100 }], lb = [{ ym: '2026-07', val: 90 }, { ym: '2027-07', val: 40 }];
  const lm = Sim.mergeSeries(la, lb, { yKey: 'val' });
  assertEq(lm[1].a, null); assertEq(lm[1].b, 40);
  // Puste wejścia.
  assertEq(Sim.mergeSeries([], []).length, 0, 'oba puste → []');
  assertEq(Sim.mergeSeries(null, null).length, 0, 'null → []');
  // Czystość: tablice wejściowe nietknięte.
  const aSnap = JSON.stringify(a), bSnap = JSON.stringify(b);
  Sim.mergeSeries(a, b);
  assertEq(JSON.stringify(a), aSnap, 'a nietknięte'); assertEq(JSON.stringify(b), bSnap, 'b nietknięte');
});

test('F49h: równoważność compute — wejścia scenariusza dają ten sam wynik co ścieżka na żywo (przez round-trip JSON)', () => {
  const st = baseState();
  // wiecej to suwak — wejście liczbowe (Number), grosze zaokrąglane.
  const canon = Sim.SCENARIO_SPECS.wiecej.normalize({ extra: '1500' }, scnCtx).inputs;
  assertEq(canon.extra, 1500, 'kanonizacja suwaka → 1500');
  const rt = JSON.parse(JSON.stringify({ savedAt: '2026-07-07T00:00:00.000Z', inputs: canon }));
  const viaSnap = E.projectionWith(st, { extraMonthlySavings: rt.inputs.extra }, NOW);
  const viaLive = E.projectionWith(st, { extraMonthlySavings: 1500 }, NOW);
  assertEq(viaSnap.fireYm, viaLive.fireYm, 'ta sama data FIRE po round-tripie');
  assertEq(JSON.stringify(viaSnap.series), JSON.stringify(viaLive.series), 'identyczna seria');
});

test('F49i: niezależność pipeline — recomputeDerived identyczne dla scenarios:{} vs pełnych slotów', () => {
  const bare = baseState();
  E.recomputeDerived(bare, NOW);
  const withScn = baseState();
  withScn.scenarios = {
    wiecej: [{ savedAt: 'x', inputs: { extra: 1500 } }, { savedAt: 'y', inputs: { extra: 3000 } }],
    kredyt: [{ savedAt: 'z', inputs: { principal: 500000, ratePct: 7, termYears: 25, extra: 500 } }, null],
  };
  E.recomputeDerived(withScn, NOW);
  assertEq(JSON.stringify(withScn.derived.projection.series), JSON.stringify(bare.derived.projection.series), 'seria projekcji bez zmian');
  assertEq(JSON.stringify(withScn.derived.balances.rows), JSON.stringify(bare.derived.balances.rows), 'salda bez zmian');
  assertEq(JSON.stringify(withScn.derived.streak), JSON.stringify(bare.derived.streak), 'seria dobrych miesięcy bez zmian');
});

test('F49j: round-trip storage — save/load i export/import zachowują scenarios; stripDerived je zostawia', () => {
  const store = S.makeStorage(memBacking());
  const st = baseState();
  st.scenarios = { wiecej: [{ savedAt: '2026-07-07T00:00:00.000Z', inputs: { extra: 1500 } }, null] };
  E.recomputeDerived(st, NOW); // dokłada derived (cache)
  store.save(st);
  const loaded = store.load().state;
  assertEq(JSON.stringify(loaded.scenarios), JSON.stringify(st.scenarios), 'save/load zachowuje scenarios');
  assertEq(loaded.derived, undefined, 'stripDerived usuwa cache, scenarios zostają');
  // export → import.
  const back = S.importJSON(S.exportJSON(st));
  assertEq(JSON.stringify(back.scenarios), JSON.stringify(st.scenarios), 'export/import zachowuje scenarios');
  assertEq(back.version, S.SCHEMA_VERSION);
});
