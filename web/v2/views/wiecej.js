// Więcej: mecze (wyniki, rywal), trening, doradca AI, import, historia, ustawienia.

import { html, raw, icon, str, toast, openSheet, closeSheet, chip, md, fmt1, confirmSheet } from '../ui.js';
import { state, save, players, teamName, mergeImportedSquad, applyTheme } from '../store.js';
import {
  byDate, matchState, matchId, opponentOf, resultFor, fmtDate, relTime, fullName, SLOT_NAME, SLOT_SHORT, SKILLS,
  trainingPlan, compareTrainingTypes, skillChanges, rosterChanges, nextTrainingUpdate, minutesPlan,
} from '../logic.js';
import { currentLineup, aiContext, startEdit, calib } from '../compute.js';
import { ocrLines } from '../ocr.js';
import * as liga from './liga.js';
import * as analizy from './analizy.js';
import { parseMatchRatings, whichSide, nameScore } from '../parsers.js';
import { saveResult, upsertMatch, deleteMatch } from '../actions.js';
import { importText } from '../../csv-import.js';
import { TRAINING_TYPES } from '../../optimizer.js';
import { LEVEL_PL } from '../../ht-ratings.js';
import { notifySection, bindNotify } from './powiadomienia.js';

const PAGES = {
  mecze: { title: 'Mecze', icon: 'calendar', sub: 'wyniki, rywale, oceny', render: matches },
  liga: { title: 'Liga', icon: 'trophy', sub: 'tabela, terminarz, ile do awansu', render: (el, ctx) => liga.render(el, ctx) },
  trening: { title: 'Trening', icon: 'training', sub: 'kto trenuje i kiedy awans', render: training },
  ai: { title: 'Doradca AI', icon: 'spark', sub: 'plan i odpowiedzi na pytania', render: advisor },
  import: { title: 'Import danych', icon: 'upload', sub: 'CSV z Hattricka', render: importPage },
  historia: { title: 'Historia kadry', icon: 'history', sub: 'zmiany między importami', render: historyPage },
  analizy: { title: 'Analizy', icon: 'chart', sub: 'mapy umiejętności i ocen, ekonomia, wagi, raport', render: (el, ctx) => analizy.render(el, ctx) },
  ustawienia: { title: 'Ustawienia', icon: 'settings', sub: 'drużyna, wygląd', render: settingsPage },
};

export async function render(el, ctx) {
  const page = PAGES[ctx.parts[0]];
  if (page) {
    ctx.app.setHeader({ title: page.title, back: true });
    return page.render(el, ctx);
  }
  ctx.app.setHeader({ title: 'Więcej', subtitle: teamName() });
  el.innerHTML = str(html`<section class="card tight"><ul class="list">${Object.entries(PAGES).map(([k, p]) => html`<li><a class="item" href="#/wiecej/${k}"><span class="lead-ic">${icon(p.icon)}</span><span class="item-main"><span class="item-title">${p.title}</span><span class="item-sub">${p.sub}</span></span>${icon('chevron', 'chev')}</a></li>`)}</ul></section>
    <p class="hint" style="text-align:center">Gaffer v2 · dane na Pi · ${state.online ? 'połączono' : 'offline'}</p>`);
}

// ---------------- mecze ----------------

function matches(el, { parts, query, app }) {
  const team = teamName();
  if (parts[1]) return matchDetail(el, decodeURIComponent(parts[1]), app);
  const list = [...state.matches].sort(byDate);
  const up = list.filter((m) => matchState(m) !== 'done');
  const done = list.filter((m) => matchState(m) === 'done').reverse();
  const row = (m) => {
    const o = opponentOf(m, team), r = resultFor(m, team), st = matchState(m);
    return html`<li><a class="item" href="#/wiecej/mecze/${encodeURIComponent(matchId(m))}">
      <span class="lead-ic" style="font-weight:800;${r ? `color:var(--${r.letter === 'W' ? 'good' : r.letter === 'P' ? 'bad' : 'muted'})` : ''}">${r ? r.letter : o.home ? 'D' : 'W'}</span>
      <span class="item-main"><span class="item-title">${o.home ? 'vs' : '@'} ${o.name}</span><span class="item-sub">${fmtDate(m.date, true)}${m.competition ? ' · ' + m.competition : ''}</span></span>
      <span class="item-end">${r ? html`<b>${r.us}:${r.them}</b>` : st === 'needsResult' ? chip('wpisz wynik', 'warn') : html`<small>${relTime(m.date)}</small>`}</span></a></li>`;
  };
  el.innerHTML = str(html`<button class="btn primary block" id="add" style="margin-bottom:12px">${icon('plus')} Dodaj mecz</button>
    ${up.length ? html`<h3 class="section-title">Nadchodzące</h3><section class="card tight"><ul class="list">${up.map(row)}</ul></section>` : ''}
    ${done.length ? html`<h3 class="section-title">Rozegrane</h3><section class="card tight"><ul class="list">${done.map(row)}</ul></section>` : ''}
    <p class="hint">D = u siebie, W = wyjazd. Wyniki: W wygrana, R remis, P porażka.</p>`);
  el.querySelector('#add').onclick = () => editMatch(null, app);
  if (query.get('nowy')) editMatch(null, app);
}

