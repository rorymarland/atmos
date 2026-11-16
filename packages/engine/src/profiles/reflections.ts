import type { ProfileDefinition } from './types.js';

export const reflections: ProfileDefinition = {
  id: 'reflections',
  factors: {
    wind: {
      label: 'Wind',
      unit: 'kmh',
      read: (ctx) => ({ value: ctx.surface('windSpeed10m') }),
    },
    gusts: {
      label: 'Gusts',
      unit: 'kmh',
      read: (ctx) => ({ value: ctx.surface('windGusts10m') }),
    },
    precipitation: {
      label: 'Rain',
      unit: 'mm',
      read: (ctx) => ({ value: ctx.surface('precipitation') }),
    },
  },
  gates: {},
};
