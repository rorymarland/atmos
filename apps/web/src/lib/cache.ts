/** Forecast cache in IndexedDB, falling back to memory where IndexedDB is unavailable. */
import { clear, createStore, get, set } from 'idb-keyval';
import type { CachedForecast, ForecastCache } from '@atmos/data-client';

const memory = new Map<string, CachedForecast>();
let store: ReturnType<typeof createStore> | null = null;

function idb() {
  try {
    store ??= createStore('atmos', 'forecasts');
    return store;
  } catch {
    return null;
  }
}

export const forecastCache: ForecastCache = {
  async get(key) {
    const s = idb();
    if (s) {
      try {
        return (await get<CachedForecast>(key, s)) ?? memory.get(key);
      } catch {
        // Fall through to memory.
      }
    }
    return memory.get(key);
  },
  async set(key, value) {
    memory.set(key, value);
    const s = idb();
    if (s) {
      try {
        await set(key, value, s);
      } catch {
        // Memory copy is enough for this visit.
      }
    }
  },
};

export async function clearForecastCache(): Promise<void> {
  memory.clear();
  const s = idb();
  if (s) await clear(s).catch(() => {});
}

/** Most recent fetch time across cached zones, for the "updated" label offline. */
export function newestFetch(entries: { fetchedAt: number }[]): number | null {
  return entries.length ? Math.max(...entries.map((e) => e.fetchedAt)) : null;
}

/**
 * Ensembles by place, kept an hour: ECMWF's 51 members make one hill's fetch cost about 35
 * of Open-Meteo's daily calls, so reopening a hill (or reloading the page) shouldn't repeat it.
 */
const ensembleMemory = new Map<string, { at: number; value: unknown }>();
let ensembleStore: ReturnType<typeof createStore> | null = null;

export async function cachedEnsemble<T>(
  key: string,
  maxAgeMs: number,
  fetchIt: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  let s: ReturnType<typeof createStore> | null;
  try {
    s = ensembleStore ??= createStore('atmos-ensembles', 'ensembles');
  } catch {
    s = null;
  }
  let hit = ensembleMemory.get(key);
  if (!hit && s) {
    try {
      hit = await get<{ at: number; value: unknown }>(key, s);
    } catch {
      hit = undefined;
    }
  }
  if (hit && now - hit.at < maxAgeMs) return hit.value as T;
  const value = await fetchIt();
  const entry = { at: now, value };
  ensembleMemory.set(key, entry);
  if (s) set(key, entry, s).catch(() => undefined);
  return value;
}
