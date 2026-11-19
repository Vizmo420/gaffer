// Gaffer v2 — odczyt zrzutów stron Hattricka z wyniku OCR (linie {x, y, w, h, text}).
// Czyste funkcje, bez DOM. Testy na prawdziwych zrzutach: test/v2-parsers.test.mjs.

import { LEVEL_PL } from '../ht-ratings.js';

export const strip = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[łŁ]/g, (c) => (c === 'ł' ? 'l' : 'L')).toLowerCase();
const letters = (s) => strip(s).replace(/[^a-z]/g, '');

function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Podobieństwo nazw (OCR gubi znaki i dokleja śmieci): 1 = identyczne.
export function nameScore(a, b) {
  const x = letters(a), y = letters(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 5 && y.length >= 5 && (x.includes(y) || y.includes(x))) return 0.9;
  const full = 1 - lev(x, y) / Math.max(x.length, y.length);
  // nazwa ucięta na telefonie („Strzałka Chojny Ł…”): porównaj z początkiem pełnej nazwy
  if (x.length >= 8 && y.length > x.length) return Math.max(full, 0.95 * (1 - lev(x, y.slice(0, x.length)) / x.length));
  return full;
}

export function bestName(text, names, min = 0.75) {
  let best = null, score = min;
  for (const n of names) {
    const s = nameScore(text, n);
    if (s >= score) { best = n; score = s; }
  }
  return best;
}

// Linie OCR w wiersze (po wysokości).
export function rows(lines) {
  const ls = [...lines].sort((a, b) => a.y - b.y);
  const hs = ls.map((l) => l.h).filter((h) => h > 0).sort((a, b) => a - b);
  const tol = (hs[Math.floor(hs.length / 2)] || 20) * 0.6;
  const out = [];
  for (const l of ls) {
    const r = out.at(-1);
    if (r && Math.abs(l.y - r.y) <= tol) { r.items.push(l); r.y = (r.y * (r.items.length - 1) + l.y) / r.items.length; }
    else out.push({ y: l.y, items: [l] });
  }
  for (const r of out) { r.items.sort((a, b) => a.x - b.x); r.text = r.items.map((i) => i.text).join(' '); }
  return out;
}

// ---------------- raport meczu: oceny sektorów ----------------

export const SECTOR_LABELS = [
  ['midfield', 'pomoc'], ['defRight', 'prawa obrona'], ['defCentral', 'srodek obrony'], ['defLeft', 'lewa obrona'],
  ['attRight', 'prawy atak'], ['attCentral', 'srodkowy atak'], ['attLeft', 'lewy atak'],
];
const SUB_WORDS = [['min', 0], ['bardzo nisk', 0], ['nisk', 0.25], ['bardzo wysok', 0.75], ['wysok', 0.5], ['maks', 0.75]];
const LEVELS = LEVEL_PL.map((w, i) => [letters(w), i]).sort((a, b) => b[0].length - a[0].length);

