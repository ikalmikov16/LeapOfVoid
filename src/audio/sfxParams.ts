// Pure sound rules — which sample plays how fast and how loud for each game
// event. Shared by the game (sfx.ts, ambient.ts) and the clip mixer
// (scripts/clips/audio.ts) so recorded clips sound exactly like the app.
// No expo-audio / React Native imports: this file must load under bun.
//
// A rate is varispeed in both — pitch and speed move together (the voice
// pools turn off expo-audio's pitch correction). expo-audio clamps rates to
// 2.0, so every reachable rate must stay ≤ 2 (sfxParams.test.ts).

/**
 * Heat → pitch as minor-pentatonic steps (semitones above the base sample).
 * Chains play a melody; the old linear 2-semitones-per-level walked a
 * whole-tone scale that never resolved.
 */
export const HEAT_SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19];

export function heatRate(heat: number, maxIndex: number): number {
  const idx = Math.max(0, Math.min(heat, maxIndex, HEAT_SEMITONES.length - 1));
  return Math.pow(2, HEAT_SEMITONES[idx] / 12);
}

/** The capture pluck climbs the scale up to this step. */
export const CAPTURE_HEAT_STEPS = 8;

/**
 * ±4% random rate (≈ ±0.7 semitone) — anti-fatigue for sounds whose pitch
 * carries no meaning.
 */
const JITTER = 0.04;

/** `roll` is a uniform draw in [0, 1). */
export function jitterRate(roll: number): number {
  return 1 + (roll * 2 - 1) * JITTER;
}

/**
 * Flyby: a fire rush per planet skipped. Escalates by intensity, not a scale
 * step — each successive skip in a chain burns louder and slightly faster
 * (rate 1.0 → 1.2, which varispeed also lifts ~3 semitones).
 */
export function flybyRate(heat: number, jitter: number): number {
  return (1 + 0.05 * Math.min(heat, 4)) * jitter;
}

export function flybyVolume(heat: number): number {
  return 0.55 + 0.1125 * Math.min(heat, 4);
}

/** The ambient pad sits far under the SFX — felt more than heard. */
export const AMBIENT_VOLUME = 0.3;
