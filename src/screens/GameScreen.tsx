import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedReaction,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { sfxCapture, sfxDeath, sfxRelease, sfxZone } from '../audio/sfx';
import { hapticCapture, hapticDeath, hapticRelease, hapticZone } from '../effects/haptics';
import { DEATH_OVERLAY_DELAY_MS, MAX_FRAME_DT_S, ZONE_FLASH_MS } from '../game/constants';
import { comboMultiplier, createInitialState, handleTap, stepGame } from '../game/engine';
import type { CaptureKind, DeathCause, GameState, Phase, Planet } from '../game/types';
import { GameCanvas } from '../rendering/GameCanvas';
import { zonePalette } from '../rendering/zones';
import { useAppStore } from '../state/appStore';

const DEATH_MESSAGES: Record<DeathCause, string> = {
  crash: 'SMACKED THE SURFACE',
  lost: 'LOST IN THE VOID',
  burned: 'BURNED UP IN ORBIT',
};

export function GameScreen() {
  const { width, height } = useWindowDimensions();
  const initialState = useMemo(() => createInitialState(width, height), [width, height]);
  const gameState = useSharedValue<GameState>(initialState);

  // React-side mirrors, updated only on discrete events (never per frame).
  const [uiScore, setUiScore] = useState(0);
  const [uiCombo, setUiCombo] = useState(0);
  const [uiPhase, setUiPhase] = useState<Phase>('orbiting');
  const [uiDeathCause, setUiDeathCause] = useState<DeathCause | null>(null);
  const [isNewBest, setIsNewBest] = useState(false);
  const [zoneFlash, setZoneFlash] = useState<string | null>(null);
  const zoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Planet window changes on generation/prune (a few times per capture at most).
  const [planets, setPlanets] = useState<Planet[]>(initialState.planets);

  const bestScore = useAppStore((s) => s.bestScore);

  useEffect(() => {
    return () => {
      if (zoneTimer.current !== null) clearTimeout(zoneTimer.current);
    };
  }, []);

  useFrameCallback((frame) => {
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16.7) / 1000, MAX_FRAME_DT_S);
    // Copy-then-mutate: the engine only replaces top-level fields, and
    // reassigning .value is what notifies Skia's derived values.
    const s = { ...gameState.value };
    stepGame(s, dt);
    gameState.value = s;
  });

  const onRelease = () => {
    sfxRelease();
    hapticRelease();
  };
  const onCapture = (kind: CaptureKind, comboLinks: number) => {
    sfxCapture(kind, comboLinks);
    hapticCapture(kind);
  };
  const onDeath = (score: number) => {
    sfxDeath();
    hapticDeath();
    setIsNewBest(useAppStore.getState().submitScore(score));
  };
  const onZone = (zoneIndex: number) => {
    sfxZone();
    hapticZone();
    setZoneFlash(zonePalette(zoneIndex).name);
    if (zoneTimer.current !== null) clearTimeout(zoneTimer.current);
    zoneTimer.current = setTimeout(() => setZoneFlash(null), ZONE_FLASH_MS);
  };

  // While dead, input belongs to the death card (tap-to-retry surface +
  // share/home buttons); the global gesture would race the buttons.
  const tap = Gesture.Tap()
    .enabled(uiPhase !== 'dead')
    .onBegin(() => {
      // onBegin fires on touch-down (not release) — lowest possible input latency.
      gameState.value = { ...handleTap({ ...gameState.value }) };
    });

  // Worklets are plain functions on the JS thread, so the death card can
  // drive the same tap logic (restart cooldown included) from a Pressable.
  const restartRun = () => {
    gameState.value = { ...handleTap({ ...gameState.value }) };
  };
  const shareScore = () => {
    Share.share({
      message: `I scored ${uiScore} in Leap of Void — can you beat it? #leapofvoid`,
    }).catch(() => {});
  };
  const goHome = () => {
    useAppStore.getState().setScreen('home');
  };

  useAnimatedReaction(
    () => gameState.value.score,
    (score, prev) => {
      if (score !== prev) runOnJS(setUiScore)(score);
    },
  );
  useAnimatedReaction(
    () => gameState.value.comboLinks,
    (links, prev) => {
      if (links !== prev) runOnJS(setUiCombo)(links);
    },
  );
  useAnimatedReaction(
    () => gameState.value.phase,
    (phase, prev) => {
      if (phase !== prev) {
        runOnJS(setUiPhase)(phase);
        if (phase === 'dead') {
          runOnJS(setUiDeathCause)(gameState.value.deathCause);
          if (prev !== null) runOnJS(onDeath)(gameState.value.score);
        }
      }
    },
  );
  useAnimatedReaction(
    () => gameState.value.lastReleaseAt,
    (t, prev) => {
      if (prev !== null && t !== prev && t >= 0) runOnJS(onRelease)();
    },
  );
  useAnimatedReaction(
    () => gameState.value.lastCaptureAt,
    (t, prev) => {
      if (prev !== null && t !== prev && t >= 0) {
        runOnJS(onCapture)(gameState.value.captureKind, gameState.value.comboLinks);
      }
    },
  );
  useAnimatedReaction(
    () => gameState.value.zoneChangedAt,
    (t, prev) => {
      if (prev !== null && t !== prev && t >= 0) {
        runOnJS(onZone)(gameState.value.zoneIndex);
      }
    },
  );
  // The engine replaces the array reference whenever the window changes, so
  // reference equality is exactly "did generation or pruning happen".
  useAnimatedReaction(
    () => gameState.value.planets,
    (current, prev) => {
      if (current !== prev) runOnJS(setPlanets)(current);
    },
  );

  const multiplier = comboMultiplier(uiCombo);

  return (
    <GestureDetector gesture={tap}>
      <View style={styles.root}>
        <GameCanvas width={width} height={height} planets={planets} gameState={gameState} />
        <View style={styles.hud} pointerEvents="none">
          <Text style={styles.score}>{uiScore}</Text>
          {multiplier >= 2 && <Text style={styles.combo}>×{multiplier}</Text>}
        </View>
        {zoneFlash !== null && (
          <Animated.View
            entering={FadeIn.duration(250)}
            exiting={FadeOut.duration(450)}
            style={styles.zoneFlashWrap}
            pointerEvents="none"
          >
            <Text style={styles.zoneName}>{zoneFlash}</Text>
          </Animated.View>
        )}
        {uiPhase === 'orbiting' && uiScore === 0 && (
          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={styles.hint}>tap to release</Text>
          </View>
        )}
        {uiPhase === 'dead' && (
          <Animated.View
            entering={FadeIn.delay(DEATH_OVERLAY_DELAY_MS).duration(300)}
            exiting={FadeOut.duration(120)}
            style={styles.deathOverlay}
          >
            <Pressable style={styles.deathTapArea} onPress={restartRun}>
              <Text style={styles.deathCause}>
                {uiDeathCause !== null ? DEATH_MESSAGES[uiDeathCause] : ''}
              </Text>
              <Text style={styles.deathScore}>{uiScore}</Text>
              {isNewBest ? (
                <Text style={styles.newBest}>NEW BEST</Text>
              ) : (
                <Text style={styles.bestLine}>BEST {bestScore}</Text>
              )}
              {/* Reserved for the post-launch rewarded "continue" button. */}
              <View style={styles.continueSlot} />
              <Text style={styles.retry}>tap to try again</Text>
              <View style={styles.deathButtons}>
                <Pressable style={styles.deathButton} onPress={shareScore} hitSlop={8}>
                  <Text style={styles.deathButtonText}>SHARE</Text>
                </Pressable>
                <Pressable style={styles.deathButton} onPress={goHome} hitSlop={8}>
                  <Text style={styles.deathButtonText}>HOME</Text>
                </Pressable>
              </View>
            </Pressable>
          </Animated.View>
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
  combo: {
    color: '#7DF9FF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: -2,
  },
  zoneFlashWrap: {
    position: 'absolute',
    top: '30%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  zoneName: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 8,
    textAlign: 'center',
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
  },
  deathTapArea: {
    flex: 1,
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
  newBest: {
    color: '#F9C80E',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 5,
  },
  bestLine: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 3,
    fontVariant: ['tabular-nums'],
  },
  continueSlot: {
    height: 56,
  },
  retry: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 15,
    letterSpacing: 2,
  },
  deathButtons: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 32,
  },
  deathButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 22,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  deathButtonText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
