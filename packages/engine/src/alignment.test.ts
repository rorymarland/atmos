import { describe, expect, it } from 'vitest';
import { bodyAt, destination, elevationAngle, findAlignments } from './alignment.js';

const peak = { lat: 56.8, lon: -5.0, metres: 1000 };
const flat = () => 20;
// A winter day: the sun stays low from rise to set.
const from = Date.UTC(2026, 11, 21, 7);
const to = Date.UTC(2026, 11, 21, 17);

describe('geometry', () => {
  it('goes the right way and the right distance', () => {
    const p = destination(56, -4, 90, 10);
    expect(p.lat).toBeCloseTo(56, 2);
    expect(p.lon).toBeGreaterThan(-4);
    const back = destination(p.lat, p.lon, 270, 10);
    expect(back.lon).toBeCloseTo(-4, 3);
  });
  it('drops distant things below the level line', () => {
    expect(elevationAngle(0, 30)).toBeLessThan(0);
    expect(elevationAngle(1000, 1)).toBeCloseTo(45, 0);
  });
});

describe('lining the sun up with a summit', () => {
  const points = findAlignments({ body: 'sun', peak, from, to, ground: flat });

  it('finds standpoints rising and setting', () => {
    expect(points.some((p) => p.phase === 'rising')).toBe(true);
    expect(points.some((p) => p.phase === 'setting')).toBe(true);
  });
  it('puts the summit at the sun’s height from each standpoint, facing the sun', () => {
    for (const p of points) {
      const seen = elevationAngle(peak.metres - (p.groundM + 1.7), p.distanceKm);
      expect(seen).toBeCloseTo(p.altDeg, 1);
      expect(bodyAt('sun', p.time, p.lat, p.lon).az).toBeCloseTo(p.bearingDeg, 0);
    }
  });
  it('moves closer as the sun climbs', () => {
    const rising = points.filter((p) => p.phase === 'rising');
    expect(rising[0]!.distanceKm).toBeGreaterThan(rising[rising.length - 1]!.distanceKm);
    // Sunrise in December is to the south-east.
    expect(rising[0]!.bearingDeg).toBeGreaterThan(120);
    expect(rising[0]!.bearingDeg).toBeLessThan(150);
  });
  it('knows when nearer ground hides the summit', () => {
    // Winter sun is to the south, so standpoints are north: a 900 m ridge 2 to 4 km north
    // of the summit gives a spot on the ridge, and hides the summit from far behind it.
    const ridge = (lat: number) => (lat > peak.lat + 0.02 && lat < peak.lat + 0.035 ? 900 : 20);
    const both = findAlignments({ body: 'sun', peak, from, to, ground: ridge });
    expect(both.some((p) => !p.blocked && p.distanceKm < 4.5)).toBe(true);
    expect(both.some((p) => p.blocked && p.distanceKm > 5)).toBe(true);
    expect(points.every((p) => !p.blocked)).toBe(true);
  });
  it('finds nothing when the ground is unknown', () => {
    expect(findAlignments({ body: 'sun', peak, from, to, ground: () => null })).toEqual([]);
  });
});
