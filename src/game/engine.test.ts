import { describe, expect, test } from 'bun:test';
import {
  BALL_RADIUS,
  COMBO_MULTIPLIER_CAP,
  GRACE_AFTER_CAPTURE_S,
  GRAZE_POINTS,
  PERFECT_POINTS,
  SKIP_POINTS,
} from './constants';
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
    captureRadius: 0,
    graceUntil: 0,
    ballPos: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    planetsPassed: 0,
    score: 0,
    comboLinks: 0,
    revolutions: 0,
    zoneIndex: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
    lastReleaseAt: -99,
    lastCaptureAt: -99,
    captureKind: 0,
    capturePos: { x: 0, y: 0 },
    zoneChangedAt: -99,
    effectSeed: 1,
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

// id 1: capturing it from planetsPassed 0 counts as progression.
const planet: Planet = {
  id: 1,
  center: { x: 200, y: 400 },
  radius: 20,
  ringRadius: 50, // band = 30, center at distance 35, perfect window ±3.75
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
  test('path grazing the capture band gets captured, +1, grace granted', () => {
    // Flying right along y=440: closest approach to (200,400) is 40 — inside band (20, 50].
    const s = makeState([planet], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.planetsPassed).toBe(1);
    expect(s.score).toBe(1); // no combo, approach 40 is neither graze nor perfect
    expect(s.captureKind).toBe(0);
    expect(s.currentPlanetId).toBe(1);
    expect(s.revolutions).toBe(0);
    expect(s.lastCaptureAt).toBeCloseTo(s.time);
    expect(s.graceUntil).toBeGreaterThanOrEqual(s.time);
    expect(s.graceUntil).toBeLessThanOrEqual(s.time + GRACE_AFTER_CAPTURE_S);
    // Position is continuous: the orbit starts at the capture distance (40),
    // not snapped out to the ring.
    expect(s.orbitRadius).toBeCloseTo(40, 0);
    const dx = s.ballPos.x - planet.center.x;
    const dy = s.ballPos.y - planet.center.y;
    expect(Math.hypot(dx, dy)).toBeCloseTo(s.orbitRadius);
  });

  test('capture settles onto the ring smoothly (no snap)', () => {
    const s = makeState([planet], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.orbitRadius).toBeCloseTo(40, 0);

    // The first settle frames whip faster than the steady orbit speed
    // (velocity continuity with the flight), then calm down.
    const angleBefore = s.angle;
    stepGame(s, DT);
    expect(Math.abs(s.angle - angleBefore)).toBeGreaterThan(2.3 * DT * 2);

    // The radius eases monotonically out to the ring and stays there.
    let last = s.orbitRadius;
    for (let i = 0; i < 60; i++) {
      stepGame(s, DT);
      expect(s.orbitRadius).toBeGreaterThanOrEqual(last - 1e-9);
      last = s.orbitRadius;
    }
    expect(s.phase).toBe('orbiting');
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius);
    const d = Math.hypot(s.ballPos.x - planet.center.x, s.ballPos.y - planet.center.y);
    expect(d).toBeCloseTo(planet.ringRadius);
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
    expect(s.planetsPassed).toBe(0);
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
      currentPlanetId: 1,
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

describe('scoring', () => {
  test('quick release increments the streak and stamps the event', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      revolutions: 0.2,
      comboLinks: 2,
      time: 4,
      ballPos: { x: 250, y: 400 },
    });
    const released = handleTap(s);
    expect(released.comboLinks).toBe(3);
    expect(released.lastReleaseAt).toBe(4);
  });

  test('streak dies the moment the combo window closes, while still orbiting', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      comboLinks: 3,
      ballPos: { x: 250, y: 400 },
    });
    // 0.75 revolutions at 2.3 rad/s ≈ 2.05s.
    for (let i = 0; i < 100; i++) stepGame(s, DT); // 1.67s — window still open
    expect(s.comboLinks).toBe(3);
    for (let i = 0; i < 40; i++) stepGame(s, DT); // 2.33s — window closed
    expect(s.phase).toBe('orbiting');
    expect(s.comboLinks).toBe(0);
  });

  test('capture scores capture points times the multiplier', () => {
    const s = makeState([planet], {
      ballPos: { x: 0, y: 440 },
      velocity: { x: 520, y: 0 },
      comboLinks: 3,
    });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.score).toBe(4); // 1 × ×4 (first quick hop is already ×2)
    expect(s.planetsPassed).toBe(1);
  });

  test('multiplier is capped', () => {
    const s = makeState([planet], {
      ballPos: { x: 0, y: 440 },
      velocity: { x: 520, y: 0 },
      comboLinks: 99,
    });
    runUntilSettled(s);
    expect(s.score).toBe(COMBO_MULTIPLIER_CAP);
  });

  test('skimming the surface earns the graze bonus', () => {
    // Approach 24 → 4px above the surface (GRAZE_MARGIN 8), below perfect window.
    const s = makeState([planet], { ballPos: { x: 0, y: 424 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.captureKind).toBe(1);
    expect(s.score).toBe(1 + GRAZE_POINTS);
  });

  test('band-center capture earns the perfect bonus', () => {
    // Approach 35 = band center exactly.
    const s = makeState([planet], { ballPos: { x: 0, y: 435 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.captureKind).toBe(2);
    expect(s.score).toBe(1 + PERFECT_POINTS);
  });

  test('skipping planets pays skip points and advances difficulty to the id', () => {
    const far: Planet = { ...planet, id: 4 };
    const s = makeState([far], { ballPos: { x: 0, y: 440 }, velocity: { x: 520, y: 0 } });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting');
    expect(s.planetsPassed).toBe(4); // altitude, not capture count
    expect(s.score).toBe(1 + 3 * SKIP_POINTS); // capture ×1 + 3 skipped
  });

  test('capturing at or below the high-water mark scores nothing (no farming)', () => {
    const s = makeState([planet], {
      ballPos: { x: 0, y: 440 },
      velocity: { x: 520, y: 0 },
      planetsPassed: 5,
    });
    runUntilSettled(s);
    expect(s.phase).toBe('orbiting'); // still a safety net...
    expect(s.currentPlanetId).toBe(1);
    expect(s.planetsPassed).toBe(5); // ...but no progress
    expect(s.score).toBe(0); // ...and no points
  });

  test('crossing a zone boundary stamps the zone change', () => {
    const boundary: Planet = { ...planet, id: 20 };
    const s = makeState([boundary], {
      ballPos: { x: 0, y: 440 },
      velocity: { x: 520, y: 0 },
      planetsPassed: 19,
    });
    runUntilSettled(s);
    expect(s.planetsPassed).toBe(20);
    expect(s.zoneIndex).toBe(1);
    expect(s.zoneChangedAt).toBeCloseTo(s.time);
  });

  test('difficulty follows planetsPassed, not points', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      score: 9999,
      planetsPassed: 0,
      ballPos: { x: 250, y: 400 },
    });
    for (let i = 0; i < 300; i++) stepGame(s, DT);
    expect(s.phase).toBe('orbiting');
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius); // fair start: no decay
  });
});

