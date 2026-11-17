// ================= Motor del casino (lo ejecuta el anfitrión) =================
const r2 = n => Math.round(n*100)/100;
const now = () => Date.now();
const clone = o => JSON.parse(JSON.stringify(o));
const sumObj = o => r2(Object.values(o||{}).reduce((a,b)=>a+(+b||0),0));
const SUITS = "SHDC", RANKS = "A23456789TJQK";
const GNAME = {bac:"Baccarat", rul:"Ruleta", bj:"Blackjack", pk:"Póker"};
const MAXP = 4;

function newShoe(decks){
  const d=[]; for(let k=0;k<decks;k++) for(const s of SUITS) for(const r of RANKS) d.push(r+s);
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d.join("");
}
// El zapato es un texto de cartas de 2 letras ("AS","TD"); se reparte desde el final
function draw(g){ const c=g.shoe.slice(-2); g.shoe=g.shoe.slice(0,-2); return c; }
const shoeLen = g => g.shoe.length/2;

function addLog(T,m){ T.log=(T.log||[]).concat({t:now(),m}).slice(-14); }
const P = (T,id) => T.players[id];
const seated = T => T.order.filter(id=>T.players[id] && !T.players[id].out);
const humans = T => seated(T).filter(id=>!T.players[id].bot);
const seatsUsed = T => seated(T).length;
function freeSeat(T){ const used=new Set(seated(T).map(id=>T.players[id].seat)); for(let s=0;s<MAXP;s++) if(!used.has(s)) return s; return -1; }
function sortOrder(T){ T.order.sort((a,b)=>(T.players[a].seat??9)-(T.players[b].seat??9)); }
const pname = (T,id) => (T.players[id]&&T.players[id].name)||"Jugador";

// Quién debe estar listo para repartir: humanos presentes con fichas o con apuesta
function needReady(T, present){
  const g=T.g;
  return humans(T).filter(id=>(!present||present.has(id)) && (T.players[id].chips>0 || (g.bets&&g.bets[id])));
}
function allReady(T, present){
  const g=T.g; if(!g.bets || !Object.keys(g.bets).length) return false;
  return needReady(T,present).every(id=>g.ready[id]);
}

// Apuestas absolutas de un jugador para la ronda actual
function applyBets(T,uid,d,allowed){
  const g=T.g, p=P(T,uid);
  if(!p||p.out||g.phase!=="bet"||!d||d.round!==g.round) return false;
  const b={}; let s=0;
  for(const [k,v] of Object.entries(d.bets||{})){ if(!allowed(k)) continue; const a=r2(+v); if(!(a>0)) continue; b[k]=a; s=r2(s+a); }
  if(s>p.chips+0.001) return false;
  if(Object.keys(b).length) g.bets[uid]=b; else delete g.bets[uid];
  if(d.ready) g.ready[uid]=true; else delete g.ready[uid];
  return true;
}

// ---------------- Baccarat ----------------
const bacVal = c => { const r=c[0]; return r==="A"?1 : "TJQK".includes(r)?0 : +r; };
const bacTot = h => h.reduce((a,c)=>a+bacVal(c),0)%10;
const burnVal = c => { const r=c[0]; return r==="A"?1 : "TJQK".includes(r)?10 : +r; };
// Big Road: cada columna es una racha del mismo ganador; los empates se marcan en la última bolita
function bigRoad(hist){
  const cells=[], used=new Set(); let start=-1, col=0, row=0, last=null, ties=0, prev=null;
  for(const h of String(hist||"")){
    if(h==="T"){ if(prev) prev.t++; else ties++; continue; }
    if(h!==last){ start++; col=start; row=0; while(used.has(col+","+row)) col++; last=h; }
    else if(row+1<6 && !used.has(col+","+(row+1))) row++;
    else col++;                                   // cola de dragón: la racha sigue hacia la derecha
    const c={col,row,s:h,t:ties}; ties=0; used.add(col+","+row); cells.push(c); prev=c;
  }
  return cells;
}
const BAC = {
  pay:{P:2, B:1.95, T:9},
  init(){ const g={phase:"bet",round:1,bets:{},ready:{},shoe:"",burn:null,shoes:0,P:[],B:[],res:null,net:{},hist:""}; BAC.shoe(g); return g; },
  // 3 mazos; la carta de corte cae en un punto al azar (entre 14 y 70 cartas antes del final)
  shoe(g){ g.shoe=newShoe(3); const f=draw(g), n=burnVal(f); for(let i=0;i<n;i++) draw(g); g.burn={c:f,n}; g.shoes=(g.shoes||0)+1; g.cut=14+Math.floor(Math.random()*57); },
  keys: k => k==="P"||k==="B"||k==="T",
  deal(T){
    const g=T.g;
    if(shoeLen(g)<Math.max(14,g.cut||0)){ BAC.shoe(g); addLog(T,`Zapato nuevo · primera carta ${cardTxt(g.burn.c)}, se queman ${g.burn.n}`); }
    const Pc=[draw(g)], Bc=[draw(g)]; Pc.push(draw(g)); Bc.push(draw(g));
    let pt=bacTot(Pc), bt=bacTot(Bc);
    if(pt<8 && bt<8){
      let p3=null;
      if(pt<=5){ Pc.push(draw(g)); p3=bacVal(Pc[2]); }
      let bd;
      if(p3===null) bd = bt<=5;
      else bd = bt<=2 || (bt===3&&p3!==8) || (bt===4&&p3>=2&&p3<=7) || (bt===5&&p3>=4&&p3<=7) || (bt===6&&(p3===6||p3===7));
      if(bd) Bc.push(draw(g));
    }
    pt=bacTot(Pc); bt=bacTot(Bc);
    const res = pt>bt?"P":bt>pt?"B":"T";
    g.net={};
    for(const [id,b] of Object.entries(g.bets)){
      const p=P(T,id); if(!p) continue;
      const staked=sumObj(b);
      let back = res==="T" ? (b.T||0)*BAC.pay.T + (b.P||0) + (b.B||0) : (b[res]||0)*BAC.pay[res];
      const net=r2(back-staked); p.chips=r2(p.chips+net); g.net[id]=net;
    }
    g.P=Pc; g.B=Bc; g.res=res; g.pt=pt; g.bt=bt;
    g.hist=(g.hist+res).slice(-120); g.phase="result";
    g.nextAt=now()+ (Pc.length+Bc.length)*330 + 4500;
    addLog(T, res==="T" ? `Baccarat: empate ${pt} a ${bt}` : `Baccarat: gana ${res==="P"?"Jugador":"Banca"} ${Math.max(pt,bt)} a ${Math.min(pt,bt)}`);
  },
  next(T){ const g=T.g; g.round++; g.phase="bet"; g.bets={}; g.ready={}; g.P=[]; g.B=[]; g.res=null; g.net={}; delete g.nextAt; },
  idle(T){ const g=T.g; return g.phase==="result" || (g.phase==="bet" && !Object.keys(g.bets).length); }
};

// ---------------- Ruleta (europea, un cero) ----------------
const REDS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const RUL_OUT = ["red","black","even","odd","low","high","d1","d2","d3","c1","c2","c3"];
const WHEEL = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
function rulMult(k,n){
  if(k[0]==="n") return +k.slice(1)===n ? 36 : 0;
  if(n===0) return 0;
  switch(k){
    case "red": return REDS.has(n)?2:0; case "black": return REDS.has(n)?0:2;
    case "even": return n%2===0?2:0; case "odd": return n%2===1?2:0;
    case "low": return n<=18?2:0; case "high": return n>=19?2:0;
    case "d1": return n<=12?3:0; case "d2": return n>=13&&n<=24?3:0; case "d3": return n>=25?3:0;
    case "c1": return n%3===1?3:0; case "c2": return n%3===2?3:0; case "c3": return n%3===0?3:0;
  }
  return 0;
}
const RUL = {
  init(){ return {phase:"bet",round:1,bets:{},ready:{},num:null,hist:[],net:{}}; },
  keys: k => /^n([0-9]|[12][0-9]|3[0-6])$/.test(k) || RUL_OUT.includes(k),
  deal(T){
    const g=T.g, n=Math.floor(Math.random()*37);
    g.net={};
    for(const [id,b] of Object.entries(g.bets)){
      const p=P(T,id); if(!p) continue;
      let back=0; for(const [k,a] of Object.entries(b)) back+=a*rulMult(k,n);
      const net=r2(back-sumObj(b)); p.chips=r2(p.chips+net); g.net[id]=net;
    }
    g.num=n; g.hist=[n].concat(g.hist||[]).slice(0,24); g.phase="result"; g.nextAt=now()+8500;
    addLog(T, `Ruleta: salió ${n}${n===0?"":REDS.has(n)?" rojo":" negro"}`);
  },
  next(T){ const g=T.g; g.round++; g.phase="bet"; g.bets={}; g.ready={}; g.num=null; g.net={}; delete g.nextAt; },
  idle(T){ const g=T.g; return g.phase==="result" || (g.phase==="bet" && !Object.keys(g.bets).length); }
};

// ---------------- Blackjack (6 mazos, crupier se planta en 17, BJ paga 3 a 2) ----------------
const bjVal = c => { const r=c[0]; return r==="A"?11 : "TJQK".includes(r)?10 : +r; };
function bjTot(cs){ let t=0,a=0; for(const c of cs){ if(c==="??") continue; const v=bjVal(c); t+=v; if(v===11) a++; } while(t>21&&a){ t-=10; a--; } return {t, soft:a>0}; }
const BJ = {
  init(){ return {phase:"bet",round:1,bets:{},ready:{},shoe:newShoe(6),hands:{},dealer:[],reveal:false,dbj:false,turn:null,k:0,net:{}}; },
  keys: k => k==="m",
  deal(T){
    const g=T.g;
    if(shoeLen(g)<80){ g.shoe=newShoe(6); addLog(T,"Blackjack: barajando 6 mazos"); }
    const ids=T.order.filter(id=>g.bets[id]&&g.bets[id].m>0);
    g.hands={}; ids.forEach(id=>g.hands[id]=[{c:[],bet:g.bets[id].m}]);
    g.dealer=[];
    for(let r=0;r<2;r++){ ids.forEach(id=>g.hands[id][0].c.push(draw(g))); g.dealer.push(draw(g)); }
    g.reveal=false; g.dbj=false; g.net={}; g.phase="play";
    ids.forEach(id=>{ const h=g.hands[id][0]; if(bjTot(h.c).t===21){ h.bj=true; h.done=true; } });
    const up=g.dealer[0];
    if((up[0]==="A"||bjVal(up)===10) && bjTot(g.dealer).t===21){ g.dbj=true; BJ.settle(T); return; }
    BJ.advance(T);
  },
  advance(T){
    const g=T.g;
    for(const id of T.order){ const hs=g.hands[id]; if(!hs) continue;
      for(let i=0;i<hs.length;i++) if(!hs[i].done){ g.turn={id,h:i}; g.k++; g.turnAt=now(); return; } }
    g.turn=null; BJ.dealerPlay(T);
  },
  dealerPlay(T){
    const g=T.g; g.reveal=true;
    const live = Object.values(g.hands).some(hs=>hs.some(h=>!h.bust&&!h.bj&&!h.sur));
    if(live) while(bjTot(g.dealer).t<17) g.dealer.push(draw(g));
    BJ.settle(T);
  },
  settle(T){
    const g=T.g; g.reveal=true; g.turn=null;
    const d=bjTot(g.dealer).t;
    for(const [id,hs] of Object.entries(g.hands)){
      const p=P(T,id); let net=0;
      for(const h of hs){
        const t=bjTot(h.c).t; let r;
        if(h.sur) r=-h.bet/2;            // rendirse: recuperas la mitad
        else if(h.bust) r=-h.bet;
        else if(g.dbj) r = h.bj?0:-h.bet;
        else if(h.bj) r=1.5*h.bet;
        else if(d>21||t>d) r=h.bet;
        else if(t===d) r=0;
        else r=-h.bet;
        h.r=r2(r); net=r2(net+r);
      }
      if(p) p.chips=r2(p.chips+net); g.net[id]=net;
    }
    g.phase="result"; g.nextAt=now()+ g.dealer.length*400 + 5200;
    addLog(T, g.dbj ? "Blackjack: el crupier tiene blackjack" : `Blackjack: crupier ${d>21?"se pasa con "+d:"con "+d}`);
  },
  move(T,uid,d){
    const g=T.g;
    if(g.phase!=="play"||!g.turn||g.turn.id!==uid||!d||d.k!==g.k) return false;
    const hs=g.hands[uid], h=hs[g.turn.h], p=P(T,uid);
    const committed=hs.reduce((a,x)=>a+x.bet,0), free=r2(p.chips-committed);
    switch(d.m){
      case "hit": { if(h.sa) return false; h.c.push(draw(g)); const t=bjTot(h.c).t; if(t>21){ h.bust=true; h.done=true; } else if(t===21) h.done=true; break; }
      case "stand": h.done=true; break;
      case "surrender": if(h.c.length!==2||hs.length>1) return false; h.sur=true; h.done=true; break;
      case "double": if(h.sa||h.c.length!==2||free<h.bet) return false; h.bet=r2(h.bet*2); h.dbl=true; h.c.push(draw(g)); if(bjTot(h.c).t>21) h.bust=true; h.done=true; break;
      case "split": {
        // se puede dividir y volver a dividir (también Ases) hasta tener 4 manos
        if(h.c.length!==2||hs.length>=4||bjVal(h.c[0])!==bjVal(h.c[1])||free<h.bet) return false;
        const c2=h.c.pop(), nh={c:[c2],bet:h.bet,sp:true}; h.sp=true;
        h.c.push(draw(g)); nh.c.push(draw(g)); hs.splice(g.turn.h+1,0,nh);
        // cada mano dividida (también Ases) se juega como una mano más: pedir, doblar o plantarse
        const fin=x=> bjTot(x.c).t===21;
        if(fin(h)) h.done=true; if(fin(nh)) nh.done=true;
        break;
      }
      default: return false;
    }
    if(!h.done){ g.k++; g.turnAt=now(); } else BJ.advance(T);
    return true;
  },
  skip(T){ const g=T.g; if(g.phase!=="play"||!g.turn) return false; g.hands[g.turn.id][g.turn.h].done=true; BJ.advance(T); return true; },
  next(T){ const g=T.g; g.round++; g.phase="bet"; g.bets={}; g.ready={}; g.hands={}; g.dealer=[]; g.reveal=false; g.dbj=false; g.turn=null; g.net={}; delete g.nextAt; },
  idle(T){ const g=T.g; return g.phase==="result" || (g.phase==="bet" && !Object.keys(g.bets).length); }
};

// ---------------- Póker Texas Hold'em sin límite ----------------
const RV = c => "23456789TJQKA".indexOf(c[0])+2;
function straightHigh(rs){ // rs: rangos únicos de mayor a menor
  const s=new Set(rs); if(s.has(14)) s.add(1);
  for(let h=14;h>=5;h--){ let ok=true; for(let i=0;i<5;i++) if(!s.has(h-i)){ ok=false; break; } if(ok) return h; }
  return 0;
}
function eval7(cs){
  const rs=cs.map(RV), cnt={}, bySuit={};
  cs.forEach((c,i)=>{ cnt[rs[i]]=(cnt[rs[i]]||0)+1; (bySuit[c[1]]=bySuit[c[1]]||[]).push(rs[i]); });
  const uniq=[...new Set(rs)].sort((a,b)=>b-a);
  let flush=null; for(const s in bySuit) if(bySuit[s].length>=5) flush=bySuit[s].sort((a,b)=>b-a);
  if(flush){ const sf=straightHigh([...new Set(flush)]); if(sf) return [8,sf]; }
  const groups=Object.entries(cnt).map(([r,n])=>[+r,n]).sort((a,b)=>b[1]-a[1]||b[0]-a[0]);
  const kick=(ex,n)=>uniq.filter(r=>!ex.includes(r)).slice(0,n);
  if(groups[0][1]===4) return [7,groups[0][0],...kick([groups[0][0]],1)];
  if(groups[0][1]===3){
    const pair=groups.slice(1).find(g=>g[1]>=2);
    if(pair) return [6,groups[0][0],pair[0]];
  }
  if(flush) return [5,...flush.slice(0,5)];
  const st=straightHigh(uniq); if(st) return [4,st];
  if(groups[0][1]===3) return [3,groups[0][0],...kick([groups[0][0]],2)];
  if(groups[0][1]===2 && groups[1] && groups[1][1]===2){ const a=groups[0][0], b=groups[1][0]; return [2,a,b,...kick([a,b],1)]; }
  if(groups[0][1]===2) return [1,groups[0][0],...kick([groups[0][0]],3)];
  return [0,...uniq.slice(0,5)];
}
function cmpEv(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const d=(a[i]||0)-(b[i]||0); if(d) return d; } return 0; }
const HNAME = ["Carta alta","Par","Doble par","Tercia","Escalera","Color","Full","Póker","Escalera de color"];
const RNAME = {14:"ases",13:"reyes",12:"reinas",11:"jotas",10:"dieces",9:"nueves",8:"ochos",7:"sietes",6:"seises",5:"cincos",4:"cuatros",3:"tres",2:"doses"};
const R1 = {14:"As",13:"Rey",12:"Reina",11:"Jota",10:"10",9:"9",8:"8",7:"7",6:"6",5:"5",4:"4",3:"3",2:"2"};
function handName(ev){
  if(ev[0]===8 && ev[1]===14) return "Escalera real";
  if(ev[0]===8) return "Escalera de color al "+R1[ev[1]];
  if(ev[0]===5) return "Color al "+R1[ev[1]];
  if(ev[0]===4) return "Escalera al "+R1[ev[1]];
  if(ev[0]===0) return "Carta alta: "+R1[ev[1]];
  if(ev[0]===1) return "Par de "+RNAME[ev[1]];
  if(ev[0]===2) return `Doble par, ${RNAME[ev[1]]} y ${RNAME[ev[2]]}`;
  if(ev[0]===3) return "Tercia de "+RNAME[ev[1]];
  if(ev[0]===6) return `Full de ${RNAME[ev[1]]} y ${RNAME[ev[2]]}`;
  if(ev[0]===7) return "Póker de "+RNAME[ev[1]];
  return HNAME[ev[0]];
}
const BOTS = [["bot-1","Lupe"],["bot-2","Toño"],["bot-3","Chayo"]];
const PK = {
  blinds(T){ const bb=Math.max(2, Math.round(T.buyIn/200)*2); return {bb, sb:bb/2}; },
  init(T){ const b=PK.blinds(T); return {phase:"wait",hand:0,deck:"",board:[],btn:null,ps:{},toAct:null,cur:0,minR:b.bb,bb:b.bb,sb:b.sb,k:0,pots:null,show:false,last:{},ev:{}}; },
  ids(T){ return T.order.filter(id=>T.g.ps[id]); },
  nextOf(list,id){ const i=list.indexOf(id); return list[(i+1)%list.length]; },
  canAct(g,id){ const s=g.ps[id]; return s && !s.fold && !s.allin; },
  start(T,present){
    const g=T.g;
    // quien pidió el asiento de un bot entra antes de repartir
    seated(T).forEach(id=>{ const p=T.players[id]; if(p.bot && p.claim) replaceBot(T,id); });
    // los bots sin fichas recompran solos
    seated(T).forEach(id=>{ const p=T.players[id]; if(p.bot && p.chips<g.bb){ p.chips=r2(p.chips+T.buyIn); p.rebuys=(p.rebuys||0)+1; } });
    const list=seated(T).filter(id=>T.players[id].chips>0 && (T.players[id].bot || !present || present.has(id)));
    if(list.length<2){ g.phase="wait"; g.toAct=null; return false; }
    g.hand++; g.shoe=newShoe(1); g.board=[]; g.pots=null; g.show=false; g.last={}; g.ev={}; g.won={}; delete g.nextAt;
    g.btn = list.includes(g.btn) ? PK.nextOf(list,g.btn) : (g.btn && T.order.includes(g.btn) ? (list.find(id=>T.order.indexOf(id)>T.order.indexOf(g.btn))||list[0]) : list[0]);
    g.ps={}; list.forEach(id=>g.ps[id]={hole:[],bet:0,tot:0,fold:false,allin:false,acted:false});
    const sbId = list.length===2 ? g.btn : PK.nextOf(list,g.btn);
    const bbId = PK.nextOf(list,sbId);
    PK.post(T,sbId,g.sb); PK.post(T,bbId,g.bb);
    g.sbId=sbId; g.bbId=bbId;
    for(let r=0;r<2;r++) list.forEach(id=>g.ps[id].hole.push(draw(g)));
    g.cur=Math.max(...list.map(id=>g.ps[id].bet)); g.minR=g.bb; g.phase="pre";
    const first = list.length===2 ? g.btn : PK.nextOf(list,bbId);
    g.toAct=null;
    const order=PK.ids(T);
    for(let i=0,id=first;i<order.length;i++,id=PK.nextOf(order,id)) if(PK.canAct(g,id)){ g.toAct=id; break; }
    addLog(T,`Póker: mano ${g.hand}, ciegas ${g.sb}/${g.bb}`);
    if(!g.toAct){ PK.advance(T,true); return true; }
    PK.checkDone(T);
    return true;
  },
  post(T,id,amt){ const g=T.g, p=T.players[id], s=g.ps[id]; const a=r2(Math.min(amt,p.chips)); p.chips=r2(p.chips-a); s.bet=r2(s.bet+a); s.tot=r2(s.tot+a); if(p.chips<=0){ p.chips=0; s.allin=true; } },
  pot(g){ return r2(Object.values(g.ps).reduce((a,s)=>a+s.tot,0)); },
  // Si al empezar la mano nadie tiene que decidir (todos all-in), corre el tablero
  checkDone(T){ const g=T.g; const alive=PK.ids(T).filter(id=>!g.ps[id].fold); const actors=alive.filter(id=>!g.ps[id].allin);
    if(actors.length===0 || (actors.length===1 && g.ps[actors[0]].bet>=g.cur)) PK.advance(T,true); else { g.k++; g.turnAt=now(); } },
  move(T,uid,d){
    const g=T.g;
    if(!["pre","flop","turn","river"].includes(g.phase)||g.toAct!==uid||!d||d.k!==g.k) return false;
    const s=g.ps[uid], p=T.players[uid], toCall=r2(g.cur-s.bet), maxTo=r2(s.bet+p.chips);
    let txt;
    const pay=a=>{ a=r2(Math.min(a,p.chips)); p.chips=r2(p.chips-a); s.bet=r2(s.bet+a); s.tot=r2(s.tot+a); if(p.chips<=0){ p.chips=0; s.allin=true; } };
    const raiseTo=to=>{ const inc=r2(to-g.cur); pay(to-s.bet); if(inc>=g.minR) g.minR=inc; g.cur=to;
      PK.ids(T).forEach(id=>{ if(id!==uid && PK.canAct(g,id)) g.ps[id].acted=false; }); };
    let m=d.m;
    if(m==="allin") m = maxTo>g.cur ? "raise" : "call";
    switch(m){
      case "fold": s.fold=true; txt="Se retira"; break;
      case "check": if(toCall>0) return false; txt="Pasa"; break;
      case "call": if(toCall<=0){ txt="Pasa"; break; } pay(toCall); txt = s.allin?"All-in":"Iguala"; break;
      case "raise": {
        let to = d.m==="allin" ? maxTo : r2(Math.min(+d.to||0, maxTo));
        if(!(to>g.cur)) return false;
        if(to-g.cur<g.minR && to<maxTo) return false;
        const prevCur=g.cur; raiseTo(to); txt = s.allin ? "All-in "+to : (prevCur>0 ? "Sube a "+to : "Apuesta "+to);
        break;
      }
      default: return false;
    }
    s.acted=true; g.last[uid]=txt;
    PK.advance(T,false,uid);
    return true;
  },
  advance(T,force,from){
    const g=T.g, ids=PK.ids(T), alive=ids.filter(id=>!g.ps[id].fold);
    if(alive.length===1){
      const w=alive[0], pot=PK.pot(g); T.players[w].chips=r2(T.players[w].chips+pot); g.won={[w]:pot};
      g.pots=[{amt:pot,win:[w],desc:"Los demás se retiraron"}]; g.phase="show"; g.show=false; g.toAct=null; g.nextAt=now()+5000;
      addLog(T,`Póker: ${pname(T,w)} se lleva ${pot}`);
      if(T.players[w].bot && g.ps[w].bl){ g.last[w]="¡Era bluff! 😏"; addLog(T,`${pname(T,w)} lo ganó blufeando con ${g.ps[w].hole.map(cardTxt).join(" ")}`); }
      return;
    }
    const actors=alive.filter(id=>!g.ps[id].allin);
    const done = force || actors.every(id=>g.ps[id].bet===g.cur && (g.ps[id].acted || actors.length===1));
    if(!done){
      let id=from||g.toAct;
      for(let i=0;i<ids.length;i++){ id=PK.nextOf(ids,id); const s=g.ps[id]; if(PK.canAct(g,id) && (!s.acted || s.bet<g.cur)){ g.toAct=id; break; } }
      g.k++; g.turnAt=now(); return;
    }
    ids.forEach(id=>g.ps[id].bet=0); g.cur=0; g.minR=g.bb;
    const deal=n=>{ for(let i=0;i<n;i++) g.board.push(draw(g)); };
    const nextStreet=()=>{ if(g.phase==="pre"){ deal(3); g.phase="flop"; } else if(g.phase==="flop"){ deal(1); g.phase="turn"; } else if(g.phase==="turn"){ deal(1); g.phase="river"; } };
    if(g.phase==="river") return PK.showdown(T);
    if(actors.length<2){ while(g.board.length<5) nextStreet(); g.phase="river"; return PK.showdown(T); }
    nextStreet();
    actors.forEach(id=>g.ps[id].acted=false);
    g.toAct=null; let id=g.btn;
    for(let i=0;i<ids.length;i++){ id=PK.nextOf(ids,id); if(PK.canAct(g,id)){ g.toAct=id; break; } }
    g.last={}; g.k++; g.turnAt=now();
  },
  showdown(T){
    const g=T.g, ids=PK.ids(T), alive=ids.filter(id=>!g.ps[id].fold);
    g.phase="show"; g.show=true; g.toAct=null; g.ev={};
    const ev={}; alive.forEach(id=>{ ev[id]=eval7(g.ps[id].hole.concat(g.board)); g.ev[id]=handName(ev[id]); });
    const levels=[...new Set(alive.map(id=>g.ps[id].tot))].sort((a,b)=>a-b);
    let prev=0; const pots=[];
    for(const L of levels){
      const amt=r2(ids.reduce((a,id)=>a+Math.max(0,Math.min(g.ps[id].tot,L)-prev),0));
      const elig=alive.filter(id=>g.ps[id].tot>=L);
      if(amt>0) pots.push({amt,elig}); prev=L;
    }
    const left=r2(ids.reduce((a,id)=>a+Math.max(0,g.ps[id].tot-prev),0));
    if(left>0 && pots.length) pots[pots.length-1].amt=r2(pots[pots.length-1].amt+left);
    // orden para el sobrante: a la izquierda del botón
    const fromBtn=[]; let id=g.btn; for(let i=0;i<ids.length;i++){ id=PK.nextOf(ids,id); fromBtn.push(id); }
    g.won={};
    g.pots=pots.map(pt=>{
      let best=null; pt.elig.forEach(x=>{ if(!best||cmpEv(ev[x],best)>0) best=ev[x]; });
      const win=fromBtn.filter(x=>pt.elig.includes(x) && cmpEv(ev[x],best)===0);
      const share=Math.floor(pt.amt/win.length*100)/100; let rest=r2(pt.amt-share*win.length);
      win.forEach((x,i)=>{ const a=r2(share+(i===0?rest:0)); T.players[x].chips=r2(T.players[x].chips+a); g.won[x]=r2((g.won[x]||0)+a); });
      return {amt:pt.amt, win, desc:handName(best)};
    });
    g.nextAt=now()+8000;
    g.pots.forEach(pt=>addLog(T,`Póker: ${pt.win.map(x=>pname(T,x)).join(" y ")} ${pt.win.length>1?"se reparten":"gana"} ${pt.amt} con ${pt.desc.toLowerCase()}`));
  },
  skip(T){ const g=T.g; if(!g.toAct) return false; const s=g.ps[g.toAct]; return PK.move(T,g.toAct,{k:g.k,m: g.cur-s.bet>0?"fold":"check"}); },
  idle(T){ const g=T.g; return g.phase==="wait"||g.phase==="show"; },
  // Bots con personalidad: cada uno tiene su estilo y cada mano elige un "humor" (seguro / normal / agresivo).
  // Si pierden fuerte se calientan (tilt) y juegan agresivo unas manos; a veces bluffean y siguen el bluff en la siguiente calle.
  bot(T,id){
    const g=T.g, s=g.ps[id], p=T.players[id];
    if(p.claim) return {m: g.cur-s.bet>0 ? "fold" : "check"};  // alguien va a tomar su lugar
    const sty=BOTSTYLE[id]||BOTSTYLE["bot-1"];
    if(!s.mode){                                                // humor de esta mano
      if(p.lastChips!==undefined && p.lastChips-p.chips > T.buyIn*0.4 && Math.random()<sty.tiltP) p.tilt=1+Math.floor(Math.random()*2);
      p.lastChips=p.chips;
      if(p.tilt>0){ s.mode="agresivo"; p.tilt--; }
      else { let r=Math.random(); s.mode=sty.modes.find(([m,w])=>(r-=w)<0)?.[0]||"normal"; }
      s.bf = Math.random() < sty.bluff*BOTMODE[s.mode].b;      // ¿esta mano trae ganas de bluffear?
    }
    const M=BOTMODE[s.mode];
    const toCall=r2(g.cur-s.bet), pot=PK.pot(g), street=g.board.length;
    let st;
    if(!street){
      const [a,b]=s.hole.map(RV).sort((x,y)=>y-x), suited=s.hole[0][1]===s.hole[1][1];
      st = a===b ? 0.5+a/30 : (a+b)/32 + (suited?0.06:0) + (a-b===1?0.05:0) + (a===14?0.08:0);
    } else {
      const all=s.hole.concat(g.board), e=eval7(all), bo=street>=5?eval7(g.board):null;
      st = 0.18 + e[0]*0.13 + (e[1]||0)/140;
      if(bo && cmpEv(e,bo)===0) st-=0.2;                       // juega lo de la mesa
      if(street<5){                                            // proyectos: color y escalera
        const suits={}; all.forEach(c=>suits[c[1]]=(suits[c[1]]||0)+1);
        if(s.hole.some(c=>suits[c[1]]===4)) st+=0.12;
        const rv=[...new Set(all.map(RV))]; if(rv.includes(14)) rv.push(1);
        for(let lo=1;lo<=10;lo++){ let n=0; for(let k=lo;k<lo+5;k++) if(rv.includes(k)) n++; if(n>=4){ st+=0.07; break; } }
      }
    }
    st += (Math.random()-0.5)*0.16 - sty.tight - M.t;
    const odds = toCall>0 ? toCall/(pot+toCall) : 0;
    const r=Math.random();
    const size = f => Math.round(Math.max(g.cur+g.minR, r2(g.cur + Math.max(g.bb, pot*f))));
    const betSize = () => size((0.4+Math.random()*0.45)*M.a*(0.7+sty.aggr*0.5));
    const shove = {m:"allin"};
    // 1) Mano monstruo: a veces la esconde (slowplay) para atrapar, si no, sube fuerte
    if(st>0.85){
      if(street && street<5 && r<sty.slow) return toCall>0 ? {m:"call"} : {m:"check"};
      if(s.mode==="agresivo" && r<0.25 && p.chips>toCall) return shove;
      return p.chips>toCall ? {m:"raise", to:betSize()} : {m:"call"};
    }
    // 2) Buena mano: apuesta por valor según qué tan agresivo es
    if(st>0.62){
      if(r<sty.aggr*M.a*0.7 && p.chips>toCall) return {m:"raise", to:betSize()};
      return toCall>0 ? (st>odds+0.05 ? {m:"call"} : {m:"fold"}) : {m:"check"};
    }
    // 3) Bluff: si ya bluffeó en una calle, a veces lo sigue; si no, lo intenta según su estilo
    if(s.bf && (s.bl ? r<0.6 : r<(toCall>0?0.45:0.8))){
      if(toCall <= p.chips*0.35){ s.bl=true; return {m:"raise", to: size(street ? 0.6+Math.random()*0.5 : 0.5)}; }
    }
    // 4) Lo demás: pasar, igualar si conviene, o retirarse
    if(toCall===0) return {m:"check"};
    if(st>odds+0.12 || (toCall<=g.bb && st>0.3+sty.tight)) return {m:"call"};
    if(r<0.04) return {m:"call"};                               // terquedad de vez en cuando
    return {m:"fold"};
  }
};
const BOTSTYLE={
  "bot-1":{tight:0.08,  aggr:0.30, bluff:0.025,slow:0.10, tiltP:0.2, modes:[["seguro",0.6],["normal",0.35],["agresivo",0.05]]},   // Lupe: la roca
  "bot-2":{tight:-0.06, aggr:0.85, bluff:0.16, slow:0.05, tiltP:0.7, modes:[["agresivo",0.5],["normal",0.35],["seguro",0.15]]},   // Toño: el loco
  "bot-3":{tight:0.02,  aggr:0.55, bluff:0.09, slow:0.35, tiltP:0.35, modes:[["normal",0.5],["agresivo",0.25],["seguro",0.25]]}    // Chayo: la tiburona
};
const BOTMODE={seguro:{t:0.10,b:0.3,a:0.6}, normal:{t:0,b:1,a:1}, agresivo:{t:-0.06,b:1.6,a:1.35}};

