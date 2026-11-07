/**
 * The phone's screen as a little three.js scene: the sky the TV's camera rises into between rounds
 * (app/core/games/articulate-3d/js/market.js), a sea of billowing cloud below, drifting slowly. When there's something
 * to draw (their self-portrait in the lobby, the word on their turn) a sheet of paper in the player's colour hangs in
 * front of it, drawn as a flat overlay so the pen lands exactly where the finger is.
 *
 *   const stage = await mountStage(container);
 *   stage.setColour('#e0584c'); stage.showPaper(true); stage.board → the DrawBoard on the paper; stage.changed()
 *   stage.onDraw = { down(x, y), move(x, y), up() } with x in 0..1000, y in 0..1000*DrawBoard.PORTRAIT on the paper
 */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';

const SKY = { top: '#6a9be0', mid: '#9cc4ef', low: '#dcebf7' }; // the TV's sky, as it comes out after the TV's tone mapping
const CLOUDS = { count: 260, y0: -7, y1: -2.4, z0: -70, z1: -4, drift: 0.5 }; // drift: metres a second to the right, forever (the clouds wrap round off-screen)

// seeded, so the clouds are the same every time
const rnd = (() => { let s = 4242421; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const range = (a, b) => a + rnd() * (b - a);

/** a billow of cloud painted from a density field and lit from above (the TV's cloud deck uses the same painting) */
function billow() {
  const S = 160, seed = rnd() * 100;
  const hash = (x, y, k) => { const h = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, y, k) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, k), b = hash(xi + 1, yi, k), c = hash(xi, yi + 1, k), d = hash(xi + 1, yi + 1, k);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y) => { let f = 0, amp = 0.5; for (let o = 0; o < 5; o++) { f += amp * vnoise(x, y, seed + o * 13); x *= 2.03; y *= 2.03; amp *= 0.5; } return f; };
  const density = (x, y) => {
    const dx = (x - S / 2) / (S * 0.42), dy = (y - S * 0.55) / (S * 0.36);
    return Math.max(0, Math.min(1, (1 - Math.sqrt(dx * dx + dy * dy)) * 1.5 + (fbm(x / 18, y / 18) - 0.5) * 1.1));
  };
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), px = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = density(x, y);
    if (d <= 0.01) continue;
    let shade = 0;
    for (let k = 1; k <= 5; k++) shade += density(x - k * 2.5, y - k * 6); // towards the sun, above and a little left
    const t = Math.exp(-shade * 0.45) * (1 - Math.max(0, (y - S * 0.5) / (S * 0.5)) * 0.35);
    const i = (y * S + x) * 4;
    px[i] = 160 + 95 * t; px[i + 1] = 172 + 82 * t; px[i + 2] = 200 + 52 * t;
    px[i + 3] = 255 * Math.min(1, d * 2.6);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
}

