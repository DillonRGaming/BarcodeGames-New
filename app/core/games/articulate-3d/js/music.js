/**
 * Background music: the café track on a loop. It fades in at the start, fades out just before the end of each pass
 * and fades back in as it starts over.
 */

const VOLUME = 0.5;
const FADE_IN = 4; // seconds
const LOOP_FADE = 2.5; // seconds of fade out at the end of a pass and back in at the start of the next

export function startMusic(src = 'sound/cafe-music.mp3') {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  let buffer = null;

  function pass(fadeIn) {
    const now = ctx.currentTime;
    const end = now + buffer.duration;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(gain);
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(VOLUME, now + fadeIn);
    gain.gain.setValueAtTime(VOLUME, end - LOOP_FADE);
    gain.gain.linearRampToValueAtTime(0, end);
    node.onended = () => pass(LOOP_FADE);
    node.start(now);
  }

  fetch(src).then((r) => r.arrayBuffer()).then((data) => ctx.decodeAudioData(data)).then((b) => {
    buffer = b;
    pass(FADE_IN);
  });
  // in case the window started without being allowed to play sound
  window.addEventListener('pointerdown', () => ctx.resume(), { once: true });
}

const WIND_VOLUME = 0.45; // at full height: kept subtle
const WIND_FADE_IN = 0.15; // seconds

/** wind, louder the higher the camera is; returns setHeight(0..1), to call every frame */
export function startWind(src = 'sound/wind.mp3') {
  const ctx = new AudioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  let ready = false, start = 0;
  fetch(src).then((r) => r.arrayBuffer()).then((data) => ctx.decodeAudioData(data)).then((b) => {
    const node = ctx.createBufferSource();
    node.buffer = b;
    node.loop = true;
    node.connect(gain);
    node.start();
    start = ctx.currentTime;
    ready = true;
    // the game opens up in the sky: full wind straight away, before the first frame is drawn
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(WIND_VOLUME, start + WIND_FADE_IN);
  });
  window.addEventListener('pointerdown', () => ctx.resume(), { once: true });
  return (height) => {
    if (!ready || ctx.currentTime < start + WIND_FADE_IN) return;
    const fadeIn = Math.min(1, (ctx.currentTime - start) / WIND_FADE_IN);
    const h = Math.max(0, Math.min(1, height));
    gain.gain.setTargetAtTime(WIND_VOLUME * fadeIn * Math.sqrt(h), ctx.currentTime, 0.08);
  };
}
