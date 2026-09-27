// Shared CLI flags for the clip tools (make-take, record).

import type { DeathCause } from '../../src/game/types';
import type { Skill } from './profiles';
import { MAX_ATTEMPTS, validateRequest, type ClipRequest } from './recipes';

export interface ClipArgs {
  request: Omit<ClipRequest, 'width' | 'height'>;
  count: number;
  stats: number;
  out: string;
  /** Whether --out was given (clip:take only writes JSON when it was). */
  outGiven: boolean;
  device?: string;
  keepRaw: boolean;
  silent: boolean;
}

const SKILLS: Skill[] = ['pro', 'decent', 'bad'];
const CAUSES: DeathCause[] = ['crash', 'lost', 'burned'];

export const USAGE = `
  --skill pro|decent|bad   who is playing (default decent)
                             bad    = montage of 4–6 quick fails (0–3 jumps each), ≤ 25 s
                             decent = 2–3 tries of 2–6 jumps, ≤ 30 s
                             pro    = one ~25 s highlight run, opening at planet 25–40
  --count N                how many clips (default 1)
  --attempts N             bad/decent: number of tries
  --jumps A-B | N          bad/decent: successful jumps per try
  --start-at N             pro: open on the first landing at/after planet N (0 = from the start)
  --seconds N              clip length incl. any held death card (bad/decent: upper
                             bound; pro: target, within 80–110 %)
  --cause crash|lost|burned  how the final try ends (pro: makes the run end in a death)
  --near-miss              the final death skims a ring (implies --cause lost; default for bad)
  --best N                 "BEST" shown on the death cards
  --seed N                 reproducible request (default random)
  --out DIR                output folder (clip: default clips/gameplay;
                             clip:take: writes the take JSON there only when given)
  --device NAME|UDID       (clip only) simulator to record (default iPhone 17 Pro)
  --keep-raw               (clip only) keep the untrimmed simulator recording
  --silent                 (clip only) skip the game audio (default: SFX + ambient mixed in)
  --stats N                (clip:take only) profile + recipe stats over N runs
`;

/** Flags that only one of the tools understands. */
const ONLY: Record<string, 'clip' | 'take'> = {
  device: 'clip',
  'keep-raw': 'clip',
  silent: 'clip',
  stats: 'take',
};

/** Flags that take a value; everything else in FLAGS is a switch. */
const VALUE_FLAGS = new Set([
  'skill',
  'count',
  'attempts',
  'jumps',
  'start-at',
  'seconds',
  'cause',
  'best',
  'seed',
  'out',
  'device',
  'stats',
]);
const SWITCHES = new Set(['near-miss', 'keep-raw', 'silent']);

/** Parses and validates the CLI; throws a usage error before anything boots. */
export function parseArgs(argv: string[], tool: 'clip' | 'take'): ClipArgs {
  const flags = new Map<string, string>();
  const usage = (msg: string) => new Error(`${msg}\n${USAGE}`);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    if (ONLY[name] !== undefined && ONLY[name] !== tool) {
      throw usage(
        tool === 'take'
          ? `--${name} only applies to \`bun run clip\` (clip:take previews for the iPhone 17 Pro window)`
          : `--${name} only applies to \`bun run clip:take\``,
      );
    }
    if (SWITCHES.has(name)) {
      flags.set(name, 'true');
    } else if (VALUE_FLAGS.has(name)) {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === '' || value.startsWith('--')) {
        throw usage(`--${name} needs a value`);
      }
      flags.set(name, value);
      i += 1;
    } else {
      throw usage(`Unknown argument: ${arg}`);
    }
  }
  const int = (name: string, min: number, max: number): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    if (!/^-?\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) {
      throw usage(`--${name} must be a whole number from ${min} to ${max}, got "${raw}"`);
    }
    return Number(raw);
  };
  const positive = (name: string, max: number): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      throw usage(`--${name} must be > 0 and ≤ ${max}, got "${raw}"`);
    }
    return value;
  };
  const oneOf = <T extends string>(name: string, allowed: T[]): T | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    if (!allowed.includes(raw as T)) throw usage(`--${name} must be ${allowed.join('|')}`);
    return raw as T;
  };
  const range = (name: string): [number, number] | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    const m = /^(\d+)(?:-(\d+))?$/.exec(raw);
    const lo = m ? Number(m[1]) : NaN;
    const hi = m ? Number(m[2] ?? m[1]) : NaN;
    if (!m || lo > hi) throw usage(`--${name} needs N or A-B with A ≤ B, got "${raw}"`);
    return [lo, hi];
  };

  const request = {
    skill: oneOf('skill', SKILLS) ?? 'decent',
    seed: int('seed', 0, 2 ** 31 - 1) ?? Math.floor(Math.random() * 2 ** 31),
    attempts: int('attempts', 1, MAX_ATTEMPTS),
    jumps: range('jumps'),
    startAt: int('start-at', 0, 500),
    seconds: positive('seconds', 300),
    cause: oneOf('cause', CAUSES),
    nearMiss: flags.has('near-miss') ? true : undefined,
    bestScore: int('best', 0, 1_000_000),
  };
  try {
    validateRequest(request);
  } catch (error) {
    throw usage((error as Error).message);
  }
  return {
    request,
    count: int('count', 1, 100) ?? 1,
    stats: int('stats', 1, 10_000) ?? 0,
    out: flags.get('out') ?? 'clips/gameplay',
    outGiven: flags.has('out'),
    device: flags.get('device'),
    keepRaw: flags.has('keep-raw'),
    silent: flags.has('silent'),
  };
}
