/**
 * NOAA SWPC planetary K index: three-hourly, observed and forecast about three days
 * ahead. Free, keyless and served with CORS. Used for the aurora condition.
 */
export const KP_FORECAST_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';

const THREE_HOURS = 3 * 3_600_000;

export interface KpBin {
  /** Start of the three-hour bin, epoch ms. */
  time: number;
  kp: number;
}

/** "2026-11-16 03:00:00" (UTC) to epoch ms. */
function parseTime(tag: string): number {
  return Date.parse(tag.replace(' ', 'T') + (tag.endsWith('Z') ? '' : 'Z'));
}

/**
 * Accepts both shapes SWPC has used: an array of rows with a header row first, or an
 * array of objects with `time_tag` and `kp`.
 */
export function parseKpForecast(json: unknown): KpBin[] {
  if (!Array.isArray(json) || json.length === 0) return [];
  const rows: { time_tag?: unknown; kp?: unknown }[] = Array.isArray(json[0])
    ? (() => {
        const [header, ...data] = json as unknown[][];
        const ti = header!.indexOf('time_tag');
        const ki = header!.indexOf('kp');
        return data.map((r) => ({ time_tag: r[ti], kp: r[ki] }));
      })()
    : (json as { time_tag?: unknown; kp?: unknown }[]);
  const out: KpBin[] = [];
  for (const r of rows) {
    const time = typeof r.time_tag === 'string' ? parseTime(r.time_tag) : NaN;
    const kp = typeof r.kp === 'number' ? r.kp : Number(r.kp);
    if (Number.isFinite(time) && Number.isFinite(kp)) out.push({ time, kp });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The Kp for the bin containing `time`, or null outside the forecast. */
export function kpAt(bins: KpBin[], time: number): number | null {
  for (const b of bins) if (time >= b.time && time < b.time + THREE_HOURS) return b.kp;
  return null;
}

export async function fetchKpForecast(fetchImpl: typeof fetch = fetch): Promise<KpBin[]> {
  const res = await fetchImpl(KP_FORECAST_URL);
  if (!res.ok) throw new Error(`Kp forecast unavailable (${res.status})`);
  return parseKpForecast(await res.json());
}
