// App-level state: current screen, best score, settings. Written only on
// discrete events (death, toggles, navigation) — never per-frame data.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type Screen = 'home' | 'game';

const KEY_BEST = 'lov:best';
/** Legacy single audio toggle — migrated into the sfx/music pair on hydrate. */
const KEY_SOUND = 'lov:sound';
const KEY_SFX = 'lov:sfx';
const KEY_MUSIC = 'lov:music';
const KEY_HAPTICS = 'lov:haptics';

interface AppState {
  screen: Screen;
  bestScore: number;
  sfxEnabled: boolean;
  musicEnabled: boolean;
  hapticsEnabled: boolean;
  setScreen: (screen: Screen) => void;
  /** Records a finished run; persists and returns true when it's a new best. */
  submitScore: (score: number) => boolean;
  toggleSfx: () => void;
  toggleMusic: () => void;
  toggleHaptics: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'home',
  bestScore: 0,
  sfxEnabled: true,
  musicEnabled: true,
  hapticsEnabled: true,
  setScreen: (screen) => set({ screen }),
  submitScore: (score) => {
    if (score <= get().bestScore) return false;
    set({ bestScore: score });
    AsyncStorage.setItem(KEY_BEST, String(score)).catch(() => {});
    return true;
  },
  toggleSfx: () => {
    const sfxEnabled = !get().sfxEnabled;
    set({ sfxEnabled });
    AsyncStorage.setItem(KEY_SFX, sfxEnabled ? '1' : '0').catch(() => {});
  },
  toggleMusic: () => {
    const musicEnabled = !get().musicEnabled;
    set({ musicEnabled });
    AsyncStorage.setItem(KEY_MUSIC, musicEnabled ? '1' : '0').catch(() => {});
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
    const entries = await AsyncStorage.multiGet([
      KEY_BEST,
      KEY_SOUND,
      KEY_SFX,
      KEY_MUSIC,
      KEY_HAPTICS,
    ]);
    const read = (key: string) => entries.find(([k]) => k === key)?.[1] ?? null;
    const best = Number(read(KEY_BEST));
    // A pre-split install stored one 'lov:sound' — its value seeds both
    // toggles so a muted player stays fully muted after updating.
    const legacy = read(KEY_SOUND);
    const boolOf = (key: string) => {
      const v = read(key);
      if (v !== null) return v !== '0';
      return legacy !== '0';
    };
    useAppStore.setState({
      bestScore: Number.isFinite(best) && best > 0 ? best : 0,
      sfxEnabled: boolOf(KEY_SFX),
      musicEnabled: boolOf(KEY_MUSIC),
      hapticsEnabled: read(KEY_HAPTICS) !== '0',
    });
  } catch {
    // First launch or storage unavailable — defaults stand.
  }
}
