/**
 * Planning a hill walk: when to set off so the whole time on the hill, up and down, gets
 * the best of the day's weather, and back down before the light goes.
 *
 * Walking is scored hour by hour across the whole span from before first light to after
 * dark (`walkSpan`); `chooseWalk` then tries each start time and judges only the hours of
 * that walk, so the verdict is for the walk you'd actually do.
 */
import {
  rescoreTarget,
  type EvaluateOptions,
  type Period,
  type ScoringConfig,
  type TargetResult,
  type TimeWindow,
} from '@atmos/engine';
import type { LightWindow, SunTimes } from './sun';

/** "best" for the best weather, or a set time ("09:30"). */
export type WalkStart = 'best' | string;
/** Be back at the car before sunset, before the end of civil twilight, or whenever. */
export type DownBy = 'sunset' | 'dark' | 'any';

export const DOWN_BY_LABELS: Record<DownBy, string> = {
  sunset: 'Before sunset',
  dark: 'Before dark',
  any: 'Any time',
};

/** The parts of the day a walk can be in. Night walks aren't planned. */
export const WALK_PERIODS: Period[] = ['morning', 'day', 'evening'];

/** A rest at the top, in the round trip. */
export const SUMMIT_STOP_MINUTES = 15;

const MIN = 60_000;
const HOUR = 60 * MIN;
const STEP = 30 * MIN;

interface Light {
  dawn: number;
  sunrise: number;
  sunset: number;
  dusk: number;
}

function light(sun: SunTimes, dayStart: number): Light {
  const sunrise = sun.sunrise ?? dayStart + 8 * HOUR;
  const sunset = sun.sunset ?? dayStart + 16 * HOUR;
  return {
    sunrise,
    sunset,
    dawn: sun.civilDawn ?? sunrise - HOUR,
    dusk: sun.civilDusk ?? sunset + HOUR,
  };
}

const floorTo = (t: number, step: number) => Math.floor(t / step) * step;
const ceilTo = (t: number, step: number) => Math.ceil(t / step) * step;

/** Every hour a walk might use: from an hour before first light to three hours after dark. */
export function walkSpan(sun: SunTimes, dayStart: number): TimeWindow {
  const l = light(sun, dayStart);
  return { start: floorTo(l.dawn - HOUR, HOUR), end: l.dusk + 3 * HOUR };
}

/**
 * The hours judged when there's no walk to plan around (alerts, and before "Your trip" has
 * a walk time): a typical five-hour walk in each part of the day.
 */
export function defaultWalkWindow(period: Period, sun: SunTimes, dayStart: number): LightWindow {
  const l = light(sun, dayStart);
  switch (period) {
    case 'morning':
      return { start: floorTo(l.dawn, HOUR), end: l.dawn + 5 * HOUR, label: 'From first light' };
    case 'evening':
      return { start: floorTo(l.sunset - 5 * HOUR, HOUR), end: l.sunset, label: 'Down by sunset' };
    default:
      return {
        start: floorTo(Math.max(l.sunrise, dayStart + 9 * HOUR), HOUR),
        end: Math.min(l.sunset, dayStart + 16 * HOUR),
        label: 'Daylight, 09:00 to 16:00',
      };
  }
}

export interface WalkInput {
  /** Walking scored across `walkSpan`. */
  span: TargetResult;
  /** The parts of the day the walk may be in (any of morning, day, evening). */
  periods: Period[];
  sun: SunTimes;
  dayStart: number;
  upMinutes: number;
  downMinutes: number;
  start: WalkStart;
  downBy: DownBy;
  /** No walk starts before this: now, or the earliest you could be at the car. */
  notBefore: number;
  config: ScoringConfig;
  options: EvaluateOptions;
}

export interface WalkPlan {
  period: Period;
  /** Setting off from the car. */
  start: number;
  summitAt: number;
  /** Back at the car. */
  end: number;
  window: LightWindow;
  result: TargetResult;
  /**
   * Coming down after sunset, or after dark: take a head torch. Null when back in daylight.
   */
  torch: null | 'sunset' | 'dark';
  /** No start fits before the "Down by" time: the walk is too long for the daylight left. */
  tooLong: boolean;
  sunset: number;
  dusk: number;
}

