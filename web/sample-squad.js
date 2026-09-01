// Dane przykładowe — żeby interfejs był użyteczny zanim wczytasz prawdziwe dane
// z CLI. Struktura zgodna z modelami z lib/hattrick.js.

// ------------------------- seniorzy -------------------------

const RATED = (id, stars, slot) => ({
  recentRatings: stars.map((s, i) => ({
    matchId: 9000 + i,
    date: `2026-08-${String(28 - i * 3).padStart(2, '0')}T19:00:00`,
    stars: s,
    slot: slot ?? null,
  })),
});

const mk = (id, name, s) => ({
  id,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  nickName: '',
  number: id,
  age: s.age ?? 24,
  ageDays: 0,
  ageYears: s.age ?? 24,
  form: s.form ?? 6,
  stamina: s.stamina ?? 7,
  experience: s.xp ?? 4,
  leadership: s.ld ?? 3,
  loyalty: s.loyalty ?? null,
  motherClubBonus: s.mcb ?? false,
  motherClubManual: false,
  keeper: s.gk ?? 1,
  defending: s.df ?? 1,
  playmaking: s.pm ?? 1,
  winger: s.wg ?? 1,
  passing: s.ps ?? 1,
  scoring: s.sc ?? 1,
  setPieces: s.sp ?? 1,
  tsi: s.tsi ?? 5000,
  salary: s.salary ?? 20000,
  specialty: s.spec ?? 0,
  injuryLevel: s.inj ?? -1,
  yellowCards: s.yc ?? 0,
  transferListed: false,
  countryId: 1,
  caps: 0,
  capsU20: 0,
  weeksSinceLastMatch: s.idle ?? 0,
  trained: s.trained ?? false,
  manualRating: null,
  daysAtClub: null,
  recentRatings: s.ratings ? RATED(id, s.ratings, s.pos).recentRatings : [],
});

export const SAMPLE_SQUAD = {
  teamName: 'Przykładowa Drużyna',
  teamId: 0,
  players: [
    mk(1, 'Adam Bramka', { gk: 14, df: 6, sp: 12, form: 7, tsi: 42000, spec: 6, ratings: [4.5, 4, 4.5], pos: 'GK', ld: 5, xp: 8, stamina: 5 }),
    mk(21, 'Zenon Rękawica', { gk: 10, df: 4, sp: 5, form: 5, tsi: 18000, ratings: [3, 3.5, 3], pos: 'GK' }),
    mk(2, 'Bartek Mur', { df: 13, pm: 6, sp: 5, form: 6, loyalty: 18, mcb: true, tsi: 55000, spec: 5, ratings: [5, 5.5, 4.5], pos: 'CD', ld: 7, xp: 9 }),
    mk(3, 'Cezary Beton', { df: 12, pm: 5, form: 5, tsi: 40000, ratings: [4, 3.5, 4], pos: 'CD', yc: 3 }),
    mk(4, 'Damian Skała', { df: 13, pm: 4, form: 6, tsi: 48000, ratings: [4.5, 4.5, 5], pos: 'CD' }),
    mk(5, 'Emil Bok', { df: 11, wg: 9, pm: 6, form: 6, tsi: 51000, spec: 2, ratings: [4, 3.5, 4], pos: 'WB' }),
    mk(6, 'Filip Flanka', { df: 10, wg: 11, pm: 6, form: 7, tsi: 52000, ratings: [3.5, 4, 3.5], pos: 'WB' }),
    mk(17, 'Rafał Zapora', { df: 11, pm: 5, form: 5, tsi: 37000 }),
    mk(18, 'Sławek Burta', { df: 9, wg: 10, pm: 5, form: 6, tsi: 34000 }),
    mk(7, 'Grzegorz Skrzydło', { wg: 13, ps: 9, pm: 7, df: 6, form: 7, tsi: 60000, spec: 1, ratings: [5, 4.5, 5.5], pos: 'WI' }),
    mk(8, 'Hubert Motor', { pm: 14, ps: 11, df: 6, form: 6, loyalty: 20, mcb: true, tsi: 72000, ratings: [6, 5.5, 6], pos: 'IM' }),
    mk(9, 'Igor Dyrygent', { pm: 13, ps: 12, sc: 6, form: 7, tsi: 68000, spec: 4, ratings: [5.5, 5, 5.5], pos: 'IM' }),
    mk(10, 'Jakub Rozgrywa', { pm: 12, ps: 10, wg: 7, form: 5, tsi: 54000, trained: true, age: 21, ratings: [4, 4.5, 4], pos: 'IM' }),
    mk(19, 'Tomasz Wahadło', { wg: 12, ps: 8, df: 7, form: 6, tsi: 45000, ratings: [4, 3.5, 4.5], pos: 'WI' }),
    mk(20, 'Wiktor Skrzyd', { wg: 11, ps: 9, pm: 6, form: 6, tsi: 41000, trained: true, age: 19 }),
    mk(11, 'Kamil Wykon', { sc: 14, wg: 8, ps: 7, pm: 6, form: 7, tsi: 75000, spec: 3, ratings: [5, 5.5, 6], pos: 'FW' }),
    mk(12, 'Leon Snajper', { sc: 13, wg: 6, ps: 6, form: 6, tsi: 63000, ratings: [4, 4.5, 3.5], pos: 'FW' }),
    mk(22, 'Xawery Grot', { sc: 11, wg: 7, ps: 6, form: 6, tsi: 46000, trained: true, age: 20, ratings: [3.5, 4, 3.5], pos: 'FW' }),
    mk(13, 'Marek Rezerwa', { df: 9, pm: 8, wg: 7, form: 4, idle: 6, tsi: 30000 }),
    mk(14, 'Norbert Młody', { pm: 9, ps: 8, sc: 7, form: 6, age: 18, tsi: 22000 }),
    mk(15, 'Olaf Kontuzja', { sc: 12, wg: 7, form: 6, inj: 2, tsi: 58000 }),
    mk(16, 'Piotr Uniwersalny', { df: 9, pm: 9, wg: 9, sc: 8, ps: 9, form: 6, tsi: 47000, ratings: [4.5, 4, 4.5], pos: 'IM' }),
  ],
};

