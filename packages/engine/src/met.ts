/**
 * Meteorological helpers. Pure functions, internal units (°C, %, km/h, metres AMSL).
 */

/** Dew point from temperature and relative humidity (Magnus formula, Alduchov & Eskridge constants). */
export function dewPoint(temperatureC: number, relativeHumidity: number): number {
  const a = 17.625;
  const b = 243.04;
  const rh = Math.min(100, Math.max(1, relativeHumidity));
  const gamma = Math.log(rh / 100) + (a * temperatureC) / (b + temperatureC);
  return (b * gamma) / (a - gamma);
}

/**
 * Wind chill (Environment Canada / Met Office formula). Only defined for
 * temperature <= 10 °C and wind >= 4.8 km/h; otherwise returns the air temperature.
 */
export function windChill(temperatureC: number, windKmh: number): number {
  if (temperatureC > 10 || windKmh < 4.8) return temperatureC;
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * temperatureC - 11.37 * v + 0.3965 * temperatureC * v;
}

/** Rough cloud base for convective/near-saturated air: about 125 m per °C of dew-point depression. */
export function liftingCondensationHeight(temperatureC: number, dewPointC: number): number {
  return Math.max(0, 125 * (temperatureC - dewPointC));
}

export interface HeightValue {
  heightM: number;
  value: number;
}

export interface Layer {
  baseM: number;
  topM: number;
}

/**
 * Contiguous layers where relative humidity is at or above `thresholdPct`, from a
 * humidity profile sorted by height. Boundaries are interpolated to where the profile
 * crosses the threshold, so a layer between two levels isn't snapped to either.
 */
export function saturatedLayers(profile: HeightValue[], thresholdPct = 95): Layer[] {
  const layers: Layer[] = [];
  let base: number | null = null;
  for (let k = 0; k < profile.length; k++) {
    const p = profile[k]!;
    const saturated = p.value >= thresholdPct;
    const prev = k > 0 ? profile[k - 1]! : null;
    if (saturated && base === null) {
      base = prev ? crossing(prev, p, thresholdPct) : p.heightM;
    } else if (!saturated && base !== null) {
      layers.push({ baseM: base, topM: prev ? crossing(prev, p, thresholdPct) : p.heightM });
      base = null;
    }
  }
  if (base !== null) layers.push({ baseM: base, topM: profile[profile.length - 1]!.heightM });
  return layers;
}

function crossing(a: HeightValue, b: HeightValue, threshold: number): number {
  if (a.value === b.value) return (a.heightM + b.heightM) / 2;
  const f = (threshold - a.value) / (b.value - a.value);
  return a.heightM + Math.min(1, Math.max(0, f)) * (b.heightM - a.heightM);
}

/**
 * Inversion strength: the warmest temperature in the layer from just above the ground
 * to `depthM` above it, minus the near-surface temperature. Positive means warmer air
 * aloft (an inversion); null if there is no data in the layer.
 */
export function inversionStrength(
  temperatureProfile: HeightValue[],
  surfaceTemperatureC: number,
  groundM: number,
  depthM = 1500,
): number | null {
  let warmest: number | null = null;
  for (const p of temperatureProfile) {
    if (p.heightM <= groundM + 10 || p.heightM > groundM + depthM) continue;
    warmest = warmest === null ? p.value : Math.max(warmest, p.value);
  }
  return warmest === null ? null : warmest - surfaceTemperatureC;
}
