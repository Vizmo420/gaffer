# Gaffer

Open-source'owy asystent menedżera Hattrick: pobiera dane Twojej drużyny z
oficjalnego API gry (CHPP) i w przeglądarce dobiera najlepszy skład, analizuje
kadrę, trening, ekonomię, transfery i rywali w lidze.

**Demo (dane przykładowe):** https://vizmo420.github.io/gaffer/

Licencja: [MIT](LICENSE). Projekt jest darmowy i publiczny — możesz go
uruchomić lokalnie albo forknąć. Twoje dane nigdy nie trafiają na żaden serwer:
klient CLI odpytuje CHPP z Twojego komputera, interfejs działa w przeglądarce.

**Architektura (świadomy wybór):** jednorazowe komendy CLI, **bez stałego
serwera**. Logowanie raz (link + kod), token zapisany lokalnie. CLI pobiera dane
do `data/squad.json`, a interfejs webowy je wczytuje.

```
Hattrick/
  cli.js              komendy jednorazowe (squad, snapshot, changes, matches, similar, youth-debug)
  lib/
    oauth.js          podpisywanie OAuth 1.0a (HMAC-SHA1)
    hattrick.js       klient CHPP + mapowanie XML -> obiekty
    db.js             SQLite: migawki składu + diff
  server.js           OPCJONALNY Express (alternatywa dla CLI)
  scripts/serve-web.js  mały statyczny serwer dla web/ + data/
  web/                interfejs: optymalizator, mapa umiejętności, kadra
  data/               tu lądują squad.json, youth-raw.json, data.sqlite
```

## 1. Rejestracja aplikacji CHPP

