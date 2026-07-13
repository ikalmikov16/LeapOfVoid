# Pre-Ship Gameplay Tuning — Bigger Orbits, Longer Jumps, Wider Spread

Status: Done (numbers may still shift after device playtest)

Measured after implementation (5 seeds, ~790 hops): 58% of consecutive hops
land on the opposite half of the screen, mean sideways offset 126px, mean
jump 312px.

## Goal

The game stops feeling cramped and fiddly once the early ring boost fades.
Orbits are comfortably big at baseline; difficulty comes from longer jumps and
more precise aim instead of tiny rings; and the planet chain sweeps left and
right across the screen instead of climbing a near-vertical ladder.

## Scope

**In**

- Retune ring size constants so today's ~1.3× boosted ring becomes the new 1×.
- Shift the difficulty curve from ring-shrink toward jump-distance growth.
- Widen the placement cone and add a seeded "swing" bias so consecutive
  planets regularly land on opposite halves of the screen.
- Update unit tests for the new curves and add a spread test.

**Out** (v2 parking lot unchanged)

- No new mechanics, no orbit-radius-from-graze, no changes to scoring,
  decay behavior, zones, or effects.
- No change to orbit angular speed (revolution time stays ~2.7s).

## Design decisions

1. **Difficulty = width/distance ratio.** The release window is roughly
   (target band width) / (jump distance). We keep that ratio generous early
   and tighten it late mostly by _stretching distance_, not shrinking rings.
   Long jumps read as dramatic on video; thin rings read as unfair.
2. **Bake the boost in.** `BAND_START` 38 → 48 (≈ today's 1.3×), and the
   early boost drops to a gentle 1.15 onramp so the first planets aren't
   comically huge on top of the new baseline.
3. **Bigger rings force longer minimum jumps.** Two ~80px rings plus the
   14px gap need ~175px of separation, so `JUMP_MIN_BASE` must rise with the
   rings or generation would thrash and fall back to straight-up placement.
4. **Spread via cone + swing, not full randomness.** A wide cone alone still
   produces many near-vertical placements (uniform angle clusters near 0).
   A seeded swing chance that aims at the far half of the screen guarantees
   the right→left→middle rhythm without making placement chaotic.

## Constant changes (`src/game/constants.ts`)

| Constant                    | Now         | New          | Why                                                   |
| --------------------------- | ----------- | ------------ | ----------------------------------------------------- |
| `BAND_START`                | 38          | 48           | today's boosted ring becomes baseline                 |
| `BAND_MIN`                  | 14          | 20           | late game stays timeable; distance carries difficulty |
| `BAND_SHRINK_PER_PLANET`    | 0.18        | 0.12         | slower shrink                                         |
| `EARLY_RING_BOOST`          | 1.3         | 1.15         | gentle onramp over the bigger baseline                |
| `JUMP_MIN_BASE`             | 150         | 190          | fits the bigger rings (see decision 3)                |
| `JUMP_MAX_BASE`             | 210         | 270          | longer jumps from the start                           |
| `JUMP_MIN_GROWTH` / `_CAP`  | 0.7 / 40    | 1.0 / 70     | distance is now the main dial                         |
| `JUMP_MAX_GROWTH` / `_CAP`  | 1.5 / 90    | 2.5 / 180    | late jumps reach ~450px (~half a screen)              |
| `CONE_HALF_BASE`            | 0.35        | 0.85         | ±49° instead of ±20°                                  |
| `CONE_HALF_GROWTH` / `_CAP` | 0.008 / 0.4 | 0.006 / 0.25 | max ≈ ±63°                                            |
| `SWING_CHANCE` (new)        | —           | 0.3          | 30% of placements aim at the far half of the screen   |

## Implementation steps

1. **Constants + difficulty curves** — apply the table above
   (`src/game/constants.ts`; no signature changes in `src/game/difficulty.ts`).
   Game stays playable after this step alone.
2. **Swing bias in generation** (`src/game/generation.ts`) — in
   `generateNextPlanet`'s attempt loop: with probability `SWING_CHANCE`
   (seeded via `rand01(state)`), force the horizontal sign of the placement
   angle toward the half of the screen opposite `prev.center.x`, and sample
   the angle magnitude from the upper half of the cone. Otherwise sample as
   today. Fallback placement unchanged.
3. **Tests** — update `difficulty.test.ts` expectations for the new curves;
   add a `generation.test.ts` spread test (over a long seeded run, a healthy
   fraction of consecutive planets land on opposite halves of the screen);
   run the full suite + typecheck.

## Testing & acceptance criteria

- `bun test` and `bun run typecheck` pass.
- Unit: band at n=0 is 48; band never below 20; jumpMax(100) ≈ 450;
  spread test shows ≥ ~25% of consecutive pairs cross the screen midline
  over a 200-planet seeded run.
- On device: baseline (post-boost) orbits feel comfortably timeable; runs
  visibly zig-zag across the screen; long late-game jumps feel tense but
  aimable with the dashed line; generation never visibly stalls or stacks
  planets straight up.
