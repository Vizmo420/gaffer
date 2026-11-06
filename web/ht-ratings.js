// SPDX-License-Identifier: LGPL-3.0-or-later
//
// Przewidywanie ocen meczowych Hattricka i wyniku meczu.
//
// Port do JavaScriptu fragmentów Hattrick Organizer (https://github.com/ho-dev/HattrickOrganizer):
//   core/rating/RatingPredictionModel.java  — formuła Schuma
//     Σ [ (S + Eff(L)) * K(F) * C * K(P) + Eff(Exp) ]  (© Schum, forum Hattricka t=17404127)
//   core/prediction/engine/BaseActionGenerator.java — prosty silnik akcji
// © HO! developers, licencja GNU LGPL v3. Ten plik pozostaje na LGPL-3.0 (reszta Gaffera: MIT).
//
// Uproszczenia względem HO: wszyscy zawodnicy grają „normalnie” (bez zachowań ofensywnych itd.),
// brak krycia indywidualnego i zmian w trakcie meczu, umiejętności bez podpoziomów (domyślnie
// zakładamy środek poziomu, +0,5). Wynik to szacunek społeczności, nie oficjalny silnik HT.

// ---------- skala ----------
const SKILL_SUB = 0.5; // nieznany podpoziom: środek poziomu
const skillRating = (s) => Math.max(0, s - 1);

export const LEVEL_PL = [
  'beznadziejny', 'fatalny', 'nędzny', 'kiepski', 'słaby', 'przeciętny', 'zadowalający', 'solidny',
  'znakomity', 'fantastyczny', 'olśniewający', 'błyskotliwy', 'mistrzowski', 'światowej klasy',
  'nadprzyrodzony', 'tytaniczny', 'nieziemski', 'mityczny', 'magiczny', 'utopijny', 'boski',
];
const SUB_PL = ['min.', 'niski', 'wysoki', 'maks.'];

// 3.5 -> „kiepski – wysoki” (tak jak w raporcie meczowym HT)
export function ratingLabel(r) {
  const q = Math.round(r * 4) / 4;
  const lvl = Math.max(0, Math.min(20, Math.floor(q)));
  const sub = Math.round((q - Math.floor(q)) * 4) % 4;
  return `${LEVEL_PL[lvl]} – ${SUB_PL[sub]}`;
}

// ---------- pozycje ----------
// Sektor ustawienia: Goal, CentralDefence, Back, InnerMidfield, Wing, Forward
const SECTOR_OF = { GK: 'Goal', CD: 'CentralDefence', WB: 'Back', IM: 'InnerMidfield', WI: 'Wing', FW: 'Forward' };

// Gaffer zapisuje formację jako listę slotów; strony nadajemy kolejnością w obrębie typu.
export function assignSides(slotTypes) {
  const byType = {};
  slotTypes.forEach((t, i) => (byType[t] ||= []).push(i));
  const side = new Array(slotTypes.length);
  for (const idx of Object.values(byType)) {
    if (idx.length === 1) side[idx[0]] = 'M';
    else if (idx.length === 2) [side[idx[0]], side[idx[1]]] = ['L', 'R'];
    else idx.forEach((i, k) => (side[i] = k === 0 ? 'L' : k === idx.length - 1 ? 'R' : 'M'));
  }
  return side;
}

