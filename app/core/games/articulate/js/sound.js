/** Small synthesized sound effects (no files): joins, guesses, ticks, round ends, the win. */
const Sound = (() => {
  let ctx = null;
  let master = null;

  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // One note: type, frequency (Hz), start offset (s), length (s), volume, optional slide to frequency
  function note(type, freq, at, len, vol = 0.5, slideTo = null) {
    const a = audio();
    const t = a.currentTime + at;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + len);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + len + 0.02);
  }

  const sounds = {
    join: () => { note('square', 520, 0, 0.08, 0.25); note('square', 780, 0.07, 0.12, 0.25); },
    leave: () => { note('square', 520, 0, 0.08, 0.2); note('square', 340, 0.07, 0.14, 0.2); },
    guess: () => note('triangle', 300, 0, 0.07, 0.25, 220),
    correct: () => { note('square', 660, 0, 0.09, 0.3); note('square', 880, 0.08, 0.09, 0.3); note('square', 1320, 0.16, 0.2, 0.3); },
    pick: () => { note('triangle', 440, 0, 0.12, 0.4); note('triangle', 660, 0.1, 0.18, 0.4); },
    start: () => [523, 659, 784, 1047].forEach((f, i) => note('square', f, i * 0.09, 0.16, 0.28)),
    tick: () => note('square', 1200, 0, 0.03, 0.15),
    hint: () => note('triangle', 990, 0, 0.12, 0.3),
    end: () => { note('sawtooth', 392, 0, 0.18, 0.22); note('sawtooth', 330, 0.16, 0.18, 0.22); note('sawtooth', 262, 0.32, 0.4, 0.22); },
    allGuessed: () => [784, 988, 1175, 1568].forEach((f, i) => note('square', f, i * 0.07, 0.14, 0.25)),
    win: () => {
      [523, 523, 523, 659, 784, 659, 784, 1047].forEach((f, i) => note('square', f, [0, 0.12, 0.24, 0.36, 0.6, 0.84, 0.96, 1.08][i], i === 7 ? 0.6 : 0.14, 0.3));
      [262, 330, 392].forEach((f) => note('triangle', f, 1.08, 0.7, 0.25));
    },
  };

  return {
    play(name) {
      try { sounds[name] && sounds[name](); } catch { /* audio blocked */ }
    },
    unlock: audio,
  };
})();
