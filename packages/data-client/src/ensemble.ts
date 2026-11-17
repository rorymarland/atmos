/**
 * Open-Meteo ensembles for one place, so a forecast can say "41 of 51 runs keep it clear"
 * instead of trusting one run. Two independent families: ECMWF's 51-member ensemble and
 * the Met Office's own (MOGREPS). Fetched on demand for the open hill only, which keeps
 * it cheap.
 */
export const ENSEMBLE_MODEL = 'ecmwf_ifs025';
/** MOGREPS-G: 18 members, 20 km, 8 days. Publishes no low cloud. */
export const MET_OFFICE_GLOBAL = 'ukmo_global_ensemble_20km';
/** MOGREPS-UK: 3 members per hourly run, 2 km, 5 days. Used for low cloud only. */
export const MET_OFFICE_UK = 'ukmo_uk_ensemble_2km';
export const ENSEMBLE_VARIABLES = [
  'cloud_cover',
  'cloud_cover_low',
  'precipitation',
  'wind_speed_10m',
  'visibility',
] as const;
export type EnsembleVariable = (typeof ENSEMBLE_VARIABLES)[number];

export interface Ensemble {
  model: string;
  /** Where a variable came from when it isn't `model` (the Met Office low cloud). */
  sources?: Partial<Record<EnsembleVariable, string>>;
  time: number[];
  /** Per variable, one series per member (the control run first). */
  members: Partial<Record<EnsembleVariable, (number | null)[][]>>;
}

export function parseEnsemble(json: unknown, model = ENSEMBLE_MODEL): Ensemble {
  const hourly = (json as { hourly?: Record<string, (number | null)[]> }).hourly ?? {};
  const time = (hourly.time ?? []).map((t) => (t ?? 0) * 1000);
  const members: Ensemble['members'] = {};
  for (const v of ENSEMBLE_VARIABLES) {
    // "cloud_cover" is the control run, "cloud_cover_member01" onwards the others.
    const keys = Object.keys(hourly)
      .filter((k) => k === v || new RegExp(`^${v}_member\\d+$`).test(k))
      .sort();
    const runs = keys.map((k) => hourly[k]!);
    // A model that doesn't publish a variable sends every member as nulls.
    if (runs.some((r) => r.some((x) => x !== null && x !== undefined))) members[v] = runs;
  }
  return { model, time, members };
}

export async function fetchEnsemble(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = fetch,
  model: string = ENSEMBLE_MODEL,
  variables: readonly EnsembleVariable[] = ENSEMBLE_VARIABLES,
): Promise<Ensemble> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    models: model,
    hourly: variables.join(','),
    forecast_days: '5',
    timeformat: 'unixtime',
  });
  const res = await fetchImpl(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`);
  if (!res.ok) throw new Error(`Ensemble unavailable (${res.status})`);
  return parseEnsemble(await res.json(), model);
}

/**
 * Fills the variables `base` lacks from `extra`, matching hours by time. Hours `extra`
 * doesn't cover are left null.
 */
export function mergeEnsembles(base: Ensemble, extra: Ensemble): Ensemble {
  const members = { ...base.members };
  const sources = { ...base.sources };
  const at = new Map(extra.time.map((t, i) => [t, i]));
  for (const v of ENSEMBLE_VARIABLES) {
    const runs = extra.members[v];
    if (members[v] || !runs) continue;
    members[v] = runs.map((r) =>
      base.time.map((t) => {
        const i = at.get(t);
        return i === undefined ? null : (r[i] ?? null);
      }),
    );
    sources[v] = extra.model;
  }
  return { ...base, members, sources };
}

/**
 * The Met Office's ensemble: MOGREPS-G for everything it publishes, with MOGREPS-UK's
 * runs for low cloud, which MOGREPS-G leaves out. MOGREPS-UK failing only loses low cloud.
 */
export async function fetchMetOfficeEnsemble(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Ensemble> {
  const [global, uk] = await Promise.allSettled([
    fetchEnsemble(lat, lon, fetchImpl, MET_OFFICE_GLOBAL),
    fetchEnsemble(lat, lon, fetchImpl, MET_OFFICE_UK, ['cloud_cover_low']),
  ]);
  if (global.status === 'rejected') throw global.reason;
  return uk.status === 'fulfilled' ? mergeEnsembles(global.value, uk.value) : global.value;
}

/**
 * Of the members with a value at `time`, how many pass `test`. Null when the ensemble
 * doesn't reach that hour.
 */
export function ensembleShare(
  e: Ensemble,
  variable: EnsembleVariable,
  time: number,
  test: (value: number) => boolean,
): { yes: number; of: number } | null {
  const i = e.time.indexOf(time);
  const runs = e.members[variable];
  if (i < 0 || !runs) return null;
  const values = runs.map((r) => r[i]).filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return null;
  return { yes: values.filter(test).length, of: values.length };
}
