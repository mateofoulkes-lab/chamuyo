import * as api from "./connector.js";

const $ = (s, r=document) => r.querySelector(s);
const root = $("#viewRoot");
const pillStatus = $("#pillStatus");
const pillRoom = $("#pillRoom");
const roomCodeEl = $("#roomCode");
const subtitle = $("#subtitle");
const deckCorner = $("#deckCorner");
const toastEl = $("#toast");
const debugEnabled = new URLSearchParams(window.location.search).get("debug") === "1";

const debug = (() => {
  if(!debugEnabled){
    return { enabled:false, log(){}, set(){}, listMethods(){}, section(){} };
  }

  const panel = document.createElement("div");
  panel.id = "debugPanel";
  panel.innerHTML = `
    <div class="debug-header">Debug activo</div>
    <div class="debug-meta" id="debugMeta"></div>
    <div class="debug-log" id="debugLog"></div>
  `;
  document.body.appendChild(panel);

  const meta = panel.querySelector("#debugMeta");
  const logEl = panel.querySelector("#debugLog");

  function log(msg){
    const line = document.createElement("div");
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    logEl.appendChild(line);
  }

  function set(key, value){
    const row = document.createElement("div");
    row.className = "debug-row";
    row.innerHTML = `<span>${key}</span><strong>${value}</strong>`;
    meta.appendChild(row);
  }

  function listMethods(obj, keys){
    const items = keys.map((k)=> `${k}:${typeof obj[k] === "function" ? "ok" : "missing"}`);
    set("Conector", items.join(" · "));
  }

  function section(title){
    const row = document.createElement("div");
    row.className = "debug-section";
    row.textContent = title;
    logEl.appendChild(row);
  }

  set("URL", window.location.href);
  return { enabled:true, log, set, listMethods, section };
})();

function debugClick(label){
  if(debug.enabled) debug.log(`click: ${label}`);
}

window.addEventListener("error", (event)=>{
  if(!debug.enabled) return;
  debug.log(`error: ${event.message || "Error"}`);
});

window.addEventListener("unhandledrejection", (event)=>{
  if(!debug.enabled) return;
  const reason = event.reason?.message || String(event.reason || "Unhandled rejection");
  debug.log(`unhandled: ${reason}`);
});

const store = {
  me: null,      // { token, name, code, isHost }
  room: null,    // roomState
  hand: [],
  decks: [],
  selectedDeckId: "classic",
};

function setStatus(t){ pillStatus.textContent = t; }
function showRoom(code){
  roomCodeEl.textContent = code;
  pillRoom.style.display = code ? "" : "none";
}
function toast(msg){
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(()=>toastEl.classList.remove("show"), 1700);
}

function h(tag, attrs={}, children=[]){
  const el = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==="class") el.className = v;
    else if(k.startsWith("on") && typeof v==="function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if(v===false || v==null) {}
    else el.setAttribute(k, String(v));
  }
  for(const c of ([]).concat(children)){
    if(c==null) continue;
    el.appendChild(typeof c==="string" ? document.createTextNode(c) : c);
  }
  return el;
}

function route(to, params={}){
  history.pushState({to, params}, "", to === "home" ? "./" : `#${to}`);
  render();
}

window.addEventListener("popstate", render);
window.addEventListener("hashchange", render);

async function safeCall(fn){
  try{
    setStatus("Cargando…");
    const r = await fn();
    setStatus("Listo");
    return r;
  }catch(e){
    setStatus("Error");
    toast(e.message || String(e));
    console.error(e);
    return null;
  }
}

// ===== Modal (card) =====
const modal = {
  el: $("#cardModal"),
  sheet: $("#cmSheet"),
  text: $("#cmText"),
  btnS: $("#cmSuccess"),
  btnF: $("#cmFail"),
  btnC: $("#cmClose"),
  current: null, // {cardId, phrase}
};

