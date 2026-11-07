/**
 * A cozy walk down a little town street at golden hour, in a soft, chunky, hand-made style.
 *
 * The camera stands in the street close to the shopfronts and slides along it (arrow keys / A D, drag, or scroll),
 * passing a bakery and café, a market, a flower corner with a wall fountain, a lane up to a cathedral, a canal
 * bridge, workshops, and finally the town gate opening onto the fields. The framing is tight on purpose: an easel
 * will stand in front of all this, so the street is the backdrop around it.
 *
 * Shapes are chunky and hand-placed, coloured per piece, with the photo-scanned Poly Haven textures from
 * blender/textures laid over the colours as surface detail (stone grain, plaster, wood, clay, iron, bark).
 * Foliage is real leaf cards: thousands of small drawn leaves and petals, instanced.
 *
 * Kept light: bevelled boxes are cheap, everything is merged into chunks along the street (only the ones near the
 * camera are drawn), two small passes do the soft occlusion and the background blur from the depth buffer, and a
 * frame is only drawn when the camera moves.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { startGame } from './game.js';
import { startMusic, startWind } from './music.js';
const windAt = startWind(); // first thing, so it's playing before the scene is built

// AgX with a gentle version of Blender's 'Punchy' look
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('color = agxDefaultContrastApprox( color );', `
	color = agxDefaultContrastApprox( color );
	float agxLuma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = pow( color, vec3( 1.12 ) );
	color = agxLuma + 1.25 * ( color - agxLuma );`);

// the lettering everywhere (chat, names, boards, the room code): loaded before anything is drawn
{
  const face = new FontFace('Cafe Francoise', 'url(fonts/cafe-francoise.otf)');
  document.fonts.add(await face.load());
}

/* ---------- the view ---------- */

// standing in the street a few metres from the shopfronts, looking a touch up; the camera slides along x
const EYE = { y: 1.5, z: 8.0, lookY: 2.7, lookZ: -6, fov: 40 };
const SLIDE = { min: 0, max: 111, start: 3 };
const LOBBY_LIFT = 28; // the game opens up in the sky and comes down onto the lobby

/* ---------- palette ---------- */

const C = {
  stone: ['#d8c4a2', '#cfb995', '#dccbab', '#c9b28e'],
  stoneGrey: ['#b5ab9e', '#aaa094', '#bdb3a6'],
  flag: ['#b4a793', '#aa9d8a', '#bcae99', '#a8998a'],
  grout: '#4a3d35',
  timber: '#5c3b2b',
  wood: '#a87547',
  woodLight: '#c4935e',
  woodDark: '#7a5136',
  iron: '#2e2a2c',
  terracotta: '#c26a43',
  frame: '#efe4cf',
  leaf: ['#4f7a2f', '#5f8a35', '#6f9a3d', '#86a84a', '#46702b'],
  flower: ['#e66aa6', '#c45bd2', '#f4eef6', '#ff92bb', '#9a6be2', '#f7c94b'],
  bunting: ['#e0584c', '#f2c14e', '#4f9fd1', '#7cc06a', '#f4eee2', '#c06ad1'],
};
const ROOF = {
  slate: ['#6e6878', '#746d80', '#68637a'],
  brown: ['#7a5040', '#82563f', '#74503e'],
  terracotta: ['#b8613f', '#c06846', '#b05c3c'],
};

/* ---------- renderer, scene, camera ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: false });
const DPR = Math.min(2, window.devicePixelRatio || 1);
const Q = new URLSearchParams(location.search); // dev, for comparing speed: ?msaa=0|2|4 &street=0.5 &shadow=1024
const STREET = DPR * (+Q.get('street') || 0.7); // the street (mostly blurred) is drawn at a lower resolution than the screen; the easel paper and boards stay sharp
renderer.setPixelRatio(DPR);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // redrawn only when the camera has moved on
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cddcec', 30, 150);
const camera = new THREE.PerspectiveCamera(EYE.fov, window.innerWidth / window.innerHeight, 0.3, 140);

/* ---------- textures: the Poly Haven scans, used as surface detail over each piece's own colour ---------- */

const TEX = 'blender/textures/';
async function scan(name) {
  const load = async (kind, isColour) => {
    const blob = await (await fetch(`${TEX}${name}_${kind}.jpg`)).blob();
    const bmp = await createImageBitmap(blob, { resizeWidth: 512, resizeHeight: 512, resizeQuality: 'high', imageOrientation: 'flipY' });
    const t = new THREE.Texture(bmp);
    t.flipY = false; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    t.colorSpace = isColour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return { t, bmp };
  };
  const [d, n] = await Promise.all([load('diff', true), load('nor', false)]);
  return { map: d.t, normalMap: n.t, avg: average(d.bmp) };
}
/** the scan's average colour: dividing by it turns the photo into pure detail around 1.0 */
function average(img) {
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
  const p = g.getImageData(0, 0, 8, 8).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < p.length; i += 4) { r += p[i]; gg += p[i + 1]; b += p[i + 2]; }
  return new THREE.Color().setRGB(r / 16320, gg / 16320, b / 16320, THREE.SRGBColorSpace);
}
/** a woven cloth texture for awnings, bunting and banners */
function weave() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 64; i += 4) {
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, i, 64, 2);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(i, 0, 2, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return { map: t, normalMap: null, avg: average(c) };
}
const scans = Object.fromEntries(await Promise.all(Object.entries({
  stone: 'concrete_floor_worn_001', wall: 'castle_wall_varriation', plaster: 'painted_plaster_wall', wood: 'weathered_planks',
  paint: 'distressed_painted_planks', clay: 'clay_plaster', iron: 'metal_plate', bark: 'bark_brown_02',
}).map(async ([k, name]) => [k, await scan(name)])));
scans.cloth = weave();

// each kind of surface: which scan, how many repeats per metre, how strongly it shows, how bumpy, how rough
const MATS = {
  stone: { tex: 'stone', scale: 0.8, amount: 1.6, bump: 1.5, rough: 0.92 }, // the scan is faint: its grain is turned up
  ground: { tex: 'stone', scale: 0.7, amount: 1.5, bump: 1.4, rough: 0.95 },
  ashlar: { tex: 'wall', scale: 0.32, amount: 0.75, bump: 0.8, rough: 0.92 }, // big plain stone fronts (cathedral)
  plaster: { tex: 'plaster', scale: 0.45, amount: 0.7, bump: 0.6, rough: 0.95 },
  wood: { tex: 'wood', scale: 1.1, amount: 0.8, bump: 0.7, rough: 0.85 },
  paint: { tex: 'paint', scale: 1.0, amount: 0.55, bump: 0.6, rough: 0.8 },
  roof: { tex: 'clay', scale: 1.4, amount: 0.6, bump: 0.6, rough: 0.85 },
  clay: { tex: 'clay', scale: 2.0, amount: 0.6, bump: 0.5, rough: 0.9 },
  iron: { tex: 'iron', scale: 2.0, amount: 0.5, bump: 0.5, rough: 0.6 },
  bark: { tex: 'bark', scale: 1.4, amount: 1.0, bump: 1.0, rough: 0.95 },
  cloth: { tex: 'cloth', scale: 5.0, amount: 0.5, bump: 0, rough: 0.95 },
  plain: { tex: null, scale: 1, amount: 0, bump: 0, rough: 0.7 },
};

let dirty = true; // something on screen changed: draw a frame

/* ---------- seeded randomness and a soft noise ---------- */

const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const range = (a, b) => a + rnd() * (b - a);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const soft = (x, y, z) => 0.5 + 0.25 * (Math.sin(x * 2.1 + y * 1.3 + z * 0.7) + Math.sin(z * 1.7 - x * 0.9 + y * 2.3));

/* ---------- building blocks: every piece gets a colour and a surface, then all pieces are merged ---------- */

const solid = [];      // lit, vertex-coloured, textured by kind
const panes = [];      // window glass with a lattice
const water = [];      // still water
const veils = [];      // falling water: see-through

const _v = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
let PARENT = null; // an extra transform for pieces built in a local frame (a house, a stall)
let MAT = 'plain'; // the surface pieces get unless they say otherwise

function colour(c) { return c.isColor ? c.clone() : new THREE.Color(Array.isArray(c) ? pick(c) : c); }
function shade(hex, k) { return colour(hex).multiplyScalar(k); }
function as(mat, build) { const old = MAT; MAT = mat; build(); MAT = old; }

/** a box with softly bevelled edges: 24 corners shared by the faces, the bevels and the corner triangles (44 triangles) */
function softBox(w, h, d, r) {
  const H = [w / 2, h / 2, d / 2];
  r = Math.min(r, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9);
  const pos = [], nor = [], idx = [], ids = new Map();
  for (let a = 0; a < 3; a++) {
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const S = [sx, sy, sz], p = [0, 0, 0], n = [0, 0, 0];
      for (let k = 0; k < 3; k++) p[k] = k === a ? S[k] * H[k] : S[k] * (H[k] - r);
      n[a] = S[a];
      ids.set(`${a}${sx}${sy}${sz}`, pos.length / 3);
      pos.push(...p); nor.push(...n);
    }
  }
  const V = (a, S) => ids.get(`${a}${S[0]}${S[1]}${S[2]}`);
  const tri = (i, j, k) => {
    const P = (q) => new THREE.Vector3(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
    const A = P(i), B = P(j), Cc = P(k);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(Cc, A));
    if (n.dot(A.add(B).add(Cc)) < 0) idx.push(i, k, j); else idx.push(i, j, k);
  };
  const quad = (i, j, k, l) => { tri(i, j, k); tri(i, k, l); };
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const s of [-1, 1]) {
      const S = (sb, sc) => { const t = [0, 0, 0]; t[a] = s; t[b] = sb; t[c] = sc; return t; };
      quad(V(a, S(-1, -1)), V(a, S(1, -1)), V(a, S(1, 1)), V(a, S(-1, 1)));
    }
  }
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const c = 3 - a - b;
    for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
      const S = (sc) => { const t = [0, 0, 0]; t[a] = sa; t[b] = sb; t[c] = sc; return t; };
      quad(V(a, S(-1)), V(a, S(1)), V(b, S(1)), V(b, S(-1)));
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) tri(V(0, [sx, sy, sz]), V(1, [sx, sy, sz]), V(2, [sx, sy, sz]));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

/** small hand-made wobble: every vertex moved by a smooth noise of where it is (so shared corners stay shared) */
function lump(geo, amount) {
  const p = geo.attributes.position;
  const o = rnd() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + (soft(x * 3 + o, y * 3, z * 3) - 0.5) * amount, y + (soft(y * 3, z * 3 + o, x * 3) - 0.5) * amount, z + (soft(z * 3, x * 3, y * 3 + o) - 0.5) * amount);
  }
}

/** every piece gets an id and a note of where it was built, so a piece seen on screen can be traced back (H picks one) */
const PARTS = [null];
const HELPERS = new Set(['partNote', 'put', 'box', 'cyl', 'ball', 'ring', 'lathe', 'slab', 'beam', 'softBox', 'as', 'at', 'withFrame', 'Error']);
function partNote() {
  const out = [];
  for (const ln of (new Error().stack || '').split('\n').slice(1)) {
    const m = ln.match(/at (?:(\S+) )?\(?.*?([\w.-]+\.js):(\d+):\d+\)?$/);
    if (!m || (m[1] && HELPERS.has(m[1]))) continue;
    out.push((m[1] || 'anon') + ' ' + m[2] + ':' + m[3]);
    if (out.length === 4) break;
  }
  return out.join(' < ');
}

function put(geo, c, o = {}) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, wob = 0, vary = 0.04, list = solid, mat = MAT } = o;
  if (wob) lump(geo, wob);
  _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  if (PARENT) geo.applyMatrix4(PARENT);
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
  const base = colour(c), k = 1 + (rnd() - 0.5) * 2 * vary;
  const p = geo.attributes.position, n = geo.attributes.normal;
  const cols = new Float32Array(p.count * 3), uv = new Float32Array(p.count * 2);
  // box-projected texture coordinates in world space, shifted per piece so neighbours don't repeat each other
  const s = MATS[mat].scale, ou = rnd() * 7, ov = rnd() * 7;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const f = k * (0.96 + 0.08 * soft(px * 1.7, py * 1.7, pz * 1.7));
    cols[i * 3] = base.r * f; cols[i * 3 + 1] = base.g * f; cols[i * 3 + 2] = base.b * f;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = px; v = pz; } else if (ax >= az) { u = pz; v = py; } else { u = px; v = py; }
    uv[i * 2] = u * s + ou; uv[i * 2 + 1] = v * s + ov;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const id = PARTS.length;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, bc = bb.getCenter(new THREE.Vector3()), bs = bb.getSize(new THREE.Vector3());
  PARTS.push({ id, shape: geo.type.replace('Geometry', ''), mat, hex: '#' + base.getHexString(), at: bc.toArray().map((n) => +n.toFixed(2)), size: bs.toArray().map((n) => +n.toFixed(2)), from: partNote() });
  geo.setAttribute('part', new THREE.BufferAttribute(new Float32Array(p.count).fill(id), 1));
  geo.userData.mat = mat;
  list.push(geo);
  return geo;
}

function box(w, h, d, c, o = {}) {
  // small or thin pieces don't show a bevel at this distance: a plain box (12 triangles) does
  const plain = Math.min(w, h, d) < 0.1 || Math.max(w, h, d) < 0.3 || o.r === 0;
  return put(plain ? new THREE.BoxGeometry(w, h, d) : softBox(w, h, d, o.r ?? 0.05), c, o);
}
function cyl(rt, rb, h, c, o = {}) {
  return put(new THREE.CylinderGeometry(rt, rb, h, o.n ?? 12, 1, o.open ?? false, o.t0 ?? 0, o.tl ?? Math.PI * 2), c, o);
}
function ball(r, c, o = {}) { return put(new THREE.SphereGeometry(r, o.n ?? 8, o.m ?? 6), c, o); }
function ring(R, r, c, o = {}) { return put(new THREE.TorusGeometry(R, r, 5, o.n ?? 14), c, o); }
function lathe(profile, c, o = {}) { return put(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), o.n ?? 12), c, o); }
/** a flat shape (points in X/Y) given some thickness along Z */
function slab(points, depth, c, o = {}) {
  const shape = new THREE.Shape(points.map(([a, b]) => new THREE.Vector2(a, b)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  return put(geo, c, o);
}
/** a box from one point to another (beams, braces, rails) */
function beam(x1, y1, x2, y2, t, d, c, o = {}) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return box(len, t, d, c, { ...o, x: (x1 + x2) / 2, y: (y1 + y2) / 2, rz: Math.atan2(y2 - y1, x2 - x1) });
}
function withFrame(matrix, build) { const old = PARENT; PARENT = old ? old.clone().multiply(matrix) : matrix; build(); PARENT = old; }
const frameAt = (x, y, z, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(1, 1, 1));
const at = (x, y, z, ry, build) => withFrame(frameAt(x, y, z, ry), build);

function pane(w, h, x, y, z) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * (w / 0.3) + 0.5, (uv.getY(i) - 0.5) * (h / 0.3) + 0.5);
  g.translate(x, y, z);
  if (PARENT) g.applyMatrix4(PARENT);
  panes.push(g);
}
function roundPane(r, x, y, z) {
  const g = new THREE.CircleGeometry(r, 28);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * (2 * r / 0.3) + 0.5, (uv.getY(i) - 0.5) * (2 * r / 0.3) + 0.5);
  g.translate(x, y, z);
  if (PARENT) g.applyMatrix4(PARENT);
  panes.push(g);
}

/* ---------- foliage: real leaf cards and petals, scattered over soft shapes ---------- */

const leafCards = [], petalCards = [];
const _up = new THREE.Vector3(0, 1, 0);
/** one card at p, facing roughly n, `size` tall */
function card(list, p, n, size, tint, aspect = 0.6) {
  const z = n.clone().add(new THREE.Vector3(range(-0.55, 0.55), range(-0.55, 0.55), range(-0.55, 0.55))).normalize();
  const x = new THREE.Vector3(range(-1, 1), range(-1, 1), range(-1, 1)).cross(z);
  if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
  x.normalize();
  const y = z.clone().cross(x);
  const m = new THREE.Matrix4().makeBasis(x.multiplyScalar(size * aspect), y.multiplyScalar(size), z.multiplyScalar(size)).setPosition(p);
  if (PARENT) m.premultiply(PARENT);
  list.push({ m, c: tint });
}
/** a soft ellipsoid of leaves (lighter on top), with flowers scattered over its upper side */
function leaves(cx, cy, cz, rx, ry, rz, count, { tones = C.leaf, size = 0.16, flowers = 0, flowerTones = C.flower, flowerSize = 0.1, lowest = -1 } = {}) {
  for (let i = 0; i < count; i++) {
    const u = rnd() * Math.PI * 2, h = range(lowest, 1), r = Math.sqrt(1 - h * h), k = range(0.7, 1);
    const d = new THREE.Vector3(Math.cos(u) * r, h, Math.sin(u) * r);
    const p = new THREE.Vector3(cx + d.x * rx * k, cy + d.y * ry * k, cz + d.z * rz * k);
    const n = new THREE.Vector3(d.x / rx, d.y / ry, d.z / rz).normalize();
    const tint = colour(tones).multiplyScalar((0.78 + 0.32 * (h * 0.5 + 0.5)) * range(0.9, 1.1));
    card(leafCards, p, n, size * range(0.75, 1.25), tint);
  }
  for (let i = 0; i < flowers; i++) {
    const u = rnd() * Math.PI * 2, h = range(0.1, 1), r = Math.sqrt(1 - h * h);
    const d = new THREE.Vector3(Math.cos(u) * r, h, Math.sin(u) * r);
    const p = new THREE.Vector3(cx + d.x * rx * 1.02, cy + d.y * ry * 1.02, cz + d.z * rz * 1.02);
    card(petalCards, p, d.clone().add(_up).normalize(), flowerSize * range(0.8, 1.2), colour(Array.isArray(flowerTones) ? pick(flowerTones) : flowerTones), 1);
  }
}

/** flowers spilling over a box or pot: leaves with blooms on top */
function flowers(x, y, z, width, depth = 0.3, opts = {}) {
  const tones = [pick(C.flower), pick(C.flower)];
  leaves(x, y + 0.14, z, width / 2, 0.22, depth / 2 + 0.04, Math.round(width * 80), { size: 0.14, flowers: Math.round(width * 22), flowerTones: tones, flowerSize: 0.12, lowest: -0.4, ...opts });
}

/** ivy climbing a wall (the wall's own frame: wall at zWall), with a few small flowers */
function vine(x, zWall, y0, y1) {
  let vx = x;
  for (let y = y0; y < y1; y += 0.3) {
    vx += range(-0.1, 0.1);
    leaves(vx, y, zWall + 0.1, 0.3, 0.2, 0.08, 16, { size: 0.12, flowers: rnd() < 0.4 ? 2 : 0, flowerTones: ['#c45bd2', '#9a6be2', '#f4eef6'], flowerSize: 0.07 });
  }
}

function tree(x, z, s = 1) {
  const limb = (pts, r0, r1) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([a, b, c]) => new THREE.Vector3(x + a * s, b * s, z + c * s)));
    const SEG = 12, RING = 7;
    const geo = new THREE.TubeGeometry(curve, SEG, 1, RING, false);
    const p = geo.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const t = Math.floor(i / (RING + 1)) / SEG, c = curve.getPointAt(Math.min(1, t));
      v.fromBufferAttribute(p, i).sub(c).multiplyScalar((r0 + (r1 - r0) * t) * s).add(c);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    put(geo, '#6a4e3c', { wob: 0.04, mat: 'bark' });
  };
  limb([[0, 0, 0], [0.2, 1.6, 0], [-0.1, 3.2, 0.1], [0.1, 4.4, 0]], 0.34, 0.18);
  limb([[0, 3.2, 0], [-1.0, 4.2, 0.3], [-1.8, 5.0, 0.4]], 0.13, 0.05);
  limb([[0, 3.5, 0], [1.1, 4.4, -0.2], [1.9, 5.2, -0.3]], 0.13, 0.05);
  for (const [cx, cy, cz, r] of [[-1.8, 5.3, 0.3, 1.25], [1.9, 5.5, -0.2, 1.25], [0, 6.4, 0, 1.6], [-0.8, 5.9, 0.9, 1.1], [0.9, 6.0, 0.9, 1.1], [0, 5.3, -1.0, 1.15]]) {
    leaves(x + cx * s, cy * s, z + cz * s, r * s, r * s * 0.85, r * s, Math.round(330 * r * r), { size: 0.24 * s, tones: ['#56822f', '#4b7429', '#679340', '#7da04a', '#5a8a36'] });
  }
}

/* ---------- small things ---------- */

function pumpkin(x, y, z, r, c = pick(['#e8822a', '#f09a3a', '#e07a22', '#dca546'])) {
  const g = new THREE.SphereGeometry(r, 12, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const k = 1 + 0.07 * Math.cos(8 * Math.atan2(pz, px));
    p.setXYZ(i, px * k, py * 0.72, pz * k);
  }
  put(g, c, { x, y: y + r * 0.72, z, ry: rnd() * 6, mat: 'plain' });
  cyl(0.1 * r, 0.14 * r, r * 0.4, '#6b5a2e', { x, y: y + r * 1.5, z, rz: range(-0.3, 0.3), n: 5, mat: 'wood' });
}

function pile(x, y, z, w, d, r, colours, mound = 0.12) {
  const nx = Math.max(1, Math.floor(w / (r * 1.9))), nz = Math.max(1, Math.floor(d / (r * 1.9)));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const u = (i + 0.5) / nx - 0.5, v = (j + 0.5) / nz - 0.5;
    const h = mound * (1 - (u * u + v * v) * 3);
    ball(r * range(0.9, 1.1), colours, { x: x + u * w + range(-0.02, 0.02), y: y + r + Math.max(0, h), z: z + v * d, n: 7, m: 5, vary: 0.1, mat: 'plain' });
  }
}

function crate(x, y, z, w, d, h, fill = null) {
  const c = rnd() < 0.5 ? C.woodLight : C.wood;
  as('wood', () => {
    box(w, 0.05, d, c, { x, y: y + 0.025, z });
    for (const s of [-1, 1]) {
      box(w, h * 0.9, 0.04, c, { x, y: y + h * 0.5, z: z + s * (d / 2 - 0.02) });
      box(0.04, h * 0.9, d - 0.08, c, { x: x + s * (w / 2 - 0.02), y: y + h * 0.5, z });
    }
  });
  if (fill) pile(x, y + h * 0.55, z, w - 0.08, d - 0.08, fill.r, fill.c, fill.mound ?? 0.1);
}

