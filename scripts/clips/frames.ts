// Pure pieces of the recorder, kept here so they can be unit-tested:
// decoding the sync strip into per-step frame picks, the crop/probe geometry,
// and the sidecar timeline. See plans/gameplay-recorder.md §3.4–3.6.

import {
  SYNC_CYCLE,
  SYNC_PATCHES,
  SYNC_PREROLL,
  SYNC_PROBE_ROW_INSET_PT,
  SYNC_STEP_COLORS,
  SYNC_STRIP_PT,
  syncProbesPt,
  ZONE_BANNER_S,
} from '../../src/clip/replay';
import { attemptEnd, clipStepOf, type Take } from '../../src/clip/take';

export const FPS = 60;

/** 3-bit colour code: each channel thresholded at mid-grey. */
export function codeOf(r: number, g: number, b: number): number {
  return (r > 128 ? 4 : 0) | (g > 128 ? 2 : 0) | (b > 128 ? 1 : 0);
}

function hexCode(hex: string): number {
  return codeOf(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
}

const PREROLL_CODE = hexCode(SYNC_PREROLL);
const DIGIT_CODES = SYNC_STEP_COLORS.map(hexCode);
const BASE = DIGIT_CODES.length;
/**
 * The largest step advance accepted between two consecutive captures (2 s of
 * steps at 60/s); a larger one reads as a misread and is ignored. After
 * LOST_SYNC_FRAMES unreadable frames in a row, decoding stops: the take
 * comes out short and is re-recorded, never shifted. The strip counts mod
 * 1296 steps, so aliasing would need a ~20 s capture stall.
 */
export const MAX_ADVANCE = 120;
const LOST_SYNC_FRAMES = 3;

/** The step count (mod SYNC_CYCLE) a frame's patch codes spell, or -1. */
function stepOf(codes: number[]): number {
  let value = 0;
  for (let k = SYNC_PATCHES - 1; k >= 0; k--) {
    const digit = DIGIT_CODES.indexOf(codes[k]);
    if (digit < 0) return -1;
    value = value * BASE + digit;
  }
  return value;
}

const isPreroll = (codes: number[]) => codes.every((c) => c === PREROLL_CODE);

export interface FramePicks {
  /** picks[k] = captured frame index showing the state after k steps. */
  picks: number[];
  /** Steps of the clip the capture never showed (filled with the previous frame). */
  missing: number;
  /** Frames whose strip read as something impossible (ignored). */
  glitches: number;
}

/**
 * Map captured frames to sim steps from the strip's patch codes (one array
 * of SYNC_PATCHES codes per frame). Keeps the last capture of each step
 * (freshest HUD) and fills never-captured steps with their predecessor.
 */
export function pickFrames(codes: number[][], wanted: number): FramePicks {
  let i = codes.findIndex(isPreroll);
  if (i < 0) throw new Error('Sync strip not found in the recording.');
  while (i + 1 < codes.length && isPreroll(codes[i + 1])) i++;
  const picks = [i]; // step count 0 = the held initial state
  let missing = 0;
  let glitches = 0;
  let unreadableRun = 0;
  for (let j = i + 1; j < codes.length && unreadableRun < LOST_SYNC_FRAMES; j++) {
    const value = stepOf(codes[j]);
    const count = picks.length - 1;
    const delta = value < 0 ? -1 : (value - (count % SYNC_CYCLE) + SYNC_CYCLE) % SYNC_CYCLE;
    if (delta === 0) {
      picks[count] = j; // same step re-captured: the later one has the freshest HUD
      unreadableRun = 0;
      continue;
    }
    // Past the last wanted step: only later captures of it (above) matter.
    if (picks.length >= wanted) break;
    if (delta < 0 || delta > MAX_ADVANCE) {
      glitches += 1;
      unreadableRun += 1;
      continue;
    }
    unreadableRun = 0;
    for (let m = 1; m < delta && picks.length < wanted; m++) {
      picks.push(picks[count]);
      missing += 1;
    }
    if (picks.length < wanted) picks.push(j);
  }
  return { picks, missing, glitches };
}

export interface Rect {
  w: number;
  h: number;
  x: number;
  y: number;
}

export interface Geometry {
  crop: Rect;
  probes: Rect[];
}

/** Throws unless the app window can hold a 9:16 viewport above the sync strip. */
export function checkViewport(
  window: { width: number; height: number },
  viewport: { width: number; height: number },
): void {
  if (Math.abs(viewport.height / viewport.width - 16 / 9) > (16 / 9) * 0.005) {
    throw new Error(
      `Unsupported device: its ${window.width}×${window.height} pt window can't fit a 9:16 ` +
        'viewport above the sync strip — use a taller iPhone (e.g. iPhone 17 Pro).',
    );
  }
}

/**
 * Pixel rectangles for the 9:16 viewport and the strip probes in a capture
 * of the whole device window. The crop is kept inside the viewport with even
 * offsets and sizes (yuv420p would otherwise round it outward and pull in a
 * hairline of whatever is above). Throws for devices this layout doesn't fit
 * (non-9:16 viewport, letterboxed app window).
 */
export function geometry(
  window: { width: number; height: number },
  viewport: { width: number; height: number },
  video: { width: number; height: number },
): Geometry {
  checkViewport(window, viewport);
  const scale = video.width / window.width;
  if (Math.abs(video.height / window.height - scale) > scale * 0.005) {
    throw new Error(
      `Unsupported device: the capture (${video.width}×${video.height}) isn't the app window ` +
        `(${window.width}×${window.height} pt) scaled evenly — is the app letterboxed (iPad)?`,
    );
  }
  const px = (pt: number) => pt * scale;
  const stripTop = window.height - SYNC_STRIP_PT;
  const top = 2 * Math.ceil(px(stripTop - viewport.height) / 2);
  const bottom = Math.floor(px(stripTop));
  const w = 2 * Math.floor(px(viewport.width) / 2);
  const crop: Rect = { w, h: 2 * Math.floor((bottom - top) / 2), x: 0, y: top };
  const y = Math.round(px(stripTop + SYNC_PROBE_ROW_INSET_PT));
  const h = Math.round(px(SYNC_STRIP_PT - 2 * SYNC_PROBE_ROW_INSET_PT));
  const probes = syncProbesPt(window.width).map(([x, width]) => ({
    x: Math.round(px(x)),
    w: Math.round(px(width)),
    y,
    h,
  }));
  return { crop, probes };
}

/**
 * Steps of lookback before a highlight's first frame: events that happened
 * before the clip opens can still be on screen at t = 0 (a zone banner stays
 * up ZONE_BANNER_S) or still sounding (the longest sample is 1.7 s).
 */
export const TIMELINE_LOOKBACK_STEPS = Math.ceil(Math.max(ZONE_BANNER_S, 1.8) * FPS);

export interface TimelineEntry {
  /** Seconds into the mp4 (negative = began before the clip opened). */
  t: number;
  /** Clip step. */
  step: number;
  type: string;
  attempt: number;
  [field: string]: unknown;
}

/** Every attempt's events on the clip timeline, with attempt markers. */
export function clipTimeline(take: Take): TimelineEntry[] {
  const at = (step: number) => +(step / FPS).toFixed(3);
  const timeline: TimelineEntry[] = [];
  take.attempts.forEach((a, attempt) => {
    // Frame k of the mp4 is the state after k steps. Attempt 0 is on screen
    // from frame 0; a retry is installed inside step startStep, so it first
    // shows one frame later.
    const shown = attempt === 0 ? a.startStep : a.startStep + 1;
    timeline.push({ t: at(shown), step: a.startStep, type: 'attemptStart', attempt });
    let passed = 0;
    let visibleJumps = 0;
    for (const e of a.events) {
      if (e.type === 'capture' && e.planetId > passed) {
        passed = e.planetId;
        if (e.step >= a.skipSteps) visibleJumps += 1;
      }
      // An event at run step s shows (and sounds) from clip step clipStepOf(s) + 1.
      if (e.step < a.skipSteps - TIMELINE_LOOKBACK_STEPS) continue;
      const step = clipStepOf(a, e.step);
      timeline.push({ ...e, t: at(step + 1), step, attempt });
    }
    const end = attemptEnd(a);
    timeline.push({
      t: at(end),
      step: end,
      type: 'attemptEnd',
      attempt,
      // Landings shown in the clip (a highlight's fast-forwarded ones excluded).
      jumps: visibleJumps,
      runJumps: a.jumps,
      ...a.expected,
    });
  });
  return timeline;
}
