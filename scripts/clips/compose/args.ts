// `bun run clip:compose` flags — kept apart from compose.ts so tests don't
// load Remotion. Design: plans/clip-composer.md §3.6.

import { DEFAULT_HOLD_S } from './endCard';

export const GAMEPLAY_DIR = 'clips/gameplay';
export const DEFAULT_OUT = 'clips/composed';

export const USAGE = `
  [clip.json …]   gameplay sidecars to compose (default: every ${GAMEPLAY_DIR}/*.json
                  without a composed version yet)
  --hold S        seconds the finished card holds before the clip ends (default ${DEFAULT_HOLD_S})
  --out DIR       output folder (default ${DEFAULT_OUT})
  --force         with no clips given: re-compose clips that already have a composed version
  --silent        no audio (for posts that only carry trending audio)
  --help`;

export interface ComposeArgs {
  files: string[];
  holdS: number;
  out: string;
  force: boolean;
  silent: boolean;
}

export function parseComposeArgs(argv: string[]): ComposeArgs {
  const args: ComposeArgs = {
    files: [],
    holdS: DEFAULT_HOLD_S,
    out: DEFAULT_OUT,
    force: false,
    silent: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--hold') {
      const v = value();
      const n = Number(v);
      if (!/^\d+(\.\d+)?$/.test(v) || n > 10) throw new Error(`--hold must be 0–10 seconds, got ${v}`);
      args.holdS = n;
    } else if (a === '--out') args.out = value();
    else if (a === '--force') args.force = true;
    else if (a === '--silent') args.silent = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`);
    else if (!a.endsWith('.json')) throw new Error(`Expected a clip sidecar (.json), got ${a}`);
    else args.files.push(a);
  }
  return args;
}
