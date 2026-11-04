/** View — everything the TV draws (DOM only; the game logic is in game.js). */

const ICONS = {
  crown: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 27 L8 14 L15 19 L20 11 L25 19 L32 14 L30 27 Z" fill="currentColor" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  pencil: `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(45 20 20)"><rect x="16" y="7" width="8" height="19" rx="1.5" fill="currentColor"/><path d="M16 26 H24 L20 33 Z" fill="currentColor"/></g></svg>`,
  trophy: `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path d="M22 18 H10 Q8 40 30 44 M78 18 H90 Q92 40 70 44" fill="none" stroke="#e6b23a" stroke-width="7" stroke-linecap="round"/>
    <path d="M22 10 H78 V36 Q78 62 50 64 Q22 62 22 36 Z" fill="#f3c443"/>
    <rect x="44" y="62" width="12" height="14" fill="#e6b23a"/><rect x="30" y="76" width="40" height="14" rx="4" fill="#f3c443"/>
    <ellipse cx="41" cy="34" rx="4" ry="5" fill="#1d1b1f"/><circle cx="39.8" cy="32" r="1.4" fill="#fff"/>
    <ellipse cx="59" cy="34" rx="4" ry="5" fill="#1d1b1f"/><circle cx="57.8" cy="32" r="1.4" fill="#fff"/>
    <path d="M46 43 Q50 47 54 43" fill="none" stroke="#1d1b1f" stroke-width="2.6" stroke-linecap="round"/>
  </svg>`,
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The style that puts a player's colours on an element */
const colours = (p) => `--main:${p.color.main};--light:${p.color.light}`;

/** A player's character on their light tile */
function tileHTML(p) {
  return `<span class="tile" style="${colours(p)}">${Characters.svg(p.character)}</span>`;
}

/** A player's bar: tile + name on their colour */
/** badges: icons in their own tiles at the right end (crown for the VIP, pencil for the drawer); score: points before it */
function barHTML(p, { cls = '', badges = [], score = false } = {}) {
  const end = badges.filter(Boolean).map((b) => `<span class="tile badge">${ICONS[b]}</span>`).join('');
  const pts = score ? `<span class="score">${p.score}</span>` : ''; // sits just left of the badge, if there is one
  return `<div class="pbar ${cls}" style="${colours(p)}">${tileHTML(p)}<span class="name fit">${esc(p.name)}</span>${pts}${end}</div>`;
}

class View {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      stage: $('stage'),
      lobbyPlayers: $('lobbyPlayers'),
      logo: $('logo'),
      joinUrl: $('joinUrl'),
      roomCode: $('roomCode'),
      round: $('round'),
      status: $('status'),
      timer: $('timer'),
      players: $('players'),
      canvas: $('canvas'),
      overlay: $('overlay'),
      hint: $('hint'),
      feed: $('feed'),
      trophy: $('trophy'),
      winTitle: $('winTitle'),
      podium: $('podium'),
    };
    this.screens = { lobby: $('lobby'), game: $('game'), win: $('win') };
    if (window.barcode && window.barcode.joinUrl) this.el.joinUrl.textContent = window.barcode.joinUrl;
    this.el.timer.innerHTML = '<span class="secs">0</span><span class="bar"><i></i></span>';
    this.el.trophy.innerHTML = ICONS.trophy;
    this.fit();
    window.addEventListener('resize', () => this.fit());
    document.fonts.ready.then(() => this.fitText());
  }

  /** Scale the 1920×1080 stage to the window */
  fit() {
    this.scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    this.el.stage.style.setProperty('--scale', this.scale);
    if (this.onResize) this.onResize();
  }

  /** Shrink any .fit text that doesn't fit its box on one line (long names, long words) */
  fitText(root = this.el.stage) {
    root.querySelectorAll('.fit').forEach((el) => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const min = size * 0.4;
      while (el.scrollWidth > el.clientWidth + 1 && size > min) {
        size *= 0.94;
        el.style.fontSize = `${size}px`;
      }
    });
  }

  /** Pixel size the board canvas should be, for a sharp picture at this window size */
  boardPixels() {
    return Math.min(2400, 780 * this.scale * (window.devicePixelRatio || 1));
  }

  show(screen, bg) {
    Object.entries(this.screens).forEach(([name, el]) => el.classList.toggle('active', name === screen));
    document.body.dataset.bg = bg;
  }

  setLogo(title) {
    this.el.logo.textContent = title;
    document.title = title;
  }

  setRoomCode(code) {
    this.el.roomCode.textContent = code || '';
  }

  setOnline(online) {
    this.el.roomCode.parentElement.classList.toggle('offline', !online);
  }

  /** Dev (B): swap the background to the next texture and show its name for a moment */
  nextTexture() {
    this.tex = ((this.tex || 0) + 1) % TEXTURES.length;
    const file = TEXTURES[this.tex];
    const back = document.querySelector('.backdrop');
    back.style.setProperty('--tex', `url("${new URL(file, location.href).href}")`);
    this.devLabel(`${this.tex + 1}/${TEXTURES.length} · ${file.split('/').pop()}`);
  }

  /** Dev (N): swap the background to the next colour and show its name for a moment */
  nextColor() {
    this.bgColor = ((this.bgColor || 0) + 1) % BG_COLORS.length;
    const [name, hex] = BG_COLORS[this.bgColor];
    document.body.style.setProperty('--bg', hex);
    this.devLabel(`${this.bgColor + 1}/${BG_COLORS.length} · ${name} ${hex}`);
  }

  devLabel(text) {
    const label = document.getElementById('texName');
    label.textContent = text;
    label.classList.remove('hidden');
    clearTimeout(this.texTimer);
    this.texTimer = setTimeout(() => label.classList.add('hidden'), 2500);
  }

  /* ---------- Lobby ---------- */

  renderLobby(players, maxPlayers, vipId) {
    const rows = [];
    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      if (!p) {
        rows.push('<div class="slot-empty"></div>');
        continue;
      }
      const cls = [p.connected ? '' : 'away', p.id === vipId ? 'vip' : ''].join(' ');
      rows.push(barHTML(p, { cls, badges: [p.id === vipId && 'crown'] }));
    }
    this.el.lobbyPlayers.innerHTML = rows.join('');
    this.fitText(this.el.lobbyPlayers);
  }

  /** Big 3, 2, 1 over the lobby; null hides it */
  countdown(n) {
    const el = document.getElementById('countdown');
    el.classList.toggle('hidden', !n);
    el.textContent = n || '';
  }

  /* ---------- Game ---------- */

  setRound(round, total) {
    this.el.round.textContent = round ? `Round ${round} of ${total}` : '';
  }

  setStatus(name, action) {
    this.el.status.textContent = name ? `${name} ${action}` : '';
    this.fitText(this.el.status.parentElement);
  }

  /** Seconds on the left, a white bar that empties as time runs out; the box stays when there's no clock */
  setTimer(seconds) {
    const t = this.el.timer;
    const num = t.querySelector('.secs');
    const fill = t.querySelector('.bar i');
    if (seconds == null) {
      this.timerTotal = null;
      num.textContent = '0';
      fill.style.width = '0';
      t.classList.remove('low');
      return;
    }
    if (this.timerTotal == null || seconds > this.timerTotal) this.timerTotal = seconds; // a new clock started
    num.textContent = seconds;
    fill.style.width = `${(seconds / this.timerTotal) * 100}%`;
    t.classList.toggle('low', seconds <= 10);
  }

  /** In-game list: the drawer on top, then everyone else, then the empty spots */
  renderPlayers(players, drawerId, maxPlayers = 8) {
    const drawer = players.find((p) => p.id === drawerId);
    const ordered = drawer ? [drawer, ...players.filter((p) => p !== drawer)] : players;
    const rows = ordered.map((p) => barHTML(p, {
      cls: p.connected ? '' : 'away',
      badges: [p === drawer && 'pencil', p.id === this.vipId && 'crown'],
      score: true,
    }));
    for (let i = ordered.length; i < maxPlayers; i++) rows.push('<div class="slot-empty"></div>');
    this.el.players.innerHTML = rows.join('');
    this.fitText(this.el.players);
  }

  /** Competition ranking: equal scores share a rank */
  static ranks(players) {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const ranks = new Map();
    sorted.forEach((p, i) => ranks.set(p.id, i > 0 && p.score === sorted[i - 1].score ? ranks.get(sorted[i - 1].id) : i + 1));
    return ranks;
  }

  /** Word hint under the board: blanks with revealed letters, or the whole word */
  setHint(word, revealed, full = false) {
    const h = this.el.hint;
    if (!word) {
      h.innerHTML = '';
      return;
    }
    const parts = [...word].map((ch, i) => {
      if (ch === ' ') return '<span class="gap"></span>';
      if (!/[a-z]/i.test(ch)) return `<span class="letter mark">${esc(ch)}</span>`;
      const shown = full || revealed.has(i);
      return `<span class="letter">${shown ? esc(ch) : ''}</span>`;
    });
    const lens = word.split(' ').map((w) => `<span>${w.length}</span>`).join('');
    // long words get narrower slots so they always fit the bar
    const per = Math.min(50, 640 / word.length);
    h.style.setProperty('--lw', `${Math.round(per * 0.76)}px`);
    h.style.setProperty('--gap', `${Math.round(per * 0.24)}px`);
    h.innerHTML = `${parts.join('')}<span class="lens">${lens}</span>`;
  }

  overlay(html, solid = false) {
    const o = this.el.overlay;
    if (!html) {
      o.classList.add('hidden');
      o.innerHTML = '';
      return;
    }
    o.classList.toggle('solid', solid);
    o.innerHTML = html;
    o.classList.remove('hidden');
    this.fitText(o);
  }

  showPicking(player) {
    this.overlay(`${tileHTML(player)}<div class="big fit">${esc(player.name)}</div><div class="small">is picking</div>`, true);
  }

  showRoundBanner(round, total) {
    this.overlay(`<div class="big">Round ${round}</div><div class="small">of ${total}</div>`, true);
  }

  showTurnResult(word) {
    this.overlay(`<div class="word fit">${esc(word)}</div>`);
  }

  /* ---------- Feed ---------- */

  feedClear() {
    this.el.feed.innerHTML = '';
  }

  feedAdd(player, text) {
    const entry = document.createElement('div');
    entry.className = 'entry';
    entry.innerHTML = `${barHTML(player)}<div class="msg panel">${esc(text)}</div>`;
    this.el.feed.appendChild(entry);
    this.fitText(entry);
    while (this.el.feed.children.length > 14) this.el.feed.firstElementChild.remove();
  }

  /* ---------- Win: top three ---------- */

  renderWin(players) {
    const ranks = View.ranks(players);
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const names = sorted.filter((p) => ranks.get(p.id) === 1).map((p) => p.name);
    const joined = names.length > 1 ? `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}` : names[0] || '';
    this.el.winTitle.textContent = `${joined} ${names.length > 1 ? 'win' : 'wins'}`;

    const top = sorted.slice(0, 3);
    const order = [top[2], top[0], top[1]]; // 3rd left, 1st middle, 2nd right
    this.el.podium.innerHTML = order.map((p, slot) => {
      if (!p) return '';
      const place = [3, 1, 2][slot];
      return `<div class="place p${place}" style="${colours(p)}">
        <div class="num">#${ranks.get(p.id)}</div>
        ${tileHTML(p)}
        <div class="pname"><span class="name fit">${esc(p.name)}</span></div>
      </div>`;
    }).join('');
    this.fitText(this.screens.win);
  }
}
