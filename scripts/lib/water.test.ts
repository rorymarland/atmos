import { describe, expect, it } from 'vitest';
import {
  areaHectares,
  encodeWater,
  interiorPoint,
  isPublicParking,
  isStillWater,
  linkHillsToWater,
  nearestParking,
  PointGrid,
  shoreline,
  toWater,
  type Polygon,
} from './water.js';

/** A square of `m` metres a side at a latitude, as [lon, lat]. */
function square(lat: number, lon: number, m: number): Polygon {
  const dLat = m / 111_195;
  const dLon = m / (111_195 * Math.cos((lat * Math.PI) / 180));
  return [
    [
      [lon, lat],
      [lon + dLon, lat],
      [lon + dLon, lat + dLat],
      [lon, lat + dLat],
      [lon, lat],
    ],
  ];
}

describe('water', () => {
  it('keeps lochs and reservoirs, not rivers or pools', () => {
    expect(isStillWater({ natural: 'water' })).toBe(true);
    expect(isStillWater({ natural: 'water', water: 'loch' })).toBe(true);
    expect(isStillWater({ landuse: 'reservoir' })).toBe(true);
    expect(isStillWater({ natural: 'water', water: 'river' })).toBe(false);
    expect(isStillWater({ natural: 'water', water: 'canal' })).toBe(false);
    expect(isStillWater({ natural: 'water', intermittent: 'yes' })).toBe(false);
    expect(isStillWater({ natural: 'water', leisure: 'swimming_pool' })).toBe(false);
    expect(isStillWater({ natural: 'wood' })).toBe(false);
  });

  it('measures area in hectares, less islands', () => {
    const sq = square(56.2, -4.4, 200); // 4 ha
    expect(areaHectares([sq])).toBeCloseTo(4, 1);
    const island = square(56.2005, -4.3985, 100)[0]!; // 1 ha inside it
    expect(areaHectares([[sq[0]!, island]])).toBeCloseTo(3, 1);
  });

  it('puts the interior point on the water, not on a crescent’s inner shore', () => {
    // An L shape: the bbox centre is outside it.
    const lat = 56;
    const lon = -4;
    const d = 0.01;
    const L: Polygon = [
      [
        [lon, lat],
        [lon + 3 * d, lat],
        [lon + 3 * d, lat + d],
        [lon + d, lat + d],
        [lon + d, lat + 3 * d],
        [lon, lat + 3 * d],
        [lon, lat],
      ],
    ];
    const p = interiorPoint([L]);
    const inArmX = p.lon > lon && p.lon < lon + d && p.lat > lat && p.lat < lat + 3 * d;
    const inArmY = p.lat > lat && p.lat < lat + d && p.lon > lon && p.lon < lon + 3 * d;
    expect(inArmX || inArmY).toBe(true);
  });

  it('thins the shore and caps it', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i <= 400; i++) {
      const a = (i / 400) * 2 * Math.PI;
      ring.push([-4 + 0.05 * Math.cos(a), 56 + 0.03 * Math.sin(a)]);
    }
    const shore = shoreline([[ring]]);
    expect(shore.length).toBeGreaterThan(8);
    expect(shore.length).toBeLessThanOrEqual(25);
    expect(shore[0]![0]).toBeCloseTo(56, 1);
  });

  it('drops water under a hectare and builds a row with the nearest car park', () => {
    expect(
      toWater({ id: 'w1', tags: { natural: 'water' }, polygons: [square(56, -4, 50)] }),
    ).toBeNull();
    const w = toWater({
      id: 'w2',
      tags: { natural: 'water', name: 'Loch Test' },
      polygons: [square(56, -4, 600)],
    })!;
    expect(w.name).toBe('Loch Test');
    expect(w.ha).toBeCloseTo(36, 0);
    expect(w.spanKm).toBeGreaterThan(0.6);
    const near = { lat: 55.999, lon: -4, name: 'Shore car park' };
    const far = { lat: 55.95, lon: -4, name: 'Too far' };
    const park = nearestParking(w, new PointGrid([near, far]));
    expect(park?.parking.name).toBe('Shore car park');
    expect(park!.distanceM).toBeLessThan(200);
    const row = encodeWater(w, park);
    expect(row[0]).toBe('w2');
    expect(row[9]).toBe('Shore car park');
    expect(encodeWater(w, null)).toHaveLength(7);
  });

  it('skips private car parks', () => {
    expect(isPublicParking({ amenity: 'parking' })).toBe(true);
    expect(isPublicParking({ amenity: 'parking', access: 'private' })).toBe(false);
    expect(isPublicParking({ amenity: 'parking', access: 'customers' })).toBe(false);
  });

  it('links a hill to sizeable nearby water over a closer pool', () => {
    const loch = toWater({
      id: 'w1',
      tags: { natural: 'water', name: 'Loch Big' },
      polygons: [square(56.01, -4, 1500)],
    })!;
    const pool = toWater({
      id: 'w2',
      tags: { natural: 'water' },
      polygons: [square(56.0, -4.012, 110)],
    })!;
    const far = toWater({
      id: 'w3',
      tags: { natural: 'water', name: 'Far' },
      polygons: [square(56.2, -4, 1500)],
    })!;
    const [hit, none] = linkHillsToWater(
      [
        { lat: 56.0, lon: -4.01 },
        { lat: 56.5, lon: -4 },
      ],
      [pool, loch, far],
    );
    expect(hit?.index).toBe(1);
    expect(hit!.distanceM).toBeGreaterThan(500);
    expect(hit!.distanceM).toBeLessThan(3000);
    expect(none).toBeNull();
  });
});
