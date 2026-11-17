/**
 * Favourite hills, kept in this browser's localStorage like the settings. Each one keeps
 * the whole hill, so a favourite that isn't on the chosen lists (a Tump, say) opens
 * without loading the search list first.
 */
import type { Hill } from '@atmos/engine';

const KEY = 'atmos.favourites';

export interface Favourite {
  hill: Hill;
  /** Not on the hill lists: opened like a searched hill. */
  other: boolean;
}

function load(): Favourite[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (f): f is Favourite =>
        !!f && typeof f === 'object' && typeof (f as Favourite).hill?.number === 'number',
    );
  } catch {
    return [];
  }
}

class Favourites {
  list = $state<Favourite[]>(load());

  has(number: number): boolean {
    return this.list.some((f) => f.hill.number === number);
  }

  toggle(hill: Hill, other: boolean) {
    this.list = this.has(hill.number)
      ? this.list.filter((f) => f.hill.number !== hill.number)
      : [...this.list, { hill: $state.snapshot(hill) as Hill, other }];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.list));
    } catch {
      // Private browsing or storage full: the star still works for this visit.
    }
  }
}

export const favourites = new Favourites();
