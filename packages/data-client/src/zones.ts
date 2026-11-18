/**
 * Fetching forecasts for zones: one batched Open-Meteo request per chunk of zones,
 * with a pluggable cache so the browser can keep responses in IndexedDB.
 */
import type { ModelForecast } from '@atmos/engine';
import {
  buildForecastUrl,
  estimateCallWeight,
  hasData,
  parseForecastResponse,
  type ForecastRequest,
} from './open-meteo.js';

/** What the zone overview fetches. Kept small: see estimateCallWeight. */
export const ZONE_REQUEST: Omit<ForecastRequest, 'points'> = {
  // Combined UKV 2 km (about 61 h) + UKMO Global (7 days), plus ECMWF as an independent
  // second opinion. Confirmed with the browser check at /check.
  models: ['ukmo_seamless', 'ecmwf_ifs025'],
  surface: [
    'temperature2m',
    'relativeHumidity2m',
    'windSpeed10m',
    'windGusts10m',
    'precipitation',
    'precipitationProbability',
    'cloudCover',
    'cloudCoverLow',
    'cloudCoverMid',
    'cloudCoverHigh',
    'visibility',
    'pressureMsl',
    'freezingLevelHeight',
    'showers',
  ],
  // Roughly 100, 300, 550, 750, 1,000 and 1,450 m: where UK inversions and summits sit.
  // ECMWF only publishes 1000, 925 and 850 of these; the Met Office has them all.
  pressureLevels: [1000, 975, 950, 925, 900, 850],
  forecastDays: 5,
  // Two days back: snow that fell yesterday, and the cold spell behind frozen lochs.
  pastDays: 2,
};

/**
 * KNMI's HARMONIE-AROME Europe (5.5 km): a third, independent model for the first two
 * and a half days, for the agreement rule. Fetched separately so a failure here never
 * loses the main forecast. It publishes 925 and 850 hPa among our levels.
 */
export const HARMONIE_REQUEST: Omit<ForecastRequest, 'points'> = {
  models: ['knmi_harmonie_arome_europe'],
  surface: ZONE_REQUEST.surface.filter((v) => v !== 'precipitationProbability'),
  pressureLevels: [925, 850],
  forecastDays: 3,
  pastDays: 2,
};

/** Cloud towards the sunrise and sunset: two cheap variables from one model. */
export const HORIZON_REQUEST: Omit<ForecastRequest, 'points'> = {
  models: ['ukmo_seamless'],
  surface: ['cloudCoverLow', 'cloudCoverMid'],
  pressureLevels: [],
  forecastDays: 5,
  pastDays: 0,
};

/** Anything with an id and a point to forecast: a zone, or a horizon point. */
export interface ForecastSite {
  id: string;
  forecastPoint: { lat: number; lon: number };
}

/**
 * Open-Meteo allows 600 call-equivalents a minute. Requests wait here so a big refresh
 * (main forecast, then HARMONIE, then horizons) spreads itself over the minute boundary
 * instead of hitting the limit. Shared by every request from this page.
 */
const BUDGET_PER_MINUTE = 540;
const spent: { at: number; weight: number }[] = [];
async function withinBudget(weight: number, now: () => number): Promise<void> {
  for (;;) {
    const t = now();
    while (spent.length && t - spent[0]!.at > 60_000) spent.shift();
    const used = spent.reduce((a, b) => a + b.weight, 0);
    if (used + weight <= BUDGET_PER_MINUTE || spent.length === 0) {
      spent.push({ at: t, weight });
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(500, spent[0]!.at + 60_500 - t)));
  }
}

export interface CachedForecast {
  fetchedAt: number;
  forecasts: ModelForecast[];
}

export interface ForecastCache {
  get(key: string): Promise<CachedForecast | undefined>;
  set(key: string, value: CachedForecast): Promise<void>;
}

