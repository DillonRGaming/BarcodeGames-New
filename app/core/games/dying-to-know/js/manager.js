/**
 * Manager.js - Core Scene Manager, Events, and Transitions
 */

const MAX_PLAYERS = 8;
const DEV_RANDOM_MONEY = true; // testing: everyone starts with £0–£2000 instead of £100
const DEV_BOTS = 4; // simulated players for testing; 0 to turn off

class GameManager {
  constructor({ room, camera, sound, gridEl, players = [] }) {
    this.room = room;
    this.camera = camera;
    this.sound = sound;
    this.grid = gridEl;
    this.players = players;

    // Game Loop States: 'LOBBY', 'STARTING', 'IN_GAME'
    this.gameState = 'LOBBY';
    this.roomCode = null;

    // Lobby UI Elements
    this.lobbyUI = document.getElementById('lobbyUI');
    this.slotCardsEl = document.getElementById('slotCards');
    this._shuffleLobbySpots();
    if (this.slotCardsEl) [0, 3, 6].forEach((i) => this.slotCardsEl.children[i]?.classList.add('folded'));
    this.roomCodeEl = document.getElementById('lobbyRoomCode');
    this.startPromptEl = document.getElementById('lobbyStartPrompt');
    this.cancelPromptEl = document.getElementById('lobbyCancelPrompt');
    this.countdownEl = document.getElementById('startCountdown');

    // Blink Director
    this.blinkTimeout = null;
    this.isTransitioning = false;

    // Intro & Skip State
    this.skipIntroBtn = document.getElementById('skipIntroBtn');
    this.isIntroRunning = false;
    this.isIntroSkipped = false;

    // Question & Countdown Stage Elements
    this.questionStage = document.getElementById('questionStage');
    this.questionTextEl = document.getElementById('questionText');
    this.answersListEl = document.getElementById('answersList');
    this.flipClock = new FlipClock(document.getElementById('flipClock'), 2);
    this.gameRoomCodeEl = document.getElementById('gameRoomCode');
    this.questionTimer = null;
    this.questionSeconds = 15;
    this.isQuestionActive = false;
    this.roomRoundCount = 0;

    this.questionBank = QUESTIONS;
    this.currentQuestionIdx = 0;
    this.roundToken = 0;
    this.dev = { room: '', fast: false, skipOffer: false, fillRoom: false };
    this.skipRoundBtn = document.getElementById('skipRoundBtn');
    if (this.skipRoundBtn) this.skipRoundBtn.addEventListener('click', () => this.skipRound());

    this._initInput();
    this.modMenu = new ModMenu(this);
    this._initLobbyUI();
    this._initRoom();
    this._startBlinkDirector();
  }

  /* =========================================
     Room Server Connection (players join at barcodegames.fun)
     ========================================= */

  _initRoom() {
    const joinUrlEl = document.getElementById('lobbyJoinUrl');
    if (joinUrlEl && window.barcode && window.barcode.joinUrl) {
      joinUrlEl.textContent = window.barcode.joinUrl.toUpperCase();
    }

    this.net = new RoomHost({ game: 'dying-to-know', maxPlayers: MAX_PLAYERS });
    this.playersById = new Map(); // room player id → Player
    this.net.on('code', (code) => {
      this.setRoomCode(code);
      this.phoneState = { type: 'lobby' };
    });
    this.net.on('message', (roomId, data) => {
      // The VIP starts the game from their phone
      // A player locks in an answer (first tap counts, only while the clock runs)
      if (data.type === 'answer' && this.acceptingAnswers && !this.answers.has(roomId)) {
        const index = Number(data.index);
        if (index >= 0 && index < 4) {
          this.answers.set(roomId, index + 1); // 1-based like correctIndex
          this.answerTimes.set(roomId, performance.now());
          this.checkAllAnswered();
          const player = this.playersById.get(roomId);
          if (player) player.blendWiggle(0, 0.35); // locked in: face straight ahead
        }
        return;
      }
      if (this.killingRoom) {
        const player = this.playersById.get(roomId);
        if (player) this.killingRoom.onMessage(player, data);
      }
      if (data.type === 'skip') {
        const player = this.playersById.get(roomId);
        if (player && player.isVip && this.gameState === 'INTRO') this.skipIntro();
        return;
      }
      if (data.type === 'start') {
        const player = this.playersById.get(roomId);
        if (player && player.isVip && this.gameState === 'LOBBY') this.startLobbyGame();
      }
      if (data.type === 'cancel') {
        const player = this.playersById.get(roomId);
        if (player && player.isVip) this.cancelStartCountdown();
      }
    });
    this.net.on('join', (info) => this.addPlayer(info));
    this.net.on('leave', (roomId) => {
      // Leaving in the lobby removes you; once the game has started you can reconnect
      if (this.gameState !== 'LOBBY') return;
      this.removePlayer(roomId);
      this.net.kick(roomId);
    });
    this.net.on('reconnect', (info) => {
      const player = this.playersById.get(info.id);
      if (!player) return;
      this.sendProfile(info.id, player);
      if (this.phoneState) this.net.sendTo(info.id, this.phoneState); // put them back on the current screen
    });
    // Quitting the app ends the room so phones are kicked straight away
    window.addEventListener('beforeunload', () => this.net.close());
    this.net.on('status', (status) => {
      if (this.roomCodeEl) this.roomCodeEl.classList.toggle('offline', status !== 'open');
    });
    this.net.connect();
  }

  /**
   * Add a player to the lobby. The first player is VIP; each takes the first free colour.
   * `info` is { id, name } from the room server, or a dev bot with no id.
   */
  addPlayer(info) {
    if (!this.createPlayer) {
      // Textures still loading: add them once main.js is ready
      (this.pendingJoins = this.pendingJoins || []).push(info);
      return null;
    }
    if (this.players.length >= MAX_PLAYERS) return null;

    const usedColors = new Set(this.players.map((p) => p.colorIndex));
    let colorIndex = 0;
    while (usedColors.has(colorIndex)) colorIndex++;

    const player = this.createPlayer({
      name: info.name,
      colorIndex,
      isVip: !!info.id && !this.players.some((p) => p.isVip), // only a real phone player can be VIP; bots never are
    });
    player.colorIndex = colorIndex;
    if (DEV_RANDOM_MONEY) player.money = Math.round(Math.random() * 40) * 50; // £0–£2000
    if (info.id) {
      player.roomId = info.id;
      this.playersById.set(info.id, player);
      this.sendProfile(info.id, player);
    }
    if (this.sound) this.sound.playLight();
    this.updateSlotCards();

    // Their shape glows in, the dead letter fades in under it, the glow fades, then they spin back to life
    player.joinDead();
    player.spawnGlow();
    player.scrambleName(1500); // as the letter fades in
    setTimeout(() => {
      if (!this.players.includes(player)) return;
      player.startReviveSpin();
      if (this.sound) this.sound.playWhoosh();
    }, 3600);
    return player;
  }

