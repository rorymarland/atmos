/**
 * Walking routes up a hill: from a car park (or the roadside) along OpenStreetMap paths
 * to the summit, timed with Naismith's rule and Langmuir's corrections on the real
 * height profile.
 *
 * Pure: the caller supplies the paths and a terrain sampler, so this runs in tests and
 * the browser alike.
 *
 * Timing (per piece of about 40 m, the way UK mountain leaders are taught):
 * - 5 km/h on the flat, plus 1 minute per 10 m of climb (Naismith).
 * - Downhill (Langmuir): gentle slopes of 5 to 12 degrees take 10 minutes off per 300 m
 *   of descent, but never faster than 6 km/h (unclamped, the rule would have you
 *   descending a 10 degree slope at nearly 10 km/h); steeper than 12 degrees adds 10
 *   minutes per 300 m.
 * - Rough or faint paths are 1.3 times slower, scrambles 1.6, open hillside 1.5.
 * The walker's pace setting scales the total afterwards.
 */
import { distanceKm, type LatLon } from './geo.js';

export interface OsmNode {
  lat: number;
  lon: number;
}

export interface OsmWay {
  id: number;
  nodes: number[];
  tags: Record<string, string>;
}

export interface Parking extends LatLon {
  name?: string;
}

/** Ground height in metres at a point, or null where the terrain isn't loaded. */
export type ElevationSampler = (lat: number, lon: number) => number | null;

export interface RouteInput {
  summit: LatLon & { metres: number };
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
  parkings: Parking[];
  elevation: ElevationSampler;
}

export interface HillRoute {
  /** Where the walk starts. */
  start: LatLon & { kind: 'parking' | 'road'; name?: string };
  /** Start to summit, [lon, lat] pairs for drawing. */
  path: [number, number][];
  distanceKm: number;
  ascentM: number;
  /** Of the distance, how much is off any path. */
  offPathKm: number;
  /** Time up at a steady pace, minutes. */
  minutes: number;
}

/** Roads a car can reach: their nodes are possible starts. */
const CAR_ROADS = new Set([
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'road',
]);
/** Not for walking. */
const NO_FOOT = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'construction',
  'proposed',
  'raceway',
  'bus_guideway',
  'abandoned',
]);
const CLOSED = new Set(['no', 'private']);
const FOOT_OK = new Set(['yes', 'designated', 'permissive']);

/** A start costs this much extra at the roadside, so a nearby car park wins a near tie. */
export const ROADSIDE_PENALTY_MIN = 8;
/** Open hillside is this much slower than a path. */
export const OFF_PATH_FACTOR = 1.5;
/** Pieces of each path segment the profile is sampled at, metres. */
const PIECE_M = 40;
/** Summit links: nearby path nodes, else further nodes for a pathless hill. */
const SUMMIT_NEAR_M = 600;
const SUMMIT_FAR_M = 3000;
/** Car parks this close to a path or road join the network. */
const PARKING_LINK_M = 250;

export function isWalkable(tags: Record<string, string>): boolean {
  const hw = tags.highway;
  if (!hw || NO_FOOT.has(hw)) return false;
  if (tags.foot && CLOSED.has(tags.foot)) return false;
  if (tags.access && CLOSED.has(tags.access) && !FOOT_OK.has(tags.foot ?? '')) return false;
  return true;
}

/** Whether a car can get here, so a walk could start from it. */
export function isCarRoad(tags: Record<string, string>): boolean {
  const hw = tags.highway;
  if (!hw || !CAR_ROADS.has(hw)) return false;
  if (tags.access && CLOSED.has(tags.access)) return false;
  if (tags.motor_vehicle && CLOSED.has(tags.motor_vehicle)) return false;
  if (tags.motorcar && CLOSED.has(tags.motorcar)) return false;
  // Private drives and the like.
  if (hw === 'service' && (tags.service === 'driveway' || tags.service === 'emergency_access')) {
    return false;
  }
  return true;
}

/** How much slower than a good path: scrambles, rough ground and faint trails. */
export function pathFactor(tags: Record<string, string>): number {
  const sac = tags.sac_scale ?? '';
  const vis = tags.trail_visibility ?? '';
  let f = 1;
  if (sac === 'demanding_mountain_hiking') f = Math.max(f, 1.3);
  if (sac.includes('alpine')) f = Math.max(f, 1.6);
  if (vis === 'bad' || vis === 'horrible' || vis === 'no') f = Math.max(f, 1.3);
  return f;
}

