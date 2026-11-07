/**
 * The Blender village street (blender/village.py, look '5c late afternoon') rebuilt in three.js as a flat front view.
 *
 * Every piece is the same size and in the same place as in the .blend, in Blender's own Z-up coordinates, so the
 * sun throws the same shadows. The camera is orthographic and square-on: facades are flat elevations and nothing
 * converges. Only depth lifts things a little, the way the street looks from a camera standing on it, so the
 * cobbles, the terrace and the café tables still show. Pan with the arrow keys / A D, by dragging, or by scrolling.
 */
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------- the look: '5c late afternoon' from blender/looks.py ---------- */

const LOOK = {
  hdri: 'kloofendal_48d_partly_cloudy_puresky_2k.hdr',
  skyRotation: 0.3024716,              // the world's mapping rotation about Z
  fill: 0.5,                           // how much the sky lights the scene
  toSun: [-0.7424, -0.5198, 0.4226],   // Blender: azimuth -55°, elevation 25°
  sunEnergy: 7.5,
  sunColour: [1, 0.78, 0.55],
  exposure: 0.45,
};

// The Blender camera stood here; the ground is opened up as it would have seen it
const EYE = { y: -15.5, height: 3.4, houses: 20 };

// What the view shows: everything from the lamp post's foot to the chimney tops, and how far it can pan
const VIEW = { bottom: -2.75, top: 14.6, minX: -14, maxX: 26, startX: 4.5 }; // x: the terrace wall's two ends

// Blender rendered with AgX and the 'Punchy' look (power 1.35, saturation 1.4); three's AgX leaves the look out
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace('color = agxDefaultContrastApprox( color );', `
	color = agxDefaultContrastApprox( color );
	float agxLuma = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
	color = pow( color, vec3( 1.35 ) );
	color = agxLuma + 1.4 * ( color - agxLuma );`);

/* ---------- renderer, scene, camera ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping; // Blender used AgX
renderer.toneMappingExposure = 2 ** LOOK.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // nothing moves: the shadows are drawn once
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
camera.position.set(VIEW.startX, 0, 200);

// The whole village is built in Blender coordinates (Z up); this turns it into three.js's Y up
const world = new THREE.Group();
world.rotation.x = -Math.PI / 2;
scene.add(world);

/* ---------- opening up the ground: lift each point by how far back it is ---------- */

const SKEW = { camZ: { value: camera.position.z } };
const SKEW_GLSL = `
  // depth in Blender metres from where the camera stood; points further back are lifted as a street-level camera sees them
  float skewDepth = ${(-EYE.y).toFixed(2)} - (mvPosition.z + skewCamZ);
  mvPosition.y += ${EYE.height.toFixed(2)} * (1.0 - ${EYE.houses.toFixed(1)} / max(skewDepth, 6.0));
  gl_Position = projectionMatrix * mvPosition;`;

/** Every material goes through this: the lift, and Blender's 'paint over the wood' overlay when a material has one */
function prepare(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.skewCamZ = SKEW.camZ;
    shader.uniforms.paintColour = { value: material.userData.paint || new THREE.Color(1, 1, 1) };
    shader.vertexShader = 'uniform float skewCamZ;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${SKEW_GLSL}`);
    shader.fragmentShader = 'uniform vec3 paintColour;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
      #if defined( USE_MAP ) && defined( PAINTED )
        // Blender's Mix node, Overlay, factor 0.35: a flat paint colour with the grain showing through
        vec3 grain = texture2D( map, vMapUv ).rgb, paint = paintColour;
        vec3 lo = paint * ( 0.65 + 0.7 * grain );
        vec3 hi = 1.0 - ( 0.65 + 0.7 * ( 1.0 - grain ) ) * ( 1.0 - paint );
        diffuseColor.rgb *= mix( lo, hi, step( 0.5, paint ) );
      #else
        #include <map_fragment>
      #endif`);
  };
  if (material.userData.paint) material.defines = { ...material.defines, PAINTED: '' };
  return material;
}

/* ---------- textures: the Poly Haven scans from blender/textures, shrunk (the view never needs 2K) ---------- */

const TEX = 'blender/textures/';

