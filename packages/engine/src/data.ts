/**
 * Formats of the static data files the build pipeline generates and the app loads.
 * Hills are stored as arrays rather than objects to keep the file small.
 */

export interface HillList {
  id: string;
  label: string;
  /** Bit position in a hill's list mask. */
  bit: number;
}

export interface Hill {
  /** DoBIH hill number: stable across releases, used for links and ids. */
  number: number;
  name: string;
  lat: number;
  lon: number;
  metres: number;
  /** Bitmask of the lists this hill belongs to (see HillList.bit). */
  lists: number;
  /** Index into zones.json, or -1 when no zone is close enough. */
  zone: number;
  /** Countries the hill is in: more than one for hills on a border. */
  nations: Nation[];
}

/** [number, name, lat, lon, metres, lists, zone, nations as letters, e.g. "ES"] */
export type HillRow = [number, string, number, number, number, number, number, string?];

const NATION_LETTERS: Record<string, Nation> = {
  S: 'scotland',
  E: 'england',
  W: 'wales',
  N: 'northern-ireland',
};
const LETTER_FOR: Record<Nation, string> = {
  scotland: 'S',
  england: 'E',
  wales: 'W',
  'northern-ireland': 'N',
};

export const NATION_LABELS: Record<Nation, string> = {
  scotland: 'Scotland',
  england: 'England',
  wales: 'Wales',
  'northern-ireland': 'Northern Ireland',
};

/** "ES" to ['england', 'scotland']; unknown letters are ignored. */
export function nationsFromLetters(letters: string): Nation[] {
  return [...new Set([...letters].map((c) => NATION_LETTERS[c]).filter((n): n is Nation => !!n))];
}

export interface HillsFile {
  source: string;
  lists: HillList[];
  hills: HillRow[];
}

export function encodeHill(h: Hill): HillRow {
  return [
    h.number,
    h.name,
    h.lat,
    h.lon,
    h.metres,
    h.lists,
    h.zone,
    h.nations.map((n) => LETTER_FOR[n]).join(''),
  ];
}

export function decodeHill(row: HillRow): Hill {
  const [number, name, lat, lon, metres, lists, zone, nations] = row;
  return {
    number,
    name,
    lat,
    lon,
    metres,
    lists,
    zone,
    nations: nationsFromLetters(nations ?? ''),
  };
}

export function hillIsOnList(hill: Hill, list: HillList): boolean {
  return (hill.lists & (1 << list.bit)) !== 0;
}

export type Nation = 'scotland' | 'england' | 'wales' | 'northern-ireland';

export interface Zone {
  id: string;
  name: string;
  nation: Nation;
  /**
   * Where the zone's forecast is fetched: a low-lying valley or lochside point, so the
   * model column starts near the valley floor (where inversions and mist form) and its
   * upper levels cover the summits.
   */
  forecastPoint: { lat: number; lon: number };
}

export interface ZonesFile {
  zones: Zone[];
}

export interface Attribution {
  id: string;
  name: string;
  url: string;
  licence: string;
  use: string;
  /** Extra conditions shown with the credit, e.g. "Non-commercial use only". */
  terms?: string;
}

export interface AttributionsFile {
  attributions: Attribution[];
}
