/**
 * Finding home: a UK postcode through postcodes.io, or a place name through Open-Meteo's
 * geocoding. Both are free, keyless and allow browser calls. Only coordinates and a short
 * label are kept, in this browser.
 */
import type { StartPoint } from './settings.svelte.ts';

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

export async function findPlace(query: string): Promise<StartPoint[]> {
  const q = query.trim();
  if (!q) return [];

  if (POSTCODE.test(q) || OUTCODE.test(q)) {
    const full = POSTCODE.test(q);
    const url = full
      ? `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`
      : `https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`;
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as {
        result: {
          latitude: number | null;
          longitude: number | null;
          postcode?: string;
          outcode?: string;
        };
      };
      const r = body.result;
      if (r.latitude !== null && r.longitude !== null) {
        return [
          {
            lat: Math.round(r.latitude * 1e4) / 1e4,
            lon: Math.round(r.longitude * 1e4) / 1e4,
            label: (r.postcode ?? r.outcode ?? q).toUpperCase(),
          },
        ];
      }
    } else if (res.status !== 404) {
      throw new Error(`Postcode lookup failed (${res.status})`);
    }
    // Not a real postcode: fall through to a place-name search.
  }

  const params = new URLSearchParams({ name: q, count: '5', language: 'en', countryCode: 'GB' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!res.ok) throw new Error(`Place search failed (${res.status})`);
  const body = (await res.json()) as {
    results?: {
      name: string;
      latitude: number;
      longitude: number;
      admin1?: string;
      admin2?: string;
    }[];
  };
  return (body.results ?? []).map((r) => ({
    lat: Math.round(r.latitude * 1e4) / 1e4,
    lon: Math.round(r.longitude * 1e4) / 1e4,
    label: [r.name, r.admin2 ?? r.admin1].filter(Boolean).join(', '),
  }));
}

const POSTCODE_START = /^[A-Z]{1,2}\d/i;

/**
 * Suggestions while typing: postcodes (postcodes.io autocomplete, then one bulk lookup
 * for coordinates) and UK place names (Open-Meteo geocoding, fuzzy from 3 letters).
 */
export async function suggestPlaces(query: string, signal?: AbortSignal): Promise<StartPoint[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const out: StartPoint[] = [];

  if (POSTCODE_START.test(q)) {
    try {
      const ac = await fetch(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(q)}/autocomplete?limit=5`,
        { signal },
      );
      const codes = ac.ok ? ((await ac.json()) as { result: string[] | null }).result : null;
      if (codes?.length) {
        const bulk = await fetch('https://api.postcodes.io/postcodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postcodes: codes }),
          signal,
        });
        if (bulk.ok) {
          const body = (await bulk.json()) as {
            result: {
              result: {
                postcode: string;
                latitude: number | null;
                longitude: number | null;
              } | null;
            }[];
          };
          for (const r of body.result) {
            const p = r.result;
            if (p && p.latitude !== null && p.longitude !== null) {
              out.push({ lat: round4(p.latitude), lon: round4(p.longitude), label: p.postcode });
            }
          }
        }
      } else {
        // Maybe a whole district ("EH45") rather than the start of a postcode.
        out.push(...(await findPlace(q).catch(() => [])));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
    }
  }

  if (q.length >= 3 && out.length < 5) {
    const params = new URLSearchParams({ name: q, count: '6', language: 'en', countryCode: 'GB' });
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal });
    if (res.ok) {
      const body = (await res.json()) as {
        results?: {
          name: string;
          latitude: number;
          longitude: number;
          admin1?: string;
          admin2?: string;
        }[];
      };
      for (const r of body.results ?? []) {
        out.push({
          lat: round4(r.latitude),
          lon: round4(r.longitude),
          label: [r.name, r.admin2 ?? r.admin1].filter(Boolean).join(', '),
        });
      }
    }
  }
  return out;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
