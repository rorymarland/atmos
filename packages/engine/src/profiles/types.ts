import type { HourContext } from '../context.js';
import type { Unit } from '../types.js';

/**
 * A factor's reading for one hour. `value` is shown to people; `score`, when given,
 * overrides the ramp (used for "nothing to score": e.g. no low cloud means no cloud sea).
 */
export interface FactorReading {
  value: number | null;
  score?: number;
  /** Short extra context, e.g. "cloud top about 450 m". */
  detail?: string;
}

export interface FactorDefinition {
  label: string;
  unit: Unit;
  read(ctx: HourContext): FactorReading;
}

export interface GateDefinition {
  label: string;
  unit: Unit;
  /** null means the gate can't be judged this hour and is treated as passed. */
  read(ctx: HourContext): number | null;
}

/**
 * The code half of a profile: how each factor and gate is measured. Thresholds,
 * weights and limits come from config (config/profiles.yaml).
 */
export interface ProfileDefinition {
  id: string;
  factors: Record<string, FactorDefinition>;
  gates: Record<string, GateDefinition>;
}
