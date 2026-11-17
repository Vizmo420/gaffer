#!/usr/bin/env node
// Gaffer — powiadomienia na telefon przez ntfy (aplikacja ntfy na iPhone/Android, temat z ~/.config/gaffer/ntfy.env).
// Uruchamiane co 10 minut przez gaffer-notify.timer. Czyta dane z data/*.json, nie wymaga działającego serwera.
// Każde zdarzenie wysyła raz (pamięć w data/notify-state.json).
//
//   node scripts/notify.mjs          sprawdź i wyślij, co trzeba
//   node scripts/notify.mjs test     wyślij próbne powiadomienie
//   node scripts/notify.mjs dry      pokaż, co by wysłał (bez wysyłania)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextMatch, pendingResults, opponentOf, matchId, nextTrainingUpdate, minutesPlan, parseDeadline, fmtDate, fullName } from '../web/v2/logic.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'notify-state.json');
const HOUR = 3600e3;

export function readConfig() {
  const file = path.join(os.homedir(), '.config/gaffer/ntfy.env');
  const cfg = { server: 'https://ntfy.sh', topic: '', url: 'http://192.168.1.79:5173/v2/' };
  if (!fs.existsSync(file)) return cfg;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (m[1] === 'NTFY_TOPIC') cfg.topic = m[2];
    if (m[1] === 'NTFY_SERVER') cfg.server = m[2].replace(/\/+$/, '');
    if (m[1] === 'GAFFER_URL') cfg.url = m[2];
  }
  return cfg;
}

const read = (name, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, name + '.json'), 'utf8')) ?? fallback; } catch { return fallback; }
};

export async function send(cfg, { title, message, route = '', tags = [], priority = 3 }) {
  if (!cfg.topic) throw new Error('Brak tematu ntfy (~/.config/gaffer/ntfy.env)');
  const r = await fetch(cfg.server, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: cfg.topic, title, message, tags, priority, click: cfg.url + route }),
  });
  if (!r.ok) throw new Error(`ntfy: HTTP ${r.status}`);
}

// Zdarzenia do wysłania teraz. Czysta funkcja (testowalna): dane + czas → lista {key, title, message, route}.
export function events({ squad, matches, lineups, candidates, settings, now = new Date() }) {
  const on = { lineup: true, result: true, training: true, auction: true, ...(settings.notify ?? {}) };
  const team = settings.teamName || squad.teamName || 'Portowcy FC';
  const out = [];
  const nm = nextMatch(matches, now);
  if (on.lineup && nm && !lineups[matchId(nm)]) {
    const h = (new Date(nm.date) - now) / HOUR;
    if (h > 0 && h <= 3) {
      const o = opponentOf(nm, team);
      out.push({ key: `lineup:${matchId(nm)}`, title: `Mecz za ${Math.max(1, Math.round(h))} h — skład niezapisany`, message: `${o.home ? 'vs' : '@'} ${o.name} (${fmtDate(nm.date, true)}). Ustaw skład w Gafferze i w HT.`, route: '#/sklad', tags: ['soccer'], priority: 4 });
    }
  }
  if (on.result) for (const m of pendingResults(matches, now)) {
    if ((now - new Date(m.date)) / HOUR > 72) continue; // stare zaległości już przypominał Start
    out.push({ key: `result:${matchId(m)}`, title: 'Wpisz wynik meczu', message: `${opponentOf(m, team).name} (${fmtDate(m.date)}). Najlepiej zrzut raportu — od razu wpiszą się też oceny.`, route: `#/wiecej/mecze/${encodeURIComponent(matchId(m))}`, tags: ['memo'] });
  }
  if (on.training) {
    const next = nextTrainingUpdate(now);
    const last = new Date(next.getTime() - 7 * 24 * HOUR);
    const sinceLast = (now - last) / HOUR;
    if (sinceLast >= 0.5 && sinceLast < 14) {
      out.push({ key: `training:${last.toISOString().slice(0, 10)}`, title: 'Trening się zaktualizował', message: 'Zaktualizuj kadrę: Kadra → aparat → zrzut tabeli zawodników (albo eksport CSV).', route: '#/kadra', tags: ['chart_with_upwards_trend'] });
    }
    const toNext = (next - now) / HOUR;
    if (toNext > 0 && toNext <= 9 && settings.trainingType) {
      const mp = minutesPlan({ players: squad.players ?? [], matches, lineups, settings, now });
      const miss = mp.rows.filter((r) => r.status === 'missing' && r.core);
      if (miss.length) out.push({ key: `minutes:${next.toISOString().slice(0, 10)}`, title: `Trening w nocy: ${miss.length} z XI bez minut`, message: `${miss.slice(0, 4).map((r) => fullName(r.player)).join(', ')}${miss.length > 4 ? '…' : ''} nie zagrali na trenowanej pozycji w tym tygodniu.`, route: '#/wiecej/trening', tags: ['warning'] });
    }
  }
  if (on.auction) for (const c of candidates ?? []) {
    if (c.status) continue;
    const d = parseDeadline(c.deadline);
    if (!d) continue;
    const min = (d - now) / 6e4;
    if (min > 0 && min <= 60) out.push({ key: `auction:${c.id}`, title: `Aukcja: ${c.name}`, message: `Koniec za ${Math.round(min)} min${c.price ? `, ostatnio ${Math.round(c.price).toLocaleString('pl-PL')} zł` : ''}.`, route: '#/rynek', tags: ['moneybag'], priority: 4 });
  }
  if (settings.staffContractEnd) {
    const days = (new Date(settings.staffContractEnd) - now) / (24 * HOUR);
    if (days > 0 && days <= 7) out.push({ key: `staff:${settings.staffContractEnd}`, title: 'Kontrakty sztabu', message: `Kończą się ${fmtDate(settings.staffContractEnd)} — zdecyduj, kogo przedłużyć.`, route: '#/rynek/finanse', tags: ['briefcase'] });
  }
  return out;
}

async function main(mode) {
  const cfg = readConfig();
  if (mode === 'test') {
    await send(cfg, { title: 'Gaffer: test', message: 'Powiadomienia działają. Dotknij, żeby otworzyć Gaffera.', tags: ['white_check_mark'] });
    console.log('Wysłano próbne powiadomienie.');
    return;
  }
  const state = read('notify-state', { sent: {} });
  const data = {
    squad: read('squad', { players: [] }),
    matches: (read('matches', { matches: [] }).matches ?? []).map((m) => (m.id == null ? { ...m } : m)),
    lineups: read('v2-lineups', {}),
    candidates: read('v2-candidates', []),
    settings: read('v2-settings', {}) ?? {},
  };
  const todo = events(data).filter((e) => !state.sent[e.key]);
  for (const e of todo) {
    if (mode === 'dry') { console.log(`[dry] ${e.title} — ${e.message}`); continue; }
    try { await send(cfg, e); state.sent[e.key] = new Date().toISOString(); console.log(`Wysłano: ${e.title}`); } catch (err) { console.error(err.message); }
  }
  // sprzątanie: wpisy starsze niż 60 dni
  for (const [k, at] of Object.entries(state.sent)) if (Date.now() - new Date(at) > 60 * 24 * HOUR) delete state.sent[k];
  if (mode !== 'dry') fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((e) => { console.error(e.message); process.exit(1); });
}
