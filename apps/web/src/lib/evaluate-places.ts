/**
 * Scoring every condition for a set of hills (and lochs opened as places), with no Svelte
 * state: the web app runs it reactively, and the alerts service runs it on the server, so
 * an alert always says what the panel would.
 */
import {
  configForWater,
  evaluateTarget,
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
import { londonMidnight } from './time';

/** One condition in one part of the day, for one hill. */
export interface ConditionResult {
  profileId: string;
  period: Period;
  result: TargetResult;
  window: LightWindow;
  /** Scored at the summit, or shared with the rest of the zone from the valley forecast. */
  scope: 'summit' | 'valley';
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

export interface EvaluateInput {
  hills: Hill[];
  data: { zones: Zone[]; config: ScoringConfig; waters: WaterBody[] | null };
  dayOffset: number;
  now: number;
  /** Every model's forecast for a zone. */
  modelsFor: (zoneId: string) => ModelForecast[];
  horizonFor: (zoneId: string) => HorizonLookup;
  kp: KpBin[];
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
  const { hills, data, dayOffset, now, modelsFor, horizonFor, kp } = input;
  const profiles = Object.entries(data.config.profiles);
  const dayStart = londonMidnight(dayOffset, now);
  const opts = { now, extras: { kp: (t: number) => kpAt(kp, t) } };
  const out: EvaluatedPlace[] = [];
  const zoneCache = new Map<
    number,
    { sun: SunTimes; nextSun: SunTimes; valley: ConditionResult[]; valleyM: number }
  >();
  const waterCache = new Map<number, ConditionResult[]>();

  for (const hill of hills) {
    const zone = data.zones[hill.zone];
    if (!zone) continue;
    const forecasts = modelsFor(zone.id);
    if (forecasts.length === 0) continue;
    const zoneOpts = { ...opts, extras: { ...opts.extras, horizon: horizonFor(zone.id) } };
    const p = zone.forecastPoint;

    let z = zoneCache.get(hill.zone);
    if (!z) {
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
      z = { sun, nextSun, valley, valleyM };
      zoneCache.set(hill.zone, z);
    }

    const summit: ConditionResult[] = [];
    for (const [id, cfg] of profiles) {
      // A loch opened as a place has no summit.
      if (cfg.scope !== 'summit' || hill.kind === 'water') continue;
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

    // Water conditions at the hill's loch, from the zone's valley forecast with wind limits
    // scaled for the loch's size. Shared by every hill using the same water.
    let lochside: ConditionResult[] = [];
    const link = hill.water;
    const body = link && data.waters ? data.waters[link.index] : undefined;
    if (body && link) {
      let cached = waterCache.get(link.index);
      if (!cached) {
        cached = [];
        for (const [id, cfg] of profiles) {
          if (!cfg.water) continue;
          const config = configForWater(data.config, id, body.spanKm);
          for (const period of cfg.periods) {
            const window = periodWindow(period, id, z.sun, z.nextSun, dayStart);
            const target = {
              id: `water:${body.id}`,
              name: waterName(body),
              altitudeM: z.valleyM,
              lat: body.lat,
              lon: body.lon,
            };
            const result = evaluateTarget(forecasts, window, target, id, config, zoneOpts);
            cached.push({ profileId: id, period, result, window, scope: 'valley' });
          }
        }
        waterCache.set(link.index, cached);
      }
      lochside = cached.map((c) => ({ ...c, water: { body, distanceM: link.distanceM } }));
    }

    out.push({
      hill,
      zone,
      sun: z.sun,
      valleyM: z.valleyM,
      conditions: [...summit, ...z.valley, ...lochside],
    });
  }
  return out;
}
