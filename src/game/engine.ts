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
  FLIGHT_SPEED,
  OFFSCREEN_MARGIN,
  ORBIT_ANGULAR_SPEED,
  PLANET_COLORS,
  PLANET_LAYOUT,
  RESTART_COOLDOWN_S,
} from './constants';
import { closestApproachOnSegment, pointOnCircle, segmentCircleEntry } from './geometry';
import type { GameState, Planet, Vec2 } from './types';

export function createLevel(width: number, height: number): Planet[] {
  'worklet';
  return PLANET_LAYOUT.map((p, i) => ({
    id: i,
    center: { x: p.fx * width, y: p.fy * height },
    radius: p.radius,
    ringRadius: p.ring,
    color: PLANET_COLORS[i % PLANET_COLORS.length],
  }));
}

export function createInitialState(width: number, height: number): GameState {
  'worklet';
  const planets = createLevel(width, height);
  const start = planets[0];
  const angle = Math.PI / 2;
  return {
    phase: 'orbiting',
    planets,
    width,
    height,
    currentPlanetIndex: 0,
    departedPlanetIndex: -1,
    angle,
    direction: 1,
    ballPos: pointOnCircle(start.center, start.ringRadius, angle),
    velocity: { x: 0, y: 0 },
    score: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
  };
}

function release(state: GameState): void {
  'worklet';
  // Velocity is the orbit tangent: d/dt of (cos a, sin a) scaled by direction.
  state.velocity = {
    x: -Math.sin(state.angle) * state.direction * FLIGHT_SPEED,
    y: Math.cos(state.angle) * state.direction * FLIGHT_SPEED,
  };
  state.departedPlanetIndex = state.currentPlanetIndex;
  state.phase = 'flying';
}

function stepOrbit(state: GameState, dt: number): void {
  'worklet';
  const planet = state.planets[state.currentPlanetIndex];
  state.angle += state.direction * ORBIT_ANGULAR_SPEED * dt;
  state.ballPos = pointOnCircle(planet.center, planet.ringRadius, state.angle);
}

function die(state: GameState, cause: 'crash' | 'lost'): void {
  'worklet';
  state.phase = 'dead';
  state.deathCause = cause;
  state.deathTime = state.time;
}

function capture(state: GameState, planetIndex: number, point: Vec2): void {
  'worklet';
  const planet = state.planets[planetIndex];
  const radial = { x: point.x - planet.center.x, y: point.y - planet.center.y };
  // Orbit direction follows the approach direction so the flow feels continuous.
  const cross = radial.x * state.velocity.y - radial.y * state.velocity.x;
  state.direction = cross >= 0 ? 1 : -1;
  state.angle = Math.atan2(radial.y, radial.x);
  state.currentPlanetIndex = planetIndex;
  state.departedPlanetIndex = -1;
  // v1 rule: snap to the planet's fixed ring.
  state.ballPos = pointOnCircle(planet.center, planet.ringRadius, state.angle);
  state.phase = 'orbiting';
  state.score += 1;
}

type FlightEvent =
  | { kind: 'crash'; t: number; planetIndex: number }
  | { kind: 'capture'; t: number; planetIndex: number; point: Vec2 };

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
    if (i === state.departedPlanetIndex) continue;
    const planet = state.planets[i];

    // Closest approach inside the body = crash (checked as circle entry so the
    // ball dies at the surface, not past it).
    const entryT = segmentCircleEntry(from, to, planet.center, planet.radius);
    if (entryT !== null && (event === null || entryT < event.t)) {
      event = { kind: 'crash', t: entryT, planetIndex: i };
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
      event = { kind: 'capture', t: approach.t, planetIndex: i, point: approach.point };
    }
  }

  if (event === null) {
    state.ballPos = to;
    const m = OFFSCREEN_MARGIN;
    if (to.x < -m || to.x > state.width + m || to.y < -m || to.y > state.height + m) {
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

  capture(state, event.planetIndex, event.point);
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
}
