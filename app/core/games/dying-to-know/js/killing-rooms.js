/**
 * Killing-rooms.js - The killing room, played after every question
 *
 * The last living player to answer is taken: they fly to the middle, bigger, and a 20s flip clock
 * starts. Anyone else alive can volunteer from their phone; volunteers join the line beside them,
 * smaller, with their reward above their heads (first volunteer gets most if they survive, and loses it if they die).
 * Then the lights cut like a room change with only the participants' eyes showing, and the
 * participants play a room (a class with `async run(players)` resolving to whoever died) in the
 * separate killing-room scene. Phone messages are forwarded to `onMessage`.
 */

// Every wait in a killing room rejects once the room is aborted (the round was skipped)
const KILL_ABORTED = new Error('killing room aborted');
let activeDirector = null;
const wait = (ms) => new Promise((resolve, reject) => {
  setTimeout(() => (activeDirector && activeDirector.aborted ? reject(KILL_ABORTED) : resolve()), ms);
});
const ROOM_ART = 'assets/images/killing';
const SACRIFICE_SECONDS = 20;
const SACRIFICE_REWARDS = [300, 200, 150, 100, 50]; // then £50 for everyone after
const TAKEN_SCALE = 1.3;
const VOLUNTEER_SCALE = 0.8;
const MAX_VOLUNTEERS = 2; // the room holds the taken player plus two

/** Dev settings live on the manager (see the dev panel); timers shrink in fast mode */
const devOf = (m) => m.dev || {};
const secs = (m, normal) => (devOf(m).fast ? Math.min(normal, 4) : normal);

/** Fisher-Yates copy */
const shuffled = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Players walk up to a row near the top of a room, one after another like flyTo */
async function takePlacesRow(manager, players) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const gap = 125 * 0.8 + Math.min(Math.max(24, w * 0.036), 64);
  const targets = new Map(players.map((p, i) => [p, { x: w / 2 + (i - (players.length - 1) / 2) * gap, y: h * 0.3, k: 0.8 }]));
  await manager.placeForKilling(targets, 850, new Set(), 90);
  await wait(1500);
}

/**
 * The death scene, one player at a time: the lights flick off and back on, and they're alone in the
 * lobby wallpaper in their own colour, big and still in the middle. A beat (a voice line goes here
 * later), then they die. Lights flick again and everything is back as it was, minus them.
 */
async function deathScene(manager, losers) {
  const m = manager;
  const room = document.getElementById('deathRoom');
  if (losers.length && m.sound) m.sound.fadeMusicOut(2200); // silence for the deaths, out with the build
  for (const loser of losers) {
    // Remember who was showing and where, to put it all back afterwards
    const before = new Map(m.players.map((p) => {
      const r = p.slot.getBoundingClientRect();
      return [p, { x: r.left + r.width / 2, y: r.top + r.height / 2, k: p.currentScale || 1, away: p.slot.classList.contains('kr-away') }];
    }));

    // Room change into their own room: alone, big and still in the middle
    await m.roomChange({
      switchBg: false,
      still: [loser],
      onDark: () => {
        room.style.setProperty('--c', loser.nameColor);
        room.classList.remove('hidden');
        m.players.forEach((p) => p.slot.classList.toggle('kr-away', p !== loser));
        m.placeForKilling(new Map([[loser, { x: window.innerWidth / 2, y: window.innerHeight * 0.55, k: 3.2 }]]), 0);
        loser.wrapper.style.transform = `scale(3.2) rotate(${Math.random() < 0.5 ? -8 : 8}deg)`;
      },
    });
    await wait(1500); // the host's goodbye line will play here

    loser.startDeathSpin();
    if (m.sound) m.sound.playScream();
    await wait(2600);

    // Room change back to the killing room, everything as it was, minus them
    await m.roomChange({
      switchBg: false,
      onDark: () => {
        m.placeForKilling(before, 0);
        m.players.forEach((p) => p.slot.classList.toggle('kr-away', before.get(p).away));
        room.classList.add('hidden');
      },
      onLight: () => { if (loser === losers[losers.length - 1] && m.sound) m.sound.fadeMusicIn(2500); },
    });
    await wait(600);
  }
}

let sharedKillClock = null;
const killClock = () => sharedKillClock || (sharedKillClock = new FlipClock(document.getElementById('killFlipClock'), 2));

