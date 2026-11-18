/**
 * Forecasts for every zone, fetched here once and shared: browsers load them from
 * /api/forecasts instead of each one spending its own share of Open-Meteo's daily limit,
 * and alerts score from the same copy.
 *
 * Each feed is fetched again only once its minimum gap has passed and a new model run has
 * reached Open-Meteo. A one-point probe (one call) tells whether it has, so 6-hourly models
 * aren't re-downloaded every hour. A daily budget keeps the total well inside the limit.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelForecast, Zone } from '@atmos/engine';
import {
  buildForecastUrl,
  estimateCallWeight,
  fetchZoneForecasts,
  ForecastError,
  HARMONIE_REQUEST,
  isDailyLimit,
  limitReason,
  HORIZON_REQUEST,
  parseForecastResponse,
  ZONE_REQUEST,
  type ForecastRequest,
  type ForecastSite,
} from '@atmos/data-client';
import { horizonSites } from '../../web/src/lib/evaluate-places';

export type FeedId = 'met' | 'ecmwf' | 'harmonie' | 'horizon';
export const FEED_IDS: FeedId[] = ['met', 'ecmwf', 'harmonie', 'horizon'];

const HOUR = 3_600_000;

export interface FeedSpec {
  request: Omit<ForecastRequest, 'points'>;
  /** The model whose new runs the probe watches. */
  probeModel: string;
  /** Never sooner than this after the last fetch. */
  minGapMs: number;
  /** Fetched by now even if the probe sees nothing new (a stuck probe mustn't freeze it). */
  maxGapMs: number;
  /** Fetched only while the day's spending is under this (the extras give way first). */
  dailyCap: number;
  /** Where to forecast: the zones themselves, or points towards sunrise and sunset. */
  sites: (zones: Zone[], now: number) => ForecastSite[];
}

/** The Met Office's UKV runs hourly; every two hours keeps the day's total comfortable. */
export const FEEDS: Record<FeedId, FeedSpec> = {
  met: {
    request: { ...ZONE_REQUEST, models: ['ukmo_seamless'] },
    probeModel: 'ukmo_seamless',
    minGapMs: 2 * HOUR,
    maxGapMs: 6 * HOUR,
    dailyCap: 9_300,
    sites: (zones) => zones,
  },
  // ECMWF runs every six hours: the probe catches each new run soon after it lands.
  ecmwf: {
    request: { ...ZONE_REQUEST, models: ['ecmwf_ifs025'] },
    probeModel: 'ecmwf_ifs025',
    minGapMs: 3 * HOUR,
    maxGapMs: 12 * HOUR,
    dailyCap: 9_000,
    sites: (zones) => zones,
  },
  harmonie: {
    request: HARMONIE_REQUEST,
    probeModel: 'knmi_harmonie_arome_europe',
    minGapMs: 3 * HOUR,
    maxGapMs: 12 * HOUR,
    dailyCap: 8_000,
    sites: (zones) => zones,
  },
  horizon: {
    request: HORIZON_REQUEST,
    probeModel: 'ukmo_seamless',
    minGapMs: 3 * HOUR,
    maxGapMs: 12 * HOUR,
    dailyCap: 8_000,
    sites: (zones, now) => zones.flatMap((z) => horizonSites(z, now)),
  },
};

/** One call: a point, three variables, two days. Enough to tell one run from the next. */
export function probeRequest(model: string, point: { lat: number; lon: number }): ForecastRequest {
  return {
    models: [model],
    surface: ['temperature2m', 'relativeHumidity2m', 'cloudCoverLow'],
    pressureLevels: [],
    forecastDays: 2,
    pastDays: 0,
    points: [point],
  };
}

export interface FeedData {
  /** Changes whenever the data does; the browser's cache key and the ETag. */
  version: string;
  fetchedAt: number;
  /** The probe's reading when this was fetched: a different reading means a newer run. */
  probe: string | null;
  /** Forecasts by zone id (horizon: by `${zoneId}|am` and `${zoneId}|pm`). */
  zones: Record<string, ModelForecast[]>;
}

interface Spend {
  at: number;
  weight: number;
}

