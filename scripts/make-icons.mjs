// Generates public/icon/{16,32,48,128}.png: a dark page with text lines,
// one of them highlighted. No dependencies: rasterizes shapes and encodes PNG by hand.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
mkdirSync(outDir, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// Shapes in a 128-unit design space, painted in order.
const shapes = [
  { type: 'rrect', x: 6, y: 6, w: 116, h: 116, r: 26, color: hex('#2b2f3a') },
  { type: 'rrect', x: 22, y: 54, w: 84, h: 22, r: 5, color: hex('#ffd43b') },
  { type: 'rrect', x: 28, y: 32, w: 72, h: 9, r: 4.5, color: hex('#dee2e6') },
  { type: 'rrect', x: 28, y: 60.5, w: 72, h: 9, r: 4.5, color: hex('#2b2f3a') },
  { type: 'rrect', x: 28, y: 88, w: 48, h: 9, r: 4.5, color: hex('#dee2e6') },
];

function insideRRect(px, py, s) {
  const { x, y, w, h, r } = s;
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

function render(size) {
  const ss = 4; // supersampling per axis
  const px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < ss; sj++) {
        for (let si = 0; si < ss; si++) {
          const x = ((i + (si + 0.5) / ss) / size) * 128;
          const y = ((j + (sj + 0.5) / ss) / size) * 128;
          let c = null;
          for (const s of shapes) if (insideRRect(x, y, s)) c = s.color;
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 255;
          }
        }
      }
      const n = ss * ss;
      const k = (j * size + i) * 4;
      const cov = a / n;
      // Store un-premultiplied color.
      const filled = a / 255 || 1;
      px[k] = Math.round(r / filled);
      px[k + 1] = Math.round(g / filled);
      px[k + 2] = Math.round(b / filled);
      px[k + 3] = Math.round(cov);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `${size}.png`), encodePng(size, render(size)));
  console.log(`wrote icon/${size}.png`);
}
