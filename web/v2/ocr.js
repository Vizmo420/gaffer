// Odczyt zrzutów ekranu kart zawodników (OCR na Pi, parsowanie w przeglądarce).

import { parseScreen, mergeCards, missingFields } from '../screen-parse.js';

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z]/g, '');

// Parser ma progi położenia dobrane do zrzutów iPhone'a (1290 px szerokości). Większe obrazy
// (np. z tabletu) sprowadzamy do tej szerokości; mniejszych nie ruszamy.
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    if (bmp.width <= 1600) return file;
    const scale = 1290 / bmp.width;
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  } catch {
    return file;
  }
}

export async function readScreens(files, onProgress = () => {}) {
  const cards = [];
  const notes = [];
  let i = 0;
  for (const f of files) {
    i++;
    onProgress(`Czytam zrzut ${i} z ${files.length}…`);
    const body = await shrink(f);
    const r = await fetch('/api/ocr', { method: 'POST', body });
    const res = await r.json().catch(() => ({ error: 'OCR działa tylko na Pi' }));
    if (!r.ok || res.error) throw new Error(res.error || `OCR: HTTP ${r.status}`);
    const parsed = parseScreen(res.lines || []);
    if (parsed.kind === 'table') notes.push(`Zrzut ${i}: to tabela kadry — tego nie odczytam wiarygodnie (OCR skleja liczby). Użyj importu CSV albo zrzutów kart zawodników.`);
    else if (!parsed.cards.length) notes.push(`Zrzut ${i}: nie znalazłem karty zawodnika.`);
    cards.push(...parsed.cards);
  }
  return { cards: mergeCards(cards), notes };
}

export { missingFields };

// Dopasowanie karty do zawodnika z kadry po nazwisku (OCR gubi polskie i obce znaki).
export function findPlayer(card, players) {
  const n = strip(card.name);
  if (!n) return null;
  return players.find((p) => strip(`${p.firstName}${p.lastName}`) === n)
    ?? players.find((p) => p.lastName && n.endsWith(strip(p.lastName)) && strip(p.lastName).length >= 4)
    ?? null;
}

// Imię i nazwisko z kadry ma poprawne znaki — wolimy je od wersji z OCR.
export function properName(card, players) {
  const p = findPlayer(card, players);
  return p ? `${p.firstName} ${p.lastName}`.trim() : card.name;
}

export const CARD_FIELDS = ['form', 'stamina', 'keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces', 'tsi', 'salary', 'experience', 'leadership', 'loyalty', 'specialty', 'age', 'ageDays'];
