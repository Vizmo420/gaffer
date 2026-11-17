import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchState, nextMatch, pendingResults, opponentOf, resultFor, nextTrainingUpdate, trainingUpdatesBetween,
  skillChanges, wageAfterTransfer, pickLineup, alternativesFor, sellAdvice, youthVerdicts, preMatchChecklist,
  buildAlerts, parseDeadline, coverageFor, trainingPlan, ensureMatchIds, relTime,
  minutesPlan, calibration, applyCalibration, transferSummary, squadValueSeries, matchId,
} from '../web/v2/logic.js';
import { SAMPLE_SQUAD, SAMPLE_YOUTH } from '../web/sample-squad.js';

const T = 'Portowcy FC';
const now = new Date('2026-11-12T20:00:00');
const M = ensureMatchIds([
  { date: '2026-11-11T18:00:00', status: 'UPCOMING', homeTeamName: T, awayTeamName: 'Ultras_GKS' },
  { date: '2026-11-15T09:00:00', status: 'UPCOMING', homeTeamName: T, awayTeamName: 'Lomboo' },
  { date: '2026-11-03T12:00:00', status: 'FINISHED', homeTeamName: 'FC Old Boys Expats', awayTeamName: T, homeGoals: 6, awayGoals: 0 },
]);

test('mecz, który minął bez wyniku, czeka na wynik zamiast wisieć jako nadchodzący', () => {
  assert.equal(matchState(M[0], now), 'needsResult');
  assert.equal(matchState(M[1], now), 'upcoming');
  assert.equal(matchState(M[2], now), 'done');
  assert.equal(nextMatch(M, now).awayTeamName, 'Lomboo');
  assert.equal(pendingResults(M, now).length, 1);
});

test('rywal i wynik z naszej perspektywy', () => {
  assert.deepEqual(opponentOf(M[2], T), { home: false, name: 'FC Old Boys Expats' });
  assert.deepEqual(resultFor(M[2], T), { us: 0, them: 6, letter: 'P' });
});

test('aktualizacja treningu w piątek 02:30', () => {
  const d = nextTrainingUpdate(new Date('2026-11-12T20:00:00')); // czwartek
  assert.equal(d.getDay(), 5);
  assert.equal(d.getDate(), 13);
  assert.equal(nextTrainingUpdate(new Date('2026-11-13T03:00:00')).getDate(), 20);
  assert.equal(trainingUpdatesBetween('2026-11-07T14:45:00', '2026-11-10T23:00:00'), 0);
  assert.equal(trainingUpdatesBetween('2026-11-05T12:00:00', '2026-11-10T23:00:00'), 1);
});

test('skok umiejętności bez treningu w międzyczasie jest podejrzany (Kida 7.11 → 10.11)', () => {
  const prev = { at: '2026-11-07T14:45:00', players: [{ id: 1, firstName: 'Karol', lastName: 'Kida', passing: 7, scoring: 2 }] };
  const curr = { at: '2026-11-10T23:00:00', players: [{ id: 1, firstName: 'Karol', lastName: 'Kida', passing: 3, scoring: 7 }] };
  const ch = skillChanges(prev, curr);
  assert.equal(ch.length, 2);
  assert.ok(ch.every((c) => c.suspicious));
  const ok = skillChanges({ ...prev, at: '2026-11-05T12:00:00', players: [{ id: 1, scoring: 6 }] }, { ...curr, players: [{ id: 1, scoring: 7 }] });
  assert.equal(ok[0].suspicious, false);
});

test('pensja po transferze zależy od kraju (Olofsson bez zmian)', () => {
  assert.equal(wageAfterTransfer(13440, 'same'), 13440);
  assert.equal(wageAfterTransfer(10000, 'abroad'), 12000);
  assert.equal(wageAfterTransfer(12000, 'home'), 10000);
});

test('skład, alternatywy i kogo sprzedać na przykładowej kadrze', () => {
  const players = SAMPLE_SQUAD.players;
  const lu = pickLineup(players, { formation: '3-5-2', opts: { useLoyalty: true } });
  assert.equal(lu.result.slots.filter((s) => s.player).length, 11);
  const alt = alternativesFor(players, lu, 5, {});
  assert.ok(alt.every((a) => !lu.result.slots.some((s) => s.player?.id === a.player.id)));
  assert.ok(alt.every((a, i) => i === 0 || alt[i - 1].score >= a.score));
  const auto = pickLineup(players, { formation: 'auto' });
  assert.ok(auto.name);
  const sell = sellAdvice(players, lu, {});
  assert.ok(sell.every((s) => !lu.result.slots.some((x) => x.player?.id === s.player.id)));
});

test('akademia: każdy junior dostaje werdykt', () => {
  const lu = pickLineup(SAMPLE_SQUAD.players, { formation: '3-5-2' });
  const v = youthVerdicts(SAMPLE_YOUTH.players, SAMPLE_SQUAD.players, lu);
  assert.equal(v.length, SAMPLE_YOUTH.players.length);
  assert.ok(v.every((x) => ['promote', 'develop', 'watch', 'release'].includes(x.verdict)));
});