// ---------- współczynniki wkładu (HO initRatingContributionParameterMap, zachowanie NORMAL) ----------
// [skill, sektor ustawienia, ograniczenie strony, współczynnik]
// strona: NONE = każda, THIS = tylko ta sama strona, MIDDLE = tylko środek, OPP = przeciwna strona
const CONTRIB = {
  SIDE_DEFENCE: [
    ['keeper', 'Goal', 'NONE', 0.61], ['defending', 'Goal', 'NONE', 0.25],
    ['defending', 'CentralDefence', 'THIS', 0.52], ['defending', 'CentralDefence', 'MIDDLE', 0.26],
    ['defending', 'Back', 'THIS', 0.92],
    ['defending', 'InnerMidfield', 'THIS', 0.19], ['defending', 'InnerMidfield', 'MIDDLE', 0.095],
    ['defending', 'Wing', 'THIS', 0.35],
  ],
  CENTRAL_DEFENCE: [
    ['keeper', 'Goal', 'NONE', 0.87], ['defending', 'Goal', 'NONE', 0.35],
    ['defending', 'CentralDefence', 'NONE', 1.0], ['defending', 'Back', 'NONE', 0.38],
    ['defending', 'InnerMidfield', 'NONE', 0.4], ['defending', 'Wing', 'NONE', 0.2],
  ],
  MIDFIELD: [
    ['playmaking', 'CentralDefence', 'NONE', 0.25], ['playmaking', 'Back', 'NONE', 0.15],
    ['playmaking', 'InnerMidfield', 'NONE', 1.0], ['playmaking', 'Wing', 'NONE', 0.45],
    ['playmaking', 'Forward', 'NONE', 0.25],
  ],
  CENTRAL_ATTACK: [
    ['passing', 'InnerMidfield', 'NONE', 0.33], ['passing', 'Wing', 'NONE', 0.11], ['passing', 'Forward', 'NONE', 0.33],
    ['scoring', 'InnerMidfield', 'NONE', 0.22], ['scoring', 'Forward', 'NONE', 1.0],
  ],
  SIDE_ATTACK: [
    ['passing', 'InnerMidfield', 'MIDDLE', 0.13], ['passing', 'Forward', 'NONE', 0.14],
    ['passing', 'InnerMidfield', 'THIS', 0.26], ['passing', 'Wing', 'THIS', 0.26],
    ['winger', 'Back', 'THIS', 0.59], ['winger', 'Wing', 'THIS', 0.86], ['winger', 'Forward', 'NONE', 0.24],
    ['scoring', 'Forward', 'NONE', 0.27],
  ],
};

export const SECTORS = ['defLeft', 'defCentral', 'defRight', 'midfield', 'attLeft', 'attCentral', 'attRight'];
const SECTOR_PARAMS = {
  defLeft: ['SIDE_DEFENCE', 'L'], defCentral: ['CENTRAL_DEFENCE', 'M'], defRight: ['SIDE_DEFENCE', 'R'],
  midfield: ['MIDFIELD', 'M'], attLeft: ['SIDE_ATTACK', 'L'], attCentral: ['CENTRAL_ATTACK', 'M'], attRight: ['SIDE_ATTACK', 'R'],
};
const SCALE = { midfield: 0.312, defLeft: 0.834, defRight: 0.834, defCentral: 0.501, attCentral: 0.513, attLeft: 0.615, attRight: 0.615 };
const EXP_K = { defLeft: 0.345, defRight: 0.345, defCentral: 0.48, midfield: 0.73, attLeft: 0.375, attRight: 0.375, attCentral: 0.45 };
const OVERCROWD = { CentralDefence: { 2: 0.964, 3: 0.9 }, InnerMidfield: { 2: 0.935, 3: 0.825 }, Forward: { 2: 0.945, 3: 0.865 } };

function sideAllowed(restriction, playerSide, sectorSide) {
  if (restriction === 'NONE') return true;
  if (restriction === 'MIDDLE') return playerSide === 'M';
  if (restriction === 'THIS') return playerSide === sectorSide;
  if (restriction === 'OPP') return (sectorSide === 'L' && playerSide === 'R') || (sectorSide === 'R' && playerSide === 'L');
  return false;
}

// ---------- czynniki zawodnika ----------
const formFactor = (p) => 0.378 * Math.sqrt(Math.min(7, skillRating(p.form ?? 6)));
const loyaltyBonus = (p) => (p.motherClubBonus ? 1.5 : skillRating(p.loyalty ?? 1) / 19);
const strength = (p, skill) => (skillRating((p[skill] ?? 0) + SKILL_SUB) + loyaltyBonus(p)) * formFactor(p);

function experienceEff(p, sector) {
  const e = skillRating(p.experience ?? 1);
  const k = -0.00000725 * e ** 4 + 0.0005 * e ** 3 - 0.01336 * e ** 2 + 0.176 * e;
  return k * EXP_K[sector];
}

