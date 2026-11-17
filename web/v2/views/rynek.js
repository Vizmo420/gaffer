// Rynek: kandydaci do kupna (ze zrzutów), kogo sprzedać, finanse z prognozą.

import { html, raw, icon, str, toast, openSheet, closeSheet, chip, cashChart, fmt1, signed, int, confirmSheet } from '../ui.js';
import { state, save, players, weeklyWages } from '../store.js';
import { SKILLS, SLOT_NAME, SLOT_SHORT, fullName, sellAdvice, wageAfterTransfer, WAGE_MODES, parseDeadline, relTime, fmtMoney, fmtDate } from '../logic.js';
import { bestXI, opts, forecast, spendable } from '../compute.js';
import { scoreCandidate } from '../../planner.js';
import { nameId } from '../../csv-import.js';
import { readScreens, missingFields, properName } from '../ocr.js';
import { buyCandidate } from '../actions.js';
import { openPlayer } from './kadra.js';

const ui = { tab: 'kandydaci', showClosed: false };

export async function render(el, { parts, app }) {
  if (['kandydaci', 'sprzedaz', 'finanse'].includes(parts[0])) ui.tab = parts[0];
  app.setHeader({
    title: 'Rynek',
    subtitle: `gotówka ${fmtMoney(state.finance.cash)} · można wydać ${fmtMoney(spendable())}`,
    actions: ui.tab === 'kandydaci' ? html`<button class="icon-btn" id="addCand" aria-label="Dodaj kandydata">${icon('plus')}</button>` : '',
  });
  const seg = html`<div class="seg"><button data-tab="kandydaci" class="${ui.tab === 'kandydaci' ? 'on' : ''}">Kupno</button><button data-tab="sprzedaz" class="${ui.tab === 'sprzedaz' ? 'on' : ''}">Sprzedaż</button><button data-tab="finanse" class="${ui.tab === 'finanse' ? 'on' : ''}">Finanse</button></div>`;
  const content = ui.tab === 'sprzedaz' ? selling() : ui.tab === 'finanse' ? finance() : buying();
  el.innerHTML = str(html`${seg}${content}`);
  el.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => app.go(`#/rynek/${b.dataset.tab}`)));
  if (ui.tab === 'kandydaci') bindBuying(el, app);
  if (ui.tab === 'finanse') bindFinance(el, app);
  if (ui.tab === 'sprzedaz') el.querySelectorAll('[data-pid]').forEach((b) => (b.onclick = () => openPlayer(players().find((p) => p.id === Number(b.dataset.pid)), app)));
}

// ---------------- kupno ----------------

function evaluate(c) {
  const wage = wageAfterTransfer(c.salary, c.wageMode ?? 'abroad');
  const s = scoreCandidate(players(), { ...c, salary: 0 }, { formation: state.settings.formation, price: c.price || 0, ctx: {} });
  const yearCost = (c.price || 0) + wage * 52;
  return { ...s, wage, yearCost, costPerSigma: s && s.dSigma > 0.05 ? yearCost / s.dSigma : null };
}

