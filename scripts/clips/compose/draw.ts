// The end card's drawing — the approved chat mockup's Canvas 2D code, ported
// as pure functions of (context, t, look), where t is seconds since the warp
// began. Coordinates are the 1080×1920 output pixels. Browser-only (it runs
// inside the Remotion composition), but it holds no state: stars and
// particles are seeded, so every frame is the same in any render tab.
// Design: plans/clip-composer.md §3.1.

import { BEATS, WARP_S } from './endCard';

export const W = 1080;
export const H = 1920;
/** The warp's vanishing point: the gameplay zooms around it, stars streak from it. */
export const VP: readonly [number, number] = [540, 860];

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
const ICON_PURPLE = '#9B5DE5'; // the app icon's planet (scripts/generate-icon.ts)
const STAR_DIM = '#8489B8';
const STAR_BRIGHT = '#C9D1F5';

export interface CardLook {
  top: string;
  bottom: string;
  accent: string;
  line: string;
}

type Ctx = CanvasRenderingContext2D;
type Pt = [number, number];

// --- seeded scenery (mulberry32(2026), like the home screen's starfield) ---

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
const rand = mulberry32(2026);
const STARS = Array.from({ length: 110 }, () => ({ x: rand() * W, y: rand() * H, bright: rand() < 0.33 }));
const PARTICLES = Array.from({ length: 16 }, (_, i) => ({
  angle: (i / 16) * Math.PI * 2 + rand() * 0.3,
  speed: 200 + rand() * 260,
  r: 6 + rand() * 6,
}));

// --- easing ---

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0→1 progress of t through [a, b]. */
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const easeIn = (u: number) => u * u;
/** Ease-out with a small overshoot (a "slam" that settles). */
const easeBack = (u: number) => {
  const c1 = 1.2;
  return 1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};

// --- primitives ---

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

