/**
 * The alignment finder's state: where to stand for the sun or moon to sit on the open hill's
 * summit, on the day being looked at. Worked out on demand from Mapterhorn terrain; shared
 * by the hill sheet (the list) and the map (the points).
 */
import { findAlignments, skyAt, type AlignBody, type AlignmentPoint } from '@atmos/engine';
import { loadTerrain } from './route-search';
import { londonMidnight } from './time';

export interface AlignmentResult {
  hill: number;
  body: AlignBody;
  dayOffset: number;
  status: 'loading' | 'ready' | 'failed';
  /** Standpoints the summit can be seen from, in time order. */
  points: AlignmentPoint[];
  /** How many more nearer ground hides the summit from. */
  hidden: number;
  /** The moon's lit fraction that day, 0 to 1. */
  moonLit?: number;
}

/** Far enough for a 1,000 m summit with the sun just up; Terrarium zoom 10 is about 40 m. */
const RADIUS_KM = 40;
const ZOOM = 10;

class AlignmentState {
  current = $state.raw<AlignmentResult | null>(null);
  #run = 0;

  async find(
    hill: { number: number; lat: number; lon: number; metres: number },
    body: AlignBody,
    dayOffset: number,
  ) {
    const run = ++this.#run;
    const base = { hill: hill.number, body, dayOffset, points: [], hidden: 0 };
    this.current = { ...base, status: 'loading' };
    try {
      const ground = await loadTerrain(hill.lat, hill.lon, RADIUS_KM + 1, ZOOM);
      const from = londonMidnight(dayOffset);
      const all = findAlignments({
        body,
        peak: hill,
        from,
        to: from + 24 * 3_600_000,
        ground,
        maxKm: RADIUS_KM,
      });
      if (run !== this.#run) return;
      this.current = {
        ...base,
        status: 'ready',
        points: all.filter((p) => !p.blocked),
        hidden: all.filter((p) => p.blocked).length,
        ...(body === 'moon'
          ? { moonLit: skyAt(from + 12 * 3_600_000, hill.lat, hill.lon).moonIllumination }
          : {}),
      };
    } catch (e) {
      console.warn('Alignment:', e);
      if (run === this.#run) this.current = { ...base, status: 'failed' };
    }
  }

  clear() {
    this.#run++;
    this.current = null;
  }
}

export const alignment = new AlignmentState();

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass point for a bearing: "NE". */
export function compass(bearingDeg: number): string {
  return POINTS[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8]!;
}
