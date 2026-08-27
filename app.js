/* ============================================================
   THE OCTAGON — Sales Championship Leaderboard
   Live-polls a public Google Sheet, ranks agents by total
   monthly premium, and throws a UFC fight-night party.
   ============================================================ */

/* ------------------------------------------------------------
   CONFIG  — edit these if your sheet ever changes
   ------------------------------------------------------------ */
const CONFIG = {
  SHEET_ID: "1h5B_KDge0e-SYI9LfjkFPXgxDLZAsFpL_O2bsbjAfog",
  GID: "416393424",
  POLL_MS: 15000,        // how often to re-check the sheet
  ROTATE_MS: 15000,      // how long each dashboard stays up
  DEMO_AUTO_MS: 9000,    // auto-demo event interval when demo mode on
};
const SHEET_URL = () =>
  `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&gid=${CONFIG.GID}&_=${Date.now()}`;

/* Primary data source: HighLevel via the ccg-sales-feed Cloudflare Worker.
   Same CSV shape as the sheet; the sheet stays as an automatic fallback. */
const FEED_URL = () =>
  `https://ccg-sales-feed.adamgelvaninsurance.workers.dev/?_=${Date.now()}`;

let dataSource="—";  // surfaced in the status pill
async function fetchBoardCSV(){
  try {
    const r = await fetch(FEED_URL(), { cache:"no-store" });
    if (r.ok){ dataSource="HighLevel"; return await r.text(); }
  } catch (e) { /* feed down — fall through to the sheet */ }
  dataSource="Sheet (fallback)";
  const r2 = await fetch(SHEET_URL(), { cache:"no-store" });
  if (!r2.ok) throw new Error("HTTP "+r2.status);
  return await r2.text();
}

