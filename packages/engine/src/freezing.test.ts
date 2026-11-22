import { describe, expect, it } from 'vitest';
import { evaluateTarget } from './evaluate.js';
import { loadRealConfig } from './test-config.js';
import { HOUR, T0, makeForecast } from './testing.js';
import { derivedFreezingLevel, freezingLevelAt } from './vertical.js';

const i = 12; // T0 in makeForecast's default 12 hours before

describe('freezing level from the temperature profile', () => {
  it('interpolates where the air drops through 0 °C', () => {
    const f = makeForecast({
      surface: { temperature2m: 8 },
      levels: [
        { heightM: 1000, t: 2, rh: 60, wind: 10 },
        { heightM: 1500, t: -1, rh: 60, wind: 10 },
      ],
    });
    // 1000 + 500 x 2 / 3 = 1333.3 m.
    expect(derivedFreezingLevel(f, i)).toBeCloseTo(1333.3, 1);
  });

  it('extends above the highest level at the standard lapse rate', () => {
    const f = makeForecast({
      surface: { temperature2m: 12 },
      levels: [{ heightM: 1500, t: 3, rh: 60, wind: 10 }],
    });
    // 1500 + 3 / 0.0065 = 1961.5 m.
    expect(derivedFreezingLevel(f, i)).toBeCloseTo(1961.5, 1);
  });

  it('puts it below the ground when everything is freezing', () => {
    const f = makeForecast({
      groundElevationM: 50,
      surface: { temperature2m: -2 },
      levels: [{ heightM: 1000, t: -8, rh: 60, wind: 10 }],
    });
    // 52 - 2 / 0.0065 = -255.7 m.
    expect(derivedFreezingLevel(f, i)).toBeCloseTo(-255.7, 1);
  });

  it('ignores a cold valley under warm air', () => {
    const f = makeForecast({
      surface: { temperature2m: -3 },
      levels: [
        { heightM: 600, t: 4, rh: 30, wind: 5 },
        { heightM: 1500, t: -2, rh: 30, wind: 5 },
      ],
    });
    // The crossing that matters is the upper one: 600 + 900 x 4 / 6 = 1200 m.
    expect(derivedFreezingLevel(f, i)).toBeCloseTo(1200, 1);
  });

  it("prefers the model's own value, and is null off the end", () => {
    const f = makeForecast({
      surface: { temperature2m: 8, freezingLevelHeight: 900 },
      levels: [{ heightM: 1500, t: -1, rh: 60, wind: 10 }],
    });
    expect(freezingLevelAt(f, i)).toBe(900);
    expect(freezingLevelAt(f, 999)).toBeNull();
  });
});

describe('snow on the tops without a published freezing level (ECMWF)', () => {
  const config = loadRealConfig();
  const summit = { id: 's', name: 'Ben', altitudeM: 1000, lat: 56.5, lon: -4.5 };
  const w = { start: T0, end: T0 + 4 * HOUR };
  const now = T0 - 12 * HOUR;

  it('still finds fresh snow from a cold profile', () => {
    const f = makeForecast({
      model: 'ecmwf_ifs025',
      hoursBefore: 36,
      surfaceBefore: { precipitation: 1, cloudCover: 100, temperature2m: 3 },
      surface: { precipitation: 0, cloudCover: 30, temperature2m: 3 },
      // Freezing at about 500 m, so precipitation fell as snow on a 1,000 m summit.
      levels: [
        { heightM: 500, t: 0.5, rh: 80, wind: 10 },
        { heightM: 1500, t: -6, rh: 60, wind: 15 },
      ],
    });
    const r = evaluateTarget([f], w, summit, 'snow', config, { now });
    const fresh = r.byModel[0]!.keyHour!.factors.find((x) => x.id === 'lyingSnow')!;
    expect(fresh.value).toBeGreaterThan(20);
    expect(r.verdict).toBe('go');
  });

  it('no longer calls a clear, mild day a snow day', () => {
    const f = makeForecast({
      model: 'ecmwf_ifs025',
      hoursBefore: 36,
      surfaceBefore: { precipitation: 1, cloudCover: 100, temperature2m: 10 },
      surface: { precipitation: 0, cloudCover: 30, temperature2m: 10 },
      levels: [
        { heightM: 500, t: 8, rh: 80, wind: 10 },
        { heightM: 1500, t: 3, rh: 60, wind: 15 },
      ],
    });
    expect(evaluateTarget([f], w, summit, 'snow', config, { now }).verdict).toBe('no');
  });
});
