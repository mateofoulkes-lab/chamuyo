const apiUrl = new URL("./api.php", import.meta.url);

async function post(action, payload = {}) {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    throw new Error("Respuesta inválida del servidor");
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Error del servidor");
  }
  return data;
}

export function createRoom(name, { deckId = "classic" } = {}) {
  return post("createRoom", { name, deckId });
}

export function joinRoom(code, name) {
  return post("joinRoom", { code, name });
}

export function getRoomState(code) {
  return post("getRoomState", { code });
}

export function getJoinStatus(token) {
  return post("getJoinStatus", { token });
}

export function startGame(token) {
  return post("startGame", { token });
}

export function getMyHand(token) {
  return post("getMyHand", { token });
}

export function markSuccess(token, cardId) {
  return post("markSuccess", { token, cardId });
}

export function markVoided(token, cardId) {
  return post("markVoided", { token, cardId });
}

export function getNewCard(token) {
  return post("getNewCard", { token });
}

export function listDecks() {
  return post("listDecks");
}

export function listRequests(token) {
  return post("listRequests", { token });
}

export function requestCardSwap(token, cardId, reason) {
  return post("requestCardSwap", { token, cardId, reason });
}

export function respondCardSwap(token, requestId, accept) {
  return post("respondCardSwap", { token, requestId, accept });
}

export function requestAccusation(token, accusedPlayerId, reason) {
  return post("requestAccusation", { token, accusedPlayerId, reason });
}

export function respondAccusation(token, requestId, action) {
  return post("respondAccusation", { token, requestId, action });
}

export function respondJoinRequest(token, requestId, mode, replacePlayerId) {
  return post("respondJoinRequest", { token, requestId, mode, replacePlayerId });
}

export function penalizePlayer(token, playerId, reason) {
  return post("penalizePlayer", { token, playerId, reason });
}
