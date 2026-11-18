import { describe, expect, it } from 'vitest';
import type { HourResult, TargetResult } from '@atmos/engine';
import { loadRealConfig } from '../../../packages/engine/src/test-config';
import { chooseWalk, type WalkInput } from '../../web/src/lib/walk';
import type { SunTimes } from '../../web/src/lib/sun';

const config = loadRealConfig();
const HOUR = 3_600_000;
const MIN = 60_000;
// 1 December: London is on UTC, so these are clock times.
const day = Date.UTC(2026, 11, 1);
const at = (h: number, m = 0) => day + h * HOUR + m * MIN;
const sun = {
  civilDawn: at(7, 40),
  sunrise: at(8, 25),
  sunset: at(15, 40),
  civilDusk: at(16, 25),
} as SunTimes;

/** Walking scored hour by hour, 06:00 to 20:00, from a score for each hour. */
function span(score: (hour: number) => number): TargetResult {
  const hours: HourResult[] = [];
  for (let h = 6; h <= 20; h++) {
    const s = score(h);
    hours.push({ time: at(h), score: s, gated: false, verdict: 'go', factors: [], gates: [] });
  }
  const model = {
    model: 'ukmo_seamless',
    score: null,
    verdict: 'nodata' as const,
    keyHour: null,
    hours,
  };
  return {
    target: { id: '1', name: 'Hill', altitudeM: 900, lat: 56, lon: -4 },
    profileId: 'walking',
    score: null,
    verdict: 'nodata',
    confidence: 'low',
    referenceModel: null,
    byModel: [model],
  };
}

const walk = (over: Partial<WalkInput> & Pick<WalkInput, 'span'>) =>
  chooseWalk({
    periods: ['day'],
    sun,
    dayStart: day,
    upMinutes: 100,
    downMinutes: 65,
    start: 'best',
    downBy: 'sunset',
    notBefore: 0,
    config,
    options: { now: day - 24 * HOUR },
    ...over,
  });

describe('chooseWalk', () => {
  it('sets off for the dry morning when the afternoon turns wild', () => {
    const p = walk({ span: span((h) => (h < 12 ? 0.9 : 0.15)) })!;
    expect(p.end - p.start).toBe(180 * MIN);
    expect(p.start).toBeLessThanOrEqual(at(9));
    expect(p.result.verdict).toBe('go');
    expect(p.torch).toBeNull();
  });

  it('waits for the weather to clear, but is still down before sunset', () => {
    const p = walk({ span: span((h) => (h < 12 ? 0.2 : 0.9)) })!;
    expect(p.start).toBeGreaterThanOrEqual(at(12));
    expect(p.end).toBeLessThanOrEqual(sun.sunset!);
    expect(p.torch).toBeNull();
  });

  it('with "Any time", can run past sunset, and says to take a head torch', () => {
    const p = walk({ span: span((h) => (h < 14 ? 0.2 : 0.9)), downBy: 'any' })!;
    expect(p.end).toBeGreaterThan(sun.sunset!);
    expect(p.torch).not.toBeNull();
  });

  it('flags a walk too long for the daylight, starting as early as it can', () => {
    const p = walk({ span: span(() => 0.8), upMinutes: 300, downMinutes: 220 })!;
    expect(p.tooLong).toBe(true);
    expect(p.torch).toBe('dark');
    expect(p.start).toBe(at(8));
  });

  it('a morning walk sets off around first light', () => {
    const p = walk({ span: span(() => 0.8), periods: ['morning'] })!;
    expect(p.period).toBe('morning');
    expect(p.start).toBeGreaterThanOrEqual(sun.civilDawn!);
    expect(p.start).toBeLessThanOrEqual(sun.sunrise! + HOUR);
  });

  it('an evening walk finishes around sunset', () => {
    const p = walk({ span: span(() => 0.8), periods: ['evening'] })!;
    expect(p.period).toBe('evening');
    expect(p.end).toBeLessThanOrEqual(sun.sunset!);
    expect(p.end).toBeGreaterThanOrEqual(sun.sunset! - 90 * MIN);
  });

  it('a set time is kept, with a head torch warning if it runs late', () => {
    const p = walk({ span: span(() => 0.8), start: '14:00' })!;
    expect(p.start).toBe(at(14));
    expect(p.torch).toBe('dark');
    expect(p.tooLong).toBe(true);
  });

  it('never sets off before it could be at the car', () => {
    const p = walk({ span: span((h) => (h < 11 ? 0.9 : 0.5)), notBefore: at(10, 30) })!;
    expect(p.start).toBeGreaterThanOrEqual(at(10, 30));
  });

  it('judges only the hours of the walk', () => {
    const p = walk({ span: span((h) => (h < 12 ? 0.9 : 0.15)) })!;
    const hours = p.result.byModel[0]!.hours.map((h) => h.time);
    expect(Math.min(...hours)).toBe(Math.floor(p.start / HOUR) * HOUR);
    expect(Math.max(...hours)).toBeLessThan(p.end);
  });
});
