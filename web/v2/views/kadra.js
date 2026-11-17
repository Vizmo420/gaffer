// Kadra: seniorzy i akademia. Karta zawodnika z historią postępów, oceną i edycją.

import { html, raw, icon, str, toast, openSheet, closeSheet, skillBar, chip, sparkline, fmt1, int, confirmSheet } from '../ui.js';
import { state, save, players, teamName, playerFromCard } from '../store.js';
import { SKILLS, SLOT_SHORT, SLOT_NAME, fullName, bestSlots, playerHistory, sellAdvice, youthVerdicts, YOUTH_VERDICT, trainingPlan, fmtMoney, fmtDate } from '../logic.js';
import { bestXI, opts, currentLineup } from '../compute.js';
import { specialtyName, isSuspended } from '../../optimizer.js';
import { readScreens, findPlayer, CARD_FIELDS } from '../ocr.js';
import { updatePlayer, removePlayer } from '../actions.js';

const ui = { tab: 'seniorzy', sort: 'pos', q: '' };
const POS_ORDER = { GK: 0, CD: 1, WB: 2, WI: 3, IM: 4, FW: 5 };

export async function render(el, { parts, app }) {
  if (parts[0] === 'akademia') ui.tab = 'akademia';
  else if (parts[0] === 'seniorzy') ui.tab = 'seniorzy';
  const team = teamName();
  const all = players();
  app.setHeader({
    title: 'Kadra',
    subtitle: ui.tab === 'seniorzy' ? `${all.length} zawodników · pensje ${fmtMoney(all.reduce((a, p) => a + (p.salary || 0), 0))}/tydz.` : `${state.youth.players?.length ?? 0} juniorów · ${state.youth.teamName ?? team}`,
    actions: html`<button class="icon-btn" id="addShot" aria-label="Dodaj albo zaktualizuj zawodnika ze zrzutu">${icon('camera')}</button>`,
  });

  const seg = html`<div class="seg"><button data-tab="seniorzy" class="${ui.tab === 'seniorzy' ? 'on' : ''}">Seniorzy</button><button data-tab="akademia" class="${ui.tab === 'akademia' ? 'on' : ''}">Akademia</button></div>`;
  el.innerHTML = str(html`${seg}${ui.tab === 'seniorzy' ? seniors(all) : academy()}`);

  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { ui.tab = b.dataset.tab; app.render(); }));
  el.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => { ui.sort = b.dataset.sort; app.render(); }));
  const q = el.querySelector('#q');
  if (q) q.oninput = () => {
    ui.q = q.value;
    const s = norm(ui.q);
    el.querySelectorAll('li[data-name]').forEach((li) => (li.hidden = !!s && !norm(li.dataset.name).includes(s)));
    el.querySelectorAll('li.section-title').forEach((h) => (h.hidden = !!s));
  };
  el.querySelectorAll('[data-pid]').forEach((b) => (b.onclick = () => openPlayer(all.find((p) => p.id === Number(b.dataset.pid)), app)));
  el.querySelectorAll('[data-yid]').forEach((b) => (b.onclick = () => openYouth(Number(b.dataset.yid))));
  document.querySelector('#addShot').onclick = () => screenshotFlow(app);
}

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function seniors(all) {
  if (!all.length) return html`<div class="empty">${icon('squad')}<p>Brak kadry. <a href="#/wiecej/import">Zaimportuj CSV</a> albo dodaj zawodnika ze zrzutu (ikona aparatu).</p></div>`;
  const lu = bestXI();
  const inXI = new Map((lu?.result.slots ?? []).filter((s) => s.player).map((s) => [s.player.id, s.slot]));
  const o = opts();
  const rows = all.map((p) => ({ p, best: bestSlots(p, o, 1)[0] ?? { slot: 'IM', score: 0 } }));
  const sorters = {
    pos: (a, b) => POS_ORDER[a.best.slot] - POS_ORDER[b.best.slot] || b.best.score - a.best.score,
    value: (a, b) => b.best.score - a.best.score,
    age: (a, b) => (a.p.ageYears ?? a.p.age) - (b.p.ageYears ?? b.p.age),
    salary: (a, b) => (b.p.salary || 0) - (a.p.salary || 0),
    form: (a, b) => (b.p.form || 0) - (a.p.form || 0),
    tsi: (a, b) => (b.p.tsi || 0) - (a.p.tsi || 0),
  };
  rows.sort(sorters[ui.sort] ?? sorters.pos);
  const end = (p, best) => {
    if (ui.sort === 'salary') return html`<b>${int(p.salary)}</b><small>zł/tydz.</small>`;
    if (ui.sort === 'tsi') return html`<b>${int(p.tsi)}</b><small>TSI</small>`;
    if (ui.sort === 'age') return html`<b>${p.age}</b><small>${p.ageDays} dni</small>`;
    if (ui.sort === 'form') return html`<b>${p.form}</b><small>forma</small>`;
    return html`<b>${fmt1(best.score)}</b><small>${SLOT_SHORT[best.slot]}</small>`;
  };
  const SORTS = [['pos', 'Pozycja'], ['value', 'Wartość'], ['form', 'Forma'], ['age', 'Wiek'], ['salary', 'Pensja'], ['tsi', 'TSI']];
  let lastPos = null;
  const items = rows.map(({ p, best }) => {
    const head = ui.sort === 'pos' && best.slot !== lastPos ? html`<li class="section-title" style="margin:14px 16px 4px">${SLOT_NAME[best.slot]}</li>` : '';
    lastPos = best.slot;
    const flags = [
      p.injuryLevel > 0 ? chip('kontuzja', 'bad') : '',
      isSuspended(p) ? chip('pauza', 'bad') : (p.yellowCards ?? 0) === 2 ? chip('2 kartki', 'warn') : '',
      p.transferListed ? chip('na sprzedaż', 'info') : '',
      inXI.has(p.id) ? chip('XI', 'accent') : '',
    ];
    return html`${head}<li data-name="${fullName(p)}"><button class="item" data-pid="${p.id}" data-name="${fullName(p)}">
      <span class="avatar pos-${best.slot}" style="width:40px;height:40px;border-radius:12px;font-size:12px">${SLOT_SHORT[best.slot]}</span>
      <span class="item-main"><span class="item-title">${fullName(p)} ${flags}</span>
        <span class="item-sub">${p.age} l. · forma ${p.form} · kond. ${p.stamina}${p.specialty ? ` · ${specialtyName(p.specialty).toLowerCase()}` : ''}</span>
        <span class="mini-skills" aria-hidden="true">${SKILLS.map(([k]) => raw(`<i class="${tone(p[k])}" title="${k}"></i>`))}</span></span>
      <span class="item-end">${end(p, best)}</span></button></li>`;
  });
  return html`<div class="search"><input class="input" id="q" type="search" placeholder="Szukaj zawodnika" value="${ui.q}" autocomplete="off"></div>
    <div class="chips">${SORTS.map(([k, l]) => html`<button data-sort="${k}" class="${ui.sort === k ? 'on' : ''}">${l}</button>`)}</div>
    <section class="card tight"><ul class="list">${items}</ul></section>
    <p class="hint">Pasek pod nazwiskiem: bronienie, defensywa, rozgrywanie, dośrodkowania, podania, skuteczność, stałe fragmenty. Liczba po prawej: ocena na najlepszej pozycji.</p>`;
}

