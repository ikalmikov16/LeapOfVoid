// Every gameplay feel/tuning number lives here. No magic numbers in game code.

export const BALL_RADIUS = 7;

/** px/s of straight-line flight after release. */
export const FLIGHT_SPEED = 520;

/** How far past the viewport edge the ball may fly before it counts as lost. */
export const OFFSCREEN_MARGIN = 60;
/** Upward flights get a full screen of slack (the camera is still catching up). */
export const OFFSCREEN_TOP_SCREENS = 1;

/** Ignore restart taps for this long after death (prevents mashing past the score). */
export const RESTART_COOLDOWN_S = 0.25;

/** Clamp frame delta so a hitch can't tunnel the ball through a planet. */
export const MAX_FRAME_DT_S = 1 / 20;

// --- Camera ---

/** While orbiting, the current planet sits this fraction down the screen. */
export const CAMERA_PLANET_ANCHOR = 0.65;
/** While flying, the ball is tracked at this fraction down the screen. */
export const CAMERA_BALL_ANCHOR = 0.45;
/** Exponential smoothing rate (1/s); higher = snappier follow. */
export const CAMERA_SMOOTHING = 6;

// --- Procedural generation ---

/** Keep planets generated this many screen-heights above the viewport top. */
export const GENERATE_AHEAD_SCREENS = 1.5;
/** Prune planets this many screen-heights below the viewport bottom. */
export const PRUNE_BEHIND_SCREENS = 0.5;
export const MAX_PLACEMENT_ATTEMPTS = 24;
/** Minimum clearance between any two planets' rings. */
export const PLANET_GAP = 14;
/** The corridor between consecutive planets must clear other bodies by this. */
export const CORRIDOR_CLEARANCE = 10;
/** Rings may not poke past the screen sides by more than this. */
export const SCREEN_X_MARGIN = 8;
/** Safety cap on the planet window (generation loop bound). */
export const MAX_PLANETS = 30;

// --- Difficulty dials (see src/game/difficulty.ts for the curve functions) ---

export const ZONE_SIZE = 20;

/** Capture band width (ring minus body): the main difficulty dial. */
export const BAND_START = 34;
export const BAND_MIN = 14;
export const BAND_SHRINK_PER_PLANET = 0.25;
export const BAND_ZONE_STEP = 1.5;
/** First planets of a run always get the widest band (fair start for clips). */
export const FAIR_START_PLANETS = 5;

export const ORBIT_SPEED_BASE = 2.6; // rad/s (~2.4s per revolution)
export const ORBIT_SPEED_PER_PLANET = 0.02;
export const ORBIT_SPEED_MAX = 4.0;

export const PLANET_RADIUS_MIN = 20;
export const PLANET_RADIUS_MAX = 28;
export const PLANET_RADIUS_GROWTH = 0.06; // px per planet added to both bounds
export const PLANET_RADIUS_GROWTH_CAP = 6;

export const JUMP_MIN_BASE = 150;
export const JUMP_MIN_GROWTH = 0.7;
export const JUMP_MIN_CAP = 40;
export const JUMP_MAX_BASE = 210;
export const JUMP_MAX_GROWTH = 1.5;
export const JUMP_MAX_CAP = 90;

/** Half-angle (rad) of the placement cone around straight-up. */
export const CONE_HALF_BASE = 0.35;
export const CONE_HALF_GROWTH = 0.008;
export const CONE_HALF_CAP = 0.4; // additional widening, so max ≈ 0.75 rad

// --- Orbit decay (anti-camping) ---

/** No decay at all for the first N planets of a run. */
export const DECAY_FREE_PLANETS = 3;
export const DECAY_BASE = 6; // px/s once active
export const DECAY_GROWTH = 0.1;
export const DECAY_MAX = 14;
/** Decay pauses for this long after every capture. */
export const GRACE_AFTER_CAPTURE_S = 2;

// --- Look ---

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
