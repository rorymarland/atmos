/**
 * Fetches zone forecasts and scores every hill (or zone) for the chosen profile, day and
 * light. Shared by the Today, Map and detail views.
 */
import {
  distanceMiles,
  evaluateTarget,
  hillIsOnList,
  profileAt,
  rankResults,
  saturatedLayers,
  type Hill,
  type Layer,
  type ModelForecast,
  type TargetResult,
  type Zone,
} from '@atmos/engine';
import { fetchZoneForecasts, ForecastError } from '@atmos/data-client';
import { forecastCache, newestFetch } from './cache';
import { settings } from './settings.svelte';
import { SUMMIT_PROFILES, loadStaticData, type StaticData } from './static-data';
import { profileWindow, sunTimes, type LightWindow, type SunTimes } from './sun';
import { londonMidnight } from './time';

export interface HillResult {
  hill: Hill;
  zone: Zone;
  result: TargetResult;
  miles: number | null;
}

export interface ZoneResult {
  zone: Zone;
  /** Zone verdict: its best hill (summit profiles) or the zone itself (valley profiles). */
  result: TargetResult;
  hills: HillResult[];
  goCount: number;
  window: LightWindow;
  sun: SunTimes;
  miles: number | null;
}

export interface Ranking {
  zones: ZoneResult[];
  hillsByNumber: Map<number, HillResult>;
  summitProfile: boolean;
  windowPassed: boolean;
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

  /** Hills passing the list, height and distance filters. */
  filteredHills = $derived.by(() => {
    const data = this.data;
    if (!data) return [];
    const lists = data.lists.filter(
      (l) => settings.lists.length === 0 || settings.lists.includes(l.id),
    );
    return data.hills.filter((h) => {
      if (h.zone < 0) return false;
      if (h.metres < settings.minHeight) return false;
      if (!lists.some((l) => hillIsOnList(h, l))) return false;
      if (settings.maxMiles !== null && settings.start) {
        if (distanceMiles(settings.start, h) > settings.maxMiles) return false;
      }
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
      zones: [],
      hillsByNumber: new Map(),
      summitProfile: true,
      windowPassed: false,
    };
    if (!data || !data.config.profiles[settings.profile]) return empty;

    const profileId = settings.profile;
    const summitProfile = SUMMIT_PROFILES.has(profileId);
    const dayStart = londonMidnight(settings.dayOffset, this.now);
    const opts = { now: this.now };
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
      const window = profileWindow(profileId, settings.light, sun, dayStart);
      if (window.end < this.now) windowPassed = true;
      const miles = settings.start ? distanceMiles(settings.start, p) : null;

      let hillResults: HillResult[] = [];
      let zoneResult: TargetResult;
      if (summitProfile) {
        hillResults = hills.map((hill) => ({
          hill,
          zone,
          miles: settings.start ? distanceMiles(settings.start, hill) : null,
          result: evaluateTarget(
            forecasts,
            window,
            { id: String(hill.number), name: hill.name, altitudeM: hill.metres },
            profileId,
            data.config,
            opts,
          ),
        }));
        const ranked = rankResults(hillResults.map((h) => h.result));
        hillResults.sort((a, b) => ranked.indexOf(a.result) - ranked.indexOf(b.result));
        zoneResult = hillResults[0]!.result;
      } else {
        zoneResult = evaluateTarget(
          forecasts,
          window,
          { id: zone.id, name: zone.name, altitudeM: forecasts[0]!.groundElevationM },
          profileId,
          data.config,
          opts,
        );
      }
      for (const h of hillResults) hillsByNumber.set(h.hill.number, h);
      zones.push({
        zone,
        result: zoneResult,
        hills: hillResults,
        goCount: hillResults.filter((h) => h.result.verdict === 'go').length,
        window,
        sun,
        miles,
      });
    }

    // Best verdict first, then score; among equals, the nearest first when a start is set.
    const order = rankResults(zones.map((z) => z.result));
    const rank = new Map(order.map((r, i) => [r, i]));
    const near = (z: ZoneResult) => z.hills[0]?.miles ?? z.miles ?? 0;
    zones.sort((a, b) => {
      const va = { go: 0, maybe: 1, no: 2, nodata: 3 }[a.result.verdict];
      const vb = { go: 0, maybe: 1, no: 2, nodata: 3 }[b.result.verdict];
      if (va !== vb) return va - vb;
      const ds = (b.result.score ?? -1) - (a.result.score ?? -1);
      if (Math.abs(ds) > 0.02) return ds;
      return near(a) - near(b) || rank.get(a.result)! - rank.get(b.result)!;
    });
    return { zones, hillsByNumber, summitProfile, windowPassed };
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
