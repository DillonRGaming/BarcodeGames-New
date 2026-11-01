/**
 * Main.js - Application Bootstrap, Texture Baker, Asset Preloader, and Engine Loop
 */

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const TOTAL_LETTERS = 8;
const assetCache = {};

/* =========================================
   Texture Baking Utilities (Canvas)
   ========================================= */

function bakeTexture(imgElement, filterString, padding = 16, maxDim = 260) {
  if (!imgElement || imgElement.naturalWidth === 0) {
    return imgElement ? imgElement.src : '';
  }
  try {
    const nw = imgElement.naturalWidth || 260;
    const nh = imgElement.naturalHeight || 260;
    let targetW, targetH;

    if (nw > nh) {
      targetW = maxDim;
      targetH = Math.round((nh / nw) * maxDim);
    } else {
      targetH = maxDim;
      targetW = Math.round((nw / nh) * maxDim);
    }

    const pad = padding;
    const canvas = document.createElement('canvas');
    canvas.width = targetW + pad * 2;
    canvas.height = targetH + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(imgElement, pad, pad, targetW, targetH);
    return canvas.toDataURL('image/png');
  } catch (err) {
    return imgElement.src;
  }
}

function bakeBlinkTexture(imgElement, filterString, padding = 16) {
  if (!imgElement || imgElement.naturalWidth === 0) {
    return imgElement ? imgElement.src : '';
  }
  try {
    const nw = imgElement.naturalWidth || 260;
    const nh = imgElement.naturalHeight || 260;
    const maxDim = 260;
    let targetW, targetH;

    if (nw > nh) {
      targetW = maxDim;
      targetH = Math.round((nh / nw) * maxDim);
    } else {
      targetH = maxDim;
      targetW = Math.round((nw / nh) * maxDim);
    }

    const pad = padding;
    const canvas = document.createElement('canvas');
    canvas.width = targetW + pad * 2;
    canvas.height = targetH + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.filter = filterString;
    ctx.drawImage(imgElement, pad, pad, targetW, targetH);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 100 && data[i] > 195 && data[i + 1] > 195 && data[i + 2] > 195) {
        data[i] = 18;
        data[i + 1] = 18;
        data[i + 2] = 22;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (err) {
    return imgElement.src;
  }
}

function bakeEyesTexture(imgElement) {
  if (!imgElement || imgElement.naturalWidth === 0) return '';
  try {
    const nw = imgElement.naturalWidth || 260;
    const nh = imgElement.naturalHeight || 260;
    const maxDim = 260;
    let targetW, targetH;
    if (nw > nh) {
      targetW = maxDim;
      targetH = Math.round((nh / nw) * maxDim);
    } else {
      targetH = maxDim;
      targetW = Math.round((nw / nh) * maxDim);
    }
    const pad = 16;
    const canvas = document.createElement('canvas');
    canvas.width = targetW + pad * 2;
    canvas.height = targetH + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgElement, pad, pad, targetW, targetH);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 100 && data[i] > 195 && data[i + 1] > 195 && data[i + 2] > 195) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
      } else {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (err) {
    return '';
  }
}

