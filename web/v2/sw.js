// Gaffer v2: kod z pamięci telefonu (szybki start), świeży pobierany w tle; dane zawsze z Pi.
const CACHE = 'gaffer2-v7';
const SHELL = ['./', './index.html', './style.css', './app.js', './ui.js', './store.js', './logic.js', './compute.js', './actions.js', './ocr.js', './parsers.js',
  './views/start.js', './views/sklad.js', './views/kadra.js', './views/rynek.js', './views/wiecej.js', './views/liga.js', './views/analizy.js', './views/powiadomienia.js',
  '../optimizer.js', '../ht-ratings.js', '../planner.js', '../training-calc.js', '../csv-import.js', '../screen-parse.js', './icon.svg'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x.startsWith('gaffer2-') && x !== CACHE).map((x) => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) return;
  // kod: od razu z pamięci telefonu, w tle pobierz świeży (nowa wersja = nowa nazwa CACHE, więc wgrywa się sama)
  const fresh = fetch(e.request)
    .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); } return res; });
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) { fresh.catch(() => {}); return hit; }
      return fresh.catch(() => caches.match('./index.html'));
    }),
  );
});
