/**
 * RoomHost — the host-side connection to the BarcodeGames room server, shared by every game.
 * Protocol: server/PROTOCOL.md
 *
 *   const room = new RoomHost({ game: 'dying-to-know', maxPlayers: 8 });
 *   room.on('code', (code) => showCode(code));
 *   room.on('join', (player) => addPlayer(player));
 *   room.on('message', (playerId, data) => handleAnswer(playerId, data));
 *   room.connect();
 *   room.broadcast({ type: 'question', ... });
 *
 * Events: code, join, reconnect, leave, remove, message, status ('connecting' | 'open' | 'reconnecting' | 'closed'), error
 */

class RoomHost {
  static defaultServerUrl() {
    if (window.barcode && window.barcode.serverUrl) return window.barcode.serverUrl;
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    return local ? 'ws://localhost:8787' : 'wss://api.barcodegames.fun';
  }

  constructor({ game, maxPlayers = 8, url = RoomHost.defaultServerUrl() }) {
    this.game = game;
    this.maxPlayers = maxPlayers;
    this.url = url;
    this.code = null;
    this.hostToken = null;
    /** @type {Map<string, {id: string, name: string, connected: boolean}>} */
    this.players = new Map();
    this.ws = null;
    this.closedByUs = false;
    this.retryDelay = 1000;
    this.listeners = {};
  }

  on(event, fn) {
    (this.listeners[event] = this.listeners[event] || []).push(fn);
    return this;
  }

  emit(event, ...args) {
    (this.listeners[event] || []).forEach((fn) => fn(...args));
  }

  connect() {
    this.closedByUs = false;
    this.emit('status', this.code ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = 1000;
      if (this.code && this.hostToken) {
        this._send({ type: 'host:resume', code: this.code, hostToken: this.hostToken });
      } else {
        this._send({ type: 'host:create', game: this.game, maxPlayers: this.maxPlayers });
      }
    };

    ws.onmessage = (e) => this._handle(JSON.parse(e.data));

    ws.onclose = () => {
      if (this.ws !== ws || this.closedByUs) return;
      this.emit('status', 'reconnecting');
      setTimeout(() => this.connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 8000);
    };
  }

  _handle(msg) {
    switch (msg.type) {
      case 'room:created':
        this.code = msg.code;
        this.hostToken = msg.hostToken;
        this.emit('status', 'open');
        this.emit('code', msg.code);
        break;
      case 'room:resumed':
        msg.players.forEach((p) => this.players.set(p.id, p));
        this.emit('status', 'open');
        break;
      case 'player:joined':
        this.players.set(msg.player.id, msg.player);
        this.emit('join', msg.player);
        break;
      case 'player:reconnected':
        this.players.set(msg.player.id, msg.player);
        this.emit('reconnect', msg.player);
        break;
      case 'player:left': {
        const p = this.players.get(msg.playerId);
        if (p) p.connected = false;
        this.emit('leave', msg.playerId);
        break;
      }
      case 'player:removed':
        this.players.delete(msg.playerId);
        this.emit('remove', msg.playerId);
        break;
      case 'msg':
        this.emit('message', msg.from, msg.data);
        break;
      case 'room:closed':
        // Room expired while we were away: start a fresh one
        this.code = null;
        this.hostToken = null;
        this.players.clear();
        if (!this.closedByUs) this.ws.close();
        break;
      case 'error':
        if (msg.code === 'ROOM_NOT_FOUND' && this.code) {
          this.code = null;
          this.hostToken = null;
          this.players.clear();
          this._send({ type: 'host:create', game: this.game, maxPlayers: this.maxPlayers });
        }
        this.emit('error', msg);
        break;
    }
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Send game data to one player */
  sendTo(playerId, data) { this._send({ type: 'send', to: playerId, data }); }

  /** Send game data to every player */
  broadcast(data) { this._send({ type: 'send', to: 'all', data }); }

  /** Stop new players joining (reconnects still allowed) */
  lock(locked = true) { this._send({ type: 'room:lock', locked }); }

  kick(playerId) { this._send({ type: 'player:kick', playerId }); }

  close() {
    this.closedByUs = true;
    this._send({ type: 'room:close' });
    if (this.ws) this.ws.close();
    this.emit('status', 'closed');
  }
}

window.RoomHost = RoomHost;
