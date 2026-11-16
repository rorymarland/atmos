<script lang="ts">
  import { explain } from '@atmos/engine';
  import { conditions, keyHourProfile, type ZoneResult } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { modelLabel } from '#lib/static-data.ts';
  import { ageLabel, dayLabel, formatTime } from '#lib/time.ts';
  import AltitudeGauge from '#lib/components/AltitudeGauge.svelte';
  import Controls from '#lib/components/Controls.svelte';
  import VerdictMark from '#lib/components/VerdictMark.svelte';

  const ranking = $derived(conditions.ranking);
  const usable = $derived(ranking.zones.filter((z) => z.result.verdict !== 'no' && z.result.verdict !== 'nodata'));
  const avoid = $derived(ranking.zones.filter((z) => z.result.verdict === 'no'));
  const best = $derived(usable[0] ?? null);
  const bestHill = $derived(best?.hills[0] ?? null);
  const bestReasons = $derived(
    best
      ? explain(bestHill?.result ?? best.result, { wind: settings.wind }, modelLabel)
          .filter((r) => r.status === 'good')
          .slice(0, 3)
      : [],
  );
  const profileLabel = $derived(conditions.data?.config.profiles[settings.profile]?.label ?? '');

  let expanded = $state<string | null>(null);

  function gaugeFor(z: ZoneResult, i: number) {
    const h = z.hills[i];
    if (!h) return null;
    const k = keyHourProfile(h.result, conditions.forecastsFor(z.zone.id));
    return k ? { layers: k.layers, groundM: k.forecast.groundElevationM, summitM: h.hill.metres } : null;
  }
</script>

<svelte:head>
  <title>Atmos: {profileLabel} {dayLabel(settings.dayOffset).toLowerCase()}</title>
</svelte:head>

