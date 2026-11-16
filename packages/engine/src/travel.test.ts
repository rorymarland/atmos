import { describe, expect, it } from 'vitest';
import {
  estimateDrive,
  estimateSummitWalk,
  formatDuration,
  naismithMinutes,
  planTrip,
  tripProblem,
} from './travel.js';

const edinburgh = { lat: 55.9533, lon: -3.1883 };
const benLawers = { lat: 56.5449, lon: -4.2208 };
const glencoe = { lat: 56.682, lon: -5.103 };
const MIN = 60_000;

describe('estimateDrive', () => {
  it('lands close to real UK hill drives', () => {
    // Google typically says about 1 h 50 and 2 h 35 for these.
    expect(estimateDrive(edinburgh, benLawers).minutes).toBeGreaterThan(95);
    expect(estimateDrive(edinburgh, benLawers).minutes).toBeLessThan(125);
    expect(estimateDrive(edinburgh, glencoe).minutes).toBeGreaterThan(140);
    expect(estimateDrive(edinburgh, glencoe).minutes).toBeLessThan(170);
  });

  it('is zero for the same place', () => {
    expect(estimateDrive(edinburgh, edinburgh)).toEqual({ roadMiles: 0, minutes: 0 });
  });
});

describe('walking', () => {
  it('follows Naismith and the pace setting', () => {
    expect(naismithMinutes(5, 600)).toBe(120);
    expect(naismithMinutes(5, 600, 'relaxed')).toBe(150);
    expect(naismithMinutes(5, 600, 'brisk')).toBe(102);
  });

  it('estimates a summit walk from the ascent', () => {
    const w = estimateSummitWalk(1214, 200);
    expect(w.ascentM).toBe(1014);
    expect(w.distanceKm).toBeCloseTo(8.45, 1);
    expect(w.minutes).toBe(203);
    expect(estimateSummitWalk(100, 300).distanceKm).toBe(1.5);
  });
});

describe('planTrip', () => {
  const target = Date.UTC(2026, 10, 17, 7, 40);
  const plan = planTrip({
    target,
    driveMinutes: 110,
    walkMinutes: 120,
    earlyMinutes: 15,
    readyMinutes: 30,
  });

  it('works back from the target', () => {
    expect(plan.arriveAt).toBe(target - 15 * MIN);
    expect(plan.parkAt).toBe(target - 135 * MIN);
    expect(plan.leaveAt).toBe(target - 245 * MIN);
    expect(plan.wakeAt).toBe(target - 275 * MIN);
  });

  it('flags plans that break the limits', () => {
    const now = target - 24 * 60 * MIN;
    const ok = { earliestWake: null, maxDriveMinutes: null, now };
    expect(tripProblem(plan, 110, ok)).toBeNull();
    // Wake is 03:05; not before 04:00.
    expect(tripProblem(plan, 110, { ...ok, earliestWake: Date.UTC(2026, 10, 17, 4) })).toBe(
      'too-early',
    );
    expect(tripProblem(plan, 110, { ...ok, maxDriveMinutes: 90 })).toBe('too-far');
    expect(tripProblem(plan, 110, { ...ok, now: plan.leaveAt + MIN })).toBe('too-late');
  });
});

describe('formatDuration', () => {
  it('rounds to five minutes', () => {
    expect(formatDuration(33)).toBe('35 min');
    expect(formatDuration(110)).toBe('1 h 50');
    expect(formatDuration(120)).toBe('2 h');
    expect(formatDuration(62)).toBe('1 h');
    expect(formatDuration(68)).toBe('1 h 10');
  });
});
