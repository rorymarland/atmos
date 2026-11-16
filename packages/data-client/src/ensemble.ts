/**
 * Open-Meteo ensembles for one place: every run of ECMWF's 51-member ensemble, so a
 * forecast can say "41 of 51 runs keep it clear" instead of trusting one run. Fetched on
 * demand for the open hill only, which keeps it cheap.
 */
export const ENSEMBLE_MODEL = 'ecmwf_ifs025';
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
    if (keys.length) members[v] = keys.map((k) => hourly[k]!);
  }
  return { model, time, members };
}

export async function fetchEnsemble(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Ensemble> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    models: ENSEMBLE_MODEL,
    hourly: ENSEMBLE_VARIABLES.join(','),
    forecast_days: '5',
    timeformat: 'unixtime',
  });
  const res = await fetchImpl(`https://ensemble-api.open-meteo.com/v1/ensemble?${params}`);
  if (!res.ok) throw new Error(`Ensemble unavailable (${res.status})`);
  return parseEnsemble(await res.json());
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
