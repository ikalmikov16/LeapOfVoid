// Clip audio (phase 2): rebuilds the game's sound for a recorded clip from
// its sidecar timeline — every release / capture / flyby / zone / death at
// the frame it becomes visible, using the game's own samples and rules
// (src/audio/sfxParams.ts), over the looping ambient pad — then brings it to
// −14 LUFS with a static gain (so the pad never pumps) and a peak limiter,
// and muxes it into the mp4.
//
//   bun run clip:audio clips/gameplay/<clip>.json …   (re)mix existing clips
//
// The recorder calls addClipAudio() itself unless --silent.
// Design: plans/gameplay-recorder.md §3.7.

import { renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  AMBIENT_VOLUME,
  CAPTURE_HEAT_STEPS,
  flybyRate,
  flybyVolume,
  heatRate,
  jitterRate,
} from '../../src/audio/sfxParams';
import { BotRng } from './bot';
import { exitOnSignals, temp, track, untemp } from './procs';

const ROOT = resolve(import.meta.dir, '../..');
const SFX_DIR = join(ROOT, 'assets/sfx');
const SAMPLE_RATE = 48000;
/** Where Reels / TikTok / Shorts normalise to. */
const TARGET_LUFS = -14;
/** True-peak ceiling of the delivered AAC track. */
const CEILING_DBTP = -1.5;
/** The limiter's sample-peak ceiling before encoding — AAC overshoots, so leave headroom. */
const LIMIT_DBFS = -3.5;
const LUFS_TOLERANCE = 0.5;
/** Aim a touch above target: the limiter only ever takes loudness away. */
const AIM_LUFS = TARGET_LUFS + 0.1;
const LEVEL_PASSES = 6;

// Round-robin timbre variants, in the order src/audio/sfx.ts cycles them.
const CAPTURE_VARIANTS = ['capture_1', 'capture_2', 'capture_3'];
const GRAZE_VARIANTS = ['graze_1', 'graze_2', 'graze_3'];
const FLYBY_VARIANTS = ['flyby_1', 'flyby_2', 'flyby_3'];

/** One sample playing once. */
export interface SoundCue {
  /** Seconds into the clip. */
  t: number;
  /** Sample name in assets/sfx (no extension). */
  sample: string;
  /** Playback rate. */
  rate: number;
  volume: number;
}

/**
 * The sidecar timeline entries this mixer reads (see frames.ts clipTimeline).
 * A composed clip's timeline (compose/endCard.ts) adds the end card's beats
 * and its `sound` entries, which play exactly as written.
 */
type TimelineEntry =
  | { t: number; type: 'release' | 'zone' | 'death' | 'attemptStart' | 'attemptEnd' | 'endCard' }
  | { t: number; type: 'capture'; kind: number; heat: number }
  | { t: number; type: 'flyby'; heat: number }
  | { t: number; type: 'sound'; sample: string; rate: number; volume: number };

/**
 * The game's sound for each timeline event: the samples, variant order, rates
 * and volumes src/audio/sfx.ts uses. Differences, all inaudible: jitter is
 * seeded (so a re-mix is identical), and every cue plays to its end — the
 * game's single-voice pools (perfect/death/zone) cut a repeat's -55 dB tail.
 */
export function soundCues(timeline: TimelineEntry[], seed: number): SoundCue[] {
  // Jitter is random in the game; here it's seeded so a re-mix is identical.
  const rng = new BotRng(seed ^ 0x5f0d);
  const round = { capture: 0, graze: 0, flyby: 0 };
  const cycle = (variants: string[], key: keyof typeof round) =>
    variants[round[key]++ % variants.length];
  const cues: SoundCue[] = [];
  for (const e of timeline) {
    switch (e.type) {
      case 'release':
        cues.push({ t: e.t, sample: 'release', rate: jitterRate(rng.next()), volume: 1 });
        break;
      case 'capture':
        cues.push({
          t: e.t,
          sample: cycle(CAPTURE_VARIANTS, 'capture'),
          rate: heatRate(e.heat, CAPTURE_HEAT_STEPS),
          volume: 1,
        });
        if (e.kind === 1) {
          cues.push({
            t: e.t,
            sample: cycle(GRAZE_VARIANTS, 'graze'),
            rate: jitterRate(rng.next()),
            volume: 1,
          });
        } else if (e.kind === 2) {
          cues.push({ t: e.t, sample: 'perfect', rate: 1, volume: 1 });
        }
        break;
      case 'flyby':
        cues.push({
          t: e.t,
          sample: cycle(FLYBY_VARIANTS, 'flyby'),
          rate: flybyRate(e.heat, jitterRate(rng.next())),
          volume: flybyVolume(e.heat),
        });
        break;
      case 'zone':
        cues.push({ t: e.t, sample: 'zone', rate: 1, volume: 1 });
        break;
      case 'death':
        cues.push({ t: e.t, sample: 'death', rate: 1, volume: 1 });
        break;
      case 'sound':
        cues.push({ t: e.t, sample: e.sample, rate: e.rate, volume: e.volume });
        break;
    }
  }
  return cues;
}

