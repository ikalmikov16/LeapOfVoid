# Tuning Pass 1 — Post-M3 Playtest Feedback

**Status: Done** (awaiting playtest confirmation of the new curve)

Driven by the first real playtest (20-minute session, best run ~20 jumps):
captures felt straight-on-or-nothing, combos unreachable, zone change never
seen, rings visually uniform, skips unrewarded.

## 1. Goal

Same game, fairer early curve and more readable rewards: easier first ~15
planets, reachable combos, skips that count (for difficulty AND points),
visibly varied ring sizes, and a zone change players actually notice.

## 2. Changes

### Early-game easing (constants only)

| Dial | Was | Now | Why |
|---|---|---|---|
| Orbit speed base | 2.6 rad/s | 2.3 | Release timing window ~13% wider |
| Planet body radius | 20–28 | 17–25 | Crash zone smaller relative to band |
| Band start | 34 | 38 | More forgiving early corridor |
| Band shrink / planet | 0.25 | 0.18 | Slower difficulty ramp |

### Combo reachability

- Window: 0.5 → **0.75 revolutions** (playtest showed real players wait full
  revolutions to aim; always-on multiplier was an expert-play fear).
- Multiplier: `min(1 + links, 5)` — the **first** quick hop already shows ×2.

### Skips count (design fix, not just a bonus)

Planet ids are chain ordinals, so:

- On capture of planet `id > planetsPassed`: `planetsPassed = id` (difficulty
  and zones now track *altitude*, not capture count), and each skipped planet
  pays `SKIP_POINTS = 2` on top of the capture points.
- Capturing a planet at or below your high-water mark (jumping backward, or
  re-grabbing the start planet) is a safety net worth **zero points** — this
  also closes the bounce-between-two-planets score farm that existed since M1.
- Optional follow-up (not in this pass): floating "+N" text on skip captures.

### Ring variety (generation)

Per generated planet, the band gets a seeded jitter before building the ring:

- 10% chance: **giant ring** — band × 1.6 (the occasional big one);
- otherwise: band × uniform[0.85, 1.25];
- floored at `BAND_MIN`; body radius stays independent, so small planets can
  out-ring big ones. The shrink-with-altitude trend is untouched.
- Placement/corridor validation already uses real ring radii — no other code
  changes.
- **Follow-up (same pass):** early-game ring boost — bands run ×1.3 at planet
  0, easing linearly to ×1 by planet 12, applied *under* the jitter. Early
  orbits are big on average but can still roll small; late ones tight but
  sometimes giant. The start planet always gets the full boost, un-jittered
  (a run should never open on a cramped ring).

### Zone visibility

- Skip-counting + easier early game makes planet 20 actually reachable.
- Zone name flash: bigger (34pt), longer (3s).
- Non-void palettes brightened so the background shift reads on a phone.

## 3. Testing & acceptance

- Updated engine tests (multiplier arithmetic, window timing at 2.3 rad/s,
  zone boundary via planet id) + new: skip scoring/planetsPassed jump,
  zero-point revisits, ring variance across a seeded chain.
- On device: first-session runs should reach 10+ planets; ×2 appears on the
  first quick hop; a 20-minute session should see EMBER FIELD at least once;
  rings visibly vary; a big skip visibly jumps the score.
