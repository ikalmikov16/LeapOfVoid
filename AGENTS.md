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
  rendering/  Skia drawing of game state
  screens/    React screens (Game, Home, Death overlay)
  state/      zustand stores (screen, settings, best score) — never per-frame data
```

## Hard constraints

- Portrait locked, designed for 9:16 vertical video capture.
- Gameplay input is a single tap anywhere. Nothing else.
- No per-frame React state or allocations in the frame loop.
- All tuning numbers in `src/game/constants.ts`; difficulty = pure functions of planets passed.
- v1 scope only — no ads, skins, leaderboards, black hole (see plan §9 parking lot).
