/**
 * Works out walking routes off the main thread: decoding terrain and searching a dense
 * path network can take seconds, which would otherwise freeze the map and panel.
 */
import { searchRoute, type RouteHill } from './route-search';

export interface RouteRequest {
  id: number;
  hill: RouteHill;
}

export type RouteReply =
  { id: number; route: import('@atmos/engine').HillRoute | null } | { id: number; error: string };

self.onmessage = async (e: MessageEvent<RouteRequest>) => {
  const { id, hill } = e.data;
  let reply: RouteReply;
  try {
    reply = { id, route: await searchRoute(hill) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