  /**
   * Deal the 8 lobby spots out in a random order each game: card N and the Nth player to join
   * share a spot, so the numbers land anywhere. These rules override the fixed ones in style.css.
   */
  _shuffleLobbySpots() {
    const spots = [[13.5, 19], [20, 46], [6.5, 60], [41.5, 62], [56, 27], [70.5, 37], [77.5, 14], [82.5, 62]];
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const style = document.createElement('style');
    style.textContent = spots.map(([x, y], i) =>
      `.grid.lobby .letter-slot:nth-child(${i + 1}), .slot-card:nth-child(${i + 1}) { left: ${x}vw; top: ${y}vh; }`
    ).join('\n');
    document.head.appendChild(style);
  }

  /** Hide the numbered card under every lobby spot that has a player */
  updateSlotCards() {
    if (!this.slotCardsEl) return;
    [...this.slotCardsEl.children].forEach((card, i) => card.classList.toggle('taken', i < this.players.length));
  }

  /** Send every phone the same screen, remembered so reconnecting phones get it too */
  setPhoneState(data) {
    this.phoneState = data;
    this.net.broadcast(data);
  }

  /** Remove a player from the lobby; VIP passes to whoever joined next */
  removePlayer(roomId) {
    const player = this.playersById.get(roomId);
    if (!player) return;
    this.playersById.delete(roomId);
    const idx = this.players.indexOf(player);
    if (idx !== -1) this.players.splice(idx, 1);
    player.slot.remove();
    this.updateSlotCards();

    const next = player.isVip && this.players.find((p) => p.roomId);
    if (next) {
      next.setVip(true);
      if (next.roomId) this.sendProfile(next.roomId, next);
    }
    if (this.sound) this.sound.playWhoosh();
  }

  /** Tell a phone what it looks like in the game (colour for its name bar) */
  sendProfile(roomId, player) {
    this.net.sendTo(roomId, {
      type: 'profile',
      color: player.nameColor,
      letter: player.letter,
      vip: player.isVip,
    });
  }

  setPlayers(players) {
    this.players = players;
    (this.pendingJoins || []).forEach((info) => this.addPlayer(info));
    this.pendingJoins = [];

    // Dev: simulate bots joining one by one (they answer randomly)
    const bots = ['SPOOKY', 'GHOUL', 'BONES', 'MOTH', 'CREEP', 'WISP'];
    bots.slice(0, DEV_BOTS).forEach((name, i) => {
      setTimeout(() => {
        if (this.gameState === 'LOBBY') this.addPlayer({ name });
      }, 800 + i * 700);
    });
  }

  playRoomMusic(roomIndex = 0, fadeDuration = 2200) {
    // Room 1 (index 0) = question.mp3, Room 2 (index 1) = lobby.mp3
    const roomTracks = ['question', 'lobby'];
    const trackName = roomTracks[roomIndex % roomTracks.length];
    if (this.sound) {
      this.sound.playTrack(trackName, fadeDuration);
    }
  }

  /* =========================================
     Lobby State & Player Roster Management
     ========================================= */

