// Gaffer v2 — dane. Źródło prawdy to pliki na Pi (data/*.json) przez /api/store/*,
// więc telefon i komputer widzą to samo. localStorage służy tylko jako zapas offline.

import { ensureMatchIds, matchId, SKILLS } from './logic.js';
import { nameId } from '../csv-import.js';

export const DEFAULT_SETTINGS = {
  teamName: 'Portowcy FC',
  formation: '3-5-2',
  useLoyalty: true,
  trainingBonus: false,
  trainingType: 'Podania',
  trainingCfg: { intensity: 100, coachLevel: 4, assistants: 10, staminaShare: 20 },
  spirit: 5,
  confidence: 6,
  staffContractEnd: '2026-12-04',
  cashFloor: 1000000,
  theme: 'auto',
};

export const DEFAULT_FINANCE = {
  cash: 2329766,
  at: '2026-11-10',
  sponsors: 368000,
  homeIncome: 1100000,
  awayTickets: 56000,
  staff: 301120,
  stadium: 79000,
  youth: 80000,
  homeEvery: 2,
  weeks: 16,
};

export const state = {
  squad: { players: [] },
  youth: { players: [] },
  club: null,
  matches: [],
  finance: { ...DEFAULT_FINANCE },
  candidates: [],
  settings: { ...DEFAULT_SETTINGS },
  lineups: {},
  history: [],
  online: true,
  loaded: false,
};

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const cacheKey = (name) => `gaffer2:${name}`;
function cacheSet(name, value) {
  try { localStorage.setItem(cacheKey(name), JSON.stringify(value)); } catch { /* brak miejsca / tryb prywatny */ }
}
function cacheGet(name) {
  try { return JSON.parse(localStorage.getItem(cacheKey(name))); } catch { return null; }
}

// Ładuje jeden zbiór: serwer → zapas w telefonie → domyślne.
async function load(name, fallback) {
  try {
    const v = await getJson(`/api/store/${name}`);
    if (v != null) cacheSet(name, v);
    return v ?? fallback;
  } catch {
    state.online = false;
    return cacheGet(name) ?? fallback;
  }
}

export async function loadAll() {
  const [squad, youth, club, matches, finance, candidates, settings, lineups] = await Promise.all([
    load('squad', { players: [] }),
    load('youth-squad', { players: [] }),
    load('club', null),
    load('matches', { matches: [] }),
    load('v2-finance', null),
    load('v2-candidates', null),
    load('v2-settings', null),
    load('v2-lineups', {}),
  ]);
  state.squad = squad;
  state.youth = youth;
  state.club = club;
  state.matches = ensureMatchIds((matches?.matches ?? []).map(tidyMatch));
  state.finance = { ...DEFAULT_FINANCE, ...(finance ?? {}) };
  state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}), trainingCfg: { ...DEFAULT_SETTINGS.trainingCfg, ...(settings?.trainingCfg ?? {}) } };
  if (!settings && club?.training) {
    state.settings.trainingType = club.training.type ?? state.settings.trainingType;
    state.settings.trainingCfg = { intensity: club.training.intensity ?? 100, coachLevel: club.training.coachLevel ?? 4, assistants: club.training.assistantsLevel ?? 10, staminaShare: club.training.stamina ?? 20 };
  }
  state.lineups = lineups ?? {};
  // kandydaci z v1 (localStorage tej samej strony) — przenosimy raz na serwer
  state.candidates = candidates ?? migrateV1Candidates();
  if (!candidates && state.candidates.length) save('candidates');
  try { state.history = await getJson('/api/history'); } catch { state.history = []; }
  state.loaded = true;
  applyTheme();
}

// Stare wpisy miały rozgrywki w nazwie rywala („Ultras_GKS (Puchar Polski)”) albo opis zamiast rywala
// („1. kolejka ligi VI.139”). Rozdzielamy to przy wczytaniu; id meczu zostaje bez zmian.
function tidyMatch(m) {
  const out = { ...m };
  for (const side of ['homeTeamName', 'awayTeamName']) {
    const v = String(out[side] ?? '');
    const paren = v.match(/^(.*\S)\s+\(([^)]+)\)$/);
    if (paren) { out[side] = paren[1]; out.competition ??= paren[2]; }
    else if (/kolejka/i.test(v)) { out[side] = 'rywal ?'; out.competition ??= v.replace(/^./, (c) => c.toUpperCase()); }
  }
  if (!m.id) out.id = `${String(m.date).slice(0, 16)}|${m.homeTeamName}|${m.awayTeamName}`;
  return out;
}

