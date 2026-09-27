# Gameplay Recorder — Bot-Played, Auto-Recorded Gameplay Clips

**Status: Done** (approved 2026-09-19; built and verified end to end on
2026-09-20. Skill styles were reworked in `plans/clip-styles.md`, and phase 2
audio (§3.7) was built on 2026-09-27. On the same day a 209-agent review
confirmed 52 findings, and all of them are fixed. This doc describes what is
built now.)

> First build of the clip pipeline in `plans/clip-marketing-strategy.md`.
> Everything downstream (hook clips, overlays, compose) needs a supply of
> gameplay footage at a chosen skill level. This tool produces it on demand.

## 1. Goal

One command produces finished gameplay clips at a requested skill level:

```
bun run clip --skill bad              # fail montage
bun run clip --skill decent --count 3
bun run clip --skill pro --cause crash
```

For each clip, a bot plays the real game in the iOS simulator and the screen
is recorded. The output is:

- a constant-60 fps 1080×1920 mp4 with the game's own sound;
- a sidecar JSON with the result and a timestamped event timeline.

No one touches the simulator, and the shipped app is unaffected. Requirements:
Xcode with an iPhone simulator that has Expo Go installed, and ffmpeg ≥ 5.1.

## 2. Scope

**In:**

- A headless bot that plays the pure engine (`src/game/`) under bun, with
  skill profiles and clip recipes (see `plans/clip-styles.md`).
- Takes: seeds plus exact tap steps for one or more attempts, generated
  offline and replayed in the app.
- A dev-only **clip mode** in the app that replays a take deterministically.
- A recorder: simulator, Metro, recording, a per-step ffmpeg rebuild, and
  verification.
- Game audio, rebuilt offline (§3.7).
- Unit tests for the bot, recipes, frame decoding, CLI and sound cues.

**Out (later plans):**

- Viral hook clips, overlays/CTA and compose templates (Remotion), which are
  the next plan.
- Android, real-device capture and auto-posting.
- Any change to gameplay, tuning or the production app's behaviour.

## 3. Design decisions

### 3.1 Tool-assisted replay, not a live bot in the app

Three ways to get "gameplay at a chosen skill" were considered:

| Approach                                    | Verdict                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude taps the simulator through tools     | ✗ Each tap has seconds of latency, and the game is timing-based.                                                                                                                           |
| Bot runs live inside the app (on UI thread) | ✗ Works, but puts planning code inside worklets (the definition-order constraint in `engine.ts`), can't guarantee an outcome, can't know the run length in advance, and bloats the bundle. |
| **Pre-simulate offline → replay in app**    | ✓ Chosen.                                                                                                                                                                                  |

The engine is pure TS with a seeded RNG (`createInitialState(w, h, seed)`,
`stepGame`, `handleTap`), so the bot plays **headlessly under bun** at about
4 ms per run. It searches for runs that fit the request.

The result is a **take**, defined in `src/clip/take.ts`. It holds one or more
attempts on one clip timeline, and each attempt has:

- a seed;
- tap steps;
- a start step;
- optional fast-forward steps;
- the expected result.

The app replays the take with the same seeds, fixed 1/60 s steps and taps at
the exact step indices, through the same `replayStep`/`installAttempt`
functions the bot used. Same inputs plus a deterministic sim gives the exact
run the bot found.

### 3.2 The bot: lookahead oracle + human error model

- **Oracle** (`oracle.ts`). For each upcoming step it asks "what if I tapped
  now?": it forks the state, taps, and flies the jump to its end. The outcome
  is either a capture (planet, perfect/graze, skips, band margin) or a death
  (crash/lost, plus how close the flight passed the nearest on-screen ring).
- **Intent** (`bot.ts`, `profiles.ts`). A profile picks the window it means
  to hit, and only considers windows before the first lap after landing is
  over. The window's value weighs:
  - the chance of hitting it;
  - skips (`skipValue`);
  - quick releases (`quickValue`);
  - waiting (`impatience`);
  - risk.

  `profiles.ts` holds the current numbers (timing sigma: pro 9 ms, decent
  22 ms, bad 40 ms with a −25 ms early bias). `plans/clip-styles.md` has the
  measured behaviour.

- **Error.** The actual tap is the intended tap plus gaussian timing jitter,
  and the engine decides whether it still lands.
