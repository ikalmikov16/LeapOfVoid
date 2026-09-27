import { describe, expect, test } from 'bun:test';
import {
  clipViewport,
  SYNC_CYCLE,
  SYNC_PREROLL,
  syncColors,
  ZONE_BANNER_S,
} from '../../src/clip/replay';
import { parseArgs } from './args';
import { soundCues } from './audio';
import {
  clipTimeline,
  codeOf,
  geometry,
  MAX_ADVANCE,
  pickFrames,
  TIMELINE_LOOKBACK_STEPS,
} from './frames';
import { buildClip } from './recipes';

const WINDOW = { width: 402, height: 874 };
const SIZE = clipViewport(WINDOW.width, WINDOW.height);

const hex = (c: string) =>
  codeOf(parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16));

/** What the recorder would read off the strip for a sequence of captured step counts. */
function capture(steps: number[]): number[][] {
  return steps.map((s) => syncColors(s).map(hex));
}

describe('sync strip decoding', () => {
  test('one pick per step, keeping the last capture of each', () => {
    const codes = capture([0, 0, 1, 1, 2, 3, 3, 3, 4]);
    expect(pickFrames(codes, 5)).toEqual({ picks: [1, 3, 4, 7, 8], missing: 0, glitches: 0 });
  }, 60_000);

  test('uncaptured steps are filled and counted — no aliasing up to MAX_ADVANCE', () => {
    for (const gap of [2, 4, 5, 6, 7, 12, MAX_ADVANCE - 1]) {
      const steps = [0, 1, 2, 3, ...Array.from({ length: 40 }, (_, k) => 3 + gap + k)];
      const { picks, missing } = pickFrames(capture(steps), 3 + gap + 20);
      expect(missing).toBe(gap - 1);
      // Every pick shows exactly its own step (or the last one captured before it).
      picks.forEach((frame, k) => expect(steps[frame]).toBe(k < 3 + gap ? Math.min(k, 3) : k));
    }
  }, 60_000);

  test('an impossible jump is ignored, and a stall past MAX_ADVANCE comes out short, not shifted', () => {
    const glitch = capture([0, 1, 2, 3]);
    glitch.splice(2, 0, capture([1000])[0]); // a misread that looks like step 1000
    const a = pickFrames(glitch, 4);
    expect(a.picks).toEqual([0, 1, 3, 4]);
    expect(a.glitches).toBe(1);

    for (const gap of [MAX_ADVANCE + 1, 150, 400, SYNC_CYCLE - 5]) {
      const steps = [0, 1, 2, ...Array.from({ length: 300 }, (_, k) => 2 + gap + k)];
      const { picks } = pickFrames(capture(steps), 250);
      expect(picks.length).toBeLessThan(250);
      picks.forEach((frame, k) => expect(steps[frame]).toBe(k)); // never shifted
    }
  }, 60_000);

  test('stalls the old 6- and 36-step codes aliased on decode correctly now', () => {
    for (const gap of [4, 7, 33, 37, 50, 59, 73, 100]) {
      const steps = [0, ...Array.from({ length: 200 }, (_, k) => 1 + (k < 20 ? k : k + gap))];
      const { picks, missing } = pickFrames(capture(steps), 150);
      expect(missing).toBe(gap);
      picks.forEach((frame, k) => expect(steps[frame]).toBe(k <= 20 ? k : k > 20 + gap ? k : 20));
    }
  }, 60_000);

  test('the last step keeps its freshest capture, and gaps past the end are not counted', () => {
    expect(pickFrames(capture([0, 1, 1, 2, 2, 2]), 3).picks).toEqual([0, 2, 5]);
    const steps = [...Array.from({ length: 98 }, (_, k) => k), 118];
    expect(pickFrames(capture(steps), 101).missing).toBe(3);
  }, 60_000);

  test('pre-roll is found even after idle frames, and its absence is an error', () => {
    const codes = [...capture([-1, -1]), ...capture([0, 0, 1])];
    expect(pickFrames(codes, 2).picks).toEqual([3, 4]);
    expect(() => pickFrames(capture([-1, 1, 2]), 2)).toThrow('Sync strip not found');
    expect(hex(SYNC_PREROLL)).toBe(codeOf(255, 0, 255));
    expect(SYNC_CYCLE).toBe(1296);
  }, 60_000);
});

describe('recorder geometry', () => {
  test('iPhone 17 Pro: even crop inside the viewport, probes on the strip', () => {
    const { crop, probes } = geometry(WINDOW, SIZE, { width: 1206, height: 2622 });
    expect(crop.w % 2 + crop.h % 2 + crop.y % 2).toBe(0);
    expect(crop.y).toBeGreaterThanOrEqual((874 - 24 - 715) * 3);
    expect(crop.y + crop.h).toBeLessThanOrEqual((874 - 24) * 3);
    expect(Math.abs(crop.h / crop.w - 16 / 9)).toBeLessThan(0.002);
    expect(probes).toHaveLength(4);
    probes.forEach((p, k) => {
      expect(p.y).toBeGreaterThanOrEqual((874 - 24) * 3);
      expect(p.y + p.h).toBeLessThanOrEqual(874 * 3);
      // Inside its own patch, and clear of the home indicator (x 134–268 pt).
      expect(p.x).toBeGreaterThanOrEqual(k * 1206 / 4);
      expect(p.x + p.w).toBeLessThanOrEqual((k + 1) * 1206 / 4);
      expect(p.x + p.w <= 134 * 3 || p.x >= 268 * 3).toBe(true);
    });
  }, 60_000);

  test('devices that cannot fit a 9:16 viewport, or letterbox the app, are refused', () => {
    const se = { width: 375, height: 667 };
    expect(() => geometry(se, clipViewport(se.width, se.height), { width: 750, height: 1334 })).toThrow(
      'Unsupported device',
    );
    expect(() => geometry(WINDOW, SIZE, { width: 1640, height: 2360 })).toThrow('Unsupported device');
  }, 60_000);
});

