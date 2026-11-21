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

describe('Kp forecast', () => {
  it('reads both the row and the object formats', async () => {
    const { parseKpForecast, kpAt } = await import('./kp.js');
    const rows = parseKpForecast([
      ['time_tag', 'kp', 'observed', 'noaa_scale'],
      ['2026-11-16 00:00:00', '3.33', 'observed', null],
      ['2026-11-16 03:00:00', '5.67', 'predicted', 'G2'],
    ]);
    const objects = parseKpForecast([
      { time_tag: '2026-11-16T00:00:00', kp: 3.33 },
      { time_tag: '2026-11-16T03:00:00', kp: 5.67 },
    ]);
    expect(rows).toEqual(objects);
    expect(kpAt(rows, Date.UTC(2026, 10, 16, 4, 30))).toBeCloseTo(5.67);
    expect(kpAt(rows, Date.UTC(2026, 10, 17, 4))).toBeNull();
  });
});

describe('OVATION nowcast', () => {
  it('keeps the UK box and converts longitudes to -180..180', async () => {
    const { parseOvation } = await import('./ovation.js');
    const o = parseOvation({
      'Observation Time': '2026-11-16T18:00:00Z',
      'Forecast Time': '2026-11-16T18:45:00Z',
      coordinates: [
        [356, 58, 12],
        [2, 55, 3],
        [100, 58, 50],
        [356, 30, 0],
      ],
    });
    expect(o.cells).toEqual([
      { lat: 58, lon: -4, chance: 12 },
      { lat: 55, lon: 2, chance: 3 },
    ]);
    expect(o.forecastFor).toBe(Date.UTC(2026, 10, 16, 18, 45));
  });
});

describe('ensembles', () => {
  it('collects the control and member runs and counts shares', async () => {
    const { parseEnsemble, ensembleShare } = await import('./ensemble.js');
    const e = parseEnsemble({
      hourly: {
        time: [1000, 4600],
        cloud_cover: [10, 90],
        cloud_cover_member01: [20, 80],
        cloud_cover_member02: [70, null],
        wind_speed_10m: [5, 5],
      },
    });
    expect(e.members.cloud_cover).toHaveLength(3);
    expect(ensembleShare(e, 'cloud_cover', 1_000_000, (c) => c < 40)).toEqual({ yes: 2, of: 3 });
    expect(ensembleShare(e, 'cloud_cover', 4_600_000, (c) => c < 40)).toEqual({ yes: 0, of: 2 });
    expect(ensembleShare(e, 'visibility', 1_000_000, () => true)).toBeNull();
  });

  it('drops variables a model sends as all nulls', async () => {
    const { parseEnsemble } = await import('./ensemble.js');
    const e = parseEnsemble({
      hourly: {
        time: [1000],
        cloud_cover_low: [null],
        cloud_cover_low_member01: [null],
        cloud_cover: [5],
      },
    });
    expect(e.members.cloud_cover_low).toBeUndefined();
    expect(e.members.cloud_cover).toHaveLength(1);
  });

  it('builds the Met Office ensemble from MOGREPS-G with MOGREPS-UK low cloud', async () => {
    const { fetchMetOfficeEnsemble, ensembleShare, MET_OFFICE_GLOBAL, MET_OFFICE_UK } =
      await import('./ensemble.js');
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const body = url.includes(MET_OFFICE_UK)
        ? {
            hourly: {
              time: [4600, 8200],
              cloud_cover_low: [90, 10],
              cloud_cover_low_member01: [80, 20],
            },
          }
        : {
            hourly: {
              time: [1000, 4600],
              cloud_cover: [10, 20],
              cloud_cover_member01: [50, 60],
              cloud_cover_low: [null, null],
              cloud_cover_low_member01: [null, null],
            },
          };
      return new Response(JSON.stringify(body));
    }) as typeof fetch;
    const e = await fetchMetOfficeEnsemble(56.8, -5, fake);
    expect(urls.some((u) => u.includes(MET_OFFICE_GLOBAL))).toBe(true);
    expect(e.model).toBe(MET_OFFICE_GLOBAL);
    expect(e.sources?.cloud_cover_low).toBe(MET_OFFICE_UK);
    // 1000 s isn't in MOGREPS-UK, so no low-cloud runs there; 4600 s has both.
    expect(ensembleShare(e, 'cloud_cover_low', 1_000_000, () => true)).toBeNull();
    expect(ensembleShare(e, 'cloud_cover_low', 4_600_000, (v) => v > 70)).toEqual({
      yes: 2,
      of: 2,
    });
    expect(ensembleShare(e, 'cloud_cover', 1_000_000, (v) => v < 30)).toEqual({ yes: 1, of: 2 });
  });

  it('keeps MOGREPS-G when MOGREPS-UK fails', async () => {
    const { fetchMetOfficeEnsemble, MET_OFFICE_UK } = await import('./ensemble.js');
    const fake = (async (url: string) =>
      url.includes(MET_OFFICE_UK)
        ? new Response('no', { status: 500 })
        : new Response(
            JSON.stringify({ hourly: { time: [1000], cloud_cover: [10] } }),
          )) as typeof fetch;
    const e = await fetchMetOfficeEnsemble(56.8, -5, fake);
    expect(e.members.cloud_cover).toHaveLength(1);
    expect(e.members.cloud_cover_low).toBeUndefined();
  });
});

