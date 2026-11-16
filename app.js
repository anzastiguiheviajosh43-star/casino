(()=>{
const $=id=>document.getElementById(id);
const cv=$('cv'),ctx=cv.getContext('2d'),app=$('app');
const DIRS=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const MAXLIVES=3;
let T={},tokT=0;
const MES=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// =====================================================================
// ESTADO Y GUARDADO
// Cloud es el único punto que depende de Claude. En una app instalable
// (PWA) se reemplaza por Firebase y todo lo demás sigue igual.
// =====================================================================
const DEF={pid:'',name:'',seenCh:{},metas:{},level:1,stars:{},daily:{},ta:0,shapes:0,zen:0,skin:'auto',sound:true,vib:true,guide:false};
let S=JSON.parse(JSON.stringify(DEF)),hadLocal=false;
try{const j=JSON.parse(localStorage.getItem('fdc-state')||'null');
  if(j){S=Object.assign(S,j);hadLocal=true}
  else{const l=parseInt(localStorage.getItem('fdc-level'));if(l>1)S.level=l}}catch(e){}

const better=(x,y)=>!x?y:!y?x:(y.s!==x.s?(y.s>x.s?y:x):(y.t<x.t?y:x));
function mergeRemote(r){
  if(!r)return;
  S.level=Math.max(S.level||1,+r.level||1);
  for(const k in r.stars||{})S.stars[k]=Math.max(S.stars[k]||0,r.stars[k]);
  for(const k in r.daily||{})S.daily[k]=better(S.daily[k],r.daily[k]);
  S.seenCh=Object.assign({},r.seenCh||{},S.seenCh||{});S.metas=Object.assign({},r.metas||{},S.metas||{});
  S.ta=Math.max(S.ta||0,r.ta||0);S.shapes=Math.max(S.shapes||0,r.shapes||0);S.zen=Math.max(S.zen||0,r.zen||0);
  if(r.pid)S.pid=r.pid;if(r.name&&!S.name)S.name=r.name;
  if(!hadLocal)for(const k of['skin','sound','vib','guide'])if(k in r)S[k]=r[k];
}
function rid(n){const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=crypto.getRandomValues(new Uint8Array(n));let s='';r.forEach(x=>s+=A[x%A.length]);return s}
let CODE=null;try{CODE=localStorage.getItem('fdc-code')}catch(e){}
if(!CODE){CODE=rid(8);try{localStorage.setItem('fdc-code',CODE)}catch(e){}}
if(!S.pid)S.pid=rid(12);
const normName=s=>String(s||'').normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase();
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),ms))]);
// Nube con Firebase (proyecto del casino). Sin internet el juego sigue normal.
const Cloud={ok:false,loaded:false,names:{},
  get uid(){return S.pid},
  async init(){try{
    const cfg=window.FIREBASE_CONFIG;if(!cfg||!window.firebase)return false;
    if(!firebase.apps.length)firebase.initializeApp(cfg);
    const auth=firebase.auth();
    const u=await withTimeout(new Promise(res=>{const off=auth.onAuthStateChanged(x=>{off();res(x)})}),6000);
    if(!u)await withTimeout(auth.signInAnonymously(),8000);
    this.fs=firebase.firestore();this.ok=true;return true}catch(e){return false}},
  // Lee el progreso de una cuenta. Hasta que no se lea bien, este cel no sobrescribe nada en la nube.
  async loadPrivate(code){const k=code||CODE,s=await withTimeout(this.fs.collection('fdc_users').doc(k).get(),10000);
    if(!code||code===CODE)this.loaded=true;
    return s.exists?JSON.parse(s.data().__j):null},
  async codeForPid(pid){const q=await withTimeout(this.fs.collection('fdc_users').get(),10000);let out=null;
    q.docs.forEach(d=>{const v=d.data()||{};if(out)return;if(v.pid===pid){out=d.id;return}try{if(JSON.parse(v.__j).pid===pid)out=d.id}catch(e){}});return out},
  async listRaw(){const q=await withTimeout(this.fs.collection('fdc_daily').orderBy('updated','desc').limit(300).get(),10000);
    const out=[];q.docs.forEach(d=>{try{const data=JSON.parse(d.data().__j);if(data.name&&data.name.trim())out.push({id:d.id,data})}catch(e){}});return out},
  savePrivate(o){if(!this.loaded)return Promise.resolve();return this.fs.collection('fdc_users').doc(CODE).set({__j:JSON.stringify(o),pid:S.pid,updated:Date.now()})},
  // Solo apareces en el ranking cuando ya pusiste tu nombre
  savePublic(o){if(!S.name)return Promise.resolve();o.name=S.name;o.code=CODE;return this.fs.collection('fdc_daily').doc(S.pid).set({__j:JSON.stringify(o),updated:Date.now()})},
  async listPublic(){const q=await withTimeout(this.fs.collection('fdc_daily').orderBy('updated','desc').limit(300).get(),8000);
    // Sin nombre no cuenta; mismo nombre = misma persona (se queda con lo mejor de cada sesión)
    const by=new Map();
    q.docs.forEach(d=>{try{const data=JSON.parse(d.data().__j);if(!data.name||!data.name.trim())return;
      const k=normName(data.name),cur=by.get(k);
      if(!cur){by.set(k,{id:d.id,data});return}
      const top=(+data.level||1)>(+cur.data.level||1),a=top?data:cur.data,m={...a,level:Math.max(+a.level||1,+data.level||1),stars:Math.max(+a.stars||0,+data.stars||0),ta:Math.max(+a.ta||0,+data.ta||0),days:{...(a.days||{})}};
      for(const dk in data.days||{})m.days[dk]=better(m.days[dk],data.days[dk]);
      by.set(k,{id:d.id===S.pid?d.id:cur.id===S.pid?cur.id:(top?d.id:cur.id),data:m});
    }catch(e){}});
    const out=[...by.values()];out.forEach(r=>this.names[r.id]=r.data.name);return out},
  async profiles(ids){const o={};ids.forEach(id=>o[id]={name:this.names[id]||('Jugador '+id.slice(0,3))});return o}
};
function makeWriter(fn){let busy=false,again=false;
  const run=()=>{if(!Cloud.ok)return;if(busy){again=true;return}busy=true;
    Promise.resolve().then(fn).catch(()=>{}).finally(()=>{busy=false;if(again){again=false;run()}})};return run}
const pushPrivate=makeWriter(()=>Cloud.savePrivate(JSON.parse(JSON.stringify(S))));
function publicData(){const days={};Object.keys(S.daily).sort().slice(-45).forEach(k=>days[k]=S.daily[k]);
  return{days,ta:S.ta||0,level:S.level||1,stars:Object.values(S.stars).reduce((a,b)=>a+b,0),streak:streak().cur,updated:Date.now()}}
const pushPublic=makeWriter(()=>{rankCache.t=0;return Cloud.savePublic(publicData())});
function save(pub){
  try{localStorage.setItem('fdc-state',JSON.stringify(S));localStorage.setItem('fdc-level',S.level)}catch(e){}
  pushPrivate();if(pub)pushPublic();
}
(async()=>{
  if(!await Cloud.init()){refreshMenu();return}
  try{const r=await Cloud.loadPrivate();mergeRemote(r);applySkin();save(true)}catch(e){}
  if(S.name&&Cloud.loaded)await claimName(S.name,false,true);
  Push.touch();
  refreshMenu();if(view==='daily')renderDaily();if(view==='settings')renderSettings();if(view==='rank')renderLB();
})();

// ---------- Fechas y rachas ----------
const pad=n=>String(n).padStart(2,'0');
const keyOf=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const todayKey=()=>keyOf(new Date());
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
function streak(){
  let d=new Date();if(!S.daily[keyOf(d)])d=addDays(d,-1);
  let cur=0;while(S.daily[keyOf(d)]){cur++;d=addDays(d,-1)}
  const keys=Object.keys(S.daily).sort();let best=0,run=0,prev=null;
  for(const k of keys){const d2=new Date(k+'T12:00');run=(prev&&Math.round((d2-prev)/864e5)===1)?run+1:1;best=Math.max(best,run);prev=d2}
  return{cur,best:Math.max(best,cur),total:keys.length};
}
const fmtT=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+pad(s%60)};
const starStr=n=>'★'.repeat(n)+'<span class="off">'+'★'.repeat(3-n)+'</span>';

// =====================================================================
// SONIDO Y VIBRACIÓN (sintetizados, funcionan sin internet)
// =====================================================================
const SFX={c:null,combo:0,last:0,
  ac(){if(!S.sound)return null;try{if(!this.c){const A=window.AudioContext||window.webkitAudioContext;if(!A)return null;this.c=new A()}
    if(this.c.state==='suspended')this.c.resume();return this.c}catch(e){return null}},
  tone(f1,f2,dur,type,vol,delay=0){const c=this.ac();if(!c)return;const t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(f1,t);o.frequency.exponentialRampToValueAtTime(f2,t+dur);
    g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g).connect(c.destination);o.start(t);o.stop(t+dur+0.03)},
  pop(){const now=performance.now();this.combo=now-this.last<1400?Math.min(this.combo+1,14):0;this.last=now;
    const b=440*Math.pow(2,this.combo/12);this.tone(b,b*1.8,0.13,'sine',0.13)},
  crash(){this.tone(180,60,0.22,'triangle',0.22);this.tone(95,50,0.16,'square',0.04)},
  win(){[523,659,784,1047].forEach((f,i)=>this.tone(f,f*1.01,0.24,'triangle',0.12,i*0.09))},
  tick(){this.tone(1300,1250,0.05,'square',0.035)},
  sel(){this.tone(700,760,0.06,'sine',0.06)}
};
const buzz=ms=>{if(S.vib)try{navigator.vibrate&&navigator.vibrate(ms)}catch(e){}};
document.addEventListener('pointerdown',()=>SFX.ac(),{once:true});

