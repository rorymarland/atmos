/**
 * Builds data/water/uk-water.json: the UK's still water of 1 ha or more from OpenStreetMap.
 * Runs on GitHub Actions (.github/workflows/water.yml), which downloads the Geofabrik UK
 * extract and pre-filters it with osmium:
 *
 *   tsx scripts/build-water.ts --water water.geojsonseq --parking parking.geojsonseq \
 *     --source "Geofabrik united-kingdom 2026-11-17" [--out data/water/uk-water.json]
 */
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import {
  encodeWater,
  isPublicParking,
  MIN_HECTARES,
  nearestParking,
  PointGrid,
  polygonsOf,
  toWater,
  type Parking,
  type Water,
  type WaterFile,
} from './lib/water.js';

const ROOT = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();
const { values: args } = parseArgs({
  args: argv,
  options: {
    water: { type: 'string' },
    parking: { type: 'string' },
    source: { type: 'string', default: 'OpenStreetMap' },
    out: { type: 'string', default: join(ROOT, 'data/water/uk-water.json') },
  },
});
if (!args.water || !args.parking) {
  console.error(
    'Usage: build-water --water <geojsonseq> --parking <geojsonseq> [--source text] [--out file]',
  );
  process.exit(1);
}

interface Feature {
  id?: string | number;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
}

/** GeoJSON text sequences: one feature per line, sometimes with a leading RS character. */
async function* features(path: string): AsyncGenerator<Feature> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = (raw.startsWith(String.fromCharCode(0x1e)) ? raw.slice(1) : raw).trim();
    if (line) yield JSON.parse(line) as Feature;
  }
}

const tagsOf = (f: Feature): Record<string, string> =>
  Object.fromEntries(
    Object.entries(f.properties ?? {})
      .filter(([k]) => !k.startsWith('@'))
      .map(([k, v]) => [k, String(v)]),
  );

const parkings: Parking[] = [];
for await (const f of features(args.parking)) {
  const tags = tagsOf(f);
  if (!f.geometry || !isPublicParking(tags)) continue;
  let lat: number;
  let lon: number;
  if (f.geometry.type === 'Point') {
    [lon, lat] = f.geometry.coordinates as [number, number];
  } else {
    const ring = polygonsOf(f.geometry)[0]?.[0];
    if (!ring?.length) continue;
    lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  }
  parkings.push({ lat, lon, name: (tags.name ?? '').trim() });
}
console.log(`Car parks: ${parkings.length}`);
const grid = new PointGrid(parkings);

const waters: Water[] = [];
let seen = 0;
for await (const f of features(args.water)) {
  seen++;
  if (!f.geometry) continue;
  const props = f.properties ?? {};
  const id = String(f.id ?? `${props['@type'] ?? 'x'}${props['@id'] ?? seen}`);
  const w = toWater({ id, tags: tagsOf(f), polygons: polygonsOf(f.geometry) });
  if (w) waters.push(w);
  if (seen % 20000 === 0) console.log(`  ${seen} read, ${waters.length} kept`);
}
waters.sort((a, b) => b.ha - a.ha);

let withParking = 0;
const rows = waters.map((w) => {
  const park = nearestParking(w, grid);
  if (park) withParking++;
  return encodeWater(w, park);
});

const file: WaterFile = {
  source: args.source!,
  generated: new Date().toISOString().slice(0, 10),
  minHectares: MIN_HECTARES,
  waters: rows,
};
mkdirSync(dirname(args.out!), { recursive: true });
const json = JSON.stringify(file);
writeFileSync(args.out!, json);
const named = waters.filter((w) => w.name).length;
console.log(
  `Read ${seen} water features; kept ${waters.length} of ${MIN_HECTARES} ha or more ` +
    `(${named} named, ${withParking} with a car park within 1.5 km). ` +
    `${(json.length / 1e6).toFixed(1)} MB -> ${args.out}`,
);
