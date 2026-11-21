/**
 * Open-Meteo forecast requests and responses, converted to the engine's ModelForecast.
 *
 * Model ids and variable names follow Open-Meteo's documented API; the browser check
 * page (/check, apps/web/static/check) confirms them against the live service.
 */
import type { LevelSeries, ModelForecast, Series, SurfaceSeries } from '@atmos/engine';

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
/** Same service, same terms: CAMS air quality, haze and dust. */
export const OPEN_METEO_AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

/** Engine surface variable -> Open-Meteo hourly variable. */
export const SURFACE_VARIABLES: Record<keyof SurfaceSeries, string> = {
  temperature2m: 'temperature_2m',
  relativeHumidity2m: 'relative_humidity_2m',
  dewPoint2m: 'dew_point_2m',
  windSpeed10m: 'wind_speed_10m',
  windGusts10m: 'wind_gusts_10m',
  precipitation: 'precipitation',
  precipitationProbability: 'precipitation_probability',
  cloudCover: 'cloud_cover',
  cloudCoverLow: 'cloud_cover_low',
  cloudCoverMid: 'cloud_cover_mid',
  cloudCoverHigh: 'cloud_cover_high',
  visibility: 'visibility',
  pressureMsl: 'pressure_msl',
  freezingLevelHeight: 'freezing_level_height',
  showers: 'showers',
  aerosolOpticalDepth: 'aerosol_optical_depth',
  dust: 'dust',
};

export interface ForecastRequest {
  /** The weather forecast (default), or the air quality forecast (CAMS, no model choice). */
  endpoint?: 'forecast' | 'air';
  points: { lat: number; lon: number }[];
  models: string[];
  surface: (keyof SurfaceSeries)[];
  /** Pressure levels in hPa. Each brings temperature, humidity, wind and geopotential height. */
  pressureLevels: number[];
  /** Just these fields at each pressure level (all four when left out). */
  levelFields?: (keyof typeof PRESSURE_FIELDS)[];
  /** Days ahead, including today. */
  forecastDays: number;
  /** Days of history, for overnight factors on the first morning. */
  pastDays: number;
}

const PRESSURE_FIELDS = {
  temperatureC: 'temperature',
  relativeHumidity: 'relative_humidity',
  windSpeedKmh: 'wind_speed',
  heightM: 'geopotential_height',
} as const;

export function hourlyVariables(req: ForecastRequest): string[] {
  const surface = req.surface.map((v) => SURFACE_VARIABLES[v]);
  const fields =
    req.levelFields ?? (Object.keys(PRESSURE_FIELDS) as (keyof typeof PRESSURE_FIELDS)[]);
  const levels = req.pressureLevels.flatMap((p) =>
    fields.map((f) => `${PRESSURE_FIELDS[f]}_${p}hPa`),
  );
  return [...surface, ...levels];
}

/**
 * Open-Meteo's call weighting: more than 10 variables (per model) or more than 7 days
 * counts as more than one call, and each location counts separately.
 */
export function estimateCallWeight(req: ForecastRequest): number {
  const series = hourlyVariables(req).length * req.models.length;
  const days = req.forecastDays + req.pastDays;
  return req.points.length * Math.max(1, series / 10) * Math.max(1, days / 7);
}

export function buildForecastUrl(req: ForecastRequest): string {
  if (req.endpoint === 'air') {
    // One combined source (CAMS Europe where it covers, global beyond), so no models.
    const air = new URLSearchParams({
      latitude: req.points.map((p) => p.lat.toFixed(4)).join(','),
      longitude: req.points.map((p) => p.lon.toFixed(4)).join(','),
      hourly: hourlyVariables(req).join(','),
      forecast_days: String(req.forecastDays),
      past_days: String(req.pastDays),
      timeformat: 'unixtime',
      timezone: 'GMT',
    });
    return `${OPEN_METEO_AIR_URL}?${air.toString()}`;
  }
  const params = new URLSearchParams({
    latitude: req.points.map((p) => p.lat.toFixed(4)).join(','),
    longitude: req.points.map((p) => p.lon.toFixed(4)).join(','),
    models: req.models.join(','),
    hourly: hourlyVariables(req).join(','),
    forecast_days: String(req.forecastDays),
    past_days: String(req.pastDays),
    timeformat: 'unixtime',
    timezone: 'GMT',
    wind_speed_unit: 'kmh',
  });
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`;
}

interface LocationResponse {
  latitude: number;
  longitude: number;
  elevation: number;
  hourly: Record<string, (number | null)[]>;
}

/**
 * Splits a response into one ModelForecast per model for each requested point, in
 * request order. With several models, Open-Meteo suffixes each key with the model id.
 */
export function parseForecastResponse(json: unknown, req: ForecastRequest): ModelForecast[][] {
  const locations = (Array.isArray(json) ? json : [json]) as LocationResponse[];
  if (locations.length !== req.points.length) {
    throw new Error(`Expected ${req.points.length} locations, got ${locations.length}`);
  }
  return locations.map((loc) => {
    const times = loc.hourly.time;
    if (!times) throw new Error('Open-Meteo response has no hourly time axis');
    const time = times.map((t) => (t ?? 0) * 1000);
    return req.models.map((model) => toModelForecast(loc, model, req, time));
  });
}

function toModelForecast(
  loc: LocationResponse,
  model: string,
  req: ForecastRequest,
  time: number[],
): ModelForecast {
  const series = (name: string): Series | undefined => {
    const key = req.models.length === 1 ? name : `${name}_${model}`;
    const v = loc.hourly[key] ?? (req.models.length === 1 ? undefined : loc.hourly[name]);
    return v && v.some((x) => x !== null) ? v : undefined;
  };

  const surface: SurfaceSeries = {};
  for (const v of req.surface) {
    const s = series(SURFACE_VARIABLES[v]);
    if (s) surface[v] = s;
  }

  const levels: LevelSeries[] = [];
  for (const p of req.pressureLevels) {
    const empty = time.map(() => null);
    const wantsHeight = !req.levelFields || req.levelFields.includes('heightM');
    const heightM = series(`${PRESSURE_FIELDS.heightM}_${p}hPa`) ?? (wantsHeight ? null : empty);
    const temperatureC = series(`${PRESSURE_FIELDS.temperatureC}_${p}hPa`);
    // A level without heights (when asked for) or temperatures can't be used: skip it.
    if (!heightM || !temperatureC) continue;
    levels.push({
      kind: 'pressure',
      label: `${p}hPa`,
      heightM,
      temperatureC,
      relativeHumidity: series(`${PRESSURE_FIELDS.relativeHumidity}_${p}hPa`) ?? empty,
      windSpeedKmh: series(`${PRESSURE_FIELDS.windSpeedKmh}_${p}hPa`) ?? empty,
    });
  }

  return { model, groundElevationM: loc.elevation, time, surface, levels };
}

/** True if the forecast has at least one surface value, i.e. the model covers the point. */
export function hasData(f: ModelForecast): boolean {
  return Object.values(f.surface).some(
    (s: Series | undefined) => s !== undefined && s.some((x) => x !== null),
  );
}
