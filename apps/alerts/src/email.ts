/**
 * The alert email: one per person per check, covering all their alerts that have news.
 *
 * It leads with the decision (the subject and an "at a glance" box name the best thing,
 * when, and when to leave), then each place, best first: sun and moon times, the hours
 * that are good (a strip in the HTML), why, what might spoil it, how sure the models are,
 * what's changed since the last email, and timings for a walk or the drive.
 */
import {
  descentMinutes,
  estimateDrive,
  estimateSummitWalk,
  explain,
  formatDuration,
  planTrip,
  trailsAt,
  withTraffic,
  type HourResult,
  type Reason,
  type ScoringConfig,
} from '@atmos/engine';
import { modelLabel } from '../../web/src/lib/models';
import { moonTimes, PERIOD_LABELS, skyPositions } from '../../web/src/lib/sun';
import { londonMidnight } from '../../web/src/lib/time';
import { chooseWalk, type WalkPlan } from '../../web/src/lib/walk';
import { trafficAt, type TrafficGrid } from '../../web/src/lib/traffic-grid';
import type { Alert, PlaceRef } from './model';
import type { Cancelled, Match, MatchItem, News } from './rules';
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

export interface EmailOptions {
  base: string;
  today: string;
  tomorrow: string;
  wind?: 'kmh' | 'mph';
  now?: number;
  /** Air traffic, when sampled long enough to sharpen the trail risk. */
  traffic?: TrafficGrid | null;
}

const HOUR = 3_600_000;

const clockFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clock = (t: number) => clockFmt.format(t);
const longDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long' });

/** "today", "tomorrow" or "Thursday 19 November" for a YYYY-MM-DD date. */
export function dayWords(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  return longDate.format(new Date(`${date}T12:00:00Z`));
}