/* ------------------------------------------------------------
   Little DOM helpers
   ------------------------------------------------------------ */
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const money = (n) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* Deterministic color per agent name */
function agentColor(name){
  let h = 0; for (let i=0;i<name.length;i++) h = (h*31 + name.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 45%)`;
}
function initials(name){
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0]||"") + (p[1]?.[0]||"")).toUpperCase();
}
/* Real nicknames — keys must match the agent name in the sheet exactly.
   Anyone not listed gets an auto-generated fight name from NICKNAMES. */
const AGENT_NICKNAMES = {
  "Dmytro Dimov":                 "BIG DEEM",
  "Shefic Liberato":              "CHEFFY",
  "Michael Gelvan":               "MIKEY SEU DOIDINHO",
  "Fernando Cassim Fernandes Jr": "CHAMA",
  "Sonia Calcagno":               "SONIC THE HEDGEHOG",
  "Felipe Pires":                 "FELPS",
  "Andres Solorzano":             "PILLOW CASE",
  "Matt Langer":                  "MITYA",
  "Yara Ferreira":                "HOUDINI",
  "Timur Rahimov":                "TIMMY TURNER",
  "Elaine Grossman":              "EEELAINE",
};
const NICKNAMES = ["THE CLOSER","IRON","MONEY","THE MACHINE","THE HAMMER","EL FUEGO","THE SNIPER","MAD DOG","THE KING","DIAMOND","THE BEAST","SILK","THE PROBLEM","THUNDER"];
function nickname(name){
  if (AGENT_NICKNAMES[name]) return AGENT_NICKNAMES[name];
  let h=0; for (const c of name) h=(h*17+c.charCodeAt(0))%NICKNAMES.length; return NICKNAMES[h];
}

/* ============================================================
   DATA LAYER
   ============================================================ */
function parseCSV(text){
  const rows=[]; let row=[], cur="", q=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (q){
      if (c === '"'){ if (text[i+1] === '"'){ cur+='"'; i++; } else q=false; }
      else cur+=c;
    } else {
      if (c === '"') q=true;
      else if (c === ",") { row.push(cur); cur=""; }
      else if (c === "\n"){ row.push(cur); rows.push(row); row=[]; cur=""; }
      else if (c === "\r"){}
      else cur+=c;
    }
  }
  if (cur.length || row.length){ row.push(cur); rows.push(row); }
  return rows;
}

async function fetchSales(){
  const rows = parseCSV(await fetchBoardCSV());
  const out=[];
  for (let i=1;i<rows.length;i++){                 // skip header
    const [date, agent, premium] = rows[i];
    if (!agent || !agent.trim()) continue;
    if (/customer\s*service/i.test(agent)) continue;   // never show service touches
    const val = parseFloat(String(premium||"").replace(/[^0-9.]/g,""));
    if (!isFinite(val)) continue;
    out.push({ date:(date||"").trim(), agent:agent.trim(), premium:val });
  }
  return out;
}

/* Parse M/D/YYYY into a timestamp (0 if unparseable) */
function parseMDY(s){
  const m = String(s||"").split("/");
  return m.length===3 ? new Date(+m[2], +m[0]-1, +m[1]).getTime() : 0;
}

/* Aggregate raw sales into ranked standings */
function computeStandings(sales){
  const latestDate = sales.reduce((a,s)=> parseMDY(s.date)>parseMDY(a)? s.date : a, "");
  const latestTs = parseMDY(latestDate);
  // Monday-start week containing the latest sale
  const d0 = new Date(latestTs); const dow = (d0.getDay()+6)%7;   // Mon=0 … Sun=6
  const weekStart = latestTs - dow*86400000;
  const weekEnd = weekStart + 7*86400000;
  const inWeek = (s)=>{ const t=parseMDY(s.date); return t>=weekStart && t<weekEnd; };

  const map = new Map();
  let biggest = { agent:"—", premium:0, date:"" };
  for (const s of sales){
    if (!map.has(s.agent)) map.set(s.agent,{ agent:s.agent, total:0, count:0, today:0, todayCount:0, week:0, weekCount:0 });
    const a = map.get(s.agent);
    a.total += s.premium; a.count++;
    if (s.date === latestDate){ a.today += s.premium; a.todayCount++; }
    if (inWeek(s)){ a.week += s.premium; a.weekCount++; }
    if (s.premium > biggest.premium) biggest = { agent:s.agent, premium:s.premium, date:s.date };
  }
  const list = [...map.values()].sort((a,b)=> b.total-a.total || b.count-a.count);
  list.forEach((a,i)=> a.rank = i+1);

  // Weekly leaderboard
  const weeklyList = [...map.values()].filter(a=>a.weekCount>0)
    .sort((a,b)=> b.week-a.week || b.weekCount-a.weekCount);

  // Highest average premium (min 2 policies so one lucky deal doesn't own it)
  let avgList = [...map.values()].filter(a=>a.count>=2);
  if (avgList.length<3) avgList = [...map.values()];
  avgList = avgList.map(a=>({ ...a, avg:a.total/a.count })).sort((x,y)=> y.avg-x.avg);

  // Biggest single deals — today and this week
  const bigToday = sales.filter(s=>s.date===latestDate).sort((x,y)=>y.premium-x.premium).slice(0,3);
  const bigWeek  = sales.filter(inWeek).sort((x,y)=>y.premium-x.premium).slice(0,3);

  const teamTotal = list.reduce((s,a)=> s+a.total, 0);
  const teamCount = sales.length;
  const weekLabel = new Date(weekStart).toLocaleDateString("en-US",{month:"short",day:"numeric"});
  return { list, weeklyList, avgList, bigToday, bigWeek, weekLabel,
           biggest, latestDate, teamTotal, teamCount, sales };
}

/* ============================================================
   SOUND ENGINE  (Web Audio — no files needed)
   ============================================================ */
const Sound = (() => {
  let ctx, master, muted=false;
  function init(){
    if (ctx) return;
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  }
  const now = () => ctx.currentTime;
  function env(node, t0, a, d, peak=1){
    const g = ctx.createGain(); node.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0+a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+a+d);
    return g;
  }
  function noiseBuf(dur){
    const b = ctx.createBuffer(1, ctx.sampleRate*dur, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i=0;i<d.length;i++) d[i] = Math.random()*2-1;
    return b;
  }
  const api = {
    unlock(){ init(); if (ctx.state==="suspended") ctx.resume(); },
    toggleMute(){ muted=!muted; if (master) master.gain.value = muted?0:0.9; return muted; },
    isMuted(){ return muted; },

    punch(){ if(!ctx)return; const t=now();
      const o=ctx.createOscillator(); o.type="sine"; o.frequency.setValueAtTime(180,t);
      o.frequency.exponentialRampToValueAtTime(45,t+0.15); o.connect(env(o,t,0.005,0.16,0.9)); o.start(t); o.stop(t+0.2);
      const n=ctx.createBufferSource(); n.buffer=noiseBuf(0.1);
      const f=ctx.createBiquadFilter(); f.type="lowpass"; f.frequency.value=900; n.connect(f);
      f.connect(env(f,t,0.002,0.08,0.7)); n.start(t);
    },
    bell(){ if(!ctx)return;                    // MMA "ding ding ding"
      [0,0.22,0.44].forEach(off=>{ const t=now()+off;
        [1,2.01,2.7,3.9].forEach((mult,i)=>{ const o=ctx.createOscillator();
          o.type="sine"; o.frequency.value=740*mult;
          o.connect(env(o,t,0.002,0.35/(i+1),0.5/(i+1))); o.start(t); o.stop(t+0.4); });
      });
    },
    airhorn(){ if(!ctx)return;                 // three blasts
      [0,0.28,0.56].forEach((off,idx)=>{ const t=now()+off; const dur=idx===2?0.5:0.18;
        [220,277,330].forEach(fr=>{ const o=ctx.createOscillator(); o.type="sawtooth";
          o.frequency.setValueAtTime(fr,t); o.frequency.linearRampToValueAtTime(fr*1.02,t+dur);
          o.connect(env(o,t,0.01,dur,0.28)); o.start(t); o.stop(t+dur+0.05); });
      });
    },
    whoosh(){ if(!ctx)return; const t=now();
      const n=ctx.createBufferSource(); n.buffer=noiseBuf(0.6);
      const f=ctx.createBiquadFilter(); f.type="bandpass"; f.frequency.setValueAtTime(300,t);
      f.frequency.exponentialRampToValueAtTime(3500,t+0.5); f.Q.value=1.2; n.connect(f);
      f.connect(env(f,t,0.05,0.5,0.5)); n.start(t);
    },
    cheer(){ if(!ctx)return; const t=now();     // crowd roar via filtered noise swell
      const n=ctx.createBufferSource(); n.buffer=noiseBuf(1.6); n.loop=false;
      const f=ctx.createBiquadFilter(); f.type="bandpass"; f.frequency.value=1200; f.Q.value=0.8; n.connect(f);
      const g=ctx.createGain(); f.connect(g); g.connect(master);
      g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(0.35,t+0.35);
      g.gain.linearRampToValueAtTime(0.22,t+0.9); g.gain.exponentialRampToValueAtTime(0.0001,t+1.6);
      n.start(t);
    },
    boom(){ if(!ctx)return; const t=now();
      const o=ctx.createOscillator(); o.type="sine"; o.frequency.setValueAtTime(90,t);
      o.frequency.exponentialRampToValueAtTime(28,t+0.7); o.connect(env(o,t,0.01,0.8,0.95)); o.start(t); o.stop(t+0.9);
      const n=ctx.createBufferSource(); n.buffer=noiseBuf(0.5);
      const f=ctx.createBiquadFilter(); f.type="lowpass"; f.frequency.value=400; n.connect(f);
      f.connect(env(f,t,0.005,0.4,0.6)); n.start(t);
    },
    cash(){ if(!ctx)return;                      // cha-ching
      [1318,1568,2093].forEach((fr,i)=>{ const t=now()+i*0.06; const o=ctx.createOscillator();
        o.type="square"; o.frequency.value=fr; o.connect(env(o,t,0.005,0.12,0.25)); o.start(t); o.stop(t+0.15); });
    },
  };
  return api;
})();

/* ============================================================
   CANVAS FX — embers background + confetti/explosions
   ============================================================ */
const FX = (() => {
  let bg, bgc, fx, fxc, W, H, embers=[], parts=[];
  function size(){ [bg,fx].forEach(c=>{ if(!c)return; c.width=W=innerWidth; c.height=H=innerHeight; }); }
  function init(){
    bg=$("#bgFx"); bgc=bg.getContext("2d"); fx=$("#fxCanvas"); fxc=fx.getContext("2d");
    size(); addEventListener("resize", size);
    for (let i=0;i<60;i++) embers.push(newEmber());
    requestAnimationFrame(loop);
  }
  function newEmber(){ return { x:Math.random()*W, y:H+Math.random()*H, r:1+Math.random()*3,
    vy:-(0.3+Math.random()*1.1), vx:(Math.random()-0.5)*0.4, hue:20+Math.random()*30, a:0.3+Math.random()*0.5 }; }
  function burst(x,y,opts={}){
    const n=opts.n||70; const colors=opts.colors||["#ffd23f","#e10600","#ff2b1c","#39ff14","#00e5ff","#ffffff"];
    for (let i=0;i<n;i++){ const ang=Math.random()*Math.PI*2, sp=2+Math.random()*(opts.power||9);
      parts.push({ x,y, vx:Math.cos(ang)*sp, vy:Math.sin(ang)*sp-3, g:0.18+Math.random()*0.12,
        life:1, decay:0.006+Math.random()*0.01, size:3+Math.random()*(opts.size||6),
        color:colors[(Math.random()*colors.length)|0], rot:Math.random()*6, vr:(Math.random()-0.5)*0.4,
        shape:Math.random()<0.5?"rect":"circ" }); }
  }
  function confettiRain(){
    for (let i=0;i<160;i++) parts.push({ x:Math.random()*W, y:-20-Math.random()*H*0.5,
      vx:(Math.random()-0.5)*2, vy:2+Math.random()*4, g:0.03, life:1, decay:0.004,
      size:5+Math.random()*7, color:["#ffd23f","#e10600","#39ff14","#00e5ff","#ff2b1c","#fff"][(Math.random()*6)|0],
      rot:Math.random()*6, vr:(Math.random()-0.5)*0.5, shape:"rect" });
  }
  function loop(){
    // embers
    bgc.clearRect(0,0,W,H);
    for (const e of embers){ e.x+=e.vx; e.y+=e.vy; if (e.y<-10){ Object.assign(e,newEmber()); }
      bgc.beginPath(); bgc.fillStyle=`hsla(${e.hue} 100% 55% / ${e.a})`;
      bgc.shadowColor=`hsla(${e.hue} 100% 55% / ${e.a})`; bgc.shadowBlur=8;
      bgc.arc(e.x,e.y,e.r,0,7); bgc.fill(); }
    bgc.shadowBlur=0;
    // particles
    fxc.clearRect(0,0,W,H);
    for (let i=parts.length-1;i>=0;i--){ const p=parts[i];
      p.vy+=p.g; p.x+=p.vx; p.y+=p.vy; p.rot+=p.vr; p.life-=p.decay;
      if (p.life<=0 || p.y>H+40){ parts.splice(i,1); continue; }
      fxc.save(); fxc.globalAlpha=Math.max(0,p.life); fxc.translate(p.x,p.y); fxc.rotate(p.rot);
      fxc.fillStyle=p.color;
      if (p.shape==="rect") fxc.fillRect(-p.size/2,-p.size/2,p.size,p.size*1.6);
      else { fxc.beginPath(); fxc.arc(0,0,p.size/2,0,7); fxc.fill(); }
      fxc.restore();
    }
    requestAnimationFrame(loop);
  }
  return { init, burst, confettiRain };
})();

/* ============================================================
   OVERLAY / EVENT ENGINE  (queued so they don't collide)
   ============================================================ */
const Overlay = (() => {
  const q=[]; let busy=false;
  function enqueue(fn){ q.push(fn); pump(); }
  function pump(){ if (busy || !q.length) return; busy=true; const fn=q.shift();
    fn(()=>{ busy=false; setTimeout(pump, 250); }); }

  function saleEvent(agent, amount){
    Sound.airhorn(); setTimeout(()=>Sound.cash(),120); setTimeout(()=>Sound.cheer(),200);
    const layer=$("#overlay");
    // rocket
    const rk=el("div","rocket","🚀"); layer.appendChild(rk);
    Sound.whoosh();
    setTimeout(()=>rk.remove(),1800);
    // meme card — image or video meme, emoji fallback if it fails to load
    const meme = pickMeme();
    const isVid = meme && VIDEO_RE.test(meme.src);
    const line = meme? meme.cap : MEME_LINES[(Math.random()*MEME_LINES.length)|0];
    const emo = SALE_EMOJI[(Math.random()*SALE_EMOJI.length)|0];
    const media = !meme ? ""
      : isVid ? `<video class="meme-img" src="${meme.src}" autoplay loop playsinline></video>`
              : `<img class="meme-img" src="${meme.src}" alt="" />`;
    const card=el("div","meme",`
      <div class="kick">💰 CHA-CHING · POLICY CLOSED</div>
      ${media}
      <div class="emoji" ${meme? 'style="display:none"' : ""}>${emo}</div>
      <div class="who">${agent}</div>
      <div class="amt">+${money2(amount)}/mo</div>
      <div class="line">${line}</div>`);
    const med=card.querySelector(".meme-img");
    if (med){
      med.onerror=()=>{ med.remove(); card.querySelector(".emoji").style.display=""; };
      if (isVid) med.muted = Sound.isMuted();   // video audio follows the M mute toggle
    }
    layer.appendChild(card);
    FX.burst(innerWidth/2, innerHeight/2, {n:90,power:11});
    FX.confettiRain();
    // videos get longer on screen so the clip can land
    return (done)=>{ setTimeout(()=>{ card.remove(); done(); }, isVid? 8000 : 4200); };
  }

  function koEvent(winner, loser, rank){
    return (done)=>{
      Sound.boom(); Sound.punch(); setTimeout(()=>Sound.punch(),140);
      setTimeout(()=>Sound.bell(),450); setTimeout(()=>Sound.cheer(),700);
      const layer=$("#overlay");
      const wrap=el("div","ko",`
        <div class="ko-flash"></div>
        <div class="ko-word">K.O!</div>
        <div class="ko-fighters">
          <div class="ko-fighter ko-win">🥊</div>
          <div class="ko-fighter ko-lose">😵</div>
        </div>
        <div class="ko-caption"><span class="g">${winner}</span> KNOCKS OUT ${loser}${rank?` &nbsp;→&nbsp; <span class="g">#${rank}</span>`:""}!</div>`);
      layer.appendChild(wrap);
      FX.burst(innerWidth/2, innerHeight*0.5, {n:120,power:14,size:8});
      setTimeout(()=>FX.burst(innerWidth*0.5, innerHeight*0.5,{n:80,power:10}),300);
      setTimeout(()=>{ wrap.remove(); done(); }, 3400);
    };
  }

  return {
    sale(agent, amount){ enqueue((done)=>{ const finisher=saleEvent(agent,amount); finisher(done); }); },
    ko(winner, loser, rank){ enqueue(koEvent(winner, loser, rank)); },
  };
})();

const MEME_LINES = ["ANOTHER ONE 🗿","MONEY PRINTER GO BRRR","STONE COLD LOCK","GET THAT BAG 💼","BUILT DIFFERENT",
  "CERTIFIED CLOSER","LIGHTS OUT 💡","TOO EASY","HE'S ON FIRE 🔥","NEW MONEY WHO DIS","ABSOLUTE UNIT","LET'S GOOO",
  "SHEEEESH","PAY THE MAN","GG NO RE"];
const SALE_EMOJI = ["🚀","💵","🔥","💎","🤑","💪","🦍","👑","⚡","🎯","🏆","🥂"];

/* ------------------------------------------------------------
   MEME PACK — real memes served from the local memes/ folder.
   Drop ANY extra .jpg/.png/.gif/.webp into memes/ and it gets
   auto-discovered on startup (uses a random MEME_LINES caption).
   ------------------------------------------------------------ */
const MEME_PACK = [
  { src:"memes/stonks.jpg",          cap:"STONKS 📈" },
  { src:"memes/success-kid.jpg",     cap:"NAILED IT." },
  { src:"memes/leo-cheers.jpg",      cap:"CHEERS TO THE CLOSER 🥂" },
  { src:"memes/laughing-leo.png",    cap:"THE COMPETITION RIGHT NOW" },
  { src:"memes/drake-yes.jpg",       cap:"CLOSING > PROSPECTING" },
  { src:"memes/epic-handshake.jpg",  cap:"AGENT 🤝 COMMISSION" },
  { src:"memes/oprah-you-get.jpg",   cap:"YOU GET A POLICY! EVERYBODY GETS A POLICY!" },
  { src:"memes/buff-doge.png",       cap:"BUILT DIFFERENT 💪" },
  { src:"memes/getting-paid.png",    cap:"YOU GUYS ARE GETTING PAID?" },
  { src:"memes/absolute-cinema.png", cap:"ABSOLUTE CINEMA 🎬" },
  { src:"memes/tuxedo-pooh.png",     cap:"A GENTLEMAN'S CLOSE 🎩" },
  { src:"memes/roll-safe.jpg",       cap:"CAN'T LOSE A DEAL IF YOU NEVER STOP CLOSING" },
  { src:"memes/pikachu.jpg",         cap:"THE OTHER AGENCIES RN:" },
  { src:"memes/disaster-girl.jpg",   cap:"THE COMPETITION'S PIPELINE:" },
  { src:"memes/more-of-that.jpg",    cap:"Y'ALL GOT ANY MORE OF THEM POLICIES?" },
];
let MEMES = [...MEME_PACK];
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
let lastMeme = -1;
function pickMeme(){
  if (!MEMES.length) return null;
  let i; do { i=(Math.random()*MEMES.length)|0; } while (MEMES.length>1 && i===lastMeme);
  lastMeme=i; return MEMES[i];
}
/* Auto-discover extra images & videos the user drops into memes/.
   1) memes/manifest.json (works on static hosts — regenerate with:
      cd memes && ls -1 | grep -Ei '\.(png|jpe?g|gif|webp|mp4|webm|mov)$' \
        | python3 -c "import sys,json; print(json.dumps([l.strip() for l in sys.stdin]))" > manifest.json )
   2) fall back to the python http.server directory listing for local use.
   Then preload-verify everything and drop any that 404. */
async function discoverMemes(){
  const addSrc = (name)=>{
    const src = "memes/"+name.split("/").pop();
    if (!MEMES.some(m=>m.src===src))
      MEMES.push({ src, cap: MEME_LINES[(Math.random()*MEME_LINES.length)|0] });
  };
  try{
    const mres = await fetch("memes/manifest.json", {cache:"no-store"});
    if (mres.ok){
      (await mres.json()).forEach(addSrc);
    } else {
      const res = await fetch("memes/", {cache:"no-store"});
      if (res.ok){
        const html = await res.text();
        [...html.matchAll(/href="([^"]+\.(?:png|jpe?g|gif|webp|mp4|webm|mov))"/gi)]
          .forEach(m=>addSrc(decodeURIComponent(m[1])));
      }
    }
  }catch(e){ /* fine — built-in pack still works */ }
  // prune anything that doesn't actually load (deleted/renamed/unplayable files)
  const checks = await Promise.all(MEMES.map(m=>new Promise(res=>{
    if (VIDEO_RE.test(m.src)){
      const v=document.createElement("video");
      v.onloadedmetadata=()=>res(v.videoWidth>0 ? m : null);  // width 0 = undecodable codec
      v.onerror=()=>res(null);
      v.muted=true; v.preload="metadata"; v.src=m.src;
      setTimeout(()=>res(null), 8000);
    } else {
      const i=new Image(); i.onload=()=>res(m); i.onerror=()=>res(null); i.src=m.src;
    }
  })));
  const good = checks.filter(Boolean);
  if (good.length) MEMES = good;
}

/* ============================================================
   SCENES  (rotating dashboards)
   ============================================================ */
const Scenes = (() => {
  let idx=0, timer=null, defs=[], data=null, prevRanks=new Map();

  function avatar(name, big){
    const a=el("div", big?"avatar-lg":"avatar", initials(name));
    a.style.background=`radial-gradient(circle at 30% 25%, rgba(255,255,255,.25), ${agentColor(name)})`;
    return a;
  }

  /* UFC fight-card layout: top 3 = MAIN CARD (big rows), everyone else =
     PRELIMS (compact grid). The whole roster is on screen at once — no scrolling. */
  function fightCard(items, o){
    const max = o.value(items[0]) || 1;
    const wrap = el("div","fightcard");
    const main = el("div","maincard");
    items.slice(0,3).forEach((a,i)=>{
      const rank=i+1;
      const row=el("div",`row r${rank}`);
      row.appendChild(el("div","rank",rank));
      if (rank===1 && o.belt) row.appendChild(el("div","belt",o.belt));
      row.appendChild(avatar(a.agent));
      row.appendChild(el("div","info",
        `<div class="name">${a.agent}</div>
         <div class="record">${o.sub(a)}</div>
         <div class="barwrap"><div class="bar" style="width:${o.value(a)/max*100}%"></div></div>`));
      row.appendChild(el("div","money",`${o.money(a)}<small>${o.label}</small>`));
      if (o.moves){
        const prev=prevRanks.get(a.agent);
        let mv="same", arw="—";
        if (prev!=null){ if (rank<prev){mv="up";arw="▲"+(prev-rank);} else if (rank>prev){mv="down";arw="▼"+(rank-prev);} }
        row.appendChild(el("div",`move ${mv}`,arw));
      }
      main.appendChild(row);
    });
    wrap.appendChild(main);
    const rest = items.slice(3);
    if (rest.length){
      wrap.appendChild(el("div","prelims-label","PRELIMS"));
      const grid=el("div",`prelims${rest.length>8?" dense":""}`);
      rest.forEach((a,i)=>{
        const rank=i+4;
        const card=el("div","pcard");
        card.appendChild(el("div","prank",rank));
        const av=avatar(a.agent); av.classList.add("avatar-s");
        card.appendChild(av);
        card.appendChild(el("div","pinfo",
          `<div class="pname">${a.agent}</div>
           <div class="pbarwrap"><div class="pbar" style="width:${o.value(a)/max*100}%"></div></div>`));
        card.appendChild(el("div","pmoney",o.money(a)));
        grid.appendChild(card);
      });
      wrap.appendChild(grid);
    }
    return wrap;
  }

  /* --- Scene 1: Championship board --- */
  function sceneBoard(){
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">🏆 CHAMPIONSHIP <span class="accent">STANDINGS</span></div>
       <div class="scene-sub">RANKED BY MONTHLY PREMIUM</div>`));
    wrap.appendChild(fightCard(data.list, {
      value:a=>a.total, money:a=>money(a.total), label:"MONTHLY PREMIUM",
      sub:a=>`"${nickname(a.agent)}" · <b>${a.count}</b> POLICIES · ${money2(a.total/a.count)} AVG`,
      belt:"🏆", moves:true }));
    return wrap;
  }

  /* --- Scene 2: Tale of the Tape (top 2) --- */
  function sceneTape(){
    const [red,blue]=data.list; if (!blue) return sceneBoard();
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">⚔️ TALE OF THE <span class="accent">TAPE</span></div>
       <div class="scene-sub">MAIN EVENT · TITLE FIGHT</div>`));
    const tape=el("div","tape");
    const corner=(a,cls,tag)=>{
      const c=el("div",`corner ${cls}`); c.appendChild(el("div","tag",tag));
      c.appendChild(avatar(a.agent,true));
      c.appendChild(el("div","cname",a.agent));
      c.appendChild(el("div","stats",
        `<div class="stat"><span>Monthly Premium</span><span>${money(a.total)}</span></div>
         <div class="stat"><span>Policies (W)</span><span>${a.count}</span></div>
         <div class="stat"><span>Avg / Policy</span><span>${money2(a.total/a.count)}</span></div>
         <div class="stat"><span>Today</span><span>${money(a.today)}</span></div>`));
      return c;
    };
    tape.appendChild(corner(red,"red","🔴 RED CORNER · CHAMP"));
    tape.appendChild(el("div","vs","VS"));
    tape.appendChild(corner(blue,"blue","🔵 BLUE CORNER · CHALLENGER"));
    wrap.appendChild(tape);
    return wrap;
  }

  /* --- Weekly Leaderboard --- */
  function sceneWeekly(){
    const wk=data.weeklyList;
    if (!wk?.length) return sceneBoard();
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">📆 THIS WEEK'S <span class="accent">WAR</span></div>
       <div class="scene-sub">WEEK OF ${data.weekLabel} · MON–SUN</div>`));
    wrap.appendChild(fightCard(wk, {
      value:a=>a.week, money:a=>money(a.week), label:"THIS WEEK",
      sub:a=>`"${nickname(a.agent)}" · <b>${a.weekCount}</b> POLICIES THIS WEEK`,
      belt:"🏆" }));
    return wrap;
  }

  /* --- Highest Average Premium --- */
  function sceneAvg(){
    const av=data.avgList;
    if (!av?.length) return sceneBoard();
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">🎯 HEAVIEST <span class="accent">HANDS</span></div>
       <div class="scene-sub">HIGHEST AVERAGE PREMIUM · MIN 2 POLICIES</div>`));
    wrap.appendChild(fightCard(av, {
      value:a=>a.avg, money:a=>money2(a.avg), label:"AVG / POLICY",
      sub:a=>`<b>${a.count}</b> POLICIES · ${money(a.total)} TOTAL · ONE-PUNCH POWER`,
      belt:"🥊" }));
    return wrap;
  }

  /* --- Biggest Deals — today & this week side by side --- */
  function sceneDeals(){
    const {bigToday, bigWeek}=data;
    if (!bigWeek?.length) return sceneBoard();
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">💣 BIGGEST <span class="accent">DEALS</span></div>
       <div class="scene-sub">HEAVYWEIGHT FINISHES · TODAY &amp; THIS WEEK</div>`));
    const grid=el("div","deals");
    const medals=["🥇","🥈","🥉"];
    const col=(title,items,cls)=>{
      const c=el("div",`deal-col ${cls}`);
      c.appendChild(el("div","deal-col-title",title));
      if (!items.length) c.appendChild(el("div","deal-empty","NO FIGHTS YET…"));
      items.forEach((s,i)=>{
        const card=el("div",`deal-card ${i===0?"top":""}`,`
          <div class="deal-medal">${medals[i]||"•"}</div>
          <div class="deal-info">
            <div class="deal-name">${s.agent}</div>
            <div class="deal-date">${s.date}</div>
          </div>
          <div class="deal-amt">${money2(s.premium)}<small>/MO</small></div>`);
        c.appendChild(card);
      });
      return c;
    };
    grid.appendChild(col(`☀️ TODAY · ${data.latestDate}`, bigToday, "today"));
    grid.appendChild(col(`📆 THIS WEEK · OF ${data.weekLabel}`, bigWeek, "week"));
    wrap.appendChild(grid);
    return wrap;
  }

  /* --- Scene 3: Knockout of the night (biggest single sale) --- */
  function sceneKOTN(){
    const b=data.biggest;
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">💥 KNOCKOUT OF THE <span class="accent">NIGHT</span></div>
       <div class="scene-sub">BIGGEST SINGLE POLICY</div>`));
    const s=el("div","spotlight");
    s.appendChild(el("div","spot-card",
      `<div class="spot-kicker">🥊 HIGHLIGHT-REEL FINISH</div>
       <div class="spot-emoji">💰</div>
       <div class="spot-name">${b.agent}</div>
       <div class="spot-amount">${money2(b.premium)}/mo</div>
       <div class="spot-line">ONE POLICY. ONE PUNCH. LIGHTS OUT.</div>`));
    wrap.appendChild(s);
    return wrap;
  }

  /* --- Scene 4: Today's card --- */
  function sceneToday(){
    const today=data.list.filter(a=>a.today>0).sort((x,y)=>y.today-x.today);
    if (!today.length) return sceneKOTN();
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">📅 TONIGHT'S <span class="accent">FIGHT CARD</span></div>
       <div class="scene-sub">TODAY · ${data.latestDate}</div>`));
    wrap.appendChild(fightCard(today, {
      value:a=>a.today, money:a=>money(a.today), label:"TODAY",
      sub:a=>`<b>${a.todayCount}</b> POLICIES TODAY · ON THE CARD`,
      belt:"🔥" }));
    return wrap;
  }

  /* --- Scene 5: Team gate (grand total) --- */
  function sceneGate(){
    const wrap=el("div","scene scene-enter");
    wrap.appendChild(el("div","scene-head",
      `<div class="scene-title">🏟️ THE <span class="accent">GATE</span></div>
       <div class="scene-sub">TEAM TOTAL · EVERYONE ON THE CARD</div>`));
    const s=el("div","spotlight");
    const leader=data.list[0];
    s.appendChild(el("div","spot-card",
      `<div class="spot-kicker">📈 TOTAL MONTHLY PREMIUM WRITTEN</div>
       <div class="spot-emoji">🤑</div>
       <div class="spot-name">${money(data.teamTotal)}</div>
       <div class="spot-amount" style="font-size:clamp(20px,3vw,40px);color:var(--neon-green)">${data.teamCount} POLICIES · ${data.list.length} FIGHTERS</div>
       <div class="spot-line">REIGNING CHAMPION: ${leader?.agent||"—"} 🏆</div>`));
    wrap.appendChild(s);
    return wrap;
  }

  defs=[sceneBoard, sceneWeekly, sceneTape, sceneAvg, sceneDeals, sceneKOTN, sceneToday, sceneGate];

  function renderDots(){
    const d=$("#dots"); d.innerHTML="";
    defs.forEach((_,i)=>{ const s=el("i", i===idx?"on":""); d.appendChild(s); });
  }
  function show(i){
    idx=(i+defs.length)%defs.length;
    const stage=$("#stage"); const old=$("#scene");
    const nu=defs[idx](); nu.id="scene";
    if (old) old.remove(); stage.appendChild(nu);
    renderDots();
  }
  function next(){ show(idx+1); resetTimer(); }
  function resetTimer(){ clearInterval(timer); timer=setInterval(()=>show(idx+1), CONFIG.ROTATE_MS); }

  return {
    update(d){
      // keep prevRanks for arrows only after first load
      if (data) prevRanks = new Map(data.list.map(a=>[a.agent,a.rank]));
      const first = !data;
      data=d;
      if (first || !$("#scene").hasChildNodes()) { show(0); resetTimer(); }
      else { const cur=defs[idx](); cur.id="scene"; const old=$("#scene"); old.replaceWith(cur); renderDots(); }
    },
    next,
    data:()=>data,
  };
})();