// =====================================================================
// GENERADOR DE CUBOS (siempre con solución)
// =====================================================================
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const SHAPES=[
  {name:'Pirámide',dims:[7,4,7],m:(x,y,z)=>Math.max(Math.abs(x-3),Math.abs(z-3))<=3-y},
  {name:'Escalera',dims:[6,6,4],m:(x,y,z)=>y<=5-x},
  {name:'Cruz',dims:[7,7,7],m:(x,y,z)=>[x,y,z].filter(v=>v>=2&&v<=4).length>=2},
  {name:'Anillo',dims:[7,3,7],m:(x,y,z)=>Math.max(Math.abs(x-3),Math.abs(z-3))>=2},
  {name:'Esfera',dims:[7,7,7],m:(x,y,z)=>(x-3)**2+(y-3)**2+(z-3)**2<=10.5},
  {name:'Torre',dims:[3,9,3],m:null},
  {name:'Letra L',dims:[6,6,3],m:(x,y,z)=>x<3||y<3},
  {name:'Puente',dims:[7,5,3],m:(x,y,z)=>y>=3||x<2||x>4},
];
// Capítulos de 10 niveles; el último de cada capítulo es una Meta
const CHAPTERS=[
  {name:'Calentamiento',desc:'Flechas cortas y muchas salidas. Aprende a leer el cubo.'},
  {name:'Laberinto',desc:'De aquí se viene más complicado: las salidas fáciles casi desaparecen. Antes de tocar, fíjate qué bloquea a cada flecha.'},
  {name:'Profundidades',desc:'Cubos más grandes: las flechas cruzan todo el cubo y tapan a otras desde adentro.'},
  {name:'Nudos',desc:'Flechas más largas que se enredan entre sí. Una mala elección traba medio cubo.'},
  {name:'Formas raras',desc:'Los cubos dejan de ser cubos: pirámides, cruces y escaleras con flechas escondidas.'},
  {name:'Maestro',desc:'Lo más grande y enredado del juego. Aquí ya no hay regalos.'}];
const chapterOf=n=>Math.floor((n-1)/10)+1;
const chInfo=c=>{const i=Math.min(c,CHAPTERS.length)-1,b=CHAPTERS[i];return{name:c>CHAPTERS.length?b.name+' '+(c-CHAPTERS.length+1):b.name,desc:b.desc}};
const isMeta=n=>n%10===0;
const metaName=n=>n===10?'Graduación':SHAPES[(chapterOf(n)-2)%SHAPES.length].name;
const levelCfg=n=>{const c=chapterOf(n),b=Math.min(4+Math.floor((n-1)/2),9);
  if(isMeta(n)&&n>10){const sh=SHAPES[(c-2)%SHAPES.length];
    // La forma se agranda para que la meta sea el reto más grande del capítulo
    const big=Math.min(9+Math.floor(c/3),11),k=big/Math.max(...sh.dims),D=sh.dims.map(v=>Math.max(1,Math.round(v*k)));
    const mask=sh.m?(x,y,z)=>sh.m(Math.floor(x*sh.dims[0]/D[0]),Math.floor(y*sh.dims[1]/D[1]),Math.floor(z*sh.dims[2]/D[2])):null;
    return{seed:n*7919+13,dims:D,mask,minL:4,maxL:16,triv:0,lm:1.5,name:sh.name,meta:true}}
  const cfg={seed:n*7919+13,dims:[b,(n%3===2&&b>4)?b-1:b,b],minL:3,maxL:Math.min(4+Math.floor(n/2),16),legacy:n<=10,triv:n<=14?0.06:0,meta:n===10,name:n===10?'Graduación':undefined};
  if(c>=4)cfg.lm=1.5;                                         // Nudos: flechas más largas
  if(c>=5&&n%3===0){const sh=SHAPES[n%SHAPES.length],k=9/Math.max(...sh.dims),D=sh.dims.map(v=>Math.max(1,Math.round(v*k)));  // Formas raras
    cfg.dims=D;cfg.mask=sh.m?(x,y,z)=>sh.m(Math.floor(x*sh.dims[0]/D[0]),Math.floor(y*sh.dims[1]/D[1]),Math.floor(z*sh.dims[2]/D[2])):null}
  return cfg};
const dailyCfg=k=>{const d=new Date(k+'T12:00'),sz=[7,5,5,6,6,6,7][d.getDay()];
  return{seed:parseInt(k.replace(/-/g,''))*31+7,dims:[sz,sz,sz],minL:3,maxL:11,legacy:k<'2026-11-17',triv:0.3}};  // agilidad
const taCfg=(i,seed)=>{const sz=i<2?3:i<5?4:5;return{seed:seed+i*101,dims:[sz,sz,sz],minL:2,maxL:6,triv:0.25}};  // rápido, pero no regalado
const zenCfg=seed=>{const sz=5+seed%3;return{seed,dims:[sz,sz,sz],minL:3,maxL:12,triv:0.2}};
const shapeCfg=i=>{const sh=SHAPES[i%SHAPES.length];return{seed:5000+i*97,dims:sh.dims,mask:sh.m,minL:3,maxL:10,name:sh.name}};

