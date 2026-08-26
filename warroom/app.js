/* ============================================================
   THE WAR ROOM — weekly fight stats grid
   Companion to THE OCTAGON. Same Google Sheet, same memes.
   ============================================================ */

const CONFIG = {
  SHEET_ID: "1h5B_KDge0e-SYI9LfjkFPXgxDLZAsFpL_O2bsbjAfog",
  GID: "416393424",
  POLL_MS: 5000,      // how often to re-check the sheet
  MEME_MS: 10000,     // meme takeover duration per deal
};

/* ---------- bonus structure ----------
   Daily premium tiers (highest reached wins, per agent per day):
     $800 → $100 · $1400 → $200 · $2200 → $500
   Plus every single deal over $500 = extra $100. */
const BONUS_TIERS = [ {min:800,bonus:100}, {min:1400,bonus:200}, {min:2200,bonus:500} ];
const BIG_DEAL_MIN = 500, BIG_DEAL_BONUS = 100;
function tierLevel(sum){ let l=0; BONUS_TIERS.forEach((t,i)=>{ if (sum>=t.min) l=i+1; }); return l; }
function tierBonus(level){ return level? BONUS_TIERS[level-1].bonus : 0; }

const $ = (s)=>document.querySelector(s);
function el(tag, cls, html){ const d=document.createElement(tag); if(cls) d.className=cls; if(html!=null) d.innerHTML=html; return d; }
const money  = (n)=>"$"+Math.round(n).toLocaleString("en-US");
const money2 = (n)=>"$"+n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

/* ---------- nicknames (keep in sync with ../app.js) ---------- */
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
const AGENT_COLORS = ["#e10600","#0077ff","#8a2be2","#0aa574","#ff7a00","#c2185b","#00838f","#5d4037","#37474f","#7b1fa2"];
function agentColor(name){ let h=0; for (const c of name) h=(h*31+c.charCodeAt(0))%AGENT_COLORS.length; return AGENT_COLORS[h]; }
const initials = (name)=>name.split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();

/* ============================================================
   SOUND — tiny WebAudio synth (no files)
   ============================================================ */
