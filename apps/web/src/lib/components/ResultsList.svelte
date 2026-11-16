<script lang="ts" module>
  export interface Pick {
    lat: number;
    lon: number;
    href: string;
    zoom: number;
  }
</script>

<script lang="ts">
  /** Best bet, areas worth going to, those that need an earlier start, and Avoid. */
  import { explain, formatDuration } from '@atmos/engine';
  import { conditions, keyHourProfile, type Trip, type ZoneResult } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { modelLabel } from '#lib/static-data.ts';
  import { dayLabel, formatClock, formatTime, londonMidnight } from '#lib/time.ts';
  import AltitudeGauge from './AltitudeGauge.svelte';
  import VerdictMark from './VerdictMark.svelte';

  let {
    onSelect,
    onHover,
  }: { onSelect: (p: Pick) => void; onHover: (p: { lat: number; lon: number } | null) => void } =
    $props();

  const ranking = $derived(conditions.ranking);
  const usable = $derived(ranking.go);
  const tooEarly = $derived(ranking.tooEarly);
  const avoid = $derived(ranking.avoid);
  const dayStart = $derived(londonMidnight(settings.dayOffset, conditions.now));
  const clock = (ms: number) => formatClock(ms, dayStart);
  const tripLine = (t: Trip) => `Leave ${clock(t.plan.leaveAt)}, ${formatDuration(t.driveMinutes)} drive`;
  const problemLine = (t: Trip) =>
    t.problem === 'too-late' ? `Leave by ${clock(t.plan.leaveAt)}: passed` : `Up at ${clock(t.plan.wakeAt)}`;
  const best = $derived(usable[0] ?? null);
  const bestHill = $derived(best?.hills[0] ?? null);
  const bestReasons = $derived(
    best
      ? explain(bestHill?.result ?? best.result, { wind: settings.wind }, modelLabel)
          .filter((r) => r.status === 'good')
          .slice(0, 3)
      : [],
  );
  const profileLabel = $derived(
    conditions.data?.config.profiles[settings.profile]?.label.toLowerCase() ?? '',
  );

  let expanded = $state<string | null>(null);

  function pickFor(z: ZoneResult, hillIndex = 0): Pick {
    const h = ranking.summitProfile ? z.hills[hillIndex] : undefined;
    return h
      ? { lat: h.hill.lat, lon: h.hill.lon, href: `?hill=${h.hill.number}`, zoom: 11 }
      : { ...z.zone.forecastPoint, href: `?zone=${z.zone.id}`, zoom: 9.5 };
  }

  function gaugeFor(z: ZoneResult, i: number) {
    const h = z.hills[i];
    if (!h) return null;
    const k = keyHourProfile(h.result, conditions.forecastsFor(z.zone.id));
    return k
      ? { layers: k.layers, groundM: k.forecast.groundElevationM, summitM: h.hill.metres }
      : null;
  }

  const miles = (z: ZoneResult) => z.hills[0]?.miles ?? z.miles;
  const rowName = (z: ZoneResult) =>
    ranking.summitProfile && z.hills[0] ? z.hills[0].hill.name : z.zone.name;
</script>

