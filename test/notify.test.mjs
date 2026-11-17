// Które powiadomienia wysłać (bez wysyłania).
import test from 'node:test';
import assert from 'node:assert/strict';
import { events } from '../scripts/notify.mjs';

const T = 'Portowcy FC';
const base = { squad: { players: [] }, lineups: {}, candidates: [], settings: { teamName: T } };
const match = (date, extra = {}) => ({ id: 1, date, homeTeamName: T, awayTeamName: 'Rywal', ...extra });

test('skład niezapisany na 3 h przed meczem, wynik po meczu, aukcja w ostatniej godzinie', () => {
  const now = new Date('2026-11-18T19:00:00');
  let e = events({ ...base, matches: [match('2026-11-18T21:45:00')], now });
  assert.deepEqual(e.map((x) => x.key), ['lineup:1']);
  e = events({ ...base, matches: [match('2026-11-18T21:45:00')], lineups: { 1: {} }, now });
  assert.equal(e.length, 0);
  e = events({ ...base, matches: [match('2026-11-18T15:00:00')], now });
  assert.deepEqual(e.map((x) => x.key), ['result:1']);
  e = events({ ...base, matches: [], candidates: [{ id: 'c', name: 'X', deadline: '18.11.2026 19:40' }], now });
  assert.deepEqual(e.map((x) => x.key), ['auction:c']);
});

test('piątek po treningu: prośba o aktualizację kadry; wyłączone typy nie idą', () => {
  const now = new Date('2026-11-20T08:00:00');
  assert.deepEqual(events({ ...base, matches: [], now }).map((x) => x.key), ['training:2026-11-20']);
  assert.equal(events({ ...base, matches: [], settings: { notify: { training: false } }, now }).length, 0);
});
