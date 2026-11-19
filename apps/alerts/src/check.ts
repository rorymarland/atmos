/**
 * One check: load Atmos's data from the website container, fetch forecasts for the places
 * people are watching, and score every condition for the next five days with the same code
 * the website uses.
 */
import {
  decodeHill,
  parseScoringConfig,
  waterAsPlace,
  decodeWaterBody,
  type Hill,
  type HillsFile,
  type ModelForecast,
  type ScoringConfig,
  type WaterBody,
  type WatersFile,
  type Zone,
  type CustomPlace,
  withPlaces,
  type ZonesFile,
} from '@atmos/engine';
import {
  fetchKpForecast,
  fetchZoneForecasts,
  HARMONIE_REQUEST,
  HORIZON_REQUEST,
  type CachedForecast,
  type ForecastCache,
  type KpBin,
} from '@atmos/data-client';
import {
  createEvaluateMemo,
  evaluatePlaces,
  horizonSites,
} from '../../web/src/lib/evaluate-places';
import { londonMidnight } from '../../web/src/lib/time';
import type { PlaceRef } from './model';
import type { DayConditions } from './rules';
import type { Feeder } from './forecasts';

export interface SiteData {
  hills: Map<number, Hill>;
  zones: Zone[];
  config: ScoringConfig;
  waters: WaterBody[] | null;
  waterIndex: Map<string, number>;
  /** Custom place ids to their hill numbers (see withCustomPlaces). */
  placeNumbers: Map<string, number>;
  loadedAt: number;
}

/** The site data with custom places added as hills, each with its own forecast zone. */
export function withCustomPlaces(data: SiteData, places: CustomPlace[]): SiteData {
  const merged = withPlaces({ hills: [], zones: data.zones, waters: data.waters }, places);
  const hills = new Map(data.hills);
  for (const h of merged.placeHills) hills.set(h.number, h);
  return {
    ...data,
    zones: merged.zones,
    hills,
    placeNumbers: new Map(places.map((p) => [p.id, p.number])),
  };
}

async function getJson<T>(base: string, name: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(`${base}/${name}`);
  if (!res.ok) throw new Error(`Couldn't load ${name} from the Atmos container (${res.status})`);
  return (await res.json()) as T;
}

