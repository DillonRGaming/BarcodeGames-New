/**
 * Characters — the players' avatars: art supplies with little faces.
 * Two identical copies: web/games/articulate/characters.js and app/core/games/articulate/js/characters.js. Keep them in sync.
 *
 *   Characters.svg(index)  →  <svg> markup (viewBox 0 0 100 100)
 *   Characters.count       →  how many there are
 */
(() => {
  // Shiny black eyes + a small mouth, centred on (x, y)
  function face(x, y, { gap = 15, mood = 'smile', blush = true, size = 1 } = {}) {
    const ex = gap / 2;
    const eye = (cx) => `<ellipse cx="${cx}" cy="${y}" rx="${3.6 * size}" ry="${4.7 * size}" fill="#1d1b1f"/>
      <circle cx="${cx - 1.1 * size}" cy="${y - 1.9 * size}" r="${1.35 * size}" fill="#fff"/>`;
    const my = y + 7 * size;
    const mouths = {
      smile: `<path d="M${x - 3.5} ${my} Q${x} ${my + 3.6} ${x + 3.5} ${my}" fill="none" stroke="#1d1b1f" stroke-width="2.4" stroke-linecap="round"/>`,
      open: `<path d="M${x - 4} ${my - 0.5} Q${x} ${my + 6} ${x + 4} ${my - 0.5} Z" fill="#1d1b1f"/><path d="M${x - 2} ${my + 2.4} Q${x} ${my + 4} ${x + 2} ${my + 2.4}" fill="none" stroke="#e8798f" stroke-width="2" stroke-linecap="round"/>`,
      flat: `<path d="M${x - 3} ${my + 1} H${x + 3}" stroke="#1d1b1f" stroke-width="2.4" stroke-linecap="round"/>`,
      o: `<ellipse cx="${x}" cy="${my + 1}" rx="2.4" ry="2.8" fill="#1d1b1f"/>`,
    };
    const cheeks = blush
      ? `<ellipse cx="${x - ex - 4.5}" cy="${y + 5.5}" rx="3.4" ry="2" fill="#f27f93" opacity="0.55"/><ellipse cx="${x + ex + 4.5}" cy="${y + 5.5}" rx="3.4" ry="2" fill="#f27f93" opacity="0.55"/>`
      : '';
    return eye(x - ex) + eye(x + ex) + cheeks + mouths[mood];
  }

  const CAST = [
    // Pencil
    () => `<g transform="rotate(-12 50 52)">
      <path d="M38 8 H62 V14 H38 Z" fill="#f08aa5"/><path d="M38 14 H62 V20 H38 Z" fill="#c9ccd3"/>
      <path d="M38 20 H62 V70 H38 Z" fill="#f6c443"/><path d="M54 20 H62 V70 H54 Z" fill="#e3a92c"/>
      <path d="M38 70 H62 L50 94 Z" fill="#f2d3a5"/><path d="M45.5 85 H54.5 L50 94 Z" fill="#3a3436"/>
      ${face(50, 42, { gap: 11, size: 0.9 })}</g>`,
    // Crayon
    () => `<g transform="rotate(10 50 52)">
      <path d="M36 22 L50 4 L64 22 Z" fill="#e2574c"/>
      <rect x="34" y="22" width="32" height="70" rx="5" fill="#e2574c"/>
      <rect x="34" y="34" width="32" height="40" fill="#fbeee0"/><path d="M34 38 H66 M34 70 H66" stroke="#e2574c" stroke-width="2.5"/>
      ${face(50, 51, { gap: 12, size: 0.9 })}</g>`,
    // Eraser
    () => `<g transform="rotate(-8 50 50)">
      <rect x="14" y="30" width="72" height="44" rx="10" fill="#f6a3b8"/>
      <path d="M52 30 H76 A10 10 0 0 1 86 40 V64 A10 10 0 0 1 76 74 H52 Z" fill="#5b8fd6"/>
      <path d="M52 30 V74" stroke="#4776b8" stroke-width="3"/>
      ${face(33, 49, { gap: 13 })}</g>`,
    // Paint pot
    () => `<path d="M24 34 H76 L72 88 Q71 94 65 94 H35 Q29 94 28 88 Z" fill="#dfe6ee"/>
      <rect x="22" y="26" width="56" height="10" rx="3" fill="#b9c4d1"/>
      <path d="M26 30 Q34 46 40 34 Q46 54 52 34 Q60 48 66 34 Q70 44 74 30 Z" fill="#4fb7a8"/>
      <path d="M22 26 Q50 16 78 26 Z" fill="#4fb7a8"/>
      ${face(50, 63, { gap: 15 })}`,
    // Paint tube
    () => `<g transform="rotate(14 50 50)">
      <rect x="40" y="6" width="20" height="14" rx="3" fill="#3d3a44"/>
      <path d="M38 20 H62 L70 34 V84 Q70 88 66 88 H34 Q30 88 30 84 V34 Z" fill="#f4f1ea"/>
      <path d="M30 84 H70 V92 H30 Z" fill="#c9c4b8"/><rect x="30" y="40" width="40" height="30" fill="#9b6fd6"/>
      ${face(50, 52, { gap: 12, size: 0.9, mood: 'open' })}</g>`,
    // Sticky note
    () => `<g transform="rotate(-6 50 50)">
      <path d="M16 16 H84 V66 L66 84 H16 Z" fill="#f7dc5b"/><path d="M84 66 L66 84 V70 Q66 66 70 66 Z" fill="#dcb93c"/>
      <path d="M16 16 H84 V24 H16 Z" fill="#efcf45"/>
      ${face(48, 47, { gap: 16 })}</g>`,
    // Marker
    () => `<g transform="rotate(-16 50 50)">
      <rect x="35" y="4" width="30" height="30" rx="7" fill="#3c8fd8"/>
      <rect x="33" y="30" width="34" height="6" rx="2" fill="#2f75b5"/>
      <rect x="37" y="34" width="26" height="54" rx="5" fill="#eef2f6"/>
      <path d="M41 88 H59 L54 98 H46 Z" fill="#3c8fd8"/>
      ${face(50, 57, { gap: 11, size: 0.85, mood: 'flat' })}</g>`,
    // Paintbrush
    () => `<g transform="rotate(20 50 50)">
      <rect x="43" y="46" width="14" height="50" rx="7" fill="#b9814f"/>
      <rect x="40" y="34" width="20" height="14" rx="3" fill="#c9ccd3"/>
      <path d="M40 34 Q36 14 50 2 Q64 14 60 34 Z" fill="#e66b8a"/>
      ${face(50, 22, { gap: 9, size: 0.75, blush: false })}</g>`,
    // Palette
    () => `<path d="M50 14 C24 14 10 32 12 52 C14 72 32 86 52 86 C60 86 62 80 58 74 C54 68 58 62 66 63 C80 64 90 56 88 42 C86 26 70 14 50 14 Z" fill="#d9a46a"/>
      <ellipse cx="68" cy="73" rx="7" ry="6" fill="#2f3036" opacity="0.15"/>
      <circle cx="30" cy="36" r="6" fill="#e2574c"/><circle cx="48" cy="28" r="6" fill="#f6c443"/><circle cx="68" cy="34" r="6" fill="#4fb7a8"/><circle cx="76" cy="50" r="5.5" fill="#5b8fd6"/>
      ${face(38, 58, { gap: 14 })}`,
    // Ink bottle
    () => `<rect x="38" y="12" width="24" height="14" rx="3" fill="#3d3a44"/>
      <path d="M34 26 H66 Q70 26 72 32 L78 50 V86 Q78 92 72 92 H28 Q22 92 22 86 V50 L28 32 Q30 26 34 26 Z" fill="#5d6fd0"/>
      <rect x="30" y="50" width="40" height="30" rx="6" fill="#eef0fb"/>
      ${face(50, 62, { gap: 13, size: 0.9, mood: 'o' })}`,
  ];

  window.Characters = {
    count: CAST.length,
    svg(index) {
      const draw = CAST[((index % CAST.length) + CAST.length) % CAST.length];
      return `<svg class="character" viewBox="0 0 100 100" aria-hidden="true">${draw()}</svg>`;
    },
  };
})();
