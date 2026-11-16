/** Sun times, the light window each profile is scored over, and the moment to be in place. */
import {
  Body,
  Equator,
  Horizon,
  Illumination,
  Observer,
  SearchAltitude,
  SearchRiseSet,
} from 'astronomy-engine';
import type { TimeWindow } from '@atmos/engine';
import { floorToHour, londonMidnight } from './time';

const HOUR = 3_600_000;

/**
 * The day's light, as instants (epoch ms), or null where the sun never reaches that
 * altitude (e.g. no true dark in a northern midsummer).
 *
 * Blue hour: sun 6° to 4° below the horizon. Golden hour: 4° below to 6° above.
 */
export interface SunTimes {
  civilDawn: number | null;
  /** Morning: end of blue hour, start of golden hour (sun at -4°). */
  goldenStart: number | null;
  sunrise: number | null;
  /** Morning golden hour ends (sun at +6°). */
  goldenEnd: number | null;
  /** Evening golden hour starts (sun at +6°). */
  eveningGoldenStart: number | null;
  sunset: number | null;
  /** Evening: end of golden hour, start of blue hour (sun at -4°). */
  eveningBlueStart: number | null;
  civilDusk: number | null;
}

const cache = new Map<string, SunTimes>();

export function sunTimes(lat: number, lon: number, dayOffset: number, now = Date.now()): SunTimes {
  const start = londonMidnight(dayOffset, now);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${start}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const obs = new Observer(lat, lon, 0);
  const date = new Date(start);
  const ms = (t: { date: Date } | null) => (t ? t.date.getTime() : null);
  const rising = (alt: number) => ms(SearchAltitude(Body.Sun, obs, +1, date, 1, alt));
  const setting = (alt: number) => ms(SearchAltitude(Body.Sun, obs, -1, date, 1, alt));
  const result: SunTimes = {
    civilDawn: rising(-6),
    goldenStart: rising(-4),
    sunrise: ms(SearchRiseSet(Body.Sun, obs, +1, date, 1)),
    goldenEnd: rising(6),
    eveningGoldenStart: setting(6),
    sunset: ms(SearchRiseSet(Body.Sun, obs, -1, date, 1)),
    eveningBlueStart: setting(-4),
    civilDusk: setting(-6),
  };
  cache.set(key, result);
  return result;
}

export type Light = 'sunrise' | 'sunset';
export type Period = 'morning' | 'day' | 'evening' | 'night';

export const PERIOD_LABELS: Record<Period, string> = {
  morning: 'Morning',
  day: 'Daytime',
  evening: 'Evening',
  night: 'Night',
};

export interface LightWindow extends TimeWindow {
  /** Plain description for people, e.g. "Dawn to two hours after sunrise". */
  label: string;
}

/** Conditions that build through the dawn hours get a longer morning window. */
const LONG_MORNING = new Set(['inversion', 'mist', 'frost']);

/**
 * The hours a condition is judged over in one part of the day. `nextSun` is the
 * following day's sun, for the night.
 */
export function periodWindow(
  period: Period,
  profileId: string,
  sun: SunTimes,
  nextSun: SunTimes,
  dayStart: number,
): LightWindow {
  const sunrise = sun.sunrise ?? dayStart + 8 * HOUR;
  const sunset = sun.sunset ?? dayStart + 16 * HOUR;
  const dawn = sun.civilDawn ?? sunrise - HOUR;
  const dusk = sun.civilDusk ?? sunset + HOUR;

  switch (period) {
    case 'morning':
      return LONG_MORNING.has(profileId)
        ? {
            start: floorToHour(dawn),
            end: sunrise + 2 * HOUR,
            label: 'Dawn to two hours after sunrise',
          }
        : { start: floorToHour(dawn), end: sunrise + HOUR, label: 'Dawn to an hour after sunrise' };
    case 'evening':
      return {
        start: floorToHour(sunset - HOUR),
        end: dusk,
        label: 'An hour before sunset to dusk',
      };
    case 'day':
      return profileId === 'walking'
        ? {
            start: floorToHour(Math.max(sunrise, dayStart + 9 * HOUR)),
            end: Math.min(sunset, dayStart + 16 * HOUR),
            label: 'Daylight, 09:00 to 16:00',
          }
        : { start: floorToHour(sunrise), end: sunset, label: 'Sunrise to sunset' };
    case 'night': {
      const nextDawn = nextSun.civilDawn ?? dayStart + 30 * HOUR;
      return { start: floorToHour(dusk), end: nextDawn, label: 'Dusk to dawn' };
    }
  }
}

