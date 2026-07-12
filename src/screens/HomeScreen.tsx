import { Canvas, LinearGradient, Points, Rect, vec, type SkPoint } from '@shopify/react-native-skia';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useAppStore } from '../state/appStore';

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

export function HomeScreen() {
  const { width, height } = useWindowDimensions();
  const bestScore = useAppStore((s) => s.bestScore);
  const soundEnabled = useAppStore((s) => s.soundEnabled);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);

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

  return (
    <View style={styles.root}>
      <Canvas style={{ position: 'absolute', top: 0, left: 0, width, height }}>
        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={[COLORS.bgTop, COLORS.bgBottom]}
          />
        </Rect>
        <Points points={stars.dim} mode="points" color={COLORS.starDim} style="stroke" strokeWidth={1.6} strokeCap="round" opacity={0.5} />
        <Points points={stars.bright} mode="points" color={COLORS.starBright} style="stroke" strokeWidth={2.4} strokeCap="round" opacity={0.8} />
      </Canvas>
      <Pressable style={styles.tapArea} onPress={() => useAppStore.getState().setScreen('game')}>
        <Text style={styles.titleTop}>LEAP OF</Text>
        <Text style={styles.titleMain}>VOID</Text>
        <Text style={styles.best}>{bestScore > 0 ? `BEST ${bestScore}` : ''}</Text>
        <Text style={styles.hint}>tap to start</Text>
      </Pressable>
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.pill, !soundEnabled && styles.pillOff]}
          onPress={() => useAppStore.getState().toggleSound()}
          hitSlop={8}
        >
          <Text style={styles.pillText}>{soundEnabled ? 'SOUND ON' : 'SOUND OFF'}</Text>
        </Pressable>
        <Pressable
          style={[styles.pill, !hapticsEnabled && styles.pillOff]}
          onPress={() => useAppStore.getState().toggleHaptics()}
          hitSlop={8}
        >
          <Text style={styles.pillText}>{hapticsEnabled ? 'HAPTICS ON' : 'HAPTICS OFF'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#050510',
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
    color: 'rgba(255,255,255,0.45)',
    fontSize: 16,
    letterSpacing: 2,
    marginTop: 40,
  },
  toggleRow: {
    position: 'absolute',
    bottom: 44,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  pill: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pillOff: {
    opacity: 0.4,
  },
  pillText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
