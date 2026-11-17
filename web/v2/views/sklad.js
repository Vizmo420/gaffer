// Skład: boisko z najlepszą XI, zamiany dotknięciem, prognoza vs rywal, kapitan, stałe fragmenty, zmiany.

import { html, raw, icon, str, toast, openSheet, closeSheet, fmt1, fmt2, signed } from '../ui.js';
import { state, save, teamName, players, savedLineup } from '../store.js';
import { opponentOf, matchState, byDate, fmtDate, fullName, SLOT_SHORT, SLOT_NAME, alternativesFor, lineupToText, matchId, SKILLS } from '../logic.js';
import { edit, currentMatch, currentLineup, startEdit, prediction, opts, FORMATION_NAMES, applyVariant, rotationFor } from '../compute.js';
import { recommendCaptain, recommendSetPieceTaker, suggestSubs, isSuspended } from '../../optimizer.js';
import { assignSides, ratingLabel } from '../../ht-ratings.js';
import { openPlayer } from './kadra.js';

const SECTOR_PL = { midfield: 'Pomoc', defRight: 'Prawa obrona', defCentral: 'Środek obrony', defLeft: 'Lewa obrona', attRight: 'Prawy atak', attCentral: 'Środkowy atak', attLeft: 'Lewy atak' };
const MIRROR = { defLeft: 'attRight', defRight: 'attLeft', defCentral: 'attCentral', attLeft: 'defRight', attRight: 'defLeft', attCentral: 'defCentral', midfield: 'midfield' };

