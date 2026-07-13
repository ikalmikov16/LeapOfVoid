// Ambient bed: a quiet lofi chord pad looping under home + game screens.
// The WAV is generated seamless (scripts/generate-sfx.ts), so it just loops.
// This is the "music" side of the audio split. Unlike one-shot SFX, a loop
// must react to its toggle immediately — checking at trigger time isn't
// enough — so it subscribes to musicEnabled.

import { createAudioPlayer } from 'expo-audio';
import { useAppStore } from '../state/appStore';

/** The pad sits far under the SFX — felt more than heard. */
const AMBIENT_VOLUME = 0.3;

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const player = createAudioPlayer(require('../../assets/sfx/ambient.wav'));
player.loop = true;
player.volume = AMBIENT_VOLUME;

let started = false;

/** Start the bed (idempotent). Call once at app mount, after the store hydrates. */
export function startAmbient(): void {
  if (started) return;
  started = true;
  if (useAppStore.getState().musicEnabled) player.play();
  useAppStore.subscribe((state, prev) => {
    if (state.musicEnabled === prev.musicEnabled) return;
    if (state.musicEnabled) player.play();
    else player.pause();
  });
}
