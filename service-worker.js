/* Service Worker for "النجاة في الصحراء" PWA */
const CACHE_VERSION = 'v7';
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

// Three.js is now vendored same-origin under assets/vendor/three (see the importmap note
// in index.html — the old CDN + importmap `integrity` pinning was silently ignored by
// Safari and Firefox). The core module is REQUIRED for the game to boot, so it is
// installed alongside the app shell and a failure to cache it fails the install.
const THREE_BASE = './assets/vendor/three/';
const THREE_CORE = [THREE_BASE + 'build/three.module.js'];
// Post-processing / loaders / merge utils are progressive enhancement — index.html falls
// back to a plain render path, the procedural camel and unmerged vehicles if any of these
// fail to load — so they are cached best-effort and never fail the install. Their own
// relative imports (Pass.js, ShaderPass.js, the shaders/) are listed too, because a
// half-cached add-on is an add-on that fails to import offline.
const THREE_OPTIONAL = [
  THREE_BASE + 'examples/jsm/postprocessing/EffectComposer.js',
  THREE_BASE + 'examples/jsm/postprocessing/RenderPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/UnrealBloomPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/SMAAPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/OutputPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/Pass.js',
  THREE_BASE + 'examples/jsm/postprocessing/ShaderPass.js',
  THREE_BASE + 'examples/jsm/postprocessing/MaskPass.js',
  THREE_BASE + 'examples/jsm/shaders/CopyShader.js',
  THREE_BASE + 'examples/jsm/shaders/LuminosityHighPassShader.js',
  THREE_BASE + 'examples/jsm/shaders/OutputShader.js',
  THREE_BASE + 'examples/jsm/shaders/SMAAShader.js',
  THREE_BASE + 'examples/jsm/loaders/GLTFLoader.js',
  THREE_BASE + 'examples/jsm/utils/BufferGeometryUtils.js',
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
      // App shell + the Three.js core: all same-origin now, and all required for a
      // playable offline install, so a failure here correctly fails the install.
      await cache.addAll(STATIC_ASSETS.concat(THREE_CORE));
      // Optional add-ons: fully best-effort, one by one.
      await Promise.all(THREE_OPTIONAL.map((u) =>
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

  // Same-origin static assets (which is now EVERYTHING, including Three.js): cache-first.
  // caches.match searches every cache, so the install-time STATIC_CACHE copy of
  // three.module.js is found before any network attempt.
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

  // Nothing cross-origin is fetched any more (the CDN dependency is gone and the CSP
  // forbids it). Anything that still turns up is left to the browser's default handling
  // rather than being cached — an opaque body can just as easily be a 404/5xx page, and
  // once written it would be served forever offline as if it were the real resource.
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
