/**
 * Live 3D objects on top of the pre-rendered Blender village.
 *
 * The background is the Cycles render; the three.js camera, sun and sky light copy the Blender scene exactly
 * (from models/scene.json), so the easel sits in the picture with matching perspective and light. An invisible
 * "shadow catcher" floor shows only the easel's shadow on the rendered cobbles. Drag on the canvas to draw on it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const info = await (await fetch('models/scene.json')).json();
const [RW, RH] = info.render;
const ASPECT = RW / RH;

// Blender is Z-up, three.js is Y-up
const b2t = ([x, y, z]) => new THREE.Vector3(x, z, -y);

/* ---------- renderer: always the render's aspect ratio, letterboxed ---------- */

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;              // Blender used AgX
renderer.toneMappingExposure = 2 ** info.exposure;          // Blender exposure is in stops
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

function fit() {
  let w = window.innerWidth, h = w / ASPECT;
  if (h > window.innerHeight) { h = window.innerHeight; w = h * ASPECT; }
  renderer.setSize(w, h);
  Object.assign(renderer.domElement.style, { left: `${(window.innerWidth - w) / 2}px`, top: `${(window.innerHeight - h) / 2}px` });
}
fit();
window.addEventListener('resize', fit);

/* ---------- the same camera as Blender ---------- */

const c = info.camera;
const hfov = 2 * Math.atan((c.sensor_width_mm / 2) / c.lens_mm);       // sensor fit AUTO: the width, for a landscape render
const vfov = 2 * Math.atan(Math.tan(hfov / 2) / ASPECT);
const camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(vfov), ASPECT, 0.1, 500);
camera.position.copy(b2t(c.position));
camera.up.copy(b2t(c.up));
camera.lookAt(camera.position.clone().add(b2t(c.forward)));

/* ---------- scene: the render behind, the same sky and sun ---------- */

const scene = new THREE.Scene();
const bg = await new THREE.TextureLoader().loadAsync(encodeURI(info.background));
bg.colorSpace = THREE.SRGBColorSpace;
scene.background = bg; // an sRGB background is shown as it is (not tone mapped again)

const hdr = await new RGBELoader().loadAsync(`blender/textures/${info.sky.hdri}`);
hdr.mapping = THREE.EquirectangularReflectionMapping;
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(hdr).texture;
scene.environmentIntensity = info.sky.fill;
scene.environmentRotation.y = info.sky.rotation_z; // Blender turned the sky about Z (up); three's up is Y

const sun = new THREE.DirectionalLight(new THREE.Color(...info.sun.colour), info.sun.energy * 0.42);
sun.position.copy(b2t(info.sun.to_sun).multiplyScalar(30));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 80 });
sun.shadow.radius = 3;
sun.shadow.bias = -0.0005;
scene.add(sun);

/* ---------- shadow catcher: an invisible street that only shows shadows ---------- */

const catcher = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.6 }));
catcher.rotation.x = -Math.PI / 2;
catcher.receiveShadow = true;
scene.add(catcher);

/* ---------- the easel, standing on the cobbles ---------- */

const EASEL_AT = [2.2, 0.6, 0]; // Blender coordinates: on the street, just in front of the terrace wall
const gltf = await new GLTFLoader().loadAsync('models/easel.glb');
const easel = gltf.scene;
easel.position.copy(b2t(EASEL_AT));
easel.rotation.y = THREE.MathUtils.degToRad(18); // angled a little towards the café
let face = null;
easel.traverse((o) => {
  if (!o.isMesh) return;
  o.castShadow = true;
  o.receiveShadow = true;
  if (o.name === 'canvas_face') face = o;
});
scene.add(easel);
sun.target = easel;
sun.position.copy(easel.position).add(b2t(info.sun.to_sun).multiplyScalar(30));

/* ---------- a canvas you can draw on ---------- */

const paper = document.createElement('canvas');
paper.width = 768; paper.height = 1000;
const pen = paper.getContext('2d');
pen.fillStyle = '#e6e1d6'; pen.fillRect(0, 0, paper.width, paper.height);
const drawing = new THREE.CanvasTexture(paper);
drawing.colorSpace = THREE.SRGBColorSpace;
drawing.flipY = false; // glTF UVs
if (face) {
  face.material = new THREE.MeshStandardMaterial({ map: drawing, roughness: 0.9 });
}

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let last = null;
function uvAt(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = face && ray.intersectObject(face)[0];
  return hit ? hit.uv : null;
}
renderer.domElement.addEventListener('pointerdown', (e) => { last = uvAt(e); });
window.addEventListener('pointerup', () => { last = null; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!last) return;
  const uv = uvAt(e);
  if (!uv) return;
  pen.strokeStyle = '#2a3a8a'; pen.lineWidth = 14; pen.lineCap = 'round';
  pen.beginPath();
  pen.moveTo(last.x * paper.width, last.y * paper.height);
  pen.lineTo(uv.x * paper.width, uv.y * paper.height);
  pen.stroke();
  drawing.needsUpdate = true;
  last = uv.clone();
});

window.__c = { renderer, scene, camera, sun, easel, catcher }; // dev: poke at it from the console

renderer.setAnimationLoop(() => renderer.render(scene, camera));
const box = new THREE.Box3().setFromObject(easel);
console.log('easel ready', face ? 'with canvas face' : 'NO canvas face', box.min.toArray().map((v) => v.toFixed(2)), box.max.toArray().map((v) => v.toFixed(2)));