function makeLevel(cfg){
  if(cfg.legacy)return makeLevelV1(cfg);
  const r=rng(cfg.seed);
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  const s=cfg.dims,N=s[0]*s[1]*s[2];
  const idx=(x,y,z)=>x+s[0]*(y+s[1]*z);
  const xyz=i=>[i%s[0],Math.floor(i/s[0])%s[1],Math.floor(i/(s[0]*s[1]))];
  const inB=(x,y,z)=>x>=0&&y>=0&&z>=0&&x<s[0]&&y<s[1]&&z<s[2];
  const valid=new Uint8Array(N);for(let i=0;i<N;i++){const p=xyz(i);valid[i]=cfg.mask?(cfg.mask(...p)?1:0):1}
  const owner=new Int32Array(N).fill(-1);
  const rayFree=(h,d,set)=>{let[x,y,z]=xyz(h);x+=d[0];y+=d[1];z+=d[2];
    while(inB(x,y,z)){const j=idx(x,y,z);if(owner[j]>=0||set.has(j))return false;x+=d[0];y+=d[1];z+=d[2]}return true};
  const dirOf=(a,b)=>{const A=xyz(a),B=xyz(b);return[B[0]-A[0],B[1]-A[1],B[2]-A[2]]};
  const order=[...Array(N).keys()].filter(i=>valid[i]).map(i=>{const[x,y,z]=xyz(i);
    const dep=Math.min(x,y,z,s[0]-1-x,s[1]-1-y,s[2]-1-z);return[i,-dep*(cfg.w??1)+r()*1.7]}).sort((a,b)=>a[1]-b[1]).map(a=>a[0]);
  const snakes=[];
  for(const c of order){
    if(owner[c]>=0)continue;
    const target=Math.round((cfg.minL+Math.floor(r()*(cfg.maxL-cfg.minL+1)))*(cfg.lm??1.25));
    const path=[c],inP=new Set(path);let last=null;
    while(path.length<target){
      const cur=xyz(path[path.length-1]);
      const opts=DIRS.filter(d=>{const x=cur[0]+d[0],y=cur[1]+d[1],z=cur[2]+d[2];
        if(!inB(x,y,z))return false;const j=idx(x,y,z);return valid[j]&&owner[j]<0&&!inP.has(j)});
      if(!opts.length)break;
      const d=(last&&opts.includes(last)&&r()<(cfg.straight??0.3))?last:opts[Math.floor(r()*opts.length)];
      const nx=idx(cur[0]+d[0],cur[1]+d[1],cur[2]+d[2]);path.push(nx);inP.add(nx);last=d;
    }
    // Elegir orientación/recorte: evitar puntas en la orilla apuntando hacia afuera (salen "gratis")
    // Cuántas casillas de la figura hay enfrente (apuntar al vacío cuenta como salida regalada)
    const rayLen=(h,d)=>{let[x,y,z]=xyz(h),n=0;x+=d[0];y+=d[1];z+=d[2];while(inB(x,y,z)){if(valid[idx(x,y,z)])n++;x+=d[0];y+=d[1];z+=d[2]}return n};
    const triv=cfg.triv??0;
    let placed=null,trivial=null;
    for(let k=path.length;k>=1&&!placed;k--){
      const parts=k===path.length?[path]:[path.slice(0,k),path.slice(path.length-k)];
      const cand=[];
      for(const p of parts){
        const set=new Set(p);
        if(p.length===1){for(const d of DIRS)if(rayFree(p[0],d,set))cand.push({cells:p.slice(),d,len:rayLen(p[0],d)})}
        else{
          const d1=dirOf(p[p.length-2],p[p.length-1]);if(rayFree(p[p.length-1],d1,set))cand.push({cells:p.slice(),d:d1,len:rayLen(p[p.length-1],d1)});
          const d2=dirOf(p[1],p[0]);if(rayFree(p[0],d2,set))cand.push({cells:p.slice().reverse(),d:d2,len:rayLen(p[0],d2)});
        }
      }
      const good=cand.filter(c=>c.len>0);
      if(good.length){good.sort((a,b)=>b.len-a.len);placed=r()<0.6?good[0]:good[Math.floor(r()*good.length)]}
      else if(cand.length&&!trivial)trivial=cand[Math.floor(r()*cand.length)];
      if(!placed&&trivial&&r()<triv)placed=trivial;
    }
    if(!placed&&trivial&&r()<(cfg.fill??0.1))placed=trivial;
    if(placed){const id=snakes.length;placed.cells.forEach(i=>owner[i]=id);
      snakes.push({id,cells:placed.cells,d:placed.d,alive:true,shake:-1,flash:-1})}
  }
  // Rellenar huecos alargando colas de flechas, solo si el cubo sigue teniendo solución
  if(cfg.pack!==false){
    const solvable=()=>{const own=Int32Array.from(owner),alive=new Set(snakes.map(s=>s.id));
      while(alive.size){let moved=false;
        for(const id of [...alive]){const sn=snakes[id],h=xyz(sn.cells[sn.cells.length-1]),d=sn.d;let x=h[0]+d[0],y=h[1]+d[1],z=h[2]+d[2],ok=true;
          while(inB(x,y,z)){const o=own[idx(x,y,z)];if(o>=0&&o!==id){ok=false;break}x+=d[0];y+=d[1];z+=d[2]}
          if(ok){alive.delete(id);sn.cells.forEach(c=>own[c]=-1);moved=true}}
        if(!moved)return false}return true};
    for(let pass=0;pass<3;pass++){let changed=false;
      for(const h of shuffle([...Array(N).keys()].filter(i=>valid[i]&&owner[i]<0))){
        const p=xyz(h);
        for(const n of shuffle(DIRS.slice())){const x=p[0]+n[0],y=p[1]+n[1],z=p[2]+n[2];if(!inB(x,y,z))continue;
          const o=owner[idx(x,y,z)];if(o<0)continue;const sn=snakes[o];if(sn.cells[0]!==idx(x,y,z)||sn.cells.length>=cfg.maxL*2)continue;
          sn.cells.unshift(h);owner[h]=o;
          if(solvable()){changed=true;break}
          sn.cells.shift();owner[h]=-1;}
      }
      if(!changed)break}
  }
  const info=new Map();
  for(const sn of snakes)sn.cells.forEach((c,i)=>{const conns=[];
    if(i>0)conns.push(dirOf(c,sn.cells[i-1]));
    if(i<sn.cells.length-1)conns.push(dirOf(c,sn.cells[i+1]));
    info.set(c,{conns,head:i===sn.cells.length-1})});
  return{s,N,idx,xyz,inB,owner,snakes,info,left:snakes.length,total:snakes.length,lives:MAXLIVES,crashes:0,moves:0,
    flying:[],state:'play',hint:null,hintT:-1,sel:null,undoUsed:false,t0:performance.now(),
    ctr:[(s[0]-1)/2,(s[1]-1)/2,(s[2]-1)/2],R:0.5*Math.hypot(...s)};
}
// Generador anterior: solo para retos hasta el 16 nov 2026, para que el cubo de esos días no cambie
function makeLevelV1(cfg){
  const r=rng(cfg.seed);
  const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(r()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  const s=cfg.dims,N=s[0]*s[1]*s[2];
  const idx=(x,y,z)=>x+s[0]*(y+s[1]*z);
  const xyz=i=>[i%s[0],Math.floor(i/s[0])%s[1],Math.floor(i/(s[0]*s[1]))];
  const inB=(x,y,z)=>x>=0&&y>=0&&z>=0&&x<s[0]&&y<s[1]&&z<s[2];
  const valid=new Uint8Array(N);for(let i=0;i<N;i++){const p=xyz(i);valid[i]=cfg.mask?(cfg.mask(...p)?1:0):1}
  const owner=new Int32Array(N).fill(-1);
  const rayFree=(h,d,set)=>{let[x,y,z]=xyz(h);x+=d[0];y+=d[1];z+=d[2];
    while(inB(x,y,z)){const j=idx(x,y,z);if(owner[j]>=0||set.has(j))return false;x+=d[0];y+=d[1];z+=d[2]}return true};
  const dirOf=(a,b)=>{const A=xyz(a),B=xyz(b);return[B[0]-A[0],B[1]-A[1],B[2]-A[2]]};
  const order=[...Array(N).keys()].filter(i=>valid[i]).map(i=>{const[x,y,z]=xyz(i);
    const dep=Math.min(x,y,z,s[0]-1-x,s[1]-1-y,s[2]-1-z);return[i,-dep+r()*1.7]}).sort((a,b)=>a[1]-b[1]).map(a=>a[0]);
  const snakes=[];
  for(const c of order){
    if(owner[c]>=0)continue;
    const target=cfg.minL+Math.floor(r()*(cfg.maxL-cfg.minL+1));
    const path=[c],inP=new Set(path);let last=null;
    while(path.length<target){
      const cur=xyz(path[path.length-1]);
      const opts=DIRS.filter(d=>{const x=cur[0]+d[0],y=cur[1]+d[1],z=cur[2]+d[2];
        if(!inB(x,y,z))return false;const j=idx(x,y,z);return valid[j]&&owner[j]<0&&!inP.has(j)});
      if(!opts.length)break;
      const d=(last&&opts.includes(last)&&r()<0.55)?last:opts[Math.floor(r()*opts.length)];
      const nx=idx(cur[0]+d[0],cur[1]+d[1],cur[2]+d[2]);path.push(nx);inP.add(nx);last=d;
    }
    let placed=null;
    while(path.length&&!placed){
      const set=new Set(path);
      if(path.length===1){for(const d of shuffle(DIRS.slice()))if(rayFree(path[0],d,set)){placed={cells:path.slice(),d};break}}
      else{
        const tries=[()=>{const d=dirOf(path[path.length-2],path[path.length-1]);return rayFree(path[path.length-1],d,set)&&{cells:path.slice(),d}},
                     ()=>{const d=dirOf(path[1],path[0]);return rayFree(path[0],d,set)&&{cells:path.slice().reverse(),d}}];
        if(r()<0.5)tries.reverse();
        placed=tries[0]()||tries[1]()||null;
      }
      if(!placed)path.pop();
    }
    if(placed){const id=snakes.length;placed.cells.forEach(i=>owner[i]=id);
      snakes.push({id,cells:placed.cells,d:placed.d,alive:true,shake:-1,flash:-1})}
  }
  const info=new Map();
  for(const sn of snakes)sn.cells.forEach((c,i)=>{const conns=[];
    if(i>0)conns.push(dirOf(c,sn.cells[i-1]));
    if(i<sn.cells.length-1)conns.push(dirOf(c,sn.cells[i+1]));
    info.set(c,{conns,head:i===sn.cells.length-1})});
  return{s,N,idx,xyz,inB,owner,snakes,info,left:snakes.length,total:snakes.length,lives:MAXLIVES,crashes:0,moves:0,
    flying:[],state:'play',hint:null,hintT:-1,sel:null,undoUsed:false,t0:performance.now(),
    ctr:[(s[0]-1)/2,(s[1]-1)/2,(s[2]-1)/2],R:0.5*Math.hypot(...s)};
}
function blocker(g,sn){
  const h=g.xyz(sn.cells[sn.cells.length-1]),d=sn.d;
  let x=h[0]+d[0],y=h[1]+d[1],z=h[2]+d[2];
  while(g.inB(x,y,z)){const o=g.owner[g.idx(x,y,z)];if(o>=0&&o!==sn.id)return{sn:g.snakes[o],at:[x,y,z]};x+=d[0];y+=d[1];z+=d[2]}
  return null;
}

// =====================================================================
// VISTAS
// =====================================================================
let view='menu';
const VIEWS={menu:'vMenu',game:'vGame',daily:'vDaily',levels:'vLevels',settings:'vSettings',rank:'vRank'};
function show(v){
  view=v;for(const k in VIEWS)$(VIEWS[k]).hidden=k!==v;
  $('ov').hidden=true;
  if(v==='menu')refreshMenu();if(v==='daily')renderDaily();if(v==='levels')renderLevels();if(v==='rank')renderLB();if(v==='settings')renderSettings();
}
document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>show('menu'));

function refreshMenu(){
  const st=streak(),dk=todayKey(),dd=S.daily[dk];
  {const L=S.level,left=10*chapterOf(L)-L;$('mPlayLvl').textContent=`Nivel ${L} · `+(left===0?'🏁 ¡Meta!':`meta en ${left}`)}
  $('mStreak').textContent=st.cur?`🔥 ${st.cur} día${st.cur>1?'s':''} de racha`:'Saca cada flecha sin chocar';
  $('mDailyB').textContent=dd?'Hecho ✓':'Nuevo';$('mDailyB').className='badge'+(dd?' done':'');
  $('mTAs').textContent=S.ta?`Récord: ${S.ta}`:'60 segundos';
  $('mZens').textContent=S.zen?`${S.zen} cubos vaciados`:'Sin vidas ni tiempo';
  $('mShapess').textContent=S.shapes?`${S.shapes} completadas`:'Pirámide, esfera…';
  const tot=Object.values(S.stars).reduce((a,b)=>a+b,0);
  $('mLevelss').textContent=tot?`${tot} ★ ganadas`:'Repite y saca ★★★';
  refreshRank();
}
function applySkin(){const r=document.documentElement;if(S.skin==='auto')r.removeAttribute('data-skin');else r.setAttribute('data-skin',S.skin);tokT=0}
applySkin();

let toastT=0;
function toast(msg){const t=$('toast');t.textContent=msg;t.hidden=false;t.style.opacity=1;clearTimeout(toastT);
  toastT=setTimeout(()=>{t.style.opacity=0;setTimeout(()=>t.hidden=true,300)},1600)}