// ------------------------- mecze -------------------------

export const SAMPLE_MATCHES = [
  { id: 9101, date: '2026-08-23T19:00:00', status: 'FINISHED', homeTeamId: 1, homeTeamName: 'Przykładowa Drużyna', awayTeamId: 501, awayTeamName: 'FC Rywal', homeGoals: 2, awayGoals: 1 },
  { id: 9102, date: '2026-08-26T19:00:00', status: 'FINISHED', homeTeamId: 502, homeTeamName: 'AS Sąsiad', awayTeamId: 1, awayTeamName: 'Przykładowa Drużyna', homeGoals: 0, awayGoals: 0 },
  { id: 9103, date: '2026-09-02T19:00:00', status: 'UPCOMING', homeTeamId: 1, homeTeamName: 'Przykładowa Drużyna', awayTeamId: 503, awayTeamName: 'KS Derby', homeGoals: null, awayGoals: null },
  { id: 9104, date: '2026-09-06T14:00:00', status: 'UPCOMING', homeTeamId: 1, homeTeamName: 'Przykładowa Drużyna', awayTeamId: 504, awayTeamName: 'Sparing United', homeGoals: null, awayGoals: null },
];

// ------------------------- transfery (znajdź podobnych) -------------------------

export const SAMPLE_TRANSFERS = [
  { playerName: 'Karol Wzmocnienie', tsi: 71000, price: 480000, type: 'B', date: '2026-07-30' },
  { playerName: 'Sprzedany Weteran', tsi: 44000, price: 210000, type: 'S', date: '2026-07-12' },
  { playerName: 'Adam Skrzydłowy', tsi: 58000, price: 320000, type: 'B', date: '2026-06-20' },
  { playerName: 'Michał Obrona', tsi: 52500, price: 260000, type: 'B', date: '2026-05-28' },
  { playerName: 'Były Napastnik', tsi: 76000, price: 590000, type: 'S', date: '2026-05-04' },
  { playerName: 'Junior z Akademii', tsi: 22000, price: 95000, type: 'S', date: '2026-04-19' },
];

