# Clip Marketing Strategy — Growing Leap of Void via Short-Form Video

**Status: Living context doc** (written 2026-09-19). Not an implementation plan —
this is the _why_ and the overall pipeline. Implementation plans hang off it:

- `plans/gameplay-recorder.md` — automated gameplay capture (first build).
- `plans/clip-composer.md` — the composer's first part: the branded end card
  (`bun run clip:compose`, built 2026-09-27). Still to come: hook clips,
  the persistent name tag and captions.

## 1. Goal

Leap of Void is live on the App Store. It was built from day one to be easy to
clip (portrait, 9:16, one-tap, readable in a second). The growth plan is
organic short-form video — Reels / TikTok / Shorts — posted at volume, with as
much of the production pipeline automated as possible so that making a clip
costs minutes, not an evening.

## 2. Clip types

### A. Pure gameplay

Straight gameplay with a text hook. Three flavours, all worth posting:

- **Godlike** — long skip chains, red-hot heat multiplier, big score.
- **Decent** — relatable mid-skill run.
- **Fail** — dies early / agonising near-miss. ("nobody passes planet 20",
  "this game is impossible", etc.)

Cheap, zero copyright risk, the standard hyper-casual format. Expected to be
"decent" performers; near-miss/fail clips usually beat flawless ones.

### B. Viral hook → gameplay (the main bet)

Open with an already-viral random clip as the hook, then transition into
gameplay and shout out the game. Reference creators the user likes:
**lcsign** and **Judy's Pancakes** — reels that start with a viral clip, then
the creator either transitions out of it somehow or comments on it, then plugs
the brand.

Agreed observations about this format:

- **The transition is the whole craft.** A hard cut from a random clip to
  unrelated gameplay gets swiped at the cut. It works when the cut is
  _motivated_: a comment, a joke, or a match cut on motion.
- **Natural angle for this game: the leap.** Clips of someone jumping /
  falling / launching / yeeting → match-cut mid-air to the ball leaving orbit.
  Fails → match to a death; clutch moments → match to a skip chain.
- **Repost risk.** Platforms downrank unoriginal/reposted content and
  takedowns hurt small accounts; reposting without permission is technically
  infringement. Transformed/commented clips are both safer and better
  performing than "clip → gameplay" with nothing added. Owner's call per clip.

### C. Overlay / CTA layer (applies to A and B)

Text overlays on the gameplay that introduce the game and prompt the download:
hook caption, persistent game-name tag, end card. Game name should be on
screen the whole time — views ≠ installs, and the viewer has to be able to
search for it. The end card is built (`plans/clip-composer.md`): a warp into
the app icon's orbit, LEAP OF VOID, "YOUR TURN." and a game-styled "Download
from the App Store" button. It uses no App Store badge, because Apple forbids
animating or restyling it.

## 3. Pipeline

```
 [1] gameplay takes          [2] hook clips            [3] compose            [4] post
 bot plays at a chosen   +   user saves viral     →    template: hook →   →   manual: add trending
 skill, auto-recorded        clips into a folder       transition →           audio in-app, caption,
 (plans/gameplay-recorder)   (manual — taste + rights) gameplay + overlays    campaign link in bio
```

1. **Gameplay takes — automated.** Claude can't play by tapping through tools
   (seconds of latency per tap), but the engine is pure, seeded TS
   (`src/game/`), so a bot can play it perfectly or badly on demand and the
   simulator can be recorded from the CLI. See `plans/gameplay-recorder.md`.
2. **Hook clips — manual.** The user finds and saves clips (their feed, their
   taste, their call on rights). Claude is weak here: can't see a logged-in
   algorithmic feed and "stupid but viral" is a taste judgment.
3. **Compose — automated, templated.** Planned tool: **Remotion** (video in
   React — fits the stack). Templates for hook caption, name tag, transition,
   CTA end card; driven by a small JSON manifest per video (hook file, cut
   point, gameplay take, caption text) → 1080×1920 mp4. Caption variants for
   A/B testing are nearly free. ffmpeg for trims/transcodes.
4. **Post — manual.** Trending audio has to be added in-app at post time
   (the clips carry game audio by default — lower it or record `--silent`),
   and auto-posting APIs need business accounts/app review. Not worth
   automating.

## 4. Who does what

| Claude                                               | User                                           |
| ---------------------------------------------------- | ---------------------------------------------- |
| Gameplay bot + recording tool                        | Picking viral clips (feed, taste, rights call) |
| Compose templates + batch rendering                  | Any face/voice commentary                      |
| Caption/hook copy variants, match-cut ideas per clip | Posting + trending audio in-app                |
| Campaign-link / tracking setup                       | Reading analytics, reporting what works        |

## 5. Measurement

- App Store Connect **campaign links** (`ct=` / `pt=`) — one per platform (and
  per clip type if practical) so installs can be attributed.
- Track per clip: type (A-godlike / A-fail / B-hook…), hook text, views, 3-sec
  retention, profile visits, installs that day. Let data pick the format.
- Post both A and B in parallel at volume (target 1–3/day for a few weeks)
  before concluding anything.

## 6. Verified facts about the tooling (2026-09-19, this machine)

- Xcode 26.6, iOS 26.5 runtime, iPhone 17 Pro simulator with Expo Go installed.
- `xcrun simctl io booted recordVideo` works headlessly: 1206×2622, H.264/HEVC.
  **No audio track** (tested), and the file is **variable frame rate** (frames
  only written when the screen changes) → always re-encode to constant 60 fps.
- ffmpeg 9 installed via Homebrew.
- Device aspect is 19.5:9, not 9:16 — handled in the recorder plan.

## 7. Open questions

- ~~Audio on gameplay clips~~ — built (2026-09-27): every recorded clip now
  carries the game's own SFX + ambient pad at −14 LUFS; record with
  `--silent` for footage meant to carry only trending audio (or mute the
  original sound in the app when posting).
- Face/voice on camera for type-B clips, or text-only commentary?
- Which platform first (affects safe zones and caption style)?