function buying() {
  const open = state.candidates.filter((c) => !c.status);
  const closed = state.candidates.filter((c) => c.status);
  const budget = spendable();
  const cards = open
    .map((c) => ({ c, e: evaluate(c), d: parseDeadline(c.deadline) }))
    .sort((a, b) => (b.e?.dSigma ?? 0) - (a.e?.dSigma ?? 0));
  return html`
    <section class="card"><div class="stats">
      <div class="stat"><b>${short(budget)}</b><span>można wydać</span></div>
      <div class="stat"><b>${short(state.settings.cashFloor)}</b><span>rezerwa</span></div>
      <div class="stat"><b>${open.length}</b><span>obserwowanych</span></div></div>
      <p class="hint">„Można wydać” = najniższa prognozowana gotówka w 16 tygodniach minus rezerwa. Pensję nowego zawodnika licz osobno — widać ją przy kandydacie.</p>
    </section>
    <div class="row-btns" style="margin-bottom:12px"><button class="btn primary" id="shot">${icon('camera')} Ze zrzutu</button><button class="btn ghost" id="manual">${icon('plus')} Ręcznie</button></div>
    ${cards.length ? cards.map(({ c, e, d }) => {
      const miss = missingFields(c).filter((k) => !['form', 'stamina'].includes(k));
      const over = c.price && c.price > budget;
      return html`<section class="card">
        <div class="card-head"><h2>${c.name}</h2>${e?.inXI ? chip(`do XI: ${SLOT_SHORT[e.slot]}`, 'good') : chip('nie wejdzie do XI')}</div>
        <p class="small muted">${c.age ?? '?'} l.${c.specialty ? '' : ''} · ${SKILLS.filter(([k]) => (c[k] ?? 0) >= 7).map(([k, l]) => `${l.toLowerCase()} ${c[k]}`).join(' · ') || 'brak umiejętności ≥ 7'}</p>
        <div class="stats" style="margin-top:10px">
          <div class="stat"><b class="${(e?.dSigma ?? 0) > 0.05 ? 'good' : ''}">${signed(e?.dSigma ?? 0, 2)}</b><span>Σ składu</span></div>
          <div class="stat"><b class="${over ? 'bad' : ''}">${c.price ? short(c.price) : '?'}</b><span>${c.highBid ? 'oferta' : 'cena'}</span></div>
          <div class="stat"><b>${d ? relTime(d) : '—'}</b><span>koniec aukcji</span></div>
        </div>
        <div class="kv">
          <div><span>Pensja po transferze</span><b>${c.salary ? fmtMoney(e.wage) : '?'}</b></div>
          <div><span>Koszt na rok</span><b>${c.salary ? short(e.yearCost) : '?'}</b></div>
        </div>
        <label class="field"><span>Pensja po przejściu</span><select data-wage="${c.id}">${Object.entries(WAGE_MODES).map(([k, v]) => html`<option value="${k}" ${(c.wageMode ?? 'abroad') === k ? 'selected' : ''}>${v.label}</option>`)}</select></label>
        ${miss.length ? html`<p class="hint">${icon('warn')} Brakuje: ${miss.map(label).join(', ')} — dodaj drugi zrzut albo popraw ręcznie.</p>` : ''}
        ${over ? html`<p class="hint bad">Cena przekracza bezpieczny budżet.</p>` : ''}
        ${c.warn?.length ? html`<p class="hint">OCR: ${c.warn.join('; ')}</p>` : ''}
        <div class="row-btns" style="margin-top:10px"><button class="btn primary small" data-buy="${c.id}">Kupiony</button><button class="btn ghost small" data-lost="${c.id}">Przegrany</button><button class="btn ghost small" data-edit="${c.id}">Popraw</button></div>
      </section>`;
    }) : html`<div class="empty">${icon('market')}<p>Brak kandydatów. Zrób zrzuty karty zawodnika w aplikacji HT (umiejętności + strona z pensją) i dodaj je tutaj.</p></div>`}
    ${closed.length ? html`<button class="btn ghost block" id="toggleClosed">${ui.showClosed ? 'Ukryj' : 'Pokaż'} zakończone (${closed.length})</button>
      ${ui.showClosed ? html`<section class="card tight" style="margin-top:12px"><ul class="list">${closed.map((c) => html`<li class="item" style="cursor:default"><span class="item-main"><span class="item-title">${c.name}</span><span class="item-sub">${c.status === 'bought' ? 'kupiony' : 'przegrany'}${c.price ? ' · ' + fmtMoney(c.price) : ''}</span></span><button class="icon-btn" data-del="${c.id}" aria-label="Usuń">${icon('trash')}</button></li>`)}</ul></section>` : ''}` : ''}`;
}

const LABELS = { form: 'forma', stamina: 'kondycja', keeper: 'bronienie', defending: 'defensywa', playmaking: 'rozgrywanie', winger: 'dośrodkowania', passing: 'podania', scoring: 'skuteczność', setPieces: 'stałe fragmenty', salary: 'pensja', age: 'wiek' };
const label = (k) => LABELS[k] ?? k;

