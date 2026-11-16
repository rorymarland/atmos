/**
 * Sun, moon and Milky Way geometry for night-sky and light conditions. Pure maths
 * (astronomy-engine), so it runs anywhere the engine does.
 */
import { Body, Equator, Horizon, Illumination, MakeTime, Observer } from 'astronomy-engine';

export interface SkyState {
  /** Sun altitude, degrees (negative below the horizon). */
  sunAltDeg: number;
  /** Moon altitude, degrees. */
  moonAltDeg: number;
  /** Lit fraction of the moon's disc, 0 to 1. */
  moonIllumination: number;
  /** Altitude of the galactic centre (the Milky Way core), degrees. */
  coreAltDeg: number;
}

/** Galactic centre, J2000: RA 17h 45.7m, Dec -29.0°. */
const CORE_RA_HOURS = 17.7611;
const CORE_DEC_DEG = -29.0078;

const cache = new Map<string, SkyState>();

function altitude(body: Body, date: Date, obs: Observer): number {
  const eq = Equator(body, date, obs, true, true);
  return Horizon(date, obs, eq.ra, eq.dec, 'normal').altitude;
}

/** The sky at one instant and place. Cached to the hour and 0.1°. */
export function skyAt(time: number, lat: number, lon: number): SkyState {
  const key = `${time},${lat.toFixed(1)},${lon.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const obs = new Observer(lat, lon, 0);
  const date = new Date(time);
  const at = MakeTime(date);
  const state: SkyState = {
    sunAltDeg: altitude(Body.Sun, date, obs),
    moonAltDeg: altitude(Body.Moon, date, obs),
    moonIllumination: Illumination(Body.Moon, at).phase_fraction,
    // Approximate the J2000 position as of date: precession is under 0.4° in 2026.
    coreAltDeg: Horizon(date, obs, CORE_RA_HOURS, CORE_DEC_DEG, 'normal').altitude,
  };
  if (cache.size > 50_000) cache.clear();
  cache.set(key, state);
  return state;
}

/**
 * Kp needed for the aurora to be seen low on the northern horizon at this latitude:
 * about Kp 7 in the far south of England, 5 in central Scotland, 3 in Shetland.
 */
export function kpNeeded(lat: number): number {
  return Math.min(8, Math.max(2, 7 - (lat - 52) / 2));
}