function basket(x, y, z, r, h, fill = null) {
  lathe([[r * 0.8, 0], [r, h * 0.3], [r * 1.05, h], [r * 1.12, h], [r * 1.0, h * 1.02]], '#b88a52', { x, y, z, mat: 'wood' });
  if (fill) pile(x, y + h * 0.5, z, r * 1.5, r * 1.5, fill.r, fill.c, fill.mound ?? 0.08);
}

function barrel(x, z, s = 1, y = 0) {
  const prof = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push([(0.34 + 0.07 * Math.sin(Math.PI * t)) * s, t * 0.95 * s]); }
  prof.push([0.3 * s, 0.95 * s], [0, 0.95 * s]);
  lathe(prof, pick([C.wood, C.woodDark]), { x, y: y + 0.04, z, n: 14, mat: 'wood' });
  for (const t of [0.15, 0.82]) ring((0.34 + 0.07 * Math.sin(Math.PI * t)) * s + 0.01, 0.022 * s, '#4a4142', { x, y: y + 0.04 + t * 0.95 * s, z, rx: Math.PI / 2, mat: 'iron' });
}

function sack(x, z, c = '#d8c29a') {
  as('cloth', () => {
    ball(0.3, c, { x, y: 0.33, z, sy: 1.15, sx: 0.95, n: 9, m: 7, wob: 0.06 });
    cyl(0.06, 0.12, 0.14, c, { x, y: 0.7, z, n: 8 });
  });
}

