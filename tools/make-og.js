#!/usr/bin/env node
/* Генерирует og.png (1200x630) без внешних зависимостей: свой мини-растеризатор + zlib. */
'use strict';
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const W = 1200, H = 630;
const buf = Buffer.alloc(W * H * 3);

function px(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
}
function rect(x0, y0, w, h, r, g, b) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px(x, y, r, g, b);
}
function mix(a, b, t) { return Math.round(a + (b - a) * t); }

/* фон: тёмный градиент + жёлтое свечение справа сверху */
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = y / H;
    let r = mix(0x17, 0x0d, v), g = mix(0x18, 0x0e, v), b = mix(0x1c, 0x11, v);
    const dx = (x - W * 0.82) / (W * 0.42), dy = (y - H * 0.05) / (H * 0.55);
    const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));
    const k = glow * glow * 0.55;
    r = Math.min(255, r + 0xfb * k); g = Math.min(255, g + 0xd5 * k); b = Math.min(255, b + 0x06 * k * 0.4);
    px(x, y, r | 0, g | 0, b | 0);
  }
}

/* мини-шрифт 5x7 */
const FONT = {
  'A': '01110,10001,10001,11111,10001,10001,10001',
  'C': '01110,10001,10000,10000,10000,10001,01110',
  'D': '11110,10001,10001,10001,10001,10001,11110',
  'E': '11111,10000,10000,11110,10000,10000,11111',
  'F': '11111,10000,10000,11110,10000,10000,10000',
  'G': '01110,10001,10000,10111,10001,10001,01111',
  'I': '11111,00100,00100,00100,00100,00100,11111',
  'K': '10001,10010,10100,11000,10100,10010,10001',
  'L': '10000,10000,10000,10000,10000,10000,11111',
  'N': '10001,11001,11001,10101,10011,10011,10001',
  'O': '01110,10001,10001,10001,10001,10001,01110',
  'P': '11110,10001,10001,11110,10000,10000,10000',
  'R': '11110,10001,10001,11110,10100,10010,10001',
  'S': '01111,10000,10000,01110,00001,00001,11110',
  'T': '11111,00100,00100,00100,00100,00100,00100',
  'U': '10001,10001,10001,10001,10001,10001,01110',
  '2': '01110,10001,00001,00010,00100,01000,11111',
  '&': '01100,10010,10010,01100,10101,10010,01101',
  ' ': '00000,00000,00000,00000,00000,00000,00000'
};

function text(str, x0, y0, scale, r, g, b) {
  let x = x0;
  for (const ch of str.toUpperCase()) {
    const rows = (FONT[ch] || FONT[' ']).split(',');
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        if (row[rx] === '1') rect(x + rx * scale, y0 + ry * scale, scale, scale, r, g, b);
      }
    });
    x += 6 * scale;
  }
  return x;
}

/* логотип-шестиугольник */
function hexOutline(cx, cy, R, thick, r, g, b) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % 6];
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let s = 0; s <= steps; s++) {
      const x = x1 + (x2 - x1) * s / steps, y = y1 + (y2 - y1) * s / steps;
      rect(Math.round(x - thick / 2), Math.round(y - thick / 2), thick, thick, r, g, b);
    }
  }
}

const Y = [0xfb, 0xd5, 0x06];
hexOutline(986, 300, 148, 7, Y[0], Y[1], Y[2]);
/* шеврон внутри */
for (let i = 0; i < 92; i++) {
  const w = Math.round(i * 1.15);
  rect(986 - w, 300 - 46 + i, 22, 3, Y[0], Y[1], Y[2]);
  rect(986 + w - 22, 300 - 46 + i, 22, 3, Y[0], Y[1], Y[2]);
}
rect(986 - 74, 300 + 66, 148, 12, Y[0], Y[1], Y[2]);

text('STOCK2', 92, 196, 14, 0xf2, 0xf3, 0xf5);
text('GOLD & SKINS', 94, 330, 5, Y[0], Y[1], Y[2]);
text('FOR STANDOFF 2', 94, 386, 5, Y[0], Y[1], Y[2]);
rect(94, 460, 190, 5, 0x2a, 0x2c, 0x33);
text('TON PAYMENTS', 94, 494, 3, 0x9a, 0x9d, 0xa6);

/* PNG */
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
let TAB = null;
function crc32(b) {
  if (!TAB) {
    TAB = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TAB[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < b.length; i++) c = TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
const out = path.join(__dirname, '..', 'static', 'assets', 'img', 'og.png');
fs.writeFileSync(out, png);
console.log('og.png:', png.length, 'байт ->', out);
