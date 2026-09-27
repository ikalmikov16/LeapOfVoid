// The headless player. Plays the real engine under bun, one fixed step at a
// time, and returns the run (seed + tap steps) so the app's clip mode can
// replay it exactly. Recipes (recipes.ts) stitch runs into clips.
// See plans/gameplay-recorder.md §3.1–3.2 and plans/clip-styles.md.

import { QUICK_WINDOW_REVOLUTIONS } from '../../src/game/constants';
import {
  CLIP_DT,
  installAttempt,
  replayStep,
  resultOf,
  scriptFor,
} from '../../src/clip/replay';
import type { Take, TakeEvent, TakeResult } from '../../src/clip/take';
import { orbitAngularSpeed, orbitDecayRate } from '../../src/game/difficulty';
import { createInitialState } from '../../src/game/engine';
import type { DeathCause, GameState } from '../../src/game/types';
import { evaluateTap, exitOf, type TapOutcome } from './oracle';
import { PROFILES, type Profile, type Skill } from './profiles';

export interface RunSpec {
  skill: Skill;
  seed: number;
  botSeed: number;
  width: number;
  height: number;
  /** Cut the run here if it is still alive. */
  maxSteps: number;
  /** Opening-tap delay; defaults to the profile's fresh-run delay. */
  startDelayS?: [number, number];
  /** No deaths before this many jumps (timing error is re-drawn instead). */
  surviveJumps?: number;
  /** Force a death on the first hop after this many jumps (none before). */
  dieAfterJumps?: number;
  cause?: DeathCause;
  /** Forced 'lost' deaths skim a ring instead of missing by a mile. */
  nearMiss?: boolean;
  /** Forced crash/lost deaths must resolve within this many steps. */
  maxDeathFlightSteps?: number;
}

/** One played run. `jumps` = landings that made progress. */
export interface Run {
  seed: number;
  botSeed: number;
  taps: number[];
  endStep: number;
  jumps: number;
  expected: TakeResult;
  events: TakeEvent[];
  missMargin: number | null;
}

const STEP_MS = CLIP_DT * 1000;
/** Captures closer than this to a band edge are re-aimed: bun (JSC) and the
 * app (Hermes) may disagree in the last float bit, never by this much. */
const MIN_BAND_MARGIN = 0.01;
const NEAR_MISS_PX: [number, number] = [0.3, 7];
/** A plain miss clears every visible ring by at least this much — however far. */
const CLEAR_MISS_PX: [number, number] = [7, Infinity];
/**
 * Unscripted-cause deaths: this share are misses — the jump misses every
 * orbit and the ball flies off a side edge — and the rest crashes. (The
 * user wants misses to be the typical death; they read better on video.)
 */
const MISS_SHARE = 0.8;
/** Random taps (blunders, no window) re-draw this often to avoid a backward landing. */
const RANDOM_TAP_DRAWS = 20;
/** Default cap on a scripted death's flight: 1.5 s — no drifting off for ages. */
const DEATH_FLIGHT_STEPS = 90;
const PROTECT_REDRAWS = 40;
/** How far a must-survive hop with no window looks for any safe landing. */
const FALLBACK_LAPS = 6;