/** Open-Meteo's free allowance per IP address per day. */
export const DAILY_LIMIT = 10_000;

/** The outcome of the last look at a feed. */
export type CheckOutcome = 'fetched' | 'same-run' | 'over-budget' | 'failed';

export interface FeedStatus {
  lastCheckAt: number | null;
  lastCheck: CheckOutcome | null;
  lastError: string | null;
}

export interface FeedEvent {
  at: number;
  level: 'info' | 'warn' | 'error';
  feed?: FeedId;
  text: string;
}

const MAX_EVENTS = 50;

export interface FeederOptions {
  dir: string;
  zones: () => Promise<Zone[]>;
  /** How often `tick` is called, for saying when the next look is. */
  tickMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

/** Whether a feed is due: never before its minimum gap, always after its maximum. */
export function feedDue(
  spec: FeedSpec,
  last: { fetchedAt: number } | undefined,
  now: number,
): 'no' | 'probe' | 'yes' {
  if (!last) return 'yes';
  const age = now - last.fetchedAt;
  if (age < spec.minGapMs) return 'no';
  if (age >= spec.maxGapMs) return 'yes';
  return 'probe';
}

export class Feeder {
  #feeds = new Map<FeedId, FeedData>();
  #gz = new Map<FeedId, Buffer>();
  #spend: Spend[] = [];
  #pausedUntil = 0;
  #running = false;
  #status = new Map<FeedId, FeedStatus>();
  #events: FeedEvent[] = [];
  #lastTickAt: number | null = null;
  #limitedAt: number | null = null;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: (msg: string) => void;
  lastError: string | null = null;

  constructor(readonly opts: FeederOptions) {
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = opts.now ?? Date.now;
    this.#log = opts.log ?? (() => undefined);
    mkdirSync(opts.dir, { recursive: true });
    this.#load();
  }

  /**
   * What each feed holds (the browser uses the versions to see what's changed), when each
   * is next due, today's spending and recent events (for the check page).
   */
  index() {
    const now = this.#now();
    const feeds: Partial<
      Record<
        FeedId,
        {
          version: string;
          fetchedAt: number;
          zones: number;
          /** No new fetch before this. */
          notBefore: number;
          /** Fetched by this even without a new run. */
          latestBy: number;
        } & FeedStatus
      >
    > = {};
    for (const [id, f] of this.#feeds) {
      const spec = FEEDS[id];
      feeds[id] = {
        version: f.version,
        fetchedAt: f.fetchedAt,
        zones: Object.keys(f.zones).length,
        notBefore: f.fetchedAt + spec.minGapMs,
        latestBy: f.fetchedAt + spec.maxGapMs,
        ...this.#statusOf(id),
      };
    }
    const tickMs = this.opts.tickMs ?? 5 * 60_000;
    const paused = this.#pausedUntil > now ? this.#pausedUntil : null;
    return {
      now,
      feeds,
      spentToday: Math.round(this.spentToday()),
      dailyLimit: DAILY_LIMIT,
      budgets: Object.fromEntries(FEED_IDS.map((id) => [id, FEEDS[id].dailyCap])),
      lastCheckAt: this.#lastTickAt,
      nextCheckAt: paused ?? (this.#lastTickAt ?? now) + tickMs,
      pausedUntil: paused,
      limitedAt: this.#limitedAt,
      lastError: this.lastError,
      events: [...this.#events].reverse(),
    };
  }

  #statusOf(id: FeedId): FeedStatus {
    let s = this.#status.get(id);
    if (!s) this.#status.set(id, (s = { lastCheckAt: null, lastCheck: null, lastError: null }));
    return s;
  }

  #note(id: FeedId, outcome: CheckOutcome, error: string | null = null) {
    const s = this.#statusOf(id);
    s.lastCheckAt = this.#now();
    s.lastCheck = outcome;
    s.lastError = error;
  }

  #event(level: FeedEvent['level'], text: string, feed?: FeedId) {
    this.#events.push({ at: this.#now(), level, text, ...(feed ? { feed } : {}) });
    if (this.#events.length > MAX_EVENTS) this.#events.splice(0, this.#events.length - MAX_EVENTS);
    this.#log(`Forecasts: ${feed ? `${feed}: ` : ''}${text}`);
  }

