/**
 * RoomClient — the player-side connection to the BarcodeGames room server.
 * Protocol: server/PROTOCOL.md
 *
 * Events: joined, message, hostAway, hostBack, closed, kicked, error, status ('connecting' | 'open' | 'reconnecting')
 */

class RoomClient {
  static defaultServerUrl() {
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    return local ? 'ws://localhost:8787' : 'wss://api.barcodegames.fun';
  }

  static apiUrl() {
    return RoomClient.defaultServerUrl().replace(/^ws/, 'http');
  }

  /** Look up a room without joining it. Resolves null if it doesn't exist. */
  static async lookup(code) {
    try {
      const res = await fetch(`${RoomClient.apiUrl()}/rooms/${encodeURIComponent(code)}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  }

  constructor(url = RoomClient.defaultServerUrl()) {
    this.url = url;
    this.ws = null;
    this.code = null;
    this.name = null;
    this.playerToken = null;
    this.player = null;
    this.game = null;
    this.ended = false;
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

  /** Join a room. Pass playerToken to rejoin as the same player. */
  join(code, name, playerToken = null) {
    this.code = code.trim().toUpperCase();
    this.name = name;
    this.playerToken = playerToken;
    this.ended = false;
    this._connect();
  }

  _connect() {
    this.emit('status', this.player ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryDelay = 1000;
      this._send({ type: 'player:join', code: this.code, name: this.name, playerToken: this.playerToken });
    };

    ws.onmessage = (e) => this._handle(JSON.parse(e.data));

    ws.onclose = () => {
      if (this.ws !== ws || this.ended) return;
      if (!this.player) {
        this.ended = true;
        this.emit('error', { code: 'OFFLINE', message: "Couldn't reach the game server. Try again in a moment." });
        return;
      }
      // Phone locked, wifi blip... rejoin with our token
      this.emit('status', 'reconnecting');
      setTimeout(() => this._connect(), this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 8000);
    };
  }

  _handle(msg) {
    switch (msg.type) {
      case 'room:joined':
        this.player = msg.player;
        this.playerToken = msg.playerToken;
        this.game = msg.game;
        this.emit('status', 'open');
        this.emit('joined', msg);
        break;
      case 'msg':
        this.emit('message', msg.data);
        break;
      case 'host:away':
        this.emit('hostAway');
        break;
      case 'host:back':
        this.emit('hostBack');
        break;
      case 'room:kicked':
        this._end();
        this.emit('kicked');
        break;
      case 'room:closed':
        this._end();
        this.emit('closed', msg.reason);
        break;
      case 'error':
        if (this.player && msg.code === 'ROOM_NOT_FOUND') {
          // Rejoining a room that ended while we were away
          this._end();
          this.emit('closed', 'ended');
          break;
        }
        if (!this.player) this._end();
        this.emit('error', msg);
        break;
    }
  }

  _end() {
    this.ended = true;
    if (this.ws) this.ws.close();
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Send game data to the host */
  send(data) {
    this._send({ type: 'send', data });
  }

  leave() {
    this._end();
  }
}

window.RoomClient = RoomClient;
