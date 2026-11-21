/**
 * Plane trails: whether a jet's trail forms, whether it lingers and spreads, and whether
 * you'd see it from the ground.
 *
 * - Forms (Schmidt–Appleman): the air at cruise height must be colder than a threshold
 *   that depends on pressure. The threshold here is Schumann's (1996) for liquid
 *   saturation, less 2 °C because trails in the dry-ish air of a lingering day form at a
 *   slightly colder threshold. Over the UK it's usually met at 250 and 200 hPa.
 * - Lingers: only where the air is saturated with respect to ice. ECMWF's humidity is
 *   measured against ice below −23 °C, so it can be read directly; models run dry up there,
 *   so 90% or more counts as "may linger" (research uses about 93%).
 * - Seen: thick mid or high cloud hides them.
 *
 * Humidity forecasts at these heights are uncertain, so this is a risk, not a promise.
 */

export type TrailLinger = 'none' | 'brief' | 'may' | 'likely';
export type TrailRisk = 'low' | 'medium' | 'high';

export interface UpperLevel {
  pressureHpa: number;
  temperatureC: number | null;
  /** Relative humidity with respect to ice, %. */
  rhIce: number | null;
}

export interface TrailAssessment {
  risk: TrailRisk;
  linger: TrailLinger;
  /** The level that decided it, if any. */
  level: (UpperLevel & { forms: boolean }) | null;
  /** Thick mid or high cloud would hide trails. */
  hidden: boolean;
  text: string;
}

/** Rough heights of the levels planes cruise at, for people. */
const LEVEL_HEIGHT: Record<number, string> = {
  300: 'about 9 km',
  250: 'about 10 km',
  200: 'about 12 km',
};

/** Engine and fuel figures for Schumann's threshold: a typical modern airliner. */
const EI_H2O = 1.25; // kg water per kg fuel
const CP = 1004; // J/kg/K
const EPSILON = 0.622;
const Q = 43.2e6; // J/kg
const ETA = 0.35; // overall propulsion efficiency

/** The warmest air, °C, in which trails still form at this pressure (liquid saturation). */
export function formationThresholdC(pressureHpa: number): number {
  const g = (EI_H2O * CP * pressureHpa * 100) / (EPSILON * Q * (1 - ETA));
  const x = Math.log(g - 0.053);
  return -46.46 + 9.43 * x + 0.72 * x * x;
}

/** Whether a trail forms in this air (with a 2 °C margin for less than saturated air). */
export function trailForms(level: UpperLevel): boolean {
  return (
    level.temperatureC !== null && level.temperatureC <= formationThresholdC(level.pressureHpa) - 2
  );
}

function lingerAt(level: UpperLevel): TrailLinger {
  if (!trailForms(level)) return 'none';
  const rh = level.rhIce ?? 0;
  return rh >= 100 ? 'likely' : rh >= 90 ? 'may' : 'brief';
}

const ORDER: Record<TrailLinger, number> = { none: 0, brief: 1, may: 2, likely: 3 };

const fmt = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n))}`;

/**
 * Trails in one hour, from the cruise levels and the mid and high cloud cover (%).
 * Null when there's no upper-air data.
 */
export function assessTrails(
  levels: UpperLevel[],
  midCloud: number | null,
  highCloud: number | null,
): TrailAssessment | null {
  const usable = levels.filter((l) => l.temperatureC !== null);
  if (usable.length === 0) return null;

  // The level where trails would last longest; ties go to the more humid.
  const worst = usable
    .map((l) => ({ ...l, forms: trailForms(l), linger: lingerAt(l) }))
    .sort((a, b) => ORDER[b.linger] - ORDER[a.linger] || (b.rhIce ?? 0) - (a.rhIce ?? 0))[0]!;
  const linger = worst.linger;
  const hidden = (midCloud ?? 0) >= 80 || (highCloud ?? 0) >= 80;

  const where = `${worst.pressureHpa} hPa (${LEVEL_HEIGHT[worst.pressureHpa] ?? 'cruise height'})`;
  const air = `${fmt(worst.temperatureC!)} °C${worst.rhIce !== null ? `, ${Math.round(worst.rhIce)}% humidity over ice` : ''}`;

  let risk: TrailRisk;
  let text: string;
  if (linger === 'none') {
    risk = 'low';
    text = `Too warm for trails to form: the air at ${where} is ${air}.`;
  } else if (hidden) {
    risk = 'low';
    text = `Mostly hidden: thick ${(highCloud ?? 0) >= 80 ? 'high' : 'mid-level'} cloud above.`;
  } else if (linger === 'likely') {
    risk = 'high';
    text = `Trails likely to linger and spread: the air at ${where} is saturated with ice (${air}).`;
  } else if (linger === 'may') {
    risk = 'medium';
    text = `Trails may linger: the air at ${where} is close to ice saturation (${air}).`;
  } else {
    risk = 'low';
    text = `Trails should fade quickly: the air at ${where} is dry (${air}).`;
  }
  return { risk, linger, level: worst, hidden, text };
}

/** Trails at the forecast hour nearest `time`, from an upper-air forecast (UPPER_REQUEST). */
export function trailsAt(
  forecast: {
    time: number[];
    surface: { cloudCoverMid?: (number | null)[]; cloudCoverHigh?: (number | null)[] };
    levels: {
      label: string;
      temperatureC: (number | null)[];
      relativeHumidity: (number | null)[];
    }[];
  },
  time: number,
): TrailAssessment | null {
  const hour = Math.floor(time / 3_600_000) * 3_600_000;
  const i = forecast.time.indexOf(hour);
  if (i < 0) return null;
  const levels: UpperLevel[] = forecast.levels.map((l) => ({
    pressureHpa: Number.parseInt(l.label, 10),
    temperatureC: l.temperatureC[i] ?? null,
    rhIce: l.relativeHumidity[i] ?? null,
  }));
  return assessTrails(
    levels,
    forecast.surface.cloudCoverMid?.[i] ?? null,
    forecast.surface.cloudCoverHigh?.[i] ?? null,
  );
}

/**
 * The trail risk with what's known about air traffic near the place at that hour: quiet
 * airspace lowers a lingering risk a step; busy airspace says so. Without traffic data, the
 * assessment is unchanged.
 */
export function withTraffic(
  a: TrailAssessment,
  traffic: { level: 'quiet' | 'typical' | 'busy'; aircraft: number } | null,
): TrailAssessment {
  if (!traffic || a.hidden || (a.linger !== 'likely' && a.linger !== 'may')) return a;
  if (traffic.level === 'quiet') {
    const risk: TrailRisk = a.risk === 'high' ? 'medium' : 'low';
    return { ...a, risk, text: `${a.text} Quiet airspace at that hour, though.` };
  }
  if (traffic.level === 'busy') {
    return { ...a, text: `${a.text} Busy airspace at that hour.` };
  }
  return a;
}
