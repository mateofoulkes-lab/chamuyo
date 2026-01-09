import mockData from "./data/mock.json" assert { type: "json" };

// In-memory "server"
const state = {
  rooms: new Map(),          // code -> room
  players: new Map(),        // token -> player
  phrases: mockData.phrases.map((t,i)=>({id:i+1, text:t})),
  decks: mockData.presets.decks,
};

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
  };

  // host player
  const token = randToken();
  const host = { id: room.nextPlayerId++, roomCode: code, name: name?.trim() || "Host", token, created_at: nowIso(), isHost:true };
  room.hostPlayerId = host.id;
  room.players.push({ id: host.id, name: host.name, isHost:true });
  state.players.set(token, host);

  state.rooms.set(code, room);
  pushEvent(room, "room_created", { host: host.name, deckId });

  return { ok:true, roomCode: code, playerToken: token };
}

export async function joinRoom(code, name){
  const room = ensureRoom(code.toUpperCase().trim());
  const token = randToken();
  const p = { id: room.nextPlayerId++, roomCode: room.code, name: name?.trim() || "Invitado", token, created_at: nowIso(), isHost:false };
  room.players.push({ id: p.id, name: p.name, isHost:false });
  state.players.set(token, p);
  pushEvent(room, "player_joined", { name: p.name });
  return { ok:true, roomCode: room.code, playerToken: token };
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

export async function startGame(token){
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
  return { ok:true };
}

export async function getNewCard(token){
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
  return { ok:true, decks: state.decks.map(d=>({ id:d.id, title:d.title, subtitle:d.subtitle })) };
}