async function ffmpeg(args: string[]): Promise<string> {
  const proc = track(
    Bun.spawn(['ffmpeg', '-hide_banner', '-nostats', ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    }),
  );
  const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`ffmpeg failed (${code}):\n${err.slice(-2000)}`);
  return err;
}

/**
 * Decode a sample to mono float32 at SAMPLE_RATE, optionally at a playback
 * rate the way the phone plays it: varispeed, pitch and speed together.
 * Relabelling the sample rate (asetrate) does exactly that, and the second
 * resample brings it back to SAMPLE_RATE. Nothing is padded or trimmed, so a
 * loop (the ambient pad, whose loop ends in a rest) keeps its exact length.
 */
async function decode(file: string, rate = 1): Promise<Float32Array> {
  const varispeed =
    Math.abs(rate - 1) > 1e-6
      ? `,asetrate=${Math.round(SAMPLE_RATE * rate)},aresample=${SAMPLE_RATE}`
      : '';
  const proc = track(Bun.spawn(
    ['ffmpeg', '-v', 'error', '-i', file, '-af', `aresample=${SAMPLE_RATE}${varispeed}`,
     '-ac', '1', '-f', 'f32le', '-'],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )); // prettier-ignore
  const [buf, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg could not decode ${file}:\n${err}`);
  return new Float32Array(buf);
}

/** Stereo 32-bit float WAV (both channels identical — the game's samples are mono). */
function writeWav(path: string, mono: Float32Array): Promise<number> {
  const bytes = mono.length * 2 * 4;
  const out = new DataView(new ArrayBuffer(44 + bytes));
  const tag = (at: number, s: string) => [...s].forEach((c, k) => out.setUint8(at + k, c.charCodeAt(0)));
  tag(0, 'RIFF');
  out.setUint32(4, 36 + bytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 3, true); // IEEE float
  out.setUint16(22, 2, true);
  out.setUint32(24, SAMPLE_RATE, true);
  out.setUint32(28, SAMPLE_RATE * 2 * 4, true);
  out.setUint16(32, 2 * 4, true);
  out.setUint16(34, 32, true);
  tag(36, 'data');
  out.setUint32(40, bytes, true);
  for (let i = 0; i < mono.length; i++) {
    out.setFloat32(44 + i * 8, mono[i], true);
    out.setFloat32(48 + i * 8, mono[i], true);
  }
  return Bun.write(path, new Uint8Array(out.buffer));
}

/**
 * Render the cues over the looping ambient pad into a 48 kHz stereo WAV,
 * exactly `seconds` long. A cue with t < 0 started before the clip opened
 * (a highlight's first frames) and joins mid-sound.
 *
 * A rate is varispeed (see decode), as on the phone, where the voice pools
 * turn off expo-audio's pitch correction (src/audio/sfx.ts). The summing is
 * done here rather than in an ffmpeg amix graph: with dozens of per-cue
 * filter branches that graph ended the mix early.
 */
async function renderMix(cues: SoundCue[], seconds: number, out: string): Promise<void> {
  const length = Math.round(seconds * SAMPLE_RATE);
  const mix = new Float32Array(length);

  const ambient = await decode(join(SFX_DIR, 'ambient.wav'));
  for (let i = 0; i < length; i++) mix[i] = ambient[i % ambient.length] * AMBIENT_VOLUME;

  const rendered = new Map<string, Promise<Float32Array>>();
  const render = (c: SoundCue) => {
    const key = `${c.sample}@${c.rate.toFixed(6)}`;
    if (!rendered.has(key)) rendered.set(key, decode(join(SFX_DIR, `${c.sample}.wav`), c.rate));
    return rendered.get(key)!;
  };
  const voices = await Promise.all(cues.map(render));
  cues.forEach((c, k) => {
    const voice = voices[k];
    const start = Math.round(c.t * SAMPLE_RATE);
    const end = Math.min(length, start + voice.length);
    for (let i = Math.max(0, start); i < end; i++) mix[i] += voice[i - start] * c.volume;
  });
  await writeWav(out, mix);
}

interface Loudness {
  lufs: number;
  truePeak: number;
}

/** Integrated loudness and true peak of a file's audio (ffmpeg ebur128). */
async function measure(file: string): Promise<Loudness> {
  const log = await ffmpeg(['-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const lufs = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(summary)?.[1];
  const peak = /Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1];
  if (lufs === undefined || peak === undefined) throw new Error(`Couldn't measure ${file}`);
  return { lufs: Number(lufs), truePeak: Number(peak) };
}

/**
 * Static gain to TARGET_LUFS plus a look-ahead peak limiter (latency-
 * compensated, so cues stay frame-accurate). A two-pass loudnorm can't do
 * this: on a sparse SFX-over-pad mix its "linear" mode always falls back to
 * dynamic, and the pad swells and ducks.
 */
async function level(input: string, out: string, gainDb: number, limitDb: number): Promise<void> {
  const limit = Math.pow(10, limitDb / 20).toFixed(5);
  await ffmpeg([
    '-y',
    '-i',
    input,
    '-af',
    `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${limit}:level=false:attack=2:release=60:latency=true`,
    '-c:a',
    'pcm_f32le',
    out,
  ]);
}

interface Sidecar {
  video: string;
  seconds: number;
  timeline: TimelineEntry[];
  take: { meta: { seed: number } };
}

export interface ClipAudio {
  cues: number;
  /** e.g. "-14.1 LUFS, peak -1.8 dBTP" (measured on the encoded track). */
  loudness: string;
  /** Within ±LUFS_TOLERANCE of −14 LUFS and under the true-peak ceiling. */
  inSpec: boolean;
}

/**
 * Mix the clip's game audio and mux it into its mp4 (replacing any audio
 * track). The measured loudness is also written into the sidecar (`audio`).
 */
export async function addClipAudio(sidecarPath: string): Promise<ClipAudio> {
  const sidecar = (await Bun.file(sidecarPath).json()) as Sidecar & Record<string, unknown>;
  const video = join(dirname(sidecarPath), sidecar.video);
  const cues = soundCues(sidecar.timeline, sidecar.take.meta.seed);
  const base = video.replace(/\.mp4$/, '');
  const raw = temp(`${base}.mix.wav`);
  const levelled = temp(`${base}.level.wav`);
  const muxed = temp(`${base}.muxing.mp4`);
  try {
    await renderMix(cues, sidecar.seconds, raw);
    let gain = AIM_LUFS - (await measure(raw)).lufs;
    let limit = LIMIT_DBFS;
    let best: Loudness | null = null;
    let inSpec = false;
    // Measure the encoded track, not the PCM: the limiter takes some
    // loudness back and AAC overshoots it by up to ~2 dB. The limit only
    // ever tightens (so the two corrections can't undo each other), and
    // the gain follows the measured shortfall.
    for (let pass = 0; pass < LEVEL_PASSES && !inSpec; pass++) {
      await level(raw, levelled, gain, limit);
      await ffmpeg([
        '-y', '-i', video, '-i', levelled, '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SAMPLE_RATE),
        '-movflags', '+faststart', muxed,
      ]); // prettier-ignore
      const result = await measure(muxed);
      const loudOk = Math.abs(result.lufs - TARGET_LUFS) <= LUFS_TOLERANCE;
      const peakOk = result.truePeak <= CEILING_DBTP;
      inSpec = loudOk && peakOk;
      const miss = (r: Loudness) =>
        Math.max(0, Math.abs(r.lufs - TARGET_LUFS) - LUFS_TOLERANCE) +
        Math.max(0, r.truePeak - CEILING_DBTP);
      if (best === null || inSpec || miss(result) < miss(best)) {
        best = result;
        renameSync(muxed, `${base}.best.mp4`);
        temp(`${base}.best.mp4`);
      }
      if (!loudOk) gain += AIM_LUFS - result.lufs;
      if (!peakOk) limit -= result.truePeak - CEILING_DBTP + 0.3;
    }
    renameSync(`${base}.best.mp4`, video);
    untemp(`${base}.best.mp4`);
    const loudness = `${best!.lufs.toFixed(1)} LUFS, peak ${best!.truePeak.toFixed(1)} dBTP`;
    sidecar.audio = { lufs: best!.lufs, truePeak: best!.truePeak, inSpec };
    await Bun.write(sidecarPath, JSON.stringify(sidecar, null, 2));
    return { cues: cues.length, loudness, inSpec };
  } finally {
    for (const file of [raw, levelled, muxed, `${base}.best.mp4`]) {
      rmSync(file, { force: true });
      untemp(file);
    }
  }
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length === 0 || files.includes('--help')) {
    console.log('bun run clip:audio <clip.json> [...]  — (re)mix game audio into recorded clips');
    process.exit(files.length === 0 ? 1 : 0);
  }
  exitOnSignals((message) => console.log(`[clip:audio] ${message}`));
  for (const file of files) {
    const { cues, loudness, inSpec } = await addClipAudio(resolve(file));
    const mark = inSpec ? '✓' : '⚠ out of spec:';
    console.log(`[clip:audio] ${mark} ${file} (${cues} sounds, ${loudness})`);
  }
}
