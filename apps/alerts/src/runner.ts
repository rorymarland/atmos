/**
 * Runs checks: which alerts are due, what's news for each, and one email per person.
 *
 * "As soon as" alerts are checked hourly (models update through the day) but never emailed
 * between 22:00 and 06:00: news found overnight waits for the 06:00 check. Daily alerts go at
 * their chosen time, once a day, with a summary of everything that matches.
 */
import { composeEmail, type AlertNews, type Email } from './email';
import type { CustomPlace } from '@atmos/engine';
import {
  FORECAST_DAYS,
  londonDate,
  loadSiteData,
  scorePlaces,
  withCustomPlaces,
  type SiteData,
} from './check';
import { placeKey, type Alert, type PlaceRef } from './model';
import { decide, findMatches } from './rules';
import type { Store } from './store';
import type { Feeder } from './forecasts';

export interface RunnerOptions {
  store: Store;
  /** Where the website container serves its data, e.g. http://atmos/data. */
  dataUrl: string;
  /** The Atmos address people use, for links in emails. */
  siteUrl: string;
  send: (email: Email) => Promise<void>;
  /** The shared forecasts, when this service fetches them. */
  forecasts?: Feeder;
  /** Custom places, scored like hills. */
  places: () => CustomPlace[];
  log?: (msg: string) => void;
}

const DATA_MAX_AGE_MS = 60 * 60_000;
const QUIET_FROM = 22;
const QUIET_UNTIL = 6;
/** A daily alert missed (the NAS was off at its time) still goes if it's this late or less. */
const DAILY_GRACE_MIN = 180;

const londonClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function londonMinutes(now: number): number {
  const [h, m] = londonClock.format(now).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isQuiet(now: number): boolean {
  const h = Math.floor(londonMinutes(now) / 60);
  return h >= QUIET_FROM || h < QUIET_UNTIL;
}

/** Whether a daily alert should go now: its time has come today, not too long ago, not yet sent. */
export function dailyDue(alert: Alert, now: number): boolean {
  if (alert.delivery.mode !== 'daily') return false;
  if (alert.lastDailyDate === londonDate(0, now)) return false;
  const [h, m] = alert.delivery.at.split(':').map(Number);
  const late = londonMinutes(now) - ((h ?? 0) * 60 + (m ?? 0));
  return late >= 0 && late <= DAILY_GRACE_MIN;
}

export class Runner {
  #data: SiteData | null = null;
  lastRun: { at: number; checked: number; emails: number; error?: string } | null = null;
  #running = false;

  constructor(readonly opts: RunnerOptions) {}

  async data(): Promise<SiteData> {
    if (!this.#data || Date.now() - this.#data.loadedAt > DATA_MAX_AGE_MS) {
      this.#data = await loadSiteData(this.opts.dataUrl);
    }
    // Places change while running: add them afresh each time.
    return withCustomPlaces(this.#data, this.opts.places());
  }

  /** The hourly check of "as soon as" alerts, plus any daily ones due. */
  async tick(kind: 'hourly' | 'minute', now = Date.now()) {
    const all = this.opts.store.list().filter((a) => !a.paused);
    const due = all.filter((a) =>
      a.delivery.mode === 'daily' ? dailyDue(a, now) : kind === 'hourly' && !isQuiet(now),
    );
    if (due.length) await this.run(due, now);
  }

  /** Checks these alerts now and emails what's news. */
  async run(
    alerts: Alert[],
    now = Date.now(),
    test = false,
  ): Promise<{ emails: number; matches: number }> {
    if (this.#running) return { emails: 0, matches: 0 };
    this.#running = true;
    const log = this.opts.log ?? (() => undefined);
    try {
      const data = await this.data();
      const refs = new Map<string, PlaceRef>();
      for (const a of alerts) for (const p of a.places) refs.set(placeKey(p), p);
      const { days, missing } = await scorePlaces(
        [...refs.values()],
        data,
        now,
        this.opts.forecasts,
      );
      const today = londonDate(0, now);
      const tomorrow = londonDate(1, now);

      const byEmail = new Map<string, { item: AlertNews; apply: () => void }[]>();
      let matchCount = 0;
      for (const alert of alerts) {
        const matches = findMatches(alert, days, now);
        matchCount += matches.length;
        const gone = missing.filter((m) => alert.places.some((p) => placeKey(p) === placeKey(m)));
        const problem = gone.length
          ? `No longer in Atmos's data: ${gone.map((g) => g.name).join(', ')}.`
          : undefined;
        if (test) {
          // A test sends what matches now, as a daily summary would, and changes nothing.
          const d = decide(
            { ...alert, notified: {}, delivery: { mode: 'daily', at: '00:00' } },
            matches,
            today,
            now,
          );
          const list = byEmail.get(alert.email) ?? [];
          list.push({ item: { alert, news: d.news, cancelled: [] }, apply: () => undefined });
          byEmail.set(alert.email, list);
          continue;
        }
        const d = decide(alert, matches, today, now);
        const apply = () =>
          this.opts.store.patch(alert.id, {
            notified: d.notified,
            lastCheckedAt: now,
            lastError: problem,
            ...(d.news.length || d.cancelled.length ? { lastSentAt: now } : {}),
            ...(alert.delivery.mode === 'daily' ? { lastDailyDate: today } : {}),
          });
        if (d.news.length === 0 && d.cancelled.length === 0) {
          apply();
          continue;
        }
        const list = byEmail.get(alert.email) ?? [];
        list.push({ item: { alert, news: d.news, cancelled: d.cancelled }, apply });
        byEmail.set(alert.email, list);
      }

      let emails = 0;
      for (const [to, entries] of byEmail) {
        const items = entries.map((e) => e.item);
        let email: Email;
        if (test && items.every((i) => i.news.length === 0)) {
          email = {
            to,
            subject: 'Atmos: test alert',
            text: `Email from Atmos is working. Nothing matches "${items.map((i) => i.alert.label || 'this alert').join('", "')}" in the next ${FORECAST_DAYS} days right now.\n\nManage alerts: ${this.opts.siteUrl}/alerts`,
            html: `<p>Email from Atmos is working. Nothing matches this alert in the next ${FORECAST_DAYS} days right now.</p><p><a href="${this.opts.siteUrl}/alerts">Manage alerts</a></p>`,
          };
        } else {
          email = composeEmail(to, items, data, {
            base: this.opts.siteUrl,
            today,
            tomorrow,
            now,
          });
          if (test) email.subject = `${email.subject} (test)`;
        }
        try {
          await this.opts.send(email);
          emails++;
          for (const e of entries) {
            e.apply();
            // A test that got through clears any earlier sending problem.
            if (test) this.opts.store.patch(e.item.alert.id, { lastError: undefined });
          }
          log(`Sent "${email.subject}" to ${to}`);
        } catch (e) {
          const msg = `Couldn't send email: ${(e as Error).message}`;
          log(`${msg} (to ${to})`);
          for (const e2 of entries)
            this.opts.store.patch(e2.item.alert.id, { lastError: msg, lastCheckedAt: now });
          if (test) throw new Error(msg, { cause: e });
        }
      }
      this.lastRun = { at: now, checked: alerts.length, emails };
      return { emails, matches: matchCount };
    } catch (e) {
      const msg = (e as Error).message;
      this.lastRun = { at: now, checked: alerts.length, emails: 0, error: msg };
      log(`Check failed: ${msg}`);
      throw e;
    } finally {
      this.#running = false;
    }
  }
}
