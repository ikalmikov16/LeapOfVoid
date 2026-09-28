// `bun run clip:compose` — recorded gameplay clips → finished clips that end
// on the end card (warp → the icon's planet → the ship lands in its orbit →
// LEAP OF VOID → YOUR TURN. → "Download from the App Store").
//
//   bun run clip:compose                          every gameplay clip not composed yet
//   bun run clip:compose clips/gameplay/<x>.json  just these (re-composed if they exist)
//
// One Remotion bundle for the whole run, then for each clip: stage an exact
// RGB copy of its gameplay in the bundle's public dir → render the whole clip
// (PNG frames, H.264 crf 16, BT.709, muted) → check the frame count →
// composed sidecar → game audio (audio.ts; the card's sounds are `sound`
// entries in the timeline).
//
// Exit codes: 0 all composed · 1 some failed · 2 usage error ·
// 3 all composed but some are silent (audio mix failed) · 130 interrupted.
// Design: plans/clip-composer.md.

import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { addClipAudio } from '../audio';
import { GAMEPLAY_DIR, parseComposeArgs, USAGE, type ComposeArgs } from './args';
import {
  AbortedError,
  exitOnSignals,
  isAborting,
  killAll,
  onAbort,
  ROOT,
  run,
  temp,
  untemp,
} from '../procs';
import {
  BEATS,
  COMPOSITION_ID,
  composedTimeline,
  endCardSpec,
  WARP_S,
  type EndCardSpec,
  type SourceSidecar,
} from './endCard';

const ENTRY = join(ROOT, 'scripts/clips/compose/index.ts');

function log(message: string): void {
  console.log(`[compose] ${message}`);
}

