// Import kadry / akademii z eksportu Hattricka (CSV pobrany z HT albo tabela
// wklejona ze schowka). Sam rozpoznaje separator (przecinek / średnik / tab)
// i rodzaj danych (seniorzy vs akademia), także gdy w jednym wklejeniu są oba.
// Czyste funkcje (bez DOM), żeby dało się je testować w Node.

export function detectDelimiter(headerLine) {
  const count = (ch) => {
    let n = 0, q = false;
    for (const c of headerLine) {
      if (c === '"') q = !q;
      else if (!q && c === ch) n++;
    }
    return n;
  };
  const tab = count('\t'), semi = count(';'), comma = count(',');
  if (tab >= 2 && tab >= semi && tab >= comma) return '\t';
  if (semi >= 2 && semi > comma) return ';';
  return ',';
}

export function csvLine(line, delim = ',') {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const isHeader = (line) => /imię i nazwisko/i.test(line);

// Dzieli tekst na bloki zaczynające się od wiersza nagłówka — wklejenie może
// zawierać kadrę i akademię naraz.
export function splitBlocks(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    if (isHeader(l)) {
      cur = [l];
      blocks.push(cur);
    } else if (cur && l.trim()) cur.push(l);
  }
  return blocks.filter((b) => b.length > 1).map((b) => b.join('\n'));
}

// 'youth' | 'senior' | null — punktacja z nagłówków, a przy remisie wiek.
export function detectKind(block) {
  const lines = String(block).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !isHeader(lines[0])) return null;
  const d = detectDelimiter(lines[0]);
  const head = csvLine(lines[0], d).map((h) => h.trim().toLowerCase());
  const has = (h) => head.includes(h);
  let youth = 0, senior = 0;
  if (head.some((h) => h.includes('promowani'))) youth += 3; // „Wiek przy promowaniu", „…do możliwości promowania"
  if (head.filter((h) => h === 'rozgrywanie').length >= 2) youth += 2; // pary poziom + /max
  for (const h of ['tsi', 'pensja', 'lojalność', 'wychowanek', 'forma', 'kondycja', 'doświadczenie'])
    if (has(h)) senior += 1;
  const sample = lines.slice(1, 6).join('\n');
  if (/(^|[,;\t])"?\/(\d+|\?)"?(?=[,;\t]|$)/m.test(sample)) youth += 2; // wartości „/6", „/?"
  if (youth !== senior) return youth > senior ? 'youth' : 'senior';
  // remis: akademia to praktycznie same 15–17-latki
  const ageIdx = head.indexOf('wiek');
  if (ageIdx < 0) return null;
  const ages = lines.slice(1).map((l) => parseFloat(csvLine(l, d)[ageIdx])).filter(Number.isFinite);
  if (!ages.length) return null;
  return Math.max(...ages) <= 18 ? 'youth' : 'senior';
}

// Przetwarza cały tekst (plik albo schowek): { senior, youth, unknown }.
// Gdy w tekście jest kilka bloków tego samego rodzaju, wygrywa ostatni.
export function importText(text) {
  const res = { senior: null, youth: null, unknown: 0 };
  for (const block of splitBlocks(text)) {
    const kind = detectKind(block);
    if (kind === 'youth') res.youth = parseYouthCsv(block);
    else if (kind === 'senior') res.senior = parseSquadCsv(block);
    else res.unknown++;
  }
  return res;
}