export class BotRng {
  private a: number;
  constructor(seed: number) {
    this.a = seed | 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range([min, max]: [number, number]): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  gauss(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
function phi(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Consecutive tap steps that all land on the same forward planet, all quick or all not. */
interface Window {
  start: number;
  end: number;
  planetId: number;
  advance: number;
  quick: boolean;
}

/** The no-tap future of the current orbit, with tap outcomes evaluated lazily. */
class OrbitScan {
  private readonly states: GameState[];
  private readonly outcomes = new Map<number, TapOutcome>();

  constructor(
    state: GameState,
    private readonly fromStep: number,
  ) {
    this.states = [state];
  }

  /** State just before absolute step `step`, or null once the orbit has burned. */
  stateAt(step: number): GameState | null {
    const k = step - this.fromStep;
    if (k < 0) return null;
    while (this.states.length <= k) {
      const last = this.states[this.states.length - 1];
      if (last.phase !== 'orbiting') return null;
      this.states.push(replayStep(last, false));
    }
    return this.states[k].phase === 'orbiting' ? this.states[k] : null;
  }

  outcomeAt(step: number, exact = false): TapOutcome | null {
    const cached = this.outcomes.get(step);
    if (cached !== undefined && (!exact || cached.flightSteps > 0)) return cached;
    const state = this.stateAt(step);
    if (state === null) return null;
    const outcome = evaluateTap(state, exact);
    this.outcomes.set(step, outcome);
    return outcome;
  }

  windows(from: number, to: number): Window[] {
    const found: Window[] = [];
    let open: Window | null = null;
    for (let step = from; step <= to; step++) {
      const o = this.outcomeAt(step);
      if (o === null) break;
      const good = o.result === 'capture' && o.advance >= 1;
      const quick = this.stateAt(step)!.revolutions < QUICK_WINDOW_REVOLUTIONS;
      if (good && open !== null && open.planetId === o.planetId && open.quick === quick) {
        open.end = step;
      } else {
        if (open !== null) found.push(open);
        open = good
          ? { start: step, end: step, planetId: o.planetId, advance: o.advance, quick }
          : null;
      }
    }
    if (open !== null) found.push(open);
    return found;
  }
}

function isSafeCapture(o: TapOutcome | null): boolean {
  return o !== null && o.result === 'capture' && o.advance >= 1 && o.bandMargin >= MIN_BAND_MARGIN;
}

function pickWindow(
  windows: Window[],
  firstStep: number,
  lapSteps: number,
  profile: Profile,
  rng: BotRng,
): Window | null {
  const sigma = profile.sigmaMs / STEP_MS;
  const bias = profile.biasMs / STEP_MS;
  let best: Window | null = null;
  let bestValue = -Infinity;
  for (const w of windows) {
    const aim = (w.start + w.end) / 2 + bias;
    const pHit = phi((w.end + 0.5 - aim) / sigma) - phi((w.start - 0.5 - aim) / sigma);
    const gain = 10 + (w.advance - 1) * profile.skipValue + (w.quick ? profile.quickValue : 0);
    const wait = Math.max(0, w.start - firstStep) / lapSteps;
    const value =
      pHit * gain -
      (1 - pHit) * profile.riskAversion -
      wait * profile.impatience +
      profile.choiceNoise * rng.gauss();
    if (value > bestValue) {
      bestValue = value;
      best = w;
    }
  }
  return best;
}

/**
 * A tap that kills the way the spec asks, as close to `center` as possible
 * (a mistimed version of the intended jump, or — centered on the first
 * reactable step — a panic tap), or null if this orbit offers none.
 */
function findDeathTap(
  scan: OrbitScan,
  center: number,
  from: number,
  to: number,
  cause: 'crash' | 'lost',
  nearMiss: boolean,
  maxFlightSteps: number,
  /** 'lost' only: the ball must fly off a side edge (not the top/bottom). */
  sideExit: boolean,
): number | null {
  const [lo, hi] = nearMiss ? NEAR_MISS_PX : CLEAR_MISS_PX;
  const candidates: number[] = [];
  for (let step = from; step <= to; step++) {
    const o = scan.outcomeAt(step);
    if (o === null) break;
    if (o.result !== cause) continue;
    if (cause === 'lost' && (o.missMargin < lo || o.missMargin > hi)) continue;
    candidates.push(step);
  }
  candidates.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
  for (const step of candidates) {
    const exact = scan.outcomeAt(step, true);
    if (exact === null || exact.result !== cause || exact.flightSteps > maxFlightSteps) continue;
    // The exact flight also sees rings that scroll into view mid-flight, and
    // only counts skims inside the frame; a crash must be on screen too.
    if (cause === 'lost' && (exact.missMargin < lo || exact.missMargin > hi)) continue;
    if (cause === 'lost' && sideExit && exact.exit !== 'side') continue;
    if (cause === 'crash' && !exact.deathVisible) continue;
    return step;
  }
  return null;
}

interface HopContext {
  spec: RunSpec;
  profile: Profile;
  rng: BotRng;
  jumps: number;
  opening: boolean;
}

/** Absolute step to tap on; null = never tap (camp until the orbit burns). */
function planHop(state: GameState, step: number, ctx: HopContext): number | null {
  const { spec, profile, rng } = ctx;
  const lapSteps = (2 * Math.PI) / orbitAngularSpeed(state.planetsPassed) / CLIP_DT;
  const delay = ctx.opening ? (spec.startDelayS ?? profile.startDelayS) : profile.reactionS;
  let firstStep = step + Math.ceil(rng.range(delay) / CLIP_DT);
  // One-lap rule: only windows before the ship completes its first lap
  // around this planet (counted from the landing); look further only on a
  // rare hesitation or when this lap offers nothing at all.
  // (Exclusive of the step that would complete the lap: a tap there
  // releases a hair past one full revolution.)
  let horizon = step + Math.floor((1 - state.revolutions) * lapSteps);
  if (rng.next() < profile.hesitateChance) {
    firstStep += Math.round(lapSteps);
    horizon += Math.round(lapSteps);
  }
  const scan = new OrbitScan(state, step);
  let windows = firstStep <= horizon ? scan.windows(firstStep, horizon) : [];
  if (windows.length === 0) {
    horizon = Math.max(horizon, firstStep) + Math.ceil(lapSteps);
    windows = scan.windows(firstStep, horizon);
  }
  const target = pickWindow(windows, firstStep, lapSteps, profile, rng);

  const dying = spec.dieAfterJumps !== undefined && ctx.jumps >= spec.dieAfterJumps;
  if (dying) {
    const cause = spec.cause ?? (rng.next() < MISS_SHARE ? 'lost' : 'crash');
    if (cause === 'burned') {
      if (orbitDecayRate(state.planetsPassed) > 0) return null;
    } else {
      const nearMiss = spec.nearMiss === true;
      const panic = !nearMiss && rng.next() < profile.panicChance;
      const center = panic
        ? firstStep
        : target !== null
          ? (target.start + target.end) / 2
          : firstStep + lapSteps / 2;
      const maxFlight = spec.maxDeathFlightSteps ?? DEATH_FLIGHT_STEPS;
      // A miss should fly off a side edge; off the bottom only if this orbit
      // has no such miss, and a crash only as a last resort (or when drawn).
      type Death = [cause: 'crash' | 'lost', sideExit: boolean];
      const misses: Death[] = [
        ['lost', true],
        ['lost', false],
      ];
      const plan: Death[] =
        cause === 'crash'
          ? [['crash', false], ...(spec.cause === undefined ? misses : [])]
          : [...misses, ...(spec.cause === undefined ? [['crash', false] as Death] : [])];
      for (const [c, sideExit] of plan) {
        const tap = findDeathTap(scan, center, firstStep, horizon, c, nearMiss, maxFlight, sideExit);
        if (tap !== null) return tap;
      }
    }
    // No such death on this orbit — hop on (safely) and try the next one.
  }

  const protectedHop =
    dying ||
    ctx.jumps < (spec.surviveJumps ?? 0) ||
    (spec.dieAfterJumps !== undefined && ctx.jumps < spec.dieAfterJumps);

  /** A random tap in [firstStep, firstStep + span) that doesn't land backward. */
  const randomTap = (span: number) => {
    let tap = firstStep;
    for (let i = 0; i < RANDOM_TAP_DRAWS; i++) {
      tap = firstStep + Math.floor(rng.next() * span);
      const o = scan.outcomeAt(tap);
      if (o === null || o.result !== 'capture' || o.advance >= 1) return tap;
    }
    return tap;
  };

  if (target === null) {
    // Nothing reachable in reach: a real player eventually just goes for it
    // — unless this hop must survive, then take whatever safe landing exists.
    if (protectedHop) {
      const safe = safestFallback(scan, firstStep, lapSteps);
      if (safe !== null) return safe;
    }
    return randomTap(lapSteps);
  }

  if (!protectedHop && rng.next() < profile.blunderChance) {
    return randomTap(lapSteps * 0.5);
  }

  const aim = (target.start + target.end) / 2 + profile.biasMs / STEP_MS;
  const sigma = profile.sigmaMs / STEP_MS;
  const draw = () => Math.max(step + 1, Math.round(aim + sigma * rng.gauss()));
  /** A timing error that still lands, float-safely, within the lap. */
  const safeTap = () => {
    for (let i = 0; i < PROTECT_REDRAWS; i++) {
      const tapStep = draw();
      if (tapStep <= horizon && isSafeCapture(scan.outcomeAt(tapStep))) return tapStep;
    }
    let best = Math.round((target.start + target.end) / 2);
    let bestMargin = -Infinity;
    for (let s = target.start; s <= target.end; s++) {
      const o = scan.outcomeAt(s);
      if (isSafeCapture(o) && o!.bandMargin > bestMargin) {
        best = s;
        bestMargin = o!.bandMargin;
      }
    }
    return best;
  };

  if (!protectedHop) {
    const tapStep = draw();
    const o = scan.outcomeAt(tapStep);
    if (o === null || o.result !== 'capture' || o.bandMargin >= MIN_BAND_MARGIN) return tapStep;
    // A capture within a float's width of a band edge: bun and the phone
    // might disagree. Move to a neighbouring step with the same, safe
    // outcome — or, failing that, re-draw like a protected hop.
    const sameSafe = (s: number) => {
      const n = s > step ? scan.outcomeAt(s) : null;
      return n !== null && n.result === 'capture' && n.planetId === o.planetId && n.bandMargin >= MIN_BAND_MARGIN;
    };
    const toward = tapStep < aim ? 1 : -1;
    if (sameSafe(tapStep + toward)) return tapStep + toward;
    if (sameSafe(tapStep - toward)) return tapStep - toward;
    return safeTap();
  }

  return safeTap();
}

/**
 * For a hop that must survive but has no forward window within reach: the
 * safest forward landing anywhere before the orbit burns (or within a few
 * laps). Never a landing back on a lower planet — that's not a jump anyone
 * wants to watch; the recipes drop runs that make one.
 */
function safestFallback(scan: OrbitScan, from: number, lapSteps: number): number | null {
  const to = from + Math.ceil(lapSteps * FALLBACK_LAPS);
  let bestForward: number | null = null;
  let forwardMargin = -Infinity;
  let inWindow = false;
  for (let s = from; s <= to; s++) {
    const o = scan.outcomeAt(s);
    if (o === null) break; // the orbit has burned
    const forward = o.result === 'capture' && o.advance >= 1;
    if (inWindow && !forward) break; // the first forward window is over
    if (o.result !== 'capture' || o.bandMargin < MIN_BAND_MARGIN) continue;
    if (forward) {
      inWindow = true;
      if (o.bandMargin > forwardMargin) {
        bestForward = s;
        forwardMargin = o.bandMargin;
      }
    }
  }
  return bestForward;
}

/** Did the run ever land back on a planet at or below its best so far? */
export function hasBackwardLanding(events: TakeEvent[], beforeStep = Infinity): boolean {
  let passed = 0;
  for (const e of events) {
    if (e.step >= beforeStep) break;
    if (e.type !== 'capture') continue;
    if (e.planetId <= passed) return true;
    passed = e.planetId;
  }
  return false;
}

function diffEvents(prev: GameState, next: GameState, step: number, out: TakeEvent[]): void {
  if (next.lastReleaseAt !== prev.lastReleaseAt) {
    out.push({
      step,
      type: 'release',
      revolutions: +prev.revolutions.toFixed(3),
      quick: next.releasedQuick,
    });
  }
  if (next.lastFlybyAt !== prev.lastFlybyAt) out.push({ step, type: 'flyby', heat: next.heat });
  if (next.lastCaptureAt !== prev.lastCaptureAt) {
    out.push({
      step,
      type: 'capture',
      planetId: next.currentPlanetId,
      kind: next.captureKind,
      heat: next.heat,
      score: next.score,
      skips: next.flightSkips,
    });
  }
  if (next.zoneChangedAt !== prev.zoneChangedAt) {
    out.push({ step, type: 'zone', zoneIndex: next.zoneIndex });
  }
  if (next.phase === 'dead' && prev.phase !== 'dead' && next.deathCause !== null) {
    out.push(
      next.deathCause === 'lost'
        ? { step, type: 'death', cause: next.deathCause, exit: exitOf(next) }
        : { step, type: 'death', cause: next.deathCause },
    );
  }
}

/** Play one run of the game. */
export function playRun(spec: RunSpec): Run {
  const profile = PROFILES[spec.skill];
  const rng = new BotRng(spec.botSeed);

  let state = createInitialState(spec.width, spec.height, spec.seed);
  let step = 0;
  let jumps = 0;
  const taps: number[] = [];
  const events: TakeEvent[] = [];
  let lastTapState: GameState | null = null;

  const advance = (tap: boolean) => {
    const next = replayStep(state, tap);
    if (tap) taps.push(step);
    if (next.planetsPassed > state.planetsPassed) jumps += 1;
    diffEvents(state, next, step, events);
    state = next;
    step += 1;
  };

  while (state.phase !== 'dead' && step < spec.maxSteps) {
    if (state.phase !== 'orbiting') {
      advance(false);
      continue;
    }
    const ctx = { spec, profile, rng, jumps, opening: taps.length === 0 };
    const tapStep = planHop(state, step, ctx);
    while (
      state.phase === 'orbiting' &&
      step < spec.maxSteps &&
      (tapStep === null || step < tapStep)
    ) {
      advance(false);
    }
    if (state.phase === 'orbiting' && step < spec.maxSteps) {
      lastTapState = state;
      advance(true);
    }
  }

  // How close the fatal flight came to a ring the viewer could see (flown
  // exactly, so rings that scroll into view mid-flight count too).
  let missMargin: number | null = null;
  if (state.phase === 'dead' && state.deathCause === 'lost' && lastTapState !== null) {
    const miss = evaluateTap(lastTapState, true).missMargin;
    missMargin = Number.isFinite(miss) ? miss : null;
  }
  return {
    seed: spec.seed,
    botSeed: spec.botSeed,
    taps,
    endStep: step,
    jumps,
    expected: resultOf(state),
    events,
    missMargin,
  };
}

/**
 * Replay a whole clip exactly the way the app's clip mode does
 * (src/clip/useClipReplay.tsx, onFrame — keep the two loops in step) and
 * return each attempt's result.
 */
export function simulateClip(take: Take): TakeResult[] {
  const script = scriptFor(take);
  const results: TakeResult[] = [];
  let state = createInitialState(take.width, take.height, 0);
  let installIndex = 0;
  let tapIndex = 0;
  for (let step = 0; step < script.endStep; step++) {
    const install = script.installs[installIndex];
    if (install !== undefined && install.atStep === step) {
      state = installAttempt(take.width, take.height, install);
      installIndex += 1;
    }
    const tap = tapIndex < script.taps.length && script.taps[tapIndex] === step;
    if (tap) tapIndex += 1;
    state = replayStep(state, tap);
    if (script.reportAt[results.length] === step + 1) results.push(resultOf(state));
  }
  return results;
}
