/**
 * BotProfile.ts — what makes one bot different from another.
 *
 * `Difficulty.ts` answers "how good is this tier". This answers "who is this
 * particular player", which is a different question: thirty bots on the
 * veteran tier should not be thirty identical opponents. Every stat is rolled
 * within a band around its tier baseline, so a lobby has a spread of ability
 * the way a real one does.
 *
 * TWO SEPARATE THINGS, deliberately:
 *
 *   SkillProfile        how well they execute — aim, recoil, movement tech.
 *   PersonalityProfile  what they choose to do — push or hold, rush or wait.
 *
 * Keeping them apart is what lets a bot be mechanically excellent but overly
 * passive, or aggressive and sloppy. Folding them into one number produces
 * the "every bot plays identically, just faster" feel that this exists to
 * avoid.
 *
 * NOTHING HERE GRANTS INFORMATION. Every field is about reaction, execution
 * or preference. There is no stat that reveals an enemy position, and there
 * cannot be one: perception is the only path to knowing where anyone is, and
 * it does not read this file.
 */
import { DIFFICULTIES, type DifficultyProfile, SeededRandom } from './Difficulty';

export type SkillTier = 'recruit' | 'regular' | 'hardened' | 'veteran' | 'pro';

export interface SkillProfile {
  readonly tier: SkillTier;

  // --- aim ---
  /** Milliseconds between seeing a target and being allowed to act on it. */
  reactionMs: number;
  /** 0..1 — how tightly aim follows a strafing target. */
  aimTracking: number;
  /** 0..1 — accuracy of a snap onto a target that just appeared. */
  aimFlickPrecision: number;
  /** 0..1 — how much of the weapon's recoil the bot compensates for. */
  recoilControl: number;
  /** Baseline aim error half-angle in degrees. */
  aimConeDegrees: number;
  /** 0..1 — extra chance to miss at the edge of the weapon's range. */
  missChanceLongRange: number;

  // --- movement tech ---
  /** 0..1 — chance to time a corner slide correctly. */
  slideUsageSkill: number;
  /** 0..1 — chance to chain jump momentum. */
  bunnyHopSkill: number;
  /** 0..1 — likelihood of dropping to prone mid-fight. */
  dropshotTendency: number;
  /** 0..1 — stopping dead before firing, for accuracy. */
  counterStrafeSkill: number;
  /** 0..1 — how well the bot avoids overexposing itself on a peek. */
  peekDiscipline: number;

  // --- game sense ---
  /** 0..1 — pre-aiming at head height around corners. */
  crosshairPlacementSkill: number;
  /** 0..1 — chance of choosing a worse option than the best available. */
  mistakeRate: number;
  /** 0..1 — noise added to utility scores. */
  decisionJitter: number;
}

export interface PersonalityProfile {
  /** 0..1 — push an angle versus hold it. */
  aggression: number;
  /** 0..1 — willingness to wait for a better opportunity. */
  patience: number;
  /** 0..1 — how much notice is taken of squad claims. */
  teamworkBias: number;
  readonly preferredRange: 'close' | 'mid' | 'long' | 'flex';
  /** 0..1 — willingness to fight at low health or with poor information. */
  riskTolerance: number;
  /** 0..1 — eagerness to spend a killstreak the moment it is available. */
  callInFrequency: number;
}

export interface BotProfile {
  readonly botProfileId: string;
  readonly skill: SkillProfile;
  readonly personality: PersonalityProfile;
  /** The perception/turn-rate limits this bot's tier implies. */
  readonly difficulty: DifficultyProfile;
}

/**
 * Tier baselines.
 *
 * The four lower tiers derive their perception numbers from DIFFICULTIES so
 * there is exactly one place where "how far can a veteran see" is defined.
 * `pro` is new here — it is the tier the spec asks for above veteran.
 */
const TIER_SKILL: Record<SkillTier, Omit<SkillProfile, 'tier'>> = {
  recruit: {
    reactionMs: 620, aimTracking: 0.09, aimFlickPrecision: 0.30, recoilControl: 0.20,
    aimConeDegrees: 7.5, missChanceLongRange: 0.35,
    slideUsageSkill: 0.05, bunnyHopSkill: 0.00, dropshotTendency: 0.05,
    counterStrafeSkill: 0.10, peekDiscipline: 0.20,
    crosshairPlacementSkill: 0.20, mistakeRate: 0.35, decisionJitter: 0.18,
  },
  regular: {
    reactionMs: 380, aimTracking: 0.16, aimFlickPrecision: 0.50, recoilControl: 0.40,
    aimConeDegrees: 4.2, missChanceLongRange: 0.22,
    slideUsageSkill: 0.25, bunnyHopSkill: 0.10, dropshotTendency: 0.15,
    counterStrafeSkill: 0.30, peekDiscipline: 0.40,
    crosshairPlacementSkill: 0.40, mistakeRate: 0.20, decisionJitter: 0.12,
  },
  hardened: {
    reactionMs: 240, aimTracking: 0.24, aimFlickPrecision: 0.65, recoilControl: 0.60,
    aimConeDegrees: 2.4, missChanceLongRange: 0.14,
    slideUsageSkill: 0.50, bunnyHopSkill: 0.30, dropshotTendency: 0.30,
    counterStrafeSkill: 0.55, peekDiscipline: 0.60,
    crosshairPlacementSkill: 0.60, mistakeRate: 0.10, decisionJitter: 0.08,
  },
  veteran: {
    reactionMs: 160, aimTracking: 0.33, aimFlickPrecision: 0.80, recoilControl: 0.78,
    aimConeDegrees: 1.4, missChanceLongRange: 0.08,
    slideUsageSkill: 0.75, bunnyHopSkill: 0.55, dropshotTendency: 0.50,
    counterStrafeSkill: 0.75, peekDiscipline: 0.80,
    crosshairPlacementSkill: 0.80, mistakeRate: 0.05, decisionJitter: 0.05,
  },
  pro: {
    reactionMs: 130, aimTracking: 0.40, aimFlickPrecision: 0.93, recoilControl: 0.90,
    aimConeDegrees: 0.9, missChanceLongRange: 0.03,
    slideUsageSkill: 0.95, bunnyHopSkill: 0.85, dropshotTendency: 0.70,
    counterStrafeSkill: 0.92, peekDiscipline: 0.93,
    crosshairPlacementSkill: 0.93, mistakeRate: 0.02, decisionJitter: 0.015,
  },
};

