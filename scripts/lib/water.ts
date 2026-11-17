/**
 * Still water (lochs, lakes, reservoirs, lochans) from OpenStreetMap, boiled down to what
 * Atmos needs: a name, a point on the water, its size, a rough shoreline, and the nearest
 * car park. Built by scripts/build-water.ts on GitHub Actions from the Geofabrik UK
 * extract; the result is committed as data/water/uk-water.json.
 */

/** [lon, lat] as in GeoJSON. */
export type Position = [number, number];
export type Ring = Position[];
/** Outer ring first, then holes (islands). */
export type Polygon = Ring[];

export interface WaterFeature {
  /** OSM type and id, e.g. "w123" or "r456". */
  id: string;
  tags: Record<string, string>;
  polygons: Polygon[];
}

export interface Water {
  id: string;
  name: string;
  /** A point on the water, not on an island or the far side of a bend. */
  lat: number;
  lon: number;
  /** Surface area in hectares. */
  ha: number;
  /** The longest distance across, in km: how far wind can run over it. */
  spanKm: number;
  /** A thinned outer shoreline, [lat, lon] pairs. */
  shore: [number, number][];
}

export interface Parking {
  lat: number;
  lon: number;
  name: string;
}

/** Water types that aren't still water, or not for long. */
const NOT_STILL = new Set([
  'river',
  'riverbank',
  'canal',
  'stream',
  'ditch',
  'drain',
  'wastewater',
  'lock',
  'fish_pass',
  'fishpass',
  'moat',
  'tidal',
  'stream_pool',
  'rapids',
  'basin',
  'swimming_pool',
]);

export const MIN_HECTARES = 1;

/** Still, open water by its tags: natural=water (or the old landuse=reservoir). */
export function isStillWater(tags: Record<string, string>): boolean {
  const water = tags.natural === 'water' || tags.landuse === 'reservoir';
  if (!water) return false;
  if (NOT_STILL.has(tags.water ?? '')) return false;
  if (tags.waterway && tags.waterway !== 'riverbank' && tags.waterway !== 'dam') return false;
  if (tags.intermittent === 'yes' || tags.seasonal === 'yes') return false;
  if (tags.covered === 'yes' || tags.location === 'underground') return false;
  if (tags.leisure === 'swimming_pool') return false;
  return true;
}

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Metres east and north of an origin: fine over the size of a loch. */
function projector(lat0: number, lon0: number) {
  const kx = R * rad(1) * Math.cos(rad(lat0));
  const ky = R * rad(1);
  return (p: Position): [number, number] => [(p[0] - lon0) * kx, (p[1] - lat0) * ky];
}

function ringAreaM2(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(a) / 2;
}

function bounds(polys: Polygon[]) {
  let s = 90;
  let n = -90;
  let w = 180;
  let e = -180;
  for (const poly of polys)
    for (const [lon, lat] of poly[0] ?? []) {
      s = Math.min(s, lat);
      n = Math.max(n, lat);
      w = Math.min(w, lon);
      e = Math.max(e, lon);
    }
  return { s, n, w, e };
}

/** Area in hectares, islands taken out. */
export function areaHectares(polys: Polygon[]): number {
  const b = bounds(polys);
  const proj = projector((b.s + b.n) / 2, (b.w + b.e) / 2);
  let m2 = 0;
  for (const [outer, ...holes] of polys) {
    if (!outer) continue;
    m2 += ringAreaM2(outer.map(proj));
    for (const h of holes) m2 -= ringAreaM2(h.map(proj));
  }
  return Math.max(0, m2) / 10_000;
}

