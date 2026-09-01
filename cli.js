#!/usr/bin/env node
// Jednorazowe komendy CHPP — żaden proces nie stoi i nie nasłuchuje między nimi.
// Logowanie w trybie "oob": link + kod weryfikacyjny wklejany raz do terminala,
// token zapisany w .hattrick-token.json (kolejne uruchomienia już nie pytają).
//
//   node cli.js sync          squad + youth + team + matches + snapshot za jednym zamachem
//   node cli.js squad         pobiera skład -> data/squad.json (+ tygodnie bez meczu, oceny)
//   node cli.js youth         pobiera skład młodzieżowy -> data/youth-squad.json
//   node cli.js team          dane własnej drużyny -> data/team.json (nastrój, pewność siebie)
//   node cli.js snapshot      zapisuje migawkę składu do SQLite
//   node cli.js changes       diff dwóch ostatnich migawek -> data/changes.json
//   node cli.js matches       lista meczów -> data/matches.json
//   node cli.js transfers     historia transferów -> data/transfers.json ("znajdź podobnych")
//   node cli.js scout ...     skaner rynku -> data/scout.json
//        --pos=WB --skill=defending --min=10 --ageMax=27 --priceMax=900000 --tsiMax=400000
//   node cli.js watch add <id>  dodaj drużynę do Kroniki  (watch remove <id>, watch)
//   node cli.js chronicle     Kronika Klubu: metryki śledzonych drużyn -> data/chronicle.json
//   node cli.js opponent <id> publiczny podgląd rywala -> data/opponent-<id>.json
//   node cli.js similar <id>  transfery o zbliżonym TSI do zawodnika <id>
//   node cli.js youth-debug   surowa odpowiedź młodzieżówki -> data/youth-raw.json
//
// Flagi:  --reauth           wymuś ponowne logowanie (np. inne konto)
//         --no-inactivity    squad bez dociągania meczów (szybciej, mniej wywołań)
//         --limit=N          ile ostatnich meczów analizować (domyślnie 10)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import {
  getRequestToken,
  authorizeUrl,
  getAccessToken,
  fetchSquad,
  fetchMatches,
  fetchTeamDetails,
  fetchArena,
  fetchTeamSquadPublic,
  fetchLeagueRow,
  fetchTeamTransfers,
  searchTransferMarket,
  computeInactivity,
  findSimilarByTsi,
  fetchYouthSquad,
  youthDebug,
} from './lib/hattrick.js';
import { openDb, saveSnapshot, diffLastTwo, saveTrackedSnapshot, lastTwoTracked } from './lib/db.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
const TOKEN_FILE = path.join(ROOT, '.hattrick-token.json');

// ------------------------- argumenty -------------------------

const rawArgs = process.argv.slice(2);
const command = rawArgs.find((a) => !a.startsWith('-')) ?? 'help';
const positional = rawArgs.filter((a) => !a.startsWith('-') && a !== command);
const flags = Object.fromEntries(
  rawArgs
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.replace(/^--/, '').split('=');
      return [k, v === undefined ? true : v];
    }),
);

// ------------------------- logowanie -------------------------

function baseCreds() {
  const consumerKey = process.env.CHPP_CONSUMER_KEY;
  const consumerSecret = process.env.CHPP_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    console.error(
      'Brak CHPP_CONSUMER_KEY / CHPP_CONSUMER_SECRET.\n' +
        'Skopiuj .env.example -> .env i wpisz klucze z hattrick.org -> Moje Hattrick -> CHPP.',
    );
    process.exit(1);
  }
  return { consumerKey, consumerSecret };
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    }),
  );
}

