import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { setBurnHeat } from '../audio/burn';
import { sfxCapture, sfxDeath, sfxFlyby, sfxRelease, sfxZone } from '../audio/sfx';
import {
  hapticCapture,
  hapticDeath,
  hapticFlyby,
  hapticRelease,
  hapticZone,
} from '../effects/haptics';
import {
  DEATH_OVERLAY_DELAY_MS,
  HEAT_COLORS,
  MAX_FRAME_DT_S,
  PAUSE_HOTSPOT_PX,
  WARP_IN_MS,
  WARP_IN_SCALE,
  ZONE_FLASH_MS,
} from '../game/constants';
import { createInitialState, handleTap, stepGame } from '../game/engine';
import type { CaptureKind, DeathCause, GameState, Phase, Planet } from '../game/types';
import { GameCanvas } from '../rendering/GameCanvas';
import { zonePalette } from '../rendering/zones';
import { useAppStore } from '../state/appStore';
import { SettingsPills } from './ui';

const DEATH_MESSAGES: Record<DeathCause, string> = {
  crash: 'SMACKED THE SURFACE',
  lost: 'LOST IN THE VOID',
  burned: 'BURNED UP IN ORBIT',
};

export function GameScreen() {
  const { width, height } = useWindowDimensions();
  const initialState = useMemo(() => createInitialState(width, height), [width, height]);
  const gameState = useSharedValue<GameState>(initialState);

  // Pause lives outside GameState: the frame loop just stops stepping, so
  // the sim stays pure and every time-based visual freezes for free.
  const paused = useSharedValue(false);
  const [uiPaused, setUiPaused] = useState(false);

  // React-side mirrors, updated only on discrete events (never per frame).
  const [uiScore, setUiScore] = useState(0);
  const [uiHeat, setUiHeat] = useState(0);
  const [uiPhase, setUiPhase] = useState<Phase>('orbiting');
  const [uiDeathCause, setUiDeathCause] = useState<DeathCause | null>(null);
  const [uiPlanets, setUiPlanets] = useState(0);
  const [isNewBest, setIsNewBest] = useState(false);
  const [zoneFlash, setZoneFlash] = useState<string | null>(null);
  const zoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Planet window changes on generation/prune (a few times per capture at most).
  const [planets, setPlanets] = useState<Planet[]>(initialState.planets);

  const bestScore = useAppStore((s) => s.bestScore);

  // Warp arrival: the screen mounts mid-motion (scale-in + fade) so the
  // home screen's zoom-out reads as one continuous flight.
  const warpIn = useSharedValue(0);
  useEffect(() => {
    warpIn.value = withTiming(1, { duration: WARP_IN_MS, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const warpStyle = useAnimatedStyle(() => ({
    opacity: warpIn.value,
    transform: [{ scale: WARP_IN_SCALE + (1 - WARP_IN_SCALE) * warpIn.value }],
  }));

  useEffect(() => {
    return () => {
      if (zoneTimer.current !== null) clearTimeout(zoneTimer.current);
      setBurnHeat(0); // leaving the screen must never strand the burn loop
    };
  }, []);

  useFrameCallback((frame) => {
    if (paused.value) return;
    const dt = Math.min((frame.timeSincePreviousFrame ?? 16.7) / 1000, MAX_FRAME_DT_S);
    // Copy-then-mutate: the engine only replaces top-level fields, and
    // reassigning .value is what notifies Skia's derived values.
    const s = { ...gameState.value };
    stepGame(s, dt);
    gameState.value = s;
  });

  const pauseGame = () => {
    paused.value = true;
    setUiPaused(true);
  };
  const resumeGame = () => {
    paused.value = false;
    setUiPaused(false);
  };

  // Auto-pause on backgrounding — a run must not die unattended. Reads the
  // phase from the shared value so the once-registered listener never sees
  // stale React state.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') return;
      const phase = gameState.value.phase;
      if (phase === 'orbiting' || phase === 'flying') pauseGame();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRelease = () => {
    sfxRelease();
    hapticRelease();
  };
  const onCapture = (kind: CaptureKind, heat: number) => {
    sfxCapture(kind, heat);
    hapticCapture(kind);
  };
  const onFlyby = (heat: number) => {
    sfxFlyby(heat);
    hapticFlyby();
  };
  const onDeath = (score: number, planetsPassed: number) => {
    sfxDeath();
    hapticDeath();
    setBurnHeat(0); // the flame dies with the ball, whatever heat says
    setUiPlanets(planetsPassed);
    setIsNewBest(useAppStore.getState().submitScore(score));
  };
  const onHeat = (heat: number) => {
    setUiHeat(heat);
    setBurnHeat(heat);
  };
  const onZone = (zoneIndex: number) => {
    sfxZone();
    hapticZone();
    setZoneFlash(zonePalette(zoneIndex).name);
    if (zoneTimer.current !== null) clearTimeout(zoneTimer.current);
    zoneTimer.current = setTimeout(() => setZoneFlash(null), ZONE_FLASH_MS);
  };

  // Playable tap only — overlays live outside this detector so pause/death
  // UI can never race the release gesture (Resume used to re-enable the
  // gesture mid-press and fire a release on the same touch).
  const tap = Gesture.Tap()
    .enabled(uiPhase !== 'dead' && !uiPaused)
    .onBegin((e) => {
      // Shared-value guard: React `.enabled` can lag one frame behind pause.
      if (paused.value) return;
      // onBegin fires on touch-down (not release) — lowest possible input latency.
      // The one carve-out from tap-anywhere-releases: a small top-right
      // hotspot pauses instead (checked here so nothing races the release).
      if (e.x >= width - PAUSE_HOTSPOT_PX && e.y <= PAUSE_HOTSPOT_PX) {
        runOnJS(pauseGame)();
        return;
      }
      gameState.value = { ...handleTap({ ...gameState.value }) };
    });

  // Worklets are plain functions on the JS thread, so the death card can
  // drive the same tap logic (restart cooldown included) from a Pressable.
  const restartRun = () => {
    // A zone banner from the previous run must not hang over the fresh one.
    if (zoneTimer.current !== null) clearTimeout(zoneTimer.current);
    setZoneFlash(null);
    gameState.value = { ...handleTap({ ...gameState.value }) };
  };
  const shareScore = () => {
    const planets = `${uiPlanets} ${uiPlanets === 1 ? 'planet' : 'planets'} deep`;
    Share.share({
      message: `I scored ${uiScore} in Leap of Void — ${planets}. Can you beat it? #leapofvoid`,
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
    () => gameState.value.heat,
    (heat, prev) => {
      if (heat !== prev) runOnJS(onHeat)(heat);
    },
  );
  useAnimatedReaction(
    () => gameState.value.lastFlybyAt,
    (t, prev) => {
      if (prev !== null && t !== prev && t >= 0) {
        runOnJS(onFlyby)(gameState.value.heat);
      }
    },
  );
  useAnimatedReaction(
    () => gameState.value.phase,
    (phase, prev) => {
      if (phase !== prev) {
        runOnJS(setUiPhase)(phase);
        if (phase === 'dead') {
          runOnJS(setUiDeathCause)(gameState.value.deathCause);
          if (prev !== null) {
            runOnJS(onDeath)(gameState.value.score, gameState.value.planetsPassed);
          }
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
        runOnJS(onCapture)(gameState.value.captureKind, gameState.value.heat);
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

  return (
    <Animated.View style={[styles.root, warpStyle]}>
      <GestureDetector gesture={tap}>
        <View style={styles.playSurface}>
          <GameCanvas width={width} height={height} planets={planets} gameState={gameState} />
        </View>
      </GestureDetector>
      <View style={styles.hud} pointerEvents="none">
        <Text style={styles.score}>{uiScore}</Text>
        {uiHeat > 0 && (
          <Text style={[styles.heatBadge, { color: HEAT_COLORS[uiHeat] }]}>×{1 + uiHeat}</Text>
        )}
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
          <Text style={styles.hint}>TAP TO RELEASE</Text>
        </View>
      )}
      {uiPhase !== 'dead' && !uiPaused && (
        <View style={styles.pauseGlyph} pointerEvents="none">
          <Text style={styles.pauseGlyphText}>II</Text>
        </View>
      )}
      {uiPaused && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(120)}
          style={styles.pauseOverlay}
        >
          <Text style={styles.pausedTitle}>PAUSED</Text>
          <Pressable style={styles.resumeButton} onPress={resumeGame} hitSlop={8}>
            <Text style={styles.resumeText}>RESUME</Text>
          </Pressable>
          <View style={styles.pausePills}>
            <SettingsPills />
          </View>
          <Pressable style={styles.quitButton} onPress={goHome} hitSlop={14}>
            <Text style={styles.quitText}>HOME</Text>
          </Pressable>
        </Animated.View>
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
            <Text style={styles.planetsLine}>
              {uiPlanets} {uiPlanets === 1 ? 'PLANET' : 'PLANETS'}
            </Text>
            {/* Reserved for the post-launch rewarded "continue" button. */}
            <View style={styles.continueSlot} />
            <Text style={styles.retry}>TAP TO TRY AGAIN</Text>
          </Pressable>
          {/* Bottom corners — outside reflex spam-tap territory; the whole
              center above stays retry surface. */}
          <Pressable
            style={[styles.cornerButton, styles.cornerLeft]}
            onPress={shareScore}
            hitSlop={10}
          >
            <Text style={styles.cornerButtonText}>SHARE</Text>
          </Pressable>
          <Pressable
            style={[styles.cornerButton, styles.cornerRight]}
            onPress={goHome}
            hitSlop={10}
          >
            <Text style={styles.cornerButtonText}>HOME</Text>
          </Pressable>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
  },
  playSurface: {
    ...StyleSheet.absoluteFillObject,
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
  heatBadge: {
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
  planetsLine: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 3,
    marginTop: 8,
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
  pauseGlyph: {
    position: 'absolute',
    top: 56,
    right: 24,
  },
  pauseGlyphText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
  },
  pauseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,4,16,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 8,
  },
  resumeButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
    borderRadius: 26,
    paddingHorizontal: 40,
    paddingVertical: 14,
    marginTop: 36,
  },
  resumeText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 3,
  },
  pausePills: {
    marginTop: 36,
  },
  quitButton: {
    position: 'absolute',
    bottom: 52,
    alignSelf: 'center',
  },
  quitText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 4,
  },
  cornerButton: {
    position: 'absolute',
    bottom: 30,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  cornerLeft: {
    left: 24,
  },
  cornerRight: {
    right: 24,
  },
  cornerButtonText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
