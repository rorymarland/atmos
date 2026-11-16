/**
 * Reads the DoBIH CSV and keeps UK hills on the agreed lists.
 */
import { nationsFromLetters } from '@atmos/engine';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { Hill, HillList } from '@atmos/engine';

export const hillListsConfigSchema = z.strictObject({
  columns: z.strictObject({
    number: z.string(),
    name: z.string(),
    metres: z.string(),
    latitude: z.string(),
    longitude: z.string(),
    country: z.string(),
    county: z.string(),
  }),
  ukCountryLetters: z.array(z.string().length(1)).min(1),
  irelandCountryCode: z.string().min(1),
  northernIrelandCouncils: z.array(z.string().min(1)).min(1),
  lists: z
    .array(z.strictObject({ id: z.string(), label: z.string(), column: z.string() }))
    .min(1)
    .max(31),
});

export type HillListsConfig = z.infer<typeof hillListsConfigSchema>;

/** Hill before zone assignment. */
export type UnzonedHill = Omit<Hill, 'zone'>;

export interface ParseResult {
  lists: HillList[];
  hills: UnzonedHill[];
  /** UK hills on none of the lists (mostly Tumps): searchable, but not mapped or ranked. */
  others: UnzonedHill[];
  stats: { rows: number; kept: number; notUk: number; notOnList: number; invalid: number };
}

/**
 * Decodes the CSV bytes. DoBIH has shipped both UTF-8 and Windows-1252 files over
 * the years; Gaelic and Welsh names break if the wrong one is assumed.
 */
export function decodeCsv(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  const text = utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
  return text.replace(/^\uFEFF/, '');
}

export function parseDobih(csv: string, config: HillListsConfig): ParseResult {
  const rows: Record<string, string>[] = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  const header = rows.length > 0 ? Object.keys(rows[0]!) : [];
  const required = [...Object.values(config.columns), ...config.lists.map((l) => l.column)];
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `DoBIH CSV is missing column(s): ${missing.join(', ')}.\n` +
        `Columns found: ${header.join(', ')}\n` +
        `Fix the names in config/hill-lists.yaml.`,
    );
  }

  const lists: HillList[] = config.lists.map((l, bit) => ({ id: l.id, label: l.label, bit }));
  const ukLetters = new Set(config.ukCountryLetters);
  // "S", "E", "W" and border codes such as "ES": every letter must be a UK one.
  const isUkCode = (code: string) => code.length > 0 && [...code].every((c) => ukLetters.has(c));
  const niCouncils = config.northernIrelandCouncils.map((c) => c.toLowerCase());
  const isNorthernIreland = (county: string) => {
    const c = county.toLowerCase();
    return niCouncils.some((ni) => c.includes(ni));
  };

  const stats = { rows: rows.length, kept: 0, notUk: 0, notOnList: 0, invalid: 0 };
  const hills: UnzonedHill[] = [];
  const others: UnzonedHill[] = [];
  const col = config.columns;

  for (const row of rows) {
    const country = row[col.country] ?? '';
    const inNi = country === config.irelandCountryCode && isNorthernIreland(row[col.county] ?? '');
    const inUk = isUkCode(country) || inNi;
    if (!inUk) {
      stats.notUk++;
      continue;
    }

    let mask = 0;
    config.lists.forEach((l, bit) => {
      if (isFlagSet(row[l.column])) mask |= 1 << bit;
    });
    const number = Number(row[col.number]);
    const lat = Number(row[col.latitude]);
    const lon = Number(row[col.longitude]);
    const metres = Number(row[col.metres]);
    const name = (row[col.name] ?? '').trim();
    if (!Number.isInteger(number) || !name || !Number.isFinite(metres) || !isUkLatLon(lat, lon)) {
      stats.invalid++;
      continue;
    }

    if (mask === 0) stats.notOnList++;
    (mask === 0 ? others : hills).push({
      number,
      name,
      lat: round(lat, 5),
      lon: round(lon, 5),
      metres: round(metres, 1),
      lists: mask,
      nations: nationsFromLetters(inNi ? 'N' : country),
    });
  }

  stats.kept = hills.length;
  hills.sort((a, b) => b.metres - a.metres || a.number - b.number);
  others.sort((a, b) => b.metres - a.metres || a.number - b.number);
  return { lists, hills, others, stats };
}

/** DoBIH marks list membership with 1; tolerate "1.0", "Y" and similar. */
function isFlagSet(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === '1.0' || v === 'y' || v === 'yes' || v === 'true';
}

/** A generous box around the UK, to catch swapped or missing coordinates. */
function isUkLatLon(lat: number, lon: number): boolean {
  return lat >= 49.8 && lat <= 61 && lon >= -8.7 && lon <= 2;
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
