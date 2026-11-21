/**
 * Photography conditions beyond inversions, skies and reflections: valley mist, hoar
 * frost, snow on the tops, clear air, dramatic light, waterfalls, the night sky and the
 * aurora. Thresholds and weights live in config/profiles.yaml.
 */
import { kpNeeded } from '../astro.js';
import { freezingLevelAt } from '../vertical.js';
import type { HourContext } from '../context.js';
import { cloudBase, dewPointAt2m, haze, horizonClear, mean, round } from './shared.js';
import type { FactorDefinition, ProfileDefinition } from './types.js';

/** Snow usually falls to about 300 m below the freezing level. */
const SNOW_BELOW_FREEZING_LEVEL_M = 300;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const valleyWind: FactorDefinition = {
  label: 'Valley wind',
  unit: 'kmh',
  read: (ctx) => ({ value: ctx.surface('windSpeed10m') }),
};
const rainNow: FactorDefinition = {
  label: 'Rain',
  unit: 'mm',
  read: (ctx) => ({ value: ctx.surface('precipitation') }),
};
const visibilityKm = (ctx: HourContext): number | null => {
  const v = ctx.surface('visibility');
  return v === null ? null : v / 1000;
};
const dewGap = (ctx: HourContext): number | null => {
  const t = ctx.surface('temperature2m');
  const td = dewPointAt2m(ctx);
  return t === null || td === null ? null : Math.max(0, t - td);
};
const cloudBaseMargin: FactorDefinition = {
  label: 'Cloud base above the summit',
  unit: 'metres',
  read: (ctx) => {
    const base = cloudBase(ctx);
    if (base === null) return { value: null };
    if (base === Infinity) return { value: null, score: 1, detail: 'summit clear of cloud' };
    return { value: base - ctx.target.altitudeM, detail: `cloud base about ${round(base, 50)} m` };
  },
};
/** Total cloud in the hours before, as a mean: clear nights cool fastest. */
const overnightCloud = (label: string): FactorDefinition => ({
  label,
  unit: 'percent',
  read: (ctx) => {
    const values = ctx.surfaceRange('cloudCover', -8, -1);
    return { value: values.length >= 3 ? mean(values) : null };
  },
});
const darkness: FactorDefinition = {
  label: 'Sun below the horizon',
  unit: 'degrees',
  read: (ctx) => (ctx.sky ? { value: -ctx.sky.sunAltDeg } : { value: null }),
};
const moonlight: FactorDefinition = {
  label: 'Moonlight',
  unit: 'percent',
  read: (ctx) => {
    const s = ctx.sky;
    if (!s) return { value: null };
    if (s.moonAltDeg < 0) return { value: 0, detail: 'moon below the horizon' };
    return {
      value: 100 * s.moonIllumination,
      detail: `moon ${Math.round(s.moonAltDeg)}° up, ${Math.round(100 * s.moonIllumination)}% lit`,
    };
  },
};

export const mist: ProfileDefinition = {
  id: 'mist',
  factors: {
    humidity: {
      label: 'Valley humidity',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('relativeHumidity2m') }),
    },
    dewGap: {
      label: 'Dew-point gap',
      unit: 'celsiusDelta',
      read: (ctx) => ({ value: dewGap(ctx) }),
    },
    wind: valleyWind,
    visibility: {
      label: 'Visibility',
      unit: 'km',
      read: (ctx) => ({ value: visibilityKm(ctx) }),
    },
    clearNight: overnightCloud('Cloud overnight'),
  },
  gates: {
    rain: { label: 'Rain', unit: 'mm', read: (ctx) => ctx.surface('precipitation') },
  },
};

export const frost: ProfileDefinition = {
  id: 'frost',
  factors: {
    overnightLow: {
      label: 'Overnight low in the valley',
      unit: 'celsius',
      read: (ctx) => {
        const values = ctx.surfaceRange('temperature2m', -8, 0);
        return { value: values.length >= 3 ? Math.min(...values) : null };
      },
    },
    clearNight: overnightCloud('Cloud overnight'),
    humidity: {
      label: 'Valley humidity',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('relativeHumidity2m') }),
    },
    wind: valleyWind,
  },
  gates: {},
};

