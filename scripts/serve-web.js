// Malutki statyczny serwer dla web/ + udostępnia data/ (żeby interfejs sam
// wczytał data/squad.json wygenerowany przez `node cli.js squad`).
// Zero zależności — tylko wbudowane moduły Node.
//
//   npm run web   ->   http://localhost:5173

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT ?? 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);

  if (url === '/api/ai') return handleAi(req, res);
  if (url === '/api/ai/history') return handleAiHistory(req, res);

  // /data/* -> katalog data/ (tylko pliki .json, tylko odczyt)
  if (url.startsWith('/data/')) {
    const name = path.basename(url);
    const file = path.join(DATA_DIR, name);
    if (path.extname(file) !== '.json' || !file.startsWith(DATA_DIR) || !fs.existsSync(file)) {
      return send(res, 404, '{"error":"not_found"}', MIME['.json']);
    }
    return send(res, 200, fs.readFileSync(file), MIME['.json']);
  }

  // reszta -> web/
  let rel = url === '/' ? '/index.html' : url;
  const file = path.join(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? 'application/octet-stream');
});

// ------------------------- Doradca AI (przez bramkę OpenAI-compatible) -------------------------
// Klucz zostaje na Pi (~/.config/gaffer/ai.env -> zmienne środowiska), przeglądarka
// wysyła tylko podsumowanie drużyny.
const AI = {
  url: (process.env.AI_GATEWAY_URL || '').replace(/\/+$/, ''),
  key: process.env.AI_GATEWAY_KEY || '',
  model: process.env.AI_GATEWAY_MODEL || 'gemini/gemini-2.5-flash',
};

const AI_SYSTEM = `Jesteś doświadczonym menedżerem w grze Hattrick i doradzasz właścicielowi jednej drużyny.
Dostajesz dane z aplikacji Gaffer: kadrę seniorów (umiejętności w skali HT 0–20), akademię, wynik
optymalizatora składu, ekonomię i zmiany od poprzedniego importu. Oceny optymalizatora to przybliżenia
społeczności, nie oficjalny silnik meczu.
Cel: żeby drużyna była jak najlepsza w krótkim i długim terminie. Odpowiadaj po polsku, konkretnie,
nazwiskami i liczbami z danych. Nie wymyślaj zawodników ani wartości, których nie ma w danych; gdy
czegoś brakuje, napisz czego. Struktura pełnego planu (nagłówki Markdown ##):
1. Skład i taktyka na najbliższy mecz (formacja, kto gdzie, kapitan, stałe fragmenty, zmiany).
2. Trening na najbliższe tygodnie (typ treningu, kto zyska najwięcej, ryzyka wieku/pensji).
3. Transfery (kogo sprzedać, jakiego profilu szukać, orientacyjny budżet).
4. Akademia (kogo promować, kogo zwolnić, na co patrzeć).
5. Top 3 działania na ten tydzień.
Ważne zasady interpretacji:
- „Sektory (względne)” z optymalizatora Gaffera to inna skala niż oceny meczowe HT rywala (np. 3,50 = kiepski wysoki).
  NIE porównuj ich liczbowo; rywala oceniaj tylko jego ocenami HT i danymi „top11”.
- Pozycje w składzie podawaj pełnymi nazwami (bramkarz, środkowy obrońca, boczny obrońca, skrzydłowy,
  środkowy pomocnik, napastnik). Umiejętności nazywaj pełnymi słowami, nie skrótami.
- Wychowankowie i lojalność 20 dają bonus do gry; uwzględnij to przed radą „sprzedaj”.
- Trening działa tylko na zawodników, którzy grają w meczach na trenowanych pozycjach.
Masz też swoje wcześniejsze analizy. Traktuj je jako własne notatki: nawiązuj do nich krótko
(„jak radziłem 5.11…”), porównaj z aktualnymi danymi, co się zmieniło (forma, umiejętności, kartki,
rywal), i powiedz wprost, jeśli wcześniejsza rada była błędna albo już nieaktualna. Nie powtarzaj ich w całości.
Gdy menedżer zadał konkretne pytanie, odpowiedz TYLKO na nie (do ~250 słów, z konkretnymi nazwiskami),
bez pełnego planu. Pełną strukturę 1–5 stosuj, gdy pytania nie ma.
Liczby i zmiany umiejętności przepisuj dokładnie z danych (nazwa umiejętności przy właściwym zawodniku);
nie używaj LaTeX-a, strzałki pisz jako →.
Bądź zwięzły: łącznie do ~450 słów.`;

