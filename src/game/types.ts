export interface Vec2 {
  x: number;
  y: number;
}

export interface Planet {
  id: number;
  center: Vec2;
  /** Planet body radius — closest approach inside this = crash. */
  radius: number;
  /** Orbit ring radius — outer edge of the capture band. */
  ringRadius: number;
  color: string;
}

export type Phase = 'orbiting' | 'flying' | 'dead';

export type DeathCause = 'crash' | 'lost';

/** 1 = angle increasing, -1 = angle decreasing. */
export type OrbitDirection = 1 | -1;

export interface GameState {
  phase: Phase;
  planets: Planet[];
  width: number;
  height: number;
  /** Planet being orbited (stale while flying; ignored then). */
  currentPlanetIndex: number;
  /** Planet just released from — excluded from capture for the whole flight. */
  departedPlanetIndex: number;
  angle: number;
  direction: OrbitDirection;
  ballPos: Vec2;
  velocity: Vec2;
  score: number;
  /** Seconds since run start (keeps counting after death, for restart cooldown). */
  time: number;
  deathTime: number;
  deathCause: DeathCause | null;
}
