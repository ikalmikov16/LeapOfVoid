// Child-process and temp-file bookkeeping shared by the recorder and the
// audio mixer. Bun doesn't kill children when it exits, so every child is
// tracked and an abort (Ctrl-C, SIGTERM, SIGHUP) stops them all — recorders
// with SIGINT so simctl finalises its file — and deletes unfinished outputs.
// Once an abort has started, nothing new may be spawned.

import type { Subprocess } from 'bun';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export const ROOT = resolve(import.meta.dir, '../..');

const children = new Set<Subprocess>();
const recorders = new Set<Subprocess>();
const temps = new Set<string>();
let aborting = false;

/** Thrown by anything that would start new work after an abort began. */
export class AbortedError extends Error {
  constructor() {
    super('aborted');
  }
}

export const isAborting = () => aborting;

/** Register a child for cleanup (`recorder`: stop it with SIGINT). */
export function track<P extends Subprocess>(proc: P, opts: { recorder?: boolean } = {}): P {
  if (aborting) {
    proc.kill(opts.recorder === true ? 'SIGINT' : 'SIGTERM');
    throw new AbortedError();
  }
  children.add(proc);
  if (opts.recorder === true) recorders.add(proc);
  proc.exited.finally(() => {
    children.delete(proc);
    recorders.delete(proc);
  });
  return proc;
}

/** Register an unfinished output file, deleted if we abort. */
export function temp<T extends string>(path: T): T {
  temps.add(path);
  return path;
}

/** The file is finished (or already removed): don't delete it on abort. */
export function untemp(path: string): void {
  temps.delete(path);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A rejecting timer that can be cleared — a lost race must not keep the process alive. */
export function deadline(ms: number, message: string): { promise: Promise<never>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  promise.catch(() => {}); // an unobserved rejection must not crash the process
  return { promise, clear: () => clearTimeout(timer) };
}

export const hasExited = (proc: Subprocess) => proc.exitCode !== null || proc.signalCode !== null;

export async function stopProcess(
  proc: Subprocess,
  signal: NodeJS.Signals,
  graceMs: number,
): Promise<void> {
  if (hasExited(proc)) return;
  proc.kill(signal);
  const t = deadline(graceMs, 'grace period over');
  await Promise.race([proc.exited, t.promise]).catch(() => proc.kill('SIGKILL'));
  t.clear();
}

/** Stop every tracked child and delete unfinished outputs. */
export async function killAll(): Promise<void> {
  for (let round = 0; round < 5 && children.size > 0; round++) {
    await Promise.all([...recorders].map((p) => stopProcess(p, 'SIGINT', 5000)));
    await Promise.all([...children].map((p) => stopProcess(p, 'SIGTERM', 3000)));
  }
  for (const file of temps) rmSync(file, { force: true, recursive: true });
  temps.clear();
}

/** Run a command to completion; throws on a non-zero exit unless allowFail. */
export async function run(
  cmd: string[],
  opts: { allowFail?: boolean; timeoutMs?: number } = {},
): Promise<string> {
  const proc = track(
    Bun.spawn(cmd, { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }),
  );
  let timedOut = false;
  const timer =
    opts.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          proc.kill();
        }, opts.timeoutMs);
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (aborting) throw new AbortedError();
  if (timedOut) throw new Error(`${cmd.join(' ')} timed out`);
  if (code !== 0 && opts.allowFail !== true) {
    throw new Error(`${cmd.slice(0, 4).join(' ')} … failed (${code}):\n${(err || out).slice(-2000)}`);
  }
  return out;
}

/**
 * On SIGINT / SIGTERM / SIGHUP: stop everything, clean up, exit 130. The
 * main flow must not race this — it checks isAborting() and stays quiet.
 */
export function exitOnSignals(log: (message: string) => void): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      if (aborting) return;
      aborting = true;
      log(`${signal} — stopping everything…`);
      void killAll().finally(() => process.exit(130));
    });
  }
}
