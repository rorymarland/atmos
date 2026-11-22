/**
 * Ensembles for whoever asks, fetched once and shared: opening a hill costs about 36 of
 * Open-Meteo's call-equivalents, so browsers ask here first. Places are rounded to 0.1°
 * (the ensembles' own grids are 20 to 25 km, so this changes nothing that matters), kept
 * for two hours, and paid for from the same daily budget as the shared forecasts.
 */
import {
  ENSEMBLE_WEIGHTS,
  fetchEnsemble,
  fetchMetOfficeEnsemble,
  type Ensemble,
} from '@atmos/data-client';

export type EnsembleFamily = keyof typeof ENSEMBLE_WEIGHTS;
export const ENSEMBLE_FAMILIES = Object.keys(ENSEMBLE_WEIGHTS) as EnsembleFamily[];

const KEEP_MS = 2 * 3_600_000;
const MAX_KEPT = 400;
/** Of the day's Open-Meteo allowance, at most this much on ensembles. */
export const ENSEMBLE_DAILY_CAP = 2_000;

export interface EnsembleBudget {
  /** Call-equivalents spent on everything in the last 24 hours. */
  spentToday(): number;
  /** Records a spend. */
  spend(weight: number): void;
  /** The overall daily ceiling. */
  dailyLimit: number;
}

export class EnsembleCache {
  #kept = new Map<string, { at: number; data: Ensemble }>();
  #pending = new Map<string, Promise<Ensemble>>();
  #spent: { at: number; weight: number }[] = [];

  constructor(
    private opts: {
      budget: EnsembleBudget;
      fetch?: typeof fetch;
      now?: () => number;
    },
  ) {}

  #now() {
    return this.opts.now?.() ?? Date.now();
  }

  /** Rounds a place to the 0.1° square it shares with its neighbours. */
  static square(lat: number, lon: number): { lat: number; lon: number; key: string } {
    const la = Math.round(lat * 10) / 10;
    const lo = Math.round(lon * 10) / 10;
    return { lat: la, lon: lo, key: `${la.toFixed(1)},${lo.toFixed(1)}` };
  }

  /** Spent on ensembles in the last 24 hours. */
  spentToday(): number {
    const since = this.#now() - 24 * 3_600_000;
    this.#spent = this.#spent.filter((s) => s.at > since);
    return this.#spent.reduce((a, s) => a + s.weight, 0);
  }

  /**
   * The ensemble for a place: from the cache, or fetched if there's room in the budget.
   * Null when there isn't (the browser then fetches its own).
   */
  async get(family: EnsembleFamily, lat: number, lon: number): Promise<Ensemble | null> {
    const sq = EnsembleCache.square(lat, lon);
    const key = `${family}|${sq.key}`;
    const kept = this.#kept.get(key);
    if (kept && this.#now() - kept.at < KEEP_MS) return kept.data;
    const pending = this.#pending.get(key);
    if (pending) return pending;
    const weight = ENSEMBLE_WEIGHTS[family];
    const b = this.opts.budget;
    if (this.spentToday() + weight > ENSEMBLE_DAILY_CAP) return null;
    // Leave the shared forecasts their room: ensembles stop well before the overall limit.
    if (b.spentToday() + weight > b.dailyLimit * 0.85) return null;
    const f = this.opts.fetch ?? fetch;
    const job = (
      family === 'ecmwf'
        ? fetchEnsemble(sq.lat, sq.lon, f)
        : fetchMetOfficeEnsemble(sq.lat, sq.lon, f)
    ).then((data) => {
      // Counted once Open-Meteo has answered: a failed connection costs nothing.
      this.#spent.push({ at: this.#now(), weight });
      b.spend(weight);
      this.#kept.set(key, { at: this.#now(), data });
      if (this.#kept.size > MAX_KEPT) this.#kept.delete(this.#kept.keys().next().value!);
      return data;
    });
    this.#pending.set(key, job);
    try {
      return await job;
    } finally {
      this.#pending.delete(key);
    }
  }

  /** For the check page. */
  status() {
    return {
      kept: this.#kept.size,
      spentToday: Math.round(this.spentToday()),
      dailyCap: ENSEMBLE_DAILY_CAP,
    };
  }
}
