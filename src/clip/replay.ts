// Deterministic replay primitives shared by the headless bot (bun) and the
// app's clip mode (UI-thread worklet). Pure TS — no React Native imports.
// Both sides MUST advance the sim through replayStep so a take reproduces
// exactly. See plans/gameplay-recorder.md.

import { ZONE_FLASH_FADE_OUT_MS, ZONE_FLASH_MS } from '../game/constants';
import { createInitialState, handleTap, stepGame } from '../game/engine';
import type { GameState } from '../game/types';
import { attemptEnd, clipStepOf, type Take, type TakeResult } from './take';

/** Fixed timestep for takes: one sim step per rendered 60 Hz frame. */
export const CLIP_DT = 1 / 60;

/** How long a zone banner is on screen in total (hold, then fade out). */
export const ZONE_BANNER_S = (ZONE_FLASH_MS + ZONE_FLASH_FADE_OUT_MS) / 1000;

/**
 * Advance one fixed step, tapping first when `tap` is set. Same copy-then-
 * mutate contract as GameScreen's frame loop: the input state is never touched.
 */
export function replayStep(state: GameState, tap: boolean): GameState {
  'worklet';
  const s = { ...state };
  if (tap && s.phase === 'orbiting') handleTap(s);
  stepGame(s, CLIP_DT);
  return s;
}

/**
 * What an attempt ended as. Besides the headline numbers it carries a
 * fingerprint that both engines reproduce bit-exactly when the replay
 * matched step for step (times are sums of identical 1/60 increments, the
 * rest are integers) — any drift in when things happened shows up here.
 */
export function resultOf(state: GameState): TakeResult {
  'worklet';
  return {
    score: state.score,
    planetsPassed: state.planetsPassed,
    deathCause: state.phase === 'dead' ? state.deathCause : null,
    fingerprint: [
      state.time,
      state.deathTime,
      state.lastReleaseAt,
      state.lastCaptureAt,
      state.lastFlybyAt,
      state.zoneChangedAt,
      state.rngState,
      state.nextPlanetId,
      state.heat,
    ],
  };
}

/** An attempt as the replayer needs it: when to install it and how to fast-forward. */
export interface ClipInstall {
  /** Clip step before which the attempt's state replaces the current one. */
  atStep: number;
  seed: number;
  skipSteps: number;
  /** Run-step taps inside the fast-forwarded stretch. */
  skipTaps: number[];
}

/** A take flattened onto the clip timeline — what both replayers execute. */
export interface ClipScript {
  installs: ClipInstall[];
  /** Clip steps where handleTap fires. Ascending. */
  taps: number[];
  /** reportAt[k] = clip step count at which attempt k's result is final. */
  reportAt: number[];
  endStep: number;
}

export function scriptFor(take: Take): ClipScript {
  const script: ClipScript = { installs: [], taps: [], reportAt: [], endStep: take.endStep };
  for (const a of take.attempts) {
    script.installs.push({
      atStep: a.startStep,
      seed: a.seed,
      skipSteps: a.skipSteps,
      skipTaps: a.taps.filter((t) => t < a.skipSteps),
    });
    for (const t of a.taps) if (t >= a.skipSteps) script.taps.push(clipStepOf(a, t));
    script.reportAt.push(attemptEnd(a));
  }
  return script;
}

/** Fresh state for an attempt, fast-forwarded through its skipped stretch. */
export function installAttempt(width: number, height: number, install: ClipInstall): GameState {
  'worklet';
  let state = createInitialState(width, height, install.seed);
  let tapIndex = 0;
  for (let step = 0; step < install.skipSteps; step++) {
    const tap = tapIndex < install.skipTaps.length && install.skipTaps[tapIndex] === step;
    if (tap) tapIndex += 1;
    state = replayStep(state, tap);
  }
  return state;
}

/**
 * Sync strip: in clip mode the Skia canvas extends this far below the 9:16
 * viewport and paints a solid colour there that changes with every sim step
 * (drawn in the same canvas, so it is atomic with the game frame). The
 * recorder reads it to rebuild the video as exactly one frame per step — VFR
 * capture, duplicate commits and simulator hitches all drop out — and crops
 * it away.
 */
export const SYNC_STRIP_PT = 24;
/**
 * The strip is four equal patches, each one base-6 digit of the step count
 * (least significant on the left), so a frame carries the step mod 1296. A
 * capture would have to miss ~20 s of steps before two steps look alike
 * (with 6 or 36 codes, short capture stalls aliased into silent shifts).
 * The recorder samples a slice of each patch, clear of the rounded display
 * corners and of the home indicator in the middle of the bottom edge.
 */
export const SYNC_PATCHES = 4;
/** Probe slices, as [x, width] in pt within a window of the given width. */
export function syncProbesPt(windowWidth: number): [number, number][] {
  const quarter = windowWidth / SYNC_PATCHES;
  const w = 25;
  return [
    [30, w], // patch 0, clear of the rounded corner
    [quarter + 4, w], // patch 1, left of the home indicator
    [3 * quarter - 4 - w, w], // patch 2, right of the home indicator
    [windowWidth - 30 - w, w], // patch 3, clear of the rounded corner
  ];
}
/** Probe rows sit this far inside the strip's top and bottom edges. */
export const SYNC_PROBE_ROW_INSET_PT = 6;
/** Waiting for a take. */
export const SYNC_IDLE = '#000000';
/** Take installed, initial state held still (covers the previous run's UI fading out). */
export const SYNC_PREROLL = '#FF00FF';
/** One base-6 digit per patch. Each colour is a distinct 1-bit-per-channel code. */
export const SYNC_STEP_COLORS = ['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FFFFFF'];
/** Steps the strip can count before wrapping. */
export const SYNC_CYCLE = Math.pow(SYNC_STEP_COLORS.length, SYNC_PATCHES);

/** Patch colours (left to right) for the strip after `step` steps (step < 0 = idle). */
export function syncColors(step: number): string[] {
  'worklet';
  const colors: string[] = [];
  const n = SYNC_STEP_COLORS.length;
  let rest = step;
  for (let k = 0; k < SYNC_PATCHES; k++) {
    if (step < 0) colors.push(SYNC_IDLE);
    else if (step === 0) colors.push(SYNC_PREROLL);
    else {
      colors.push(SYNC_STEP_COLORS[rest % n]);
      rest = Math.floor(rest / n);
    }
  }
  return colors;
}

export interface ClipViewport {
  width: number;
  height: number;
}

/**
 * The 9:16 playfield rendered in clip mode (sitting on top of the sync strip
 * at the bottom of the device window, clear of the status bar / Dynamic
 * Island). The recorder crops the video to this rectangle, and the bot
 * simulates with the same size.
 */
export function clipViewport(windowWidth: number, windowHeight: number): ClipViewport {
  const height = Math.min(Math.round((windowWidth * 16) / 9), windowHeight - SYNC_STRIP_PT);
  return { width: windowWidth, height };
}
