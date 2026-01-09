/* Minimal SW for GitHub Pages / static hosting */
const CACHE = "chamuyo-mock-v2";
const ASSETS = [
  "./",
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
  if(e.request.mode === "navigate" || e.request.headers.get("accept")?.includes("text/html")){
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try{
        const res = await fetch(e.request);
        if(res.ok) cache.put(e.request, res.clone());
        return res;
      }catch{
        const cached = await cache.match(e.request) || await cache.match("./");
        return cached || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(e.request);
    if (cached) return cached;
    const res = await fetch(e.request);
    if (res.ok && e.request.method === "GET") cache.put(e.request, res.clone());
    return res;
  })());
});