const Sound = (()=>{
  let ctx, master, muted=false;
  function init(){
    ctx = new (window.AudioContext||window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value=0.9; master.connect(ctx.destination);
  }
  function tone(freq, dur, type="sawtooth", vol=0.3, slideTo){
    if (!ctx || muted) return;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.type=type; o.frequency.value=freq;
    if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, ctx.currentTime+dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime+dur);
  }
  function noise(dur, vol=0.3){
    if (!ctx || muted) return;
    const len=ctx.sampleRate*dur, buf=ctx.createBuffer(1,len,ctx.sampleRate), d=buf.getChannelData(0);
    for (let i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    const s=ctx.createBufferSource(); s.buffer=buf;
    const g=ctx.createGain(); g.gain.value=vol;
    s.connect(g); g.connect(master); s.start();
  }
  return {
    init,
    airhorn(){ tone(392,0.9,"sawtooth",0.35); tone(394,0.9,"square",0.18); setTimeout(()=>tone(392,0.5,"sawtooth",0.3,415),350); },
    cash(){ noise(0.12,0.25); setTimeout(()=>{ tone(1567,0.18,"sine",0.3); tone(2093,0.25,"sine",0.25); },60); },
    bell(){ tone(880,1.4,"sine",0.4); tone(1320,1.1,"sine",0.2); tone(660,1.6,"triangle",0.25); },
    toggleMute(){ muted=!muted; if (master) master.gain.value = muted?0:0.9; return muted; },
    isMuted(){ return muted; },
  };
})();

/* ============================================================
   AMBIENT FX — rising embers (same flame effect as the Octagon)
   + emojis that randomly fly around the screen
   ============================================================ */
const FX = (()=>{
  let cv, cx, W, H, embers=[];
  function size(){ if (!cv) return; cv.width=W=innerWidth; cv.height=H=innerHeight; }
  function newEmber(){ return { x:Math.random()*W, y:H+Math.random()*H, r:1+Math.random()*3,
    vy:-(0.3+Math.random()*1.1), vx:(Math.random()-0.5)*0.4, hue:20+Math.random()*30, a:0.3+Math.random()*0.5 }; }
  function loop(){
    cx.clearRect(0,0,W,H);
    for (const e of embers){ e.x+=e.vx; e.y+=e.vy; if (e.y<-10) Object.assign(e,newEmber());
      cx.beginPath(); cx.fillStyle=`hsla(${e.hue} 100% 55% / ${e.a})`;
      cx.shadowColor=cx.fillStyle; cx.shadowBlur=8; cx.arc(e.x,e.y,e.r,0,7); cx.fill(); }
    cx.shadowBlur=0;
    requestAnimationFrame(loop);
  }

  const FLYERS=["🚀","🥊","💰","💪","🔥","💎","🤑","👑","⚡","🏆","💵","🦍"];
  function fly(){
    const layer=$("#emojiFx");
    if (!layer) return;
    const emo=FLYERS[(Math.random()*FLYERS.length)|0];
    const d=el("div","fly",emo);
    d.style.fontSize=(32+Math.random()*34)+"px";
    layer.appendChild(d);
    const dur=6000+Math.random()*6000;
    let frames;
    if (emo==="🚀"){                       // launch: bottom-left → top-right
      const y0=H*(0.55+Math.random()*0.4), y1=H*(0.05+Math.random()*0.3);
      frames=[{transform:`translate(-80px,${y0}px)`,opacity:0},
              {transform:`translate(${W*0.3}px,${y0-(y0-y1)*0.4}px)`,opacity:.95,offset:.25},
              {transform:`translate(${W+100}px,${y1}px)`,opacity:0}];
    } else if (emo==="🥊"){                // punch straight across with a bob
      const y=H*(0.15+Math.random()*0.7), fromLeft=Math.random()<0.5;
      const x0=fromLeft?-80:W+80, x1=fromLeft?W+100:-100;
      frames=[{transform:`translate(${x0}px,${y}px) rotate(0deg)`,opacity:0},
              {transform:`translate(${(x0+x1)/2}px,${y-44}px) rotate(${fromLeft?18:-18}deg)`,opacity:.95,offset:.5},
              {transform:`translate(${x1}px,${y}px) rotate(0deg)`,opacity:0}];
    } else {                               // float up with sway + spin
      const x=W*(0.05+Math.random()*0.9), sway=(Math.random()-0.5)*180, rot=(Math.random()-0.5)*90;
      frames=[{transform:`translate(${x}px,${H+70}px) rotate(0deg)`,opacity:0},
              {transform:`translate(${x+sway}px,${H*0.5}px) rotate(${rot/2}deg)`,opacity:.95,offset:.5},
              {transform:`translate(${x-sway*0.5}px,-90px) rotate(${rot}deg)`,opacity:0}];
    }
    d.animate(frames,{duration:dur,easing:"linear"}).onfinish=()=>d.remove();
    setTimeout(()=>d.remove(), dur+1000);              // guaranteed cleanup even if the animation stalls
    while (layer.children.length>16) layer.firstChild.remove();  // hard cap, TV runs all day
  }

  function init(){
    cv=$("#bgFx"); cx=cv.getContext("2d");
    size(); addEventListener("resize", size);
    for (let i=0;i<55;i++) embers.push(newEmber());
    requestAnimationFrame(loop);
    setInterval(()=>{ fly(); if (Math.random()<0.35) setTimeout(fly, 700); }, 3000);  // ~1-2 flyers every 3s
  }
  return { init };
})();

/* ============================================================
   MEMES — shared with the champions board (../memes/)
   ============================================================ */
const MEME_LINES = ["ANOTHER ONE 🗿","MONEY PRINTER GO BRRR","STONE COLD LOCK","GET THAT BAG 💼","BUILT DIFFERENT",
  "CERTIFIED CLOSER","LIGHTS OUT 💡","TOO EASY","HE'S ON FIRE 🔥","NEW MONEY WHO DIS","ABSOLUTE UNIT","LET'S GOOO",
  "SHEEEESH","PAY THE MAN","GG NO RE"];
const SALE_EMOJI = ["🚀","💵","🔥","💎","🤑","💪","🦍","👑","⚡","🎯","🏆","🥂"];
const PACK_CAPTIONS = {
  "stonks.jpg":"STONKS 📈", "success-kid.jpg":"NAILED IT.", "leo-cheers.jpg":"CHEERS TO THE CLOSER 🥂",
  "laughing-leo.png":"THE COMPETITION RIGHT NOW", "drake-yes.jpg":"CLOSING > PROSPECTING",
  "epic-handshake.jpg":"AGENT 🤝 COMMISSION", "oprah-you-get.jpg":"YOU GET A POLICY! EVERYBODY GETS A POLICY!",
  "buff-doge.png":"BUILT DIFFERENT 💪", "getting-paid.png":"YOU GUYS ARE GETTING PAID?",
  "absolute-cinema.png":"ABSOLUTE CINEMA 🎬", "tuxedo-pooh.png":"A GENTLEMAN'S CLOSE 🎩",
  "roll-safe.jpg":"CAN'T LOSE A DEAL IF YOU NEVER STOP CLOSING", "pikachu.jpg":"THE OTHER AGENCIES RN:",
  "disaster-girl.jpg":"THE COMPETITION'S PIPELINE:", "more-of-that.jpg":"Y'ALL GOT ANY MORE OF THEM POLICIES?",
};
const VIDEO_RE = /\.(mp4|webm|mov)$/i;
let MEMES = [];
let lastMeme = -1;
function pickMeme(){
  if (!MEMES.length) return null;
  let i; do { i=(Math.random()*MEMES.length)|0; } while (MEMES.length>1 && i===lastMeme);
  lastMeme=i; return MEMES[i];
}
async function discoverMemes(){
  try{
    const res = await fetch("../memes/manifest.json", {cache:"no-store"});
    if (res.ok){
      (await res.json()).forEach(name=>{
        const base = name.split("/").pop();
        MEMES.push({ src:"../memes/"+base, cap: PACK_CAPTIONS[base] || MEME_LINES[(Math.random()*MEME_LINES.length)|0] });
      });
    }
  }catch(e){ /* emoji fallback still works */ }
  // prune anything unloadable
  const checks = await Promise.all(MEMES.map(m=>new Promise(res=>{
    if (VIDEO_RE.test(m.src)){
      const v=document.createElement("video");
      v.onloadedmetadata=()=>res(v.videoWidth>0 ? m : null);
      v.onerror=()=>res(null); v.muted=true; v.preload="metadata"; v.src=m.src;
      setTimeout(()=>res(null), 8000);
    } else {
      const i=new Image(); i.onload=()=>res(m); i.onerror=()=>res(null); i.src=m.src;
    }
  })));
  MEMES = checks.filter(Boolean);
}

/* ============================================================
   DATA — fetch sheet, aggregate per agent per day
   ============================================================ */
function parseMDY(s){
  const m = String(s||"").split("/");
  return m.length===3 ? new Date(+m[2], +m[0]-1, +m[1]).getTime() : 0;
}
function parseCSV(text){
  return text.trim().split(/\r?\n/).map(line=>[...line.matchAll(/"([^"]*)"/g)].map(x=>x[1]));
}
/* Primary source: HighLevel via the ccg-sales-feed Cloudflare Worker (same
   quoted-CSV shape as the sheet). The sheet stays as an automatic fallback. */
const FEED_URL = () =>
  `https://ccg-sales-feed.adamgelvaninsurance.workers.dev/?_=${Date.now()}`;

async function fetchBoardCSV(){
  try {
    const r = await fetch(FEED_URL(), {cache:"no-store"});
    if (r.ok) return await r.text();
  } catch (e) { /* feed down — fall through to the sheet */ }
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&gid=${CONFIG.GID}&t=${Date.now()}`;
  const res = await fetch(url, {cache:"no-store"});
  if (!res.ok) throw new Error("HTTP "+res.status);
  return await res.text();
}

async function fetchSales(){
  const rows = parseCSV(await fetchBoardCSV());
  return rows.slice(1)
    .filter(r=>r[0] && r[1] && r[2])
    .map(r=>({ date:r[0].trim(), agent:r[1].trim(), premium:parseFloat(r[2].replace(/[$,]/g,"")) }))
    .filter(s=>s.agent && isFinite(s.premium) && s.premium>0 && parseMDY(s.date)>0);
}

/* ---------- TIME MACHINE ----------
   ?week=8/3  (or 8/3/2026, or 2026-08-03) pins the board to that week.
   ← / → step weeks · Home or ?week= cleared returns to live. */
const MONDAY = (ts)=>{ const d=new Date(ts); return ts - ((d.getDay()+6)%7)*86400000; };
function parseWeekParam(v){
  if (!v) return 0;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);            // 2026-08-03
  if (m) return MONDAY(new Date(+m[1],+m[2]-1,+m[3]).getTime());
  m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);         // 8/3 or 8/3/2026
  if (m) return MONDAY(new Date(m[3]? +m[3] : new Date().getFullYear(), +m[1]-1, +m[2]).getTime());
  return 0;
}
let timeMachine = parseWeekParam(new URLSearchParams(location.search).get("week"));
function setWeek(ts){                     // ts=0 → back to live
  timeMachine = ts;
  const u = new URL(location.href);
  if (ts){ const d=new Date(ts); u.searchParams.set("week", (d.getMonth()+1)+"/"+d.getDate()+"/"+d.getFullYear()); }
  else u.searchParams.delete("week");
  history.replaceState(null,"",u);
  poll();
}

const DAY_NAMES = ["MON","TUE","WED","THU","FRI","SAT","SUN"];
function computeWeek(sales){
  const latestTs = sales.reduce((a,s)=>Math.max(a,parseMDY(s.date)), 0);
  const weekStart = timeMachine || MONDAY(latestTs);
  const days = Array.from({length:7},(_,i)=>{
    const d=new Date(weekStart+i*86400000);
    return { name:DAY_NAMES[i], label:(d.getMonth()+1)+"/"+d.getDate(), ts:weekStart+i*86400000 };
  });
  const dayIndex = (s)=>{ const t=parseMDY(s.date); const i=Math.floor((t-weekStart)/86400000); return (i>=0&&i<7)? i : -1; };

  const map = new Map();
  for (const s of sales){
    if (!map.has(s.agent)) map.set(s.agent, { agent:s.agent,
      perDay:Array.from({length:7},()=>({count:0,sum:0})), weekTotal:0, weekCount:0, bigDeals:0 });
    const a = map.get(s.agent);
    const di = dayIndex(s);
    if (di>=0){
      a.perDay[di].count++; a.perDay[di].sum+=s.premium; a.weekTotal+=s.premium; a.weekCount++;
      if (s.premium>BIG_DEAL_MIN) a.bigDeals++;
    }
  }
  const agents=[...map.values()].sort((x,y)=> y.weekTotal-x.weekTotal || y.weekCount-x.weekCount);
  // weekly bonus: daily tier bonuses + $100 per big deal
  for (const a of agents)
    a.bonus = a.perDay.reduce((s,d)=>s+tierBonus(tierLevel(d.sum)),0) + a.bigDeals*BIG_DEAL_BONUS;
  const team={ perDay:Array.from({length:7},()=>({count:0,sum:0})), weekTotal:0, weekCount:0 };
  for (const a of agents) a.perDay.forEach((d,i)=>{ team.perDay[i].count+=d.count; team.perDay[i].sum+=d.sum; });
  team.weekTotal = agents.reduce((s,a)=>s+a.weekTotal,0);
  team.weekCount = agents.reduce((s,a)=>s+a.weekCount,0);
  const todayIdx = Math.floor((latestTs-weekStart)/86400000);
  return { agents, team, days, todayIdx, weekStart };
}

/* ============================================================
   RENDER — the grid
   ============================================================ */
function render(w){
  const grid=$("#grid");
  grid.innerHTML="";
  const SHOW_DAYS = 5;   // Mon–Fri only (weekend sales still count in week totals)
  grid.style.gridTemplateColumns = `minmax(240px,1.8fr) repeat(${SHOW_DAYS}, 1fr) 1.2fr 1.2fr`;

  // header row
  const hName=el("div","gcell ghead gname-h",`<div class="d-name">FIGHTER</div><div class="d-date">WEEK OF ${w.days[0].label}</div>`);
  grid.appendChild(hName);
  w.days.slice(0,SHOW_DAYS).forEach((d,i)=>{
    grid.appendChild(el("div",`gcell ghead${i===w.todayIdx?" today":""}`,
      `<div class="d-name">${d.name}${i===w.todayIdx?" 🔴":""}</div><div class="d-date">${d.label}</div>`));
  });
  grid.appendChild(el("div","gcell ghead metric",`<div class="d-name">WEEK TOTAL</div><div class="d-date">PREMIUM</div>`));
  grid.appendChild(el("div","gcell ghead metric",`<div class="d-name">WEEK AVG</div><div class="d-date">PER DEAL</div>`));

  // agent rows
  w.agents.forEach((a,idx)=>{
    const rowCls = `grow-${idx+1}`;
    const name=el("div",`gcell gname`,"");
    const av=el("div","avatar",initials(a.agent));
    av.style.background=`radial-gradient(circle at 30% 25%, rgba(255,255,255,.25), ${agentColor(a.agent)})`;
    name.appendChild(av);
    name.appendChild(el("div","nm",`<b>"${nickname(a.agent)}"</b><i>${a.agent}</i>`));
    if (idx===0) name.appendChild(el("div","champ-belt","🏆"));
    name.appendChild(el("div","bonus",`<b>$${a.bonus.toLocaleString("en-US")}</b><span>BONUS</span>`));
    name.classList.add(rowCls); grid.appendChild(wrapRow(name,rowCls));

    a.perDay.slice(0,SHOW_DAYS).forEach((d,i)=>{
      const cls=["gcell","gday"];
      if (d.sum===0) cls.push("zero");
      if (i===w.todayIdx) cls.push("today-col");
      const tl=tierLevel(d.sum);
      if (tl) cls.push("t"+tl);   // t1 $800+ gold · t2 $1400+ blue · t3 $2200+ green
      grid.appendChild(wrapRow(el("div",cls.join(" "),
        d.sum===0? `<div class="amt">—</div>`
                 : `<div class="amt">${money(d.sum)}</div><div class="ct"><b>${d.count}</b> DEAL${d.count>1?"S":""}</div>`),rowCls));
    });
    grid.appendChild(wrapRow(el("div","gcell gtotal",
      `<div class="amt">${money(a.weekTotal)}</div><div class="ct"><b>${a.weekCount}</b> DEALS</div>`),rowCls));
    grid.appendChild(wrapRow(el("div","gcell gtotal gavg",
      `<div class="amt">${a.weekCount? money2(a.weekTotal/a.weekCount) : "—"}</div><div class="ct">AVG / DEAL</div>`),rowCls));
  });

  // team row
  grid.appendChild(el("div","gcell gname gteam",`<div class="nm"><b>TEAM</b><i>ALL FIGHTERS</i></div>`));
  w.team.perDay.slice(0,SHOW_DAYS).forEach((d,i)=>{
    grid.appendChild(el("div",`gcell gday gteam${i===w.todayIdx?" today-col":""}`,
      d.sum===0? `<div class="amt">—</div>`
               : `<div class="amt">${money(d.sum)}</div><div class="ct"><b>${d.count}</b> DEALS</div>`));
  });
  grid.appendChild(el("div","gcell gtotal gteam",
    `<div class="amt">${money(w.team.weekTotal)}</div><div class="ct"><b>${w.team.weekCount}</b> DEALS</div>`));
  grid.appendChild(el("div","gcell gtotal gavg gteam",
    `<div class="amt">${w.team.weekCount? money2(w.team.weekTotal/w.team.weekCount):"—"}</div><div class="ct">AVG / DEAL</div>`));

  $("#weekTag").textContent = `WEEK OF ${w.days[0].label}`;
  // time machine banner
  const tm=$("#tmBanner");
  if (timeMachine){
    tm.innerHTML = `🕰️ TIME MACHINE · WEEK OF ${w.days[0].label} <span>← → CHANGE WEEK · HOME = LIVE</span>`;
    tm.classList.remove("hidden");
  } else tm.classList.add("hidden");
}
function wrapRow(cell,cls){ cell.classList.add(cls); return cell; }

/* ---------- newswire ticker: today's deals on rotation ---------- */
let tickerSig="";
function updateTicker(todaySales, w){
  const items=[];
  todaySales.forEach(s=>items.push(
    `<span class="ti">🚀 <b>"${nickname(s.agent)}"</b> <span class="nm">${s.agent.toUpperCase()}</span> CLOSED <span class="amt">${money2(s.premium)}/MO</span></span>`));
  const td=w.team.perDay[w.todayIdx];
  if (td && td.count>0) items.push(
    `<span class="ti">💰 TEAM TODAY: <span class="amt">${money(td.sum)}</span> · <b>${td.count} DEALS</b></span>`);
  if (w.agents[0]) items.push(
    `<span class="ti">🏆 <b>"${nickname(w.agents[0].agent)}"</b> LEADS THE WEEK AT <span class="amt">${money(w.agents[0].weekTotal)}</span></span>`);
  if (!items.length) items.push(`<span class="ti">🔔 NO FIGHTS YET TODAY — FIRST DEAL TAKES THE HEADLINE</span>`);
  // pad short lists so the loop is seamless, then double for the -50% scroll
  let base=[...items]; while (base.length<6) base=base.concat(items);
  const html=[...base, ...base].join("");
  if (html!==tickerSig){ tickerSig=html; $("#tickerTrack").innerHTML=html; }  // don't restart the scroll on every poll
}

/* ============================================================
   MEME TAKEOVER — 10s per deal, queued
   ============================================================ */
const BONUS_LINES = ["PAY THE MAN 💰","CHA-CHING! BONUS TIME","STACKING PAPER","EXTRA CHEESE 🧀",
  "THE BAG IS SECURED 💼","BONUS ROUND!","MONEY IN THE BANK 🏦","DING DING DING 🎰","GET YOUR MONEY UP"];
const memeQ=[]; let memeBusy=false;
function queueMeme(agent, amount){ memeQ.push({type:"deal", agent, amount}); pumpMemes(); }
function queueBonus(agent, amount, label){ memeQ.push({type:"bonus", agent, amount, label}); pumpMemes(); }
function pumpMemes(){
  if (memeBusy || !memeQ.length) return;
  memeBusy=true;
  const {type, agent, amount, label}=memeQ.shift();
  const isBonus = type==="bonus";
  if (isBonus){ Sound.bell(); setTimeout(()=>Sound.cash(),200); setTimeout(()=>Sound.cash(),450); }
  else { Sound.airhorn(); setTimeout(()=>Sound.cash(),150); }

  const meme=pickMeme();
  const isVid = meme && VIDEO_RE.test(meme.src);
  const line = isBonus ? BONUS_LINES[(Math.random()*BONUS_LINES.length)|0]
             : meme? meme.cap : MEME_LINES[(Math.random()*MEME_LINES.length)|0];
  const media = !meme ? `<div class="emoji">${SALE_EMOJI[(Math.random()*SALE_EMOJI.length)|0]}</div>`
    : isVid ? `<video class="media" src="${meme.src}" autoplay loop playsinline></video>`
            : `<img class="media" src="${meme.src}" alt="" />`;
  const layer=$("#memeLayer");
  layer.innerHTML=`
    <div class="meme-card${isBonus?" bonus-card":""}">
      <div class="kick">${isBonus? "🎰 "+label : "💰 DEAL SUBMITTED"}</div>
      ${media}
      <div class="who">${agent}</div>
      <div class="amt">${isBonus? "+$"+amount.toLocaleString("en-US")+" BONUS" : "+"+money2(amount)+"/mo"}</div>
      <div class="line">${line}</div>
      <div class="bar"><i></i></div>
    </div>`;
  const med=layer.querySelector(".media");
  if (med){
    med.onerror=()=>{ med.outerHTML=`<div class="emoji">${SALE_EMOJI[(Math.random()*SALE_EMOJI.length)|0]}</div>`; };
    if (isVid) med.muted = Sound.isMuted();
  }
  layer.classList.remove("hidden");
  setTimeout(()=>{
    layer.classList.add("hidden"); layer.innerHTML="";
    memeBusy=false; setTimeout(pumpMemes, 400);   // back to the leaderboard, next in queue if any
  }, CONFIG.MEME_MS);
}

/* ============================================================
   POLL + DIFF — detect newly submitted deals
   ============================================================ */
let seen=null;   // Map key -> count
let tiers=null;  // Map "agent|dayIdx" -> tier level, for bonus-crossing detection
let lastLatestTs=Date.now();  // newest deal date seen, anchors the "live" week
let lastGoodPoll=0;           // for gap detection — see poll()
const keyOf=(s)=>`${s.date}|${s.agent}|${s.premium}`;
const GAP_MS=Math.max(CONFIG.POLL_MS*4, 120000);  // no successful poll for this long = dead time
const MAX_LIVE_BURST=3;       // >3 "new" deals in one poll = catch-up backlog, not live sales
async function poll(){
  try{
    const sales = await fetchSales();
    const w = computeWeek(sales);
    render(w);
    const latestTs = sales.reduce((a,s)=>Math.max(a,parseMDY(s.date)), 0);
    lastLatestTs = latestTs;
    updateTicker(sales.filter(s=>parseMDY(s.date)===latestTs).reverse(), w);  // newest first
    const counts=new Map();
    for (const s of sales) counts.set(keyOf(s), (counts.get(keyOf(s))||0)+1);
    // Only celebrate LIVE sales: after dead time (sleep, throttled tab, feed
    // outage) the diff would replay every sale from the gap — rebase silently
    // instead. A 4+ deal burst in one 15s poll is a backlog too, never live.
    const now=Date.now();
    const wasGap = !lastGoodPoll || (now-lastGoodPoll) > GAP_MS;
    lastGoodPoll = now;
    if (seen && !wasGap){
      const pending=[];
      for (const s of sales){
        const k=keyOf(s);
        const extra=(counts.get(k)||0)-(seen.get(k)||0);
        if (extra>0){
          for (let i=0;i<extra;i++) pending.push(s);
          seen.set(k, counts.get(k));    // don't double-fire on repeated iteration
        }
      }
      if (pending.length<=MAX_LIVE_BURST){
        for (const s of pending){
          queueMeme(s.agent, s.premium);
          if (s.premium>BIG_DEAL_MIN) queueBonus(s.agent, BIG_DEAL_BONUS, "BIG DEAL BONUS");  // deal over $500
        }
      }
    }
    seen=counts;
    // daily tier crossings ($800/$1400/$2200) → bonus animation
    const newTiers=new Map();
    for (const a of w.agents) a.perDay.forEach((d,i)=>newTiers.set(a.agent+"|"+i, tierLevel(d.sum)));
    if (tiers && !timeMachine && !wasGap){   // never celebrate a past week's numbers, nor a catch-up gap
      for (const [k,lvl] of newTiers){
        if (lvl > (tiers.get(k)||0))
          queueBonus(k.split("|")[0], tierBonus(lvl), "DAILY BONUS UNLOCKED");
      }
    }
    tiers = timeMachine ? null : newTiers;   // rebuild baseline on return to live
    const pill=$("#statusPill");
    pill.textContent=`● live · ${sales.length} deals on the books · ${new Date().toLocaleTimeString()}`;
    pill.className="status-pill ok";
  }catch(e){
    const pill=$("#statusPill");
    pill.textContent="⚠ can't reach the sheet — retrying…";
    pill.className="status-pill err";
  }
}

/* ============================================================
   BOOT
   ============================================================ */
function tickClock(){ $("#clock").textContent=new Date().toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"}); }
function startApp(){
  Sound.init();
  $("#splash").remove();
  $("#app").classList.remove("hidden");
  FX.init();
  discoverMemes();
  tickClock(); setInterval(tickClock,1000);
  poll(); setInterval(poll, CONFIG.POLL_MS);
  document.documentElement.requestFullscreen?.().catch(()=>{});
}
$("#enterBtn").addEventListener("click", startApp);

document.addEventListener("keydown",(e)=>{
  switch(e.key.toLowerCase()){
    case "s": {  // test deal
      const names=Object.keys(AGENT_NICKNAMES);
      queueMeme(names[(Math.random()*names.length)|0], 150+Math.random()*500);
    } break;
    case "b": {  // test bonus
      const names=Object.keys(AGENT_NICKNAMES);
      const tier=BONUS_TIERS[(Math.random()*BONUS_TIERS.length)|0];
      queueBonus(names[(Math.random()*names.length)|0], tier.bonus, Math.random()<0.5? "DAILY BONUS UNLOCKED":"BIG DEAL BONUS");
    } break;
    case "m": { const m=Sound.toggleMute(); $("#statusPill").textContent = m?"🔇 muted":"🔊 sound on"; } break;
    case "f": document.fullscreenElement? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); break;
    case "r": poll(); break;
    // ---- time machine ----
    case "arrowleft":  setWeek((timeMachine || MONDAY(lastLatestTs)) - 7*86400000); break;
    case "arrowright": {
      const next=(timeMachine || MONDAY(lastLatestTs)) + 7*86400000;
      setWeek(next > MONDAY(lastLatestTs) ? 0 : next);   // past the live week → back to live
    } break;
    case "home": case "escape": setWeek(0); break;
  }
});
