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
      'Wynik ponad plan. Jeszcze jedziesz za wolno względem wymarzonej daty, ale jeśli to nie był wyjątek, tylko nowy standard — dogonisz ją.',
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

// ── Komunikaty motywacyjne (modal po check-inie + karta „Dzisiejsza decyzja") ──
// Losowane w czasie wyświetlania (ui.js podaje seed = Math.random); tu czysto.
// Bez emoji — modal pokazuje verdictEmoji osobno. Ton jak wyżej: wprost,
// konkretnie, w drugiej osobie.

const CELEBRATION = {
  crushed: [
    'Miażdżysz plan! Takie miesiące to paliwo rakietowe dla portfela — wolność przyszła dziś o krok bliżej.',
    'Nadwyżka ponad plan. Przyszły Ty właśnie wysłał podziękowania z hamaka.',
    'To był miesiąc mistrzowski. Każda złotówka ponad plan pracuje teraz na Ciebie przez całe dekady.',
    'Rozbiłeś bank. Nie dlatego, że miałeś farta — dlatego, że podjąłeś dobre decyzje. Powtórz je.',
    'Ponad plan i to z zapasem. Tak właśnie skraca się drogę do FIRE: miesiąc po miesiącu, nadwyżka po nadwyżce.',
    'Wynik, którym można się chwalić. Portfel Ci dziękuje, a data FIRE właśnie mrugnęła okiem.',
    'Zjadłeś ten plan na śniadanie. Utrzymaj apetyt — z takich miesięcy rodzi się wolność.',
    'Świetna robota. To nie przypadek, to procent składany od Twojej dyscypliny. Najlepsza inwestycja, jaką znasz.',
    'Nadwyżka ekstra klasy. Dziś kupiłeś sobie kawałek przyszłości, w której nie musisz pracować.',
    'Wielki miesiąc. Pamiętaj to uczucie — będzie paliwem, gdy przyjdzie chudszy okres.',
  ],
  on_plan: [
    'Plan wykonany. Konsekwencja to supermoc — właśnie jej użyłeś.',
    'Dowiozłeś. Nie musisz być spektakularny — musisz być regularny. I jesteś.',
    'Zgodnie z planem, co do joty. Portfel rośnie dokładnie tak, jak ma rosnąć.',
    'Plan zrealizowany. Nuda? Nie — to dźwięk pieniędzy pracujących w tle.',
    'Trafiłeś w plan. Takie miesiące, powtórzone sto razy, budują wolność.',
    'Solidnie i przewidywalnie. Właśnie tak wygrywa się maraton do FIRE — równym tempem.',
    'Plan dowieziony. Systematyczność bije geniusz, gdy geniusz nie jest systematyczny.',
    'Kolejny miesiąc w planie. Zaufanie do procesu procentuje — dosłownie.',
    'Zrobione. Nie ma fajerwerków, jest kurs prosto na cel. Trzymaj go.',
    'Plan wykonany. Przyszły Ty patrzy na ten miesiąc z uznaniem.',
  ],
  behind: [
    'Poniżej planu — ale spokojnie: jeden miesiąc to punkt, nie trend. Droga do FIRE mierzy się latami.',
    'Ten miesiąc nie wyszedł. Zdarza się każdemu, kto naprawdę gra. Następny należy do Ciebie.',
    'Trochę za mało, ale nie dramatyzujmy. Wróć do rytmu — wykres znowu zacznie się piąć.',
    'Słabszy wynik, ale to Ty tu decydujesz o trendzie, nie jeden miesiąc. Weź kolejny.',
    'Poniżej planu. Sprawdź, co uciekło — jednorazowy wydatek czy nawyk? Z nawykami się rozprawiasz.',
    'Nie ten miesiąc. Ale liczy się, że dalej mierzysz i dalej grasz. To już więcej niż większość.',
    'Trochę w tyle. Zamiast się biczować, wybierz jedną rzecz do poprawy na kolejne 30 dni.',
    'Poniżej planu — potraktuj to jak informację, nie jak wyrok. Jutro zaczynasz z czystą kartą.',
    'Ten miesiąc się nie ułożył. Twoja przewaga to upór, nie perfekcja. Wracaj na kurs.',
    'Mniej, niż zakładał plan. Bez paniki — droga do FIRE ma zakręty, ważne, że jedziesz dalej.',
  ],
  hard: [
    'Ciężki miesiąc. Oddech — takie karty trafiają się w każdej talii. Grasz dalej i to się liczy.',
    'Nie martw się: FIRE nie jest odwołane, najwyżej przesunięte o milimetr. Jutro zaczynasz z czystą kartą.',
    'Bolało, wiem. Ale rekordy słabości są po to, żeby się od nich odbić. Wybierz jedną zmianę i trzymaj się jej.',
    'Trudny miesiąc. Nie odwracaj wzroku od liczb — właśnie teraz najbardziej się liczysz. Wracamy do podstaw.',
    'Duży minus, ale marsz do FIRE to maraton, nie sprint. Jeden ciężki kilometr nie kończy biegu.',
    'Twardy okres. Sprawdź, co było jednorazowe, a co może wrócić — na to drugie zrób plan awaryjny.',
    'Ten miesiąc zabolał. Dobra wiadomość: dno bywa najlepszym punktem odbicia. Odepchnij się.',
    'Ciężko. Ale to, że tu jesteś i domykasz miesiąc mimo wszystko, mówi o Tobie więcej niż wynik.',
    'Słaby miesiąc, mocny człowiek. Nie liczba Cię definiuje, tylko to, co zrobisz w następnym.',
    'Trudny czas — potraktuj go łagodnie. Cel jest wciąż Twój, tylko dziś wiał wiatr w oczy.',
  ],
};

