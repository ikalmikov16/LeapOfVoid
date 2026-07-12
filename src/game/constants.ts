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

// --- Aim line (dashed tangent projection while orbiting) ---

/** Gap between ball center and the start of the line. */
export const AIM_LINE_START = 14;
/** Length of the dashed hint — long enough to read direction, too short to solve the jump. */
export const AIM_LINE_LENGTH = 85;
export const AIM_LINE_OPACITY = 0.5;

// --- Scoring (score = points; planetsPassed drives difficulty) ---
// Per capture: (CAPTURE + flat bonuses) × (1 + heat). Heat — built by flying
// past planets mid-jump, cooled by camping — is the one multiplier.

export const CAPTURE_POINTS = 1;
export const GRAZE_POINTS = 1;
export const PERFECT_POINTS = 2;
/** Flat bonus for releasing within the quick window. */
export const QUICK_POINTS = 1;
/** Release within this fraction of a revolution to earn the quick bonus. */
export const QUICK_WINDOW_REVOLUTIONS = 0.75;
/** Heat cap: +1 per planet flown past, so the multiplier tops out at ×5. */
export const HEAT_MAX = 4;
/** Camping cools: lose 1 heat per this many revolutions orbited. */
export const HEAT_COOL_REVOLUTIONS = 1;
/** Closest approach within this of the surface = graze (nearly died). */
export const GRAZE_MARGIN = 8;
/** Middle fraction of the capture band that counts as a perfect capture. */
export const PERFECT_BAND_FRACTION = 0.25;

// --- Capture latch-on (smooth settle instead of snapping to the ring) ---

/** Seconds to ease from the capture point/speed onto the ring orbit. */
export const CAPTURE_SETTLE_S = 0.6;
/**
 * Cap on the initial angular speed (rad/s) right after capture. Velocity
 * continuity wants FLIGHT_SPEED / captureRadius, but a deep graze on a small
 * planet would whip at 20+ rad/s — cap it to a fast-but-readable spin.
 */
export const CAPTURE_OMEGA_MAX = 7;

// --- Camera ---

/** While orbiting, the current planet sits this fraction down the screen. */
export const CAMERA_PLANET_ANCHOR = 0.65;
/** While flying, the ball is tracked at this fraction down the screen. */
export const CAMERA_BALL_ANCHOR = 0.45;
/** Exponential smoothing rate (1/s); higher = snappier follow. */
export const CAMERA_SMOOTHING = 6;
/**
 * Downward recenter rate while ORBITING only (a sideways hop can put the new
 * anchor below the camera; without this the screen sits frozen). Flying never
 * drags the camera down — downward flights still fall out of view and die.
 */
export const CAMERA_DOWN_SMOOTHING = 2.5;

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

/**
 * Capture band width (ring minus body). Kept generous — jump distance, not
 * ring size, is the main difficulty dial (thin rings read as unfair; long
 * jumps read as epic).
 */
export const BAND_START = 48;
export const BAND_MIN = 20;
export const BAND_SHRINK_PER_PLANET = 0.12;
export const BAND_ZONE_STEP = 1.5;
/** First planets of a run always get the widest band (fair start for clips). */
export const FAIR_START_PLANETS = 5;

export const ORBIT_SPEED_BASE = 2.3; // rad/s (~2.7s per revolution)
export const ORBIT_SPEED_PER_PLANET = 0.02;
export const ORBIT_SPEED_MAX = 4.0;

export const PLANET_RADIUS_MIN = 17;
export const PLANET_RADIUS_MAX = 25;
export const PLANET_RADIUS_GROWTH = 0.06; // px per planet added to both bounds
export const PLANET_RADIUS_GROWTH_CAP = 6;

// Jump distance is the main difficulty curve: late-game jumps stretch to
// ~450px (about half a screen) while rings stay timeable.
export const JUMP_MIN_BASE = 190;
export const JUMP_MIN_GROWTH = 1.0;
export const JUMP_MIN_CAP = 70;
export const JUMP_MAX_BASE = 270;
export const JUMP_MAX_GROWTH = 2.5;
export const JUMP_MAX_CAP = 180;

/** Half-angle (rad) of the placement cone around straight-up. */
export const CONE_HALF_BASE = 0.85;
export const CONE_HALF_GROWTH = 0.006;
export const CONE_HALF_CAP = 0.25; // additional widening, so max ≈ 1.1 rad
/**
 * Chance a placement deliberately aims at the half of the screen the current
 * planet is NOT on, using the outer part of the cone — guarantees the chain
 * regularly sweeps side to side instead of leaving it to dice.
 */
export const SWING_CHANCE = 0.3;

// Ring variety: per-planet seeded jitter on the band, so rings visibly vary
// and small planets can carry bigger orbits than big ones.
export const RING_JITTER_MIN = 0.85;
export const RING_JITTER_MAX = 1.25;
/** Early orbits are this much bigger on average, easing back to 1×. */
export const EARLY_RING_BOOST = 1.15;
/** ...by this many planets in. */
export const EARLY_RING_BOOST_PLANETS = 12;
/** The occasional big one. */
export const GIANT_RING_CHANCE = 0.1;
export const GIANT_RING_SCALE = 1.6;

// --- Orbit decay (anti-camping) ---

/** No decay at all for the first N planets of a run. */
export const DECAY_FREE_PLANETS = 3;
export const DECAY_BASE = 6; // px/s once active
export const DECAY_GROWTH = 0.1;
export const DECAY_MAX = 14;
/** Decay pauses for this long after every capture. */
export const GRACE_AFTER_CAPTURE_S = 2;

// --- Effects (all pure functions of time-since-event; no simulated particles) ---

export const TRAIL_COUNT = 14;
/** Seconds of path history between consecutive trail dots. */
export const TRAIL_DT = 0.026;
export const RELEASE_STRETCH_S = 0.18;
export const RELEASE_STRETCH_AMOUNT = 0.45;
export const BURST_DURATION_S = 0.55;
export const BURST_SPEED = 170;
export const BURST_PARTICLES = 12;
export const SHATTER_DURATION_S = 0.7;
export const SHATTER_SPEED = 240;
export const SHATTER_PARTICLES = 14;
export const FLASH_DURATION_S = 0.22;
export const SHAKE_DURATION_S = 0.45;
export const SHAKE_AMPLITUDE = 9;
export const PERFECT_PULSE_S = 0.5;
/** Ball glow pop when a flyby ticks the heat up. */
export const FLYBY_PULSE_S = 0.3;
/** Background gradient cross-fade time on zone change. */
export const ZONE_FADE_S = 1.5;
/** How long the zone name flashes in the HUD (JS side). */
export const ZONE_FLASH_MS = 3000;
/** Delay before the death overlay fades in, so the shatter reads first. */
export const DEATH_OVERLAY_DELAY_MS = 350;

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

/**
 * Ball glow / trail / HUD badge color per heat level (0..HEAT_MAX).
 * The comet look IS the multiplier gauge: cyan cold → red-hot ×5.
 */
export const HEAT_COLORS: readonly string[] = [
  '#7DF9FF', // 0 — cold (matches ballGlow)
  '#FFE29A', // 1 — pale gold
  '#FFB86B', // 2 — orange
  '#FF8A50', // 3 — deep orange
  '#FF5C3A', // 4 — red-hot
];
