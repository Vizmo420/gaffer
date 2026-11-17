// Analizy (dawne zakładki v1): mapa umiejętności, mapa ocen, ekonomia, wagi pozycji, raport tekstowy.

import { html, raw, icon, str, toast, openSheet, chip, fmt1, fmt2, int, skillTone } from '../ui.js';
import { state, save, players, teamName, weeklyWages } from '../store.js';
import { SKILLS, SLOT_NAME, SLOT_SHORT, fullName, bestSlots, skillChanges, fmtMoney, fmtDate } from '../logic.js';
import { bestXI, opts, prediction, currentMatch, invalidateBest } from '../compute.js';
import { DEFAULT_WEIGHTS, setWeights, resetWeights, POSITION_LABEL, recommendCaptain, recommendSetPieceTaker, loyaltyBonus, isSuspended } from '../../optimizer.js';
import { ratingLabel } from '../../ht-ratings.js';

const ui = { tab: 'umiejetnosci' };
const TABS = [['umiejetnosci', 'Umiejętności'], ['oceny', 'Oceny'], ['ekonomia', 'Ekonomia'], ['wagi', 'Wagi'], ['raport', 'Raport']];
const SHORT = { keeper: 'BR', defending: 'OB', playmaking: 'RO', winger: 'DO', passing: 'PO', scoring: 'SK', setPieces: 'SF' };

export function render(el, { parts, app }) {
  if (TABS.some(([k]) => k === parts[1])) ui.tab = parts[1];
  const body = { umiejetnosci: skillMap, oceny: ratingMap, ekonomia: economy, wagi: weights, raport: report }[ui.tab]();
  el.innerHTML = str(html`<div class="chips">${TABS.map(([k, l]) => html`<button data-tab="${k}" class="${ui.tab === k ? 'on' : ''}">${l}</button>`)}</div>${body}`);
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => app.go(`#/wiecej/analizy/${b.dataset.tab}`)));
  if (ui.tab === 'wagi') bindWeights(el, app);
  if (ui.tab === 'raport') el.querySelector('#copy').onclick = async () => {
    const t = el.querySelector('#rep').value;
    try { await navigator.clipboard.writeText(t); toast('Raport skopiowany'); } catch { el.querySelector('#rep').select(); toast('Zaznaczono — skopiuj ręcznie'); }
  };
  el.querySelectorAll('[data-sortmap]').forEach((b) => (b.onclick = () => { ui.mapSort = b.dataset.sortmap; app.render(); }));
}

// ---------------- mapa umiejętności ----------------
function skillMap() {
  const o = opts();
  const sortKey = ui.mapSort ?? 'pos';
  const ORDER = { GK: 0, CD: 1, WB: 2, WI: 3, IM: 4, FW: 5 };
  const rows = players().map((p) => ({ p, best: bestSlots(p, o, 1)[0] }));
  rows.sort((a, b) => (sortKey === 'pos' ? ORDER[a.best?.slot] - ORDER[b.best?.slot] || b.best.score - a.best.score : (b.p[sortKey] ?? 0) - (a.p[sortKey] ?? 0)));
  return html`<section class="card tight" style="overflow-x:auto"><table class="map">
    <thead><tr><th class="nm"><button data-sortmap="pos">Zawodnik</button></th>${SKILLS.map(([k, l]) => html`<th title="${l}"><button data-sortmap="${k}" class="${sortKey === k ? 'on' : ''}">${SHORT[k]}</button></th>`)}<th><button data-sortmap="form">Fm</button></th><th><button data-sortmap="stamina">Kd</button></th></tr></thead>
    <tbody>${rows.map(({ p, best }) => {
      const vals = SKILLS.map(([k]) => p[k] ?? 0);
      const top = [...vals].sort((a, b) => b - a).slice(0, 2);
      const loy = state.settings.useLoyalty ? loyaltyBonus(p) : 0;
      return html`<tr><td class="nm">${p.lastName} <small class="muted">${SLOT_SHORT[best?.slot] ?? ''}</small></td>${SKILLS.map(([k]) => {
        const v = p[k] ?? 0;
        return html`<td class="c ${skillTone(v)}${top.includes(v) && v >= 5 ? ' top' : ''}">${v}</td>`;
      })}<td class="c ${skillTone(p.form * 2)}">${p.form}</td><td class="c ${skillTone(p.stamina * 2)}">${p.stamina}</td></tr>`;
    })}</tbody></table></section>
    <p class="hint">BR bronienie, OB defensywa, RO rozgrywanie, DO dośrodkowania, PO podania, SK skuteczność, SF stałe fragmenty, Fm forma, Kd kondycja. Pogrubione = dwie najlepsze. Dotknij nagłówka, żeby posortować.${state.settings.useLoyalty ? ' Bonus lojalności liczy się w ocenach składu, tu widać czyste wartości.' : ''}</p>`;
}

