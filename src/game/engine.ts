// The simulation. Pure TypeScript, no React/Skia/Reanimated imports.
// Every function is a worklet so the whole sim runs on the UI thread.
//
// IMPORTANT: definition order matters. The worklets runtime bundled in Expo Go
// SDK 54 (react-native-worklets 0.5.x) captures a worklet's outer references at
// module-evaluation time, so every function must be defined BEFORE any worklet
// that calls it — callees first, entry points (handleTap, stepGame) last.
//
// Callers own mutation safety: pass a fresh shallow copy of the state into
// stepGame/handleTap, and these functions only ever replace top-level fields
// (never mutate nested objects), so the previous state object is never touched.

import {
  BALL_RADIUS,
  CAMERA_BALL_ANCHOR,
  CAMERA_DOWN_SMOOTHING,
  CAMERA_PLANET_ANCHOR,
  CAMERA_SMOOTHING,
  CAPTURE_OMEGA_MAX,
  CAPTURE_POINTS,
  CAPTURE_SETTLE_S,
  FLIGHT_SPEED,
  GRACE_AFTER_CAPTURE_S,
  GRAZE_MARGIN,
  GRAZE_POINTS,
  HEAT_COOL_REVOLUTIONS,
  HEAT_MAX,
  OFFSCREEN_MARGIN,
  OFFSCREEN_TOP_SCREENS,
  PERFECT_BAND_FRACTION,
  PERFECT_POINTS,
  PLANET_COLORS,
  QUICK_POINTS,
  QUICK_WINDOW_REVOLUTIONS,
  RESTART_COOLDOWN_S,
} from './constants';
import {
  captureBandWidth,
  earlyRingBoost,
  orbitAngularSpeed,
  orbitDecayRate,
  planetRadius,
  zoneIndex as zoneIndexOf,
} from './difficulty';
import { updatePlanetWindow } from './generation';
import { closestApproachOnSegment, pointOnCircle, segmentCircleEntry } from './geometry';
import { rand01 } from './rng';
import type { CaptureKind, DeathCause, GameState, Planet, Vec2 } from './types';

export function findPlanet(planets: Planet[], id: number): Planet | null {
  'worklet';
  for (let i = 0; i < planets.length; i++) {
    if (planets[i].id === id) return planets[i];
  }
  return null;
}

export function createInitialState(width: number, height: number, seed?: number): GameState {
  'worklet';
  const state: GameState = {
    phase: 'orbiting',
    planets: [],
    width,
    height,
    cameraY: -height * CAMERA_PLANET_ANCHOR,
    currentPlanetId: 0,
    departedPlanetId: -1,
    angle: Math.PI / 2,
    direction: 1,
    orbitRadius: 0,
    captureRadius: 0,
    graceUntil: 0,
    ballPos: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    planetsPassed: 0,
    score: 0,
    heat: 0,
    flightSkips: 0,
    releasedQuick: false,
    revolutions: 0,
    zoneIndex: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
    lastReleaseAt: -99,
    lastCaptureAt: -99,
    lastFlybyAt: -99,
    captureKind: 0,
    capturePos: { x: 0, y: 0 },
    zoneChangedAt: -99,
    effectSeed: 1,
    rngState: seed !== undefined ? seed | 0 : Math.floor(Math.random() * 4294967296) | 0,
    nextPlanetId: 1,
  };
  // First planet at the world origin, centered; the camera anchors it at
  // CAMERA_PLANET_ANCHOR down the screen. The window fills the rest upward.
  const startRadius = planetRadius(0, rand01(state));
  const start: Planet = {
    id: 0,
    center: { x: width * 0.5, y: 0 },
    radius: startRadius,
    // The first orbit always gets the full early boost (no jitter — the run
    // should never open on a cramped ring).
    ringRadius: startRadius + captureBandWidth(0) * earlyRingBoost(0),
    color: PLANET_COLORS[0],
  };
  state.planets = [start];
  state.orbitRadius = start.ringRadius;
  state.ballPos = pointOnCircle(start.center, start.ringRadius, state.angle);
  updatePlanetWindow(state);
  return state;
}