class KillingRoomDirector {
  constructor(manager) {
    this.manager = manager;
    this.scene = document.getElementById('killingRoom');
    this.clockEl = document.getElementById('killTimer');
    this.clock = killClock();
    this.volunteers = []; // [{ player, reward }] in the order they volunteered
    this.room = null;
  }

  rewardFor(position) {
    return SACRIFICE_REWARDS[position] ?? SACRIFICE_REWARDS[SACRIFICE_REWARDS.length - 1];
  }

  /**
   * Taken player in the middle; volunteers alternate right then left of them, in one row
   * spaced like the scoreboard (same gap, sized to each player's scale)
   */
  offerLayout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const SLOT = 125;
    const gap = Math.min(Math.max(24, w * 0.036), 64);
    const y = h * 0.55;
    const targets = new Map([[this.taken, { x: w / 2, y, k: TAKEN_SCALE }]]);
    const edge = { 1: w / 2 + (SLOT * TAKEN_SCALE) / 2, '-1': w / 2 - (SLOT * TAKEN_SCALE) / 2 };
    this.volunteers.forEach(({ player }, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const half = (SLOT * VOLUNTEER_SCALE) / 2;
      const x = edge[side] + side * (gap + half);
      edge[side] = x + side * half;
      targets.set(player, { x, y: y + (SLOT * (TAKEN_SCALE - VOLUNTEER_SCALE)) / 2, k: VOLUNTEER_SCALE });
    });
    return targets;
  }

  /** Runs the killing room for `taken`, up to the end of the room; resolves to the players who died */
  async run(taken) {
    const m = this.manager;
    activeDirector = this;
    this.taken = taken;
    const candidates = m.players.filter((p) => p !== taken && p.isAlive());

    // 1. The taken player flies to the middle, bigger (results stay up for everyone else)
    taken.slot.style.opacity = '1';
    m.setPhoneState({ type: 'wait' });
    if (taken.roomId) m.net.sendTo(taken.roomId, { type: 'wait', text: 'Taken' });
    m.placeForKilling(this.offerLayout());
    await wait(1100);

    // 2. Twenty seconds for anyone else to volunteer (dev can skip this or make every bot volunteer)
    const offerSeconds = devOf(m).skipOffer ? 0 : secs(m, SACRIFICE_SECONDS);
    this.offerOpen = offerSeconds > 0;
    if (this.offerOpen) {
      candidates.forEach((p, i) => {
        if (p.roomId) m.net.sendTo(p.roomId, { type: 'sacrifice', reward: this.rewardFor(0) });
        else if (devOf(m).fillRoom) setTimeout(() => this.volunteer(p), 500 + i * 450);
        else if (Math.random() < 0.3) setTimeout(() => this.volunteer(p), 1200 + Math.random() * (offerSeconds - 2) * 1000);
      });
      this.clock.set(offerSeconds, false);
      this.clockEl.classList.remove('hidden', 'urgent');
      if (m.sound) m.sound.playTrack('killing_choose', 1200);
      if (m.sound) m.sound.playVoiceline('assets/sound/voice/killing-volunteer.mp3'); // "I'll give two people the chance to join them for money"
      if (m.sound) m.sound.playTick(0.85);
    }
    for (let s = offerSeconds - 1; s >= 0 && !this.offerFull(candidates); s--) {
      await wait(1000);
      if (this.offerFull(candidates)) break;
      this.clock.set(s);
      this.clockEl.classList.toggle('urgent', s <= 5);
      if (s > 0 && m.sound) m.sound.playTick(0.85);
    }
    this.offerOpen = false;
    candidates.forEach((p) => {
      if (p.roomId) m.net.sendTo(p.roomId, { type: 'wait', text: this.volunteers.some((v) => v.player === p) ? 'Volunteered' : '' });
    });
    if (offerSeconds > 0 && candidates.length && !this.volunteers.length && m.sound) {
      // Nobody joined: "Guess not." on 0, then a second after he finishes
      await m.sound.playVoiceline('assets/sound/voice/killing-guess-not.mp3');
      await wait(1000);
    } else {
      await wait(1200); // a beat on 0
    }
    this.clockEl.classList.add('hidden');

    // 3. The room change into the killing room: in the dark everyone else is gone and the room
    //    is built; the lights come up on it
    const players = [taken, ...this.volunteers.map((v) => v.player)];
    this.players = players;
    if (m.sound) m.sound.fadeMusicOut(2200);
    await m.roomChange({
      switchBg: false,
      onDark: () => {
        m.players.forEach((p) => p.slot.classList.toggle('kr-away', !players.includes(p)));
        this.volunteers.forEach(({ player }) => player.moneyEl.classList.remove('visible'));
        m.players.forEach((p) => {
          p.fadeResultBadge();
          p.clearResult(p.currentScale);
        });
        this.scene.classList.remove('hidden');
        const forced = KILLING_ROOMS.find((R) => R.id === devOf(m).room);
        const Room = forced || KILLING_ROOMS[Math.floor(Math.random() * KILLING_ROOMS.length)];
        this.room = new Room(m, this.scene);
        this.room.build(players);
      },
      onLight: () => {
        players.forEach((p) => { if (p.roomId) m.sendProfile(p.roomId, p); }); // their phones switch to the killing room
        if (m.sound) m.sound.playTrack('killing_room', 2000);
      },
    });
    await wait(2000);

    // 4. They take their places, then the room plays out
    await this.room.takePlaces(players);
    const losers = await this.room.run(players);
    this.room = null;

    // 5. Volunteers win their reward if they survive, and lose it if they die
    this.volunteers.forEach(({ player, reward }) => {
      player.money += losers.includes(player) ? -reward : reward;
    });
    players.forEach((p) => {
      if (!p.roomId) return;
      const v = this.volunteers.find((x) => x.player === p);
      m.net.sendTo(p.roomId, { type: 'wait', text: losers.includes(p) ? 'Dead' : v ? `+£${v.reward}` : 'Survived' });
    });
    await wait(1500);
    activeDirector = null;
    return losers;
  }

  /** Skip: stop everything in flight; `leave()` tidies up in the dark of the next room change */
  abort() {
    this.aborted = true;
    this.offerOpen = false;
    if (this.room) this.room.picking = false;
    this.clockEl.classList.add('hidden');
  }

  /** Lights back on in the hotel: the room's phones lose the killing-room wall (the director is no longer m.killingRoom) */
  phonesOut() {
    (this.players || []).forEach((p) => { if (p.roomId) this.manager.sendProfile(p.roomId, p); });
  }

  /** Called in the dark of the next room change: back to the hotel, everyone in the grid */
  leave() {
    const m = this.manager;
    document.getElementById('deathRoom').className = 'death-room hidden'; // in case a skip cut a death scene short
    this.scene.classList.add('hidden');
    this.scene.innerHTML = '';
    this.scene.style.backgroundImage = '';
    this.scene.classList.remove('flash');
    this.clockEl.classList.add('hidden');
    if (activeDirector === this) activeDirector = null;
    m.camera.setGridMode('grid');
    m.players.forEach((p) => {
      p.slot.classList.remove('kr-away');
      p.moneyEl.classList.remove('visible');
      p.cancelFlight();
      p.clearResult(1.0);
    });
  }

  /** Nobody else can join: two volunteers, or everyone who could has */
  offerFull(candidates) {
    return this.volunteers.length >= Math.min(MAX_VOLUNTEERS, candidates.length);
  }

  volunteer(player) {
    if (!this.offerOpen || this.volunteers.length >= MAX_VOLUNTEERS) return;
    if (this.volunteers.some((v) => v.player === player) || !player.isAlive()) return;
    player.slot.style.opacity = '1';
    const reward = this.rewardFor(this.volunteers.length);
    this.volunteers.push({ player, reward });
    const m = this.manager;
    player.setMoneyText(reward);
    player.setMoneyBar(0);
    player.moneyEl.classList.remove('down');
    player.moneyEl.classList.add('visible');
    // Only the new volunteer flies in; anyone already in the row slides over
    m.placeForKilling(this.offerLayout(), 850, new Set([this.taken, ...this.volunteers.slice(0, -1).map((v) => v.player)]));
    if (m.sound) m.sound.playLight();
    // Everyone still deciding sees the reward drop, or loses the button once the room is full
    const full = this.volunteers.length >= MAX_VOLUNTEERS;
    m.players.forEach((c) => {
      if (c.roomId && c !== this.taken && c.isAlive() && !this.volunteers.some((v) => v.player === c)) {
        m.net.sendTo(c.roomId, full ? { type: 'wait' } : { type: 'sacrifice', reward: this.rewardFor(this.volunteers.length) });
      }
    });
  }

  onMessage(player, data) {
    if (data.type === 'volunteer') this.volunteer(player);
    else if (this.room && this.room.onMessage) this.room.onMessage(player, data);
  }
}