function dialog(html,actions){
  const d=$('dlg');d.innerHTML=html;const box=document.createElement('div');box.className='btns';
  actions.forEach(([label,fn,primary])=>{const b=document.createElement('button');b.textContent=label;if(primary)b.className='primary';b.onclick=fn;box.appendChild(b)});
  d.appendChild(box);$('ov').hidden=false;
}
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// =====================================================================
// PARTIDA
// =====================================================================
let G=null,MODE=null; // MODE: {type:'level'|'daily'|'ta'|'zen'|'shape', ...}
const camG={yaw:-0.62,pitch:0.5,vy:0,vp:0,zoom:1,panX:0,panY:0};
const camM={yaw:-0.62,pitch:0.45,vy:0,vp:0,zoom:1,panX:0,panY:0};
let DEMO=makeLevel(shapeCfg(0));

function resetCam(){Object.assign(camG,{yaw:-0.62,pitch:0.5,vy:0,vp:0,zoom:1,panX:0,panY:0})}
function play(mode){
  MODE=mode;let cfg;
  if(mode.type==='level')cfg=levelCfg(mode.n);
  else if(mode.type==='daily')cfg=dailyCfg(mode.key);
  else if(mode.type==='ta')cfg=taCfg(mode.i,mode.seed);
  else if(mode.type==='zen')cfg=zenCfg(mode.seed);
  else cfg=shapeCfg(mode.i);
  G=makeLevel(cfg);G.name=cfg.name;
  if(mode.type!=='ta')resetCam();
  $('cGuide').setAttribute('aria-pressed',S.guide?'true':'false');
  show('game');hud();
}
function startLevel(n){
  const c=chapterOf(n);
  if(n>1&&(n-1)%10===0&&!S.seenCh[c]){S.seenCh[c]=1;save();return chapterIntro(c,()=>startLevel(n))}
  if(isMeta(n))return metaIntro(n);
  play({type:'level',n});
}
function chapterIntro(c,go){
  const ch=chInfo(c),first=10*(c-1)+1;
  dialog(`<div class="chtag">Capítulo ${c}</div><h2>${esc(ch.name)}</h2><p>${esc(ch.desc)}</p><p class="small">Niveles ${first} al ${first+9} · 🏁 Meta en el nivel ${first+9}</p>`,
    [['¡Vamos!',go,true],['Menú',()=>show('menu')]]);
}
function metaIntro(n){
  const c=chapterOf(n);
  dialog(`<div class="metaico">🏁</div><div class="chtag">Meta ${c} · Nivel ${n}</div><h2>${esc(metaName(n))}</h2><p>El último reto del capítulo ${esc(chInfo(c).name)}. Supéralo para abrir el capítulo ${c+1}.</p>`,
    [['Jugar la meta',()=>play({type:'level',n}),true],['Ahora no',()=>show('menu')]]);
}
function startTA(){const seed=Math.floor(Math.random()*1e6);TA={score:0,end:0,running:false,last:-1,seed,i:0};play({type:'ta',i:0,seed})}
let TA=null;

function hud(){
  const m=MODE.type;
  const lbl={level:()=>isMeta(MODE.n)?['Nivel '+MODE.n+' · 🏁 Meta '+chapterOf(MODE.n),G.name||metaName(MODE.n)]:['Nivel',MODE.n],daily:()=>{const d=new Date(MODE.key+'T12:00');return['Reto diario',d.getDate()+' '+MES[d.getMonth()].slice(0,3)]},
    ta:()=>['Contrarreloj','Cubo '+(MODE.i+1)],zen:()=>['Zen','Cubo '+((S.zen||0)+1)],shape:()=>['Formas',G.name]}[m]();
  $('gLblS').textContent=lbl[0];$('gLbl').textContent=lbl[1];
  $('gCntS').textContent=m==='ta'?'Puntos':'Flechas';
  $('gCnt').textContent=m==='ta'?TA.score:G.left;
  $('gProg').style.width=(100*(G.total-G.left)/Math.max(1,G.total))+'%';
  const hasLives=m!=='ta'&&m!=='zen';
  $('gLives').hidden=!hasLives;$('gTimer').hidden=m!=='ta';
  if(hasLives){const heart='<svg viewBox="0 0 24 24"><path d="M12 20.5 4.2 12.9A4.9 4.9 0 0 1 11.2 6l.8.8.8-.8a4.9 4.9 0 0 1 7 6.9z"/></svg>';
    let h='';for(let i=0;i<MAXLIVES;i++)h+=`<span class="${i<G.lives?'on':'off'}">${heart}</span>`;$('gLives').innerHTML=h}
  $('cUndo').disabled=!(hasLives&&G.lives<MAXLIVES&&!G.undoUsed&&G.state==='play');
  $('cRestart').textContent=m==='ta'?'Nueva':'Reiniciar';
}

function tapSnake(sn){
  if(G.state!=='play')return;
  const guide=S.guide;
  if(guide&&G.sel!==sn){G.sel=sn;SFX.sel();$('gTip').textContent='Toca otra vez la misma flecha para soltarla.';$('gTip').style.opacity=1;return}
  G.sel=null;move(sn);
}
function move(sn){
  const now=performance.now();G.moves++;$('gTip').style.opacity=0;
  if(MODE.type==='ta'&&!TA.running){TA.running=true;TA.end=now+60000}
  const b=blocker(G,sn);
  if(!b){
    const E=sn.cells.map(c=>{const p=G.xyz(c);return[p[0]-G.ctr[0],p[1]-G.ctr[1],p[2]-G.ctr[2]]});
    const ext=Math.ceil(G.R*2)+4,h=E[E.length-1];
    for(let j=1;j<=ext;j++)E.push(add(h,sn.d,j));
    sn.cells.forEach(c=>G.owner[c]=-1);sn.alive=false;G.left--;
    G.flying.push({E,ext,len:sn.cells.length-1,t0:now,dur:Math.min(900,420+sn.cells.length*25)});
    if(G.hint===sn)G.hint=null;
    if(MODE.type==='ta')TA.score++;
    SFX.pop();buzz(12);hud();return;
  }
  sn.shake=now;b.sn.flash=now;SFX.crash();buzz(70);
  if(MODE.type==='ta'){TA.end-=3000;toast('−3 s');return}
  if(MODE.type==='zen'){return}
  G.lives--;G.crashes++;hud();
  if(G.lives<=0){G.state='lose';setTimeout(()=>dialog(`<h2>Sin vidas</h2><p>Esa flecha chocó. El cubo es el mismo, ya conoces el camino.</p>`,
    [['Reintentar',()=>play(MODE),true],['Menú',()=>show('menu')]]),450)}
}

function onCleared(){
  const m=MODE.type,stars=Math.max(1,3-G.crashes);
  if(m==='ta'){TA.i++;TA.end+=5000;toast('+5 s · cubo vaciado');const keep={...camG};play({type:'ta',i:TA.i,seed:TA.seed});Object.assign(camG,keep);return}
  if(m==='zen'){S.zen=(S.zen||0)+1;save();SFX.win();toast('Cubo vaciado ✓');G.state='done';
    setTimeout(()=>{if(view==='game'&&MODE.type==='zen')play({type:'zen',seed:Math.floor(Math.random()*1e6)})},700);return}
  G.state='win';SFX.win();buzz(30);
  const errs=G.crashes;
  if(m==='level'){
    S.stars[MODE.n]=Math.max(S.stars[MODE.n]||0,stars);if(MODE.n>=S.level)S.level=MODE.n+1;
    if(isMeta(MODE.n)){const c=chapterOf(MODE.n),nx=chInfo(c+1);S.metas[c]=1;S.seenCh[c+1]=1;save(true);setTimeout(()=>SFX.win(),450);
      dialog(`<div class="metaico">🏁</div><div class="stars">${starStr(stars)}</div><h2>¡Meta ${c} superada!</h2><p>Terminaste el capítulo ${esc(chInfo(c).name)}.</p>
        <div class="next"><div class="chtag">Sigue: Capítulo ${c+1}</div><b>${esc(nx.name)}</b><p>${esc(nx.desc)}</p></div>`,
        [[`Empezar capítulo ${c+1}`,()=>startLevel(MODE.n+1),true],['Menú',()=>show('menu')]]);
      return}
    save(true);
    dialog(`<div class="stars">${starStr(stars)}</div><h2>Nivel ${MODE.n} listo</h2><p>${G.total} flechas · ${errs?errs+' choque'+(errs>1?'s':''):'sin choques'}</p>`,
      [['Siguiente nivel',()=>startLevel(MODE.n+1),true],['Menú',()=>show('menu')]]);
  }else if(m==='daily'){
    const t=performance.now()-G.t0,res={s:stars,t:Math.round(t),c:errs};
    const prev=S.daily[MODE.key];S.daily[MODE.key]=better(prev,res);save(true);if(!prev)Push.retoHecho(MODE.key,res);
    const st=streak();
    dialog(`<div class="stars">${starStr(stars)}</div><h2>Reto completado</h2><p>${fmtT(t)} · ${errs?errs+' choque'+(errs>1?'s':''):'sin choques'}</p><p>🔥 Racha: ${st.cur} día${st.cur>1?'s':''}</p>`,
      [['Copiar resultado',()=>share(MODE.key),true],['Ver ranking',()=>{lbTab='day';show('rank')}],['Menú',()=>show('menu')]]);
  }else if(m==='shape'){
    S.shapes=Math.max(S.shapes||0,MODE.i+1);save();
    dialog(`<div class="stars">${starStr(stars)}</div><h2>${esc(G.name)} lista</h2><p>${G.total} flechas · ${errs?errs+' choque'+(errs>1?'s':''):'sin choques'}</p>`,
      [['Siguiente forma',()=>play({type:'shape',i:MODE.i+1}),true],['Menú',()=>show('menu')]]);
  }
}
function taOver(){
  G.state='over';TA.running=false;const rec=TA.score>(S.ta||0);
  if(rec){S.ta=TA.score;save(true)}
  SFX.win();
  dialog(`<h2>${rec?'¡Nuevo récord!':'Se acabó el tiempo'}</h2><div style="font-family:var(--font-num);font-size:3rem;font-weight:900">${TA.score}</div><p>flechas · récord ${S.ta}</p>`,
    [['Otra vez',startTA,true],['Ver ranking',()=>{lbTab='ta';show('rank')}],['Menú',()=>show('menu')]]);
}

