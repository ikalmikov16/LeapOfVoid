# Clip Styles — Fail Montages, Quick Tries, Pro Highlight Runs

**Status: Done, awaiting the user's review of the clips** (approved and
built 2026-09-27; steps 1–4 are implemented and all three styles have been
recorded end to end. This doc describes what was built, including the changes
made during implementation.) This is the outcome of step 5
("tune profiles on real footage") in `plans/gameplay-recorder.md`. The user
reviewed the first clips and asked for different behaviour at each skill level.

## 1. Goal

Each skill level produces a clip with one clear story and no dead time:

- **Bad**: a quick montage of failed tries. The viewer thinks "how is this
  person this bad, I could do better" and downloads the game.
- **Decent**: a couple of tries that get a few jumps in, with the occasional
  skip.
- **Pro**: one fast run that chains quick jumps and skips at high heat.

At every level the ship rarely goes around one planet more than once.

## 2. Scope

**In:** a one-lap rule for all profiles; reworked profiles; per-skill clip
recipes; multi-attempt takes (the app replays retries); a pro run that starts
partway into the game; attempt markers in the sidecar; tests.

**Out:** on-screen captions or attempt counters (these belong to the
composer), audio, tap indicators (listed in §6 as a later idea).

## 3. Design decisions

### 3.1 Baseline (measured 2026-09-27, 150 runs per profile)

| Profile | Median wait per hop | Hops longer than 1 lap | Captures with a skip |
| ------- | ------------------- | ---------------------- | -------------------- |
| pro     | 1.00 lap            | 50 %                   | 62 %                 |
| decent  | 1.09 lap            | 67 %                   | 4 %                  |
| bad     | 1.28 lap            | 85 %                   | 10 %                 |

Why the clips felt slow: the bots wait into a second lap for a better
window, and the bad bot's hesitation adds whole laps on purpose.

What the level geometry allows (883 hops probed, 0.25 s reaction):

| After landing, first window that… | within ½ lap | within 1 lap | within 2 laps |
| --------------------------------- | ------------ | ------------ | ------------- |
| lands on the next planet          | 43 %         | 98 %         | 100 %         |
| skips 1+ planets                  | 15 %         | 70 %         | 91 %          |
| skips 2+ planets                  | 8 %          | 48 %         | 70 %          |

The aim sweeps around once per lap, and the next planet usually lines up late
in the first lap (median 0.84 lap). So "under one lap" is always achievable,
but early in a run each jump still takes about 2.8 s (a lap is 2.7 s at the
start). Laps get faster as the run goes on (about 2.0 s by planet 40).

### 3.2 One-lap rule (all levels)

A player considers only windows that come up before the ship completes one lap
around the planet, **counted from the landing**. (An earlier version counted
from the reaction, which still let 20–40 % of hops run slightly past a lap.)
They wait longer only when lap 1 has no window at all, or on a rare hesitation
(bad 5 %, decent 2 %, pro 0 %).

Montage tries are chosen by search, so they are also filtered. A try is
rejected if its first tap comes more than 1.6 s into the run, or if any jump
waits past one lap. The result is no dead air in bad or decent clips.

### 3.3 Per-skill recipes

These are the defaults for `bun run clip --skill X`, and flags can override them.

|                   | bad                                              | decent                          | pro                                                    |
| ----------------- | ------------------------------------------------ | ------------------------------- | ------------------------------------------------------ |
| Attempts          | 4–6                                              | 2–3                             | 1                                                      |
| Jumps per attempt | 0–3, with at least one 0                         | 2–6                             | continuous                                             |
| Skips             | only by accident                                 | 1–2 planets, on about ¼ of hops | quick jump if one comes up, else biggest skip in lap 1 |
| Deaths            | fast crashes and misses; the last try hurts most | crash or miss                   | none (cut while hot); `--cause` still forces one       |
| Starts at         | planet 0                                         | planet 0                        | planet 25–40 (§3.5)                                    |
| Retry delay       | 0.3–0.6 s after the death card appears           | 0.8–1.3 s                       | —                                                      |
| Death card BEST   | above every attempt                              | above every attempt             | NEW BEST if the run ends in a death                    |
| Length            | about 15–25 s                                    | about 20–30 s                   | about 20–30 s                                          |

