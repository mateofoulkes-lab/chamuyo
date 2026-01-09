<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/config.php';

$pdo = get_pdo();
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = [];
}
$action = $input['action'] ?? '';

function respond(array $data): void
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400): void
{
    http_response_code($status);
    respond(['ok' => false, 'error' => $message]);
}

function now(): string
{
    return date('Y-m-d H:i:s');
}

function rand_code(PDO $pdo): string
{
    $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for ($i = 0; $i < 10; $i++) {
        $code = '';
        for ($c = 0; $c < 6; $c++) {
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }
        $stmt = $pdo->prepare('SELECT id FROM rooms WHERE code = ? LIMIT 1');
        $stmt->execute([$code]);
        if (!$stmt->fetch()) {
            return $code;
        }
    }
    throw new RuntimeException('No se pudo generar un código único');
}

function rand_token(): string
{
    return bin2hex(random_bytes(32));
}

function push_event(PDO $pdo, int $roomId, string $type, array $payload = []): void
{
    $stmt = $pdo->prepare('INSERT INTO events (room_id, type, payload, created_at) VALUES (?, ?, ?, ?)');
    $stmt->execute([$roomId, $type, json_encode($payload, JSON_UNESCAPED_UNICODE), now()]);
}

function require_player(PDO $pdo, string $token): array
{
    $stmt = $pdo->prepare('SELECT * FROM players WHERE token = ? LIMIT 1');
    $stmt->execute([$token]);
    $player = $stmt->fetch();
    if (!$player) {
        fail('Token inválido', 403);
    }
    return $player;
}

function require_room(PDO $pdo, string $code): array
{
    $stmt = $pdo->prepare('SELECT rooms.*, lists.slug AS deck_slug FROM rooms LEFT JOIN lists ON rooms.active_list_id = lists.id WHERE rooms.code = ? LIMIT 1');
    $stmt->execute([$code]);
    $room = $stmt->fetch();
    if (!$room) {
        fail('Sala no encontrada', 404);
    }
    return $room;
}

function require_room_by_id(PDO $pdo, int $roomId): array
{
    $stmt = $pdo->prepare('SELECT rooms.*, lists.slug AS deck_slug FROM rooms LEFT JOIN lists ON rooms.active_list_id = lists.id WHERE rooms.id = ? LIMIT 1');
    $stmt->execute([$roomId]);
    $room = $stmt->fetch();
    if (!$room) {
        fail('Sala no encontrada', 404);
    }
    return $room;
}

function require_deck(PDO $pdo, $deckId): array
{
    if ($deckId === null || $deckId === '') {
        $deckId = 'classic';
    }
    if (is_numeric($deckId)) {
        $stmt = $pdo->prepare('SELECT * FROM lists WHERE id = ? LIMIT 1');
        $stmt->execute([(int)$deckId]);
    } else {
        $stmt = $pdo->prepare('SELECT * FROM lists WHERE slug = ? LIMIT 1');
        $stmt->execute([(string)$deckId]);
    }
    $deck = $stmt->fetch();
    if (!$deck) {
        fail('Mazo no encontrado', 404);
    }
    return $deck;
}

function deal_one(PDO $pdo, int $roomId, int $playerId, int $listId): ?array
{
    $stmt = $pdo->prepare(
        'SELECT lp.phrase_id
         FROM list_phrases lp
         LEFT JOIN cards c ON c.room_id = ? AND c.phrase_id = lp.phrase_id
         WHERE lp.list_id = ? AND c.id IS NULL
         ORDER BY RAND()
         LIMIT 1'
    );
    $stmt->execute([$roomId, $listId]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }

    $phraseId = (int)$row['phrase_id'];
    $stmt = $pdo->prepare('INSERT INTO cards (room_id, player_id, phrase_id, state, assigned_at) VALUES (?, ?, ?, "in_hand", ?)');
    $stmt->execute([$roomId, $playerId, $phraseId, now()]);
    $cardId = (int)$pdo->lastInsertId();

    $phraseStmt = $pdo->prepare('SELECT text FROM phrases_catalog WHERE id = ?');
    $phraseStmt->execute([$phraseId]);
    $phraseText = $phraseStmt->fetchColumn() ?: '...';

    return ['cardId' => $cardId, 'phraseId' => $phraseId, 'phrase' => $phraseText];
}

