// Projekcja treningu — ŚWIADOMA APROKSYMACJA.
// Hattrick nie publikuje wzoru silnika treningu. Poniższe współczynniki to
// przybliżenia oparte na modelach społeczności (wiki.hattrick.org/wiki/Training,
// kalkulatory Sigma/HT). Liczby są orientacyjne — traktuj je jak trend, nie wyrok.

// Główna umiejętność trenowana przez dany typ treningu klubu.
export const PRIMARY_TRAINED_SKILL = {
  Kondycja: 'stamina',
  Bramkarze: 'keeper',
  Obrona: 'defending',
  Rozgrywanie: 'playmaking',
  Skrzydła: 'winger',
  Podania: 'passing',
  Strzały: 'scoring',
  Dośrodkowania: 'winger',
  'Stałe fragmenty': 'setPieces',
};

// Bazowa liczba tygodni na wskoczenie NA dany poziom: 17 lat, solidny trener,
// intensywność 100%, 0 asystentów, pełny mecz na trenowanej pozycji.
const BASE_WEEKS = {
  1: 0.5, 2: 0.7, 3: 0.9, 4: 1.1, 5: 1.4, 6: 1.8, 7: 2.3, 8: 3.0, 9: 4.0, 10: 5.5,
  11: 7.5, 12: 10, 13: 14, 14: 19, 15: 25, 16: 33, 17: 42, 18: 52, 19: 63, 20: 75,
};

// Mnożnik wieku względem 17 lat (starszy = wolniej).
const AGE_MULT = {
  17: 1.0, 18: 1.15, 19: 1.35, 20: 1.6, 21: 1.9, 22: 2.3, 23: 2.8, 24: 3.4,
  25: 4.1, 26: 5.0, 27: 6.0, 28: 7.2, 29: 8.6, 30: 10, 31: 12, 32: 14, 33: 16, 34: 18,
};
const ageMult = (age) => AGE_MULT[Math.round(age)] ?? (age < 17 ? 0.9 : 20);

// Poziom trenera 1..7 (fatalny..znakomity+); solidny = 4.
const COACH_MULT = { 1: 1.35, 2: 1.2, 3: 1.08, 4: 1.0, 5: 0.92, 6: 0.86, 7: 0.8 };
const coachMult = (lvl) => COACH_MULT[lvl] ?? 1.0;

// Asystenci trenera: każdy ~ +3.5%, do 10.
const assistMult = (n) => 1 / (1 + 0.035 * Math.max(0, Math.min(10, n || 0)));

const coverageFactor = (cov) => (cov === 'full' ? 1 : cov === 'partial' ? 0.5 : 0);

/**
 * Szacowana liczba tygodni do następnego poziomu głównej trenowanej umiejętności.
 * @returns {{weeks:number|null, nextLevel:number, note?:string}}
 */
export function weeksToNextLevel(player, cfg) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return { weeks: null, nextLevel: 0, note: 'brak projekcji dla tego typu' };
  const cov = coverageFactor(cfg.coverage ?? 'full');
  if (!cov) return { weeks: null, nextLevel: 0, note: 'pozycja nie trenuje tej umiejętności' };

  const cur = player[skill];
  if (cur == null || cur < 0) return { weeks: null, nextLevel: 0, note: 'umiejętność nieznana' };
  const next = Math.floor(cur) + 1;
  const base = BASE_WEEKS[Math.min(next, 20)] ?? 90;
  const intensity = Math.max(1, cfg.intensity ?? 100) / 100;

  const weeks =
    (base * ageMult(player.ageYears ?? player.age ?? 25) * coachMult(cfg.coachLevel ?? 4) * assistMult(cfg.assistants)) /
    (intensity * cov);
  return { weeks: Math.round(weeks * 10) / 10, nextLevel: next };
}