test('trening podań obejmuje skrzydłowych', () => {
  assert.equal(coverageFor('WI', 'Podania'), 'full');
  assert.equal(coverageFor('CD', 'Podania'), 'none');
  const lu = pickLineup(SAMPLE_SQUAD.players, { formation: '3-5-2' });
  const plan = trainingPlan(SAMPLE_SQUAD.players, lu.result.slots, { type: 'Podania', intensity: 100, coachLevel: 4, assistants: 10 });
  assert.ok(plan.filter((x) => x.coverage === 'full').length >= 7); // 5 pomocników + 2 napastników
});

test('lista przed meczem i alerty', () => {
  const players = SAMPLE_SQUAD.players;
  const lu = pickLineup(players, { formation: '3-5-2' });
  const c = preMatchChecklist({ match: M[1], saved: null, lineup: lu, players, settings: { trainingType: 'Podania' } });
  assert.equal(c.items[0].ok, false);
  const a = buildAlerts({ squad: { players, fetchedAt: '2026-11-01T00:00:00' }, matches: M, team: T, now,
    candidates: [{ name: 'Olofsson', deadline: '13.11.2026 10:03' }], settings: { staffContractEnd: '2026-12-04' } });
  const txt = a.map((x) => x.text).join(' | ');
  assert.match(txt, /Wpisz wynik: Ultras_GKS/);
  assert.match(txt, /Aukcja Olofsson/);
  assert.match(txt, /Kontrakty sztabu/);
  assert.match(txt, /Dane kadry sprzed 11 dni/);
});

test('termin aukcji z HT i czas względny', () => {
  assert.equal(parseDeadline('12.11.2026 10:03').getHours(), 10);
  assert.equal(relTime('2026-11-13T20:00:00', now), 'za 1 dzień');
  assert.equal(relTime('2026-11-12T19:30:00', now), 'przed chwilą');
});

test('plan minut: kto trenuje w tym tygodniu, a komu brakuje meczu na trenowanej pozycji', () => {
  const ps = SAMPLE_SQUAD.players;
  const settings = { trainingType: 'Podania', formation: '3-5-2' };
  const ms = ensureMatchIds([
    { date: '2026-11-12T21:00:00', homeTeamName: T, awayTeamName: 'Liga X', competition: 'Liga' },
    { date: '2026-11-11T20:00:00', homeTeamName: 'Puchar Y', awayTeamName: T, competition: 'Puchar Polski' },
  ]);
  const xi = pickLineup(ps, { formation: '3-5-2' });
  const lineups = { [matchId(ms[0])]: { slots: xi.slots, playerIds: xi.result.slots.map((s) => s.player?.id ?? null) } };
  const plan = minutesPlan({ players: ps, matches: ms, lineups, settings, now });
  assert.equal(plan.matches.length, 2);
  const ok = plan.rows.filter((r) => r.status === 'ok');
  assert.ok(ok.length >= 5);
  assert.ok(ok.every((r) => ['IM', 'WI', 'FW'].includes(r.slot)));
  // bez zapisanego składu nikt nie ma „ok”, a wskazówka kieruje do meczu bez składu
  const none = minutesPlan({ players: ps, matches: ms, lineups: {}, settings, now });
  assert.equal(none.rows.some((r) => r.status === 'ok'), false);
  assert.match(none.rows[0].hint, /w meczu/);
});

test('kalibracja prognozy z ocen po meczu', () => {
  const ms = ensureMatchIds([{ date: '2026-11-01T15:00:00', homeTeamName: T, awayTeamName: 'A', ours: { midfield: 6, defLeft: 5 } }, { date: '2026-11-08T15:00:00', homeTeamName: T, awayTeamName: 'B', ours: { midfield: 9 } }]);
  const lineups = { [matchId(ms[0])]: { predicted: { midfield: 5, defLeft: 5 } }, [matchId(ms[1])]: { predicted: { midfield: 9 } } };
  const c = calibration(ms, lineups);
  assert.equal(c.n, 2);
  assert.ok(Math.abs(c.factor.midfield - 1.1) < 1e-9);
  assert.equal(c.factor.attLeft, 1);
  assert.equal(applyCalibration({ midfield: 10 }, c).midfield.toFixed(2), '11.00');
  assert.equal(applyCalibration({ midfield: 10 }, { ...c, n: 1 }).midfield, 10); // z 1 meczu jeszcze nie poprawiamy
});

test('dziennik transferów i wartość kadry', () => {
  const s = transferSummary([{ type: 'buy', price: 1224000 }, { type: 'sell', price: 300000 }, { type: 'buy', price: null }]);
  assert.deepEqual([s.spent, s.earned, s.balance, s.unknown], [1224000, 300000, -924000, 1]);
  const v = squadValueSeries([{ at: 'a', players: [{ tsi: 10, salary: 2 }, { tsi: 5, salary: 1 }] }]);
  assert.deepEqual(v[0], { at: 'a', tsi: 15, wages: 3, n: 2 });
});
