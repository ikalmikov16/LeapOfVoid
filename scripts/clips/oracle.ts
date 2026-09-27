// "What happens if I tap right now?" — answered by forking the real engine
// and flying the jump to its end. A cheap ray cast skips the fork for taps
// whose flight line touches no generated ring (most of every orbit).
// See plans/gameplay-recorder.md §3.2.

import { CLIP_DT } from '../../src/clip/replay';
import { OFFSCREEN_MARGIN } from '../../src/game/constants';
import { findPlanet, handleTap, stepGame } from '../../src/game/engine';
import { closestApproachOnSegment } from '../../src/game/geometry';
import type { CaptureKind, GameState } from '../../src/game/types';

/** 'unresolved' = still flying at the step cap (a long straight-up drift). */
export type TapResult = 'capture' | 'crash' | 'lost' | 'unresolved';

export interface TapOutcome {
  result: TapResult;
  /** Captured planet id, or -1. */
  planetId: number;
  /** planetId − planetsPassed at release; ≤ 0 means no progress. */
  advance: number;
  kind: CaptureKind;
  /** Planets flown past during the jump (what builds heat). */
  skips: number;
  /** Capture only: px from the closest approach to the nearest band edge. */
  bandMargin: number;
  /**
   * Px the flight cleared the nearest ring the viewer could see by (Infinity
   * if none came close). Exact forks measure the whole flight — including
   * rings that scroll into view mid-flight; the ray-cast shortcut only sees
   * rings on screen at the tap.
   */
  missMargin: number;
  /** Steps in the air (0 when the fork was skipped by the ray cast). */
  flightSteps: number;
  /** Exact forks that end in a death: whether the ball dies inside the 9:16 frame. */
  deathVisible: boolean;
  /** Exact forks that end 'lost': the screen edge the ball flew off. */
  exit: Exit | null;
}

export type Exit = 'side' | 'top' | 'bottom';

/** Which edge a ball that just died 'lost' flew off (the engine's bounds test). */
export function exitOf(s: GameState): Exit {
  const m = OFFSCREEN_MARGIN;
  if (s.ballPos.x < -m || s.ballPos.x > s.width + m) return 'side';
  return s.ballPos.y > s.cameraY + s.height ? 'bottom' : 'top';
}

/** Inside the 9:16 frame the viewer sees (world coordinates). */
function inFrame(s: GameState, p: { x: number; y: number }): boolean {
  return p.x >= 0 && p.x <= s.width && p.y >= s.cameraY && p.y <= s.cameraY + s.height;
}

/** Longest jump worth resolving (10 s) — anything longer is not a plan. */
const MAX_FLIGHT_STEPS = 600;
/** Ray-cast slack (px): borderline lines still get the exact fork. */
const RAY_SLACK = 1;

interface RayCast {
  hit: boolean;
  missMargin: number;
}

/** Does the release tangent pass through any generated planet's ring? */
function castRay(state: GameState): RayCast {
  const vx = -Math.sin(state.angle) * state.direction;
  const vy = Math.cos(state.angle) * state.direction;
  let hit = false;
  let missMargin = Infinity;
  for (let i = 0; i < state.planets.length; i++) {
    const p = state.planets[i];
    if (p.id === state.currentPlanetId) continue;
    const dx = p.center.x - state.ballPos.x;
    const dy = p.center.y - state.ballPos.y;
    const along = dx * vx + dy * vy;
    if (along <= 0) continue; // behind the ball
    const margin = Math.abs(dx * vy - dy * vx) - p.ringRadius;
    // Near-miss prefilter (exact forks re-check where the skim happens): any
    // ring overlapping the frame — including rings within RAY_SLACK, which
    // are forked but may still be missed by a hair (that hair is the near miss).
    const onScreen =
      p.center.y + p.ringRadius > state.cameraY &&
      p.center.y - p.ringRadius < state.cameraY + state.height;
    if (onScreen && margin > 0 && margin < missMargin) missMargin = margin;
    if (margin <= RAY_SLACK) hit = true;
  }
  return { hit, missMargin };
}

/**
 * Outcome of tapping on `state` (which must be orbiting). With `exact` unset,
 * lines that touch no ring are reported as 'lost' without flying them —
 * callers that commit to such a tap should re-check with `exact`.
 */
export function evaluateTap(state: GameState, exact = false): TapOutcome {
  const ray = castRay(state);
  if (!ray.hit && !exact) {
    return {
      result: 'lost',
      planetId: -1,
      advance: 0,
      kind: 0,
      skips: 0,
      bandMargin: 0,
      missMargin: ray.missMargin,
      flightSteps: 0,
      deathVisible: false,
      exit: null,
    };
  }

  // Private fork: the engine only replaces top-level fields, so stepping the
  // shallow copy in place never touches the caller's state.
  const s = { ...state };
  handleTap(s);
  let flightSteps = 0;
  let flightMiss = Infinity;
  while (s.phase === 'flying' && flightSteps < MAX_FLIGHT_STEPS) {
    const from = s.ballPos;
    stepGame(s, CLIP_DT);
    flightSteps += 1;
    for (let i = 0; i < s.planets.length; i++) {
      const p = s.planets[i];
      if (p.id === s.departedPlanetId) continue;
      const approach = closestApproachOnSegment(from, s.ballPos, p.center);
      // Only skims the viewer can see: the closest point inside the frame.
      if (!inFrame(s, approach.point)) continue;
      const margin = approach.distance - p.ringRadius;
      if (margin > 0 && margin < flightMiss) flightMiss = margin;
    }
  }

  if (s.phase === 'orbiting') {
    const planet = findPlanet(s.planets, s.currentPlanetId);
    const bandMargin =
      planet === null
        ? 0
        : Math.min(s.captureRadius - planet.radius, planet.ringRadius - s.captureRadius);
    return {
      result: 'capture',
      planetId: s.currentPlanetId,
      advance: s.currentPlanetId - state.planetsPassed,
      kind: s.captureKind,
      skips: s.flightSkips,
      bandMargin,
      missMargin: 0,
      flightSteps,
      deathVisible: false,
      exit: null,
    };
  }
  return {
    result: s.phase === 'flying' ? 'unresolved' : s.deathCause === 'crash' ? 'crash' : 'lost',
    planetId: -1,
    advance: 0,
    kind: 0,
    skips: s.flightSkips,
    bandMargin: 0,
    missMargin: Math.min(ray.missMargin, flightMiss),
    flightSteps,
    deathVisible: s.phase === 'dead' && inFrame(s, s.ballPos),
    exit: s.phase === 'dead' && s.deathCause === 'lost' ? exitOf(s) : null,
  };
}
