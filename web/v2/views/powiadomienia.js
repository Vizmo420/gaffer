// Ustawienia → Powiadomienia: jak podłączyć telefon (aplikacja ntfy) i które zdarzenia wysyłać.

import { html, icon, str, toast } from '../ui.js';
import { state, save } from '../store.js';

const TYPES = [
  ['lineup', 'Skład niezapisany 3 h przed meczem'],
  ['result', 'Wpisz wynik po meczu'],
  ['training', 'Trening: piątek rano „zaktualizuj kadrę” i w czwartek wieczorem, gdy ktoś nie ma minut'],
  ['auction', 'Ostatnia godzina aukcji obserwowanego zawodnika'],
];

let info = null;
export async function notifySection() {
  if (!info) {
    try { info = await (await fetch('/api/notify', { cache: 'no-store' })).json(); } catch { info = { enabled: false }; }
  }
  const on = { lineup: true, result: true, training: true, auction: true, ...(state.settings.notify ?? {}) };
  const sub = info.enabled ? `${info.server}/${info.topic}` : null;
  return html`<h3 class="section-title">Powiadomienia na telefon</h3><section class="card">
    ${info.enabled ? html`
      <p class="small">1. Zainstaluj darmową aplikację <b>ntfy</b> (App Store / Google Play).<br>2. W aplikacji: <b>+</b> → temat <b class="tnum" style="user-select:all">${info.topic}</b> (serwer domyślny ntfy.sh).<br>3. Naciśnij „Wyślij próbne”.</p>
      <div class="row-btns" style="margin:10px 0"><button class="btn primary" id="ntfyTest">${icon('bell')} Wyślij próbne</button><button class="btn ghost" id="ntfyCopy">${icon('copy')} Kopiuj temat</button></div>
      ${TYPES.map(([k, l]) => html`<label class="toggle"><span>${l}</span><input type="checkbox" data-nt="${k}" ${on[k] ? 'checked' : ''}></label>`)}
      <p class="hint">Pi sprawdza co 10 minut, każde zdarzenie wysyła raz. Temat działa jak hasło — nie udostępniaj go. Treść (nazwy rywali i zawodników) przechodzi przez publiczny serwer ntfy.sh.</p>`
    : html`<p class="muted">Powiadomienia nie są skonfigurowane na Pi (brak ~/.config/gaffer/ntfy.env).</p>`}
  </section>`;
}

export function bindNotify(el) {
  el.querySelector('#ntfyTest')?.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/notify/test', { method: 'POST' });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      toast('Wysłano — sprawdź telefon', 'good');
    } catch (e) { toast(e.message, 'bad'); }
  });
  el.querySelector('#ntfyCopy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(info.topic); toast('Temat skopiowany'); } catch { toast(info.topic); }
  });
  el.querySelectorAll('[data-nt]').forEach((cb) => (cb.onchange = async () => {
    state.settings.notify = { ...(state.settings.notify ?? {}), [cb.dataset.nt]: cb.checked };
    try { await save('settings'); toast('Zapisano'); } catch (e) { toast(e.message, 'bad'); }
  }));
}
