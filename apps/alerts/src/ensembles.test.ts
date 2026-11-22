import { describe, expect, it } from 'vitest';
import { ENSEMBLE_DAILY_CAP, EnsembleCache } from './ensembles';

/** A tiny ensemble reply: two members of every variable. */
const reply = () =>
  new Response(
    JSON.stringify({
      hourly: {
        time: [1_795_000_000, 1_795_003_600],
        cloud_cover: [10, 20],
        cloud_cover_member01: [15, 25],
      },
    }),
  );

function setup(spentElsewhere = 0) {
  const clock = { t: Date.UTC(2026, 10, 22, 10) };
  let calls = 0;
  let spent = spentElsewhere;
  const cache = new EnsembleCache({
    budget: { spentToday: () => spent, spend: (w) => (spent += w), dailyLimit: 10_000 },
    fetch: (async () => {
      calls++;
      return reply();
    }) as typeof fetch,
    now: () => clock.t,
  });
  return { cache, clock, calls: () => calls, spent: () => spent };
}

describe('shared ensembles', () => {
  it('fetches once for neighbouring hills and keeps it two hours', async () => {
    const s = setup();
    const a = await s.cache.get('ecmwf', 56.797, -5.004);
    const b = await s.cache.get('ecmwf', 56.81, -4.98);
    expect(a?.members.cloud_cover).toHaveLength(2);
    expect(b).toBe(a);
    expect(s.calls()).toBe(1);
    s.clock.t += 2.5 * 3_600_000;
    await s.cache.get('ecmwf', 56.797, -5.004);
    expect(s.calls()).toBe(2);
  });

  it('counts against the shared allowance, and stops before it runs out', async () => {
    const s = setup();
    await s.cache.get('ukmo', 56.5, -4.5);
    expect(s.spent()).toBeGreaterThan(9);
    const tight = setup(8_600);
    expect(await tight.cache.get('ecmwf', 56.5, -4.5)).toBeNull();
    expect(tight.calls()).toBe(0);
  });

  it("doesn't count a fetch that never reached Open-Meteo", async () => {
    let spent = 0;
    const cache = new EnsembleCache({
      budget: { spentToday: () => spent, spend: (w) => (spent += w), dailyLimit: 10_000 },
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as typeof fetch,
    });
    await expect(cache.get('ecmwf', 56.5, -4.5)).rejects.toThrow();
    expect(spent).toBe(0);
  });

  it('has its own daily cap', async () => {
    const s = setup();
    for (let i = 0; i < 200 && s.cache.spentToday() < ENSEMBLE_DAILY_CAP - 30; i++) {
      await s.cache.get('ecmwf', 50 + i * 0.1, -4);
    }
    expect(await s.cache.get('ecmwf', 61, -1)).toBeNull();
  });
});
