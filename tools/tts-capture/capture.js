(() => {
  const phrases = new Map();

  const ingest = (json) => {
    for (const p of (json && json.data) || []) {
      if (p.sound && p.sound.sound_file_url) {
        phrases.set(p.id, { id: p.id, text: p.phrase_text, url: p.sound.sound_file_url });
      }
    }
  };

  const isList = (u) => String(u).includes('/api/v1/tts/me?');

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    if (isList(u)) {
      this.addEventListener('load', () => {
        try {
          ingest(typeof this.response === 'string' ? JSON.parse(this.response) : this.response);
        } catch (e) {}
      });
    }
    return origOpen.call(this, m, u, ...rest);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      if (isList((args[0] && args[0].url) || args[0])) res.clone().json().then(ingest).catch(() => {});
    } catch (e) {}
    return res;
  };

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = ~0;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (~c) >>> 0;
  };

  const makeZip = (files) => {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);
      lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true);
      lh.setUint32(22, size, true);
      lh.setUint16(26, name.length, true);
      parts.push(lh, name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true);
      ch.setUint32(24, size, true);
      ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch, name);
      offset += 30 + name.length + size;
    }
    let csize = 0;
    central.forEach((p) => (csize += p.byteLength));
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  };

  const extOf = (bytes, type) => {
    const s = String.fromCharCode(...bytes.slice(0, 4));
    if (s === 'RIFF') return 'wav';
    if (s === 'OggS') return 'ogg';
    if (s.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
    if (type.includes('wav')) return 'wav';
    if (type.includes('mpeg')) return 'mp3';
    return 'bin';
  };

  const findInput = () => document.querySelector('[placeholder*="Enter your text"]');
  const findButton = () => {
    const matches = [...document.querySelectorAll('button,div,span,a')].filter(
      (e) => e.textContent.trim() === 'Generate It'
    );
    return matches[matches.length - 1];
  };

  const setText = (el, text) => {
    if ('value' in el) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
    } else {
      el.textContent = text;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const findRefresh = () =>
    [...document.querySelectorAll('button,div,span,a')].filter((e) => e.textContent.trim() === 'Refresh').pop();

  const norm = (t) => t.replace(/\s+/g, ' ').trim();

  const generate = async (text, timeoutMs) => {
    const input = findInput();
    const button = findButton();
    if (!input || !button) throw new Error('input or button not found');
    const before = new Set(phrases.keys());
    setText(input, text);
    await sleep(300);
    button.click();
    const start = Date.now();
    let lastRefresh = 0;
    for (;;) {
      for (const p of phrases.values()) {
        if (!before.has(p.id) && norm(p.text) === norm(text)) {
          const blob = await fetch(p.url).then((r) => r.blob());
          return blob;
        }
      }
      if (Date.now() - start > timeoutMs) throw new Error('timeout');
      if (Date.now() - lastRefresh > 3000) {
        lastRefresh = Date.now();
        const r = findRefresh();
        if (r) r.click();
      }
      await sleep(300);
    }
  };

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  let results = [];
  let part = 1;
  let running = false;

  const flush = async (status) => {
    if (!results.length) {
      status('nothing to save');
      return;
    }
    const files = [];
    const meta = [];
    for (const r of results) {
      files.push({ name: `wavs/${r.id}.${r.ext}`, data: r.bytes });
      meta.push(`${r.id}|${r.text}`);
    }
    files.push({ name: 'metadata.csv', data: new TextEncoder().encode(meta.join('\n') + '\n') });
    download(makeZip(files), `tts-capture-${String(part++).padStart(2, '0')}.zip`);
    results = [];
    status(`saved part ${part - 1}`);
  };

  const buildUI = () => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:2147483647;width:320px;background:#000;color:#fff;' +
      'border:1px solid #fff;padding:8px;font:12px monospace;box-sizing:border-box';
    box.innerHTML =
      '<textarea id="tc-lines" style="width:100%;height:120px;background:#000;color:#fff;border:1px solid #fff;' +
      'box-sizing:border-box;font:12px monospace;resize:vertical"></textarea>' +
      '<div style="display:flex;gap:6px;margin-top:6px;align-items:center">' +
      '<input id="tc-delay" type="number" value="4" min="1" style="width:44px;background:#000;color:#fff;border:1px solid #fff;font:12px monospace">' +
      '<button id="tc-go" style="background:#fff;color:#000;border:0;padding:4px 10px;font:12px monospace;cursor:pointer">start</button>' +
      '<button id="tc-save" style="background:#000;color:#fff;border:1px solid #fff;padding:4px 10px;font:12px monospace;cursor:pointer">save</button>' +
      '<span id="tc-status" style="margin-left:auto"></span></div>';
    document.body.appendChild(box);

    const $ = (id) => box.querySelector(id);
    const status = (s) => ($('#tc-status').textContent = s);

    $('#tc-save').onclick = () => flush(status);
    setInterval(() => {
      if (!running) status(`ready ${phrases.size}`);
    }, 1000);

    $('#tc-go').onclick = async () => {
      if (running) {
        running = false;
        return;
      }
      const lines = $('#tc-lines').value.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;
      running = true;
      $('#tc-go').textContent = 'stop';
      let n = 0;
      let failed = 0;
      for (const text of lines) {
        if (!running) break;
        let blob = null;
        for (let attempt = 0; attempt < 2 && !blob; attempt++) {
          try {
            blob = await generate(text, 60000);
          } catch (e) {
            await sleep(2000);
          }
        }
        if (blob) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          n++;
          results.push({ id: String(n).padStart(5, '0'), text, bytes, ext: extOf(bytes, blob.type) });
          if (results.length >= 50) await flush(status);
        } else {
          failed++;
        }
        status(`${n}/${lines.length}${failed ? ` fail ${failed}` : ''}`);
        await sleep(Math.max(1, Number($('#tc-delay').value)) * 1000);
      }
      await flush(status);
      running = false;
      $('#tc-go').textContent = 'start';
    };
  };

  if (document.body) buildUI();
  else document.addEventListener('DOMContentLoaded', buildUI);
})();