/** Local clock time ("09:30") on the day as an instant. */
export function clockTime(dayStart: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  // dayStart is local midnight; across a clock change this is out by an hour at most.
  return dayStart + (h! * 60 + (m ?? 0)) * MIN;
}

/** Start times a part of the day allows, ignoring the "Down by" limit. */
function startsFor(period: Period, l: Light, length: number, span: TimeWindow): number[] {
  let from: number;
  let to: number;
  if (period === 'morning') {
    // Setting off from first light, not in the dark before it.
    from = l.dawn;
    to = l.sunrise + HOUR;
  } else if (period === 'evening') {
    // Finishing around sunset.
    from = l.sunset - 90 * MIN - length;
    to = l.dusk - length;
  } else {
    from = l.sunrise - STEP;
    to = l.sunset;
  }
  const out: number[] = [];
  for (let t = ceilTo(from, STEP); t <= to && t + length <= span.end; t += STEP) out.push(t);
  return out;
}

function torchFor(end: number, l: Light): WalkPlan['torch'] {
  if (end > l.dusk) return 'dark';
  if (end > l.sunset) return 'sunset';
  return null;
}

function label(start: number, end: number): string {
  const f = (t: number) =>
    new Date(t).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/London',
      hour: '2-digit',
      minute: '2-digit',
    });
  return `Your walk, ${f(start)} to ${f(end)}`;
}

/**
 * The walk to plan: at the set time, or the start in the chosen parts of the day whose
 * hours on the hill score best while still getting back by the "Down by" time. When no
 * start can, the one that gets back soonest, flagged as too long for the daylight.
 */
export function chooseWalk(w: WalkInput): WalkPlan | null {
  const l = light(w.sun, w.dayStart);
  const length = (w.upMinutes + SUMMIT_STOP_MINUTES + w.downMinutes) * MIN;
  const limit = w.downBy === 'sunset' ? l.sunset : w.downBy === 'dark' ? l.dusk : Infinity;
  const spanWindow = { start: w.span.byModel[0]?.hours[0]?.time ?? 0, end: Infinity };

  const plan = (start: number, period: Period, tooLong = false): WalkPlan => {
    const end = start + length;
    const window = { start, end, label: label(start, end) };
    // Every forecast hour the walk overlaps: 11:30 to 14:30 is judged on 11:00 to 14:00.
    const judged = { start: floorTo(start, HOUR), end: end - 1 };
    return {
      period,
      start,
      summitAt: start + w.upMinutes * MIN,
      end,
      window,
      result: rescoreTarget(w.span, judged, w.config, w.options),
      torch: torchFor(end, l),
      tooLong,
      sunset: l.sunset,
      dusk: l.dusk,
    };
  };

  const periods = WALK_PERIODS.filter((p) => w.periods.includes(p));
  if (periods.length === 0) return null;
  const spanEnd = l.dusk + 3 * HOUR;

  if (w.start !== 'best') {
    const start = clockTime(w.dayStart, w.start);
    if (start < spanWindow.start || start + length > spanEnd) return null;
    // A set time is your choice: it shows under whichever ticked part of the day it's in.
    const fits = periods.find((p) =>
      startsFor(p, l, length, { start: 0, end: spanEnd }).some((t) => Math.abs(t - start) < STEP),
    );
    return { ...plan(start, fits ?? periods[0]!), tooLong: start + length > limit };
  }

  const span = { start: spanWindow.start, end: spanEnd };
  const candidates = periods.flatMap((p) =>
    startsFor(p, l, length, span)
      .filter((t) => t >= w.notBefore)
      .map((t) => ({ t, p })),
  );
  if (candidates.length === 0) return null;

  const inTime = candidates.filter((c) => c.t + length <= limit);
  if (inTime.length === 0) {
    // Too long for the light: the earliest start, so as little as possible is in the dark.
    const first = candidates.reduce((a, b) => (b.t < a.t ? b : a));
    return plan(first.t, first.p, true);
  }

  let best: WalkPlan | null = null;
  const seen = new Set<number>();
  for (const c of inTime) {
    if (seen.has(c.t)) continue;
    seen.add(c.t);
    const p = plan(c.t, c.p);
    // Earlier starts win ties: more daylight in hand.
    if (!best || (p.result.score ?? -1) > (best.result.score ?? -1) + 1e-9) best = p;
  }
  return best;
}
