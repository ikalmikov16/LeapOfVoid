import { useMemo, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { MAX_FRAME_DT_S } from '../game/constants';
import { createInitialState, createLevel, handleTap, stepGame } from '../game/engine';
import type { DeathCause, GameState, Phase } from '../game/types';
import { GameCanvas } from '../rendering/GameCanvas';

export function GameScreen() {
  const { width, height } = useWindowDimensions();
  // Static render copy of the level; deterministic, so it matches the sim's.
  const planets = useMemo(() => createLevel(width, height), [width, height]);
  const gameState = useSharedValue<GameState>(createInitialState(width, height));

  // React-side mirrors, updated only on discrete events (never per frame).
  const [uiScore, setUiScore] = useState(0);
  const [uiPhase, setUiPhase] = useState<Phase>('orbiting');
  const [uiDeathCause, setUiDeathCause] = useState<DeathCause | null>(null);

  useFrameCallback((frame) => {
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16.7) / 1000, MAX_FRAME_DT_S);
    // Copy-then-mutate: the engine only replaces top-level fields, and
    // reassigning .value is what notifies Skia's derived values.
    const s = { ...gameState.value };
    stepGame(s, dt);
    gameState.value = s;
  });

  const tap = Gesture.Tap().onBegin(() => {
    // onBegin fires on touch-down (not release) — lowest possible input latency.
    gameState.value = { ...handleTap({ ...gameState.value }) };
  });

  useAnimatedReaction(
    () => gameState.value.score,
    (score, prev) => {
      if (score !== prev) runOnJS(setUiScore)(score);
    },
  );
  useAnimatedReaction(
    () => gameState.value.phase,
    (phase, prev) => {
      if (phase !== prev) {
        runOnJS(setUiPhase)(phase);
        if (phase === 'dead') runOnJS(setUiDeathCause)(gameState.value.deathCause);
      }
    },
  );

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.root}>
        <GameCanvas width={width} height={height} planets={planets} gameState={gameState} />
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.score}>{uiScore}</Text>
        </View>
        {uiPhase === 'orbiting' && uiScore === 0 && (
          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={styles.hint}>tap to release</Text>
          </View>
        )}
        {uiPhase === 'dead' && (
          <View style={styles.deathOverlay} pointerEvents="none">
            <Text style={styles.deathCause}>
              {uiDeathCause === 'crash' ? 'SMACKED THE SURFACE' : 'LOST IN THE VOID'}
            </Text>
            <Text style={styles.deathScore}>{uiScore}</Text>
            <Text style={styles.retry}>tap to try again</Text>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
  },
  hud: {
    position: 'absolute',
    top: 64,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  score: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  hintWrap: {
    position: 'absolute',
    bottom: 48,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 16,
    letterSpacing: 2,
  },
  deathOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,4,16,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deathCause: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 4,
  },
  deathScore: {
    color: '#FFFFFF',
    fontSize: 104,
    fontWeight: '900',
    marginVertical: 12,
    fontVariant: ['tabular-nums'],
  },
  retry: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
    letterSpacing: 2,
  },
});
