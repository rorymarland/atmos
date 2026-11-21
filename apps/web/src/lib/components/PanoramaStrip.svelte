<script lang="ts">
  /**
   * The viewer: the skyline and ridgelines from the pin, named hills, and the sun and moon at
   * the timeline's time, at their true size, hidden behind the hills when they're behind
   * them. Drag sideways to turn, up and down to look up; the lens sets how much you see.
   */
  import { bodyAt, skyAt, skylineAt, type Panorama, type VisibleHill } from '@atmos/engine';
  import { LENSES, viewer } from '#lib/panorama.svelte.ts';
  import { compass } from '#lib/alignment.svelte.ts';
  import { formatTime } from '#lib/time.ts';

  let {
    panorama,
    time,
    dayStart,
    place,
    theme,
    compact = false,
    onOpenHill,
  }: {
    panorama: Panorama | null;
    time: number;
    dayStart: number;
    place: string;
    theme: 'light' | 'dark';
    compact?: boolean;
    onOpenHill?: (number: number) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let width = $state(600);
  const height = $derived(compact ? 132 : 176);
  /** Looking up or down from the automatic framing, degrees. */
  let tilt = $state(0);

  const pxPerDeg = $derived(width / viewer.fov);
  const SUN_R = 0.267;
  const MOON_R = 0.259;

  /** -180 to 180: how far an azimuth is from the middle of the view. */
  const delta = (az: number) => ((((az - viewer.heading) % 360) + 540) % 360) - 180;

  /** The sun and moon over the day, every five minutes, from the standpoint. */
  const paths = $derived.by(() => {
    if (!panorama) return null;
    const { lat, lon } = panorama;
    const steps = Array.from({ length: 24 * 12 + 1 }, (_, i) => dayStart + i * 300_000);
    return {
      sun: steps.map((t) => ({ t, ...bodyAt('sun', t, lat, lon) })),
      moon: steps.map((t) => ({ t, ...bodyAt('moon', t, lat, lon) })),
    };
  });
  const now = $derived.by(() => {
    if (!panorama) return null;
    const { lat, lon } = panorama;
    return {
      sun: bodyAt('sun', time, lat, lon),
      moon: bodyAt('moon', time, lat, lon),
      lit: skyAt(time, lat, lon).moonIllumination,
    };
  });

  /**
   * The top of the frame. The skyline sits low, leaving the sky for names, the sun and the
   * moon; the frame lifts to take in the sun or moon when it's just above, as long as the
   * skyline stays in. Dragging up or down adds a tilt.
   */
  function frameTop(heading: number, withBodies = true): number {
    if (!panorama) return 10;
    const range = height / pxPerDeg;
    const off = (az: number) => ((((az - heading) % 360) + 540) % 360) - 180;
    let lo = Infinity;
    let hi = -Infinity;
    const span = viewer.fov * 0.75;
    for (let d = -span; d <= span; d += viewer.fov / 40) {
      const a = skylineAt(panorama, heading + d);
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
    let top = Math.max(lo + range * 0.85, hi + range * 0.4);
    for (const b of now && withBodies ? [now.sun, now.moon] : []) {
      const inView = Math.abs(off(b.az)) <= viewer.fov / 2;
      const wanted = b.alt + range * 0.22;
      if (inView && b.alt > -0.5 && wanted > top && wanted - lo < range * 0.95) top = wanted;
    }
    return top;
  }
  const altTop = $derived(frameTop(viewer.heading) + tilt);

  const x = (az: number) => width / 2 + delta(az) * pxPerDeg;
  const y = (alt: number) => (altTop - alt) * pxPerDeg;

  const COLOURS = {
    light: { skyTop: '#cfe0ee', skyLow: '#f4f1ea', near: [70, 88, 76], far: [176, 190, 201], line: '#ffffff', text: '#1b2731', faint: 'rgba(27,39,49,0.35)', sunInk: '#c2610c', moonInk: '#3d55c4' },
    dark: { skyTop: '#0e1822', skyLow: '#26323d', near: [20, 26, 30], far: [74, 88, 102], line: '#93a3b0', text: '#e6edf2', faint: 'rgba(230,237,242,0.35)', sunInk: '#ffb45e', moonInk: '#a9b8ff' },
  } as const;

  /**
   * Land colour: dark and green close in, pale and blue far off (the air between), and
   * darker where the ground is steep, so crags and buttresses stand out from moor.
   */
  function landRgb(km: number, steep: number): [number, number, number] {
    const c = COLOURS[theme];
    const f = Math.min(1, Math.sqrt(km / 120));
    // Steepness shows less through more air.
    const shade = 1 - steep * 0.55 * (1 - f * 0.7);
    return c.near.map((v, i) => Math.round((v + (c.far[i]! - v) * f) * shade)) as [number, number, number];
  }
  function landColour(km: number, steep = 0): string {
    return `rgb(${landRgb(km, steep).join(',')})`;
  }

  /** The shading picture as an image, made once per view, slice and theme. */
  const images = new WeakMap<Panorama, { theme: string; image: HTMLCanvasElement | OffscreenCanvas }>();
  function shadeImage(p: Panorama): HTMLCanvasElement | OffscreenCanvas | null {
    const sh = p.shade;
    if (!sh) return null;
    const known = images.get(p);
    if (known && known.theme === theme) return known.image;
    const cols = p.skyline.length;
    const image = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(cols, sh.rows) : Object.assign(document.createElement('canvas'), { width: cols, height: sh.rows });
    const ctx = image.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    const data = ctx.createImageData(cols, sh.rows);
    // Colours for every steepness and distance step, worked out once.
    const table = new Uint8Array(32 * 32 * 3);
    for (let si = 0; si < 32; si++) {
      for (let di = 0; di < 32; di++) {
        const km = ((di + 0.5) / 32) ** 2 * 150;
        const rgb = landRgb(km, (si + 0.5) / 32);
        table.set(rgb, (si * 32 + di) * 3);
      }
    }
    for (let k = 0; k < cols * sh.rows; k++) {
      if (sh.sky[k]) continue;
      const t = ((sh.steep[k]! >> 3) * 32 + (sh.dist[k]! >> 3)) * 3;
      data.data[k * 4] = table[t]!;
      data.data[k * 4 + 1] = table[t + 1]!;
      data.data[k * 4 + 2] = table[t + 2]!;
      data.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    images.set(p, { theme, image });
    return image;
  }

  function sunColour(alt: number): string {
    if (alt > 12) return '#ffe9a8';
    if (alt > 4) return '#ffc65c';
    if (alt > 0) return '#ff9a3c';
    return '#e0602e';
  }

  interface Hit {
    x: number;
    y: number;
    w: number;
    h: number;
    act: () => void;
  }
  let hits: Hit[] = [];

  /** Labels that fit: highest hills first, none closer than 14 px to another. */
  function labels(p: Panorama): (VisibleHill & { px: number; py: number })[] {
    const out: (VisibleHill & { px: number; py: number })[] = [];
    const inView = p.hills
      .filter((h) => Math.abs(delta(h.azDeg)) <= viewer.fov / 2)
      .sort((a, b) => b.metres - a.metres);
    for (const h of inView) {
      const px = x(h.azDeg);
      if (out.some((o) => Math.abs(o.px - px) < 16)) continue;
      out.push({ ...h, px, py: y(h.altDeg) });
    }
    return out;
  }

  function drawPath(
    ctx: CanvasRenderingContext2D,
    pts: { az: number; alt: number; t: number }[],
    colour: string,
  ) {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    let pen = false;
    let lastX = 0;
    for (const p of pts) {
      if (p.alt < -1 || Math.abs(delta(p.az)) > viewer.fov / 2 + 5) {
        pen = false;
        continue;
      }
      const px = x(p.az);
      if (pen && Math.abs(px - lastX) < width / 2) ctx.lineTo(px, y(p.alt));
      else ctx.moveTo(px, y(p.alt));
      pen = true;
      lastX = px;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Hour marks.
    ctx.fillStyle = colour;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const p of pts) {
      if ((p.t - dayStart) % 3_600_000 !== 0 || p.alt < -0.5) continue;
      if (Math.abs(delta(p.az)) > viewer.fov / 2) continue;
      const px = x(p.az);
      const py = y(p.alt);
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(formatTime(p.t).slice(0, 2), px, py - 5);
    }
    ctx.restore();
  }

  /** The moon with its lit part facing the sun: a crescent looks like a crescent. */
  function drawMoon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, lit: number, towardsSun: number) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = theme === 'dark' ? 'rgba(120,130,150,0.35)' : 'rgba(90,100,120,0.25)';
    ctx.fill();
    ctx.rotate(towardsSun);
    // The bright limb is the right half; the terminator is half an ellipse across it.
    const xm = r * (1 - 2 * lit);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2);
    for (let k = 0; k <= 24; k++) {
      const θ = Math.PI / 2 - (k / 24) * Math.PI;
      ctx.lineTo(xm * Math.cos(θ), r * Math.sin(θ));
    }
    ctx.closePath();
    ctx.fillStyle = '#f3f1e4';
    ctx.fill();
    ctx.restore();
    // A faint rim, so a pale moon still shows against a pale daytime sky.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = theme === 'dark' ? 'rgba(230,237,242,0.35)' : 'rgba(40,50,70,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** Direction on screen from one sky position to another, as a canvas angle. */
  function screenAngle(from: { az: number; alt: number }, to: { az: number; alt: number }): number {
    const φ1 = (from.alt * Math.PI) / 180;
    const φ2 = (to.alt * Math.PI) / 180;
    const Δ = ((to.az - from.az) * Math.PI) / 180;
    const θ = Math.atan2(Math.sin(Δ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δ));
    // θ is clockwise from straight up; on screen up is -y and clockwise is towards +x.
    return Math.atan2(-Math.cos(θ), Math.sin(θ));
  }

  /** Whether a body's centre is within its own width of a hill's top. */
  const onTop = (b: { az: number; alt: number }, h: VisibleHill, r: number) =>
    Math.hypot(delta(b.az) - delta(h.azDeg), b.alt - h.altDeg) <= r * 2;

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = COLOURS[theme];
    hits = [];

    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, c.skyTop);
    sky.addColorStop(1, c.skyLow);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    if (!panorama || !paths || !now) return;

    // The sun and moon behind everything else, so the hills hide them.
    drawPath(ctx, paths.moon, theme === 'dark' ? 'rgba(170,185,230,0.7)' : 'rgba(80,100,190,0.65)');
    drawPath(ctx, paths.sun, theme === 'dark' ? 'rgba(255,190,90,0.8)' : 'rgba(210,120,20,0.75)');
    const bodies = [
      { name: 'Moon', pos: now.moon, r: MOON_R },
      { name: 'Sun', pos: now.sun, r: SUN_R },
    ];
    for (const b of bodies) {
      if (b.pos.alt < -b.r * 2 || Math.abs(delta(b.pos.az)) > viewer.fov / 2 + 1) continue;
      const r = Math.max(3, b.r * pxPerDeg);
      const bx = x(b.pos.az);
      const by = y(b.pos.alt);
      if (b.name === 'Sun') {
        const glow = ctx.createRadialGradient(bx, by, r * 0.6, bx, by, r * 3);
        glow.addColorStop(0, 'rgba(255,210,120,0.45)');
        glow.addColorStop(1, 'rgba(255,210,120,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(bx - r * 3, by - r * 3, r * 6, r * 6);
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fillStyle = sunColour(b.pos.alt);
        ctx.fill();
      } else {
        drawMoon(ctx, bx, by, r, now.lit, screenAngle(now.moon, now.sun));
      }
    }

    // The land: the shading picture (steep faces darker, far hills paler), then the
    // ridgelines on top. A finer slice is used when it covers the view (long lenses).
    const half = viewer.fov / 2 + 2;
    const slice = viewer.slice;
    const sliceCovers =
      !!slice &&
      Math.abs(slice.lat - panorama.lat) < 1e-9 &&
      Math.abs(slice.lon - panorama.lon) < 1e-9 &&
      (((viewer.heading - viewer.fov / 2 - slice.startAz) % 360) + 360) % 360 + viewer.fov <=
        (slice.skyline.length - 1) * slice.stepDeg;
    const land = sliceCovers ? slice! : panorama;
    const picture = shadeImage(land);
    if (picture && land.shade) {
      const sh = land.shade;
      const cols = land.skyline.length;
      const cw = land.stepDeg * pxPerDeg;
      const top = y(sh.altTop);
      const tall = sh.rows * sh.binDeg * pxPerDeg;
      const full = land === panorama;
      ctx.imageSmoothingEnabled = cw > 1.5;
      for (const k of full ? [-1, 0, 1] : [0]) {
        const x0 = width / 2 + (delta(land.startAz) + k * 360) * pxPerDeg - cw / 2;
        const c0 = Math.max(0, Math.floor(-x0 / cw));
        const c1 = Math.min(cols, Math.ceil((width - x0) / cw));
        if (c1 <= c0) continue;
        ctx.drawImage(picture, c0, 0, c1 - c0, sh.rows, x0 + c0 * cw, top, (c1 - c0) * cw, tall);
      }
      // Below the picture (looking steeply down): the near ground.
      if (top + tall < height) {
        ctx.fillStyle = landColour(0, 0.3);
        ctx.fillRect(0, top + tall - 1, width, height - top - tall + 1);
      }
    } else {
      // No shading: fill under the skyline.
      ctx.beginPath();
      ctx.moveTo(-1, height + 1);
      for (let px = -1; px <= width + 1; px += 2) {
        ctx.lineTo(px, y(skylineAt(panorama, viewer.heading + (px - width / 2) / pxPerDeg)));
      }
      ctx.lineTo(width + 1, height + 1);
      ctx.closePath();
      ctx.fillStyle = landColour(60);
      ctx.fill();
    }

    for (const line of land.ridges) {
      ctx.beginPath();
      let pen = false;
      let lastX = NaN;
      let kmSum = 0;
      for (const p of line) {
        const az = land.startAz + p.ray * land.stepDeg;
        kmSum += p.km;
        if (Math.abs(delta(az)) > half) {
          pen = false;
          continue;
        }
        const px = x(az);
        if (pen && Math.abs(px - lastX) < width / 2) ctx.lineTo(px, y(p.altDeg));
        else ctx.moveTo(px, y(p.altDeg));
        pen = true;
        lastX = px;
      }
      const km = kmSum / line.length;
      ctx.strokeStyle = c.line;
      ctx.globalAlpha = Math.max(0.2, 0.85 - km / 120);
      ctx.lineWidth = km < 5 ? 1.3 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Hill names, upright from each summit; the sun or moon on top lights the name up.
    ctx.font = `${compact ? 10 : 11}px system-ui, sans-serif`;
    for (const h of labels(panorama)) {
      const sunOn = now.sun.alt > -0.6 && onTop(now.sun, h, SUN_R);
      const moonOn = now.moon.alt > -0.6 && onTop(now.moon, h, MOON_R);
      const name = h.name.replace(/ \[.*\]$/, '');
      const cue = sunOn ? ': sun on top' : moonOn ? ': moon on top' : '';
      const text = `${name}, ${h.km < 10 ? h.km.toFixed(1) : Math.round(h.km)} km${cue}`;
      ctx.strokeStyle = c.faint;
      ctx.beginPath();
      ctx.moveTo(h.px, h.py - 2);
      ctx.lineTo(h.px, Math.max(2, h.py - 12));
      ctx.stroke();
      ctx.save();
      ctx.translate(h.px + 3, Math.max(4, h.py - 14));
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = sunOn ? c.sunInk : moonOn ? c.moonInk : c.text;
      ctx.font = `${sunOn || moonOn ? '600 ' : ''}${compact ? 10 : 11}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      // Room up to the bar along the top: cut the name short rather than squash it.
      const room = Math.max(4, h.py - 14) - 30;
      // Short of room: drop the distance first, then shorten the name.
      let shown = ctx.measureText(text).width <= room ? text : `${name}${cue}`;
      if (ctx.measureText(shown).width > room) {
        while (shown.length > 3 && ctx.measureText(`${shown}…`).width > room) shown = shown.slice(0, -1);
        shown = `${shown.trimEnd()}…`;
      }
      if (room > 24) {
        // A soft halo keeps names readable over the sun, the moon and the land.
        ctx.strokeStyle = theme === 'dark' ? 'rgba(14,24,34,0.85)' : 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeText(shown, 0, 0);
        ctx.fillText(shown, 0, 0);
      }
      ctx.restore();
      const number = h.id;
      hits.push({
        x: h.px - 8,
        y: 0,
        w: 16,
        h: h.py + 4,
        act: () => (Math.abs(delta(h.azDeg)) < 1 ? onOpenHill?.(number) : (viewer.heading = h.azDeg)),
      });
    }

    // Markers at the edges for a sun or moon out of view: tap to face it.
    ctx.font = '600 11px system-ui, sans-serif';
    const placed: { x: number; y: number; w: number }[] = [];
    for (const b of bodies) {
      if (b.pos.alt < -0.6) continue;
      const d = delta(b.pos.az);
      const inside = Math.abs(d) <= viewer.fov / 2;
      const by = y(b.pos.alt);
      if (inside && by > 0) continue;
      const label = inside ? `${b.name} ↑` : d < 0 ? `‹ ${b.name}` : `${b.name} ›`;
      const w = ctx.measureText(label).width + 12;
      const bx = inside ? Math.min(width - w - 4, Math.max(4, x(b.pos.az) - w / 2)) : d < 0 ? 4 : width - w - 4;
      let top = inside ? 30 : Math.min(height - 24, Math.max(30, by - 10));
      // Sun and moon off the same side at similar heights: stack them rather than overlap.
      for (const o of placed) {
        if (bx < o.x + o.w && o.x < bx + w && Math.abs(top - o.y) < 22) top = o.y + 24 > height - 22 ? o.y - 24 : o.y + 24;
      }
      placed.push({ x: bx, y: top, w });
      ctx.fillStyle = theme === 'dark' ? 'rgba(20,28,36,0.8)' : 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.roundRect(bx, top, w, 20, 10);
      ctx.fill();
      ctx.fillStyle = b.name === 'Sun' ? c.sunInk : c.moonInk;
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 6, top + 14);
      hits.push({
        x: bx,
        y: top,
        w,
        h: 20,
        act: () => {
          // Face it, and look up far enough to have it a third of the way down.
          viewer.heading = b.pos.az;
          const range = height / pxPerDeg;
          tilt = Math.max(0, b.pos.alt + range / 3 - frameTop(b.pos.az, false));
        },
      });
    }
  }

  let frame = 0;
  $effect(() => {
    // Everything draw() reads, so any change redraws on the next frame.
    void [panorama, viewer.slice, time, width, height, viewer.heading, viewer.lens, tilt, theme, paths, now, altTop];
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  });
  // Long lenses: a finer slice across the view, asked for once turning pauses.
  let sliceTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const lens = viewer.lens;
    const heading = viewer.heading;
    const fov = viewer.fov;
    void [panorama, viewer.status];
    if (lens < 100) return;
    clearTimeout(sliceTimer);
    sliceTimer = setTimeout(() => viewer.requestSlice(heading, fov, lens >= 200 ? 0.01 : 0.02), 180);
  });

  // A new view or lens resets looking up or down.
  $effect(() => {
    void [panorama, viewer.lens];
    tilt = 0;
  });

  // Dragging: sideways turns, up and down tilts. A tap without movement acts on what's under it.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  function down(e: PointerEvent) {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    viewer.turn(-dx / pxPerDeg);
    tilt += dy / pxPerDeg;
    drag.x = e.clientX;
    drag.y = e.clientY;
  }
  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d || d.moved || !canvas) return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const hit = [...hits].reverse().find((h) => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
    hit?.act();
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    viewer.turn(d / pxPerDeg);
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') viewer.turn(-step);
    else if (e.key === 'ArrowRight') viewer.turn(step);
    else if (e.key === 'ArrowUp') tilt += step / 2;
    else if (e.key === 'ArrowDown') tilt -= step / 2;
    else return;
    e.preventDefault();
  }

  // Wheel listeners are passive by default; this one stops the page scrolling while turning.
  $effect(() => {
    const c = canvas;
    if (!c) return;
    c.addEventListener('wheel', wheel, { passive: false });
    return () => c.removeEventListener('wheel', wheel);
  });

  const headingText = $derived(`${Math.round(viewer.heading) % 360}° ${compass(viewer.heading)}`);
</script>

<div class="strip" class:compact bind:clientWidth={width} style:height="{height}px">
  <div
    class="surface"
    tabindex="0"
    role="slider"
    aria-roledescription="view"
    aria-label="The view from {place}. Drag or use the arrow keys to turn."
    aria-valuemin={0}
    aria-valuemax={359}
    aria-valuenow={Math.round(viewer.heading) % 360}
    aria-valuetext="Facing {headingText}"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (drag = null)}
    onkeydown={key}
  >
    <canvas bind:this={canvas} style:height="{height}px"></canvas>
  </div>
  <div class="bar top small">
    <span class="where"><strong>{headingText}</strong> from {place}</span>
    <span class="lenses" role="group" aria-label="Lens">
      {#each LENSES as mm (mm)}
        <button
          type="button"
          class:active={viewer.lens === mm}
          aria-pressed={viewer.lens === mm}
          onclick={() => {
            viewer.lens = mm;
            viewer.save();
          }}>{mm}{compact ? '' : ' mm'}</button
        >
      {/each}
    </span>
  </div>
  {#if viewer.status === 'loading'}
    <p class="status small">Loading the terrain and working out the view…</p>
  {:else if viewer.status === 'failed'}
    <p class="status small">Couldn’t load the terrain for this view just now.</p>
  {/if}
</div>

<style>
  .strip {
    position: relative;
    width: 100%;
    min-width: 0;
    border-radius: 10px;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  canvas {
    display: block;
    width: 100%;
  }
  .surface {
    cursor: grab;
  }
  .surface:active {
    cursor: grabbing;
  }
  .surface:focus-visible {
    outline: 2px solid var(--accent, #1f4fa0);
    outline-offset: -2px;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    pointer-events: none;
  }
  .top {
    top: 0;
  }
  .where {
    background: color-mix(in srgb, var(--surface, #fff) 85%, transparent);
    padding: 2px 8px;
    border-radius: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lenses {
    display: flex;
    gap: 2px;
    pointer-events: auto;
  }
  .lenses button {
    font-size: 0.75rem;
    padding: 2px 7px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--ink, #1b2731) 20%, transparent);
    background: color-mix(in srgb, var(--surface, #fff) 85%, transparent);
    color: inherit;
    cursor: pointer;
  }
  .lenses button.active {
    background: var(--ink, #1b2731);
    color: var(--surface, #fff);
  }
  .status {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    margin: 0;
    padding: 4px 10px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--surface, #fff) 85%, transparent);
  }
</style>
