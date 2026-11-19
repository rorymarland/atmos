<script lang="ts">
  /**
   * The day at a glance along the bottom of the map: night, blue and golden hour, the
   * sun's and moon's height, and when each condition peaks for the chosen hill. Drag or
   * click to pick a moment; the map shows where the sun and moon are then.
   */
  import type { Verdict } from '@atmos/engine';
  import { compass, moonTimes, skyPositions, type SunTimes } from '#lib/sun.ts';
  import { formatTime } from '#lib/time.ts';

  export interface KeyMark {
    time: number;
    label: string;
    verdict: Verdict;
  }

  let {
    lat,
    lon,
    place,
    dayStart,
    sun,
    marks = [],
    time = $bindable(),
  }: {
    lat: number;
    lon: number;
    place: string;
    dayStart: number;
    sun: SunTimes;
    marks?: KeyMark[];
    time: number;
  } = $props();

  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  /** Drawn at the real pixel width so the hour labels aren't stretched. */
  let width = $state(1000);
  const W = $derived(Math.max(200, width));
  const H = 58;
  const TOP = 4;
  const BOTTOM = 46;
  /** Below about −14° it's simply night: no need to draw deeper. */
  const MIN_ALT = -14;

  /** Sun and moon every ten minutes across the day. */
  const samples = $derived.by(() => {
    const out: { t: number; sun: number; moon: number }[] = [];
    for (let t = dayStart; t <= dayStart + DAY; t += HOUR / 6) {
      const p = skyPositions(t, lat, lon);
      out.push({ t, sun: p.sun.altDeg, moon: p.moon.altDeg });
    }
    return out;
  });
  /**
   * The top of the scale follows the day's highest sun or moon, so a low winter sun still
   * fills the height instead of hugging the horizon.
   */
  const MAX_ALT = $derived(
    Math.min(64, Math.max(20, Math.ceil(Math.max(...samples.map((s) => Math.max(s.sun, s.moon))) + 4))),
  );

  const x = (t: number) => ((t - dayStart) / DAY) * W;
  const y = (alt: number) =>
    TOP + ((MAX_ALT - Math.max(MIN_ALT, Math.min(MAX_ALT, alt))) / (MAX_ALT - MIN_ALT)) * (BOTTOM - TOP);
  const horizon = $derived(y(0));
  const path = (key: 'sun' | 'moon') =>
    samples.map((s, i) => `${i ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`).join('');
  const sunPath = $derived(path('sun'));
  const moonPath = $derived(path('moon'));
  const moon = $derived(moonTimes(lat, lon, dayStart));
  const now = $derived(skyPositions(time, lat, lon));

  /** Light bands: [start, end, kind]. */
  const bands = $derived.by(() => {
    const list: [number | null, number | null, string][] = [
      [sun.civilDawn, sun.goldenStart, 'blue'],
      [sun.goldenStart, sun.goldenEnd, 'golden'],
      [sun.eveningGoldenStart, sun.eveningBlueStart, 'golden'],
      [sun.eveningBlueStart, sun.civilDusk, 'blue'],
    ];
    return list.filter((b): b is [number, number, string] => b[0] !== null && b[1] !== null);
  });
  const dawn = $derived(sun.civilDawn ?? dayStart);
  const dusk = $derived(sun.civilDusk ?? dayStart + DAY);

  let svg: SVGSVGElement | undefined = $state();
  let dragging = false;

  function timeAt(e: PointerEvent): number {
    const r = svg!.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    // Snap to five minutes.
    const t = dayStart + frac * DAY;
    return Math.round(t / 300_000) * 300_000;
  }
  function down(e: PointerEvent) {
    dragging = true;
    svg?.setPointerCapture(e.pointerId);
    time = timeAt(e);
  }
  function move(e: PointerEvent) {
    if (dragging) time = timeAt(e);
  }
  function up(e: PointerEvent) {
    dragging = false;
    svg?.releasePointerCapture(e.pointerId);
  }
  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? HOUR : 10 * 60_000;
    if (e.key === 'ArrowRight') time = Math.min(dayStart + DAY, time + step);
    else if (e.key === 'ArrowLeft') time = Math.max(dayStart, time - step);
    else return;
    e.preventDefault();
  }

  const hours = [0, 3, 6, 9, 12, 15, 18, 21];
  const sunBelow = $derived(now.sun.altDeg < 0);
  const moonBelow = $derived(now.moon.altDeg < 0);
</script>

