/**
 * Sound.js - Professional Audio & Atmospheric Sound Controller
 * 
 * Manages Web Audio API context, atmospheric ambient loops (lamp, horror drone, piano),
 * procedural random soundscapes (wind, ghost whispers), and layered FX (echo bells, whooshes, slams).
 */

class SoundController {
  constructor() {
    // Audio Elements
    this.lampAudio = document.getElementById('lampAudio') || new Audio('assets/sound/lamp.mp3');
    this.horrorAudio = document.getElementById('horrorAudio') || new Audio('assets/sound/horror.mp3');
    this.musicAudio = document.getElementById('musicAudio') || document.getElementById('pianoAudio') || new Audio('assets/sound/lobby.mp3');
    this.pianoAudio = this.musicAudio; // Alias for compatibility

    // Web Audio API State
    this.audioCtx = null;
    this.lampSource = null;
    this.lampGain = null;

    // Multi-Track Music Registry (Trivia Murder Party 2 Themes)
    this.tracks = {
      lobby: 'assets/sound/lobby.mp3',
      question: 'assets/sound/question.mp3',
      elevator: 'assets/sound/elevator.mp3',
      howdya_do: 'assets/sound/howdya_do.mp3',
      organica: 'assets/sound/organica.mp3'
    };
    this.currentTrack = 'lobby';

    // States
    this.audioUnlocked = false;
    this.musicStarted = false;
    this.musicMuted = false;
    this.MUSIC_TARGET_VOL = 0.65;
    this.PIANO_TARGET_VOL = this.MUSIC_TARGET_VOL;
    this.musicFadeRAF = null;
    this.pianoFadeRAF = null;

    // Ambient Schedulers
    this.windScheduled = false;
    this.ghostScheduled = false;
    this.staticScheduled = false;

    this._setupAudioProperties();
    this._attachUnlockListeners();
  }

  playQuestionMusic(fadeDuration = 2200) {
    this.playTrack('question', fadeDuration);
  }

  playTrack(trackName = 'lobby', fadeDuration = 2200) {
    const src = this.tracks[trackName] || this.tracks.lobby;
    this.currentTrack = trackName;
    this.musicMuted = false;
    this.musicStarted = true;

    if (!this.musicAudio) return;

    if (this.musicAudio.src && this.musicAudio.src.endsWith(src) && !this.musicAudio.paused) {
      this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, fadeDuration);
      return;
    }