// ------------------------- skaner rynku (przykład) -------------------------

const scoutP = (id, name, s) => ({
  id, firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '), nickName: '',
  age: s.age ?? 23, ageDays: 40, ageYears: (s.age ?? 23) + 0.36,
  form: s.form ?? 6, stamina: s.stamina ?? 7, experience: s.xp ?? 3, specialty: s.spec ?? 0,
  tsi: s.tsi ?? 40000, askingPrice: s.price ?? 300000, deadline: '2026-09-05T20:00:00',
  keeper: s.gk ?? 1, defending: s.df ?? 1, playmaking: s.pm ?? 1, winger: s.wg ?? 1,
  passing: s.ps ?? 1, scoring: s.sc ?? 1, setPieces: s.sp ?? 1,
  injuryLevel: -1, yellowCards: 0, loyalty: null, motherClubBonus: null,
  weeksSinceLastMatch: null, trained: false, recentRatings: [],
});

export const SAMPLE_SCOUT = {
  fetchedAt: new Date().toISOString(),
  criteria: { pos: 'IM', ageMax: 27, priceMax: 1200000 },
  results: [
    scoutP(801, 'Marek Dyrygent', { pm: 15, ps: 12, df: 6, age: 25, tsi: 92000, price: 980000, spec: 4 }),
    scoutP(802, 'Adrian Środek', { pm: 12, ps: 11, df: 7, wg: 6, age: 22, tsi: 58000, price: 520000 }),
    scoutP(803, 'Bogdan Pomoc', { pm: 11, ps: 9, df: 8, age: 26, tsi: 47000, price: 360000 }),
    scoutP(804, 'Cyprian Młody', { pm: 10, ps: 10, sc: 6, age: 19, tsi: 39000, price: 410000, spec: 1 }),
    scoutP(805, 'Damian Drogi', { pm: 16, ps: 13, wg: 8, age: 27, tsi: 140000, price: 1180000 }),
  ],
};

// ------------------------- Kronika Klubu -------------------------

export const SAMPLE_CHRONICLE = {
  fetchedAt: new Date().toISOString(),
  teams: [
    {
      teamId: 601, name: 'Lokalni Rywale', leagueUnitName: 'IV.123',
      powerRating: 3120, globalRanking: 48210, leagueRanking: 41, regionRanking: 190,
      trainerName: 'Trener Kowalski', fanClubSize: 1240,
      totalTsi: 980000, top11Tsi: 640000, squadCount: 19,
      arenaName: 'Stadion Miejski', arenaSize: 18500, arenaExpanded: 24000, arenaExpansion: true,
      league: { position: 3, points: 22, won: 7, draws: 1, lost: 3, goalsFor: 24, goalsAgainst: 14 },
      recent: [
        { date: '2026-08-24', homeTeamName: 'Lokalni Rywale', awayTeamName: 'X', homeGoals: 3, awayGoals: 1 },
        { date: '2026-08-17', homeTeamName: 'Y', awayTeamName: 'Lokalni Rywale', homeGoals: 2, awayGoals: 2 },
        { date: '2026-08-10', homeTeamName: 'Lokalni Rywale', awayTeamName: 'Z', homeGoals: 0, awayGoals: 1 },
      ],
      previous: { powerRating: 3080, totalTsi: 960000, fanClubSize: 1210, league: { position: 4 } },
    },
    {
      teamId: 602, name: 'Odwieczny Wróg', leagueUnitName: 'IV.123',
      powerRating: 3540, globalRanking: 31900, leagueRanking: 22, regionRanking: 96,
      trainerName: 'Coach Nowak', fanClubSize: 2600,
      totalTsi: 1350000, top11Tsi: 910000, squadCount: 22,
      arenaName: 'Arena Wroga', arenaSize: 30000, arenaExpanded: null, arenaExpansion: false,
      league: { position: 1, points: 27, won: 9, draws: 0, lost: 2, goalsFor: 31, goalsAgainst: 11 },
      recent: [
        { date: '2026-08-24', homeTeamName: 'Odwieczny Wróg', awayTeamName: 'A', homeGoals: 4, awayGoals: 0 },
        { date: '2026-08-17', homeTeamName: 'B', awayTeamName: 'Odwieczny Wróg', homeGoals: 1, awayGoals: 3 },
      ],
      previous: { powerRating: 3560, totalTsi: 1360000, fanClubSize: 2540, league: { position: 1 } },
    },
  ],
};

