// fixtures.mjs — liczby oczekiwane wyprowadzone z Kalkulator_FIRE.xlsx
// (arkusze: Kalkulator, Projekcja, Faza wypłat, Plan z domem).

export const FIX = {
  // Projekcja: konwencja roczna end = (start + wpłaty) × (1+r).
  F1: {
    start: 100000,
    contribYearly: 48000,
    r: 0.05,
    years: 20,
    expectedYear20: 1931853.86,
    eps: 0.5,
    threshold: 1800000,
    crossesAtYear: 20,
  },
  // Plan z domem: annuitet 1 100 000 zł @ 7% nominalnie / 15 lat.
  F3: {
    principal: 1100000,
    rateNominal: 0.07,
    termYears: 15,
    expectedPayment: 9755.8,
    eps: 1,
  },
  // Kalkulator: 6 000 zł/mies. wydatków przy WR 4% → 1 800 000 zł.
  F4: {
    monthlyLiving: 6000,
    withdrawalRate: 0.04,
    expectedTarget: 1800000,
  },
  // Faza wypłat: wypłata = cel×SWR rosnąca z inflacją, portfel @ (1+r)(1+i)−1 = 8,15%.
  F13: {
    startReal: 1800000, swr: 0.04, real: 0.05, infl: 0.03, nominalRate: 0.0815,
    year1: { withdrawalNominal: 72000, growthNominal: 140832, endNominal: 1868832, endReal: 1814400 },
    year2: { endNominal: 1940937.77 },
    year35EndNominal: 8724696.89,
    eps: 0.5,
    depletionR0: { startReal: 720000, years: 10 }, // r=0: 720 000/72 000 → dokładnie 10 lat
  },
  // Projekcja roczna (model aplikacji, kapitalizacja miesięczna, annuity-due).
  F14: { start: 100000, monthlyContrib: 4000, r: 0.05, year1End: 154290.31, eps: 0.5 },
  // Parytet arkusza Projekcja z celem rosnącym 1% (start/wpłaty jak F1).
  F15: { excelYear22: { end: 2233188.88, target: 2218305.49, reached: true } },
  // Tabela SWR przy rocznych wydatkach 72 000 zł.
  F16: {
    rows: [
      { swr: 0.03, target: 2400000 },
      { swr: 0.035, target: 2057142.86 },
      { swr: 0.04, target: 1800000 },
    ],
    diff3pct: 600000,
    diff35pct: 257142.86,
  },
  // Coast FIRE: 1.8M/1.05^(222/12); Σodsetek kontraktu F3: A·180 − 1.1M.
  F17: { coast: 729911.95, contractInterest: 655962.35, eps: 1 },
  // Symulacja „co jeśli” (projectionWith.extraSavings): przy r=0 kwota
  // jednorazowa ląduje 1:1 w miesiącu symulacji, recurring = kwota × liczba
  // miesięcy od miesiąca startu symulacji.
  F18: {
    oneTime: { month: '2026-09', amount: 2000 },
    recurringFrom: '2027-01', recurringAmount: 1000, monthsToJun2027: 6,
  },
  // Dług rodzinny: annuitet z okna [start, end]. Parytet z formułą annuitetu;
  // po N krokach saldo ≈ 0. Wersje 0% dla ręcznej arytmetyki całkowitej.
  F20: {
    principal: 150000, rateNominal: 0.035,
    startMonth: '2028-01', endMonth: '2032-12', // 60 rat włącznie
    N: 60, eps: 0.01,
  },
  // Wartość przyszła równych wpłat (annuity-due). Parytet z zamkniętą formą
  // oraz ze składkową częścią silnika miesięcznego (replayBalances, start 0).
  F21: { monthly: 1000, annualReal: 0.05, months: 24 },
  // Cel: wiek FIRE — poszukiwanie binarne minimalnych dodatkowych oszczędności.
  F22: { cap: 100000 },
  // Wymagane oszczędności na cel wieku (requiredSavingsForGoal). Trzy gałęzie:
  // plan wystarcza (onTrack), plan nie wystarcza (need), wiek nieosiągalny.
  F23: {
    onTrack: { portfolioStart: 1700000, targetFireAge: 45 },
    need: { portfolioStart: 100000, targetFireAge: 40 },
    infeasible: { portfolioStart: 100000, targetFireAge: 27 },
  },
  // Cel „do zera": PV rosnącej renty (annuity-due); portfel = 0 w wieku deathAge.
  // Wyprowadzone z formy zamkniętej (nie z xlsx). baseState: kotwica 2026-07,
  // urodzony 2000-01-01 → wiek 26 w 2026-07, W₁ = 72 000, r = 0,05, g = 0.
  F24: {
    deathAge: 110, startYm: '2026-07', N: 84,
    target: 1486901.33,            // g=0: 72000·(1−1.05^−84)/(1−1/1.05)
    year1EndReal: 1485646.40, year2EndReal: 1484328.72,
    target54: 1403525.00,          // deathAge 80 → N=54 (monotonia)
    targetG1: 1817630.42,          // g=1%: może przewyższyć klasyczny cel (N=84)
    classic: 1800000,
    r0: { deathAge: 36, N: 10, target: 720000 }, // q=1 (r=0, g=0): N·W₁
    eps: 0.5,
  },
};
