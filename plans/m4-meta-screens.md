# M4 — Meta: Home Screen, Death Card, Settings, Best-Score Persistence

**Status: Done** (implemented; persistence/share/toggles need an on-device check)

## 1. Goal

Wrap the finished game loop in the thin meta layer a shipped game needs: a
home screen (title, best score, tap to start, sound/haptics toggles), an
upgraded death card (score, best, NEW BEST moment, share), and best-score
persistence across launches. After M4 the app is feature-complete for v1 —
M5 is packaging (icon, branding, EAS build, store listing).

## 2. Scope

**In:**

- Home screen: title, best score, "tap to start", sound + haptics toggles
- Screen switching (home ↔ game) via a zustand store
- Death card upgrade: best score line, NEW BEST callout, share button,
  home button, layout room reserved for a future "continue" slot
- Best score persisted with AsyncStorage; hydrated at launch
- Settings (sound/haptics) persisted; SFX + haptics modules respect them
- Simple text share via React Native's built-in `Share` API (no new deps)

**Out (explicitly):**

- Ads / rewarded continue (post-launch; we only reserve dead space for it)
- Screenshot/replay sharing (v1 shares text; clips come from screen capture)
- Pause menu, stats page, daily challenge, leaderboards (v2 parking lot)
- App icon/splash/branding (M5)

## 3. Design decisions

### Screens: home is a screen, death is not

- A zustand `screen` store holds `'home' | 'game'`. `App.tsx` renders one or
  the other. No navigation library — two screens, one boolean, zero deps.
- **The death card stays an overlay inside GameScreen** (as today). Restart
  must stay < 1s and one tap; unmounting/remounting the canvas between runs
  would risk that. Death card gains a small home button to exit to the
  home screen; tap-anywhere-else still restarts instantly.
- Cold start lands on home — still "instant play" (one tap to be in the run,
  no menus in between).

### State stores (all in `src/state/`, per the architecture rule)

- `useAppStore` (one store, three slices — small enough not to split):
  `screen`, `bestScore`, `soundEnabled`, `hapticsEnabled`, plus actions.
  **Never per-frame data** — the store is written on discrete events only
  (death, toggle, screen change).
- **Best score = points** (the big HUD number), not planets passed — it's the
  number players watched all run. Written on death from GameScreen's existing
  phase reaction: `if (score > bestScore) setBest(score)`.
- Persistence: AsyncStorage, keys `lov:best`, `lov:sound`, `lov:haptics`.
  Fire-and-forget writes in the store actions; hydrate once at app launch
  (async — home shows 0 for a few ms on very first ever launch, invisible in
  practice). No persistence library; three keys don't need one.

### Sound/haptics gating

- `sfx.ts` and `haptics.ts` check `useAppStore.getState()` at call time
  (they're already JS-side, called via runOnJS). One-line guard per function;
  the UI-thread game code never touches settings.

### Home screen look

- Same visual language as the game: dark gradient + starfield (reuse the
  existing Skia starfield pattern), "LEAP OF VOID" title, "BEST {n}",
  "tap to start" hint, two small toggle pills (sound / haptics) in a corner.
- Toggles are the only tap targets that don't start the game; tapping
  anywhere else starts a run.

### Death card

- Adds under the score: "BEST {n}", or a bright "NEW BEST" flash when the
  run just beat it (the clip moment — new-best runs are the ones players
  post). New best is computed against the _pre-run_ best.
- Share button: `Share.share({ message })` with score + a hashtag — e.g.
  "I scored 87 in Leap of Void 🕳️ #leapofvoid". Button, not tap-anywhere
  (mis-shares would be worse than mis-restarts).
- A visually empty row is reserved between score and retry hint where the
  rewarded "CONTINUE" button will land post-launch (per design doc §7).

## 4. Implementation steps (game stays playable after each)

1. **Store + persistence** — `src/state/appStore.ts` (zustand + AsyncStorage
   hydrate/write-through); write best score on death from GameScreen's phase
   reaction. Touches: new `appStore.ts`, `GameScreen.tsx`, `App.tsx` (hydrate
   on mount).
2. **Death card upgrade** — best/NEW BEST lines, share button, home button,
   continue-slot spacing. Touches: `GameScreen.tsx`.
3. **Home screen** — `src/screens/HomeScreen.tsx` + screen switching in
   `App.tsx`; audio init moves to App so it's ready before the first run.
   Touches: new `HomeScreen.tsx`, `App.tsx`, `GameScreen.tsx`.
4. **Settings toggles + gating** — toggle pills on home; guards in `sfx.ts`
   and `haptics.ts`. Touches: `HomeScreen.tsx`, `sfx.ts`, `haptics.ts`.

## 5. Testing & acceptance criteria

- `bun run typecheck` and `bun test` stay green (meta layer is thin React —
  the sim's test suites are untouched; store logic is trivial enough that
  on-device verification covers it).
- On device:
  - kill + relaunch the app → best score survives; toggles survive;
  - beat your best → NEW BEST shows on the death card; doesn't show otherwise;
  - sound off actually silences everything; haptics off stills every buzz;
  - share sheet opens with the right text; canceling it doesn't restart the run;
  - home → game in one tap; death → retry still instant (< 1s, tap anywhere);
  - death → home button works; home shows the updated best immediately.