1. Zaloguj się na <https://www.hattrick.org>.
2. **Moje Hattrick → Ustawienia → CHPP** (Zarządzaj aplikacjami CHPP).
3. Utwórz nową aplikację. Do testów dostajesz dostęp od razu (tryb ograniczony).
4. Zapisz **Consumer Key** i **Consumer Secret**.
   - Dla trybu serwerowego ustaw też Callback URL na `http://localhost:3001/auth/callback`.
   - Dla trybu CLI callback nie jest potrzebny (używamy „oob").

## 2. Instalacja

```bash
cd Hattrick
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Wpisz w `.env`:

```
CHPP_CONSUMER_KEY=...
CHPP_CONSUMER_SECRET=...
```

## 3. Pierwsze uruchomienie (logowanie)

```bash
node cli.js squad
```

Przy pierwszym uruchomieniu skrypt:

1. wypisze link — otwórz go w przeglądarce, zaloguj się do Hattricka,
2. kliknij „Zezwól / Grant access" — Hattrick pokaże **kod weryfikacyjny**,
3. wklej kod do terminala.

Token zapisze się w `.hattrick-token.json`. Kolejne komendy już nie pytają.
Zmiana konta: dowolna komenda z flagą `--reauth`.

## 4. Komendy

| Komenda | Co robi |
|---|---|
| `node cli.js sync` | `squad` + `youth` + `matches` + `snapshot` za jednym zamachem. Najprostszy sposób odświeżenia wszystkiego. |
| `node cli.js squad` | Pobiera skład → `data/squad.json`. Sam wylicza „tygodnie bez meczu" i zbiera oceny (`RatingStars`) z ostatnich meczów. `--no-inactivity` pomija dociąganie meczów. |
| `node cli.js youth` | Pobiera skład młodzieżowy → `data/youth-squad.json` (format: bieżąca/maks; „—" = nieujawnione). Nazwa pliku CHPP nie jest zweryfikowana — patrz `youth-debug`. |
| `node cli.js team` | Dane własnej drużyny → `data/team.json` (PowerRating, trener; nastrój/pewność siebie jeśli CHPP je zwraca). |
| `node cli.js snapshot` | Zapisuje migawkę składu do SQLite. |
| `node cli.js changes` | Diff dwóch ostatnich migawek → `data/changes.json` (nowi / odeszli / zmiany umiejętności). |
| `node cli.js matches` | Lista meczów → `data/matches.json` (rozegrane + nadchodzące). |
| `node cli.js transfers` | Historia transferów → `data/transfers.json` (P&L + „Znajdź podobnych"). |
| `node cli.js scout …` | Skaner rynku (`transfersearch`) → `data/scout.json`. Flagi: `--pos=WB --skill=defending --min=10 --ageMax=27 --priceMax=900000 --tsiMax=400000`. |
| `node cli.js watch add <teamId>` | Dodaj drużynę do Kroniki (`watch remove <teamId>`, samo `watch` = lista). |
| `node cli.js chronicle` | Kronika Klubu: metryki śledzonych drużyn (PowerRating, tabela ligi, TSI, stadion, forma…) → `data/chronicle.json` + migawki do diffu. |
| `node cli.js opponent <teamId>` | Publiczny podgląd rywala → `data/opponent-<teamId>.json`. Legalne — `teamdetails` jest publiczne dla każdej drużyny; żaden scraping. |
| `node cli.js changes --youth` | Diff migawek młodzieżówki → `data/changes-youth.json`. |
| `node cli.js similar <playerId>` | Transfery Twojej drużyny o TSI zbliżonym do wskazanego zawodnika (patrz ograniczenia). |
| `node cli.js youth-debug` | Surowa odpowiedź młodzieżówki → `data/youth-raw.json` + podgląd. |

## 5. Interfejs webowy

```bash
npm run web       # http://localhost:5173
```

Serwer statyczny udostępnia `web/` oraz `data/`, więc strona **sama wczyta**
`data/squad.json`, `data/youth-squad.json` i `data/matches.json` po uruchomieniu
(przycisk „↻ Dane" wczytuje ponownie). Alternatywnie: przycisk **„Importuj skład"**.
Ręczne pola (trenowany, wychowanek, dni w klubie, ręczna średnia ocena) zapisują
się w `localStorage` tej przeglądarki.

Interfejs: powłoka z **bocznym menu** pogrupowanym w sekcje (Skład / Kadra /
Drużyna / Śledzenie / Młodzież), stały nagłówek widoku, **przełącznik motywu
jasny/ciemny** (◐ w prawym górnym rogu; domyślnie wg systemu). Optymalizator
otwiera się jako pierwszy; drugorzędne ustawienia są zwinięte pod „Więcej opcji".

Widoki:

- **Kadra** — sortowalna, edytowalna tabela: umiejętności, specjalność, `Tren.` /
  `Wych.` / `Dni` (ręczne), `Śr. ocena` (ręczna nadpisuje średnią z meczów),
  `Szac. wartość` (zgrubny orientacyjny szacunek z TSI — nie wycena rynkowa).
- **Optymalizator** — kryterium **wg umiejętności** albo **wg ocen z meczów**;
  auto-dobór formacji lub formacja ustalona; tryb „z treningiem" + raport
  pełny/częściowy/brak; Skład A / Skład B; filtry nieaktywnych **i zawieszonych
  (≥3 żółte)**; bonus lojalności/wychowanka; **klik** = ranking i blokada,
  **przeciągnij** = zamiana slotów, **↶ Cofnij**; **oceny sektorów** (Obrona/
  Pomoc/Atak, wartości względne, korygowane **nastrojem i pewnością siebie**) +
  **kontr-ustawienie** po wpisaniu ocen rywala; **wkład każdego zawodnika** w
  sektory; **zmęczenie** (przybliżona minuta spadku formy) + **sugerowane 3
  zmiany**; **pogoda** → wpływ na specjalistów w składzie; rekomendacja
  **wykonawcy SF** i **kapitana**; **panel wag pozycji** (suwaki, zapis);
  **presety** ustawień; **kopiuj skład (tekst)**; **eksport raportu (MD)**.
- **Trening** *(szacunki)* — po wpisaniu typu treningu, intensywności, poziomu
  trenera i asystentów: „~tygodni do następnego poziomu" oraz przewidywany
  poziom **+4 / +8 / +13 tyg.** dla trenowanych, ranking **„kogo trenować"**,
  ostrzeżenie o bliskim skoku pensji.
- **Mapa umiejętności** — kolorowe kafelki, 2 najlepsze pogrubione, ★ przy maksie.
- **Mapa ocen** — siatka gracz × ostatnie mecze (`RatingStars`), kolumna `Śr.`
  edytowalna, wpływa na optymalizację „wg ocen".
- **Ekonomia** — suma pensji, pensje najlepszej 11, TSI/pensja, ranking
  efektywności, lista „martwego balastu", **piramida wieku** kadry.
- **Historia** — tabela formy z `data/matches.json` (W/R/P, bramki, dom/wyjazd),
  trendy ocen (iskierki + Δ), „zawodnik okresu" oraz **zmiany od ostatniej
  migawki** (nowi / odeszli / skoki umiejętności, z `data/changes.json`).
- **Mecze** — z `data/matches.json`; „Ustaw skład" przy nadchodzącym meczu
  przenosi do optymalizatora; **podgląd rywali** z `data/opponent-*.json`.
- **Kronika** — śledzenie innych drużyn (`cli.js watch add`, `cli.js chronicle`):
  karty z PowerRating, tabelą ligi, TSI, stadionem, formą; zmiany od ostatniej
  migawki; konfiguracja które metryki pokazywać.
- **Młodzież** — kryteria **potencjał / bieżące / wg ocen / wokół gwiazdy**;
  interaktywne boisko (klik = blokada, przeciągnij = zamiana); filtr „tylko
  ujawnione"; auto-wykrycie **gwiazdy** (heurystyka, nadpisywalna); sortowalna
  kadra, mapa umiejętności bieżąca/maks z ★, mapa ocen, mecze młodzieży, zmiany;
  **planer awansu** (potencjał, zgrubna wartość, komentarz skauta, rekomendacja).

### Funkcje, których nie mają inne narzędzia

- **Kalibracja wag z Twoich ocen** — regresja grzbietowa wag pozycji do Twoich
  `RatingStars` + pozycji z meczów (przycisk „Dopasuj z moich ocen" w panelu
  wag). Mało próbek na pozycję → zostaje domyślna.
- **Analiza głębi kadry** — leave-one-out (ile Σ traci najlepsza XI bez każdego
  zawodnika) + głębia per pozycja (różnica 1. vs 2. opcja).
- **„Wyjaśnij ocenę"** — klik w liczbę na boisku → rozbicie: skill × waga ×
  wkład, mnożniki formy/kondycji, bonusy. Plus **bliskie decyzje** — sloty gdzie
  rekomendacja jest krucha (przerywana ramka).
- **Karta oceny A–F** — obrona / pomoc / atak / ławka / ekonomia / młodzież /
  wiek + wskazana największa słabość (na górze Optymalizatora).
- **Trening jako inwestycja** — kolumny Wartość + / Pensja + / Zwrot (tyg.).
- **Planer rotacji** (Mecze) — trudność meczu wg PowerRating rywala →
  rotacja/trening vs pełna siła, z podpowiedzią kogo oszczędzić.
- **Radar zagrożeń** (Kronika) — kto zbroi się (TSI/PR w górę), kto buduje stadion.
- **Porównanie zawodników** (Zawodnicy) — 2–3 obok siebie: umiejętności z
  podświetleniem lepszego, TSI, pensja, specjalność, szac. wartość, najlepsza
  pozycja z oceną.
- **Skaner rynku** (Transfery) — `transfersearch` **zwraca umiejętności** graczy
  wystawionych. Ustaw kryteria → „Kopiuj komendę" → `node cli.js scout …` →
  wyniki z oceną na Twoją pozycję, **Σ-zyskiem jeśli kupisz** (marginal value)
  i **zł/Σ**. Plus **P&L transferowe** (wydano / zarobiono / netto).
- **Prywatność** — wszystko lokalnie, żadnych danych na serwer.
- **Import CSV** — przycisk „Importuj" wczytuje eksport kadry (CSV, PL) obok
  formatu JSON. Działa bez CHPP: umiejętności, TSI, pensja, specjalność,
  lojalność, wychowanek, kartki i jedna ocena meczowa (z pozycją) na gracza.

Interfejs jest instalowalny jako **PWA** (manifest + service worker) — działa
też offline na ostatnio wczytanych danych.

**Wersja jednoplikowa (telefon / bez serwera):**

```bash
npm run standalone     # tworzy hattrick-standalone.html
```

Jeden plik HTML ze wszystkim w środku — otwierasz wprost w przeglądarce albo
przenosisz na telefon. Działa na danych przykładowych; przycisk „Importuj skład"
nadal wczyta `data/squad.json`, jeśli go wskażesz.

> **Uwaga o szacunkach:** projekcja treningu, oceny sektorów, wycena zawodnika i
> planer awansu opierają się na aproksymacjach społeczności (Hattrick nie
> publikuje wzorów). Traktuj je jak trend, nie jak dokładne wartości.

### Auto-odświeżanie danych (Windows)

Jeśli token CHPP zostanie odrzucony, `cli.js` sam skasuje `.hattrick-token.json`
i poprosi o ponowne logowanie. Żeby dane odświeżały się codziennie same, dodaj
zadanie w Harmonogramie zadań Windows:

```powershell
schtasks /create /tn "Hattrick sync" /tr "cmd /c cd /d C:\Users\marti\Desktop\Forma2\Strona\Hattrick && node cli.js sync" /sc daily /st 08:00
```

(pierwsze uruchomienie musi być ręczne — trzeba raz wkleić kod logowania).

## 6. Tryb serwerowy (opcjonalny)

Jeśli wolisz żywe API zamiast importu plików:

```bash
npm install express express-session cors
# w .env: APP_BASE_URL, FRONTEND_URL, SESSION_SECRET
npm run server                       # http://localhost:3001
# zaloguj się: http://localhost:3001/auth/login
```

Endpointy: `/api/squad`, `/api/matches`, `/api/players/similar`. Token trzymany
w cookie sesji, nie w pliku. To dwa niezależne „zalogowania" — token CLI
(`.hattrick-token.json`) i sesja serwera się nie dzielą.

## Czego CHPP nie daje (i dlaczego coś zostaje ręczne)

- **Lojalność / bonus wychowanka klubu** — w zależności od wersji pliku
  `players` mogą nie być eksportowane. Widać je na stronie zawodnika, ale
  scraping strony jest **zabroniony regulaminem Hattricka** (ryzyko bana).
  `hattrick.js` weźmie te pola, jeśli są w XML; jeśli nie — uzupełniasz ręcznie.
- **„Trenowany"** dla seniorów to Twoja decyzja, nie flaga z gry.
- **Wyszukiwanie rynku po umiejętnościach** — CHPP tego nie ma. `similar`
  dopasowuje tylko po TSI (jedyny publiczny wskaźnik cudzych zawodników).
- **Wysyłka składu / zmiana treningu do gry** (`matchOrders`) — nie zrobione
  celowo: brak pewnej, aktualnej dokumentacji parametrów, a zły format zapisu
  może zepsuć skład na prawdziwy mecz. Jeśli masz dostęp do dokumentacji
  `matchOrders` w panelu CHPP swojej aplikacji — wklej ją, dokończymy bezpiecznie.
- **Młodzieżówka** — nazwy pól nie są zweryfikowane (dokumentacja `players`
  przestała być aktualizowana zanim powstał plik młodzieżowy). Stąd
  `youth-debug` — najpierw zobaczmy surową odpowiedź, potem mapowanie.

## Dostrajanie wag oceny

Wagi umiejętności per pozycja są w `web/optimizer.js` (`WEIGHTS`). To
aproksymacje społeczności — Hattrick nie publikuje wzoru silnika meczowego.
Warto je z czasem stroić pod realne wyniki Twoich meczów.
