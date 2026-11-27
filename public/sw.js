/* Atelier3D Studio — Service Worker 100 % Hors-Ligne (PWA) */
const CACHE_NAME = 'atelier3d-pwa-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/apple-touch-icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/DejaVuSans.ttf',
  '/fonts/DejaVuSans-Bold.ttf',
  '/env/atelier_daylight_1k.hdr'
  /* __ATELIER_PRECACHE_MANIFEST__ */
];

const IMMUTABLE_PREFIXES = ['/assets/', '/textures/', '/env/', '/fonts/', '/icons/'];

function isImmutableStaticPath(pathname) {
  return IMMUTABLE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        // Resilient per-asset precaching so a single network hiccup never blocks installation
        await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            const response = await fetch(url, { cache: 'reload' });
            if (response && response.ok) {
              await cache.put(url, response);
            }
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('atelier3d-pwa-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  // 1. Immutable hashed bundles, PBR textures, HDRI, fonts & icons -> Cache-First
  if (isImmutableStaticPath(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response && response.status === 200) {
          void cache.put(request, response.clone());
        }
        return response;
      })
    );
    return;
  }

  // 2. HTML navigation & manifest -> Network-First with instant Offline Cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const exact = await cache.match(request);
        if (exact) return exact;
        if (request.mode === 'navigate') {
          const shell = (await cache.match('/index.html')) || (await cache.match('/'));
          if (shell) return shell;
        }
        return new Response('Mode hors-ligne actif — ressource non disponible.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      })
  );
});