async function getCreds() {
  const base = baseCreds();

  if (!flags.reauth && fs.existsSync(TOKEN_FILE)) {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return { ...base, token: saved.token, tokenSecret: saved.tokenSecret };
  }

  console.log('\nLogowanie do Hattricka (jednorazowo)\n' + '-'.repeat(38));
  const rt = await getRequestToken(base);

  console.log('\n1) Otwórz ten link w przeglądarce i zaloguj się do Hattricka:\n');
  console.log('   ' + authorizeUrl(rt.token) + '\n');
  console.log('2) Kliknij "Zezwól / Grant access". Hattrick pokaże kod weryfikacyjny.\n');
  const verifier = (await ask('3) Wklej kod tutaj i naciśnij Enter: ')).trim();

  const at = await getAccessToken({
    ...base,
    token: rt.token,
    tokenSecret: rt.tokenSecret,
    verifier,
  });
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      { token: at.token, tokenSecret: at.tokenSecret, savedAt: new Date().toISOString() },
      null,
      2,
    ),
  );
  console.log('\nOK — token zapisany w .hattrick-token.json. Kolejne komendy nie zapytają o logowanie.\n');
  return { ...base, token: at.token, tokenSecret: at.tokenSecret };
}

// ------------------------- drobne wypisywanie tabel -------------------------

function table(rows, columns) {
  if (!rows.length) {
    console.log('(brak danych)');
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.label.length, ...rows.map((r) => String(c.get(r) ?? '').length)),
  );
  const line = (cells) =>
    cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ');
  console.log(line(columns.map((c) => c.label)));
  console.log(line(widths.map((w) => '-'.repeat(w))));
  for (const r of rows) console.log(line(columns.map((c) => c.get(r))));
}

function writeJson(name, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}

// ------------------------- komendy -------------------------

async function cmdSquad() {
  const creds = await getCreds();
  const squad = await fetchSquad(creds);
  console.log(`\nDrużyna: ${squad.teamName} (ID ${squad.teamId}) — ${squad.players.length} zawodników`);

  if (!flags['no-inactivity']) {
    const limit = Number(flags.limit ?? 10);
    process.stdout.write(`Analizuję ostatnie ${limit} meczów (tygodnie bez gry, oceny)... `);
    try {
      await computeInactivity(creds, squad.teamId, squad.players, { limit });
      console.log('OK');
    } catch (e) {
      console.log('pominięto (' + (e.message ?? e) + ')');
    }
  }

  const file = writeJson('squad.json', {
    fetchedAt: new Date().toISOString(),
    teamId: squad.teamId,
    teamName: squad.teamName,
    players: squad.players,
  });

  table(
    [...squad.players].sort((a, b) => b.tsi - a.tsi),
    [
      { label: 'ID', get: (p) => p.id },
      { label: 'Zawodnik', get: (p) => `${p.firstName} ${p.lastName}`.trim() },
      { label: 'Wiek', get: (p) => p.ageYears },
      { label: 'Fm', get: (p) => p.form },
      { label: 'Kon', get: (p) => p.stamina },
      { label: 'GK', get: (p) => p.keeper },
      { label: 'DF', get: (p) => p.defending },
      { label: 'PM', get: (p) => p.playmaking },
      { label: 'WG', get: (p) => p.winger },
      { label: 'PS', get: (p) => p.passing },
      { label: 'SC', get: (p) => p.scoring },
      { label: 'SP', get: (p) => p.setPieces },
      { label: 'TSI', get: (p) => p.tsi },
      { label: 'BezMeczu(tyg)', get: (p) => p.weeksSinceLastMatch ?? '—' },
    ],
  );
  console.log(`\nZapisano: ${file}`);
  console.log('Wczytasz to w interfejsie webowym (npm run web) albo przyciskiem "Importuj skład".');
}

async function cmdSnapshot() {
  const creds = await getCreds();
  const squad = await fetchSquad(creds);
  const db = openDb(DATA_DIR);
  const id = saveSnapshot(db, {
    teamId: squad.teamId,
    teamName: squad.teamName,
    players: squad.players,
    kind: 'senior',
  });
  console.log(`Migawka #${id} zapisana (${squad.players.length} zawodników).`);
}

