/**
 * The route search itself: OpenStreetMap paths and car parks (Overpass) plus Mapterhorn
 * terrain, run through the engine. No DOM and no saving, so it runs in the route worker
 * (route.worker.ts) and, where workers aren't available, on the page.
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

export interface RouteHill {
  number: number;
  lat: number;
  lon: number;
  metres: number;
}

/** First look within 8 km; a long walk-in (Ben Alder, say) needs 15. */
const TRIES = [
  // One query that covers most hills' usual starts; a second only when it finds none.
  // Each Overpass query costs 30 to 45 s, so a small first try that often misses is slower.
  { radiusM: 8000, zoom: 11 },
  { radiusM: 15000, zoom: 10 },
];

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

export async function loadTerrain(lat: number, lon: number, radiusKm: number, zoom: number) {
  const wanted = tilesAround(lat, lon, radiusKm, zoom);
  const tiles = await Promise.all(wanted.map((t) => loadTile(t.z, t.x, t.y)));
  return terrainSampler(tiles.filter((t): t is TerrainTile => t !== null));
}

/**
 * The quickest route up a hill from a car park or road, or null when there isn't one
 * within 15 km. Throws when the services can't be reached.
 */
export async function searchRoute(hill: RouteHill): Promise<HillRoute | null> {
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
    if (route) return route;
  }
  return null;
}
