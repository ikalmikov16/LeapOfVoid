// GameScreen's clip-mode driver: polls the recorder for takes, then replays
// each one with fixed steps and scripted taps — installing every attempt the
// way "TAP TO TRY AGAIN" would, and fast-forwarding invisibly when a
// highlight opens mid-run.
//
// The output video is rebuilt by the recorder as exactly one frame per sim
// step (it reads the sync strip — see SYNC_STRIP_PT), so this driver's job is
// to make sure every step reaches the screen, with everything on it —
// including overlays, which in clip mode run on sim time, not wall time.
// See plans/gameplay-recorder.md §3.3 and plans/clip-styles.md.
//
// In store builds (CLIP_MODE false) `useClipReplay` is a constant no-op with
// no hooks at all — the choice is made once, at module load.

import { Group, Rect } from '@shopify/react-native-skia';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  DEATH_OVERLAY_DELAY_MS,
  DEATH_OVERLAY_FADE_MS,
  ZONE_FLASH_FADE_IN_MS,
  ZONE_FLASH_MS,
} from '../game/constants';
import type { GameState } from '../game/types';
import { useAppStore } from '../state/appStore';
import { CLIP_MODE, fetchNextTake, reportDone, reportResult } from './clipMode';
import {
  clipViewport,
  installAttempt,
  replayStep,
  resultOf,
  scriptFor,
  SYNC_PATCHES,
  SYNC_STRIP_PT,
  syncColors,
  ZONE_BANNER_S,
  type ClipScript,
  type ClipViewport,
} from './replay';
import type { TakeResult } from './take';

const POLL_MS = 300;
/**
 * Display frames the first state is held before step 0: lets the previous
 * take's death card fade out and the video encoder settle, so the clip's
 * first frame is clean. Trimmed off by the recorder.
 */
const PREROLL_FRAMES = 45;
/**
 * Never step twice within this many ms of wall clock, so every state stays on
 * screen for at least one full refresh and the capture sees it. Wall clock,
 * not frame.timestamp: after a hiccup the display link replays its backlog
 * back-to-back with evenly spaced vsync timestamps. Replay runs at ≤ 40
 * steps/s of wall time (30 on a 60 Hz display) — the video is rebuilt at
 * 60 fps regardless.
 */
const MIN_STEP_MS = 25;
/** After a commit is acknowledged, let Skia post the new picture before stepping on. */
const SETTLE_MS = 100;
/** Give up waiting for a commit after this long — counted, and fails the take. */
const MAX_WAIT_MS = 2000;
/** Live play's FadeIn/FadeOut timing curve (Reanimated's default for layout animations). */
const FADE_EASING = Easing.inOut(Easing.quad);

interface PendingTake {
  id: string;
  width: number;
  height: number;
  script: ClipScript;
  /** Steps to keep stepping after the end before reporting done. */
  holdSteps: number;
}

export interface ClipReplay {
  viewport: ClipViewport;
  onFrame: () => void;
  /** Skia layer GameCanvas draws last (sync strip + commit probe), or undefined. */
  canvasLayer: ReactNode | undefined;
  /** Sim-time opacity for the death card / zone banner (undefined = use layout animations). */
  deathCardStyle: ReturnType<typeof useAnimatedStyle> | undefined;
  zoneBannerStyle: ReturnType<typeof useAnimatedStyle> | undefined;
  /** GameScreen reports each death's score: a new best raises BEST for later tries. */
  recordScore: (score: number) => void;
}

/** Did this step change anything GameScreen mirrors into React state? */
function touchesReact(prev: GameState, next: GameState): boolean {
  'worklet';
  return (
    next.planets !== prev.planets ||
    next.score !== prev.score ||
    next.heat !== prev.heat ||
    next.phase !== prev.phase ||
    next.zoneChangedAt !== prev.zoneChangedAt
  );
}

/**
 * Acknowledges a commit from inside the Skia tree: Canvas re-renders its
 * children in its own reconciler after React Native commits, so when this
 * effect runs, the canvas (new planets included) has caught up too.
 */
function CommitProbe({ seq, ack }: { seq: number; ack: SharedValue<number> }) {
  useEffect(() => {
    ack.value = seq;
  }, [seq, ack]);
  return null;
}

