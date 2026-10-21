// Keeps the app working offline. Bump VERSION whenever app files change
// so phones pick up the new version.
var VERSION = "scoutco-v24";
var FILES = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icons/logo-wordmark-white.png",
  "icons/logo-full-white.png",
  "icons/favicon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  // Only handle this app's own files. Program data (Google) always goes to the network.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  // Network first, so updates show up straight away; fall back to the saved copy offline.
  event.respondWith(
    // no-cache: always ask GitHub for the latest file, never the browser's stale copy.
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || (req.mode === "navigate" ? caches.match("index.html") : undefined);
      });
    })
  );
});
