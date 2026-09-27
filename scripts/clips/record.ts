// `bun run clip` — bot-played gameplay clips, recorded from the iOS simulator.
//
//   bun run clip --skill bad              (fail montage)
//   bun run clip --skill decent --count 3 (a few tries that get somewhere)
//   bun run clip --skill pro              (quick, skip-chaining highlight)
//
// For each clip: build a take (recipes.ts) → start recording → hand the take
// to the app's clip mode → wait until it reports every attempt and its last
// held frame → rebuild the video into exactly one 60 fps frame per sim step
// (1080×1920) → sidecar JSON → mix in the game audio (audio.ts). A take that
// doesn't replay exactly is re-recorded with another seed.
//
// Exit codes: 0 all clips made · 1 some clips missing · 2 usage error ·
// 3 all clips made but some are silent (audio mix failed) · 130 interrupted.
// Design: plans/gameplay-recorder.md, plans/clip-styles.md.

import type { Subprocess } from 'bun';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import type { ReportedResult } from '../../src/clip/clipMode';
import { clipViewport } from '../../src/clip/replay';
import type { Take, TakeResult } from '../../src/clip/take';
import { parseArgs, USAGE, type ClipArgs } from './args';
import { addClipAudio } from './audio';
import { checkViewport, clipTimeline, codeOf, FPS, geometry, pickFrames, type Rect } from './frames';
import { describeTake } from './make-take';
import {
  AbortedError,
  deadline,
  exitOnSignals,
  hasExited,
  isAborting,
  killAll,
  ROOT,
  run,
  sleep,
  stopProcess,
  temp,
  track,
  untemp,
} from './procs';
import { buildClip, NO_CLIP_HINT } from './recipes';

const DEFAULT_DEVICE = 'iPhone 17 Pro';
const FIRST_METRO_PORT = 8090;
const APP_BOOT_TIMEOUT_S = 240;
const OUTPUT_SIZE = { width: 1080, height: 1920 };
/** Tries per requested clip (each with a new seed) before giving up on it. */
const TRIES_PER_CLIP = 3;
/** The sync-strip reader uses -fps_mode, which needs ffmpeg ≥ 5.1. */
const MIN_FFMPEG: [number, number] = [5, 1];

function log(message: string): void {
  console.log(`[clip] ${message}`);
}

/** A failure that ends the whole batch (as opposed to one take). */
class FatalError extends Error {}

// --- tools -----------------------------------------------------------------------------

async function checkTools(): Promise<void> {
  let version: string;
  try {
    version = await run(['ffmpeg', '-hide_banner', '-version']);
    await run(['ffprobe', '-hide_banner', '-version']);
  } catch {
    throw new FatalError('ffmpeg/ffprobe not found — install them with `brew install ffmpeg`.');
  }
  const m = /ffmpeg version n?(\d+)\.(\d+)/.exec(version);
  if (m !== null) {
    const [major, minor] = [Number(m[1]), Number(m[2])];
    if (major < MIN_FFMPEG[0] || (major === MIN_FFMPEG[0] && minor < MIN_FFMPEG[1])) {
      throw new FatalError(
        `ffmpeg ${major}.${minor} is too old (need ≥ ${MIN_FFMPEG.join('.')}) — \`brew upgrade ffmpeg\`.`,
      );
    }
  }
  const encoders = await run(['ffmpeg', '-hide_banner', '-encoders']);
  if (!/\blibx264\b/.test(encoders)) {
    throw new FatalError('This ffmpeg has no libx264 encoder — install Homebrew’s ffmpeg.');
  }
}

/**
 * Fingerprint of the app/game sources. The recorder's bot loads them when it
 * starts; the app gets them when Metro bundles, minutes later (after the
 * simulator boots). An edit saved in between would make the two disagree
 * for the whole batch, so the fingerprint is taken at both points.
 */
function sourceHash(): string {
  const hash = createHash('sha1');
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry)) hash.update(path).update(readFileSync(path));
    }
  };
  walk(join(ROOT, 'src'));
  hash.update(readFileSync(join(ROOT, 'App.tsx')));
  return hash.digest('hex');
}

// --- simulator -------------------------------------------------------------------------

interface SimDevice {
  udid: string;
  name: string;
  state: string;
}

