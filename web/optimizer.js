// Logika optymalizatora składu — czyste funkcje, bez DOM. Import w app.js.
//
// Dwa filary:
//  1. Funkcja oceny — dla każdego typu pozycji ważona suma umiejętności.
//     Wagi to aproksymacje społeczności (Hattrick nie publikuje wzoru silnika
//     meczowego) — z czasem warto dostroić je pod realne wyniki meczów.
//  2. Przydział — problem przypisania (assignment problem). DP po masce bitowej
//     zajętych slotów: dla <=11 slotów szybkie i dowodliwie optymalne (nie heurystyka).

// ------------------------- pozycje i formacje -------------------------

// GK bramkarz | CD środkowy obrońca | WB boczny obrońca
// WI skrzydłowy | IM środkowy pomocnik | FW napastnik
export const POSITION_LABEL = {
  GK: 'Bramkarz',
  CD: 'Śr. obrońca',
  WB: 'Boczny obr.',
  WI: 'Skrzydłowy',
  IM: 'Śr. pomocnik',
  FW: 'Napastnik',
};

// Każda formacja = konkretna lista 11 slotów.
export const FORMATIONS = {
  '4-4-2': ['GK', 'WB', 'CD', 'CD', 'WB', 'WI', 'IM', 'IM', 'WI', 'FW', 'FW'],
  '5-3-2': ['GK', 'WB', 'CD', 'CD', 'CD', 'WB', 'IM', 'IM', 'IM', 'FW', 'FW'],
  '3-5-2': ['GK', 'CD', 'CD', 'CD', 'WI', 'IM', 'IM', 'IM', 'WI', 'FW', 'FW'],
  '4-5-1': ['GK', 'WB', 'CD', 'CD', 'WB', 'WI', 'IM', 'IM', 'IM', 'WI', 'FW'],
  '4-3-3': ['GK', 'WB', 'CD', 'CD', 'WB', 'IM', 'IM', 'IM', 'WI', 'FW', 'WI'],
};

// ------------------------- wagi oceny -------------------------

// Suma wag ~1.0 na pozycję. DOSTRÓJ pod własne mecze — to punkt wyjścia.
// Można zmieniać w UI (panel „Wagi pozycji"); domyślne trzymamy w DEFAULT_WEIGHTS.
export const DEFAULT_WEIGHTS = Object.freeze({
  GK: { keeper: 0.88, defending: 0.12 },
  CD: { defending: 0.9, playmaking: 0.1 },
  WB: { defending: 0.58, winger: 0.28, playmaking: 0.14 },
  WI: { winger: 0.48, passing: 0.2, playmaking: 0.16, defending: 0.16 },
  IM: { playmaking: 0.58, passing: 0.26, defending: 0.1, scoring: 0.06 },
  FW: { scoring: 0.6, winger: 0.16, passing: 0.14, playmaking: 0.1 },
});

export let WEIGHTS = structuredClone(DEFAULT_WEIGHTS);

export function setWeights(next) {
  WEIGHTS = structuredClone(next);
}
export function resetWeights() {
  WEIGHTS = structuredClone(DEFAULT_WEIGHTS);
  return WEIGHTS;
}

// ------------------------- trening -------------------------

// Mapowanie typu treningu klubu na pozycje na boisku — z tabeli 11 typów
// treningu Hattricka (wiki.hattrick.org/wiki/Training). "full" = trenuje w pełni,
// "partial" = częściowo.
export const TRAINING_TYPES = {
  'Kondycja': { full: [], partial: [] }, // trenuje wszystkich, bez wpływu na wybór pozycji
  'Bramkarze': { full: ['GK'], partial: [] },
  'Obrona': { full: ['CD', 'WB'], partial: [] },
  'Rozgrywanie': { full: ['IM'], partial: ['WI'] },
  'Skrzydła': { full: ['WI'], partial: ['WB'] },
  'Podania': { full: ['IM', 'FW'], partial: [] },
  'Strzały': { full: ['FW'], partial: [] },
  'Dośrodkowania': { full: ['WI', 'WB'], partial: [] },
  'Stałe fragmenty': { full: [], partial: ['GK', 'CD', 'WB', 'WI', 'IM', 'FW'] },
};

