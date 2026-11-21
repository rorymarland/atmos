/**
 * Works out the view from a standpoint off the main thread: loading and decoding a few dozen
 * terrain tiles and marching 3,600 rays out to 150 km takes a second or two on a phone.
 */
import { buildPanorama, type Panorama, type PanoramaHill } from '@atmos/engine';
import { loadTerrain } from './route-search';

export interface PanoramaRequest {
  id: number;
  lat: number;
  lon: number;
  eyeM?: number;
  hills: PanoramaHill[];
}

export type PanoramaReply = { id: number; panorama: Panorama } | { id: number; error: string };

/** Finer terrain close in, coarser far out: about 40, 80 and 300 m per pixel. */
const LEVELS = [
  { maxKm: 8, zoom: 11 },
  { maxKm: 40, zoom: 10 },
  { maxKm: 150, zoom: 8 },
];

self.onmessage = async (e: MessageEvent<PanoramaRequest>) => {
  const { id, lat, lon, eyeM, hills } = e.data;
  let reply: PanoramaReply;
  try {
    const samplers = await Promise.all(
      LEVELS.map(async (l) => ({ ...l, at: await loadTerrain(lat, lon, l.maxKm, l.zoom) })),
    );
    // The finest terrain that covers the distance; coarser where it runs out.
    const ground = (la: number, lo: number, km: number): number | null => {
      for (const s of samplers) {
        if (km > s.maxKm) continue;
        const h = s.at(la, lo);
        if (h !== null) return h;
      }
      return null;
    };
    const panorama = buildPanorama({ lat, lon, ground, hills, ...(eyeM ? { eyeM } : {}) });
    reply = { id, panorama };
    // Hand the big arrays over rather than copying them.
    (self as unknown as Worker).postMessage(reply, [
      panorama.skyline.buffer as ArrayBuffer,
      panorama.skylineKm.buffer as ArrayBuffer,
    ]);
    return;
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