// ------------------------- młodzież -------------------------
// -1 = umiejętność nieujawniona (jak w CHPP).

const my = (id, name, s) => ({
  id,
  firstName: name.split(' ')[0],
  lastName: name.split(' ').slice(1).join(' '),
  nickName: '',
  number: id,
  age: s.age ?? 17,
  ageDays: s.days ?? 0,
  ageYears: (s.age ?? 17) + (s.days ?? 0) / 112,
  arrivalDate: null,
  canBePromotedInDays: s.promo ?? 120,
  specialty: s.spec ?? 0,
  injuryLevel: -1,
  yellowCards: 0,
  ownerNotes: '',
  keeper: s.gk ?? -1, keeperMax: s.gkM ?? -1,
  defending: s.df ?? -1, defendingMax: s.dfM ?? -1,
  playmaking: s.pm ?? -1, playmakingMax: s.pmM ?? -1,
  winger: s.wg ?? -1, wingerMax: s.wgM ?? -1,
  passing: s.ps ?? -1, passingMax: s.psM ?? -1,
  scoring: s.sc ?? -1, scoringMax: s.scM ?? -1,
  setPieces: s.sp ?? -1, setPiecesMax: s.spM ?? -1,
  lastRating: s.rate ?? null,
  scoutComment: s.scout ?? '',
  form: 0, stamina: 0, loyalty: null, motherClubBonus: null, motherClubManual: false,
  tsi: 0, trained: false, weeksSinceLastMatch: null, isYouth: true,
});

export const SAMPLE_YOUTH = {
  teamName: 'Przykładowa Młodzieżówka',
  players: [
    my(101, 'Młody Bramkarz', { gk: 5, gkM: 8, df: 2, dfM: -1, promo: 210 }),
    my(102, 'Adept Obrony', { df: 4, dfM: 7, pm: 2, pmM: 4, spec: 5, promo: 180 }),
    my(103, 'Talent Stopera', { df: 6, dfM: 10, pm: 3, pmM: -1, promo: 140 }),
    my(104, 'Boczny Junior', { df: 3, dfM: 6, wg: 4, wgM: 8, promo: 220 }),
    my(105, 'Skrzydłowy Nadzieja', { wg: 5, wgM: 9, ps: 3, psM: 6, spec: 2, promo: 160 }),
    my(106, 'Rozgrywający Cud', { pm: 6, pmM: 12, ps: 4, psM: 9, spec: 1, promo: 120, rate: 4.5, scout: 'ma potencjał na wybitnego rozgrywającego' }),
    my(107, 'Pomocnik Roboczy', { pm: 4, pmM: 7, ps: 3, psM: 6, promo: 200 }),
    my(108, 'Ukryty Diament', { pm: -1, pmM: -1, sc: -1, scM: -1, promo: 240 }),
    my(109, 'Napastnik Iskra', { sc: 5, scM: 10, wg: 3, wgM: 6, spec: 3, promo: 150 }),
    my(110, 'Snajper Junior', { sc: 6, scM: 9, ps: 3, psM: 5, promo: 170 }),
    my(111, 'Wahadłowy Młody', { df: 3, dfM: 6, wg: 4, wgM: 7, promo: 190 }),
    my(112, 'Rezerwowy Chłopak', { df: 2, dfM: 4, pm: 2, pmM: 4, promo: 260 }),
    my(113, 'Kolejny Talent', { pm: 3, pmM: 8, wg: 3, wgM: 7, promo: 175 }),
    my(114, 'Uniwersalny Junior', { df: 3, dfM: 6, pm: 3, pmM: 6, sc: 3, scM: 6, promo: 205 }),
  ],
};
