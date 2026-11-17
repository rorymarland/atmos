/**
 * Fetches zone forecasts and scores every hill for every condition, then plans the trip
 * to each and combines the conditions you've ticked into one photo score.
 *
 * Three layers, so cheap changes stay cheap: evaluation (forecasts, day) is the costly
 * one; trips (start point, timings) and scoring (ticked conditions, limits) sit on top.
 */
import {
  distanceMiles,
  estimateDrive,
  estimateSummitWalk,
  evaluateTarget,
  hillIsOnList,
  planTrip,
  profileAt,
  saturatedLayers,
  tripProblem,
  type Hill,
  type HillRoute,
  PACE_FACTOR,
  viewLineLatitude,
  type Layer,
  type ModelForecast,
  type ProfileConfig,
  type TargetResult,
  type TripPlan,
  type TripProblem,
  type Verdict,
  type Zone,
} from '@atmos/engine';
import {
  fetchEnsemble,
  HARMONIE_REQUEST,
  HORIZON_REQUEST,
  type Ensemble,
  type ForecastSite,
  fetchOvation,
  type Ovation,
  fetchKpForecast,
  fetchZoneForecasts,
  ForecastError,
  kpAt,
  type KpBin,
} from '@atmos/data-client';
import { forecastCache, newestFetch } from './cache';
import { findRoute, savedRoute } from './routes';
import { settings } from './settings.svelte';
import { loadStaticData, type StaticData } from './static-data';
import {
  periodFitsMoment,
  periodWindow,
  skyPositions,
  sunTimes,
  targetTime,
  type LightWindow,
  type Period,
  type SunTimes,
} from './sun';
import { londonMidnight } from './time';

const MINUTE = 60_000;
/** After a failed route lookup, wait this long before trying that hill again. */
const ROUTE_RETRY_MS = 10 * 60_000;
/**
 * Photo score weights for the best, second and third conditions. A hill with one perfect
 * condition scores 81; three perfect conditions make 100.
 */
const RANK_WEIGHTS = [1, 0.15, 0.08];
const RANK_TOTAL = RANK_WEIGHTS.reduce((a, b) => a + b, 0);

export interface Trip {
  plan: TripPlan;
  driveMinutes: number;
  roadMiles: number;
  walkMinutes: number;
  /** Where the walk time came from: a worked-out route, a rough estimate, or a stroll. */
  walkSource: 'route' | 'estimate';
  /** e.g. "golden hour". */
  targetLabel: string;
  /** Why it doesn't fit the limits, or null. */
  problem: TripProblem | null;
}

/** One condition in one part of the day, for one hill. */
export interface ConditionResult {
  profileId: string;
  period: Period;
  result: TargetResult;
  window: LightWindow;
  /** Scored at the summit, or shared with the rest of the zone from the valley forecast. */
  scope: 'summit' | 'valley';
}

export interface ConditionTrip extends ConditionResult {
  trip: Trip | null;
}

/** A hill's walking route: found, none within reach, still working, or unreachable. */
export type RouteState = HillRoute | null | 'loading' | 'failed';

export interface HillResult {
  hill: Hill;
  zone: Zone;
  sun: SunTimes;
  /** Undefined until it's been asked for. */
  route: RouteState | undefined;
  /** Every condition and part of the day, best score first. */
  conditions: ConditionTrip[];
  /** The ticked ones that fit the limits, best first. */
  counted: ConditionTrip[];
  /** 0 to 1 photo score from the counted conditions, or null with no data. */
  score: number | null;
  verdict: Verdict;
  /** The headline condition: what to go for. */
  best: ConditionTrip | null;
  /** Straight-line miles from the start point. */
  miles: number | null;
  /** Drive estimate in minutes, if a start point is set. */
  driveMinutes: number | null;
  /** Estimated road miles, if a start point is set. */
  roadMiles: number | null;
  /** Worth going only with an earlier start: the best condition that needs one. */
  needsEarlier: ConditionTrip | null;
  /** Picked from the search (e.g. a Tump): scored, but not on the map or in the list. */
  searchOnly: boolean;
}

