/**
 * Fetches zone forecasts and scores every hill (or zone) for the chosen profile, day and
 * light, then plans the trip to each: when to get up, leave and arrive. Shared by the map,
 * the panel and the detail sheet.
 */
import {
  distanceMiles,
  estimateDrive,
  estimateSummitWalk,
  evaluateTarget,
  hillIsOnList,
  planTrip,
  profileAt,
  rankResults,
  saturatedLayers,
  tripProblem,
  type Hill,
  type LatLon,
  type Layer,
  type ModelForecast,
  type TargetResult,
  type TripPlan,
  type TripProblem,
  type Verdict,
  type Zone,
} from '@atmos/engine';
import { fetchZoneForecasts, ForecastError } from '@atmos/data-client';
import { forecastCache, newestFetch } from './cache';
import { settings } from './settings.svelte';
import { SUMMIT_PROFILES, loadStaticData, type StaticData } from './static-data';
import {
  lightFor,
  profileWindow,
  sunTimes,
  targetTime,
  type LightWindow,
  type SunTimes,
} from './sun';
import { londonMidnight } from './time';

const MINUTE = 60_000;
/** Valley profiles (sky, reflections): a short walk from the car to the viewpoint. */
const VIEWPOINT_WALK_MINUTES = 15;

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

export interface HillResult {
  hill: Hill;
  zone: Zone;
  result: TargetResult;
  miles: number | null;
  trip: Trip | null;
}

export interface ZoneResult {
  zone: Zone;
  /** Zone verdict: its best reachable hill (summit profiles) or the zone itself (valley profiles). */
  result: TargetResult;
  /** Hills best first; reachable ones ahead of those that don't fit the limits. */
  hills: HillResult[];
  goCount: number;
  window: LightWindow;
  sun: SunTimes;
  miles: number | null;
  /** The plan for the zone's headline hill (or viewpoint). */
  trip: Trip | null;
}

export interface Ranking {
  /** Worth going and reachable within the limits, best first. */
  go: ZoneResult[];
  /** Worth going, but only by getting up too early (or leaving now has passed). */
  tooEarly: ZoneResult[];
  /** Verdict NO. */
  avoid: ZoneResult[];
  /** Every zone, for the map. */
  zones: ZoneResult[];
  hillsByNumber: Map<number, HillResult>;
  summitProfile: boolean;
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
  data = $state.raw<StaticData | null>(null);
  forecasts = $state.raw<Map<string, ModelForecast[]>>(new Map());
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