describe('orbit decay', () => {
  test('camping burns up on the surface at the decay rate', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      planetsPassed: 10,
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
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      planetsPassed: 10,
      graceUntil: 5,
      ballPos: { x: 250, y: 400 },
    });
    for (let i = 0; i < 120; i++) stepGame(s, DT); // 2s, inside grace
    expect(s.orbitRadius).toBeCloseTo(planet.ringRadius);
    for (let i = 0; i < 300; i++) stepGame(s, DT); // past grace at t=5
    expect(s.orbitRadius).toBeLessThan(planet.ringRadius);
  });
});

describe('camera', () => {
  test('converges up toward the orbited planet anchor and never moves down', () => {
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
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

  test('sideways hop: camera eases back down to the new anchor while orbiting', () => {
    // Camera sits far above the anchor (as after a lateral capture); while
    // orbiting it must recenter downward instead of leaving the view frozen.
    const s = makeState([planet], {
      phase: 'orbiting',
      currentPlanetId: 1,
      orbitRadius: planet.ringRadius,
      cameraY: -600,
      ballPos: { x: 250, y: 400 },
    });
    const target = planet.center.y - s.height * 0.65;
    expect(target).toBeGreaterThan(s.cameraY); // anchor is below the camera
    for (let i = 0; i < 300; i++) stepGame(s, DT);
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
    expect(restarted.planetsPassed).toBe(0);
  });
});