function glow(c: Ctx, x: number, y: number, r: number, color: string, a: number): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function planet(c: Ctx, x: number, y: number, r: number, ring: number, alpha: number): void {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha = alpha;
  glow(c, x, y, r * 2.1, ICON_PURPLE, 0.35);
  c.globalAlpha = alpha * 0.35;
  c.strokeStyle = ICON_PURPLE;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x, y, ring, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = alpha;
  c.fillStyle = ICON_PURPLE;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A ship (white core, heat glow) with a tapering comet trail through `trail` (oldest first). */
function ship(
  c: Ctx,
  at: Pt,
  color: string,
  trail: Pt[],
  { alpha = 1, r = 13, trailAlpha = 0.6, glowAlpha = 0.55 } = {},
): void {
  if (alpha <= 0) return;
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = color;
  const pts = [...trail, at];
  for (let i = 1; i < pts.length; i++) {
    const u = i / pts.length;
    c.globalAlpha = alpha * u * trailAlpha;
    c.lineWidth = ((4 + 18 * u) * r) / 13;
    c.beginPath();
    c.moveTo(pts[i - 1][0], pts[i - 1][1]);
    c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
  }
  c.globalAlpha = alpha;
  glow(c, at[0], at[1], r * 3.1, color, glowAlpha);
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(at[0], at[1], r, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** Centred text with manual tracking (px between glyphs). */
function text(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  tracking: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.font = `${weight} ${size}px ${FONT}`;
  c.fillStyle = color;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const glyphs = [...s];
  const widths = glyphs.map((g) => c.measureText(g).width);
  const total = widths.reduce((p, q) => p + q, 0) + tracking * (glyphs.length - 1);
  let px = x - total / 2;
  glyphs.forEach((g, i) => {
    c.fillText(g, px, y);
    px += widths[i] + tracking;
  });
  c.restore();
}

// --- background: the zone gradient + stars that streak during the warp ---

/**
 * The zone gradient, dithered with ±0.75/255 of hash noise like the game's
 * background shader (src/rendering/bgShader.ts): the palettes are only a few
 * 8-bit steps apart and would band in H.264 otherwise.
 */
export function makeBackdrop(top: string, bottom: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(W, H);
  const a = parseInt(top.slice(1), 16);
  const b = parseInt(bottom.slice(1), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  for (let y = 0; y < H; y++) {
    const f = y / (H - 1);
    const r = ch(a, 16) + (ch(b, 16) - ch(a, 16)) * f;
    const g = ch(a, 8) + (ch(b, 8) - ch(a, 8)) * f;
    const bl = ch(a, 0) + (ch(b, 0) - ch(a, 0)) * f;
    for (let x = 0; x < W; x++) {
      let h = (x + y * W) | 0;
      h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
      h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
      h ^= h >>> 16;
      const n = ((h >>> 0) / 4294967296 - 0.5) * 1.5;
      const i = (y * W + x) * 4;
      img.data[i] = Math.round(r + n);
      img.data[i + 1] = Math.round(g + n);
      img.data[i + 2] = Math.round(bl + n);
      img.data[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

/** Streak length (0 = points): builds through the warp, then slows back to points. */
function streak(t: number): number {
  if (t < BEATS.arrive) return 1.4 * easeIn(seg(t, 0, WARP_S));
  return 1.4 * (1 - easeOut(seg(t, BEATS.arrive, BEATS.arrive + 0.75)));
}

export function drawBackground(c: Ctx, t: number, backdrop: CanvasImageSource): void {
  c.drawImage(backdrop, 0, 0);
  const s = streak(t);
  c.lineCap = 'round';
  for (const star of STARS) {
    const color = star.bright ? STAR_BRIGHT : STAR_DIM;
    c.globalAlpha = star.bright ? 0.8 : 0.45;
    if (s > 0.02) {
      const L = s * 0.5;
      c.strokeStyle = color;
      c.lineWidth = star.bright ? 6 : 4;
      c.beginPath();
      c.moveTo(star.x, star.y);
      c.lineTo(star.x + (star.x - VP[0]) * L, star.y + (star.y - VP[1]) * L);
      c.stroke();
    } else {
      c.fillStyle = color;
      c.beginPath();
      c.arc(star.x, star.y, star.bright ? 3.4 : 2.4, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.globalAlpha = 1;
}

/** The gameplay layer during the warp: zooms toward the camera and fades. */
export function warpVideo(t: number): { scale: number; opacity: number } {
  if (t < 0) return { scale: 1, opacity: 1 };
  const u = easeIn(seg(t, 0, WARP_S));
  return { scale: 1 + 1.8 * u, opacity: 1 - u };
}

// --- foreground: planet, ship, title, call to action ---

const PLANET: Pt = [540, 520];
const PLANET_R = 96;
const ORBIT_R = 210; // icon proportions: planet 20 / orbit 44
const LAP_S = 2.4;
const OMEGA = (2 * Math.PI) / LAP_S;
/** Braking: the ship arrives at ~6× orbit speed and slows to exactly orbit speed at capture. */
const BRAKE = 30.7;

/** How far the planet has come out of the vanishing point (0 = not yet, 1 = in place). */
function emerge(t: number): number {
  return t < BEATS.arrive ? 0 : 0.15 + 0.85 * easeOut(seg(t, BEATS.arrive, BEATS.arrive + 0.5));
}

/** The ship: straight in along the orbit's top tangent, then clockwise around it. */
function shipAt(t: number): Pt {
  const tc = BEATS.capture;
  if (t < tc) {
    const u = tc - t;
    return [PLANET[0] - OMEGA * ORBIT_R * (u + (BRAKE * u * u * u) / 3), PLANET[1] - ORBIT_R];
  }
  const a = -Math.PI / 2 + OMEGA * (t - tc);
  return [PLANET[0] + ORBIT_R * Math.cos(a), PLANET[1] + ORBIT_R * Math.sin(a)];
}

function drawArrival(c: Ctx, t: number, look: CardLook): void {
  const since = t - BEATS.capture;
  const captured = since >= 0;
  const s = emerge(t);
  if (s > 0) {
    const x = VP[0] + (PLANET[0] - VP[0]) * s;
    const y = VP[1] + (PLANET[1] - VP[1]) * s;
    const pulse = captured ? 1 + 0.12 * (1 - easeOut(seg(since, 0, 0.35))) : 1;
    planet(c, x, y, PLANET_R * s * pulse, ORBIT_R * s, seg(t, BEATS.arrive, BEATS.arrive + 0.15));
  }
  if (captured) {
    // The orbit lights up on capture, then stays as the white "current orbit" ring.
    const f = 1 - seg(since, 0, 0.6);
    c.globalAlpha = 0.18 + 0.6 * f;
    c.strokeStyle = '#fff';
    c.lineWidth = 4 + 8 * f;
    c.beginPath();
    c.arc(PLANET[0], PLANET[1], ORBIT_R, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }
  const trail: Pt[] = [];
  for (let i = 20; i > 0; i--) trail.push(shipAt(t - i * 0.012));
  const at = shipAt(t);
  if (at[0] > -60) ship(c, at, look.accent, trail);
  if (captured && since < 0.8) {
    const q = since / 0.8;
    PARTICLES.forEach((p, i) => {
      const d = p.speed * easeOut(q) * 0.55;
      c.globalAlpha = 1 - q;
      c.fillStyle = i % 2 ? ICON_PURPLE : look.accent;
      c.beginPath();
      c.arc(
        PLANET[0] + Math.cos(p.angle) * d,
        PLANET[1] - ORBIT_R + Math.sin(p.angle) * d,
        p.r * (1 - q * 0.5),
        0,
        Math.PI * 2,
      );
      c.fill();
    });
    c.globalAlpha = 1;
  }
  const flash = seg(t, BEATS.arrive, BEATS.arrive + 0.3);
  if (t >= BEATS.arrive && flash < 1) {
    c.fillStyle = rgba(look.accent, 0.5 * (1 - flash));
    c.fillRect(0, 0, W, H);
  }
}

function drawTitle(c: Ctx, t: number, look: CardLook): void {
  const t1 = BEATS.title;
  const a1 = seg(t, t1, t1 + 0.3);
  text(c, 'LEAP OF', 540, 905 + 24 * (1 - easeOut(a1)), 54, 700, 26, '#fff', 0.72 * a1);
  const a2 = seg(t, t1 + 0.15, t1 + 0.5);
  if (a2 > 0) {
    glow(c, 540, 1035, 380, look.accent, 0.3 * (1 - seg(t, t1 + 0.2, t1 + 0.95)));
    c.save();
    c.translate(540, 1035);
    const scale = 1.35 - 0.35 * easeBack(a2);
    c.scale(scale, scale);
    text(c, 'VOID', 0, 0, 180, 900, 34, '#fff', seg(t, t1 + 0.15, t1 + 0.25));
    c.restore();
  }
  const a3 = seg(t, BEATS.line, BEATS.line + 0.25);
  text(c, look.line, 540, 1160 + 16 * (1 - easeOut(a3)), 54, 800, 10, look.accent, a3);
}

// The call to action: a pill the spark traces, then keeps orbiting. Plain
// text — Apple's rules keep "App Store" in standard type (plan §3.3).
const PILL = { w: 440, h: 150, cy: 1305 };
const PILL_R = PILL.h / 2;
const PILL_STRAIGHT = PILL.w - 2 * PILL_R;
const PILL_PERIMETER = 2 * PILL_STRAIGHT + 2 * Math.PI * PILL_R;

/** The point `d` px clockwise along the pill's outline from its top centre. */
function pillPoint(d: number): Pt {
  d = ((d % PILL_PERIMETER) + PILL_PERIMETER) % PILL_PERIMETER;
  const top = PILL.cy - PILL.h / 2;
  const bottom = PILL.cy + PILL.h / 2;
  const right = 540 + PILL_STRAIGHT / 2;
  const left = 540 - PILL_STRAIGHT / 2;
  const arc = Math.PI * PILL_R;
  if (d < PILL_STRAIGHT / 2) return [540 + d, top];
  d -= PILL_STRAIGHT / 2;
  if (d < arc) {
    const a = -Math.PI / 2 + d / PILL_R;
    return [right + PILL_R * Math.cos(a), PILL.cy + PILL_R * Math.sin(a)];
  }
  d -= arc;
  if (d < PILL_STRAIGHT) return [right - d, bottom];
  d -= PILL_STRAIGHT;
  if (d < arc) {
    const a = Math.PI / 2 + d / PILL_R;
    return [left + PILL_R * Math.cos(a), PILL.cy + PILL_R * Math.sin(a)];
  }
  d -= arc;
  return [left + d, top];
}

/** Distance the spark has travelled: a decelerating trace that hands off to a steady lap. */
function sparkDistance(t: number): number {
  const trace = 0.55;
  const lap = PILL_PERIMETER / 2.8;
  const u = t - BEATS.cta;
  if (u <= 0) return 0;
  if (u < trace) return lap * u + (PILL_PERIMETER - lap * trace) * easeOut(u / trace);
  return PILL_PERIMETER + lap * (u - trace);
}

function drawCallToAction(c: Ctx, t: number, look: CardLook): void {
  if (t < BEATS.cta) return;
  const d = sparkDistance(t);
  const drawn = Math.min(d, PILL_PERIMETER);
  const fill = seg(t, BEATS.cta + 0.45, BEATS.cta + 0.8);
  if (fill > 0) {
    c.save();
    roundRect(c, 540 - PILL.w / 2, PILL.cy - PILL.h / 2, PILL.w, PILL.h, PILL_R);
    c.globalAlpha = 0.035 * fill;
    c.fillStyle = '#fff';
    c.fill();
    c.restore();
  }
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  const n = Math.max(2, Math.ceil(drawn / 8));
  for (let i = 0; i <= n; i++) {
    const p = pillPoint((drawn * i) / n);
    if (i === 0) c.moveTo(p[0], p[1]);
    else c.lineTo(p[0], p[1]);
  }
  c.globalAlpha = 0.07;
  c.strokeStyle = look.accent;
  c.lineWidth = 14;
  c.stroke();
  c.globalAlpha = 0.32;
  c.strokeStyle = '#fff';
  c.lineWidth = 3;
  c.stroke();
  c.restore();
  const trail: Pt[] = [];
  for (let i = 12; i > 0; i--) if (d - i * 13 >= 0) trail.push(pillPoint(d - i * 13));
  ship(c, pillPoint(d), look.accent, trail, { alpha: 0.8, r: 6.5, trailAlpha: 0.4, glowAlpha: 0.35 });
  const a = seg(t, BEATS.cta + 0.2, BEATS.cta + 0.45);
  text(c, 'Download from the', 540, PILL.cy - 30, 31, 500, 0, '#fff', 0.55 * a);
  text(c, 'App Store', 540, PILL.cy + 20, 58, 600, 0, '#fff', 0.85 * a);
}

export function drawForeground(c: Ctx, t: number, look: CardLook): void {
  if (t < 0) return;
  drawArrival(c, t, look);
  drawTitle(c, t, look);
  drawCallToAction(c, t, look);
}
