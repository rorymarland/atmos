/**
 * Forecast zones: validation and hill-to-zone assignment.
 */
import { z } from 'zod';
import { nearest, type Hill, type Zone } from '@atmos/engine';
import type { UnzonedHill } from './hills.js';

const point = z.strictObject({
  lat: z.number().min(49.8).max(61),
  lon: z.number().min(-8.7).max(2),
});

export const zonesConfigSchema = z.strictObject({
  maxAssignKm: z.number().positive(),
  zones: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z0-9-]+$/, 'zone ids are lower-case kebab-case'),
        name: z.string().min(1),
        nation: z.enum(['scotland', 'england', 'wales', 'northern-ireland']),
        forecastPoint: point,
      }),
    )
    .min(1),
});

export type ZonesConfig = z.infer<typeof zonesConfigSchema>;

export function parseZones(input: unknown): ZonesConfig {
  const config = zonesConfigSchema.parse(input);
  const seen = new Set<string>();
  for (const z of config.zones) {
    if (seen.has(z.id)) throw new Error(`Duplicate zone id "${z.id}" in config/zones.yaml`);
    seen.add(z.id);
  }
  return config;
}

export interface AssignResult {
  hills: Hill[];
  unzoned: number;
  perZone: Record<string, number>;
}

/** Assigns each hill to the nearest zone forecast point within `maxKm`, else -1. */
export function assignZones(hills: UnzonedHill[], zones: Zone[], maxKm: number): AssignResult {
  const points = zones.map((z) => z.forecastPoint);
  const perZone: Record<string, number> = Object.fromEntries(zones.map((z) => [z.id, 0]));
  let unzoned = 0;
  const assigned = hills.map((h) => {
    const hit = nearest(h, points);
    const zone = hit && hit.km <= maxKm ? hit.index : -1;
    if (zone === -1) unzoned++;
    else perZone[zones[zone]!.id]!++;
    return { ...h, zone };
  });
  return { hills: assigned, unzoned, perZone };
}