/** Atmos's generated data, from the website container (it rebuilds it at start). */
export async function loadSiteData(
  base: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteData> {
  const [hills, others, zones, profiles] = await Promise.all([
    getJson<HillsFile>(base, 'hills.json', fetchImpl),
    getJson<HillsFile>(base, 'search-hills.json', fetchImpl).catch(
      () => ({ hills: [] }) as unknown as HillsFile,
    ),
    getJson<ZonesFile>(base, 'zones.json', fetchImpl),
    getJson<unknown>(base, 'profiles.json', fetchImpl),
  ]);
  const watersFile = await getJson<WatersFile>(base, 'waters.json', fetchImpl).catch(() => null);
  const waters = watersFile ? watersFile.waters.map(decodeWaterBody) : null;
  const all = [...hills.hills, ...others.hills].map(decodeHill);
  return {
    hills: new Map(all.map((h) => [h.number, h])),
    zones: zones.zones,
    config: parseScoringConfig(profiles),
    waters,
    waterIndex: new Map((waters ?? []).map((w, i) => [w.id, i])),
    placeNumbers: new Map(),
    loadedAt: Date.now(),
  };
}

/** The hill (or loch as a place) a saved reference points at, if it's still in the data. */
export function resolvePlace(ref: PlaceRef, data: SiteData): Hill | null {
  if (ref.kind === 'hill') return data.hills.get(ref.number) ?? null;
  if (ref.kind === 'custom') {
    const n = data.placeNumbers.get(ref.id);
    return n === undefined ? null : (data.hills.get(n) ?? null);
  }
  const i = data.waterIndex.get(ref.id);
  const body = i === undefined ? undefined : data.waters?.[i];
  return body && i !== undefined ? waterAsPlace(body, i) : null;
}

/** Forecasts kept in memory between checks: an hour old is fresh enough. */
class MemoryCache implements ForecastCache {
  #map = new Map<string, CachedForecast>();
  async get(key: string) {
    return this.#map.get(key);
  }
  async set(key: string, value: CachedForecast) {
    this.#map.set(key, value);
  }
}
const cache = new MemoryCache();
const MAX_AGE_MS = 55 * 60_000;

const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
/** The local date, YYYY-MM-DD, `dayOffset` days from now. */
export function londonDate(dayOffset: number, now = Date.now()): string {
  return dateFormat.format(londonMidnight(dayOffset, now) + 12 * 3_600_000);
}

export const FORECAST_DAYS = 5;

/** Fetches zones straight from Open-Meteo (no shared copy, or a zone it lacks). */
async function fetchDirect(
  zones: Zone[],
  now: number,
  horizons: Map<string, { am?: ModelForecast; pm?: ModelForecast }>,
): Promise<Map<string, ModelForecast[]>> {
  const out = new Map<string, ModelForecast[]>();
  if (zones.length === 0) return out;
  const main = await fetchZoneForecasts(zones, { cache, maxAgeMs: MAX_AGE_MS });
  const forecasts = new Map<string, ModelForecast[]>(main.map((r) => [r.zoneId, r.forecasts]));
  // HARMONIE, the horizon and Kp refine the scores; a failure there only costs the extra.
  const harmonie = await fetchZoneForecasts(zones, {
    request: HARMONIE_REQUEST,
    cache,
    maxAgeMs: MAX_AGE_MS,
  })
    .then((r) => new Map(r.map((x) => [x.zoneId, x.forecasts])))
    .catch(() => new Map<string, ModelForecast[]>());
  await fetchZoneForecasts(
    zones.flatMap((z) => horizonSites(z, now)),
    { request: HORIZON_REQUEST, cache, maxAgeMs: MAX_AGE_MS },
  )
    .then((res) => {
      for (const r of res) {
        const [zoneId, side] = r.zoneId.split('|') as [string, 'am' | 'pm'];
        horizons.set(zoneId, { ...horizons.get(zoneId), [side]: r.forecasts[0] });
      }
    })
    .catch(() => undefined);
  for (const z of zones)
    out.set(z.id, [...(forecasts.get(z.id) ?? []), ...(harmonie.get(z.id) ?? [])]);
  return out;
}

/**
 * Scores the places for today and the next four days. Places whose data has gone (a hill
 * renumbered, a loch dropped) are reported back so the alert can say so.
 */
export async function scorePlaces(
  refs: PlaceRef[],
  data: SiteData,
  now = Date.now(),
  shared?: Pick<Feeder, 'zone'>,
): Promise<{ days: DayConditions[]; missing: PlaceRef[] }> {
  const resolved: { ref: PlaceRef; hill: Hill }[] = [];
  const missing: PlaceRef[] = [];
  for (const ref of refs) {
    const hill = resolvePlace(ref, data);
    if (hill && data.zones[hill.zone]) resolved.push({ ref, hill });
    else missing.push(ref);
  }
  if (resolved.length === 0) return { days: [], missing };

  const zoneIds = new Set(resolved.map((r) => r.hill.zone));
  const zones = data.zones.filter((_, i) => zoneIds.has(i));

  // The shared copy first; only zones it doesn't hold yet are fetched here.
  const sharedModels = new Map<string, ModelForecast[]>();
  const horizons = new Map<string, { am?: ModelForecast; pm?: ModelForecast }>();
  const upper = new Map<string, ModelForecast>();
  for (const z of zones) {
    const s = shared?.zone(z.id);
    if (!s) continue;
    sharedModels.set(z.id, s.models);
    horizons.set(z.id, s.horizon);
    if (s.upper) upper.set(z.id, s.upper);
  }
  const direct = await fetchDirect(
    zones.filter((z) => !sharedModels.has(z.id)),
    now,
    horizons,
  );
  const kp: KpBin[] = await fetchKpForecast().catch(() => []);

  // One merged array per zone, so evaluatePlaces shares each zone's work across its places.
  const models = new Map<string, ModelForecast[]>();
  const modelsFor = (id: string) => {
    let m = models.get(id);
    if (!m) models.set(id, (m = sharedModels.get(id) ?? direct.get(id) ?? []));
    return m;
  };
  const days: DayConditions[] = [];
  const memo = createEvaluateMemo();
  const byNumber = new Map(resolved.map((r) => [r.hill.number, r.ref]));
  for (let d = 0; d < FORECAST_DAYS; d++) {
    const evaluated = evaluatePlaces({
      hills: resolved.map((r) => r.hill),
      data: { zones: data.zones, config: data.config, waters: data.waters },
      dayOffset: d,
      now,
      modelsFor,
      horizonsFor: (id) => horizons.get(id),
      kp,
      memo,
    });
    const date = londonDate(d, now);
    for (const e of evaluated) {
      const ref = byNumber.get(e.hill.number);
      if (ref)
        days.push({
          place: ref,
          date,
          dayOffset: d,
          conditions: e.conditions,
          hill: e.hill,
          sun: e.sun,
          valleyM: e.valleyM,
          upper: upper.get(e.zone.id),
        });
    }
  }
  return { days, missing };
}
