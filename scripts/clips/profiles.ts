// Skill profiles. A player = judgment (which window to go for) + hands (how
// close to the intended frame the tap actually lands). All three follow the
// one-lap rule (bot.ts planHop): they only consider windows before the first
// lap after landing is over.
// Tuned against `bun run clip:take --stats` — see plans/clip-styles.md.

export type Skill = 'pro' | 'decent' | 'bad';

export interface Profile {
  name: Skill;
  /** Tap timing error: gaussian, ms. Negative bias = habitually early. */
  sigmaMs: number;
  biasMs: number;
  /** Seconds after a landing before this player can act (uniform range). */
  reactionS: [number, number];
  /** Seconds before the opening tap of a fresh run… */
  startDelayS: [number, number];
  /** …and of a retry (they're already warmed up / annoyed). */
  retryDelayS: [number, number];
  /** Value of each extra planet one jump advances (negative = avoids skips). */
  skipValue: number;
  /** Value of releasing inside the quick window (the game's QUICK bonus). */
  quickValue: number;
  /** Value lost per lap spent waiting for a window. */
  impatience: number;
  /** How much a likely death scares them. 0 = doesn't weigh risk at all. */
  riskAversion: number;
  /** Random noise on window values, so choices aren't mechanical. */
  choiceNoise: number;
  /** Per-hop chance of sitting out an extra lap. */
  hesitateChance: number;
  /** Per-hop chance of a random tap (unscripted play only, e.g. --stats). */
  blunderChance: number;
  /** Scripted deaths: chance the fatal tap is a panic tap right after landing
   * rather than a mistimed version of the jump they were going for. */
  panicChance: number;
  /** Seconds between the death card appearing and the retry tap. */
  retryGapS: [number, number];
}

export const PROFILES: Record<Skill, Profile> = {
  pro: {
    name: 'pro',
    sigmaMs: 9,
    biasMs: 0,
    reactionS: [0.18, 0.3],
    startDelayS: [0.5, 0.8],
    retryDelayS: [0.3, 0.5],
    skipValue: 6,
    quickValue: 8,
    impatience: 6,
    riskAversion: 60,
    choiceNoise: 1.5,
    hesitateChance: 0,
    blunderChance: 0,
    panicChance: 0,
    retryGapS: [0.4, 0.7],
  },
  decent: {
    name: 'decent',
    sigmaMs: 22,
    biasMs: 0,
    reactionS: [0.25, 0.5],
    startDelayS: [0.6, 1.0],
    retryDelayS: [0.4, 0.8],
    skipValue: 5,
    quickValue: 1,
    impatience: 5,
    riskAversion: 22,
    choiceNoise: 3,
    hesitateChance: 0.02,
    blunderChance: 0.01,
    panicChance: 0.15,
    retryGapS: [0.8, 1.3],
  },
  bad: {
    name: 'bad',
    sigmaMs: 40,
    biasMs: -25,
    reactionS: [0.2, 0.5],
    startDelayS: [0.5, 1.0],
    retryDelayS: [0.25, 0.6],
    skipValue: -3,
    quickValue: 0,
    impatience: 12,
    riskAversion: 2,
    choiceNoise: 4,
    hesitateChance: 0.05,
    blunderChance: 0.08,
    panicChance: 0.35,
    retryGapS: [0.3, 0.6],
  },
};