// Różnica dwóch importów w formacie zgodnym z data/changes.json (cli.js changes).
const DIFF_SKILLS = [
  ['keeper', 'BR'], ['defending', 'OB'], ['playmaking', 'RO'], ['winger', 'SK'],
  ['passing', 'PO'], ['scoring', 'SKU'], ['setPieces', 'SF'],
];
export function diffImports(prev, curr) {
  if (!prev?.players?.length || !curr?.players?.length) return { enough: false };
  const name = (p) => `${p.firstName} ${p.lastName}`.trim();
  const before = new Map(prev.players.map((p) => [p.id, p]));
  const now = new Map(curr.players.map((p) => [p.id, p]));
  const added = curr.players.filter((p) => !before.has(p.id)).map((p) => ({ name: name(p), tsi: p.tsi || 0 }));
  const removed = prev.players.filter((p) => !now.has(p.id)).map((p) => ({ name: name(p), tsi: p.tsi || 0 }));
  const changed = [];
  for (const p of curr.players) {
    const o = before.get(p.id);
    if (!o) continue;
    const deltas = [];
    for (const [k, label] of DIFF_SKILLS) {
      const a = o[k], b = p[k];
      if (a == null || b == null || a < 0 || b < 0 || a === b) continue; // -1 = nieodkryte w akademii
      deltas.push({ skill: label, from: a, to: b, diff: b - a });
    }
    if (deltas.length) changed.push({ name: name(p), deltas });
  }
  return { enough: true, prevAt: prev.importedAt || '', currAt: curr.importedAt || '', added, removed, changed };
}

// ------------------------- import CSV kadry (eksport HT, PL) -------------------------

export const CSV_SPEC_PL = {
  techniczny: 1, szybki: 2, mocarny: 3, 'atletyczny': 3, nieprzewidywalny: 4,
  'gra głową': 5, 'głowa': 5, regenerujący: 6, wsparcie: 8,
};
// Kod pozycji z „Pozycja w ostatnim meczu" -> typ slotu.
export const CSV_POS_PL = {
  BR: 'GK',
  ST: 'CD', 'ŚO': 'CD', SO: 'CD',
  BO: 'WB', LO: 'WB', PO: 'WB', LB: 'WB', PB: 'WB',
  LS: 'WI', PS: 'WI', 'Ś': 'WI', SK: 'WI', 'LŚ': 'WI', 'PŚ': 'WI',
  PM: 'IM', 'ŚP': 'IM', SP: 'IM',
  NP: 'FW', NA: 'FW',
};