// ------------------------- specjalności -------------------------

// Kody z pola Specialty (CHPP players / youthplayers).
export const SPECIALTY = {
  0: '—',
  1: 'Techniczny',
  2: 'Szybki',
  3: 'Waleczny',
  4: 'Nieprzewidywalny',
  5: 'Głowa',
  6: 'Regenerujący',
  8: 'Wsparcie',
};

export const specialtyName = (code) => SPECIALTY[code] ?? '—';

// ------------------------- ocena zawodnika na pozycji -------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Wartość umiejętności do oceny. Obsługuje:
//  - -1 / brak = nieujawnione (młodzież) -> 0
//  - tryb potencjału (młodzież) -> bierze *Max, a gdy maks nieznany, bieżącą.
export function skillVal(pl, key, opts = {}) {
  if (opts.usePotential) {
    const mx = pl[key + 'Max'];
    if (mx != null && mx >= 0) return mx;
  }
  const v = pl[key];
  return v != null && v >= 0 ? v : 0;
}

function popcount(n) {
  let c = 0;
  while (n) {
    n &= n - 1;
    c++;
  }
  return c;
}

/**
 * @param {object} pl   zawodnik (model z lib/hattrick.js mapPlayer / mapYouthPlayer)
 * @param {string} slot typ pozycji ('GK'|'CD'|...)
 * @param {object} opts {
 *   useLoyalty, allowInjured, training: {type, weight},
 *   mode: 'skill' | 'rating',   // 'rating' = optymalizuj wg ocen z meczów
 *   usePotential: bool,         // młodzież: licz wg maks. umiejętności
 *   youth: bool                 // młodzież: pomiń mnożniki formy/kondycji
 * }
 * @returns {number} ocena; -Infinity gdy zawodnik nie wchodzi w grę
 */
export function ratePlayerForSlot(pl, slot, opts = {}) {
  if (!opts.allowInjured && pl.injuryLevel > 0) return -Infinity;

  // Tryb "wg ocen": kryterium to średnia ocena zawodnika (ręczna lub z meczów),
  // a nie ważona suma umiejętności. Pozycja nadal filtruje przez wagę skilli,
  // żeby nie wstawić napastnika na środek obrony tylko dlatego, że ma 6.0.
  if (opts.mode === 'rating') {
    const r = pl.avgRating ?? pl.manualRating ?? null;
    if (r == null) return -Infinity; // bez oceny nie da się użyć tego trybu
    const w = WEIGHTS[slot] || {};
    let fit = 0;
    for (const skill in w) fit += skillVal(pl, skill, opts) * w[skill];
    const fitFactor = 0.5 + 0.5 * clamp(fit / 12, 0, 1); // 0.5..1.0
    return r * fitFactor;
  }

  const w = WEIGHTS[slot] || {};
  let score = 0;
  for (const skill in w) score += skillVal(pl, skill, opts) * w[skill];

  if (!opts.youth) {
    // Forma: 1..8 -> mnożnik ~0.67..1.02
    score *= 0.62 + 0.05 * clamp(pl.form || 0, 0, 8);
    // Kondycja (łagodnie): 0..9 -> ~0.88..1.02
    score *= 0.88 + 0.015 * clamp(pl.stamina || 0, 0, 9);
    // Tryb „pod dogrywkę": kondycja waży dużo więcej — trzeba przetrwać 120 min.
    if (opts.extraTime) score *= 0.6 + 0.045 * clamp(pl.stamina || 0, 0, 9);
  }

  // Bonus lojalności / wychowanka klubu (zweryfikowane na wiki: do +1.0 / +0.5).
  if (opts.useLoyalty) {
    if (pl.loyalty != null) score += (clamp(pl.loyalty, 0, 20) / 20) * 1.0;
    if (pl.motherClubBonus || pl.motherClubManual) score += 0.5;
  }

  // Premia za granie na pozycji, która faktycznie trenuje danego zawodnika.
  const tr = opts.training;
  if (tr && tr.type && pl.trained) {
    const map = TRAINING_TYPES[tr.type] || { full: [], partial: [] };
    const wgt = tr.weight ?? 1;
    if (map.full.includes(slot)) score += wgt;
    else if (map.partial.includes(slot)) score += wgt * 0.5;
  }

  return score;
}

