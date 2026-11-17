/**
 * Talks to the optional alerts service, which the Atmos container reaches at /api/alerts.
 * Without it (no alerts container) every call fails quietly and the alerts features hide.
 */
import type { Hill } from '@atmos/engine';
import type { Period } from './sun';
import type { StaticData } from './static-data';

export type PlaceRef =
  { kind: 'hill'; number: number; name: string } | { kind: 'water'; id: string; name: string };

export type Delivery = { mode: 'asap' } | { mode: 'daily'; at: string };

export interface AlertInput {
  email: string;
  label?: string;
  places: PlaceRef[];
  conditions: string[];
  match: 'any' | 'all';
  minVerdict: 'go' | 'maybe';
  periods: Period[];
  daysAhead: number;
  delivery: Delivery;
  paused: boolean;
}

export interface AlertView extends AlertInput {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt?: number;
  lastSentAt?: number;
  lastError?: string;
}

export interface AlertsStatus {
  ok: boolean;
  /** Whether SMTP is set up. */
  email: boolean;
  from: string | null;
  lastRun: { at: number; checked: number; emails: number; error?: string } | null;
  count: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/alerts${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
  if (!res.ok) {
    const detail = body.issues?.length ? ` ${body.issues.join(' ')}` : '';
    throw new Error(`${body.error ?? `The alerts service answered ${res.status}`}.${detail}`);
  }
  return body as T;
}

class Alerts {
  /** null while checking; false when there's no alerts service. */
  status = $state<AlertsStatus | false | null>(null);

  async probe() {
    try {
      this.status = await call<AlertsStatus>('/status');
    } catch {
      this.status = false;
    }
    return this.status;
  }

  list = () => call<{ alerts: AlertView[] }>('').then((r) => r.alerts);
  create = (a: AlertInput) => call<AlertView>('', { method: 'POST', body: JSON.stringify(a) });
  update = (id: string, a: AlertInput) =>
    call<AlertView>(`/${id}`, { method: 'PUT', body: JSON.stringify(a) });
  remove = (id: string) => call<void>(`/${id}`, { method: 'DELETE' });
  test = (id: string) =>
    call<{ emails: number; matches: number }>(`/${id}/test`, { method: 'POST' });
}

export const alerts = new Alerts();

const EMAIL_KEY = 'atmos.alertEmail';
/** The address last used in this browser, to save typing it again. */
export function rememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_KEY, email);
  } catch {
    // Storage off: they'll type it next time.
  }
}

/** A hill, or a loch opened as a place, as the alerts service refers to it. */
export function placeRefOf(hill: Hill, data: StaticData | null): PlaceRef | null {
  if (hill.kind === 'water') {
    const body = hill.water ? data?.waters?.[hill.water.index] : undefined;
    return body ? { kind: 'water', id: body.id, name: hill.name } : null;
  }
  return { kind: 'hill', number: hill.number, name: hill.name };
}
