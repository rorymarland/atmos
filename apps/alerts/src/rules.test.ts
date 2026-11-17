import { describe, expect, it } from 'vitest';
import type { ConditionResult } from '../../web/src/lib/evaluate-places';
import type { Alert } from './model';
import { decide, findMatches, type DayConditions } from './rules';
import { dailyDue, isQuiet } from './runner';

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 17, 9, 0); // 09:00 in London (GMT)

function cond(
  profileId: string,
  period: ConditionResult['period'],
  verdict: 'go' | 'maybe' | 'no',
  score: number,
  end = NOW + 30 * H,
): ConditionResult {
  return {
    profileId,
    period,
    scope: 'valley',
    window: { start: end - 2 * H, end, label: 'x' } as ConditionResult['window'],
    result: {
      target: { id: 'z', name: 'z', altitudeM: 0 },
      profileId,
      score,
      verdict,
      confidence: 'high',
      referenceModel: 'm',
      byModel: [{ model: 'm', keyHour: { time: end - H } }],
    } as unknown as ConditionResult['result'],
  };
}

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a',
    email: 'me@example.com',
    places: [{ kind: 'hill', number: 8055, name: "Ben A'an" }],
    conditions: ['snow', 'clarity'],
    match: 'all',
    minVerdict: 'go',
    periods: ['morning', 'day'],
    daysAhead: 3,
    delivery: { mode: 'asap' },
    paused: false,
    createdAt: 0,
    updatedAt: 0,
    notified: {},
    ...over,
  };
}

const place = { kind: 'hill' as const, number: 8055, name: "Ben A'an" };
const day = (dayOffset: number, conditions: ConditionResult[]): DayConditions => ({
  place,
  date: `2026-11-${17 + dayOffset}`,
  dayOffset,
  conditions,
});

describe('alerts', () => {
  it('needs every condition on the same day for "all"', () => {
    const days = [
      day(0, [cond('snow', 'day', 'go', 0.8)]),
      day(2, [
        cond('snow', 'day', 'go', 0.9),
        cond('clarity', 'day', 'go', 0.75),
        cond('clarity', 'morning', 'maybe', 0.6),
      ]),
    ];
    const m = findMatches(alert(), days, NOW);
    expect(m).toHaveLength(1);
    expect(m[0]!.date).toBe('2026-11-19');
    expect(m[0]!.items.map((i) => i.profileId)).toEqual(['snow', 'clarity']);
    expect(findMatches(alert({ match: 'any' }), days, NOW)).toHaveLength(2);
  });

  it('respects verdict, periods, days ahead and windows already gone', () => {
    const a = alert({ conditions: ['reflections'], periods: ['morning'], daysAhead: 2 });
    expect(
      findMatches(a, [day(0, [cond('reflections', 'morning', 'maybe', 0.6)])], NOW),
    ).toHaveLength(0);
    expect(
      findMatches(
        { ...a, minVerdict: 'maybe' },
        [day(0, [cond('reflections', 'morning', 'maybe', 0.6)])],
        NOW,
      ),
    ).toHaveLength(1);
    expect(findMatches(a, [day(0, [cond('reflections', 'evening', 'go', 0.9)])], NOW)).toHaveLength(
      0,
    );
    expect(findMatches(a, [day(2, [cond('reflections', 'morning', 'go', 0.9)])], NOW)).toHaveLength(
      0,
    );
    expect(
      findMatches(a, [day(0, [cond('reflections', 'morning', 'go', 0.9, NOW - H)])], NOW),
    ).toHaveLength(0);
  });

  it('sends news once, again when better, and says when it falls through', () => {
    const a = alert({ conditions: ['snow'], match: 'any', minVerdict: 'maybe' });
    const first = decide(
      a,
      findMatches(a, [day(1, [cond('snow', 'day', 'maybe', 0.6)])], NOW),
      '2026-11-17',
      NOW,
    );
    expect(first.news.map((n) => n.kind)).toEqual(['new']);
    const a2 = { ...a, notified: first.notified };
    const same = decide(
      a2,
      findMatches(a2, [day(1, [cond('snow', 'day', 'maybe', 0.62)])], NOW),
      '2026-11-17',
      NOW,
    );
    expect(same.news).toHaveLength(0);
    const better = decide(
      a2,
      findMatches(a2, [day(1, [cond('snow', 'day', 'go', 0.8)])], NOW),
      '2026-11-17',
      NOW,
    );
    expect(better.news.map((n) => n.kind)).toEqual(['better']);
    const gone = decide(a2, [], '2026-11-17', NOW);
    expect(gone.cancelled).toHaveLength(1);
    expect(gone.notified).toEqual({});
  });

  it('forgets news whose time has passed without calling it a change', () => {
    const a = alert({ conditions: ['snow'], match: 'any' });
    const first = decide(
      a,
      findMatches(a, [day(0, [cond('snow', 'day', 'go', 0.8, NOW + H)])], NOW),
      '2026-11-17',
      NOW,
    );
    const later = decide({ ...a, notified: first.notified }, [], '2026-11-17', NOW + 2 * H);
    expect(later.cancelled).toHaveLength(0);
  });

  it('daily alerts repeat what still matches', () => {
    const a = alert({
      conditions: ['snow'],
      match: 'any',
      delivery: { mode: 'daily', at: '07:00' },
    });
    const days = [day(1, [cond('snow', 'day', 'go', 0.8)])];
    const first = decide(a, findMatches(a, days, NOW), '2026-11-17', NOW);
    const again = decide(
      { ...a, notified: first.notified },
      findMatches(a, days, NOW),
      '2026-11-17',
      NOW,
    );
    expect(again.news.map((n) => n.kind)).toEqual(['still']);
  });

  it('times daily alerts and quiet hours in London time', () => {
    const a = alert({ delivery: { mode: 'daily', at: '07:00' } });
    expect(dailyDue(a, Date.UTC(2026, 10, 17, 6, 59))).toBe(false);
    expect(dailyDue(a, Date.UTC(2026, 10, 17, 7, 0))).toBe(true);
    expect(dailyDue({ ...a, lastDailyDate: '2026-11-17' }, Date.UTC(2026, 10, 17, 7, 30))).toBe(
      false,
    );
    expect(dailyDue(a, Date.UTC(2026, 10, 17, 11, 0))).toBe(false);
    // Summer time: 07:00 in London is 06:00 UTC.
    expect(dailyDue(a, Date.UTC(2026, 6, 17, 6, 0))).toBe(true);
    expect(isQuiet(Date.UTC(2026, 10, 17, 23, 0))).toBe(true);
    expect(isQuiet(Date.UTC(2026, 10, 17, 6, 0))).toBe(false);
  });
});
