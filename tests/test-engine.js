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
