/**
 * Articulate — the TV side: lobby, rounds, turns, guesses, scores. Players draw and guess on their phones
 * (web/games/articulate/controller.js, which lists the messages between the two).
 *
 * Flow: lobby → (round banner → [pick → draw → result] for each player) × ROUNDS → win → lobby
 *
 * Fake players: up to AUTO_BOTS bots wander into the lobby by themselves (0 turns this off); a real player
 * arriving at a full lobby takes a bot's place.
 *
 * Dev keys: Space start / stop (adds bots if needed) · A add a bot · B next background texture · N next background colour · S start · K skip ahead (pick / end the turn) · W win screen · L back to the lobby
 */

const TITLE = 'Articulate';
const GAME_ID = 'articulate';
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const ROUNDS = 3;
const CHOICES = 3; // words offered to the drawer
const PICK_TIME = 15;
const DRAW_TIME = 80;
const RESULT_TIME = 7;
const BANNER_TIME = 2.5;
const DRAWER_GRACE = 8; // seconds a drawer can drop out before their turn ends
const AUTO_BOTS = 5; // fake players that join the lobby on their own
const BOT_NAMES = ['MAYA', 'LEO', 'PRIYA', 'SAM', 'ZOE', 'KAI', 'NOAH', 'RUBY', 'FINN', 'ELLA', 'OMAR', 'IVY', 'JUNO', 'MILO'];
const HINT_AT = [0.4, 0.6, 0.78]; // share of the drawing time gone when each hint letter appears
// Each player's bar colour (main) and the lighter colour behind their character (light)
const PLAYER_COLORS = [
  { main: '#b9a43a', light: '#f1e27a' },
  { main: '#4f86b9', light: '#a9d4f5' },
  { main: '#7a58b6', light: '#cbb0f1' },
  { main: '#c0594f', light: '#f7b0a6' },
  { main: '#69a74f', light: '#bdeb9f' },
  { main: '#3c9c97', light: '#9fe4dd' },
  { main: '#c25f92', light: '#f5b1d3' },
  { main: '#8a6a43', light: '#e8c896' },
];

const round5 = (n) => Math.round(n / 5) * 5;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

class Game {
  constructor() {
    this.view = new View();
    this.view.setLogo(TITLE);
    this.board = new DrawBoard(this.view.el.canvas);
    this.view.onResize = () => this.board.resize(this.view.boardPixels());
    this.view.onResize();

    this.players = [];
    this.phase = 'lobby';
    this.step = 0; // bumps on every phase change, so stale timers do nothing
    this.round = 0;
    this.queue = [];
    this.drawer = null;
    this.word = '';
    this.choices = [];
    this.used = new Set();
    this.revealed = new Set();
    this.hintTimes = [];
    this.deadline = 0;
    this.vipId = null;
    this.code = null;
    this.botCount = 0;

    this.connect();
    setInterval(() => this.tick(), 200);
    document.addEventListener('keydown', (e) => this.devKey(e));
    this.toLobby();
  }

  /* ---------- Network ---------- */

  connect() {
    const net = new RoomHost({ game: GAME_ID, maxPlayers: MAX_PLAYERS });
    this.net = net;
    net.on('code', (code) => {
      // A new code means the old room is gone (the server lost us), and its players with it
      if (this.code && code !== this.code) {
        this.players = [];
        this.toLobby();
      }
      this.code = code;
      this.view.setRoomCode(code);
    });
    net.on('status', (status) => this.view.setOnline(status === 'open'));
    net.on('join', (info) => this.addPlayer(info));
    net.on('reconnect', (info) => this.playerBack(info));
    net.on('leave', (id) => this.playerGone(id));
    net.on('message', (id, data) => this.onMessage(id, data));
    window.addEventListener('beforeunload', () => net.close());
    net.connect();
  }

  byId(id) {
    return this.players.find((p) => p.id === id);
  }

  send(p, data) {
    if (p && !p.bot && p.connected) this.net.sendTo(p.id, data);
  }

  onMessage(id, data) {
    const p = this.byId(id);
    if (!p || !data || typeof data !== 'object') return;
    switch (data.type) {
      case 'start':
        if (this.phase === 'lobby' && p.id === this.vipId) this.startGame();
        break;
      case 'again':
        if (this.phase === 'win' && p.id === this.vipId) this.toLobby();
        break;
      case 'pick':
        if (this.phase === 'pick' && p === this.drawer) this.pickWord(Number(data.index));
        break;
      case 'line':
      case 'pts':
      case 'fill':
      case 'undo':
      case 'clear':
        if (this.phase === 'draw' && p === this.drawer) this.drawOp(data);
        break;
      case 'guess':
        this.guess(p, data.text);
        break;
    }
  }

