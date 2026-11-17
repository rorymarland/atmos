/**
 * Alerts kept in one JSON file in the mounted data folder. A handful of people with a few
 * alerts each doesn't need a database; writes go to a temporary file first and are renamed
 * into place, so a crash mid-write can't leave half a file.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Alert, AlertInput } from './model';

export class Store {
  #alerts: Alert[] = [];

  constructor(readonly path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { alerts?: Alert[] };
      this.#alerts = raw.alerts ?? [];
    }
  }

  list(): Alert[] {
    return [...this.#alerts].sort(
      (a, b) => a.email.localeCompare(b.email) || a.createdAt - b.createdAt,
    );
  }

  get(id: string): Alert | undefined {
    return this.#alerts.find((a) => a.id === id);
  }

  create(input: AlertInput, now = Date.now()): Alert {
    const alert: Alert = {
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      notified: {},
    };
    this.#alerts.push(alert);
    this.save();
    return alert;
  }

  /** Changing what an alert looks for starts it afresh, so the next check reports it all. */
  update(id: string, input: AlertInput, now = Date.now()): Alert | undefined {
    const a = this.get(id);
    if (!a) return undefined;
    Object.assign(a, input, {
      updatedAt: now,
      notified: {},
      lastDailyDate: undefined,
      lastError: undefined,
    });
    this.save();
    return a;
  }

  /** Bookkeeping from a check: what was sent, when, and any problem. */
  patch(
    id: string,
    changes: Partial<
      Pick<Alert, 'notified' | 'lastDailyDate' | 'lastCheckedAt' | 'lastSentAt' | 'lastError'>
    >,
  ) {
    const a = this.get(id);
    if (!a) return;
    Object.assign(a, changes);
    this.save();
  }

  remove(id: string): boolean {
    const before = this.#alerts.length;
    this.#alerts = this.#alerts.filter((a) => a.id !== id);
    if (this.#alerts.length === before) return false;
    this.save();
    return true;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, alerts: this.#alerts }, null, 2));
    renameSync(tmp, this.path);
  }
}
