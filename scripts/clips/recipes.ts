// Clip recipes: turn a request ("bad player, fail montage") into a Take.
//
// - bad / decent → a montage of attempts. Each attempt is its own run with a
//   scripted death after a chosen number of jumps; retries follow the death
//   card the way an annoyed player hammers "TAP TO TRY AGAIN".
// - pro → one highlight run that opens partway in (big score, heat, faster
//   laps) and is picked from several candidates for its quick jumps and skips.
//
// Everything is seeded: same request + seed = same take.
// See plans/clip-styles.md.

import { CLIP_DT } from '../../src/clip/replay';
import { attemptEnd, type Attempt, type Take, type TakeEvent } from '../../src/clip/take';
import { DEATH_OVERLAY_DELAY_MS, DECAY_FREE_PLANETS } from '../../src/game/constants';
import type { DeathCause } from '../../src/game/types';
import { BotRng, hasBackwardLanding, playRun, type Run } from './bot';
import { PROFILES, type Skill } from './profiles';

export interface ClipRequest {
  skill: Skill;
  width: number;
  height: number;
  seed: number;
  /** Montage: number of tries. */
  attempts?: number;
  /** Montage: jumps per try, inclusive range. */
  jumps?: [number, number];
  /** Highlight: the clip opens on the first landing at/after this planet. */
  startAt?: number;
  /** Target clip length (montages: an upper bound). */
  seconds?: number;
  /** Death cause of the final attempt. */
  cause?: DeathCause;
  /** The final death skims a ring. */
  nearMiss?: boolean;
  bestScore?: number;
}

/** Seconds of death card the recorder keeps after the final death. */
const DEATH_HOLD_S = 2.5;
/** Shown when buildClip finds nothing. */
export const NO_CLIP_HINT =
  'No clip matched that request — try another --seed, a longer --seconds or fewer --attempts ' +
  '(a burned ending adds ~8–12 s of circling).';
/** The death card is fully visible this long after a death (GameScreen: delay + 300 ms fade). */
const CARD_SHOWN_S = DEATH_OVERLAY_DELAY_MS / 1000 + 0.3;

const MONTAGE = {
  bad: { attempts: [4, 6] as [number, number], jumps: [0, 3] as [number, number], seconds: 25 },
  decent: { attempts: [2, 3] as [number, number], jumps: [2, 6] as [number, number], seconds: 30 },
};
const HIGHLIGHT = { seconds: 25, startAt: [25, 40] as [number, number], candidates: 16 };

/** Assemblies tried per attempt count (most tries first). */
const ASSEMBLY_TRIES = 30;
const ATTEMPT_TRIES = 60;
/** Montage tries must get going: first tap within this long of the run starting. */
const MAX_OPENING_S = 1.6;
/** Pro highlights open mid-jump, this many steps before the first landing. */
const OPEN_BEFORE_LANDING = 18;
/** …and are cut this many steps after their last landing (before the next release)… */
const CUT_AFTER_LANDING = 30;
/** …keeping at least this much of the landing burst. */
const MIN_LANDING_TAIL = 10;
/** A pro clip's length (held death card included) stays within this share of --seconds. */
const LENGTH_RANGE: [number, number] = [0.8, 1.1];
/** Landings tried (latest first) as the one before a pro's scripted mistake. */
const DEATH_LANDING_TRIES = 8;
/** Burned endings: keep the quickest of this many burns (they can circle for 8–14 s). */
const BURN_CANDIDATES = 10;
/** Near misses clear the ring by at most this many px (see bot.ts NEAR_MISS_PX). */
const NEAR_MISS_MAX_PX = 7;

const toSteps = (seconds: number) => Math.round(seconds / CLIP_DT);

/** Clip length in seconds, including the held final death card. */
export function clipSeconds(take: Take): number {
  return (take.endStep + take.holdSteps) * CLIP_DT;
}

export const MAX_ATTEMPTS = 12;
const MAX_JUMPS = 60;

