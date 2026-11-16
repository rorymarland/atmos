<script lang="ts">
  /** Profile, day, light, filters and start point. */
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { SUMMIT_PROFILES } from '#lib/static-data.ts';
  import { dayLabel } from '#lib/time.ts';

  let {
    picking = false,
    onPickStart,
  }: { picking?: boolean; onPickStart?: () => void } = $props();

  const profiles = $derived(
    conditions.data
      ? Object.entries(conditions.data.config.profiles).map(([id, p]) => ({ id, label: p.label }))
      : [],
  );
  const days = [0, 1, 2, 3, 4];
  const showLight = $derived(!SUMMIT_PROFILES.has(settings.profile));
  const lists = $derived(conditions.data?.lists ?? []);
  let locating = $state(false);
  let locateError = $state<string | null>(null);

  function toggleList(id: string) {
    const all = lists.map((l) => l.id);
    const current = settings.lists.length ? settings.lists : all;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    settings.lists = next.length === all.length || next.length === 0 ? [] : next;
  }
  const listOn = (id: string) => settings.lists.length === 0 || settings.lists.includes(id);

  function useLocation() {
    locateError = null;
    if (!('geolocation' in navigator)) {
      locateError = 'This browser can’t share its location. Pick a point on the map instead.';
      return;
    }
    locating = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        locating = false;
        settings.start = {
          lat: Math.round(pos.coords.latitude * 1e4) / 1e4,
          lon: Math.round(pos.coords.longitude * 1e4) / 1e4,
          label: 'your location',
        };
      },
      (err) => {
        locating = false;
        locateError =
          err.code === err.PERMISSION_DENIED
            ? 'Location was refused (browsers only share it with https sites). Pick a point on the map instead.'
            : 'Couldn’t get your location. Pick a point on the map instead.';
      },
      { timeout: 10_000 },
    );
  }
</script>

<div class="controls">
  <div class="chips wrap" role="group" aria-label="What are you going for?">
    {#each profiles as p (p.id)}
      <button class="chip" aria-pressed={settings.profile === p.id} onclick={() => (settings.profile = p.id)}>
        {p.label}
      </button>
    {/each}
  </div>

  <div class="chips wrap" role="group" aria-label="Day">
    {#each days as d (d)}
      <button class="chip" aria-pressed={settings.dayOffset === d} onclick={() => (settings.dayOffset = d)}>
        {dayLabel(d)}
      </button>
    {/each}
  </div>

  {#if showLight}
    <div class="chips" role="group" aria-label="Light">
      <button class="chip light" aria-pressed={settings.light === 'sunrise'} onclick={() => (settings.light = 'sunrise')}>Sunrise</button>
      <button class="chip light" aria-pressed={settings.light === 'sunset'} onclick={() => (settings.light = 'sunset')}>Sunset</button>
    </div>
  {/if}

  <div class="start">
    <span class="small">
      {#if settings.start}Distances from {settings.start.label}.{:else}No start point: distances are off.{/if}
    </span>
    <div class="start-actions">
      <button class="link" onclick={useLocation} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button>
      {#if onPickStart}
        <button class="link" onclick={onPickStart} aria-pressed={picking}>{picking ? 'Click the map…' : 'Pick on map'}</button>
      {/if}
      {#if settings.start}
        <button class="link" onclick={() => { settings.start = null; settings.maxMiles = null; }}>Clear</button>
      {/if}
    </div>
    {#if locateError}<p class="small error">{locateError}</p>{/if}
  </div>

  <details class="filters">
    <summary>Filters{#if settings.lists.length || settings.minHeight || settings.maxMiles}<span class="dot" aria-label="(active)"></span>{/if}</summary>
    <div class="filter-body">
      <div class="chips wrap" role="group" aria-label="Hill lists">
        {#each lists as l (l.id)}
          <button class="chip" aria-pressed={listOn(l.id)} onclick={() => toggleList(l.id)}>{l.label}</button>
        {/each}
      </div>
      <label>
        Lowest summit
        <select bind:value={settings.minHeight}>
          {#each [0, 300, 500, 600, 762, 900, 1000] as m (m)}
            <option value={m}>{m === 0 ? 'Any height' : `${m} m`}</option>
          {/each}
        </select>
      </label>
      <label>
        Distance
        <select bind:value={settings.maxMiles} disabled={!settings.start}>
          <option value={null}>Any distance</option>
          {#each [25, 50, 75, 100, 150, 200] as m (m)}
            <option value={m}>Within {m} miles</option>
          {/each}
        </select>
      </label>
      {#if !settings.start}
        <p class="small muted">Set a start point to filter by distance.</p>
      {/if}
    </div>
  </details>
</div>

<style>
  .controls {
    display: grid;
    gap: 10px;
  }
  .wrap {
    flex-wrap: wrap;
    overflow: visible;
  }
  .chip.light[aria-pressed='true'] {
    background: var(--gold);
    border-color: var(--gold);
    color: #1b2731;
  }
  .start {
    display: grid;
    gap: 2px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .start-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  .link {
    border: none;
    background: none;
    padding: 0;
    font-size: 0.875rem;
    text-decoration: underline;
    text-underline-offset: 0.18em;
    color: var(--ink);
  }
  .link[aria-pressed='true'] {
    color: var(--focus);
    font-weight: 650;
  }
  .error {
    color: var(--no);
  }
  .filters summary {
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.9rem;
    width: fit-content;
  }
  .dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--gold);
    margin-left: 6px;
    vertical-align: 1px;
  }
  .filter-body {
    display: grid;
    gap: 10px;
    padding: 10px 0 2px;
  }
  label {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.9rem;
  }
  select {
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
  }
</style>