const tone = (v) => (v == null || v < 0 ? '' : v >= 13 ? 's5' : v >= 10 ? 's4' : v >= 7 ? 's3' : v >= 4 ? 's2' : 's1');

function academy() {
  const youth = state.youth.players ?? [];
  if (!youth.length) return html`<div class="empty">${icon('youth')}<p>Brak danych akademii. <a href="#/wiecej/import">Zaimportuj CSV juniorów</a>.</p></div>`;
  const v = youthVerdicts(youth, players(), bestXI());
  return html`<section class="card tight"><ul class="list">${v.map((x) => {
    const vd = YOUTH_VERDICT[x.verdict];
    return html`<li><button class="item" data-yid="${x.player.id}">
      <span class="avatar pos-${x.bestSlot}" style="width:40px;height:40px;border-radius:12px;font-size:12px">${SLOT_SHORT[x.bestSlot]}</span>
      <span class="item-main"><span class="item-title">${fullName(x.player)}</span>
      <span class="item-sub">${x.player.age} l. ${x.player.ageDays} dni · potencjał ${x.potential}${x.reasons[0] ? ' · ' + x.reasons[0] : ''}</span></span>
      <span class="item-end">${chip(vd.label, vd.tone)}</span></button></li>`;
  })}</ul></section>
  <p class="hint">Potencjał = suma maksymalnych znanych umiejętności (nieznane liczone jako bieżące). Ocena Gaffera, nie dane HT — juniorzy z wieloma „?” mogą być lepsi, niż wygląda.</p>`;
}

