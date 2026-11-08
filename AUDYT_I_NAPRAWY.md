# MemskyAI — WycennikAI LIVE v0.5.0 | audyt 2026-11-08

Materiał: archiwum `Lolklo-main.zip` (15 wpisów, 9 plików). Bez dostępu do produkcyjnego logu Netlify, rzeczywistych zmiennych środowiska, prawdziwych kluczy i urządzeń mobilnych: nie można potwierdzić na żywo działania całego łańcucha z usługą Groq. Poniżej **potwierdzone błędy w kodzie** oraz **prawdopodobne przyczyny objawów**.

## Błędy i naprawy

| Ważność | Ustalenie źródłowe | Skutek | Zmiana w 0.5.0 |
| --- | --- | --- | --- |
| Krytyczny | `Public/Index.html` z dużym `I`; brak `index.html` | Na Netlify wejście pod `/` może kończyć się 404 | `public/index.html` oraz zgodny `publish` w `netlify.toml` |
| Krytyczny | `Tests/ai-live.test.mjs` importuje `../public/live-core.mjs`, podczas gdy katalog to `Public` | Testy nie przechodzą na case-sensitive Linux (potwierdzone `ERR_MODULE_NOT_FOUND`) | Spójne nazwy katalogów i 9 nowych testów |
| Wysoki | Dwa różne `netlify/Functions/Analyze.mjs` i `netlify/functions/analyze.mjs` | Różne wersje 0.3.0/0.3.1, ryzyko błędnego wyboru i wdrożenia | Jeden `netlify/functions/analyze.mjs` |
| Wysoki | Tryb Web Speech jest jedyną drogą STT | Android zrywający sesję lub bez finalnych wyników nie daje danych do analizy AI | Groq Whisper STT z Web Audio/WAV, Android domyślnie cloud |
| Wysoki | AI uruchamiane wyłącznie na zdarzeniu zatwierdzonego `isFinal` | Jeśli transkrypcja jest pusta/niezatwierdzona, AI LIVE nie otrzymuje fragmentów | Segmenty serwerowej transkrypcji wyzwalają aktualizację AI |
| Wysoki | `ai.mjs` żąda `/analyze` bez wstępnej weryfikacji endpointu i sekretów | PIN wygląda jak uszkodzony, gdy nie wdrożono funkcji, brakuje env lub PIN jest błędny | Endpoint `/health` GET/POST, przycisk Sprawdź PIN, kody błędów 404/401/503/429 |
| Średni | Oryginał używa tylko `sessionStorage` na PIN i słabo opisuje konfigurację backendu | Brak diagnozy na telefonie; błędy ustawień wyglądają jak błąd UI | Jawne ustawienia Netlify, komunikaty HTTP, kontrola wersji serwera |
| Średni | Web Speech restart / cisza / `onend` zależy od implementacji przeglądarki | Android może wielokrotnie tracić nasłuch | Osobny retry/backoff i silnik z PCM jako domyślny Android |
| Średni | Brak przekazania nieprzetworzonych próbek audio do ponownej próby | Krótkie zrywanie Groq powoduje straty w rozmowie | Kolejka w RAM i ręczne Ponów STT; nie obiecujemy trwałego buforowania |
| Średni | Brak prostej weryfikacji spójności deployu frontend/backend | Frontend i funkcje mogą mieć różne wersje | `/health` pokazuje wersję backendu i konfigurację |

## Znane ograniczenia (nie rozwiązane przez sam frontend)

- **Prawdziwe live słowo po słowie** w trybie Groq STT nie jest celem tej wersji: wynik po około 13 sekundach plus czas transmisji i rozpoznania. Web Speech daje interim tam, gdzie jest dostępny.
- Rozpoznawanie głosu na zablokowanym ekranie / w tle Safari i Android Chrome nie jest gwarantowane (ograniczenia OS, przeglądarki).
- 1,2 s nakładki usuwa część luk pomiędzy segmentami, ale nie daje 100% pewności bez powtórzeń i błędów granicznych. Składanie tekstu stosuje deduplikację po słowach.
- Brak diarizacji (rozpoznawania osób) i nagrywania dźwięku do archiwum.
- Przy przeciążeniu lub błędzie Groq audio pozostaje **tylko w pamięci otwartej karty** do ręcznej retransmisji. Po zamknięciu karty nie da się go odzyskać.
- Uwierzytelnianie PIN jest tylko dla zamkniętych testów. Uruchomienie publiczne wymaga silnego auth, rate limiting, privacy/compliance i kontroli kosztów.

## Audyt kontrolny

- Przegląd wszystkich plików wejściowych, analiza case sensitivity i konfiguracji funkcji.
- Nowe testy Node: delta, deduplikacja, WAV, silence gate, schema, Groq payload, walidacja cytatów, statusy PIN, origin, limity, STT multipart i 429.
- Mobilny test DOM na Chromium ze zmianą `User-Agent` i zamockowanymi endpointami Netlify, w tym PIN, karta AI i przesyłanie WAV; NIE test urządzeń fizycznych iOS/Android.
- Statyczna kontrola wszystkich plików JS: `node --check`.