/** a lantern: iron cap, pale glass, cage bars (unlit: it is still day) */
function lantern(x, y, z, s = 1) {
  as('iron', () => {
    cyl(0.03 * s, 0.25 * s, 0.22 * s, C.iron, { x, y: y + 0.32 * s, z, n: 6 });
    cyl(0.04 * s, 0.04 * s, 0.1 * s, C.iron, { x, y: y + 0.47 * s, z, n: 6 });
    cyl(0.15 * s, 0.09 * s, 0.08 * s, C.iron, { x, y: y - 0.24 * s, z, n: 6 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      box(0.025 * s, 0.44 * s, 0.025 * s, C.iron, { x: x + Math.cos(a) * 0.165 * s, y, z: z + Math.sin(a) * 0.165 * s, r: 0 });
    }
  });
  cyl(0.15 * s, 0.12 * s, 0.4 * s, '#f3dcc2', { x, y, z, n: 6, vary: 0.02, mat: 'plain' });
}

function wallLantern(x, y, zWall) {
  as('iron', () => {
    box(0.07, 0.07, 0.5, C.iron, { x, y: y + 0.5, z: zWall + 0.25 });
    box(0.16, 0.3, 0.05, C.iron, { x, y: y + 0.42, z: zWall + 0.03 });
  });
  lantern(x, y, zWall + 0.48, 0.9);
}

function lampPost(x, z) {
  as('iron', () => {
    cyl(0.24, 0.3, 0.4, C.iron, { x, y: 0.2, z, n: 8 });
    cyl(0.07, 0.09, 4.3, C.iron, { x, y: 2.5, z, n: 8 });
    for (const yy of [0.5, 1.4, 4.4]) cyl(0.12, 0.12, 0.08, C.iron, { x, y: yy, z, n: 8 });
    ball(0.12, C.iron, { x, y: 4.75, z });
    box(1.1, 0.08, 0.08, C.iron, { x: x + 0.5, y: 4.45, z });
    box(0.03, 0.4, 0.03, C.iron, { x: x + 0.95, y: 4.22, z, r: 0 });
  });
  lantern(x + 0.95, 3.55, z, 1.15);
}

function bunting(x1, y1, x2, y2, z, sag = 1.0, colours = C.bunting) {
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector3(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t - sag * 4 * t * (1 - t), z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  put(new THREE.TubeGeometry(curve, 32, 0.016, 4, false), '#5a4a42', { mat: 'plain' });
  const n = Math.floor(curve.getLength() / 0.55);
  for (let i = 1; i < n; i++) {
    const t = i / n, p = curve.getPointAt(t), tan = curve.getTangentAt(t);
    slab([[-0.16, 0], [0.16, 0], [0, -0.4]], 0.015, colours[i % colours.length], { x: p.x, y: p.y, z: p.z, rz: Math.atan2(tan.y, tan.x), vary: 0.03, mat: 'cloth' });
  }
}

function bench(x, z, ry = 0) {
  at(x, 0, z, ry, () => as('wood', () => {
    for (let i = 0; i < 3; i++) box(1.8, 0.07, 0.15, C.wood, { y: 0.48, z: -0.17 + i * 0.17 });
    for (let i = 0; i < 2; i++) box(1.8, 0.14, 0.06, C.wood, { y: 0.75 + i * 0.22, z: -0.3, rx: -0.15 });
    for (const s of [-1, 1]) {
      box(0.1, 0.48, 0.1, C.woodDark, { x: s * 0.75, y: 0.24, z: 0.15 });
      box(0.1, 1.05, 0.1, C.woodDark, { x: s * 0.75, y: 0.52, z: -0.3 });
    }
  }));
}

function armchair(x, z, ry) {
  at(x, 0, z, ry, () => as('wood', () => {
    const c = pick([C.woodLight, '#c99a5e', '#b98552']);
    box(0.62, 0.09, 0.58, c, { y: 0.5 });
    for (const [lx, lz] of [[-0.26, -0.24], [0.26, -0.24], [-0.26, 0.24], [0.26, 0.24]]) box(0.08, 0.5, 0.08, c, { x: lx, y: 0.25, z: lz });
    for (const s of [-1, 1]) {
      box(0.08, 0.95, 0.08, c, { x: s * 0.27, y: 0.95, z: -0.26 });
      box(0.09, 0.07, 0.6, c, { x: s * 0.3, y: 0.82 });
      box(0.07, 0.3, 0.07, c, { x: s * 0.3, y: 0.66, z: 0.22 });
    }
    for (let i = 0; i < 4; i++) box(0.1, 0.62, 0.05, c, { x: -0.18 + i * 0.12, y: 1.05, z: -0.27 });
    box(0.62, 0.1, 0.07, c, { y: 1.42, z: -0.27 });
  }));
}

function candleTable(x, z) {
  barrel(x, z, 1.05);
  cyl(0.46, 0.46, 0.07, C.woodLight, { x, y: 1.04, z, n: 16, mat: 'wood' });
  for (const [dx, dz, h] of [[-0.12, 0.05, 0.32], [0.08, -0.08, 0.24], [0.14, 0.12, 0.18]]) cyl(0.045, 0.05, h, '#f1e6cf', { x: x + dx, y: 1.08 + h / 2, z: z + dz, n: 8, mat: 'plain' });
}

function pot(x, z, s = 1) {
  lathe([[0.2 * s, 0], [0.24 * s, 0.05 * s], [0.28 * s, 0.36 * s], [0.31 * s, 0.4 * s], [0.31 * s, 0.44 * s], [0.25 * s, 0.44 * s]], C.terracotta, { x, y: 0, z, n: 14, mat: 'clay' });
  cyl(0.26 * s, 0.26 * s, 0.04 * s, '#4a3326', { x, y: 0.4 * s, z, n: 14, mat: 'clay' }); // the soil, a little below the rim
  flowers(x, 0.44 * s, z, 0.55 * s, 0.5 * s);
}

/** a striped awning over a shop window, with a scalloped edge */
function awning(cx, w, y, zWall, a, b) {
  const depth = 1.15, drop = 0.5, slope = Math.atan2(drop, depth), len = Math.hypot(drop, depth);
  const n = Math.max(4, Math.round(w / 0.36)), sw = w / n;
  as('cloth', () => {
    for (let i = 0; i < n; i++) {
      const x = cx - w / 2 + (i + 0.5) * sw;
      box(sw + 0.005, 0.05, len, i % 2 ? b : a, { x, y: y - drop / 2, z: zWall + depth / 2, rx: slope, r: 0.02, vary: 0.02 });
      cyl(sw / 2, sw / 2, 0.05, i % 2 ? b : a, { x, y: y - drop - 0.04, z: zWall + depth + 0.02, rx: Math.PI / 2, t0: -Math.PI / 2, tl: Math.PI, n: 8, vary: 0.02 });
    }
    box(w + 0.1, 0.12, 0.07, a, { x: cx, y: y - drop, z: zWall + depth + 0.03 });
  });
}

/* ---------- hanging shop signs, each with a little painted picture ---------- */

const signs = [];
function signTexture(icon) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#ead9b6'; g.beginPath(); g.roundRect(6, 6, 244, 180, 22); g.fill();
  g.strokeStyle = '#6b4a2c'; g.lineWidth = 10; g.stroke();
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (icon === 'bread') {
    g.fillStyle = '#c98a45'; g.beginPath(); g.ellipse(128, 104, 78, 40, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a5426'; g.lineWidth = 8;
    for (const x of [92, 128, 164]) { g.beginPath(); g.moveTo(x - 14, 84); g.quadraticCurveTo(x, 104, x + 14, 124); g.stroke(); }
  } else if (icon === 'cup') {
    g.fillStyle = '#4f8a86'; g.beginPath(); g.roundRect(84, 76, 76, 78, 12); g.fill();
    g.strokeStyle = '#4f8a86'; g.lineWidth = 12; g.beginPath(); g.arc(166, 112, 20, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.strokeStyle = '#9a8a7a'; g.lineWidth = 7;
    for (const x of [104, 140]) { g.beginPath(); g.moveTo(x, 64); g.bezierCurveTo(x - 12, 52, x + 12, 42, x, 30); g.stroke(); }
  } else if (icon === 'flower') {
    g.strokeStyle = '#5f8f3e'; g.lineWidth = 9; g.beginPath(); g.moveTo(128, 104); g.lineTo(128, 172); g.stroke();
    g.fillStyle = '#6f9f45'; g.beginPath(); g.ellipse(150, 146, 22, 10, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#e66aa6';
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.arc(128 + Math.cos(a) * 30, 84 + Math.sin(a) * 30, 22, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#f2c14e'; g.beginPath(); g.arc(128, 84, 20, 0, Math.PI * 2); g.fill();
  } else if (icon === 'pot') {
    g.fillStyle = '#c26a43'; g.beginPath();
    g.moveTo(104, 44); g.lineTo(152, 44); g.lineTo(146, 64); g.bezierCurveTo(196, 86, 182, 160, 150, 166); g.lineTo(106, 166); g.bezierCurveTo(74, 160, 60, 86, 110, 64); g.closePath(); g.fill();
    g.strokeStyle = '#f2d68a'; g.lineWidth = 7; g.beginPath(); g.moveTo(92, 110); g.lineTo(164, 110); g.stroke();
  } else if (icon === 'cheese') {
    g.fillStyle = '#f2c14e'; g.beginPath(); g.moveTo(60, 150); g.lineTo(196, 150); g.lineTo(196, 104); g.lineTo(60, 132); g.closePath(); g.fill();
    g.fillStyle = '#d9a33a'; for (const [x, y, r] of [[110, 136, 9], [158, 128, 12], [180, 140, 6]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  } else if (icon === 'boot') {
    g.fillStyle = '#7a4a32'; g.beginPath();
    g.moveTo(96, 40); g.lineTo(140, 40); g.lineTo(140, 120); g.lineTo(186, 132); g.quadraticCurveTo(200, 160, 180, 160); g.lineTo(96, 160); g.closePath(); g.fill();
  } else if (icon === 'key') {
    g.strokeStyle = '#b08a3a'; g.lineWidth = 14; g.beginPath(); g.arc(84, 96, 26, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(110, 96); g.lineTo(196, 96); g.moveTo(176, 96); g.lineTo(176, 122); g.moveTo(196, 96); g.lineTo(196, 116); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function hangingSign(x, y, zWall, icon) {
  as('iron', () => {
    box(0.06, 0.06, 0.8, C.iron, { x, y: y + 0.6, z: zWall + 0.4 });
    for (const s of [-1, 1]) box(0.02, 0.16, 0.02, C.iron, { x: x + s * 0.3, y: y + 0.5, z: zWall + 0.66, r: 0 });
  });
  box(0.8, 0.62, 0.06, C.woodDark, { x, y: y + 0.12, z: zWall + 0.66, mat: 'wood' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.52), new THREE.MeshStandardMaterial({ map: signTexture(icon), roughness: 0.85 }));
  face.position.set(x, y + 0.12, zWall + 0.695);
  if (PARENT) face.applyMatrix4(PARENT);
  face.receiveShadow = true;
  signs.push(face);
}

/* ---------- walls ---------- */

/** a block's outline (centred, counter-clockwise), with broken corners and the odd dent along an edge */
function chippedOutline(w, h) {
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], pts = [];
  const unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return [dx / L, dy / L]; };
  for (let i = 0; i < 4; i++) {
    const c = corners[i], toPrev = unit(c, corners[(i + 3) % 4]), toNext = unit(c, corners[(i + 1) % 4]);
    if (rnd() < 0.6) {
      // a broken corner: cut off unevenly, sometimes in two steps
      const lim = Math.min(w, h) * 0.22, a = range(0.02, lim), b = range(0.02, lim);
      pts.push([c[0] + toPrev[0] * a, c[1] + toPrev[1] * a]);
      if (rnd() < 0.4) pts.push([c[0] + (toPrev[0] * a + toNext[0] * b) * range(0.3, 0.45), c[1] + (toPrev[1] * a + toNext[1] * b) * range(0.3, 0.45)]);
      pts.push([c[0] + toNext[0] * b, c[1] + toNext[1] * b]);
    } else pts.push(c);
    if (rnd() < 0.3) {
      // a shallow nick along the edge
      const n = corners[(i + 1) % 4], t = range(0.35, 0.65), inX = -toNext[1], inY = toNext[0], k = range(0.012, 0.03);
      pts.push([c[0] + (n[0] - c[0]) * (t - 0.06) , c[1] + (n[1] - c[1]) * (t - 0.06)]);
      pts.push([c[0] + (n[0] - c[0]) * t + inX * k, c[1] + (n[1] - c[1]) * t + inY * k]);
      pts.push([c[0] + (n[0] - c[0]) * (t + 0.06), c[1] + (n[1] - c[1]) * (t + 0.06)]);
    }
  }
  return pts;
}
/** a block from an outline: a flat face (slightly uneven) with a bevelled rim, `d` deep (its back is open, against the wall) */
function blockGeo(pts, d, bev) {
  const n = pts.length, pos = [], nor = [], idx = [];
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0] / n; cy += p[1] / n; }
  const out = pts.map(([x, y]) => { const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1; return [dx / L, dy / L]; });
  const push = (x, y, z, a, b, c) => { const L = Math.hypot(a, b, c); pos.push(x, y, z); nor.push(a / L, b / L, c / L); };
  for (let i = 0; i < n; i++) push(pts[i][0], pts[i][1], -d / 2, out[i][0], out[i][1], 0);
  for (let i = 0; i < n; i++) push(pts[i][0], pts[i][1], d / 2 - bev, out[i][0], out[i][1], 0.7);
  for (let i = 0; i < n; i++) push(pts[i][0] - out[i][0] * bev, pts[i][1] - out[i][1] * bev, d / 2 + range(-0.006, 0.006), out[i][0] * 0.25, out[i][1] * 0.25, 1);
  push(cx, cy, d / 2 + range(-0.004, 0.008), range(-0.08, 0.08), range(-0.08, 0.08), 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(i, j, n + j, i, n + j, n + i);
    idx.push(n + i, n + j, 2 * n + j, n + i, 2 * n + j, 2 * n + i);
    idx.push(3 * n, 2 * n + i, 2 * n + j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}
/** a chipped stone block w × h, d deep, centred like box() */
function chipped(w, h, d, c, o = {}) { return put(blockGeo(chippedOutline(w, h), d, Math.min(0.02, d * 0.3)), c, o); }

/** courses of shallow, squarish stones on a wall face, leaving out doorways and windows (holes), arches (circles),
 *  and anything above a curve (under: the top of a bridge) */
function stones(x0, x1, y0, y1, z, { holes = [], circles = [], under = null, cw = 0.72, ch = 0.42, tones = C.stone, d = 0.09, mat = 'stone' } = {}) {
  as(mat, () => {
    let row = 0;
    for (let y = y0; y < y1 - 0.08; row++) {
      const h = Math.min(ch * range(0.9, 1.1), y1 - y);
      let x = x0 - (row % 2 ? range(0.2, 0.45) : range(0, 0.12));
      while (x < x1 - 0.06) {
        const w = cw * range(0.62, 1.38);
        // the stone, minus any openings it runs into: it is cut down to fit beside, below or above them
        let parts = [[Math.max(x, x0), y, Math.min(x + w, x1), y + h]];
        for (const [hx0, hy0, hx1, hy1] of holes) {
          parts = parts.flatMap(([a, b0, b, b1]) => {
            if (a >= hx1 || b <= hx0 || b0 >= hy1 || b1 <= hy0) return [[a, b0, b, b1]];
            const cut = [];
            if (hx0 > a) cut.push([a, b0, hx0, b1]);
            if (hx1 < b) cut.push([hx1, b0, b, b1]);
            const ma = Math.max(a, hx0), mb = Math.min(b, hx1);
            if (hy0 > b0) cut.push([ma, b0, mb, hy0]);
            if (hy1 < b1) cut.push([ma, hy1, mb, b1]);
            return cut;
          });
        }
        for (const [a, b0, b, b1] of parts) {
          const mx = (a + b) / 2, my = (b0 + b1) / 2;
          if (b - a < 0.14 || b1 - b0 < 0.12) continue;
          if (circles.some((c) => Math.hypot(mx - c.x, my - c.y) < c.r) || (under && b1 > under(mx))) continue;
          chipped(b - a - 0.04, b1 - b0 - 0.04, d * range(0.9, 1.05), tones, { x: mx, y: my, z: z + range(-0.006, 0.006), rz: range(-0.01, 0.01), wob: 0.006, vary: 0.04 });
        }
        x += w;
      }
      y += h;
    }
  });
}

function quoins(x0, x1, y0, y1, z) {
  as('stone', () => {
    let k = 0;
    for (let y = y0; y < y1 - 0.2; y += 0.5, k++) {
      const w = k % 2 ? 0.45 : 0.75;
      for (const [x, s] of [[x0, 1], [x1, -1]]) chipped(w, 0.44, 0.12, C.stone, { x: x + s * (w / 2), y: y + 0.25, z, wob: 0.006 });
    }
  });
}

function windowAt(cx, cy, z, { w = 1.05, h = 1.35, frame = C.frame, shutter = null, flowerBox = false } = {}) {
  // the dark reveal sits clearly behind the glass, so the two never fight over the same depth
  box(w + 0.1, h + 0.1, 0.1, '#2a2230', { x: cx, y: cy, z: z - 0.08, r: 0, mat: 'plain' });
  pane(w, h, cx, cy, z + 0.01);
  as('paint', () => {
    box(w + 0.26, 0.15, 0.2, frame, { x: cx, y: cy + h / 2 + 0.06, z: z + 0.06 });
    box(0.14, h + 0.1, 0.2, frame, { x: cx - w / 2 - 0.05, y: cy, z: z + 0.06 });
    box(0.14, h + 0.1, 0.2, frame, { x: cx + w / 2 + 0.05, y: cy, z: z + 0.06 });
    box(0.06, h, 0.08, frame, { x: cx, y: cy, z: z + 0.05 });
    box(w, 0.06, 0.08, frame, { x: cx, y: cy + h * 0.18, z: z + 0.05 });
    box(w + 0.42, 0.12, 0.34, frame, { x: cx, y: cy - h / 2 - 0.08, z: z + 0.13 });
    if (shutter) {
      // opened flat against the wall either side
      const sw = w * 0.4; // narrow enough to clear the timber posts either side
      for (const side of [-1, 1]) {
        const sx = cx + side * (w / 2 + 0.1 + sw / 2);
        for (let i = 0; i < 3; i++) box(sw / 3 - 0.02, h, 0.06, shutter, { x: sx - sw / 2 + (i + 0.5) * (sw / 3), y: cy, z: z + 0.03, vary: 0.05 });
        for (const yy of [-h * 0.3, h * 0.3]) box(sw - 0.04, 0.09, 0.04, shade(shutter, 0.85), { x: sx, y: cy + yy, z: z + 0.08 });
      }
    }
  });
  if (flowerBox) {
    box(w + 0.3, 0.28, 0.34, pick([C.wood, C.woodDark]), { x: cx, y: cy - h / 2 - 0.3, z: z + 0.3, mat: 'wood' });
    flowers(cx, cy - h / 2 - 0.16, z + 0.32, w + 0.2, 0.3);
  }
}

function door(cx, zf, { w = 1.15, h = 2.3, c = '#4f7d6a', timber = C.timber } = {}) {
  box(w + 0.1, h + 0.05, 0.1, '#2b1f1d', { x: cx, y: h / 2, z: zf - 0.06, r: 0, mat: 'plain' });
  as('paint', () => {
    for (let i = 0; i < 4; i++) box(w / 4 - 0.03, h - 0.05, 0.09, c, { x: cx - w / 2 + (i + 0.5) * (w / 4), y: h / 2, z: zf + 0.04, vary: 0.05 });
    for (const yy of [0.45, h - 0.5]) box(w - 0.04, 0.13, 0.06, shade(c, 0.85), { x: cx, y: yy, z: zf + 0.11 });
  });
  as('iron', () => {
    for (const yy of [0.45, h - 0.5]) box(0.45, 0.05, 0.03, C.iron, { x: cx - w / 2 + 0.26, y: yy, z: zf + 0.15, r: 0 });
    ring(0.075, 0.015, C.iron, { x: cx + w * 0.28, y: h * 0.47, z: zf + 0.15 });
  });
  as('wood', () => {
    for (const s of [-1, 1]) box(0.2, h + 0.15, 0.26, timber, { x: cx + s * (w / 2 + 0.1), y: (h + 0.15) / 2, z: zf + 0.06 });
    box(w + 0.7, 0.28, 0.3, timber, { x: cx, y: h + 0.2, z: zf + 0.08 });
  });
  box(w + 0.5, 0.16, 0.5, C.stoneGrey, { x: cx, y: 0.08, z: zf + 0.3, mat: 'stone' });
  return [cx - w / 2 - 0.2, 0, cx + w / 2 + 0.2, h + 0.32];
}

/* ---------- roofs ---------- */

const SHINGLE = { w: 0.48, len: 0.56, step: 0.33, t: 0.07 };
const shingles = (sh) => ({ w: SHINGLE.w * sh, len: SHINGLE.len * sh, step: SHINGLE.step * sh, t: SHINGLE.t });

function sideRoof(x0, x1, H, zFront, tones, { pitch = 40, run = 2.8, sh = 1 } = {}) {
  const SH = shingles(sh);
  const a = THREE.MathUtils.degToRad(pitch);
  const zr = zFront - run, yr = H + run * Math.tan(a);
  const zE = zFront + 0.5, yE = H - 0.5 * Math.tan(a);
  const L = (zE - zr) / Math.cos(a) + 0.15;
  const up = new THREE.Vector3(0, Math.sin(a), -Math.cos(a)), n = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
  const xa = x0 - 0.08, xb = x1 + 0.08; // barely past the walls, so neighbours' roofs meet instead of crossing
  as('roof', () => {
    const mid = new THREE.Vector3(0, yE, zE).addScaledVector(up, L / 2);
    box(xb - xa, 0.12, L, shade(pick(tones), 0.6), { x: (xa + xb) / 2, y: mid.y, z: mid.z, rx: a, r: 0.03 });
    slab([[-zE, yE], [-zr, yr], [-(zr - run), yE]], x1 - x0, shade(pick(tones), 0.55), { x: (x0 + x1) / 2, ry: Math.PI / 2 });
    for (let i = 0, t = 0.25; t < L - 0.05; i++, t += SH.step) {
      const p = new THREE.Vector3(0, yE, zE).addScaledVector(up, t).addScaledVector(n, 0.08);
      for (let x = xa - (i % 2 ? SH.w / 2 : 0) + SH.w / 2; x < xb; x += SH.w) {
        const w = Math.min(SH.w - 0.04 - rnd() * 0.03, (xb - xa) - 0.02);
        box(w, SH.t, SH.len, tones, { x: Math.min(Math.max(x, xa + w / 2), xb - w / 2), y: p.y, z: p.z, rx: a - 0.07, r: 0.03, vary: 0.06 });
      }
    }
    cyl(0.15, 0.15, xb - xa, shade(pick(tones), 0.75), { x: (xa + xb) / 2, y: yr + 0.12, z: zr, rz: Math.PI / 2, n: 8 });
  });
}

function gableRoof(x0, x1, H, zFront, tones, wall, timber, { pitch = 52, depth = 5, sh = 1, win = true, wallMat = 'plaster' } = {}) {
  const SH = shingles(sh);
  const a = THREE.MathUtils.degToRad(pitch);
  const cx = (x0 + x1) / 2, half = (x1 - x0) / 2, rise = half * Math.tan(a);
  slab([[-half, 0], [half, 0], [0, rise]], 0.3, wall, { x: cx, y: H, z: zFront - 0.15, mat: wallMat });
  slab([[-half + 0.1, 0], [half - 0.1, 0], [0, rise - 0.1]], depth, shade(wall, 0.85), { x: cx, y: H, z: zFront - depth / 2, mat: wallMat });
  as('wood', () => {
    box(half * 2 * 0.58, 0.18, 0.14, timber, { x: cx, y: H + rise * 0.42, z: zFront + 0.05 });
    box(half * 2, 0.22, 0.16, timber, { x: cx, y: H + 0.1, z: zFront + 0.06 });
  });
  if (win) windowAt(cx, H + rise * 0.22 + 0.05, zFront + 0.02, { w: 0.6, h: Math.min(0.7, rise * 0.3), frame: timber });
  const over = 0.15, L = (half + over) / Math.cos(a), zA = zFront + 0.5, zB = zFront - depth;
  for (const s of [-1, 1]) {
    const sx = -s * Math.cos(a), sy = Math.sin(a), nx = s * Math.sin(a), ny = Math.cos(a);
    const ex = cx + s * (half + over), ey = H - over * Math.tan(a);
    as('roof', () => {
      box(L, 0.12, zA - zB, shade(pick(tones), 0.6), { x: ex + sx * L / 2, y: ey + sy * L / 2, z: (zA + zB) / 2, rz: -s * a, r: 0.03 });
      for (let i = 0, t = 0.25; t < L - 0.05; i++, t += SH.step) {
        // only the front few metres of shingles can ever be seen
        for (let z = zA - (i % 2 ? SH.w / 2 : 0) - SH.w / 2; z > zA - 3.2; z -= SH.w) {
          const w = SH.w - 0.04 - rnd() * 0.03;
          box(SH.len, SH.t, w, tones, { x: ex + sx * t + nx * 0.08, y: ey + sy * t + ny * 0.08, z: Math.min(z, zA - w / 2), rz: -s * (a - 0.07), r: 0.03, vary: 0.06 });
        }
      }
    });
    box(L + 0.1, 0.24, 0.14, timber, { x: ex + sx * L / 2 + nx * 0.14, y: ey + sy * L / 2 + ny * 0.14, z: zA + 0.02, rz: -s * a, mat: 'wood' });
  }
}

/* ---------- houses ---------- */

function house(x0, w, o = {}) {
  const {
    z: zf = 0, upper = 1, wall = 'timber', plaster = '#f1dcb5', timber = C.timber, shutter = '#4f8f8a', roof = 'side',
    roofTones = ROOF.slate, g = 3.3, fh = 2.7, flowerBoxes = 0.4, balcony = false, doorAt = 0.3,
    doorColour = pick(['#4f7d6a', '#7a4a3a', '#46627e', '#6b5a3a']), shop = true, awningColours = null, sign = null,
    lanterns = true, ivy = false,
  } = o;
  const x1 = x0 + w, cx = x0 + w / 2, depth = 5;
  const H = g + upper * fh;
  const jetty = wall === 'timber' ? 0.38 : 0;
  const zu = zf + jetty;
  const wallTone = wall === 'stone' ? pick(C.stone) : plaster;
  const wallMat = wall === 'stone' ? 'stone' : 'plaster';
  box(w + 0.04, H, depth, wallTone, { x: cx, y: H / 2, z: zf - depth / 2, r: 0, vary: 0.01, mat: wallMat });

  // ground floor: stone, a door and a shop window
  box(w + 0.02, wall === 'stone' ? H : g, 0.08, C.grout, { x: cx, y: (wall === 'stone' ? H : g) / 2, z: zf + 0.02, vary: 0, mat: 'plain' });
  const holes = [];
  const dx = x0 + w * doorAt, out = doorAt < 0.5 ? -1 : 1; // `out`: the side of the door away from the shop window
  holes.push(door(dx, zf + 0.1, { c: doorColour, timber }));
  const sx = x0 + w * (doorAt < 0.5 ? 0.68 : 0.32), sw = Math.min(2.1, w * 0.36);
  if (shop) {
    windowAt(sx, 1.6, zf + 0.12, { w: sw, h: 1.3, frame: timber, flowerBox: !awningColours && rnd() < 0.5 });
    holes.push([sx - sw / 2 - 0.12, 0.8, sx + sw / 2 + 0.12, 2.4]);
    if (awningColours) awning(sx, sw + 0.7, 2.95, zf + 0.22, ...awningColours);
  }
  const nWin = Math.max(1, Math.round((w - 1.0) / 2.3)), bay = w / nWin;
  if (wall === 'stone') {
    for (let f = 0; f < upper; f++) for (let i = 0; i < nWin; i++) {
      const bx = x0 + (i + 0.5) * bay, fy = g + f * fh;
      holes.push([bx - 1.08, fy + 0.68, bx + 1.08, fy + 2.32]);
    }
  }
  stones(x0 + 0.02, x1 - 0.02, 0, wall === 'stone' ? H : g, zf + 0.12, { holes });
  // beside the door, away from the shop window: a hanging sign if it has one, otherwise a lantern
  if (sign) hangingSign(dx + out * 1.05, 2.1, zf + 0.12, sign); // low enough to clear the beams of an overhang
  else if (lanterns) wallLantern(dx + out * 0.95, 2.35, zf + 0.12);
  if (ivy) vine(x0 + (out > 0 ? 0.35 : w - 0.35), zf + 0.22, 0.25, g - 0.2); // on the side away from the lantern

  // upper floors
  if (wall === 'timber') {
    as('wood', () => {
      box(w, 0.3, jetty + 0.35, timber, { x: cx, y: g + 0.05, z: zf + jetty / 2, r: 0 });
      for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.58) box(0.2, 0.26, jetty + 0.3, timber, { x, y: g - 0.2, z: zf + (jetty + 0.3) / 2 - 0.05 });
    });
    box(w + 0.04, upper * fh, 0.3, plaster, { x: cx, y: g + upper * fh / 2 + 0.1, z: zu - 0.15, r: 0, vary: 0.01, mat: 'plaster' });
  } else if (wall === 'plaster') {
    box(w + 0.04, upper * fh, 0.2, plaster, { x: cx, y: g + upper * fh / 2, z: zf + 0.05, r: 0, vary: 0.01, mat: 'plaster' });
    box(w + 0.04, 0.22, 0.3, pick(C.stone), { x: cx, y: g, z: zf + 0.1, r: 0, mat: 'stone' });
    quoins(x0, x1, g + 0.1, H, zf + 0.12);
  }
  for (let f = 0; f < upper; f++) {
    const fy = g + f * fh;
    const wantBalcony = balcony && f === 0;
    if (wall === 'timber') {
      const zt = zu + 0.03;
      as('wood', () => {
        box(w - 0.02, 0.2, 0.16, timber, { x: cx, y: fy + 0.22, z: zt, r: 0 });
        for (let i = 0; i <= nWin; i++) box(0.21, fh + 0.02, 0.17, timber, { x: Math.min(Math.max(x0 + i * bay, x0 + 0.1), x1 - 0.1), y: fy + fh / 2 + 0.12, z: zt });
        for (let i = 0; i < nWin; i++) {
          const bx = x0 + (i + 0.5) * bay, sillY = fy + 0.72;
          box(bay - 0.2, 0.16, 0.15, timber, { x: bx, y: sillY, z: zt });
          for (const s of [-1, 1]) beam(bx + s * 0.62, fy + 0.3, bx + s * 0.08, sillY - 0.06, 0.14, 0.13, timber, { z: zt });
        }
      });
    }
    for (let i = 0; i < nWin; i++) {
      const bx = x0 + (i + 0.5) * bay;
      windowAt(bx, fy + 1.5, (wall === 'timber' ? zu : zf + 0.15) + 0.04, { frame: C.frame, shutter, flowerBox: !wantBalcony && rnd() < flowerBoxes });
    }
    if (wantBalcony) {
      const zb = wall === 'timber' ? zu : zf + 0.15;
      as('wood', () => {
        box(w - 0.5, 0.14, 0.95, C.woodDark, { x: cx, y: fy + 0.72, z: zb + 0.47 });
        for (let x = x0 + 0.5; x < x1 - 0.4; x += 0.6) box(0.12, 0.3, 0.6, C.woodDark, { x, y: fy + 0.55, z: zb + 0.3 });
        box(w - 0.5, 0.11, 0.13, C.woodDark, { x: cx, y: fy + 1.72, z: zb + 0.9 });
        for (let x = x0 + 0.35; x < x1 - 0.3; x += 0.3) box(0.08, 0.95, 0.08, C.woodDark, { x, y: fy + 1.25, z: zb + 0.9 });
      });
      flowers(x0 + 0.9, fy + 0.82, zb + 0.6, 1.0, 0.3);
    }
  }
  if (wall === 'timber') box(w, 0.22, 0.18, timber, { x: cx, y: H - 0.05, z: zu + 0.03, r: 0, mat: 'wood' });
  // every house gets its roof: the camera rises over the town between rounds
  const ztop = wall === 'timber' ? zu : zf;
  if (roof === 'side') sideRoof(x0, x1, H, ztop, roofTones);
  else gableRoof(x0, x1, H, ztop, roofTones, wallTone, timber, { wallMat });
}

/** houses side by side in a straight row along the street, each wall meeting the next */
function row(x, z, specs) {
  let px = x;
  for (const [w, o] of specs) {
    at(px, 0, z, 0, () => house(0, w, { z: 0, ...o }));
    px += w;
  }
  return px;
}
const T = { wall: 'timber' }, P = { wall: 'plaster' }, S = { wall: 'stone', shop: false };

/** a plain, cheap house further back, seen over the low roofs */
function backHouse(x0, w, H, z, wall, roofTones) {
  const cx = x0 + w / 2;
  box(w + 0.04, H, 5, wall, { x: cx, y: H / 2, z: z - 2.5, vary: 0.02, r: 0, mat: 'plaster' });
  const n = Math.max(1, Math.round(w / 2.3));
  for (let fy = 4.4; fy < H - 1.0; fy += 2.7) {
    for (let i = 0; i < n; i++) {
      const bx = x0 + (i + 0.5) * (w / n);
      box(0.95, 1.25, 0.12, C.frame, { x: bx, y: fy, z: z + 0.04, mat: 'paint' });
      pane(0.75, 1.05, bx, fy, z + 0.12);
    }
  }
  if (rnd() < 0.5) sideRoof(x0, x0 + w, H, z, roofTones, { pitch: 48, sh: 1.6 });
  else gableRoof(x0, x0 + w, H, z, roofTones, wall, C.timber, { win: false, sh: 1.6 });
}

/* ---------- landmarks ---------- */

function pillar(x, z, h) {
  as('stone', () => {
    for (let y = 0; y < h; y += 0.55) chipped(1.25 + range(-0.06, 0.06), 0.5, 1.2 + range(-0.06, 0.06), C.stone, { x: x + range(-0.04, 0.04), y: y + 0.25, z, ry: range(-0.05, 0.05), wob: 0.02 });
    box(1.55, 0.35, 1.45, C.stone, { x, y: h + 0.15, z, r: 0.08, wob: 0.03 });
  });
}

function stall(cx, w, kind, stripeA, stripeB) {
  const zb = -4.4, zf = -2.0, wood = rnd() < 0.5 ? C.wood : C.woodLight;
  as('wood', () => {
    for (const s of [-1, 1]) {
      box(0.14, 2.55, 0.14, wood, { x: cx + s * (w / 2 - 0.1), y: 1.27, z: zf + 0.05 });
      box(0.14, 3.0, 0.14, wood, { x: cx + s * (w / 2 - 0.1), y: 1.5, z: zb + 0.1 });
    }
    box(w - 0.1, 0.1, 1.25, wood, { x: cx, y: 0.98, z: zf - 0.55 });
    for (let x = cx - w / 2 + 0.25; x < cx + w / 2 - 0.15; x += 0.24) box(0.22, 0.88, 0.05, wood, { x, y: 0.5, z: zf + 0.05, vary: 0.06 });
  });
  const yB = 3.0, yF = 2.5, zF = zf + 0.45;
  const slope = Math.atan2(yB - yF, zF - zb), len = Math.hypot(yB - yF, zF - zb);
  const n = Math.max(4, Math.round((w + 0.3) / 0.38)), sw = (w + 0.3) / n;
  as('cloth', () => {
    for (let i = 0; i < n; i++) {
      const x = cx - (w + 0.3) / 2 + (i + 0.5) * sw;
      box(sw + 0.005, 0.06, len, i % 2 ? stripeB : stripeA, { x, y: (yB + yF) / 2 + 0.1, z: (zb + zF) / 2, rx: slope, r: 0.02, vary: 0.02 });
      cyl(sw / 2, sw / 2, 0.05, i % 2 ? stripeB : stripeA, { x, y: yF + 0.05, z: zF + 0.02, rx: Math.PI / 2, t0: -Math.PI / 2, tl: Math.PI, n: 8, vary: 0.02 });
    }
    box(w + 0.35, 0.16, 0.08, stripeA, { x: cx, y: yF + 0.1, z: zF + 0.03 });
  });
  const top = 1.03, zc = zf - 0.55;
  const fruit = { r: 0.075, c: ['#c9302c', '#d94a2f', '#b0281f', '#8fb33a'] };
  const oranges = { r: 0.08, c: ['#f08a24', '#f5a03a'] };
  const greens = { r: 0.12, c: ['#8fbf5a', '#7aa84a'] };
  const plums = { r: 0.07, c: ['#6a3a7a', '#7d4a8a'] };
  const spud = { r: 0.08, c: ['#b98d5a', '#a87d4c'] };
  if (kind === 'fruit' || kind === 'veg') {
    const fills = kind === 'fruit' ? [fruit, oranges, plums] : [greens, spud, { r: 0.07, c: ['#d24a2a', '#e05a32'] }];
    const k = 3;
    for (let i = 0; i < k; i++) crate(cx - (w - 0.3) / 2 + (i + 0.5) * ((w - 0.3) / k), top, zc, (w - 0.3) / k - 0.1, 0.6, 0.22, fills[i]);
    basket(cx + w * 0.3, 0, zf + 0.6, 0.26, 0.32, fills[1]);
  } else if (kind === 'cheese') {
    for (let i = 0; i < 4; i++) {
      const bx = cx - w / 2 + 0.55 + i * ((w - 1.1) / 3);
      for (let k = 0; k < 1 + (i % 2); k++) cyl(0.24, 0.24, 0.15, ['#f2c14e', '#eab43c'], { x: bx, y: top + 0.08 + k * 0.16, z: zc, n: 16, mat: 'plain' });
    }
    barrel(cx + w * 0.3, zf + 0.65, 0.85);
  }
}

/** a stone basin on a wall with a spout (the wall's front at zWall) */
function wallFountain(x, zWall) {
  slab([[-0.75, 0], [0.75, 0], [0.75, 1.7], [0, 2.25], [-0.75, 1.7]], 0.22, pick(C.stone), { x, y: 0, z: zWall + 0.11, mat: 'stone' });
  ball(0.16, pick(C.stone), { x, y: 1.45, z: zWall + 0.26, sz: 0.6, mat: 'stone' });
  cyl(0.045, 0.045, 0.3, C.iron, { x, y: 1.35, z: zWall + 0.38, rx: Math.PI / 2, n: 8, mat: 'iron' });
  cyl(0.8, 0.62, 0.6, C.stoneGrey, { x, y: 0.3, z: zWall + 0.22, n: 14, t0: -Math.PI / 2, tl: Math.PI, mat: 'stone' });
  cyl(0.72, 0.72, 0.03, '#5f8fbc', { x, y: 0.56, z: zWall + 0.22, n: 14, t0: -Math.PI / 2, tl: Math.PI, list: water, vary: 0, mat: 'plain' });
  box(0.05, 0.8, 0.02, '#cfe6f5', { x, y: 0.95, z: zWall + 0.53, r: 0, list: veils, vary: 0, mat: 'plain' });
}

/** a stepped stand of potted flowers outside the flower shop */
function plantStand(x, z) {
  for (let t = 0; t < 3; t++) {
    box(2.0, 0.08, 0.45, C.woodLight, { x, y: 0.35 + t * 0.4, z: z - t * 0.42, mat: 'wood' });
    for (let i = 0; i < 3; i++) {
      const px = x - 0.6 + i * 0.6;
      lathe([[0.1, 0], [0.15, 0.24], [0.17, 0.26], [0.13, 0.26]], C.terracotta, { x: px, y: 0.39 + t * 0.4, z: z - t * 0.42, n: 10, mat: 'clay' });
      flowers(px, 0.67 + t * 0.4, z - t * 0.42, 0.34, 0.3);
    }
  }
  as('wood', () => {
    for (const s of [-1, 1]) for (const dz of [0, -0.84]) box(0.08, 0.35 + (dz ? 0.8 : 0), 0.08, C.wood, { x: x + s * 0.95, y: (0.35 + (dz ? 0.8 : 0)) / 2, z: z + dz });
  });
}

function canal(x0, x1, zFar, zNear) {
  const cx = (x0 + x1) / 2, zc = (zFar + zNear) / 2, len = zNear - zFar;
  box(x1 - x0, 0.2, len, '#3a3a40', { x: cx, y: -1.75, z: zc, vary: 0, r: 0, mat: 'plain' });
  put(new THREE.PlaneGeometry(x1 - x0, len).rotateX(-Math.PI / 2), '#3e6f86', { x: cx, y: -0.62, z: zc, list: water, vary: 0, mat: 'plain' });
  for (const [sx, ry, from] of [[x0, Math.PI / 2, zNear], [x1, -Math.PI / 2, zFar]]) {
    at(sx, -1.7, from, ry, () => {
      stones(0, len, 0, 1.7, 0.1, { ch: 0.45, tones: C.stoneGrey });
      box(len, 0.2, 0.55, pick(C.stone), { x: len / 2, y: 1.8, z: 0.15, mat: 'stone' });
    });
  }
}

function bridge(cx, zc) {
  const half = 6.2, top = 2.5, R = 2.7, ys = -0.7, depth = 3.4;
  const deck = (x) => top * (1 - ((x - cx) / half) ** 2);
  const shape = new THREE.Shape();
  shape.moveTo(-half, -1.75);
  for (let i = 0; i <= 24; i++) { const t = -1 + 2 * i / 24; shape.lineTo(t * half, top * (1 - t * t)); }
  shape.lineTo(half, -1.75); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(R, -1.65);
  for (let i = 0; i <= 20; i++) { const a = Math.PI * i / 20; hole.lineTo(R * Math.cos(a), ys + R * Math.sin(a)); }
  hole.lineTo(-R, -1.65); hole.closePath();
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  put(geo, pick(C.stone), { x: cx, z: zc, vary: 0.02, mat: 'stone' });
  const face = zc + depth / 2 + 0.1;
  stones(cx - half, cx + half, -1.7, top, face, { holes: [[cx - R, -2, cx + R, ys]], circles: [{ x: cx, y: ys, r: R + 0.55 }], under: (vx) => deck(vx) - 0.15 });
  as('stone', () => {
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * i / 12;
      box(0.45, 0.62, 0.32, C.stone, { x: cx + Math.cos(a) * (R + 0.3), y: ys + Math.sin(a) * (R + 0.3), z: face, rz: a - Math.PI / 2, r: 0.07, wob: 0.02 });
    }
    for (let i = 0; i < 14; i++) {
      const xa = cx - half + (2 * half * i) / 14, xb = xa + (2 * half) / 14;
      beam(xa, deck(xa) + 0.06, xb, deck(xb) + 0.06, 0.14, depth - 0.6, C.stoneGrey, { z: zc });
      for (const s of [-1, 1]) beam(xa, deck(xa) + 0.42, xb, deck(xb) + 0.42, 0.72, 0.34, C.stone, { z: zc + s * (depth / 2 - 0.17), r: 0.08, wob: 0.02 });
    }
  });
}

function boat(x, z) {
  const outline = [[0, 1.9], [0.55, 1.2], [0.7, 0], [0.62, -1.2], [0.42, -1.75], [-0.42, -1.75], [-0.62, -1.2], [-0.7, 0], [-0.55, 1.2]];
  const shape = new THREE.Shape(outline.map(([a, b]) => new THREE.Vector2(a, b)));
  shape.holes.push(new THREE.Path(outline.map(([a, b]) => new THREE.Vector2(a * 0.82, b * 0.88)).reverse()));
  as('wood', () => {
    put(new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: false }), '#8a5a3a', { x, y: -0.82, z, rx: -Math.PI / 2 });
    box(1.0, 0.05, 2.9, '#5a3a24', { x, y: -0.72, z });
    for (const dz of [-0.6, 0.6]) box(1.15, 0.08, 0.3, C.woodLight, { x, y: -0.45, z: z + dz });
  });
}

function cart(x, z) {
  as('wood', () => {
    withFrame(frameAt(x, 0, z, 0, 0.06), () => {
      box(1.9, 0.12, 1.0, C.wood, { y: 0.75 });
      for (const s of [-1, 1]) box(1.9, 0.35, 0.07, C.wood, { y: 0.98, z: s * 0.47 });
      box(0.07, 0.35, 0.86, C.wood, { x: 0.92, y: 0.98 });
      for (const s of [-1, 1]) box(1.4, 0.07, 0.07, C.woodDark, { x: -1.55, y: 0.78, z: s * 0.4, rz: -0.12 });
    });
    for (const s of [-1, 1]) {
      ring(0.48, 0.05, C.woodDark, { x: x + 0.25, y: 0.5, z: z + s * 0.62, n: 16 });
      for (let i = 0; i < 4; i++) box(0.9, 0.05, 0.04, C.woodDark, { x: x + 0.25, y: 0.5, z: z + s * 0.62, rz: (i / 4) * Math.PI, r: 0 });
    }
  });
  for (let i = 0; i < 4; i++) pumpkin(x - 0.6 + i * 0.4, 0.8, z + (i % 2 ? 0.2 : -0.2), range(0.18, 0.24));
}

function townWall(x0, x1, z, Hh = 6.5) {
  box(x1 - x0, Hh, 1.6, C.grout, { x: (x0 + x1) / 2, y: Hh / 2, z: z - 0.8, vary: 0, mat: 'plain' });
  stones(x0, x1, 0, Hh, z + 0.1, { cw: 0.85, ch: 0.52 });
  as('stone', () => { for (let x = x0 + 0.4; x < x1; x += 1.2) box(0.75, 0.8, 0.8, C.stone, { x, y: Hh + 0.4, z: z - 0.3, r: 0.08, wob: 0.03 }); });
}

/** a stone arch through a wall (the town gate, the entrance to the lane) */
function townGate(x0, x1, z, { ys = 3.8, merlons = true, banners = true } = {}) {
  const cx = (x0 + x1) / 2, R = (x1 - x0) / 2 - 0.62, top = ys + R + 1.6;
  pillar(x0, z, ys - 0.2); pillar(x1, z, ys - 0.2);
  // the wall over the arch, with the round opening cut out of it
  const back = [[-(x1 - x0) / 2 - 0.65, 0], [-R - 0.05, 0]];
  for (let i = 0; i <= 16; i++) { const a = Math.PI - Math.PI * i / 16; back.push([Math.cos(a) * (R + 0.05), Math.sin(a) * (R + 0.05)]); }
  back.push([(x1 - x0) / 2 + 0.65, 0], [(x1 - x0) / 2 + 0.65, top - ys], [-(x1 - x0) / 2 - 0.65, top - ys]);
  slab(back, 1.2, C.grout, { x: cx, y: ys, z, vary: 0, mat: 'plain' });
  stones(x0 - 0.65, x1 + 0.65, ys, top, z + 0.6, { ch: 0.5, circles: [{ x: cx, y: ys, r: R + 0.75 }] });
  as('stone', () => {
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * i / 12;
      box(i === 6 ? 0.6 : 0.48, 0.9, 1.35, C.stone, { x: cx + Math.cos(a) * (R + 0.4), y: ys + Math.sin(a) * (R + 0.4), z, rz: a - Math.PI / 2, r: 0.08, wob: 0.03 });
    }
    if (merlons) for (let x = x0 - 0.5; x <= x1 + 0.5; x += 1.15) box(0.7, 0.75, 0.9, C.stone, { x, y: top + 0.45, z, r: 0.08, wob: 0.03 });
  });
  if (banners) as('cloth', () => {
    for (const s of [-1, 1]) {
      slab([[-0.45, 0], [0.45, 0], [0.45, -2.2], [0, -2.6], [-0.45, -2.2]], 0.04, '#b8423a', { x: cx + s * (R + 1.0), y: top - 0.3, z: z + 0.7 });
      slab([[-0.28, -0.25], [0.28, -0.25], [0.28, -2.0], [0, -2.3], [-0.28, -2.0]], 0.02, '#f2c14e', { x: cx + s * (R + 1.0), y: top - 0.3, z: z + 0.73 });
    }
  });
}

/* ---------- the side street: a long lane lined with houses, bunting across, a cathedral at the end ---------- */

/** a gothic pointed outline (points in X/Y), w wide, standing on y = 0 with straight sides up to h */
function pointed(w, h) {
  const R = w * 0.8, pts = [[w / 2, 0], [w / 2, h]];
  const end = Math.acos((w / 2 - R) / R);
  for (let i = 0; i <= 8; i++) { const f = end * i / 8; pts.push([w / 2 - R + R * Math.cos(f), h + R * Math.sin(f)]); }
  for (let i = 8; i >= 0; i--) { const f = end * i / 8; pts.push([-(w / 2 - R + R * Math.cos(f)), h + R * Math.sin(f)]); }
  pts.push([-w / 2, h], [-w / 2, 0]);
  return pts;
}
/** the stone band round a pointed opening: the outer outline, then back down the inner one */
function band(outerW, innerW, h) { return pointed(outerW, h).concat(pointed(innerW, h).reverse()); }

/** a tall pointed window: lattice glass with a dark pointed head and a stone surround */
function lancet(x, y, z, w, h, tone) {
  pane(w, h, x, y + h / 2, z + 0.04);
  slab(pointed(w, 0).slice(2, -2), 0.05, '#3a3352', { x, y: y + h, z: z + 0.04, mat: 'plain' });
  slab(band(w + 0.36, w, h + 0.1), 0.22, tone, { x, y: y - 0.1, z: z + 0.06, mat: 'ashlar' });
}

/** a red banner with a gold emblem, hung from an iron arm on a wall (the wall's own frame: wall at z = 0) */
function banner(x, y, colour = '#c8423a') {
  as('iron', () => {
    box(0.06, 0.06, 1.0, C.iron, { x, y, z: 0.5 });
    box(0.9, 0.05, 0.05, C.iron, { x, y: y - 0.05, z: 0.95 });
  });
  as('cloth', () => {
    slab([[-0.42, 0], [0.42, 0], [0.42, -1.5], [0, -1.85], [-0.42, -1.5]], 0.04, colour, { x, y: y - 0.08, z: 0.95 });
    slab([[-0.3, -0.12], [0.3, -0.12], [0.3, -1.42], [0, -1.7], [-0.3, -1.42]], 0.02, '#e8b84e', { x, y: y - 0.08, z: 0.98 });
    slab([[-0.24, -0.18], [0.24, -0.18], [0.24, -1.38], [0, -1.62], [-0.24, -1.38]], 0.02, colour, { x, y: y - 0.08, z: 1.0 });
  });
}

/** a simpler house for the side street (it is seen at a slant, through haze and blur): built facing +z, from x = 0 to w */
function laneHouse(w, { plaster = '#efe0c4', timber = C.timber, upper = 2, roofTones = ROOF.brown, shutter = '#4f8f8a', jetty = 0.5, lantern = false, flagAt = null } = {}) {
  const g = 3.1, fh = 2.6, H = g + upper * fh, cx = w / 2;
  box(w + 0.04, g, 4.5, pick(C.stone), { x: cx, y: g / 2, z: -2.25, vary: 0.02, r: 0, mat: 'stone' });
  stones(0.05, w - 0.05, 0, 1.3, 0.1, { ch: 0.45 });
  box(w + 0.04, H - g, 4.5, plaster, { x: cx, y: g + (H - g) / 2, z: -2.25 + jetty, vary: 0.01, r: 0, mat: 'plaster' });
  box(1.1, 2.2, 0.14, pick(['#4f7d6a', '#7a4a3a', '#46627e', '#6b5a3a']), { x: w * 0.28, y: 1.1, z: 0.08, mat: 'paint' });
  as('wood', () => {
    for (const s of [-1, 1]) box(0.18, 2.35, 0.24, timber, { x: w * 0.28 + s * 0.64, y: 1.17, z: 0.1 });
    box(1.6, 0.24, 0.28, timber, { x: w * 0.28, y: 2.38, z: 0.1 });
    box(1.75, 0.14, 0.3, timber, { x: w * 0.7, y: 1.05, z: 0.18 });
    box(1.75, 0.14, 0.22, timber, { x: w * 0.7, y: 2.26, z: 0.14 });
  });
  box(1.6, 1.15, 0.1, '#2a2230', { x: w * 0.7, y: 1.65, z: 0.02, r: 0, mat: 'plain' });
  pane(1.5, 1.1, w * 0.7, 1.65, 0.12);
  const zf = jetty + 0.02;
  as('wood', () => {
    box(w, 0.26, jetty + 0.3, timber, { x: cx, y: g, z: jetty / 2 });
    for (let x = 0.3; x < w - 0.1; x += 0.6) box(0.18, 0.22, jetty + 0.2, timber, { x, y: g - 0.2, z: jetty / 2 - 0.05 });
  });
  const n = Math.max(1, Math.round((w - 0.8) / 2.2)), bay = w / n;
  for (let f = 0; f < upper; f++) {
    const fy = g + f * fh;
    as('wood', () => {
      box(w, 0.18, 0.14, timber, { x: cx, y: fy + 0.2, z: zf });
      for (let i = 0; i <= n; i++) box(0.18, fh, 0.14, timber, { x: Math.min(Math.max(i * bay, 0.09), w - 0.09), y: fy + fh / 2 + 0.1, z: zf });
    });
    for (let i = 0; i < n; i++) {
      const bx = (i + 0.5) * bay, by = fy + 1.4;
      box(1.1, 1.35, 0.1, '#2a2230', { x: bx, y: by, z: zf - 0.06, r: 0, mat: 'plain' });
      pane(0.9, 1.15, bx, by, zf + 0.02);
      as('paint', () => {
        box(1.12, 0.12, 0.18, C.frame, { x: bx, y: by + 0.64, z: zf + 0.05 });
        box(1.25, 0.12, 0.28, C.frame, { x: bx, y: by - 0.66, z: zf + 0.08 });
        for (const s of [-1, 1]) box(0.45, 1.3, 0.06, shutter, { x: bx + s * 0.78, y: by, z: zf + 0.05, vary: 0.04 });
      });
      if (rnd() < 0.3) { box(1.1, 0.24, 0.3, C.wood, { x: bx, y: by - 0.85, z: zf + 0.25, mat: 'wood' }); flowers(bx, by - 0.73, zf + 0.27, 1.0, 0.25); }
    }
  }
  box(w, 0.2, 0.16, timber, { x: cx, y: H - 0.05, z: zf, mat: 'wood' });
  if (lantern) wallLantern(w * 0.28 + 1.05, 2.35, 0.1);
  if (flagAt != null) banner(w * flagAt, g + 1.6);
  sideRoof(0, w, H, zf, roofTones, { pitch: 44, sh: 1.5 });
}

/** a great pale cathedral front: a recessed pointed portal, a rose window, and two tall towers */
function cathedral(cx, z) {
  const tone = ['#d8c9b4', '#d2c3ad', '#dccfbb'], nw = 11, nh = 17;
  as('ashlar', () => {
    box(nw, nh, 20, tone, { x: cx, y: nh / 2, z: z - 10, vary: 0.01 });
    slab([[-nw / 2, 0], [nw / 2, 0], [0, 6]], 1.0, tone, { x: cx, y: nh, z: z - 0.5 });
    for (const y of [6.6, 13.6]) box(nw + 0.3, 0.32, 0.5, tone, { x: cx, y, z: z + 0.2 });
    for (let k = 0; k < 3; k++) {
      const w = 4.6 - k * 0.6, h = 3.6 - k * 0.15;
      slab(band(w + 0.7, w, h), 0.3, shade(pick(tone), 1 - k * 0.06), { x: cx, z: z + 0.45 - k * 0.3 });
    }
  });
  slab(pointed(3.4, 3.2), 0.1, '#4a3428', { x: cx, z: z - 0.6, mat: 'wood' });
  roundPane(2.3, cx, 10.4, z + 0.06);
  as('ashlar', () => {
    ring(2.45, 0.3, tone, { x: cx, y: 10.4, z: z + 0.2, n: 28 });
    for (let i = 0; i < 12; i++) box(4.6, 0.12, 0.14, '#e3d6c2', { x: cx, y: 10.4, z: z + 0.12, rz: (i / 12) * Math.PI, r: 0 });
    ring(0.6, 0.12, '#e3d6c2', { x: cx, y: 10.4, z: z + 0.14 });
  });
  for (let i = 0; i < 7; i++) lancet(cx - 4.2 + i * 1.4, 7.1, z, 0.55, 1.5, tone);
  for (let i = 0; i < 3; i++) box(nw * 0.7 - i * 1.2, 0.3, 0.7, C.stoneGrey, { x: cx, y: 0.15 + i * 0.3, z: z + 1.6 - i * 0.6, mat: 'stone' });
  for (const s of [-1, 1]) {
    const tx = cx + s * (nw / 2 + 3.2), TH = 34;
    as('ashlar', () => {
      box(6.4, TH, 6.4, tone, { x: tx, y: TH / 2, z: z - 3, vary: 0.01 });
      for (const bx of [-1, 1]) for (let k = 0; k < 3; k++) {
        const bh = TH * (1 - k * 0.3) - 2;
        box(0.9, bh, 0.8 - k * 0.15, tone, { x: tx + bx * 3.1, y: bh / 2, z: z + 0.3 + (0.25 - k * 0.1), vary: 0.01 });
      }
      for (const y of [6.6, 13.6, 22.6, 31]) box(6.6, 0.32, 0.5, tone, { x: tx, y, z: z + 0.2 });
      box(6.9, 0.5, 6.9, tone, { x: tx, y: TH + 0.25, z: z - 3 });
      for (let i = 0; i < 9; i++) box(0.22, 0.6, 0.22, tone, { x: tx - 3.2 + i * 0.8, y: TH + 0.8, z: z + 0.25, r: 0 });
      for (const px of [-3.1, 3.1]) cyl(0.0, 0.4, 2.2, tone, { x: tx + px, y: TH + 1.6, z: z + 0.2, n: 4 });
    });
    const face = z + 0.22; // the tower stands a little proud of the nave
    lancet(tx, 2.2, face, 1.2, 3.4, tone);
    for (const dx of [-1.0, 1.0]) lancet(tx + dx, 8.0, face, 0.8, 3.6, tone);
    for (const dx of [-1.0, 1.0]) lancet(tx + dx, 15.2, face, 1.0, 5.6, tone);
    for (const dx of [-1.0, 1.0]) lancet(tx + dx, 24.0, face, 1.0, 5.4, tone);
  }
}

/* ================= the walk ================= */

const FRONT = -3.0; // where the shopfronts stand
const CANAL = [71, 77];

function paving(x0, x1, z0, z1) {
  box(x1 - x0, 0.1, z1 - z0, C.grout, { x: (x0 + x1) / 2, y: -0.05, z: (z0 + z1) / 2, r: 0.01, vary: 0, mat: 'plain' });
  as('ground', () => {
    for (let z = z0; z < z1 - 0.15;) {
      const d = Math.min(range(0.5, 0.8), z1 - z);
      for (let x = x0 + range(-0.3, 0); x < x1 - 0.15;) {
        // stones stop at the edges: nothing hangs over the canal or into a wall
        const a = Math.max(x, x0), w = Math.min(range(0.55, 1.15), x1 - a);
        chipped(w - range(0.05, 0.07), d - range(0.05, 0.07), 0.07, C.flag, { x: a + w / 2, y: 0.015, z: z + d / 2, rx: -Math.PI / 2, rz: range(-0.03, 0.03), wob: 0.008, vary: 0.04 });
        x = a + w;
      }
      z += d;
    }
  });
}
paving(-14, CANAL[0], -5, 6.5);
paving(CANAL[1], 120, -5, 6.5);

/* ----- the bakery and the café ----- */
let x = row(-10, FRONT, [
  [6.2, { ...P, plaster: '#efd9b8', roof: 'side', roofTones: ROOF.brown, awningColours: ['#d8473f', '#f4ead8'], sign: 'bread', doorAt: 0.72, shutter: '#5f8a4e' }],
  [6.6, { ...T, plaster: '#a9cbc0', timber: '#4d7f7d', upper: 2, shutter: '#6aa3a0', sign: 'cup', doorAt: 0.3 }],
  [5.4, { ...S, roof: 'gable', roofTones: ROOF.slate, shutter: '#4f7a46', ivy: true, doorAt: 0.7 }],
  [6.4, { ...T, plaster: '#e3a9a0', timber: '#6b3b33', upper: 2, balcony: true, shutter: '#7a4a7a', awningColours: ['#4f8a86', '#f4ead8'], sign: 'key', doorAt: 0.3 }],
]);
crate(-6.4, 0, -1.6, 0.8, 0.6, 0.45, { r: 0.13, c: ['#c98a45', '#b8763a', '#d9a05a'], mound: 0.06 });
basket(-5.4, 0, -1.6, 0.3, 0.4, { r: 0.1, c: ['#d9a05a', '#c98a45'] });
candleTable(-0.4, -1.0); candleTable(2.0, -1.3);
armchair(-1.4, -0.5, 0.9); armchair(0.3, -0.1, -0.4); armchair(1.3, -0.5, 0.7); armchair(3.0, -0.8, -0.9);
bench(7.8, -1.8);
pot(10.6, -1.7, 1.1);
lampPost(12.0, 2.2);

/* ----- the market ----- */
x = row(x, -4.6, [
  [6.5, { ...T, plaster: '#f3e3c6', upper: 2, shutter: '#3f6ea0' }],
  [6.0, { ...P, plaster: '#bccfe2', roof: 'side', roofTones: ROOF.slate, shutter: '#3f6ea0' }],
  [7.0, { ...T, plaster: '#eccb84', upper: 2, shutter: '#6a8f4e' }],
  [6.5, { ...S, roof: 'side', roofTones: ROOF.brown, shutter: '#4f7a46' }],
]);
at(20.0, 0, 2.4, 0, () => stall(0, 3.4, 'fruit', '#d8473f', '#f4ead8'));
at(27.4, 0, 2.4, 0, () => stall(0, 3.4, 'veg', '#4f8a4a', '#f4ead8'));
at(34.8, 0, 2.4, 0, () => stall(0, 3.4, 'cheese', '#e0a03a', '#f4ead8'));
for (const [px, pz, r] of [[38.6, 0.2, 0.36], [39.3, 0.5, 0.28], [38.9, 0.9, 0.24]]) pumpkin(px, 0, pz, r);
lampPost(23.0, 1.8); lampPost(37.6, 1.8);
bunting(23.1, 4.5, 37.5, 4.5, 1.8, 1.0);

/* ----- the flower corner ----- */
x = row(x, FRONT, [
  [5.6, { ...P, plaster: '#f4e3c4', roof: 'gable', roofTones: ROOF.brown, awningColours: ['#7a5ab8', '#f4ead8'], sign: 'flower', doorAt: 0.72, shutter: '#4f8f8a' }],
  [6.0, { ...T, plaster: '#c3d39f', timber: '#55432e', upper: 2, shutter: '#a85a3a' }],
  [6.0, { ...S, roof: 'side', roofTones: ROOF.slate, shutter: '#4f7d6a', doorAt: 0.73, lanterns: false }],
]);
plantStand(x - 15.4, -0.7);
tree(x - 9.2, 0.4, 0.75);
wallFountain(x - 3.4, FRONT + 0.12);

/* ----- the side street: through a stone arch, a lane of houses and bunting runs up to the cathedral ----- */
const LANE = [x, x + 6.2], LANE_X = x + 3.1;
{
  const [a0, a1] = LANE;
  paving(a0, a1, -48, -5);
  paving(a0 - 7, a1 + 7, -56, -48);
  townGate(a0 + 0.1, a1 - 0.1, FRONT - 0.2, { ys: 3.6, merlons: false, banners: false });
  box(0.04, 0.5, 0.04, C.iron, { x: LANE_X, y: 5.75, z: FRONT - 0.2, r: 0, mat: 'iron' });
  lantern(LANE_X, 5.1, FRONT - 0.2, 1.0);
  const leftSpecs = [
    [6.0, { plaster: '#ecd9b6', upper: 2, shutter: '#4f8f8a', lantern: true }],
    [5.4, { plaster: '#f2c9a8', timber: '#6b3b33', upper: 3, shutter: '#4f7d6a', roofTones: ROOF.slate, flagAt: 0.6 }],
    [6.4, { plaster: '#dfe3cf', upper: 2, shutter: '#a85a3a', lantern: true }],
    [5.6, { plaster: '#f0d6b0', upper: 3, shutter: '#3f6ea0', roofTones: ROOF.terracotta }],
    [6.2, { plaster: '#e3d2df', upper: 2, shutter: '#4f8a4a', lantern: true }],
    [6.0, { plaster: '#efe0c4', upper: 3, shutter: '#7a4a3a', roofTones: ROOF.slate }],
    [6.0, { plaster: '#f4e7d2', upper: 2, shutter: '#4f8f8a' }],
  ];
  let z = FRONT - 0.2;
  for (const [w, o] of leftSpecs) { at(a0, 0, z, Math.PI / 2, () => laneHouse(w, o)); z -= w; }
  const rightSpecs = [
    [6.2, { plaster: '#f0d0c0', upper: 2, shutter: '#4f7d6a', lantern: true }],
    [5.8, { plaster: '#efe6c8', timber: '#3e5a7a', upper: 3, shutter: '#3f6ea0', roofTones: ROOF.slate, flagAt: 0.4 }],
    [6.0, { plaster: '#e9cfa4', upper: 2, shutter: '#a85a3a', lantern: true }],
    [6.4, { plaster: '#d5dce8', upper: 3, shutter: '#4f8f8a', roofTones: ROOF.terracotta }],
    [5.6, { plaster: '#f3e3c6', upper: 2, shutter: '#6a8f4e', lantern: true }],
    [6.0, { plaster: '#e8d6bd', upper: 3, shutter: '#4f7d6a', roofTones: ROOF.brown }],
    [6.0, { plaster: '#efd9b8', upper: 2, shutter: '#7a4a7a' }],
  ];
  z = FRONT - 0.2;
  for (const [w, o] of rightSpecs) { z -= w; at(a1, 0, z, -Math.PI / 2, () => laneHouse(w, o)); }
  const warm = ['#c8423a', '#e08a3a', '#f2b84e', '#d8573c'];
  for (const [bz, y0, y1] of [[-10, 5.8, 6.1], [-18.5, 6.2, 5.9], [-27, 6.0, 6.4], [-36, 6.5, 6.2]]) bunting(a0 + 0.7, y0, a1 - 0.7, y1, bz, 0.7, warm);
  barrel(a0 + 0.9, -9.5, 0.9);
  pot(a1 - 0.8, -14, 0.9);
  pumpkin(a0 + 1.2, 0, -22.5, 0.3);
  crate(a1 - 1.0, 0, -26, 0.8, 0.6, 0.45, { r: 0.12, c: ['#8fbf5a', '#7aa84a'] });
  at(LANE_X, 0, -55, 0.3, () => cathedral(8.7, 0)); // turned a little, one tower standing right at the top of the lane
  for (const [bx, w] of [[a0 - 21, 7], [a0 - 14, 6.5]]) backHouse(bx, w, range(9, 11), -50, pick(['#efe0c4', '#e3d2df', '#f0d6b0']), pick([ROOF.slate, ROOF.brown]));
}
x = row(LANE[1], FRONT, [[CANAL[0] - LANE[1], { ...P, plaster: '#f0d6b0', upper: 2, shutter: '#4f8f8a', doorAt: 0.3, roof: 'side' }]]);

/* ----- the canal and the bridge ----- */
canal(CANAL[0], CANAL[1], -66, 10);
bridge((CANAL[0] + CANAL[1]) / 2, -0.6);
boat(CANAL[0] + 2.2, 4.0);
// the view up the canal, through the bridge: tall houses standing straight up out of the water on both sides, a couple
// of boats tied up along them, and one more house closing the far end
{
  const tones = ['#efe0c4', '#e3d2df', '#f0d6b0', '#dfe6d8', '#f1dcc8', '#e8d6b8'];
  const shutters = ['#4f8f8a', '#4f7a46', '#7a4a3a', '#46627e', '#8a5a7a'];
  for (const [sx, ry] of [[CANAL[0], Math.PI / 2], [CANAL[1], -Math.PI / 2]]) {
    for (let z = -9; z > -64;) {
      const w = range(4.6, 6.8);
      const zStart = ry > 0 ? z : z - w; // a house built facing +z, turned to face the water: its x runs along the bank
      at(sx, 0, zStart, ry, () => laneHouse(w, { plaster: pick(tones), shutter: pick(shutters), upper: pick([2, 2, 3]), roofTones: pick([ROOF.brown, ROOF.terracotta, ROOF.slate]), jetty: pick([0, 0.4]) }));
      z -= w;
    }
  }
  at(CANAL[0] - 0.5, 0, -66, 0, () => laneHouse(CANAL[1] - CANAL[0] + 1, { plaster: '#f0d6b0', upper: 3, roofTones: ROOF.terracotta }));
  boat(CANAL[0] + 1.2, -18); boat(CANAL[1] - 1.2, -37); boat(CANAL[0] + 1.3, -52);
}
x = row(CANAL[1], FRONT - 0.8, [
  [6.0, { ...S, upper: 2, shutter: '#4f7a46', doorAt: 0.7 }],
  [6.4, { ...P, plaster: '#e3d2df', roof: 'side', roofTones: ROOF.slate, awningColours: ['#c24a3a', '#f4ead8'], sign: 'boot', shutter: '#4f7d6a', doorAt: 0.3 }],
]);
pot(CANAL[0] - 0.7, 1.75); pot(CANAL[1] + 0.7, 1.75); // one each side, clear of the bridge parapets
lampPost(CANAL[1] + 2.4, 2.4);

/* ----- the workshops ----- */
const shopsAt = x;
x = row(x, FRONT, [
  [6.6, { ...T, plaster: '#e9cfa4', roof: 'gable', roofTones: ROOF.terracotta, sign: 'pot', shutter: '#7a4a3a', doorAt: 0.3 }],
  [6.2, { ...T, plaster: '#d5dce8', timber: '#3e5a7a', upper: 2, shutter: '#3f6ea0', sign: 'cheese', doorAt: 0.68 }],
]);
for (let i = 0; i < 3; i++) {
  const s = [1.0, 0.85, 1.15][i], c = [C.terracotta, '#4f7fb0', '#d9cdb5'][i];
  lathe([[0.001, 0], [0.22 * s, 0], [0.3 * s, 0.25 * s], [0.26 * s, 0.55 * s], [0.16 * s, 0.7 * s], [0.19 * s, 0.78 * s], [0.15 * s, 0.79 * s]], c, { x: shopsAt + 4.4 + i * 0.75, y: 0, z: -1.9, mat: 'clay' });
}
cart(shopsAt + 9.4, 0.4);
barrel(x - 0.8, -1.8);

/* ----- the town gate, and the fields beyond ----- */
townWall(x, x + 4.6, FRONT - 0.4);
townGate(x + 5.3, x + 11.5, FRONT - 0.4);
townWall(x + 12.2, x + 24, FRONT - 0.4);
const GATE_X = x + 8.4;
put(new THREE.PlaneGeometry(60, 70, 30, 35).rotateX(-Math.PI / 2), ['#8fb35a', '#84aa52'], { x: GATE_X, y: 0.01, z: -40, vary: 0.04, mat: 'plain' });
box(3.2, 0.06, 40, '#c8a77a', { x: GATE_X, y: 0.03, z: -24, r: 0.02, mat: 'ground' });
for (const [dx, z, s] of [[-7, -12, 0.7], [8, -16, 0.8], [-4, -26, 0.6], [11, -30, 0.7]]) tree(GATE_X + dx, z, s);
for (const [dx, z, sx, sy, sz, c] of [[-13, -62, 26, 9, 14, '#86ab55'], [15, -66, 30, 11, 16, '#7fa34f'], [1, -78, 34, 14, 18, '#93b660']]) ball(1, c, { x: GATE_X + dx, y: -2, z, sx, sy, sz, n: 16, m: 10, mat: 'plain' });
pot(GATE_X - 4.6, -1.8); pot(GATE_X + 4.6, -1.8, 0.9);

/* ----- the second row of houses, glimpsed over the low roofs ----- */
{
  const walls = ['#efe0c4', '#f0d6b0', '#e8d6bd', '#f3e3c6', '#f4e7d2', '#e9cfa4', '#e3d2df', '#d5dce8'];
  for (let bx = -16; ;) {
    const w = range(5.5, 7.5);
    if (bx + w > GATE_X - 9) break; // beyond the town wall there are only fields
    if (bx + w < LANE[0] - 6 || bx > LANE[1] + 6) backHouse(bx, w, range(8.5, 10.5), -13.5 + range(-0.6, 0.6), pick(walls), pick([ROOF.slate, ROOF.brown, ROOF.terracotta]));
    bx += w;
  }
}

/* ---------- merge: one mesh per surface for each 20 m of street; leaves and petals instanced the same way ---------- */

const CHUNK = 20;
const chunkOf = (vx) => Math.floor(vx / CHUNK);

function surfaceMaterial(kind) {
  const spec = MATS[kind], t = spec.tex && scans[spec.tex];
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: spec.rough, metalness: 0 });
  if (t) {
    m.map = t.map;
    if (t.normalMap && spec.bump) { m.normalMap = t.normalMap; m.normalScale.set(spec.bump, spec.bump); }
    m.onBeforeCompile = (sh) => {
      sh.uniforms.detailAvg = { value: t.avg };
      sh.uniforms.detailAmount = { value: spec.amount };
      sh.fragmentShader = 'uniform vec3 detailAvg; uniform float detailAmount;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          // the scan as detail: its own colour divided out, so each piece keeps the colour it was given
          vec3 detail = texture2D( map, vMapUv ).rgb / max( detailAvg, vec3( 0.03 ) );
          diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( detail, 0.0, 2.2 ), detailAmount );
        #endif`);
    };
    m.customProgramCacheKey = () => 'detail';
  }
  return m;
}

