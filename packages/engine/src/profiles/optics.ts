/**
 * Conditions made by the sun's angle as much as the weather: Brocken spectres and glories,
 * rainbows, fresh snow under a blue sky, and noctilucent clouds. Thresholds and weights live
 * in config/profiles.yaml.
 */
import { freezingLevelAt } from '../vertical.js';
import type { HourContext } from '../context.js';
import { clearanceAboveCloud, cloudSea, horizonClear, round } from './shared.js';
import type { FactorDefinition, GateDefinition, ProfileDefinition } from './types.js';

/** Snow usually falls to about 300 m below the freezing level. */
const SNOW_BELOW_FREEZING_LEVEL_M = 300;

const sunAltitude = (ctx: HourContext): number | null => ctx.sky?.sunAltDeg ?? null;

const sunAngle = (label: string): FactorDefinition => ({
  label,
  unit: 'degrees',
  read: (ctx) => ({ value: sunAltitude(ctx) }),
});
const sunUp: GateDefinition = {
  label: 'Sun above the horizon',
  unit: 'degrees',
  read: sunAltitude,
};
const totalCloud = (label: string): FactorDefinition => ({
  label,
  unit: 'percent',
  read: (ctx) => ({ value: ctx.surface('cloudCover') }),
});

/** Mid and high cloud combined: what stands between a summit and the sun. */
function cloudAbove(ctx: HourContext): number | null {
  const mid = ctx.surface('cloudCoverMid');
  const high = ctx.surface('cloudCoverHigh');
  if (mid === null && high === null) return null;
  return 100 * (1 - (1 - (mid ?? 0) / 100) * (1 - (high ?? 0) / 100));
}

/**
 * Your shadow on the cloud below, ringed by a glory: from a clear summit with a low sun
 * behind you and cloud or mist a little below. The shadow falls as far below level as the
 * sun is above it, so a low sun and cloud just under the summit work best.
 */
export const brocken: ProfileDefinition = {
  id: 'brocken',
  factors: {
    sunLow: sunAngle('Sun height'),
    cloudBelow: {
      label: 'Summit above the cloud below',
      unit: 'metres',
      read: (ctx) => {
        if (ctx.surface('cloudCoverLow') === null) return { value: null };
        const sea = cloudSea(ctx);
        if (!sea) return { value: null, score: 0, detail: 'no low cloud to throw a shadow on' };
        return {
          value: ctx.target.altitudeM - sea.topM,
          detail: `cloud top about ${round(sea.topM, 50)} m`,
        };
      },
    },
    sunVisible: {
      label: 'Mid and high cloud overhead',
      unit: 'percent',
      read: (ctx) => ({ value: cloudAbove(ctx) }),
    },
    sunGap: horizonClear,
    lightWind: {
      label: 'Summit wind',
      unit: 'kmh',
      read: (ctx) => ({ value: ctx.atTarget.windKmh }),
    },
  },
  gates: {
    summitClearance: { label: 'Summit above the cloud', unit: 'metres', read: clearanceAboveCloud },
    sunUp,
  },
};

/**
 * A rainbow: showers about, the sun out behind you and below 42°, lower being better (a
 * higher, fuller arc). Afternoon and evening showers after a cold front are the classic.
 */
export const rainbow: ProfileDefinition = {
  id: 'rainbow',
  factors: {
    sunAngle: sunAngle('Sun height'),
    showers: {
      label: 'Showers within two hours',
      unit: 'mm',
      read: (ctx) => {
        const values = [
          ...ctx.surfaceRange('showers', -2, 2),
          ...ctx.surfaceRange('precipitation', -2, 2),
        ];
        return { value: values.length ? Math.max(...values) : null };
      },
    },
    dryNow: {
      label: 'Rain here',
      unit: 'mm',
      read: (ctx) => ({ value: ctx.surface('precipitation') }),
    },
    sunGap: horizonClear,
    brokenCloud: totalCloud('Total cloud'),
  },
  gates: {
    sunUp,
    sunLowEnough: { label: 'Sun below 42°', unit: 'degrees', read: sunAltitude },
  },
};

