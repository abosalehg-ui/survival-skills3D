/* Service Worker for "النجاة في الصحراء" PWA */
const CACHE_VERSION = 'v5';
const STATIC_CACHE = `desert-survival-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `desert-survival-runtime-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

// Three.js comes from a CDN. Pre-caching the core module makes the game playable
// offline on the very FIRST launch (previously it only worked after an online run).
// The post-processing add-ons are progressive enhancement — the game falls back to a
// plain render path if they aren't cached — so they're cached best-effort.
const THREE_BASE = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const CDN_CORE = [THREE_BASE + 'build/three.module.js'];
const CDN_OPTIONAL = [
  THREE_BASE + 'examples/jsm/postprocessing/EffectComposer.js',
  THREE_BASE + 'examples/jsm/postprocessing/RenderPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/UnrealBloomPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/SMAAPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/OutputPass.js',
  THREE_BASE + 'examples/jsm/loaders/GLTFLoader.js',
];

// Same-origin optional assets: also progressive enhancement (the procedural camel is the
// permanent fallback — see setupCamelModel() in index.html), so missing/failing to cache
// this must never fail the install. This is the one deliberate, owner-approved exception to
// the project's "no external assets" rule; if the file isn't present in the repo yet,
// caching it here is a harmless no-op.
const LOCAL_OPTIONAL = [
  './assets/models/camel.glb',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Local assets must succeed for a valid install.
      await cache.addAll(STATIC_ASSETS);
      // CDN core: try to cache it, but don't fail install if currently offline.
      try { await cache.addAll(CDN_CORE); } catch (e) { /* will be picked up at runtime */ }
      // CDN optional add-ons: fully best-effort, one by one.
      await Promise.all(CDN_OPTIONAL.map((u) =>
        cache.add(u).catch(() => { /* progressive enhancement only */ })
      ));
      // Same-origin optional assets: same best-effort treatment.
      await Promise.all(LOCAL_OPTIONAL.map((u) =>
        cache.add(u).catch(() => { /* progressive enhancement only */ })
      ));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Navigation requests: network-first, fallback to cached index.html (offline)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only refresh the app-shell cache from a navigation that IS the app shell
          // (site root or an index.html path). Writing an arbitrary in-scope page
          // (e.g. /docs/…) over ./index.html would make the next offline launch serve
          // that page as the game until the user comes back online.
          const path = url.pathname;
          if (res.ok && (path === '/' || path.endsWith('/') || path.endsWith('/index.html'))) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Cross-origin (e.g. Three.js from jsdelivr): stale-while-revalidate.
  // Check ALL caches first (caches.match) so the install-time STATIC_CACHE copy of
  // three.module.js is found, then refresh into RUNTIME_CACHE in the background.
  event.respondWith(
    caches.match(req).then((cached) =>
      caches.open(RUNTIME_CACHE).then((cache) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
