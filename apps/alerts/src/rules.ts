/**
 * Matching alerts against scored forecasts, and deciding what's news. Pure: the checker
 * feeds it evaluated places, and tests feed it made-up ones.
 */
import type { Hill, Verdict } from '@atmos/engine';
import type { ConditionResult } from '../../web/src/lib/evaluate-places';
import type { SunTimes } from '../../web/src/lib/sun';
import { placeKey, type Alert, type Notified, type PlaceRef } from './model';

export interface MatchItem {
  profileId: string;
  period: ConditionResult['period'];
  verdict: 'go' | 'maybe';
  score: number;
  /** When it's best, from the reference model. */
  keyTime: number | null;
  result: ConditionResult;
}

export interface Match {
  place: PlaceRef;
  /** Local date, YYYY-MM-DD. */
  date: string;
  dayOffset: number;
  /** The best verdict among the items. */
  verdict: 'go' | 'maybe';
  items: MatchItem[];
  hill: Hill;
  sun: SunTimes;
  valleyM: number;
}

/** One day's conditions for one place. */
export interface DayConditions {
  place: PlaceRef;
  date: string;
  dayOffset: number;
  conditions: ConditionResult[];
  /** Where it is, its sun times that day and the valley floor below it, for the email. */
  hill: Hill;
  sun: SunTimes;
  valleyM: number;
}

const RANK: Record<Verdict, number> = { go: 2, maybe: 1, no: 0, nodata: -1 };

const meets = (v: Verdict, min: 'go' | 'maybe') => RANK[v] >= RANK[min];

const keyTimeOf = (c: ConditionResult): number | null =>
  c.result.byModel.find((m) => m.model === c.result.referenceModel)?.keyHour?.time ?? null;

/**
 * The places and days that match an alert: for each condition its best period among the
 * alert's, if it reaches the alert's verdict and hasn't already passed. "all" needs every
 * condition on the same day; "any" needs one.
 */
export function findMatches(alert: Alert, days: DayConditions[], now: number): Match[] {
  const out: Match[] = [];
  const wanted = new Set(alert.places.map(placeKey));
  for (const day of days) {
    if (day.dayOffset >= alert.daysAhead) continue;
    if (!wanted.has(placeKey(day.place))) continue;
    const items: MatchItem[] = [];
    let missing = false;
    for (const id of alert.conditions) {
      const candidates = day.conditions.filter(
        (c) =>
          c.profileId === id &&
          alert.periods.includes(c.period) &&
          c.window.end > now &&
          // Its best hour already gone today: too late to act on.
          (keyTimeOf(c) ?? Infinity) >= now - 30 * 60_000 &&
          c.result.score !== null &&
          meets(c.result.verdict, alert.minVerdict),
      );
      const best = candidates.sort((a, b) => (b.result.score ?? 0) - (a.result.score ?? 0))[0];
      if (!best) {
        missing = true;
        continue;
      }
      items.push({
        profileId: id,
        period: best.period,
        verdict: best.result.verdict as 'go' | 'maybe',
        score: best.result.score!,
        keyTime: keyTimeOf(best),
        result: best,
      });
    }
    if (items.length === 0 || (alert.match === 'all' && missing)) continue;
    const verdict = items.some((i) => i.verdict === 'go') ? 'go' : 'maybe';
    out.push({
      place: day.place,
      date: day.date,
      dayOffset: day.dayOffset,
      verdict,
      items,
      hill: day.hill,
      sun: day.sun,
      valleyM: day.valleyM,
    });
  }
  return out.sort((a, b) => a.dayOffset - b.dayOffset || (a.place.name < b.place.name ? -1 : 1));
}

export interface News {
  match: Match;
  /** First time, better than before, or (daily) still on. */
  kind: 'new' | 'better' | 'still';
  /** What was said last time, for "up from Maybe". */
  previous?: Notified;
}

export interface Cancelled {
  key: string;
  place: PlaceRef;
  date: string;
  previous: Notified;
}

export interface Decision {
  news: News[];
  cancelled: Cancelled[];
  notified: Record<string, Notified>;
}

const matchKey = (m: { place: PlaceRef; date: string }) => `${placeKey(m.place)}|${m.date}`;

/**
 * What to tell someone now. "asap" sends only what's new or better, and a note when
 * something sent before has fallen through. "daily" sends everything that matches, marked
 * new, better or still on, plus anything that has fallen through. Days before `today` are
 * forgotten.
 */
export function decide(alert: Alert, matches: Match[], today: string, now: number): Decision {
  const notified: Record<string, Notified> = {};
  for (const [k, v] of Object.entries(alert.notified)) {
    const date = k.split('|')[1] ?? '';
    if (date >= today) notified[k] = v;
  }
  const news: News[] = [];
  const seen = new Set<string>();
  for (const m of matches) {
    const key = matchKey(m);
    seen.add(key);
    const before = notified[key];
    const conditions = m.items.map((i) => i.profileId).sort();
    let kind: News['kind'] | null = null;
    if (!before) kind = 'new';
    else if (
      RANK[m.verdict] > RANK[before.verdict] ||
      conditions.some((c) => !before.conditions.includes(c))
    )
      kind = 'better';
    else if (alert.delivery.mode === 'daily') kind = 'still';
    if (kind) news.push({ match: m, kind, ...(before ? { previous: before } : {}) });
    notified[key] = {
      verdict: m.verdict,
      conditions,
      at: before && kind === 'still' ? before.at : now,
      until: Math.max(...m.items.map((i) => i.result.window.end)),
    };
  }
  const cancelled: Cancelled[] = [];
  for (const [key, previous] of Object.entries(notified)) {
    if (seen.has(key)) continue;
    const place = alert.places.find((p) => key.startsWith(`${placeKey(p)}|`));
    const date = key.split('|')[1] ?? '';
    // Gone because its time has passed: nothing to say.
    if (place && previous.until > now) cancelled.push({ key, place, date, previous });
    delete notified[key];
  }
  return { news, cancelled, notified };
}
