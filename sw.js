// EDGE Service Worker — enables PWA install + offline mock fallback
const CACHE = "edge-v1";
const ASSETS = ["/", "/index.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Network first, cache fallback — so live data always attempts fresh
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
