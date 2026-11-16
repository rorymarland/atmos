import { describe, expect, it } from 'vitest';
import { loadRealConfig } from './test-config.js';
import {
  combineScores,
  confidenceFor,
  evaluateTarget,
  evaluateWindow,
  rankResults,
} from './evaluate.js';
import { explain } from './explain.js';
import { HOUR, T0, inversionMorning, makeForecast, windyWetDay } from './testing.js';
import type { Target } from './types.js';

const config = loadRealConfig();
const dawn = { start: T0, end: T0 + 3 * HOUR };
const now = T0 - 12 * HOUR;
const benLedi: Target = { id: 'ben-ledi', name: 'Ben Ledi', altitudeM: 879 };
const lowHill: Target = { id: 'low-hill', name: 'Low hill', altitudeM: 300 };

describe('combineScores', () => {
  it('is a weighted geometric mean that ignores missing scores', () => {
    expect(
      combineScores([
        { weight: 1, score: 1 },
        { weight: 1, score: 0.25 },
        { weight: 5, score: null },
      ]),
    ).toBeCloseTo(0.5);
    expect(combineScores([{ weight: 1, score: null }])).toBeNull();
  });

  it('lets one very poor factor drag the score down', () => {
    expect(
      combineScores([
        { weight: 1, score: 1 },
        { weight: 1, score: 1 },
        { weight: 1, score: 0 },
      ]),
    ).toBe(0);
  });
});

describe('inversion profile', () => {
  it('says GO for a summit above a classic cloud sea', () => {
    const r = evaluateWindow(makeForecast(inversionMorning), dawn, benLedi, 'inversion', config);
    expect(r.verdict).toBe('go');
    const clearance = r.keyHour!.factors.find((f) => f.id === 'cloudSeaClearance')!;
    // Cloud top interpolated between 400 m (98%) and 600 m (50%) at 95% RH: 412.5 m.
    expect(clearance.value).toBeCloseTo(879 - 412.5);
    expect(clearance.detail).toBe('cloud top about 400 m');
    const strength = r.keyHour!.factors.find((f) => f.id === 'inversionStrength')!;
    expect(strength.value).toBeCloseTo(7);
  });

  it('says NO for a hill buried in the cloud', () => {
    const r = evaluateWindow(makeForecast(inversionMorning), dawn, lowHill, 'inversion', config);
    expect(r.verdict).toBe('no');
    expect(r.keyHour!.gates.find((g) => g.id === 'summitClearance')!.passed).toBe(false);
  });

  it('says NO when the summit is in a higher cloud layer above the valley fog', () => {
    const capped = makeForecast({
      ...inversionMorning,
      levels: inversionMorning.levels.map((l) =>
        l.heightM === 900 ? { ...l, rh: 99 } : l.heightM === 1200 ? { ...l, rh: 97 } : l,
      ),
    });
    const r = evaluateWindow(capped, dawn, benLedi, 'inversion', config);
    expect(r.verdict).toBe('no');
    const gate = r.keyHour!.gates.find((g) => g.id === 'summitClearance')!;
    expect(gate.passed).toBe(false);
    expect(gate.value!).toBeLessThan(0);
  });

  it('says NO on a wet, windy day', () => {
    const r = evaluateWindow(makeForecast(windyWetDay), dawn, benLedi, 'inversion', config);
    expect(r.verdict).toBe('no');
  });

  it('scores no low cloud as no cloud sea, not as missing data', () => {
    const clear = makeForecast({
      ...inversionMorning,
      surface: { ...inversionMorning.surface, cloudCoverLow: 0, relativeHumidity2m: 70 },
      levels: inversionMorning.levels.map((l) => ({ ...l, rh: 40 })),
    });
    const r = evaluateWindow(clear, dawn, benLedi, 'inversion', config);
    const f = r.keyHour!.factors.find((x) => x.id === 'cloudSeaClearance')!;
    expect(f.score).toBe(0);
    expect(f.detail).toBe('no low cloud forecast');
    expect(r.verdict).toBe('no');
  });
});

