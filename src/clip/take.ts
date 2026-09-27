// A "take" is one pre-simulated clip: the bot (scripts/clips/) plays the pure
// engine headlessly, and the app's clip mode replays the exact same runs for
// the screen recorder. A clip is one or more attempts on a single timeline —
// a fail montage is several attempts, each installed the way "TAP TO TRY
// AGAIN" would (but with a known seed). Shared by both sides: keep this file
// free of React Native imports so it loads under bun.
// See plans/gameplay-recorder.md and plans/clip-styles.md.

import type { CaptureKind, DeathCause } from '../game/types';

export type TakeEvent =
  | { step: number; type: 'release'; revolutions: number; quick: boolean }
  | {
      step: number;
      type: 'capture';
      planetId: number;
      kind: CaptureKind;
      heat: number;
      score: number;
      skips: number;
    }
  | { step: number; type: 'flyby'; heat: number }
  | { step: number; type: 'zone'; zoneIndex: number }
  | {
      step: number;
      type: 'death';
      cause: DeathCause;
      /** 'lost' deaths: which screen edge the ball flew off. */
      exit?: 'side' | 'top' | 'bottom';
    };

export interface TakeResult {
  score: number;
  planetsPassed: number;
  /** null when the attempt is cut while the run is still alive. */
  deathCause: DeathCause | null;
  /** Exact end-state values (event times, RNG state…) — see replay.ts resultOf. */
  fingerprint: number[];
}

/** One run of the game. Its own steps ("run steps") start at 0 at its seed. */
export interface Attempt {
  seed: number;
  /** Clip step at which this attempt is installed (0 for the first). */
  startStep: number;
  /** Run steps fast-forwarded invisibly at install (a highlight that opens mid-run). */
  skipSteps: number;
  /** Run steps where handleTap fires (before that step's stepGame). Ascending. */
  taps: number[];
  /** Run steps simulated: the death step + 1, or the cut point. */
  endStep: number;
  /** Successful (progressing) landings. */
  jumps: number;
  expected: TakeResult;
  /** Run-step events. */
  events: TakeEvent[];
  /** Px the fatal flight cleared the nearest ring by (lost deaths only). */
  missMargin: number | null;
}

export interface Take {
  version: 2;
  /** Playfield size in points — must match the app's clip viewport exactly. */
  width: number;
  height: number;
  attempts: Attempt[];
  /** Clip steps in total: where the last attempt ends. */
  endStep: number;
  /** Steps the clip keeps after endStep (the held final death card; 0 for a cut). */
  holdSteps: number;
  /** "BEST" shown on every death card of the clip (never persisted). */
  bestScore: number;
  meta: { profile: string; seed: number };
}

/** Clip step at which a run step of this attempt is executed. */
export function clipStepOf(attempt: Attempt, runStep: number): number {
  return attempt.startStep + runStep - attempt.skipSteps;
}

/** Clip step count at which the attempt's result is final. */
export function attemptEnd(attempt: Attempt): number {
  return clipStepOf(attempt, attempt.endStep);
}
