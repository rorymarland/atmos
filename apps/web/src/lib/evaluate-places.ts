/**
 * Scoring every condition for a set of hills (and lochs opened as places), with no Svelte
 * state: the web app runs it reactively, and the alerts service runs it on the server, so
 * an alert always says what the panel would.
 */
import {
  configForWater,
  evaluateTarget,
  rescoreTarget,
  waterName,
  type Hill,
  type ModelForecast,
  type Period,
  type ScoringConfig,
  type TargetResult,
  type WaterBody,
  type Zone,
} from '@atmos/engine';
import { kpAt, type ForecastSite, type KpBin } from '@atmos/data-client';
import { periodWindow, skyPositions, sunTimes, type LightWindow, type SunTimes } from './sun';
import { defaultWalkWindow, walkSpan } from './walk';
import { londonMidnight } from './time';

/** One condition in one part of the day, for one hill. */
export interface ConditionResult {
  profileId: string;
  period: Period;
  result: TargetResult;
  window: LightWindow;
  /** Scored at the summit, or shared with the rest of the zone from the valley forecast. */
  scope: 'summit' | 'valley';
  /**
   * Walking only: every hour from before first light to after dark, so "Your trip" can
   * judge the hours of the walk you'd actually do (see walk.ts).
   */
  span?: TargetResult;
  /** For conditions that need still water: the loch it was scored for. */
  water?: { body: WaterBody; distanceM: number };
}

export interface EvaluatedPlace {
  hill: Hill;
  zone: Zone;
  sun: SunTimes;
  valleyM: number;
  conditions: ConditionResult[];
}

export type HorizonLookup = (time: number) => { low: number | null; mid: number | null } | null;

export type HorizonSource = { am?: ModelForecast; pm?: ModelForecast } | undefined;

export interface EvaluateInput {
  hills: Hill[];
  data: { zones: Zone[]; config: ScoringConfig; waters: WaterBody[] | null };
  dayOffset: number;
  now: number;
  /**
   * Every model's forecast for a zone. Return the same array while the zone's forecasts are
   * unchanged: the memo uses its identity to know when to re-score.
   */
  modelsFor: (zoneId: string) => ModelForecast[];
  /** The zone's sunrise and sunset horizon forecasts (same object while unchanged). */
  horizonsFor: (zoneId: string) => HorizonSource;
  kp: KpBin[];
  /**
   * Results kept between calls. Scoring every hill is the costly part of the app, and most
   * calls (a filter ticked, a list changed) change which hills are shown, not their scores.
   */
  memo?: EvaluateMemo;
}

interface MemoEntry<T> {
  deps: unknown[];
  value: T;
}

/** What evaluatePlaces remembers; make one per caller with createEvaluateMemo. */
export interface EvaluateMemo {
  /** Everything every result depends on; when any of it changes, the memo starts afresh. */
  global: unknown[];
  zones: Map<
    string,
    MemoEntry<{ sun: SunTimes; nextSun: SunTimes; valley: ConditionResult[]; valleyM: number }>
  >;
  waters: Map<string, MemoEntry<ConditionResult[]>>;
  hills: Map<number, MemoEntry<EvaluatedPlace>>;
}

export function createEvaluateMemo(): EvaluateMemo {
  return { global: [], zones: new Map(), waters: new Map(), hills: new Map() };
}

const sameDeps = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function remember<K, T>(map: Map<K, MemoEntry<T>>, key: K, deps: unknown[], make: () => T): T {
  const hit = map.get(key);
  if (hit && sameDeps(hit.deps, deps)) return hit.value;
  const value = make();
  map.set(key, { deps, value });
  return value;
}

const londonHourFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: 'numeric',
  hourCycle: 'h23',
});
export const londonHour = (t: number) => Number(londonHourFormat.format(t));

/** About 60 km out: far enough to be the horizon's cloud, close enough to matter. */
const HORIZON_KM = 60;

/**
 * Points towards sunrise and sunset from a zone. Bearings are taken two days ahead and
 * rounded to 5°, so they serve the whole five days and the cache stays put.
 */