async function cmdChanges(opts = {}) {
  const youth = opts.youth ?? flags.youth;
  const kind = youth ? 'youth' : 'senior';
  const outName = youth ? 'changes-youth.json' : 'changes.json';
  const db = openDb(DATA_DIR);
  const diff = diffLastTwo(db, kind);
  if (!diff) {
    console.log(`Potrzebne co najmniej 2 migawki (${kind}). Odpal "node cli.js ${kind === 'youth' ? 'youth' : 'snapshot'}" dwa razy w odstępie czasu.`);
    writeJson(outName, { generatedAt: new Date().toISOString(), enough: false });
    return;
  }
  console.log(`Porównanie: ${diff.prev.taken_at}  ->  ${diff.curr.taken_at}\n`);

  console.log(`Nowi (${diff.added.length}):`);
  diff.added.forEach((p) => console.log(`  + ${p.name} (TSI ${p.tsi})`));
  console.log(`\nOdeszli (${diff.removed.length}):`);
  diff.removed.forEach((p) => console.log(`  - ${p.name} (TSI ${p.tsi})`));
  console.log(`\nZmiany umiejętności (${diff.changed.length}):`);
  diff.changed.forEach((c) => {
    const parts = c.deltas.map(
      (d) => `${d.skill} ${d.from}->${d.to} (${d.diff > 0 ? '+' : ''}${d.diff})`,
    );
    console.log(`  ${c.name}: ${parts.join(', ')}`);
  });

  const file = writeJson(outName, {
    generatedAt: new Date().toISOString(),
    enough: true,
    kind,
    prevAt: diff.prev.taken_at,
    currAt: diff.curr.taken_at,
    added: diff.added.map((p) => ({ name: p.name, tsi: p.tsi })),
    removed: diff.removed.map((p) => ({ name: p.name, tsi: p.tsi })),
    changed: diff.changed,
  });
  console.log(`\nZapisano: ${file}`);
}

async function cmdTeam() {
  const creds = await getCreds();
  const team = await fetchTeamDetails(creds); // bez teamId = własna drużyna
  const file = writeJson('team.json', { fetchedAt: new Date().toISOString(), team });
  console.log(`\n${team.name} — ${team.leagueUnitName} (miejsce ${team.rank || '—'})`);
  console.log(`PowerRating ${team.powerRating || '—'} · trener: ${team.trainerName || '—'}`);
  console.log(
    `Nastrój: ${team.teamSpirit ?? '— (CHPP nie zwraca — uzupełnij ręcznie w UI)'} · ` +
      `Pewność siebie: ${team.confidence ?? '— (jw.)'}`,
  );
  console.log(`Klub kibica: ${team.fanClubSize || '—'}`);
  console.log(`\nZapisano: ${file}`);
}

async function cmdMatches() {
  const creds = await getCreds();
  const squad = await fetchSquad(creds);
  const matches = (await fetchMatches(creds, squad.teamId)).sort(
    (a, b) => new Date(a.date) - new Date(b.date),
  );
  const file = writeJson('matches.json', {
    fetchedAt: new Date().toISOString(),
    teamId: squad.teamId,
    teamName: squad.teamName,
    matches,
  });
  table(
    matches,
    [
      { label: 'ID', get: (m) => m.id },
      { label: 'Data', get: (m) => (m.date ?? '').replace('T', ' ').slice(0, 16) },
      { label: 'Status', get: (m) => m.status },
      { label: 'Gospodarz', get: (m) => m.homeTeamName },
      { label: 'Gość', get: (m) => m.awayTeamName },
      {
        label: 'Wynik',
        get: (m) => (m.homeGoals == null ? '' : `${m.homeGoals}:${m.awayGoals}`),
      },
    ],
  );
  console.log(`\nZapisano: ${file}`);
}