export async function mountStage(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  Object.assign(renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  container.appendChild(renderer.domElement);

  // the sky and the clouds, seen from just above the deck
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 200);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, -1.2, -10);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(SKY.top) }, mid: { value: new THREE.Color(SKY.mid) }, low: { value: new THREE.Color(SKY.low) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: `uniform vec3 top, mid, low; varying vec2 vUv;
      void main(){
        vec3 c = mix(low, mid, smoothstep(0.2, 0.6, vUv.y));
        c = mix(c, top, smoothstep(0.6, 1.0, vUv.y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  const looks = Array.from({ length: 5 }, billow), card = new THREE.PlaneGeometry(1, 1), clouds = [];
  for (let i = 0; i < CLOUDS.count; i++) {
    const m = new THREE.Mesh(card, looks[i % looks.length]), w = range(5, 12);
    m.scale.set(w * (rnd() < 0.5 ? -1 : 1), w * range(0.75, 1), 1);
    // spread only as wide as the view is at that depth (a phone's view is narrow), so the deck stays thick
    const z = range(CLOUDS.z0, CLOUDS.z1), half = -z * 0.55 + 4;
    m.position.set(range(-half, half), range(CLOUDS.y0, CLOUDS.y1), z);
    m.userData.half = half + 6;
    clouds.push(m); scene.add(m);
  }

  // the paper, drawn over it all in screen pixels
  const overlay = new THREE.Scene();
  const flatCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const square = document.createElement('canvas'), board = new DrawBoard(square, DrawBoard.PORTRAIT), ASPECT = DrawBoard.PORTRAIT;
  const paperCanvas = document.createElement('canvas');
  const paperTex = new THREE.CanvasTexture(paperCanvas); paperTex.colorSpace = THREE.SRGBColorSpace; paperTex.anisotropy = 4;

  // the name board, built like the TV's "join at" sign (market.js): wood frame with the weathered-planks scan, two iron
  // wires up off the top, a near-black face. The scans are shrunk copies of the TV's, shaded the same way.
  const signScene = new THREE.Scene();
  const signCam = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  const sun = new THREE.DirectionalLight('#fff3e2', 2.4); sun.position.set(-1, 2, 2);
  signScene.add(new THREE.HemisphereLight('#bcd2f2', '#b8a48c', 1.6), sun);
  const SIGN = { f: 0.016, z: -1, ratio: 5 }; // board width : height
  let sign = null, signName = '';

  const loadScan = async (name) => {
    const load = async (kind, isColour) => {
      const blob = await (await fetch(new URL(`assets/${name}_${kind}.jpg`, import.meta.url))).blob();
      const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
      t.colorSpace = isColour ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
      return { t, bmp };
    };
    const [d, n] = await Promise.all([load('diff', true), load('nor', false)]);
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.drawImage(d.bmp, 0, 0, 8, 8);
    const px = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; }
    return { map: d.t, normalMap: n.t, avg: new THREE.Color().setRGB(r / 16320, gg / 16320, b / 16320, THREE.SRGBColorSpace) };
  };
  // the scan as detail around the piece's own colour (market.js surfaceMaterial)
  const surface = (scan, colour, { amount, bump, rough }) => {
    const m = new THREE.MeshStandardMaterial({ color: colour, roughness: rough, metalness: 0, map: scan.map, normalMap: scan.normalMap });
    m.normalScale.set(bump, bump);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailAvg = { value: scan.avg };
      sh.uniforms.detailAmount = { value: amount };
      sh.fragmentShader = 'uniform vec3 detailAvg; uniform float detailAmount;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        vec3 detail = texture2D( map, vMapUv ).rgb / max( detailAvg, vec3( 0.03 ) );
        diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( detail, 0.0, 2.2 ), detailAmount );`);
    };
    m.customProgramCacheKey = () => 'detail';
    return m;
  };
  // box-projected texture coordinates in metres, like market.js put()
  const project = (geo, perMetre, ox, oy) => {
    const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      const u = ay >= ax && ay >= az ? p.getX(i) : ax >= az ? p.getZ(i) : p.getX(i);
      const v = ay >= ax && ay >= az ? p.getZ(i) : p.getY(i);
      uv[i * 2] = u * perMetre + ox; uv[i * 2 + 1] = v * perMetre + oy;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  };
  const mats = Promise.all([loadScan('weathered_planks'), loadScan('metal_plate')]).then(([w, i]) => ({
    wood: surface(w, '#a87547', { amount: 0.8, bump: 0.7, rough: 0.85 }),
    iron: surface(i, '#2e2a2c', { amount: 0.5, bump: 0.5, rough: 0.6 }),
  }));

  function signSize() {
    const top = Math.tan(THREE.MathUtils.degToRad(signCam.fov / 2)) * -SIGN.z;
    // every board is this wide, on every screen: as wide as fits the tallest stack (sign, paper, tool bar, with their gaps)
    const W = Math.min(top * 2 * signCam.aspect * 0.86, 0.6, (2 * top - 2 * 0.045 - 2 * 0.075) / (1 / SIGN.ratio + ASPECT + 0.57));
    return { top, W, H: W / SIGN.ratio };
  }
  function placeSign() {
    if (!sign) return;
    const { top, H } = signSize();
    sign.position.set(0, top - 0.045 - H / 2, SIGN.z);
  }

  /** a board like the join sign: wood frame, near-black face (`tex`), and iron wires of `wire` metres up off the top */
  function frame(W, H, tex, wire, wood, iron) {
    const { f } = SIGN, grp = new THREE.Group();
    grp.userData.board = true;
    const add = (geo, mat, x, y, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); grp.add(m); };
    const t = () => [Math.random() * 7, Math.random() * 7];
    for (const k of [-1, 1]) {
      add(project(new THREE.BoxGeometry(W + f * 2, f, 0.035), 1.1, ...t()), wood, 0, k * (H / 2 + f / 2));
      add(project(new THREE.BoxGeometry(f, H, 0.035), 1.1, ...t()), wood, k * (W / 2 + f / 2), 0);
      if (wire > 0) add(project(new THREE.CylinderGeometry(0.006, 0.006, wire, 6), 2, ...t()), iron, k * W * 0.36, H / 2 + f + wire / 2);
    }
    add(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), 0, 0, 0.001);
    return grp;
  }
  const disposeGroup = (grp, wood, iron) => grp.traverse((m) => { m.geometry?.dispose(); m.material?.map && m.material !== wood && m.material !== iron && m.material.map.dispose(); });


  /* ---------- changing screens: the old boards are pulled up off the top on their wires; then the new ones, the name
     sign first, are lowered back down one after another, slowing as they settle ---------- */

  const anims = []; // { g, base, z0, kind: 'in' | 'out', t0, dur, from }
  let transitionUntil = 0, arriveAt = 0;
  const nowS = () => performance.now() / 1000;
  const inTransition = () => nowS() < transitionUntil;
  const boardsOf = (grp) => (grp.userData.board ? [grp] : grp.children.filter((c) => c.userData.board));
  const hasBoards = () => signScene.children.some((c) => c.userData.board || c.children.some((k) => k.userData.board));
  /** the boards of a group, lowering in from above: the higher a board hangs, the sooner it comes down */
  function enterGroup(grp) {
    if (!inTransition()) return;
    const { top } = signSize(), D = top * 2, t = Math.max(nowS(), arriveAt) + (grp === sign ? 0 : 0.5); // the name comes first, the rest wait a little
    boardsOf(grp).forEach((g) => {
      const base = g.position.y;
      g.position.y = base + D;
      anims.push({ g, base, z0: g.position.z, kind: 'in', t0: t + (top - base) * 0.9, dur: 1.1, from: D });
    });
  }
  /** takes a group's boards away (pulled up, the lowest first), then frees it */
  function retire(grp, wood, iron) {
    const done = () => { signScene.remove(grp); disposeGroup(grp, wood, iron); };
    if (!inTransition()) return done();
    const { top } = signSize(), D = top * 2, t = nowS();
    let end = t;
    boardsOf(grp).forEach((g) => {
      const t0 = t + (g.position.y + top) * 0.12;
      anims.push({ g, base: g.position.y, z0: g.position.z, kind: 'out', t0, dur: 0.45, from: D });
      end = Math.max(end, t0 + 0.45);
    });
    setTimeout(done, (end - t) * 1000 + 50);
  }
  function stepAnims(now) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i], u = (now - a.t0) / a.dur;
      if (u < 0) continue;
      // while one is away from its place it travels a little behind the others, so it slides behind the sign, not over it
      const behind = () => { a.g.position.z = a.z0 - 0.04 * Math.min(1, Math.abs(a.g.position.y - a.base) / 0.15); };
      if (a.kind === 'out') {
        a.g.position.y = a.base + a.from * Math.min(1, u) ** 2; behind(); // quickening upward
        if (u >= 1) anims.splice(i, 1);
      } else if (u < 1) {
        a.g.position.y = a.base + a.from * (1 - u) ** 3; behind(); // slowing as it settles
      } else {
        a.g.position.y = a.base; a.g.position.z = a.z0;
        anims.splice(i, 1);
      }
    }
  }

  let signToken = 0;
  async function buildSign(name) {
    const token = ++signToken;
    try { await document.fonts.load('700 100px "Cafe Francoise"'); } catch { /* falls back to sans-serif */ }
    const { wood, iron } = await mats;
    if (token !== signToken) return;
    if (sign) { signScene.remove(sign); disposeGroup(sign, wood, iron); sign = null; } // the sign stays up between screens; a new text just swaps in
    if (!name) return;
    const { W, H } = signSize();
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = 1024; c.height = Math.round(1024 * H / W);
    let px = Math.round(c.height * 0.7);
    const font = () => { g.font = `700 ${px}px "Cafe Francoise", sans-serif`; };
    font();
    while (g.measureText(name).width > c.width - 80 && px > 20) { px -= 4; font(); }
    g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.globalAlpha = 0.95;
    g.fillText(name, c.width / 2, c.height / 2 + 4);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const grp = frame(W, H, tex, 1.2, wood, iron);
    sign = grp; signScene.add(sign); placeSign(); enterGroup(sign);
  }


  /* ---------- guessing: two more boards in the sign's style (what you've guessed, and a line to write the next) ---------- */

  const CHALK = '#f4eee2', CLOSE = '#f2c14e';
  let guess = null, guessData = null, guessToken = 0;
  async function buildGuess() {
    const token = ++guessToken;
    try { await document.fonts.load('700 100px "Cafe Francoise"'); } catch { /* falls back to sans-serif */ }
    const { wood, iron } = await mats;
    if (token !== guessToken) return;
    if (guess) { retire(guess.grp, wood, iron); guess = null; }
    if (!guessData) { stage.inputRect = null; return; }
    const { top, W, H: Hs } = signSize(), gap = 0.075, edge = 0.045;
    const Hi = W / SIGN.ratio, solved = !!guessData.solved;
    const yTop = top - edge - Hs - gap, yBot = -top + edge + (solved ? 0 : Hi + gap);
    const list = { W, H: yTop - yBot, y: (yTop + yBot) / 2 };
    const input = solved ? null : { W, H: Hi, y: -top + edge + Hi / 2 };
    const mk = (b) => { b.c = document.createElement('canvas'); b.c.width = 1024; b.c.height = Math.round(1024 * b.H / b.W); b.g = b.c.getContext('2d'); b.tex = new THREE.CanvasTexture(b.c); b.tex.colorSpace = THREE.SRGBColorSpace; b.tex.anisotropy = 4; return b; };
    const grp = new THREE.Group();
    for (const b of [list, input]) {
      if (!b) continue;
      mk(b);
      const wire = gap - SIGN.f * 2 + 0.004; // each board hangs from the one above, wire to the frame above
      const g = frame(b.W, b.H, b.tex, wire, wood, iron); g.position.set(0, b.y, SIGN.z); grp.add(g);
    }
    guess = { grp, list, input }; signScene.add(grp); enterGroup(grp);
    paintGuess(); layoutInput();
  }
  function paintGuess() {
    if (!guess) return;
    const { list, input } = guess, d = guessData;
    { const { g, c } = list; g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, c.width, c.height);
      g.textBaseline = 'alphabetic'; g.font = '600 120px "Cafe Francoise", sans-serif';
      if (d.solved) {
        let px = 220; const font = () => { g.font = `700 ${px}px "Cafe Francoise", sans-serif`; };
        font(); const word = d.solved.toUpperCase();
        while (g.measureText(word).width > c.width - 80 && px > 30) { px -= 6; font(); }
        g.textAlign = 'center'; g.fillStyle = CHALK; g.fillText(word, c.width / 2, c.height / 2 + px * 0.35);
      } else {
        const lh = 140, pad = 40; let y = c.height - pad;
        for (let i = d.guesses.length - 1; i >= 0 && y > pad; i--, y -= lh) {
          const gu = d.guesses[i]; g.textAlign = 'left'; g.fillStyle = CHALK; g.fillText(gu.text.toUpperCase(), pad, y);
          if (gu.close) { g.textAlign = 'right'; g.fillStyle = CLOSE; g.fillText('CLOSE', c.width - pad, y); }
        }
      }
      list.tex.needsUpdate = true; }
    if (input) { const { g, c } = input; g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, c.width, c.height);
      g.font = '600 ' + Math.round(c.height * 0.55) + 'px "Cafe Francoise", sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = CHALK;
      let text = (d.typed || '').toUpperCase();
      while (g.measureText(text).width > c.width - 100 && text) text = text.slice(1);
      g.fillText(text, 40, c.height / 2 + 4);
      g.fillRect(44 + g.measureText(text).width, c.height * 0.2, 6, c.height * 0.6);
      input.tex.needsUpdate = true; }
  }
  /** where the input board is on screen (CSS pixels in the container), so the real text field can sit over it */
  function layoutInput() {
    if (!guess || !guess.input) { stage.inputRect = null; return stage.onLayout?.(); }
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight, { top } = signSize();
    const k = (h / 2) / top, b = guess.input;
    stage.inputRect = { left: w / 2 - (b.W / 2) * k, top: h / 2 - (b.y + b.H / 2) * k, width: b.W * k, height: b.H * k };
    stage.onLayout?.();
  }


  /* ---------- picking: one board per word, hung one under the other; tap one ---------- */

  let choiceData = null, choices = null, choiceToken = 0, choicePicked = -1;
  async function buildChoices() {
    const token = ++choiceToken;
    try { await document.fonts.load('700 100px "Cafe Francoise"'); } catch { /* falls back to sans-serif */ }
    const { wood, iron } = await mats;
    if (token !== choiceToken) return;
    if (choices) { retire(choices.grp, wood, iron); choices = null; }
    if (!choiceData) return;
    const { top, W, H: Hs } = signSize(), gap = 0.075, edge = 0.045, n = choiceData.length;
    const yTop = top - edge - Hs - gap, area = yTop - (-top + edge);
    const H = Math.min((area - gap * (n - 1)) / n, W / 2.2), grp = new THREE.Group(), boards = [];
    const y0 = yTop;
    choiceData.forEach((word, i) => {
      const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * H / W);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const y = y0 - H / 2 - i * (H + gap), g = frame(W, H, tex, gap - SIGN.f * 2 + 0.004, wood, iron);
      g.position.set(0, y, SIGN.z); grp.add(g); boards.push({ c, tex, y, H, word });
    });
    choices = { grp, boards, W }; signScene.add(grp); enterGroup(grp); paintChoices();
  }
  function paintChoices() {
    if (!choices) return;
    choices.boards.forEach((b, i) => {
      const g = b.c.getContext('2d'), { width, height } = b.c;
      g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, width, height);
      let px = Math.round(height * 0.5); const font = () => { g.font = `700 ${px}px "Cafe Francoise", sans-serif`; };
      font(); const word = b.word.toUpperCase();
      while (g.measureText(word).width > width - 100 && px > 30) { px -= 6; font(); }
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = i === choicePicked ? '#f2c14e' : '#f4eee2';
      g.fillText(word, width / 2, height / 2 + 4);
      b.tex.needsUpdate = true;
    });
  }
  /** the index of the word board under a pointer, or -1 */
  function choiceAt(e) {
    if (!choices) return -1;
    const r = renderer.domElement.getBoundingClientRect(), { top } = signSize(), k = (r.height / 2) / top;
    const x = (e.clientX - r.left - r.width / 2) / k, y = -(e.clientY - r.top - r.height / 2) / k;
    return choices.boards.findIndex((b) => Math.abs(x) <= choices.W / 2 + SIGN.f && Math.abs(y - b.y) <= b.H / 2 + SIGN.f);
  }

  let colour = '#fffdf6', layout = null;
  /* ---------- the tool bar: a board under the paper (colours, pen sizes, opacity, undo, redo) ---------- */

  // one grid for everything: five columns, four rows of identical cells (two rows of colours; sizes + undo; opacities + redo)
  const BAR = { ratio: 0.57, colours: [0, 4, 5, 6, 7, 8, 9, 10, 11, 1], sizes: [0, 1, 2, 3], alphas: [1, 0.65, 0.35, 0.15], cols: 5, rows: 4, cell: 108, gap: 20, margin: 48 };
  let toolsData = null, bar = null; // toolsData: { colour, size, alpha, canUndo, canRedo }
  function paintBar() {
    if (!bar) return;
    const { c, ctrls } = bar, g = c.getContext('2d'), d = toolsData, W = c.width, H = c.height;
    const { cols, rows, cell, gap, margin } = BAR, px = (W - margin * 2) / cols, top = (H - (rows * cell + (rows - 1) * gap)) / 2 + cell / 2;
    ctrls.length = 0;
    g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, W, H);
    /** a cell: its box, the yellow frame when chosen, dimmed when it can't be used; `draw` paints the icon around (0, 0) */
    const put = (i, act, { fill, on = false, off = false, draw }) => {
      const x = margin + px * (i % cols) + px / 2, y = top + Math.floor(i / cols) * (cell + gap), h = cell / 2;
      g.save(); g.translate(x, y); g.globalAlpha = off ? 0.3 : 1;
      if (fill) { g.fillStyle = fill; g.fillRect(-h, -h, cell, cell); }
      g.strokeStyle = CHALK; g.lineWidth = 3; g.strokeRect(-h, -h, cell, cell);
      if (draw) draw();
      g.restore();
      if (on) { g.strokeStyle = CLOSE; g.lineWidth = 8; g.strokeRect(x - h - 9, y - h - 9, cell + 18, cell + 18); }
      if (!off) ctrls.push({ x: x - px / 2, y: y - (cell + gap) / 2, w: px, h: cell + gap, act });
    };
    BAR.colours.forEach((ci, k) => put(k, { k: 'colour', v: ci }, { fill: DrawBoard.COLORS[ci], on: ci === d.colour }));
    const ink = DrawBoard.COLORS[d.colour] === '#fffdf6' ? '#1f1d1a' : DrawBoard.COLORS[d.colour];
    BAR.sizes.forEach((s, k) => put(10 + k, { k: 'size', v: s }, { on: s === d.size, draw: () => { g.fillStyle = CHALK; g.beginPath(); g.arc(0, 0, 9 + k * 9, 0, Math.PI * 2); g.fill(); } }));
    BAR.alphas.forEach((a, k) => put(15 + k, { k: 'alpha', v: a }, { on: a === d.alpha, draw: () => {
      g.fillStyle = '#fffdf6'; g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill();
      g.globalAlpha = a; g.fillStyle = ink; g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 2); g.fill(); } }));
    const arrow = (dir) => () => {
      g.scale(dir * 1.4, 1.4); g.strokeStyle = CHALK; g.fillStyle = CHALK; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.arc(2, 4, 19, Math.PI * 1.2, Math.PI * 0.15, false); g.stroke();
      g.beginPath(); g.moveTo(-22, -9); g.lineTo(-18, -27); g.lineTo(-3, -14); g.closePath(); g.fill();
    };
    put(14, { k: 'undo' }, { off: !d.canUndo, draw: arrow(1) });
    put(19, { k: 'redo' }, { off: !d.canRedo, draw: arrow(-1) });
    bar.tex.needsUpdate = true;
  }
  /** the tool under a pointer, or null */
  function toolAt(e) {
    if (!bar || !layout || !layout.bar) return null;
    const r = renderer.domElement.getBoundingClientRect(), b = layout.bar;
    const u = ((e.clientX - r.left - b.cx) / b.w + 0.5) * bar.c.width, v = ((e.clientY - r.top - b.cy) / b.h + 0.5) * bar.c.height;
    if (u < 0 || v < 0 || u > bar.c.width || v > bar.c.height) return null;
    return bar.ctrls.find((c) => u >= c.x && u <= c.x + c.w && v >= c.y && v <= c.y + c.h) || null;
  }

  /* ---------- the paper: a square board in the same frame, hung from the sign by long wires, centred in what's left of the screen ---------- */

  let paperOn = false, paperGrp = null, paperToken = 0;
  async function buildPaper() {
    const token = ++paperToken;
    const { wood, iron } = await mats;
    if (token !== paperToken) return;
    if (paperGrp) { retire(paperGrp, wood, iron); paperGrp = null; }
    layout = null;
    if (!paperOn) return;
    const { top, W, H: Hs } = signSize(), gap = 0.075, edge = 0.045, f = SIGN.f;
    const yTop = top - edge - Hs - gap, yBot = -top + edge;
    const bh = toolsData ? BAR.ratio : 0, extra = toolsData ? gap : 0;
    const pw = Math.min(W, (yTop - yBot - extra) / (ASPECT + bh)), ph = pw * ASPECT, barH = pw * bh;
    const block = ph + extra + barH, yb = toolsData ? (yTop + yBot) / 2 + block / 2 : yTop, y = yb - ph / 2; // with no tools the paper hangs right under the sign
    const wire = (top - edge - Hs - f) - (yb + f);
    paperGrp = new THREE.Group();
    const pf = frame(pw, ph, paperTex, wire, wood, iron); pf.position.set(0, y, SIGN.z); paperGrp.add(pf);
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight, k = (h / 2) / top;
    layout = { cx: w / 2, cy: h / 2 - y * k, w: pw * k, h: ph * k };
    bar = null;
    if (toolsData) {
      const c = document.createElement('canvas'); c.width = 1024; c.height = Math.round(1024 * bh);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      const by = yb - ph - gap - barH / 2, bg = frame(pw, barH, tex, gap - f * 2 + 0.004, wood, iron);
      bg.position.set(0, by, SIGN.z); paperGrp.add(bg);
      bar = { c, tex, ctrls: [] }; layout.bar = { cx: w / 2, cy: h / 2 - by * k, w: pw * k, h: barH * k };
      paintBar();
    }
    signScene.add(paperGrp); enterGroup(paperGrp);
  }

  const stage = { board, onDraw: null, onLayout: null, onPick: null, onTool: null, inputRect: null };

  function paintPaper() {
    const g = paperCanvas.getContext('2d');
    g.fillStyle = colour; g.fillRect(0, 0, paperCanvas.width, paperCanvas.height);
    g.save(); g.globalCompositeOperation = 'multiply'; g.drawImage(square, 0, 0, paperCanvas.width, paperCanvas.height); g.restore();
    paperTex.needsUpdate = true;
  }

  function fit() {
    const w = container.clientWidth || window.innerWidth, h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    signCam.aspect = w / h; signCam.updateProjectionMatrix(); placeSign();
    if (signName) buildSign(signName);
    if (guessData) buildGuess();
    if (choiceData) buildChoices();
    Object.assign(flatCam, { left: -w / 2, right: w / 2, top: h / 2, bottom: -h / 2 });
    flatCam.updateProjectionMatrix();
    board.resize(1024); paperCanvas.width = 1024; paperCanvas.height = Math.round(1024 * ASPECT);
    paintPaper();
    if (paperOn) buildPaper();
  }

  /* ---------- drawing on the paper ---------- */

  const toPaper = (e) => {
    const r = renderer.domElement.getBoundingClientRect(), { w, h, cx, cy } = layout;
    const x = e.clientX - r.left - cx, y = e.clientY - r.top - cy;
    return [DrawBoard.clamp((x / w + 0.5) * 1000), DrawBoard.clamp((y / h + 0.5) * 1000 * ASPECT, 1000 * ASPECT), Math.abs(x) <= w / 2 && Math.abs(y) <= h / 2];
  };
  let pointer = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    if (paperOn && stage.onTool) { const tool = toolAt(e); if (tool) { e.preventDefault(); stage.onTool(tool.act); return; } }
    if (choices) { const i = choiceAt(e); if (i >= 0 && choicePicked < 0) { choicePicked = i; paintChoices(); stage.onPick?.(i); } return; }
    if (!paperOn || !layout || pointer !== null || !stage.onDraw) return;
    const [x, y, inside] = toPaper(e);
    if (!inside) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointer = e.pointerId;
    stage.onDraw.down(x, y);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (events.length ? events : [e]).forEach((ev) => { const [x, y] = toPaper(ev); stage.onDraw.move(x, y); });
  });
  const up = (e) => { if (e.pointerId !== pointer) return; pointer = null; stage.onDraw.up(); };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  /* ---------- the clouds drift by ---------- */

  let paperFresh = false;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    for (const m of clouds) {
      m.position.x += CLOUDS.drift * dt;
      if (m.position.x > m.userData.half) m.position.x -= m.userData.half * 2;
    }
    stepAnims(nowS());
    if (paperFresh) { paperFresh = false; paintPaper(); }
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    if (sign) { renderer.render(signScene, signCam); renderer.clearDepth(); }
    renderer.render(overlay, flatCam);
  });

  Object.assign(stage, {
    setColour(c) { colour = c; paintPaper(); },
    setName(n) {
      n = n || '';
      if (n === signName && sign) return Promise.resolve(); // already up: leave it be
      signName = n; return buildSign(signName);
    },
    /** the tool bar under the paper: { colour, size, alpha, canUndo, canRedo }, or null to take it away; taps go to stage.onTool({ k, v }) */
    setTools(d) {
      const had = !!toolsData; toolsData = d;
      if (!!d !== had) return buildPaper();
      paintBar();
    },
    /** a new screen is coming: boards built in the next moment come down, and the ones going are pulled up */
    transition(sec = 1.2) { transitionUntil = nowS() + sec; arriveAt = nowS() + (hasBoards() ? 0.6 : 0.05); },
    showPaper(on) { if (on === paperOn) return; paperOn = on; buildPaper(); },
    /** the words to pick from (an array of strings), or null; taps go to stage.onPick(index) */
    setChoices(words) { choiceData = words && words.length ? words : null; choicePicked = -1; return buildChoices(); },
    /** the guessing boards: { guesses: [{ text, close }], solved, typed }, or null to take them away */
    setGuess(d) {
      const rebuild = !guessData !== !d || (guessData && d && !guessData.solved !== !d.solved);
      guessData = d;
      if (rebuild || !guess) return d ? buildGuess() : (guessToken++, buildGuess());
      paintGuess();
    },
    changed() { paperFresh = true; }, // the board was drawn on
  });
  fit();
  stage.transition(4); // the first boards come down too (the textures may still be loading)
  window.addEventListener('resize', fit);
  return stage;
}