export const snow: ProfileDefinition = {
  id: 'snow',
  factors: {
    freshSnow: {
      label: 'Snow on the summit in the last 36 hours',
      unit: 'mm',
      read: (ctx) => {
        let total = 0;
        let hours = 0;
        for (let o = -36; o <= 0; o++) {
          const p = ctx.surface('precipitation', o);
          const fl = freezingLevelAt(ctx.forecast, ctx.i + o);
          if (p === null || fl === null) continue;
          hours++;
          if (fl - SNOW_BELOW_FREEZING_LEVEL_M <= ctx.target.altitudeM) total += p;
        }
        if (hours < 12) return { value: null };
        return { value: total, detail: 'as rain-equivalent' };
      },
    },
    snowLine: {
      label: 'Freezing level below the summit',
      unit: 'metres',
      read: (ctx) => {
        const fl = freezingLevelAt(ctx.forecast, ctx.i);
        return fl === null
          ? { value: null }
          : { value: ctx.target.altitudeM - fl, detail: `freezing level about ${round(fl, 50)} m` };
      },
    },
    cloudBase: cloudBaseMargin,
    sunshine: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCover') }),
    },
  },
  gates: {
    rain: { label: 'Rain', unit: 'mm', read: (ctx) => ctx.surface('precipitation') },
  },
};

export const clarity: ProfileDefinition = {
  id: 'clarity',
  factors: {
    visibility: { label: 'Visibility', unit: 'km', read: (ctx) => ({ value: visibilityKm(ctx) }) },
    dryAir: {
      label: 'Dew-point gap (dry, clean air)',
      unit: 'celsiusDelta',
      read: (ctx) => ({ value: dewGap(ctx) }),
    },
    summitHumidity: {
      label: 'Humidity at the summit',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.atTarget.relativeHumidity }),
    },
    cloudBase: cloudBaseMargin,
    rain: rainNow,
    haze,
  },
  gates: {},
};

export const dramatic: ProfileDefinition = {
  id: 'dramatic',
  factors: {
    brokenCloud: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCover') }),
    },
    showersNearby: {
      label: 'Showers within three hours',
      unit: 'mm',
      read: (ctx) => {
        const values = [
          ...ctx.surfaceRange('showers', -3, 3),
          ...ctx.surfaceRange('precipitation', -3, 3),
        ];
        return { value: values.length ? Math.max(...values) : null };
      },
    },
    dryNow: rainNow,
    horizonClear,
    haze,
    movingSky: {
      label: 'Wind (moving sky)',
      unit: 'kmh',
      read: (ctx) => ({ value: ctx.surface('windSpeed10m') }),
    },
    visibility: { label: 'Visibility', unit: 'km', read: (ctx) => ({ value: visibilityKm(ctx) }) },
  },
  gates: {
    totalCloud: { label: 'Total cloud', unit: 'percent', read: (ctx) => ctx.surface('cloudCover') },
  },
};

export const waterfalls: ProfileDefinition = {
  id: 'waterfalls',
  factors: {
    recentRain: {
      label: 'Rain in the last 36 hours',
      unit: 'mm',
      read: (ctx) => {
        const values = ctx.surfaceRange('precipitation', -36, 0);
        return { value: values.length >= 12 ? sum(values) : null };
      },
    },
    rain: rainNow,
  },
  gates: {},
};

export const astro: ProfileDefinition = {
  id: 'astro',
  factors: {
    clearSky: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCover') }),
    },
    darkness,
    moonlight,
    core: {
      label: 'Milky Way core above the horizon',
      unit: 'degrees',
      read: (ctx) => (ctx.sky ? { value: ctx.sky.coreAltDeg } : { value: null }),
    },
    transparency: {
      label: 'Valley humidity (haze and dew)',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('relativeHumidity2m') }),
    },
  },
  gates: {
    totalCloud: { label: 'Total cloud', unit: 'percent', read: (ctx) => ctx.surface('cloudCover') },
  },
};

export const aurora: ProfileDefinition = {
  id: 'aurora',
  factors: {
    activity: {
      label: 'Geomagnetic activity above what this latitude needs',
      unit: 'kp',
      read: (ctx) => {
        const kp = ctx.extras.kp?.(ctx.time) ?? null;
        if (kp === null || ctx.target.lat === undefined) {
          return { value: null, score: 0, detail: 'no Kp forecast this far ahead' };
        }
        const need = kpNeeded(ctx.target.lat);
        return {
          value: kp - need,
          detail: `Kp ${kp.toFixed(1)} forecast, about ${need.toFixed(0)} needed here`,
        };
      },
    },
    clearSky: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCover') }),
    },
    darkness,
    moonlight,
  },
  gates: {},
};