export function trainingEffect(pl, slot, trainingType) {
  const map = TRAINING_TYPES[trainingType] || { full: [], partial: [] };
  if (map.full.includes(slot)) return 'pełny';
  if (map.partial.includes(slot)) return 'częściowy';
  return 'brak';
}

// ------------------------- filtrowanie -------------------------

// 3 skumulowane żółte kartki = pauza na następny mecz (przybliżenie — CHPP daje
// tylko sumę Cards, bez info „2 w jednym meczu").
export function isSuspended(p) {
  return (p.yellowCards ?? 0) >= 3;
}

export function eligiblePlayers(players, opts = {}) {
  return players.filter((p) => {
    if (!opts.allowInjured && p.injuryLevel > 0) return false;
    if (!opts.allowSuspended && isSuspended(p)) return false;
    if (
      opts.maxWeeksIdle != null &&
      p.weeksSinceLastMatch != null &&
      p.weeksSinceLastMatch > opts.maxWeeksIdle
    ) {
      return false; // "pomiń nieaktywnych" — nieznane (null) zostawiamy
    }
    return true;
  });
}

// ------------------------- najlepszy skład dla formacji -------------------------

/**
 * DP: przetwarzamy zawodników po kolei, każdego można pominąć albo wstawić na
 * wolny slot. Stan = maska bitowa zajętych slotów. Na końcu maska musi być pełna.
 *
 * @param {object[]} players
 * @param {string[]} slots  lista typów pozycji (z FORMATIONS)
 * @param {object}  opts
 * @param {object}  locks   { slotIndex: playerId } — wymuszone przypisania
 * @returns {{ total:number, slots: Array<{slot,index,player,score}> } | null}
 */
export function bestLineup(players, slots, opts = {}, locks = {}) {
  const P = slots.length;
  const FULL = (1 << P) - 1;

  const rate = players.map((pl) => slots.map((s) => ratePlayerForSlot(pl, s, opts)));

  const lockSlotOf = new Map(); // playerId -> slotIndex
  for (const [si, pid] of Object.entries(locks)) lockSlotOf.set(Number(pid), Number(si));

  // dp: maska -> { score, assign: {slotIndex: playerIndex} }
  let dp = new Map([[0, { score: 0, assign: {} }]]);

  for (let pi = 0; pi < players.length; pi++) {
    const ndp = new Map();
    const consider = (mask, state) => {
      const cur = ndp.get(mask);
      if (!cur || state.score > cur.score) ndp.set(mask, state);
    };
    const forcedSlot = lockSlotOf.has(players[pi].id) ? lockSlotOf.get(players[pi].id) : null;

    for (const [mask, state] of dp) {
      // pominięcie zawodnika (niedozwolone, jeśli jest wymuszony na slot)
      if (forcedSlot == null) consider(mask, state);

      for (let si = 0; si < P; si++) {
        if (mask & (1 << si)) continue;
        if (forcedSlot != null && forcedSlot !== si) continue; // ten gracz tylko na swój slot
        if (locks[si] != null && Number(locks[si]) !== players[pi].id) continue; // slot zarezerwowany dla kogoś innego
        const s = rate[pi][si];
        if (!isFinite(s)) continue;
        consider(mask | (1 << si), {
          score: state.score + s,
          assign: { ...state.assign, [si]: pi },
        });
      }
    }
    dp = ndp.size ? ndp : dp;
  }

  // Najlepszy pełny skład; a jeśli nie da się obsadzić wszystkich slotów
  // (mała pula / ostre filtry / Skład B), bierzemy stan z największą liczbą
  // obsadzonych slotów, a przy remisie — z wyższą sumą ocen.
  let best = dp.get(FULL);
  if (!best) {
    let bestKey = -1;
    for (const [mask, st] of dp) {
      const key = popcount(mask) * 1e6 + st.score;
      if (key > bestKey) {
        bestKey = key;
        best = st;
      }
    }
  }
  if (!best) return null;
  return {
    total: best.score,
    slots: slots.map((slot, index) => {
      const pIdx = best.assign[index];
      return {
        slot,
        index,
        player: players[pIdx] ?? null,
        score: pIdx != null ? rate[pIdx][index] : 0,
      };
    }),
  };
}

