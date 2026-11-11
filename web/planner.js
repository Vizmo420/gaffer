// Narzędzia planowania: prognoza finansów i ocena kandydatów z rynku.
// Czyste funkcje (bez DOM), testowane w test/planner.test.mjs.

import { FORMATIONS, bestLineup } from './optimizer.js';
import { predictRatings, hatStats } from './ht-ratings.js';

// Po transferze HT podnosi pensję o 20% i zeruje lojalność (potwierdzone na Zíсze i Balovie).
export const TRANSFER_WAGE_FACTOR = 1.2;

// ---------- finanse ----------
// opts: { cash, wages, sponsors, stadium, staff, youth, homeIncome, weeks, homeEvery, extraWeekly }
// Tydzień bez meczu u siebie: tylko sponsorzy i drobne bilety. Mecz u siebie co `homeEvery` tygodni.
export function forecastCash(o) {
  const {
    cash, wages, sponsors = 368000, stadium = 79000, staff = 301120, youth = 80000,
    homeIncome = 1100000, awayTickets = 56000, weeks = 16, homeEvery = 2, extraWeekly = 0, oneOff = 0,
  } = o;
  const fixed = wages + stadium + staff + youth + extraWeekly;
  let c = cash - oneOff;
  const rows = [];
  for (let w = 1; w <= weeks; w++) {
    const home = w % homeEvery === 0;
    const income = sponsors + (home ? homeIncome : awayTickets);
    c += income - fixed;
    rows.push({ week: w, home, net: income - fixed, cash: Math.round(c) });
  }
  const min = rows.reduce((a, r) => (r.cash < a.cash ? r : a), rows[0]);
  return {
    weeklyFixed: fixed,
    quietNet: sponsors + awayTickets - fixed,
    homeNet: sponsors + homeIncome - fixed,
    rows,
    minCash: min.cash,
    minWeek: min.week,
    endCash: rows[rows.length - 1].cash,
  };
}

// Ile można wydać jednorazowo, żeby gotówka nigdy nie spadła poniżej `floor`.
export function safeSpend(o, floor = 500000) {
  const base = forecastCash({ ...o, oneOff: 0 });
  return Math.max(0, Math.round(base.minCash - floor));
}

// ---------- ocena kandydata ----------
const BASE_CAND = {
  id: 9e9, firstName: 'Kandydat', lastName: '', age: 25, ageYears: 25.1, form: 7, stamina: 7, experience: 4, leadership: 3,
  loyalty: 2, motherClubBonus: false, keeper: 1, defending: 3, playmaking: 3, winger: 3, passing: 3, scoring: 3, setPieces: 3,
  tsi: 0, salary: 0, specialty: 0, injuryLevel: -1, yellowCards: 0, recentRatings: [], transferListed: false,
};

export function makeCandidate(c) {
  const p = { ...BASE_CAND, ...c };
  p.lastName = c.name || c.lastName || 'Kandydat';
  p.ageYears = c.age ?? p.age;
  p.salary = Math.round((c.salary || 0) * TRANSFER_WAGE_FACTOR); // pensja po transferze
  return p;
}

const defaultCtx = { spirit: 5, confidence: 5, location: 'home', tactic: 'normal' };

function evalXI(players, formation, ctx) {
  const res = bestLineup(players, FORMATIONS[formation], {}, {});
  if (!res) return null;
  const lineup = res.slots.map((s) => ({ slot: s.slot, player: s.player }));
  const r = predictRatings(lineup, ctx);
  return { total: res.total, hs: hatStats(r), res };
}

// Zysk dla składu po dodaniu kandydata + koszt całkowity.
export function scoreCandidate(squad, cand, { formation = '3-5-2', price = 0, ctx = {} } = {}) {
  const c = { ...defaultCtx, ...ctx };
  const p = makeCandidate(cand);
  const before = evalXI(squad, formation, c);
  const after = evalXI([...squad, p], formation, c);
  if (!before || !after) return null;
  const dSigma = after.total - before.total;
  const dHs = after.hs - before.hs;
  const inXI = after.res.slots.some((s) => s.player?.id === p.id);
  // koszt na rok = cena + 52 tyg. pensji; „punkt Σ” bez zysku daje nieskończony koszt
  const yearCost = price + p.salary * 52;
  return {
    inXI, dSigma, dHs, salary: p.salary, yearCost,
    costPerSigma: dSigma > 0.05 ? Math.round(yearCost / dSigma) : null,
    slot: inXI ? after.res.slots.find((s) => s.player?.id === p.id).slot : null,
  };
}
