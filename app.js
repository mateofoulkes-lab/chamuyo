// Chamuyo - Test Frontend
const $ = (id) => document.getElementById(id);

const state = {
  apiBase: localStorage.getItem("chamuyo_apiBase") || "https://chamuyo.gamer.gd/api.php",
  roomCode: localStorage.getItem("chamuyo_roomCode") || "",
  token: localStorage.getItem("chamuyo_token") || "",
  lastEventId: 0,
};

function setPill(text, ok = true) {
  const el = $("netPill");
  el.textContent = text;
  el.style.borderColor = ok ? "rgba(0,0,0,.10)" : "rgba(160,0,0,.35)";
  el.style.background = ok ? "rgba(255,255,255,.60)" : "rgba(255,230,230,.75)";
}

function log(obj, title = "") {
  const el = $("log");
  const stamp = new Date().toISOString();
  const s = (typeof obj === "string") ? obj : JSON.stringify(obj, null, 2);
  el.textContent += `\n[${stamp}] ${title}\n${s}\n`;
  el.scrollTop = el.scrollHeight;
}

function save() {
  localStorage.setItem("chamuyo_apiBase", state.apiBase);
  localStorage.setItem("chamuyo_roomCode", state.roomCode);
  localStorage.setItem("chamuyo_token", state.token);
}

async function api(action, { method="GET", body=null, auth=false, query={} } = {}) {
  const url = new URL(state.apiBase);
  url.searchParams.set("action", action);
  for (const [k,v] of Object.entries(query)) url.searchParams.set(k, v);

  const headers = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${state.token}`;

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });

  let data;
  try { data = await res.json(); }
  catch { data = { ok:false, error:"Respuesta no JSON", status: res.status }; }

  return { status: res.status, data };
}

function renderPlayers(players) {
  const ul = $("players");
  ul.innerHTML = "";
  for (const p of players) {
    const li = document.createElement("li");
    li.textContent = `#${p.id} — ${p.name}`;
    ul.appendChild(li);
  }
}

function renderLists(lists, activeListId) {
  const ul = $("lists");
  ul.innerHTML = "";
  for (const l of lists) {
    const li = document.createElement("li");
    const badge = l.is_preset ? "preset" : "sala";
    li.innerHTML = `#${l.id} — ${escapeHtml(l.name)} <span class="muted">(${badge})</span>`;
    if (activeListId && Number(l.id) === Number(activeListId)) {
      li.innerHTML += ` <b>✅ activa</b>`;
    }
    const btn = document.createElement("button");
    btn.textContent = "Activar";
    btn.onclick = async () => {
      const r = await api("setActiveList", { method:"POST", body:{ listId: Number(l.id) }, auth:true });
      log(r, "setActiveList");
      if (!r.data.ok) alert(r.data.error || "Error setActiveList");
      await loadRoomState();
    };
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

async function loadRoomState() {
  if (!state.roomCode) {
    alert("Primero creá o uníte a una sala.");
    return;
  }
  const r = await api("roomState", { query: { code: state.roomCode } });
  log(r, "roomState");
  if (!r.data.ok) { alert(r.data.error || "Error"); return; }

  renderPlayers(r.data.players || []);
  renderLists(r.data.lists || [], r.data.room?.activeListId);

  // events
  const ev = r.data.events || [];
  if (ev.length) state.lastEventId = ev[ev.length - 1].id;

  setPill("CORS OK / roomState OK", true);
}

async function loadMyHand() {
  const r = await api("myHand", { auth:true });
  log(r, "myHand");
  if (!r.data.ok) { alert(r.data.error || "Error"); return; }
  alert(`Tenés ${r.data.hand?.length ?? 0} cartas en mano (ver log).`);
}

async function startGame() {
  const r = await api("startGame", { method:"POST", auth:true, body:{} });
  log(r, "startGame");
  if (!r.data.ok) { alert(r.data.error || "Error startGame"); return; }
  alert("Juego iniciado. Probá 'Traer mi mano'.");
}

async function pingWithoutRoom() {
  // roomState sin code a propósito para ver si llega al server (debe dar 404 acción o sala)
  // mejor: pegar a roomState con un code inválido y ver respuesta JSON
  const r = await api("roomState", { query: { code: "XXXXXX" }});
  log(r, "ping roomState (code inválido)");
  // Si llega JSON, la conectividad está OK.
  if (r.data && typeof r.data === "object") setPill("Backend responde JSON", true);
}

function wireUI() {
  $("apiBase").value = state.apiBase;
  $("curRoomCode").value = state.roomCode;
  $("curToken").value = state.token;

  $("apiBase").addEventListener("change", (e) => {
    state.apiBase = e.target.value.trim();
    save();
  });

  $("curRoomCode").addEventListener("change", (e) => {
    state.roomCode = e.target.value.trim().toUpperCase();
    save();
  });

  $("curToken").addEventListener("change", (e) => {
    state.token = e.target.value.trim();
    save();
  });

  $("btnClear").onclick = () => { $("log").textContent = ""; };

  $("btnPing").onclick = async () => {
    try {
      await pingWithoutRoom();
    } catch (e) {
      log(String(e), "ping error");
      setPill("Fallo (ver log)", false);
    }
  };

  $("btnCreate").onclick = async () => {
    const name = $("hostName").value.trim() || "Host";
    try {
      const r = await api("createRoom", { method:"POST", body:{ name } });
      log(r, "createRoom");
      if (!r.data.ok) { alert(r.data.error || "Error createRoom"); return; }
      state.roomCode = r.data.roomCode;
      state.token = r.data.playerToken;
      $("curRoomCode").value = state.roomCode;
      $("curToken").value = state.token;
      save();
      await loadRoomState();
      alert(`Sala creada: ${state.roomCode}`);
    } catch (e) {
      log(String(e), "createRoom error");
      setPill("Fallo CORS o red", false);
      alert("Falló createRoom. Mirá el Log.");
    }
  };

  $("btnJoin").onclick = async () => {
    const code = ($("joinCode").value || "").trim().toUpperCase();
    const name = ($("joinName").value || "").trim() || "Invitado";
    if (!code) return alert("Poné el código.");
    try {
      const r = await api("joinRoom", { method:"POST", body:{ code, name } });
      log(r, "joinRoom");
      if (!r.data.ok) { alert(r.data.error || "Error joinRoom"); return; }
      state.roomCode = r.data.roomCode;
      state.token = r.data.playerToken;
      $("curRoomCode").value = state.roomCode;
      $("curToken").value = state.token;
      save();
      await loadRoomState();
      alert(`Unido a sala: ${state.roomCode}`);
    } catch (e) {
      log(String(e), "joinRoom error");
      setPill("Fallo CORS o red", false);
      alert("Falló joinRoom. Mirá el Log.");
    }
  };

  $("btnRoomState").onclick = async () => {
    try { await loadRoomState(); }
    catch (e) { log(String(e), "roomState error"); setPill("Fallo (ver log)", false); }
  };

  $("btnMyHand").onclick = async () => {
    try { await loadMyHand(); }
    catch (e) { log(String(e), "myHand error"); setPill("Fallo (ver log)", false); }
  };

  $("btnStart").onclick = async () => {
    try { await startGame(); }
    catch (e) { log(String(e), "startGame error"); setPill("Fallo (ver log)", false); }
  };

  $("build").textContent = `Build: ${new Date().toLocaleString()}`;
}

async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch (e) {
    // No pasa nada si falla en GH Pages
  }
}

wireUI();
registerSW();
setPill("Listo", true);
log({ apiBase: state.apiBase, roomCode: state.roomCode, token: state.token ? "(guardado)" : "" }, "boot");
