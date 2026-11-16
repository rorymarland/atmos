/**
 * Scoring: one hour, one time window, then across models with a confidence level.
 */
import { createHourContext, type HourExtras } from './context.js';
import { rampOf, type ProfileConfig, type ScoringConfig } from './config.js';
import { PROFILE_DEFINITIONS } from './profiles/index.js';
import { rampScore } from './ramp.js';
import type { Confidence, ModelForecast, Target, TimeWindow, Unit, Verdict } from './types.js';

export interface FactorResult {
  id: string;
  label: string;
  unit: Unit;
  weight: number;
  value: number | null;
  /** 0 to 1, or null when there was no data (the factor is then left out). */
  score: number | null;
  detail?: string;
}

export interface GateResult {
  id: string;
  label: string;
  unit: Unit;
  value: number | null;
  limit: { max: number } | { min: number };
  passed: boolean;
}

export interface HourResult {
  time: number;
  /** Weighted geometric mean of factor scores, before gates. Null if no factor had data. */
  score: number | null;
  gated: boolean;
  verdict: Verdict;
  factors: FactorResult[];
  gates: GateResult[];
}

export interface WindowResult {
  model: string;
  /** Final 0 to 1 score for the window; 0 when gated. Null when there was no data. */
  score: number | null;
  verdict: Verdict;
  /** The hour shown in explanations: the best hour, or the worst hour for `mean` profiles. */
  keyHour: HourResult | null;
  hours: HourResult[];
}

export interface TargetResult {
  target: Target;
  profileId: string;
  score: number | null;
  verdict: Verdict;
  confidence: Confidence;
  /** Model whose key hour is used for the explanation. */
  referenceModel: string | null;
  byModel: WindowResult[];
}

export function verdictFor(score: number | null, gated: boolean, config: ScoringConfig): Verdict {
  if (score === null) return 'nodata';
  if (gated) return 'no';
  if (score >= config.verdict.go) return 'go';
  if (score >= config.verdict.maybe) return 'maybe';
  return 'no';
}

/** Weighted geometric mean of the factors that have a score. */
export function combineScores(factors: Pick<FactorResult, 'weight' | 'score'>[]): number | null {
  const scored = factors.filter((f) => f.score !== null && f.weight > 0);
  const totalWeight = scored.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return null;
  return scored.reduce((product, f) => product * Math.pow(f.score!, f.weight / totalWeight), 1);
}

function profileParts(profileId: string, config: ScoringConfig) {
  const definition = PROFILE_DEFINITIONS[profileId];
  const profileConfig = config.profiles[profileId];
  if (!definition || !profileConfig) throw new Error(`Unknown profile "${profileId}"`);
  return { definition, profileConfig };
}

export function evaluateHour(
  forecast: ModelForecast,
  i: number,
  target: Target,
  profileId: string,
  config: ScoringConfig,
  extras: HourExtras = {},
): HourResult {
  const { definition, profileConfig } = profileParts(profileId, config);
  const ctx = createHourContext(forecast, i, target, extras);

  const factors: FactorResult[] = Object.entries(definition.factors).map(([id, def]) => {
    const factorConfig = profileConfig.factors[id]!;
    const reading = def.read(ctx);
    const score =
      reading.score !== undefined
        ? reading.score
        : reading.value === null
          ? null
          : rampScore(rampOf(factorConfig), reading.value);
    return {
      id,
      label: def.label,
      unit: def.unit,
      weight: factorConfig.weight,
      value: reading.value,
      score,
      ...(reading.detail ? { detail: reading.detail } : {}),
    };
  });

  const gates: GateResult[] = Object.entries(definition.gates).map(([id, def]) => {
    const limit = profileConfig.gates[id]!;
    const value = def.read(ctx);
    const passed = value === null || ('max' in limit ? value <= limit.max : value >= limit.min);
    return { id, label: def.label, unit: def.unit, value, limit, passed };
  });

  const score = combineScores(factors);
  const gated = gates.some((g) => !g.passed);
  return {
    time: ctx.time,
    score,
    gated,
    verdict: verdictFor(score, gated, config),
    factors,
    gates,
  };
}

/** Indices of forecast hours whose start falls inside the window. */
export function hoursInWindow(forecast: ModelForecast, window: TimeWindow): number[] {
  const out: number[] = [];
  forecast.time.forEach((t, i) => {
    if (t >= window.start && t <= window.end) out.push(i);
  });
  return out;
}

