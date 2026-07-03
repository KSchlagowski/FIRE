# FIRE Companion 🔥

Motywacyjna, **prywatna i offline'owa** aplikacja PWA śledząca Twoją drogę do FIRE
(Financial Independence, Retire Early). Całość po polsku, kwoty w PLN, dane
wyłącznie na Twoim urządzeniu (localStorage) — zero kont, zero chmury, zero analityki.

## Rytuał

1\. dnia każdego miesiąca wpisujesz, ile w poprzednim miesiącu **zarobiłeś** i **wydałeś**
(opcjonalnie: nadpłatę kredytu). Aplikacja aktualizuje salda, porównuje wynik z planem,
pokazuje postęp i mobilizujący komentarz trenera.

## Model finansowy (skrót)

- Wszystko liczone **realnie** (w dzisiejszych złotówkach); jedynie kredyt jest nominalny
  (kontrakt) i jest przeliczany deflatorem.
- **Dwa kubełki**: gotówka (fundusz na dom) i portfel inwestycyjny (liczy się do FIRE).
- Cykl życia: oszczędzanie na dom → wydatek na dom + lata kredytu (strategia:
  **najpierw dług, potem inwestowanie**) → akumulacja → FIRE.
- **FIRE** = portfel ≥ ruchomy cel (wydatki × 12 / WR, rosnące z `g_exp`) **oraz** dług = 0.
- Werdykty miesiąca: skala `S = max(|plan|, 500)`; ≥ plan+0,15·S → „Rozbiłeś plan!”,
  ≥ plan → „W planie”, ≥ plan−0,40·S → „Poniżej planu”, inaczej „Ciężki miesiąc”.
- Salda nigdy nie są zapisywane jako prawda — zawsze wyliczane od nowa (replay)
  z historii wpisów; korekty sald to jawne nadpisania w łańcuchu.

## Struktura

```
index.html            # shell aplikacji
styles.css            # style (dark mode, mobile-first)
sw.js                 # service worker (offline)
manifest.webmanifest  # manifest PWA
js/engine.js          # czysty silnik finansowy (zero DOM)
js/coach.js           # komunikaty trenera
js/format.js          # formatowanie pl-PL
js/storage.js         # localStorage + .bak + eksport/import
js/ui.js, js/app.js   # ekrany, router, bootstrap
tests/                # testy silnika (Node + przeglądarka)
tools/make-icons.html # generator ikon (canvas)
WDROZENIE.md          # przewodnik wdrożenia na GitHub Pages
```

## Testy

```
node tests/run-tests.mjs     # kod wyjścia 0 = wszystko zielone
```

albo otwórz `tests/tests.html` w przeglądarce (przez serwer HTTP, patrz niżej).
Fikstury F1–F12 obejmują m.in. parytet z arkuszem `Kalkulator_FIRE.xlsx`
(konwencja roczna, annuitet kredytu, cele FIRE), plan 3-fazowy, progi werdyktów,
routing dwóch kubełków i odzysk z kopii `.bak`.

## Uruchomienie lokalne i weryfikacja PWA

1. W katalogu repo: `python -m http.server 8000` → `http://localhost:8000/`
   (localhost to bezpieczny kontekst — service worker działa po HTTP).
2. DevTools → **Application** → *Manifest* (instalowalność) i *Service Workers* (activated).
3. **Network → Offline** → twarde przeładowanie → aplikacja działa; dodaj check-in offline.
4. **Próba podścieżki** (jak na GitHub Pages): serwuj katalog nadrzędny
   (`cd .. && python -m http.server 8000`) i otwórz `http://localhost:8000/fire/` —
   wyłapie każdą absolutną ścieżkę.
5. Po wdrożeniu, na telefonie: Chrome ⋮ → „Zainstaluj aplikację”; test w trybie samolotowym.
6. Podczas prac dev: DevTools → Application → Service Workers → zaznacz **Update on reload**.

## Checklist wydania

- [ ] `node tests/run-tests.mjs` → 0 błędów
- [ ] Podbita wersja `CACHE` w `sw.js` (np. `fire-v1.0.1`)
- [ ] Podbita wersja w stopce `index.html` i `APP_VERSION` w `js/ui.js`
- [ ] Nowe pliki aplikacji dopisane do `PRECACHE` w `sw.js`
- [ ] Próba podścieżki (`/fire/`) przechodzi
- [ ] Po deployu: aplikacja pokazuje toast aktualizacji i działa offline

## Wdrożenie

Pełny przewodnik krok po kroku (konto GitHub → repo → Pages → instalacja na
Androidzie → aktualizacje → kopie zapasowe): **[WDROZENIE.md](WDROZENIE.md)**.