<div class="page">
  <Controls />

  <div class="status small muted" aria-live="polite">
    {#if conditions.error}
      <span class="error">{conditions.error}</span>
      <button class="button quiet" onclick={() => conditions.refresh(true)}>Try again</button>
    {:else if conditions.loading}
      Fetching forecasts{#if conditions.progress}, {conditions.progress.done} of {conditions.progress.total}{/if}…
    {:else if conditions.fetchedAt}
      Forecasts updated {ageLabel(conditions.fetchedAt, conditions.now)}, {formatTime(conditions.fetchedAt)}.
      <button class="link" onclick={() => conditions.refresh(true)}>Refresh</button>
    {/if}
  </div>

  {#if ranking.windowPassed && settings.dayOffset === 0}
    <p class="note small">Today's window has passed for some zones; their verdicts show what was forecast.</p>
  {/if}

  {#if best}
    <section class="best" aria-labelledby="best-title">
      <p class="eyebrowless muted small">Best bet, {dayLabel(settings.dayOffset).toLowerCase()}</p>
      <h1 id="best-title">
        <a href={bestHill ? `?hill=${bestHill.hill.number}` : `?zone=${best.zone.id}`}>
          {bestHill ? bestHill.hill.name : best.zone.name}
        </a>
      </h1>
      <p class="where">
        {#if bestHill}{Math.round(bestHill.hill.metres)} m, {best.zone.name}{:else}Valley forecast{/if}{#if best.miles !== null}<span class="muted">, {Math.round(bestHill?.miles ?? best.miles)} miles in a straight line</span>{/if}
      </p>
      <div class="best-verdict">
        <VerdictMark verdict={(bestHill?.result ?? best.result).verdict} confidence={(bestHill?.result ?? best.result).confidence} size="large" />
        <span class="small muted">{formatTime(best.window.start)} to {formatTime(best.window.end)}</span>
      </div>
      {#if bestReasons.length}
        <ul class="best-reasons small">
          {#each bestReasons as r, i (i)}<li>{r.text}</li>{/each}
        </ul>
      {/if}
    </section>
  {:else if conditions.data && !conditions.loading && ranking.zones.length > 0}
    <section class="best none">
      <h1>Nothing looks good for {profileLabel.toLowerCase()} {dayLabel(settings.dayOffset).toLowerCase()}</h1>
      <p class="muted">Try another day or profile, or widen the filters.</p>
    </section>
  {:else if conditions.data && conditions.filteredHills.length === 0}
    <section class="best none">
      <h1>No hills match the filters</h1>
      <p class="muted">Turn on more hill lists, lower the minimum height or allow a greater distance.</p>
    </section>
  {/if}

  {#if usable.length > 0}
    <section aria-labelledby="go-title">
      <h2 id="go-title" class="list-title">Worth going</h2>
      <ol class="zones">
        {#each usable as z (z.zone.id)}
          {@render zoneRow(z)}
        {/each}
      </ol>
    </section>
  {/if}

  {#if avoid.length > 0}
    <section aria-labelledby="avoid-title">
      <details class="avoid" open={usable.length === 0}>
        <summary><h2 id="avoid-title" class="list-title">Avoid: {avoid.length} {avoid.length === 1 ? 'zone' : 'zones'}</h2></summary>
        <ul class="avoid-list">
          {#each avoid as z (z.zone.id)}
            {@const reason = explain(z.result, { wind: settings.wind }, modelLabel).find((r) => r.status === 'blocked' || r.status === 'poor')}
            <li>
              <a href={ranking.summitProfile && z.hills[0] ? `?hill=${z.hills[0].hill.number}` : `?zone=${z.zone.id}`}>{z.zone.name}</a>
              {#if reason}<span class="small muted">{reason.text}</span>{/if}
            </li>
          {/each}
        </ul>
      </details>
    </section>
  {/if}
</div>

{#snippet zoneRow(z: ZoneResult)}
  {@const gauge = ranking.summitProfile ? gaugeFor(z, 0) : null}
  <li class="zone">
    <div class="zone-head">
      <VerdictMark verdict={z.result.verdict} confidence={z.result.confidence} />
      {#if gauge}<AltitudeGauge {...gauge} />{:else}<span></span>{/if}
      <div class="zone-text">
        <a class="zone-name" href={ranking.summitProfile && z.hills[0] ? `?hill=${z.hills[0].hill.number}` : `?zone=${z.zone.id}`}>
          {ranking.summitProfile && z.hills[0] ? z.hills[0].hill.name : z.zone.name}
        </a>
        <span class="small muted">
          {#if ranking.summitProfile}{z.zone.name}{#if z.goCount > 1}, {z.goCount} hills look good{/if}{:else}Valley forecast{/if}{#if (z.hills[0]?.miles ?? z.miles) !== null}, {Math.round((z.hills[0]?.miles ?? z.miles)!)} miles{/if}
        </span>
      </div>
      {#if ranking.summitProfile && z.hills.length > 1}
        <button
          class="more"
          aria-expanded={expanded === z.zone.id}
          aria-controls="hills-{z.zone.id}"
          onclick={() => (expanded = expanded === z.zone.id ? null : z.zone.id)}
        >
          {expanded === z.zone.id ? 'Fewer' : `${z.hills.length - 1} more`}
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
            <a href="?hill={h.hill.number}">{h.hill.name}</a>
            <span class="small muted">{Math.round(h.hill.metres)} m</span>
          </li>
        {/each}
        {#if z.hills.length > 25}<li class="small muted">and {z.hills.length - 25} more on the map</li>{/if}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 18px 20px 32px;
    display: grid;
    gap: 18px;
  }
  .status {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    min-height: 1.5em;
  }
  .error {
    color: var(--no);
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    text-decoration: underline;
    color: inherit;
  }
  .note {
    border-left: 3px solid var(--gold);
    padding-left: 10px;
  }
  .best {
    padding: 8px 0 18px;
    border-bottom: 1px solid var(--line);
    display: grid;
    gap: 6px;
  }
  .best h1 {
    font-size: clamp(2.4rem, 9vw, 3.8rem);
    font-stretch: 62%;
    font-weight: 850;
    line-height: 0.98;
    letter-spacing: -0.01em;
  }
  .best h1 a {
    text-decoration: none;
  }
  .best h1 a:hover {
    text-decoration: underline;
    text-decoration-thickness: 2px;
  }
  .best.none h1 {
    font-size: 1.6rem;
  }
  .where {
    font-size: 1.05rem;
  }
  .best-verdict {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
  }
  .best-reasons {
    margin: 6px 0 0;
    padding-left: 1.1em;
    color: var(--ink-soft);
    max-width: 62ch;
  }
  .list-title {
    font-size: 1rem;
    color: var(--ink-soft);
    font-stretch: 85%;
    margin-bottom: 4px;
  }
  .zones,
  .hills {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .zone {
    border-bottom: 1px solid var(--line);
    padding: 10px 0;
  }
  .zone-head {
    display: grid;
    grid-template-columns: 7.5rem 14px 1fr auto;
    align-items: center;
    gap: 12px;
  }
  .zone-head > :global(.mark) {
    justify-self: start;
  }
  .zone-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .zone-name {
    font-weight: 700;
    font-stretch: 78%;
    font-size: 1.15rem;
    text-decoration: none;
  }
  .zone-name:hover {
    text-decoration: underline;
  }
  .avoid summary {
    cursor: pointer;
    list-style-position: outside;
  }
  .avoid summary h2 {
    display: inline;
  }
  .avoid-list {
    list-style: none;
    padding: 0;
    margin: 10px 0 0;
    columns: 2 260px;
    column-gap: 28px;
  }
  .avoid-list li {
    break-inside: avoid;
    padding: 5px 0;
    display: flex;
    flex-direction: column;
  }
  .avoid-list a {
    font-stretch: 85%;
    font-weight: 600;
    text-decoration: none;
    color: var(--ink-soft);
  }
  .more {
    flex: none;
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 4px 9px;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }
  .hills {
    margin: 10px 0 2px 0;
    padding-left: 12px;
    border-left: 2px solid var(--line);
    display: grid;
    gap: 6px;
  }
  .hills li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hills a {
    font-stretch: 85%;
    font-weight: 600;
    text-decoration: none;
  }
</style>