async function pickDevice(wanted: string): Promise<SimDevice> {
  const json = JSON.parse(await run(['xcrun', 'simctl', 'list', 'devices', 'available', '-j']));
  const devices = (Object.values(json.devices) as SimDevice[][]).flat();
  const matches = devices.filter((d) => d.udid === wanted || d.name === wanted);
  const device = matches.find((d) => d.state === 'Booted') ?? matches[0];
  if (device === undefined) throw new FatalError(`No available simulator named "${wanted}".`);
  return device;
}

async function isBooted(udid: string): Promise<boolean> {
  return (await run(['xcrun', 'simctl', 'list', 'devices', udid])).includes('(Booted)');
}

async function bootDevice(device: SimDevice): Promise<void> {
  // Two known simulator failure modes after a long idle: the first boot is
  // rejected ("Invalid argument"), or the device comes up half-booted and
  // `bootstatus` never returns. Both clear with a retry / clean reboot.
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1) {
      log('  simulator stuck booting — restarting it…');
      await run(['xcrun', 'simctl', 'shutdown', device.udid], { allowFail: true });
    }
    if (attempt > 1 || device.state !== 'Booted') {
      if (attempt === 1) log(`booting ${device.name}…`);
      await run(['xcrun', 'simctl', 'boot', device.udid], { allowFail: true });
      if (!(await isBooted(device.udid))) {
        await sleep(2000);
        await run(['xcrun', 'simctl', 'boot', device.udid]);
      }
    }
    try {
      await run(['xcrun', 'simctl', 'bootstatus', device.udid], { timeoutMs: 120_000 });
      break;
    } catch (error) {
      if (error instanceof AbortedError || attempt >= 2) throw error;
    }
  }
  const apps = await run(['xcrun', 'simctl', 'listapps', device.udid]);
  if (!apps.includes('host.exp.Exponent')) {
    throw new FatalError(
      `Expo Go is not installed on ${device.name}. Run \`bun run ios\` once to install it, then retry.`,
    );
  }
}

// --- metro -----------------------------------------------------------------------------

/** Nothing listens on this port — on any loopback or wildcard address. */
async function portFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) });
    return false; // an HTTP server answered
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') return false; // something silent holds it
  }
  for (const hostname of ['127.0.0.1', '0.0.0.0', '::1', '::']) {
    try {
      Bun.listen({ hostname, port, socket: { data() {} } }).stop(true);
    } catch (error) {
      if ((error as { code?: string }).code === 'EADDRINUSE') return false;
      // (no IPv6 on this machine — fine)
    }
  }
  return true;
}

type MetroState = 'ready' | 'foreign' | 'exited' | 'timeout';

function samePath(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

async function waitForMetro(proc: Subprocess, port: number): Promise<MetroState> {
  const root = ROOT;
  for (let i = 0; i < 180; i++) {
    if (hasExited(proc)) return 'exited';
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1000),
      });
      if ((await res.text()).includes('packager-status:running')) {
        // Metro names the project it serves; make sure it's ours, not a
        // server another checkout started on the same port a moment ago.
        // (The header is URL-encoded — "Leap%20of%20Void".)
        const served = res.headers.get('X-React-Native-Project-Root');
        return served !== null && samePath(decodeURIComponent(served), root) ? 'ready' : 'foreign';
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return 'timeout';
}

/**
 * Always a fresh Metro of our own, on a free port: a Metro started elsewhere
 * may lack the clip env (the app would never enter clip mode) or serve
 * another checkout. CI=1 turns file watching off, so an edit saved mid-batch
 * can't hot-reload a different engine into the app.
 */
