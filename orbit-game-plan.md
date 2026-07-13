# Leap of Void — Full Project Plan & Design Doc

> **Note for the agent reading this:** This document is the complete handoff from a prior
> planning conversation. It contains the project goal, all design decisions already made
> (and why), the full gameplay spec, tech stack, and build roadmap. Treat decisions here
> as settled unless the user says otherwise. The next step is scaffolding the app and
> building the core loop prototype (see Roadmap, Milestone 1).

---

## 1. The Goal (why this project exists)

- Build a **simple, addictive, single-player mobile game** and ship it to the **App Store (iOS first)**.
- Grow users by posting **short gameplay clips on social media** (TikTok / Reels / Shorts). Every design decision should serve the question: _"does this make a better 5–15 second vertical clip?"_
- Eventually **monetize with ads** (interstitials between runs + rewarded "continue once" ad). No paywalls, no forced sign-ups, instant play.
- Strategy: **ship fast, post clips early, iterate** on what performs. Do not polish for months before launch.
- Android port later (the cross-platform codebase is a deliberate choice for this).

## 2. The Game (elevator pitch)

**Title: Leap of Void** (settled working/App Store name; still verify App Store availability).

You are a small ball orbiting a planet in space. **Tap to release** — you fly off in a
straight line along your orbit's tangent. **Graze the next planet** to get captured into
its orbit. Chain planet-to-planet hops forever. The longer you play, the harder it gets.
Endless, score-based, one-touch.

Think: the timing purity of Flappy Bird + the flow of a swinging/slingshot game, in space.

### How this idea was chosen (context for the user's thinking)

