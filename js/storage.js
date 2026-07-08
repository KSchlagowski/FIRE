// storage.js — localStorage z kopią .bak przed każdym zapisem, wersją schematu,
// migracją i eksportem/importem. Backend wstrzykiwalny (testy w Node).

export const SCHEMA_VERSION = 6;
export const KEY = 'fireApp';
export const BAK = 'fireApp.bak';
export const APP_TAG = 'fire-companion';

function memoryBacking() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

const defaultBacking = (typeof localStorage !== 'undefined') ? localStorage : memoryBacking();

export function validateState(s) {
  if (!s || typeof s !== 'object') throw new Error('Stan nie jest obiektem');
  if (typeof s.version !== 'number') throw new Error('Brak wersji schematu');
  if (s.version > SCHEMA_VERSION) {
    throw new Error(`Dane z nowszej wersji aplikacji (v${s.version}) — zaktualizuj aplikację`);
  }
  if (!/^\d{4}-\d{2}$/.test(s.anchorMonth || '')) throw new Error('Nieprawidłowy anchorMonth');
  if (!s.assumptions || typeof s.assumptions.withdrawalRate !== 'number') {
    throw new Error('Brak założeń');
  }
  if (!Array.isArray(s.entries)) throw new Error('Brak listy wpisów');
  for (const e of s.entries) {
    if (!/^\d{4}-\d{2}$/.test(e.month) || typeof e.earned !== 'number' || typeof e.spent !== 'number') {
      throw new Error('Uszkodzony wpis w historii');
    }
  }
  if (!s.housing) throw new Error('Brak sekcji mieszkaniowej');

  // Zakresy stóp (D6): ścieżka importu musi egzekwować to, co UI już wymusza.
  // Stopa ≤ −100% pcha monthlyRate/toReal w NaN/Infinity i po cichu zatruwa
  // każdą wartość pochodną — odrzucamy zamiast po cichu przyjąć.
  const a = s.assumptions;
  const inRange = (v, lo, hi) => typeof v !== 'number' || (v >= lo && v <= hi);
  const realRateFields = ['cashReturnReal', 'realReturnAnnual', 'expenseGrowthReal',
    'incomeGrowthReal', 'inflationAnnual', 'postRetirementReturnReal'];
  for (const f of realRateFields) {
    if (!inRange(a[f], -0.5, 1)) throw new Error(`Stopa ${f} poza zakresem [-50%, 100%]`);
  }
  if (!(a.withdrawalRate > 0)) throw new Error('Stopa wypłat musi być > 0');
  const hp = s.housing.housePlan;
  if (hp) {
    for (const loan of ['mortgage', 'familyLoan']) {
      const r = hp[loan] && hp[loan].rateNominal;
      if (!inRange(r, 0, 0.3)) throw new Error(`Oprocentowanie ${loan} poza zakresem [0%, 30%]`);
    }
  }
  // Kompozycja kont (D6): IKE + IKZE nie może przekroczyć portfela startowego —
  // inaczej kubełek „zwykły" (taxable) wyszedłby ujemny i zaniżył wartość netto.
  const ii = s.taxes && s.taxes.ikeIkze;
  if (ii) {
    const ike = ii.ikeStart || 0, ikze = ii.ikzeStart || 0, port = (a && a.portfolioStart) || 0;
    if (ike + ikze > port + 0.005) {
      throw new Error('Salda startowe IKE + IKZE przekraczają portfel startowy');
    }
  }
  return s;
}