// ------------------------- automatyczny dobór formacji -------------------------

export function bestFormation(players, opts = {}, locks = {}) {
  let best = null;
  for (const [name, slots] of Object.entries(FORMATIONS)) {
    const result = bestLineup(players, slots, opts, locks);
    if (!result) continue;
    // Bias „vs przeciwnik": jeśli podano oceny sektorów rywala, premiuj formacje,
    // które lepiej go kontrują (nasza słabość nie naprzeciw ich siły, nasza
    // przewaga tam gdzie oni słabi).
    let adj = result.total;
    if (opts.opponent) {
      adj *= 1 + 0.06 * counterScore(sectorRatings(result.slots), opts.opponent);
    }
    if (!best || adj > best.adj) best = { name, slots, result, adj };
  }
  return best;
}

// Dodatnie = nasz układ dobrze kontruje rywala. Skala ~ -1..+1.
export function counterScore(mine, opp) {
  const norm = (o) => {
    const s = (o.def || 0) + (o.mid || 0) + (o.att || 0) || 1;
    return { def: (o.def || 0) / s, mid: (o.mid || 0) / s, att: (o.att || 0) / s };
  };
  const m = norm(mine);
  const o = norm(opp);
  // nasza obrona vs ich atak, nasz środek vs ich środek, nasz atak vs ich obrona
  return (m.def - o.att) + (m.mid - o.mid) * 0.8 + (m.att - o.def);
}

const MARK_POS = { FW: ['CD', 'WB'], WI: ['WB', 'WI'], IM: ['IM', 'CD'] };

