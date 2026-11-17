// ================= Puente Firebase para la versión app =================
// El casino usa window.claude.use("db" | "room" | "user"). Aquí se arma lo mismo con
// Firebase: Firestore para las mesas y la presencia, y login anónimo para identificar cada cel.
(function(){
  const cfg = window.FIREBASE_CONFIG;
  if(!cfg || !cfg.apiKey || /PEGA/.test(cfg.apiKey) || !window.firebase){ console.warn("Sin configuración de Firebase: modo un jugador"); return; }
  firebase.initializeApp(cfg);
  const fs = firebase.firestore();
  const ready = new Promise((resolve)=>{
    firebase.auth().onAuthStateChanged(u=>{ if(u) resolve(u); });
    firebase.auth().signInAnonymously().catch(e=>{ console.error("No se pudo entrar a Firebase", e); resolve(null); });
  });

  // Firestore no acepta listas dentro de listas ni valores undefined: cada documento se guarda
  // como texto JSON, más los campos sueltos que sirven para ordenar y filtrar la lista de mesas.
  const PLAIN = ["code","name","open","updated","created","game","at","creator"];
  const pack = d => { const o={__j:JSON.stringify(d)}; PLAIN.forEach(k=>{ const v=d&&d[k]; if(v!==undefined && (typeof v!=="object"||v===null)) o[k]=v; }); return o; };
  const unpack = raw => { if(!raw) return undefined; if(typeof raw.__j==="string"){ try{ return JSON.parse(raw.__j); }catch(e){} } return raw; };
  const wrapSnap = s => ({ id:s.id, exists:s.exists, metadata:s.metadata||{}, data:()=>unpack(s.data()) });
  const wrapQS = qs => { const docs=qs.docs.map(wrapSnap); return { docs, size:docs.length, empty:!docs.length,
      docChanges:()=>qs.docChanges().map(c=>({type:c.type, doc:wrapSnap(c.doc)})) }; };

  function docRef(path){
    const r=fs.doc(path);
    return {
      id:r.id, path,
      get: async()=>wrapSnap(await r.get()),
      set: async d=>{ await r.set(pack(JSON.parse(JSON.stringify(d)))); return {path}; },
      update: async d=>{ const cur=unpack((await r.get()).data())||{}; await r.set(pack(Object.assign(cur,JSON.parse(JSON.stringify(d))))); return {path}; },
      delete: async()=>{ await r.delete(); },
      onSnapshot:(cb,err)=>r.onSnapshot(s=>cb(wrapSnap(s)), e=>err&&err(e)),
      // cambio atómico: Firebase lee, aplica y guarda sin que otro cel lo pise (si chocan, lo reintenta solo)
      txn: fn=>fs.runTransaction(async tx=>{
        const s=await tx.get(r); if(!s.exists) return {ok:false, T:null};
        const T=unpack(s.data()); const ok=!!fn(T);
        if(ok) tx.set(r, pack(JSON.parse(JSON.stringify(T))));
        return {ok, T};
      }),
      collection:p=>collRef(path+"/"+p)
    };
  }
  // Las consultas se ordenan en Firebase; los filtros (where) se aplican aquí para no requerir índices
  function collRef(path,opts){
    opts=opts||{where:[],order:null,limit:null};
    const build=()=>{ let q=fs.collection(path); if(opts.order) q=q.orderBy(opts.order[0],opts.order[1]); if(opts.limit) q=q.limit(opts.where.length?Math.max(opts.limit*3,60):opts.limit); return q; };
    const filt=qs=>{ const w=wrapQS(qs); if(!opts.where.length) return w;
      const ok=d=>{ const v=d.data()||{}; return opts.where.every(([f,op,val])=> op==="=="||op==="eq" ? v[f]===val : op==="!="||op==="ne" ? v[f]!==val : true); };
      const docs=w.docs.filter(ok).slice(0,opts.limit||1e9); return {docs,size:docs.length,empty:!docs.length,docChanges:()=>w.docChanges().filter(c=>ok(c.doc))}; };
    const next=o=>collRef(path,Object.assign({},opts,o));
    return {
      path,
      doc:id=>docRef(path+"/"+id),
      where:(f,op,v)=>next({where:opts.where.concat([[f,op,v]])}),
      orderBy:(f,dir)=>next({order:[f,dir||"asc"]}),
      limit:n=>next({limit:n}),
      get: async()=>filt(await build().get()),
      onSnapshot:(cb,err)=>build().onSnapshot(qs=>cb(filt(qs)), e=>err&&err(e))
    };
  }
  const db = { doc:docRef, collection:p=>collRef(p) };

  // Presencia ("quién está en la mesa ahora"): cada cel escribe su latido en rooms/<sala>/peers/<cel>
  function room(){
    return {
      join: async name=>{
        const user=await ready; const by=user?user.uid:"anon";
        const tab=Math.random().toString(36).slice(2,10);
        const peers=fs.collection(`rooms/${name}/peers`), mine=peers.doc(tab);
        let pres={}, unsub=null, left=false;
        const write=()=>left?Promise.resolve():mine.set({by, p:JSON.stringify(pres), at:Date.now()}).catch(()=>{});
        window.addEventListener("pagehide",()=>{ mine.delete().catch(()=>{}); });
        return {
          emit: async()=>{},                 // Firestore ya avisa al instante; no hace falta "tick"
          on: ()=>()=>{},
          presence: async patch=>{ pres=Object.assign({},pres,patch||{}); await write(); },
          onPeers:(h)=>{ unsub=peers.onSnapshot(qs=>{
              const t=Date.now();
              const list=qs.docs.map(d=>{ const v=d.data(); let p={}; try{ p=JSON.parse(v.p||"{}"); }catch(e){}
                return {by:v.by, peer:d.id, presence:p, updatedAt:v.at||0, isMe:v.by===by, sameTab:d.id===tab}; })
                .filter(x=>x.sameTab || t-x.updatedAt<120000);
              h({peers:list});
            }, ()=>{}); return ()=>unsub&&unsub(); },
          peers: ()=>[],
          connected: ()=>navigator.onLine!==false,
          onConnection:(h)=>{ h(navigator.onLine!==false); const on=()=>h(true), off=()=>h(false);
            window.addEventListener("online",on); window.addEventListener("offline",off);
            return ()=>{ window.removeEventListener("online",on); window.removeEventListener("offline",off); }; },
          leave: async()=>{ left=true; unsub&&unsub(); await mine.delete().catch(()=>{}); }
        };
      }
    };
  }
  const user = {
    me: async()=>{ const u=await ready; return {id:u?u.uid:null, name:""}; },
    id: async()=>{ const u=await ready; return u?u.uid:null; },
    can: async()=>true, isOwner: ()=>false, canEdit: ()=>true
  };
  window.claude = { use: async n=>{ const u=await ready; if(!u) return null; return ({db, room:room(), user})[n]||null; } };
})();
