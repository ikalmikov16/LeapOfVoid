// Particle bursts, death shatter, and the perfect-capture pulse.
//
// Nothing here simulates anything: every particle's position/opacity is a
// pure function of (event stamp, elapsed time, particle index, seed) read in
// Skia derived values. Fixed component counts, zero allocation per frame, no
// React re-renders, no blur masks (BlurMask is the one Skia feature that
// threatens 60fps when instanced).

import { Circle } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  BALL_RADIUS,
  BURST_DURATION_S,
  BURST_PARTICLES,
  BURST_SPEED,
  COLORS,
  PERFECT_PULSE_S,
  SHATTER_DURATION_S,
  SHATTER_PARTICLES,
  SHATTER_SPEED,
  TRAIL_COUNT,
  TRAIL_DT,
} from '../game/constants';
import { orbitAngularSpeed } from '../game/difficulty';
import { findPlanet } from '../game/engine';
import { pointOnCircle } from '../game/geometry';
import type { GameState, Vec2 } from '../game/types';

/** Cheap deterministic hash → [0, 1). Stable per (seed, index). */
function hash01(seed: number, i: number): number {
  'worklet';
  const x = Math.sin(seed * 0.0001 + i * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const CAPTURE_COLORS = ['#FFFFFF', '#F9C80E', '#74EE15'] as const; // normal / graze / perfect

const BURST_IDX = Array.from({ length: BURST_PARTICLES }, (_, i) => i);
const SHATTER_IDX = Array.from({ length: SHATTER_PARTICLES }, (_, i) => i);

function BurstParticle({ i, gameState }: { i: number; gameState: SharedValue<GameState> }) {
  const cx = useDerivedValue(() => {
    const s = gameState.value;
    const e = s.time - s.lastCaptureAt;
    if (e < 0 || e > BURST_DURATION_S) return -9999;
    const a = (i / BURST_PARTICLES) * Math.PI * 2 + hash01(s.effectSeed, i) * 0.9;
    const speed = BURST_SPEED * (0.5 + 0.5 * hash01(s.effectSeed, i + 31));
    // Decelerating radial fling.
    return s.capturePos.x + Math.cos(a) * speed * e * (1 - (0.55 * e) / BURST_DURATION_S);
  });
  const cy = useDerivedValue(() => {
    const s = gameState.value;
    const e = s.time - s.lastCaptureAt;
    if (e < 0 || e > BURST_DURATION_S) return -9999;
    const a = (i / BURST_PARTICLES) * Math.PI * 2 + hash01(s.effectSeed, i) * 0.9;
    const speed = BURST_SPEED * (0.5 + 0.5 * hash01(s.effectSeed, i + 31));
    return s.capturePos.y + Math.sin(a) * speed * e * (1 - (0.55 * e) / BURST_DURATION_S);
  });
  const r = useDerivedValue(() => {
    const s = gameState.value;
    const e = s.time - s.lastCaptureAt;
    if (e < 0 || e > BURST_DURATION_S) return 0;
    return 3.2 * (1 - e / BURST_DURATION_S) * (0.6 + 0.4 * hash01(s.effectSeed, i + 57));
  });
  const opacity = useDerivedValue(() => {
    const s = gameState.value;
    const e = s.time - s.lastCaptureAt;
    if (e < 0 || e > BURST_DURATION_S) return 0;
    return 0.9 * (1 - e / BURST_DURATION_S);
  });
  const color = useDerivedValue(() => CAPTURE_COLORS[gameState.value.captureKind]);
  return <Circle cx={cx} cy={cy} r={r} opacity={opacity} color={color} />;
}

/** Radial pop on every capture; color/energy varies with capture kind. */
export function CaptureBurst({ gameState }: { gameState: SharedValue<GameState> }) {
  return (
    <>
      {BURST_IDX.map((i) => (
        <BurstParticle key={i} i={i} gameState={gameState} />
      ))}
    </>
  );
}

/** Expanding ring around the planet on a perfect capture. */
export function PerfectPulse({ gameState }: { gameState: SharedValue<GameState> }) {
  const active = (s: GameState): number => {
    'worklet';
    if (s.captureKind !== 2) return -1;
    const e = s.time - s.lastCaptureAt;
    return e >= 0 && e <= PERFECT_PULSE_S ? e / PERFECT_PULSE_S : -1;
  };
  const cx = useDerivedValue(() => {
    const s = gameState.value;
    return findPlanet(s.planets, s.currentPlanetId)?.center.x ?? 0;
  });
  const cy = useDerivedValue(() => {
    const s = gameState.value;
    return findPlanet(s.planets, s.currentPlanetId)?.center.y ?? 0;
  });
  const r = useDerivedValue(() => {
    const s = gameState.value;
    const f = active(s);
    if (f < 0) return 1;
    const ring = findPlanet(s.planets, s.currentPlanetId)?.ringRadius ?? 40;
    return ring * (1 + 0.7 * f);
  });
  const opacity = useDerivedValue(() => {
    const f = active(gameState.value);
    return f < 0 ? 0 : 0.8 * (1 - f);
  });
  return (
    <Circle cx={cx} cy={cy} r={r} style="stroke" strokeWidth={2.5} color="#74EE15" opacity={opacity} />
  );
}

function ShatterParticle({ i, gameState }: { i: number; gameState: SharedValue<GameState> }) {
  const elapsed = (s: GameState): number => {
    'worklet';
    if (s.phase !== 'dead') return -1;
    const e = s.time - s.deathTime;
    return e >= 0 && e <= SHATTER_DURATION_S ? e : -1;
  };
  const cx = useDerivedValue(() => {
    const s = gameState.value;
    const e = elapsed(s);
    if (e < 0) return -9999;
    const a = (i / SHATTER_PARTICLES) * Math.PI * 2 + hash01(s.effectSeed, i + 7) * 1.2;
    const speed = SHATTER_SPEED * (0.4 + 0.6 * hash01(s.effectSeed, i + 71));
    return s.ballPos.x + Math.cos(a) * speed * e * (1 - (0.45 * e) / SHATTER_DURATION_S);
  });
  const cy = useDerivedValue(() => {
    const s = gameState.value;
    const e = elapsed(s);
    if (e < 0) return -9999;
    const a = (i / SHATTER_PARTICLES) * Math.PI * 2 + hash01(s.effectSeed, i + 7) * 1.2;
    const speed = SHATTER_SPEED * (0.4 + 0.6 * hash01(s.effectSeed, i + 71));
    return s.ballPos.y + Math.sin(a) * speed * e * (1 - (0.45 * e) / SHATTER_DURATION_S);
  });
  const r = useDerivedValue(() => {
    const s = gameState.value;
    const e = elapsed(s);
    if (e < 0) return 0;
    return BALL_RADIUS * 0.55 * (1 - e / SHATTER_DURATION_S) * (0.5 + 0.5 * hash01(s.effectSeed, i + 13));
  });
  const opacity = useDerivedValue(() => {
    const e = elapsed(gameState.value);
    return e < 0 ? 0 : 1 - e / SHATTER_DURATION_S;
  });
  return <Circle cx={cx} cy={cy} r={r} opacity={opacity} color="#FFFFFF" />;
}

/** The ball shatters into fragments where it died. */
export function DeathShatter({ gameState }: { gameState: SharedValue<GameState> }) {
  return (
    <>
      {SHATTER_IDX.map((i) => (
        <ShatterParticle key={i} i={i} gameState={gameState} />
      ))}
    </>
  );
}

/**
 * Trail dot position: recent path history computed analytically — a straight
 * line back along the velocity while flying, an arc back along the orbit while
 * orbiting. No position buffer to maintain (and nothing to mutate across the
 * worklet boundary).
 */
function trailPos(s: GameState, secondsBack: number): Vec2 | null {
  'worklet';
  if (s.phase === 'flying') {
    return {
      x: s.ballPos.x - s.velocity.x * secondsBack,
      y: s.ballPos.y - s.velocity.y * secondsBack,
    };
  }
  if (s.phase === 'orbiting') {
    const planet = findPlanet(s.planets, s.currentPlanetId);
    if (planet === null) return null;
    const angleBack = s.angle - s.direction * orbitAngularSpeed(s.planetsPassed) * secondsBack;
    return pointOnCircle(planet.center, s.orbitRadius, angleBack);
  }
  return null;
}

function TrailDot({ i, gameState }: { i: number; gameState: SharedValue<GameState> }) {
  const fade = 1 - (i + 1) / (TRAIL_COUNT + 1);
  const cx = useDerivedValue(() => trailPos(gameState.value, (i + 1) * TRAIL_DT)?.x ?? -9999);
  const cy = useDerivedValue(() => trailPos(gameState.value, (i + 1) * TRAIL_DT)?.y ?? -9999);
  const opacity = useDerivedValue(() => {
    const s = gameState.value;
    if (s.phase === 'dead') return 0;
    // Trail heat is the combo telegraph: faint by default, blazing on a streak.
    const heat = 0.25 + 0.75 * Math.min(s.comboLinks / 4, 1);
    return 0.55 * fade * heat;
  });
  return (
    <Circle cx={cx} cy={cy} r={BALL_RADIUS * (0.2 + 0.6 * fade)} opacity={opacity} color={COLORS.ballGlow} />
  );
}

const TRAIL_IDX = Array.from({ length: TRAIL_COUNT }, (_, i) => i);

/** Comet trail behind the ball; intensity scales with the combo streak. */
export function Trail({ gameState }: { gameState: SharedValue<GameState> }) {
  return (
    <>
      {TRAIL_IDX.map((i) => (
        <TrailDot key={i} i={i} gameState={gameState} />
      ))}
    </>
  );
}