export function horizonSites(zone: Zone, now: number): ForecastSite[] {
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

/** The horizon lookup the engine uses, from a zone's sunrise and sunset horizon forecasts. */
export function horizonLookup(
  h: { am?: ModelForecast; pm?: ModelForecast } | undefined,
): HorizonLookup {
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

/** Every condition and period for each hill with a forecast, on day `dayOffset`. */
export function evaluatePlaces(input: EvaluateInput): EvaluatedPlace[] {
  const { hills, data, dayOffset, now, modelsFor, horizonsFor, kp } = input;
  const memo = input.memo ?? createEvaluateMemo();
  // Day boundaries and the "beyond the reliable horizon" test move by the hour, not the second.
  const hour = Math.floor(now / 3_600_000);
  const global = [dayOffset, hour, kp, data.config, data.waters];
  if (!sameDeps(memo.global, global)) {
    memo.global = global;
    memo.zones.clear();
    memo.waters.clear();
    memo.hills.clear();
  }
  const profiles = Object.entries(data.config.profiles);
  const dayStart = londonMidnight(dayOffset, now);
  const opts = { now, extras: { kp: (t: number) => kpAt(kp, t) } };
  const out: EvaluatedPlace[] = [];

  for (const hill of hills) {
    const zone = data.zones[hill.zone];
    if (!zone) continue;
    const forecasts = modelsFor(zone.id);
    if (forecasts.length === 0) continue;
    const horizon = horizonsFor(zone.id);
    const zoneDeps = [forecasts, horizon, zone];
    const zoneOpts = { ...opts, extras: { ...opts.extras, horizon: horizonLookup(horizon) } };
    const p = zone.forecastPoint;

    const z = remember(memo.zones, zone.id, zoneDeps, () => {
      const sun = sunTimes(p.lat, p.lon, dayOffset, now);
      const nextSun = sunTimes(p.lat, p.lon, dayOffset + 1, now);
      const valleyM = forecasts[0]!.groundElevationM;
      const valley: ConditionResult[] = [];
      for (const [id, cfg] of profiles) {
        if (cfg.scope !== 'valley') continue;
        // With water data, water conditions are scored per loch below instead.
        if (cfg.water && data.waters) continue;
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
      return { sun, nextSun, valley, valleyM };
    });

    let link = hill.water;
    let body = link && data.waters ? data.waters[link.index] : undefined;
    // A lochside place with no mapped loch near it: judge it as a loch about 1 km long.
    if (!body && hill.place?.kind === 'lochside' && data.waters) {
      body = {
        id: `place:${hill.place.id}`,
        name: hill.name,
        lat: hill.lat,
        lon: hill.lon,
        ha: 50,
        spanKm: 1,
        zone: hill.zone,
        shore: { lat: hill.lat, lon: hill.lon },
        parkings: [],
      };
      link = { index: -1, distanceM: 0 };
    }

    const place = remember(
      memo.hills,
      hill.number,
      [...zoneDeps, hill, body?.id ?? null, z],
      () => {
        const summit: ConditionResult[] = [];
        for (const [id, cfg] of profiles) {
          // A loch opened as a place, or a lochside spot, has no summit.
          if (cfg.scope !== 'summit' || hill.kind === 'water' || hill.place?.kind === 'lochside')
            continue;
          const target = {
            id: String(hill.number),
            name: hill.name,
            altitudeM: hill.metres,
            lat: hill.lat,
            lon: hill.lon,
          };
          if (id === 'walking') {
            // Scored once across the day; each part of the day gets a typical walk.
            const span = evaluateTarget(
              forecasts,
              walkSpan(z.sun, dayStart),
              target,
              id,
              data.config,
              zoneOpts,
            );
            for (const period of cfg.periods) {
              const window = defaultWalkWindow(period, z.sun, dayStart);
              const result = rescoreTarget(span, window, data.config, zoneOpts);
              summit.push({ profileId: id, period, result, window, scope: 'summit', span });
            }
            continue;
          }
          for (const period of cfg.periods) {
            const window = periodWindow(period, id, z.sun, z.nextSun, dayStart);
            const result = evaluateTarget(forecasts, window, target, id, data.config, zoneOpts);
            summit.push({ profileId: id, period, result, window, scope: 'summit' });
          }
        }

        // Water conditions at the hill's loch, from the zone's forecast with wind limits
        // scaled for the loch's size. Shared by every hill using the same water.
        let lochside: ConditionResult[] = [];
        if (body && link) {
          const b = body;
          const cached = remember(memo.waters, `${b.id}|${zone.id}`, [...zoneDeps, b], () => {
            const results: ConditionResult[] = [];
            for (const [id, cfg] of profiles) {
              if (!cfg.water) continue;
              const config = configForWater(data.config, id, b.spanKm);
              for (const period of cfg.periods) {
                const window = periodWindow(period, id, z.sun, z.nextSun, dayStart);
                const target = {
                  id: `water:${b.id}`,
                  name: waterName(b),
                  altitudeM: z.valleyM,
                  lat: b.lat,
                  lon: b.lon,
                };
                const result = evaluateTarget(forecasts, window, target, id, config, zoneOpts);
                results.push({ profileId: id, period, result, window, scope: 'valley' });
              }
            }
            return results;
          });
          const w = { body: b, distanceM: link.distanceM };
          lochside = cached.map((c) => ({ ...c, water: w }));
        }
        return {
          hill,
          zone,
          sun: z.sun,
          valleyM: z.valleyM,
          conditions: [...summit, ...z.valley, ...lochside],
        };
      },
    );
    out.push(place);
  }
  return out;
}