/** A pressure-level value at this hour, e.g. wind at 850 hPa. */
function level(
  ctx: HourContext,
  label: string,
  field: 'temperatureC' | 'relativeHumidity' | 'windSpeedKmh',
): number | null {
  const l = ctx.forecast.levels.find((x) => x.label === label);
  return l?.[field][ctx.i] ?? null;
}

/** Freshly fallen snow on the summit over the last two days, as rain-equivalent mm. */
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

export const alpenglow: ProfileDefinition = {
  id: 'alpenglow',
  factors: {
    freshSnow,
    cold: {
      label: 'Freezing level below the summit',
      unit: 'metres',
      read: (ctx) => {
        const fl = freezingLevelAt(ctx.forecast, ctx.i);
        return fl === null ? { value: null } : { value: ctx.target.altitudeM - fl };
      },
    },
    cloudBase: cloudBaseMargin,
    horizonClear,
    skyAbove: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCover') }),
    },
  },
  gates: {
    rain: { label: 'Rain', unit: 'mm', read: (ctx) => ctx.surface('precipitation') },
  },
};

export const lenticular: ProfileDefinition = {
  id: 'lenticular',
  factors: {
    ridgeWind: {
      label: 'Wind at about 1,500 m (850 hPa)',
      unit: 'kmh',
      read: (ctx) => ({ value: level(ctx, '850hPa', 'windSpeedKmh') }),
    },
    stability: {
      label: 'Cooling from 925 to 850 hPa (less is more stable)',
      unit: 'celsiusDelta',
      read: (ctx) => {
        const lower = level(ctx, '925hPa', 'temperatureC');
        const upper = level(ctx, '850hPa', 'temperatureC');
        return lower === null || upper === null ? { value: null } : { value: lower - upper };
      },
    },
    moisture: {
      label: 'Humidity at 850 hPa',
      unit: 'percent',
      read: (ctx) => ({ value: level(ctx, '850hPa', 'relativeHumidity') }),
    },
    lowCloud: {
      label: 'Low cloud (in the way)',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCoverLow') }),
    },
    rain: rainNow,
  },
  gates: {},
};

export const frozen: ProfileDefinition = {
  id: 'frozen',
  factors: {
    coldSpell: {
      label: 'Average temperature over the last three days',
      unit: 'celsius',
      read: (ctx) => {
        const values = ctx.surfaceRange('temperature2m', -72, 0);
        return values.length >= 36 ? { value: mean(values) } : { value: null };
      },
    },
    frostHours: {
      label: 'Hours below freezing in the last three days',
      unit: 'hours',
      read: (ctx) => {
        const values = ctx.surfaceRange('temperature2m', -72, 0);
        return values.length >= 36
          ? { value: values.filter((t) => t < 0).length }
          : { value: null };
      },
    },
    stillAir: valleyWind,
    rain: rainNow,
  },
  gates: {},
};

/** Midges fly from late May to September, peaking in July and August. */
function midgeSeason(time: number): number {
  const m = new Date(time).getUTCMonth(); // 0 = January
  return [0, 0, 0, 0, 0.3, 0.8, 1, 1, 0.7, 0.2, 0, 0][m]!;
}

/**
 * Midge risk, not a photo condition: high when it's warm, damp and still around dawn and
 * dusk in season. A higher score means more midges.
 */
export const midges: ProfileDefinition = {
  id: 'midges',
  factors: {
    season: {
      label: 'Midge season',
      unit: 'percent',
      read: (ctx) => ({ value: 100 * midgeSeason(ctx.time) }),
    },
    warmth: {
      label: 'Temperature',
      unit: 'celsius',
      read: (ctx) => ({ value: ctx.surface('temperature2m') }),
    },
    calm: valleyWind,
    damp: {
      label: 'Humidity',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('relativeHumidity2m') }),
    },
  },
  gates: {
    rain: { label: 'Heavy rain', unit: 'mm', read: (ctx) => ctx.surface('precipitation') },
  },
};
