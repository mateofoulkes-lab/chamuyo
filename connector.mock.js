const mockDataUrl = new URL("./data/mock.json", import.meta.url);
let mockDataPromise = null;

async function loadMockData(){
  if(!mockDataPromise){
    mockDataPromise = fetch(mockDataUrl, { cache: "no-store" }).then(async (res)=>{
      if(!res.ok){
        throw new Error(`No se pudo cargar mock.json (${res.status})`);
      }
      return res.json();
    });
  }
  return mockDataPromise;
}

// In-memory "server"
const state = {
  rooms: new Map(),          // code -> room
  players: new Map(),        // token -> player
  phrases: [],
  decks: [],
  pendingPlayers: new Map(), // token -> { roomCode, name, status, requestId }
};

async function ensureData(){
  if(state.decks.length && state.phrases.length) return;
  const mockData = await loadMockData();
  state.phrases = mockData.phrases.map((t,i)=>({id:i+1, text:t}));
  state.decks = mockData.presets.decks;
}

// helpers
const nowIso = () => new Date().toISOString();
const randCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for(let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
};
const randToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,"0")).join("");
const clone = (o) => JSON.parse(JSON.stringify(o));

function getDeck(deckId){
  const d = state.decks.find(d=>d.id===deckId);
  if(!d) throw new Error("Mazo no encontrado");
  return d;
}

function ensureRoom(code){
  const r = state.rooms.get(code);
  if(!r) throw new Error("Sala no encontrada");
  return r;
}

function ensureMe(token){
  const p = state.players.get(token);
  if(!p) throw new Error("Token inválido");
  return p;
}

function pushEvent(room, type, payload={}){
  room.events.push({ id: room.events.length+1, type, created_at: nowIso(), payload: clone(payload) });
  // keep last 50
  if(room.events.length>50) room.events.splice(0, room.events.length-50);
}

function addRequest(room, type, payload){
  const req = { id: room.nextRequestId++, type, status: "pending", created_at: nowIso(), payload: clone(payload) };
  room.requests.push(req);
  return req;
}

function findRequest(room, requestId){
  const req = room.requests.find(r => r.id === Number(requestId));
  if(!req) throw new Error("Solicitud no encontrada");
  if(req.status !== "pending") throw new Error("Solicitud ya resuelta");
  return req;
}

function dealOne(room, playerId){
  // phrase unique per room
  const deck = getDeck(room.activeDeckId);
  const pool = deck.phraseIds.filter(pid => !room.usedPhraseIds.has(pid));
  if(pool.length===0) return null;
  const pid = pool[Math.floor(Math.random()*pool.length)];
  room.usedPhraseIds.add(pid);
  const cardId = room.nextCardId++;
  const card = { cardId, roomCode: room.code, playerId, phraseId: pid, state:"in_hand", assigned_at: nowIso(), resolved_at:null };
  room.cards.set(cardId, card);
  return card;
}

function cardsInHand(room, playerId){
  const out = [];
  for(const c of room.cards.values()){
    if(c.playerId===playerId && c.state==="in_hand"){
      const phr = state.phrases.find(p=>p.id===c.phraseId);
      out.push({ cardId: c.cardId, phrase: phr?.text || "..." });
    }
  }
  // stable sort
  out.sort((a,b)=>a.cardId-b.cardId);
  return out;
}

function remainingInHand(room, playerId){
  let n=0;
  for(const c of room.cards.values()){
    if(c.playerId===playerId && c.state==="in_hand") n++;
  }
  return n;
}

function checkWinner(room){
  for(const pl of room.players){
    if(remainingInHand(room, pl.id)===0){
      return pl;
    }
  }
  return null;
}

/* ===== Public API (same shape as PHP) ===== */
export async function createRoom(name, { deckId="classic" } = {}){
  await ensureData();
  const code = randCode();
  const room = {
    code,
    hostPlayerId: 1,
    permissions_mode: "host",
    activeDeckId: deckId,
    status: "lobby",
    created_at: nowIso(),
    players: [],
    events: [],
    cards: new Map(),
    usedPhraseIds: new Set(),
    nextPlayerId: 1,
    nextCardId: 1,
    nextRequestId: 1,
    requests: [],
  };

  // host player
  const token = randToken();
  const host = { id: room.nextPlayerId++, roomCode: code, name: name?.trim() || "Host", token, created_at: nowIso(), isHost:true };
  room.hostPlayerId = host.id;
  room.players.push({ id: host.id, name: host.name, isHost:true });
  state.players.set(token, host);

  state.rooms.set(code, room);
  pushEvent(room, "room_created", { host: host.name, deckId });

  return { ok:true, roomCode: code, playerToken: token, playerId: host.id };
}

