# Pause Screen, SFX/Music Split, Planet Progress Markers

**Status: Implemented** (on-device verification of the acceptance list pending)

> Amends one settled constraint, with the user's explicit request: gameplay
> gains a single small pause hotspot in the top-right corner. Everything else
> about one-touch input stays: tap anywhere else = release, nothing else.

## 1. Goal

The game can be paused mid-run from a small corner hotspot (and pauses itself
when the app is backgrounded), showing an overlay with resume, home, and
audio/haptics toggles. The single sound toggle splits into SFX and Music
(music = the ambient bed), available on both the home screen and the pause
overlay. During a run, every 10th planet carries a faint numbered altitude
line so players always know how deep they are without cluttering the HUD.

## 2. Scope

**In:**

- Pause: corner hotspot inside the existing tap gesture, sim freeze, overlay
  (RESUME / toggles / HOME), auto-pause on app background.
- Settings split: `soundEnabled` → `sfxEnabled` + `musicEnabled` (persisted,
  legacy value migrates into both), three pills on home + pause.
- Milestone markers: dashed world-space line + number at every 10th planet.

**Out (explicitly):**

- planetsPassed counter in the HUD (rejected — see decision below).
- Resume countdown (3-2-1). Runs restart in under a second; if resuming
  mid-flight proves unfair on device, revisit then.
- Pause during the death overlay (death already has its own screen).
- Any new gameplay input beyond the one hotspot.
- Music volume sliders, separate music tracks (v2 territory).

## 3. Design decisions

### Pause trigger: a reserved hotspot, not a new input system

The one-touch constraint bends as little as possible: `Gesture.Tap`'s
`onBegin` already receives tap coordinates, so a ~56 px square in the
top-right corner is checked first — inside it, pause; everywhere else,
release. One input path, no gesture racing, no Pressable overlaying the
canvas. The glyph ("II") renders dim and small so it stays invisible in
muted vertical clips. While paused (or dead) the game tap gesture is
disabled and the overlay's Pressables own input.

### Pause freezes the sim by skipping steps — `paused` never enters GameState

The frame callback simply doesn't call `stepGame` while a `paused` shared
value is true. The sim stays pure (no pause concept in `src/game/`), every
time-based visual freezes for free because `state.time` stops advancing, and
resume is instant. The first post-resume frame's large `timeSincePreviousFrame`
is already handled by the existing `MAX_FRAME_DT_S` clamp. Auto-pause hooks
`AppState` (`active` → anything else) and only engages while orbiting/flying.

### Audio split: `sfxEnabled` + `musicEnabled`

- Store keys `lov:sfx` / `lov:music`; hydration migrates the legacy
  `lov:sound` value into both if the new keys are absent, so an existing
  muted player stays muted.
- Consumers: `sfx.ts` voice pools and the parked `burn.ts` check `sfxEnabled`
  at trigger time; `ambient.ts` subscribes to `musicEnabled` (a loop must
  react immediately, not at trigger time).
- Home screen: three pills — SFX / MUSIC / HAPTICS. Pause overlay: the same
  three, same behavior. One shared `TogglePill` stays out of scope; the pill
  styles are ~10 lines and screens differ, duplication is fine at this size.

### Progress markers: altitude lines every 10 planets (not a HUD counter)

Two options were considered; the user asked for a recommendation:

- **HUD counter next to the score — rejected.** The big score is the hero
  number in clips and the ×N heat badge already sits under it; a second
  number dilutes both. planetsPassed is also already on the death card.
- **World-space altitude lines — chosen.** Every planet whose id is a
  multiple of 10 gets a faint dashed line across the screen at its center
  height, with the number beside it. Progress reads spatially (you climb
  past markers), complements the every-20 zone flashes, and makes clips
  legible ("they're at 40 now"). Free data-wise: planet ids are chain
  ordinals already mirrored to React via the `planets` window.

Rendering: inside the existing world-transform group in `GameCanvas` (camera
only translates y, so a full-width line needs no x logic). The number uses
Skia `Text` with `matchFont` on a system font — no font asset to bundle.
Constants (`MILESTONE_INTERVAL = 10`, line/label opacity) go in
`constants.ts`.

## 4. Implementation steps (game stays playable after each)

1. **Audio split** — `appStore.ts` (fields, toggles, keys, hydrate
   migration), `sfx.ts`, `ambient.ts`, `burn.ts`, `HomeScreen.tsx` pills.
2. **Milestone markers** — `constants.ts`, `GameCanvas.tsx`.
3. **Pause core** — `GameScreen.tsx`: `paused` shared value + React mirror,
   hotspot check in the tap gesture, frame-callback skip, pause glyph.
4. **Pause overlay + auto-pause** — overlay UI (RESUME / SFX / MUSIC /
   HAPTICS / HOME) reusing death-card styling, `AppState` listener.

## 5. Testing & acceptance criteria

- `bun run typecheck` + `bun test` green (sim untouched; no new game logic
  to unit-test — this is UI/state/rendering work).
- On device:
  - tap the corner → pause; everything on screen freezes (trail, glow,
    aim line), no SFX fire while paused; resume continues exactly where it
    left off; camping decay does not tick while paused;
  - background the app mid-flight → paused on return;
  - pause hotspot never triggers a release, and taps just outside it do;
  - SFX off silences pops/plucks but the ambient keeps playing; MUSIC off
    kills the ambient immediately (home and pause both); settings persist
    across relaunch, and a previously muted install stays fully muted;
  - milestone lines visible at 10/20/30…, readable but dim, no frame drops;
  - a muted 9:16 clip still reads clean — the pause glyph and lines don't
    draw the eye.
