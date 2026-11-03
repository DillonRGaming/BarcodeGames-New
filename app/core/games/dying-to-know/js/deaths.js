/**
 * Deaths.js - Ways to die
 *
 * Each death is a self-contained effect on a letter's pixels: `makeX(letterCanvas)` returns
 * `{ step(dt), draw(ctx, x, y), done }`, drawn with the letter's top-left at (x, y). Nothing here knows
 * about players, so rip-test.html can run them on their own.
 */

/** Soft white dot: flames are stamped as heat, then coloured all together (see fireColours) */
let heatDot = null;
function getHeatDot() {
  if (heatDot) return heatDot;
  heatDot = document.createElement('canvas');
  heatDot.width = heatDot.height = 32;
  const g = heatDot.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return heatDot;
}

/** Heat 0..255 → flame colour and alpha: deep red at the thin edges, orange, yellow, white in the core */
const fireColours = (() => {
  const stops = [[0, 120, 10, 0, 0], [0.18, 200, 30, 0, 0.55], [0.4, 255, 100, 10, 0.9], [0.65, 255, 190, 50, 1], [0.9, 255, 245, 190, 1], [1, 255, 255, 255, 1]];
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 1;
    while (k < stops.length - 1 && stops[k][0] < v) k++;
    const a = stops[k - 1], b = stops[k], u = (v - a[0]) / (b[0] - a[0] || 1);
    for (let c = 1; c <= 4; c++) lut[i * 4 + c - 1] = (a[c] + (b[c] - a[c]) * u) * (c === 4 ? 255 : 1);
  }
  return lut;
})();

/** Smooth wobbly line: a few random sines, -1..1 */
function wobble(n, octaves = 4) {
  const waves = Array.from({ length: octaves }, (_, i) => ({ f: (i + 1) * (1.3 + Math.random()), p: Math.random() * 6.28, a: 1 / (i + 1) }));
  const sum = waves.reduce((s, w) => s + w.a, 0);
  return Array.from({ length: n }, (_, x) => waves.reduce((s, w) => s + Math.sin((x / n) * w.f * 6.28 + w.p) * w.a, 0) / sum);
}

/**
 * Burning: fire catches at the bottom and climbs the letter, which chars black behind a glowing edge.
 * It smoulders, then crumbles top-down into ash that the heat carries up and away, off screen.
 * `letter` is a canvas of the letter; `below` is how far its bottom is above the bottom of the screen,
 * where the fire starts: it climbs up from there and catches the letter.
 */