function migrateV1Candidates() {
  try {
    const old = JSON.parse(localStorage.getItem('gaffer:candidates') || '[]');
    return old.map((c) => ({ ...c, id: c.id ?? nameId(c.name || 'kandydat'), wageMode: c.wageMode ?? 'abroad', addedAt: c.addedAt ?? new Date().toISOString() }));
  } catch {
    return [];
  }
}

const STORE_FILE = {
  squad: ['squad', () => state.squad],
  youth: ['youth-squad', () => state.youth],
  matches: ['matches', () => ({ fetchedAt: new Date().toISOString(), matches: state.matches })],
  finance: ['v2-finance', () => state.finance],
  candidates: ['v2-candidates', () => state.candidates],
  settings: ['v2-settings', () => state.settings],
  lineups: ['v2-lineups', () => state.lineups],
};

export async function save(what) {
  const [file, get] = STORE_FILE[what];
  const body = get();
  cacheSet(file, body);
  const r = await fetch(`/api/store/${file}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || `Nie zapisano (${r.status})`);
  }
  if (what === 'squad') {
    try { state.history = await getJson('/api/history'); } catch { /* wykresy odświeżą się później */ }
  }
}

export function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------- pomocnicze ----------

export const teamName = () => state.settings.teamName || state.squad.teamName || 'Moja drużyna';
export const players = () => state.squad.players ?? [];
export const playerById = (id) => players().find((p) => p.id === id);
export const savedLineup = (m) => (m ? state.lineups[matchId(m)] ?? null : null);
export const weeklyWages = () => players().reduce((a, p) => a + (p.salary || 0), 0);

// Pola wpisywane ręcznie w Gafferze, których nie ma w eksporcie HT — przenosimy przy imporcie.
const KEEP_FIELDS = ['trained', 'motherClubManual', 'manualRating', 'note', 'lastMatchDate'];
export function mergeImportedSquad(imported) {
  const old = new Map(players().map((p) => [p.id, p]));
  const next = imported.players.map((p) => {
    const o = old.get(p.id);
    if (!o) return p;
    const keep = Object.fromEntries(KEEP_FIELDS.filter((k) => o[k] != null).map((k) => [k, o[k]]));
    return { ...p, ...keep };
  });
  return { ...state.squad, teamName: teamName(), players: next, fetchedAt: new Date().toISOString() };
}

// Nowy zawodnik w kadrze z karty (kandydat kupiony albo zrzut własnego zawodnika).
export function playerFromCard(c, { salary } = {}) {
  const [first, ...rest] = String(c.name || 'Nowy zawodnik').trim().split(/\s+/);
  const p = {
    id: c.playerId || nameId(c.name || String(Date.now())),
    firstName: rest.length ? first : '',
    lastName: rest.length ? rest.join(' ') : first,
    nickName: '', number: null,
    age: c.age ?? 25, ageDays: c.ageDays ?? 0,
    ageYears: Number(((c.age ?? 25) + (c.ageDays ?? 0) / 112).toFixed(2)),
    form: c.form ?? 6, stamina: c.stamina ?? 6, experience: c.experience ?? 3, leadership: c.leadership ?? 3,
    loyalty: c.loyalty ?? 0, motherClubBonus: false, motherClubManual: false,
    tsi: c.tsi ?? 0, salary: salary ?? c.salary ?? 0, specialty: c.specialty ?? 0,
    injuryLevel: -1, yellowCards: 0, transferListed: false, daysAtClub: 0, trained: false, manualRating: null,
    weeksSinceLastMatch: 0, recentRatings: [],
  };
  for (const [k] of SKILLS) p[k] = c[k] ?? 0;
  return p;
}
