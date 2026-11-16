<script lang="ts" module>
  export interface Pick {
    lat: number;
    lon: number;
    href: string;
    zoom: number;
  }
</script>

<script lang="ts">
  /** The best bet, then every hill by photo score, with those that need an earlier start. */
  import { explain, formatDuration } from '@atmos/engine';
  import {
    conditions,
    type ConditionTrip,
    type HillResult,
    type Trip,
  } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { modelLabel } from '#lib/static-data.ts';
  import { PERIOD_LABELS } from '#lib/sun.ts';
  import { dayLabel, formatClock, londonMidnight } from '#lib/time.ts';
  import VerdictMark from './VerdictMark.svelte';

  let {
    onSelect,
    onHover,
  }: { onSelect: (p: Pick) => void; onHover: (p: { lat: number; lon: number } | null) => void } =
    $props();

  const PAGE = 30;
  const ranking = $derived(conditions.ranking);
  const worth = $derived(ranking.go);
  const tooEarly = $derived(ranking.tooEarly);
  const rest = $derived(ranking.rest);
  const best = $derived(settings.sort === 'best' ? (worth[0] ?? null) : null);
  const listed = $derived(best ? worth.slice(1) : worth);
  let shown = $state(PAGE);
  let restShown = $state(PAGE);
  $effect(() => {
    // Back to the first page whenever the search changes.
    void ranking;
    shown = PAGE;
    restShown = PAGE;
  });

  const dayStart = $derived(londonMidnight(settings.dayOffset, conditions.now));
  const clock = (ms: number) => formatClock(ms, dayStart);
  const pct = (score: number | null) => (score === null ? '–' : String(Math.round(score * 100)));
  const pickFor = (h: HillResult): Pick => ({ lat: h.hill.lat, lon: h.hill.lon, href: `?hill=${h.hill.number}`, zoom: 10 });
  const periodWord = (c: ConditionTrip) =>
    conditions.data && conditions.data.config.profiles[c.profileId]!.periods.length > 1
      ? ` ${c.period === 'morning' ? 'am' : 'pm'}`
      : '';
  /** High midge risk at dawn or dusk. */
  const midgy = (h: HillResult) =>
    h.conditions.some(
      (c) => conditions.data?.config.profiles[c.profileId]?.risk && c.result.verdict === 'go',
    );
  /** The conditions worth mentioning on a row: Go and Maybe, best first. */
  const highlights = (h: HillResult) => h.counted.filter((c) => c.result.verdict === 'go' || c.result.verdict === 'maybe').slice(0, 4);
  const tripLine = (t: Trip) => `leave ${clock(t.plan.leaveAt)}, ${formatDuration(t.driveMinutes)} drive`;
  const problemLine = (t: Trip) =>
    t.problem === 'too-late' ? `Leave by ${clock(t.plan.leaveAt)}: passed` : `Up at ${clock(t.plan.wakeAt)}`;

  /** Other good conditions at the best bet, each named once. */
  const alsoGood = $derived(
    best
      ? [...new Set(highlights(best).map((c) => c.profileId))]
          .filter((id) => id !== best.best?.profileId)
          .map((id) => conditions.short(id).toLowerCase())
      : [],
  );
  const bestReasons = $derived(
    best?.best
      ? explain(best.best.result, { wind: settings.wind }, modelLabel)
          .filter((r) => r.status === 'good' || r.status === 'blocked' || r.status === 'poor')
          .slice(0, 3)
      : [],
  );
  const SORTS = [
    ['best', 'Best first'],
    ['worst', 'Worst first'],
    ['nearest', 'Nearest first'],
    ['highest', 'Highest first'],
  ] as const;
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

