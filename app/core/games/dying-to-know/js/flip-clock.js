/**
 * FlipClock - flat 2D flip clock. Each digit is a card split at the hinge; on change the top half
 * of the old number folds down while the bottom half of the new number folds into place.
 *
 *   const clock = new FlipClock(el, 2);
 *   clock.set(15);   // no animation when the digit is unchanged
 */

class FlipClock {
  constructor(el, digits = 2) {
    this.el = el;
    this.el.classList.add('flip-clock');
    this.cards = [];
    for (let i = 0; i < digits; i++) {
      const card = document.createElement('div');
      card.className = 'flip-card';
      card.innerHTML = `
        <div class="flip-half flip-top"><span></span></div>
        <div class="flip-half flip-bottom"><span></span></div>
        <div class="flip-half flip-top flip-flap-top"><span></span></div>
        <div class="flip-half flip-bottom flip-flap-bottom"><span></span></div>
      `;
      this.el.appendChild(card);
      this.cards.push({ el: card, value: null });
    }
  }

  set(value, animate = true) {
    const text = String(Math.max(0, value)).padStart(this.cards.length, '0').slice(-this.cards.length);
    this.cards.forEach((card, i) => this._setCard(card, text[i], animate));
  }

  _setCard(card, digit, animate) {
    if (card.value === digit) return;
    const [top, bottom, flapTop, flapBottom] = card.el.querySelectorAll('span');
    const old = card.value === null ? digit : card.value;
    card.value = digit;

    // Static halves: new number on top (revealed as the flap falls), old number below until the flap lands
    top.textContent = digit;
    bottom.textContent = old;
    flapTop.textContent = old;
    flapBottom.textContent = digit;

    card.el.classList.remove('flipping');
    if (!animate || old === digit) {
      bottom.textContent = digit;
      return;
    }
    void card.el.offsetWidth; // restart the animation
    card.el.classList.add('flipping');
    clearTimeout(card.timer);
    card.timer = setTimeout(() => {
      bottom.textContent = digit;
      card.el.classList.remove('flipping');
    }, 520);
  }
}