function bindBuying(el, app) {
  const byId = (id) => state.candidates.find((c) => String(c.id) === String(id));
  const persist = async (msg) => { try { await save('candidates'); if (msg) toast(msg); app.render(); } catch (e) { toast(e.message, 'bad'); } };
  el.querySelector('#shot').onclick = () => shotFlow(app);
  el.querySelector('#manual').onclick = () => editCandidate(null, app);
  document.querySelector('#addCand')?.addEventListener('click', () => shotFlow(app));
  el.querySelector('#toggleClosed')?.addEventListener('click', () => { ui.showClosed = !ui.showClosed; app.render(); });
  el.querySelectorAll('[data-wage]').forEach((s) => (s.onchange = () => { byId(s.dataset.wage).wageMode = s.value; persist(); }));
  el.querySelectorAll('[data-lost]').forEach((b) => (b.onclick = () => { byId(b.dataset.lost).status = 'lost'; persist('Oznaczono jako przegrany'); }));
  el.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => editCandidate(byId(b.dataset.edit), app)));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmSheet('Usunąć kandydata z listy?', 'Usuń'))) return;
    state.candidates = state.candidates.filter((c) => String(c.id) !== b.dataset.del);
    persist();
  }));
  el.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = async () => {
    const c = byId(b.dataset.buy);
    const body = openSheet(html`<p class="lead">${c.name} trafi do kadry z pensją ${fmtMoney(wageAfterTransfer(c.salary, c.wageMode))} i lojalnością 0.</p>
      <label class="field"><span>Cena, za którą kupiony (zł)</span><input type="number" inputmode="numeric" id="paid" value="${c.price ?? ''}"></label>
      <label class="toggle"><span>Odejmij cenę od gotówki</span><input type="checkbox" id="sub" checked></label>
      <button class="btn primary block" id="ok">Dodaj do kadry</button>`, { title: 'Kupiony' });
    body.querySelector('#ok').onclick = async () => {
      const paid = Number(body.querySelector('#paid').value) || 0;
      try {
        c.price = paid || c.price;
        await buyCandidate(c);
        if (body.querySelector('#sub').checked && paid) { state.finance.cash -= paid; state.finance.at = new Date().toISOString().slice(0, 10); await save('finance'); }
        toast(`${c.name} w kadrze`, 'good');
        closeSheet();
        app.render();
      } catch (e) { toast(e.message, 'bad'); }
    };
  }));
}

function shotFlow(app) {
  const body = openSheet(html`<p class="lead">Wybierz zrzuty z aplikacji HT: kartę zawodnika (umiejętności, pensja, TSI) albo listę wyników wyszukiwania. Zrzuty tego samego zawodnika łączę w jedną kartę.</p>
    <label class="btn primary block">${icon('camera')} Wybierz zrzuty<input type="file" accept="image/*" multiple hidden id="f"></label><p class="hint" id="st">Około 8–10 sekund na zrzut.</p>`, { title: 'Kandydat ze zrzutu' });
  body.querySelector('#f').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const st = body.querySelector('#st');
    try {
      const { cards, notes } = await readScreens(files, (m) => (st.textContent = m));
      let added = 0, updated = 0;
      for (const card of cards) {
        const name = properName(card, players());
        const ex = state.candidates.find((c) => !c.status && strip(c.name) === strip(name));
        const price = card.price ?? card.highBid ?? card.startPrice ?? null;
        const clean = Object.fromEntries(Object.entries({ ...card, name, price }).filter(([, v]) => v != null));
        if (ex) { for (const [k, v] of Object.entries(clean)) if (k === 'warn') ex.warn = v; else ex[k] = v; updated++; }
        else { state.candidates.push({ id: nameId(name) + Date.now() % 1000, wageMode: 'abroad', addedAt: new Date().toISOString(), ...clean }); added++; }
      }
      await save('candidates');
      toast(`${added ? `Dodano ${added}` : ''}${added && updated ? ', ' : ''}${updated ? `zaktualizowano ${updated}` : ''}${!added && !updated ? 'Nic nie odczytano' : ''}`, added || updated ? 'good' : 'bad');
      if (notes.length) st.textContent = notes.join(' ');
      else { closeSheet(); app.render(); }
    } catch (err) { st.textContent = err.message; }
  };
}

const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

