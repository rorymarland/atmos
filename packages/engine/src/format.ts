import type { Unit } from './types.js';

export interface FormatOptions {
  wind: 'kmh' | 'mph';
}

export const DEFAULT_FORMAT: FormatOptions = { wind: 'kmh' };

const KMH_PER_MPH = 1.609344;

/** Formats a value in its unit for people, e.g. "42 km/h", "+3.5 °C", "450 m". */
export function formatValue(
  value: number,
  unit: Unit,
  options: FormatOptions = DEFAULT_FORMAT,
): string {
  switch (unit) {
    case 'kmh':
      return options.wind === 'mph'
        ? `${Math.round(value / KMH_PER_MPH)} mph`
        : `${Math.round(value)} km/h`;
    case 'celsius':
      return `${value.toFixed(1)} °C`;
    case 'celsiusDelta':
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)} °C`;
    case 'metres':
      return `${Math.round(value)} m`;
    case 'percent':
      return `${Math.round(value)}%`;
    case 'hpa':
      return `${Math.round(value)} hPa`;
    case 'mm':
      return `${value.toFixed(1)} mm`;
    case 'km':
      return `${value >= 10 ? Math.round(value) : value.toFixed(1)} km`;
  }
}