function bakeSolid() {
  const groups = new Map();
  for (const g of solid) {
    g.computeBoundingSphere();
    const key = `${g.userData.mat}:${chunkOf(g.boundingSphere.center.x)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  const mats = {};
  for (const [key, geos] of groups) {
    const kind = key.split(':')[0];
    mats[kind] ||= surfaceMaterial(kind);
    const mesh = new THREE.Mesh(mergeGeometries(geos), mats[kind]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
}

function bake(list, material, { cast = false } = {}) {
  const buckets = new Map();
  for (const g of list) {
    g.computeBoundingSphere();
    const k = chunkOf(g.boundingSphere.center.x);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(g);
  }
  for (const geos of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
}

/** a drawn leaf (white, tinted per card): a soft pointed shape with a midrib and veins */
function leafTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  const shape = new Path2D();
  shape.moveTo(32, 124); shape.bezierCurveTo(4, 98, 4, 34, 32, 3); shape.bezierCurveTo(60, 34, 60, 98, 32, 124);
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#a9a9a9'); grd.addColorStop(0.45, '#ffffff'); grd.addColorStop(1, '#9a9a9a');
  g.fillStyle = grd; g.fill(shape);
  const tip = g.createLinearGradient(0, 0, 0, 128);
  tip.addColorStop(0, 'rgba(255,255,255,0.18)'); tip.addColorStop(1, 'rgba(0,0,0,0.15)');
  g.fillStyle = tip; g.fill(shape);
  g.strokeStyle = 'rgba(70,70,70,0.55)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(32, 122); g.lineTo(32, 10); g.stroke();
  g.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    const y = 104 - i * 19;
    g.beginPath(); g.moveTo(32, y); g.quadraticCurveTo(22, y - 8, 14, y - 18); g.stroke();
    g.beginPath(); g.moveTo(32, y); g.quadraticCurveTo(42, y - 8, 50, y - 18); g.stroke();
  }
  g.strokeStyle = 'rgba(60,60,60,0.45)'; g.lineWidth = 2; g.stroke(shape);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** a drawn five-petal flower (white petals tinted per card, a warm centre) */
function petalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const grd = g.createRadialGradient(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16, 2, 32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16, 15);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#d6d6d6');
    g.fillStyle = grd;
    g.beginPath(); g.ellipse(32 + Math.cos(a) * 16, 32 + Math.sin(a) * 16, 13, 9, a, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#f5d070'; g.beginPath(); g.arc(32, 32, 8, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function bakeCards(list, tex) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
  const buckets = new Map();
  for (const c of list) {
    const k = chunkOf(c.m.elements[12]);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(c);
  }
  for (const cards of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, cards.length);
    cards.forEach((c, i) => { mesh.setMatrixAt(i, c.m); mesh.setColorAt(i, c.c); });
    mesh.computeBoundingSphere();
    mesh.customDepthMaterial = depth;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function lattice() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, '#4a4472'); grd.addColorStop(1, '#2f2b52');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(14, 14, 30, 30);
  g.strokeStyle = '#d7c4a0'; g.lineWidth = 8;
  for (const o of [-128, 0, 128]) {
    g.beginPath(); g.moveTo(o, 0); g.lineTo(o + 128, 128); g.stroke();
    g.beginPath(); g.moveTo(o + 128, 0); g.lineTo(o, 128); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// reflections for glass and water: a soft copy of the sky
const envTex = (() => {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color('#4a82d4') }, mid: { value: new THREE.Color('#8fbbea') }, low: { value: new THREE.Color('#dce8f0') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, mid, low; varying vec3 vP;
      void main(){ float h = normalize(vP).y; vec3 c = mix(low, mid, smoothstep(-0.02, 0.3, h)); c = mix(c, top, smoothstep(0.3, 0.9, h));
        if (h < -0.02) c = vec3(0.32, 0.28, 0.3); gl_FragColor = vec4(c, 1.0); }`,
  })));
  return new THREE.PMREMGenerator(renderer).fromScene(envScene, 0.02).texture;
})();


