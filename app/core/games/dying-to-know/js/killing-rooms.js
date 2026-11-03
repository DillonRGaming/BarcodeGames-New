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
const SACRIFICE_REWARDS = [300, 200, 150, 100, 50]; // then $50 for everyone after
const TAKEN_SCALE = 1.3;
const VOLUNTEER_SCALE = 0.8;
const MAX_VOLUNTEERS = 2; // the room holds the taken player plus two
// Spoken names of the player colours, in palette.js order (bone white is just "white")
const TAKEN_COLOUR_NAMES = ['blue', 'red', 'green', 'yellow', 'purple', 'orange', 'pink', 'teal', 'brown', 'white'];

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

const GORE_DEATHS = ['rip', 'chop', 'balloon'];

/**
 * A gore death (rip-test.html, embedded): the page covers the screen, drawn over the player's letter at
 * exactly its size and place, with the death room behind. Resolves `ready` once loaded and `done` when
 * it's time for the ghost; `go()` starts it, `remove()` takes it away.
 */
function loadGore(player, kind) {
  const r = player.frontImg.getBoundingClientRect();
  const frame = document.createElement('iframe');
  frame.className = 'gore-frame';
  frame.src = `rip-test.html?embed=${kind}&letter=${encodeURIComponent(player.letter)}&col=${encodeURIComponent(player.nameColor)}`
    + `&x=${(r.left + r.right) / 2}&top=${r.top}&h=${r.height}`;
  document.body.appendChild(frame);
  const heard = (what) => new Promise((resolve) => {
    const on = (e) => { if (e.source === frame.contentWindow && e.data && e.data.gore === what) { window.removeEventListener('message', on); resolve(); } };
    window.addEventListener('message', on);
  });
  const ready = Promise.race([heard('ready'), wait(6000)]); // never hold the game up if it fails to load
  return {
    ready,
    done: heard('done'),
    go() { frame.classList.add('on'); frame.contentWindow.postMessage({ gore: 'go' }, '*'); },
    remove() { frame.remove(); },
  };
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
        loser.wrapper.style.transform = 'scale(3.2)'; // upright, so the gore lines up with it exactly
      },
    });
    // Loaded during the beat, once the letter has settled where it'll die
    const gore = loadGore(loser, GORE_DEATHS[Math.random() * GORE_DEATHS.length | 0]);
    await wait(1500); // the host's goodbye line will play here
    await gore.ready;

    // It dies (the page draws it from here, so the real letter hides), then its ghost glows in where it was
    gore.go();
    loser.slot.style.visibility = 'hidden';
    loser.joinDead();
    if (loser.onLifeChange) loser.onLifeChange();
    await Promise.race([gore.done, wait(12000)]);
    loser.slot.style.visibility = '';
    loser.spawnGlow();
    await wait(2200);

    // Room change back to the killing room, everything as it was, minus them
    await m.roomChange({
      switchBg: false,
      onDark: () => {
        gore.remove();
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
    this.volunteers = []; // [{ player, reward }] in the line, in the order they volunteered
    this.claimed = [];    // everyone who pressed Volunteer, including any still waiting to be brought in
    this.admitting = Promise.resolve(); // volunteers are brought in one at a time
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

    // 1. The host calls out the slowest by colour ("Too slow, Yellow!", one of three lines),
    //    and once he's said it they fly to the middle, bigger (results stay up for everyone else)
    m.setPhoneState({ type: 'wait' });
    if (taken.roomId) m.net.sendTo(taken.roomId, { type: 'wait', text: 'Taken' });
    const colour = TAKEN_COLOUR_NAMES[taken.colorIndex];
    if (colour && m.sound) {
      const line = ['last', 'ooh', 'mine'][Math.floor(Math.random() * 3)];
      await m.sound.playVoiceline(`assets/sound/voice/taken/${line}-${colour}.mp3`);
      await wait(300);
    }
    taken.slot.style.opacity = '1';
    taken.slot.style.zIndex = '30'; // in front of everyone still in the line-up
    m.placeForKilling(this.offerLayout());
    await wait(1100);

    // 2. Twenty seconds for anyone else to volunteer (dev can skip this or make every bot volunteer)
    //    The host's offer comes first; the clock and the phones' buttons start once he's said it
    const offerSeconds = devOf(m).skipOffer ? 0 : secs(m, SACRIFICE_SECONDS);
    if (offerSeconds > 0) {
      this.clock.set(offerSeconds, false);
      this.clockEl.classList.remove('hidden', 'urgent');
      if (m.sound) {
        m.sound.playTrack('killing_choose', 1200);
        await m.sound.playVoiceline(`assets/sound/voice/killing-volunteer-${1 + Math.floor(Math.random() * 6)}.mp3`); // "I'll give two people the chance to join them... for money"
        await wait(300);
      }
      this.offerOpen = true;
      this.showBanks(candidates);
      candidates.forEach((p, i) => {
        if (p.roomId) m.net.sendTo(p.roomId, { type: 'sacrifice', reward: this.rewardFor(0) });
        else if (devOf(m).fillRoom) setTimeout(() => this.volunteer(p), 500 + i * 450);
        else if (Math.random() < 0.3) setTimeout(() => this.volunteer(p), 1200 + Math.random() * (offerSeconds - 2) * 1000);
      });
      if (m.sound) m.sound.playTick(0.85);
    }
    for (let s = offerSeconds - 1; s >= 0 && !this.offerFull(candidates); s--) {
      await wait(1000);
      if (this.offerFull(candidates)) break;
      this.clock.set(s);
      this.clockEl.classList.toggle('urgent', s <= 5);
      if (s > 0 && m.sound) m.sound.playTick(0.85);
      // One volunteer, one place left and under 8 seconds: "There's still one spot left..."
      if (s === 7 && this.claimed.length === 1 && candidates.length > 1 && m.sound) {
        await this.admitting;
        await m.sound.playVoiceline(`assets/sound/voice/killing-spot-left-${1 + Math.floor(Math.random() * 3)}.mp3`);
      }
      // Halfway and still nobody: "Any takers?" (the clock waits for him)
      if (s === Math.floor(offerSeconds / 2) && candidates.length && !this.claimed.length && m.sound) {
        await m.sound.playVoiceline(`assets/sound/voice/killing-any-takers-${1 + Math.floor(Math.random() * 2)}.mp3`);
      }
    }
    this.offerOpen = false;
    await this.admitting; // anyone still being welcomed in finishes first
    this.hideBank();
    candidates.forEach((p) => {
      if (p.roomId) m.net.sendTo(p.roomId, { type: 'wait', text: this.volunteers.some((v) => v.player === p) ? 'Volunteered' : '' });
    });
    if (offerSeconds > 0 && candidates.length && !this.volunteers.length && m.sound) {
      // Nobody joined: "Guess not." on 0, then a second after he finishes
      await m.sound.playVoiceline(`assets/sound/voice/killing-guess-not-${1 + Math.floor(Math.random() * 2)}.mp3`);
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
      m.net.sendTo(p.roomId, { type: 'wait', text: losers.includes(p) ? 'Dead' : v ? `+$${v.reward}` : 'Survived' });
    });
    await wait(1500);
    activeDirector = null;
    return losers;
  }

  /** Skip: stop everything in flight; `leave()` tidies up in the dark of the next room change */
  abort() {
    this.aborted = true;
    this.offerOpen = false;
    this.hideBank();
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
      p.slot.style.zIndex = '';
      p.moneyEl.classList.remove('visible');
      p.cancelFlight();
      p.clearResult(1.0);
    });
  }

  /** While volunteers are wanted, everyone who could join shows their money under their head */
  showBanks(candidates) {
    this.banks = new Map();
    candidates.forEach((p) => {
      const r = p.slot.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'kr-bank';
      el.textContent = `${p.money < 0 ? '-' : ''}$${Math.abs(Math.round(p.money))}`;
      el.style.left = `${r.left + r.width / 2}px`;
      el.style.top = `${r.bottom}px`;
      document.body.appendChild(el);
      this.banks.set(p, el);
    });
  }

  /** Hide one player's money (they volunteered), or everyone's */
  hideBank(player = null) {
    if (!this.banks) return;
    const els = player ? [this.banks.get(player)] : [...this.banks.values()];
    els.forEach((el) => {
      if (!el) return;
      el.classList.add('gone');
      setTimeout(() => el.remove(), 400);
    });
    if (player) this.banks.delete(player);
    else this.banks.clear();
  }

  /** Nobody else can join: two volunteers, or everyone who could has */
  offerFull(candidates) {
    return this.claimed.length >= Math.min(MAX_VOLUNTEERS, candidates.length);
  }

  /**
   * A player pressed Volunteer. Their place (and reward) is claimed straight away, but they're
   * brought in one at a time: each joins the line as the host welcomes them, and the next waits
   * until he's finished.
   */
  volunteer(player) {
    if (!this.offerOpen || this.claimed.length >= MAX_VOLUNTEERS) return;
    if (this.claimed.includes(player) || !player.isAlive()) return;
    const reward = this.rewardFor(this.claimed.length);
    this.claimed.push(player);
    this.admitting = this.admitting.then(() => this.admit(player, reward));
    // Everyone still deciding sees the reward drop, or loses the button once the room is full
    const m = this.manager;
    const full = this.claimed.length >= MAX_VOLUNTEERS;
    m.players.forEach((c) => {
      if (c.roomId && c !== this.taken && c.isAlive() && !this.claimed.includes(c)) {
        m.net.sendTo(c.roomId, full ? { type: 'wait' } : { type: 'sacrifice', reward: this.rewardFor(this.claimed.length) });
      }
    });
  }

  /** Bring a volunteer into the line and have the host welcome them by colour */
  async admit(player, reward) {
    if (this.aborted) return;
    const m = this.manager;
    this.hideBank(player);
    player.slot.style.opacity = '1';
    player.slot.style.zIndex = '30';
    this.volunteers.push({ player, reward });
    player.setMoneyText(reward);
    player.setMoneyBar(0);
    player.moneyEl.classList.remove('down');
    player.moneyEl.classList.add('visible');
    // Only the new volunteer flies in; anyone already in the row slides over
    m.placeForKilling(this.offerLayout(), 850, new Set([this.taken, ...this.volunteers.slice(0, -1).map((v) => v.player)]));
    if (m.sound) m.sound.playLight();
    // First or second volunteer, one of two lines each
    const colour = TAKEN_COLOUR_NAMES[player.colorIndex];
    if (colour && m.sound) {
      const slot = this.volunteers.length === 1 ? 'first' : 'second';
      await m.sound.playVoiceline(`assets/sound/voice/volunteered/${slot}-${1 + Math.floor(Math.random() * 2)}-${colour}.mp3`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  onMessage(player, data) {
    if (data.type === 'volunteer') this.volunteer(player);
    else if (this.room && this.room.onMessage) this.room.onMessage(player, data);
  }
}

/**
 * Baggage Claim: after 3, 2, 1, 6 to 8 items glide across the screen, left to right. Then everyone
 * picks, from 14 on their phone, the ones they saw. The real items come back one by one from the right,
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
  static OPTIONS = 14; // on the phone: the 6-8 shown plus the rest that weren't
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
    this.shown = options.slice(0, 6 + Math.floor(Math.random() * 3)); // 6 to 8
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

    // The host's lines for this room: one of `takes` at random; resolves when he's finished
    const say = (line, takes = 2) => (m.sound
      ? m.sound.playVoiceline(`assets/sound/voice/baggage-${line}-${1 + Math.floor(Math.random() * takes)}.mp3`)
      : Promise.resolve());

    // 1. "Watch the luggage...", 3, 2, 1, then the items glide across one after another, left to right
    await say('watch');
    await wait(400);
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
        if (m.sound) m.sound.playSwish(0.5);
      }, i * BaggageClaim.SPACING_MS);
    });
    await wait((this.shown.length - 1) * BaggageClaim.SPACING_MS + BaggageClaim.RIDE_MS + 300);
    this.lane.innerHTML = '';

    // 2. What did you see? Everyone picks on their phone
    const prompt = this.scene.querySelector('.kr-bc-prompt');
    prompt.classList.remove('hidden');
    scrambleQuick(prompt, 'What objects did you see?');
    if (m.sound) m.sound.playSlam(0.7);
    await say('which'); // "What objects did you see?", then the phones and the clock
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

    // "Let's see..." / "Let's have a look...", then the real items come back
    await say('lookback', 4);

    // 3. The real items come back the way they'll leave, mirrored: rightmost first, each sliding
    //    in and slowing to a stop, the next setting off sooner each time
    const n = this.shown.length;
    const gap = Math.min(BaggageClaim.PARK_GAP_VW, 88 / n);
    this.lane.style.setProperty('--w', `${Math.min(11, gap * 0.9).toFixed(2)}vw`);
    let joked = false;
    for (let k = 0, i = n - 1; i >= 0; k++, i--) {
      const el = this.item(this.shown[i], 'riding');
      el.style.transitionDuration = `${BaggageClaim.SLIDE_MS}ms`;
      el.style.setProperty('--stop', `${50 + (i - (n - 1) / 2) * gap}vw`);
      this.lane.appendChild(el);
      void el.offsetWidth;
      el.classList.add('parked');
      if (m.sound) m.sound.playSwish(0.5);
      // The host names each one as it arrives ("A teddy bear."). Now and then (once at most) he
      // says something about it instead ("A teddy bear. Its eyes follow you..."). The next waits.
      const detail = !joked && Math.random() < 0.25;
      if (detail) joked = true;
      const line = `assets/sound/voice/${detail ? 'items' : 'item-names'}/${this.shown[i].id}.mp3`;
      // The last one gets an "And..." first ("...a globe. And... a teddy bear.")
      const say = async () => {
        if (!m.sound) return;
        if (i === 0 && n > 1) await m.sound.playVoiceline('assets/sound/voice/item-names/and.mp3');
        await m.sound.playVoiceline(line);
      };
      await Promise.all([say(), wait(BaggageClaim.slideGap(k))]);
    }
    await wait(BaggageClaim.SLIDE_MS + 600);

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
      await say('worst', 9); // "And the worst memory belongs to...", "I remembered more than that..."
      nums.forEach((el, i) => el.classList.toggle('lowest', scores[i] === worst));
      if (m.sound) m.sound.playSlam(0.8);
      if (lowest.length > 2) { // three or more tied: nobody dies
        await wait(900);
        await say('tie');
      }
    }
    await wait(1800);
    // 6. The items are pulled off the right edge before anyone dies
    //    one at a time from the right, each pulled away faster and faster, starts overlapping
    const parked = [...this.lane.querySelectorAll('.kr-bc-item')]; // in DOM order: rightmost first
    for (const [i, el] of parked.entries()) {
      el.style.transitionDuration = `${BaggageClaim.SLIDE_MS}ms`;
      el.classList.add('gone');
      if (m.sound) m.sound.playSwish(0.5);
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
