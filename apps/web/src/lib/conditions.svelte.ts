/**
 * Fetches zone forecasts and scores every hill for every condition, then plans the trip
 * to each and combines the conditions you've ticked into one photo score.
 *
 * Three layers, so cheap changes stay cheap: evaluation (forecasts, day) is the costly
 * one; trips (start point, timings) and scoring (ticked conditions, limits) sit on top.
 */
import {
  distanceKm,
  distanceMiles,
  estimateDrive,
  estimateSummitWalk,
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
  type WaterBody,
  type Zone,
  CUSTOM_LIST,
  withPlaces,
} from '@atmos/engine';
import {
  fetchEnsemble,
  fetchMetOfficeEnsemble,
  HARMONIE_REQUEST,
  HORIZON_REQUEST,
  type Ensemble,
  type ForecastSite,
  fetchOvation,
  type Ovation,
  fetchKpForecast,
  fetchZoneForecasts,
  ForecastError,
  type KpBin,
} from '@atmos/data-client';
import { forecastCache, newestFetch } from './cache';
import { places } from './places.svelte';
import {
  createEvaluateMemo,
  evaluatePlaces,
  horizonLookup,
  horizonSites,
  type ConditionResult,
  type EvaluatedPlace,
} from './evaluate-places';
import { findRoute, savedRoute } from './routes';
import { settings } from './settings.svelte';
import { loadStaticData, type StaticData } from './static-data';
import { periodFitsMoment, targetTime, type SunTimes } from './sun';
import { londonMidnight } from './time';

const MINUTE = 60_000;

/** Flat walking from a car park to the shore: 5 km/h, paths a quarter longer than the crow flies. */
const LOCHSIDE_M_PER_MIN = 5000 / 60;
const PATH_FACTOR = 1.25;
/** With no car park within 1.5 km, a rough allowance from wherever you can stop. */
const LOCHSIDE_ROUGH_MIN = 15;

/** A car park serves the hill's bit of shore when its own shore point is this close. */
const SAME_SHORE_KM = 2.5;

/**
 * Drive to a car park by the loch (or its shore) and walk to the water. From a hill, the
 * car park serving the shore nearest the hill (`near`); for a loch on its own, the car
 * park nearest the start.
 */
export function lochsideTrip(
  body: WaterBody,
  start: { lat: number; lon: number },
  pace: keyof typeof PACE_FACTOR,
  near?: { lat: number; lon: number },
) {
  const byDistance = (
    to: { lat: number; lon: number },
    key: (p: WaterBody['parkings'][number]) => { lat: number; lon: number },
  ) => [...body.parkings].sort((a, b) => distanceKm(key(a), to) - distanceKm(key(b), to))[0];
  let p = near ? byDistance(near, (x) => x.shore) : byDistance(start, (x) => x);
  if (p && near && distanceKm(p.shore, near) > SAME_SHORE_KM) p = undefined;
  const shore = p?.shore ?? near ?? body.shore;
  const drive = estimateDrive(start, p ?? shore);
  const walkMinutes = p
    ? Math.max(
        2,
        Math.round(((p.distanceM * PATH_FACTOR) / LOCHSIDE_M_PER_MIN) * PACE_FACTOR[pace]),
      )
    : LOCHSIDE_ROUGH_MIN;
  return {
    drive,
    walkMinutes,
    walkSource: (p ? 'lochside' : 'lochside-estimate') as Trip['walkSource'],
    parking: p ? { lat: p.lat, lon: p.lon, name: p.name } : undefined,
    shore,
  };
}
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
  /**
   * Where the walk time came from: a worked-out route or a rough estimate up the hill, or
   * the walk from a car park to the lochside (or a rough guess with no car park nearby).
   */
  walkSource: 'route' | 'estimate' | 'lochside' | 'lochside-estimate';
  /** Where the trip ends: the summit, or the lochside for water conditions. */
  /**
   * Where the trip ends: the summit, the lochside for water conditions, or the spot
   * itself for a custom viewpoint or lochside place.
   */
  destination: 'summit' | 'lochside' | 'spot';
  /** The car park the drive ends at, when it's known. */
  parking?: { lat: number; lon: number; name: string };
  /** For a lochside trip, the bit of shore it ends at. */
  shore?: { lat: number; lon: number };
  /** e.g. "golden hour". */
  targetLabel: string;
  /** Why it doesn't fit the limits, or null. */
  problem: TripProblem | null;
}