async function cmdYouth() {
  const creds = await getCreds();
  const squad = await fetchYouthSquad(creds);
  console.log(
    `\nMłodzieżówka: ${squad.teamName} (ID ${squad.teamId}) — ` +
      `${squad.players.length} zawodników [źródło: file=${squad.sourceFile}]`,
  );

  // Mecze młodzieżowe + oceny z ostatnich meczów (analogicznie do seniorów).
  let youthMatches = [];
  if (!flags['no-inactivity'] && squad.teamId) {
    try {
      youthMatches = await fetchMatches(creds, squad.teamId, { isYouth: true });
      await computeInactivity(creds, squad.teamId, squad.players, {
        limit: Number(flags.limit ?? 8),
        isYouth: true,
      });
      console.log('Mecze/oceny młodzieży: OK');
    } catch (e) {
      console.log('Mecze/oceny młodzieży pominięto (' + (e.message ?? e) + ')');
    }
  }

  const file = writeJson('youth-squad.json', {
    fetchedAt: new Date().toISOString(),
    sourceFile: squad.sourceFile,
    teamId: squad.teamId,
    teamName: squad.teamName,
    players: squad.players,
    matches: youthMatches,
  });

  try {
    const db = openDb(DATA_DIR);
    saveSnapshot(db, {
      teamId: squad.teamId,
      teamName: squad.teamName,
      players: squad.players,
      kind: 'youth',
    });
  } catch (e) {
    console.log('Migawka młodzieży pominięta (' + (e.message ?? e) + ')');
  }

  const dash = (v) => (v == null || v < 0 ? '—' : v);
  table(squad.players, [
    { label: 'ID', get: (p) => p.id },
    { label: 'Zawodnik', get: (p) => `${p.firstName} ${p.lastName}`.trim() },
    { label: 'Wiek', get: (p) => p.ageYears },
    { label: 'GK', get: (p) => `${dash(p.keeper)}/${dash(p.keeperMax)}` },
    { label: 'DF', get: (p) => `${dash(p.defending)}/${dash(p.defendingMax)}` },
    { label: 'PM', get: (p) => `${dash(p.playmaking)}/${dash(p.playmakingMax)}` },
    { label: 'WG', get: (p) => `${dash(p.winger)}/${dash(p.wingerMax)}` },
    { label: 'PS', get: (p) => `${dash(p.passing)}/${dash(p.passingMax)}` },
    { label: 'SC', get: (p) => `${dash(p.scoring)}/${dash(p.scoringMax)}` },
    { label: 'SP', get: (p) => `${dash(p.setPieces)}/${dash(p.setPiecesMax)}` },
    { label: 'Awans za (dni)', get: (p) => p.canBePromotedInDays ?? '—' },
  ]);
  console.log(`\nZapisano: ${file}   (format: bieżąca/maks; „—" = nieujawnione)`);
}

async function cmdSimilar() {
  const playerId = Number(positional[0]);
  if (!playerId) {
    console.error('Podaj ID zawodnika: node cli.js similar <playerId>');
    process.exit(1);
  }
  const creds = await getCreds();
  const squad = await fetchSquad(creds);
  const target = squad.players.find((p) => p.id === playerId);
  if (!target) {
    console.error(`Nie znaleziono zawodnika ${playerId} w Twoim składzie.`);
    process.exit(1);
  }
  console.log(
    `\nUwaga: CHPP nie pozwala przeszukiwać rynku po umiejętnościach.\n` +
      `Jedyny publiczny wskaźnik dla cudzych zawodników to TSI — poniżej transfery\n` +
      `Twojej drużyny o TSI zbliżonym do ${target.firstName} ${target.lastName} (TSI ${target.tsi}).\n`,
  );
  const similar = await findSimilarByTsi(creds, squad.teamId, target.tsi, {
    tolerance: Number(flags.tolerance ?? 0.15),
  });
  table(similar, [
    { label: 'Zawodnik', get: (t) => t.playerName },
    { label: 'TSI', get: (t) => t.tsi },
    { label: 'Δ%', get: (t) => (t.tsiDelta * 100).toFixed(1) },
    { label: 'Cena', get: (t) => t.price },
    { label: 'Typ', get: (t) => (t.type === 'B' ? 'kupno' : t.type === 'S' ? 'sprzedaż' : t.type) },
    { label: 'Data', get: (t) => (t.date ?? '').replace('T', ' ').slice(0, 16) },
  ]);
}

