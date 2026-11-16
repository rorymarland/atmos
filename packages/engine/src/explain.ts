/**
 * Turns a result into the "why" list: failed gates first, then factors from worst to best,
 * then any models that disagree with the headline verdict.
 */
import type { FactorResult, GateResult, TargetResult } from './evaluate.js';
import { DEFAULT_FORMAT, formatValue, type FormatOptions } from './format.js';
import type { Verdict } from './types.js';

export type ReasonStatus = 'good' | 'ok' | 'poor' | 'blocked' | 'nodata' | 'info';

export interface Reason {
  status: ReasonStatus;
  text: string;
  /** Factor or gate id, or "models" for the disagreement note. */
  source: string;
}

const VERDICT_WORD: Record<Verdict, string> = {
  go: 'GO',
  maybe: 'MAYBE',
  no: 'NO',
  nodata: 'no data',
};

export function statusForScore(score: number | null): ReasonStatus {
  if (score === null) return 'nodata';
  if (score >= 0.8) return 'good';
  if (score >= 0.4) return 'ok';
  return 'poor';
}

function gateReason(g: GateResult, options: FormatOptions): Reason {
  const value = g.value === null ? 'unknown' : formatValue(g.value, g.unit, options);
  const limit =
    'max' in g.limit
      ? `limit ${formatValue(g.limit.max, g.unit, options)}`
      : `needs at least ${formatValue(g.limit.min, g.unit, options)}`;
  return { status: 'blocked', source: g.id, text: `${g.label} ${value}: ${limit}.` };
}

function factorReason(f: FactorResult, options: FormatOptions): Reason {
  const status = statusForScore(f.score);
  const value = f.value === null ? null : formatValue(f.value, f.unit, options);
  const parts = [value, f.detail].filter(Boolean).join(', ');
  const text =
    status === 'nodata' ? `${f.label}: no data from this model.` : `${f.label}: ${parts || 'n/a'}.`;
  return { status, source: f.id, text };
}

export function explain(result: TargetResult, options: FormatOptions = DEFAULT_FORMAT): Reason[] {
  const reference = result.byModel.find((m) => m.model === result.referenceModel);
  const hour = reference?.keyHour;
  if (!hour)
    return [{ status: 'nodata', source: 'models', text: 'No forecast data for this window.' }];

  const reasons: Reason[] = [];
  for (const g of hour.gates) if (!g.passed) reasons.push(gateReason(g, options));

  const factors = hour.factors
    .filter((f) => f.weight > 0)
    .sort((a, b) => (a.score ?? 2) - (b.score ?? 2));
  for (const f of factors) reasons.push(factorReason(f, options));

  const dissent = result.byModel.filter(
    (m) => m.verdict !== 'nodata' && m.verdict !== result.verdict,
  );
  if (dissent.length > 0) {
    const list = dissent.map((m) => `${m.model} says ${VERDICT_WORD[m.verdict]}`).join('; ');
    reasons.push({ status: 'info', source: 'models', text: `Models disagree: ${list}.` });
  }
  return reasons;
}
