export interface Vec2 {
  x: number;
  y: number;
}

export interface Planet {
  /** Ordinal in the infinite chain; strictly increasing, never reused. */
  id: number;
  center: Vec2;
  /** Planet body radius — a flight path entering this captures at the surface. */
  radius: number;
  /** Orbit ring radius — outer edge of the capture band. */
  ringRadius: number;
  color: string;
}

export type Phase = 'orbiting' | 'flying' | 'dead';

// 'crash' retired for now: direct body hits capture instead of killing.
export type DeathCause = 'lost' | 'burned';

/** 1 = angle increasing, -1 = angle decreasing. */
export type OrbitDirection = 1 | -1;

export interface GameState {
  phase: Phase;
  /**
   * Sliding window of the infinite chain, ascending id, always climbing
   * (later planets have smaller y). Replaced wholesale on generate/prune —
   * never mutated in place (React holds the previous reference).
   */
  planets: Planet[];
  width: number;
  height: number;
  /** World-y of the viewport top. World y decreases as you climb. */
  cameraY: number;
  /** Planet being orbited (stale while flying; ignored then). */
  currentPlanetId: number;
  /** Planet just released from — excluded from capture for the whole flight. */
  departedPlanetId: number;
  angle: number;
  direction: OrbitDirection;
  /** Current orbit radius; decays from ringRadius toward the surface. */
  orbitRadius: number;
  /** No orbit decay before this time (fair-start grace after each capture). */
  graceUntil: number;
  ballPos: Vec2;
  velocity: Vec2;
  /** Planets reached this run (drives all difficulty dials). */
  score: number;
  /** Seconds since run start (keeps counting after death, for restart cooldown). */
  time: number;
  deathTime: number;
  deathCause: DeathCause | null;
  /** mulberry32 state for deterministic procedural generation. */
  rngState: number;
  /** Id the next generated planet will receive. */
  nextPlanetId: number;
}