// Kto najlepiej pokryje kluczowego zawodnika rywala na danej pozycji.
export function suggestManMarker(players, targetPos, opts = {}) {
  const slots = MARK_POS[targetPos] || ['CD'];
  return players
    .filter((p) => (opts.allowInjured || (p.injuryLevel ?? -1) <= 0))
    .map((p) => ({
      player: p,
      score: Math.max(...slots.map((s) => ratePlayerForSlot(p, s, { ...opts, training: null }))),
    }))
    .filter((x) => Number.isFinite(x.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

// Bonus lojalności/wychowanka w „punktach umiejętności" — do pokazania obok mapy.
export function loyaltyBonus(p) {
  let b = 0;
  if (p.loyalty != null) b += (clamp(p.loyalty, 0, 20) / 20) * 1.0;
  if (p.motherClubBonus || p.motherClubManual) b += 0.5;
  return Math.round(b * 100) / 100;
}

// Odwrotność: dana umiejętność -> pozycje na boisku, które ją trenują (z TRAINING_TYPES).
export function positionsTrainingSkill(skillKey) {
  for (const [type, prim] of Object.entries({
    keeper: 'Bramkarze', defending: 'Obrona', playmaking: 'Rozgrywanie',
    winger: 'Skrzydła', passing: 'Podania', scoring: 'Strzały', setPieces: 'Stałe fragmenty',
  })) {
    if (type === skillKey) {
      const map = TRAINING_TYPES[prim] || { full: [], partial: [] };
      return { full: map.full, partial: map.partial };
    }
  }
  return { full: [], partial: [] };
}

// ------------------------- kalibracja wag z własnych ocen -------------------------

const CAL_SKILLS = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces'];

// Ridge: (XᵀX + λI) w = Xᵀy + λ w₀   — rozwiązanie eliminacją Gaussa (n≤7).
function solveRidge(rows, ys, w0, lambda) {
  const n = w0.length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < n; a++) {
      b[a] += rows[i][a] * ys[i];
      for (let c = 0; c < n; c++) A[a][c] += rows[i][a] * rows[i][c];
    }
  }
  for (let a = 0; a < n; a++) {
    A[a][a] += lambda;
    b[a] += lambda * w0[a];
  }
  // eliminacja Gaussa z częściowym pivotem
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    if (Math.abs(A[col][col]) < 1e-9) return null;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r][col] / A[col][col];
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

/**
 * Dopasowuje wagi pozycji do TWOICH ocen meczowych (RatingStars + pozycja z RoleID).
 * Regularyzacja ciągnie w stronę wag domyślnych — mało próbek => zostają domyślne.
 * @returns {{ weights, sampleCounts, fitted:string[], skipped:string[] }}
 */
export function calibrateWeights(players, { lambda = 6, minSamples = 4, scaleRef = 1 } = {}) {
  const bySlot = {}; // slot -> { rows:[skillVec], ys:[stars] }
  for (const p of players) {
    for (const r of p.recentRatings || []) {
      if (!r.slot || r.stars == null) continue;
      (bySlot[r.slot] ??= { rows: [], ys: [] });
      bySlot[r.slot].rows.push(CAL_SKILLS.map((k) => p[k] || 0));
      bySlot[r.slot].ys.push(r.stars);
    }
  }
  const out = structuredClone(DEFAULT_WEIGHTS);
  const sampleCounts = {};
  const fitted = [];
  const skipped = [];
  for (const slot of Object.keys(DEFAULT_WEIGHTS)) {
    const d = bySlot[slot];
    sampleCounts[slot] = d?.ys.length ?? 0;
    if (!d || d.ys.length < minSamples) {
      skipped.push(slot);
      continue;
    }
    // domyślne wagi jako wektor CAL_SKILLS
    const w0 = CAL_SKILLS.map((k) => DEFAULT_WEIGHTS[slot][k] ?? 0);
    // przeskaluj oceny do rzędu wielkości ważonej sumy umiejętności
    const meanSkill = d.rows.reduce((s, row) => s + row.reduce((a, b) => a + b, 0) / row.length, 0) / d.rows.length;
    const meanY = d.ys.reduce((a, b) => a + b, 0) / d.ys.length || 1;
    const k = meanSkill && meanY ? meanSkill / meanY : 1;
    const ys = d.ys.map((y) => y * k);
    const sol = solveRidge(d.rows, ys, w0, lambda);
    if (!sol) {
      skipped.push(slot);
      continue;
    }
    const clamped = sol.map((v) => Math.max(0, v));
    const sum = clamped.reduce((a, b) => a + b, 0);
    const w0sum = w0.reduce((a, b) => a + b, 0) || 1;
    const norm = sum > 0 ? w0sum / sum : 1; // zachowaj skalę zbliżoną do domyślnej
    out[slot] = {};
    CAL_SKILLS.forEach((sk, i) => {
      const v = clamped[i] * norm;
      if (v > 0.01) out[slot][sk] = Math.round(v * 1000) / 1000;
    });
    fitted.push(slot);
  }
  return { weights: out, sampleCounts, fitted, skipped };
}

// ------------------------- „wyjaśnij ocenę" -------------------------

export function explainRating(pl, slot, opts = {}) {
  const w = WEIGHTS[slot] || {};
  const parts = [];
  let base = 0;
  for (const k in w) {
    const c = skillVal(pl, k, opts) * w[k];
    base += c;
    parts.push({ skill: k, value: skillVal(pl, k, opts), weight: w[k], contribution: c });
  }
  parts.sort((a, b) => b.contribution - a.contribution);
  const formMul = opts.youth ? 1 : 0.62 + 0.05 * clamp(pl.form || 0, 0, 8);
  const stamMul = opts.youth ? 1 : 0.88 + 0.015 * clamp(pl.stamina || 0, 0, 9);
  let bonus = 0;
  if (opts.useLoyalty) bonus += loyaltyBonus(pl);
  const total = base * formMul * stamMul + bonus;
  return { parts, base, formMul, stamMul, bonus, total };
}

// ------------------------- głębia kadry (leave-one-out) -------------------------

export function squadDepth(players, opts = {}) {
  const pool = eligiblePlayers(players, opts);
  const baseline = bestFormation(pool, opts);
  if (!baseline) return null;
  const xi = baseline.result.slots.map((s) => s.player).filter(Boolean);

  const keyPlayers = xi
    .map((pl) => {
      const without = bestFormation(pool.filter((x) => x.id !== pl.id), opts);
      const drop = without ? baseline.result.total - without.result.total : baseline.result.total;
      return { player: pl, drop: Math.round(drop * 100) / 100 };
    })
    .sort((a, b) => b.drop - a.drop);

  const perPos = ['GK', 'CD', 'WB', 'WI', 'IM', 'FW'].map((slot) => {
    const ranked = pool
      .map((p) => ({ p, s: ratePlayerForSlot(p, slot, { ...opts, training: null }) }))
      .filter((x) => Number.isFinite(x.s))
      .sort((a, b) => b.s - a.s);
    const first = ranked[0]?.s ?? 0;
    const second = ranked[1]?.s ?? 0;
    return {
      slot,
      best: ranked[0]?.p ?? null,
      backup: ranked[1]?.p ?? null,
      gap: Math.round((first - second) * 100) / 100,
      options: ranked.filter((x) => x.s > first * 0.75).length,
    };
  });

  return { total: baseline.result.total, formation: baseline.name, keyPlayers, perPos };
}

// ------------------------- bliskie decyzje (pasma pewności) -------------------------

export function closeCalls(pool, result, opts = {}, marginPct = 0.05) {
  const inXi = new Set(result.slots.map((s) => s.player?.id).filter(Boolean));
  return result.slots
    .filter((s) => s.player)
    .map((s) => {
      const alt = pool
        .filter((p) => !inXi.has(p.id))
        .map((p) => ({ p, sc: ratePlayerForSlot(p, s.slot, opts) }))
        .filter((x) => Number.isFinite(x.sc))
        .sort((a, b) => b.sc - a.sc)[0];
      if (!alt) return null;
      const margin = s.score - alt.sc;
      return margin <= Math.abs(s.score) * marginPct
        ? { slot: s.slot, index: s.index, player: s.player, score: s.score, alt: alt.p, altScore: alt.sc, margin: Math.round(margin * 100) / 100 }
        : null;
    })
    .filter(Boolean);
}

// ------------------------- karta oceny drużyny (A–F) -------------------------

function gradeFrom(value, bands) {
  const g = ['A', 'B', 'C', 'D', 'E', 'F'];
  for (let i = 0; i < bands.length; i++) if (value >= bands[i]) return g[i];
  return 'F';
}

export function squadGrades(ctx) {
  // ctx: { sectors, benchRatio, tsiPerWage, youthTop, ageBuckets, sectorsMax }
  const grades = {};
  if (ctx.sectors) {
    grades['Obrona'] = gradeFrom(ctx.sectors.def, [26, 21, 16, 12, 8]);
    grades['Pomoc'] = gradeFrom(ctx.sectors.mid, [22, 17, 13, 9, 6]);
    grades['Atak'] = gradeFrom(ctx.sectors.att, [22, 17, 13, 9, 6]);
  }
  if (ctx.benchRatio != null) grades['Ławka'] = gradeFrom(ctx.benchRatio, [0.9, 0.82, 0.72, 0.6, 0.45]);
  if (ctx.tsiPerWage != null) grades['Ekonomia'] = gradeFrom(ctx.tsiPerWage, [3.2, 2.6, 2.0, 1.5, 1.0]);
  if (ctx.youthTop != null) grades['Młodzież'] = gradeFrom(ctx.youthTop, [80, 62, 48, 36, 24]);
  if (ctx.ageScore != null) grades['Struktura wieku'] = gradeFrom(ctx.ageScore, [0.85, 0.7, 0.55, 0.4, 0.25]);

  const order = ['F', 'E', 'D', 'C', 'B', 'A'];
  const worst = Object.entries(grades).sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1]))[0];
  return { grades, weakest: worst ? { area: worst[0], grade: worst[1] } : null };
}

