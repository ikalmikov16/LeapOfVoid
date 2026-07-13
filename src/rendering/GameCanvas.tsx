import {
  BlurMask,
  Canvas,
  Circle,
  DashPathEffect,
  Group,
  Line,
  matchFont,
  Points,
  Rect,
  Shader,
  Text,
  vec,
  type SkPoint,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Platform } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import {
  AIM_LINE_LENGTH,
  AIM_LINE_OPACITY,
  AIM_LINE_START,
  BALL_RADIUS,
  COLORS,
  FLASH_DURATION_S,
  FLYBY_PULSE_S,
  HEAT_COLORS,
  MILESTONE_INTERVAL,
  MILESTONE_LABEL_OPACITY,
  MILESTONE_LINE_OPACITY,
  RELEASE_STRETCH_AMOUNT,
  RELEASE_STRETCH_S,
  SHAKE_AMPLITUDE,
  SHAKE_DURATION_S,
  ZONE_FADE_S,
} from '../game/constants';
import { findPlanet } from '../game/engine';
import type { GameState, Planet } from '../game/types';
import { BG_SHADER } from './bgShader';
import { CaptureBurst, DeathShatter, PerfectPulse, Trail } from './effects';
import { zonePaletteRgb } from './zones';

interface GameCanvasProps {
  width: number;
  height: number;
  /** React-side mirror of the planet window; updates on generation/prune. */
  planets: Planet[];
  gameState: SharedValue<GameState>;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const milestoneFont = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica Neue', default: 'sans-serif' }),
  fontSize: 13,
  fontWeight: 'bold',
});

/**
 * Numbered altitude line at every MILESTONE_INTERVAL-th planet — spatial
 * progress the player climbs past (planet ids are chain ordinals). Static
 * world-space geometry; the world transform carries it with the camera.
 */
function MilestoneMarker({ planet, width }: { planet: Planet; width: number }) {
  const y = planet.center.y;
  return (
    <Group>
      <Line
        p1={vec(0, y)}
        p2={vec(width, y)}
        color={COLORS.starBright}
        strokeWidth={1}
        opacity={MILESTONE_LINE_OPACITY}
      >
        <DashPathEffect intervals={[6, 9]} />
      </Line>
      <Text
        x={10}
        y={y - 7}
        text={String(planet.id)}
        font={milestoneFont}
        color={COLORS.starBright}
        opacity={MILESTONE_LABEL_OPACITY}
      />
    </Group>
  );
}

function PlanetView({ planet, gameState }: { planet: Planet; gameState: SharedValue<GameState> }) {
  const ringOpacity = useDerivedValue(() =>
    gameState.value.phase === 'orbiting' && gameState.value.currentPlanetId === planet.id
      ? 0.35
      : 0.22,
  );
  return (
    <Group>
      <Circle cx={planet.center.x} cy={planet.center.y} r={planet.radius * 1.3} color={planet.color} opacity={0.3}>
        <BlurMask blur={14} style="normal" />
      </Circle>
      <Circle
        cx={planet.center.x}
        cy={planet.center.y}
        r={planet.ringRadius}
        style="stroke"
        strokeWidth={1.5}
        color={planet.color}
        opacity={ringOpacity}
      />
      <Circle cx={planet.center.x} cy={planet.center.y} r={planet.radius} color={planet.color} />
    </Group>
  );
}