  /* ---------- Players ---------- */

  addPlayer(info, bot = false) {
    // a real player takes a bot's place in a full lobby
    if (!bot && this.phase === 'lobby' && this.players.length >= MAX_PLAYERS) {
      const seat = [...this.players].reverse().find((p) => p.bot);
      if (seat) this.players = this.players.filter((p) => p !== seat);
    }
    if (this.phase !== 'lobby' || this.players.length >= MAX_PLAYERS || this.byId(info.id)) {
      if (!bot) this.net.kick(info.id);
      return;
    }
    const takenColors = new Set(this.players.map((p) => p.color));
    const takenCharacters = new Set(this.players.map((p) => p.character));
    const freeCharacters = [...Array(Characters.count).keys()].filter((i) => !takenCharacters.has(i));
    this.players.push({
      id: info.id,
      name: info.name,
      color: PLAYER_COLORS.find((c) => !takenColors.has(c)) || pickRandom(PLAYER_COLORS),
      character: pickRandom(freeCharacters.length ? freeCharacters : [...Array(Characters.count).keys()]),
      bot,
      connected: true,
      score: 0,
      turnPoints: 0,
      guessed: false,
      guesses: [],
      lastGuessAt: 0,
    });
    this.lobbyChanged();
  }

  playerBack(info) {
    const p = this.byId(info.id);
    if (!p) return this.addPlayer(info);
    p.connected = true;
    if (this.phase === 'lobby') this.lobbyChanged();
    else this.view.renderPlayers(this.players, this.drawer && this.drawer.id);
    this.updateVip();
    this.sync(p, true);
  }

  playerGone(id) {
    const p = this.byId(id);
    if (!p) return;
    if (this.phase === 'lobby') {
      // Leaving in the lobby frees the spot; once the game is on, players can reconnect
      this.players = this.players.filter((x) => x !== p);
      this.net.kick(id);
      this.lobbyChanged();
      return;
    }
    p.connected = false;
    this.updateVip();
    this.view.renderPlayers(this.players, this.drawer && this.drawer.id);
    if (p === this.drawer && this.phase === 'pick') this.nextTurn();
    else if (p === this.drawer && this.phase === 'draw') {
      const step = this.step;
      setTimeout(() => { if (this.step === step && !p.connected) this.endTurn(); }, DRAWER_GRACE * 1000);
    } else if (this.phase === 'draw') this.checkAllGuessed();
  }

  lobbyChanged() {
    this.updateVip();
    this.view.renderLobby(this.players, MAX_PLAYERS, this.vipId);
    this.players.forEach((p) => this.sync(p));
    this.botsWander();
  }

  /** The VIP (first real player still here) starts the game from their phone */
  updateVip() {
    const vip = this.players.find((p) => !p.bot && p.connected);
    const id = vip ? vip.id : null;
    if (id === this.vipId) return;
    const old = this.byId(this.vipId);
    this.vipId = id;
    this.view.vipId = id;
    if (this.phase !== 'lobby') this.view.renderPlayers(this.players, this.drawer && this.drawer.id);
    if (this.phase === 'lobby') this.view.renderLobby(this.players, MAX_PLAYERS, this.vipId);
    if (old) this.sync(old);
    if (vip) this.sync(vip);
  }

  /* ---------- Phone screens ---------- */

