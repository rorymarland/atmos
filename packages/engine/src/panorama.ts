/**
 * What you'd see from a standpoint: the skyline all the way round, the ridgelines in front
 * of it, which named hills show, and a shading picture of the land itself. Rays march
 * outward in steps no longer than a terrain pixel, keeping the steepest angle so far
 * (allowing for the Earth's curve and light bending over the land): whatever beats it is in
 * view, and where a run of visible ground ends is a crest. Each visible patch of ground also
 * records how steep and how far away it is, in fine bands of height, so faces can be shaded:
 * steep rock darker, distant hills paler. Pure: terrain comes in as a height lookup.
 *
 * The same march works out the full circle (every 0.1°) or a narrow slice (every 0.01° or
 * so) for long lenses.
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
  /** The terrain's pixel size at a distance, km: steps are never longer. */
  resolutionKm?: (km: number) => number;
  maxKm?: number;
  /** Degrees between rays. */
  stepDeg?: number;
  /** Just a slice, from this azimuth to that (clockwise); the full circle when left out. */
  fromAz?: number;
  toAz?: number;
  /** Height bands for the shading, degrees; none when left out. */
  shadeBinDeg?: number;
  hills?: PanoramaHill[];
}

/** A crest: where visible ground ends along a ray. */
export interface RidgePoint {
  /** Ray index: azimuth = startAz + ray × stepDeg. */
  ray: number;
  altDeg: number;
  km: number;
}

export interface VisibleHill extends PanoramaHill {
  azDeg: number;
  altDeg: number;
  km: number;
}

/**
 * The land as a picture, one column per ray and one row per height band (top row highest):
 * how steep the ground showing there is (0 flat to 255 sheer) and how far away (0 here to
 * 255 at 150 km, on a square-root scale). `sky` is 255 where no ground shows.
 */
export interface PanoramaShade {
  altTop: number;
  binDeg: number;
  rows: number;
  steep: Uint8Array;
  dist: Uint8Array;
  sky: Uint8Array;
}

export interface Panorama {
  lat: number;
  lon: number;
  eyeM: number;
  /** Azimuth of ray 0. */
  startAz: number;
  stepDeg: number;
  /** The skyline's angle on each ray, degrees (−90 where nothing was found). */
  skyline: Float32Array;
  /** How far away the skyline is on each ray, km. */
  skylineKm: Float32Array;
  /** Ridgelines across neighbouring rays. */
  ridges: RidgePoint[][];
  hills: VisibleHill[];
  shade?: PanoramaShade;
}

const EYE_M = 1.7;
const KM_PER_DEG_LAT = 111.2;
const NEAR_KM = 0.05;
const SHADE_RANGE_KM = 150;
/** How far below the lowest skyline the shading reaches. */
const SHADE_DEPTH_DEG = 8;

/** Steps grow with distance (about 30 m close in), but never past a terrain pixel. */
const defaultStep = (km: number) => Math.max(0.03, km * 0.004);

/**
 * A crest counts if the ground behind it stays hidden this far: small enough to catch
 * buttresses and spurs within a face, big enough to skip every bump in the ground.
 */
const hiddenGapKm = (km: number, stepKm: number) => Math.max(3 * stepKm, km * 0.025);

