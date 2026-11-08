# MemskyAI — WycennikAI LIVE v0.5.0 (uniwersalny)

**Pakiet jest kompletnym kodem źródłowym witryny + 3 funkcji Netlify; bez wpisanych sekretów.**

## Wdrożenie

1. Rozpakuj ZIP i otwórz katalog, który zawiera `netlify.toml`, `public/`, `netlify/` oraz `package.json` (nie sam `public/`).
2. W Netlify utwórz nową stronę lub otwórz istniejącą.
3. Dodaj **Environment variables** dla zakresu **Functions** lub **All scopes**:
   - `GROQ_API_KEY` — prawdziwy klucz Groq (nie w kodzie i nie w polu PIN).
   - `WYCENNIKAI_TEST_PIN` — własny losowy, **unikalny** PIN testowy (wymagane >=8 znaków; rekomendowane >=16).
4. Najpewniejsze wdrożenie: wrzuć **cały rozpakowany folder do repozytorium Git** i połącz je z Netlify, ustaw *Publish directory*: `public`, *Functions directory*: `netlify/functions` (ustawienia są już w `netlify.toml`). Alternatywa: [Netlify CLI](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/) w katalogu głównym: `npx netlify-cli login`, `npx netlify-cli link` (lub inicjalizacja nowej strony), `npx netlify-cli deploy --prod --dir=public --functions=netlify/functions`. Po dodaniu sekretów wdrożenie ponów.
5. **Nie wrzucaj wyłącznie folderu `public/` przez Drop**, bo strony statyczne zadziałają, lecz `/.netlify/functions/health`, `/analyze` i `/transcribe` będą zwracać 404. Netlify Drop przy zalogowaniu bywa w stanie zbudować projekt, ale wariant Git/CLI pozwala pewnie sprawdzić obecność funkcji w Deploy logs.
6. W telefonie otwórz nową domenę HTTPS, wprowadź **wartość** `WYCENNIKAI_TEST_PIN` w polu PIN, kliknij **Sprawdź PIN i serwer**, potem START.

## Jak działa

- **UNIVERSAL**: iPhone domyślnie Web Speech (niska latencja); Android domyślnie Groq STT (stabilniejsza transkrypcja); silniki można przełączać ręcznie przed START.
- Groq STT pobiera PCM z Web Audio i przesyła pełne **WAV mono 16 kHz** co około **13 sekund**, z zakładką 1,2 s. Zawieszenia funkcji są pokazywane w UI; kolejka nagrań jest w RAM i oferuje **Ponów STT**.
- Każdy zatwierdzony fragment dopisywany do transkrypcji uruchamia AI LIVE, jeśli PIN jest obecny i automatyczna analiza jest włączona. Analiza trwa osobnym asynchronicznym żądaniem do funkcji Netlify. Przycisk **Analizuj teraz** pozwala rozpocząć ręcznie.
- TXT i karta AI są eksportowane, transkrypcja oraz karta są przechowywane lokalnie w przeglądarce. Audio **nie jest trwałe zapisywane** przez tę aplikację, a po zamknięciu strony oczekujące próbki STT znikają.

## Testowanie i problemy

`npm test` — testy kontraktowe (mock Groq), nie wymaga zależności npm.  
`python tests/browser_smoke.py` — testy logiki mobilnego UI w Chromium z zamockowanym backendem (wymaga Playwright i Chromium; test nie jest emulacją silnika iOS Safari ani realnego mikrofonu).

Komunikat `Funkcja /health nie zwróciła JSON`, `HTTP 404` → brak deployu funkcji.  
`503` → brak `GROQ_API_KEY` lub `WYCENNIKAI_TEST_PIN`, sprawdź scope i redeploy.  
`401` → PIN z przeglądarki różni się od zmiennej `WYCENNIKAI_TEST_PIN`; upewnij się, że nie wpisujesz klucza Groq.  
`429` → limit Groq na STT/AI; przetestuj po odczekaniu, sprawdź limity i plan.  
`502` → Groq zwrócił błąd (np. nieobsługiwany model lub chwilowa niedostępność).  
`504` → timeout komunikacji z Groq.  
Web Speech na Androidzie nie rozpoznaje mowy? Wybierz Groq STT (wymaga uprawnień mikrofonu i PIN).

Wszystkie spotkania testowe prowadź z fikcyjnymi danymi. Wykorzystywanie prawdziwych nagrań wymaga sprawdzenia ochrony danych, zgody uczestników i umów z dostawcami. PIN nie zastępuje produkcyjnego uwierzytelnienia i limitowania nadużyć. Nie jest to jeszcze komercyjny system nagrywania rozmów.

## Pliki

`public/index.html`, `styles.css`, `app.mjs`, `audio.mjs`, `ai.mjs`, `live-core.mjs`, `pcm-worklet.js`, `config.mjs` — aplikacja.  
`netlify/functions/health.mjs` — diagnostyka konfiguracji i PIN.  
`netlify/functions/transcribe.mjs` — Groq Whisper STT.  
`netlify/functions/analyze.mjs` — Groq GPT-OSS analiza.  
`netlify/lib/server-core.mjs` — bezpieczne współdzielone helpery.  
`tests/` — testy kodu, Web Audio WAV i API.
