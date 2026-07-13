// Burn bed: a looping fire/wind texture that plays while the heat multiplier
// is active (heat >= 1 — exactly when the comet ball stops being white).
// Volume and playback rate step up with each heat level.
//
// expo-audio's `loop` is not gapless on iOS in SDK 54, and a constant texture
// can't hide a restart gap in a musical rest like the ambient pad does. So
// the WAV is windowed by a half-sine envelope and TWO looping players run it
// offset by half the loop: sin² + cos² = 1 keeps summed power constant, and
// each player's restart gap lands exactly where its own envelope is silent
// while the other is at full level.

import { createAudioPlayer } from 'expo-audio';
import { useAppStore } from '../state/appStore';

/**
 * PARKED: the burn texture isn't right yet (too whooshy/aggressive so far).
 * The plumbing stays — GameScreen drives setBurnHeat on every heat change —
 * so perfecting it later is a matter of reworking burnRecipe() in
 * scripts/generate-sfx.ts and flipping this flag.
 */
const BURN_ENABLED = false;

/** Must match BURN_S in scripts/generate-sfx.ts. */
const BURN_LOOP_S = 6;
/** Volume per heat level 0..HEAT_MAX; 0 = off (white ball). */
const BURN_VOLUMES = [0, 0.15, 0.23, 0.32, 0.42];
/** The flame also spins slightly faster (brighter, fiercer) per level. */
const BURN_RATES = [1, 1, 1.04, 1.08, 1.12];
/** Exponential ease time constants — igniting is quicker than dying down. */
const RAMP_UP_TAU_MS = 250;
const RAMP_DOWN_TAU_MS = 500;
const RAMP_STEP_MS = 20;

const source = require('../../assets/sfx/burn.wav') as number;
const players = [createAudioPlayer(source), createAudioPlayer(source)];
for (const p of players) {
  p.loop = true;
  p.volume = 0;
}

let active = false;
let currentVol = 0;
let rampTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Eased volume glide (exponential approach — fast at first, soft landing).
 * Heat drops (camping decay) have no masking one-shot, so fading out slowly
 * matters most; abrupt linear steps read as a glitch.
 */
function rampTo(target: number): void {
  if (rampTimer !== null) clearInterval(rampTimer);
  if (currentVol === target) return;
  const tau = target > currentVol ? RAMP_UP_TAU_MS : RAMP_DOWN_TAU_MS;
  const alpha = 1 - Math.exp(-RAMP_STEP_MS / tau);
  rampTimer = setInterval(() => {
    currentVol += (target - currentVol) * alpha;
    if (Math.abs(target - currentVol) < 0.004) currentVol = target;
    for (const p of players) p.volume = currentVol;
    if (currentVol === target) {
      if (rampTimer !== null) clearInterval(rampTimer);
      rampTimer = null;
      if (target === 0) {
        for (const p of players) p.pause();
        active = false;
      }
    }
  }, RAMP_STEP_MS);
}

/** Drive from the heat value; call on every heat change (and with 0 on death). */
export function setBurnHeat(heat: number): void {
  if (!BURN_ENABLED) return;
  const level = Math.max(0, Math.min(heat, BURN_VOLUMES.length - 1));
  const target = useAppStore.getState().sfxEnabled ? BURN_VOLUMES[level] : 0;
  if (target > 0) {
    for (const p of players) p.setPlaybackRate(BURN_RATES[level]);
    if (!active) {
      active = true;
      players[0].seekTo(0);
      players[1].seekTo(BURN_LOOP_S / 2); // half-loop offset from the start
      for (const p of players) p.play();
    }
  }
  rampTo(target);
}
