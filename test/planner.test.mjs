import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forecastCash, safeSpend, scoreCandidate, makeCandidate } from '../web/planner.js';

const pl = (o = {}) => ({ id: Math.random(), firstName: 'A', lastName: 'B', form: 6, stamina: 7, experience: 4, loyalty: 10, motherClubBonus: false,
  keeper: 1, defending: 4, playmaking: 5, winger: 5, passing: 5, scoring: 5, setPieces: 3, specialty: 0, injuryLevel: -1, yellowCards: 0, ...o });
const squad = [pl({ keeper: 9 }), ...Array.from({ length: 12 }, () => pl())];

test('finanse: tydzień bez meczu jest ujemny, z meczem dodatni', () => {
  const f = forecastCash({ cash: 2300000, wages: 155000 });
  assert.ok(f.quietNet < 0 && f.homeNet > 0);
  assert.equal(f.rows.length, 16);
  assert.equal(f.rows[0].home, false);
  assert.equal(f.rows[1].home, true);
});

test('finanse: jednorazowy wydatek obniża koniec o tyle samo', () => {
  const a = forecastCash({ cash: 2000000, wages: 150000 });
  const b = forecastCash({ cash: 2000000, wages: 150000, oneOff: 700000 });
  assert.equal(a.endCash - b.endCash, 700000);
});

test('safeSpend nie schodzi poniżej progu', () => {
  const o = { cash: 2300000, wages: 155000 };
  const s = safeSpend(o, 500000);
  const f = forecastCash({ ...o, oneOff: s });
  assert.ok(f.minCash >= 500000 - 1);
});

test('kandydat: pensja +20%, dobry pomocnik daje zysk, słaby nie', () => {
  assert.equal(makeCandidate({ salary: 10000 }).salary, 12000);
  const good = scoreCandidate(squad, { playmaking: 12, passing: 9, defending: 5 }, { price: 1e6 });
  const bad = scoreCandidate(squad, { playmaking: 2, passing: 2, defending: 2, winger: 2, scoring: 2 }, { price: 1e6 });
  assert.ok(good.dSigma > bad.dSigma);
  assert.ok(good.dSigma > 0.5 && good.inXI);
  assert.equal(bad.costPerSigma, null);
});