// Łańcuch migracji: każda wersja podnosi o 1 (fall-through do najnowszej).
export function migrate(s) {
  let cur = s;
  switch (cur.version) {
    case 1:
      // v1 → v2: dodaj dług rodzinny (wyłączony) i listę jego korekt.
      if (cur.housing && cur.housing.housePlan && !cur.housing.housePlan.familyLoan) {
        cur.housing.housePlan.familyLoan = {
          enabled: false, startMonth: null, endMonth: null,
          principal: 0, rateNominal: 0, paymentOverrideMonthly: null,
        };
      }
      cur.debt = cur.debt || {};
      if (!Array.isArray(cur.debt.familyOverrides)) cur.debt.familyOverrides = [];
      cur.version = 2;
      // fall-through
    case 2: {
      // v2 → v3: realny zwrot po FIRE (obligacje) — domyślnie marża EDO 2%.
      const a = cur.assumptions || (cur.assumptions = {});
      if (typeof a.postRetirementReturnReal !== 'number') a.postRetirementReturnReal = 0.02;
      cur.version = 3;
    }
    // fall-through
    case 3: {
      // v3 → v4: mrożenie wzrostu wydatków po FIRE — domyślnie jak dotąd (stałe realnie).
      const a = cur.assumptions || (cur.assumptions = {});
      if (typeof a.freezeExpensesAtRetirement !== 'boolean') a.freezeExpensesAtRetirement = true;
      cur.version = 4;
    }
    // fall-through
    case 4:
      // v4 → v5: sekcja podatków (Belka), domyślnie wyłączona.
      if (!cur.taxes || typeof cur.taxes.belkaEnabled !== 'boolean') {
        cur.taxes = { belkaEnabled: false };
      }
      cur.version = 5;
      // fall-through
    case 5:
      // v5 → v6: podsekcja IKE/IKZE, domyślnie wyłączona.
      if (!cur.taxes) cur.taxes = { belkaEnabled: false };
      if (!cur.taxes.ikeIkze) {
        cur.taxes.ikeIkze = { enabled: false, employmentForm: 'employee',
          pitRate: 0.12, ikeStart: 0, ikzeStart: 0 };
      }
      cur.version = 6;
      // fall-through
    case 6:
      break;
    default:
      throw new Error(`Nieznana wersja schematu: ${cur.version}`);
  }
  return cur;
}

function stripDerived(state) {
  const { derived, ...rest } = state;
  return rest;
}

export function makeStorage(backing = defaultBacking) {
  return {
    // → { state, recovered? } | { fresh: true } | { corrupt: true, error }
    load() {
      const raw = backing.getItem(KEY);
      if (raw == null) return { fresh: true };
      try {
        return { state: migrate(validateState(JSON.parse(raw))) };
      } catch (err) {
        const bak = backing.getItem(BAK);
        if (bak != null) {
          try {
            return { state: migrate(validateState(JSON.parse(bak))), recovered: true };
          } catch { /* obie kopie padły */ }
        }
        return { corrupt: true, error: String(err && err.message || err) };
      }
    },

    // .bak zapisywany PRZED każdym zapisem; quota łapana (ostrzeżenie po polsku).
    save(state) {
      try {
        const cur = backing.getItem(KEY);
        if (cur != null) backing.setItem(BAK, cur);
        backing.setItem(KEY, JSON.stringify(stripDerived(state)));
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: 'Nie udało się zapisać danych (brak miejsca w pamięci przeglądarki). ' +
            'Wyeksportuj kopię zapasową i wyczyść dane innych stron.',
          detail: String(err && err.message || err),
        };
      }
    },

    reset() {
      backing.removeItem(KEY);
      backing.removeItem(BAK);
    },
  };
}

export const storage = makeStorage();

// ── Eksport / import ────────────────────────────────────────────────────

export function exportJSON(state, now = new Date()) {
  return JSON.stringify({
    app: APP_TAG,
    version: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    state: stripDerived(state),
  }, null, 2);
}

export function importPreview(text) {
  const doc = JSON.parse(text);
  if (doc.app !== APP_TAG) throw new Error('To nie jest kopia zapasowa FIRE Companion');
  if (typeof doc.version !== 'number' || doc.version > SCHEMA_VERSION) {
    throw new Error('Kopia z nowszej wersji aplikacji — najpierw zaktualizuj aplikację');
  }
  const state = migrate(validateState(doc.state));
  const months = state.entries.map(e => e.month).sort();
  return {
    state,
    exportedAt: doc.exportedAt || null,
    entriesCount: state.entries.length,
    range: months.length ? { from: months[0], to: months[months.length - 1] } : null,
    portfolioStart: state.assumptions.portfolioStart,
    cashStart: state.assumptions.cashStart,
  };
}

export function importJSON(text) {
  return importPreview(text).state;
}