/** How far an individual may deviate from the tier baseline. */
const VARIANCE = 0.15;

/** 0..1 stats stay in 0..1; timings scale but never go below human. */
function jitterUnit(value: number, rng: SeededRandom): number {
  const scaled = value * rng.range(1 - VARIANCE, 1 + VARIANCE);
  return Math.max(0, Math.min(1, scaled));
}

function jitterScalar(value: number, rng: SeededRandom, floor = 0): number {
  return Math.max(floor, value * rng.range(1 - VARIANCE, 1 + VARIANCE));
}

export function createSkillProfile(tier: SkillTier, rng: SeededRandom): SkillProfile {
  const base = TIER_SKILL[tier];
  return {
    tier,
    // 100 ms is roughly the floor of human visual reaction. A bot is never
    // allowed below it, however the roll lands.
    reactionMs: Math.max(100, jitterScalar(base.reactionMs, rng)),
    aimTracking: jitterUnit(base.aimTracking, rng),
    aimFlickPrecision: jitterUnit(base.aimFlickPrecision, rng),
    recoilControl: jitterUnit(base.recoilControl, rng),
    aimConeDegrees: jitterScalar(base.aimConeDegrees, rng, 0.35),
    missChanceLongRange: jitterUnit(base.missChanceLongRange, rng),
    slideUsageSkill: jitterUnit(base.slideUsageSkill, rng),
    bunnyHopSkill: jitterUnit(base.bunnyHopSkill, rng),
    dropshotTendency: jitterUnit(base.dropshotTendency, rng),
    counterStrafeSkill: jitterUnit(base.counterStrafeSkill, rng),
    peekDiscipline: jitterUnit(base.peekDiscipline, rng),
    crosshairPlacementSkill: jitterUnit(base.crosshairPlacementSkill, rng),
    mistakeRate: jitterUnit(base.mistakeRate, rng),
    decisionJitter: jitterUnit(base.decisionJitter, rng),
  };
}

const RANGES = ['close', 'mid', 'long', 'flex'] as const;

export function createPersonality(rng: SeededRandom): PersonalityProfile {
  return {
    aggression: rng.next(),
    patience: rng.next(),
    teamworkBias: rng.range(0.3, 1),
    preferredRange: RANGES[Math.floor(rng.next() * RANGES.length)],
    riskTolerance: rng.next(),
    callInFrequency: rng.range(0.2, 1),
  };
}

/** A tier's perception limits, which the skill roll does NOT widen. */
function difficultyFor(tier: SkillTier): DifficultyProfile {
  // `pro` reuses veteran's perception envelope on purpose: a pro player is
  // faster and more accurate than a veteran, but their eyes are the same.
  // Giving the top tier a wider FOV and longer view range would be exactly
  // the "difficulty by omniscience" this architecture refuses.
  return DIFFICULTIES[tier] ?? DIFFICULTIES.veteran;
}

/**
 * Build a complete profile.
 *
 * Seeded by the bot's own id, so the same bot is the same player every time
 * the match is replayed — reproducible tests, reproducible bug reports.
 */
export function createBotProfile(
  botProfileId: string,
  tier: SkillTier,
  seed?: number,
): BotProfile {
  const rng = new SeededRandom(seed ?? hashString(botProfileId));
  return {
    botProfileId,
    skill: createSkillProfile(tier, rng),
    personality: createPersonality(rng),
    difficulty: difficultyFor(tier),
  };
}

/** Tier distribution for a filled lobby: mostly mid, a few at each extreme. */
export function pickTier(rng: SeededRandom): SkillTier {
  const roll = rng.next();
  if (roll < 0.15) return 'recruit';
  if (roll < 0.45) return 'regular';
  if (roll < 0.78) return 'hardened';
  if (roll < 0.95) return 'veteran';
  return 'pro';
}

export function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

/**
 * Deliberately choose a worse option, at the bot's own mistake rate.
 *
 * Centralised so every decision site inherits it rather than each capability
 * inventing its own imperfection. This is what produces "peeked too wide",
 * "reloaded at a bad moment", "pushed when they should have held" — bounded,
 * skill-scaled error rather than randomness.
 */
export function maybeMistake<T>(
  chosen: T, alternatives: readonly T[], skill: SkillProfile, rng: SeededRandom,
): T {
  if (!alternatives.length) return chosen;
  if (rng.next() >= skill.mistakeRate) return chosen;
  const others = alternatives.filter((a) => a !== chosen);
  if (!others.length) return chosen;
  return others[Math.floor(rng.next() * others.length)];
}
