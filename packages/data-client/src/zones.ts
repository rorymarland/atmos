/**
 * Fetching forecasts for zones: one batched Open-Meteo request per chunk of zones,
 * with a pluggable cache so the browser can keep responses in IndexedDB.
 */
import type { ModelForecast, Zone } from '@atmos/engine';
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
  // second opinion. Confirmed with the browser check in tools/spike.
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
  ],
  // Roughly 100, 300, 550, 750, 1,000 and 1,450 m: where UK inversions and summits sit.
  // ECMWF only publishes 1000, 925 and 850 of these; the Met Office has them all.
  pressureLevels: [1000, 975, 950, 925, 900, 850],
  forecastDays: 5,
  pastDays: 1,
};

export interface CachedForecast {
  fetchedAt: number;
  forecasts: ModelForecast[];
}

export interface ForecastCache {
  get(key: string): Promise<CachedForecast | undefined>;
  set(key: string, value: CachedForecast): Promise<void>;
}

export interface FetchZonesOptions {
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

export class ForecastError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export function cacheKey(zone: Zone): string {
  const r = ZONE_REQUEST;
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
  zones: Zone[],
  options: FetchZonesOptions = {},
): Promise<ZoneForecasts[]> {
  const {
    cache,
    maxAgeMs = 60 * 60 * 1000,
    chunkSize = 17,
    fetch: doFetch = globalThis.fetch.bind(globalThis),
    now = Date.now,
    onProgress,
  } = options;

  const results = new Map<string, ZoneForecasts>();
  const missing: Zone[] = [];
  for (const zone of zones) {
    const hit = await cache?.get(cacheKey(zone));
    if (hit && now() - hit.fetchedAt < maxAgeMs) {
      results.set(zone.id, { zoneId: zone.id, ...hit, fromCache: true });
    } else {
      missing.push(zone);
    }
  }

  const chunks: Zone[][] = [];
  for (let i = 0; i < missing.length; i += chunkSize) chunks.push(missing.slice(i, i + chunkSize));
  let done = 0;
  onProgress?.(done, chunks.length);

  for (const chunk of chunks) {
    const req: ForecastRequest = { ...ZONE_REQUEST, points: chunk.map((z) => z.forecastPoint) };
    const res = await doFetch(buildForecastUrl(req));
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const reason =
        res.status === 429
          ? 'Open-Meteo rate limit reached; try again in a minute'
          : body.slice(0, 200);
      throw new ForecastError(`Forecast request failed (${res.status}): ${reason}`, res.status);
    }
    const parsed = parseForecastResponse(await res.json(), req);
    const fetchedAt = now();
    for (const [i, zone] of chunk.entries()) {
      const forecasts = parsed[i]!.filter(hasData);
      const entry = { fetchedAt, forecasts };
      await cache?.set(cacheKey(zone), entry);
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