export function GameCanvas({ width, height, planets, gameState }: GameCanvasProps) {
  // Screen-fixed starfield backdrop (parallax is a later flavor pass).
  const stars = useMemo(() => {
    const rand = mulberry32(1337);
    const dim: SkPoint[] = [];
    const bright: SkPoint[] = [];
    for (let i = 0; i < 70; i++) {
      const p = vec(rand() * width, rand() * height);
      (i % 3 === 0 ? bright : dim).push(p);
    }
    return { dim, bright };
  }, [width, height]);

  // Background gradient cross-fades between zone palettes. Rendered by the
  // dithered shader (see bgShader.ts) — numeric channel lerp replaces
  // interpolateColor since uniforms want [r, g, b] anyway.
  const bgUniforms = useDerivedValue(() => {
    const s = gameState.value;
    const cur = zonePaletteRgb(s.zoneIndex);
    const e = s.time - s.zoneChangedAt;
    if (s.zoneIndex === 0 || e >= ZONE_FADE_S) {
      return { uRes: [width, height], uTop: cur.top, uBottom: cur.bottom };
    }
    const prev = zonePaletteRgb(s.zoneIndex - 1);
    const f = Math.max(0, Math.min(e / ZONE_FADE_S, 1));
    const lerped = (a: readonly number[], b: readonly number[]) => [
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ];
    return {
      uRes: [width, height],
      uTop: lerped(prev.top, cur.top),
      uBottom: lerped(prev.bottom, cur.bottom),
    };
  });

  // World translate + death shake (decaying wobble in screen space).
  const worldTransform = useDerivedValue(() => {
    const s = gameState.value;
    let dx = 0;
    let dy = 0;
    if (s.phase === 'dead') {
      const e = s.time - s.deathTime;
      if (e >= 0 && e < SHAKE_DURATION_S) {
        const damp = SHAKE_AMPLITUDE * (1 - e / SHAKE_DURATION_S) ** 2;
        dx = damp * Math.sin(e * 47);
        dy = damp * Math.cos(e * 61);
      }
    }
    return [{ translateX: dx }, { translateY: -s.cameraY + dy }];
  });

  // Live (decaying) orbit circle around the current planet.
  const orbitCx = useDerivedValue(
    () => findPlanet(gameState.value.planets, gameState.value.currentPlanetId)?.center.x ?? 0,
  );
  const orbitCy = useDerivedValue(
    () => findPlanet(gameState.value.planets, gameState.value.currentPlanetId)?.center.y ?? 0,
  );
  const orbitR = useDerivedValue(() => Math.max(gameState.value.orbitRadius, 1));
  const orbitOpacity = useDerivedValue(() =>
    gameState.value.phase === 'orbiting' ? 0.65 : 0,
  );

  // Dashed tangent aim line: where a release right now would send you.
  const aimP1 = useDerivedValue(() => {
    const s = gameState.value;
    const tx = -Math.sin(s.angle) * s.direction;
    const ty = Math.cos(s.angle) * s.direction;
    return vec(s.ballPos.x + tx * AIM_LINE_START, s.ballPos.y + ty * AIM_LINE_START);
  });
  const aimP2 = useDerivedValue(() => {
    const s = gameState.value;
    const tx = -Math.sin(s.angle) * s.direction;
    const ty = Math.cos(s.angle) * s.direction;
    const len = AIM_LINE_START + AIM_LINE_LENGTH;
    return vec(s.ballPos.x + tx * len, s.ballPos.y + ty * len);
  });
  const aimOpacity = useDerivedValue(() =>
    gameState.value.phase === 'orbiting' ? AIM_LINE_OPACITY : 0,
  );

  // Squash/stretch: the ball elongates along its velocity right after release.
  const ballOrigin = useDerivedValue(() =>
    vec(gameState.value.ballPos.x, gameState.value.ballPos.y),
  );
  const ballTransform = useDerivedValue(() => {
    const s = gameState.value;
    let stretch = 0;
    let rot = 0;
    if (s.phase === 'flying') {
      const e = s.time - s.lastReleaseAt;
      if (e >= 0 && e < RELEASE_STRETCH_S) {
        stretch = RELEASE_STRETCH_AMOUNT * (1 - e / RELEASE_STRETCH_S);
      }
      rot = Math.atan2(s.velocity.y, s.velocity.x);
    }
    return [{ rotate: rot }, { scaleX: 1 + stretch }, { scaleY: 1 - stretch * 0.5 }];
  });

  const ballX = useDerivedValue(() => gameState.value.ballPos.x);
  const ballY = useDerivedValue(() => gameState.value.ballPos.y);
  const ballOpacity = useDerivedValue(() => (gameState.value.phase === 'dead' ? 0 : 1));

  // Comet heat: the glow IS the multiplier gauge — color steps with heat,
  // and each flyby pops the glow for a beat.
  const glowColor = useDerivedValue(() => HEAT_COLORS[gameState.value.heat]);
  const flybyPop = (s: GameState): number => {
    'worklet';
    const e = s.time - s.lastFlybyAt;
    return e >= 0 && e < FLYBY_PULSE_S ? 1 - e / FLYBY_PULSE_S : 0;
  };
  const glowR = useDerivedValue(() => {
    const s = gameState.value;
    return BALL_RADIUS * 2.4 * (1 + 0.12 * s.heat + 0.5 * flybyPop(s));
  });
  const glowOpacity = useDerivedValue(() => {
    const s = gameState.value;
    return 0.35 + 0.07 * s.heat + 0.3 * flybyPop(s);
  });

  // White impact flash over everything at the moment of death.
  const flashOpacity = useDerivedValue(() => {
    const s = gameState.value;
    if (s.phase !== 'dead') return 0;
    const e = s.time - s.deathTime;
    if (e < 0 || e > FLASH_DURATION_S) return 0;
    return 0.55 * (1 - e / FLASH_DURATION_S);
  });

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height}>
        <Shader source={BG_SHADER} uniforms={bgUniforms} />
      </Rect>
      <Points points={stars.dim} mode="points" color={COLORS.starDim} style="stroke" strokeWidth={1.6} strokeCap="round" opacity={0.5} />
      <Points points={stars.bright} mode="points" color={COLORS.starBright} style="stroke" strokeWidth={2.4} strokeCap="round" opacity={0.8} />
      <Group transform={worldTransform}>
        {planets
          .filter((p) => p.id > 0 && p.id % MILESTONE_INTERVAL === 0)
          .map((planet) => (
            <MilestoneMarker key={`m${planet.id}`} planet={planet} width={width} />
          ))}
        {planets.map((planet) => (
          <PlanetView key={planet.id} planet={planet} gameState={gameState} />
        ))}
        <Circle
          cx={orbitCx}
          cy={orbitCy}
          r={orbitR}
          style="stroke"
          strokeWidth={1.5}
          color={COLORS.ball}
          opacity={orbitOpacity}
        />
        <Line p1={aimP1} p2={aimP2} color={COLORS.ball} strokeWidth={2} strokeCap="round" opacity={aimOpacity}>
          <DashPathEffect intervals={[7, 8]} />
        </Line>
        <PerfectPulse gameState={gameState} />
        <Trail gameState={gameState} />
        <Group origin={ballOrigin} transform={ballTransform} opacity={ballOpacity}>
          <Circle cx={ballX} cy={ballY} r={glowR} color={glowColor} opacity={glowOpacity}>
            <BlurMask blur={10} style="normal" />
          </Circle>
          <Circle cx={ballX} cy={ballY} r={BALL_RADIUS} color={COLORS.ball} />
        </Group>
        <CaptureBurst gameState={gameState} />
        <DeathShatter gameState={gameState} />
      </Group>
      <Rect x={0} y={0} width={width} height={height} color="#FFFFFF" opacity={flashOpacity} />
    </Canvas>
  );
}