/* ============================================================
   TICKER
   ============================================================ */
function updateTicker(d){
  const hype=["🥊 IT'S FIGHT NIGHT","🔥 WHO WANTS THE BELT?","💰 EVERY POLICY IS A PUNCH",
    "📞 KEEP DIALING, KEEP SWINGING","🏆 CHAMPIONS ARE MADE HERE","⚡ LEAVE IT ALL IN THE OCTAGON"];
  const recent = d.sales.slice(-8).reverse().map(s=>
    `<span class="ti">🚀 <b>${s.agent}</b> closed <span class="amt">${money2(s.premium)}/mo</span></span>`);
  const champ = d.list[0] ? `<span class="ti">👑 <b>${d.list[0].agent}</b> holds the belt at <span class="amt">${money(d.list[0].total)}</span></span>` : "";
  const items = [champ, ...recent, ...hype.map(h=>`<span class="ti">${h}</span>`)];
  const track=$("#tickerTrack");
  track.innerHTML = items.join("") + items.join("");  // duplicate for seamless scroll
}

/* ============================================================
   EVENT DETECTION between polls
   ============================================================ */
let prevState = null;   // {countByAgent, ranks, totalRows}
function detectAndFire(d){
  const countByAgent=new Map(); d.list.forEach(a=>countByAgent.set(a.agent,a.count));
  const ranks=new Map(); d.list.forEach(a=>ranks.set(a.agent,a.rank));

  if (prevState){
    // NEW SALES — any agent whose policy count went up
    let anySale=false;
    d.list.forEach(a=>{
      const before = prevState.countByAgent.get(a.agent) || 0;
      if (a.count > before){
        anySale=true;
        // find the newest sale amount for this agent
        const theirs = d.sales.filter(s=>s.agent===a.agent);
        const amt = theirs.length? theirs[theirs.length-1].premium : a.total/a.count;
        Overlay.sale(a.agent, amt);
      }
    });
    // RANK UPS — agent climbed; name who they passed
    if (anySale){
      d.list.forEach(a=>{
        const beforeRank = prevState.ranks.get(a.agent);
        if (beforeRank!=null && a.rank < beforeRank){
          // who did they pass? the agent now directly below them who was above before
          let loser="THE FIELD";
          for (const b of d.list){
            const br=prevState.ranks.get(b.agent);
            if (b.agent!==a.agent && br!=null && br<beforeRank && b.rank>a.rank){ loser=b.agent; break; }
          }
          Overlay.ko(a.agent, loser, a.rank);
        }
      });
    }
  }
  prevState = { countByAgent, ranks, totalRows:d.sales.length };
}

