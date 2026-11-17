import { describe, expect, it } from 'vitest';
import {
  TILE_PX,
  terrainSampler,
  terrariumHeight,
  tileCoords,
  tilesAround,
  type TerrainTile,
} from './terrain.js';

/** Encode a height as Terrarium RGB. */
function encode(h: number): [number, number, number] {
  const v = h + 32768;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, b];
}

/** A tile whose height rises 1 m per pixel eastwards, from `base` at its west edge. */
function rampTile(z: number, x: number, y: number, base: number): TerrainTile {
  const rgba = new Uint8ClampedArray(TILE_PX * TILE_PX * 4);
  for (let py = 0; py < TILE_PX; py++) {
    for (let px = 0; px < TILE_PX; px++) {
      const [r, g, b] = encode(base + px);
      const i = (py * TILE_PX + px) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return { z, x, y, rgba };
}

describe('terrain tiles', () => {
  it('decodes Terrarium colours', () => {
    expect(terrariumHeight(128, 0, 0)).toBe(0);
    expect(terrariumHeight(133, 59, 128)).toBeCloseTo(1339.5);
    const [r, g, b] = encode(1344.25);
    expect(terrariumHeight(r, g, b)).toBeCloseTo(1344.25);
  });

  it('finds the standard Web Mercator tile for Ben Nevis', () => {
    // Ben Nevis at zoom 11: x = (180 - 5.0036) / 360 * 2048 = 995.53, and
    // y = (1 - asinh(tan 56.7969°) / pi) / 2 * 2048 = 629.54.
    const t = tileCoords(56.7969, -5.0036, 11);
    expect(t.x).toBeCloseTo(995.53, 1);
    expect(t.y).toBeCloseTo(629.54, 2);
  });

  it('lists the tiles covering a circle', () => {
    const tiles = tilesAround(56.7969, -5.0036, 5, 11);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    expect(tiles).toContainEqual({ z: 11, x: 995, y: 629 });
  });

  it('interpolates between pixel centres, across a tile edge', () => {
    const z = 11;
    // Two tiles side by side, continuing the ramp: heights equal the global pixel column.
    const lat = 56.79;
    const row = Math.floor(tileCoords(lat, -5, z).y);
    const west = rampTile(z, 995, row, 0);
    const east = rampTile(z, 996, row, TILE_PX);
    const sample = terrainSampler([west, east]);
    // The centre of pixel column 100 in the west tile.
    const n = 2 ** z;
    const lonAt = (gx: number) => (gx / (n * TILE_PX)) * 360 - 180;
    expect(sample(lat, lonAt(995 * TILE_PX + 100.5))).toBeCloseTo(100, 3);
    // Halfway between the last west column and the first east one.
    expect(sample(lat, lonAt(996 * TILE_PX))).toBeCloseTo(511.5, 3);
    // Off the loaded tiles.
    expect(sample(lat, lonAt(1000 * TILE_PX))).toBeNull();
  });
});
