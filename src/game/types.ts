export interface Vec2 {
  x: number;
  y: number;
}

export interface Planet {
  /** Ordinal in the infinite chain; strictly increasing, never reused. */
  id: number;
  center: Vec2;
  /** Planet body radius — closest approach inside this = crash. */
  radius: number;
  /** Orbit ring radius — outer edge of the capture band. */
  ringRadius: number;
  color: string;
}

export type Phase = 'orbiting' | 'flying' | 'dead';

export type DeathCause = 'crash' | 'lost' | 'burned';

/** 0 = normal capture, 1 = graze (skimmed the surface), 2 = perfect (band center). */
export type CaptureKind = 0 | 1 | 2;

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

  /** Planets reached this run — drives ALL difficulty dials and zones. */
  planetsPassed: number;
  /** Points (captures × combo multiplier + bonuses) — the big HUD number. */
  score: number;
  /** Consecutive quick releases (within the combo window). */
  comboLinks: number;
  /** Revolutions completed on the current orbit (fraction; resets on capture). */
  revolutions: number;
  /** Current zone (planetsPassed ÷ 20); visuals key off changes to this. */
  zoneIndex: number;

  /** Seconds since run start (keeps counting after death, for restart cooldown). */
  time: number;
  deathTime: number;
  deathCause: DeathCause | null;

  // Discrete event stamps for effects. Set to a distant past on init so
  // "time since event" starts huge; effects render as pure functions of these.
  lastReleaseAt: number;
  lastCaptureAt: number;
  captureKind: CaptureKind;
  /** Where the ball snapped on the last capture (world coords). */
  capturePos: Vec2;
  zoneChangedAt: number;
  /** Seed for the current effect burst's particle pattern. */
  effectSeed: number;

  /** mulberry32 state for deterministic procedural generation. */
  rngState: number;
  /** Id the next generated planet will receive. */
  nextPlanetId: number;
}
