/**
 * Helpers for building synthetic forecasts in tests. Not used at runtime.
 */
import type { LevelSeries, ModelForecast, SurfaceSeries } from './types.js';

export const HOUR = 3_600_000;
/** 06:00 UTC on a winter morning: the dawn window used by most tests. */
export const T0 = Date.UTC(2026, 11, 1, 6);

export interface LevelSpec {
  heightM: number;
  t: number;
  rh: number;
  wind: number;
}

export interface ForecastSpec {
  model?: string;
  groundElevationM?: number;
  /** Hours before T0 included in the forecast (for overnight factors). */
  hoursBefore?: number;
  hoursAfter?: number;
  surface: Partial<Record<keyof SurfaceSeries, number>>;
  /** Surface overrides for hours before T0 (e.g. overnight cloud). */
  surfaceBefore?: Partial<Record<keyof SurfaceSeries, number>>;
  levels: LevelSpec[];
}

/** A forecast with constant conditions (and optional different conditions before T0). */
export function makeForecast(spec: ForecastSpec): ModelForecast {
  const before = spec.hoursBefore ?? 12;
  const after = spec.hoursAfter ?? 6;
  const time: number[] = [];
  for (let h = -before; h <= after; h++) time.push(T0 + h * HOUR);

  const surface: SurfaceSeries = {};
  const keys = new Set([
    ...Object.keys(spec.surface),
    ...Object.keys(spec.surfaceBefore ?? {}),
  ]) as Set<keyof SurfaceSeries>;
  for (const key of keys) {
    surface[key] = time.map((t) => {
      const early = t < T0 ? spec.surfaceBefore?.[key] : undefined;
      return early ?? spec.surface[key] ?? null;
    });
  }

  const levels: LevelSeries[] = spec.levels.map((l) => ({
    kind: 'height',
    label: `${l.heightM}m`,
    heightM: time.map(() => l.heightM),
    temperatureC: time.map(() => l.t),
    relativeHumidity: time.map(() => l.rh),
    windSpeedKmh: time.map(() => l.wind),
  }));

  return {
    model: spec.model ?? 'ukmo_uk_deterministic_2km',
    groundElevationM: spec.groundElevationM ?? 50,
    time,
    surface,
    levels,
  };
}

/**
 * A classic radiation/subsidence inversion: frosty, foggy valley at 50 m, cloud top
 * a little above 400 m, warm dry air from 600 m, light winds, high pressure, clear night.
 */
export const inversionMorning: ForecastSpec = {
  groundElevationM: 50,
  surface: {
    temperature2m: -2,
    relativeHumidity2m: 100,
    dewPoint2m: -2,
    windSpeed10m: 3,
    windGusts10m: 6,
    cloudCover: 95,
    cloudCoverLow: 95,
    cloudCoverMid: 0,
    cloudCoverHigh: 0,
    pressureMsl: 1032,
    precipitation: 0,
    precipitationProbability: 0,
    visibility: 200,
  },
  surfaceBefore: { cloudCover: 10, cloudCoverLow: 10 },
  levels: [
    { heightM: 250, t: -1.5, rh: 100, wind: 4 },
    { heightM: 400, t: -0.5, rh: 98, wind: 5 },
    { heightM: 600, t: 5, rh: 50, wind: 7 },
    { heightM: 900, t: 4, rh: 40, wind: 8 },
    { heightM: 1200, t: 2, rh: 35, wind: 10 },
    { heightM: 1500, t: 0, rh: 30, wind: 12 },
  ],
};

/** A wet, windy westerly: no inversion, cloud on the tops. */
export const windyWetDay: ForecastSpec = {
  groundElevationM: 50,
  surface: {
    temperature2m: 8,
    relativeHumidity2m: 90,
    windSpeed10m: 35,
    windGusts10m: 70,
    cloudCover: 100,
    cloudCoverLow: 90,
    cloudCoverMid: 100,
    cloudCoverHigh: 80,
    pressureMsl: 985,
    precipitation: 2,
    precipitationProbability: 90,
    visibility: 8000,
  },
  levels: [
    { heightM: 300, t: 6.5, rh: 96, wind: 50 },
    { heightM: 600, t: 4.5, rh: 99, wind: 60 },
    { heightM: 900, t: 2.5, rh: 100, wind: 70 },
    { heightM: 1200, t: 0.5, rh: 100, wind: 80 },
    { heightM: 1500, t: -1.5, rh: 98, wind: 85 },
  ],
};