function openYouth(id) {
  const p = (state.youth.players ?? []).find((x) => x.id === id);
  if (!p) return;
  const v = youthVerdicts([p], players(), bestXI())[0];
  const vd = YOUTH_VERDICT[v.verdict];
  openSheet(html`
    <div class="p-head"><span class="avatar pos-${v.bestSlot}">${SLOT_SHORT[v.bestSlot]}</span><div><b>${fullName(p)}</b><div class="small muted">${p.age} l. ${p.ageDays} dni${p.specialty ? ' · ' + specialtyName(p.specialty) : ''}</div><div class="p-tags">${chip(vd.label, vd.tone)}${chip('potencjał ' + v.potential)}</div></div></div>
    ${v.reasons.length ? html`<p class="lead">${v.reasons.join('; ')}.</p>` : ''}
    <section>${SKILLS.map(([k, l]) => skillBar(l, p[k], { maxKnown: p[k + 'Max'] }))}</section>
    <p class="hint">Jasny pasek w tle = znany maksymalny poziom. „?” = umiejętność jeszcze nieodkryta.</p>
    ${p.lastRating ? html`<p class="small muted" style="margin-top:8px">Ostatnia ocena meczowa: ${p.lastRating} ★</p>` : ''}
    ${p.scoutComment ? html`<p class="small" style="margin-top:8px">Skaut: ${p.scoutComment}</p>` : ''}
  `, { title: 'Junior' });
}

