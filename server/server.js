/**
 * BarcodeGames room server — shared by every game.
 *
 * A host app (the TV screen) creates a room for its game and gets a 4-letter code.
 * Players join that code from barcodegames.fun. The server only routes messages
 * between host and players; all game logic lives in the host app.
 *
 * Public at wss://api.barcodegames.fun via Cloudflare Tunnel. Protocol: PROTOCOL.md
 */

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8787;
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels, so codes can't spell words
const CODE_LENGTH = 4;
const HOST_GRACE_MS = 60_000; // room survives a host wifi blip / app reload
const EMPTY_ROOM_MS = 6 * 60 * 60_000; // hard cap on room lifetime
const PING_MS = 25_000; // keep sockets alive under Cloudflare's ~100s idle timeout
const MAX_NAME = 12;
const DEFAULT_MAX_PLAYERS = 8;

/** @type {Map<string, Room>} */
const rooms = new Map();

/* =========================================
   Helpers
   ========================================= */

const token = () => crypto.randomBytes(16).toString('hex');

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function fail(ws, code, message) {
  send(ws, { type: 'error', code, message });
}

function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, connected: !!p.ws };
}

function roomInfo(room) {
  return {
    code: room.code,
    game: room.game,
    players: room.players.size,
    maxPlayers: room.maxPlayers,
    locked: room.locked,
  };
}

/* =========================================
   Room lifecycle
   ========================================= */

class Room {
  constructor(game, maxPlayers) {
    this.code = newCode();
    this.game = game;
    this.maxPlayers = maxPlayers;
    this.hostToken = token();
    this.host = null;
    this.locked = false;
    /** @type {Map<string, {id: string, name: string, token: string, ws: any}>} */
    this.players = new Map();
    this.hostAwayTimer = null;
    this.lifetimeTimer = setTimeout(() => this.close('expired'), EMPTY_ROOM_MS);
  }

  attachHost(ws) {
    clearTimeout(this.hostAwayTimer);
    if (this.host && this.host !== ws) this.host.close(4000, 'replaced');
    this.host = ws;
    ws.role = 'host';
    ws.room = this;
  }

  hostLeft() {
    this.host = null;
    this.broadcast({ type: 'host:away' });
    this.hostAwayTimer = setTimeout(() => this.close('host-left'), HOST_GRACE_MS);
  }

  broadcast(msg) {
    for (const p of this.players.values()) send(p.ws, msg);
  }