const GAMES = {bac:BAC, rul:RUL, bj:BJ, pk:PK};
function initGame(T,game){ const g=GAMES[game].init(T); g.gid=Math.random().toString(36).slice(2,7); return g; }
function cardTxt(c){ return (c[0]==="T"?"10":c[0]) + ({S:"♠",H:"♥",D:"♦",C:"♣"}[c[1]]); }

// ---------------- Acciones que recibe el anfitrión ----------------
function inHand(T,uid){
  const g=T.g;
  if(T.game==="pk") return ["pre","flop","turn","river"].includes(g.phase) && g.ps[uid] && !g.ps[uid].fold;
  if(T.game==="bj") return g.phase==="play" && !!g.hands[uid];
  return false;
}
function hostAct(T,uid,a,present){
  if(!T||!uid||!a||!a.kind) return false;
  const p=T.players[uid], d=a.data||{};
  switch(a.kind){
    case "join": {
      const name=String(d.name||"").replace(/[\u0000-\u001f]/g,"").trim().slice(0,16)||"Jugador";
      if(p && !p.out){ if(p.name!==name){ p.name=name; return true; } return false; }
      if(seatsUsed(T)>=MAXP) return false;
      if(p){ p.out=false; p.name=name; p.seat=freeSeat(T); p.joined=now(); }
      else { T.players[uid]={name,chips:T.buyIn,seat:freeSeat(T),rebuys:0,joined:now()}; T.order.push(uid); }
      sortOrder(T); addLog(T,`${name} se sentó a la mesa`); return true;
    }
    case "leave": {
      if(!p||p.out||inHand(T,uid)) return false;
      if(T.g.bets){ delete T.g.bets[uid]; delete T.g.ready[uid]; }
      p.out=true; addLog(T,`${p.name} dejó su lugar`); return true;
    }
    case "bets": {
      const G=GAMES[T.game]; if(!G.keys || d.game!==T.game) return false;
      if(!applyBets(T,uid,d,G.keys)) return false;
      if(allReady(T,present)) G.deal(T);
      return true;
    }
    case "move": {
      const G=GAMES[T.game]; if(!G.move || d.game!==T.game) return false;
      return G.move(T,uid,d);
    }
    case "merge": {
      // El mismo apodo quedó dos veces (cel nuevo o app reinstalada): junta el lugar viejo en el actual
      const q=T.players[d.from], nn=x=>String(x||"").trim().toLowerCase();
      if(!p||p.out||!q||d.from===uid||q.bot||p.bot||nn(q.name)!==nn(p.name)) return false;
      if(inHand(T,uid)||inHand(T,d.from)) return false;
      if(T.g.bets && (T.g.bets[d.from]||T.g.bets[uid])) return false;
      if(T.game==="pk" && T.g.ps && T.g.ps[d.from] && T.g.phase!=="wait") return false;
      if(T.game==="bj" && T.g.hands && T.g.hands[d.from]) return false;
      p.chips=r2(p.chips+(q.chips||0)); p.rebuys=(p.rebuys||0)+(q.rebuys||0)+1;   // mismas cuentas en el tablero
      delete T.players[d.from]; T.order=T.order.filter(x=>x!==d.from);
      if(T.g.ps) delete T.g.ps[d.from]; if(T.g.ready) delete T.g.ready[d.from];
      sortOrder(T); addLog(T,`Se juntaron los dos lugares de ${p.name}`); return true;
    }
    case "rebuy": {
      if(!p||p.out||inHand(T,uid)||d.n!==(p.rebuys||0)+1) return false;
      if(T.g.bets && T.g.bets[uid]) return false;
      if(p.chips>=10) return false;
      p.rebuys=(p.rebuys||0)+1; p.chips=r2(p.chips+T.buyIn); addLog(T,`${p.name} recompró ${T.buyIn}`); return true;
    }
  }
  return false;
}
// Revisión periódica del anfitrión: siguiente ronda, bots y turnos de gente desconectada
function hostTick(T,present,awayTimeout){
  const g=T.g, t=now(); let ch=false;
  if(g.nextAt && t>=g.nextAt){
    if(T.game==="pk"){ delete g.nextAt; if(!PK.start(T,present)) g.phase="wait"; }
    else GAMES[T.game].next(T);
    return true;
  }
  if(g.phase==="bet" && allReady(T,present)){ GAMES[T.game].deal(T); return true; }
  if(T.game==="pk" && g.toAct && ["pre","flop","turn","river"].includes(g.phase)){
    const p=T.players[g.toAct];
    if(p && p.bot && t-(g.turnAt||0)>900){ const mv=PK.bot(T,g.toAct); mv.k=g.k; if(!PK.move(T,g.toAct,mv)) PK.move(T,g.toAct,{k:g.k,m:"call"}) || PK.skip(T); return true; }
    if(p && !p.bot && present && !present.has(g.toAct) && t-(g.turnAt||0)>awayTimeout){ PK.skip(T); return true; }
  }
  if(T.game==="bj" && g.phase==="play" && g.turn && present && !present.has(g.turn.id) && t-(g.turnAt||0)>awayTimeout){ BJ.skip(T); return true; }
  return ch;
}
function canSwitch(T){ return GAMES[T.game].idle(T); }
function switchGame(T,game){
  if(T.game===game||!GAMES[game]||!canSwitch(T)) return false;
  if(T.game==="pk" && game!=="pk"){ T.order=T.order.filter(id=>!(T.players[id]&&T.players[id].bot)); BOTS.forEach(([id])=>delete T.players[id]); }
  T.game=game; T.g=initGame(T,game); addLog(T,`Ahora se juega ${GNAME[game]}`); return true;
}
function addBot(T){
  if(T.game!=="pk"||!PK.idle(T)||seatsUsed(T)>=MAXP) return false;
  const libres=BOTS.filter(([id])=>!T.players[id]||T.players[id].out); if(!libres.length) return false;
  const b=libres[Math.floor(Math.random()*libres.length)];   // cualquiera de los que no están sentados
  T.players[b[0]]={name:"Bot "+b[1],chips:T.buyIn,seat:freeSeat(T),rebuys:0,bot:true};
  if(!T.order.includes(b[0])) T.order.push(b[0]); sortOrder(T); addLog(T,`Se sentó Bot ${b[1]}`); return true;
}
function removeBot(T){
  if(T.game!=="pk"||!PK.idle(T)) return false;
  const ids=seated(T).filter(id=>T.players[id].bot); const id=ids[ids.length-1]; if(!id) return false;
  delete T.players[id]; T.order=T.order.filter(x=>x!==id); delete T.g.ps[id]; addLog(T,"Se levantó un bot"); return true;
}
// Tomar el asiento de un bot: al momento si no está en una mano, o al terminarla
function botBusy(T,id){ return T.game==="pk" && !PK.idle(T) && T.g.ps && T.g.ps[id] && !T.g.ps[id].fold; }
function replaceBot(T,id){
  const b=T.players[id]; if(!b||!b.bot||!b.claim) return false;
  const {uid,name}=b.claim;
  delete T.players[id]; T.order=T.order.filter(x=>x!==id); if(T.g.ps) delete T.g.ps[id];
  hostAct(T,uid,{kind:"join",data:{name}},null);
  addLog(T,`${name} tomó el asiento de ${b.name}`);
  return true;
}
function claimBot(T,id,uid,name){
  const me=T.players[uid]; if(me && !me.out) return false;
  const b=T.players[id]; if(!b||!b.bot) return false;
  if(b.claim && b.claim.uid===uid) return false;
  b.claim={uid,name:String(name||"Jugador").slice(0,16)};
  if(botBusy(T,id)){
    // el bot se retira de la mano en curso y tú entras en la siguiente
    const g=T.g, s=g.ps[id];
    if(g.toAct===id) PK.move(T,id,{k:g.k,m: g.cur-s.bet>0?"fold":"check"});
    addLog(T,`${b.claim.name} tomará el asiento de ${b.name} al terminar la mano`);
    return true;
  }
  return replaceBot(T,id);
}
function newTable(code,name,buyIn,game,uid,alias){
  const T={v:1,code,name,open:true,host:uid,creator:uid,created:now(),updated:now(),seq:0,buyIn,
    players:{[uid]:{name:alias,chips:buyIn,seat:0,rebuys:0,joined:now()}},order:[uid],game,g:null,log:[]};
  T.g=initGame(T,game); addLog(T,`${alias} abrió la mesa`); return T;
}
// Quién reparte si el anfitrión se va: el siguiente en orden de llegada
function successors(T,present){
  return humans(T).filter(id=>id!==T.host && (!present||present.has(id)))
    .sort((a,b)=>((T.players[a].joined||0)-(T.players[b].joined||0)) || (T.players[a].seat-T.players[b].seat));
}
// Algo que el anfitrión ya debió hacer (repartir, pasar de ronda, mover al bot)
function hostDue(T,present){
  const g=T.g, t=now();
  if(g.nextAt && t>g.nextAt+3000) return true;
  if(g.phase==="bet" && allReady(T,present)) return true;
  if(T.game==="pk" && g.toAct && T.players[g.toAct] && T.players[g.toAct].bot && ["pre","flop","turn","river"].includes(g.phase) && t-(g.turnAt||0)>4000) return true;
  return false;
}
if(typeof module!=="undefined") module.exports={bigRoad,claimBot,replaceBot,BAC,RUL,BJ,PK,GAMES,eval7,cmpEv,handName,bjTot,rulMult,newTable,hostAct,hostTick,switchGame,addBot,removeBot,canSwitch,seated,r2,sumObj};
// ================= Interfaz y conexión =================
const $ = id => document.getElementById(id);
const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => { n=r2(n||0); const a=Math.abs(n); return (n<0?"−":"")+"$"+a.toLocaleString("es-MX",{minimumFractionDigits:a%1?2:0,maximumFractionDigits:2}); };
const fmtK = n => { n=r2(n); return n>=1000 ? (n%1000 ? (n/1000).toFixed(1) : n/1000)+"K" : String(n); };
const sgn = n => (n>0?"+":"")+fmt(n);
const SUITCH = {S:"♠",H:"♥",D:"♦",C:"♣"};
const SEATC = ["var(--s0)","var(--s1)","var(--s2)","var(--s3)"];
const CHIPS = [10,50,100,500,1000,5000,10000];
const CODECH = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k,v) => { try{ localStorage.setItem(k,v); }catch(e){} };

// Asignar HTML solo si cambió: así los botones no se reemplazan bajo el dedo
Object.defineProperty(Element.prototype,"html",{configurable:true,set(h){ h=String(h); if(this.__h!==h){ this.__h=h; this.innerHTML=h; } }});
const ST = {db:null,room:null,user:null,uid:null,canMulti:false,T:null,code:null,ref:null,unsubDoc:null,unsubActs:null,rm:null,rmOff:[],isHost:false,peers:[],conn:false,tick:null,mesas:[],lobbyUnsub:null};
const UI = {chip:100,game:null,round:null,bets:{},ready:false,stack:[],last:{},move:null,rebuyN:0,wantSeat:false,
  cardAt:new Map(),hold:{},first:true,qn:0,shell:null,wheelRound:null,wheelRot:0,pkKey:"",hostMiss:0,createGame:"bac",buyIn:10000};

