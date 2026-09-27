// Clip mode: the app replays bot-generated takes for the screen recorder
// (scripts/clips/record.ts) instead of taking touch input. Only the recorder
// sets EXPO_PUBLIC_CLIP_MODE. In store builds CLIP_MODE is false, the clip
// hook is a constant no-op (useClipReplay.tsx) and none of the network code
// below ever runs; what remains is a handful of `CLIP_MODE &&` checks in
// App/GameScreen. See plans/gameplay-recorder.md §3.3.

import type { Take, TakeResult } from './take';

export const CLIP_MODE = process.env.EXPO_PUBLIC_CLIP_MODE === '1';

// The simulator shares the Mac's loopback, so the recorder is just localhost.
const SERVER = `http://127.0.0.1:${process.env.EXPO_PUBLIC_CLIP_PORT ?? '8099'}`;
/** Per-recorder-run token (passed through Metro's env): a clip-mode app left
 * running by an earlier run can't pick up or answer this run's takes. */
const TOKEN = process.env.EXPO_PUBLIC_CLIP_TOKEN ?? '';

/** A take as the recorder hands it out: with an id to tag every report. */
export interface ServedTake {
  id: string;
  take: Take;
}

/** Ask the recorder for the next take; null while it has none ready. */
export async function fetchNextTake(
  windowWidth: number,
  windowHeight: number,
): Promise<ServedTake | null> {
  try {
    const res = await fetch(
      `${SERVER}/take?w=${windowWidth}&h=${windowHeight}&token=${encodeURIComponent(TOKEN)}`,
    );
    if (res.status !== 200) return null;
    return (await res.json()) as ServedTake;
  } catch {
    return null; // recorder not up (yet)
  }
}

export interface ReportedResult extends TakeResult {
  /** Which attempt of the take this result belongs to. */
  attempt: number;
  /** Ms the sim spent waiting for React/Skia commits so far (diagnostics). */
  heldMs: number;
  /** Commit handshakes that gave up waiting — any > 0 means stale frames were recorded. */
  handshakeTimeouts: number;
}

/**
 * POST until the recorder acknowledges — a single lost request (e.g. a
 * keep-alive connection closed under it) must not lose a finished take.
 * The recorder stores reports idempotently by (take id, attempt).
 */
async function post(path: string, body: object): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`${SERVER}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, token: TOKEN }),
      });
      if (res.status === 200) return;
    } catch {
      // retry below
    }
    await new Promise((r) => setTimeout(r, Math.min(2000, 100 * 2 ** Math.min(attempt, 5))));
  }
}

/** Tell the recorder how an attempt actually ended, so it can verify the take. */
export function reportResult(takeId: string, result: ReportedResult): void {
  post('/result', { id: takeId, ...result }).catch(() => {});
}

/** Tell the recorder the take's last held frame has been shown (safe to stop recording). */
export function reportDone(takeId: string, heldMs: number, handshakeTimeouts: number): void {
  post('/done', { id: takeId, heldMs, handshakeTimeouts }).catch(() => {});
}
