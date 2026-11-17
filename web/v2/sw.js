// Gaffer v2: najpierw sieć (świeży kod i dane z Pi), kopia w pamięci telefonu na brak połączenia.
const CACHE = 'gaffer2-v5';
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
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
