// Gaffer v2 — logika ekranów (czyste funkcje, bez DOM). Testy: test/v2-logic.test.mjs.
// Silnik składu, oceny meczowe i finanse są w modułach v1 (optimizer.js, ht-ratings.js, planner.js).

import { FORMATIONS, TRAINING_TYPES, WEIGHTS, bestFormation, bestLineup, eligiblePlayers, ratePlayerForSlot, isSuspended, youthPotential, detectYouthStar } from '../optimizer.js';
import { PRIMARY_TRAINED_SKILL, weeksToNextLevel, projectSkillAfter } from '../training-calc.js';

export const SKILLS = [
  ['keeper', 'Bronienie'], ['defending', 'Defensywa'], ['playmaking', 'Rozgrywanie'], ['winger', 'Dośrodkowania'],
  ['passing', 'Podania'], ['scoring', 'Skuteczność'], ['setPieces', 'St. fragmenty'],
];
export const SKILL_NAME = Object.fromEntries(SKILLS);

export const SLOT_SHORT = { GK: 'BR', CD: 'ŚO', WB: 'BO', WI: 'SK', IM: 'ŚP', FW: 'NP' };
export const SLOT_NAME = { GK: 'Bramkarz', CD: 'Środkowy obrońca', WB: 'Boczny obrońca', WI: 'Skrzydłowy', IM: 'Środkowy pomocnik', FW: 'Napastnik' };

export const fullName = (p) => `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || `#${p.id}`;

const HOUR = 3600e3;
const DAY = 24 * HOUR;

// ---------------- mecze ----------------

// Mecz bez wyniku, który już się odbył (2 h po starcie), czeka na wpisanie wyniku — nie jest „nadchodzący”.
export function matchState(m, now = new Date()) {
  if (m.homeGoals != null && m.awayGoals != null) return 'done';
  if (m.status === 'FINISHED') return 'done';
  const t = new Date(m.date).getTime();
  if (Number.isFinite(t) && now.getTime() > t + 2 * HOUR) return 'needsResult';
  return 'upcoming';
}

export const byDate = (a, b) => new Date(a.date) - new Date(b.date);

export function matchId(m) {
  return m.id != null && m.id !== '' ? String(m.id) : `${String(m.date).slice(0, 16)}|${m.homeTeamName}|${m.awayTeamName}`;
}

export function ensureMatchIds(list) {
  return list.map((m) => (m.id ? m : { ...m, id: matchId(m) }));
}

export function nextMatch(matches, now = new Date()) {
  return matches.filter((m) => matchState(m, now) === 'upcoming').sort(byDate)[0] ?? null;
}

export function pendingResults(matches, now = new Date()) {
  return matches.filter((m) => matchState(m, now) === 'needsResult').sort(byDate);
}

export function opponentOf(m, team) {
  const home = m.homeTeamName === team || (m.awayTeamName !== team && m.home === true);
  return { home, name: (home ? m.awayTeamName : m.homeTeamName) || 'rywal' };
}

export function resultFor(m, team) {
  if (m.homeGoals == null || m.awayGoals == null) return null;
  const { home } = opponentOf(m, team);
  const us = home ? m.homeGoals : m.awayGoals;
  const them = home ? m.awayGoals : m.homeGoals;
  return { us, them, letter: us > them ? 'W' : us === them ? 'R' : 'P' };
}

// ---------------- trening: piątek 02:30 ----------------