// Średni współczynnik kondycji w 90 minutach (HO calcStamina, start w 1. minucie, bez pressingu)
function staminaAvg(stamina) {
  const s = skillRating(stamina ?? 6);
  let r0, delta;
  if (s < 7) {
    r0 = 102 + (23 / 7) * s;
    delta = (27 / 70) * s - 5.95;
  } else {
    r0 = 102 + 23 + ((s - 7) * 100) / 7;
    delta = -3.25;
  }
  let sum = 0, n = 0;
  for (let minute = 0; minute <= 90; minute += 5) {
    let r = r0 + (Math.min(45, minute) * delta) / 5;
    if (minute >= 45) {
      r = Math.min(r0, r + 120.75 - 102);
      r += ((Math.min(90, minute) - 45) * delta) / 5;
    }
    sum += Math.min(1, r / 100);
    n++;
  }
  return sum / n;
}

function weatherFactor(p, weather) {
  const sp = p.specialty; // 1 techniczny, 2 szybki, 3 silny
  if (sp === 1) return weather === 'rain' ? 0.95 : weather === 'sun' ? 1.05 : 1;
  if (sp === 3) return weather === 'rain' ? 1.05 : weather === 'sun' ? 0.95 : 1;
  if (sp === 2) return weather === 'rain' || weather === 'sun' ? 0.95 : 1;
  return 1;
}

// ---------- czynniki drużyny ----------
// nastrój HT 0–10 (spokojni = 5), pewność siebie 0–9 (niemożliwie przesadzona = 9)
const spiritFactor = (spirit) => 0.1 + 0.425 * Math.sqrt(spirit + 0.5);
const confidenceFactor = (conf) => 0.8 + 0.05 * (conf + 0.5);
const LOCATION = { home: 1.19892, away: 1, derby: 1.11493 };
const ATTITUDE = { normal: 1, pic: 0.83945, mots: 1.1149 };

export const TACTICS = {
  normal: 'Normalna',
  aim: 'Atak środkiem',
  aow: 'Atak skrzydłami',
  creative: 'Gra kreatywna',
  counter: 'Kontratak',
  longshots: 'Strzały z dystansu',
};

function sectorFactor(sector, ctx) {
  const t = ctx.tactic;
  let r = 1;
  if (sector === 'midfield') {
    r *= ATTITUDE[ctx.attitude] ?? 1;
    r *= LOCATION[ctx.location] ?? 1;
    if (t === 'counter') r *= 0.93;
    if (t === 'longshots') r *= 0.96;
    r *= spiritFactor(ctx.spirit);
  } else if (sector === 'defLeft' || sector === 'defRight') {
    r *= 1.02; // trener neutralny
    if (t === 'aim') r *= 0.85;
    if (t === 'creative') r *= 0.93;
  } else if (sector === 'defCentral') {
    r *= 1.02;
    if (t === 'aow') r *= 0.85;
    if (t === 'creative') r *= 0.93;
  } else {
    r *= 1.02;
    if (t === 'longshots') r *= 0.96;
    r *= confidenceFactor(ctx.confidence);
  }
  return r;
}

// lineup: [{ slot: 'CD', player }, …] w kolejności formacji
export function predictRatings(lineup, ctx = {}) {
  ctx = { spirit: 5, confidence: 5, location: 'home', attitude: 'normal', tactic: 'normal', weather: 'cloud', ...ctx };
  const sides = assignSides(lineup.map((s) => s.slot));
  const count = {};
  for (const s of lineup) if (s.player) count[SECTOR_OF[s.slot]] = (count[SECTOR_OF[s.slot]] || 0) + 1;
  const out = {};
  for (const sector of SECTORS) {
    const [paramSet, sectorSide] = SECTOR_PARAMS[sector];
    let sum = 0;
    lineup.forEach((s, i) => {
      const p = s.player;
      if (!p) return;
      const ls = SECTOR_OF[s.slot];
      let c = 0;
      for (const [skill, sec, restr, k] of CONTRIB[paramSet]) {
        if (sec === ls && sideAllowed(restr, sides[i], sectorSide)) c += strength(p, skill) * k;
      }
      if (c <= 0) return;
      c *= OVERCROWD[ls]?.[count[ls]] ?? 1;
      c += experienceEff(p, sector);
      c *= weatherFactor(p, ctx.weather);
      c *= staminaAvg(p.stamina);
      sum += c;
    });
    sum *= sectorFactor(sector, ctx);
    out[sector] = sum > 0 ? (sum * SCALE[sector]) ** 1.2 / 4 + 1 : 0.75;
  }
  return out;
}

