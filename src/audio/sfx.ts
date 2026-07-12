// SFX playback via expo-audio. One preloaded player per sound; retrigger by
// seeking to 0. Called from the JS thread (runOnJS from UI-thread reactions).

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { CaptureKind } from '../game/types';
import { useAppStore } from '../state/appStore';

/* eslint-disable @typescript-eslint/no-require-imports */
const players = {
  release: createAudioPlayer(require('../../assets/sfx/release.wav')),
  capture: createAudioPlayer(require('../../assets/sfx/capture.wav')),
  graze: createAudioPlayer(require('../../assets/sfx/graze.wav')),
  perfect: createAudioPlayer(require('../../assets/sfx/perfect.wav')),
  death: createAudioPlayer(require('../../assets/sfx/death.wav')),
  zone: createAudioPlayer(require('../../assets/sfx/zone.wav')),
} as const;

export async function initAudio(): Promise<void> {
  // Games play sound even with the silent switch on.
  await setAudioModeAsync({ playsInSilentMode: true });
}

function replay(player: AudioPlayer): void {
  if (!useAppStore.getState().soundEnabled) return;
  player.seekTo(0);
  player.play();
}

export function sfxRelease(): void {
  replay(players.release);
}

/** Capture pluck pitch rises with the combo (2 semitones per link). */
export function sfxCapture(kind: CaptureKind, comboLinks: number): void {
  const semitones = Math.min(comboLinks, 8) * 2;
  players.capture.setPlaybackRate(Math.pow(2, semitones / 12));
  replay(players.capture);
  if (kind === 1) replay(players.graze);
  else if (kind === 2) replay(players.perfect);
}

export function sfxDeath(): void {
  replay(players.death);
}

export function sfxZone(): void {
  replay(players.zone);
}