export function openPlayer(p, app) {
  if (!p) return;
  const o = opts();
  const best = bestSlots(p, o, 3);
  const lu = currentLineup() ?? bestXI();
  const slotInXI = lu?.result.slots.find((s) => s.player?.id === p.id)?.slot ?? null;
  const hist = playerHistory(state.history, p.id);
  const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
  const delta = (k) => (prev && prev[k] != null && p[k] != null && prev[k] >= 0 ? p[k] - prev[k] : null);
  const sell = slotInXI ? null : sellAdvice(players(), lu, o).find((s) => s.player.id === p.id);
  const cfg = { type: state.settings.trainingType, ...state.settings.trainingCfg };
  const tr = slotInXI ? trainingPlan([p], lu.result.slots, cfg)[0] : null;

  const histRows = [];
  if (hist.length >= 2) {
    const series = [['tsi', 'TSI'], ['form', 'Forma'], ...SKILLS];
    for (const [k, l] of series) {
      const vals = hist.map((h) => h[k]).filter((v) => v != null);
      if (new Set(vals).size < 2 && k !== 'tsi') continue;
      histRows.push(html`<div class="hist-row"><span>${l}</span><span>${sparkline(vals, { w: 110, h: 26 })} <b class="tnum">${vals[0]} → ${vals.at(-1)}</b></span></div>`);
    }
  }

  const body = openSheet(html`
    <div class="p-head"><span class="avatar pos-${best[0]?.slot}">${SLOT_SHORT[best[0]?.slot] ?? '?'}</span>
      <div style="flex:1;min-width:0"><b style="font-size:18px">${fullName(p)}</b>
      <div class="small muted">${p.age} l. ${p.ageDays} dni${p.specialty ? ' · ' + specialtyName(p.specialty) : ''}</div>
      <div class="p-tags">${slotInXI ? chip(`w składzie: ${SLOT_NAME[slotInXI].toLowerCase()}`, 'accent') : chip('poza składem')}${p.injuryLevel > 0 ? chip(`kontuzja ${p.injuryLevel} tyg.`, 'bad') : ''}${(p.yellowCards ?? 0) > 0 ? chip(`${p.yellowCards} ${p.yellowCards === 1 ? 'kartka' : 'kartki'}`, p.yellowCards >= 2 ? 'warn' : '') : ''}${p.transferListed ? chip('na sprzedaż', 'info') : ''}</div></div></div>
    <div class="kv">
      <div><span>Forma / kondycja</span><b>${p.form} / ${p.stamina}</b></div>
      <div><span>TSI</span><b>${int(p.tsi)}</b></div>
      <div><span>Pensja</span><b>${fmtMoney(p.salary)}</b></div>
      <div><span>Doświadczenie / przyw.</span><b>${p.experience ?? '?'} / ${p.leadership ?? '?'}</b></div>
      <div><span>Lojalność</span><b>${p.loyalty ?? '?'}${p.motherClubBonus ? ' · wychowanek' : ''}</b></div>
      <div><span>Ostatni mecz</span><b>${p.lastMatchDate ? fmtDate(p.lastMatchDate) : p.weeksSinceLastMatch != null ? `${p.weeksSinceLastMatch} tyg. temu` : '?'}</b></div>
    </div>
    <h3 class="section-title">Umiejętności${prev ? html` <small class="muted" style="text-transform:none;letter-spacing:0">zmiana od ${fmtDate(prev.at)}</small>` : ''}</h3>
    <section>${SKILLS.map(([k, l]) => skillBar(l, p[k], { delta: delta(k) }))}</section>
    <h3 class="section-title">Najlepsze pozycje</h3>
    <section class="card" style="padding:4px 16px">${best.map((b) => html`<div class="hist-row"><span>${SLOT_NAME[b.slot]}</span><b class="tnum">${fmt1(b.score)}</b></div>`)}</section>
    ${tr ? html`<h3 class="section-title">Trening (${state.settings.trainingType})</h3><section class="card">${tr.coverage === 'none'
      ? html`<p>Na pozycji ${SLOT_NAME[slotInXI].toLowerCase()} nie trenuje — ${state.settings.trainingType.toLowerCase()} działa na inne pozycje.</p>`
      : html`<p>${SKILLS.find(([k]) => k === tr.skill)?.[1]} ${tr.level} → ${tr.nextLevel} za ok. <b>${fmt1(tr.weeks)} tyg.</b>${tr.after13 != null ? html` · za 13 tyg. ok. ${fmt1(tr.after13)}` : ''}</p>`}
      <p class="hint">Szacunek z modelu społeczności, nie wzór HT.</p></section>` : ''}
    ${sell ? html`<h3 class="section-title">Czy sprzedać?</h3><section class="card"><p><b>${sell.verdict === 'sell' ? 'Do rozważenia' : sell.verdict === 'listed' ? 'Już wystawiony' : 'Raczej zostaw'}</b> — ${sell.reasons.length ? sell.reasons.join('; ') : `pierwszy rezerwowy na pozycji ${SLOT_NAME[sell.slot]?.toLowerCase()}`}.</p>${sell.verdict === 'sell' ? html`<p class="hint">Oszczędność ${fmtMoney(sell.weeklySaving)} tygodniowo.</p>` : ''}</section>` : ''}
    ${histRows.length ? html`<h3 class="section-title">Historia (${hist.length} importów)</h3><section class="card" style="padding:4px 16px">${histRows}</section>` : ''}
    <h3 class="section-title">Zmień</h3>
    <section class="card">
      <label class="toggle"><span>Wystawiony na sprzedaż</span><input type="checkbox" id="tl" ${p.transferListed ? 'checked' : ''}></label>
      <div class="grid2">
        <label class="field"><span>Kartki</span><select id="yc">${[0, 1, 2, 3].map((n) => html`<option value="${n}" ${(p.yellowCards ?? 0) === n ? 'selected' : ''}>${n === 3 ? '3 (pauza)' : n}</option>`)}</select></label>
        <label class="field"><span>Kontuzja (tygodnie)</span><select id="inj">${[-1, 0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => html`<option value="${n}" ${(p.injuryLevel ?? -1) === n ? 'selected' : ''}>${n === -1 ? 'zdrowy' : n === 0 ? 'lekki uraz' : n}</option>`)}</select></label>
      </div>
      <div class="row-btns"><button class="btn ghost" id="editSkills">Popraw liczby</button><button class="btn danger" id="gone">${icon('trash')} Odszedł</button></div>
    </section>
  `, { title: 'Zawodnik', onClose: () => app?.render() });

  const patch = async (o2) => { try { await updatePlayer(p, o2); toast('Zapisano'); } catch (e) { toast(e.message, 'bad'); } };
  body.querySelector('#tl').onchange = (e) => patch({ transferListed: e.target.checked });
  body.querySelector('#yc').onchange = (e) => patch({ yellowCards: Number(e.target.value) });
  body.querySelector('#inj').onchange = (e) => patch({ injuryLevel: Number(e.target.value) });
  body.querySelector('#gone').onclick = async () => {
    if (!(await confirmSheet(`Usunąć ${fullName(p)} z kadry (sprzedany, zwolniony)? Zostanie w historii importów.`, 'Usuń z kadry'))) return openPlayer(p, app);
    try { await removePlayer(p); toast(`${fullName(p)} usunięty z kadry`); app?.render(); } catch (e) { toast(e.message, 'bad'); }
  };
  body.querySelector('#editSkills').onclick = () => editNumbers(p, app);
}