function useClipReplayImpl(
  gameState: SharedValue<GameState>,
  windowWidth: number,
  windowHeight: number,
  /** Called whenever an attempt starts — GameScreen resets its run-scoped UI. */
  onAttemptStart: () => void,
): ClipReplay {
  const [viewport, setViewport] = useState<ClipViewport>(() =>
    clipViewport(windowWidth, windowHeight),
  );
  const busy = useRef(false);
  /** The take being replayed, and the best score so far (starts at the take's BEST). */
  const current = useRef<{ id: string; bestScore: number } | null>(null);

  // Handed over whole and unpacked on the UI thread inside one frame, so the
  // sim can never step a half-installed take.
  const pending = useSharedValue<PendingTake | null>(null);
  const takeId = useSharedValue('');
  const size = useSharedValue({ width: 0, height: 0 });
  const script = useSharedValue<ClipScript>({ installs: [], taps: [], reportAt: [], endStep: 0 });
  const holdSteps = useSharedValue(0);
  // step < 0 = idle (frozen, waiting for a take).
  const step = useSharedValue(-1);
  const installIndex = useSharedValue(0);
  const tapIndex = useSharedValue(0);
  const reportIndex = useSharedValue(0);
  const doneReported = useSharedValue(false);
  const prerollFrames = useSharedValue(0);
  const lastStepAt = useSharedValue(0);
  // Skia presents a frame's picture one display frame after the frame that
  // produced it, but Reanimated styles apply in the same frame. The overlays
  // therefore follow the state as of the previous frame, so a recorded frame
  // never pairs the world at step k with overlays at step k+1.
  const presented = useSharedValue<GameState | null>(null);
  const overlayState = useSharedValue<GameState | null>(null);

  // Commit handshake. A step that touches React state bumps `syncSeq`; one
  // frame later (so it queues behind GameScreen's own runOnJS setters) the
  // number goes through React state into the canvas layer's CommitProbe,
  // whose effect echoes it back once both React Native and the Skia canvas
  // have committed. The sim waits for the echo, then SETTLE_MS.
  const [pingSeq, setPingSeq] = useState(0);
  const syncSeq = useSharedValue(0);
  const ackedSeq = useSharedValue(0);
  const pingDue = useSharedValue(false);
  const waitingSince = useSharedValue(0); // 0 = not waiting
  const settleUntil = useSharedValue(0);
  const heldMs = useSharedValue(0);
  const timeouts = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!busy.current) {
        const served = await fetchNextTake(windowWidth, windowHeight);
        if (cancelled) return;
        if (served !== null) {
          const { id, take } = served;
          busy.current = true;
          current.current = { id, bestScore: take.bestScore };
          setViewport({ width: take.width, height: take.height });
          pending.value = {
            id,
            width: take.width,
            height: take.height,
            script: scriptFor(take),
            holdSteps: take.holdSteps,
          };
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowWidth, windowHeight]);

  const attemptStarted = () => {
    // Re-applied on every attempt: anything that re-ran the store's hydration
    // (or a settings toggle) must not leak into the clip. The recording is
    // silent (the mixer rebuilds the audio), so sounds and haptics are off.
    // Never persisted.
    if (current.current !== null) {
      useAppStore.setState({
        bestScore: current.current.bestScore,
        sfxEnabled: false,
        musicEnabled: false,
        hapticsEnabled: false,
      });
    }
    onAttemptStart();
  };

  const report = (
    id: string,
    attempt: number,
    result: TakeResult,
    held: number,
    handshakeTimeouts: number,
  ) => {
    reportResult(id, { attempt, ...result, heldMs: held, handshakeTimeouts });
  };
  const recordScore = (score: number) => {
    if (current.current === null || score <= current.current.bestScore) return;
    current.current.bestScore = score;
    useAppStore.setState({ bestScore: score });
  };
  const done = (id: string, held: number, handshakeTimeouts: number) => {
    reportDone(id, held, handshakeTimeouts);
    busy.current = false;
  };

  /** Pause the sim until React + Skia have committed what this frame changed. */
  const awaitCommit = () => {
    'worklet';
    syncSeq.value += 1;
    pingDue.value = true;
    waitingSince.value = Date.now();
  };

  /** Frame-callback body for clip mode. Keeps stepping past the end so the
   * final death effects and card play out while the recorder finishes. */
  const onFrame = () => {
    'worklet';
    const now = Date.now();
    overlayState.value = presented.value;
    presented.value = gameState.value;
    const next = pending.value;
    if (next !== null) {
      // The first attempt is installed (and fast-forwarded, which can take a
      // long frame) right away, while the pre-roll holds it still.
      pending.value = null;
      takeId.value = next.id;
      size.value = { width: next.width, height: next.height };
      script.value = next.script;
      holdSteps.value = next.holdSteps;
      gameState.value = installAttempt(next.width, next.height, next.script.installs[0]);
      installIndex.value = 1;
      tapIndex.value = 0;
      reportIndex.value = 0;
      doneReported.value = false;
      prerollFrames.value = PREROLL_FRAMES;
      heldMs.value = 0;
      timeouts.value = 0;
      step.value = 0;
      runOnJS(attemptStarted)();
      awaitCommit();
      return;
    }
    if (step.value < 0) return;

    if (pingDue.value) {
      pingDue.value = false;
      runOnJS(setPingSeq)(syncSeq.value);
      return;
    }
    if (waitingSince.value > 0) {
      const waited = now - waitingSince.value;
      if (ackedSeq.value < syncSeq.value && waited < MAX_WAIT_MS) return;
      if (ackedSeq.value < syncSeq.value) timeouts.value += 1;
      heldMs.value += waited;
      waitingSince.value = 0;
      settleUntil.value = now + SETTLE_MS;
    }
    if (now < settleUntil.value) return;
    if (settleUntil.value > 0) {
      heldMs.value += SETTLE_MS;
      settleUntil.value = 0;
    }
    if (prerollFrames.value > 0) {
      prerollFrames.value -= 1;
      return;
    }

    if (now - lastStepAt.value < MIN_STEP_MS) return;
    lastStepAt.value = now;

    const i = step.value;
    const sc = script.value;
    const before = gameState.value;
    let base = before;
    const install = sc.installs[installIndex.value];
    if (install !== undefined && install.atStep === i) {
      // A retry: the next attempt replaces the dead run, like the death card's tap.
      base = installAttempt(size.value.width, size.value.height, install);
      installIndex.value += 1;
      runOnJS(attemptStarted)();
    }
    const tap = tapIndex.value < sc.taps.length && sc.taps[tapIndex.value] === i;
    if (tap) tapIndex.value += 1;
    const after = replayStep(base, tap);
    gameState.value = after;
    step.value = i + 1;

    const k = reportIndex.value;
    if (k < sc.reportAt.length && sc.reportAt[k] === i + 1) {
      reportIndex.value = k + 1;
      runOnJS(report)(takeId.value, k, resultOf(after), heldMs.value, timeouts.value);
    }
    if (!doneReported.value && i + 1 >= sc.endStep + holdSteps.value) {
      doneReported.value = true;
      runOnJS(done)(takeId.value, heldMs.value, timeouts.value);
    }
    if (touchesReact(before, after)) awaitCommit();
  };

  const colors = useDerivedValue(() => syncColors(step.value));
  const patch0 = useDerivedValue(() => colors.value[0]);
  const patch1 = useDerivedValue(() => colors.value[1]);
  const patch2 = useDerivedValue(() => colors.value[2]);
  const patch3 = useDerivedValue(() => colors.value[3]);
  const patchWidth = viewport.width / SYNC_PATCHES;
  const canvasLayer = (
    <Group>
      {[patch0, patch1, patch2, patch3].map((color, k) => (
        <Rect
          key={k}
          x={k * patchWidth}
          y={viewport.height}
          width={patchWidth}
          height={SYNC_STRIP_PT}
          color={color}
        />
      ))}
      <CommitProbe seq={pingSeq} ack={ackedSeq} />
    </Group>
  );

  // Overlays on sim time: the video is rebuilt one frame per sim step, so a
  // wall-clock fade would play at the replay's pace (~2× fast), not the game's.
  // (Live play fades the card out over 120 ms on retry; a clip cuts it on
  // the retry frame — the overlay unmounts with the dead run.)
  const deathCardStyle = useAnimatedStyle(() => {
    const s = overlayState.value;
    if (s === null || s.phase !== 'dead') return { opacity: 0 };
    const shown =
      (s.time - s.deathTime - DEATH_OVERLAY_DELAY_MS / 1000) / (DEATH_OVERLAY_FADE_MS / 1000);
    return { opacity: FADE_EASING(Math.min(1, Math.max(0, shown))) };
  });
  const zoneBannerStyle = useAnimatedStyle(() => {
    const s = overlayState.value;
    if (s === null) return { opacity: 0 };
    const e = s.time - s.zoneChangedAt;
    const fadeIn = ZONE_FLASH_FADE_IN_MS / 1000;
    const hold = ZONE_FLASH_MS / 1000;
    let opacity = 0;
    if (e >= 0 && e < fadeIn) opacity = FADE_EASING(e / fadeIn);
    else if (e >= fadeIn && e < hold) opacity = 1;
    else if (e >= hold && e < ZONE_BANNER_S) {
      opacity = 1 - FADE_EASING((e - hold) / (ZONE_BANNER_S - hold));
    }
    return { opacity };
  });

  return { viewport, onFrame, canvasLayer, deathCardStyle, zoneBannerStyle, recordScore };
}

const INERT: ClipReplay = {
  viewport: { width: 0, height: 0 },
  onFrame: () => {
    'worklet';
  },
  canvasLayer: undefined,
  deathCardStyle: undefined,
  zoneBannerStyle: undefined,
  recordScore: () => {},
};

function useClipReplayInert(): ClipReplay {
  return INERT;
}

/**
 * Chosen once per process: CLIP_MODE is constant, so the hook count never
 * changes between renders (rules of hooks hold), and store builds run none
 * of the clip hooks at all.
 */
export const useClipReplay: typeof useClipReplayImpl = CLIP_MODE
  ? useClipReplayImpl
  : useClipReplayInert;