// „kiepski - wysoki” → 3,5 (gdy raport nie pokazuje liczb).
export function ratingFromWords(text) {
  const t = strip(text);
  const [lvlPart, subPart = ''] = t.split(/[-–(]/);
  const lw = letters(lvlPart);
  if (!lw) return null;
  let lvl = null, bestS = 0.7;
  for (const [w, i] of LEVELS) {
    const s = nameScore(lw, w);
    if (s > bestS) { lvl = i; bestS = s; }
  }
  if (lvl == null) return null;
  const sw = subPart.trim();
  const sub = SUB_WORDS.find(([w]) => sw.startsWith(w))?.[1] ?? 0;
  return lvl + sub;
}

const NUM_RATING = /^(\d{1,2})[,.](\d{2})$/;

export function parseMatchRatings(lines) {
  const rs = rows(lines);
  const home = {}, away = {};
  let firstRowIdx = null;
  for (const [key, label] of SECTOR_LABELS) {
    const idx = rs.findIndex((r) => r.items.some((i) => letters(i.text) === label.replace(/ /g, '')));
    if (idx < 0) continue;
    if (firstRowIdx == null || idx < firstRowIdx) firstRowIdx = idx;
    const r = rs[idx];
    const labelItem = r.items.find((i) => letters(i.text) === label.replace(/ /g, ''));
    const rest = r.items.filter((i) => i.x > labelItem.x);
    const nums = rest.filter((i) => NUM_RATING.test(i.text.trim())).map((i) => Number(i.text.trim().replace(',', '.')));
    if (nums.length >= 2) { home[key] = nums[0]; away[key] = nums[1]; continue; }
    const words = rest.filter((i) => !NUM_RATING.test(i.text.trim())).map((i) => ratingFromWords(i.text)).filter((v) => v != null);
    if (words.length >= 2) { home[key] = words[0]; away[key] = words[1]; }
  }
  // nazwy drużyn: wiersz tuż nad tabelą ocen z dwoma napisami
  let names = [null, null];
  if (firstRowIdx != null) {
    for (let i = firstRowIdx - 1; i >= Math.max(0, firstRowIdx - 3); i--) {
      const t = rs[i].items.filter((x) => letters(x.text).length >= 3);
      if (t.length >= 2) { names = [t[0].text, t.at(-1).text].map(cleanTeam); break; }
    }
  }
  const scoreRow = rs.find((r) => /wynik meczu/.test(strip(r.text)));
  const sm = scoreRow?.text.match(/(\d{1,2})\s*[-–:]\s*(\d{1,2})/);
  const n = Object.keys(home).length;
  return {
    home: { name: names[0], ratings: home },
    away: { name: names[1], ratings: away },
    score: sm ? { home: Number(sm[1]), away: Number(sm[2]) } : null,
    complete: n === 7 && Object.keys(away).length === 7,
    found: n,
  };
}

// „twe Podbeskidzief” → „Podbeskidzief”: OCR dokleja ikonki z lewej. Zostawiamy najdłuższy sensowny kawałek.
function cleanTeam(s) {
  const t = String(s ?? '').trim();
  const parts = t.split(/\s+/);
  if (parts.length > 1 && parts[0].length <= 3 && /^[a-z]/.test(parts[0])) return parts.slice(1).join(' ');
  return t;
}

// Która strona to my: najbardziej podobna nazwa; gdy żadna nie pasuje — null (pytamy użytkownika).
export function whichSide(report, team) {
  const h = nameScore(report.home.name, team), a = nameScore(report.away.name, team);
  if (Math.max(h, a) < 0.7) return null;
  return h >= a ? 'home' : 'away';
}

// ---------------- liga: tabela i terminarz ----------------

const isInt = (s) => /^\d{1,3}$/.test(String(s).trim());

export function parseLeague(lines, knownTeams = []) {
  const rs = rows(lines);
  const maxX = Math.max(...lines.map((l) => l.x + l.w / 2), 1);
  const table = [];
  const fixtures = [];
  let date = null;
  // nagłówek tabeli („Drużyna … Pkt”): wyznacza prawą krawędź tabeli i kolejność kolumn
  const head = rs.find((r) => /druzyna/.test(strip(r.text)) && /pkt|#/.test(strip(r.text)) && r.items.length >= 2);
  const headAfter = head ? letters(strip(head.text).split('druzyna').pop()) : '';
  const pointsFirst = headAfter.startsWith('pkt'); // telefon: „Pkt ± Z”
  const hasPoints = !head || /pkt/.test(headAfter); // telefon, druga zakładka „R P + -” nie ma punktów
  const rightEdge = head ? Math.max(...head.items.map((i) => i.x + i.w / 2)) + 40 : maxX * 0.62;
  const roundM = strip(rs.map((r) => r.text).join(' ')).match(/runda\s*(\d{1,2})/);
  const round = roundM ? Number(roundM[1]) : null;
  for (const r of rs) {
    const dm = r.text.match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    // terminarz: „Drużyna A - Drużyna B [2 - 1]” — w obrębie jednego napisu OCR (wiersz łączy też menu i panele boczne)
    let isFixture = false;
    r.items.forEach((it, k) => {
      const fm = it.text.replace(/\s+/g, ' ').trim().match(/^(.+?)\s+[-–]\s+(.+?)(?:\s+(\d{1,2})\s*[-–:]\s*(\d{1,2}))?$/);
      if (!fm || /\d{2}\.\d{2}\.\d{4}/.test(it.text)) return;
      const [a, b] = [fm[1], fm[2]].map((x) => x.replace(/^\d+\s*/, '').trim());
      if (letters(a).length < 3 || letters(b).length < 3) return;
      const ka = knownTeams.length ? bestName(a, knownTeams) : a;
      const kb = knownTeams.length ? bestName(b, knownTeams) : b;
      if (!ka || !kb || ka === kb) return;
      let hg = fm[3], ag = fm[4];
      const nx = r.items[k + 1]?.text.trim().match(/^(\d{1,2})\s*[-–:]\s*(\d{1,2})$/);
      if (hg == null && nx) [hg, ag] = [nx[1], nx[2]];
      fixtures.push({ date, home: ka, away: kb, homeGoals: hg != null ? Number(hg) : null, awayGoals: ag != null ? Number(ag) : null });
      isFixture = true;
    });
    if (isFixture) continue;
    if (dm) date = `${dm[3]}-${dm[2]}-${dm[1]}T${(dm[4] ?? '00').padStart(2, '0')}:${dm[5] ?? '00'}:00`;
    // tabela: pozycja, nazwa, liczby — tylko lewa część strony (po prawej bywa lista drużyn z innych sekcji)
    if (head && r.y <= head.y) continue;
    const left = r.items.filter((i) => i.x < rightEdge);
    const nameItem = left.find((i) => letters(i.text).length >= 3 && (knownTeams.length ? bestName(i.text.replace(/^\W*\d+\s*/, ''), knownTeams) : true));
    if (!nameItem) continue;
    const name = knownTeams.length ? bestName(nameItem.text.replace(/^\W*\d+\s*/, ''), knownTeams) : nameItem.text.replace(/^\W*\d+\s*/, '').trim();
    const before = left.filter((i) => i.x < nameItem.x && isInt(i.text));
    const nums = left.filter((i) => i.x > nameItem.x && /^[\d\s+−-]+$/.test(i.text.trim()))
      .flatMap((i) => i.text.trim().replace(/−/g, '-').split(/\s+/)).filter((s) => /^-?\d{1,3}$/.test(s)).map(Number);
    if (!before.length && nums.length < 2) continue; // bez pozycji i bez liczb to nie wiersz tabeli
    if (table.some((t) => t.name === name)) continue;
    const ok = nums.length >= 2 && hasPoints;
    const points = ok ? (pointsFirst ? nums[0] : nums.at(-1)) : null;
    table.push({ pos: before.length ? Number(before.at(-1).text) : null, name, played: ok ? (pointsFirst ? round : nums[0]) : null, points: points != null && points >= 0 ? points : null });
  }
  table.forEach((t, i) => { t.pos = i + 1; });
  return { table, fixtures };
}

// Tabela ligi z wyników (gdy wpisane są wszystkie mecze kolejki) — liczona tak jak w HT: punkty, różnica, strzelone.
export function tableFromResults(teams, results) {
  const t = new Map(teams.map((n) => [n, { name: n, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, points: 0 }]));
  for (const r of results) {
    if (r.homeGoals == null || r.awayGoals == null) continue;
    const h = t.get(r.home), a = t.get(r.away);
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += r.homeGoals; h.ga += r.awayGoals; a.gf += r.awayGoals; a.ga += r.homeGoals;
    if (r.homeGoals > r.awayGoals) { h.w++; a.l++; h.points += 3; }
    else if (r.homeGoals < r.awayGoals) { a.w++; h.l++; a.points += 3; }
    else { h.d++; a.d++; h.points++; a.points++; }
  }
  return [...t.values()].sort((x, y) => y.points - x.points || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

// Co daje dane miejsce w lidze HT (8 drużyn, 14 kolejek).
export function leagueOutlook(table, team, roundsPlayed, rounds = 14) {
  const sorted = [...table].sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
  const pos = sorted.findIndex((t) => t.name === team) + 1;
  if (!pos) return null;
  const me = sorted[pos - 1];
  const left = Math.max(0, rounds - roundsPlayed);
  const pts = (i) => sorted[i]?.points ?? 0;
  return {
    pos,
    points: me.points ?? 0,
    left,
    maxPoints: (me.points ?? 0) + 3 * left,
    toFirst: pos === 1 ? 0 : pts(0) - (me.points ?? 0),
    lead: pos === 1 ? (me.points ?? 0) - pts(1) : null,
    toSafe: pos <= 4 ? 0 : pts(3) - (me.points ?? 0),
    zone: pos === 1 ? 'promo' : pos <= 4 ? 'safe' : pos <= 6 ? 'playoff' : 'down',
  };
}

// ---------------- tabela kadry (strona „Zawodnicy” w widoku tabeli) ----------------

export const TABLE_FIELDS = ['form', 'stamina', 'keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces', 'experience', 'leadership', 'loyalty'];
const SKILL_FIELDS = new Set(['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces']);

function matchPlayer(text, players) {
  const t = letters(String(text).replace(/^\s*\d+\s*/, ''));
  if (t.length < 5) return null;
  return players.find((p) => letters(`${p.firstName}${p.lastName}`) === t)
    ?? players.find((p) => { const l = letters(p.lastName); return l.length >= 4 && (t.endsWith(l) || nameScore(t, letters(`${p.firstName}${p.lastName}`)) >= 0.85); })
    ?? null;
}

// Odczyt tabeli kadry. Kolumny nie są podpisane w OCR, więc rozpoznajemy je po zgodności z obecnymi danymi:
// większość wartości z tygodnia na tydzień się nie zmienia. Zwraca tylko pewne komórki.
export function parseSquadTable(lines, players) {
  const W = Math.max(...lines.map((l) => l.x + l.w / 2), 1);
  const names = [];
  for (const l of lines) {
    const p = matchPlayer(l.text, players);
    if (p && !names.some((n) => n.player.id === p.id)) names.push({ player: p, line: l });
  }
  if (names.length < 3) return { rows: [], columns: {}, found: names.length };
  names.sort((a, b) => a.line.y - b.line.y);
  const gaps = names.slice(1).map((n, i) => n.line.y - names[i].line.y).sort((a, b) => a - b);
  const rowTol = Math.max(8, (gaps[Math.floor(gaps.length / 2)] || 40) * 0.5);
  const dates = lines.filter((l) => /\d{2}\.\d{2}\.\d{4}/.test(l.text)).map((l) => l.x).sort((a, b) => a - b);
  const dateX = dates.length >= 3 ? dates[Math.floor(dates.length / 2)] - 20 : Infinity;
  const nameX = Math.max(...names.map((n) => n.line.x + n.line.w / 2));

  const rowOf = (l) => {
    let best = null, d = rowTol;
    for (const n of names) { const dy = Math.abs(l.y - n.line.y); if (dy <= d) { best = n; d = dy; } }
    return best;
  };
  const cells = [];
  const extra = new Map(names.map((n) => [n.player.id, {}]));
  for (const l of lines) {
    if (l.x <= nameX || l.x >= dateX) continue;
    const n = rowOf(l);
    if (!n) continue;
    const t = l.text.trim();
    const age = t.match(/^(\d{2})\s*\((\d{1,3})\)$/);
    if (age) { Object.assign(extra.get(n.player.id), { age: Number(age[1]), ageDays: Number(age[2]) }); continue; }
    if (/z[łt]$/i.test(t)) { const v = Number(t.replace(/\D/g, '')); if (v) extra.get(n.player.id).salary = v; continue; }
    if (/^\d{3,7}$/.test(t)) {
      // TSI: najbliższa obecnemu wartość (sklejone komórki też bywają 5-cyfrowe)
      const v = Number(t), p = n.player, e = extra.get(p.id);
      if (p.tsi && v > p.tsi * 0.5 && v < p.tsi * 2 && (e.tsi == null || Math.abs(v - p.tsi) < Math.abs(e.tsi - p.tsi))) e.tsi = v;
      continue;
    }
    if (/^\d{1,2}$/.test(t) && Number(t) <= 20) cells.push({ id: n.player.id, x: l.x, v: Number(t) });
  }
  // kolumny: skupiska położeń x
  const xs = [...cells].sort((a, b) => a.x - b.x);
  const cols = [];
  for (const c of xs) {
    const last = cols.at(-1);
    if (last && c.x - last.maxX <= W * 0.006) { last.cells.push(c); last.maxX = c.x; }
    else cols.push({ minX: c.x, maxX: c.x, cells: [c] });
  }
  const byId = new Map(players.map((p) => [p.id, p]));
  const pairs = [];
  cols.forEach((col, ci) => {
    if (col.cells.length < 3) return;
    for (const f of TABLE_FIELDS) {
      const agree = col.cells.filter((c) => byId.get(c.id)?.[f] === c.v).length / col.cells.length;
      pairs.push({ ci, f, agree });
    }
  });
  pairs.sort((a, b) => b.agree - a.agree);
  const colField = new Map(), used = new Set();
  for (const p of pairs) {
    if (p.agree < 0.5 || colField.has(p.ci) || used.has(p.f)) continue;
    colField.set(p.ci, p.f); used.add(p.f);
  }
  const out = names.map(({ player }) => {
    const values = { ...extra.get(player.id) };
    cols.forEach((col, ci) => {
      const f = colField.get(ci);
      if (!f) return;
      const c = col.cells.find((x) => x.id === player.id);
      if (c) values[f] = c.v;
    });
    const changes = Object.entries(values)
      .filter(([k, v]) => player[k] !== v && !(k === 'ageDays' && values.age === player.age))
      .map(([k, v]) => {
        const from = player[k];
        const diff = Number.isFinite(from) ? v - from : null;
        const sure = !SKILL_FIELDS.has(k) || (diff != null && Math.abs(diff) === 1);
        return { field: k, from, to: v, sure };
      });
    return { player, values, changes };
  });
  return { rows: out, columns: Object.fromEntries([...colField].map(([ci, f]) => [f, Math.round((cols[ci].minX + cols[ci].maxX) / 2)])), found: names.length };
}

// Rodzaj zrzutu po słowach kluczowych — żeby jeden przycisk „ze zrzutu” wiedział, co czyta.
export function detectKind(lines) {
  const t = strip(lines.map((l) => l.text).join(' '));
  if (/oceny szczeg|srodek obrony/.test(t) && /pomoc/.test(t)) return 'match';
  if (/aktualna tabela|kalendarz spotkan|liga:|ligowy/.test(t)) return 'league';
  if (/pensja|tsi/.test(t) && (t.match(/\d{2}\.\d{2}\.\d{4}/g) || []).length >= 5) return 'squadTable';
  return 'other';
}

// ---------------- prognoza końca sezonu ----------------

// Siła drużyny = punkty na mecz z „poduszką” (na starcie sezonu wszyscy podobni) × Twoja ocena (1–5, domyślnie 3).
const STRENGTH_MULT = [0, 0.55, 0.78, 1, 1.28, 1.6];
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// Symulacja pozostałych kolejek (Monte Carlo). table: [{name, played, points}], fixed: {round: {opp, home}} dla nas.
// Kolejki bez znanego rywala losują pary; mecz: szansa wygranej z różnicy sił, ok. 25% remisów, przewaga własnego boiska.
export function seasonProjection({ table, team, roundsPlayed, rounds = 14, ours = {}, strength = {}, runs = 4000, seed = 11 }) {
  const teams = table.map((t) => t.name);
  const n = teams.length;
  const idx = new Map(teams.map((t, i) => [t, i]));
  const me = idx.get(team);
  if (me == null || n < 2) return null;
  const k = 3;
  const s = table.map((t) => (((t.points ?? 0) + 1.35 * k) / ((t.played ?? 0) + k)) * STRENGTH_MULT[strength[t.name] ?? 3]);
  const r = rng(seed);
  const game = (a, b, aHome) => {
    const ha = aHome ? 1.12 : 1 / 1.12;
    const pa = (s[a] * ha) / (s[a] * ha + s[b]);
    const draw = 0.25 * (1 - Math.abs(pa - 0.5) * 1.2);
    const x = r();
    return x < pa * (1 - draw) ? 3 : x < pa * (1 - draw) + draw ? 1 : 0;
  };
  const posCount = Array(n).fill(0);
  let ptsSum = 0;
  for (let it = 0; it < runs; it++) {
    const pts = table.map((t) => t.points ?? 0);
    for (let rd = roundsPlayed + 1; rd <= rounds; rd++) {
      const pool = teams.map((_, i) => i);
      const pairs = [];
      const f = ours[rd];
      if (f && idx.has(f.opp)) {
        const o = idx.get(f.opp);
        pairs.push(f.home ? [me, o] : [o, me]);
        pool.splice(pool.indexOf(me), 1); pool.splice(pool.indexOf(o), 1);
      }
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      for (let i = 0; i + 1 < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);
      for (const [a, b] of pairs) {
        const g = game(a, b, true);
        pts[a] += g; pts[b] += g === 3 ? 0 : g === 1 ? 1 : 3;
      }
    }
    const tie = pts.map((p, i) => p + r() * 0.5); // remis punktowy: losowo (bramek nie symulujemy)
    const pos = tie.filter((v) => v > tie[me]).length;
    posCount[pos]++;
    ptsSum += pts[me];
  }
  const pct = posCount.map((c) => (100 * c) / runs);
  const likely = pct.indexOf(Math.max(...pct)) + 1;
  const sumP = (a, b) => pct.slice(a - 1, b).reduce((x, y) => x + y, 0);
  return { pct, likely, avgPoints: ptsSum / runs, promo: sumP(1, 1), safe: sumP(2, 4), playoff: sumP(5, Math.min(6, n)), down: n > 6 ? sumP(7, n) : 0, roundsLeft: Math.max(0, rounds - roundsPlayed) };
}

// ---------------- raport meczu: taktyka, kartki, kontuzje ----------------

const TACTIC_WORDS = [['kontra', 'counter'], ['srodk', 'aim'], ['skrzyd', 'aow'], ['kreatyw', 'creative'], ['dystans', 'longshots'], ['normal', 'normal'], ['pressing', 'pressing']];
const tacticKey = (t) => TACTIC_WORDS.find(([w]) => strip(t).includes(w))?.[1] ?? null;

// Taktyka obu drużyn z wiersza „Taktyka” (nie „Poziom taktyki”).
export function parseTactics(lines) {
  const r = rows(lines).find((x) => x.items.some((i) => letters(i.text) === 'taktyka'));
  if (!r) return { home: null, away: null };
  const label = r.items.find((i) => letters(i.text) === 'taktyka');
  const vals = r.items.filter((i) => i.x > label.x).map((i) => tacticKey(i.text));
  return { home: vals[0] ?? null, away: vals[1] ?? null };
}

// Kartki i kontuzje naszych zawodników z opisu meczu (zdania z nazwiskiem i słowem kluczowym).
const EVENT_WORDS = [
  ['red', /czerwon|wylecial z boiska|wyrzucon/],
  ['yellow', /zolt|kartk/],
  ['injury', /kontuz|uraz|zniesion|opuscic boisko|opuscil boisko/],
];
export function parseMatchEvents(lines, players) {
  const text = rows(lines).map((r) => r.text).join(' ').replace(/\s+/g, ' ');
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out = [];
  for (const s of sentences) {
    const t = strip(s);
    const type = EVENT_WORDS.find(([, re]) => re.test(t))?.[0];
    if (!type) continue;
    const flat = letters(s);
    for (const p of players) {
      const ln = letters(p.lastName);
      if (ln.length < 4 || !flat.includes(ln)) continue;
      if (!out.some((e) => e.player.id === p.id && e.type === type)) out.push({ player: p, type, sentence: s.trim() });
    }
  }
  return out;
}

// Średnia z kilku raportów rywala. Każdy raport przeliczamy „na wyjazd” (bez przewagi własnego boiska w pomocy).
export function averageRival(reports, relocate) {
  const keys = SECTOR_LABELS.map(([k]) => k);
  const acc = Object.fromEntries(keys.map((k) => [k, []]));
  const tactics = [];
  for (const r of reports) {
    const norm = relocate ? relocate(r.ratings, r.wasHome ? 'home' : 'away', 'away') : r.ratings;
    for (const k of keys) if (Number(norm[k]) > 0) acc[k].push(Number(norm[k]));
    if (r.tactic) tactics.push(r.tactic);
  }
  const out = { wasHome: false, reports: reports.length };
  for (const k of keys) if (acc[k].length) out[k] = Math.round((acc[k].reduce((a, b) => a + b, 0) / acc[k].length) * 4) / 4;
  const count = tactics.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map());
  out.tactic = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return out;
}

// ---------------- nastrój i pewność siebie ----------------
// Słowa HT po polsku poznajemy z czasem: znane z ustawień (Gaffer zapamiętuje, co wybrałeś dla danego słowa).
export function parseMood(lines, learned = {}) {
  const rs = rows(lines);
  const find = (re) => {
    for (const r of rs) {
      const idx = r.items.findIndex((i) => re.test(strip(i.text)));
      if (idx < 0) continue;
      const it = r.items[idx];
      // słowo w tym samym napisie po dwukropku albo następny napis w wierszu
      const after = it.text.split(/[:：]/)[1]?.trim() || r.items[idx + 1]?.text?.trim() || '';
      const word = strip(after).replace(/[^a-z ]/g, '').trim();
      if (word) return word;
    }
    return null;
  };
  const spiritWord = find(/nastroj|atmosfer|duch druzyny/);
  const confWord = find(/pewnosc siebie|pewnos/);
  const look = (w, kind) => (w && learned[kind]?.[w] != null ? learned[kind][w] : null);
  return { spiritWord, confWord, spirit: look(spiritWord, 'spirit'), confidence: look(confWord, 'confidence') };
}
