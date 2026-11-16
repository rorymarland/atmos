import { windChill } from '../met.js';
import { cloudBase, cloudLayers, gustFactor, round } from './shared.js';
import type { ProfileDefinition } from './types.js';

export const walking: ProfileDefinition = {
  id: 'walking',
  factors: {
    summitWind: {
      label: 'Summit wind',
      unit: 'kmh',
      read: (ctx) => ({ value: ctx.atTarget.windKmh }),
    },
    precipitationProbability: {
      label: 'Chance of rain',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('precipitationProbability') }),
    },
    cloudBaseMargin: {
      label: 'Cloud base above summit',
      unit: 'metres',
      read: (ctx) => {
        const base = cloudBase(ctx);
        if (base === null) return { value: null };
        if (base === Infinity) return { value: null, score: 1, detail: 'no cloud at summit level' };
        return {
          value: base - ctx.target.altitudeM,
          detail: `cloud base about ${round(base, 50)} m`,
        };
      },
    },
    visibility: {
      label: 'Visibility',
      unit: 'km',
      read: (ctx) => {
        const v = ctx.surface('visibility');
        if (v === null) return { value: null };
        // Model visibility is for the valley floor. If every cloud layer lies below the
        // summit, poor valley visibility is fog the walk climbs out of, not a summit problem.
        const layers = cloudLayers(ctx);
        if (layers.length > 0 && layers.every((l) => l.topM < ctx.target.altitudeM)) {
          return { value: v / 1000, score: 1, detail: 'valley fog below the summit' };
        }
        return { value: v / 1000 };
      },
    },
    windChill: {
      label: 'Feels like on the summit',
      unit: 'celsius',
      read: (ctx) => {
        const { temperatureC, windKmh } = ctx.atTarget;
        return {
          value:
            temperatureC === null || windKmh === null ? null : windChill(temperatureC, windKmh),
        };
      },
    },
  },
  gates: {
    summitGusts: {
      label: 'Summit gusts',
      unit: 'kmh',
      read: (ctx) => {
        const w = ctx.atTarget.windKmh;
        return w === null ? null : w * gustFactor(ctx);
      },
    },
  },
};
