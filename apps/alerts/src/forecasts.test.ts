import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Zone } from '@atmos/engine';
import { FEEDS, Feeder, feedDue } from './forecasts';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 17, 12);

const zone = (i: number): Zone => ({
  id: `z${i}`,
  name: `Zone ${i}`,
  nation: 'scotland',
  forecastPoint: { lat: 56 + i / 10, lon: -4 - i / 10 },
});

/**
 * A stand-in for Open-Meteo: every value is the model's current run number, so a new run
 * shows in the probe. Counts full fetches (more than one point) and probes per model.
 */
function fakeOpenMeteo(clock: { t: number }) {
  const runs: Record<string, number> = {};
  const full: string[] = [];
  const probes: string[] = [];
  let status = 200;
  let reason = '';
  const fetch = (async (input: string | URL) => {
    const url = new URL(String(input));
    const q = url.searchParams;
    // The air quality API takes no model: it's CAMS.
    const model = q.get('models') ?? (url.hostname.startsWith('air-quality') ? 'cams' : '?');
    const lats = q.get('latitude')!.split(',');
    const hourly = q.get('hourly')!.split(',');
    const hours = (Number(q.get('forecast_days')) + Number(q.get('past_days'))) * 24;
    // A probe is one point and three variables on the weather API.
    const probe = lats.length === 1 && hourly.length === 3 && model !== 'cams';
    (probe ? probes : full).push(model);
    clock.t += 20_000;
    if (status !== 200) return new Response(JSON.stringify({ error: true, reason }), { status });
    const run = runs[model] ?? 1;
    const time = Array.from({ length: hours }, (_, h) => T0 / 1000 + h * 3600);
    const body = lats.map(() => ({
      latitude: 56,
      longitude: -4,
      elevation: 50,
      hourly: Object.fromEntries([['time', time], ...hourly.map((v) => [v, time.map(() => run)])]),
    }));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    full,
    probes,
    newRun: (model: string) => (runs[model] = (runs[model] ?? 1) + 1),
    fail: (s: number, why = '') => {
      status = s;
      reason = why;
    },
  };
}

// The data client's per-minute limiter is shared by every test: each starts a day later.
let day = 0;
function setup(zones = [zone(0), zone(1), zone(2)]) {
  const clock = { t: T0 + ++day * 24 * HOUR };
  const om = fakeOpenMeteo(clock);
  const dir = mkdtempSync(join(tmpdir(), 'atmos-feeds-'));
  const make = () =>
    new Feeder({ dir, zones: async () => zones, fetch: om.fetch, now: () => clock.t });
  return { om, clock, dir, zones, make, feeder: make() };
}

describe('feedDue', () => {
  const spec = FEEDS.met;
  it('fetches when nothing is held, waits the minimum gap, then probes, then must fetch', () => {
    expect(feedDue(spec, undefined, T0)).toBe('yes');
    expect(feedDue(spec, { fetchedAt: T0 }, T0 + HOUR)).toBe('no');
    expect(feedDue(spec, { fetchedAt: T0 }, T0 + 2 * HOUR)).toBe('probe');
    expect(feedDue(spec, { fetchedAt: T0 }, T0 + 6 * HOUR)).toBe('yes');
  });
});

describe('Feeder', () => {
  it('fetches every feed at the start and serves each zone with every model', async () => {
    const { feeder, om } = setup();
    await feeder.tick();
    expect(om.full.sort()).toEqual(
      [
        'ecmwf_ifs025',
        'ecmwf_ifs025',
        'knmi_harmonie_arome_europe',
        'ukmo_seamless',
        'ukmo_seamless',
        'cams',
      ].sort(),
    );
    const z = feeder.zone('z1')!;
    expect(z.models.map((m) => m.model)).toEqual([
      'ukmo_seamless',
      'ecmwf_ifs025',
      'knmi_harmonie_arome_europe',
    ]);
    expect(z.horizon.am?.model).toBe('ukmo_seamless');
    expect(z.upper?.model).toBe('ecmwf_ifs025');
    expect(z.air?.surface.aerosolOpticalDepth?.length).toBeGreaterThan(0);
    expect(feeder.index().feeds.met?.zones).toBe(3);
  });

  it('only fetches again once the gap has passed and a new run has landed', async () => {
    const { feeder, om, clock } = setup();
    await feeder.tick();
    om.full.length = 0;
    om.probes.length = 0;

    // An hour on: too soon for anything, and nothing is even probed.
    clock.t += HOUR;
    await feeder.tick();
    expect(om.full).toEqual([]);
    expect(om.probes).toEqual([]);

    // Two hours on: the Met Office is probed, but its run hasn't changed.
    clock.t += HOUR;
    await feeder.tick();
    expect(om.full).toEqual([]);
    expect(om.probes).toEqual(['ukmo_seamless']);

    // A new UKV run: the Met Office feed is fetched; ECMWF's isn't due.
    om.newRun('ukmo_seamless');
    clock.t += 15 * 60_000;
    await feeder.tick();
    expect(om.full).toEqual(['ukmo_seamless']);

    // Three hours in, a new UKV run doesn't touch ECMWF either: only its own new run does.
    om.full.length = 0;
    clock.t += HOUR;
    await feeder.tick();
    expect(om.full.filter((m) => m === 'ecmwf_ifs025')).toEqual([]);
    om.newRun('ecmwf_ifs025');
    clock.t += 15 * 60_000;
    await feeder.tick();
    expect(om.full).toContain('ecmwf_ifs025');
  });

  it('refetches haze twice a day without probing for it', async () => {
    const { feeder, om, clock } = setup();
    await feeder.tick();
    om.full.length = 0;
    clock.t += 11 * HOUR;
    await feeder.tick();
    expect(om.full).not.toContain('cams');
    clock.t += HOUR;
    await feeder.tick();
    expect(om.full).toContain('cams');
    expect(om.probes).not.toContain('cams');
  });

  it('fetches a zone added since on its own, not the whole feed', async () => {
    const zones = [zone(0), zone(1)];
    const { om, clock, make } = setup(zones);
    const feeder = make();
    await feeder.tick();
    const before = feeder.feed('met')!;
    zones.push(zone(5));
    om.full.length = 0;
    om.probes.length = 0;
    clock.t += 10 * 60_000;
    await feeder.tick();
    expect(feeder.zone('z5')).not.toBeNull();
    expect(feeder.feed('met')!.fetchedAt).toBe(before.fetchedAt);
    // One point per feed: never a full refetch.
    expect(om.probes).toEqual([]);
    expect(om.full).toHaveLength(6);
  });

  it('keeps what it fetched across a restart, without fetching again', async () => {
    const { feeder, om, clock, make } = setup();
    await feeder.tick();
    om.full.length = 0;
    clock.t += 30 * 60_000;
    const again = make();
    await again.tick();
    expect(om.full).toEqual([]);
    expect(again.zone('z0')?.models).toHaveLength(3);
    expect(again.spentToday()).toBeGreaterThan(0);
  });

  it('backs off briefly after the minute limit, and says so', async () => {
    const { feeder, om, clock } = setup();
    om.fail(429, 'Minutely API request limit exceeded. Please try again in one minute.');
    await feeder.tick();
    const idx = feeder.index();
    expect(idx.pausedUntil).toBeGreaterThan(clock.t);
    expect(idx.limitedAt).not.toBeNull();
    expect(idx.events[0]!.text).toMatch(/the minute's limit/);
    expect(idx.feeds.met).toBeUndefined();
    const tries = om.full.length + om.probes.length;
    om.fail(200);
    clock.t += 5 * 60_000;
    await feeder.tick();
    expect(om.full.length + om.probes.length).toBe(tries);
    clock.t += 6 * 60_000;
    await feeder.tick();
    expect(feeder.zone('z0')).not.toBeNull();
  });

  it("waits an hour after the day's limit, and tells the check page", async () => {
    const { feeder, om, clock } = setup();
    await feeder.tick();
    clock.t += 7 * HOUR;
    om.fail(429, 'Daily API request limit exceeded. Please try again tomorrow.');
    await feeder.tick();
    const idx = feeder.index();
    expect(idx.pausedUntil! - clock.t).toBeGreaterThan(55 * 60_000);
    expect(idx.nextCheckAt).toBe(idx.pausedUntil);
    expect(idx.events[0]).toMatchObject({ level: 'error', feed: 'met' });
    expect(idx.events[0]!.text).toMatch(/the day's limit/);
    expect(idx.feeds.met).toMatchObject({ lastCheck: 'failed' });
    expect(idx.feeds.met!.lastError).toMatch(/Daily API request limit/);
  });

  it('says when each feed was pulled and when it is next due', async () => {
    const { feeder, clock } = setup();
    await feeder.tick();
    const idx = feeder.index();
    const met = idx.feeds.met!;
    expect(met.lastCheck).toBe('fetched');
    expect(met.notBefore - met.fetchedAt).toBe(2 * HOUR);
    expect(met.latestBy - met.fetchedAt).toBe(6 * HOUR);
    expect(idx.nextCheckAt).toBe(idx.lastCheckAt! + 5 * 60_000);
    expect(idx.events.filter((e) => e.text.startsWith('Fetched'))).toHaveLength(6);
    expect(idx.spentToday).toBeGreaterThan(0);
    // Two hours on with no new run: checked, same run.
    clock.t += 2 * HOUR;
    await feeder.tick();
    expect(feeder.index().feeds.met!.lastCheck).toBe('same-run');
  });

  it('keeps its events across a restart', async () => {
    const { feeder, make } = setup();
    await feeder.tick();
    expect(make().index().events.length).toBe(feeder.index().events.length);
  });

  it('stays inside the daily budget', { timeout: 60_000 }, async () => {
    const zones = Array.from({ length: 68 }, (_, i) => zone(i));
    const { feeder, om, clock } = setup(zones);
    // A day of new runs every hour, ticking every 15 minutes.
    for (let i = 0; i < 96; i++) {
      if (i % 4 === 0)
        for (const m of ['ukmo_seamless', 'knmi_harmonie_arome_europe']) om.newRun(m);
      if (i % 24 === 0) om.newRun('ecmwf_ifs025');
      await feeder.tick();
      clock.t += 15 * 60_000;
    }
    expect(feeder.spentToday()).toBeLessThan(8_000);
  });
});
