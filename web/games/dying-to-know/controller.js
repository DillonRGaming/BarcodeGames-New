/**
 * Dying to Know — phone controller.
 *
 * Messages from the host app (data):
 *   { type: 'profile', color, letter, vip }  how this player looks in the game
 *   { type: 'lobby' }                         waiting for the game to start (VIP sees the start button)
 *   { type: 'question', answers: [4 strings] } show answer buttons
 *   { type: 'reveal', correct: boolean }      after the timer runs out
 *   { type: 'wait', text? }                   between rounds (blank unless text is given)
 *
 * Messages to the host:
 *   { type: 'start' }                         VIP pressed "Everybody's in"
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
      </footer>
    </div>
  `;
  root.querySelector('.dtk-name').textContent = player.name;
  const header = root.querySelector('.dtk-header');
  const body = root.querySelector('.dtk-body');
  const vipTags = root.querySelectorAll('.dtk-vip');
  const footer = root.querySelector('.dtk-footer');
  const startBtn = root.querySelector('.dtk-start');

  let isVip = false;
  let screen = 'lobby';

  function updateFooter() {
    footer.classList.toggle('hidden', !(isVip && screen === 'lobby'));
  }

  startBtn.addEventListener('click', () => {
    send({ type: 'start' });
    startBtn.disabled = true;
  });

  function showMessage(title = '') {
    body.innerHTML = '<h2 class="dtk-title"></h2>';
    body.querySelector('.dtk-title').textContent = title;
  }

  // Same look as the answers on the TV: torn number tile + typewriter text, stacked and centred
  function showQuestion(answers) {
    body.innerHTML = '<div class="dtk-answers"></div>';
    const list = body.querySelector('.dtk-answers');
    answers.forEach((text, index) => {
      const btn = document.createElement('button');
      btn.className = 'dtk-answer';
      btn.type = 'button';
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
    });
  }

  onMessage((data) => {
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
        showQuestion(data.answers);
        break;
      case 'reveal':
        showMessage(data.correct ? 'Correct' : 'Wrong');
        break;
      case 'wait':
        showMessage(data.text);
        break;
    }
    updateFooter();
  });

  showMessage();
});