  feed(id: FeedId): FeedData | undefined {
    return this.#feeds.get(id);
  }

  /** The feed as gzipped JSON, ready to send. */
  gzipped(id: FeedId): Buffer | undefined {
    return this.#gz.get(id);
  }

  /** Every model for a zone from the shared copy, or null when it isn't held yet. */
  zone(zoneId: string): {
    models: ModelForecast[];
    horizon: { am?: ModelForecast; pm?: ModelForecast };
  } | null {
    const met = this.#feeds.get('met')?.zones[zoneId];
    if (!met) return null;
    const ecmwf = this.#feeds.get('ecmwf')?.zones[zoneId] ?? [];
    const harmonie = this.#feeds.get('harmonie')?.zones[zoneId] ?? [];
    const h = this.#feeds.get('horizon')?.zones;
    return {
      models: [...met, ...ecmwf, ...harmonie],
      horizon: { am: h?.[`${zoneId}|am`]?.[0], pm: h?.[`${zoneId}|pm`]?.[0] },
    };
  }

  /** Open-Meteo call-equivalents spent in the last 24 hours. */
  spentToday(): number {
    const since = this.#now() - 24 * HOUR;
    this.#spend = this.#spend.filter((s) => s.at > since);
    return this.#spend.reduce((a, s) => a + s.weight, 0);
  }

  /** One pass: probe what's due, fetch what has a new run. Safe to call often. */
  async tick(): Promise<void> {
    if (this.#running) return;
    const now = this.#now();
    if (now < this.#pausedUntil) return;
    this.#running = true;
    this.#lastTickAt = now;
    let current: FeedId | undefined;
    try {
      const zones = await this.opts.zones();
      if (zones.length === 0) return;
      const probes = new Map<string, string | null>();
      for (const id of FEED_IDS) {
        current = id;
        const spec = FEEDS[id];
        const last = this.#feeds.get(id);
        const sites = spec.sites(zones, this.#now());
        const due = feedDue(spec, last, this.#now());
        if (due === 'no') {
          // A place added since: fetch just its zone now rather than wait for the next run.
          const missing = last ? sites.filter((s) => !(s.id in last.zones)) : [];
          if (missing.length) await this.#fetchFeed(id, spec, missing, last!.probe, last);
          continue;
        }
        if (!probes.has(spec.probeModel)) {
          probes.set(spec.probeModel, await this.#probe(spec.probeModel, zones[0]!));
        }
        const reading = probes.get(spec.probeModel) ?? null;
        // Same reading as the data we hold: no new run yet.
        if (due === 'probe' && reading !== null && reading === last?.probe) {
          this.#note(id, 'same-run');
          const missing = sites.filter((s) => !(s.id in last.zones));
          if (missing.length) await this.#fetchFeed(id, spec, missing, last.probe, last);
          continue;
        }
        const weight = estimateCallWeight({
          ...spec.request,
          points: sites.map((s) => s.forecastPoint),
        });
        if (this.spentToday() + weight > spec.dailyCap) {
          this.#note(id, 'over-budget');
          this.#event(
            'warn',
            `Skipped: ${Math.round(this.spentToday())} of today's allowance used, and this would cost ${Math.round(weight)}`,
            id,
          );
          continue;
        }
        await this.#fetchFeed(id, spec, sites, reading);
        this.#note(id, 'fetched');
      }
      current = undefined;
      this.lastError = null;
    } catch (e) {
      const message = (e as Error).message;
      this.lastError = message;
      if (current) this.#note(current, 'failed', message);
      if (e instanceof ForecastError && e.status === 429) {
        // Over a limit: the minute's clears quickly, the day's doesn't.
        const daily = isDailyLimit(message);
        this.#limitedAt = this.#now();
        this.#pausedUntil = this.#now() + (daily ? 60 : 10) * 60_000;
        this.#event(
          'error',
          `Open-Meteo refused: ${daily ? "the day's" : "the minute's"} limit reached. Trying again at ${hhmm(this.#pausedUntil)}`,
          current,
        );
      } else {
        this.#event('error', message, current);
      }
    } finally {
      this.#running = false;
      this.#saveState();
    }
  }

  async #probe(model: string, zone: Zone): Promise<string | null> {
    const req = probeRequest(model, zone.forecastPoint);
    this.#spent(estimateCallWeight(req));
    const res = await this.#fetch(buildForecastUrl(req));
    if (res.status === 429) {
      const said = limitReason(await res.text().catch(() => ''));
      throw new ForecastError(`Open-Meteo rate limit reached${said ? ` (${said})` : ''}`, 429);
    }
    if (!res.ok) return null;
    const [forecasts] = parseForecastResponse(await res.json(), req);
    const f = forecasts?.[0];
    return f ? JSON.stringify([f.time[0], f.surface]) : null;
  }

  /** Fetches these sites; with `into`, adds them to that data (new zones) and keeps its time. */
  async #fetchFeed(
    id: FeedId,
    spec: FeedSpec,
    sites: ForecastSite[],
    probe: string | null,
    into?: FeedData,
  ) {
    const started = this.#now();
    this.#spent(estimateCallWeight({ ...spec.request, points: sites.map((s) => s.forecastPoint) }));
    const results = await fetchZoneForecasts(sites, {
      request: spec.request,
      maxAgeMs: 0,
      fetch: this.#fetch,
      now: this.#now,
    });
    const zones: Record<string, ModelForecast[]> = into ? { ...into.zones } : {};
    for (const r of results) zones[r.zoneId] = r.forecasts;
    const now = this.#now();
    const fetchedAt = into?.fetchedAt ?? now;
    const data: FeedData = { version: `${id}-${now.toString(36)}`, fetchedAt, probe, zones };
    this.#feeds.set(id, data);
    const gz = gzipSync(JSON.stringify(data));
    this.#gz.set(id, gz);
    const file = join(this.opts.dir, `${id}.json.gz`);
    writeFileSync(`${file}.tmp`, gz);
    renameSync(`${file}.tmp`, file);
    this.#event(
      'info',
      `${into ? 'Added new places: ' : 'Fetched: '}${sites.length} points in ${Math.round((now - started) / 1000)} s, ${Math.round(gz.length / 1024)} KB`,
      id,
    );
  }