export async function joinRoom(code, name){
  const room = ensureRoom(code.toUpperCase().trim());
  const token = randToken();
  const playerName = name?.trim() || "Invitado";
  const req = addRequest(room, "join", { name: playerName, token });
  state.pendingPlayers.set(token, { roomCode: room.code, name: playerName, status: "pending", requestId: req.id });
  pushEvent(room, "join_requested", { name: playerName });
  return { ok:true, roomCode: room.code, playerToken: token, status: "pending" };
}

export async function getRoomState(code){
  const room = ensureRoom(code.toUpperCase().trim());
  return {
    ok:true,
    room: { code: room.code, status: room.status, activeDeckId: room.activeDeckId, permissions_mode: room.permissions_mode },
    players: clone(room.players),
    events: clone(room.events.slice(-10)),
  };
}

export async function getJoinStatus(token){
  const active = state.players.get(token);
  if(active){
    return { ok:true, status: "active", roomCode: active.roomCode };
  }
  const pending = state.pendingPlayers.get(token);
  if(!pending) return { ok:true, status: "unknown" };
  return { ok:true, status: pending.status, roomCode: pending.roomCode };
}

export async function startGame(token){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede repartir");
  room.status = "playing";

  // deal to each player to 5
  for(const pl of room.players){
    const pid = pl.id;
    // count existing in_hand
    const have = cardsInHand(room, pid).length;
    const need = Math.max(0, 5-have);
    for(let i=0;i<need;i++){
      const c = dealOne(room, pid);
      if(!c) break;
    }
  }

  pushEvent(room, "game_started", {});
  return { ok:true };
}

export async function getMyHand(token){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  return { ok:true, hand: cardsInHand(room, me.id) };
}

export async function markSuccess(token, cardId){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  const c = room.cards.get(Number(cardId));
  if(!c || c.playerId!==me.id) throw new Error("Carta inválida");
  if(c.state!=="in_hand") throw new Error("Carta ya resuelta");
  c.state = "success";
  c.resolved_at = nowIso();
  pushEvent(room, "card_success", { player: me.name, cardId: c.cardId });

  const winner = checkWinner(room);
  if(winner){
    room.status = "finished";
    pushEvent(room, "game_finished", { winner: winner.name });
    return { ok:true, finished:true, winner: winner.name };
  }
  return { ok:true };
}

export async function markVoided(token, cardId){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  const c = room.cards.get(Number(cardId));
  if(!c || c.playerId!==me.id) throw new Error("Carta inválida");
  if(c.state!=="in_hand") throw new Error("Carta ya resuelta");
  c.state = "voided";
  c.resolved_at = nowIso();
  pushEvent(room, "card_voided", { player: me.name, cardId: c.cardId });
  const newCard = dealOne(room, me.id);
  if(newCard){
    pushEvent(room, "card_replaced", { player: me.name, cardId: newCard.cardId });
  }
  return { ok:true };
}

export async function getNewCard(token){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(room.status!=="playing") throw new Error("El juego no empezó");
  const c = dealOne(room, me.id);
  if(!c) throw new Error("No quedan más cartas en el mazo");
  pushEvent(room, "new_card", { player: me.name, cardId: c.cardId });
  const phr = state.phrases.find(p=>p.id===c.phraseId);
  return { ok:true, card: { cardId: c.cardId, phrase: phr?.text || "..." } };
}

export async function listDecks(){
  await ensureData();
  return { ok:true, decks: state.decks.map(d=>({ id:d.id, title:d.title, subtitle:d.subtitle })) };
}

export async function listRequests(token){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede ver notificaciones");
  return { ok:true, requests: clone(room.requests.filter(r=>r.status==="pending")) };
}

export async function requestCardSwap(token, cardId, reason){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  const c = room.cards.get(Number(cardId));
  if(!c || c.playerId!==me.id) throw new Error("Carta inválida");
  const phr = state.phrases.find(p=>p.id===c.phraseId);
  const req = addRequest(room, "swap", {
    playerName: me.name,
    playerId: me.id,
    cardId: c.cardId,
    phrase: phr?.text || "...",
    reason: reason?.trim() || "Sin aclaración",
  });
  pushEvent(room, "swap_requested", { player: me.name, phrase: req.payload.phrase });
  return { ok:true, requestId: req.id };
}