- User's original idea was an endless version of Arrowscapes (tap arrows to slide them off a grid). Rejected as primary idea: visually quiet for clips, board-generation is technically risky. Kept in the back pocket.
- Other candidates considered: gravity-flip runner (felt too much like Geometry Dash), stack tower, timing ring, circle pong, pendulum swing (user loves the swing fantasy — good candidate for **game #2**, but physics feel-tuning is too risky for game #1).
- **This orbit-hop concept won** because: one-touch, endless, legible in half a second of muted footage, visually hypnotic, space theme is marketable, and the tech is pure geometry (no physics engine, low risk in React Native).

## 3. Core Rules (the settled spec)

### Orbit & release

- Ball orbits the current planet at constant angular speed on that planet's orbit ring.
- Single tap (anywhere on screen) = release. Ball departs along the **current tangent line** and flies straight at constant speed.
- The skill: **time your tap** so the tangent line takes you where you want to go.

### Capture geometry (important — this was carefully worked out)

When the ball flies toward a planet, compute the **closest-approach distance** of its
straight-line path to that planet's center:

| Closest approach                                              | Result                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Inside the planet body                                        | **Crash into surface = death**                                          |
| Within the capture band (between surface and outer ring edge) | **Captured into orbit** (+1 score)                                      |
| Beyond the capture band                                       | Ball sails past — if nothing else catches it, **lost in space = death** |

Key insight: the ring surrounds the planet, so if merely crossing the ring captured you,
hitting a planet would be geometrically impossible and every sloppy shot would succeed.
Capture-by-closest-approach means the skill is **"aim to graze the planet, never at it."**
This one rule generates the near-miss drama, two distinct funny death types (smack vs
overshoot), and the main difficulty dial for free.

- On capture, orbit direction follows the approach direction (flow feels continuous).
- Orbit radius on capture: **snap to the planet's fixed ring** in v1. (v2 idea: orbit radius = your actual graze distance — tighter graze = faster, riskier orbit with bonus points. Deliberately deferred.)

### Pressure system (anti-camping — required for an endless score game)

- **Decaying orbits (v1):** every orbit slowly spirals inward; wait too long and you burn up on the planet surface. Visibly telegraphed (orbit tightens). Each planet is a ticking clock.
- **Black hole (v1.5 / later zones):** chases from below/behind, swallowing planets at increasing speed. Global pace pressure + spectacular on camera. Add after core game works.

### Death & restart (clip-critical)

- Deaths must be readable and dramatic: impact flash, ball shatters into particles, screen shake, haptic thud.
- Death screen: **huge score number**, best score, **one-tap instant restart (< 1 second)**, share button.
- Fair-start rule: first few planets of every run have generous capture bands so no one dies in the opening seconds of a clip.

## 4. Scoring

- **+1 per planet** reached. Score displayed big and central at top at all times.
- **Combo multiplier:** release within your first full revolution of a new orbit = "hot streak" — multiplier climbs, ball trail intensifies, sound pitch rises per link in the chain.
- **Graze bonus:** passing very close to a planet surface (without dying) = sparks + bonus points, optional 60ms slow-mo micro-moment.
- **Perfect capture bonus:** entering the capture band dead-center = chime + bonus.
- **Zones:** every ~20 planets, background nebula hue shifts and a zone name flashes. Gives clips visible progress markers ("he reached the purple zone") and creators reference points.

## 5. Difficulty Curve (dials, all scale with planets passed)

1. **Capture band width** (main dial): early = small planet body + wide ring (forgiving corridor); later = fat body + tight ring (needle-threading).
2. Orbit angular speed (faster = harder timing).
3. Distance/angle between planets (longer, riskier jumps).
4. Alternating orbit directions between planets.
5. Orbit decay rate (faster burn-up clock).
6. Moving planets (drift slowly).
7. Asteroids/debris drifting through jump corridors.
8. Black hole speed (once introduced).

Introduce roughly **one new element per zone** so long runs keep escalating and clips of deep runs look visibly different from early-game.

## 6. Feel & Look

- **Visual identity: neon-glow-on-dark space.** Glowing ball with comet trail, soft glowing rings, flat-shaded colorful planets, starfield + nebula gradient background that hue-shifts per zone. Must be readable in a tiny, muted, vertical TikTok frame.
- Portrait orientation, locked. Design everything for 9:16 capture.
- Juice checklist: particle burst on capture, trail intensity tied to combo, screen shake on death, squash/stretch on release, haptics (release / capture / graze / death), minimal synth SFX with rising pitch per combo link.
- No mandatory tutorial. First-run hint at most ("tap to release"). Zero friction to first play.

## 7. Tech Stack (decided, with reasoning)

- **React Native + Expo (TypeScript).** Chosen over Swift/SpriteKit because: user is JS/React-comfortable (ship speed), game is simple 2D geometry well within RN's capability, and Android port later is nearly free (hypercasual downloads skew Android — matters for the user-growth goal). Unity/Godot = overkill for circles and lines.
- **Rendering:** `@shopify/react-native-skia` — entire game on one Skia canvas.
- **Game loop:** `react-native-reanimated` frame callback (60fps+), game state in shared values / plain JS model per frame.
- **No physics engine.** Everything is circle math + line geometry (closest-approach = point-to-line distance). Deterministic and easy to tune.
- App state: zustand (screens, settings). Persistence: MMKV or AsyncStorage (best score). `expo-haptics`, `expo-audio` for SFX.
- **Build/ship:** EAS Build → TestFlight → App Store. iOS first, Android later.
- Ads later via `react-native-google-mobile-ads` (interstitial + rewarded continue). Keep out of v1 code but design death-flow with a "continue" slot in mind.

## 8. Roadmap (build order)

1. **Core loop prototype (make-or-break):** one screen, static chain of planets, orbiting ball, tap-release along tangent, closest-approach capture/crash/miss logic, death + instant restart, score counter. _Get the release-and-capture feel right before anything else._
2. **Procedural generation + difficulty:** infinite planet chain trending upward, camera follow, all difficulty dials as functions of planets-passed, orbit decay.
3. **Juice pass:** trail, particles, shake, haptics, SFX, combo/graze/perfect systems, zone color shifts.
4. **Meta:** home screen (tap to start), death card (score/best/share), settings (sound/haptics toggles), best-score persistence.
5. **Ship:** app icon, **Leap of Void** branding, EAS build, TestFlight, App Store listing (screenshots = actual gameplay clips).
6. **Post-launch:** record + post clips (high scores, near-miss compilations, fail montages), then ads (interstitial + rewarded continue), then Android build.

## 9. v2 Parking Lot (do NOT build in v1)

- Orbit radius = graze distance (risk/reward orbits).
- Black hole chase (if not done in v1.5).
- Skins/trails unlocked by score milestones (retention).
- Daily challenge (fixed seed, shared leaderboard).
- Game #2 candidate: pendulum/web-swing game (user loves the Spider-Man swing fantasy). Game #3 candidate: endless Arrowscapes (user's original idea).

## 10. Open Items (ask the user when relevant)

- Confirm **Leap of Void** App Store availability (and bundle id / hashtag: e.g. `leapofvoid`). Repo folder can stay `orbit-game` or be renamed to match.
- Exact zone names/theme flavor.
- Whether v1 launches with decaying orbits only, or decay + black hole.
