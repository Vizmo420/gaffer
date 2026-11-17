// Gaffer v2 — obliczenia łączące dane z silnikiem (skład na mecz, prognoza, kontekst dla AI).

import { FORMATIONS } from '../optimizer.js';
import { predictRatings, simulateMatch, relocateMidfield, hatStats, TACTICS } from '../ht-ratings.js';
import { forecastCash, safeSpend } from '../planner.js';
import { pickLineup, squadOpts, nextMatch, opponentOf, matchId, fullName, SLOT_NAME, SKILLS, youthVerdicts, sellAdvice, fmtMoney, calibration, applyCalibration, rotationLineup, priceEstimate } from './logic.js';
import { state, players, teamName, savedLineup, weeklyWages } from './store.js';

// Stan edycji składu (w pamięci, do zapisu). Klucz: id meczu.
export const edit = { matchId: null, formation: null, locks: {}, tactic: 'normal', captainId: null, setPiecesId: null, variant: 'strong' };

export const opts = () => squadOpts(state.settings);

export function currentMatch() {
  if (edit.matchId) {
    const m = state.matches.find((x) => matchId(x) === edit.matchId);
    if (m) return m;
  }
  return nextMatch(state.matches);
}

// Ustawia edycję na mecz: wczytuje zapisany skład (jako blokady wszystkich pozycji) albo czyści.
export function startEdit(m) {
  const saved = savedLineup(m);
  edit.matchId = m ? matchId(m) : null;
  edit.formation = saved?.formation ?? state.settings.formation;
  edit.locks = {};
  if (saved) saved.playerIds.forEach((id, i) => { if (id != null && players().some((p) => p.id === id)) edit.locks[i] = id; });
  edit.tactic = saved?.tactic ?? 'normal';
  edit.captainId = saved?.captainId ?? null;
  edit.setPiecesId = saved?.setPiecesId ?? null;
  edit.variant = saved?.variant ?? 'strong';
}

// Skład treningowy dla bieżącego meczu: blokuje wszystkie 11 pozycji (dalej można zmieniać ręcznie).
export function rotationFor() {
  const f = edit.formation === 'auto' || !edit.formation ? state.settings.formation : edit.formation;
  return rotationLineup(players(), { formation: f, opts: opts(), trainingType: state.settings.trainingType });
}
export function applyVariant(v) {
  edit.variant = v;
  edit.locks = {};
  if (v !== 'rotation') return;
  const r = rotationFor();
  if (!r) return;
  edit.formation = r.name;
  r.result.slots.forEach((s, i) => { if (s.player) edit.locks[i] = s.player.id; });
}

export function currentLineup() {
  return pickLineup(players(), { formation: edit.formation ?? state.settings.formation, locks: edit.locks, opts: opts() });
}

// Najlepszy skład bez blokad (do analiz: sprzedaż, akademia, trening).
let bestCache = { key: '', value: null };
export const invalidateBest = () => { bestCache = { key: '', value: null }; };
export function bestXI() {
  const key = JSON.stringify([players().length, players().map((p) => p.id + ':' + p.form + ':' + p.injuryLevel + ':' + p.yellowCards).join(), state.settings.formation, state.settings.useLoyalty, state.settings.weights ?? null]);
  if (bestCache.key !== key) bestCache = { key, value: pickLineup(players(), { formation: state.settings.formation, opts: opts() }) };
  return bestCache.value;
}

export function rivalRatings(m) {
  const r = m?.rival;
  if (!r || !['midfield', 'defRight', 'defCentral', 'defLeft', 'attRight', 'attCentral', 'attLeft'].every((k) => Number(r[k]) > 0)) return null;
  const base = Object.fromEntries(['midfield', 'defRight', 'defCentral', 'defLeft', 'attRight', 'attCentral', 'attLeft'].map((k) => [k, Number(r[k])]));
  const weHome = opponentOf(m, teamName()).home;
  return relocateMidfield(base, r.wasHome ? 'home' : 'away', weHome ? 'away' : 'home');
}

export function predictionCtx(m, tactic = edit.tactic) {
  return {
    spirit: Number(state.settings.spirit ?? 5),
    confidence: Number(state.settings.confidence ?? 5),
    location: m ? (opponentOf(m, teamName()).home ? 'home' : 'away') : 'home',
    tactic,
    attitude: 'normal',
  };
}

// Korekta z porównania prognoz z ocenami z raportów (po co najmniej 2 meczach).
export const calib = () => calibration(state.matches, state.lineups);
const corrected = (r) => (state.settings.calibrate === false ? r : applyCalibration(r, calib()));

export function prediction(lineup, m) {
  if (!lineup) return null;
  const lu = lineup.result.slots.map((s) => ({ slot: s.slot, player: s.player }));
  const raw = predictRatings(lu, predictionCtx(m));
  const ours = corrected(raw);
  const opp = rivalRatings(m);
  const out = { ours, raw, hs: hatStats(ours), opp, sim: null, tactics: [] };
  if (opp) {
    const oppTactic = m?.rival?.tactic && TACTICS[m.rival.tactic] ? m.rival.tactic : 'normal';
    out.oppTactic = oppTactic;
    out.sim = simulateMatch(ours, opp, { tactic: edit.tactic, oppTactic, runs: 4000 });
    out.tactics = Object.keys(TACTICS).map((t) => {
      const r = corrected(predictRatings(lu, predictionCtx(m, t)));
      const s = simulateMatch(r, opp, { tactic: t, oppTactic, runs: 4000 });
      return { t, label: TACTICS[t], s, pts: (3 * s.win + s.draw) / 100 };
    }).sort((a, b) => b.pts - a.pts);
  }
  return out;
}

