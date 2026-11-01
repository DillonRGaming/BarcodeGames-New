/**
 * Palette.js - Player colours and letter tinting
 *
 * The Nth person to join always gets colour N. The phone's name bar uses the same hex,
 * so a player's letter on the TV and their phone always match.
 */

const PLAYER_COLORS = [
  '#2f7cf6', // blue
  '#f0413d', // red
  '#2fbf5b', // green
  '#ffc21a', // yellow
  '#9a5cf0', // purple
  '#ff7a1f', // orange
  '#f25aa8', // pink
  '#14b8aa', // teal
  '#b8743c', // brown
  '#e8e4dc', // bone white
];

/**
 * Recolour a letter image to `hex`, keeping its knit pattern, shading, black outline and eye highlights.
 * Works on the red source art: each pixel's brightness is rescaled so the letter body lands on `hex`.
 */
function tintLetterCanvas(ctx, width, height, hex) {
  const target = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  const BODY_LUMA = 92; // brightness of the plain letter body in the red source art

  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 195 && g > 195 && b > 195) continue; // eye highlights stay white
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const k = luma / BODY_LUMA;
    // Body → target colour; darker knit/outline → darker shade; slightly brighter → lighter
    for (let c = 0; c < 3; c++) {
      const v = k <= 1 ? target[c] * k : target[c] + (255 - target[c]) * (k - 1) * 0.6;
      d[i + c] = Math.max(0, Math.min(255, v));
    }
  }
  ctx.putImageData(img, 0, 0);
}
