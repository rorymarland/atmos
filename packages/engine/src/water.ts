/**
 * Still water and the conditions that need it (reflections, frozen lochs).
 *
 * Wind ruffles water more the further it runs over it (the fetch), so a long loch needs
 * calmer air than a lochan for the same mirror. Profiles with `water.fetchScaled` have
 * those factors' limits scaled by the water's longest span: x1 for a 1 km loch, looser for
 * smaller water, tighter for bigger, between x1.35 and x0.6.
 */
import type { ScoringConfig } from './config.js';

export interface WaterBody {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Surface area, hectares. */
  ha: number;
  /** Longest distance across, km. */
  spanKm: number;
  /** Index into zones.json. */
  zone: number;
  /** The lochside point a trip ends at: by the nearest car park when there is one. */
  shore: { lat: number; lon: number };
  /** The nearest public car park within 1.5 km of the shore. */
  parking?: { lat: number; lon: number; name: string; distanceM: number };
}

/** How much to scale wind limits for water `spanKm` across. */
export function fetchFactor(spanKm: number): number {
  const span = Math.max(0.05, spanKm);
  return Math.min(1.35, Math.max(0.6, 1 - 0.15 * Math.log2(span)));
}

/**
 * The scoring config with one water profile's fetch-scaled limits adjusted for this water.
 * Other profiles are untouched; returns the same config when nothing changes.
 */
export function configForWater(
  config: ScoringConfig,
  profileId: string,
  spanKm: number,
): ScoringConfig {
  const profile = config.profiles[profileId];
  const scaled = profile?.water?.fetchScaled ?? [];
  if (!profile || scaled.length === 0) return config;
  const f = fetchFactor(spanKm);
  const factors = { ...profile.factors };
  for (const name of scaled) {
    const factor = factors[name];
    if (factor && 'good' in factor) {
      factors[name] = { ...factor, good: factor.good * f, bad: factor.bad * f };
    }
  }
  return { ...config, profiles: { ...config.profiles, [profileId]: { ...profile, factors } } };
}

/**
 * [id, name, lat, lon, ha, spanKm, zone, shoreLat, shoreLon, parkLat?, parkLon?, parkName?, parkDistM?]
 */
export type WaterBodyRow = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  ...([number, number, string, number] | []),
];

export interface WatersFile {
  source: string;
  waters: WaterBodyRow[];
}

export function encodeWaterBody(w: WaterBody): WaterBodyRow {
  const base: WaterBodyRow = [
    w.id,
    w.name,
    w.lat,
    w.lon,
    w.ha,
    w.spanKm,
    w.zone,
    w.shore.lat,
    w.shore.lon,
  ];
  if (!w.parking) return base;
  return [
    ...base,
    w.parking.lat,
    w.parking.lon,
    w.parking.name,
    w.parking.distanceM,
  ] as WaterBodyRow;
}

export function decodeWaterBody(row: WaterBodyRow): WaterBody {
  const [id, name, lat, lon, ha, spanKm, zone, shoreLat, shoreLon, pLat, pLon, pName, pDist] =
    row as [
      string,
      string,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number?,
      number?,
      string?,
      number?,
    ];
  return {
    id,
    name,
    lat,
    lon,
    ha,
    spanKm,
    zone,
    shore: { lat: shoreLat, lon: shoreLon },
    ...(pLat !== undefined && pLon !== undefined
      ? { parking: { lat: pLat, lon: pLon, name: pName ?? '', distanceM: pDist ?? 0 } }
      : {}),
  };
}

/** A friendly name for unnamed water. */
export function waterName(w: Pick<WaterBody, 'name' | 'ha'>): string {
  return w.name || (w.ha < 5 ? 'an unnamed lochan' : 'an unnamed loch');
}
