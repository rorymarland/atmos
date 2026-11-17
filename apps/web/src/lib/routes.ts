/**
 * Walking routes for hills: worked out in a Web Worker (route.worker.ts, falling back to the
 * page where workers aren't available) and saved in IndexedDB so each hill is only routed
 * once a month.
 */
import type { HillRoute } from '@atmos/engine';
import { createStore, get, set } from 'idb-keyval';
import { loadTerrain, searchRoute, type RouteHill } from './route-search';
import type { RouteReply, RouteRequest } from './route.worker';

/** Bump when the route maths changes, so saved routes are worked out again. */
const ROUTE_VERSION = 2;
const KEEP_MS = 30 * 24 * 3_600_000;
/** Failed lookups are retried sooner: OpenStreetMap may have gained a path. */
const KEEP_NONE_MS = 7 * 24 * 3_600_000;

let store: ReturnType<typeof createStore> | null = null;
function idb() {
  try {
    store ??= createStore('atmos-routes', 'routes');
    return store;
  } catch {
    return null;
  }
}

interface Saved {
  at: number;
  route: HillRoute | null;
}

export async function savedRoute(number: number): Promise<HillRoute | null | undefined> {
  const s = idb();
  if (!s) return undefined;
  try {
    const hit = await get<Saved>(`v${ROUTE_VERSION}:${number}`, s);
    if (!hit) return undefined;
    const age = Date.now() - hit.at;
    if (age > (hit.route ? KEEP_MS : KEEP_NONE_MS)) return undefined;
    return hit.route;
  } catch {
    return undefined;
  }
}

async function saveRoute(number: number, route: HillRoute | null) {
  const s = idb();
  if (!s) return;
  try {
    await set(`v${ROUTE_VERSION}:${number}`, { at: Date.now(), route } satisfies Saved, s);
  } catch {
    // Not saved: it'll be worked out again next time.
  }
}

/** Ground height at a point in metres, from the terrain tiles routes use; null if unavailable. */
export async function heightAt(lat: number, lon: number): Promise<number | null> {
  for (const zoom of [12, 11]) {
    try {
      const h = (await loadTerrain(lat, lon, 0.2, zoom))(lat, lon);
      if (h !== null) return Math.round(h);
    } catch {
      // Try the coarser tiles.
    }
  }
  return null;
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (r: HillRoute | null) => void; reject: (e: Error) => void; hill: RouteHill }
>();

/** The route worker, started on first use; null where workers aren't available or it failed. */
function routeWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./route.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return (worker = null);
  }
  worker.onmessage = (e: MessageEvent<RouteReply>) => {
    const job = pending.get(e.data.id);
    if (!job) return;
    pending.delete(e.data.id);
    if ('error' in e.data) job.reject(new Error(e.data.error));
    else job.resolve(e.data.route);
  };
  // The worker itself broke (its script didn't load, say): finish its jobs on the page.
  worker.onerror = (e) => {
    e.preventDefault();
    console.warn('Route worker failed, routing on the page instead:', e.message);
    worker?.terminate();
    worker = null;
    const jobs = [...pending.values()];
    pending.clear();
    for (const job of jobs) searchRoute(job.hill).then(job.resolve, job.reject);
  };
  return worker;
}

function search(hill: RouteHill): Promise<HillRoute | null> {
  const w = routeWorker();
  if (!w) return searchRoute(hill);
  const id = ++nextId;
  const plain = { number: hill.number, lat: hill.lat, lon: hill.lon, metres: hill.metres };
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, hill: plain });
    w.postMessage({ id, hill: plain } satisfies RouteRequest);
  });
}

/**
 * The quickest route up a hill from a car park or road, or null when there isn't one
 * within 15 km (an island, or a hill with no paths and no road near). Throws when the
 * services can't be reached, so a failure isn't saved as "no route".
 */
export async function findRoute(hill: RouteHill): Promise<HillRoute | null> {
  const route = await search(hill);
  await saveRoute(hill.number, route);
  return route;
}
