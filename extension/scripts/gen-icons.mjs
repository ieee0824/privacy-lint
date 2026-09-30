// Generates the toolbar icons as PNGs (no image dependencies).
// Motif: a document with lines and a magnifier ring — "inspect before you submit".
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size, size);
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const BG = [37, 99, 235];
const PAPER = [255, 255, 255];
const INK = [148, 163, 184];
const RING = [15, 23, 42];

function inRoundRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(u, x0 + r), x1 - r);
  const cy = Math.min(Math.max(v, y0 + r), y1 - r);
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r && u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

function paperColor(u, v, px) {
  const thickness = Math.max(0.03, 0.7 / px);
  for (const lineY of [0.26, 0.38, 0.5]) {
    if (Math.abs(v - lineY) < thickness && u > 0.26 && u < 0.58) return [...INK, 255];
  }
  return [...PAPER, 255];
}

function sample(u, v, px) {
  const d = Math.hypot(u - 0.64, v - 0.64);
  const t = Math.max(0.07, 1.5 / px);
  if (d >= 0.17 && d <= 0.17 + t) return [...RING, 255];
  // Magnifier handle
  const along = (u - 0.64 + v - 0.64) / Math.SQRT2;
  const across = Math.abs(u - 0.64 - (v - 0.64)) / Math.SQRT2;
  if (along > 0.2 && along < 0.4 && across < t * 0.8) return [...RING, 255];
  if (d < 0.17) return [...PAPER, 235];
  if (inRoundRect(u, v, 0.18, 0.12, 0.66, 0.78, 0.05)) return paperColor(u, v, px);
  if (inRoundRect(u, v, 0, 0, 1, 1, 0.2)) return [...BG, 255];
  return [0, 0, 0, 0];
}

// 4x4 supersampling for smooth edges at small sizes.
function pixel(u, v, size) {
  const acc = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const s = sample(u + (i - 1.5) / (4 * size), v + (j - 1.5) / (4 * size), size);
      const a = s[3] / 255;
      acc[0] += s[0] * a;
      acc[1] += s[1] * a;
      acc[2] += s[2] * a;
      acc[3] += a;
    }
  const a = acc[3] / 16;
  return a === 0 ? [0, 0, 0, 0] : [acc[0] / acc[3], acc[1] / acc[3], acc[2] / acc[3], Math.round(a * 255)].map(Math.round);
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), png(size, pixel));
}
console.log("icons written");