// Ile Σ zyska najlepsza XI, jeśli dodać kandydata do puli (i na jaką pozycję wejdzie).
export function marginalGain(players, candidate, opts = {}) {
  const pool = eligiblePlayers(players, opts);
  const base = bestFormation(pool, opts);
  const withHim = bestFormation([...pool, candidate], opts);
  if (!base || !withHim) return { gain: 0, slot: null, inXi: false };
  const slot = withHim.result.slots.find((s) => s.player?.id === candidate.id);
  return {
    gain: Math.round((withHim.result.total - base.result.total) * 100) / 100,
    slot: slot?.slot ?? null,
    inXi: !!slot,
  };
}

// „Zdrowie" struktury wieku: kara za nadmiar 30+, premia za 18–24.
export function ageStructureScore(players) {
  if (!players.length) return 0.5;
  let young = 0, prime = 0, old = 0;
  for (const p of players) {
    const a = p.ageYears || 25;
    if (a <= 20) young++;
    else if (a <= 27) prime++;
    else if (a >= 31) old++;
  }
  const n = players.length;
  return clamp(0.55 + (young / n) * 0.6 + (prime / n) * 0.2 - (old / n) * 0.9, 0, 1);
}

// ------------------------- Skład A / Skład B -------------------------

// Skład B = najlepszy możliwy skład na drugi mecz tygodnia wyłącznie z
// zawodników spoza Składu A.
export function secondLineup(players, slots, usedPlayerIds, opts = {}) {
  const rest = players.filter((p) => !usedPlayerIds.has(p.id));
  return bestLineup(rest, slots, opts);
}

