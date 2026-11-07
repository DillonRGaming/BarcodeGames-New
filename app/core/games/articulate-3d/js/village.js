/**
 * A little French seaside village, built from simple shapes with hand-made canvas textures:
 * pastel plaster houses with terracotta roofs, shutters, window boxes and balconies, a cobbled
 * promenade, a café corner, a lamp post, a round tree, the sea and an island with a fort.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ---------- renderer, scene, camera ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: false }); // anti-aliasing comes from the post-processing chain
renderer.setPixelRatio(1); // the scene is soft anyway; 2x pixels costs 4x
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap; // soft, blurred shadow edges
renderer.shadowMap.autoUpdate = false; // nothing that casts shadows moves: draw the shadows once
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd98f74, 60, 330); // warm evening haze

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 700); // near 0.5 keeps depth precise without a log depth buffer
// close in, facing the houses dead on (they face +z)
const CAM_BASE = new THREE.Vector3(6, 3, 15);
const LOOK = new THREE.Vector3(6, 4.4, -8);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

/* ---------- small helpers ---------- */

const rand = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const pick = (list) => list[Math.floor(rand() * list.length)];

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });
}

function mesh(geo, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, shadow = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

function box(w, h, d, material, at) { return mesh(new THREE.BoxGeometry(w, h, d), material, at); }

/* ---------- textures: each drawn twice from the same seed, once in colour and once as a height (bump) map ---------- */

function seeded(seed) { let x = seed; return () => ((x = (x * 16807) % 2147483647) / 2147483647); }

/** draw(g, w, h, height, r): height = true for the bump pass (light = raised); r = a seeded random, same in both passes */
function surface(w, h, draw, repeat = [1, 1], seed = 11) {
  const make = (height) => {
    const t = canvasTexture(w, h, (g) => draw(g, w, h, height, seeded(seed)), repeat);
    if (height) t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  return { map: make(false), bumpMap: make(true) };
}

const grey = (v) => `rgb(${v},${v},${v})`;

// Plaster: a soft wash with grain, patches, hairline cracks and grime at the foot
const plasterCache = new Map();
function plaster(hex) {
  if (plasterCache.has(hex)) return plasterCache.get(hex);
  const t = surface(512, 512, (g, w, h, height, r) => {
    g.fillStyle = height ? grey(128) : hex; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { // soft patches where the paint is thicker or worn
      const x = r() * w, y = r() * h, rad = 20 + r() * 70, a = 0.05 + r() * 0.06, light = r() < 0.5;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, height ? (light ? `rgba(255,255,255,${a * 2})` : `rgba(0,0,0,${a * 2})`) : (light ? `rgba(255,250,235,${a})` : `rgba(90,60,40,${a})`));
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 9000; i++) { // grain
      const v = r();
      g.fillStyle = height ? grey(Math.floor(80 + v * 100)) : (v < 0.5 ? `rgba(255,255,255,${v * 0.1})` : `rgba(70,45,25,${(v - 0.5) * 0.12})`);
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    g.strokeStyle = height ? grey(40) : 'rgba(70,45,30,0.25)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) { // hairline cracks
      let x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); }
      g.stroke();
    }
    if (!height) {
      const grad = g.createLinearGradient(0, h * 0.75, 0, h);
      grad.addColorStop(0, 'rgba(60,40,20,0)'); grad.addColorStop(1, 'rgba(60,40,20,0.22)');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
    }
  }, [1, 1], hex.length * 97 + parseInt(hex.slice(1), 16) % 1000);
  plasterCache.set(hex, t);
  return t;
}

// Terracotta: overlapping rounded tiles, each with a highlight on its crown and a dark gap below
const TILES = surface(512, 512, (g, w, h, height, r) => {
  g.fillStyle = height ? grey(30) : '#6e2f1c'; g.fillRect(0, 0, w, h);
  const rows = 10, cols = 8, tw = w / cols, th = h / rows;
  for (let row = rows; row >= -1; row--) {
    for (let c = -1; c <= cols; c++) {
      const x = c * tw + (row % 2 ? tw / 2 : 0), y = row * th;
      const shade = 0.82 + r() * 0.3;
      const grd = g.createLinearGradient(x, 0, x + tw, 0);
      if (height) { grd.addColorStop(0, grey(70)); grd.addColorStop(0.5, grey(235)); grd.addColorStop(1, grey(70)); }
      else {
        const base = [196 * shade, 92 * shade, 54 * shade].map(Math.round);
        grd.addColorStop(0, `rgb(${base.map((v) => v * 0.7 | 0)})`); grd.addColorStop(0.45, `rgb(${base.map((v) => Math.min(255, v * 1.12) | 0)})`); grd.addColorStop(1, `rgb(${base.map((v) => v * 0.65 | 0)})`);
      }
      g.fillStyle = grd;
      g.beginPath(); g.roundRect(x + 2, y, tw - 4, th * 1.25, [0, 0, tw * 0.45, tw * 0.45]); g.fill();
      if (!height && r() < 0.25) { g.fillStyle = 'rgba(80,110,50,0.25)'; g.fillRect(x + 4 + r() * tw * 0.5, y + th * 0.8, 6 + r() * 10, 4); } // a bit of moss
    }
  }
}, [2.2, 1.6], 5);

