// Every difficulty dial is a pure function of n = the planet's ordinal in the
// chain (== planets passed when the player reaches it). Smooth per-planet
// trends plus a step at each zone boundary so zones feel distinct.

import {
  BAND_MIN,
  BAND_SHRINK_PER_PLANET,
  BAND_START,
  BAND_ZONE_STEP,
  CONE_HALF_BASE,
  CONE_HALF_CAP,
  CONE_HALF_GROWTH,
  DECAY_BASE,
  DECAY_FREE_PLANETS,
  DECAY_GROWTH,
  DECAY_MAX,
  FAIR_START_PLANETS,
  JUMP_MAX_BASE,
  JUMP_MAX_CAP,
  JUMP_MAX_GROWTH,
  JUMP_MIN_BASE,
  JUMP_MIN_CAP,
  JUMP_MIN_GROWTH,
  ORBIT_SPEED_BASE,
  ORBIT_SPEED_MAX,
  ORBIT_SPEED_PER_PLANET,
  PLANET_RADIUS_GROWTH,
  PLANET_RADIUS_GROWTH_CAP,
  PLANET_RADIUS_MAX,
  PLANET_RADIUS_MIN,
  ZONE_SIZE,
} from './constants';

export function zoneIndex(n: number): number {
  'worklet';
  return Math.floor(n / ZONE_SIZE);
}

/** Capture band width (ring minus body) — the main difficulty dial. */
export function captureBandWidth(n: number): number {
  'worklet';
  if (n < FAIR_START_PLANETS) return BAND_START;
  const smooth = BAND_START - BAND_SHRINK_PER_PLANET * n;
  const stepped = smooth - zoneIndex(n) * BAND_ZONE_STEP;
  return Math.max(BAND_MIN, stepped);
}

export function orbitAngularSpeed(n: number): number {
  'worklet';
  return Math.min(ORBIT_SPEED_BASE + ORBIT_SPEED_PER_PLANET * n, ORBIT_SPEED_MAX);
}

/** Planet body radius for ordinal n, given a uniform roll in [0, 1). */
export function planetRadius(n: number, roll: number): number {
  'worklet';
  const growth = Math.min(PLANET_RADIUS_GROWTH * n, PLANET_RADIUS_GROWTH_CAP);
  return PLANET_RADIUS_MIN + growth + roll * (PLANET_RADIUS_MAX - PLANET_RADIUS_MIN);
}

export function jumpMin(n: number): number {
  'worklet';
  return JUMP_MIN_BASE + Math.min(JUMP_MIN_GROWTH * n, JUMP_MIN_CAP);
}

export function jumpMax(n: number): number {
  'worklet';
  return JUMP_MAX_BASE + Math.min(JUMP_MAX_GROWTH * n, JUMP_MAX_CAP);
}

/** Half-angle of the placement cone around straight-up; wider = zig-zaggier. */
export function coneHalfAngle(n: number): number {
  'worklet';
  return CONE_HALF_BASE + Math.min(CONE_HALF_GROWTH * n, CONE_HALF_CAP);
}

/** Orbit decay in px/s; 0 during the fair-start window. */
export function orbitDecayRate(n: number): number {
  'worklet';
  if (n < DECAY_FREE_PLANETS) return 0;
  return Math.min(DECAY_BASE + DECAY_GROWTH * n, DECAY_MAX);
}
