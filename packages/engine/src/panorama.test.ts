import { describe, expect, it } from 'vitest';
import { elevationAngle } from './alignment.js';
import { buildPanorama, joinRidges, skylineAt, type PanoramaHill } from './panorama.js';

const at = { lat: 56.5, lon: -4.5 };
const KM = 111.2;
/** A point `km` north and `east` km east of the standpoint. */
const offset = (north: number, east = 0) => ({
  lat: at.lat + north / KM,
  lon: at.lon + east / (KM * Math.cos((at.lat * Math.PI) / 180)),
});
/** Cone-shaped hills on flat ground at 10 m. */
function cones(list: { lat: number; lon: number; metres: number; radiusKm: number }[]) {
  return (lat: number, lon: number) => {
    let h = 10;
    for (const c of list) {
      const d = Math.hypot(
        (lat - c.lat) * KM,
        (lon - c.lon) * KM * Math.cos((lat * Math.PI) / 180),
      );
      h = Math.max(h, c.metres * (1 - d / c.radiusKm));
    }
    return h;
  };
}

const front = { ...offset(10), metres: 400, radiusKm: 3 };
const hiddenBehind = { ...offset(16), metres: 500, radiusKm: 3 };
const tallBehind = { ...offset(25), metres: 1300, radiusKm: 5 };
const hill = (id: number, name: string, c: { lat: number; lon: number; metres: number }) =>
  ({ id, name, lat: c.lat, lon: c.lon, metres: c.metres }) satisfies PanoramaHill;

describe('the view from a standpoint', () => {
  const p = buildPanorama({
    ...at,
    ground: cones([front, hiddenBehind, tallBehind]),
    stepDeg: 0.5,
    maxKm: 60,
    hills: [hill(1, 'Front', front), hill(2, 'Hidden', hiddenBehind), hill(3, 'Tall', tallBehind)],
  });

  it('puts the skyline on the taller, farther hill when it shows over the near one', () => {
    const tall = elevationAngle(1300 - p.eyeM, 25);
    const near = elevationAngle(400 - p.eyeM, 10);
    expect(tall).toBeGreaterThan(near);
    expect(skylineAt(p, 0)).toBeCloseTo(tall, 1);
    expect(p.skylineKm[0]).toBeGreaterThan(23);
  });

  it('names the hills you can see, not the one hidden behind', () => {
    expect(p.hills.map((h) => h.name).sort()).toEqual(['Front', 'Tall']);
    const tall = p.hills.find((h) => h.name === 'Tall')!;
    expect(tall.azDeg).toBeCloseTo(0, 0);
    expect(tall.km).toBeCloseTo(25, 0);
  });

  it('draws a ridgeline for the near hill in front of the far one', () => {
    const near = p.ridges.find((l) => l.some((c) => c.ray === 0 && Math.abs(c.km - 10) < 1));
    expect(near).toBeDefined();
    expect(near!.length).toBeGreaterThanOrEqual(5);
  });

  it('sees low, flat ground everywhere else', () => {
    expect(skylineAt(p, 180)).toBeLessThan(0.1);
  });
});

describe('a summit standpoint', () => {
  it('uses the summit height given, looking down on lower hills', () => {
    const p = buildPanorama({
      ...at,
      eyeM: 1300,
      ground: cones([{ ...offset(20), metres: 600, radiusKm: 3 }]),
      stepDeg: 1,
      maxKm: 40,
    });
    expect(skylineAt(p, 0)).toBeLessThan(0);
  });
});

describe('joining crests', () => {
  it('follows a crest across rays and drops short scraps', () => {
    const crests = Array.from({ length: 10 }, (_, r) =>
      r < 8 ? [{ altDeg: 2 + r * 0.01, km: 20 }] : [{ altDeg: 5, km: 3 }],
    );
    const lines = joinRidges(crests);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(8);
  });
});

describe('agreeing with Line it up', () => {
  it('shows the sun on the summit from a Line it up spot at its time', async () => {
    const { bodyAt, findAlignments } = await import('./alignment.js');
    const peak = { lat: 56.8, lon: -5.0, metres: 1000 };
    // The same summit as ground: a cone on flat land, so both see the same hill.
    const ground = cones([{ ...peak, radiusKm: 4 }]);
    const from = Date.UTC(2026, 11, 21, 9);
    const spot = findAlignments({ body: 'sun', peak, from, to: from + 2 * 3_600_000, ground })
      .filter((p) => !p.blocked)
      .find((p) => p.distanceKm > 8)!;
    expect(spot).toBeDefined();
    const view = buildPanorama({ lat: spot.lat, lon: spot.lon, ground, maxKm: 60, stepDeg: 0.05 });
    const sun = bodyAt('sun', spot.time, spot.lat, spot.lon);
    // The skyline where the sun is: the summit, within a fraction of the sun's width.
    expect(Math.abs(skylineAt(view, sun.az) - sun.alt)).toBeLessThan(0.15);
  });
});

