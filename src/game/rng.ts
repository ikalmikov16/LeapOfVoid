// Seeded RNG (mulberry32) as pure worklet-safe functions. The state is a
// plain number carried on GameState so runs are reproducible in tests.

export interface RngCarrier {
  rngState: number;
}

/** Advance the carrier's rng state and return a uniform value in [0, 1). */
export function rand01(carrier: RngCarrier): number {
  'worklet';
  const a = (carrier.rngState + 0x6d2b79f5) | 0;
  carrier.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(carrier: RngCarrier, min: number, max: number): number {
  'worklet';
  return min + rand01(carrier) * (max - min);
}