/** What to be in place for. */
export type Moment = 'blue' | 'golden' | 'sun';

export const MOMENT_LABELS: Record<Light, Record<Moment, string>> = {
  sunrise: { blue: 'Blue hour', golden: 'Golden hour', sun: 'Sunrise' },
  sunset: { blue: 'Blue hour', golden: 'Golden hour', sun: 'Sunset' },
};

/**
 * The instant to be in place. Morning: blue hour begins at civil dawn, golden hour at
 * -4°. Evening: golden hour begins at +6°, blue hour at -4°. Daytime and night
 * conditions aim for their best hour; walks for the start of the walking window.
 */
export function targetTime(
  profileId: string,
  period: Period,
  moment: Moment,
  sun: SunTimes,
  window: LightWindow,
  keyHour: number | null,
): { at: number; label: string } {
  if (profileId === 'walking') return { at: window.start, label: 'the start of the walk' };
  if (period === 'day' || period === 'night') {
    return { at: keyHour ?? window.start, label: 'the best hour' };
  }
  const l: Light = period === 'morning' ? 'sunrise' : 'sunset';
  const pick =
    l === 'sunrise'
      ? { blue: sun.civilDawn, golden: sun.goldenStart, sun: sun.sunrise }[moment]
      : { blue: sun.eveningBlueStart, golden: sun.eveningGoldenStart, sun: sun.sunset }[moment];
  const fallback = l === 'sunrise' ? sun.sunrise : sun.sunset;
  const at = pick ?? fallback ?? window.start;
  return { at, label: MOMENT_LABELS[l][moment].toLowerCase() };
}

export interface BodyPosition {
  altDeg: number;
  /** Compass bearing, degrees from north. */
  azDeg: number;
}

export interface SkyPositions {
  sun: BodyPosition;
  moon: BodyPosition;
  /** Lit fraction of the moon, 0 to 1. */
  moonLit: number;
}

function position(body: Body, date: Date, obs: Observer): BodyPosition {
  const eq = Equator(body, date, obs, true, true);
  const h = Horizon(date, obs, eq.ra, eq.dec, 'normal');
  return { altDeg: h.altitude, azDeg: h.azimuth };
}

/** Sun and moon height and direction at one instant. */
export function skyPositions(time: number, lat: number, lon: number): SkyPositions {
  const obs = new Observer(lat, lon, 0);
  const date = new Date(time);
  return {
    sun: position(Body.Sun, date, obs),
    moon: position(Body.Moon, date, obs),
    moonLit: Illumination(Body.Moon, date).phase_fraction,
  };
}

export interface MoonTimes {
  rise: number | null;
  set: number | null;
}

/** Moonrise and moonset within the London day starting at `dayStart`. */
export function moonTimes(lat: number, lon: number, dayStart: number): MoonTimes {
  const obs = new Observer(lat, lon, 0);
  const date = new Date(dayStart);
  const within = (t: { date: Date } | null) =>
    t && t.date.getTime() < dayStart + 24 * HOUR ? t.date.getTime() : null;
  return {
    rise: within(SearchRiseSet(Body.Moon, obs, +1, date, 1)),
    set: within(SearchRiseSet(Body.Moon, obs, -1, date, 1)),
  };
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
export const compass = (deg: number) =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]!;
