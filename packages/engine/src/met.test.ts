import { describe, expect, it } from 'vitest';
import {
  dewPoint,
  inversionStrength,
  liftingCondensationHeight,
  saturatedLayers,
  windChill,
} from './met.js';
import { rampScore } from './ramp.js';

describe('rampScore', () => {
  it('scores lower-is-better ramps', () => {
    const r = { good: 30, bad: 60 };
    expect(rampScore(r, 10)).toBe(1);
    expect(rampScore(r, 45)).toBeCloseTo(0.5);
    expect(rampScore(r, 80)).toBe(0);
  });

  it('scores higher-is-better ramps', () => {
    const r = { good: 3, bad: 0 };
    expect(rampScore(r, 5)).toBe(1);
    expect(rampScore(r, 1.5)).toBeCloseTo(0.5);
    expect(rampScore(r, -2)).toBe(0);
  });

  it('scores band ramps', () => {
    const r = { band: [20, 70] as [number, number], zero: [0, 95] as [number, number] };
    expect(rampScore(r, 50)).toBe(1);
    expect(rampScore(r, 10)).toBeCloseTo(0.5);
    expect(rampScore(r, 0)).toBe(0);
    expect(rampScore(r, 82.5)).toBeCloseTo(0.5);
    expect(rampScore(r, 100)).toBe(0);
  });
});

describe('met helpers', () => {
  it('computes dew point', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1);
    expect(dewPoint(5, 100)).toBeCloseTo(5, 5);
  });

  it('computes wind chill only where it is defined', () => {
    expect(windChill(0, 20)).toBeCloseTo(-5.2, 1);
    expect(windChill(15, 40)).toBe(15);
    expect(windChill(0, 3)).toBe(0);
  });

  it('estimates the lifting condensation height', () => {
    expect(liftingCondensationHeight(10, 6)).toBe(500);
    expect(liftingCondensationHeight(5, 6)).toBe(0);
  });

  it('finds saturated layers with interpolated boundaries', () => {
    const layers = saturatedLayers([
      { heightM: 100, value: 100 },
      { heightM: 300, value: 98 },
      { heightM: 500, value: 48 },
      { heightM: 800, value: 96 },
      { heightM: 1000, value: 96 },
    ]);
    expect(layers).toHaveLength(2);
    // 98 -> 48 crosses 95 at 300 + 3/50 * 200 = 312 m.
    expect(layers[0]!.baseM).toBe(100);
    expect(layers[0]!.topM).toBeCloseTo(312);
    // 48 -> 96 crosses 95 at 500 + 47/48 * 300 = 793.75 m; runs to the top of the profile.
    expect(layers[1]!.baseM).toBeCloseTo(793.75);
    expect(layers[1]!.topM).toBe(1000);
  });

  it('measures inversion strength from the warmest air aloft', () => {
    const profile = [
      { heightM: 52, value: -2 },
      { heightM: 400, value: -0.5 },
      { heightM: 600, value: 5 },
      { heightM: 2000, value: 9 },
    ];
    // The 2000 m point is beyond the 1500 m search depth.
    expect(inversionStrength(profile, -2, 50, 1500)).toBe(7);
    expect(inversionStrength([], 0, 50)).toBeNull();
  });
});
