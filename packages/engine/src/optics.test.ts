import { describe, expect, it } from 'vitest';
import { evaluateTarget } from './evaluate.js';
import { noctilucentSeason } from './profiles/optics.js';
import { loadRealConfig } from './test-config.js';
import { HOUR, T0, inversionMorning, makeForecast, type ForecastSpec } from './testing.js';
import type { ModelForecast, Target } from './types.js';

const config = loadRealConfig();
const levels = [
  { heightM: 100, t: 4, rh: 70, wind: 8 },
  { heightM: 1500, t: -6, rh: 50, wind: 20 },
];

/** A forecast whose T0 falls at `at` instead, so the sun is where the test wants it. */
function forecastAt(spec: ForecastSpec, at: number): ModelForecast {
  const f = makeForecast(spec);
  return { ...f, time: f.time.map((t) => t + (at - T0)) };
}
const run = (f: ModelForecast, start: number, hours: number, t: Target, id: string) =>
  evaluateTarget([f], { start, end: start + hours * HOUR }, t, id, config, {
    now: start - 12 * HOUR,
  });

describe('Brocken spectre', () => {
  const summit: Target = { id: 's', name: 'Ben', altitudeM: 700, lat: 56.5, lon: -4.5 };
  // A December mid-morning: the sun about 8° up, behind you on a summit above the fog.
  const at = Date.UTC(2026, 11, 1, 10);

  it('likes a clear summit over cloud with a low sun', () => {
    const r = run(forecastAt(inversionMorning, at), at, 2, summit, 'brocken');
    expect(r.verdict).toBe('go');
  });
  it('needs the summit out of the cloud', () => {
    const inCloud: Target = { ...summit, altitudeM: 300 };
    expect(run(forecastAt(inversionMorning, at), at, 2, inCloud, 'brocken').verdict).toBe('no');
  });
  it('needs the sun up', () => {
    const night = Date.UTC(2026, 11, 1, 3);
    expect(run(forecastAt(inversionMorning, night), night, 2, summit, 'brocken').verdict).toBe(
      'no',
    );
  });
});

describe('rainbows', () => {
  const glen: Target = { id: 'v', name: 'Glen', altitudeM: 50, lat: 56.5, lon: -4.5 };
  // Showers just gone through, the sky breaking, the sun out.
  const clearing: ForecastSpec = {
    surface: { precipitation: 0, showers: 0, cloudCover: 50, cloudCoverLow: 30 },
    surfaceBefore: { precipitation: 2, showers: 2, cloudCover: 90 },
    levels,
  };

  it('likes showers clearing with a low sun', () => {
    const at = Date.UTC(2026, 11, 1, 12); // about 10° up
    expect(run(forecastAt(clearing, at), at, 1, glen, 'rainbow').verdict).toBe('go');
  });
  it('needs the sun below 42°', () => {
    const noon = Date.UTC(2026, 5, 21, 12); // about 57° up
    expect(run(forecastAt(clearing, noon), noon, 1, glen, 'rainbow').verdict).toBe('no');
  });
  it('needs showers about', () => {
    const at = Date.UTC(2026, 11, 1, 12);
    const dry = { ...clearing, surfaceBefore: { precipitation: 0, showers: 0, cloudCover: 50 } };
    expect(run(forecastAt(dry, at), at, 1, glen, 'rainbow').verdict).not.toBe('go');
  });
});

describe('fresh snow, blue sky', () => {
  const summit: Target = { id: 's', name: 'Ben', altitudeM: 1000, lat: 56.5, lon: -4.5 };
  const after = (cloudCover: number): ForecastSpec => ({
    hoursBefore: 48,
    hoursAfter: 12,
    surfaceBefore: { precipitation: 1, freezingLevelHeight: 600, cloudCover: 100 },
    surface: { precipitation: 0, freezingLevelHeight: 600, cloudCover, visibility: 40_000 },
    levels,
  });

  it('likes the clear day after a snowfall', () => {
    expect(run(makeForecast(after(5)), T0 + 7 * HOUR, 3, summit, 'bluebird').verdict).toBe('go');
  });
  it('wants the sky blue, not grey', () => {
    expect(run(makeForecast(after(90)), T0 + 7 * HOUR, 3, summit, 'bluebird').verdict).toBe('no');
  });
  it('waits for the snow to stop', () => {
    expect(run(makeForecast(after(5)), T0, 2, summit, 'bluebird').verdict).not.toBe('go');
  });
});

describe('noctilucent clouds', () => {
  const north: Target = { id: 'n', name: 'Caithness', altitudeM: 50, lat: 58.4, lon: -3.5 };
  const clear: ForecastSpec = { surface: { cloudCover: 5, cloudCoverLow: 5 }, levels };

  it('has a season from late May to early August', () => {
    expect(noctilucentSeason(Date.UTC(2026, 6, 1))).toBe(100);
    expect(noctilucentSeason(Date.UTC(2026, 5, 1))).toBeGreaterThan(0);
    expect(noctilucentSeason(Date.UTC(2026, 11, 1))).toBe(0);
    expect(noctilucentSeason(Date.UTC(2026, 3, 1))).toBe(0);
  });
  it('likes a clear midsummer night in the north', () => {
    const at = Date.UTC(2026, 5, 21, 23);
    expect(run(forecastAt(clear, at), at, 2, north, 'noctilucent').verdict).toBe('go');
  });
  it('is never on in winter', () => {
    const at = Date.UTC(2026, 11, 1, 23);
    expect(run(forecastAt(clear, at), at, 2, north, 'noctilucent').verdict).toBe('no');
  });
});

describe('haze', () => {
  const glen: Target = { id: 'v', name: 'Glen', altitudeM: 50, lat: 56.5, lon: -4.5 };
  const sunset: ForecastSpec = {
    surface: {
      cloudCover: 50,
      cloudCoverLow: 10,
      cloudCoverMid: 40,
      cloudCoverHigh: 30,
      precipitation: 0,
      visibility: 30_000,
    },
    levels,
  };
  const at = Date.UTC(2026, 11, 1, 15);
  const score = (aod: number | null, dust: number | null = null) =>
    evaluateTarget([forecastAt(sunset, at)], { start: at, end: at + HOUR }, glen, 'sky', config, {
      now: at - 12 * HOUR,
      extras: { air: () => (aod === null ? null : { aod, dust }) },
    });

  it("doesn't count clean or ordinary air against a sunset", () => {
    expect(score(0.08).score).toBeCloseTo(score(null).score!, 5);
  });
  it('marks a sunset down in heavy haze, and names Saharan dust', () => {
    const dusty = score(0.6, 80);
    expect(dusty.score!).toBeLessThan(score(0.08).score!);
    const f = dusty.byModel[0]!.keyHour!.factors.find((x) => x.id === 'haze')!;
    expect(f.detail).toMatch(/Saharan dust/);
  });
});
