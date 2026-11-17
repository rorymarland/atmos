/**
 * Ordnance Survey grid references (e.g. "NN 166 712") to latitude and longitude, following
 * the OS's "A guide to coordinates and coordinate systems in Great Britain": the inverse
 * Transverse Mercator on the Airy 1830 ellipsoid, then a Helmert shift from OSGB36 to WGS84.
 * Good to about 5 m, far finer than a 6-figure reference. Great Britain only: Northern
 * Ireland uses the Irish Grid, so enter latitude and longitude there.
 */

const AIRY = { a: 6377563.396, b: 6356256.909 };
const WGS84 = { a: 6378137, b: 6356752.314245 };
const F0 = 0.9996012717;
const LAT0 = (49 * Math.PI) / 180;
const LON0 = (-2 * Math.PI) / 180;
const N0 = -100_000;
const E0 = 400_000;

/** Letters of the 100 km squares, I left out. */
const LETTERS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export interface GridRef {
  easting: number;
  northing: number;
  /** The size of the square the reference names, metres (100 for 6 figures). */
  precisionM: number;
}

/**
 * Reads "NN 166 712", "NN166712", "nn 16667 71256" and the like. The point is the middle of
 * the square named, so a 6-figure reference lands within 50 m. Null when it isn't one.
 */
export function parseGridRef(text: string): GridRef | null {
  const m = text
    .toUpperCase()
    .replace(/[\s,]+/g, ' ')
    .trim()
    .match(/^([A-HJ-Z])([A-HJ-Z])\s?(\d+)(?:\s(\d+))?$/);
  if (!m) return null;
  const [, a, b, first, second] = m;
  let digits: [string, string];
  if (second !== undefined) {
    if (first!.length !== second.length) return null;
    digits = [first!, second];
  } else {
    if (first!.length % 2) return null;
    digits = [first!.slice(0, first!.length / 2), first!.slice(first!.length / 2)];
  }
  const n = digits[0].length;
  if (n < 1 || n > 5) return null;
  const l1 = LETTERS.indexOf(a!);
  const l2 = LETTERS.indexOf(b!);
  const e100 = ((l1 - 2) % 5) * 5 + (l2 % 5);
  const n100 = 19 - Math.floor(l1 / 5) * 5 - Math.floor(l2 / 5);
  if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return null;
  const precisionM = 10 ** (5 - n);
  return {
    easting: e100 * 100_000 + Number(digits[0]) * precisionM + precisionM / 2,
    northing: n100 * 100_000 + Number(digits[1]) * precisionM + precisionM / 2,
    precisionM,
  };
}

function meridionalArc(phi: number, n: number, bF0: number): number {
  const d = phi - LAT0;
  const s = phi + LAT0;
  return (
    bF0 *
    ((1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * d -
      (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(d) * Math.cos(s) +
      ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * d) * Math.cos(2 * s) -
      (35 / 24) * n ** 3 * Math.sin(3 * d) * Math.cos(3 * s))
  );
}

/** OSGB36 easting and northing to OSGB36 latitude and longitude, radians. */
export function gridToOsgb36(E: number, N: number): { phi: number; lambda: number } {
  const { a, b } = AIRY;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  let phi = LAT0;
  let M = 0;
  do {
    phi = (N - N0 - M) / (a * F0) + phi;
    M = meridionalArc(phi, n, b * F0);
  } while (Math.abs(N - N0 - M) >= 0.00001);
  const sin = Math.sin(phi);
  const nu = (a * F0) / Math.sqrt(1 - e2 * sin * sin);
  const rho = (a * F0 * (1 - e2)) / (1 - e2 * sin * sin) ** 1.5;
  const eta2 = nu / rho - 1;
  const tan = Math.tan(phi);
  const sec = 1 / Math.cos(phi);
  const t2 = tan * tan;
  const t4 = t2 * t2;
  const VII = tan / (2 * rho * nu);
  const VIII = (tan / (24 * rho * nu ** 3)) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
  const IX = (tan / (720 * rho * nu ** 5)) * (61 + 90 * t2 + 45 * t4);
  const X = sec / nu;
  const XI = (sec / (6 * nu ** 3)) * (nu / rho + 2 * t2);
  const XII = (sec / (120 * nu ** 5)) * (5 + 28 * t2 + 24 * t4);
  const XIIA = (sec / (5040 * nu ** 7)) * (61 + 662 * t2 + 1320 * t4 + 720 * t4 * t2);
  const dE = E - E0;
  return {
    phi: phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6,
    lambda: LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7,
  };
}

/** OSGB36 to WGS84 by the OS's 7-parameter Helmert transformation. */
function osgb36ToWgs84(phi: number, lambda: number): { lat: number; lon: number } {
  // To Cartesian on Airy 1830 (height 0).
  const { a: a1, b: b1 } = AIRY;
  const e2a = 1 - (b1 * b1) / (a1 * a1);
  const nu1 = a1 / Math.sqrt(1 - e2a * Math.sin(phi) ** 2);
  const x1 = nu1 * Math.cos(phi) * Math.cos(lambda);
  const y1 = nu1 * Math.cos(phi) * Math.sin(lambda);
  const z1 = (1 - e2a) * nu1 * Math.sin(phi);
  // Helmert: OSGB36 to WGS84.
  const tx = 446.448;
  const ty = -125.157;
  const tz = 542.06;
  const s = -20.4894e-6;
  const sec = Math.PI / (180 * 3600);
  const rx = 0.1502 * sec;
  const ry = 0.247 * sec;
  const rz = 0.8421 * sec;
  const x2 = tx + (1 + s) * x1 - rz * y1 + ry * z1;
  const y2 = ty + rz * x1 + (1 + s) * y1 - rx * z1;
  const z2 = tz - ry * x1 + rx * y1 + (1 + s) * z1;
  // Back to latitude and longitude on WGS84.
  const { a, b } = WGS84;
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x2 * x2 + y2 * y2);
  let lat = Math.atan2(z2, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z2 + e2 * nu * Math.sin(lat), p);
  }
  return { lat: (lat * 180) / Math.PI, lon: (Math.atan2(y2, x2) * 180) / Math.PI };
}

/** A grid reference as latitude and longitude (WGS84, as GPS and maps use), or null. */
export function gridRefToLatLon(
  text: string,
): { lat: number; lon: number; precisionM: number } | null {
  const g = parseGridRef(text);
  if (!g) return null;
  const { phi, lambda } = gridToOsgb36(g.easting, g.northing);
  const { lat, lon } = osgb36ToWgs84(phi, lambda);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    precisionM: g.precisionM,
  };
}

/**
 * Whatever someone typed for a location: a grid reference, or "lat, lon" in decimal degrees
 * (UK range only). Null when it's neither.
 */
export function parseLocation(
  text: string,
): { lat: number; lon: number; precisionM?: number } | null {
  const grid = gridRefToLatLon(text);
  if (grid) return grid;
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < 49 || lat > 61.5 || lon < -11 || lon > 2.5) return null;
  return { lat, lon };
}