// ---------- finanse ----------
export function financeOpts() {
  const f = state.finance;
  return { cash: f.cash, wages: weeklyWages(), sponsors: f.sponsors, stadium: f.stadium, staff: f.staff, youth: f.youth, homeIncome: f.homeIncome, awayTickets: f.awayTickets, weeks: f.weeks ?? 16, homeEvery: f.homeEvery ?? 2 };
}
export const forecast = () => forecastCash(financeOpts());
export const spendable = () => safeSpend(financeOpts(), state.settings.cashFloor ?? 1000000);

// ---------- kontekst dla doradcy AI ----------
export function aiContext() {
  const lu = currentLineup();
  const m = currentMatch();
  const team = teamName();
  const sk = (p) => SKILLS.map(([k, l]) => `${l.toLowerCase()} ${p[k] ?? '?'}`).join(', ');
  const lines = [];
  lines.push(`# Drużyna: ${team}`);
  if (m) {
    const o = opponentOf(m, team);
    lines.push(`Najbliższy mecz: ${new Date(m.date).toLocaleString('pl-PL')} — ${o.home ? 'u siebie' : 'na wyjeździe'} z ${o.name}${m.competition ? ` (${m.competition})` : ''}.`);
    const rr = rivalRatings(m);
    if (rr) lines.push(`Oceny HT rywala (z jego ostatniego meczu, przeliczone na to miejsce): ${Object.entries(rr).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}.`);
  }
  if (lu) {
    lines.push(`\n## Proponowany skład (${lu.name}), suma ocen Gaffera ${lu.result.total.toFixed(1)}`);
    for (const s of lu.result.slots) if (s.player) lines.push(`- ${SLOT_NAME[s.slot]}: ${fullName(s.player)} (ocena ${s.score.toFixed(2)})`);
  }
  lines.push('\n## Kadra seniorów');
  for (const p of players()) {
    const flags = [p.injuryLevel > 0 ? 'KONTUZJA' : '', (p.yellowCards ?? 0) >= 2 ? `kartki ${p.yellowCards}` : '', p.transferListed ? 'WYSTAWIONY NA SPRZEDAŻ' : ''].filter(Boolean).join(', ');
    lines.push(`- ${fullName(p)}, ${p.age} l., forma ${p.form}, kondycja ${p.stamina}, ${sk(p)}, doświadczenie ${p.experience}, lojalność ${p.loyalty ?? '?'}, TSI ${p.tsi}, pensja ${p.salary} zł${flags ? ` [${flags}]` : ''}`);
  }
  const yv = youthVerdicts(state.youth.players ?? [], players(), lu);
  if (yv.length) {
    lines.push('\n## Akademia (ocena Gaffera)');
    for (const v of yv) lines.push(`- ${fullName(v.player)}, ${v.player.age} l., potencjał ${v.potential}, najlepiej ${SLOT_NAME[v.bestSlot] ?? '?'}: ${v.verdict}`);
  }
  const sells = sellAdvice(players(), lu, opts()).filter((s) => s.verdict === 'sell');
  if (sells.length) lines.push(`\n## Kandydaci do sprzedaży wg Gaffera: ${sells.map((s) => `${fullName(s.player)} (${s.reasons.join('; ')})`).join(', ')}`);
  const f = forecast();
  lines.push(`\n## Finanse\nGotówka ${fmtMoney(state.finance.cash)} (stan na ${state.finance.at}). Pensje ${fmtMoney(weeklyWages())}/tydz., sztab ${fmtMoney(state.finance.staff)}/tydz. Prognoza 16 tyg.: minimum ${fmtMoney(f.minCash)} w tyg. ${f.minWeek}, koniec ${fmtMoney(f.endCash)}.`);
  const t = state.settings;
  lines.push(`\n## Trening: ${t.trainingType}, intensywność ${t.trainingCfg.intensity}%, trener poziom ${t.trainingCfg.coachLevel}, asystenci ${t.trainingCfg.assistants}.`);
  const cands = state.candidates.filter((c) => !c.status);
  if (cands.length) lines.push(`\n## Obserwowani na rynku: ${cands.map((c) => `${c.name} (${c.age ?? '?'} l., rozgrywanie ${c.playmaking ?? '?'}, cena ${c.price ? fmtMoney(c.price) : '?'})`).join('; ')}`);
  return lines.join('\n');
}

export const FORMATION_NAMES = Object.keys(FORMATIONS);

// Baza cen: zrzuty „do bazy cen”, kandydaci z ceną i własne transfery. Bez duplikatów po nazwisku.
export function priceEntries() {
  const all = [...state.prices, ...state.candidates.filter((c) => c.price), ...state.transfers.filter((t) => t.price && t.tsi)];
  const seen = new Map();
  for (const e of all) seen.set(String(e.name ?? '').toLowerCase() + '|' + (e.age ?? ''), e);
  return [...seen.values()];
}
export const marketValue = (p) => priceEstimate(priceEntries(), p);
