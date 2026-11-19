import { describe, expect, it } from 'vitest';
import type { HourResult, Verdict } from '@atmos/engine';
import { goodWindow } from './email';

const H = 3_600_000;
const hours = (verdicts: Verdict[]): HourResult[] =>
  verdicts.map((verdict, i) => ({
    time: i * H,
    score: 0.5,
    gated: false,
    verdict,
    factors: [],
    gates: [],
  }));

describe('goodWindow', () => {
  it('is the run of good hours around the best one', () => {
    const h = hours(['no', 'maybe', 'go', 'go', 'no', 'go']);
    expect(goodWindow(h, 2 * H)).toEqual({ start: 1 * H, end: 4 * H });
  });
  it('is nothing without a best hour, or when the best hour itself is poor', () => {
    expect(goodWindow(hours(['go']), null)).toBeNull();
    expect(goodWindow(hours(['no', 'go']), 0)).toBeNull();
  });
});