export function buildPanorama(input: PanoramaInput): Panorama {
  const stepDeg = input.stepDeg ?? 0.1;
  const maxKm = input.maxKm ?? 150;
  const full = input.fromAz === undefined || input.toAz === undefined;
  const startAz = full ? 0 : ((input.fromAz! % 360) + 360) % 360;
  const span = full ? 360 : (((input.toAz! - input.fromAz!) % 360) + 360) % 360 || 360;
  const rays = Math.round(span / stepDeg) + (full ? 0 : 1);
  const { lat, lon, ground } = input;
  const eyeM = input.eyeM ?? (ground(lat, lon, 0) ?? 0) + EYE_M;
  const cosLat0 = Math.cos((lat * Math.PI) / 180);
  const resolution = input.resolutionKm;
  // Steps no longer than a terrain pixel, and (in the full circle) no shorter than the gap
  // between neighbouring rays: finer than that along a ray can't show across it.
  const across = (stepDeg * Math.PI) / 180;
  const step = resolution
    ? (km: number) =>
        Math.max(0.005, Math.min(defaultStep(km), Math.max(resolution(km), full ? km * across : 0)))
    : defaultStep;
  // Every ray steps through the same distances: work them out once.
  const distances: number[] = [];
  for (let km = NEAR_KM; km <= maxKm; km += step(km)) distances.push(km);
  const kms = Float64Array.from(distances);
  const steps = kms.map((k, i) => (kms[i + 1] ?? k + step(k)) - k);
  // The fall of the Earth's curve less refraction, in metres, at each distance.
  const drops = kms.map((k) => ((k * k) / (2 * 6371)) * 1000 * (1 - 0.13));

  // Hills by ray, so each is checked as its own ray passes it.
  const hillsByRay = new Map<number, { hill: PanoramaHill; az: number; km: number }[]>();
  for (const h of input.hills ?? []) {
    const dy = (h.lat - lat) * KM_PER_DEG_LAT;
    const dx = (h.lon - lon) * KM_PER_DEG_LAT * Math.cos((((h.lat + lat) / 2) * Math.PI) / 180);
    const km = Math.hypot(dx, dy);
    if (km < 0.2 || km > maxKm) continue;
    const az = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const off = (((az - startAz) % 360) + 360) % 360;
    let ray = Math.round(off / stepDeg);
    if (full) ray %= rays;
    if (ray >= rays) continue;
    const list = hillsByRay.get(ray) ?? [];
    list.push({ hill: h, az, km });
    hillsByRay.set(ray, list);
  }
  for (const list of hillsByRay.values()) list.sort((a, b) => a.km - b.km);

  const skyline = new Float32Array(rays).fill(-90);
  const skylineKm = new Float32Array(rays);
  const crests: { altDeg: number; km: number }[][] = [];
  const hills: VisibleHill[] = [];
  // Visible patches per ray, for the shading once the height range is known.
  const patches: Float32Array[] = [];

  for (let r = 0; r < rays; r++) {
    const b = ((startAz + r * stepDeg) * Math.PI) / 180;
    const sinB = Math.sin(b);
    const cosB = Math.cos(b);
    const onRay = hillsByRay.get(r) ?? [];
    let nextHill = 0;
    let max = -90;
    let maxAt = 0;
    let visible = false;
    let pending: { altDeg: number; km: number } | null = null;
    let lastG: number | null = null;
    let lastKm = 0;
    const found: { altDeg: number; km: number }[] = [];
    // Visible patches: from angle, to angle, steepness 0 to 1, km; repeated.
    const ray: number[] = [];

    // Compared as slopes (rise over distance) rather than angles: the same order, without an
    // arctangent at every step. `maxT` is the steepest slope so far.
    let maxT = -Infinity;
    const sinLat0 = Math.sin((lat * Math.PI) / 180);
    for (let j = 0; j < kms.length; j++) {
      const km = kms[j]!;
      const s = steps[j]!;
      // Hills the ray has reached: in view if nothing nearer rises above them.
      while (nextHill < onRay.length && onRay[nextHill]!.km <= km) {
        const { hill, az, km: hk } = onRay[nextHill++]!;
        const alt = elevationAngle(hill.metres - eyeM, hk);
        if (alt >= max - 0.05) hills.push({ ...hill, azDeg: az, altDeg: alt, km: hk });
      }
      const dLat = (km * cosB) / KM_PER_DEG_LAT;
      const pLat = lat + dLat;
      // cos(lat) a short way from the start, without a cosine at every step.
      const cos = cosLat0 - sinLat0 * ((dLat * Math.PI) / 180);
      const pLon = lon + (km * sinB) / (KM_PER_DEG_LAT * cos);
      const g = ground(pLat, pLon, km);
      if (g === null) {
        visible = false;
        lastG = null;
        continue;
      }
      const t = (g - eyeM - drops[j]!) / (km * 1000);
      if (t > maxT) {
        const a = (Math.atan(t) * 180) / Math.PI;
        maxT = t;
        // Visible again: a crest left behind counts only if enough ground behind it hid.
        if (pending) {
          if (km - pending.km >= hiddenGapKm(pending.km, s)) found.push(pending);
          pending = null;
        }
        // How steeply the ground rises here, as an angle: rock faces near 1, moor near 0.
        const rise = lastG === null ? 0 : Math.max(0, g - lastG) / ((km - lastKm) * 1000);
        ray.push(max, a, Math.atan(rise) / (Math.PI / 2), km);
        max = a;
        maxAt = km;
        visible = true;
      } else if (visible) {
        // The run of visible ground ends here: the last point was a crest.
        pending = { altDeg: max, km: maxAt };
        visible = false;
      }
      lastG = g;
      lastKm = km;
    }
    if (visible) pending = { altDeg: max, km: maxAt };
    if (pending) found.push(pending);
    skyline[r] = max;
    skylineKm[r] = maxAt;
    crests.push(found);
    patches.push(Float32Array.from(ray));
  }

  const out: Panorama = {
    lat,
    lon,
    eyeM,
    startAz,
    stepDeg,
    skyline,
    skylineKm,
    ridges: joinRidges(crests, !full),
    hills,
  };
  if (input.shadeBinDeg) out.shade = shadeOf(skyline, patches, input.shadeBinDeg);
  return out;
}

