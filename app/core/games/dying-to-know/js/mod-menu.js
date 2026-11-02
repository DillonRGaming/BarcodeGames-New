/**
 * Mod-menu.js - Dev tools (backtick to open): jump to any room or question, add/remove/kill players,
 * make them answer or volunteer, speed timers up, and an embedded phone to play from this screen.
 *
 * Settings live on manager.dev: { room, fast, skipOffer, fillRoom } (read by killing-rooms.js).
 */

const BEZEL = 9; // phone border width, px: the drag handle (the screen itself belongs to the page)
let phoneZ = 1;

const PHONE_SOURCES = {
  local: { label: 'Local web/ folder (latest code)', url: 'barcode://app/phone/index.html' },
  live: { label: 'barcodegames.fun (deployed)', url: 'https://barcodegames.fun/' },
};

class ModMenu {
  constructor(manager) {
    this.m = manager;
    this.tab = 'game';
    this.phoneSource = 'local';
    this.build();
    setInterval(() => { if (!this.panel.classList.contains('hidden')) this.renderPlayers(); }, 400);
  }

  build() {
    const m = this.m;
    this.panel = document.createElement('div');
    this.panel.className = 'mod-menu hidden';
    this.panel.innerHTML = `
      <header><b>Mod menu</b><span class="mod-state"></span></header>
      <nav>
        <button data-tab="game" class="on">Game</button>
        <button data-tab="players">Players</button>
        <button data-tab="phone">Phone</button>
      </nav>

      <section data-pane="game">
        <h4>Killing room</h4>
        <label>Room <select data-dev="room"><option value="">Random</option>${KILLING_ROOMS.map((R) => `<option value="${R.id}">${R.title}</option>`).join('')}</select></label>
        <label>Taken <select class="mod-taken"></select></label>
        <button class="wide" data-act="kill">Play killing room now</button>
        <label class="check"><input type="checkbox" data-dev="fast"> Fast timers (4s)</label>
        <label class="check"><input type="checkbox" data-dev="skipOffer"> Skip volunteering</label>
        <label class="check"><input type="checkbox" data-dev="fillRoom"> Bots always volunteer</label>

        <h4>Questions</h4>
        <label>Question <select class="mod-question">${QUESTIONS.map((q, i) => `<option value="${i}">${i + 1}. ${q.question}</option>`).join('')}</select></label>
        <div class="grid2">
          <button data-act="question">Show question</button>
          <button data-act="timeup">Time's up</button>
        </div>

        <h4>Flow</h4>
        <div class="grid2">
          <button data-act="start">Start, no intro</button>
          <button data-act="skip">Skip round</button>
          <button data-act="score">Scoreboard</button>
          <button data-act="layout">Lineup / grid</button>
        </div>
      </section>

      <section data-pane="players" hidden>
        <div class="grid2">
          <button data-act="bot">Add bot</button>
          <button data-act="money">Random money</button>
        </div>
        <h4>Everyone answers</h4>
        <div class="grid3">
          <button data-act="all-right">Right</button>
          <button data-act="all-wrong">Wrong</button>
          <button data-act="all-random">Random</button>
        </div>
        <div class="mod-players"></div>
      </section>

      <section data-pane="phone" hidden>
        <label class="check"><input type="checkbox" class="mod-phone-on"> Show phone</label>
        <label>Site <select class="mod-phone-src">${Object.entries(PHONE_SOURCES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}</select></label>
        <div class="grid2">
          <button data-act="phone-reload">Reload phone</button>
          <button data-act="phone-second">Add a second phone</button>
        </div>
        <p class="mod-note">The phone opens with this room's code filled in. Local uses your web/ folder, so new phone screens work without pushing.</p>
      </section>`;
    document.body.appendChild(this.panel);

    this.phones = document.createElement('div');
    this.phones.className = 'mod-phones hidden';
    document.body.appendChild(this.phones);

    // tabs
    this.panel.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.tab = b.dataset.tab;
      this.panel.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      this.panel.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== this.tab; });
      this.renderPlayers();
    }));
    // settings
    this.panel.querySelectorAll('[data-dev]').forEach((el) => el.addEventListener('change', () => {
      m.dev[el.dataset.dev] = el.type === 'checkbox' ? el.checked : el.value;
    }));
    // actions
    this.panel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (btn) this.act(btn.dataset.act, btn.dataset);
    });
    // phone
    this.panel.querySelector('.mod-phone-on').addEventListener('change', (e) => this.showPhones(e.target.checked));
    this.panel.querySelector('.mod-phone-src').addEventListener('change', (e) => {
      this.phoneSource = e.target.value;
      this.reloadPhones();
    });
  }

  toggle() {
    this.panel.classList.toggle('hidden');
    this.renderPlayers();
  }

  /* ---------- actions ---------- */

  act(act, data = {}) {
    const m = this.m;
    const alive = m.players.filter((p) => p.isAlive());
    const playerAt = (i) => m.players[Number(i)];
    switch (act) {
      case 'kill': {
        if (m.killingRoom || !alive.length) return;
        const pick = this.panel.querySelector('.mod-taken').value;
        const taken = pick === '' ? alive[Math.floor(Math.random() * alive.length)] : playerAt(pick);
        if (!taken || !taken.isAlive()) return;
        if (m.isQuestionActive) { m.stopQuestionTimer(); m.hideQuestion(); }
        m.runKillingRoom(taken);
        break;
      }
      case 'question': {
        if (m.isQuestionActive || m.killingRoom || m.isTransitioning) return;
        m.currentQuestionIdx = Number(this.panel.querySelector('.mod-question').value);
        if (m.room && !m.room.bgScrolling) m.room.bgScrolling = true;
        m.showQuestion();
        break;
      }
      case 'timeup':
        if (m.acceptingAnswers && m.questionTimer) { m.flipClock.set(0); m.stopQuestionTimer(); m.handleQuestionTimeout(); }
        break;
      case 'start':
        if (m.gameState !== 'LOBBY') return;
        if (m.countdownTimer) m.cancelStartCountdown();
        if (m.net) m.net.lock();
        m.skipIntro();
        break;
      case 'skip': m.skipRound(); break;
      case 'score':
        if (!m.killingRoom && !m.isQuestionActive) m.showScoreboard().then(() => m.flyTo('grid'));
        break;
      case 'layout': if (!m.killingRoom) m.toggleLineup(); break;
      case 'bot': {
        const names = ['SPOOKY', 'GHOUL', 'BONES', 'MOTH', 'CREEP', 'WISP', 'HOLLOW', 'NIGHT'];
        const used = new Set(m.players.map((p) => p.name));
        m.addPlayer({ name: names.find((n) => !used.has(n)) || `BOT${m.players.length + 1}` });
        break;
      }
      case 'money': m.players.forEach((p) => { p.money = Math.round(Math.random() * 40) * 50; }); break;
      case 'all-right': case 'all-wrong': case 'all-random':
        m.players.forEach((p) => {
          const right = m.currentCorrectIndex();
          let idx = Math.floor(Math.random() * 4) + 1;
          if (act === 'all-right') idx = right;
          if (act === 'all-wrong') idx = (right % 4) + 1;
          m.forceAnswer(p, idx);
        });
        break;
      case 'answer': m.forceAnswer(playerAt(data.i), Number(data.n)); break;
      case 'kill-player': { const p = playerAt(data.i); if (p && p.isAlive()) p.startDeathSpin(); break; }
      case 'revive-player': { const p = playerAt(data.i); if (p && p.isDead()) p.startReviveSpin(); break; }
      case 'remove-player': m.removePlayerObject(playerAt(data.i)); break;
      case 'volunteer': { const p = playerAt(data.i); if (m.killingRoom && p) m.killingRoom.volunteer(p); break; }
      case 'phone-reload': this.reloadPhones(); break;
      case 'phone-second': this.addPhone(); this.showPhones(true); break;
    }
    this.renderPlayers();
  }

  /* ---------- live state ---------- */

  renderPlayers() {
    const m = this.m;
    const q = m.isQuestionActive ? `Q${(m.currentQuestionIdx % QUESTIONS.length) + 1}` : '';
    this.panel.querySelector('.mod-state').textContent = [m.gameState, q, m.killingRoom ? 'killing room' : '', m.dev.fast ? 'fast' : ''].filter(Boolean).join(' · ');

    // taken picker keeps its selection while the list changes
    const takenSel = this.panel.querySelector('.mod-taken');
    const keep = takenSel.value;
    takenSel.innerHTML = `<option value="">Random living player</option>${m.players.map((p, i) => (p.isAlive() ? `<option value="${i}">${p.name}</option>` : '')).join('')}`;
    takenSel.value = [...takenSel.options].some((o) => o.value === keep) ? keep : '';

    if (this.tab !== 'players') return;
    const answering = m.acceptingAnswers;
    const offer = m.killingRoom && m.killingRoom.offerOpen;
    this.panel.querySelector('.mod-players').innerHTML = m.players.map((p, i) => {
      const answer = p.roomId ? m.answers && m.answers.get(p.roomId) : p.botChoice;
      const state = p.isDead() ? 'dead' : p.isAlive() ? 'alive' : '…';
      return `
        <div class="mod-player ${state}">
          <div class="who"><i style="background:${p.nameColor}"></i><b>${p.name}</b><span>${p.roomId ? 'phone' : 'bot'}${p.isVip ? ' · VIP' : ''} · ${state} · £${p.money}</span></div>
          <div class="row">
            ${[1, 2, 3, 4].map((n) => `<button data-act="answer" data-i="${i}" data-n="${n}" ${answering && !answer ? '' : 'disabled'} class="${answer === n ? 'picked' : ''}">${n}</button>`).join('')}
            ${offer ? `<button data-act="volunteer" data-i="${i}">Volunteer</button>` : ''}
          </div>
          <div class="row">
            ${p.isDead() ? `<button data-act="revive-player" data-i="${i}">Revive</button>` : `<button data-act="kill-player" data-i="${i}">Kill</button>`}
            <button data-act="remove-player" data-i="${i}">Remove</button>
          </div>
        </div>`;
    }).join('') || '<p class="mod-note">No players yet. Add a bot or join with the phone.</p>';
  }

  /* ---------- embedded phones ---------- */

  phoneUrl(slot) {
    const q = new URLSearchParams({ slot: String(slot) });
    if (this.m.roomCode) q.set('code', this.m.roomCode);
    return `${PHONE_SOURCES[this.phoneSource].url}?${q}`;
  }

  addPhone() {
    const frame = document.createElement('div');
    frame.className = 'mod-phone';
    frame.innerHTML = `
      <div class="mod-phone-screen"><iframe title="Phone controller"></iframe></div>
      <div class="mod-phone-resize" aria-label="Resize phone"></div>`;
    const slot = String(this.phones.children.length + 1);
    frame.dataset.slot = slot;
    frame.querySelector('iframe').src = this.phoneUrl(slot);
    this.phones.appendChild(frame);

    // Where it was last left (per phone slot), else stacked in from the bottom right
    const saved = this.loadPhoneBox(slot);
    const w = saved ? saved.w : 300;
    const n = Number(slot) - 1;
    this.setPhoneBox(frame, saved || { w, x: window.innerWidth - (w + 20) * (n + 1), y: window.innerHeight - this.phoneHeight(w) - 20 });
    this.makeDraggable(frame);
  }

  /*
   * Phone geometry: the page inside is always laid out at 390 x 806 (a real phone) and scaled as a
   * whole to the screen width, so at any size it looks exactly like the phone, only smaller.
   * `w` is the screen width; the frame adds the bezel round it.
   */
  phoneHeight(w) { return Math.round((w * 806) / 390) + BEZEL * 2; }

  setPhoneBox(frame, { x, y, w }) {
    w = Math.max(120, Math.min(560, w));
    const h = this.phoneHeight(w);
    x = Math.max(0, Math.min(window.innerWidth - 60, x));
    y = Math.max(0, Math.min(window.innerHeight - 40, y));
    Object.assign(frame.style, { left: `${x}px`, top: `${y}px`, width: `${w + BEZEL * 2}px`, height: `${h}px`, borderWidth: `${BEZEL}px` });
    // corners scale with the phone, like a real handset: screen radius ~11% of its width, bezel follows it
    const r = Math.round(w * 0.11);
    frame.style.borderRadius = `${r + BEZEL}px`;
    frame.querySelector('.mod-phone-screen').style.borderRadius = `${r}px`;
    frame.querySelector('iframe').style.transform = `scale(${w / 390})`;
    frame._box = { x, y, w };
  }

  loadPhoneBox(slot) {
    try { return JSON.parse(localStorage.getItem(`dtk:modphone:${slot}`)); } catch (e) { return null; }
  }

  savePhoneBox(frame) {
    try { localStorage.setItem(`dtk:modphone:${frame.dataset.slot}`, JSON.stringify(frame._box)); } catch (e) { /* private mode */ }
  }

  /** Drag by the bezel, resize from the bottom-right corner (keeps the phone's shape) */
  makeDraggable(frame) {
    const start = (e, mode) => {
      if (e.button !== 0) return;
      if (mode === 'move' && e.target !== frame) return; // only the bezel itself drags
      e.preventDefault();
      const from = { ...frame._box, px: e.clientX, py: e.clientY };
      this.phones.classList.add('dragging'); // iframes ignore the pointer so moves aren't swallowed
      frame.classList.add('active');
      const move = (ev) => {
        const dx = ev.clientX - from.px;
        const dy = ev.clientY - from.py;
        if (mode === 'move') this.setPhoneBox(frame, { x: from.x + dx, y: from.y + dy, w: from.w });
        else this.setPhoneBox(frame, { x: from.x, y: from.y, w: from.w + Math.max(dx, (dy * 390) / 806) });
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        this.phones.classList.remove('dragging');
        frame.classList.remove('active');
        this.savePhoneBox(frame);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
    };
    frame.addEventListener('pointerdown', (e) => start(e, 'move'));
    frame.querySelector('.mod-phone-resize').addEventListener('pointerdown', (e) => start(e, 'resize'));
    // bring the touched phone to the front by layering it (moving an iframe in the DOM reloads it)
    frame.style.zIndex = String(++phoneZ);
    frame.addEventListener('pointerdown', () => { frame.style.zIndex = String(++phoneZ); }, true);
  }

  showPhones(on) {
    if (on && !this.phones.children.length) this.addPhone();
    this.phones.classList.toggle('hidden', !on);
    this.panel.querySelector('.mod-phone-on').checked = on;
  }

  reloadPhones() {
    this.phones.querySelectorAll('.mod-phone').forEach((f) => { f.querySelector('iframe').src = this.phoneUrl(f.dataset.slot); });
  }
}