- **Scripted deaths** (`dieAfterJumps`, `cause`, `nearMiss`). All hops before
  the death are protected: the timing error is re-drawn until the tap lands.
  The death itself is either a mistimed version of the intended jump or,
  sometimes, a panic tap. Its flight must resolve within 1.5 s. By default
  about 80 % of deaths are misses that fly off a side edge, and the rest
  are crashes inside the frame. Nothing ever lands back on a lower planet.
  `plans/clip-styles.md` §3.4 has the details.
- **Safety margins.** Bun runs JavaScriptCore and the app runs Hermes, so
  float results can differ in the last bit. To keep a 1e-12 drift from
  flipping an outcome:
  - intended captures clear the band edges by 0.01 px;
  - near misses clear the ring by at least 0.3 px.

  The app reports every attempt's result back: score, planets and cause, plus
  a **fingerprint** that both engines reproduce bit-exactly when the replay
  matched step for step. The fingerprint holds the end time, the death,
  release, capture, flyby and zone times, the RNG state, the next planet id
  and heat (`resultOf` in `src/clip/replay.ts`). So a drift in _when_
  anything happened is caught too, not just a different outcome. A mismatch
  means the take is discarded and re-recorded with another seed, up to 3
  tries per clip.

  **Exit codes:**

  | Code | Meaning                                                    |
  | ---- | ---------------------------------------------------------- |
  | 0    | all clips made                                             |
  | 1    | some clips are missing                                     |
  | 2    | usage error                                                |
  | 3    | all clips made, but some are silent (the audio mix failed) |
  | 130  | interrupted                                                |

### 3.3 Clip mode in the app (gated, inert in store builds)

- **Gate.** `process.env.EXPO_PUBLIC_CLIP_MODE === '1'`, which only the
  recorder's own Metro sets.
  - In store builds `CLIP_MODE` is false, and `useClipReplay` is chosen at
    module load as a **constant no-op with no hooks**, so no clip state,
    worklet or network code runs.
  - What remains is a handful of `CLIP_MODE &&` checks in `App.tsx`,
    `GameScreen.tsx` and `GameCanvas.tsx` (a few KB of bundle).
  - There is no URL scheme and no hidden gesture.
- **Code** lives in `src/clip/`:
  - `take.ts` and `replay.ts`: pure, shared with the bot;
  - `clipMode.ts`: the flag and the recorder I/O;
  - `useClipReplay.tsx`: the driver.
- **What the app does in clip mode:**
  - skips Home and ignores touch;
  - never auto-pauses;
  - polls the recorder (`/take`, carrying a per-run token so an app left
    over from an earlier run is ignored);
  - installs attempts atomically on the UI thread, fast-forwarding
    invisibly when a highlight opens mid-run;
  - replays in fixed steps;
  - takes no touches at all (the whole screen ignores pointer events);
  - re-applies muted sound/haptics and the running BEST at every attempt.
    BEST starts at the take's value and rises when a try beats it, as in the
    game, and is never persisted;
  - reports each attempt's result, and a final `/done` once the held
    death card has been shown. Reports are idempotent, keyed by take id and
    attempt, and retried until acknowledged.
- **Every step must reach the screen.** The recorder rebuilds the video one
  frame per step (§3.5), so wall-clock pacing doesn't matter, but every
  state has to be drawn. Three guards:
  - **Pacing:** never step twice within 25 ms of wall clock (`Date.now()`,
    not `frame.timestamp`, which stays evenly spaced even when a backlog of
    callbacks runs back-to-back). That's about 30 steps/s on a 60 Hz
    display, so recording takes **at least 2× real time**, plus commit waits.
  - **Commit handshake:** a step that changes React-mirrored state (planets,
    score, heat, phase, zone) pauses the sim until a sequence number has
    round-tripped:
    - through React state,
    - into a `CommitProbe` inside the Skia canvas, whose effect runs only
      after Skia's own reconciler has rendered the new tree,

    and then waits another 100 ms to settle. Waits are timed in ms. A wait
    that times out (2 s) is counted, and the take is re-recorded rather than
    kept with stale frames.

  - **Overlays run on sim time:** in clip mode the death card and zone
    banner fade from `gameState.time`, not from wall-clock layout animations
    or timers. Otherwise they'd play about 2× fast in a clip rebuilt per step,
    and the banner's expiry would re-render mid-replay.
    - The fades use the game's easing curve.
    - They follow the state as of the previous display frame, because Skia
      presents its picture one frame late while Reanimated styles apply at
      once. That way a recorded frame never pairs the world at step k with
      overlays at step k+1.
    - One known difference: live play fades the card out over 120 ms on
      retry, while a clip cuts it on the retry frame.

