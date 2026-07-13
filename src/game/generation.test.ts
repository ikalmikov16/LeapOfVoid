import { describe, expect, test } from 'bun:test';
import { BALL_RADIUS, BAND_MIN, MAX_PLANETS, PLANET_GAP, RING_JITTER_MAX } from './constants';
import { captureBandWidth, earlyRingBoost } from './difficulty';
import { createInitialState } from './engine';
import { updatePlanetWindow } from './generation';
import { closestApproachOnSegment } from './geometry';
import type { Planet } from './types';

const WIDTH = 390;
const HEIGHT = 844;

describe('procedural generation', () => {
  test('same seed generates the same chain; different seeds differ', () => {
    const a = createInitialState(WIDTH, HEIGHT, 42);
    const b = createInitialState(WIDTH, HEIGHT, 42);
    const c = createInitialState(WIDTH, HEIGHT, 43);
    expect(JSON.stringify(a.planets)).toBe(JSON.stringify(b.planets));
    expect(JSON.stringify(a.planets)).not.toBe(JSON.stringify(c.planets));
  });

  test('initial window fills ahead of the camera', () => {
    const s = createInitialState(WIDTH, HEIGHT, 7);
    expect(s.planets.length).toBeGreaterThanOrEqual(4);
    // Topmost planet reaches past the generate-ahead line.
    const top = s.planets[s.planets.length - 1];
    expect(top.center.y).toBeLessThanOrEqual(s.cameraY - HEIGHT * 1.5);
  });

  test('invariants hold across a long climb (multiple seeds)', () => {
    for (const seed of [1, 7, 99, 12345]) {
      const s = createInitialState(WIDTH, HEIGHT, seed);
      let violations = 0;
      const complain = (ok: boolean) => {
        if (!ok) violations++;
      };

      for (let iter = 0; iter < 300; iter++) {
        s.cameraY -= 400;
        updatePlanetWindow(s);
        const ps = s.planets;

        complain(ps.length <= MAX_PLANETS);
        for (let i = 0; i < ps.length; i++) {
          const p = ps[i];
          // Ring fully on screen horizontally.
          complain(p.center.x - p.ringRadius >= 0);
          complain(p.center.x + p.ringRadius <= WIDTH);
          // Ring separation, pairwise.
          for (let j = i + 1; j < ps.length; j++) {
            const q = ps[j];
            const d = Math.hypot(p.center.x - q.center.x, p.center.y - q.center.y);
            complain(d >= p.ringRadius + q.ringRadius + PLANET_GAP - 1e-6);
          }
        }
        // Consecutive planets: always climbing, corridor clear of other bodies.
        for (let i = 0; i + 1 < ps.length; i++) {
          const a = ps[i];
          const b = ps[i + 1];
          if (b.id !== a.id + 1) continue; // pruning can leave a gap after the current planet
          complain(b.center.y < a.center.y);
          for (const q of ps) {
            if (q.id === a.id || q.id === b.id) continue;
            const app = closestApproachOnSegment(a.center, b.center, q.center);
            complain(app.distance > q.radius + BALL_RADIUS - 1e-6);
          }
        }
      }

      expect(violations).toBe(0);
      // The climb actually generated a deep chain.
      expect(s.nextPlanetId).toBeGreaterThan(200);
    }
  });

  test('ring sizes vary between planets and respect the band floor', () => {
    const s = createInitialState(WIDTH, HEIGHT, 7);
    const bands = new Set<number>();
    let giants = 0;
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      s.cameraY -= 400;
      updatePlanetWindow(s);
      for (const p of s.planets) {
        const band = p.ringRadius - p.radius;
        bands.add(Math.round(band * 10));
        expect(band).toBeGreaterThanOrEqual(BAND_MIN - 1e-6);
        if (p.id > seen) {
          seen = p.id;
          // Anything past the max non-giant jitter must be a giant roll.
          const nonGiantMax = captureBandWidth(p.id) * earlyRingBoost(p.id) * RING_JITTER_MAX;
          if (band > nonGiantMax + 1e-6) giants++;
        }
      }
    }
    expect(bands.size).toBeGreaterThan(10); // genuinely varied, not quantized
    expect(giants).toBeGreaterThan(0); // the occasional big one exists
  });

  test('the chain sweeps side to side, not a near-vertical ladder', () => {
    for (const seed of [3, 21, 777]) {
      const s = createInitialState(WIDTH, HEIGHT, seed);
      const xById = new Map<number, number>();
      for (const p of s.planets) xById.set(p.id, p.center.x);
      for (let i = 0; i < 100; i++) {
        s.cameraY -= 400;
        updatePlanetWindow(s);
        for (const p of s.planets) xById.set(p.id, p.center.x);
      }

      const mid = WIDTH / 2;
      let pairs = 0;
      let crossings = 0;
      let bigSwings = 0;
      for (let id = 0; xById.has(id) && xById.has(id + 1); id++) {
        const a = xById.get(id)!;
        const b = xById.get(id + 1)!;
        pairs++;
        if ((a - mid) * (b - mid) < 0) crossings++;
        if (Math.abs(b - a) > WIDTH * 0.3) bigSwings++;
      }

      expect(pairs).toBeGreaterThan(100);
      // A healthy share of hops lands on the other half of the screen...
      expect(crossings / pairs).toBeGreaterThanOrEqual(0.25);
      // ...and genuinely long side-to-side swings actually occur.
      expect(bigSwings / pairs).toBeGreaterThanOrEqual(0.05);
    }
  });

  test('pruning drops planets far below but never the current one', () => {
    const s = createInitialState(WIDTH, HEIGHT, 7);
    const before: Planet[] = s.planets;
    // Climb ~5000px the way real play does: a bit per frame.
    for (let i = 0; i < 13; i++) {
      s.cameraY -= 400;
      updatePlanetWindow(s);
    }
    expect(s.planets).not.toBe(before); // replaced, not mutated
    expect(before.length).toBeGreaterThan(0); // old array untouched
    const ids = s.planets.map((p) => p.id);
    expect(ids).toContain(s.currentPlanetId);
    // Window was pruned relative to the climb (old lowest planets are gone
    // except the protected current one).
    const nonCurrent = s.planets.filter((p) => p.id !== s.currentPlanetId);
    const pruneLine = s.cameraY + HEIGHT * 1.5;
    for (const p of nonCurrent) {
      expect(p.center.y).toBeLessThanOrEqual(pruneLine);
    }
  });
});
