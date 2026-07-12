// Every gameplay feel/tuning number lives here. No magic numbers in game code.

export const BALL_RADIUS = 7;

/** rad/s on the orbit ring (~2.4s per revolution). */
export const ORBIT_ANGULAR_SPEED = 2.6;

/** px/s of straight-line flight after release. */
export const FLIGHT_SPEED = 520;

/** How far past the screen edge the ball may fly before it counts as lost. */
export const OFFSCREEN_MARGIN = 60;

/** Ignore restart taps for this long after death (prevents mashing past the score). */
export const RESTART_COOLDOWN_S = 0.25;

/** Clamp frame delta so a hitch can't tunnel the ball through a planet. */
export const MAX_FRAME_DT_S = 1 / 20;

/**
 * M1 static chain, bottom of screen to top. Positions are fractions of the
 * screen size so the layout adapts to any phone. Rings must not overlap.
 */
export const PLANET_LAYOUT: readonly {
  fx: number;
  fy: number;
  radius: number;
  ring: number;
}[] = [
  { fx: 0.5, fy: 0.82, radius: 24, ring: 58 },
  { fx: 0.26, fy: 0.64, radius: 22, ring: 56 },
  { fx: 0.7, fy: 0.52, radius: 26, ring: 60 },
  { fx: 0.32, fy: 0.38, radius: 22, ring: 55 },
  { fx: 0.66, fy: 0.24, radius: 25, ring: 58 },
  { fx: 0.38, fy: 0.1, radius: 22, ring: 54 },
];

export const PLANET_COLORS: readonly string[] = [
  '#4DEEEA', // cyan
  '#FF6EC7', // pink
  '#F9C80E', // yellow
  '#9B5DE5', // purple
  '#74EE15', // green
  '#FF8360', // orange
];

export const COLORS = {
  bgTop: '#0B0B22',
  bgBottom: '#050510',
  ball: '#FFFFFF',
  ballGlow: '#7DF9FF',
  starDim: '#8489B8',
  starBright: '#C9D1F5',
} as const;
