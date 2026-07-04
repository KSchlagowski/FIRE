// test-engine.js — asercje współdzielone przez przeglądarkę (tests.html)
// i Node (run-tests.mjs). Zero frameworków.

import * as E from '../js/engine.js';
import * as F from '../js/format.js';
import * as S from '../js/storage.js';
import { coachMessage } from '../js/coach.js';
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
  assertEq(F.parsePLN('12345.67'), 12345.67);
  assertEq(F.parsePLN('abc'), null);
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
  const st = baseState();
  st.entries.push(entry('2026-07', 8000, 5000));
  const json = S.exportJSON(st);
  const preview = S.importPreview(json);
  assertEq(preview.entriesCount, 1);
  assertEq(preview.range.from, '2026-07');
  assertEq(JSON.stringify(preview.state.entries), JSON.stringify(st.entries));
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

test('F11: migracja v1 = identyczność; nowsza wersja odrzucona', () => {
  const st = baseState();
  assertEq(S.migrate(S.validateState(JSON.parse(S.exportJSON(st)).state)).version, 1);
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
  const st = baseState({ assumptions: { realReturnAnnual: 0 } });
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
  for (let i = 0; i < 6; i++) st.entries.push(entry(E.addMonths('2026-01', i), 10000, 6000)); // 2026-01..06, net 4000
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
