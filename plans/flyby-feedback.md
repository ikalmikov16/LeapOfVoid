# Heat — Skip-Driven Scoring Multiplier + Flyby Feedback

Status: Done (feel/mix tuning pending device playtest)

## Goal

Skipping planets becomes the core scoring engine and a felt event. Each
planet flown past mid-jump ticks (haptic + rising ping) and heats the ball —
glow shifting cyan → orange → red like a comet. Heat is a persistent score
multiplier (up to ×5) that camping slowly cools; quick and perfect jumps are
flat bonuses that heat multiplies. The comet visual, the HUD ×N badge, the
trail intensity, and the score math are all one variable.

## Scope

**In**

- Engine: flyby detection during flight; `heat` replaces `comboLinks`;
  scoring formula rework; per-revolution cooling.
- Haptic tick + pitched SFX per flyby; capture pluck pitch keyed to heat.
- Ball glow/trail heat colors, flyby glow pop, HUD badge = ×(1 + heat).
- Unit tests for detection, heat accounting, cooling, and the new scoring.

**Out**

- `planetsPassed` / difficulty / zones untouched (still id-based altitude).
- No death-rule changes; no new screens; no parking-lot items.

## Design decisions

1. **One heat variable, four consumers.** Score multiplier, ball/trail
   color, HUD badge, and SFX pitch all read the same 0–4 `heat`. The comet
   look is the multiplier gauge — no new UI.
2. **Flyby = "cleared the ring top"** (`ballPos.y < center.y − ringRadius`,
   only `id > planetsPassed`, never the departed planet). Past that line the
   planet can no longer capture you, so the tick never fires for the planet
   you land on. Heat increments at the flyby moment (live mid-flight), so
   feedback and payout can never disagree.
3. **Scoring: `(1 + bonuses) × (1 + heat)`** per capture, where bonuses are
   quick release +1 (`QUICK_POINTS`, window still 0.75 revolutions),
   perfect +2, graze +1. `SKIP_POINTS` and the quick-streak multiplier are
   deleted — skips pay through heat, quicks are the flat "extra point".
   Captures at/below the high-water mark still score zero (no farming).
4. **Cooling: heat is momentum.** −1 per _half_ revolution orbited, and −1
   on any landing that skipped nothing (after the payout — you cash the
   multiplier you arrived with). Holding ×5 requires skipping on nearly
   every hop; coasting or camping bleeds it away. (Tightened from 1
   revolution/no landing tax after playtest: ×5 was too easy to reach and
   keep. Quick window also tightened 0.75 → 0.5 rev, perfect band 0.25 →
   0.15, graze margin 8 → 5.)
5. **Hierarchy check**: plain hop 1 · quick 2 · quick perfect 4 · same at
   1 heat 8 · at full red ×5 = 20. Skips dominate, quick/perfect are the
   clear second tier, and they compound — the intended "best play".

## Constant changes

| Constant                         | Now  | New                                     |
| -------------------------------- | ---- | --------------------------------------- |
| `PERFECT_POINTS`                 | 3    | 2                                       |
| `GRAZE_POINTS`                   | 2    | 1                                       |
| `QUICK_POINTS` (new)             | —    | 1                                       |
| `SKIP_POINTS`                    | 2    | deleted                                 |
| `COMBO_MULTIPLIER_CAP`           | 5    | `HEAT_MAX = 4` (multiplier ×5)          |
| `COMBO_WINDOW_REVOLUTIONS`       | 0.75 | renamed `QUICK_WINDOW_REVOLUTIONS`      |
| `HEAT_COOL_REVOLUTIONS` (new)    | —    | 1                                       |
| heat colors / pulse timing (new) | —    | cyan → `#FFB86B` → `#FF5C3A`, pop ~0.3s |

## Implementation steps

1. **Engine** (`types.ts`, `engine.ts`, `constants.ts`): replace
   `comboLinks` with `heat`; add `lastFlybyAt`; flyby detection in
   `stepFlight`'s no-event path (+1 heat, stamp); cooling thresholds in
   `stepOrbit`; new capture scoring; quick bonus in `release`→capture
   handoff. Tests updated in the same step — the sim must stay green.
2. **SFX/haptics**: airy tick WAV in `scripts/generate-sfx.ts` + regenerate;
   `sfxFlyby(heat)` pitch rise; `hapticFlyby()` selection tick; capture
   pluck pitch keyed to heat.
3. **Wiring** (`GameScreen.tsx`): reaction on `lastFlybyAt` → tick; combo
   badge/reaction becomes heat badge, tinted by heat.
4. **Visuals** (`GameCanvas.tsx`, `effects.tsx`): ball glow color/size and
   trail tint from `heat / HEAT_MAX` (fade over ~0.8s handled by cooling —
   plus glow pop from `lastFlybyAt`); trail heat keyed off `heat` instead
   of `comboLinks`.

## Testing & acceptance criteria

- `bun test` + `bun run typecheck` pass.
- Unit: two-flyby flight ends at heat 2 and pays ×3 on capture; the
  captured planet never ticks; backward hops generate no heat and no
  points; a full camped revolution drops heat by 1; quick/perfect/graze
  bonuses multiply correctly; heat caps at 4.
- Device: skips tick under the thumb and visibly heat the ball; red-hot
  chains feel like the jackpot; no heat flicker on ordinary hops.
