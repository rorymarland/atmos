/**
 * What an alert is. Shared by everyone on the LAN: the only thing that's anyone's own is
 * the email address an alert goes to.
 */
import { z } from 'zod';

export const PERIODS = ['morning', 'day', 'evening', 'night'] as const;

/** A hill by DoBIH number, or a loch by its OpenStreetMap id (stable across data rebuilds). */
export const placeRef = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('hill'),
    number: z.number().int().positive(),
    name: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal('water'), id: z.string().min(1), name: z.string().min(1) }),
  /** A custom place, by its id in places.json. */
  z.strictObject({ kind: z.literal('custom'), id: z.string().min(1), name: z.string().min(1) }),
]);
export type PlaceRef = z.infer<typeof placeRef>;

export const delivery = z.discriminatedUnion('mode', [
  /** As soon as a check finds something new (held overnight until 06:00). */
  z.strictObject({ mode: z.literal('asap') }),
  /** Once a day at a local time, a summary of everything that matches. */
  z.strictObject({ mode: z.literal('daily'), at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
]);
export type Delivery = z.infer<typeof delivery>;

/** What the browser sends to create or change an alert. */
export const alertInput = z.strictObject({
  email: z.email().max(200),
  label: z.string().max(80).optional(),
  places: z.array(placeRef).min(1).max(20),
  conditions: z.array(z.string().min(1)).min(1).max(16),
  /** Any one of the conditions, or all of them on the same day. */
  match: z.enum(['any', 'all']).default('any'),
  minVerdict: z.enum(['go', 'maybe']).default('go'),
  periods: z.array(z.enum(PERIODS)).min(1),
  /** Look this many days ahead, today included: 1 is today only, 5 is the whole forecast. */
  daysAhead: z.number().int().min(1).max(5).default(2),
  delivery: delivery.default({ mode: 'asap' }),
  paused: z.boolean().default(false),
});
export type AlertInput = z.infer<typeof alertInput>;

/** What was last said about one place on one day, so the same news isn't sent twice. */
export interface Notified {
  /** The verdict and conditions sent. */
  verdict: 'go' | 'maybe';
  conditions: string[];
  at: number;
  /** When the last of those windows ends: after that it's history, not a cancellation. */
  until: number;
}

export interface Alert extends AlertInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** Keyed `${placeKey}|${YYYY-MM-DD}`. Old days are dropped. */
  notified: Record<string, Notified>;
  /** Daily alerts: the local date last sent, so each day goes once. */
  lastDailyDate?: string;
  lastCheckedAt?: number;
  lastSentAt?: number;
  /** The last problem checking or sending, shown on the alerts page. */
  lastError?: string;
}

export function placeKey(p: PlaceRef): string {
  return p.kind === 'hill' ? `h${p.number}` : p.kind === 'water' ? `w${p.id}` : `c${p.id}`;
}
