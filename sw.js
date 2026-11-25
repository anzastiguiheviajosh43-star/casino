const CACHE="mesa4-2.3.0";
const FILES=["./", "index.html", "casino.js", "adapter.js", "config.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png", "firebase-app-compat.js", "firebase-auth-compat.js", "firebase-firestore-compat.js", "push.js", "r-jaja.png", "r-ctm.png", "r-faah.png", "r-dealer.png", "r-ride.png", "fondo.jpg", "emblemas.png"];
self.addEventListener("install",e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE&&!/-fonts$/.test(x)).map(x=>caches.delete(x)))).then(()=>self.clients.claim())); });
// Abrir rápido aunque el internet esté lento: usa lo guardado si la red tarda más de 2.5 s,
// y aprovecha la respuesta de internet (cuando llegue) para dejar lista la versión nueva.
const NET_WAIT=2500;
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method==="GET" && /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){   // letras: se guardan para el modo offline
    e.respondWith(caches.open(CACHE+"-fonts").then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{ c.put(e.request,r.clone()); return r; })))); return; }
  if(e.request.method!=="GET"||u.origin!==location.origin)return;   // Firebase y avisos van directo a internet
  const net=fetch(e.request,{cache:"no-cache"}).then(r=>{
    if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}
    return r});
  e.respondWith((async()=>{
    const saved=await caches.match(e.request,{ignoreSearch:true})||(e.request.mode==="navigate"?await caches.match("index.html"):undefined);
    if(!saved)return net.catch(()=>caches.match("index.html"));
    e.waitUntil(net.catch(()=>{}));
    return Promise.race([net.then(r=>r.ok?r:saved,()=>saved),new Promise(res=>setTimeout(()=>res(saved),NET_WAIT))]);
  })());
});
self.addEventListener("push",e=>{ let d={}; try{ d=e.data?e.data.json():{}; }catch(_){ d={body:e.data?e.data.text():""}; }
  e.waitUntil(self.registration.showNotification(d.title||"Mesa de 4",{body:d.body||"",icon:"icon-192.png",badge:"icon-192.png",tag:d.tag||undefined,data:{url:d.url||"./"}})); });
self.addEventListener("notificationclick",e=>{ e.notification.close();
  e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(l=>{ for(const c of l){ if("focus" in c) return c.focus(); } return clients.openWindow((e.notification.data&&e.notification.data.url)||"./"); })); });