function share(key){
  const r=S.daily[key];if(!r)return;const d=new Date(key+'T12:00'),st=streak();
  const txt=`Fuga Cubes · Reto ${d.getDate()} ${MES[d.getMonth()].slice(0,3)} 🧊\n${'⭐'.repeat(r.s)}${'▫️'.repeat(3-r.s)} · ${fmtT(r.t)} · ${r.c?r.c+' choque'+(r.c>1?'s':''):'sin choques'}\n🔥 Racha: ${st.cur} día${st.cur>1?'s':''}`;
  const fallback=()=>{dialog(`<h2>Tu resultado</h2><p>Mantén presionado para copiarlo.</p><textarea id="shTxt" rows="4" readonly>${esc(txt)}</textarea>`,[['Listo',()=>{$('ov').hidden=true;if(view!=='game'&&view!=='daily')show('menu')},true]]);
    const ta=$('shTxt');ta.focus();ta.select()};
  if(navigator.share){navigator.share({text:txt}).catch(()=>{});return}
  try{navigator.clipboard.writeText(txt).then(()=>toast('Resultado copiado'),fallback)}catch(e){fallback()}
}

// ---------- Controles ----------
$('gBack').onclick=()=>{if(TA)TA.running=false;show('menu')};
$('cRestart').onclick=()=>{if(MODE.type==='ta')startTA();else play(MODE)};
$('cHint').onclick=()=>{
  if(!G||G.state!=='play')return;
  const exposed=sn=>sn.cells.some(c=>{const p=G.xyz(c);return DIRS.some(n=>{const x=p[0]+n[0],y=p[1]+n[1],z=p[2]+n[2];return!G.inB(x,y,z)||G.owner[G.idx(x,y,z)]<0})});
  const free=G.snakes.filter(sn=>sn.alive&&!blocker(G,sn));
  const sn=free.find(exposed)||free[0];if(sn){G.hint=sn;G.hintT=performance.now()}
};
$('cGuide').onclick=()=>{S.guide=!S.guide;save();$('cGuide').setAttribute('aria-pressed',S.guide?'true':'false');if(G)G.sel=null;
  toast(S.guide?'Guía activada':'Guía desactivada')};
$('cUndo').onclick=()=>{if(!G||G.undoUsed||G.lives>=MAXLIVES)return;G.lives++;G.undoUsed=true;hud();toast('Recuperaste una vida')};
$('zIn').onclick=()=>zoomAt(VW/2,VH/2,1.3);
$('zOut').onclick=()=>zoomAt(VW/2,VH/2,1/1.3);
$('zReset').onclick=resetCam;

$('mPlay').onclick=()=>startLevel(S.level);
$('mDaily').onclick=()=>show('daily');
$('mTA').onclick=startTA;
$('mZen').onclick=()=>play({type:'zen',seed:Math.floor(Math.random()*1e6)});
$('mShapes').onclick=()=>play({type:'shape',i:S.shapes||0});
$('mLevels').onclick=()=>show('levels');
$('mSettings').onclick=()=>show('settings');

// ---------- Panel: reto diario ----------
let calM=new Date();calM.setDate(1);let lbTab='gen';
$('dRank').onclick=()=>{lbTab='day';show('rank')};
function renderDaily(){
  const k=todayKey(),r=S.daily[k],d=new Date();
  $('dDate').textContent='Hoy · '+d.getDate()+' de '+MES[d.getMonth()];
  $('dStatus').textContent=r?fmtT(r.t)+(r.c?` · ${r.c} choque${r.c>1?'s':''}`:' · sin choques'):'Sin jugar';
  $('dStars').innerHTML=r?starStr(r.s):'';
  $('dPlay').textContent=r?'Jugar otra vez (cuenta el mejor)':'Jugar el reto de hoy';
  $('dShare').hidden=!r;
  const st=streak();$('kStreak').textContent=st.cur;$('kBest').textContent=st.best;$('kTotal').textContent=st.total;
  renderCal();
}
$('dPlay').onclick=()=>play({type:'daily',key:todayKey()});
$('dShare').onclick=()=>share(todayKey());
$('calPrev').onclick=()=>{calM.setMonth(calM.getMonth()-1);renderCal()};
$('calNext').onclick=()=>{calM.setMonth(calM.getMonth()+1);renderCal()};
function renderCal(){
  $('calTitle').textContent=MES[calM.getMonth()]+' '+calM.getFullYear();
  let h=['L','M','M','J','V','S','D'].map(x=>`<div class="h">${x}</div>`).join('');
  const first=(calM.getDay()+6)%7,days=new Date(calM.getFullYear(),calM.getMonth()+1,0).getDate(),tk=todayKey(),now=new Date();
  for(let i=0;i<first;i++)h+='<div></div>';
  for(let dd=1;dd<=days;dd++){const dt=new Date(calM.getFullYear(),calM.getMonth(),dd),k=keyOf(dt),r=S.daily[k];
    const cls=['d',r?'done':'',k===tk?'today':'',dt>now&&k!==tk?'fut':''].join(' ');
    h+=`<div class="${cls}">${dd}${r?`<i>${'★'.repeat(r.s)}</i>`:''}</div>`}
  $('cal').innerHTML=h;
}
// ---------- Ranking ----------
let rankCache={t:0,rows:null},lbReq=0;
async function getRows(force){
  if(!Cloud.ok)return null;
  if(!force&&rankCache.rows&&Date.now()-rankCache.t<60000)return rankCache.rows;
  const rows=await Cloud.listPublic();rankCache={t:Date.now(),rows};return rows;
}
function rankList(rows,tab){
  // Tu fila siempre con tus datos más recientes de este cel
  rows=rows.filter(r=>r.id!==Cloud.uid).concat([{id:Cloud.uid,data:publicData()}]);
  const k=todayKey();let ent;
  if(tab==='gen'){ent=rows.map(r=>({id:r.id,v:{level:+r.data.level||1,stars:+r.data.stars||0}}));
    ent.sort((a,b)=>b.v.level-a.v.level||b.v.stars-a.v.stars)}
  else if(tab==='day'){ent=rows.map(r=>({id:r.id,v:r.data.days&&r.data.days[k]})).filter(e=>e.v);ent.sort((a,b)=>b.v.s-a.v.s||a.v.t-b.v.t)}
  else{ent=rows.map(r=>({id:r.id,v:+r.data.ta||0})).filter(e=>e.v>0);ent.sort((a,b)=>b.v-a.v)}
  return ent;
}
let rankBusy=false;
async function refreshRank(){
  const el=$('mRank');
  if(!Cloud.ok||rankBusy){if(!Cloud.ok)el.hidden=true;return}
  rankBusy=true;
  try{const rows=await getRows();if(!rows)return;
    const g=rankList(rows,'gen'),i=g.findIndex(e=>e.id===Cloud.uid);
    const d=rankList(rows,'day'),j=d.findIndex(e=>e.id===Cloud.uid);
    let h=`🏆 <b>#${i+1}</b> <span>de ${g.length}</span>`;
    if(j>=0)h+=` <span>· Hoy #${j+1}</span>`;
    el.innerHTML=h;el.hidden=false;
  }catch(e){}finally{rankBusy=false}
}
$('mRank').onclick=()=>{lbTab='gen';show('rank')};
$('tbGen').onclick=()=>{lbTab='gen';renderLB()};$('tbDay').onclick=()=>{lbTab='day';renderLB()};$('tbTA').onclick=()=>{lbTab='ta';renderLB()};
async function renderLB(){
  ['Gen','Day','TA'].forEach(t=>$('tb'+t).setAttribute('aria-pressed',lbTab===t.toLowerCase()));
  const lb=$('lb'),note=$('lbNote'),me=$('rkMe');
  if(!Cloud.ok){lb.innerHTML='';me.hidden=true;note.textContent='La tabla necesita internet. Ábrela con señal para verla.';return}
  const req=++lbReq;if(!lb.children.length)lb.innerHTML='<li><span class="nm muted">Cargando…</span></li>';note.textContent='';
  let rows=[];
  try{rows=await getRows(true)}catch(e){if(req===lbReq){lb.innerHTML='';note.textContent='No se pudo cargar la tabla. Revisa tu conexión.'}return}
  if(req!==lbReq)return;
  const ent=rankList(rows,lbTab),myI=ent.findIndex(e=>e.id===Cloud.uid);
  const what={gen:'en el ranking general',day:'en el reto de hoy',ta:'en contrarreloj'}[lbTab];
  if(myI>=0){me.innerHTML=`<div><small>Tu posición ${what}</small><span class="n">#${myI+1}</span></div><small style="text-align:right">de ${ent.length} jugador${ent.length>1?'es':''}</small>`;me.hidden=false}
  else{me.innerHTML=`<div><small>Tu posición ${what}</small><b>${lbTab==='day'?'Juega el reto de hoy para entrar':'Haz un récord para entrar'}</b></div>`;me.hidden=false}
  if(!ent.length){lb.innerHTML='';note.textContent=lbTab==='day'?'Nadie ha jugado el reto de hoy todavía.':'Nadie tiene récord en contrarreloj todavía.';
    note.textContent+=' Pásales el link de la app a tus amigos para competir.';return}
  const ps=await Cloud.profiles(ent.slice(0,50).map(e=>e.id));if(req!==lbReq)return;
  lb.innerHTML='';
  const medal=['🥇','🥈','🥉'];
  ent.slice(0,50).forEach((e,i)=>{const p=ps[e.id]||{},li=document.createElement('li');if(e.id===Cloud.uid)li.className='me';
    const pos=document.createElement('span');pos.className='pos';pos.textContent=medal[i]||i+1;li.appendChild(pos);
    if(p.avatarUrl){const im=document.createElement('img');im.src=p.avatarUrl;im.alt='';li.appendChild(im)}
    const nm=document.createElement('span');nm.className='nm';nm.textContent=(p.name||'Jugador')+(e.id===Cloud.uid?' (tú)':'');li.appendChild(nm);
    const sc=document.createElement('span');sc.className='sc';
    if(lbTab==='gen')sc.textContent=`Nivel ${e.v.level} · ${e.v.stars}★`;
    else if(lbTab==='day'){sc.innerHTML=`<span class="stars">${starStr(e.v.s)}</span> `;sc.append(fmtT(e.v.t))}
    else sc.textContent=e.v+' pts';
    li.appendChild(sc);lb.appendChild(li)});
  note.textContent=S.name?'Apareces como «'+S.name+'». Cámbialo en Ajustes.':'Ponte un apodo en Ajustes para que te reconozcan.';
}

