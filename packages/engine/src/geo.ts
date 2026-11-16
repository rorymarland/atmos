/** Geographic helpers. */

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371.0088;
export const KM_PER_MILE = 1.609344;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceMiles(a: LatLon, b: LatLon): number {
  return distanceKm(a, b) / KM_PER_MILE;
}

/** Straight-line distance scaled up to approximate a road distance. A rough guide only. */
export function estimatedRoadMiles(a: LatLon, b: LatLon, roadFactor = 1.35): number {
  return distanceMiles(a, b) * roadFactor;
}

/**
 * Google Maps directions link. Uses the documented Maps URLs format, which needs no
 * API key. Without an origin, Google uses the device's current location.
 */
export function googleMapsDirectionsUrl(destination: LatLon, origin?: LatLon): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lon}`,
  });
  if (origin) params.set('origin', `${origin.lat},${origin.lon}`);
  params.set('travelmode', 'driving');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Index of the nearest point and its distance in km, or null for an empty list. */
export function nearest(point: LatLon, candidates: LatLon[]): { index: number; km: number } | null {
  let best: { index: number; km: number } | null = null;
  candidates.forEach((c, index) => {
    const km = distanceKm(point, c);
    if (!best || km < best.km) best = { index, km };
  });
  return best;
}