function editMatch(m, app) {
  const team = teamName();
  const isNew = !m;
  const o = m ? opponentOf(m, team) : { home: true, name: '' };
  const d = m ? new Date(m.date) : new Date(Date.now() + 864e5);
  const local = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  const body = openSheet(html`
    <label class="field"><span>Rywal</span><input id="opp" value="${o.name === 'rywal' ? '' : o.name}" autocomplete="off"></label>
    <label class="field"><span>Data i godzina</span><input id="dt" type="datetime-local" value="${local(d)}"></label>
    <div class="seg"><button data-h="1" class="${o.home ? 'on' : ''}">U siebie</button><button data-h="0" class="${o.home ? '' : 'on'}">Na wyjeździe</button></div>
    <label class="field"><span>Rozgrywki</span><select id="comp">${['Liga', 'Puchar Polski', 'Sparing', 'Baraż', 'Inne'].map((c) => html`<option ${m?.competition?.startsWith(c) ? 'selected' : ''}>${c}</option>`)}</select></label>
    <button class="btn primary block" id="ok">${isNew ? 'Dodaj' : 'Zapisz'}</button>`, { title: isNew ? 'Nowy mecz' : 'Edytuj mecz' });
  let home = o.home;
  body.querySelectorAll('[data-h]').forEach((b) => (b.onclick = () => { home = b.dataset.h === '1'; body.querySelectorAll('[data-h]').forEach((x) => x.classList.toggle('on', x === b)); }));
  body.querySelector('#ok').onclick = async () => {
    const opp = body.querySelector('#opp').value.trim();
    if (!opp) return toast('Wpisz rywala', 'bad');
    const date = body.querySelector('#dt').value;
    const next = { ...(m ?? {}), date: date.length === 16 ? date + ':00' : date, homeTeamName: home ? team : opp, awayTeamName: home ? opp : team, competition: body.querySelector('#comp').value, status: m?.status ?? 'UPCOMING' };
    if (isNew) delete next.id;
    try { const saved = await upsertMatch(next); closeSheet(); app.go(`#/wiecej/mecze/${encodeURIComponent(matchId(saved))}`); } catch (e) { toast(e.message, 'bad'); }
  };
}

// Oceny HT jako lista „słowo – podpoziom” (1,00 … 20,75 co 0,25).
function ratingOptions(sel) {
  const SUB = ['bardzo niski', 'niski', 'wysoki', 'bardzo wysoki'];
  const out = [html`<option value="">—</option>`];
  for (let v = 1; v <= 20.75; v += 0.25) {
    const lvl = Math.floor(v), sub = Math.round((v - lvl) * 4);
    out.push(html`<option value="${v}" ${Number(sel) === v ? 'selected' : ''}>${LEVEL_PL[lvl]} – ${SUB[sub]} (${v.toFixed(2).replace('.', ',')})</option>`);
  }
  return out;
}