/** Throws a usage error for requests no recipe can satisfy (before anything boots). */
export function validateRequest(req: Omit<ClipRequest, 'width' | 'height'>): void {
  const bad = (msg: string) => {
    throw new Error(msg);
  };
  if (
    req.attempts !== undefined &&
    (!Number.isInteger(req.attempts) || req.attempts < 1 || req.attempts > MAX_ATTEMPTS)
  ) {
    bad(`--attempts must be a whole number from 1 to ${MAX_ATTEMPTS}`);
  }
  if (req.jumps !== undefined) {
    const [lo, hi] = req.jumps;
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || lo > hi || hi > MAX_JUMPS) {
      bad(`--jumps must be N or A-B with 0 ≤ A ≤ B ≤ ${MAX_JUMPS}`);
    }
  }
  if (req.nearMiss === true && req.cause !== undefined && req.cause !== 'lost') {
    bad('--near-miss means the final flight skims a ring and flies off (--cause lost)');
  }
  if (req.seconds !== undefined && !(req.seconds > 0)) bad('--seconds must be > 0');
  if (req.startAt !== undefined && (!Number.isInteger(req.startAt) || req.startAt < 0)) {
    bad('--start-at must be a whole number ≥ 0');
  }
  if (req.bestScore !== undefined && (!Number.isInteger(req.bestScore) || req.bestScore < 0)) {
    bad('--best must be a whole number ≥ 0');
  }
  if (req.cause === 'burned' && req.skill !== 'pro') {
    const hi = (req.jumps ?? MONTAGE[req.skill].jumps)[1];
    // The orbit only decays from planet DECAY_FREE_PLANETS on, so the last
    // try has to get that far to burn up.
    if (hi < DECAY_FREE_PLANETS) {
      bad(`--cause burned needs the last try to reach planet ${DECAY_FREE_PLANETS} (--jumps …-${DECAY_FREE_PLANETS} or more)`);
    }
  }
}

/** A miss must fly off a side edge (the bot only falls back to the bottom edge). */
function missesOffSide(run: Run): boolean {
  if (run.expected.deathCause !== 'lost') return true;
  const death = run.events.findLast((e) => e.type === 'death');
  return death?.type === 'death' && death.exit === 'side';
}

const holdFor = (attempt: Attempt) =>
  attempt.expected.deathCause !== null ? toSteps(DEATH_HOLD_S) : 0;

function toAttempt(run: Run, startStep: number, skipSteps: number): Attempt {
  return {
    seed: run.seed,
    startStep,
    skipSteps,
    taps: run.taps,
    endStep: run.endStep,
    jumps: run.jumps,
    expected: run.expected,
    events: run.events,
    missMargin: run.missMargin,
  };
}

// --- montages (bad / decent) -------------------------------------------------

function jumpTargets(skill: Skill, n: number, [lo, hi]: [number, number], rng: BotRng): number[] {
  if (skill === 'bad') {
    // Mostly early fails — at least one instant fail, but at most half of
    // the non-final tries, spread out (so it doesn't look like the same death
    // on loop); the last try gets furthest and hurts most.
    const targets: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const u = rng.next();
      targets.push(Math.min(hi, lo + Math.floor(u * u * (hi - lo + 1))));
    }
    if (lo === 0 && hi > 0 && targets.length > 0) {
      if (!targets.includes(0)) targets[rng.int(0, targets.length - 1)] = 0;
      const maxInstant = Math.max(1, Math.floor(targets.length / 2));
      for (;;) {
        const zeros = targets.flatMap((j, k) => (j === 0 ? [k] : []));
        if (zeros.length <= maxInstant) break;
        targets[zeros[rng.int(0, zeros.length - 1)]] = Math.min(hi, lo + 1);
      }
      spreadZeros(targets, rng);
    }
    targets.push(hi);
    return targets;
  }
  // Decent: a few tries that get better — the story is "getting the hang of it".
  const targets = Array.from({ length: n }, () => rng.int(lo, hi));
  return targets.sort((a, b) => a - b);
}

