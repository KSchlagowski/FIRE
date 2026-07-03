// format.js — formatowanie i parsowanie pl-PL (czyste, deterministyczne;
// grupowanie ręczne NBSP, żeby Node i przeglądarka dawały ten sam wynik).

const NBSP = ' ';

export function formatPLN(x, decimals = 0) {
  if (x == null || Number.isNaN(x)) return '—';
  const neg = x < -1e-9;
  const v = Math.abs(x);
  const s = v.toFixed(decimals);
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? '-' : '') + grouped + (frac ? ',' + frac : '') + NBSP + 'zł';
}

export function formatPct(x, maxDecimals = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  let s = (x * 100).toFixed(maxDecimals);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',') + '%';
}

// Polska liczba mnoga dla lat: 1 rok, 2–4 lata (poza 12–14), reszta lat.
export function polishYears(n) {
  if (n === 1) return 'rok';
  const d10 = n % 10, d100 = n % 100;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'lata';
  return 'lat';
}

export function formatAgeYM(age) {
  const y = age.years, m = age.months;
  if (m === 0) return `${y} ${polishYears(y)}`;
  return `${y} ${polishYears(y)} ${m} mies.`;
}

export function formatYearsMonths(totalMonths) {
  const y = Math.floor(totalMonths / 12), m = totalMonths % 12;
  if (y === 0) return `${m} mies.`;
  return formatAgeYM({ years: y, months: m });
}

export const MONTH_NAMES = [
  'styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec',
  'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień',
];

export const MONTH_NAMES_GENITIVE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

export function formatMonthName(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Dopełniacz: "do czerwca 2028", "z końcem lipca 2026".
export function formatMonthGenitive(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES_GENITIVE[m - 1]} ${y}`;
}

export function parsePLN(str) {
  if (typeof str === 'number') return Math.round(str * 100) / 100;
  if (typeof str !== 'string') return null;
  const cleaned = str
    .replace(/z[łl]/gi, '')
    .replace(/[\s  ]/g, '')
    .replace(',', '.');
  if (cleaned === '' || cleaned === '-') return null;
  const v = Number(cleaned);
  if (Number.isNaN(v)) return null;
  return Math.round(v * 100) / 100;
}
