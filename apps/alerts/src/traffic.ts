/**
 * Air traffic over the UK, sampled from the OpenSky Network's free live API (no account),
 * for plane trails: how many aircraft are at cruise height in each part of the country at
 * each hour of the day. Built up over weeks into a picture of when and where they fly.
 *
 * One snapshot of the UK box every 12 minutes keeps inside OpenSky's anonymous allowance
 * (400 credits a day; a box this size costs a few credits). Only aircraft at 25,000 ft or
 * above count: lower ones rarely leave trails.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  READY_DAYS,
  READY_SAMPLES_PER_HOUR,
  trafficThresholds,
  type TrafficGrid,
} from '../../web/src/lib/traffic-grid';

const HOUR = 3_600_000;

/** The UK and Northern Ireland, with a margin for trails seen from the coast. */
export const BOX = { latMin: 49.5, latMax: 61, lonMin: -9, lonMax: 2.5 } as const;
export const CELL_DEG = 0.5;
export const ROWS = Math.round((BOX.latMax - BOX.latMin) / CELL_DEG);
export const COLS = Math.round((BOX.lonMax - BOX.lonMin) / CELL_DEG);
/** 25,000 ft. */
export const MIN_ALTITUDE_M = 7_620;
export const SAMPLE_EVERY_MS = 12 * 60_000;

export const OPENSKY_URL = `https://opensky-network.org/api/states/all?lamin=${BOX.latMin}&lomin=${BOX.lonMin}&lamax=${BOX.latMax}&lomax=${BOX.lonMax}`;

export interface TrafficState {
  version: 1;
  /** When sampling began. */
  since: number | null;
  /** Snapshots taken in each UTC hour of the day. */
  samples: number[];
  /** Aircraft counted, by UTC hour then cell (row-major from the south-west). */
  counts: number[][];
  lastSampleAt: number | null;
  /** Aircraft at cruise height in the last snapshot. */
  lastCount: number | null;
  lastError: string | null;
  /** OpenSky asked us to wait until then. */
  retryAt: number | null;
  /** Credits left today, as OpenSky last said. */
  creditsLeft: number | null;
}

export function emptyTraffic(): TrafficState {
  return {
    version: 1,
    since: null,
    samples: Array(24).fill(0),
    counts: Array.from({ length: 24 }, () => Array(ROWS * COLS).fill(0)),
    lastSampleAt: null,
    lastCount: null,
    lastError: null,
    retryAt: null,
    creditsLeft: null,
  };
}

/** The cell a position falls in, or -1 outside the box. */
export function cellOf(lat: number, lon: number): number {
  const r = Math.floor((lat - BOX.latMin) / CELL_DEG);
  const c = Math.floor((lon - BOX.lonMin) / CELL_DEG);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return -1;
  return r * COLS + c;
}

/** Positions of aircraft at cruise height from an OpenSky /states/all reply. */
export function cruising(body: unknown): { lat: number; lon: number }[] {
  const states = (body as { states?: unknown[][] | null }).states ?? [];
  const out: { lat: number; lon: number }[] = [];
  for (const s of states) {
    const lon = s[5];
    const lat = s[6];
    const baro = s[7];
    const onGround = s[8];
    const geo = s[13];
    const alt = typeof baro === 'number' ? baro : typeof geo === 'number' ? geo : null;
    if (typeof lat !== 'number' || typeof lon !== 'number' || onGround === true) continue;
    if (alt === null || alt < MIN_ALTITUDE_M) continue;
    out.push({ lat, lon });
  }
  return out;
}

export interface SamplerOptions {
  dir: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (msg: string) => void;
}

export class TrafficSampler {
  state: TrafficState;
  readonly #file: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #log: (msg: string) => void;
  #running = false;

  constructor(readonly opts: SamplerOptions) {
    mkdirSync(opts.dir, { recursive: true });
    this.#file = join(opts.dir, 'traffic.json');
    this.#fetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.#now = opts.now ?? Date.now;
    this.#log = opts.log ?? (() => undefined);
    this.state = this.#load();
  }

