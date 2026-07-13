// Synthesizes the game's SFX + ambient loop as small mono WAVs into assets/sfx/.
// Run with: bun run sfx
//
// This is a tiny offline synth engine: every sound is a layered recipe
// (transient + tonal body + air), built from additive partials, detuned
// oscillator pairs, pitch envelopes, biquad-filtered noise, tanh saturation
// and a small Schroeder reverb. Fully deterministic (seeded RNG) so
// regeneration is reproducible. Tweak the recipes at the bottom and re-run.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SR = 44100;
/** The ambient pad is deliberately band-limited (lofi warmth); half rate = half bytes. */
const AMBIENT_SR = 22050;
const OUT_DIR = join(import.meta.dir, '..', 'assets', 'sfx');

// ---------------------------------------------------------------------------
// WAV writer + per-file level stats (peak/RMS help balance the mix by numbers)
// ---------------------------------------------------------------------------

function writeWav(name: string, samples: Float32Array, sampleRate = SR): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    peak = Math.max(peak, Math.abs(v));
    sumSq += v * v;
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(join(OUT_DIR, name), buf);
  const db = (x: number) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
  console.log(
    `wrote ${name.padEnd(14)} ${(buf.length / 1024).toFixed(0).padStart(4)} KB  ` +
      `${(n / sampleRate).toFixed(2)}s  peak ${db(peak)} dB  rms ${db(Math.sqrt(sumSq / n))} dB`,
  );
}

// ---------------------------------------------------------------------------
// Deterministic RNG
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Oscillators
// ---------------------------------------------------------------------------

interface OscOpts {
  duration: number;
  freq: number;
  /** Linear glide target over the full duration. */
  freqTo?: number;
  /** Attack pitch multiplier, glides exponentially to 1 (physical pluck feel). */
  swoop?: number;
  /** Seconds for the swoop to settle. */
  swoopTime?: number;
  detuneCents?: number;
  shape?: 'sine' | 'triangle' | 'saw';
  /** Starting phase, 0..1. */
  phase?: number;
  sampleRate?: number;
}

function osc({
  duration,
  freq,
  freqTo = freq,
  swoop = 1,
  swoopTime = 0.01,
  detuneCents = 0,
  shape = 'sine',
  phase = 0,
  sampleRate = SR,
}: OscOpts): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);
  const detune = Math.pow(2, detuneCents / 1200);
  let ph = phase * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const glide = freq + (freqTo - freq) * (t / duration);
    const swooped = glide * (1 + (swoop - 1) * Math.exp(-t / swoopTime));
    ph += (2 * Math.PI * swooped * detune) / sampleRate;
    out[i] =
      shape === 'sine'
        ? Math.sin(ph)
        : shape === 'triangle'
          ? (2 / Math.PI) * Math.asin(Math.sin(ph))
          : ((ph / Math.PI) % 2) - 1; // naive saw — always low-passed downstream
  }
  return out;
}

/** Two slightly detuned copies — width and slow movement, the cheap "expensive" trick. */
function detunedPair(opts: OscOpts, cents: number): Float32Array {
  return mix(
    gain(osc({ ...opts, detuneCents: cents, phase: opts.phase ?? 0 }), 0.5),
    gain(osc({ ...opts, detuneCents: -cents, phase: ((opts.phase ?? 0) + 0.37) % 1 }), 0.5),
  );
}

interface Partial {
  ratio: number;
  gain: number;
  /** Exponential decay rate (1/s); higher dies faster. */
  decay: number;
}

/** Additive stack with per-partial decay — tonal bodies with real timbre. */
function partialStack(
  duration: number,
  baseFreq: number,
  partials: Partial[],
  opts: Omit<OscOpts, 'duration' | 'freq'> = {},
): Float32Array {
  const tracks = partials.map((p) =>
    expDecay(gain(osc({ ...opts, duration, freq: baseFreq * p.ratio }), p.gain), p.decay),
  );
  return mix(...tracks);
}

function whiteNoise(duration: number, rng: () => number, sampleRate = SR): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Sparse random impulses — fire crackle / vinyl dust (soften with a lowpass). */
function crackleNoise(
  duration: number,
  density: number,
  rng: () => number,
  sampleRate = SR,
): Float32Array {
  const n = Math.floor(duration * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (rng() < density) out[i] = (rng() * 2 - 1) * (0.4 + 0.6 * rng());
  }
  return out;
}