/** Shuffle so no two instant fails are back to back (when that's possible). */
function spreadZeros(targets: number[], rng: BotRng): void {
  const adjacent = () => targets.some((j, k) => k > 0 && j === 0 && targets[k - 1] === 0);
  for (let t = 0; t < 30 && adjacent(); t++) {
    for (let k = targets.length - 1; k > 0; k--) {
      const m = rng.int(0, k);
      [targets[k], targets[m]] = [targets[m], targets[k]];
    }
  }
}

/** Steps from the last landing to the death: how long a burned ending circles. */
function campSteps(run: Run): number {
  const lastLanding = run.events.findLast((e) => e.type === 'capture')?.step ?? 0;
  return run.endStep - lastLanding;
}

function findAttemptRun(
  req: ClipRequest,
  rng: BotRng,
  jumps: number,
  first: boolean,
  final: boolean,
): Run | null {
  const profile = PROFILES[req.skill];
  // Bad's last try is a near miss unless another ending was asked for.
  const nearMiss =
    final &&
    (req.nearMiss ??
      (req.skill === 'bad' && (req.cause === undefined || req.cause === 'lost')));
  const cause = final ? (req.cause ?? (nearMiss ? 'lost' : undefined)) : undefined;
  // A try may take as long as the whole clip is allowed to (60 s at least).
  const maxSteps = toSteps(Math.max(60, req.seconds ?? MONTAGE[req.skill as 'bad'].seconds));
  let quickestBurn: Run | null = null;
  let burns = 0;
  for (let i = 0; i < ATTEMPT_TRIES; i++) {
    const run = playRun({
      skill: req.skill,
      seed: rng.int(0, 2 ** 31 - 1),
      botSeed: rng.int(0, 2 ** 31 - 1),
      width: req.width,
      height: req.height,
      maxSteps,
      startDelayS: first ? undefined : profile.retryDelayS,
      dieAfterJumps: jumps,
      cause,
      nearMiss,
    });
    if (run.expected.deathCause === null || run.jumps !== jumps) continue;
    if (cause !== undefined && run.expected.deathCause !== cause) continue;
    if (hasBackwardLanding(run.events)) continue; // never a jump back down
    if (!missesOffSide(run)) continue;
    // No dead air: a quick opening, and nobody circles a planet twice.
    const releases = run.events.filter((e) => e.type === 'release');
    if (releases.length > 0 && releases[0].step > toSteps(MAX_OPENING_S)) continue;
    if (releases.some((e) => e.type === 'release' && e.revolutions > 1)) continue;
    if (cause !== 'burned') return run;
    // A burn is circling by definition — keep the quickest one found.
    if (quickestBurn === null || campSteps(run) < campSteps(quickestBurn)) quickestBurn = run;
    if (++burns >= BURN_CANDIDATES) break;
  }
  return quickestBurn;
}

function buildMontage(req: ClipRequest, skill: 'bad' | 'decent'): Take | null {
  const defaults = MONTAGE[skill];
  const profile = PROFILES[skill];
  const rng = new BotRng(req.seed);
  const budget = req.seconds ?? defaults.seconds;

  // As many tries as fit the length budget — more fails is the point. A
  // burned ending eats ~10 s of the budget, so it may take as few as two.
  const [fewest, most]: [number, number] =
    req.attempts !== undefined
      ? [req.attempts, req.attempts]
      : [req.cause === 'burned' ? 2 : defaults.attempts[0], defaults.attempts[1]];
  for (let t = 0; t < ASSEMBLY_TRIES * (most - fewest + 1); t++) {
    const n = most - Math.floor(t / ASSEMBLY_TRIES);
    const targets = jumpTargets(skill, n, req.jumps ?? defaults.jumps, rng);
    // The orbit only decays from planet DECAY_FREE_PLANETS on: a burned
    // ending needs the last try to get that far (validateRequest ensured it can).
    if (req.cause === 'burned') targets[n - 1] = Math.max(targets[n - 1], DECAY_FREE_PLANETS);
    const attempts: Attempt[] = [];
    let startStep = 0;
    for (let i = 0; i < n; i++) {
      const run = findAttemptRun(req, rng, targets[i], i === 0, i === n - 1);
      if (run === null) break;
      const attempt = toAttempt(run, startStep, 0);
      attempts.push(attempt);
      startStep = attemptEnd(attempt) + toSteps(CARD_SHOWN_S + rng.range(profile.retryGapS));
      if (attemptEnd(attempt) * CLIP_DT > budget) break; // already too long
    }
    if (attempts.length < n) continue;

    const best = Math.max(...attempts.map((a) => a.expected.score));
    const take: Take = {
      version: 2,
      width: req.width,
      height: req.height,
      attempts,
      endStep: attemptEnd(attempts[n - 1]),
      holdSteps: holdFor(attempts[n - 1]),
      bestScore: req.bestScore ?? best + (skill === 'bad' ? rng.int(3, 9) : rng.int(5, 15)),
      meta: { profile: skill, seed: req.seed },
    };
    if (clipSeconds(take) <= budget) return take;
  }
  return null;
}

