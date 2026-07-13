// SFX playback via expo-audio. Rapid-fire sounds play through small voice
// pools (round-robin across pre-created players) so a retrigger never cuts the
// previous instance's tail, and pooled sounds cycle round-robin timbre
// variants for free. Called from the JS thread (runOnJS from UI-thread
// reactions).

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { CaptureKind } from '../game/types';
import { useAppStore } from '../state/appStore';

/**
 * Heat → pitch as minor-pentatonic steps (semitones above the base sample).
 * Chains play a melody; the old linear 2-semitones-per-level walked a
 * whole-tone scale that never resolved.
 */
const HEAT_SEMITONES = [0, 3, 5, 7, 10, 12, 15, 17, 19];

function heatRate(heat: number, maxIndex: number): number {
  const idx = Math.max(0, Math.min(heat, maxIndex, HEAT_SEMITONES.length - 1));
  return Math.pow(2, HEAT_SEMITONES[idx] / 12);
}

/** ±4% random rate — anti-fatigue for sounds whose pitch carries no meaning. */
function jitterRate(): number {
  return 1 + (Math.random() * 2 - 1) * 0.04;
}

class VoicePool {
  private readonly players: AudioPlayer[];
  private next = 0;

  /** Sources are cycled in order, so variants round-robin naturally. */
  constructor(sources: number[], voicesPerSource: number) {
    this.players = [];
    for (let v = 0; v < voicesPerSource; v++) {
      for (const source of sources) this.players.push(createAudioPlayer(source));
    }
  }

  trigger(rate = 1, volume = 1): void {
    if (!useAppStore.getState().sfxEnabled) return;
    const player = this.players[this.next];
    this.next = (this.next + 1) % this.players.length;
    player.setPlaybackRate(rate);
    player.volume = volume;
    player.seekTo(0);
    player.play();
  }
}

const releasePool = new VoicePool([require('../../assets/sfx/release.wav')], 2);
const capturePool = new VoicePool(
  [
    require('../../assets/sfx/capture_1.wav'),
    require('../../assets/sfx/capture_2.wav'),
    require('../../assets/sfx/capture_3.wav'),
  ],
  2,
);
const grazePool = new VoicePool(
  [
    require('../../assets/sfx/graze_1.wav'),
    require('../../assets/sfx/graze_2.wav'),
    require('../../assets/sfx/graze_3.wav'),
  ],
  2,
);
const flybyPool = new VoicePool(
  [
    require('../../assets/sfx/flyby_1.wav'),
    require('../../assets/sfx/flyby_2.wav'),
    require('../../assets/sfx/flyby_3.wav'),
  ],
  2,
);
// One-shot-at-a-time events keep single voices (they can't meaningfully overlap).
const perfectPool = new VoicePool([require('../../assets/sfx/perfect.wav')], 1);
const deathPool = new VoicePool([require('../../assets/sfx/death.wav')], 1);
const zonePool = new VoicePool([require('../../assets/sfx/zone.wav')], 1);

export async function initAudio(): Promise<void> {
  await setAudioModeAsync({
    // Games play sound even with the silent switch on.
    playsInSilentMode: true,
    // Short SFX must not pause the player's own music.
    interruptionMode: 'mixWithOthers',
  });
}

export function sfxRelease(): void {
  releasePool.trigger(jitterRate());
}

/** Capture pluck climbs a pentatonic scale with heat. */
export function sfxCapture(kind: CaptureKind, heat: number): void {
  capturePool.trigger(heatRate(heat, 8));
  if (kind === 1) grazePool.trigger(jitterRate());
  else if (kind === 2) perfectPool.trigger();
}

/**
 * Flyby: a fire rush per planet skipped. Escalates by intensity, not pitch —
 * each successive skip in a chain burns louder and slightly fiercer.
 */
export function sfxFlyby(heat: number): void {
  const h = Math.min(heat, 4);
  flybyPool.trigger((1 + 0.05 * h) * jitterRate(), 0.55 + 0.1125 * h);
}

export function sfxDeath(): void {
  deathPool.trigger();
}

export function sfxZone(): void {
  zonePool.trigger();
}
