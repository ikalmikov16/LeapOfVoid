import { describe, expect, test } from 'bun:test';
import { heatRate } from '../../../src/audio/sfxParams';
import { HEAT_COLORS } from '../../../src/game/constants';
import { soundCues } from '../audio';
import { parseComposeArgs } from './args';
import {
  ALIVE_LEAD_S,
  BEATS,
  cardSeconds,
  composedTimeline,
  DEATH_CARD_READ_S,
  DEFAULT_HOLD_S,
  endCardSounds,
  endCardSpec,
  WARP_S,
  type SourceEntry,
  type SourceSidecar,
} from './endCard';

const FPS = 60;

/** A sidecar shaped like the recorder's (plans/gameplay-recorder.md §3.6). */
function sidecar(seconds: number, timeline: SourceEntry[]): SourceSidecar {
  return { video: 'x.mp4', fps: FPS, seconds, timeline };
}

// A fail montage: two tries, the last dies at 22.35 s, the card held to 24.867 s.
const DEAD = sidecar(1492 / FPS, [
  { t: 0, type: 'attemptStart', attempt: 0 },
  { t: 2, type: 'capture', heat: 2, attempt: 0 },
  { t: 3, type: 'death', attempt: 0 },
  { t: 3, type: 'attemptEnd', attempt: 0, planetsPassed: 1, deathCause: 'crash' },
  { t: 4, type: 'attemptStart', attempt: 1 },
  { t: 19.717, type: 'capture', heat: 1, attempt: 1 },
  { t: 21.583, type: 'release', attempt: 1 },
  { t: 22.35, type: 'death', attempt: 1 },
  { t: 22.35, type: 'attemptEnd', attempt: 1, planetsPassed: 3, deathCause: 'lost' },
]);

// A pro highlight cut alive, just after a landing, in zone 2 (planets 40–59).
const ALIVE = sidecar(1452 / FPS, [
  { t: 0, type: 'attemptStart', attempt: 0 },
  { t: 23.067, type: 'capture', heat: 4, attempt: 0 },
  { t: 23.417, type: 'release', attempt: 0 },
  { t: 23.833, type: 'capture', heat: 3, attempt: 0 },
  { t: 24.183, type: 'attemptEnd', attempt: 0, planetsPassed: 55, deathCause: null },
]);

describe('end card spec', () => {
  test('a dead run warps once its death card has been readable, and goes cold cyan', () => {
    const spec = endCardSpec(DEAD);
    expect(spec.videoFrames).toBe(1492);
    expect(spec.warpStartFrame).toBe(Math.round((22.35 + DEATH_CARD_READ_S) * FPS));
    expect(spec.warpStartFrame).toBe(1440);
    expect(spec.accent).toBe(HEAT_COLORS[0]);
    expect(spec.zoneName).toBe('THE VOID');
    expect(spec.line).toBe('YOUR TURN.');
  });

  test('a short hold warps from the last frame instead', () => {
    const short = sidecar(23, DEAD.timeline); // death + 1.65 s is past the end
    const spec = endCardSpec(short);
    expect(spec.warpStartFrame).toBe(spec.videoFrames);
  });

  test('a run cut alive warps just before its end, in its zone and heat', () => {
    const spec = endCardSpec(ALIVE);
    expect(spec.warpStartFrame).toBe(1452 - Math.round(ALIVE_LEAD_S * FPS));
    expect(spec.zoneName).toBe('VIOLET DEEP');
    expect(spec.top).toBe('#1F0F38');
    expect(spec.accent).toBe(HEAT_COLORS[3]);
  });

  test('zones wrap and heat clamps like the game', () => {
    const far = sidecar(10, [
      { t: 5, type: 'capture', heat: 9, attempt: 0 },
      { t: 6, type: 'attemptEnd', attempt: 0, planetsPassed: 125, deathCause: null },
    ]);
    const spec = endCardSpec(far);
    expect(spec.zoneName).toBe('THE VOID'); // zone 6 wraps to the first palette
    expect(spec.accent).toBe(HEAT_COLORS[HEAT_COLORS.length - 1]);
  });

  test('duration is the warp start plus the card and its hold', () => {
    expect(cardSeconds(DEFAULT_HOLD_S)).toBeCloseTo(4.35);
    const spec = endCardSpec(DEAD, 2);
    expect(spec.totalFrames).toBe(1440 + Math.round((BEATS.ctaDone + 2) * FPS));
    expect(spec.holdS).toBe(2);
  });

  test('a sidecar without an attemptEnd is rejected', () => {
    expect(() => endCardSpec(sidecar(5, [{ t: 1, type: 'release', attempt: 0 }]))).toThrow(
      /attemptEnd/,
    );
  });
});