// --- highlight (pro) ------------------------------------------------------------

interface Highlight {
  run: Run;
  skipSteps: number;
  rating: number;
}

/** How good the visible stretch looks: quick jumps, skips, heat, no camping. */
function rateStretch(events: TakeEvent[], from: number, to: number): number {
  let releases = 0;
  let quick = 0;
  let slow = 0;
  let captures = 0;
  let skipping = 0;
  let heat = 0;
  let chain = 0;
  let longestChain = 0;
  for (const e of events) {
    if (e.step < from || e.step >= to) continue;
    if (e.type === 'release') {
      releases += 1;
      if (e.quick) quick += 1;
      if (e.revolutions > 1) slow += 1;
      chain = e.quick ? chain + 1 : 0;
      longestChain = Math.max(longestChain, chain);
    } else if (e.type === 'capture') {
      captures += 1;
      if (e.skips > 0) skipping += 1;
      heat += e.heat;
    }
  }
  if (releases === 0 || captures === 0) return -Infinity;
  return (
    quick / releases +
    (skipping / captures) * 1.4 +
    (heat / captures / 4) * 0.5 +
    Math.max(0, longestChain - 1) * 0.1 -
    (slow / releases) * 2
  );
}

interface Landing {
  step: number;
  /** Progressing landings up to and including this one (what playRun calls jumps). */
  jumps: number;
}

/** Landings that made progress — a backward hop is not a jump. */
function progressLandings(events: TakeEvent[]): Landing[] {
  const landings: Landing[] = [];
  let passed = 0;
  for (const e of events) {
    if (e.type !== 'capture' || e.planetId <= passed) continue;
    passed = e.planetId;
    landings.push({ step: e.step, jumps: landings.length + 1 });
  }
  return landings;
}

/**
 * Where to cut a still-alive highlight: shortly after a landing inside the
 * window, before the next release, keeping at least a bit of the landing
 * burst — so the clip ends on a landing, never mid-jump.
 */
function cutAfterLanding(landings: Landing[], events: TakeEvent[], from: number, to: number): number | null {
  for (let k = landings.length - 1; k >= 0; k--) {
    const landing = landings[k].step;
    if (landing >= to) continue;
    if (landing <= from) break;
    const nextRelease = events.find((e) => e.type === 'release' && e.step > landing)?.step ?? Infinity;
    const cut = Math.min(to, landing + CUT_AFTER_LANDING, nextRelease);
    if (cut - landing >= MIN_LANDING_TAIL) return cut;
  }
  return null;
}

