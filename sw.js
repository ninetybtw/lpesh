/* LexPrep — service worker для режима приложения («На экран Домой»).
   Ничего не кэширует, кроме офлайн-страницы: сайт и так грузится из сети
   (а учебные материалы — из IndexedDB, см. content-loader.js). Нужен, чтобы
   Android предлагал «Установить приложение» и чтобы без интернета вместо
   ошибки браузера показывалась понятная страница. */

const OFFLINE_CACHE = 'lexprep-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then(cache => cache.addAll([OFFLINE_URL, '/assets/favicon/android-chrome-192x192.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('lexprep-') && k !== OFFLINE_CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return await fetch(event.request);
    } catch (e) {
      const cached = await caches.match(OFFLINE_URL);
      return cached || Response.error();
    }
  })());
});