async function cmdYouthDebug() {
  const creds = await getCreds();
  console.log('\nPróbuję nazw plików CHPP dla młodzieżówki...\n');
  const result = await youthDebug(creds);
  const file = writeJson('youth-raw.json', result);

  for (const [name, r] of Object.entries(result)) {
    if (r.ok) {
      console.log(`✔ file=${name} — OK (${r.xml.length} znaków). Podgląd:\n`);
      console.log(r.xml.slice(0, 2000));
      console.log('\n' + '='.repeat(60) + '\n');
    } else {
      console.log(`✘ file=${name} — ${r.error}\n`);
    }
  }
  console.log(`Pełne odpowiedzi zapisane w: ${file}`);
  console.log('Wklej mi zawartość tego pliku (albo podgląd wyżej), dopasuję mapowanie pól młodzieży.');
}

async function cmdScout() {
  const creds = await getCreds();
  const skill = flags.skill;
  const criteria = {
    pos: flags.pos ?? null,
    ageMin: flags.ageMin ? Number(flags.ageMin) : null,
    ageMax: flags.ageMax ? Number(flags.ageMax) : null,
    priceMax: flags.priceMax ? Number(flags.priceMax) : null,
    tsiMax: flags.tsiMax ? Number(flags.tsiMax) : null,
    specialty: flags.specialty ? Number(flags.specialty) : null,
    skill1: skill ? { name: skill, min: flags.min ? Number(flags.min) : null, max: flags.max ? Number(flags.max) : null } : null,
  };
  console.log('Skaner rynku, kryteria:', JSON.stringify(criteria));
  const results = await searchTransferMarket(creds, criteria);
  const file = writeJson('scout.json', {
    fetchedAt: new Date().toISOString(),
    criteria,
    results,
  });
  table(results.slice(0, 25), [
    { label: 'Zawodnik', get: (p) => `${p.firstName} ${p.lastName}`.trim() },
    { label: 'Wiek', get: (p) => p.ageYears },
    { label: 'GK', get: (p) => p.keeper }, { label: 'DF', get: (p) => p.defending },
    { label: 'PM', get: (p) => p.playmaking }, { label: 'WG', get: (p) => p.winger },
    { label: 'PS', get: (p) => p.passing }, { label: 'SC', get: (p) => p.scoring },
    { label: 'TSI', get: (p) => p.tsi },
    { label: 'Cena', get: (p) => p.askingPrice },
    { label: 'Termin', get: (p) => (p.deadline ?? '').replace('T', ' ').slice(0, 16) },
  ]);
  console.log(`\nZnaleziono ${results.length}. Zapisano: ${file}  (zakładka „Transfery")`);
}

async function cmdTransfers() {
  const creds = await getCreds();
  const squad = await fetchSquad(creds);
  const transfers = await fetchTeamTransfers(creds, squad.teamId);
  const file = writeJson('transfers.json', {
    fetchedAt: new Date().toISOString(),
    teamId: squad.teamId,
    transfers,
  });
  table(transfers.slice(0, 30), [
    { label: 'Zawodnik', get: (t) => t.playerName },
    { label: 'TSI', get: (t) => t.tsi },
    { label: 'Cena', get: (t) => t.price },
    { label: 'Typ', get: (t) => (t.type === 'B' ? 'kupno' : t.type === 'S' ? 'sprzedaż' : t.type) },
    { label: 'Data', get: (t) => (t.date ?? '').slice(0, 10) },
  ]);
  console.log(`\nZapisano: ${file}  (baza do „Znajdź podobnych" w interfejsie)`);
}