function modalOpen(card){
  modal.current = card;
  modal.text.textContent = card.phrase;

  // set "from deck" animation vars
  const deck = deckCorner.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // translate from deck center to modal center
  const fromX = deck.left + deck.width/2;
  const fromY = deck.top + deck.height/2;
  const centerX = vw/2;
  const centerY = vh/2;

  const tx = fromX - centerX;
  const ty = fromY - centerY;

  modal.sheet.style.setProperty("--from-tx", `${tx}px`);
  modal.sheet.style.setProperty("--from-ty", `${ty}px`);
  modal.sheet.style.setProperty("--from-x", `${fromX}px`);
  modal.sheet.style.setProperty("--from-y", `${fromY}px`);

  modal.sheet.classList.add("cm-fly");
  modal.el.classList.remove("cm-hidden");
  document.documentElement.style.overflow = "hidden";

  // trigger
  requestAnimationFrame(()=>{
    modal.sheet.classList.add("cm-fly-in");
  });
}

function modalClose(){
  modal.el.classList.add("cm-hidden");
  document.documentElement.style.overflow = "";
  modal.sheet.classList.remove("cm-fly","cm-fly-in");
  modal.current = null;
}
modal.el.addEventListener("click", (e)=>{
  if(e.target?.dataset?.close) modalClose();
});
modal.btnC.addEventListener("click", modalClose);
window.addEventListener("keydown", (e)=>{
  if(e.key==="Escape" && !modal.el.classList.contains("cm-hidden")) modalClose();
});

function setModalBusy(b){
  modal.btnS.disabled = b;
  modal.btnF.disabled = b;
  modal.btnC.disabled = b;
}

// ===== Views =====

function viewHome(){
  showRoom("");
  deckCorner.style.display = "none";
  subtitle.textContent = "Party game · versión mock";

  const box = h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("div",{class:"grid2"},[
        h("button",{class:"btnBig", onClick: ()=>{
          debugClick("crear juego");
          route("create");
        }},["CREAR JUEGO"]),
        h("button",{class:"btnBig secondary", onClick: ()=>{
          debugClick("unirse a juego");
          route("join");
        }},["UNIRSE A JUEGO"]),
        h("button",{class:"btnBig ghost", onClick: ()=>{
          debugClick("como jugar");
          rulesPopup();
        }},["¿CÓMO JUGAR?"])
      ])
    ])
  ]);
  return box;
}

function rulesPopup(){
  alert(
`Chamuyo (reglas rápidas):
- Te repartís 5 cartas con frases.
- Tenés que decirlas en la charla sin que se note.
- Si pasan 30s sin que te descubran: "era chamuyo" → éxito.
- Si te acusan y era tu carta: descubierta.
- Si te acusan y NO era tu carta: acusación falsa → penalización.
(En la versión final, el servidor valida todo.)`
  );
}

async function viewJoin(){
  showRoom("");
  deckCorner.style.display = "none";
  subtitle.textContent = "Unirse a juego";

  const name = h("input",{class:"input", placeholder:"Tu nombre", value: localStorage.getItem("chamuyo_name")||""});
  const code = h("input",{class:"input", placeholder:"Código (ej: ABC123)", autocapitalize:"characters"});
  const btn  = h("button",{class:"btnBig secondary"},["ENTRAR"]);

  btn.addEventListener("click", async ()=>{
    debugClick("entrar");
    const n = name.value.trim();
    const c = code.value.trim();
    if(!n || !c) return toast("Completá nombre y código");
    localStorage.setItem("chamuyo_name", n);

    const r = await safeCall(()=>api.joinRoom(c,n));
    if(!r) return;

    store.me = { token:r.playerToken, name:n, code:r.roomCode, isHost:false };
    localStorage.setItem("chamuyo_token", r.playerToken);
    localStorage.setItem("chamuyo_code", r.roomCode);
    route("lobby");
  });

  return h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["Unirse a juego"]),
      h("div",{class:"formRow"},[
        h("div",{},[h("div",{class:"label"},["NOMBRE"]), name]),
        h("div",{},[h("div",{class:"label"},["CÓDIGO DE JUEGO"]), code]),
        btn,
        h("button",{class:"btnBig ghost", onClick: ()=>{
          debugClick("volver");
          route("home");
        }},["VOLVER"])
      ])
    ])
  ]);
}