/** Snow on the summit over the last two days, as rain-equivalent mm. */
const freshSnow: FactorDefinition = {
  label: 'Snow on the summit in the last two days',
  unit: 'mm',
  read: (ctx) => {
    let total = 0;
    let hours = 0;
    for (let o = -48; o <= 0; o++) {
      const p = ctx.surface('precipitation', o);
      const fl = freezingLevelAt(ctx.forecast, ctx.i + o);
      if (p === null || fl === null) continue;
      hours++;
      if (fl - SNOW_BELOW_FREEZING_LEVEL_M <= ctx.target.altitudeM) total += p;
    }
    return hours < 12 ? { value: null } : { value: total, detail: 'as rain-equivalent' };
  },
};

/**
 * Fresh snow then a clear day: the snow has stopped, the sky is blue and it's cold enough on
 * top for the snow to stay crisp.
 */
export const bluebird: ProfileDefinition = {
  id: 'bluebird',
  factors: {
    freshSnow,
    snowStopped: {
      label: 'Snow or rain in the last six hours',
      unit: 'mm',
      read: (ctx) => {
        const values = ctx.surfaceRange('precipitation', -6, 0);
        return { value: values.length >= 3 ? values.reduce((a, b) => a + b, 0) : null };
      },
    },
    blueSky: totalCloud('Total cloud'),
    cold: {
      label: 'Freezing level below the summit',
      unit: 'metres',
      read: (ctx) => {
        const fl = freezingLevelAt(ctx.forecast, ctx.i);
        return fl === null
          ? { value: null }
          : { value: ctx.target.altitudeM - fl, detail: `freezing level about ${round(fl, 50)} m` };
      },
    },
    visibility: {
      label: 'Visibility',
      unit: 'km',
      read: (ctx) => {
        const v = ctx.surface('visibility');
        return { value: v === null ? null : v / 1000 };
      },
    },
  },
  gates: {
    rain: { label: 'Rain or snow', unit: 'mm', read: (ctx) => ctx.surface('precipitation') },
  },
};

/**
 * How far into the noctilucent cloud season a date is, 0 to 100: late May to early August,
 * best from mid-June to mid-July. No forecast says whether they'll form on a given night, so
 * this is how often they do.
 */
export function noctilucentSeason(time: number): number {
  const d = new Date(time);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.floor((time - start) / 86_400_000) + 1; // 1 = 1 January
  // 25 May is day 145 (146 in a leap year): a day or so either way doesn't matter here.
  const ramp: [number, number][] = [
    [140, 0],
    [160, 80],
    [167, 100],
    [197, 100],
    [210, 60],
    [222, 0],
  ];
  if (day <= ramp[0]![0] || day >= ramp[ramp.length - 1]![0]) return 0;
  for (let k = 1; k < ramp.length; k++) {
    const [d1, v1] = ramp[k]!;
    const [d0, v0] = ramp[k - 1]!;
    if (day <= d1) return Math.round(v0 + ((v1 - v0) * (day - d0)) / (d1 - d0));
  }
  return 0;
}

/**
 * Noctilucent clouds: electric-blue wisps low in the northern sky on summer nights, lit by a
 * sun 6° to 16° below the horizon. Needs a clear view north; the further north, the more
 * often they're seen.
 */
export const noctilucent: ProfileDefinition = {
  id: 'noctilucent',
  factors: {
    season: {
      label: 'Noctilucent cloud season',
      unit: 'percent',
      read: (ctx) => ({ value: noctilucentSeason(ctx.time) }),
    },
    sunDepth: {
      label: 'Sun below the horizon',
      unit: 'degrees',
      read: (ctx) => (ctx.sky ? { value: -ctx.sky.sunAltDeg } : { value: null }),
    },
    northernSky: {
      ...horizonClear,
      label: 'Cloud on the northern horizon (under the sun)',
    },
    clearSky: totalCloud('Total cloud'),
    latitude: {
      label: 'Latitude',
      unit: 'degrees',
      read: (ctx) => ({ value: ctx.target.lat ?? null }),
    },
  },
  gates: {
    inSeason: {
      label: 'In season (late May to early August)',
      unit: 'percent',
      read: (ctx) => noctilucentSeason(ctx.time),
    },
  },
};
