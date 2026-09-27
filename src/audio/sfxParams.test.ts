import { describe, expect, test } from 'bun:test';
import { HEAT_MAX } from '../game/constants';
import { CAPTURE_HEAT_STEPS, flybyRate, heatRate, jitterRate } from './sfxParams';

/** expo-audio clamps playback rates here; the clip mixer doesn't, so they'd drift apart. */
const EXPO_AUDIO_MAX_RATE = 2;

describe('sound rates', () => {
  test('every reachable rate stays within the expo-audio clamp', () => {
    const maxJitter = jitterRate(1);
    expect(maxJitter).toBeLessThanOrEqual(EXPO_AUDIO_MAX_RATE);
    for (let heat = 0; heat <= HEAT_MAX; heat++) {
      expect(heatRate(heat, CAPTURE_HEAT_STEPS)).toBeLessThanOrEqual(EXPO_AUDIO_MAX_RATE);
      expect(flybyRate(heat, maxJitter)).toBeLessThanOrEqual(EXPO_AUDIO_MAX_RATE);
    }
  });
});