  close(reason) {
    clearTimeout(this.hostAwayTimer);
    clearTimeout(this.lifetimeTimer);
    this.broadcast({ type: 'room:closed', reason });
    send(this.host, { type: 'room:closed', reason });
    for (const p of this.players.values()) if (p.ws) p.ws.room = null;
    if (this.host) this.host.room = null;
    rooms.delete(this.code);
    log(`room ${this.code} closed (${reason})`);
  }
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

/* =========================================
   Message handlers
   ========================================= */

const handlers = {
  // ---- Host ----
  'host:create'(ws, msg) {
    if (ws.room) return fail(ws, 'BAD_REQUEST', 'Already in a room');
    const game = String(msg.game || '');
    if (!/^[a-z0-9-]{1,32}$/.test(game)) return fail(ws, 'BAD_REQUEST', 'Invalid game id');
    const maxPlayers = Math.min(Math.max(Number(msg.maxPlayers) || DEFAULT_MAX_PLAYERS, 1), 100);

    const room = new Room(game, maxPlayers);
    rooms.set(room.code, room);
    room.attachHost(ws);
    send(ws, { type: 'room:created', code: room.code, hostToken: room.hostToken, game, maxPlayers });
    log(`room ${room.code} created for ${game}`);
  },

  'host:resume'(ws, msg) {
    const room = rooms.get(String(msg.code || '').toUpperCase());
    if (!room || room.hostToken !== msg.hostToken) return fail(ws, 'ROOM_NOT_FOUND', 'Room no longer exists');
    room.attachHost(ws);
    send(ws, { type: 'room:resumed', ...roomInfo(room), players: [...room.players.values()].map(publicPlayer) });
    room.broadcast({ type: 'host:back' });
  },

  'room:lock'(ws, msg) {
    if (ws.role !== 'host' || !ws.room) return;
    ws.room.locked = msg.locked !== false;
  },

  'player:kick'(ws, msg) {
    if (ws.role !== 'host' || !ws.room) return;
    const p = ws.room.players.get(msg.playerId);
    if (!p) return;
    send(p.ws, { type: 'room:kicked' });
    if (p.ws) p.ws.room = null;
    ws.room.players.delete(p.id);
    send(ws, { type: 'player:removed', playerId: p.id });
  },

  'room:close'(ws) {
    if (ws.role === 'host' && ws.room) ws.room.close('host-ended');
  },

  // ---- Player ----
  'player:join'(ws, msg) {
    if (ws.room) return fail(ws, 'BAD_REQUEST', 'Already in a room');
    const room = rooms.get(String(msg.code || '').trim().toUpperCase());
    if (!room) return fail(ws, 'ROOM_NOT_FOUND', "That room code doesn't exist");

    // Reconnect with a saved token (phone locked, page refreshed...)
    const existing = msg.playerToken && [...room.players.values()].find((p) => p.token === msg.playerToken);
    if (existing) {
      if (existing.ws && existing.ws !== ws) existing.ws.close(4000, 'replaced');
      existing.ws = ws;
      ws.role = 'player';
      ws.room = room;
      ws.playerId = existing.id;
      send(ws, { type: 'room:joined', code: room.code, game: room.game, player: publicPlayer(existing), playerToken: existing.token, reconnected: true, hostConnected: !!room.host });
      send(room.host, { type: 'player:reconnected', player: publicPlayer(existing) });
      return;
    }

    const name = cleanName(msg.name);
    if (!name) return fail(ws, 'BAD_REQUEST', 'Enter a name');
    if (room.locked) return fail(ws, 'ROOM_LOCKED', 'That game has already started');
    if (room.players.size >= room.maxPlayers) return fail(ws, 'ROOM_FULL', 'That room is full');
    const lower = name.toLowerCase();
    if ([...room.players.values()].some((p) => p.name.toLowerCase() === lower)) {
      return fail(ws, 'NAME_TAKEN', 'Someone in that room already has that name');
    }

    const player = { id: token().slice(0, 8), name, token: token(), ws };
    room.players.set(player.id, player);
    ws.role = 'player';
    ws.room = room;
    ws.playerId = player.id;
    send(ws, { type: 'room:joined', code: room.code, game: room.game, player: publicPlayer(player), playerToken: player.token, reconnected: false, hostConnected: !!room.host });
    send(room.host, { type: 'player:joined', player: publicPlayer(player) });
  },

  // ---- Both: game messages ----
  send(ws, msg) {
    const room = ws.room;
    if (!room) return;
    if (ws.role === 'host') {
      if (msg.to === 'all' || msg.to === undefined) room.broadcast({ type: 'msg', data: msg.data });
      else send(room.players.get(msg.to)?.ws, { type: 'msg', data: msg.data });
    } else {
      send(room.host, { type: 'msg', from: ws.playerId, data: msg.data });
    }
  },
};

function onClose(ws) {
  const room = ws.room;
  if (!room) return;
  if (ws.role === 'host' && room.host === ws) {
    room.hostLeft();
  } else if (ws.role === 'player') {
    const p = room.players.get(ws.playerId);
    if (p && p.ws === ws) {
      p.ws = null;
      send(room.host, { type: 'player:left', playerId: p.id });
    }
  }
}

/* =========================================
   HTTP (health + room lookup) & WebSocket
   ========================================= */

const server = http.createServer((req, res) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const url = new URL(req.url, 'http://x');

  const roomMatch = url.pathname.match(/^\/rooms\/([A-Za-z]{4})$/);
  if (roomMatch) {
    const room = rooms.get(roomMatch[1].toUpperCase());
    res.writeHead(room ? 200 : 404, headers);
    return res.end(JSON.stringify(room ? roomInfo(room) : { error: 'ROOM_NOT_FOUND' }));
  }

  res.writeHead(200, headers);
  res.end(JSON.stringify({ ok: true, service: 'barcodegames-api', rooms: rooms.size }));
});

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return fail(ws, 'BAD_REQUEST', 'Invalid JSON'); }
    const handler = handlers[msg && msg.type];
    if (!handler) return fail(ws, 'BAD_REQUEST', `Unknown message type: ${msg && msg.type}`);
    handler(ws, msg);
  });
  ws.on('close', () => onClose(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_MS);

server.listen(PORT, '127.0.0.1', () => log(`barcodegames server on 127.0.0.1:${PORT}`));
