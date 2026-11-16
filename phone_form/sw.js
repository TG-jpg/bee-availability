// Keeps the page working with no signal: saves its own files the first time it loads.
// (It never stores or sends any customer data; entries live in the phone's localStorage.)
const CACHE = "bee-form-v9";   // change this number whenever the files change, so phones pick up the new version
const FILES = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

// Answer from the saved copy first (fast, works offline); refresh the saved copy quietly when there is signal.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (new URL(event.request.url).origin !== self.location.origin) return;     // never keep or reuse anything from Google
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((saved) => {
      const refresh = fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => saved);
      return saved || refresh;
    }));
});