/**
 * Baggage Claim: after 3, 2, 1, 5 to 7 items glide across the screen, left to right. Then everyone
 * picks, from 12 on their phone, the ones they saw. The real items come back one by one from the right,
 * then everyone's score (right picks minus wrong picks) shows under them and the lowest dies
 * (two tied at the bottom both die, three or more tied all live; nobody dies if everyone was perfect).
 *
 * Art: each item shows `art` (assets/images/killing/baggage-claim/<id>.png): real photos hand-picked
 * from Pixabay, sources in credits.json there. A missing file falls back to a coloured rectangle.
 */
const BAGGAGE_ITEMS = [
  { id: 'alarm-clock', label: "Alarm clock", color: '#d64545' },
  { id: 'binoculars', label: "Binoculars", color: '#3f6fd8' },
  { id: 'boombox', label: "Boombox", color: '#3f9e5a' },
  { id: 'briefcase', label: "Briefcase", color: '#e9c23f' },
  { id: 'candlestick', label: "Candlestick", color: '#8b4fc7' },
  { id: 'cassette-recorder', label: "Cassette recorder", color: '#e8833a' },
  { id: 'chandelier', label: "Chandelier", color: '#e86aa8' },
  { id: 'compass', label: "Compass", color: '#8a5a33' },
  { id: 'fedora', label: "Fedora hat", color: '#7d8590' },
  { id: 'film-projector', label: "Film projector", color: '#2fa8a0' },
  { id: 'globe', label: "Globe", color: '#d64545' },
  { id: 'gramophone', label: "Gramophone", color: '#3f6fd8' },
  { id: 'headphones', label: "Headphones", color: '#3f9e5a' },
  { id: 'hourglass', label: "Hourglass", color: '#e9c23f' },
  { id: 'lantern', label: "Oil lantern", color: '#e8833a' },
  { id: 'lighter', label: "Lighter", color: '#e86aa8' },
  { id: 'magnifying-glass', label: "Magnifying glass", color: '#8a5a33' },
  { id: 'old-camera', label: "Old camera", color: '#7d8590' },
  { id: 'old-key', label: "Old key", color: '#2fa8a0' },
  { id: 'padlock', label: "Padlock", color: '#3f6fd8' },
  { id: 'pocket-watch', label: "Pocket watch", color: '#3f9e5a' },
  { id: 'record-player', label: "Record player", color: '#8b4fc7' },
  { id: 'revolver', label: "Revolver", color: '#e8833a' },
  { id: 'rotary-phone', label: "Rotary phone", color: '#e86aa8' },
  { id: 'satchel', label: "Leather satchel", color: '#8a5a33' },
  { id: 'sewing-machine', label: "Sewing machine", color: '#7d8590' },
  { id: 'sneaker', label: "Sneaker", color: '#2fa8a0' },
  { id: 'suitcase', label: "Suitcase", color: '#d64545' },
  { id: 'teapot', label: "Silver teapot", color: '#3f6fd8' },
  { id: 'teddy-bear', label: "Teddy bear", color: '#3f9e5a' },
  { id: 'trumpet', label: "Trumpet", color: '#8b4fc7' },
  { id: 'typewriter', label: "Typewriter", color: '#e8833a' },
  { id: 'umbrella', label: "Umbrella", color: '#e86aa8' },
  { id: 'vhs-tape', label: "VHS tape", color: '#8a5a33' },
  { id: 'wristwatch', label: "Wristwatch", color: '#7d8590' },
].map((it) => ({ ...it, art: `${ROOM_ART}/baggage-claim/${it.id}.png` }));

