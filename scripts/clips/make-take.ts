// `bun run clip:take` — build a take without recording it (prints a summary,
// optionally writes the JSON), or `--stats N` to see how each skill profile
// plays and what its clips look like. Use this to tune profiles.ts / recipes.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clipViewport } from '../../src/clip/replay';
import type { Take, TakeEvent } from '../../src/clip/take';
import { parseArgs, USAGE } from './args';
import { hasBackwardLanding, playRun } from './bot';
import type { Skill } from './profiles';
import { buildClip, clipSeconds, NO_CLIP_HINT } from './recipes';

// iPhone 17 Pro window, the recorder's default device.
const DEVICE = { width: 402, height: 874 };
const SKILLS: Skill[] = ['pro', 'decent', 'bad'];

export interface HopStats {
  releases: number;
  quick: number;
  /** Releases after more than one lap on the same planet. */
  slow: number;
  captures: number;
  /** Landings that flew past at least one planet. */
  skipping: number;
  peakHeat: number;
}

export function hopStats(events: TakeEvent[], from = 0, to = Infinity): HopStats {
  const stats: HopStats = { releases: 0, quick: 0, slow: 0, captures: 0, skipping: 0, peakHeat: 0 };
  for (const e of events) {
    if (e.step < from || e.step >= to) continue;
    if (e.type === 'release') {
      stats.releases += 1;
      if (e.quick) stats.quick += 1;
      if (e.revolutions > 1) stats.slow += 1;
    } else if (e.type === 'capture') {
      stats.captures += 1;
      if (e.skips > 0) stats.skipping += 1;
      stats.peakHeat = Math.max(stats.peakHeat, e.heat);
    }
  }
  return stats;
}

/** Stats over what the viewer actually sees (fast-forwarded stretches excluded). */
export function visibleStats(take: Take): HopStats {
  const total = hopStats([]);
  for (const a of take.attempts) {
    const s = hopStats(a.events, a.skipSteps);
    for (const key of Object.keys(total) as (keyof HopStats)[]) {
      total[key] = key === 'peakHeat' ? Math.max(total[key], s[key]) : total[key] + s[key];
    }
  }
  return total;
}

const pct = (n: number, d: number) => (d === 0 ? '–' : `${Math.round((n / d) * 100)}%`);

export function describeTake(take: Take): string {
  const s = visibleStats(take);
  const last = take.attempts[take.attempts.length - 1];
  const end =
    last.expected.deathCause === null
      ? 'cut while alive'
      : last.expected.deathCause +
        (last.missMargin !== null ? ` (missed by ${last.missMargin.toFixed(1)}px)` : '');
  const hops = `${s.releases} taps: ${pct(s.quick, s.releases)} quick, ${pct(s.skipping, s.captures)} skipping, peak ×${1 + s.peakHeat}`;
  const seconds = clipSeconds(take).toFixed(1);
  const seed = `seed ${take.meta.seed >>> 0}`;
  if (take.attempts.length > 1) {
    const jumps = take.attempts.map((a) => a.jumps).join(', ');
    return `${take.meta.profile} (${seed}): ${take.attempts.length} tries [${jumps} jumps], ${seconds}s, ${hops}, last: ${end}, BEST ${take.bestScore}`;
  }
  const first = last.events.find((e) => e.type === 'capture' && e.step >= last.skipSteps);
  const from =
    last.skipSteps > 0 && first?.type === 'capture' ? `planet ${first.planetId}` : 'the start';
  return `${take.meta.profile} (${seed}): ${from} → ${last.expected.planetsPassed}, score ${last.expected.score}, ${seconds}s, ${hops}, ${end}`;
}

