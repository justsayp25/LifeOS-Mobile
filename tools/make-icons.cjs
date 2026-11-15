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
// R.E.N.E.E. mark: black disc, grey ring, white centre dot (the circle in the bottom nav), 4x4 supersampling.
// layers: disc (colour), ring (colour), dot (colour); each layer composited over the last. bg = flat square colour or null.
function draw(size, { R, ring, dot, bg, disc, rc, dc }) {
  const buf = Buffer.alloc(size * size * 4), c = size / 2, SS = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const d = Math.hypot(x + (sx + 0.5) / SS - c, y + (sy + 0.5) / SS - c);
      let px = bg ? [...bg, 1] : [0, 0, 0, 0];
      if (disc && d <= R) px = [...disc, 1];
      if (rc && d <= R && d >= R - ring) px = [...rc, 1];
      if (dc && d <= dot) px = [...dc, 1];
      for (let k = 0; k < 4; k++) acc[k] += px[k];
    }
    const n = SS * SS, i = (y * size + x) * 4, a = acc[3] / n;
    for (let k = 0; k < 3; k++) buf[i + k] = a ? Math.round(acc[k] / n / a) : 0;
    buf[i + 3] = Math.round(a * 255);
  }
  return png(size, size, buf);
}
const out = path.join(__dirname, '..', 'assets'); fs.mkdirSync(out, { recursive: true });
// Plain black with a white dot, no outline. The adaptive icon gets its black from app.json (backgroundColor), so its foreground is the dot only.
const BG = [0, 0, 0], DOT = [245, 245, 245];
fs.writeFileSync(path.join(out, 'icon.png'), draw(1024, { R: 0, ring: 0, dot: 150, bg: BG, disc: null, rc: null, dc: DOT }));
fs.writeFileSync(path.join(out, 'android-icon-foreground.png'), draw(1024, { R: 0, ring: 0, dot: 120, bg: null, disc: null, rc: null, dc: DOT }));
fs.writeFileSync(path.join(out, 'android-icon-monochrome.png'), draw(1024, { R: 0, ring: 0, dot: 120, bg: null, disc: null, rc: null, dc: [255, 255, 255] }));
fs.writeFileSync(path.join(out, 'splash-icon.png'), draw(512, { R: 0, ring: 0, dot: 60, bg: null, disc: null, rc: null, dc: DOT }));
console.log('icons written to', out);