export interface Ranking {
  /** Hills worth going to (Go or Maybe), in the chosen order. */
  go: HillResult[];
  /** Worth going only with an earlier start. */
  tooEarly: HillResult[];
  /** The rest (No or no data), in the chosen order. */
  rest: HillResult[];
  hillsByNumber: Map<number, HillResult>;
  /** Hills scored. */
  total: number;
  windowPassed: boolean;
}

const ORDER: Record<Verdict, number> = { go: 0, maybe: 1, no: 2, nodata: 3 };
const worthGoing = (v: Verdict) => v === 'go' || v === 'maybe';

/** UTC instant of a local "HH:MM" on the outing's day. */
function localTime(dayStart: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return dayStart + ((h ?? 0) * 60 + (m ?? 0)) * MINUTE;
}

const londonHourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hourCycle: 'h23',
});
const londonHour = (t: number) => Number(londonHourFormat.format(t));

/** About 60 km out: far enough to be the horizon's cloud, close enough to matter. */
const HORIZON_KM = 60;

/**
 * Points towards sunrise and sunset from a zone. Bearings are taken two days ahead and
 * rounded to 5°, so they serve the whole five days and the cache stays put.
 */
function horizonSites(zone: Zone, now: number): ForecastSite[] {
  const p = zone.forecastPoint;
  const t = sunTimes(p.lat, p.lon, 2, now);
  const out: ForecastSite[] = [];
  for (const [side, at, body] of [
    ['am', t.sunrise, 'sun'],
    ['pm', t.sunset, 'sun'],
  ] as const) {
    if (!at) continue;
    const az = Math.round(skyPositions(at, p.lat, p.lon)[body].azDeg / 5) * 5;
    out.push({
      id: `${zone.id}|${side}`,
      forecastPoint: destination(p.lat, p.lon, az, HORIZON_KM),
    });
  }
  return out;
}

function destination(lat: number, lon: number, bearingDeg: number, km: number) {
  const R = 6371;
  const b = (bearingDeg * Math.PI) / 180;
  const d = km / R;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(b));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return {
    lat: Math.round(((φ2 * 180) / Math.PI) * 1e4) / 1e4,
    lon: Math.round(((λ2 * 180) / Math.PI) * 1e4) / 1e4,
  };
}

interface Evaluated {
  hill: Hill;
  zone: Zone;
  sun: SunTimes;
  valleyM: number;
  conditions: ConditionResult[];
  searchOnly: boolean;
}

class Conditions {
  data = $state.raw<StaticData | null>(null);
  forecasts = $state.raw<Map<string, ModelForecast[]>>(new Map());
  kp = $state.raw<KpBin[]>([]);
  fetchedAt = $state<number | null>(null);
  loading = $state(false);
  progress = $state<{ done: number; total: number } | null>(null);
  error = $state<string | null>(null);
  now = $state(Date.now());
  /** KNMI HARMONIE per zone: the third model, for about the first two and a half days. */
  harmonie = $state.raw<Map<string, ModelForecast[]>>(new Map());
  /** Cloud towards the sunrise (am) and sunset (pm) for each zone. */
  horizons = $state.raw<Map<string, { am?: ModelForecast; pm?: ModelForecast }>>(new Map());
  /** Ensembles for hills that have been opened, by hill number. */
  ensembles = $state.raw<Map<number, Ensemble | 'loading' | 'failed'>>(new Map());

  /** Fetches the ensemble for one place, once per page load. */
  async loadEnsemble(hillNumber: number, lat: number, lon: number) {
    if (this.ensembles.has(hillNumber)) return;
    this.ensembles = new Map(this.ensembles).set(hillNumber, 'loading');
    try {
      const e = await fetchEnsemble(lat, lon);
      this.ensembles = new Map(this.ensembles).set(hillNumber, e);
    } catch (err) {
      console.warn('Ensemble:', err);
      this.ensembles = new Map(this.ensembles).set(hillNumber, 'failed');
    }
  }