function toast(m){ let t=$("toastEl"); if(!t){ t=document.createElement("div"); t.id="toastEl"; t.className="toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.textContent=m; t.hidden=false; clearTimeout(toast.h); toast.h=setTimeout(()=>t.hidden=true,2600); }
function localId(){ let id=lsGet("mc-uid"); if(!id){ id="local-"+Math.random().toString(36).slice(2,12); lsSet("mc-uid",id); } return id; }
function getAlias(){ return $("alias").value.replace(/[\u0000-\u001f]/g,"").trim().slice(0,16); }
// El apodo se guarda en tres lugares (cel, cookie y, en la app, Firebase) para que siempre aparezca al volver
const APPMODE=!!window.FIREBASE_CONFIG;
function ckGet(k){ try{ const m=document.cookie.match(new RegExp("(?:^|; )"+k+"=([^;]*)")); return m?decodeURIComponent(m[1]):""; }catch(e){ return ""; } }
function ckSet(k,v){ try{ document.cookie=k+"="+encodeURIComponent(v)+"; max-age=31536000; path=/; SameSite=Lax"; }catch(e){} }
let aliasT=null;
function perfilRef(){ return APPMODE && ST.db && ST.acct ? ST.db.doc("data/users/"+ST.acct+"/perfil") : null; }
function saveAlias(){ const a=getAlias(); if(!a) return; lsSet("mc-alias",a); ckSet("mc-alias",a);
  clearTimeout(aliasT); aliasT=setTimeout(()=>{ const r=perfilRef(); if(r) r.set({alias:getAlias()||a, pid:ST.uid||"", at:Date.now()}).catch(()=>{}); if(window.PUSH) PUSH.touch(); if(window.L2) L2.syncChip(); renderMe(); },800); }
const me = () => ST.T && ST.T.players[ST.uid] && !ST.T.players[ST.uid].out ? ST.T.players[ST.uid] : null;

// ---------------- Capacidades ----------------
async function initCaps(){
  try{
    const C=window.claude;
    if(C && C.use){
      const [db,user,room]=await Promise.all([C.use("db"),C.use("user"),C.use("room")]);
      ST.db=db; ST.user=user; ST.room=room;
      if(user){ const m=await user.me(); ST.acct=m.id;
        try{ ST.readOnly = (await user.can("data.write"))===false; }catch(e){}
        try{ ST.isOwner = await user.isOwner(); }catch(e){} }
    }
  }catch(e){}
  ST.canMulti=!!(ST.db && ST.acct);
  // Cada cel es un jugador distinto, aunque usen la misma cuenta
  let perfil=null; const pr=perfilRef(); if(pr){ try{ const d=await pr.get(); perfil=d.exists?d.data():null; }catch(e){} }
  if(perfil){ if(perfil.pid && String(perfil.pid).indexOf(ST.acct+"~")===0 && !lsGet("mc-pid:"+ST.acct)) lsSet("mc-pid:"+ST.acct, perfil.pid);
    if(!getAlias() && perfil.alias){ $("alias").value=perfil.alias; lsSet("mc-alias",perfil.alias); ckSet("mc-alias",perfil.alias); } }
  if(ST.acct){ const k="mc-pid:"+ST.acct; ST.uid=lsGet(k); if(!ST.uid){ ST.uid=ST.acct+"~"+Math.random().toString(36).slice(2,8); lsSet(k,ST.uid); } }
  else ST.uid=localId();
  if(getAlias()) saveAlias();
  $("capNote").textContent = ST.canMulti
    ? "Tu mesa se guarda sola. Si cierras la app, la encuentras en “Tu última mesa”."
    : "En esta vista no hay mesas compartidas: puedes jugar solo, pero la mesa no se guarda al cerrar.";
  $("create").textContent = ST.canMulti ? "Confirmar mesa" : "Jugar solo";
  if(ST.readOnly) $("capNote").textContent = READONLY_TXT;
  loadBoard();
  setTimeout(()=>{ if(typeof solCardInfo==="function") solCardInfo(); },0);
  if(ST.db) watchLobby(); else $("mlist").html='<div class="empty">Las mesas compartidas no están disponibles en esta vista.</div>';
  resumeBox();
}
function watchLobby(){
  if(ST.lobbyUnsub) return;
  ST.lobbyUnsub = ST.db.collection("mesas").where("open","==",true).orderBy("updated","desc").limit(40).onSnapshot(qs=>{
    ST.mesas = qs.docs.map(d=>d.data()).filter(m=>m && m.code);   // todas las abiertas, las más recientes primero
    if(ST.knownInit) ST.mesas.forEach(m=>{ if(!ST.known.has(m.code)) maybeNotify(m); });
    ST.mesas.forEach(m=>ST.known.add(m.code)); ST.knownInit=true;
    renderLobbyList(); resumeBox();
  }, ()=>{ $("mlist").html='<div class="empty">No se pudieron cargar las mesas. Vuelve a abrir la app.</div>'; });
}
// ---------------- Aviso con campanita ----------------
ST.known=new Set(); ST.knownInit=false;
let actx=null;
function unlockAudio(){ try{ if(!actx){ const AC=window.AudioContext||window.webkitAudioContext; if(AC) actx=new AC(); } if(actx&&actx.state==="suspended") actx.resume(); }catch(e){} }
document.addEventListener("pointerdown",unlockAudio,{passive:true});
function bell(){
  if(lsGet("mc-bell")==="off"||!actx) return;
  try{
    const t=actx.currentTime;
    [[1318.5,0.32,1.6],[1975.5,0.16,1.1],[2637,0.07,0.7]].forEach(([f,v,d],i)=>{
      [0,0.28].forEach(off=>{ const o=actx.createOscillator(), g=actx.createGain(); o.type="sine"; o.frequency.value=f*(off?0.84:1);
        g.gain.setValueAtTime(0.0001,t+off); g.gain.exponentialRampToValueAtTime(v,t+off+0.008); g.gain.exponentialRampToValueAtTime(0.0001,t+off+d);
        o.connect(g); g.connect(actx.destination); o.start(t+off); o.stop(t+off+d+0.05); });
    });
  }catch(e){}
}
function maybeNotify(m){
  const creator=m.creator||(m.order&&m.order[0]);
  if(!creator || creator===ST.uid || m.code===ST.code || now()-(m.created||0)>5*60000) return;
  const who=(m.players&&m.players[creator]&&m.players[creator].name)||"Alguien";
  let box=$("notif"); if(!box){ box=document.createElement("div"); box.id="notif"; box.className="notif"; box.setAttribute("role","status"); document.body.appendChild(box); }
  box.html=`<span class="bellic" aria-hidden="true">🔔</span><span class="tx"><b>${esc(who)}</b> abrió <b>${esc(m.name)}</b><small>${GNAME[m.game]||""} · código ${esc(m.code)}</small></span><button class="btn sm go" data-open="${esc(m.code)}">Entrar</button><button class="btn sm" data-x="1" aria-label="Cerrar aviso">✕</button>`;
  box.hidden=false; bell(); clearTimeout(maybeNotify.t); maybeNotify.t=setTimeout(()=>{ box.hidden=true; },15000);
}
document.addEventListener("click",e=>{ const box=$("notif"); if(!box||!box.contains(e.target)) return;
  const o=e.target.closest("[data-open]"); if(o){ box.hidden=true; openMesa(o.dataset.open); return; }
  if(e.target.closest("[data-x]")) box.hidden=true; });
// ---------------- Tablero de campeones ----------------
UI.boardSort = lsGet("mc-sort")==="net" ? "net" : "chips";
function boardAgg(docs){
  const agg={};
  docs.forEach(m=>{ if(!m||!m.players) return;
    Object.values(m.players).forEach(p=>{ if(!p||p.bot) return;
      const k=normName(p.name); if(!k) return;
      const a=agg[k]||(agg[k]={name:p.name,chips:0,net:0,mesas:0,last:0});
      a.chips=r2(a.chips+(p.chips||0)); a.net=r2(a.net+(p.chips||0)-(m.buyIn||0)*(1+(p.rebuys||0))); a.mesas++;
      if((m.updated||0)>a.last){ a.last=m.updated||0; a.name=p.name; } }); });
  return agg;
}
// Tablero con podio: los 3 primeros arriba, el resto en lista; y tu tarjeta con tu lugar
const chipImg=(name,seat)=>window.L2 ? `<img class="l2ci" alt="" src="${L2.chipURL(name,seat)}">` : `<i class="dot" style="background:${SEATC[seat||0]}"></i>`;
function renderBoard2(){
  const rows=(UI.boardRows||[]).slice(0,12), byNet=UI.boardSort==="net";
  const val=r=> byNet ? `<span class="${r.net>0?"up":r.net<0?"down":""}">${sgn(r.net)}</span>` : fmt(r.chips);
  if(!rows.length){ $("board").html='<div class="empty">Aún no hay jugadores. Abre una mesa y empieza.</div>'; renderMe(); return; }
  const pod=[rows[1],rows[0],rows[2]].map((r,k)=>{ if(!r) return '<div class="l2pod"></div>'; const place=[2,1,3][k];
    return `<div class="l2pod p${place}">${place===1?'<span class="l2crown">👑</span>':''}<span class="l2chip s${place}">${chipImg(r.name)}</span><span class="nm">${esc(r.name)}</span><span class="am">${val(r)}</span><div class="st">${place}</div></div>`; }).join("");
  const rest=rows.slice(3), open=!!UI.boardOpen, shown=open?rest:rest.slice(0,2);
  $("board").html=`<div class="l2podium">${pod}</div>${shown.length?`<div class="l2more">${shown.map((r,i)=>`<div class="l2lr"><span class="k">${i+4}</span>${chipImg(r.name)}<span class="n">${esc(r.name)}</span><span class="v">${val(r)}</span></div>`).join("")}</div>`:""}${rest.length>2?`<button class="l2link" data-boardall>${open?"Ver menos ▴":`Ver los ${rows.length} jugadores ▾`}</button>`:""}`;
  renderMe();
}
function renderMe(){
  const me=normName(getAlias()), rows=UI.boardRows||[]; const i=rows.findIndex(r=>normName(r.name)===me), r=rows[i];
  if($("myChip")) $("myChip").html=chipImg(getAlias()||"?");
  $("myRank").textContent = r ? `#${i+1} de ${rows.length} jugadores` : (getAlias()? "Aún sin fichas en mesas" : "Escribe tu apodo para jugar");
  $("myStats").html = r ? `<div><span>Fichas</span><b>${fmt(r.chips)}</b></div><div><span>Ganancia</span><b class="${r.net>0?"up":r.net<0?"down":""}">${sgn(r.net)}</b></div>` : "";
}
document.addEventListener("click",e=>{ if(e.target.closest&&e.target.closest("[data-boardall]")){ UI.boardOpen=!UI.boardOpen; renderBoard2(); } });
async function loadBoard(){
  if(!ST.db){ $("boardBox").hidden=true; return; }
  if($("lobby").hidden) return;
  let docs=[]; try{ docs=(await ST.db.collection("mesas").limit(300).get()).docs.map(d=>d.data()); }catch(e){ $("board").html='<div class="empty">No se pudo cargar el tablero.</div>'; return; }
  const agg=boardAgg(docs);
  if(window.PUSH) PUSH.rankCheck(agg);
  const rows=Object.values(agg).sort((a,b)=>UI.boardSort==="net" ? b.net-a.net : b.chips-a.chips).slice(0,12);
  UI.boardRows=Object.values(agg).sort((a,b)=>UI.boardSort==="net" ? b.net-a.net : b.chips-a.chips); renderBoard2();
}
setInterval(()=>{ if(!$("lobby").hidden && document.visibilityState==="visible") loadBoard(); },20000);
function ago(t){ const m=Math.round((now()-t)/60000); return m<1?"ahora":m<60?`hace ${m} min`:m<1440?`hace ${Math.round(m/60)} h`:`hace ${Math.round(m/1440)} d`; }
function renderLobbyList(){
  const L=ST.mesas;
  $("mlist").html= L.length ? L.map(m=>{
    const n=Object.values(m.players||{}).filter(p=>!p.out).length;
    const cr=m.creator||(m.order&&m.order[0]); const host=(m.players&&m.players[cr]&&m.players[cr].name)||"—";
    const who=Object.values(m.players||{}).filter(p=>!p.out).sort((a,b)=>(a.seat||0)-(b.seat||0)).map(p=>chipImg(p.name,p.seat)).join("");
    return `<div class="l2mcard"><span class="l2gi sm" data-gi="${esc(m.game)}"></span><div class="t"><b>${esc(m.name)}</b><span>${GNAME[m.game]||""} · ${esc(m.code)} · ${n} jugando · ${ago(m.updated)}</span><div class="l2who">${who}</div></div><div class="l2mbtns">${canDelete(m)?`<button class="btn sm warn" data-del="${esc(m.code)}" aria-label="Eliminar mesa">🗑</button>`:""}<button class="btn sm" data-open="${esc(m.code)}">${n>=4&&!(m.players&&m.players[ST.uid])?"Mirar":"Entrar"}</button></div></div>`;
  }).join("") : '<div class="empty">No hay mesas abiertas. Abre una abajo en Mesa Nueva.</div>';
  if(window.L2) L2.paintIcons($("mlist"));
}
// Puede eliminar una mesa el dueño de la app, o la cuenta de quien la abrió o la reparte
function canDelete(m){
  if(!m||!ST.canMulti||ST.readOnly||!ST.acct) return false;
  const acctOf=id=>String(id||"").split("~")[0];
  const creator=(m.order&&m.order[0])||"";
  return !!ST.isOwner || acctOf(m.host)===ST.acct || acctOf(m.creator||creator)===ST.acct;
}
async function deleteMesa(code){
  if(!ST.db) return;
  try{
    for(const sub of ["acts","diag"]){ const q=await ST.db.collection(`mesas/${code}/${sub}`).get().catch(()=>({docs:[]}));
      for(const d of q.docs) await ST.db.doc(`mesas/${code}/${sub}/${d.id}`).delete().catch(()=>{}); }
    await ST.db.doc("mesas/"+code).delete();
    let last=null; try{ last=JSON.parse(lsGet("mc-last")||"null"); }catch(e){}
    if(last&&last.code===code){ try{ localStorage.removeItem("mc-last"); }catch(e){} }
    toast(`Mesa ${code} eliminada`);
    if(ST.code===code) closeMesa();
    resumeBox();
  }catch(e){ toast("No se pudo eliminar la mesa. Intenta otra vez."); }
}
function resumeBox(){
  let last=null; try{ last=JSON.parse(lsGet("mc-last")||"null"); }catch(e){}
  const ok = last && last.code && ST.canMulti;
  $("resumeBox").hidden=!ok;
  if(ok){ $("resName").textContent=last.name||last.code; const live=ST.mesas.find(m=>m.code===last.code);
    $("resInfo").textContent = live ? `${GNAME[live.game]} · código ${last.code} · ${ago(live.updated)}` : `Código ${last.code}`; $("resGo").dataset.open=last.code; }
}

// ---------------- Abrir / cerrar mesa ----------------
async function genCode(){
  for(let i=0;i<5;i++){
    let c=""; for(let j=0;j<4;j++) c+=CODECH[Math.floor(Math.random()*CODECH.length)];
    if(!ST.db) return c;
    try{ const s=await ST.db.doc("mesas/"+c).get(); if(!s.exists) return c; }catch(e){ return c; }
  }
  return "M"+Math.random().toString(36).slice(2,5).toUpperCase();
}
const READONLY_TXT = "Tu acceso a esta app es solo para mirar, así que no puedes sentarte ni abrir mesas. Pídele al dueño que te invite como Editor desde el menú Compartir.";
async function createMesa(){
  if(ST.readOnly && ST.canMulti){ toast(READONLY_TXT); return; }
  const alias=getAlias(); if(!alias){ toast("Primero cambia tu apodo: así te van a ver en la mesa"); $("alias").focus(); window.scrollTo(0,0); return; }
  $("create").disabled=true;
  const code=await genCode();
  const FUN=["La Suerte","Mesa Dorada","As de Oro","Doble o Nada","Casa Llena","La Racha","Noche de Casino","La Ficha Loca","Todo al Rojo","Flor Imperial"];
  const name=$("mesaName").value.replace(/[\u0000-\u001f]/g,"").trim().slice(0,28) || FUN[Math.floor(Math.random()*FUN.length)];
  saveAlias(); const T=newTable(code,name,UI.buyIn,UI.createGame,ST.uid,alias);
  $("create").disabled=false;
  await openMesa(code,T);
}
async function openMesa(code,T0){
  const alias=getAlias(); if(!alias){ toast("Primero cambia tu apodo: así te van a ver en la mesa"); $("alias").focus(); window.scrollTo(0,0); return; }
  code=String(code).toUpperCase().trim();
  closeMesa(true);
  ST.code=code; ST.ref = ST.canMulti ? ST.db.doc("mesas/"+code) : null;
  if(T0){
    ST.T=T0;
    if(ST.ref){ try{ await ST.ref.set(clone(T0)); }catch(e){ toast("No se pudo crear la mesa. Intenta otra vez."); ST.code=null; ST.ref=null; ST.T=null; return; }  if(window.PUSH) PUSH.mesaNueva(T0); }
  } else {
    if(!ST.ref){ toast("En esta vista no hay mesas compartidas"); return; }
    let s; try{ s=await ST.ref.get(); }catch(e){ toast("No se pudo abrir la mesa. Intenta otra vez."); return; }
    if(!s.exists){ toast(`No encontré la mesa ${code}`); ST.code=null; ST.ref=null; return; }
    ST.T=clone(s.data());
    if(window.PUSH) PUSH.entered(code);
  }
  Object.assign(UI,{since:now(),dup:null,lastChange:now(),dueSince:0,first:true,game:null,round:null,bets:{},ready:false,stack:[],move:null,shell:null,wheelRound:null,pkKey:"",alertKey:null});
  UI.cardAt.clear(); UI.hold={};
  $("lobby").hidden=true; $("mesa").hidden=false; window.scrollTo(0,0);
  lsSet("mc-last", JSON.stringify({code, name:ST.T.name}));
  if(ST.ref) ST.unsubDoc = ST.ref.onSnapshot(s=>{
    if(s.exists) onRemote(s.data());
    else if(ST.T && ST.code===code && !s.metadata.hasPendingWrites){ toast("Esta mesa se eliminó"); closeMesa(); }
  }, ()=>{});
  connectRoom(code);
  watchReacts(code);
  saveAlias(); ensureSeat(alias);
  if(!ST.T.open) mesaDo(T=>{ if(T.open) return false; T.open=true; return true; });
  render();
}
function closeMesa(silent){
  ST.unsubDoc && ST.unsubDoc(); ST.unsubDoc=null; stopReacts();
  ST.rmOff.forEach(f=>{ try{ f(); }catch(e){} }); ST.rmOff=[];
  if(ST.rm){ ST.rm.leave().catch(()=>{}); ST.rm=null; }
  Q.length=0;
  ST.T=null; ST.code=null; ST.ref=null; ST.peers=[]; ST.conn=false;
  if(!silent){ $("mesa").hidden=true; $("lobby").hidden=false; resumeBox(); window.scrollTo(0,0); loadBoard(); }
}
// Con la misma cuenta, cada persona se reconoce por su apodo (Frito, Xime…)
function acctSeats(T){ if(!ST.acct) return []; return Object.keys(T.players).filter(id=>id===ST.acct||id.startsWith(ST.acct+"~")); }
function mySeats(T){ return acctSeats(T).filter(id=>!T.players[id].out); }
const normName = s => String(s||"").trim().toLowerCase();
const newPid = () => ST.acct+"~"+Math.random().toString(36).slice(2,8);
function adopt(id,save){
  ST.uid=id; if(save!==false && ST.acct) lsSet("mc-pid:"+ST.acct,id);
  if(ST.rm) ST.rm.presence({uid:ST.uid,name:getAlias(),since:UI.since}).catch(()=>{});
  UI.game=null; UI.move=null;
}
function ensureSeat(alias){
  const T=ST.T; UI.dup=null;
  if(ST.acct){
    const same=acctSeats(T).find(id=>normName(T.players[id].name)===normName(alias));
    if(same){
      if(same!==ST.uid) adopt(same);
      if(!T.players[same].out) return;
    } else if(T.players[ST.uid]) adopt(newPid()); // apodo nuevo en esta cuenta: es otra persona
  } else {
    const p=T.players[ST.uid];
    if(p && !p.out){ if(p.name!==alias) sendAct("join",{name:alias}); return; }
  }
  // ¿Ya hay un lugar con este apodo de otro cel (app reinstalada, cel nuevo) y ese cel no está aquí? Es tuyo: tómalo
  const mine=sameNameSeat(T,alias);
  if(mine && !T.players[ST.uid]){ adopt(mine,false); if(!T.players[mine].out) return; }
  if(seatsUsed(T)<MAXP) sendAct("join",{name:alias});
  else toast("La mesa está llena: estás mirando");
}
// Si dos cels entran con el mismo apodo, el que llegó después se queda mirando
function checkDup(){
  if(!ST.T||!ST.acct||UI.dup) return;
  const older=()=>ST.peers.find(p=>!p.sameTab && p.presence && !p.presence.away && p.presence.uid===ST.uid && (p.presence.since||0)<UI.since);
  if(!older()){ clearTimeout(checkDup.t); checkDup.t=null; return; }
  if(checkDup.t) return;
  checkDup.t=setTimeout(()=>{ checkDup.t=null;
    if(!older()||!ST.T) return;
    UI.dup=pname(ST.T,ST.uid); Q.length=0; adopt(newPid(),false); render();
  },6000);
}
function onRemote(d){
  if(!d || d.code!==ST.code) return;
  const mine=ST.T;
  if(mine && (d.seq||0)<(mine.seq||0)) return;
  if(!mine || d.seq!==mine.seq) UI.lastChange=now();
  ST.T=d; render();
}
let pullTimer=null;
function pull(seq){
  clearTimeout(pullTimer);
  pullTimer=setTimeout(async()=>{ if(!ST.ref||!ST.T||ST.T.seq>=seq) return; try{ const s=await ST.ref.get(); if(s.exists) onRemote(s.data()); }catch(e){} },500);
}
async function connectRoom(code){
  if(!ST.room) { renderConn(); return; }
  try{
    const rm=await ST.room.join("m-"+code.toLowerCase());
    if(ST.code!==code){ rm.leave().catch(()=>{}); return; }
    ST.rm=rm; ST.conn=rm.connected();
    ST.rmOff.push(rm.on("tick", m=>{ if(m.data && ST.T && m.data.seq>ST.T.seq) pull(m.data.seq); }));
    ST.rmOff.push(rm.onPeers(ch=>{ ST.peers=ch.peers; checkDup(); render(); }, ()=>{}));
    // revisa cada pocos segundos si alguien dejó de latir, aunque no llegue ningún aviso nuevo
    clearInterval(connectRoom.chk); connectRoom.chk=setInterval(()=>{ if(ST.rm===rm && ST.T) render(); },3000);
    ST.rmOff.push(rm.onConnection(c=>{ ST.conn=c; renderConn(); }, ()=>{ ST.conn=false; renderConn(); }));
    rm.presence({uid:ST.uid, name:getAlias(), since:UI.since, away:document.visibilityState==="hidden", hb:Date.now()}).catch(()=>{});
    clearInterval(connectRoom.hb);
    connectRoom.hb=setInterval(()=>{ if(ST.rm===rm && document.visibilityState==="visible") rm.presence({hb:Date.now(), away:false}).catch(()=>{}); },10000);
  }catch(e){ ST.rm=null; }
  renderConn();
}
function presentSet(){
  if(!ST.rm || !ST.conn) return null;
  const s=new Set([ST.uid]);
  const t=now();
  ST.peers.forEach(p=>{
    if(!p.presence || p.presence.away) return;
    if(p.presence.hb && t-(p.updatedAt||0) > 28000) return;   // dejó de latir: cerró la app o se le apagó el cel
    const id=p.presence.uid||p.by; if(id) s.add(id);
  });
  return s;
}

// ---------------- Jugadas sin anfitrión ----------------
// Cada cel escribe su jugada directo en la mesa: lee la mesa más reciente, aplica la
// jugada, guarda, y vuelve a leer para confirmar que quedó. Si otro cel la pisó al mismo
// tiempo, la vuelve a aplicar encima. Todas las jugadas se pueden repetir sin duplicarse.
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const Q=[]; let txBusy=false;
async function txn(fn){
  if(!ST.T) return false;
  if(!ST.ref){ const ch=fn(ST.T); if(ch){ ST.T.seq=(ST.T.seq||0)+1; ST.T.updated=now(); UI.lastChange=now(); render(); } return !!ch; }
  const code=ST.code, ref=ST.ref; let wrote=false;
  if(ref.txn){                                   // app: transacción de Firebase, nadie pisa la jugada de otro
    for(let i=0;i<4;i++){
      try{
        const r=await ref.txn(T=>{ if(!fn(T)) return false; T.seq=(T.seq||0)+1; T.updated=now(); return true; });
        if(ST.code!==code) return r.ok;
        if(r.T){ if(r.ok){ if(!ST.T || r.T.seq>=(ST.T.seq||0)){ ST.T=r.T; UI.lastChange=now(); render(); } } else onRemote(r.T); }
        if(r.ok && ST.rm) ST.rm.emit("tick",{seq:r.T.seq}).catch(()=>{});
        return r.ok;
      }catch(e){ if(i===3) throw e; await sleep(250*(i+1)+Math.random()*200); }
    }
  }
  for(let i=0;i<6;i++){
    const s=await ref.get();
    if(ST.code!==code || !s.exists) return wrote;
    const T=clone(s.data());                    // la base entrega datos congelados: se edita una copia
    if(!fn(T)){ onRemote(T); return wrote; }   // ya está aplicada (o no hace falta)
    T.seq=(T.seq||0)+1; T.updated=now();
    await ref.set(T); wrote=true;
    if(ST.code!==code) return true;
    if(!ST.T || T.seq>=(ST.T.seq||0)){ ST.T=T; UI.lastChange=now(); render(); }
    if(ST.rm) ST.rm.emit("tick",{seq:T.seq}).catch(()=>{});
    await sleep(220+Math.random()*200);         // deja caer escrituras simultáneas y confirma
  }
  return wrote;
}
function mesaDo(fn,key){
  if(ST.readOnly && ST.canMulti){ toast(READONLY_TXT); return; }
  if(key){ const i=Q.findIndex((x,j)=>j>0 && x.key===key); if(i>0) Q.splice(i,1); }
  Q.push({fn,key,tries:0}); runQ();
}
async function runQ(){
  if(txBusy) return; txBusy=true;
  try{
    while(Q.length && ST.T){
      const it=Q[0];
      try{ await txn(it.fn); Q.shift(); }
      catch(e){
        if(e && e.code==="invalid_argument" && ST.canMulti){ ST.readOnly=true; Q.length=0; render(); break; }
        it.tries++; try{ console.warn("mesa: no se guardó la jugada", e); }catch(_){}
        if(it.tries>5){ Q.shift(); toast(`No se pudo guardar tu jugada (${(e&&e.code)||"error"}). Revisa tu conexión e intenta otra vez.`); }
        else await sleep(Math.min(4000,350*it.tries));
      }
    }
  } finally { txBusy=false; }
  if(Q.length && ST.T) runQ();
}
const eqBets=(a,b)=>{ const ka=Object.keys(a||{}).filter(k=>a[k]>0), kb=Object.keys(b||{}).filter(k=>b[k]>0); return ka.length===kb.length && ka.every(k=>r2(a[k])===r2(b[k])); };
let betTimer=null;
function pushBets(immediate){
  clearTimeout(betTimer);
  const send=()=>{ if(ST.T) sendAct("bets",{game:ST.T.game,round:UI.round,bets:clone(UI.bets),ready:UI.ready}); };
  if(immediate) send(); else betTimer=setTimeout(send,250);
}
function sendAct(kind,data){ mesaDo(T=>hostAct(T,ST.uid,{kind,data},presentSet()), kind==="bets"?"bets":null); }
// Orden de llegada: decide quién empuja primero la mesa cuando algo toca (repartir, siguiente ronda, bots)
const byJoin = T => (a,b)=>((T.players[a].joined||0)-(T.players[b].joined||0)) || ((T.players[a].seat||0)-(T.players[b].seat||0));
setInterval(()=>{
  const T=ST.T; if(!T || (ST.readOnly&&ST.canMulti) || document.visibilityState==="hidden" || txBusy || Q.length) return;
  const pres=presentSet(), t=now();
  let due=false; try{ due=hostTick(clone(T),pres,7000); }catch(e){}
  if(!due){ UI.dueSince=0; return; }
  if(!UI.dueSince) UI.dueSince=t;
  const order=humans(T).filter(id=>!pres||pres.has(id)).sort(byJoin(T));
  let rank=order.indexOf(ST.uid); if(rank<0) rank=order.length;
  if(t-UI.dueSince < rank*700) return;
  UI.dueSince=0;
  mesaDo(T=>hostTick(T,presentSet(),7000));
},400);

// ---------------- Acciones del jugador ----------------
function syncLocal(){
  const T=ST.T, g=T.g;
  if(!GAMES[T.game].keys){ UI.game=T.game; UI.round=null; return; }
  if(UI.game!==T.game || UI.round!==g.round){
    UI.game=T.game; UI.round=g.round; UI.bets=clone((g.bets||{})[ST.uid]||{}); UI.ready=!!(g.ready||{})[ST.uid]; UI.stack=[];
  }
  if(g.phase!=="bet" && g.bets && g.bets[ST.uid]) UI.last[T.game]=clone(g.bets[ST.uid]);
}
const avail = () => { const p=me(); return p ? r2(p.chips - sumObj(UI.bets)) : 0; };
function placeBet(k){
  const T=ST.T, p=me(); if(!p||T.g.phase!=="bet") return;
  const a=UI.chip, av=avail();
  if(a>av+0.001){ toast(av>0?`Solo tienes ${fmt(av)} libres`:"No te quedan fichas libres"); return; }
  UI.bets[k]=r2((UI.bets[k]||0)+a); UI.stack.push([k,a]); UI.ready=false; pushBets(); render();
}
function undoBet(){ const x=UI.stack.pop(); if(!x) return; UI.bets[x[0]]=r2(UI.bets[x[0]]-x[1]); if(UI.bets[x[0]]<=0) delete UI.bets[x[0]]; UI.ready=false; pushBets(); render(); }
function clearBets(){ UI.bets={}; UI.stack=[]; UI.ready=false; pushBets(); render(); }
function repeatBets(){ const L=UI.last[ST.T.game]; if(!L) return; const s=sumObj(L), p=me(); if(!p||s>p.chips){ toast("No te alcanza para repetir"); return; }
  UI.bets=clone(L); UI.stack=Object.entries(L).map(([k,v])=>[k,v]); UI.ready=false; pushBets(); render(); }
function setReady(){ UI.ready=true; pushBets(true); render(); }
function doMove(m,extra){ const T=ST.T; const d=Object.assign({game:T.game,k:T.g.k,m},extra||{}); UI.move={d,tries:0}; sendAct("move",d); render(); }
function rebuy(){ const p=me(); if(!p) return; sendAct("rebuy",{n:(p.rebuys||0)+1}); toast("Recomprando fichas…"); }

// ---------------- Cartas ----------------
// Cada carta nueva aparece con un pequeño retraso, en orden de reparto
function cardsHTML(key,cards,o){
  o=o||{}; const t=now(); let h="";
  cards.forEach((c,i)=>{
    const hidden = c==="??" || (o.hide && o.hide(i));
    const id=key+":"+i+":"+(hidden?"??":c);
    let at=UI.cardAt.get(id);
    if(at===undefined){ at = UI.first ? 0 : t + (o.ord ? (UI.qn+o.ord(i)) : UI.qn++)*330; UI.cardAt.set(id,at); }
    const cls=(o.sm?" sm":"")+(o.side&&o.side(i)?" side":"")+(o.dim?" dim":"");
    if(at>t){ UI.wake = UI.wake ? Math.min(UI.wake,at) : at; h+=`<div class="slot ghost${o.sm?" sm":""}"></div>`; return; } // aún no sale: lugar vacío
    const anim = t-at<380 ? ` new" style="--d:${((at-t)/1000).toFixed(2)}s` : "";
    if(hidden) h+=`<div class="card back${cls}${anim}"></div>`;
    else { const r=c[0]==="T"?"10":c[0], s=c[1]; h+=`<div class="card${s==="H"||s==="D"?" r":""}${cls}${anim}"><span class="rk">${r}</span><span class="st">${SUITCH[s]}</span></div>`; }
  });
  if(o.ord) UI.qn += (o.span!==undefined ? o.span : cards.length);
  for(let i=cards.length;i<(o.slots||0);i++) h+=`<div class="slot"></div>`;
  return h;
}
// Tiempo que falta para mostrar un resultado (después de que salgan las cartas)
function revealIn(key,extra){
  if(UI.hold[key]===undefined){ UI.hold[key] = UI.first ? 0 : now() + UI.qn*330 + (extra||350); if(ST.T) diag("res",{k:key,lag:now()-(ST.T.updated||0),first:UI.first,anim:UI.qn}); }
  const ms=UI.hold[key]-now();
  if(ms>0){ clearTimeout(revealIn.t); revealIn.t=setTimeout(render, ms+30); }
  return Math.max(0,ms);
}
const gk = g => (g&&g.gid?g.gid:"")+"·";
const revealPending = g => { const k="bac:"+gk(g)+g.round; return UI.hold[k]===undefined || UI.hold[k]>now(); };
const PAY_DELAY = 1000;   // el dinero se mueve un segundo después de ver el resultado
function resultKey(T){ const g=T.g;
  if(T.game==="pk") return g.phase==="show" ? "pk:"+gk(g)+g.hand : null;
  return g.phase==="result" ? ({bac:"bac:",rul:"rul:",bj:"bj:"})[T.game]+gk(g)+g.round : null; }
// cuánto cambió cada quien en este resultado (lo que aún no se muestra)
function payOf(T,id){ const g=T.g; return T.game==="pk" ? ((g.won||{})[id]||0) : ((g.net||{})[id]||0); }
function payState(T){
  const k=resultKey(T); if(!k) return {paid:true};
  const h=UI.hold[k]; if(h===undefined) return {paid:false, k};
  const at=h+PAY_DELAY, t=now();
  if(t<at){ UI.wake = UI.wake ? Math.min(UI.wake,at) : at; return {paid:false,k}; }
  return {paid:true, k, since:t-at};
}
const shownChips = (T,id) => { const ps=payState(T); return ps.paid ? T.players[id].chips : r2(T.players[id].chips - payOf(T,id)); };
const late = ms => ms>0 ? ` pending"` : "";   // oculto hasta su momento; revealIn redibuja a tiempo

// ---------------- Render general ----------------
function render(){
  try{ renderInner(); }
  catch(e){ diag("err",{m:"render: "+String(e&&e.message||e).slice(0,140)}); }
  UI.first=false;
  if(UI.wake){ const ms=Math.max(16,UI.wake-now()+8); UI.wake=0; clearTimeout(render.w); render.w=setTimeout(render,ms); }
}
function renderInner(){
  const T=ST.T; if(!T) return;
  syncLocal(); UI.qn=0; UI.wake=0;
  if(UI.move && (T.game!==UI.move.d.game || T.g.k!==UI.move.d.k)) UI.move=null;
  $("mName").textContent=T.name; $("mCode").textContent="Código "+T.code;
  document.querySelectorAll("#tabs button").forEach(b=>{ b.classList.toggle("on",b.dataset.g===T.game); b.disabled = b.dataset.g!==T.game && (!me() || !canSwitch(T)); });
  renderWho(); autoSeat(T); $("hostWarn").hidden=true; renderReacts(T); setTimeout(()=>ST.T&&mergeDups(ST.T),3000);
  ({bac:renderBac,rul:renderRul,bj:renderBj,pk:renderPk})[T.game](T,T.g);
  renderSeats();
  renderHostbar(); renderLog(); renderConn(); renderAlert(T);
  UI.first=false;
}
// Aviso llamativo cuando te toca o ya puedes apostar
function alertOf(T){
  const g=T.g, p=me(); if(!p) return null;
  if((T.game==="bj"&&g.phase==="play"&&g.turn&&g.turn.id===ST.uid) || (T.game==="pk"&&g.toAct===ST.uid&&["pre","flop","turn","river"].includes(g.phase)))
    return {key:`t:${T.game}:${g.round||g.hand}:${g.k}`, kind:"turn", html:`¡Te toca! <small>${T.game==="pk"?"decide tu jugada":"pide o plántate"}</small>`};
  if(g.phase==="bet" && GAMES[T.game].keys && !sumObj(UI.bets) && !UI.ready && p.chips>=10)
    return {key:`b:${T.game}:${g.round}`, kind:"bet", html:`¡Ya puedes apostar! <small>elige ficha y toca la mesa</small>`};
  return null;
}
function renderAlert(T){
  const al=alertOf(T), c=$("callout");
  $("dock").classList.toggle("alert",!!al);
  $("game").classList.toggle("beckon",!!al&&al.kind==="bet");
  if(!al){ c.hidden=true; UI.alertKey=null; return; }
  if(al.key!==UI.alertKey){
    const wasFirst=UI.alertKey===null && UI.first;
    UI.alertKey=al.key; c.html=al.html; c.hidden=false;
    c.style.animation="none"; void c.offsetWidth; c.style.animation="";
    if(!wasFirst){ ding(al.kind); if(al.kind==="turn") $("dock").scrollIntoView({block:"nearest",behavior:"smooth"}); }
  }
}
// Sonido de ganancia: arpegio brillante tipo campanita + destellos de monedas, con un poco de eco
function coins(amount){
  if(lsGet("mc-bell")==="off"||!actx) return;
  try{
    const t=actx.currentTime+0.02;
    // salida suave: filtro para quitar lo chillón y un eco corto para dar calidez
    const out=actx.createGain(); out.gain.value=0.55;
    const lp=actx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=6500; lp.Q.value=0.3;
    const dl=actx.createDelay(1); dl.delayTime.value=0.13; const fb=actx.createGain(); fb.gain.value=0.22; const wet=actx.createGain(); wet.gain.value=0.28;
    out.connect(lp); lp.connect(actx.destination); lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(actx.destination);
    // campanita: fundamental + armónicos suaves que se apagan más rápido
    const bellNote=(f,at,dur,v)=>{
      [[1,v],[2.01,v*0.28],[3.02,v*0.12]].forEach(([m,g0],k)=>{
        const o=actx.createOscillator(), g=actx.createGain(); o.type="sine"; o.frequency.value=f*m;
        const d=dur/(1+k*0.9);
        g.gain.setValueAtTime(0.0001,at); g.gain.exponentialRampToValueAtTime(g0,at+0.006); g.gain.exponentialRampToValueAtTime(0.0001,at+d);
        o.connect(g); g.connect(out); o.start(at); o.stop(at+d+0.05);
      });
    };
    // arpegio Do mayor que sube (más notas si ganas más)
    const big = amount>=5000, notes = big ? [1046.5,1318.5,1568,2093,2637] : [1046.5,1318.5,1568,2093];
    notes.forEach((f,i)=>bellNote(f, t+i*0.075, 0.55+i*0.08, 0.22));
    // acorde final que se queda sonando
    const end=t+notes.length*0.075+0.02;
    [1568,2093,2637].forEach(f=>bellNote(f,end,big?1.4:0.9,0.11));
    // destellos de monedas: pings agudos muy breves y bajitos
    const n = big ? 7 : 4;
    for(let i=0;i<n;i++){
      const at=t+0.05+i*0.06+Math.random()*0.04, f=3800+Math.random()*1800;
      const o=actx.createOscillator(), g=actx.createGain(); o.type="sine"; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,at); g.gain.exponentialRampToValueAtTime(0.045,at+0.003); g.gain.exponentialRampToValueAtTime(0.0001,at+0.12);
      o.connect(g); g.connect(out); o.start(at); o.stop(at+0.15);
    }
  }catch(e){}
}
function ding(kind){
  if(lsGet("mc-bell")==="off"||!actx) return;
  try{
    const t=actx.currentTime, notes = kind==="turn" ? [[659.3,0],[880,0.12],[1318.5,0.24]] : [[784,0],[1046.5,0.13]];
    notes.forEach(([f,off])=>{ const o=actx.createOscillator(), g=actx.createGain(); o.type="triangle"; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t+off); g.gain.exponentialRampToValueAtTime(kind==="turn"?0.28:0.16,t+off+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+off+0.45);
      o.connect(g); g.connect(actx.destination); o.start(t+off); o.stop(t+off+0.5); });
  }catch(e){}
}
function renderConn(){
  const el=$("conn"); if(!el) return;
  const live=ST.rm&&ST.conn;
  el.html= `<i class="dot${live?" on":""}"></i>${!ST.canMulti?"Solo":live?"En vivo":ST.rm?"Reconectando…":"Sin tiempo real"}`;
}
function isTurn(T,id){ const g=T.g; return (T.game==="bj"&&g.phase==="play"&&g.turn&&g.turn.id===id) || (T.game==="pk"&&g.toAct===id); }
function renderSeats(){
  const T=ST.T, g=T.g, pres=presentSet(), by={};
  seated(T).forEach(id=>by[T.players[id].seat]=id);
  let h="";
  for(let s=0;s<MAXP;s++){
    const id=by[s];
    if(!id){ h+=`<div class="seat free">Libre</div>`; continue; }
    const p=T.players[id], away=!p.bot && pres && !pres.has(id);
    const ch=shownChips(T,id), neto=r2(ch - T.buyIn*(1+(p.rebuys||0)));
    const pst=payState(T), pay=payOf(T,id);
    const delta = pst.paid && pst.k && pay && pst.since<2600 ? `<span class="delta ${pay>0?"up":"down"}">${sgn(pay)}</span>` : "";
    // sonido de monedas cuando a ti te pagan (una vez por resultado; al perder no suena nada)
    if(id===ST.uid && pst.paid && pst.k && pay>0 && pst.since<2600 && UI.coinKey!==pst.k){ UI.coinKey=pst.k; coins(pay); if(window.PUSH) PUSH.rankSoon(); }
    const tags=[];
    if(id===ST.uid) tags.push("<b>tú</b>");
    if(p.bot) tags.push("bot");
    if(away) tags.push("fuera");
    if(g.phase==="bet" && g.bets){ const b=sumObj(g.bets[id]); if(b) tags.push(fmtK(b)); if(g.ready[id]) tags.push("✓ listo"); }
    if(T.game==="pk" && g.ps && g.ps[id]){ if(g.btn===id) tags.push("D"); if(g.ps[id].fold) tags.push("fuera de la mano"); else if(g.ps[id].allin) tags.push("all-in"); }
    h+=`<div data-pid="${esc(id)}" class="seat${id===ST.uid?" me":""}${isTurn(T,id)?" turn":""}${away?" away":""}">
      <div class="nm">${chipImg(p.name,s)}<span>${esc(p.name)}</span></div>
      <div class="ch">${fmt(ch)}${delta}</div>
      <div class="tg"><span class="${neto>0?"up":neto<0?"down":""}">${neto?sgn(neto):"±0"}</span>${tags.map(t=>`<span>${t}</span>`).join("")}</div></div>`;
  }
  $("seats").html=h;
}
function renderWho(){
  const box=$("whoBox"), T=ST.T;
  if(ST.readOnly && ST.canMulti){ box.hidden=false; box.html=`<div><b>Estás mirando.</b> ${READONLY_TXT}</div>`; return; }
  if(UI.dup){ box.hidden=false; box.html=`<div><b>Ya hay alguien jugando como ${esc(UI.dup)} en otro cel.</b> Para jugar desde este, regresa al lobby, escribe otro apodo (por ejemplo tu nombre) y vuelve a entrar.</div><div class="row"><button class="btn sm go" data-who="lobby">Cambiar mi apodo</button></div>`; return; }
  // Mesa llena: si hay bots, se puede tomar su lugar
  if(!me() && seatsUsed(T)>=MAXP){
    const bots=seated(T).filter(id=>T.players[id].bot);
    const mine=bots.find(id=>T.players[id].claim && T.players[id].claim.uid===ST.uid);
    box.hidden=false;
    box.html= mine
      ? `<div><b>Listo:</b> tomas el asiento de ${esc(pname(T,mine))} en cuanto termine esta mano.</div>`
      : bots.length
      ? `<div><b>La mesa está llena.</b> Puedes tomar el lugar de un bot${T.game==="pk"&&!PK.idle(T)?"; si está jugando una mano, se retira y entras en la siguiente":""}.</div><div class="row">${bots.map(id=>`<button class="btn sm go" data-who="bot:${esc(id)}">Tomar asiento de ${esc(pname(T,id))}</button>`).join("")}</div>`
      : `<div><b>La mesa está llena (4 de 4).</b> Estás mirando; si alguien se levanta, te sientas solo.</div>`;
    return;
  }
  box.hidden=true;
}
// Al entrar (o si se libera un lugar) te sientas solo
function sameNameSeat(T,alias){
  const pres=presentSet();
  return Object.keys(T.players).find(id=>id!==ST.uid && !T.players[id].bot && normName(T.players[id].name)===normName(alias) && !(pres&&pres.has(id)));
}
function autoSeat(T){
  if(me() || UI.dup || (ST.readOnly&&ST.canMulti) || !getAlias()) return;
  if(now()-(UI.joinAt||0)<2500) return;
  // ¿Ya tienes lugar con este apodo desde otro cel o de antes de reinstalar? Ese es tuyo
  const mine=!T.players[ST.uid] && sameNameSeat(T,getAlias());
  if(mine){ adopt(mine,false); if(!T.players[mine].out) return; }
  if(seatsUsed(T)>=MAXP) return;
  UI.joinAt=now(); sendAct("join",{name:getAlias()});
}
function takeBot(id){ const alias=getAlias(); mesaDo(T=>claimBot(T,id,ST.uid,alias)); }
function claimSeat(id){
  if(String(id).startsWith("bot:")){ takeBot(id.slice(4)); return; }
  if(id==="lobby"){ closeMesa(); $("alias").focus(); $("alias").select(); }
}
function renderLog(){
  const L=(ST.T.log||[]).slice(-6).reverse();
  const p=me();
  $("log").html= `<div class="row" style="margin-top:6px">${p?`<button class="btn sm" data-act="leave">Dejar mi lugar</button>`:""}${canDelete(ST.T)?`<button class="btn sm warn" data-act="del">Eliminar mesa</button>`:""}</div>`;
}
function renderHostbar(){
  const T=ST.T, g=T.g, b=[];
  if(me()){
    if(g.phase==="bet" && g.bets && Object.keys(g.bets).length && !allReady(T,presentSet())) b.push(`<button class="btn sm" data-act="force">Repartir ya</button>`);
    const turnId = T.game==="bj" ? (g.phase==="play"&&g.turn&&g.turn.id) : T.game==="pk" ? g.toAct : null;
    if(turnId && turnId!==ST.uid && !(T.players[turnId]||{}).bot && now()-(g.turnAt||0)>15000) b.push(`<button class="btn sm" data-act="skip">Saltar turno de ${esc(pname(T,turnId))}</button>`);
    if(T.game==="pk" && PK.idle(T)){
      if(seatsUsed(T)<MAXP) b.push(`<button class="btn sm" data-act="addbot">+ Bot</button>`);
      if(seated(T).some(id=>T.players[id].bot)) b.push(`<button class="btn sm" data-act="rmbot">− Bot</button>`);
    }
  }
  $("hostbar").html= b.length ? `<span class="lbl">Mesa</span>${b.join("")}` : "";
  $("hostbar").hidden=!b.length;
}

