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
  /** Distance from the planet center where the last capture happened; the
   * orbit eases from here out to ringRadius over CAPTURE_SETTLE_S. */
  captureRadius: number;
  /** No orbit decay before this time (fair-start grace after each capture). */
  graceUntil: number;
  ballPos: Vec2;
  velocity: Vec2;

  /** Planets reached this run — drives ALL difficulty dials and zones. */
  planetsPassed: number;
  /** Points ((capture + bonuses) × (1 + heat)) — the big HUD number. */
  score: number;
  /**
   * The score multiplier minus one, and the comet visual: +1 per planet
   * flown past mid-jump (cap HEAT_MAX), −1 per revolution camped.
   */
  heat: number;
  /** Planets cleared during the current flight (high-water; resets on release). */
  flightSkips: number;
  /** Whether the current/last flight left within the quick window. */
  releasedQuick: boolean;
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
  /** Last mid-flight planet pass (heat tick) — drives the glow pop. */
  lastFlybyAt: number;
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
