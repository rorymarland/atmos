import { describe, expect, it } from 'vitest';
import { makeForecast, inversionMorning } from './testing.js';
import { interpolate, profileAt, sampleAt } from './vertical.js';

describe('vertical profile', () => {
  it('drops levels at or below the ground', () => {
    const f = makeForecast({
      groundElevationM: 300,
      surface: { temperature2m: 1, relativeHumidity2m: 90, windSpeed10m: 5 },
      levels: [
        { heightM: 111, t: 9, rh: 50, wind: 1 }, // e.g. 1000 hPa under the terrain
        { heightM: 700, t: 0, rh: 80, wind: 20 },
      ],
    });
    const p = profileAt(f, 0);
    expect(p.temperature.map((x) => x.heightM)).toEqual([302, 700]);
    expect(p.wind.map((x) => x.heightM)).toEqual([310, 700]);
  });

  it('interpolates linearly and refuses to invent air above the top level', () => {
    const pts = [
      { heightM: 0, value: 10 },
      { heightM: 1000, value: 0 },
    ];
    expect(interpolate(pts, 250)).toBeCloseTo(7.5);
    expect(interpolate(pts, 1200)).toBeNull();
    expect(interpolate([], 10)).toBeNull();
  });

  it('extrapolates temperature below the lowest point with the lapse rate', () => {
    expect(interpolate([{ heightM: 1000, value: 0 }], 0, 'temperature')).toBeCloseTo(6.5);
    expect(interpolate([{ heightM: 1000, value: 40 }], 0)).toBe(40);
  });

  it('samples a summit inside an inversion profile', () => {
    const f = makeForecast(inversionMorning);
    const at = sampleAt(profileAt(f, 0), 750);
    // Between 600 m (5 °C) and 900 m (4 °C).
    expect(at.temperatureC).toBeCloseTo(4.5);
    expect(at.relativeHumidity).toBeCloseTo(45);
    expect(at.windKmh).toBeCloseTo(7.5);
  });
});
