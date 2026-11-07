/**
 * Mod menu — dev tools for Articulate (backtick to open): start / skip / back to the lobby, add and remove
 * players, make someone guess the word, shorten the timer, and an embedded phone to play from this screen.
 * The phone is the web/ folder served over barcode://app/phone/ (see main.js), so new phone code shows without pushing.
 *
 * game.js hands over what it can do: new ModMenu({ state, startPlaying, addBot, removePlayer, pickWord, endTurn,
 * revealLetter, backToLobby, forceGuess, shorten }).
 */

const BEZEL = 9; // phone border width, px: the drag handle (the screen itself belongs to the page)
const PHONE_SOURCES = {
  local: { label: 'Local web/ folder', url: 'barcode://app/phone/index.html' },
  live: { label: 'barcodegames.fun', url: 'https://barcodegames.fun/' },
};
let phoneZ = 1;

const CSS = `
.am { position: fixed; top: 12px; right: 12px; z-index: 200; width: 300px; max-height: calc(100vh - 24px); display: flex; flex-direction: column; background: #000; color: #fff; border: 2px solid #fff; font: 13px/1.3 system-ui, sans-serif; }
.am.hidden { display: none; }
.am header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 10px 12px 6px; }
.am header span { color: #aaa; font-size: 11px; text-align: right; }
.am nav { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 0 12px 8px; border-bottom: 1px solid #333; }
.am button { background: #fff; color: #000; border: 0; border-radius: 0; padding: 7px 6px; font-weight: 700; font-size: 12px; cursor: pointer; }
.am button:hover:not(:disabled) { background: #aaa; }
.am button:disabled { opacity: .3; cursor: default; }
.am nav button { background: transparent; color: #ccc; border: 1px solid #555; }
.am nav button.on { background: #fff; color: #000; border-color: #fff; }
.am section { display: grid; gap: 8px; padding: 10px 12px 14px; overflow-y: auto; }
.am section[hidden] { display: none; }
.am .g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.am label { display: grid; grid-template-columns: 60px 1fr; gap: 6px; align-items: center; }
.am select { min-width: 0; background: #111; color: #fff; border: 1px solid #666; padding: 4px; border-radius: 0; }
.am .p { display: grid; gap: 5px; padding: 8px; border: 1px solid #333; }
.am .p .who { display: flex; align-items: center; gap: 6px; }
.am .p .who i { width: 12px; height: 12px; }
.am .p .who span { color: #aaa; font-size: 11px; margin-left: auto; }
.am .p .row { display: flex; gap: 5px; }
.am .p .row button { flex: 1; padding: 5px; }
.am-phones { position: fixed; inset: 0; z-index: 199; pointer-events: none; }
.am-phones.hidden { display: none; }
.am-phone { position: absolute; pointer-events: auto; box-sizing: border-box; background: #000; border: 9px solid #000; outline: 1px solid #555; cursor: grab; }
.am-phone.active { cursor: grabbing; outline-color: #fff; }
.am-screen { position: absolute; inset: 0; overflow: hidden; background: #000; cursor: auto; }
.am-phone iframe { position: absolute; left: 0; top: 0; width: 390px; height: 806px; border: 0; transform-origin: 0 0; display: block; }
.am-phones.dragging iframe { pointer-events: none; }
.am-resize { position: absolute; right: -9px; bottom: -9px; width: 22px; height: 22px; cursor: nwse-resize; }
`;

