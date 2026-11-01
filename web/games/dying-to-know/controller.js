/**
 * Dying to Know — phone controller.
 *
 * Messages from the host app (data):
 *   { type: 'lobby' }                         waiting for the game to start
 *   { type: 'question', answers: [4 strings] } show answer buttons
 *   { type: 'reveal', correct: boolean }      after the timer runs out
 *   { type: 'wait', text? }                   between rounds (blank unless text is given)
 *
 * Messages to the host:
 *   { type: 'answer', index }                 0-based answer the player picked
 */

BarcodeJoin.registerController('dying-to-know', ({ root, player, send, onMessage }) => {
  root.innerHTML = `
    <div class="dtk">
      <header class="dtk-header">
        <span class="dtk-name"></span>
      </header>
      <section class="dtk-body"></section>
    </div>
  `;
  root.querySelector('.dtk-name').textContent = player.name;
  const body = root.querySelector('.dtk-body');

  function showMessage(title = '') {
    body.innerHTML = '<h2 class="dtk-title"></h2>';
    body.querySelector('.dtk-title').textContent = title;
  }

  function showQuestion(answers) {
    body.innerHTML = '<div class="dtk-answers"></div>';
    const list = body.querySelector('.dtk-answers');
    answers.forEach((text, index) => {
      const btn = document.createElement('button');
      btn.className = 'dtk-answer';
      btn.innerHTML = '<span class="dtk-answer-num"></span><span class="dtk-answer-text"></span>';
      btn.querySelector('.dtk-answer-num').textContent = index + 1;
      btn.querySelector('.dtk-answer-text').textContent = text;
      btn.addEventListener('click', () => {
        send({ type: 'answer', index });
        list.querySelectorAll('.dtk-answer').forEach((b) => {
          b.disabled = true;
          b.classList.toggle('picked', b === btn);
        });
      });
      list.appendChild(btn);
    });
  }

  onMessage((data) => {
    switch (data.type) {
      case 'lobby':
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
  });

  showMessage();
});
