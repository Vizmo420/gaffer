// Gaffer v2 — operacje zmieniające dane (zapis na Pi).

import { state, save, players, teamName, playerFromCard, savedLineup } from './store.js';
import { opponentOf, matchId, wageAfterTransfer } from './logic.js';

export async function saveResult(m, us, them, playedIds = null) {
  const { home } = opponentOf(m, teamName());
  const i = state.matches.findIndex((x) => matchId(x) === matchId(m));
  const next = { ...m, homeGoals: home ? us : them, awayGoals: home ? them : us, status: 'FINISHED' };
  if (i >= 0) state.matches[i] = next; else state.matches.push(next);
  await save('matches');
  const ids = new Set(playedIds ?? savedLineup(m)?.playerIds ?? []);
  if (ids.size) {
    for (const p of players()) if (ids.has(p.id)) { p.weeksSinceLastMatch = 0; p.lastMatchDate = m.date; }
    await save('squad');
  }
  return next;
}

export async function upsertMatch(m) {
  const id = matchId(m);
  const i = state.matches.findIndex((x) => matchId(x) === id || (m.id && x.id === m.id));
  const withId = { ...m, id: m.id ?? id };
  if (i >= 0) state.matches[i] = withId; else state.matches.push(withId);
  await save('matches');
  return withId;
}

export async function deleteMatch(m) {
  state.matches = state.matches.filter((x) => matchId(x) !== matchId(m));
  delete state.lineups[matchId(m)];
  await save('matches');
  await save('lineups');
}

// Kandydat kupiony: trafia do kadry z pensją po transferze i lojalnością 0.
export async function buyCandidate(c) {
  const p = playerFromCard(c, { salary: wageAfterTransfer(c.salary, c.wageMode) });
  p.loyalty = 0;
  const exists = players().some((x) => x.id === p.id);
  if (!exists) state.squad.players.push(p);
  c.status = 'bought';
  await save('squad');
  await save('candidates');
  await addTransfer({ type: 'buy', name: c.name, playerId: p.id, price: c.price ?? null, tsi: c.tsi ?? null, age: c.age ?? null, wage: p.salary });
  return p;
}

// Odejście z kadry; przy sprzedaży zapisujemy cenę w dzienniku transferów (i opcjonalnie dopisujemy do gotówki).
export async function removePlayer(p, { soldFor = null, addToCash = false } = {}) {
  state.squad.players = players().filter((x) => x.id !== p.id);
  await save('squad');
  if (soldFor != null) {
    await addTransfer({ type: 'sell', name: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(), playerId: p.id, price: soldFor, tsi: p.tsi ?? null, age: p.age ?? null, wage: p.salary ?? null });
    if (addToCash && soldFor) { state.finance.cash += soldFor; state.finance.at = new Date().toISOString().slice(0, 10); await save('finance'); }
  }
}

export async function addTransfer(t) {
  state.transfers = [{ id: `t-${Date.now().toString(36)}`, date: new Date().toISOString().slice(0, 10), ...t }, ...state.transfers];
  await save('transfers');
}

export async function updatePlayer(p, patch) {
  Object.assign(p, patch);
  await save('squad');
}
