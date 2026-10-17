/* Plated service worker — the app has to open at a restaurant table with no signal. */
/* BUILD is rewritten by deploy.sh on every deploy. It has to change or the
   browser sees an identical service worker, keeps the old one, and the update
   never reaches the phone. */
const BUILD = '20261016-220523';
const PREFIX = 'plated-';
const CACHE = PREFIX + BUILD;
const SHELL = [
  './', './index.html', './styles.css', './db.js', './share.js', './places.js', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  /* cache: 'reload' skips the browser's HTTP cache (GitHub Pages sends
     max-age=600). Every file must come back 200: storing an error page from a
     half-published deploy would serve a blank app forever, so a bad response
     fails the install instead and the browser simply tries again next launch. */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => {
      if (!r.ok) throw new Error(u + ' -> ' + r.status);
      return c.put(u, r);
    }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  /* Every app lives on the same origin (efem-code.github.io), so they share
     one CacheStorage. Only clear this app's old builds, never another app's. */
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const fresh = req => fetch(req, { cache: 'no-cache' }).then(res => {
  if (res && res.ok && res.type === 'basic') {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return res;
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  /* The page itself: network first, so a fixed deploy always wins when
     online; the cached copy is only the offline fallback. */
  if (req.mode === 'navigate') {
    e.respondWith(fresh(req).then(res => res.ok ? res : caches.match('./index.html').then(hit => hit || res))
      .catch(() => caches.match('./index.html')));
    return;
  }
  /* Everything else: stale-while-revalidate — instant from the cache, with a
     background refetch so the next launch picks up a redeploy. */
  e.respondWith(caches.match(req, { cacheName: CACHE }).then(hit => {
    const net = fresh(req).catch(() => hit);
    return hit || net;
  }));
});