### 3.4 True 9:16 output via a clip viewport

The iPhone 17 Pro simulator is 1206×2622 (19.5:9), and Reels are 9:16. In
clip mode the game renders into a **9:16 sub-viewport** (402×715 pt) that
sits clear of the status bar and Dynamic Island, above the sync strip at the
bottom of the screen. The recorder then crops to it:

- The crop is 1206×2144 px, kept inside the viewport with even offsets and
  sizes. yuv420p would otherwise round outward and pull in a dark hairline.
- It is scaled to **1080×1920**.

The bot simulates the same 402×715 playfield, so replay stays exact. The
recorder refuses devices that can't fit a 9:16 viewport (e.g. the 16:9 SE)
or that letterbox the app (iPads), rather than stretching the output.

### 3.5 Recording: `simctl recordVideo` + sync-strip rebuild

- **Capture.** `xcrun simctl io <udid> recordVideo --codec h264` grabs the
  simulator framebuffer directly: headless, at native resolution, and
  stopped with SIGINT. The raw capture has no audio, a variable frame rate,
  duplicate commits, unreliable timestamps, and freezes whenever the
  simulator hitches.
- **Sync strip.** The Skia canvas extends 24 pt below the viewport, and the
  strip is drawn **last**, so no planet can paint over it.
  - It has four patches, each one base-6 digit of the step count, so it
    counts steps mod 1296. The pre-roll shows magenta.
  - The probes sit inside each patch, clear of the rounded corners and the
    home indicator.
  - With the earlier 6- and 36-step codes, short capture stalls aliased into
    silent shifts. Now a stall would have to last about 20 s.
- **Decoding** (`frames.ts`):
  - The recorder reads the patches from every captured frame.
  - It maps each frame to its step and keeps the **last** capture of each
    step, the final one included.
  - A never-captured step is filled with its neighbour and counted
    (`missingSteps`, normally 0; steps past the clip's end aren't counted).
  - A jump of more than 120 steps is treated as unreadable. Three unreadable
    frames in a row stop the decoding, so the take comes out short and is
    re-recorded rather than shifted.
- **Rebuild** (`rebuild()` in `record.ts`):
  - An ffmpeg decoder crops the viewport and lanczos-scales it to 1080×1920
    raw yuv420p, into a named pipe in the temp dir. The output folder may be
    a drive without FIFOs.
  - The pipe is opened non-blocking and read one frame at a time. The
    decoder stalls whenever the recorder is behind, so memory stays at about
    one frame, and a decoder that dies early can't hang it.
  - Each picked frame goes to an x264 encoder (crf 16) once per step it
    stands for. The encoder's input is declared BT.709 limited range with
    the sRGB transfer, exactly what the capture is, so nothing is
    colour-converted and the mp4 is tagged. Verified: output frames match
    their capture frames with a mean difference under 0.4/255.
  - The encoder writes `*.partial.mp4`. Its frame count must equal the steps
    wanted, and only then is it renamed. An encoder that dies stops the loop
    at once.

- **Pre-roll.** 45 frames hold the initial state before step 0, so the
  previous take's death card has faded and the encoder has settled.
- **Metro.** The recorder always starts its **own** Metro on a free port
  (8090 and up) with `CI=1`, so there is no file watching and an edit made
  mid-batch can't hot-reload into the app. The clip env and token are set on
  it, and it logs to `<out>/.metro.log`.