/* ============================================================
   DEMO MODE  (simulate sales / KOs for the reveal)
   ============================================================ */
const Demo = (() => {
  let extra=[], auto=null, on=false;
  function simulateSale(agent){
    const d=Scenes.data(); if (!d) return;
    const names=d.list.map(a=>a.agent);
    const who = agent || names[(Math.random()*Math.min(names.length,6))|0] || "New Fighter";
    const amt = 120 + Math.random()*650;
    extra.push({ date:d.latestDate, agent:who, premium:amt });
    recompute();
  }
  function simulateKO(){
    // push a big sale to whoever is #2 so they leapfrog #1
    const d=Scenes.data(); if (!d || d.list.length<2) { simulateSale(); return; }
    const challenger=d.list[1], champ=d.list[0];
    const needed=(champ.total - challenger.total) + 50 + Math.random()*200;
    extra.push({ date:d.latestDate, agent:challenger.agent, premium:needed });
    recompute();
  }
  function recompute(){
    const merged = BASE_SALES.concat(extra);
    const d = computeStandings(merged);
    Scenes.update(d); updateTicker(d); detectAndFire(d);
  }
  return {
    sale:(a)=>simulateSale(a),
    ko:()=>simulateKO(),
    toggle(){ on=!on;
      const badge=$("#demoBadge");
      if (on){ if(!badge){ const b=el("div","demo-badge","🎬 DEMO MODE"); b.id="demoBadge"; $("#app").appendChild(b);}
        auto=setInterval(()=> Math.random()<0.65? simulateSale() : simulateKO(), CONFIG.DEMO_AUTO_MS); }
      else { clearInterval(auto); badge?.remove(); }
      return on;
    },
    isOn:()=>on,
  };
})();
let BASE_SALES = [];   // last real data from the sheet (demo builds on top)