/* ---------- the easel: stands in the street near the start, in front of the café ---------- */

/** the easel's paper: the drawer's picture, replayed from their phone. The phone draws on a portrait sheet (DrawBoard
 *  ops, 1000 wide by 1250 tall), the same shape as the easel's paper, so it fills it. */
const doodle = (() => {
  const c = document.createElement('canvas'); c.width = 768; c.height = Math.round(768 * DrawBoard.PORTRAIT);
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const square = document.createElement('canvas'), board = new DrawBoard(square, DrawBoard.PORTRAIT);
  board.resize(c.width);
  let fresh = true, since = 1, colour = '#fffdf6';
  // white paper, the drawer's single ink on it (see drawInk)
  const compose = () => {
    g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height);
    drawInk(g, square, 0, 0, c.width, c.height);
    tex.needsUpdate = true;
  };
  compose();
  return {
    tex, board,
    changed() { fresh = true; },
    reset(paper = colour) { board.clear(); colour = paper; fresh = true; },
    /** sent to the GPU at most 30 times a second */
    step(dt) {
      since += dt;
      if (!fresh || since < 1 / 30) return false;
      since = 0; fresh = false; compose();
      return true;
    },
  };
})();

// one easel per round, along the street; the camera stands at each station with its easel just to the left
const STATIONS = [3, 24, 46, 62, 90, 104];
const EASEL = { dx: -1.15, z: 3.0, scale: 1.8, canvasW: 1.2, canvasH: 1.5, canvasY: 1.3, lean: 0.12 };
const easels = [];
/** an easel whose canvas sits at height `cy` (taller ones stand behind shorter ones), with a blank sheet of paper */
function makeEasel(cy = EASEL.canvasY) {
  const easelParts = [];
  const { canvasW: W, canvasH: H, lean } = EASEL;
  const wood = C.woodLight, dark = C.wood, o = { list: easelParts, mat: 'wood', vary: 0.02 };
  // everything leans back a touch, hinged at the feet
  withFrame(new THREE.Matrix4().makeRotationX(-lean), () => {
    const topY = cy + H / 2 + 0.22;
    for (const s of [-1, 1]) beam(s * 0.62, 0, s * 0.16, topY - 0.08, 0.075, 0.07, wood, { ...o, z: 0.02 }); // front legs
    box(0.08, topY - 0.45, 0.06, wood, { ...o, y: 0.45 + (topY - 0.45) / 2, z: -0.03 });                  // centre mast
    box(0.07, 0.07, 0.06, dark, { ...o, y: topY + 0.035, z: -0.03 });                                       // mast cap
    box(1.15, 0.07, 0.06, wood, { ...o, y: 0.62, z: 0.02 });                                          // cross brace
    // the shelf the canvas sits on, with a lip, and the clamp on top
    const shelfY = cy - H / 2 - 0.04;
    box(W + 0.16, 0.06, 0.16, dark, { ...o, y: shelfY, z: 0.08 });
    box(W + 0.16, 0.07, 0.03, dark, { ...o, y: shelfY + 0.05, z: 0.15 });
    box(0.22, 0.07, 0.1, dark, { ...o, y: cy + H / 2 + 0.035, z: 0.06 });
    // a few paint tubes and a brush in the tray
    const tubes = ['#e0584c', '#4f9fd1', '#f2c14e', '#7cc06a'];
    tubes.forEach((c, i) => cyl(0.022, 0.022, 0.13, c, { list: easelParts, mat: 'plain', x: -W / 2 + 0.12 + i * 0.07, y: shelfY + 0.05, z: 0.09, rz: Math.PI / 2, ry: range(-0.3, 0.3) }));
    beam(W / 2 - 0.45, shelfY + 0.05, W / 2 - 0.12, shelfY + 0.07, 0.016, 0.016, C.woodDark, { list: easelParts, mat: 'plain', z: 0.1 });
    ball(0.025, '#c45bd2', { list: easelParts, mat: 'plain', x: W / 2 - 0.1, y: shelfY + 0.075, z: 0.1, sx: 0.6 });
    // the canvas: a stretcher frame, the board behind it
    box(W + 0.05, H + 0.05, 0.05, '#e8dcc4', { list: easelParts, mat: 'cloth', y: cy, z: 0.06, r: 0.015 });
  });
  // back leg: from the top of the mast down to a foot behind
  const top = [cy + H / 2 + 0.1, (cy + H / 2 + 0.1) * Math.sin(-lean) - 0.05], foot = [0, -1.05 * (cy + H / 2) / (EASEL.canvasY + H / 2)];
  box(0.07, Math.hypot(top[0] - foot[0], top[1] - foot[1]), 0.065, wood, { ...o, y: (top[0] + foot[0]) / 2, z: (top[1] + foot[1]) / 2, rx: Math.atan2(top[1] - foot[1], top[0] - foot[0]) });
  const easel = new THREE.Group();
  const groups = new Map();
  for (const g of easelParts) { const k = g.userData.mat; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  for (const [kind, geos] of groups) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), surfaceMaterial(kind));
    mesh.castShadow = mesh.receiveShadow = true;
    easel.add(mesh);
  }
  // the drawing surface: a sheet just proud of the canvas, carrying the drawing
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(EASEL.canvasW, EASEL.canvasH), new THREE.MeshStandardMaterial({ map: doodle.tex, roughness: 0.95 }));
  paper.position.set(0, cy, 0.09);
  const tilt = new THREE.Group(); tilt.rotation.x = -EASEL.lean; tilt.add(paper);
  easel.add(tilt);
  paper.layers.set(1);
  paper.castShadow = paper.receiveShadow = true;
  return easel;
}
const easel = makeEasel();
{
  const paper = easel.children.at(-1).children[0];
  easel.scale.setScalar(EASEL.scale);
  // the same easel at every station; only the current one carries the drawing, the rest wait blank
  const blank = new THREE.MeshStandardMaterial({ color: '#fbf8f1', roughness: 0.95 });
  for (const x of STATIONS) {
    const e = easel.clone();
    e.position.set(x + EASEL.dx, 0, EASEL.z);
    e.userData.paper = e.children.at(-1).children[0];
    e.userData.paper.material = blank;
    scene.add(e); easels.push(e);
  }
  easels[0].userData.paper.material = paper.material;
}

/* ---------- the word: Scrabble tiles along the easel's shelf, one per letter, blank (an underscore) until the game
   turns one over as a hint ---------- */

const TILE_POINTS = { a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3, n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10 };
const TILE = { size: 0.1, gap: 0.008, space: 0.05, depth: 0.02 };
const tiles = new THREE.Group();
// fixed to the front of the shelf, just under it
tiles.position.set(0, EASEL.canvasY - EASEL.canvasH / 2 - 0.04 + 0.01 - TILE.size, 0.165 + TILE.depth / 2);
// ivory with softly rounded edges, the letter on a face set into the front
const tileSide = new THREE.MeshStandardMaterial({ color: '#ead6ad', roughness: 0.45 });
const tileGeo = softBox(TILE.size, TILE.size, TILE.depth, 0.008);
tileGeo.translate(0, TILE.size / 2, 0);
const faceGeo = new THREE.PlaneGeometry(TILE.size - 0.012, TILE.size - 0.012);
faceGeo.translate(0, TILE.size / 2, TILE.depth / 2 + 0.0005);
function tileFace(letter) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, '#f6e7c6'); grd.addColorStop(1, '#ecd8ae');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1d1a17';
  if (letter) {
    g.font = '700 84px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter.toUpperCase(), 58, 64);
    g.font = '700 24px "Helvetica Neue", Arial, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillText(String(TILE_POINTS[letter] ?? ''), 116, 114);
  } else g.fillRect(32, 92, 64, 9); // the underscore
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
}
const word = { text: '', tiles: [] };
function setWord(text) {
  for (const m of word.tiles) { m.userData.face.material.map.dispose(); m.userData.face.material.dispose(); }
  tiles.clear();
  word.text = text; word.tiles = [];
  let w = 0;
  for (const ch of text) w += ch === ' ' ? TILE.space : TILE.size + TILE.gap;
  w -= TILE.gap;
  const fit = Math.min(1, (EASEL.canvasW + 0.1) / w); // long words get smaller tiles
  let x = -w / 2;
  [...text].forEach((ch, i) => {
    if (ch === ' ') { x += TILE.space; return; }
    if (!/[a-z0-9]/i.test(ch)) { x += TILE.size + TILE.gap; return; } // a dash or the like: shown as a gap
    const m = new THREE.Mesh(tileGeo, tileSide), face = new THREE.Mesh(faceGeo, tileFace(null));
    m.add(face);
    m.position.x = (x + TILE.size / 2) * fit; m.scale.setScalar(0.001); m.visible = false;
    m.userData.fit = fit; m.userData.at = nowS() + 0.35 + word.tiles.length * 0.09; // they pop on one by one, left to right
    m.rotation.z = range(-0.025, 0.025); // pinned on by hand
    m.userData.letter = ch.toLowerCase(); m.userData.index = i; m.userData.face = face; m.layers.set(1); face.layers.set(1);
    tiles.add(m); word.tiles.push(m);
    x += TILE.size + TILE.gap;
  });
  dirty = true;
}
/** pops the tiles on as their turn comes */
function stepWord() {
  let changed = false;
  for (const m of word.tiles) {
    const k = Math.min(1, Math.max(0, (nowS() - m.userData.at) / 0.28));
    if (k === 1 && m.scale.x === m.userData.fit) continue;
    const back = 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2); // a little overshoot
    m.visible = k > 0; m.scale.setScalar(Math.max(0.001, m.userData.fit * back)); changed = true;
  }
  return changed;
}
/** turns the tile for letter `i` of the word face up */
function revealLetter(i) {
  const m = word.tiles.find((t) => t.userData.index === i);
  if (!m || m.userData.shown) return;
  m.userData.shown = true;
  const f = m.userData.face; f.material.map.dispose(); f.material.dispose(); f.material = tileFace(m.userData.letter);
  dirty = true;
}
/** a new turn: the tiles move to this easel, empty until the drawer picks a word */
function wordOnEasel(e) { e.children.at(-1).add(tiles); setWord(''); }

/* ---------- the café menu: a chalkboard hanging from the top right of the view, carrying the chat; it rides with the camera ---------- */