async function viewCreate(){
  showRoom("");
  deckCorner.style.display = "none";
  subtitle.textContent = "Crear juego";

  if(store.decks.length===0){
    const r = await safeCall(()=>api.listDecks?.() || ({ok:true,decks:[{id:"classic",title:"Chamuyo Clásico",subtitle:""}]}));
    if(r?.ok) store.decks = r.decks;
  }

  const name = h("input",{class:"input", placeholder:"Tu nombre (host)", value: localStorage.getItem("chamuyo_name")||""});
  const deckBtn = h("button",{class:"btnBig ghost"},["SELECCIONAR MAZO"]);
  const deckLabel = h("div",{class:"sub"},[`Mazo seleccionado: `, h("strong",{},[deckTitle(store.selectedDeckId)])]);
  const createBtn = h("button",{class:"btnBig"},["CREAR JUEGO"]);

  deckBtn.addEventListener("click", ()=>route("decks"));
  createBtn.addEventListener("click", async ()=>{
    debugClick("crear sala");
    const n = name.value.trim();
    if(!n) return toast("Poné tu nombre");
    localStorage.setItem("chamuyo_name", n);

    const r = await safeCall(()=>api.createRoom(n,{deckId:store.selectedDeckId}));
    if(!r) return;

    store.me = { token:r.playerToken, name:n, code:r.roomCode, isHost:true };
    localStorage.setItem("chamuyo_token", r.playerToken);
    localStorage.setItem("chamuyo_code", r.roomCode);
    route("lobby");
  });

  return h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["Crear sala"]),
      h("div",{class:"formRow"},[
        h("div",{},[h("div",{class:"label"},["TU NOMBRE"]), name]),
        deckBtn,
        deckLabel,
        createBtn,
        h("button",{class:"btnBig ghost", onClick: ()=>{
          debugClick("volver");
          route("home");
        }},["VOLVER"])
      ])
    ])
  ]);
}

function deckTitle(id){
  const d = store.decks.find(d=>d.id===id);
  return d?.title || "Clásico";
}

async function viewDecks(){
  showRoom("");
  deckCorner.style.display = "none";
  subtitle.textContent = "Seleccionar mazo";

  if(store.decks.length===0){
    const r = await safeCall(()=>api.listDecks?.() || ({ok:true,decks:[{id:"classic",title:"Chamuyo Clásico",subtitle:""}]}));
    if(r?.ok) store.decks = r.decks;
  }

  const items = store.decks.map(d=>{
    const btn = h("button",{class:"handRow"},[
      d.title,
      h("small",{},[d.subtitle || ""])
    ]);
    btn.addEventListener("click", ()=>{
      debugClick(`seleccionar mazo ${d.id}`);
      store.selectedDeckId = d.id;
      toast(`Mazo: ${d.title}`);
      route("create");
    });
    return btn;
  });

  return h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["Mazos"]),
      h("div",{class:"list"}, items),
      h("button",{class:"btnBig ghost", onClick: ()=>{
        debugClick("volver");
        route("create");
      }},["VOLVER"])
    ])
  ]);
}