<div class="timeline" bind:clientWidth={width}>
  <div class="readout small">
    <strong class="clock">{formatTime(time)}</strong>
    <span class="body sun-key">
      Sun {Math.round(now.sun.altDeg)}°{#if !sunBelow}, {compass(now.sun.azDeg)} ({Math.round(now.sun.azDeg)}°){:else}{' below the horizon'}{/if}
    </span>
    <span class="body moon-key">
      Moon {Math.round(now.moon.altDeg)}°{#if !moonBelow}, {compass(now.moon.azDeg)} ({Math.round(now.moon.azDeg)}°){:else}{' below the horizon'}{/if}, {Math.round(now.moonLit * 100)}% lit
    </span>
    <span class="times muted" title="At {place}">
      {#if sun.sunrise}<span>Sunrise {formatTime(sun.sunrise)}</span>{/if}
      {#if sun.sunset}<span>Sunset {formatTime(sun.sunset)}</span>{/if}
      {#if moon.rise}<span>Moonrise {formatTime(moon.rise)}</span>{/if}
      {#if moon.set}<span>Moonset {formatTime(moon.set)}</span>{/if}
    </span>
  </div>

  <svg
    bind:this={svg}
    viewBox="0 0 {W} {H}"
    preserveAspectRatio="none"
    role="slider"
    tabindex="0"
    aria-label="Time of day for the sun and moon positions"
    aria-valuemin={dayStart}
    aria-valuemax={dayStart + DAY}
    aria-valuenow={time}
    aria-valuetext="{formatTime(time)}: sun {Math.round(now.sun.altDeg)} degrees, moon {Math.round(now.moon.altDeg)} degrees"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onkeydown={key}
  >
    <!-- Night either side of civil twilight, then the light bands. -->
    <rect class="night" x="0" y="0" width={x(dawn)} height={BOTTOM} />
    <rect class="night" x={x(dusk)} y="0" width={W - x(dusk)} height={BOTTOM} />
    {#each bands as [a, b, kind], i (i)}
      <rect class={kind} x={x(a)} y="0" width={Math.max(1, x(b) - x(a))} height={BOTTOM} />
    {/each}
    <line class="horizon" x1="0" x2={W} y1={horizon} y2={horizon} />

    <path class="moon-line" d={moonPath} />
    <path class="sun-line" d={sunPath} />

    {#each marks as m, i (i)}
      <g class="mark {m.verdict}">
        <title>{m.label} at its best around {formatTime(m.time)}</title>
        <line x1={x(m.time)} x2={x(m.time)} y1={BOTTOM - 7} y2={BOTTOM} />
        <circle cx={x(m.time)} cy={BOTTOM - 9} r="3" />
      </g>
    {/each}

    <line class="cursor" x1={x(time)} x2={x(time)} y1="0" y2={BOTTOM} />
    <circle class="sun-dot" cx={x(time)} cy={y(now.sun.altDeg)} r="4.5" />
    <circle class="moon-dot" cx={x(time)} cy={y(now.moon.altDeg)} r="3.5" />

    {#each hours as h (h)}
      <text class="tick" x={x(dayStart + h * HOUR) + 3} y={H - 2}>{String(h).padStart(2, '0')}</text>
    {/each}
  </svg>

</div>

<style>
  .timeline {
    display: grid;
    gap: 2px;
    background: color-mix(in srgb, var(--paper) 92%, transparent);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 4px 8px 3px;
    box-shadow: 0 2px 8px rgb(20 29 36 / 0.1);
  }
  .readout {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    align-items: baseline;
  }
  .clock {
    font-size: 0.95rem;
    font-stretch: 80%;
    font-variant-numeric: tabular-nums;
  }
  .body::before {
    content: '';
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: -0.5px;
  }
  .sun-key::before {
    background: var(--gold);
  }
  .moon-key::before {
    background: #8b98a6;
  }
  .times {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 0 12px;
  }
  svg {
    width: 100%;
    height: 58px;
    display: block;
    cursor: ew-resize;
    touch-action: none;
    border-radius: 6px;
  }
  svg:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .night {
    fill: #2a3a4a;
    opacity: 0.18;
  }
  .blue {
    fill: #5b7fb0;
    opacity: 0.28;
  }
  .golden {
    fill: var(--gold);
    opacity: 0.3;
  }
  .horizon {
    stroke: var(--ink-soft);
    stroke-width: 1;
    stroke-dasharray: 3 3;
    vector-effect: non-scaling-stroke;
  }
  .sun-line,
  .moon-line {
    fill: none;
    vector-effect: non-scaling-stroke;
  }
  .sun-line {
    stroke: #c28a24;
    stroke-width: 2.2;
  }
  .moon-line {
    stroke: #8b98a6;
    stroke-width: 1.6;
    stroke-dasharray: 5 3;
  }
  .cursor {
    stroke: var(--ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .sun-dot {
    fill: var(--gold);
    stroke: #fff;
    stroke-width: 1.5;
  }
  .moon-dot {
    fill: #e9edf1;
    stroke: #6d7a88;
    stroke-width: 1.5;
  }
  .mark line {
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .mark.go circle,
  .mark.go line {
    fill: var(--go);
    stroke: var(--go);
  }
  .mark.maybe circle,
  .mark.maybe line {
    fill: var(--maybe);
    stroke: var(--maybe);
  }
  .mark.no circle,
  .mark.no line,
  .mark.nodata circle,
  .mark.nodata line {
    fill: var(--no);
    stroke: var(--no);
  }
  .tick {
    font-size: 10px;
    fill: var(--ink-soft);
  }
</style>
