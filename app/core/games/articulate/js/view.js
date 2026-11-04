/** View — everything the TV draws (DOM only; the game logic is in game.js). */

const ICONS = {
  crown: `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 27 L8 14 L15 19 L20 11 L25 19 L32 14 L30 27 Z" fill="#fff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>`,
  pencil: `<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(45 20 20)"><rect x="16" y="7" width="8" height="19" rx="1.5" fill="#fff"/><path d="M16 26 H24 L20 33 Z" fill="#fff"/></g></svg>`,
  clock: `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="22" r="14" fill="none" stroke="#fff" stroke-width="4"/><path d="M20 14 V22 L25 26 M15 4 H25" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
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

/** A player's character on their light tile, with an optional corner tag */
function tileHTML(p, tag = '') {
  return `<span class="tile" style="${colours(p)}">${Characters.svg(p.character)}${tag ? `<span class="tag">${ICONS[tag]}</span>` : ''}</span>`;
}

/** A player's bar: tile + name on their colour */
function barHTML(p, { cls = '', tag = '' } = {}) {
  return `<div class="pbar ${cls}" style="${colours(p)}">${tileHTML(p, tag)}<span class="name fit">${esc(p.name)}</span></div>`;
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
    this.slotIds = []; // which player sits in each lobby slot, to pop only new ones
    if (window.barcode && window.barcode.joinUrl) this.el.joinUrl.textContent = window.barcode.joinUrl;
    this.el.timer.innerHTML = `${ICONS.clock}<span></span>`;
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

  /* ---------- Lobby ---------- */

  renderLobby(players, maxPlayers, vipId) {
    const rows = [];
    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      if (!p) {
        rows.push('<div class="slot-empty"></div>');
        continue;
      }
      const cls = [this.slotIds[i] !== p.id ? 'pop' : '', p.connected ? '' : 'away', p.id === vipId ? 'vip' : ''].join(' ');
      rows.push(barHTML(p, { cls, tag: 'crown' }));
    }
    this.slotIds = players.map((p) => p.id);
    this.el.lobbyPlayers.innerHTML = rows.join('');
    this.fitText(this.el.lobbyPlayers);
  }

  /* ---------- Game ---------- */

  setRound(round, total) {
    this.el.round.textContent = round ? `Round ${round} of ${total}` : '';
  }

  setStatus(name, action) {
    this.el.status.textContent = name ? `${name} ${action}` : '';
    this.fitText(this.el.status.parentElement);
  }

  setTimer(seconds) {
    const t = this.el.timer;
    if (seconds == null) return t.classList.add('hidden');
    t.classList.remove('hidden');
    const num = t.querySelector('span');
    if (num.textContent !== String(seconds)) {
      num.textContent = seconds;
      t.classList.remove('low');
      if (seconds <= 10) {
        void t.offsetWidth; // restart the shake
        t.classList.add('low');
      }
    }
  }

  renderPlayers(players, drawerId) {
    this.el.players.innerHTML = players.map((p) => barHTML(p, {
      cls: [p.id === drawerId ? 'drawing' : '', p.connected ? '' : 'away'].join(' '),
      tag: 'pencil',
    })).join('');
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
    const before = new Set([...h.querySelectorAll('.letter.shown')].map((el) => el.dataset.i));
    const parts = [...word].map((ch, i) => {
      if (ch === ' ') return '<span class="gap"></span>';
      if (!/[a-z]/i.test(ch)) return `<span class="letter mark">${esc(ch)}</span>`;
      const shown = full || revealed.has(i);
      const isNew = shown && !before.has(String(i));
      return `<span class="letter${shown ? ' shown' : ''}${isNew ? ' new' : ''}" data-i="${i}">${shown ? esc(ch) : ''}</span>`;
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
    o.style.animation = 'none';
    void o.offsetWidth;
    o.style.animation = '';
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
