/**
 * Articulate — phone controller.
 *
 * Messages from the host app (data):
 *   { type: 'profile', color, light, character, vip }   name bar colours + character; the VIP starts the game
 *   { type: 'screen', screen, id, bg, time, ... }       what to show (a repeat with the same id only updates it)
 *       lobby   { canStart }                             VIP sees Everybody's in
 *       wait                                             nothing to do
 *       choose  { words }                                pick the word to draw
 *       draw    { word }                                 draw it
 *       guess   { guesses: [{ text, close }], solved }   guess it (solved = the word once you got it)
 *       result  { word }                                 end of a turn
 *       end                                              game over (VIP sees New Game)
 *     bg is the screen colour (lobby, pick, draw, win); time is seconds left, if there's a clock
 *   { type: 'ops', ops, first }                          the drawing so far, after the drawer reconnects
 *
 * Messages to the host:
 *   { type: 'start' } · { type: 'again' } · { type: 'pick', index } · { type: 'guess', text }
 *   { type: 'line', c, s, p: [x, y] } starts a line · { type: 'pts', p: [x, y, ...] } continues it
 *   { type: 'fill', c, x, y } · { type: 'undo' } · { type: 'clear' }     (coordinates 0..1000, see board.js)
 */

BarcodeJoin.registerController('articulate', ({ root, player, send, onMessage }) => {
  const ICONS = {
    fill: '<svg viewBox="0 0 32 32"><path d="M6 15 L15 6 L26 17 L17 26 Z" fill="none" stroke="#fff" stroke-width="3.2" stroke-linejoin="round"/><path d="M6 15 L26 17" stroke="#fff" stroke-width="3.2"/><path d="M27 21 C29.5 24.5 29.5 28 27 28 C24.5 28 24.5 24.5 27 21 Z" fill="#fff"/></svg>',
    undo: '<svg viewBox="0 0 32 32"><path d="M12 7 L5 13 L12 19" fill="none" stroke="#fff" stroke-width="3.6" stroke-linejoin="round" stroke-linecap="round"/><path d="M6 13 H19 C24 13 27 16 27 20 C27 24 24 27 19 27 H13" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 32 32"><path d="M6 16 H25 M17 8 L25 16 L17 24" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    clear: '<svg viewBox="0 0 32 32"><path d="M8 11 H24 L22.5 27 Q22.3 28.5 21 28.5 H11 Q9.7 28.5 9.5 27 Z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><path d="M5 10 H27 M13 10 V6 H19 V10" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    crown: '<svg viewBox="0 0 40 40"><path d="M10 27 L8 14 L15 19 L20 11 L25 19 L32 14 L30 27 Z" fill="#fff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  };

  root.innerHTML = `
    <div class="ar" data-bg="lobby">
      <div class="ar-backdrop"></div>
      <header class="ar-head">
        <span class="ar-tile"><span class="ar-tag hidden">${ICONS.crown}</span></span>
        <span class="ar-name"></span>
      </header>
      <section class="ar-body"></section>
    </div>`;
  const app = root.querySelector('.ar');
  const head = root.querySelector('.ar-head');
  const tile = root.querySelector('.ar-tile');
  const vipTag = root.querySelector('.ar-tag');
  const body = root.querySelector('.ar-body');
  root.querySelector('.ar-name').textContent = player.name;

  // Shrink text that doesn't fit its box on one line (long names and words)
  function fitText(el) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = size * 0.45;
    while (el.scrollWidth > el.clientWidth + 1 && size > min) {
      size *= 0.94;
      el.style.fontSize = `${size}px`;
    }
  }
  const fitAll = () => {
    root.querySelectorAll('.ar-name, .ar-word, .ar-theword, .ar-solved, .ar-big').forEach(fitText);
    // the word choices all use the size of the longest, so they match
    const words = [...root.querySelectorAll('.ar-word')];
    const min = Math.min(...words.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    words.forEach((el) => { el.style.fontSize = `${min}px`; });
  };
  if (document.fonts) document.fonts.ready.then(fitAll);
  window.addEventListener('resize', fitAll);

  let isVip = false;
  let current = null; // last screen message
  let deadline = 0;
  let timerEls = [];
  let board = null;
  const ready = Promise.all(['board', 'characters'].map(loadScript));

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // board.js (the canvas) and characters.js (the avatars), shared with the TV
  function loadScript(name) {
    if (name === 'board' ? window.DrawBoard : window.Characters) return Promise.resolve();
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `games/articulate/${name}.js?v=${Date.now()}`;
      s.onload = resolve;
      document.body.appendChild(s);
    });
  }

  /* ---------- Clock ---------- */

  setInterval(() => {
    if (!deadline) return;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    timerEls.forEach((el) => {
      el.textContent = left;
      el.classList.toggle('low', left <= 10);
    });
  }, 250);

  function setClock(time) {
    deadline = time == null ? 0 : Date.now() + time * 1000;
    timerEls = [...body.querySelectorAll('.ar-timer')];
    timerEls.forEach((el) => { el.textContent = time == null ? '' : time; });
  }

  /* ---------- Screens ---------- */

  function button(label, cls = '') {
    return `<button class="ar-btn ${cls}" type="button">${esc(label)}</button>`;
  }

  const screens = {
    lobby(msg) {
      body.innerHTML = isVip ? `<div class="ar-bottom">${button("Everybody's in", 'ar-start')}</div>` : '';
      const btn = body.querySelector('.ar-start');
      if (!btn) return;
      btn.disabled = !msg.canStart;
      btn.addEventListener('click', () => {
        send({ type: 'start' });
        btn.disabled = true;
      });
    },

    wait() {
      body.innerHTML = '';
    },

    choose(msg) {
      body.innerHTML = `<div class="ar-choose">
        <span class="ar-timer ar-timer-float"></span>
        ${msg.words.map((w, i) => `<button class="ar-btn ar-light ar-word" type="button" data-i="${i}">${esc(w)}</button>`).join('')}
      </div>`;
      body.querySelectorAll('.ar-word').forEach((btn) => btn.addEventListener('click', () => {
        send({ type: 'pick', index: Number(btn.dataset.i) });
        body.querySelectorAll('.ar-word').forEach((b) => { b.disabled = true; b.classList.toggle('picked', b === btn); });
      }));
    },

    draw(msg) {
      body.innerHTML = `<div class="ar-draw">
        <div class="ar-wordbar"><span class="ar-theword"></span><span class="ar-timer"></span></div>
        <div class="ar-canvas-wrap"><canvas class="ar-canvas"></canvas></div>
        <div class="ar-palette">${DrawBoard.COLORS.map((c, i) => `<button type="button" class="ar-swatch" data-c="${i}" style="background:${c}"></button>`).join('')}</div>
        <div class="ar-tools">
          ${DrawBoard.SIZES.map((s, i) => `<button type="button" class="ar-tool ar-size" data-s="${i}"><i style="--d:${[6, 11, 18, 27][i]}px"></i></button>`).join('')}
          <button type="button" class="ar-tool ar-fill">${ICONS.fill}</button>
          <button type="button" class="ar-tool ar-undo">${ICONS.undo}</button>
          <button type="button" class="ar-tool ar-clear">${ICONS.clear}</button>
        </div>
      </div>`;
      body.querySelector('.ar-theword').textContent = msg.word;
      setupDrawing();
    },

    guess(msg) {
      body.innerHTML = `<div class="ar-guess">
        <h3 class="ar-label">Guess</h3>
        <form class="ar-form" autocomplete="off">
          <input class="ar-input" maxlength="40" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">
          <button class="ar-send" type="submit">${ICONS.send}</button>
        </form>
        <div class="ar-solved hidden"></div>
        <h3 class="ar-label ar-prev-label hidden">Previous</h3>
        <ul class="ar-prev"></ul>
      </div>`;
      const form = body.querySelector('.ar-form');
      const input = body.querySelector('.ar-input');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        send({ type: 'guess', text });
        input.value = '';
      });
      updates.guess(msg);
    },

    result(msg) {
      body.innerHTML = '<div class="ar-center"><div class="ar-big"></div></div>';
      body.querySelector('.ar-big').textContent = msg.word;
    },

    end() {
      body.innerHTML = isVip ? `<div class="ar-bottom">${button('New Game', 'ar-again')}</div>` : '';
      const btn = body.querySelector('.ar-again');
      if (btn) btn.addEventListener('click', () => { send({ type: 'again' }); btn.disabled = true; });
    },
  };

  // Repeats of the same screen only refresh what changed, so typing and drawing aren't interrupted
  const updates = {
    lobby(msg) {
      const btn = body.querySelector('.ar-start');
      if (btn) btn.disabled = !msg.canStart;
      else if (isVip) screens.lobby(msg);
    },
    guess(msg) {
      const list = body.querySelector('.ar-prev');
      list.innerHTML = [...msg.guesses].reverse().map((g) => `<li class="${g.close ? 'close' : ''}"><span>${esc(g.text)}</span>${g.close ? '<b>close</b>' : ''}</li>`).join('');
      body.querySelector('.ar-prev-label').classList.toggle('hidden', !msg.guesses.length);
      if (msg.solved) {
        const solved = body.querySelector('.ar-solved');
        if (solved.classList.contains('hidden')) {
          solved.textContent = msg.solved;
          solved.classList.remove('hidden');
          fitText(solved);
          body.querySelector('.ar-form').classList.add('hidden');
          document.activeElement && document.activeElement.blur();
        }
      }
    },
  };

  function show(msg) {
    app.dataset.bg = msg.bg || 'lobby';
    document.body.style.background = `var(--ar-${app.dataset.bg})`;
    const same = current && current.id === msg.id && current.screen === msg.screen;
    current = msg;
    if (same) {
      if (updates[msg.screen]) updates[msg.screen](msg);
    } else {
      board = null;
      (screens[msg.screen] || screens.wait)(msg);
    }
    setClock(msg.time);
    fitAll();
  }

  /* ---------- Drawing ---------- */

  let color = 0;
  let size = 1;
  let tool = 'pen';

  function setupDrawing() {
    const canvas = body.querySelector('.ar-canvas');
    const wrap = body.querySelector('.ar-canvas-wrap');
    board = new DrawBoard(canvas);
    const myBoard = board;

    // Biggest square that fits above the tools; any space left over goes below them
    const area = body.querySelector('.ar-draw');
    function fit() {
      if (board !== myBoard) return window.removeEventListener('resize', fit);
      const others = [...area.children].filter((el) => el !== wrap).reduce((h, el) => h + el.offsetHeight, 0);
      const gaps = (area.children.length - 1) * 10;
      const side = Math.floor(Math.min(area.clientWidth, area.clientHeight - others - gaps));
      wrap.style.width = `${side}px`;
      wrap.style.height = `${side}px`;
      canvas.style.width = `${side}px`;
      canvas.style.height = `${side}px`;
      board.resize(side * Math.min(2, window.devicePixelRatio || 1));
    }
    fit();
    window.addEventListener('resize', fit);

    const swatches = body.querySelectorAll('.ar-swatch');
    const sizes = body.querySelectorAll('.ar-size');
    const fillBtn = body.querySelector('.ar-fill');
    function refreshTools() {
      swatches.forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === color));
      sizes.forEach((b) => b.classList.toggle('on', tool === 'pen' && Number(b.dataset.s) === size));
      fillBtn.classList.toggle('on', tool === 'fill');
      body.querySelector('.ar-tools').style.setProperty('--pen', DrawBoard.COLORS[color]);
    }
    swatches.forEach((b) => b.addEventListener('click', () => { color = Number(b.dataset.c); refreshTools(); }));
    sizes.forEach((b) => b.addEventListener('click', () => { size = Number(b.dataset.s); tool = 'pen'; refreshTools(); }));
    fillBtn.addEventListener('click', () => { tool = tool === 'fill' ? 'pen' : 'fill'; refreshTools(); });
    body.querySelector('.ar-undo').addEventListener('click', () => {
      if (drawing) return;
      board.undo();
      send({ type: 'undo' });
    });
    body.querySelector('.ar-clear').addEventListener('click', () => {
      if (drawing || !board.ops.length) return;
      board.clear();
      send({ type: 'clear' });
    });
    refreshTools();

    let drawing = false;
    let pointerId = null;
    let last = null;
    let buffer = [];
    let flushTimer = null;

    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return [
        DrawBoard.clamp(((e.clientX - r.left) / r.width) * 1000),
        DrawBoard.clamp(((e.clientY - r.top) / r.height) * 1000),
      ];
    };

    function flush() {
      if (!buffer.length) return;
      send({ type: 'pts', p: buffer });
      buffer = [];
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (drawing) return;
      const [x, y] = pos(e);
      if (tool === 'fill') {
        board.add({ t: 'f', c: color, x, y });
        send({ type: 'fill', c: color, x, y });
        return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      drawing = true;
      pointerId = e.pointerId;
      last = [x, y];
      board.add({ t: 'l', c: color, s: size, p: [x, y] });
      send({ type: 'line', c: color, s: size, p: [x, y] });
      flushTimer = setInterval(flush, 50);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || e.pointerId !== pointerId) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (events.length ? events : [e]).forEach((ev) => {
        const [x, y] = pos(ev);
        if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 4) return;
        last = [x, y];
        buffer.push(x, y);
        board.extend([x, y]);
      });
    });

    const stop = (e) => {
      if (!drawing || e.pointerId !== pointerId) return;
      drawing = false;
      clearInterval(flushTimer);
      flush();
    };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  /* ---------- Messages ---------- */

  // Handled strictly in order (the first screen waits for the scripts to load)
  let queue = ready;
  onMessage((data) => { queue = queue.then(() => handle(data)); });

  function handle(data) {
    if (data.type === 'profile') {
      app.style.setProperty('--main', data.color);
      app.style.setProperty('--light', data.light);
      head.classList.add('has-color');
      if (tile.dataset.character !== String(data.character)) {
        tile.dataset.character = data.character;
        tile.insertAdjacentHTML('afterbegin', Characters.svg(data.character));
        if (tile.children.length > 2) tile.children[1].remove(); // the previous character
      }
      const wasVip = isVip;
      isVip = !!data.vip;
      vipTag.classList.toggle('hidden', !isVip);
      // VIP status changed: redraw the screen so the VIP buttons appear or go
      if (wasVip !== isVip && current && ['lobby', 'end'].includes(current.screen)) screens[current.screen](current);
      return;
    }
    if (data.type === 'screen') return show(data);
    if (data.type === 'ops' && board) {
      if (data.first) board.setOps(data.ops.filter((op) => DrawBoard.valid(op)));
      else data.ops.forEach((op) => board.add(op));
    }
  }
});