async function startMetro(controlPort: number, token: string, logFile: string) {
  for (let port = FIRST_METRO_PORT, tries = 0; tries < 20; port++, tries++) {
    if (!(await portFree(port))) continue;
    log(`starting Metro on :${port} (clip mode, no file watching; log: ${relative(ROOT, logFile)})…`);
    const fd = openSync(logFile, 'w'); // one descriptor for both streams
    const proc = track(
      Bun.spawn(['bunx', 'expo', 'start', '--go', '--port', String(port)], {
        cwd: ROOT,
        env: {
          ...process.env,
          CI: '1',
          EXPO_PUBLIC_CLIP_MODE: '1',
          EXPO_PUBLIC_CLIP_PORT: String(controlPort),
          EXPO_PUBLIC_CLIP_TOKEN: token,
          EXPO_NO_TELEMETRY: '1',
        },
        stdin: 'ignore',
        stdout: fd,
        stderr: fd,
      }),
    );
    closeSync(fd); // the child has its own copy
    const state = await waitForMetro(proc, port);
    if (state === 'ready') return { proc, port };
    await stopProcess(proc, 'SIGTERM', 3000);
    const lost = state === 'foreign' || readFileSync(logFile, 'utf8').includes('EADDRINUSE');
    if (!lost) break;
    log(`  :${port} was taken meanwhile — trying the next port`);
  }
  throw new FatalError(`Metro did not come up — see ${relative(ROOT, logFile)}.`);
}

// --- control server (the app's clip mode polls this) -----------------------------------

interface TakeOutcome {
  results: ReportedResult[];
  heldMs: number;
  handshakeTimeouts: number;
}

interface Control {
  port: number;
  /** Resolves with the app's window size on its first poll (this run's token only). */
  hello: Promise<{ width: number; height: number }>;
  /** Hand a take to the app; resolves once every attempt and the final hold are reported. */
  play(take: Take): Promise<TakeOutcome>;
  /** Give up on the current take and wait until the app asks for the next one. */
  settle(timeoutMs: number): Promise<boolean>;
  stop(): void;
}

function startControl(token: string): Control {
  let armed: { id: string; take: Take } | null = null;
  let current: {
    id: string;
    attempts: number;
    results: Map<number, ReportedResult>;
    done: { heldMs: number; handshakeTimeouts: number } | null;
    resolve(outcome: TakeOutcome): void;
  } | null = null;
  let onHello: (size: { width: number; height: number }) => void = () => {};
  let onIdle: () => void = () => {};
  const hello = new Promise<{ width: number; height: number }>((r) => (onHello = r));

  const finish = () => {
    if (current === null || current.done === null || current.results.size < current.attempts) {
      return;
    }
    const results = [...current.results.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
    current.resolve({ results, ...current.done });
    current = null;
  };

  /** Only the fields a report is supposed to carry (the body also has transport fields). */
  const resultFrom = (body: Record<string, unknown>): ReportedResult => ({
    attempt: Number(body.attempt),
    score: Number(body.score),
    planetsPassed: Number(body.planetsPassed),
    deathCause: (body.deathCause ?? null) as TakeResult['deathCause'],
    fingerprint: Array.isArray(body.fingerprint) ? body.fingerprint.map(Number) : [],
    heldMs: Number(body.heldMs),
    handshakeTimeouts: Number(body.handshakeTimeouts),
  });

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    // Reports come after long silences (a take replays for minutes); don't
    // let idle keep-alive connections close under them.
    idleTimeout: 255,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/take') {
        // A clip-mode app left over from an earlier run polls with an old token.
        if (url.searchParams.get('token') !== token) return new Response(null, { status: 204 });
        onHello({
          width: Number(url.searchParams.get('w')),
          height: Number(url.searchParams.get('h')),
        });
        onIdle(); // the app only polls when it has nothing to play
        if (armed === null) return new Response(null, { status: 204 });
        const served = armed;
        armed = null;
        return Response.json(served);
      }
      if (req.method === 'POST' && (url.pathname === '/result' || url.pathname === '/done')) {
        const body = (await req.json()) as Record<string, unknown>;
        // Always 200 so the app stops retrying; only this take's reports count.
        if (body.token === token && current !== null && body.id === current.id) {
          if (url.pathname === '/result') current.results.set(Number(body.attempt), resultFrom(body));
          else {
            current.done = {
              heldMs: Number(body.heldMs),
              handshakeTimeouts: Number(body.handshakeTimeouts),
            };
          }
          finish();
        }
        return new Response('ok');
      }
      return new Response('not found', { status: 404 });
    },
  });

  return {
    port: server.port!,
    hello,
    play(take) {
      return new Promise((resolve) => {
        const id = randomUUID();
        current = { id, attempts: take.attempts.length, results: new Map(), done: null, resolve };
        armed = { id, take };
      });
    },
    async settle(timeoutMs) {
      armed = null;
      current = null;
      const idle = new Promise<boolean>((r) => (onIdle = () => r(true)));
      const t = deadline(timeoutMs, 'idle wait');
      const ok = await Promise.race([idle, t.promise]).catch(() => false);
      t.clear();
      onIdle = () => {};
      return ok;
    },
    stop: () => server.stop(true),
  };
}

