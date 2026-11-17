import { describe, expect, it } from 'vitest';
import type { Hill, ModelForecast, Zone } from '@atmos/engine';
import { loadRealConfig } from '../../../packages/engine/src/test-config';
import { T0, inversionMorning, makeForecast } from '../../../packages/engine/src/testing';
import {
  createEvaluateMemo,
  evaluatePlaces,
  type EvaluateInput,
} from '../../web/src/lib/evaluate-places';

const config = loadRealConfig();
const zones: Zone[] = [
  { id: 'z0', name: 'Callander', nation: 'scotland', forecastPoint: { lat: 56.24, lon: -4.21 } },
  { id: 'z1', name: 'Aviemore', nation: 'scotland', forecastPoint: { lat: 57.19, lon: -3.83 } },
];
const hill = (number: number, zone: number, metres: number): Hill => ({
  number,
  name: `Hill ${number}`,
  lat: zones[zone]!.forecastPoint.lat + 0.02,
  lon: zones[zone]!.forecastPoint.lon,
  metres,
  lists: 1,
  zone,
  nations: ['scotland'],
});
const hills = [hill(1, 0, 879), hill(2, 0, 300), hill(3, 1, 1100)];
const now = T0 - 12 * 3_600_000;
const kp: EvaluateInput['kp'] = [];

function setup() {
  const forecasts: Record<string, ModelForecast[]> = {
    z0: [makeForecast({ ...inversionMorning, hoursAfter: 48 })],
    z1: [makeForecast({ ...inversionMorning, hoursAfter: 48 })],
  };
  const input = (over: Partial<EvaluateInput> = {}): EvaluateInput => ({
    hills,
    data: { zones, config, waters: null },
    dayOffset: 0,
    now,
    modelsFor: (id) => forecasts[id] ?? [],
    horizonsFor: () => undefined,
    kp,
    ...over,
  });
  return { forecasts, input };
}

describe('evaluatePlaces memo', () => {
  it('gives the same results as scoring afresh', () => {
    const { input } = setup();
    const memo = createEvaluateMemo();
    evaluatePlaces(input({ memo }));
    const memoised = evaluatePlaces(input({ memo }));
    const fresh = evaluatePlaces(input());
    expect(memoised).toEqual(fresh);
    expect(memoised).toHaveLength(3);
  });

  it('reuses every hill when nothing has changed, even if fewer are asked for', () => {
    const { input } = setup();
    const memo = createEvaluateMemo();
    const first = evaluatePlaces(input({ memo }));
    const again = evaluatePlaces(input({ memo }));
    again.forEach((p, i) => expect(p).toBe(first[i]));
    const some = evaluatePlaces(input({ memo, hills: [hills[2]!] }));
    expect(some[0]).toBe(first[2]);
  });

  it('re-scores only the zone whose forecast changed', () => {
    const { forecasts, input } = setup();
    const memo = createEvaluateMemo();
    const first = evaluatePlaces(input({ memo }));
    forecasts.z0 = [makeForecast({ ...inversionMorning, hoursAfter: 48 })];
    const next = evaluatePlaces(input({ memo }));
    expect(next[0]).not.toBe(first[0]);
    expect(next[1]).not.toBe(first[1]);
    expect(next[2]).toBe(first[2]);
  });

  it('starts afresh for another day or an hour later', () => {
    const { input } = setup();
    const memo = createEvaluateMemo();
    const first = evaluatePlaces(input({ memo }));
    const tomorrow = evaluatePlaces(input({ memo, dayOffset: 1 }));
    expect(tomorrow[0]).not.toBe(first[0]);
    const back = evaluatePlaces(input({ memo }));
    expect(back[0]).not.toBe(first[0]);
    expect(back).toEqual(first);
    const later = evaluatePlaces(input({ memo, now: now + 3_600_000 }));
    expect(later[0]).not.toBe(back[0]);
    expect(evaluatePlaces(input({ memo, now: now + 3_600_000 + 60_000 }))[0]).toBe(later[0]);
  });
});
