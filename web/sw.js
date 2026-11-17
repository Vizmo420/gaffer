// Gaffer v1 został zastąpiony przez v2 (/v2/). Ten service worker tylko sprząta po v1:
// kasuje jej pamięć podręczną, wyrejestrowuje się i przenosi otwarte okna do v2.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('gaffer-v')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const wins = await self.clients.matchAll({ type: 'window' });
    for (const w of wins) if (!new URL(w.url).pathname.startsWith('/v2/')) w.navigate('/v2/');
  })());
});
