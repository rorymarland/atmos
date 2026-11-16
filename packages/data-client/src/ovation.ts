/**
 * NOAA SWPC OVATION aurora nowcast: the chance of visible aurora on a 1° grid for the
 * next 30 to 90 minutes. Free, keyless, served with CORS. Only "now" exists: there is no
 * OVATION forecast for later nights (use the Kp forecast for those).
 */
export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

export interface OvationCell {
  lat: number;
  /** -180 to 180. */
  lon: number;
  /** Chance of visible aurora overhead, percent. */
  chance: number;
}

export interface Ovation {
  observedAt: number;
  forecastFor: number;
  cells: OvationCell[];
}

/** The UK and a margin around it, so the oval's edge shows north and west of the coast. */
export const OVATION_BOX = { south: 48, north: 64, west: -14, east: 5 };

export function parseOvation(json: unknown, box = OVATION_BOX): Ovation {
  const j = json as {
    'Observation Time'?: string;
    'Forecast Time'?: string;
    coordinates?: [number, number, number][];
  };
  const cells: OvationCell[] = [];
  for (const [lon360, lat, chance] of j.coordinates ?? []) {
    const lon = lon360 > 180 ? lon360 - 360 : lon360;
    if (lat < box.south || lat > box.north || lon < box.west || lon > box.east) continue;
    cells.push({ lat, lon, chance });
  }
  return {
    observedAt: Date.parse(j['Observation Time'] ?? ''),
    forecastFor: Date.parse(j['Forecast Time'] ?? ''),
    cells,
  };
}

export async function fetchOvation(fetchImpl: typeof fetch = fetch): Promise<Ovation> {
  const res = await fetchImpl(OVATION_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Aurora nowcast unavailable (${res.status})`);
  return parseOvation(await res.json());
}