// ---------- Panel: niveles ----------
function renderLevels(){
  const g=$('lvGrid');g.innerHTML='';const top=Math.max(S.level+4,10*chapterOf(S.level));
  const tot=Object.values(S.stars).reduce((a,b)=>a+b,0),mt=Object.keys(S.metas||{}).length;
  $('lvSum').textContent=`${S.level-1} niveles completados · ${tot} de ${(S.level-1)*3} estrellas · ${mt} meta${mt===1?'':'s'} 🏁`;
  for(let n=1;n<=top;n++){
    if((n-1)%10===0){const c=chapterOf(n),h=document.createElement('div');h.className='chh';
      h.innerHTML=`<span>Capítulo ${c}</span><b>${esc(chInfo(c).name)}</b>`;g.appendChild(h)}
    const b=document.createElement('button'),st=S.stars[n]||0,locked=n>S.level,meta=isMeta(n);
    b.innerHTML=`${meta?'🏁 ':''}${n}<small class="stars">${locked?'<span class="off">···</span>':n<S.level?starStr(st):'<span style="color:var(--accent)">Jugar</span>'}</small>`;
    b.className=(meta?'meta ':'')+(n===S.level?'cur':'');if(meta)b.title='Meta: '+metaName(n);
    b.disabled=locked;b.onclick=()=>startLevel(n);g.appendChild(b)}
}

// ---------- Panel: ajustes ----------
const SKINS=[['auto','Automático'],['light','Claro'],['dark','Oscuro'],['neon','Neón'],['paper','Papel']];
function renderSettings(){
  const c=$('skins');c.innerHTML='';
  SKINS.forEach(([k,l])=>{const b=document.createElement('button');b.textContent=l;b.setAttribute('aria-pressed',S.skin===k);
    b.onclick=()=>{S.skin=k;applySkin();save();renderSettings()};c.appendChild(b)});
  $('sSound').checked=S.sound;$('sVib').checked=S.vib;$('sGuide').checked=S.guide;
  $('syncNote').textContent=Cloud.ok?'Se guarda en este cel y en la nube. Sin internet se guarda aquí y se sube cuando vuelvas a tener señal.':'Se guarda en este cel. Sin conexión ahorita; se sube a la nube cuando vuelvas a tener señal.';
  $('sCode').textContent=CODE.slice(0,4)+'-'+CODE.slice(4);
  if(document.activeElement!==$('sName'))$('sName').value=S.name||'';
  Push.paint();
}
$('sSound').onchange=e=>{S.sound=e.target.checked;save();if(S.sound)SFX.pop()};
$('sVib').onchange=e=>{S.vib=e.target.checked;save();buzz(40)};
$('sGuide').onchange=e=>{S.guide=e.target.checked;save()};
$('sNameSave').onclick=()=>{const v=$('sName').value.trim().slice(0,20);if(v.length<2){toast('Escribe al menos 2 letras');return}claimName(v,false)};
$('sCodeCopy').onclick=()=>{const t=CODE.slice(0,4)+'-'+CODE.slice(4);try{navigator.clipboard.writeText(t).then(()=>toast('Código copiado'),()=>toast(t))}catch(e){toast(t)}};
$('sLink').onclick=async()=>{
  const v=$('sLinkIn').value.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(v.length!==8){toast('El código tiene 8 letras o números');return}
  if(v===CODE){toast('Ese es el código de este cel');return}
  if(!Cloud.ok){toast('Necesitas internet para vincular');return}
  const old=CODE;CODE=v;
  try{const r=await Cloud.loadPrivate();if(!r){CODE=old;toast('No encontré ese código');return}
    try{localStorage.setItem('fdc-code',CODE)}catch(e){}
    mergeRemote(r);if(r.pid)S.pid=r.pid;applySkin();save(true);$('sLinkIn').value='';renderSettings();refreshMenu();toast('Cels vinculados ✓')}
  catch(e){CODE=old;toast('No se pudo vincular. Revisa tu conexión.')}
};
let resetArm=0;
$('sReset').onclick=()=>{const b=$('sReset');
  if(Date.now()-resetArm>3500){resetArm=Date.now();b.textContent='Toca otra vez para borrar todo';b.style.borderColor='var(--danger)';b.style.color='var(--danger)';
    setTimeout(()=>{b.textContent='Borrar todo mi progreso';b.style.borderColor='';b.style.color=''},3500);return}
  const keep={skin:S.skin,sound:S.sound,vib:S.vib,guide:S.guide};S=Object.assign(JSON.parse(JSON.stringify(DEF)),keep);save(true);
  b.textContent='Borrar todo mi progreso';b.style.borderColor='';b.style.color='';toast('Progreso borrado');refreshMenu();
};

// =====================================================================
// RENDER 3D
// =====================================================================
let W=0,H=0,DPR=1,VW=0,VH=0,CX=0,CY=0,D=10,F=300,CAM=camG;
const add=(a,b,s=1)=>[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function rot(v){const cy=Math.cos(CAM.yaw),sy=Math.sin(CAM.yaw),cp=Math.cos(CAM.pitch),sp=Math.sin(CAM.pitch);
  const x1=v[0]*cy+v[2]*sy,z1=-v[0]*sy+v[2]*cy;return[x1,v[1]*cp-z1*sp,v[1]*sp+z1*cp]}
function proj(v){const r=rot(v),k=F/(D-r[2]);return[CX+CAM.panX+r[0]*k,CY+CAM.panY-r[1]*k,k]}
function hex(h){h=h.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h,16);return[n>>16&255,n>>8&255,n&255]}
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
const rgb=(c,f=1,a=1)=>`rgba(${Math.round(Math.min(255,c[0]*f))},${Math.round(Math.min(255,c[1]*f))},${Math.round(Math.min(255,c[2]*f))},${a})`;
function tokens(now){if(now-tokT<600&&T.tile)return;tokT=now;const s=getComputedStyle(document.documentElement);
  for(const k of['tile','edge','arrow','accent','danger','ok'])T[k]=hex(s.getPropertyValue('--'+k).trim()||'#888')}
const LGT=(()=>{const l=[0.35,0.75,0.55],m=Math.hypot(...l);return l.map(v=>v/m)})();
const tang=n=>n[0]?[[0,1,0],[0,0,1]]:n[1]?[[1,0,0],[0,0,1]]:[[1,0,0],[0,1,0]];

