/* The Grassroots — Mobile service worker.
 * Offline-first app shell + shared data layer. Bump CACHE to ship an update. */
'use strict';

var CACHE = 'grassroots-mobile-v4';

// Everything the app needs to boot offline. Paths are relative to the SW scope
// (/platform/mobile/), so ../ reaches the shared platform assets.
var PRECACHE = [
  './',
  './index.html',
  './mobile.css?v=4',
  './mobile.js?v=4',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  '../assets/fonts.css',
  '../assets/Inter.woff2',
  '../js/seed.js?v=gr12',
  '../js/db.js?v=gr08'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Add resiliently: one 404 (e.g. a query-string mismatch) must not abort
      // the whole install, or the app never caches at all.
      return Promise.all(PRECACHE.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let cross-origin pass through

  // Navigation requests → serve the app shell (SPA behaviour, offline-friendly).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  // Everything else → stale-while-revalidate: fast from cache, refresh in the
  // background so the next load is current.
  e.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