const WATCHLIST_FILE = () => path.join(DATA_DIR, 'watchlist.json');
function readWatchlist() {
  try {
    return JSON.parse(fs.readFileSync(WATCHLIST_FILE(), 'utf8'));
  } catch {
    return { teams: [] };
  }
}

async function cmdWatch() {
  const sub = positional[0];
  const wl = readWatchlist();
  if (sub === 'add' && positional[1]) {
    const id = Number(positional[1]);
    if (!wl.teams.includes(id)) wl.teams.push(id);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WATCHLIST_FILE(), JSON.stringify(wl, null, 2));
    console.log(`Dodano ${id}. Śledzone: ${wl.teams.join(', ')}`);
  } else if (sub === 'remove' && positional[1]) {
    wl.teams = wl.teams.filter((t) => t !== Number(positional[1]));
    fs.writeFileSync(WATCHLIST_FILE(), JSON.stringify(wl, null, 2));
    console.log(`Usunięto. Śledzone: ${wl.teams.join(', ') || '(brak)'}`);
  } else {
    console.log(`Śledzone drużyny: ${wl.teams.join(', ') || '(brak)'}`);
    console.log('Użycie: node cli.js watch add <teamId> | watch remove <teamId>');
  }
}

async function cmdChronicle() {
  const wl = readWatchlist();
  if (!wl.teams.length) {
    console.log('Brak śledzonych drużyn. Dodaj: node cli.js watch add <teamId>');
    return;
  }
  const creds = await getCreds();
  const db = openDb(DATA_DIR);
  const out = [];
  for (const teamId of wl.teams) {
    process.stdout.write(`Kronika: drużyna ${teamId}... `);
    try {
      const [team, matchesAll, squadPub, arena] = await Promise.all([
        fetchTeamDetails(creds, teamId),
        fetchMatches(creds, teamId).catch(() => []),
        fetchTeamSquadPublic(creds, teamId).catch(() => null),
        fetchArena(creds, teamId).catch(() => null),
      ]);
      const leagueRow = await fetchLeagueRow(creds, team.leagueUnitId, teamId).catch(() => null);
      const finished = matchesAll
        .filter((m) => m.status === 'FINISHED' && m.homeGoals != null)
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 6);
      const payload = {
        teamId,
        name: team.name,
        leagueUnitName: team.leagueUnitName,
        powerRating: team.powerRating,
        globalRanking: team.globalRanking,
        leagueRanking: team.leagueRanking,
        regionRanking: team.regionRanking,
        trainerName: team.trainerName,
        fanClubSize: team.fanClubSize,
        totalTsi: squadPub?.totalTsi ?? null,
        top11Tsi: squadPub?.top11Tsi ?? null,
        squadCount: squadPub?.count ?? null,
        arenaName: arena?.name ?? null,
        arenaSize: arena?.currentSize ?? null,
        arenaExpanded: arena?.expandedSize ?? null,
        arenaExpansion: arena?.expansionInProgress ?? false,
        league: leagueRow,
        recent: finished,
      };
      saveTrackedSnapshot(db, teamId, payload);
      const { previous } = lastTwoTracked(db, teamId);
      out.push({ ...payload, previous });
      console.log('OK');
    } catch (e) {
      console.log('błąd (' + (e.message ?? e) + ')');
    }
  }
  const file = writeJson('chronicle.json', { fetchedAt: new Date().toISOString(), teams: out });
  console.log(`\nZapisano: ${file}  (zakładka „Kronika" w interfejsie)`);
}

