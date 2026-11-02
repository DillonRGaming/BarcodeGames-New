/**
 * Dying to Know — phone controller.
 *
 * Messages from the host app (data):
 *   { type: 'profile', color, letter, vip }  how this player looks in the game
 *   { type: 'lobby' }                         waiting for the game to start (VIP sees the start button)
 *   { type: 'question', answers, shown, open } answers (first `shown` visible, tappable once `open`)
 *   { type: 'show', index }                   reveal one answer, in sync with the TV
 *   { type: 'open' }                          countdown started: answers can be tapped
 *   { type: 'reveal', correct: boolean }      after the timer runs out
 *   { type: 'countdown' }                     3, 2, 1 before the game (VIP sees Cancel)
 *   { type: 'intro' }                         intro playing (VIP sees Skip Intro)
 *   { type: 'wait', text? }                   between rounds (blank unless text is given)
 *   { type: 'sacrifice', reward }             20s to volunteer for the killing room (won if you survive, lost if you die)
 *   { type: 'objects', options }              Baggage Claim: tap the items you saw ({ id, label, color })
 *
 * Messages to the host:
 *   { type: 'start' }                         VIP pressed "Everybody's in"
 *   { type: 'cancel' }                        VIP pressed "Cancel" during the countdown
 *   { type: 'skip' }                          VIP pressed "Skip Intro"
 *   { type: 'answer', index }                 0-based answer the player picked
 *   { type: 'volunteer' }                     going into the killing room for the reward
 *   { type: 'objects', ids }                  current Baggage Claim selection (sent on every tap)
 */