async function image(name, colour) {
  const blob = await (await fetch(`${TEX}${name}.jpg`)).blob();
  const bitmap = await createImageBitmap(blob, { resizeWidth: 1024, resizeHeight: 1024, resizeQuality: 'high', imageOrientation: 'flipY' });
  const t = new THREE.Texture(bitmap);
  t.flipY = false; // flipped while decoding instead
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.needsUpdate = true;
  return t;
}

const SCANS = ['castle_wall_varriation', 'cobblestone_floor_04', 'clay_roof_tiles_02', 'weathered_planks', 'concrete_floor_worn_001',
  'distressed_painted_planks', 'metal_plate', 'clay_plaster', 'bark_brown_02', 'painted_plaster_wall', 'wood_shutter'];
const scans = {};
const hdrLoad = new RGBELoader().loadAsync(`${TEX}${LOOK.hdri}`);
await Promise.all(SCANS.map(async (name) => {
  const [map, normalMap] = await Promise.all([image(`${name}_diff`, true), image(`${name}_nor`, false)]);
  scans[name] = { map, normalMap };
}));
const hdr = await hdrLoad;

/* ---------- materials, as in village.py ---------- */

const linear = (hex) => new THREE.Color(hex); // '#rrggbb' is sRGB; three keeps colours linear, like Blender's srgb()

/** A scanned material, box-projected at `scale` repeats per metre; tint multiplies the colour, paint overlays it */
function pbr(tex, scale, { tint = null, paint = null, bump = 0.4, rough = 0.85 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    ...scans[tex], roughness: rough, metalness: 0,
    normalScale: new THREE.Vector2(1 + bump, 1 + bump),
    color: tint ? (tint.isColor ? tint : new THREE.Color(...tint)) : 0xffffff,
  });
  m.userData.scale = scale;
  if (paint) m.userData.paint = paint;
  return prepare(m);
}

function flat(hex, rough = 0.7, metal = 0) {
  const m = new THREE.MeshStandardMaterial({ color: linear(hex), roughness: rough, metalness: metal });
  m.userData.scale = 1;
  return prepare(m);
}

const M = {
  stone: pbr('castle_wall_varriation', 0.45, { bump: 0.6, rough: 0.9 }),
  cobble: pbr('cobblestone_floor_04', 0.5, { bump: 0.9, rough: 0.85 }),
  tile: pbr('clay_roof_tiles_02', 0.55, { bump: 0.6, rough: 0.7 }),
  wood: pbr('weathered_planks', 0.8, { bump: 0.4, rough: 0.8 }),
  step: pbr('concrete_floor_worn_001', 0.8, { bump: 0.3, rough: 0.9 }),
  paving: pbr('concrete_floor_worn_001', 0.4, { bump: 0.4, rough: 0.9 }),
  joint: flat('#4f463c', 1),
  frame: pbr('distressed_painted_planks', 1.2, { paint: linear('#f1ebde'), bump: 0.2, rough: 0.7 }),
  glassDark: flat('#1c232b', 0.08, 0.2),
  glassLit: flat('#3a2a1a', 0.3),
  iron: pbr('metal_plate', 1.5, { tint: [0.12, 0.12, 0.13], bump: 0.15, rough: 0.55 }),
  pot: pbr('clay_plaster', 1.2, { tint: linear('#d27a4e'), bump: 0.3, rough: 0.9 }),
  bark: pbr('bark_brown_02', 1.5, { bump: 0.6, rough: 0.95 }),
  red: pbr('distressed_painted_planks', 1.5, { paint: linear('#c8423a'), bump: 0.2, rough: 0.7 }),
  sign: flat('#1f3b33', 0.5),
  tableTop: flat('#f3ece0', 0.4),
  lantern: flat('#fff2c4', 0.3),
};
const plasterCache = new Map();
const plaster = (hex) => plasterCache.get(hex) || plasterCache.set(hex, pbr('painted_plaster_wall', 0.35, { tint: linear(hex), bump: 0.35, rough: 0.92 })).get(hex);
const shutterCache = new Map();
const shutterMat = (hex) => shutterCache.get(hex) || shutterCache.set(hex, pbr('wood_shutter', 1.4, { paint: linear(hex), bump: 0.3, rough: 0.7 })).get(hex);