describe('sharper views', () => {
  // A narrow spike, 40 m across, on a long low ridge 20 km north.
  const spike = (lat: number, lon: number) => {
    const north = (lat - at.lat) * KM;
    const east = (lon - at.lon) * KM * Math.cos((lat * Math.PI) / 180);
    const ridge = Math.abs(north - 20) < 0.5 ? 300 : 10;
    return Math.abs(north - 20.21) < 0.02 && Math.abs(east) < 0.02 ? 700 : ridge;
  };

  it('catches a narrow spike when steps are no longer than a terrain pixel', () => {
    const coarse = buildPanorama({ ...at, ground: spike, stepDeg: 0.05, maxKm: 30 });
    const fine = buildPanorama({
      ...at,
      ground: spike,
      stepDeg: 0.05,
      maxKm: 30,
      resolutionKm: () => 0.02,
    });
    const peak = elevationAngle(700 - fine.eyeM, 20.21);
    expect(skylineAt(fine, 0)).toBeCloseTo(peak, 1);
    expect(skylineAt(coarse, 0)).toBeLessThan(peak - 0.5);
  });

  it('works out a slice that matches the full circle', () => {
    const ground = cones([front, tallBehind]);
    const full = buildPanorama({ ...at, ground, stepDeg: 0.1, maxKm: 60 });
    const slice = buildPanorama({
      ...at,
      ground,
      stepDeg: 0.01,
      maxKm: 60,
      fromAz: 355,
      toAz: 5,
    });
    expect(slice.skyline.length).toBe(1001);
    expect(slice.startAz).toBe(355);
    for (const az of [356, 0, 2.5, 4.9]) {
      expect(skylineAt(slice, az)).toBeCloseTo(skylineAt(full, az), 1);
    }
    expect(Number.isNaN(skylineAt(slice, 90))).toBe(true);
  });

  it('shades steep faces darker than gentle ground, and leaves the sky clear', () => {
    // A cliff: flat at 10 m, then straight up to 400 m at 5 km.
    const cliff = (lat: number) => ((lat - at.lat) * KM > 5 ? 400 : 10);
    const p = buildPanorama({
      ...at,
      ground: cliff,
      stepDeg: 1,
      maxKm: 10,
      resolutionKm: () => 0.02,
      shadeBinDeg: 0.1,
    });
    const s = p.shade!;
    const col = 0;
    const rowOf = (alt: number) => Math.floor((s.altTop - alt) / s.binDeg);
    const face = rowOf(elevationAngle(200 - p.eyeM, 5));
    const flat = rowOf(elevationAngle(10 - p.eyeM, 0.3));
    expect(s.sky[rowOf(p.skyline[0]! + 0.4) * p.skyline.length + col]).toBe(255);
    expect(s.sky[face * p.skyline.length + col]).toBe(0);
    expect(s.steep[face * p.skyline.length + col]).toBeGreaterThan(200);
    expect(s.steep[flat * p.skyline.length + col]).toBeLessThan(30);
  });
});

describe('the fast height sampler', () => {
  it('matches the pixel sampler to within a few centimetres', async () => {
    const { terrainSampler, heightSampler, toHeightTile, tileCoords } =
      await import('./terrain.js');
    const z = 10;
    const t = tileCoords(56.8, -5, z);
    const x = Math.floor(t.x);
    const y = Math.floor(t.y);
    const rgba = new Uint8ClampedArray(512 * 512 * 4);
    for (let i = 0; i < 512 * 512; i++) {
      const v = 500 + 400 * Math.sin(i / 700) + (i % 512) + 32768;
      rgba[i * 4] = Math.floor(v / 256);
      rgba[i * 4 + 1] = Math.floor(v % 256);
      rgba[i * 4 + 2] = Math.floor((v % 1) * 256);
      rgba[i * 4 + 3] = 255;
    }
    const slow = terrainSampler([{ z, x, y, rgba }]);
    const fast = heightSampler([toHeightTile({ z, x, y, rgba })]);
    let worst = 0;
    for (let k = 0; k < 500; k++) {
      const la = 56.76 + (k % 25) * 0.003;
      const lo = -5.08 + Math.floor(k / 25) * 0.008;
      const a = slow(la, lo);
      const b = fast(la, lo);
      if (a !== null && b !== null) worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(0.1);
  });
});