    this.fadeAudio(this.musicAudio, 0, 400);
    setTimeout(() => {
      if (this.musicAudio) {
        this.musicAudio.src = src;
        this.musicAudio.currentTime = 0;
        this.musicAudio.volume = 0;
        this.musicAudio.play().then(() => {
          this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, fadeDuration);
        }).catch(() => {
          // Fallback to lobby.mp3 if specific file not yet present
          if (src !== this.tracks.lobby) {
            this.musicAudio.src = this.tracks.lobby;
            this.musicAudio.play().then(() => {
              this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, fadeDuration);
            }).catch(() => { });
          }
        });
      }
    }, 420);
  }

  _setupAudioProperties() {
    if (this.lampAudio) {
      this.lampAudio.loop = true;
      this.lampAudio.preload = 'auto';
      this.lampAudio.playbackRate = 0.88;
    }
    if (this.horrorAudio) {
      this.horrorAudio.loop = true;
      this.horrorAudio.preload = 'auto';
      this.horrorAudio.volume = 0.85;
    }
    if (this.musicAudio) {
      this.musicAudio.loop = true;
      this.musicAudio.preload = 'auto';
      this.musicAudio.volume = 0;
    }
  }

  _attachUnlockListeners() {
    const unlock = () => {
      this.unlockAudio();
      this.startAtmosphere();
    };

    ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((evt) => {
      window.addEventListener(evt, unlock, { passive: true, once: false });
    });
  }

  unlockAudio() {
    if (this.audioUnlocked && this.audioCtx && this.audioCtx.state === 'running') return;

    if (!this.audioCtx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();

        if (this.lampAudio) {
          this.lampSource = this.audioCtx.createMediaElementSource(this.lampAudio);
          this.lampGain = this.audioCtx.createGain();
          this.lampGain.gain.value = 2.6;
          this.lampSource.connect(this.lampGain);
          this.lampGain.connect(this.audioCtx.destination);
        }
      } catch (e) { }
    }

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => { });
    }

    this.audioUnlocked = true;
  }

  startAtmosphere() {
    // 1. Start Lamp Audio
    if (this.lampAudio && this.lampAudio.paused) {
      this.lampAudio.volume = 1.0;
      this.lampAudio.playbackRate = 0.88;
      this.lampAudio.play().catch(() => { });
    }

    // 2. Start Horror Drone
    if (this.horrorAudio && this.horrorAudio.paused) {
      this.horrorAudio.volume = 0.85;
      this.horrorAudio.play().catch(() => { });
    }

    // 3. Start Radio Music Theme Fade In
    if (!this.musicStarted && this.musicAudio) {
      this.musicStarted = true;
      this.musicAudio.volume = 0;
      this.musicAudio.play().then(() => {
        if (!this.musicMuted) {
          this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, 3500);
        }
      }).catch(() => {
        this.musicStarted = false;
      });
    }

    // 4. Start Ambient Schedulers
    this._scheduleRandomWind();
    this._scheduleRandomGhost();
    this._scheduleRandomRadioStatic();
  }

  playLobbyMusic(fadeDuration = 2500) {
    this.musicMuted = false;
    this.musicStarted = true;
    if (this.musicAudio) {
      this.musicAudio.currentTime = 0;
      this.musicAudio.volume = 0;
      this.musicAudio.play().then(() => {
        this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, fadeDuration);
      }).catch(() => { });
    }
  }

  fadeAudio(el, target, duration) {
    if (!el) return;
    if (this.musicFadeRAF && el === this.musicAudio) {
      cancelAnimationFrame(this.musicFadeRAF);
    }

    const start = parseFloat(el.volume) || 0;
    const startTime = performance.now();

    const step = (now) => {
      const t = Math.max(0, Math.min(1, (now - startTime) / duration));
      el.volume = Math.max(0, Math.min(1, start + (target - start) * t));
      if (t < 1) {
        if (el === this.musicAudio) {
          this.musicFadeRAF = requestAnimationFrame(step);
        } else {
          requestAnimationFrame(step);
        }
      } else {
        if (el === this.musicAudio) this.musicFadeRAF = null;
      }
    };

    if (el === this.musicAudio) {
      this.musicFadeRAF = requestAnimationFrame(step);
    } else {
      requestAnimationFrame(step);
    }
  }

  fadeMusicOut(duration = 1200) {
    if (this.musicAudio) {
      this.musicMuted = true;
      this.fadeAudio(this.musicAudio, 0, duration);
    }
  }

  fadeMusicIn(duration = 2500, target = this.MUSIC_TARGET_VOL) {
    if (this.musicAudio) {
      this.musicMuted = false;
      this.musicAudio.play().catch(() => { });
      this.fadeAudio(this.musicAudio, target, duration);
    }
  }

  fadePianoOut(duration = 1200) {
    this.fadeMusicOut(duration);
  }

  fadePianoIn(duration = 2500, target = this.PIANO_TARGET_VOL) {
    this.fadeMusicIn(duration, target);
  }

  duckMusic(duckTargetVol = 0.20, duration = 300) {
    if (this.musicAudio && !this.musicMuted && this.musicStarted) {
      this.fadeAudio(this.musicAudio, duckTargetVol, duration);
    }
  }

  unduckMusic(duration = 450) {
    if (this.musicAudio && !this.musicMuted && this.musicStarted) {
      this.fadeAudio(this.musicAudio, this.MUSIC_TARGET_VOL, duration);
    }
  }

  /* =========================================
     Procedural Ambient Schedulers
     ========================================= */

  _scheduleRandomWind() {
    if (this.windScheduled) return;
    this.windScheduled = true;

    const trigger = () => {
      const delay = 8000 + Math.random() * 18000;
      setTimeout(() => {
        const wind = new Audio('assets/sound/wind.mp3');
        wind.volume = 0.35 + Math.random() * 0.45;
        wind.playbackRate = 0.88 + Math.random() * 0.25;
        wind.play().catch(() => { });
        trigger();
      }, delay);
    };
    trigger();
  }

  _scheduleRandomGhost() {
    if (this.ghostScheduled) return;
    this.ghostScheduled = true;

    const trigger = () => {
      const delay = 12000 + Math.random() * 24000;
      setTimeout(() => {
        const ghost = new Audio('assets/sound/ghost.mp3');
        ghost.volume = 0.35 + Math.random() * 0.4;
        ghost.playbackRate = 0.9 + Math.random() * 0.2;
        ghost.play().catch(() => { });
        trigger();
      }, delay);
    };
    trigger();
  }

  _scheduleRandomRadioStatic() {
    if (this.staticScheduled) return;
    this.staticScheduled = true;

    const trigger = () => {
      const delay = 2500 + Math.random() * 5500;
      setTimeout(() => {
        if (!this.musicMuted && this.musicStarted) {
          const dur = 0.15 + Math.random() * 0.35;
          const vol = 0.08 + Math.random() * 0.10;
          this.playRadioStaticBurst(dur, vol);
        }
        trigger();
      }, delay);
    };
    trigger();
  }

  /**
   * Procedural Web Audio Radio Static & Crackle Burst
   */
  playRadioStaticBurst(duration = 0.22, maxGain = 0.12) {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const sampleRate = this.audioCtx.sampleRate;
      const bufferSize = Math.floor(sampleRate * duration);
      const buffer = this.audioCtx.createBuffer(1, bufferSize, sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < bufferSize; i++) {
        const isPop = Math.random() < 0.04;
        data[i] = isPop ? (Math.random() * 2 - 1) * 0.95 : (Math.random() * 2 - 1) * 0.25;
      }

      const source = this.audioCtx.createBufferSource();
      source.buffer = buffer;

      const filter = this.audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1400 + Math.random() * 900;
      filter.Q.value = 1.4;

      const gain = this.audioCtx.createGain();
      const now = this.audioCtx.currentTime;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(maxGain, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.audioCtx.destination);

      source.start(now);
    } catch (e) { }
  }

  /* =========================================
     Question Phase Theme & Ticking
     ========================================= */

  playTick(volume = 0.85) {
    try {
      const tick = new Audio('assets/sound/tick.mp3');
      tick.volume = volume;
      tick.play().catch(() => { });
    } catch (e) { }
  }

  /* =========================================
     One-Shot & Layered Sound Effects
     ========================================= */

  playSwish(volume = 0.85) {
    try {
      const swish = new Audio('assets/sound/swish.mp3');
      swish.volume = volume;
      swish.play().catch(() => { });
      return swish;
    } catch (e) {
      return null;
    }
  }

  playVoiceline(audioPath) {
    return new Promise((resolve) => {
      if (!audioPath) return resolve();
      if (this.currentVoiceline) {
        this.currentVoiceline.pause();
        this.currentVoiceline = null;
      }
      try {
        this.duckMusic(0.20, 300); // Duck background music volume
        const audio = new Audio(audioPath);
        this.currentVoiceline = audio;
        audio.volume = 1.0;
        const done = () => {
          this.currentVoiceline = null;
          this.unduckMusic(450); // Restore background music volume
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      } catch (e) {
        this.unduckMusic(450);
        resolve();
      }
    });
  }

  stopVoiceline() {
    if (this.currentVoiceline) {
      this.currentVoiceline.pause();
      this.currentVoiceline = null;
      this.unduckMusic(450);
    }
  }

  playWhoosh() {
    const whoosh = new Audio('assets/sound/whoosh.mp3');
    whoosh.play().catch(() => { });
  }

  playCurtainSwoosh(volume = 1.0) {
    try {
      const swoosh = new Audio('assets/sound/curtains-open.mp3');
      swoosh.volume = volume;
      swoosh.play().catch(() => {
        const fallback = new Audio('assets/sound/whoosh.mp3');
        fallback.playbackRate = 0.5;
        fallback.play().catch(() => { });
      });
      return swoosh;
    } catch (e) {
      return null;
    }
  }

  playGhost(volume = 0.28) {
    const ghost = new Audio('assets/sound/ghost.mp3');
    ghost.volume = volume;
    ghost.play().catch(() => { });
  }

  playEchoBell() {
    const bell1 = new Audio('assets/sound/bell.mp3');
    bell1.volume = 1.0;
    bell1.play().catch(() => { });

    setTimeout(() => {
      const bell2 = new Audio('assets/sound/bell.mp3');
      bell2.volume = 0.36;
      bell2.play().catch(() => { });
    }, 180);

    setTimeout(() => {
      const bell3 = new Audio('assets/sound/bell.mp3');
      bell3.volume = 0.12;
      bell3.play().catch(() => { });
    }, 360);
  }

  playBuild() {
    const build = new Audio('assets/sound/build.mp3');
    build.volume = 1.0;
    build.play().catch(() => { });

    const loudBuild = new Audio('assets/sound/loud-build.mp3');
    loudBuild.volume = 1.0;
    loudBuild.addEventListener('timeupdate', () => {
      if (loudBuild.currentTime >= 2.5) {
        loudBuild.pause();
      }
    });
    loudBuild.play().catch(() => { });
  }

  playLight() {
    const light = new Audio('assets/sound/light.mp3');
    light.play().catch(() => { });
  }

  stopAtmosphere(keepLamp = true) {
    this.musicMuted = true;
    this.musicStarted = false;
    if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.currentTime = 0;
    }
    if (this.horrorAudio) {
      this.horrorAudio.pause();
    }
    if (!keepLamp && this.lampAudio) {
      this.lampAudio.pause();
    } else if (keepLamp && this.lampAudio && this.lampAudio.paused) {
      this.lampAudio.volume = 1.0;
      this.lampAudio.play().catch(() => { });
    }
  }

  playIntroRing(cutoffSeconds = 3.35) {
    return new Promise((resolve) => {
      const ring = new Audio('assets/sound/ring.mp3');
      ring.volume = 0.95;
      let finished = false;
      const done = () => {
        if (!finished) {
          finished = true;
          ring.pause();
          resolve();
        }
      };
      ring.addEventListener('timeupdate', () => {
        if (ring.currentTime >= cutoffSeconds) {
          done();
        }
      });
      ring.onended = done;
      ring.onerror = done;
      ring.play().catch(done);
    });
  }

  playIntroPickup() {
    return new Promise((resolve) => {
      const pickup = new Audio('assets/sound/pickup.mp3');
      pickup.volume = 1.0;
      pickup.onended = () => resolve();
      pickup.onerror = () => resolve();
      pickup.play().catch(() => resolve());
    });
  }

  playIntroGibberish(cutoffSeconds = 5.25, onBuildStart = null) {
    return new Promise((resolve) => {
      const gibberish = new Audio('assets/sound/gibberish.mp3');
      gibberish.volume = 1.0;
      let finished = false;
      let buildTriggered = false;

      // Delayed build start (runs for ~1.45s leading directly into the cutoff)
      const buildStartTime = Math.max(0, cutoffSeconds - 1.45);
      const fadeStartTime = Math.max(0, cutoffSeconds - 0.40);   // Smooth 400ms fadeout

      const done = () => {
        if (!finished) {
          finished = true;
          gibberish.pause();
          resolve();
        }
      };

      gibberish.addEventListener('timeupdate', () => {
        const ct = gibberish.currentTime;

        // 1. Trigger synchronized build.mp3 so it ends exactly when gibberish ends
        if (!buildTriggered && ct >= buildStartTime) {
          buildTriggered = true;
          if (typeof onBuildStart === 'function') {
            onBuildStart();
          } else {
            this.playBuild();
          }
        }

        // 2. Smooth volume fadeout at the end
        if (ct >= fadeStartTime && ct < cutoffSeconds) {
          const progress = (ct - fadeStartTime) / (cutoffSeconds - fadeStartTime);
          gibberish.volume = Math.max(0, 1 - progress);
        }

        // 3. Resolve cleanly at cutoff
        if (ct >= cutoffSeconds) {
          done();
        }
      });

      gibberish.onended = done;
      gibberish.onerror = done;
      gibberish.play().catch(done);
    });
  }

  playIntroScream() {
    const scream = new Audio('assets/sound/scream.mp3');
    scream.volume = 1.0;
    scream.play().catch(() => { });
  }

  playSlam(volume = 0.9) {
    const slam = new Audio('assets/sound/slam.mp3');
    slam.volume = volume;
    slam.play().catch(() => { });
  }
}