// Controles comunes de los juegos de apuesta
function chipsRow(){ return `<div class="chips">${CHIPS.map(v=>window.L2 ? (bc=>`<button class="chip l2bet${UI.chip===v?" sel":""}" data-chip="${v}" aria-label="Ficha de ${v}"><img alt="" src="${bc.url}"><b style="color:${bc.ink}">${bc.label}</b></button>`)(L2.betChip(v)) : `<button class="chip${UI.chip===v?" sel":""}" data-chip="${v}" aria-label="Ficha de ${v}">${fmtK(v)}</button>`).join("")}</div>`; }
function betControls(T){
  const g=T.g, p=me();
  if(!p) return spectate(T);
  if(g.phase!=="bet") return `<div class="wallet"><span>Fichas <b>${fmt(shownChips(T,ST.uid))}</b></span><span>${g.phase==="result"?"Siguiente ronda en unos segundos":"Ronda en juego"}</span></div>`;
  if(p.chips<10 && !sumObj(UI.bets)) return `<div class="wallet"><span>Te quedaste sin fichas</span></div><button class="btn go" data-act="rebuy">Recomprar ${fmt(T.buyIn)}</button>`;
  const need=needReady(T,presentSet()), others=need.filter(id=>id!==ST.uid);
  const has=sumObj(UI.bets)>0;
  const waiting=others.filter(id=>!g.ready[id]).map(id=>pname(T,id));
  const label = UI.ready ? "Listo ✓" : others.length ? (has?"Listo":"Paso esta ronda") : "Repartir";
  return `<div class="wallet"><span>Libres <b>${fmt(avail())}</b></span><span>En la mesa <b>${fmt(sumObj(UI.bets))}</b></span></div>
    ${chipsRow()}
    <div class="acts">
      <button class="btn" data-act="undo"${UI.stack.length?"":" disabled"}>Deshacer</button>
      <button class="btn" data-act="clear"${has?"":" disabled"}>Limpiar</button>
      <button class="btn" data-act="repeat"${UI.last[T.game]&&!has?"":" disabled"}>Repetir</button>
      <button class="btn go" data-act="ready"${UI.ready||(!has&&!others.length)?" disabled":""}>${label}</button>
    </div>
    ${others.length?`<div class="waiting">${waiting.length?"Esperando a "+waiting.map(esc).join(", "):"Todos listos"}</div>`:""}`;
}
function spectate(T){ return `<div class="waiting">Estás mirando esta mesa.${seatsUsed(T)<MAXP?" Toca “Sentarme” abajo para jugar.":" Está llena."}</div>`; }
function othersDots(T,g,k){
  const ids=Object.keys(g.bets||{}).filter(id=>id!==ST.uid && g.bets[id][k]>0);
  return ids.map(id=>`<i style="background:${SEATC[(T.players[id]||{}).seat||0]}" title="${esc(pname(T,id))}"></i>`).join("");
}
function myResult(T,g){
  const n=(g.net||{})[ST.uid]; if(n===undefined) return "";
  return `<small class="${n>0?"up":n<0?"down":""}">${n>0?"Ganaste "+fmt(n):n<0?"Perdiste "+fmt(-n):"Recuperas tu apuesta"}</small>`;
}
function othersResult(T,g){
  const ids=Object.keys(g.net||{}).filter(id=>id!==ST.uid);
  return ids.length ? `<div class="waiting">${ids.map(id=>`${esc(pname(T,id))} <span class="${g.net[id]>0?"up":g.net[id]<0?"down":""}">${sgn(g.net[id])}</span>`).join(" · ")}</div>` : "";
}

// ---------------- Baccarat ----------------
function renderBac(T,g){
  const res=g.phase==="result", mine=g.phase==="bet"?UI.bets:((g.bets||{})[ST.uid]||{});
  UI.shell="bac"; UI.pkKey="";
  const histShown = (res&&revealPending(g)) ? (g.hist||"").slice(0,-1) : (g.hist||"");
  const pc = res ? cardsHTML("bacP"+gk(g)+g.round, g.P, {ord:i=>i*2, span:0, side:i=>i===2, slots:2}) : '<div class="slot"></div><div class="slot"></div>';
  const bc = res ? cardsHTML("bacB"+gk(g)+g.round, g.B, {ord:i=>i*2+1, span:6, side:i=>i===2, slots:2}) : '<div class="slot"></div><div class="slot"></div>';
  const msR = res ? revealIn("bac:"+gk(g)+g.round) : 0;
  const win=res&&msR===0?g.res:null;
  const ban = res ? `<div class="banner${late(msR)}">${g.res==="T"?`Empate ${g.pt} a ${g.bt}`:`Gana ${g.res==="P"?"Jugador":"Banca"} ${Math.max(g.pt,g.bt)} a ${Math.min(g.pt,g.bt)}`}${myResult(T,g)}</div><div class="${late(msR)}">${othersResult(T,g)}</div>`
    : `<div class="banner">Hagan sus apuestas</div>`;
  const spot=(k,n,pay)=>`<button class="spot ${k}${win===k||(win==="T"&&k==="T")?" won":""}" data-bet="${k}"${g.phase!=="bet"||!me()?" disabled":""}><span class="n">${n}</span><span class="pay">${pay}</span><span class="bet">${mine[k]?`${window.L2?`<img class="l2mini" alt="" src="${L2.betChipURL(UI.chip)}">`:""}${fmt(mine[k])}`:""}</span><span class="mk">${othersDots(T,g,k)}</span></button>`;
  $("game").html= `${ban}
    <div class="bac-tbl">
      <div class="bac-side P${win==="P"||win==="T"?" win":""}"><h3>Jugador</h3><div class="tot${late(msR)}">${res?g.pt:"–"}</div><div class="cards">${pc}</div></div>
      <div class="bac-side B${win==="B"||win==="T"?" win":""}"><h3>Banca</h3><div class="tot${late(msR)}">${res?g.bt:"–"}</div><div class="cards">${bc}</div></div>
    </div>
    <div class="spots">${spot("P","Jugador","paga ×2")}${spot("T","Empate","paga ×9")}${spot("B","Banca","paga ×1.95")}</div>
    <div class="roads">
      <div class="road-box"><span class="lbl">Historial</span><div class="scroll"><div class="bead">${histShown.split("").map(h=>`<div class="bd ${h}">${h==="P"?"J":h==="B"?"B":"E"}</div>`).join("")}</div></div></div>
      <div class="road-box"><span class="lbl">Rachas</span><div class="scroll"><div class="big">${bigRoad(histShown).map(c=>`<i class="br ${c.s}" style="grid-column:${c.col+1};grid-row:${c.row+1}">${c.t?`<b>${c.t>1?c.t:""}</b>`:""}</i>`).join("")||'<i class="br empty" style="grid-column:1;grid-row:1"></i>'}</div></div></div>
    </div>
    <p class="note">3 mazos · quedan ${shoeLen(g)} cartas · se baraja en un punto al azar${g.burn?` · zapato ${g.shoes}, quema ${cardTxt(g.burn.c)} (${g.burn.n})`:""} · empate devuelve Banca y Jugador</p>`;
  $("game").querySelectorAll(".scroll").forEach(sc=>sc.scrollLeft=1e6);
  $("controls").html=betControls(T);
}

