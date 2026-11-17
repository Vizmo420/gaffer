// Gaffer v2 — drobne narzędzia interfejsu: szablony, arkusz od dołu, komunikaty, wykresy SVG.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Szablon z automatycznym escapowaniem wartości; raw(...) przepuszcza gotowy HTML.
const RAW = Symbol('raw');
export const raw = (html) => ({ [RAW]: String(html ?? '') });
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map((x) => (x?.[RAW] != null ? x[RAW] : esc(x))).join('') : v?.[RAW] != null ? v[RAW] : v === false || v == null ? '' : esc(v);
    out += part + strings[i + 1];
  });
  return raw(out);
}
export const str = (h) => (h?.[RAW] != null ? h[RAW] : esc(h));

export const fmt1 = (n) => (Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—');
export const fmt2 = (n) => (Number.isFinite(n) ? n.toFixed(2).replace('.', ',') : '—');
export const signed = (n, d = 1) => (Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(d).replace('.', ',') : '—');
export const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('pl-PL') : '—');

// ---------- ikony (proste linie, 24×24) ----------
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  pitch: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18"/><circle cx="12" cy="12" r="2.5"/>',
  squad: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.4"/><path d="M15.5 14.2c2.4-.4 4.4 1.1 5 4.3"/>',
  market: '<path d="M4 7h16l-1.5 11.5a2 2 0 0 1-2 1.5h-9a2 2 0 0 1-2-1.5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  training: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
  cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="M12 8v4l3 2"/>',
  youth: '<path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
  old: '<path d="M4 4h16v16H4z"/><path d="M4 9h16"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 20h8M10 17h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
};
export const icon = (name, cls = '') =>
  raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`);

// ---------- poziomy umiejętności ----------
const LEVEL = ['nieistniejący', 'fatalny', 'nędzny', 'kiepski', 'słaby', 'przeciętny', 'zadowalający', 'solidny', 'znakomity', 'fantastyczny', 'olśniewający', 'błyskotliwy', 'mistrzowski', 'światowej klasy', 'nadprzyrodzony', 'tytaniczny', 'nieziemski', 'mityczny', 'magiczny', 'utopijny', 'boski'];
export const levelName = (v) => (v == null || v < 0 ? 'nieznany' : LEVEL[Math.min(20, Math.max(0, Math.floor(v)))]);

export function skillTone(v) {
  if (v == null || v < 0) return 'unk';
  if (v >= 13) return 's5';
  if (v >= 10) return 's4';
  if (v >= 7) return 's3';
  if (v >= 4) return 's2';
  return 's1';
}

export function skillBar(label, v, { max = 20, delta = null, maxKnown = null } = {}) {
  const known = v != null && v >= 0;
  const pct = known ? Math.min(100, (v / max) * 100) : 0;
  const potPct = maxKnown != null && maxKnown >= 0 ? Math.min(100, (maxKnown / max) * 100) : null;
  return html`<div class="skill">
    <span class="skill-l">${label}</span>
    <span class="skill-bar">${potPct != null ? raw(`<i class="pot" style="width:${potPct}%"></i>`) : ''}<i class="${skillTone(v)}" style="width:${pct}%"></i></span>
    <span class="skill-v">${known ? v : '?'}${maxKnown != null && maxKnown >= 0 && maxKnown !== v ? raw(`<small>/${maxKnown}</small>`) : ''}${delta ? raw(` <b class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</b>`) : ''}</span>
    <span class="skill-w">${known ? levelName(v) : ''}</span>
  </div>`;
}

export const chip = (text, tone = '') => html`<span class="chip ${tone}">${text}</span>`;

// ---------- arkusz od dołu (szczegóły, formularze) ----------
let sheetCloseCb = null;
export function openSheet(content, { title = '', onClose = null, wide = false } = {}) {
  const sheet = $('#sheet');
  sheet.className = 'sheet open' + (wide ? ' wide' : '');
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Zamknij">${str(icon('close'))}</button></header>
    <div class="sheet-body">${str(content)}</div></div>`;
  sheetCloseCb = onClose;
  document.body.classList.add('noscroll');
  sheet.querySelector('[data-close]').onclick = closeSheet;
  sheet.onclick = (e) => { if (e.target === sheet) closeSheet(); };
  return sheet.querySelector('.sheet-body');
}
export function closeSheet() {
  const sheet = $('#sheet');
  if (!sheet.classList.contains('open')) return;
  sheet.className = 'sheet';
  sheet.innerHTML = '';
  document.body.classList.remove('noscroll');
  const cb = sheetCloseCb;
  sheetCloseCb = null;
  cb?.();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

let toastTimer = null;
export function toast(msg, tone = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + tone;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
}

// ---------- wykresy ----------
export function sparkline(values, { w = 120, h = 32, cls = '' } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return raw('');
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((x - lo) / span) * (h - 6)).toFixed(1)}`);
  return raw(`<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="${pts.at(-1).split(',')[0]}" cy="${pts.at(-1).split(',')[1]}" r="2.6" fill="currentColor"/></svg>`);
}

// Słupki gotówki tydzień po tygodniu; linia progu bezpieczeństwa.
export function cashChart(rows, { floor = 0, h = 140 } = {}) {
  if (!rows.length) return raw('');
  const vals = rows.map((r) => r.cash);
  const hi = Math.max(...vals, floor, 1);
  const lo = Math.min(...vals, 0);
  const span = hi - lo || 1;
  const bw = 100 / rows.length;
  const y = (v) => ((hi - v) / span) * (h - 18) + 4;
  const bars = rows.map((r, i) => {
    const y0 = y(0), yv = y(r.cash);
    const yTop = Math.min(y0, yv), height = Math.abs(y0 - yv);
    return `<rect x="${(i * bw + bw * 0.15).toFixed(2)}%" y="${yTop.toFixed(1)}" width="${(bw * 0.7).toFixed(2)}%" height="${Math.max(1, height).toFixed(1)}" rx="2" class="${r.cash < 0 ? 'neg' : r.home ? 'home' : ''}"><title>Tydz. ${r.week}: ${Math.round(r.cash).toLocaleString('pl-PL')} zł</title></rect>`;
  });
  const fl = floor > 0 ? `<line x1="0" x2="100%" y1="${y(floor).toFixed(1)}" y2="${y(floor).toFixed(1)}" class="floor"/>` : '';
  return raw(`<svg class="cash-chart" width="100%" height="${h}" role="img" aria-label="Prognoza gotówki">${bars.join('')}${fl}<line x1="0" x2="100%" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="zero"/></svg>`);
}

// Minimalny Markdown dla odpowiedzi doradcy (nagłówki, listy, pogrubienia). Wejście escapowane.
export function md(text) {
  const lines = esc(text).split('\n');
  let out = '', list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, '$1<i>$2</i>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); out += `<h3>${inline(m[1])}</h3>`; }
    else if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) close();
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return raw(out);
}

export function confirmSheet(text, okLabel = 'Tak') {
  return new Promise((resolve) => {
    let done = false;
    const body = openSheet(html`<p class="lead">${text}</p><div class="row-btns"><button class="btn ghost" data-no>Anuluj</button><button class="btn primary" data-yes>${okLabel}</button></div>`, {
      title: 'Potwierdź',
      onClose: () => { if (!done) resolve(false); },
    });
    body.querySelector('[data-yes]').onclick = () => { done = true; closeSheet(); resolve(true); };
    body.querySelector('[data-no]').onclick = () => { done = true; closeSheet(); resolve(false); };
  });
}