export interface FetchZonesOptions {
  /** What to fetch: the main zone request unless given. */
  request?: Omit<ForecastRequest, 'points'>;
  cache?: ForecastCache;
  /** Cached data younger than this is reused. */
  maxAgeMs?: number;
  /** Zones per request: keeps URLs and responses a manageable size. */
  chunkSize?: number;
  fetch?: typeof fetch;
  now?: () => number;
  /** Called as each chunk arrives, for progressive rendering. */
  onProgress?: (done: number, total: number) => void;
}

export interface ZoneForecasts {
  zoneId: string;
  fetchedAt: number;
  forecasts: ModelForecast[];
  fromCache: boolean;
}

/** Open-Meteo's own words for a refusal ("Daily API request limit exceeded…"), if any. */
export function limitReason(body: string): string | null {
  try {
    const r = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof r === 'string' ? r : null;
  } catch {
    return null;
  }
}

/** Whether a refusal was for the day's allowance rather than the minute's. */
export function isDailyLimit(message: string): boolean {
  return /daily/i.test(message);
}

export class ForecastError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function cacheKey(
  zone: ForecastSite,
  r: Omit<ForecastRequest, 'points'> = ZONE_REQUEST,
): string {
  const p = zone.forecastPoint;
  return [
    'zone',
    zone.id,
    p.lat.toFixed(4),
    p.lon.toFixed(4),
    r.models.join('+'),
    r.surface.join('+'),
    r.pressureLevels.join('+'),
    r.forecastDays,
    r.pastDays,
  ].join('|');
}

export async function fetchZoneForecasts(
  zones: ForecastSite[],
  options: FetchZonesOptions = {},
): Promise<ZoneForecasts[]> {
  const {
    request = ZONE_REQUEST,
    cache,
    maxAgeMs = 60 * 60 * 1000,
    chunkSize = 17,
    fetch: doFetch = globalThis.fetch.bind(globalThis),
    now = Date.now,
    onProgress,
  } = options;

  const results = new Map<string, ZoneForecasts>();
  const missing: ForecastSite[] = [];
  for (const zone of zones) {
    const hit = await cache?.get(cacheKey(zone, request));
    if (hit && now() - hit.fetchedAt < maxAgeMs) {
      results.set(zone.id, { zoneId: zone.id, ...hit, fromCache: true });
    } else {
      missing.push(zone);
    }
  }

  const chunks: ForecastSite[][] = [];
  for (let i = 0; i < missing.length; i += chunkSize) chunks.push(missing.slice(i, i + chunkSize));
  let done = 0;
  onProgress?.(done, chunks.length);

  for (const chunk of chunks) {
    const req: ForecastRequest = { ...request, points: chunk.map((z) => z.forecastPoint) };
    await withinBudget(estimateCallWeight(req), now);
    const res = await doFetch(buildForecastUrl(req));
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const said = limitReason(body);
      const reason =
        res.status === 429
          ? `Open-Meteo rate limit reached${said ? ` (${said})` : '; try again in a minute'}`
          : body.slice(0, 200);
      throw new ForecastError(`Forecast request failed (${res.status}): ${reason}`, res.status);
    }
    const parsed = parseForecastResponse(await res.json(), req);
    const fetchedAt = now();
    for (const [i, zone] of chunk.entries()) {
      const forecasts = parsed[i]!.filter(hasData);
      const entry = { fetchedAt, forecasts };
      await cache?.set(cacheKey(zone, request), entry);
      results.set(zone.id, { zoneId: zone.id, ...entry, fromCache: false });
    }
    onProgress?.(++done, chunks.length);
  }

  return zones.map((z) => results.get(z.id)!);
}

/** Estimated Open-Meteo call-equivalents to refresh these zones from scratch. */
export function estimateZonesWeight(zoneCount: number): number {
  return estimateCallWeight({
    ...ZONE_REQUEST,
    points: Array.from({ length: zoneCount }, () => ({ lat: 0, lon: 0 })),
  });
}
