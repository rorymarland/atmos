/**
 * Scoring configuration: thresholds, weights, gates and verdict cut-offs.
 * The source of truth is config/profiles.yaml; this validates its parsed contents
 * against the profile definitions in code, so a typo fails loudly at build time.
 */
import { z } from 'zod';
import { PROFILE_DEFINITIONS } from './profiles/index.js';
import { assertValidRamp, type Ramp } from './ramp.js';

const linearRamp = z.strictObject({
  weight: z.number().min(0),
  good: z.number(),
  bad: z.number(),
});

const bandRamp = z.strictObject({
  weight: z.number().min(0),
  band: z.tuple([z.number(), z.number()]),
  zero: z.tuple([z.number(), z.number()]),
});

const gate = z.union([z.strictObject({ max: z.number() }), z.strictObject({ min: z.number() })]);

const period = z.enum(['morning', 'day', 'evening', 'night']);

const profile = z.strictObject({
  label: z.string().min(1),
  /** One or two words for badges. */
  short: z.string().min(1),
  /** One sentence on what the condition is, for people. */
  blurb: z.string().min(1),
  /** Scored at each summit's height, or once for the valley forecast point. */
  scope: z.enum(['summit', 'valley']),
  /** When in the day it happens; morning and evening conditions are scored for both. */
  periods: z.array(period).min(1),
  /** Counts towards the photo score. */
  photo: z.boolean().default(true),
  /** A hazard to warn about (midges), not a condition to look for: higher means worse. */
  risk: z.boolean().default(false),
  /**
   * Needs still water: only scored at a loch, and these factors' limits scale with the
   * water's size (see water.ts).
   */
  water: z.strictObject({ fetchScaled: z.array(z.string()).default([]) }).optional(),
  aggregate: z.enum(['best-hour', 'mean']),
  /** Only for `mean`: how much of the gap between the mean and the worst hour is subtracted. */
  worstHourPenalty: z.number().min(0).max(1).default(0.5),
  factors: z.record(z.string(), z.union([linearRamp, bandRamp])),
  gates: z.record(z.string(), gate).default({}),
});

const scoringConfig = z.strictObject({
  verdict: z.strictObject({
    go: z.number().min(0).max(1),
    maybe: z.number().min(0).max(1),
  }),
  confidence: z.strictObject({
    /** Spread between models below this is High. */
    high: z.number().min(0).max(1),
    /** Spread below this is Medium; above it, Low. */
    medium: z.number().min(0).max(1),
    /** Windows starting further ahead than this are never better than Medium. */
    highConfidenceHorizonHours: z.number().positive(),
  }),
  /** Model ids in order of preference for the explanation: highest resolution first. */
  modelPriority: z.array(z.string()).min(1),
  profiles: z.record(z.string(), profile),
});

export type FactorConfig = z.infer<typeof linearRamp> | z.infer<typeof bandRamp>;
export type GateConfig = z.infer<typeof gate>;
export type ProfileConfig = z.infer<typeof profile>;
export type Period = z.infer<typeof period>;
export type ScoringConfig = z.infer<typeof scoringConfig>;

export function rampOf(factor: FactorConfig): Ramp {
  return 'band' in factor
    ? { band: factor.band, zero: factor.zero }
    : { good: factor.good, bad: factor.bad };
}

/**
 * Parses and validates scoring config. Every profile, factor and gate named in config
 * must exist in code and vice versa (set a factor's weight to 0 to switch it off).
 */
export function parseScoringConfig(input: unknown): ScoringConfig {
  const config = scoringConfig.parse(input);
  const problems: string[] = [];

  if (config.verdict.maybe > config.verdict.go)
    problems.push('verdict.maybe must be <= verdict.go');
  if (config.confidence.high > config.confidence.medium) {
    problems.push('confidence.high must be <= confidence.medium');
  }

  for (const [id, p] of Object.entries(config.profiles)) {
    const def = PROFILE_DEFINITIONS[id];
    if (!def) {
      problems.push(`profiles.${id}: no profile with this id exists in the engine`);
      continue;
    }
    compareKeys(
      `profiles.${id}.factors`,
      Object.keys(p.factors),
      Object.keys(def.factors),
      problems,
    );
    compareKeys(`profiles.${id}.gates`, Object.keys(p.gates), Object.keys(def.gates), problems);
    for (const [fid, f] of Object.entries(p.factors)) {
      try {
        assertValidRamp(rampOf(f), `profiles.${id}.factors.${fid}`);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    if (Object.values(p.factors).every((f) => f.weight === 0)) {
      problems.push(`profiles.${id}: at least one factor needs a weight above 0`);
    }
  }
  for (const id of Object.keys(PROFILE_DEFINITIONS)) {
    if (!config.profiles[id]) problems.push(`profiles.${id}: missing from config`);
  }

  if (problems.length > 0) {
    throw new Error(`Invalid scoring config:\n  - ${problems.join('\n  - ')}`);
  }
  return config;
}

function compareKeys(where: string, inConfig: string[], inCode: string[], problems: string[]) {
  for (const k of inConfig) if (!inCode.includes(k)) problems.push(`${where}.${k}: unknown`);
  for (const k of inCode) if (!inConfig.includes(k)) problems.push(`${where}.${k}: missing`);
}
