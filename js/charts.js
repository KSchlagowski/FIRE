// charts.js — czyste buildery wykresów SVG. Zero importów, zero DOM, zero stanu
// (liść L0 w diagramie warstw). Przeniesione z ui.js, by dało się je testować
// w Node. Opcje `width`/`maxPoints`/`detail` obsługują widok pełnoekranowy;
// przy wartościach domyślnych wynik jest bajt-w-bajt identyczny jak wcześniej.

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatShort(x) {
  const a = Math.abs(x);
  if (a >= 1e6) return (x / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(/,0$/, '') + ' mln';
  if (a >= 1e3) return Math.round(x / 1e3) + ' tys.';
  return String(Math.round(x));
}

// Oś Y: domyślnie 3 linie/etykiety (0 / ½ / max); `detail` dokłada ¼ i ¾ (5).
// Zwraca gotowe do wklejenia stringi — kolejność bez detail = jak w oryginale.
function yAxisSvg(y, max, padL, padR, W, detail) {
  const y0 = y(0), yM = y(max), yH = y(max / 2), yQ = y(max / 4), yT = y(max * 3 / 4);
  const lines = [
    `<line class="axis" x1="${padL}" y1="${y0}" x2="${W - padR}" y2="${y0}"/>`,
    `<line class="axis" x1="${padL}" y1="${yM}" x2="${W - padR}" y2="${yM}" opacity=".4"/>`,
    ...(detail ? [`<line class="axis" x1="${padL}" y1="${yT}" x2="${W - padR}" y2="${yT}" opacity=".4"/>`] : []),
    `<line class="axis" x1="${padL}" y1="${yH}" x2="${W - padR}" y2="${yH}" opacity=".4"/>`,
    ...(detail ? [`<line class="axis" x1="${padL}" y1="${yQ}" x2="${W - padR}" y2="${yQ}" opacity=".4"/>`] : []),
  ];
  const labels = [
    `<text x="${padL - 4}" y="${y0 + 3}" text-anchor="end">0</text>`,
    ...(detail ? [`<text x="${padL - 4}" y="${yQ + 3}" text-anchor="end">${formatShort(max / 4)}</text>`] : []),
    `<text x="${padL - 4}" y="${yH + 3}" text-anchor="end">${formatShort(max / 2)}</text>`,
    ...(detail ? [`<text x="${padL - 4}" y="${yT + 3}" text-anchor="end">${formatShort(max * 3 / 4)}</text>`] : []),
    `<text x="${padL - 4}" y="${yM + 3}" text-anchor="end">${formatShort(max)}</text>`,
  ];
  return { axisSvg: lines.join('\n    '), yLabelSvg: labels.join('\n    ') };
}

// ── Wykres liniowy (decymacja do `maxPoints` punktów) ────────────────────

export function chartSVG(rows, defs, { height = 170, width = 440, maxPoints = 120, detail = false } = {}) {
  if (!rows.length) return '';
  const step = Math.ceil(rows.length / maxPoints);
  const pts = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const W = width, H = height, padL = 48, padR = 8, padT = 10, padB = 20;
  let max = 0;
  for (const r of pts) for (const d of defs) max = Math.max(max, d.get(r) || 0);
  if (max <= 0) max = 1;
  const x = i => padL + i * (W - padL - padR) / Math.max(1, pts.length - 1);
  const y = v => padT + (1 - Math.min(v, max) / max) * (H - padT - padB);
  const lines = [];
  for (const d of defs) {
    if (d.split) {
      const hist = [], proj = [];
      pts.forEach((r, i) => {
        const p = `${x(i).toFixed(1)},${y(d.get(r) || 0).toFixed(1)}`;
        if (r.projected) { if (proj.length === 0 && hist.length) proj.push(hist[hist.length - 1]); proj.push(p); }
        else hist.push(p);
      });
      if (hist.length > 1) lines.push(`<polyline class="${d.cls}" points="${hist.join(' ')}"/>`);
      if (proj.length > 1) lines.push(`<polyline class="${d.clsProj || d.cls}" points="${proj.join(' ')}"/>`);
    } else {
      const p = pts.map((r, i) => `${x(i).toFixed(1)},${y(d.get(r) || 0).toFixed(1)}`);
      lines.push(`<polyline class="${d.cls}" points="${p.join(' ')}"/>`);
    }
  }
  const { axisSvg, yLabelSvg } = yAxisSvg(y, max, padL, padR, W, detail);
  const first = pts[0].ym.slice(0, 4), last = pts[pts.length - 1].ym.slice(0, 4);
  // Oś X: domyślnie tylko pierwszy/ostatni rok. `detail` dokłada pośrednie
  // etykiety (cel ~ width/110), pomijając powtórzony rok; krańce zachowują
  // dotychczasowe kotwiczenie (start / end).
  let xLabelSvg;
  if (detail && pts.length >= 3) {
    const L = Math.max(2, Math.round(W / 110));
    const parts = [`<text x="${padL}" y="${H - 4}">${first}</text>`];
    let prev = first;
    for (let k = 1; k < L - 1; k++) {
      const i = Math.round(k * (pts.length - 1) / (L - 1));
      if (i <= 0 || i >= pts.length - 1) continue;
      const yr = pts[i].ym.slice(0, 4);
      if (yr === prev) continue;
      parts.push(`<text x="${x(i).toFixed(1)}" y="${H - 4}" text-anchor="middle">${yr}</text>`);
      prev = yr;
    }
    if (parts.length > 1 && last === prev) parts.pop(); // ostatnia pośrednia == prawa kotwica
    parts.push(`<text x="${W - padR}" y="${H - 4}" text-anchor="end">${last}</text>`);
    xLabelSvg = parts.join('\n    ');
  } else {
    xLabelSvg = `<text x="${padL}" y="${H - 4}">${first}</text>
    <text x="${W - padR}" y="${H - 4}" text-anchor="end">${last}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${axisSvg}
    ${yLabelSvg}
    ${xLabelSvg}
    ${lines.join('')}
  </svg>`;
}

// Słupkowy skumulowany: dla każdego rzędu (rok) pionowy słupek złożony
// z segmentów (kapitał + odsetki) piętrzonych od 0. Te same konwencje
// viewBox/osi co chartSVG; etykiety lat na osi X, zł na osi Y.
// Segment może mieć `group` (domyślnie 0) — grupy stoją obok siebie w rzędzie
// (kontrakt vs z nadpłatami); skala = maksimum sumy pojedynczej grupy.
// Dla jednej grupy wzory redukują się dokładnie do wariantu bez grup.
export function stackedBarSVG(rows, segments, { height = 170, width = 440, detail = false } = {}) {
  if (!rows.length) return '';
  const W = width, H = height, padL = 48, padR = 8, padT = 10, padB = 20;
  const G = 1 + Math.max(0, ...segments.map(s => s.group || 0));
  let max = 0;
  for (const r of rows) {
    const sums = new Array(G).fill(0);
    for (const s of segments) sums[s.group || 0] += Math.max(0, s.get(r) || 0);
    max = Math.max(max, ...sums);
  }
  if (max <= 0) max = 1;
  const n = rows.length;
  const innerW = W - padL - padR;
  const slot = innerW / n;
  const bw = Math.max(2, Math.min(slot * 0.7 / G, 28));
  const y = v => padT + (1 - Math.min(v, max) / max) * (H - padT - padB);
  const bars = [];
  rows.forEach((r, i) => {
    const cx = padL + slot * (i + 0.5);
    const bases = new Array(G).fill(0);
    for (const s of segments) {
      const g = s.group || 0;
      const v = Math.max(0, s.get(r) || 0);
      if (v <= 0) continue;
      const gx = cx + (g - (G - 1) / 2) * (bw + 1);
      const yTop = y(bases[g] + v), yBot = y(bases[g]);
      bars.push(`<rect class="${s.cls}" x="${(gx - bw / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, yBot - yTop).toFixed(1)}"/>`);
      bases[g] += v;
    }
  });
  const { axisSvg, yLabelSvg } = yAxisSvg(y, max, padL, padR, W, detail);
  // Oś X: domyślnie etykieta co ceil(n/8) lat; `detail` zagęszcza na szerokim
  // płótnie (dzielnik rośnie z szerokością). Przy width=440 oba wzory zbieżne.
  const labelStep = detail ? Math.ceil(n / Math.max(8, Math.round(W / 55))) : Math.ceil(n / 8);
  const xLabels = rows.map((r, i) => (i % labelStep === 0 || i === n - 1)
    ? `<text x="${(padL + slot * (i + 0.5)).toFixed(1)}" y="${H - 4}" text-anchor="middle">${esc(String(r.year))}</text>` : '').join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">
    ${axisSvg}
    ${yLabelSvg}
    ${bars.join('')}${xLabels}
  </svg>`;
}
