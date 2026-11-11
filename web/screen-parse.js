// Odczyt kart zawodników z zrzutów ekranu aplikacji Hattricka (po OCR).
// Wejście: linie z scripts/ocr.py ({x,y,conf,text}). Bez AI: reguły + dopasowanie słów poziomów.
// Cyfry z OCR bywają błędne (np. 6 → 9), a słowo poziomu („zadowalający”) zwykle nie,
// więc przy sprzeczności wygrywa słowo, a ostrzeżenie trafia do `warn`.

const norm = (s) =>
  String(s ?? '')
    .normalize('NFKC')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .toLowerCase();
const letters = (s) => norm(s).replace(/[^a-z]/g, '');

// poziomy HT po polsku (0–20), bez polskich znaków
export const LEVELS = [
  'nieistniejacy', 'fatalny', 'nedzny', 'kiepski', 'slaby', 'przecietny', 'zadowalajacy', 'solidny', 'znakomity',
  'fantastyczny', 'olsniewajacy', 'blyskotliwy', 'mistrzowski', 'swiatowejklasy', 'nadprzyrodzony', 'tytaniczny',
  'nieziemski', 'mityczny', 'magiczny', 'utopijny', 'boski',
];

function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Zwraca poziom 0–20 albo null. OCR gubi/zamienia litery, stąd odległość edycyjna.
export function levelFromWord(text) {
  const w = letters(text);
  if (w.length < 4) return null;
  let best = null, bd = 99;
  LEVELS.forEach((l, i) => {
    const d = lev(w, l);
    if (d < bd) { bd = d; best = i; }
  });
  const limit = Math.max(1, Math.floor(LEVELS[best].length / 5)); // dłuższe słowa tolerują więcej błędów
  return bd <= limit ? best : null;
}

const LABELS = [
  ['forma', 'form'], ['kondycja', 'stamina'], ['bronienie', 'keeper'], ['defensywa', 'defending'], ['rozgrywanie', 'playmaking'],
  ['dosrodkowania', 'winger'], ['podania', 'passing'], ['skutecznosc', 'scoring'], ['stfragmenty', 'setPieces'],
];
const SPEC = [['techniczny', 1], ['szybki', 2], ['mocarny', 3], ['atletyczny', 3], ['nieprzewidywalny', 4], ['gragiowa', 5], ['gragtowa', 5], ['glowa', 5], ['regenerujacy', 6], ['wsparcie', 8]];

const digits = (s) => {
  const d = String(s).replace(/[^\d]/g, '');
  return d ? Number(d) : null;
};

function labelKey(text) {
  const t = letters(text);
  for (const [lab, key] of LABELS) if (t === lab || (t.length >= 5 && lev(t, lab) <= 1)) return key;
  return null;
}

// Wiersze: linie o podobnym y.
function rowRight(lines, ref, tol = 30) {
  return lines.filter((l) => l !== ref && Math.abs(l.y - ref.y) <= tol && l.x > ref.x).sort((a, b) => a.x - b.x);
}

function parseSkills(lines) {
  const out = {}, warn = [];
  for (const l of lines) {
    const key = labelKey(l.text);
    if (!key || out[key] != null) continue;
    const right = rowRight(lines, l);
    if (!right.length) continue;
    const num = right.map((r) => r.text.trim()).filter((t) => /^[\d５-９０-４]{1,2}$/.test(t.normalize('NFKC'))).map((t) => Number(t.normalize('NFKC'))).pop();
    const words = right.filter((r) => !/^\d+$/.test(r.text.trim().normalize('NFKC'))).map((r) => r.text).join('');
    const lw = levelFromWord(words);
    let v = null;
    if (lw != null && num != null && lw !== num) { v = lw; warn.push(`${key}: słowo=${lw}, cyfra=${num} (przyjęto słowo)`); }
    else v = lw ?? num;
    if (v != null && v >= 0 && v <= 20) out[key] = v;
  }
  return { skills: out, warn };
}

function parseMoney(text) {
  const m = String(text).normalize('NFKC').match(/(\d[\d\s]{2,})\s*z/i);
  return m ? digits(m[1]) : null;
}

const AGE_RE = /(\d{2})lat\w*i(\d{1,3})dni/;
const SKIP_NAME = /moje kluby|swiat|na zywo|spolecznosc|wyniki|finanse|oferty|otworz|szukania|statystyki|trofea|licytuj/;

function nameAbove(lines, ageLine, maxGap = 220) {
  const cands = lines.filter((l) => l.y < ageLine.y && ageLine.y - l.y <= maxGap && l.conf >= 0.85 && /[a-z]{2}/.test(norm(l.text)) && !SKIP_NAME.test(norm(l.text)) && !/\d/.test(l.text));
  return cands.sort((a, b) => b.y - a.y)[0]?.text?.trim() ?? null;
}

function headerName(lines) {
  const top = lines.filter((l) => l.y > 150 && l.y < 340 && l.conf >= 0.9 && /[a-z]{3}/.test(norm(l.text)) && !SKIP_NAME.test(norm(l.text)) && !/\d/.test(l.text));
  return top.sort((a, b) => a.y - b.y)[0]?.text?.trim() ?? null;
}