/* ============================================================
   POLLING LOOP
   ============================================================ */
async function poll(){
  const pill=$("#statusPill");
  try{
    const sales = await fetchSales();
    BASE_SALES = sales;
    if (Demo.isOn()) return;   // don't stomp the demo's simulated standings while it's running
    const d = computeStandings(sales);
    Scenes.update(d); updateTicker(d); detectAndFire(d);
    pill.textContent = `● live · ${d.teamCount} policies · updated ${new Date().toLocaleTimeString()}`;
    pill.className="status-pill ok";
  }catch(err){
    pill.textContent = "⚠ can't reach sheet — retrying ("+err.message+")";
    pill.className="status-pill err";
  }
}

/* ============================================================
   CLOCK
   ============================================================ */
function tickClock(){ const n=new Date();
  $("#clock").textContent = n.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}

/* ============================================================
   BOOT
   ============================================================ */
function startApp(){
  $("#splash").remove();
  $("#app").classList.remove("hidden");
  FX.init();
  discoverMemes();                             // pick up any user-added memes/
  tickClock(); setInterval(tickClock,1000);
  poll(); setInterval(poll, CONFIG.POLL_MS);   // first poll bootstraps the scenes
}

$("#enterBtn").addEventListener("click", ()=>{
  Sound.unlock(); Sound.bell();
  try{ document.documentElement.requestFullscreen?.(); }catch(e){}
  startApp();
});

