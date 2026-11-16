import { describe, expect, it } from 'vitest';
import { kpNeeded, skyAt, viewLineLatitude } from './astro.js';
import { evaluateTarget } from './evaluate.js';
import { loadRealConfig } from './test-config.js';
import { HOUR, T0, makeForecast } from './testing.js';
import type { Target } from './types.js';

const config = loadRealConfig();
const now = T0 - 12 * HOUR;
const valley: Target = { id: 'v', name: 'Glen', altitudeM: 50, lat: 56.5, lon: -4.5 };
const summit: Target = { id: 's', name: 'Ben', altitudeM: 1000, lat: 56.5, lon: -4.5 };
const levels = [
  { heightM: 100, t: 2, rh: 70, wind: 5 },
  { heightM: 1500, t: -8, rh: 50, wind: 20 },
];

describe('sky geometry', () => {
  it('puts the sun high at midsummer noon and below the horizon at midnight', () => {
    expect(skyAt(Date.UTC(2026, 5, 21, 12), 56, -4).sunAltDeg).toBeGreaterThan(50);
    expect(skyAt(Date.UTC(2026, 11, 21, 0), 56, -4).sunAltDeg).toBeLessThan(-40);
  });

  it('puts the view line further south for stronger storms', () => {
    expect(viewLineLatitude(7)).toBeCloseTo(52);
    expect(viewLineLatitude(5)).toBeCloseTo(56);
    expect(kpNeeded(viewLineLatitude(4.5))).toBeCloseTo(4.5);
  });

  it('needs less activity further north', () => {
    expect(kpNeeded(51)).toBeGreaterThan(kpNeeded(56));
    expect(kpNeeded(60.5)).toBeLessThan(kpNeeded(56));
  });
});

describe('frost', () => {
  it('likes a cold, clear, still night and dislikes a mild, cloudy one', () => {
    const cold = makeForecast({
      surface: { temperature2m: -4, relativeHumidity2m: 95, windSpeed10m: 2, cloudCover: 5 },
      levels,
    });
    const mild = makeForecast({
      surface: { temperature2m: 6, relativeHumidity2m: 75, windSpeed10m: 20, cloudCover: 95 },
      levels,
    });
    const w = { start: T0, end: T0 + 2 * HOUR };
    expect(evaluateTarget([cold], w, valley, 'frost', config, { now }).verdict).toBe('go');
    expect(evaluateTarget([mild], w, valley, 'frost', config, { now }).verdict).toBe('no');
  });
});

describe('snow on the tops', () => {
  it('counts precipitation that fell above the snow line as snow on the summit', () => {
    const f = makeForecast({
      hoursBefore: 36,
      surfaceBefore: { precipitation: 1, freezingLevelHeight: 600, cloudCover: 100 },
      surface: { precipitation: 0, freezingLevelHeight: 600, cloudCover: 30 },
      levels,
    });
    const w = { start: T0, end: T0 + 4 * HOUR };
    const r = evaluateTarget([f], w, summit, 'snow', config, { now });
    const fresh = r.byModel[0]!.keyHour!.factors.find((x) => x.id === 'freshSnow')!;
    expect(fresh.value).toBeGreaterThan(20);
    expect(r.verdict).toBe('go');
    // The same weather with the freezing level far above the summit is rain, not snow.
    const warm = makeForecast({
      hoursBefore: 36,
      surfaceBefore: { precipitation: 1, freezingLevelHeight: 2500, cloudCover: 100 },
      surface: { precipitation: 0, freezingLevelHeight: 2500, cloudCover: 30 },
      levels,
    });
    expect(evaluateTarget([warm], w, summit, 'snow', config, { now }).verdict).toBe('no');
  });
});

describe('aurora', () => {
  const night = makeForecast({ surface: { cloudCover: 5 }, levels });
  // 06:00 UTC on 1 December is before dawn; score the small hours.
  const w = { start: T0 - 4 * HOUR, end: T0 - HOUR };

  it('is a no without a Kp forecast, however clear the sky', () => {
    expect(evaluateTarget([night], w, valley, 'aurora', config, { now }).verdict).toBe('no');
  });

  it('is a go with a strong storm and a clear sky', () => {
    const r = evaluateTarget([night], w, valley, 'aurora', config, {
      now,
      extras: { kp: () => 7 },
    });
    expect(r.verdict).toBe('go');
  });
});
