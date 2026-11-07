/**
 * Articulate (3D) — the TV side's rules: lobby, turns, words, guesses and scores. The street scene (market.js) draws it
 * all through the `stage` it hands to startGame; players draw and guess on their phones (web/games/articulate/
 * controller.js, which lists the messages between the two).
 *
 * Flow: lobby (everyone draws a self-portrait) → up and down onto the first easel →
 *       for each player in turn, ROUNDS times: [pick → draw → result → scoreboard → glide on to the next easel] →
 *       the last scoreboard names the winner → (VIP) back to the lobby
 *
 * Dev keys: Space start (adds bots if needed) / back to the lobby · B add a bot · K skip ahead · L back to the lobby
 */

const GAME_ID = 'articulate';
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const ROUNDS = 3;
const CHOICES = 3; // words offered to the drawer
const PICK_TIME = 15;
const RESULT_TIME = 4; // the word stays up this long before the scoreboard
const SCORE_TIME = 7; // how long the scoreboard stays down between turns
const DRAWER_GRACE = 8; // seconds a drawer can drop out before their turn ends
const HINT_AT = [0.4, 0.6, 0.78]; // share of the drawing time gone when each hint letter turns over
const BOT_NAMES = ['MAYA', 'LEO', 'PRIYA', 'SAM', 'ZOE', 'KAI', 'NOAH', 'RUBY', 'FINN', 'ELLA', 'OMAR', 'IVY'];
const CHARACTERS = 10; // the phone's header characters (web/games/articulate/characters.js)

const round5 = (n) => Math.round(n / 5) * 5;
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
/** a colour halfway to white, for the phone's lighter shade */
const lighter = (hex) => '#' + [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) + 255) / 2).toString(16).padStart(2, '0')).join('');

