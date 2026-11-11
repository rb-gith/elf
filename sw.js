// Bump VERSION whenever any app file changes, so phones download the new version.
const VERSION = 'v3';
const CACHE = 'elf-' + VERSION;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'lang.js',
  'zip.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// 'reload' skips the browser's own short-term cache, so a new version never stores old copies.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('elf-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // The manifest (the app's name, icon and ID for installing) comes fresh from the internet when possible.
  if (new URL(e.request.url).pathname.endsWith('/manifest.webmanifest')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then(c => c.put('manifest.webmanifest', copy));
          return res;
        })
        .catch(() => caches.match('manifest.webmanifest'))
    );
    return;
  }
  // Everything else: cache first, so the app works fully offline once installed.
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