function inRing(x: number, y: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/**
 * A point well inside the water: on a grid over the largest polygon, the point inside it
 * (and outside its islands) furthest from any shore. A centroid can land on land for a
 * crescent loch, which would put its forecast on a hillside.
 */
export function interiorPoint(polys: Polygon[]): { lat: number; lon: number } {
  const b = bounds(polys);
  const lat0 = (b.s + b.n) / 2;
  const lon0 = (b.w + b.e) / 2;
  const proj = projector(lat0, lon0);
  const rings = polys.map((p) => p.map((r) => r.map(proj)));
  const edges = rings.flat();
  const [minX, minY] = proj([b.w, b.s]);
  const [maxX, maxY] = proj([b.e, b.n]);
  const inside = (x: number, y: number) =>
    rings.some(
      ([outer, ...holes]) => outer && inRing(x, y, outer) && !holes.some((h) => inRing(x, y, h)),
    );
  const shoreDist = (x: number, y: number) => {
    let d = Infinity;
    for (const r of edges)
      for (let i = 1; i < r.length; i++) d = Math.min(d, segDist(x, y, r[i - 1]!, r[i]!));
    return d;
  };
  let best: [number, number] | null = null;
  let bestD = -1;
  // Coarse then fine around the best cell.
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  let wx = (maxX - minX) / 2;
  let wy = (maxY - minY) / 2;
  for (let pass = 0; pass < 3; pass++) {
    const N = 12;
    for (let i = 0; i <= N; i++)
      for (let j = 0; j <= N; j++) {
        const x = cx - wx + (2 * wx * i) / N;
        const y = cy - wy + (2 * wy * j) / N;
        if (!inside(x, y)) continue;
        const d = shoreDist(x, y);
        if (d > bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    if (!best) break;
    [cx, cy] = best;
    wx /= 4;
    wy /= 4;
  }
  // Very thin water the grid missed: fall back to the middle of the first outer edge.
  if (!best) {
    const r = polys[0]![0]!;
    const a = r[0]!;
    const c = r[Math.floor(r.length / 2)]!;
    return { lat: (a[1] + c[1]) / 2, lon: (a[0] + c[0]) / 2 };
  }
  const kx = R * rad(1) * Math.cos(rad(lat0));
  const ky = R * rad(1);
  return { lat: lat0 + best[1] / ky, lon: lon0 + best[0] / kx };
}

/** Douglas-Peucker on projected points, tolerance in metres. */
function simplify(pts: [number, number][], tol: number): number[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let farD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(pts[i]![0], pts[i]![1], pts[a]!, pts[b]!);
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return [...keep.keys()].filter((i) => keep[i]);
}

/** At most this many shore points per water: enough to find the nearest bit of shore. */
export const MAX_SHORE_POINTS = 24;

/** The outer shores, thinned to about 60 m detail and capped, as [lat, lon]. */
export function shoreline(polys: Polygon[]): [number, number][] {
  const b = bounds(polys);
  const proj = projector((b.s + b.n) / 2, (b.w + b.e) / 2);
  const out: Position[] = [];
  for (const [outer] of polys) {
    if (!outer || outer.length < 3) continue;
    const kept = simplify(outer.map(proj), 60);
    for (const i of kept) out.push(outer[i]!);
  }
  const step = Math.max(1, Math.ceil(out.length / MAX_SHORE_POINTS));
  return out
    .filter((_, i) => i % step === 0)
    .map(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
}

/** Longest distance between shore points, km. */
export function spanKm(shore: [number, number][]): number {
  let best = 0;
  for (let i = 0; i < shore.length; i++)
    for (let j = i + 1; j < shore.length; j++)
      best = Math.max(best, distanceM(shore[i]!, shore[j]!));
  return Math.round(best / 10) / 100;
}

export function distanceM(a: [number, number], b: [number, number]): number {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A WaterFeature boiled down, or null when it's too small or not still water. */
export function toWater(f: WaterFeature): Water | null {
  if (!isStillWater(f.tags) || f.polygons.length === 0) return null;
  const ha = areaHectares(f.polygons);
  if (ha < MIN_HECTARES) return null;
  const shore = shoreline(f.polygons);
  if (shore.length < 3) return null;
  const p = interiorPoint(f.polygons);
  return {
    id: f.id,
    name: (f.tags.name ?? '').trim(),
    lat: Math.round(p.lat * 1e5) / 1e5,
    lon: Math.round(p.lon * 1e5) / 1e5,
    ha: Math.round(ha * 10) / 10,
    spanKm: spanKm(shore),
    shore,
  };
}

/** GeoJSON geometry (Polygon or MultiPolygon) as a list of polygons. */
export function polygonsOf(geometry: { type: string; coordinates: unknown }): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as Polygon];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Polygon[];
  return [];
}

/** How far a car park may be from the shore and still count as the way in. */
export const MAX_PARKING_M = 1500;

/** A grid index of points for nearest-point lookups across the UK. */
export class PointGrid<T extends { lat: number; lon: number }> {
  #cells = new Map<string, T[]>();
  constructor(
    items: T[],
    readonly cellDeg = 0.02,
  ) {
    for (const it of items) {
      const k = this.#key(it.lat, it.lon);
      const list = this.#cells.get(k);
      if (list) list.push(it);
      else this.#cells.set(k, [it]);
    }
  }
  #key(lat: number, lon: number) {
    return `${Math.floor(lat / this.cellDeg)},${Math.floor(lon / this.cellDeg)}`;
  }
  /** Items within roughly `rings` cells of a point. */
  near(lat: number, lon: number, rings: number): T[] {
    const i0 = Math.floor(lat / this.cellDeg);
    const j0 = Math.floor(lon / this.cellDeg);
    const out: T[] = [];
    for (let i = i0 - rings; i <= i0 + rings; i++)
      for (let j = j0 - rings * 2; j <= j0 + rings * 2; j++)
        out.push(...(this.#cells.get(`${i},${j}`) ?? []));
    return out;
  }
}

/** The car park nearest the shore, within MAX_PARKING_M, and how far it is from the water. */
export function nearestParking(
  w: Water,
  grid: PointGrid<Parking>,
): { parking: Parking; shore: [number, number]; distanceM: number } | null {
  let best: { parking: Parking; shore: [number, number]; distanceM: number } | null = null;
  const seen = new Set<Parking>();
  for (const s of w.shore) {
    for (const p of grid.near(s[0], s[1], 1)) {
      if (seen.has(p)) continue;
      seen.add(p);
      for (const s2 of w.shore) {
        const d = distanceM([p.lat, p.lon], s2);
        if (d <= MAX_PARKING_M && (!best || d < best.distanceM))
          best = { parking: p, shore: s2, distanceM: d };
      }
    }
  }
  return best;
}

/** Car parks the public can use: no private or customers-only ones. */
export function isPublicParking(tags: Record<string, string>): boolean {
  if (tags.amenity !== 'parking') return false;
  return !['private', 'no', 'customers', 'permit', 'delivery'].includes(tags.access ?? '');
}

/**
 * The committed file, compact: one array per water.
 * [id, name, lat, lon, ha, spanKm, shoreFlat[], parkLat?, parkLon?, parkName?, parkShoreIndex?, parkDistM?]
 */
export type WaterRow = [
  string,
  string,
  number,
  number,
  number,
  number,
  number[],
  ...([number, number, string, number, number] | []),
];

export interface WaterFile {
  /** Where and when the OSM data came from. */
  source: string;
  generated: string;
  minHectares: number;
  waters: WaterRow[];
}

export function encodeWater(
  w: Water,
  park: { parking: Parking; shore: [number, number]; distanceM: number } | null,
): WaterRow {
  const flat = w.shore.flat();
  const base: WaterRow = [w.id, w.name, w.lat, w.lon, w.ha, w.spanKm, flat];
  if (!park) return base;
  const idx = w.shore.indexOf(park.shore);
  return [
    ...base.slice(0, 7),
    Math.round(park.parking.lat * 1e5) / 1e5,
    Math.round(park.parking.lon * 1e5) / 1e5,
    park.parking.name,
    idx,
    Math.round(park.distanceM),
  ] as WaterRow;
}

/** Read back a committed row. */
export function decodeWaterRow(row: WaterRow): {
  water: Water;
  parking: { lat: number; lon: number; name: string; shoreIndex: number; distanceM: number } | null;
} {
  const [id, name, lat, lon, ha, span, flat, pLat, pLon, pName, pIdx, pDist] = row as [
    string,
    string,
    number,
    number,
    number,
    number,
    number[],
    number?,
    number?,
    string?,
    number?,
    number?,
  ];
  const shore: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) shore.push([flat[i]!, flat[i + 1]!]);
  return {
    water: { id, name, lat, lon, ha, spanKm: span, shore },
    parking:
      pLat !== undefined && pLon !== undefined
        ? { lat: pLat, lon: pLon, name: pName ?? '', shoreIndex: pIdx ?? -1, distanceM: pDist ?? 0 }
        : null,
  };
}

/** How far a loch's shore can be from a summit and still count as that hill's water. */
export const HILL_WATER_KM = 3;

/**
 * For each hill, the still water whose shore comes within HILL_WATER_KM of the summit,
 * preferring bigger and closer water: a sizeable loch at 2 km beats a 1 ha pool at 1 km.
 * Returns the index into `waters` and the distance to the shore, or null.
 */
export function linkHillsToWater(
  hills: { lat: number; lon: number }[],
  waters: Water[],
): ({ index: number; distanceM: number } | null)[] {
  const pts: { lat: number; lon: number; w: number }[] = [];
  waters.forEach((w, i) => {
    for (const [lat, lon] of w.shore) pts.push({ lat, lon, w: i });
    pts.push({ lat: w.lat, lon: w.lon, w: i });
  });
  const grid = new PointGrid(pts, 0.03);
  return hills.map((h) => {
    const nearestBy = new Map<number, number>();
    for (const p of grid.near(h.lat, h.lon, 2)) {
      const d = distanceM([h.lat, h.lon], [p.lat, p.lon]);
      if (d > HILL_WATER_KM * 1000) continue;
      if (d < (nearestBy.get(p.w) ?? Infinity)) nearestBy.set(p.w, d);
    }
    let best: { index: number; distanceM: number; score: number } | null = null;
    for (const [i, d] of nearestBy) {
      const w = waters[i]!;
      const score = (Math.log(1 + w.ha) * (w.name ? 1.3 : 1)) / (1 + d / 1000);
      if (!best || score > best.score) best = { index: i, distanceM: Math.round(d), score };
    }
    return best ? { index: best.index, distanceM: best.distanceM } : null;
  });
}
