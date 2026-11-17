/**
 * Builds the app's static data from config/ and the DoBIH CSV into data/generated/.
 *
 *   pnpm build:data [--hills <csv>] [--dobih-version 18.6] [--out data/generated]
 *
 * Without --hills, uses data/raw/DoBIH.csv, or the only .csv in data/raw (so the download
 * can keep its original name). The version comes from --dobih-version, then the
 * DOBIH_VERSION environment variable, then the file name (DoBIH_v18_6.csv -> 18.6).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse as parseYaml } from 'yaml';
import {
  encodeHill,
  encodeWaterBody,
  nearest,
  type Hill,
  type WaterBody,
  type WatersFile,
  parseScoringConfig,
  type AttributionsFile,
  type HillsFile,
  type ZonesFile,
} from '@atmos/engine';
import { decodeCsv, hillListsConfigSchema, parseDobih } from './lib/hills.js';
import { findDobihCsv, versionFromFilename } from './lib/source.js';
import { assignZones, parseZones } from './lib/zones.js';
import { decodeWaterRow, linkHillsToWater, type WaterFile } from './lib/water.js';

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
    // Still water from OpenStreetMap (see .github/workflows/water.yml).
    water: { type: 'string', default: join(ROOT, 'data/water/uk-water.json') },
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
// Every other UK hill (mostly Tumps), for the search box only. Loaded on demand.
const zonedOthers = assignZones(parsed.others, zonesConfig.zones, zonesConfig.maxAssignKm);
const searchHills = zonedOthers.hills.filter((h) => h.zone >= 0);

// Still water: lochs become places, and hills learn which water is near them. Without the
// file the app scores water conditions everywhere, as it did before.
const water = buildWaters([...zoned.hills, ...searchHills]);

const hillsFile: HillsFile = {
  source: `Database of British and Irish Hills v${dobihVersion} (CC BY 4.0)`,
  lists: parsed.lists,
  hills: zoned.hills.map(encodeHill),
};
const searchFile: HillsFile = {
  source: hillsFile.source,
  lists: [],
  hills: searchHills.map(encodeHill),
};

function buildWaters(hills: Hill[]): { file: WatersFile; stats: string } | null {
  if (!existsSync(args.water!)) {
    console.warn(`No water data at ${args.water}: water conditions won't be limited to lochs.`);
    return null;
  }
  const raw = JSON.parse(readFileSync(args.water!, 'utf8')) as WaterFile;
  const decoded = raw.waters.map(decodeWaterRow);
  const points = zonesConfig.zones.map((z) => z.forecastPoint);
  const zoneOf = decoded.map(({ water: w }) => {
    const hit = nearest(w, points);
    return hit && hit.km <= zonesConfig.maxAssignKm ? hit.index : -1;
  });
  const links = linkHillsToWater(
    hills,
    decoded.map((d) => d.water),
  );
  // Keep named water (places you can search for) and any water a hill uses.
  const used = new Set(links.filter((l) => l !== null).map((l) => l!.index));
  const keep: number[] = [];
  const newIndex = new Map<number, number>();
  decoded.forEach((d, i) => {
    if (zoneOf[i]! < 0) return;
    if (!d.water.name && !used.has(i)) return;
    newIndex.set(i, keep.length);
    keep.push(i);
  });
  hills.forEach((h, i) => {
    const l = links[i];
    const idx = l ? newIndex.get(l.index) : undefined;
    if (l && idx !== undefined) {
      h.water = { index: idx, distanceM: l.distanceM, shore: { lat: l.shore[0], lon: l.shore[1] } };
    }
  });
  const waters: WaterBody[] = keep.map((i) => {
    const { water: w, access } = decoded[i]!;
    const shorePt = access[0]?.shore;
    return {
      id: w.id,
      name: w.name,
      lat: w.lat,
      lon: w.lon,
      ha: w.ha,
      spanKm: w.spanKm,
      zone: zoneOf[i]!,
      shore: shorePt ? { lat: shorePt[0], lon: shorePt[1] } : { lat: w.lat, lon: w.lon },
      parkings: access.map((a) => ({
        lat: a.lat,
        lon: a.lon,
        name: a.name,
        distanceM: a.distanceM,
        shore: { lat: a.shore[0], lon: a.shore[1] },
      })),
    };
  });
  const linked = hills.filter((h) => h.water).length;
  return {
    file: { source: raw.source, waters: waters.map(encodeWaterBody) },
    stats: `${waters.length} of ${raw.waters.length} waters kept (${waters.filter((w) => w.name).length} named); ${linked} of ${hills.length} hills have water within 3 km`,
  };
}

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
  write('search-hills.json', searchFile),
  write('zones.json', zonesFile),
  write('profiles.json', profiles),
  write('attributions.json', attributionsFile),
  ...(water ? [write('waters.json', water.file)] : []),
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
if (water) console.log(`  water: ${water.stats}`);
console.log(`Wrote to ${args.out}:`);
for (const line of written) console.log(`  ${line}`);
