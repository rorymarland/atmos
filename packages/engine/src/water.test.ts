import { describe, expect, it } from 'vitest';
import { parseScoringConfig } from './config.js';
import {
  configForWater,
  decodeWaterBody,
  encodeWaterBody,
  fetchFactor,
  type WaterBody,
} from './water.js';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const config = parseScoringConfig(
  parse(readFileSync(new URL('../../../config/profiles.yaml', import.meta.url), 'utf8')),
);

describe('water', () => {
  it('loosens wind limits for a lochan and tightens them for a long loch', () => {
    expect(fetchFactor(1)).toBe(1);
    expect(fetchFactor(0.25)).toBeCloseTo(1.3, 2);
    expect(fetchFactor(4)).toBeCloseTo(0.7, 2);
    expect(fetchFactor(40)).toBe(0.6);
    expect(fetchFactor(0.01)).toBe(1.35);
  });

  it('scales only the fetch-scaled factors of that profile', () => {
    const big = configForWater(config, 'reflections', 4);
    const wind = big.profiles.reflections!.factors.wind as { good: number; bad: number };
    const base = config.profiles.reflections!.factors.wind as { good: number; bad: number };
    expect(wind.good).toBeCloseTo(base.good * 0.7, 5);
    expect(big.profiles.reflections!.factors.precipitation).toEqual(
      config.profiles.reflections!.factors.precipitation,
    );
    expect(big.profiles.mist).toBe(config.profiles.mist);
    expect(configForWater(config, 'frozen', 4)).toBe(config);
    expect(config.profiles.frozen!.water).toBeDefined();
  });

  it('round-trips a water row with and without a car park', () => {
    const w: WaterBody = {
      id: 'w1',
      name: 'Loch Ard',
      lat: 56.18,
      lon: -4.47,
      ha: 240,
      spanKm: 4.1,
      zone: 3,
      shore: { lat: 56.17, lon: -4.45 },
      parkings: [
        {
          lat: 56.171,
          lon: -4.449,
          name: 'Loch Ard car park',
          distanceM: 120,
          shore: { lat: 56.17, lon: -4.45 },
        },
      ],
    };
    expect(decodeWaterBody(encodeWaterBody(w))).toEqual(w);
    const bare: WaterBody = { ...w, parkings: [] };
    expect(decodeWaterBody(encodeWaterBody(bare))).toEqual(bare);
  });
});

describe('custom places and water', async () => {
  const { nearestWaterTo } = await import('./places.js');
  const loch = (name: string, lat: number, lon: number, spanKm: number): WaterBody => ({
    id: name,
    name,
    lat,
    lon,
    ha: spanKm * 50,
    spanKm,
    zone: 0,
    shore: { lat, lon },
    parkings: [],
  });
  it('picks the small loch you are standing by over a long one 13 km away', () => {
    const lomond = loch('Loch Lomond', 56.09, -4.62, 36);
    const ard = loch('Loch Ard', 56.177, -4.45, 4);
    const hit = nearestWaterTo({ lat: 56.1807, lon: -4.4626 }, [lomond, ard], 1);
    expect(hit?.index).toBe(1);
  });
  it('finds nothing when no water is near', () => {
    expect(nearestWaterTo({ lat: 55, lon: -3 }, [loch('Far', 57, -5, 2)], 3)).toBeNull();
  });
});
