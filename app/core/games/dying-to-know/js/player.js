/**
 * Player.js - Custom 3D Character Controller
 * 
 * Provides procedural continuous harmonic motion (jitter-free wiggling),
 * 3D extrusion slicing, state-machine flips, lineup arcs, and blink handling.
 */

/**
 * Show `text` as X's (same length), then each character cycles through random letters and lands on
 * the real one, left to right; each starts before the one before it has landed.
 */
function scrambleText(el, text, delay = 0, { spin = 1000, stagger = 230 } = {}) {
  const POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SPIN_MS = spin;       // how long each character cycles
  const STAGGER_MS = stagger; // next character starts this long after the one before
  const STEP_MS = 65;     // how often a cycling character changes
  el.textContent = text.replace(/[^\s]/g, 'X');

  const token = (el.scrambleToken = {});
  const start = performance.now() + delay;
  const tick = () => {
    if (el.scrambleToken !== token) return; // a newer scramble or rename took over
    const now = performance.now();
    let done = true;
    const out = [...text].map((ch, i) => {
      if (/\s/.test(ch)) return ch;
      const t = now - (start + i * STAGGER_MS);
      if (t >= SPIN_MS) return ch;
      done = false;
      if (t < 0) return 'X';
      const c = POOL[Math.floor(Math.random() * 26)];
      return /[a-z]/.test(ch) ? c.toLowerCase() : c;
    });
    el.textContent = out.join('');
    if (!done && window.gameSound && now >= start) window.gameSound.playTypeClick();
    if (!done) setTimeout(tick, STEP_MS);
  };
  setTimeout(tick, Math.max(0, delay));
}

/** On-screen text appearing: XXXX that decodes fast, done in about half a second whatever the length */
function scrambleQuick(el, text, delay = 0) {
  const len = Math.max(1, String(text).length);
  scrambleText(el, String(text), delay, { spin: 200, stagger: Math.min(30, 320 / len) });
}

class Player {
  constructor({ parentEl, textures, index, letter, sound, name = '', color = '#ffffff', tilt = -4, isVip = false, isVisible = true }) {
    this.parentEl = parentEl;
    this.textures = textures;
    this.index = index;
    this.letter = letter;
    this.sound = sound;

    // Lobby & Player Profile Info
    this.name = name;
    this.nameColor = color;
    this.nameTilt = tilt;
    this.isVip = isVip;
    this.isVisible = isVisible;

    // Character State
    this.state = 'ALIVE';
    this.isBlinking = false;
    this.isFlipping = false;

    // Procedural Wiggle Kinematics
    this.duration = 2.6 + Math.random() * 0.8;
    this.speed = (Math.PI * 2) / this.duration;
    this.phaseY = Math.random() * Math.PI * 2;
    this.phaseX = this.phaseY + Math.PI * 0.35;
    this.phaseZ = this.phaseY + Math.PI * 0.7;

    // Wiggle Blend: 1 = full wiggle, 0 = frozen to (0,0,0)
    this.wiggleBlend = 1.0;
    this.targetWiggleBlend = 1.0;
    this.blendDuration = 0;
    this.blendElapsed = 0;
    this.blendStart = 1.0;

    // Spin / Flip Animation State
    this.spinProgress = 0;
    this.spinDuration = 0;
    this.spinTimer = 0;
    this.spinType = null; // 'DEATH' or 'REVIVE'
    this.spinSoundTriggers = {};

    // Lineup flight arc
    this.inFlight = false;
    this.flightStart = null;
    this.flightDelay = 0;
    this.flightDur = 1700;
    this.flightFrom = { x: 0, y: 0, k: 1 };
    this.flightTo = { x: 0, y: 0, k: 1 };
    this.flightControl = { x: 0, y: 0 };
    this.slotRect = null;

    // DOM Hierarchy & Progressive Extrusion Loading
    this.isExtrusionLoaded = false;
    this.tiltBlend = 0.0;
    this.edgeSlices = [];
    this.deadEdgeSlices = [];

    this._createDOM();
    this._buildExtrusionSlices();
  }

