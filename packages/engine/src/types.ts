/**
 * Core data types for the scoring engine.
 *
 * Internal units: temperature °C, wind km/h, heights metres above mean sea level (AMSL),
 * humidity and cloud cover %, pressure hPa, precipitation mm per hour, visibility metres.
 * The data client is responsible for converting API responses into these shapes.
 */

/** One value per forecast hour; null where the model has no data. */
export type Series = (number | null)[];

/** Surface (single-level) variables the engine understands. All optional: models differ. */
export interface SurfaceSeries {
  temperature2m?: Series;
  relativeHumidity2m?: Series;
  dewPoint2m?: Series;
  windSpeed10m?: Series;
  windGusts10m?: Series;
  precipitation?: Series;
  precipitationProbability?: Series;
  cloudCover?: Series;
  cloudCoverLow?: Series;
  cloudCoverMid?: Series;
  cloudCoverHigh?: Series;
  visibility?: Series;
  pressureMsl?: Series;
  freezingLevelHeight?: Series;
}

export type SurfaceVariable = keyof SurfaceSeries;

/**
 * A model level above the ground: a fixed height level (UKV) or a pressure level.
 * `heightM` is AMSL for every hour; for pressure levels it is the geopotential height,
 * which varies with the weather.
 */
export interface LevelSeries {
  kind: 'height' | 'pressure';
  /** For display and debugging, e.g. "925hPa" or "500m". */
  label: string;
  heightM: Series;
  temperatureC: Series;
  relativeHumidity: Series;
  windSpeedKmh: Series;
}

/** One model's forecast for one point (usually a zone's low-lying forecast point). */
export interface ModelForecast {
  /** Model identifier, e.g. "ukmo_uk_deterministic_2km". */
  model: string;
  /** Model run time, epoch ms, if known. */
  runTime?: number;
  /** Ground height of the forecast point, metres AMSL. */
  groundElevationM: number;
  /** Start of each forecast hour, epoch ms. */
  time: number[];
  surface: SurfaceSeries;
  levels: LevelSeries[];
}

/** What is being scored: a summit, a photo spot, or ground level at the forecast point. */
export interface Target {
  id: string;
  name: string;
  altitudeM: number;
}

/** Inclusive time window, epoch ms. */
export interface TimeWindow {
  start: number;
  end: number;
}

export type Verdict = 'go' | 'maybe' | 'no' | 'nodata';
export type Confidence = 'high' | 'medium' | 'low';

/** Units used when formatting values for people. */
export type Unit = 'kmh' | 'celsius' | 'celsiusDelta' | 'metres' | 'percent' | 'hpa' | 'mm' | 'km';
