import { describe, expect, test } from 'bun:test';
import { BALL_RADIUS, GRACE_AFTER_CAPTURE_S } from './constants';
import { orbitDecayRate } from './difficulty';
import { createInitialState, handleTap, stepGame } from './engine';
import { closestApproachOnSegment, segmentCircleEntry } from './geometry';
import type { GameState, Planet } from './types';

const DT = 1 / 60;

/**
 * A planet far above everything else. Its presence makes updatePlanetWindow a
 * no-op (the window already reaches past the generate-ahead line), so tests
 * get exact control over the planets in play while exercising real stepGame.
 */
const SENTINEL: Planet = {
  id: 999,
  center: { x: 200, y: -100000 },
  radius: 10,
  ringRadius: 20,
  color: '#fff',
};

function makeState(planets: Planet[], overrides: Partial<GameState>): GameState {
  return {
    phase: 'flying',
    planets: [...planets, SENTINEL],
    width: 400,
    height: 800,
    cameraY: 0,
    currentPlanetId: -1,
    departedPlanetId: -1,
    angle: 0,
    direction: 1,
    orbitRadius: 0,
    graceUntil: 0,
    ballPos: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    score: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
    rngState: 1,
    nextPlanetId: 1000,
    ...overrides,
  };
}

function runUntilSettled(state: GameState, maxFrames = 600): GameState {
  for (let i = 0; i < maxFrames && state.phase === 'flying'; i++) {
    stepGame(state, DT);
  }
  return state;
}

const planet: Planet = {
  id: 0,
  center: { x: 200, y: 400 },
  radius: 20,
  ringRadius: 50,
  color: '#fff',
};

describe('geometry', () => {
  test('closest approach at perpendicular foot', () => {
    const r = closestApproachOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 });
    expect(r.t).toBeCloseTo(0.5);
    expect(r.distance).toBeCloseTo(3);
    expect(r.point.x).toBeCloseTo(5);
    expect(r.point.y).toBeCloseTo(0);
  });

  test('closest approach clamps to segment end while still approaching', () => {
    const r = closestApproachOnSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 1 });
    expect(r.t).toBe(1);
  });

  test('segment-circle entry point', () => {
    const t = segmentCircleEntry({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 2);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.3);
  });

  test('segment missing the circle returns null', () => {
    const t = segmentCircleEntry({ x: 0, y: 5 }, { x: 10, y: 5 }, { x: 5, y: 0 }, 2);
    expect(t).toBeNull();
  });
});

