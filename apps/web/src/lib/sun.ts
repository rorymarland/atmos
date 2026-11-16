/** Sun times and the light window each profile is scored over. */
import { Body, Observer, SearchAltitude, SearchRiseSet } from 'astronomy-engine';
import type { TimeWindow } from '@atmos/engine';
import { floorToHour, londonMidnight } from './time';

const HOUR = 3_600_000;

export interface SunTimes {
  civilDawn: number | null;
  sunrise: number | null;
  sunset: number | null;
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
  const result: SunTimes = {
    // Civil twilight: sun 6° below the horizon. Can be missing in a northern midsummer.
    civilDawn: ms(SearchAltitude(Body.Sun, obs, +1, date, 1, -6)),
    sunrise: ms(SearchRiseSet(Body.Sun, obs, +1, date, 1)),
    sunset: ms(SearchRiseSet(Body.Sun, obs, -1, date, 1)),
    civilDusk: ms(SearchAltitude(Body.Sun, obs, -1, date, 1, -6)),
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