function editNumbers(p, app) {
  const F = [['form', 'Forma'], ['stamina', 'Kondycja'], ...SKILLS, ['experience', 'Doświadczenie'], ['leadership', 'Przywództwo'], ['loyalty', 'Lojalność'], ['tsi', 'TSI'], ['salary', 'Pensja (zł)'], ['age', 'Wiek'], ['ageDays', 'Dni']];
  const body = openSheet(html`<p class="lead">Popraw wartości, jeśli coś się zmieniło, a nie robisz pełnego importu.</p>
    <div class="grid2">${F.map(([k, l]) => html`<label class="field"><span>${l}</span><input type="number" inputmode="numeric" data-k="${k}" value="${p[k] ?? ''}"></label>`)}</div>
    <button class="btn primary block" id="ok">Zapisz</button>`, { title: fullName(p) });
  body.querySelector('#ok').onclick = async () => {
    const o = {};
    body.querySelectorAll('[data-k]').forEach((i) => { if (i.value !== '') o[i.dataset.k] = Number(i.value); });
    if (o.age != null) o.ageYears = Number((o.age + (o.ageDays ?? p.ageDays ?? 0) / 112).toFixed(2));
    try { await updatePlayer(p, o); toast('Zapisano', 'good'); closeSheet(); openPlayer(p, app); } catch (e) { toast(e.message, 'bad'); }
  };
}

// Zrzut karty własnego zawodnika: aktualizacja istniejącego albo dodanie nowego (np. po wygranej aukcji).
function screenshotFlow(app) {
  const body = openSheet(html`<p class="lead">Wybierz 1–3 zrzuty karty zawodnika z aplikacji Hattricka (umiejętności i strona z pensją/TSI). Znany zawodnik zostanie zaktualizowany, nowy — dodany do kadry.</p>
    <label class="btn primary block">${icon('camera')} Wybierz zrzuty<input type="file" accept="image/*" multiple hidden id="f"></label>
    <p class="hint" id="st"></p><div id="res"></div>`, { title: 'Zawodnik ze zrzutu' });
  body.querySelector('#f').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const st = body.querySelector('#st');
    try {
      const { cards, notes } = await readScreens(files, (m) => (st.textContent = m));
      st.textContent = notes.join(' ');
      if (!cards.length) return;
      body.querySelector('#res').innerHTML = str(html`${cards.map((c, i) => {
        const p = findPlayer(c, players());
        const changes = p ? CARD_FIELDS.filter((k) => c[k] != null && p[k] !== c[k]).map((k) => `${k === 'salary' ? 'pensja' : k === 'tsi' ? 'TSI' : (SKILLS.find(([s]) => s === k)?.[1] ?? k).toLowerCase()} ${p[k] ?? '?'}→${c[k]}`) : [];
        return html`<section class="card"><div class="card-head"><h2>${p ? fullName(p) : c.name}</h2>${chip(p ? 'w kadrze' : 'nowy', p ? '' : 'good')}</div>
          <p class="small">${p ? (changes.length ? changes.join(', ') : 'bez zmian') : `${c.age ?? '?'} l. · rozgrywanie ${c.playmaking ?? '?'} · podania ${c.passing ?? '?'} · pensja ${c.salary ? fmtMoney(c.salary) : '?'}`}</p>
          ${c.warn?.length ? html`<p class="hint">${icon('warn')} ${c.warn.join('; ')}</p>` : ''}
          <button class="btn ${p ? 'ghost' : 'primary'} block" style="margin-top:10px" data-apply="${i}" ${p && !changes.length ? 'disabled' : ''}>${p ? 'Zaktualizuj' : 'Dodaj do kadry'}</button></section>`;
      })}`);
      body.querySelectorAll('[data-apply]').forEach((b) => (b.onclick = async () => {
        const c = cards[Number(b.dataset.apply)];
        const p = findPlayer(c, players());
        try {
          if (p) await updatePlayer(p, Object.fromEntries(CARD_FIELDS.filter((k) => c[k] != null).map((k) => [k, c[k]])));
          else { state.squad.players.push(playerFromCard(c)); await save('squad'); }
          b.disabled = true;
          b.textContent = p ? 'Zaktualizowano' : 'Dodano';
          toast(p ? 'Zaktualizowano' : 'Dodano do kadry', 'good');
        } catch (err) { toast(err.message, 'bad'); }
      }));
    } catch (err) {
      st.textContent = err.message;
    }
  };
  // po zamknięciu odśwież listę
  const sheet = document.querySelector('#sheet');
  const obs = new MutationObserver(() => { if (!sheet.classList.contains('open')) { obs.disconnect(); app.render(); } });
  obs.observe(sheet, { attributes: true, attributeFilter: ['class'] });
}