// everyone draws on the same white paper; the game gives each seat its ink (these are DrawBoard palette colours 4..11, so seat i draws in palette colour INK0 + i)
const SEAT_COLOURS = ['#dc4a3c', '#ee8a32', '#f2cc3e', '#56b35e', '#4aa6dc', '#3e53bd', '#8b52bf', '#ea86b4'];
const INK0 = 4, PAPER = '#fffdf6';
const MENU = { w: 0.78, h: 1.0, dist: 2.2, margin: 0.06, right: 0.22 };
const FULLCHAT = Q.has('chatfull'); // dev preview (?chatfull): the board fills the whole screen, as it would on a phone
if (FULLCHAT) {
  const asp = window.innerWidth / window.innerHeight, fov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(EYE.fov / 2)) * Math.max(1, (16 / 9) / asp));
  const halfH = Math.tan(fov / 2) * MENU.dist;
  Object.assign(MENU, { w: 2 * halfH * asp - 0.1, h: 2 * halfH - 0.1 });
}
// the round's timer: shown as a row of squares along the bottom of the menu
const TIMER = { round: 50 }; // the drawing time, in seconds: one square each
const timer = (() => {
  let shown = null, endsAt = null; // null: held full (before the drawing starts)
  const left = () => endsAt === null ? 1 : Math.max(0, endsAt - performance.now() / 1000) / TIMER.round; // 1 at the start, 0 at the end
  const boxes = () => Math.ceil(left() * TIMER.round); // a square for every second left
  function start(sec = TIMER.round) { endsAt = performance.now() / 1000 + sec; shown = null; }
  function hold() { endsAt = null; shown = null; }
  /** redraws the menu when a square goes out */
  function step() {
    if (boxes() === shown) return false;
    shown = boxes(); chat.draw(); return true;
  }
  return { start, hold, step, left, boxes };
})();
const CHALK = ['#f4eee2', '#f2c14e', '#9fd4f0', '#f5a3b8', '#b5e29a'];
const inkOf = (name) => CHALK[Math.max(0, PLAYERS.findIndex((p) => p.name === name)) % CHALK.length];
const chat = (() => {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * MENU.h / MENU.w);
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const lines = [];
  const tint = new Map();
  // the bare board: plain dark slate
  const slate = document.createElement('canvas'); slate.width = c.width; slate.height = c.height;
  { const s = slate.getContext('2d'); s.fillStyle = '#0a0c0b'; s.fillRect(0, 0, c.width, c.height); }
  /** splits text into lines; `max(i)` is how wide line i may be */
  function wrap(text, max) {
    const out = []; let cur = '';
    for (const w of text.split(' ')) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > max(out.length) && cur) { out.push(cur); cur = w; } else cur = t; }
    out.push(cur); return out;
  }
  function draw() {
    g.drawImage(slate, 0, 0);
    if (FULLCHAT) { // phone preview of the portrait page: just the name and a square canvas
      const side = c.width - 60, top = Math.round(190 + (c.height - 190 - 30 - side) / 2);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 96px "Cafe Francoise", sans-serif'; g.fillStyle = '#f4eee2'; g.fillText('PENNY', c.width / 2, 100);
      g.fillStyle = PAPER; g.fillRect(30, top, side, side);
      g.strokeStyle = SEAT_COLOURS[0]; g.lineWidth = 9; g.lineCap = 'round'; // a sample doodle in this seat's ink
      const mx = 30 + side / 2, my = top + side / 2;
      g.beginPath(); g.arc(mx, my, side * 0.38, 0, Math.PI * 2); g.stroke();
      for (const ex of [-0.13, 0.13]) { g.beginPath(); g.arc(mx + side * ex, my - side * 0.1, 7, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.arc(mx, my + side * 0.02, side * 0.2, 0.2, Math.PI - 0.2); g.stroke();
      tex.needsUpdate = true; return;
    }
    const pad = 30, lh = 44;
    // the timer along the bottom: a white square for every second left, and the number above its right end
    const n = TIMER.round, gap = 2, sq = (c.width - pad * 2 - gap * (n - 1)) / n, y0 = c.height - pad - sq, lit = timer.boxes();
    for (let i = 0; i < n; i++) {
      g.fillStyle = i < lit ? '#f4eee2' : '#1e2220';
      g.beginPath(); g.roundRect(pad + i * (sq + gap), y0, sq, sq, 1.5); g.fill();
    }
    g.font = '600 56px "Cafe Francoise", sans-serif'; g.textAlign = 'right'; g.textBaseline = 'bottom';
    const numRight = c.width - pad - 6, numBottom = y0 - 22, numLeft = numRight - g.measureText('00').width - 16, numTop = numBottom - 50;
    g.fillStyle = '#f4eee2'; g.globalAlpha = 0.92; g.fillText(String(lit), numRight, numBottom);
    g.textAlign = 'left'; g.textBaseline = 'top';
    // the chat, newest at the bottom: full width, except lines level with the number, which wrap short of it
    g.font = '600 36px "Cafe Francoise", sans-serif';
    const widthAt = (y) => (y + lh > numTop && y < numBottom ? numLeft : c.width - pad) - pad;
    let bottom = y0 - 12; // where the next (older) message must end
    for (let m = lines.length - 1; m >= 0 && bottom > pad; m--) {
      const l = lines[m], name = l.name + ' ', nw = g.measureText(name).width;
      let rows = [l.text];
      for (let k = 0, guess = 1; k < 4; k++) { // the widths depend on where the lines land, which depends on how many there are
        rows = wrap(l.text, (i) => widthAt(bottom - (guess - i) * lh) - nw);
        if (rows.length === guess) break;
        guess = rows.length;
      }
      const top = bottom - rows.length * lh;
      rows.forEach((t, i) => {
        const y = top + i * lh;
        if (y < pad) return;
        if (!i) { g.fillStyle = tint.get(l.name); g.fillText(name, pad, y); }
        g.fillStyle = '#f4eee2'; g.fillText(t, pad + nw, y);
      });
      bottom = top;
    }
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  }
  function say(name, text) {
    if (!tint.has(name)) tint.set(name, inkOf(name));
    lines.push({ name, text }); if (lines.length > 40) lines.shift();
    draw(); dirty = true;
  }
  draw();
  document.fonts?.ready.then(draw);
  function clear() { lines.length = 0; draw(); }
  return { tex, say, clear, draw };
})();

const menu = new THREE.Group();
{
  const parts = [], o = { list: parts, mat: 'wood', vary: 0.02 }, f = 0.03;
  const { w: W, h: H } = MENU;
  for (const s of [-1, 1]) {
    box(W + f * 2, f, 0.035, C.wood, { ...o, y: s * (H / 2 + f / 2), r: 0.012 });
    box(f, H, 0.035, C.wood, { ...o, x: s * (W / 2 + f / 2), r: 0.012 });
    cyl(0.006, 0.006, 1.2, C.iron, { list: parts, mat: 'iron', x: s * W * 0.36, y: H / 2 + f + 0.6, n: 6 }); // hanging chains, up out of view
    ring(0.014, 0.004, C.iron, { list: parts, mat: 'iron', x: s * W * 0.36, y: H / 2 + f + 0.01, ry: Math.PI / 2 });
  }
  const groups = new Map();
  for (const g of parts) { const k = g.userData.mat; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
  for (const [kind, geos] of groups) menu.add(new THREE.Mesh(mergeGeometries(geos), surfaceMaterial(kind)));
  menu.add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: chat.tex, toneMapped: false })));
  menu.rotation.y = FULLCHAT ? 0 : -0.08;
  menu.traverse((o) => o.layers.set(FULLCHAT ? 2 : 1));
  camera.add(menu);
  scene.add(camera);
}
// where it hangs, in front of the camera at the top right; it drops in from above on load and swings to rest
const menuDrop = { y: 3, v: 0, rest: 0, x: 0, up: true }; // up (out of view) in the lobby
function placeMenu() {
  if (FULLCHAT) { menuDrop.x = 0; menuDrop.rest = 0; return; }
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * MENU.dist, halfW = halfH * camera.aspect;
  menuDrop.x = halfW - MENU.w / 2 - 0.03 - MENU.margin - MENU.right;
  menuDrop.rest = halfH - MENU.h / 2 - 0.03 - MENU.margin;
}
function stepMenu(dt) {
  const d = menuDrop.y - (menuDrop.up && !FULLCHAT ? menuDrop.rest + 1.6 : menuDrop.rest);
  if (Math.abs(d) < 1e-4 && Math.abs(menuDrop.v) < 1e-4) return false;
  menuDrop.v += (-d * 40 - menuDrop.v * 11) * dt; // slow, with only a small dip past its resting height
  menuDrop.y += menuDrop.v * dt;
  menu.position.set(menuDrop.x, menuDrop.y, -MENU.dist);
  menu.rotation.z = -menuDrop.v * 0.05;
  return true;
}

/* ---------- the players: a long blackboard along the bottom of the view, each player a little French thing above their name ---------- */

const PLAYERS = Array.from({ length: 8 }, () => ({ name: '', taken: false, score: 0 })); // the eight seats, filled by whoever joins
const playing = () => PLAYERS.filter((p) => p.taken);

// each player: a little easel with the self-portrait they drew when they joined, their name written under it
const ROSTER_MINI_K = 3.0; // the little easels' size, against the seat radius
const ROSTER = { r: 0.15, ring: 0, margin: MENU.margin };
const roster = new THREE.Group();
const ROSTER_MINI = ROSTER.r * ROSTER_MINI_K / (EASEL.canvasY + EASEL.canvasH / 2 + 0.3);
const rosterParts = { seats: [] };
{
  const { r, ring: t } = ROSTER;
  PLAYERS.forEach((p, i) => {
    const seat = new THREE.Group();
    const c = document.createElement('canvas'); c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = PAPER;
    g.beginPath(); g.arc(256, 256, 254, 0, Math.PI * 2); g.fill();
    p.pic = c; p.colour = SEAT_COLOURS[i % SEAT_COLOURS.length];
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    p.picTex = tex;
    // a little easel carrying their self-portrait (blank until they join)
    const mini = makeEasel();
    mini.scale.setScalar(ROSTER_MINI);
    mini.position.y = -r;
    mini.traverse((o) => { o.castShadow = o.receiveShadow = false; });
    p.rosterPaper = mini.children.at(-1).children[0];
    p.rosterPaper.material = new THREE.MeshStandardMaterial({ color: '#fbf8f1', roughness: 0.95 });
    seat.add(mini);
    rosterParts.seats.push(seat); roster.add(seat);
  });
  roster.traverse((o) => o.layers.set(1));
  camera.add(roster);
}
function placeRoster() {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * MENU.dist, halfW = halfH * camera.aspect;
  const { r, ring: t, margin } = ROSTER;
  const n = playing().length;
  rosterParts.slot = r * 2 + 0.05;
  rosterParts.seats.forEach((seat, i) => { seat.userData.taken = PLAYERS[i].taken; });
  layoutRoster(true);
  // low enough that the bottom of each canvas sits just above the edge, its legs out of view
  rosterDrop.x = 0;
  rosterDrop.rest = -halfH + 0.015 + r - (EASEL.canvasY - EASEL.canvasH / 2) * ROSTER_MINI;
  rosterDrop.hidden = rosterDrop.rest - 0.7;
  if (rosterDrop.y === null) rosterDrop.y = rosterDrop.hidden;
  rosterDrop.y = Math.min(rosterDrop.y, rosterDrop.rest);
  stepRoster(0);
}
// it floats up from just below the view on load and sinks back while the menu is lifted: a short trip, so a firmer, barely-bouncing spring
const rosterDrop = { y: null, v: 0, rest: 0, hidden: 0, x: 0 };
// coming back, everyone pops up from the bottom one by one, left to right, a moment apart
const ROSTER_GAP = 0.08;
const nowS = () => performance.now() / 1000;
let rosterShownAt = nowS() + 0.9, rosterWasUp = false;
/* the drawer's turn: their easel sinks out of the row and the others close up; when they're done the row opens a gap
   and theirs comes back up into it */
const turn = { drawer: null, hideAt: null, showAt: null };
const turnNow = () => {
  const t = nowS(), { hideAt, showAt } = turn;
  return {
    gone: hideAt !== null && t > hideAt + 0.35 && (showAt === null || t < showAt), // left out of the row
    sunk: hideAt !== null && t > hideAt && (showAt === null || t < showAt + 0.45), // below the edge
  };
};
function startTurn(p) { turn.drawer = p; turn.hideAt = nowS() + 1.6; turn.showAt = null; } // after the row has popped in
function endTurn() { if (turn.hideAt !== null && turn.showAt === null) turn.showAt = nowS(); return turn.drawer ? 0.95 : 0; } // how long it takes
/** where each seat should sit along the row: just the people in it, centred */
function layoutRoster(snap = false, dt = 0) {
  const { gone } = turnNow(), slot = rosterParts.slot;
  const inRow = rosterParts.seats.filter((seat, i) => seat.userData.taken && !(gone && PLAYERS[i] === turn.drawer));
  let moved = false;
  rosterParts.seats.forEach((seat) => {
    const j = inRow.indexOf(seat);
    if (j < 0) return;
    const x = -inRow.length * slot / 2 + slot * (j + 0.5);
    const nx = snap ? x : seat.position.x + (x - seat.position.x) * (1 - Math.exp(-dt * 9));
    if (Math.abs(nx - seat.position.x) > 1e-5) moved = true;
    seat.position.x = Math.abs(nx - x) < 1e-4 ? x : nx;
  });
  return moved;
}
function stepRoster(dt) {
  const away = menuDrop.up;
  if (rosterWasUp && !away) { rosterShownAt = nowS() + 0.6; rosterDrop.y = rosterDrop.rest; rosterDrop.v = 0; } // pops start once the menu is on its way down
  rosterWasUp = away;
  if (!away) {
    const since = nowS() - rosterShownAt;
    let changed = false;
    // each one pops up from below the edge in turn, overshooting a touch before it settles
    const { sunk } = turnNow();
    if (layoutRoster(false, dt)) changed = true;
    rosterParts.seats.forEach((seat, i) => {
      const k = Math.min(1, Math.max(0, (since - i * ROSTER_GAP) / 0.38));
      const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // ease out with a little overshoot
      // the drawer's sinks (and later rises) on its own, eased
      const wantDown = sunk && PLAYERS[i] === turn.drawer ? 1 : 0;
      seat.userData.down = (seat.userData.down ?? 0) + (wantDown - (seat.userData.down ?? 0)) * (1 - Math.exp(-dt * 10));
      if (Math.abs(seat.userData.down - wantDown) < 1e-3) seat.userData.down = wantDown;
      const y = (back - 1) * 0.6 - seat.userData.down * 0.6;
      seat.visible = k > 0 && seat.userData.taken && seat.userData.down < 0.99;
      if (seat.position.y !== y) { seat.position.y = y; changed = true; }
    });
    if (rosterDrop.y !== rosterDrop.rest) { rosterDrop.y = rosterDrop.rest; rosterDrop.v = 0; changed = true; }
    roster.position.set(rosterDrop.x, rosterDrop.y, -MENU.dist); roster.rotation.z = 0;
    if (changed) dirty = true;
    return changed;
  }
  const d = rosterDrop.y - rosterDrop.hidden;
  if (Math.abs(d) < 1e-4 && Math.abs(rosterDrop.v) < 1e-4 && dt) return false;
  rosterDrop.v += (-d * 160 - rosterDrop.v * 21) * dt;
  rosterDrop.y += rosterDrop.v * dt;
  roster.position.set(rosterDrop.x, rosterDrop.y, -MENU.dist);
  roster.rotation.z = rosterDrop.v * 0.03;
  return true;
}

/* ---------- the big board: between rounds, a nearly full-screen menu-style board comes down showing everyone ---------- */

const BIG = { fill: 0.84, f: 0.033 };
const big = new THREE.Group();
const bigParts = {};
{
  const c = document.createElement('canvas');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  bigParts.canvas = c; bigParts.tex = tex;
  bigParts.face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  bigParts.frame = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial('wood'));
  bigParts.chains = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial('iron'));
  big.add(bigParts.frame, bigParts.chains, bigParts.face);
  big.traverse((o) => o.layers.set(1));
  camera.add(big);
}
/* the scoreboard, as in Dying to Know: the board comes down empty, then everyone appears in a row along the bottom
   (lowest score on the left); a chalk T rises from each, notched every 100 points, the score
   riding on top and counting up */
const SCORE = { showAt: 2.2, gap: 0.08, riseAt: 0.6, perSec: 300 }; // they pop in one by one, left to right, a moment apart
const bigAnim = { t0: null, title: '' };
/** the scores so far (each seat's `score`), counting up; `title` is chalked across the top (the winner, at the end) */
function startScoreboard(title = '') {
  bigAnim.t0 = clock.elapsedTime;
  bigAnim.title = title;
  bigAnim.ranked = [...playing()].sort((a, b) => a.score - b.score); // richest on the right
}
function layoutBig(W, H) {
  const c = bigParts.canvas;
  c.width = Math.round(W * 512 / MENU.w); c.height = Math.round(H * 512 / MENU.w); // the menu's pixels per metre
  renderBig(null);
}
/* the lobby, Drawful-style: eight little easels in the street, empty until someone joins; each player draws a
   self-portrait on their phone and it appears on their easel, their name written under it. That drawing is their picture for
   the whole game. Where to join and the room code hang on two small boards at the top. The VIP (first in) gets a beret on their easel.
   The camera comes down out of the sky onto it all; W starts the game and glides on to the first easel. */
const LOBBY_X = 84;
const lobby = { on: true, code: '', easels: [] }; // code: the room's, once the server has made it
{
  // a grid of four by two; the back row stands on taller easels so its canvases show above the front row's
  const blank = lobby.blank = easels[1].userData.paper.material;
  const tall = makeEasel(3.35), short = makeEasel(1.75);
  PLAYERS.forEach((p, i) => {
    const back = i < 4, k = i % 4;
    const e = (back ? tall : short).clone();
    e.scale.setScalar(0.76);
    e.position.set(LOBBY_X + (k - 1.5) * 1.36, 0, back ? 0.9 : 3.1);
    e.rotation.y = range(-0.08, 0.08);
    const paper = e.children.at(-1).children[0];
    paper.material = blank;
    scene.add(e);
    lobby.easels.push({ e, paper, cy: back ? 3.35 : 1.75 });
  });
  // the VIP's beret, perched on top of their easel
  const parts = [];
  ball(0.2, '#232324', { list: parts, mat: 'plain', y: 0.06, sy: 0.3, n: 16, m: 10 });
  cyl(0.02, 0.014, 0.07, '#232324', { list: parts, mat: 'plain', y: 0.12, n: 6 });
  lobby.beret = new THREE.Mesh(mergeGeometries(parts), surfaceMaterial('plain'));
  lobby.beret.position.set(0, lobby.easels[0].cy + EASEL.canvasH / 2 + 0.28, 0); lobby.beret.rotation.z = 0.25;
  lobby.beret.visible = false;
  lobby.easels[0].e.children.at(-1).add(lobby.beret);
}
// two small boards hung at the top of the view in the lobby, in the menu's style: where to join on the left, the code on the right
const LOBBY_SIGNS = { w: 0.5, codeW: 0.3, h: 0.13, f: 0.016 }; // codeW: the code's board, just wide enough for it
const lobbySigns = { y: 1.6, v: 0, groups: [] };
{
  const { h: H, f } = LOBBY_SIGNS;
  const board = (W, paint) => {
    const grp = new THREE.Group(), parts = [], o = { list: parts, mat: 'wood', vary: 0.02 };
    for (const s of [-1, 1]) {
      box(W + f * 2, f, 0.035, C.wood, { ...o, y: s * (H / 2 + f / 2), r: 0.012 });
      box(f, H, 0.035, C.wood, { ...o, x: s * (W / 2 + f / 2), r: 0.012 });
      cyl(0.006, 0.006, 1.2, C.iron, { list: parts, mat: 'iron', x: s * W * 0.36, y: H / 2 + f + 0.6, n: 6 });
    }
    const byMat = new Map();
    for (const g of parts) { const k = g.userData.mat; if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(g); }
    for (const [kind, geos] of byMat) grp.add(new THREE.Mesh(mergeGeometries(geos), surfaceMaterial(kind)));
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * H / W);
    const g = c.getContext('2d');
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    grp.userData.repaint = () => {
      g.globalAlpha = 1; g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, c.width, c.height);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.globalAlpha = 0.92;
      paint(g, c);
      t.needsUpdate = true; dirty = true;
    };
    grp.userData.repaint();
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })));
    grp.traverse((m) => m.layers.set(1));
    camera.add(grp);
    lobbySigns.groups.push(grp);
    return grp;
  };
  board(LOBBY_SIGNS.w, (g, c) => {
    // one line: "join at" then the address, sized to fit
    const lead = 'join at ', url = 'barcodegames.fun';
    let px = 60;
    const width = () => { g.font = `600 ${px}px "Cafe Francoise", sans-serif`; const a = g.measureText(lead).width; g.font = `700 ${px}px "Cafe Francoise", sans-serif`; return a + g.measureText(url).width; };
    while (width() > c.width - 40) px -= 2;
    g.font = `600 ${px}px "Cafe Francoise", sans-serif`; const lw = g.measureText(lead).width;
    g.font = `700 ${px}px "Cafe Francoise", sans-serif`; const x0 = (c.width - lw - g.measureText(url).width) / 2;
    g.textAlign = 'left';
    g.font = `600 ${px}px "Cafe Francoise", sans-serif`; g.fillStyle = '#f4eee2'; g.fillText(lead, x0, c.height / 2);
    g.font = `700 ${px}px "Cafe Francoise", sans-serif`; g.fillStyle = '#ffffff'; g.fillText(url, x0 + lw, c.height / 2);
    g.textAlign = 'center';
  }).rotation.y = 0.08;
  board(LOBBY_SIGNS.codeW, (g, c) => {
    let px = Math.round(c.height * 0.78);
    g.font = `700 ${px}px "Cafe Francoise", sans-serif`;
    while (g.measureText(lobby.code).width > c.width - 40) { px -= 4; g.font = `700 ${px}px "Cafe Francoise", sans-serif`; }
    g.fillStyle = '#ffffff'; g.fillText(lobby.code, c.width / 2, c.height / 2 + 4);
  }).rotation.y = -0.08;
}
/** they drop in like the menu and lift away when the game starts */
function stepLobbySigns(dt) {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * MENU.dist, halfW = halfH * camera.aspect;
  const { w: W, codeW, h: H, f } = LOBBY_SIGNS, rest = halfH - H / 2 - f - MENU.margin;
  const d = lobbySigns.y - (lobby.on ? rest : rest + 1.2);
  const moving = Math.abs(d) > 1e-4 || Math.abs(lobbySigns.v) > 1e-4;
  if (moving) { lobbySigns.v += (-d * 40 - lobbySigns.v * 11) * dt; lobbySigns.y += lobbySigns.v * dt; }
  const edge = (w) => halfW - w / 2 - f - MENU.margin;
  lobbySigns.groups.forEach((grp, i) => { grp.position.set(i ? edge(codeW) : -edge(W), lobbySigns.y, -MENU.dist); grp.rotation.z = -lobbySigns.v * 0.04 * (i ? 1 : -1); });
  return moving;
}