function release(state: GameState): void {
  'worklet';
  // The quick flag rides along to the capture, where it pays QUICK_POINTS.
  state.releasedQuick = state.revolutions < QUICK_WINDOW_REVOLUTIONS;
  state.flightSkips = 0;
  // Velocity is the orbit tangent: d/dt of (cos a, sin a) scaled by direction.
  state.velocity = {
    x: -Math.sin(state.angle) * state.direction * FLIGHT_SPEED,
    y: Math.cos(state.angle) * state.direction * FLIGHT_SPEED,
  };
  state.departedPlanetId = state.currentPlanetId;
  state.lastReleaseAt = state.time;
  state.phase = 'flying';
}

function die(state: GameState, cause: DeathCause): void {
  'worklet';
  state.phase = 'dead';
  state.deathCause = cause;
  state.deathTime = state.time;
}

function stepOrbit(state: GameState, dt: number): void {
  'worklet';
  const planet = findPlanet(state.planets, state.currentPlanetId);
  if (planet === null) return;

  const baseSpeed = orbitAngularSpeed(state.planetsPassed);
  let angularSpeed = baseSpeed;
  const settleT = Math.min(1, (state.time - state.lastCaptureAt) / CAPTURE_SETTLE_S);
  if (settleT < 1) {
    // Latch-on settle: ease the radius from the capture distance out to the
    // ring, and the angular speed from the flight speed (which is exactly
    // tangential at the closest-approach point) down to the orbit speed.
    // Position AND velocity stay continuous — no snap. Smoothstep so both
    // ends of the blend are gentle. Settle always finishes inside the
    // capture grace window, so it never fights orbit decay.
    const k = settleT * settleT * (3 - 2 * settleT);
    state.orbitRadius = state.captureRadius + (planet.ringRadius - state.captureRadius) * k;
    const captureSpeed = Math.min(FLIGHT_SPEED / Math.max(state.captureRadius, 1), CAPTURE_OMEGA_MAX);
    angularSpeed = captureSpeed + (baseSpeed - captureSpeed) * k;
  } else if (state.time < state.graceUntil) {
    // Settle done (its last frame lands a hair short of the ring); hold the
    // exact ring until decay takes over after grace.
    state.orbitRadius = planet.ringRadius;
  } else {
    // Decay: the orbit spirals inward once past the grace window; reaching
    // the surface is the anti-camping death.
    const rate = orbitDecayRate(state.planetsPassed);
    if (rate > 0) {
      state.orbitRadius -= rate * dt;
      if (state.orbitRadius <= planet.radius + BALL_RADIUS) {
        state.ballPos = pointOnCircle(planet.center, planet.radius + BALL_RADIUS, state.angle);
        die(state, 'burned');
        return;
      }
    }
  }
  state.angle += state.direction * angularSpeed * dt;
  // Track revolutions with the base speed (the settle whip after a deep
  // graze must not eat the quick window or the heat), and cool the heat one
  // notch per revolution camped — hesitation visibly drains the multiplier.
  const revsBefore = state.revolutions;
  state.revolutions += (baseSpeed * dt) / (Math.PI * 2);
  if (
    state.heat > 0 &&
    Math.floor(state.revolutions / HEAT_COOL_REVOLUTIONS) >
      Math.floor(revsBefore / HEAT_COOL_REVOLUTIONS)
  ) {
    state.heat -= 1;
  }
  state.ballPos = pointOnCircle(planet.center, state.orbitRadius, state.angle);
}

