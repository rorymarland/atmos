/**
 * User settings, kept in this browser's localStorage. Display defaults come from
 * /defaults.js, which the container writes from .env at start-up.
 */
import type { Pace } from '@atmos/engine';
import type { Light, Moment } from './sun';

export interface StartPoint {
  lat: number;
  lon: number;
  label: string;
}

export interface Settings {
  theme: 'light' | 'dark';
  wind: 'kmh' | 'mph';
  profile: string;
  dayOffset: number;
  light: Light;
  /** Hill list ids to include; empty means all. */
  lists: string[];
  minHeight: number;
  /** Retired: distance filtering is by estimated drive time now. Kept so old saves load. */
  maxMiles: number | null;
  /** Where today's trip starts from. Usually home, but can be anywhere. */
  start: StartPoint | null;
  /** Home, set by postcode or place name; "Use home" puts it back as the start point. */
  home: StartPoint | null;

  // Trip planning
  /** What to be in place for: blue hour, golden hour, or sunrise/sunset. */
  moment: Moment;
  /** Don't plan trips that need getting up before this local time ("04:00"), or null. */
  earliestUp: string | null;
  /** Longest acceptable drive, minutes, or null for any. */
  maxDriveMinutes: number | null;
  /** Getting up to leaving, minutes. */
  readyMinutes: number;
  /** Arrive this many minutes before the moment. */
  earlyMinutes: number;
  /** Walking pace for walk-in estimates. */
  pace: Pace;
}

const KEY = 'atmos.settings';

/** Defaults from /defaults.js (see static/defaults.js), validated. */
function runtimeDefaults(): { theme: 'light' | 'dark'; wind: 'kmh' | 'mph' } {
  const d = (typeof window !== 'undefined' && window.__ATMOS_DEFAULTS__) || {};
  return {
    theme: d.theme === 'dark' ? 'dark' : 'light',
    wind: d.wind === 'mph' ? 'mph' : 'kmh',
  };
}

export const DEFAULT_SETTINGS: Settings = {
  ...runtimeDefaults(),
  profile: 'inversion',
  dayOffset: 1,
  light: 'sunrise',
  lists: [],
  minHeight: 0,
  maxMiles: null,
  start: null,
  home: null,
  moment: 'golden',
  earliestUp: null,
  maxDriveMinutes: null,
  readyMinutes: 30,
  earlyMinutes: 15,
  pace: 'steady',
};

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings: Settings = $state(load());

/** Persists settings and applies the theme. Call once from the root layout. */
export function watchSettings(): void {
  $effect(() => {
    const snapshot = $state.snapshot(settings);
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      // Private browsing or storage full: settings last for this visit only.
    }
    document.documentElement.dataset.theme = snapshot.theme;
  });
}

export function exportSettings(): string {
  return JSON.stringify({ atmos: 1, settings: $state.snapshot(settings) }, null, 2);
}

export function importSettings(text: string): void {
  const parsed = JSON.parse(text) as { atmos?: number; settings?: Partial<Settings> };
  if (parsed.atmos !== 1 || !parsed.settings) throw new Error('Not an Atmos settings file');
  Object.assign(settings, { ...DEFAULT_SETTINGS, ...parsed.settings });
}
