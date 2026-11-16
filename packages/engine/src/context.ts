/**
 * Everything a factor needs to read one forecast hour for one target.
 */
import { profileAt, sampleAt, type ProfileSample, type VerticalProfile } from './vertical.js';
import type { ModelForecast, SurfaceVariable, Target } from './types.js';

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
}

export function createHourContext(forecast: ModelForecast, i: number, target: Target): HourContext {
  let profile: VerticalProfile | undefined;
  let atTarget: ProfileSample | undefined;

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
      profile ??= profileAt(forecast, i);
      return profile;
    },
    get atTarget() {
      atTarget ??= sampleAt(this.profile, target.altitudeM);
      return atTarget;
    },
    surface,
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
