// Procedural planet chain. Pure TS, worklet-safe, seeded via state.rngState.
// Worklet ordering rule applies: callees defined before callers.

import {
  BALL_RADIUS,
  BAND_MIN,
  CORRIDOR_CLEARANCE,
  GENERATE_AHEAD_SCREENS,
  GIANT_RING_CHANCE,
  GIANT_RING_SCALE,
  MAX_PLACEMENT_ATTEMPTS,
  MAX_PLANETS,
  PLANET_COLORS,
  PLANET_GAP,
  PRUNE_BEHIND_SCREENS,
  RING_JITTER_MAX,
  RING_JITTER_MIN,
  SCREEN_X_MARGIN,
} from './constants';
import {
  captureBandWidth,
  coneHalfAngle,
  earlyRingBoost,
  jumpMax,
  jumpMin,
  planetRadius,
} from './difficulty';
import { closestApproachOnSegment } from './geometry';
import { rand01, randRange } from './rng';
import type { GameState, Planet, Vec2 } from './types';

function buildPlanet(id: number, center: Vec2, radius: number, band: number): Planet {
  'worklet';
  return {
    id,
    center,
    radius,
    ringRadius: radius + band,
    color: PLANET_COLORS[id % PLANET_COLORS.length],
  };
}

/**
 * Per-planet ring variety: jitter the difficulty band so rings visibly vary
 * (small planets can out-ring big ones), with an occasional giant ring.
 * The early-game boost sits under the jitter, so early orbits run big on
 * average but can still roll small — and late ones tight but sometimes giant.
 */
function sampleBand(state: GameState, n: number): number {
  'worklet';
  let band = captureBandWidth(n) * earlyRingBoost(n);
  if (rand01(state) < GIANT_RING_CHANCE) {
    band *= GIANT_RING_SCALE;
  } else {
    band *= RING_JITTER_MIN + rand01(state) * (RING_JITTER_MAX - RING_JITTER_MIN);
  }
  return Math.max(band, BAND_MIN);
}

/**
 * A candidate placement is valid when:
 * - its ring clears every retained planet's ring by PLANET_GAP, and
 * - the flight corridor from the previous planet's center to the candidate's
 *   center is not blocked by any other planet's body (so the jump the player
 *   is "supposed" to make can never be a guaranteed crash).
 */
function isValidPlacement(
  planets: Planet[],
  prev: Planet,
  center: Vec2,
  ringRadius: number,
): boolean {
  'worklet';
  for (let i = 0; i < planets.length; i++) {
    const q = planets[i];
    const dx = center.x - q.center.x;
    const dy = center.y - q.center.y;
    const minSep = ringRadius + q.ringRadius + PLANET_GAP;
    if (dx * dx + dy * dy < minSep * minSep) return false;
    if (q.id !== prev.id) {
      const corridor = closestApproachOnSegment(prev.center, center, q.center);
      if (corridor.distance < q.radius + BALL_RADIUS + CORRIDOR_CLEARANCE) return false;
    }
  }
  return true;
}

/**
 * Generate the next planet above `planets[last]`. Samples within the jump
 * range and placement cone; falls back to a straight-up placement (always
 * valid: the chain only climbs, so nothing sits above the topmost planet).
 */
export function generateNextPlanet(state: GameState, planets: Planet[]): Planet {
  'worklet';
  const prev = planets[planets.length - 1];
  const n = state.nextPlanetId;
  const radius = planetRadius(n, rand01(state));
  const band = sampleBand(state, n);
  const ring = radius + band;
  const xMin = ring + SCREEN_X_MARGIN;
  const xMax = state.width - ring - SCREEN_X_MARGIN;

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const dist = randRange(state, jumpMin(n), jumpMax(n));
    const theta = -Math.PI / 2 + (rand01(state) * 2 - 1) * coneHalfAngle(n);
    const x = Math.min(Math.max(prev.center.x + Math.cos(theta) * dist, xMin), xMax);
    const center = { x, y: prev.center.y + Math.sin(theta) * dist };
    // Clamping x can compress the jump; re-check the real distance.
    const ddx = center.x - prev.center.x;
    const ddy = center.y - prev.center.y;
    if (ddx * ddx + ddy * ddy < jumpMin(n) * jumpMin(n)) continue;
    if (isValidPlacement(planets, prev, center, ring)) {
      return buildPlanet(n, center, radius, band);
    }
  }

  // Fallback: straight up at max jump distance, x pulled toward screen center.
  const cx = Math.min(Math.max(state.width * 0.5, xMin), xMax);
  return buildPlanet(n, { x: cx, y: prev.center.y - jumpMax(n) }, radius, band);
}

/**
 * Keep the planet window filled ahead of the camera and pruned behind it.
 * Replaces state.planets (never mutates the old array) when anything changes.
 */
export function updatePlanetWindow(state: GameState): void {
  'worklet';
  let planets: Planet[] | null = null;

  const pruneBelowY = state.cameraY + state.height * (1 + PRUNE_BEHIND_SCREENS);
  let anyPrunable = false;
  for (let i = 0; i < state.planets.length; i++) {
    const p = state.planets[i];
    if (
      p.center.y > pruneBelowY &&
      p.id !== state.currentPlanetId &&
      p.id !== state.departedPlanetId
    ) {
      anyPrunable = true;
      break;
    }
  }
  if (anyPrunable) {
    planets = [];
    for (let i = 0; i < state.planets.length; i++) {
      const p = state.planets[i];
      if (
        p.center.y <= pruneBelowY ||
        p.id === state.currentPlanetId ||
        p.id === state.departedPlanetId
      ) {
        planets.push(p);
      }
    }
  }

  const generateAboveY = state.cameraY - state.height * GENERATE_AHEAD_SCREENS;
  let current = planets ?? state.planets;
  if (current.length > 0 && current[current.length - 1].center.y > generateAboveY) {
    if (planets === null) {
      planets = state.planets.slice();
      current = planets;
    }
    while (
      current[current.length - 1].center.y > generateAboveY &&
      current.length < MAX_PLANETS
    ) {
      current.push(generateNextPlanet(state, current));
      state.nextPlanetId += 1;
    }
  }

  if (planets !== null) state.planets = planets;
}