  #spent(weight: number) {
    this.#spend.push({ at: this.#now(), weight });
  }

  #load() {
    for (const id of FEED_IDS) {
      try {
        const gz = readFileSync(join(this.opts.dir, `${id}.json.gz`));
        this.#feeds.set(id, JSON.parse(gunzipSync(gz).toString('utf8')) as FeedData);
        this.#gz.set(id, gz);
      } catch {
        // Not fetched yet.
      }
    }
    try {
      const s = JSON.parse(readFileSync(join(this.opts.dir, 'state.json'), 'utf8')) as {
        spend?: Spend[];
        pausedUntil?: number;
        status?: Partial<Record<FeedId, FeedStatus>>;
        events?: FeedEvent[];
        limitedAt?: number | null;
        lastTickAt?: number | null;
      };
      this.#spend = s.spend ?? [];
      this.#pausedUntil = s.pausedUntil ?? 0;
      for (const [id, st] of Object.entries(s.status ?? {})) this.#status.set(id as FeedId, st);
      this.#events = s.events ?? [];
      this.#limitedAt = s.limitedAt ?? null;
      this.#lastTickAt = s.lastTickAt ?? null;
    } catch {
      // A fresh start.
    }
  }

  #saveState() {
    try {
      this.spentToday();
      const file = join(this.opts.dir, 'state.json');
      writeFileSync(
        `${file}.tmp`,
        JSON.stringify({
          spend: this.#spend,
          pausedUntil: this.#pausedUntil,
          status: Object.fromEntries(this.#status),
          events: this.#events,
          limitedAt: this.#limitedAt,
          lastTickAt: this.#lastTickAt,
        }),
      );
      renameSync(`${file}.tmp`, file);
    } catch {
      // Only bookkeeping.
    }
  }
}

/** "14:05", London time, for messages. */
function hhmm(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  });
}