// ---------------- mapa ocen (gwiazdki z meczów, z eksportu CSV) ----------------
function ratingMap() {
  const ps = players();
  const dates = [...new Set(ps.flatMap((p) => (p.recentRatings ?? []).map((r) => String(r.date).slice(0, 10))))].sort().reverse().slice(0, 8);
  if (!dates.length) return html`<div class="empty">${icon('history')}<p>Brak ocen z meczów. Pojawią się po imporcie CSV (kolumna z ostatnią oceną).</p></div>`;
  const rows = ps.map((p) => {
    const by = new Map((p.recentRatings ?? []).map((r) => [String(r.date).slice(0, 10), r]));
    const vals = [...by.values()].map((r) => r.stars).filter(Number.isFinite);
    return { p, by, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  }).filter((r) => r.avg != null).sort((a, b) => b.avg - a.avg);
  return html`<section class="card tight" style="overflow-x:auto"><table class="map">
    <thead><tr><th class="nm">Zawodnik</th>${dates.map((d) => html`<th>${fmtDate(d)}</th>`)}<th>Śr.</th></tr></thead>
    <tbody>${rows.map(({ p, by, avg }) => html`<tr><td class="nm">${p.lastName}</td>${dates.map((d) => {
      const r = by.get(d);
      return html`<td class="c ${r ? skillTone(r.stars * 2) : ''}">${r ? html`${fmt1(r.stars)}<small>${SLOT_SHORT[r.slot] ?? ''}</small>` : '·'}</td>`;
    })}<td class="c top">${fmt1(avg)}</td></tr>`)}</tbody></table></section>
    <p class="hint">Gwiazdki z ostatnich meczów (eksport CSV z HT pamięta tylko ostatnią ocenę zawodnika, więc mapa rośnie z każdym importem).</p>`;
}

// ---------------- ekonomia ----------------
function economy() {
  const ps = players();
  const xi = new Set((bestXI()?.result.slots ?? []).map((s) => s.player?.id));
  const wages = weeklyWages();
  const tsi = ps.reduce((a, p) => a + (p.tsi || 0), 0);
  const eff = [...ps].map((p) => ({ p, r: (p.tsi || 0) / Math.max(1, p.salary || 0) })).sort((a, b) => b.r - a.r);
  const ballast = ps.filter((p) => !xi.has(p.id))
    .map((p) => ({ p, score: (p.salary || 0) / 1000 + Math.max(0, (p.age ?? 25) - 28) * 3 + (p.lastMatchDate ? Math.min(10, (Date.now() - new Date(p.lastMatchDate)) / 6048e5) : 4) }))
    .sort((a, b) => b.score - a.score).slice(0, 5);
  const BUCKETS = [[17, 20], [21, 24], [25, 28], [29, 32], [33, 45]];
  const pyr = BUCKETS.map(([a, b]) => ({ l: b >= 45 ? `${a}+` : `${a}–${b}`, n: ps.filter((p) => p.age >= a && p.age <= b).length }));
  const maxN = Math.max(1, ...pyr.map((x) => x.n));
  return html`<section class="card"><div class="stats">
      <div class="stat"><b>${short(wages)}</b><span>pensje / tydz.</span></div>
      <div class="stat"><b>${short(tsi)}</b><span>suma TSI</span></div>
      <div class="stat"><b>${fmt1(tsi / Math.max(1, wages))}</b><span>TSI za 1 zł</span></div></div></section>
    <h3 class="section-title">Wiek kadry</h3><section class="card">${pyr.map((x) => html`<div class="hist-row"><span style="width:60px">${x.l}</span><span style="flex:1;margin:0 10px"><span class="bar"><i style="width:${Math.round((100 * x.n) / maxN)}%"></i></span></span><b class="tnum">${x.n}</b></div>`)}</section>
    <h3 class="section-title">Martwy balast (poza XI)</h3><section class="card" style="padding:4px 16px">${ballast.map(({ p }) => html`<div class="hist-row"><span>${fullName(p)} <small class="muted">${p.age} l.</small></span><span class="tnum">${fmtMoney(p.salary)}/tydz.</span></div>`)}
      <p class="hint">Wysoka pensja + wiek + dawno bez meczu, tylko spoza najlepszej XI. Pełna ocena: Rynek → Sprzedaż.</p></section>
    <h3 class="section-title">TSI za złotówkę pensji</h3><section class="card" style="padding:4px 16px">${eff.map(({ p, r }) => html`<div class="hist-row"><span>${fullName(p)}${xi.has(p.id) ? html` ${chip('XI', 'accent')}` : ''}</span><span class="tnum">${int(p.tsi)} / ${int(p.salary)} = <b>${fmt1(r)}</b></span></div>`)}</section>`;
}

// ---------------- wagi pozycji ----------------
function weights() {
  const w = state.settings.weights ?? DEFAULT_WEIGHTS;
  const LBL = Object.fromEntries(SKILLS);
  return html`<p class="lead">Jak bardzo każda umiejętność liczy się na pozycji w ocenie Gaffera (skład, sprzedaż, kandydaci). Domyślne są dobrym startem — zmieniaj, jeśli wiesz, że HT liczy inaczej.</p>
    ${Object.keys(DEFAULT_WEIGHTS).map((pos) => html`<h3 class="section-title">${POSITION_LABEL[pos]}</h3><section class="card">${Object.keys(DEFAULT_WEIGHTS[pos]).map((sk) => html`<label class="range"><span>${LBL[sk] ?? sk}</span><input type="range" min="0" max="1" step="0.02" data-w="${pos}.${sk}" value="${w[pos]?.[sk] ?? 0}"><output>${fmt2(w[pos]?.[sk] ?? 0)}</output></label>`)}</section>`)}
    <div class="row-btns"><button class="btn ghost" id="resetW">Przywróć domyślne</button><button class="btn primary" id="saveW">Zapisz wagi</button></div>`;
}
function bindWeights(el, app) {
  el.querySelectorAll('[data-w]').forEach((i) => (i.oninput = () => { i.nextElementSibling.textContent = fmt2(Number(i.value)); }));
  el.querySelector('#saveW').onclick = async () => {
    const w = structuredClone(DEFAULT_WEIGHTS);
    el.querySelectorAll('[data-w]').forEach((i) => { const [pos, sk] = i.dataset.w.split('.'); w[pos][sk] = Number(i.value); });
    state.settings.weights = w;
    setWeights(w);
    invalidateBest();
    try { await save('settings'); toast('Wagi zapisane — skład przeliczony', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
  el.querySelector('#resetW').onclick = async () => {
    delete state.settings.weights;
    resetWeights();
    invalidateBest();
    try { await save('settings'); toast('Przywrócono domyślne'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------- raport ----------------
export function buildReport() {
  const ps = players();
  const lu = bestXI();
  const m = currentMatch();
  const L = [`# Raport — ${teamName()}`, `${new Date().toLocaleString('pl-PL')}`, ''];
  if (lu) {
    L.push(`## Najlepszy skład (${lu.name}, Σ ${fmt1(lu.result.total)})`);
    for (const s of lu.result.slots) L.push(`- ${SLOT_NAME[s.slot]}: ${s.player ? `${fullName(s.player)} (${fmt1(s.score)})` : '—'}`);
    const pr = prediction(lu, m);
    if (pr) L.push('', `Prognoza ocen: pomoc ${ratingLabel(pr.ours.midfield)}, obrona ${ratingLabel(pr.ours.defLeft)} / ${ratingLabel(pr.ours.defCentral)} / ${ratingLabel(pr.ours.defRight)}, atak ${ratingLabel(pr.ours.attLeft)} / ${ratingLabel(pr.ours.attCentral)} / ${ratingLabel(pr.ours.attRight)} (HatStats ${Math.round(pr.hs)}).`);
    L.push('');
  }
  const out = ps.filter((p) => p.injuryLevel > 0 || isSuspended(p));
  if (out.length) L.push(`Niedostępni: ${out.map(fullName).join(', ')}`, '');
  L.push('## Rekomendacje', `- Kapitan: ${recommendCaptain(ps).slice(0, 3).map((x) => fullName(x.player)).join(', ')}`, `- Stałe fragmenty: ${recommendSetPieceTaker(ps).slice(0, 3).map((x) => fullName(x.player)).join(', ')}`, '');
  L.push('## Ekonomia', `- Pensje: ${fmtMoney(weeklyWages())}/tydz.`, `- Suma TSI: ${int(ps.reduce((a, p) => a + (p.tsi || 0), 0))}`, `- Gotówka: ${fmtMoney(state.finance.cash)} (${fmtDate(state.finance.at)})`, '');
  const h = state.history;
  if (h.length >= 2) {
    const ch = skillChanges(h.at(-2), h.at(-1)).filter((c) => !c.suspicious);
    if (ch.length) { L.push(`## Zmiany od ${fmtDate(h.at(-2).at)}`); for (const c of ch) L.push(`- ${c.name}: ${c.label.toLowerCase()} ${c.from} → ${c.to}`); }
  }
  return L.join('\n');
}
function report() {
  return html`<p class="lead">Podsumowanie drużyny do wklejenia (forum, notatki, doradca w innym czacie).</p>
    <textarea id="rep" class="input" rows="18" readonly style="font-family:ui-monospace,monospace;font-size:13px">${buildReport()}</textarea>
    <button class="btn primary block" id="copy" style="margin-top:12px">${icon('copy')} Kopiuj</button>`;
}

function short(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return s + (a >= 1e6 ? fmt1(a / 1e6) + ' mln' : a >= 1e3 ? Math.round(a / 1e3) + ' tys.' : String(Math.round(a)));
}