describe('Overpass', () => {
  it('asks for highways and car parks around the summit', async () => {
    const { overpassQuery } = await import('./overpass.js');
    const q = overpassQuery(56.79686, -5.0036, 5000);
    expect(q).toMatch(
      /way\["highway"\]\["highway"!~"\^\(motorway\|[^"]*\)\$"\]\(around:5000,56\.79686,-5\.00360\)/,
    );
    expect(q).toContain('nw["amenity"="parking"](around:5000,56.79686,-5.00360)');
    expect(q).toContain('out body geom qt;');
    expect(q).not.toContain('>;');
  });

  it('reads way nodes from inline geometry (out geom)', async () => {
    const { parseOverpass } = await import('./overpass.js');
    const area = parseOverpass({
      elements: [
        {
          type: 'way',
          id: 1,
          nodes: [10, 11, 12],
          geometry: [{ lat: 56, lon: -5 }, null, { lat: 56.2, lon: -5.2 }],
          tags: { highway: 'path' },
        },
        {
          type: 'way',
          id: 2,
          nodes: [20, 21],
          geometry: [
            { lat: 56, lon: -5 },
            { lat: 56.02, lon: -5 },
          ],
          tags: { amenity: 'parking' },
        },
      ],
    });
    expect(area.ways).toHaveLength(1);
    expect(area.nodes.get(10)).toEqual({ lat: 56, lon: -5 });
    expect(area.nodes.has(11)).toBe(false);
    expect(area.nodes.size).toBe(4);
    expect(area.parkings[0]!.lat).toBeCloseTo(56.01);
  });

  it('reads nodes, highways and public car parks (points and areas)', async () => {
    const { parseOverpass } = await import('./overpass.js');
    const area = parseOverpass({
      elements: [
        { type: 'way', id: 1, nodes: [10, 11], tags: { highway: 'path' } },
        {
          type: 'way',
          id: 2,
          nodes: [20, 21, 22],
          tags: { amenity: 'parking', name: 'Glen Nevis' },
        },
        { type: 'way', id: 3, nodes: [20, 21], tags: { amenity: 'parking', access: 'private' } },
        { type: 'node', id: 30, lat: 56.5, lon: -5, tags: { amenity: 'parking' } },
        { type: 'node', id: 10, lat: 56.0, lon: -5.0 },
        { type: 'node', id: 11, lat: 56.1, lon: -5.1 },
        { type: 'node', id: 20, lat: 56.0, lon: -5.0 },
        { type: 'node', id: 21, lat: 56.0, lon: -5.02 },
        { type: 'node', id: 22, lat: 56.03, lon: -5.01 },
      ],
    });
    expect(area.ways).toHaveLength(1);
    expect(area.nodes.size).toBe(6);
    expect(area.parkings).toHaveLength(2);
    expect(area.parkings).toContainEqual({ lat: 56.5, lon: -5 });
    const glen = area.parkings.find((p) => p.name === 'Glen Nevis')!;
    expect(glen.lat).toBeCloseTo(56.01);
    expect(glen.lon).toBeCloseTo(-5.01);
  });

  it('falls back to the mirror when the main server fails', async () => {
    const { fetchOsmArea, OVERPASS_ENDPOINTS } = await import('./overpass.js');
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      return url === OVERPASS_ENDPOINTS[0]
        ? new Response('busy', { status: 429 })
        : new Response(JSON.stringify({ elements: [] }), { status: 200 });
    };
    const area = await fetchOsmArea(56, -5, 5000, f as unknown as typeof fetch);
    expect(area.ways).toEqual([]);
    expect(calls).toEqual(OVERPASS_ENDPOINTS);
  });
});

describe('Overpass time limit', () => {
  it('gives up on a slow server and asks the mirror', async () => {
    const { fetchOsmArea, OVERPASS_ENDPOINTS } = await import('./overpass.js');
    const calls: string[] = [];
    const f = (url: string, init: RequestInit) => {
      calls.push(url);
      if (url === OVERPASS_ENDPOINTS[0]) {
        // Never answers until aborted.
        return new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ elements: [] }), { status: 200 }));
    };
    const started = Date.now();
    const area = await fetchOsmArea(56, -5, 5000, f as unknown as typeof fetch, 50);
    expect(area.ways).toEqual([]);
    expect(calls).toEqual(OVERPASS_ENDPOINTS);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('waits long enough for the main server’s usual 30 to 45 s', async () => {
    const { OVERPASS_TIMEOUT_MS, MIRROR_TIMEOUT_MS } = await import('./overpass.js');
    expect(OVERPASS_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(MIRROR_TIMEOUT_MS).toBeLessThan(OVERPASS_TIMEOUT_MS);
  });
});

describe('the air quality request', () => {
  it('asks the air quality API for haze and dust, without models or wind units', async () => {
    const { AIR_REQUEST, buildForecastUrl, estimateCallWeight } = await import('./index.js');
    const req = { ...AIR_REQUEST, points: [{ lat: 56.5, lon: -4.5 }] };
    const url = new URL(buildForecastUrl(req));
    expect(url.hostname).toBe('air-quality-api.open-meteo.com');
    expect(url.searchParams.get('hourly')).toBe('aerosol_optical_depth,dust');
    expect(url.searchParams.has('models')).toBe(false);
    expect(url.searchParams.has('wind_speed_unit')).toBe(false);
    expect(estimateCallWeight(req)).toBe(1);
  });
});