function matchDetail(el, id, app) {
  const team = teamName();
  const m = state.matches.find((x) => matchId(x) === id);
  if (!m) { el.innerHTML = str(html`<div class="empty"><p>Nie ma takiego meczu.</p></div>`); return; }
  const o = opponentOf(m, team), r = resultFor(m, team), st = matchState(m);
  const rv = m.rival ?? {};
  const SECT = [['midfield', 'Pomoc'], ['defRight', 'Prawa obrona'], ['defCentral', 'Środek obrony'], ['defLeft', 'Lewa obrona'], ['attRight', 'Prawy atak'], ['attCentral', 'Środkowy atak'], ['attLeft', 'Lewy atak']];
  const lineup = state.lineups[matchId(m)];
  const byId = new Map(players().map((p) => [p.id, p]));
  app.setHeader({ title: `${o.home ? 'vs' : '@'} ${o.name}`, subtitle: `${fmtDate(m.date, true)}${m.competition ? ' · ' + m.competition : ''}`, back: true });
  el.innerHTML = str(html`
    <section class="card">
      <div class="card-head"><h2>Wynik</h2>${r ? chip(r.letter === 'W' ? 'wygrana' : r.letter === 'P' ? 'porażka' : 'remis', r.letter === 'W' ? 'good' : r.letter === 'P' ? 'bad' : '') : st === 'needsResult' ? chip('czeka na wynik', 'warn') : chip(relTime(m.date))}</div>
      <div class="score-input"><input class="input" id="us" type="number" inputmode="numeric" min="0" placeholder="–" value="${r?.us ?? ''}" aria-label="Gole ${team}"><span>:</span><input class="input" id="them" type="number" inputmode="numeric" min="0" placeholder="–" value="${r?.them ?? ''}" aria-label="Gole rywala"></div>
      <p class="small muted" style="text-align:center;margin:-6px 0 12px">${team} : ${o.name}</p>
      ${lineup ? html`<p class="hint" style="margin-bottom:10px">Zawodnicy z zapisanego składu dostaną „grał w meczu ${fmtDate(m.date)}” (do śledzenia treningu).</p>` : ''}
      <button class="btn primary block" id="saveRes">Zapisz wynik</button>
    </section>
    ${lineup ? html`<h3 class="section-title">Zapisany skład (${lineup.formation})</h3><section class="card" style="padding:4px 16px">${lineup.playerIds.map((pid, i) => html`<div class="hist-row"><span class="muted">${SLOT_SHORT[lineup.slots[i]]}</span><span>${byId.get(pid) ? fullName(byId.get(pid)) : '—'}${pid === lineup.captainId ? ' (K)' : ''}</span></div>`)}</section>` : ''}
    <h3 class="section-title">Oceny rywala</h3>
    <section class="card">
      <p class="small muted" style="margin-bottom:10px">Oceny sektorów rywala z raportu jego ostatniego meczu (Hattrick → drużyna rywala → mecze → raport, sekcja „Oceny szczegółowe”). Na ich podstawie Skład pokaże szanse i najlepszą taktykę.</p>
      <label class="btn ghost block" style="margin-bottom:12px">${icon('camera')} Wczytaj ze zrzutu raportu<input type="file" accept="image/*" hidden id="rivShot"></label>
      ${SECT.map(([k, l]) => html`<label class="field"><span>${l}</span><select data-r="${k}">${ratingOptions(rv[k])}</select></label>`)}
      <label class="toggle"><span>Rywal grał ten mecz u siebie</span><input type="checkbox" id="wasHome" ${rv.wasHome ? 'checked' : ''}></label>
      <button class="btn primary block" id="saveRiv">Zapisz oceny</button>
    </section>
    ${ourSection(m, lineup)}
    <div class="row-btns"><button class="btn ghost" id="edit">Edytuj mecz</button>${st !== 'done' ? html`<a class="btn ghost" href="#/sklad" id="toLu">Ustaw skład</a>` : ''}<button class="btn danger" id="del">${icon('trash')} Usuń</button></div>`);

  el.querySelector('#saveRes').onclick = async () => {
    const us = el.querySelector('#us').value, them = el.querySelector('#them').value;
    if (us === '' || them === '') return toast('Wpisz oba wyniki', 'bad');
    try { await saveResult(m, Number(us), Number(them)); toast('Wynik zapisany', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
  el.querySelector('#saveRiv').onclick = async () => {
    const rival = { wasHome: el.querySelector('#wasHome').checked };
    el.querySelectorAll('[data-r]').forEach((s) => { if (s.value) rival[s.dataset.r] = Number(s.value); });
    try { await upsertMatch({ ...m, rival }); toast('Oceny rywala zapisane', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
  el.querySelector('#rivShot').onchange = (e) => readReport(e.target.files[0], 'rival', m, (rep, side) => {
    const r = rep[side].ratings;
    el.querySelectorAll('[data-r]').forEach((sel) => { if (r[sel.dataset.r] != null) sel.value = String(r[sel.dataset.r]); });
    el.querySelector('#wasHome').checked = side === 'home';
    toast(`Wczytano ${Object.keys(r).length} z 7 ocen — sprawdź i zapisz`, Object.keys(r).length === 7 ? 'good' : 'bad');
  });
  el.querySelector('#ourShot')?.addEventListener('change', (e) => readReport(e.target.files[0], 'ours', m, async (rep, side) => {
    const ours = rep[side].ratings;
    const other = side === 'home' ? 'away' : 'home';
    const patch = { ...m, ours, oursFromShot: true };
    // wynik z raportu: strona „my” → nasze gole
    if (rep.score && (m.homeGoals == null || m.awayGoals == null)) {
      const usG = rep.score[side], themG = rep.score[other];
      const home = opponentOf(m, team).home;
      patch.homeGoals = home ? usG : themG; patch.awayGoals = home ? themG : usG; patch.status = 'FINISHED';
    }
    try { await upsertMatch(patch); toast('Oceny z raportu zapisane', 'good'); app.render(); } catch (err) { toast(err.message, 'bad'); }
  }));
  el.querySelector('#saveOurs')?.addEventListener('click', async () => {
    const ours = {};
    el.querySelectorAll('[data-o]').forEach((s2) => { if (s2.value) ours[s2.dataset.o] = Number(s2.value); });
    try { await upsertMatch({ ...m, ours }); toast('Zapisano', 'good'); app.render(); } catch (err) { toast(err.message, 'bad'); }
  });
  el.querySelector('#edit').onclick = () => editMatch(m, app);
  el.querySelector('#toLu')?.addEventListener('click', () => startEdit(m));
  el.querySelector('#del').onclick = async () => {
    if (!(await confirmSheet(`Usunąć mecz z ${o.name}?`, 'Usuń'))) return;
    try { await deleteMatch(m); app.go('#/wiecej/mecze'); } catch (e) { toast(e.message, 'bad'); }
  };
}

// Nasze oceny z raportu po meczu + porównanie z prognozą zapisaną razem ze składem.
const SECT_ALL = [['midfield', 'Pomoc'], ['defRight', 'Prawa obrona'], ['defCentral', 'Środek obrony'], ['defLeft', 'Lewa obrona'], ['attRight', 'Prawy atak'], ['attCentral', 'Środkowy atak'], ['attLeft', 'Lewy atak']];
function ourSection(m, lineup) {
  if (matchState(m) === 'upcoming') return '';
  const ours = m.ours ?? {};
  const pred = lineup?.predicted;
  const c = calib();
  const has = Object.keys(ours).length > 0;
  return html`<h3 class="section-title">Nasze oceny z raportu</h3><section class="card">
    <p class="small muted" style="margin-bottom:10px">Po meczu wczytaj raport (sekcja „Oceny szczegółowe”). ${pred ? 'Gaffer porówna je ze swoją prognozą i z czasem sam poprawi prognozy.' : 'Na ten mecz nie było zapisanego składu w v2, więc nie ma prognozy do porównania — oceny i tak się przydadzą.'}</p>
    <label class="btn ghost block" style="margin-bottom:12px">${icon('camera')} Wczytaj ze zrzutu raportu<input type="file" accept="image/*" hidden id="ourShot"></label>
    ${has && pred ? html`<div class="hist-row"><b>Sektor</b><span class="tnum"><b>prognoza → raport</b></span></div>${SECT_ALL.map(([k, l]) => {
      const d = ours[k] != null && pred[k] ? ours[k] - pred[k] : null;
      return html`<div class="hist-row"><span>${l}</span><span class="tnum">${pred[k] ? fmt2(pred[k]) : '—'} → <b>${ours[k] != null ? fmt2(ours[k]) : '—'}</b>${d != null ? html` <small class="${Math.abs(d) < 0.5 ? 'muted' : d > 0 ? 'good' : 'bad'}">${d > 0 ? '+' : ''}${fmt2(d)}</small>` : ''}</span></div>`;
    })}` : ''}
    <details style="margin-top:10px"><summary class="small">Wpisz albo popraw ręcznie</summary>
      ${SECT_ALL.map(([k, l]) => html`<label class="field"><span>${l}</span><select data-o="${k}">${ratingOptions(ours[k])}</select></label>`)}
      <button class="btn primary block" id="saveOurs">Zapisz nasze oceny</button>
    </details>
    <p class="hint">${c.n >= 2 ? `Korekta prognoz z ${c.n} meczów: ${SECT_ALL.filter(([k]) => Math.abs(c.factor[k] - 1) >= 0.03).map(([k, l]) => `${l.toLowerCase()} ×${fmt2(c.factor[k])}`).join(', ') || 'prognozy trafiają, bez poprawek'}.` : `Korekta prognoz włączy się po 2 meczach z prognozą i raportem (teraz: ${c.n}).`}</p>
  </section>`;
}

const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '—');

// Zrzut raportu → oceny jednej drużyny. purpose: 'rival' (rywal w jego meczu) albo 'ours'.
async function readReport(file, purpose, m, done) {
  if (!file) return;
  const team = teamName();
  const rivalName = opponentOf(m, team).name;
  const body = openSheet(html`<p class="lead" id="st">Czytam raport… (ok. 10 s)</p><div id="pick"></div>`, { title: 'Raport meczu' });
  try {
    const rep = parseMatchRatings(await ocrLines(file));
    if (!rep.found) { body.querySelector('#st').textContent = 'Nie znalazłem ocen sektorów. Zrób zrzut sekcji „Oceny szczegółowe” z raportu meczu.'; return; }
    let side = purpose === 'ours' ? whichSide(rep, team) : (() => {
      const h = nameScore(rep.home.name, rivalName), a = nameScore(rep.away.name, rivalName);
      return Math.max(h, a) >= 0.7 ? (h >= a ? 'home' : 'away') : null;
    })();
    const finish = (sd) => { closeSheet(); done(rep, sd); };
    if (side) return finish(side);
    body.querySelector('#st').textContent = `Odczytałem ${rep.found} z 7 sektorów. Która drużyna to ${purpose === 'ours' ? 'Twoja' : rivalName}?`;
    body.querySelector('#pick').innerHTML = str(html`<div class="row-btns"><button class="btn primary" data-side="home">${rep.home.name || 'gospodarze'} (lewa kolumna)</button><button class="btn primary" data-side="away">${rep.away.name || 'goście'} (prawa kolumna)</button></div>`);
    body.querySelectorAll('[data-side]').forEach((b) => (b.onclick = () => finish(b.dataset.side)));
  } catch (e) {
    body.querySelector('#st').textContent = e.message;
  }
}

// ---------------- trening ----------------

function training(el, { app }) {
  const s = state.settings;
  const cfg = { type: s.trainingType, ...s.trainingCfg };
  const lu = currentLineup();
  const slots = lu?.result.slots ?? [];
  const plan = trainingPlan(players(), slots, cfg);
  const trained = plan.filter((x) => x.coverage !== 'none' && x.weeks != null);
  const missing = plan.filter((x) => x.slot && x.coverage === 'none');
  const cmp = compareTrainingTypes(players(), slots, cfg).slice(0, 5);
  const nu = nextTrainingUpdate();
  const mp = minutesPlan({ players: players(), matches: state.matches, lineups: state.lineups, settings: s });
  el.innerHTML = str(html`
    <section class="card">
      <div class="card-head"><h2>${s.trainingType}</h2><span class="small muted">aktualizacja ${fmtDate(nu, true)}</span></div>
      <div class="grid2">
        <label class="field"><span>Typ treningu</span><select id="tt">${Object.keys(TRAINING_TYPES).map((t) => html`<option ${t === s.trainingType ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="field"><span>Intensywność %</span><input id="ti" type="number" inputmode="numeric" value="${s.trainingCfg.intensity}"></label>
        <label class="field"><span>Trener (poziom 1–7)</span><input id="tc" type="number" inputmode="numeric" min="1" max="7" value="${s.trainingCfg.coachLevel}"></label>
        <label class="field"><span>Asystenci (suma poziomów)</span><input id="ta" type="number" inputmode="numeric" min="0" max="10" value="${s.trainingCfg.assistants}"></label>
      </div>
      <button class="btn primary block" id="saveT">Zapisz</button>
    </section>
    ${minutesSection(mp, s.trainingType)}
    <h3 class="section-title">Trenują teraz (skład ${lu?.name ?? '—'})</h3>
    <section class="card tight">${trained.length ? html`<ul class="list">${trained.map((x) => html`<li class="item" style="cursor:default">
      <span class="avatar pos-${x.slot}" style="width:40px;height:40px;border-radius:12px;font-size:12px">${SLOT_SHORT[x.slot]}</span>
      <span class="item-main"><span class="item-title">${fullName(x.player)}</span><span class="item-sub">${x.level} → ${x.nextLevel}${x.after13 != null ? ` · za 13 tyg. ok. ${fmt1(x.after13)}` : ''}${x.coverage === 'partial' ? ' · trening częściowy' : ''}</span></span>
      <span class="item-end"><b>${fmt1(x.weeks)}</b><small>tyg. do awansu</small></span></li>`)}</ul>` : html`<p class="empty">Nikt w składzie nie gra na pozycji, którą trenuje ${s.trainingType.toLowerCase()}.</p>`}</section>
    ${missing.length ? html`<h3 class="section-title">W składzie, ale bez treningu</h3><section class="card"><p>${missing.map((x) => `${fullName(x.player)} (${SLOT_SHORT[x.slot]})`).join(', ')}</p><p class="hint">${s.trainingType} nie działa na ich pozycje. To normalne dla obrońców i bramkarza przy treningu pomocników.</p></section>` : ''}
    <h3 class="section-title">Który trening da najwięcej obecnej XI</h3>
    <section class="card" style="padding:4px 16px">${cmp.map((c) => html`<div class="hist-row"><span>${c.type}${c.type === s.trainingType ? ' ' : ''}${c.type === s.trainingType ? chip('obecny', 'accent') : ''}</span><span class="tnum">${c.trained} trenuje · ~${c.pops13} awansów / 13 tyg.</span></div>`)}</section>
    <p class="hint">Szacunek z modelu społeczności (wiek, poziom, trener, asystenci, intensywność). HT nie publikuje wzoru — traktuj jako kierunek, nie wyrok. Zawodnik trenuje tylko wtedy, gdy zagra w meczu na trenowanej pozycji.</p>`);
  el.querySelector('#saveT').onclick = async () => {
    s.trainingType = el.querySelector('#tt').value;
    s.trainingCfg = { ...s.trainingCfg, intensity: Number(el.querySelector('#ti').value) || 100, coachLevel: Number(el.querySelector('#tc').value) || 4, assistants: Number(el.querySelector('#ta').value) || 0 };
    try { await save('settings'); toast('Zapisano', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

// Kto w tym tygodniu treningowym dostanie minuty na trenowanej pozycji (wg zapisanych składów).
function minutesSection(mp, type) {
  const core = mp.rows.filter((r) => r.core || r.status === 'ok');
  const bench = mp.rows.filter((r) => !r.core && r.status !== 'ok');
  const miss = core.filter((r) => r.status === 'missing');
  const ok = core.filter((r) => r.status === 'ok');
  const row = (r) => html`<div class="check ${r.status === 'ok' ? 'ok' : r.status === 'missing' && r.core ? 'no' : 'maybe'}"><span class="dot">${icon(r.status === 'ok' ? 'check' : r.status === 'missing' && r.core ? 'close' : 'info')}</span><span>${fullName(r.player)} <small class="muted">${SLOT_SHORT[r.slot]}</small>${r.status === 'ok' ? html`<small>gra ${fmtDate(r.match.date)} — trening zaliczony</small>` : r.hint ? html`<small>${r.hint}</small>` : ''}</span></div>`;
  return html`<h3 class="section-title">Minuty do ${fmtDate(mp.to.toISOString(), true)}</h3><section class="card">
    <div class="card-head"><h2>${ok.length} trenuje</h2>${miss.length ? chip(`${miss.length} z XI bez minut`, 'warn') : chip('XI trenuje', 'good')}</div>
    <p class="small muted">Mecze w tym tygodniu: ${mp.matches.length ? mp.matches.map((m) => `${fmtDate(m.date)} ${opponentOf(m, teamName()).name}${state.lineups[matchId(m)] ? '' : ' (skład niezapisany)'}`).join(', ') : 'brak'}.</p>
    ${core.map(row)}
    ${bench.length ? html`<details style="margin-top:8px"><summary class="small">Rezerwowi bez minut (${bench.length}) — trenują tylko, jeśli zagrają</summary>${bench.map(row)}</details>` : ''}
    <p class="hint">${type}: liczą się minuty na trenowanej pozycji we wszystkich meczach tygodnia (liga, puchar, sparing), łącznie do 90. Sparing to dobry sposób, żeby potrenowali rezerwowi i juniorzy.</p>
  </section>`;
}

// ---------------- doradca AI ----------------

let aiHistory = null;
async function advisor(el, { app }) {
  if (!aiHistory) {
    try { aiHistory = await (await fetch('/api/ai/history', { cache: 'no-store' })).json(); } catch { aiHistory = []; }
  }
  const last = aiHistory[0];
  el.innerHTML = str(html`
    <section class="card">
      <label class="field"><span>Pytanie (puste = pełny plan na tydzień)</span><textarea id="q" class="input" style="min-height:90px;font-family:inherit;font-size:16px" placeholder="np. Kogo wystawić na prawym skrzydle, jeśli Balov nie zagra?"></textarea></label>
      <div class="chips">${['Plan na ten tydzień', 'Kogo kupić za 1,5 mln?', 'Kogo sprzedać?', 'Jaka taktyka na najbliższy mecz?'].map((q) => html`<button data-q="${q}">${q}</button>`)}</div>
      <button class="btn primary block" id="ask">${icon('spark')} Zapytaj doradcę</button>
      <p class="hint">Doradca dostaje aktualną kadrę, skład, akademię, finanse i swoje 4 ostatnie odpowiedzi. Odpowiedź trwa do minuty.</p>
    </section>
    <div id="out">${last ? answer(last) : ''}</div>
    ${aiHistory.length > 1 ? html`<h3 class="section-title">Wcześniejsze</h3><section class="card tight"><ul class="list">${aiHistory.slice(1, 12).map((e) => html`<li><button class="item" data-ai="${e.id}"><span class="item-main"><span class="item-title">${e.question || 'Pełny plan'}</span><span class="item-sub">${new Date(e.at).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</span></span>${icon('chevron', 'chev')}</button></li>`)}</ul></section>` : ''}`);
  el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { el.querySelector('#q').value = b.dataset.q === 'Plan na ten tydzień' ? '' : b.dataset.q; }));
  el.querySelectorAll('[data-ai]').forEach((b) => (b.onclick = () => { const e = aiHistory.find((x) => x.id === b.dataset.ai); openSheet(answer(e, false), { title: e.question || 'Pełny plan', wide: true }); }));
  el.querySelector('#ask').onclick = async (ev) => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.classList.add('loading');
    el.querySelector('#out').innerHTML = str(html`<section class="card"><p class="muted">Doradca analizuje drużynę…</p></section>`);
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: aiContext(), question: el.querySelector('#q').value.trim() }) });
      const body = await r.json().catch(() => ({ error: 'Doradca działa tylko na Pi.' }));
      if (!r.ok || body.error) throw new Error(body.error || `HTTP ${r.status}`);
      aiHistory = [body, ...aiHistory];
      app.render();
    } catch (e) {
      el.querySelector('#out').innerHTML = str(html`<section class="card"><p class="bad">${e.message}</p></section>`);
      btn.disabled = false; btn.classList.remove('loading');
    }
  };
}

const answer = (e, card = true) => {
  const inner = html`<p class="small muted">${new Date(e.at).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' })}${e.question ? ` · „${e.question}”` : ' · pełny plan'}</p><div class="ai-out">${md(e.text)}</div>`;
  return card ? html`<section class="card">${inner}</section>` : inner;
};

// ---------------- import ----------------

function importPage(el, { app }) {
  el.innerHTML = str(html`
    <section class="card">
      <h2>Eksport CSV z Hattricka</h2>
      <p class="lead" style="margin-top:6px">Na komputerze: Hattrick → Zawodnicy → eksport do CSV (seniorzy i akademia). Przeciągnij plik tutaj albo wklej jego treść. Rodzaj (seniorzy/juniorzy) rozpoznam sam.</p>
      <label class="drop" id="drop">${icon('upload')}<br>Wybierz plik CSV albo upuść go tutaj<input type="file" accept=".csv,text/csv,text/plain" hidden id="file"></label>
      <label class="field" style="margin-top:12px"><span>…albo wklej</span><textarea id="txt" placeholder="Narodowość,Numer na koszulce,Imię i nazwisko,…"></textarea></label>
      <button class="btn primary block" id="go">Importuj</button>
      <div id="res"></div>
    </section>
    <section class="card">
      <h2>Pojedynczy zawodnik ze zrzutu</h2>
      <p class="lead" style="margin-top:6px">Zmiana jednego zawodnika (np. po transferze) bez pełnego eksportu: Kadra → ikona aparatu. Kandydaci do kupna: Rynek → Ze zrzutu.</p>
      <a class="btn ghost block" href="#/kadra">Przejdź do kadry</a>
    </section>`);
  const run = async (text) => {
    const res = el.querySelector('#res');
    try {
      const out = importText(text);
      if (!out.senior && !out.youth) throw new Error('Nie rozpoznałem CSV kadry ani akademii (sprawdź nagłówek).');
      const msgs = [];
      if (out.senior) {
        const before = { at: state.squad.fetchedAt, players: players() };
        state.squad = mergeImportedSquad(out.senior);
        await save('squad');
        const ch = skillChanges(before, { at: state.squad.fetchedAt, players: state.squad.players });
        const ro = rosterChanges(before, state.squad);
        msgs.push(`Seniorzy: ${state.squad.players.length} (nowi ${ro.added.length}, odeszli ${ro.removed.length}, zmian umiejętności ${ch.length}${ch.some((c) => c.suspicious) ? `, w tym ${ch.filter((c) => c.suspicious).length} podejrzanych` : ''}).`);
      }
      if (out.youth) {
        state.youth = { ...state.youth, ...out.youth, teamName: state.youth.teamName ?? out.youth.teamName, fetchedAt: new Date().toISOString() };
        await save('youth');
        msgs.push(`Akademia: ${state.youth.players.length} juniorów.`);
      }
      res.innerHTML = str(html`<p class="alert info" style="margin-top:12px">${icon('check')}<span>${msgs.join(' ')}</span></p>`);
      toast('Zaimportowano', 'good');
    } catch (e) {
      res.innerHTML = str(html`<p class="alert bad" style="margin-top:12px">${icon('warn')}<span>${e.message}</span></p>`);
    }
  };
  const readFile = (f) => f && f.text().then(run);
  el.querySelector('#file').onchange = (e) => readFile(e.target.files[0]);
  el.querySelector('#go').onclick = () => { const t = el.querySelector('#txt').value; if (t.trim()) run(t); else toast('Wklej treść CSV albo wybierz plik', 'bad'); };
  const drop = el.querySelector('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0]); };
}

// ---------------- historia ----------------

function historyPage(el) {
  const h = state.history;
  if (h.length < 2) { el.innerHTML = str(html`<div class="empty">${icon('history')}<p>Historia pojawi się po drugim imporcie.</p></div>`); return; }
  const blocks = [];
  for (let i = h.length - 1; i >= 1; i--) {
    const prev = h[i - 1], curr = h[i];
    const ch = skillChanges(prev, curr), ro = rosterChanges(prev, curr);
    blocks.push(html`<h3 class="section-title">${fmtDate(prev.at)} → ${fmtDate(curr.at)}</h3><section class="card" style="padding:4px 16px">
      ${ch.map((c) => html`<div class="hist-row"><span>${c.name}${c.suspicious ? html` ${chip('pomyłka w danych?', 'warn')}` : ''}</span><span class="tnum">${c.label.toLowerCase()} ${c.from} → <b class="${c.diff > 0 ? 'good' : 'bad'}">${c.to}</b></span></div>`)}
      ${ro.added.map((p) => html`<div class="hist-row"><span>${fullName(p)}</span>${chip('doszedł', 'good')}</div>`)}
      ${ro.removed.map((p) => html`<div class="hist-row"><span>${fullName(p)}</span>${chip('odszedł')}</div>`)}
      ${!ch.length && !ro.added.length && !ro.removed.length ? html`<p class="muted" style="padding:8px 0">Bez zmian.</p>` : ''}
    </section>`);
  }
  el.innerHTML = str(html`<p class="lead">„Pomyłka w danych?” = zmiana bez aktualizacji treningu w międzyczasie (trening jest w piątki o 2:30) albo większa niż liczba treningów. Zwykle to błąd przy przepisywaniu — sprawdź w HT i popraw w karcie zawodnika.</p>${blocks}`);
}

// ---------------- ustawienia ----------------

async function settingsPage(el, { app }) {
  const notify = await notifySection();
  const s = state.settings;
  const SPIRIT = Array.from({ length: 11 }, (_, i) => (i === 5 ? '5 — spokojni' : String(i)));
  const CONF = Array.from({ length: 10 }, (_, i) => (i === 9 ? '9 — niemożliwie przesadzona' : String(i)));
  el.innerHTML = str(html`
    <section class="card">
      <label class="field"><span>Nazwa drużyny (jak w HT)</span><input id="tn" value="${s.teamName}"></label>
      <label class="field"><span>Domyślna formacja</span><select id="fm">${['3-5-2', '4-4-2', '5-3-2', '4-5-1', '4-3-3'].map((f) => html`<option ${f === s.formation ? 'selected' : ''}>${f}</option>`)}</select></label>
      <div class="grid2">
        <label class="field"><span>Nastrój drużyny</span><select id="sp">${SPIRIT.map((t, i) => html`<option value="${i}" ${Number(s.spirit) === i ? 'selected' : ''}>${t}</option>`)}</select></label>
        <label class="field"><span>Pewność siebie</span><select id="cf">${CONF.map((t, i) => html`<option value="${i}" ${Number(s.confidence) === i ? 'selected' : ''}>${t}</option>`)}</select></label>
      </div>
      <p class="hint" style="margin:-4px 0 12px">Skala jak w HT: nastrój 0–10, pewność siebie 0–9. Wpływają na prognozę (pomoc i atak).</p>
      <label class="field"><span>Wygląd</span><select id="th">${[['auto', 'Jak w telefonie'], ['dark', 'Ciemny'], ['light', 'Jasny']].map(([v, l]) => html`<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`)}</select></label>
      <button class="btn primary block" id="ok">Zapisz</button>
    </section>
    ${notify}
    <section class="card"><h2>Dane</h2><p class="lead" style="margin-top:6px">Wszystko zapisuje się na Pi (folder data/). Przed każdą zmianą robię kopię poprzedniej wersji (20 ostatnich w data/backup/).</p></section>`);
  bindNotify(el);
  el.querySelector('#th').onchange = (e) => { s.theme = e.target.value; applyTheme(); };
  el.querySelector('#ok').onclick = async () => {
    s.teamName = el.querySelector('#tn').value.trim() || s.teamName;
    s.formation = el.querySelector('#fm').value;
    s.spirit = Number(el.querySelector('#sp').value);
    s.confidence = Number(el.querySelector('#cf').value);
    s.theme = el.querySelector('#th').value;
    try { await save('settings'); toast('Zapisano', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}
