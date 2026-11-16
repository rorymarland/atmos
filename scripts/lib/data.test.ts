import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { decodeHill, encodeHill, hillIsOnList } from '@atmos/engine';
import { decodeCsv, hillListsConfigSchema, parseDobih } from './hills.js';
import { assignZones, parseZones } from './zones.js';

const ROOT = resolve(import.meta.dirname, '../..');
const yaml = (file: string) => parseYaml(readFileSync(join(ROOT, 'config', file), 'utf8'));
const listsConfig = hillListsConfigSchema.parse(yaml('hill-lists.yaml'));
const sample = readFileSync(join(ROOT, 'scripts/fixtures/dobih-sample.csv'), 'utf8');

describe('parseDobih', () => {
  const result = parseDobih(sample, listsConfig);
  const names = result.hills.map((h) => h.name);

  it('keeps UK hills on the agreed lists, highest first', () => {
    expect(names).toEqual([
      'Ben Nevis',
      'Yr Wyddfa - Snowdon',
      'Sgùrr Alasdair',
      'Scafell Pike',
      'Ben Ledi',
      'Slieve Donard',
      'Cuilcagh',
      'The Cheviot Border Top',
      'Leith Hill',
    ]);
    expect(result.stats).toEqual({ rows: 13, kept: 9, notUk: 2, notOnList: 1, invalid: 1 });
  });

  it('keeps Northern Ireland but not the Republic of Ireland or the Isle of Man', () => {
    // Matched on the full council name, which itself contains a comma.
    expect(names).toContain('Slieve Donard');
    // On the border: "Fermanagh and Omagh, Cavan".
    expect(names).toContain('Cuilcagh');
    expect(names).not.toContain('Lugnaquilla');
    expect(names).not.toContain('Snaefell');
  });

  it('keeps hills on the England-Scotland border (country code ES)', () => {
    expect(names).toContain('The Cheviot Border Top');
  });

  it('records list membership as a bitmask', () => {
    const list = (id: string) => result.lists.find((l) => l.id === id)!;
    const scafell = result.hills.find((h) => h.name === 'Scafell Pike')!;
    const hill = { ...scafell, zone: -1 };
    expect(hillIsOnList(hill, list('wainwright'))).toBe(true);
    expect(hillIsOnList(hill, list('hewitt'))).toBe(true);
    expect(hillIsOnList(hill, list('marilyn'))).toBe(true);
    expect(hillIsOnList(hill, list('munro'))).toBe(false);
    expect(scafell.metres).toBe(978.1);
  });

  it('round-trips through the compact row format', () => {
    const hill = { ...result.hills[0]!, zone: 3 };
    expect(decodeHill(encodeHill(hill))).toEqual(hill);
  });

  it('names the missing and actual columns when the header has changed', () => {
    const broken = sample.replace('Latitude', 'Lat');
    expect(() => parseDobih(broken, listsConfig)).toThrow(
      /missing column\(s\): Latitude[\s\S]*Lat,/,
    );
  });
});

describe('decodeCsv', () => {
  it('reads UTF-8 with a byte-order mark', () => {
    const bytes = new TextEncoder().encode('\uFEFFName\nSgùrr');
    expect(decodeCsv(bytes)).toBe('Name\nSgùrr');
  });

  it('falls back to Windows-1252 when the bytes are not valid UTF-8', () => {
    // "Sgùrr" in Windows-1252: ù is 0xF9.
    const bytes = new Uint8Array([0x53, 0x67, 0xf9, 0x72, 0x72]);
    expect(decodeCsv(bytes)).toBe('Sgùrr');
  });
});

describe('zones', () => {
  const zones = parseZones(yaml('zones.yaml'));

  it('accepts config/zones.yaml', () => {
    expect(zones.zones.length).toBeGreaterThan(40);
  });

  it('assigns hills to the nearest zone within range', () => {
    const { hills } = parseDobih(sample, listsConfig);
    const result = assignZones(hills, zones.zones, zones.maxAssignKm);
    const zoneOf = (name: string) => {
      const h = result.hills.find((x) => x.name === name)!;
      return h.zone === -1 ? null : zones.zones[h.zone]!.id;
    };
    expect(zoneOf('Ben Nevis')).toBe('lochaber');
    expect(zoneOf('Ben Ledi')).toBe('trossachs');
    expect(zoneOf('Sgùrr Alasdair')).toBe('skye');
    expect(zoneOf('Scafell Pike')).toBe('lakes-south');
    expect(zoneOf('Yr Wyddfa - Snowdon')).toBe('eryri-north');
    expect(zoneOf('Slieve Donard')).toBe('mournes');
    expect(zoneOf('Cuilcagh')).toBe('fermanagh');
    expect(zoneOf('The Cheviot Border Top')).toBe('cheviots');
    expect(zoneOf('Leith Hill')).toBe('south-downs');
    expect(result.unzoned).toBe(0);
  });

  it('rejects duplicate zone ids', () => {
    const raw = yaml('zones.yaml');
    raw.zones.push({ ...raw.zones[0] });
    expect(() => parseZones(raw)).toThrow(/Duplicate zone id "galloway"/);
  });
});
