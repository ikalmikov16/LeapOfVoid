import {
  BlurMask,
  Canvas,
  Circle,
  Points,
  Rect,
  Shader,
  vec,
  type SkPoint,
} from '@shopify/react-native-skia';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { COLORS, WARP_OUT_MS, WARP_OUT_SCALE } from '../game/constants';
import { BG_SHADER, hexToRgb01 } from '../rendering/bgShader';
import { useAppStore } from '../state/appStore';
import { SettingsPills } from './ui';

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

/** Decorative orbit below the title — it IS the core mechanic, pre-taught. */
const VIGNETTE_PLANET_R = 20;
const VIGNETTE_ORBIT_R = 44;
const VIGNETTE_BALL_R = 5;
const VIGNETTE_PERIOD_MS = 4200;

export function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const bestScore = useAppStore((s) => s.bestScore);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const stars = useMemo(() => {
    const rand = mulberry32(2026);
    const dim: SkPoint[] = [];
    const bright: SkPoint[] = [];
    for (let i = 0; i < 70; i++) {
      const p = vec(rand() * width, rand() * height);
      (i % 3 === 0 ? bright : dim).push(p);
    }
    return { dim, bright };
  }, [width, height]);

  // Orbit vignette clock (cos/sin are periodic, so the repeat is seamless)
  // and the breathing "tap to start" hint, both started once on mount.
  const orbitAngle = useSharedValue(0);
  const hintPulse = useSharedValue(0);
  useEffect(() => {
    orbitAngle.value = withRepeat(
      withTiming(Math.PI * 2, { duration: VIGNETTE_PERIOD_MS, easing: Easing.linear }),
      -1,
    );
    hintPulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const vignetteX = width / 2;
  const vignetteY = height * 0.76;
  const vBallX = useDerivedValue(
    () => vignetteX + Math.cos(orbitAngle.value) * VIGNETTE_ORBIT_R,
  );
  const vBallY = useDerivedValue(
    () => vignetteY + Math.sin(orbitAngle.value) * VIGNETTE_ORBIT_R,
  );

  const hintStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + 0.3 * hintPulse.value,
  }));

  // Warp-out: the whole screen accelerates past the camera, then the game
  // mounts with the matching arrival animation (GameScreen).
  const warping = useRef(false);
  const warpOut = useSharedValue(0);
  const warpStyle = useAnimatedStyle(() => ({
    opacity: 1 - warpOut.value,
    transform: [{ scale: 1 + (WARP_OUT_SCALE - 1) * warpOut.value }],
  }));
  const enterGame = () => {
    useAppStore.getState().setScreen('game');
  };
  const startGame = () => {
    if (warping.current) return;
    warping.current = true;
    warpOut.value = withTiming(
      1,
      { duration: WARP_OUT_MS, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(enterGame)();
      },
    );
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.warpWrap, warpStyle]}>
        <Canvas style={{ position: 'absolute', top: 0, left: 0, width, height }}>
          <Rect x={0} y={0} width={width} height={height}>
            <Shader
              source={BG_SHADER}
              uniforms={{
                uRes: [width, height],
                uTop: hexToRgb01(COLORS.bgTop),
                uBottom: hexToRgb01(COLORS.bgBottom),
              }}
            />
          </Rect>
          <Points points={stars.dim} mode="points" color={COLORS.starDim} style="stroke" strokeWidth={1.6} strokeCap="round" opacity={0.5} />
          <Points points={stars.bright} mode="points" color={COLORS.starBright} style="stroke" strokeWidth={2.4} strokeCap="round" opacity={0.8} />
          <Circle cx={vignetteX} cy={vignetteY} r={VIGNETTE_PLANET_R * 1.3} color="#9B5DE5" opacity={0.3}>
            <BlurMask blur={12} style="normal" />
          </Circle>
          <Circle
            cx={vignetteX}
            cy={vignetteY}
            r={VIGNETTE_ORBIT_R}
            style="stroke"
            strokeWidth={1.5}
            color="#9B5DE5"
            opacity={0.3}
          />
          <Circle cx={vignetteX} cy={vignetteY} r={VIGNETTE_PLANET_R} color="#9B5DE5" />
          <Circle cx={vBallX} cy={vBallY} r={VIGNETTE_BALL_R * 2.2} color={COLORS.ballGlow} opacity={0.35}>
            <BlurMask blur={7} style="normal" />
          </Circle>
          <Circle cx={vBallX} cy={vBallY} r={VIGNETTE_BALL_R} color={COLORS.ball} />
        </Canvas>
        <Pressable style={styles.tapArea} onPress={startGame}>
          <Text style={styles.titleTop}>LEAP OF</Text>
          <Text style={styles.titleMain}>VOID</Text>
          <Text style={styles.best}>{bestScore > 0 ? `BEST ${bestScore}` : ''}</Text>
          <Animated.Text style={[styles.hint, hintStyle]}>TAP TO START</Animated.Text>
        </Pressable>
        <Pressable style={styles.gear} onPress={() => setSettingsOpen(true)} hitSlop={12}>
          <Ionicons name="settings-outline" size={24} color="rgba(255,255,255,0.45)" />
        </Pressable>
      </Animated.View>
      {settingsOpen && (
        <Animated.View
          entering={FadeIn.duration(150)}
          exiting={FadeOut.duration(120)}
          style={styles.settingsOverlay}
        >
          <Pressable style={styles.settingsBackdrop} onPress={() => setSettingsOpen(false)} />
          <View style={styles.settingsCard} pointerEvents="box-none">
            <Text style={styles.settingsTitle}>SETTINGS</Text>
            <SettingsPills />
            <Pressable style={styles.closeButton} onPress={() => setSettingsOpen(false)} hitSlop={14}>
              <Text style={styles.closeText}>CLOSE</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
  },
  warpWrap: {
    flex: 1,
  },
  tapArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleTop: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 10,
  },
  titleMain: {
    color: '#FFFFFF',
    fontSize: 68,
    fontWeight: '900',
    letterSpacing: 14,
    marginTop: 2,
    // Center the glyphs despite the trailing letter-spacing.
    paddingLeft: 14,
  },
  best: {
    color: '#7DF9FF',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 26,
    minHeight: 22,
    fontVariant: ['tabular-nums'],
  },
  hint: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    letterSpacing: 2,
    marginTop: 40,
  },
  gear: {
    position: 'absolute',
    top: 56,
    right: 24,
  },
  settingsOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(4,4,16,0.94)',
  },
  settingsCard: {
    alignItems: 'center',
  },
  settingsTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 7,
    marginBottom: 30,
  },
  closeButton: {
    marginTop: 34,
  },
  closeText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 4,
  },
});