In the bad montage, the last try is the one that hurts most: 3 jumps, then a
near miss. That's the moment that makes people comment.

How montages are assembled (as built):

- **Bad fits in as many tries as the length budget allows,** trying 6
  first, then 5, then 4. Five tries typically run about 28 s, so the 25 s
  budget only works because most tries are quick fails.
- **At most half of the non-final tries are instant fails** (0 jumps,
  rounded down, at least one), shuffled so no two are back to back. A clip
  never shows the same death on loop. The default ends up with 5 tries
  about half the time.
- **Decent tries are sorted by jump count, fewest first,** so the clip tells
  a "getting the hang of it" story.
- **BEST on the death card** is set above the best try: bad adds 3–9 points,
  decent adds 5–15.

### 3.3a Pro quick jumps (user request)

When a jump is available soon after landing (within the game's quick window,
the first ½ lap, which also pays the QUICK bonus), pro takes it, ideally a
quick skip. Otherwise pro takes the biggest skip that comes up in lap 1. From
the geometry numbers above, about 40 % of hops offer a quick jump. Chains of
quick jumps come from runs where several of those land in a row, and the
highlight search (§3.5) prefers such runs.

### 3.4 Bad means sloppy and impatient, not hesitant

The bad profile will:

- release too early (negative timing bias) with a large timing spread;
- go for the first window even when it's marginal;
- sometimes panic-tap right after landing.

Quick mistakes give more tries per clip, and the struggle is easy to read.

**How deaths look (user review, 2026-09-27).**

- Most deaths are misses. The jump misses every orbit and the ship flies
  off a **side** edge ("LOST IN THE VOID").
- About 80 % of scripted deaths are drawn as misses and the rest as crashes.
- A miss must leave through the left or right edge. It may fly off the
  bottom only when that orbit has no side exit, and it may crash only when
  it has no miss at all.
- A plain miss can clear the rings by any distance, from 7 px up. A near
  miss clears one by 0.3–7 px.
- Crashes must happen inside the frame.
- Measured over 40 clips per level: about 81 % side misses, 18 % crashes,
  1 % bottom exits.

**No backward jumps.** No level ever lands back on a lower planet.

- Must-survive hops without a forward window only take a forward landing.
- Random taps (blunders, no window) re-draw to avoid a backward landing.
- Every recipe drops runs that contain one, including a highlight's
  fast-forwarded stretch.
  Deaths prefer crashes and sideways misses, capped at about 1.5 s of flight, so
  the ship doesn't drift off the top of the screen for three seconds. Burned
  deaths need 8–14 s of circling (measured), so they're off by default
  everywhere unless `--cause burned` asks for one. When it does:

- the recipe keeps the quickest of up to 10 burns;
- a montage may drop to 2 tries to stay inside its length;
- the last try must be allowed to reach planet 3 (`--jumps …-3` or more),
  since the orbit only decays from there.

### 3.5 Pro starts partway into the run

The app fast-forwards invisibly (during the pre-roll) through the first
25–40 planets of the run the bot found. The clip then opens with:

- a big score on the HUD and the heat already up;
- a later zone palette;
- a faster orbit (a lap is about 2.0 s instead of 2.7 s).

This is also what a highlight looks like: nobody posts the warm-up. Set it
with `--start-at N`, or `--start-at 0` for a run from the beginning.

**Candidates.** The pro run is protected, so its timing errors are re-drawn
and it almost never dies before the shown part. A candidate that does is
dropped. The recipe plays 16 candidate runs and keeps the one whose visible
stretch rates best. The rating counts:

- quick jumps;
- skips, weighted 1.4×;
- average heat;
- the longest chain of quick jumps;
- minus a penalty for any jump that waits past a lap.

**Opening and cut.** The clip opens mid-jump, 0.3 s before the first landing
at or after the start planet. It's cut 10–30 steps after a landing and before
the next release, so it ends on a landing burst and never mid-jump.

**Scripted endings** (`--cause`, or `--near-miss`, which implies `lost`):

- The mistake comes on the hop after one of the window's landings. The
  latest landings are tried first (up to 8), and the one used is the first
  whose flight, or a burn's circling, lands the whole clip at **80–110 % of
  `--seconds`, held death card included**.
