/**
 * Everything a factor needs to read one forecast hour for one target.
 */
import { skyAt, type SkyState } from './astro.js';
import { profileAt, sampleAt, type ProfileSample, type VerticalProfile } from './vertical.js';
import type { ModelForecast, SurfaceVariable, Target } from './types.js';

/** Data from outside the weather models. */
export interface HourExtras {
  /** Planetary K index forecast for an instant, or null when not known. */
  kp?: (time: number) => number | null;
  /**
   * Cloud on the horizon towards the sun at an instant: low and mid cover (%) from a
   * point about 60 km along the sunrise (morning) or sunset (evening) bearing.
   */
  horizon?: (time: number) => { low: number | null; mid: number | null } | null;
  /** Haze in the air at an instant (CAMS): aerosol optical depth and dust near the ground. */
  air?: (time: number) => { aod: number | null; dust: number | null } | null;
}

const profileCache = new WeakMap<ModelForecast, Map<number, VerticalProfile>>();

/** Vertical profiles are shared by every target in a zone: build each one once. */
function cachedProfile(forecast: ModelForecast, i: number): VerticalProfile {
  let byHour = profileCache.get(forecast);
  if (!byHour) profileCache.set(forecast, (byHour = new Map()));
  let p = byHour.get(i);
  if (!p) byHour.set(i, (p = profileAt(forecast, i)));
  return p;
}

export interface HourContext {
  forecast: ModelForecast;
  /** Index of the hour being scored. */
  i: number;
  time: number;
  target: Target;
  /** Vertical profile for this hour, built lazily. */
  readonly profile: VerticalProfile;
  /** Conditions interpolated at the target's altitude. */
  readonly atTarget: ProfileSample;
  /** A surface value at this hour, or `offset` hours from it. */
  surface(variable: SurfaceVariable, offset?: number): number | null;
  /** Surface values from `from` to `to` hours relative to this hour, nulls dropped. */
  surfaceRange(variable: SurfaceVariable, from: number, to: number): number[];
  /** Sun, moon and Milky Way at this hour (30 minutes in), or null without a position. */
  readonly sky: SkyState | null;
  extras: HourExtras;
}

export function createHourContext(
  forecast: ModelForecast,
  i: number,
  target: Target,
  extras: HourExtras = {},
): HourContext {
  let profile: VerticalProfile | undefined;
  let atTarget: ProfileSample | undefined;
  let sky: SkyState | null | undefined;

  const surface = (variable: SurfaceVariable, offset = 0): number | null => {
    const v = forecast.surface[variable]?.[i + offset];
    return v === undefined || v === null || !Number.isFinite(v) ? null : v;
  };

  return {
    forecast,
    i,
    time: forecast.time[i]!,
    target,
    get profile() {
      profile ??= cachedProfile(forecast, i);
      return profile;
    },
    get atTarget() {
      atTarget ??= sampleAt(this.profile, target.altitudeM);
      return atTarget;
    },
    surface,
    extras,
    get sky() {
      if (sky === undefined) {
        sky =
          target.lat === undefined || target.lon === undefined
            ? null
            : skyAt(forecast.time[i]! + 1_800_000, target.lat, target.lon);
      }
      return sky;
    },
    surfaceRange(variable, from, to) {
      const out: number[] = [];
      for (let o = from; o <= to; o++) {
        const v = surface(variable, o);
        if (v !== null) out.push(v);
      }
      return out;
    },
  };
}
