// Odczyt zrzutów Hattricka (wynik OCR z prawdziwych zrzutów w test/fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMatchRatings, whichSide, parseLeague, parseSquadTable, detectKind, ratingFromWords, tableFromResults, leagueOutlook } from '../web/v2/parsers.js';

const L = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/ocr-${n}.json`, import.meta.url))).lines;
const TEAMS = ['Kondony Padura', 'FC Jastrzębie F-16 Krzesiny', 'A.C. Termopile', 'Lomboo', 'LKS Boleszevia', 'F.C Bazylika', 'Strzałka Chojny Łódź', 'Portowcy FC'];

test('raport meczu: 7 ocen obu drużyn, nazwy i wynik', () => {
  const r = parseMatchRatings(L('match-report'));
  assert.equal(r.complete, true);
  assert.deepEqual(r.home.ratings, { midfield: 3.5, defRight: 5.5, defCentral: 5.5, defLeft: 5.5, attRight: 3.5, attCentral: 4, attLeft: 3.75 });
  assert.deepEqual(r.away.ratings, { midfield: 3.75, defRight: 3.25, defCentral: 4.75, defLeft: 5, attRight: 3.75, attCentral: 3.25, attLeft: 3.5 });
  assert.deepEqual(r.score, { home: 2, away: 0 });
  assert.equal(whichSide(r, 'Ultras_GKS'), 'home');
  assert.equal(whichSide(r, 'Portowcy FC'), null);
  assert.equal(detectKind(L('match-report')), 'match');
});

test('oceny słowami, gdy raport nie pokazuje liczb', () => {
  assert.equal(ratingFromWords('kiepski - wysoki'), 3.5);
  assert.equal(ratingFromWords('przecietny - maks.'), 5.75);
  assert.equal(ratingFromWords('staby - min.'), 4);
  assert.equal(ratingFromWords('Kklepski-niski'), 3.25);
});

test('liga: tabela po znanych nazwach, terminarz tylko ze znanymi drużynami', () => {
  const lg = parseLeague(L('league'), TEAMS);
  assert.deepEqual(lg.table.slice(0, 2).map((t) => t.name), ['Kondony Padura', 'FC Jastrzębie F-16 Krzesiny']);
  assert.equal(lg.table[0].points, 0);
  assert.equal(lg.fixtures.length, 0); // baraże innych drużyn nie trafiają do terminarza
  assert.equal(detectKind(L('league')), 'league');
  const fx = parseLeague([
    { x: 100, y: 10, w: 300, h: 20, text: '15.11.2026 09:00' },
    { x: 100, y: 50, w: 300, h: 20, text: 'Portowcy FC - Lomboo' }, { x: 420, y: 50, w: 50, h: 20, text: '2 - 1' },
    { x: 100, y: 90, w: 300, h: 20, text: 'A.C. Termopile - LKS Boleszevia' },
  ], TEAMS).fixtures;
  assert.deepEqual(fx[0], { date: '2026-11-15T09:00:00', home: 'Portowcy FC', away: 'Lomboo', homeGoals: 2, awayGoals: 1 });
  assert.equal(fx[1].homeGoals, null);
});

test('tabela z wyników i co daje miejsce', () => {
  const t = tableFromResults(['A', 'B', 'C'], [{ home: 'A', away: 'B', homeGoals: 2, awayGoals: 0 }, { home: 'C', away: 'A', homeGoals: 1, awayGoals: 1 }]);
  assert.deepEqual(t.map((x) => [x.name, x.points]), [['A', 4], ['C', 1], ['B', 0]]);
  const o = leagueOutlook([{ name: 'A', points: 9 }, { name: 'B', points: 7 }, { name: 'C', points: 4 }, { name: 'D', points: 4 }, { name: 'Ja', points: 3 }], 'Ja', 3);
  assert.equal(o.pos, 5);
  assert.equal(o.toFirst, 6);
  assert.equal(o.zone, 'playoff');
  assert.equal(o.maxPoints, 3 + 33);
});

test('tabela kadry: kolumny rozpoznane po zgodności, zmiany tylko pewne', () => {
  const squad = JSON.parse(fs.readFileSync(new URL('./fixtures/ocr-squad-table.json', import.meta.url))).lines;
  // kadra „przed treningiem”: Jop miał podania 5, Kida skuteczność 5 (skok o 2 = do sprawdzenia), Dyduch forma 4
  const players = [
    { id: 1, firstName: 'Artur', lastName: 'Jop', form: 5, stamina: 7, keeper: 1, defending: 4, playmaking: 4, winger: 4, passing: 5, scoring: 6, setPieces: 4, experience: 1, leadership: 2, loyalty: 20, tsi: 1580, salary: 1320 },
    { id: 2, firstName: 'Karol', lastName: 'Kida', form: 6, stamina: 4, keeper: 1, defending: 4, playmaking: 4, winger: 3, passing: 3, scoring: 5, setPieces: 2, experience: 2, leadership: 4, loyalty: 20, tsi: 1070, salary: 1880 },
    { id: 3, firstName: 'Serse', lastName: 'Tomeo', form: 6, stamina: 8, keeper: 1, defending: 4, playmaking: 6, winger: 4, passing: 11, scoring: 10, setPieces: 7, experience: 4, leadership: 4, loyalty: 20, tsi: 35210, salary: 13296 },
    { id: 4, firstName: 'Tomasz', lastName: 'Dyduch', form: 4, stamina: 7, keeper: 1, defending: 5, playmaking: 12, winger: 6, passing: 10, scoring: 3, setPieces: 7, experience: 7, leadership: 6, loyalty: 20, tsi: 33420, salary: 24920 },
    { id: 5, firstName: 'Sami', lastName: 'Malinen', form: 7, stamina: 7, keeper: 1, defending: 6, playmaking: 8, winger: 8, passing: 12, scoring: 3, setPieces: 15, experience: 6, leadership: 4, loyalty: 10, tsi: 24020, salary: 12144 },
    { id: 6, firstName: 'Benoit', lastName: 'Allen', form: 8, stamina: 6, keeper: 1, defending: 11, playmaking: 6, winger: 3, passing: 5, scoring: 2, setPieces: 6, experience: 5, leadership: 5, loyalty: 20, tsi: 10900, salary: 12480 },
  ];
  const t = parseSquadTable(squad, players);
  assert.equal(t.found, 6);
  assert.equal(t.columns.passing > t.columns.winger, true);
  const ch = (id) => Object.fromEntries(t.rows.find((r) => r.player.id === id).changes.map((c) => [c.field, c]));
  assert.equal(ch(1).passing.to, 6);
  assert.equal(ch(1).passing.sure, true);
  assert.equal(ch(2).scoring.to, 7);
  assert.equal(ch(2).scoring.sure, false);
  assert.equal(ch(4).form.to, 5);
  assert.equal(ch(3).form ?? ch(3).tsi, undefined); // u Tomeo forma jest sklejona w „44206” — nie zgadujemy i nie nadpisujemy nią TSI
  assert.equal(detectKind(squad), 'squadTable');
});

test('prognoza końca sezonu: rozkład miejsc sumuje się do 100, mocny lider częściej 1.', async () => {
  const { seasonProjection } = await import('../web/v2/parsers.js');
  const table = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Ja'].map((name, i) => ({ name, played: 7, points: name === 'A' ? 19 : name === 'Ja' ? 12 : 8 - (i % 3) }));
  const p = seasonProjection({ table, team: 'Ja', roundsPlayed: 7, runs: 2000 });
  assert.ok(Math.abs(p.pct.reduce((a, b) => a + b, 0) - 100) < 1e-6);
  assert.equal(p.roundsLeft, 7);
  assert.ok(p.avgPoints > 12 && p.avgPoints < 12 + 21);
  const a = seasonProjection({ table, team: 'A', roundsPlayed: 7, runs: 2000 });
  assert.ok(a.promo > p.promo);
  // Twoja ocena siły rywali zmienia prognozę na starcie sezonu
  const zero = table.map((t) => ({ ...t, played: 0, points: 0 }));
  const weak = seasonProjection({ table: zero, team: 'Ja', roundsPlayed: 0, runs: 2000, strength: { Ja: 5 } });
  const even = seasonProjection({ table: zero, team: 'Ja', roundsPlayed: 0, runs: 2000 });
  assert.ok(weak.promo > even.promo * 1.5);
});

test('raport: taktyka obu drużyn, kartki i kontuzje z opisu, średnia z kilku raportów', async () => {
  const { parseTactics, parseMatchEvents, averageRival, parseMood } = await import('../web/v2/parsers.js');
  assert.deepEqual(parseTactics(L('match-report')), { home: 'normal', away: 'normal' });
  const ln = (y, text) => ({ x: 300, y, w: 600, h: 24, text });
  const ps = [{ id: 1, lastName: 'Kościliańczuk' }, { id: 2, lastName: 'Jop' }, { id: 3, lastName: 'Balov' }];
  const ev = parseMatchEvents([ln(10, 'W 30. minucie Ignacy Koscilianczuk otrzymal zolta kartke za faul.'), ln(40, 'Aleksandr Balov doznal kontuzji i musial opuscic boisko.'), ln(70, 'Jop strzelil gola.')], ps);
  assert.deepEqual(ev.map((e) => [e.player.id, e.type]), [[1, 'yellow'], [3, 'injury']]);
  const avg = averageRival([{ ratings: { midfield: 8, defLeft: 5 }, wasHome: false, tactic: 'counter' }, { ratings: { midfield: 9, defLeft: 6 }, wasHome: false, tactic: 'counter' }, { ratings: { midfield: 7 }, wasHome: false, tactic: 'normal' }]);
  assert.equal(avg.midfield, 8);
  assert.equal(avg.defLeft, 5.5);
  assert.equal(avg.tactic, 'counter');
  const mood = parseMood([ln(10, 'Nastrój: spokojni'), ln(40, 'Pewność siebie'), { x: 700, y: 40, w: 200, h: 24, text: 'przyzwoita' }], { spirit: { spokojni: 5 } });
  assert.deepEqual(mood, { spiritWord: 'spokojni', confWord: 'przyzwoita', spirit: 5, confidence: null });
});

test('liga z telefonu: zakładka „Pkt ± Z” daje punkty, „R P + -” nie udaje punktów', () => {
  const lg = parseLeague(L('league-mobile'), TEAMS);
  assert.equal(lg.table.length, 8);
  assert.deepEqual(lg.table.map((t) => t.points), [3, 3, 3, 1, 1, 0, 0, 0]);
  assert.equal(lg.table[3].name, 'Strzałka Chojny Łódź'); // ucięta nazwa
  assert.equal(lg.table[0].played, 1); // z „Runda 1. z 14”
  assert.ok(parseLeague(L('league-mobile-rp'), TEAMS).table.every((t) => t.points == null));
});