/**
 * Minutes to walk one piece: Naismith up, Langmuir down.
 * @param km horizontal length
 * @param dh height change in metres, positive uphill
 */
export function pieceMinutes(km: number, dh: number): number {
  const flat = (km / 5) * 60;
  if (dh >= 0) return flat + dh / 10;
  const drop = -dh;
  const degrees = (Math.atan(drop / Math.max(1e-6, km * 1000)) * 180) / Math.PI;
  if (degrees > 12) return flat + drop / 30;
  if (degrees >= 5) return Math.max((km / 6) * 60, flat - drop / 30);
  return flat;
}

interface Profile {
  /** Minutes from a to b, and from b to a. */
  ab: number;
  ba: number;
  km: number;
  /** Climb from a to b and from b to a, metres. */
  upAb: number;
  upBa: number;
  /** Pieces with no terrain. */
  missing: number;
  pieces: number;
}

/** Times both ways along a straight segment, sampling the terrain every 40 m or so. */
function profile(a: LatLon, b: LatLon, factor: number, elevation: ElevationSampler): Profile {
  const km = distanceKm(a, b);
  const n = Math.max(1, Math.ceil((km * 1000) / PIECE_M));
  const heights: (number | null)[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    heights.push(elevation(a.lat + (b.lat - a.lat) * t, a.lon + (b.lon - a.lon) * t));
  }
  let ab = 0;
  let ba = 0;
  let upAb = 0;
  let upBa = 0;
  let missing = 0;
  const pieceKm = km / n;
  for (let i = 0; i < n; i++) {
    const h0 = heights[i];
    const h1 = heights[i + 1];
    let dh = 0;
    if (h0 === null || h1 === null || h0 === undefined || h1 === undefined) missing++;
    else dh = h1 - h0;
    ab += pieceMinutes(pieceKm, dh) * factor;
    ba += pieceMinutes(pieceKm, -dh) * factor;
    if (dh > 0) upAb += dh;
    else upBa -= dh;
  }
  return { ab, ba, km, upAb, upBa, missing, pieces: n };
}

interface Edge {
  to: number;
  /** Minutes to walk from `to` towards this node (the search runs from the summit). */
  minutes: number;
  km: number;
  climb: number;
  offPath: boolean;
}

