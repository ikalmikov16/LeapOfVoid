// The end card's model — pure, so it loads both in the Remotion bundle (the
// composition's timing and look) and under bun (the compose CLI: where to
// cut, what it sounds like). No DOM, Remotion or Bun APIs here.
// Design: plans/clip-composer.md §3.1–3.2, 3.5.

import { CAPTURE_HEAT_STEPS, heatRate } from '../../../src/audio/sfxParams';
import {
  DEATH_OVERLAY_DELAY_MS,
  DEATH_OVERLAY_FADE_MS,
  HEAT_COLORS,
  HEAT_MAX,
} from '../../../src/game/constants';
import { zoneIndex } from '../../../src/game/difficulty';
import { zonePalette } from '../../../src/rendering/zones';

/** The Remotion composition (Root.tsx) that renders a composed clip. */
export const COMPOSITION_ID = 'EndCardClip';

/** Seconds after the warp starts at which each beat begins (plan §3.1). */
export const BEATS = {
  /** The gameplay zooms toward the camera and fades while the stars streak. */
  warp: 0,
  /** Flash; the icon planet comes out of the vanishing point; streaks slow. */
  arrive: 0.55,
  /** The ship, dropping out of warp, locks into the planet's orbit. */
  capture: 1.15,
  /** "LEAP OF" (then "VOID" 0.15 s later). */
  title: 1.35,
  /** "YOUR TURN." */
  line: 2.0,
  /** The orbit pill starts tracing. */
  cta: 2.35,
  /** The pill is fully drawn; the hold starts. */
  ctaDone: 3.15,
} as const;

export const WARP_S = BEATS.arrive;
export const DEFAULT_HOLD_S = 1.2;
export const LINE = 'YOUR TURN.';

/** A dead run's card stays readable this long after the death (fade-in + 1 s). */
export const DEATH_CARD_READ_S = (DEATH_OVERLAY_DELAY_MS + DEATH_OVERLAY_FADE_MS) / 1000 + 1;
/** A run cut alive starts its warp this long before its last frame. */
export const ALIVE_LEAD_S = 0.15;

export const cardSeconds = (holdS: number) => BEATS.ctaDone + holdS;

/** The sidecar fields the end card reads (plans/gameplay-recorder.md §3.6). */
export interface SourceSidecar {
  video: string;
  fps: number;
  seconds: number;
  timeline: SourceEntry[];
}

export interface SourceEntry {
  t: number;
  type: string;
  attempt?: number;
  heat?: number;
  planetsPassed?: number;
  deathCause?: string | null;
}

export interface EndCardSpec {
  fps: number;
  /** Frames in the gameplay mp4. */
  videoFrames: number;
  /** Composed-clip frame on which the warp begins (gameplay before it is untouched). */
  warpStartFrame: number;
  totalFrames: number;
  holdS: number;
  zoneName: string;
  /** The zone's background gradient, as the clip ended on it. */
  top: string;
  bottom: string;
  /** Heat colour: the run's last heat if it was cut alive, cold cyan after a death. */
  accent: string;
  line: string;
}

export function endCardSpec(sidecar: SourceSidecar, holdS = DEFAULT_HOLD_S): EndCardSpec {
  const { fps } = sidecar;
  const videoFrames = Math.round(sidecar.seconds * fps);
  const lastAttempt = Math.max(0, ...sidecar.timeline.map((e) => e.attempt ?? 0));
  const last = sidecar.timeline.filter((e) => (e.attempt ?? 0) === lastAttempt);
  const end = last.findLast((e) => e.type === 'attemptEnd');
  if (end === undefined) throw new Error(`${sidecar.video}: the timeline has no attemptEnd`);
  const death = end.deathCause ? last.findLast((e) => e.type === 'death') : undefined;

  const warpStartFrame =
    death !== undefined
      ? Math.min(Math.round((death.t + DEATH_CARD_READ_S) * fps), videoFrames)
      : Math.max(0, videoFrames - Math.round(ALIVE_LEAD_S * fps));
  const heat =
    death !== undefined ? 0 : (last.findLast((e) => e.type === 'capture')?.heat ?? 0);
  const zone = zonePalette(zoneIndex(end.planetsPassed ?? 0));
  return {
    fps,
    videoFrames,
    warpStartFrame,
    totalFrames: warpStartFrame + Math.round(cardSeconds(holdS) * fps),
    holdS,
    zoneName: zone.name,
    top: zone.bgTop,
    bottom: zone.bgBottom,
    accent: HEAT_COLORS[Math.max(0, Math.min(heat, HEAT_MAX))],
    line: LINE,
  };
}

/** A sound the mixer (scripts/clips/audio.ts) plays as-is from the timeline. */
export interface SoundEntry {
  t: number;
  type: 'sound';
  sample: string;
  rate: number;
  volume: number;
}

export interface EndCardMarker {
  t: number;
  type: 'endCard';
  beat: keyof typeof BEATS | 'end';
}

/**
 * The end card's sound, in the game's own samples (plan §3.5): a low whoosh
 * into the warp, the zone sting on arrival, and a top-heat perfect landing.
 */
export function endCardSounds(spec: EndCardSpec): SoundEntry[] {
  const w = spec.warpStartFrame / spec.fps;
  const sound = (at: number, sample: string, rate: number, volume: number): SoundEntry => ({
    t: +(w + at).toFixed(3),
    type: 'sound',
    sample,
    rate,
    volume,
  });
  return [
    sound(BEATS.warp, 'flyby_2', 0.7, 0.9),
    sound(BEATS.arrive, 'zone', 1, 0.8),
    sound(BEATS.capture, 'capture_1', heatRate(HEAT_MAX, CAPTURE_HEAT_STEPS), 1),
    sound(BEATS.capture, 'perfect', 1, 1),
  ];
}

/**
 * The composed clip's timeline: gameplay events up to the end of the warp
 * (they're still on screen, and sound, while it zooms away), then the end
 * card's beats and sounds.
 */
export function composedTimeline<E extends SourceEntry>(
  timeline: E[],
  spec: EndCardSpec,
): (E | SoundEntry | EndCardMarker)[] {
  const w = spec.warpStartFrame / spec.fps;
  const kept = timeline.filter((e) => e.t < w + WARP_S);
  const beats = (Object.keys(BEATS) as (keyof typeof BEATS)[]).map(
    (beat): EndCardMarker => ({ t: +(w + BEATS[beat]).toFixed(3), type: 'endCard', beat }),
  );
  const end: EndCardMarker = { t: +(spec.totalFrames / spec.fps).toFixed(3), type: 'endCard', beat: 'end' };
  return [...kept, ...beats, ...endCardSounds(spec), end].sort((a, b) => a.t - b.t);
}