function buildHighlight(req: ClipRequest): Take | null {
  const rng = new BotRng(req.seed);
  const clipSteps = toSteps(req.seconds ?? HIGHLIGHT.seconds);
  const nearMiss = req.nearMiss === true;
  const cause = req.cause ?? (nearMiss ? 'lost' : undefined);
  const dies = cause !== undefined;
  let best: Highlight | null = null;

  for (let c = 0; c < HIGHLIGHT.candidates; c++) {
    const startAt = req.startAt ?? rng.int(HIGHLIGHT.startAt[0], HIGHLIGHT.startAt[1]);
    const base = {
      skill: 'pro' as const,
      seed: rng.int(0, 2 ** 31 - 1),
      botSeed: rng.int(0, 2 ** 31 - 1),
      width: req.width,
      height: req.height,
    };
    // Protected hops re-draw their timing error, so a pro almost never dies
    // before the part we show (only the rare no-window fallback tap can) —
    // one long run tells us where everything lands.
    const long = playRun({
      ...base,
      maxSteps: toSteps(startAt * 4 + 30) + clipSteps,
      surviveJumps: Infinity,
    });
    const landings = progressLandings(long.events);

    let skipSteps = 0;
    if (startAt > 0) {
      const landing = long.events.find((e) => e.type === 'capture' && e.planetId >= startAt);
      if (landing === undefined) continue;
      const release = long.events.findLast((e) => e.type === 'release' && e.step < landing.step);
      skipSteps = Math.max((release?.step ?? -1) + 1, landing.step - OPEN_BEFORE_LANDING);
    }
    const windowEnd = skipSteps + clipSteps;
    if (long.expected.deathCause !== null && long.endStep < windowEnd) continue;
    // Never a jump back down — not even in the fast-forwarded stretch.
    if (hasBackwardLanding(long.events, windowEnd)) continue;

    let run: Run | null = null;
    if (dies) {
      // Same player, same level — identical up to the scripted final mistake
      // on the hop after one of the window's landings: the latest one whose
      // death (flight, or a burn's circling) lands the clip — held death card
      // included — within LENGTH_RANGE of the asked length.
      const [shortest, longest] = LENGTH_RANGE.map((f) => f * clipSteps);
      const hold = toSteps(DEATH_HOLD_S);
      const options = landings
        .filter((l) => l.step > skipSteps && l.step - skipSteps + hold < longest)
        .slice(-DEATH_LANDING_TRIES)
        .reverse();
      for (const landing of options) {
        const dying = playRun({
          ...base,
          maxSteps: skipSteps + Math.ceil(longest) + toSteps(30),
          dieAfterJumps: landing.jumps,
          cause,
          nearMiss,
        });
        const length = dying.endStep - skipSteps + hold;
        if (dying.expected.deathCause !== cause || dying.jumps !== landing.jumps) continue;
        if (nearMiss && (dying.missMargin === null || dying.missMargin > NEAR_MISS_MAX_PX)) {
          continue;
        }
        if (length > longest || hasBackwardLanding(dying.events) || !missesOffSide(dying)) continue;
        if (length < shortest) break; // earlier landings only get shorter
        run = dying;
        break;
      }
      if (run === null) continue;
    } else {
      const cut = cutAfterLanding(landings, long.events, skipSteps, windowEnd);
      if (cut === null || cut - skipSteps < clipSteps * 0.8) continue;
      run = playRun({ ...base, maxSteps: cut, surviveJumps: Infinity });
    }

    const rating = rateStretch(run.events, skipSteps, run.endStep);
    if (best === null || rating > best.rating) best = { run, skipSteps, rating };
  }
  if (best === null) return null;

  const attempt = toAttempt(best.run, 0, best.skipSteps);
  const score = attempt.expected.score;
  return {
    version: 2,
    width: req.width,
    height: req.height,
    attempts: [attempt],
    endStep: attemptEnd(attempt),
    holdSteps: holdFor(attempt),
    // A pro run that ends in a death lands a NEW BEST.
    bestScore: req.bestScore ?? Math.floor(score * rng.range([0.6, 0.9])),
    meta: { profile: 'pro', seed: req.seed },
  };
}

export function buildClip(req: ClipRequest): Take | null {
  return req.skill === 'pro' ? buildHighlight(req) : buildMontage(req, req.skill);
}