describe('sidecar timeline', () => {
  test('a highlight keeps events just before it opens, at t ≤ 0', () => {
    const take = buildClip({ skill: 'pro', ...SIZE, seed: 14 })!;
    const a = take.attempts[0];
    const timeline = clipTimeline(take);
    const early = timeline.filter((e) => e.t <= 0 && e.type !== 'attemptStart');
    const expected = a.events.filter(
      (e) => e.step < a.skipSteps && e.step >= a.skipSteps - TIMELINE_LOOKBACK_STEPS,
    );
    expect(early.length).toBe(expected.length);
    const opening = a.events.find((e) => e.step === a.skipSteps - 1);
    if (opening !== undefined) {
      expect(timeline.find((e) => e.type === opening.type && e.t === 0)).toBeDefined();
    }
  }, 60_000);

  test('montage attempts are offset to their start on the clip (and shown a frame later)', () => {
    const take = buildClip({ skill: 'bad', ...SIZE, seed: 3 })!;
    const timeline = clipTimeline(take);
    take.attempts.forEach((a, k) => {
      const start = timeline.find((e) => e.type === 'attemptStart' && e.attempt === k)!;
      expect(start.step).toBe(a.startStep);
      expect(start.t).toBeCloseTo((a.startStep + (k === 0 ? 0 : 1)) / 60, 3);
      const deaths = timeline.filter((e) => e.type === 'death' && e.attempt === k);
      expect(deaths[0].step).toBe(a.startStep + a.endStep - 1);
    });
  }, 60_000);

  test('the lookback covers a zone banner still up when a highlight opens', () => {
    expect(TIMELINE_LOOKBACK_STEPS / 60).toBeGreaterThanOrEqual(ZONE_BANNER_S);
  }, 60_000);

  test("a highlight's attemptEnd counts only the landings shown", () => {
    const take = buildClip({ skill: 'pro', ...SIZE, seed: 42 })!;
    const end = clipTimeline(take).find((e) => e.type === 'attemptEnd')!;
    const a = take.attempts[0];
    expect(end.runJumps).toBe(a.jumps);
    expect(end.jumps as number).toBeLessThan(a.jumps);
  }, 60_000);
});

describe('sound cues', () => {
  test('variants cycle, heat drives the capture rate, extras for graze/perfect, t < 0 kept', () => {
    const cues = soundCues(
      [
        { t: -0.2, type: 'flyby', heat: 2 },
        { t: 0.1, type: 'capture', kind: 2, heat: 0 },
        { t: 0.5, type: 'capture', kind: 1, heat: 4 },
        { t: 0.9, type: 'capture', kind: 0, heat: 1 },
        { t: 1, type: 'attemptEnd' },
      ],
      1,
    );
    expect(cues.map((c) => c.sample)).toEqual([
      'flyby_1',
      'capture_1',
      'perfect',
      'capture_2',
      'graze_1',
      'capture_3',
    ]);
    expect(cues[0].t).toBe(-0.2);
    expect(cues[1].rate).toBe(1);
    expect(cues[3].rate).toBeCloseTo(Math.pow(2, 10 / 12));
    expect(cues[0].volume).toBeCloseTo(0.775);
  }, 60_000);
});

describe('CLI arguments', () => {
  const ok = (a: string, tool: 'clip' | 'take' = 'clip') => parseArgs(a.split(' '), tool);
  const bad = (a: string, tool: 'clip' | 'take' = 'clip') => () => parseArgs(a.split(' '), tool);

  test('valid flags parse', () => {
    expect(ok('--skill bad --jumps 3').request.jumps).toEqual([3, 3]);
    expect(ok('--skill bad --jumps 0-2 --attempts 5').request.attempts).toBe(5);
    expect(ok('--skill pro --near-miss --silent --seed 0').silent).toBe(true);
    expect(ok('--skill pro --seed 0').outGiven).toBe(false);
  }, 60_000);

  test('bad values are usage errors, before anything boots', () => {
    for (const a of [
      '--attempts 0',
      '--attempts -1',
      '--attempts 2.5',
      '--jumps 3-',
      '--jumps -3',
      '--jumps 5-2',
      '--out',
      '--device --silent',
      '--silent false',
      '--seconds 0',
      '--count 0',
      '--skill decent --cause burned --jumps 0-1',
      '--die-at 4',
      '--attempts 13',
      '--jumps 0-99',
      '--count 1000',
      '--skill pro --near-miss --cause crash',
      '--stats 10',
    ]) {
      expect(bad(a)).toThrow();
    }
    expect(() => parseArgs(['--out', ''], 'clip')).toThrow('needs a value');
    expect(bad('--device X', 'take')).toThrow('only applies');
    expect(bad('--silent', 'take')).toThrow('only applies');
    expect(ok('--stats 10', 'take').stats).toBe(10);
  }, 60_000);
});