describe('composed timeline and sound', () => {
  test('keeps gameplay events until the warp ends, then the card beats and sounds, in order', () => {
    const spec = endCardSpec(ALIVE);
    const w = spec.warpStartFrame / FPS;
    const timeline = composedTimeline(ALIVE.timeline, spec);
    expect(timeline.every((e, k) => k === 0 || e.t >= timeline[k - 1].t)).toBe(true);
    const gameplay = timeline.filter((e) => e.type !== 'endCard' && e.type !== 'sound');
    expect(gameplay).toEqual(ALIVE.timeline.filter((e) => e.t < w + WARP_S));
    const beats = timeline.filter((e) => e.type === 'endCard');
    expect(beats.map((e): string => ('beat' in e ? e.beat : ''))).toEqual([
      ...Object.keys(BEATS),
      'end',
    ]);
    expect(beats[beats.length - 1].t).toBeCloseTo(spec.totalFrames / FPS, 3);
  });

  test('a dead run drops the rest of its held death card', () => {
    const spec = endCardSpec(DEAD);
    const late = [...DEAD.timeline, { t: 24.8, type: 'zone', attempt: 1 }];
    expect(composedTimeline(late, spec).some((e) => e.type === 'zone')).toBe(false);
  });

  test('the card sounds: whoosh at the warp, sting on arrival, top-heat landing', () => {
    const spec = endCardSpec(DEAD);
    const w = spec.warpStartFrame / FPS;
    const sounds = endCardSounds(spec);
    expect(sounds.map((s) => [s.sample, +(s.t - w).toFixed(3)])).toEqual([
      ['flyby_2', BEATS.warp],
      ['zone', BEATS.arrive],
      ['capture_1', BEATS.capture],
      ['perfect', BEATS.capture],
    ]);
    expect(sounds[2].rate).toBeCloseTo(heatRate(4, 8));
    for (const s of sounds) expect(s.rate).toBeLessThanOrEqual(2);
  });

  test('the mixer plays `sound` entries as written and ignores card beats', () => {
    const spec = endCardSpec(DEAD);
    const cues = soundCues(composedTimeline(DEAD.timeline, spec) as never, 1);
    const card = cues.filter((c) => c.t >= spec.warpStartFrame / FPS);
    expect(card).toEqual(
      endCardSounds(spec).map(({ t, sample, rate, volume }) => ({ t, sample, rate, volume })),
    );
  });
});

describe('compose CLI arguments', () => {
  test('defaults and flags', () => {
    expect(parseComposeArgs([])).toEqual({
      files: [],
      holdS: DEFAULT_HOLD_S,
      out: 'clips/composed',
      force: false,
      silent: false,
    });
    const args = parseComposeArgs(['a.json', '--hold', '2.5', '--out', 'x', '--silent', 'b.json']);
    expect(args.files).toEqual(['a.json', 'b.json']);
    expect(args.holdS).toBe(2.5);
    expect(args.out).toBe('x');
    expect(args.silent).toBe(true);
  });

  test('bad input is a usage error', () => {
    expect(() => parseComposeArgs(['--hold', '-1'])).toThrow(/--hold/);
    expect(() => parseComposeArgs(['--hold', '11'])).toThrow(/--hold/);
    expect(() => parseComposeArgs(['--hold'])).toThrow(/needs a value/);
    expect(() => parseComposeArgs(['--out', '--silent'])).toThrow(/needs a value/);
    expect(() => parseComposeArgs(['--loud'])).toThrow(/Unknown flag/);
    expect(() => parseComposeArgs(['clip.mp4'])).toThrow(/sidecar/);
  });
});
