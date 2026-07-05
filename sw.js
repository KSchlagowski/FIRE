// sw.js — klasyczny skrypt w katalogu głównym → scope = podścieżka wdrożenia.
// Checklist wydania: 1) podbij CACHE tutaj i wersję w index.html/ui.js,
// 2) każdy NOWY plik aplikacji musi trafić do PRECACHE.

const CACHE = 'fire-v1.9.1';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/ui.js',
  './js/analysis.js',
  './js/simulation.js',
  './js/engine.js',
  './js/coach.js',
  './js/format.js',
  './js/storage.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' — omija HTTP cache przeglądarki; bez tego nowa wersja SW
      // może zaprecachować STARE pliki (GitHub Pages serwuje assety z max-age=600).
      .then(cache => cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Nawigacje: cache → sieć → app shell (offline'owy fallback tylko,
  // gdy nic innego nie ma; nie przechwytuje tests.html / tools).
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return caches.match('./index.html');
      }
    })());
    return;
  }

  // Pliki własne: cache-first z dogrywką z sieci.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return resp;
    }))
  );
});