function makeBurn(letter, { below = 0 } = {}) {
  const w = letter.width, h = letter.height;
  const R = h / 125; // the effect is tuned for a 125px letter
  const src = letter.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const img = new ImageData(w, h), dst = img.data;
  const layer = document.createElement('canvas');
  layer.width = w; layer.height = h;
  const lctx = layer.getContext('2d');
  const edge = wobble(w).map((v) => v * 14 * R);       // ragged burn front
  const crumbleEdge = wobble(w, 5).map((v) => v * 18 * R);
  const grain = new Float32Array(w * h).map(() => Math.random());
  const gone = new Uint8Array(w * h);

  // Flames are drawn as heat into a low-res buffer around the letter (room above for them to rise),
  // then coloured through fireColours, so overlapping flames merge into tongues instead of blobs
  const S = Math.max(2, Math.round(R * 1.6)), padX = 40 * R, padTop = 140 * R;
  const fire = document.createElement('canvas');
  fire.width = Math.ceil((w + padX * 2) / S); fire.height = Math.ceil((h + padTop + below + 20 * R) / S);
  const fctx = fire.getContext('2d', { willReadFrequently: true });
  const solid = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (src[(y * w + x) * 4 + 3] > 140) solid.push(x, y);

  const flames = [], ash = [];
  const rise = below > 0 ? 0.9 : 0; // the fire climbing up from the bottom of the screen
  const T = { ignite: rise + 0.1, burnt: rise + 2.6, crumble: rise + 3.3, crumbled: rise + 5.0 };
  let t = 0;
  const fx = { done: false, step, draw };

  const ease = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const burnH = () => (1 - Math.pow(1 - ease(T.ignite, T.burnt), 1.6)) * (h + 30 * R) - 12 * R; // burnt height, from the bottom
  const crumbleD = () => ease(T.crumble, T.crumbled) ** 2 * (h + 40 * R) - 20 * R;            // crumbled depth, from the top

  function step(dt) {
    t += dt;
    const bh = burnH(), cd = crumbleD();
    const smoulder = 0.6 + 0.4 * Math.sin(t * 9) * Math.sin(t * 5.3);
    const heat = t < T.burnt ? 1 : Math.max(0, 1 - (t - T.burnt) / (T.crumbled - T.burnt));

    // 1. The letter: its colour → a glowing edge → char, minus whatever has crumbled
    for (let x = 0; x < w; x++) {
      const fy = h - (bh + edge[x]), cy = cd + crumbleEdge[x];
      for (let y = 0; y < h; y++) {
        const i = y * w + x, p = i * 4, a = src[p + 3];
        if (!a || gone[i]) { dst[p + 3] = 0; continue; }
        if (y < cy - grain[i] * 8 * R) { // crumbles into ash
          gone[i] = 1;
          dst[p + 3] = 0;
          if (a > 100 && grain[i] < 0.1 / (R * R)) {
            ash.push({ x, y, vx: (Math.random() - 0.3) * 30 * R, vy: -(10 + Math.random() * 30) * R, s: (0.8 + Math.random() * 1.4) * R,
              lift: (60 + Math.random() * 90) * R, hot: Math.random() < 0.08, life: 0, c: 30 + Math.random() * 40, ph: Math.random() * 6 });
          }
          continue;
        }
        let r = src[p], g = src[p + 1], b = src[p + 2];
        const d = y - fy + grain[i] * 3 * R; // > 0: below the front, burnt
        if (d > 0) {
          const char = Math.min(1, d / (10 * R));
          const cc = 12 + (r + g + b) / 3 * 0.2 + grain[i] * 20; // charred, flecked with grey; the face stays darker
          r += (cc + 6 - r) * char; g += (cc - g) * char; b += (cc - 6 - b) * char;
          const glow = Math.max(0, 1 - d / (5 * R)); // bright band right at the front
          const ember = grain[i] > 0.985 ? smoulder * (0.5 + heat * 0.5) * 0.8 : 0;
          const k = Math.max(glow, ember);
          r += (255 - r) * k; g += (120 + 80 * glow - g) * k; b += (20 - b) * k;
        } else if (d > -8 * R) { // scorching just ahead of the front
          const s = 1 + d / (8 * R);
          r *= 1 - s * 0.35; g *= 1 - s * 0.5; b *= 1 - s * 0.6;
        }
        dst[p] = r; dst[p + 1] = g; dst[p + 2] = b; dst[p + 3] = a;
      }
    }
    lctx.putImageData(img, 0, 0);

    // 2. Flames: thick along the climbing front, then flickering over the charred shape as they die down
    // Fire climbing from the bottom of the screen to the letter's feet, then dying out under it
    if (rise) {
      const k = Math.min(1, t / rise), top = h + below - (below + 6 * R) * (1 - (1 - k) ** 2);
      const under = 1 - ease(T.ignite, T.ignite + 1.2);
      for (let n = Math.round(30 * under); n > 0; n--) {
        // Mostly under the middle (a rough bell), and the front sags at the sides, so it's a tapering blaze
        const u = (Math.random() + Math.random() + Math.random()) / 3, x = -padX * 0.4 + u * (w + padX * 0.8);
        const side = Math.abs(u - 0.5) * 2, col = Math.max(0, Math.min(w - 1, x | 0));
        const front = top + side * side * 60 * R + edge[col] * 0.8 + 8 * R;
        const y = front + Math.random() ** 2 * (h + below - front + 10 * R); // thickest near the front
        flames.push({ x, y, vx: (Math.random() - 0.5) * 16 * R, vy: -(40 + Math.random() * 50) * R,
          life: 0, max: 0.4 + Math.random() * 0.5, size: (16 + Math.random() * 16) * R * (1 - side * 0.5) });
      }
    }
    if (t > T.ignite && heat > 0) {
      for (let k = Math.round(45 * heat); k > 0; k--) {
        const j = (Math.random() * solid.length / 2 | 0) * 2, x = solid[j], y = solid[j + 1];
        if (gone[y * w + x]) continue;
        const fy = h - (bh + edge[x]);
        if (y < fy - 6 * R) continue; // not burning there yet
        if (y > fy + 14 * R && Math.random() > 0.15) continue; // mostly at the front, a few over the char
        flames.push({ x, y, vx: (Math.random() - 0.5) * 16 * R, vy: -(40 + Math.random() * 50) * R, life: 0,
          max: 0.5 + Math.random() * 0.6, size: (16 + Math.random() * 16) * R * (y > fy + 25 * R ? 0.6 : 1) });
      }
    }
    for (let k = flames.length - 1; k >= 0; k--) {
      const f = flames[k];
      f.life += dt;
      if (f.life >= f.max) { flames.splice(k, 1); continue; }
      f.vy -= 120 * R * dt; // hot air speeds up as it rises
      f.x += (f.vx + Math.sin(t * 7 + f.y * 0.05 / R) * 14 * R) * dt; // the same sway for every flame at a height, so they lick together
      f.y += f.vy * dt;
    }

    // Stamp the heat, then colour it
    fctx.clearRect(0, 0, fire.width, fire.height);
    fctx.globalCompositeOperation = 'lighter';
    for (const f of flames) {
      const u = f.life / f.max, s = f.size * (1 - u * 0.6) / S;
      fctx.globalAlpha = Math.min(1, u * 6) * (1 - u) * 0.75;
      fctx.drawImage(getHeatDot(), (f.x + padX) / S - s * 0.35, (f.y + padTop) / S - s * 0.6, s * 0.7, s * 1.3);
    }
    const heatImg = fctx.getImageData(0, 0, fire.width, fire.height), hd = heatImg.data;
    for (let p = 0; p < hd.length; p += 4) {
      const v = (hd[p] * hd[p + 3] / 255) | 0, q = v * 4;
      hd[p] = fireColours[q]; hd[p + 1] = fireColours[q + 1]; hd[p + 2] = fireColours[q + 2]; hd[p + 3] = fireColours[q + 3];
    }
    fctx.putImageData(heatImg, 0, 0);

    // 3. Ash is carried up and away on the heat, fluttering, until it's off screen
    for (const f of ash) {
      f.life += dt;
      f.vy -= f.lift * dt;
      f.vx += 18 * R * dt; // a light draught to one side
      f.x += (f.vx + Math.sin(f.life * 5 + f.ph) * 16 * R) * dt;
      f.y += f.vy * dt;
    }
    // The letter trembles harder as the fire takes hold, and settles as it dies down;
    // the camera pushes in while it burns and pulls back out to watch the ash go (callers apply fx.zoom)
    const climb = ease(T.ignite, T.burnt);
    const shake = (t < T.burnt ? 0.5 + climb * 2.5 : 3 * (1 - ease(T.burnt, T.crumbled))) * R;
    fx.jx = (Math.random() - 0.5) * shake;
    fx.jy = (Math.random() - 0.5) * shake * 0.6;
    const zin = climb * climb * (3 - 2 * climb), zout = ease(T.crumble + 0.3, T.crumbled + 1.2);
    fx.zoom = 1 + 0.45 * zin * (1 - zout * zout * (3 - 2 * zout));
    fx.camJx = (Math.random() - 0.5) * shake * 0.5; // a little of it in the camera too
    fx.camJy = (Math.random() - 0.5) * shake * 0.5;

    // Done once the letter is gone and the last flake is well clear of the screen
    fx.done = t > T.crumbled + 0.5 && !flames.length && ash.every((f) => f.y < -2000 * R / 2.4 - h);
  }

  function draw(ctx, X, Y) {
    ctx.save();
    ctx.drawImage(layer, X + (fx.jx || 0), Y + (fx.jy || 0));
    for (const f of ash) {
      const glow = f.hot && f.life < 1.2 ? 1 - f.life / 1.2 : 0;
      ctx.fillStyle = glow ? `rgb(255,${110 + 60 * glow | 0},30)` : `rgb(${f.c | 0},${f.c - 4 | 0},${f.c - 8 | 0})`;
      ctx.fillRect(X + f.x, Y + f.y, f.s, f.s);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fire, X - padX, Y - padTop, fire.width * S, fire.height * S);
    ctx.restore();
  }

  return fx;
}