/** approachDistance = the flight path's closest approach to the planet center. */
function capture(state: GameState, planet: Planet, point: Vec2, approachDistance: number): void {
  'worklet';
  const radial = { x: point.x - planet.center.x, y: point.y - planet.center.y };
  // Orbit direction follows the approach direction so the flow feels continuous.
  const cross = radial.x * state.velocity.y - radial.y * state.velocity.x;
  state.direction = cross >= 0 ? 1 : -1;
  state.angle = Math.atan2(radial.y, radial.x);
  state.currentPlanetId = planet.id;
  state.departedPlanetId = -1;
  // Orbit starts exactly at the capture point; stepOrbit settles it out to
  // the planet's fixed ring over CAPTURE_SETTLE_S, then decay works inward.
  state.orbitRadius = approachDistance;
  state.captureRadius = approachDistance;
  state.graceUntil = state.time + GRACE_AFTER_CAPTURE_S;
  state.ballPos = pointOnCircle(planet.center, approachDistance, state.angle);
  state.phase = 'orbiting';
  state.revolutions = 0;

  // Scoring: perfect (band center) beats graze (skimmed the surface).
  const band = planet.ringRadius - planet.radius;
  const bandCenter = planet.radius + band / 2;
  let kind: CaptureKind = 0;
  if (Math.abs(approachDistance - bandCenter) <= (band * PERFECT_BAND_FRACTION) / 2) {
    kind = 2;
  } else if (approachDistance - planet.radius <= GRAZE_MARGIN) {
    kind = 1;
  }

  // Progression: planet ids are chain ordinals, so planetsPassed tracks
  // *altitude* — a jump that skips planets advances difficulty and zones by
  // the full distance. Capturing at or below the high-water mark (jumping
  // backward, re-grabbing the start planet) is a safety net worth zero
  // points — otherwise bouncing between two planets would farm score.
  //
  // Points: flat bonuses, all multiplied by the heat the flight built
  // (flybys already ticked state.heat up mid-flight, so the skip jump
  // itself cashes in immediately).
  if (planet.id > state.planetsPassed) {
    state.planetsPassed = planet.id;
    const bonuses =
      (state.releasedQuick ? QUICK_POINTS : 0) +
      (kind === 2 ? PERFECT_POINTS : kind === 1 ? GRAZE_POINTS : 0);
    state.score += (CAPTURE_POINTS + bonuses) * (1 + state.heat);
    const zone = zoneIndexOf(state.planetsPassed);
    if (zone !== state.zoneIndex) {
      state.zoneIndex = zone;
      state.zoneChangedAt = state.time;
    }
  }

  // Heat is momentum: a landing that flew past nothing cools one notch
  // (after paying out — you cash the multiplier you arrived with). Holding
  // red-hot means skipping on nearly every hop, not coasting on old glory.
  if (state.flightSkips === 0 && state.heat > 0) {
    state.heat -= 1;
  }

  // Effect stamps (hash instead of consuming rngState — generation stays
  // deterministic regardless of how captures interleave).
  state.lastCaptureAt = state.time;
  state.captureKind = kind;
  state.capturePos = { x: state.ballPos.x, y: state.ballPos.y };
  state.effectSeed = (state.rngState ^ Math.imul(state.planetsPassed + 1, 2654435761)) >>> 0;
}

type FlightEvent =
  | { kind: 'crash'; t: number }
  | { kind: 'capture'; t: number; planet: Planet; point: Vec2; distance: number };

