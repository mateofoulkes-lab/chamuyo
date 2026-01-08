const CACHE = "chamuyo-test-v1";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // No cachear llamadas al backend
  if (url.pathname.endsWith("/api.php")) return;

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    const res = await fetch(e.request);
    return res;
  })());
});