BarcodeJoin.registerController('dying-to-know', ({ root, player, send, onMessage }) => {
  root.innerHTML = `
    <div class="dtk">
      <header class="dtk-header">
        <span class="dtk-vip dtk-vip-left hidden">VIP</span>
        <span class="dtk-name"></span>
        <span class="dtk-vip dtk-vip-right hidden">VIP</span>
      </header>
      <section class="dtk-body"></section>
      <footer class="dtk-footer hidden">
        <button class="dtk-start" type="button">Everybody's in</button>
        <button class="dtk-skip" type="button">Skip Intro</button>
        <button class="dtk-skip dtk-cancel" type="button">Cancel</button>
      </footer>
    </div>
  `;
  root.querySelector('.dtk-name').textContent = player.name;
  const header = root.querySelector('.dtk-header');
  const body = root.querySelector('.dtk-body');
  const vipTags = root.querySelectorAll('.dtk-vip');
  const footer = root.querySelector('.dtk-footer');
  const startBtn = root.querySelector('.dtk-start');
  const skipBtn = root.querySelector('.dtk-skip:not(.dtk-cancel)');
  const cancelBtn = root.querySelector('.dtk-cancel');

  let isVip = false;
  let screen = 'lobby';

  function updateFooter() {
    footer.classList.toggle('hidden', !(isVip && ['lobby', 'countdown', 'intro'].includes(screen)));
    startBtn.classList.toggle('hidden', screen !== 'lobby');
    cancelBtn.classList.toggle('hidden', screen !== 'countdown');
    skipBtn.classList.toggle('hidden', screen !== 'intro');
  }

  skipBtn.addEventListener('click', () => {
    send({ type: 'skip' });
    skipBtn.disabled = true;
  });

  cancelBtn.addEventListener('click', () => {
    send({ type: 'cancel' });
    cancelBtn.disabled = true;
  });

  startBtn.addEventListener('click', () => {
    send({ type: 'start' });
    startBtn.disabled = true;
  });

  // Status words (Correct, Volunteered…) only flash up briefly, then fade
  function showMessage(title = '') {
    body.innerHTML = '<h2 class="dtk-title"></h2>';
    const el = body.querySelector('.dtk-title');
    el.textContent = title;
    if (title) setTimeout(() => el.classList.add('gone'), 1600);
  }

  // The colour of a player's dead letter: CSS saturate(0.45) brightness(1.05), as baked in the game
  function deadColor(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const s = 0.45;
    const m = [
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ];
    const c = m.map((row) => Math.min(255, Math.round((row[0] * r + row[1] * g + row[2] * b) * 1.05)));
    return `rgb(${c.join(', ')})`;
  }

  // Same look as the answers on the TV: torn number tile + typewriter text, stacked and centred
  let answerButtons = [];

  function showQuestion(answers, shown = 0, open = false) {
    body.innerHTML = '<div class="dtk-answers"></div>';
    const list = body.querySelector('.dtk-answers');
    answerButtons = answers.map((text, index) => {
      const btn = document.createElement('button');
      btn.className = 'dtk-answer';
      btn.type = 'button';
      btn.disabled = !open;
      if (index < shown) btn.classList.add('visible');
      btn.innerHTML = '<span class="dtk-answer-num"></span><span class="dtk-answer-text"></span>';
      btn.querySelector('.dtk-answer-num').textContent = index + 1;
      btn.querySelector('.dtk-answer-text').textContent = text;
      btn.addEventListener('click', () => {
        send({ type: 'answer', index });
        list.classList.add('answered');
        list.querySelectorAll('.dtk-answer').forEach((b) => {
          b.disabled = true;
          b.classList.toggle('picked', b === btn);
        });
      });
      list.appendChild(btn);
      return btn;
    });
  }

  function showSacrifice(reward) {
    body.innerHTML = '<button class="dtk-sacrifice" type="button"><span class="dtk-sacrifice-label">Volunteer</span><span class="dtk-sacrifice-reward"></span></button>';
    const btn = body.querySelector('.dtk-sacrifice');
    btn.querySelector('.dtk-sacrifice-reward').textContent = `£${reward}`;
    btn.addEventListener('click', () => {
      send({ type: 'volunteer' });
      btn.disabled = true;
    });
  }

  // Baggage Claim: the real items scattered loosely, faded until tapped. Every tap sends the
  // current selection; whatever is selected when the timer ends counts.
  function showObjects(options) {
    body.innerHTML = '<div class="dtk-objects"></div>';
    const field = body.querySelector('.dtk-objects');
    const picked = new Set();
    const cols = 3;
    const rows = Math.ceil((options.length + 1) / cols); // a spare cell or two so the gaps land anywhere
    const cells = Array.from({ length: cols * rows }, (_, i) => i).sort(() => Math.random() - 0.5).slice(0, options.length);
    options.forEach((it, i) => {
      const btn = document.createElement('button');
      btn.className = 'dtk-object';
      btn.type = 'button';
      const col = cells[i] % cols;
      const row = Math.floor(cells[i] / cols);
      // a loose grid: small nudges inside each cell, kept off the edges
      btn.style.left = `${10 + ((col + 0.5 + (Math.random() - 0.5) * 0.25) / cols) * 80}%`;
      btn.style.top = `${6 + ((row + 0.5 + (Math.random() - 0.5) * 0.2) / rows) * 88}%`;
      btn.style.setProperty('--size', `${(0.92 + Math.random() * 0.16).toFixed(2)}`);
      btn.style.setProperty('--tilt', `${((Math.random() - 0.5) * 12).toFixed(1)}deg`);
      btn.innerHTML = '<img alt="">';
      btn.querySelector('img').src = `games/dying-to-know/assets/baggage-claim/${it.id}.webp`;
      btn.addEventListener('click', () => {
        if (picked.has(it.id)) picked.delete(it.id); else picked.add(it.id);
        btn.classList.toggle('picked', picked.has(it.id));
        send({ type: 'objects', ids: [...picked] });
      });
      field.appendChild(btn);
    });
  }

  onMessage((data) => {
    if (data.type === 'show') {
      const btn = answerButtons[data.index];
      // Wait a frame so a just-created answer still animates in
      if (btn) requestAnimationFrame(() => requestAnimationFrame(() => btn.classList.add('visible')));
      return;
    }
    if (data.type === 'open') {
      answerButtons.forEach((b) => { if (!b.closest('.answered')) b.disabled = false; });
      return;
    }
    if (data.type === 'profile') {
      header.style.setProperty('--player-color', data.dead ? deadColor(data.color) : data.color);
      root.querySelector('.dtk').classList.toggle('in-killing-room', !!data.killingRoom);
      header.classList.add('has-color');
      isVip = !!data.vip;
      vipTags.forEach((tag) => tag.classList.toggle('hidden', !isVip));
      updateFooter();
      return;
    }

    screen = data.type;
    switch (data.type) {
      case 'lobby':
        startBtn.disabled = false;
        showMessage();
        break;
      case 'question':
        showQuestion(data.answers, data.shown ?? data.answers.length, data.open ?? true);
        break;
      case 'reveal':
        showMessage(data.correct ? 'Correct' : 'Wrong');
        break;
      case 'countdown':
        cancelBtn.disabled = false;
        showMessage();
        break;
      case 'intro':
        skipBtn.disabled = false;
        showMessage();
        break;
      case 'wait':
        showMessage(data.text);
        break;
      case 'sacrifice':
        // The reward drops as others volunteer: update the amount without resetting a pressed button
        if (body.querySelector('.dtk-sacrifice')) body.querySelector('.dtk-sacrifice-reward').textContent = `£${data.reward}`;
        else showSacrifice(data.reward);
        break;
      case 'objects':
        showObjects(data.options || []);
        break;
    }
    updateFooter();
  });

  showMessage();
});
