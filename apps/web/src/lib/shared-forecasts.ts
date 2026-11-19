/**
 * Forecasts shared by the alerts service (/api/forecasts): fetched once on the NAS for
 * everyone, so each browser doesn't spend its own share of Open-Meteo's daily limit. When
 * the service isn't running, the app fetches from Open-Meteo itself as before.
 */
import type { ModelForecast } from '@atmos/engine';

export type FeedId = 'met' | 'ecmwf' | 'harmonie' | 'horizon' | 'upper';
export const FEED_IDS: FeedId[] = ['met', 'ecmwf', 'harmonie', 'horizon', 'upper'];

export interface FeedInfo {
  version: string;
  fetchedAt: number;
  zones: number;
}

export interface FeedData {
  version: string;
  fetchedAt: number;
  /** Forecasts by zone id (horizon: by `${zoneId}|am` and `${zoneId}|pm`). */
  zones: Record<string, ModelForecast[]>;
}

/** What the service holds, or null when there's no service or nothing fetched yet. */
export async function sharedIndex(): Promise<Partial<Record<FeedId, FeedInfo>> | null> {
  try {
    const res = await fetch('/api/forecasts', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { feeds?: Partial<Record<FeedId, FeedInfo>> };
    return body.feeds?.met ? body.feeds : null;
  } catch {
    return null;
  }
}

/** One feed. The service sends an ETag, so an unchanged feed comes from the browser's cache. */
export async function sharedFeed(id: FeedId): Promise<FeedData> {
  const res = await fetch(`/api/forecasts/${id}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Shared ${id} forecasts: ${res.status}`);
  return (await res.json()) as FeedData;
}
