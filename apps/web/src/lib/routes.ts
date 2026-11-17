/**
 * Walking routes for hills, worked out in the browser: OpenStreetMap paths and car parks
 * (Overpass) plus Mapterhorn terrain, run through the engine's route search. Saved in
 * IndexedDB so each hill is only routed once a month.
 */
import {
  TILE_PX,
  routeToSummit,
  terrainSampler,
  tilesAround,
  type HillRoute,
  type TerrainTile,
} from '@atmos/engine';
import { fetchOsmArea } from '@atmos/data-client';
import { createStore, get, set } from 'idb-keyval';

/** Bump when the route maths changes, so saved routes are worked out again. */
const ROUTE_VERSION = 2;
const KEEP_MS = 30 * 24 * 3_600_000;
/** Failed lookups are retried sooner: OpenStreetMap may have gained a path. */
const KEEP_NONE_MS = 7 * 24 * 3_600_000;

/** First look within 8 km; a long walk-in (Ben Alder, say) needs 15. */
const TRIES = [
  // One query that covers most hills' usual starts; a second only when it finds none.
  // Each Overpass query costs 30 to 45 s, so a small first try that often misses is slower.
  { radiusM: 8000, zoom: 11 },
  { radiusM: 15000, zoom: 10 },
];

let store: ReturnType<typeof createStore> | null = null;
function idb() {
  try {
    store ??= createStore('atmos-routes', 'routes');
    return store;
  } catch {
    return null;
  }
}

interface Saved {
  at: number;
  route: HillRoute | null;
}

export async function savedRoute(number: number): Promise<HillRoute | null | undefined> {
  const s = idb();
  if (!s) return undefined;
  try {
    const hit = await get<Saved>(`v${ROUTE_VERSION}:${number}`, s);
    if (!hit) return undefined;
    const age = Date.now() - hit.at;
    if (age > (hit.route ? KEEP_MS : KEEP_NONE_MS)) return undefined;
    return hit.route;
  } catch {
    return undefined;
  }
}

async function saveRoute(number: number, route: HillRoute | null) {
  const s = idb();
  if (!s) return;
  try {
    await set(`v${ROUTE_VERSION}:${number}`, { at: Date.now(), route } satisfies Saved, s);
  } catch {
    // Not saved: it'll be worked out again next time.
  }
}

/** Decodes one Terrarium tile to RGBA pixels, or null where there's no tile (the sea). */
async function loadTile(z: number, x: number, y: number): Promise<TerrainTile | null> {
  const res = await fetch(`https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`);
  if (!res.ok) return null;
  // No colour management or premultiplying: the colours are data, not a picture.
  const bitmap = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  if (bitmap.width !== TILE_PX || bitmap.height !== TILE_PX) {
    throw new Error(`Unexpected terrain tile size ${bitmap.width}`);
  }
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(TILE_PX, TILE_PX)
      : Object.assign(document.createElement('canvas'), { width: TILE_PX, height: TILE_PX });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No canvas to decode terrain');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { z, x, y, rgba: ctx.getImageData(0, 0, TILE_PX, TILE_PX).data };
}

async function loadTerrain(lat: number, lon: number, radiusKm: number, zoom: number) {
  const wanted = tilesAround(lat, lon, radiusKm, zoom);
  const tiles = await Promise.all(wanted.map((t) => loadTile(t.z, t.x, t.y)));
  return terrainSampler(tiles.filter((t): t is TerrainTile => t !== null));
}

/** Ground height at a point in metres, from the terrain tiles routes use; null if unavailable. */
export async function heightAt(lat: number, lon: number): Promise<number | null> {
  for (const zoom of [12, 11]) {
    try {
      const h = (await loadTerrain(lat, lon, 0.2, zoom))(lat, lon);
      if (h !== null) return Math.round(h);
    } catch {
      // Try the coarser tiles.
    }
  }
  return null;
}

/**
 * The quickest route up a hill from a car park or road, or null when there isn't one
 * within 15 km (an island, or a hill with no paths and no road near). Throws when the
 * services can't be reached, so a failure isn't saved as "no route".
 */
export async function findRoute(hill: {
  number: number;
  lat: number;
  lon: number;
  metres: number;
}): Promise<HillRoute | null> {
  for (const t of TRIES) {
    const [osm, elevation] = await Promise.all([
      fetchOsmArea(hill.lat, hill.lon, t.radiusM),
      loadTerrain(hill.lat, hill.lon, t.radiusM / 1000 + 0.5, t.zoom),
    ]);
    const route = routeToSummit({
      summit: { lat: hill.lat, lon: hill.lon, metres: hill.metres },
      ...osm,
      elevation,
    });
    if (route) {
      await saveRoute(hill.number, route);
      return route;
    }
  }
  await saveRoute(hill.number, null);
  return null;
}