/* Splash background embers */
(function splashFx(){
  const c=$("#splashFx"); if(!c) return; const x=c.getContext("2d");
  let w,h,dots=[]; const rs=()=>{ w=c.width=innerWidth; h=c.height=innerHeight; };
  rs(); addEventListener("resize",rs);
  for(let i=0;i<50;i++) dots.push({x:Math.random()*w,y:Math.random()*h,r:1+Math.random()*2,v:.2+Math.random()*.8,hue:20+Math.random()*30});
  (function l(){ if(!document.body.contains(c)) return; x.clearRect(0,0,w,h);
    for(const d of dots){ d.y-=d.v; if(d.y<0){d.y=h;d.x=Math.random()*w;}
      x.beginPath(); x.fillStyle=`hsla(${d.hue} 100% 55% / .6)`; x.shadowColor=x.fillStyle; x.shadowBlur=10; x.arc(d.x,d.y,d.r,0,7); x.fill(); }
    x.shadowBlur=0; requestAnimationFrame(l); })();
})();

/* ============================================================
   KEYBOARD CONTROLS
   ============================================================ */
addEventListener("keydown",(e)=>{
  const help=$("#help");
  if (!help.classList.contains("hidden")){ help.classList.add("hidden"); return; }
  switch(e.key.toLowerCase()){
    case "s": Demo.sale(); break;
    case "k": Demo.ko(); break;
    case "d": { const on=Demo.toggle(); $("#statusPill").textContent = on?"🎬 demo mode ON":"● live"; } break;
    case "r": poll(); break;
    case "n": Scenes.next(); break;
    case "f": document.fullscreenElement? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
    case "m": { const muted=Sound.toggleMute(); $("#statusPill").textContent = muted?"🔇 muted":"🔊 sound on"; } break;
    case "h": case "?": help.classList.toggle("hidden"); break;
  }
});
