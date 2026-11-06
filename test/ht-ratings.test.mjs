import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictRatings, simulateMatch, ratingLabel, assignSides, relocateMidfield } from '../web/ht-ratings.js';

const pl = (o) => ({ keeper: 1, defending: 5, playmaking: 5, winger: 5, passing: 5, scoring: 5, setPieces: 5, form: 6, stamina: 7, experience: 4, loyalty: 10, ...o });
const F352 = ['GK', 'CD', 'CD', 'CD', 'WI', 'IM', 'IM', 'IM', 'WI', 'FW', 'FW'];
const lineup = (mod = {}) => F352.map((slot, i) => ({ slot, player: pl({ ...(slot === 'GK' ? { keeper: 9 } : {}), ...(mod[i] || {}) }) }));

test('etykiety jak w raporcie HT', () => {
  assert.equal(ratingLabel(3.5), 'kiepski – wysoki');
  assert.equal(ratingLabel(5), 'przeciętny – min.');
  assert.equal(ratingLabel(3.75), 'kiepski – maks.');
});

test('strony w formacji', () => {
  assert.deepEqual(assignSides(F352), ['M', 'L', 'M', 'R', 'L', 'L', 'M', 'R', 'R', 'L', 'R']);
});

test('lepsze rozgrywanie podnosi pomoc, nie obronę', () => {
  const a = predictRatings(lineup());
  const b = predictRatings(lineup({ 5: { playmaking: 12 }, 6: { playmaking: 12 }, 7: { playmaking: 12 } }));
  assert.ok(b.midfield > a.midfield + 1);
  assert.equal(b.defCentral.toFixed(6), a.defCentral.toFixed(6));
});

test('dom i nastrój podnoszą pomoc', () => {
  const away = predictRatings(lineup(), { location: 'away', spirit: 5 });
  const home = predictRatings(lineup(), { location: 'home', spirit: 5 });
  const happy = predictRatings(lineup(), { location: 'away', spirit: 9 });
  assert.ok(home.midfield > away.midfield && happy.midfield > away.midfield);
  assert.ok(Math.abs(relocateMidfield(home, 'home', 'away').midfield - away.midfield) < 1e-9);
});

test('symulacja: równe siły są symetryczne, przewaga daje więcej wygranych', () => {
  const r = { midfield: 6, defLeft: 6, defCentral: 6, defRight: 6, attLeft: 6, attCentral: 6, attRight: 6 };
  const even = simulateMatch(r, r, { runs: 20000 });
  assert.ok(Math.abs(even.win - even.loss) < 3);
  assert.ok(even.goalsFor > 1 && even.goalsFor < 2.2);
  const better = simulateMatch({ ...r, midfield: 7.5 }, r, { runs: 20000 });
  assert.ok(better.win > even.win + 10);
});
