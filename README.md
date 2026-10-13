# img-pilot

Edytor i generator zdjęć (OpenAI / Gemini) wbudowany w tryb deweloperski Twojej aplikacji React lub Next.js.

Najeżdżasz kursorem na dowolne zdjęcie w działającej aplikacji → pojawia się mały pasek **Edytuj / Generuj /
Usuń tło** → edytujesz → klikasz **Zatwierdź**. Biblioteka sama zapisuje nowy plik w projekcie i podmienia
odwołanie do niego w kodzie.

Biblioteka jest niezależna od projektu: nie trzeba opakowywać zdjęć ani zmieniać komponentów. Działa tylko w
trybie deweloperskim, w produkcji jest wyłączona.

## Podpinanie przez Claude'a

W projekcie, w którym pracujesz, napisz:

> Podepnij bibliotekę img-pilot z `/home/lukas/personit/img-pilot` — instrukcja jest w `AGENTS.md` w tym folderze.

Plik [AGENTS.md](AGENTS.md) zawiera komplet kroków dla każdego frameworka (jest też w paczce:
`node_modules/img-pilot/AGENTS.md`).

## Podpinanie ręcznie

### 1. Instalacja

Paczka nie jest opublikowana w npm — instaluje się ją z pliku `.tgz`:

```bash
# jednorazowo (i po każdej zmianie w bibliotece), w folderze img-pilot:
npm install && npm run pack:local        # tworzy img-pilot-0.1.0.tgz

# w swoim projekcie:
npm install -D /home/lukas/personit/img-pilot/img-pilot-0.1.0.tgz
```

Nie instaluj samego folderu (`npm i ../img-pilot`) ani przez `npm link` — powstaje wtedy dowiązanie i
biblioteka nie znajduje Reacta z Twojego projektu.

### 2. Integracja

**Next.js (App Router)** — dwa pliki:

```ts
// app/api/img-pilot/[...action]/route.ts
export { GET, POST, OPTIONS } from 'img-pilot/next';
```

```tsx
// app/layout.tsx
import { ImgPilot } from 'img-pilot';
// ...
<body>
  {children}
  <ImgPilot />
</body>
```

**Vite + React** — tylko konfiguracja, interfejs wstrzykuje się sam:

```ts
// vite.config.ts
import imgPilot from 'img-pilot/vite';

export default defineConfig({ plugins: [react(), imgPilot()] });
```

**Next.js (Pages Router), CRA, webpack i inne** — patrz [AGENTS.md](AGENTS.md), sekcje B i D.

### 3. Klucze API

W `.env.local` projektu (wystarczy jeden; narzędzia bez AI działają bez kluczy):

```bash
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
```

Klucze zostają po stronie serwera deweloperskiego i nigdy nie trafiają do przeglądarki. Po zmianie `.env.local`
zrestartuj serwer dev.

### 4. Sprawdzenie

```bash
curl http://localhost:3000/api/img-pilot/status
```

## Jak się tego używa

- **Najedź na zdjęcie** — pojawia się pasek z trzema akcjami. Przytrzymaj `Alt`, żeby złapać także tło CSS
  (`background-image`).
- **Pigułka `img-pilot` w rogu** — włącza i wyłącza podświetlanie (`Alt+I`) oraz otwiera „Nowe zdjęcie”
  (generowanie bez podmiany istniejącego).
- **Zatwierdź** — zapis pliku i podmiana linków. Przed zatwierdzeniem w zakładce **Zapis** widać listę miejsc w
  kodzie, które zostaną zmienione; każde można odznaczyć.

| Zakładka | Co robi                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------- |
| Kadr     | przycinanie (dowolne i w proporcjach), obrót, odbicie lustrzane, zmiana rozmiaru                  |
| Kolory   | jasność, kontrast, nasycenie, barwa, rozmycie, czerń i biel, sepia                                |
| Wymaż    | usuwanie tła (AI), wymazywanie zamalowanego obiektu (AI), wycinanie do przezroczystości, różdżka  |
| AI       | edycja opisem („zmień niebo na zachód słońca”), generowanie nowego zdjęcia w wybranych proporcjach |
| Zapis    | format (PNG / JPEG / WebP), jakość, nazwa pliku, nowy plik lub nadpisanie, lista odwołań          |

Do tego cofanie i ponawianie (`Ctrl+Z`, `Ctrl+Shift+Z`), podgląd oryginału i powrót do oryginału.

### Praca w tle

Zamknięcie okna edytora (`×` albo `Esc`) niczego nie kasuje: historia zmian zostaje, a rozpoczęte zapytanie do AI
działa dalej. W pigułce w rogu pojawia się wtedy nazwa zdjęcia — z kółkiem, gdy AI jeszcze pracuje, i z żółtą
kropką, gdy czekają niezapisane zmiany. Kliknięcie jej (albo „Wróć do edycji” po najechaniu na zdjęcie) otwiera
edytor w tym samym stanie, z działającym cofaniem. Gdy AI skończy przy zamkniętym oknie, pojawia się
powiadomienie. Każde zdjęcie ma osobną sesję, więc w czasie generowania można edytować inne.

