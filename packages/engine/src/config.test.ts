import { describe, expect, it } from 'vitest';
import { parseScoringConfig } from './config.js';
import { loadRealConfig, rawProfilesYaml as rawConfig } from './test-config.js';

describe('scoring config', () => {
  it('accepts config/profiles.yaml', () => {
    const config = loadRealConfig();
    expect(Object.keys(config.profiles).sort()).toEqual(
      ['inversion', 'reflections', 'sky', 'walking'].sort(),
    );
  });

  it('rejects an unknown factor', () => {
    const raw = rawConfig();
    raw.profiles.walking.factors.sunshine = { weight: 1, good: 1, bad: 0 };
    expect(() => parseScoringConfig(raw)).toThrow(/walking\.factors\.sunshine: unknown/);
  });

  it('rejects a missing gate', () => {
    const raw = rawConfig();
    delete raw.profiles.inversion.gates.summitWind;
    expect(() => parseScoringConfig(raw)).toThrow(/inversion\.gates\.summitWind: missing/);
  });

  it('rejects a missing profile', () => {
    const raw = rawConfig();
    delete raw.profiles.sky;
    expect(() => parseScoringConfig(raw)).toThrow(/profiles\.sky: missing from config/);
  });

  it('rejects a ramp whose thresholds are equal', () => {
    const raw = rawConfig();
    raw.profiles.reflections.factors.wind = { weight: 1, good: 5, bad: 5 };
    expect(() => parseScoringConfig(raw)).toThrow(/good and bad thresholds must differ/);
  });

  it('rejects a misspelt key', () => {
    const raw = rawConfig();
    raw.profiles.reflections.factors.wind = { weight: 1, good: 5, badd: 12 };
    expect(() => parseScoringConfig(raw)).toThrow();
  });
});
