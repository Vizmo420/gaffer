// Klient CHPP: 3-krokowy OAuth 1.0a + wywołania chppxml.ashx + mapowanie XML.
// Framework-agnostic — używany zarówno przez cli.js, jak i opcjonalny server.js.

import { XMLParser } from 'fast-xml-parser';
import { authHeader } from './oauth.js';

const BASE = 'https://chpp.hattrick.org';
const OAUTH = {
  requestToken: `${BASE}/oauth/request_token.ashx`,
  authorize: `${BASE}/oauth/authorize.aspx`,
  accessToken: `${BASE}/oauth/access_token.ashx`,
};
const CHPP_URL = `${BASE}/chppxml.ashx`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  trimValues: true,
  // Nie chcemy, żeby "01" stawało się liczbą 1 w polach tekstowych/ID; te,
  // które są liczbami, i tak rzutujemy jawnie w mapperach.
  numberParseOptions: { hex: false, leadingZeros: false, eNotation: false },
});

// ------------------------- helpers -------------------------

const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const bool = (v) => v === true || v === 'True' || v === 'true' || v === 1 || v === '1';
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);

async function getText(url, header) {
  const res = await fetch(url, { headers: { Authorization: header } });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

// ------------------------- OAuth 1.0a -------------------------

export async function getRequestToken({ consumerKey, consumerSecret }) {
  const query = { oauth_callback: 'oob' }; // "oob" = kod PIN na stronie, bez callbacku
  const header = authHeader({
    url: OAUTH.requestToken,
    consumerKey,
    consumerSecret,
    oauthExtra: { oauth_callback: 'oob' },
  });
  const { ok, status, text } = await getText(
    OAUTH.requestToken + '?' + new URLSearchParams(query),
    header,
  );
  if (!ok) throw new Error(`request_token (${status}): ${text}`);
  const p = new URLSearchParams(text);
  return { token: p.get('oauth_token'), tokenSecret: p.get('oauth_token_secret') };
}

export function authorizeUrl(requestToken) {
  return `${OAUTH.authorize}?oauth_token=${encodeURIComponent(requestToken)}`;
}

export async function getAccessToken({
  consumerKey,
  consumerSecret,
  token,
  tokenSecret,
  verifier,
}) {
  const query = { oauth_verifier: verifier };
  const header = authHeader({
    url: OAUTH.accessToken,
    consumerKey,
    consumerSecret,
    token,
    tokenSecret,
    oauthExtra: { oauth_verifier: verifier },
  });
  const { ok, status, text } = await getText(
    OAUTH.accessToken + '?' + new URLSearchParams(query),
    header,
  );
  if (!ok) throw new Error(`access_token (${status}): ${text}`);
  const p = new URLSearchParams(text);
  return { token: p.get('oauth_token'), tokenSecret: p.get('oauth_token_secret') };
}

// ------------------------- surowe wywołanie CHPP -------------------------

/**
 * @param {object} creds { consumerKey, consumerSecret, token, tokenSecret }
 * @param {string} file  wartość parametru ?file= (np. "players")
 * @param {object} params dodatkowe parametry query (version, teamID, ...)
 * @returns {Promise<string>} surowy XML
 */
export async function chppRaw(creds, file, params = {}) {
  const query = { file, ...params };
  const header = authHeader({
    url: CHPP_URL,
    consumerKey: creds.consumerKey,
    consumerSecret: creds.consumerSecret,
    token: creds.token,
    tokenSecret: creds.tokenSecret,
    query,
  });
  const { ok, status, text } = await getText(
    CHPP_URL + '?' + new URLSearchParams(query),
    header,
  );
  if (!ok) throw new Error(`CHPP file=${file} (${status}): ${text.slice(0, 800)}`);
  return text;
}

export async function chpp(creds, file, params = {}) {
  const xml = await chppRaw(creds, file, params);
  const obj = parser.parse(xml);
  const root = obj.HattrickData ?? obj;
  // Błędy CHPP przychodzą jako <HattrickData><Error>...</Error> (status 200).
  if (root && (root.Error || root.ErrorCode)) {
    throw new Error(`CHPP file=${file} błąd: ${root.Error ?? ''} (kod ${root.ErrorCode ?? '?'})`);
  }
  return { xml, root, meta: pickMeta(root) };
}

function pickMeta(root) {
  return {
    fileName: root?.FileName ?? null,
    version: root?.Version ?? null,
    userId: root?.UserID ?? null,
    fetchedDate: root?.FetchedDate ?? null,
  };
}

// ------------------------- mapowanie: seniorzy -------------------------

// Nazwy pól potwierdzone w dokumentacji CHPP dla file=players:
// KeeperSkill, DefenderSkill, PlaymakerSkill, PassingSkill, WingerSkill,
// ScorerSkill, SetPiecesSkill.
export function mapPlayer(p) {
  return {
    id: num(p.PlayerID),
    firstName: p.FirstName ?? '',
    nickName: p.NickName ?? '',
    lastName: p.LastName ?? '',
    number: p.PlayerNumber != null ? num(p.PlayerNumber) : null,
    age: num(p.Age),
    ageDays: num(p.AgeDays),
    ageYears: Number((num(p.Age) + num(p.AgeDays) / 112).toFixed(2)),
    arrivalDate: p.ArrivalDate ?? null,

    form: num(p.PlayerForm),
    stamina: num(p.StaminaSkill),
    experience: num(p.Experience),
    leadership: num(p.Leadership),

    // Loyalty / MotherClubBonus bywają NIEobecne w eksporcie CHPP (zależnie od
    // wersji pliku). Jeśli tagi są — bierzemy je; jeśli nie — null i uzupełniasz
    // ręcznie w interfejsie (patrz README, sekcja "Czego CHPP nie daje").
    loyalty: p.Loyalty != null ? num(p.Loyalty) : null,
    motherClubBonus: p.MotherClubBonus != null ? bool(p.MotherClubBonus) : null,

    keeper: num(p.KeeperSkill),
    defending: num(p.DefenderSkill),
    playmaking: num(p.PlaymakerSkill),
    winger: num(p.WingerSkill),
    passing: num(p.PassingSkill),
    scoring: num(p.ScorerSkill),
    setPieces: num(p.SetPiecesSkill),

    tsi: num(p.TSI),
    salary: num(p.Salary),
    specialty: num(p.Specialty),
    injuryLevel: p.InjuryLevel != null ? num(p.InjuryLevel) : -1, // -1 = zdrowy
    yellowCards: num(p.Cards),
    transferListed: bool(p.TransferListed),
    countryId: num(p.NativeCountryID ?? p.CountryID),
    caps: num(p.Caps),
    capsU20: num(p.CapsU20),

    // Uzupełniane po stronie CLI / ręcznie:
    weeksSinceLastMatch: null, // liczone przez computeInactivity()
    trained: false, // decyzja użytkownika, nie dana z gry
    motherClubManual: false, // gdy CHPP nie dał MotherClubBonus
    daysAtClub: null,
  };
}

export async function fetchSquad(creds) {
  const { root, meta } = await chpp(creds, 'players', {
    actionType: 'view',
    orderBy: 'ByAge',
  });
  const team = root.Team ?? root.Teams?.Team ?? root;
  const players = arr(team?.PlayerList?.Player ?? root.PlayerList?.Player).map(mapPlayer);
  return {
    meta,
    teamId: num(team?.TeamID ?? root.TeamID),
    teamName: team?.TeamName ?? root.TeamName ?? '',
    players,
  };
}

// ------------------------- mecze + "tygodnie bez meczu" -------------------------

export async function fetchMatches(creds, teamId, { isYouth = false } = {}) {
  const { root } = await chpp(creds, 'matches', {
    teamID: teamId,
    isYouth: String(isYouth),
  });
  const team = root.Team ?? root;
  return arr(team?.MatchList?.Match).map((m) => ({
    id: num(m.MatchID),
    date: m.MatchDate ?? null,
    type: num(m.MatchType),
    status: m.Status ?? null, // FINISHED / UPCOMING / ONGOING
    homeTeamId: num(m.HomeTeam?.HomeTeamID),
    homeTeamName: m.HomeTeam?.HomeTeamName ?? '',
    awayTeamId: num(m.AwayTeam?.AwayTeamID),
    awayTeamName: m.AwayTeam?.AwayTeamName ?? '',
    homeGoals: m.HomeGoals != null ? num(m.HomeGoals) : null,
    awayGoals: m.AwayGoals != null ? num(m.AwayGoals) : null,
  }));
}

// teamdetails jest publiczne dla KAŻDEJ drużyny (po jej teamID) — legalny podgląd
// rywala bez scoutingu. Bez teamId zwraca własną drużynę zalogowanego menedżera.
export async function fetchTeamDetails(creds, teamId) {
  const { root, meta } = await chpp(creds, 'teamdetails', teamId ? { teamID: teamId } : {});
  const t = arr(root.Teams?.Team)[0] ?? root.Team ?? root;
  const pr = t?.PowerRating ?? {};
  // Nastrój / pewność siebie — nazwy pól niepewne; jeśli CHPP ich nie zwraca,
  // zostają null i uzupełniasz ręcznie w interfejsie.
  const spirit = tvNum(t?.TeamSpirit ?? t?.Morale ?? t?.Spirit);
  const confidence = tvNum(t?.Confidence ?? t?.SelfConfidence ?? t?.TeamConfidence);
  return {
    meta,
    teamId: num(t?.TeamID ?? teamId),
    name: t?.TeamName ?? '',
    shortName: t?.ShortTeamName ?? '',
    leagueName: t?.League?.LeagueName ?? '',
    leagueUnitId: num(t?.LeagueLevelUnit?.LeagueLevelUnitID),
    leagueUnitName: t?.LeagueLevelUnit?.LeagueLevelUnitName ?? '',
    rank: num(t?.LeagueLevelUnit?.CurrentRank ?? t?.LeagueLevelUnit?.Rank),
    powerRating: num(pr.PowerRating),
    globalRanking: num(pr.GlobalRanking),
    leagueRanking: num(pr.LeagueRanking),
    regionRanking: num(pr.RegionRanking),
    trainerName: t?.Trainer?.PlayerName ?? '',
    teamSpirit: spirit,
    confidence: confidence,
    foundedDate: t?.FoundedDate ?? null,
    fanClubSize: num(t?.Fanclub?.FanclubSize ?? t?.FanclubSize),
  };
}

const tvNum = (x) => {
  const v = x && typeof x === 'object' ? x['#text'] : x;
  return v == null || v === '' ? null : Number(v);
};

// RoleID z matchlineup -> typ pozycji w modelu (GK/CD/WB/WI/IM/FW).
export const ROLE_TO_SLOT = {
  100: 'GK',
  101: 'WB', 105: 'WB',
  102: 'CD', 103: 'CD', 104: 'CD',
  106: 'WI', 110: 'WI',
  107: 'IM', 108: 'IM', 109: 'IM',
  111: 'FW', 112: 'FW', 113: 'FW',
};

export async function fetchMatchLineup(creds, matchId, teamId) {
  const { root } = await chpp(creds, 'matchlineup', {
    matchID: matchId,
    teamID: teamId,
  });
  const team = root.Team ?? root;
  return arr(team?.Lineup?.Player).map((p) => ({
    id: num(p.PlayerID),
    roleId: num(p.RoleID),
    // RatingStars: ocena gwiazdkowa zawodnika w tym meczu (fundament pod mapę ocen).
    ratingStars: p.RatingStars != null ? Number(p.RatingStars) : null,
    ratingStarsEndOfMatch:
      p.RatingStarsEndOfMatch != null ? Number(p.RatingStarsEndOfMatch) : null,
  }));
}

/**
 * Dla każdego zawodnika liczy, ile pełnych tygodni minęło od jego ostatniego
 * rozegranego meczu. Zero wpisywania ręcznego — pobiera ostatnie mecze i ich
 * składy. `limit` ogranicza liczbę wywołań CHPP.
 */
export async function computeInactivity(creds, teamId, players, { limit = 10, isYouth = false } = {}) {
  const matches = (await fetchMatches(creds, teamId, { isYouth }))
    .filter((m) => m.status === 'FINISHED' && m.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  const lastPlayed = new Map(); // playerId -> Date
  const ratings = new Map(); // playerId -> [{matchId,date,stars,roleId,slot}...]
  for (const m of matches) {
    let lineup;
    try {
      lineup = await fetchMatchLineup(creds, m.id, teamId);
    } catch {
      continue; // np. mecz przeciwnika / brak dostępu — pomijamy
    }
    for (const pl of lineup) {
      if (!lastPlayed.has(pl.id)) lastPlayed.set(pl.id, new Date(m.date));
      if (pl.ratingStars != null) {
        if (!ratings.has(pl.id)) ratings.set(pl.id, []);
        ratings.get(pl.id).push({
          matchId: m.id,
          date: m.date,
          stars: pl.ratingStars,
          roleId: pl.roleId,
          slot: ROLE_TO_SLOT[pl.roleId] ?? null, // pozycja, na której grał — pod kalibrację wag
        });
      }
    }
  }

  const now = Date.now();
  for (const p of players) {
    const d = lastPlayed.get(p.id);
    p.weeksSinceLastMatch = d
      ? Math.floor((now - d.getTime()) / (7 * 24 * 3600 * 1000))
      : null; // null = nie znaleziono w ostatnich `limit` meczach
    p.recentRatings = ratings.get(p.id) ?? [];
  }
  return players;
}

// ------------------------- skaner rynku transferowego -------------------------

// transfersearch ZWRACA umiejętności graczy aktualnie wystawionych (są publiczne
// dopóki są na sprzedaż). Kody skilli w filtrze skillType (wg dokumentacji CHPP):
export const TRANSFER_SKILL_ID = {
  stamina: 12, keeper: 1, playmaking: 2, passing: 3, winger: 4,
  defending: 5, scoring: 6, setPieces: 7,
};

// criteria: { ageMin, ageMax, priceMin, priceMax, tsiMin, tsiMax, specialty,
//   skill1: {name, min, max}, skill2: {...}, pageIndex }
export async function searchTransferMarket(creds, criteria = {}) {
  const p = { pageIndex: criteria.pageIndex ?? 0 };
  if (criteria.ageMin != null) p.ageMin = criteria.ageMin;
  if (criteria.ageMax != null) p.ageMax = criteria.ageMax;
  if (criteria.priceMin != null) p.minPrice = criteria.priceMin;
  if (criteria.priceMax != null) p.maxPrice = criteria.priceMax;
  if (criteria.tsiMin != null) p.minTSI = criteria.tsiMin;
  if (criteria.tsiMax != null) p.maxTSI = criteria.tsiMax;
  if (criteria.specialty != null) p.specialty = criteria.specialty;
  [criteria.skill1, criteria.skill2, criteria.skill3].forEach((s, i) => {
    if (!s || !s.name) return;
    const id = TRANSFER_SKILL_ID[s.name];
    if (id == null) return;
    p[`skillType${i + 1}`] = id;
    if (s.min != null) p[`minSkillValue${i + 1}`] = s.min;
    if (s.max != null) p[`maxSkillValue${i + 1}`] = s.max;
  });

  const { root } = await chpp(creds, 'transfersearch', p);
  const list = root.TransferResults ?? root.SearchResults ?? root;
  return arr(list?.Player ?? root.Player).map((pl) => ({
    id: num(pl.PlayerID),
    firstName: pl.FirstName ?? '',
    lastName: pl.LastName ?? '',
    nickName: pl.NickName ?? '',
    age: num(pl.Age),
    ageDays: num(pl.AgeDays),
    ageYears: Number((num(pl.Age) + num(pl.AgeDays) / 112).toFixed(2)),
    form: num(pl.PlayerForm),
    stamina: num(pl.StaminaSkill),
    experience: num(pl.Experience ?? pl.ExperienceLevel),
    specialty: num(pl.Specialty),
    tsi: num(pl.TSI),
    askingPrice: num(pl.AskingPrice ?? pl.Price),
    deadline: pl.Deadline ?? null,
    keeper: num(pl.KeeperSkill),
    defending: num(pl.DefenderSkill),
    playmaking: num(pl.PlaymakerSkill),
    winger: num(pl.WingerSkill),
    passing: num(pl.PassingSkill),
    scoring: num(pl.ScorerSkill),
    setPieces: num(pl.SetPiecesSkill),
    // pola wspólne z modelem seniora
    injuryLevel: -1, yellowCards: 0, loyalty: null, motherClubBonus: null,
    weeksSinceLastMatch: null, trained: false, recentRatings: [],
  }));
}

// ------------------------- historia transferów / „podobni" -------------------------

export async function fetchTeamTransfers(creds, teamId) {
  const { root } = await chpp(creds, 'transfersTeam', { teamId, pageIndex: 0 });
  const team = root.Team ?? root;
  return arr(team?.Transfers?.Transfer).map((t) => ({
    transferId: num(t.TransferID),
    date: t.Deadline ?? t.TransferDate ?? null,
    playerId: num(t.Player?.PlayerID ?? t.PlayerID),
    playerName: t.Player?.PlayerName ?? t.PlayerName ?? '',
    tsi: num(t.TSI ?? t.Player?.TSI),
    price: num(t.Price),
    type: t.Type ?? null, // B = kupno, S = sprzedaż
  }));
}

export async function findSimilarByTsi(creds, teamId, targetTsi, { tolerance = 0.15 } = {}) {
  const transfers = await fetchTeamTransfers(creds, teamId);
  return transfers
    .filter((t) => t.tsi > 0)
    .map((t) => ({ ...t, tsiDelta: Math.abs(t.tsi - targetTsi) / targetTsi }))
    .filter((t) => t.tsiDelta <= tolerance)
    .sort((a, b) => a.tsiDelta - b.tsiDelta);
}

// ------------------------- Kronika Klubu: publiczne dane cudzej drużyny -------------------------

export async function fetchArena(creds, teamId) {
  const { root } = await chpp(creds, 'arenadetails', teamId ? { teamID: teamId } : {});
  const a = root.Arena ?? root;
  const cur = a?.CurrentCapacity ?? {};
  const exp = a?.ExpandedCapacity ?? {};
  const sum = (o) =>
    num(o.Terraces) + num(o.Basic) + num(o.Roof) + num(o.VIP) + num(o.Total ?? 0) ||
    num(o.Total);
  return {
    name: a?.ArenaName ?? '',
    currentSize: sum(cur) || num(cur.Total),
    expandedSize: exp && Object.keys(exp).length ? sum(exp) || num(exp.Total) : null,
    rebuildDate: a?.RebuiltDate ?? exp?.ExpansionDate ?? null,
    expansionInProgress: !!(exp && Object.keys(exp).length),
  };
}

// Publiczna lista zawodników cudzej drużyny — CHPP ukrywa umiejętności, ale
// oddaje TSI / wiek / specjalność, co wystarcza do agregatów w Kronice.
export async function fetchTeamSquadPublic(creds, teamId) {
  const { root } = await chpp(creds, 'players', { teamID: teamId, actionType: 'view' });
  const team = root.Team ?? root.Teams?.Team ?? root;
  const list = arr(team?.PlayerList?.Player ?? root.PlayerList?.Player).map((p) => ({
    id: num(p.PlayerID),
    name: `${p.FirstName ?? ''} ${p.LastName ?? ''}`.trim(),
    age: num(p.Age),
    tsi: num(p.TSI),
    salary: p.Salary != null ? num(p.Salary) : null, // zwykle brak dla cudzych
    specialty: num(p.Specialty),
  }));
  const byTsi = [...list].sort((a, b) => b.tsi - a.tsi);
  return {
    count: list.length,
    totalTsi: list.reduce((s, p) => s + p.tsi, 0),
    top11Tsi: byTsi.slice(0, 11).reduce((s, p) => s + p.tsi, 0),
    totalSalary: list.reduce((s, p) => s + (p.salary || 0), 0) || null,
    players: list,
  };
}

// Miejsce w tabeli + punkty + bilans dla drużyny w danej serii.
export async function fetchLeagueRow(creds, leagueUnitId, teamId) {
  if (!leagueUnitId) return null;
  try {
    const { root } = await chpp(creds, 'leaguedetails', { leagueLevelUnitID: leagueUnitId });
    const teamRow = arr(root.Team ?? root.Teams?.Team).find((t) => num(t.TeamID) === num(teamId));
    if (!teamRow) return null;
    return {
      position: num(teamRow.Position),
      positionChange: teamRow.PositionChange ?? null,
      points: num(teamRow.Points),
      won: num(teamRow.Won),
      draws: num(teamRow.Draws),
      lost: num(teamRow.Lost),
      goalsFor: num(teamRow.GoalsFor),
      goalsAgainst: num(teamRow.GoalsAgainst),
    };
  } catch {
    return null;
  }
}

// ------------------------- młodzież: diagnostyka -------------------------

// file=youthplayers to niepotwierdzony strzał co do nazwy. Próbujemy kilku
// kandydatów i raportujemy, który zadziałał + surowy XML do wklejenia.
const YOUTH_FILE_CANDIDATES = [
  { file: 'youthteamdetails', params: {} }, // to akurat istnieje na pewno
  { file: 'youthplayers', params: { actionType: 'details', orderBy: 'ByAge' } },
  { file: 'youthplayerlist', params: {} },
  { file: 'youthplayerdetails', params: {} },
];

export async function youthDebug(creds) {
  const out = {};
  for (const { file, params } of YOUTH_FILE_CANDIDATES) {
    try {
      const xml = await chppRaw(creds, file, params);
      out[file] = { ok: true, params, xml };
    } catch (e) {
      out[file] = { ok: false, params, error: String(e.message ?? e) };
    }
  }
  return out;
}

// ------------------------- młodzież: mapowanie (defensywne) -------------------------

// Element z atrybutami I wartością tekstową parser zwraca jako { '#text': v, ... }.
const tv = (x) => (x && typeof x === 'object' ? x['#text'] : x);
// -1 / brak = umiejętność nieujawniona przez skauta.
const yskill = (v) => (v == null || v === '' ? -1 : Number(v));

// Nie mamy zweryfikowanej listy pól młodzieżowych — mapper czyta kilka
// wariantów nazw i nie zakłada obecności żadnego pola. youth-debug potwierdzi,
// a wtedy ewentualnie dociśniemy nazwy.
export function mapYouthPlayer(p) {
  const sk = p.YouthPlayerSkills ?? p.PlayerSkills ?? p.Skills ?? {};
  const s = (name) => yskill(tv(sk[name]));
  const first = num(p.Age) + num(p.AgeDays) / 112;
  return {
    id: num(p.YouthPlayerID ?? p.PlayerID),
    firstName: p.FirstName ?? '',
    nickName: p.NickName ?? '',
    lastName: p.LastName ?? '',
    number: p.PlayerNumber != null ? num(p.PlayerNumber) : null,
    age: num(p.Age),
    ageDays: num(p.AgeDays),
    ageYears: Number(first.toFixed(2)),
    arrivalDate: p.ArrivalDate ?? null,
    canBePromotedInDays: p.CanBePromotedIn != null ? num(p.CanBePromotedIn) : null,
    specialty: num(p.Specialty),
    injuryLevel: p.InjuryLevel != null ? num(p.InjuryLevel) : -1,
    yellowCards: num(p.Cards),
    ownerNotes: p.OwnerNotes ?? '',
    // Komentarz skauta — nazwa pola niepewna, próbujemy kilku wariantów.
    scoutComment:
      tv(p.ScoutComment) ??
      tv(p.Comment) ??
      arr(p.ScoutComments?.ScoutComment).map((c) => tv(c.CommentText ?? c)).filter(Boolean).join(' · ') ??
      '',

    keeper: s('KeeperSkill'), keeperMax: s('KeeperSkillMax'),
    defending: s('DefenderSkill'), defendingMax: s('DefenderSkillMax'),
    playmaking: s('PlaymakerSkill'), playmakingMax: s('PlaymakerSkillMax'),
    winger: s('WingerSkill'), wingerMax: s('WingerSkillMax'),
    passing: s('PassingSkill'), passingMax: s('PassingSkillMax'),
    scoring: s('ScorerSkill'), scoringMax: s('ScorerSkillMax'),
    setPieces: s('SetPiecesSkill'), setPiecesMax: s('SetPiecesSkillMax'),

    lastRating:
      tv(p.LastMatch?.Rating ?? p.LastMatchRating) != null
        ? Number(tv(p.LastMatch?.Rating ?? p.LastMatchRating))
        : null,

    // pola wspólne z modelem seniora, żeby optimizer działał bez zmian:
    form: 0,
    stamina: 0,
    loyalty: null,
    motherClubBonus: null,
    motherClubManual: false,
    tsi: 0,
    trained: false,
    weeksSinceLastMatch: null,
    isYouth: true,
  };
}

async function firstOkYouthList(creds) {
  for (const file of ['youthplayerlist', 'youthplayers', 'youthplayerdetails']) {
    try {
      const { root, meta } = await chpp(creds, file, { actionType: 'details' });
      const team = root.YouthTeam ?? root.Team ?? root;
      const list = arr(
        team?.YouthPlayerList?.YouthPlayer ??
          team?.PlayerList?.Player ??
          root?.YouthPlayers?.YouthPlayer,
      );
      if (list.length) return { file, meta, team, list };
    } catch {
      /* próbujemy następnej nazwy */
    }
  }
  return null;
}

export async function fetchYouthSquad(creds) {
  const found = await firstOkYouthList(creds);
  if (!found) {
    throw new Error(
      'Nie udało się pobrać listy młodzieżowców żadną znaną nazwą pliku. ' +
        'Uruchom "node cli.js youth-debug" i wklej wynik.',
    );
  }
  const { file, meta, team, list } = found;
  return {
    sourceFile: file,
    meta,
    teamId: num(team?.YouthTeamID ?? team?.TeamID),
    teamName: team?.YouthTeamName ?? team?.TeamName ?? 'Drużyna młodzieżowa',
    players: list.map(mapYouthPlayer),
  };
}

export { num, bool, arr };
