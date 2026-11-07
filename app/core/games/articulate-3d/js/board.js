/**
 * DrawBoard — the drawing canvas, shared by the phone (draws) and the TV (replays).
 * Identical copies: web/games/articulate/board.js and app/core/games/articulate-3d/js/board.js (the old square 2D game keeps its own, app/core/games/articulate/js/board.js). Keep them in sync.
 *
 * Everything is a list of ops in a 0..1000 wide space, 0..1000*aspect tall (aspect 1 = a square; the portrait paper uses
 * DrawBoard.PORTRAIT), so any canvas size replays the same picture:
 *   { t: 'l', c, s, a, p: [x, y, x, y, ...] } line: colour index, size index, opacity (0.05..1, default 1), points
 *   { t: 'f', c, x, y }                       bucket fill
 */

(() => {
  const COLORS = [
    '#1f1d1a', '#fffdf6', '#8c8a86', '#cfccc4', '#dc4a3c', '#ee8a32', '#f2cc3e', '#56b35e',
    '#4aa6dc', '#3e53bd', '#8b52bf', '#ea86b4', '#9a6238', '#5c3a1e', '#2f6b3c', '#24507e',
  ];
  const PAPER = '#fffdf6'; // the canvas background, same as the white in the palette
  const SIZES = [6, 14, 28, 52]; // line width in the 1000 square
  const FILL_TOLERANCE = 60; // summed RGB difference still counted as the same colour (soaks up anti-aliasing)

  class DrawBoard {
    constructor(canvas, aspect = 1) {
      this.canvas = canvas;
      this.aspect = aspect;
      this.ctx = canvas.getContext('2d', { willReadFrequently: true });
      this.ops = [];
      this.resize(canvas.width || 1000);
    }

    /** Set the pixel width (the height follows the aspect) and repaint */
    resize(px) {
      px = Math.max(50, Math.round(px));
      this.canvas.width = px;
      this.canvas.height = Math.round(px * this.aspect);
      this.k = px / 1000;
      this.redraw();
    }

    redraw() {
      const { ctx, canvas } = this;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      this.ops.forEach((op) => this.paint(op, 0));
    }

    setOps(ops) {
      this.ops = ops.map((op) => ({ ...op, p: op.p ? op.p.slice() : undefined }));
      this.redraw();
    }

    add(op) {
      if (!DrawBoard.valid(op, this.aspect)) return null;
      const copy = { ...op, p: op.p ? op.p.slice() : undefined };
      this.live = null;
      if (copy.t === 'l' && copy.a < 1) { // see-through lines are repainted whole while they grow, from what was under them
        this.live = document.createElement('canvas');
        this.live.width = this.canvas.width; this.live.height = this.canvas.height;
        this.live.getContext('2d').drawImage(this.canvas, 0, 0);
      }
      this.ops.push(copy);
      this.paint(copy, 0);
      return copy;
    }

    /** Add points to the line being drawn */
    extend(points) {
      const op = this.ops[this.ops.length - 1];
      if (!op || op.t !== 'l' || !Array.isArray(points) || points.length < 2) return;
      const from = op.p.length / 2;
      for (let i = 0; i + 1 < points.length; i += 2) op.p.push(DrawBoard.clamp(points[i]), DrawBoard.clamp(points[i + 1], 1000 * this.aspect));
      if (this.live && op.a < 1) { this.ctx.drawImage(this.live, 0, 0); this.paint(op, 0); } else this.paint(op, from);
    }

    undo() {
      if (!this.ops.length) return;
      this.live = null;
      this.ops.pop();
      this.redraw();
    }

    clear() {
      this.ops = [];
      this.redraw();
    }

    /** Last point drawn, in board coordinates (for the TV's pen marker) */
    lastPoint() {
      const op = this.ops[this.ops.length - 1];
      if (!op) return null;
      if (op.t === 'f') return [op.x, op.y];
      return [op.p[op.p.length - 2], op.p[op.p.length - 1]];
    }

    /** Paint an op; for a line, from point index `from` on (so live lines only paint their new part) */
    paint(op, from) {
      if (op.t === 'f') return this.fill(op);
      const { ctx, k } = this;
      const p = op.p;
      const n = p.length / 2;
      ctx.strokeStyle = COLORS[op.c];
      ctx.fillStyle = COLORS[op.c];
      ctx.lineWidth = SIZES[op.s] * k;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = op.a == null ? 1 : op.a;
      if (n === 1) {
        ctx.beginPath();
        ctx.arc(p[0] * k, p[1] * k, (SIZES[op.s] * k) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const start = Math.max(0, from - 1);
      ctx.beginPath();
      ctx.moveTo(p[start * 2] * k, p[start * 2 + 1] * k);
      for (let i = start + 1; i < n; i++) ctx.lineTo(p[i * 2] * k, p[i * 2 + 1] * k);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    fill(op) {
      const { ctx, canvas } = this;
      const w = canvas.width;
      const h = canvas.height;
      const sx = Math.min(w - 1, Math.floor(op.x * this.k));
      const sy = Math.min(h - 1, Math.floor(op.y * this.k));
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const hex = COLORS[op.c];
      const fr = parseInt(hex.slice(1, 3), 16);
      const fg = parseInt(hex.slice(3, 5), 16);
      const fb = parseInt(hex.slice(5, 7), 16);
      const i0 = (sy * w + sx) * 4;
      const tr = d[i0];
      const tg = d[i0 + 1];
      const tb = d[i0 + 2];
      if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) <= 8) return;

      const same = (i) => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= FILL_TOLERANCE;
      const seen = new Uint8Array(w * h);
      const stack = [sx, sy];
      while (stack.length) {
        const y = stack.pop();
        let x = stack.pop();
        let pi = y * w + x;
        while (x > 0 && !seen[pi - 1] && same((pi - 1) * 4)) { x--; pi--; }
        let up = false;
        let down = false;
        for (; x < w && !seen[pi] && same(pi * 4); x++, pi++) {
          seen[pi] = 1;
          const i = pi * 4;
          d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
          if (y > 0) {
            const a = !seen[pi - w] && same((pi - w) * 4);
            if (a && !up) stack.push(x, y - 1);
            up = a;
          }
          if (y < h - 1) {
            const b = !seen[pi + w] && same((pi + w) * 4);
            if (b && !down) stack.push(x, y + 1);
            down = b;
          }
        }
      }
      // Pull the anti-aliased rim just outside the filled area into the fill colour, so no white halo
      for (let pi = 0; pi < w * h; pi++) {
        if (seen[pi]) continue;
        const x = pi % w;
        if ((x > 0 && seen[pi - 1]) || (x < w - 1 && seen[pi + 1]) || (pi >= w && seen[pi - w]) || (pi < w * (h - 1) && seen[pi + w])) {
          const i = pi * 4;
          const diff = Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb);
          if (diff <= 240) { d[i] = (d[i] + fr) >> 1; d[i + 1] = (d[i + 1] + fg) >> 1; d[i + 2] = (d[i + 2] + fb) >> 1; }
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    static clamp(v, max = 1000) {
      return Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
    }

    /** Ops come off the network: only accept well-formed ones */
    static valid(op, aspect = 1) {
      if (!op || typeof op !== 'object') return false;
      if (!(op.c >= 0 && op.c < COLORS.length) || Math.floor(op.c) !== op.c) return false;
      if (op.t === 'f') {
        op.x = DrawBoard.clamp(op.x);
        op.y = DrawBoard.clamp(op.y, 1000 * aspect);
        return true;
      }
      if (op.t !== 'l' || !(op.s >= 0 && op.s < SIZES.length) || Math.floor(op.s) !== op.s) return false;
      if (!Array.isArray(op.p) || op.p.length < 2 || op.p.length % 2) return false;
      op.a = op.a == null ? 1 : Math.max(0.05, Math.min(1, Number(op.a) || 1));
      op.p = op.p.map((v, i) => DrawBoard.clamp(v, i % 2 ? 1000 * aspect : 1000));
      return true;
    }
  }

  DrawBoard.COLORS = COLORS;
  DrawBoard.SIZES = SIZES;
  DrawBoard.PORTRAIT = 1.25; // height : width of the paper on the phone and the easel
  window.DrawBoard = DrawBoard;
})();
