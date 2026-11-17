// Liga: tabela, terminarz sezonu (14 kolejek), ile punktów do awansu / utrzymania.

import { html, icon, str, toast, openSheet, closeSheet, chip } from '../ui.js';
import { state, save, teamName } from '../store.js';
import { matchId, opponentOf, resultFor, fmtDate, matchState } from '../logic.js';
import { upsertMatch } from '../actions.js';
import { ocrLines } from '../ocr.js';
import { parseLeague, leagueOutlook, bestName, seasonProjection } from '../parsers.js';

const WEEK = 7 * 864e5;
const ZONE = {
  promo: ['miejsce awansowe', 'good', '1. miejsce daje awans (bezpośrednio albo przez baraż).'],
  safe: ['bezpiecznie', '', 'Miejsca 2–4: utrzymanie bez baraży.'],
  playoff: ['strefa baraży', 'warn', 'Miejsca 5–6 grają baraż o utrzymanie.'],
  down: ['strefa spadkowa', 'bad', 'Miejsca 7–8 spadają do niższej ligi.'],
};

export const roundDate = (lg, r) => new Date(new Date(lg.seasonStart).getTime() + (r - 1) * WEEK);
const isLeague = (m) => /lig[ai]/i.test(m.competition ?? '');

// Mecz ligowy danej kolejki: po numerze albo po dniu.
export function leagueMatch(lg, r) {
  const day = roundDate(lg, r).toDateString();
  return state.matches.find((m) => isLeague(m) && (m.round === r || (m.round == null && new Date(m.date).toDateString() === day))) ?? null;
}

export function leagueStatus() {
  const lg = state.league;
  const team = teamName();
  if (!lg?.table?.length) return null;
  const played = Math.max(0, ...lg.table.map((t) => t.played ?? 0));
  return leagueOutlook(lg.table, bestName(team, lg.table.map((t) => t.name)) ?? team, played, lg.rounds);
}

// Tabela do prognozy: ze zrzutu, a bez niego — nasze wyniki + średnia dla reszty (oznaczone jako szacunek).
function effectiveTable(lg, ourName) {
  const team = teamName();
  if (lg.table?.filter((t) => t.points != null).length >= lg.teams.length / 2) {
    return { rows: lg.table.map((t) => ({ ...t, points: t.points ?? 0, played: t.played ?? 0 })), estimated: false };
  }
  let played = 0, points = 0;
  for (let r = 1; r <= lg.rounds; r++) {
    const m = leagueMatch(lg, r);
    const res = m ? resultFor(m, team) : null;
    if (res) { played++; points += res.letter === 'W' ? 3 : res.letter === 'R' ? 1 : 0; }
  }
  return { rows: lg.teams.map((n) => (n === ourName ? { name: n, played, points } : { name: n, played, points: Math.round(1.35 * played) })), estimated: true };
}

function projection(lg, ourName) {
  const team = teamName();
  const { rows, estimated } = effectiveTable(lg, ourName);
  const played = Math.max(0, ...rows.map((t) => t.played ?? 0));
  const ours = {};
  for (let r = played + 1; r <= lg.rounds; r++) {
    const m = leagueMatch(lg, r);
    if (!m) continue;
    const o = opponentOf(m, team);
    const opp = bestName(o.name, lg.teams.filter((t) => t !== ourName));
    if (opp) ours[r] = { opp, home: o.home };
  }
  const p = seasonProjection({ table: rows, team: ourName, roundsPlayed: played, rounds: lg.rounds, ours, strength: lg.strength ?? {} });
  return p && { ...p, estimated, known: Object.keys(ours).length };
}