// --- recording -------------------------------------------------------------------------

async function startRecording(udid: string, file: string): Promise<Subprocess> {
  const proc = track(
    Bun.spawn(['xcrun', 'simctl', 'io', udid, 'recordVideo', '--codec', 'h264', '--force', file], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    }),
    { recorder: true },
  );
  // simctl announces "Recording started" on stderr once frames are flowing.
  const reader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  const timer = deadline(15_000, 'recordVideo never started');
  let seen = '';
  try {
    while (!seen.includes('Recording started')) {
      const { value, done } = await Promise.race([reader.read(), timer.promise]);
      if (done) throw new Error(`recordVideo exited early:\n${seen}`);
      seen += decoder.decode(value);
    }
  } catch (error) {
    await stopProcess(proc, 'SIGINT', 5000);
    throw error;
  } finally {
    timer.clear();
    reader.releaseLock();
  }
  return proc;
}

// --- post-processing -------------------------------------------------------------------
// The raw capture is variable-frame-rate, carries duplicate commits and
// freezes whenever the simulator hitches. Clip mode paints the step count
// (mod 1296) into a strip below the viewport, so the video is rebuilt as
// exactly one frame per step (see frames.ts).

const rectArg = (r: Rect) => `${r.w}:${r.h}:${r.x}:${r.y}`;

async function videoSize(file: string): Promise<{ width: number; height: number }> {
  const out = await run([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file,
  ]); // prettier-ignore
  const [width, height] = out.trim().split(',').map(Number);
  return { width, height };
}

async function countFrames(file: string): Promise<number> {
  const out = await run([
    'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file,
  ]); // prettier-ignore
  return Number(out.trim());
}