function quantile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function printStats(runs: number, size: { width: number; height: number }, seed: number): void {
  console.log('Unscripted play (how each profile plays on its own):');
  for (const skill of SKILLS) {
    const planets: number[] = [];
    const laps: number[] = [];
    const total = hopStats([]);
    for (let i = 0; i < runs; i++) {
      const run = playRun({
        skill,
        seed: seed + i * 7919,
        botSeed: seed + i * 104729 + 1,
        ...size,
        maxSteps: 240 * 60,
      });
      planets.push(run.expected.planetsPassed);
      for (const e of run.events) if (e.type === 'release') laps.push(e.revolutions);
      const s = hopStats(run.events);
      total.releases += s.releases;
      total.quick += s.quick;
      total.slow += s.slow;
      total.captures += s.captures;
      total.skipping += s.skipping;
    }
    console.log(
      `  ${skill.padEnd(7)} planets p50=${quantile(planets, 0.5)}  ` +
        `laps/hop p50=${quantile(laps, 0.5).toFixed(2)} p90=${quantile(laps, 0.9).toFixed(2)}  ` +
        `>1 lap ${pct(total.slow, total.releases)}  quick ${pct(total.quick, total.releases)}  ` +
        `skipping ${pct(total.skipping, total.captures)}`,
    );
  }

  const clips = Math.min(runs, 40);
  console.log(`\nClips (${clips} per skill):`);
  for (const skill of SKILLS) {
    const seconds: number[] = [];
    const tries: number[] = [];
    const total = hopStats([]);
    let failed = 0;
    let backward = 0;
    const deaths: Record<string, number> = {};
    const started = performance.now();
    for (let i = 0; i < clips; i++) {
      const take = buildClip({ skill, ...size, seed: seed + i * 31 });
      if (take === null) {
        failed += 1;
        continue;
      }
      seconds.push(clipSeconds(take));
      tries.push(take.attempts.length);
      for (const a of take.attempts) {
        if (hasBackwardLanding(a.events)) backward += 1;
        for (const e of a.events) {
          if (e.type !== 'death') continue;
          const kind = e.cause === 'lost' ? `miss-${e.exit}` : e.cause;
          deaths[kind] = (deaths[kind] ?? 0) + 1;
        }
      }
      const s = visibleStats(take);
      total.releases += s.releases;
      total.quick += s.quick;
      total.slow += s.slow;
      total.captures += s.captures;
      total.skipping += s.skipping;
    }
    const ms = ((performance.now() - started) / clips).toFixed(0);
    console.log(
      `  ${skill.padEnd(7)} length p50=${quantile(seconds, 0.5).toFixed(1)}s max=${quantile(seconds, 1).toFixed(1)}s  ` +
        `tries p50=${quantile(tries, 0.5)}  >1 lap ${pct(total.slow, total.releases)}  ` +
        `quick ${pct(total.quick, total.releases)}  skipping ${pct(total.skipping, total.captures)}  ` +
        `failed ${failed}  (${ms}ms/clip)`,
    );
    const deathCount = Object.values(deaths).reduce((a, b) => a + b, 0);
    const shares = Object.entries(deaths)
      .sort(([, a], [, b]) => b - a)
      .map(([kind, n]) => `${kind} ${pct(n, deathCount)}`)
      .join(', ');
    console.log(`          deaths: ${shares || '–'}  backward landings: ${backward}`);
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(`bun run clip:take [flags]\n${USAGE}`);
    process.exit(0);
  }
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(argv, 'take');
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
  const size = clipViewport(DEVICE.width, DEVICE.height);

  if (args.stats > 0) {
    printStats(args.stats, size, args.request.seed);
    process.exit(0);
  }

  for (let i = 0; i < args.count; i++) {
    const take = buildClip({ ...args.request, ...size, seed: args.request.seed + i });
    if (take === null) {
      console.error(NO_CLIP_HINT);
      process.exit(1);
    }
    console.log(describeTake(take));
    if (args.outGiven) {
      mkdirSync(args.out, { recursive: true });
      const file = join(args.out, `take_${take.meta.profile}_s${take.meta.seed >>> 0}.json`);
      writeFileSync(file, JSON.stringify(take, null, 2));
      console.log(`  → ${file}`);
    }
  }
}
