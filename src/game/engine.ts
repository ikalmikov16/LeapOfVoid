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
  CAMERA_PLANET_ANCHOR,
  CAMERA_SMOOTHING,
  FLIGHT_SPEED,
  GRACE_AFTER_CAPTURE_S,
  OFFSCREEN_MARGIN,
  OFFSCREEN_TOP_SCREENS,
  PLANET_COLORS,
  RESTART_COOLDOWN_S,
} from './constants';
import { captureBandWidth, orbitAngularSpeed, orbitDecayRate, planetRadius } from './difficulty';
import { updatePlanetWindow } from './generation';
import { closestApproachOnSegment, pointOnCircle, segmentCircleEntry } from './geometry';
import { rand01 } from './rng';
import type { GameState, Planet, Vec2 } from './types';

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
    graceUntil: 0,
    ballPos: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    score: 0,
    time: 0,
    deathTime: 0,
    deathCause: null,
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
    ringRadius: startRadius + captureBandWidth(0),
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
  // Velocity is the orbit tangent: d/dt of (cos a, sin a) scaled by direction.
  state.velocity = {
    x: -Math.sin(state.angle) * state.direction * FLIGHT_SPEED,
    y: Math.cos(state.angle) * state.direction * FLIGHT_SPEED,
  };
  state.departedPlanetId = state.currentPlanetId;
  state.phase = 'flying';
}

function die(state: GameState, cause: 'crash' | 'lost' | 'burned'): void {
  'worklet';
  state.phase = 'dead';
  state.deathCause = cause;
  state.deathTime = state.time;
}

function stepOrbit(state: GameState, dt: number): void {
  'worklet';
  const planet = findPlanet(state.planets, state.currentPlanetId);
  if (planet === null) return;
  // Decay: the orbit spirals inward once past the grace window; reaching the
  // surface is the anti-camping death.
  if (state.time >= state.graceUntil) {
    const rate = orbitDecayRate(state.score);
    if (rate > 0) {
      state.orbitRadius -= rate * dt;
      if (state.orbitRadius <= planet.radius + BALL_RADIUS) {
        state.ballPos = pointOnCircle(planet.center, planet.radius + BALL_RADIUS, state.angle);
        die(state, 'burned');
        return;
      }
    }
  }
  state.angle += state.direction * orbitAngularSpeed(state.score) * dt;
  state.ballPos = pointOnCircle(planet.center, state.orbitRadius, state.angle);
}

function capture(state: GameState, planet: Planet, point: Vec2): void {
  'worklet';
  const radial = { x: point.x - planet.center.x, y: point.y - planet.center.y };
  // Orbit direction follows the approach direction so the flow feels continuous.
  const cross = radial.x * state.velocity.y - radial.y * state.velocity.x;
  state.direction = cross >= 0 ? 1 : -1;
  state.angle = Math.atan2(radial.y, radial.x);
  state.currentPlanetId = planet.id;
  state.departedPlanetId = -1;
  // v1 rule: snap to the planet's fixed ring; decay then works inward from it.
  state.orbitRadius = planet.ringRadius;
  state.graceUntil = state.time + GRACE_AFTER_CAPTURE_S;
  state.ballPos = pointOnCircle(planet.center, planet.ringRadius, state.angle);
  state.phase = 'orbiting';
  state.score += 1;
}

type FlightEvent =
  | { kind: 'crash'; t: number; planet: Planet }
  | { kind: 'capture'; t: number; planet: Planet; point: Vec2 };

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

    // Closest approach inside the body = crash (checked as circle entry so the
    // ball dies at the surface, not past it).
    const entryT = segmentCircleEntry(from, to, planet.center, planet.radius);
    if (entryT !== null && (event === null || entryT < event.t)) {
      event = { kind: 'crash', t: entryT, planet };
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
      event = { kind: 'capture', t: approach.t, planet, point: approach.point };
    }
  }

  if (event === null) {
    state.ballPos = to;
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

  capture(state, event.planet, event.point);
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
  // The camera only climbs (world y decreases). Downward flights fall out of
  // the viewport and die instead of dragging the camera back down.
  if (target < state.cameraY) {
    state.cameraY += (target - state.cameraY) * Math.min(1, CAMERA_SMOOTHING * dt);
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