class BaggageClaim {
  static id = 'baggage-claim';
  static title = 'Baggage Claim';
  static OPTIONS = 12; // on the phone: the 5-7 shown plus the rest that weren't
  static PICK_SECONDS = 15;
  static RIDE_MS = 5200;   // one case crossing the screen
  static SPACING_MS = 1150; // gap between items crossing
  static PARK_GAP_VW = 15;
  static SLIDE_MS = 750;     // one item sliding into or out of the row
  static slideGap = (k) => Math.max(90, 280 - k * 30); // the next one sets off sooner each time   // centre to centre once they're back

  constructor(manager, scene) {
    this.manager = manager;
    this.scene = scene;
    this.picks = new Map(); // player → Set of item ids
  }

  build(players) {
    this.players = players;
    const options = shuffled(BAGGAGE_ITEMS).slice(0, BaggageClaim.OPTIONS);
    this.shown = options.slice(0, 5 + Math.floor(Math.random() * 3)); // 5 to 7
    this.options = shuffled(options); // phone order gives nothing away
    this.scene.style.backgroundImage = `url('${ROOM_ART}/baggage-claim/background.png')`;
    this.scene.innerHTML = `
      <div class="kr-bc">
        <div class="kr-bc-lane"></div>
        <div class="kr-bc-count"></div>
        <div class="kr-bc-prompt hidden">What objects did you see?</div>
      </div>`;
    this.lane = this.scene.querySelector('.kr-bc-lane');
  }