// Cobbles, after a photo of an old granite street: grey stones of very mixed sizes with flat worn tops and
// chipped edges, wide dark dirt joints with specks of moss, granite speckle, the odd warmer or pinkish stone.
const COBBLES = (() => {
  const W = 512, CELLS = 8, size = W / CELLS;
  const r = seeded(21);
  // 1–4 stones per cell, so big slabs sit next to clusters of small ones
  const cells = [];
  for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
    const n = r() < 0.45 ? 1 : r() < 0.6 ? 2 : r() < 0.7 ? 3 : 4;
    const list = [];
    for (let k = 0; k < n; k++) {
      list.push({ x: (i + 0.15 + r() * 0.7) * size, y: (j + 0.15 + r() * 0.7) * size,
        tone: r(), kind: r(), tiltX: (r() - 0.5) * 2, tiltY: (r() - 0.5) * 2, wear: r() });
    }
    cells.push(list);
  }
  // seamless wobble so edges are chipped rather than straight
  const TAU = Math.PI * 2;
  const wobble = (x, y, s) => (Math.sin(TAU * (x / W) * 7 + Math.sin(TAU * (y / W) * 5) * 2) + Math.sin(TAU * (y / W) * 9 + Math.cos(TAU * (x / W) * 4) * 2)) * s;
  const hash = (x, y) => { const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return v - Math.floor(v); };
  const colour = new Uint8ClampedArray(W * W * 4), height = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const wx = x + wobble(x, y, 3.5), wy = y + wobble(y + 91, x + 37, 3.5);
    const ci = Math.floor(x / size), cj = Math.floor(y / size);
    let d1 = 1e9, d2 = 1e9, best = null, bx = 0, by = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = ci + di, jj = cj + dj;
      const ox = ii < 0 ? -W : ii >= CELLS ? W : 0, oy = jj < 0 ? -W : jj >= CELLS ? W : 0;
      for (const p of cells[((jj + CELLS) % CELLS) * CELLS + ((ii + CELLS) % CELLS)]) {
        const dx = wx - (p.x + ox), dy = wy - (p.y + oy), d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = p; bx = dx; by = dy; } else if (d < d2) d2 = d;
      }
    }
    const edge = Math.sqrt(d2) - Math.sqrt(d1);              // pixels from the nearest joint
    const gap = 3.2 + hash(Math.floor(x / 6), Math.floor(y / 6)) * 2.5; // joint width varies
    const k = Math.min(1, Math.max(0, (edge - gap) / 5));    // 0 in a joint … 1 on top of a stone
    const top = 1 - Math.pow(1 - k, 2.4);                    // flat top, rounded/chipped rim
    const speck = hash(x, y);
    const i4 = (y * W + x) * 4;
    // stone colour: granite grey with salt-and-pepper speckle; some warmer, a few pinkish or dark
    let base = 112 + best.tone * 46;
    let c = [base, base + 2, base + 6];
    if (best.kind < 0.12) c = [base + 22, base + 4, base - 4];           // pinkish
    else if (best.kind < 0.3) c = [base + 10, base + 6, base - 2];       // warmer
    else if (best.kind > 0.9) c = [base - 34, base - 32, base - 28];     // dark
    const speckle = speck < 0.08 ? -38 : speck > 0.94 ? 30 : (speck - 0.5) * 14;
    const worn = (1 - Math.min(1, Math.hypot(bx, by) / (size * 0.6))) * best.wear * 12; // tops polished lighter
    const rim = (1 - top) * -26;                                         // darker towards the edges
    // the joints: dark dirt, with grit and a few green specks of moss
    const dirt = 54 + hash(x * 3, y * 7) * 22;
    let j = [dirt + 8, dirt + 2, dirt - 6];
    if (hash(Math.floor(x / 3), Math.floor(y / 3)) > 0.86) j = [70, 86, 48];
    for (let ch = 0; ch < 3; ch++) colour[i4 + ch] = j[ch] * (1 - k) + (c[ch] + speckle + worn + rim) * k;
    colour[i4 + 3] = 255;
    // height: joints low, tops flat with a slight tilt per stone and fine grain
    const tilt = (best.tiltX * bx + best.tiltY * by) / size * 14;
    const hgt = 40 + top * (150 + tilt) + (speck - 0.5) * 18 * k;
    height[i4] = height[i4 + 1] = height[i4 + 2] = hgt; height[i4 + 3] = 255;
  }
  const tex = (data, isColour) => {
    const t = canvasTexture(W, W, (g) => g.putImageData(new ImageData(data, W, W), 0, 0), [10, 7]);
    if (!isColour) t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  return { map: tex(colour, true), bumpMap: tex(height, false) };
})();

