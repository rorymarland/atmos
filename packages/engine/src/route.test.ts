import { describe, expect, it } from 'vitest';
import { distanceKm } from './geo.js';
import {
  pieceMinutes,
  routeToSummit,
  type OsmNode,
  type OsmWay,
  type RouteInput,
} from './route.js';

describe('pieceMinutes (Naismith with Langmuir)', () => {
  it('times the flat at 5 km/h and adds a minute per 10 m of climb', () => {
    expect(pieceMinutes(1, 0)).toBeCloseTo(12);
    expect(pieceMinutes(1, 100)).toBeCloseTo(22);
  });
  it('takes time off gentle descents, but never faster than 6 km/h', () => {
    // 1 km down 100 m is about 5.7 degrees: 12 - 3.3 = 8.7, held at 10 (6 km/h).
    expect(pieceMinutes(1, -100)).toBeCloseTo(10);
    // 2 km down 200 m: 24 - 6.7 = 17.3 by the rule, held at 20 (6 km/h).
    expect(pieceMinutes(2, -200)).toBeCloseTo(20);
    // Below 5 degrees there's no deduction at all.
    expect(pieceMinutes(2, -80)).toBeCloseTo(24);
  });
  it('adds time on steep descents', () => {
    // 200 m down 100 m is about 27 degrees: 2.4 + 3.3.
    expect(pieceMinutes(0.2, -100)).toBeCloseTo(5.73, 1);
  });
  it('leaves very gentle descents alone', () => {
    expect(pieceMinutes(1, -30)).toBeCloseTo(12);
  });
});

/** A cone of a hill: 900 m at the summit, falling 150 m per km to a 100 m plain. */
const SUMMIT = { lat: 56.05, lon: -4.0, metres: 900 };
const cone = (lat: number, lon: number) =>
  Math.max(100, 900 - 150 * distanceKm(SUMMIT, { lat, lon }));

function world(extra: { ways?: OsmWay[]; nodes?: [number, OsmNode][] } = {}): RouteInput {
  const nodes = new Map<number, OsmNode>([
    // A road running east-west along 56.0.
    [1, { lat: 56.0, lon: -4.05 }],
    [2, { lat: 56.0, lon: -4.0 }],
    [3, { lat: 56.0, lon: -3.95 }],
    // A path due north from the road to 0.56 km short of the summit.
    [10, { lat: 56.015, lon: -4.0 }],
    [11, { lat: 56.03, lon: -4.0 }],
    [12, { lat: 56.045, lon: -4.0 }],
    ...(extra.nodes ?? []),
  ]);
  const ways: OsmWay[] = [
    { id: 100, nodes: [1, 2, 3], tags: { highway: 'unclassified' } },
    { id: 101, nodes: [2, 10, 11, 12], tags: { highway: 'path' } },
    ...(extra.ways ?? []),
  ];
  return { summit: SUMMIT, nodes, ways, parkings: [], elevation: cone };
}

describe('routeToSummit', () => {
  it('matches a hand calculation on a cone with a path most of the way', () => {
    const r = routeToSummit(world())!;
    // Path: 5.004 km at 5 km/h is 60.0 min, plus 716.6 m of climb (from where the
    // cone leaves the plain) at 1 min per 10 m is 71.7 min. Then 0.556 km open
    // hillside climbing 83.4 m: (6.67 + 8.34) x 1.5 = 22.5 min. About 154.2 in all.
    expect(r.minutes).toBeGreaterThanOrEqual(153);
    expect(r.minutes).toBeLessThanOrEqual(155);
    expect(r.ascentM).toBeGreaterThanOrEqual(798);
    expect(r.ascentM).toBeLessThanOrEqual(802);
    expect(r.distanceKm).toBeCloseTo(5.56, 1);
    expect(r.offPathKm).toBeCloseTo(0.556, 2);
    expect(r.start).toMatchObject({ lat: 56.0, lon: -4.0, kind: 'road' });
    // Drawn from the start to the summit.
    expect(r.path[0]).toEqual([-4.0, 56.0]);
    expect(r.path.at(-1)).toEqual([SUMMIT.lon, SUMMIT.lat]);
  });

  it('prefers a car park beside the road to the roadside', () => {
    const input = world();
    input.parkings = [{ lat: 56.0005, lon: -4.0005, name: 'Glen car park' }];
    const r = routeToSummit(input)!;
    expect(r.start.kind).toBe('parking');
    expect(r.start.name).toBe('Glen car park');
  });

  it('takes the path rather than the open hillside when the path is quicker', () => {
    const r = routeToSummit(world())!;
    // Straight off-path from the road would be 5.56 km x 1.5: far slower.
    expect(r.offPathKm).toBeLessThan(1);
  });

  it('goes straight up open ground for a pathless hill near a road', () => {
    const input = world();
    input.ways = input.ways.filter((w) => w.id !== 101);
    // A road 2 km south of the summit instead.
    input.nodes.set(20, { lat: 56.032, lon: -4.01 });
    input.nodes.set(21, { lat: 56.032, lon: -3.99 });
    input.ways.push({ id: 102, nodes: [20, 21], tags: { highway: 'unclassified' } });
    const r = routeToSummit(input)!;
    expect(r.offPathKm).toBeCloseTo(r.distanceKm, 5);
    expect(r.distanceKm).toBeLessThan(2.2);
  });

  it('ignores private roads and roads closed to walkers', () => {
    const input = world();
    input.ways[0]!.tags = { highway: 'unclassified', access: 'private' };
    // The path still exists but no public road reaches it.
    expect(routeToSummit(input)).toBeNull();
  });

  it('gives up with no road at all (an island, say)', () => {
    const input = world();
    input.ways = input.ways.filter((w) => w.id === 101);
    expect(routeToSummit(input)).toBeNull();
  });

  it('gives up when most of the terrain is missing', () => {
    const input = world();
    input.elevation = () => null;
    expect(routeToSummit(input)).toBeNull();
  });

  it('is slower on a scramble than on a good path', () => {
    const easy = routeToSummit(world())!;
    const input = world();
    input.ways[1]!.tags = { highway: 'path', sac_scale: 'demanding_mountain_hiking' };
    const hard = routeToSummit(input)!;
    expect(hard.minutes).toBeGreaterThan(easy.minutes * 1.2);
  });
});