/* ---------- geometry helpers: pieces are collected per material and merged at the end ---------- */

const pieces = new Map();
function add(material, geo, origin = null) {
  boxUV(geo, material.userData.scale ?? 1, origin);
  if (!pieces.has(material)) pieces.set(material, []);
  pieces.get(material).push(geo);
}

/** Blender's box projection: each face takes the texture from the axis it faces most */
function boxUV(geo, s, origin) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const [ox, oy, oz] = origin || [0, 0, 0];
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - ox, y = p.getY(i) - oy, z = p.getZ(i) - oz;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (az >= ax && az >= ay) { u = x; v = y; } else if (ay >= ax) { u = x; v = z; } else { u = y; v = z; }
    uv[i * 2] = u * s; uv[i * 2 + 1] = v * s;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** Blender's object transform: rotation XYZ (X first), then location */
function place(geo, loc, rot = [0, 0, 0]) {
  _e.set(rot[0], rot[1], rot[2], 'ZYX');
  _m.compose(new THREE.Vector3(...loc), _q.setFromEuler(_e), new THREE.Vector3(1, 1, 1));
  return geo.applyMatrix4(_m);
}

/** A box, like village.py's cube(): size and loc in Blender metres. Deep boxes get extra rows so the lift bends them smoothly. */
function cube(size, loc, material, rot = [0, 0, 0]) {
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2], 1, Math.max(1, Math.ceil(size[1] / 0.5)), 1);
  add(material, place(geo, loc, rot));
}

function cylinder(r, depth, loc, material, segments = 24, r2 = r) {
  const geo = new THREE.CylinderGeometry(r2, r, depth, segments, 1).rotateX(Math.PI / 2); // three's axis is Y, Blender's is Z
  add(material, place(geo, loc), loc);
}

/* ---------- random numbers, seeded so the street is the same every time ---------- */

const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const choice = (list) => list[Math.floor(rnd() * list.length)];

/* ---------- foliage: leaf cards scattered over ellipsoids (one instanced mesh for every leaf) ---------- */

const LEAF_RAMP = ['#4f7f2f', '#6c9a38', '#9ab04a', '#c69a3a'].map(linear);
const leafRamp = (t) => {
  const k = Math.min(LEAF_RAMP.length - 1.001, t * (LEAF_RAMP.length - 1));
  const i = Math.floor(k);
  return LEAF_RAMP[i].clone().lerp(LEAF_RAMP[i + 1], k - i);
};
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

const leaves = []; // { matrix, colour }
const Z_UP = new THREE.Vector3(0, 0, 1);
function leavesBlob(centre, radii, count, flowers = false) {
  const c = new THREE.Vector3(...centre);
  for (let i = 0; i < count; i++) {
    // points on and just inside the ellipsoid
    const u = rnd() * 2 * Math.PI, v = Math.acos(2 * rnd() - 1), k = 0.75 + rnd() * 0.25;
    const p = new THREE.Vector3(Math.sin(v) * Math.cos(u) * radii[0] * k, Math.sin(v) * Math.sin(u) * radii[1] * k, Math.cos(v) * radii[2] * k);
    // the leaf points outwards (its Z along the normal, its Y towards the sky), spun and tipped a little
    const n = p.clone().normalize();
    let up = Z_UP.clone().sub(n.clone().multiplyScalar(n.z));
    if (up.lengthSq() < 1e-6) up = new THREE.Vector3(0, 1, 0);
    up.normalize();
    const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, n), up, n);
    const s = 0.8 + rnd() * 0.7;
    const m = new THREE.Matrix4().makeTranslation(c.x + p.x, c.y + p.y, c.z + p.z)
      .multiply(basis)
      .multiply(new THREE.Matrix4().makeRotationZ(rnd() * 6.28))
      .multiply(new THREE.Matrix4().makeRotationX(rnd() * 1.2 - 0.6))
      .multiply(new THREE.Matrix4().makeScale(s, s, s));
    const w = c.clone().add(p);
    const tone = leafRamp(rnd() * (flowers ? 0.6 : 0.72));
    // Blender multiplied a soft noise wash over the ramp (factor 0.25)
    const wash = [0, 1, 2].map((ch) => 0.75 + 0.25 * vnoise(w.x * 3 + ch * 17, w.y * 3, w.z * 3));
    tone.setRGB(tone.r * wash[0], tone.g * wash[1], tone.b * wash[2]);
    leaves.push({ m, tone });
  }
  if (flowers) {
    const mat = flowerMats[choice(Object.keys(flowerMats))];
    for (let i = 0; i < 12; i++) {
      cube([0.06, 0.06, 0.06], [centre[0] + (rnd() - 0.5) * radii[0] * 1.8, centre[1] - radii[1] * 0.9, centre[2] + rnd() * radii[2]], mat);
    }
  }
}
const flowerMats = Object.fromEntries(['#e8546a', '#f2c94c', '#f4f0f0', '#d05ab0'].map((h) => [h, flat(h, 0.6)]));