describe('flight resolution', () => {
  test('path grazing the capture band gets captured, +1 score, grace granted', () => {
    // Flying right along y=440: closest approach to (200,400) is 40 — inside band (20, 50].
    const s = makeState([planet], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.score).toBe(1);
    expect(s.currentPlanetId).toBe(0);
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius);
    expect(s.graceUntil).toBeGreaterThanOrEqual(s.time);
    expect(s.graceUntil).toBeLessThanOrEqual(s.time + GRACE_AFTER_CAPTURE_S);
    // Snapped onto the ring.
    const dx = s.ballPos.x - planet.center.x;
    const dy = s.ballPos.y - planet.center.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(planet.ringRadius);
  });

  test('capture direction follows approach direction', () => {
    // Passing below the planet moving right → clockwise sweep around the center.
    const below = makeState([planet], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(below);
    expect(below.direction).toBe(-1);
    // Passing above the planet moving right → the other way.
    const above = makeState([planet], { ballPos: { x: 0, y: 360 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(above);
    expect(above.direction).toBe(1);
  });

  test('path through the planet body crashes at the surface', () => {
    const s = makeState([planet], { ballPos: { x: 0, y: 405 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('crash');
    const dx = s.ballPos.x - planet.center.x;
    const dy = s.ballPos.y - planet.center.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(planet.radius, 0);
  });

  test('path beyond the band sails past and dies off the viewport', () => {
    const s = makeState([planet], { ballPos: { x: 0, y: 500 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('lost');
    expect(s.score).toBe(0);
  });

  test('departed planet cannot recapture on release', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 0,
      angle: Math.PI / 2,
      orbitRadius: planet.ringRadius,
      ballPos: { x: 200, y: 450 },
    });
    const released = handleTap(s);
    expect(released.phase).toBe('flying');
    // A tangent release keeps closest approach exactly at the ring — without the
    // departed-planet exclusion this would instantly recapture.
    stepGame(released, DT);
    expect(released.phase).toBe('flying');
    expect(released.score).toBe(0);
  });
});

describe('orbit decay', () => {
  test('camping burns up on the surface at the decay rate', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 0,
      orbitRadius: planet.ringRadius,
      score: 10,
      ballPos: { x: 250, y: 400 },
    });
    const rate = orbitDecayRate(10);
    expect(rate).toBeGreaterThan(0);
    for (let i = 0; i < 600 && s.phase === 'orbiting'; i++) stepGame(s, DT);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('burned');
    const expected = (planet.ringRadius - (planet.radius + BALL_RADIUS)) / rate;
    expect(s.time).toBeGreaterThan(expected * 0.9);
    expect(s.time).toBeLessThan(expected * 1.1 + 0.1);
    const d = Math.hypot(s.ballPos.x - planet.center.x, s.ballPos.y - planet.center.y);
    expect(d).toBeCloseTo(planet.radius + BALL_RADIUS, 0);
  });

  test('grace window pauses decay', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 0,
      orbitRadius: planet.ringRadius,
      score: 10,
      graceUntil: 5,
      ballPos: { x: 250, y: 400 },
    });
    for (let i = 0; i < 120; i++) stepGame(s, DT); // 2s, inside grace
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius);
    for (let i = 0; i < 300; i++) stepGame(s, DT); // past grace at t=5
    expect(s.orbitRadius).toBeLessThan(planet.ringRadius);
  });

  test('no decay during the fair start', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 0,
      orbitRadius: planet.ringRadius,
      score: 0,
      ballPos: { x: 250, y: 400 },
    });
    for (let i = 0; i < 300; i++) stepGame(s, DT);
    expect(s.phase).toBe('orbiting');
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius);
  });
});

describe('camera', () => {
  test('converges up toward the orbited planet anchor and never moves down', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 0,
      orbitRadius: planet.ringRadius,
      ballPos: { x: 250, y: 400 },
    });
    const target = planet.center.y - s.height * 0.65;
    let last = s.cameraY;
    for (let i = 0; i < 240; i++) {
      stepGame(s, DT);
      expect(s.cameraY).toBeLessThanOrEqual(last + 1e-9);
      last = s.cameraY;
    }
    expect(Math.abs(s.cameraY - target)).toBeLessThan(2);
  });

  test('downward flight does not drag the camera down', () => {
    const s = makeState([planet], {
      ballPos: { x: 200, y: 600 },
      velocity: { x: 0, y: 520 },
    });
    const before = s.cameraY;
    for (let i = 0; i < 90 && s.phase === 'flying'; i++) stepGame(s, DT);
    expect(s.cameraY).toBe(before);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('lost');
  });
});

describe('full run on the real level', () => {
  test('initial state orbits planet 0 with a generated window above', () => {
    const s = createInitialState(390, 844, 42);
    expect(s.phase).toBe('orbiting');
    expect(s.planets.length).toBeGreaterThanOrEqual(4);
    expect(s.planets[0].id).toBe(0);
    expect(s.currentPlanetId).toBe(0);
    stepGame(s, DT);
    expect(s.phase).toBe('orbiting');
  });

  test('dead state restarts via tap after cooldown', () => {
    const s = createInitialState(390, 844, 42);
    s.phase = 'dead';
    s.deathCause = 'lost';
    s.deathTime = 0;
    s.time = 0.1; // within cooldown — tap ignored
    expect(handleTap(s).phase).toBe('dead');
    s.time = 1;
    const restarted = handleTap(s);
    expect(restarted.phase).toBe('orbiting');
    expect(restarted.score).toBe(0);
  });
});
