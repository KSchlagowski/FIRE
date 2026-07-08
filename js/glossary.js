// glossary.js — czysty builder HTML ekranu „Słowniczek" (#/slowniczek).
// Zero DOM, zero stanu modułu, zero importów: statyczna lista pojęć wchodzi
// w string HTML. Wpisy mają stałe id (slug) — deep-linki #/slowniczek/:term
// z bloków „Jak to liczymy?" w analysis.js/simulation.js celują w te id.

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Kolejność = kolejność na ekranie: od pojęć najbardziej podstawowych.
const TERMS = [
  {
    id: 'realnie',
    term: 'Realnie vs nominalnie',
    body: 'Kwota realna jest w dzisiejszych złotówkach — od razu wiesz, ile to „naprawdę” jest warte. Kwota nominalna to przyszłe złotówki, napompowane inflacją. Prawie wszystko w aplikacji liczone jest realnie; nominalne są tylko dwa kontrakty — kredyt hipoteczny i dług rodzinny — bo ich raty są zapisane w umowie w przyszłych złotówkach.',
  },
  {
    id: 'swr',
    term: 'Stopa wypłat (SWR)',
    body: 'Ile procent portfela wypłacasz rocznie po przejściu na FIRE. Klasyka to 4% — portfel musi być wart 25× Twoich rocznych wydatków. Niższa stopa (np. 3,5%) oznacza większy portfel na starcie, ale większy margines bezpieczeństwa na złe lata na rynku.',
  },
  {
    id: 'cel-fire',
    term: 'Cel FIRE i cel ruchomy',
    body: 'Cel FIRE to portfel, przy którym możesz przestać pracować dla pieniędzy: roczne wydatki ÷ stopa wypłat. W aplikacji cel jest „ruchomy” — rośnie razem z planowanym realnym wzrostem Twoich wydatków, bo droższy styl życia wymaga większego portfela.',
  },
  {
    id: 'fi-procent',
    term: 'FI%',
    body: 'Twój postęp do celu FIRE: portfel ÷ cel, w procentach. 50% znaczy, że masz już połowę potrzebnego portfela. Liczy się tylko portfel inwestycyjny — gotówka odkładana na dom ma osobne zadanie.',
  },
  {
    id: 'coast-fire',
    term: 'Coast FIRE',
    body: 'Kwota, od której portfel sam — bez ani jednej nowej wpłaty — urośnie do celu FIRE do Twojego docelowego wieku. Po jej osiągnięciu wystarczy zarabiać na bieżące życie; procent składany dokończy robotę.',
  },
  {
    id: 'zapas',
    term: 'Zapas (runway)',
    body: 'Na ile miesięcy życia starczą Twoje oszczędności (gotówka + portfel), gdyby dochody dziś spadły do zera: oszczędności ÷ miesięczne wydatki. Miara bezpieczeństwa, nie postępu.',
  },
  {
    id: 'annuitet',
    term: 'Rata równa (annuitet)',
    body: 'Sposób spłaty kredytu, w którym każda rata jest taka sama przez cały okres. Na początku rata to głównie odsetki i odrobina kapitału; z czasem proporcja się odwraca. Tak spłacany jest zarówno kredyt hipoteczny, jak i dług rodzinny w aplikacji.',
  },
  {
    id: 'nadplata',
    term: 'Nadpłata',
    body: 'Kwota wpłacona na kredyt ponad ratę. Cała idzie w kapitał, więc skraca kredyt i obcina przyszłe odsetki. Strategia aplikacji: każda miesięczna nadwyżka nadpłaca kredyt hipoteczny; dług rodzinny przyspieszają tylko jawne nadpłaty wpisane w check-inie.',
  },
  {
    id: 'belka',
    term: 'Podatek Belki i koszt nabycia',
    body: 'Podatek Belki to 19% od zysków kapitałowych, płacony przy wypłacie. Koszt nabycia (basis) to suma złotówek, które faktycznie wpłaciłeś — od nich podatku nie ma; opodatkowany jest tylko zysk ponad nie. Liczy się nominalnie, więc zysk czysto inflacyjny też jest opodatkowany.',
  },
  {
    id: 'dwa-kubelki',
    term: 'Dwa kubełki',
    body: 'Aplikacja trzyma pieniądze w dwóch kubełkach: gotówka (fundusz na dom — wkład własny, budowa) i portfel inwestycyjny (liczy się do FIRE). Nadwyżka najpierw buduje gotówkę, w czasie spłaty długu nadpłaca kredyt, a po spłacie płynie do portfela. Niedobory drenują najpierw gotówkę, potem portfel.',
  },
  {
    id: 'plan-fazowy',
    term: 'Plan fazowy i miesiąc budowy',
    body: 'Twój plan oszczędzania zmienia się fazami: przed kredytem budujesz gotówkę, w czasie kredytu nadpłacasz dług, po spłacie inwestujesz wszystko. Miesiąc budowy to miesiąc z ujemnym planem — np. duży wydatek na dom — w którym zaplanowane jest zejście oszczędności w dół, nie ich wzrost.',
  },
  {
    id: 'werdykty',
    term: 'Werdykty i skala S',
    body: 'Po każdym check-inie miesiąc dostaje werdykt: porównujemy, ile odłożyłeś, z planem zamrożonym przy zapisie wpisu. Skala S = większa z |planu| i 500 zł — dzięki niej ocena działa też przy małych i ujemnych planach. Powyżej planu + 0,15·S — „zmiażdżone”, od planu w dół do planu − 0,40·S — „poniżej”, niżej — „trudny miesiąc”.',
  },
  {
    id: 'seria',
    term: 'Seria',
    body: 'Liczba kolejnych miesięcy z werdyktem co najmniej „zgodnie z planem”, licząc wstecz od ostatniego wpisu. Trudny miesiąc przerywa serię; korekta salda — nie.',
  },
  {
    id: 'korekty',
    term: 'Korekty sald',
    body: 'Ręczne wyrównanie gotówki, portfela lub długu do stanu faktycznego (Plan → Korekty sald). Korekta nie jest wpłatą — od miesiąca korekty saldo liczy się od nowej wartości, a historia wpisów zostaje nietknięta. Rozjazd trafia do „wzrostu rynkowego” z gwiazdką.',
  },
  {
    id: 'delta',
    term: 'Prognoza „wg planu” vs delta',
    body: 'Świeża prognoza zakłada, że co miesiąc odkładasz dokładnie tyle, ile w planie („wg planu”). Po 3 wpisach prognoza uczy się Twoich realnych wyników: do planu dolicza deltę — średnią różnicę między tym, co odkładasz naprawdę, a planem.',
  },
  {
    id: 'do-zera',
    term: '„Do zera” (die with zero)',
    body: 'Alternatywa dla klasycznego celu: zamiast portfela, który starcza „na zawsze”, liczymy taki, który wystarczy dokładnie do założonego wieku i skończy się na zerze. Potrzebny kapitał jest mniejszy, więc FIRE bywa wcześniej — ale pieniądze kończą się zgodnie z planem.',
  },
];

export function termIds() {
  return TERMS.map(t => t.id);
}

export function glossaryScreen() {
  return `<div class="card"><h2>Słowniczek 📖</h2>
    <p class="muted small">Pojęcia używane w aplikacji, wyjaśnione po ludzku. Linki w blokach „Jak to liczymy?” prowadzą prosto do wpisu.</p>
    ${TERMS.map(t => `<div class="gl-entry" id="gl-${t.id}">
      <h3>${esc(t.term)}</h3>
      <p>${esc(t.body)}</p>
    </div>`).join('')}
  </div>`;
}