async function cmdOpponent() {
  const teamId = Number(positional[0]);
  if (!teamId) {
    console.error('Podaj ID drużyny: node cli.js opponent <teamId>');
    process.exit(1);
  }
  const creds = await getCreds();
  const team = await fetchTeamDetails(creds, teamId);
  let recent = [];
  try {
    recent = (await fetchMatches(creds, teamId))
      .filter((m) => m.status === 'FINISHED' && m.homeGoals != null)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8);
  } catch (e) {
    console.log('(nie udało się pobrać meczów rywala: ' + (e.message ?? e) + ')');
  }
  const file = writeJson(`opponent-${teamId}.json`, {
    fetchedAt: new Date().toISOString(),
    team,
    recent,
  });
  console.log(`\n${team.name} — ${team.leagueUnitName} (miejsce ${team.rank || '—'})`);
  console.log(
    `PowerRating ${team.powerRating || '—'} · ranking: global ${team.globalRanking || '—'}, ` +
      `liga ${team.leagueRanking || '—'}, region ${team.regionRanking || '—'}`,
  );
  console.log(`Trener: ${team.trainerName || '—'} · Klub kibica: ${team.fanClubSize || '—'}`);
  table(recent, [
    { label: 'Data', get: (m) => (m.date ?? '').slice(0, 10) },
    { label: 'Gospodarz', get: (m) => m.homeTeamName },
    { label: 'Gość', get: (m) => m.awayTeamName },
    { label: 'Wynik', get: (m) => `${m.homeGoals}:${m.awayGoals}` },
  ]);
  console.log(`\nZapisano: ${file}  (widoczne w zakładce „Mecze" przy nadchodzącym meczu z tą drużyną)`);
}

async function cmdSync() {
  console.log('Synchronizacja: squad → youth → team → matches → transfers → snapshot → changes → chronicle\n');
  const steps = [
    ['squad', cmdSquad],
    ['youth', cmdYouth],
    ['team', cmdTeam],
    ['matches', cmdMatches],
    ['transfers', cmdTransfers],
    ['snapshot', cmdSnapshot],
    ['changes', () => cmdChanges({ youth: false })],
    ['changes (młodzież)', () => cmdChanges({ youth: true })],
    ['chronicle', cmdChronicle],
  ];
  for (const [name, fn] of steps) {
    process.stdout.write(`\n=== ${name} ===\n`);
    try {
      await fn();
    } catch (e) {
      console.log(`(krok „${name}" pominięty: ${e.message ?? e})`);
    }
  }
  console.log('\nGotowe. Odśwież interfejs (npm run web).');
}

function cmdHelp() {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 25).join('\n').replace(/^\/\/ ?/gm, ''));
}

// ------------------------- dispatch -------------------------

const commands = {
  sync: cmdSync,
  squad: cmdSquad,
  youth: cmdYouth,
  team: cmdTeam,
  snapshot: cmdSnapshot,
  changes: cmdChanges,
  matches: cmdMatches,
  transfers: cmdTransfers,
  scout: cmdScout,
  watch: cmdWatch,
  chronicle: cmdChronicle,
  opponent: cmdOpponent,
  similar: cmdSimilar,
  'youth-debug': cmdYouthDebug,
  help: cmdHelp,
};

const AUTH_ERR = /\b401\b|oauth_problem|token_rejected|permission_denied|Invalid.*token|not authoriz/i;

const run = commands[command] ?? cmdHelp;
Promise.resolve()
  .then(run)
  .catch(async (e) => {
    const msg = e.message ?? String(e);
    // Auto-ponowne logowanie: token odrzucony/wygasł -> skasuj i spróbuj raz jeszcze.
    if (AUTH_ERR.test(msg) && !flags.reauth && fs.existsSync(TOKEN_FILE)) {
      console.error('\nToken CHPP odrzucony/wygasł — ponowne logowanie...\n');
      try {
        fs.unlinkSync(TOKEN_FILE);
      } catch {
        /* ignore */
      }
      flags.reauth = true;
      try {
        await run();
        return;
      } catch (e2) {
        console.error('\nBŁĄD (po ponownym logowaniu):', e2.message ?? e2);
        process.exit(1);
      }
    }
    console.error('\nBŁĄD:', msg);
    process.exit(1);
  });