let picks=[],drag=false;
function stageRect(){
  const el=view==='menu'?$('menuStage'):$('gameStage');const a=app.getBoundingClientRect(),r=el.getBoundingClientRect();
  return{x:r.left-a.left,y:r.top-a.top,w:r.width,h:r.height};
}
function drawCube(g,now,interactive){
  const sr=stageRect();VW=sr.w;VH=sr.h;CX=sr.x+sr.w/2;CY=sr.y+sr.h/2;
  D=g.R*4.2;F=Math.min(sr.w,sr.h)*(interactive?0.6:0.52)*(D-g.R)/g.R*CAM.zoom;
  const faces=[];
  // Posición de la cámara en coordenadas del cubo (deshaciendo el giro)
  const CP=(()=>{const cy=Math.cos(CAM.yaw),sy=Math.sin(CAM.yaw),cp=Math.cos(CAM.pitch),sp=Math.sin(CAM.pitch);
    const y1=D*sp,z1=D*cp;return[-z1*sy,y1,z1*cy]})();
  for(const sn of g.snakes){
    if(!sn.alive)continue;
    let off=[0,0,0];
    if(sn.shake>=0){const t=(now-sn.shake)/340;if(t<1){const a=0.16*Math.sin(t*28)*(1-t);off=[sn.d[0]*a,sn.d[1]*a,sn.d[2]*a]}else sn.shake=-1}
    for(const c of sn.cells){
      const p=g.xyz(c),base=[p[0]-g.ctr[0]+off[0],p[1]-g.ctr[1]+off[1],p[2]-g.ctr[2]+off[2]];
      for(const n of DIRS){
        const x=p[0]+n[0],y=p[1]+n[1],z=p[2]+n[2];
        if(g.inB(x,y,z)&&g.owner[g.idx(x,y,z)]>=0)continue;
        const fc=add(base,n,0.5),rf=rot(fc),rn=rot(n);
        if(rn[0]*-rf[0]+rn[1]*-rf[1]+rn[2]*(D-rf[2])<=0)continue;
        const vx=-rf[0],vy=-rf[1],vz=D-rf[2],face=(rn[0]*vx+rn[1]*vy+rn[2]*vz)/Math.hypot(vx,vy,vz);
        faces.push({sn,c,n,fc,rn,face,dist:Math.abs(base[0]-CP[0])+Math.abs(base[1]-CP[1])+Math.abs(base[2]-CP[2])});
      }
    }
  }
  faces.sort((a,b)=>b.dist-a.dist);
  if(interactive)picks=[];
  ctx.lineJoin='round';ctx.lineCap='round';
  for(const f of faces){
    const sn=f.sn,[u,v]=tang(f.n);
    const pts=[add(add(f.fc,u,.5),v,.5),add(add(f.fc,u,.5),v,-.5),add(add(f.fc,u,-.5),v,-.5),add(add(f.fc,u,-.5),v,.5)].map(proj);
    const k=pts[0][2];
    let tile=T.tile,ink=T.arrow;
    if(g.hint===sn&&g.hintT>=0){const t=(now-g.hintT)/2000;
      if(t<1){const a=Math.abs(Math.sin(t*Math.PI*3));tile=mix(tile,T.accent,0.35*a);ink=mix(ink,T.accent,0.9*a)}else g.hint=null}
    if(g.sel===sn){tile=mix(tile,T.accent,0.18);ink=T.accent}
    if(sn.flash>=0){const t=(now-sn.flash)/700;if(t<1){tile=mix(tile,T.danger,0.4*(1-t));ink=mix(ink,T.danger,1-t)}else sn.flash=-1}
    if(sn.shake>=0)ink=T.danger;
    const lit=0.80+0.20*Math.max(0,dot(f.rn,LGT));
    ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
    ctx.fillStyle=rgb(tile,lit);ctx.fill();
    ctx.strokeStyle=rgb(T.edge,1,0.55);ctx.lineWidth=Math.max(0.5,k*0.012);ctx.stroke();
    ctx.save();ctx.clip();if(f.face<0.32)ink=mix(tile,ink,Math.max(0.35,f.face/0.32));
    const inf=g.info.get(f.c),C=f.fc,lw=Math.max(1.3,k*0.1);
    ctx.strokeStyle=rgb(ink);ctx.fillStyle=rgb(ink);ctx.lineWidth=lw;
    let drew=false;
    ctx.beginPath();
    for(const e of inf.conns){if(dot(e,f.n)!==0)continue;const a=proj(C),b=proj(add(C,e,0.5));ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);drew=true}
    if(inf.head&&dot(sn.d,f.n)===0){const a=proj(C),b=proj(add(C,sn.d,0.18));ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);drew=true}
    ctx.stroke();
    if(inf.head){
      const dn=dot(sn.d,f.n);
      if(dn===0){const w=cross(f.n,sn.d);
        const tip=proj(add(C,sn.d,0.44)),w1=proj(add(add(C,sn.d,0.1),w,0.22)),w2=proj(add(add(C,sn.d,0.1),w,-0.22));
        ctx.beginPath();ctx.moveTo(tip[0],tip[1]);ctx.lineTo(w1[0],w1[1]);ctx.lineTo(w2[0],w2[1]);ctx.closePath();ctx.lineWidth=lw*0.5;ctx.fill();ctx.stroke();
      }else{const ring=[];for(let i=0;i<18;i++){const a=i/18*Math.PI*2;ring.push(proj(add(add(C,u,Math.cos(a)*0.15),v,Math.sin(a)*0.15)))}
        ctx.beginPath();ring.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();
        if(dn>0)ctx.fill();else{ctx.lineWidth=lw*0.7;ctx.stroke()}}
      drew=true;
    }
    if(!drew&&inf.conns.length){const a=proj(C);ctx.beginPath();ctx.arc(a[0],a[1],lw*0.45,0,Math.PI*2);ctx.fill()}
    ctx.restore();
    if(interactive)picks.push({sn,pts});
  }
  // Línea guía de la flecha seleccionada
  if(interactive&&g.sel&&g.sel.alive){
    const sn=g.sel,h=g.xyz(sn.cells[sn.cells.length-1]),hp=[h[0]-g.ctr[0],h[1]-g.ctr[1],h[2]-g.ctr[2]];
    const b=blocker(g,sn);let endW;
    if(b)endW=[b.at[0]-g.ctr[0]-sn.d[0]*0.5,b.at[1]-g.ctr[1]-sn.d[1]*0.5,b.at[2]-g.ctr[2]-sn.d[2]*0.5];
    else{let n=0,x=h[0],y=h[1],z=h[2];while(g.inB(x+sn.d[0],y+sn.d[1],z+sn.d[2])){x+=sn.d[0];y+=sn.d[1];z+=sn.d[2];n++}endW=add(hp,sn.d,n+2.2)}
    const a=proj(add(hp,sn.d,0.45)),e=proj(endW),lw=Math.max(1.5,a[2]*0.07);
    ctx.save();ctx.setLineDash([lw*2.2,lw*1.8]);ctx.lineWidth=lw;ctx.strokeStyle=rgb(b?T.danger:T.ok);
    ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(e[0],e[1]);ctx.stroke();ctx.restore();
    ctx.fillStyle=rgb(b?T.danger:T.ok);ctx.beginPath();ctx.arc(e[0],e[1],lw*1.6,0,Math.PI*2);ctx.fill();
  }
  // Flechas saliendo
  g.flying=g.flying.filter(fl=>{
    const t=Math.max(0,(now-fl.t0)/fl.dur);if(t>=1)return false;
    const s=fl.ext*(0.25*t+0.75*t*t),E=fl.E,kk=fl.len;
    const at=q=>{const i=Math.min(Math.floor(q),E.length-2),fr=q-i;return[E[i][0]+(E[i+1][0]-E[i][0])*fr,E[i][1]+(E[i+1][1]-E[i][1])*fr,E[i][2]+(E[i+1][2]-E[i][2])*fr]};
    const ws=[at(s)];for(let i=Math.ceil(s);i<s+kk;i++)if(i>s)ws.push(E[i]);ws.push(at(s+kk));
    const P=ws.map(proj),tip=P[P.length-1],back=proj(at(Math.max(s,s+kk-0.35)));
    const alpha=1-Math.max(0,(t-0.55)/0.45),lw=Math.max(1.3,tip[2]*0.1);
    ctx.globalAlpha=alpha;ctx.strokeStyle=rgb(T.accent);ctx.fillStyle=rgb(T.accent);ctx.lineWidth=lw;
    ctx.beginPath();P.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();
    let dx=tip[0]-back[0],dy=tip[1]-back[1];const m=Math.hypot(dx,dy)||1;dx/=m;dy/=m;const hs=lw*2.6;
    ctx.beginPath();ctx.moveTo(tip[0]+dx*hs*0.6,tip[1]+dy*hs*0.6);ctx.lineTo(tip[0]-dx*hs*0.6-dy*hs*0.7,tip[1]-dy*hs*0.6+dx*hs*0.7);
    ctx.lineTo(tip[0]-dx*hs*0.6+dy*hs*0.7,tip[1]-dy*hs*0.6-dx*hs*0.7);ctx.closePath();ctx.fill();
    ctx.globalAlpha=1;return true;
  });
}

function frame(now){
  requestAnimationFrame(frame);
  if(!W)return;
  ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
  if(view!=='menu'&&view!=='game')return;
  tokens(now);
  CAM=view==='menu'?camM:camG;
  if(!drag){CAM.yaw+=CAM.vy;CAM.pitch=Math.max(-1.45,Math.min(1.45,CAM.pitch+CAM.vp));CAM.vy*=0.92;CAM.vp*=0.92}
  if(view==='menu'){if(!drag)CAM.yaw+=0.004;drawCube(DEMO,now,false);return}
  if(!G)return;
  {const sr=stageRect();ctx.save();ctx.beginPath();ctx.rect(sr.x,sr.y,sr.w,sr.h);ctx.clip();drawCube(G,now,true);ctx.restore()}
  if(MODE.type==='ta'){
    const left=TA.running?TA.end-now:60000;const el=$('gTimer');el.textContent=fmtT(left);el.classList.toggle('low',left<10000);
    const sec=Math.ceil(left/1000);if(TA.running&&sec<=5&&sec!==TA.last&&sec>0){TA.last=sec;SFX.tick()}
    if(TA.running&&left<=0&&G.state==='play')taOver();
  }
  if(G.state==='play'&&G.left===0&&G.flying.length===0)onCleared();
}

