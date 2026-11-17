/**
 * Vertical profile for one forecast hour, built from the surface values plus every
 * model level above the ground, and interpolation of that profile to any altitude.
 */
import type { HeightValue } from './met.js';
import type { ModelForecast } from './types.js';

/** Standard atmosphere lapse rate, °C per metre, used only to extrapolate below the lowest point. */
const LAPSE_RATE_C_PER_M = 0.0065;

export interface VerticalProfile {
  groundM: number;
  temperature: HeightValue[];
  relativeHumidity: HeightValue[];
  wind: HeightValue[];
}

export interface ProfileSample {
  temperatureC: number | null;
  relativeHumidity: number | null;
  windKmh: number | null;
}

/**
 * Builds the vertical profile for hour index `i`. Levels at or below the ground are
 * dropped: pressure levels under the terrain hold extrapolated values, not real air.
 */
export function profileAt(forecast: ModelForecast, i: number): VerticalProfile {
  const ground = forecast.groundElevationM;
  const temperature: HeightValue[] = [];
  const relativeHumidity: HeightValue[] = [];
  const wind: HeightValue[] = [];

  const push = (list: HeightValue[], heightM: number, value: number | null | undefined) => {
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      list.push({ heightM, value });
    }
  };

  const s = forecast.surface;
  push(temperature, ground + 2, s.temperature2m?.[i]);
  push(relativeHumidity, ground + 2, s.relativeHumidity2m?.[i]);
  push(wind, ground + 10, s.windSpeed10m?.[i]);

  for (const level of forecast.levels) {
    const h = level.heightM[i];
    if (h === null || h === undefined || h <= ground + 10) continue;
    push(temperature, h, level.temperatureC[i]);
    push(relativeHumidity, h, level.relativeHumidity[i]);
    push(wind, h, level.windSpeedKmh[i]);
  }

  const byHeight = (a: HeightValue, b: HeightValue) => a.heightM - b.heightM;
  return {
    groundM: ground,
    temperature: temperature.sort(byHeight),
    relativeHumidity: relativeHumidity.sort(byHeight),
    wind: wind.sort(byHeight),
  };
}

/**
 * Linear interpolation in height. Below the lowest point, temperature follows the
 * standard lapse rate and other values hold the lowest value. Above the highest point,
 * returns null: the engine does not invent the upper air.
 */
export function interpolate(
  points: HeightValue[],
  altitudeM: number,
  kind: 'temperature' | 'other' = 'other',
): number | null {
  if (points.length === 0) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (altitudeM <= first.heightM) {
    if (kind === 'temperature')
      return first.value + (first.heightM - altitudeM) * LAPSE_RATE_C_PER_M;
    return first.value;
  }
  if (altitudeM > last.heightM) return null;
  for (let k = 1; k < points.length; k++) {
    const hi = points[k]!;
    if (altitudeM <= hi.heightM) {
      const lo = points[k - 1]!;
      const f = (altitudeM - lo.heightM) / (hi.heightM - lo.heightM);
      return lo.value + f * (hi.value - lo.value);
    }
  }
  return null;
}

export function sampleAt(profile: VerticalProfile, altitudeM: number): ProfileSample {
  return {
    temperatureC: interpolate(profile.temperature, altitudeM, 'temperature'),
    relativeHumidity: interpolate(profile.relativeHumidity, altitudeM),
    windKmh: interpolate(profile.wind, altitudeM),
  };
}

/** Standard lapse rate, °C per metre, for extending beyond the highest level. */
const LAPSE_C_PER_M = 0.0065;

/**
 * The freezing level (metres AMSL) worked out from the temperature profile, for models
 * and hours without a published one (ECMWF, and the Met Office beyond the UKV's two and
 * a half days). The highest place where the air goes from above to below 0 °C on the way
 * up, so a cold valley under warm air doesn't count. Beyond the highest level, and below
 * the ground, it's extended at the standard lapse rate.
 */
export function derivedFreezingLevel(forecast: ModelForecast, i: number): number | null {
  const t = profileAt(forecast, i).temperature;
  if (t.length === 0) return null;
  let k = -1;
  for (let j = t.length - 1; j >= 0; j--) {
    if (t[j]!.value > 0) {
      k = j;
      break;
    }
  }
  if (k === -1) {
    // Freezing all the way up: the level is below the lowest point we have.
    const low = t[0]!;
    return low.heightM + low.value / LAPSE_C_PER_M;
  }
  const a = t[k]!;
  const b = t[k + 1];
  if (!b) return a.heightM + a.value / LAPSE_C_PER_M;
  return a.heightM + ((b.heightM - a.heightM) * a.value) / (a.value - b.value);
}

const freezingCache = new WeakMap<ModelForecast, (number | null | undefined)[]>();

/**
 * The freezing level at hour `i`: the model's own where it has one, else worked out.
 * Snow looks back 48 hours for every hill, so each hour is worked out once per forecast.
 */
export function freezingLevelAt(forecast: ModelForecast, i: number): number | null {
  if (i < 0 || i >= forecast.time.length) return null;
  const own = forecast.surface.freezingLevelHeight?.[i];
  if (own !== null && own !== undefined) return own;
  let cache = freezingCache.get(forecast);
  if (!cache) freezingCache.set(forecast, (cache = []));
  let v = cache[i];
  if (v === undefined) cache[i] = v = derivedFreezingLevel(forecast, i);
  return v;
}