  /** What a player's phone should show right now */
  screenFor(p) {
    const time = this.deadline ? Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000)) : null;
    const base = { type: 'screen', id: this.step, time };
    switch (this.phase) {
      case 'lobby':
        return { ...base, screen: 'lobby', bg: 'lobby', canStart: this.players.length >= MIN_PLAYERS };
      case 'countdown':
        return { ...base, screen: 'wait', bg: 'lobby' };
      case 'round':
        return { ...base, screen: 'wait', bg: 'pick' };
      case 'pick':
        return p === this.drawer
          ? { ...base, screen: 'choose', bg: 'pick', words: this.choices }
          : { ...base, screen: 'wait', bg: 'pick' };
      case 'draw':
        return p === this.drawer
          ? { ...base, screen: 'draw', bg: 'draw', word: this.word }
          : { ...base, screen: 'guess', bg: 'draw', guesses: p.guesses, solved: p.guessed ? this.word : null };
      case 'result':
        return { ...base, screen: 'result', bg: 'draw', word: this.word };
      case 'win':
        return { ...base, screen: 'end', bg: 'win' };
    }
    return { ...base, screen: 'wait', bg: 'lobby' };
  }

  sync(p, withDrawing = false) {
    if (!p || p.bot || !p.connected) return;
    this.send(p, { type: 'profile', color: p.color.main, light: p.color.light, character: p.character, vip: p.id === this.vipId });
    this.send(p, this.screenFor(p));
    // A drawer coming back mid-turn gets their picture back
    if (withDrawing && this.phase === 'draw' && p === this.drawer) {
      Game.chunkOps(this.board.ops).forEach((ops, i) => this.send(p, { type: 'ops', ops, first: i === 0 }));
    }
  }

  syncAll() {
    this.players.forEach((p) => this.sync(p));
  }

  /** Split the drawing into messages well under the server's 16 KB limit */
  static chunkOps(ops) {
    const pieces = [];
    ops.forEach((op) => {
      if (op.t !== 'l' || op.p.length <= 1200) return pieces.push(op);
      for (let i = 0; i < op.p.length - 2; i += 1198) pieces.push({ ...op, p: op.p.slice(i, i + 1200) });
    });
    const chunks = [[]];
    let size = 0;
    pieces.forEach((op) => {
      const len = JSON.stringify(op).length;
      if (size + len > 10000 && chunks[chunks.length - 1].length) {
        chunks.push([]);
        size = 0;
      }
      chunks[chunks.length - 1].push(op);
      size += len;
    });
    return chunks;
  }

  /* ---------- Flow ---------- */

  setPhase(phase) {
    this.phase = phase;
    this.step++;
    this.deadline = 0;
    this.view.setTimer(null);
  }

  after(seconds, fn) {
    const step = this.step;
    setTimeout(() => { if (this.step === step) fn(); }, seconds * 1000);
  }

  toLobby() {
    this.setPhase('lobby');
    // drop anyone who left during the game
    this.players.filter((p) => !p.connected).forEach((p) => this.net.kick(p.id));
    this.players = this.players.filter((p) => p.connected);
    this.players.forEach((p) => {
      p.score = 0;
      p.turnPoints = 0;
      p.guessed = false;
      p.guesses = [];
    });
    this.drawer = null;
    this.round = 0;
    this.net.lock(false);
    this.view.countdown(null);
    this.view.show('lobby', 'lobby');
    this.lobbyChanged();
  }

  /** Fake players drift into the lobby one at a time, up to AUTO_BOTS */
  botsWander() {
    clearTimeout(this.botTimer);
    const bots = this.players.filter((p) => p.bot).length;
    if (this.phase !== 'lobby' || bots >= AUTO_BOTS || this.players.length >= MAX_PLAYERS) return;
    this.botTimer = setTimeout(() => {
      if (this.phase === 'lobby') this.addBot(); // joining runs lobbyChanged, which schedules the next
    }, 1500 + Math.random() * 2500);
  }

  /** 3, 2, 1 on the TV, then the game starts */
  startGame() {
    if (this.phase !== 'lobby' || this.players.length < MIN_PLAYERS) return;
    clearTimeout(this.botTimer);
    this.net.lock(true);
    this.setPhase('countdown');
    this.syncAll();
    const count = (n) => {
      if (!n) {
        this.view.countdown(null);
        return this.beginGame();
      }
      this.view.countdown(n);
      this.after(1, () => count(n - 1));
    };
    count(3);
  }

  beginGame() {
    this.round = 0;
    this.used.clear();
    this.players.forEach((p) => { p.score = 0; });
    this.view.feedClear();
    this.nextRound();
  }

  nextRound() {
    this.round++;
    if (this.round > ROUNDS) return this.showWin();
    this.queue = this.players.map((p) => p.id);
    this.setPhase('round');
    this.drawer = null;
    this.resetTurn();
    this.board.clear();
    this.view.show('game', 'pick');
    this.view.setRound(this.round, ROUNDS);
    this.view.setStatus('');
    this.view.setHint(null);
    this.view.showRoundBanner(this.round, ROUNDS);
    this.view.renderPlayers(this.players, null);
    this.syncAll();
    this.after(BANNER_TIME, () => this.nextTurn());
  }

  resetTurn() {
    this.word = '';
    this.players.forEach((p) => {
      p.guessed = false;
      p.turnPoints = 0;
      p.guesses = [];
      p.nextGuessAt = 0;
    });
  }

  nextTurn() {
    let next = null;
    while (this.queue.length && !next) {
      const p = this.byId(this.queue.shift());
      if (p && p.connected) next = p;
    }
    if (!next) return this.nextRound();

    this.drawer = next;
    this.resetTurn();
    this.choices = this.wordChoices();
    this.setPhase('pick');
    this.deadline = Date.now() + PICK_TIME * 1000;
    this.board.clear();
    this.view.show('game', 'pick');
    this.view.setStatus('');
    this.view.setHint(null);
    this.view.showPicking(next);
    this.view.renderPlayers(this.players, next.id);
    this.syncAll();
    if (next.bot) this.after(1 + Math.random() * 2, () => this.pickWord(-1));
  }

  wordChoices() {
    let pool = WORDS.filter((w) => !this.used.has(w));
    if (pool.length < CHOICES) {
      this.used.clear();
      pool = WORDS.slice();
    }
    return pool.sort(() => Math.random() - 0.5).slice(0, CHOICES);
  }

  pickWord(index) {
    if (this.phase !== 'pick') return;
    const word = this.choices[index] || pickRandom(this.choices);
    this.word = word;
    this.used.add(word);
    this.revealed = new Set();
    const letters = [...word].filter((ch) => /[a-z]/i.test(ch)).length;
    const hints = Math.min(HINT_AT.length, Math.floor(letters / 3));
    this.hintTimes = HINT_AT.slice(0, hints).map((f) => f * DRAW_TIME * 1000);

    this.setPhase('draw');
    this.drawStart = Date.now();
    this.deadline = this.drawStart + DRAW_TIME * 1000;
    this.board.clear();
    this.view.overlay(null);
    this.view.show('game', 'draw');
    this.view.setStatus('');
    this.view.setHint(word, this.revealed);
    this.view.renderPlayers(this.players, this.drawer.id);
    this.syncAll();
    if (this.drawer.bot) this.botPen = null;
  }

  drawOp(data) {
    switch (data.type) {
      case 'line': this.board.add({ t: 'l', c: data.c, s: data.s, p: data.p }); break;
      case 'pts': this.board.extend(data.p); break;
      case 'fill': this.board.add({ t: 'f', c: data.c, x: data.x, y: data.y }); break;
      case 'undo': this.board.undo(); break;
      case 'clear': this.board.clear(); break;
    }
  }

  revealLetter() {
    const hidden = [...this.word].map((ch, i) => i).filter((i) => /[a-z]/i.test(this.word[i]) && !this.revealed.has(i));
    if (hidden.length <= 1) return;
    this.revealed.add(pickRandom(hidden));
    this.view.setHint(this.word, this.revealed);
  }

  guess(p, raw) {
    if (this.phase !== 'draw' || p === this.drawer || p.guessed) return;
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const now = Date.now();
    if (!text || now - p.lastGuessAt < 350) return;
    p.lastGuessAt = now;

    const result = Game.check(text, this.word);
    if (result === 'correct') {
      const left = Math.max(0, this.deadline - now) / (DRAW_TIME * 1000);
      const order = this.players.filter((x) => x.guessed).length;
      p.turnPoints = round5(Math.max(50, 100 + 400 * left - 20 * order));
      p.guessed = true;
      this.view.feedAdd(p, 'guessed the word');
      this.view.renderPlayers(this.players, this.drawer.id);
      this.sync(p);
      this.checkAllGuessed();
    } else {
      p.guesses.push({ text, close: result === 'close' });
      this.view.feedAdd(p, text);
      this.sync(p);
    }
  }

  checkAllGuessed() {
    const guessers = this.players.filter((p) => p !== this.drawer && p.connected);
    if (guessers.length && guessers.every((p) => p.guessed)) {
      this.endTurn();
    }
  }

  /** 'correct', 'close' (one letter off) or 'wrong'. Case, spaces and dashes don't matter. */
  static check(guess, word) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const a = norm(guess);
    const b = norm(word);
    if (a === b) return 'correct';
    if (b.length >= 4 && Game.distance(a, b) <= (b.length >= 9 ? 2 : 1)) return 'close';
    return 'wrong';
  }

  /** Edits between two words; swapping two neighbouring letters counts as one */
  static distance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  endTurn() {
    if (this.phase !== 'draw') return;
    const guessers = this.players.filter((p) => p !== this.drawer);
    const total = guessers.reduce((sum, p) => sum + p.turnPoints, 0);
    this.drawer.turnPoints = guessers.length ? round5(total / guessers.length) : 0;
    this.players.forEach((p) => { p.score += p.turnPoints; });

    this.setPhase('result');
    this.view.setStatus('');
    this.view.setHint(this.word, this.revealed, true);
    this.view.showTurnResult(this.word);
    this.view.renderPlayers(this.players, null);
    this.syncAll();
    this.after(RESULT_TIME, () => this.nextTurn());
  }

  showWin() {
    this.setPhase('win');
    this.drawer = null;
    this.view.renderWin(this.players);
    this.view.show('win', 'win');
    this.syncAll();
  }

  /* ---------- Clock ---------- */

  tick() {
    const now = Date.now();
    if (this.deadline) {
      const left = Math.max(0, Math.ceil((this.deadline - now) / 1000));
      this.view.setTimer(left);
    }
    if (this.phase === 'draw') {
      while (this.hintTimes.length && now - this.drawStart >= this.hintTimes[0]) {
        this.hintTimes.shift();
        this.revealLetter();
      }
    }
    if (this.deadline && now >= this.deadline) {
      if (this.phase === 'pick') this.pickWord(-1);
      else if (this.phase === 'draw') this.endTurn();
    }
    this.botTick(now);
  }

  /* ---------- Dev: keys and bots ---------- */

  devKey(e) {
    if (e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (this.phase === 'lobby') {
        while (this.players.length < MIN_PLAYERS) this.addBot();
        this.startGame();
      } else this.toLobby();
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'a': this.addBot(); break;
      case 'b': this.view.nextTexture(); break;
      case 's': this.startGame(); break;
      case 'n': this.view.nextColor(); break;
      case 'k':
        if (this.phase === 'pick') this.pickWord(-1);
        else if (this.phase === 'draw') this.endTurn();
        else if (this.phase === 'round' || this.phase === 'result') this.nextTurn();
        break;
      case 'w': if (this.phase !== 'lobby') this.showWin(); break;
      case 'l': this.toLobby(); break;
    }
  }

  addBot() {
    const n = ++this.botCount;
    const taken = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.filter((x) => !taken.has(x)).sort(() => Math.random() - 0.5)[0] || `BOT ${n}`;
    this.addPlayer({ id: `bot-${n}`, name }, true);
  }

  botTick(now) {
    if (this.phase !== 'draw') return;
    const elapsed = (now - this.drawStart) / (DRAW_TIME * 1000);
    this.players.forEach((b) => {
      if (!b.bot || b === this.drawer || b.guessed) return;
      if (!b.nextGuessAt) b.nextGuessAt = now + 2000 + Math.random() * 5000;
      if (now < b.nextGuessAt) return;
      b.nextGuessAt = now + 2500 + Math.random() * 6000;
      this.guess(b, Math.random() < 0.08 + 0.5 * elapsed ? this.word : pickRandom(WORDS));
    });
    if (this.drawer && this.drawer.bot) this.botDraw();
  }

  /** A bot drawer wanders the pen around in random colours */
  botDraw() {
    let pen = this.botPen;
    if (!pen || Math.random() < 0.06) {
      pen = this.botPen = { x: 200 + Math.random() * 600, y: 200 + Math.random() * 600, a: Math.random() * Math.PI * 2 };
      if (Math.random() < 0.1) return this.drawOp({ type: 'fill', c: Math.floor(Math.random() * 16), x: pen.x, y: pen.y });
      this.drawOp({ type: 'line', c: Math.floor(Math.random() * 16), s: Math.floor(Math.random() * 3), p: [pen.x, pen.y] });
    }
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pen.a += (Math.random() - 0.5) * 0.9;
      pen.x = Math.max(30, Math.min(970, pen.x + Math.cos(pen.a) * 18));
      pen.y = Math.max(30, Math.min(970, pen.y + Math.sin(pen.a) * 18));
      pts.push(Math.round(pen.x), Math.round(pen.y));
    }
    this.drawOp({ type: 'pts', p: pts });
  }
}

window.game = new Game();
