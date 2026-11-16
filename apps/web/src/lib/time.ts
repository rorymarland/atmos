/** Dates and times in UK local time (GMT/BST), 24-hour. */

export const TZ = 'Europe/London';
const HOUR = 3_600_000;

const hm = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const ymd = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const weekdayDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
});

export function formatTime(ms: number): string {
  return hm.format(ms);
}

function londonParts(ms: number) {
  const p = Object.fromEntries(ymd.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/** Offset of UK local time from UTC at an instant, in hours (0 or 1). */
function londonOffsetHours(ms: number): number {
  const local = hm.format(ms);
  const utcHour = new Date(ms).getUTCHours();
  return (((Number(local.slice(0, 2)) - utcHour) % 24) + 24) % 24;
}

/** UTC instant of midnight UK time, `dayOffset` days after today (UK). */
export function londonMidnight(dayOffset: number, now = Date.now()): number {
  const { y, m, d } = londonParts(now);
  const noon = Date.UTC(y, m - 1, d + dayOffset, 12);
  return Date.UTC(y, m - 1, d + dayOffset) - londonOffsetHours(noon) * HOUR;
}

/** "Today", "Tomorrow", then "Wed 18". */
export function dayLabel(dayOffset: number, now = Date.now()): string {
  if (dayOffset === 0) return 'Today';
  if (dayOffset === 1) return 'Tomorrow';
  return weekdayDay.format(londonMidnight(dayOffset, now) + 12 * HOUR);
}

export function floorToHour(ms: number): number {
  return Math.floor(ms / HOUR) * HOUR;
}

export function ageLabel(fetchedAt: number, now = Date.now()): string {
  const mins = Math.round((now - fetchedAt) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}