// =====================================================================
// ENTRADA: girar, pellizcar, zoom
// =====================================================================
function zoomAt(px,py,f){
  if(view!=='game')return;
  const nz=Math.max(0.5,Math.min(5,camG.zoom*f));f=nz/camG.zoom;
  const sr=stageRect(),cx=sr.x+sr.w/2,cy=sr.y+sr.h/2;
  camG.panX+=(px-(cx+camG.panX))*(1-f);camG.panY+=(py-(cy+camG.panY))*(1-f);camG.zoom=nz;
}
function inPoly(x,y,p){let r=false;for(let i=0,j=p.length-1;i<p.length;j=i++){const[xi,yi]=p[i],[xj,yj]=p[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)r=!r}return r}
function tap(x,y){
  if(view!=='game'||!G||G.state!=='play')return;
  for(let i=picks.length-1;i>=0;i--)if(inPoly(x,y,picks[i].pts)){tapSnake(picks[i].sn);return}
  if(G.sel){G.sel=null}
}
const ptrs=new Map();let pinch=null,moved=0,tapPt=null,lastMoveT=0;
const pinchState=()=>{const[a,b]=[...ptrs.values()];return{d:Math.hypot(a.x-b.x,a.y-b.y)||1,mx:(a.x+b.x)/2,my:(a.y+b.y)/2}};
cv.addEventListener('pointerdown',e=>{
  try{cv.setPointerCapture(e.pointerId)}catch(_){}
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  const c=view==='menu'?camM:camG;
  if(ptrs.size===1){moved=0;tapPt={x:e.clientX,y:e.clientY};c.vy=c.vp=0;drag=true}
  else{moved=999;pinch=pinchState()}
});
cv.addEventListener('pointermove',e=>{
  const p=ptrs.get(e.pointerId);if(!p)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
  const c=view==='menu'?camM:camG;
  if(ptrs.size>=2){
    const st=pinchState(),r=app.getBoundingClientRect();
    if(pinch&&view==='game'){zoomAt(st.mx-r.left,st.my-r.top,st.d/pinch.d);camG.panX+=st.mx-pinch.mx;camG.panY+=st.my-pinch.my}
    pinch=st;return;
  }
  moved+=Math.abs(dx)+Math.abs(dy);
  if(moved>6){const sens=0.009/Math.sqrt(c.zoom);c.yaw+=dx*sens;c.pitch=Math.max(-1.45,Math.min(1.45,c.pitch+dy*sens));c.vy=dx*sens;c.vp=dy*sens}
  lastMoveT=performance.now();
});
const up=e=>{
  if(!ptrs.has(e.pointerId))return;
  ptrs.delete(e.pointerId);
  if(ptrs.size>=2){pinch=pinchState();return}
  pinch=null;
  if(ptrs.size===0){
    const c=view==='menu'?camM:camG;
    if(moved<=6&&tapPt){const r=app.getBoundingClientRect();tap(e.clientX-r.left,e.clientY-r.top);c.vy=c.vp=0}
    else if(performance.now()-lastMoveT>80||moved>=999){c.vy=c.vp=0}
    drag=false;tapPt=null;
  }
};
cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
cv.addEventListener('wheel',e=>{e.preventDefault();const r=app.getBoundingClientRect();zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-e.deltaY*0.0015))},{passive:false});
['gesturestart','gesturechange'].forEach(t=>document.addEventListener(t,e=>e.preventDefault()));

function resize(){const r=app.getBoundingClientRect();DPR=Math.min(window.devicePixelRatio||1,3);W=r.width;H=r.height;cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR)}
new ResizeObserver(resize).observe(app);resize();
// ================= Bienvenida: nombre de usuario =================
function askName(){
  dialog(`<h2>¡Bienvenido a Fuga Cubes!</h2><p>¿Cómo te llamas? Así te verán tus amigos en el ranking.</p><input id="obName" class="inp" maxlength="20" placeholder="Tu nombre" autocomplete="nickname" enterkeyhint="go" style="flex:none;width:100%;box-sizing:border-box;text-align:center">`,
    [['Empezar',okName,true]]);
  const i=$('obName');i.addEventListener('keydown',e=>{if(e.key==='Enter')okName()});setTimeout(()=>i.focus(),60);
}
function okName(){
  const v=$('obName').value.trim().slice(0,20);
  if(v.length<2){toast('Escribe al menos 2 letras');return}
  $('ov').hidden=true;claimName(v,true);
}
// Mismo nombre = misma partida. Si hay varias cuentas con ese nombre, todas las sesiones
// se unen a la de más nivel (y en empate, siempre a la misma), así ningún dispositivo se queda aparte.
async function claimName(v,welcome,silent){
  let back=false;
  if(Cloud.ok){try{
    const rows=(await Cloud.listRaw()).filter(r=>normName(r.data.name)===normName(v));
    let best={code:CODE,lv:S.level||1};
    for(const r of rows){
      let code=r.data.code;if(!code){try{code=await Cloud.codeForPid(r.id)}catch(e){}}
      if(!code)continue;
      const lv=+r.data.level||1;
      if(lv>best.lv||(lv===best.lv&&code<best.code))best={code,lv,pid:r.id};
    }
    if(best.code!==CODE){
      const r=await Cloud.loadPrivate(best.code);   // si falla, no cambia nada
      if(r){CODE=best.code;try{localStorage.setItem('fdc-code',CODE)}catch(e){}
        Cloud.loaded=true;mergeRemote(r);if(r.name)S.name=r.name;S.pid=r.pid||best.pid||S.pid;applySkin();back=true}
    }
  }catch(e){}}
  if(!S.name||!back)S.name=v;
  save(true);refreshMenu();if(view==='settings')renderSettings();
  if(back)toast('¡Qué onda de vuelta, '+S.name+'! Uní tu partida');
  else if(!silent)toast(welcome?'¡Hola, '+v+'!':'Nombre guardado');
  if(Cloud.ok)Push.touch();
}

// ================= Avisos al cel =================
// Cada cel guarda su "dirección de avisos" en Firebase (fdc_push/<cel>). Para avisar,
// la app junta esas direcciones y le pide al servidor de Cloudflare (el del casino) que las mande.
const Push=(()=>{
  const URLW=window.PUSH_URL,KEY=window.PUSH_PUBLIC,TOK=window.PUSH_TOKEN;
  const isIOS=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const standalone=()=>(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
  const supported=()=>!!URLW&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
  const unb64u=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};
  let DEV=null;try{DEV=localStorage.getItem('fdc-dev')}catch(e){}
  if(!DEV){DEV=rid(10);try{localStorage.setItem('fdc-dev',DEV)}catch(e){}}
  const isOn=()=>{try{return localStorage.getItem('fdc-push')==='on'}catch(e){return false}};
  function paint(){
    const b=$('pushBtn'),n=$('pushNote');if(!b)return;
    if(!URLW){b.hidden=true;n.textContent='';return}
    if(isIOS&&!standalone()){b.hidden=true;n.textContent='Para recibir avisos, abre Fuga Cubes desde el ícono de tu pantalla de inicio.';return}
    if(!supported()){b.hidden=true;n.textContent='Este cel no permite avisos de apps web (en iPhone se necesita iOS 16.4 o más nuevo).';return}
    const p=Notification.permission,on=p==='granted'&&isOn();
    b.hidden=on;
    n.textContent=p==='denied'?'Bloqueaste los avisos. Actívalos en Ajustes del iPhone → Notificaciones → Fuga Cubes.'
      :on?'🔔 Activados: te llega un aviso cuando alguien termine el reto de hoy.'
      :'Te avisamos cuando alguien termine el reto de hoy, aunque tengas la app cerrada.';
  }
  async function store(sub){if(!Cloud.ok||!sub)return;
    await Cloud.fs.collection('fdc_push').doc(DEV).set({pid:S.pid,name:S.name||'',sub:JSON.stringify(sub),at:Date.now()})}
  async function enable(){
    try{
      if(!Cloud.ok){toast('Necesitas internet para activar los avisos');return}
      const p=await Notification.requestPermission();if(p!=='granted'){paint();return}
      const reg=await navigator.serviceWorker.ready;
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:unb64u(KEY)});
      await store(sub);localStorage.setItem('fdc-push','on');toast('🔔 Avisos activados');
    }catch(e){toast('No se pudieron activar los avisos. Intenta otra vez.')}
    paint();
  }
  async function touch(){
    if(!supported()||Notification.permission!=='granted'||!Cloud.ok){paint();return}
    try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();
      if(sub){await store(sub);localStorage.setItem('fdc-push','on')}else localStorage.removeItem('fdc-push')}catch(e){}
    paint();
  }
  async function send(msg){
    if(!URLW||!Cloud.ok)return;
    try{
      const qs=await Cloud.fs.collection('fdc_push').get();
      const subs=[],ids=[],old=Date.now()-60*864e5;
      qs.docs.forEach(d=>{const v=d.data()||{};if(v.pid===S.pid||(v.at||0)<old)return;   // nunca a ti mismo
        try{subs.push(JSON.parse(v.sub));ids.push(d.id)}catch(e){}});
      if(!subs.length)return;
      const r=await fetch(URLW,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(Object.assign({token:TOK,subs,url:'./'},msg))});
      const j=await r.json().catch(()=>({}));
      (j.status||[]).forEach((s,i)=>{if(s===404||s===410)Cloud.fs.collection('fdc_push').doc(ids[i]).delete().catch(()=>{})});
    }catch(e){}
  }
  // Un solo aviso por persona por día: la primera vez que termina el reto
  function retoHecho(key,res){
    if(!Cloud.ok)return;
    const k='fdc-pushreto:'+key;try{if(localStorage.getItem(k))return;localStorage.setItem(k,'1')}catch(e){}
    const nm=S.name||'Alguien';
    send({title:`🧊 ${nm} hizo el reto de hoy`,
      body:`${'⭐'.repeat(res.s)} en ${fmtT(res.t)}${res.c?` · ${res.c} choque${res.c>1?'s':''}`:' · sin choques'}. ¿Le ganas?`,
      tag:'reto-'+key+'-'+S.pid});
  }
  return{paint,enable,touch,retoHecho};
})();
$('pushBtn').onclick=()=>Push.enable();

show('menu');
if(!S.name)setTimeout(askName,500);
requestAnimationFrame(frame);
})();
