/**
 * User settings, kept in this browser's localStorage. Build-time defaults come from
 * the environment (see vite.config.ts).
 */
import type { Light } from './sun';

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
  /** Straight-line miles from the start point; null means any distance. */
  maxMiles: number | null;
  start: StartPoint | null;
}

const KEY = 'atmos.settings';

export const DEFAULT_SETTINGS: Settings = {
  theme: __ATMOS_DEFAULTS__.theme,
  wind: __ATMOS_DEFAULTS__.wind,
  profile: 'inversion',
  dayOffset: 1,
  light: 'sunrise',
  lists: [],
  minHeight: 0,
  maxMiles: null,
  start: null,
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
