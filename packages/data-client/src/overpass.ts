/**
 * Paths, roads and car parks around a summit from OpenStreetMap, through the Overpass
 * API: free, keyless and served with CORS. Used on demand (a few hills at a time), which
 * is well within its fair-use guidance.
 */
import type { OsmNode, OsmWay, Parking } from '@atmos/engine';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export interface OsmArea {
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
  parkings: Parking[];
}

/** Every highway and public car park within `radiusM` of a point. */
export function overpassQuery(lat: number, lon: number, radiusM: number): string {
  const around = `around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)}`;
  return `[out:json][timeout:25];(way["highway"](${around});nw["amenity"="parking"](${around}););out body;>;out skel qt;`;
}

interface Element {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

const PRIVATE = new Set(['private', 'no', 'customers']);

export function parseOverpass(json: unknown): OsmArea {
  const elements = ((json as { elements?: Element[] }).elements ?? []) as Element[];
  const nodes = new Map<number, OsmNode>();
  for (const e of elements) {
    if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') {
      nodes.set(e.id, { lat: e.lat, lon: e.lon });
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

export async function fetchOsmArea(
  lat: number,
  lon: number,
  radiusM: number,
  fetchImpl: typeof fetch = fetch,
): Promise<OsmArea> {
  const body = new URLSearchParams({ data: overpassQuery(lat, lon, radiusM) });
  let last: unknown;
  // The main server first, then a mirror if it's busy or down.
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchImpl(url, { method: 'POST', body });
      if (res.ok) return parseOverpass(await res.json());
      last = new Error(`Overpass ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('Overpass unavailable');
}