/** dev: a quick wobbly self-portrait, as a player might draw on their phone (ink only, on a clear background) */
function selfPortrait() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#1d1a17'; g.lineWidth = 9;
  const wob = (n) => range(-n, n);
  const hw = range(62, 80), hh = range(70, 88), cy = 138;
  g.beginPath();
  for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.25) { const x = 128 + Math.cos(a) * (hw + wob(4)), y = cy + Math.sin(a) * (hh + wob(4)); a ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.fillStyle = pick(['#f6d7b8', '#e8b98f', '#c98d62', '#9a6440', '#fbe3cf']); g.fill(); g.stroke();
  // hair
  g.strokeStyle = pick(['#1d1a17', '#6a3d22', '#e8b84a', '#c2452f', '#5a4bd0']); g.lineWidth = 11;
  const style = Math.floor(rnd() * 3);
  g.beginPath();
  if (style === 0) for (let x = -hw + 8; x <= hw - 8; x += 16) { g.moveTo(128 + x, cy - hh + 14); g.lineTo(128 + x + wob(6), cy - hh - 18); }
  else if (style === 1) for (let x = -hw; x <= hw; x += 18) g.arc(128 + x * 0.9, cy - hh + 6, 12, Math.PI, 0);
  else { g.moveTo(128 - hw, cy - 10); g.quadraticCurveTo(128, cy - hh - 40, 128 + hw, cy - 10); }
  g.stroke();
  g.strokeStyle = '#1d1a17'; g.lineWidth = 8; g.fillStyle = '#1d1a17';
  for (const s of [-1, 1]) { g.beginPath(); g.arc(128 + s * hw * 0.38, cy - 8 + wob(3), range(6, 10), 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.arc(128, cy + 24, range(16, 26), 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  if (rnd() < 0.5) { g.fillStyle = 'rgba(230,90,110,0.45)'; for (const s of [-1, 1]) { g.beginPath(); g.arc(128 + s * hw * 0.6, cy + 16, 11, 0, Math.PI * 2); g.fill(); } }
  return c;
}
/* each seat's picture: their self-portrait as they draw it on their phone (DrawBoard ops), shown on their lobby easel
   and their little easel along the bottom (with their name written under it), and in their circle on the scoreboard */
const portraits = PLAYERS.map(() => { const c = document.createElement('canvas'); return { canvas: c, board: new DrawBoard(c, DrawBoard.PORTRAIT), fresh: false, extra: null }; });
portraits.forEach((pt) => pt.board.resize(384));
function paintSeat(i) {
  const p = PLAYERS[i], spot = lobby.easels[i], pt = portraits[i];
  const art = pt.extra || pt.canvas; // a bot's portrait is a ready-made picture
  // the paper: the drawing, and their name underneath
  if (!p.paper) {
    const c = document.createElement('canvas'); c.width = 384; c.height = Math.round(384 * EASEL.canvasH / EASEL.canvasW);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    p.paper = { c, t, mat: new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }) };
  }
  const { c, t, mat } = p.paper, g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, c.width, c.height); // every canvas is the same white
  // their drawing is a portrait sheet; a bot's ready-made picture is square
  const ah = c.height * (pt.extra ? 0.72 : 0.84), aw = pt.extra ? ah : ah / DrawBoard.PORTRAIT;
  drawInk(g, art, (c.width - aw) / 2, 2, aw, ah, !pt.extra);
  g.font = '600 62px "Cafe Francoise", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.fillStyle = '#1f1d1a'; g.fillText(p.name, c.width / 2, c.height - 8);
  t.needsUpdate = true;
  spot.paper.material = mat; p.rosterPaper.material = mat;
  // the circle
  const pg = p.pic.getContext('2d');
  pg.fillStyle = PAPER; pg.beginPath(); pg.arc(256, 256, 254, 0, Math.PI * 2); pg.fill();
  pg.save(); pg.beginPath(); pg.arc(256, 256, 254, 0, Math.PI * 2); pg.clip(); if (pt.extra) drawInk(pg, art, 16, 24, 480, 480, false); else drawInk(pg, art, 16, -40, 480, 480 * DrawBoard.PORTRAIT, true); pg.restore();
  p.picTex.needsUpdate = true;
  dirty = true;
}
/** a drawing in the seat's ink on white paper. Drawings are in a single ink (see seatDraw) on DrawBoard's white
 *  paper, so a 'multiply' blend keeps the paper white and the ink as it is. `ink` false: a ready-made
 *  picture (a bot's), drawn as it is. */
function drawInk(g, art, x, y, w, h, ink = true) {
  g.save();
  if (ink) g.globalCompositeOperation = 'multiply';
  g.drawImage(art, x, y, w, h);
  g.restore();
}
/** someone takes seat `i`: their easel appears, blank but for their name, until they draw on it */
function seatJoin(i, name) {
  const p = PLAYERS[i];
  Object.assign(p, { name, taken: true, score: 0 });
  portraits[i].board.clear(); portraits[i].extra = null;
  paintSeat(i);
  placeRoster();
}
function seatLeave(i) {
  PLAYERS[i].taken = false;
  lobby.easels[i].paper.material = lobby.blank; // an empty seat again
  placeRoster();
  dirty = true;
}
/** a stroke of their self-portrait, as sent from their phone (line, pts, fill, undo, clear) */
function seatDraw(i, op) {
  if (op && 'c' in op) op = { ...op, c: 0, s: 3, a: 1 }; // profile pictures are black and thick, nothing else
  if (!applyOp(portraits[i].board, op)) return;
  portraits[i].fresh = true;
}
function seatPicture(i, canvas) { portraits[i].extra = canvas; paintSeat(i); }
/** repaint any portrait that changed, at most 15 times a second */
let portraitSince = 0;
function stepPortraits(dt) {
  portraitSince += dt;
  if (portraitSince < 1 / 15) return;
  portraitSince = 0;
  portraits.forEach((pt, i) => { if (pt.fresh) { pt.fresh = false; paintSeat(i); } });
}
/** the VIP's easel gets the beret */
function seatVip(i) {
  lobby.beret.visible = i !== null && i >= 0;
  if (lobby.beret.visible) {
    lobby.easels[i].e.children.at(-1).add(lobby.beret);
    lobby.beret.position.y = lobby.easels[i].cy + EASEL.canvasH / 2 + 0.28;
  }
  dirty = true;
}
function setRoomCode(code) { lobby.code = code || ''; lobbySigns.groups[1].userData.repaint(); }
/** a drawing op from a phone, onto a DrawBoard; false if it isn't one */
function applyOp(board, data) {
  switch (data && data.type) {
    case 'line': return !!board.add({ t: 'l', c: data.c, s: data.s, a: data.a, p: data.p });
    case 'pts': board.extend(data.p); return true;
    case 'fill': return !!board.add({ t: 'f', c: data.c, x: data.x, y: data.y });
    case 'undo': board.undo(); return true;
    case 'clear': board.clear(); return true;
  }
  return false;
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function renderBig(t) {
  const c = bigParts.canvas, g = c.getContext('2d');
  g.fillStyle = '#0a0c0b'; g.fillRect(0, 0, c.width, c.height);
  const n = Math.max(1, playing().length);
  const rowW = c.width / n, dRow = Math.min(rowW * 0.72, c.height * 0.2);
  const rowY = c.height - dRow / 2 - dRow * 0.55;
  const ranked = bigAnim.ranked || playing();
  const at = (p) => ({ x: rowW * (ranked.indexOf(p) + 0.5), y: rowY, d: dRow });
  const shown = (p) => t !== null && t >= SCORE.showAt + ranked.indexOf(p) * SCORE.gap;
  // the bars: all rise at the same points per second, so the leaders take longest; the tallest fits under the top edge
  const landed = SCORE.showAt + (n - 1) * SCORE.gap;
  const pts = t === null ? 0 : Math.max(0, t - landed - SCORE.riseAt) * SCORE.perSec;
  const showBars = t !== null && t > landed + 0.2;
  const top = Math.max(1500, ...ranked.map((p) => p.score));
  const room = rowY - dRow / 2 - c.height * 0.16, perPt = room / top;
  const chalk = '#e8e6df', u = c.height / 300;
  if (bigAnim.title && t !== null && t > landed) {
    g.font = `700 ${Math.round(40 * u)}px "Cafe Francoise", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f2c14e'; g.globalAlpha = 0.95; g.fillText(bigAnim.title, c.width / 2, c.height * 0.12); g.globalAlpha = 1;
  }
  for (const p of ranked) {
    const { x, y, d } = at(p);
    if (!shown(p)) continue;
    if (showBars) {
      const v = Math.min(pts, p.score), h = v * perPt, base = y - d / 2 - 6 * u;
      g.globalAlpha = 0.92; g.fillStyle = chalk;
      g.fillRect(x - 1.5 * u, base - h, 3 * u, h);
      for (let m = 100; m <= v; m += 100) { const yy = base - m * perPt; g.fillRect(x - 5 * u, yy, 3 * u, 1.5 * u); g.fillRect(x + 2 * u, yy, 3 * u, 1.5 * u); }
      g.fillRect(x - 9 * u, base - h - 2.5 * u, 18 * u, 2.5 * u);
      g.font = `600 ${Math.round(14 * u)}px "Cafe Francoise", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillStyle = '#ffffff'; g.fillText(String(Math.round(v)), x, base - h - 5 * u);
      g.globalAlpha = 1;
    }
    g.drawImage(p.pic, x - d / 2, y - d / 2, d, d);
    g.font = `600 ${Math.round(d * 0.2)}px "Cafe Francoise", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = inkOf(p.name); g.globalAlpha = 0.92; g.fillText(p.name, x, y + d / 2 + d * 0.08); g.globalAlpha = 1;
  }
  bigParts.tex.needsUpdate = true;
  return t !== null && pts < top; // still moving
}
let bigSince = 0;
function stepScoreboard(dt) {
  if (bigAnim.t0 === null) return false;
  bigSince += dt;
  if (bigSince < 1 / 30) return false;
  bigSince = 0;
  if (!renderBig(clock.elapsedTime - bigAnim.t0)) bigAnim.t0 = null; // finished: the last frame stays
  return true;
}
const bigDrop = { y: null, v: 0, rest: 0, hidden: 0, show: false };
function placeBig() {
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * MENU.dist, halfW = halfH * camera.aspect;
  const f = BIG.f, W = halfW * 2 * BIG.fill, H = halfH * 2 * BIG.fill;
  const frame = [], chains = [], o = { list: frame, mat: 'wood', vary: 0.02 };
  for (const s of [-1, 1]) {
    box(W + f * 2, f, 0.035, C.wood, { ...o, y: s * (H / 2 + f / 2), r: 0.012 });
    box(f, H, 0.035, C.wood, { ...o, x: s * (W / 2 + f / 2), r: 0.012 });
    cyl(0.007, 0.007, 2.4, C.iron, { list: chains, mat: 'iron', x: s * W * 0.36, y: H / 2 + f + 1.2, n: 6 });
    ring(0.016, 0.005, C.iron, { list: chains, mat: 'iron', x: s * W * 0.36, y: H / 2 + f + 0.01, ry: Math.PI / 2 });
  }
  bigParts.frame.geometry.dispose(); bigParts.frame.geometry = mergeGeometries(frame);
  bigParts.chains.geometry.dispose(); bigParts.chains.geometry = mergeGeometries(chains);
  bigParts.face.scale.set(W, H, 1);
  layoutBig(W, H);
  bigDrop.rest = 0;
  bigDrop.hidden = halfH * 2 + 0.2;
  if (bigDrop.y === null) bigDrop.y = bigDrop.hidden;
  stepBig(0);
}
function stepBig(dt) {
  const d = bigDrop.y - (bigDrop.show ? bigDrop.rest : bigDrop.hidden);
  if (Math.abs(d) < 1e-4 && Math.abs(bigDrop.v) < 1e-4 && dt) return false;
  bigDrop.v += (-d * 40 - bigDrop.v * 11) * dt; // the menu's spring
  bigDrop.y += bigDrop.v * dt;
  big.position.set(0, bigDrop.y, -MENU.dist - 0.05);
  big.rotation.z = -bigDrop.v * 0.03;
  big.visible = bigDrop.y < bigDrop.hidden - 0.01 || bigDrop.show;
  return true;
}

/* ---------- the far town: only seen from up in the sky, so just plain boxes with gable roofs, packed in rows behind
   the street (kept clear of the lane up to the cathedral) ---------- */
{
  const walls = ['#efe0c4', '#e9d2b0', '#dccbab', '#f1e6d2', '#d9b9a6', '#c9d4d8', '#e6c9b8'];
  const roofs = [...ROOF.slate, ...ROOF.brown, ...ROOF.terracotta];
  for (let z = -16; z > -95; z -= range(7, 10)) {
    for (let x = -40; x < 150; x += range(5, 8)) {
      if (Math.abs(x - LANE_X) < 14 && z > -75) continue;
      if (x > CANAL[0] - 11 && x < CANAL[1] + 11 && z > -75) continue; // the canal and its houses
      const w = range(4, 6.5), d = range(4, 6.5), h = range(4, 9) + Math.max(0, -z - 40) * 0.04;
      const ry = range(-0.12, 0.12);
      box(w, h, d, pick(walls), { x, y: h / 2, z, ry, r: 0, mat: 'plain', vary: 0.06 });
      const rh = range(1.8, 3.2); // a plain gable, overhanging a little
      slab([[-w / 2 - 0.3, 0], [w / 2 + 0.3, 0], [0, rh]], d + 0.4, pick(roofs), { x, y: h - 0.05, z, ry, mat: 'plain' });
    }
  }
}

/* ---------- clouds: a deep layer of billowing cloud between the town and the sky, so going up passes through it and
   comes out above a sea of cloud tops. Each billow is a card with a painted puff: a noisy round mass lit from above
   (bright tops, blue-grey undersides), thousands of tiny wisps at its edge. They drift to the right (stepClouds) ---------- */
const cloudCards = []; window.__clouds = cloudCards; // dev: look at them from the console
const CLOUD_DRIFT = { near: 0.3, far: 1.7 }; // metres a second to the right: the clouds at the back drift faster than the ones in front
{
  const S = 192;
  const hash = (x, y, s) => { const h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return h - Math.floor(h); };
  const vnoise = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, s) => { let f = 0, amp = 0.5; for (let o = 0; o < 5; o++) { f += amp * vnoise(x, y, s + o * 13); x *= 2.03; y *= 2.03; amp *= 0.5; } return f; };
  const billow = () => {
    const seed = rnd() * 100;
    const density = (x, y) => {
      const dx = (x - S / 2) / (S * 0.42), dy = (y - S * 0.55) / (S * 0.36);
      const e = 1 - Math.sqrt(dx * dx + dy * dy);
      return Math.max(0, Math.min(1, e * 1.5 + (fbm(x / 22, y / 22, seed) - 0.5) * 1.1));
    };
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), px = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = density(x, y);
      if (d <= 0.01) continue;
      let shade = 0;
      for (let k = 1; k <= 5; k++) shade += density(x - k * 3, y - k * 7); // towards the sun, above and a little left
      const t = Math.exp(-shade * 0.45) * (1 - Math.max(0, (y - S * 0.5) / (S * 0.5)) * 0.35);
      const i = (y * S + x) * 4;
      px[i] = 160 + 95 * t; px[i + 1] = 172 + 82 * t; px[i + 2] = 200 + 52 * t;
      px[i + 3] = 255 * Math.min(1, d * 2.6);
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  };
  const looks = Array.from({ length: 6 }, billow);
  const card = new THREE.PlaneGeometry(1, 1);
  const CLOUDS = { y0: 13, y1: 22, x0: -70, x1: 180, z0: -150, z1: 12 };
  for (let i = 0; i < 420; i++) {
    const m = new THREE.Mesh(card, pick(looks)), w = range(10, 24);
    const x = range(CLOUDS.x0, CLOUDS.x1), z = range(CLOUDS.z0, CLOUDS.z1);
    // a rolling deck: thicker in waves, so its top undulates
    const top = CLOUDS.y1 + Math.sin(x * 0.05 + z * 0.03) * 2.5;
    m.scale.set(w * pick([1, -1]), w * range(0.75, 1), 1);
    m.position.set(x, range(CLOUDS.y0, top), z);
    m.matrixAutoUpdate = false; m.updateMatrix();
    m.userData.v = CLOUD_DRIFT.near + (CLOUD_DRIFT.far - CLOUD_DRIFT.near) * (CLOUDS.z1 - z) / (CLOUDS.z1 - CLOUDS.z0);
    scene.add(m); cloudCards.push(m);
  }
  cloudCards.x0 = CLOUDS.x0; cloudCards.x1 = CLOUDS.x1;
}
/** the cloud deck drifts right, wrapping round; only drawn up in the sky (the street is cached, so moving clouds redraw it) */
function stepClouds(dt) {
  if (camera.position.y < CLOUD_VISIBLE_Y) return false;
  const span = cloudCards.x1 - cloudCards.x0;
  for (const m of cloudCards) {
    m.position.x += m.userData.v * dt;
    if (m.position.x > cloudCards.x1) m.position.x -= span;
    m.updateMatrix();
  }
  return true;
}
const CLOUD_VISIBLE_Y = 6; // below this the camera is down in the town and can't see them
window.__camera = camera; // dev: look at the camera from the console

bakeSolid();
bake(panes, new THREE.MeshStandardMaterial({ map: lattice(), roughness: 0.25, metalness: 0.05, envMap: envTex, envMapIntensity: 0.6 }));
// water: a deep green-blue, rippled by a drawn normal map, mirroring the sky
const ripples = (() => {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), img = g.createImageData(n, n), d = img.data;
  const h = (x, y) => Math.sin(x * 0.11 + Math.sin(y * 0.05) * 2) * 0.5 + Math.sin(y * 0.19 + x * 0.03) * 0.35 + Math.sin((x + y) * 0.07) * 0.25;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1), i = (y * n + x) * 4;
    d[i] = 128 + dx * 90; d[i + 1] = 128 + dy * 90; d[i + 2] = 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.2, 0.14);
  return t;
})();
bake(water, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.25, envMap: envTex, envMapIntensity: 1.5, normalMap: ripples, normalScale: new THREE.Vector2(0.2, 0.2) }));
bake(veils, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, transparent: true, opacity: 0.5, envMap: envTex, depthWrite: false }));
bakeCards(leafCards, leafTexture());
bakeCards(petalCards, petalTexture());
for (const s of signs) scene.add(s);

/* ---------- the sky ---------- */

const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { top: { value: new THREE.Color('#4a82d4') }, mid: { value: new THREE.Color('#7fb0e8') }, low: { value: new THREE.Color('#cfe2f2') } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
  fragmentShader: `uniform vec3 top, mid, low; varying vec2 vUv;
    void main(){
      vec3 c = mix(low, mid, smoothstep(0.2, 0.6, vUv.y));
      c = mix(c, top, smoothstep(0.6, 1.0, vUv.y));
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
sky.frustumCulled = false;
sky.renderOrder = -10;
scene.add(sky);

/* ---------- light: a low golden sun from the left, a soft lilac sky ---------- */

scene.add(new THREE.HemisphereLight('#bcd2f2', '#b8a48c', 1.35));
const sun = new THREE.DirectionalLight('#fff3e2', 5.5);
const SUN_DIR = new THREE.Vector3(-0.6, 0.65, 0.46).normalize(); // a clear afternoon: high, from the left and in front
sun.castShadow = true;
sun.shadow.mapSize.set(+Q.get('shadow') || 2048, +Q.get('shadow') || 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

/** the shadow map covers the stretch of street around the camera and is redrawn once the camera has moved on;
 *  its size is fixed and its grid snapped to whole texels, so shadow edges hold still instead of crawling */
let shadowAt = null, shadowHalf = null;
function shadowsAround(x) {
  const c = Math.round(x / 6) * 6;
  if (c === shadowAt) return;
  shadowAt = c;
  const cam = sun.shadow.camera;
  const aim = (t) => {
    sun.target.position.copy(t);
    sun.position.copy(t).addScaledVector(SUN_DIR, 60);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    cam.position.copy(sun.position); cam.lookAt(t); cam.updateMatrixWorld();
  };
  const t = new THREE.Vector3(c + 2, 3, -5);
  aim(t);
  if (!shadowHalf) {
    const inv = cam.matrixWorldInverse, b = new THREE.Box3();
    for (const bx of [-18, 18]) for (const y of [-1, 12]) for (const z of [-16, 7]) b.expandByPoint(new THREE.Vector3(t.x + bx, y, z).applyMatrix4(inv));
    shadowHalf = { x: Math.max(-b.min.x, b.max.x), y: Math.max(-b.min.y, b.max.y), near: -b.max.z - 30, far: -b.min.z + 5 };
    Object.assign(cam, { left: -shadowHalf.x, right: shadowHalf.x, bottom: -shadowHalf.y, top: shadowHalf.y, near: shadowHalf.near, far: shadowHalf.far });
    cam.updateProjectionMatrix();
  }
  const texelX = (2 * shadowHalf.x) / sun.shadow.mapSize.x, texelY = (2 * shadowHalf.y) / sun.shadow.mapSize.y;
  const o = new THREE.Vector3().applyMatrix4(cam.matrixWorldInverse);
  const ax = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), ay = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
  t.addScaledVector(ax, o.x - Math.round(o.x / texelX) * texelX).addScaledVector(ay, o.y - Math.round(o.y / texelY) * texelY);
  aim(t);
  renderer.shadowMap.needsUpdate = true;
}

/* ---------- finishing: soft occlusion and a gentle background blur, both from the depth buffer ---------- */

// the scene is drawn into its own target (colour + depth) that the finishing passes read from
const size = new THREE.Vector2();
renderer.getDrawingBufferSize(size);
const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.has('msaa') ? +Q.get('msaa') : 4 });
sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y);
class ScenePass extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r) { r.setRenderTarget(sceneRT); r.clear(); r.render(scene, camera); }
}
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));
composer.setPixelRatio(STREET);
composer.renderToScreen = false; // the finished street is kept and shown again until the camera moves
composer.addPass(new ScenePass());

const DEPTH_GLSL = `
  #include <packing>
  uniform sampler2D tDepth; uniform float near, far; uniform vec2 res;
  float lin(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }`;

class DepthPass extends ShaderPass {
  // the first pass reads the scene straight from its target; later ones read the pass before
  constructor(shader, first) { super(shader, first ? 'tUnused' : 'tDiffuse'); this.first = first; }
  render(r, writeBuffer, readBuffer, dt, mask) {
    if (this.first) this.uniforms.tDiffuse.value = sceneRT.texture;
    this.uniforms.tDepth.value = sceneRT.depthTexture;
    this.uniforms.near.value = camera.near; this.uniforms.far.value = camera.far;
    this.uniforms.res.value.set(readBuffer.width, readBuffer.height);
    super.render(r, writeBuffer, readBuffer, dt, mask);
  }
}
const depthUniforms = () => ({ tDiffuse: { value: null }, tUnused: { value: null }, tDepth: { value: null }, near: { value: 0.3 }, far: { value: 140 }, res: { value: new THREE.Vector2(1, 1) } });
const QUAD_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

