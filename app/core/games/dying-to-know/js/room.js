/* =========================================
   Procedural Static Noise Generator
   ========================================= */

class NoiseDirector {
  constructor(canvasTarget, fps = 15, contrast = 1.0) {
    this.canvas = typeof canvasTarget === 'string' ? document.querySelector(canvasTarget) : canvasTarget;
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.frames = [];
    this.currentFrame = 0;
    this.lastUpdate = 0;
    this.fps = fps; // Slower 6fps for eerie intro analog static
    this.contrast = contrast;
    this.width = 0;
    this.height = 0;

    this._generateNoisePatterns(10, 240, 240);
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _generateNoisePatterns(count, w, h) {
    for (let f = 0; f < count; f++) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const imgData = ctx.createImageData(w, h);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        // Slightly brighter analog static grain
        const n = Math.floor(Math.random() * 155 * this.contrast);
        data[i] = n;
        data[i + 1] = n;
        data[i + 2] = n;
        data[i + 3] = (Math.random() * 160 + 95) | 0;
      }
      ctx.putImageData(imgData, 0, 0);
      this.frames.push(c);
    }
  }

  _resize() {
    if (!this.canvas) return;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  update(now = performance.now()) {
    if (!this.canvas || this.frames.length === 0) return;
    if (now - this.lastUpdate > 1000 / this.fps) {
      this.lastUpdate = now;
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      const patternCanvas = this.frames[this.currentFrame];
      const ptrn = this.ctx.createPattern(patternCanvas, 'repeat');
      this.ctx.clearRect(0, 0, this.width, this.height);
      this.ctx.fillStyle = ptrn;
      this.ctx.fillRect(0, 0, this.width, this.height);
    }
  }
}

class RoomManager {
  constructor({ bgLayerEl, furnitureLayerEl, blackoutEl, lightingOverlayEl }) {
    this.bgLayer = bgLayerEl;
    this.furnitureLayer = furnitureLayerEl;
    this.blackout = blackoutEl;
    this.lightingOverlay = lightingOverlayEl;
    this.flickerEnabled = true;
    this.baseFlickerOpacity = 0.25;

    // Background & Intro Static Noise Directors
    this.noise = new NoiseDirector('#staticNoiseCanvas', 12, 0.35);
    this.introNoise = new NoiseDirector('#introNoiseCanvas', 11, 0.45); // Faint, subtle at 11fps

    this.backgrounds = [
      'assets/images/rooms/curtains.png',
      'assets/images/rooms/background.png',
      'assets/images/rooms/background-2.png',
      'assets/images/rooms/background-3.png',
      'assets/images/rooms/background-4.png'
    ];

    // Start on the curtains (lobby)
    this.currentBgIndex = 0;
    this.bgSlices = [];

    // Scrolling Physics
    this.BG_MAX_SPEED = 140;
    this.BG_ACCEL = 70;
    this.bgScrolling = false;
    this.bgSpeed = 0;
    this.bgOffset = 0;

    // Furniture Configuration
    this.FURNITURE_COUNT = 5;
    this.furnitureItems = [];
    this.furnitureSpawnTimer = 2;
    this.furnitureConfig = {
      'assets/images/table.png':  { bgs: [4], weight: 0.08, heightPct: 0.30 },
      'assets/images/chair.png':  { bgs: [4], weight: 0.28, heightPct: 0.30 },
      'assets/images/box.png':    { bgs: [4], weight: 0.18, heightPct: 0.15 },
      'assets/images/box-2.png':  { bgs: [4], weight: 0.14, heightPct: 0.15 },
      'assets/images/box-3.png':  { bgs: [4], weight: 0.14, heightPct: 0.15 },
    };

    this._initFurniture();
    this._initFlickerDirector();
    this.setupBackground();
  }

  getBgAspect(bgIdx) {
    const src = this.backgrounds[bgIdx] || '';
    return src.includes('background.png') ? (3288 / 6968) : (3844 / 6968);
  }