export function nextTrainingUpdate(now = new Date()) {
  const d = new Date(now);
  d.setHours(2, 30, 0, 0);
  const add = (5 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  if (d <= now) d.setDate(d.getDate() + 7);
  return d;
}

export function trainingUpdatesBetween(a, b) {
  const from = new Date(a), to = new Date(b);
  if (!(to > from)) return 0;
  let n = 0;
  for (let d = nextTrainingUpdate(from); d <= to; d = new Date(d.getTime() + 7 * DAY)) n++;
  return n;
}

// Zmiany umiejętności między dwiema migawkami. Skok bez aktualizacji treningu w międzyczasie
// (albo większy niż liczba aktualizacji) to prawie na pewno błąd przy przepisywaniu danych.
export function skillChanges(prev, curr) {
  if (!prev?.players || !curr?.players) return [];
  const before = new Map(prev.players.map((p) => [p.id, p]));
  const updates = trainingUpdatesBetween(prev.at, curr.at);
  const out = [];
  for (const p of curr.players) {
    const o = before.get(p.id);
    if (!o) continue;
    for (const [k, label] of SKILLS) {
      const a = o[k], b = p[k];
      if (a == null || b == null || a < 0 || b < 0 || a === b) continue;
      const diff = b - a;
      const suspicious = diff > 0 ? diff > updates : diff < -1 || updates === 0;
      out.push({ id: p.id, name: fullName(p), skill: k, label, from: a, to: b, diff, suspicious });
    }
  }
  return out;
}

export function rosterChanges(prev, curr) {
  if (!prev?.players || !curr?.players) return { added: [], removed: [] };
  const a = new Set(prev.players.map((p) => p.id));
  const b = new Set(curr.players.map((p) => p.id));
  return {
    added: curr.players.filter((p) => !a.has(p.id)),
    removed: prev.players.filter((p) => !b.has(p.id)),
  };
}

export function playerHistory(snapshots, id) {
  return snapshots
    .map((s) => ({ at: s.at, p: s.players.find((x) => x.id === id) }))
    .filter((x) => x.p)
    .map((x) => ({ at: x.at, ...x.p }));
}

// ---------------- transfery ----------------

// HT dolicza 20% pensji zawodnikom grającym poza swoim krajem. Zmiana zależy więc od tego,
// skąd i dokąd przechodzi (Olofsson: z zagranicy do zagranicy, pensja bez zmian).
export const WAGE_MODES = {
  same: { factor: 1, label: 'bez zmian (już gra za granicą)' },
  abroad: { factor: 1.2, label: '+20% (wyjeżdża ze swojego kraju)' },
  home: { factor: 1 / 1.2, label: '−17% (Polak wraca do Polski)' },
};

export function wageAfterTransfer(salary, mode = 'abroad') {
  return Math.round((salary || 0) * (WAGE_MODES[mode]?.factor ?? 1.2));
}

// ---------------- skład ----------------

export function squadOpts(settings = {}) {
  return {
    useLoyalty: settings.useLoyalty ?? true,
    allowInjured: false,
    allowSuspended: false,
    training: settings.trainingBonus ? { type: settings.trainingType, weight: 0.6 } : null,
  };
}

// Najlepszy skład: formacja stała albo automatyczna. Zwraca { name, slots, result }.
export function pickLineup(players, { formation = 'auto', locks = {}, opts = {} } = {}) {
  const pool = eligiblePlayers(players, opts);
  if (formation === 'auto' || !FORMATIONS[formation]) return bestFormation(pool, opts, locks);
  const result = bestLineup(pool, FORMATIONS[formation], opts, locks);
  return result ? { name: formation, slots: FORMATIONS[formation], result } : null;
}

// Alternatywy na dany slot: zawodnicy spoza wyjściowej XI posortowani wg oceny + różnica do obecnego.
export function alternativesFor(players, lineup, slotIndex, opts = {}) {
  const cur = lineup.result.slots[slotIndex];
  const inXI = new Set(lineup.result.slots.map((s) => s.player?.id).filter(Boolean));
  return eligiblePlayers(players, opts)
    .filter((p) => !inXI.has(p.id))
    .map((p) => ({ player: p, score: ratePlayerForSlot(p, cur.slot, opts) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .map((x) => ({ ...x, diff: x.score - cur.score }));
}

// Gdzie zawodnik gra najlepiej: 3 typy pozycji z oceną.
export function bestSlots(p, opts = {}, n = 3) {
  return ['GK', 'CD', 'WB', 'WI', 'IM', 'FW']
    .map((slot) => ({ slot, score: ratePlayerForSlot(p, slot, { ...opts, allowInjured: true }) }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

export function lineupToText(lineup, { captain, setPieces, match, team } = {}) {
  const rows = lineup.result.slots.map((s) => `${SLOT_SHORT[s.slot]}  ${s.player ? fullName(s.player) : '—'}`);
  const head = match ? `${team ?? ''} — ${opponentOf(match, team).name}, ${new Date(match.date).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : '';
  return [head, `Formacja ${lineup.name}`, ...rows, captain ? `Kapitan: ${fullName(captain)}` : '', setPieces ? `Stałe fragmenty: ${fullName(setPieces)}` : '']
    .filter(Boolean)
    .join('\n');
}

// ---------------- trening ----------------

export function coverageFor(slot, trainingType) {
  const map = TRAINING_TYPES[trainingType] || { full: [], partial: [] };
  return map.full.includes(slot) ? 'full' : map.partial.includes(slot) ? 'partial' : 'none';
}

// Plan treningu dla zawodników XI (i ewentualnie wskazanych dodatkowych): kto trenuje, ile tygodni do skoku.
export function trainingPlan(players, lineupSlots, cfg) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  const slotOf = new Map(lineupSlots.filter((s) => s.player).map((s) => [s.player.id, s.slot]));
  return players
    .map((p) => {
      const slot = slotOf.get(p.id) ?? null;
      const coverage = slot ? coverageFor(slot, cfg.type) : 'none';
      const w = coverage === 'none' || !skill ? { weeks: null } : weeksToNextLevel(p, { ...cfg, coverage });
      const after13 = coverage === 'none' || !skill ? null : projectSkillAfter(p, { ...cfg, coverage }, 13);
      return { player: p, slot, coverage, skill, level: skill ? p[skill] : null, weeks: w.weeks, nextLevel: w.nextLevel, after13 };
    })
    .sort((a, b) => (a.weeks ?? 999) - (b.weeks ?? 999));
}

// Porównanie typów treningu dla obecnej XI: ilu zawodników trenuje i jak szybko średnio.
export function compareTrainingTypes(players, lineupSlots, cfg) {
  return Object.keys(TRAINING_TYPES)
    .filter((t) => PRIMARY_TRAINED_SKILL[t] && PRIMARY_TRAINED_SKILL[t] !== 'stamina')
    .map((type) => {
      const plan = trainingPlan(players, lineupSlots, { ...cfg, type }).filter((x) => x.weeks != null);
      const pops13 = plan.reduce((a, x) => a + Math.max(0, Math.floor(x.after13 ?? x.level) - x.level), 0);
      return { type, trained: plan.length, pops13 };
    })
    .sort((a, b) => b.pops13 - a.pops13 || b.trained - a.trained);
}

// ---------------- kogo sprzedać ----------------

// Rezerwowy = ktoś z najlepszego drugiego składu (B) ułożonego z zawodników spoza XI.
// Do rozważenia sprzedaży: poza składami A i B albo 31+ i poza XI — kosztuje pensję, a do gry nie jest potrzebny.
export function sellAdvice(players, lineup, opts = {}) {
  const slots = lineup?.slots ?? FORMATIONS['3-5-2'];
  const inXI = new Set(lineup?.result?.slots.map((s) => s.player?.id).filter(Boolean) ?? []);
  const rest = players.filter((p) => !inXI.has(p.id));
  const b = bestLineup(eligiblePlayers(rest, { ...opts, allowInjured: true, allowSuspended: true }), slots, { ...opts, allowInjured: true }, {});
  const inB = new Map((b?.result?.slots ?? b?.slots ?? []).filter((s) => s.player).map((s) => [s.player.id, s.slot]));
  return rest
    .map((p) => {
      const best = bestSlots(p, opts, 1)[0];
      const slot = inB.get(p.id) ?? best?.slot;
      const age = p.ageYears ?? p.age;
      const reasons = [];
      if (!inB.has(p.id)) reasons.push('nie mieści się nawet w składzie rezerw');
      if (age >= 31) reasons.push(`wiek ${p.age} — wartość będzie spadać`);
      if (inB.has(p.id) && age < 31) reasons.push(`rezerwowy: ${SLOT_NAME[slot].toLowerCase()}`);
      const verdict = p.transferListed ? 'listed' : !inB.has(p.id) || age >= 31 ? 'sell' : 'keep';
      return { player: p, slot, inB: inB.has(p.id), verdict, reasons, weeklySaving: p.salary || 0 };
    })
    .sort((x, y) => (x.verdict === 'sell' ? 0 : 1) - (y.verdict === 'sell' ? 0 : 1) || y.weeklySaving - x.weeklySaving);
}

// ---------------- akademia ----------------

export function youthVerdicts(youth, seniors, lineup) {
  const star = detectYouthStar(youth);
  const xiMin = {};
  for (const s of lineup?.result?.slots ?? []) if (s.player) xiMin[s.slot] = Math.min(xiMin[s.slot] ?? Infinity, s.score);
  return youth
    .map((p) => {
      const pot = youthPotential(p);
      const best = ['GK', 'CD', 'WB', 'WI', 'IM', 'FW']
        .map((slot) => ({ slot, score: ratePlayerForSlot(p, slot, { usePotential: true, youth: true, allowInjured: true }) }))
        .sort((a, b) => b.score - a.score)[0];
      const age = p.ageYears ?? p.age;
      const reasons = [];
      let verdict = 'watch';
      if (p.id === star) { verdict = 'develop'; reasons.push('najwyższy potencjał w akademii'); }
      else if (pot >= 34) { verdict = 'develop'; reasons.push('wysoki potencjał'); }
      else if (pot < 22 && age >= 18) { verdict = 'release'; reasons.push('niski potencjał przy wieku 18+'); }
      const ready = best && xiMin[best.slot] != null && best.score >= xiMin[best.slot] * 0.75;
      if (ready && (p.canBePromotedInDays ?? 1) <= 0 && age >= 17) { verdict = 'promote'; reasons.push(`na pozycji ${SLOT_SHORT[best.slot]} blisko poziomu obecnej XI`); }
      if (age >= 18.5 && verdict === 'watch') reasons.push('zbliża się koniec wieku juniora — zdecyduj wkrótce');
      return { player: p, potential: pot, bestSlot: best?.slot, bestScore: best?.score ?? 0, verdict, reasons };
    })
    .sort((a, b) => b.potential - a.potential);
}

export const YOUTH_VERDICT = {
  promote: { label: 'Awansuj', tone: 'good' },
  develop: { label: 'Rozwijaj', tone: 'good' },
  watch: { label: 'Obserwuj', tone: 'muted' },
  release: { label: 'Zwolnij', tone: 'bad' },
};

// ---------------- lista „przed meczem” ----------------

export function preMatchChecklist({ match, saved, lineup, players, settings = {}, rival }) {
  const items = [];
  const byId = new Map(players.map((p) => [p.id, p]));
  const xi = (saved?.playerIds ?? lineup?.result?.slots.map((s) => s.player?.id) ?? []).map((id) => byId.get(id)).filter(Boolean);
  items.push(saved ? { ok: true, text: 'Skład zapisany na ten mecz' } : { ok: false, text: 'Skład nie jest zapisany', hint: 'Skład → Zapisz' });
  const blocked = xi.filter((p) => p.injuryLevel > 0 || isSuspended(p));
  items.push(blocked.length ? { ok: false, text: `W składzie: ${blocked.map(fullName).join(', ')} (kontuzja lub pauza)` } : { ok: true, text: 'Nikt w składzie nie jest kontuzjowany ani zawieszony' });
  const risky = xi.filter((p) => (p.yellowCards ?? 0) === 2);
  if (risky.length) items.push({ ok: null, text: `Kartka = pauza: ${risky.map(fullName).join(', ')}` });
  items.push(saved?.captainId ? { ok: true, text: `Kapitan: ${fullName(byId.get(saved.captainId) ?? { id: saved.captainId })}` } : { ok: false, text: 'Wybierz kapitana' });
  items.push(saved?.setPiecesId ? { ok: true, text: `Stałe fragmenty: ${fullName(byId.get(saved.setPiecesId) ?? { id: saved.setPiecesId })}` } : { ok: false, text: 'Wybierz wykonawcę stałych fragmentów' });
  items.push(rival ? { ok: true, text: 'Oceny rywala wpisane — prognoza gotowa' } : { ok: null, text: 'Brak ocen rywala — prognoza bez porównania', hint: 'Mecze → Rywal' });
  if (settings.trainingType && lineup) {
    const plan = trainingPlan(xi, lineup.result.slots.filter((s) => xi.some((p) => p.id === s.player?.id)), { type: settings.trainingType, ...(settings.trainingCfg || {}) });
    const tr = plan.filter((x) => x.coverage !== 'none').length;
    items.push({ ok: tr > 0, text: `Trening (${settings.trainingType}): ${tr} z ${xi.length} zawodników XI gra na trenowanej pozycji` });
  }
  return { items, done: items.filter((i) => i.ok === true).length, total: items.length };
}

// ---------------- alerty na start ----------------

export function buildAlerts({ squad, matches = [], candidates = [], settings = {}, forecast, savedLineups = {}, team, now = new Date() }) {
  const out = [];
  for (const m of pendingResults(matches, now)) {
    out.push({ tone: 'warn', text: `Wpisz wynik: ${opponentOf(m, team).name} (${fmtDate(m.date)})`, route: `#/wiecej/mecze/${encodeURIComponent(matchId(m))}` });
  }
  const nm = nextMatch(matches, now);
  if (nm) {
    const h = (new Date(nm.date) - now) / HOUR;
    if (h < 48 && !savedLineups[matchId(nm)]) out.push({ tone: 'warn', text: `Mecz za ${h < 24 ? Math.max(1, Math.round(h)) + ' h' : '2 dni'} — skład niezapisany`, route: '#/sklad' });
  }
  const players = squad?.players ?? [];
  const injured = players.filter((p) => p.injuryLevel > 0);
  if (injured.length) out.push({ tone: 'bad', text: `Kontuzje: ${injured.map(fullName).join(', ')}`, route: '#/kadra' });
  const susp = players.filter(isSuspended);
  if (susp.length) out.push({ tone: 'bad', text: `Pauza za kartki: ${susp.map(fullName).join(', ')}`, route: '#/kadra' });
  for (const c of candidates) {
    const d = parseDeadline(c.deadline);
    if (!d || c.status === 'bought' || c.status === 'lost') continue;
    const h = (d - now) / HOUR;
    if (h > 0 && h < 36) out.push({ tone: 'info', text: `Aukcja ${c.name}: koniec ${h < 1 ? 'za chwilę' : `za ${Math.round(h)} h`}`, route: '#/rynek' });
    if (h <= 0 && h > -72 && !c.status) out.push({ tone: 'info', text: `Aukcja ${c.name} zakończona — kupiony?`, route: '#/rynek' });
  }
  if (settings.staffContractEnd) {
    const days = (new Date(settings.staffContractEnd) - now) / DAY;
    if (days >= 0 && days <= 28) out.push({ tone: 'warn', text: `Kontrakty sztabu kończą się za ${Math.ceil(days)} dni (${fmtDate(settings.staffContractEnd)})`, route: '#/rynek/finanse' });
  }
  if (squad?.fetchedAt) {
    const age = (now - new Date(squad.fetchedAt)) / DAY;
    if (age > 7) out.push({ tone: 'muted', text: `Dane kadry sprzed ${Math.floor(age)} dni — zaimportuj świeże`, route: '#/wiecej/import' });
  }
  if (settings.trainingType && players.length) {
    const mp = minutesPlan({ players, matches, lineups: savedLineups, settings, now });
    const miss = mp.rows.filter((r) => r.status === 'missing' && r.core);
    if (miss.length && (mp.to - now) / HOUR <= 72) out.push({ tone: 'warn', text: `Trening w piątek: ${miss.length === 1 ? fullName(miss[0].player) + ' nie ma' : miss.length + ' zawodników z XI nie ma'} minut na trenowanej pozycji`, route: '#/wiecej/trening' });
  }
  if (forecast && forecast.minCash < 0) out.push({ tone: 'bad', text: `Prognoza: kasa spadnie pod zero w ${forecast.minWeek}. tygodniu`, route: '#/rynek/finanse' });
  return out;
}

// ---------------- formatowanie ----------------

export function parseDeadline(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(iso, withTime = false) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pl-PL', withTime ? { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'numeric' });
}

export const fmtMoney = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString('pl-PL')} zł` : '—');

export function relTime(iso, now = new Date()) {
  const h = (new Date(iso) - now) / HOUR;
  if (!Number.isFinite(h)) return '';
  const a = Math.abs(h);
  if (a < 1) return h >= 0 ? 'za chwilę' : 'przed chwilą';
  const days = Math.round(a / 24);
  const txt = a < 24 ? `${Math.round(a)} h` : days === 1 ? '1 dzień' : `${days} dni`;
  return h >= 0 ? `za ${txt}` : `${txt} temu`;
}

// ---------------- minuty pod trening (HT: trenuje tylko ten, kto zagra na trenowanej pozycji) ----------------

// Plan na bieżący tydzień treningowy: kto powinien trenować, czy ma zaplanowany mecz na trenowanej pozycji,
// i gdzie go wstawić, jeśli nie. Mecze w tygodniu = od ostatniej aktualizacji (piątek 02:30) do następnej.
export function minutesPlan({ players, matches = [], lineups = {}, settings = {}, now = new Date() }) {
  const type = settings.trainingType;
  const next = nextTrainingUpdate(now);
  const prev = new Date(next.getTime() - 7 * DAY);
  const week = matches.filter((m) => { const t = new Date(m.date); return t > prev && t <= next; }).sort(byDate);
  const opts = squadOpts(settings);
  const plays = new Map(); // id → [{match, slot, trained}]
  for (const m of week) {
    const lu = lineups[matchId(m)];
    if (!lu) continue;
    lu.playerIds.forEach((id, i) => {
      if (id == null) return;
      const slot = lu.slots[i];
      if (!plays.has(id)) plays.set(id, []);
      plays.get(id).push({ match: m, slot, trained: coverageFor(slot, type) !== 'none' });
    });
  }
  const unsaved = week.filter((m) => !lineups[matchId(m)] && matchState(m, now) !== 'done');
  // „ważni” = najlepsza XI na trenowanej pozycji; reszta to rezerwowi (trenują tylko, jeśli dostaną mecz)
  const xi = pickLineup(players, { formation: settings.formation || 'auto', opts });
  const core = new Set((xi?.result.slots ?? []).filter((s) => s.player && coverageFor(s.slot, type) !== 'none').map((s) => s.player.id));
  const rows = [];
  for (const p of players) {
    const best = bestSlots(p, opts, 1)[0];
    const naturally = best && coverageFor(best.slot, type) === 'full';
    const g = plays.get(p.id) ?? [];
    const trainedIn = g.find((x) => x.trained);
    if (!naturally && !trainedIn) continue;
    const injured = p.injuryLevel > 0;
    let status, hint = null;
    if (trainedIn) status = 'ok';
    else if (injured) { status = 'injured'; hint = 'kontuzja — w tym tygodniu i tak nie potrenuje'; }
    else {
      status = 'missing';
      const where = unsaved.find((m) => !/lig[ai]/i.test(m.competition ?? '')) ?? unsaved[0];
      const offPos = g[0];
      hint = where ? `wstaw go na ${SLOT_NAME[best.slot].toLowerCase()} w meczu ${fmtDate(where.date)}`
        : offPos ? `gra jako ${SLOT_NAME[offPos.slot].toLowerCase()} — tam ${type?.toLowerCase()} go nie trenuje`
        : week.length ? 'nie ma go w zapisanych składach tego tygodnia — wstaw go albo dodaj sparing przed piątkiem'
        : 'brak meczu w tym tygodniu — rozważ sparing (mecz towarzyski) przed piątkiem';
    }
    rows.push({ player: p, slot: trainedIn?.slot ?? best.slot, status, core: core.has(p.id), match: trainedIn?.match ?? null, hint });
  }
  const order = { missing: 0, injured: 1, ok: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || Number(b.core) - Number(a.core));
  return { from: prev, to: next, matches: week, unsaved, rows };
}

// ---------------- prognoza a rzeczywistość ----------------

const SECTOR_KEYS = ['midfield', 'defRight', 'defCentral', 'defLeft', 'attRight', 'attCentral', 'attLeft'];

// Średni stosunek ocen z raportu do prognozy Gaffera, per sektor (mecze z zapisanym składem i wpisanymi ocenami).
export function calibration(matches = [], lineups = {}) {
  const sums = Object.fromEntries(SECTOR_KEYS.map((k) => [k, []]));
  const used = [];
  for (const m of matches) {
    const pred = lineups[matchId(m)]?.predicted;
    if (!pred || !m.ours) continue;
    let any = false;
    for (const k of SECTOR_KEYS) {
      if (pred[k] > 0 && m.ours[k] > 0) { sums[k].push(m.ours[k] / pred[k]); any = true; }
    }
    if (any) used.push(m);
  }
  const factor = Object.fromEntries(SECTOR_KEYS.map((k) => {
    const v = sums[k];
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 1;
    return [k, Math.min(1.3, Math.max(0.7, avg))];
  }));
  return { n: used.length, factor, matches: used };
}

export function applyCalibration(ratings, cal, min = 2) {
  if (!cal || cal.n < min) return ratings;
  return Object.fromEntries(Object.entries(ratings).map(([k, v]) => [k, cal.factor[k] ? v * cal.factor[k] : v]));
}

// ---------------- transfery ----------------

export function transferSummary(transfers = []) {
  const buys = transfers.filter((t) => t.type === 'buy');
  const sells = transfers.filter((t) => t.type === 'sell');
  const sum = (a) => a.reduce((s, t) => s + (t.price || 0), 0);
  return { spent: sum(buys), earned: sum(sells), balance: sum(sells) - sum(buys), buys: buys.length, sells: sells.length, unknown: transfers.filter((t) => t.price == null).length };
}

// Wartość kadry w czasie: suma TSI i pensji z każdej migawki historii.
export function squadValueSeries(history = []) {
  return history.map((h) => ({ at: h.at, tsi: h.players.reduce((a, p) => a + (p.tsi || 0), 0), wages: h.players.reduce((a, p) => a + (p.salary || 0), 0), n: h.players.length }));
}

// ---------------- skład treningowy (gdy mecz i tak jest nie do wygrania) ----------------

// Najsilniejsza XI zostaje tylko na pozycjach, których obecny trening nie obejmuje (np. bramka i obrona przy
// treningu podań). Trenowane pozycje dostają najlepsi z pozostałych — oni zbiorą minuty na tygodniowy trening.
export function rotationLineup(players, { formation = 'auto', opts = {}, trainingType } = {}) {
  const strong = pickLineup(players, { formation, opts });
  if (!strong) return null;
  const trained = strong.slots.map((s, i) => (coverageFor(s, trainingType) !== 'none' ? i : -1)).filter((i) => i >= 0);
  if (!trained.length) return null;
  const rested = trained.map((i) => strong.result.slots[i].player).filter(Boolean);
  const out = new Set(rested.map((p) => p.id));
  const locks = {};
  strong.slots.forEach((_, i) => { const p = strong.result.slots[i].player; if (!trained.includes(i) && p) locks[i] = p.id; });
  const lu = pickLineup(players.filter((p) => !out.has(p.id)), { formation: strong.name, locks, opts });
  if (!lu) return null;
  const getting = trained.map((i) => lu.result.slots[i].player).filter(Boolean);
  return { ...lu, strong, rested, getting };
}

// ---------------- rynek: kogo szukać ----------------

// Najsłabsze pozycje najlepszej XI i gotowe kryteria do wyszukiwarki transferów HT.
export function searchAdvice(lineup, { budget = null, n = 2 } = {}) {
  if (!lineup) return [];
  const bySlot = new Map();
  for (const s of lineup.result.slots) {
    if (!s.player) continue;
    const cur = bySlot.get(s.slot);
    if (!cur || s.score < cur.score) bySlot.set(s.slot, s);
  }
  const avg = lineup.result.slots.reduce((a, s) => a + (s.score || 0), 0) / lineup.result.slots.length;
  return [...bySlot.values()]
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map((s) => {
      const w = Object.entries(WEIGHTS[s.slot] ?? {}).sort((a, b) => b[1] - a[1]);
      const [main, second] = [w[0]?.[0], w[1]?.[0]];
      const p = s.player;
      return {
        slot: s.slot, player: p, score: s.score, gap: avg - s.score,
        criteria: {
          [main]: Math.max(1, Math.floor(p[main] ?? 0) + 2),
          ...(second ? { [second]: Math.max(1, Math.floor(p[second] ?? 0)) } : {}),
          ageMax: 27,
          priceMax: budget != null ? Math.max(0, Math.floor(budget / 10000) * 10000) : null,
        },
      };
    });
}

// ---------------- baza cen ----------------

// Szacunkowa cena z podobnych ofert. Najpierw po TSI (wiek ±2, TSI 0,6–1,6×: mediana ceny za 1 TSI × TSI),
// a gdy ofert z TSI jest za mało (lista wyników wyszukiwania nie pokazuje TSI) — po najlepszej umiejętności (±1) i wieku.
const topSkill = (x) => Math.max(...SKILLS.map(([k]) => x[k] ?? 0));
const median = (a) => { const r = [...a].sort((x, y) => x - y); return r.length % 2 ? r[(r.length - 1) / 2] : (r[r.length / 2 - 1] + r[r.length / 2]) / 2; };
export function priceEstimate(entries, p, { min = 3 } = {}) {
  if (!p) return null;
  const age = p.ageYears ?? p.age;
  const near = (e) => e.price > 0 && Math.abs((e.age ?? age) - age) <= 2;
  if (p.tsi) {
    const like = entries.filter((e) => near(e) && e.tsi > 0 && e.tsi >= p.tsi * 0.6 && e.tsi <= p.tsi * 1.6);
    if (like.length >= min) {
      const r = like.map((e) => e.price / e.tsi).sort((a, b) => a - b);
      return { value: Math.round((median(r) * p.tsi) / 10000) * 10000, low: Math.round(r[0] * p.tsi), high: Math.round(r.at(-1) * p.tsi), n: like.length, mode: 'tsi' };
    }
  }
  const top = topSkill(p);
  const like = entries.filter((e) => near(e) && SKILLS.some(([k]) => e[k] != null) && Math.abs(topSkill(e) - top) <= 1);
  if (like.length < min) return { value: null, n: like.length };
  const prices = like.map((e) => e.price).sort((a, b) => a - b);
  return { value: Math.round(median(prices) / 10000) * 10000, low: prices[0], high: prices.at(-1), n: like.length, mode: 'skill' };
}

// ---------------- cele treningowe ----------------

export function typeForSkill(skill) {
  return Object.keys(TRAINING_TYPES).find((t) => PRIMARY_TRAINED_SKILL[t] === skill && TRAINING_TYPES[t].full.length) ?? null;
}

// Ile tygodni treningu potrzeba do celu i czy zdąży przed terminem (przy pełnym meczu na trenowanej pozycji co tydzień).
export function goalPlan(p, goal, cfg, now = new Date()) {
  const type = typeForSkill(goal.skill);
  if (!type) return { type: null, weeks: null, ok: false };
  let weeks = null;
  if ((p[goal.skill] ?? 0) >= goal.target) weeks = 0;
  else for (let w = 1; w <= 104; w++) { const v = projectSkillAfter(p, { ...cfg, type, coverage: 'full' }, w); if (v != null && v >= goal.target) { weeks = w; break; } }
  const left = goal.by ? Math.floor((new Date(goal.by) - now) / (7 * DAY)) : null;
  const positions = TRAINING_TYPES[type].full;
  return { type, weeks, left, ok: weeks != null && (left == null || weeks <= left), active: cfg.type === type, positions };
}

// ---------------- akademia: kto może awansować ----------------

// Dni do możliwego awansu liczone od dnia eksportu CSV (wartość z HT starzeje się z każdym dniem).
export function promoDays(p, fetchedAt, now = new Date()) {
  if (p.canBePromotedInDays == null) return null;
  const passed = fetchedAt ? Math.floor((now - new Date(fetchedAt)) / DAY) : 0;
  return Math.max(0, p.canBePromotedInDays - Math.max(0, passed));
}

export function youthPromotionAlerts(youth = [], verdicts = [], { fetchedAt = null, now = new Date() } = {}) {
  const v = new Map(verdicts.map((x) => [x.player.id, x.verdict]));
  return youth
    .filter((p) => v.get(p.id) === 'promote' || v.get(p.id) === 'develop')
    .map((p) => ({ player: p, verdict: v.get(p.id), days: promoDays(p, fetchedAt, now) }))
    .filter((x) => x.days != null && x.days <= 7);
}
