// SQLite (data/data.sqlite) — migawki składu i diff między dwiema ostatnimi.
// To pierwszy element, który potrzebuje trwałej bazy, nie tylko sesji:
// sesja znika, a historia zmian umiejętności ma sens tylko długoterminowo.
//
// Używa wbudowanego modułu node:sqlite (stabilny w Node 24; w Node 22–23
// wymaga flagi --experimental-sqlite). Zero natywnych zależności do kompilacji.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SKILLS = [
  'form',
  'stamina',
  'keeper',
  'defending',
  'playmaking',
  'winger',
  'passing',
  'scoring',
  'set_pieces',
];

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'data.sqlite'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at  TEXT NOT NULL DEFAULT (datetime('now')),
      team_id   INTEGER,
      team_name TEXT,
      kind      TEXT NOT NULL DEFAULT 'senior'   -- senior | youth
    );
    CREATE TABLE IF NOT EXISTS snapshot_players (
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      player_id   INTEGER NOT NULL,
      name        TEXT,
      age_years   REAL,
      tsi         INTEGER,
      salary      INTEGER,
      form        INTEGER, stamina INTEGER,
      keeper      INTEGER, defending INTEGER, playmaking INTEGER,
      winger      INTEGER, passing   INTEGER, scoring    INTEGER, set_pieces INTEGER,
      PRIMARY KEY (snapshot_id, player_id)
    );

    -- Kronika Klubu: migawka metryk śledzonej drużyny (JSON blob) do diffu.
    CREATE TABLE IF NOT EXISTS tracked_snapshots (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id  INTEGER NOT NULL,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      payload  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tracked_team ON tracked_snapshots(team_id, id);
  `);
  return db;
}

// ------------------------- Kronika Klubu -------------------------

export function saveTrackedSnapshot(db, teamId, payload) {
  db.prepare('INSERT INTO tracked_snapshots (team_id, payload) VALUES (?, ?)').run(
    teamId,
    JSON.stringify(payload),
  );
}

// Zwraca { current, previous } — dwie ostatnie migawki danej drużyny (rozpakowane).
export function lastTwoTracked(db, teamId) {
  const rows = db
    .prepare('SELECT taken_at, payload FROM tracked_snapshots WHERE team_id = ? ORDER BY id DESC LIMIT 2')
    .all(teamId);
  const parse = (r) => (r ? { takenAt: r.taken_at, ...JSON.parse(r.payload) } : null);
  return { current: parse(rows[0]), previous: parse(rows[1]) };
}

export function saveSnapshot(db, { teamId, teamName, players, kind = 'senior' }) {
  const snap = db
    .prepare('INSERT INTO snapshots (team_id, team_name, kind) VALUES (?, ?, ?)')
    .run(teamId ?? null, teamName ?? null, kind);
  const id = Number(snap.lastInsertRowid);

  const insert = db.prepare(`
    INSERT INTO snapshot_players
      (snapshot_id, player_id, name, age_years, tsi, salary, form, stamina,
       keeper, defending, playmaking, winger, passing, scoring, set_pieces)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const n = (v) => (v == null ? null : Number(v)); // node:sqlite nie przyjmuje undefined
  db.exec('BEGIN');
  try {
    for (const p of players) {
      insert.run(
        id,
        n(p.id),
        `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.nickName || String(p.id),
        n(p.ageYears),
        n(p.tsi),
        n(p.salary),
        n(p.form),
        n(p.stamina),
        n(p.keeper),
        n(p.defending),
        n(p.playmaking),
        n(p.winger),
        n(p.passing),
        n(p.scoring),
        n(p.setPieces),
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return id;
}

export function listSnapshots(db, kind = 'senior') {
  return db
    .prepare(
      'SELECT id, taken_at, team_name, kind FROM snapshots WHERE kind = ? ORDER BY id DESC',
    )
    .all(kind);
}

/** Diff dwóch ostatnich migawek danego rodzaju. null gdy jest mniej niż 2. */
export function diffLastTwo(db, kind = 'senior') {
  const snaps = db
    .prepare(
      'SELECT id, taken_at FROM snapshots WHERE kind = ? ORDER BY id DESC LIMIT 2',
    )
    .all(kind);
  if (snaps.length < 2) return null;

  const [curr, prev] = snaps;
  const rowsOf = (sid) =>
    db.prepare('SELECT * FROM snapshot_players WHERE snapshot_id = ?').all(sid);
  const cur = new Map(rowsOf(curr.id).map((r) => [r.player_id, r]));
  const old = new Map(rowsOf(prev.id).map((r) => [r.player_id, r]));

  const added = [...cur.values()].filter((r) => !old.has(r.player_id));
  const removed = [...old.values()].filter((r) => !cur.has(r.player_id));

  const changed = [];
  for (const [id, c] of cur) {
    const o = old.get(id);
    if (!o) continue;
    const deltas = SKILLS.filter((s) => c[s] !== o[s]).map((s) => ({
      skill: s,
      from: o[s],
      to: c[s],
      diff: c[s] - o[s],
    }));
    if (deltas.length) changed.push({ playerId: id, name: c.name, deltas });
  }

  return { prev, curr, added, removed, changed };
}
