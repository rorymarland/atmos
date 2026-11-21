/**
 * The viewer's state: the view from the pin (or the open hill's summit), worked out in a
 * worker, plus which way you're facing and the lens. Shared by the viewer strip and the
 * map's view wedge.
 */
import type { Panorama, PanoramaHill } from '@atmos/engine';
import type { PanoramaReply, PanoramaRequest } from './panorama.worker';

/** Full-frame focal lengths and their horizontal field of view in degrees. */
export const LENSES = [24, 50, 100, 200] as const;
export type Lens = (typeof LENSES)[number];
export const fieldOfView = (mm: number) => (2 * Math.atan(36 / (2 * mm)) * 180) / Math.PI;

const KEY = 'atmos.viewer';
const RANGE_KM = 150;

function load(): { open: boolean; lens: Lens } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { open?: boolean; lens?: number };
    return {
      open: v.open ?? true,
      lens: (LENSES as readonly number[]).includes(v.lens ?? 0) ? (v.lens as Lens) : 50,
    };
  } catch {
    return { open: true, lens: 50 };
  }
}

class PanoramaState {
  open = $state(true);
  lens = $state<Lens>(50);
  /** The direction at the middle of the view, degrees from north. */
  heading = $state(180);
  current = $state.raw<Panorama | null>(null);
  status = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  #want = '';
  #id = 0;
  #worker: Worker | null = null;
  #cache = new Map<string, Panorama>();

  constructor() {
    if (typeof localStorage !== 'undefined') {
      const s = load();
      this.open = s.open;
      this.lens = s.lens;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ open: this.open, lens: this.lens }));
    } catch {
      // Storage can be unavailable; the defaults will do.
    }
  }

  get fov(): number {
    return fieldOfView(this.lens);
  }

  turn(deg: number) {
    this.heading = (((this.heading + deg) % 360) + 360) % 360;
  }

  /**
   * The view from a place, worked out unless it's the one already shown. `eyeM` is the eye's
   * height above sea level when standing on a known summit.
   */
  request(lat: number, lon: number, eyeM: number | undefined, allHills: PanoramaHill[]) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${eyeM ?? ''}`;
    if (key === this.#want) return;
    this.#want = key;
    const cached = this.#cache.get(key);
    if (cached) {
      this.current = cached;
      this.status = 'ready';
      return;
    }
    const worker = this.#ensureWorker();
    if (!worker) {
      this.status = 'failed';
      return;
    }
    const kmPerLon = 111.2 * Math.cos((lat * Math.PI) / 180);
    const hills = allHills
      .filter((h) => Math.hypot((h.lat - lat) * 111.2, (h.lon - lon) * kmPerLon) <= RANGE_KM)
      .map(({ id, name, lat: la, lon: lo, metres }) => ({ id, name, lat: la, lon: lo, metres }));
    const id = ++this.#id;
    this.status = 'loading';
    const msg: PanoramaRequest = { id, lat, lon, hills, ...(eyeM ? { eyeM } : {}) };
    worker.postMessage(msg);
    this.#pending.set(id, key);
  }
  #pending = new Map<number, string>();

  #ensureWorker(): Worker | null {
    if (this.#worker) return this.#worker;
    try {
      const w = new Worker(new URL('./panorama.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<PanoramaReply>) => {
        const key = this.#pending.get(e.data.id);
        this.#pending.delete(e.data.id);
        if (key === undefined) return;
        if ('panorama' in e.data) {
          this.#cache.set(key, e.data.panorama);
          // Keep the last few views: going back to one is then instant.
          if (this.#cache.size > 6) this.#cache.delete(this.#cache.keys().next().value!);
        } else console.warn('Viewer:', e.data.error);
        if (key !== this.#want) return;
        if ('panorama' in e.data) {
          this.current = e.data.panorama;
          this.status = 'ready';
        } else this.status = 'failed';
      };
      this.#worker = w;
      return w;
    } catch (e) {
      console.warn('Viewer worker unavailable:', e);
      return null;
    }
  }
}

export const viewer = new PanoramaState();
