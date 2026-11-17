/**
 * Still water and the conditions that need it (reflections, frozen lochs).
 *
 * Wind ruffles water more the further it runs over it (the fetch), so a long loch needs
 * calmer air than a lochan for the same mirror. Profiles with `water.fetchScaled` have
 * those factors' limits scaled by the water's longest span: x1 for a 1 km loch, looser for
 * smaller water, tighter for bigger, between x1.35 and x0.6.
 */
import type { ScoringConfig } from './config.js';
import type { Hill } from './data.js';

export interface LochAccess {
  /** The car park. */
  lat: number;
  lon: number;
  name: string;
  /** From the car park to the shore point it serves, metres in a straight line. */
  distanceM: number;
  shore: { lat: number; lon: number };
}

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
  /** A lochside point to head for when there's no car park: by the nearest one if any. */
  shore: { lat: number; lon: number };
  /** Public car parks within 1.5 km of the shore, nearest first, spread round big lochs. */
  parkings: LochAccess[];
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

/** [parkLat, parkLon, name, distanceM, shoreLat, shoreLon] */
export type LochAccessRow = [number, number, string, number, number, number];
/** [id, name, lat, lon, ha, spanKm, zone, shoreLat, shoreLon, car parks?] */
export type WaterBodyRow =
  | [string, string, number, number, number, number, number, number, number]
  | [string, string, number, number, number, number, number, number, number, LochAccessRow[]];

export interface WatersFile {
  source: string;
  waters: WaterBodyRow[];
}

export function encodeWaterBody(w: WaterBody): WaterBodyRow {
  const base = [
    w.id,
    w.name,
    w.lat,
    w.lon,
    w.ha,
    w.spanKm,
    w.zone,
    w.shore.lat,
    w.shore.lon,
  ] as const;
  if (w.parkings.length === 0) return [...base];
  return [
    ...base,
    w.parkings.map((p): LochAccessRow => [
      p.lat,
      p.lon,
      p.name,
      p.distanceM,
      p.shore.lat,
      p.shore.lon,
    ]),
  ];
}

export function decodeWaterBody(row: WaterBodyRow): WaterBody {
  const [id, name, lat, lon, ha, spanKm, zone, shoreLat, shoreLon, parkings] = row;
  return {
    id,
    name,
    lat,
    lon,
    ha,
    spanKm,
    zone,
    shore: { lat: shoreLat, lon: shoreLon },
    parkings: (parkings ?? []).map(([pLat, pLon, pName, d, sLat, sLon]) => ({
      lat: pLat,
      lon: pLon,
      name: pName,
      distanceM: d,
      shore: { lat: sLat, lon: sLon },
    })),
  };
}

/**
 * A loch as a place to open like a hill: its number is negative (-1 for the first water)
 * so it can't clash with DoBIH numbers, and it has no summit to climb.
 */
export function waterAsPlace(body: WaterBody, index: number): Hill {
  return {
    number: -(index + 1),
    name: waterName(body).replace(/^an /, 'An '),
    lat: body.lat,
    lon: body.lon,
    metres: 0,
    lists: 0,
    zone: body.zone,
    nations: [],
    water: { index, distanceM: 0 },
    kind: 'water',
  };
}

/** The waters.json index of a place opened from waterAsPlace, or null for a hill. */
export function waterIndexOf(number: number): number | null {
  return number < 0 ? -number - 1 : null;
}

/** A friendly name for unnamed water. */
export function waterName(w: Pick<WaterBody, 'name' | 'ha'>): string {
  return w.name || (w.ha < 5 ? 'an unnamed lochan' : 'an unnamed loch');
}