// ---------------- Ruleta ----------------
function drawWheel(cv){
  const ctx=cv.getContext("2d"), R=150, seg=2*Math.PI/37; cv.width=R*2; cv.height=R*2;
  WHEEL.forEach((n,i)=>{
    const a0=-Math.PI/2 - seg/2 + i*seg;
    ctx.beginPath(); ctx.moveTo(R,R); ctx.arc(R,R,R,a0,a0+seg); ctx.closePath();
    ctx.fillStyle = n===0 ? "#2f9a62" : REDS.has(n) ? "#b8231a" : "#141917"; ctx.fill();
    ctx.strokeStyle="#d4b25c"; ctx.lineWidth=1.2; ctx.stroke();
    ctx.save(); ctx.translate(R,R); ctx.rotate(a0+seg/2+Math.PI/2); ctx.fillStyle="#f1ede2"; ctx.font="600 15px 'IBM Plex Mono', monospace"; ctx.textAlign="center"; ctx.fillText(String(n),0,-R+20); ctx.restore();
  });
  ctx.beginPath(); ctx.arc(R,R,R*0.58,0,2*Math.PI); ctx.fillStyle="#0a2a21"; ctx.fill(); ctx.strokeStyle="#d4b25c"; ctx.lineWidth=3; ctx.stroke();
  ctx.beginPath(); ctx.arc(R,R,R*0.16,0,2*Math.PI); ctx.fillStyle="#d4b25c"; ctx.fill();
}
function spinWheel(cv,from,to,dur){
  cancelAnimationFrame(spinWheel.f); cv.style.transition="none";
  if(!dur){ cv.style.transform=`rotate(${to}deg)`; return; }
  const t0=performance.now(), ease=x=>1-Math.pow(1-x,3.2);
  const step=t=>{ const x=Math.min(1,(t-t0)/dur); cv.style.transform=`rotate(${from+(to-from)*ease(x)}deg)`; if(x<1) spinWheel.f=requestAnimationFrame(step); };
  spinWheel.f=requestAnimationFrame(step);
  setTimeout(()=>{ if(cv.isConnected) cv.style.transform=`rotate(${to}deg)`; }, dur+80); // por si el cel pausa los cuadros
}
const rcls = n => n===0?"z":REDS.has(n)?"r":"k";
function renderRul(T,g){
  if(UI.shell!=="rul"){
    $("game").html=`<div class="rul-top"><div class="wheel"><canvas id="wheelCv" aria-label="Rueda de ruleta"></canvas></div><div style="min-width:0;display:flex;flex-direction:column;gap:8px"><div class="lbl">Último número</div><div class="rnum" id="rNum">–</div><div class="rhist" id="rHist"></div></div></div><div id="rBan"></div><div class="board" id="rBoard"></div><p class="note">Ruleta europea de un cero · pleno paga 35 a 1 · docenas y columnas 2 a 1 · colores, par/impar y mitades 1 a 1</p>`;
    UI.shell="rul"; drawWheel($("wheelCv")); UI.wheelRound=null; UI.wheelRot=0;
  }
  UI.pkKey="";
  const res=g.phase==="result";
  let ms=0;
  if(res){
    const key="rul:"+gk(g)+g.round;
    if(UI.hold[key]===undefined) UI.hold[key] = UI.first ? 0 : now()+3400;
    ms=Math.max(0,UI.hold[key]-now());
    if(UI.wheelRound!==key){
      UI.wheelRound=key;
      const i=WHEEL.indexOf(g.num), target=-i*360/37, cur=UI.wheelRot;
      const delta=(((target-cur)%360)+360)%360;
      UI.wheelRot = cur + (ms>0?1800:0) + delta;
      const cv=$("wheelCv");
      spinWheel(cv, cur, UI.wheelRot, ms>0 ? 3200 : 0);
    }
    if(ms>0){ clearTimeout(renderRul.t); renderRul.t=setTimeout(render, ms+30); }
  }
  const shown = res && ms===0;
  const hist = shown ? g.hist : (g.hist||[]).slice(res?1:0);
  $("rNum").html= shown ? `<span class="${g.num===0?"up":REDS.has(g.num)?"down":""}">${g.num}</span>` : res ? "…" : (hist[0]!==undefined?hist[0]:"–");
  $("rHist").html= hist.slice(0,14).map(n=>`<span class="rh ${rcls(n)}">${n}</span>`).join("");
  $("rBan").html= res ? (shown?`<div class="banner">${g.num}${g.num===0?" verde":REDS.has(g.num)?" rojo":" negro"}${myResult(T,g)}</div>${othersResult(T,g)}`:`<div class="banner">Girando…</div>`) : `<div class="banner">Hagan sus apuestas</div>`;
  const mine=g.phase==="bet"?UI.bets:((g.bets||{})[ST.uid]||{}), dis=g.phase!=="bet"||!me();
  const cell=(k,label,cls,style)=>{ const hit=shown&&rulMult(k,g.num)>0; return `<button class="cell ${cls}${hit?" hit":""}" data-bet="${k}" style="${style}"${dis?" disabled":""}><span class="lab">${label}</span>${mine[k]?`<span class="my">${window.L2?`<img class="l2mini" alt="" src="${L2.betChipURL(UI.chip)}">`:""}${fmtK(mine[k])}</span>`:""}<span class="oth">${othersDots(T,g,k)}</span></button>`; };
  let b=cell("n0","0","z","grid-column:3/6;grid-row:1");
  for(let r=0;r<12;r++) for(let c=1;c<=3;c++){ const n=r*3+c; b+=cell("n"+n,n,REDS.has(n)?"r":"k",`grid-column:${c+2};grid-row:${r+2}`); }
  [["d1","1ª 12"],["d2","2ª 12"],["d3","3ª 12"]].forEach(([k,l],i)=>b+=cell(k,l,"o vert",`grid-column:2;grid-row:${i*4+2}/span 4`));
  [["low","1-18","o"],["even","Par","o"],["red","Rojo","r"],["black","Negro","k"],["odd","Impar","o"],["high","19-36","o"]].forEach(([k,l,c],i)=>b+=cell(k,l,c+" o vert",`grid-column:1;grid-row:${i*2+2}/span 2`));
  ["c1","c2","c3"].forEach((k,i)=>b+=cell(k,"2:1","o",`grid-column:${i+3};grid-row:14`));
  $("rBoard").html=b;
  $("controls").html=betControls(T);
}

// ---------------- Blackjack ----------------
function bjTotTxt(cs){ const t=bjTot(cs); return t.soft&&t.t<21?`${t.t-10}/${t.t}`:String(t.t); }
function renderBj(T,g){
  UI.shell="bj"; UI.pkKey="";
  const res=g.phase==="result";
  const dealerCards=g.dealer.map((c,i)=>i===1&&!g.reveal?"??":c);
  const dc=g.dealer.length?cardsHTML("bjD"+gk(g)+g.round,dealerCards):'<div class="slot"></div><div class="slot"></div>';
  let hands="";
  const ids=T.order.filter(id=>g.hands&&g.hands[id]);
  ids.forEach(id=>{
    const p=T.players[id], hs=g.hands[id];
    hands+=`<div class="bj-p${g.turn&&g.turn.id===id?" turn":""}"><div class="who"><i style="background:${SEATC[p.seat||0]}"></i><span>${esc(p.name)}${id===ST.uid?" (tú)":""}</span></div>`;
    hs.forEach((h,i)=>{
      const act=g.turn&&g.turn.id===id&&g.turn.h===i;
      hands+=`<div class="bj-h${act?" act":""}"><div class="cards">${cardsHTML(`bjH${gk(g)}${g.round}:${id}:${i}`,h.c,{sm:true})}</div><div class="meta">${h.bj?"Blackjack":bjTotTxt(h.c)}${h.bust?" · se pasó":""}${h.sur?" · se rindió":""} · ${fmt(h.bet)}${h.dbl?" (doble)":""}</div></div>`;
    });
    hands+=`</div>`;
  });
  const msR = res ? revealIn("bj:"+gk(g)+g.round) : 0;
  if(res){
    // resultados por mano, cuando terminan de salir las cartas
    hands=""; ids.forEach(id=>{
      const p=T.players[id], hs=g.hands[id];
      hands+=`<div class="bj-p"><div class="who"><i style="background:${SEATC[p.seat||0]}"></i><span>${esc(p.name)}${id===ST.uid?" (tú)":""}</span></div>`;
      hs.forEach((h,i)=>{ const r=h.r; const pill = h.sur?`<span class="pill l">Te rendiste: recuperas ${fmt(h.bet/2)}</span>`:r>0?`<span class="pill w">${h.bj&&!g.dbj?"Blackjack ":"Gana "}${sgn(r)}</span>`:r<0?`<span class="pill l">Pierde ${fmt(-r)}</span>`:`<span class="pill p">Empate</span>`;
        hands+=`<div class="bj-h"><div class="cards">${cardsHTML(`bjH${gk(g)}${g.round}:${id}:${i}`,h.c,{sm:true})}</div><div class="meta">${h.bj?"Blackjack":bjTotTxt(h.c)} · ${fmt(h.bet)}</div><div class="${late(msR)}">${pill}</div></div>`; });
      hands+=`</div>`;
    });
  }
  const dTot = g.dealer.length ? (g.reveal ? bjTotTxt(g.dealer) : bjTotTxt([g.dealer[0]])) : "–";
  const betSum = g.phase==="bet" ? Object.keys(g.bets||{}).filter(id=>id!==ST.uid).map(id=>`<span><i class="dot" style="background:${SEATC[(T.players[id]||{}).seat||0]}"></i> ${esc(pname(T,id))} ${fmt(sumObj(g.bets[id]))}</span>`).join(" · ") : "";
  $("game").html= `
    <div class="bj-dealer"><div class="lbl">Crupier</div><div class="cards">${dc}</div><div class="tot${late(res?msR:0)}">${dTot}</div></div>
    ${res?`<div class="banner${late(msR)}">${g.dbj?"El crupier tiene blackjack":bjTot(g.dealer).t>21?"El crupier se pasó":"Crupier con "+bjTot(g.dealer).t}${myResult(T,g)}</div>`:g.phase==="bet"?`<div class="banner">Hagan sus apuestas</div>`:""}
    ${g.phase==="bet" ? `<button class="betcircle" data-bet="m"${!me()?" disabled":""}><span>Tu apuesta</span><b>${UI.bets.m&&window.L2?`<img class="l2mini" alt="" src="${L2.betChipURL(UI.chip)}">`:""}${UI.bets.m?fmt(UI.bets.m):"$0"}</b></button>${betSum?`<div class="waiting">${betSum}</div>`:""}` : `<div class="bj-hands">${hands}</div>`}
    <p class="note">6 mazos · quedan ${shoeLen(g)} cartas · blackjack paga 3 a 2 · el crupier se planta en 17 · doblas con 2 cartas · divides hasta 4 manos, también Ases, y en cada una puedes pedir · rendirte te devuelve la mitad</p>`;
  // controles
  if(g.phase==="play"){
    const p=me(), myTurn=g.turn&&g.turn.id===ST.uid;
    if(myTurn && p){
      const hs=g.hands[ST.uid], h=hs[g.turn.h], free=r2(p.chips-hs.reduce((a,x)=>a+x.bet,0));
      const canR=h.c.length===2&&hs.length===1, canD=!h.sa&&h.c.length===2&&free>=h.bet, canS=h.c.length===2&&hs.length<4&&bjVal(h.c[0])===bjVal(h.c[1])&&free>=h.bet, canH=!h.sa;
      const pend=!!UI.move;
      // con más jugadores en la mesa, tu mano sale grande en tu turno
      const big = ids.length>1 ? `<div class="mycards"><div class="cards">${cardsHTML(`bjH${gk(g)}${g.round}:${ST.uid}:${g.turn.h}`,h.c,{})}</div><div class="myhand lg">${esc(bjTotTxt(h.c))}${g.dealer[0]?` vs ${esc(cardTxt(g.dealer[0]))}`:""}</div></div>` : "";
      $("controls").html=`${big}<div class="wallet"><span>Tu mano <b>${bjTotTxt(h.c)}</b>${hs.length>1?` (mano ${g.turn.h+1} de ${hs.length})`:""}</span><span>Libres <b>${fmt(free)}</b></span></div>
        <div class="acts bj5"><button class="btn go" data-move="hit"${!canH||pend?" disabled":""}>Pedir</button><button class="btn" data-move="stand"${pend?" disabled":""}>Plantarme</button><button class="btn" data-move="double"${!canD||pend?" disabled":""}>Doblar</button><button class="btn" data-move="split"${!canS||pend?" disabled":""}>Dividir</button><button class="btn warn" data-move="surrender"${!canR||pend?" disabled":""}>Rendirse</button></div>`;
    } else $("controls").html=`<div class="waiting">${g.turn?`Turno de ${esc(pname(T,g.turn.id))}`:"Juega el crupier"}</div>`;
  } else $("controls").html=betControls(T);
}

// ---------------- Póker ----------------
function myHandTxt(g){
  const s=g.ps&&g.ps[ST.uid]; if(!s||!s.hole||!s.hole.length) return "";
  const ev=eval7(s.hole.concat(g.board||[])); let n=handName(ev);
  if((g.board||[]).length>=5 && cmpEv(ev,eval7(g.board))===0) n+=" (está en la mesa)";
  return n;
}
const PKPH={wait:"Esperando",pre:"Preflop",flop:"Flop",turn:"Turn",river:"River",show:"Resultado"};
function renderPk(T,g){
  UI.shell="pk";
  const ids=PK.ids(T), pot=g.ps?PK.pot(g):0;
  const board=cardsHTML("pkB"+gk(g)+g.hand,g.board,{slots:5});
  const show=g.phase==="show", ms= show ? revealIn("pk:"+gk(g)+g.hand) : 0;
  const winners=new Set(show&&g.pots?g.pots.flatMap(p=>p.win):[]);
  let ps="";
  const list = g.phase==="wait" ? seated(T) : ids;
  list.forEach(id=>{
    const p=T.players[id], s=(g.ps||{})[id];
    const tags=[]; if(g.btn===id && g.phase!=="wait") tags.push('<span class="btnD">D</span>');
    let cards="";
    if(s){ const open = id===ST.uid || (show && g.show && !s.fold); cards=cardsHTML(`pkH${gk(g)}${g.hand}:${id}`, open?s.hole:["??","??"], {sm:true, dim:s.fold}); }
    const stat = !s ? (g.phase==="wait"?"Listo para jugar":"Entra en la siguiente mano") : show && g.ev && g.ev[id] && g.show ? g.ev[id] : (g.last&&g.last[id]) || (s.fold?"Se retiró":s.allin?"All-in":"");
    ps+=`<div class="pk-p${g.toAct===id?" turn":""}${s&&s.fold?" fold":""}${winners.has(id)&&ms===0?" win":""}">
      <div class="hd"><b><i style="background:${SEATC[p.seat||0]}"></i><span>${esc(p.name)}${id===ST.uid?" (tú)":""}</span></b>${tags.join("")}</div>
      <div class="cards">${cards}</div>
      <div class="st"><span>${fmt(shownChips(T,id))}</span><span>${s&&s.bet?"apuesta "+fmt(s.bet):""}</span></div>
      ${id===ST.uid&&s&&!s.fold&&!show&&g.phase!=="wait"?`<div class="myhand">${esc(myHandTxt(g))}</div>`:""}
      <div class="st"><span class="${late(ms)}">${esc(stat)}</span></div></div>`;
  });
  const ban = show && g.pots ? `<div class="banner${late(ms)}">${g.pots.map(pt=>`${pt.win.map(x=>esc(pname(T,x))).join(" y ")} ${pt.win.length>1?"se reparten":"gana"} ${fmt(pt.amt)}<small>${esc(pt.desc)}</small>`).join("")}</div>`
    : g.phase==="wait" ? `<div class="banner">Póker Texas Hold'em</div>` : `<div class="banner">${PKPH[g.phase]}</div>`;
  $("game").html=`${ban}
    <div class="pk-board"><div class="cards">${board}</div><div class="pot">${pot?"Bote "+fmt(pot):""}</div></div>
    <div class="pk-ps">${ps}</div>
    <p class="note">Sin límite · ciegas ${fmt(g.sb)} / ${fmt(g.bb)} · las cartas de los demás se ven solo al final</p>`;
  // controles
  const p=me(), s=(g.ps||{})[ST.uid];
  const key=`${g.hand}:${g.k}:${g.phase}:${g.toAct===ST.uid}:${!!UI.move}:${p?p.chips:0}:${seated(T).length}`;
  if(key===UI.pkKey && $("controls").firstChild) return;
  UI.pkKey=key;
  if(!p){ $("controls").html=spectate(T); return; }
  if(g.phase==="wait"){
    const n=seated(T).filter(id=>T.players[id].chips>0).length;
    $("controls").html= (p.chips<10?`<button class="btn go" data-act="rebuy">Recomprar ${fmt(T.buyIn)}</button>`:"")+
      (n>=2?`<button class="btn go" data-act="pkstart">Repartir mano</button>`:`<div class="help">Se necesitan <b>2 jugadores</b>. Agrega bots con <b>+ Bot</b> o invita a tus amigos con el código ${esc(T.code)}.</div>`);
    return;
  }
  if(show){ $("controls").html= (p.chips<10?`<button class="btn go" data-act="rebuy">Recomprar ${fmt(T.buyIn)}</button>`:"")+`<div class="waiting">Siguiente mano en unos segundos</div>`; return; }
  if(g.toAct===ST.uid && s){
    const toCall=r2(g.cur-s.bet), maxTo=r2(s.bet+p.chips), minTo=Math.min(maxTo, r2(g.cur+g.minR));
    const pend=!!UI.move;
    const potNow=pot;
    const big = seated(T).length>1 && s && s.hole ? `<div class="mycards"><div class="cards">${cardsHTML(`pkH${gk(g)}${g.hand}:${ST.uid}`, s.hole, {})}</div><div class="myhand lg">${esc(myHandTxt(g))}</div></div>` : `<div class="myhand lg">${esc(myHandTxt(g))}</div>`;
    $("controls").html=`${big}<div class="wallet"><span>Te toca · ${toCall>0?"para igualar "+fmt(Math.min(toCall,p.chips)):"puedes pasar"}</span><span>Fichas <b>${fmt(p.chips)}</b></span></div>
      <div class="acts"><button class="btn warn" data-move="fold"${pend?" disabled":""}>Retirarme</button><button class="btn" data-move="${toCall>0?"call":"check"}"${pend?" disabled":""}>${toCall>0?(toCall>=p.chips?"All-in "+fmt(p.chips):"Igualar "+fmt(toCall)):"Pasar"}</button></div>
      ${maxTo>g.cur?`<div class="rq"><button data-to="${minTo}">Mínimo</button><button data-to="${Math.min(maxTo,Math.round(g.cur+Math.max(g.minR,potNow/2)))}">½ bote</button><button data-to="${Math.min(maxTo,Math.round(g.cur+Math.max(g.minR,potNow)))}">Bote</button><button data-to="${maxTo}">All-in</button></div>
      <div class="raise"><input id="raiseIn" type="number" inputmode="numeric" min="${minTo}" max="${maxTo}" step="1" value="${minTo}" aria-label="Subir a"><button class="btn go" data-act="raise"${pend?" disabled":""}>${g.cur>0?"Subir":"Apostar"}</button></div>`:""}`;
  } else {
    $("controls").html=`<div class="wallet"><span>${s&&!s.fold?"Tus fichas <b>"+fmt(p.chips)+"</b>":"Estás fuera de esta mano"}</span><span>${g.toAct?"Turno de "+esc(pname(T,g.toAct)):""}</span></div>`;
  }
}

// ---------------- Eventos ----------------
$("game").addEventListener("click",e=>{ const b=e.target.closest("[data-bet]"); if(b&&!b.disabled) placeBet(b.dataset.bet); });
$("controls").addEventListener("click",e=>{
  const c=e.target.closest("[data-chip]"); if(c){ UI.chip=+c.dataset.chip; lsSet("mc-chip",UI.chip); render(); return; }
  const m=e.target.closest("[data-move]"); if(m&&!m.disabled){ doMove(m.dataset.move); return; }
  const t=e.target.closest("[data-to]"); if(t){ const i=$("raiseIn"); if(i) i.value=t.dataset.to; return; }
  const a=e.target.closest("[data-act]"); if(!a||a.disabled) return;
  const act=a.dataset.act;
  if(act==="undo") undoBet(); else if(act==="clear") clearBets(); else if(act==="repeat") repeatBets(); else if(act==="ready") setReady();
  else if(act==="rebuy") rebuy();
  else if(act==="pkstart") mesaDo(T=>PK.idle(T) && PK.start(T,presentSet()));
  else if(act==="raise"){ const g=ST.T.g, s=g.ps[ST.uid], p=me(); const maxTo=r2(s.bet+p.chips); let to=Math.floor(+$("raiseIn").value||0); const minTo=Math.min(maxTo,r2(g.cur+g.minR));
    if(to>=maxTo) return doMove("allin"); if(to<minTo){ toast(`La subida mínima es a ${fmt(minTo)}`); return; } doMove("raise",{to}); }
});
function onBarClick(e){
  const a=e.target.closest("[data-act]"); if(!a) return;
  const act=a.dataset.act;
  if(act==="force") mesaDo(T=>{ if(T.g.phase==="bet"&&Object.keys(T.g.bets).length){ GAMES[T.game].deal(T); return true; } return false; });
  else if(act==="skip"){ const k=ST.T.g.k; mesaDo(T=>T.g.k===k && (T.game==="bj"?BJ.skip(T):PK.skip(T))); }
  else if(act==="addbot"){ const want=seated(ST.T).filter(id=>ST.T.players[id].bot).length+1; mesaDo(T=>seated(T).filter(id=>T.players[id].bot).length<want && addBot(T)); }
  else if(act==="rmbot"){ const want=seated(ST.T).filter(id=>ST.T.players[id].bot).length-1; mesaDo(T=>seated(T).filter(id=>T.players[id].bot).length>want && removeBot(T)); }
  else if(act==="leave"){ if(inHand(ST.T,ST.uid)){ toast("Termina la mano antes de dejar tu lugar"); return; } sendAct("leave",{}); closeMesa(); toast("Dejaste tu lugar; tus fichas se guardan si regresas"); }
  else if(act==="who"){ UI.choose=true; render(); window.scrollTo(0,0); }
  else if(act==="del"){ if(a.dataset.sure){ a.disabled=true; deleteMesa(ST.code); } else { a.dataset.sure="1"; a.textContent="¿Eliminar para todos? Toca otra vez"; } }
}
$("hostbar").addEventListener("click",onBarClick);
$("log").addEventListener("click",onBarClick);
$("tabs").addEventListener("click",e=>{ const b=e.target.closest("[data-g]"); if(!b||!ST.T) return;
  if(!me()){ toast("Siéntate en la mesa para elegir el juego"); return; }
  if(!canSwitch(ST.T)){ toast("Termina la ronda antes de cambiar de juego"); return; }
  const g=b.dataset.g; mesaDo(T=>{ const ok=switchGame(T,g); if(ok) T.log[T.log.length-1].m+=` (lo eligió ${pname(T,ST.uid)})`; return ok; }); });