Zmiany porzuca dopiero przycisk **Odrzuć**. Sesje żyją w pamięci karty — pełne przeładowanie strony je czyści
(hot reload po zmianie kodu nie).

## Co dokładnie dzieje się po „Zatwierdź”

| Skąd pochodzi zdjęcie                                              | Gdzie trafia plik                  | Co zmienia się w kodzie                          |
| ------------------------------------------------------------------ | ---------------------------------- | ------------------------------------------------ |
| plik w projekcie (`public/…`, `src/assets/…`, `next/image`, import) | obok oryginału, jako `nazwa-edit.png` | każdy string i import wskazujący stary plik      |
| to samo, tryb „Nadpisz oryginalny plik”                            | w miejsce oryginału                | nic                                              |
| zdalny adres `https://…`                                           | `public/img-pilot/`                | dosłowne wystąpienia starego adresu              |
| „Nowe zdjęcie” albo adres z CMS / bazy / składany w runtime        | `public/img-pilot/`                | nic — ścieżka trafia do schowka                  |

Oryginalny plik nigdy nie jest usuwany, a biblioteka nigdy nie nadpisuje innego istniejącego pliku (dokłada
`-2`, `-3`…). Po zapisie hot reload frameworka sam odświeża stronę.

## Modele

| Dostawca | Domyślny model           | Zmiana przez                 |
| -------- | ------------------------ | ---------------------------- |
| OpenAI   | `gpt-image-1`            | `IMG_PILOT_OPENAI_MODEL`     |
| Gemini   | `gemini-2.5-flash-image` | `IMG_PILOT_GEMINI_MODEL`     |

Różnice, o których warto wiedzieć:

- **Usuwanie tła** — OpenAI zwraca prawdziwą przezroczystość. Gemini nie potrafi, więc biblioteka prosi o
  jednolite tło i wycina je lokalnie; przy skomplikowanych krawędziach (włosy, szkło) wynik jest gorszy.
- **Wymazywanie** — poza zamalowanym obszarem zostają oryginalne piksele (wynik AI jest wklejany tylko pod
  maskę), więc reszta zdjęcia nie traci jakości.
- **Rozmiary** — OpenAI generuje tylko 1024×1024, 1536×1024 i 1024×1536; biblioteka sama dobiera najbliższy
  rozmiar i docina wynik do proporcji, o które prosisz.

Pozostałe zmienne: `IMG_PILOT_OPENAI_QUALITY` (`low` / `medium` / `high`), `IMG_PILOT_OUT_DIR` (domyślnie
`public/img-pilot`), `IMG_PILOT_ALLOWED_HOSTS` (gdy otwierasz aplikację przez tunel lub własną domenę).

## Bezpieczeństwo

Serwerowa część zapisuje pliki w projekcie, dlatego:

- odpowiada `404`, gdy `NODE_ENV=production`, a `<ImgPilot />` nic nie renderuje w buildzie produkcyjnym;
- przyjmuje żądania tylko z `localhost` i sieci lokalnej (ochrona przed stronami trzecimi wywołującymi API
  Twojego serwera dev);
- zapisuje wyłącznie wewnątrz katalogu projektu.

## Ograniczenia

- Filtry kolorów wymagają przeglądarki z `CanvasRenderingContext2D.filter` (Chrome, Edge, Firefox; w Safari od
  wersji 18).
- Zdjęcia większe niż 4096 px na dłuższym boku są przy wczytaniu zmniejszane do 4096 px.
- Animowane GIF-y są edytowane jako pojedyncza klatka; SVG jest zamieniane na bitmapę.
- Podmiana linków działa na adresach zapisanych w kodzie wprost. Adresy z CMS, bazy danych lub składane w
  runtime trzeba podmienić u źródła.

## Rozwój biblioteki

```bash
npm install
npm run build        # dist/
npm test             # testy serwera na tymczasowym projekcie i atrapach OpenAI / Gemini
npm run pack:local   # build + img-pilot-0.1.0.tgz
```

| Ścieżka                    | Zawartość                                                             |
| -------------------------- | --------------------------------------------------------------------- |
| `src/client/`              | interfejs: pasek nad zdjęciem, edytor, operacje na canvasie           |
| `src/server/handler.ts`    | API (`status`, `inspect`, `ai`, `apply`) niezależne od frameworka     |
| `src/server/project.ts`    | odnajdywanie pliku źródłowego i odwołań w kodzie                      |
| `src/server/providers.ts`  | wywołania OpenAI i Gemini                                             |
| `src/next.ts`, `src/vite.ts`, `src/cli.ts` | adaptery                                              |
