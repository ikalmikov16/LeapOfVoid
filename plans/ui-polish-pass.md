# UI Polish Pass — Home / Pause / Death + Warp Transition

**Status: Implemented** (on-device verification of the acceptance list pending)

## 1. Goal

The three meta surfaces feel intentional instead of assembled: the home
screen is clean (settings behind a gear, a living orbit vignette teaching the
mechanic), the pause overlay has a clear hierarchy (RESUME dominant, QUIT
demoted and safe), the death card can be spam-tapped for retry without ever
hitting SHARE/HOME, and moving from home into a run plays a ~0.8 s "warp"
zoom that sells traveling through space. No new dependencies.

## 2. Scope

**In:**

- Home: settings gear (top-right) → settings overlay (SFX / MUSIC / HAPTICS
  pills + close), bottom pill row removed, decorative orbiting-ball planet,
  pulsing "tap to start" hint.
- Pause: RESUME (hero) → toggles row → QUIT (small, bottom, replaces HOME).
- Death: SHARE and HOME move to the screen's bottom corners, outside the
  retry tap zone; center is 100 % tap-to-retry.
- Transition: home zooms past the camera on start (scale ~1→2.5 + fade,
  ~450 ms), game enters scaling ~0.92→1 with a fade (~350 ms).
- Shared `TogglePill` component (three usages now: home settings, pause).

**Out (explicitly):**

- Navigation/safe-area libraries, icon fonts or SVG assets (the gear is a
  text glyph "⚙", consistent with the text-only aesthetic).
- Quit/exit confirmation dialogs (QUIT is deliberate enough by position).
- Home parallax, skins, any death-card "continue" work (slot stays).
- Transition SFX (a whoosh belongs to the parked burn-sound revisit).

## 3. Design decisions

- **Pause exit = QUIT, not HOME.** Same action (back to home screen), honest
  label: it abandons the live run. Bottom-of-overlay placement + small size
  make it deliberate; RESUME keeps the visual mass.
- **Death buttons at the bottom corners.** Retry is the reflex action, so
  reflexes must never reach a button: corners are outside natural spam-tap
  territory, and the full center (including where the buttons used to be)
  becomes retry surface. Buttons stay small/dim — SHARE left, HOME right.
- **Settings as overlay, not a screen.** No store `screen` change: local
  state on HomeScreen, dark backdrop, the three pills, tap-outside or ✕ to
  close. The `Screen` type stays `'home' | 'game'`.
- **Home vignette = the game's first tutorial.** A small planet with a ball
  orbiting it (Skia, one `withRepeat` clock driving the angle) sits below
  the title. It's decorative, but it *is* the mechanic — a first-time player
  has seen an orbit before their first run. Ball uses the cold heat color.
- **Warp transition is two one-sided animations.** Home and game share no
  scene graph, so continuity is faked with motion direction: home scales
  toward the viewer (1→2.5) while fading — "we flew past it" — then the game
  mounts scaling 0.92→1 — "we arrive, decelerating". Home owns its exit
  (shared values + `withTiming`, `runOnJS(setScreen)` on completion, taps
  disabled during); game owns its entrance (mount-time animation on the root
  view). A `TRANSITION` constants block in `constants.ts` holds the timings.

## 4. Implementation steps (game stays playable after each)

1. **Shared pills** — `src/screens/ui.tsx`: `TogglePill` + shared pill
   styles; swap into HomeScreen + pause overlay.
2. **Death layout** — `GameScreen.tsx`: corner-pin SHARE/HOME, grow retry
   surface.
3. **Pause hierarchy** — `GameScreen.tsx`: QUIT bottom placement/label.
4. **Home rework** — `HomeScreen.tsx`: gear + settings overlay, remove pill
   row, orbit vignette on the existing canvas, hint pulse.
5. **Warp transition** — `HomeScreen.tsx` exit animation, `GameScreen.tsx`
   entrance animation, `constants.ts` timings.

## 5. Testing & acceptance criteria

- `bun run typecheck` + `bun test` green (no game-logic changes).
- On device:
  - death: spam-tapping retry from any natural thumb position never hits
    SHARE/HOME; both still work when aimed at;
  - pause: RESUME is the obvious action; QUIT works, reads as secondary;
  - home: gear opens/closes settings; toggles work and persist; orbit
    vignette animates at 60 fps; no pills at the bottom;
  - transition: tap-to-start plays the warp both ways (out of home, into
    game) with no flash of unanimated frames; game is immediately playable
    when the entrance settles; feels like one continuous motion;
  - a muted 9:16 clip of home → run start looks like a deliberate sequence.