export function evaluateWindow(
  forecast: ModelForecast,
  window: TimeWindow,
  target: Target,
  profileId: string,
  config: ScoringConfig,
  extras: HourExtras = {},
): WindowResult {
  const { profileConfig } = profileParts(profileId, config);
  const hours = hoursInWindow(forecast, window).map((i) =>
    evaluateHour(forecast, i, target, profileId, config, extras),
  );
  const withData = hours.filter((h) => h.score !== null);
  if (withData.length === 0) {
    return { model: forecast.model, score: null, verdict: 'nodata', keyHour: null, hours };
  }
  const { score, keyHour } = aggregate(withData, profileConfig);
  return {
    model: forecast.model,
    score,
    verdict: verdictFor(score, keyHour.gated, config),
    keyHour,
    hours,
  };
}

function aggregate(
  hours: HourResult[],
  profileConfig: ProfileConfig,
): { score: number; keyHour: HourResult } {
  const byScore = (a: HourResult, b: HourResult) => a.score! - b.score!;

  if (profileConfig.aggregate === 'best-hour') {
    const open = hours.filter((h) => !h.gated);
    if (open.length > 0) {
      const best = [...open].sort(byScore).at(-1)!;
      return { score: best.score!, keyHour: best };
    }
    // Every hour is gated: explain the hour that came closest.
    return { score: 0, keyHour: [...hours].sort(byScore).at(-1)! };
  }

  // `mean`: the whole window matters, and a single gated hour sinks it.
  const gatedHour = hours.find((h) => h.gated);
  if (gatedHour) return { score: 0, keyHour: gatedHour };
  const scores = hours.map((h) => h.score!);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const worst = [...hours].sort(byScore)[0]!;
  const score = Math.max(0, avg - profileConfig.worstHourPenalty * (avg - worst.score!));
  return { score, keyHour: worst };
}

export interface EvaluateOptions {
  /** "Now", epoch ms, for the confidence horizon. */
  now: number;
  extras?: HourExtras;
}

/**
 * Scores one target across every model. The headline score is the mean of the models'
 * window scores; their spread sets the confidence.
 */
export function evaluateTarget(
  forecasts: ModelForecast[],
  window: TimeWindow,
  target: Target,
  profileId: string,
  config: ScoringConfig,
  options: EvaluateOptions,
): TargetResult {
  const byModel = forecasts.map((f) =>
    evaluateWindow(f, window, target, profileId, config, options.extras),
  );
  const scored = byModel.filter((r) => r.score !== null);

  if (scored.length === 0) {
    return {
      target,
      profileId,
      score: null,
      verdict: 'nodata',
      confidence: 'low',
      referenceModel: null,
      byModel,
    };
  }

  const scores = scored.map((r) => r.score!);
  const score = scores.reduce((a, b) => a + b, 0) / scores.length;
  const spread = Math.max(...scores) - Math.min(...scores);
  // A majority of gated models means the hazard is real enough to say no.
  const gatedCount = scored.filter((r) => r.keyHour?.gated).length;
  const verdict = verdictFor(score, gatedCount > scored.length / 2, config);

  return {
    target,
    profileId,
    score,
    verdict,
    confidence: confidenceFor(spread, scored.length, window, config, options),
    referenceModel: pickReferenceModel(scored, config),
    byModel,
  };
}

export function confidenceFor(
  spread: number,
  modelCount: number,
  window: TimeWindow,
  config: ScoringConfig,
  options: EvaluateOptions,
): Confidence {
  const c = config.confidence;
  let level: Confidence = spread < c.high ? 'high' : spread < c.medium ? 'medium' : 'low';
  const beyondHorizon = window.start - options.now > c.highConfidenceHorizonHours * 3_600_000;
  // One model can't disagree with itself, so it can't earn High on its own.
  if (level === 'high' && (beyondHorizon || modelCount < 2)) level = 'medium';
  return level;
}

function pickReferenceModel(scored: WindowResult[], config: ScoringConfig): string {
  for (const id of config.modelPriority) {
    if (scored.some((r) => r.model === id)) return id;
  }
  return scored[0]!.model;
}

/** Sorts results best first: by verdict, then score. No-data results go last. */
export function rankResults(results: TargetResult[]): TargetResult[] {
  const order: Record<Verdict, number> = { go: 0, maybe: 1, no: 2, nodata: 3 };
  return [...results].sort(
    (a, b) => order[a.verdict] - order[b.verdict] || (b.score ?? -1) - (a.score ?? -1),
  );
}