export function startGame(stage) {
  const DRAW_TIME = stage.drawTime;
  const state = {
    players: [], phase: 'lobby', step: 0, round: 0, queue: [], drawer: null, word: '', choices: [],
    used: new Set(), revealed: new Set(), hintTimes: [], deadline: 0, drawStart: 0, vipId: null, code: null, botCount: 0,
  };

  /* ---------- Network ---------- */

  const net = new RoomHost({ game: GAME_ID, maxPlayers: MAX_PLAYERS });
  net.on('code', (code) => {
    // a new code means the old room is gone (the server lost us), and its players with it
    if (state.code && code !== state.code) {
      [...state.players].forEach((p) => stage.seatLeave(p.seat));
      state.players = [];
      if (state.phase !== 'lobby') backToLobby();
    }
    state.code = code;
    stage.setRoomCode(code);
  });
  net.on('join', (info) => addPlayer(info));
  net.on('reconnect', (info) => playerBack(info));
  net.on('leave', (id) => playerGone(id));
  net.on('message', (id, data) => onMessage(id, data));
  window.addEventListener('beforeunload', () => net.close());
  net.connect();
  window.__game = state; // dev: look inside from the console

  const byId = (id) => state.players.find((p) => p.id === id);
  const send = (p, data) => { if (p && !p.bot && p.connected) net.sendTo(p.id, data); };

  function onMessage(id, data) {
    const p = byId(id);
    if (!p || !data || typeof data !== 'object') return;
    switch (data.type) {
      case 'start':
        if (state.phase === 'lobby' && p.id === state.vipId) startPlaying();
        break;
      case 'again':
        if (state.phase === 'win' && p.id === state.vipId) backToLobby();
        break;
      case 'pick':
        if (state.phase === 'pick' && p === state.drawer) pickWord(Number(data.index));
        break;
      case 'line': case 'pts': case 'fill': case 'undo': case 'clear':
        if (state.phase === 'lobby') stage.seatDraw(p.seat, data); // their self-portrait
        else if (state.phase === 'draw' && p === state.drawer) stage.draw(data);
        break;
      case 'guess':
        guess(p, data.text);
        break;
    }
  }

  /* ---------- Players ---------- */

  function addPlayer(info, bot = false) {
    const free = [...Array(stage.seats).keys()].find((i) => !state.players.some((p) => p.seat === i));
    if (state.phase !== 'lobby' || free === undefined || byId(info.id)) {
      if (!bot) net.kick(info.id);
      return;
    }
    const color = stage.colours[free];
    const p = {
      id: info.id, name: String(info.name).toUpperCase(), seat: free, bot, connected: true,
      color: { main: color, light: lighter(color) }, character: Math.floor(Math.random() * CHARACTERS),
      score: 0, turnPoints: 0, guessed: false, guesses: [], lastGuessAt: 0,
    };
    state.players.push(p);
    stage.seatJoin(free, p.name);
    if (bot) stage.seatPicture(free, stage.selfPortrait());
    lobbyChanged();
  }

  function playerBack(info) {
    const p = byId(info.id);
    if (!p) return addPlayer(info);
    p.connected = true;
    updateVip();
    sync(p, true);
  }

  function playerGone(id) {
    const p = byId(id);
    if (!p) return;
    if (state.phase === 'lobby') {
      // leaving in the lobby frees the seat; once the game is on, players can come back
      state.players = state.players.filter((x) => x !== p);
      stage.seatLeave(p.seat);
      net.kick(id);
      lobbyChanged();
      return;
    }
    p.connected = false;
    updateVip();
    if (p === state.drawer && state.phase === 'pick') pickWord(-1);
    else if (p === state.drawer && state.phase === 'draw') {
      const step = state.step;
      setTimeout(() => { if (state.step === step && !p.connected) endTurn(); }, DRAWER_GRACE * 1000);
    } else if (state.phase === 'draw') checkAllGuessed();
  }

  function lobbyChanged() {
    updateVip();
    state.players.forEach((p) => sync(p));
  }

  /** the VIP (first real player still here) starts the game from their phone, and wears the beret */
  function updateVip() {
    const vip = state.players.find((p) => !p.bot && p.connected);
    const id = vip ? vip.id : null;
    stage.seatVip(vip ? vip.seat : null);
    if (id === state.vipId) return;
    const old = byId(state.vipId);
    state.vipId = id;
    if (old) sync(old);
    if (vip) sync(vip);
  }

  /* ---------- Phone screens ---------- */

  function screenFor(p) {
    const time = state.deadline ? Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000)) : null;
    const base = { type: 'screen', id: state.step, time };
    switch (state.phase) {
      case 'lobby':
        return { ...base, screen: 'lobby', bg: 'lobby', canStart: state.players.length >= MIN_PLAYERS };
      case 'pick':
        return p === state.drawer
          ? { ...base, screen: 'choose', bg: 'pick', words: state.choices }
          : { ...base, screen: 'wait', bg: 'pick' };
      case 'draw':
        return p === state.drawer
          ? { ...base, screen: 'draw', bg: 'draw', word: state.word }
          : { ...base, screen: 'guess', bg: 'draw', guesses: p.guesses, solved: p.guessed ? state.word : null };
      case 'result':
        return { ...base, screen: 'result', bg: 'draw', word: state.word };
      case 'win':
        return { ...base, screen: 'end', bg: 'win' };
    }
    return { ...base, screen: 'wait', bg: 'lobby' };
  }

  function sync(p, withDrawing = false) {
    if (!p || p.bot || !p.connected) return;
    send(p, { type: 'profile', color: p.color.main, light: p.color.light, ink: 4 + p.seat, character: p.character, name: p.name, vip: p.id === state.vipId });
    send(p, screenFor(p));
    // coming back mid-drawing (their portrait in the lobby, or the picture as drawer) gets it back
    if (!withDrawing) return;
    const ops = state.phase === 'lobby' ? stage.portrait(p.seat) : state.phase === 'draw' && p === state.drawer ? stage.drawing() : null;
    if (ops) chunkOps(ops).forEach((chunk, i) => send(p, { type: 'ops', ops: chunk, first: i === 0 }));
  }
  const syncAll = () => state.players.forEach((p) => sync(p));

  /** split a drawing into messages well under the server's 16 KB limit */
  function chunkOps(ops) {
    const pieces = [];
    ops.forEach((op) => {
      if (op.t !== 'l' || op.p.length <= 1200) return pieces.push(op);
      for (let i = 0; i < op.p.length - 2; i += 1198) pieces.push({ ...op, p: op.p.slice(i, i + 1200) });
    });
    const chunks = [[]];
    let size = 0;
    pieces.forEach((op) => {
      const len = JSON.stringify(op).length;
      if (size + len > 10000 && chunks[chunks.length - 1].length) { chunks.push([]); size = 0; }
      chunks[chunks.length - 1].push(op);
      size += len;
    });
    return chunks;
  }

  /* ---------- Flow ---------- */

  function setPhase(phase) {
    state.phase = phase;
    state.step++;
    state.deadline = 0;
  }
  function after(seconds, fn) {
    const step = state.step;
    setTimeout(() => { if (state.step === step) fn(); }, seconds * 1000);
  }
  /** runs `fn` only if nothing has moved the game on since */
  const guard = (fn) => { const step = state.step; return () => { if (state.step === step) fn(); }; };

  function startPlaying() {
    if (state.phase !== 'lobby' || state.players.length < MIN_PLAYERS) return;
    net.lock(true);
    setPhase('flying');
    syncAll();
    stage.flyToGame(guard(beginGame));
  }

  function beginGame() {
    state.round = 0;
    state.used.clear();
    state.players.forEach((p) => setScore(p, 0));
    nextRound(true);
  }

  function setScore(p, score) { p.score = score; stage.setScore(p.seat, score); }

  /** each round, everyone draws once */
  function nextRound(first = false) {
    state.round++;
    state.queue = state.players.map((p) => p.id);
    nextTurn(first);
  }
  function nextDrawer() {
    while (state.queue.length) {
      const p = byId(state.queue.shift());
      if (p && p.connected) return p;
    }
    return null;
  }
  const turnsLeft = () => state.queue.some((id) => byId(id)?.connected) || state.round < ROUNDS;

  function nextTurn() {
    let next = nextDrawer();
    if (!next) {
      if (state.round >= ROUNDS) return showWin();
      state.round++;
      state.queue = state.players.map((p) => p.id);
      next = nextDrawer();
      if (!next) return showWin();
    }
    state.drawer = next;
    state.word = '';
    state.players.forEach((p) => { p.guessed = false; p.turnPoints = 0; p.guesses = []; p.nextGuessAt = 0; });
    state.choices = wordChoices();
    setPhase('pick');
    state.deadline = Date.now() + PICK_TIME * 1000;
    stage.beginTurn(next.seat);
    syncAll();
    if (next.bot) after(1 + Math.random() * 2, () => pickWord(-1));
  }

  function wordChoices() {
    let pool = WORDS.filter((w) => !state.used.has(w));
    if (pool.length < CHOICES) { state.used.clear(); pool = WORDS.slice(); }
    return pool.sort(() => Math.random() - 0.5).slice(0, CHOICES);
  }

  function pickWord(index) {
    if (state.phase !== 'pick') return;
    const word = state.choices[index] || pickRandom(state.choices);
    state.word = word;
    state.used.add(word);
    state.revealed = new Set();
    const letters = [...word].filter((ch) => /[a-z]/i.test(ch)).length;
    const hints = Math.min(HINT_AT.length, Math.floor(letters / 3));
    state.hintTimes = HINT_AT.slice(0, hints).map((f) => f * DRAW_TIME * 1000);
    setPhase('draw');
    state.drawStart = Date.now();
    state.deadline = state.drawStart + DRAW_TIME * 1000;
    stage.chooseWord(word);
    stage.timer(DRAW_TIME);
    syncAll();
    state.botPen = null;
  }

  function revealLetter() {
    const hidden = [...state.word].map((ch, i) => i).filter((i) => /[a-z]/i.test(state.word[i]) && !state.revealed.has(i));
    if (hidden.length <= 1) return;
    const i = pickRandom(hidden);
    state.revealed.add(i);
    stage.revealLetter(i);
  }

  function guess(p, raw) {
    if (state.phase !== 'draw' || p === state.drawer || p.guessed) return;
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    const now = Date.now();
    if (!text || now - p.lastGuessAt < 350) return;
    p.lastGuessAt = now;
    const result = check(text, state.word);
    if (result === 'correct') {
      const left = Math.max(0, state.deadline - now) / (DRAW_TIME * 1000);
      const order = state.players.filter((x) => x.guessed).length;
      p.turnPoints = round5(Math.max(50, 100 + 400 * left - 20 * order));
      p.guessed = true;
      stage.chat(p.seat, 'guessed it!');
      sync(p);
      checkAllGuessed();
    } else {
      p.guesses.push({ text, close: result === 'close' });
      stage.chat(p.seat, text);
      sync(p);
    }
  }

  function checkAllGuessed() {
    const guessers = state.players.filter((p) => p !== state.drawer && p.connected);
    if (guessers.length && guessers.every((p) => p.guessed)) endTurn();
  }

  /** 'correct', 'close' (a letter or so off) or 'wrong'. Case, spaces and dashes don't matter. */
  function check(guessText, word) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const a = norm(guessText), b = norm(word);
    if (a === b) return 'correct';
    if (b.length >= 4 && distance(a, b) <= (b.length >= 9 ? 2 : 1)) return 'close';
    return 'wrong';
  }
  /** edits between two words; swapping two neighbouring letters counts as one */
  function distance(a, b) {
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

  /** time's up or everyone got it: points, the whole word face up, then the scoreboard */
  function endTurn() {
    if (state.phase !== 'draw') return;
    const guessers = state.players.filter((p) => p !== state.drawer);
    const total = guessers.reduce((sum, p) => sum + p.turnPoints, 0);
    state.drawer.turnPoints = guessers.length ? round5(total / guessers.length) : 0;
    state.players.forEach((p) => setScore(p, p.score + p.turnPoints));
    setPhase('result');
    [...state.word].forEach((ch, i) => stage.revealLetter(i));
    stage.timer(0);
    syncAll();
    after(RESULT_TIME, () => {
      if (!turnsLeft()) return showWin();
      setPhase('scores');
      syncAll();
      stage.toScoreboard('', guard(() => after(SCORE_TIME, () => stage.toNextEasel(guard(nextTurn)))));
    });
  }

  function showWin() {
    setPhase('win');
    state.drawer = null;
    const best = Math.max(...state.players.map((p) => p.score));
    const winners = state.players.filter((p) => p.score === best).map((p) => p.name);
    stage.toScoreboard(winners.length > 1 ? `${winners.join(' & ')} WIN` : `${winners[0]} WINS`);
    syncAll();
  }

  function backToLobby() {
    setPhase('lobby');
    // anyone who left during the game gives up their seat
    state.players.filter((p) => !p.connected).forEach((p) => { net.kick(p.id); stage.seatLeave(p.seat); });
    state.players = state.players.filter((p) => p.connected);
    state.players.forEach((p) => setScore(p, 0));
    state.drawer = null;
    state.round = 0;
    net.lock(false);
    stage.toLobby();
    lobbyChanged();
  }

  /* ---------- Clock ---------- */

  setInterval(() => {
    const now = Date.now();
    if (state.phase === 'draw') {
      while (state.hintTimes.length && now - state.drawStart >= state.hintTimes[0]) { state.hintTimes.shift(); revealLetter(); }
    }
    if (state.deadline && now >= state.deadline) {
      if (state.phase === 'pick') pickWord(-1);
      else if (state.phase === 'draw') endTurn();
    }
    botTick(now);
  }, 200);

  /* ---------- Dev: keys and bots ---------- */

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (state.phase === 'lobby') {
        while (state.players.length < MIN_PLAYERS) addBot();
        startPlaying();
      } else if (state.phase === 'win') backToLobby();
      return;
    }
    switch (e.key.toLowerCase()) {
      case 'b': addBot(); break;
      case 'k':
        if (state.phase === 'pick') pickWord(-1);
        else if (state.phase === 'draw') endTurn();
        break;
      case 'l': if (state.phase === 'win') backToLobby(); break;
    }
  });

  function addBot() {
    const n = ++state.botCount;
    const taken = new Set(state.players.map((p) => p.name));
    const name = BOT_NAMES.filter((x) => !taken.has(x)).sort(() => Math.random() - 0.5)[0] || `BOT ${n}`;
    addPlayer({ id: `bot-${n}`, name }, true);
  }

  function botTick(now) {
    if (state.phase !== 'draw') return;
    const elapsed = (now - state.drawStart) / (DRAW_TIME * 1000);
    state.players.forEach((b) => {
      if (!b.bot || b === state.drawer || b.guessed) return;
      if (!b.nextGuessAt) b.nextGuessAt = now + 2000 + Math.random() * 5000;
      if (now < b.nextGuessAt) return;
      b.nextGuessAt = now + 2500 + Math.random() * 6000;
      guess(b, Math.random() < 0.08 + 0.5 * elapsed ? state.word : pickRandom(WORDS));
    });
    if (state.drawer && state.drawer.bot) botDraw();
  }

  /** a bot drawer wanders the pen around in random colours */
  function botDraw() {
    let pen = state.botPen;
    if (!pen || Math.random() < 0.06) {
      pen = state.botPen = { x: 200 + Math.random() * 600, y: 200 + Math.random() * 600, a: Math.random() * Math.PI * 2 };
      stage.draw({ type: 'line', c: Math.floor(Math.random() * 16), s: Math.floor(Math.random() * 3), p: [Math.round(pen.x), Math.round(pen.y)] });
    }
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pen.a += (Math.random() - 0.5) * 0.9;
      pen.x = Math.max(30, Math.min(970, pen.x + Math.cos(pen.a) * 18));
      pen.y = Math.max(30, Math.min(970, pen.y + Math.sin(pen.a) * 18));
      pts.push(Math.round(pen.x), Math.round(pen.y));
    }
    stage.draw({ type: 'pts', p: pts });
  }
}
