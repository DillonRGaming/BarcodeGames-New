/**
 * Articulate — phone controller, being rebuilt to feel like the TV's street. The screen is a three.js scene (stage.js):
 * the sky and a sea of drifting cloud, and, when there's something to draw (their self-portrait in the lobby, the word
 * on their turn), a sheet of white paper with a pen in the colour the game gave them and nothing else.
 *
 * From the host: { type: 'profile', color, ... } · { type: 'screen', screen, id, ... } (lobby and draw get the paper)
 *                { type: 'ops', ops, first } (the drawing so far, after coming back)
 *                { type: 'screen', screen: 'guess', guesses: [{ text, close }], solved } is a chalkboard over the sky (HTML on top of the stage)
 *                { type: 'screen', screen: 'choose', words: [...] } is one board per word to tap
 *                { type: 'line', c, s, a, p } carries an opacity a; { type: 'undo' } takes the last stroke back (redo sends it again)
 * To the host:   { type: 'pick', index } · { type: 'guess', text } · { type: 'line', c: 0, s, p: [x, y] } starts a line · { type: 'pts', p: [x, y, ...] } continues it
 *                (x 0..1000, y 0..1250: a portrait paper, see board.js)
 */

BarcodeJoin.registerController('articulate', ({ root, send, onMessage }) => {
  root.innerHTML = '<div class="ar"></div>';
  const PEN = { c: 0, s: 1, a: 1 }, PFP = { c: 0, s: 3, a: 1 }, PEN_DRAW = PEN; // the ink colour (the game's suggestion from the profile, then their choice), size and opacity
  const redo = []; // strokes taken back, to put back
  let stage = null, current = null, myName = '';

  const loadBoard = window.DrawBoard ? Promise.resolve() : new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `games/articulate/board.js?v=${Date.now()}`;
    s.onload = resolve;
    document.body.appendChild(s);
  });
  const ready = loadBoard
    .then(() => import(`./stage.js?v=${Date.now()}`))
    .then(({ mountStage }) => mountStage(root.querySelector('.ar')))
    .then((s) => { stage = s; stage.onDraw = pen; stage.onPick = (index) => send({ type: 'pick', index }); stage.onTool = onTool; stage.onLayout = () => placeInput(); });

  /* ---------- Drawing: strokes go on the paper and to the TV, sent in batches ---------- */

  // Stabilising: the pen point follows the finger a fraction of the way each move, which irons out the wobble
  // (a bit on the drawing screen, more on the profile picture); the pen catches up to the finger when it lifts.
  let last = null, raw = null, buffer = [], flushTimer = null, follow = 0.5;
  const flush = () => { if (buffer.length) { send({ type: 'pts', p: buffer }); buffer = []; } };
  const lobby = () => current && current.screen === 'lobby';
  const lay = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 4) return;
    last = [x, y];
    buffer.push(x, y);
    stage.board.extend([x, y]);
    stage.changed();
  };
  const pen = {
    down(x, y) {
      last = [x, y]; raw = [x, y];
      const PEN = lobby() ? PFP : PEN_DRAW; // the profile picture is black and thick, nothing else
      follow = lobby() ? 0.3 : 0.5;
      redo.length = 0;
      stage.board.add({ t: 'l', c: PEN.c, s: PEN.s, a: PEN.a, p: [x, y] });
      send({ type: 'line', c: PEN.c, s: PEN.s, a: PEN.a, p: [x, y] });
      flushTimer = setInterval(flush, 50);
      stage.changed();
    },
    move(x, y) {
      raw = [x, y];
      lay(last[0] + (x - last[0]) * follow, last[1] + (y - last[1]) * follow);
    },
    up() {
      for (let i = 0; i < 6; i++) lay(last[0] + (raw[0] - last[0]) * follow, last[1] + (raw[1] - last[1]) * follow);
      lay(raw[0], raw[1]);
      clearInterval(flushTimer); flush(); tools();
    },
  };

  /* ---------- Tools: colour, size, opacity, undo, redo (the bar under the paper, in stage.js) ---------- */

  const toolState = () => ({ colour: PEN.c, size: PEN.s, alpha: PEN.a, canUndo: stage.board.ops.length > 0, canRedo: redo.length > 0 });
  const tools = () => { if (current && current.screen === 'draw') stage.setTools(toolState()); };
  function onTool({ k, v }) {
    if (k === 'colour') PEN.c = v;
    else if (k === 'size') PEN.s = v;
    else if (k === 'alpha') PEN.a = v;
    else if (k === 'undo') {
      const op = stage.board.ops[stage.board.ops.length - 1];
      if (!op) return;
      redo.push({ ...op, p: op.p.slice() });
      stage.board.undo(); stage.changed(); send({ type: 'undo' });
    } else if (k === 'redo') {
      const op = redo.pop();
      if (!op) return;
      stage.board.add(op); stage.changed();
      send({ type: 'line', c: op.c, s: op.s, a: op.a, p: op.p.slice(0, 2) });
      for (let i = 2; i < op.p.length; i += 400) send({ type: 'pts', p: op.p.slice(i, i + 400) });
    }
    tools();
  }

  /* ---------- Guessing: the boards are in the scene (stage.js); only the text field is real, sitting invisibly over the input board so the phone keyboard opens ---------- */

  const guessEl = document.createElement('form');
  guessEl.className = 'ar-guess';
  guessEl.autocomplete = 'off';
  guessEl.hidden = true;
  guessEl.innerHTML = '<input maxlength="40" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Guess">';
  root.appendChild(guessEl);
  const guessInput = guessEl.querySelector('input');
  let guessData = null;
  const placeInput = () => {
    const r = ready && stage && stage.inputRect;
    guessEl.hidden = !r;
    if (r) Object.assign(guessEl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  };
  guessInput.addEventListener('input', () => { if (guessData) { guessData.typed = guessInput.value; stage.setGuess(guessData); } });
  guessEl.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = guessInput.value.trim();
    if (!text) return;
    send({ type: 'guess', text });
    guessInput.value = ''; guessData.typed = ''; stage.setGuess(guessData);
  });
  function showGuess(data) {
    guessData = { guesses: data.guesses, solved: data.solved, typed: guessInput.value };
    stage.setGuess(guessData);
    if (data.solved) guessInput.blur();
  }

  /* ---------- Messages ---------- */

  let queue = ready;
  onMessage((data) => { queue = queue.then(() => handle(data)); });
  function handle(data) {
    if (data.type === 'profile') { PEN.c = data.ink ?? PEN.c; tools(); myName = data.name; return stage.setName(current && current.screen === 'draw' ? current.word : myName); } // white paper for everyone; the game gives each player their ink
    if (data.type === 'screen') {
      // a new drawing (a new screen) starts on a clean sheet; repeats of the same one leave it be
      if (!current || current.id !== data.id || current.screen !== data.screen) { stage.board.clear(); stage.changed(); redo.length = 0; stage.transition(); }
      current = data;
      stage.showPaper(data.screen === 'lobby' || data.screen === 'draw');
      if (data.screen === 'draw') stage.setTools(toolState()); else stage.setTools(null);
      stage.setChoices(data.screen === 'choose' ? data.words : null);
      stage.setName(data.screen === 'draw' ? data.word : myName); // on their turn the sign tells them what to draw
      if (data.screen === 'guess') return showGuess(data);
      guessData = null; stage.setGuess(null); guessEl.hidden = true;
      return;
    }
    if (data.type === 'ops') {
      if (data.first) stage.board.setOps(data.ops.filter((op) => DrawBoard.valid(op, DrawBoard.PORTRAIT)));
      else data.ops.forEach((op) => stage.board.add(op));
      stage.changed(); tools();
    }
  }
});