export function parseSquadCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('za mało wierszy');
  const d = detectDelimiter(lines[0]);
  const head = csvLine(lines[0], d).map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  const idx = {
    num: col('Numer na koszulce'),
    name: col('Imię i nazwisko'),
    id: col('PlayerID'),
    spec: col('Specjalność'),
    mcb: col('Wychowanek'),
    inj: col('Kontuzje'),
    cards: col('Kartki'),
    tl: col('Wystawiony na sprzedaż'),
    age: col('Wiek'),
    days: col('Dni'),
    tsi: col('TSI'),
    salary: col('Pensja'),
    weeksClub: col('Liczba tygodni w klubie'),
    xp: col('Doświadczenie'),
    ld: col('Przywódca'),
    loy: col('Lojalność'),
    form: col('Forma'),
    stamina: col('Kondycja'),
    keeper: col('Bronienie'),
    defending: col('Defensywa'),
    playmaking: col('Rozgrywanie'),
    winger: col('Dośrodkowania'),
    passing: col('Podania'),
    scoring: col('Skuteczność'),
    setPieces: col('St. fragmenty'),
    lastDate: col('Data ostatniego meczu'),
    lastRating: col('Ostatnia ocena meczowa'),
    lastPos: col('Pozycja w ostatnim meczu'),
  };
  if (idx.name < 0 || idx.playmaking < 0) throw new Error('brak spodziewanych kolumn (to nie eksport kadry HT?)');

  const n = (v) => {
    const x = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
  };
  const parsePlDate = (s) => {
    const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  };
  const now = Date.now();

  const players = lines.slice(1).map((line) => {
    const f = csvLine(line, d);
    const full = (f[idx.name] || '').trim();
    const sp = full.indexOf(' ');
    const specText = (f[idx.spec] || '').trim().toLowerCase();
    const lastD = idx.lastDate >= 0 ? parsePlDate(f[idx.lastDate]) : null;
    const lastRating = idx.lastRating >= 0 ? n(f[idx.lastRating]) : 0;
    const slot = idx.lastPos >= 0 ? CSV_POS_PL[(f[idx.lastPos] || '').trim()] ?? null : null;
    return {
      id: n(f[idx.id]) || Math.floor(Math.random() * 1e9),
      firstName: sp > 0 ? full.slice(0, sp) : full,
      lastName: sp > 0 ? full.slice(sp + 1) : '',
      nickName: '',
      number: idx.num >= 0 && f[idx.num] ? n(f[idx.num]) : null,
      age: n(f[idx.age]),
      ageDays: n(f[idx.days]),
      ageYears: Number((n(f[idx.age]) + n(f[idx.days]) / 112).toFixed(2)),
      form: n(f[idx.form]),
      stamina: n(f[idx.stamina]),
      experience: n(f[idx.xp]),
      leadership: n(f[idx.ld]),
      loyalty: idx.loy >= 0 && f[idx.loy] !== '' ? n(f[idx.loy]) : null,
      motherClubBonus: idx.mcb >= 0 ? String(f[idx.mcb]).trim() === '1' : null,
      motherClubManual: false,
      keeper: n(f[idx.keeper]),
      defending: n(f[idx.defending]),
      playmaking: n(f[idx.playmaking]),
      winger: n(f[idx.winger]),
      passing: n(f[idx.passing]),
      scoring: n(f[idx.scoring]),
      setPieces: n(f[idx.setPieces]),
      tsi: n(f[idx.tsi]),
      salary: n(f[idx.salary]),
      specialty: CSV_SPEC_PL[specText] ?? 0,
      injuryLevel: idx.inj >= 0 && f[idx.inj] !== '' ? n(f[idx.inj]) : -1,
      yellowCards: idx.cards >= 0 && f[idx.cards] !== '' ? n(f[idx.cards]) : 0,
      transferListed: idx.tl >= 0 ? String(f[idx.tl]).trim() === '1' : false,
      daysAtClub: idx.weeksClub >= 0 && f[idx.weeksClub] !== '' ? n(f[idx.weeksClub]) * 7 : null,
      trained: false,
      manualRating: null,
      weeksSinceLastMatch: lastD ? Math.floor((now - lastD.getTime()) / (7 * 864e5)) : null,
      recentRatings:
        lastD && lastRating > 0
          ? [{ matchId: 0, date: lastD.toISOString(), stars: lastRating, slot }]
          : [],
    };
  });

  return { teamName: 'Kadra z CSV', teamId: 0, players };
}

// ------------------------- import CSV akademii (eksport HT, PL) -------------------------

