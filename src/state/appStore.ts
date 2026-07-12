// App-level state: current screen, best score, settings. Written only on
// discrete events (death, toggles, navigation) — never per-frame data.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type Screen = 'home' | 'game';

const KEY_BEST = 'lov:best';
const KEY_SOUND = 'lov:sound';
const KEY_HAPTICS = 'lov:haptics';

interface AppState {
  screen: Screen;
  bestScore: number;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  setScreen: (screen: Screen) => void;
  /** Records a finished run; persists and returns true when it's a new best. */
  submitScore: (score: number) => boolean;
  toggleSound: () => void;
  toggleHaptics: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'home',
  bestScore: 0,
  soundEnabled: true,
  hapticsEnabled: true,
  setScreen: (screen) => set({ screen }),
  submitScore: (score) => {
    if (score <= get().bestScore) return false;
    set({ bestScore: score });
    AsyncStorage.setItem(KEY_BEST, String(score)).catch(() => {});
    return true;
  },
  toggleSound: () => {
    const soundEnabled = !get().soundEnabled;
    set({ soundEnabled });
    AsyncStorage.setItem(KEY_SOUND, soundEnabled ? '1' : '0').catch(() => {});
  },
  toggleHaptics: () => {
    const hapticsEnabled = !get().hapticsEnabled;
    set({ hapticsEnabled });
    AsyncStorage.setItem(KEY_HAPTICS, hapticsEnabled ? '1' : '0').catch(() => {});
  },
}));

/** Load persisted values once at launch (fired from App mount). */
export async function hydrateAppStore(): Promise<void> {
  try {
    const entries = await AsyncStorage.multiGet([KEY_BEST, KEY_SOUND, KEY_HAPTICS]);
    const read = (key: string) => entries.find(([k]) => k === key)?.[1] ?? null;
    const best = Number(read(KEY_BEST));
    useAppStore.setState({
      bestScore: Number.isFinite(best) && best > 0 ? best : 0,
      soundEnabled: read(KEY_SOUND) !== '0',
      hapticsEnabled: read(KEY_HAPTICS) !== '0',
    });
  } catch {
    // First launch or storage unavailable — defaults stand.
  }
}