export async function respondCardSwap(token, requestId, accept){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede resolver");
  const req = findRequest(room, requestId);
  if(req.type !== "swap") throw new Error("Solicitud inválida");
  req.status = "handled";
  if(accept){
    const card = room.cards.get(Number(req.payload.cardId));
    if(card){
      card.state = "voided";
      card.resolved_at = nowIso();
    }
    if(req.payload.playerId){
      dealOne(room, req.payload.playerId);
    }
    pushEvent(room, "swap_accepted", { player: req.payload.playerName, phrase: req.payload.phrase });
  }else{
    pushEvent(room, "swap_rejected", { player: req.payload.playerName, phrase: req.payload.phrase });
  }
  return { ok:true };
}

export async function requestAccusation(token, accusedPlayerId, reason){
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  const accused = room.players.find(p=>p.id===Number(accusedPlayerId));
  if(!accused) throw new Error("Jugador inválido");
  const req = addRequest(room, "accusation", {
    playerName: me.name,
    accusedId: accused.id,
    accusedName: accused.name,
    reason: reason?.trim() || "Sin aclaración",
  });
  pushEvent(room, "accusation_requested", { player: me.name, accused: accused.name });
  return { ok:true, requestId: req.id };
}

export async function respondAccusation(token, requestId, action){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede resolver");
  const req = findRequest(room, requestId);
  if(req.type !== "accusation") throw new Error("Solicitud inválida");
  req.status = "handled";
  if(action === "penalize"){
    dealOne(room, req.payload.accusedId);
    pushEvent(room, "accusation_penalized", { player: req.payload.playerName, accused: req.payload.accusedName });
  }else{
    pushEvent(room, "accusation_dismissed", { player: req.payload.playerName, accused: req.payload.accusedName });
  }
  return { ok:true };
}

export async function respondJoinRequest(token, requestId, mode, replacePlayerId){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede resolver");
  const req = findRequest(room, requestId);
  if(req.type !== "join") throw new Error("Solicitud inválida");
  const pending = state.pendingPlayers.get(req.payload.token);
  if(!pending) throw new Error("Solicitud expirada");
  req.status = "handled";

  if(mode === "reject"){
    pending.status = "rejected";
    pushEvent(room, "join_rejected", { name: pending.name });
    return { ok:true };
  }

  if(mode === "replace"){
    const target = room.players.find(p=>p.id===Number(replacePlayerId));
    if(!target) throw new Error("Jugador a reemplazar inválido");
    target.name = pending.name;
    for(const [tok, pl] of state.players.entries()){
      if(pl.id === target.id && pl.roomCode === room.code){
        state.players.delete(tok);
      }
    }
    const newPlayer = { id: target.id, roomCode: room.code, name: pending.name, token: req.payload.token, created_at: nowIso(), isHost: target.isHost };
    state.players.set(req.payload.token, newPlayer);
    pending.status = "accepted";
    pushEvent(room, "join_accepted", { name: pending.name, mode: "replace" });
    return { ok:true };
  }

  const p = { id: room.nextPlayerId++, roomCode: room.code, name: pending.name, token: req.payload.token, created_at: nowIso(), isHost:false };
  room.players.push({ id: p.id, name: p.name, isHost:false });
  state.players.set(req.payload.token, p);
  pending.status = "accepted";
  if(room.status === "playing" || room.status === "finished" || room.status === "lobby"){
    for(let i=0;i<5;i++){
      const c = dealOne(room, p.id);
      if(!c) break;
    }
  }
  pushEvent(room, "player_joined", { name: p.name });
  pushEvent(room, "join_accepted", { name: pending.name, mode: "new" });
  return { ok:true };
}

export async function penalizePlayer(token, playerId, reason){
  await ensureData();
  const me = ensureMe(token);
  const room = ensureRoom(me.roomCode);
  if(me.id !== room.hostPlayerId) throw new Error("Solo el anfitrión puede penalizar");
  const target = room.players.find(p=>p.id===Number(playerId));
  if(!target) throw new Error("Jugador inválido");
  dealOne(room, target.id);
  pushEvent(room, "player_penalized", { player: target.name, reason: reason?.trim() || "Sin motivo" });
  return { ok:true };
}