export function parseYouthCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('za mało wierszy');
  const d = detectDelimiter(lines[0]);
  const head = csvLine(lines[0], d).map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  // każda umiejętność akademii to para kolumn: poziom + „/max"
  const pair = (name) => {
    const i = col(name);
    if (i < 0) return [-1, -1];
    return [i, head[i + 1] === name.toLowerCase() ? i + 1 : -1];
  };
  const idx = {
    num: col('Numer na koszulce'),
    name: col('Imię i nazwisko'),
    id: col('PlayerID'),
    spec: col('Specjalność'),
    inj: col('Kontuzje'),
    cards: col('Kartki'),
    age: col('Wiek'),
    days: col('Dni'),
    promoIn: col('Liczba dni pozostałych do możliwości promowania'),
    lastDate: col('Data ostatniego meczu'),
    lastRating: col('Ostatnia ocena meczowa'),
    lastPos: col('Pozycja w ostatnim meczu'),
    keeper: pair('Bronienie'),
    defending: pair('Defensywa'),
    playmaking: pair('Rozgrywanie'),
    winger: pair('Dośrodkowania'),
    passing: pair('Podania'),
    scoring: pair('Skuteczność'),
    setPieces: pair('St. fragmenty'),
  };
  if (idx.name < 0 || idx.playmaking[0] < 0)
    throw new Error('brak spodziewanych kolumn (to nie eksport akademii HT?)');

  // „?" lub puste -> -1 ; „5" -> 5 ; „/6" -> 6 ; „/?" -> -1
  const lvl = (v) => {
    const s = String(v ?? '').trim().replace(/^\//, '');
    if (!s || s === '?') return -1;
    const x = parseInt(s, 10);
    return Number.isFinite(x) ? x : -1;
  };
  const n = (v) => {
    const x = parseFloat(String(v ?? '').replace(',', '.'));
    return Number.isFinite(x) ? x : 0;
  };
  const parsePlDate = (s) => {
    const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
  };
  const now = Date.now();

  const players = lines
    .slice(1)
    .map((line) => {
      const f = csvLine(line, d);
      const full = (f[idx.name] || '').trim();
      if (!full) return null;
      const sp = full.indexOf(' ');
      const specText = (f[idx.spec] || '').trim().toLowerCase();
      const sk = (p) => [lvl(f[p[0]]), p[1] >= 0 ? lvl(f[p[1]]) : -1];
      const [kp, kpM] = sk(idx.keeper);
      const [df, dfM] = sk(idx.defending);
      const [pm, pmM] = sk(idx.playmaking);
      const [wg, wgM] = sk(idx.winger);
      const [pa, paM] = sk(idx.passing);
      const [sc, scM] = sk(idx.scoring);
      const [st, stM] = sk(idx.setPieces);
      const lastD = idx.lastDate >= 0 ? parsePlDate(f[idx.lastDate]) : null;
      const lastRating = idx.lastRating >= 0 ? n(f[idx.lastRating]) : 0;
      const slot = idx.lastPos >= 0 ? CSV_POS_PL[(f[idx.lastPos] || '').trim()] ?? null : null;
      return {
        id: n(f[idx.id]) || Math.floor(Math.random() * 1e9),
        firstName: sp > 0 ? full.slice(0, sp) : full,
        lastName: sp > 0 ? full.slice(sp + 1) : '',
        nickName: '',
        number: idx.num >= 0 && f[idx.num] ? n(f[idx.num]) : null,
        age: n(f[idx.age]),
        ageDays: n(f[idx.days]),
        ageYears: Number((n(f[idx.age]) + n(f[idx.days]) / 112).toFixed(2)),
        arrivalDate: null,
        canBePromotedInDays: idx.promoIn >= 0 && f[idx.promoIn] !== '' ? n(f[idx.promoIn]) : null,
        specialty: CSV_SPEC_PL[specText] ?? 0,
        injuryLevel: idx.inj >= 0 && f[idx.inj] !== '' ? n(f[idx.inj]) : -1,
        yellowCards: idx.cards >= 0 && f[idx.cards] !== '' ? n(f[idx.cards]) : 0,
        ownerNotes: '',
        scoutComment: '',
        keeper: kp, keeperMax: kpM,
        defending: df, defendingMax: dfM,
        playmaking: pm, playmakingMax: pmM,
        winger: wg, wingerMax: wgM,
        passing: pa, passingMax: paM,
        scoring: sc, scoringMax: scM,
        setPieces: st, setPiecesMax: stM,
        lastRating: lastRating > 0 ? lastRating : null,
        form: 0,
        stamina: 0,
        loyalty: null,
        motherClubBonus: null,
        motherClubManual: false,
        tsi: 0,
        trained: false,
        weeksSinceLastMatch: lastD ? Math.floor((now - lastD.getTime()) / (7 * 864e5)) : null,
        isYouth: true,
        recentRatings:
          lastD && lastRating > 0
            ? [{ matchId: 0, date: lastD.toISOString(), stars: lastRating, slot }]
            : [],
      };
    })
    .filter(Boolean);

  return { teamName: 'Akademia z CSV', players, sourceFile: 'csv', matches: [] };
}