  getBgTileSrc(bgIdx, tileIndex) {
    const src = this.backgrounds[bgIdx] || '';
    if (src.includes('background-3.png')) {
      // Room 3 alternates door tile every 2 tiles
      return (Math.abs(tileIndex) % 2 === 1)
        ? 'assets/images/rooms/background-3-door.png'
        : 'assets/images/rooms/background-3.png';
    }
    return this.backgrounds[bgIdx];
  }

  setupBackground() {
    this.bgLayer.innerHTML = '';
    this.bgSlices = [];
    const aspect = this.getBgAspect(this.currentBgIndex);
    const tileWidth = window.innerHeight * aspect;
    if (tileWidth <= 0) return;

    const count = Math.ceil(window.innerWidth / tileWidth) + 3;

    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.className = 'bg-slice';
      img.alt = '';
      this.bgLayer.appendChild(img);
      this.bgSlices.push(img);
    }

    this.updateBgSlices();
    this.updateFurnitureVisibility();
  }

  updateBgSlices() {
    if (!this.bgSlices.length) return;
    const aspect = this.getBgAspect(this.currentBgIndex);
    const tileWidth = window.innerHeight * aspect;
    if (tileWidth <= 0) return;

    const count = this.bgSlices.length;
    const startIdx = Math.floor(this.bgOffset / tileWidth);
    const offsetX = this.bgOffset - startIdx * tileWidth;

    for (let i = 0; i < count; i++) {
      const tileIdx = startIdx + i;
      const slice = this.bgSlices[i];
      const targetSrc = this.getBgTileSrc(this.currentBgIndex, tileIdx);

      if (slice.dataset.tileIndex !== String(tileIdx) || slice.dataset.bgIndex !== String(this.currentBgIndex)) {
        slice.src = targetSrc;
        slice.dataset.tileIndex = String(tileIdx);
        slice.dataset.bgIndex = String(this.currentBgIndex);
      }

      const xPos = i * tileWidth - offsetX;
      slice.style.transform = `translateX(${xPos.toFixed(1)}px)`;
    }
  }

  toggleScrolling() {
    this.bgScrolling = !this.bgScrolling;
    return this.bgScrolling;
  }

  switchBackground(targetIndex = null) {
    if (targetIndex !== null) {
      this.currentBgIndex = targetIndex;
    } else {
      this.currentBgIndex = (this.currentBgIndex + 1) % this.backgrounds.length;
    }
    this.setupBackground();
  }

  switchBg(newIndex) {
    if (newIndex < 0 || newIndex >= this.backgrounds.length) return;
    this.currentBgIndex = newIndex;
    this.bgOffset = 0;
    this.updateBgSlices();
    this.updateFurnitureVisibility();
  }

  setBlackout(opacity) {
    if (this.blackout) {
      this.blackout.style.opacity = `${opacity}`;
    }
  }

  /* =========================================
     Ambient Lighting & Flicker Director
     ========================================= */

  _initFlickerDirector() {
    if (!this.lightingOverlay) return;

    const scheduleNextFlicker = () => {
      const delay = 2200 + Math.random() * 6500;
      setTimeout(() => {
        if (this.flickerEnabled && this.lightingOverlay) {
          this.triggerFlicker();
        }
        scheduleNextFlicker();
      }, delay);
    };

    scheduleNextFlicker();
  }

  triggerFlicker() {
    if (!this.lightingOverlay || !this.flickerEnabled) return;

    const flashes = 1 + Math.floor(Math.random() * 3);
    let stepTime = 0;

    for (let i = 0; i < flashes; i++) {
      const peakOpacity = 0.52 + Math.random() * 0.38; // 0.52 to 0.90
      const flashDuration = 35 + Math.random() * 55;

      setTimeout(() => {
        if (!this.flickerEnabled || !this.lightingOverlay) return;
        this.lightingOverlay.style.opacity = `${peakOpacity.toFixed(2)}`;
      }, stepTime);

      stepTime += flashDuration;

      const dipOpacity = (i === flashes - 1) ? this.baseFlickerOpacity : (0.16 + Math.random() * 0.18);
      setTimeout(() => {
        if (!this.flickerEnabled || !this.lightingOverlay) return;
        this.lightingOverlay.style.opacity = `${dipOpacity.toFixed(2)}`;
      }, stepTime);

      stepTime += 40 + Math.random() * 45;
    }

    setTimeout(() => {
      if (this.flickerEnabled && this.lightingOverlay) {
        this.lightingOverlay.style.opacity = `${this.baseFlickerOpacity}`;
      }
    }, stepTime + 40);
  }

  /* =========================================
     Furniture System
     ========================================= */

  _initFurniture() {
    if (!this.furnitureLayer) return;
    this.furnitureLayer.innerHTML = '';
    this.furnitureItems = [];

    for (let i = 0; i < this.FURNITURE_COUNT; i++) {
      const el = document.createElement('img');
      el.className = 'furniture';
      el.alt = '';
      this.furnitureLayer.appendChild(el);
      const item = { el, x: 0, scale: 1, type: null, flip: false, bottomPx: 0 };
      this.furnitureItems.push(item);
      this.spawnFurniture(item, false);
    }

    this.furnitureItems.forEach((item, i) => {
      item.x = (i / this.FURNITURE_COUNT) * window.innerWidth * 1.5 + Math.random() * (window.innerWidth / this.FURNITURE_COUNT) * 0.4;
      item.el.style.transform = this._applyFurniturePose(item);
    });

    this.updateFurnitureVisibility();
  }

  bgHasFurniture(bgIdx) {
    return Object.values(this.furnitureConfig).some((c) => c.bgs.includes(bgIdx));
  }

  updateFurnitureVisibility() {
    if (!this.furnitureLayer) return;
    this.furnitureLayer.style.display = this.bgHasFurniture(this.currentBgIndex) ? 'block' : 'none';
  }

  pickFurnitureType() {
    const allowed = Object.entries(this.furnitureConfig).filter(([, c]) => c.bgs.includes(this.currentBgIndex));
    if (!allowed.length) return null;
    const total = allowed.reduce((sum, [, c]) => sum + c.weight, 0);
    let r = Math.random() * total;
    for (const [type, c] of allowed) {
      r -= c.weight;
      if (r <= 0) return type;
    }
    return null;
  }

  pickBoxType() {
    const r = Math.random();
    if (r < 0.34) return 'assets/images/box.png';
    if (r < 0.67) return 'assets/images/box-2.png';
    return 'assets/images/box-3.png';
  }

  furnitureTooClose(x) {
    const minGap = window.innerWidth * 0.28;
    return this.furnitureItems.some((it) => it.type && Math.abs(it.x - x) < minGap);
  }

  spawnFurniture(item, offscreenRight) {
    item.type = this.pickFurnitureType();
    if (offscreenRight) {
      let tries = 0;
      do {
        item.x = window.innerWidth + 100 + Math.random() * window.innerWidth * 2;
        tries++;
      } while (this.furnitureTooClose(item.x) && tries < 20);
    } else {
      item.x = Math.random() * window.innerWidth * 2.2;
    }
    item.flip = Math.random() < 0.5;
    item.bottomPx = 0;
    const cfg = this.furnitureConfig[item.type] || { heightPct: 0.15 };
    item.el.src = item.type || (this.furnitureItems[0] ? this.furnitureItems[0].el.src : '');
    item.el.style.visibility = item.type ? 'visible' : 'hidden';
    item.el.style.height = `${Math.round(window.innerHeight * cfg.heightPct)}px`;
  }

  activateSlot(item, x, type, flip, bottomPx) {
    const cfg = this.furnitureConfig[type] || { heightPct: 0.15 };
    item.type = type;
    item.flip = flip;
    item.bottomPx = bottomPx || 0;
    item.x = x;
    item.el.src = type;
    item.el.style.visibility = 'visible';
    item.el.style.height = `${Math.round(window.innerHeight * cfg.heightPct)}px`;
  }

  // On-screen width of a furniture image (height comes from its config)
  furnitureWidth(type) {
    const cfg = this.furnitureConfig[type] || { heightPct: 0.15 };
    const aspect = { 'assets/images/chair.png': 1210 / 2161, 'assets/images/table.png': 2937 / 2196 }[type] || 1.05;
    return window.innerHeight * cfg.heightPct * aspect;
  }

  findHiddenSlot() {
    return this.furnitureItems.find((it) => !it.type);
  }

  spawnCluster(offscreenRight) {
    const roll = Math.random();

    if (roll < 0.3 && offscreenRight) {
      const boxes = Math.min(2 + Math.floor(Math.random() * 2), this.furnitureItems.filter((it) => !it.type).length);
      if (boxes < 1) return;
      let x = window.innerWidth + 100 + Math.random() * window.innerWidth;
      let tries = 0;
      while (this.furnitureTooClose(x) && tries < 20) {
        x = window.innerWidth + 100 + Math.random() * window.innerWidth;
        tries++;
      }
      const flip = Math.random() < 0.5;
      const h = window.innerHeight * (this.furnitureConfig['assets/images/box.png']?.heightPct || 0.15);
      let bottom = 0;
      for (let i = 0; i < boxes; i++) {
        const slot = this.findHiddenSlot();
        if (!slot) break;
        this.activateSlot(slot, x, this.pickBoxType(), flip, bottom);
        // Each box sits into the one below (their lids are thin flaps, so a full-height step looks like floating)
        bottom += h * 0.78;
      }
      return;
    }

    if (roll < 0.6 && offscreenRight) {
      const visible = this.furnitureItems.filter((it) => it.type);
      if (!visible.length) return;
      const anchor = visible[Math.floor(Math.random() * visible.length)];
      const slot = this.findHiddenSlot();
      if (!slot) return;
      const dir = Math.random() < 0.5 ? -1 : 1;
      let type = this.pickFurnitureType();
      if (!type) type = this.pickBoxType();
      // Leave a real gap between the two pieces based on their drawn widths
      const gap = (this.furnitureWidth(anchor.type) + this.furnitureWidth(type)) / 2 + 20 + Math.random() * 90;
      const x = anchor.x + dir * gap;
      this.activateSlot(slot, x, type, Math.random() < 0.5, 0);
      return;
    }

    const slot = this.findHiddenSlot();
    if (!slot) return;
    this.spawnFurniture(slot, true);
  }

  _applyFurniturePose(item) {
    item.el.style.bottom = `${Math.round(item.bottomPx || 0)}px`;
    return `translateX(${Math.round(item.x)}px) scaleX(${item.flip ? -1 : 1})`;
  }

  updateFurniture(dt) {
    if (!this.bgHasFurniture(this.currentBgIndex)) return;

    if (this.bgScrolling) {
      this.furnitureSpawnTimer -= dt;
      if (this.furnitureSpawnTimer <= 0) {
        this.furnitureSpawnTimer = 1.5 + Math.random() * 2.5;
        this.spawnCluster(true);
      }
    }

    for (const item of this.furnitureItems) {
      if (!item.type) continue;
      item.x -= this.bgSpeed * dt;
      const w = item.el.getBoundingClientRect().width || 150;
      if (item.x < -w) {
        item.type = null;
        item.el.style.visibility = 'hidden';
      }
      item.el.style.transform = this._applyFurniturePose(item);
    }
  }

  /**
   * Main Per-Frame Update for Room & Environment
   */
  update(dt, now = performance.now()) {
    if (this.noise) {
      this.noise.update(now);
    }
    if (this.introNoise) {
      this.introNoise.update(now);
    }

    const targetSpeed = this.bgScrolling ? this.BG_MAX_SPEED : 0;
    if (this.bgSpeed < targetSpeed) {
      this.bgSpeed = Math.min(targetSpeed, this.bgSpeed + this.BG_ACCEL * dt);
    } else {
      this.bgSpeed = Math.max(targetSpeed, this.bgSpeed - this.BG_ACCEL * dt);
    }

    this.bgOffset += this.bgSpeed * dt;

    if (this.bgOffset > 1000000) {
      const aspect = this.getBgAspect(this.currentBgIndex);
      const tileWidth = window.innerHeight * aspect;
      const cycleWidth = tileWidth * 2;
      this.bgOffset = this.bgOffset % cycleWidth;
    }

    this.updateBgSlices();
    this.updateFurniture(dt);
  }
}