$("toLobby").onclick=()=>closeMesa();
$("whoBox").addEventListener("click",e=>{ const b=e.target.closest("[data-who]"); if(b&&!b.disabled) claimSeat(b.dataset.who); });
$("mCode").onclick=e=>{ const code=ST.T&&ST.T.code; if(!code) return; try{ navigator.clipboard.writeText(code).then(()=>toast("Código copiado: "+code),()=>toast("Código: "+code)); }catch(err){ toast("Código: "+code); } };
$("create").onclick=createMesa;
$("boardSort").addEventListener("click",e=>{ const b=e.target.closest("[data-sort]"); if(!b) return; UI.boardSort=b.dataset.sort; lsSet("mc-sort",UI.boardSort);
  document.querySelectorAll("#boardSort button").forEach(x=>x.classList.toggle("on",x===b)); loadBoard(); });
$("mlist").addEventListener("click",e=>{
  const d=e.target.closest("[data-del]");
  if(d){ if(d.dataset.sure){ d.disabled=true; deleteMesa(d.dataset.del); } else { d.dataset.sure="1"; d.textContent="¿Seguro?"; } return; }
  const b=e.target.closest("[data-open]"); if(b) openMesa(b.dataset.open); });
$("resGo").onclick=()=>openMesa($("resGo").dataset.open);
$("codeGo").onclick=()=>{ const c=$("codeIn").value.trim().toUpperCase(); if(c.length<4){ toast("El código tiene 4 letras"); return; } openMesa(c); };
$("codeIn").addEventListener("keydown",e=>{ if(e.key==="Enter") $("codeGo").click(); });
$("alias").addEventListener("input",saveAlias); $("alias").addEventListener("change",saveAlias); $("alias").addEventListener("blur",saveAlias);
$("buyQuick").addEventListener("click",e=>{ const b=e.target.closest("[data-b]"); if(!b) return; UI.buyIn=+b.dataset.b; document.querySelectorAll("#buyQuick button").forEach(x=>x.classList.toggle("on",x===b)); });
$("gpick").addEventListener("click",e=>{ const b=e.target.closest("[data-g]"); if(!b) return; UI.createGame=b.dataset.g; document.querySelectorAll("#gpick button").forEach(x=>x.classList.toggle("on",x===b)); });
document.addEventListener("visibilitychange",()=>{
  if(ST.rm) ST.rm.presence({away:document.visibilityState==="hidden"}).catch(()=>{});
  if(document.visibilityState!=="visible") return;
  if(ST.ref){ (async()=>{ try{ const s=await ST.ref.get(); if(s.exists) onRemote(s.data()); }catch(e){} })(); }
});

// ---------------- Diagnóstico ----------------
const DIAG={errs:[],recs:[]}; let diagT=null;
function diag(kind,o){
  (kind==="err"?DIAG.errs:DIAG.recs).push(Object.assign({t:now()},o));
  DIAG.errs=DIAG.errs.slice(-6); DIAG.recs=DIAG.recs.slice(-12);
  if(!ST.db||!ST.code||!ST.canMulti||ST.readOnly) return;
  clearTimeout(diagT); const code=ST.code, uid=ST.uid;
  diagT=setTimeout(()=>{ try{ ST.db.doc(`mesas/${code}/diag/${uid}`).set({v:2,at:now(),rm:matchMedia("(prefers-reduced-motion: reduce)").matches,ios:/iPhone|iPad/.test(navigator.userAgent),errs:DIAG.errs,recs:DIAG.recs}).catch(()=>{}); }catch(e){} },5000);
}
window.addEventListener("error",e=>diag("err",{m:String(e.message||"").slice(0,160)}));
window.addEventListener("unhandledrejection",e=>diag("err",{m:"promesa: "+String((e.reason&&(e.reason.code||e.reason.message))||e.reason||"").slice(0,140)}));

// ---------------- Toques en el cel ----------------
const TAPSEL="button,[data-bet],[data-chip],[data-move],[data-act],[data-open],[data-who],[data-to],[data-g],[data-b],[data-del],[data-x],[data-s],[data-w],[data-f],[data-t]";
const TAPATTR=["bet","chip","move","act","open","who","to","g","b","del","x","s","w","f","t"];
const tapKey=el=>{ for(const a of TAPATTR) if(el.dataset && el.dataset[a]!==undefined) return `[data-${a}="${CSS.escape(el.dataset[a])}"]`; return el.id?"#"+CSS.escape(el.id):null; };
let tap=null, synth=null;
document.addEventListener("pointerdown",e=>{
  const el=e.target.closest&&e.target.closest(TAPSEL);
  tap = el && !el.disabled ? {el,key:tapKey(el),scope:(el.parentElement&&el.parentElement.closest("[id]")||document.body).id,x:e.clientX,y:e.clientY,t:Date.now()} : null;
  unlockAudio();
},{capture:true,passive:true});
document.addEventListener("pointerup",e=>{
  const s=tap; tap=null;
  if(!s || !s.key || s.el.isConnected) return;               // si el botón sigue ahí, el toque normal funciona
  if(Math.hypot(e.clientX-s.x,e.clientY-s.y)>14 || Date.now()-s.t>900) return;
  const root=(s.scope&&$(s.scope))||document, twin=root.querySelector(s.key);
  if(twin && !twin.disabled){ synth={key:s.key,t:Date.now()}; twin.click(); }
},{capture:true,passive:true});
document.addEventListener("click",e=>{
  if(!synth || !e.isTrusted) return;
  const el=e.target.closest&&e.target.closest(TAPSEL);
  if(el && tapKey(el)===synth.key && Date.now()-synth.t<700){ e.stopPropagation(); e.preventDefault(); }
  synth=null;
},true);

// ---------------- Arranque ----------------
$("alias").value = lsGet("mc-alias") || ckGet("mc-alias") || "";
addEventListener("pagehide",()=>{ const a=getAlias(); if(a){ lsSet("mc-alias",a); ckSet("mc-alias",a); } });
document.querySelectorAll("#boardSort button").forEach(x=>x.classList.toggle("on",x.dataset.sort===UI.boardSort));
$("bellOn").checked = lsGet("mc-bell")!=="off";
$("bellOn").addEventListener("change",()=>{ lsSet("mc-bell",$("bellOn").checked?"on":"off"); if($("bellOn").checked){ unlockAudio(); bell(); } });
UI.chip = +lsGet("mc-chip") || 100;
initCaps();

// ---------------- Reacciones (2 o más jugadores) ----------------
// Cada quien escribe su última reacción en mesas/<código>/react/<jugador>; los demás la ven como globito sobre su lugar.
// Stickers dibujados (SVG) para no depender de los emojis del cel
const RSVG={
  jaja:`<img class="rimg" src="r-jaja.png" alt="">`,
  bluff:`<svg viewBox="0 0 48 48"><rect x="7" y="9" width="21" height="30" rx="3" transform="rotate(-14 17 24)" fill="#f1ede2" stroke="#1d2b4a" stroke-width="2"/><rect x="20" y="9" width="21" height="30" rx="3" transform="rotate(10 30 24)" fill="#2c4a8a" stroke="#1d2b4a" stroke-width="2"/><path d="M24 15l3 3-3 3-3-3zM33 25l3 3-3 3-3-3zM27 33l3 3-3 3-3-3z" fill="#f2c14e" transform="rotate(10 30 24)"/><path d="M8 28h32" stroke="#111" stroke-width="5" stroke-linecap="round"/><rect x="9" y="25" width="12" height="7" rx="3" fill="#111"/><rect x="27" y="25" width="12" height="7" rx="3" fill="#111"/><path d="M12 27l3-1" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  ctm:`<img class="rimg" src="r-ctm.png" alt="">`,
  dealer:`<img class="rimg" src="r-dealer.png" alt="">`,
  faah:`<img class="rimg" src="r-faah.png" alt="">`,
  ride:`<img class="rimg" src="r-ride.png" alt="">`
};
const REACTS=[
  {s:"jaja",    t:"JAJAJA",     c:"#f2c14e", k:"burla"},
  {s:"bluff",   t:"BLUFF",      c:"#4f7fd6", k:"bluff"},
  {s:"ctm",     t:"CTM",        c:"#e24a35", k:"ctm", shake:true},
  {s:"dealer",  t:"DEALER HDP!",c:"#8a63d2", k:"dealer", shake:true},
  {s:"faah",    t:"FAAAAH",     c:"#7fb0c6", k:"faah"},
  {s:"ride",    t:"LET IT RIDE!",tb:"LET IT<br>RIDE!",c:"#ff5a2a", k:"casino"}
];
const RX={unsub:null, seen:{}, init:false, last:0, code:null};
function reactRef(code){ return ST.db ? ST.db.collection("mesas/"+code+"/react") : null; }
function renderReacts(T){
  const box=$("reacts"); if(!box) return;
  const humans=seated(T).filter(id=>!T.players[id].bot).length;
  const show = !!ST.db && humans>=2 && !!me();
  box.hidden=!show; if(!show) return;
  const wait = now()-RX.last < 2500;
  box.html=REACTS.map((r,i)=>`<button data-react="${i}" aria-label="${esc(r.t)}" style="--rc:${r.c}"${wait?" disabled":""}><span class="ri">${RSVG[r.s]}</span><small>${r.tb||esc(r.t).replace(/[’]? /,m=>m.trim()+"<br>")}</small></button>`).join("");
  if(wait){ clearTimeout(renderReacts.t); renderReacts.t=setTimeout(()=>ST.T&&renderReacts(ST.T), 2500-(now()-RX.last)+30); }
}
// Sonidos de los stickers (sintetizados, sin archivos)
function reactSfx(ac, k, dest){
  const t=ac.currentTime+0.02, out=dest||ac.destination;
  const env=(g,at,peak,dur,att)=>{ g.gain.setValueAtTime(0.0001,ac.currentTime); g.gain.setValueAtTime(0.0001,at); g.gain.exponentialRampToValueAtTime(peak,at+(att||0.01)); g.gain.exponentialRampToValueAtTime(0.0001,at+dur); };
  const tone=(type,f1,f2,off,dur,vol)=>{ const o=ac.createOscillator(), g=ac.createGain(); o.type=type;
    o.frequency.setValueAtTime(f1,t+off); if(f2) o.frequency.exponentialRampToValueAtTime(f2,t+off+dur);
    g.gain.setValueAtTime(0.0001,t+off); g.gain.exponentialRampToValueAtTime(vol,t+off+0.02); g.gain.setValueAtTime(vol,t+off+dur*0.6); g.gain.exponentialRampToValueAtTime(0.0001,t+off+dur);
    o.connect(g); g.connect(out); o.start(t+off); o.stop(t+off+dur+0.05); };
  const noise=(off,dur,vol,type,freq,q)=>{ const n=Math.ceil(ac.sampleRate*dur), buf=ac.createBuffer(1,n,ac.sampleRate), d=buf.getChannelData(0); for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
    const src=ac.createBufferSource(); src.buffer=buf; const f=ac.createBiquadFilter(); f.type=type; f.frequency.value=freq; f.Q.value=q||1; const g=ac.createGain(); env(g,t+off,vol,dur,0.002);
    src.connect(f); f.connect(g); g.connect(out); src.start(t+off); src.stop(t+off+dur+0.02); };
  // sílaba "ja": pulso de voz por dos formantes de la vocal "a", con su "j" de aire al inicio
  const ja=(off,f0,dur,vol)=>{ const o=ac.createOscillator(); o.type="sawtooth"; o.frequency.setValueAtTime(f0*1.08,t+off); o.frequency.exponentialRampToValueAtTime(f0*0.9,t+off+dur);
    const g=ac.createGain(); env(g,t+off,vol,dur+0.02,0.025);
    [[800,7,1],[1250,9,0.7],[2600,10,0.25]].forEach(([fq,q,a])=>{ const f=ac.createBiquadFilter(); f.type="bandpass"; f.frequency.value=fq; f.Q.value=q; const ga=ac.createGain(); ga.gain.value=a; o.connect(f); f.connect(ga); ga.connect(g); });
    g.connect(out); o.start(t+off); o.stop(t+off+dur+0.06); noise(off,0.05,vol*0.25,"bandpass",1800,1.5); };
  if(k==="burla"){                                         // "¡ja-ja-ja-ja-jaaa!" de burla, va subiendo de tono
    [[0,330,.11],[.15,350,.11],[.30,372,.11],[.45,395,.11],[.60,430,.30]].forEach(([o,f,d])=>ja(o,f,d,0.42));
  } else if(k==="bluff"){ tone("sine",392,0,0,.16,.12); tone("sine",587,0,.18,.3,.12); }
  else if(k==="ctm"){                                       // pitido de censura de tele: "¡biiiip!"
    tone("sine",1000,0,0,.62,.14); noise(0,0.04,0.05,"highpass",3000);
  } else if(k==="dealer"){                                  // manotazo en la mesa + doble censura
    // golpe seco: ataque instantáneo, cuerpo grave y el "crack" de la madera
    const slam=(type,f1,f2,dur,vol)=>{ const o=ac.createOscillator(), g=ac.createGain(); o.type=type; o.frequency.setValueAtTime(f1,t); o.frequency.exponentialRampToValueAtTime(f2,t+dur);
      g.gain.setValueAtTime(0.0001,ac.currentTime); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur); o.connect(g); g.connect(out); o.start(t); o.stop(t+dur+0.02); };
    slam("sine",150,38,.26,.36); slam("triangle",260,70,.09,.17);
    noise(0,0.16,0.6,"lowpass",320,0.9); noise(0,0.035,0.26,"highpass",2500,0.7);
    tone("sine",1000,0,.26,.13,.13); tone("sine",1000,0,.44,.30,.13);
  } else if(k==="faah"){ tone("sawtooth",300,95,0,1.1,.07); tone("triangle",600,190,0,1.1,.05); }   // "faaaah" que se cae
}
function reactSound(r){
  if(lsGet("mc-bell")==="off"||!actx) return;
  if(r.k==="casino"){ coins(5000); return; }
  try{ reactSfx(actx, r.k); }catch(e){}
}
function showReact(pid, i, name){
  const r=REACTS[i]; if(!r) return;
  const seat=document.querySelector(`#seats .seat[data-pid="${CSS.escape(pid)}"]`);
  let x=innerWidth/2, y=innerHeight/3;
  if(seat){ const b=seat.getBoundingClientRect(); x=b.left+b.width/2; y=Math.max(8,b.top-30); }
  const d=document.createElement("div"); d.className="rbub"+(r.shake?" shake":"");
  d.style.left=x+"px"; d.style.top=y+"px";
  d.style.setProperty("--rc",r.c); d.innerHTML=`<span class="e">${RSVG[r.s]}</span><span class="t">${esc(r.t)}</span>`;
  if(!seat && name) d.querySelector(".t").textContent=name+": "+r.t;
  document.body.appendChild(d); setTimeout(()=>d.remove(),3100);
  reactSound(r);
}
function sendReact(i){
  const T=ST.T; if(!T || !me() || now()-RX.last<2500) return;
  RX.last=now(); renderReacts(T);
  showReact(ST.uid, i);                                    // lo ves al instante en tu lugar
  const ref=reactRef(T.code); if(!ref) return;
  ref.doc(ST.uid).set({i, at:Date.now(), name:getAlias()}).catch(()=>{});
}
function watchReacts(code){
  stopReacts(); const ref=reactRef(code); if(!ref) return;
  RX.code=code; RX.init=false; RX.seen={};
  try{
    RX.unsub=ref.onSnapshot(qs=>{
      if(RX.code!==code) return;
      qs.docs.forEach(d=>{ const v=d.data()||{}, at=+v.at||0, pid=d.id;
        if(!RX.init){ RX.seen[pid]=at; return; }                              // lo que ya estaba al entrar no se muestra
        if(at<=(RX.seen[pid]||0)) return; RX.seen[pid]=at;
        if(pid===ST.uid) return;
        showReact(pid, v.i, v.name);
      });
      RX.init=true;
    }, ()=>{});
  }catch(e){}
}
function stopReacts(){ try{ RX.unsub&&RX.unsub(); }catch(e){} RX.unsub=null; RX.code=null; }
document.addEventListener("click",e=>{ const b=e.target.closest&&e.target.closest("[data-react]"); if(b && !b.disabled) sendReact(+b.dataset.react); });

// Si en la mesa hay otro lugar con tu mismo apodo y ese cel no está conectado, se junta con el tuyo
const MERGED={};
function mergeDups(T){
  const p=T&&T.players[ST.uid]; if(!p||p.out||p.bot) return;
  const pres=presentSet(); if(!pres) return;
  Object.keys(T.players).forEach(id=>{
    const q=T.players[id]; if(id===ST.uid||!q||q.bot||normName(q.name)!==normName(p.name)||pres.has(id)) return;
    const key=T.code+":"+id; if(now()-(MERGED[key]||0)<20000) return; MERGED[key]=now();   // reintenta si estaba en plena mano
    sendAct("merge",{from:id});
  });
}

// El panel de abajo (fijo) deja un espacio de su mismo alto para que nunca tape la mesa
(function(){
  const dock=document.getElementById("dock"), sp=document.getElementById("dockSpace"); if(!dock||!sp) return;
  const fit=()=>{ const h=dock.offsetHeight; if(sp.style.height!==h+"px") sp.style.height=h+"px"; };
  if(window.ResizeObserver) new ResizeObserver(fit).observe(dock);
  addEventListener("resize",fit); setInterval(fit,1000); fit();
})();
// ================= Solitario (Klondike) con niveles =================
const SOLV = [ // dificultad por nivel: robar, vueltas al mazo (0 = sin límite), deshacer, Ases ya puestos
  {name:"Aprendiz", draw:1, passes:0, undo:99, aces:true},
  {name:"Novato",   draw:1, passes:0, undo:99},
  {name:"Jugador",  draw:1, passes:3, undo:10},
  {name:"Hábil",    draw:3, passes:0, undo:10},
  {name:"Experto",  draw:3, passes:3, undo:5},
  {name:"Tahúr",    draw:3, passes:2, undo:3},
  {name:"Maestro",  draw:3, passes:1, undo:1},
  {name:"Leyenda",  draw:3, passes:1, undo:0},
];
const solCfg = lvl => SOLV[Math.min(lvl,SOLV.length)-1];
const SUITORD = "SHDC";
const sRank = c => "A23456789TJQK".indexOf(c[0])+1;
const sRed = c => c[1]==="H"||c[1]==="D";
let SOL=null, SOLP={level:1,wins:0,best:{}}, solUndo=[], solTimer=null, solFx={};

function solKey(){ const a=normName(getAlias()||"jugador").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9]/g,"")||"jugador"; return a.slice(0,40); }
function solRef(){ return ST.db && ST.acct && !ST.readOnly ? ST.db.doc(`data/users/${ST.acct}/sol_${solKey()}`) : null; }
async function solLoad(){
  let d=null;
  try{ d=JSON.parse(lsGet("mc-sol:"+solKey())||"null"); }catch(e){}
  const ref=solRef();
  if(ref){ try{ const s=await ref.get(); if(s.exists){ const r=clone(s.data()); if(!d || (r.at||0)>=(d.at||0)) d=r; } }catch(e){} }
  if(d && d.p) SOLP=Object.assign({level:1,wins:0,best:{}},d.p);
  SOL = d && d.g && !d.g.won ? d.g : null;
}
let solSaveT=null;
function solSave(now_){
  if(SOL && !SOL.won && SOL.t0) SOL.tUsed=now()-SOL.t0;
  const body={at:now(),p:SOLP,g:SOL};
  try{ lsSet("mc-sol:"+solKey(),JSON.stringify(body)); }catch(e){}
  clearTimeout(solSaveT);
  const go=()=>{ const ref=solRef(); if(ref) ref.set(clone(body)).catch(()=>{}); };
  if(now_) go(); else solSaveT=setTimeout(go,1200);
}
function solDeal(){
  const cfg=solCfg(SOLP.level);
  let deck=newShoe(1).match(/../g);
  const found=[[],[],[],[]];
  if(cfg.aces){ deck=deck.filter(c=>{ if(c[0]==="A"){ found[SUITORD.indexOf(c[1])].push(c); return false; } return true; }); }
  const tab=[]; for(let c=0;c<7;c++){ tab.push([]); for(let i=0;i<=c;i++) tab[c].push({c:deck.pop(),up:i===c}); }
  SOL={lvl:SOLP.level, stock:deck, waste:[], found, tab, pass:1, moves:0, t0:now(), tUsed:0, undos:0, won:false};
  solUndo=[]; solFx={}; solSave(true);
}
const solSnap=()=>JSON.stringify(Object.assign({},SOL,{t0:undefined}));
function solPush(){ solUndo.push(solSnap()); if(solUndo.length>60) solUndo.shift(); }
function solCanTab(card,col){ const top=col[col.length-1]; if(!top) return true; /* hueco libre: entra cualquier carta */ return top.up && sRed(top.c)!==sRed(card) && sRank(top.c)===sRank(card)+1; }
function solCanFound(card){ const f=SOL.found[SUITORD.indexOf(card[1])]; return f.length===sRank(card)-1; }
function solFlipTops(){ SOL.tab.forEach((col,i)=>{ const t=col[col.length-1]; if(t&&!t.up){ t.up=true; solFx["t"+i+":"+(col.length-1)]="flip"; } }); }
function solAfter(){ SOL.moves++; solFlipTops();
  if(SOL.found.every(f=>f.length===13)) solWin();
  solSave(); solRender(); }