function readBody(req, limit = 300_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('za duże zapytanie'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Historia analiz: data/ai-history.json (lokalnie na Pi, wspólna dla wszystkich urządzeń).
const AI_HISTORY = path.join(DATA_DIR, 'ai-history.json');
const AI_HISTORY_MAX = 200;
function readAiHistory() {
  try {
    return JSON.parse(fs.readFileSync(AI_HISTORY, 'utf8'));
  } catch {
    return [];
  }
}
function saveAiEntry(entry) {
  const list = [entry, ...readAiHistory()].slice(0, AI_HISTORY_MAX);
  fs.writeFileSync(AI_HISTORY, JSON.stringify(list, null, 1));
}
function handleAiHistory(req, res) {
  const json = (code, obj) => send(res, code, JSON.stringify(obj), MIME['.json']);
  if (req.method === 'GET') return json(200, readAiHistory());
  if (req.method === 'DELETE') {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const list = readAiHistory();
    const next = list.filter((e) => e.id !== id);
    if (next.length === list.length) return json(404, { error: 'nie ma takiej analizy' });
    fs.writeFileSync(AI_HISTORY, JSON.stringify(next, null, 1));
    return json(200, { ok: true });
  }
  return json(405, { error: 'tylko GET / DELETE' });
}

// Ostatnie analizy jako pamięć doradcy: nawiązuje do nich zamiast zaczynać od zera.
const AI_MEMORY_COUNT = 4;
const AI_MEMORY_CHARS = 1800;
function previousAdvice() {
  const past = readAiHistory().slice(0, AI_MEMORY_COUNT);
  if (!past.length) return '';
  const when = (iso) => new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
  const items = past.map((e) => {
    const t = e.text.length > AI_MEMORY_CHARS ? e.text.slice(0, AI_MEMORY_CHARS) + ' […]' : e.text;
    return `### ${when(e.at)} — ${e.question ? `pytanie: „${e.question}”` : 'pełny plan'}\n${t}`;
  });
  return `\n\n## Twoje wcześniejsze analizy (od najnowszej, skrócone)\n\n${items.join('\n\n')}`;
}

async function handleAi(req, res) {
  const json = (code, obj) => send(res, code, JSON.stringify(obj), MIME['.json']);
  if (req.method === 'GET') return json(200, { enabled: !!(AI.url && AI.key), model: AI.model });
  if (req.method !== 'POST') return json(405, { error: 'tylko POST' });
  if (!AI.url || !AI.key) return json(503, { error: 'Doradca AI nie jest skonfigurowany (AI_GATEWAY_URL / AI_GATEWAY_KEY w ~/.config/gaffer/ai.env).' });
  try {
    const { context, question } = JSON.parse(await readBody(req));
    if (!context || typeof context !== 'string') return json(400, { error: 'brak danych drużyny' });
    const user =
      `${question ? `Pytanie menedżera: ${String(question).slice(0, 2000)}\n\n` : ''}Dane drużyny (aktualne):\n\n${context}` +
      previousAdvice();
    const r = await fetch(`${AI.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI.key}` },
      body: JSON.stringify({
        model: AI.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: AI_SYSTEM },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const body = await r.json().catch(() => null);
    if (!r.ok) return json(502, { error: `Bramka AI odpowiedziała ${r.status}${body?.error?.message ? ': ' + body.error.message : ''}` });
    const text = body?.choices?.[0]?.message?.content;
    if (!text) return json(502, { error: 'Bramka AI zwróciła pustą odpowiedź.' });
    const entry = { id: Date.now().toString(36), at: new Date().toISOString(), question: question ? String(question).slice(0, 2000) : '', text, model: body.model || AI.model };
    try {
      saveAiEntry(entry);
    } catch (e) {
      console.error('Nie zapisano historii AI:', e.message);
    }
    return json(200, entry);
  } catch (err) {
    return json(502, { error: 'Błąd doradcy AI: ' + err.message });
  }
}

server.listen(PORT, () => {
  console.log(`Interfejs: http://localhost:${PORT}`);
  console.log(`Doradca AI: ${AI.url && AI.key ? `włączony (${AI.model})` : 'wyłączony — uzupełnij ~/.config/gaffer/ai.env'}`);
  console.log(`Dane z:    ${DATA_DIR}  (uruchom "node cli.js squad", żeby je wygenerować)`);
});
