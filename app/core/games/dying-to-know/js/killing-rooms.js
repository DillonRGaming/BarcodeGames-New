/**
 * Killing-rooms.js - The killing room, played after every question
 *
 * The last living player to answer is taken: they fly to the middle, bigger, and a 10s flip clock
 * starts. Anyone else alive can volunteer from their phone; volunteers join the line beside them,
 * smaller, with their reward above their heads (first volunteer paid most, only if they survive).
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
const SACRIFICE_SECONDS = 10;
const SACRIFICE_REWARDS = [300, 200, 150, 100, 50]; // then £50 for everyone after
const TAKEN_SCALE = 1.3;
const VOLUNTEER_SCALE = 0.8;
const MAX_VOLUNTEERS = 2; // the room holds the taken player plus two

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

    // 2. Ten seconds for anyone else to volunteer
    this.offerOpen = true;
    candidates.forEach((p) => {
      if (p.roomId) m.net.sendTo(p.roomId, { type: 'sacrifice', reward: this.rewardFor(0) });
      else if (Math.random() < 0.3) setTimeout(() => this.volunteer(p), 1200 + Math.random() * 7500);
    });
    this.clock.set(SACRIFICE_SECONDS, false);
    this.clockEl.classList.remove('hidden', 'urgent');
    if (m.sound) m.sound.playTick(0.85);
    for (let s = SACRIFICE_SECONDS - 1; s >= 0 && !this.offerFull(candidates); s--) {
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
    await wait(700);
    this.clockEl.classList.add('hidden');

    // 3. Room change into the killing room, same beats as runRoomTransitionLoop
    const players = [taken, ...this.volunteers.map((v) => v.player)];
    this.players = players;
    m.players.forEach((p) => { if (p.isAlive()) p.blendWiggle(0, 1.0); });
    setTimeout(() => { if (m.sound) m.sound.playBuild(); }, 300);
    await wait(2400);

    // Slam to black: everyone else is gone, only the participants' eyes show
    if (m.sound) m.sound.playSlam(1.0);
    m.players.forEach((p) => p.slot.classList.toggle('kr-away', !players.includes(p)));
    this.volunteers.forEach(({ player }) => player.moneyEl.classList.remove('visible'));
    m.players.forEach((p) => {
      p.fadeResultBadge();
      p.clearResult(p.currentScale);
    });
    if (m.room) m.room.setBlackout(1);
    this.scene.classList.remove('hidden');
    const Room = KILLING_ROOMS[Math.floor(Math.random() * KILLING_ROOMS.length)];
    this.room = new Room(m, this.scene);
    this.room.build(players);
    players.forEach((p) => p.setEyesMode(true));
    if (m.grid) m.grid.classList.add('eyes-only');
    await wait(3200);

    // Lights up in the killing room, with everyone still where they were standing
    if (m.room) m.room.setBlackout(0);
    if (m.grid) m.grid.classList.remove('eyes-only');
    players.forEach((p) => p.setEyesMode(false));
    if (m.sound) {
      m.sound.playLight();
      m.sound.playSlam(1.0);
      setTimeout(() => { if (m.sound) m.sound.playEchoBell(); }, 500);
    }
    await wait(1200);
    players.forEach((p) => p.blendWiggle(1.0, 0.45));
    await wait(2000);

    // 4. They take their places, then the room plays out
    await this.room.takePlaces(players);
    const losers = await this.room.run(players);
    this.room = null;

    // 5. Surviving volunteers get paid
    this.volunteers.forEach(({ player, reward }) => {
      if (!losers.includes(player)) player.money += reward;
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

  /** Called in the dark of the next room change: back to the hotel, everyone in the grid */
  leave() {
    const m = this.manager;
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
 * Room Service: three of the four covered dishes hide a bomb. The lids lift to show which one is
 * empty, the trolley shuffles, then everyone in the room picks a plate. Only the empty one is safe.
 */
class RoomService {
  static PLATES = 4;
  static PICK_SECONDS = 10;
  static SWAPS = 8;

  constructor(manager, scene) {
    this.manager = manager;
    this.scene = scene;
    this.picks = new Map(); // player → slot index
  }

  /** Lay out the room in the dark, before the lights come up */
  build(players) {
    const m = this.manager;
    const n = RoomService.PLATES;
    this.players = players;
    this.scene.style.backgroundImage = `url('${ROOM_ART}/room-service/background.png')`;
    this.scene.innerHTML = `
      <div class="kr-rs offstage">
        <div class="kr-rs-guesses">${Array.from({ length: n }, () => '<span></span>').join('')}</div>
        <div class="kr-rs-plates"></div>
        <img class="kr-rs-trolley" src="${ROOM_ART}/room-service/trolley.svg" alt="">
        <img class="kr-rs-wheel kr-rs-wheel-back" src="${ROOM_ART}/room-service/wheel.svg" alt="">
        <img class="kr-rs-wheel kr-rs-wheel-front" src="${ROOM_ART}/room-service/wheel.svg" alt="">
        <div class="kr-rs-numbers">${Array.from({ length: n }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>
      </div>`;

    const platesEl = this.scene.querySelector('.kr-rs-plates');
    this.safeDish = Math.floor(Math.random() * n);
    this.dishes = Array.from({ length: n }, (_, d) => {
      const dish = document.createElement('div');
      dish.className = 'kr-rs-dish';
      dish.innerHTML = `
        <img class="kr-rs-plate" src="${ROOM_ART}/room-service/plate.svg" alt="">
        ${d !== this.safeDish ? `<img class="kr-rs-bomb" src="${ROOM_ART}/room-service/bomb.svg" alt="">` : ''}
        <img class="kr-rs-cloche" src="${ROOM_ART}/room-service/cloche.svg" alt="">`;
      platesEl.appendChild(dish);
      return dish;
    });
    this.slotOf = this.dishes.map((_, d) => d);
    this.place(0);
  }

  /** Players walk up to a row behind the trolley, one after another like flyTo */
  async takePlaces(players) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const gap = 125 * 0.8 + Math.min(Math.max(24, w * 0.036), 64);
    const targets = new Map(players.map((p, i) => [p, { x: w / 2 + (i - (players.length - 1) / 2) * gap, y: h * 0.3, k: 0.8 }]));
    await this.manager.placeForKilling(targets, 850, new Set(), 90);
    await wait(1500);
  }

  place(ms) {
    const n = RoomService.PLATES;
    this.dishes.forEach((dish, d) => {
      dish.style.transitionDuration = `${ms}ms`;
      dish.style.left = `${((this.slotOf[d] + 0.5) / n) * 100}%`;
    });
  }

  async run(players) {
    const m = this.manager;
    const n = RoomService.PLATES;
    const clockEl = document.getElementById('killTimer');
    const clock = killClock();

    // 1. The trolley rolls in from the left, then every cloche lifts: one plate is empty
    const trolley = this.scene.querySelector('.kr-rs');
    const wheel = trolley.querySelector('.kr-rs-wheel').getBoundingClientRect().width;
    trolley.style.setProperty('--spin', `${((window.innerWidth / (Math.PI * wheel)) * 360).toFixed(0)}deg`);
    void trolley.offsetWidth;
    trolley.classList.remove('offstage');
    if (m.sound) m.sound.playWhoosh();
    await wait(2000);
    this.dishes.forEach((dish) => dish.classList.add('lifted'));
    if (m.sound) m.sound.playSwish(0.9);
    await wait(2400);
    this.dishes.forEach((dish) => dish.classList.remove('lifted'));
    if (m.sound) m.sound.playSwish(0.7);
    await wait(900);

    // 2. Shuffle: swap two dishes at a time, faster each pass
    for (let s = 0; s < RoomService.SWAPS; s++) {
      const ms = Math.max(260, 750 - s * 70);
      const a = Math.floor(Math.random() * n);
      let b = Math.floor(Math.random() * (n - 1));
      if (b >= a) b++;
      const da = this.slotOf.indexOf(a);
      const db = this.slotOf.indexOf(b);
      this.slotOf[da] = b;
      this.slotOf[db] = a;
      this.place(ms);
      if (m.sound) m.sound.playWhoosh();
      await wait(ms + 60);
    }
    await wait(500);

    // 3. Everyone in the room picks a plate on their phone
    this.picks = new Map();
    this.picking = true;
    players.forEach((p) => {
      if (p.roomId) m.net.sendTo(p.roomId, { type: 'plates', count: n });
      else setTimeout(() => this.pick(p, Math.floor(Math.random() * n)), 1500 + Math.random() * 6000);
    });
    m.phoneState = { type: 'wait' }; // a reconnecting phone shouldn't get a second pick
    clock.set(RoomService.PICK_SECONDS, false);
    clockEl.classList.remove('hidden', 'urgent');
    if (m.sound) m.sound.playTick(0.85);
    for (let s = RoomService.PICK_SECONDS - 1; s >= 0 && this.picks.size < players.length; s--) {
      await wait(1000);
      clock.set(s);
      clockEl.classList.toggle('urgent', s <= 3);
      if (s > 0 && m.sound) m.sound.playTick(0.85);
    }
    this.picking = false;
    players.forEach((p) => { if (p.roomId) m.net.sendTo(p.roomId, { type: 'wait' }); });
    await wait(700);
    clockEl.classList.add('hidden');

    // 4. Lift the plates left to right: each bomb goes off and takes whoever picked it
    const losers = [];
    const bySlot = this.dishes.map((_, d) => d).sort((a, b) => this.slotOf[a] - this.slotOf[b]);
    for (const d of bySlot) {
      const slot = this.slotOf[d];
      this.dishes[d].classList.add('lifted');
      if (m.sound) m.sound.playSwish(0.8);
      await wait(700);
      if (d === this.safeDish) {
        await wait(700);
        continue;
      }
      this.dishes[d].classList.add('boom');
      this.scene.classList.add('flash');
      if (m.sound) m.sound.playSlam(1.0);
      await wait(400);
      this.scene.classList.remove('flash');
      for (const p of players.filter((x) => this.picks.get(x) === slot)) {
        losers.push(p);
        p.startDeathSpin();
        await wait(450);
      }
      await wait(600);
    }

    // 5. Anyone who never picked doesn't get out either
    for (const p of players.filter((x) => !this.picks.has(x))) {
      losers.push(p);
      p.startDeathSpin();
      await wait(450);
    }
    await wait(losers.length ? 2600 : 1200);
    return losers;
  }

  /** A player in the room chose a plate (0-based slot); first choice counts */
  pick(player, slot) {
    if (!this.picking || this.picks.has(player) || !this.players.includes(player)) return;
    if (!(slot >= 0 && slot < RoomService.PLATES)) return;
    this.picks.set(player, slot);
    const tag = document.createElement('span');
    tag.className = 'kr-tag';
    tag.textContent = player.letter;
    tag.style.setProperty('--tag-color', player.nameColor);
    const col = this.scene.querySelectorAll('.kr-rs-guesses span')[slot];
    if (col) col.appendChild(tag);
    if (this.manager.sound) this.manager.sound.playLight();
  }

  onMessage(player, data) {
    if (data.type === 'plate') this.pick(player, Number(data.index));
  }
}

const KILLING_ROOMS = [RoomService];