// ---------------------------------------------------------------------------
// Envelopes and gain staging
// ---------------------------------------------------------------------------

function gain(track: Float32Array, g: number): Float32Array {
  const out = new Float32Array(track.length);
  for (let i = 0; i < track.length; i++) out[i] = track[i] * g;
  return out;
}

function expDecay(track: Float32Array, rate: number, sampleRate = SR): Float32Array {
  const out = new Float32Array(track.length);
  for (let i = 0; i < track.length; i++) out[i] = track[i] * Math.exp((-rate * i) / sampleRate);
  return out;
}

function attackRamp(track: Float32Array, seconds: number, sampleRate = SR): Float32Array {
  const out = Float32Array.from(track);
  const n = Math.min(Math.floor(seconds * sampleRate), out.length);
  for (let i = 0; i < n; i++) out[i] *= i / n;
  return out;
}

function fadeOut(track: Float32Array, seconds: number, sampleRate = SR): Float32Array {
  const out = Float32Array.from(track);
  const n = Math.min(Math.floor(seconds * sampleRate), out.length);
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

function mix(...tracks: Float32Array[]): Float32Array {
  const n = Math.max(...tracks.map((t) => t.length));
  const out = new Float32Array(n);
  for (const t of tracks) {
    for (let i = 0; i < t.length; i++) out[i] += t[i];
  }
  return out;
}

function delayed(track: Float32Array, seconds: number, sampleRate = SR): Float32Array {
  const offset = Math.floor(seconds * sampleRate);
  const out = new Float32Array(offset + track.length);
  out.set(track, offset);
  return out;
}

/** tanh drive — harmonic warmth on bodies, softens transient spikes. */
function saturate(track: Float32Array, drive: number): Float32Array {
  const norm = Math.tanh(drive);
  const out = new Float32Array(track.length);
  for (let i = 0; i < track.length; i++) out[i] = Math.tanh(track[i] * drive) / norm;
  return out;
}

/**
 * Final stage for every sound: scale to an exact peak (per-sound mix level),
 * with short edge fades so no buffer ever starts/ends off zero (clicks).
 */
function finalize(track: Float32Array, targetPeak: number, sampleRate = SR): Float32Array {
  let peak = 0;
  for (let i = 0; i < track.length; i++) peak = Math.max(peak, Math.abs(track[i]));
  const out = gain(track, peak > 0 ? targetPeak / peak : 0);
  return fadeOut(attackRamp(out, 0.002, sampleRate), 0.008, sampleRate);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type BiquadType = 'lowpass' | 'highpass' | 'bandpass';

function biquadCoeffs(type: BiquadType, f0: number, q: number, sampleRate: number) {
  const w0 = (2 * Math.PI * Math.min(f0, sampleRate * 0.45)) / sampleRate;
  const cosw0 = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
  } else if (type === 'highpass') {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
  };
}

function biquad(
  track: Float32Array,
  type: BiquadType,
  f0: number,
  q: number,
  sampleRate = SR,
): Float32Array {
  const c = biquadCoeffs(type, f0, q, sampleRate);
  const out = new Float32Array(track.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < track.length; i++) {
    const x = track[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Band-pass with the center frequency gliding — the whoosh workhorse. */
function sweptBandpass(
  track: Float32Array,
  f0From: number,
  f0To: number,
  q: number,
  sampleRate = SR,
): Float32Array {
  const out = new Float32Array(track.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < track.length; i++) {
    // Recomputing coefficients per sample is fine offline.
    const c = biquadCoeffs(
      'bandpass',
      f0From + ((f0To - f0From) * i) / track.length,
      q,
      sampleRate,
    );
    const x = track[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** One-pole low-pass with a per-sample cutoff function (filter-opening swells). */
function sweptLowpass(
  track: Float32Array,
  cutoffAt: (t: number) => number,
  sampleRate = SR,
): Float32Array {
  const out = new Float32Array(track.length);
  let y = 0;
  for (let i = 0; i < track.length; i++) {
    const k = 1 - Math.exp((-2 * Math.PI * cutoffAt(i / sampleRate)) / sampleRate);
    y += k * (track[i] - y);
    out[i] = y;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reverb — small Schroeder: 4 damped combs + 2 allpasses. This is "the void".
// ---------------------------------------------------------------------------

interface ReverbOpts {
  /** Wet mix 0..1. */
  wet: number;
  /** T60 decay time in seconds. */
  decay: number;
  /** 0..1 high-frequency damping in the comb feedback (dark space = high). */
  damp: number;
  /** Extra buffer seconds so the tail can ring out. */
  tail: number;
}

function reverb(
  track: Float32Array,
  { wet, decay, damp, tail }: ReverbOpts,
  sampleRate = SR,
): Float32Array {
  const n = track.length + Math.floor(tail * sampleRate);
  const combDelaysMs = [29.7, 37.1, 41.1, 43.7];
  const combs = combDelaysMs.map((ms) => {
    const len = Math.max(1, Math.floor((ms / 1000) * sampleRate));
    return {
      buf: new Float32Array(len),
      idx: 0,
      // Feedback gain for a T60 of `decay` seconds at this delay length.
      g: Math.pow(10, (-3 * (ms / 1000)) / decay),
      lp: 0,
    };
  });
  let wetSig = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i < track.length ? track[i] : 0;
    let acc = 0;
    for (const c of combs) {
      const y = c.buf[c.idx];
      c.lp = c.lp * damp + y * (1 - damp);
      c.buf[c.idx] = x + c.lp * c.g;
      c.idx = (c.idx + 1) % c.buf.length;
      acc += y;
    }
    wetSig[i] = acc / combs.length;
  }
  for (const ms of [5.0, 1.7]) {
    const len = Math.max(1, Math.floor((ms / 1000) * sampleRate));
    const buf = new Float32Array(len);
    let idx = 0;
    const g = 0.5;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const delayedS = buf[idx];
      const y = -g * wetSig[i] + delayedS;
      buf[idx] = wetSig[i] + g * y;
      idx = (idx + 1) % len;
      out[i] = y;
    }
    wetSig = out;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (i < track.length ? track[i] : 0) * (1 - wet) + wetSig[i] * wet;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recipes. Every sound = transient + body + air, finalized to a mix peak.
// Peaks are the mix levels: death loudest, ticks quietest.
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

// --- release: soft "thip" — letting go should feel airy, not eventful -------
function releaseRecipe(): Float32Array {
  const rng = mulberry32(101);
  const transient = expDecay(biquad(whiteNoise(0.02, rng), 'bandpass', 3000, 1.5), 90);
  const body = expDecay(
    osc({ duration: 0.1, freq: 480, freqTo: 300, swoop: 1.2, swoopTime: 0.006 }),
    26,
  );
  return finalize(mix(gain(transient, 0.5), gain(body, 1)), 0.32);
}
writeWav('release.wav', releaseRecipe());

// --- capture: warm pluck (heat pitches it up a pentatonic scale at runtime) --
function captureRecipe(variant: number): Float32Array {
  const rng = mulberry32(200 + variant);
  const phase = rng();
  const body = saturate(
    mix(
      gain(
        detunedPair(
          { duration: 0.4, freq: 440, swoop: 1.4, swoopTime: 0.009, shape: 'triangle', phase },
          6 + variant,
        ),
        1,
      ),
      // Upper partials with faster decay — pluck brightness that dies into warmth.
      gain(
        partialStack(
          0.4,
          440,
          [
            { ratio: 2, gain: 0.4, decay: 22 },
            { ratio: 3, gain: 0.2, decay: 30 },
            { ratio: 4, gain: 0.09, decay: 40 },
          ],
          { phase },
        ),
        1,
      ),
    ),
    1.6,
  );
  const pick = expDecay(biquad(whiteNoise(0.015, rng), 'highpass', 2500, 0.8), 130);
  return finalize(mix(gain(expDecay(body, 11), 1), gain(pick, 0.35)), 0.55);
}
for (let v = 1; v <= 3; v++) writeWav(`capture_${v}.wav`, captureRecipe(v));

// --- graze: spark — risky proximity, metallic and electric ------------------
function grazeRecipe(variant: number): Float32Array {
  const rng = mulberry32(300 + variant);
  const center = [3300, 3650, 3950][variant - 1];
  const spark = expDecay(biquad(whiteNoise(0.1, rng), 'bandpass', center, 1.2), 38);
  const ring = partialStack(
    0.14,
    2731,
    [
      { ratio: 1, gain: 0.5, decay: 42 },
      { ratio: 1.53, gain: 0.3, decay: 55 }, // inharmonic — metal, not music
    ],
    { phase: rng() },
  );
  const shimmer = expDecay(biquad(whiteNoise(0.16, rng), 'highpass', 7000, 0.7), 26);
  return finalize(mix(gain(spark, 1), gain(ring, 0.55), gain(shimmer, 0.22)), 0.4);
}
for (let v = 1; v <= 3; v++) writeWav(`graze_${v}.wav`, grazeRecipe(v));

// --- perfect: bell bloom — two staggered bells echoing into the void --------
function perfectRecipe(): Float32Array {
  const rng = mulberry32(400);
  const bell = (freq: number) =>
    mix(
      gain(detunedPair({ duration: 0.55, freq, swoop: 1.05, swoopTime: 0.004 }, 4), 1),
      // Inharmonic bell partials (ratios from struck-bar spectra).
      gain(
        partialStack(
          0.55,
          freq,
          [
            { ratio: 2.76, gain: 0.35, decay: 14 },
            { ratio: 5.4, gain: 0.12, decay: 24 },
          ],
          { phase: rng() },
        ),
        1,
      ),
    );
  const dry = mix(
    gain(expDecay(bell(659.25), 8), 1), // E5
    delayed(gain(expDecay(bell(987.77), 9), 0.8), 0.07), // B5
  );
  return finalize(reverb(dry, { wet: 0.3, decay: 1.1, damp: 0.45, tail: 0.55 }), 0.5);
}
writeWav('perfect.wav', perfectRecipe());

// --- flyby: fire rush — a burning comet tearing past. All noise, no tone
// (tonal parts read as slide whistle). Wide-Q downward sweep = doppler air,
// ember crackle on top, low whoomph underneath. Runtime escalation is
// intensity (volume + slight rate), not pitch.
function flybyRecipe(variant: number): Float32Array {
  const rng = mulberry32(500 + variant);
  const sweepFrom = [1500, 1650, 1800][variant - 1];
  const rush = attackRamp(
    expDecay(sweptBandpass(whiteNoise(0.2, rng), sweepFrom, 650, 0.75), 17),
    0.025,
  );
  const embers = expDecay(biquad(crackleNoise(0.18, 0.0015, rng), 'lowpass', 3200, 0.7), 14);
  const body = expDecay(biquad(whiteNoise(0.16, rng), 'lowpass', 500, 0.8), 20);
  return finalize(mix(gain(rush, 1), gain(embers, 0.6), gain(body, 0.8)), 0.36);
}
for (let v = 1; v <= 3; v++) writeWav(`flyby_${v}.wav`, flybyRecipe(v));

// --- death: two-stage boom — sub drop + impact debris, long dark tail -------
function deathRecipe(): Float32Array {
  const rng = mulberry32(600);
  const sub = saturate(
    expDecay(osc({ duration: 0.7, freq: 130, freqTo: 36, swoop: 1.6, swoopTime: 0.02 }), 6),
    2.2,
  );
  const crack = expDecay(biquad(whiteNoise(0.05, rng), 'bandpass', 700, 0.9), 60);
  const debris = expDecay(biquad(whiteNoise(0.28, rng), 'lowpass', 1200, 0.7), 16);
  const dry = mix(gain(sub, 1), gain(crack, 0.8), gain(debris, 0.65));
  return finalize(reverb(dry, { wet: 0.4, decay: 1.5, damp: 0.65, tail: 0.9 }), 0.85);
}
writeWav('death.wav', deathRecipe());

// --- zone: pad swell — a chord blooming through an opening filter -----------
function zoneRecipe(): Float32Array {
  const pad = mix(
    gain(detunedPair({ duration: 1.0, freq: 220, shape: 'saw' }, 7), 0.6),
    gain(detunedPair({ duration: 1.0, freq: 330, shape: 'saw', phase: 0.21 }, 5), 0.35),
    gain(detunedPair({ duration: 1.0, freq: 440, shape: 'triangle', phase: 0.54 }, 5), 0.3),
  );
  const swelled = fadeOut(
    attackRamp(
      sweptLowpass(pad, (t) => 350 + 2200 * Math.min(t / 0.7, 1)),
      0.3,
    ),
    0.35,
  );
  return finalize(reverb(swelled, { wet: 0.35, decay: 1.3, damp: 0.5, tail: 0.7 }), 0.42);
}
writeWav('zone.wav', zoneRecipe());

// ---------------------------------------------------------------------------
// Ambient bed — warm lofi chord pad, 32 s seamless loop at 22 050 Hz.
//
// Lofi-without-the-drums: a mellow I–vi–IV–V progression in A major played by
// a soft electric-piano pad (detuned sine pairs + gentle per-note tremolo),
// a quiet sub bass following the roots, and vinyl-style dust crackle. No
// rhythm — a beat on a 32 s loop turns grating and fights the game's pacing.
//
// Loop point: expo-audio's `loop` is NOT gapless on iOS in SDK 54 (expo issue
// #42880; fixed only in a later SDK), so a sample-continuous seam still plays
// with an audible hiccup. Instead the loop is authored to *end in a breath*:
// the last chord (the V) resolves to near-silence ~0.5 s before the loop
// point, and the restart is the I chord swelling from silence — the player's
// restart gap lands inside an intentional musical rest.
// ---------------------------------------------------------------------------

const LOOP_S = 32;
const CHORD_S = 8;
const CHORD_FADE_S = 2;

function raisedCosineFades(
  track: Float32Array,
  fadeIn: number,
  fadeOut: number,
  sampleRate: number,
): Float32Array {
  const out = Float32Array.from(track);
  const nIn = Math.floor(fadeIn * sampleRate);
  const nOut = Math.floor(fadeOut * sampleRate);
  for (let i = 0; i < nIn && i < out.length; i++) {
    out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nIn);
  }
  for (let i = 0; i < nOut && i < out.length; i++) {
    out[out.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nOut);
  }
  return out;
}

/** Soft EP-ish pad chord: detuned pairs + a whisper of 2nd partial + tremolo. */
function epChord(freqs: number[], duration: number, rng: () => number): Float32Array {
  const n = Math.floor(duration * AMBIENT_SR);
  const notes = freqs.map((freq) => {
    const tone = mix(
      gain(detunedPair({ duration, freq, phase: rng(), sampleRate: AMBIENT_SR }, 5), 1),
      gain(osc({ duration, freq: freq * 2, phase: rng(), sampleRate: AMBIENT_SR }), 0.13),
    );
    const tremHz = 3.6 + rng() * 1.4;
    const tremPhase = rng() * 2 * Math.PI;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / AMBIENT_SR;
      out[i] = tone[i] * (0.86 + 0.14 * Math.sin(2 * Math.PI * tremHz * t + tremPhase));
    }
    return out;
  });
  return gain(mix(...notes), 1 / freqs.length);
}

function ambientRecipe(): Float32Array {
  const rng = mulberry32(700);
  const loopN = LOOP_S * AMBIENT_SR;
  // A major, close warm voicings: Amaj9 → F#m7 → Dmaj9 → E9sus.
  const chords: number[][] = [
    [110.0, 138.59, 164.81, 207.65, 246.94], // A2 C#3 E3 G#3 B3
    [92.5, 164.81, 220.0, 277.18], // F#2 E3 A3 C#4
    [146.83, 185.0, 220.0, 277.18, 329.63], // D3 F#3 A3 C#4 E4
    [164.81, 220.0, 246.94, 293.66], // E3 A3 B3 D4
  ];
  const roots = [55.0, 46.25, 73.42, 82.41]; // A1 F#1 D2 E2

  const layers: Float32Array[] = [];
  for (let k = 0; k < chords.length; k++) {
    // Interior chords ring 2 s into the next chord's attack; the final chord
    // instead resolves to silence 0.5 s before the loop point (the breath
    // that hides the player's restart gap).
    const isLast = k === chords.length - 1;
    const chordDur = isLast ? LOOP_S - k * CHORD_S - 0.5 : CHORD_S + CHORD_FADE_S;
    const pad = raisedCosineFades(
      epChord(chords[k], chordDur, rng),
      CHORD_FADE_S,
      CHORD_FADE_S,
      AMBIENT_SR,
    );
    const sub = raisedCosineFades(
      osc({ duration: chordDur, freq: roots[k], phase: rng(), sampleRate: AMBIENT_SR }),
      CHORD_FADE_S,
      CHORD_FADE_S,
      AMBIENT_SR,
    );
    layers.push(delayed(mix(gain(pad, 1), gain(sub, 0.3)), k * CHORD_S, AMBIENT_SR));
  }

  // Vinyl dust: sparse softened ticks, silenced through the end-of-loop
  // breath so a stray tick can never poke out of the rest.
  const dust = biquad(
    crackleNoise(LOOP_S, 0.0004, rng, AMBIENT_SR),
    'lowpass',
    3000,
    0.7,
    AMBIENT_SR,
  );
  for (let i = Math.floor(loopN - 1.0 * AMBIENT_SR); i < loopN; i++) dust[i] = 0;

  // Tape-ish air, breathing twice per loop, zero at the seam (sin² envelope).
  const hissRaw = biquad(whiteNoise(LOOP_S, rng, AMBIENT_SR), 'lowpass', 1800, 0.7, AMBIENT_SR);
  const hiss = new Float32Array(loopN);
  for (let i = 0; i < loopN; i++) {
    const e = Math.sin((Math.PI * 2 * (i / AMBIENT_SR)) / LOOP_S);
    hiss[i] = hissRaw[i] * e * e;
  }

  // dust/hiss span the full loop, so the mix is exactly loop-length; the
  // chords end 0.5 s earlier, leaving the rest before the downbeat.
  const bed = mix(mix(...layers), gain(dust, 0.1), gain(hiss, 0.045));
  let peak = 0;
  for (let i = 0; i < loopN; i++) peak = Math.max(peak, Math.abs(bed[i]));
  return gain(bed, 0.55 / peak);
}
writeWav('ambient.wav', ambientRecipe(), AMBIENT_SR);

// ---------------------------------------------------------------------------
// Burn bed — loops while the heat multiplier is active (the comet-glow ball).
//
// A constant texture can't hide the non-gapless loop in a musical rest like
// the ambient does, so it uses equal-power dual-player looping instead
// (src/audio/burn.ts): the whole file is windowed by a half-sine envelope
// e(t) = sin(πt/BURN_S), and two looping players play it offset by half the
// loop. sin² + cos² = 1 keeps the summed power constant, and each player's
// restart gap falls exactly where its own envelope is zero while the other
// is at full level. Runtime volume/rate scale with heat; the file is one
// fixed intensity.
// ---------------------------------------------------------------------------

const BURN_S = 6;

function burnRecipe(): Float32Array {
  const rng = mulberry32(800);
  const n = BURN_S * AMBIENT_SR;
  // Slow random flicker curve: heavily lowpassed noise, normalized. The
  // shallow 0.6..1 range keeps the flame breathing without gusting.
  const flickRaw = sweptLowpass(whiteNoise(BURN_S, rng, AMBIENT_SR), () => 3, AMBIENT_SR);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, flickRaw[i]);
    hi = Math.max(hi, flickRaw[i]);
  }
  const flick = (i: number) => 0.6 + 0.4 * ((flickRaw[i] - lo) / (hi - lo));

  // Soft wind-fire: warm rumble + wide airy band, embers barely sprinkled.
  const rumble = biquad(whiteNoise(BURN_S, rng, AMBIENT_SR), 'lowpass', 400, 0.7, AMBIENT_SR);
  const wind = biquad(whiteNoise(BURN_S, rng, AMBIENT_SR), 'bandpass', 950, 0.55, AMBIENT_SR);
  const embers = biquad(
    crackleNoise(BURN_S, 0.0006, rng, AMBIENT_SR),
    'lowpass',
    2200,
    0.7,
    AMBIENT_SR,
  );

  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = flick(i);
    const window = Math.sin((Math.PI * i) / n); // equal-power dual-player envelope
    out[i] =
      (rumble[i] * 0.55 * (0.8 + 0.2 * f) + // steady body, lightly wavering
        wind[i] * 0.4 * f + // airy rush carries most of the flicker
        embers[i] * 0.3 * (0.5 + 0.5 * f)) *
      window;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  return gain(out, 0.7 / peak);
}
writeWav('burn.wav', burnRecipe(), AMBIENT_SR);