function projectionSection(p) {
  if (!p) return '';
  const max = Math.max(...p.pct);
  const tone = (i) => (i === 0 ? 'var(--good)' : i >= 6 ? 'var(--bad)' : i >= 4 ? 'var(--warn)' : 'var(--accent)');
  return html`<h3 class="section-title">Gdzie skończę sezon</h3><section class="card">
    <div class="card-head"><h2>${max >= 22 ? `Najpewniej ${p.likely}. miejsce` : 'Wszystko otwarte'}</h2><span class="small muted">ok. ${Math.round(p.avgPoints)} pkt</span></div>
    <div class="stats" style="margin:10px 0">
      <div class="stat"><b class="good">${Math.round(p.promo)}%</b><span>awans (1.)</span></div>
      <div class="stat"><b>${Math.round(p.safe)}%</b><span>2.–4.</span></div>
      <div class="stat"><b class="${p.playoff + p.down >= 40 ? 'bad' : ''}">${Math.round(p.playoff + p.down)}%</b><span>baraż / spadek</span></div>
    </div>
    ${p.pct.map((v, i) => html`<div class="hist-row"><span style="width:28px">${i + 1}.</span><span style="flex:1;margin:0 10px"><span class="bar"><i style="width:${max ? Math.round((100 * v) / max) : 0}%;background:${tone(i)}"></i></span></span><b class="tnum" style="width:44px;text-align:right">${Math.round(v)}%</b></div>`)}
    <p class="hint">Symulacja ${p.roundsLeft} pozostałych kolejek (4000 razy) z obecnych punktów${p.estimated ? ' — tabela jest szacunkowa (Twoje wyniki + średnia dla reszty), wczytaj zrzut tabeli, żeby była dokładna' : ''} i Twojej oceny siły drużyn („Tabela i siła drużyn”). ${p.known ? `Znani rywale w ${p.known} kolejkach liczeni wprost.` : 'Rywali w kolejnych kolejkach losuję — wpisz terminarz, a będzie dokładniej.'} Na początku sezonu to raczej kierunek niż pewność.</p>
  </section>`;
}

export function render(el, { app }) {
  const lg = state.league;
  const team = teamName();
  const ourName = bestName(team, lg.teams) ?? team;
  const table = lg.table ? [...lg.table].sort((a, b) => (b.points ?? -1) - (a.points ?? -1)) : null;
  const o = leagueStatus();
  const z = o ? ZONE[o.zone] : null;
  const rounds = Array.from({ length: lg.rounds }, (_, i) => i + 1);
  const proj = projection(lg, ourName);

  el.innerHTML = str(html`
    ${o ? html`<section class="hero">
      <p class="hero-kicker">Liga ${lg.name} · ${o.left} ${o.left === 1 ? 'kolejka' : 'kolejek'} do końca</p>
      <h2 class="hero-title">${o.pos}. miejsce · ${o.points} pkt</h2>
      <p class="hero-meta">${chip(z[0], z[1])} ${o.pos === 1 ? `przewaga ${o.lead} pkt nad 2.` : `do 1. miejsca: ${o.toFirst} pkt`}${o.toSafe > 0 ? ` · do 4. miejsca: ${o.toSafe} pkt` : ''}</p>
      <p class="small muted" style="margin-top:8px">${z[2]} Maksymalnie możesz mieć ${o.maxPoints} pkt.</p>
    </section>` : html`<section class="card"><h2>Liga ${lg.name}</h2><p class="lead" style="margin-top:6px">Wczytaj zrzut strony ligi z HT (Liga → Aktualna tabela), a pokażę miejsce i ile brakuje do awansu.</p></section>`}
    <div class="row-btns" style="margin-bottom:12px"><label class="btn primary">${icon('camera')} Zrzut ligi<input type="file" accept="image/*" multiple hidden id="shot"></label><button class="btn ghost" id="editTable">Tabela i siła drużyn</button></div>
    <p class="hint" id="st"></p>
    ${table ? html`<h3 class="section-title">Tabela${lg.tableAt ? ` (${fmtDate(lg.tableAt)})` : ''}</h3><section class="card" style="padding:4px 16px">
      <div class="hist-row"><b>#</b><span class="tnum"><b>mecze · pkt</b></span></div>
      ${table.map((t, i) => html`<div class="hist-row" style="${t.name === ourName ? 'font-weight:700' : ''}"><span>${i + 1}. ${t.name}${i === 0 ? ' ' : ''}${i >= 6 ? ' ↓' : i >= 4 ? ' ⇅' : ''}</span><span class="tnum">${t.played ?? '–'} · <b>${t.points ?? '–'}</b></span></div>`)}
    </section>` : ''}
    ${projectionSection(proj)}
    <h3 class="section-title">Terminarz</h3>
    <section class="card tight"><ul class="list">${rounds.map((r) => {
      const m = leagueMatch(lg, r);
      const d = m ? new Date(m.date) : roundDate(lg, r);
      const op = m ? opponentOf(m, team) : null;
      const res = m ? resultFor(m, team) : null;
      return html`<li><button class="item" data-round="${r}">
        <span class="lead-ic" style="font-weight:800">${r}</span>
        <span class="item-main"><span class="item-title">${op && op.name !== 'rywal ?' ? `${op.home ? 'vs' : '@'} ${op.name}` : 'rywal ?'}</span><span class="item-sub">${fmtDate(d.toISOString(), true)}${op ? (op.home ? ' · u siebie' : ' · wyjazd') : ''}</span></span>
        <span class="item-end">${res ? html`<b class="${res.letter === 'W' ? 'good' : res.letter === 'P' ? 'bad' : ''}">${res.us}:${res.them}</b>` : m && matchState(m) === 'needsResult' ? chip('wynik?', 'warn') : ''}</span></button></li>`;
    })}</ul></section>
    <p class="hint">Dotknij kolejki, żeby wpisać rywala. Mecz trafi do listy meczów, więc Start i Skład od razu go zobaczą. ⇅ baraż, ↓ spadek.</p>
    <button class="btn ghost block" id="setup">${icon('settings')} Drużyny w lidze i start sezonu</button>`);

  el.querySelector('#shot').onchange = (e) => fromShots([...e.target.files], el.querySelector('#st'), app);
  el.querySelector('#editTable').onclick = () => editTable(app);
  el.querySelector('#setup').onclick = () => setup(app);
  el.querySelectorAll('[data-round]').forEach((b) => (b.onclick = () => editRound(Number(b.dataset.round), app)));
}

