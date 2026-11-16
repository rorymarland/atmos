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
  fetchKpForecast,
  fetchZoneForecasts,
  ForecastError,
  kpAt,
  type KpBin,
} from '@atmos/data-client';
import { forecastCache, newestFetch } from './cache';
import { settings } from './settings.svelte';
import { loadStaticData, type StaticData } from './static-data';
import {
  periodWindow,
  sunTimes,
  targetTime,
  type LightWindow,
  type Period,
  type SunTimes,
} from './sun';
import { londonMidnight } from './time';

const MINUTE = 60_000;
/** Valley conditions: a short walk from the car to the viewpoint. */
const VIEWPOINT_WALK_MINUTES = 15;
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

export interface HillResult {
  hill: Hill;
  zone: Zone;
  sun: SunTimes;
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
  /** Worth going only with an earlier start: the best condition that needs one. */
  needsEarlier: ConditionTrip | null;
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

interface Evaluated {
  hill: Hill;
  zone: Zone;
  sun: SunTimes;
  valleyM: number;
  conditions: ConditionResult[];
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
    return data.hills.filter(
      (h) => h.zone >= 0 && h.metres >= settings.minHeight && lists.some((l) => hillIsOnList(h, l)),
    );
  });

  /** Zones with a listed hill within the drive limit: the only ones fetched. */
  neededZones = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const start = settings.start;
    const maxDrive = start ? settings.maxDriveMinutes : null;
    const ids = new Set(
      this.listedHills
        .filter((h) => maxDrive === null || estimateDrive(start!, h).minutes <= maxDrive)
        .map((h) => h.zone),
    );
    return data.zones.filter((_, i) => ids.has(i));
  });

  async refresh(force = false) {
    const zones = this.neededZones;
    if (zones.length === 0 || this.loading) return;
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
    } catch (e) {
      this.error =
        e instanceof ForecastError
          ? e.message
          : `Couldn't reach the forecast service. ${navigator.onLine ? '' : 'You appear to be offline. '}Showing any saved forecasts.`;
    } finally {
      this.loading = false;
      this.progress = null;
      await kp;
    }
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

    for (const hill of this.listedHills) {
      const zone = data.zones[hill.zone]!;
      const forecasts = this.forecasts.get(zone.id);
      if (!forecasts || forecasts.length === 0) continue;
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
            const result = evaluateTarget(forecasts, window, target, id, data.config, opts);
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
          const result = evaluateTarget(forecasts, window, target, id, data.config, opts);
          summit.push({ profileId: id, period, result, window, scope: 'summit' });
        }
      }
      out.push({
        hill,
        zone,
        sun: z.sun,
        valleyM: z.valleyM,
        conditions: [...summit, ...z.valley],
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
    return this.evaluated.map((e) => {
      const drive = start ? estimateDrive(start, e.hill) : null;
      const summitWalk = estimateSummitWalk(e.hill.metres, e.valleyM, settings.pace).minutes;
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
        const walkMinutes = c.scope === 'summit' ? summitWalk : VIEWPOINT_WALK_MINUTES;
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
            targetLabel: target.label,
            problem: tripProblem(plan, drive.minutes, limits),
          },
        };
      });
      conditions.sort((a, b) => (b.result.score ?? -1) - (a.result.score ?? -1));
      return {
        ...e,
        conditions,
        miles: start ? distanceMiles(start, e.hill) : null,
        driveMinutes: drive?.minutes ?? null,
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
    const maxDrive = settings.start ? settings.maxDriveMinutes : null;
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
    for (const h of this.planned) {
      if (maxDrive !== null && h.driveMinutes !== null && h.driveMinutes > maxDrive) continue;
      const candidates = h.conditions.filter(
        (c) => ticked.has(c.profileId) && periods.has(c.period),
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
      hills.push({ ...h, counted, score, verdict, best, needsEarlier });
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
      hillsByNumber: new Map(hills.map((h) => [h.hill.number, h])),
      total: hills.length,
      windowPassed,
    };
  });

  forecastsFor(zoneId: string): ModelForecast[] {
    return this.forecasts.get(zoneId) ?? [];
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
