// Draws the LifeOS app icons (the ring-and-plus from the design zip, reference-ui/icon-512.png) as PNG files in assets/. No dependencies.
// Run: node tools/make-icons.cjs
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
// ring + plus, anti-aliased with 4x4 supersampling
function draw(size, { r, stroke, half, fg, bg }) {
  const buf = Buffer.alloc(size * size * 4), c = size / 2, sw = stroke / 2, SS = 4;
  const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let cov = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS - c, py = y + (sy + 0.5) / SS - c;
      const ring = Math.abs(Math.hypot(px, py) - r) <= sw;
      const plus = segDist(px, py, -half, 0, half, 0) <= sw || segDist(px, py, 0, -half, 0, half) <= sw;
      if (ring || plus) cov++;
    }
    const a = cov / (SS * SS), i = (y * size + x) * 4;
    const bgA = bg ? 1 : 0;
    const outA = a + bgA * (1 - a);
    const ch = (f, b) => (outA === 0 ? 0 : Math.round((f * a + (b || 0) * bgA * (1 - a)) / outA));
    buf[i] = ch(fg[0], bg && bg[0]); buf[i + 1] = ch(fg[1], bg && bg[1]); buf[i + 2] = ch(fg[2], bg && bg[2]); buf[i + 3] = Math.round(outA * 255);
  }
  return png(size, size, buf);
}
const out = path.join(__dirname, '..', 'assets'); fs.mkdirSync(out, { recursive: true });
const FG = [237, 237, 237], BG = [18, 18, 18];
fs.writeFileSync(path.join(out, 'icon.png'), draw(1024, { r: 300, stroke: 44, half: 212, fg: FG, bg: BG }));
// Android adaptive icon: the system adds the #121212 background, so keep the mark inside the centre 66%
fs.writeFileSync(path.join(out, 'android-icon-foreground.png'), draw(1024, { r: 230, stroke: 34, half: 163, fg: FG, bg: null }));
fs.writeFileSync(path.join(out, 'android-icon-monochrome.png'), draw(1024, { r: 230, stroke: 34, half: 163, fg: [255, 255, 255], bg: null }));
fs.writeFileSync(path.join(out, 'splash-icon.png'), draw(512, { r: 150, stroke: 22, half: 106, fg: FG, bg: null }));
console.log('icons written to', out);
