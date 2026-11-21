/**
 * Works out the view from a standpoint off the main thread: loading and decoding terrain
 * tiles and marching rays out to 150 km takes a second or two on a phone. The terrain for
 * the current standpoint is kept, so finer slices for long lenses come back quickly as you
 * turn.
 */
import {
  buildPanorama,
  heightSampler,
  metresPerPixel,
  tilesAround,
  toHeightTile,
  type HeightTile,
  type Panorama,
  type PanoramaHill,
} from '@atmos/engine';
import { loadTile } from './route-search';

export type PanoramaRequest =
  | {
      type: 'view';
      id: number;
      key: string;
      lat: number;
      lon: number;
      eyeM?: number;
      hills: PanoramaHill[];
    }
  | { type: 'slice'; id: number; key: string; fromAz: number; toAz: number; stepDeg: number };

export type PanoramaReply = { id: number; panorama: Panorama } | { id: number; error: string };

/**
 * Finer terrain close in, coarser far out. Zoom 11 is about 21 m a pixel in Scotland, finer
 * than the 30 m data in some places; zoom 10 about 43 m; zoom 8 about 170 m.
 */
const LEVELS = [
  { maxKm: 25, zoom: 11 },
  { maxKm: 60, zoom: 10 },
  { maxKm: 150, zoom: 8 },
];
/** Height bands for the full circle's shading; a slice uses its own ray step. */
const FULL_BIN_DEG = 0.05;

interface Terrain {
  key: string;
  lat: number;
  lon: number;
  eyeM?: number;
  ground: (lat: number, lon: number, km: number) => number | null;
  resolutionKm: (km: number) => number;
}
let terrain: Terrain | null = null;

/** A tile's far corner distance from the standpoint, km: tiles wholly nearer are covered finer. */
function farCornerKm(lat: number, lon: number, z: number, x: number, y: number): number {
  const n = 2 ** z;
  let far = 0;
  for (const [tx, ty] of [
    [x, y],
    [x + 1, y],
    [x, y + 1],
    [x + 1, y + 1],
  ] as const) {
    const lo = (tx / n) * 360 - 180;
    const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
    const d = Math.hypot((la - lat) * 111.2, (lo - lon) * 111.2 * Math.cos((lat * Math.PI) / 180));
    far = Math.max(far, d);
  }
  return far;
}

async function loadLevel(lat: number, lon: number, innerKm: number, maxKm: number, zoom: number) {
  const wanted = tilesAround(lat, lon, maxKm, zoom).filter(
    (t) => farCornerKm(lat, lon, t.z, t.x, t.y) > innerKm,
  );
  const tiles: HeightTile[] = [];
  // A few at a time: kind to the tile server, and pixels are let go as each is decoded.
  for (let i = 0; i < wanted.length; i += 8) {
    const batch = await Promise.all(wanted.slice(i, i + 8).map((t) => loadTile(t.z, t.x, t.y)));
    for (const t of batch) if (t) tiles.push(toHeightTile(t));
  }
  return heightSampler(tiles);
}

async function terrainFor(key: string, lat: number, lon: number, eyeM?: number): Promise<Terrain> {
  if (terrain?.key === key) return terrain;
  terrain = null;
  const samplers: {
    maxKm: number;
    zoom: number;
    px: number;
    at: (lat: number, lon: number) => number | null;
  }[] = [];
  let inner = 0;
  for (const l of LEVELS) {
    samplers.push({
      ...l,
      at: await loadLevel(lat, lon, inner, l.maxKm, l.zoom),
      px: metresPerPixel(lat, l.zoom) / 1000,
    });
    inner = l.maxKm;
  }
  const ground = (la: number, lo: number, km: number): number | null => {
    for (const s of samplers) {
      if (km > s.maxKm) continue;
      const h = s.at(la, lo);
      if (h !== null) return h;
    }
    return null;
  };
  const resolutionKm = (km: number) =>
    (samplers.find((s) => km <= s.maxKm) ?? samplers[samplers.length - 1]!).px;
  terrain = { key, lat, lon, ground, resolutionKm, ...(eyeM ? { eyeM } : {}) };
  return terrain;
}

function send(id: number, panorama: Panorama) {
  const buffers: ArrayBuffer[] = [
    panorama.skyline.buffer as ArrayBuffer,
    panorama.skylineKm.buffer as ArrayBuffer,
  ];
  if (panorama.shade) {
    buffers.push(
      panorama.shade.steep.buffer as ArrayBuffer,
      panorama.shade.dist.buffer as ArrayBuffer,
      panorama.shade.sky.buffer as ArrayBuffer,
    );
  }
  // Hand the big arrays over rather than copying them.
  (self as unknown as Worker).postMessage({ id, panorama } satisfies PanoramaReply, buffers);
}

self.onmessage = async (e: MessageEvent<PanoramaRequest>) => {
  const m = e.data;
  try {
    if (m.type === 'view') {
      const t = await terrainFor(m.key, m.lat, m.lon, m.eyeM);
      const panorama = buildPanorama({
        lat: t.lat,
        lon: t.lon,
        ground: t.ground,
        resolutionKm: t.resolutionKm,
        hills: m.hills,
        shadeBinDeg: FULL_BIN_DEG,
        ...(t.eyeM ? { eyeM: t.eyeM } : {}),
      });
      send(m.id, panorama);
    } else {
      const t = terrain;
      if (!t || t.key !== m.key) throw new Error('No terrain for that view');
      const panorama = buildPanorama({
        lat: t.lat,
        lon: t.lon,
        ground: t.ground,
        resolutionKm: t.resolutionKm,
        fromAz: m.fromAz,
        toAz: m.toAz,
        stepDeg: m.stepDeg,
        shadeBinDeg: m.stepDeg,
        ...(t.eyeM ? { eyeM: t.eyeM } : {}),
      });
      send(m.id, panorama);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id: m.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies PanoramaReply);
  }
};
