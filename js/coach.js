// coach.js — biblioteka komunikatów trenera (po polsku) + deterministyczny
// wybór wariantu: ymToIdx(month) % variants.length (rotacja miesięczna).

import { ymToIdx } from './engine.js';
import { formatPLN, formatMonthName } from './format.js';

// verdict × onTrack — min. 3 warianty na kubełek. Ton: mobilizujący,
// konkretny, bez lania wody (spec §6).
const MESSAGES = {
  crushed: {
    on: [
      'Rozjechałeś ten miesiąc. Plan wykonany z nawiązką, a prognoza dalej po Twojej stronie. Tak wygląda kupowanie sobie wolności.',
      'Nadwyżka ponad plan — to są miesiące, które realnie skracają drogę do FIRE. Utrzymaj to tempo, a data przyjdzie szybciej, niż zakładałeś.',
      'Wynik powyżej planu i cel wciąż w zasięgu. Każda taka nadwyżka pracuje na Ciebie procentem składanym przez następne dekady.',
    ],
    off: [
      'Świetny miesiąc — zdecydowanie ponad plan. Prognoza jeszcze nie domyka się do Twojego celu wieku, ale takie miesiące właśnie ją przesuwają. Więcej takich.',
      'Rozbiłeś plan. Jeszcze jedziesz za wolno względem wymarzonej daty, ale jeśli to nie był wyjątek, tylko nowy standard — dogonisz ją.',
      'Ponad plan! Cel wiekowy wciąż ucieka, ale ten miesiąc pokazuje, że stać Cię na więcej, niż zakłada plan. Zrób z tego nawyk.',
    ],
  },
  on_plan: {
    on: [
      'Plan wykonany. Nuda? Nie — konsekwencja. To ona, nie fajerwerki, zaprowadzi Cię do FIRE w terminie.',
      'Kolejny miesiąc zgodnie z planem, prognoza trzyma się Twojego celu. Systematyczność to Twoja najsilniejsza broń.',
      'Dowiozłeś plan. Portfel rośnie dokładnie tak, jak ma rosnąć. Trzymaj kurs.',
    ],
    off: [
      'Plan wykonany — solidnie. Prognoza jest jeszcze za Twoim celem wieku, więc szukaj małych rezerw: każde 200–300 zł miesięcznie robi różnicę na dekadzie.',
      'Miesiąc zgodny z planem. Żeby dogonić wymarzoną datę, potrzebujesz albo trochę wyższych nadwyżek, albo cierpliwości. Obie drogi są uczciwe.',
      'Zrealizowałeś plan co do joty. Cel wiekowy wymaga jednak odrobiny więcej — przejrzyj wydatki, może gdzieś czai się łatwe 5%.',
    ],
  },
  behind: {
    on: [
      'Trochę poniżej planu — zdarza się. Prognoza wciąż broni Twojego celu, więc bez paniki: wróć do rytmu w tym miesiącu.',
      'Ten miesiąc uciekł, ale poduszka w prognozie amortyzuje potknięcie. Jeden słabszy miesiąc nie definiuje roku. Następny należy do Ciebie.',
      'Poniżej planu, ale cel jeszcze niezagrożony. Sprawdź, co poszło nie tak — jednorazowy wydatek czy nawyk? Z nawykami się rozprawiamy.',
    ],
    off: [
      'Poniżej planu, a prognoza i tak była za celem. Czas na szczery przegląd wydatków — wybierz jedną kategorię i przytnij ją w tym miesiącu.',
      'Słabszy miesiąc w słabszym trendzie. Nie musisz być perfekcyjny, musisz być uparty: wróć do planu teraz, a wykres znowu zacznie się piąć.',
      'Ten miesiąc odjechał od planu. Zamiast się biczować — jedna konkretna decyzja: co wytniesz albo dorobisz w najbliższych 30 dniach?',
    ],
  },
  hard: {
    on: [
      'Ciężki miesiąc — wyraźnie poniżej planu. Zdarza się najlepszym. Twoja prognoza wciąż stoi, ale nie funduj jej drugiego takiego ciosu z rzędu.',
      'Duży minus względem planu. Oddech, analiza, powrót: co było jednorazowe, a co może wrócić? Na to drugie przygotuj plan awaryjny.',
      'Mocno poniżej planu, ale marsz do FIRE to maraton. Poduszka w prognozie właśnie po to jest. Następny miesiąc zaczynasz z czystą kartą.',
    ],
    off: [
      'Bolesny miesiąc, a cel i tak wymagał więcej. To moment na twarde decyzje: budżet pod lupę, zbędne subskrypcje precz, przychody do przeglądu.',
      'Duży rozjazd z planem. Nie odwracaj wzroku — właśnie teraz decyduje się, czy FIRE to plan, czy marzenie. Wróć do podstaw: zapisuj, tnij, odkładaj.',
      'Ten miesiąc zabolał. Ale rekordy słabości są po to, żeby się od nich odbić. Jedna rzecz, którą zmienisz od jutra — wybierz ją i trzymaj się jej.',
    ],
  },
};

