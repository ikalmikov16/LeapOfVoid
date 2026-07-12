import { describe, expect, test } from 'bun:test';
import {
  BAND_MIN,
  BAND_SHRINK_PER_PLANET,
  BAND_START,
  DECAY_FREE_PLANETS,
  DECAY_MAX,
  FAIR_START_PLANETS,
  ORBIT_SPEED_MAX,
} from './constants';
import {
  captureBandWidth,
  coneHalfAngle,
  jumpMax,
  jumpMin,
  orbitAngularSpeed,
  orbitDecayRate,
  zoneIndex,
} from './difficulty';

describe('difficulty dials', () => {
  test('fair start: widest band and no decay at the beginning', () => {
    for (let n = 0; n < FAIR_START_PLANETS; n++) {
      expect(captureBandWidth(n)).toBe(BAND_START);
    }
    for (let n = 0; n < DECAY_FREE_PLANETS; n++) {
      expect(orbitDecayRate(n)).toBe(0);
    }
    expect(orbitDecayRate(DECAY_FREE_PLANETS)).toBeGreaterThan(0);
  });

  test('curves are monotonic in the right direction and capped', () => {
    for (let n = FAIR_START_PLANETS; n < 500; n++) {
      expect(captureBandWidth(n + 1)).toBeLessThanOrEqual(captureBandWidth(n));
      expect(captureBandWidth(n)).toBeGreaterThanOrEqual(BAND_MIN);
      expect(orbitAngularSpeed(n + 1)).toBeGreaterThanOrEqual(orbitAngularSpeed(n));
      expect(orbitAngularSpeed(n)).toBeLessThanOrEqual(ORBIT_SPEED_MAX);
      expect(orbitDecayRate(n + 1)).toBeGreaterThanOrEqual(orbitDecayRate(n));
      expect(orbitDecayRate(n)).toBeLessThanOrEqual(DECAY_MAX);
      expect(coneHalfAngle(n + 1)).toBeGreaterThanOrEqual(coneHalfAngle(n));
      expect(jumpMin(n)).toBeLessThan(jumpMax(n));
    }
  });

  test('band steps down extra at zone boundaries', () => {
    // n=19 → zone 0, n=20 → zone 1: the drop must exceed the smooth shrink.
    expect(zoneIndex(19)).toBe(0);
    expect(zoneIndex(20)).toBe(1);
    const drop = captureBandWidth(19) - captureBandWidth(20);
    expect(drop).toBeGreaterThan(BAND_SHRINK_PER_PLANET);
  });

  test('deep-game band floor is reachable and respected', () => {
    expect(captureBandWidth(1000)).toBe(BAND_MIN);
  });
});
