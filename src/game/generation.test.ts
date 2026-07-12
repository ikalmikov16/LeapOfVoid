import { describe, expect, test } from 'bun:test';
import { BALL_RADIUS, MAX_PLANETS, PLANET_GAP } from './constants';
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
