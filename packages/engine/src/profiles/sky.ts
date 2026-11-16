import { horizonClear } from './shared.js';
import type { ProfileDefinition } from './types.js';

export const sky: ProfileDefinition = {
  id: 'sky',
  factors: {
    midHighCloud: {
      label: 'Mid and high cloud',
      unit: 'percent',
      read: (ctx) => {
        const mid = ctx.surface('cloudCoverMid');
        const high = ctx.surface('cloudCoverHigh');
        if (mid === null && high === null) return { value: null };
        // Combined cover assuming the layers overlap randomly.
        const clear = (1 - (mid ?? 0) / 100) * (1 - (high ?? 0) / 100);
        return { value: 100 * (1 - clear) };
      },
    },
    horizonClear,
    lowCloud: {
      label: 'Low cloud',
      unit: 'percent',
      read: (ctx) => ({ value: ctx.surface('cloudCoverLow') }),
    },
    precipitation: {
      label: 'Rain',
      unit: 'mm',
      read: (ctx) => ({ value: ctx.surface('precipitation') }),
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
    totalCloud: {
      label: 'Total cloud',
      unit: 'percent',
      read: (ctx) => ctx.surface('cloudCover'),
    },
  },
};
