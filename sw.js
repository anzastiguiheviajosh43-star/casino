const CACHE="mesa4-2.0.0";
const FILES=["./", "index.html", "casino.js", "adapter.js", "config.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js", "push.js", "r-jaja.png", "r-ctm.png", "r-faah.png", "r-dealer.png", "r-ride.png", "fondo.jpg"];
self.addEventListener("install",e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET" || u.origin!==location.origin) return;            // Firebase y fuentes van directo a internet
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{ const copy=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match("index.html"))));
});
self.addEventListener("push",e=>{ let d={}; try{ d=e.data?e.data.json():{}; }catch(_){ d={body:e.data?e.data.text():""}; }
  e.waitUntil(self.registration.showNotification(d.title||"Mesa de 4",{body:d.body||"",icon:"icon-192.png",badge:"icon-192.png",tag:d.tag||undefined,data:{url:d.url||"./"}})); });
self.addEventListener("notificationclick",e=>{ e.notification.close();
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{ for(const c of l){ if("focus" in c) return c.focus(); } return clients.openWindow((e.notification.data&&e.notification.data.url)||"./"); })); });