/* ---------- the ground: cobbled street, the terrace wall and the terrace the houses stand on ---------- */

{
  // only the part of the street the view can reach, with enough rows for the lift to curve it
  const geo = new THREE.PlaneGeometry(60, 13, 1, 52);
  add(M.cobble, place(geo, [6, 0.5, 0]));
}
cube([40, 0.6, 1.2], [6, 1.8, 0.6], M.stone);                // terrace wall
cube([40, 4, 0.14], [6, 3.6, 1.27], M.paving);               // terrace top

/* ---------- houses ---------- */

const FLOOR = 2.3;
const BASE = 1.34;

function windowAt(x, z, houseY, shutter, { planter, balcony, lit }) {
  const y = houseY - 0.04;
  // the frame is four bars around the glass
  for (const [fx, fz, fw, fh] of [[0, 0.69, 1.0, 0.08], [0, -0.69, 1.0, 0.08], [-0.46, 0, 0.08, 1.45], [0.46, 0, 0.08, 1.45]]) {
    cube([fw, 0.16, fh], [x + fx, y, z + fz], M.frame);
  }
  cube([0.86, 0.03, 1.32], [x, y - 0.01, z], lit ? M.glassLit : M.glassDark);
  cube([0.05, 0.07, 1.32], [x, y - 0.05, z], M.frame);           // mullion
  cube([0.86, 0.07, 0.05], [x, y - 0.05, z + 0.18], M.frame);    // transom
  cube([1.2, 0.26, 0.08], [x, y - 0.1, z - 0.76], M.frame);      // sill
  for (const side of [-1, 1]) {
    cube([0.5, 0.06, 1.42], [x + side * 0.8, y - 0.14, z], shutter, [0, 0, side * 0.3]);
    for (let i = 0; i < 6; i++) cube([0.42, 0.04, 0.05], [x + side * 0.79, y - 0.19, z - 0.55 + i * 0.22], shutter, [0.5, 0, side * 0.3]);
  }
  if (planter) {
    cube([1.15, 0.3, 0.26], [x, y - 0.3, z - 0.92], M.pot);
    leavesBlob([x, y - 0.32, z - 0.72], [0.55, 0.16, 0.14], 220, true);
  }
  if (balcony) {
    cube([1.7, 0.6, 0.1], [x, y - 0.34, z - 0.8], M.frame);
    for (let i = 0; i < 9; i++) cube([0.025, 0.025, 0.5], [x - 0.8 + i * 0.2, y - 0.62, z - 0.5], M.iron);
    cube([1.7, 0.04, 0.04], [x, y - 0.62, z - 0.24], M.iron);
  }
}

/** A gable roof: a triangle (thickened like Blender's Solidify) running from the front of the house to the back */
function roof(x, width, zEave, houseY, depth) {
  const half = width / 2 + 0.3, pitch = THREE.MathUtils.degToRad(38), t = 0.12;
  const rise = half * Math.tan(pitch);
  const shape = new THREE.Shape();
  const out = t / Math.sin(pitch), up = t / Math.cos(pitch);
  shape.moveTo(-half - out * 0.6, 0); shape.lineTo(half + out * 0.6, 0); shape.lineTo(0, rise + up); shape.closePath();
  const len = depth + 0.6 + t;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: Math.ceil(len / 0.5) });
  geo.deleteAttribute('uv');
  // the shape lies in X/Y and extrudes along +Z: turn it so it stands in Blender's X/Z and runs back along +Y
  geo.rotateX(Math.PI / 2);
  geo.translate(x, houseY - 0.3 - t + len, zEave);
  geo.computeVertexNormals();
  add(M.tile, geo);
}