async function viewLobby(){
  if(!store.me){
    // try restore
    const token = localStorage.getItem("chamuyo_token");
    const code = localStorage.getItem("chamuyo_code");
    const name = localStorage.getItem("chamuyo_name") || "Jugador";
    if(token && code){
      store.me = { token, name, code, isHost:false }; // will be corrected by server later (final)
    }else{
      return viewHome();
    }
  }

  showRoom(store.me.code);
  deckCorner.style.display = "none";
  subtitle.textContent = "Lobby";

  const rs = await safeCall(()=>api.getRoomState(store.me.code));
  if(rs?.ok) store.room = rs;

  const players = (store.room?.players || []).map(p => h("div",{class:"pill"},[p.name + (p.isHost ? " (host)" : "")]));
  const list = h("div",{class:"pills", style:"flex-wrap:wrap"}, players.length?players:[h("div",{class:"pill"},["—"])]);

  const msg = h("div",{class:"sub"},["Esperando que el anfitrión reparta."]);
  const btns = [];

  // host buttons
  if(store.me.isHost){
    btns.push(h("button",{class:"btnBig", onClick: async ()=>{
      debugClick("repartir");
      const r = await safeCall(()=>api.startGame(store.me.token));
      if(!r) return;
      route("hand");
    }},["REPARTIR"]));
  }else{
    btns.push(h("button",{class:"btnBig ghost", onClick: ()=>{
      debugClick("actualizar");
      toast("Cuando el host reparta, entrás automáticamente en la versión final.");
    }},["ACTUALIZAR"]));
  }

  btns.push(h("button",{class:"btnBig ghost", onClick: ()=>{
    debugClick("salir");
    route("home");
  }},["SALIR"]));

  // if already playing, go to hand
  if(store.room?.room?.status === "playing" || store.room?.room?.status === "finished"){
    // keep it smooth
    setTimeout(()=>route("hand"), 200);
  }

  return h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["Lobby"]),
      h("div",{class:"row"},[
        h("div",{},[h("div",{class:"label"},["CÓDIGO"]), h("div",{style:"font-weight:900;font-size:22px"},[store.me.code])]),
        h("button",{class:"pill", onClick: async ()=>{
          debugClick("copiar codigo");
          try{
            await navigator.clipboard.writeText(store.me.code);
            toast("Código copiado");
          }catch{ toast("No pude copiar"); }
        }},["Copiar"])
      ]),
      h("div",{class:"label", style:"margin-top:12px"},["JUGADORES"]),
      list,
      h("div",{style:"height:10px"}),
      msg,
      h("div",{style:"height:12px"}),
      h("div",{class:"formRow"}, btns),
    ])
  ]);
}

async function viewHand(){
  if(!store.me){
    return viewHome();
  }
  showRoom(store.me.code);
  deckCorner.style.display = "";
  subtitle.textContent = "Mano";

  const rs = await safeCall(()=>api.getRoomState(store.me.code));
  if(rs?.ok) store.room = rs;

  // show finished screen
  const finishedEv = store.room?.events?.find(e=>e.type==="game_finished");
  if(finishedEv){
    return viewFinished(finishedEv.payload?.winner || "Alguien");
  }

  const hr = await safeCall(()=>api.getMyHand(store.me.token));
  if(hr?.ok) store.hand = hr.hand;

  const list = h("div",{class:"list"});
  for(const c of store.hand){
    const btn = h("button",{class:"handRow"},[
      c.phrase,
      h("small",{},["Tocá para abrir la carta"])
    ]);
    btn.addEventListener("click", ()=>modalOpen(c));
    list.appendChild(btn);
  }

  const btnNew = h("button",{class:"btnBig secondary"},["SACAR NUEVA CARTA"]);
  btnNew.addEventListener("click", async ()=>{
    debugClick("sacar nueva carta");
    const r = await safeCall(()=>api.getNewCard(store.me.token));
    if(!r?.ok) return;
    toast("Nueva carta agregada");
    route("hand"); // refresh
  });

  const btnAccuse = h("button",{class:"btnBig ghost"},["ME ACUSARON INJUSTAMENTE"]);
  btnAccuse.addEventListener("click", ()=>{
    debugClick("acusaron injustamente");
    toast("En la versión final, esto notifica al host/servidor.");
  });

  const btnExit = h("button",{class:"btnBig ghost"},["SALIR"]);
  btnExit.addEventListener("click", ()=>{
    debugClick("salir");
    localStorage.removeItem("chamuyo_token");
    localStorage.removeItem("chamuyo_code");
    store.me = null;
    route("home");
  });

  const isHost = store.me.isHost;
  const btnAdmin = h("button",{class:"btnBig ghost"},["ADMINISTRAR"]);
  btnAdmin.addEventListener("click", ()=>{
    debugClick("administrar");
    toast("Menú admin: próximamente (en backend real).");
  });

  return h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["Tu mano"]),
      list,
      h("div",{style:"height:10px"}),
      h("div",{class:"formRow"},[
        btnNew,
        btnAccuse,
        ...(isHost ? [btnAdmin] : []),
        btnExit
      ])
    ])
  ]);
}

