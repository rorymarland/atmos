<script lang="ts">
  /**
   * The air above the zone's valley at one hour: temperature against height, cloud
   * layers as mist bands, and the summit as a line. Warmer air above colder air is
   * the inversion; a summit line above the top band stands above the cloud sea.
   */
  import { profileAt, saturatedLayers, type ModelForecast } from '@atmos/engine';
  import { formatTime } from '#lib/time.ts';

  let {
    forecast,
    index,
    summitM,
    summitName,
  }: { forecast: ModelForecast; index: number; summitM: number | null; summitName: string } =
    $props();

  const W = 340;
  const H = 280;
  const pad = { l: 46, r: 16, t: 16, b: 34 };

  const profile = $derived(profileAt(forecast, index));
  const layers = $derived(saturatedLayers(profile.relativeHumidity, 95));
  const top = $derived(
    Math.max(1500, Math.ceil(((summitM ?? 0) + 400) / 500) * 500),
  );
  const temps = $derived(profile.temperature.filter((p) => p.heightM <= top + 300));
  const tMin = $derived(Math.floor(Math.min(...temps.map((p) => p.value), 0) - 2));
  const tMax = $derived(Math.ceil(Math.max(...temps.map((p) => p.value), 0) + 2));

  const x = (t: number) => pad.l + ((t - tMin) / (tMax - tMin)) * (W - pad.l - pad.r);
  const y = (m: number) => H - pad.b - (Math.min(Math.max(m, 0), top) / top) * (H - pad.t - pad.b);

  const path = $derived(
    temps
      .filter((p) => p.heightM <= top)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.value).toFixed(1)},${y(p.heightM).toFixed(1)}`)
      .join(' '),
  );
  const heightTicks = $derived(Array.from({ length: top / 500 + 1 }, (_, i) => i * 500));
  const tempTicks = $derived(
    Array.from({ length: tMax - tMin + 1 }, (_, i) => tMin + i).filter((t) => t % 2 === 0),
  );

  const summary = $derived.by(() => {
    const cloud = layers.length
      ? layers.map((l) => `cloud from ${Math.round(l.baseM)} to ${Math.round(l.topM)} m`).join(', ')
      : 'no cloud layers';
    return `Air above ${Math.round(profile.groundM)} m at ${formatTime(forecast.time[index]!)}: ${cloud}.`;
  });
</script>

<figure>
  <svg viewBox="0 0 {W} {H}" role="img" aria-label={summary}>
    {#each heightTicks as h (h)}
      <line x1={pad.l} x2={W - pad.r} y1={y(h)} y2={y(h)} class="grid" />
      <text x={pad.l - 6} y={y(h) + 4} class="tick" text-anchor="end">{h} m</text>
    {/each}
    {#each tempTicks as t (t)}
      <text x={x(t)} y={H - pad.b + 16} class="tick" text-anchor="middle">{t}°</text>
    {/each}
    {#if tMin < 0 && tMax > 0}
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} class="freeze" />
    {/if}

    {#each layers as l, i (i)}
      <rect
        x={pad.l}
        y={y(l.topM)}
        width={W - pad.l - pad.r}
        height={Math.max(2, y(l.baseM) - y(l.topM))}
        class="cloud"
      />
    {/each}

    <rect x={pad.l} y={y(profile.groundM)} width={W - pad.l - pad.r} height={H - pad.b - y(profile.groundM)} class="ground" />

    <path d={path} class="temp" />
    {#each temps.filter((p) => p.heightM <= top) as p (p.heightM)}
      <circle cx={x(p.value)} cy={y(p.heightM)} r="2.5" class="dot" />
    {/each}

    {#if summitM !== null}
      <line x1={pad.l} x2={W - pad.r} y1={y(summitM)} y2={y(summitM)} class="summit" />
      <text x={pad.l + 6} y={y(summitM) - 6} text-anchor="start" class="summit-label">
        {summitName} {Math.round(summitM)} m
      </text>
    {/if}
    <text x={(pad.l + W - pad.r) / 2} y={H - 4} class="axis" text-anchor="middle">Temperature (°C)</text>
  </svg>
  <figcaption class="small muted">
    {summary} Mist bands are cloud (humidity 95% or more); the line is temperature with height.
    Temperature rising with height is an inversion.
  </figcaption>
</figure>

<style>
  figure {
    margin: 0;
  }
  svg {
    width: 100%;
    max-width: 420px;
    height: auto;
    display: block;
  }
  .grid {
    stroke: var(--line);
    stroke-width: 1;
  }
  .tick,
  .axis {
    fill: var(--ink-soft);
    font-size: 11px;
  }
  .freeze {
    stroke: var(--focus);
    stroke-dasharray: 2 3;
    opacity: 0.6;
  }
  .cloud {
    fill: var(--mist);
    opacity: 0.85;
  }
  .ground {
    fill: var(--ink-soft);
    opacity: 0.18;
  }
  .temp {
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--ink);
  }
  .summit {
    stroke: var(--gold);
    stroke-width: 2;
    stroke-dasharray: 6 4;
  }
  .summit-label {
    fill: var(--ink);
    paint-order: stroke;
    stroke: var(--paper);
    stroke-width: 3px;
    font-size: 12px;
    font-weight: 650;
    font-stretch: 80%;
  }
  figcaption {
    margin-top: 6px;
    max-width: 60ch;
  }
</style>