/** Letters on a sign: Blender's text object, drawn as a picture on a card */
function signText(text, x, y, zBaseline, size) {
  const px = 220, pad = 20;
  const font = `500 ${px}px "DejaVu Sans", "Bitstream Vera Sans", Verdana, sans-serif`;
  const g0 = document.createElement('canvas').getContext('2d');
  g0.font = font;
  const mt = g0.measureText(text);
  const w = Math.ceil(mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight) + pad * 2;
  const h = Math.ceil(mt.actualBoundingBoxAscent + mt.actualBoundingBoxDescent) + pad * 2;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.font = font; g.fillStyle = '#f1e3c2'; g.textBaseline = 'alphabetic';
  g.fillText(text, pad + mt.actualBoundingBoxLeft, pad + mt.actualBoundingBoxAscent);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const k = size / px; // metres per canvas pixel: Blender's text size is the em
  const mat = prepare(new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.4 }));
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * k, h * k).rotateX(Math.PI / 2), mat); // facing -Y, the street
  // centred on its advance width like align_x CENTER, with the baseline at zBaseline
  const originX = pad + mt.actualBoundingBoxLeft, baselineY = pad + mt.actualBoundingBoxAscent; // in canvas pixels
  plane.position.set(x - (mt.width * k) / 2 + (w / 2 - originX) * k, y, zBaseline - (h / 2 - baselineY) * k);
  plane.receiveShadow = true;
  world.add(plane);
}