/** The strip-patch codes of every captured frame. */
async function readSyncCodes(raw: string, probes: Rect[]): Promise<number[][]> {
  const n = probes.length;
  const graph =
    `[0:v]split=${n}${probes.map((_, k) => `[s${k}]`).join('')};` +
    probes.map((p, k) => `[s${k}]crop=${rectArg(p)},scale=1:1:flags=area[p${k}]`).join(';') +
    `;${probes.map((_, k) => `[p${k}]`).join('')}hstack=inputs=${n}`;
  const proc = track(Bun.spawn(
    ['ffmpeg', '-v', 'error', '-i', raw, '-filter_complex', graph,
     '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )); // prettier-ignore
  const [buf, err, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg couldn't read the sync strip (${code}):\n${err}`);
  const px = new Uint8Array(buf);
  const codes: number[][] = [];
  for (let f = 0; f + 3 * n <= px.length; f += 3 * n) {
    codes.push(probes.map((_, k) => codeOf(px[f + 3 * k], px[f + 3 * k + 1], px[f + 3 * k + 2])));
  }
  return codes;
}

/**
 * Rebuild the clip as exactly one frame per step. The decoder crops and
 * scales the capture into a named pipe (in the temp dir — the output folder
 * may be a drive without FIFOs). The pipe is opened non-blocking and read a
 * frame at a time, so the decoder stalls whenever we're behind (Bun would
 * otherwise buffer its whole output — gigabytes) and a decoder that dies
 * early can't hang us. Each picked frame goes to the encoder once per step
 * it stands for. The capture is BT.709 limited range with the sRGB
 * transfer; the raw frames are declared as exactly that on the encoder's
 * *input*, so nothing gets colour-converted and the mp4 is tagged.
 */
async function rebuild(raw: string, out: string, crop: Rect, picks: number[]): Promise<number> {
  const { width, height } = OUTPUT_SIZE;
  const frameBytes = (width * height * 3) / 2;
  const lastFrame = picks[picks.length - 1];
  const uses = new Map<number, number>();
  for (const f of picks) uses.set(f, (uses.get(f) ?? 0) + 1);

  const dir = temp(mkdtempSync(join(tmpdir(), 'clip-rebuild-')));
  const fifo = join(dir, 'frames.yuv');
  try {
    await run(['mkfifo', fifo]);
    const decoder = track(
      Bun.spawn(
        ['ffmpeg', '-v', 'error', '-y', '-i', raw,
         '-vf', `crop=${rectArg(crop)},scale=${width}:${height}:flags=lanczos`,
         '-fps_mode', 'passthrough', '-frames:v', String(lastFrame + 1),
         '-f', 'rawvideo', '-pix_fmt', 'yuv420p', fifo],
        { cwd: ROOT, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' },
      ),
    ); // prettier-ignore
    const encoder = track(
      Bun.spawn(
        ['ffmpeg', '-v', 'error', '-y',
         '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${width}x${height}`, '-r', String(FPS),
         '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709',
         '-color_trc', 'iec61966-2-1', '-i', '-', '-an',
         '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
         '-movflags', '+faststart', out],
        { cwd: ROOT, stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
      ),
    ); // prettier-ignore
    const decoderErr = new Response(decoder.stderr).text();
    const encoderErr = new Response(encoder.stderr).text();

    const fd = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const frame = Buffer.alloc(frameBytes);
    /** Fill `frame`; false at end of stream. Yields while the pipe is empty. */
    const readFrame = async (): Promise<boolean> => {
      let filled = 0;
      while (filled < frameBytes) {
        let n = -1;
        try {
          n = readSync(fd, frame, filled, frameBytes - filled, null);
        } catch (error) {
          if ((error as { code?: string }).code !== 'EAGAIN') throw error;
        }
        if (n > 0) {
          filled += n;
          continue;
        }
        // 0 = no writer (not opened yet, or finished); -1 = no data yet.
        if (n === 0 && hasExited(decoder)) return false;
        if (isAborting()) throw new AbortedError();
        if (hasExited(encoder)) return false;
        await new Promise((r) => setImmediate(r));
      }
      return true;
    };

    let index = 0;
    let encoderFailed = false;
    try {
      while (index <= lastFrame && (await readFrame())) {
        for (let r = uses.get(index) ?? 0; r > 0; r--) {
          if (hasExited(encoder)) {
            encoderFailed = true;
            break;
          }
          try {
            encoder.stdin.write(frame);
            await encoder.stdin.flush(); // backpressure, and `frame` is free again
          } catch {
            encoderFailed = true;
            break;
          }
        }
        if (encoderFailed) break;
        index += 1;
      }
    } finally {
      closeSync(fd);
      if (index <= lastFrame) decoder.kill();
    }
    try {
      await encoder.stdin.end();
    } catch {
      encoderFailed = true;
    }
    const [decoderCode, encoderCode] = await Promise.all([decoder.exited, encoder.exited]);
    if (encoderFailed || encoderCode !== 0) {
      throw new Error(`encoder failed (${encoderCode}):\n${await encoderErr}`);
    }
    if (index <= lastFrame) {
      throw new Error(`decoder stopped at frame ${index} of ${lastFrame + 1} (${decoderCode}):\n${await decoderErr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
    untemp(dir);
  }
  const frames = await countFrames(out);
  if (frames !== picks.length) throw new Error(`rebuild wrote ${frames} frames, expected ${picks.length}`);
  return frames;
}

// --- one take --------------------------------------------------------------------------

/** A name no earlier output (finished, failed or kept raw) uses. */
function freeName(dir: string, base: string): string {
  const taken = (name: string) =>
    ['.mp4', '.raw.mp4', '.json', '.partial.mp4'].some((ext) => existsSync(join(dir, `${name}${ext}`)));
  let name = base;
  for (let n = 2; taken(name); n++) name = `${base}-${n}`;
  return name;
}

/** 'silent': the clip exists but its audio mix failed. */
type TakeStatus = 'ok' | 'silent' | 'retry';

function sameResult(a: TakeResult, b: TakeResult): boolean {
  return (
    a.score === b.score &&
    a.planetsPassed === b.planetsPassed &&
    a.deathCause === b.deathCause &&
    a.fingerprint.length === b.fingerprint.length &&
    a.fingerprint.every((v, k) => v === b.fingerprint[k])
  );
}

async function recordTake(
  take: Take,
  device: SimDevice,
  window: { width: number; height: number },
  control: Control,
  args: ClipArgs,
  outDir: string,
): Promise<TakeStatus> {
  const last = take.attempts[take.attempts.length - 1];
  const shape =
    take.attempts.length > 1 ? `${take.attempts.length}tries` : `${last.expected.planetsPassed}p`;
  const date = new Date().toISOString().slice(0, 10);
  const name = freeName(outDir, `${date}_${take.meta.profile}_${shape}_s${take.meta.seed >>> 0}`);
  const raw = join(outDir, `${name}.raw.mp4`);
  const partial = join(outDir, `${name}.partial.mp4`);
  const mp4 = join(outDir, `${name}.mp4`);
  const sidecar = join(outDir, `${name}.json`);
  const kept = `Raw kept at ${relative(ROOT, raw)}`;

  const recorder = await startRecording(device.udid, raw);
  // Replay runs at ≤ 30 steps/s on a 60 Hz display plus commit holds — allow plenty.
  const takeMs = (((take.endStep + take.holdSteps) / 30) * 2 + 60) * 1000;
  const timer = deadline(takeMs, 'the app never reported the end of the take');
  let outcome: TakeOutcome;
  try {
    outcome = await Promise.race([control.play(take), timer.promise]);
  } catch (error) {
    await stopProcess(recorder, 'SIGINT', 10_000);
    log(`✗ ${(error as Error).message}. ${kept}`);
    // The app may still be replaying it: wait until it's free, or the next
    // take's deadline would be eaten by this one.
    if (!(await control.settle(takeMs))) throw new FatalError('The app stopped responding.');
    return 'retry';
  } finally {
    timer.clear();
  }
  await sleep(600); // let the last held frame land in the capture
  await stopProcess(recorder, 'SIGINT', 30_000);

  log(`  replayed; sim paused ${(outcome.heldMs / 1000).toFixed(1)}s for commits (not in the clip)`);
  const diverged = take.attempts.findIndex((a, k) => {
    const r = outcome.results[k];
    return r === undefined || !sameResult(r, a.expected);
  });
  if (diverged >= 0) {
    log(`✗ attempt ${diverged + 1} didn't replay exactly — expected ${JSON.stringify(take.attempts[diverged].expected)}, ` +
        `app reported ${JSON.stringify(outcome.results[diverged])}. ${kept}`); // prettier-ignore
    return 'retry';
  }
  if (outcome.handshakeTimeouts > 0) {
    log(`✗ ${outcome.handshakeTimeouts} commit wait(s) timed out, so some frames show stale UI. ${kept}`);
    return 'retry';
  }

  const size = clipViewport(window.width, window.height);
  const video = await videoSize(raw); // a bad capture fails this take only
  let crop: Rect;
  let probes: Rect[];
  try {
    ({ crop, probes } = geometry(window, size, video));
  } catch (error) {
    throw new FatalError(`${(error as Error).message} ${kept}`); // the device: every take
  }
  const wanted = take.endStep + take.holdSteps + 1;
  const { picks, missing, glitches } = pickFrames(await readSyncCodes(raw, probes), wanted);
  if (picks.length < wanted) {
    log(`✗ recording ends ${wanted - picks.length} steps early (${glitches} unreadable strip ` +
        `frames). ${kept}`); // prettier-ignore
    return 'retry';
  }

  temp(partial);
  const frames = await rebuild(raw, partial, crop, picks);
  if (missing > 0) log(`  (${missing} of ${frames} steps never captured — filled with neighbours)`);
  writeFileSync(
    sidecar,
    JSON.stringify(
      {
        video: `${name}.mp4`,
        fps: FPS,
        seconds: frames / FPS,
        missingSteps: missing,
        heldMs: outcome.heldMs,
        results: outcome.results,
        // Seconds into the mp4 at which each event becomes visible (frame k
        // of the mp4 is the state after k steps). Steps are clip steps.
        // Negative t: began just before a highlight opens (may still show/sound).
        timeline: clipTimeline(take),
        take,
      },
      null,
      2,
    ),
  );
  renameSync(partial, mp4);
  untemp(partial);

  let status: TakeStatus = 'ok';
  if (!args.silent) {
    try {
      const mix = await addClipAudio(sidecar);
      const note = mix.inSpec ? '' : ' ⚠ outside −14 ±0.5 LUFS / −1.5 dBTP';
      log(`  game audio: ${mix.cues} sounds + ambient, ${mix.loudness}${note}`);
    } catch (error) {
      if (error instanceof AbortedError) throw error;
      log(`✗ audio mix failed — the mp4 is silent. Retry just the audio with ` +
          `\`bun run clip:audio ${relative(ROOT, sidecar)}\`:\n${(error as Error).message}`); // prettier-ignore
      status = 'silent';
    }
  }
  if (!args.keepRaw) rmSync(raw, { force: true });
  log(`✓ ${relative(ROOT, mp4)}`);
  return status;
}

// --- main ------------------------------------------------------------------------------

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(`bun run clip [flags]\n${USAGE}`);
    return 0;
  }
  let args: ClipArgs;
  try {
    args = parseArgs(argv, 'clip');
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  exitOnSignals(log);
  const sources = sourceHash();
  await checkTools();
  const outDir = resolve(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });

  const device = await pickDevice(args.device ?? DEFAULT_DEVICE);
  await bootDevice(device);
  const token = randomUUID();
  const control = startControl(token);
  const metroLog = join(outDir, '.metro.log');

  try {
    const metro = await startMetro(control.port, token, metroLog);
    log('opening the app in Expo Go…');
    // A fresh launch guarantees the bundle comes from this Metro (clip mode on).
    await run(['xcrun', 'simctl', 'terminate', device.udid, 'host.exp.Exponent'], {
      allowFail: true,
    });
    await run(['xcrun', 'simctl', 'openurl', device.udid, `exp://127.0.0.1:${metro.port}`]);
    const boot = deadline(
      APP_BOOT_TIMEOUT_S * 1000,
      `The app never reached clip mode — check ${relative(ROOT, metroLog)} for bundle errors.`,
    );
    const window = await Promise.race([control.hello, boot.promise]).finally(boot.clear);
    log(`app is in clip mode (${window.width}×${window.height} pt window)`);
    if (sourceHash() !== sources) {
      throw new FatalError(
        'Source files changed while the recorder was starting, so the app and the bot may run ' +
          'different code — run it again.',
      );
    }
    const size = clipViewport(window.width, window.height);
    try {
      checkViewport(window, size);
    } catch (error) {
      throw new FatalError((error as Error).message);
    }

    let made = 0;
    let silent = 0;
    let failed = 0;
    for (let i = 0; i < args.count; i++) {
      let status: TakeStatus = 'retry';
      for (let attempt = 0; attempt < TRIES_PER_CLIP && status === 'retry'; attempt++) {
        if (isAborting()) throw new AbortedError();
        const seed = args.request.seed + i + attempt * 7919;
        const take = buildClip({ ...args.request, ...size, seed });
        if (take === null) {
          log(`✗ ${NO_CLIP_HINT} (seed ${seed})`);
          continue;
        }
        log(`take ${i + 1}/${args.count}${attempt > 0 ? ` (try ${attempt + 1})` : ''} — ${describeTake(take)}`);
        try {
          status = await recordTake(take, device, window, control, args, outDir);
        } catch (error) {
          if (error instanceof FatalError || error instanceof AbortedError || isAborting()) {
            throw error;
          }
          log(`✗ ${(error as Error).message}`);
          log(`  (its raw capture, if it got that far, is kept as ${relative(ROOT, outDir)}/*.raw.mp4)`);
          status = 'retry';
        }
      }
      if (status === 'ok') made += 1;
      else if (status === 'silent') silent += 1;
      else failed += 1;
    }
    const parts = [`${made + silent} of ${args.count} clip(s) made`];
    if (silent > 0) parts.push(`${silent} without audio`);
    if (failed > 0) parts.push(`${failed} failed`);
    log(`done: ${parts.join(', ')}`);
    return failed > 0 ? 1 : silent > 0 ? 3 : 0;
  } finally {
    control.stop();
    await killAll();
  }
}

main()
  .then((code) => {
    if (!isAborting()) process.exit(code);
  })
  .catch(async (error) => {
    // A signal already owns the exit (130); its side effects aren't errors.
    if (isAborting()) return;
    console.error(`[clip] ${error instanceof Error ? error.message : error}`);
    await killAll();
    process.exit(1);
  });
