import { inversionStrength } from '../met.js';
import { clearanceAboveCloud, cloudSea, dewPointAt2m, mean, round } from './shared.js';
import type { ProfileDefinition } from './types.js';

/** Depth above the forecast point's ground searched for warmer air. */
const INVERSION_SEARCH_DEPTH_M = 1500;

export const inversion: ProfileDefinition = {
  id: 'inversion',
  factors: {
    inversionStrength: {
      label: 'Inversion strength',
      unit: 'celsiusDelta',
      read: (ctx) => {
        const t2 = ctx.surface('temperature2m');
        if (t2 === null) return { value: null };
        return {
          value: inversionStrength(
            ctx.profile.temperature,
            t2,
            ctx.profile.groundM,
            INVERSION_SEARCH_DEPTH_M,
          ),
        };
      },
    },
    cloudSeaClearance: {
      label: 'Summit above the cloud sea',
      unit: 'metres',
      read: (ctx) => {
        if (ctx.surface('cloudCoverLow') === null) return { value: null };
        const sea = cloudSea(ctx);
        if (!sea) return { value: null, score: 0, detail: 'no low cloud forecast' };
        return {
          value: ctx.target.altitudeM - sea.topM,
          detail: `cloud top about ${round(sea.topM, 50)} m`,
        };
      },
    },
    summitDryness: {
      label: 'Humidity at the summit',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.atTarget.relativeHumidity }),
    },
    lightWinds: {
      label: 'Wind (strongest of valley and summit)',
      unit: 'kmh',
      read: (ctx) => {
        const values = [ctx.surface('windSpeed10m'), ctx.atTarget.windKmh].filter(
          (v): v is number => v !== null,
        );
        return { value: values.length ? Math.max(...values) : null };
      },
    },
    highPressure: {
      label: 'Sea-level pressure',
      unit: 'hpa',
      read: (ctx) => ({ value: ctx.surface('pressureMsl') }),
    },
    nightCooling: {
      label: 'Mid and high cloud overnight',
      unit: 'percent',
      read: (ctx) => {
        // Roughly dusk to the small hours before a dawn window: 10 to 4 hours earlier.
        // Only cloud above the fog counts: valley fog forming overnight is the point, and
        // it would otherwise make total cloud look high on the best inversion nights.
        const values: number[] = [];
        for (let o = -10; o <= -4; o++) {
          const mid = ctx.surface('cloudCoverMid', o);
          const high = ctx.surface('cloudCoverHigh', o);
          if (mid === null && high === null) continue;
          values.push(100 * (1 - (1 - (mid ?? 0) / 100) * (1 - (high ?? 0) / 100)));
        }
        return { value: values.length >= 3 ? mean(values) : null };
      },
    },
    moisture: {
      label: 'Dew-point depression in the valley',
      unit: 'celsiusDelta',
      read: (ctx) => {
        const t = ctx.surface('temperature2m');
        const td = dewPointAt2m(ctx);
        return { value: t === null || td === null ? null : Math.max(0, t - td) };
      },
    },
  },
  gates: {
    summitClearance: {
      label: 'Summit above the cloud',
      unit: 'metres',
      read: clearanceAboveCloud,
    },
    summitWind: {
      label: 'Summit wind',
      unit: 'kmh',
      read: (ctx) => ctx.atTarget.windKmh,
    },
  },
};
