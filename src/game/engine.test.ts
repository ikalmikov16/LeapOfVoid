import { describe, expect, test } from 'bun:test';
import { createInitialState, handleTap, stepGame } from './engine';
import { closestApproachOnSegment, segmentCircleEntry } from './geometry';
import type { GameState, Planet } from './types';

const DT = 1 / 60;

function makeState(planets: Planet[], overrides: Partial<GameState>): GameState {
  return {
    phase: 'flying',
    planets,
    width: 400,
    height: 800,
    currentPlanetIndex: -1,
    departedPlanetIndex: -1,
    angle: 0,
    direction: 1,
    ballPos: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    score: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
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
  test('path grazing the capture band gets captured, +1 score', () => {
    // Flying right along y=440: closest approach to (200,400) is 40 — inside band (20, 50].
    const s = makeState([planet], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.score).toBe(1);
    expect(s.currentPlanetIndex).toBe(0);
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

  test('path beyond the band sails past and dies off-screen', () => {
    const s = makeState([planet], { ballPos: { x: 0, y: 500 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('dead');
    expect(s.deathCause).toBe('lost');
    expect(s.score).toBe(0);
  });

  test('departed planet cannot recapture on release', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetIndex: 0,
      angle: Math.PI / 2,
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

describe('full run on the real level', () => {
  test('initial state orbits planet 0', () => {
    const s = createInitialState(390, 844);
    expect(s.phase).toBe('orbiting');
    expect(s.planets).toHaveLength(6);
    stepGame(s, DT);
    expect(s.phase).toBe('orbiting');
  });

  test('dead state restarts via tap after cooldown', () => {
    const s = createInitialState(390, 844);
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
