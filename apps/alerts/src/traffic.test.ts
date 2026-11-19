import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cellOf, COLS, cruising, MIN_ALTITUDE_M, TrafficSampler } from './traffic';

/** An OpenSky state vector: only the fields we read. */
const plane = (lat: number, lon: number, altM: number | null, onGround = false) => [
  'abc123',
  'TEST1 ',
  'United Kingdom',
  0,
  0,
  lon,
  lat,
  altM,
  onGround,
  230,
  270,
  0,
  null,
  altM,
];

function setup(reply: () => Response) {
  const dir = mkdtempSync(join(tmpdir(), 'atmos-traffic-'));
  const clock = { t: Date.UTC(2026, 10, 20, 7, 10) };
  let calls = 0;
  const fetch = (async () => {
    calls++;
    return reply();
  }) as typeof globalThis.fetch;
  const make = () => new TrafficSampler({ dir, fetch, now: () => clock.t });
  return { clock, make, calls: () => calls };
}

describe('traffic sampling', () => {
  it('keeps aircraft at cruise height inside the UK box', () => {
    const p = cruising({
      states: [
        plane(56, -4, 11_000),
        plane(56, -4, MIN_ALTITUDE_M - 100),
        plane(56, -4, 11_000, true),
        plane(56, -4, null),
      ],
    });
    expect(p).toEqual([{ lat: 56, lon: -4 }]);
    expect(cruising({ states: null })).toEqual([]);
    expect(cellOf(49.6, -8.9)).toBe(0);
    expect(cellOf(49.6, -8.4)).toBe(1);
    expect(cellOf(50.1, -8.9)).toBe(COLS);
    expect(cellOf(40, 0)).toBe(-1);
  });

  it('counts each snapshot by hour and place, and keeps it across a restart', async () => {
    const body = { states: [plane(56.2, -4.1, 11_000), plane(56.3, -4.2, 10_500)] };
    const { make } = setup(
      () => new Response(JSON.stringify(body), { headers: { 'x-rate-limit-remaining': '391' } }),
    );
    const s = make();
    await s.sample();
    await s.sample();
    const sum = s.summary();
    expect(sum.samples).toBe(2);
    expect(sum.lastCount).toBe(2);
    expect(sum.creditsLeft).toBe(391);
    expect(sum.byHour[7]).toBe(2);
    expect(s.state.counts[7]![cellOf(56.2, -4.1)]).toBe(4);
    expect(make().summary().samples).toBe(2);
  });

  it('waits when OpenSky says the allowance is used up', async () => {
    const { make, clock, calls } = setup(
      () =>
        new Response('', { status: 429, headers: { 'x-rate-limit-retry-after-seconds': '3600' } }),
    );
    const s = make();
    await s.sample();
    expect(s.summary().lastError).toMatch(/allowance/);
    expect(s.summary().nextAt).toBe(clock.t + 3_600_000);
    clock.t += 30 * 60_000;
    await s.sample();
    expect(calls()).toBe(1);
  });
});
