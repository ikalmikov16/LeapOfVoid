# Leap of Void — Agent Guide

One-touch endless orbit-hopping mobile game (React Native + Expo + Skia), iOS first.

**Read `orbit-game-plan.md` before making design or gameplay decisions.** It is the
settled design doc: capture-by-closest-approach geometry, decaying orbits, scoring,
difficulty dials, and the milestone roadmap. Decisions there are final unless the
user says otherwise.

## Commands

This repo uses **bun** (lockfile: `bun.lock`) — never npm/yarn/pnpm.

- `bun start` — Expo dev server (scan QR with Expo Go on a real device)
- `bun run ios` — dev server + open iOS simulator
- `bun run typecheck` — `tsc --noEmit` (run after every change)
- `bun test` — game-logic unit tests (pure `src/game/` code runs under bun directly)
- `bun run clip --skill bad|decent|pro [--count N]` — bot-played gameplay clips recorded
  from the simulator → `clips/gameplay/*.mp4` with the game's audio (`--silent` for none;
  needs ffmpeg ≥ 5.1; `--help` for flags). bad = fail montage, decent = a few tries, pro =
  mid-run highlight. `bun run clip:audio <clip.json>` re-mixes audio; `bun run clip:take
--stats 150` shows how each profile plays. See `plans/gameplay-recorder.md` and
  `plans/clip-styles.md`.
- `bun run clip:compose [clip.json …]` — finished clips with the end card (warp → icon planet →
  LEAP OF VOID → YOUR TURN. → "Download from the App Store"), rendered with Remotion →
  `clips/composed/`; no args = every gameplay clip not composed yet (`--hold S`, `--silent`,
  `--force`). `bun run clip:studio` previews/tweaks the card live. See `plans/clip-composer.md`.

## Stack

Expo SDK 54 / RN 0.81 / React 19 / TypeScript strict — **pinned to SDK 54** because
that's what the App Store build of Expo Go supports (see expo-conventions rule).
Rendering:
`@shopify/react-native-skia` (one canvas). Frame loop: `react-native-reanimated`
`useFrameCallback`. App state: zustand. Persistence: AsyncStorage.
`expo-haptics`, `expo-audio`. No physics engine — pure circle/line geometry.

Expo APIs change between SDK versions: verify against
https://docs.expo.dev/versions/v54.0.0/ instead of trusting memory.
Install native deps with `bunx expo install`, not bare `bun add`.

## Structure

```
src/
  game/       pure TS simulation — no React/Skia/Reanimated imports
  rendering/  Skia drawing of game state (canvas, particle effects, zone palettes)
  screens/    React screens (Game, Home, Death overlay)
  audio/      SFX playback (expo-audio players)
  effects/    haptics
  state/      zustand stores (screen, settings, best score) — never per-frame data
  clip/       recorder-only clip mode (replays bot takes); inert (no-op hook) unless
              EXPO_PUBLIC_CLIP_MODE=1 — never ships enabled
scripts/clips/  the gameplay bot + simulator recorder (`bun run clip`); compose/ = the
                Remotion end-card composer (`bun run clip:compose`, dev-only deps)
assets/sfx/   generated WAVs — regenerate with `bun run sfx` (scripts/generate-sfx.ts)
plans/        per-milestone implementation plans (write BEFORE implementing;
              see the planning rule)
```

## Hard constraints

- Portrait locked, designed for 9:16 vertical video capture.
- Gameplay input is a single tap anywhere. Nothing else.
- No per-frame React state or allocations in the frame loop.
- All tuning numbers in `src/game/constants.ts`; difficulty = pure functions of planets passed.
- v1 scope only — no ads, skins, leaderboards, black hole (see plan §9 parking lot).
