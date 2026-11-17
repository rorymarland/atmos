/**
 * Paths, roads and car parks around a summit from OpenStreetMap, through the Overpass
 * API: free, keyless and served with CORS. Used on demand (a few hills at a time), which
 * is well within its fair-use guidance.
 */
import type { OsmNode, OsmWay, Parking } from '@atmos/engine';

/**
 * The main server, then a mirror for when it's down. Checked from a browser in November
 * 2026: the main server answered every query in 32 to 44 s; the kumi and private.coffee
 * mirrors answered none within 90 s, so the mirror is a long shot.
 */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** Highways the router never uses (see isWalkable and isCarRoad), left out to save time. */
const UNUSED_HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|abandoned|platform|corridor|elevator|bus_stop|services|rest_area';

export interface OsmArea {
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
  parkings: Parking[];
}

/**
 * Usable highways and public car parks within `radiusM` of a point, each way with its
 * node ids and coordinates inline (`out body geom`), which is much less for the server to
 * send than every node separately.
 */
export function overpassQuery(lat: number, lon: number, radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `[out:json][timeout:60];(way["highway"]["highway"!~"^(${UNUSED_HIGHWAYS})$"](${around});nw["amenity"="parking"](${around}););out body geom qt;`;
}

interface Element {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  /** With `out geom`: each node's position, in the order of `nodes`. */
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
}

const PRIVATE = new Set(['private', 'no', 'customers']);

export function parseOverpass(json: unknown): OsmArea {
  const elements = ((json as { elements?: Element[] }).elements ?? []) as Element[];
  const nodes = new Map<number, OsmNode>();
  for (const e of elements) {
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      nodes.set(e.id, { lat: e.lat, lon: e.lon });
    } else if (e.type === 'way' && e.nodes && e.geometry) {
      e.nodes.forEach((id, i) => {
        const g = e.geometry![i];
        if (g && !nodes.has(id)) nodes.set(id, { lat: g.lat, lon: g.lon });
      });
    }
  }
  const ways: OsmWay[] = [];
  const parkings: Parking[] = [];
  const isPublicParking = (tags: Record<string, string>) =>
    tags.amenity === 'parking' && !PRIVATE.has(tags.access ?? '');
  const named = (tags: Record<string, string>) => (tags.name ? { name: tags.name } : {});

  for (const e of elements) {
    const tags = e.tags ?? {};
    if (e.type === 'node' && isPublicParking(tags)) {
      parkings.push({ lat: e.lat!, lon: e.lon!, ...named(tags) });
    } else if (e.type === 'way' && e.nodes) {
      if (tags.highway) ways.push({ id: e.id, nodes: e.nodes, tags });
      else if (isPublicParking(tags)) {
        // A car park drawn as an area: its middle.
        const pts = e.nodes.map((id) => nodes.get(id)).filter((p): p is OsmNode => !!p);
        if (pts.length) {
          parkings.push({
            lat: pts.reduce((a, p) => a + p.lat, 0) / pts.length,
            lon: pts.reduce((a, p) => a + p.lon, 0) / pts.length,
            ...named(tags),
          });
        }
      }
    }
  }
  return { nodes, ways, parkings };
}

/**
 * How long to wait for the main server. It routinely takes 30 to 45 s (queueing for one of
 * its two slots per user, then the query), so a shorter wait gives up on answers that were
 * nearly there. The mirror gets a shorter wait: it rarely answers at all.
 */
export const OVERPASS_TIMEOUT_MS = 75_000;
export const MIRROR_TIMEOUT_MS = 30_000;

export async function fetchOsmArea(
  lat: number,
  lon: number,
  radiusM: number,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = OVERPASS_TIMEOUT_MS,
): Promise<OsmArea> {
  const body = new URLSearchParams({ data: overpassQuery(lat, lon, radiusM) });
  let last: unknown;
  // The main server first, then a mirror if it's busy, slow or down.
  for (const [i, url] of OVERPASS_ENDPOINTS.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      i === 0 ? timeoutMs : Math.min(timeoutMs, MIRROR_TIMEOUT_MS),
    );
    try {
      const res = await fetchImpl(url, { method: 'POST', body, signal: controller.signal });
      if (res.ok) return parseOverpass(await res.json());
      last = new Error(`Overpass ${res.status}`);
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last instanceof Error ? last : new Error('Overpass unavailable');
}
