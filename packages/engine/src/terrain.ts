/**
 * Terrain heights from Terrarium-encoded tiles (Mapterhorn): tile maths and sampling,
 * pure so it can be tested. Decoding the images happens in the browser.
 *
 * Terrarium: height in metres = R * 256 + G + B / 256 - 32768.
 */

/** Tiles are 512 pixels square. */
export const TILE_PX = 512;

export interface TerrainTile {
  z: number;
  x: number;
  y: number;
  /** RGBA, TILE_PX by TILE_PX, as from a canvas. */
  rgba: Uint8ClampedArray;
}

export function terrariumHeight(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Web Mercator position in tile units at zoom z. */
export function tileCoords(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const φ = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n,
  };
}

/** The tiles covering a circle of `radiusKm` around a point. */
export function tilesAround(lat: number, lon: number, radiusKm: number, z: number) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  const a = tileCoords(lat + dLat, lon - dLon, z);
  const b = tileCoords(lat - dLat, lon + dLon, z);
  const out: { z: number; x: number; y: number }[] = [];
  for (let x = Math.floor(a.x); x <= Math.floor(b.x); x++) {
    for (let y = Math.floor(a.y); y <= Math.floor(b.y); y++) out.push({ z, x, y });
  }
  return out;
}

/**
 * A height sampler over loaded tiles, interpolating between pixel centres. Returns null
 * outside them.
 */
export function terrainSampler(tiles: TerrainTile[]): (lat: number, lon: number) => number | null {
  if (tiles.length === 0) return () => null;
  const z = tiles[0]!.z;
  const byKey = new Map(tiles.map((t) => [`${t.x}/${t.y}`, t]));
  const pixel = (gx: number, gy: number): number | null => {
    const tx = Math.floor(gx / TILE_PX);
    const ty = Math.floor(gy / TILE_PX);
    const t = byKey.get(`${tx}/${ty}`);
    if (!t) return null;
    const px = gx - tx * TILE_PX;
    const py = gy - ty * TILE_PX;
    const i = (py * TILE_PX + px) * 4;
    return terrariumHeight(t.rgba[i]!, t.rgba[i + 1]!, t.rgba[i + 2]!);
  };
  return (lat, lon) => {
    const { x, y } = tileCoords(lat, lon, z);
    // Pixel centres sit at half-pixel offsets.
    const u = x * TILE_PX - 0.5;
    const v = y * TILE_PX - 0.5;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const h00 = pixel(x0, y0);
    const h10 = pixel(x0 + 1, y0);
    const h01 = pixel(x0, y0 + 1);
    const h11 = pixel(x0 + 1, y0 + 1);
    if (h00 === null || h10 === null || h01 === null || h11 === null) return h00;
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
  };
}
