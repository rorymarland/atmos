import { describe, expect, it } from 'vitest';
import { assessTrails, formationThresholdC, trailForms, trailsAt } from './contrails';

const level = (pressureHpa: number, temperatureC: number, rhIce: number) => ({
  pressureHpa,
  temperatureC,
  rhIce,
});

describe('plane trails', () => {
  it('forms below about −40 °C at cruise height, colder higher up', () => {
    expect(formationThresholdC(250)).toBeCloseTo(-41, 0);
    expect(formationThresholdC(200)).toBeLessThan(formationThresholdC(300));
    expect(trailForms(level(250, -50, 50))).toBe(true);
    expect(trailForms(level(300, -36, 50))).toBe(false);
  });

  it('lingers where the air is saturated with ice', () => {
    const a = assessTrails(
      [level(300, -38, 60), level(250, -52, 105), level(200, -58, 40)],
      10,
      20,
    )!;
    expect(a.risk).toBe('high');
    expect(a.linger).toBe('likely');
    expect(a.level?.pressureHpa).toBe(250);
    expect(a.text).toMatch(/linger/);
  });

  it('may linger close to saturation, fades quickly in dry air', () => {
    expect(assessTrails([level(250, -52, 93)], 0, 0)!.risk).toBe('medium');
    const dry = assessTrails([level(250, -52, 40), level(200, -57, 30)], 0, 0)!;
    expect(dry.risk).toBe('low');
    expect(dry.linger).toBe('brief');
  });

  it('is hidden by thick high or mid cloud, and nothing forms in warm air', () => {
    const hidden = assessTrails([level(250, -52, 110)], 10, 90)!;
    expect(hidden.risk).toBe('low');
    expect(hidden.hidden).toBe(true);
    expect(assessTrails([level(300, -30, 110)], 0, 0)!.linger).toBe('none');
  });

  it('reads the right hour from an upper-air forecast', () => {
    const t0 = Date.UTC(2026, 10, 20, 6);
    const f = {
      time: [t0, t0 + 3_600_000],
      surface: { cloudCoverMid: [0, 0], cloudCoverHigh: [0, 0] },
      levels: [{ label: '250hPa', temperatureC: [-52, -52], relativeHumidity: [40, 104] }],
    };
    expect(trailsAt(f, t0 + 3_600_000 + 20 * 60_000)!.risk).toBe('high');
    expect(trailsAt(f, t0)!.risk).toBe('low');
    expect(trailsAt(f, t0 - 3_600_000)).toBeNull();
  });
});
