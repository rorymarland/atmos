/**
 * What you'd see from a standpoint: the skyline all the way round, the ridgelines in front
 * of it, and which named hills show. Rays every tenth of a degree march outward in steps
 * that grow with distance, keeping the steepest angle so far (allowing for the Earth's curve
 * and light bending over the land): whatever beats it is in view, and where a run of
 * visible ground ends is a crest. Pure: terrain comes in as a height lookup.
 */
import { elevationAngle } from './alignment.js';

export interface PanoramaHill {
  id: number;
  name: string;
  lat: number;
  lon: number;
  metres: number;
}

export interface PanoramaInput {
  lat: number;
  lon: number;
  /** Eye height above sea level, when known (a summit); otherwise the ground plus 1.7 m. */
  eyeM?: number;
  /**
   * Ground height in metres, or null where unknown. `km` is the distance from the standpoint,
   * so a lookup can use coarser terrain further out.
   */
  ground: (lat: number, lon: number, km: number) => number | null;
  maxKm?: number;
  /** Degrees between rays. */
  stepDeg?: number;
  hills?: PanoramaHill[];
}

/** A crest: where visible ground ends along a ray. */
export interface RidgePoint {
  /** Ray index: azimuth = ray × stepDeg. */
  ray: number;
  altDeg: number;
  km: number;
}

export interface VisibleHill extends PanoramaHill {
  azDeg: number;
  altDeg: number;
  km: number;
}

export interface Panorama {
  lat: number;
  lon: number;
  eyeM: number;
  stepDeg: number;
  /** The skyline's angle on each ray, degrees (−90 where nothing was found). */
  skyline: Float32Array;
  /** How far away the skyline is on each ray, km. */
  skylineKm: Float32Array;
  /** Ridgelines across neighbouring rays, nearest first within each ray. */
  ridges: RidgePoint[][];
  hills: VisibleHill[];
}

const EYE_M = 1.7;
const KM_PER_DEG_LAT = 111.2;
const NEAR_KM = 0.05;

/** Steps grow with distance: about 30 m close in, 600 m at 150 km. */
const stepAt = (km: number) => Math.max(0.03, km * 0.004);

/** A crest only counts if the ground behind it stays hidden this far (a real ridge, not a bump). */
const hiddenGapKm = (km: number) => Math.max(0.3, km * 0.08);