function stripes(hex) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = hex; g.fillRect(0, 0, 32, 4);
  g.fillStyle = '#f4efe4'; g.fillRect(32, 0, 32, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 8;
  const m = prepare(new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
  m.userData.scale = 1;
  return m;
}

function house(x0, width, floors, houseY, facadeHex, shutterHex, { sign = null, awning = null, planters = [], balconies = [], lit = [] } = {}) {
  const x = x0 + width / 2;
  const depth = 5;
  const facade = plaster(facadeHex);
  const shutter = shutterMat(shutterHex);
  const height = floors * FLOOR + 0.5;
  cube([width, 0.04, 2.1], [x, houseY - 0.01, BASE + 1.05], M.stone);                 // stone facing on the ground floor
  cube([width, depth, height], [x, houseY + depth / 2, BASE + height / 2], facade);   // the house
  cube([width + 0.3, 0.4, 0.2], [x, houseY - 0.05, BASE + height], M.frame);          // cornice
  roof(x, width, BASE + height + 0.1, houseY, depth);
  cube([0.6, 0.6, 1.6], [x + width * 0.25, houseY + 2, BASE + height + width * 0.32], facade); // chimney
  const cols = Math.max(1, Math.round(width / 2.2));
  for (let f = 0; f < floors; f++) {
    for (let c = 0; c < cols; c++) {
      const wx = x - width / 2 + (c + 0.5) * (width / cols);
      const wz = BASE + 1.35 + f * FLOOR;
      if (f === 0 && c === Math.floor(cols / 2)) {
        // a wooden door with plank lines, a stone step and two iron rings
        cube([1.1, 0.18, 2.05], [wx, houseY - 0.14, BASE + 1.02], M.wood);
        for (let k = 0; k < 4; k++) cube([0.02, 0.02, 1.9], [wx - 0.41 + k * 0.27, houseY - 0.24, BASE + 1.02], M.joint);
        cube([1.5, 0.5, 0.14], [wx, houseY - 0.4, BASE + 0.07], M.step);
        for (const s of [-1, 1]) {
          const ring = new THREE.TorusGeometry(0.07, 0.012, 8, 24);
          add(M.iron, place(ring, [wx + s * 0.18, houseY - 0.25, BASE + 1.05], [Math.PI / 2, 0, 0]));
        }
        continue;
      }
      const key = `${c}:${f}`;
      windowAt(wx, wz, houseY, shutter, { planter: planters.includes(key), balcony: balconies.includes(key), lit: lit.includes(key) });
    }
  }
  if (awning) {
    // slopes down and out from the wall above the shop window; stripes 0.196 m apart, like Blender's wave texture
    const m = stripes(awning);
    const geo = place(new THREE.BoxGeometry(width - 0.5, 1.25, 0.03, 1, 3, 1), [0, 0, 0], [THREE.MathUtils.degToRad(24), 0, 0]);
    const P = (2 * Math.PI) / (20 * 1.6);
    const uv = new Float32Array(geo.attributes.position.count * 2);
    for (let i = 0; i < geo.attributes.position.count; i++) uv[i * 2] = geo.attributes.position.getX(i) / P;
    geo.translate(x, houseY - 0.62, BASE + 2.62);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (!pieces.has(m)) pieces.set(m, []);
    pieces.get(m).push(geo);
  }
  if (sign) {
    cube([Math.min(width - 0.6, 3.2), 0.08, 0.55], [x, houseY - 0.32, BASE + 3.15], M.sign);
    signText(sign, x, houseY - 0.375, BASE + 3.03, 0.34);
  }
}

// The street, exactly as the .blend has it (village.py's random choices, read back from the file)
house(-9.0, 4.6, 3, 5.3, '#f4c7b3', '#9a4a3a', { planters: ['0:1', '1:1'], balconies: ['0:2'], lit: ['0:2'] });
house(-4.4, 5.2, 4, 4.7, '#c9dceb', '#3f7d8c', { awning: '#c8423a', sign: 'Boulangerie', balconies: ['0:2'], lit: ['0:0', '1:2'] });
house(0.8, 4.2, 3, 4.2, '#d9e4c8', '#3b5f9a', { planters: ['0:1', '1:1'], balconies: ['1:2'], lit: ['0:0'] });
house(5.0, 5.6, 4, 4.5, '#d9e4c8', '#2f6b5e', { awning: '#2f6f8f', sign: 'Café du Port', balconies: ['2:2'], lit: ['0:1', '0:2', '1:3'] });
house(10.6, 4.4, 3, 5.3, '#f2d6a2', '#2f6b5e', { planters: ['0:1', '1:1'], balconies: ['1:2'], lit: ['0:1', '1:1'] });
house(15.0, 5.0, 4, 5.0, '#f4c7b3', '#2f6b5e', { awning: '#4f8a3a', sign: 'Fleurs', balconies: ['0:2'], lit: ['0:1'] });
house(20.0, 4.6, 3, 4.2, '#efd2d9', '#2f6b5e', { planters: ['0:1', '1:1'], balconies: ['1:2'], lit: ['0:2'] });

/* ---------- trees ---------- */

/** A trunk or branch: a tube along a smooth curve, tapering from r0 to r1 */
function limb(points, r0, r1) {
  const curve = new THREE.CatmullRomCurve3(points.map((q) => new THREE.Vector3(...q)), false, 'centripetal');
  const SEG = 24, RING = 10;
  const geo = new THREE.TubeGeometry(curve, SEG, 1, RING, false);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const s = Math.floor(i / (RING + 1)) / SEG;
    const centre = curve.getPointAt(Math.min(1, s));
    v.fromBufferAttribute(p, i).sub(centre).multiplyScalar(r0 + (r1 - r0) * s).add(centre);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  add(M.bark, geo);
}

function tree(x, y, s = 1) {
  const at = (p) => [x + p[0] * s, y + p[1] * s, p[2] * s + BASE];
  limb([[0, 0, 0], [0.15, 0, 1.5], [-0.1, 0.1, 3], [0, 0, 4]].map(at), 0.42 * s, 0.2 * s);
  for (const b of [[[0, 0, 3], [-1, 0.3, 4], [-1.9, 0.4, 4.9]], [[0, 0, 3.3], [1.1, -0.2, 4.3], [2, -0.3, 5]],
    [[0, 0, 3.8], [0.2, -0.9, 5], [0.3, -1.3, 5.8]], [[0, 0, 3.8], [-0.3, 0.9, 5.1], [-0.4, 1.2, 6]]]) {
    limb(b.map(at), 0.16 * s, 0.05 * s);
  }
  for (const [cx, cy, cz, r] of [[-1.9, 0.4, 5.1, 1.5], [2, -0.3, 5.2, 1.5], [0.3, -1.3, 6, 1.4], [-0.4, 1.2, 6.2, 1.4], [0, 0, 6.9, 1.7],
    [-1.1, -0.9, 6.3, 1.1], [1.2, -0.8, 6.4, 1.1], [1, 1.4, 5.6, 1.1], [-1.4, 1.2, 5.6, 1.0], [0.4, -0.5, 7.6, 1.0]]) {
    leavesBlob([x + cx * s, y + cy * s, BASE + cz * s], [r * s, r * s * 0.9, r * s * 0.85], Math.floor(900 * r * r));
  }
}

tree(-11.5, 3.2, 1.0);
tree(9.5, 2.9, 0.85); // a shade tree in front of the houses, throwing dappled shadows across them
for (const px of [-3.5, 6.5, 14.5]) {
  cylinder(0.42, 0.7, [px, 2.6, 1.69], M.pot);
  leavesBlob([px, 2.6, 2.4], [0.6, 0.6, 0.55], 700);
}

/* ---------- lamp post, café tables and red chairs ---------- */

cylinder(0.08, 4.2, [-1.5, -2.5, 2.1], M.iron, 16);
cube([0.35, 0.35, 0.5], [-1.5, -2.5, 4.4], M.lantern);

for (const tx of [5.0, 7.6]) {
  cylinder(0.45, 0.05, [tx, -1.6, 0.78], M.tableTop, 32);
  cylinder(0.04, 0.76, [tx, -1.6, 0.4], M.iron, 12);
  for (const side of [-1, 1]) {
    const cx = tx + side * 0.75;
    cube([0.48, 0.48, 0.05], [cx, -1.6, 0.48], M.red);
    cube([0.05, 0.48, 0.55], [cx + side * 0.22, -1.6, 0.78], M.red);
    for (const [lx, ly] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) cube([0.04, 0.04, 0.48], [cx + lx, -1.6 + ly, 0.24], M.red);
  }
}

/* ---------- merge: one mesh per material, plus one instanced mesh for every leaf ---------- */

for (const [material, geos] of pieces) {
  const clean = geos.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
    return n;
  });
  const mesh = new THREE.Mesh(mergeGeometries(clean), material);
  mesh.castShadow = mesh.receiveShadow = true;
  world.add(mesh);
}