{#snippet target(p: Pick, label: string, cls: string)}
  <a
    class={cls}
    href={p.href}
    onclick={(e) => {
      e.preventDefault();
      onSelect(p);
    }}
    onmouseenter={() => onHover(p)}
    onmouseleave={() => onHover(null)}
    onfocus={() => onHover(p)}
    onblur={() => onHover(null)}>{label}</a
  >
{/snippet}

{#if best}
  {@const p = pickFor(best)}
  <section class="best" aria-labelledby="best-title">
    <p class="small muted">Best bet for {profileLabel}, {dayLabel(settings.dayOffset).toLowerCase()}</p>
    <h2 id="best-title">{@render target(p, bestHill ? bestHill.hill.name : best.zone.name, 'best-name')}</h2>
    <p>
      {#if bestHill}{Math.round(bestHill.hill.metres)} m, {best.zone.name}{:else}{best.zone.name}{/if}{#if miles(best) !== null}<span
          class="muted">, {Math.round(miles(best)!)} miles</span
        >{/if}
    </p>
    <div class="best-verdict">
      <VerdictMark
        verdict={(bestHill?.result ?? best.result).verdict}
        confidence={(bestHill?.result ?? best.result).confidence}
        size="large"
      />
      <span class="small muted">{formatTime(best.window.start)} to {formatTime(best.window.end)}</span>
    </div>
    {#if best.trip}
      {@const t = best.trip}
      <dl class="trip">
        <div><dt>Up</dt><dd>{clock(t.plan.wakeAt)}</dd></div>
        <div class="leave"><dt>Leave</dt><dd>{clock(t.plan.leaveAt)}</dd></div>
        <div><dt>Drive</dt><dd>{formatDuration(t.driveMinutes)}</dd></div>
        <div><dt>{ranking.summitProfile ? 'Walk up' : 'Walk'}</dt><dd>{formatDuration(t.walkMinutes)}</dd></div>
        <div><dt>In place</dt><dd>{clock(t.plan.arriveAt)}</dd></div>
      </dl>
      <p class="small muted">In place {settings.earlyMinutes} min before {t.targetLabel} ({clock(t.plan.target)}). Times are rough estimates.</p>
    {:else}
      <p class="small muted hint">Set a start point or home to see when to leave.</p>
    {/if}
    {#if bestReasons.length}
      <ul class="reasons small">
        {#each bestReasons as r, i (i)}<li>{r.text}</li>{/each}
      </ul>
    {/if}
  </section>
{:else if conditions.data && !conditions.loading && tooEarly.length > 0}
  <section class="best">
    <h2 class="none">Nothing worth it without an earlier start</h2>
    <p class="small muted">
      The places below look good, but you’d need to be up before {settings.earliestUp}. Allow an
      earlier start, a later moment, or try another day.
    </p>
  </section>
{:else if conditions.data && !conditions.loading && ranking.zones.length > 0}
  <section class="best">
    <h2 class="none">Nothing looks good for {profileLabel} {dayLabel(settings.dayOffset).toLowerCase()}</h2>
    <p class="small muted">Try another day or profile, or widen the filters.</p>
  </section>
{:else if conditions.data && conditions.filteredHills.length === 0}
  <section class="best">
    <h2 class="none">No hills match the filters</h2>
    <p class="small muted">Turn on more hill lists, lower the minimum height or allow a longer drive.</p>
  </section>
{/if}

{#if usable.length > 0}
  <section aria-labelledby="go-title">
    <h3 id="go-title" class="list-title">Worth going</h3>
    <ol class="zones">
      {#each usable as z (z.zone.id)}
        {@const gauge = ranking.summitProfile ? gaugeFor(z, 0) : null}
        <li class="zone">
          <div class="zone-head">
            <VerdictMark verdict={z.result.verdict} confidence={z.result.confidence} />
            {#if gauge}<AltitudeGauge {...gauge} />{:else}<span></span>{/if}
            <div class="zone-text">
              {@render target(pickFor(z), rowName(z), 'zone-name')}
              <span class="small muted">
                {#if ranking.summitProfile}{z.zone.name}{#if z.goCount > 1}, {z.goCount} good{/if}{:else}Valley forecast{/if}{#if !z.trip && miles(z) !== null}, {Math.round(miles(z)!)} mi{/if}
              </span>
              {#if z.trip}<span class="small leave-line">{tripLine(z.trip)}</span>{/if}
            </div>
            {#if ranking.summitProfile && z.hills.length > 1}
              <button
                class="more"
                aria-expanded={expanded === z.zone.id}
                aria-controls="hills-{z.zone.id}"
                aria-label="{expanded === z.zone.id ? 'Hide' : 'Show'} other hills in {z.zone.name}"
                onclick={() => (expanded = expanded === z.zone.id ? null : z.zone.id)}
              >
                {expanded === z.zone.id ? 'Less' : `+${z.hills.length - 1}`}
              </button>
            {/if}
          </div>
          {#if expanded === z.zone.id}
            <ul class="hills" id="hills-{z.zone.id}">
              {#each z.hills.slice(1, 25) as h, i (h.hill.number)}
                {@const g = gaugeFor(z, i + 1)}
                <li>
                  <VerdictMark verdict={h.result.verdict} />
                  {#if g}<AltitudeGauge {...g} />{/if}
                  {@render target(pickFor(z, i + 1), h.hill.name, 'hill-name')}
                  <span class="small muted">{Math.round(h.hill.metres)} m{#if h.trip}, {h.trip.problem ? problemLine(h.trip).toLowerCase() : `leave ${clock(h.trip.plan.leaveAt)}`}{/if}</span>
                </li>
              {/each}
              {#if z.hills.length > 25}<li class="small muted">and {z.hills.length - 25} more on the map</li>{/if}
            </ul>
          {/if}
        </li>
      {/each}
    </ol>
  </section>
{/if}

{#if tooEarly.length > 0}
  <section aria-labelledby="early-title">
    <details class="avoid" open={usable.length === 0}>
      <summary><h3 id="early-title" class="list-title">Needs an earlier start: {tooEarly.length}</h3></summary>
      <ul class="avoid-list">
        {#each tooEarly as z (z.zone.id)}
          <li class="early">
            <VerdictMark verdict={z.result.verdict} />
            <span class="early-text">
              {@render target(pickFor(z), rowName(z), 'avoid-name')}
              {#if z.trip}<span class="small muted">{problemLine(z.trip)}, {formatDuration(z.trip.driveMinutes)} drive</span>{/if}
            </span>
          </li>
        {/each}
      </ul>
    </details>
  </section>
{/if}

{#if avoid.length > 0}
  <section aria-labelledby="avoid-title">
    <details class="avoid" open={usable.length === 0}>
      <summary><h3 id="avoid-title" class="list-title">Avoid: {avoid.length} {avoid.length === 1 ? 'area' : 'areas'}</h3></summary>
      <ul class="avoid-list">
        {#each avoid as z (z.zone.id)}
          {@const reason = explain(z.result, { wind: settings.wind }, modelLabel).find(
            (r) => r.status === 'blocked' || r.status === 'poor',
          )}
          <li>
            {@render target(pickFor(z), z.zone.name, 'avoid-name')}
            {#if reason}<span class="small muted">{reason.text}</span>{/if}
          </li>
        {/each}
      </ul>
    </details>
  </section>
{/if}

<style>
  section {
    display: grid;
    gap: 4px;
  }
  .best {
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
    gap: 6px;
  }
  .best h2 {
    font-size: 2.3rem;
    font-stretch: 62%;
    font-weight: 850;
    line-height: 0.98;
    letter-spacing: -0.01em;
  }
  .best h2.none {
    font-size: 1.35rem;
    line-height: 1.2;
  }
  .best :global(.best-name) {
    text-decoration: none;
  }
  .best :global(.best-name:hover) {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }
  .best-verdict {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 2px;
  }
  .trip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 18px;
    margin: 6px 0 0;
  }
  .trip div {
    display: flex;
    flex-direction: column;
  }
  .trip dt {
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .trip dd {
    margin: 0;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
  }
  .trip .leave dd {
    color: var(--ink);
    font-size: 1.35rem;
    font-stretch: 75%;
    font-weight: 850;
    line-height: 1;
  }
  .trip {
    align-items: flex-end;
  }
  .leave-line {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .early {
    flex-direction: row !important;
    align-items: center;
    gap: 10px;
  }
  .early-text {
    display: flex;
    flex-direction: column;
  }
  .reasons {
    margin: 4px 0 0;
    padding-left: 1.1em;
    color: var(--ink-soft);
  }
  .list-title {
    font-size: 0.95rem;
    color: var(--ink-soft);
    font-stretch: 85%;
    margin: 6px 0 2px;
  }
  .zones,
  .hills,
  .avoid-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .zone {
    border-bottom: 1px solid var(--line);
    padding: 8px 0;
  }
  .zone-head {
    display: grid;
    grid-template-columns: 6.6rem 14px 1fr auto;
    align-items: center;
    gap: 10px;
  }
  .zone-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .zone-text :global(.zone-name) {
    font-weight: 700;
    font-stretch: 78%;
    font-size: 1.08rem;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zone-text :global(.zone-name:hover),
  .hills :global(.hill-name:hover),
  .avoid-list :global(.avoid-name:hover) {
    text-decoration: underline;
  }
  .more {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 0.82rem;
    color: var(--ink-soft);
  }
  .hills {
    margin: 8px 0 2px;
    padding-left: 10px;
    border-left: 2px solid var(--line);
    display: grid;
    gap: 6px;
  }
  .hills li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hills :global(.hill-name) {
    font-stretch: 85%;
    font-weight: 600;
    text-decoration: none;
  }
  .avoid summary {
    cursor: pointer;
  }
  .avoid summary h3 {
    display: inline;
  }
  .avoid-list li {
    padding: 5px 0;
    display: flex;
    flex-direction: column;
  }
  .avoid-list :global(.avoid-name) {
    font-stretch: 85%;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink-soft);
  }
</style>
