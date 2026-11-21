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

/** A tile decoded to heights in decimetres: a quarter of the memory of its pixels. */
export interface HeightTile {
  z: number;
  x: number;
  y: number;
  /** TILE_PX by TILE_PX, decimetres (±3,276 m covers the UK). */
  dm: Int16Array;
}

/** Decodes a Terrarium tile's pixels to decimetres, so the pixels can be let go. */
export function toHeightTile(t: TerrainTile): HeightTile {
  const n = TILE_PX * TILE_PX;
  const dm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const h = terrariumHeight(t.rgba[i * 4]!, t.rgba[i * 4 + 1]!, t.rgba[i * 4 + 2]!);
    dm[i] = Math.max(-32768, Math.min(32767, Math.round(h * 10)));
  }
  return { z: t.z, x: t.x, y: t.y, dm };
}

/**
 * Like terrainSampler, over decoded height tiles, built for speed: the viewer asks millions
 * of times. Tiles sit in a plain grid (no text keys), and the four neighbouring pixels are
 * read straight from one tile unless they straddle an edge.
 */
export function heightSampler(tiles: HeightTile[]): (lat: number, lon: number) => number | null {
  if (tiles.length === 0) return () => null;
  const z = tiles[0]!.z;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    minX = Math.min(minX, t.x);
    minY = Math.min(minY, t.y);
    maxX = Math.max(maxX, t.x);
    maxY = Math.max(maxY, t.y);
  }
  const w = maxX - minX + 1;
  const grid: (Int16Array | undefined)[] = new Array(w * (maxY - minY + 1));
  for (const t of tiles) grid[(t.y - minY) * w + (t.x - minX)] = t.dm;
  const h = maxY - minY + 1;
  const pixel = (gx: number, gy: number): number | null => {
    const tx = Math.floor(gx / TILE_PX) - minX;
    const ty = Math.floor(gy / TILE_PX) - minY;
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
    const dm = grid[ty * w + tx];
    if (!dm) return null;
    return dm[(gy - (ty + minY) * TILE_PX) * TILE_PX + (gx - (tx + minX) * TILE_PX)]! / 10;
  };
  const n = 2 ** z * TILE_PX;
  // The Mercator y for each latitude the tiles span, every 0.0005° (a few metres), so a
  // lookup interpolates instead of taking a logarithm and a tangent.
  const latOf = (ty: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / 2 ** z))) * 180) / Math.PI;
  const latTop = latOf(minY);
  const latBottom = latOf(maxY + 1);
  const STEP = 0.0005;
  const count = Math.ceil((latTop - latBottom) / STEP) + 2;
  const yAt = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const φ = ((latBottom + i * STEP) * Math.PI) / 180;
    yAt[i] = ((1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2) * n - 0.5;
  }
  return (lat, lon) => {
    const f = (lat - latBottom) / STEP;
    if (f < 0 || f >= count - 1) return null;
    const i0 = Math.floor(f);
    const u = ((lon + 180) / 360) * n - 0.5;
    const v = yAt[i0]! + (yAt[i0 + 1]! - yAt[i0]!) * (f - i0);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const px = x0 % TILE_PX;
    const py = y0 % TILE_PX;
    // The usual case: all four pixels in one tile.
    if (px < TILE_PX - 1 && py < TILE_PX - 1) {
      const tx = Math.floor(x0 / TILE_PX) - minX;
      const ty = Math.floor(y0 / TILE_PX) - minY;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) return null;
      const dm = grid[ty * w + tx];
      if (!dm) return null;
      const i = py * TILE_PX + px;
      return (
        (dm[i]! * (1 - fx) * (1 - fy) +
          dm[i + 1]! * fx * (1 - fy) +
          dm[i + TILE_PX]! * (1 - fx) * fy +
          dm[i + TILE_PX + 1]! * fx * fy) /
        10
      );
    }
    const h00 = pixel(x0, y0);
    const h10 = pixel(x0 + 1, y0);
    const h01 = pixel(x0, y0 + 1);
    const h11 = pixel(x0 + 1, y0 + 1);
    if (h00 === null || h10 === null || h01 === null || h11 === null) return h00;
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
  };
}

/** Ground metres per pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, z: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (TILE_PX * 2 ** z);
}
