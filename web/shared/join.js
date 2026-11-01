/**
 * Join shell — the part of barcodegames.fun shared by every game.
 * Handles room code + name, joining, reconnecting, and connection notices,
 * then loads the game's own controller from games/<id>/.
 *
 * A game controller registers itself with:
 *   BarcodeJoin.registerController('<game-id>', ({ root, player, send, onMessage }) => { ... });
 */

(() => {
  const SESSION_KEY = 'barcode:session'; // { code, playerToken, name } for rejoining after a refresh
  const NAME_KEY = 'barcode:name';

  const $ = (id) => document.getElementById(id);
  const joinScreen = $('joinScreen');
  const gameScreen = $('gameScreen');
  const form = $('joinForm');
  const codeInput = $('codeInput');
  const nameInput = $('nameInput');
  const joinBtn = $('joinBtn');
  const errorEl = $('joinError');
  const nameCount = $('nameCount');
  const gameNameEl = $('gameName');
  const codeStatus = $('codeStatus');
  const noticeEl = $('notice');

  const controllers = {};
  const messageHandlers = [];
  let client = null;

  const store = {
    get(storage, key) { try { return JSON.parse(storage.getItem(key)); } catch { return null; } },
    set(storage, key, value) { try { storage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
    remove(storage, key) { try { storage.removeItem(key); } catch { /* private mode */ } },
  };

  window.BarcodeJoin = {
    registerController(gameId, mount) {
      controllers[gameId] = mount;
    },
  };

  /* ---------- Join form ---------- */

  const params = new URLSearchParams(location.search);
  codeInput.value = (params.get('code') || '').toUpperCase().slice(0, 4);
  nameInput.value = store.get(localStorage, NAME_KEY) || '';

  let codeValid = null; // null = not checked yet, true / false once the server answers
  let room = null; // latest lookup of the typed code
  let lookupId = 0;
  let joining = false;

  function updateForm() {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    nameInput.value = nameInput.value.toUpperCase();
    nameCount.textContent = nameInput.maxLength - nameInput.value.length;
    if (joining) return;
    joinBtn.disabled = codeInput.value.length !== 4 || codeValid === false || !nameInput.value.trim();
    const name = nameInput.value.trim();
    const canReconnect = room && room.reconnectable && room.reconnectable.includes(name);
    joinBtn.textContent = canReconnect ? 'Reconnect' : 'Play';
  }

  // Tick + game name when the code exists, X when it doesn't
  async function checkCode() {
    const id = ++lookupId;
    const sameCode = room && room.code === codeInput.value;
    if (!sameCode) {
      codeValid = null;
      room = null;
      codeStatus.className = 'code-status';
      gameNameEl.textContent = '';
    }
    updateForm();
    if (codeInput.value.length !== 4) return;

    const found = await RoomClient.lookup(codeInput.value);
    if (id !== lookupId) return;
    room = found;
    codeValid = !!room;
    codeStatus.className = `code-status ${room ? 'ok' : 'bad'}`;
    if (room) gameNameEl.textContent = (window.BARCODE_GAMES[room.game] || { title: room.game }).title;
    updateForm();
  }

  codeInput.addEventListener('input', () => {
    errorEl.textContent = '';
    checkCode();
    if (codeInput.value.length === 4 && !nameInput.value) nameInput.focus();
  });

  // Re-check the room while typing a name, so RECONNECT shows for players who dropped out
  let nameTimer = null;
  nameInput.addEventListener('input', () => {
    errorEl.textContent = '';
    updateForm();
    clearTimeout(nameTimer);
    nameTimer = setTimeout(checkCode, 300);
  });

  checkCode();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = codeInput.value;
    const name = nameInput.value.trim();
    if (code.length !== 4 || !name) return;
    store.set(localStorage, NAME_KEY, name);
    join(code, name);
  });

  function showError(message) {
    errorEl.textContent = message;
    joining = false;
    updateForm();
    checkCode();
  }

  /* ---------- Connection ---------- */

  function join(code, name, playerToken = null) {
    joining = true;
    joinBtn.disabled = true;

    client = new RoomClient();
    client.on('joined', onJoined);
    client.on('message', (data) => messageHandlers.forEach((fn) => fn(data)));
    client.on('error', (err) => {
      if (client.player && err.code !== 'OFFLINE') return; // in-game errors don't kick you out
      store.remove(sessionStorage, SESSION_KEY);
      showJoinScreen();
      showError(err.message);
    });
    client.on('status', (status) => {
      if (status === 'reconnecting') showNotice('Reconnecting…');
      if (status === 'open') hideNotice();
    });
    client.on('closed', () => endGame('The game has ended'));
    client.on('kicked', () => endGame('You were removed from the game'));
    client.join(code, name, playerToken);
  }

  async function onJoined(msg) {
    store.set(sessionStorage, SESSION_KEY, { code: msg.code, name: msg.player.name, playerToken: msg.playerToken });
    if (msg.reconnected && !gameScreen.classList.contains('hidden')) return;

    try {
      await loadController(msg.game);
    } catch {
      client.leave();
      showJoinScreen();
      return showError("This game isn't available on the website yet");
    }

    joinScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    gameScreen.innerHTML = '';
    document.body.dataset.game = msg.game;

    controllers[msg.game]({
      root: gameScreen,
      player: msg.player,
      code: msg.code,
      send: (data) => client.send(data),
      onMessage: (fn) => messageHandlers.push(fn),
    });
  }

  function loadController(gameId) {
    if (controllers[gameId]) return Promise.resolve();
    if (!window.BARCODE_GAMES[gameId]) return Promise.reject(new Error('Unknown game'));

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `games/${gameId}/controller.css`;
    document.head.appendChild(css);

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `games/${gameId}/controller.js`;
      script.onload = () => (controllers[gameId] ? resolve() : reject(new Error('Controller did not register')));
      script.onerror = reject;
      document.body.appendChild(script);
    });
  }

  function endGame(message) {
    store.remove(sessionStorage, SESSION_KEY);
    hideNotice();
    showJoinScreen();
    showError(message);
  }

  function showJoinScreen() {
    messageHandlers.length = 0;
    delete document.body.dataset.game;
    gameScreen.classList.add('hidden');
    gameScreen.innerHTML = '';
    joinScreen.classList.remove('hidden');
  }

  function showNotice(text) {
    noticeEl.textContent = text;
    noticeEl.classList.remove('hidden');
  }

  function hideNotice() {
    noticeEl.classList.add('hidden');
  }

  /* ---------- Rejoin after a refresh ---------- */

  const saved = store.get(sessionStorage, SESSION_KEY);
  if (saved && saved.code && saved.playerToken) {
    codeInput.value = saved.code;
    nameInput.value = saved.name || nameInput.value;
    join(saved.code, saved.name, saved.playerToken);
  }
})();