// occlusion: darker, slightly lilac, where nearby surfaces crowd in (measured against the surface's own slope, so flat ground stays clean)
composer.addPass(new DepthPass({
  uniforms: depthUniforms(),
  vertexShader: QUAD_VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; ${DEPTH_GLSL}
    void main(){
      vec4 col = texture2D(tDiffuse, vUv);
      float d = lin(vUv);
      if (d > far * 0.95) { gl_FragColor = col; return; }
      vec2 px = 1.0 / res;
      float l = lin(vUv - vec2(px.x, 0.0)), r = lin(vUv + vec2(px.x, 0.0)), b = lin(vUv - vec2(0.0, px.y)), t = lin(vUv + vec2(0.0, px.y));
      float gx = abs(r - d) < abs(d - l) ? r - d : d - l;
      float gy = abs(t - d) < abs(d - b) ? t - d : d - b;
      float radius = clamp(res.y * 0.07 / d, 3.0, res.y * 0.04);
      float spin = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      float occ = 0.0, scale = 0.06 + d * 0.012;
      for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float a = fi * 2.39996 + spin, rr = sqrt((fi + 0.5) / 8.0) * radius;
        vec2 o = vec2(cos(a), sin(a)) * rr;
        float expect = d + gx * o.x + gy * o.y;
        float diff = expect - lin(vUv + o * px);
        occ += clamp(diff / scale - 0.15, 0.0, 1.0) * (1.0 - smoothstep(0.6, 2.2, diff));
      }
      float ao = 1.0 - occ / 8.0 * 0.7;
      col.rgb *= ao * mix(vec3(0.86, 0.82, 0.98), vec3(1.0), ao);
      gl_FragColor = col;
    }`,
}, true));

// background blur: everything behind the easel softens; the easel and the menu stay sharp
const blurPass = new DepthPass({
  uniforms: { ...depthUniforms(), focus: { value: 6.5 }, amount: { value: 1 } },
  vertexShader: QUAD_VERT,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float focus; uniform float amount; varying vec2 vUv; ${DEPTH_GLSL}
    float coc(float d){ return clamp((d - focus) / d, 0.0, 1.0) * res.y * 0.018 * amount; }
    void main(){
      float d = lin(vUv), c0 = coc(d);
      vec4 col = texture2D(tDiffuse, vUv);
      if (c0 < 0.5) { gl_FragColor = col; return; }
      vec2 px = 1.0 / res;
      vec3 sum = col.rgb; float wsum = 1.0;
      for (int i = 0; i < 24; i++) {
        float fi = float(i);
        float a = fi * 2.39996, rr = sqrt((fi + 0.5) / 24.0) * c0;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * px;
        float w = smoothstep(rr - 1.0, rr, coc(lin(uv)));
        sum += texture2D(tDiffuse, uv).rgb * w; wsum += w;
      }
      gl_FragColor = vec4(sum / wsum, col.a);
    }`,
}, false);
composer.addPass(blurPass);

composer.addPass(new OutputPass());
composer.addPass(new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: QUAD_VERT,
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c * vec3(0.98, 0.99, 1.02), c * vec3(1.02, 1.0, 0.98), smoothstep(0.2, 0.8, l)); // a barely-there grade: daylight colours stay true
      float v = smoothstep(1.1, 0.35, length((vUv - 0.5) * vec2(1.0, 1.25)));
      c *= mix(0.82, 1.0, v);
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
const fxaa = new ShaderPass(FXAAShader);
composer.addPass(fxaa);

/* ---------- the camera: standing in the street, sliding along it ---------- */

let camX = LOBBY_X, targetX = LOBBY_X, camLift = LOBBY_LIFT, camTilt = 0; // camTilt 1: looking straight up into the sky
const clampX = (v) => Math.min(SLIDE.max, Math.max(SLIDE.min, v));
let streetStale = true;
function placeCamera() {
  streetStale = true;
  camera.position.set(camX, EYE.y + camLift, EYE.z);
  const h = camera.position.y; // the background blur fades out as the camera drops below the cloud layer
  blurPass.uniforms.amount.value = Math.min(1, Math.max(0, (h - 8) / 5));
  blurPass.enabled = blurPass.uniforms.amount.value > 0;
  camera.lookAt(camX, EYE.lookY + camLift * 0.96 + camTilt * 40, EYE.lookZ); // level out over the clouds as it rises
  shadowsAround(camX);
  dirty = true;
}
function fit() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  sceneRT.setSize(Math.round(w * STREET), Math.round(h * STREET));
  fxaa.material.uniforms.resolution.value.set(1 / (w * STREET), 1 / (h * STREET));
  camera.aspect = w / h;
  // a tall window keeps the same width of street in view
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(EYE.fov / 2)) * Math.max(1, (16 / 9) / camera.aspect)));
  camera.updateProjectionMatrix();
  placeMenu(); placeRoster(); placeBig(); menuDrop.y = Math.max(menuDrop.y, menuDrop.rest); stepMenu(0);
  placeCamera();
}
fit();
window.addEventListener('resize', fit);

/* ---------- the camera's trips, which the game calls (game.js) ---------- */

let station = 0, move = null;
/** from the lobby: up into the sky, tipping back so the jump across can't be seen, then down onto the first easel,
 *  square in front of it; a moment later it eases right to where it stands for the turn */
function flyToGame(done) {
  lobby.on = false;
  move = { ready: () => true, to: camX, lift: LOBBY_LIFT * 1.7, tilt: 1, len: 2.8, done: () => {
    const centred = STATIONS[station] + EASEL.dx;
    camX = targetX = centred; placeCamera();
    doodle.reset(); wordOnEasel(easels[station]);
    move = { ready: () => true, to: centred, lift: 0, tilt: 0, len: 3.0, done: () => {
      const t0 = nowS();
      move = { ready: () => nowS() - t0 > 1, to: STATIONS[station], len: 1.6, done };
    } };
  } };
}
/** a turn starts here: a clean paper, no word yet, the menu (wiped) and the players come in, the drawer's easel sinks */
let drawingSeat = 0; // whose turn it is: the ink on the easel is theirs
function beginTurn(drawerSeat) {
  drawingSeat = drawerSeat;
  doodle.reset(); wordOnEasel(easels[station]); chat.clear(); timer.hold();
  menuDrop.up = false;
  startTurn(PLAYERS[drawerSeat]);
}
/** the turn is over: the drawer's easel comes back, the boards go up, the camera glides halfway to the next easel and the
 *  scoreboard comes down */
function toScoreboard(title, done) {
  const back = nowS() + endTurn();
  move = { ready: () => { if (nowS() < back) return false; menuDrop.up = true; return menuDrop.y > menuDrop.rest + 1.2; },
    to: (STATIONS[station] + STATIONS[(station + 1) % STATIONS.length]) / 2, done: () => {
      bigDrop.show = true; startScoreboard(title); done && done();
    } };
}
/** on to the next easel: the scoreboard goes up, the camera glides on, the drawing moves to the new easel's paper */
function toNextEasel(done) {
  const next = (station + 1) % STATIONS.length;
  bigDrop.show = false; bigAnim.t0 = null;
  move = { ready: () => bigDrop.y > bigDrop.rest + 0.9, to: STATIONS[next], done: () => {
    const ink = easels[station].userData.paper.material;
    easels[station].userData.paper.material = easels[next].userData.paper.material;
    easels[next].userData.paper.material = ink;
    station = next;
    done && done();
  } };
}
/** after the game: the scoreboard goes up, up into the sky, across, and down onto the lobby again */
function toLobby(done) {
  bigDrop.show = false; bigAnim.t0 = null; menuDrop.up = true;
  move = { ready: () => bigDrop.y > bigDrop.rest + 0.9, to: camX, lift: LOBBY_LIFT * 1.7, tilt: 1, len: 2.8, done: () => {
    camX = targetX = LOBBY_X; placeCamera();
    lobby.on = true;
    move = { ready: () => true, to: LOBBY_X, lift: 0, tilt: 0, len: 3.6, done };
  } };
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function stepMove(dt) {
  if (!move) return;
  if (move.t === undefined) {
    if (!move.ready()) return;
    Object.assign(move, { from: camX, liftFrom: camLift, tiltFrom: camTilt, t: 0, len: move.len ?? 1.4 + Math.abs(move.to - camX) * 0.025 });
    held.clear(); drag = null;
  }
  move.t = Math.min(1, move.t + dt / move.len);
  camX = targetX = move.from + (move.to - move.from) * ease(move.t);
  if (move.lift !== undefined) camLift = move.liftFrom + (move.lift - move.liftFrom) * ease(move.t);
  if (move.tilt !== undefined) camTilt = move.tiltFrom + (move.tilt - move.tiltFrom) * ease(move.t);
  placeCamera();
  if (move.t < 1) return;
  const done = move.done;
  move = null;
  done(); // it may start the next move
}

const held = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'h' && !e.repeat && !e.ctrlKey && !e.metaKey) { picker.toggle(); return; } // dev: pick a part
  if (k === 'z' && !e.repeat && !e.ctrlKey && !e.metaKey) { perf.save(); return; } // dev: save the performance log
  if (!['arrowleft', 'arrowright'].includes(k)) return; // dev: slide along the street
  e.preventDefault();
  if (!e.repeat) targetX = clampX(targetX + (k === 'arrowright' ? 1 : -1) * 1.5); // a tap still nudges
  held.add(k);
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

let drag = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, from: targetX }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => { if (drag && !lobby.on) targetX = clampX(drag.from - (e.clientX - drag.x) * (14 / window.innerWidth)); });
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  targetX = clampX(targetX + d * 0.015);
}, { passive: false });

if (FULLCHAT) { PLAYERS[0].name = 'Ana'; chat.draw(); }
window.__m = { PARTS, sceneRT, renderer, scene, camera, composer, sun, LANE_X, GATE_X, view: (x, lift, tilt = 0) => { move = null; camX = targetX = x; camLift = lift; camTilt = tilt; placeCamera(); } }; // dev

scene.traverse((o) => { if (o.isLight) o.layers.enableAll(); });
const blit = new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null } }, vertexShader: QUAD_VERT, depthTest: false, depthWrite: false,
  fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }',
}));
wordOnEasel(easels[0]); // no word in the lobby
setWord('');
// the way in: a moment of sky, then down onto the easel
setTimeout(() => { move = { ready: () => true, to: LOBBY_X, lift: 0, len: 3.6, done: () => {} }; }, 900);
/* ---------- part picker (dev): H toggles it; the part under the cursor is outlined in blue and a click copies its id ---------- */
const picker = (() => {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  ray.layers.enable(0); ray.layers.enable(1);
  const outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#1e88ff', depthTest: false, depthWrite: false, toneMapped: false, transparent: true }));
  const fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#1e88ff', depthTest: false, depthWrite: false, toneMapped: false, transparent: true, opacity: 0.28, side: THREE.DoubleSide }));
  for (const o of [outline, fill]) { o.layers.set(1); o.renderOrder = 999; o.frustumCulled = false; o.visible = false; o.matrixAutoUpdate = false; scene.add(o); }
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;z-index:9;pointer-events:none;display:none;font:12px/1.3 monospace;color:#fff;background:#1e88ff;padding:3px 6px;white-space:pre';
  document.body.appendChild(tag);
  let on = false, hit = null, mx = 0, my = 0, pend = false, down = null;
  const visible = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  function pick() {
    pend = false;
    ndc.set((mx / window.innerWidth) * 2 - 1, -(my / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.isMesh && h.object !== fill && visible(h.object));
    const h = hits[0];
    const part = h && h.face && h.object.geometry.attributes.part ? h.object.geometry.attributes.part.getX(h.face.a) : 0;
    const key = h ? h.object.uuid + ':' + part : '';
    if (hit && hit.key === key) return;
    hit = h ? { key, part, mesh: h.object, point: h.point.clone(), instance: h.instanceId } : null;
    show();
  }
  function show() {
    outline.visible = fill.visible = false;
    if (hit && hit.part) {
      const geo = hit.mesh.geometry, pa = geo.attributes.part, pos = geo.attributes.position, idx = geo.index, tris = [];
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) { const a = idx ? idx.getX(i) : i; if (pa.getX(a) === hit.part) tris.push(a, idx ? idx.getX(i + 1) : i + 1, idx ? idx.getX(i + 2) : i + 2); }
      const pts = new Float32Array(tris.length * 3);
      tris.forEach((v, i) => { pts[i * 3] = pos.getX(v); pts[i * 3 + 1] = pos.getY(v); pts[i * 3 + 2] = pos.getZ(v); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const m = hit.mesh.matrixWorld.clone();
      if (hit.instance !== undefined && hit.mesh.isInstancedMesh) { const im = new THREE.Matrix4(); hit.mesh.getMatrixAt(hit.instance, im); m.multiply(im); }
      outline.geometry.dispose(); fill.geometry.dispose();
      outline.geometry = new THREE.EdgesGeometry(g, 15); fill.geometry = g;
      outline.matrix.copy(m); fill.matrix.copy(m);
      outline.visible = fill.visible = true;
    }
    if (hit) {
      const note = hit.part ? PARTS[hit.part] : null;
      tag.textContent = note ? 'part ' + note.id + ' ' + note.mat + '\n' + note.from.split(' < ')[0] : 'no part id (' + (hit.mesh.name || hit.mesh.geometry.type) + ')';
      tag.style.display = 'block';
    } else tag.style.display = 'none';
    dirty = true;
  }
  function describe() {
    const lines = [];
    if (!hit) return 'nothing under the cursor';
    const note = hit.part ? PARTS[hit.part] : null;
    if (note) lines.push('part ' + note.id, 'shape ' + note.shape + ', surface ' + note.mat + ', colour ' + note.hex, 'centre ' + note.at.join(', ') + ' (world), size ' + note.size.join(' x '), 'built at ' + note.from);
    else lines.push('no part id: ' + (hit.mesh.name || 'unnamed') + ' (' + hit.mesh.geometry.type + ', not built from the shared piece builder)');
    lines.push('hit point ' + hit.point.toArray().map((n) => n.toFixed(2)).join(', '), 'camera x ' + camX.toFixed(2) + ', y ' + camera.position.y.toFixed(2), 'layer ' + (hit.mesh.layers.isEnabled(1) ? 1 : 0) + ', mesh ' + (hit.mesh.material && hit.mesh.material.type));
    return lines.join('\n');
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); } catch {
      const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
  }
  window.addEventListener('pointermove', (e) => {
    if (!on) return;
    mx = e.clientX; my = e.clientY;
    tag.style.left = mx + 14 + 'px'; tag.style.top = my + 14 + 'px';
    if (!pend) { pend = true; requestAnimationFrame(pick); }
  });
  window.addEventListener('pointerdown', (e) => { if (on) down = { x: e.clientX, y: e.clientY }; }, true);
  window.addEventListener('pointerup', (e) => { // a click (not a drag) copies the part
    if (!on || !down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 5) return;
    mx = e.clientX; my = e.clientY; pick();
    const text = describe(); copy(text); console.log('[picker]\n' + text);
    tag.textContent += '\ncopied'; tag.style.background = '#0a5fc4';
    setTimeout(() => { tag.style.background = '#1e88ff'; }, 400);
  });
  return {
    toggle() {
      on = !on; hit = null; outline.visible = fill.visible = false; tag.style.display = 'none'; dirty = true;
      canvas.style.cursor = on ? 'crosshair' : '';
    },
  };
})();

/* ---------- performance log: one row per frame, kept in memory (Z saves it as a .log file: a header, then one JSON row per line) ---------- */
const perf = (() => {
  const MAX = 30000, rows = [], events = [];
  const gl = renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const meta = () => ({
    when: new Date().toISOString(), page: location.href, ua: navigator.userAgent,
    gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown', gpuVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : 'unknown',
    cores: navigator.hardwareConcurrency, memGB: navigator.deviceMemory, dpr: window.devicePixelRatio, STREET,
    window: [window.innerWidth, window.innerHeight], canvas: [renderer.domElement.width, renderer.domElement.height],
    streetTarget: [sceneRT.width, sceneRT.height], msaaSamples: sceneRT.samples, shadowMap: sun.shadow.mapSize.toArray(),
    gpuTimer: !!ext, rows: rows.length, events: events.length,
  });
  let q = null, last = performance.now(), frame = 0;
  renderer.info.autoReset = false;
  return {
    on: true,
    /** call at the top of every frame; returns the gap since the previous frame */
    begin() {
      const now = performance.now(), gap = now - last; last = now; frame++;
      renderer.info.reset();
      if (ext) { // collect finished GPU timings from earlier frames
        while (pending.length) {
          const p = pending[0];
          if (gl.getParameter(ext.GPU_DISJOINT_EXT) || !gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) { if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { pending.shift(); continue; } break; }
          p.row.gpuMs = +(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6).toFixed(3);
          pending.shift();
        }
      }
      return { now, gap, frame };
    },
    gpuStart() { if (ext && !q && pending.length < 8) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } },
    gpuEnd(row) { if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, row }); q = null; } },
    push(row) { rows.push(row); if (rows.length > MAX) rows.shift(); },
    event(name, data) { events.push({ t: +performance.now().toFixed(1), name, ...data }); if (events.length > 5000) events.shift(); },
    save() {
      const sum = (key) => { const v = rows.map((r) => r[key]).filter((x) => typeof x === 'number').sort((a, b) => a - b); return v.length ? { avg: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), p50: v[v.length >> 1], p95: v[Math.floor(v.length * 0.95)], p99: v[Math.floor(v.length * 0.99)], max: v[v.length - 1] } : null; };
      const keys = ['gapMs', 'frameMs', 'logicMs', 'streetMs', 'blitMs', 'overlayMs', 'gpuMs', 'calls', 'tris'];
      const summary = Object.fromEntries(keys.map((k) => [k, sum(k)]));
      const moving = rows.filter((r) => r.moving);
      const text = ['# articulate-3d market performance log', '# meta ' + JSON.stringify(meta()), '# summary(all) ' + JSON.stringify(summary),
        '# moving frames ' + moving.length + ' of ' + rows.length + '; frames over 33ms: ' + rows.filter((r) => r.gapMs > 33).length + '; over 50ms: ' + rows.filter((r) => r.gapMs > 50).length,
        '# events', ...events.map((e) => 'E ' + JSON.stringify(e)), '# frames', ...rows.map((r) => JSON.stringify(r))].join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.download = 'market-perf-' + new Date().toISOString().replace(/[:.]/g, '-') + '.log';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    clear() { rows.length = 0; events.length = 0; },
  };
})();
window.addEventListener('resize', () => perf.event('resize', { w: window.innerWidth, h: window.innerHeight }));
document.addEventListener('visibilitychange', () => perf.event('visibility', { hidden: document.hidden }));

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const pf = perf.begin(), t0 = pf.now;
  const dt = Math.min(0.05, clock.getDelta());
  const dir = (held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0);
  if (dir && !move && !lobby.on) targetX = clampX(targetX + dir * 7 * dt);
  stepMove(dt);
  windAt(camLift / LOBBY_LIFT);
  if (Math.abs(targetX - camX) > 1e-4) {
    camX += (targetX - camX) * (1 - Math.exp(-dt * (drag ? 30 : 8)));
    if (Math.abs(targetX - camX) < 1e-3) camX = targetX;
    placeCamera();
  }
  if (stepClouds(dt)) { dirty = true; streetStale = true; }
  if (doodle.step(dt)) dirty = true;
  stepPortraits(dt);
  if (stepMenu(dt)) dirty = true;
  if (stepLobbySigns(dt)) dirty = true;
  if (timer.step()) dirty = true;
  if (stepWord()) dirty = true;
  stepRoster(dt);
  if (stepBig(dt)) dirty = true;
  if (stepScoreboard(dt)) dirty = true;
  const tLogic = performance.now();
  if (!dirty) { if (pf.gap > 40) perf.event('idle-gap', { gapMs: +pf.gap.toFixed(1) }); return; } // nothing moves: draw nothing
  dirty = false;
  const row = { t: +t0.toFixed(1), f: pf.frame, gapMs: +pf.gap.toFixed(2), logicMs: +(tLogic - t0).toFixed(2), moving: Math.abs(targetX - camX) > 1e-3 || !!move || !!drag || (held.size > 0), camX: +camX.toFixed(3), camY: +camera.position.y.toFixed(2), blur: +blurPass.uniforms.amount.value.toFixed(2), blurOn: blurPass.enabled, street: streetStale, shadowRedraw: renderer.shadowMap.needsUpdate };
  perf.gpuStart();
  const tStreet = performance.now();
  if (streetStale) { // the street (layer 0) with all its finishing passes, only when the camera has moved
    streetStale = false;
    camera.layers.set(0);
    composer.render();
  }
  const tBlit = performance.now();
  // then the cached street on screen, and the paper and menu (layer 1) drawn straight over it
  renderer.setRenderTarget(null);
  blit.material.uniforms.tDiffuse.value = composer.readBuffer.texture;
  blit.render(renderer);
  const tOver = performance.now();
  renderer.autoClear = false;
  renderer.clearDepth();
  camera.layers.set(FULLCHAT ? 2 : 1);
  renderer.render(scene, camera);
  renderer.autoClear = true;
  const tEnd = performance.now();
  perf.gpuEnd(row);
  Object.assign(row, { streetMs: +(tBlit - tStreet).toFixed(2), blitMs: +(tOver - tBlit).toFixed(2), overlayMs: +(tEnd - tOver).toFixed(2), frameMs: +(tEnd - t0).toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null });
  perf.push(row);
  if (row.frameMs > 25) perf.event('slow-frame', { f: pf.frame, frameMs: row.frameMs, streetMs: row.streetMs, logicMs: row.logicMs, shadowRedraw: row.shadowRedraw, camX: row.camX });
});
startMusic();
// the game itself: players, turns, words, guesses and scores, driving all of the above
startGame({
  setRoomCode, seatJoin, seatLeave, seatDraw, seatPicture, seatVip, selfPortrait,
  flyToGame, beginTurn, toScoreboard, toNextEasel, toLobby,
  chooseWord: (text) => setWord(text), revealLetter,
  draw: (op) => { if (applyOp(doodle.board, op)) doodle.changed(); }, // the drawer picks their own colours, sizes and opacity
  drawing: () => doodle.board.ops,
  chat: (seat, text) => chat.say(seat === null ? '' : PLAYERS[seat].name, text),
  timer: (sec) => (sec ? timer.start(sec) : timer.hold()), drawTime: TIMER.round,
  seats: PLAYERS.length, colours: SEAT_COLOURS, setScore: (seat, score) => { PLAYERS[seat].score = score; }, portrait: (seat) => portraits[seat].board.ops,
});
console.log('market ready:', solid.length, 'pieces,', leafCards.length, 'leaves,', petalCards.length, 'petals');