function editRound(r, app) {
  const lg = state.league;
  const team = teamName();
  const ourName = bestName(team, lg.teams) ?? team;
  const m = leagueMatch(lg, r);
  const o = m ? opponentOf(m, team) : { home: true, name: '' };
  const d = m ? new Date(m.date) : roundDate(lg, r);
  const local = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const body = openSheet(html`
    <label class="field"><span>Rywal</span><select id="opp"><option value="">—</option>${lg.teams.filter((t) => t !== ourName).map((t) => html`<option ${bestName(o.name, [t]) ? 'selected' : ''}>${t}</option>`)}</select></label>
    <div class="seg"><button data-h="1" class="${o.home ? 'on' : ''}">U siebie</button><button data-h="0" class="${o.home ? '' : 'on'}">Na wyjeździe</button></div>
    <label class="field"><span>Data i godzina</span><input id="dt" type="datetime-local" value="${local(d)}"></label>
    <button class="btn primary block" id="ok">Zapisz</button>
    ${m ? html`<a class="btn ghost block" style="margin-top:8px" href="#/wiecej/mecze/${encodeURIComponent(matchId(m))}">Wynik, oceny, rywal →</a>` : ''}`, { title: `Kolejka ${r}` });
  let home = o.home;
  body.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { home = b.dataset.h === '1'; body.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b)); }));
  body.querySelector('#ok').onclick = async () => {
    const opp = body.querySelector('#opp').value;
    if (!opp) return toast('Wybierz rywala', 'bad');
    const date = body.querySelector('#dt').value;
    const next = { ...(m ?? { status: 'UPCOMING' }), date: date.length === 16 ? date + ':00' : date, homeTeamName: home ? team : opp, awayTeamName: home ? opp : team, competition: `Liga ${lg.name}`, round: r };
    try { await upsertMatch(next); closeSheet(); toast('Zapisano', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

async function fromShots(files, st, app) {
  if (!files.length) return;
  const lg = state.league;
  const team = teamName();
  const ourName = bestName(team, lg.teams) ?? team;
  let tableRows = 0, added = 0;
  try {
    for (const [i, f] of files.entries()) {
      st.textContent = `Czytam zrzut ${i + 1} z ${files.length}…`;
      const res = parseLeague(await ocrLines(f), lg.teams);
      const withNums = res.table.filter((t) => t.points != null);
      if (withNums.length >= 4) {
        const old = new Map((lg.table ?? lg.teams.map((n) => ({ name: n, played: null, points: null }))).map((t) => [t.name, t]));
        for (const t of withNums) old.set(t.name, { name: t.name, played: t.played, points: t.points });
        lg.table = [...old.values()];
        lg.tableAt = new Date().toISOString();
        tableRows += withNums.length;
      }
      for (const fx of res.fixtures) {
        if (fx.home !== ourName && fx.away !== ourName) continue;
        const r = fx.date ? Math.round((new Date(fx.date) - new Date(lg.seasonStart)) / WEEK) + 1 : null;
        if (!r || r < 1 || r > lg.rounds) continue;
        const m = leagueMatch(lg, r);
        const home = fx.home === ourName;
        const next = { ...(m ?? { status: 'UPCOMING', date: fx.date }), homeTeamName: home ? team : fx.home, awayTeamName: home ? fx.away : team, competition: `Liga ${lg.name}`, round: r };
        if (fx.homeGoals != null && (next.homeGoals == null)) { next.homeGoals = fx.homeGoals; next.awayGoals = fx.awayGoals; next.status = 'FINISHED'; }
        await upsertMatch(next);
        added++;
      }
    }
    if (tableRows) await save('league');
    st.textContent = tableRows || added ? `Tabela: ${tableRows} drużyn, terminarz: ${added} meczów.` : 'Nie znalazłem tabeli ani meczów. Zrób zrzut „Aktualna tabela” albo „Kalendarz spotkań” z HT.';
    if (tableRows || added) { toast('Liga zaktualizowana', 'good'); app.render(); }
  } catch (e) { st.textContent = e.message; }
}

function editTable(app) {
  const lg = state.league;
  const rowsNow = lg.table ?? lg.teams.map((n) => ({ name: n, played: null, points: null }));
  const st = lg.strength ?? {};
  const LV = [[1, 'bardzo słaba'], [2, 'słaba'], [3, 'średnia'], [4, 'mocna'], [5, 'bardzo mocna']];
  const body = openSheet(html`<p class="lead">Mecze i punkty z tabeli w HT oraz Twoja ocena siły (liczy się do prognozy, najbardziej na początku sezonu).</p>
    ${rowsNow.map((t, i) => html`<h3 class="section-title" style="margin-top:14px">${t.name}</h3><div class="grid2" style="grid-template-columns:1fr 1fr 1.4fr"><label class="field"><span>mecze</span><input type="number" inputmode="numeric" data-pl="${i}" value="${t.played ?? ''}"></label><label class="field"><span>punkty</span><input type="number" inputmode="numeric" data-pt="${i}" value="${t.points ?? ''}"></label><label class="field"><span>siła</span><select data-sv="${i}">${LV.map(([v, l]) => html`<option value="${v}" ${(st[t.name] ?? 3) === v ? 'selected' : ''}>${l}</option>`)}</select></label></div>`)}
    <button class="btn primary block" id="ok">Zapisz</button>`, { title: 'Tabela ligi' });
  body.querySelector('#ok').onclick = async () => {
    const anyNum = rowsNow.some((t, i) => body.querySelector(`[data-pt="${i}"]`).value !== '');
    if (anyNum) {
      lg.table = rowsNow.map((t, i) => ({ name: t.name, played: num(body.querySelector(`[data-pl="${i}"]`).value), points: num(body.querySelector(`[data-pt="${i}"]`).value) }));
      lg.tableAt = new Date().toISOString();
    }
    lg.strength = Object.fromEntries(rowsNow.map((t, i) => [t.name, Number(body.querySelector(`[data-sv="${i}"]`).value)]));
    try { await save('league'); closeSheet(); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}
const num = (v) => (v === '' ? null : Number(v));

function setup(app) {
  const lg = state.league;
  const local = (x) => new Date(new Date(x).getTime() - new Date(x).getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const body = openSheet(html`
    <label class="field"><span>Liga</span><input id="nm" value="${lg.name}"></label>
    <label class="field"><span>1. kolejka (data i godzina)</span><input id="st" type="datetime-local" value="${local(lg.seasonStart)}"></label>
    <label class="field"><span>Drużyny (jedna w linii, jak w HT)</span><textarea id="tm" class="input" rows="9">${lg.teams.join('\n')}</textarea></label>
    <button class="btn primary block" id="ok">Zapisz</button>`, { title: 'Liga' });
  body.querySelector('#ok').onclick = async () => {
    lg.name = body.querySelector('#nm').value.trim() || lg.name;
    const s = body.querySelector('#st').value;
    if (s) lg.seasonStart = s.length === 16 ? s + ':00' : s;
    const teams = body.querySelector('#tm').value.split('\n').map((x) => x.trim()).filter(Boolean);
    if (teams.length >= 2) {
      if (lg.table) lg.table = teams.map((n) => lg.table.find((t) => t.name === n) ?? { name: n, played: null, points: null });
      lg.teams = teams;
    }
    try { await save('league'); closeSheet(); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}