/** Jagged bolt from a to b: midpoint displacement, `rough` as a share of the length */
function boltPath(ax, ay, bx, by, rough = 0.22, depth = 6) {
  let pts = [[ax, ay], [bx, by]];
  let off = Math.hypot(bx - ax, by - ay) * rough;
  for (let d = 0; d < depth; d++, off /= 2) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1, k = (Math.random() - 0.5) * 2 * off;
      next.push([(x1 + x2) / 2 + nx / l * k, (y1 + y2) / 2 + ny / l * k], pts[i]);
    }
    pts = next;
  }
  return pts;
}

/** Stroke a bolt as a wide blue glow, then a thin white-hot core */
function drawBolt(ctx, pts, X, Y, width, alpha) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(X + x, Y + y) : ctx.moveTo(X + x, Y + y)));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.globalAlpha = alpha * 0.35;
  ctx.strokeStyle = '#4aa8ff';
  ctx.lineWidth = width * 5;
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.7;
  ctx.strokeStyle = '#a8dcff';
  ctx.lineWidth = width * 2;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = width * 0.8;
  ctx.stroke();
}

/** Smooth tiling value noise, `n`×`n`, 0..1: for breaking smoke into wisps */
function smoothNoise(n = 64, cells = 8) {
  const g = Array.from({ length: cells * cells }, () => Math.random());
  const at = (i, j) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const fx = x / n * cells, fy = y / n * cells, i = fx | 0, j = fy | 0;
    let u = fx - i, v = fy - j;
    u = u * u * (3 - 2 * u); v = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u, b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    out[y * n + x] = a + (b - a) * v;
  }
  return out;
}

