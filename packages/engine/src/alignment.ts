/**
 * Where to stand for the sun or moon to sit on a summit: for each moment the body is low in
 * the sky, the place along the line back from the peak where the summit appears at exactly
 * the body's height. Allows for the Earth's curve, light bending over the land and eye
 * height, and checks nearer ground doesn't hide the summit. Pure: terrain comes in as a
 * height lookup.
 */
import { Body, Equator, Horizon, Observer } from 'astronomy-engine';

export type AlignBody = 'sun' | 'moon';

export interface AlignmentPoint {
  time: number;
  lat: number;
  lon: number;
  /** From the standpoint to the summit. */
  distanceKm: number;
  groundM: number;
  /** Direction from the standpoint to the summit (and the body), degrees from north. */
  bearingDeg: number;
  /** How high the body's centre is: the same as the summit, seen from here. */
  altDeg: number;
  phase: 'rising' | 'setting';
  /** Nearer ground hides the summit from here. */
  blocked: boolean;
}

export interface AlignmentInput {
  body: AlignBody;
  peak: { lat: number; lon: number; metres: number };
  from: number;
  to: number;
  /** Ground height in metres, or null where unknown (beyond the loaded terrain). */
  ground: (lat: number, lon: number) => number | null;
  stepMinutes?: number;
  maxKm?: number;
  /** Only times when the body is no higher than this: beyond it you'd be on the hill. */
  maxAltDeg?: number;
}

const R_KM = 6371;
/** Light bends over land about a seventh as much as the Earth curves. */
const REFRACTION_K = 0.13;
const EYE_M = 1.7;
const MIN_KM = 0.3;
const STEP_KM = 0.05;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** A point `km` from a start along a bearing, on a sphere. */
export function destination(lat: number, lon: number, bearingDeg: number, km: number) {
  const δ = km / R_KM;
  const θ = rad(bearingDeg);
  const φ1 = rad(lat);
  const λ1 = rad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: deg(λ2) };
}

/** The angle up (or down) to something `dh` metres higher, `km` away, allowing for the curve. */
export function elevationAngle(dh: number, km: number): number {
  const drop = ((km * km) / (2 * R_KM)) * 1000 * (1 - REFRACTION_K);
  return deg(Math.atan2(dh - drop, km * 1000));
}

/** Where the body is from a place: azimuth and apparent altitude of its centre. */
export function bodyAt(body: AlignBody, time: number, lat: number, lon: number, heightM = 0) {
  const date = new Date(time);
  const obs = new Observer(lat, lon, heightM);
  const eq = Equator(body === 'sun' ? Body.Sun : Body.Moon, date, obs, true, true);
  const h = Horizon(date, obs, eq.ra, eq.dec, 'normal');
  return { az: h.azimuth, alt: h.altitude };
}

interface Standpoint {
  lat: number;
  lon: number;
  km: number;
  groundM: number;
  blocked: boolean;
}

/**
 * Walking back from the summit along `facing` reversed, every place the summit appears at
 * `altDeg`: often one, but a nearer ridge can give a close spot as well as a far one behind
 * it. Sea and unknown ground are skipped.
 */
function standpointsFor(
  input: AlignmentInput,
  facing: number,
  altDeg: number,
  maxKm: number,
): Standpoint[] {
  const { peak, ground } = input;
  const back = (facing + 180) % 360;
  const out: Standpoint[] = [];
  let prev: { km: number; angle: number } | null = null;
  for (let km = MIN_KM; km <= maxKm; km += STEP_KM) {
    const p = destination(peak.lat, peak.lon, back, km);
    const g = ground(p.lat, p.lon);
    if (g === null) {
      prev = null;
      continue;
    }
    const angle = elevationAngle(peak.metres - (g + EYE_M), km);
    if (prev && prev.angle >= altDeg && angle < altDeg && g > 0.5) {
      const f = (prev.angle - altDeg) / (prev.angle - angle);
      const at = prev.km + f * (km - prev.km);
      const s = destination(peak.lat, peak.lon, back, at);
      const groundM = ground(s.lat, s.lon) ?? g;
      out.push({ ...s, km: at, groundM, blocked: hidden(input, s, groundM, facing, at, altDeg) });
    }
    prev = { km, angle };
  }
  return out;
}

/** Whether ground between a standpoint and the summit rises above the line to it. */
function hidden(
  input: AlignmentInput,
  s: { lat: number; lon: number },
  groundM: number,
  facing: number,
  km: number,
  altDeg: number,
): boolean {
  const eye = groundM + EYE_M;
  // Stop short of the summit itself: its own slopes are what you're looking at.
  for (let x = STEP_KM * 2; x < km - 0.25; x += STEP_KM * 2) {
    const q = destination(s.lat, s.lon, facing, x);
    const g = input.ground(q.lat, q.lon);
    if (g !== null && elevationAngle(g - eye, x) > altDeg + 0.05) return true;
  }
  return false;
}

/**
 * Every standpoint, a few minutes apart, from which the body's centre sits on the summit:
 * rising and setting, and in winter all day while the sun stays low. A moment can have more
 * than one: a nearby ridge and farther ground behind it (often hidden by that ridge).
 */
export function findAlignments(input: AlignmentInput): AlignmentPoint[] {
  const step = (input.stepMinutes ?? 2) * 60_000;
  const maxKm = input.maxKm ?? 40;
  const maxAlt = input.maxAltDeg ?? 15;
  const { peak } = input;
  const out: AlignmentPoint[] = [];
  for (let t = input.from; t <= input.to; t += step) {
    const sky = bodyAt(input.body, t, peak.lat, peak.lon);
    // Below the horizon or too high to frame behind a summit.
    if (sky.alt < -0.6 || sky.alt > maxAlt) continue;
    const later = bodyAt(input.body, t + 60_000, peak.lat, peak.lon);
    const phase = later.alt >= sky.alt ? 'rising' : 'setting';
    for (const first of standpointsFor(input, sky.az, sky.alt, maxKm)) {
      // Look again from the place itself: the sky shifts about 0.3° in 40 km, which
      // matters when the sun is half a degree across.
      const there = bodyAt(input.body, t, first.lat, first.lon, first.groundM);
      const near = standpointsFor(input, there.az, there.alt, maxKm);
      const s = near.reduce<Standpoint | null>(
        (best, c) => (!best || Math.abs(c.km - first.km) < Math.abs(best.km - first.km) ? c : best),
        null,
      );
      if (!s) continue;
      const final = bodyAt(input.body, t, s.lat, s.lon, s.groundM);
      if (final.alt < -0.6) continue;
      out.push({
        time: t,
        lat: s.lat,
        lon: s.lon,
        distanceKm: Math.round(s.km * 100) / 100,
        groundM: Math.round(s.groundM),
        bearingDeg: Math.round(final.az * 10) / 10,
        altDeg: Math.round(final.alt * 100) / 100,
        phase,
        blocked: s.blocked,
      });
    }
  }
  return out;
}
