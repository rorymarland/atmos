/**
 * Factor ramps: map a raw value to a score between 0 (bad) and 1 (good).
 */

/** Linear ramp between a good and a bad threshold. Works in either direction. */
export interface LinearRamp {
  good: number;
  bad: number;
}

/**
 * Band ramp: 1 inside [band[0], band[1]], falling linearly to 0 at zero[0] below
 * and zero[1] above.
 */
export interface BandRamp {
  band: [number, number];
  zero: [number, number];
}

export type Ramp = LinearRamp | BandRamp;

export function isBandRamp(ramp: Ramp): ramp is BandRamp {
  return 'band' in ramp;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function rampScore(ramp: Ramp, value: number): number {
  if (isBandRamp(ramp)) {
    const [lo, hi] = ramp.band;
    const [zeroLo, zeroHi] = ramp.zero;
    if (value >= lo && value <= hi) return 1;
    if (value < lo) return lo === zeroLo ? 0 : clamp01((value - zeroLo) / (lo - zeroLo));
    return hi === zeroHi ? 0 : clamp01((zeroHi - value) / (zeroHi - hi));
  }
  const { good, bad } = ramp;
  // good === bad is rejected by config validation; treat as a step just in case.
  if (good === bad) return value <= good ? 1 : 0;
  return clamp01((value - bad) / (good - bad));
}

/** Throws if a ramp is malformed. Used by config validation. */
export function assertValidRamp(ramp: Ramp, where: string): void {
  if (isBandRamp(ramp)) {
    const [lo, hi] = ramp.band;
    const [zeroLo, zeroHi] = ramp.zero;
    if (!(zeroLo <= lo && lo <= hi && hi <= zeroHi)) {
      throw new Error(`${where}: band ramp must satisfy zero[0] <= band[0] <= band[1] <= zero[1]`);
    }
    return;
  }
  if (ramp.good === ramp.bad) throw new Error(`${where}: good and bad thresholds must differ`);
}