function getRandomLetters(count) {
  const shuffled = [...alphabet].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/* =========================================
   Application Initialization
   ========================================= */

async function init() {
  const gridEl = document.getElementById('letterGrid');
  const bgLayerEl = document.getElementById('bgLayer');
  const furnitureLayerEl = document.getElementById('furnitureLayer');
  const blackoutEl = document.getElementById('blackout');
  const lightingOverlayEl = document.getElementById('lightingOverlay');
  const gridContainerEl = document.querySelector('.grid-container');

  // 1. Initialize Room, Camera, and Sound Controller
  const room = new RoomManager({ bgLayerEl, furnitureLayerEl, blackoutEl, lightingOverlayEl });
  const camera = new Camera({ containerEl: gridContainerEl, gridEl });
  const sound = new SoundController();
  const manager = new GameManager({ room, camera, sound, gridEl, players: [] });

  // 2. Decode Active Lobby Characters & Core Assets for Instant Colored Textures
  const activeChars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const priorityDecodes = [];

  alphabet.forEach((char) => {
    const alive = new Image();
    alive.src = `assets/images/letters/${char}.png`;
    assetCache[`alive_${char}`] = alive;

    const dead = new Image();
    dead.src = `assets/images/letters-dead/${char}.png`;
    assetCache[`dead_${char}`] = dead;

    if (activeChars.includes(char)) {
      if (alive.decode) priorityDecodes.push(alive.decode().catch(() => { }));
      if (dead.decode) priorityDecodes.push(dead.decode().catch(() => { }));
    } else {
      if (alive.decode) alive.decode().catch(() => { });
      if (dead.decode) dead.decode().catch(() => { });
    }
  });

  ['assets/images/rooms/lobby.png', 'assets/images/web.png', 'assets/images/web-2.png'].forEach((src) => {
    const img = new Image();
    img.src = src;
    if (img.decode) priorityDecodes.push(img.decode().catch(() => { }));
  });

  // Preload and mount logo.svg into #introLogo container
  const introLogoEl = document.getElementById('introLogo');
  if (introLogoEl) {
    fetch('assets/images/logo.svg')
      .then((res) => res.text())
      .then((svgText) => {
        introLogoEl.innerHTML = svgText;
      })
      .catch(() => { });
  }

  // Fast await on the 8 tiny optimized images (~10ms) so colors bake with 100% precision
  await Promise.all(priorityDecodes);

  // 3. Instantiate Players with Single-Letter Alphabet Names & Themes
  const LOBBY_PROFILES = [
    { name: 'A', color: '#e06f97', filter: 'hue-rotate(330deg) saturate(1.1) brightness(1.1)', tilt: -6, isVip: false },
    { name: 'B', color: '#5e94c2', filter: 'hue-rotate(200deg) saturate(1.15) brightness(1.0)', tilt: 4, isVip: false },
    { name: 'C', color: '#7ab372', filter: 'hue-rotate(100deg) saturate(1.05) brightness(1.02)', tilt: -3, isVip: false },
    { name: 'D', color: '#c7595e', filter: 'hue-rotate(0deg) saturate(1.1) brightness(1.05)', tilt: 5, isVip: false },
    { name: 'E', color: '#9d7cbd', filter: 'hue-rotate(270deg) saturate(1.1) brightness(1.05)', tilt: -4, isVip: true },
    { name: 'F', color: '#d4cc6d', filter: 'hue-rotate(50deg) saturate(1.2) brightness(1.15)', tilt: 6, isVip: false },
    { name: 'G', color: '#c2c2c2', filter: 'saturate(0.08) brightness(1.25) contrast(1.1)', tilt: -5, isVip: false },
    { name: 'H', color: '#c4996b', filter: 'hue-rotate(25deg) saturate(0.95) brightness(1.0)', tilt: 4, isVip: false },
  ];

  const players = [];

  LOBBY_PROFILES.forEach((profile, index) => {
    // First letter of the nickname
    const letter = profile.name.trim().charAt(0).toUpperCase() || 'A';
    const aliveAsset = assetCache[`alive_${letter}`];
    const deadAsset = assetCache[`dead_${letter}`];
    const filter = profile.filter || 'none';

    // Original high-quality texture filters preserving eye whites, depth, and contrast
    const frontTexture = bakeTexture(aliveAsset, `saturate(0.82) brightness(1.14) ${filter}`, 16);
    const blinkTexture = bakeBlinkTexture(aliveAsset, `saturate(0.82) brightness(1.14) ${filter}`, 16);
    const edgeTexture = bakeTexture(aliveAsset, `drop-shadow(0 0 1.2px #652224) brightness(0.72) contrast(1.12) saturate(0.85) ${filter}`, 16);
    const deadTexture = bakeTexture(deadAsset, `drop-shadow(0 0 4px rgba(240, 70, 80, 0.95)) drop-shadow(0 0 14px rgba(220, 55, 65, 0.9)) drop-shadow(0 0 28px rgba(220, 55, 65, 0.75)) saturate(0.28) brightness(1.28) ${filter}`, 64, 600);
    const eyesTexture = bakeEyesTexture(aliveAsset);

    const player = new Player({
      letter,
      index,
      name: profile.name,
      color: profile.color,
      tilt: profile.tilt,
      isVip: profile.isVip,
      isVisible: true,
      textures: {
        front: frontTexture,
        blink: blinkTexture,
        edge: edgeTexture,
        dead: deadTexture,
        eyes: eyesTexture,
        aliveShadow: `assets/images/letters/${letter}.png`,
        deadShadow: `assets/images/letters-dead/${letter}.png`
      },
      parentEl: gridEl,
      sound: sound
    });

    players.push(player);
  });

  manager.setPlayers(players);

  // 4. Unified Main RAF Loop
  let lastTime = null;

  function engineLoop(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    // Update Room (scrolling, furniture, dynamic static noise)
    room.update(dt, now);

    // Update Players (continuous kinematic wiggling, flips, flights)
    for (let i = 0; i < players.length; i++) {
      players[i].update(dt, now);
    }

    requestAnimationFrame(engineLoop);
  }

  requestAnimationFrame(engineLoop);
}

window.addEventListener('DOMContentLoaded', init);
