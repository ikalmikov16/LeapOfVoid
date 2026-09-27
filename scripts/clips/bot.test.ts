import { describe, expect, test } from 'bun:test';
import { clipViewport, replayStep, scriptFor } from '../../src/clip/replay';
import { attemptEnd } from '../../src/clip/take';
import { createInitialState } from '../../src/game/engine';
import { hasBackwardLanding, playRun, simulateClip } from './bot';
import { hopStats, visibleStats } from './make-take';
import { evaluateTap } from './oracle';
import type { Skill } from './profiles';
import { buildClip, clipSeconds } from './recipes';

const SIZE = clipViewport(402, 874);
const SKILLS: Skill[] = ['pro', 'decent', 'bad'];

function run(skill: Skill, i: number, seconds = 240) {
  return playRun({
    skill,
    seed: 1000 + i * 7919,
    botSeed: 77 + i * 104729,
    ...SIZE,
    maxSteps: seconds * 60,
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function clips(skill: Skill, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const take = buildClip({ skill, ...SIZE, seed: 300 + i * 31 });
    expect(take).not.toBeNull();
    return take!;
  }, 60_000);
}

describe('clip viewport', () => {
  test('is 9:16 on the recorder device', () => {
    expect(SIZE).toEqual({ width: 402, height: 715 });
  }, 60_000);
});

describe('oracle', () => {
  test('evaluating a tap never touches the live state', () => {
    let state = createInitialState(SIZE.width, SIZE.height, 42);
    for (let i = 0; i < 200; i++) {
      const before = JSON.stringify(state);
      evaluateTap(state, true);
      expect(JSON.stringify(state)).toBe(before);
      state = replayStep(state, false);
    }
  }, 60_000);

  test('a lost flight reports its closest on-screen ring pass, even under 1 px', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 400; seed++) {
      let state = createInitialState(SIZE.width, SIZE.height, seed);
      for (let i = 0; i < 400 && state.phase === 'orbiting'; i++, state = replayStep(state, false)) {
        const o = evaluateTap(state, true);
        if (o.result !== 'lost' || !Number.isFinite(o.missMargin)) continue;
        const vx = -Math.sin(state.angle) * state.direction;
        const vy = Math.cos(state.angle) * state.direction;
        for (const p of state.planets) {
          if (p.id === state.currentPlanetId) continue;
          const dx = p.center.x - state.ballPos.x;
          const dy = p.center.y - state.ballPos.y;
          const onScreen =
            p.center.y + p.ringRadius > state.cameraY && p.center.y < state.cameraY + state.height;
          const margin = Math.abs(dx * vy - dy * vx) - p.ringRadius;
          if (dx * vx + dy * vy > 0 && onScreen && margin > 0) {
            expect(o.missMargin).toBeLessThanOrEqual(margin + 1e-9);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  }, 60_000);

  test('the ray-cast shortcut agrees with flying the jump', () => {
    let state = createInitialState(SIZE.width, SIZE.height, 7);
    for (let i = 0; i < 300 && state.phase === 'orbiting'; i++) {
      const quick = evaluateTap(state);
      if (quick.flightSteps === 0) {
        // Skipped forks claim "no capture of anything on screen".
        const exact = evaluateTap(state, true);
        expect(exact.result === 'capture' && exact.flightSteps < 120).toBe(false);
      }
      state = replayStep(state, false);
    }
  }, 60_000);
});

describe('runs', () => {
  test('taps are ascending and humanly spaced', () => {
    for (const skill of SKILLS) {
      for (let i = 0; i < 25; i++) {
        const { taps } = run(skill, i, 90);
        for (let t = 1; t < taps.length; t++) {
          expect(taps[t] - taps[t - 1]).toBeGreaterThanOrEqual(12); // ≥ 200 ms
        }
      }
    }
  }, 60_000);

  test('the death event lands on the last simulated step', () => {
    const r = run('bad', 3);
    const death = r.events[r.events.length - 1];
    expect(death.type).toBe('death');
    expect(death.step).toBe(r.endStep - 1);
  }, 60_000);

  test('scripted deaths happen after exactly the asked number of jumps, how they were asked', () => {
    for (const cause of ['crash', 'lost', 'burned'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const r = playRun({
          skill: 'decent',
          seed,
          botSeed: seed * 13,
          ...SIZE,
          maxSteps: 90 * 60,
          dieAfterJumps: 4,
          cause,
        });
        expect(r.expected.deathCause).toBe(cause);
        // A death that can't be found on one orbit hops on and tries the next.
        expect(r.jumps).toBeGreaterThanOrEqual(4);
        expect(r.jumps).toBeLessThanOrEqual(6);
      }
    }
  }, 60_000);
});

describe('skill profiles', () => {
  test('pro > decent > bad, by a wide margin', () => {
    const medians = Object.fromEntries(
      SKILLS.map((skill) => [
        skill,
        median(Array.from({ length: 120 }, (_, i) => run(skill, i).expected.planetsPassed)),
      ]),
    );
    expect(medians.pro).toBeGreaterThanOrEqual(35);
    expect(medians.decent).toBeGreaterThanOrEqual(6);
    expect(medians.decent).toBeLessThanOrEqual(25);
    expect(medians.bad).toBeLessThanOrEqual(5);
  }, 60_000);

  test('a must-survive hop with no window takes a safe landing instead of a fatal tap', () => {
    // Runs the review found dying on protected hops.
    const pro = playRun({ skill: 'pro', seed: 9008903, botSeed: 119076972, ...SIZE, maxSteps: 240 * 60, surviveJumps: Infinity });
    expect(pro.expected.deathCause).toBeNull();
    const bad = playRun({ skill: 'bad', seed: 7290480, botSeed: 96350779, ...SIZE, maxSteps: 240 * 60, surviveJumps: Infinity });
    expect(bad.expected.deathCause).toBeNull();
  }, 60_000);

  test('pro waits past a lap only when the first lap offers no window at all', () => {
    let releases = 0;
    let late = 0;
    for (let i = 0; i < 60; i++) {
      const r = playRun({
        skill: 'pro',
        seed: 3000 + i,
        botSeed: 11 + i,
        ...SIZE,
        maxSteps: 120 * 60,
        surviveJumps: Infinity,
      });
      for (const e of r.events) {
        if (e.type !== 'release') continue;
        releases += 1;
        if (e.revolutions > 1) late += 1;
      }
    }
    // Pro never hesitates; with the lap counted from the landing (horizon
    // step excluded), ~5 % of hops simply have no window in lap 1.
    expect(late / releases).toBeLessThan(0.08);
  }, 60_000);

  test('nobody circles a planet more than once (much)', () => {
    const limits: Record<Skill, number> = { pro: 0.08, decent: 0.15, bad: 0.15 };
    for (const skill of SKILLS) {
      let releases = 0;
      let slow = 0;
      for (let i = 0; i < 80; i++) {
        const s = hopStats(run(skill, i, 90).events);
        releases += s.releases;
        slow += s.slow;
      }
      expect(slow / releases).toBeLessThanOrEqual(limits[skill]);
    }
  }, 60_000);
});

describe('clips', () => {
  test('replaying a clip reproduces every attempt exactly', () => {
    for (const skill of SKILLS) {
      for (const take of clips(skill, 6)) {
        expect(simulateClip(take)).toEqual(take.attempts.map((a) => a.expected));
      }
    }
  }, 60_000);

  test('attempts sit on one timeline, each after the previous death card', () => {
    for (const take of clips('bad', 8)) {
      for (let k = 1; k < take.attempts.length; k++) {
        const gap = take.attempts[k].startStep - attemptEnd(take.attempts[k - 1]);
        expect(gap).toBeGreaterThanOrEqual(50); // card visible ≥ ~0.8 s
      }
      const script = scriptFor(take);
      expect(script.endStep).toBe(attemptEnd(take.attempts[take.attempts.length - 1]));
    }
  }, 60_000);

  test('bad = a montage of quick fails', () => {
    for (const take of clips('bad', 12)) {
      const jumps = take.attempts.map((a) => a.jumps);
      expect(jumps.length).toBeGreaterThanOrEqual(4);
      expect(jumps.length).toBeLessThanOrEqual(6);
      expect(Math.max(...jumps)).toBeLessThanOrEqual(3);
      expect(jumps).toContain(0);
      expect(jumps[jumps.length - 1]).toBe(3);
      expect(take.attempts.every((a) => a.expected.deathCause !== null)).toBe(true);
      expect(take.attempts[take.attempts.length - 1].missMargin!).toBeLessThanOrEqual(7);
      expect(take.bestScore).toBeGreaterThan(Math.max(...take.attempts.map((a) => a.expected.score)));
      expect(clipSeconds(take)).toBeLessThanOrEqual(25);
      expect(visibleStats(take).slow).toBe(0);
    }
  }, 60_000);

  test('decent = a few tries of 2–6 jumps, with some skips', () => {
    let skipping = 0;
    for (const take of clips('decent', 12)) {
      const jumps = take.attempts.map((a) => a.jumps);
      expect(jumps.length).toBeGreaterThanOrEqual(2);
      expect(jumps.length).toBeLessThanOrEqual(3);
      for (const j of jumps) {
        expect(j).toBeGreaterThanOrEqual(2);
        expect(j).toBeLessThanOrEqual(6);
      }
      expect(clipSeconds(take)).toBeLessThanOrEqual(30);
      expect(visibleStats(take).slow).toBe(0);
      skipping += visibleStats(take).skipping;
    }
    expect(skipping).toBeGreaterThan(0);
  }, 60_000);

  test('pro = a quick, skip-chaining highlight that opens mid-run', () => {
    let releases = 0;
    let quick = 0;
    let captures = 0;
    let skipping = 0;
    for (const take of clips('pro', 8)) {
      expect(take.attempts).toHaveLength(1);
      const a = take.attempts[0];
      expect(a.skipSteps).toBeGreaterThan(0);
      const firstLanding = a.events.find((e) => e.type === 'capture' && e.step >= a.skipSteps);
      expect(firstLanding?.type === 'capture' && firstLanding.planetId >= 25).toBe(true);
      expect(a.expected.deathCause).toBeNull();
      const s = visibleStats(take);
      releases += s.releases;
      quick += s.quick;
      captures += s.captures;
      skipping += s.skipping;
    }
    expect(quick / releases).toBeGreaterThanOrEqual(0.3);
    expect(skipping / captures).toBeGreaterThanOrEqual(0.45);
  }, 60_000);

  test('pro can open from the start and end in a requested death', () => {
    const take = buildClip({ skill: 'pro', ...SIZE, seed: 5, startAt: 0, cause: 'crash' })!;
    expect(take.attempts[0].skipSteps).toBe(0);
    expect(take.attempts[0].expected.deathCause).toBe('crash');
    expect(simulateClip(take)).toEqual([take.attempts[0].expected]);
  }, 60_000);

  test('single-value and degenerate --jumps requests terminate (used to spin forever)', () => {
    for (const jumps of [[0, 0], [1, 1], [2, 2]] as [number, number][]) {
      const take = buildClip({ skill: 'bad', ...SIZE, seed: 1, jumps, attempts: 3 });
      expect(take).not.toBeNull();
      expect(take!.attempts.map((a) => a.jumps)).toEqual([jumps[0], jumps[0], jumps[0]]);
    }
  }, 60_000);

  test('bad montages keep at most half their non-final tries instant, not back to back', () => {
    for (const take of clips('bad', 16)) {
      const tries = take.attempts.slice(0, -1).map((a) => a.jumps);
      const zeros = tries.filter((j) => j === 0).length;
      expect(zeros).toBeGreaterThanOrEqual(1);
      expect(zeros).toBeLessThanOrEqual(Math.max(1, Math.floor(tries.length / 2)));
      expect(tries.some((j, k) => k > 0 && j === 0 && tries[k - 1] === 0)).toBe(false);
    }
  }, 60_000);

  test('pro scripted endings: the asked death, 80–110 % of the asked length (hold included)', () => {
    for (const ending of [{ nearMiss: true }, { cause: 'crash' as const }, { cause: 'burned' as const }]) {
      for (let seed = 1; seed <= 4; seed++) {
        const take = buildClip({ skill: 'pro', ...SIZE, seed, ...ending })!;
        expect(take).not.toBeNull();
        const a = take.attempts[0];
        expect(a.expected.deathCause).toBe(ending.cause ?? 'lost');
        if (ending.nearMiss) expect(a.missMargin!).toBeLessThanOrEqual(7);
        expect(take.holdSteps).toBe(150);
        const seconds = clipSeconds(take);
        expect(seconds).toBeGreaterThanOrEqual(25 * 0.8 - 0.02);
        expect(seconds).toBeLessThanOrEqual(25 * 1.1 + 0.02);
      }
    }
  }, 60_000);

  test('decent --cause burned lets the last try reach the planet where orbits decay', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const take = buildClip({ skill: 'decent', ...SIZE, seed, cause: 'burned', jumps: [0, 3] })!;
      const last = take.attempts[take.attempts.length - 1];
      expect(last.expected.deathCause).toBe('burned');
      expect(last.jumps).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);

  test('pro --cause gives exactly that death, and alive highlights end on a landing', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const crash = buildClip({ skill: 'pro', ...SIZE, seed, cause: 'crash' })!;
      expect(crash.attempts[0].expected.deathCause).toBe('crash');
      const alive = buildClip({ skill: 'pro', ...SIZE, seed })!;
      const a = alive.attempts[0];
      const last = a.events.filter((e) => e.type === 'release' || e.type === 'capture').pop()!;
      expect(last.type).toBe('capture');
      expect(a.endStep - last.step).toBeGreaterThanOrEqual(10);
      expect(alive.holdSteps).toBe(0);
    }
  }, 60_000);

  test('bad --cause burned finds a clip and burns on the last try', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const take = buildClip({ skill: 'bad', ...SIZE, seed, cause: 'burned' });
      expect(take).not.toBeNull();
      expect(take!.attempts[take!.attempts.length - 1].expected.deathCause).toBe('burned');
      expect(clipSeconds(take!)).toBeLessThanOrEqual(25);
    }
  }, 60_000);

  test('no clip ever jumps back down to a lower planet', () => {
    for (const skill of SKILLS) {
      for (const take of clips(skill, 10)) {
        for (const a of take.attempts) expect(hasBackwardLanding(a.events)).toBe(false);
      }
    }
  }, 120_000);

  test('most deaths are misses that fly off a side edge, not crashes', () => {
    const kinds: Record<string, number> = {};
    for (const skill of ['bad', 'decent'] as const) {
      for (const take of clips(skill, 16)) {
        for (const a of take.attempts) {
          const death = a.events.find((e) => e.type === 'death');
          if (death?.type !== 'death') continue;
          const kind = death.cause === 'lost' ? `miss-${death.exit}` : death.cause;
          kinds[kind] = (kinds[kind] ?? 0) + 1;
        }
      }
    }
    const total = Object.values(kinds).reduce((a, b) => a + b, 0);
    expect((kinds['miss-side'] ?? 0) / total).toBeGreaterThanOrEqual(0.7);
    expect((kinds.crash ?? 0) / total).toBeLessThanOrEqual(0.3);
  }, 120_000);

  test('pro near misses fly off a side edge', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const a = buildClip({ skill: 'pro', ...SIZE, seed, nearMiss: true })!.attempts[0];
      const death = a.events.find((e) => e.type === 'death');
      expect(death?.type === 'death' && death.exit).toBe('side');
    }
  }, 120_000);

  test('same request + seed = same take', () => {
    for (const skill of SKILLS) {
      expect(buildClip({ skill, ...SIZE, seed: 99 })).toEqual(
        buildClip({ skill, ...SIZE, seed: 99 }),
      );
    }
  }, 60_000);
});
