// Jednorazowo: buduje data/history/ z zachowanych eksportów CSV (players_DD.MM.RRRR.csv)
// i z bieżącego data/squad.json. Później migawki dopisuje sam serwer przy każdym zapisie kadry.
//   node scripts/seed-history.mjs
import fs from 'node:fs';
import path from 'node:path';
import { parseSquadCsv } from '../web/csv-import.js';

const DATA = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'data');
const HIST = path.join(DATA, 'history');
fs.mkdirSync(HIST, { recursive: true });
const write = (day, at, players) => {
  fs.writeFileSync(path.join(HIST, `squad-${day}.json`), JSON.stringify({ at, players }, null, 1));
  console.log(day, players.length, 'zawodników');
};

for (const f of fs.readdirSync(DATA).filter((f) => /^players_\d{2}\.\d{2}\.\d{4}\.csv$/.test(f))) {
  const [, d, m, y] = f.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  const { players } = parseSquadCsv(fs.readFileSync(path.join(DATA, f), 'utf8'));
  write(`${y}-${m}-${d}`, `${y}-${m}-${d}T12:00:00+01:00`, players);
}
const squad = JSON.parse(fs.readFileSync(path.join(DATA, 'squad.json'), 'utf8'));
const day = new Date().toISOString().slice(0, 10);
write(day, new Date().toISOString(), squad.players);
