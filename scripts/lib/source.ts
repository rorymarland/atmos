/**
 * Finding the DoBIH CSV and its version without making people rename the download.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

/** "DoBIH_v18_6.csv" -> "18.6"; null when the name carries no version. */
export function versionFromFilename(file: string): string | null {
  const m = /v(\d+)[._-](\d+)(?:[._-](\d+))?/i.exec(basename(file));
  if (!m) return null;
  return [m[1], m[2], m[3]].filter(Boolean).join('.');
}

export interface SourceChoice {
  path: string | null;
  /** Why no file was chosen, for the error message. */
  problem?: string;
}

/**
 * Uses `explicit` if given. Otherwise prefers data/raw/DoBIH.csv, then the only .csv in
 * data/raw. Several CSVs and no DoBIH.csv is ambiguous, so nothing is chosen.
 */
export function findDobihCsv(rawDir: string, explicit?: string): SourceChoice {
  if (explicit) return { path: explicit };
  const preferred = join(rawDir, 'DoBIH.csv');
  if (existsSync(preferred)) return { path: preferred };
  const csvs = existsSync(rawDir)
    ? readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith('.csv'))
    : [];
  if (csvs.length === 1) return { path: join(rawDir, csvs[0]!) };
  if (csvs.length === 0) return { path: null, problem: `no .csv file in ${rawDir}` };
  return {
    path: null,
    problem: `several .csv files in ${rawDir} (${csvs.join(', ')}); keep one, or name it DoBIH.csv`,
  };
}