/** "today", "tomorrow" or "Saturday", for subject lines. */
function shortDay(date: string, today: string, tomorrow: string): string {
  if (date === today) return 'today';
  if (date === tomorrow) return 'tomorrow';
  return weekday.format(new Date(`${date}T12:00:00Z`));
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const VERDICT: Record<'go' | 'maybe', string> = { go: 'Go', maybe: 'Maybe' };

/** Atmos's light-theme colours, inlined because email clients drop stylesheets. */
const C = {
  ink: '#1b2731',
  soft: '#4c5b67',
  line: '#d3dcdd',
  paper: '#eef2f1',
  go: '#2f7a50',
  maybe: '#b98318',
  no: '#a3412b',
  nodata: '#c9d3d6',
  gold: '#d9a13b',
};

const chip = (v: 'go' | 'maybe') =>
  `<span style="display:inline-block;padding:1px 9px;border-radius:10px;background:${C[v]};color:#fff;font-weight:700;font-size:13px">${VERDICT[v]}</span>`;

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

/** The reference model's hours for a condition: what the strip and the good window show. */
function referenceHours(item: MatchItem, window: { start: number; end: number }): HourResult[] {
  const r = item.result.result;
  const ref = r.byModel.find((m) => m.model === r.referenceModel);
  const all = item.result.span?.byModel.find((m) => m.model === r.referenceModel) ?? ref;
  return (all?.hours ?? []).filter((h) => h.time + HOUR > window.start && h.time < window.end);
}

/** The run of good (or worth-a-look) hours around the best one, as a start and end. */
export function goodWindow(
  hours: HourResult[],
  keyTime: number | null,
): { start: number; end: number } | null {
  if (keyTime === null) return null;
  const i = hours.findIndex((h) => h.time === keyTime);
  if (i < 0) return null;
  const ok = (h: HourResult | undefined) => h && (h.verdict === 'go' || h.verdict === 'maybe');
  if (!ok(hours[i])) return null;
  let a = i;
  let b = i;
  while (ok(hours[a - 1])) a--;
  while (ok(hours[b + 1])) b++;
  return { start: hours[a]!.time, end: hours[b]!.time + HOUR };
}

/** A row of coloured hours, the best one outlined, with every third hour labelled. */
function hourStrip(hours: HourResult[], keyTime: number | null): string {
  if (hours.length < 2) return '';
  const colour = (h: HourResult) =>
    h.verdict === 'go'
      ? C.go
      : h.verdict === 'maybe'
        ? C.maybe
        : h.verdict === 'no'
          ? C.line
          : C.nodata;
  const labels = hours
    .map(
      (h, i) =>
        `<td style="font-size:10px;color:${C.soft};padding:0;width:22px;text-align:left">${i % 3 === 0 ? clock(h.time).slice(0, 2) : ''}</td>`,
    )
    .join('');
  const cells = hours
    .map(
      (h) =>
        `<td title="${clock(h.time)}" style="padding:0;width:22px;height:10px;background:${colour(h)};${h.time === keyTime ? `outline:2px solid ${C.ink};` : ''}border-radius:2px"></td>`,
    )
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="2" style="border-collapse:separate;margin:6px 0 4px"><tr>${labels}</tr><tr>${cells}</tr></table>`;
}

function confidenceLine(item: MatchItem): string {
  const r = item.result.result;
  const word = { high: 'High', medium: 'Fair', low: 'Low' }[r.confidence];
  const a = r.agreement;
  const models = a ? `: ${a.go} of ${a.models} models say Go` : '';
  return `${word} confidence${models}.`;
}

interface ItemDetail {
  item: MatchItem;
  head: string;
  window: { start: number; end: number } | null;
  hours: HourResult[];
  good: string[];
  caveats: string[];
  models: string[];
  confidence: string;
  walk: WalkPlan | null;
}

function detail(
  item: MatchItem,
  match: Match,
  data: SiteData,
  opts: EmailOptions,
  label: (id: string) => string,
): ItemDetail {
  const now = opts.now ?? Date.now();
  let walk: WalkPlan | null = null;
  if (item.profileId === 'walking' && item.result.span) {
    const est = estimateSummitWalk(match.hill.metres, match.valleyM, 'steady');
    walk = chooseWalk({
      span: item.result.span,
      periods: [item.period],
      sun: match.sun,
      dayStart: londonMidnight(match.dayOffset, now),
      upMinutes: est.minutes,
      downMinutes: descentMinutes(est.distanceKm),
      start: 'best',
      downBy: 'sunset',
      notBefore: now,
      config: data.config,
      options: { now },
    });
  }
  const result = walk ? walk.result : item.result.result;
  const keyTime = walk
    ? (result.byModel.find((m) => m.model === result.referenceModel)?.keyHour?.time ?? null)
    : item.keyTime;
  const span = walk ? { start: walk.start, end: walk.end } : item.result.window;
  const hours = referenceHours(item, span);
  const window = walk ? null : goodWindow(hours, keyTime);

  const reasons: Reason[] = explain(result, { wind: opts.wind ?? 'kmh' }, modelLabel);
  const where = item.result.water ? ` at ${item.result.water.body.name || 'the loch'}` : '';
  const at = !walk && keyTime ? `, best around ${clock(keyTime)}` : '';
  const verdict = walk ? (result.verdict === 'go' ? 'go' : 'maybe') : item.verdict;
  const score = Math.round((walk ? (result.score ?? item.score) : item.score) * 100);
  return {
    item,
    head: `${label(item.profileId)}${where}: ${VERDICT[verdict]} (${score}), ${PERIOD_LABELS[item.period].toLowerCase()}${at}`,
    window,
    hours,
    good: reasons
      .filter((r) => r.status === 'good' || r.status === 'ok')
      .slice(0, 4)
      .map((r) => r.text),
    caveats: [
      ...reasons
        .filter((r) => r.status === 'poor' || r.status === 'blocked')
        .slice(0, 2)
        .map((r) => r.text),
      ...trailCaveat(item, match, keyTime, data, opts.traffic ?? null),
    ],
    // "says GO" reads as shouting in an email.
    models: reasons
      .filter((r) => r.source === 'models')
      .map((r) => r.text.replace(/\b(GO|MAYBE|NO)\b/g, (w) => w[0] + w.slice(1).toLowerCase())),
    confidence: confidenceLine(item),
    walk,
  };
}

/** Plane trails at the best hour, where a clean sky matters and they're a real risk. */
function trailCaveat(
  item: MatchItem,
  match: Match,
  keyTime: number | null,
  data: SiteData,
  traffic: TrafficGrid | null,
): string[] {
  if (!match.upper || !(data.config.profiles[item.profileId]?.trails ?? 0)) return [];
  const at = keyTime ?? item.result.window.start;
  const raw = trailsAt(match.upper, at);
  const t = raw && withTraffic(raw, trafficAt(traffic, match.hill.lat, match.hill.lon, at));
  if (!t || t.risk === 'low') return [];
  return [`Plane trails, ${t.risk} risk: ${t.text.replace(/^./, (c) => c.toLowerCase())}`];
}

/** "Up from Maybe", "Now also stars", "Still on" or "New". */
function changeWords(n: News, label: (id: string) => string): string {
  if (n.kind === 'new') return 'New';
  if (n.kind === 'still') return 'Still on';
  const prev = n.previous;
  if (prev && prev.verdict === 'maybe' && n.match.verdict === 'go') return 'Up from Maybe';
  const added = n.match.items.map((i) => i.profileId).filter((c) => !prev?.conditions.includes(c));
  return added.length ? `Now also ${added.map(label).join(' and ').toLowerCase()}` : 'Better';
}

interface Trip {
  leaveAt: number;
  text: string;
  directions: string;
}

/** Leave time and drive from the alert's start point, for the item it's planned around. */
function tripFor(alert: Alert, match: Match, d: ItemDetail): Trip | null {
  const start = alert.start;
  if (!start) return null;
  const drive = estimateDrive(start, match.hill);
  const water = d.item.result.water;
  const to = water ? water.body : match.hill;
  const directions = `https://www.google.com/maps/dir/?api=1&origin=${start.lat},${start.lon}&destination=${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
  const miles = `about ${Math.round(drive.roadMiles)} miles, ${formatDuration(drive.minutes)} drive`;
  if (d.walk) {
    const plan = planTrip({
      target: d.walk.start,
      driveMinutes: drive.minutes,
      walkMinutes: 0,
      earlyMinutes: 0,
      readyMinutes: 0,
    });
    return {
      leaveAt: plan.leaveAt,
      text: `Leave ${start.label} by ${clock(plan.leaveAt)} (${miles}).`,
      directions,
    };
  }
  const target = d.item.keyTime ?? d.item.result.window.start;
  const up =
    d.item.result.scope === 'summit' && !water
      ? estimateSummitWalk(match.hill.metres, match.valleyM, 'steady').minutes
      : 0;
  const plan = planTrip({
    target,
    driveMinutes: drive.minutes,
    walkMinutes: up,
    earlyMinutes: 15,
    readyMinutes: 0,
  });
  const walkBit = up ? `, then about ${formatDuration(up)} up` : '';
  return {
    leaveAt: plan.leaveAt,
    text: `Leave ${start.label} by ${clock(plan.leaveAt)} to be there 15 min before ${clock(target)} (${miles}${walkBit}).`,
    directions,
  };
}

/** Sunrise and sunset, and the moon for night conditions. */
function skyLine(match: Match, items: MatchItem[], now: number): string {
  const parts: string[] = [];
  if (match.sun.sunrise) parts.push(`sunrise ${clock(match.sun.sunrise)}`);
  if (match.sun.sunset) parts.push(`sunset ${clock(match.sun.sunset)}`);
  const night = items.find((i) => i.period === 'night');
  if (night) {
    const at = night.keyTime ?? night.result.window.start;
    const lit = Math.round(skyPositions(at, match.hill.lat, match.hill.lon).moonLit * 100);
    const m = moonTimes(match.hill.lat, match.hill.lon, londonMidnight(match.dayOffset, now));
    const times = [m.rise ? `rises ${clock(m.rise)}` : '', m.set ? `sets ${clock(m.set)}` : '']
      .filter(Boolean)
      .join(', ');
    parts.push(`moon ${lit}% lit${times ? `, ${times}` : ''}`);
  }
  const s = parts.join(', ');
  return s ? s[0]!.toUpperCase() + s.slice(1) + '.' : '';
}

interface Entry {
  alert: Alert;
  news: News;
  details: ItemDetail[];
  trip: Trip | null;
  best: number;
}

export function composeEmail(
  to: string,
  items: AlertNews[],
  data: SiteData,
  opts: EmailOptions,
): Email {
  const now = opts.now ?? Date.now();
  const label = (id: string) => data.config.profiles[id]?.label ?? id;
  const text: string[] = [];
  const html: string[] = [];

  // Everything with news, best first: Go before Maybe, then by score.
  const entries: Entry[] = items
    .flatMap(({ alert, news }) =>
      news.map((n) => {
        const details = [...n.match.items]
          .sort((a, b) => b.score - a.score)
          .map((i) => detail(i, n.match, data, opts, label));
        return {
          alert,
          news: n,
          details,
          trip: tripFor(alert, n.match, details[0]!),
          best: Math.max(...n.match.items.map((i) => i.score)),
        };
      }),
    )
    // Soonest first; on the same day, Go before Maybe, then by score.
    .sort(
      (a, b) =>
        a.news.match.dayOffset - b.news.match.dayOffset ||
        (b.news.match.verdict === 'go' ? 1 : 0) - (a.news.match.verdict === 'go' ? 1 : 0) ||
        b.best - a.best,
    );

  const what = (e: Entry) => e.news.match.items.map((i) => label(i.profileId)).join(' and ');
  // At a glance and the subject: the single best thing (Go first, then score, then soonest).
  const top = [...entries].sort(
    (a, b) =>
      (b.news.match.verdict === 'go' ? 1 : 0) - (a.news.match.verdict === 'go' ? 1 : 0) ||
      b.best - a.best ||
      a.news.match.dayOffset - b.news.match.dayOffset,
  )[0];

  // At a glance: the best thing, when, and when to leave.
  if (top) {
    const m = top.news.match;
    const d = top.details[0]!;
    const when = dayWords(m.date, opts.today, opts.tomorrow);
    const time = d.walk
      ? `Set off walking ${clock(d.walk.start)}, back by ${clock(d.walk.end)}`
      : d.item.keyTime
        ? `Best around ${clock(d.item.keyTime)}`
        : '';
    const sky = skyLine(m, m.items, now);
    const lines = [time ? `${time}.` : '', sky, top.trip?.text ?? ''].filter(Boolean);
    text.push(
      `AT A GLANCE: ${VERDICT[m.verdict]}, ${what(top)} at ${m.place.name}, ${when}.`,
      ...lines,
    );
    html.push(
      `<div style="background:${C.paper};border-radius:10px;padding:14px 16px;margin:0 0 18px">`,
      `<div style="font-size:13px;color:${C.soft};margin-bottom:4px">At a glance</div>`,
      `<div style="font-size:18px;font-weight:700;margin-bottom:4px">${chip(m.verdict)} ${escape(what(top))} at <a href="${escape(placeLink(m.place, m.date, data, opts.base))}" style="color:${C.ink}">${escape(m.place.name)}</a>, ${escape(when)}</div>`,
      ...lines.map((l) => `<div style="color:${C.soft}">${escape(l)}</div>`),
    );
    const others = entries.filter((e) => e !== top);
    if (others.length) {
      const list = others
        .slice(0, 3)
        .map(
          (e) =>
            `${what(e)} at ${e.news.match.place.name} ${shortDay(e.news.match.date, opts.today, opts.tomorrow)} (${VERDICT[e.news.match.verdict]})`,
        )
        .join('; ');
      const more = others.length > 3 ? `, and ${others.length - 3} more below` : '';
      text.push(`Also: ${list}${more}.`);
      html.push(`<div style="margin-top:6px;font-size:14px">Also: ${escape(list)}${more}.</div>`);
    }
    html.push('</div>');
    text.push('');
  }

  // Each place, best first. "Still on" ones (daily summaries) go last, in brief.
  const full = entries.filter((e) => e.news.kind !== 'still');
  const still = entries.filter((e) => e.news.kind === 'still');
  for (const e of full) {
    const m = e.news.match;
    const when = dayWords(m.date, opts.today, opts.tomorrow);
    const link = placeLink(m.place, m.date, data, opts.base);
    const change = changeWords(e.news, label);
    const sky = skyLine(m, m.items, now);
    const alertName = e.alert.label || describeAlert(e.alert, data.config);
    text.push(`${m.place.name.toUpperCase()}, ${when}: ${VERDICT[m.verdict]} (${change})`);
    if (sky) text.push(sky);
    html.push(
      `<div style="border-top:1px solid ${C.line};padding-top:14px;margin-top:14px">`,
      `<div style="font-size:17px;font-weight:700"><a href="${escape(link)}" style="color:${C.ink}">${escape(m.place.name)}</a>, ${escape(when)} ${chip(m.verdict)} <span style="font-size:13px;font-weight:600;color:${C.soft}">${escape(change)}</span></div>`,
      `<div style="font-size:13px;color:${C.soft};margin:2px 0 8px">For your alert “${escape(alertName)}”. ${escape(sky)}</div>`,
    );

    for (const d of e.details) {
      text.push(`  - ${d.head}.`);
      html.push(`<div style="margin:10px 0 2px;font-weight:600">${escape(d.head)}.</div>`);
      const lines: string[] = [];
      if (d.walk) {
        lines.push(
          `Set off ${clock(d.walk.start)}, summit about ${clock(d.walk.summitAt)}, back at the car about ${clock(d.walk.end)} (rough times, at a steady pace).`,
        );
        if (d.walk.torch)
          lines.push(
            `Back after ${d.walk.torch === 'dark' ? 'dark' : 'sunset'}: take a head torch.`,
          );
      } else if (d.window) {
        lines.push(`Good from ${clock(d.window.start)} to ${clock(d.window.end)}.`);
      }
      for (const l of lines) text.push(`    ${l}`);
      html.push(...lines.map((l) => `<div>${escape(l)}</div>`));
      html.push(hourStrip(d.hours, d.walk ? null : d.item.keyTime));
      if (d.good.length) {
        text.push(...d.good.map((g) => `    + ${g}`));
        html.push(
          `<ul style="margin:4px 0;padding-left:18px">${d.good.map((g) => `<li>${escape(g)}</li>`).join('')}</ul>`,
        );
      }
      if (d.caveats.length) {
        text.push(...d.caveats.map((c) => `    ! ${c}`));
        html.push(
          `<ul style="margin:4px 0;padding-left:18px;color:${C.no}">${d.caveats.map((c) => `<li>${escape(c)}</li>`).join('')}</ul>`,
        );
      }
      const conf = [d.confidence, ...d.models].join(' ');
      text.push(`    ${conf}`);
      html.push(`<div style="font-size:13px;color:${C.soft};margin-top:2px">${escape(conf)}</div>`);
    }

    if (e.trip) {
      text.push(`  ${e.trip.text}`, `  Directions: ${e.trip.directions}`);
      html.push(
        `<div style="margin-top:10px">${escape(e.trip.text)} <a href="${escape(e.trip.directions)}">Directions</a></div>`,
      );
    }
    text.push(`  ${link}`, '');
    html.push(
      `<div style="margin-top:10px"><a href="${escape(link)}" style="font-weight:600">Open ${escape(m.place.name)} in Atmos</a></div></div>`,
    );
  }

  if (still.length) {
    text.push('STILL ON');
    html.push(
      `<div style="border-top:1px solid ${C.line};padding-top:14px;margin-top:14px"><div style="font-weight:700;margin-bottom:4px">Still on</div><ul style="margin:0;padding-left:18px">`,
    );
    for (const e of still) {
      const m = e.news.match;
      const when = dayWords(m.date, opts.today, opts.tomorrow);
      const d = e.details[0]!;
      const time = d.walk
        ? `, set off ${clock(d.walk.start)}`
        : d.item.keyTime
          ? `, best around ${clock(d.item.keyTime)}`
          : '';
      const line = `${what(e)} at ${m.place.name}, ${when}: ${VERDICT[m.verdict]}${time}.`;
      const link = placeLink(m.place, m.date, data, opts.base);
      text.push(`  - ${line} ${link}`);
      html.push(`<li><a href="${escape(link)}">${escape(line)}</a></li>`);
    }
    html.push('</ul></div>');
    text.push('');
  }

  for (const { cancelled } of items) {
    for (const c of cancelled) {
      const when = dayWords(c.date, opts.today, opts.tomorrow);
      const was = c.previous.conditions.map(label).join(' and ');
      const line = `${c.place.name}, ${when}: no longer looks good for ${was.toLowerCase()}.`;
      text.push(line, '');
      html.push(`<p style="margin:14px 0 0;color:${C.no}">${escape(line)}</p>`);
    }
  }

  let subject = 'Atmos: a change to an alert';
  if (top) {
    const m = top.news.match;
    const d = top.details[0]!;
    const day = shortDay(m.date, opts.today, opts.tomorrow);
    const time = d.walk
      ? ` ${clock(d.walk.start)}`
      : d.item.keyTime
        ? ` ${clock(d.item.keyTime)}`
        : '';
    const more = entries.length > 1 ? ` (+${entries.length - 1} more)` : '';
    subject = `${VERDICT[m.verdict]} ${day}${time}: ${what(top)} at ${m.place.name}${more}`;
  }

  const footer = `Forecasts change: check Atmos before you go. Manage alerts: ${opts.base}/alerts`;
  text.push('--', footer);
  html.push(
    `<p style="margin-top:24px;color:${C.soft};font-size:13px">Forecasts change: check Atmos before you go. Times are estimates. <a href="${escape(opts.base)}/alerts">Manage alerts</a>.</p>`,
  );
  return {
    to,
    subject,
    text: text.join('\n'),
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;color:${C.ink};max-width:620px">${html.join('')}</div>`,
  };
}
