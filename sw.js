/* LUMIN standalone install and offline shell */
const CACHE_NAME = "lumin-shell-2026-11-05-fullscreen";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192x192.png", "./icon-512x512.png"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("lumin-shell-") && k !== CACHE_NAME).map(k => caches.delete(k)))),
    self.clients.claim()
  ]));
});
self.addEventListener("fetch", event => {
  const req=event.request;
  if(req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if(req.mode === "navigate") {
    event.respondWith(fetch(req).then(response => {
      if(response.ok){ const copy=response.clone(); caches.open(CACHE_NAME).then(c => c.put("./index.html", copy)); }
      return response;
    }).catch(() => caches.match("./index.html")));
  }
});
self.addEventListener("message", event => {
  if(!event.data || event.data.type !== "CACHE_NOW") return;
  event.waitUntil(caches.open(CACHE_NAME)
    .then(cache => cache.addAll(ASSETS))
    .then(() => {if(event.source)event.source.postMessage({type:"CACHE_READY",manual:true});})
    .catch(() => {}));
});
