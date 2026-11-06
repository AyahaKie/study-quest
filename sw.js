/* Study Quest network-first shell, versioned to avoid old UI persistence. */
const CACHE='studyquest-shell-v21';
const FILES=['./','./index.html','./app.css?v=21','./app.js?v=21','./manifest.webmanifest?v=21','./icon-192.png?v=21','./icon-512.png?v=21'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('studyquest-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==self.location.origin)return;
  e.respondWith(fetch(e.request).then(resp=>{if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{})}return resp}).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html'))));
});
