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
};
