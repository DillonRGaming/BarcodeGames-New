/**
 * Main.js - Application Bootstrap, Texture Baker, Asset Preloader, and Engine Loop
 */

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const assetCache = {};

/* =========================================
   Texture Baking Utilities (Canvas)
   ========================================= */

function bakeTexture(imgElement, filterString, padding = 16, maxDim = 260) {
  if (!imgElement || (imgElement.naturalWidth || imgElement.width) === 0) {
    return imgElement ? imgElement.src : '';
  }
  try {
    const nw = imgElement.naturalWidth || imgElement.width || 260;
    const nh = imgElement.naturalHeight || imgElement.height || 260;
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
  if (!imgElement || (imgElement.naturalWidth || imgElement.width) === 0) {
    return imgElement ? imgElement.src : '';
  }
  try {
    const nw = imgElement.naturalWidth || imgElement.width || 260;
    const nh = imgElement.naturalHeight || imgElement.height || 260;
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
  if (!imgElement || (imgElement.naturalWidth || imgElement.width) === 0) return '';
  try {
    const nw = imgElement.naturalWidth || imgElement.width || 260;
    const nh = imgElement.naturalHeight || imgElement.height || 260;
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

/* =========================================
   Player Colours & Letters
   ========================================= */

// Letter art recoloured to a player's colour (palette.js), as a canvas the bakers can read
function tintedLetter(img, hex) {
  if (!img || !img.naturalWidth) return img;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  tintLetterCanvas(ctx, canvas.width, canvas.height, hex);
  return canvas;
}

function shadeHex(hex, amount) {
  const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * amount));
  return `rgb(${c.join(', ')})`;
}

const NAME_TILTS = [-6, 4, -3, 5, -4, 6, -5, 4];

// First A–Z character of the name (names come in uppercase from the join site)
function letterForName(name) {
  const match = String(name).toUpperCase().match(/[A-Z]/);
  return match ? match[0] : alphabet[Math.floor(Math.random() * alphabet.length)];
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
  window.gameSound = sound; // scrambling text types with it
  const manager = new GameManager({ room, camera, sound, gridEl, players: [] });
  window.gameManager = manager; // dev: poke at the game from the console

  // 2. Decode every letter (alive + dead) up front so join-time texture baking is instant
  const decodes = [];
  alphabet.forEach((char) => {
    const alive = new Image();
    alive.src = `assets/images/letters/${char}.png`;
    assetCache[`alive_${char}`] = alive;

    const dead = new Image();
    dead.src = `assets/images/letters-dead/${char}.png`;
    assetCache[`dead_${char}`] = dead;

    if (alive.decode) decodes.push(alive.decode().catch(() => { }));
    if (dead.decode) decodes.push(dead.decode().catch(() => { }));
  });

  ['assets/images/rooms/curtains.png', 'assets/images/web.png', 'assets/images/web-2.png'].forEach((src) => {
    const img = new Image();
    img.src = src;
    if (img.decode) decodes.push(img.decode().catch(() => { }));
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

  await Promise.all(decodes);

  // 3. Players are created as people join (see GameManager._initRoom)
  const players = [];

  manager.createPlayer = ({ name, colorIndex, isVip = false }) => {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    const letter = letterForName(name);
    const aliveAsset = tintedLetter(assetCache[`alive_${letter}`], color);
    const deadAsset = tintedLetter(assetCache[`dead_${letter}`], color);
    const glow = (alpha) => color + Math.round(alpha * 255).toString(16).padStart(2, '0');
    const edgeShade = shadeHex(color, 0.4);
    const index = players.length;

    // Original high-quality texture filters preserving eye whites, depth, and contrast
    const player = new Player({
      letter,
      index,
      name,
      color,
      tilt: NAME_TILTS[index % NAME_TILTS.length],
      isVip,
      isVisible: true,
      textures: {
        front: bakeTexture(aliveAsset, 'none', 16),
        blink: bakeBlinkTexture(aliveAsset, 'none', 16),
        edge: bakeTexture(aliveAsset, `drop-shadow(0 0 1.2px ${edgeShade}) brightness(0.72) contrast(1.12)`, 16),
        dead: bakeTexture(deadAsset, `drop-shadow(0 0 4px ${glow(0.6)}) drop-shadow(0 0 14px ${glow(0.45)}) drop-shadow(0 0 28px ${glow(0.3)}) saturate(0.45) brightness(1.05)`, 64, 600),
        // Dead-letter edges, baked at the dead face's size so the swapped sides line up with it
        deadEdge: bakeTexture(deadAsset, `drop-shadow(0 0 1.2px ${edgeShade}) brightness(0.72) contrast(1.12)`, 64, 600),
        eyes: bakeEyesTexture(aliveAsset),
        aliveShadow: `assets/images/letters/${letter}.png`,
        deadShadow: `assets/images/letters-dead/${letter}.png`
      },
      parentEl: gridEl,
      sound: sound
    });

    players.push(player);
    return player;
  };

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
