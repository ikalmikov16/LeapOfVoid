// Synthesizes the game's SFX as small mono WAVs into assets/sfx/.
// Run with: bun run sfx
// Tweak the recipes below and regenerate — these are code, not sourced assets.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_RATE = 22050;
const OUT_DIR = join(import.meta.dir, '..', 'assets', 'sfx');

function writeWav(name: string, samples: Float32Array): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(join(OUT_DIR, name), buf);
  console.log(`wrote ${name} (${(buf.length / 1024).toFixed(1)} KB)`);
}

interface ToneOpts {
  duration: number;
  freqFrom: number;
  freqTo?: number;
  shape?: 'sine' | 'triangle';
  /** Exponential decay rate; higher dies faster. */
  decay?: number;
  /** Linear attack time to avoid clicks. */
  attack?: number;
  volume?: number;
}

function tone({
  duration,
  freqFrom,
  freqTo = freqFrom,
  shape = 'sine',
  decay = 12,
  attack = 0.004,
  volume = 0.5,
}: ToneOpts): Float32Array {
  const n = Math.floor(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const f = freqFrom + (freqTo - freqFrom) * (t / duration);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    const raw =
      shape === 'sine' ? Math.sin(phase) : (2 / Math.PI) * Math.asin(Math.sin(phase));
    const env = Math.min(t / attack, 1) * Math.exp(-decay * t);
    out[i] = raw * env * volume;
  }
  return out;
}

function noise(duration: number, decay: number, volume: number): Float32Array {
  const n = Math.floor(duration * SAMPLE_RATE);
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    // Lightly low-passed white noise so it reads "spark", not "static".
    last = last * 0.6 + (Math.random() * 2 - 1) * 0.4;
    out[i] = last * Math.min(t / 0.002, 1) * Math.exp(-decay * t) * volume;
  }
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

function delayed(track: Float32Array, seconds: number): Float32Array {
  const offset = Math.floor(seconds * SAMPLE_RATE);
  const out = new Float32Array(offset + track.length);
  out.set(track, offset);
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });

// Release: short downward blip — "letting go".
writeWav('release.wav', tone({ duration: 0.09, freqFrom: 520, freqTo: 330, decay: 26, volume: 0.35 }));

// Capture: warm pluck; pitch rises with combo at runtime via playbackRate.
writeWav('capture.wav', tone({ duration: 0.22, freqFrom: 440, shape: 'triangle', decay: 14, volume: 0.5 }));

// Graze: tight spark.
writeWav('graze.wav', mix(
  noise(0.09, 40, 0.4),
  tone({ duration: 0.08, freqFrom: 2200, freqTo: 1600, decay: 45, volume: 0.15 }),
));

// Perfect: two-note chime.
writeWav('perfect.wav', mix(
  tone({ duration: 0.3, freqFrom: 660, decay: 10, volume: 0.35 }),
  delayed(tone({ duration: 0.32, freqFrom: 990, decay: 9, volume: 0.3 }), 0.07),
));

// Death: low boom + impact noise.
writeWav('death.wav', mix(
  tone({ duration: 0.5, freqFrom: 150, freqTo: 38, decay: 7, volume: 0.7 }),
  noise(0.12, 28, 0.5),
));

// Zone: soft rising swell.
writeWav('zone.wav', tone({ duration: 0.6, freqFrom: 220, freqTo: 440, decay: 4.5, attack: 0.12, volume: 0.3 }));