  /** Hills passing the list, height and drive-time filters. */
  filteredHills = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const lists = data.lists.filter(
      (l) => settings.lists.length === 0 || settings.lists.includes(l.id),
    );
    const start = settings.start;
    const maxDrive = start ? settings.maxDriveMinutes : null;
    return data.hills.filter((h) => {
      if (h.zone < 0) return false;
      if (h.metres < settings.minHeight) return false;
      if (!lists.some((l) => hillIsOnList(h, l))) return false;
      if (maxDrive !== null && start && estimateDrive(start, h).minutes > maxDrive) return false;
      return true;
    });
  });

  /** Zones with at least one hill passing the filters: the only ones fetched. */
  neededZones = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const ids = new Set(this.filteredHills.map((h) => h.zone));
    return data.zones.filter((_, i) => ids.has(i));
  });

  async refresh(force = false) {
    const zones = this.neededZones;
    if (zones.length === 0 || this.loading) return;
    this.loading = true;
    this.error = null;
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
    }
  }

  ranking: Ranking = $derived.by(() => {
    const data = this.data;
    const empty: Ranking = {
      go: [],
      tooEarly: [],
      avoid: [],
      zones: [],
      hillsByNumber: new Map(),
      summitProfile: true,
      windowPassed: false,
    };
    if (!data || !data.config.profiles[settings.profile]) return empty;

    const profileId = settings.profile;
    const summitProfile = SUMMIT_PROFILES.has(profileId);
    const light = lightFor(profileId, settings.light);
    const dayStart = londonMidnight(settings.dayOffset, this.now);
    const opts = { now: this.now };
    const start = settings.start;
    const limits = {
      earliestWake: settings.earliestUp ? localTime(dayStart, settings.earliestUp) : null,
      maxDriveMinutes: null, // already applied as a filter
      now: this.now,
    };

    const hillsByZone = new Map<number, Hill[]>();
    for (const h of this.filteredHills) {
      const list = hillsByZone.get(h.zone) ?? [];
      list.push(h);
      hillsByZone.set(h.zone, list);
    }

    const zones: ZoneResult[] = [];
    const hillsByNumber = new Map<number, HillResult>();
    let windowPassed = false;

    for (const [zoneIndex, hills] of hillsByZone) {
      const zone = data.zones[zoneIndex]!;
      const forecasts = this.forecasts.get(zone.id);
      if (!forecasts || forecasts.length === 0) continue;
      const p = zone.forecastPoint;
      const sun = sunTimes(p.lat, p.lon, settings.dayOffset, this.now);
      const window = profileWindow(profileId, light, sun, dayStart);
      if (window.end < this.now) windowPassed = true;
      const target = targetTime(profileId, light, settings.moment, sun, window);
      const valleyM = forecasts[0]!.groundElevationM;

      const tripTo = (to: LatLon, walkMinutes: number): Trip | null => {
        if (!start) return null;
        const drive = estimateDrive(start, to);
        const plan = planTrip({
          target: target.at,
          driveMinutes: drive.minutes,
          walkMinutes,
          earlyMinutes: settings.earlyMinutes,
          readyMinutes: settings.readyMinutes,
        });
        return {
          plan,
          driveMinutes: drive.minutes,
          roadMiles: drive.roadMiles,
          walkMinutes,
          targetLabel: target.label,
          problem: tripProblem(plan, drive.minutes, limits),
        };
      };

      let hillResults: HillResult[] = [];
      let zoneResult: TargetResult;
      let zoneTrip: Trip | null;
      if (summitProfile) {
        hillResults = hills.map((hill) => ({
          hill,
          zone,
          miles: start ? distanceMiles(start, hill) : null,
          trip: tripTo(hill, estimateSummitWalk(hill.metres, valleyM, settings.pace).minutes),
          result: evaluateTarget(
            forecasts,
            window,
            { id: String(hill.number), name: hill.name, altitudeM: hill.metres },
            profileId,
            data.config,
            opts,
          ),
        }));
        // Reachable hills first, then verdict, then score.
        const ranked = rankResults(hillResults.map((h) => h.result));
        const rank = new Map(ranked.map((r, i) => [r, i]));
        hillResults.sort(
          (a, b) =>
            Number(Boolean(a.trip?.problem)) - Number(Boolean(b.trip?.problem)) ||
            rank.get(a.result)! - rank.get(b.result)!,
        );
        // The headline is the best reachable hill worth going to, if there is one.
        const headline =
          hillResults.find((h) => !h.trip?.problem && worthGoing(h.result.verdict)) ??
          [...hillResults].sort((a, b) => rank.get(a.result)! - rank.get(b.result)!)[0]!;
        hillResults = [headline, ...hillResults.filter((h) => h !== headline)];
        zoneResult = headline.result;
        zoneTrip = headline.trip;
      } else {
        zoneResult = evaluateTarget(
          forecasts,
          window,
          { id: zone.id, name: zone.name, altitudeM: valleyM },
          profileId,
          data.config,
          opts,
        );
        zoneTrip = tripTo(p, VIEWPOINT_WALK_MINUTES);
      }
      for (const h of hillResults) hillsByNumber.set(h.hill.number, h);
      zones.push({
        zone,
        result: zoneResult,
        hills: hillResults,
        goCount: hillResults.filter((h) => h.result.verdict === 'go' && !h.trip?.problem).length,
        window,
        sun,
        miles: start ? distanceMiles(start, p) : null,
        trip: zoneTrip,
      });
    }

    // Best verdict first, then score; among equals, the nearest first when a start is set.
    const near = (z: ZoneResult) => z.trip?.driveMinutes ?? z.miles ?? 0;
    zones.sort((a, b) => {
      const dv = ORDER[a.result.verdict] - ORDER[b.result.verdict];
      if (dv !== 0) return dv;
      const ds = (b.result.score ?? -1) - (a.result.score ?? -1);
      if (Math.abs(ds) > 0.02) return ds;
      return near(a) - near(b);
    });

    const isGo = (z: ZoneResult) => worthGoing(z.result.verdict);
    return {
      go: zones.filter((z) => isGo(z) && !z.trip?.problem),
      // Too early (or too late to leave): sorted by how early you'd have to be up.
      tooEarly: zones
        .filter((z) => isGo(z) && z.trip?.problem)
        .sort((a, b) => (b.trip?.plan.wakeAt ?? 0) - (a.trip?.plan.wakeAt ?? 0)),
      avoid: zones.filter((z) => z.result.verdict === 'no'),
      zones,
      hillsByNumber,
      summitProfile,
      windowPassed,
    };
  });

  forecastsFor(zoneId: string): ModelForecast[] {
    return this.forecasts.get(zoneId) ?? [];
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
