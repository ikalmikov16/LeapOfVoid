// App icon generator: reproduces the home-screen orbit vignette (flat purple
// planet, head-on orbit ring, white ball with cyan glow) at 1024×1024 using
// the exact game palette. Output is RGB with no alpha channel — the App Store
// rejects icons with transparency. Regenerate with `bun run icon`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { COLORS } from '../src/game/constants';

const SIZE = 1024;
const CX = SIZE / 2;
const CY = SIZE / 2;

// HomeScreen vignette geometry (planet 20 / orbit 44 / ball 5), scaled up.
const ORBIT_R = 340;
const S = ORBIT_R / 44;
const PLANET_R = 20 * S;
const BALL_R = 5 * S;
const BALL_ANGLE = (-50 * Math.PI) / 180; // upper right, like mid-orbit

const PLANET_COLOR = hexToRgb('#9B5DE5'); // the vignette's purple planet
const RING_OPACITY = 0.45; // home screen uses 0.3; nudged up to read at 60px
const RING_STROKE = 16;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Same PRNG as the home-screen starfield.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Framebuffer: float RGB, blended back-to-front like the Skia canvas.
const buf = new Float64Array(SIZE * SIZE * 3);

function blendPixel(x: number, y: number, color: Rgb, alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 3;
  buf[i] += (color[0] - buf[i]) * alpha;
  buf[i + 1] += (color[1] - buf[i + 1]) * alpha;
  buf[i + 2] += (color[2] - buf[i + 2]) * alpha;
}

/** Anti-aliased coverage of a filled disc at distance d from its center. */
function discCoverage(d: number, r: number): number {
  return Math.min(1, Math.max(0, (r + 0.75 - d) / 1.5));
}

/**
 * Blurred-disc profile approximating Skia's normal-mode BlurMask: a logistic
 * edge (~erf of a gaussian-blurred boundary) that softens both inward and
 * outward from radius r, rather than staying opaque to the rim.
 */
function glowAlpha(d: number, r: number, sigma: number): number {
  return 1 / (1 + Math.exp((1.7 * (d - r)) / sigma));
}

// --- Background: vertical zone gradient with the bgShader's hash dither ---
const top = hexToRgb(COLORS.bgTop);
const bottom = hexToRgb(COLORS.bgBottom);
for (let y = 0; y < SIZE; y++) {
  const t = y / SIZE;
  for (let x = 0; x < SIZE; x++) {
    const n =
      ((Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1 + 1) % 1 - 0.5;
    const i = (y * SIZE + x) * 3;
    for (let c = 0; c < 3; c++) {
      buf[i + c] = top[c] + (bottom[c] - top[c]) * t + n * 1.5;
    }
  }
}

// --- Starfield (soft gaussian dots, deterministic like the home screen) ---
const starDim = hexToRgb(COLORS.starDim);
const starBright = hexToRgb(COLORS.starBright);
const rand = mulberry32(2026);
for (let s = 0; s < 36; s++) {
  const sx = rand() * SIZE;
  const sy = rand() * SIZE;
  const bright = s % 3 === 0;
  const sigma = bright ? 4.5 : 3;
  const opacity = bright ? 0.8 : 0.5;
  const color = bright ? starBright : starDim;
  const reach = Math.ceil(sigma * 3);
  for (let y = Math.floor(sy) - reach; y <= sy + reach; y++) {
    for (let x = Math.floor(sx) - reach; x <= sx + reach; x++) {
      const d2 = (x - sx) * (x - sx) + (y - sy) * (y - sy);
      blendPixel(x, y, color, opacity * Math.exp(-d2 / (2 * sigma * sigma)));
    }
  }
}

// --- Vignette layers, same draw order as HomeScreen.tsx ---
const ballX = CX + Math.cos(BALL_ANGLE) * ORBIT_R;
const ballY = CY + Math.sin(BALL_ANGLE) * ORBIT_R;
const ballColor = hexToRgb(COLORS.ball);
const ballGlow = hexToRgb(COLORS.ballGlow);

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dPlanet = Math.hypot(x - CX, y - CY);
    const dBall = Math.hypot(x - ballX, y - ballY);

    // Planet halo (blurred 1.3R disc at 0.3, like the BlurMask circle)
    blendPixel(x, y, PLANET_COLOR, 0.3 * glowAlpha(dPlanet, PLANET_R * 1.3, 12 * S));
    // Orbit ring (head-on, anti-aliased stroke)
    const ringCov = Math.min(
      1,
      Math.max(0, (RING_STROKE / 2 + 0.75 - Math.abs(dPlanet - ORBIT_R)) / 1.5),
    );
    blendPixel(x, y, PLANET_COLOR, RING_OPACITY * ringCov);
    // Planet body
    blendPixel(x, y, PLANET_COLOR, discCoverage(dPlanet, PLANET_R));
    // Ball glow (2.2R cyan disc at 0.35 with blur), then the ball
    blendPixel(x, y, ballGlow, 0.35 * glowAlpha(dBall, BALL_R * 2.2, 7 * S));
    blendPixel(x, y, ballColor, discCoverage(dBall, BALL_R));
  }
}

// --- Encode as PNG (8-bit RGB, color type 2 — no alpha channel) ---
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB

const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
for (let y = 0; y < SIZE; y++) {
  const row = y * (1 + SIZE * 3);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 3;
    for (let c = 0; c < 3; c++) {
      raw[row + 1 + x * 3 + c] = Math.round(Math.min(255, Math.max(0, buf[i + c])));
    }
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', new Uint8Array(0)),
]);

const OUT = join(import.meta.dir, '..', 'assets', 'icon.png');
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB)`);