/** Every gameplay sidecar, minus those already composed (unless --force). */
function pendingClips(outDir: string, force: boolean): string[] {
  const dir = join(ROOT, GAMEPLAY_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
    .filter((f) => force || !existsSync(join(outDir, f.replace(/\.json$/, '.mp4'))))
    .sort()
    .map((f) => join(dir, f));
}

/**
 * Put the clip where the composition's staticFile() finds it: its sidecar,
 * pointing at a lossless RGB copy of the gameplay decoded with accurate
 * BT.709 rounding. Remotion's own frame extraction reads the H.264 ~2/255
 * dark (like ffmpeg's default yuv→rgb); an RGB video leaves it nothing to
 * convert, so the composed gameplay matches the recording exactly. Returns
 * the staged files (the copy is ~15 MB per second of clip), to delete after.
 */
async function stage(clip: Clip, publicDir: string): Promise<string[]> {
  const rgb = temp(join(publicDir, `${clip.name}.rgb.mkv`));
  const json = temp(join(publicDir, `${clip.name}.json`));
  await run(['ffmpeg', '-v', 'error', '-y', '-i', join(dirname(clip.path), clip.sidecar.video), '-an',
    '-vf', 'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int,format=rgb24',
    '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', rgb]); // prettier-ignore
  writeFileSync(json, JSON.stringify({ ...clip.sidecar, video: basename(rgb) }));
  return [rgb, json];
}

interface Clip {
  path: string;
  name: string;
  sidecar: SourceSidecar & Record<string, unknown>;
}

async function frameCount(file: string): Promise<number> {
  const out = await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets',
    '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]); // prettier-ignore
  return Number(out.trim());
}

type Status = 'ok' | 'silent';

async function composeClip(clip: Clip, serveUrl: string, args: ComposeArgs, outDir: string) {
  const spec = endCardSpec(clip.sidecar, args.holdS);
  const w = spec.warpStartFrame / spec.fps;
  const warpEnd = spec.warpStartFrame + Math.round(WARP_S * spec.fps);
  const tail =
    warpEnd <= spec.videoFrames
      ? `${spec.videoFrames - warpEnd} gameplay frames after it dropped`
      : `last gameplay frame held for ${warpEnd - spec.videoFrames} frames`;
  log(`${clip.name}: warp at ${w.toFixed(2)}s (${tail}), ${spec.zoneName.toLowerCase()} palette, ` +
      `accent ${spec.accent} → ${(spec.totalFrames / spec.fps).toFixed(2)}s`); // prettier-ignore

  const staged = await stage(clip, join(serveUrl, 'public'));
  try {
    return await renderClip(clip, spec, serveUrl, args, outDir);
  } finally {
    for (const file of staged) {
      rmSync(file, { force: true });
      untemp(file);
    }
  }
}

async function renderClip(
  clip: Clip,
  spec: EndCardSpec,
  serveUrl: string,
  args: ComposeArgs,
  outDir: string,
): Promise<Status> {
  const w = spec.warpStartFrame / spec.fps;
  const inputProps = { clip: clip.name, holdS: args.holdS };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
  if (composition.durationInFrames !== spec.totalFrames) {
    throw new Error(`the composition is ${composition.durationInFrames} frames, ` +
      `the model says ${spec.totalFrames}`); // prettier-ignore
  }
  const mp4 = join(outDir, `${clip.name}.mp4`);
  const partial = temp(join(outDir, `${clip.name}.partial.mp4`));
  const sidecarPath = join(outDir, `${clip.name}.json`);
  const { cancelSignal, cancel } = makeCancelSignal();
  const unhook = onAbort(cancel);
  const started = Date.now();
  let lastTenth = -1;
  try {
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      codec: 'h264',
      outputLocation: partial,
      overwrite: true,
      imageFormat: 'png',
      colorSpace: 'bt709',
      pixelFormat: 'yuv420p',
      crf: 16,
      muted: true,
      cancelSignal,
      onProgress: ({ progress }) => {
        const tenth = Math.floor(progress * 10);
        if (tenth > lastTenth && tenth < 10 && tenth % 2 === 0 && tenth > 0) {
          lastTenth = tenth;
          log(`  ${tenth * 10}%`);
        }
      },
    });
  } catch (error) {
    if (isAborting()) throw new AbortedError();
    throw error;
  } finally {
    unhook();
  }
  const frames = await frameCount(partial);
  if (frames !== spec.totalFrames) {
    throw new Error(`the render has ${frames} frames, expected ${spec.totalFrames}`);
  }
  log(`  rendered ${frames} frames in ${((Date.now() - started) / 1000).toFixed(0)}s`);

  const at = (beat: number) => +(w + beat).toFixed(3);
  writeFileSync(
    sidecarPath,
    JSON.stringify(
      {
        video: `${clip.name}.mp4`,
        fps: spec.fps,
        seconds: spec.totalFrames / spec.fps,
        source: relative(outDir, clip.path),
        endCard: {
          warpStart: at(0),
          holdS: spec.holdS,
          zone: spec.zoneName,
          accent: spec.accent,
          line: spec.line,
          // Seconds into this mp4 at which each beat begins.
          beats: Object.fromEntries(Object.entries(BEATS).map(([k, v]) => [k, at(v)])),
        },
        // The gameplay's events up to the end of the warp, the card's beats
        // (`endCard`) and its sounds (`sound`, which the mixer plays as written).
        timeline: composedTimeline(clip.sidecar.timeline, spec),
        results: clip.sidecar.results,
        take: clip.sidecar.take,
      },
      null,
      2,
    ),
  );
  renameSync(partial, mp4);
  untemp(partial);

  let status: Status = 'ok';
  if (!args.silent) {
    try {
      const mix = await addClipAudio(sidecarPath);
      const note = mix.inSpec ? '' : ' ⚠ outside −14 ±0.5 LUFS / −1.5 dBTP';
      log(`  audio: ${mix.cues} sounds + ambient, ${mix.loudness}${note}`);
    } catch (error) {
      if (error instanceof AbortedError || isAborting()) throw error;
      log(`✗ audio mix failed — the mp4 is silent. Retry just the audio with ` +
          `\`bun run clip:audio ${relative(ROOT, sidecarPath)}\`:\n${(error as Error).message}`); // prettier-ignore
      status = 'silent';
    }
  }
  log(`✓ ${relative(ROOT, mp4)}`);
  return status;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(`bun run clip:compose [clip.json …] [flags]\n${USAGE}`);
    return 0;
  }
  let args: ComposeArgs;
  try {
    args = parseComposeArgs(argv);
  } catch (error) {
    console.error(`${(error as Error).message}\nbun run clip:compose [clip.json …] [flags]${USAGE}`);
    return 2;
  }
  exitOnSignals(log);
  const outDir = resolve(ROOT, args.out);
  const paths = args.files.length > 0 ? args.files.map((f) => resolve(f)) : pendingClips(outDir, args.force);
  if (paths.length === 0) {
    log(`nothing to compose — every clip in ${GAMEPLAY_DIR} has a composed version (--force to redo)`);
    return 0;
  }

  const clips: Clip[] = [];
  const unreadable: string[] = [];
  for (const path of paths) {
    try {
      const sidecar = (await Bun.file(path).json()) as Clip['sidecar'];
      const video = join(dirname(path), sidecar.video);
      if (!existsSync(video)) throw new Error(`its video ${sidecar.video} is missing`);
      endCardSpec(sidecar); // fail early on a sidecar the card can't read
      clips.push({ path, name: basename(path, '.json'), sidecar });
    } catch (error) {
      unreadable.push(path);
      log(`✗ ${relative(ROOT, path)}: ${(error as Error).message}`);
    }
  }
  const names = new Set(clips.map((c) => c.name));
  if (names.size < clips.length) {
    log('✗ two of those clips share a file name — compose them in separate runs');
    return 2;
  }
  mkdirSync(outDir, { recursive: true });

  try {
    let made = 0;
    let silent = 0;
    let failed = unreadable.length;
    if (clips.length > 0) {
      // One bundle for the run; each clip is staged into its public dir in turn.
      log(`bundling the composition…`);
      const emptyPublic = temp(mkdtempSync(join(tmpdir(), 'clip-compose-public-')));
      const bundleDir = temp(mkdtempSync(join(tmpdir(), 'clip-compose-bundle-')));
      const serveUrl = await bundle({ entryPoint: ENTRY, publicDir: emptyPublic, outDir: bundleDir });
      mkdirSync(join(serveUrl, 'public'), { recursive: true });
      for (const [i, clip] of clips.entries()) {
        if (isAborting()) throw new AbortedError();
        log(`clip ${i + 1}/${clips.length}`);
        try {
          const status = await composeClip(clip, serveUrl, args, outDir);
          if (status === 'ok') made += 1;
          else silent += 1;
        } catch (error) {
          if (error instanceof AbortedError || isAborting()) throw error;
          log(`✗ ${clip.name}: ${(error as Error).message}`);
          failed += 1;
        }
      }
    }
    const total = paths.length;
    const parts = [`${made + silent} of ${total} clip(s) composed`];
    if (silent > 0) parts.push(`${silent} without audio`);
    if (failed > 0) parts.push(`${failed} failed`);
    log(`done: ${parts.join(', ')}`);
    return failed > 0 ? 1 : silent > 0 ? 3 : 0;
  } finally {
    await killAll();
  }
}

if (import.meta.main) {
  // Remotion's renderer can keep the process alive after it's done, so exit explicitly.
  main()
    .then((code) => {
      if (!isAborting()) process.exit(code);
    })
    .catch(async (error) => {
      if (isAborting()) return;
      console.error(`[compose] ${error instanceof Error ? error.message : error}`);
      await killAll();
      process.exit(1);
    });
}