export class ModMenu {
  constructor(game) {
    this.g = game;
    this.tab = 'game';
    this.phoneSource = 'local';
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.build();
    setInterval(() => { if (!this.panel.classList.contains('hidden')) this.render(); }, 400);
    document.addEventListener('keydown', (e) => {
      if (e.key !== '`' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input, textarea')) return;
      e.preventDefault();
      this.panel.classList.toggle('hidden');
      this.render();
    });
  }

  build() {
    this.panel = document.createElement('div');
    this.panel.className = 'am hidden';
    this.panel.innerHTML = `
      <header><b>Mod menu</b><span class="am-state"></span></header>
      <nav>
        <button data-tab="game" class="on">Game</button>
        <button data-tab="players">Players</button>
        <button data-tab="phone">Phone</button>
      </nav>
      <section data-pane="game">
        <div class="g2">
          <button data-act="start">Start game</button>
          <button data-act="skip">Skip turn</button>
          <button data-act="letter">Reveal letter</button>
          <button data-act="timer">Timer to 5s</button>
          <button data-act="bot">Add bot</button>
          <button data-act="lobby">Back to lobby</button>
        </div>
      </section>
      <section data-pane="players" hidden><div class="am-players"></div></section>
      <section data-pane="phone" hidden>
        <label>Site <select class="am-src">${Object.entries(PHONE_SOURCES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select></label>
        <div class="g2">
          <button data-act="phone-show">Show phone</button>
          <button data-act="phone-reload">Reload phone</button>
          <button data-act="phone-add">Add a phone</button>
          <button data-act="phone-hide">Hide phones</button>
        </div>
      </section>`;
    document.body.appendChild(this.panel);
    this.phones = document.createElement('div');
    this.phones.className = 'am-phones hidden';
    document.body.appendChild(this.phones);

    this.panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.panel.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      this.panel.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== this.tab; });
      this.render();
    }));
    this.panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) this.act(btn.dataset.act, btn.dataset);
    });
    this.panel.querySelector('.am-src').addEventListener('change', (e) => { this.phoneSource = e.target.value; this.reloadPhones(); });
  }

  act(act, data = {}) {
    const g = this.g, s = g.state, player = s.players[Number(data.i)];
    switch (act) {
      case 'start':
        if (s.phase === 'lobby') { while (s.players.length < 2) g.addBot(); g.startPlaying(); }
        break;
      case 'skip':
        if (s.phase === 'pick') g.pickWord(-1);
        else if (s.phase === 'draw') g.endTurn();
        else if (s.phase === 'win') g.backToLobby();
        break;
      case 'letter': if (s.phase === 'draw') g.revealLetter(); break;
      case 'timer': g.shorten(5); break;
      case 'bot': g.addBot(); break;
      case 'lobby': if (s.phase !== 'lobby') g.backToLobby(); break;
      case 'guess': if (player) g.forceGuess(player); break;
      case 'remove': if (player) g.removePlayer(player); break;
      case 'phone-show': this.showPhones(true); break;
      case 'phone-hide': this.showPhones(false); break;
      case 'phone-add': this.addPhone(); this.showPhones(true); break;
      case 'phone-reload': this.reloadPhones(); break;
    }
    this.render();
  }

  render() {
    const s = this.g.state;
    const left = s.deadline ? Math.max(0, Math.ceil((s.deadline - Date.now()) / 1000)) : null;
    this.panel.querySelector('.am-state').textContent = [s.phase, s.round ? `round ${s.round}` : '', left !== null ? `${left}s` : '', s.code || ''].filter(Boolean).join(' · ');
    if (this.tab !== 'players') return;
    this.panel.querySelector('.am-players').innerHTML = s.players.map((p, i) => `
      <div class="p">
        <div class="who"><i style="background:${p.color.main}"></i><b>${p.name}</b><span>${p.bot ? 'bot' : 'phone'}${p.id === s.vipId ? ' · VIP' : ''}${p === s.drawer ? ' · drawing' : ''}${p.guessed ? ' · guessed' : ''} · ${p.score}</span></div>
        <div class="row">
          <button data-act="guess" data-i="${i}" ${s.phase === 'draw' && p !== s.drawer && !p.guessed ? '' : 'disabled'}>Guess it</button>
          <button data-act="remove" data-i="${i}" ${s.phase === 'lobby' || !p.bot ? '' : 'disabled'}>Remove</button>
        </div>
      </div>`).join('') || '<div class="p">No players</div>';
  }

  /* ---------- embedded phones: the page inside is laid out at 390 x 806 and scaled to the frame ---------- */

  phoneUrl(slot) {
    const q = new URLSearchParams({ slot: String(slot) });
    if (this.g.state.code) q.set('code', this.g.state.code);
    return `${PHONE_SOURCES[this.phoneSource].url}?${q}`;
  }

  phoneHeight(w) { return Math.round((w * 806) / 390) + BEZEL * 2; }

  addPhone() {
    const frame = document.createElement('div');
    frame.className = 'am-phone';
    frame.innerHTML = '<div class="am-screen"><iframe title="Phone controller"></iframe></div><div class="am-resize"></div>';
    const slot = String(this.phones.children.length + 1), n = Number(slot) - 1, w = 300;
    frame.dataset.slot = slot;
    frame.querySelector('iframe').src = this.phoneUrl(slot);
    this.phones.appendChild(frame);
    this.setBox(frame, { w, x: window.innerWidth - 340 - (w + 20) * (n + 1), y: window.innerHeight - this.phoneHeight(w) - 20 });
    this.makeDraggable(frame);
  }

  setBox(frame, { x, y, w }) {
    w = Math.max(120, Math.min(560, w));
    x = Math.max(0, Math.min(window.innerWidth - 60, x));
    y = Math.max(0, Math.min(window.innerHeight - 40, y));
    Object.assign(frame.style, { left: `${x}px`, top: `${y}px`, width: `${w + BEZEL * 2}px`, height: `${this.phoneHeight(w)}px` });
    frame.querySelector('iframe').style.transform = `scale(${w / 390})`;
    frame._box = { x, y, w };
  }

  /** drag by the bezel, resize from the bottom-right corner (keeps the phone's shape) */
  makeDraggable(frame) {
    const start = (e, mode) => {
      if (e.button !== 0 || (mode === 'move' && e.target !== frame)) return;
      e.preventDefault();
      const from = { ...frame._box, px: e.clientX, py: e.clientY };
      this.phones.classList.add('dragging');
      frame.classList.add('active');
      const move = (ev) => {
        const dx = ev.clientX - from.px, dy = ev.clientY - from.py;
        if (mode === 'move') this.setBox(frame, { x: from.x + dx, y: from.y + dy, w: from.w });
        else this.setBox(frame, { x: from.x, y: from.y, w: from.w + Math.max(dx, (dy * 390) / 806) });
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        this.phones.classList.remove('dragging');
        frame.classList.remove('active');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
    };
    frame.addEventListener('pointerdown', (e) => start(e, 'move'));
    frame.querySelector('.am-resize').addEventListener('pointerdown', (e) => start(e, 'resize'));
    frame.style.zIndex = String(++phoneZ);
    frame.addEventListener('pointerdown', () => { frame.style.zIndex = String(++phoneZ); }, true);
  }

  showPhones(on) {
    if (on && !this.phones.children.length) this.addPhone();
    this.phones.classList.toggle('hidden', !on);
  }

  reloadPhones() {
    this.phones.querySelectorAll('.am-phone').forEach((f) => { f.querySelector('iframe').src = this.phoneUrl(f.dataset.slot); });
  }
}
