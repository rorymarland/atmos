import { describe, expect, it } from 'vitest';
import { distanceKm, distanceMiles, googleMapsDirectionsUrl, nearest } from './geo.js';

const edinburgh = { lat: 55.9533, lon: -3.1883 };
const glasgow = { lat: 55.8642, lon: -4.2518 };

describe('geo', () => {
  it('measures great-circle distance', () => {
    expect(distanceKm(edinburgh, glasgow)).toBeGreaterThan(64);
    expect(distanceKm(edinburgh, glasgow)).toBeLessThan(70);
    expect(distanceMiles(edinburgh, glasgow)).toBeCloseTo(
      distanceKm(edinburgh, glasgow) / 1.609344,
    );
  });

  it('builds a keyless Google Maps directions link', () => {
    const url = new URL(googleMapsDirectionsUrl({ lat: 56.2427, lon: -4.2224 }, edinburgh));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('destination')).toBe('56.2427,-4.2224');
    expect(url.searchParams.get('origin')).toBe('55.9533,-3.1883');
    expect(googleMapsDirectionsUrl(glasgow)).not.toMatch(/origin=/);
  });

  it('finds the nearest point', () => {
    expect(nearest(glasgow, [edinburgh, glasgow])).toEqual({ index: 1, km: 0 });
    expect(nearest(glasgow, [])).toBeNull();
  });
});
