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

  /** A finer slice across the view, for long lenses; null until worked out. */
  slice = $state.raw<Panorama | null>(null);
  #sliceWant = '';

  /**
   * The view from a place, worked out unless it's the one already shown. `eyeM` is the eye's
   * height above sea level when standing on a known summit.
   */
  request(lat: number, lon: number, eyeM: number | undefined, allHills: PanoramaHill[]) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${eyeM ?? ''}`;
    if (key === this.#want) return;
    this.#want = key;
    this.slice = null;
    this.#sliceWant = '';
    const cached = this.#cache.get(key);
    if (cached) {
      this.current = cached;
      this.status = 'ready';
      // The worker may hold another place's terrain: ask for this one again for slices.
      this.#terrainKey = '';
      return;
    }
    this.#send(lat, lon, eyeM, allHills, key);
  }
  #terrainKey = '';
  #last: { lat: number; lon: number; eyeM: number | undefined; hills: PanoramaHill[] } | null =
    null;

  #send(lat: number, lon: number, eyeM: number | undefined, allHills: PanoramaHill[], key: string) {
    const worker = this.#ensureWorker();
    if (!worker) {
      this.status = 'failed';
      return;
    }
    const kmPerLon = 111.2 * Math.cos((lat * Math.PI) / 180);
    const hills = allHills
      .filter((h) => Math.hypot((h.lat - lat) * 111.2, (h.lon - lon) * kmPerLon) <= RANGE_KM)
      .map(({ id, name, lat: la, lon: lo, metres }) => ({ id, name, lat: la, lon: lo, metres }));
    this.#last = { lat, lon, eyeM, hills: allHills };
    const id = ++this.#id;
    this.status = 'loading';
    const msg: PanoramaRequest = {
      type: 'view',
      id,
      key,
      lat,
      lon,
      hills,
      ...(eyeM ? { eyeM } : {}),
    };
    worker.postMessage(msg);
    this.#pending.set(id, { kind: 'view', key });
  }
  #pending = new Map<number, { kind: 'view' | 'slice'; key: string }>();

  /**
   * A finer slice across what's being looked at, for the 100 and 200 mm lenses: a little
   * wider than the view, so turning a short way doesn't need a new one.
   */
  requestSlice(heading: number, fov: number, stepDeg: number) {
    if (this.status !== 'ready' || !this.current) return;
    const half = fov * 0.75;
    const from = Math.round((heading - half) / stepDeg) * stepDeg;
    const key = `${this.#want}|${from.toFixed(3)}|${(fov * 1.5).toFixed(2)}|${stepDeg}`;
    if (key === this.#sliceWant) return;
    // The current slice still covers the view: keep it.
    const s = this.slice;
    if (s && s.stepDeg === stepDeg) {
      const span = (s.skyline.length - 1) * s.stepDeg;
      const off = (((heading - fov / 2 - s.startAz) % 360) + 360) % 360;
      if (off + fov <= span) return;
    }
    this.#sliceWant = key;
    const worker = this.#ensureWorker();
    if (!worker) return;
    // The worker needs this place's terrain first (it may hold another's after a cache hit).
    if (this.#terrainKey !== this.#want && this.#last) {
      this.#send(this.#last.lat, this.#last.lon, this.#last.eyeM, this.#last.hills, this.#want);
      this.#sliceWant = '';
      return;
    }
    const id = ++this.#id;
    worker.postMessage({
      type: 'slice',
      id,
      key: this.#want,
      fromAz: from,
      toAz: from + fov * 1.5,
      stepDeg,
    } satisfies PanoramaRequest);
    this.#pending.set(id, { kind: 'slice', key });
  }

  #ensureWorker(): Worker | null {
    if (this.#worker) return this.#worker;
    try {
      const w = new Worker(new URL('./panorama.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<PanoramaReply>) => {
        const job = this.#pending.get(e.data.id);
        this.#pending.delete(e.data.id);
        if (!job) return;
        if (!('panorama' in e.data)) {
          console.warn('Viewer:', e.data.error);
          if (job.kind === 'view' && job.key === this.#want) this.status = 'failed';
          return;
        }
        if (job.kind === 'slice') {
          if (job.key === this.#sliceWant) this.slice = e.data.panorama;
          return;
        }
        this.#terrainKey = job.key;
        this.#cache.set(job.key, e.data.panorama);
        // Keep the last few views: going back to one is then instant.
        if (this.#cache.size > 6) this.#cache.delete(this.#cache.keys().next().value!);
        if (job.key !== this.#want) return;
        this.current = e.data.panorama;
        this.status = 'ready';
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
