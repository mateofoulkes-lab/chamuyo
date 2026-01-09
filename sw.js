/* Minimal SW for GitHub Pages / static hosting */
const CACHE = "chamuyo-mock-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./ui.js",
  "./connector.js",
  "./connector.mock.js",
  "./data/mock.json",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res.ok && e.request.method === "GET") cache.put(e.request, res.clone());
    return res;
  })());
});
