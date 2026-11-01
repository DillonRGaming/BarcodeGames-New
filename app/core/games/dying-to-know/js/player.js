/**
 * Player.js - Custom 3D Character Controller
 * 
 * Provides procedural continuous harmonic motion (jitter-free wiggling),
 * 3D extrusion slicing, state-machine flips, lineup arcs, and blink handling.
 */

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

    // Hover effect via wrapper transition
    this.slot.addEventListener('mouseenter', () => {
      if (!this.inFlight && this.isVisible) {
        const s = this.currentScale * 1.06;
        this.wrapper.style.transform = `scale(${s.toFixed(4)})`;
        this.wrapper.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }
    });

    this.slot.addEventListener('mouseleave', () => {
      if (!this.inFlight && this.isVisible) {
        this.wrapper.style.transform = (this.currentScale === 1.0) ? '' : `scale(${this.currentScale.toFixed(4)})`;
        this.wrapper.style.transition = 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)';
      }
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
      }
      this.token3D.insertBefore(fragment, this.frontImg);
      this.isExtrusionLoaded = true;
    });
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
    this.spinType = 'DEATH';
    this.spinDuration = 1.5;
    this.spinTimer = 0;
    this.spinProgress = 0;
    this.spinSoundTriggers = { whoosh: false, ghost: false, bell: false, swapShadow: false };

    // Reset front texture in case it was blinking
    this.frontImg.src = this.textures.front;
  }

  startReviveSpin() {
    this.isFlipping = true;
    this.state = 'REVIVING';
    this.spinType = 'REVIVE';
    this.spinDuration = 0.85;
    this.spinTimer = 0;
    this.spinProgress = 0;
    this.spinSoundTriggers = { swapShadow: false };

    // Reset edge slices visibility
    this.edgeSlices.forEach((s) => { s.style.opacity = '1'; });
    this.frontImg.style.opacity = '1';
  }

  /**
   * Start smooth lineup flight trajectory
   */
  startFlight({ from, to, delay, dur = 850, now = performance.now() }) {
    this.inFlight = true;
    this.flightStart = now + delay;
    this.flightDelay = delay;
    this.flightDur = dur;
    this.flightFrom = from; // { cx, cy, k }
    this.flightTo = to;     // { cx, cy, k, slotCenterX, slotCenterY }
    this.flightLaunched = false;

    // Pure vertical parabolic arc control point (Zero sideways tilt or random jitter)
    this.flightCtrlX = (from.cx + to.cx) / 2;
    this.flightCtrlY = Math.min(from.cy, to.cy) - Math.max(50, Math.abs(from.cy - to.cy) * 0.45);

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

  clearResult(baseScale = 0.72) {
    if (this.resultBadgeEl) {
      this.resultBadgeEl.className = 'player-result-badge';
    }
    this.slot.style.opacity = '1.0';
    this.currentScale = baseScale;
    this.wrapper.style.transition = 'none';
    this.wrapper.style.transform = (baseScale === 1.0) ? '' : `scale(${baseScale.toFixed(4)})`;
  }

  /**
   * Trigger character eye blink
   */
  blink(doubleBlinkChance = 0.28) {
    if (!this.isAlive()) return;
    this.frontImg.src = this.textures.blink;
    setTimeout(() => {
      if (!this.isAlive()) return;
      this.frontImg.src = this.textures.front;
      if (Math.random() < doubleBlinkChance) {
        setTimeout(() => {
          if (!this.isAlive()) return;
          this.frontImg.src = this.textures.blink;
          setTimeout(() => {
            if (this.isAlive()) this.frontImg.src = this.textures.front;
          }, 110);
        }, 70);
      }
    }, 130);
  }

  /**
   * Show baked eyes texture during blackout transition
   */
  setEyesMode(active) {
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
      if (this.spinTimer >= 0.55) {
        // Smooth fade of 3D extrusion edge slices as token turns edge-on (0.55s to 0.85s)
        const fadeT = Math.min(1, Math.max(0, (this.spinTimer - 0.55) / 0.3));
        const op = (1 - fadeT).toFixed(2);
        this.edgeSlices.forEach((s) => { s.style.opacity = op; });
        this.frontImg.style.opacity = op;
      }
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
        this.edgeSlices.forEach((s) => { s.style.opacity = '0'; });
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
      this.spinTimer += dt;
      const t = Math.min(1, this.spinTimer / this.spinDuration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      if (this.spinTimer >= 0.425 && !this.spinSoundTriggers.swapShadow) {
        this.spinSoundTriggers.swapShadow = true;
        this.shadowImg.src = this.textures.aliveShadow;
      }

      // Fade in front and edge slices
      const fadeT = Math.min(1, this.spinTimer / 0.5);
      const op = fadeT.toFixed(2);
      this.edgeSlices.forEach((s) => { s.style.opacity = op; });
      this.frontImg.style.opacity = op;

      // Rotate from 180 to 384 (which is 24 + 360)
      finalRotY = 180 + (384 - 180) * ease;
      finalRotX = 6 * ease;
      finalRotZ = 0;
      finalScale = 1 + Math.sin(ease * Math.PI) * 0.12;
      this.shadowImg.style.opacity = `${0.18 + 0.20 * ease}`;

      if (t >= 1) {
        this.state = 'ALIVE';
        this.isFlipping = false;
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