{
  const shape = [[0, 0], [0.05, 0.05], [0.03, 0.12], [0, 0.16], [-0.03, 0.12], [-0.05, 0.05]];
  const pos = [];
  for (let i = 1; i < shape.length - 1; i++) for (const k of [0, i, i + 1]) pos.push(shape[k][0], 0, shape[k][1]); // in X/Z, like Blender's leaf
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const mat = prepare(new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }));
  const mesh = new THREE.InstancedMesh(geo, mat, leaves.length);
  leaves.forEach(({ m, tone }, i) => { mesh.setMatrixAt(i, m); mesh.setColorAt(i, tone); });
  mesh.castShadow = mesh.receiveShadow = true;
  world.add(mesh);
}

/* ---------- light: the sky photo fills the shade, a low warm sun rakes across from the left ---------- */

const b2t = ([x, y, z]) => new THREE.Vector3(x, z, -y);

hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(hdr).texture;
scene.environmentIntensity = LOOK.fill;
scene.environmentRotation.y = LOOK.skyRotation; // Blender turned the sky about Z (up); three's up is Y

const sun = new THREE.DirectionalLight(new THREE.Color(...LOOK.sunColour), LOOK.sunEnergy);
const SUN_DIR = b2t(LOOK.toSun).normalize();
sun.target.position.set(6, 5, -3);
sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 80);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.015;
sun.shadow.radius = 2;
scene.add(sun, sun.target);
{
  // fit the shadow camera tightly around the part of the street the view can reach
  sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
  sun.shadow.camera.position.copy(sun.position);
  sun.shadow.camera.lookAt(sun.target.position);
  sun.shadow.camera.updateMatrixWorld();
  const inv = sun.shadow.camera.matrixWorldInverse;
  const box = new THREE.Box3();
  for (const x of [VIEW.minX, VIEW.maxX]) for (const y of [-0.5, 15]) for (const z of [-11.5, 6.5]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
  Object.assign(sun.shadow.camera, { left: box.min.x, right: box.max.x, bottom: box.min.y, top: box.max.y, near: -box.max.z - 5, far: -box.min.z + 5 });
  sun.shadow.camera.updateProjectionMatrix();
}
renderer.shadowMap.needsUpdate = true;

/* ---------- the sky: the same photo, seen from where the Blender camera stood ---------- */

hdr.wrapS = THREE.RepeatWrapping;
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { hdr: { value: hdr }, view: { value: new THREE.Vector4() }, camX: { value: 0 }, rotation: { value: LOOK.skyRotation } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D hdr; uniform vec4 view; uniform float camX, rotation; varying vec2 vUv;
    void main(){
      // a point on the screen, in metres on the house fronts, seen from the camera's spot on the street
      float x = mix(view.x, view.y, vUv.x), y = mix(view.z, view.w, vUv.y);
      vec3 d = normalize(vec3(x, ${EYE.houses.toFixed(1)}, y - ${EYE.height.toFixed(2)}));
      float r = rotation + camX * 0.004; // the sky drifts a touch as you pan, as if very far away
      d.xy = vec2(d.x * cos(r) - d.y * sin(r), d.x * sin(r) + d.y * cos(r));
      vec2 uv = vec2(-atan(d.y, d.x) / 6.2831853 + 0.5, atan(d.z, length(d.xy)) / 3.1415927 + 0.5);
      gl_FragColor = vec4(texture2D(hdr, uv).rgb, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

/* ---------- the camera: a fixed height, panned left and right ---------- */

let viewW = 1;
function fit() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const viewH = VIEW.top - VIEW.bottom;
  viewW = viewH * (w / h);
  camera.left = -viewW / 2; camera.right = viewW / 2;
  camera.top = viewH / 2; camera.bottom = -viewH / 2;
  camera.position.y = (VIEW.top + VIEW.bottom) / 2;
  camera.updateProjectionMatrix();
  dirty = true;
}
let dirty = true;
let camX = VIEW.startX, targetX = VIEW.startX;
const clampX = (x) => {
  const lo = VIEW.minX + viewW / 2, hi = VIEW.maxX - viewW / 2;
  return lo > hi ? (VIEW.minX + VIEW.maxX) / 2 : Math.min(hi, Math.max(lo, x));
};
fit();
window.addEventListener('resize', fit);

const held = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (!['arrowleft', 'arrowright', 'a', 'd'].includes(k)) return;
  e.preventDefault();
  if (!e.repeat) targetX = clampX(targetX + (k === 'arrowright' || k === 'd' ? 1 : -1) * viewW * 0.06); // a tap still nudges
  held.add(k);
});
window.addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => held.clear());

let drag = null;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, from: targetX }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  targetX = clampX(drag.from - (e.clientX - drag.x) * (viewW / window.innerWidth));
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  targetX = clampX(targetX + d * (viewW / window.innerWidth));
}, { passive: false });

window.__s = { renderer, scene, camera, sun, world, pan: (x) => { targetX = clampX(x); } }; // dev: poke at it from the console

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  const dir = (held.has('arrowright') || held.has('d') ? 1 : 0) - (held.has('arrowleft') || held.has('a') ? 1 : 0);
  if (dir) targetX = clampX(targetX + dir * viewW * 0.6 * dt);
  targetX = clampX(targetX);
  const next = camX + (targetX - camX) * (1 - Math.exp(-dt * (drag ? 30 : 9)));
  if (Math.abs(next - camX) > 1e-5) { camX = next; dirty = true; }
  if (!dirty) return;
  dirty = false;
  camera.position.x = camX;
  sky.material.uniforms.view.value.set(camera.left, camera.right, camera.bottom + camera.position.y, camera.top + camera.position.y);
  sky.material.uniforms.camX.value = camX;
  renderer.render(scene, camera);
});
console.log('street ready:', pieces.size, 'materials,', leaves.length, 'leaves');