const DECISION = {
  avoided: [
    'Silna wola 1 : 0 impuls. Dobra decyzja — i to policzalna.',
    'Nie kupiłeś — czyli właśnie zapłaciłeś sobie. Najlepszemu wierzycielowi.',
    'Ta drobna „nie” dziś zamienia się w duże „tak” w przyszłości. Zobacz sam.',
    'Powstrzymanie się to też inwestycja — tyle że bez prowizji. Brawo.',
    'Każde takie „odpuszczam” to cegła w murze Twojej wolności. Dokładasz ją właśnie teraz.',
  ],
  invest: [
    'To nie są stracone pieniądze. Edukacja i zdrowie to aktywa, których giełda nie wyceni — a procent składany od nich bywa najwyższy.',
    'Inwestycja w siebie to jedyny wydatek, który zwykle zwraca się z nawiązką. Dobra decyzja.',
    'Zdrowie i wiedza nie mają wykresu, ale mają najlepszą stopę zwrotu, jaką znasz. Wydane mądrze.',
    'To nie ubytek w portfelu — to wpłata na konto „przyszły, lepszy Ty”. Nie liczymy tu strat.',
    'Pieniądze na rozwój pracują inaczej niż te w ETF-ie, ale pracują. I nikt Ci ich nie odbierze.',
  ],
  impulse: [
    'Zdarza się. Zobacz tylko, ile ten zakup kosztował naprawdę — niech to będzie argument przy następnej okazji.',
    'OK, kupione. Ale w cenach z dnia FIRE ten paragon wygląda tak:',
    'Nic się nie stało. Warto jednak wiedzieć, ile ta chwila naprawdę kosztuje w skali dekad:',
    'Impuls wygrał tę rundę. Popatrz na prawdziwą cenę — następnym razem łatwiej będzie odpuścić.',
    'Kupione i już. Zapamiętaj tylko liczbę poniżej — to koszt tej decyzji mierzony w Twojej wolności.',
  ],
};

function pickSeeded(variants, seed) {
  const i = ((Math.trunc(seed) % variants.length) + variants.length) % variants.length;
  return variants[i];
}

export function checkinCelebration(verdict, seed) {
  return pickSeeded(CELEBRATION[verdict] || CELEBRATION.on_plan, seed);
}

export function decisionMessage(kind, seed) {
  return pickSeeded(DECISION[kind] || DECISION.avoided, seed);
}

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
    crushed: 'Ponad plan!',
    on_plan: 'W planie',
    behind: 'Poniżej planu',
    hard: 'Ciężki miesiąc',
  }[v] || v;
}

export function verdictEmoji(v) {
  return { crushed: '🚀', on_plan: '✅', behind: '⚠️', hard: '🌧️' }[v] || '';
}
