// Gaffer v2 — start aplikacji, nawigacja (hash), nagłówek.

import { $, $$, icon, str, closeSheet, toast } from './ui.js';
import { state, loadAll, teamName } from './store.js';
import { startEdit } from './compute.js';
import { nextMatch } from './logic.js';
import * as start from './views/start.js';
import * as sklad from './views/sklad.js';
import * as kadra from './views/kadra.js';
import * as rynek from './views/rynek.js';
import * as wiecej from './views/wiecej.js';

const VIEWS = { '': start, sklad, kadra, rynek, wiecej };

for (const el of $$('[data-icon]')) el.innerHTML = str(icon(el.dataset.icon));
$('#back').innerHTML = str(icon('back'));
$('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));

export function setHeader({ title, subtitle = '', back = false, actions = '' }) {
  $('#title').textContent = title;
  $('#subtitle').textContent = subtitle;
  $('#back').hidden = !back;
  $('#actions').innerHTML = str(actions);
  document.title = title === 'Start' ? 'Gaffer' : `${title} · Gaffer`;
}

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function parse() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { parts, query: new URLSearchParams(query) };
}

export async function render() {
  closeSheet();
  const { parts, query } = parse();
  const view = VIEWS[parts[0] ?? ''] ?? start;
  for (const a of $$('[data-nav]')) a.classList.toggle('active', (a.dataset.nav === 'start' ? '' : a.dataset.nav) === (VIEWS[parts[0] ?? ''] ? parts[0] ?? '' : ''));
  const el = $('#view');
  try {
    await view.render(el, { parts: parts.slice(1), query, app: { go, render, setHeader } });
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card"><h2>Coś poszło nie tak</h2><p class="lead">${String(err.message).replace(/</g, '&lt;')}</p></div>`;
  }
  if (!parse().parts.length || parts[0] !== window.__lastView) window.scrollTo(0, 0);
  window.__lastView = parts[0];
}

window.addEventListener('hashchange', render);

(async () => {
  try {
    await loadAll();
  } catch (err) {
    toast('Nie udało się wczytać danych: ' + err.message, 'bad');
  }
  startEdit(nextMatch(state.matches));
  if (!state.online) toast('Brak połączenia z Pi — pokazuję ostatnie zapisane dane', 'bad');
  render();
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
