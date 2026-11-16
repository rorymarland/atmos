/**
 * Getting there: rough drive and walk-in times, and working back from the moment you
 * want to be in place to when you need to get up and leave.
 *
 * No free routing service officially allows keyless use from an app, so drive times
 * are estimated from the straight-line distance. They are deliberately simple and
 * labelled as estimates; the Google Maps link gives the real route.
 */
import { distanceMiles, type LatLon } from './geo.js';

const MINUTE = 60_000;

export interface DriveEstimate {
  /** Estimated road distance, miles. */
  roadMiles: number;
  minutes: number;
}

/**
 * Road distance is the straight line times a winding factor; time allows slower roads
 * for the first stretch (towns, A-roads) and faster ones after (motorways, trunk roads).
 * Tuned against typical UK hill trips, e.g. Edinburgh to Ben Lawers about 1 h 50 and to
 * Glen Coe about 2 h 35.
 */
export function estimateDrive(from: LatLon, to: LatLon): DriveEstimate {
  const crow = distanceMiles(from, to);
  const roadMiles = crow * 1.35;
  const slowMiles = Math.min(roadMiles, 20);
  const fastMiles = Math.max(0, roadMiles - 20);
  const minutes = (slowMiles / 35) * 60 + (fastMiles / 48) * 60;
  return { roadMiles, minutes: Math.round(minutes) };
}

export type Pace = 'relaxed' | 'steady' | 'brisk';

const PACE_FACTOR: Record<Pace, number> = { relaxed: 1.25, steady: 1, brisk: 0.85 };

/** Naismith's rule: 5 km/h on the flat, plus 10 minutes per 100 m of ascent. */
export function naismithMinutes(
  distanceKm: number,
  ascentM: number,
  pace: Pace = 'steady',
): number {
  return Math.round(
    ((distanceKm / 5) * 60 + (Math.max(0, ascentM) / 100) * 10) * PACE_FACTOR[pace],
  );
}

/**
 * Walk-in to a summit when the route is unknown: ascent from the valley, and a
 * horizontal distance assuming an average 12% gradient (at least 1.5 km).
 */
export function estimateSummitWalk(
  summitM: number,
  startM: number,
  pace: Pace = 'steady',
): { distanceKm: number; ascentM: number; minutes: number } {
  const ascentM = Math.max(0, summitM - startM);
  const distanceKm = Math.max(1.5, ascentM / 1000 / 0.12);
  return { distanceKm, ascentM, minutes: naismithMinutes(distanceKm, ascentM, pace) };
}

export interface TripInput {
  /** The moment to be in place (e.g. the start of golden hour), epoch ms. */
  target: number;
  driveMinutes: number;
  walkMinutes: number;
  /** Arrive this many minutes before the target. */
  earlyMinutes: number;
  /** Time from getting up to leaving. */
  readyMinutes: number;
}

export interface TripPlan {
  wakeAt: number;
  leaveAt: number;
  /** Arrival by car, when the walk starts. */
  parkAt: number;
  /** In place, a little before the target. */
  arriveAt: number;
  target: number;
}

export function planTrip(t: TripInput): TripPlan {
  const arriveAt = t.target - t.earlyMinutes * MINUTE;
  const parkAt = arriveAt - t.walkMinutes * MINUTE;
  const leaveAt = parkAt - t.driveMinutes * MINUTE;
  const wakeAt = leaveAt - t.readyMinutes * MINUTE;
  return { wakeAt, leaveAt, parkAt, arriveAt, target: t.target };
}

export interface TripLimits {
  /** Don't get up before this instant (epoch ms), or null for no limit. */
  earliestWake: number | null;
  /** Longest acceptable drive, minutes, or null for any. */
  maxDriveMinutes: number | null;
  /** Now: a plan whose departure has passed can't be made. */
  now: number;
}

export type TripProblem = 'too-early' | 'too-far' | 'too-late';

/** Why a plan doesn't fit the limits, or null if it does. Most decisive reason first. */
export function tripProblem(
  plan: TripPlan,
  driveMinutes: number,
  limits: TripLimits,
): TripProblem | null {
  if (limits.maxDriveMinutes !== null && driveMinutes > limits.maxDriveMinutes) return 'too-far';
  if (plan.leaveAt < limits.now) return 'too-late';
  if (limits.earliestWake !== null && plan.wakeAt < limits.earliestWake) return 'too-early';
  return null;
}

/** "1 h 50" or "35 min". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes / 5) * 5);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`;
}