export function buildPanorama(input: PanoramaInput): Panorama {
  const stepDeg = input.stepDeg ?? 0.1;
  const maxKm = input.maxKm ?? 150;
  const rays = Math.round(360 / stepDeg);
  const { lat, lon, ground } = input;
  const eyeM = input.eyeM ?? (ground(lat, lon, 0) ?? 0) + EYE_M;
  const cosLat0 = Math.cos((lat * Math.PI) / 180);

  // Hills by ray, so each is checked as its own ray passes it.
  const hillsByRay = new Map<number, { hill: PanoramaHill; az: number; km: number }[]>();
  for (const h of input.hills ?? []) {
    const dy = (h.lat - lat) * KM_PER_DEG_LAT;
    const dx = (h.lon - lon) * KM_PER_DEG_LAT * Math.cos((((h.lat + lat) / 2) * Math.PI) / 180);
    const km = Math.hypot(dx, dy);
    if (km < 0.2 || km > maxKm) continue;
    const az = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const ray = Math.round(az / stepDeg) % rays;
    const list = hillsByRay.get(ray) ?? [];
    list.push({ hill: h, az, km });
    hillsByRay.set(ray, list);
  }
  for (const list of hillsByRay.values()) list.sort((a, b) => a.km - b.km);

  const skyline = new Float32Array(rays).fill(-90);
  const skylineKm = new Float32Array(rays);
  const crests: { altDeg: number; km: number }[][] = [];
  const hills: VisibleHill[] = [];

  for (let r = 0; r < rays; r++) {
    const b = (r * stepDeg * Math.PI) / 180;
    const sinB = Math.sin(b);
    const cosB = Math.cos(b);
    const onRay = hillsByRay.get(r) ?? [];
    let nextHill = 0;
    let max = -90;
    let maxKm2 = 0;
    let visible = false;
    let pending: { altDeg: number; km: number } | null = null;
    const found: { altDeg: number; km: number }[] = [];

    for (let km = NEAR_KM; km <= maxKm; km += stepAt(km)) {
      // Hills the ray has reached: in view if nothing nearer rises above them.
      while (nextHill < onRay.length && onRay[nextHill]!.km <= km) {
        const { hill, az, km: hk } = onRay[nextHill++]!;
        const alt = elevationAngle(hill.metres - eyeM, hk);
        if (alt >= max - 0.05) hills.push({ ...hill, azDeg: az, altDeg: alt, km: hk });
      }
      const pLat = lat + (km * cosB) / KM_PER_DEG_LAT;
      const cos = Math.cos((pLat * Math.PI) / 180) || cosLat0;
      const pLon = lon + (km * sinB) / (KM_PER_DEG_LAT * cos);
      const g = ground(pLat, pLon, km);
      if (g === null) {
        visible = false;
        continue;
      }
      const a = elevationAngle(g - eyeM, km);
      if (a > max) {
        // Visible again: a crest left behind counts only if enough ground behind it hid.
        if (pending) {
          if (km - pending.km >= hiddenGapKm(pending.km)) found.push(pending);
          pending = null;
        }
        max = a;
        maxKm2 = km;
        visible = true;
      } else if (visible) {
        // The run of visible ground ends here: the last point was a crest.
        pending = { altDeg: max, km: maxKm2 };
        visible = false;
      }
    }
    if (visible) pending = { altDeg: max, km: maxKm2 };
    if (pending) found.push(pending);
    skyline[r] = max;
    skylineKm[r] = maxKm2;
    crests.push(found);
  }

  return { lat, lon, eyeM, stepDeg, skyline, skylineKm, ridges: joinRidges(crests), hills };
}

/**
 * Joins crests on neighbouring rays into lines: a crest continues a line from the last ray
 * when it's at about the same distance and height. Lines shorter than five rays are noise.
 */
export function joinRidges(crests: { altDeg: number; km: number }[][]): RidgePoint[][] {
  const done: RidgePoint[][] = [];
  let active: RidgePoint[][] = [];
  for (let r = 0; r < crests.length; r++) {
    const next: RidgePoint[][] = [];
    const taken = new Set<RidgePoint[]>();
    for (const c of crests[r]!) {
      let best: RidgePoint[] | null = null;
      let bestScore = Infinity;
      for (const line of active) {
        if (taken.has(line)) continue;
        const last = line[line.length - 1]!;
        const dKm = Math.abs(last.km - c.km) / Math.max(c.km, 0.5);
        const dAlt = Math.abs(last.altDeg - c.altDeg);
        if (dKm > 0.15 || dAlt > 0.6) continue;
        const score = dKm + dAlt;
        if (score < bestScore) {
          bestScore = score;
          best = line;
        }
      }
      const p = { ray: r, altDeg: c.altDeg, km: c.km };
      if (best) {
        best.push(p);
        taken.add(best);
        next.push(best);
      } else next.push([p]);
    }
    for (const line of active) if (!taken.has(line)) done.push(line);
    active = next;
  }
  done.push(...active);
  return done.filter((l) => l.length >= 5);
}

/** The skyline's angle at any azimuth, between rays. */
export function skylineAt(p: Panorama, azDeg: number): number {
  const n = p.skyline.length;
  const x = ((((azDeg % 360) + 360) % 360) / p.stepDeg) % n;
  const i = Math.floor(x);
  const f = x - i;
  return p.skyline[i]! * (1 - f) + p.skyline[(i + 1) % n]! * f;
}