/** Turns each ray's visible patches into the shading picture. */
function shadeOf(skyline: Float32Array, patches: Float32Array[], binDeg: number): PanoramaShade {
  let hi = -90;
  let lo = 90;
  for (const a of skyline) {
    if (a <= -89) continue;
    hi = Math.max(hi, a);
    lo = Math.min(lo, a);
  }
  if (hi < lo) hi = lo = 0;
  const altTop = Math.ceil((hi + 0.5) / binDeg) * binDeg;
  const altBottom = lo - SHADE_DEPTH_DEG;
  const rows = Math.max(1, Math.ceil((altTop - altBottom) / binDeg));
  const cols = skyline.length;
  const steep = new Uint8Array(rows * cols);
  const dist = new Uint8Array(rows * cols);
  const sky = new Uint8Array(rows * cols).fill(255);
  for (let c = 0; c < cols; c++) {
    const p = patches[c]!;
    for (let i = 0; i < p.length; i += 4) {
      const from = Math.max(p[i]!, altBottom);
      const to = p[i + 1]!;
      if (to <= altBottom) continue;
      const st = Math.round(p[i + 2]! * 255);
      const d = Math.round(Math.sqrt(Math.min(1, p[i + 3]! / SHADE_RANGE_KM)) * 255);
      // Rows run from the top: row 0 is altTop.
      const r0 = Math.max(0, Math.floor((altTop - to) / binDeg));
      // Bands this patch covers: [altTop - (r + 1) × bin, altTop - r × bin] overlapping [from, to].
      const r1 = Math.min(rows - 1, Math.max(r0, Math.ceil((altTop - from) / binDeg) - 1));
      for (let r = r0; r <= r1; r++) {
        const k = r * cols + c;
        steep[k] = st;
        dist[k] = d;
        sky[k] = 0;
      }
    }
  }
  return { altTop, binDeg, rows, steep, dist, sky };
}

/**
 * Joins crests on neighbouring rays into lines: a crest continues a line from the last ray
 * when it's at about the same distance and height. Short scraps are noise in the full circle;
 * in a fine slice, the rays are close enough together that short lines are the detail.
 */
export function joinRidges(
  crests: { altDeg: number; km: number }[][],
  fine = false,
): RidgePoint[][] {
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
        if (dKm > 0.15 || dAlt > (fine ? 0.25 : 0.6)) continue;
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
  return done.filter((l) => l.length >= (fine ? 8 : 5));
}

/** The skyline's angle at any azimuth, between rays; NaN outside a slice. */
export function skylineAt(p: Panorama, azDeg: number): number {
  const n = p.skyline.length;
  const off = (((azDeg - p.startAz) % 360) + 360) % 360;
  const x = off / p.stepDeg;
  const full = Math.abs(n * p.stepDeg - 360) < 1e-6;
  if (!full && x > n - 1) return Number.NaN;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return p.skyline[i]! * (1 - f) + p.skyline[(i + 1) % n]! * f;
}
