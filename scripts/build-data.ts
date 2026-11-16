/**
 * Builds the app's static data from config/ and the DoBIH CSV into data/generated/.
 *
 *   pnpm build:data [--hills <csv>] [--dobih-version 18.6] [--out data/generated]
 *
 * Without --hills, uses data/raw/DoBIH.csv, or the only .csv in data/raw (so the download
 * can keep its original name). The version comes from --dobih-version, then the
 * DOBIH_VERSION environment variable, then the file name (DoBIH_v18_6.csv -> 18.6).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import {
  encodeHill,
  parseScoringConfig,
  type AttributionsFile,
  type HillsFile,
  type ZonesFile,
} from '@atmos/engine';
import { decodeCsv, hillListsConfigSchema, parseDobih } from './lib/hills.js';
import { findDobihCsv, versionFromFilename } from './lib/source.js';
import { assignZones, parseZones } from './lib/zones.js';

const ROOT = resolve(import.meta.dirname, '..');

// `pnpm build:data -- --flag` passes the `--` through; drop it so the flags still parse.
const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values: args } = parseArgs({
  args: argv,
  options: {
    hills: { type: 'string' },
    // Folder searched for the CSV when --hills isn't given.
    raw: { type: 'string', default: join(ROOT, 'data/raw') },
    // Folder holding profiles.yaml, zones.yaml, hill-lists.yaml and attributions.yaml.
    config: { type: 'string', default: join(ROOT, 'config') },
    'dobih-version': { type: 'string' },
    out: { type: 'string', default: join(ROOT, 'data/generated') },
  },
});

const source = findDobihCsv(args.raw!, args.hills);
if (!source.path) {
  console.error(
    `Can't find the DoBIH CSV: ${source.problem}.\n` +
      'Download the csv version from https://www.hills-database.co.uk/downloads.html ' +
      `and put it in ${args.raw} (see data/raw/README.md).`,
  );
  process.exit(1);
}
const hillsPath = source.path;

const dobihVersion =
  args['dobih-version'] || process.env.DOBIH_VERSION || versionFromFilename(hillsPath);
if (!dobihVersion || !/^\d+(\.\d+)*$/.test(dobihVersion)) {
  console.error(
    `Can't tell which DoBIH version ${hillsPath} is. Pass --dobih-version 18.6, ` +
      'set DOBIH_VERSION, or keep the version in the file name (e.g. DoBIH_v18_6.csv).',
  );
  process.exit(1);
}

const readYaml = (file: string): unknown =>
  parseYaml(readFileSync(join(args.config!, file), 'utf8'));

// Scoring profiles: validate against the engine, then ship as JSON.
const profiles = parseScoringConfig(readYaml('profiles.yaml'));

// Zones.
const zonesConfig = parseZones(readYaml('zones.yaml'));
const zonesFile: ZonesFile = { zones: zonesConfig.zones };

// Hills.
let csvBytes: Uint8Array;
try {
  csvBytes = readFileSync(hillsPath);
} catch {
  console.error(
    `Can't read ${hillsPath}. See data/raw/README.md for how to download the DoBIH CSV.`,
  );
  process.exit(1);
}
const listsConfig = hillListsConfigSchema.parse(readYaml('hill-lists.yaml'));
const parsed = parseDobih(decodeCsv(csvBytes), listsConfig);
const zoned = assignZones(parsed.hills, zonesConfig.zones, zonesConfig.maxAssignKm);
const hillsFile: HillsFile = {
  source: `Database of British and Irish Hills v${dobihVersion} (CC BY 4.0)`,
  lists: parsed.lists,
  hills: zoned.hills.map(encodeHill),
};

// Attributions.
const attributionsRaw = JSON.stringify(readYaml('attributions.yaml')).replaceAll(
  '{dobihVersion}',
  dobihVersion,
);
const attributionsFile = JSON.parse(attributionsRaw) as AttributionsFile;

// Write.
mkdirSync(args.out!, { recursive: true });
const write = (name: string, data: unknown) => {
  const json = JSON.stringify(data);
  writeFileSync(join(args.out!, name), json + '\n');
  return `${name} ${(json.length / 1024).toFixed(1)} KB`;
};
const written = [
  write('hills.json', hillsFile),
  write('zones.json', zonesFile),
  write('profiles.json', profiles),
  write('attributions.json', attributionsFile),
];

const s = parsed.stats;
console.log(`DoBIH v${dobihVersion} (${hillsPath}): ${s.rows} rows read`);
console.log(
  `  kept ${s.kept} UK hills on the agreed lists ` +
    `(skipped ${s.notUk} outside the UK, ${s.notOnList} on no agreed list, ${s.invalid} invalid)`,
);
console.log(`  ${zoned.unzoned} hills further than ${zonesConfig.maxAssignKm} km from any zone`);
const empty = Object.entries(zoned.perZone)
  .filter(([, n]) => n === 0)
  .map(([id]) => id);
if (empty.length > 0) console.log(`  zones with no hills: ${empty.join(', ')}`);
console.log(`Wrote to ${args.out}:`);
for (const line of written) console.log(`  ${line}`);
