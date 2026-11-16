import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findDobihCsv, versionFromFilename } from './source.js';

describe('versionFromFilename', () => {
  it('reads the version from the downloaded name', () => {
    expect(versionFromFilename('DoBIH_v18_6.csv')).toBe('18.6');
    expect(versionFromFilename('/x/y/DoBIH_v18.3.csv')).toBe('18.3');
    expect(versionFromFilename('hills-v19-0-1.csv')).toBe('19.0.1');
    expect(versionFromFilename('DoBIH.csv')).toBeNull();
  });
});

describe('findDobihCsv', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'atmos-raw-'));

  it('prefers DoBIH.csv, then the only CSV', () => {
    const a = dir();
    writeFileSync(join(a, 'DoBIH_v18_6.csv'), '');
    expect(findDobihCsv(a).path).toBe(join(a, 'DoBIH_v18_6.csv'));
    writeFileSync(join(a, 'DoBIH.csv'), '');
    expect(findDobihCsv(a).path).toBe(join(a, 'DoBIH.csv'));
  });

  it('explains an empty or ambiguous folder', () => {
    const b = dir();
    writeFileSync(join(b, 'README.md'), '');
    expect(findDobihCsv(b).problem).toMatch(/no \.csv file/);
    writeFileSync(join(b, 'one.csv'), '');
    writeFileSync(join(b, 'two.csv'), '');
    expect(findDobihCsv(b).problem).toMatch(/several \.csv files/);
  });

  it('uses an explicit path as given', () => {
    expect(findDobihCsv('/nowhere', '/data/x.csv').path).toBe('/data/x.csv');
  });
});
