<script lang="ts">
  /** Profile, day, light and filter controls shared by Today and Map. */
  import { conditions } from '#lib/conditions.svelte.ts';
  import { settings } from '#lib/settings.svelte.ts';
  import { SUMMIT_PROFILES } from '#lib/static-data.ts';
  import { dayLabel } from '#lib/time.ts';

  let { compact = false }: { compact?: boolean } = $props();

  const profiles = $derived(
    conditions.data
      ? Object.entries(conditions.data.config.profiles).map(([id, p]) => ({ id, label: p.label }))
      : [],
  );
  const days = [0, 1, 2, 3, 4];
  const showLight = $derived(!SUMMIT_PROFILES.has(settings.profile));
  const lists = $derived(conditions.data?.lists ?? []);

  function toggleList(id: string) {
    const all = lists.map((l) => l.id);
    const current = settings.lists.length ? settings.lists : all;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    settings.lists = next.length === all.length || next.length === 0 ? [] : next;
  }
  const listOn = (id: string) => settings.lists.length === 0 || settings.lists.includes(id);
</script>

<div class="controls" class:compact>
  <div class="chips" role="group" aria-label="What are you going for?">
    {#each profiles as p (p.id)}
      <button class="chip" aria-pressed={settings.profile === p.id} onclick={() => (settings.profile = p.id)}>
        {p.label}
      </button>
    {/each}
  </div>

  <div class="chips" role="group" aria-label="Day">
    {#each days as d (d)}
      <button class="chip" aria-pressed={settings.dayOffset === d} onclick={() => (settings.dayOffset = d)}>
        {dayLabel(d)}
      </button>
    {/each}
    {#if showLight}
      <span class="sep" aria-hidden="true"></span>
      <button class="chip light" aria-pressed={settings.light === 'sunrise'} onclick={() => (settings.light = 'sunrise')}>Sunrise</button>
      <button class="chip light" aria-pressed={settings.light === 'sunset'} onclick={() => (settings.light = 'sunset')}>Sunset</button>
    {/if}
  </div>

  {#if !compact}
    <details class="filters">
      <summary>Filters</summary>
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
          <p class="small muted">Set a start point in <a href="/settings">Settings</a> to filter by distance.</p>
        {:else}
          <p class="small muted">Straight-line miles from {settings.start.label}.</p>
        {/if}
      </div>
    </details>
  {/if}
</div>

<style>
  .controls {
    display: grid;
    gap: 10px;
  }
  .sep {
    flex: none;
    width: 1px;
    background: var(--line);
    margin: 4px 4px;
  }
  .chip.light[aria-pressed='true'] {
    background: var(--gold);
    border-color: var(--gold);
    color: #1b2731;
  }
  .wrap {
    flex-wrap: wrap;
    overflow: visible;
  }
  .filters summary {
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.9rem;
    width: fit-content;
  }
  .filter-body {
    display: grid;
    gap: 12px;
    padding: 12px 0 4px;
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
