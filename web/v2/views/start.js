// Start: najbliższy mecz, wyniki do wpisania, alerty, lista przed meczem, kasa, ostatnie zmiany.

import { html, raw, icon, str, toast, fmt1 } from '../ui.js';
import { state, teamName, savedLineup, players } from '../store.js';
import { nextMatch, pendingResults, opponentOf, buildAlerts, preMatchChecklist, fmtDate, relTime, fmtMoney, skillChanges, rosterChanges, fullName, matchId, youthVerdicts, youthPromotionAlerts } from '../logic.js';
import { currentLineup, prediction, forecast, spendable, startEdit, edit, bestXI } from '../compute.js';
import { saveResult } from '../actions.js';
import { leagueStatus } from './liga.js';

export async function render(el, { app }) {
  const team = teamName();
  const m = nextMatch(state.matches);
  if (m && edit.matchId !== matchId(m)) startEdit(m);
  const lu = currentLineup();
  const saved = savedLineup(m);
  const pred = m && lu ? prediction(lu, m) : null;
  const fc = forecast();

  app.setHeader({ title: 'Start', subtitle: `${team} · ${dataAge()}` });

  const parts = [];

  // --- najbliższy mecz ---
  if (m) {
    const o = opponentOf(m, team);
    parts.push(html`<section class="hero">
      <p class="hero-kicker">${m.competition || 'Najbliższy mecz'} · ${relTime(m.date)}</p>
      <h2 class="hero-title">${o.home ? 'vs' : '@'} ${o.name}</h2>
      <p class="hero-meta">${fmtDate(m.date, true)} · ${o.home ? 'u siebie' : 'na wyjeździe'}</p>
      <div class="stats" style="margin-top:14px">
        <div class="stat"><b>${pred?.sim ? Math.round(pred.sim.win) + '%' : '—'}</b><span>szansa wygranej</span></div>
        <div class="stat"><b>${pred ? Math.round(pred.hs) : '—'}</b><span>HatStats</span></div>
        <div class="stat"><b>${saved ? 'zapisany' : 'brak'}</b><span>skład</span></div>
      </div>
      <div class="row-btns"><a class="btn primary" href="#/sklad">${icon('pitch')} Ustaw skład</a><a class="btn ghost" href="#/wiecej/mecze/${encodeURIComponent(matchId(m))}">Rywal</a></div>
    </section>`);
  } else {
    parts.push(html`<section class="card"><h2>Brak zaplanowanego meczu</h2><p class="lead" style="margin-top:6px">Dodaj najbliższy mecz, żeby dostać listę przed meczem i prognozę.</p><a class="btn primary" href="#/wiecej/mecze?nowy=1">${icon('plus')} Dodaj mecz</a></section>`);
  }

  // --- wyniki do wpisania ---
  for (const pm of pendingResults(state.matches)) {
    const o = opponentOf(pm, team);
    parts.push(html`<section class="card" data-result="${matchId(pm)}">
      <div class="card-head"><h2>Wynik: ${o.name}</h2><span class="chip warn">${fmtDate(pm.date)}</span></div>
      <p class="small muted">${pm.competition || 'mecz'} · ${o.home ? 'u siebie' : 'na wyjeździe'} — wpisz, żeby mecz trafił do historii.</p>
      <div class="score-input"><input class="input" type="number" inputmode="numeric" min="0" max="30" aria-label="Gole ${team}" placeholder="–" data-us><span>:</span><input class="input" type="number" inputmode="numeric" min="0" max="30" aria-label="Gole ${o.name}" placeholder="–" data-them></div>
      <div class="row-btns"><button class="btn primary" data-save>Zapisz wynik</button><a class="btn ghost" href="#/wiecej/mecze/${encodeURIComponent(matchId(pm))}">Więcej</a></div>
    </section>`);
  }

  // --- liga ---
  const ls = leagueStatus();
  if (ls) {
    const tone = { promo: 'good', safe: '', playoff: 'warn', down: 'bad' }[ls.zone];
    parts.push(html`<a class="card" href="#/wiecej/liga" style="display:block;text-decoration:none"><div class="card-head"><h2>Liga ${state.league.name}</h2><span class="chip ${tone}">${ls.pos}. miejsce</span></div>
      <p class="small muted">${ls.points} pkt · ${ls.pos === 1 ? `przewaga ${ls.lead} pkt` : `${ls.toFirst} pkt do 1. miejsca`} · ${ls.left} kolejek do końca</p></a>`);
  } else {
    parts.push(html`<a class="alert info" href="#/wiecej/liga">${icon('info')}<span>Liga: wczytaj zrzut tabeli, a pokażę miejsce i ile brakuje do awansu</span></a>`);
  }

  // --- alerty ---
  const alerts = buildAlerts({ squad: state.squad, matches: state.matches, candidates: state.candidates, settings: state.settings, forecast: fc, savedLineups: state.lineups, team })
    .filter((a) => !a.text.startsWith('Wpisz wynik'));
  const yp = youthPromotionAlerts(state.youth.players ?? [], youthVerdicts(state.youth.players ?? [], players(), bestXI()), { fetchedAt: state.youth.fetchedAt });
  for (const y of yp) alerts.push({ tone: 'info', text: `Akademia: ${fullName(y.player)} ${y.days <= 0 ? 'może już awansować do seniorów' : `może awansować za ${y.days} ${y.days === 1 ? 'dzień' : 'dni'}`} (${y.verdict === 'promote' ? 'gotowy do składu' : 'duży potencjał'})`, route: '#/kadra/akademia' });
  if (alerts.length) {
    const ic = { warn: 'warn', bad: 'warn', info: 'info', muted: 'info' };
    parts.push(html`<h3 class="section-title">Do uwagi</h3>${alerts.map((a) => html`<a class="alert ${a.tone}" href="${a.route}">${icon(ic[a.tone])}<span>${a.text}</span></a>`)}`);
  }

  // --- lista przed meczem ---
  if (m && lu) {
    const c = preMatchChecklist({ match: m, saved, lineup: lu, players: players(), settings: state.settings, rival: pred?.opp });
    parts.push(html`<h3 class="section-title">Przed meczem</h3><section class="card">
      <div class="card-head"><h2>${c.done} z ${c.total} gotowe</h2><a class="link" href="#/sklad">Skład →</a></div>
      <div class="progress"><i style="width:${Math.round((100 * c.done) / c.total)}%"></i></div>
      ${c.items.map((i) => html`<div class="check ${i.ok === true ? 'ok' : i.ok === false ? 'no' : 'maybe'}"><span class="dot">${icon(i.ok === true ? 'check' : i.ok === false ? 'close' : 'info')}</span><span>${i.text}${i.hint ? html`<small>${i.hint}</small>` : ''}</span></div>`)}
    </section>`);
  }

  // --- kasa ---
  parts.push(html`<h3 class="section-title">Finanse</h3><a class="card" href="#/rynek/finanse" style="display:block;text-decoration:none">
    <div class="stats">
      <div class="stat"><b>${short(state.finance.cash)}</b><span>gotówka (${fmtDate(state.finance.at)})</span></div>
      <div class="stat"><b class="${fc.quietNet < 0 ? 'bad' : 'good'}">${short(fc.quietNet, true)}</b><span>tydzień na wyjeździe</span></div>
      <div class="stat"><b>${short(spendable())}</b><span>można wydać</span></div>
    </div></a>`);

  // --- ostatnie zmiany ---
  const h = state.history;
  if (h.length >= 2) {
    const prev = h[h.length - 2], curr = h[h.length - 1];
    const ch = skillChanges(prev, curr);
    const ro = rosterChanges(prev, curr);
    const real = ch.filter((c) => !c.suspicious);
    const sus = ch.filter((c) => c.suspicious);
    const rows = [
      ...real.map((c) => html`<div class="hist-row"><span>${c.name}</span><span>${c.label} ${c.from} → <b class="${c.diff > 0 ? 'good' : 'bad'}">${c.to}</b></span></div>`),
      ...ro.added.map((p) => html`<div class="hist-row"><span>${fullName(p)}</span><span class="chip good">nowy</span></div>`),
      ...ro.removed.map((p) => html`<div class="hist-row"><span>${fullName(p)}</span><span class="chip">odszedł</span></div>`),
    ];
    parts.push(html`<h3 class="section-title">Od poprzedniego importu (${fmtDate(prev.at)} → ${fmtDate(curr.at)})</h3><section class="card">
      ${rows.length ? rows.slice(0, 8) : html`<p class="muted">Bez zmian w umiejętnościach.</p>`}
      ${rows.length > 8 ? html`<p class="hint">…i ${rows.length - 8} więcej</p>` : ''}
      ${sus.length ? html`<p class="hint">${icon('warn')} ${sus.length} ${sus.length === 1 ? 'zmiana wygląda' : 'zmian wygląda'} na pomyłkę w danych (bez treningu w międzyczasie) — <a href="#/wiecej/historia">sprawdź</a>.</p>` : ''}
    </section>`);
  }

  el.innerHTML = str(raw(parts.map(str).join('')));

  for (const card of el.querySelectorAll('[data-result]')) {
    card.querySelector('[data-save]').onclick = async () => {
      const us = card.querySelector('[data-us]').value, them = card.querySelector('[data-them]').value;
      if (us === '' || them === '') return toast('Wpisz oba wyniki', 'bad');
      const pm = state.matches.find((x) => matchId(x) === card.dataset.result);
      try {
        await saveResult(pm, Number(us), Number(them));
        toast('Wynik zapisany', 'good');
        app.render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }
}

function dataAge() {
  const at = state.squad.fetchedAt;
  if (!at) return 'brak danych kadry';
  const days = Math.floor((Date.now() - new Date(at)) / 864e5);
  return days <= 0 ? 'dane z dziś' : days === 1 ? 'dane z wczoraj' : `dane sprzed ${days} dni`;
}

function short(n, signed = false) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = a >= 1e6 ? fmt1(a / 1e6) + ' mln' : a >= 1e3 ? Math.round(a / 1e3) + ' tys.' : String(Math.round(a));
  return (n < 0 ? '−' : signed && n > 0 ? '+' : '') + s;
}
export { short };
