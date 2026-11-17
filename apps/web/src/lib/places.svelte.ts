/**
 * Custom places: shared through the Atmos server container (/api/places) when it's
 * running, otherwise kept in this browser only. Either way they're scored like hills.
 */
import { LOCAL_NUMBER_BASE, type CustomPlace, type PlaceKind } from '@atmos/engine';

export interface PlaceInput {
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  metres: number;
}

const LOCAL_KEY = 'atmos.places';

function loadLocal(): CustomPlace[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? (raw as CustomPlace[]) : [];
  } catch {
    return [];
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/places${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
  if (!res.ok) {
    const detail = body.issues?.length ? ` ${body.issues.join(' ')}` : '';
    throw new Error(`${body.error ?? `The server answered ${res.status}`}.${detail}`);
  }
  return body as T;
}

class Places {
  list = $state.raw<CustomPlace[]>([]);
  /** Where they're kept: on the NAS for everyone, or only in this browser. */
  source = $state<'server' | 'browser' | null>(null);

  async load() {
    try {
      const r = await call<{ places: CustomPlace[] }>('');
      this.list = r.places;
      this.source = 'server';
    } catch {
      this.list = loadLocal();
      this.source = 'browser';
    }
  }

  #saveLocal(list: CustomPlace[]) {
    this.list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.list));
    } catch {
      // Storage off: the place lasts for this visit.
    }
  }

  async add(input: PlaceInput): Promise<CustomPlace> {
    if (this.source === 'server') {
      const p = await call<CustomPlace>('', { method: 'POST', body: JSON.stringify(input) });
      await this.load();
      return p;
    }
    const number = Math.max(LOCAL_NUMBER_BASE, ...this.list.map((p) => p.number)) + 1;
    const p: CustomPlace = {
      ...input,
      id: crypto.randomUUID(),
      number,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.#saveLocal([...this.list, p]);
    return p;
  }

  async update(id: string, input: PlaceInput): Promise<void> {
    if (this.source === 'server') {
      await call(`/${id}`, { method: 'PUT', body: JSON.stringify(input) });
      await this.load();
      return;
    }
    this.#saveLocal(
      this.list.map((p) => (p.id === id ? { ...p, ...input, updatedAt: Date.now() } : p)),
    );
  }

  async remove(id: string): Promise<void> {
    if (this.source === 'server') {
      await call(`/${id}`, { method: 'DELETE' });
      await this.load();
      return;
    }
    this.#saveLocal(this.list.filter((p) => p.id !== id));
  }
}

export const places = new Places();