/**
 * Volumetric smoke: puffs are stamped as density into a low-res buffer, broken up by two layers of noise
 * drifting upwards, then lit from above (brighter where the density rises towards the top, darker in
 * the thick of it), so it reads as rolling, shaded smoke instead of flat circles.
 */
function makeSmoke(w, h, R, { padX = 70, padTop = 240 } = {}) {
  const S = Math.max(2, Math.round(R * 1.5)), px = padX * R, pt = padTop * R;
  const buf = document.createElement('canvas');
  buf.width = Math.ceil((w + px * 2) / S); buf.height = Math.ceil((h + pt) / S);
  const bctx = buf.getContext('2d', { willReadFrequently: true });
  const N = 64, n1 = smoothNoise(N, 6), n2 = smoothNoise(N, 14);
  const puffs = [];
  let time = 0;
  const dot = getHeatDot();
  return {
    puffs,
    add(x, y, size, vx = 0, vy = -30) {
      puffs.push({ x, y, vx: vx * R, vy: vy * R, s: size * R, life: 0, max: 2.2 + Math.random() * 1.4 });
    },
    step(dt) {
      time += dt;
      for (let k = puffs.length - 1; k >= 0; k--) {
        const p = puffs[k];
        if ((p.life += dt) >= p.max) { puffs.splice(k, 1); continue; }
        p.vx *= 1 - dt * 0.6;
        p.x += (p.vx + Math.sin(p.life * 1.7 + p.s) * 8 * R) * dt;
        p.y += p.vy * dt;
        p.vy *= 1 - dt * 0.25; // slows as it cools
      }
      bctx.clearRect(0, 0, buf.width, buf.height);
      if (!puffs.length) return;
      bctx.globalCompositeOperation = 'lighter';
      for (const p of puffs) {
        const u = p.life / p.max, s = p.s * (1 + u * 3) / S;
        bctx.globalAlpha = Math.min(1, u * 4) * (1 - u) * 0.5;
        bctx.drawImage(dot, (p.x + px) / S - s, (p.y + pt) / S - s, s * 2, s * 2);
      }
      const W = buf.width, H = buf.height, img = bctx.getImageData(0, 0, W, H), d = img.data;
      const dens = new Float32Array(W * H);
      const o1 = time * 10, o2 = time * 22; // noise drifts up, the fine layer faster
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, raw = d[i * 4] * d[i * 4 + 3] / 65025;
        if (!raw) continue;
        const a = n1[((y + o1 | 0) % N) * N + (x % N)], b = n2[((y + o2 | 0) % N) * N + (x % N)];
        dens[i] = Math.max(0, raw * (0.25 + a * 1.1) * (0.6 + b * 0.8) - 0.04);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, v = dens[i], q = i * 4;
        if (v <= 0) { d[q + 3] = 0; continue; }
        const up = y > 3 ? dens[i - W * 3] : 0;
        const lit = Math.max(0, Math.min(1, 0.45 + (v - up) * 1.8 - v * 0.4)); // tops catch the light, the thick middle stays dark
        const c = 28 + lit * 110;
        d[q] = c; d[q + 1] = c; d[q + 2] = c + 6;
        d[q + 3] = Math.min(1, v * 1.8) * 235;
      }
      bctx.putImageData(img, 0, 0);
    },
    draw(ctx, X, Y) {
      if (!puffs.length) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.filter = `blur(${S * 0.8}px)`; // soft edges, no pixel steps
      ctx.drawImage(buf, X - px, Y - pt, buf.width * S, buf.height * S);
      ctx.restore();
    },
  };
}