  _initLobbyUI() {
    if (this.startPromptEl) {
      this.startPromptEl.addEventListener('click', () => {
        this.startLobbyGame();
      });
    }
    if (this.cancelPromptEl) {
      this.cancelPromptEl.addEventListener('click', () => this.cancelStartCountdown());
    }

    if (this.skipIntroBtn) {
      this.skipIntroBtn.addEventListener('click', () => {
        this.skipIntro();
      });
    }

    if (this.roomCodeEl) {
      this.roomCodeEl.addEventListener('click', () => {
        if (!this.roomCode) return;
        navigator.clipboard.writeText(this.roomCode).catch(() => { });
        this.roomCodeEl.classList.add('copied');
        setTimeout(() => this.roomCodeEl.classList.remove('copied'), 150);
        if (this.sound) this.sound.playLight();
      });
    }

    const backBtn = document.getElementById('lobbyBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (this.sound) this.sound.playWhoosh();
      });
    }
  }

  setRoomCode(code) {
    this.roomCode = code;
    if (this.roomCodeEl) {
      scrambleText(this.roomCodeEl, code, 300); // XXXX, then decodes like a player's name
    }
    if (this.gameRoomCodeEl) {
      this.gameRoomCodeEl.textContent = code;
    }
  }

  setPlayerVisible(index, visible) {
    if (this.players[index]) {
      this.players[index].setVisible(visible);
    }
  }

  togglePlayerVisible(index) {
    if (this.players[index]) {
      const nextVis = !this.players[index].isVisible;
      this.players[index].setVisible(nextVis);
      if (this.sound) {
        if (nextVis) this.sound.playLight();
        else this.sound.playWhoosh();
      }
    }
  }

  setPlayerCount(count) {
    this.players.forEach((p, idx) => {
      p.setVisible(idx < count);
    });
  }

  getActivePlayers() {
    return this.players.filter((p) => p.isVisible);
  }

  /** "Everybody's in": 3, 2, 1 (each a little over a second, with a slam), then the intro. Cancellable. */
  startLobbyGame() {
    if (this.gameState !== 'LOBBY' || this.countdownTimer) return;
    const STEP_MS = 1150; // slightly slower than a real second
    let n = 3;
    this.startPromptEl?.classList.add('hidden');
    this.cancelPromptEl?.classList.remove('hidden');
    this.setPhoneState({ type: 'countdown' }); // VIP's phone swaps Everybody's In for Cancel

    const show = () => {
      if (n === 0) {
        // Past the point of cancelling: 1s, everyone turns to face straight ahead, then the lights go
        this.countdownTimer = null;
        this.gameState = 'STARTING';
        this.cancelPromptEl?.classList.add('hidden');
        this.setPhoneState({ type: 'wait' });
        // Same as a room change: everyone freezes straight, the build plays, then the cut to black
        setTimeout(() => {
          this.players.forEach((p) => p.blendWiggle(0, 1.0));
          setTimeout(() => { if (this.sound) this.sound.playBuild(); }, 300);
          setTimeout(() => {
            // Cut to black with only their eyes showing (like a room change), then the intro fades in 2s later
            if (this.room) this.room.setBlackout(1);
            this.players.forEach((p) => p.setEyesMode(true));
            if (this.grid) this.grid.classList.add('eyes-only');
            if (this.sound) {
              this.sound.playSlam(1.0);
              this.sound.stopAtmosphere(true);
            }
            this.endStartCountdown();
            this.startPromptEl?.classList.add('hidden');
            if (this.lobbyUI) this.lobbyUI.classList.add('hidden');
            if (this.slotCardsEl) this.slotCardsEl.classList.add('hidden');
            setTimeout(() => this.startIntroSequence(), 2000);
          }, 2400);
        }, 1000);
        return;
      }
      if (this.countdownEl) {
        this.countdownEl.textContent = String(n);
        this.countdownEl.classList.remove('slam');
        void this.countdownEl.offsetWidth; // restart the animation
        this.countdownEl.classList.add('slam');
      }
      if (this.sound) this.sound.playSlam(0.9);
      n--;
      this.countdownTimer = setTimeout(show, STEP_MS);
    };
    show();
  }

  cancelStartCountdown() {
    if (!this.countdownTimer) return;
    clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    this.endStartCountdown();
    this.setPhoneState({ type: 'lobby' });
  }

  endStartCountdown() {
    if (this.countdownEl) {
      this.countdownEl.classList.remove('slam');
      this.countdownEl.textContent = '';
    }
    this.startPromptEl?.classList.remove('hidden');
    this.cancelPromptEl?.classList.add('hidden');
  }

  async skipIntro() {
    this.isIntroSkipped = true;
    this.isIntroRunning = false;
    this.gameState = 'PLAYING';
    if (this.skipRoundBtn) this.skipRoundBtn.classList.remove('hidden');
    this.setPhoneState({ type: 'wait' });

    if (this.skipIntroBtn) this.skipIntroBtn.classList.add('hidden');

    // Anything the intro already set in motion would otherwise keep going after the skip
    clearTimeout(this.introAtmosphereTimeout);
    if (this.sound) {
      this.sound.stopIntroSounds();
    }
    const introLogo = document.getElementById('introLogo');
    if (introLogo) introLogo.classList.remove('reveal');

    const introOverlay = document.getElementById('introOverlay');
    if (introOverlay) {
      introOverlay.classList.remove('active', 'transparent-bg');
    }
    const curtains = document.getElementById('curtainsContainer');
    if (curtains) {
      curtains.classList.add('hidden');
      curtains.classList.remove('fade-in', 'opening');
    }
    if (this.lobbyUI) this.lobbyUI.classList.add('hidden');
    if (this.slotCardsEl) this.slotCardsEl.classList.add('hidden');
    const atmosphere = document.getElementById('lobbyAtmosphere');
    if (atmosphere) atmosphere.classList.add('hidden');

    this.roomRoundCount = 0;
    this.playRoomMusic(this.roomRoundCount, 1000);

    if (this.room) {
      this.room.switchBg(3);
      this.room.bgScrolling = false;
    }
    if (this.camera) {
      this.camera.setGridMode('grid');
    }
    if (this.grid) {
      this.grid.classList.remove('hide-names');
    }
    if (this.room) this.room.setBlackout(0);
    if (this.grid) this.grid.classList.remove('eyes-only');
    this.players.forEach((p) => {
      p.resetPose();
      p.setEyesMode(false);
      p.blendWiggle(1.0, 0.2);
    });

    // Same route into the first question as the full intro: scoreboard, lineup, room moves
    await new Promise((r) => setTimeout(r, 800));
    await this.showScoreboard();
    this.flyTo('lineup');
    await new Promise((r) => setTimeout(r, 1000));
    if (this.room) this.room.bgScrolling = true;
    await new Promise((r) => setTimeout(r, 650));
    this.showQuestion();
  }

  /**
   * Scoreboard: room still, everyone flies to one low row (richest on the left),
   * money pops in above them and counts to the new totals.
   */
  async showScoreboard() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (!this.players.length) return;
    if (this.room) this.room.bgScrolling = false;

    const ranked = [...this.players].sort((a, b) => b.money - a.money); // sort is stable: ties keep join order
    ranked.forEach((p, i) => p.slot.style.setProperty('--rank', i));

    const flight = await this.flyTo('scoreboard');
    await wait(flight + 250);
    if (this.sound) this.sound.playLight();
    await wait(450);

    // Each bar rises from £0 at the same £/second, so the richest take longest.
    // The scale is set so the richest bar always fits between the row and the top of the screen.
    const SCALE = 0.9; // scoreboard player scale (see flyTo)
    const POUNDS_PER_SEC = 300;
    const top = Math.max(100, ...ranked.map((p) => p.money));
    const slotTop = ranked[0].slot.getBoundingClientRect().top + 62.5 * (1 - SCALE);
    const roomPx = (slotTop - 54 * SCALE - 50 - 30) / SCALE; // minus label and a margin from the screen top
    // A full-height bar is ~£1500; only squash the scale when someone has more than that
    const pxPerPound = Math.max(0, roomPx) / Math.max(1500, top);
    ranked.forEach((p) => p.moneyBarEl.style.setProperty('--groove', `${(100 * pxPerPound).toFixed(2)}px`));

    ranked.forEach((p) => {
      p.setMoneyText(0);
      p.setMoneyBarLength(Math.max(0, p.money) * pxPerPound);
      p.setMoneyBar(0);
      p.moneyEl.classList.toggle('down', p.money < 0);
      p.moneyEl.classList.add('visible');
    });
    if (this.sound) this.sound.playSwish(0.6);
    await wait(600);

    const finished = new Set();
    const start = performance.now();
    let notchesChimed = 0;
    await new Promise((resolve) => {
      const step = (now) => {
        const pounds = ((now - start) / 1000) * POUNDS_PER_SEC;
        ranked.forEach((p) => {
          const target = Math.max(0, p.money);
          const v = Math.min(pounds, target);
          p.setMoneyText(p.money < 0 && v >= target ? p.money : v);
          p.setMoneyBar(v * pxPerPound);
          if (v >= target && !finished.has(p)) {
            finished.add(p);
            if (this.sound && now - start > 50) this.sound.playSwish(0.45);
          }
        });
        // One chime per £100 notch crossed (all bars rise together), climbing in pitch
        const notch = Math.floor(Math.min(pounds, top) / 100);
        while (notchesChimed < notch) {
          notchesChimed++;
          if (this.sound) this.sound.playChime(0.7 + notchesChimed * 0.04);
        }
        if (finished.size < ranked.length) {
          requestAnimationFrame(step);
        } else resolve();
      };
      requestAnimationFrame(step);
    });
    if (this.sound) this.sound.playEchoBell();

    await wait(2200);
    this.players.forEach((p) => p.moneyEl.classList.remove('visible'));
    await wait(400);
    this.players.forEach((p) => p.setMoneyBar(0));
  }

  async startIntroSequence() {
    if (this.isIntroRunning) return;
    this.isIntroRunning = true;
    this.isIntroSkipped = false;
    this.gameState = 'INTRO';
    if (this.net) {
      this.net.lock(); // no new players once the game starts; drop-outs can still rejoin
      this.setPhoneState({ type: 'intro' }); // VIP's phone gets a Skip Intro button
    }

    if (this.skipIntroBtn) this.skipIntroBtn.classList.remove('hidden');

    // 1. Smoothly fade out music and keep loud lamp humming
    if (this.sound) {
      this.sound.fadeMusicOut(900);
      this.introAtmosphereTimeout = setTimeout(() => this.sound.stopAtmosphere(true), 950);
    }

    // 2. Hide Lobby UI & Fullscreen Atmosphere smoothly
    if (this.lobbyUI) this.lobbyUI.classList.add('hidden');
    if (this.slotCardsEl) this.slotCardsEl.classList.add('hidden');
    const atmosphere = document.getElementById('lobbyAtmosphere');
    if (atmosphere) atmosphere.classList.add('hidden');

    // 3. Screen fades to pitch black

    const introOverlay = document.getElementById('introOverlay');
    const introLogo = document.getElementById('introLogo');
    if (introOverlay) {
      introOverlay.classList.add('active');
    }
    if (introLogo) {
      introLogo.classList.remove('reveal');
    }

    // 4. Wait 2 seconds in pitch black silence (with lamp hum)
    await new Promise((r) => setTimeout(r, 2000));
    if (this.isIntroSkipped) return;

    // 5. Play Ringing sound (ends cleanly at 3.35s)
    if (this.sound) {
      await this.sound.playIntroRing(3.35);
    } else {
      await new Promise((r) => setTimeout(r, 3400));
    }
    if (this.isIntroSkipped) return;

    // 6. Play Phone Pickup sound
    if (this.sound) {
      await this.sound.playIntroPickup();
    } else {
      await new Promise((r) => setTimeout(r, 750));
    }
    if (this.isIntroSkipped) return;

    // 7. Play Gibberish Voice (shortened to 5.25s with build sync)
    if (this.sound) {
      await this.sound.playIntroGibberish(5.25);
    } else {
      await new Promise((r) => setTimeout(r, 5300));
    }
    if (this.isIntroSkipped) return;

    // 8. Directly trigger Scream as build and gibberish culminate
    if (this.sound) {
      this.sound.playIntroScream();
    }

    // 9. Wait 0.65s into the scream before revealing the logo
    await new Promise((r) => setTimeout(r, 650));
    if (this.isIntroSkipped) return;

    // 10. Reveal Logo with smooth growth & tilt back to 0
    if (introLogo) {
      introLogo.classList.add('reveal');
    }

    // 11. Wait 2.8 seconds with logo centered on screen (longer display)
    await new Promise((r) => setTimeout(r, 2800));
    if (this.isIntroSkipped) return;

    // 12. Switch the room in the background quietly to bg3 (with doors)
    if (this.room) {
      this.room.switchBg(3);
    }

    // Set players into the classic 2x4 grid layout behind the curtains
    if (this.camera) {
      this.camera.setGridMode('grid');
    }
    if (this.room) this.room.setBlackout(0);
    if (this.grid) this.grid.classList.remove('eyes-only');
    this.players.forEach((p) => {
      p.resetPose();
      p.setEyesMode(false);
      p.blendWiggle(1.0, 0.2); // they went straight before the lights went out
    });

    // 13. Fade in the curtains behind the logo over 1.8s
    const curtains = document.getElementById('curtainsContainer');
    if (curtains) {
      curtains.classList.remove('hidden');
      void curtains.offsetWidth; // Force layout reflow
      curtains.classList.add('fade-in');
    }

    // Wait 1.8s for curtains to reach full opacity behind the logo
    await new Promise((r) => setTimeout(r, 1800));
    if (this.isIntroSkipped) return;

    // Make intro overlay background transparent so curtains and room are visible behind logo
    if (introOverlay) {
      introOverlay.classList.add('transparent-bg');
    }

    // 14. Start Room 1 song (question.mp3) and play deep slowed swoosh as curtains begin opening BEHIND the fully showing logo
    this.roomRoundCount = 0;
    this.playRoomMusic(this.roomRoundCount, 2400);
    if (this.sound) {
      this.sound.playCurtainSwoosh(1.0);
    }

    if (curtains) {
      curtains.classList.add('opening');
    }

    // Wait 0.9s into opening motion, then fade out the logo smoothly
    await new Promise((r) => setTimeout(r, 900));
    if (this.isIntroSkipped) return;

    // 15. Fade out the logo as curtains continue stretching open
    if (introOverlay) {
      introOverlay.classList.remove('active');
    }

    // Wait for curtains animation to finish completely
    await new Promise((r) => setTimeout(r, 2600));
    if (this.isIntroSkipped) return;

    if (curtains) {
      curtains.classList.add('hidden');
      curtains.classList.remove('fade-in', 'opening');
    }
    if (introOverlay) {
      introOverlay.classList.remove('transparent-bg');
    }

    if (this.skipIntroBtn) this.skipIntroBtn.classList.add('hidden');
    this.gameState = 'PLAYING';
    if (this.skipRoundBtn) this.skipRoundBtn.classList.remove('hidden');
    this.setPhoneState({ type: 'wait' });

    // 16. Show players in the grid, then the starting scoreboard
    await new Promise((r) => setTimeout(r, 1500));
    if (this.isIntroSkipped) return;
    await this.showScoreboard();
    if (this.isIntroSkipped) return;

    // 17. Perform lineup movement to the top row
    this.flyTo('lineup');

    // 18. 1s later, begin moving the room
    await new Promise((r) => setTimeout(r, 1000));
    if (this.isIntroSkipped) return;
    if (this.room) {
      this.room.bgScrolling = true;
    }

    // 19. Fade in questions & answers with 15s countdown after background starts moving
    await new Promise((r) => setTimeout(r, 650));
    if (this.isIntroSkipped) return;
    this.showQuestion();
  }

  /* =========================================
     Question Stage & Countdown Director
     ========================================= */

  async showQuestion(questionData = null) {
    if (!this.questionStage) return;

    // Clear any pending answer reveal timeouts
    if (this.answerTimeouts) {
      this.answerTimeouts.forEach((t) => clearTimeout(t));
    }
    this.answerTimeouts = [];

    const currentQ = this.questionBank[this.currentQuestionIdx % this.questionBank.length];
    const data = questionData || currentQ;

    if (this.questionTextEl) {
      this.questionTextEl.innerHTML = data.question;
    }

    if (this.answersListEl) {
      this.answersListEl.classList.remove('revealed');
    }

    const items = this.answersListEl ? this.answersListEl.querySelectorAll('.answer-item') : [];
    if (items.length && data.answers) {
      data.answers.forEach((ans, i) => {
        if (items[i]) {
          const textEl = items[i].querySelector('.answer-text');
          const numEl = items[i].querySelector('.answer-num');
          if (textEl) textEl.textContent = ans.text;
          if (numEl && ans.num) numEl.textContent = ans.num;
          items[i].classList.remove('visible', 'correct-choice');
        }
      });
    }

    this.isQuestionActive = true;
    this.questionStage.classList.remove('hidden');
    void this.questionStage.offsetWidth; // Force layout reflow
    this.questionStage.classList.add('active');

    // Clock shows the full time as soon as the question appears (no flip)
    this.flipClock.set(data.time || 15, false);
    const timerEl = document.getElementById('questionTimer');
    if (timerEl) timerEl.classList.remove('urgent');

    // 1. Play swish sound when question shows
    if (this.sound) {
      this.sound.playSwish(0.9);
    }

    // 2. Play question voiceline
    if (data.voice && this.sound) {
      await this.sound.playVoiceline(data.voice);
    } else {
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (!this.isQuestionActive) return;

    // Brief pause before answers start appearing
    await new Promise((r) => setTimeout(r, 300));
    if (!this.isQuestionActive) return;

    // 3. Reveal answers one by one with a swish sound every time an answer shows.
    // Phones get the answers up front (hidden) and reveal each one at the same moment as the TV.
    const answerTexts = data.answers.map((a) => a.text);
    this.answers = new Map();
    this.answerTimes = new Map();
    this.setPhoneState({ type: 'question', answers: answerTexts, shown: 0, open: false });
    for (let i = 0; i < items.length; i++) {
      if (!this.isQuestionActive) return;
      items[i].classList.add('visible');
      this.net.broadcast({ type: 'show', index: i });
      this.phoneState = { type: 'question', answers: answerTexts, shown: i + 1, open: false };
      if (this.sound) {
        this.sound.playSwish(0.75);
      }
      await new Promise((r) => setTimeout(r, 380));
    }

    if (!this.isQuestionActive) return;

    // 4. Answers open on phones as the countdown starts
    this.acceptingAnswers = true;
    this.net.broadcast({ type: 'open' });
    this.phoneState = { type: 'question', answers: answerTexts, shown: answerTexts.length, open: true };
    this.startQuestionTimer(data.time || 15);

    // Bots lock in a random answer at a random moment while the clock runs
    const seconds = data.time || 15;
    this.players.filter((p) => !p.roomId).forEach((p) => {
      p.botChoice = null;
      p.botAnsweredAt = null;
      setTimeout(() => {
        if (!this.acceptingAnswers) return;
        p.botChoice = Math.floor(Math.random() * 4) + 1;
        p.botAnsweredAt = performance.now();
        this.checkAllAnswered();
        p.blendWiggle(0, 0.35);
      }, 1000 + Math.random() * (seconds - 2) * 1000);
    });
  }

  hideQuestion() {
    this.stopQuestionTimer();
    if (this.sound) {
      this.sound.stopVoiceline();
    }
    if (this.answerTimeouts) {
      this.answerTimeouts.forEach((t) => clearTimeout(t));
    }
    this.isQuestionActive = false;
    if (this.questionStage) {
      this.questionStage.classList.remove('active');
      setTimeout(() => {
        if (!this.isQuestionActive && this.questionStage) {
          this.questionStage.classList.add('hidden');
        }
      }, 750);
    }
  }

  toggleQuestion() {
    if (this.isQuestionActive) {
      this.hideQuestion();
    } else {
      // If room not yet moving or in lobby, start room moving for testing
      if (this.room && !this.room.bgScrolling) {
        this.room.bgScrolling = true;
      }
      this.showQuestion();
    }
  }

  startQuestionTimer(seconds = 15) {
    this.stopQuestionTimer();
    this.questionSeconds = seconds;
    const totalSeconds = seconds;

    // Initial tick sound as countdown begins
    if (this.sound) {
      this.sound.playTick(0.85);
    }

    const updateWatchUI = (s) => {
      this.flipClock.set(s);
      const timerEl = document.getElementById('questionTimer');
      if (timerEl) timerEl.classList.toggle('urgent', s <= 5);
    };

    updateWatchUI(this.questionSeconds);

    this.questionTimer = setInterval(() => {
      this.questionSeconds--;
      updateWatchUI(this.questionSeconds);

      if (this.questionSeconds > 0 && this.sound) {
        this.sound.playTick(0.85);
      }

      if (this.questionSeconds <= 0) {
        this.stopQuestionTimer();
        this.handleQuestionTimeout();
      }
    }, 1000);
  }

  /**
   * Skip Round: abandon this round wherever it is (question, results or killing room) and go to the
   * next question through a normal room change, which resets everything in the dark.
   */
  skipRound() {
    if (this.gameState !== 'PLAYING' || this.isTransitioning) return;
    this.roundToken++;
    this.acceptingAnswers = false;
    this.stopQuestionTimer();
    if (this.isQuestionActive) this.hideQuestion();
    const director = this.killingRoom;
    if (director) director.abort();
    this.killingRoom = null;
    this.setPhoneState({ type: 'wait' });
    this.runRoomTransitionLoop(() => {
      if (director) {
        director.leave();
      } else {
        this.camera.setGridMode('grid');
        this.players.forEach((p) => {
          p.cancelFlight();
          p.clearResult(1.0);
        });
      }
    });
  }

  /** Everyone has locked in: the clock goes to 0 now and the round carries on as if it ran out */
  checkAllAnswered() {
    if (!this.acceptingAnswers || !this.questionTimer) return;
    const done = this.getActivePlayers().every((p) => (p.roomId ? this.answers.has(p.roomId) : p.botChoice != null));
    if (!done) return;
    this.questionSeconds = 0;
    this.flipClock.set(0);
    this.stopQuestionTimer();
    this.handleQuestionTimeout();
  }

  stopQuestionTimer() {
    if (this.questionTimer) {
      clearInterval(this.questionTimer);
      this.questionTimer = null;
    }
  }

  /** The living player who answered last; anyone who didn't answer counts as later (random among them) */
  lastToAnswer() {
    const alive = this.getActivePlayers().filter((p) => p.isAlive());
    if (!alive.length) return null;
    const timeOf = (p) => (p.roomId ? this.answerTimes && this.answerTimes.get(p.roomId) : p.botAnsweredAt);
    const silent = alive.filter((p) => timeOf(p) == null);
    if (silent.length) return silent[Math.floor(Math.random() * silent.length)];
    return alive.reduce((a, b) => (timeOf(b) > timeOf(a) ? b : a));
  }

  /** Killing room for `taken` plus any volunteers (deaths happen inside the room) */
  async runKillingRoom(taken) {
    if (this.killingRoom) return;
    const director = new KillingRoomDirector(this);
    this.killingRoom = director;
    try {
      await director.run(taken);
    } catch (e) {
      if (e === KILL_ABORTED) return; // skipped: skipRound handles the way out
      throw e;
    }
    this.killingRoom = null;
    this.setPhoneState({ type: 'wait' });
    this.runRoomTransitionLoop(() => director.leave()); // out of the killing room like any room change
  }

  async handleQuestionTimeout() {
    this.stopQuestionTimer();
    const round = this.roundToken; // a skip changes this; everything below stops when it does
    const skipped = () => round !== this.roundToken;
    const currentQ = this.questionBank[this.currentQuestionIdx % this.questionBank.length];
    const correctIdx = currentQ.correctIndex || 1; // 1-indexed

    // 1. Reveal answers on the question board (wrong choices dim, correct choice gets slightly smaller)
    if (this.answersListEl) {
      this.answersListEl.classList.add('revealed');
      const items = this.answersListEl.querySelectorAll('.answer-item');
      items.forEach((item, idx) => {
        if (idx + 1 === correctIdx) {
          item.classList.add('correct-choice');
        } else {
          item.classList.remove('correct-choice');
        }
      });
    }

    // 2. Each player chooses randomly; show Tick (✔) only for correct players
    const activePlayers = this.getActivePlayers();
    this.acceptingAnswers = false;
    activePlayers.forEach((p) => {
      // Real players use their phone answer (no answer = wrong); dev bots still guess
      const playerChoice = p.roomId
        ? (this.answers && this.answers.get(p.roomId))
        : p.botChoice;
      const isCorrect = (playerChoice === correctIdx);
      p.money += isCorrect ? 100 : -50;
      p.showResult(isCorrect, 0.72);
      if (p.roomId) this.net.sendTo(p.roomId, { type: 'reveal', correct: isCorrect });
    });
    this.phoneState = { type: 'wait' }; // a phone reconnecting now shouldn't get answer buttons back

    if (this.sound) {
      this.sound.playLight();
    }

    // 3. Wait 3.5 seconds for players to see and react to the results
    await new Promise((r) => setTimeout(r, 3500));
    if (skipped()) return;

    // 4. Hide question board, answers, and clock
    this.hideQuestion();

    // 5. Wait 2.0 seconds with players still in lineup celebrating/mourning
    await new Promise((r) => setTimeout(r, 2000));
    if (skipped()) return;

    // 5b. The last living player to answer is taken to the killing room (volunteers may join)
    const taken = this.lastToAnswer();
    if (taken) {
      await this.runKillingRoom(taken); // ends with the room change into the next question
      return;
    }

    // 6. Return players to the center 2x4 grid
    this.players.forEach((p) => p.fadeResultBadge());
    await new Promise((r) => setTimeout(r, 450));
    if (skipped()) return;
    this.players.forEach((p) => {
      p.clearResult(1.0);
      if (p.isAlive()) p.blendWiggle(1.0, 0.45);
    });
    await this.toggleLineup();
    if (skipped()) return;

    // 7. Wait 2.5 seconds in the center before triggering room blackout transition
    await new Promise((r) => setTimeout(r, 2500));
    if (skipped()) return;

    // 8. Trigger full room blackout & eyes transition loop
    this.runRoomTransitionLoop();
  }

  /* =========================================
     Room Blackout Transition Loop
     ========================================= */

  runRoomTransitionLoop(onDark = null) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    const round = ++this.roundToken; // a skip after the lights come up stops this run and starts its own
    const skipped = () => round !== this.roundToken;

    // 1. Stop background scrolling
    if (this.room) {
      this.room.bgScrolling = false;
    }

    // 2. Freeze players' wiggle
    this.players.forEach((p) => {
      if (p.isAlive()) {
        p.blendWiggle(0, 1.0);
      }
    });

    // 3. Play build sound cue
    setTimeout(() => {
      if (this.sound) this.sound.playBuild();
    }, 300);

    const CUT_MS = 2400;

    // 4. Blackout & switch background - PLAY SLAM HERE!
    setTimeout(async () => {
      if (this.sound) {
        this.sound.playSlam(1.0);
      }

      if (this.room) {
        this.room.setBlackout(1);
        this.room.switchBackground();
      }
      if (onDark) onDark();

      this.players.forEach((p) => {
        if (p.isAlive()) p.setEyesMode(true);
      });
      if (this.grid) this.grid.classList.add('eyes-only');

      // 5. Wait 3.2s in blackout with eyes showing before restoring room lights
      setTimeout(async () => {
        if (this.room) this.room.setBlackout(0);
        if (this.grid) this.grid.classList.remove('eyes-only');

        this.players.forEach((p) => {
          p.setEyesMode(false);
        });

        if (this.sound) {
          this.sound.playLight();
          this.sound.playSlam(1.0);
          setTimeout(() => {
            if (this.sound) this.sound.playEchoBell();
          }, 500);
        }
        this.roomRoundCount++;
        this.playRoomMusic(this.roomRoundCount, 2500);

        setTimeout(async () => {
          this.players.forEach((p) => {
            if (p.isAlive()) p.blendWiggle(1.0, 0.45);
          });
          this.isTransitioning = false;

          // Advance to next question!
          this.currentQuestionIdx++;
          const nextQ = this.questionBank[this.currentQuestionIdx % this.questionBank.length];

          // Wait 2.0s in the center 2x4 grid in the new room
          await new Promise((r) => setTimeout(r, 2000));
          if (skipped()) return;

          // Every 3 rounds, the scoreboard before the next question
          if (this.currentQuestionIdx % 3 === 0) await this.showScoreboard();
          if (skipped()) return;

          // Move to top lineup
          this.flyTo('lineup');

          // 1.5s later, start room moving
          await new Promise((r) => setTimeout(r, 1500));
          if (skipped()) return;
          if (this.room) {
            this.room.bgScrolling = true;
          }

          // Fade in questions one by one with 15s countdown
          await new Promise((r) => setTimeout(r, 1000));
          if (skipped()) return;
          this.showQuestion(nextQ);
        }, 1200);
      }, 3200);
    }, CUT_MS);
  }

  playSound(type) {
    if (!this.sound) return;
    switch (type) {
      case 'SOUND_SWISH':
        this.sound.playSwish(0.75);
        break;
      case 'SOUND_WHOOSH':
        this.sound.playWhoosh();
        break;
      case 'SOUND_GHOST':
        this.sound.playGhost();
        break;
      case 'SOUND_BELL':
        this.sound.playEchoBell();
        break;
    }
  }

  /* =========================================
     Group Blink Director
     ========================================= */

  _startBlinkDirector() {
    if (this.blinkTimeout) clearTimeout(this.blinkTimeout);

    const nextTick = () => {
      const delay = 1100 + Math.random() * 1600;
      this.blinkTimeout = setTimeout(() => {
        if (!this.isTransitioning) {
          const available = this.players.filter((p) => p.isAlive());
          if (available.length > 0) {
            const count = Math.random() < 0.25 ? Math.min(2, available.length) : 1;
            const shuffled = [...available].sort(() => 0.5 - Math.random());
            for (let i = 0; i < count; i++) {
              setTimeout(() => {
                if (shuffled[i] && shuffled[i].isAlive()) {
                  shuffled[i].blink();
                }
              }, i * 180);
            }
          }
        }
        nextTick();
      }, delay);
    };
    nextTick();
  }

  /* =========================================
     Room Transitions (Space Key)
     ========================================= */

  transitionRoom() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

    // 1. Fade piano audio down
    if (this.sound) {
      this.sound.fadePianoOut(1200);
    }

    // 2. Smoothly freeze players' wiggle to 0 without any animation jump!
    this.players.forEach((p) => {
      if (p.isAlive()) {
        p.blendWiggle(0, 1.0);
      }
    });

    // 3. Play build sound cue
    setTimeout(() => {
      if (this.sound) this.sound.playBuild();
    }, 200);

    const CUT_MS = 2000;
    const LIGHT_SOUND_OFFSET_MS = 150;

    // 4. Play light sound before blackout
    setTimeout(() => {
      if (this.sound) this.sound.playLight();
    }, CUT_MS + LIGHT_SOUND_OFFSET_MS);

    // 5. Trigger blackout & switch background
    setTimeout(() => {
      this.room.setBlackout(1);
      this.room.switchBackground();

      // Show eyes-only on characters
      this.players.forEach((p) => {
        if (p.isAlive()) {
          p.setEyesMode(true);
        }
      });
      if (this.grid) this.grid.classList.add('eyes-only');

      // 6. Restore room & light after blackout duration
      setTimeout(() => {
        this.room.setBlackout(0);
        if (this.grid) this.grid.classList.remove('eyes-only');

        this.players.forEach((p) => {
          p.setEyesMode(false);
        });

        if (this.sound) {
          this.sound.playLight();
          this.sound.playSlam(0.9);
          this.sound.fadePianoIn(2500);
        }

        // 7. Smoothly blend wiggles back to 1.0 (seamless, jitter-free!)
        setTimeout(() => {
          this.players.forEach((p) => {
            if (p.isAlive()) {
              p.blendWiggle(1.0, 0.45);
            }
          });
          this.isTransitioning = false;
        }, 1000);
      }, 2500);
    }, CUT_MS);
  }

  /* =========================================
     Lineup Trajectory Flight (L Key)
     ========================================= */

  /**
   * Killing-room layout: each listed player flies to its own spot (px centre) and size;
   * everyone else stays exactly where they are.
   */
  placeForKilling(targets, dur = 850, slide = new Set(), stagger = 0) {
    const before = new Map(this.players.map((p) => {
      const r = p.slot.getBoundingClientRect();
      return [p, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, k: p.currentScale || 1.0 }];
    }));
    this.camera.setGridMode('killing');
    const now = performance.now();
    let order = 0;
    this.players.forEach((p) => {
      const from = before.get(p);
      const t = targets.get(p) || { x: from.cx, y: from.cy, k: from.k };
      p.slot.style.setProperty('--kx', `${t.x.toFixed(1)}px`);
      p.slot.style.setProperty('--ky', `${t.y.toFixed(1)}px`);
      if (!targets.has(p)) return;
      const r = p.slot.getBoundingClientRect();
      const sx = r.left + r.width / 2;
      const sy = r.top + r.height / 2;
      if (dur <= 0) {
        p.cancelFlight();
        p.currentScale = t.k;
        p.wrapper.style.transform = `scale(${t.k.toFixed(4)})`;
        return;
      }
      p.startFlight({ from, to: { cx: sx, cy: sy, k: t.k, slotCenterX: sx, slotCenterY: sy }, delay: order++ * stagger, dur, now, arc: !slide.has(p) });
    });
    return new Promise((r) => setTimeout(r, Math.max(0, order - 1) * stagger + dur)); // until the last one lands
  }

  async toggleLineup() {
    return this.flyTo(this.camera.isLineup ? 'grid' : 'lineup');
  }

  /** Fly every player from where they are now to their place in `mode` (grid | lineup | scoreboard) */
  async flyTo(mode) {
    if (!this.players.length) return;

    const MODE_SCALE = { grid: 1.0, lineup: 0.72, scoreboard: 0.9 };
    const K_START = MODE_SCALE[this.camera.mode] || 1.0;

    // 1. Capture current visual center coordinates of all slots BEFORE layout change
    const beforeCenters = this.players.map((p) => {
      const sr = p.slot.getBoundingClientRect();
      return {
        cx: sr.left + sr.width / 2,
        cy: sr.top + sr.height / 2,
        k: K_START
      };
    });

    // 2. Switch layout class on container & grid
    this.camera.setGridMode(mode);
    const K_END = MODE_SCALE[mode] || 1.0;

    // 3. Stagger trajectories smoothly (Synchronous - zero frame gap!)
    // Stagger column by column through the 2x4 grid (top then bottom of each column)
    const n = this.players.length;
    const order = [];
    for (let c = 0; c < 4; c++) {
      if (c < n) order.push(c);
      if (c + 4 < n) order.push(c + 4);
    }
    const rank = new Array(n);
    order.forEach((slotIdx, r) => { rank[slotIdx] = r; });
    if (mode === 'scoreboard') {
      // Land left to right along the row
      this.players.forEach((p, i) => { rank[i] = Number(p.slot.style.getPropertyValue('--rank')) || 0; });
    }

    const now = performance.now();
    this.players.forEach((p, i) => {
      const afterSlotRect = p.slot.getBoundingClientRect();
      const slotCenterX = afterSlotRect.left + afterSlotRect.width / 2;
      const slotCenterY = afterSlotRect.top + afterSlotRect.height / 2;

      const to = {
        cx: slotCenterX,
        cy: slotCenterY,
        k: K_END,
        slotCenterX,
        slotCenterY
      };

      const delay = rank[i] * 90;
      p.startFlight({
        from: beforeCenters[i],
        to,
        delay,
        dur: 850,
        now
      });
    });
    return (n - 1) * 90 + 850; // ms until the last player lands
  }

  /* =========================================
     Input Event Coordination
     ========================================= */

  /** Correct answer (1-based) of the question on screen */
  currentCorrectIndex() {
    const q = this.questionBank[this.currentQuestionIdx % this.questionBank.length];
    return q.correctIndex || 1;
  }

  /** Mod menu: answer for a player (phone or bot) exactly as if they'd tapped it */
  forceAnswer(player, index) {
    if (!player || !this.acceptingAnswers || !(index >= 1 && index <= 4)) return;
    if (player.roomId) {
      if (this.answers.has(player.roomId)) return;
      this.answers.set(player.roomId, index);
      this.answerTimes.set(player.roomId, performance.now());
    } else {
      if (player.botChoice != null) return;
      player.botChoice = index;
      player.botAnsweredAt = performance.now();
    }
    player.blendWiggle(0, 0.35);
    this.checkAllAnswered();
  }

  /** Mod menu: take a player (phone or bot) out of the game */
  removePlayerObject(player) {
    if (!player) return;
    if (player.roomId) {
      this.removePlayer(player.roomId);
      if (this.net) this.net.kick(player.roomId);
      return;
    }
    const idx = this.players.indexOf(player);
    if (idx === -1) return;
    this.players.splice(idx, 1);
    player.slot.remove();
    this.updateSlotCards();
    const nextVip = player.isVip && this.players.find((p) => p.roomId);
    if (nextVip) {
      nextVip.setVip(true);
      this.sendProfile(nextVip.roomId, nextVip);
    }
    if (this.sound) this.sound.playWhoosh();
  }

  _initInput() {
    window.addEventListener('keydown', (e) => {
      if (!e.key) return;
      if (e.key === '`') {
        this.modMenu.toggle();
        return;
      }
      if (e.target && e.target.closest && e.target.closest('.mod-menu, .mod-phones')) return; // using the menu
      const key = e.key.toLowerCase();

      // Number keys 1-8 to toggle player slots
      if (e.key >= '1' && e.key <= '8') {
        const slotIdx = parseInt(e.key, 10) - 1;
        this.togglePlayerVisible(slotIdx);
      } else if (key === 'p') {
        // Dev: add a bot player
        const bots = ['SPOOKY', 'GHOUL', 'BONES', 'MOTH', 'CREEP', 'WISP', 'HOLLOW', 'NIGHT'];
        this.addPlayer({ name: bots[this.players.length % bots.length] });
      } else if (key === 'v') {
        if (this.players[0]) {
          this.players[0].setVip(!this.players[0].isVip);
          if (this.sound) this.sound.playLight();
        }
      } else if (e.key === 'Enter') {
        this.startLobbyGame();
      } else if (key === 'm') {
        this.room.toggleScrolling();
      } else if (key === 'l') {
        this.toggleLineup();
      } else if (key === 'escape' || key === 's') {
        if (this.gameState === 'INTRO') {
          this.skipIntro();
        }
      } else if (key === 'n') {
        this.skipRound();
      } else if (key === 'k') {
        // Dev: take a random living player to the killing room
        const alive = this.players.filter((p) => p.isAlive());
        if (alive.length) this.runKillingRoom(alive[Math.floor(Math.random() * alive.length)]);
      } else if (key === 'q' || key === 't') {
        this.toggleQuestion();
      } else if (e.code === 'Space') {
        if (this.gameState === 'INTRO') {
          this.skipIntro();
        } else if (this.gameState === 'LOBBY') {
          this.startIntroSequence();
        }
      }
    });

    window.addEventListener('resize', () => {
      this.room.setupBackground();
    });
  }
}
