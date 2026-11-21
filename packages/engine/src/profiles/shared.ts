/**
 * Measurements shared by several profiles.
 */
import type { HourContext } from '../context.js';
import type { FactorDefinition } from './types.js';
import { dewPoint, liftingCondensationHeight, saturatedLayers, type Layer } from '../met.js';

/** Relative humidity at or above which a model layer is treated as cloud. */
export const SATURATION_RH = 95;

/** Low cloud cover (%) at or above which low cloud is taken as present. */
export const LOW_CLOUD_PRESENT_PCT = 50;

export function dewPointAt2m(ctx: HourContext): number | null {
  const td = ctx.surface('dewPoint2m');
  if (td !== null) return td;
  const t = ctx.surface('temperature2m');
  const rh = ctx.surface('relativeHumidity2m');
  return t !== null && rh !== null ? dewPoint(t, rh) : null;
}

export function cloudLayers(ctx: HourContext): Layer[] {
  return saturatedLayers(ctx.profile.relativeHumidity, SATURATION_RH);
}

/**
 * Base of the lowest cloud that reaches the target's altitude or above, metres AMSL.
 * Cloud lying wholly below the target (valley fog under a summit) is ignored: the
 * summit is above it. Uses the humidity profile first; if the profile has no
 * saturated layer but the model reports low cloud, falls back to the lifting
 * condensation estimate. Returns Infinity when there is no such cloud, null when it
 * can't be judged.
 */
export function cloudBase(ctx: HourContext): number | null {
  const layers = cloudLayers(ctx);
  if (layers.length > 0) {
    const reaching = layers.find((l) => l.topM > ctx.target.altitudeM);
    return reaching ? reaching.baseM : Infinity;
  }
  const low = ctx.surface('cloudCoverLow');
  if (low === null) return null;
  if (low < LOW_CLOUD_PRESENT_PCT) return Infinity;
  const t = ctx.surface('temperature2m');
  const td = dewPointAt2m(ctx);
  if (t === null || td === null) return null;
  return ctx.forecast.groundElevationM + liftingCondensationHeight(t, td);
}

export interface CloudSea {
  /** Top of the low cloud layer, metres AMSL. */
  topM: number;
  baseM: number;
}

/**
 * The low cloud layer that a summit might rise above: the lowest saturated layer whose
 * base is below the target's altitude, provided the model also reports low cloud.
 * Returns null when there is no such layer.
 */
export function cloudSea(ctx: HourContext): CloudSea | null {
  const low = ctx.surface('cloudCoverLow');
  if (low === null || low < LOW_CLOUD_PRESENT_PCT) return null;
  const layer = cloudLayers(ctx).find((l) => l.baseM < ctx.target.altitudeM);
  return layer ? { topM: layer.topM, baseM: layer.baseM } : null;
}

/**
 * Summit height above the cloud, metres: negative when the target sits inside a
 * cloud layer (at any height, not only the cloud sea), positive when it stands above
 * the cloud sea, null when there's no low cloud to judge against.
 */
export function clearanceAboveCloud(ctx: HourContext): number | null {
  const alt = ctx.target.altitudeM;
  const containing = cloudLayers(ctx).find((l) => l.baseM <= alt && alt <= l.topM);
  if (containing) return alt - containing.topM;
  const sea = cloudSea(ctx);
  return sea ? alt - sea.topM : null;
}

/** Ratio of gust to mean wind at 10 m, used to estimate summit gusts. */
export function gustFactor(ctx: HourContext): number {
  const wind = ctx.surface('windSpeed10m');
  const gust = ctx.surface('windGusts10m');
  if (wind === null || gust === null || wind < 5) return 1.5;
  return Math.min(3, Math.max(1, gust / wind));
}

export function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export const round = (x: number, step: number): number => Math.round(x / step) * step;

/**
 * Cloud on the horizon towards the sun, 60 km out: low cloud there blocks the low sun
 * from lighting the sky overhead, the usual cause of a promising sunset that fizzles.
 * Mid cloud counts for half, since a low sun can shine under some of it.
 */
export const horizonClear: FactorDefinition = {
  label: 'Cloud on the horizon towards the sun',
  unit: 'percent',
  read: (ctx) => {
    const h = ctx.extras.horizon?.(ctx.time) ?? null;
    if (!h || (h.low === null && h.mid === null)) return { value: null };
    const value = Math.min(100, (h.low ?? 0) + 0.5 * (h.mid ?? 0));
    return {
      value,
      detail: `about 60 km towards the sun: low ${Math.round(h.low ?? 0)}%, mid ${Math.round(h.mid ?? 0)}%`,
    };
  },
};

/** Dust above this (µg/m³ near the ground) is named as dust rather than haze. */
const DUST_NAMED = 40;

/**
 * Haze through the whole depth of the air, as aerosol optical depth at 550 nm (CAMS). Clean
 * UK air is about 0.05 to 0.15; above about 0.3 the low sun is dimmed and reddened and
 * colour on the clouds goes muted, and distant hills fade. Saharan dust and wildfire smoke
 * are the usual causes. Null without the air forecast, so it then counts for nothing.
 */
export const haze: FactorDefinition = {
  label: 'Haze in the air (aerosol optical depth)',
  unit: 'aod',
  read: (ctx) => {
    const a = ctx.extras.air?.(ctx.time) ?? null;
    if (!a || a.aod === null) return { value: null };
    const detail =
      a.dust !== null && a.dust >= DUST_NAMED
        ? `Saharan dust, about ${Math.round(a.dust)} µg/m³`
        : a.aod >= 0.3
          ? 'hazy: dust, smoke or pollution'
          : a.aod <= 0.1
            ? 'very clean air'
            : undefined;
    return { value: Math.round(a.aod * 100) / 100, ...(detail ? { detail } : {}) };
  },
};