export const hatStats = (r) =>
  4 * (3 * r.midfield + r.defLeft + r.defCentral + r.defRight + r.attLeft + r.attCentral + r.attRight);

// ---------- symulacja meczu (HO BaseActionGenerator, uproszczona) ----------
function effectiveness(value) {
  let x = value * 100;
  const low = x < 50;
  if (low) x = 100 - x;
  const v = -500000 / x ** 2 + 10000 / x + 50;
  return low ? 100 - v : v;
}
const ratio = (a, b) => a / (a + b);

// Skuteczność akcji w HO przy równych siłach to 50%, czyli ~5 goli na mecz; w HT pada średnio ~3.
// Kalibracja Gaffera (nie z HO): mnożnik 0,6 → ok. 30% skuteczności przy równych ocenach.
const CONVERSION = 0.6;
const ACTIONS_PER_MATCH = 10; // HO ActionGenerator.simulate(): 10 akcji dzielonych wg posiadania

function attackPlan(us, them, tactic, tacticLevel) {
  return {
    middleShare: tactic === 'aim' ? 40 + tacticLevel * 3 : tactic === 'aow' ? 40 - tacticLevel * 1.5 : 40,
    // nasz atak w danym sektorze kontra ich obrona po przeciwnej stronie boiska
    pL: (CONVERSION * effectiveness(ratio(us.attLeft, them.defRight))) / 100,
    pM: (CONVERSION * effectiveness(ratio(us.attCentral, them.defCentral))) / 100,
    pR: (CONVERSION * effectiveness(ratio(us.attRight, them.defLeft))) / 100,
  };
}

function scored(plan, rnd) {
  const area = rnd() * 100;
  const side = (100 - plan.middleShare) / 2;
  const p = area < plan.middleShare ? plan.pM : area < plan.middleShare + side ? plan.pL : plan.pR;
  return rnd() < p;
}

// Prosty generator z ziarnem, żeby ten sam skład dawał te same procenty.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateMatch(us, them, { tactic = 'normal', tacticLevel = 5, oppTactic = 'normal', oppTacticLevel = 5, runs = 10000, seed = 7 } = {}) {
  const possession = ratio(us.midfield, them.midfield);
  const ourShare = effectiveness(possession) / 100; // udział w akcjach
  const a = attackPlan(us, them, tactic, tacticLevel);
  const b = attackPlan(them, us, oppTactic, oppTacticLevel);
  const rnd = mulberry32(seed);
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  const scores = new Map();
  for (let i = 0; i < runs; i++) {
    let x = 0, y = 0;
    for (let k = 0; k < ACTIONS_PER_MATCH; k++) {
      if (rnd() < ourShare) x += scored(a, rnd);
      else y += scored(b, rnd);
    }
    gf += x; ga += y;
    if (x > y) w++; else if (x === y) d++; else l++;
    const key = `${x}:${y}`;
    scores.set(key, (scores.get(key) || 0) + 1);
  }
  const top = [...scores.entries()].sort((p, q) => q[1] - p[1]).slice(0, 5).map(([sc, n]) => ({ score: sc, pct: (100 * n) / runs }));
  return {
    win: (100 * w) / runs, draw: (100 * d) / runs, loss: (100 * l) / runs,
    goalsFor: gf / runs, goalsAgainst: ga / runs, possession: 100 * possession, chancesShare: 100 * ourShare, topScores: top,
  };
}

// Rywal gra u siebie w raporcie, a u nas na wyjeździe: zdejmij/dodaj premię za dom z pomocy.
export function relocateMidfield(ratings, fromLocation, toLocation) {
  const f = (LOCATION[toLocation] ?? 1) / (LOCATION[fromLocation] ?? 1);
  // ocena = (suma × skala)^1,2 / 4 + 1, a premia za dom mnoży sumę → cofamy potęgę
  const m = ratings.midfield;
  if (!(m > 1)) return { ...ratings };
  const base = ((m - 1) * 4) ** (1 / 1.2);
  return { ...ratings, midfield: (base * f) ** 1.2 / 4 + 1 };
}
