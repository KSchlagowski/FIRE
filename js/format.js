// format.js — formatowanie i parsowanie pl-PL (czyste, deterministyczne;
// grupowanie ręczne NBSP, żeby Node i przeglądarka dawały ten sam wynik).

const NBSP = ' ';

export function formatPLN(x, decimals = 0) {
  if (x == null || Number.isNaN(x)) return '—';
  const v = Math.abs(x);
  const s = v.toFixed(decimals);
  // Znak liczymy z wartości PO zaokrągleniu do pokazywanej precyzji — dzięki temu
  // −0,004 zł przy 0 miejscach renderuje się jako „0 zł", nie „-0 zł" (D2).
  const neg = Number(s) > 0 && x < 0;
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return (neg ? '-' : '') + grouped + (frac ? ',' + frac : '') + NBSP + 'zł';
}

export function formatPct(x, maxDecimals = 2) {
  if (x == null || Number.isNaN(x)) return '—';
  let s = (x * 100).toFixed(maxDecimals);
  // Ucinamy zera tylko z części ułamkowej — nigdy z części całkowitej, więc
  // formatPct(0.10, 0) → „10%", a nie „1%" (D3).
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
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

// Parser pl-PL (D1): przecinek = separator dziesiętny (najwyżej jeden), kropka/
// spacja/NBSP = separatory tysięcy. Kropki są dozwolone TYLKO gdy dzielą część
// całkowitą na grupy po 3 cyfry; wszystko inne (dwa przecinki, kropka-dziesiętna,
// nietrzycyfrowa grupa) jest niejednoznaczne → null, żeby pole zgłosiło błąd
// zamiast po cichu przyjąć złą wartość.
export function parsePLN(str) {
  if (typeof str === 'number') return Number.isFinite(str) ? Math.round(str * 100) / 100 : null;
  if (typeof str !== 'string') return null;
  let s = str
    .replace(/z[łl]/gi, '')
    .replace(/[\s  ]/g, '')
;
  if (s === '' || s === '-') return null;
  let sign = 1;
  if (s[0] === '-') { sign = -1; s = s.slice(1); }
  else if (s[0] === '+') { s = s.slice(1); }
  if (s === '') return null;
  const commas = (s.match(/,/g) || []).length;
  if (commas > 1) return null;                       // dwa przecinki → niejednoznaczne
  let intPart = s, fracPart = '';
  if (commas === 1) [intPart, fracPart] = s.split(',');
  if (intPart === '' && fracPart === '') return null;
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null;
  // Część całkowita: albo czyste cyfry, albo grupy po 3 rozdzielone kropkami.
  if (intPart !== '' && !/^\d+$/.test(intPart) && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null;
  const intClean = intPart.replace(/\./g, '');
  const num = Number((intClean || '0') + (fracPart !== '' ? '.' + fracPart : ''));
  if (Number.isNaN(num)) return null;
  const rounded = Math.round(num * 100) / 100;
  const signed = sign < 0 ? -rounded : rounded;
  return signed === 0 ? 0 : signed;                  // normalizuj -0 → 0
}