function cards_in_hand(PDO $pdo, int $playerId): array
{
    $stmt = $pdo->prepare(
        'SELECT c.id AS cardId, pc.text AS phrase
         FROM cards c
         JOIN phrases_catalog pc ON pc.id = c.phrase_id
         WHERE c.player_id = ? AND c.state = "in_hand"
         ORDER BY c.id'
    );
    $stmt->execute([$playerId]);
    return $stmt->fetchAll();
}

function remaining_in_hand(PDO $pdo, int $playerId): int
{
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM cards WHERE player_id = ? AND state = "in_hand"');
    $stmt->execute([$playerId]);
    return (int)$stmt->fetchColumn();
}

function load_request(PDO $pdo, int $requestId): array
{
    $stmt = $pdo->prepare('SELECT * FROM requests WHERE id = ? LIMIT 1');
    $stmt->execute([$requestId]);
    $req = $stmt->fetch();
    if (!$req) {
        fail('Solicitud no encontrada', 404);
    }
    if ($req['status'] !== 'pending') {
        fail('Solicitud ya resuelta', 400);
    }
    $req['payload'] = json_decode($req['payload'], true) ?: [];
    return $req;
}

try {
    switch ($action) {
        case 'createRoom': {
            $name = trim((string)($input['name'] ?? ''));
            $deckId = $input['deckId'] ?? 'classic';
            $deck = require_deck($pdo, $deckId);

            $code = rand_code($pdo);
            $stmt = $pdo->prepare('INSERT INTO rooms (code, permissions_mode, active_list_id, status, created_at) VALUES (?, "host", ?, "lobby", ?)');
            $stmt->execute([$code, (int)$deck['id'], now()]);
            $roomId = (int)$pdo->lastInsertId();

            $token = rand_token();
            $playerName = $name !== '' ? $name : 'Host';
            $stmt = $pdo->prepare('INSERT INTO players (room_id, name, token, created_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([$roomId, $playerName, $token, now()]);
            $playerId = (int)$pdo->lastInsertId();

            $stmt = $pdo->prepare('UPDATE rooms SET host_player_id = ? WHERE id = ?');
            $stmt->execute([$playerId, $roomId]);

            $deckKey = $deck['slug'] ?: (string)$deck['id'];
            push_event($pdo, $roomId, 'room_created', ['host' => $playerName, 'deckId' => $deckKey]);

            respond([
                'ok' => true,
                'roomCode' => $code,
                'playerToken' => $token,
                'playerId' => $playerId,
            ]);
            break;
        }
        case 'joinRoom': {
            $code = strtoupper(trim((string)($input['code'] ?? '')));
            $name = trim((string)($input['name'] ?? ''));
            $room = require_room($pdo, $code);

            $token = rand_token();
            $playerName = $name !== '' ? $name : 'Invitado';
            $payload = ['name' => $playerName, 'token' => $token];

            $stmt = $pdo->prepare('INSERT INTO requests (room_id, type, status, payload, created_at) VALUES (?, "join", "pending", ?, ?)');
            $stmt->execute([(int)$room['id'], json_encode($payload, JSON_UNESCAPED_UNICODE), now()]);
            push_event($pdo, (int)$room['id'], 'join_requested', ['name' => $playerName]);

            respond([
                'ok' => true,
                'roomCode' => $room['code'],
                'playerToken' => $token,
                'status' => 'pending',
            ]);
            break;
        }
        case 'getRoomState': {
            $code = strtoupper(trim((string)($input['code'] ?? '')));
            $room = require_room($pdo, $code);

            $playersStmt = $pdo->prepare('SELECT id, name FROM players WHERE room_id = ? ORDER BY id');
            $playersStmt->execute([(int)$room['id']]);
            $players = [];
            while ($row = $playersStmt->fetch()) {
                $players[] = [
                    'id' => (int)$row['id'],
                    'name' => $row['name'],
                    'isHost' => ((int)$row['id'] === (int)$room['host_player_id']),
                ];
            }

            $eventsStmt = $pdo->prepare('SELECT id, type, created_at, payload FROM events WHERE room_id = ? ORDER BY id DESC LIMIT 10');
            $eventsStmt->execute([(int)$room['id']]);
            $events = [];
            while ($row = $eventsStmt->fetch()) {
                $events[] = [
                    'id' => (int)$row['id'],
                    'type' => $row['type'],
                    'created_at' => $row['created_at'],
                    'payload' => json_decode($row['payload'], true) ?: new stdClass(),
                ];
            }
            $events = array_reverse($events);

            $deckKey = $room['deck_slug'] ?: (string)$room['active_list_id'];
            respond([
                'ok' => true,
                'room' => [
                    'code' => $room['code'],
                    'status' => $room['status'],
                    'activeDeckId' => $deckKey,
                    'permissions_mode' => $room['permissions_mode'],
                ],
                'players' => $players,
                'events' => $events,
            ]);
            break;
        }
        case 'getJoinStatus': {
            $token = (string)($input['token'] ?? '');
            if ($token === '') {
                fail('Token requerido', 400);
            }

            $stmt = $pdo->prepare('SELECT rooms.code FROM players JOIN rooms ON rooms.id = players.room_id WHERE players.token = ? LIMIT 1');
            $stmt->execute([$token]);
            $row = $stmt->fetch();
            if ($row) {
                respond(['ok' => true, 'status' => 'active', 'roomCode' => $row['code']]);
            }

            $stmt = $pdo->prepare(
                'SELECT status, payload
                 FROM requests
                 WHERE type = "join" AND JSON_UNQUOTE(JSON_EXTRACT(payload, "$.token")) = ?
                 ORDER BY id DESC
                 LIMIT 1'
            );
            $stmt->execute([$token]);
            $req = $stmt->fetch();
            if (!$req) {
                respond(['ok' => true, 'status' => 'unknown']);
            }
            $payload = json_decode($req['payload'], true) ?: [];
            if (($payload['decision'] ?? '') === 'rejected') {
                respond(['ok' => true, 'status' => 'rejected']);
            }
            respond(['ok' => true, 'status' => $req['status'] === 'pending' ? 'pending' : 'unknown']);
            break;
        }
        case 'startGame': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede repartir', 403);
            }

            $pdo->beginTransaction();
            $stmt = $pdo->prepare('UPDATE rooms SET status = "playing" WHERE id = ?');
            $stmt->execute([(int)$room['id']]);

            $playersStmt = $pdo->prepare('SELECT id FROM players WHERE room_id = ?');
            $playersStmt->execute([(int)$room['id']]);
            $listId = (int)$room['active_list_id'];
            while ($row = $playersStmt->fetch()) {
                $pid = (int)$row['id'];
                $have = remaining_in_hand($pdo, $pid);
                $need = max(0, 5 - $have);
                for ($i = 0; $i < $need; $i++) {
                    $card = deal_one($pdo, (int)$room['id'], $pid, $listId);
                    if (!$card) {
                        break;
                    }
                }
            }

            push_event($pdo, (int)$room['id'], 'game_started', []);
            $pdo->commit();

            respond(['ok' => true]);
            break;
        }
        case 'getMyHand': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $hand = cards_in_hand($pdo, (int)$player['id']);
            respond(['ok' => true, 'hand' => $hand]);
            break;
        }
        case 'markSuccess': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $cardId = (int)($input['cardId'] ?? 0);
            $stmt = $pdo->prepare('SELECT * FROM cards WHERE id = ? LIMIT 1');
            $stmt->execute([$cardId]);
            $card = $stmt->fetch();
            if (!$card || (int)$card['player_id'] !== (int)$player['id']) {
                fail('Carta inválida', 400);
            }
            if ($card['state'] !== 'in_hand') {
                fail('Carta ya resuelta', 400);
            }

            $stmt = $pdo->prepare('UPDATE cards SET state = "success", resolved_at = ? WHERE id = ?');
            $stmt->execute([now(), $cardId]);

            $room = require_room_by_id($pdo, (int)$player['room_id']);
            push_event($pdo, (int)$room['id'], 'card_success', ['player' => $player['name'], 'cardId' => $cardId]);

            $finished = false;
            if (remaining_in_hand($pdo, (int)$player['id']) === 0) {
                $stmt = $pdo->prepare('UPDATE rooms SET status = "finished" WHERE id = ?');
                $stmt->execute([(int)$room['id']]);
                push_event($pdo, (int)$room['id'], 'game_finished', ['winner' => $player['name']]);
                $finished = true;
            }

            respond(['ok' => true, 'finished' => $finished, 'winner' => $finished ? $player['name'] : null]);
            break;
        }
        case 'markVoided': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $cardId = (int)($input['cardId'] ?? 0);
            $stmt = $pdo->prepare('SELECT * FROM cards WHERE id = ? LIMIT 1');
            $stmt->execute([$cardId]);
            $card = $stmt->fetch();
            if (!$card || (int)$card['player_id'] !== (int)$player['id']) {
                fail('Carta inválida', 400);
            }
            if ($card['state'] !== 'in_hand') {
                fail('Carta ya resuelta', 400);
            }

            $stmt = $pdo->prepare('UPDATE cards SET state = "voided", resolved_at = ? WHERE id = ?');
            $stmt->execute([now(), $cardId]);

            $room = require_room_by_id($pdo, (int)$player['room_id']);
            push_event($pdo, (int)$room['id'], 'card_voided', ['player' => $player['name'], 'cardId' => $cardId]);
            $newCard = deal_one($pdo, (int)$room['id'], (int)$player['id'], (int)$room['active_list_id']);
            if ($newCard) {
                push_event($pdo, (int)$room['id'], 'card_replaced', ['player' => $player['name'], 'cardId' => $newCard['cardId']]);
            }

            respond(['ok' => true]);
            break;
        }
        case 'getNewCard': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ($room['status'] !== 'playing') {
                fail('El juego no empezó', 400);
            }
            $card = deal_one($pdo, (int)$room['id'], (int)$player['id'], (int)$room['active_list_id']);
            if (!$card) {
                fail('No quedan más cartas en el mazo', 400);
            }
            push_event($pdo, (int)$room['id'], 'new_card', ['player' => $player['name'], 'cardId' => $card['cardId']]);
            respond(['ok' => true, 'card' => ['cardId' => $card['cardId'], 'phrase' => $card['phrase']]]);
            break;
        }
        case 'listDecks': {
            $stmt = $pdo->query('SELECT id, slug, name, subtitle, image_url FROM lists ORDER BY is_preset DESC, id');
            $decks = [];
            while ($row = $stmt->fetch()) {
                $deckId = $row['slug'] ?: (string)$row['id'];
                $decks[] = [
                    'id' => $deckId,
                    'title' => $row['name'],
                    'subtitle' => $row['subtitle'] ?? '',
                    'image' => $row['image_url'] ?? null,
                ];
            }
            respond(['ok' => true, 'decks' => $decks]);
            break;
        }
        case 'listRequests': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede ver notificaciones', 403);
            }
            $stmt = $pdo->prepare('SELECT id, type, status, payload, created_at FROM requests WHERE room_id = ? AND status = "pending" ORDER BY id');
            $stmt->execute([(int)$room['id']]);
            $requests = [];
            while ($row = $stmt->fetch()) {
                $requests[] = [
                    'id' => (int)$row['id'],
                    'type' => $row['type'],
                    'status' => $row['status'],
                    'created_at' => $row['created_at'],
                    'payload' => json_decode($row['payload'], true) ?: new stdClass(),
                ];
            }
            respond(['ok' => true, 'requests' => $requests]);
            break;
        }
        case 'requestCardSwap': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $cardId = (int)($input['cardId'] ?? 0);
            $reason = trim((string)($input['reason'] ?? ''));
            $stmt = $pdo->prepare('SELECT c.id, c.player_id, pc.text AS phrase FROM cards c JOIN phrases_catalog pc ON pc.id = c.phrase_id WHERE c.id = ? LIMIT 1');
            $stmt->execute([$cardId]);
            $card = $stmt->fetch();
            if (!$card || (int)$card['player_id'] !== (int)$player['id']) {
                fail('Carta inválida', 400);
            }

            $payload = [
                'playerName' => $player['name'],
                'playerId' => (int)$player['id'],
                'cardId' => $cardId,
                'phrase' => $card['phrase'] ?: '...',
                'reason' => $reason !== '' ? $reason : 'Sin aclaración',
            ];
            $stmt = $pdo->prepare('INSERT INTO requests (room_id, type, status, payload, created_at) VALUES (?, "swap", "pending", ?, ?)');
            $stmt->execute([(int)$player['room_id'], json_encode($payload, JSON_UNESCAPED_UNICODE), now()]);
            push_event($pdo, (int)$player['room_id'], 'swap_requested', ['player' => $player['name'], 'phrase' => $payload['phrase']]);

            respond(['ok' => true, 'requestId' => (int)$pdo->lastInsertId()]);
            break;
        }
        case 'respondCardSwap': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $requestId = (int)($input['requestId'] ?? 0);
            $accept = (bool)($input['accept'] ?? false);
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede resolver', 403);
            }
            $req = load_request($pdo, $requestId);
            if ($req['type'] !== 'swap') {
                fail('Solicitud inválida', 400);
            }

            $stmt = $pdo->prepare('UPDATE requests SET status = "handled" WHERE id = ?');
            $stmt->execute([$requestId]);

            if ($accept) {
                $cardId = (int)($req['payload']['cardId'] ?? 0);
                if ($cardId) {
                    $stmt = $pdo->prepare('UPDATE cards SET state = "voided", resolved_at = ? WHERE id = ?');
                    $stmt->execute([now(), $cardId]);
                }
                if (!empty($req['payload']['playerId'])) {
                    deal_one($pdo, (int)$room['id'], (int)$req['payload']['playerId'], (int)$room['active_list_id']);
                }
                push_event($pdo, (int)$room['id'], 'swap_accepted', [
                    'player' => $req['payload']['playerName'] ?? '',
                    'phrase' => $req['payload']['phrase'] ?? '',
                ]);
            } else {
                push_event($pdo, (int)$room['id'], 'swap_rejected', [
                    'player' => $req['payload']['playerName'] ?? '',
                    'phrase' => $req['payload']['phrase'] ?? '',
                ]);
            }

            respond(['ok' => true]);
            break;
        }
        case 'requestAccusation': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $accusedId = (int)($input['accusedPlayerId'] ?? 0);
            $reason = trim((string)($input['reason'] ?? ''));
            $stmt = $pdo->prepare('SELECT id, name FROM players WHERE id = ? AND room_id = ? LIMIT 1');
            $stmt->execute([$accusedId, (int)$player['room_id']]);
            $accused = $stmt->fetch();
            if (!$accused) {
                fail('Jugador inválido', 400);
            }

            $payload = [
                'playerName' => $player['name'],
                'accusedId' => (int)$accused['id'],
                'accusedName' => $accused['name'],
                'reason' => $reason !== '' ? $reason : 'Sin aclaración',
            ];
            $stmt = $pdo->prepare('INSERT INTO requests (room_id, type, status, payload, created_at) VALUES (?, "accusation", "pending", ?, ?)');
            $stmt->execute([(int)$player['room_id'], json_encode($payload, JSON_UNESCAPED_UNICODE), now()]);
            push_event($pdo, (int)$player['room_id'], 'accusation_requested', ['player' => $player['name'], 'accused' => $accused['name']]);

            respond(['ok' => true, 'requestId' => (int)$pdo->lastInsertId()]);
            break;
        }
        case 'respondAccusation': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $requestId = (int)($input['requestId'] ?? 0);
            $actionType = (string)($input['action'] ?? '');
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede resolver', 403);
            }
            $req = load_request($pdo, $requestId);
            if ($req['type'] !== 'accusation') {
                fail('Solicitud inválida', 400);
            }

            $stmt = $pdo->prepare('UPDATE requests SET status = "handled" WHERE id = ?');
            $stmt->execute([$requestId]);

            if ($actionType === 'penalize') {
                if (!empty($req['payload']['accusedId'])) {
                    deal_one($pdo, (int)$room['id'], (int)$req['payload']['accusedId'], (int)$room['active_list_id']);
                }
                push_event($pdo, (int)$room['id'], 'accusation_penalized', [
                    'player' => $req['payload']['playerName'] ?? '',
                    'accused' => $req['payload']['accusedName'] ?? '',
                ]);
            } else {
                push_event($pdo, (int)$room['id'], 'accusation_dismissed', [
                    'player' => $req['payload']['playerName'] ?? '',
                    'accused' => $req['payload']['accusedName'] ?? '',
                ]);
            }

            respond(['ok' => true]);
            break;
        }
        case 'respondJoinRequest': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $requestId = (int)($input['requestId'] ?? 0);
            $mode = (string)($input['mode'] ?? '');
            $replaceId = isset($input['replacePlayerId']) ? (int)$input['replacePlayerId'] : null;
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede resolver', 403);
            }
            $req = load_request($pdo, $requestId);
            if ($req['type'] !== 'join') {
                fail('Solicitud inválida', 400);
            }

            $payload = $req['payload'];
            $stmt = $pdo->prepare('UPDATE requests SET status = "handled", payload = ? WHERE id = ?');

            if ($mode === 'reject') {
                $payload['decision'] = 'rejected';
                $stmt->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $requestId]);
                push_event($pdo, (int)$room['id'], 'join_rejected', ['name' => $payload['name'] ?? '']);
                respond(['ok' => true]);
            }

            if ($mode === 'replace') {
                if (!$replaceId) {
                    fail('Jugador a reemplazar inválido', 400);
                }
                $stmtPlayer = $pdo->prepare('SELECT id, isHost FROM players WHERE id = ? AND room_id = ? LIMIT 1');
                $stmtPlayer->execute([$replaceId, (int)$room['id']]);
                $target = $stmtPlayer->fetch();
                if (!$target) {
                    fail('Jugador a reemplazar inválido', 400);
                }
                $stmt = $pdo->prepare('UPDATE players SET name = ?, token = ?, created_at = ? WHERE id = ?');
                $stmt->execute([
                    $payload['name'] ?? 'Invitado',
                    $payload['token'] ?? rand_token(),
                    now(),
                    $replaceId,
                ]);
                $payload['decision'] = 'accepted';
                $stmt = $pdo->prepare('UPDATE requests SET status = "handled", payload = ? WHERE id = ?');
                $stmt->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $requestId]);
                push_event($pdo, (int)$room['id'], 'join_accepted', ['name' => $payload['name'] ?? '', 'mode' => 'replace']);
                respond(['ok' => true]);
            }

            $stmt = $pdo->prepare('INSERT INTO players (room_id, name, token, created_at) VALUES (?, ?, ?, ?)');
            $stmt->execute([
                (int)$room['id'],
                $payload['name'] ?? 'Invitado',
                $payload['token'] ?? rand_token(),
                now(),
            ]);
            $newPlayerId = (int)$pdo->lastInsertId();
            $payload['decision'] = 'accepted';
            $stmt = $pdo->prepare('UPDATE requests SET status = "handled", payload = ? WHERE id = ?');
            $stmt->execute([json_encode($payload, JSON_UNESCAPED_UNICODE), $requestId]);

            for ($i = 0; $i < 5; $i++) {
                $card = deal_one($pdo, (int)$room['id'], $newPlayerId, (int)$room['active_list_id']);
                if (!$card) {
                    break;
                }
            }
            push_event($pdo, (int)$room['id'], 'player_joined', ['name' => $payload['name'] ?? '']);
            push_event($pdo, (int)$room['id'], 'join_accepted', ['name' => $payload['name'] ?? '', 'mode' => 'new']);
            respond(['ok' => true]);
            break;
        }
        case 'penalizePlayer': {
            $player = require_player($pdo, (string)($input['token'] ?? ''));
            $playerId = (int)($input['playerId'] ?? 0);
            $reason = trim((string)($input['reason'] ?? ''));
            $room = require_room_by_id($pdo, (int)$player['room_id']);
            if ((int)$player['id'] !== (int)$room['host_player_id']) {
                fail('Solo el anfitrión puede penalizar', 403);
            }
            $stmt = $pdo->prepare('SELECT id, name FROM players WHERE id = ? AND room_id = ? LIMIT 1');
            $stmt->execute([$playerId, (int)$room['id']]);
            $target = $stmt->fetch();
            if (!$target) {
                fail('Jugador inválido', 400);
            }
            deal_one($pdo, (int)$room['id'], (int)$target['id'], (int)$room['active_list_id']);
            push_event($pdo, (int)$room['id'], 'player_penalized', [
                'player' => $target['name'],
                'reason' => $reason !== '' ? $reason : 'Sin motivo',
            ]);
            respond(['ok' => true]);
            break;
        }
        default:
            fail('Acción inválida', 404);
    }
} catch (Throwable $e) {
    fail($e->getMessage(), 500);
}
