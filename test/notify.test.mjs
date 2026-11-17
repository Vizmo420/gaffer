// Które powiadomienia wysłać (bez wysyłania).
import test from 'node:test';
import assert from 'node:assert/strict';
import { events, weeklySummary } from '../scripts/notify.mjs';

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

test('niedzielne podsumowanie: wyniki tygodnia, kasa, następny mecz', () => {
  const now = new Date('2026-11-22T20:00:00');
  const matches = [match('2026-11-18T21:45:00', { homeGoals: 0, awayGoals: 4 }), { ...match('2026-11-29T09:00:00'), id: 2, awayTeamName: 'Lomboo' }];
  const e = events({ ...base, matches, finance: { cash: 1191522, at: '2026-11-17' }, now });
  assert.ok(e.some((x) => x.key === 'summary:2026-11-22'));
  const t = weeklySummary({ squad: { players: [] }, matches, finance: { cash: 1191522, at: '2026-11-17' }, team: T, now });
  assert.match(t, /P 0:4 Rywal/);
  assert.match(t, /1\s191\s522\szł/);
  assert.match(t, /Lomboo/);
});