function stepFlight(state: GameState, dt: number): void {
  'worklet';
  const from = state.ballPos;
  const to = {
    x: from.x + state.velocity.x * dt,
    y: from.y + state.velocity.y * dt,
  };

  // Earliest event along this frame's segment wins.
  let event: FlightEvent | null = null;
  for (let i = 0; i < state.planets.length; i++) {
    const planet = state.planets[i];
    if (planet.id === state.departedPlanetId) continue;

    // Closest approach inside the body = crash (checked as circle entry so
    // the ball dies at the surface, not past it).
    const entryT = segmentCircleEntry(from, to, planet.center, planet.radius);
    if (entryT !== null && (event === null || entryT < event.t)) {
      event = { kind: 'crash', t: entryT };
    }

    // Capture: the path's closest approach falls inside the capture band.
    // approach.t < 1 means the minimum is passed within this frame's segment;
    // while still approaching (t clamps to 1) we wait for a later frame.
    const approach = closestApproachOnSegment(from, to, planet.center);
    if (
      approach.t < 1 &&
      approach.distance > planet.radius &&
      approach.distance <= planet.ringRadius &&
      (event === null || approach.t < event.t)
    ) {
      event = {
        kind: 'capture',
        t: approach.t,
        planet,
        point: approach.point,
        distance: approach.distance,
      };
    }
  }

  if (event === null) {
    state.ballPos = to;
    // Flybys: a planet is "flown past" once the ball clears the top of its
    // capture ring — beyond that a straight flight can never be captured by
    // it, so this can't fire for the planet we end up landing on. Each new
    // clear ticks the heat up (the score multiplier AND the comet glow).
    let cleared = 0;
    for (let i = 0; i < state.planets.length; i++) {
      const p = state.planets[i];
      if (
        p.id > state.planetsPassed &&
        p.id !== state.departedPlanetId &&
        to.y < p.center.y - p.ringRadius
      ) {
        cleared += 1;
      }
    }
    if (cleared > state.flightSkips) {
      state.heat = Math.min(state.heat + (cleared - state.flightSkips), HEAT_MAX);
      state.flightSkips = cleared;
      state.lastFlybyAt = state.time;
    }
    // Bounds move with the camera. Generous headroom above (camera catches
    // up); tight below and to the sides.
    const m = OFFSCREEN_MARGIN;
    const topBound = state.cameraY - state.height * OFFSCREEN_TOP_SCREENS;
    const bottomBound = state.cameraY + state.height + m;
    if (to.x < -m || to.x > state.width + m || to.y > bottomBound || to.y < topBound) {
      die(state, 'lost');
    }
    return;
  }

  if (event.kind === 'crash') {
    state.ballPos = {
      x: from.x + (to.x - from.x) * event.t,
      y: from.y + (to.y - from.y) * event.t,
    };
    die(state, 'crash');
    return;
  }

  capture(state, event.planet, event.point, event.distance);
}

function stepCamera(state: GameState, dt: number): void {
  'worklet';
  let target: number;
  if (state.phase === 'flying') {
    target = state.ballPos.y - state.height * CAMERA_BALL_ANCHOR;
  } else {
    const planet = findPlanet(state.planets, state.currentPlanetId);
    if (planet === null) return;
    target = planet.center.y - state.height * CAMERA_PLANET_ANCHOR;
  }
  // Climbing is snappy. While ORBITING the camera may also ease back down —
  // a sideways hop can put the new anchor below the camera, and without the
  // recenter the screen just sits frozen. Flying never drags the camera down:
  // downward flights still fall out of the viewport and die.
  if (target < state.cameraY) {
    state.cameraY += (target - state.cameraY) * Math.min(1, CAMERA_SMOOTHING * dt);
  } else if (state.phase === 'orbiting') {
    state.cameraY += (target - state.cameraY) * Math.min(1, CAMERA_DOWN_SMOOTHING * dt);
  }
}

/** Single tap: release while orbiting, restart when dead, no-op in flight. */
export function handleTap(state: GameState): GameState {
  'worklet';
  if (state.phase === 'orbiting') {
    release(state);
    return state;
  }
  if (state.phase === 'dead' && state.time - state.deathTime >= RESTART_COOLDOWN_S) {
    return createInitialState(state.width, state.height);
  }
  return state;
}

export function stepGame(state: GameState, dt: number): void {
  'worklet';
  state.time += dt;
  if (state.phase === 'orbiting') stepOrbit(state, dt);
  else if (state.phase === 'flying') stepFlight(state, dt);
  if (state.phase !== 'dead') {
    stepCamera(state, dt);
    updatePlanetWindow(state);
  }
}