// Wood: vertical planks with grooves and grain
const WOOD = surface(256, 512, (g, w, h, height, r) => {
  const planks = 4, pw = w / planks;
  for (let i = 0; i < planks; i++) {
    const tone = 0.85 + r() * 0.25;
    g.fillStyle = height ? grey(170) : `rgb(${200 * tone | 0},${134 * tone | 0},${72 * tone | 0})`;
    g.fillRect(i * pw, 0, pw, h);
    for (let k = 0; k < 40; k++) {
      const gx = i * pw + r() * pw;
      g.fillStyle = height ? grey(110 + r() * 40 | 0) : `rgba(110,60,25,${0.08 + r() * 0.2})`;
      g.fillRect(gx, r() * h, 1 + r(), 30 + r() * 120);
    }
    g.fillStyle = height ? grey(10) : 'rgba(60,30,10,0.6)';
    g.fillRect(i * pw, 0, 3, h);
  }
  // panel mouldings
  g.strokeStyle = height ? grey(240) : 'rgba(255,220,170,0.25)'; g.lineWidth = 6;
  g.strokeRect(w * 0.15, h * 0.08, w * 0.7, h * 0.36); g.strokeRect(w * 0.15, h * 0.52, w * 0.7, h * 0.4);
}, [1, 1], 9);

// Stone blocks with mortar joints
const STONE = surface(512, 256, (g, w, h, height, r) => {
  g.fillStyle = height ? grey(20) : '#8e8572'; g.fillRect(0, 0, w, h);
  const bh = 42;
  for (let y = 0; y < h; y += bh) {
    let x = Math.round(y / bh) % 2 ? -40 : 0;
    while (x < w) {
      const bw = 70 + r() * 60;
      const v = 160 + r() * 45;
      const grd = g.createLinearGradient(0, y, 0, y + bh);
      if (height) { grd.addColorStop(0, grey(230)); grd.addColorStop(1, grey(150)); }
      else { grd.addColorStop(0, `rgb(${v + 12 | 0},${v + 2 | 0},${v - 20 | 0})`); grd.addColorStop(1, `rgb(${v - 18 | 0},${v - 26 | 0},${v - 44 | 0})`); }
      g.fillStyle = grd;
      g.beginPath(); g.roundRect(x + 3, y + 3, bw - 6, bh - 6, 5); g.fill();
      x += bw;
    }
  }
}, [6, 1], 4);

/* ---------- sunset sky ---------- */

// The sun sits low over the sea, to the left
const SUN_DIR = new THREE.Vector3(-0.85, 0.16, 0.5).normalize(); // low over the sea, raking across the facades