- A candidate is rejected if it gets the wrong cause or misses by more than
  7 px for a near miss.
- `--near-miss` together with any cause other than `lost` is a usage error.
- Only progressing landings count as jumps.

### 3.6 Take format v2

- A take holds `attempts[]` (seed, taps, expected result) on one global step
  timeline, plus `skipSteps` for the fast-forward.
- The app installs each attempt at its start step, which is exactly what
  tapping "TAP TO TRY AGAIN" does, except with a known seed.
- The sync strip keeps counting across attempts, so the recorder's
  per-step rebuild works as it does now.
- The recorder checks every attempt's result.
- The sidecar gets `attemptStart` and `attemptEnd` markers, so the composer
  can add "attempt 5" captions later.

## 4. Implementation steps

1. ✅ **Profiles and one-lap rule.** Files: `scripts/clips/bot.ts`,
   `profiles.ts`. Release events now record `revolutions` and `quick`.
2. ✅ **Recipes.** File: `scripts/clips/recipes.ts`, which replaced
   `search.ts`. `args.ts` changed as follows:
   - added `--attempts`, `--jumps A-B`, `--start-at` and `--seconds`;
   - removed `--die-at`, `--survive`, `--min-*` and `--max-*`, since recipes
     now decide how deaths happen.
3. ✅ **Take v2 in the app.** Files: `src/clip/take.ts`, `replay.ts`
   (`scriptFor` and `installAttempt`, shared with the headless
   `simulateClip`) and `useClipReplay.tsx`.
4. ✅ **Recorder.** File: `record.ts`. It now:
   - verifies each attempt's reported result;
   - writes the sidecar `timeline` with `attemptStart` and `attemptEnd`
     markers;
   - limits the simulator boot wait and reboots once if the simulator comes
     up half-booted (seen once after a week idle).

Change made while recording: replay steps are now paced by `Date.now()`, with
at most one step per 25 ms. The previous pacing used `frame.timestamp` with a
10 ms minimum. After a hiccup, the display link replays its backlog of
callbacks back-to-back, and those callbacks still carry evenly spaced vsync
timestamps. So several steps ran within a single refresh and never reached
the screen: 5 of 1434 steps were lost in a pro clip. Wall-clock pacing brought
that down to 1, a single repeated frame. Recording now takes at least 2× real
time, plus commit waits, and the output is unchanged.

**Review fixes (2026-09-27).** A 209-agent review confirmed 52 findings, and
all are fixed. The ones that change the design above:

- The sync strip is drawn last, in patches that count steps (4 patches since
  the second review, step mod 1296).
- The death card and zone banner run on sim time in clip mode.
- `--jumps N` no longer hangs.
- `--near-miss` works for pro.
- Pro endings stay inside the requested length.
- Burned endings are bounded.

See `plans/gameplay-recorder.md` for the recorder and app-side changes.

## 5. Acceptance criteria — results (2026-09-27)

| Check                                  | Target             | Measured (40 clips per level)                       |
| -------------------------------------- | ------------------ | --------------------------------------------------- |
| Montage jumps that wait past one lap   | 0 %                | 0 % (bad and decent)                                |
| Pro jumps that wait past one lap       | ≤ 3 %              | 1–2 %                                               |
| Bad: tries / jumps per try / length    | 4–6 / ≤ 3 / ≤ 25 s | median 5 tries, all ≤ 3 jumps, max 25.0 s           |
| Decent: tries / jumps per try / length | 2–3 / 2–6 / ≤ 30 s | median 3 tries, max 29.8 s                          |
| Decent: landings that skip a planet    | about ¼            | 22 %                                                |
| Pro: quick jumps / skipping landings   | ≥ 30 % / ≥ 50 %    | 60 % / 49–56 % (varies by seed)                     |
| Replay exact, every attempt            | yes                | yes (tests, plus the app's reports on 4 recordings) |
| Missing steps per clip                 | 0                  | 0 (all three, after the fixes)                      |

`bun test` covers these as regression tests (with slightly looser bounds so
seed changes don't make them flaky).

## 6. Later ideas

- **Tap indicator:** a small ripple drawn in clip mode wherever the player
  taps, so viewers can see a bad player tap at the wrong moment.