export async function render(el, { app }) {
  const team = teamName();
  const upcoming = state.matches.filter((m) => matchState(m) === 'upcoming').sort(byDate);
  const m = currentMatch();
  if (m && edit.matchId !== matchId(m)) startEdit(m);
  const lu = currentLineup();
  const saved = savedLineup(m);

  app.setHeader({
    title: 'Skład',
    subtitle: m ? `${opponentOf(m, team).home ? 'vs' : '@'} ${opponentOf(m, team).name} · ${fmtDate(m.date, true)}` : 'bez wybranego meczu',
    actions: html`<button class="icon-btn" id="copyLu" aria-label="Kopiuj skład jako tekst">${icon('copy')}</button>`,
  });

  if (!players().length) {
    el.innerHTML = str(html`<div class="empty">${icon('squad')}<p>Brak kadry. Zaimportuj dane w <a href="#/wiecej/import">Więcej → Import</a>.</p></div>`);
    return;
  }

  const pred = lu ? prediction(lu, m) : null;
  const locked = new Set(Object.keys(edit.locks).map(Number));
  const xiIds = lu ? lu.result.slots.map((s) => s.player?.id ?? null) : [];
  const xi = lu ? lu.result.slots.map((s) => s.player).filter(Boolean) : [];
  const caps = recommendCaptain(xi);
  const sps = recommendSetPieceTaker(xi);
  if (!edit.captainId || !xi.some((p) => p.id === edit.captainId)) edit.captainId = caps[0]?.player.id ?? null;
  if (!edit.setPiecesId || !xi.some((p) => p.id === edit.setPiecesId)) edit.setPiecesId = sps[0]?.player.id ?? null;
  const dirty = !saved || JSON.stringify(saved.playerIds) !== JSON.stringify(xiIds) || saved.captainId !== edit.captainId || saved.setPiecesId !== edit.setPiecesId || saved.tactic !== edit.tactic;

  const parts = [];
  if (upcoming.length > 1) {
    parts.push(html`<div class="chips" role="tablist" aria-label="Mecz">${upcoming.slice(0, 6).map((x) => html`<button data-match="${matchId(x)}" class="${matchId(x) === edit.matchId ? 'on' : ''}">${fmtDate(x.date)} ${opponentOf(x, team).name}</button>`)}</div>`);
  }
  parts.push(html`<div class="seg" role="tablist" aria-label="Wariant składu">
    <button data-variant="strong" class="${edit.variant !== 'rotation' ? 'on' : ''}">Najsilniejszy</button>
    <button data-variant="rotation" class="${edit.variant === 'rotation' ? 'on' : ''}">Trening rezerw</button>
  </div>`);
  parts.push(html`<div class="seg" role="tablist" aria-label="Formacja">
    <button data-form="auto" class="${edit.formation === 'auto' ? 'on' : ''}">Auto</button>
    ${FORMATION_NAMES.map((f) => html`<button data-form="${f}" class="${edit.formation === f ? 'on' : ''}">${f}</button>`)}
  </div>`);

  if (lu) {
    parts.push(pitch(lu, locked));
    parts.push(html`<div class="pitch-total"><span>${lu.name}${edit.formation === 'auto' ? ' (dobrana automatycznie)' : ''} · ${locked.size ? `${locked.size} ustawionych ręcznie` : 'optymalny'}</span><span>Σ <b>${fmt1(lu.result.total)}</b></span></div>`);
    parts.push(html`<div class="row-btns" style="margin:12px 0 4px">
      <button class="btn primary" id="saveLu" ${m ? '' : 'disabled'}>${icon('check')} ${saved && !dirty ? 'Zapisany' : 'Zapisz skład'}</button>
      ${locked.size ? html`<button class="btn ghost" id="reset">${icon('swap')} Optymalny</button>` : ''}
    </div>`);
    if (!m) parts.push(html`<p class="hint">Dodaj mecz w <a href="#/wiecej/mecze?nowy=1">Więcej → Mecze</a>, żeby zapisać skład.</p>`);
  } else {
    parts.push(html`<div class="card"><p>Za mało zdrowych zawodników, żeby ułożyć ${edit.formation}.</p></div>`);
  }

  // --- wariant treningowy: kto gra, kto odpoczywa ---
  if (lu && edit.variant === 'rotation') {
    const r = rotationFor();
    const strongPred = r && pred?.sim ? prediction(r.strong, m) : null;
    parts.push(html`<section class="card" style="margin-top:12px"><div class="card-head"><h2>Trening rezerw</h2>${strongPred ? html`<span class="small muted">najsilniejszy: ${Math.round(strongPred.sim.win)}% wygranej</span>` : ''}</div>
      ${r ? html`<p class="small"><b>Minuty na trenowanej pozycji (${state.settings.trainingType.toLowerCase()}):</b> ${r.getting.map(fullName).join(', ')}.</p>
      <p class="small" style="margin-top:6px"><b>Odpoczywają:</b> ${r.rested.map(fullName).join(', ')}.</p>
      <p class="hint">Bramka i obrona zostają najmocniejsze, żeby nie przegrać wysoko. Każdą pozycję możesz zmienić, dotykając zawodnika. Pamiętaj: odpoczywający potrenują tylko, jeśli zagrali w tym tygodniu w innym meczu.</p>` : html`<p class="small muted">Obecny trening (${state.settings.trainingType}) nie obejmuje żadnej pozycji w tej formacji.</p>`}
    </section>`);
  }

  // --- prognoza ---
  if (pred) {
    const rows = ['midfield', 'defRight', 'defCentral', 'defLeft', 'attRight', 'attCentral', 'attLeft'].map((k) => {
      const them = pred.opp ? pred.opp[MIRROR[k]] : null;
      const tone = them == null ? '' : pred.ours[k] - them >= 0.75 ? 'up' : them - pred.ours[k] >= 0.75 ? 'down' : '';
      return html`<tr class="${tone}"><td>${SECTOR_PL[k]}<br><small class="muted">${ratingLabel(pred.ours[k])}</small></td><td>${fmt2(pred.ours[k])}</td>${pred.opp ? html`<td>${fmt2(them)}</td>` : ''}</tr>`;
    });
    const best = pred.tactics[0];
    const cur = pred.tactics.find((t) => t.t === edit.tactic);
    parts.push(html`<h3 class="section-title">Prognoza</h3><section class="card">
      ${pred.sim ? html`
        <div class="card-head"><h2>Wygrana ${Math.round(pred.sim.win)}%</h2><span class="muted small">gole ${fmt1(pred.sim.goalsFor)} : ${fmt1(pred.sim.goalsAgainst)}</span></div>
        <div class="wdl"><div class="w" style="width:${pred.sim.win}%">${pred.sim.win >= 12 ? Math.round(pred.sim.win) + '%' : ''}</div><div class="d" style="width:${pred.sim.draw}%">${pred.sim.draw >= 12 ? Math.round(pred.sim.draw) + '%' : ''}</div><div class="l" style="width:${pred.sim.loss}%">${pred.sim.loss >= 12 ? Math.round(pred.sim.loss) + '%' : ''}</div></div>
        <p class="small muted">Najczęstsze wyniki: ${pred.sim.topScores.slice(0, 3).map((s) => `${s.score} (${Math.round(s.pct)}%)`).join(', ')} · posiadanie ${Math.round(pred.sim.possession)}%</p>
        <p class="small" style="margin-top:10px"><b>Taktyka</b></p>
        <div class="chips">${pred.tactics.map((t) => html`<button data-tactic="${t.t}" class="${t.t === edit.tactic ? 'on' : ''}">${t.label} ${Math.round(t.s.win)}%</button>`)}</div>
        ${edit.variant !== 'rotation' && pred.sim.win < 15 ? html`<p class="alert warn">${icon('warn')}<span>Szanse na wygraną są bardzo małe. Możesz dać ten mecz rezerwowym, żeby zebrali minuty na trening. <button class="link" data-variant="rotation" style="border:0;background:none;padding:0;font:inherit;font-weight:700;cursor:pointer">Ułóż skład treningowy →</button></span></p>` : ''}
        ${best && cur && best.t !== cur.t && best.s.win - cur.s.win >= 3 ? html`<p class="alert info">${icon('info')}<span>${best.label} daje ${Math.round(best.s.win)}% wygranych zamiast ${Math.round(cur.s.win)}%.</span></p>` : ''}
      ` : html`<div class="card-head"><h2>HatStats ${Math.round(pred.hs)}</h2>${m ? html`<a class="link" href="#/wiecej/mecze/${encodeURIComponent(matchId(m))}">Wpisz oceny rywala →</a>` : ''}</div>
        <p class="small muted">Bez ocen rywala pokazuję tylko nasze oceny sektorów.</p>`}
      <table class="sector-table" style="margin-top:10px"><thead><tr><th>Sektor</th><th>My</th>${pred.opp ? html`<th>Rywal</th>` : ''}</tr></thead><tbody>${rows}</tbody></table>
      <p class="hint">Model Schuma z Hattrick Organizer i symulacja akcji — szacunek, nie silnik HT.</p>
    </section>`);
  }

  // --- kapitan i stałe fragmenty ---
  if (lu) {
    const opt = (list, sel) => list.map((x) => html`<option value="${x.player.id}" ${x.player.id === sel ? 'selected' : ''}>${fullName(x.player)} (przyw. ${x.player.leadership ?? '?'}, dośw. ${x.player.experience ?? '?'}, SF ${x.player.setPieces ?? '?'})</option>`);
    parts.push(html`<h3 class="section-title">Role</h3><section class="card">
      <label class="field"><span>Kapitan (przywództwo + doświadczenie)</span><select id="cap">${opt(caps, edit.captainId)}</select></label>
      <label class="field" style="margin-bottom:0"><span>Stałe fragmenty</span><select id="sp">${opt(sps, edit.setPiecesId)}</select></label>
    </section>`);

    const bench = players().filter((p) => !xiIds.includes(p.id) && p.injuryLevel <= 0 && !isSuspended(p));
    const subs = suggestSubs(lu.result.slots, bench, opts()).filter((s) => s.in);
    if (subs.length) {
      parts.push(html`<h3 class="section-title">Zmiany w trakcie meczu</h3><section class="card">
        ${subs.map((s) => html`<div class="hist-row"><span>${s.out.lastName} <small class="muted">słabnie ok. ${s.outFade}'</small></span><span>→ ${s.in.lastName} <small class="muted">${SLOT_SHORT[s.slot]}</small></span></div>`)}
        <p class="hint">Najszybciej tracący siły (kondycja) i najlepszy zmiennik z ławki na tę pozycję.</p>
      </section>`);
    }
  }

  // --- opcje ---
  parts.push(html`<h3 class="section-title">Ustawienia składu</h3><section class="card">
    <label class="toggle"><span>Licz lojalność i wychowanków<br><small class="muted">bonus do umiejętności jak w HT</small></span><input type="checkbox" id="loy" ${state.settings.useLoyalty ? 'checked' : ''}></label>
    <label class="toggle"><span>Premia za trenowaną pozycję<br><small class="muted">woli zawodników, którzy na tej pozycji trenują (${state.settings.trainingType})</small></span><input type="checkbox" id="trb" ${state.settings.trainingBonus ? 'checked' : ''}></label>
  </section>`);

  el.innerHTML = str(raw(parts.map(str).join('')));

  // --- zdarzenia ---
  el.querySelectorAll('[data-match]').forEach((b) => (b.onclick = () => { startEdit(state.matches.find((x) => matchId(x) === b.dataset.match)); app.render(); }));
  el.querySelectorAll('[data-form]').forEach((b) => (b.onclick = () => { edit.formation = b.dataset.form; if (edit.variant === 'rotation') applyVariant('rotation'); else edit.locks = {}; app.render(); }));
  el.querySelectorAll('[data-variant]').forEach((b) => (b.onclick = () => { if (b.dataset.variant === edit.variant) return; applyVariant(b.dataset.variant); app.render(); }));
  el.querySelectorAll('[data-tactic]').forEach((b) => (b.onclick = () => { edit.tactic = b.dataset.tactic; app.render(); }));
  el.querySelectorAll('[data-slot]').forEach((b) => (b.onclick = () => openSlot(Number(b.dataset.slot), lu, app)));
  el.querySelector('#reset')?.addEventListener('click', () => { edit.locks = {}; edit.variant = 'strong'; app.render(); });
  el.querySelector('#cap')?.addEventListener('change', (e) => { edit.captainId = Number(e.target.value); app.render(); });
  el.querySelector('#sp')?.addEventListener('change', (e) => { edit.setPiecesId = Number(e.target.value); app.render(); });
  el.querySelector('#loy').onchange = async (e) => { state.settings.useLoyalty = e.target.checked; await save('settings').catch(() => {}); app.render(); };
  el.querySelector('#trb').onchange = async (e) => { state.settings.trainingBonus = e.target.checked; await save('settings').catch(() => {}); app.render(); };
  el.querySelector('#saveLu')?.addEventListener('click', async () => {
    // prognoza bez korekty — po meczu porównamy ją z ocenami z raportu
    const predicted = prediction(lu, m)?.raw ?? null;
    state.lineups[matchId(m)] = { formation: lu.name, slots: lu.slots, playerIds: xiIds, captainId: edit.captainId, setPiecesId: edit.setPiecesId, tactic: edit.tactic, variant: edit.variant, predicted, savedAt: new Date().toISOString() };
    if (edit.formation === 'auto') edit.formation = lu.name;
    lu.result.slots.forEach((s, i) => { if (s.player) edit.locks[i] = s.player.id; });
    try { await save('lineups'); toast('Skład zapisany', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  });
  document.querySelector('#copyLu').onclick = async () => {
    if (!lu) return;
    const byId = new Map(players().map((p) => [p.id, p]));
    const text = lineupToText(lu, { captain: byId.get(edit.captainId), setPieces: byId.get(edit.setPiecesId), match: m, team });
    try { await navigator.clipboard.writeText(text); toast('Skład skopiowany'); } catch { openSheet(html`<textarea class="input" rows="14" readonly>${text}</textarea>`, { title: 'Skład jako tekst' }); }
  };
}

function pitch(lu, locked) {
  const slots = lu.result.slots;
  const sides = assignSides(slots.map((s) => s.slot));
  const ORDER = { L: 0, M: 1, R: 2 };
  const rowOf = { FW: 0, WI: 1, IM: 1, WB: 2, CD: 2, GK: 3 };
  const rows = [[], [], [], []];
  slots.forEach((s, i) => rows[rowOf[s.slot]].push(i));
  const sortRow = (r) => r.sort((a, b) => ORDER[sides[a]] - ORDER[sides[b]] || a - b);
  const disc = (i) => {
    const s = slots[i], p = s.player;
    if (!p) return html`<button class="pl empty" data-slot="${i}"><span class="pl-disc">+</span><span class="pl-name">brak</span><span class="pl-pos">${SLOT_SHORT[s.slot]}</span></button>`;
    const formCls = p.form >= 7 ? 'f-high' : p.form <= 4 ? 'f-low' : '';
    return html`<button class="pl ${locked.has(i) ? 'locked' : ''}" data-slot="${i}" aria-label="${SLOT_NAME[s.slot]}: ${fullName(p)}, ocena ${fmt1(s.score)}">
      <span class="pl-disc ${formCls}">${fmt1(s.score)}</span>
      ${(p.yellowCards ?? 0) >= 2 ? raw('<span class="pl-flag card" title="2 kartki"></span>') : ''}
      <span class="pl-name">${p.lastName || p.firstName}</span><span class="pl-pos">${SLOT_SHORT[s.slot]}</span></button>`;
  };
  return html`<div class="pitch">${rows.filter((r) => r.length).map((r) => html`<div class="pitch-row">${sortRow(r).map(disc)}</div>`)}</div>`;
}

function openSlot(i, lu, app) {
  const s = lu.result.slots[i];
  const alts = alternativesFor(players(), lu, i, opts()).slice(0, 10);
  const p = s.player;
  const isLocked = edit.locks[i] != null;
  const top = p ? SKILLS.map(([k, l]) => ({ l, v: p[k] })).sort((a, b) => b.v - a.v).slice(0, 3) : [];
  const body = openSheet(html`
    ${p ? html`<div class="p-head"><span class="avatar pos-${s.slot}">${SLOT_SHORT[s.slot]}</span><div style="flex:1;min-width:0"><b>${fullName(p)}</b><div class="small muted">ocena ${fmt1(s.score)} · forma ${p.form} · kondycja ${p.stamina}</div><div class="small muted">${top.map((t) => `${t.l.toLowerCase()} ${t.v}`).join(' · ')}</div></div></div>
    <div class="row-btns" style="margin-bottom:14px"><button class="btn ghost small" id="lockBtn">${icon('lock')} ${isLocked ? 'Odblokuj' : 'Zostaw na tej pozycji'}</button><button class="btn ghost small" id="showP">Karta zawodnika</button></div>` : ''}
    <h3 class="section-title" style="margin-top:0">Kto zamiast</h3>
    ${alts.length ? alts.map((a) => html`<button class="alt-row" data-alt="${a.player.id}"><span class="avatar" style="width:40px;height:40px;font-size:13px">${fmt1(a.score)}</span><span class="item-main"><span class="item-title">${fullName(a.player)}</span><span class="item-sub">forma ${a.player.form} · ${a.player.age} l.${a.player.transferListed ? ' · na sprzedaż' : ''}</span></span><span class="diff ${a.diff >= 0 ? 'good' : 'bad'}">${signed(a.diff)}</span></button>`) : html`<p class="muted">Brak zdrowych zawodników poza składem.</p>`}
  `, { title: SLOT_NAME[s.slot] });
  body.querySelectorAll('[data-alt]').forEach((b) => (b.onclick = () => {
    if (edit.formation === 'auto') edit.formation = lu.name;
    edit.locks[i] = Number(b.dataset.alt);
    closeSheet();
    app.render();
  }));
  body.querySelector('#lockBtn')?.addEventListener('click', () => {
    if (edit.formation === 'auto') edit.formation = lu.name;
    if (isLocked) delete edit.locks[i]; else edit.locks[i] = p.id;
    closeSheet();
    app.render();
  });
  body.querySelector('#showP')?.addEventListener('click', () => openPlayer(p, app));
}
