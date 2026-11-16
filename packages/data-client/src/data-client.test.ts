import { describe, expect, it, vi } from 'vitest';
import type { Zone } from '@atmos/engine';
import {
  buildForecastUrl,
  estimateCallWeight,
  parseForecastResponse,
  type ForecastRequest,
} from './open-meteo.js';
import {
  cacheKey,
  estimateZonesWeight,
  fetchZoneForecasts,
  ForecastError,
  type CachedForecast,
} from './zones.js';

const T = 1_764_568_800; // 2025-12-01 06:00 UTC, seconds

const req: ForecastRequest = {
  points: [
    { lat: 56.244, lon: -4.214 },
    { lat: 56.819, lon: -5.105 },
  ],
  models: ['ukmo_seamless', 'ecmwf_ifs025'],
  surface: ['temperature2m', 'cloudCoverLow'],
  pressureLevels: [925],
  forecastDays: 2,
  pastDays: 1,
};

function location(elevation: number, offset: number) {
  return {
    latitude: 56,
    longitude: -4,
    elevation,
    hourly: {
      time: [T, T + 3600],
      temperature_2m_ukmo_seamless: [1 + offset, 2 + offset],
      temperature_2m_ecmwf_ifs025: [1.5 + offset, 2.5 + offset],
      cloud_cover_low_ukmo_seamless: [90, 80],
      cloud_cover_low_ecmwf_ifs025: [null, null],
      temperature_925hPa_ukmo_seamless: [5, 6],
      relative_humidity_925hPa_ukmo_seamless: [40, 45],
      wind_speed_925hPa_ukmo_seamless: [10, 12],
      geopotential_height_925hPa_ukmo_seamless: [760, 765],
      temperature_925hPa_ecmwf_ifs025: [4, 5],
      relative_humidity_925hPa_ecmwf_ifs025: [50, 55],
      wind_speed_925hPa_ecmwf_ifs025: [11, 13],
      geopotential_height_925hPa_ecmwf_ifs025: [null, null],
    },
  };
}

describe('Open-Meteo requests', () => {
  it('builds a batched URL with unix times in GMT', () => {
    const url = new URL(buildForecastUrl(req));
    expect(url.searchParams.get('latitude')).toBe('56.2440,56.8190');
    expect(url.searchParams.get('models')).toBe('ukmo_seamless,ecmwf_ifs025');
    expect(url.searchParams.get('hourly')).toBe(
      'temperature_2m,cloud_cover_low,temperature_925hPa,relative_humidity_925hPa,wind_speed_925hPa,geopotential_height_925hPa',
    );
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('past_days')).toBe('1');
  });

  it('estimates call weight the way Open-Meteo counts it', () => {
    // 6 variables x 2 models = 12 series -> 1.2 per location; 3 days -> x1; 2 locations.
    expect(estimateCallWeight(req)).toBeCloseTo(2.4);
    // The zone overview for all 68 zones must stay under the 600-a-minute limit.
    expect(estimateZonesWeight(68)).toBeLessThan(600);
  });
});

describe('parseForecastResponse', () => {
  const parsed = parseForecastResponse([location(80, 0), location(30, 10)], req);

  it('returns one forecast per model per point, in request order', () => {
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.map((f) => f.model)).toEqual(['ukmo_seamless', 'ecmwf_ifs025']);
    expect(parsed[1]![0]!.surface.temperature2m).toEqual([11, 12]);
    expect(parsed[0]![0]!.groundElevationM).toBe(80);
    expect(parsed[0]![0]!.time).toEqual([T * 1000, (T + 3600) * 1000]);
  });

  it('drops series that are entirely null', () => {
    expect(parsed[0]![1]!.surface.cloudCoverLow).toBeUndefined();
    expect(parsed[0]![0]!.surface.cloudCoverLow).toEqual([90, 80]);
  });

  it('builds pressure levels, skipping any without heights', () => {
    const ukmo = parsed[0]![0]!;
    expect(ukmo.levels).toEqual([
      {
        kind: 'pressure',
        label: '925hPa',
        heightM: [760, 765],
        temperatureC: [5, 6],
        relativeHumidity: [40, 45],
        windSpeedKmh: [10, 12],
      },
    ]);
    expect(parsed[0]![1]!.levels).toEqual([]);
  });

  it('reads unsuffixed keys when only one model is requested', () => {
    const single = { ...req, points: [req.points[0]!], models: ['ukmo_seamless'] };
    const loc = {
      latitude: 56,
      longitude: -4,
      elevation: 80,
      hourly: { time: [T], temperature_2m: [3] },
    };
    expect(parseForecastResponse(loc, single)[0]![0]!.surface.temperature2m).toEqual([3]);
  });

  it('rejects a response with the wrong number of locations', () => {
    expect(() => parseForecastResponse([location(1, 0)], req)).toThrow(/Expected 2 locations/);
  });
});

describe('fetchZoneForecasts', () => {
  const zone = (id: string, lat: number): Zone => ({
    id,
    name: id,
    nation: 'scotland',
    forecastPoint: { lat, lon: -4 },
  });
  const zones = [zone('a', 56), zone('b', 57), zone('c', 58)];

  function fakeFetch() {
    return vi.fn(async (url: string) => {
      const n = new URL(url).searchParams.get('latitude')!.split(',').length;
      const body = Array.from({ length: n }, (_, i) => ({
        latitude: 0,
        longitude: 0,
        elevation: 100 + i,
        hourly: { time: [T], temperature_2m_ukmo_seamless: [i], temperature_2m_ecmwf_ifs025: [i] },
      }));
      return new Response(JSON.stringify(body), { status: 200 });
    });
  }

  function memoryCache() {
    const store = new Map<string, CachedForecast>();
    return {
      store,
      get: async (k: string) => store.get(k),
      set: async (k: string, v: CachedForecast) => void store.set(k, v),
    };
  }

  it('batches zones into chunks and keeps results in zone order', async () => {
    const f = fakeFetch();
    const result = await fetchZoneForecasts(zones, {
      fetch: f as unknown as typeof fetch,
      chunkSize: 2,
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(result.map((r) => r.zoneId)).toEqual(['a', 'b', 'c']);
    expect(result[2]!.forecasts[0]!.groundElevationM).toBe(100);
  });

  it('reuses fresh cache entries and refetches stale ones', async () => {
    const cache = memoryCache();
    let clock = 1_000_000;
    const now = () => clock;
    const f = fakeFetch();
    const opts = { fetch: f as unknown as typeof fetch, cache, now, maxAgeMs: 60_000 };

    await fetchZoneForecasts(zones, opts);
    expect(f).toHaveBeenCalledTimes(1);
    expect(cache.store.has(cacheKey(zones[0]!))).toBe(true);

    clock += 30_000;
    const again = await fetchZoneForecasts(zones, opts);
    expect(f).toHaveBeenCalledTimes(1);
    expect(again.every((r) => r.fromCache)).toBe(true);

    clock += 60_000;
    await fetchZoneForecasts(zones, opts);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('explains a rate-limit response', async () => {
    const f = vi.fn(async () => new Response('Too many requests', { status: 429 }));
    await expect(
      fetchZoneForecasts(zones, { fetch: f as unknown as typeof fetch }),
    ).rejects.toMatchObject({
      constructor: ForecastError,
      status: 429,
      message: expect.stringMatching(/rate limit/),
    });
  });
});