  _createDOM() {
    this.slot = document.createElement('div');
    this.slot.className = 'letter-slot';
    this.slot.dataset.index = this.index;
    this.slot.dataset.letter = this.letter;

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'letter-wrapper';

    // Shadow Slot & Image
    this.shadowSlot = document.createElement('div');
    this.shadowSlot.className = 'shadow-slot';

    this.shadowImg = document.createElement('img');
    this.shadowImg.src = this.textures.aliveShadow;
    this.shadowImg.alt = '';
    this.shadowImg.className = 'letter-shadow';
    this.shadowSlot.appendChild(this.shadowImg);

    // Main Slot & 3D Extruded Token
    this.mainSlot = document.createElement('div');
    this.mainSlot.className = 'main-slot';

    this.token3D = document.createElement('div');
    this.token3D.className = 'token-3d';

    // Front Face (Alive - Rendered Immediately)
    this.frontImg = document.createElement('img');
    this.frontImg.src = this.textures.front;
    this.frontImg.alt = this.letter;
    this.frontImg.className = 'layer-slice face-front';
    this.token3D.appendChild(this.frontImg);

    // Back Face (Dead)
    this.backImg = document.createElement('img');
    this.backImg.src = this.textures.dead;
    this.backImg.alt = `${this.letter} Dead`;
    this.backImg.className = 'layer-slice face-back';
    this.token3D.appendChild(this.backImg);

    this.mainSlot.appendChild(this.token3D);
    this.wrapper.appendChild(this.shadowSlot);
    this.wrapper.appendChild(this.mainSlot);

    // Floating Player Nameplate (Inside wrapper so it moves with the player)
    this.nameEl = document.createElement('div');
    this.nameEl.className = 'player-name';
    this.nameTextEl = document.createElement('span');
    this.nameTextEl.textContent = this.name;
    this.nameEl.appendChild(this.nameTextEl);
    this.nameEl.style.color = this.nameColor;

    // VIP tag sits above the name and moves/tilts with it
    this.vipBadge = document.createElement('span');
    this.vipBadge.className = 'player-vip';
    this.vipBadge.textContent = 'VIP';
    this.vipBadge.style.display = this.isVip ? 'block' : 'none';
    this.nameEl.appendChild(this.vipBadge);
    this.nameEl.style.setProperty('--name-rot', `${this.nameTilt}deg`);
    this.nameEl.style.display = this.name ? 'block' : 'none';
    this.wrapper.appendChild(this.nameEl);

    // Money shown above the name on the scoreboard
    this.money = 100;
    // Money shown on top of a T-shaped bar that rises with it
    this.moneyEl = document.createElement('div');
    this.moneyEl.className = 'player-money';
    this.moneyBarEl = document.createElement('div');
    this.moneyBarEl.className = 'money-bar';
    this.moneyCapEl = document.createElement('div');
    this.moneyCapEl.className = 'money-cap';
    this.moneyTextEl = document.createElement('span');
    this.moneyTextEl.className = 'money-text';
    const crossbar = document.createElement('div');
    crossbar.className = 'money-crossbar';
    this.moneyCapEl.append(this.moneyTextEl, crossbar);
    this.moneyEl.append(this.moneyBarEl, this.moneyCapEl);
    this.wrapper.appendChild(this.moneyEl);

    // Result Badge (Tick / X underneath player)
    this.resultBadgeEl = document.createElement('div');
    this.resultBadgeEl.className = 'player-result-badge';
    this.wrapper.appendChild(this.resultBadgeEl);

    this.slot.appendChild(this.wrapper);

    if (!this.isVisible) {
      this.slot.classList.add('hidden');
    }

    this.currentScale = 1.0;
    this.targetScale = 1.0;
    this.scaleDuration = 0;
    this.scaleElapsed = 0;
    this.scaleStart = 1.0;

    // Hover: the letter lifts toward you; its shadow stays put on the wall behind
    this.slot.addEventListener('mouseenter', () => {
      if (!this.inFlight && this.isVisible) {
        this.mainSlot.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 1s ease'; // keep the spawn fade-in
        this.mainSlot.style.transform = 'scale(1.06)';
      }
    });

    this.slot.addEventListener('mouseleave', () => {
      this.mainSlot.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 1s ease'; // keep the spawn fade-in
      this.mainSlot.style.transform = '';
    });

    // Click handler for flip toggle
    this.slot.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isVisible) this.toggleFlip();
    });

    this.parentEl.appendChild(this.slot);
  }

  _buildExtrusionSlices() {
    // Build 3D edge slices in microtask using DocumentFragment for instant 0ms initial painting
    requestAnimationFrame(() => {
      const fragment = document.createDocumentFragment();
      for (let z = -9.5; z <= 9.5; z += 0.75) {
        const slice = document.createElement('img');
        slice.src = this.textures.edge;
        slice.alt = '';
        slice.className = 'layer-slice edge-slice';
        slice.style.transform = `translateZ(${z.toFixed(1)}px)`;
        fragment.appendChild(slice);
        this.edgeSlices.push(slice);

        // Matching dead-letter layer, mirrored (it's only seen from behind) and hidden until a spin needs it
        if (this.textures.deadEdge) {
          const dead = document.createElement('img');
          dead.src = this.textures.deadEdge;
          dead.alt = '';
          dead.className = 'layer-slice edge-slice';
          dead.style.transform = `translateZ(${z.toFixed(1)}px) scaleX(-1)`;
          dead.style.opacity = '0';
          fragment.appendChild(dead);
          this.deadEdgeSlices.push(dead);
        }
      }
      this.token3D.insertBefore(fragment, this.frontImg);
      this.isExtrusionLoaded = true;
    });
  }

  /** Swap the 3D side layers between the alive and dead letter */
  setEdgeKind(kind) {
    if (this.edgeKind === kind) return;
    this.edgeKind = kind;
    if (kind !== 'dead') this.deadEdgeSlices.forEach((s) => { s.style.opacity = '0'; });
  }

  /**
   * Side layers through a death spin at death-time `dt` (revive passes the mirrored time):
   * alive sides until the token is edge-on, then dead sides so it never goes paper-thin,
   * which fade away once it has settled facing back.
   */
  _edgesForDeathTime(time) {
    const EDGE_ON = 0.7;
    this.setEdgeKind(time < EDGE_ON ? 'alive' : 'dead');
    const deadOp = 0.68 * (1 - Math.min(1, Math.max(0, (time - 1.15) / 0.3)));
    // The dead face (and its baked glow) eases in after edge-on instead of popping at the cut-off
    const faceT = Math.min(1, Math.max(0, (time - EDGE_ON) / 0.35));
    this.backImg.style.opacity = (0.68 * faceT).toFixed(2);

    const dead = time >= EDGE_ON && this.deadEdgeSlices.length;
    // Both stacks already exist; just show one, so nothing reloads mid-spin
    this.edgeSlices.forEach((s) => { s.style.opacity = dead ? '0' : '1'; });
    this.deadEdgeSlices.forEach((s) => { s.style.opacity = dead ? deadOp.toFixed(2) : '0'; });
  }

  updateTextures(textures) {
    this.textures = { ...this.textures, ...textures };
    if (textures.front && this.frontImg) {
      this.frontImg.src = textures.front;
    }
    if (textures.dead && this.backImg) {
      this.backImg.src = textures.dead;
    }
    if (textures.edge && this.edgeSlices) {
      this.edgeSlices.forEach((slice) => {
        slice.src = textures.edge;
      });
    }
  }

  setName(name, color = null, tilt = null) {
    this.name = name;
    if (color) this.nameColor = color;
    if (tilt !== null) this.nameTilt = tilt;

    if (this.nameEl) {
      this.nameTextEl.scrambleToken = null; // stop any name scramble
      this.nameTextEl.textContent = this.name;
      this.nameEl.style.color = this.nameColor;
      this.nameEl.style.setProperty('--name-rot', `${this.nameTilt}deg`);
      this.nameEl.style.display = this.name ? 'block' : 'none';
    }
  }

  setVip(isVip) {
    this.isVip = isVip;
    if (this.vipBadge) {
      this.vipBadge.style.display = isVip ? 'block' : 'none';
    }
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (this.slot) {
      if (visible) {
        this.slot.classList.remove('hidden');
      } else {
        this.slot.classList.add('hidden');
      }
    }
  }

  isAlive() {
    return this.state === 'ALIVE' && !this.isFlipping;
  }

  isDead() {
    return this.state === 'DEAD';
  }

  /**
   * Smoothly blend wiggle amplitude (e.g. during room transitions)
   * Target: 0 (freeze to zero rotation) or 1 (full cartoon wiggle)
   */
  blendWiggle(target, duration = 1.0) {
    this.targetWiggleBlend = target;
    this.blendDuration = duration;
    this.blendElapsed = 0;
    this.blendStart = this.wiggleBlend;
  }

  /**
   * Trigger Death / Revive Flip
   */
  toggleFlip() {
    if (this.isFlipping) return;

    if (this.state === 'ALIVE') {
      this.startDeathSpin();
    } else if (this.state === 'DEAD') {
      this.startReviveSpin();
    }
  }

  startDeathSpin() {
    this.isFlipping = true;
    this.state = 'DYING';
    if (this.onLifeChange) this.onLifeChange();
    this.spinType = 'DEATH';
    this.spinDuration = 1.5;
    this.spinTimer = 0;
    this.spinProgress = 0;
    this.spinSoundTriggers = { whoosh: false, ghost: false, bell: false, swapShadow: false };

    // Reset front texture in case it was blinking
    this.frontImg.src = this.textures.front;
  }

  /** Show the dead face, straight on, with no spin (a revive spin follows) */
  joinDead() {
    this.state = 'DEAD';
    this.isFlipping = false;
    this.shadowImg.src = this.textures.deadShadow;
  }

  /** Glowing silhouette in first, the letter fades in beneath it, then the glow slowly goes */
  spawnGlow() {
    const glow = document.createElement('img');
    glow.className = 'spawn-glow';
    glow.src = this.textures.dead;
    glow.alt = '';
    this.wrapper.appendChild(glow);
    this.wrapper.classList.add('spawning');
    setTimeout(() => this.wrapper.classList.remove('spawning'), 1500);
    glow.addEventListener('animationend', () => glow.remove());
  }

  /** Name starts as XXX (same length), then decodes letter by letter (see scrambleText) */
  scrambleName(delay = 0) {
    scrambleText(this.nameTextEl, this.name || '', delay);
  }

  startReviveSpin() {
    this.isFlipping = true;
    this.state = 'REVIVING';
    if (this.onLifeChange) this.onLifeChange();
    this.spinType = 'REVIVE';
    this.spinDuration = 1.5; // same as the death spin
    this.spinTimer = 0;
    this.spinProgress = 0;
    this.spinSoundTriggers = { swapShadow: false };

    // Alive face and edges stay hidden until the spin passes edge-on
    this.edgeSlices.forEach((s) => { s.style.opacity = '0'; });
    this.frontImg.style.opacity = '0';
  }

  /**
   * Start smooth lineup flight trajectory
   */
  startFlight({ from, to, delay, dur = 850, now = performance.now(), arc = true }) {
    this.inFlight = true;
    this.flightStart = now + delay;
    this.flightDelay = delay;
    this.flightDur = dur;
    this.flightFrom = from; // { cx, cy, k }
    this.flightTo = to;     // { cx, cy, k, slotCenterX, slotCenterY }
    this.flightLaunched = false;

    // Pure vertical parabolic arc control point (Zero sideways tilt or random jitter)
    this.flightCtrlX = (from.cx + to.cx) / 2;
    this.flightCtrlY = arc
      ? Math.min(from.cy, to.cy) - Math.max(50, Math.abs(from.cy - to.cy) * 0.45)
      : (from.cy + to.cy) / 2; // straight slide

    this.wrapper.style.transition = 'none';

    // Synchronously clamp wrapper center to starting center and scale
    const tx = from.cx - to.slotCenterX;
    const ty = from.cy - to.slotCenterY;
    this.wrapper.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${from.k.toFixed(4)})`;
    void this.wrapper.offsetWidth; // Force synchronous reflow to prevent any transition queuing
  }

  cancelFlight() {
    this.inFlight = false;
    this.wrapper.style.transform = '';
    this.wrapper.style.transition = '';
  }

  resetPose() {
    this.inFlight = false;
    this.currentScale = 1.0;
    if (this.wrapper) {
      this.wrapper.style.transform = '';
      this.wrapper.style.transition = '';
    }
  }

  /**
   * Show Tick on correct players and scale/opacity state
   */
  showResult(isCorrect, baseScale = 0.72) {
    if (this.resultBadgeEl) {
      if (isCorrect) {
        this.resultBadgeEl.textContent = '✔';
        this.resultBadgeEl.className = 'player-result-badge visible correct';
      } else {
        this.resultBadgeEl.textContent = '';
        this.resultBadgeEl.className = 'player-result-badge';
      }
    }

    if (isCorrect) {
      this.slot.style.opacity = '1.0';
      const targetS = baseScale * 1.18;
      this.currentScale = targetS;
      this.wrapper.style.transform = `scale(${targetS.toFixed(4)})`;
      this.wrapper.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease';
    } else {
      this.slot.style.opacity = '0.28';
      const targetS = baseScale * 0.92;
      this.currentScale = targetS;
      this.wrapper.style.transform = `scale(${targetS.toFixed(4)})`;
      this.wrapper.style.transition = 'transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.35s ease';
    }
  }

  setMoneyText(amount) {
    this.moneyTextEl.textContent = `${amount < 0 ? '-' : ''}£${Math.abs(Math.round(amount))}`;
  }

  /** The full chalk line is drawn at its final length, then revealed from the bottom */
  setMoneyBarLength(px) {
    this.moneyBarEl.style.height = `${Math.max(0, px).toFixed(1)}px`;
  }

  setMoneyBar(px) {
    const d = `${Math.max(0, px).toFixed(1)}px`;
    this.moneyBarEl.style.clipPath = `inset(calc(100% - ${d}) -10px 0 -10px)`;
    this.moneyCapEl.style.bottom = d;
  }

  fadeResultBadge() {
    if (this.resultBadgeEl) this.resultBadgeEl.classList.add('fade-out');
  }

  clearResult(baseScale = 0.72) {
    if (this.resultBadgeEl) {
      this.resultBadgeEl.className = 'player-result-badge';
    }
    this.slot.style.opacity = '1.0';
    this.currentScale = baseScale;
    this.wrapper.style.transition = 'none';
    this.wrapper.style.transform = (baseScale === 1.0) ? '' : `scale(${baseScale.toFixed(4)})`;
  }

  /** Back to normal from a right/wrong result, eased (the tick fading at the same time) */
  settleResult(baseScale = 0.72) {
    this.slot.style.opacity = '1.0';
    this.currentScale = baseScale;
    this.wrapper.style.transition = 'transform 0.45s ease, opacity 0.45s ease';
    this.wrapper.style.transform = `scale(${baseScale.toFixed(4)})`;
  }

  /**
   * Trigger character eye blink
   */
  blink(doubleBlinkChance = 0.28) {
    // In the dark only the eyes show; a blink would put the whole face back
    const canBlink = () => this.isAlive() && !this.eyesMode;
    if (!canBlink()) return;
    this.frontImg.src = this.textures.blink;
    setTimeout(() => {
      if (!canBlink()) return;
      this.frontImg.src = this.textures.front;
      if (Math.random() < doubleBlinkChance) {
        setTimeout(() => {
          if (!canBlink()) return;
          this.frontImg.src = this.textures.blink;
          setTimeout(() => {
            if (canBlink()) this.frontImg.src = this.textures.front;
          }, 110);
        }, 70);
      }
    }, 130);
  }

  /**
   * Show baked eyes texture during blackout transition
   */
  setEyesMode(active) {
    this.eyesMode = active;
    if (active) {
      if (this.textures.eyes) {
        this.frontImg.src = this.textures.eyes;
      } else {
        this.frontImg.style.opacity = '0';
      }
    } else {
      this.frontImg.src = this.textures.front;
      this.frontImg.style.opacity = '1';
    }
  }

  /**
   * Main Per-Frame Update (Continuous Physics & Transforms)
   */
  update(dt, now) {
    // 1. Advance Procedural Wiggle Phase
    this.phaseY += this.speed * dt;
    this.phaseX += this.speed * dt * 0.92;
    this.phaseZ += this.speed * dt * 1.05;

    // 2. Smoothly Update Wiggle Blend
    if (this.blendDuration > 0 && this.blendElapsed < this.blendDuration) {
      this.blendElapsed += dt;
      const t = Math.min(1, this.blendElapsed / this.blendDuration);
      // Smooth step
      const ease = t * t * (3 - 2 * t);
      this.wiggleBlend = this.blendStart + (this.targetWiggleBlend - this.blendStart) * ease;
    } else {
      this.wiggleBlend = this.targetWiggleBlend;
    }

    // 3. Compute Progressive Extrusion Tilt Blend
    if (this.isExtrusionLoaded && this.tiltBlend < 1.0) {
      this.tiltBlend = Math.min(1.0, this.tiltBlend + dt / 0.45);
    }
    const tiltEase = this.tiltBlend * this.tiltBlend * (3 - 2 * this.tiltBlend);

    // 4. Compute Harmonic Wiggle Angles (stays 0 until layers load, then smoothly tilts)
    const rawWiggleY = 22 + Math.sin(this.phaseY) * 6;
    const rawWiggleX = 5 + Math.sin(this.phaseX) * 3;
    const rawWiggleZ = Math.sin(this.phaseZ) * 4;

    const curWiggleY = rawWiggleY * this.wiggleBlend * tiltEase;
    const curWiggleX = rawWiggleX * this.wiggleBlend * tiltEase;
    const curWiggleZ = rawWiggleZ * this.wiggleBlend * tiltEase;

    // 5. Handle State-Based Flip Rotations
    let finalRotY = curWiggleY;
    let finalRotX = curWiggleX;
    let finalRotZ = curWiggleZ;
    let finalScale = 1.0;

    if (this.state === 'DYING') {
      this.spinTimer += dt;
      const t = Math.min(1, this.spinTimer / this.spinDuration);
      // Custom cubic-bezier (0.76, 0, 0.24, 1) ease
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      // Audio & Event Milestones
      if (this.spinTimer >= 0.2 && !this.spinSoundTriggers.whoosh) {
        this.spinSoundTriggers.whoosh = true;
        if (this.onStateChange) this.onStateChange(this, 'SOUND_WHOOSH');
      }
      if (this.spinTimer >= 0.4) {
        // Fade the alive face out before the token passes edge-on (~0.7s)
        const fadeT = Math.min(1, Math.max(0, (this.spinTimer - 0.4) / 0.25));
        this.frontImg.style.opacity = (1 - fadeT).toFixed(2);
      }
      this._edgesForDeathTime(this.spinTimer);
      if (this.spinTimer >= 0.75 && !this.spinSoundTriggers.ghost) {
        this.spinSoundTriggers.ghost = true;
        if (this.onStateChange) this.onStateChange(this, 'SOUND_GHOST');
      }
      if (this.spinTimer >= 0.75 && !this.spinSoundTriggers.swapShadow) {
        this.spinSoundTriggers.swapShadow = true;
        this.shadowImg.src = this.textures.deadShadow;
      }
      if (this.spinTimer >= 1.45 && !this.spinSoundTriggers.bell) {
        this.spinSoundTriggers.bell = true;
        if (this.onStateChange) this.onStateChange(this, 'SOUND_BELL');
      }

      // Rotation math
      finalRotY = 24 + (180 - 24) * ease;
      finalRotX = 6 * (1 - ease);
      finalRotZ = 0;
      finalScale = 1 + Math.sin(ease * Math.PI) * 0.12;

      this.shadowImg.style.opacity = `${0.38 - 0.20 * ease}`;

      if (t >= 1) {
        this.state = 'DEAD';
        this.isFlipping = false;
        this.backImg.style.opacity = '';
        this.edgeSlices.forEach((s) => { s.style.opacity = '0'; });
        this.setEdgeKind('alive');
        this.frontImg.style.opacity = '0';
      }
    } else if (this.state === 'DEAD') {
      finalRotY = 180;
      finalRotX = 0;
      finalRotZ = 0;
      finalScale = 1.0;
      this.edgeSlices.forEach((s) => { s.style.opacity = '0'; });
      this.frontImg.style.opacity = '0';
      this.shadowImg.style.opacity = '0.18';
    } else if (this.state === 'REVIVING') {
      // The death spin played backwards: same length, same rotation (180° back to 24°), and the
      // alive face and edges only fade in once the token is past edge-on, so they never show over the dead face
      this.spinTimer += dt;
      const t = Math.min(1, this.spinTimer / this.spinDuration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const deathTime = this.spinDuration - this.spinTimer; // where the death spin would be

      if (deathTime <= 0.75 && !this.spinSoundTriggers.swapShadow) {
        this.spinSoundTriggers.swapShadow = true;
        this.shadowImg.src = this.textures.aliveShadow;
      }

      const fadeT = Math.min(1, Math.max(0, (deathTime - 0.4) / 0.25));
      this.frontImg.style.opacity = (1 - fadeT).toFixed(2);
      this._edgesForDeathTime(deathTime);

      finalRotY = 180 - (180 - 24) * ease;
      finalRotX = 6 * ease;
      finalRotZ = 0;
      finalScale = 1 + Math.sin(ease * Math.PI) * 0.12;
      this.shadowImg.style.opacity = `${0.18 + 0.20 * ease}`;

      if (t >= 1) {
        this.state = 'ALIVE';
        this.isFlipping = false;
        this.backImg.style.opacity = '';
        this.setEdgeKind('alive');
        this.edgeSlices.forEach((s) => { s.style.opacity = '1'; });
        this.frontImg.style.opacity = '1';
        this.shadowImg.style.opacity = '0.38';
      }
    } else {
      // ALIVE State
      this.shadowImg.style.opacity = '0.38';
    }

    // 5. Apply Transforms to 3D Token and Shadow
    const tokenTransform = `rotateY(${finalRotY.toFixed(2)}deg) rotateX(${finalRotX.toFixed(2)}deg) rotateZ(${finalRotZ.toFixed(2)}deg) scale(${finalScale.toFixed(3)})`;
    this.token3D.style.transform = tokenTransform;
    this.shadowImg.style.transform = tokenTransform;

    // 6. Handle Lineup Movement
    if (this.inFlight) {
      if (this.flightStart === null) {
        this.flightStart = now + this.flightDelay;
      }

      const elapsed = now - this.flightStart;
      const to = this.flightTo;

      if (elapsed <= 0) {
        const from = this.flightFrom;
        const tx = from.cx - to.slotCenterX;
        const ty = from.cy - to.slotCenterY;
        this.wrapper.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${from.k.toFixed(4)})`;
      } else {
        if (!this.flightLaunched) {
          this.flightLaunched = true;
          if (this.onStateChange) this.onStateChange(this, 'SOUND_SWISH');
        }
        const t = Math.min(1, elapsed / this.flightDur);
        // Smooth cubic ease in-out
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

        const mt = 1 - ease;
        const px = mt * mt * this.flightFrom.cx + 2 * mt * ease * this.flightCtrlX + ease * ease * to.cx;
        const py = mt * mt * this.flightFrom.cy + 2 * mt * ease * this.flightCtrlY + ease * ease * to.cy;
        const k = this.flightFrom.k + (to.k - this.flightFrom.k) * ease;

        const tx = px - to.slotCenterX;
        const ty = py - to.slotCenterY;

        this.wrapper.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${k.toFixed(4)})`;

        if (t >= 1) {
          this.inFlight = false;
          this.currentScale = to.k;
          this.wrapper.style.transform = (to.k === 1.0) ? '' : `scale(${to.k.toFixed(4)})`;
          this.wrapper.style.transition = '';
        }
      }
    }
  }

  destroy() {
    if (this.slot && this.slot.parentNode) {
      this.slot.parentNode.removeChild(this.slot);
    }
  }
}
