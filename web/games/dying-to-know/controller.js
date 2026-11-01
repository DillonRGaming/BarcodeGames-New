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
 *   { type: 'intro' }                         intro playing (VIP sees Skip Intro)
 *   { type: 'wait', text? }                   between rounds (blank unless text is given)
 *
 * Messages to the host:
 *   { type: 'start' }                         VIP pressed "Everybody's in"
 *   { type: 'skip' }                          VIP pressed "Skip Intro"
 *   { type: 'answer', index }                 0-based answer the player picked
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
      </footer>
    </div>
  `;
  root.querySelector('.dtk-name').textContent = player.name;
  const header = root.querySelector('.dtk-header');
  const body = root.querySelector('.dtk-body');
  const vipTags = root.querySelectorAll('.dtk-vip');
  const footer = root.querySelector('.dtk-footer');
  const startBtn = root.querySelector('.dtk-start');
  const skipBtn = root.querySelector('.dtk-skip');

  let isVip = false;
  let screen = 'lobby';

  function updateFooter() {
    footer.classList.toggle('hidden', !(isVip && (screen === 'lobby' || screen === 'intro')));
    startBtn.classList.toggle('hidden', screen !== 'lobby');
    skipBtn.classList.toggle('hidden', screen !== 'intro');
  }

  skipBtn.addEventListener('click', () => {
    send({ type: 'skip' });
    skipBtn.disabled = true;
  });

  startBtn.addEventListener('click', () => {
    send({ type: 'start' });
    startBtn.disabled = true;
  });

  function showMessage(title = '') {
    body.innerHTML = '<h2 class="dtk-title"></h2>';
    body.querySelector('.dtk-title').textContent = title;
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
      header.style.setProperty('--player-color', data.color);
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
      case 'intro':
        skipBtn.disabled = false;
        showMessage();
        break;
      case 'wait':
        showMessage(data.text);
        break;
    }
    updateFooter();
  });

  showMessage();
});