export type { ConditionResult };

interface Evaluated extends EvaluatedPlace {
  searchOnly: boolean;
}

export interface ConditionTrip extends ConditionResult {
  trip: Trip | null;
}

/** A hill's walking route: found, none within reach, still working, or unreachable. */
export type RouteState = HillRoute | null | 'loading' | 'failed';
export type EnsembleState = Ensemble | 'loading' | 'failed';

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

class Conditions {
  /** The generated data, as loaded. */
  #base = $state.raw<StaticData | null>(null);
  /**
   * The data the app uses: the generated hills plus custom places, each place with its own
   * forecast zone appended after the generated ones and the "My places" list.
   */
  data = $derived.by((): StaticData | null => {
    const base = this.#base;
    if (!base) return null;
    if (places.list.length === 0) return base;
    const merged = withPlaces(base, places.list);
    return {
      ...merged,
      hillsByNumber: new Map(merged.hills.map((h) => [h.number, h])),
      lists: [...base.lists, CUSTOM_LIST],
    };
  });
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
  /** Ensembles for hills that have been opened, by family and hill number. */
  ensembles = $state.raw<Map<number, EnsembleState>>(new Map());
  metOfficeEnsembles = $state.raw<Map<number, EnsembleState>>(new Map());

  /** Fetches both ensembles (ECMWF and Met Office) for one place, once per page load. */
  loadEnsemble(hillNumber: number, lat: number, lon: number) {
    const load = async (key: 'ensembles' | 'metOfficeEnsembles', get: () => Promise<Ensemble>) => {
      if (this[key].has(hillNumber)) return;
      this[key] = new Map(this[key]).set(hillNumber, 'loading');
      try {
        const e = await get();
        this[key] = new Map(this[key]).set(hillNumber, e);
      } catch (err) {
        console.warn('Ensemble:', err);
        this[key] = new Map(this[key]).set(hillNumber, 'failed');
      }
    };
    void load('ensembles', () => fetchEnsemble(lat, lon));
    void load('metOfficeEnsembles', () => fetchMetOfficeEnsemble(lat, lon));
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
    // Lochs opened as places have no summit to route to.
    if (hill.kind === 'water') return;
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
    if (this.#base) return;
    try {
      this.#base = await loadStaticData();
      void places.load();
    } catch (e) {
      this.error = (e as Error).message;
    }
  }

  /** Condition ids and their config, in config order. */
  profiles = $derived.by((): [string, ProfileConfig][] =>
    this.data ? Object.entries(this.data.config.profiles) : [],
  );

  /** Ticked when nothing is chosen: every photo condition, and hill walking. */
  defaultTicked = $derived(
    this.profiles.filter(([id, p]) => p.photo || id === 'walking').map(([id]) => id),
  );

  /** The ticked conditions. */
  ticked = $derived.by(() => {
    const ids = this.profiles.map(([id]) => id);
    if (settings.conditions) return new Set(settings.conditions.filter((id) => ids.includes(id)));
    return new Set(this.defaultTicked);
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
        // Custom places were added on purpose: no minimum height for them.
        (h.kind === 'custom' || h.metres >= settings.minHeight) &&
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
      for (const r of results)
        if (this.#isNew('main', r.zoneId, r.fetchedAt)) next.set(r.zoneId, r.forecasts);
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
      for (const r of h)
        if (this.#isNew('harmonie', r.zoneId, r.fetchedAt)) next.set(r.zoneId, r.forecasts);
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
        if (!this.#isNew('horizon', r.zoneId, r.fetchedAt)) continue;
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
    const main = this.forecasts.get(zoneId);
    const harm = this.harmonie.get(zoneId);
    // The same array while neither part changes, so the scoring memo can reuse results.
    const known = this.#merged.get(zoneId);
    if (known && known.main === main && known.harm === harm) return known.merged;
    const merged = [...(main ?? []), ...(harm ?? [])];
    this.#merged.set(zoneId, { main, harm, merged });
    return merged;
  }
  #merged = new Map<
    string,
    { main?: ModelForecast[]; harm?: ModelForecast[]; merged: ModelForecast[] }
  >();

  /** The horizon lookup the engine uses for a zone. */
  horizonFor(zoneId: string): (time: number) => { low: number | null; mid: number | null } | null {
    return horizonLookup(this.horizons.get(zoneId));
  }

  /**
   * Whether a fetch result is new data. Changing a filter re-reads every needed zone, mostly
   * from cache: keeping the old object when the data hasn't changed lets the scoring memo
   * keep its results, instead of re-scoring every hill because the copies are new.
   */
  #isNew(kind: string, key: string, fetchedAt: number): boolean {
    const k = `${kind}|${key}`;
    if (this.#fetchedAt.get(k) === fetchedAt) return false;
    this.#fetchedAt.set(k, fetchedAt);
    return true;
  }
  #fetchedAt = new Map<string, number>();

  /** Scores kept between recalculations: see evaluatePlaces. */
  #memo = createEvaluateMemo();

  /** Layer 1: every condition for every listed hill with a forecast. The costly part. */
  evaluated = $derived.by((): Evaluated[] => {
    const data = this.data;
    if (!data) return [];
    const listed = this.listedHills;
    const extra = this.extra;
    const addExtra = extra !== null && !listed.some((h) => h.number === extra.number);
    const hills = addExtra ? [...listed, extra] : listed;
    return evaluatePlaces({
      hills,
      data,
      dayOffset: settings.dayOffset,
      now: this.now,
      modelsFor: (zoneId) => this.modelsFor(zoneId),
      horizonsFor: (zoneId) => this.horizons.get(zoneId),
      kp: this.kp,
      memo: this.#memo,
    }).map((e) => ({ ...e, searchOnly: addExtra && e.hill === extra }));
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
      const placeWater =
        e.hill.kind === 'water' && e.hill.water
          ? this.data?.waters?.[e.hill.water.index]
          : undefined;
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
        // Opening a hill means going to its top, so trips include the walk up. Water
        // conditions are the exception: they're shot from the shore, so the trip ends there.
        // A loch opened as a place: every condition is seen from its shore.
        // A lochside place is the shore already: its trips end at the spot.
        const lochBody =
          e.hill.place?.kind === 'lochside' ? undefined : (c.water?.body ?? placeWater);
        const loch = lochBody
          ? lochsideTrip(lochBody, start!, settings.pace, c.water ? e.hill.water?.shore : undefined)
          : null;
        const legDrive = loch ? loch.drive : drive;
        const walkMinutes = loch ? loch.walkMinutes : summitWalk;
        const walkSource: Trip['walkSource'] = loch
          ? loch.walkSource
          : found
            ? 'route'
            : 'estimate';
        const parking = loch
          ? loch.parking
          : found?.start.kind === 'parking'
            ? { lat: found.start.lat, lon: found.start.lon, name: found.start.name ?? '' }
            : undefined;
        const plan = planTrip({
          target: target.at,
          driveMinutes: legDrive.minutes,
          walkMinutes,
          earlyMinutes: settings.earlyMinutes,
          readyMinutes: settings.readyMinutes,
        });
        return {
          ...c,
          trip: {
            plan,
            driveMinutes: legDrive.minutes,
            roadMiles: legDrive.roadMiles,
            walkMinutes,
            walkSource,
            destination: loch
              ? 'lochside'
              : e.hill.place && e.hill.place.kind !== 'high'
                ? 'spot'
                : 'summit',
            ...(loch ? { shore: loch.shore } : {}),
            ...(parking ? { parking } : {}),
            targetLabel: target.label,
            problem: tripProblem(plan, legDrive.minutes, limits),
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