function editCandidate(c, app) {
  const isNew = !c;
  c = c ?? { name: '', wageMode: 'abroad' };
  const F = [['age', 'Wiek'], ['form', 'Forma'], ['stamina', 'Kondycja'], ...SKILLS, ['experience', 'Doświadczenie'], ['salary', 'Pensja teraz (zł)'], ['tsi', 'TSI'], ['price', 'Cena (zł)']];
  const body = openSheet(html`
    <label class="field"><span>Imię i nazwisko</span><input id="nm" value="${c.name}" autocomplete="off"></label>
    <div class="grid2">${F.map(([k, l]) => html`<label class="field"><span>${l}</span><input type="number" inputmode="numeric" data-k="${k}" value="${c[k] ?? ''}"></label>`)}</div>
    <label class="field"><span>Koniec aukcji (DD.MM.RRRR GG:MM)</span><input id="dl" value="${c.deadline ?? ''}" placeholder="12.11.2026 10:03"></label>
    <button class="btn primary block" id="ok">${isNew ? 'Dodaj' : 'Zapisz'}</button>
    ${isNew ? '' : html`<button class="btn danger block" style="margin-top:8px" id="del">${icon('trash')} Usuń kandydata</button>`}`, { title: isNew ? 'Nowy kandydat' : c.name });
  body.querySelector('#ok').onclick = async () => {
    const name = body.querySelector('#nm').value.trim();
    if (!name) return toast('Wpisz nazwisko', 'bad');
    c.name = name;
    body.querySelectorAll('[data-k]').forEach((i) => { c[i.dataset.k] = i.value === '' ? null : Number(i.value); });
    c.deadline = body.querySelector('#dl').value.trim() || null;
    if (isNew) state.candidates.push({ ...c, id: nameId(name), addedAt: new Date().toISOString() });
    try { await save('candidates'); closeSheet(); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
  body.querySelector('#del')?.addEventListener('click', async () => {
    state.candidates = state.candidates.filter((x) => x !== c);
    try { await save('candidates'); closeSheet(); app.render(); } catch (e) { toast(e.message, 'bad'); }
  });
}

// ---------------- sprzedaż ----------------

function selling() {
  const lu = bestXI();
  const list = sellAdvice(players(), lu, opts());
  const sell = list.filter((s) => s.verdict === 'sell');
  const saving = sell.reduce((a, s) => a + s.weeklySaving, 0);
  const tone = { sell: 'warn', listed: 'info', keep: '' };
  const lbl = { sell: 'do rozważenia', listed: 'wystawiony', keep: 'zostaw' };
  return html`<section class="card"><div class="stats">
      <div class="stat"><b>${sell.length}</b><span>do rozważenia</span></div>
      <div class="stat"><b>${short(saving)}</b><span>pensje / tydz.</span></div>
      <div class="stat"><b>${short(saving * 16)}</b><span>przez 16 tyg.</span></div></div>
    <p class="hint">Zawodnicy spoza najlepszej XI. „Do rozważenia”: nie mieści się nawet w drugim składzie (rezerwy) albo ma 31+ lat. Ceny rynkowej Gaffer nie zna — sprawdź podobnych w wyszukiwarce transferów HT.</p></section>
    <section class="card tight"><ul class="list">${list.map((s) => html`<li><button class="item" data-pid="${s.player.id}">
      <span class="avatar pos-${s.slot}" style="width:40px;height:40px;border-radius:12px;font-size:12px">${SLOT_SHORT[s.slot] ?? '?'}</span>
      <span class="item-main"><span class="item-title">${fullName(s.player)} ${chip(lbl[s.verdict], tone[s.verdict])}</span>
      <span class="item-sub">${s.reasons.length ? s.reasons.join(' · ') : `rezerwowy: ${SLOT_NAME[s.slot]?.toLowerCase()}`}</span></span>
      <span class="item-end"><b>${int(s.player.salary)}</b><small>zł/tydz.</small></span></button></li>`)}</ul></section>`;
}

// ---------------- finanse ----------------

function finance() {
  const f = state.finance;
  const fc = forecast();
  const floor = state.settings.cashFloor ?? 1000000;
  const field = (k, l, v = f[k]) => html`<label class="field"><span>${l}</span><input type="number" inputmode="numeric" data-f="${k}" value="${v ?? ''}"></label>`;
  return html`
    <section class="card">
      <div class="card-head"><h2>Prognoza 16 tygodni</h2><span class="small muted">od ${fmtDate(f.at)}</span></div>
      ${cashChart(fc.rows, { floor })}
      <p class="small muted" style="margin-top:6px"><span class="chip good">mecz u siebie</span> <span class="chip accent">wyjazd</span> <span class="chip warn">rezerwa ${short(floor)}</span></p>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><b class="${fc.minCash < floor ? 'bad' : ''}">${short(fc.minCash)}</b><span>najmniej (tydz. ${fc.minWeek})</span></div>
        <div class="stat"><b>${short(fc.endCash)}</b><span>po 16 tyg.</span></div>
        <div class="stat"><b>${short(spendable())}</b><span>można wydać</span></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Tydzień</h2></div>
      <div class="hist-row"><span>Pensje zawodników (z kadry)</span><b class="tnum">${fmtMoney(weeklyWages())}</b></div>
      <div class="hist-row"><span>Sztab</span><b class="tnum">${fmtMoney(f.staff)}</b></div>
      <div class="hist-row"><span>Stadion + akademia</span><b class="tnum">${fmtMoney((f.stadium || 0) + (f.youth || 0))}</b></div>
      <div class="hist-row"><span>Bez meczu u siebie</span><b class="tnum ${fc.quietNet < 0 ? 'bad' : 'good'}">${signed(fc.quietNet / 1000, 0)} tys.</b></div>
      <div class="hist-row"><span>Z meczem u siebie</span><b class="tnum ${fc.homeNet < 0 ? 'bad' : 'good'}">${signed(fc.homeNet / 1000, 0)} tys.</b></div>
      <p class="hint">Sztab (${short(f.staff)}/tydz.) to ${Math.round((100 * f.staff) / (fc.weeklyFixed || 1))}% stałych kosztów. Kontrakty kończą się ${fmtDate(state.settings.staffContractEnd)} — wtedy możesz zmienić skład sztabu.</p>
    </section>
    <h3 class="section-title">Dane (ze strony Finanse w HT)</h3>
    <section class="card">
      <div class="grid2">${field('cash', 'Gotówka (zł)')}<label class="field"><span>Stan na dzień</span><input type="date" data-f="at" value="${String(f.at).slice(0, 10)}"></label></div>
      <div class="grid2">${field('sponsors', 'Sponsorzy / tydz.')}${field('homeIncome', 'Wpływy z meczu u siebie')}</div>
      <div class="grid2">${field('awayTickets', 'Bilety bez meczu u siebie')}${field('staff', 'Sztab / tydz.')}</div>
      <div class="grid2">${field('stadium', 'Stadion / tydz.')}${field('youth', 'Akademia / tydz.')}</div>
      <div class="grid2">${field('homeEvery', 'Mecz u siebie co … tyg.')}<label class="field"><span>Rezerwa (zł)</span><input type="number" inputmode="numeric" data-s="cashFloor" value="${floor}"></label></div>
      <label class="field"><span>Koniec kontraktów sztabu</span><input type="date" data-s="staffContractEnd" value="${state.settings.staffContractEnd ?? ''}"></label>
      <button class="btn primary block" id="saveF">Zapisz</button>
    </section>`;
}

function bindFinance(el, app) {
  el.querySelector('#saveF').onclick = async () => {
    el.querySelectorAll('[data-f]').forEach((i) => { state.finance[i.dataset.f] = i.type === 'date' ? i.value : Number(i.value) || 0; });
    el.querySelectorAll('[data-s]').forEach((i) => { state.settings[i.dataset.s] = i.type === 'date' ? i.value : Number(i.value) || 0; });
    try { await save('finance'); await save('settings'); toast('Zapisano', 'good'); app.render(); } catch (e) { toast(e.message, 'bad'); }
  };
}

function short(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  return s + (a >= 1e6 ? fmt1(a / 1e6) + ' mln' : a >= 1e3 ? Math.round(a / 1e3) + ' tys.' : String(Math.round(a)));
}
