/**
 * Custom places: spots people add themselves (a crag, a viewpoint, a bit of lochside),
 * scored like any hill. Each gets its own forecast point, because there are only a few of
 * them, rather than sharing a zone's valley forecast as hills do.
 */
import type { Hill, HillList, Nation, Zone } from './data.js';
import { distanceKm } from './geo.js';
import type { WaterBody } from './water.js';

export type PlaceKind = 'high' | 'viewpoint' | 'lochside';

export const PLACE_KINDS: Record<PlaceKind, { label: string; hint: string }> = {
  high: { label: 'High point', hint: 'A top or crag: judged at its height, with a walk up' },
  viewpoint: {
    label: 'Viewpoint',
    hint: 'A roadside spot, beach or waterfall: judged where it is',
  },
  lochside: { label: 'Lochside', hint: 'The shore of a loch or lake: reflections, mist and ice' },
};

export interface CustomPlace {
  id: string;
  /** Stable number for links (?hill=), from CUSTOM_NUMBER_BASE up; never a DoBIH number. */
  number: number;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  /** Height above sea level, metres: from terrain data, or as entered. */
  metres: number;
  createdAt?: number;
  updatedAt?: number;
}

/** Shared places (kept by the server) are numbered from here; DoBIH stops well short. */
export const CUSTOM_NUMBER_BASE = 1_000_000;
/** Places kept only in a browser, when there's no server. */
export const LOCAL_NUMBER_BASE = 2_000_000;

export const isCustomNumber = (n: number) => n > CUSTOM_NUMBER_BASE;

/** "My places" in the hill-list filter. DoBIH lists use the low bits. */
export const CUSTOM_LIST: HillList = { id: 'custom', label: 'My places', bit: 30 };

/** A place's own forecast zone, appended after the generated ones. */
export function placeZone(p: CustomPlace, nation: Nation): Zone {
  return { id: `place:${p.id}`, name: p.name, nation, forecastPoint: { lat: p.lat, lon: p.lon } };
}

/**
 * The still water nearest a place. The web app has no shorelines, only each water's middle
 * and length, so the shore is taken as 30% of the length from the middle: lochs are long and
 * thin, and taking the full half-length would let a 36 km loch like Lomond claim places 15 km
 * off its side. Of the waters within `maxKm`, the closest wins, then the nearest middle.
 */
export function nearestWaterTo(
  p: { lat: number; lon: number },
  waters: WaterBody[],
  maxKm = 3,
): { index: number; distanceM: number } | null {
  let best: { index: number; distanceM: number; centreKm: number } | null = null;
  for (const [i, w] of waters.entries()) {
    const centreKm = distanceKm(p, w);
    const km = Math.max(0, centreKm - w.spanKm * 0.3);
    if (km > maxKm) continue;
    const m = Math.round(km * 1000);
    if (!best || m < best.distanceM || (m === best.distanceM && centreKm < best.centreKm)) {
      best = { index: i, distanceM: m, centreKm };
    }
  }
  return best ? { index: best.index, distanceM: best.distanceM } : null;
}

/** A custom place as a hill for scoring, routes and the map. */
export function placeAsHill(
  p: CustomPlace,
  zoneIndex: number,
  nation: Nation,
  water: { index: number; distanceM: number } | null,
): Hill {
  return {
    number: p.number,
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    metres: p.metres,
    lists: 1 << CUSTOM_LIST.bit,
    zone: zoneIndex,
    nations: [nation],
    ...(water ? { water } : {}),
    kind: 'custom',
    place: { id: p.id, kind: p.kind },
  };
}

/**
 * Adds custom places to the generated data: each gets its own zone (appended, so existing
 * zone indices stay put), the nation of the nearest zone, and any still water within 3 km.
 * Used by the website and the alerts service alike.
 */
export function withPlaces<T extends { hills: Hill[]; zones: Zone[]; waters: WaterBody[] | null }>(
  base: T,
  places: CustomPlace[],
): T & { placeHills: Hill[] } {
  const zones = [...base.zones];
  const placeHills: Hill[] = [];
  for (const p of places) {
    let nation: Nation = 'scotland';
    let nearestKm = Infinity;
    for (const z of base.zones) {
      const km = distanceKm(p, z.forecastPoint);
      if (km < nearestKm) {
        nearestKm = km;
        nation = z.nation;
      }
    }
    zones.push(placeZone(p, nation));
    const water = base.waters
      ? nearestWaterTo(p, base.waters, p.kind === 'lochside' ? 1 : 3)
      : null;
    placeHills.push(placeAsHill(p, zones.length - 1, nation, water));
  }
  return { ...base, zones, hills: [...base.hills, ...placeHills], placeHills };
}