function viewFinished(winnerName){
  showRoom(store.me?.code || "");
  deckCorner.style.display = "none";
  subtitle.textContent = "Final";

  startConfetti();

  const box = h("div",{class:"card"},[
    h("div",{class:"section"},[
      h("h2",{},["🎉 Juego terminado"]),
      h("div",{style:"font-weight:900;font-size:22px"},[`${winnerName} ganó`]),
      h("div",{class:"sub", style:"margin-top:6px"},["En la versión final, esto lo dispara el servidor cuando alguien se queda sin cartas."]),
      h("div",{style:"height:14px"}),
      h("button",{class:"btnBig", onClick: ()=>{
        stopConfetti();
        localStorage.removeItem("chamuyo_token");
        localStorage.removeItem("chamuyo_code");
        store.me = null;
        route("home");
      }},["VOLVER AL INICIO"])
    ])
  ]);
  return box;
}

// ===== Modal actions =====
modal.btnS.addEventListener("click", async ()=>{
  if(!modal.current) return;
  debugClick("chamuyo exitoso");
  setModalBusy(true);
  const r = await safeCall(()=>api.markSuccess(store.me.token, modal.current.cardId));
  setModalBusy(false);
  if(!r) return;
  modalClose();
  if(r.finished){
    route("hand");
  }else{
    route("hand");
  }
});

modal.btnF.addEventListener("click", async ()=>{
  if(!modal.current) return;
  debugClick("chamuyo descubierto");
  setModalBusy(true);
  const r = await safeCall(()=>api.markVoided(store.me.token, modal.current.cardId));
  setModalBusy(false);
  if(!r) return;
  modalClose();
  toast("Carta marcada como descubierta");
  route("hand");
});

// ===== Confetti (simple) =====
let confettiRAF = null;
function startConfetti(){
  const canvas = $("#confetti");
  canvas.style.display = "";
  const ctx = canvas.getContext("2d");
  const resize = ()=>{
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener("resize", resize, {passive:true});

  const pieces = Array.from({length: 120}).map(()=>({
    x: Math.random()*canvas.width,
    y: -Math.random()*canvas.height,
    r: 3 + Math.random()*4,
    vx: -1 + Math.random()*2,
    vy: 2 + Math.random()*4,
    a: Math.random()*Math.PI*2,
    va: -0.15 + Math.random()*0.3
  }));

  const tick = ()=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.globalAlpha = 0.95;
    for(const p of pieces){
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      if(p.y > canvas.height + 20){ p.y = -20; p.x = Math.random()*canvas.width; }
      ctx.save();
      ctx.translate(p.x,p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = "rgba(255,255,255,.0)"; // no fixed color; use stroke trick
      ctx.strokeStyle = "rgba(255,255,255,.0)";
      // use random grayscale to avoid specifying colors explicitly
      const g = Math.floor(120 + Math.random()*120);
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.fillRect(-p.r, -p.r, p.r*2, p.r*2);
      ctx.restore();
    }
    confettiRAF = requestAnimationFrame(tick);
  };
  tick();
}
function stopConfetti(){
  const canvas = $("#confetti");
  canvas.style.display = "none";
  if(confettiRAF) cancelAnimationFrame(confettiRAF);
  confettiRAF = null;
}

// ===== Render =====
function render(){
  const hash = (location.hash||"").replace("#","") || "home";
  const view = hash;
  if(debug.enabled) debug.log(`render: ${view}`);

  let node = null;
  if(view==="home") node = viewHome();
  else if(view==="join") node = viewJoin();
  else if(view==="create") node = viewCreate();
  else if(view==="decks") node = viewDecks();
  else if(view==="lobby") node = viewLobby();
  else if(view==="hand") node = viewHand();
  else node = viewHome();

  // node may be promise
  Promise.resolve(node).then(n=>{
    root.innerHTML = "";
    root.appendChild(n);
  });
}

// SW register
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").then(()=>{
      if(debug.enabled) debug.log("service worker: registrado");
    }).catch((err)=>{
      if(debug.enabled) debug.log(`service worker: error ${err?.message || err}`);
    });
  });
}

// boot
if(debug.enabled){
  debug.log("ui.js cargado");
  debug.log("connector.js importado");
  debug.listMethods(api, [
    "createRoom",
    "joinRoom",
    "getRoomState",
    "startGame",
    "getMyHand",
    "markSuccess",
    "markVoided",
    "getNewCard",
    "listDecks"
  ]);
}
render();
