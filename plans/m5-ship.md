# M5 — Ship: Branding, EAS Build, TestFlight, App Store

**Status: In progress** (approved in chat; Apple-side steps are performed by the
user with agent guidance)

## 1. Goal

Leap of Void is live on the App Store: real icon and branding (no Expo
template placeholders), a production EAS build installable via TestFlight, the
pending on-device verification items from M2–M4 and the SFX pass confirmed on
a release build, and a complete App Store listing (screenshots from actual
gameplay, privacy labels, policy/support URLs) submitted for review.

## 2. Scope

**In:**

- App icon (1024×1024, no alpha) + splash screen config matching the void
  aesthetic (`#060614`).
- `app.json` ship config: `ios.bundleIdentifier`, `buildNumber`,
  `ITSAppUsesNonExemptEncryption: false`.
- `eas.json` with development / preview / production profiles.
- Privacy policy + support page (hosted via a small public repo
  `ikalmikov16/leap-of-void-legal` on GitHub Pages; main game repo stays private).
- TestFlight round: production build on device — doubles as the deferred
  on-device verification pass for the earlier plans.
- App Store listing: screenshots (9:16 gameplay captures), description,
  keywords, category, age rating, privacy labels, submission.

**Out (explicitly):**

- Ads, skins, leaderboards, black hole — v2 parking lot unchanged.
- Android build/store assets (post-launch; template Android icons stay for now).
- App preview _video_ on the listing (optional; can be added post-launch from
  the same clips pipeline).
- Burn bed rework — stays parked/disabled (`BURN_ENABLED = false`).

## 3. Design decisions

- **Bundle ID `com.ikalmikov.leapofvoid`** — matches the GitHub org/repo
  naming. Permanent after the first App Store Connect upload, trivially
  changeable before it.
- **Name "Leap of Void"** — web search shows no existing App Store app with
  this name; final confirmation happens when the app record is created in
  App Store Connect (Apple validates uniqueness there).
- **Splash = solid `#060614`, no logo image.** On-brand ("the void"), avoids
  any logo-on-background color-mismatch box, ships instantly. A logo can be
  added later without a store update ritual.
- **Icon is AI-generated art** matching the neon-on-dark game look (glowing
  planet + orbit ring + comet ball). Flattened to remove alpha (App Store
  rejects icons with alpha channels).
- **Credentials managed by EAS** — no manual certificates/profiles in the
  Apple portal; `eas build` generates and stores them.
- **Privacy posture: "Data Not Collected".** No accounts, no analytics, no
  ads, no tracking; only local AsyncStorage (best score, settings). Apple
  still requires privacy-policy and support URLs → GitHub Pages on the public
  `leap-of-void-legal` repo.

## 4. Implementation steps

1. **Housekeeping** — commit outstanding SFX-upgrade / UI-polish /
   pause-and-progress work so the ship config is a clean change. _(agent)_
2. **Branding assets** — generate icon, flatten alpha, wire into `app.json`;
   splash via `expo-splash-screen` plugin with `#060614`. Touches:
   `assets/icon.png`, `app.json`, `package.json`. _(agent)_
3. **Ship config** — bundle ID, `buildNumber: "1"`, export-compliance key;
   create `eas.json`. Touches: `app.json`, `eas.json`. _(agent)_
4. **Privacy/support pages** — `docs/index.html` (support) +
   `docs/privacy.html` in the main repo (source of truth); mirrored to the
   public `leap-of-void-legal` repo for GitHub Pages. _(agent + user)_
5. **EAS + Apple** — `eas login`, `eas init`, `eas build -p ios`,
   `eas submit -p ios` (auto-creates the App Store Connect record).
   _(user in terminal, agent guiding)_
6. **TestFlight verification** — install production build; run the
   accumulated on-device checklists (persistence, share, toggles, SFX mix,
   silent-switch/mixing, performance without dev mode). _(user)_
7. **Listing + submission** — screenshots from real gameplay, metadata,
   privacy labels, age rating, submit for review. _(user, agent drafts copy)_

## 5. Testing & acceptance criteria

- `bun run typecheck`, `bun run lint`, `bun test` green.
- Production build installs from TestFlight and plays correctly on a real
  iPhone (frame rate, audio, haptics, persistence across relaunch).
- Icon renders correctly on the home screen (no alpha artifacts, reads at
  small size); launch shows the dark void splash, no white flash.
- Privacy + support URLs resolve publicly.
- App Store submission passes review → **M5 checkbox flips in
  `project-overview.mdc`** when the app is approved.