const FIRST_ENTRY = [
  'Pierwszy wpis za Tobą — to najważniejszy krok, bo od dziś mierzysz. A co mierzysz, tym zarządzasz.',
  'Start! Pierwszy miesiąc zapisany. Od teraz każda pierwsza niedziela… znaczy, każdy 1. dzień miesiąca to Twój rytuał.',
];

const COMEBACK = [
  'Powrót do formy po słabszym miesiącu — to właśnie odróżnia tych, którzy dochodzą do FIRE, od tych, którzy o nim czytają.',
  'Odbiłeś się. Słabszy miesiąc został z tyłu, a Ty znowu na kursie. Tak trzymaj.',
];

const MILESTONES = {
  3: '🔥 3 dobre miesiące z rzędu — masz serię! ',
  6: '🔥🔥 Pół roku konsekwencji — serio, niewielu to potrafi. ',
  12: '🔥🔥🔥 CAŁY ROK ponad planem lub w planie. To już nie seria, to styl życia. ',
};

function pick(variants, month) {
  return variants[ymToIdx(month) % variants.length];
}

// ctx: { verdict, onTrack, streak, month, nextMonth, nextPlan,
//        isFirst, isComeback }
export function coachMessage(ctx) {
  let msg = '';

  if (ctx.isFirst) {
    msg = pick(FIRST_ENTRY, ctx.month);
  } else {
    if (MILESTONES[ctx.streak]) msg += MILESTONES[ctx.streak];
    if (ctx.isComeback && ctx.verdict !== 'behind' && ctx.verdict !== 'hard') {
      msg += pick(COMEBACK, ctx.month) + ' ';
    }
    const bucket = MESSAGES[ctx.verdict] || MESSAGES.on_plan;
    msg += pick(ctx.onTrack ? bucket.on : bucket.off, ctx.month);
  }

  // Zawsze kończymy celem na kolejny miesiąc.
  if (ctx.nextPlan != null && ctx.nextMonth) {
    if (ctx.nextPlan > 0) {
      msg += ` Cel na ${formatMonthName(ctx.nextMonth)}: ${formatPLN(ctx.nextPlan)}.`;
    } else {
      // Lata budowy domu: plan zakłada niedobór — cel to dyscyplina budżetu.
      msg += ` Cel na ${formatMonthName(ctx.nextMonth)}: to miesiąc budowy — utrzymaj niedobór poniżej ${formatPLN(-ctx.nextPlan)}.`;
    }
  }
  return msg;
}

export function verdictLabel(v) {
  return {
    crushed: 'Rozbiłeś plan!',
    on_plan: 'W planie',
    behind: 'Poniżej planu',
    hard: 'Ciężki miesiąc',
  }[v] || v;
}

export function verdictEmoji(v) {
  return { crushed: '🚀', on_plan: '✅', behind: '⚠️', hard: '🌧️' }[v] || '';
}