  takePlaces(players) {
    return takePlacesRow(this.manager, players);
  }

  item(it, extra = '') {
    const el = document.createElement('div');
    el.className = `kr-bc-item ${extra}`;
    el.style.setProperty('--c', it.color);
    el.innerHTML = '<div class="kr-bc-box"><img alt=""></div><span></span>';
    scrambleQuick(el.querySelector('span'), it.label);
    const img = el.querySelector('img');
    img.addEventListener('load', () => el.classList.add('has-art'));
    img.src = it.art;
    return el;
  }

  async run(players) {
    const m = this.manager;
    const clockEl = document.getElementById('killTimer');
    const clock = killClock();

    // 1. 3, 2, 1, then the items glide across one after another, left to right
    const count = this.scene.querySelector('.kr-bc-count');
    for (const k of [3, 2, 1]) {
      count.textContent = k;
      count.classList.remove('pop');
      void count.offsetWidth;
      count.classList.add('pop');
      if (m.sound) m.sound.playTick(0.9);
      await wait(900);
    }
    count.textContent = '';
    await wait(300);
    this.shown.forEach((it, i) => {
      setTimeout(() => {
        if (this.manager.killingRoom && this.manager.killingRoom.aborted) return;
        const el = this.item(it, 'riding');
        el.style.transitionDuration = `${BaggageClaim.RIDE_MS}ms`;
        this.lane.appendChild(el);
        void el.offsetWidth;
        el.classList.add('across');
        if (m.sound) m.sound.playWhoosh();
      }, i * BaggageClaim.SPACING_MS);
    });
    await wait((this.shown.length - 1) * BaggageClaim.SPACING_MS + BaggageClaim.RIDE_MS + 300);
    this.lane.innerHTML = '';

    // 2. What did you see? Everyone picks on their phone
    const prompt = this.scene.querySelector('.kr-bc-prompt');
    prompt.classList.remove('hidden');
    scrambleQuick(prompt, 'What objects did you see?');
    if (m.sound) m.sound.playSlam(0.7);
    this.picks = new Map();
    this.picking = true;
    const shownIds = new Set(this.shown.map((it) => it.id));
    players.forEach((p) => {
      if (p.roomId) {
        m.net.sendTo(p.roomId, { type: 'objects', options: this.options.map(({ id, label, color }) => ({ id, label, color })) });
      } else {
        // bots remember most of what they saw and sometimes imagine things
        setTimeout(() => {
          const ids = this.options.filter((it) => (shownIds.has(it.id) ? Math.random() < 0.75 : Math.random() < 0.15)).map((it) => it.id);
          this.pick(p, ids);
        }, 1500 + Math.random() * 5000);
      }
    });
    m.phoneState = { type: 'wait' };
    const pickSeconds = secs(m, BaggageClaim.PICK_SECONDS);
    clock.set(pickSeconds, false);
    clockEl.classList.remove('hidden', 'urgent');
    if (m.sound) m.sound.playTick(0.85);
    for (let s = pickSeconds - 1; s >= 0; s--) { // no submit: the timer always runs out
      await wait(1000);
      clock.set(s);
      clockEl.classList.toggle('urgent', s <= 5);
      if (s > 0 && m.sound) m.sound.playTick(0.85);
    }
    this.picking = false;
    players.forEach((p) => { if (p.roomId) m.net.sendTo(p.roomId, { type: 'wait' }); });
    await wait(1200); // a beat on 0;
    clockEl.classList.add('hidden');
    prompt.classList.add('hidden');

    // 3. The real items come back the way they'll leave, mirrored: rightmost first, each sliding
    //    in and slowing to a stop, the next setting off sooner each time
    const n = this.shown.length;
    const gap = Math.min(BaggageClaim.PARK_GAP_VW, 88 / n);
    this.lane.style.setProperty('--w', `${Math.min(11, gap * 0.9).toFixed(2)}vw`);
    for (let k = 0, i = n - 1; i >= 0; k++, i--) {
      const el = this.item(this.shown[i], 'riding');
      el.style.transitionDuration = `${BaggageClaim.SLIDE_MS}ms`;
      el.style.setProperty('--stop', `${50 + (i - (n - 1) / 2) * gap}vw`);
      this.lane.appendChild(el);
      void el.offsetWidth;
      el.classList.add('parked');
      if (m.sound) m.sound.playWhoosh(0.12);
      await wait(BaggageClaim.slideGap(k));
    }
    await wait(BaggageClaim.SLIDE_MS + 1000);

    // 4. A score under each player: right picks minus wrong picks (so picking everything doesn't pay)
    const score = (p) => {
      let v = 0;
      (this.picks.get(p) || new Set()).forEach((id) => { v += shownIds.has(id) ? 1 : -1; });
      return v;
    };
    const scores = players.map(score);
    const nums = [];
    for (const [i, p] of players.entries()) {
      const r = p.slot.getBoundingClientRect();
      const num = document.createElement('div');
      num.className = 'kr-bc-score';
      num.textContent = scores[i];
      num.style.left = `${r.left + r.width / 2}px`;
      num.style.top = `${r.bottom}px`;
      this.scene.appendChild(num);
      nums.push(num);
      if (m.sound) m.sound.playLight();
      await wait(450);
    }
    await wait(800);

    // 5. The lowest score turns red. It dies (a tie of two both die, three or more all live),
    //    unless everyone was perfect; a lone player gets one slip
    const worst = Math.min(...scores);
    const lowest = players.filter((p, i) => scores[i] === worst);
    let losers;
    if (players.length === 1) losers = scores[0] < n - 1 ? [...players] : [];
    else if (scores.every((v) => v === n)) losers = [];
    else losers = lowest.length <= 2 ? lowest : [];
    if (players.length > 1 && !scores.every((v) => v === n)) {
      nums.forEach((el, i) => el.classList.toggle('lowest', scores[i] === worst));
      if (m.sound) m.sound.playSlam(0.8);
    }
    await wait(1800);
    // 6. The items are pulled off the right edge before anyone dies
    //    one at a time from the right, each pulled away faster and faster, starts overlapping
    const parked = [...this.lane.querySelectorAll('.kr-bc-item')]; // in DOM order: rightmost first
    for (const [i, el] of parked.entries()) {
      el.style.transitionDuration = `${BaggageClaim.SLIDE_MS}ms`;
      el.classList.add('gone');
      if (m.sound) m.sound.playWhoosh(0.12);
      await wait(BaggageClaim.slideGap(i));
    }
    await wait(BaggageClaim.SLIDE_MS + 200);
    await deathScene(m, losers);
    await wait(losers.length ? 800 : 400);

    return losers;
  }

  /** A player's current selection; the latest one when the timer ends counts */
  pick(player, ids) {
    if (!this.picking || !this.players.includes(player)) return;
    const valid = new Set(this.options.map((it) => it.id));
    this.picks.set(player, new Set((ids || []).filter((id) => valid.has(id))));
    if (this.manager.sound) this.manager.sound.playLight();
  }

  onMessage(player, data) {
    if (data.type === 'objects') this.pick(player, data.ids);
  }
}

const KILLING_ROOMS = [BaggageClaim];
