/**
 * Manager.js - Core Scene Manager, Events, and Transitions
 */

const MAX_PLAYERS = 8;

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
    this.roomCodeEl = document.getElementById('lobbyRoomCode');
    this.startPromptEl = document.getElementById('lobbyStartPrompt');

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
    this.timerDigitsEl = document.getElementById('timerDigits');
    this.gameRoomCodeEl = document.getElementById('gameRoomCode');
    this.questionTimer = null;
    this.questionSeconds = 15;
    this.isQuestionActive = false;
    this.roomRoundCount = 0;

    // Question Bank (with official Trivia voicelines)
    this.questionBank = [
      {
        question: "Which animal is the loudest?",
        voiceline: "assets/sound/voicelines/55607_Which_animal_is_the_loudest.ogg",
        answers: [
          { num: 1, text: "sperm whale" },
          { num: 2, text: "howler monkey" },
          { num: 3, text: "blue whale" },
          { num: 4, text: "pistol shrimp" }
        ],
        correctIndex: 1,
        time: 15
      },
      {
        question: "Who built the Pyramid of the Sun?",
        voiceline: "assets/sound/voicelines/55620_Who_built_the_Pyramid_of_the_Sun.ogg",
        answers: [
          { num: 1, text: "Aztecs" },
          { num: 2, text: "Teotihuacanos" },
          { num: 3, text: "Mayans" },
          { num: 4, text: "Incas" }
        ],
        correctIndex: 2,
        time: 15
      },
      {
        question: "What is a sugar glider?",
        voiceline: "assets/sound/voicelines/56011_What_is_a_sugar_glider.ogg",
        answers: [
          { num: 1, text: "bird" },
          { num: 2, text: "rodent" },
          { num: 3, text: "marsupial" },
          { num: 4, text: "flying squirrel" }
        ],
        correctIndex: 3,
        time: 15
      }
    ];
    this.currentQuestionIdx = 0;

    this._initInput();
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
      if (data.type === 'start') {
        const player = this.playersById.get(roomId);
        if (player && player.isVip && this.gameState === 'LOBBY') this.startLobbyGame();
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
      isVip: this.players.length === 0,
    });
    player.colorIndex = colorIndex;
    if (info.id) {
      player.roomId = info.id;
      this.playersById.set(info.id, player);
      this.sendProfile(info.id, player);
    }
    if (this.sound) this.sound.playLight();
    return player;
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

    if (player.isVip && this.players[0]) {
      const next = this.players[0];
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

    if (this.skipIntroBtn) {
      this.skipIntroBtn.addEventListener('click', () => {
        this.skipIntro();
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
      this.roomCodeEl.textContent = code;
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

  startLobbyGame() {
    this.startIntroSequence();
  }

  skipIntro() {
    this.isIntroSkipped = true;
    this.isIntroRunning = false;
    this.gameState = 'PLAYING';

    if (this.skipIntroBtn) this.skipIntroBtn.classList.add('hidden');

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
    const atmosphere = document.getElementById('lobbyAtmosphere');
    if (atmosphere) atmosphere.classList.add('hidden');

    this.roomRoundCount = 0;
    this.playRoomMusic(this.roomRoundCount, 1000);

    if (this.room) {
      this.room.switchBg(3);
      this.room.bgScrolling = true;
    }
    if (this.camera) {
      this.camera.setGridMode('lineup');
    }
    if (this.grid) {
      this.grid.classList.remove('hide-names');
    }
    this.players.forEach((p) => {
      p.resetPose();
      p.blendWiggle(1.0, 0.2);
    });

    this.showQuestion();
  }

  async startIntroSequence() {
    if (this.isIntroRunning) return;
    this.isIntroRunning = true;
    this.isIntroSkipped = false;
    this.gameState = 'INTRO';
    if (this.net) {
      this.net.lock(); // no new players once the game starts; drop-outs can still rejoin
      this.setPhoneState({ type: 'wait' });
    }

    if (this.skipIntroBtn) this.skipIntroBtn.classList.remove('hidden');

    // 1. Smoothly fade out music and keep loud lamp humming
    if (this.sound) {
      this.sound.fadeMusicOut(900);
      setTimeout(() => this.sound.stopAtmosphere(true), 950);
    }

    // 2. Hide Lobby UI & Fullscreen Atmosphere smoothly
    if (this.lobbyUI) this.lobbyUI.classList.add('hidden');
    const atmosphere = document.getElementById('lobbyAtmosphere');
    if (atmosphere) atmosphere.classList.add('hidden');

    // 3. Screen fades to pitch black and light switches off
    if (this.sound) {
      this.sound.playLight();
    }

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
    this.players.forEach((p) => p.resetPose());

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

    // 16. Show players in the 2x4 grid, wait 2s
    await new Promise((r) => setTimeout(r, 2000));
    if (this.isIntroSkipped) return;

    // 17. Perform lineup movement to the top row (L press effect) - smoothly fades out names first
    await this.toggleLineup();
    if (this.isIntroSkipped) return;

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

    // 1. Play swish sound when question shows
    if (this.sound) {
      this.sound.playSwish(0.9);
    }

    // 2. Play question voiceline
    if (data.voiceline && this.sound) {
      await this.sound.playVoiceline(data.voiceline);
    } else {
      await new Promise((r) => setTimeout(r, 1200));
    }

    if (!this.isQuestionActive) return;

    // Brief pause before answers start appearing
    await new Promise((r) => setTimeout(r, 300));
    if (!this.isQuestionActive) return;

    // 3. Reveal answers one by one with a swish sound every time an answer shows
    for (let i = 0; i < items.length; i++) {
      if (!this.isQuestionActive) return;
      items[i].classList.add('visible');
      if (this.sound) {
        this.sound.playSwish(0.75);
      }
      await new Promise((r) => setTimeout(r, 380));
    }

    if (!this.isQuestionActive) return;

    // 4. Start 15s countdown
    this.startQuestionTimer(data.time || 15);
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
      if (this.timerDigitsEl) {
        this.timerDigitsEl.textContent = Math.max(0, s);
      }
      const pie = document.getElementById('watchPie');
      if (pie) {
        const progress = Math.max(0, Math.min(1, s / totalSeconds));
        const angle = Math.round((1 - progress) * 360);
        pie.style.setProperty('--pie-angle', `${angle}deg`);
      }
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

  stopQuestionTimer() {
    if (this.questionTimer) {
      clearInterval(this.questionTimer);
      this.questionTimer = null;
    }
  }

  async handleQuestionTimeout() {
    this.stopQuestionTimer();
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
    activePlayers.forEach((p) => {
      const playerChoice = Math.floor(Math.random() * 4) + 1;
      const isCorrect = (playerChoice === correctIdx);
      p.showResult(isCorrect, 0.72);
    });

    if (this.sound) {
      this.sound.playLight();
    }

    // 3. Wait 3.5 seconds for players to see and react to the results
    await new Promise((r) => setTimeout(r, 3500));

    // 4. Hide question board, answers, and clock
    this.hideQuestion();

    // 5. Wait 2.0 seconds with players still in lineup celebrating/mourning
    await new Promise((r) => setTimeout(r, 2000));

    // 6. Return players to the center 2x4 grid
    this.players.forEach((p) => p.clearResult(1.0));
    await this.toggleLineup();

    // 7. Wait 2.5 seconds in the center before triggering room blackout transition
    await new Promise((r) => setTimeout(r, 2500));

    // 8. Trigger full room blackout & eyes transition loop
    this.runRoomTransitionLoop();
  }

  /* =========================================
     Room Blackout Transition Loop
     ========================================= */

  runRoomTransitionLoop() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;

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

          // Move to top lineup
          await this.toggleLineup();

          // 1.5s later, start room moving
          await new Promise((r) => setTimeout(r, 1500));
          if (this.room) {
            this.room.bgScrolling = true;
          }

          // Fade in questions one by one with 15s countdown
          await new Promise((r) => setTimeout(r, 1000));
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

  async toggleLineup() {
    if (!this.players.length) return;

    const goingToLineup = !this.camera.isLineup;
    const K_START = this.camera.isLineup ? 0.72 : 1.0;

    // 1. Capture current visual center coordinates of all slots BEFORE layout change
    const beforeCenters = this.players.map((p) => {
      const sr = p.slot.getBoundingClientRect();
      return {
        cx: sr.left + sr.width / 2,
        cy: sr.top + sr.height / 2,
        k: K_START
      };
    });

    // 2. Toggle layout class on container & grid
    const isLineup = this.camera.toggleLineup();
    const K_END = isLineup ? 0.72 : 1.0;

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
  }

  /* =========================================
     Input Event Coordination
     ========================================= */

  _initInput() {
    window.addEventListener('keydown', (e) => {
      if (!e.key) return;
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
      } else if (key === 'q' || key === 't') {
        this.toggleQuestion();
      } else if (e.code === 'Space') {
        if (this.gameState === 'INTRO') {
          this.skipIntro();
        } else {
          this.startIntroSequence();
        }
      }
    });

    window.addEventListener('resize', () => {
      this.room.setupBackground();
    });
  }
}
