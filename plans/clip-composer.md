# Clip Composer — End Card

**Status: Done, awaiting the user's watch and listen** (approved 2026-09-27;
the user designed the card with animated mockups in chat and asked for it to
be built. Built and verified end to end the same day. This doc describes what
was built, including two changes made during implementation: the exact RGB
copy in §3.4 and the `sound` timeline entries in §3.5. It is the first part of
the composer in `plans/clip-marketing-strategy.md` §3.)

## 1. Goal

One command turns a recorded gameplay clip into a finished clip that ends on a
branded call to action:

```
bun run clip:compose clips/gameplay/<clip>.json   # one clip
bun run clip:compose                              # every clip not composed yet
```

The output is a 1080×1920, 60 fps mp4 with the game's sound. It plays the
gameplay, then warps into space. The app icon's planet arrives, the ship
drops out of warp into its orbit, "LEAP OF VOID" slams in, then "YOUR TURN."
and a "Download from the App Store" button that the ship's spark orbits.

## 2. Scope

**In:**

- The end card, rendered with Remotion from the approved mockup.
- Per-clip data read from the sidecar: where the warp starts, the zone
  colours and the heat accent.
- The end card's own sound cues, mixed by the existing audio mixer.
- `bun run clip:compose` (batch CLI) and `bun run clip:studio` (live preview
  for tweaking).
- A small app-side refactor so the composer can import the zone palettes.
- Unit tests for the pure parts.

**Out (later composer work):**

- The game name tag shown for the whole clip, and hook captions.
- Viral hook clips and transitions.
- Attempt counters.
- Chaining compose into `bun run clip`.
- Auto-posting.

## 3. Design decisions

### 3.1 Storyboard (approved in chat)

Times are seconds after the warp starts (W). The design is the chat mockup
"1. Drops out of warp, then captured" with the dimmed two-line orbit pill.

| t           | Beat                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.00–0.55   | **Warp.** The gameplay zooms ×1 → ×2.8 around (540, 860) with an ease-in and fades out. Stars behind it stretch into streaks radiating from the same point. |
| 0.55        | **Arrival.** A flash of the accent colour (50 % → 0 over 0.3 s). The streaks slow back to points by 1.30.                                                   |
| 0.55–1.05   | The icon planet (purple `#9B5DE5`, r 96, ring r 210) comes out of the vanishing point to (540, 520).                                                        |
| 0.75–1.15   | **The ship drops out of warp** along the orbit's top tangent (y 310), braking from about 6× down to exactly orbit speed.                                    |
| 1.15        | **Capture.** A white ring flash, a planet pulse and a 16-particle burst (purple and accent). The ship keeps orbiting clockwise, one lap per 2.4 s.          |
| 1.35–1.65   | "LEAP OF" rises in.                                                                                                                                         |
| 1.50–1.85   | "VOID" slams in (1.35× → 1× with a slight overshoot) with an accent glow.                                                                                   |
| 2.00–2.25   | "YOUR TURN." in the accent colour, on every clip type. The user rejected "BEAT <score>".                                                                    |
| 2.35–3.15   | **Orbit pill.** A spark traces the outline, then keeps orbiting it (one lap per 2.8 s). The text fades in at 2.55–2.80.                                     |
| 3.15 → 4.35 | Hold (`--hold`, default 1.2 s).                                                                                                                             |

**Layout** (1080×1920 px):

| Element      | Position and style                                                                          |
| ------------ | ------------------------------------------------------------------------------------------- |
| "LEAP OF"    | y 905: 54 px bold, tracking 26, 72 % white.                                                 |
| "VOID"       | y 1035: 180 px black weight, tracking 34.                                                   |
| "YOUR TURN." | y 1160: 54 px heavy, tracking 10.                                                           |
| Pill         | Centre y 1305, 440×150, fully rounded.                                                      |
| Pill text    | "Download from the" at 31 px medium, 55 % white. "App Store" at 58 px semibold, 85 % white. |

Everything sits within y 310–1380 and x 190–890. That keeps it clear of the
TikTok/Reels overlays: the top ~220 px, the bottom ~480 px, and the button
column at x > 950 below y 760.