- **Processes** (`procs.ts`, shared with the audio mixer):
  - Every child process is tracked.
  - SIGINT, SIGTERM and SIGHUP stop the recorder (which finalises its file),
    ffmpeg (the mixer's included) and Metro, and delete partial and temp
    outputs.
  - Nothing new may be spawned once an abort has begun.
- **Startup checks:**
  - ffmpeg ≥ 5.1 with libx264, plus ffprobe;
  - the device's 9:16 fit, before any take;
  - a fingerprint of `src/` taken at start and again once the app has
    loaded its bundle, so an edit saved while the simulator booted can't
    make the app and the bot disagree.

  Metro is only accepted if its `/status` names this checkout.

- **Rejected:**
  - QuickTime or ScreenCaptureKit window capture (it records the Mac screen,
    with scaling and window chrome, and can't run headless);
  - an offline render via RN Skia headless plus `@remotion/skia` (it would
    mean porting the Reanimated-driven renderer).

### 3.6 Outputs

```
clips/gameplay/<date>_<skill>_<N>tries_s<seed>.mp4   ← montage, 1080×1920, 60 fps, AAC
clips/gameplay/<date>_<skill>_<P>p_s<seed>.mp4       ← single run (P = planets reached)
clips/gameplay/<name>.json                            ← sidecar
```

If any output with that name exists (mp4, a kept raw, sidecar, partial), the
new clip gets `-2`, `-3` and so on. Sidecar keys:

- `video`, `fps`, `seconds`, `missingSteps`, `heldMs`;
- `results`: one per attempt, as the app reported it, fingerprint included;
- `timeline`;
- `take`;
- `audio`: `{ lufs, truePeak, inSpec }`, measured on the encoded track.

`timeline` holds every release, capture (kind, heat, score, skips), flyby,
zone and death event, plus `attemptStart`/`attemptEnd` markers. Each entry has:

- `t`: seconds into the mp4 at which it becomes visible;
- `step`: the clip step;
- `attempt`: which try it belongs to.

Markers:

- `attemptStart.t` is the first frame that shows the try. A retry is
  installed inside its start step, so it shows one frame later.
- `attemptEnd` has `jumps` (landings shown in the clip) and `runJumps` (the
  whole run, including a highlight's fast-forwarded part).

A highlight also includes events from up to 3.45 s before it opens (a zone
banner's on-screen time), at `t ≤ 0`, because they can still be on screen
or still sounding. The composer
reads `timeline`, not `take.attempts[].events`, which are in raw run steps.
`clips/` is git-ignored.

### 3.7 Audio (phase 2)

**Status: built 2026-09-27.** Clips get the game's own sound, rebuilt offline
from the sidecar timeline. This is cleaner and more exact than capturing
system audio: BlackHole would also pick up Mac notification sounds, and the
replay runs slower than real time anyway.

- **Same sounds, same rules as the game.** `src/audio/sfxParams.ts` holds
  the pure sound rules and is shared with `sfx.ts`, so the game and the
  mixer can't drift. The mix gets:
  - capture, graze and flyby variants cycling round-robin, as the voice
    pools do;
  - captures stepping up the heat scale;
  - flybys getting louder and faster (so also higher) with heat;
  - ±4 % jitter on release, graze and flyby, seeded so a re-mix is
    identical;
  - the ambient pad looping underneath at 0.3.

  The burn loop is disabled in the game, so it's left out. Every cue plays
  to its end; the game's single-voice pools would cut the −55 dB tail of a
  repeated chime, which is inaudible.

- **Rate means pitch and speed together (varispeed).** The game's voice
  pools set `shouldCorrectPitch = false`, so expo-audio plays a rate change
  as varispeed and the heat melody is heard. Its default, pitch correction,
  would only shorten each note. The mix matches that with a resampling pitch
  shift (`asetrate` between two `aresample`s).
  - Every rate applies exactly, jitter included, and onsets stay
    sample-accurate.
  - Nothing is padded or trimmed, so the ambient pad keeps its 32 s loop,
    rest included.
  - Rates stay ≤ 2.0, where expo-audio clamps
    (`src/audio/sfxParams.test.ts`). The mixer doesn't clamp, so a higher
    rate would make the clip and the phone disagree.
- **Timing.** Each sound starts on the frame where its event first shows. A
  cue with t < 0 (just before a highlight opens) joins mid-sound.
- **Loudness.**
  - A static gain brings the mix to −14 LUFS integrated, the level Reels,
    TikTok and Shorts normalise to.
  - A latency-compensated peak limiter then caps it.
  - The **encoded AAC** is measured, and gain and limit are corrected for up
    to 6 passes until it is within ±0.5 LU of −14 with a true peak
    ≤ −1.5 dBTP. The limit only ever tightens, so the two corrections can't
    undo each other.
  - If it still misses, the closest pass is kept and the log and the
    sidecar (`audio.inSpec`) say so.

  There's no dynamic normalisation, so the pad never pumps. The output is
  AAC 192 kbps, 48 kHz stereo, muxed with the video stream copied.

- **CLI:**
  - `bun run clip` mixes audio by default, and `--silent` skips it (for
    trending-audio posts).
  - `bun run clip:audio <clip.json…>` re-mixes existing clips. If the mix
    fails during a recording, the clip is kept silent and this command is
    suggested.

## 4. Implementation steps

1. ✅ **Bot core:** `scripts/clips/oracle.ts`, `bot.ts`, `profiles.ts`, and
   `recipes.ts` (which replaced `search.ts`), plus the shared
   `src/clip/take.ts` and `replay.ts`.
2. ✅ **Take CLI:** `bun run clip:take` (`--stats N` for profile and recipe
   statistics).
3. ✅ **Clip mode:** `src/clip/clipMode.ts` and `useClipReplay.tsx`, with
   branches in `App.tsx`, `GameScreen.tsx` and `GameCanvas.tsx`.
4. ✅ **Recorder:** `bun run clip` (`scripts/clips/record.ts`, with the pure
   parts in `frames.ts`).
5. ✅ **Skill styles:** `plans/clip-styles.md`.
6. ✅ **Audio:** `scripts/clips/audio.ts` (§3.7).
7. ✅ **Review fixes** (2026-09-27): all 52 confirmed findings.

## 5. Testing & acceptance criteria

`bun test` runs `scripts/clips/bot.test.ts` and `frames.test.ts` alongside
the game tests. It covers:

- **Profiles:**
  - medians over 120 seeds: pro ≥ 35, decent 6–25, bad ≤ 5;
  - one-lap limits.
- **Scripted deaths:** each cause, with 4–6 jumps for a request of 4.
- **Exact replay:** every attempt of every recipe, through the app's own
  clip loop (`simulateClip`).
- **Recipes:**
  - the montage and highlight rules;
  - `--jumps N` terminates;
  - pro `--near-miss` and `--cause`;
  - burned endings.
- **Sync decoding:**
  - gaps up to 120 steps are filled, not shifted, including those the old
    6- and 36-step codes aliased;
  - glitches are ignored;
  - longer stalls come out short;
  - the final step keeps its freshest capture.
- **Crop and probe geometry:** the math, plus refusal of unsupported devices.
- **Sidecar:**
  - the timeline lookback, which covers a zone banner;
  - attempt markers;
  - visible jump counts.
- **Bot:**
  - must-survive hops without a window land safely;
  - the one-lap horizon.
- **Sound cues.**
- **Sound rates:** every reachable rate within expo-audio's 2.0 clamp.
- **CLI validation.**

There is no automated test for the rebuild (it needs ffmpeg and a real
capture). It is checked end to end: frame count, and per-frame comparison
against the capture.

**End to end:**

- Recorded clips are 1080×1920 at constant 60 fps.
- Every attempt's app-reported result equals the bot's prediction.
- Audio length equals video length, at −14 ± 0.5 LUFS and ≤ −1.5 dBTP.

## 6. Risks and known issues

- **Shipped-game audio: varispeed awaits an on-device listen.** Until
  2026-09-27, expo-audio's default pitch correction meant every capture
  played the same note, only shorter, so the heat melody (`HEAT_SEMITONES`)
  was never heard on phones. The voice pools (and the parked burn loop) now
  set `shouldCorrectPitch = false`, and the mixer went from `atempo` to
  varispeed (§3.7). Players only get this with an App Store update, so
  listen in Expo Go first. Also listen to flyby chains: rate 1.0 → 1.2 now
  also rises ~3 semitones. `plans/sfx-upgrade.md` ruled out flyby pitch
  after a playtest that, on expo-audio, most likely heard it pitch-corrected.
- **JSC vs Hermes float drift.** Mitigated by the safety margins, the
  per-attempt result check and automatic re-recording.
- **Renderer changes that add React-mirrored state.** If GameScreen starts
  mirroring a new GameState field into React, add it to `touchesReact` in
  `src/clip/useClipReplay.tsx`, or those re-renders will drop steps again.
- **New wall-clock UI in GameScreen.** Any new timed animation must also
  run on sim time in clip mode (as the death card and zone banner do), or it
  will play at the replay's pace in clips.