describe('walking profile', () => {
  it('treats valley fog below the summit as no cloud at summit level', () => {
    const r = evaluateWindow(makeForecast(inversionMorning), dawn, benLedi, 'walking', config);
    const f = r.keyHour!.factors.find((x) => x.id === 'cloudBaseMargin')!;
    expect(f.score).toBe(1);
    expect(r.verdict).toBe('go');
  });

  it('is gated by summit gusts on a stormy day', () => {
    const r = evaluateWindow(makeForecast(windyWetDay), dawn, benLedi, 'walking', config);
    expect(r.verdict).toBe('no');
    expect(r.score).toBe(0);
    expect(r.keyHour!.gates[0]!.passed).toBe(false);
  });

  it('is sunk by a single gated hour (mean aggregation)', () => {
    const calm = makeForecast(inversionMorning);
    const stormy = makeForecast(windyWetDay);
    // Splice one stormy hour into an otherwise calm window.
    const i = calm.time.indexOf(T0 + 2 * HOUR);
    calm.levels.forEach((l, k) => {
      l.windSpeedKmh[i] = stormy.levels[Math.min(k, stormy.levels.length - 1)]!.windSpeedKmh[i]!;
    });
    calm.surface.windSpeed10m![i] = 35;
    calm.surface.windGusts10m![i] = 70;
    const r = evaluateWindow(calm, dawn, benLedi, 'walking', config);
    expect(r.verdict).toBe('no');
    expect(r.keyHour!.time).toBe(T0 + 2 * HOUR);
  });
});

describe('sky and reflections profiles', () => {
  it('likes broken mid and high cloud with a clear low horizon', () => {
    const f = makeForecast({
      surface: {
        cloudCover: 55,
        cloudCoverLow: 5,
        cloudCoverMid: 30,
        cloudCoverHigh: 40,
        precipitation: 0,
        visibility: 30000,
      },
      levels: [],
    });
    const r = evaluateWindow(f, dawn, { id: 'loch', name: 'Loch', altitudeM: 50 }, 'sky', config);
    expect(r.verdict).toBe('go');
  });

  it('wants near-calm air for reflections', () => {
    const calm = makeForecast({
      surface: { windSpeed10m: 3, windGusts10m: 6, precipitation: 0 },
      levels: [],
    });
    const breezy = makeForecast({
      surface: { windSpeed10m: 15, windGusts10m: 25, precipitation: 0 },
      levels: [],
    });
    const loch: Target = { id: 'loch', name: 'Loch', altitudeM: 50 };
    expect(evaluateWindow(calm, dawn, loch, 'reflections', config).verdict).toBe('go');
    expect(evaluateWindow(breezy, dawn, loch, 'reflections', config).verdict).toBe('no');
  });
});

describe('multi-model evaluation', () => {
  it('averages models, reports disagreement and lowers confidence', () => {
    const ukv = makeForecast(inversionMorning);
    const ecmwf = makeForecast({ ...windyWetDay, model: 'ecmwf_ifs025' });
    const r = evaluateTarget([ukv, ecmwf], dawn, benLedi, 'inversion', config, { now });
    expect(r.referenceModel).toBe('ukmo_uk_deterministic_2km');
    expect(r.confidence).toBe('low');
    const reasons = explain(r);
    expect(reasons.at(-1)!.text).toMatch(/Models disagree/);
  });

  it('gives High confidence when models agree within the horizon', () => {
    const a = makeForecast(inversionMorning);
    const b = makeForecast({ ...inversionMorning, model: 'icon_seamless' });
    const r = evaluateTarget([a, b], dawn, benLedi, 'inversion', config, { now });
    expect(r.verdict).toBe('go');
    expect(r.confidence).toBe('high');
  });

  it('caps confidence beyond the horizon and for a single model', () => {
    const window = { start: now + 72 * HOUR, end: now + 75 * HOUR };
    expect(confidenceFor(0, 3, window, config, { now })).toBe('medium');
    expect(confidenceFor(0, 1, dawn, config, { now })).toBe('medium');
    expect(confidenceFor(0.2, 3, dawn, config, { now })).toBe('medium');
    expect(confidenceFor(0.4, 3, dawn, config, { now })).toBe('low');
  });

  it('returns nodata when no model covers the window', () => {
    const late = { start: T0 + 100 * HOUR, end: T0 + 101 * HOUR };
    const r = evaluateTarget([makeForecast(inversionMorning)], late, benLedi, 'inversion', config, {
      now,
    });
    expect(r.verdict).toBe('nodata');
    expect(explain(r)[0]!.status).toBe('nodata');
  });

  it('ranks GO before MAYBE before NO, then by score', () => {
    const f = [makeForecast(inversionMorning)];
    const results = [lowHill, benLedi].map((t) =>
      evaluateTarget(f, dawn, t, 'inversion', config, { now }),
    );
    expect(rankResults(results).map((r) => r.target.id)).toEqual(['ben-ledi', 'low-hill']);
  });
});

describe('explain', () => {
  it('lists failed gates first and formats wind in mph when asked', () => {
    const r = evaluateTarget([makeForecast(windyWetDay)], dawn, benLedi, 'walking', config, {
      now,
    });
    const reasons = explain(r, { wind: 'mph' });
    expect(reasons[0]!.status).toBe('blocked');
    expect(reasons[0]!.text).toMatch(/^Summit gusts \d+ mph: limit 50 mph\.$/);
  });
});