function parseInfo(lines) {
  const info = {};
  const text = (re) => lines.find((l) => re.test(norm(l.text)));
  const tsi = lines.find((l) => letters(l.text) === 'tsi');
  if (tsi) {
    const r = rowRight(lines, tsi)[0];
    if (r) info.tsi = digits(r.text);
  }
  const pens = lines.find((l) => letters(l.text) === 'pensja');
  if (pens) {
    const r = rowRight(lines, pens)[0];
    if (r) info.salary = parseMoney(r.text) ?? digits(r.text.split('z')[0]);
  }
  const ex = text(/doswiadczenie/);
  if (ex) {
    const t = norm(ex.text);
    const e = t.match(/doswiadczenie:[^()]*\((\d+)\)/); if (e) info.experience = Number(e[1]);
    const p = t.match(/przyw\w*ca:[^()]*\((\d+)\)/); if (p) info.leadership = Number(p[1]);
  }
  const loy = text(/lojalnosc/);
  if (loy) { const m = norm(loy.text).match(/\((\d+)\)/); if (m) info.loyalty = Number(m[1]); }
  const sp = lines.find((l) => letters(l.text) === 'specjalnosc');
  if (sp) {
    const w = letters(rowRight(lines, sp).map((r) => r.text).join(''));
    for (const [k, v] of SPEC) if (w.includes(k)) { info.specialty = v; break; }
  }
  const ceny = lines.find((l) => /cena\s*wywo/.test(norm(l.text)));
  if (ceny) { const r = rowRight(lines, ceny)[0]; if (r) info.startPrice = parseMoney(r.text); }
  const bid = lines.find((l) => /zlozona|ztozona/.test(norm(l.text)) || /ztozon/.test(norm(l.text)));
  if (bid) info.highBid = parseMoney(bid.text);
  const dl = lines.find((l) => /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/.test(l.text));
  if (dl) info.deadline = dl.text.match(/\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/)[0];
  return info;
}

// Karta na liście wyników: cena (w nawiasie = cena wywoławcza, pogrubiona = aktualna oferta) nad terminem.
function parseCardPrice(lines) {
  const dl = lines.find((l) => /\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/.test(l.text));
  if (!dl) return {};
  const above = lines.filter((l) => l.y < dl.y && dl.y - l.y < 160 && /z[lt]?\s*\)?$/i.test(norm(l.text).trim()) && parseMoney(l.text) != null).sort((a, b) => b.y - a.y)[0];
  return { price: above ? parseMoney(above.text) : null, deadline: dl.text.match(/\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}/)[0] };
}

// Rozpoznaje zrzut kadry (tabela), żeby uczciwie odmówić zamiast zwracać złe liczby.
export function looksLikeSquadTable(lines) {
  const t = lines.map((l) => norm(l.text)).join(' ');
  return /imie i nazwisko|pensja/.test(t) && lines.length > 150;
}

// Główna funkcja: lines -> lista fragmentów kart ({name, age, skills…}).
export function parseScreen(lines) {
  if (looksLikeSquadTable(lines)) return { kind: 'table', cards: [] };
  const ages = lines.filter((l) => AGE_RE.test(letters(l.text).length ? norm(l.text).replace(/[^a-z\d]/g, '') : '')).sort((a, b) => a.y - b.y);
  const cards = [];
  if (ages.length >= 2 || (ages.length === 1 && parseCardPrice(lines).deadline && !lines.some((l) => /zlozona|ztozona|cena\s*wywo/.test(norm(l.text))))) {
    // lista wyników / kilka kart na ekranie
    ages.forEach((a, i) => {
      const top = i === 0 ? 0 : ages[i].y - 110;
      const bottom = i + 1 < ages.length ? ages[i + 1].y - 110 : 1e9;
      const slice = lines.filter((l) => l.y >= top && l.y < bottom);
      const m = norm(a.text).replace(/[^a-z\d]/g, '').match(AGE_RE);
      const { skills, warn } = parseSkills(slice);
      cards.push({ name: nameAbove(lines, a), age: Number(m[1]), ageDays: Number(m[2]), ...skills, ...parseCardPrice(slice), warn });
    });
  } else {
    // pojedyncza strona zawodnika (może być tylko jej fragment)
    const a = ages[0];
    const m = a && norm(a.text).replace(/[^a-z\d]/g, '').match(AGE_RE);
    const { skills, warn } = parseSkills(lines);
    const info = parseInfo(lines);
    const card = { name: (a && nameAbove(lines, a)) || headerName(lines), warn, ...skills, ...info };
    if (m) { card.age = Number(m[1]); card.ageDays = Number(m[2]); }
    card.price = info.highBid && info.highBid >= (info.startPrice || 0) ? info.highBid : info.startPrice ?? null;
    if (Object.keys(skills).length || card.tsi || card.salary) cards.push(card);
  }
  return { kind: 'cards', cards: cards.filter((c) => c.name) };
}

// Łączy fragmenty tego samego zawodnika z kilku zrzutów (umiejętności z jednego, pensja z drugiego).
export function mergeCards(cards) {
  const map = new Map();
  for (const c of cards) {
    const k = letters(c.name || '');
    if (!k) continue;
    const prev = map.get(k) || { warn: [] };
    const merged = { ...prev };
    for (const [key, v] of Object.entries(c)) {
      if (key === 'warn') merged.warn = [...prev.warn, ...v];
      else if (v != null && (prev[key] == null || key === 'name')) merged[key] = v;
    }
    map.set(k, merged);
  }
  return [...map.values()];
}

const NEED = ['form', 'stamina', 'keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces'];
export const missingFields = (c) => [...NEED.filter((k) => c[k] == null).map((k) => k), ...(c.salary ? [] : ['salary']), ...(c.age ? [] : ['age'])];