/**
 * Electrocution: sparks crackle round the letter, then lightning strikes it from the top of the screen
 * and keeps re-striking while arcs crawl over it. It convulses, flickering between itself, white-hot and
 * an x-ray of its skeleton, blackening as it goes. The current cuts out; it's left scorched and smoking,
 * then fades away. `above` is how far the letter's top is below the top of the screen; `bones` is an
 * optional canvas (same size as the letter) of its skeleton for the x-ray frames.
 * Callers apply fx.zoom, fx.camJx/camJy and fx.flash (a white flash over everything, 0..1).
 */
function makeShock(letter, { above = 400, bones = null } = {}) {
  const w = letter.width, h = letter.height;
  const R = h / 125;
  const src = letter.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const solid = [];
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) if (src[(y * w + x) * 4 + 3] > 140) solid.push([x, y]);
  const pick = () => solid[Math.random() * solid.length | 0];
  const topPts = solid.filter(([, y]) => y < h * 0.35);

  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  // White-hot: the letter's shape, glowing
  const hot = mk(), hctx = hot.getContext('2d');
  hctx.drawImage(letter, 0, 0);
  hctx.globalCompositeOperation = 'source-atop';
  hctx.fillStyle = 'rgba(225,245,255,0.92)';
  hctx.fillRect(0, 0, w, h);
  // X-ray: a dark blue silhouette with the bones glowing through
  const xray = mk(), xctx = xray.getContext('2d');
  xctx.drawImage(letter, 0, 0);
  xctx.globalCompositeOperation = 'source-atop';
  xctx.fillStyle = '#0c2440';
  xctx.fillRect(0, 0, w, h);
  if (bones) { xctx.globalAlpha = 0.95; xctx.drawImage(bones, 0, 0); }
  // Scorched: the letter, blackening with `burnt`
  const body = mk(), bctx = body.getContext('2d');

  const T = { charge: 0.5, strike: 0.5, cut: 2.9, fadeFrom: 4.0, end: 5.0 };
  let t = 0, nextStrike = T.strike, nextArc = 0;
  const bolts = [], arcs = [], sparks = [];
  const smoke = makeSmoke(w, h, R);
  const fx = { done: false, step, draw, zoom: 1, flash: 0, camJx: 0, camJy: 0, jx: 0, jy: 0, mode: 'normal' };
  const ease = (a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

  function spark(x, y, n, speed = 160) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.28, v = (0.3 + Math.random()) * speed * R;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40 * R, life: 0, max: 0.25 + Math.random() * 0.4 });
    }
  }

  function step(dt) {
    t += dt;
    const live = t >= T.strike && t < T.cut;

    // Charging: little sparks jump across the letter before the strike
    if (t < T.strike && Math.random() < dt * 14) {
      const [x, y] = pick(), a = Math.random() * 6.28, l = (8 + Math.random() * 14) * R;
      arcs.push({ pts: boltPath(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, 0.4, 3), life: 0, max: 0.06 });
    }

    // The strike, and re-strikes while the current runs: from the top of the screen into the top of the letter
    if (live && t >= nextStrike) {
      const [ex, ey] = topPts[Math.random() * topPts.length | 0] || pick();
      const sx = ex + (Math.random() - 0.5) * 160 * R;
      const main = boltPath(sx, -above - 20 * R, ex, ey, 0.18, 7);
      const branches = [];
      for (let b = 0; b < 3; b++) {
        const from = main[(main.length * (0.2 + Math.random() * 0.5)) | 0], a = Math.PI / 2 + (Math.random() - 0.5) * 1.6, l = (40 + Math.random() * 80) * R;
        branches.push(boltPath(from[0], from[1], from[0] + Math.cos(a) * l, from[1] + Math.sin(a) * l, 0.3, 5));
      }
      bolts.push({ main, branches, life: 0, max: 0.09 + Math.random() * 0.05 });
      fx.flash = Math.max(fx.flash, nextStrike === T.strike ? 1 : 0.35 + Math.random() * 0.3);
      spark(ex, ey, nextStrike === T.strike ? 40 : 12, nextStrike === T.strike ? 260 : 160);
      nextStrike = t + 0.07 + Math.random() * 0.16;
    }
    // Arcs crawling over the letter while the current runs
    if (live && t >= nextArc) {
      const [x1, y1] = pick(), [x2, y2] = pick();
      arcs.push({ pts: boltPath(x1, y1, x2, y2, 0.3, 5), life: 0, max: 0.05 + Math.random() * 0.05 });
      nextArc = t + 0.02 + Math.random() * 0.04;
    }
    // The cut-out: one last bang, then sparks raining and smoke
    if (t >= T.cut && !fx.cutDone) {
      fx.cutDone = true;
      fx.flash = 1;
      for (let k = 0; k < 8; k++) { const [x, y] = pick(); spark(x, y, 6, 200); }
    }
    // Smoke pours off the scorched letter, thickest right after the cut-out
    if (t > T.cut && t < T.end - 0.6 && Math.random() < dt * 22 * (1 - ease(T.cut, T.end) * 0.7)) {
      const [x, y] = pick();
      smoke.add(x, y, 10 + Math.random() * 10, (Math.random() - 0.4) * 12, -(25 + Math.random() * 30));
    }
    smoke.step(dt);

    for (const list of [bolts, arcs]) for (let k = list.length - 1; k >= 0; k--) if ((list[k].life += dt) >= list[k].max) list.splice(k, 1);
    for (let k = sparks.length - 1; k >= 0; k--) {
      const p = sparks[k];
      if ((p.life += dt) >= p.max) { sparks.splice(k, 1); continue; }
      p.vy += 500 * R * dt;
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }

    // What the letter looks like this frame: flickering while the current runs
    const roll = Math.random();
    fx.mode = live ? (roll < 0.3 ? 'xray' : roll < 0.5 ? 'hot' : 'normal') : t < T.strike && roll < 0.08 ? 'hot' : 'normal';
    fx.burnt = 0.85 * ease(T.strike, T.cut);
    fx.alpha = 1 - ease(T.fadeFrom, T.end);

    // Convulsing while the current runs, a few twitches after
    const shake = (live ? 9 : t < T.strike ? 1.2 * ease(0, T.strike) : 3 * (1 - ease(T.cut, T.cut + 0.8))) * R;
    fx.jx = (Math.random() - 0.5) * shake;
    fx.jy = (Math.random() - 0.5) * shake * 0.7;
    fx.camJx = (Math.random() - 0.5) * shake * 0.6;
    fx.camJy = (Math.random() - 0.5) * shake * 0.6;
    const zin = ease(0, T.strike + 0.6), zout = ease(T.cut + 0.6, T.end);
    fx.zoom = 1 + 0.35 * (zin * zin * (3 - 2 * zin)) * (1 - zout * zout * (3 - 2 * zout));
    fx.flash = Math.max(0, fx.flash - dt * 6);
    fx.done = t >= T.end && !sparks.length && !smoke.puffs.length;
  }

  function draw(ctx, X, Y) {
    ctx.save();
    const lx = X + fx.jx, ly = Y + fx.jy;
    if (fx.alpha > 0) {
      ctx.globalAlpha = fx.alpha;
      if (fx.mode === 'xray') ctx.drawImage(xray, lx, ly);
      else if (fx.mode === 'hot') ctx.drawImage(hot, lx, ly);
      else {
        bctx.clearRect(0, 0, w, h);
        bctx.globalCompositeOperation = 'source-over';
        bctx.drawImage(letter, 0, 0);
        bctx.globalCompositeOperation = 'source-atop';
        bctx.fillStyle = `rgba(14,10,8,${fx.burnt})`;
        bctx.fillRect(0, 0, w, h);
        ctx.drawImage(body, lx, ly);
      }
    }
    ctx.globalAlpha = 1;
    smoke.draw(ctx, X, Y);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bolts) {
      const a = 1 - b.life / b.max;
      drawBolt(ctx, b.main, X, Y, 2.2 * R, a);
      b.branches.forEach((br) => drawBolt(ctx, br, X, Y, 1.1 * R, a * 0.8));
    }
    for (const a of arcs) drawBolt(ctx, a.pts, lx, ly, 0.9 * R, 1 - a.life / a.max);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2 * R;
    ctx.strokeStyle = '#cfeaff';
    for (const p of sparks) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.beginPath(); ctx.moveTo(X + (p.px ?? p.x), Y + (p.py ?? p.y)); ctx.lineTo(X + p.x, Y + p.y); ctx.stroke();
    }
    ctx.restore();
  }

  return fx;
}

const DEATHS = { burn: makeBurn, shock: makeShock };