/** A small binary heap of [cost, node]. */
class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, node: number) {
    const a = this.items;
    a.push([cost, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

const SUMMIT = -1;

/**
 * The quickest way up from any car park or road, or null when none can be reached (an
 * island with no road, say) or the terrain is missing for most of the way.
 */
export function routeToSummit(input: RouteInput): HillRoute | null {
  const { summit, nodes, ways, parkings, elevation } = input;

  // Reverse graph: edges point towards the summit side of each segment, so one search
  // from the summit finds the quickest walk up from every node.
  const adj = new Map<number, Edge[]>();
  const add = (from: number, e: Edge) => {
    let list = adj.get(from);
    if (!list) adj.set(from, (list = []));
    list.push(e);
  };
  const points = new Map<number, LatLon>();
  const starts = new Map<number, { kind: 'parking' | 'road'; name?: string }>();
  let missing = 0;
  let pieces = 0;

  for (const way of ways) {
    if (!isWalkable(way.tags)) continue;
    const factor = pathFactor(way.tags);
    const car = isCarRoad(way.tags);
    for (let i = 0; i + 1 < way.nodes.length; i++) {
      const ia = way.nodes[i]!;
      const ib = way.nodes[i + 1]!;
      const a = nodes.get(ia);
      const b = nodes.get(ib);
      if (!a || !b) continue;
      points.set(ia, a);
      points.set(ib, b);
      const p = profile(a, b, factor, elevation);
      missing += p.missing;
      pieces += p.pieces;
      // Walking b to a means relaxing from a to b in the reverse search, and vice versa.
      add(ia, { to: ib, minutes: p.ba, km: p.km, climb: p.upBa, offPath: false });
      add(ib, { to: ia, minutes: p.ab, km: p.km, climb: p.upAb, offPath: false });
    }
    if (car) {
      for (const id of way.nodes)
        if (nodes.has(id) && !starts.has(id)) starts.set(id, { kind: 'road' });
    }
  }

  // Car parks join the network by their nearest path or road node.
  let nextId = -2;
  for (const park of parkings) {
    const near = nearest(points, park, PARKING_LINK_M, 1)[0];
    if (!near) continue;
    const id = nextId--;
    points.set(id, park);
    const p = profile(park, points.get(near)!, OFF_PATH_FACTOR, elevation);
    // From the car park to the network: walk park -> near, relaxed from near.
    add(near, { to: id, minutes: p.ab, km: p.km, climb: p.upAb, offPath: true });
    starts.set(id, { kind: 'parking', ...(park.name ? { name: park.name } : {}) });
  }

  // The summit joins nearby paths across open ground; a pathless hill joins further
  // nodes, including roads, straight across the hillside.
  points.set(SUMMIT, summit);
  let links = nearest(points, summit, SUMMIT_NEAR_M, 8);
  if (links.length === 0) links = nearest(points, summit, SUMMIT_FAR_M, 40);
  for (const id of links) {
    if (id === SUMMIT) continue;
    const p = profile(points.get(id)!, summit, OFF_PATH_FACTOR, elevation);
    add(SUMMIT, { to: id, minutes: p.ab, km: p.km, climb: p.upAb, offPath: true });
  }
  if (starts.size === 0 || links.length === 0) return null;
  if (pieces > 0 && missing / pieces > 0.2) return null;

  // Dijkstra from the summit.
  const dist = new Map<number, number>([[SUMMIT, 0]]);
  const via = new Map<number, { from: number; edge: Edge }>();
  const heap = new Heap();
  heap.push(0, SUMMIT);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > (dist.get(u) ?? Infinity)) continue;
    for (const e of adj.get(u) ?? []) {
      const nd = d + e.minutes;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        via.set(e.to, { from: u, edge: e });
        heap.push(nd, e.to);
      }
    }
  }

  // The best start: quickest walk, with a little extra for parking at the roadside.
  let best: number | null = null;
  let bestCost = Infinity;
  for (const [id, s] of starts) {
    const d = dist.get(id);
    if (d === undefined) continue;
    const cost = d + (s.kind === 'road' ? ROADSIDE_PENALTY_MIN : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = id;
    }
  }
  if (best === null) return null;

  // Walk the chain back to the summit, which is the walking direction.
  const path: [number, number][] = [];
  let km = 0;
  let offPathKm = 0;
  let climb = 0;
  let cur = best;
  for (;;) {
    const pt = points.get(cur)!;
    path.push([pt.lon, pt.lat]);
    const step = via.get(cur);
    if (!step) break;
    km += step.edge.km;
    climb += step.edge.climb;
    if (step.edge.offPath) offPathKm += step.edge.km;
    cur = step.from;
  }

  // Terrain models round summits off: add the last few metres to the published height.
  const top = elevation(summit.lat, summit.lon);
  const shortfall = top === null ? 0 : Math.max(0, summit.metres - top);
  const startInfo = starts.get(best)!;
  const startPt = points.get(best)!;
  return {
    start: { lat: startPt.lat, lon: startPt.lon, ...startInfo },
    path,
    distanceKm: km,
    ascentM: Math.round(climb + shortfall),
    offPathKm,
    minutes: Math.round(dist.get(best)! + shortfall / 10),
  };
}

/** Up to `k` point ids within `maxM` metres of `p`, nearest first. */
function nearest(points: Map<number, LatLon>, p: LatLon, maxM: number, k: number): number[] {
  const found: [number, number][] = [];
  const maxKm = maxM / 1000;
  // A cheap box test before the proper distance.
  const dLat = maxKm / 111;
  const dLon = maxKm / (111 * Math.cos((p.lat * Math.PI) / 180));
  for (const [id, q] of points) {
    if (id === SUMMIT) continue;
    if (Math.abs(q.lat - p.lat) > dLat || Math.abs(q.lon - p.lon) > dLon) continue;
    const d = distanceKm(p, q);
    if (d <= maxKm) found.push([d, id]);
  }
  return found
    .sort((a, b) => a[0] - b[0])
    .slice(0, k)
    .map(([, id]) => id);
}
