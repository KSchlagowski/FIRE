# Wdrożenie FIRE Companion na GitHub Pages

Ten przewodnik prowadzi Cię od zera do działającej aplikacji na Twoim telefonie.
Nie musisz umieć programować — wystarczy przeglądarka. Czas: ~15 minut.

## Krok 1 — Konto na GitHubie

1. Wejdź na [github.com](https://github.com) i kliknij **Sign up**.
2. Podaj e-mail, hasło i nazwę użytkownika (np. `kamil123`). Zapamiętaj ją — będzie częścią adresu aplikacji.
3. Potwierdź e-mail.

## Krok 2 — Nowe repozytorium

1. Po zalogowaniu kliknij **+** (prawy górny róg) → **New repository**.
2. **Repository name**: `fire` (może być inna nazwa — będzie częścią adresu).
3. Zaznacz **Public** (wymagane dla darmowego GitHub Pages).
4. Nic więcej nie zaznaczaj. Kliknij **Create repository**.

## Krok 3 — Wgranie plików

**Wariant A — przez przeglądarkę (najprostszy):**

1. W nowym repozytorium kliknij link **uploading an existing file**.
2. Przeciągnij do okna **całą zawartość** katalogu aplikacji:
   `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, `.nojekyll`
   oraz katalogi `js/`, `icons/`, `tests/`, `tools/`.
   > Uwaga: przeglądarka pozwala przeciągać katalogi w całości — przeciągnij je razem z plikami.
3. Na dole kliknij **Commit changes**.

**Wariant B — przez git (jeśli używasz):**

```
git remote add origin https://github.com/TWOJA-NAZWA/fire.git
git push -u origin main
```

## Krok 4 — Włączenie GitHub Pages

1. W repozytorium: **Settings** → w menu bocznym **Pages**.
2. W sekcji **Build and deployment** → **Source** wybierz **Deploy from a branch**.
3. **Branch**: `main`, katalog `/ (root)` → **Save**.
4. Po 1–2 minutach u góry pojawi się adres:
   **`https://TWOJA-NAZWA.github.io/fire/`**
   Otwórz go i sprawdź, czy aplikacja działa (zobaczysz ekran konfiguracji).

## Krok 5 — Instalacja na telefonie (Android)

1. Otwórz `https://TWOJA-NAZWA.github.io/fire/` w **Chrome** na telefonie.
2. Menu **⋮** → **„Zainstaluj aplikację”** (lub „Dodaj do ekranu głównego”).
3. Ikona 🔥 pojawi się na ekranie głównym.
4. **Test offline**: włącz tryb samolotowy i otwórz aplikację — musi działać.
5. Ustaw w telefonie cykliczne przypomnienie: **„1. dnia miesiąca — FIRE check-in”**
   (aplikacja nie może sama wysyłać powiadomień, gdy jest zamknięta).

## Jak wydać aktualizację

1. Zmień pliki lokalnie i sprawdź, że testy przechodzą: `node tests/run-tests.mjs`.
2. Podbij wersję cache w **`sw.js`** (`fire-v1.0.0` → `fire-v1.0.1`) oraz numer
   wersji w stopce **`index.html`** i w **`js/ui.js`** (`APP_VERSION`).
3. Jeśli dodałeś **nowy plik** aplikacji — dopisz go do listy `PRECACHE` w `sw.js`!
4. Wgraj pliki do repozytorium (upload lub `git push`).
5. Na telefonie: otwórz aplikację → pojawi się komunikat
   „Dostępna nowa wersja — dotknij, aby odświeżyć”.

## Kopie zapasowe — ważne!

Dane mieszkają **wyłącznie w pamięci przeglądarki na Twoim telefonie**.
Reinstalacja Chrome, czyszczenie danych lub utrata telefonu = utrata historii.

- Raz na 1–2 miesiące: zakładka **Kopia** → **Eksportuj kopię (JSON)**.
- Zapisz plik na dysku w chmurze (Google Drive, OneDrive…).
- Przywracanie: zakładka **Kopia** → **Import** → wybierz plik → potwierdź.

## Rozwiązywanie problemów

| Problem | Rozwiązanie |
|---|---|
| Strona 404 po włączeniu Pages | Odczekaj 2 minuty; sprawdź, czy `index.html` jest w katalogu głównym repo |
| Brak opcji „Zainstaluj aplikację” | Musi być Chrome + HTTPS (adres `github.io` spełnia to automatycznie) |
| Telefon pokazuje starą wersję | Podbij `CACHE` w `sw.js` przy każdym wydaniu (krok 2 wyżej) |
| Ikony/styles nie ładują się | Upewnij się, że wgrałeś katalogi `js/` i `icons/` z zachowaniem struktury |