  /** One snapshot, unless OpenSky asked us to wait. Safe to call on a timer. */
  async sample(): Promise<void> {
    const now = this.#now();
    if (this.#running || (this.state.retryAt && now < this.state.retryAt)) return;
    this.#running = true;
    const s = this.state;
    try {
      const res = await this.#fetch(OPENSKY_URL, { headers: { accept: 'application/json' } });
      const left = Number(res.headers.get('x-rate-limit-remaining'));
      if (Number.isFinite(left) && res.headers.has('x-rate-limit-remaining')) s.creditsLeft = left;
      if (res.status === 429) {
        const wait = Number(res.headers.get('x-rate-limit-retry-after-seconds'));
        s.retryAt = now + (Number.isFinite(wait) && wait > 0 ? wait * 1000 : HOUR);
        s.lastError = `OpenSky's daily allowance is used up: waiting until ${new Date(s.retryAt).toISOString().slice(11, 16)} UTC`;
        this.#log(`Traffic: ${s.lastError}`);
        return;
      }
      if (!res.ok) throw new Error(`OpenSky answered ${res.status}`);
      const planes = cruising(await res.json());
      const hour = new Date(now).getUTCHours();
      const row = s.counts[hour]!;
      for (const p of planes) {
        const c = cellOf(p.lat, p.lon);
        if (c >= 0) row[c] = (row[c] ?? 0) + 1;
      }
      s.samples[hour] = (s.samples[hour] ?? 0) + 1;
      s.since ??= now;
      s.lastSampleAt = now;
      s.lastCount = planes.length;
      s.lastError = null;
      s.retryAt = null;
    } catch (e) {
      s.lastError = (e as Error).message;
      this.#log(`Traffic: ${s.lastError}`);
    } finally {
      this.#running = false;
      this.#save();
    }
  }

  /** For the check page: progress, and the average aircraft at cruise height by hour. */
  summary() {
    const s = this.state;
    const total = s.samples.reduce((a, b) => a + b, 0);
    const byHour = s.samples.map((n, h) =>
      n ? Math.round((s.counts[h]!.reduce((a, b) => a + b, 0) / n) * 10) / 10 : null,
    );
    return {
      since: s.since,
      days: s.since ? Math.round(((this.#now() - s.since) / (24 * HOUR)) * 10) / 10 : 0,
      samples: total,
      hoursCovered: s.samples.filter((n) => n > 0).length,
      lastSampleAt: s.lastSampleAt,
      lastCount: s.lastCount,
      lastError: s.lastError,
      retryAt: s.retryAt,
      creditsLeft: s.creditsLeft,
      nextAt: s.retryAt ?? (s.lastSampleAt ?? this.#now()) + SAMPLE_EVERY_MS,
      everyMinutes: SAMPLE_EVERY_MS / 60_000,
      /** Average aircraft above 25,000 ft over the box, by UTC hour. */
      byHour,
      /** Whether the trail risk uses it yet, and what it needs. */
      usedForTrails: s.since
        ? (this.#now() - s.since) / (24 * HOUR) >= READY_DAYS &&
          s.samples.every((n) => n >= READY_SAMPLES_PER_HOUR)
        : false,
      readyDays: READY_DAYS,
      ...this.#progress(),
    };
  }

  /**
   * How far off using traffic for trails is: UTC hours still short of samples, and a rough
   * date it'll start (three weeks from the first sample, or later if an hour is behind).
   */
  #progress(): { shortHours: number[]; readyAt: number | null } {
    const s = this.state;
    if (!s.since) return { shortHours: [], readyAt: null };
    const shortHours = s.samples.flatMap((n, h) => (n < READY_SAMPLES_PER_HOUR ? [h] : []));
    // Each hour gets about one sample every SAMPLE_EVERY_MS, so this many a day.
    const perHourPerDay = HOUR / SAMPLE_EVERY_MS;
    const behind = Math.max(0, ...s.samples.map((n) => READY_SAMPLES_PER_HOUR - n));
    const readyAt = Math.max(
      s.since + READY_DAYS * 24 * HOUR,
      this.#now() + Math.ceil(behind / perHourPerDay) * 24 * HOUR,
    );
    return { shortHours, readyAt };
  }

  /**
   * Average aircraft per snapshot by hour and cell, for the trail risk. `ready` once there
   * are three weeks of samples with every hour well covered; kept for a minute between asks.
   */
  grid(): TrafficGrid {
    const now = this.#now();
    if (this.#grid && now - this.#gridAt < 60_000) return this.#grid;
    const s = this.state;
    const perHour = s.counts.map((row, h) => {
      const n = s.samples[h] ?? 0;
      return row.map((c) => (n ? Math.round((c / n) * 100) / 100 : 0));
    });
    const days = s.since ? (now - s.since) / (24 * HOUR) : 0;
    const base = {
      latMin: BOX.latMin,
      lonMin: BOX.lonMin,
      cellDeg: CELL_DEG,
      rows: ROWS,
      cols: COLS,
      perHour,
    };
    this.#grid = {
      ...base,
      ready: days >= READY_DAYS && s.samples.every((n) => n >= READY_SAMPLES_PER_HOUR),
      days: Math.round(days * 10) / 10,
      thresholds: trafficThresholds(base),
    };
    this.#gridAt = now;
    return this.#grid;
  }
  #grid: TrafficGrid | null = null;
  #gridAt = 0;

  #load(): TrafficState {
    try {
      const s = JSON.parse(readFileSync(this.#file, 'utf8')) as TrafficState;
      if (s.version === 1 && s.counts.length === 24 && s.counts[0]?.length === ROWS * COLS)
        return s;
    } catch {
      // A fresh start.
    }
    return emptyTraffic();
  }

  #save() {
    try {
      writeFileSync(`${this.#file}.tmp`, JSON.stringify(this.state));
      renameSync(`${this.#file}.tmp`, this.#file);
    } catch (e) {
      this.#log(`Traffic: couldn't save (${(e as Error).message})`);
    }
  }
}
