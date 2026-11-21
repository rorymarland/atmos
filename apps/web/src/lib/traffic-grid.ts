/**
 * Air traffic at cruise height, from the alerts container's OpenSky samples: how many
 * aircraft are usually within about 60 km of a place at each hour of the day, and whether
 * that's quiet, typical or busy for the UK. Used to sharpen the plane trail risk. Shared by
 * the website and the alerts service; no DOM, no network.
 */

export interface TrafficGrid {
  /** Enough samples (three weeks, every hour) to be used. */
  ready: boolean;
  days: number;
  latMin: number;
  lonMin: number;
  cellDeg: number;
  rows: number;
  cols: number;
  /** Average aircraft per snapshot, by UTC hour then cell (row-major from the south-west). */
  perHour: number[][];
  /** Aircraft per cell around a place: at or below the first is quiet, at or above the second busy. */
  thresholds: [number, number];
}

export type TrafficLevel = 'quiet' | 'typical' | 'busy';

/** Sampling needed before traffic is used: three weeks, and every hour seen often. */
export const READY_DAYS = 21;
export const READY_SAMPLES_PER_HOUR = 20;

/** How far trails are usually noticed: about 60 km. */
const RADIUS_KM = 60;

function neighbourhood(
  g: Pick<TrafficGrid, 'rows' | 'cols' | 'cellDeg' | 'latMin' | 'lonMin'>,
  row: number,
  col: number,
): number[] {
  const lat = g.latMin + (row + 0.5) * g.cellDeg;
  const dr = Math.ceil(RADIUS_KM / 111 / g.cellDeg);
  const dc = Math.ceil(RADIUS_KM / (111 * Math.cos((lat * Math.PI) / 180)) / g.cellDeg);
  const out: number[] = [];
  for (let r = Math.max(0, row - dr); r <= Math.min(g.rows - 1, row + dr); r++) {
    for (let c = Math.max(0, col - dc); c <= Math.min(g.cols - 1, col + dc); c++) {
      out.push(r * g.cols + c);
    }
  }
  return out;
}

const sum = (row: number[], cells: number[]) => cells.reduce((a, c) => a + (row[c] ?? 0), 0);
/** Per cell, so places near the edge of the grid (fewer cells around them) compare fairly. */
const density = (row: number[], cells: number[]) =>
  cells.length ? sum(row, cells) / cells.length : 0;

/** The quiet and busy cut-offs: the lower and upper thirds of every place and hour. */
export function trafficThresholds(
  g: Pick<TrafficGrid, 'rows' | 'cols' | 'cellDeg' | 'latMin' | 'lonMin' | 'perHour'>,
): [number, number] {
  const totals: number[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const cells = neighbourhood(g, r, c);
      for (const row of g.perHour) totals.push(density(row, cells));
    }
  }
  totals.sort((a, b) => a - b);
  const at = (q: number) => totals[Math.floor(q * (totals.length - 1))] ?? 0;
  return [at(1 / 3), at(2 / 3)];
}

/** Traffic near a place at a time, or null when the grid isn't ready or doesn't cover it. */
export function trafficAt(
  g: TrafficGrid | null,
  lat: number,
  lon: number,
  time: number,
): { level: TrafficLevel; aircraft: number } | null {
  if (!g?.ready) return null;
  const row = Math.floor((lat - g.latMin) / g.cellDeg);
  const col = Math.floor((lon - g.lonMin) / g.cellDeg);
  if (row < 0 || row >= g.rows || col < 0 || col >= g.cols) return null;
  const hour = new Date(time).getUTCHours();
  const cells = neighbourhood(g, row, col);
  const aircraft = sum(g.perHour[hour] ?? [], cells);
  const d = density(g.perHour[hour] ?? [], cells);
  const [quiet, busy] = g.thresholds;
  // A little slack, so rounding noise around equal cut-offs doesn't read as busy.
  const level: TrafficLevel = d <= quiet * 1.05 ? 'quiet' : d >= busy * 1.05 ? 'busy' : 'typical';
  return { level, aircraft: Math.round(aircraft * 10) / 10 };
}
