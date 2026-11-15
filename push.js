// ================= Avisos al cel (versión app) =================
// Cada cel que activa avisos guarda su "dirección de notificaciones" en Firebase (push/<cel>).
// Para avisar, la app junta esas direcciones y le pide al servidor de Cloudflare que las mande.
(function(){
  const URLW = window.PUSH_URL, KEY = window.PUSH_PUBLIC, TOK = window.PUSH_TOKEN;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  const standalone = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone===true;
  const supported = () => !!URLW && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const unb64u = s => { s=s.replace(/-/g,"+").replace(/_/g,"/"); while(s.length%4) s+="="; const b=atob(s); const u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; };
  const ref = () => (ST.db && ST.acct) ? ST.db.doc("push/"+ST.acct) : null;
  const btn = () => document.getElementById("pushBtn"), note = () => document.getElementById("pushNote");

  function paint(){
    const b=btn(), n=note(); if(!b) return;
    if(!URLW){ b.hidden=true; n.textContent=""; return; }
    if(isIOS && !standalone()){ b.hidden=true; n.textContent="Para recibir avisos, abre el casino desde el ícono de tu pantalla de inicio (Safari → Compartir → Agregar a pantalla de inicio)."; return; }
    if(!supported()){ b.hidden=true; n.textContent="Este cel no permite avisos de apps web (en iPhone se necesita iOS 16.4 o más nuevo)."; return; }
    const p=Notification.permission;
    b.hidden = p==="granted" && localStorage.getItem("mc-push")==="on";
    b.textContent = "🔔 Activar avisos en este cel";
    n.textContent = p==="denied" ? "Bloqueaste los avisos. Actívalos en Ajustes → Notificaciones → Mesa de 4."
      : (p==="granted" && localStorage.getItem("mc-push")==="on") ? "🔔 Avisos activados: te llega una notificación cuando alguien abra una mesa, entre a una mesa o te gane el puesto en el tablero."
      : "Te avisamos cuando alguien abra una mesa, entre a una mesa o te gane el puesto en el tablero, aunque tengas la app cerrada.";
  }

  async function save(sub){
    const r=ref(); if(!r||!sub) return;
    await r.set({alias:getAlias(), pid:ST.uid||"", sub:JSON.stringify(sub), at:Date.now()});
  }
  async function enable(){
    try{
      const p = await Notification.requestPermission();
      if(p!=="granted"){ paint(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if(!sub) sub = await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:unb64u(KEY)});
      await save(sub); localStorage.setItem("mc-push","on"); toast("🔔 Avisos activados");
    }catch(e){ console.error(e); toast("No se pudieron activar los avisos. Intenta otra vez."); }
    paint();
  }
  // Al abrir la app (o cambiar de apodo) se actualiza la dirección y el apodo guardados
  let touchT=null;
  function touch(){ clearTimeout(touchT); touchT=setTimeout(async()=>{
    if(!supported() || Notification.permission!=="granted") return;
    try{ const reg=await navigator.serviceWorker.ready; const sub=await reg.pushManager.getSubscription(); if(sub){ await save(sub); localStorage.setItem("mc-push","on"); } else localStorage.removeItem("mc-push"); }catch(e){}
    paint(); },1500); }

  // Manda un aviso. who(alias) decide a quién; nunca se avisa al propio cel.
  async function send(who, msg){
    if(!URLW || !ST.db) return;
    try{
      const qs = await ST.db.collection("push").get();
      const targets=[], ids=[]; const old=Date.now()-60*86400000;
      qs.docs.forEach(d=>{ const v=d.data()||{}; if(d.id===ST.acct || (v.at||0)<old || !who(normName(v.alias))) return;
        try{ targets.push(JSON.parse(v.sub)); ids.push(d.id); }catch(e){} });
      if(!targets.length) return;
      const r = await fetch(URLW, {method:"POST", headers:{"Content-Type":"text/plain"}, body:JSON.stringify(Object.assign({token:TOK, subs:targets, url:"./"}, msg))});
      const j = await r.json().catch(()=>({}));
      (j.status||[]).forEach((s,i)=>{ if(s===404||s===410) ST.db.doc("push/"+ids[i]).delete().catch(()=>{}); });   // cel que ya no existe
    }catch(e){}
  }

  // ---- 1) Alguien abre una mesa
  function mesaNueva(T){
    const me=getAlias();
    send(()=>true, {title:"🎲 Mesa nueva", body:`${me} abrió “${T.name}” (${GNAME[T.game]||"casino"}). Código ${T.code}`, tag:"mesa-"+T.code});
  }
  // ---- 2) Le ganas el puesto a alguien en el tablero (por fichas)
  function orderOf(agg){ return Object.values(agg).sort((a,b)=>b.chips-a.chips).map(r=>normName(r.name)); }
  function rankCheck(agg){
    const me=normName(getAlias()); if(!me) return;
    const now=orderOf(agg); const i=now.indexOf(me); if(i<0) return;
    let prev=null; try{ prev=JSON.parse(localStorage.getItem("mc-rank")||"null"); }catch(e){}
    localStorage.setItem("mc-rank", JSON.stringify({me, order:now.slice(0,20)}));
    if(!prev || prev.me!==me) return;
    const pi=prev.order.indexOf(me); if(pi<0 && prev.order.length>=20) return;
    const was = pi<0 ? prev.order.length : pi;
    if(i>=was) return;                                                    // no subiste
    const passed = prev.order.slice(i, was).filter(n=>n!==me && now.indexOf(n)>i);  // estaban arriba y ahora abajo
    if(!passed.length) return;
    const names = {}; Object.values(agg).forEach(r=>names[normName(r.name)]=r.name);
    const set=new Set(passed);
    send(n=>set.has(n), {title:"🏆 Te ganaron el puesto", body:`${getAlias()} te rebasó en el tablero: ahora va #${i+1} con ${fmt(agg[me]?agg[me].chips:0)} en fichas.`, tag:"rank"});
  }
  let rankT=null, rankLast=0;
  function rankSoon(){ clearTimeout(rankT); const wait=Math.max(4000, 60000-(Date.now()-rankLast));
    rankT=setTimeout(async()=>{ rankLast=Date.now(); try{ const docs=(await ST.db.collection("mesas").limit(300).get()).docs.map(d=>d.data()); rankCheck(boardAgg(docs)); }catch(e){} }, wait); }


  // ---- 3) Alguien se sienta en una mesa que ya existía: avisa a los que están en ella
  let joinT=null;
  function joinSoon(){
    const T0=ST.T; if(!T0) return; const code=T0.code||ST.code;
    const had=!!(T0.players && T0.players[ST.uid] && !T0.players[ST.uid].out);
    if(had) return;
    clearTimeout(joinT);
    joinT=setTimeout(()=>{
      const T=ST.T; if(!T || (T.code||ST.code)!==code) return;
      const p=T.players && T.players[ST.uid]; if(!p || p.out) return;          // no se pudo sentar
      const me=getAlias(), key="mc-joinpush:"+code+":"+normName(me);
      const last=+(localStorage.getItem(key)||0); if(Date.now()-last<10*60000) return;   // máximo un aviso cada 10 min
      const others=new Set(Object.entries(T.players).filter(([id,x])=>id!==ST.uid && x && !x.bot && !x.out && normName(x.name)!==normName(me)).map(([,x])=>normName(x.name)));
      localStorage.setItem(key, String(Date.now()));
      const meN=normName(me), where=`“${T.name}” (${GNAME[T.game]||"casino"})`;
      // a los que están en esa mesa: "llegó alguien a tu mesa"; a todos los demás: "X entró a una mesa"
      if(others.size) send(n=>others.has(n), {title:"🪑 Llegó alguien a tu mesa", body:`${me} se sentó en ${where}. ¡A jugar!`, tag:"join-"+code});
      send(n=>n!==meN && !others.has(n), {title:`🪑 ${me} entró a una mesa`, body:`Se sentó en ${where}. Código ${code}`, tag:"join-"+code});
    }, 3000);
  }
  window.PUSH = { enable, touch, paint, mesaNueva, rankCheck, rankSoon, joinSoon };
  document.addEventListener("click", e=>{ if(e.target && e.target.id==="pushBtn") enable(); });
  const start=()=>{ paint(); const wait=setInterval(()=>{ if(ST.acct){ clearInterval(wait); touch(); } },500); };
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
