const CACHE_VERSION = "lumin-app-2026.09.08.2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./firebase-config.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

async function cacheAppShell(){
  const cache=await caches.open(CACHE_VERSION);
  await Promise.all(APP_SHELL.map(async url=>{
    try{
      const response=await fetch(url,{cache:"reload"});
      if(response.ok || response.type==="opaque") await cache.put(url,response);
    }catch{}
  }));
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    await cacheAppShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith("lumin-app-")&&k!==CACHE_VERSION).map(k=>caches.delete(k)));
    await self.clients.claim();
    const clients=await self.clients.matchAll({type:"window"});
    clients.forEach(client=>client.postMessage({type:"CACHE_READY"}));
  })());
});

self.addEventListener("message",event=>{
  if(!event.data) return;
  if(event.data.type==="SKIP_WAITING") self.skipWaiting();
  if(event.data.type==="CACHE_NOW"){
    event.waitUntil((async()=>{
      await cacheAppShell();
      if(event.source) event.source.postMessage({type:"CACHE_READY",manual:true});
    })());
  }
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;

  const url=new URL(request.url);
  const sameOrigin=url.origin===self.location.origin;
  const isNavigation=request.mode==="navigate";
  const cacheableExternal=
    url.hostname==="fonts.googleapis.com" ||
    url.hostname==="fonts.gstatic.com" ||
    (url.hostname==="www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));

  // Never cache Firebase data/auth API calls.
  if(!sameOrigin && !cacheableExternal) return;

  if(isNavigation){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(request);
        const cache=await caches.open(CACHE_VERSION);
        cache.put("./index.html",fresh.clone()).catch(()=>{});
        return fresh;
      }catch{
        return (await caches.match(request)) ||
               (await caches.match("./index.html")) ||
               (await caches.match("./"));
      }
    })());
    return;
  }

  event.respondWith((async()=>{
    const cached=await caches.match(request);
    const networkPromise=fetch(request).then(async response=>{
      if(response.ok || response.type==="opaque"){
        const cache=await caches.open(CACHE_VERSION);
        cache.put(request,response.clone()).catch(()=>{});
      }
      return response;
    }).catch(()=>null);

    if(cached){
      event.waitUntil(networkPromise);
      return cached;
    }
    const fresh=await networkPromise;
    if(fresh) return fresh;
    return new Response("",{status:504,statusText:"Offline"});
  })());
});
