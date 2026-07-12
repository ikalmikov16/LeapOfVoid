import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Points,
  Rect,
  vec,
  type SkPoint,
} from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { BALL_RADIUS, COLORS } from '../game/constants';
import { findPlanet } from '../game/engine';
import type { GameState, Planet } from '../game/types';

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
  // Screen-fixed starfield backdrop (parallax is an M3 concern).
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

  const worldTransform = useDerivedValue(() => [{ translateY: -gameState.value.cameraY }]);

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

  const ballX = useDerivedValue(() => gameState.value.ballPos.x);
  const ballY = useDerivedValue(() => gameState.value.ballPos.y);
  const ballOpacity = useDerivedValue(() => (gameState.value.phase === 'dead' ? 0 : 1));

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, height)}
          colors={[COLORS.bgTop, COLORS.bgBottom]}
        />
      </Rect>
      <Points points={stars.dim} mode="points" color={COLORS.starDim} style="stroke" strokeWidth={1.6} strokeCap="round" opacity={0.5} />
      <Points points={stars.bright} mode="points" color={COLORS.starBright} style="stroke" strokeWidth={2.4} strokeCap="round" opacity={0.8} />
      <Group transform={worldTransform}>
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
        <Group opacity={ballOpacity}>
          <Circle cx={ballX} cy={ballY} r={BALL_RADIUS * 2.4} color={COLORS.ballGlow} opacity={0.35}>
            <BlurMask blur={10} style="normal" />
          </Circle>
          <Circle cx={ballX} cy={ballY} r={BALL_RADIUS} color={COLORS.ball} />
        </Group>
      </Group>
    </Canvas>
  );
}
