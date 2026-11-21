import { describe, expect, it } from 'vitest';
import { assessTrails, withTraffic } from '@atmos/engine';
import { trafficAt, trafficThresholds, type TrafficGrid } from '../../web/src/lib/traffic-grid';

const base = { latMin: 50, lonMin: -8, cellDeg: 0.5, rows: 20, cols: 20 };
/** Busy over the north-west corner of the grid at 08:00 UTC, quiet everywhere else. */
function grid(ready = true): TrafficGrid {
  const perHour = Array.from({ length: 24 }, (_, h) =>
    Array.from({ length: 400 }, (_, cell) => {
      const row = Math.floor(cell / 20);
      const col = cell % 20;
      return h === 8 && row > 14 && col < 6 ? 4 : 0.1;
    }),
  );
  return { ...base, perHour, ready, days: 30, thresholds: trafficThresholds({ ...base, perHour }) };
}
const at8 = Date.UTC(2026, 10, 21, 8, 20);
const at3 = Date.UTC(2026, 10, 21, 3, 20);

describe('traffic near a place', () => {
  it('is busy under the busy corner at that hour, quiet otherwise', () => {
    const g = grid();
    expect(trafficAt(g, 58, -7, at8)?.level).toBe('busy');
    expect(trafficAt(g, 58, -7, at3)?.level).toBe('quiet');
    expect(trafficAt(g, 51, 1, at8)?.level).toBe('quiet');
  });
  it('is unknown until the grid is ready, or outside it', () => {
    expect(trafficAt(grid(false), 58, -7, at8)).toBeNull();
    expect(trafficAt(null, 58, -7, at8)).toBeNull();
    expect(trafficAt(grid(), 40, 0, at8)).toBeNull();
  });
});

describe('trail risk with traffic', () => {
  const lingering = assessTrails([{ pressureHpa: 250, temperatureC: -52, rhIce: 106 }], 0, 0)!;
  it('steps down in quiet airspace, and says so', () => {
    const t = withTraffic(lingering, { level: 'quiet', aircraft: 0.4 });
    expect(t.risk).toBe('medium');
    expect(t.text).toMatch(/Quiet airspace/);
  });
  it('names busy airspace, and changes nothing without data', () => {
    expect(withTraffic(lingering, { level: 'busy', aircraft: 9 }).text).toMatch(/Busy airspace/);
    expect(withTraffic(lingering, null)).toBe(lingering);
  });
  it('leaves trails that fade quickly alone', () => {
    const dry = assessTrails([{ pressureHpa: 250, temperatureC: -52, rhIce: 40 }], 0, 0)!;
    expect(withTraffic(dry, { level: 'busy', aircraft: 9 })).toBe(dry);
  });
});