// Przybliżony poziom po `weeks` tygodniach ciągłego treningu (składa kolejne skoki).
export function projectSkillAfter(player, cfg, weeks = 13) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return null;
  let lvl = player[skill];
  if (lvl == null || lvl < 0) return null;
  let budget = weeks;
  let guard = 0;
  while (guard++ < 40) {
    const w = weeksToNextLevel({ ...player, [skill]: lvl }, cfg);
    if (w.weeks == null || w.weeks > budget) break;
    budget -= w.weeks;
    lvl = w.nextLevel;
  }
  // częściowy postęp w bieżącym poziomie
  const w = weeksToNextLevel({ ...player, [skill]: lvl }, cfg);
  const frac = w.weeks ? Math.min(0.95, budget / w.weeks) : 0;
  return Math.round((lvl + frac) * 10) / 10;
}

/**
 * „Kogo trenować" — 0..100. Łączy: młody wiek, sensowne pole do wzrostu,
 * czy faktycznie gra na trenowanej pozycji, pokrycie treningu.
 */
export function trainingEfficiency(player, cfg, ctx = {}) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return 0;
  const cur = player[skill] ?? -1;
  if (cur < 0) return 0;

  const ageScore = Math.max(0.05, 1 / ageMult(player.ageYears ?? player.age ?? 25));
  const roomScore = Math.max(0.1, Math.min(1, (16 - cur) / 12)); // faworyzuje niski/średni poziom
  const cov = ctx.coverage ?? 'none';
  const playScore = cov === 'full' ? 1 : cov === 'partial' ? 0.6 : ctx.inSquad ? 0.4 : 0.2;

  return Math.round(100 * ageScore * roomScore * playScore * 10) / 10;
}

// Seria projekcji: poziom głównej trenowanej umiejętności po 4 / 8 / 13 tygodniach.
export function projectSkillSeries(player, cfg, weeks = [4, 8, 13]) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return null;
  const cur = player[skill];
  if (cur == null || cur < 0) return null;
  return weeks.map((w) => ({ week: w, level: projectSkillAfter(player, cfg, w) ?? cur }));
}

// Trening jako inwestycja — BARDZO zgrubny model.
// Zysk na wartości z +1 poziomu głównej umiejętności rośnie z poziomem;
// wzrost pensji też. „Zwrot" = po ilu tygodniach zysk na wartości pokrywa
// dodatkową pensję (jeśli trzymasz zawodnika), albo od razu (jeśli sprzedasz).
export function trainingRoi(player, cfg, estValueFn) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return null;
  const cur = player[skill];
  if (cur == null || cur < 0) return null;
  const w = weeksToNextLevel(player, cfg);
  if (w.weeks == null) return null;

  const lvl = w.nextLevel;
  const curVal = estValueFn ? estValueFn(player) || 0 : (player.tsi || 0) * 12;
  // wyższe poziomy = większy skok wartości
  const levelFactor = 0.06 + 0.02 * Math.max(0, lvl - 8);
  const valueGain = Math.round((curVal * levelFactor) / 1000) * 1000;
  const wageIncrease = Math.round(((player.salary || 0) * (0.1 + 0.02 * Math.max(0, lvl - 8))) / 100) * 100;
  const paybackWeeks = wageIncrease > 0 ? Math.round(valueGain / wageIncrease) : null;
  return { nextLevel: lvl, weeks: w.weeks, valueGain, wageIncrease, paybackWeeks };
}

// Ryzyko skoku pensji: zawodnik blisko przeskoczenia poziomu głównej trenowanej
// umiejętności (im wyższy poziom, tym większy skok wynagrodzenia w HT).
export function wageJumpRisk(player, cfg) {
  const skill = PRIMARY_TRAINED_SKILL[cfg.type];
  if (!skill || skill === 'stamina') return null;
  const w = weeksToNextLevel(player, cfg);
  if (w.weeks == null) return null;
  if (w.weeks <= 3 && w.nextLevel >= 9) {
    return { level: w.nextLevel, weeks: w.weeks, severity: w.nextLevel >= 13 ? 'wysoki' : 'średni' };
  }
  return null;
}
