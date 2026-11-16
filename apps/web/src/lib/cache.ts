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
