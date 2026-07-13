# M2 — Procedural Generation, Camera Follow, Difficulty, Orbit Decay

**Status: Done** (implemented + unit-tested; difficulty numbers await on-device tuning)

## 1. Goal

Turn the M1 six-planet playground into the real endless game: an infinite
upward chain of procedurally placed planets, a camera that follows the climb,
difficulty that ramps as a function of planets passed, and decaying orbits so
camping on a planet kills you. After M2 the game is mechanically complete —
everything after this is presentation (M3) and packaging (M4/M5).

## 2. Scope

**In:**

- Infinite procedural planet chain (seeded, deterministic, testable)
- Camera follow with smoothing; culling of off-screen planets
- Difficulty dials as pure functions of `planetsPassed`
- Orbit decay + new "burned up" death cause
- Fair-start rule (generous first planets, decay grace period)
- Zone _arithmetic_ (zone index = planets ÷ 20) as a difficulty stepper —
  zone visuals/names are M3
- Engine unit tests for generation invariants, decay, and difficulty curves

**Out (explicitly):**

- Black hole chase (v1.5 per design doc), moving planets, asteroids (later dials)
- All juice: trails, particles, shake, haptics, SFX, zone hue shifts (M3)
- Combo/graze/perfect scoring systems (M3)
- Home/death-card/meta screens, persistence (M4)

## 3. Design decisions

### World & camera

- **World coordinates are absolute**; climbing means y decreases. The sim is
  camera-agnostic. Rendering applies a single translate of `-cameraY` to one
  Skia Group wrapping the world (planets + ball); HUD stays unaffected.
- **`cameraY` lives in `GameState`** and is stepped in the sim (pure,
  testable), not in the rendering layer. Exponential smoothing:
  `cameraY += (target - cameraY) * min(1, CAMERA_SMOOTHING * dt)`.
- **Camera target:** while orbiting, frame the current planet at ~65% screen
  height; while flying, track the ball so long shots stay visible.
  _(Implementation note: the camera only ever climbs — a downward shot never
  drags it back down, it just falls out of the viewport and dies. This keeps
  the lost-in-space check meaningful and the framing monotonic.)_
- **Death bounds move with the camera:** the ball is lost when it leaves the
  camera viewport by `OFFSCREEN_MARGIN` horizontally or vertically (replaces
  M1's static-screen check). Shooting downward/backward is thus fatal quickly,
  which matches the "always climb" fantasy.

### Procedural generation

- **Seeded RNG (mulberry32) inside `src/game/`** — pure TS, worklet-safe,
  reproducible in tests. Each run gets a random seed; tests use fixed seeds.
- Planets generate **ahead of the camera** (whenever the highest planet is
  less than ~1.5 screen-heights above the viewport top) and are **pruned**
  once ~1.5 screen-heights below the viewport bottom (never the current one).
  The array stays small (~10-15 planets); planet ids keep increasing.
- **Placement of the next planet** relative to the previous:
  - polar offset: distance in `[minJump(n), maxJump(n)]`, angle within a cone
    around straight-up (cone widens with difficulty for zig-zag routes);
  - x clamped so the full ring stays within screen width minus margin;
  - resample (bounded retries) until the new planet's ring clears every
    retained planet's ring by `PLANET_GAP`, and the straight corridor between
    consecutive planet centers is not blocked by any other planet's body.
    Corridor clearance is what keeps every jump honestly makeable.
- Reachability is otherwise guaranteed by geometry: tangent release angles
  cover every direction, so any non-occluded planet within jump range can be
  grazed. This invariant gets a test, not a runtime check.

### Difficulty dials (all pure functions of `planetsPassed`, in one module)

| Dial                           | Start            | Trend (starting values, tune on device) |
| ------------------------------ | ---------------- | --------------------------------------- |
| Capture band width (main dial) | ~34px            | shrink ~0.3px/planet, floor 14px        |
| Planet body radius             | 20–28px random   | slight growth of the random range       |
| Orbit angular speed            | 2.6 rad/s        | +0.02/planet, cap 4.0                   |
| Jump distance range            | 150–210px        | stretch toward 190–300px                |
| Placement cone width           | narrow           | widens (forces sideways detours)        |
| Orbit decay rate               | 0 until planet 3 | then ~6 px/s, +slow growth, cap ~14     |

- Dials step up at **zone boundaries (every 20 planets)** in addition to the
  smooth per-planet trend, so zones feel meaningfully different (readies M3).
- **Fair start:** planets 0–4 use the widest bands; decay disabled for the
  first 3 planets and the first ~2s after every capture (grace window).

### Orbit decay

- Capture snaps the ball to `ringRadius` (unchanged v1 rule); a new
  `orbitRadius` field on `GameState` then shrinks at `decayRate(n)` px/s.
- **Burn-up:** `orbitRadius <= planet.radius + BALL_RADIUS` → death, new
  cause `'burned'` ("BURNED UP IN ORBIT" on the death overlay).
- Release velocity magnitude stays `FLIGHT_SPEED` regardless of radius;
  release direction uses the tangent at the decayed radius. Capture geometry
  of _other_ planets is untouched (band stays `[radius, ringRadius]`).
- Rendering: the current planet shows the live decaying orbit circle
  (derived value); all planets keep their faint static capture ring.

### State/type changes

- `GameState`: + `cameraY`, `orbitRadius`, `planetsPassed` (== score for now),
  `rngState`, `nextPlanetId`, `graceUntil`; `deathCause` gains `'burned'`.
- `Planet`: unchanged shape; ids grow monotonically as the chain extends.
- `planets` array is now mutated by generation/pruning — done by replacing
  the array (never in-place) to respect the copy-then-mutate frame contract.

## 4. Implementation steps (game stays playable after each)

1. **Camera follow** — add `cameraY` + smoothing to engine; wrap world in a
   translated Group; extend the static M1 layout upward a few screens to test.
   Touches: `types.ts`, `constants.ts`, `engine.ts`, `GameCanvas.tsx`.
2. **Generator** — seeded RNG, placement sampling with invariants,
   generate-ahead/prune, camera-relative lost-in-space; delete the static
   layout. Touches: new `src/game/generation.ts`, `engine.ts`, `constants.ts`.
3. **Difficulty module** — `src/game/difficulty.ts` with all dial functions;
   generator and orbit code read from it. Touches: `generation.ts`, `engine.ts`.
4. **Orbit decay** — `orbitRadius` decay, burn-up death, grace windows,
   decayed-ring rendering, death overlay copy. Touches: `engine.ts`,
   `GameCanvas.tsx`, `GameScreen.tsx`.
5. **Tests** — generator invariants over 500+ planets on fixed seeds (spacing,
   x-bounds, corridor clearance), decay burn-up timing, difficulty
   monotonicity, camera convergence.

Worklet reminder: keep every new engine/generation function callees-first
(see game-architecture rule) — this is the constraint that hard-crashed M1.

## 5. Testing & acceptance criteria

- `bun test` green, including new generation/decay/difficulty suites.
- On device: play 3+ runs past planet 30 —
  - no impossible or off-screen jumps ever;
  - camera never jerks or loses the ball;
  - camping on any orbit past planet 3 kills you (visibly telegraphed);
  - difficulty at planet 30 is noticeably harder than planet 5;
  - restart still instant; steady 60fps (no allocation growth per frame).
- A fixed seed replays the same planet chain (determinism check).
