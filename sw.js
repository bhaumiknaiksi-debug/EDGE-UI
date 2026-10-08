// EDGE PWA service worker.
// App shell may be cached; live market/API responses are never intentionally cached.
const CACHE = "edge-shell-v4";
const SHELL = ["/", "/index.html", "/manifest.json", "/edge-icon.svg", "/offline.html", "/pwa.js", "/web-push.js"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never interfere with API or any cross-origin request.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          // A transient HTML error page must never replace the cached app shell.
          if (response.ok && (response.headers.get("content-type") || "").includes("text/html")) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then(cache => cache.put("/index.html", copy)));
          }
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) || caches.match("/offline.html"))
    );
    return;
  }

  // Static same-origin assets: network first, cache fallback.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});


// Web Push from the trusted EDGE backend. Every received push is shown to the user.
// No cached market state is consulted; no client-side trading decisions are made.
self.addEventListener("push", event => {
  var message = {};
  try { message = event.data ? event.data.json() : {}; } catch (_) {}
  if (!message || typeof message !== "object") message = {};
  var title = typeof message.title === "string" ? message.title.slice(0, 90) : "EDGE update";
  var body = typeof message.body === "string" ? message.body.slice(0, 180) :
    "Open EDGE for the current backend state.";
  var kind = ["TEST", "EXECUTION_READY", "READY_INVALIDATED"].includes(message.type) ?
    message.type : "UPDATE";
  var tag = kind === "EXECUTION_READY" ? "edge-execution-ready" : "edge-" + kind.toLowerCase();

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: "/edge-icon.svg",
      badge: "/edge-icon.svg",
      tag: tag,
      data: { url: "/" }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    var windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (var windowClient of windows) {
      if (new URL(windowClient.url).origin === self.location.origin) {
        if (typeof windowClient.focus === "function") {
          await windowClient.focus();
          return;
        }
      }
    }
    if (clients.openWindow) await clients.openWindow("/");
  })());
});
