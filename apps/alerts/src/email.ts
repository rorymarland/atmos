/**
 * The alert email: one per person per check, covering all their alerts that have news.
 * Plain words, the same reasons the panel gives, and a link straight to the place and day.
 */
import { explain, type ScoringConfig } from '@atmos/engine';
import { PERIOD_LABELS } from '../../web/src/lib/sun';
import type { Alert, PlaceRef } from './model';
import type { Cancelled, News } from './rules';
import type { SiteData } from './check';
import { resolvePlace } from './check';

export interface AlertNews {
  alert: Alert;
  news: News[];
  cancelled: Cancelled[];
}

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** "today", "tomorrow" or "Thursday 19 November" for a YYYY-MM-DD date. */
export function dayWords(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  return longDate.format(new Date(`${date}T12:00:00Z`));
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VERDICT: Record<'go' | 'maybe', string> = { go: 'Go', maybe: 'Maybe' };

/** A short description of what an alert looks for, for when it has no label. */
export function describeAlert(alert: Alert, config: ScoringConfig): string {
  const names = alert.conditions.map((id) => config.profiles[id]?.label ?? id);
  const joined =
    names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} ${alert.match === 'all' ? 'and' : 'or'} ${names.at(-1)}`;
  const places = alert.places.map((p) => p.name);
  const where = places.length <= 2 ? places.join(' or ') : `${places.length} places`;
  return `${joined} at ${where}`;
}

export function placeLink(ref: PlaceRef, date: string, data: SiteData, base: string): string {
  const hill = resolvePlace(ref, data);
  return hill ? `${base}/?hill=${hill.number}&date=${date}` : `${base}/alerts`;
}

export function composeEmail(
  to: string,
  items: AlertNews[],
  data: SiteData,
  opts: { base: string; today: string; tomorrow: string; wind?: 'kmh' | 'mph' },
): Email {
  const label = (id: string) => data.config.profiles[id]?.label ?? id;
  const text: string[] = [];
  const html: string[] = [];
  const headlines: string[] = [];

  for (const { alert, news, cancelled } of items) {
    const title = alert.label || describeAlert(alert, data.config);
    text.push(title.toUpperCase(), '');
    html.push(`<h2 style="font-size:17px;margin:20px 0 6px">${escape(title)}</h2>`);

    for (const { match, kind } of news) {
      const when = dayWords(match.date, opts.today, opts.tomorrow);
      const link = placeLink(match.place, match.date, data, opts.base);
      const what = match.items.map((i) => label(i.profileId)).join(' and ');
      headlines.push(`${what} at ${match.place.name} ${when}`);
      const tag =
        kind === 'better' ? ' (better than before)' : kind === 'still' ? ' (still on)' : '';
      text.push(`${match.place.name}, ${when}: ${VERDICT[match.verdict]}${tag}`);
      html.push(
        `<p style="margin:10px 0 4px"><a href="${escape(link)}" style="font-weight:600">${escape(match.place.name)}</a>, ${escape(when)}: <strong>${VERDICT[match.verdict]}</strong>${escape(tag)}</p><ul style="margin:0 0 8px;padding-left:20px">`,
      );
      for (const item of match.items) {
        const at = item.keyTime ? `, best around ${clock.format(item.keyTime)}` : '';
        const where = item.result.water ? ` at ${item.result.water.body.name || 'the loch'}` : '';
        const reasons = explain(item.result.result, { wind: opts.wind ?? 'kmh' })
          .filter((r) => r.status === 'good' || r.status === 'ok')
          .slice(0, 3)
          .map((r) => r.text);
        const head = `${label(item.profileId)}${where}: ${VERDICT[item.verdict]} (${Math.round(item.score * 100)}), ${PERIOD_LABELS[item.period].toLowerCase()}${at}.`;
        text.push(`  - ${head}${reasons.length ? ` ${reasons.join(' ')}` : ''}`);
        html.push(
          `<li>${escape(head)}${reasons.length ? `<br><span style="color:#55606a">${escape(reasons.join(' '))}</span>` : ''}</li>`,
        );
      }
      html.push('</ul>');
      text.push(`  ${link}`, '');
    }

    for (const c of cancelled) {
      const when = dayWords(c.date, opts.today, opts.tomorrow);
      const what = c.previous.conditions.map(label).join(' and ');
      text.push(`${c.place.name}, ${when}: no longer looks good for ${what}.`, '');
      html.push(
        `<p style="margin:10px 0;color:#8a3b2b">${escape(c.place.name)}, ${escape(when)}: no longer looks good for ${escape(what)}.</p>`,
      );
    }
  }

  const subject =
    headlines.length === 1
      ? `Atmos: ${headlines[0]}`
      : headlines.length > 1
        ? `Atmos: ${headlines.length} things look good`
        : `Atmos: a change to an alert`;
  const footer = `Forecasts change: check Atmos before you go. Manage alerts: ${opts.base}/alerts`;
  text.push('--', footer);
  html.push(
    `<p style="margin-top:24px;color:#55606a;font-size:13px">Forecasts change: check Atmos before you go. <a href="${escape(opts.base)}/alerts">Manage alerts</a>.</p>`,
  );
  return {
    to,
    subject,
    text: text.join('\n'),
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1d2830;max-width:620px">${html.join('')}</div>`,
  };
}