{#snippet badges(h: HillResult)}
  {@const hl = highlights(h)}
  {#if hl.length || midgy(h)}
    <span class="badges">
      {#each hl as c (c.profileId + c.period)}
        <span class="badge {c.result.verdict}" title="{conditions.label(c.profileId)}, {PERIOD_LABELS[c.period].toLowerCase()}: {pct(c.result.score)}">
          {conditions.short(c.profileId)}{periodWord(c)}
        </span>
      {/each}
      {#if midgy(h)}<span class="badge midge" title="High midge risk at dawn or dusk">Midges</span>{/if}
    </span>
  {/if}
{/snippet}

{#snippet row(h: HillResult)}
  <li>
    <VerdictMark verdict={h.verdict} />
    <span class="row-main">
      {@render target(pickFor(h), h.hill.name, 'zone-name')}
      <span class="small muted">
        {h.zone.name}, {Math.round(h.hill.metres)} m{#if h.best?.trip}, {tripLine(h.best.trip)}{:else if h.miles !== null}, {Math.round(h.miles)} mi{/if}
      </span>
      {@render badges(h)}
    </span>
    <span class="score" title="Photo score out of 100">{pct(h.score)}</span>
  </li>
{/snippet}

{#if best && best.best}
  {@const c = best.best}
  <section class="best" aria-labelledby="best-title">
    <p class="small muted">Best bet {dayLabel(settings.dayOffset).toLowerCase()}</p>
    <h2 id="best-title">{@render target(pickFor(best), best.hill.name, 'best-name')}</h2>
    <p>
      {Math.round(best.hill.metres)} m, {best.zone.name}{#if best.miles !== null}<span class="muted">, {Math.round(best.miles)} miles</span>{/if}
    </p>
    <div class="best-verdict">
      <VerdictMark verdict={best.verdict} confidence={c.result.confidence} size="large" />
      <span class="big-score"><strong>{pct(best.score)}</strong> <span class="small muted">photo score</span></span>
    </div>
    <p class="small">
      Best for <strong>{conditions.label(c.profileId).toLowerCase()}</strong>, {PERIOD_LABELS[c.period].toLowerCase()}{#if alsoGood.length}; also {alsoGood.join(', ')}{/if}.
    </p>
    {#if c.trip}
      {@const t = c.trip}
      <dl class="trip">
        <div><dt>{c.period === 'morning' ? 'Up' : 'Get ready'}</dt><dd>{clock(t.plan.wakeAt)}</dd></div>
        <div class="leave"><dt>Leave</dt><dd>{clock(t.plan.leaveAt)}</dd></div>
        <div><dt>Drive</dt><dd>{formatDuration(t.driveMinutes)}</dd></div>
        <div><dt>{c.scope === 'summit' ? 'Walk up' : 'Walk'}</dt><dd>{formatDuration(t.walkMinutes)}</dd></div>
        <div><dt>In place</dt><dd>{clock(t.plan.arriveAt)}</dd></div>
      </dl>
      <p class="small muted">In place {settings.earlyMinutes} min before {t.targetLabel} ({clock(t.plan.target)}). Times are rough estimates.</p>
    {:else}
      <p class="small muted hint">Set a start point or home to see when to leave.</p>
    {/if}
    {#if bestReasons.length}
      <ul class="reasons small">
        {#each bestReasons as r, i (i)}<li class={r.status}>{r.text}</li>{/each}
      </ul>
    {/if}
  </section>
{:else if conditions.data && !conditions.loading && conditions.ticked.size === 0}
  <section class="best">
    <h2 class="none">Tick something to look for</h2>
    <p class="small muted">Choose at least one condition above.</p>
  </section>
{:else if conditions.data && !conditions.loading && worth.length === 0 && tooEarly.length > 0}
  <section class="best">
    <h2 class="none">Nothing worth it without an earlier start</h2>
    <p class="small muted">
      The places below look good, but you’d need to be up before {settings.earliestUp}. Allow an
      earlier start or try another day.
    </p>
  </section>
{:else if conditions.data && !conditions.loading && ranking.total > 0 && worth.length === 0}
  <section class="best">
    <h2 class="none">Nothing looks good {dayLabel(settings.dayOffset).toLowerCase()}</h2>
    <p class="small muted">Try another day, tick more conditions or widen the filters.</p>
  </section>
{:else if conditions.data && !conditions.loading && ranking.total === 0 && conditions.forecasts.size > 0}
  <section class="best">
    <h2 class="none">No hills match</h2>
    <p class="small muted">Turn on more hill lists, lower the minimum height or allow a longer drive.</p>
  </section>
{/if}

{#if ranking.total > 0}
  <div class="list-head">
    <h3 class="list-title">
      {#if settings.sort === 'best'}Worth going: {worth.length}{:else}All hills: {ranking.total}{/if}
    </h3>
    <label class="small sort">
      <span class="muted">Sort</span>
      <select bind:value={settings.sort}>
        {#each SORTS as [v, l] (v)}<option value={v}>{l}</option>{/each}
      </select>
    </label>
  </div>
{/if}

{#if settings.sort === 'best'}
  {#if listed.length > 0}
    <ul class="zones">
      {#each listed.slice(0, shown) as h (h.hill.number)}{@render row(h)}{/each}
    </ul>
    {#if listed.length > shown}
      <button class="more" onclick={() => (shown += PAGE)}>Show {Math.min(PAGE, listed.length - shown)} more</button>
    {/if}
  {/if}
{:else}
  {@const all = [...worth, ...rest]}
  <ul class="zones">
    {#each all.slice(0, shown) as h (h.hill.number)}{@render row(h)}{/each}
  </ul>
  {#if all.length > shown}
    <button class="more" onclick={() => (shown += PAGE)}>Show {Math.min(PAGE, all.length - shown)} more</button>
  {/if}
{/if}

{#if tooEarly.length > 0}
  <section aria-labelledby="early-title">
    <details class="avoid" open={worth.length === 0}>
      <summary><h3 id="early-title" class="list-title">Needs an earlier start: {tooEarly.length}</h3></summary>
      <ul class="avoid-list">
        {#each tooEarly.slice(0, 40) as h (h.hill.number)}
          {@const c = h.needsEarlier!}
          <li class="early">
            <VerdictMark verdict={c.result.verdict} />
            <span class="early-text">
              {@render target(pickFor(h), h.hill.name, 'avoid-name')}
              <span class="small muted">{conditions.short(c.profileId)}, {problemLine(c.trip!).toLowerCase()}, {formatDuration(c.trip!.driveMinutes)} drive</span>
            </span>
          </li>
        {/each}
      </ul>
    </details>
  </section>
{/if}

{#if settings.sort === 'best' && rest.length > 0}
  <section aria-labelledby="rest-title">
    <details class="avoid">
      <summary><h3 id="rest-title" class="list-title">Not worth it: {rest.length}</h3></summary>
      <ul class="zones">
        {#each rest.slice(0, restShown) as h (h.hill.number)}{@render row(h)}{/each}
      </ul>
      {#if rest.length > restShown}
        <button class="more" onclick={() => (restShown += PAGE)}>Show {Math.min(PAGE, rest.length - restShown)} more</button>
      {/if}
    </details>
  </section>
{/if}

<style>
  .list-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
  }
  .sort {
    display: flex;
    gap: 6px;
    align-items: baseline;
  }
  .sort select {
    padding: 2px 6px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
  .zones {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
  }
  .zones li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 10px;
    align-items: start;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .score {
    font-weight: 800;
    font-stretch: 75%;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  }
  .big-score strong {
    font-size: 1.6rem;
    font-stretch: 70%;
    font-weight: 850;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 3px;
  }
  .badge {
    font-size: 0.74rem;
    padding: 0 6px;
    border-radius: 4px;
    border: 1px solid currentColor;
    line-height: 1.5;
  }
  .badge.go {
    color: var(--go);
  }
  .badge.midge {
    color: var(--no);
    border-style: dashed;
  }
  .badge.maybe {
    color: var(--maybe);
  }
  .more {
    justify-self: start;
    margin-top: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 0.85rem;
  }
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