const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `
    uniform vec3 sunDir; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float h = clamp(d.y, -0.2, 1.0);
      vec3 top = vec3(0.20,0.18,0.42), mid = vec3(0.86,0.42,0.42), low = vec3(1.0,0.66,0.38);
      vec3 col = mix(low, mid, smoothstep(0.0, 0.18, h));
      col = mix(col, top, smoothstep(0.15, 0.75, h));
      float s = max(dot(d, sunDir), 0.0);
      col += vec3(1.0,0.55,0.25) * pow(s, 8.0) * 0.6;   // warm glow around the sun
      col += vec3(1.0,0.85,0.6) * pow(s, 900.0) * 6.0; // the sun itself
      if (d.y < 0.0) col = mix(col, vec3(0.85,0.5,0.4), clamp(-d.y*4.0,0.,1.));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.renderOrder = -2; // drawn first, behind everything
scene.add(sky);

/* ---------- volumetric clouds: raymarched through 3D noise inside a big slab of sky ---------- */

const CLOUD_BOX = { min: new THREE.Vector3(-420, 55, -420), max: new THREE.Vector3(420, 105, 40) };
const cloudMat = new THREE.ShaderMaterial({
  // drawn right after the sky, before everything else, blending over it
  depthWrite: false, depthTest: false, side: THREE.BackSide, fog: false, blending: THREE.NoBlending,
  uniforms: {
    time: { value: 0 }, sunDir: { value: SUN_DIR },
    boxMin: { value: CLOUD_BOX.min }, boxMax: { value: CLOUD_BOX.max },
  },
  vertexShader: `varying vec3 vWorld; void main(){ vec4 w = modelMatrix * vec4(position,1.); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform float time; uniform vec3 sunDir, boxMin, boxMax; varying vec3 vWorld;
    float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z); }
    float fbm(vec3 p){ float a = 0.5, v = 0.0; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.03 + 17.1; a *= 0.5; } return v; }
    float density(vec3 p){
      float h = (p.y - boxMin.y) / (boxMax.y - boxMin.y);
      float shape = smoothstep(0.0, 0.25, h) * smoothstep(1.0, 0.45, h);  // flat-ish bottoms, rounded tops
      vec3 q = p * 0.012 + vec3(time*0.004, 0.0, time*0.002);
      float cover = fbm(q * 0.35);                                          // where the cloud banks are
      float d = fbm(q) * 0.75 + cover * 0.75 - 0.8;   // higher threshold: separate clouds with clear sky between
      return max(d * shape * 5.0, 0.0);
    }
    vec2 hitBox(vec3 ro, vec3 rd){ vec3 t0 = (boxMin-ro)/rd, t1 = (boxMax-ro)/rd; vec3 a = min(t0,t1), b = max(t0,t1);
      return vec2(max(max(a.x,a.y),a.z), min(min(b.x,b.y),b.z)); }
    void main(){
      vec3 ro = cameraPosition, rd = normalize(vWorld - cameraPosition);
      vec2 t = hitBox(ro, rd); t.x = max(t.x, 0.0);
      if (t.y <= t.x) discard;
      const int STEPS = 44;
      float stepLen = min((t.y - t.x) / float(STEPS), 14.0);
      float trans = 1.0; vec3 light = vec3(0.0);
      float jitter = hash(vec3(gl_FragCoord.xy, time)) * stepLen;
      vec3 lit = vec3(1.25, 0.72, 0.45), shade = vec3(0.36, 0.26, 0.44), amb = vec3(0.55,0.42,0.6);
      float phase = 0.6 + 1.4*pow(max(dot(rd, sunDir),0.0), 6.0);  // brighter looking towards the sun
      for (int i = 0; i < STEPS; i++){
        float s = t.x + jitter + float(i)*stepLen; if (s > t.y) break;
        vec3 p = ro + rd*s;
        float d = density(p);
        if (d > 0.01){
          float toSun = density(p + sunDir*6.0) + density(p + sunDir*14.0);   // how much cloud sits between here and the sun
          float sunT = exp(-toSun * 1.4);
          vec3 c = mix(shade, lit * phase, sunT) + amb * 0.25;
          float a = 1.0 - exp(-d * stepLen * 0.09);
          light += trans * a * c; trans *= 1.0 - a;
          if (trans < 0.03) break;
        }
      }
      float alpha = 1.0 - trans;
      if (alpha < 0.01) discard;
      // fade into the haze towards the horizon
      alpha *= smoothstep(0.0, 0.08, rd.y + 0.02);
      gl_FragColor = vec4(light / max(alpha, 0.001), alpha); // linear; converted when laid over the sky
    }`,
});
const cloudSize = new THREE.Vector3().subVectors(CLOUD_BOX.max, CLOUD_BOX.min);
const cloudCenter = new THREE.Vector3().addVectors(CLOUD_BOX.max, CLOUD_BOX.min).multiplyScalar(0.5);
const clouds = new THREE.Mesh(new THREE.BoxGeometry(cloudSize.x, cloudSize.y, cloudSize.z), cloudMat);
clouds.position.copy(cloudCenter);
clouds.frustumCulled = false;
// clouds are soft, so they're marched at a third of the resolution in their own pass, then laid over the sky
const cloudScene = new THREE.Scene();
cloudScene.add(clouds);
const CLOUD_RES = 1 / 3;
const cloudTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
const cloudLayer = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  transparent: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  depthTest: false, depthWrite: false,
  uniforms: { tex: { value: cloudTarget.texture } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `uniform sampler2D tex; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tex, vUv);
      gl_FragColor = vec4(c.rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor = vec4(gl_FragColor.rgb * c.a, c.a); // premultiplied, laid over the sky
    }`,
}));
cloudLayer.frustumCulled = false;
cloudLayer.position.y = -80; // its own shader ignores this; it just keeps the stand-in plane out of sight in the AO pass
cloudLayer.renderOrder = -1;
scene.add(cloudLayer);
function sizeClouds() {
  cloudTarget.setSize(Math.ceil(window.innerWidth * CLOUD_RES), Math.ceil(window.innerHeight * CLOUD_RES));
}
sizeClouds();
window.addEventListener('resize', sizeClouds);

/* ---------- sea, island ---------- */

const seaGeo = new THREE.PlaneGeometry(400, 400, 60, 60);
const sea = mesh(seaGeo, new THREE.MeshStandardMaterial({ color: 0x3a4f7a, roughness: 0.18, metalness: 0.35, flatShading: true }),
  { x: -205, y: -1.2, z: -100, rx: -Math.PI / 2, shadow: false });
scene.add(sea);
const seaBase = seaGeo.attributes.position.array.slice();

// The island with its little fort
const island = new THREE.Group();
island.add(mesh(new THREE.CylinderGeometry(9, 13, 4, 10), mat(0x9c8f78), { y: -1 }));
island.add(mesh(new THREE.CylinderGeometry(7, 9, 1.2, 10), mat(0x7fa35a), { y: 1.4 }));
island.add(box(7, 4, 5, mat(0xd8cbb0), { y: 3.8 }));
island.add(mesh(new THREE.CylinderGeometry(1.6, 1.8, 7, 12), mat(0xd8cbb0), { x: 3.5, y: 5 }));
for (let i = 0; i < 6; i++) island.add(box(0.8, 0.8, 0.8, mat(0xd8cbb0), { x: -3 + i * 1.2, y: 6.2, z: 2.2 }));
island.position.set(-70, -0.5, -150);
scene.add(island);

/* ---------- ground: promenade, sea wall ---------- */

scene.add(box(60, 1, 44, mat(0xffffff, { ...COBBLES, bumpScale: 2.4, roughness: 0.92 }), { x: 14, y: -0.5, z: 9 }));
// sea wall along the left edge of the promenade
scene.add(box(1, 1.2, 44, mat(0xffffff, { ...STONE, bumpScale: 3 }), { x: -16.5, y: 0.1, z: 9 }));
scene.add(box(1.4, 0.2, 44, mat(0xc9bfa9), { x: -16.5, y: 0.8, z: 9 }));
// a raised terrace behind, like a step up to the houses
scene.add(box(40, 1.2, 4, mat(0xffffff, { ...STONE, bumpScale: 3 }), { x: 10, y: 0.6, z: -3.5 }));
scene.add(box(40, 0.15, 4.2, mat(0xcfc4ae), { x: 10, y: 1.25, z: -3.4 }));

/* ---------- houses ---------- */

const FACADES = ['#f2d6a2', '#f4c7b3', '#d9e4c8', '#f7e9c8', '#c9dceb', '#efd2d9', '#e9cfa0'];
const SHUTTERS = [0x3f7d8c, 0x5f8f4e, 0x3b5f9a, 0x9a4a3a, 0x6a8fb0, 0x2f6b5e];

function roof(width, depth) {
  // a gable roof as a triangular prism with a bit of overhang
  const shape = new THREE.Shape();
  const hw = width / 2 + 0.35;
  shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(0, width * 0.42); shape.lineTo(-hw, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: depth + 0.7, bevelEnabled: false });
  geo.translate(0, 0, -(depth + 0.7) / 2);
  return mesh(geo, mat(0xffffff, { ...TILES, bumpScale: 4, roughness: 0.7 }));
}

function windowAt(group, x, y, z, shutterColor, { planter = false, balcony = false } = {}) {
  group.add(box(1.05, 1.45, 0.12, mat(0xf4efe4), { x, y, z: z + 0.04 })); // frame
  const lit = rand() < 0.3; // some windows already have the lights on
  group.add(box(0.85, 1.25, 0.1, lit ? mat(0x3a2a1a, { emissive: 0xffa94d, emissiveIntensity: 1.1 }) : mat(0x24323d, { roughness: 0.15, metalness: 0.4 }), { x, y, z: z + 0.08 })); // glass
  group.add(box(0.06, 1.25, 0.12, mat(0xf4efe4), { x, y, z: z + 0.1 }));
  group.add(box(0.85, 0.06, 0.12, mat(0xf4efe4), { x, y: y + 0.1, z: z + 0.1 }));
  const sm = mat(shutterColor, { roughness: 0.7 });
  for (const side of [-1, 1]) {
    const s = box(0.5, 1.45, 0.06, sm, { x: x + side * 0.82, y, z: z + 0.1 });
    s.rotation.y = side * -0.35;
    group.add(s);
    for (let i = 0; i < 5; i++) group.add(box(0.44, 0.04, 0.08, mat(new THREE.Color(shutterColor).multiplyScalar(0.8)), { x: x + side * 0.8, y: y - 0.55 + i * 0.27, z: z + 0.15 }));
  }
  if (planter) {
    group.add(box(1.15, 0.28, 0.32, mat(0xb85c38), { x, y: y - 0.85, z: z + 0.25 }));
    for (let i = 0; i < 5; i++) {
      group.add(mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(0x4f8a3a), { x: x - 0.45 + i * 0.22, y: y - 0.62, z: z + 0.27 }));
      if (rand() < 0.7) group.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(pick([0xe8546a, 0xf2c94c, 0xffffff, 0xd05ab0])), { x: x - 0.45 + i * 0.22, y: y - 0.5, z: z + 0.4 }));
    }
  }
  if (balcony) {
    group.add(box(1.7, 0.1, 0.6, mat(0xcfc4ae), { x, y: y - 0.78, z: z + 0.3 }));
    const iron = mat(0x2a2a2e, { roughness: 0.5, metalness: 0.4 });
    group.add(box(1.7, 0.05, 0.05, iron, { x, y: y - 0.25, z: z + 0.58 }));
    for (let i = 0; i <= 8; i++) group.add(box(0.03, 0.5, 0.03, iron, { x: x - 0.8 + i * 0.2, y: y - 0.5, z: z + 0.58 }));
  }
}

function house(x, width, floors, { awning = null, sign = null, step = 0 } = {}) {
  const g = new THREE.Group();
  const depth = 5;
  const height = floors * 2.3 + 0.6 + step * 0.6; // staggered houses also differ a touch in height
  const facade = pick(FACADES);
  const shutter = pick(SHUTTERS);
  g.add(box(width, height, depth, mat(0xffffff, { ...plaster(facade), bumpScale: 1.2, roughness: 0.92 }), { y: height / 2 }));
  // stone band at the bottom and a cornice under the roof
  g.add(box(width + 0.05, 0.5 + step, depth + 0.05, mat(0xcfc4ae), { y: (0.5 + step) / 2 }));
  g.add(box(width + 0.3, 0.18, depth + 0.3, mat(0xf3ece0), { y: height }));
  const r = roof(width, depth);
  r.position.y = height + 0.09;
  g.add(r);
  // a chimney
  g.add(box(0.6, 1.4, 0.6, mat(0xffffff, { ...plaster(facade), bumpScale: 1.2, roughness: 0.92 }), { x: width * 0.25, y: height + width * 0.3, z: -0.8 }));

  const front = depth / 2;
  const cols = Math.max(1, Math.round(width / 2.2));
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const wx = -width / 2 + (c + 0.5) * (width / cols);
      const wy = 1.55 + f * 2.3;
      if (f === 0 && c === Math.floor(cols / 2)) {
        // the door: wood panels, a stone step and a little lamp
        g.add(box(1.2, 2.1, 0.12, mat(0xffffff, { ...WOOD, bumpScale: 2, roughness: 0.75 }), { x: wx, y: 1.05 + 0.05, z: front + 0.03 }));
        g.add(box(1.5, 0.15, 0.6, mat(0xcfc4ae), { x: wx, y: 0.08, z: front + 0.3 }));
        g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), mat(0xd4a64a, { metalness: 0.8, roughness: 0.3 }), { x: wx + 0.4, y: 1.1, z: front + 0.12 }));
        continue;
      }
      windowAt(g, wx, wy, front, shutter, { planter: f === 1 && !sign && rand() < 0.6, balcony: f === 2 && rand() < 0.5 });
    }
  }
  if (awning) {
    // a striped shop awning over the ground floor
    const stripes = canvasTexture(256, 64, (ctx, w, h) => {
      for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : awning; ctx.fillRect(i * w / 8, 0, w / 8, h); }
    });
    const a = box(width - 0.4, 0.06, 1.4, mat(0xffffff, { map: stripes }), { y: 2.6, z: front + 0.7 });
    a.rotation.x = 0.35;
    g.add(a);
  }
  if (sign) {
    const tex = canvasTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#1f3b33'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#f1e3c2'; ctx.font = 'italic 700 58px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(sign, w / 2, h / 2 + 4);
    });
    // well in front of the window frames behind it, so the two never share a surface
    g.add(box(Math.min(width - 0.6, 3.6), 0.6, 0.08, mat(0xffffff, { map: tex }), { y: 3.15, z: front + 0.3 }));
  }
  // neighbours sit slightly forward/back so their overhangs never share a surface (that flickers)
  g.position.set(x, 1.25, -8 + step);
  scene.add(g);
  return width;
}

let hx = -6;
let houseIndex = 0;
for (const spec of [
  [4.6, 3, {}], [5.2, 4, { awning: '#c8423a', sign: 'Boulangerie' }], [4.2, 3, {}], [5.6, 4, { awning: '#2f6f8f', sign: 'Café du Port' }],
  [4.4, 3, {}], [5, 4, {}], [4.6, 3, { awning: '#4f8a3a', sign: 'Fleurs' }], [5.4, 4, {}],
]) {
  const [w, floors, extras] = spec;
  house(hx + w / 2, w, floors, { ...extras, step: (houseIndex++ % 2) * 0.12 });
  hx += w + 0.02;
}

/* ---------- tree, café, lamp, bits ---------- */

function lumpySphere(r, color) {
  const geo = new THREE.SphereGeometry(r, 40, 28); // indexed, so the bumps shade smoothly
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.08 * Math.sin(v.x * 3.1) * Math.cos(v.y * 2.7) + 0.05 * Math.sin(v.z * 4.3);
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return mesh(geo, mat(color, { roughness: 0.95 }));
}

// 3D value noise for bumpy leaf clumps
function vnoise(x, y, z) {
  const h = (i, j, k) => { const n = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return n - Math.floor(n); };
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const ux = (t) => t * t * (3 - 2 * t);
  const tx = ux(x - fx), ty = ux(y - fy), tz = ux(z - fz);
  let v = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    v += h(fx + i, fy + j, fz + k) * (i ? tx : 1 - tx) * (j ? ty : 1 - ty) * (k ? tz : 1 - tz);
  }
  return v;
}

const LEAF = mat(0xffffff, { vertexColors: true, roughness: 0.95 });

/** One leafy clump: a bumpy sphere, lighter on top and darker underneath */
function clump(r, seed, hue) {
  const geo = new THREE.SphereGeometry(r, 36, 26);
  const p = geo.attributes.position;
  const colors = [];
  const v = new THREE.Vector3();
  const base = new THREE.Color().setHSL(hue, 0.5, 0.33);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = vnoise(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6) * 0.5 + vnoise(v.x * 4 + seed, v.y * 4, v.z * 4) * 0.25;
    v.multiplyScalar(0.82 + n * 0.45);
    p.setXYZ(i, v.x, v.y, v.z);
    const up = (v.y / r + 1) / 2; // 0 underneath … 1 on top
    const c = base.clone().offsetHSL((n - 0.35) * 0.05, 0, (up - 0.5) * 0.16 + (n - 0.35) * 0.12);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return mesh(geo, LEAF);
}

/** A trunk or branch: a tapering tube along a curve */
function limb(points, r0, r1, material) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)));
  const geo = new THREE.TubeGeometry(curve, 24, 1, 10, false);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const segs = 25; const ring = 11;
  for (let i = 0; i < p.count; i++) {
    const s = Math.floor(i / ring) / (segs - 1);
    const centre = curve.getPointAt(Math.min(1, s));
    v.fromBufferAttribute(p, i).sub(centre).multiplyScalar(r0 + (r1 - r0) * s).add(centre);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return mesh(geo, material);
}

function tree(x, z, s = 1) {
  const g = new THREE.Group();
  const bark = mat(0x6b4a33, { roughness: 1 });
  g.add(limb([[0, 0, 0], [0.15, 1.5, 0], [-0.1, 3, 0.1], [0, 4, 0]], 0.42, 0.22, bark));
  const branches = [
    [[0, 3, 0], [-1, 4, 0.3], [-1.9, 4.9, 0.4]], [[0, 3.3, 0], [1.1, 4.3, -0.2], [2, 5, -0.3]],
    [[0, 3.8, 0], [0.2, 5, 0.9], [0.3, 5.8, 1.3]], [[0, 3.8, 0], [-0.3, 5.1, -0.9], [-0.4, 6, -1.2]],
  ];
  for (const b of branches) g.add(limb(b, 0.16, 0.06, bark));
  // the crown: big clumps around the branch tips, smaller ones filling in
  const spots = [[-1.9, 5.1, 0.4, 1.5], [2, 5.2, -0.3, 1.5], [0.3, 6, 1.3, 1.4], [-0.4, 6.2, -1.2, 1.4],
    [0, 6.9, 0, 1.6], [-1.1, 6.3, 0.9, 1.1], [1.2, 6.4, 0.8, 1.1], [1, 5.6, -1.4, 1.1], [-1.4, 5.6, -1.2, 1.0],
    [0, 5.2, 1.6, 1.0], [2.2, 6.2, 0.4, 0.9], [-2.3, 6, -0.3, 0.9], [0.4, 7.6, 0.5, 1.0]];
  spots.forEach(([cx, cy, cz, r], i) => g.add(clump(r, i * 7.3 + x, 0.27 + (i % 3) * 0.015).translateX(cx).translateY(cy).translateZ(cz)));
  g.scale.setScalar(s);
  g.position.set(x, 1.25, z);
  scene.add(g);
}
tree(-9, -3.6, 1.15);
tree(26, -3.6, 0.9);

function chair(x, z, ry) {
  const g = new THREE.Group();
  const red = mat(0xc8423a, { roughness: 0.6 });
  g.add(box(0.5, 0.06, 0.5, red, { y: 0.48 }));
  g.add(box(0.5, 0.55, 0.06, red, { y: 0.78, z: -0.22 }));
  for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) g.add(box(0.05, 0.48, 0.05, red, { x: lx, y: 0.24, z: lz }));
  g.position.set(x, 0, z); g.rotation.y = ry;
  scene.add(g);
}
function cafeTable(x, z) {
  const iron = mat(0x2a2a2e, { roughness: 0.5, metalness: 0.4 });
  scene.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 20), mat(0xf3ece0), { x, y: 0.75, z }));
  scene.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8), iron, { x, y: 0.37, z }));
  scene.add(mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), iron, { x, y: 0.02, z }));
  chair(x - 0.7, z, Math.PI / 2);
  chair(x + 0.7, z, -Math.PI / 2);
}
cafeTable(8.2, 1.2);
cafeTable(10.6, 1.6);

// a parasol over one table
scene.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), mat(0xe8e1d2), { x: 10.6, y: 1.2, z: 1.6 }));
scene.add(mesh(new THREE.ConeGeometry(1.5, 0.5, 12, 1, true), mat(0xe9f1f2, { side: THREE.DoubleSide }), { x: 10.6, y: 2.45, z: 1.6 }));

function lamp(x, z) {
  const iron = mat(0x24272b, { roughness: 0.45, metalness: 0.5 });
  scene.add(mesh(new THREE.CylinderGeometry(0.08, 0.14, 4.2, 10), iron, { x, y: 2.1, z }));
  scene.add(mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 10), iron, { x, y: 0.15, z }));
  scene.add(mesh(new THREE.CylinderGeometry(0.28, 0.18, 0.6, 6), mat(0xfff2c4, { emissive: 0xffc070, emissiveIntensity: 2.2 }), { x, y: 4.5, z }));
  scene.add(mesh(new THREE.ConeGeometry(0.36, 0.3, 6), iron, { x, y: 4.95, z }));
}
lamp(1.5, 2.5);
lamp(18, 2.5);

for (let i = 0; i < 5; i++) {
  // bollards along the sea wall
  scene.add(mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.8, 12), mat(0x3a3d42, { roughness: 0.5, metalness: 0.3 }), { x: -15.3, y: 0.4, z: -8 + i * 4 }));
}
for (const [x, z] of [[3.2, -1.3], [14.5, -1.3], [21, -1.3]]) {
  // terracotta pots with round shrubs on the terrace edge
  scene.add(mesh(new THREE.CylinderGeometry(0.45, 0.32, 0.7, 14), mat(0xb85c38), { x, y: 1.6, z }));
  scene.add(lumpySphere(0.6, 0x5c9c45).translateX(x).translateY(2.35).translateZ(z));
}
// a bench facing the sea
const bench = mat(0x6b8f4e, { roughness: 0.6 });
scene.add(box(2.2, 0.08, 0.5, bench, { x: -12.5, y: 0.5, z: 3, ry: Math.PI / 2 }));
scene.add(box(2.2, 0.5, 0.08, bench, { x: -12.25, y: 0.85, z: 3, ry: Math.PI / 2 }));
for (const dz of [-0.9, 0.9]) scene.add(box(0.5, 0.5, 0.08, mat(0x2a2a2e), { x: -12.5, y: 0.25, z: 3 + dz, ry: Math.PI / 2 }));

/* ---------- light: low warm sun, purple sky fill, glowing lamps and windows ---------- */

scene.add(new THREE.HemisphereLight(0xc4b6c8, 0x7a5a48, 1.3)); // soft lilac evening sky, not too purple on the ground
const sun = new THREE.DirectionalLight(0xffa868, 3.2);
sun.position.copy(SUN_DIR).multiplyScalar(80).add(new THREE.Vector3(4, 0, -4));
sun.target.position.set(4, 0, -4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -25, near: 1, far: 200 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 7;
sun.shadow.blurSamples = 16;
scene.add(sun, sun.target);
// a cool bounce from the sky on the side away from the sun, so shadows read blue-purple, not grey
const bounce = new THREE.DirectionalLight(0xa8b4e0, 0.45);
bounce.position.set(30, 25, 40);
scene.add(bounce);
for (const [x, z] of [[1.5, 2.5], [18, 2.5]]) {
  const glow = new THREE.PointLight(0xffb060, 6, 9, 1.6);
  glow.position.set(x, 4.5, z);
  scene.add(glow);
}

// reflections for the sea and metal: an environment made from the sky
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.add(sky.clone());
scene.environment = pmrem.fromScene(envScene, 0.04).texture;
scene.environmentIntensity = 0.35;

/* ---------- bake: merge every static piece into one mesh per look (thousands of draws → a few dozen) ---------- */

function bakeStatic() {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  const keep = new Set([sky, sea, cloudLayer]);
  scene.traverse((o) => {
    if (!o.isMesh || keep.has(o) || o.material.isShaderMaterial) return;
    const m = o.material;
    const key = [m.color.getHexString(), m.emissive && m.emissive.getHexString(), m.emissiveIntensity, m.roughness, m.metalness,
      m.map ? m.map.uuid : '', m.bumpMap ? m.bumpMap.uuid : '', m.bumpScale, m.vertexColors, m.side, m.flatShading, o.castShadow].join('|');
    if (!groups.has(key)) groups.set(key, { material: m, castShadow: o.castShadow, geos: [] });
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m.vertexColors && !g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
    if (!m.vertexColors) g.deleteAttribute('color');
    g.applyMatrix4(o.matrixWorld);
    groups.get(key).geos.push(g);
    o.userData.baked = true;
  });
  const old = [];
  scene.traverse((o) => { if (o.userData.baked) old.push(o); });
  old.forEach((o) => o.parent.remove(o));
  for (const { material, castShadow, geos } of groups.values()) {
    const merged = new THREE.Mesh(mergeGeometries(geos), material);
    merged.castShadow = castShadow;
    merged.receiveShadow = true;
    merged.matrixAutoUpdate = false;
    scene.add(merged);
  }
  // empty groups left behind
  [...scene.children].forEach((c) => { if (c.isGroup && !c.children.length) scene.remove(c); });
  renderer.shadowMap.needsUpdate = true;
  return groups.size;
}
const looks = bakeStatic();

/* ---------- finishing: ambient occlusion, anti-aliasing, a warm grade with a vignette ---------- */

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 0 }));
composer.addPass(new RenderPass(scene, camera));
const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1.5, scale: 1.2, samples: 16 });
ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
ao.blendIntensity = 0.85;
composer.addPass(ao);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.12);                                   // a touch more colour
      c = mix(c * vec3(0.92, 0.94, 1.06), c * vec3(1.06, 1.0, 0.92), smoothstep(0.15, 0.75, l)); // cool shadows, warm highlights
      c = (c - 0.5) * 1.06 + 0.5;                                  // gentle contrast
      float v = smoothstep(1.05, 0.35, length(vUv - 0.5) * 1.25);   // vignette
      c *= mix(0.78, 1.0, v);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
});
composer.addPass(grade);
const smaa = new SMAAPass(window.innerWidth, window.innerHeight);
composer.addPass(smaa);
function sizeComposer() {
  composer.setSize(window.innerWidth, window.innerHeight);
}
sizeComposer();
window.addEventListener('resize', sizeComposer);
window.__v = { renderer, composer, ao, scene, camera, cloudLayer, sea, sun, cloudScene, cloudTarget }; // dev: poke at the scene from the console
console.log('baked into', looks, 'meshes');

/* ---------- a very gentle sway, waves and drifting clouds ---------- */

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  const sway = Math.sin(t * 0.05) * 0.4; // tiny, so it stays square-on
  camera.position.set(CAM_BASE.x + sway, CAM_BASE.y + Math.sin(t * 0.07) * 0.08, CAM_BASE.z);
  camera.lookAt(LOOK.x + sway, LOOK.y, LOOK.z);

  const p = seaGeo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = seaBase[i * 3]; const y = seaBase[i * 3 + 1];
    p.setZ(i, Math.sin(x * 0.15 + t * 0.6) * 0.18 + Math.cos(y * 0.2 + t * 0.4) * 0.14);
  }
  p.needsUpdate = true; // flat shading works out normals itself, no need to recompute them

  cloudMat.uniforms.time.value = t;
  renderer.setRenderTarget(cloudTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(cloudScene, camera);
  renderer.setRenderTarget(null);
  composer.render();
});