// ------------------------- mapa umiejętności -------------------------

export const SKILL_KEYS = [
  'keeper',
  'defending',
  'playmaking',
  'winger',
  'passing',
  'scoring',
  'setPieces',
  'stamina',
  'form',
];

export const SKILL_LABEL = {
  keeper: 'Bram',
  defending: 'Obr',
  playmaking: 'Rozgr',
  winger: 'Skrz',
  passing: 'Pod',
  scoring: 'Wyk',
  setPieces: 'StF',
  stamina: 'Kon',
  form: 'Fm',
};

// Kolor kafelka od czerwieni (0) przez żółć do zieleni (~20).
export function skillColor(v) {
  const t = clamp((v || 0) / 20, 0, 1);
  const hue = 0 + t * 130; // 0 = czerwony, 130 = zielony
  // Ciemniejszy zakres jasności, żeby biały tekst na kafelku był czytelny (>4.5:1).
  return `hsl(${hue.toFixed(0)} 60% ${(24 + t * 6).toFixed(0)}%)`;
}

// Dwie najlepsze umiejętności "boiskowe" (bez form/kondycji) — do pogrubienia.
export function topSkills(pl, n = 2, opts = {}) {
  const field = SKILL_KEYS.filter((k) => k !== 'stamina' && k !== 'form');
  return field
    .map((k) => ({ k, v: skillVal(pl, k, opts) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, n)
    .map((x) => x.k);
}

// ------------------------- oceny sektorów (przybliżenie) -------------------------

// Wkład zawodnika do sektora zależnie od pozycji. To zgrubny model — Hattrick nie
// publikuje wzoru sektorów. Wartości WZGLĘDNE, nie oficjalne oceny HT.
const SECTOR_W = {
  def: {
    GK: { keeper: 1.0 },
    CD: { defending: 1.0, playmaking: 0.05 },
    WB: { defending: 0.7, winger: 0.1 },
    IM: { defending: 0.15 },
    WI: { defending: 0.1 },
  },
  mid: {
    IM: { playmaking: 0.8, passing: 0.2 },
    WI: { playmaking: 0.4, passing: 0.2, winger: 0.1 },
    WB: { playmaking: 0.25 },
    FW: { playmaking: 0.1 },
    CD: { playmaking: 0.05 },
  },
  att: {
    FW: { scoring: 0.8, passing: 0.15 },
    WI: { winger: 0.4, passing: 0.2, scoring: 0.1 },
    IM: { passing: 0.15 },
    WB: { winger: 0.05 },
  },
};

const SECTOR_DIV = { def: 3, mid: 3, att: 2.2 };

export function playerSectorContribution(player, slot) {
  const out = { def: 0, mid: 0, att: 0 };
  if (!player) return out;
  for (const sec of ['def', 'mid', 'att']) {
    const w = SECTOR_W[sec][slot];
    if (!w) continue;
    for (const k in w) out[sec] += skillVal(player, k) * w[k];
    out[sec] /= SECTOR_DIV[sec];
  }
  return out;
}

export function sectorRatings(slots) {
  const out = { def: 0, mid: 0, att: 0 };
  for (const s of slots) {
    if (!s.player) continue;
    const c = playerSectorContribution(s.player, s.slot);
    out.def += c.def;
    out.mid += c.mid;
    out.att += c.att;
  }
  return out;
}

// ------------------------- rekomendacje: SF, kapitan, kondycja -------------------------

const withExp = (arr2, base) =>
  arr2
    .filter((p) => (p.injuryLevel ?? -1) <= 0)
    .map((p) => ({ player: p, score: base(p) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

export function recommendSetPieceTaker(players) {
  return withExp(players, (p) => (p.setPieces || 0) * 0.82 + (p.experience || 0) * 0.18);
}
export function recommendCaptain(players) {
  return withExp(players, (p) => (p.leadership || 0) * 0.7 + (p.experience || 0) * 0.3);
}

// Przybliżona minuta, w której zawodnik zaczyna wyraźnie tracić na kondycji.
export function staminaFadeMinute(p) {
  const st = clamp(p.stamina || 0, 0, 9);
  return Math.min(90, Math.round(30 + st * 7));
}

// Sugestia 3 zmian: dla najszybciej gasnących w XI dobiera najlepsze zejście
// z ławki na tę samą pozycję.
export function suggestSubs(lineupSlots, benchPlayers, opts = {}) {
  const fading = lineupSlots
    .filter((s) => s.player)
    .map((s) => ({ ...s, fade: staminaFadeMinute(s.player) }))
    .sort((a, b) => a.fade - b.fade)
    .slice(0, 3);
  const usedBench = new Set();
  return fading.map((s) => {
    const cand = benchPlayers
      .filter((p) => !usedBench.has(p.id))
      .map((p) => ({ p, r: ratePlayerForSlot(p, s.slot, opts), fade: staminaFadeMinute(p) }))
      .filter((x) => Number.isFinite(x.r))
      .sort((a, b) => b.r - a.r)[0];
    if (cand) usedBench.add(cand.p.id);
    return { slot: s.slot, out: s.player, outFade: s.fade, in: cand?.p ?? null, inRating: cand?.r ?? null };
  });
}

const YOUTH_FIELD_KEYS = ['keeper', 'defending', 'playmaking', 'winger', 'passing', 'scoring', 'setPieces'];

// Potencjał młodzieżowca = suma maks. umiejętności (nieznane traktujemy jako
// bieżące). Przejrzysta heurystyka — NIE inferencja AI z bazy społeczności.
export function youthPotential(pl) {
  return YOUTH_FIELD_KEYS.reduce((sum, k) => {
    const mx = pl[k + 'Max'];
    const cur = pl[k];
    return sum + (mx != null && mx >= 0 ? mx : cur != null && cur >= 0 ? cur : 0);
  }, 0);
}

// "Gwiazda drużyny" = zawodnik o najwyższym potencjale. Zwraca id (albo null).
export function detectYouthStar(players) {
  let best = null;
  for (const p of players) {
    const pot = youthPotential(p);
    if (!best || pot > best.pot) best = { id: p.id, pot };
  }
  return best?.id ?? null;
}
