/** Sun times, the light window each profile is scored over, and the moment to be in place. */
import { Body, Observer, SearchAltitude, SearchRiseSet } from 'astronomy-engine';
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

export interface LightWindow extends TimeWindow {
  /** Plain description for people, e.g. "Dawn to two hours after sunrise". */
  label: string;
}

/**
 * The hours each profile is judged over. Inversions are a morning phenomenon; sky and
 * reflections follow the chosen light; walking covers the middle of the day.
 */
export function profileWindow(
  profileId: string,
  light: Light,
  sun: SunTimes,
  dayStart: number,
): LightWindow {
  const sunrise = sun.sunrise ?? dayStart + 8 * HOUR;
  const sunset = sun.sunset ?? dayStart + 16 * HOUR;
  const dawn = sun.civilDawn ?? sunrise - HOUR;
  const dusk = sun.civilDusk ?? sunset + HOUR;

  switch (profileId) {
    case 'inversion':
      return {
        start: floorToHour(dawn),
        end: sunrise + 2 * HOUR,
        label: 'Dawn to two hours after sunrise',
      };
    case 'walking':
      return {
        start: floorToHour(Math.max(sunrise, dayStart + 9 * HOUR)),
        end: Math.min(sunset, dayStart + 16 * HOUR),
        label: 'Daylight, 09:00 to 16:00',
      };
    default:
      return light === 'sunrise'
        ? { start: floorToHour(dawn), end: sunrise + HOUR, label: 'Dawn to an hour after sunrise' }
        : {
            start: floorToHour(sunset - HOUR),
            end: dusk,
            label: 'An hour before sunset to dusk',
          };
  }
}

/** What to be in place for. */
export type Moment = 'blue' | 'golden' | 'sun';

/** The light each profile is judged in: morning for inversions and walks. */
export function lightFor(profileId: string, light: Light): Light {
  return profileId === 'inversion' || profileId === 'walking' ? 'sunrise' : light;
}

export const MOMENT_LABELS: Record<Light, Record<Moment, string>> = {
  sunrise: { blue: 'Blue hour', golden: 'Golden hour', sun: 'Sunrise' },
  sunset: { blue: 'Blue hour', golden: 'Golden hour', sun: 'Sunset' },
};

/**
 * The instant to be in place. Morning: blue hour begins at civil dawn, golden hour at
 * -4°. Evening: golden hour begins at +6°, blue hour at -4°. Walking starts at the
 * beginning of its window instead.
 */
export function targetTime(
  profileId: string,
  light: Light,
  moment: Moment,
  sun: SunTimes,
  window: LightWindow,
): { at: number; label: string } {
  if (profileId === 'walking') return { at: window.start, label: 'the start of the walk' };
  const l = lightFor(profileId, light);
  const pick =
    l === 'sunrise'
      ? { blue: sun.civilDawn, golden: sun.goldenStart, sun: sun.sunrise }[moment]
      : { blue: sun.eveningBlueStart, golden: sun.eveningGoldenStart, sun: sun.sunset }[moment];
  const fallback = l === 'sunrise' ? sun.sunrise : sun.sunset;
  const at = pick ?? fallback ?? window.start;
  return { at, label: MOMENT_LABELS[l][moment].toLowerCase() };
}