  /** Walking routes by hill number. */
  routes = $state.raw<Map<number, RouteState>>(new Map());
  #routeQueue: { hill: Hill }[] = [];
  #routing = false;
  /** Hills being looked up in the saved routes, so a second request doesn't queue twice. */
  #checking = new Set<number>();
  /**
   * When each failed lookup failed. Results refresh whenever a route arrives, which asks
   * for routes again: without this pause a service outage would become a retry loop.
   */
  #failedAt = new Map<number, number>();

  /**
   * Works out a hill's route: from the saved copy if there is one, otherwise from
   * OpenStreetMap and the terrain. One at a time, a second apart, to be kind to the
   * Overpass servers. `first` jumps the queue (the hill you've just opened).
   */
  async requestRoute(hill: Hill, first = false) {
    const known = this.routes.get(hill.number);
    if (known !== undefined && known !== 'failed') return;
    if (
      known === 'failed' &&
      Date.now() - (this.#failedAt.get(hill.number) ?? 0) < ROUTE_RETRY_MS
    ) {
      return;
    }
    if (this.#routeQueue.some((q) => q.hill.number === hill.number)) {
      if (first) {
        this.#routeQueue = [
          { hill },
          ...this.#routeQueue.filter((q) => q.hill.number !== hill.number),
        ];
      }
      return;
    }
    if (this.#checking.has(hill.number)) return;
    this.#checking.add(hill.number);
    let saved: HillRoute | null | undefined;
    try {
      saved = await savedRoute(hill.number);
    } finally {
      this.#checking.delete(hill.number);
    }
    if (saved !== undefined) {
      this.routes = new Map(this.routes).set(hill.number, saved);
      return;
    }
    if (first) this.#routeQueue.unshift({ hill });
    else this.#routeQueue.push({ hill });
    this.routes = new Map(this.routes).set(hill.number, 'loading');
    void this.#drainRoutes();
  }

  async #drainRoutes() {
    if (this.#routing) return;
    this.#routing = true;
    try {
      for (let next = this.#routeQueue.shift(); next; next = this.#routeQueue.shift()) {
        let result: RouteState;
        try {
          result = await findRoute(next.hill);
        } catch (e) {
          console.warn('Route:', e);
          result = 'failed';
          this.#failedAt.set(next.hill.number, Date.now());
        }
        this.routes = new Map(this.routes).set(next.hill.number, result);
        if (this.#routeQueue.length) await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      this.#routing = false;
    }
  }

  /** OVATION aurora nowcast, fetched only while the aurora is ticked for tonight. */
  ovation = $state.raw<Ovation | null>(null);
  #ovationAt = 0;

  /** Whether the aurora layers belong on the map: aurora, night and Ovation all ticked. */
  get auroraShown(): boolean {
    return settings.ovation && this.ticked.has('aurora') && settings.periods.includes('night');
  }

  /**
   * The chosen night's strongest forecast Kp, and the rule-of-thumb latitude it should
   * reach on the northern horizon. Null beyond the Kp forecast (about three days).
   */
  auroraOutlook = $derived.by(() => {
    const bins = this.kp;
    if (bins.length === 0) return null;
    const dayStart = londonMidnight(settings.dayOffset, this.now);
    // Roughly dusk to dawn in a UK winter: 16:00 to 07:00 the next morning.
    const from = dayStart + 16 * 3_600_000;
    const to = dayStart + 31 * 3_600_000;
    const night = bins.filter((b) => b.time + 3 * 3_600_000 > from && b.time < to);
    if (night.length === 0) return null;
    const peak = night.reduce((a, b) => (b.kp > a.kp ? b : a));
    return { kp: peak.kp, at: peak.time, lat: viewLineLatitude(peak.kp) };
  });

  /** Fetches the OVATION nowcast when it's wanted and more than ten minutes old. */
  async refreshAurora(force = false) {
    if (!this.auroraShown || settings.dayOffset !== 0) return;
    if (!force && Date.now() - this.#ovationAt < 10 * 60_000) return;
    this.#ovationAt = Date.now();
    try {
      this.ovation = await fetchOvation();
    } catch (e) {
      console.warn('Aurora nowcast:', e);
    }
  }

  /** A hill picked from the search that isn't on the chosen lists, scored on its own. */
  extra = $state.raw<Hill | null>(null);
  #refreshAgain = false;

  async init() {
    if (this.data) return;
    try {
      this.data = await loadStaticData();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Condition ids and their config, in config order. */
  profiles = $derived.by((): [string, ProfileConfig][] =>
    this.data ? Object.entries(this.data.config.profiles) : [],
  );

  /** The ticked conditions. */
  ticked = $derived.by(() => {
    const ids = this.profiles.map(([id]) => id);
    if (settings.conditions) return new Set(settings.conditions.filter((id) => ids.includes(id)));
    return new Set(this.profiles.filter(([, p]) => p.photo).map(([id]) => id));
  });

  /** Hills passing the list and height filters. */
  listedHills = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const lists = data.lists.filter(
      (l) => settings.lists.length === 0 || settings.lists.includes(l.id),
    );
    const countries = new Set(settings.countries);
    // Hills on a border count for both countries. Data from before countries were
    // recorded falls back to the zone's country.
    const inCountry = (h: Hill) =>
      countries.size === 0 ||
      (h.nations.length
        ? h.nations.some((n) => countries.has(n))
        : countries.has(data.zones[h.zone]!.nation));
    return data.hills.filter(
      (h) =>
        h.zone >= 0 &&
        h.metres >= settings.minHeight &&
        inCountry(h) &&
        lists.some((l) => hillIsOnList(h, l)),
    );
  });

  /** Zones with a listed hill within the drive limit: the only ones fetched. */
  neededZones = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const extraZone = this.extra?.zone ?? -1;
    const start = settings.start;
    const maxMiles = start ? settings.maxDriveMiles : null;
    const ids = new Set(
      this.listedHills
        .filter((h) => maxMiles === null || estimateDrive(start!, h).roadMiles <= maxMiles)
        .map((h) => h.zone),
    );
    if (extraZone >= 0) ids.add(extraZone);
    return data.zones.filter((_, i) => ids.has(i));
  });

  async refresh(force = false) {
    const zones = this.neededZones;
    if (zones.length === 0) return;
    if (this.loading) {
      // The zones changed mid-fetch: go again for any new ones when this one finishes.
      this.#refreshAgain = true;
      return;
    }
    this.loading = true;
    this.error = null;
    // The Kp forecast is only for the aurora: a failure there mustn't stop the rest.
    const kp = fetchKpForecast()
      .then((bins) => (this.kp = bins))
      .catch((e) => console.warn('Kp forecast:', e));
    try {
      const results = await fetchZoneForecasts(zones, {
        cache: forecastCache,
        maxAgeMs: force ? 0 : 60 * 60 * 1000,
        onProgress: (done, total) => (this.progress = total > 0 ? { done, total } : null),
      });
      const next = new Map(this.forecasts);
      for (const r of results) next.set(r.zoneId, r.forecasts);
      this.forecasts = next;
      this.fetchedAt = newestFetch(results);
      this.now = Date.now();
      // The extras refine what's already on screen; failures there only cost the extra.
      void this.#refreshExtras(zones, force);
    } catch (e) {
      this.error =
        e instanceof ForecastError
          ? e.message
          : `Couldn't reach the forecast service. ${navigator.onLine ? '' : 'You appear to be offline. '}Showing any saved forecasts.`;
    } finally {
      this.loading = false;
      this.progress = null;
      await kp;
      if (this.#refreshAgain) {
        this.#refreshAgain = false;
        void this.refresh();
      }
    }
  }

  /**
   * The third model and the horizon points, after the main forecast is on screen. The
   * rate limiter in the data client spreads them past the minute's request budget.
   */
  async #refreshExtras(zones: Zone[], force: boolean) {
    const maxAgeMs = force ? 0 : 60 * 60 * 1000;
    try {
      const h = await fetchZoneForecasts(zones, {
        request: HARMONIE_REQUEST,
        cache: forecastCache,
        maxAgeMs,
      });
      const next = new Map(this.harmonie);
      for (const r of h) next.set(r.zoneId, r.forecasts);
      this.harmonie = next;
    } catch (e) {
      console.warn('HARMONIE:', e);
    }
    try {
      const sites: ForecastSite[] = zones.flatMap((z) => horizonSites(z, this.now));
      const res = await fetchZoneForecasts(sites, {
        request: HORIZON_REQUEST,
        cache: forecastCache,
        maxAgeMs,
      });
      const next = new Map(this.horizons);
      for (const r of res) {
        const [zoneId, side] = r.zoneId.split('|') as [string, 'am' | 'pm'];
        next.set(zoneId, { ...next.get(zoneId), [side]: r.forecasts[0] });
      }
      this.horizons = next;
    } catch (e) {
      console.warn('Horizon:', e);
    }
  }

  /** Every model for a zone: the main two plus HARMONIE when it's arrived. */
  modelsFor(zoneId: string): ModelForecast[] {
    return [...(this.forecasts.get(zoneId) ?? []), ...(this.harmonie.get(zoneId) ?? [])];
  }

  /** The horizon lookup the engine uses for a zone. */
  horizonFor(zoneId: string): (time: number) => { low: number | null; mid: number | null } | null {
    const h = this.horizons.get(zoneId);
    if (!h) return () => null;
    return (time) => {
      // Morning conditions look towards sunrise, the rest towards sunset.
      const f = londonHour(time) < 12 ? h.am : h.pm;
      if (!f) return null;
      const i = f.time.indexOf(Math.floor(time / 3_600_000) * 3_600_000);
      if (i < 0) return null;
      return {
        low: f.surface.cloudCoverLow?.[i] ?? null,
        mid: f.surface.cloudCoverMid?.[i] ?? null,
      };
    };
  }

  /** Layer 1: every condition for every listed hill with a forecast. The costly part. */
  evaluated = $derived.by((): Evaluated[] => {
    const data = this.data;
    if (!data) return [];
    const dayStart = londonMidnight(settings.dayOffset, this.now);
    const bins = this.kp;
    const opts = {
      now: this.now,
      extras: { kp: (t: number) => kpAt(bins, t) },
    };
    const out: Evaluated[] = [];
    const zoneCache = new Map<
      number,
      { sun: SunTimes; nextSun: SunTimes; valley: ConditionResult[]; valleyM: number }
    >();

    const listed = this.listedHills;
    const extra = this.extra;
    const addExtra = extra !== null && !listed.some((h) => h.number === extra.number);
    const hills = addExtra ? [...listed, extra] : listed;
    for (const hill of hills) {
      const zone = data.zones[hill.zone]!;
      const forecasts = this.modelsFor(zone.id);
      if (forecasts.length === 0) continue;
      const zoneOpts = { ...opts, extras: { ...opts.extras, horizon: this.horizonFor(zone.id) } };
      const p = zone.forecastPoint;

      let z = zoneCache.get(hill.zone);
      if (!z) {
        const sun = sunTimes(p.lat, p.lon, settings.dayOffset, this.now);
        const nextSun = sunTimes(p.lat, p.lon, settings.dayOffset + 1, this.now);
        const valleyM = forecasts[0]!.groundElevationM;
        const valley: ConditionResult[] = [];
        for (const [id, cfg] of this.profiles) {
          if (cfg.scope !== 'valley') continue;
          for (const period of cfg.periods) {
            const window = periodWindow(period, id, sun, nextSun, dayStart);
            const target = {
              id: zone.id,
              name: zone.name,
              altitudeM: valleyM,
              lat: p.lat,
              lon: p.lon,
            };
            const result = evaluateTarget(forecasts, window, target, id, data.config, zoneOpts);
            valley.push({ profileId: id, period, result, window, scope: 'valley' });
          }
        }
        z = { sun, nextSun, valley, valleyM };
        zoneCache.set(hill.zone, z);
      }

      const summit: ConditionResult[] = [];
      for (const [id, cfg] of this.profiles) {
        if (cfg.scope !== 'summit') continue;
        for (const period of cfg.periods) {
          const window = periodWindow(period, id, z.sun, z.nextSun, dayStart);
          const target = {
            id: String(hill.number),
            name: hill.name,
            altitudeM: hill.metres,
            lat: hill.lat,
            lon: hill.lon,
          };
          const result = evaluateTarget(forecasts, window, target, id, data.config, zoneOpts);
          summit.push({ profileId: id, period, result, window, scope: 'summit' });
        }
      }
      out.push({
        hill,
        zone,
        sun: z.sun,
        valleyM: z.valleyM,
        conditions: [...summit, ...z.valley],
        searchOnly: addExtra && hill === extra,
      });
    }
    return out;
  });

  /** Layer 2: a trip plan for each condition. */
  planned = $derived.by(() => {
    const start = settings.start;
    const dayStart = londonMidnight(settings.dayOffset, this.now);
    const limits = {
      earliestWake: settings.earliestUp ? localTime(dayStart, settings.earliestUp) : null,
      maxDriveMinutes: null,
      now: this.now,
    };
    const routes = this.routes;
    return this.evaluated.map((e) => {
      const route = routes.get(e.hill.number);
      const found = route && typeof route === 'object' ? route : null;
      // With a route, drive to where the walk starts; otherwise towards the summit.
      const drive = start ? estimateDrive(start, found ? found.start : e.hill) : null;
      const summitWalk = found
        ? Math.round(found.minutes * PACE_FACTOR[settings.pace])
        : estimateSummitWalk(e.hill.metres, e.valleyM, settings.pace).minutes;
      const conditions: ConditionTrip[] = e.conditions.map((c) => {
        if (!drive) return { ...c, trip: null };
        const ref = c.result.byModel.find((m) => m.model === c.result.referenceModel);
        const target = targetTime(
          c.profileId,
          c.period,
          settings.moment,
          e.sun,
          c.window,
          ref?.keyHour?.time ?? null,
        );
        // Opening a hill means going to its top: every condition's trip includes the walk up.
        const walkMinutes = summitWalk;
        const walkSource = found ? 'route' : 'estimate';
        const plan = planTrip({
          target: target.at,
          driveMinutes: drive.minutes,
          walkMinutes,
          earlyMinutes: settings.earlyMinutes,
          readyMinutes: settings.readyMinutes,
        });
        return {
          ...c,
          trip: {
            plan,
            driveMinutes: drive.minutes,
            roadMiles: drive.roadMiles,
            walkMinutes,
            walkSource,
            targetLabel: target.label,
            problem: tripProblem(plan, drive.minutes, limits),
          },
        };
      });
      conditions.sort((a, b) => (b.result.score ?? -1) - (a.result.score ?? -1));
      return {
        ...e,
        conditions,
        route,
        miles: start ? distanceMiles(start, e.hill) : null,
        driveMinutes: drive?.minutes ?? null,
        roadMiles: drive?.roadMiles ?? null,
      };
    });
  });

  /** Layer 3: the photo score from the ticked conditions, and the ordering. */
  ranking: Ranking = $derived.by(() => {
    const data = this.data;
    const empty: Ranking = {
      go: [],
      tooEarly: [],
      rest: [],
      hillsByNumber: new Map(),
      total: 0,
      windowPassed: false,
    };
    if (!data) return empty;
    const ticked = this.ticked;
    const periods = new Set(settings.periods);
    const maxMiles = settings.start ? settings.maxDriveMiles : null;
    // Conditions arrive best first, so the top three are the first three scored.
    const photoScore = (list: ConditionTrip[]): number | null => {
      const scores = list
        .filter((c) => c.result.score !== null && c.result.verdict !== 'nodata')
        .map((c) => c.result.score!)
        .slice(0, RANK_WEIGHTS.length);
      if (scores.length === 0) return null;
      return scores.reduce((sum, s, i) => sum + s * RANK_WEIGHTS[i]!, 0) / RANK_TOTAL;
    };

    const hills: HillResult[] = [];
    let windowPassed = false;
    const searched: HillResult[] = [];
    for (const h of this.planned) {
      const tooFar = maxMiles !== null && h.roadMiles !== null && h.roadMiles > maxMiles;
      if (tooFar && !h.searchOnly) continue;
      const candidates = h.conditions.filter(
        (c) =>
          ticked.has(c.profileId) &&
          periods.has(c.period) &&
          periodFitsMoment(c.period, settings.moment),
      );
      if (candidates.some((c) => c.window.end < this.now)) windowPassed = true;
      const counted = candidates.filter(
        (c) => !c.trip?.problem && c.window.end >= this.now - 3_600_000,
      );
      const score = photoScore(counted);
      const best = counted.find((c) => c.result.verdict !== 'nodata') ?? null;
      // The verdict is the best condition's: one great reason to go is enough.
      const verdict: Verdict = best ? best.result.verdict : 'nodata';
      const early = candidates.find((c) => c.trip?.problem && worthGoing(c.result.verdict)) ?? null;
      const needsEarlier =
        early && !worthGoing(verdict) && (early.result.score ?? 0) > (best?.result.score ?? 0)
          ? early
          : null;
      const result = { ...h, counted, score, verdict, best, needsEarlier };
      (h.searchOnly ? searched : hills).push(result);
    }

    const byScore = (a: HillResult, b: HillResult) =>
      ORDER[a.verdict] - ORDER[b.verdict] ||
      (b.score ?? -1) - (a.score ?? -1) ||
      (a.driveMinutes ?? 0) - (b.driveMinutes ?? 0);
    const sorters: Record<typeof settings.sort, (a: HillResult, b: HillResult) => number> = {
      best: byScore,
      worst: (a, b) => -byScore(a, b),
      nearest: (a, b) =>
        (a.driveMinutes ?? a.miles ?? 0) - (b.driveMinutes ?? b.miles ?? 0) || byScore(a, b),
      highest: (a, b) => b.hill.metres - a.hill.metres,
    };
    hills.sort(sorters[settings.sort] ?? byScore);

    return {
      go: hills.filter((h) => worthGoing(h.verdict)),
      tooEarly: hills
        .filter((h) => h.needsEarlier)
        .sort(
          (a, b) =>
            (b.needsEarlier!.trip!.plan.wakeAt ?? 0) - (a.needsEarlier!.trip!.plan.wakeAt ?? 0),
        ),
      rest: hills.filter((h) => !worthGoing(h.verdict) && !h.needsEarlier),
      hillsByNumber: new Map([...hills, ...searched].map((h) => [h.hill.number, h])),
      total: hills.length,
      windowPassed,
    };
  });

  forecastsFor(zoneId: string): ModelForecast[] {
    return this.modelsFor(zoneId);
  }

  label(profileId: string): string {
    return this.data?.config.profiles[profileId]?.label ?? profileId;
  }

  short(profileId: string): string {
    return this.data?.config.profiles[profileId]?.short ?? profileId;
  }
}

export const conditions = new Conditions();

export interface KeyHourProfile {
  forecast: ModelForecast;
  index: number;
  layers: Layer[];
}

/** The reference model's key hour for a result, with its cloud layers. */
export function keyHourProfile(
  result: TargetResult,
  forecasts: ModelForecast[],
): KeyHourProfile | null {
  const window = result.byModel.find((m) => m.model === result.referenceModel);
  const forecast = forecasts.find((f) => f.model === result.referenceModel);
  if (!window?.keyHour || !forecast) return null;
  const index = forecast.time.indexOf(window.keyHour.time);
  if (index < 0) return null;
  const layers = saturatedLayers(profileAt(forecast, index).relativeHumidity, 95);
  return { forecast, index, layers };
}
