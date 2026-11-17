/**
 * Custom places, shared by everyone using this Atmos: kept in places.json beside the alerts.
 * Numbers start at CUSTOM_NUMBER_BASE + 1 and are never reused, so links and alerts that
 * name a deleted place don't end up pointing at a different one.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CUSTOM_NUMBER_BASE, type CustomPlace } from '@atmos/engine';
import { z } from 'zod';

export const placeInput = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(['high', 'viewpoint', 'lochside']),
  lat: z.number().min(49).max(61.5),
  lon: z.number().min(-11).max(2.5),
  metres: z.number().min(-10).max(1400),
});
export type PlaceInput = z.infer<typeof placeInput>;

export class PlaceStore {
  #places: CustomPlace[] = [];
  #lastNumber = CUSTOM_NUMBER_BASE;

  constructor(readonly path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as {
        places?: CustomPlace[];
        lastNumber?: number;
      };
      this.#places = raw.places ?? [];
      this.#lastNumber = Math.max(
        raw.lastNumber ?? CUSTOM_NUMBER_BASE,
        ...this.#places.map((p) => p.number),
      );
    }
  }

  list(): CustomPlace[] {
    return [...this.#places].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string) {
    return this.#places.find((p) => p.id === id);
  }

  create(input: PlaceInput, now = Date.now()): CustomPlace {
    const p: CustomPlace = {
      ...input,
      id: randomUUID(),
      number: ++this.#lastNumber,
      createdAt: now,
      updatedAt: now,
    };
    this.#places.push(p);
    this.save();
    return p;
  }

  update(id: string, input: PlaceInput, now = Date.now()): CustomPlace | undefined {
    const p = this.get(id);
    if (!p) return undefined;
    Object.assign(p, input, { updatedAt: now });
    this.save();
    return p;
  }

  remove(id: string): boolean {
    const before = this.#places.length;
    this.#places = this.#places.filter((p) => p.id !== id);
    if (this.#places.length === before) return false;
    this.save();
    return true;
  }

  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ version: 1, lastNumber: this.#lastNumber, places: this.#places }, null, 2),
    );
    renameSync(tmp, this.path);
  }
}