**Pill brightness** (the user asked for it dimmed):

- outline: 32 % white, 3 px;
- accent glow: 7 %, 14 px wide;
- fill: 3.5 % white;
- spark: r 6.5 at 80 %, with a 35 % glow and a 40 % trail.

### 3.2 Per-clip data from the sidecar

- **Warp start.**
  - If the last try died: W = min(death + 1.65 s, the video's end). The
    1.65 s is the death card's 0.35 s delay, its 0.3 s fade, and 1 s to read
    it.
  - If the run is cut alive (pro): W = the video's end − 0.15 s. The last
    gameplay frame is held for the rest of the warp, where the zoom and fade
    hide the freeze.
  - Gameplay after the warp is dropped. For bad and decent clips, that's the
    rest of the held death card.
- **Zone colours:** `ZONES[floor(planetsPassed / 20) % 6]` of the last try,
  the same background the clip ended on.
- **Accent:** `HEAT_COLORS[heat]`.
  - For a run cut alive, `heat` is the heat of its last capture (pro:
    orange).
  - After a death it is 0 (cyan), because a death resets the ship.

Palettes and heat colours are imported from the game (`src/rendering/zones.ts`,
`src/game/constants.ts`), so the card can't drift from the game.
`zones.ts` currently gets `hexToRgb01` from `bgShader.ts`, which imports
Skia. That helper moves to a pure `src/rendering/color.ts`. There is no
behaviour change.

### 3.3 No App Store badge

Apple's marketing guidelines say "Don't modify, angle, or animate the App
Store badge", and the user didn't like how the black badge looks on the card.
Text is allowed instead of a badge, as long as it says "the App Store" with
standard capitalisation: never "APP STORE" and no stylised lettering. So the
button text is plain SF Pro, and only the button around it is styled and
animated.

### 3.4 Rendering: Remotion, whole clip in one composition

- **Remotion 4.0.529**, the version that was latest on 2026-09-27.
  - Every `remotion` / `@remotion/*` package is pinned to exactly that
    version, as Remotion requires.
  - `react-dom` is pinned to 19.1.0 to match the app's React.
  - These are dev-only dependencies. The app never imports them, so Metro
    never sees them.
  - Remotion's free licence covers individuals and companies of up to 3
    people.
- **One composition renders the whole clip.** It is built from three layers:
  - a background canvas (zone gradient, stars and streaks);
  - the gameplay video (`OffthreadVideo`, frame-exact, zoomed and faded
    during the warp);
  - a foreground canvas (planet, ship, particles, flash, text and pill).

  Rendering everything, rather than splicing a card onto the untouched
  gameplay, keeps every frame on one colour path, so there's no seam at the
  cut. Captions and hook clips will need a full render later anyway. The cost
  is render time: **70–85 s per clip** on this Mac (1,700–1,850 frames, about
  22–25 frames/s), which is fine for batches.

- **The gameplay goes in as an exact RGB copy.** Remotion's frame extraction
  reads the recorder's H.264 about 2/255 too dark on every channel. It
  matches ffmpeg's default yuv→rgb exactly, and that default rounds low; with
  `accurate_rnd` the decode is exact. `toneMapped={false}` makes no
  difference.
  - Before each render, the CLI decodes the clip once with accurate BT.709
    rounding into a lossless RGB video (`libx264rgb -qp 0`: about 4 s and
    ~15 MB per clip-second).
  - It stages that copy in the bundle's public dir, together with a sidecar
    copy that points at it, and deletes both after the render.
  - Remotion then has no yuv→rgb conversion to do.
  - Measured: a Remotion still of a gameplay frame goes from −2.3/255 to
    0.00 against the accurately decoded source.

- **The drawing is the approved mockup's Canvas 2D code**, ported to
  TypeScript as pure functions of (context, t, spec) in `draw.ts`, so what
  was approved is what renders.
  - Stars and particles are seeded (mulberry32(2026), like the home screen).
    That keeps every frame deterministic across Remotion's parallel tabs.
  - The background gradient is **dithered** with ±0.75/255 noise, like the
    game's background shader. The zone palettes are only a few 8-bit steps
    apart and would otherwise band.
- **Font:** the system SF Pro through `-apple-system`, which is the game's
  own iOS font. Chrome on macOS has it, so no font files ship.
- **Encoding:**
  - lossless PNG frames;
  - H.264 at crf 16, yuv420p, BT.709 (as the recorder does);
  - a muted render, because the audio mixer adds the sound (§3.5).

  Remotion converts RGB → YUV with zscale, which was measured to be unbiased.
  Acceptance checks that the gameplay frames still match the source.

### 3.5 Sound

The existing mixer (`scripts/clips/audio.ts`) does the audio, so the clip
keeps its −14 LUFS / −1.5 dBTP delivery spec. Remotion's own audio would
break it.

- The composed sidecar's timeline is the source timeline up to the end of
  the warp, plus `endCard` beat markers, plus the card's sounds as `sound`
  entries (`{ t, sample, rate, volume }`).
- The mixer plays `sound` entries exactly as written, so
  `bun run clip:audio clips/composed/<x>.json` re-mixes a composed clip too.
  (The draft plan passed extra cues to `addClipAudio()` instead, which would
  have lost them on a re-mix.)
- The ambient pad keeps playing under the card.

End-card cues all use the game's own samples. They sit in one list in
`endCard.ts`, so tuning after a listen is a one-line change.

| t    | Sound                                                         |
| ---- | ------------------------------------------------------------- |
| 0.00 | `flyby_2` at 0.7× (a low whoosh into the warp)                |
| 0.55 | `zone`: the game's "new zone" sting, used for the arrival     |
| 1.15 | `capture_1` at the top heat rate, plus `perfect`: the landing |

### 3.6 Outputs and CLI

```
bun run clip:compose [clip.json …] [--hold S] [--out DIR] [--silent] [--force]
bun run clip:studio        # Remotion Studio on clips/gameplay, for tweaking the card
```

- **With no arguments,** it composes every `clips/gameplay/*.json` that has
  no composed version yet. `--force` re-composes them.
- **Output:** `clips/composed/<same name>.mp4` plus `.json`.
- **Sidecar keys:**
  - `video`, `fps`, `seconds`;
  - `source` (the gameplay sidecar);
  - `endCard` (`warpStart`, `accent`, `zone`, `line`, `holdS` and each beat's
    time in the composed clip);
  - `timeline` (cut, plus `endCard` markers and `sound` entries);
  - `results` (copied from the source);
  - `take` (for the audio seed);
  - `audio`.
- **Files:** it renders to `*.partial.mp4`, checks the frame count, then
  renames.
- **Ctrl-C** cancels the render through Remotion's cancel signal, which is
  registered with `procs.ts`'s new `onAbort()`. It then deletes the partial
  file, the staged copy, the bundle and the temp dirs. Verified: nothing is
  left behind, including no Chrome processes.
- **Flags** are parsed in `compose/args.ts`, so tests don't load Remotion.
- **Exit codes** match the recorder:

  | Code | Meaning                           |
  | ---- | --------------------------------- |
  | 0    | all composed                      |
  | 1    | some failed                       |
  | 2    | usage error                       |
  | 3    | all composed, but some are silent |
  | 130  | interrupted                       |

### 3.7 Rejected

- **The official App Store badge** (§3.3).
- **Drawing the card in the app's clip mode.** It would add more dev-only
  code to the shipped app and to the replay handshake, for something that
  isn't gameplay.
- **Node canvas (`@napi-rs/canvas`) and ffmpeg pipes.**
  - For: it's faster, with no browser.
  - Against: SF Pro's weights are uncertain there, and every later composer
    feature (captions, hook clips, layout) would have to be hand-built.
    Remotion was already the planned composer.

## 4. Implementation steps

1. **Refactor.** Add `src/rendering/color.ts` (`hexToRgb01`), and update
   `zones.ts`, `bgShader.ts` and `HomeScreen.tsx`. Then run typecheck and the
   tests. The game is unchanged.
2. **Dependencies and scripts.** Add the Remotion packages and `react-dom`
   (`bun add -d`, exact versions), plus the `clip:compose` and `clip:studio`
   scripts.
3. **End-card model** in `scripts/clips/compose/endCard.ts`: the pure part.
   - beat times;
   - the warp-start rule;
   - zone and accent from a sidecar;
   - sound cues;
   - the composed timeline.

   Tests go in `endCard.test.ts`.

4. **Drawing and composition:**
   - `draw.ts` (the mockup port);
   - `EndCardClip.tsx`, `Root.tsx` and `index.ts` (registerRoot).
5. **Audio:** `soundCues()` plays `sound` timeline entries as written.
6. **CLI** `compose.ts`.
   - Bundle once for the whole run.
   - For each clip:
     1. stage the exact RGB copy and sidecar in the bundle's public dir;
     2. render;
     3. check the frame count;
     4. write the sidecar;
     5. mix the audio.
   - Handle signals and clean up.

All seven steps are ✅ done. 7. **Verify and document.** Compose the three current clips and check them
(§5). Update `AGENTS.md`, the strategy doc and this plan's status.

## 5. Testing and acceptance criteria

**Unit** (`bun test`):

- the warp-start rule: a death, a run cut alive, and a hold shorter than the
  card needs;
- accent and zone derivation;
- the composed duration;
- the timeline cut and cue times.

**End to end, on the three current clips:**

- 1080×1920 at constant 60 fps. The frame count is exactly the warp start
  plus 4.35 s of card (plus any `--hold` change).
- Gameplay frames before the warp match the source: sampled mean absolute
  difference ≤ 1/255 per channel.
- Audio is −14 ± 0.5 LUFS and ≤ −1.5 dBTP, and as long as the video.
- Stills at each beat match the approved mockup, with SF Pro rendering and
  nothing inside the overlay zones.
- Render time per clip is recorded here.

**Results (2026-09-27):**

| Check                     | Target                                            | Measured                                                                                                                     |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Unit tests                | pass                                              | 12 new tests pass; the full suite is 96/96                                                                                   |
| Size and frame rate       | 1080×1920, constant 60 fps                        | yes, all three                                                                                                               |
| Frames (warp start + 261) | exact                                             | bad 1440 + 261 = 1701 · decent 1583 + 261 = 1844 · pro 1443 + 261 = 1704                                                     |
| Gameplay vs source        | mean ≤ 1/255                                      | 0.10–0.42/255, with signed bias ≤ 0.04 (it was 2.0/255, all too dark, before the RGB copy)                                   |
| Audio                     | −14 ± 0.5 LUFS, ≤ −1.5 dBTP, same length as video | −14.2 / −14.2 / −14.4 LUFS, −2.8 to −2.9 dBTP, lengths equal to the frame                                                    |
| Stills                    | match the mockup                                  | yes: SF Pro, zone palette and accent per clip (cyan after a death, orange for the pro run), nothing inside the overlay zones |
| Render time               | recorded                                          | 71 / 82 / 74 s (bad / decent / pro)                                                                                          |

**The user's check:** watch the three composed clips and listen to the card's
sound. The arrival flash (50 % of the accent colour for 0.3 s) is the
strongest moment on screen. It's in the approved mockup, and one number in
`draw.ts` changes it.

## 6. Risks and later ideas

**Risks:**

- **Remotion under bun.** A render script may not exit on its own
  (documented), so the CLI exits explicitly. If bundling under bun misbehaves,
  run the CLI with node.
- **Fonts.** Headless Chrome might fall back from SF Pro. The stills check
  catches it.
- **Colour.** A shift from the browser round trip is caught by the frame-diff
  check. One was found and fixed (§3.4). `bun run clip:studio` previews
  straight from the H.264 files, so its gameplay looks ~2/255 darker than the
  final render.
- **Remotion upgrades.** All `@remotion/*` versions must move together.
  Re-run the frame-diff check after an upgrade, because Remotion 5 changes
  colour-space defaults.

**Later ideas:**

- The ship enters from the side the last ship left through (most bad-clip
  deaths leave through a side edge).
- A/B copy variants, such as "Search Leap of Void".
- The persistent name tag and hook captions (the next composer plan).