// Mover una carta (o una escalera) al mejor lugar posible
function solAuto(src){
  const cfg=solCfg(SOL.lvl);
  let cards, take;
  if(src.from==="w"){ if(!SOL.waste.length) return false; cards=[SOL.waste[SOL.waste.length-1]]; take=()=>SOL.waste.pop(); }
  else if(src.from==="f"){ const f=SOL.found[src.i]; if(!f.length) return false; cards=[f[f.length-1]]; take=()=>f.pop(); }
  else { const col=SOL.tab[src.col]; if(!col[src.i]||!col[src.i].up) return false; cards=col.slice(src.i).map(x=>x.c); take=()=>col.splice(src.i); }
  // 1) a las pilas de As (una sola carta)
  if(cards.length===1 && src.from!=="f" && solCanFound(cards[0])){ solPush(); take(); const fi=SUITORD.indexOf(cards[0][1]); SOL.found[fi].push(cards[0]); solFx["f"+fi]="moved"; solAfter(); return true; }
  // 2) a otra columna: primero una con cartas, luego un hueco libre (si la carta no estaba ya sola en su columna)
  const order=[...Array(7).keys()].filter(c=>!(src.from==="t"&&c===src.col)).sort((a,b)=>(SOL.tab[a].length?0:1)-(SOL.tab[b].length?0:1));
  for(const c of order){
    const col=SOL.tab[c];
    if(!col.length && src.from==="t" && src.i===0) continue;
    if(solCanTab(cards[0],col)){ solPush(); take(); cards.forEach(x=>col.push({c:x,up:true})); solFx["t"+c+":"+(col.length-cards.length)]="moved"; solAfter(); return true; }
  }
  return false;
}
function solDraw(){
  const cfg=solCfg(SOL.lvl);
  if(!SOL.stock.length){
    if(!SOL.waste.length) return;
    if(cfg.passes && SOL.pass>=cfg.passes){ toast(`En este nivel solo hay ${cfg.passes} vuelta${cfg.passes>1?"s":""} al mazo`); return; }
    solPush(); SOL.stock=SOL.waste.reverse(); SOL.waste=[]; SOL.pass++; SOL.moves++; solSave(); solRender(); return;
  }
  solPush();
  for(let i=0;i<cfg.draw && SOL.stock.length;i++) SOL.waste.push(SOL.stock.pop());
  solFx.w="moved"; SOL.moves++; solSave(); solRender();
}
function solDoUndo(){
  const cfg=solCfg(SOL.lvl);
  if(!solUndo.length) return;
  if(SOL.undos>=cfg.undo){ toast(cfg.undo?`En este nivel solo puedes deshacer ${cfg.undo} ${cfg.undo>1?"veces":"vez"}`:"En este nivel no se puede deshacer"); return; }
  const t0=SOL.t0, u=SOL.undos+1; SOL=JSON.parse(solUndo.pop()); SOL.t0=t0; SOL.undos=u; solFx={}; solSave(); solRender();
}
// ¿Queda alguna jugada? (para avisar cuando ya no se puede)
function solHasMove(){
  const cfg=solCfg(SOL.lvl);
  if(SOL.stock.length) return true;
  if(SOL.waste.length && (!cfg.passes || SOL.pass<cfg.passes)) return true;
  const cand=[]; if(SOL.waste.length) cand.push([SOL.waste[SOL.waste.length-1],null,-1]);
  SOL.tab.forEach((col,c)=>col.forEach((x,i)=>{ if(x.up) cand.push([x.c,c,i]); }));
  for(const [card,c,i] of cand){
    const single = c===null || i===SOL.tab[c].length-1;
    if(single && solCanFound(card)) return true;
    for(let d=0;d<7;d++){ if(d===c) continue; const col=SOL.tab[d]; if(!col.length && i===0) continue;
      if(solCanTab(card,col) && !(i>0 && SOL.tab[c][i-1].up && !col.length)) return true; }
  }
  return false;
}
const solAllUp = () => !SOL.stock.length && !SOL.waste.length && SOL.tab.every(col=>col.every(x=>x.up));
async function solFinish(){
  $("solAuto").disabled=true;
  for(let k=0;k<60 && !SOL.won;k++){
    let moved=false;
    for(let c=0;c<7 && !moved;c++){ const col=SOL.tab[c], t=col[col.length-1]; if(t && solCanFound(t.c)){ col.pop(); const fi=SUITORD.indexOf(t.c[1]); SOL.found[fi].push(t.c); solFx["f"+fi]="moved"; SOL.moves++; moved=true; } }
    if(!moved) break;
    if(SOL.found.every(f=>f.length===13)) solWin();
    solRender(); await new Promise(r=>setTimeout(r,90));
  }
  solSave(true); $("solAuto").disabled=false;
}
function solWin(){
  if(SOL.won) return;
  SOL.won=true; SOL.tUsed=now()-SOL.t0;
  const lv=SOL.lvl; SOLP.wins=(SOLP.wins||0)+1;
  const b=SOLP.best[lv]; if(!b || SOL.tUsed<b) SOLP.best[lv]=SOL.tUsed;
  if(lv===SOLP.level) SOLP.level=lv+1;
  bell(); solSave(true);
}
const mmss = ms => { const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
function solCard(c,up,fx,data,top,extra){
  const st=`top:${top}px${extra||""}`;
  if(!up) return `<div class="card back${fx?" "+fx:""}" style="${st}" ${data}></div>`;
  const r=c[0]==="T"?"10":c[0], s=c[1];
  return `<div class="card${sRed(c)?" r":""}${fx?" "+fx:""}" style="${st}" ${data}><span class="ix">${r}<i>${SUITCH[s]}</i></span><span class="st">${SUITCH[s]}</span></div>`;
}
function solSize(){
  const w=$("solBoard").clientWidth-16; const cw=Math.max(34,Math.min(72,Math.floor((w-6*4)/7)));
  $("solBoard").style.setProperty("--cw",cw+"px"); $("solBoard").style.setProperty("--ch",Math.round(cw*1.4)+"px");
  return cw;
}
function solRender(){
  if(!SOL || $("sol").hidden) return;
  const cfg=solCfg(SOL.lvl), cw=solSize(), ch=Math.round(cw*1.4);
  $("solLvl").textContent=`Nivel ${SOL.lvl} · ${cfg.name}`;
  $("solRules").html=[`Robas ${cfg.draw}`, cfg.passes?`${cfg.passes} vuelta${cfg.passes>1?"s":""} al mazo (vas en la ${Math.min(SOL.pass,cfg.passes)})`:"Vueltas sin límite", cfg.undo>=99?"Deshacer sin límite":cfg.undo?`Deshacer ${cfg.undo}`:"Sin deshacer", cfg.aces?"Ases ya puestos":null].filter(Boolean).map(x=>`<span>${esc(x)}</span>`).join("");
  // fila de arriba: mazo, descarte, pilas de As
  const dead = !SOL.stock.length && cfg.passes && SOL.pass>=cfg.passes;
  let top = SOL.stock.length ? `<button class="sol-slot stock" data-s="1" aria-label="Robar">${solCard("AS",false,"","data-s=\"1\"",0)}</button>` : `<button class="sol-slot stock ${dead?"dead":"empty"}" data-s="1" aria-label="Voltear el mazo"></button>`;
  const show=SOL.waste.slice(-(cfg.draw===3?3:1)), off=Math.round(cw*0.36);
  top += `<div class="sol-waste">${show.map((c,i)=>{ const last=i===show.length-1; return solCard(c,true,last?solFx.w:"",last?'data-w="1"':"",0,`;left:${i*off}px`); }).join("")}</div>`;
  for(let f=0;f<4;f++){ const pile=SOL.found[f], t=pile[pile.length-1];
    top+=`<div class="sol-found">${t?solCard(t,true,solFx["f"+f]||"",`data-f="${f}"`,0):`<div class="sol-slot">${SUITCH[SUITORD[f]]}</div>`}</div>`; }
  $("solTop").html = top;
  // columnas
  let tab="";
  SOL.tab.forEach((col,c)=>{
    let y=0, cards="";
    col.forEach((x,i)=>{ cards+=solCard(x.c,x.up,solFx["t"+c+":"+i]||"",x.up?`data-t="${c}:${i}"`:"",y); y+= x.up ? Math.round(ch*0.32) : Math.round(ch*0.16); });
    const h = col.length ? y - (col[col.length-1].up?Math.round(ch*0.32):Math.round(ch*0.16)) + ch : ch;
    tab+=`<div class="sol-col" data-col="${c}" style="height:${h}px">${col.length?cards:`<div class="sol-slot"></div>`}</div>`;
  });
  $("solTab").html=tab;
  solFx={};
  // barra y mensajes
  const left=Math.max(0,cfg.undo-SOL.undos);
  $("solUndo").textContent = cfg.undo>=99 ? "Deshacer" : `Deshacer (${left})`;
  $("solUndo").disabled = !solUndo.length || left<=0 || SOL.won;
  $("solAuto").hidden = SOL.won || !solAllUp();
  const msg=$("solMsg");
  if(SOL.won){
    const nx=solCfg(SOLP.level);
    msg.hidden=false; msg.html=`<b>¡Lo resolviste!</b><span>${SOL.moves} jugadas · ${mmss(SOL.tUsed)}${SOLP.best[SOL.lvl]===SOL.tUsed?" · tu mejor tiempo en este nivel":""}</span><span>Subes al <b style="font-size:1rem">nivel ${SOLP.level} · ${nx.name}</b>: robas ${nx.draw}${nx.passes?`, ${nx.passes} vuelta${nx.passes>1?"s":""} al mazo`:""}${nx.undo<99?`, ${nx.undo?"deshacer "+nx.undo:"sin deshacer"}`:""}.</span><button class="btn go" data-x="solnext">Siguiente nivel</button>`;
  } else if(!solHasMove()){
    msg.hidden=false; msg.html=`<b>Ya no hay jugadas</b><span>Esta partida no se puede terminar. Sigues en el nivel ${SOL.lvl}.</span><button class="btn go" data-x="solnew">Nueva partida</button>`;
  } else msg.hidden=true;
  solTick();
}
function solTick(){ if(!SOL||$("sol").hidden) return; $("solStat").textContent=`${SOL.moves} jugadas · ${mmss(SOL.won?SOL.tUsed:now()-SOL.t0)}`; }
async function solOpen(){
  if(!getAlias()){ toast("Primero cambia tu apodo: así se guarda tu nivel"); $("alias").focus(); window.scrollTo(0,0); return; }
  $("solOpen").disabled=true; await solLoad(); $("solOpen").disabled=false;
  if(!SOL || SOL.won) solDeal();
  SOL.t0=now()-(SOL.tUsed||0);
  solUndo=[]; $("lobby").hidden=true; $("sol").hidden=false; window.scrollTo(0,0);
  solRender(); clearInterval(solTimer); solTimer=setInterval(solTick,1000);
}
function solClose(){ if(SOL && !SOL.won) SOL.tUsed=now()-SOL.t0; solSave(true); clearInterval(solTimer); $("sol").hidden=true; $("lobby").hidden=false; solCardInfo(); window.scrollTo(0,document.body.scrollHeight); }
async function solCardInfo(){ try{ await solLoad(); const c=solCfg(SOLP.level); $("solCardInfo").textContent=`Nivel ${SOLP.level} · ${c.name}${SOLP.wins?` · ${SOLP.wins} ganada${SOLP.wins>1?"s":""}`:""}${SOL&&!SOL.won?" · tienes una partida a medias":""}`; }catch(e){} }

$("solOpen").onclick=solOpen;
$("solBack").onclick=solClose;
$("solNew").onclick=()=>{ if(SOL && !SOL.won && SOL.moves>0 && !$("solNew").dataset.sure){ $("solNew").dataset.sure="1"; $("solNew").textContent="¿Seguro? Toca otra vez"; setTimeout(()=>{ delete $("solNew").dataset.sure; $("solNew").textContent="Nueva partida"; },3000); return; }
  delete $("solNew").dataset.sure; $("solNew").textContent="Nueva partida"; solDeal(); solRender(); };
$("solUndo").onclick=solDoUndo;
$("solAuto").onclick=solFinish;
$("sol").addEventListener("click",e=>{
  if(!SOL || SOL.won && !e.target.closest('[data-x]')) return;
  const x=e.target.closest("[data-x]"); if(x){ if(x.dataset.x==="solnext"||x.dataset.x==="solnew"){ solDeal(); solRender(); } return; }
  if(e.target.closest("[data-s]")){ solDraw(); return; }
  const w=e.target.closest("[data-w]"); if(w){ if(!solAuto({from:"w"})) solShake(w); return; }
  const f=e.target.closest("[data-f]"); if(f){ if(!solAuto({from:"f",i:+f.dataset.f})) solShake(f); return; }
  const t=e.target.closest("[data-t]"); if(t){ const [c,i]=t.dataset.t.split(":").map(Number); if(!solAuto({from:"t",col:c,i})) solShake(t); return; }
});
function solShake(el){ el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
window.addEventListener("resize",()=>solRender());

// ======================= Menú nuevo: letrero, fondo pixel, Mesa Nueva, fichas personalizadas =======================
(function(){
const $$=id=>document.getElementById(id);
// ---------- pixel "HD": se dibuja con luces y sombras a baja resolución y se agranda sin suavizar ----------
function mk(w,h,fn){ const c=document.createElement("canvas"); c.width=w; c.height=h; const x=c.getContext("2d"); fn(x,w,h); return c; }
const shade=(hex,f)=>{ const n=parseInt(hex.slice(1),16); let r=n>>16,g=n>>8&255,b=n&255; const m=v=>Math.max(0,Math.min(255,Math.round(f>1?v+(255-v)*(f-1):v*f))); return `rgb(${m(r)},${m(g)},${m(b)})`; };
function rr(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }
function chipPersp(col,w){ w=w||22; const h=Math.round(w*0.72); return mk(w,h,(x,W,H)=>{
  const rx=W/2-1, ry=H*0.34, cy=ry+1, th=Math.round(H*0.24);
  x.fillStyle=shade(col,0.55); x.beginPath(); x.ellipse(W/2,cy+th,rx,ry,0,0,7); x.fill(); x.fillRect(W/2-rx,cy,rx*2,th);
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+0.3; if(Math.sin(a)<0) continue; x.fillStyle="#f1ede2"; x.fillRect(Math.round(W/2+Math.cos(a)*rx-1.2),cy+1,2,th); }
  x.fillStyle=col; x.beginPath(); x.ellipse(W/2,cy,rx,ry,0,0,7); x.fill();
  for(let i=0;i<6;i++){ const a=i/6*Math.PI*2+0.3; x.fillStyle="#f1ede2"; x.beginPath(); x.ellipse(W/2+Math.cos(a)*rx*0.83,cy+Math.sin(a)*ry*0.83,2.2,1.4,0,0,7); x.fill(); }
  x.strokeStyle=shade(col,1.35); x.lineWidth=1; x.beginPath(); x.ellipse(W/2,cy,rx*0.55,ry*0.55,0,0,7); x.stroke();
  x.fillStyle="rgba(255,255,255,.28)"; x.beginPath(); x.ellipse(W/2-rx*0.3,cy-ry*0.35,rx*0.35,ry*0.25,0,0,7); x.fill(); }); }
function chipFront(col,d){ d=d||16; return mk(d,d,(x,W)=>{ const r=W/2;
  x.fillStyle=shade(col,0.6); x.beginPath(); x.arc(r,r+0.6,r-0.5,0,7); x.fill(); x.fillStyle=col; x.beginPath(); x.arc(r,r,r-1,0,7); x.fill();
  for(let i=0;i<6;i++){ x.save(); x.translate(r,r); x.rotate(i/6*Math.PI*2); x.fillStyle="#f1ede2"; x.fillRect(-1.3,-r+1,2.6,r*0.32); x.restore(); }
  x.fillStyle=shade(col,1.25); x.beginPath(); x.arc(r,r,r*0.5,0,7); x.fill(); x.fillStyle="rgba(255,255,255,.3)"; x.beginPath(); x.arc(r*0.7,r*0.65,r*0.3,0,7); x.fill(); }); }
const PIPS={1:[[.5,.5]],2:[[.25,.25],[.75,.75]],3:[[.25,.25],[.5,.5],[.75,.75]],4:[[.25,.25],[.75,.25],[.25,.75],[.75,.75]],5:[[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]],6:[[.25,.22],[.75,.22],[.25,.5],[.75,.5],[.25,.78],[.75,.78]]};
function die(s,f){ s=s||18; f=f||[5,3,2]; return mk(s+2,s+2,(x)=>{ const a=s*0.5;
  const face=(pts,col,n)=>{ x.fillStyle=col; x.beginPath(); pts.forEach((p,i)=>i?x.lineTo(p[0],p[1]):x.moveTo(p[0],p[1])); x.closePath(); x.fill();
    const o=pts[0], u=[pts[1][0]-o[0],pts[1][1]-o[1]], v=[pts[3][0]-o[0],pts[3][1]-o[1]];
    x.fillStyle="#1a1410"; PIPS[n].forEach(([p,q])=>{ x.beginPath(); x.ellipse(o[0]+u[0]*p+v[0]*q,o[1]+u[1]*p+v[1]*q,s*0.055+0.4,s*0.045+0.35,0,0,7); x.fill(); }); };
  face([[1+a,1],[1+s,1+s*0.25],[1+a,1+s*0.5],[1,1+s*0.25]],"#f6ead0",f[0]);
  face([[1,1+s*0.25],[1+a,1+s*0.5],[1+a,1+s],[1,1+s*0.75]],"#dcc8a0",f[1]);
  face([[1+a,1+s*0.5],[1+s,1+s*0.25],[1+s,1+s*0.75],[1+a,1+s]],"#b99d70",f[2]); }); }
function card(rank,suit,red){ return mk(15,21,(x,W,H)=>{ x.fillStyle="rgba(0,0,0,.35)"; rr(x,1,1.5,W-1,H-1,2.5); x.fill();
  x.fillStyle="#fbf7ec"; rr(x,0,0,W-1,H-1,2.5); x.fill(); x.strokeStyle="#cfc4ad"; x.lineWidth=0.8; rr(x,0.5,0.5,W-2,H-2,2.2); x.stroke();
  x.fillStyle=red?"#c8231a":"#16130f"; x.font="bold 7px monospace"; x.fillText(rank,1.5,7); x.font="11px serif"; x.textAlign="center"; x.fillText(suit,W/2,H/2+5); }); }
function cardBack(){ return mk(15,21,(x,W,H)=>{ x.fillStyle="rgba(0,0,0,.35)"; rr(x,1,1.5,W-1,H-1,2.5); x.fill(); x.fillStyle="#fbf7ec"; rr(x,0,0,W-1,H-1,2.5); x.fill();
  x.fillStyle="#7a1f2b"; rr(x,1.5,1.5,W-4,H-4,1.5); x.fill(); x.strokeStyle="#c0485a"; x.lineWidth=0.7; for(let i=-20;i<30;i+=3.5){ x.beginPath(); x.moveTo(i,1.5); x.lineTo(i+18,H); x.stroke(); x.beginPath(); x.moveTo(i+18,1.5); x.lineTo(i,H); x.stroke(); } }); }
function coin(){ return mk(13,13,(x)=>{ x.fillStyle="#9c6f16"; x.beginPath(); x.arc(6.5,7,6,0,7); x.fill(); x.fillStyle="#f2c440"; x.beginPath(); x.arc(6.5,6.3,5.6,0,7); x.fill();
  x.strokeStyle="#c38f22"; x.lineWidth=1; x.beginPath(); x.arc(6.5,6.3,3.9,0,7); x.stroke(); x.fillStyle="#9c6f16"; x.font="bold 7px monospace"; x.textAlign="center"; x.fillText("$",6.6,8.8); x.fillStyle="rgba(255,255,255,.6)"; x.fillRect(3,3,2,1.2); }); }
function seven(){ return mk(14,16,(x)=>{ x.font="bold 17px Georgia"; x.textAlign="center"; x.fillStyle="#5a0c0c"; x.fillText("7",8,15); x.fillStyle="#ff3b3b"; x.fillText("7",7,14); }); }
function cherry(){ return mk(14,14,(x)=>{ x.strokeStyle="#3a7d2a"; x.lineWidth=1.3; x.beginPath(); x.moveTo(4,9); x.quadraticCurveTo(6,3,10,1.5); x.moveTo(10,9); x.quadraticCurveTo(10,4,10,1.5); x.stroke();
  [[4,10],[10,10]].forEach(([a,b])=>{ x.fillStyle="#7d0d18"; x.beginPath(); x.arc(a,b+0.6,3.4,0,7); x.fill(); x.fillStyle="#e2263b"; x.beginPath(); x.arc(a,b,3.2,0,7); x.fill(); x.fillStyle="rgba(255,255,255,.65)"; x.fillRect(a-1.6,b-1.8,1.4,1.2); }); }); }
const ICON={
  bac:()=>mk(32,32,x=>{ x.save(); x.translate(9,17); x.rotate(-0.25); x.drawImage(card("9","♥",1),-7,-10); x.restore(); x.save(); x.translate(21,16); x.rotate(0.2); x.drawImage(card("K","♠",0),-7,-10); x.restore(); x.drawImage(chipPersp("#2a64c9",14),9,22); }),
  rul:()=>mk(32,32,x=>{ const c=16; x.fillStyle="#3a2414"; x.beginPath(); x.arc(c,c+1,15,0,7); x.fill(); x.fillStyle="#b88a2c"; x.beginPath(); x.arc(c,c,14.5,0,7); x.fill();
    for(let i=0;i<18;i++){ x.fillStyle=i===0?"#2f9a62":(i%2?"#c8231a":"#16130f"); x.beginPath(); x.moveTo(c,c); x.arc(c,c,12.5,i/18*7-0.05,(i+1)/18*7*0.9975); x.fill(); }
    x.fillStyle="#5a3a1c"; x.beginPath(); x.arc(c,c,7,0,7); x.fill(); x.fillStyle="#e7c66a"; x.beginPath(); x.arc(c,c,3.2,0,7); x.fill(); x.fillStyle="#fff"; x.beginPath(); x.arc(c+8,c-6,1.6,0,7); x.fill(); }),
  bj:()=>mk(32,32,x=>{ x.save(); x.translate(11,15); x.rotate(-0.15); x.drawImage(card("A","♠",0),-7,-10); x.restore(); x.save(); x.translate(20,14); x.rotate(0.18); x.drawImage(card("K","♥",1),-7,-10); x.restore(); x.drawImage(chipPersp("#c8352b",14),2,22); x.drawImage(chipPersp("#16130f",14),15,23); }),
  pk:()=>mk(32,32,x=>{ ["#2f9a62","#2a64c9","#c8352b","#16130f"].forEach((c,i)=>x.drawImage(chipPersp(c,20),2,20-i*4)); [["#c8352b",0],["#2a64c9",1]].forEach(([c,i])=>x.drawImage(chipPersp(c,16),16,24-i*4)); }),
  sol:()=>mk(32,32,x=>{ for(let col=0;col<3;col++) for(let r=0;r<=col;r++) x.drawImage(r<col?cardBack():card(["A","7","Q"][col],["♣","♥","♠"][col],col===1),1+col*10,2+r*5); })
};
function paintIcons(root){ (root||document).querySelectorAll("[data-gi]").forEach(e=>{ if(e.firstChild || !ICON[e.dataset.gi]) return; const c=ICON[e.dataset.gi](); c.className="pix"; e.appendChild(c); }); }

// ---------- centros de ficha ----------
function suitD(x,s,ch,col,rim){ x.font=`${s*1.05}px Georgia,"DejaVu Sans",serif`; x.textAlign="center"; x.textBaseline="middle";
  if(rim){ x.fillStyle=rim; [[-1,0],[1,0],[0,-1],[0,1]].forEach(([a,b])=>x.fillText(ch,a*0.9,s*0.05+b*0.9)); }
  x.fillStyle=col; x.fillText(ch,0,s*0.05); }
// centros de ficha: los 16 diseños pixel (emblemas.png) + tu inicial
const EMBIMG=new Image(); EMBIMG.src="emblemas.png";
const EMB16=[["ruleta","Ruleta"],["billetes","Billetes"],["joker","Joker"],["picas","Picas"],["monedas","Monedas"],["herradura","Herradura"],["corazon","Corazón"],["gema","Gema"],
  ["slot777","777"],["trebol","Trébol"],["ficha1","Ficha $1"],["maquina","Tragamonedas"],["diamante","Diamante"],["dados","Dados"],["torres","Torres $"],["cartas","Cartas"]];
const EMBL={ inicial:{n:"Inicial", d:(x,s,c,ini)=>{ x.font=`bold ${s*0.9}px Marcellus,Georgia,serif`; x.textAlign="center"; x.textBaseline="middle"; x.fillStyle="rgba(0,0,0,.35)"; x.fillText(ini,0.6,s*0.04+0.6); x.fillStyle=c; x.fillText(ini,0,s*0.04); }},
  vacio:{n:"",hide:true,d:()=>{}} };
EMB16.forEach(([k,n],i)=>{ EMBL[k]={n, d:(x,s)=>{ if(EMBIMG.complete&&EMBIMG.naturalWidth){ x.imageSmoothingEnabled=true; x.drawImage(EMBIMG,i*64,0,64,64,-s/2,-s/2,s,s); } }}; });
const OLDEM={cerezas:"maquina",corona:"torres",siete:"slot777",corazon:"corazon",diamante:"diamante",trebol:"trebol",dado:"dados",estrella:"gema",bolsa:"billetes",picas:"picas",joker:"joker"};
const fixEm=c=>{ if(c&&c.em&&!EMBL[c.em]&&OLDEM[c.em]) c=Object.assign({},c,{em:OLDEM[c.em]}); return c; };
EMBIMG.onload=()=>{ for(const k in URLC) delete URLC[k]; const e=$$("chipEms"); if(e) e.innerHTML=""; repaintAll(); };
const PATS={clasica:"Clásica",puntos:"Puntos",rombos:"Rombos",rayas:"Rayas"};
function chipCanvas(c,px){ return mk(px,px,(x,W)=>{ const r=W/2;
  x.fillStyle=shade(c.base,0.55); x.beginPath(); x.arc(r,r+W*0.02,r-0.4,0,7); x.fill();
  x.fillStyle=c.base; x.beginPath(); x.arc(r,r,r-0.8,0,7); x.fill();
  x.save(); x.translate(r,r); x.fillStyle=c.edge; const pat=c.pat||"clasica";
  if(pat==="clasica") for(let i=0;i<6;i++){ x.save(); x.rotate(i*Math.PI/3); x.fillRect(-W*0.075,-r+0.8,W*0.15,r*0.3); x.restore(); }
  if(pat==="rayas") for(let i=0;i<12;i++){ x.save(); x.rotate(i*Math.PI/6); x.fillRect(-W*0.035,-r+0.8,W*0.07,r*0.3); x.restore(); }
  if(pat==="puntos") for(let i=0;i<10;i++){ const a=i*Math.PI/5; x.beginPath(); x.arc(Math.cos(a)*r*0.84,Math.sin(a)*r*0.84,W*0.045,0,7); x.fill(); }
  if(pat==="rombos") for(let i=0;i<8;i++){ x.save(); x.rotate(i*Math.PI/4); x.beginPath(); x.moveTo(0,-r+0.8); x.lineTo(W*0.06,-r*0.84); x.lineTo(0,-r*0.68); x.lineTo(-W*0.06,-r*0.84); x.closePath(); x.fill(); x.restore(); }
  x.restore();
  x.strokeStyle="rgba(255,255,255,.28)"; x.lineWidth=Math.max(1,W*0.03); x.beginPath(); x.arc(r,r,r-1,0,7); x.stroke();
  x.strokeStyle=c.edge; x.lineWidth=Math.max(0.8,W*0.025); x.setLineDash([W*0.04,W*0.03]); x.beginPath(); x.arc(r,r,r*0.66,0,7); x.stroke(); x.setLineDash([]);
  x.fillStyle=c.mid||c.base; x.beginPath(); x.arc(r,r,r*0.58,0,7); x.fill();
  x.save(); x.translate(r,r); (EMBL[c.em]||EMBL.inicial).d(x,W*0.6,c.emc||"#fff",c.ini||"?",c.amt); x.restore();
  x.fillStyle="rgba(255,255,255,.16)"; x.beginPath(); x.ellipse(r*0.72,r*0.55,r*0.36,r*0.15,-0.45,0,7); x.fill(); }); }

// ---------- fichas de cada jugador (por apodo, compartidas en la base) ----------
const DEFC=["#6c2bd9","#ff4f9a","#2fd36b","#2b7bff","#18c3b6","#8c1c3c","#f2b705","#ff7a1a"];
const keyOf=n=>normName(n).replace(/[\/.#$\[\]~]/g,"_").slice(0,40)||"_";
const FICHAS={}; const URLC={};
function defCfg(name,seat){ const n=normName(name); let h=0; for(const ch of n) h=(h*31+ch.charCodeAt(0))>>>0;
  const base=seat!==undefined&&seat!==null&&!n ? DEFC[seat%DEFC.length] : DEFC[h%DEFC.length];
  return {base,edge:"#f1ede2",pat:"clasica",mid:shade(base,0.85),em:"inicial",emc:"#fff"}; }
const okCfg=c=>c&&typeof c==="object"&&typeof c.base==="string"&&typeof c.edge==="string";
function cfgOf(name,seat){ const mine=normName(name)===normName(getAlias()) && myCfg(); const c=fixEm([mine,FICHAS[keyOf(name)]].find(okCfg)||defCfg(name,seat));
  return Object.assign({},c,{ini:(String(name||"?").trim()[0]||"?").toUpperCase()}); }
function chipURL(name,seat){ try{ const c=cfgOf(name,seat); const k=JSON.stringify(c); if(!URLC[k]) URLC[k]=chipCanvas(c,40).toDataURL(); return URLC[k]; }catch(e){ return chipCanvas(defCfg(name,seat),40).toDataURL(); } }
(function(){ try{ const v=JSON.parse(lsGet("mc-chip")||"null"); if(v && typeof v==="object"){ lsSet("mc-ficha",JSON.stringify(v)); lsSet("mc-chip","100"); } }catch(e){} })();   // versión anterior: mismo lugar
function betChip(v){ let base=myCfg(); if(!okCfg(base)) base=cfgOf(getAlias()||"?");
  const c=Object.assign({},base,{em:"vacio"}); const k="bet:"+JSON.stringify(c);
  try{ if(!URLC[k]) URLC[k]=chipCanvas(c,48).toDataURL(); }catch(e){ URLC[k]=chipCanvas(defCfg(getAlias()),48).toDataURL(); }
  const mid=(base.mid||base.base||"#000").replace("#",""), n=parseInt(mid.length===6?mid:"000000",16), lum=((n>>16)*299+((n>>8)&255)*587+(n&255)*114)/1000;
  return {url:URLC[k], ink: lum>150?"#16130f":"#ffffff", label: v>=1000?(v/1000)+"K":String(v)}; }
function betChipURL(v){ return betChip(v).url; }
function myCfg(){ try{ const v=JSON.parse(lsGet("mc-ficha")||"null"); return v&&typeof v==="object"&&v.base?v:null; }catch(e){ return null; } }
function syncChip(){ const c=myCfg(), a=getAlias(); if(!c||!a||!ST.db) return; ST.db.doc("fichas/"+keyOf(a)).set({name:a,cfg:JSON.stringify(c),at:Date.now()}).catch(()=>{}); }
function repaintAll(){ try{ renderBoard2(); }catch(e){} try{ if(ST.mesas) renderLobbyList(); }catch(e){} try{ if(ST.T && !$$("mesa").hidden) render(); }catch(e){} try{ renderMe(); }catch(e){} }
let fichasOn=false;
function watchFichas(){ if(fichasOn||!ST.db) return; fichasOn=true;
  try{ ST.db.collection("fichas").onSnapshot(qs=>{ let ch=false; qs.docs.forEach(d=>{ const v=d.data()||{}; let c=null; try{ c=JSON.parse(v.cfg); }catch(e){} if(c && JSON.stringify(FICHAS[d.id])!==JSON.stringify(c)){ FICHAS[d.id]=c; ch=true; } });
      const mine=FICHAS[keyOf(getAlias())]; if(mine && !myCfg()){ lsSet("mc-ficha",JSON.stringify(mine)); ch=true; }   // tu ficha guardada desde otro cel
      if(ch) repaintAll(); }, ()=>{}); }catch(e){}
}
const waitDb=setInterval(()=>{ if(ST.db){ clearInterval(waitDb); watchFichas(); syncChip(); } },600);

// ---------- personalizar tu ficha ----------
const PRESETS=[["Neón",{base:"#6c2bd9",edge:"#ff4f9a",pat:"clasica",mid:"#4e1fa0",em:"joker"}],["High Roller",{base:"#1a1428",edge:"#ffd23f",pat:"clasica",mid:"#2a2240",em:"torres"}],
  ["Vegas",{base:"#8c1c3c",edge:"#ffd23f",pat:"rayas",mid:"#6e1530",em:"slot777"}],["Diamante",{base:"#14324a",edge:"#3ec6ff",pat:"rombos",mid:"#0f2638",em:"gema"}],
  ["Lucky",{base:"#ff4f9a",edge:"#ffffff",pat:"clasica",mid:"#d93a80",em:"herradura"}],["Lima",{base:"#1d1530",edge:"#39e75f",pat:"puntos",mid:"#2a2045",em:"ficha1"}]];
const BASES=["#6c2bd9","#ff4f9a","#2fd36b","#f2b705","#2b7bff","#18c3b6","#8c1c3c","#1a1428","#f4efe6","#ff7a1a"];
const EDGES=["#ffffff","#ffd23f","#ff4f9a","#39e75f","#3ec6ff","#b48cff","#1a1428","#ff7a1a"];
let EDIT=null;
const img=(cfg,px,size)=>{ const c=chipCanvas(Object.assign({ini:(getAlias()||"?")[0].toUpperCase()},cfg),px); c.className="pix"; c.style.width=c.style.height=size+"px"; return c; };
function paintSheet(){
  const pv=$$("chipPrev"); pv.innerHTML=""; pv.appendChild(img(EDIT,88,150));
  const st=$$("chipSeat"); st.innerHTML=""; st.appendChild(img(EDIT,24,34)); $$("chipSeatName").textContent=getAlias()||"Tú";
  const same=(a,b)=>["base","edge","pat","em"].every(k=>a[k]===b[k]);
  $$("chipPresets").querySelectorAll("[data-pre]").forEach(b=>b.classList.toggle("on",same(PRESETS[+b.dataset.pre][1],EDIT)));
  $$("chipBase").querySelectorAll("[data-c]").forEach(b=>b.classList.toggle("on",b.dataset.c===EDIT.base));
  $$("chipEdge").querySelectorAll("[data-c]").forEach(b=>b.classList.toggle("on",b.dataset.c===EDIT.edge));
  $$("chipPats").querySelectorAll("[data-pat]").forEach(b=>{ b.classList.toggle("on",b.dataset.pat===EDIT.pat); const s=b.querySelector("span"); s.innerHTML=""; s.appendChild(img(Object.assign({},EDIT,{pat:b.dataset.pat,em:"inicial"}),30,40)); });
  $$("chipEms").querySelectorAll("[data-em]").forEach(b=>b.classList.toggle("on",b.dataset.em===EDIT.em));
}
function buildSheet(){
  $$("chipPresets").innerHTML=PRESETS.map(([n],i)=>`<button data-pre="${i}"><span></span>${n}</button>`).join("");
  $$("chipPresets").querySelectorAll("[data-pre]").forEach(b=>b.querySelector("span").appendChild(img(PRESETS[+b.dataset.pre][1],32,52)));
  $$("chipBase").innerHTML=BASES.map(c=>`<button data-c="${c}" style="background:${c}" aria-label="color"></button>`).join("");
  $$("chipEdge").innerHTML=EDGES.map(c=>`<button data-c="${c}" style="background:${c}" aria-label="color del borde"></button>`).join("");
  $$("chipPats").innerHTML=Object.entries(PATS).map(([k,n])=>`<button data-pat="${k}"><span></span>${n}</button>`).join("");
  $$("chipEms").innerHTML=Object.entries(EMBL).filter(([k,v])=>!v.hide).map(([k,v])=>`<button data-em="${k}"><span></span><small>${v.n}</small></button>`).join("");
  $$("chipEms").querySelectorAll("[data-em]").forEach(b=>{ const c=mk(40,40,x=>{ x.translate(20,20); EMBL[b.dataset.em].d(x,38,"#ffd23f",(getAlias()||"F")[0].toUpperCase()); }); c.className="pix"; c.style.width=c.style.height="38px"; b.querySelector("span").appendChild(c); });
  $$("chipSheet").addEventListener("click",e=>{ const t=e.target.closest("button"); if(!t) return;
    if(t.dataset.pre!==undefined) EDIT=Object.assign({},PRESETS[+t.dataset.pre][1]);
    else if(t.dataset.c && t.parentNode.id==="chipBase"){ EDIT.base=t.dataset.c; EDIT.mid=shade(t.dataset.c,0.82); }
    else if(t.dataset.c && t.parentNode.id==="chipEdge") EDIT.edge=t.dataset.c;
    else if(t.dataset.pat) EDIT.pat=t.dataset.pat;
    else if(t.dataset.em){ EDIT.em=t.dataset.em; if(EDIT.em==="inicial") EDIT.emc=["#f1ede2","#ffd75e"].includes(EDIT.base)?"#16130f":"#fff"; }
    else return;
    paintSheet(); });
  $$("chipSave").onclick=()=>{ lsSet("mc-ficha",JSON.stringify(EDIT)); syncChip(); closeSheets(); repaintAll(); toast("Ficha guardada: así te ven en todas las mesas"); };
}
function openSheet(id){ $$(id).hidden=false; document.body.classList.add("l2lock"); }
function closeSheets(){ ["chipSheet","setSheet"].forEach(id=>$$(id).hidden=true); document.body.classList.remove("l2lock"); }
document.addEventListener("click",e=>{ if(e.target.closest&&e.target.closest("[data-close]")) closeSheets(); if(e.target.classList&&e.target.classList.contains("l2sheet")) closeSheets(); });
$$("chipBtn").onclick=()=>{ EDIT=Object.assign({},fixEm(myCfg())||cfgOf(getAlias()||"?")); delete EDIT.ini; if(!$$("chipEms").firstChild) buildSheet(); paintSheet(); openSheet("chipSheet"); };
$$("gearBtn").onclick=()=>openSheet("setSheet");

// ---------- Mesa Nueva: rodillos ----------
const NAMES=["La Racha","Dealer HDP","All-in o nada","Noche de Suerte","El Bluff","Doble o Nada","Mesa Dorada","As de Oro","Todo al Rojo","Flor Imperial","La Ficha Loca","Casa Llena"];
const REELS=[{k:"juego",t:"JUEGO",items:[["bac","Baccarat"],["rul","Ruleta"],["bj","Blackjack"],["pk","Póker"]]},
  {k:"fichas",t:"FICHAS",items:[["5000","5K"],["10000","10K"],["50000","50K"],["100000","100K"]]},
  {k:"nombre",t:"NOMBRE",items:NAMES.map(n=>[n])}];
const CHC={"5000":"#c8352b","10000":"#2a64c9","50000":"#2f9a62","100000":"#16130f"};
const cellHTML=(r,it)=> r.k==="juego" ? `<div class="cell"><span class="ri" data-gi="${it[0]}"></span><b>${it[1]}</b></div>`
  : r.k==="fichas" ? `<div class="cell"><span class="ri" data-chp="${it[0]}"></span><b class="money">${it[1]}</b></div>` : `<div class="cell name"><b>${esc(it[0])}</b></div>`;
const RH=56, ROFF=RH;  // alto de cada opción; la elegida queda en medio de 3
const pos=[0,1,Math.floor(Math.random()*NAMES.length)]; let customName="";
function buildReels(){
  $$("slotReels").innerHTML=`<div class="sl-frame"><div class="sl-in">${REELS.map((r,i)=>`<div class="sl-col"><div class="sl-lbl">${r.t}</div><div class="sl-reel" data-r="${i}"><div class="strip">${[...r.items,...r.items,...r.items].map(it=>cellHTML(r,it)).join("")}</div><div class="sl-shade"></div></div></div>`).join("")}<div class="sl-pay"></div><i class="sl-arw l"></i><i class="sl-arw r"></i></div></div>`;
  paintIcons($$("slotReels"));
  $$("slotReels").querySelectorAll("[data-chp]").forEach(e=>{ const c=chipPersp(CHC[e.dataset.chp],24); c.className="pix"; e.appendChild(c); });
  pos[0]=Math.max(0,REELS[0].items.findIndex(x=>x[0]===UI.createGame)); pos[1]=Math.max(0,REELS[1].items.findIndex(x=>+x[0]===UI.buyIn));
  REELS.forEach((r,i)=>show(i)); apply();
  $$("slotReels").querySelectorAll(".sl-reel").forEach(el=>{ const i=+el.dataset.r, n=REELS[i].items.length; let y0=null,last=0,v=0,t0=0,base=0;
    el.addEventListener("pointerdown",e=>{ unlockAudio(); y0=e.clientY; last=y0; t0=performance.now(); v=0; base=pos[i]; try{ el.setPointerCapture(e.pointerId); }catch(_){} strip(i).style.transition="none"; });
    el.addEventListener("pointermove",e=>{ if(y0===null) return; const t=performance.now(); v=(e.clientY-last)/Math.max(1,t-t0); last=e.clientY; t0=t; strip(i).style.transform=`translateY(${ty(i,base)+(e.clientY-y0)}px)`; });
    const end=e=>{ if(y0===null) return; const fl=Math.abs(v)>0.9?Math.max(-2*RH,Math.min(2*RH,v*90)):0; const d=e.clientY-y0+fl; y0=null;
      const steps=Math.round(-d/RH); if(!steps){ show(i,200); return; } pos[i]=((base+steps)%n+n)%n; if(i===2) customName=""; show(i,380); apply(); tick(); };
    el.addEventListener("pointerup",end); el.addEventListener("pointercancel",end); });
}
const strip=i=>$$("slotReels").querySelector(`.sl-reel[data-r="${i}"] .strip`);
const ty=(i,idx)=>-((REELS[i].items.length+idx)*RH)+ROFF;
function show(i,ms){ const s=strip(i); s.style.transition=ms?`transform ${ms}ms cubic-bezier(.15,.85,.25,1.08)`:"none"; s.style.transform=`translateY(${ty(i,pos[i])}px)`; }
function apply(){ UI.createGame=REELS[0].items[pos[0]][0]; UI.buyIn=+REELS[1].items[pos[1]][0];
  const name=customName||REELS[2].items[pos[2]][0]; $$("mesaName").value=name;
  $$("s2T").textContent=`${REELS[0].items[pos[0]][1]} · ${REELS[1].items[pos[1]][1]} fichas`; $$("s2N").textContent=name; }
function tick(){ if(lsGet("mc-bell")==="off"||!actx) return; try{ const o=actx.createOscillator(), g=actx.createGain(); o.type="square"; o.frequency.value=1500; g.gain.setValueAtTime(0.0001,actx.currentTime); g.gain.setValueAtTime(0.04,actx.currentTime+0.001); g.gain.exponentialRampToValueAtTime(0.0001,actx.currentTime+0.04); o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime+0.05); }catch(e){} }
function spin(){ unlockAudio(); customName=""; $$("s2Name").hidden=true;
  REELS.forEach((r,i)=>{ const n=r.items.length, tgt=Math.floor(Math.random()*n), s=strip(i), ms=1000+i*450;
    s.style.transition="none"; s.style.transform=`translateY(${-((2*n+pos[i])*RH)+ROFF}px)`; s.offsetHeight; pos[i]=tgt;
    s.style.transition=`transform ${ms}ms cubic-bezier(.12,.75,.22,1.06)`; s.style.transform=`translateY(${ty(i,tgt)}px)`;
    for(let k=0;k<6;k++) setTimeout(tick,k*(ms/9)); setTimeout(tick,ms); });
  setTimeout(apply,1000+2*450); }
$$("s2Rand").onclick=spin;
$$("s2Edit").onclick=()=>{ const inp=$$("s2Name"); inp.hidden=false; inp.value=$$("mesaName").value; inp.focus(); inp.select(); };
$$("s2Name").addEventListener("input",()=>{ customName=$$("s2Name").value.replace(/[\u0000-\u001f]/g,"").slice(0,28); apply(); });
$$("l2games").addEventListener("click",e=>{ const b=e.target.closest("[data-pick]"); if(!b) return; pos[0]=Math.max(0,REELS[0].items.findIndex(x=>x[0]===b.dataset.pick)); show(0,500); apply(); tick();
  $$("slot2").scrollIntoView({behavior:"smooth",block:"center"}); });

// ---------- letrero de neón con letras de foquitos ----------
const FONT5={M:["10001","11011","10101","10101","10001","10001","10001"],E:["11111","10000","10000","11110","10000","10000","11111"],S:["01111","10000","10000","01110","00001","00001","11110"],
  A:["01110","10001","10001","11111","10001","10001","10001"],D:["11110","10001","10001","10001","10001","10001","11110"],C:["01111","10000","10000","10000","10000","10000","01111"],
  U:["10001","10001","10001","10001","10001","10001","01110"],T:["11111","00100","00100","00100","00100","00100","00100"],R:["11110","10001","10001","11110","10100","10010","10001"],O:["01110","10001","10001","10001","10001","10001","01110"]," ":["00000","00000","00000","00000","00000","00000","00000"]};
const SW=124, SH=78, sx=$$("signcv").getContext("2d"); $$("signcv").width=SW; $$("signcv").height=SH;
const BULBS=[]; ["MESA DE","CUATRO"].forEach((ln,li)=>{ const B=2.55, ox=(SW-(ln.length*6-1)*B)/2+B/2, oy=li?42:14;
  [...ln].forEach((ch,ci)=>FONT5[ch].forEach((row,ry)=>[...row].forEach((v,rx)=>{ if(v==="1") BULBS.push([ox+(ci*6+rx)*B, oy+ry*B, ci+rx*0.2+ry*0.15+li*3]); }))); });
const PER=[]; for(let i=0;i<=40;i++){ PER.push([4+i*(SW-8)/40,5]); PER.push([7+i*(SW-14)/40,SH-4]); } for(let i=1;i<14;i++){ PER.push([3+i*0.15,5+i*(SH-9)/14]); PER.push([SW-3-i*0.15,5+i*(SH-9)/14]); }
function drawSign(t){ const x=sx; x.clearRect(0,0,SW,SH);
  x.fillStyle="#2a0718"; x.beginPath(); x.moveTo(2,4); x.lineTo(SW-2,4); x.lineTo(SW-6,SH-2); x.lineTo(6,SH-2); x.closePath(); x.fill();
  for(let y=7;y<SH-4;y+=3.2){ const ins=(y/SH)*4, fl=0.75+0.25*Math.sin(t*0.07+y*0.5);
    x.strokeStyle=`rgba(255,70,170,${0.75*fl})`; x.lineWidth=1.6; x.beginPath(); x.moveTo(4+ins,y); x.lineTo(SW-4-ins,y); x.stroke();
    x.strokeStyle=`rgba(255,190,230,${0.5*fl})`; x.lineWidth=0.5; x.beginPath(); x.moveTo(4+ins,y); x.lineTo(SW-4-ins,y); x.stroke(); }
  x.fillStyle="rgba(40,4,20,.78)"; x.fillRect(8,9,SW-16,SH-18); x.fillStyle="rgba(40,4,20,.9)"; x.fillRect(20,SH-14,SW-40,8);
  PER.forEach(([a,b],i)=>{ const on=((i>>1)+Math.floor(t/5))%3===0; x.fillStyle=on?"#fff6c8":"#a8772e"; x.beginPath(); x.arc(a,b,on?1.2:0.9,0,7); x.fill(); if(on){ x.fillStyle="rgba(255,220,120,.35)"; x.beginPath(); x.arc(a,b,2.4,0,7); x.fill(); } });
  BULBS.forEach(([a,b,k])=>{ const lit=Math.sin(k*0.55-t*0.12)>0.35;
    x.fillStyle=lit?"rgba(255,215,110,.38)":"rgba(255,180,60,.16)"; x.beginPath(); x.arc(a,b,lit?2.3:1.8,0,7); x.fill();
    x.fillStyle=lit?"#fffbe0":"#f2b23a"; x.beginPath(); x.arc(a,b,lit?1.05:0.95,0,7); x.fill(); }); }

// ---------- fondo: imagen pixel + fichas, dados, cartas y monedas cayendo ----------
const bg=$$("l2bg"), bx=bg.getContext("2d"), SC=3; const COLS=["#c8352b","#2a64c9","#2f9a62","#16130f","#f1ede2"];
const pick=a=>a[Math.floor(Math.random()*a.length)];
const KINDS=[()=>({spr:[chipFront(pick(COLS),16)],spin:true}),()=>({spr:[chipPersp(pick(COLS),22)]}),
  ()=>({spr:[[5,3,2],[1,2,4],[6,4,5],[3,6,1]].map(f=>die(16,f)),tumble:true}),
  ()=>({spr:[card(pick(["A","K","Q","7","9"]),pick(["♠","♥","♦","♣"]),Math.random()<.5),cardBack()],flip:true}),
  ()=>({spr:[coin()],spin:true}),()=>({spr:[seven()]}),()=>({spr:[cherry()]})];
let parts=[];
function bgSize(){ bg.width=Math.ceil(innerWidth/SC); bg.height=Math.ceil(innerHeight/SC); bx.imageSmoothingEnabled=false;
  const want=Math.round(bg.width*bg.height/900); while(parts.length<want) parts.push(spawn(true)); parts.length=Math.min(parts.length,want); }
function spawn(top){ return Object.assign(pick(KINDS)(),{x:Math.random()*bg.width,y:top?Math.random()*bg.height:-30,vy:.08+Math.random()*.12,vx:(Math.random()-.5)*.06,t:Math.random()*300,rot:(Math.random()-.5)*0.6}); }
function drawBg(){ bx.clearRect(0,0,bg.width,bg.height);
  for(let i=0;i<parts.length;i++){ let p=parts[i]; p.y+=p.vy; p.x+=p.vx; p.t++; if(p.y>bg.height+30) p=parts[i]=spawn(false);
    let im=p.spr[0], s=1; if(p.tumble) im=p.spr[Math.floor(p.t/26)%p.spr.length]; if(p.spin) s=Math.cos(p.t*0.035); if(p.flip){ s=Math.cos(p.t*0.025); im=s<0?p.spr[1]:p.spr[0]; }
    bx.save(); bx.translate(Math.round(p.x),Math.round(p.y)); if(!p.spin&&!p.flip) bx.rotate(p.tumble?Math.sin(p.t*0.02)*0.3:p.rot); bx.scale(Math.max(0.12,Math.abs(s)),1);
    bx.globalAlpha=0.33; bx.fillStyle="#000"; bx.beginPath(); bx.ellipse(2,im.height/2+4,im.width/2.4,2,0,0,7); bx.fill(); bx.globalAlpha=1;
    bx.drawImage(im,-im.width/2,-im.height/2); bx.restore(); } }
const still=window.matchMedia&&matchMedia("(prefers-reduced-motion: reduce)").matches;
let T0=0, lastF=0;
function loop(ts){ requestAnimationFrame(loop);
  const on=!$$("lobby").hidden && document.visibilityState==="visible"; document.body.classList.toggle("l2on",!$$("lobby").hidden);
  if(!on || ts-lastF<33) return; lastF=ts; T0++;
  drawSign(still?40:T0); if(!still||T0<3) drawBg(); }
bgSize(); addEventListener("resize",bgSize); requestAnimationFrame(loop);

buildReels(); paintIcons($$("l2games")); renderMe();
// avisos: resumen corto junto a "Mesas abiertas"
setInterval(()=>{ const m=$$("pushMini"); if(!m) return; const on=localStorage.getItem("mc-push")==="on"; m.textContent=on?"🔔 avisos activos":""; },2000);
window.L2={chipURL,betChip,betChipURL,syncChip,paintIcons,repaintAll};
})();
