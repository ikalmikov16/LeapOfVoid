// Shared meta-screen UI atoms. Gameplay renders on the Skia canvas; these are
// only for overlays and the home screen.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppStore } from '../state/appStore';

interface TogglePillProps {
  label: string;
  on: boolean;
  onToggle: () => void;
}

export function TogglePill({ label, on, onToggle }: TogglePillProps) {
  return (
    <Pressable style={[styles.pill, !on && styles.pillOff]} onPress={onToggle} hitSlop={8}>
      <Text style={styles.pillText}>
        {label} {on ? 'ON' : 'OFF'}
      </Text>
    </Pressable>
  );
}

/** The three audio/haptics toggles, store-wired — home settings + pause. */
export function SettingsPills() {
  const sfxEnabled = useAppStore((s) => s.sfxEnabled);
  const musicEnabled = useAppStore((s) => s.musicEnabled);
  const hapticsEnabled = useAppStore((s) => s.hapticsEnabled);
  return (
    <View style={styles.row}>
      <TogglePill label="SFX" on={sfxEnabled} onToggle={() => useAppStore.getState().toggleSfx()} />
      <TogglePill
        label="MUSIC"
        on={musicEnabled}
        onToggle={() => useAppStore.getState().toggleMusic()}
      />
      <TogglePill
        label="HAPTICS"
        on={hapticsEnabled}
        onToggle={() => useAppStore.getState().toggleHaptics()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  pill: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 20,
    paddingHorizontal: 14,
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
